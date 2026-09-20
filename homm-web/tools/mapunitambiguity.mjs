#!/usr/bin/env node
/**
 * 探针 A 组：地图兵种帧「横向压格」越界自检（D-64 接线的前置门）
 *
 * 背景 —— 为什么需要它：
 *   地图兵种帧 `u_<faction>_<unit>_map` 现在是 **52×44、锚点 ax=-10**，而 `TILE = 32`。
 *   ⇒ 画布本身就宽过一格 **10px/侧**（结构性压格）。"图标不占格"≠"图标不压格"。
 *   art-director 的门：**压格量须被「最宽合规剪影」封顶**，即按**可见剪影 bbox** 判，不按画布：
 *     leftOvh  = max(0, -(ax + x0))
 *     rightOvh = max(0, (ax + x1) - TILE)
 *   任一帧 leftOvh > 8 || rightOvh > 8 || |leftOvh − rightOvh| > 1 ⇒ **RED**。
 *
 * 依据：team-lead 派单（D-64「地图单位接地图」，2026-09-21）；cap 数值由 art-director 定。
 * 本组判据与「队伍图标不占格」这一意图**无关**，故不受 ux-ia §13 重做影响 —— 可先做。
 * （B 组「视觉归属 vs 命中归属」、C 组「地盘标记存在性」等 ux-ia 落地后再定判据。）
 *
 * 复用：UNIT_FRAMES + buildB0Frame（dist/render/unitArt.js）、TILE（dist/render/ortho.js）。
 * 剪影口径与 audit:b0 一致：**含 1px 描边的可见像素**（alpha > 8）。
 *
 * 退出码：0 = 全 PASS；1 = 有帧越界；2 = 帧表结构异常（前置条件不成立）。
 */
import { UNIT_FRAMES, buildB0Frame } from '../dist/render/unitArt.js';
import { TILE } from '../dist/render/ortho.js';

/** 允许的横向压格上限（px/侧）。art-director 裁定；非规格值，是"最宽合规剪影"的封顶。 */
const LEFT_CAP = 8;
const RIGHT_CAP = 8;
/** 左右越界的不对称上限（px）：防止"一边贴死、一边空着"的偏置。 */
const ASYM_CAP = 1;

/**
 * 判据（纯函数，便于自检）：给定锚点与本帧剪影在画布内的 x 区间，算越界量与判定。
 *   leftOvh  = max(0, -(ax + x0))          —— 剪影超出本格左边界的像素数
 *   rightOvh = max(0, (ax + x1) - TILE)    —— 超出右边界
 */
export function verdict(ax, x0, x1) {
  const leftOvh = Math.max(0, -(ax + x0));
  const rightOvh = Math.max(0, ax + x1 - TILE);
  const asym = Math.abs(leftOvh - rightOvh);
  const ok = leftOvh <= LEFT_CAP && rightOvh <= RIGHT_CAP && asym <= ASYM_CAP;
  return { leftOvh, rightOvh, asym, ok };
}

/**
 * 自检：证明判据有分辨力（不依赖会漂移的真实帧数据，也不需改任何冻结文件）。
 * 期望值写死；不符 ⇒ 自检失败。
 */
if (process.argv.includes('--self-test')) {
  // ax=-10、TILE=32。居中的 32 宽剪影 → x0=10,x1=41（画布中心 25.5≈格心 16）
  const cases = [
    ['居中 32 宽（左0/右0/对称0）→ PASS', verdict(-10, 10, 41), true],
    ['48 宽居中：左8/右7/对称1 → PASS', verdict(-10, 2, 49), true],
    ['左越 9 越上限 → FAIL', verdict(-10, 1, 33), false],
    ['左越 10（不对称 10）→ FAIL', verdict(-10, 0, 40), false],
    ['把好帧 ax 再左移 2px（-10→-12）→ 应翻 FAIL', verdict(-12, 10, 41), false],
  ];
  let selfBad = 0;
  for (const [label, v, want] of cases) {
    const got = v.ok;
    const pass = got === want;
    if (!pass) selfBad++;
    console.log(`${pass ? 'PASS' : 'FAIL'}  自检 ${label}（实测 left=${v.leftOvh} right=${v.rightOvh} asym=${v.asym} ⇒ ${got}）`);
  }
  console.log(selfBad === 0 ? '\n自检：判据有分辨力 ✓' : `\n自检：${selfBad} 例不符 ✗`);
  process.exit(selfBad === 0 ? 0 : 1);
}

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
  console.error('[mapunitambiguity] 帧表里没有 kind=map 的帧 —— UNIT_FRAMES 结构可能变了，探针前置条件不成立。');
  process.exit(2);
}

const rows = [];
let bad = 0;
for (const f of mapFrames) {
  const pb = buildB0Frame(f.name, true); // 成品（含 1px 描边）= 屏幕上真正可见的剪影
  const bb = silhouette(pb);
  if (!bb) {
    rows.push({ f, empty: true });
    bad++;
    continue;
  }
  const v = verdict(f.ax, bb.x0, bb.x1);
  if (!v.ok) bad++;
  rows.push({ f, visW: bb.x1 - bb.x0 + 1, visH: bb.y1 - bb.y0 + 1, ...v });
}

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
console.log(
  `\n探针 A：地图兵种帧横向压格（可见剪影口径 · TILE=${TILE} · cap 左/右 ≤${LEFT_CAP}/${RIGHT_CAP} · |L−R| ≤${ASYM_CAP}）`,
);
console.log(
  pad('帧名', 26) + pad('画布', 9) + pad('锚点', 9) + padL('剪影W', 6) + padL('剪影H', 6) + padL('左越', 6) + padL('右越', 6) + padL('|L−R|', 7) + '  判定',
);
for (const r of rows) {
  const { f } = r;
  const head = pad(f.name, 26) + pad(`${f.w}×${f.h}`, 9) + pad(`ax=${f.ax}`, 9);
  if (r.empty) {
    console.log(head + '  （空剪影）  FAIL');
    continue;
  }
  console.log(
    head + padL(r.visW, 6) + padL(r.visH, 6) + padL(r.leftOvh, 6) + padL(r.rightOvh, 6) + padL(r.asym, 7) + '  ' + (r.ok ? 'PASS' : 'FAIL'),
  );
}
console.log(`\n结论：${bad === 0 ? `全 PASS（${rows.length} 帧）` : `${bad} / ${rows.length} 帧越界 ⇒ RED`}`);
process.exit(bad === 0 ? 0 : 1);
