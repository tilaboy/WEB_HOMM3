/**
 * 第十版「骨架级重画」闸门。
 *
 * 第九版只换建材和屋顶贴件，用户看满城对照表仍说"建筑风格差别不大"：
 * 16 座方块房 + 屋顶叶冠/尖齿/骨肋，本质还是一个人类村。第十版把**建筑本体**
 * 按族重画：p2 熔岩洞口、p3 活木树腔、p4 石椁尖拱墓门。
 *
 * 本门只量"身体"不量"屋顶皮肤"：
 *   [K1] 16 座 × 3 族，每座在身体带（y42..64）里都有本族**空腔色**的真实像素；
 *        皮肤版 skeletonSkinOnly 的同一判据必须全归零（否则量的是贴件）。
 *   [K2] 族别结构 token 在身体带成片出现（≥3000/16 座），皮肤版必须少一个数量级。
 *   [K3] 身体剪影与 p1 不同（max IoU ≤0.995），且四族 64 座身体两两不全同。
 *   [K4] 负向 sameWorld：三族身体逐像素塌回 p1、空腔与 token 全归零。
 *
 * 用法：node tools/probes/townskeleton.mjs [--gate]
 */
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';
import { installShim } from '../_canvas.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=townskeleton');
const u = (rel) => distUrl(rel, DIST);
requireFile(DIST, 'render/townSceneArt.js');
const GATE = process.argv.includes('--gate');
let fails = 0;
function record(id, title, ok, detail = '') {
  if (!ok) fails++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] [${id}] ${title}${detail ? ` — ${detail}` : ''}`);
}

installShim();
const {
  buildSceneBuilding, setSceneArtBreaks,
  TOWN_BUILDING_IDS: IDS, TOWN_WORLD_TOKENS: T,
  TOWN_SKELETON_CAVITY: CAVITY, TOWN_SKELETON_MATERIAL: BODY_MAT,
} = await import(u('render/townSceneArt.js'));
const OWNERS = ['p1', 'p2', 'p3', 'p4'];
const RACES = ['p2', 'p3', 'p4'];
/** 身体带：避开屋顶皮肤（y<42）和根脚/墓碑（y>64），只看墙/洞/腔本身。 */
const BAND = [10, 70, 42, 64];
function rgb(hex) {
  const h = hex.slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function countColor(pb, colors, region = BAND, tol = 4) {
  const cs = colors.map(rgb);
  let n = 0;
  for (let y = region[2]; y < region[3]; y++) for (let x = region[0]; x < region[1]; x++) {
    const p = pb.px(x, y);
    if (p[3] <= 8) continue;
    if (cs.some(([r, g, b]) => Math.abs(p[0] - r) + Math.abs(p[1] - g) + Math.abs(p[2] - b) <= tol)) n++;
  }
  return n;
}
function maskIoU(a, b) {
  let inter = 0, union = 0;
  for (let y = BAND[2]; y < BAND[3]; y++) for (let x = BAND[0]; x < BAND[1]; x++) {
    const av = a.alphaAt(x, y) > 8, bv = b.alphaAt(x, y) > 8;
    if (av && bv) inter++;
    if (av || bv) union++;
  }
  return union ? inter / union : 1;
}
function sample(breaks) {
  setSceneArtBreaks({ skeletonSkinOnly: false, sameWorld: false, sameShape: false, ...breaks });
  const b = Object.fromEntries(OWNERS.map((o) => [o, Object.fromEntries(
    IDS.map((id) => [id, buildSceneBuilding(o, id, 1, 0)]))]));
  const cav = Object.fromEntries(RACES.map((o) => [o, IDS.map((id) => countColor(b[o][id], [CAVITY[o]]))]));
  const tok = Object.fromEntries(RACES.map((o) => [o, IDS.reduce((s, id) => s + countColor(b[o][id], BODY_MAT[o]), 0)]));
  return { b, cav, tok };
}

try {
  const normal = sample({});
  for (const o of RACES) console.log(`[读数] ${o} 身体空腔 ${normal.cav[o].join(',')} · token ${normal.tok[o]}`);

  record('K1', '16 座 × 3 族：每座建筑身体里都有本族空腔（不是只有屋顶贴件）',
    RACES.every((o) => normal.cav[o].every((n) => n > 0)),
    RACES.map((o) => `${o} 零腔 ${normal.cav[o].filter((n) => n === 0).length}/16`).join(' · '));

  const minCav = Math.min(...RACES.flatMap((o) => normal.cav[o].filter((n) => n > 0)));
  record('K2', '族别结构 token 在身体带成片出现（≥3000/16 座）',
    RACES.every((o) => normal.tok[o] >= 3000),
    RACES.map((o) => `${o} ${normal.tok[o]}`).join(' · ') + ` · 最小非空腔 ${minCav}px`);

  const bodyIoU = RACES.map((o) => Math.max(...IDS.map((id) => maskIoU(normal.b.p1[id], normal.b[o][id]))));
  let notSame = 0;
  for (const o of RACES) for (const id of IDS) if (maskIoU(normal.b.p1[id], normal.b[o][id]) < 0.995) notSame++;
  record('K3', '身体剪影与人类骨架分家（max IoU ≤0.995，48/48 座不同）',
    bodyIoU.every((v) => v <= 0.995) && notSame === 48,
    `max ${bodyIoU.map((v) => v.toFixed(3))} · 不同 ${notSame}/48`);

  // 负向一：只把骨架退回人类方盒、保留第九版屋顶皮肤 —— 身体判据必须全塌
  const skin = sample({ skeletonSkinOnly: true });
  const skinCavSum = RACES.map((o) => skin.cav[o].reduce((a, b) => a + b, 0));
  const skinTokenRatio = RACES.map((o) => normal.tok[o] / Math.max(1, skin.tok[o]));
  const skinIoU = RACES.map((o) => Math.max(...IDS.map((id) => maskIoU(skin.b.p1[id], skin.b[o][id]))));
  record('N-K1', 'skeletonSkinOnly 负向臂：身体空腔必须全部归零（K1 量的不是屋顶贴件）',
    skinCavSum.every((n) => n === 0), `空腔合计 ${skinCavSum.join('/')}`);
  record('N-K2', 'skeletonSkinOnly 负向臂：结构 token 少一个数量级、身体剪影塌回 p1',
    skinTokenRatio.every((r) => r >= 5) && skinIoU.every((v) => v > 0.999),
    `token 倍数 ${skinTokenRatio.map((r) => r.toFixed(1))} · body IoU ${skinIoU.map((v) => v.toFixed(3))}`);

  // 负向二：连底子与骨架一起塌回 p1 —— 逐像素相同
  const flat = sample({ sameWorld: true });
  // sameWorld 只塌骨架与皮肤，不塌阵营色板（与 N-B 同口径）：量剪影不量 RGB。
  const flatIoU = RACES.map((o) => Math.min(...IDS.map((id) => maskIoU(flat.b.p1[id], flat.b[o][id]))));
  const flatCav = RACES.map((o) => flat.cav[o].reduce((a, b) => a + b, 0));
  const flatMat = RACES.map((o) => IDS.reduce((s, id) => s + countColor(flat.b[o][id], BODY_MAT[o]), 0));
  record('N-K3', 'sameWorld 负向臂：四族身体剪影塌回 p1、空腔与骨架建材归零',
    flatIoU.every((v) => v > 0.999) && flatCav.every((n) => n === 0) && flatMat.every((n) => n < 600),
    `min body IoU ${flatIoU.map((v) => v.toFixed(3))} · 空腔 ${flatCav.join('/')} · 建材 ${flatMat.join('/')}`);
} finally {
  setSceneArtBreaks({ skeletonSkinOnly: false, sameWorld: false, sameShape: false });
}

console.log(`\n合计：${fails === 0 ? '全过' : `${fails} 条 FAIL`}`);
if (GATE && fails > 0) process.exitCode = 1;
