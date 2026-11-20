/**
 * 第九版「族别世界」闸门：证明的不是"四族换了主色"，而是三族各住进自己的地貌。
 *
 * ① 背景：p2 必须画出火山口 / 熔岩瀑 / 地穴，p3 必须是一棵大树（树冠吃掉天空、
 *    主干和根系贯穿画面），p4 必须是墓园（碑林 / 枯树 / 坟包）。判据只数实现里
 *    真正下笔的 `TOWN_WORLD_TOKENS`，区域限定在城心两侧与天空，免得城心建筑蒙混过关。
 * ② 建筑：16 间老方盒子在世界重染 + 族别皮肤后，屋顶剪影与族别色token必须变化，
 *    p1 不得串到别族的token。
 * ③ 负向臂 `sameWorld`：四族背景逐像素塌回 p1 山丘、建筑剪影 IoU=1、族别token归零。
 *    门若恒绿，先把这个臂跑起来看它红不红。
 *
 * 用法：node tools/probes/townworld.mjs [--gate]
 */
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';
import { installShim } from '../_canvas.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=townworld');
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
  buildSceneBuilding, buildTownBase, setSceneArtBreaks, TOWN_WORLD_TOKENS: T,
} = await import(u('render/townSceneArt.js'));
const OWNERS = ['p1', 'p2', 'p3', 'p4'];
const W = 832, H = 275;
const IDS = ['tavern', 'market', 'townhall', 'workshop', 'dwell1', 'dwell3', 'guild3'];

function rgb(hex) {
  const h = hex.slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** 数精确色（允许小容差）：判据只认实现导出的 token，不自带一份色表。 */
function countColor(pb, color, region = () => true, tol = 0) {
  const [r, g, b] = rgb(color);
  let n = 0;
  for (let y = 0; y < pb.h; y++) for (let x = 0; x < pb.w; x++) {
    if (!region(x, y)) continue;
    const p = pb.px(x, y);
    if (Math.abs(p[0] - r) <= tol && Math.abs(p[1] - g) <= tol && Math.abs(p[2] - b) <= tol) n++;
  }
  return n;
}
function maskIoU(a, b) {
  let inter = 0, uni = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const av = a.alphaAt(x, y) > 8, bv = b.alphaAt(x, y) > 8;
    if (av && bv) inter++;
    if (av || bv) uni++;
  }
  return uni ? inter / uni : 1;
}
function pixelDiff(a, b) {
  let n = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const p = a.px(x, y), q = b.px(x, y);
    if (p[0] !== q[0] || p[1] !== q[1] || p[2] !== q[2] || p[3] !== q[3]) n++;
  }
  return n;
}
const SKY = (x, y) => y < H * 0.40;
const EDGE = (x, y) => (x < W * 0.17 || x > W * 0.83) && y >= H * 0.38 && y < H * 0.92;

function backgroundCounts(pb) {
  return {
    lavaSky: countColor(pb, T.lava, SKY),
    basalt: countColor(pb, T.basalt),
    cave: countColor(pb, T.cave, EDGE),
    canopySky: countColor(pb, T.canopy, SKY) + countColor(pb, T.leafLite, SKY),
    barkEdge: countColor(pb, T.bark, EDGE),
    graveSky: countColor(pb, T.grave, SKY) + countColor(pb, T.graveDark, SKY),
    deadWood: countColor(pb, T.deadWood, SKY),
    graveEdge: countColor(pb, T.grave, EDGE) + countColor(pb, T.graveDark, EDGE),
  };
}
const sum = (o, keys) => keys.reduce((s, k) => s + (o[k] ?? 0), 0);

