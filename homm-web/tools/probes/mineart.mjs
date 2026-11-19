/**
 * 七种矿的剪影闸门（M9 批）。
 *
 * 量的不是"颜色有几种"，而是"玩家会不会把两个矿认成同一个东西"：
 *   [M1] 7 帧齐、32×42、每帧都有内容（空帧/缺帧不能混过去）
 *   [M2] 两两 alpha 掩码 IoU ≤ 0.75（阈值来自旧版 B1 的"认不认得出"口径）
 *   [M3] 每型一根能被量出来的识别件（不能靠配色凑数）
 *   [M4] 七帧真的注册进图集（`getAtlas().has()`，画了没人用等于没画）
 *   [M5] 负向对照：sameShape=true ⇒ 七型塌成同款帐篷 ⇒ [M2] 必须红
 *
 * 用法：
 *   node tools/probes/mineart.mjs                 # 报告
 *   node tools/probes/mineart.mjs --gate          # 判据（rc=1 = FAIL）
 *   node tools/probes/mineart.mjs --negctrl       # 带负向对照
 *   node tools/probes/mineart.mjs --png=<dir>     # 导出 ×8 单张目检图
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argOf, distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';
import { installShim } from '../_canvas.mjs';
import { encodePng, upscale } from '../_png.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=mineart');
const u = (rel) => distUrl(rel, DIST);
requireFile(DIST, 'render/mineArt.js');
requireFile(DIST, 'render/atlas.js');

const { MINE_KINDS, MINE_ART_SIZE, mineArtName, buildMineArt, setMineArtBreaks, getMineArtBreaks } =
  await import(u('render/mineArt.js'));

const GATE = process.argv.includes('--gate');
const NEGCTRL = process.argv.includes('--negctrl');
const PNG_DIR = argOf('png');
let fails = 0;
function record(id, title, ok, detail = '') {
  if (!ok) fails++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] [${id}] ${title}${detail ? ` — ${detail}` : ''}`);
}

/* ---------------------------------------------------------------- 量具 */
const opaque = (pb, x, y) => pb.alphaAt(x, y) > 8;
function maskOf(pb) {
  const m = new Uint8Array(pb.w * pb.h);
  for (let y = 0; y < pb.h; y++) for (let x = 0; x < pb.w; x++) m[y * pb.w + x] = opaque(pb, x, y) ? 1 : 0;
  return m;
}
function areaOf(m) {
  let n = 0;
  for (const v of m) n += v;
  return n;
}
function bboxOf(pb) {
  let x0 = pb.w, y0 = pb.h, x1 = -1, y1 = -1;
  for (let y = 0; y < pb.h; y++) for (let x = 0; x < pb.w; x++) {
    if (!opaque(pb, x, y)) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function iouOf(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) uni++;
    if (a[i] && b[i]) inter++;
  }
  return uni ? inter / uni : 1;
}
/** 一行上有几段不透明（负向对照的"同款帐篷"会被这条抓到）。 */
function spansAt(pb, y) {
  let n = 0, prev = false;
  for (let x = 0; x < pb.w; x++) {
    const on = opaque(pb, x, y);
    if (on && !prev) n++;
    prev = on;
  }
  return n;
}

const frames = new Map();
for (const k of MINE_KINDS) frames.set(k, buildMineArt(k));

/* ---------------------------------------------------------------- [M1] 覆盖 */
let cover = 0;
for (const k of MINE_KINDS) {
  const pb = frames.get(k);
  const a = areaOf(maskOf(pb));
  if (pb.w === MINE_ART_SIZE.w && pb.h === MINE_ART_SIZE.h && a >= 200) cover++;
  else console.log(`    ${k}: ${pb.w}×${pb.h}, 面积 ${a}`);
}
record('M1', `七帧齐、${MINE_ART_SIZE.w}×${MINE_ART_SIZE.h}、无空帧`, cover === 7, `${cover}/7`);

/* ---------------------------------------------------------------- [M2] 剪影两两分开 */
const masks = new Map([...frames].map(([k, pb]) => [k, maskOf(pb)]));
let worst = { v: -1, a: '', b: '' };
const pairs = [];
for (let i = 0; i < MINE_KINDS.length; i++) {
  for (let j = i + 1; j < MINE_KINDS.length; j++) {
    const a = MINE_KINDS[i], b = MINE_KINDS[j];
    const v = iouOf(masks.get(a), masks.get(b));
    pairs.push({ a, b, v });
    if (v > worst.v) worst = { v, a, b };
  }
}
for (const p of pairs) console.log(`    IoU ${p.a.padEnd(8)} × ${p.b.padEnd(8)} = ${p.v.toFixed(3)}`);
record('M2', '任意两型剪影 IoU ≤ 0.75', worst.v <= 0.75,
  `max ${worst.v.toFixed(3)} (${worst.a}/${worst.b})`);

/* ---------------------------------------------------------------- [M3] 识别件 */
const FEATURES = {
  gold: (pb, bb) => bb.y0 <= 14 && spansAt(pb, 15) === 2,          // 两座金锭尖堆
  wood: (pb) => spansAt(pb, 14) === 2,                            // 两根剥皮原木
  ore: (pb, bb) => bb.w >= 30 && bb.y0 >= 11 && bb.y0 <= 14 && spansAt(pb, 22) === 1, // 宽阶梯崖壁
  gem: (pb) => spansAt(pb, 12) >= 2,                              // 三根晶簇
  crystal: (pb) => spansAt(pb, 10) >= 2 && spansAt(pb, 20) >= 3,  // 五根分离晶柱
  sulfur: (pb, bb) => bb.y0 <= 5 && spansAt(pb, 17) === 1,        // 细颈喷口
  mercury: (pb, bb) => bb.y0 >= 15 && bb.w >= 28,                 // 矮而宽的双罐浅池
};
for (const k of MINE_KINDS) {
  const pb = frames.get(k);
  const ok = FEATURES[k](pb, bboxOf(pb));
  record('M3', `${k} 的识别件可量`, ok, `bbox ${JSON.stringify(bboxOf(pb))}`);
}

/* ---------------------------------------------------------------- [M4] 图集接线 */
installShim();
const { getAtlas } = await import(u('render/atlas.js'));
const atlas = getAtlas();
const registered = MINE_KINDS.filter((k) => atlas.has(mineArtName(k)));
record('M4', '七帧都注册进冒险图集（画了有人用）', registered.length === 7, `${registered.length}/7`);

/* ---------------------------------------------------------------- [M5] 负向对照 */
if (NEGCTRL) {
  setMineArtBreaks({ sameShape: true });
  const a = maskOf(buildMineArt('gold'));
  const b = maskOf(buildMineArt('mercury'));
  const v = iouOf(a, b);
  record('N1', '同款帐篷负向对照：IoU 必须 > 0.75（闸门有分辨力）', v > 0.75, `IoU ${v.toFixed(3)}`);
  setMineArtBreaks({ sameShape: false });
}

/* ---------------------------------------------------------------- ×8 目检图 */
if (PNG_DIR) {
  mkdirSync(PNG_DIR, { recursive: true });
  for (const k of MINE_KINDS) {
    const big = upscale(frames.get(k), 8);
    writeFileSync(join(PNG_DIR, `mine-${k}-x8.png`), encodePng(big));
  }
  console.log(`×8 单张目检图已写入 ${PNG_DIR}`);
}

console.log(`\n共 ${pairs.length} 对；最大 IoU ${worst.v.toFixed(3)} (${worst.a}/${worst.b})。`);
if (GATE) process.exit(fails === 0 ? 0 : 1);
