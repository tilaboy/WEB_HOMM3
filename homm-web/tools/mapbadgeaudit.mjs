#!/usr/bin/env node
/**
 * 地图「队伍徽标」探针（D-64「地图单位接地图」· `in-game-ia.md §13.5`）—— Node，无需浏览器。
 *
 * 组：
 *   A  帧完整性（保留）    —— 每个 `kind==='map'` 帧的可见剪影整体落在槽位内（无横向裁切），
 *                            且相对目标格左右外扩**对称**（|左 − 右| ≤ 1px）。（亦可并入 atlasaudit。）
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
  badges.push({ name: f.name, frame: { w: pb.w, h: pb.h, ax: f.ax, ay: f.ay, sil } });
}
line(`徽标源：${badges.length} 个 kind=map 帧（画布 ${badges[0].frame.w}×${badges[0].frame.h} · TILE=${TILE}）`);

/* ============================ A · 帧完整性 ============================ */
line('\n=== A 帧完整性（剪影在槽位内 + 相对格左右外扩对称 ≤1px）===');
{
  let aBad = 0;
  for (const b of badges) {
    const { frame, name } = b;
    const { sil } = frame;
    const withinSlot = sil.x0 >= 0 && sil.x1 <= frame.w - 1; // 无横向裁切
    const leftOvh = Math.max(0, -(frame.ax + sil.x0));
    const rightOvh = Math.max(0, frame.ax + sil.x1 - TILE);
    const sym = Math.abs(leftOvh - rightOvh);
    const pass = withinSlot && sym <= 1;
    if (!pass) {
      aBad++;
      line(`[FAIL] ${name}  剪影 x[${sil.x0},${sil.x1}] 在槽位内=${withinSlot} 左越 ${leftOvh} 右越 ${rightOvh} |Δ| ${sym}`);
    }
  }
  ok(aBad === 0, `A：${badges.length} 帧剪影均在槽位内且左右外扩对称（失败 ${aBad}）`);
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
  // 英雄棋子主体（**不含旗杆/旗**；atlas.ts 的 hero() 构建器 + 1px 描边）—— 相对英雄格的像素偏移。
  // 注意：棋子帧 ay=−12 ⇒ 主体上探自身格 12px（y 从 −4 起），这是 D 组的关键几何。
  const HERO_BODY = { dx0: 8, dy0: -4, dx1: 23, dy1: 31 };
  const heroBody = () => ({
    x0: HX * TILE + HERO_BODY.dx0,
    y0: HY * TILE + HERO_BODY.dy0,
    x1: HX * TILE + HERO_BODY.dx1,
    y1: HY * TILE + HERO_BODY.dy1,
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
  const heroBody = { x0: HX * TILE + 8, y0: HY * TILE - 4, x1: HX * TILE + 23, y1: HY * TILE + 31 };
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
