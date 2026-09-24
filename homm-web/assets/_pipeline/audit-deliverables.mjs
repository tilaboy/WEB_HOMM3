/**
 * audit-deliverables.mjs —— **独立资产审计**（art-director-3 写域内，只读）。
 *
 * 目的：**不采信管线的自报**，直接把交付的 PNG 拆到 chunk 层核一遍，
 * 并核对「同值多址」（同一份字节出现在多个路径）与「零位图不变量」。
 *
 * 为什么要有它：`bitmap-asset-options.md §6.1.1` 的断言目前由**产出方自报**。
 * 本脚本是**第二条独立路径**：IHDR / PLTE / tRNS / IDAT 由本脚本自己解析，
 * 像素由 `lib.mjs` 的 decodePng 解（该解码器已在 §7「垫片保真度」同源被验）。
 *
 * 用法：node audit-deliverables.mjs [--json]
 * 退出码：0 = 全 PASS；1 = 有 FAIL。
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, countColors, toLstar } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(HERE, '..');

/* ------------------------------------------------------------------ chunk 解析 */
/** 自己解 PNG：返回结构断言要用的原始字段（不经过 lib）。 */
function parseChunks(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  const out = { chunks: [], ihdr: null, plte: null, trns: null, idatBytes: 0, crcBad: [] };
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    const crcStored = buf.readUInt32BE(pos + 8 + len);
    out.chunks.push(type);
    if (type === 'IHDR') {
      out.ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'PLTE') out.plte = Buffer.from(data);
    else if (type === 'tRNS') out.trns = Buffer.from(data);
    else if (type === 'IDAT') out.idatBytes += data.length;
    else if (type === 'IEND') break;
    // CRC 复核
    let c = -1;
    const body = buf.subarray(pos + 4, pos + 8 + len);
    for (let i = 0; i < body.length; i++) {
      c ^= body[i];
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    if (((c ^ -1) >>> 0) !== crcStored) out.crcBad.push(type);
    pos += 12 + len;
  }
  return out;
}

/* ------------------------------------------------------------------ 断言框架 */
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
}

function md5(p) {
  return createHash('md5').update(readFileSync(p)).digest('hex');
}

/* ================================================================= 1. (b) 交付物 */
// --file=<path> 可换目标 ⇒ 用于**负测**（喂一张故意错的图，探针必须 RED）
const fileArg = process.argv.find((a) => a.startsWith('--file='));
const CANON = fileArg
  ? path.resolve(fileArg.slice('--file='.length))
  : path.join(ASSETS, 'sprites/crestL/crestL_p1.png');
const WORK_A = path.join(ASSETS, '_pipeline/out/b_crestL_p1.png');
const WORK_B = path.join(ASSETS, '_pipeline/deliver/b_crestL_p1.png');

check('canonical (b) 文件存在', existsSync(CANON), CANON);
if (!existsSync(CANON)) {
  console.log(JSON.stringify({ results }, null, 2));
  process.exit(1);
}

const buf = readFileSync(CANON);
const chunks = parseChunks(buf);

check('尺寸 = 256×384', chunks.ihdr.width === 256 && chunks.ihdr.height === 384, `${chunks.ihdr.width}×${chunks.ihdr.height}（§6.1.1 声明 256×384）`);
check('8-bit 非交错', chunks.ihdr.bitDepth === 8 && chunks.ihdr.interlace === 0, `bitDepth=${chunks.ihdr.bitDepth} interlace=${chunks.ihdr.interlace}`);
check('color type = 3（PNG-8 索引色）', chunks.ihdr.colorType === 3, `colorType=${chunks.ihdr.colorType}（声明 PNG-8）`);
check('无额外色带（无 gAMA/iCCP/sRGB 附带）', !chunks.chunks.includes('gAMA') && !chunks.chunks.includes('iCCP'), `chunks = ${chunks.chunks.join(',')}`);
check('CRC 全部正确', chunks.crcBad.length === 0, chunks.crcBad.length ? `坏 chunk: ${chunks.crcBad.join(',')}` : 'all ok');

