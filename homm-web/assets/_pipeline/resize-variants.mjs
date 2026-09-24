/**
 * resize-variants.mjs —— `#162`「母图 → 26 档」的**可复算参考缩放器**（最近邻 + 保持 indexed）
 *
 * 定位：**不是**替代 splash.mjs（那是母图生成器）。本脚本干两件事：
 *   ① 把 splash_spec.md 的「缩放规则」落成一条**可执行、可复算**的参考实现 ——
 *      补上 spec 缺口：**插值 filter**（默认 bilinear/area 会糊像素画 + 生新色）。
 *   ② **独立复核** spec 里那句「26 档任何比例都不裁到主体」——用真缩放产物判，不信自报。
 *
 * 硬约束：
 *   - **最近邻**（不平均、不双线性）⇒ 不生新色、保像素锐度；
 *   - **保持 PNG-8 indexed 输出**（复用母图 PLTE/tRNS）；
 *   - **cover + 居中裁切**（与 spec 一致）；
 *   - **只读** `android/.../res/**` 的尺寸；**只写** `assets/_pipeline/out/variants/**`
 *     —— **不写 `android/.../res/**`**（那是 engineering-lead 的域；本脚本只出参考产物）。
 *
 * 用法：node resize-variants.mjs
 * 产出：out/variants/<orig-rel>  +  out/variants_report.md
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../..');
const RES = path.join(WEB, 'android/app/src/main/res');
const MASTERS = path.join(HERE, 'out');
const STAGE = path.join(HERE, 'out/variants');
mkdirSync(STAGE, { recursive: true });

const md5 = (b) => createHash('md5').update(b).digest('hex');
const BG = [0x1b, 0x1f, 0x24]; // splash_spec 里母图底色

/* ------------------------------------------------ PNG-8 读（自己解，不靠 shell/库） */
function parseIndexed(file) {
  const b = readFileSync(file);
  let p = 8, W = 0, H = 0, bd = 0, ct = 0, plte = [], trns = null;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    const d = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { W = d.readUInt32BE(0); H = d.readUInt32BE(4); bd = d[8]; ct = d[9]; }
    else if (type === 'PLTE') for (let i = 0; i < len; i += 3) plte.push([d[i], d[i + 1], d[i + 2]]);
    else if (type === 'tRNS') trns = Buffer.from(d);
    else if (type === 'IDAT') idat.push(d);
    p += 12 + len;
    if (type === 'IEND') break;
  }
  if (ct !== 3 || bd !== 8) throw new Error(`仅支持 PNG-8 indexed（ct${ct}/bd${bd}）：${file}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = W;
  const idx = new Uint8Array(H * stride);
  let q = 0;
  for (let y = 0; y < H; y++) {
    const ft = raw[q++];
    for (let x = 0; x < stride; x++) {
      const rv = raw[q++];
      const a = x >= 1 ? idx[y * stride + x - 1] : 0;
      const b2 = y > 0 ? idx[(y - 1) * stride + x] : 0;
      const c = (x >= 1 && y > 0) ? idx[(y - 1) * stride + x - 1] : 0;
      let v;
      if (ft === 0) v = rv;
      else if (ft === 1) v = rv + a;
      else if (ft === 2) v = rv + b2;
      else if (ft === 3) v = rv + ((a + b2) >> 1);
      else {
        const pa = Math.abs(b2 - c), pb = Math.abs(a - c), pc = Math.abs(a + b2 - 2 * c);
        v = rv + (pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c);
      }
      idx[y * stride + x] = v & 255;
    }
  }
  return { W, H, plte, trns, idx };
}

/* ------------------------------------------------ PNG-8 写（保 PLTE/tRNS ⇒ indexed 不破） */
const CRC = (() => { const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); T[n] = c >>> 0; } return T; })();
function crc32(buf) { let c = 0xffffffff; for (const x of buf) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])), 8 + data.length);
  return out;
}
function writeIndexed(file, w, h, idx, plte, trns) {
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; raw.set(idx.subarray(y * w, y * w + w), y * (w + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 3;
  const parts = [
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(plte.flat())),
  ];
  if (trns) parts.push(chunk('tRNS', trns));
  parts.push(chunk('IDAT', deflateSync(Buffer.from(raw), { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  const buf = Buffer.concat(parts);
  writeFileSync(file, buf);
  return buf;
}

/* ------------------------------------------------ cover + 居裁 + 最近邻 */
function coverResize(m, tw, th) {
  const k = Math.max(tw / m.W, th / m.H);
  const sw = Math.round(m.W * k), sh = Math.round(m.H * k);
  const offX = Math.floor((sw - tw) / 2), offY = Math.floor((sh - th) / 2);
  const out = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(m.H - 1, Math.floor((y + offY) / k));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(m.W - 1, Math.floor((x + offX) / k));
      out[y * tw + x] = m.idx[sy * m.W + sx];
    }
  }
  // 可见源区（母图坐标）⇒ 判「是否裁到主体」
  const vis = { x0: offX / k, x1: (offX + tw) / k, y0: offY / k, y1: (offY + th) / k };
  return { out, k, sw, sh, offX, offY, vis };
}

/* ------------------------------------------------ 主体 bbox（非底色像素） */
function subjectBBox(m) {
  let x0 = m.W, x1 = -1, y0 = m.H, y1 = -1;
  for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
    const c = m.plte[m.idx[y * m.W + x]];
    if (!(c[0] === BG[0] && c[1] === BG[1] && c[2] === BG[2])) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { x0, x1, y0, y1 };
}

/* ------------------------------------------------ 目标档（读 res 现存尺寸，只读） */
function variantTargets() {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/^splash.*\.png$/.test(e.name)) continue;
      const b = readFileSync(p);
      out.push({ rel: path.relative(RES, p), w: b.readUInt32BE(16), h: b.readUInt32BE(20), src: b });
    }
  };
  if (!existsSync(RES)) throw new Error(`缺 res 目录：${RES}`);
  walk(RES);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/* ------------------------------------------------ 主流程 */
const masters = {};
for (const key of ['land', 'port']) {
  const f = path.join(MASTERS, `splash_${key}_${key === 'land' ? '1920x1280' : '1280x1920'}.png`);
  if (!existsSync(f)) throw new Error(`缺母图：${f}（先跑 splash.mjs）`);
  const m = parseIndexed(f);
  masters[key] = { m, bbox: subjectBBox(m), file: path.basename(f), md5: md5(readFileSync(f)) };
}

const rows = [];
const clipped = [];
for (const v of variantTargets()) {
  const isPort = /^drawable-port/.test(v.rel) || v.h > v.w;
  const M = masters[isPort ? 'port' : 'land'];
  const r = coverResize(M.m, v.w, v.h);
  const outDir = path.join(STAGE, path.dirname(v.rel));
  mkdirSync(outDir, { recursive: true });
  const buf = writeIndexed(path.join(STAGE, v.rel), v.w, v.h, r.out, M.m.plte, M.m.trns);

  // 是否裁到主体：主体 bbox 是否被可见源区切掉
  const bb = M.bbox;
  const cutX0 = Math.max(0, bb.x0 - r.vis.x0), cutX1 = Math.max(0, r.vis.x1 - bb.x1);
  const cutY0 = Math.max(0, bb.y0 - r.vis.y0), cutY1 = Math.max(0, r.vis.y1 - bb.y1);
  const cutPx = Math.round(Math.max(cutX0, cutX1, cutY0, cutY1));
  const hit = cutPx > 0.5;
  if (hit) clipped.push({ rel: v.rel, cutPx, cutX0: Math.round(cutX0), cutX1: Math.round(cutX1) });

  // 尺度检查：与工程侧原图比，尺寸是否一致（只读对照）
  const sameSizeAsOrig = (v.src.readUInt32BE(16) === v.w && v.src.readUInt32BE(20) === v.h);
  rows.push({ rel: v.rel, target: `${v.w}x${v.h}`, master: isPort ? 'port' : 'land',
    k: +r.k.toFixed(5), cut: `${Math.round(r.sw - v.w)}×${Math.round(r.sh - v.h)}`,
    bytes: buf.length, colors: new Set(r.out).size, md5: md5(buf), clippedPx: hit ? cutPx : 0, sameSizeAsOrig });
}

/* ------------------------------------------------ 报告 */
const lines = [];
lines.push('# `#162` 母图 → 26 档：**可复算参考缩放器**产物报告\n');
lines.push('> 生成物：`assets/_pipeline/resize-variants.mjs`（可复算）。规则：**cover + 居中裁切 + 最近邻 + 保持 PNG-8 indexed**。');
lines.push('> **本脚本只写 `out/variants/**`（参考产物）—— 不写 `android/.../res/**`**（那是 engineering-lead 的域）。\n');
lines.push('## 绑定');
lines.push(`- land 母图 \`${masters.land.file}\` md5 \`${masters.land.md5}\``);
lines.push(`- port 母图 \`${masters.port.file}\` md5 \`${masters.port.md5}\``);
lines.push(`- 插值：**最近邻（nearest）**；输出：**PNG-8 indexed（复用母图 PLTE/tRNS，≤${masters.land.m.plte.length} 色，不新增颜色）**\n`);
lines.push('## 逐档结果\n');
lines.push('| 变体 | 目标 | 母图 | cover 倍率 | 裁掉 | 产物字节 | 用色 | 裁到主体 px | 尺寸与原图一致 |');
lines.push('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) lines.push(`| \`${r.rel}\` | ${r.target} | ${r.master} | ×${r.k} | ${r.cut} | ${r.bytes} | ${r.colors} | ${r.clippedPx || '—'} | ${r.sameSizeAsOrig ? '✓' : '✗'} |`);
lines.push('\n## ★「任何比例都不裁到主体」复核\n');
if (clipped.length === 0) lines.push('- **合规**：26 档中无一档的可见区切到主体 bbox。');
else {
  lines.push(`- **⚠ 有 ${clipped.length} 档裁到主体**：`);
  for (const c of clipped) lines.push(`  - \`${c.rel}\`：左侧切 ${c.cutX0}px / 右侧切 ${c.cutX1}px（母图坐标，共约 ${c.cutPx}px）`);
}
writeFileSync(path.join(HERE, 'out/variants_report.md'), lines.join('\n') + '\n');

console.log(`母图: land=${masters.land.m.W}x${masters.land.m.H}(主体 x${masters.land.bbox.x0}..${masters.land.bbox.x1})  port=${masters.port.m.W}x${masters.port.m.H}(主体 x${masters.port.bbox.x0}..${masters.port.bbox.x1})`);
console.log(`档数=${rows.length}  裁到主体的档=${clipped.length}`);
for (const c of clipped) console.log(`  ⚠ ${c.rel}  左${c.cutX0}px 右${c.cutX1}px`);
console.log(`产物: ${path.relative(WEB, STAGE)}/**  +  out/variants_report.md`);
