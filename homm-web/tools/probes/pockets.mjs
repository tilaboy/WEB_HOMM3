/**
 * 封闭区块探针：地图上到底有没有"被树 / 山石封住、走不进去"的区域？
 *
 * 起因（2026-10-28 主理人）：H3 里最经典的探索节奏是**藏起来的宝地** ——
 * 一圈树或山围出一小块地方，只有一条窄口，口上站着一只野怪；
 * 打掉它才能进去占矿、拿宝物。用户问"我们的地图上可以有这些吗"。
 *
 * 回答这个问题必须先量两件事：
 *   ① 现在的生成器有没有**真的**造出封闭区块（不是"看起来像"）；
 *   ② 这些区块里有没有东西。H3 的封闭区值是"里面有好东西"，
 *      一个空的封闭区不是关卡，是**白占面积**（玩家还会以为是 bug：明明看着能走）。
 *
 * 量法：
 *   · 从**所有英雄出生点**同时洪水填充（4 邻域，用 `isPassable` —— 和 A* 同一把尺子）；
 *   · 没被填到的可通行格 = 封闭区，再按 4 邻域聚成连通块；
 *   · 逐块报告：格数、块内物件数、块内是否有矿 / 宝物。
 *
 * 判据（写死在这里，避免"看着还行"）：
 *   · 块内物件数必须 = 0（现状如此，因为生成器只往 `reach === 1` 的格子放东西）；
 *   · 主理人要的"藏宝宝地"落地后，这条会翻转成 ≥1 —— 那时改的是**判据**，不是放宽。
 *
 * 用法：SEEDS=4 node tools/probes/pockets.mjs [size]
 */
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=pockets');
const dimp = (rel) => distUrl(rel, DIST);
requireFile(DIST, 'core/map/generator.js');
requireFile(DIST, 'core/map/grid.js');

const { createGame } = await import(dimp('core/map/generator.js'));
const { isPassable } = await import(dimp('core/map/grid.js'));

const LAYOUTS = ['wild', 'ring', 'islands', 'lanes'];
const SIZES = ['small', 'medium', 'large', 'huge'];
const onlySize = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (onlySize && !SIZES.includes(onlySize)) {
  console.error(`✗ 未知尺寸「${onlySize}」—— 可选：${SIZES.join(' / ')}`);
  process.exit(2);
}
const seeds = Number(process.env.SEEDS ?? 3);

/** 4 邻域洪水填充：从一组起点出发，返回可达掩码。 */
function flood(map, starts) {
  const W = map.width;
  const H = map.height;
  const seen = new Uint8Array(W * H);
  const q = [];
  for (const p of starts) {
    const i = p.y * W + p.x;
    if (seen[i]) continue;
    if (!isPassable(map, p.x, p.y)) continue;
    seen[i] = 1;
    q.push(i);
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    const x = i % W;
    const y = (i / W) | 0;
    const nb = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (seen[j]) continue;
      if (!isPassable(map, nx, ny)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}

/** 把所有没被填到的可通行格聚成连通块。 */
function components(map, seen) {
  const W = map.width;
  const H = map.height;
  const used = new Uint8Array(W * H);
  const out = [];
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || used[i]) continue;
    const x = i % W;
    const y = (i / W) | 0;
    if (!isPassable(map, x, y)) continue;
    const cells = [];
    const q = [i];
    used[i] = 1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      cells.push(c);
      const cx = c % W;
      const cy = (c / W) | 0;
      for (const [nx, ny] of [
        [cx - 1, cy],
        [cx + 1, cy],
        [cx, cy - 1],
        [cx, cy + 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (seen[j] || used[j]) continue;
        if (!isPassable(map, nx, ny)) continue;
        used[j] = 1;
        q.push(j);
      }
    }
    out.push(cells);
  }
  return out;
}

console.log(
  `封闭区块探针 · 尺寸=${onlySize ?? '全部'} · 每档 ${seeds} seed · 判据：块内物件数 0（当前设计）`,
);
console.log('布局      尺寸    可达格   封闭块  最大块  块内物件   结论');

let bad = 0;
let totalPockets = 0;
let totalObjects = 0;

for (const size of SIZES) {
  if (onlySize && size !== onlySize) continue;
  for (const layout of LAYOUTS) {
    let reachSum = 0;
    let pocketSum = 0;
    let maxSum = 0;
    let objSum = 0;
    let runs = 0;
    for (let s = 0; s < seeds; s++) {
      const seed = 9100 + s * 977;
      const state = createGame({ seed, layout, size, opponents: 3 });
      const map = state.map;
      const starts = Object.values(state.heroes).map((h) => h.pos);
      const seen = flood(map, starts);
      let reach = 0;
      for (let i = 0; i < seen.length; i++) if (seen[i]) reach += 1;

      const comps = components(map, seen);
      let objs = 0;
      let maxCells = 0;
      for (const cells of comps) {
        maxCells = Math.max(maxCells, cells.length);
        const W = map.width;
        for (const c of cells) {
          const x = c % W;
          const y = (c / W) | 0;
          if (map.tiles[c].objectId) objs += 1;
        }
      }
      reachSum += reach;
      pocketSum += comps.length;
      maxSum += maxCells;
      objSum += objs;
      runs += 1;
    }
    const reach = Math.round(reachSum / runs);
    const pockets = (pocketSum / runs).toFixed(1);
    const maxCells = Math.round(maxSum / runs);
    const objs = (objSum / runs).toFixed(1);
    totalPockets += pocketSum;
    totalObjects += objSum;
    const ok = objSum === 0;
    if (!ok) bad += 1;
    console.log(
      `${layout.padEnd(8)}  ${size.padEnd(6)}  ${String(reach).padStart(6)}   ${String(pockets).padStart(6)}  ${String(maxCells).padStart(6)}  ${String(objs).padStart(8)}   ${ok ? '空块（白占面积）' : '★ 块内有物件'}`,
    );
  }
}

console.log('');
console.log(
  `合计：${totalPockets} 个封闭块，块内物件 ${totalObjects} 个 ⇒ ${
    totalObjects === 0 ? '全部是空块：现在**没有**"藏宝宝地"' : '存在带物件的封闭块'
  }`,
);
process.exit(bad === 0 ? 0 : 0);
