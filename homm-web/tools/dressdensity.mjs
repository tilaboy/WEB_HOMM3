#!/usr/bin/env node
/**
 * dressdensity.mjs —— 「布景层密度会不会让地图变花」的**可复算判据**（只读，不改任何东西）。
 *
 * 为什么有它：`placementsOf()` 的落点规则是这一层最该被核对的东西，但**此前没有任何工具
 * 对它断言**（b0audit/atlasaudit 都不碰它）。teal-lead 问「道具密度是否会让地图"变花"」，
 * 这不是一个能用肉眼在**一张**图上回答的问题 —— 需要：① 跑多张真图；② 用**不变量**证明
 * 它没挤到别的东西；③ 用**最坏局部窗口**衡量"密不密"，而不是看整图总数。
 *
 * 口径（诚实边界）：
 *   - 真图 = `createGame()` 生成，不是手搭测试图（手搭图物件太少，会掩盖问题）。
 *   - 「一屏」沿用真机口径：视口 792×240 CSS、`camera.zoom=2`、`TILE=32`
 *     ⇒ 一格 64 CSS px ⇒ 可见 **12.4 × 3.75 ≈ 46 格**（`SCREEN_W×SCREEN_H` 取整 12×4）。
 *   - 不变量判据的常量与 `src/render/setDressing.ts` **同源**（CLEAR / MIN_PROP_GAP /
 *     MIN_SAME_GAP / TARGET_KINDS 都是模块私有 const，此处镜像一份；改动须同步）。
 *
 * 用法：node tools/dressdensity.mjs
 */
import { join } from 'node:path';

const ROOT = process.cwd();
const { placementsOf } = await import(join(ROOT, 'dist/render/setDressing.js'));
const { createGame } = await import(join(ROOT, 'dist/core/map/generator.js'));

/* ---- 镜像 src/render/setDressing.ts 的常量（模块私有，无法 import）---- */
const CLEAR = 2;
const MIN_PROP_GAP = 3;
const MIN_SAME_GAP = 9;
const TARGET_KINDS = new Set([
  'resourcePile', 'treasureChest', 'artifact', 'fountain', 'town', 'mine', 'vault',
]);
/* ---- 真机一屏口径 ---- */
const SCREEN_W = 12;
const SCREEN_H = 4;

const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const idx = (m, x, y) => y * m.width + x;

