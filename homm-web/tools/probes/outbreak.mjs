/**
 * 「周爆发」落点探针：地图上有没有足够的**真·必经格**，可以让一只野怪
 * 一堵就"必须打完才能过"？
 *
 * 起因（2026-10-28 主理人）：H3 里每周会有生物生长事件（瘟疫减半 / 某兵翻倍），
 * 还想加一条"本周某日狮鹫爆发，地图上出现大量野怪，必须打完才能通过"。
 *
 * 第二句话能不能成立，不取决于我们会不会写生成代码，而取决于**地形上有没有这种格子**：
 * 如果堵住某一格之后没有任何区域与出发点断开，那这格就只是"路边一只怪"，
 * 玩家绕两步就过去了 —— 那是刷怪，不是关卡。
 *
 * 量法（每一格都真算一遍，不做估算）：
 *   ① 从所有英雄出生点洪水填充，得到可达集合 R（4 邻域，`isPassable`，与 A* 同一把尺子）；
 *   ② 对每个候选格 c（可行走、无物件、在 R 内）把 c 视为不可通行，再填一次；
 *   ③ `lost = |R| - |R'| - 1`（减去 c 自己）= **堵上它之后走不到的格数**；
 *      `lost = 0` ⇒ 纯路边格（可绕过）；`lost > 0` ⇒ 真必经格。
 *   ④ 再看 lost 区域里有没有**城镇** —— 那是软锁（把玩家关在门外 / 关在城里）。
 *
 * 判据（写死）：
 *   · 每张图 `lost > 0` 的格子必须 ≥ 8 个（够放一周 4~6 栈，且有余量挑距离）；
 *   · 其中 `lost ≤ 40` 的"小口袋门"必须 ≥ 2 个（最像 H3 的关卡）；
 *   · `lost > 40` 的格子**不许放爆发怪**（一刀切断半张图 = 软锁风险）。
 *
 * 用法：SEEDS=4 node tools/probes/outbreak.mjs [size]
 */
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=outbreak');
const dimp = (rel) => distUrl(rel, DIST);
requireFile(DIST, 'core/map/generator.js');
requireFile(DIST, 'core/map/grid.js');

const { createGame } = await import(dimp('core/map/generator.js'));
const { isPassable } = await import(dimp('core/map/grid.js'));

const SIZES = ['small', 'medium', 'large', 'huge'];
const LAYOUTS = ['wild', 'ring'];
const onlySize = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (onlySize && !SIZES.includes(onlySize)) {
  console.error(`✗ 未知尺寸「${onlySize}」—— 可选：${SIZES.join(' / ')}`);
  process.exit(2);
}
const seeds = Number(process.env.SEEDS ?? 3);

/** 4 邻域洪水填充；`ban` = 临时视为不可通行的一格（探"堵上它"）。 */
function flood(map, starts, ban = -1) {
  const W = map.width;
  const H = map.height;
  const seen = new Uint8Array(W * H);
  const q = [];
  for (const p of starts) {
    const i = p.y * W + p.x;
    if (i === ban || seen[i]) continue;
    if (!isPassable(map, p.x, p.y)) continue;
    seen[i] = 1;
    q.push(i);
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    if (i === ban) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (j === ban || seen[j]) continue;
      if (!isPassable(map, nx, ny)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}

function count(seen) {
  let n = 0;
  for (let i = 0; i < seen.length; i++) if (seen[i]) n += 1;
  return n;
}

console.log(`周爆发落点探针 · 尺寸=${onlySize ?? '全部'} · 每档 ${seeds} seed`);
console.log('布局   尺寸    可达格  必经格  小口袋门  大切断  含城切断  结论');

let fail = 0;
for (const size of SIZES) {
  if (onlySize && size !== onlySize) continue;
  for (const layout of LAYOUTS) {
    let reachSum = 0;
    let passSum = 0;
    let pocketGateSum = 0;
    let bigCutSum = 0;
    let castleCutSum = 0;
    let runs = 0;
    for (let s = 0; s < seeds; s++) {
      const seed = 9100 + s * 977;
      const state = createGame({ seed, layout, size, opponents: 3 });
      const map = state.map;
      const W = map.width;
      const H = map.height;
      const starts = Object.values(state.heroes).map((h) => h.pos);
      const base = flood(map, starts);
      const reach = count(base);

      // 城镇 / 城堡所在格的集合：只用来判"切断的区域里有没有城"
      const castleCells = new Set();
      for (const obj of Object.values(map.objects)) {
        if (obj.kind !== 'town') continue;
        for (const c of obj.footprint ?? [obj.pos]) castleCells.add(c.y * W + c.x);
      }

      let pass = 0;
      let pocketGate = 0;
      let bigCut = 0;
      let castleCut = 0;
      for (let i = 0; i < W * H; i++) {
        if (!base[i]) continue;
        const x = i % W;
        const y = (i / W) | 0;
        if (!isPassable(map, x, y)) continue;
        if (map.tiles[i].objectId) continue; // 已有物件的格子不能放爆发怪
        const cut = flood(map, starts, i);
        const lost = reach - count(cut) - 1;
        if (lost <= 0) continue;
        pass += 1;
        if (lost <= 40) pocketGate += 1;
        else {
          bigCut += 1;
          // 切断的区域里有没有城镇：从被切断的格子反查任何一个城格
          let hit = false;
          for (const c of castleCells) {
            if (!cut[c] && base[c]) {
              hit = true;
              break;
            }
          }
          if (hit) castleCut += 1;
        }
      }
      reachSum += reach;
      passSum += pass;
      pocketGateSum += pocketGate;
      bigCutSum += bigCut;
      castleCutSum += castleCut;
      runs += 1;
    }
    const reach = Math.round(reachSum / runs);
    const pass = (passSum / runs).toFixed(1);
    const gate = (pocketGateSum / runs).toFixed(1);
    const big = (bigCutSum / runs).toFixed(1);
    const ccut = (castleCutSum / runs).toFixed(1);
    const ok = passSum / runs >= 8 && pocketGateSum / runs >= 2;
    if (!ok) fail += 1;
    console.log(
      `${layout.padEnd(6)} ${size.padEnd(6)} ${String(reach).padStart(6)}  ${String(pass).padStart(6)}  ${String(gate).padStart(8)}  ${String(big).padStart(6)}  ${String(ccut).padStart(8)}  ${ok ? '可落点充足' : '★ 必经格不足'}`,
    );
  }
}

console.log('');
console.log(
  fail === 0
    ? '结论：每张图都有 ≥8 个"堵上就断"的格子，且 ≥2 个是小口袋门 ⇒ "必须打完才能通过"在地形层成立。'
    : `结论：${fail} 组必经格不足 —— 这些图上的爆发怪只能当"路边刷怪"，不能说"必须打完才能过"。`,
);
process.exit(fail === 0 ? 0 : 1);
