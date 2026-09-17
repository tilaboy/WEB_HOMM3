/**
 * M8 布局审计：每种布局 × 每种尺寸 × N 个种子，检查生成是否"真的成立"。
 * 关心四件事：能不能生出来、四家走不走得到、地形比例是否合理、深处有没有宝贝。
 */
import { createGame } from '../dist/core/map/generator.js';
import { isPassable } from '../dist/core/map/grid.js';
import { TERRAIN } from '../dist/core/data/terrains.js';

const LAYOUTS = ['wild', 'ring', 'islands', 'lanes'];
const SIZES = ['small', 'medium', 'large', 'huge'];
const SEEDS = Number(process.env.SEEDS ?? 40);

function reach(map, start) {
  const seen = new Uint8Array(map.width * map.height);
  const s = start.y * map.width + start.x;
  const stack = [s];
  seen[s] = 1;
  while (stack.length) {
    const c = stack.pop();
    const x = c % map.width;
    const y = (c / map.width) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const ni = ny * map.width + nx;
      if (seen[ni] || !isPassable(map, nx, ny)) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return seen;
}

let bad = 0;
const rows = [];
for (const layout of LAYOUTS) {
  for (const size of SIZES) {
    let fails = [];
    let water = 0;
    let land = 0;
    let homes = 0;
    let mines = 0;
    let vaults = 0;
    let guards = 0;
    let monsters = 0;
    let unreachable = 0;
    let tries = 0;
    for (let s = 0; s < SEEDS; s++) {
      const seed = 1000 + s * 7717;
      let state;
      const t0 = Date.now();
      try {
        state = createGame({ seed, layout, size, opponents: 3 });
      } catch (e) {
        fails.push(`${seed}: ${e.message}`);
        continue;
      }
      tries += Date.now() - t0;
      const m = state.map;
      for (const t of m.tiles) {
        if (TERRAIN[t.terrain].passable) land++;
        else water++;
      }
      const townList = Object.values(state.towns);
      homes += townList.filter((t) => t.owner !== 'neutral').length;
      const objs = Object.values(m.objects);
      mines += objs.filter((o) => o.kind === 'mine').length;
      vaults += objs.filter((o) => o.kind === 'vault').length;
      guards += objs.length;
      monsters += objs.filter((o) => o.kind === 'wanderingMonster').length;
      // 连通性：从玩家英雄出发，所有英雄与城镇都要走得到
      const h0 = state.heroes[state.heroOrder[0]];
      const seen = reach(m, h0.pos);
      const spots = [...townList.map((t) => t.pos), ...Object.values(state.heroes).map((h) => h.pos)];
      for (const p of spots) {
        if (seen[p.y * m.width + p.x] !== 1) {
          unreachable++;
          break;
        }
      }
    }
    const ok = fails.length === 0 && unreachable === 0;
    rows.push({
      layout,
      size,
      ok: ok ? 'OK ' : 'BAD',
      landPct: (100 * (land / (land + water))).toFixed(0) + '%',
      homes: (homes / SEEDS).toFixed(1),
      mines: (mines / SEEDS).toFixed(1),
      vaults: (vaults / SEEDS).toFixed(1),
      monsters: (monsters / SEEDS).toFixed(1),
      unreach: unreachable,
      ms: Math.round(tries / SEEDS),
    });
    if (!ok) bad++;
  }
}
console.log('layout    size    res land homes mines vault mon  un.  ms');
for (const r of rows) {
  console.log(
    `${r.layout.padEnd(9)} ${r.size.padEnd(7)} ${r.ok} ${r.landPct.padEnd(4)} ${String(r.homes).padEnd(5)} ${String(r.mines).padEnd(5)} ${String(r.vaults).padEnd(5)} ${String(r.monsters).padEnd(4)} ${String(r.unreach).padEnd(3)} ${r.ms}`,
  );
}
console.log(bad === 0 ? `\n全部通过（${LAYOUTS.length * SIZES.length * SEEDS} 局）` : `\n${bad} 档有问题`);