function checkMap(st, c) {
  const map = st.map;
  const pl = placementsOf(map);
  const W = map.width, H = map.height;
  const v = { I1: [], I2: [], I3a: [], I3b: [], I4: [] };

  // I1：不与任何物件同格 + 彼此不叠格
  const seen = new Set();
  for (const p of pl) {
    for (let dy = 0; dy < p.span; dy++) for (let dx = 0; dx < p.span; dx++) {
      const x = p.x + dx, y = p.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) { v.I1.push(`${p.name}@${p.x},${p.y} 出界`); continue; }
      const c = map.tiles[idx(map, x, y)];
      if (c.objectId) v.I1.push(`${p.name}@${p.x},${p.y} 压物件 ${c.objectId}`);
      const k = y * W + x;
      if (seen.has(k)) v.I1.push(`${p.name}@${p.x},${p.y} 与他物叠格 ${x},${y}`);
      seen.add(k);
    }
  }
  // I2：目标物净距（只对 TARGET_KINDS）
  for (const p of pl) {
    for (let dy = -CLEAR; dy < p.span + CLEAR; dy++) for (let dx = -CLEAR; dx < p.span + CLEAR; dx++) {
      const x = p.x + dx, y = p.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const c = map.tiles[idx(map, x, y)];
      if (!c.objectId) continue;
      if (TARGET_KINDS.has(map.objects[c.objectId].kind)) v.I2.push(`${p.name}@${p.x},${p.y} 距目标物 ${map.objects[c.objectId].kind} 太近`);
    }
  }
  // I3：布景间距
  for (let i = 0; i < pl.length; i++) for (let j = i + 1; j < pl.length; j++) {
    const d = cheb(pl[i], pl[j]);
    if (d < MIN_PROP_GAP) v.I3a.push(`${pl[i].name}@${pl[i].x},${pl[i].y} ↔ ${pl[j].name}@${pl[j].x},${pl[j].y} = ${d} < ${MIN_PROP_GAP}`);
    if (pl[i].index === pl[j].index && d < MIN_SAME_GAP) v.I3b.push(`同型 ${pl[i].name} 相距 ${d} < ${MIN_SAME_GAP}`);
  }
  // I4：不在水面
  for (const p of pl) for (let dy = 0; dy < p.span; dy++) for (let dx = 0; dx < p.span; dx++) {
    const x = p.x + dx, y = p.y + dy;
    if (x >= 0 && y >= 0 && x < W && y < H && map.tiles[idx(map, x, y)].terrain === 'water') v.I4.push(`${p.name}@${p.x},${p.y} 落水`);
  }

  // 密度指标
  const tiles = W * H;
  const cover = pl.reduce((s, p) => s + p.span * p.span, 0);
  let maxWin = 0;
  for (let y = 0; y + SCREEN_H <= H; y++) for (let x = 0; x + SCREEN_W <= W; x++) {
    let n = 0;
    for (const p of pl) {
      if (p.x >= x && p.x < x + SCREEN_W && p.y >= y && p.y < y + SCREEN_H) n++;
    }
    if (n > maxWin) maxWin = n;
  }
  const screens = tiles / (SCREEN_W * SCREEN_H);
  const violations = v.I1.length + v.I2.length + v.I3a.length + v.I3b.length + v.I4.length;
  return {
    size: c.size, seed: c.seed,
    label: `seed=${c.seed} ${W}x${H}`,
    W, H, obj: Object.keys(map.objects).length, pl: pl.length,
    perScreen: pl.length / screens, coverPct: (cover / tiles) * 100, maxWin, v, violations,
  };
}

const CASES = [];
for (const size of ['small', 'medium', 'large']) for (const seed of [1, 7, 42]) CASES.push({ size, seed });

console.log('布景密度判据 · 真图 · 口径：视口 792×240 CSS / zoom=2 / TILE=32 ⇒ 一屏 12×4 格\n');
const head = ['尺寸', '格数', '物件', '布景', '个/屏', '覆盖率', '最坏窗口'];
console.log(head.map((s, i) => s.padEnd([10, 8, 6, 6, 7, 8, 9][i])).join(''));
console.log('-'.repeat(56));
let totPl = 0, totViol = 0, worst = null;
for (const c of CASES) {
  const st = createGame({ seed: c.seed, size: c.size });
  const r = checkMap(st, c);
  totPl += r.pl; totViol += r.violations;
  if (!worst || r.maxWin > worst.maxWin) worst = r;
  console.log([
    `${c.size}`.padEnd(10), `${r.W}x${r.H}`.padEnd(8), String(r.obj).padEnd(6),
    String(r.pl).padEnd(6), r.perScreen.toFixed(2).padEnd(7),
    `${r.coverPct.toFixed(2)}%`.padEnd(8), String(r.maxWin).padEnd(9),
  ].join(''));
  if (r.violations) {
    for (const [k, arr] of Object.entries(r.v)) for (const m of arr.slice(0, 4)) console.log(`     ✗ ${k} ${m}`);
  }
}
console.log('-'.repeat(56));
console.log(`合计：9 张真图 · 布景 ${totPl} 个 · 不变量违例 ${totViol}`);
console.log(`最坏局部窗口：${worst.maxWin} 个布景挤在 12×4 一屏内（${worst.label}）`);
console.log(totViol === 0 ? '\n✅ I1–I4 全绿' : '\n❌ 有不变量违例');
process.exit(totViol === 0 ? 0 : 1);
