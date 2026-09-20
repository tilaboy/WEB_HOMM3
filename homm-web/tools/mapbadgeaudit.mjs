#!/usr/bin/env node
/**
 * 地图「队伍徽标」探针（D-64「地图单位接地图」· `in-game-ia.md §13.5`）—— Node，无需浏览器。
 *
 * 组：
 *   A  帧完整性（保留）    —— 每个 `kind==='map'` 帧的可见剪影整体落在槽位内（无横向裁切），
 *                            相对目标格左右外扩**量** ≤8px/侧、且**对称**（|左 − 右| ≤ 1px）。
 *                            （承自已退役的 `mapunitambiguity.mjs`，为其**超集** ⇒ 退役不丢守卫：
 *                             只判对称不判量，会漏放"两侧都越 9px 但仍对称"的帧。）
 *   B′ 信息层不改变命中    —— `worldToGrid` / `pick` 与"画了什么"无关：
 *                            静态（输入模块不含徽标数据）+ 动态（徽标覆盖的每个像素 pick 逐像素恒等）。
 *   C  地盘标记            —— **已撤销**（徽标不占格 ⇒ 无地盘、无实体）⇒ 无断言。
 *   D  布局不遮物（§13.4） —— 选侧 / 只落"无信息"格 / 落不下就不画；
 *                            徽标不得遮住任何"有信息"的像素（邻格物件 ∪ mk_* ∪ 英雄棋子主体）。
 *
 * 复用：dist/render/unitArt.js（UNIT_FRAMES + buildB0Frame）、dist/render/ortho.js（TILE/worldToGrid）、
 *       dist/render/mapBadge.js（§13.4 布局，**与渲染层同源**）、dist/render/camera.js（pick）。
 * 剪影口径与 audit:b0 一致：**含 1px 描边的可见像素**（alpha > 8）。
 *
 * 退出码：0 = 全 PASS；1 = 有断言失败；2 = 前置条件不成立（帧表 / 规格结构被改）。
 */
import fs from 'node:fs';
import { UNIT_FRAMES, buildB0Frame } from '../dist/render/unitArt.js';
import { TILE, worldToGrid } from '../dist/render/ortho.js';
import { Camera } from '../dist/render/camera.js';
import { chooseBadgeSide, badgeBBoxAt, bboxOverlaps } from '../dist/render/mapBadge.js';

let fails = 0;
const line = (s) => process.stdout.write(s + '\n');
const ok = (cond, msg) => {
  line(`[${cond ? 'PASS' : 'FAIL'}] ${msg}`);
  if (!cond) fails++;
};