const paletteEntries = chunks.plte ? chunks.plte.length / 3 : 0;
check('PLTE = 24 色', paletteEntries === 24, `PLTE 条目 = ${paletteEntries}（声明 24）`);
check('PLTE ≤ 32（asset-spec §3.3 上限）', paletteEntries <= 32 && paletteEntries > 0, `${paletteEntries}`);
check('PLTE ≤ 24（asset-spec §3.4 每精灵上限）', paletteEntries <= 24, `${paletteEntries}`);

// tRNS：索引色的 alpha 只能取 {0,255}（硬边，§3.4）
const trnsVals = chunks.trns ? [...new Set([...chunks.trns])] : [];
check('tRNS 存在且 alpha ∈ {0,255}（无半透明）', chunks.trns && trnsVals.every((v) => v === 0 || v === 255), `tRNS 去重 = [${trnsVals.join(',')}]`);

check('字节数 = 5704', buf.length === 5704, `${buf.length} B（声明 5704 B）`);

const { width: W, height: H, rgba } = decodePng(buf);
const opaque = (() => {
  let n = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) n++;
  return n;
})();
check('不透明像素 > 0（图不是空的）', opaque > 0, `${opaque} px`);

// 水印区（右下）：x ≥ 82%、y ≥ 92% ⇒ 不透明像素必须为 0
let wmOpaque = 0;
const x0 = Math.floor(W * 0.82);
const y0 = Math.floor(H * 0.92);
for (let y = y0; y < H; y++) for (let x = x0; x < W; x++) if (rgba[(y * W + x) * 4 + 3] > 0) wmOpaque++;
check('水印区（x≥82%,y≥92%）不透明像素 = 0', wmOpaque === 0, `${wmOpaque} px（声明 0）`);

/* 用色数有两个**不同定义**，必须分开量（§6.1.1 的 "24 色 / 23 色" 说的是前者）：
 *   (A) PLTE 槽位数 = 调色板表长度
 *   (B) 不透明像素里的**相异 RGB 值数** = countColors 的口径
 * 本文件两者都量，不混用。 */
function usedIndexInfo(buf, W, H) {
  let pos = 8; let plte = null; let trns = null; const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const d = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'PLTE') plte = Buffer.from(d);
    else if (type === 'tRNS') trns = Buffer.from(d);
    else if (type === 'IDAT') idat.push(Buffer.from(d));
    else if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const used = new Map();
  let p = 0;
  const stride = W; // 8-bit 索引色 ⇒ 1 B/px
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < H; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 1 ? line[i - 1] : 0;
      const b = prev[i];
      const c = i >= 1 ? prev[i - 1] : 0;
      let v = line[i];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 255;
      }
      line[i] = v;
    }
    for (let x = 0; x < stride; x++) used.set(line[x], (used.get(line[x]) || 0) + 1);
    prev = line;
  }
  const entries = plte ? plte.length / 3 : 0;
  const unusedIdx = plte ? [...Array(entries).keys()].filter((i) => !used.has(i)) : [];
  // 相异 RGB（含透明项）
  const rgbSet = new Set();
  for (let i = 0; i < entries; i++) rgbSet.add((plte[i * 3] << 16) | (plte[i * 3 + 1] << 8) | plte[i * 3 + 2]);
  return { entries, usedIdx: used.size, unusedIdx, distinctRgb: rgbSet.size, trns: trns ? [...trns] : null, counts: used };
}
const ii = chunks.ihdr.colorType === 3 ? usedIndexInfo(buf, W, H) : null;
if (!ii) {
  check('索引色分析（需 colorType=3）', false, `colorType=${chunks.ihdr.colorType}（非索引色）⇒ 无法做槽位/用色分析`);
} else {
  check('全部 24 个 PLTE 槽位都被引用（无空槽）', ii.usedIdx === ii.entries, `引用 ${ii.usedIdx} / 槽位 ${ii.entries}；空槽 = [${ii.unusedIdx.join(',')}]`);
  // 两个口径都成立、且**必须分开写**：
  //   (A) 声明 "24 色" = PLTE 槽位 = 24（且全被引用、24 个相异 RGB）
  //   (B) 另一种实现的 "23 色" = **不透明像素**里的相异 RGB = 23（少的那 1 个 = 透明底那一槽）
  check('PLTE 相异 RGB = 24（即声明的"24 色"）', ii.distinctRgb === ii.entries && ii.entries === 24, `相异 RGB = ${ii.distinctRgb} / 槽位 ${ii.entries}`);
  check('不透明区相异 RGB = 23（另一种实现"23 色"的口径）', countColors(rgba, W, H) === 23, `逐像素重解 = ${countColors(rgba, W, H)}；差 = 透明底那一槽（不进不透明区统计）`);
  const bgTransparent = ii.trns ? ii.trns.filter((v) => v === 0).length : 0;
  check('透明项恰 1 个（背景键）', bgTransparent === 1, `tRNS 中 alpha=0 的槽位 = ${bgTransparent}`);
}

