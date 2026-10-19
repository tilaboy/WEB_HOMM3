#!/usr/bin/env node
/**
 * TP-4② 中立野怪翻新 · 验收门（mon_* 地图图标层）
 * ==========================================================================
 * 用法：
 *   npm run build && npm run audit:neutral
 *   node tools/neutralaudit.mjs --png <dir>   额外导出 ×10 放大 PNG（截图对比素材）
 *   node tools/neutralaudit.mjs --dist=<dir>  指向隔离构建（负测/旧构建对比）
 *
 * 管辖范围（TP-4② 的**地图图标层**）：
 *   `atlas.ts` 的 `mon_wolf` / `mon_boar` / `mon_ogre`（32×30/32×30/32×44，
 *   与 `unitArt.ts` B4 批的 `cu_*` 战斗帧同批翻新、同色板同造型语言）。
 *
 * 为什么 mon_* 要单独一把门：b0audit 只扫 `UNIT_FRAMES`（64×56/52×44 家族），
 * mon_* 是 atlas.ts 的小图标，**没有任何现成断言覆盖**；而旧画法恰是圣经点的
 * 反面教材（椭圆 blob + 0.8 半透明 + 色板外灰色 + 1px 眼）。
 *
 * 判什么：
 *   [0] 覆盖闸 —— 3 个 mon 帧建得出、尺寸恒定（MON_FRAME_SIZE 真源）、剪影非空；
 *                 **并且** `cu_wolf/cu_boar/cu_ogre` 仍登记在 UNIT_FRAMES
 *                 （64×56 idle）——防有人删了 B4 批让战斗帧退回 LEGACY/缺失。
 *                 **有对象无可判数据时必须红，不许静默跳过。**
 *   [1] 零半透明 —— α ∈ {0,255}。旧画法 0.8/0.85 的脏边源头（asset-spec §3.3）。
 *   [2] 色板纯净 —— 每个不透明像素 ∈ B0_PALETTE ∪ {图集墨 OUTLINE #241a10}。
 *                 （OUTLINE 与 B0 ink0 #2a1a12 的迁移是 TP-4① 已记的欠账，
 *                  本门按图集现状放行它，不静默扩权。）
 *   [3] 描边环 —— 从「无描边本体」8 邻域 BFS 重建膨胀环：第 1 圈必须被 OUTLINE
 *                 实色铺满、第 2 圈必须空（地图图标恒 1px，§1.1 战斗单位行口径）、
 *                 环外不许有散点。防"没描边"与"描成 2px"两个方向。
 *   [4] 剪影非退化 —— bbox 高 ≥ 画布高 55%、脚底行 ≥ 画布底-3（贴地不浮空）。
 *   [5] 相邻材质明度差 —— 与 b0audit 断言 8 同口径（异族 ΔL*≥8，同色系 <30° 时 ≥12），
 *                 mon_* 不进 UNIT_FRAMES 没人管，这里补上。
 *                 墨族内部（ink0/ink1/图集墨 #241a10）豁免——同材质三个 hex，
 *                 拆分是 TP-4① 已记欠账，不属材质边界（b0audit 豁免 ink0|ink1 同理）。
 *
 * 负向对照（插桩造失败 → 必须红；恢复 → 必须复绿）：
 *   N1  setMonArtOptions({outline:false}) → [3] 必须红（环空 = TP-4② 之前的状态）
 *   N2  dist 深层桩（给 mon_wolf 注入一个 0.85 alpha 像素）→ [1] 必须红，
 *       且**退出码 =1**（判词挂在退出码上的证明）；恢复后 md5 吻合、退出码 =0
 *
 * 零新增依赖：node 内建 + 与 b0audit/townartaudit 同口径的零依赖 PNG 编码器。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { distDir, distUrl, printHeader, requireFile } from './_dist.mjs';

/* `--dist=<dir>`（缺省 `<repo>/dist`）—— 口径同 b0audit / townartaudit。 */
const DIST = distDir();
printHeader(DIST, 'gate=neutralaudit');
const u = (rel) => distUrl(rel, DIST);
requireFile(DIST, 'render/atlas.js');