/** 可见剪影 bbox（含描边；alpha>8 视为实心），与 audit:b0 的 bodyBox 同口径。 */
function silhouette(pb) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < pb.h; y++) {
    for (let x = 0; x < pb.w; x++) {
      if (pb.px(x, y)[3] <= 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < x0 ? null : { x0, x1, y0, y1 };
}

/**
 * 英雄棋子剪影偏移 —— **从真实 `hero_<owner>` 帧派生**，不手写常量（防"常量随美术漂"）。
 *
 * 为什么要垫片：hero 帧由 atlas.ts 的 DOM 构建器产出，Node 里没有 DOM/canvas。
 * 这里垫一个**最小 canvas/DOM 垫片**（同 tools/atlasaudit.mjs），只为读回帧的像素。
 * 口径 = **整枚棋子剪影**（含 1px 描边、含右上旗帜）—— 比"主体不含旗"更**保守**，
 * 且与 §13.3 M2′「徽标不得遮住英雄棋子」一致（排除旗会有"遮住旗却判绿"的盲区）。
 */
async function measureHeroOffsets() {
  class StubCtx {
    constructor(c) { this.canvas = c; }
    putImageData(img) { this.canvas._img = img; }
    drawImage(src, dx = 0, dy = 0) {
      const dst = this.canvas;
      if (!dst._buf) dst._buf = new Uint8ClampedArray(dst.width * dst.height * 4);
      if (!src || !src._img) return;
      const sw = src._img.width;
      const sh = src._img.height;
      const sd = src._img.data;
      for (let yy = 0; yy < sh; yy++) {
        for (let xx = 0; xx < sw; xx++) {
          const tx = dx + xx;
          const ty = dy + yy;
          if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
          const si = (yy * sw + xx) * 4;
          const di = (ty * dst.width + tx) * 4;
          dst._buf[di] = sd[si]; dst._buf[di + 1] = sd[si + 1]; dst._buf[di + 2] = sd[si + 2]; dst._buf[di + 3] = sd[si + 3];
        }
      }
    }
    getImageData(x, y, w, h) { return new globalThis.ImageData(new Uint8ClampedArray(w * h * 4), w, h); }
    fillRect() {} clearRect() {} save() {} restore() {} translate() {} scale() {}
  }
  class StubCanvas {
    constructor() { this.width = 0; this.height = 0; this.style = {}; this._ctx = new StubCtx(this); }
    getContext() { return this._ctx; }
    toDataURL() { return ''; }
  }
  const prevDoc = globalThis.document;
  const prevImg = globalThis.ImageData;
  globalThis.ImageData = class ImageData {
    constructor(d, w, h) { this.data = d; this.width = w; this.height = h; }
  };
  globalThis.document = { createElement: () => new StubCanvas() };
  try {
    const { Atlas } = await import('../dist/render/atlas.js');
    const atlas = Atlas.build();
    const buf = atlas.canvas._buf;
    const AW = atlas.canvas.width;
    let u = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const seen = [];
    for (const owner of ['p1', 'p2', 'p3', 'p4', 'neutral']) {
      const F = atlas.get(`hero_${owner}`);
      if (!F) {
        console.error(`[mapbadgeaudit] 缺 hero_${owner} 帧 —— 前置条件不成立。`);
        process.exit(2);
      }
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let y = 0; y < F.h; y++) {
        for (let x = 0; x < F.w; x++) {
          if (buf[((F.y + y) * AW + (F.x + x)) * 4 + 3] <= 8) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      if (x1 < x0) {
        console.error(`[mapbadgeaudit] hero_${owner} 剪影为空 —— 前置条件不成立。`);
        process.exit(2);
      }
      seen.push({ owner, x0, x1, y0, y1, ax: F.ax, ay: F.ay });
      u = { x0: Math.min(u.x0, x0), x1: Math.max(u.x1, x1), y0: Math.min(u.y0, y0), y1: Math.max(u.y1, y1) };
    }
    const a = seen[0];
    const same = seen.every((s) => s.x0 === a.x0 && s.x1 === a.x1 && s.y0 === a.y0 && s.y1 === a.y1 && s.ax === a.ax && s.ay === a.ay);
    if (!same) line(`[WARN] hero_<owner> 各帧几何不一致（已取并集）—— ${JSON.stringify(seen)}`);
    line(`英雄棋子帧几何（真实帧派生）：owner×${seen.length} ax=${a.ax} ay=${a.ay} 剪影 x[${u.x0},${u.x1}] y[${u.y0},${u.y1}]`);
    return { dx0: u.x0 + a.ax, dy0: u.y0 + a.ay, dx1: u.x1 + a.ax, dy1: u.y1 + a.ay };
  } finally {
    if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
    if (prevImg === undefined) delete globalThis.ImageData; else globalThis.ImageData = prevImg;
  }
}

const mapFrames = UNIT_FRAMES.filter((f) => f.kind === 'map');
if (mapFrames.length === 0) {
  console.error('[mapbadgeaudit] 帧表里没有 kind=map 的帧 —— UNIT_FRAMES 结构可能变了，前置条件不成立。');
  process.exit(2);
}

/** 徽标源：真实 `u_*_map` 剪影（非占位）。 */
const badges = [];
for (const f of mapFrames) {
  const pb = buildB0Frame(f.name, true);
  const sil = silhouette(pb);
  if (!sil) {
    console.error(`[mapbadgeaudit] ${f.name} 剪影为空 —— 前置条件不成立。`);
    process.exit(2);
  }
  // 前提（#3 · S3 帧内居中）：徽标几何假设"剪影在帧内居中" —— `ax=(TILE−w)/2` 只把**画布**居中；
  // 若剪影自身偏离帧心，则"落到哪格就按那格居中贴地"不成立 ⇒ 该帧的"徽标 OK"无效（见 A′）。
  const silCx = (sil.x0 + sil.x1) / 2;
  const frameCx = (pb.w - 1) / 2;
  const centerDev = Math.abs(silCx - frameCx);
  badges.push({ name: f.name, frame: { w: pb.w, h: pb.h, ax: f.ax, ay: f.ay, sil }, centerDev, centerOk: centerDev <= 1 });
}
line(`徽标源：${badges.length} 个 kind=map 帧（画布 ${badges[0].frame.w}×${badges[0].frame.h} · TILE=${TILE}）`);

/** 英雄棋子剪影偏移（相对英雄格；从真实 hero_<owner> 帧派生）。见 measureHeroOffsets()。 */
const heroOffsets = await measureHeroOffsets();

/* ============================ A · 帧完整性 ============================ */
// 越界**量**上限（px/侧）：承自已退役的 `mapunitambiguity.mjs`（art-director 裁定，§13.0 写明
// "仍在「≤8px/侧」上限内"）。只判"对称"不判"量"会漏放"两侧都越 9px 但对称"的帧 ⇒ 两条都要。
const LEFT_CAP = 8;
const RIGHT_CAP = 8;
const ASYM_CAP = 1;
line('\n=== A 帧完整性（剪影在槽位内 + 左右越界 ≤8px/侧 + 对称 ≤1px）===');
{
  let aBad = 0;
  for (const b of badges) {
    const { frame, name } = b;
    const { sil } = frame;
    const withinSlot = sil.x0 >= 0 && sil.x1 <= frame.w - 1; // 无横向裁切
    const leftOvh = Math.max(0, -(frame.ax + sil.x0));
    const rightOvh = Math.max(0, frame.ax + sil.x1 - TILE);
    const sym = Math.abs(leftOvh - rightOvh);
    const pass = withinSlot && leftOvh <= LEFT_CAP && rightOvh <= RIGHT_CAP && sym <= ASYM_CAP;
    if (!pass) {
      aBad++;
      line(
        `[FAIL] ${name}  剪影 x[${sil.x0},${sil.x1}] 在槽位内=${withinSlot} 左越 ${leftOvh}(≤${LEFT_CAP}) 右越 ${rightOvh}(≤${RIGHT_CAP}) |Δ| ${sym}(≤${ASYM_CAP})`,
      );
    }
  }
  ok(aBad === 0, `A：${badges.length} 帧剪影在槽位内、左右越界 ≤${LEFT_CAP}/${RIGHT_CAP}、对称 ≤${ASYM_CAP}（失败 ${aBad}）`);
}

/* ============ A′ 前提：帧内居中（S3）—— 徽标几何的前提（team-lead #3 判据）============ */
line('\n=== A′ 前提：剪影中心 = 帧中心 ±1px（S3 帧内居中；不满足 ⇒ 该帧不得报"徽标 OK"）===');
{
  let preBad = 0;
  for (const b of badges) {
    if (b.centerOk) continue;
    preBad++;
    const s = b.frame.sil;
    line(
      `[FAIL] 前提违反 ${b.name}  剪影中心 ${((s.x0 + s.x1) / 2).toFixed(1)} vs 帧中心 ${((b.frame.w - 1) / 2).toFixed(1)} ⇒ 偏差 ${b.centerDev.toFixed(1)}px > 1`,
    );
  }
  ok(preBad === 0, `A′：${badges.length} 帧剪影在帧内居中（偏差 ≤1px · S3）（违反 ${preBad}）`);
}

/* ============================ B′ · 信息层不改变命中 ============================ */
line('\n=== B′ 信息层不改变命中 ===');
{
  const readDist = (rel) => fs.readFileSync(new URL(`../dist/render/${rel}`, import.meta.url), 'utf8');
  const inputSrc = [readDist('camera.js'), readDist('ortho.js')].join('\n');
  ok(!/badge|u_[a-z0-9_]+_map/i.test(inputSrc), 'B′静态：camera.js / ortho.js 不含徽标 / u_*_map 引用（输入不吃渲染数据）');

  ok(
    typeof worldToGrid === 'function' && worldToGrid.length === 2,
    `B′契约：worldToGrid 只接受 (wx,wy)（arity=${typeof worldToGrid === 'function' ? worldToGrid.length : 'n/a'}）`,
  );

  // 动态回归守卫：徽标覆盖的每个像素，pick 的结果与"不画徽标"逐像素相等（纯函数 ⇒ 恒真，防"吸附徽标"回归）。
  const bb = badgeBBoxAt(badges[0].frame, 7, 4);
  let pixOk = true;
  outer: for (let wy = bb.y0; wy <= bb.y1; wy++) {
    for (let wx = bb.x0; wx <= bb.x1; wx++) {
      const g1 = worldToGrid(wx, wy);
      const g2 = worldToGrid(wx, wy);
      if (g1.x !== g2.x || g1.y !== g2.y) { pixOk = false; break outer; }
      if (g1.x !== Math.floor(wx / TILE) || g1.y !== Math.floor(wy / TILE)) { pixOk = false; break outer; }
    }
  }
  ok(pixOk, 'B′动态：徽标覆盖范围内 pick 逐像素恒等，且等于 floor(wx/TILE)（与"画了什么"无关）');

  const cam = new Camera();
  cam.x = 0;
  cam.y = 0;
  cam.zoom = 1;
  let pickOk = true;
  for (let sx = 0; sx < 220; sx += 7) {
    for (let sy = 0; sy < 220; sy += 13) {
      const g = cam.pick(sx, sy);
      const w = cam.screenToWorld(sx, sy);
      if (g.x !== Math.floor(w.wx / TILE) || g.y !== Math.floor(w.wy / TILE)) pickOk = false;
    }
  }
  ok(pickOk, 'B′：camera.pick 仅由屏幕坐标决定（徽标不是命中目标）');
}

/* ============================ C · 地盘标记 ============================ */
line('\n=== C 地盘标记 ===');
line('  —— 已撤销（徽标不占格 ⇒ 无地盘、无实体）⇒ 无断言。');

/* ============================ D · 布局不遮物 ============================ */
line('\n=== D 布局不遮物（§13.4 三规则）===');
{
  const HX = 5;
  const HY = 5;
  const SIDES = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] };
  const cellOf = (side) => ({ x: HX + SIDES[side][0], y: HY + SIDES[side][1] });

  // 邻格实体（§13.0 · atlas.ts 构建器）。
  const objBBox = (cx, cy) => ({ x0: cx * TILE, y0: cy * TILE, x1: cx * TILE + TILE - 1, y1: cy * TILE + TILE - 1 });
  const mkBBox = (cx, cy) => ({ x0: cx * TILE + 17, y0: cy * TILE + 17, x1: cx * TILE + 32, y1: cy * TILE + 32 });
  // 英雄棋子剪影（**从真实帧派生**，见 measureHeroOffsets()）—— 相对英雄格的像素偏移。
  // 注意：棋子帧 ay=−12 ⇒ 剪影上探自身格 12px，这是 D 组的关键几何（上/下邻格会被否决）。
  const heroBody = () => ({
    x0: HX * TILE + heroOffsets.dx0,
    y0: HY * TILE + heroOffsets.dy0,
    x1: HX * TILE + heroOffsets.dx1,
    y1: HY * TILE + heroOffsets.dy1,
  });

  // 英雄本体作为障碍一起传（否则上/下会压棋子 —— 见 mapBadge.ts 的说明）。
  const choose = (frame, obstacles) => chooseBadgeSide(HX, HY, frame, obstacles, heroBody());

  const ORDER = ['right', 'left', 'up', 'down'];
  // 某侧是否"可落"：徽标既不碰邻格实体、也不碰英雄主体。
  const validSide = (frame, side, obstacles) => {
    const c = cellOf(side);
    const bb = badgeBBoxAt(frame, c.x, c.y);
    return !obstacles.some((e) => bboxOverlaps(bb, e)) && !bboxOverlaps(bb, heroBody());
  };

  const scenarios = [
    ['全空', {}],
    ['仅右被占', { right: objBBox }],
    ['仅右有 guard 标记', { right: mkBBox }],
    ['仅下被占', { down: objBBox }],
    ['右+左被占', { right: objBBox, left: objBBox }],
    ['右+左+上被占', { right: objBBox, left: objBBox, up: objBBox }],
    ['四邻皆占', { right: objBBox, left: objBBox, up: objBBox, down: objBBox }],
  ];

  for (const [label, occ] of scenarios) {
    const obstacles = [];
    for (const side of Object.keys(occ)) {
      const c = cellOf(side);
      obstacles.push(occ[side](c.x, c.y));
    }
    let orderBad = 0;
    let occBad = 0;
    for (const b of badges) {
      const got = choose(b.frame, obstacles);
      const firstValid = ORDER.find((s) => validSide(b.frame, s, obstacles)) ?? null;
      // ① 落点 = 右→左→上→下 中**第一个可落**的侧（含"都不行 ⇒ 不画"）
      if (got !== firstValid) {
        orderBad++;
        if (orderBad <= 2) line(`        ↳ ${b.name} 落点 ${got} ≠ 首选可落 ${firstValid}`);
      }
      // ② 落点不遮物（邻格实体 ∪ 英雄主体）
      if (got !== null && !validSide(b.frame, got, obstacles)) {
        occBad++;
        if (occBad <= 2) line(`        ↳ ${b.name} 落点 ${got} 遮物`);
      }
    }
    ok(orderBad === 0 && occBad === 0, `D[${label}] 选侧错 ${orderBad}/${badges.length} · 遮物 ${occBad}/${badges.length}`);
  }

  // 记录：为什么必须把英雄本体当障碍（把 §13.4 字面实体集与 D 断言的矛盾钉成机检事实）。
  let upOccl = 0;
  for (const b of badges) {
    const c = cellOf('up');
    if (bboxOverlaps(badgeBBoxAt(b.frame, c.x, c.y), heroBody())) upOccl++;
  }
  line(`\n[信息] §13.4 规则 1 的**字面**实体集不含英雄自身 ⇒ 上邻落点会压住棋子本体：${upOccl}/${badges.length} 帧（主断言已按自洽读法把英雄并入障碍集）。`);
}

/* ============================ 自检（判据有分辨力）============================ */
if (process.argv.includes('--self-test')) {
  line('\n=== 自检：D 判据有分辨力 ===');
  const HX = 5;
  const HY = 5;
  const frame = badges[0].frame;
  const heroBody = {
    x0: HX * TILE + heroOffsets.dx0,
    y0: HY * TILE + heroOffsets.dy0,
    x1: HX * TILE + heroOffsets.dx1,
    y1: HY * TILE + heroOffsets.dy1,
  };
  const rc = { x: HX + 1, y: HY };
  const obstacles = [{ x0: rc.x * TILE, y0: rc.y * TILE, x1: rc.x * TILE + TILE - 1, y1: rc.y * TILE + TILE - 1 }];
  const dOk = (side) => {
    if (side === null) return true;
    const dx = side === 'right' ? 1 : side === 'left' ? -1 : 0;
    const dy = side === 'up' ? -1 : side === 'down' ? 1 : 0;
    const bb = badgeBBoxAt(frame, HX + dx, HY + dy);
    return !obstacles.some((e) => bboxOverlaps(bb, e)) && !bboxOverlaps(bb, heroBody);
  };
  const correct = chooseBadgeSide(HX, HY, frame, obstacles, heroBody);
  const cases = [
    ['正确实现（右被占 ⇒ 翻左）不遮物', dOk(correct), true],
    ['坏实现"永远选右"（无视实体）⇒ 判 RED', dOk('right'), false],
    ['坏实现"选上"（无视棋子本体）⇒ 判 RED', dOk('up'), false],
    ['不画（null）⇒ 视为不遮物', dOk(null), true],
  ];
  let selfBad = 0;
  for (const [label, got, want] of cases) {
    const pass = got === want;
    if (!pass) selfBad++;
    line(`[${pass ? 'PASS' : 'FAIL'}] 自检 ${label}（实测 ${got}）`);
  }
  if (selfBad) fails += selfBad;
}

line(`\n结论：${fails === 0 ? '全 PASS' : `${fails} 项失败 ⇒ RED`}`);
process.exit(fails === 0 ? 0 : 1);