try {
  setSceneArtBreaks({ sameWorld: false, sameBase: false, flatCastle: false, sameTone: false, noStreet: false });
  const bg = Object.fromEntries(OWNERS.map((o) => [o, buildTownBase(o, W, H)]));
  const bc = Object.fromEntries(OWNERS.map((o) => [o, backgroundCounts(bg[o])]));
  for (const o of OWNERS) {
    console.log(`[读数] ${o} 背景 ${JSON.stringify(bc[o])}`);
  }
  const p1 = bc.p1;
  record('W1', 'p2 天空有火山口熔岩、地面有玄武岩与地穴',
    bc.p2.lavaSky > p1.lavaSky + 40 && bc.p2.basalt > p1.basalt + 300 && bc.p2.cave > p1.cave + 60,
    `熔岩 ${bc.p2.lavaSky}/${p1.lavaSky} · 玄武 ${bc.p2.basalt}/${p1.basalt} · 洞穴 ${bc.p2.cave}/${p1.cave}`);
  record('W2', 'p3 天空被树冠占满、边缘看得到主干根系',
    bc.p3.canopySky > p1.canopySky + 3000 && bc.p3.barkEdge > p1.barkEdge + 1200,
    `树冠 ${bc.p3.canopySky}/${p1.canopySky} · 树皮 ${bc.p3.barkEdge}/${p1.barkEdge}`);
  record('W3', 'p4 墓碑林 / 枯树 / 坟包成片',
    bc.p4.graveSky + bc.p4.graveEdge > p1.graveSky + p1.graveEdge + 300 &&
    bc.p4.deadWood > p1.deadWood + 80,
    `墓碑 天空${bc.p4.graveSky}/边${bc.p4.graveEdge} · 枯树 ${bc.p4.deadWood}/${p1.deadWood}`);
  record('W4', '别族地貌不串味（p1 天空没有树冠 / 熔岩 / 墓碑）',
    p1.lavaSky < 40 && p1.canopySky < 200 && p1.graveSky < 200,
    `熔岩${p1.lavaSky} · 树冠${p1.canopySky} · 墓碑${p1.graveSky}`);

  // 建筑皮肤：token 计数按 7 座求和，IoU 量剪影变化（不是一个色差）
  const build = Object.fromEntries(OWNERS.map((o) => [o, Object.fromEntries(IDS.map((id) => [id, buildSceneBuilding(o, id, 2, 0)]))]));
  const tokens = { p2: [T.lava, T.basalt], p3: [T.canopy, T.leafLite, T.bark], p4: [T.bone, T.grave, T.soul] };
  const btok = (o) => IDS.reduce((s, id) => s + tokens[o].reduce((n, c) => n + countColor(build[o][id], c), 0), 0);
  const baseTok = Object.fromEntries(OWNERS.map((o) => [o, o === 'p1'
    ? IDS.reduce((s, id) => s + Object.values(tokens).flat().reduce((n, c) => n + countColor(build.p1[id], c), 0), 0)
    : btok(o)]));
  console.log(`[读数] 建筑族别token ${JSON.stringify(baseTok)}`);
  for (const o of ['p2', 'p3', 'p4']) {
    const ious = IDS.map((id) => maskIoU(build.p1[id], build[o][id]));
    const minIoU = Math.min(...ious);
    record(`B-${o}`, `${o} 建筑不是换色的方盒（剪影变形 + 族别构件）`,
      baseTok[o] > baseTok.p1 + 150 && minIoU < 0.88,
      `token ${baseTok[o]}/${baseTok.p1} · 最小剪影 IoU ${minIoU.toFixed(3)}`);
  }

  // 负向臂：世界与皮肤一起塌回 p1，四张底子逐像素相同、建筑剪影 IoU=1
  setSceneArtBreaks({ sameWorld: true });
  const negBg = Object.fromEntries(OWNERS.map((o) => [o, buildTownBase(o, W, H)]));
  const negDiff = Object.fromEntries(OWNERS.map((o) => [o, pixelDiff(bg.p1, negBg[o])]));
  record('N-W', 'sameWorld 负向臂：四族底子逐像素塌回 p1',
    OWNERS.every((o) => negDiff[o] === 0), JSON.stringify(negDiff));
  const negB = Object.fromEntries(OWNERS.map((o) => [o, buildSceneBuilding(o, 'tavern', 2, 0)]));
  const negIoU = Object.fromEntries(['p2', 'p3', 'p4'].map((o) => [o, maskIoU(negB.p1, negB[o])]));
  record('N-B', 'sameWorld 负向臂：族别皮肤拿掉后剪影全同',
    Object.values(negIoU).every((v) => v > 0.999), JSON.stringify(negIoU));
} finally {
  setSceneArtBreaks({ sameWorld: false });
}

console.log(`\n合计：${fails === 0 ? '全过' : `${fails} 条 FAIL`}`);
if (GATE && fails > 0) process.exitCode = 1;