/* ================================================================= 2. 同值多址 */
const md5s = { canon: md5(CANON) };
if (existsSync(WORK_A)) md5s.work_out = md5(WORK_A);
if (existsSync(WORK_B)) md5s.work_deliver = md5(WORK_B);
// 只在审默认目标时才比"同值多址"（负测喂进来的文件本来就不该一致）
if (!fileArg) {
  const allSame = new Set(Object.values(md5s)).size === 1;
  check('三个路径字节完全一致（同值多址）', allSame, JSON.stringify(md5s));
} else {
  check('[负测模式] 跳过同值多址检查', true, '--file 模式');
}

/* ================================================================= 3. 零位图不变量 */
// 交付物绝不能落在 src/ 或 public/ 里
const inSrc = CANON.includes('/src/');
const inPublic = CANON.includes('/public/');
check('(b) 交付物不在 src/ 内', !inSrc, CANON);
check('(b) 交付物不在 public/ 内', !inPublic, CANON);

/* ================================================================= 3.5 「打开游戏第一眼」= 原生启动图 */
// 用户原话点名的位置。它不是 Web 资源（不受零位图不变量约束），它随 APK 出。
const SPLASH = path.join(ASSETS, '..', 'resources/splash.png');
const SPLASH_DARK = path.join(ASSETS, '..', 'resources/splash-dark.png');
if (existsSync(SPLASH)) {
  const sb = readFileSync(SPLASH);
  const sw = sb.readUInt32BE(16);
  const sh = sb.readUInt32BE(20);
  const sct = sb[25];
  check('启动图存在', true, `resources/splash.png ${sw}×${sh} colorType=${sct} ${sb.length} B`);
  check('启动图是 PNG-32（未做调色板压缩）', sct === 6, `colorType=${sct}（6 = RGBA，24 位色 + 8 位 alpha）`);
  const sameAsDark = existsSync(SPLASH_DARK) && md5(SPLASH) === md5(SPLASH_DARK);
  check('splash-dark 与 splash 是同一张（"暗色版"未单独设计）', sameAsDark, sameAsDark ? `两文件 md5 相同 = ${md5(SPLASH)}` : '两者不同');
}

/* ================================================================= 3.6 交付物未入构建 */
const distDir = path.join(ASSETS, '..', 'dist');
const androidPublic = path.join(ASSETS, '..', 'android/app/src/main/assets/public');
function hasAnyImage(dir) {
  if (!existsSync(dir)) return null;
  const hits = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(png|jpe?g|webp|gif)$/i.test(e.name)) hits.push(path.relative(dir, f));
    }
  };
  walk(dir);
  return hits;
}
const distImgs = hasAnyImage(distDir);
const pubImgs = hasAnyImage(androidPublic);
check('dist/ 内无图像文件', distImgs && distImgs.length === 0, distImgs === null ? '(dist 不存在)' : `${distImgs.length} 个${distImgs.length ? ': ' + distImgs.slice(0, 5).join(', ') : ''}`);
check('安卓同步 public/ 内无图像文件', pubImgs && pubImgs.length === 0, pubImgs === null ? '(目录不存在)' : `${pubImgs.length} 个${pubImgs.length ? ': ' + pubImgs.slice(0, 5).join(', ') : ''}`);

/* ================================================================= 4. 报告 */
const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ file: CANON, md5s, pass, fail, results }, null, 2));
} else {
  console.log(`\n独立资产审计 —— ${path.relative(ASSETS, CANON)}`);
  console.log(`md5 = ${md5s.canon}`);
  console.log('-'.repeat(72));
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}\n        ${r.detail}`);
  console.log('-'.repeat(72));
  console.log(`${pass}/${results.length} PASS${fail ? `  ⚠️ ${fail} FAIL` : '  ✅'}\n`);
}
process.exit(fail ? 1 : 0);