const {
  buildMonFrame,
  setMonArtOptions,
  MON_FRAME_SIZE,
} = await import(u('render/atlas.js'));
const { UNIT_FRAMES, B0_PALETTE } = await import(u('render/unitArt.js'));

/** 图集墨色（atlas.ts 的 OUTLINE，全精灵共用；与 B0 色板 ink0 #2a1a12 的迁移是另一条欠账）。 */
const OUTLINE_RGB = [0x24, 0x1a, 0x10];

/* ---------------------------------------------------------------- 参数 */

const argv = process.argv.slice(2);
const pngIdx = argv.indexOf('--png');
const pngDir = pngIdx >= 0 ? argv[pngIdx + 1] : null;

/* ---------------------------------------------------------------- 断言框架 */

let bad = 0;
const results = [];
function record(id, title, pass, detail) {
  results.push({ id, title, pass, detail });
  if (!pass) bad++;
  const d = detail && typeof detail === 'object'
    ? Object.entries(detail).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(';') : v}`).join(' ')
    : detail ?? '';
  console.log(`[${pass ? 'PASS' : 'FAIL'}] [${id}] ${title}${d ? ` — ${d}` : ''}`);
}

/* ---------------------------------------------------------------- 公共量 */

const IDS = ['wolf', 'boar', 'ogre'];

/** B0_PALETTE 的 hex 全集 + 图集墨。 */
const PAL_HEX = new Set(B0_PALETTE.map((e) => e.hex));
const PAL = new Map(B0_PALETTE.map((e) => [e.hex, e]));
const OUTLINE_HEX = '#' + OUTLINE_RGB.map((v) => v.toString(16).padStart(2, '0')).join('');

const lstar = (r, g, b) => {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const Y = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  return Y <= 0 ? 0 : 116 * Math.cbrt(Y) - 16;
};
function hueOf(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const mx = Math.max(rn, gn, bn);
  const mn = Math.min(rn, gn, bn);
  const d = mx - mn;
  if (d === 0) return 0;
  let h;
  if (mx === rn) h = ((gn - bn) / d) % 6;
  else if (mx === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
function hueGap(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
/** 与 b0audit 断言 8 同口径：异族相邻 ΔL*≥8；色相差 <30°（同色系）升到 12。 */
const MIN_DL = 8;
const MIN_DL_SAME_HUE = 12;
const SAME_HUE_DEG = 30;
const requiredDl = (h1, h2) => (hueGap(h1, h2) < SAME_HUE_DEG ? MIN_DL_SAME_HUE : MIN_DL);
/**
 * 墨族（描边/AO 墨）内部不相邻检验——b0audit 豁免 ink0|ink1 的同理扩展：
 * ink0 #2a1a12 / ink1 #4a3524 / 图集墨 #241a10 是同一种材质（轮廓墨）的三个 hex，
 * 图集墨与 B0 墨的拆分是 TP-4① 已记的欠账，不属于材质边界。
 */
const INK_FAMILIES = new Set(['ink0', 'ink1', 'atlasInk']);

const toHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/** 8 邻域多源 BFS ⇒ 每个非本体像素到本体的 Chebyshev 距离（上限 maxD，超出 = -1）。 */
function distToBody(body, maxD) {
  const W = body.w;
  const H = body.h;
  const dist = new Int8Array(W * H).fill(-1);
  const q = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (body.alphaAt(x, y) > 8) {
        dist[y * W + x] = 0;
        q.push([x, y]);
      }
    }
  }
  for (let head = 0; head < q.length; head++) {
    const [x, y] = q[head];
    const d = dist[y * W + x];
    if (d >= maxD) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (dist[ny * W + nx] !== -1) continue;
        dist[ny * W + nx] = d + 1;
        q.push([nx, ny]);
      }
    }
  }
  return dist;
}

/** 剪影 bbox（{x0,y0,x1,y1,h,w} 或 null=空帧）。 */
function bbox(pb) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < pb.h; y++) {
    for (let x = 0; x < pb.w; x++) {
      if (pb.alphaAt(x, y) <= 8) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return null;
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 按选项建「成品 + 本体」两套帧。本体 = 同选项但描边关。 */
function buildAll(outline) {
  setMonArtOptions({ outline });
  const finals = new Map();
  for (const id of IDS) finals.set(id, buildMonFrame(id));
  setMonArtOptions({ outline: false });
  const bodies = new Map();
  for (const id of IDS) bodies.set(id, buildMonFrame(id));
  setMonArtOptions({ outline: true });
  return { finals, bodies };
}

/* ---------------------------------------------------------------- [0] 覆盖闸 */

{
  const detail = {};
  let ok = true;
  for (const id of IDS) {
    const want = MON_FRAME_SIZE[id];
    let pb;
    try {
      pb = buildMonFrame(id);
    } catch (e) {
      ok = false;
      detail[id] = `建帧抛错：${e.message}`;
      continue;
    }
    const bb = bbox(pb);
    const sizeOk = pb.w === want.w && pb.h === want.h;
    const silOk = bb !== null && bb.h >= 8 && bb.w >= 8;
    if (!sizeOk || !silOk) ok = false;
    detail[id] = `${pb.w}×${pb.h}(真源 ${want.w}×${want.h}) 剪影 ${bb ? `${bb.w}×${bb.h}` : '空'}`;
  }
  // Tie-in：cu trio 必须仍登记在 UNIT_FRAMES（64×56 idle）——删了 B4 批这里红
  const cuIds = new Set(
    UNIT_FRAMES.filter((f) => f.kind !== 'map').map((f) => f.name.replace(/^cu_/, '')),
  );
  const missingCu = IDS.filter((id) => !cuIds.has(id));
  if (missingCu.length) {
    ok = false;
    detail['cu trio'] = `UNIT_FRAMES 缺 ${missingCu.join(',')}（战斗帧会缺失/退回 LEGACY）`;
  } else {
    detail['cu trio'] = 'cu_wolf/cu_boar/cu_ogre 均在 UNIT_FRAMES（64×56 idle）';
  }
  record('0', '覆盖闸：3 个 mon 帧 + cu trio 登记', ok, detail);
}

/* ---------------------------------------------------------------- [1][2][4][5] 逐帧 */

const { finals, bodies } = buildAll(true);

for (const id of IDS) {
  const pb = finals.get(id);

  /* [1] 零半透明 */
  {
    let semi = 0;
    const at = [];
    for (let y = 0; y < pb.h; y++) {
      for (let x = 0; x < pb.w; x++) {
        const a = pb.alphaAt(x, y);
        if (a > 8 && a < 250) {
          semi++;
          if (at.length < 3) at.push(`(${x},${y})α=${a}`);
        }
      }
    }
    record('1', `零半透明（α∈{0,255}）· mon_${id}`, semi === 0, {
      name: `mon_${id}`,
      semiTransparent: semi,
      at: at.join(' '),
    });
  }

  /* [2] 色板纯净 */
  {
    const off = new Map();
    let colors = 0;
    const seen = new Set();
    for (let y = 0; y < pb.h; y++) {
      for (let x = 0; x < pb.w; x++) {
        const [r, g, b, a] = pb.px(x, y);
        if (a === 0) continue;
        colors++;
        const hex = toHex(r, g, b);
        seen.add(hex);
        if (!PAL_HEX.has(hex) && hex !== OUTLINE_HEX) off.set(hex, (off.get(hex) ?? 0) + 1);
      }
    }
    record('2', `色板纯净（B0 ∪ 图集墨）· mon_${id}`, off.size === 0, {
      name: `mon_${id}`,
      offPalette: [...off.entries()].map(([h, n]) => `${h}×${n}`),
      distinctColors: seen.size,
      opaquePixels: colors,
    });
  }

  /* [4] 剪影非退化 */
  {
    const bb = bbox(pb);
    const hOk = bb !== null && bb.h >= pb.h * 0.55;
    const footOk = bb !== null && bb.y1 >= pb.h - 3;
    record('4', `剪影非退化 + 贴地 · mon_${id}`, hOk && footOk, {
      name: `mon_${id}`,
      剪影: bb ? `${bb.w}×${bb.h}` : '空',
      高占画布: bb ? `${((bb.h / pb.h) * 100).toFixed(0)}%` : '-',
      脚底行: bb ? `${bb.y1}/${pb.h - 1}` : '-',
    });
  }

  /* [5] 相邻材质明度差（b0audit 断言 8 同口径） */
  {
    const violations = [];
    let worst = { dl: Infinity, text: 'n/a' };
    for (let y = 0; y < pb.h; y++) {
      for (let x = 0; x < pb.w; x++) {
        const p = pb.px(x, y);
        if (p[3] === 0) continue;
        const hex = toHex(p[0], p[1], p[2]);
        const e = PAL.get(hex) ?? { family: hex === OUTLINE_HEX ? 'atlasInk' : null };
        if (!e.family) continue;
        for (const [nx, ny] of [
          [x + 1, y],
          [x, y + 1],
        ]) {
          const q = pb.px(nx, ny);
          if (q[3] === 0) continue;
          const qhex = toHex(q[0], q[1], q[2]);
          if (qhex === hex) continue;
          const f = PAL.get(qhex) ?? { family: qhex === OUTLINE_HEX ? 'atlasInk' : null };
          if (!f.family || f.family === e.family) continue;
          if (INK_FAMILIES.has(e.family) && INK_FAMILIES.has(f.family)) continue; // 墨族内部
          const h1 = hueOf(p[0], p[1], p[2]);
          const h2 = hueOf(q[0], q[1], q[2]);
          const need = requiredDl(h1, h2);
          const dl = Math.abs(lstar(p[0], p[1], p[2]) - lstar(q[0], q[1], q[2]));
          const text = `${hex}↔${qhex} ΔL*=${dl.toFixed(1)} ΔH=${hueGap(h1, h2).toFixed(0)}° 需≥${need}`;
          if (dl < need) violations.push(`${text} @(${x},${y})`);
          if (dl < worst.dl) worst = { dl, text };
        }
      }
    }
    record('5', `相邻材质明度差 · mon_${id}`, violations.length === 0, {
      name: `mon_${id}`,
      violations: violations.slice(0, 3),
      worstPair: worst.text,
    });
  }
}

/* ---------------------------------------------------------------- [3] 描边环 */

function checkRing(id, expected) {
  const body = bodies.get(id);
  const final = finals.get(id);
  const dist = distToBody(body, expected + 1);
  const W = body.w;
  const H = body.h;
  let ring1 = 0;
  let ring2Painted = 0;
  let unpainted = 0;
  let stray = 0;
  let offColor = 0;
  const strayAt = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = dist[y * W + x];
      if (d === 0) continue; // 本体像素本身：合法，既不是环也不是散点
      const painted = final.alphaAt(x, y) > 200;
      if (d === 1) {
        ring1++;
        if (!painted) unpainted++;
        else {
          const [r, g, b, a] = final.px(x, y);
          if (a !== 255 || r > OUTLINE_RGB[0] || g > OUTLINE_RGB[1] || b > OUTLINE_RGB[2]) offColor++;
        }
      } else if (d === 2) {
        if (painted) {
          ring2Painted++; // 地图图标恒 1px：第 2 圈有画 = 描成 2px
          if (strayAt.length < 5) strayAt.push(`(${x},${y})`);
        }
      } else if (painted) {
        // d === -1（超出 maxD 未达）：环外散点
        stray++;
        if (strayAt.length < 5) strayAt.push(`(${x},${y})`);
      }
    }
  }
  const pass = ring1 > 0 && ring2Painted === 0 && unpainted === 0 && stray === 0 && offColor === 0;
  return { pass, ring1, ring2Painted, unpainted, stray, offColor, strayAt };
}

for (const id of IDS) {
  const r = checkRing(id, 1);
  record('3', `描边环恒 1px 实色 · mon_${id}`, r.pass, {
    name: `mon_${id}`,
    ring1: r.ring1,
    ring2Painted: r.ring2Painted,
    unpainted: r.unpainted,
    stray: r.stray,
    offColor: r.offColor,
    strayAt: r.strayAt.join(' '),
  });
}

/* ---------------------------------------------------------------- 负向对照 N1/N1r */

{
  setMonArtOptions({ outline: false });
  const neg = new Map();
  for (const id of IDS) neg.set(id, buildMonFrame(id));
  setMonArtOptions({ outline: true });
  const bodiesNo = new Map();
  setMonArtOptions({ outline: false });
  for (const id of IDS) bodiesNo.set(id, buildMonFrame(id));
  setMonArtOptions({ outline: true });

  // 用 N1 现场临时换掉 finals/bodies 再跑同一把尺子（stub 不弄脏主现场）
  const savedFinals = new Map(finals);
  const savedBodies = new Map(bodies);
  for (const id of IDS) {
    finals.set(id, neg.get(id));
    bodies.set(id, bodiesNo.get(id));
  }
  const details = [];
  let allRed = true;
  for (const id of IDS) {
    const r = checkRing(id, 1);
    if (r.pass) allRed = false;
    details.push(`mon_${id} ring1=${r.ring1}`);
  }
  record('N1', '负向对照：outline=false 时 [3] 必须红', allRed, details.join('  '));

  // 恢复
  for (const id of IDS) {
    finals.set(id, savedFinals.get(id));
    bodies.set(id, savedBodies.get(id));
  }
  const back = IDS.map((id) => checkRing(id, 1).pass);
  record('N1r', '恢复默认后 [3] 复绿', back.every(Boolean), back.map((v, i) => `mon_${IDS[i]}=${v ? '绿' : '红'}`).join(' '));
}

/* ---------------------------------------------------------------- PNG 编码器（与 b0audit 同口径） */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[o++] = rgba[i];
      raw[o++] = rgba[i + 1];
      raw[o++] = rgba[i + 2];
      raw[o++] = rgba[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** 最近邻放大（k 倍）。 */
function upscale(pb, k) {
  const w = pb.w * k;
  const h = pb.h * k;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = pb.px(Math.floor(x / k), Math.floor(y / k));
      const i = (y * w + x) * 4;
      out[i] = s[0];
      out[i + 1] = s[1];
      out[i + 2] = s[2];
      out[i + 3] = s[3];
    }
  }
  return { w, h, data: out };
}

/* ---------------------------------------------------------------- PNG 导出 */

if (pngDir) {
  mkdirSync(pngDir, { recursive: true });
  let n = 0;
  for (const id of IDS) {
    const pb = finals.get(id);
    writeFileSync(join(pngDir, `mon_${id}.png`), encodePng(upscale(pb, 10)));
    n++;
  }
  console.log(`\nPNG 已导出 → ${pngDir}（${n} 帧 ×10 最近邻放大）`);
}

/* ---------------------------------------------------------------- 汇总 */

console.log('\n' + '='.repeat(72));
const summary = results.map((r) => `[${r.id}] ${r.pass ? 'PASS' : 'FAIL'}`).join('  ');
console.log(`汇总：${summary}`);
if (bad === 0) {
  console.log('结论：TP-4② 地图图标层全过（含 1 组负向对照 + 恢复复绿；退出码证明见 deepstub 日志）');
  console.log('人工项：[5] 的 worstPair 仅是最小值记录；32px 缩略可辨由 TP-8 盲测裁');
} else {
  console.log(`结论：${bad} 项不合格 —— 不要提交`);
}
console.log('='.repeat(72));
process.exit(bad === 0 ? 0 : 1);
