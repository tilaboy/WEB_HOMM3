/** 把一张图打成 ASCII 看一眼骨架：~ 水、. 草地、: 沙、# 岩/雪、@ 城镇、* 矿、V 宝库、x 野怪。 */
import { createGame } from '../dist/core/map/generator.js';
import { TERRAIN } from '../dist/core/data/terrains.js';

const layout = process.argv[2] ?? 'ring';
const seed = Number(process.argv[3] ?? 1000);
const size = process.argv[4] ?? 'medium';
const state = createGame({ seed, layout, size, opponents: 3 });
const m = state.map;
const glyph = { water: '~', sand: ':', grass: '.', swamp: ',', dirt: '-', rock: '#', snow: '*' };
const grid = [];
for (let y = 0; y < m.height; y++) {
  const row = [];
  for (let x = 0; x < m.width; x++) {
    const t = m.tiles[y * m.width + x];
    row.push(glyph[t.terrain] ?? '?');
    const o = t.objectId ? m.objects[t.objectId] : null;
    if (!o) continue;
    if (o.kind === 'town') row[x] = o.payload.townId === 'town_home' ? 'P' : 'T';
    else if (o.kind === 'mine') row[x] = 'm';
    else if (o.kind === 'vault') row[x] = 'V';
    else if (o.kind === 'wanderingMonster') row[x] = 'x';
  }
  grid.push(row.join(''));
}
console.log(`# ${layout} ${size} seed=${seed}  ${TERRAIN ? '' : ''}`);
console.log(grid.join('\n'));
// 结构小结
const towns = Object.values(state.towns).filter((t) => t.owner !== 'neutral');
console.log('\n主城：' + towns.map((t) => `${t.owner}(${t.pos.x},${t.pos.y})`).join(' '));
const cx = (m.width - 1) / 2;
const cy = (m.height - 1) / 2;
const deep = Object.values(m.objects).filter((o) => o.kind === 'vault' || o.kind === 'mine');
console.log(
  '深处物件距中心：' +
    deep
      .map((o) => Math.hypot(o.pos.x - cx, o.pos.y - cy).toFixed(0))
      .slice(0, 14)
      .join(' '),
);
