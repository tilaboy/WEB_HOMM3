/**
 * M8 布局的 AI 长局回归。
 *
 * 关心的不是"赢没赢"，而是**障碍有没有把 AI 关住**：
 * 玩家全程不动当活靶子，看 AI 有没有走出自己的起手区——
 * 双子岛的 AI 会不会挤在同一座岛上、三路走廊的 AI 有没有铺满三条道、
 * 同心环的 AI 有没有渡过外护城河摸到内环的矿。
 * 只要某档布局让 AI 卡在原地，这几列数字会立刻塌下去。
 */
import { createGame } from '../dist/core/map/generator.js';
import { endDay } from '../dist/core/game/turn.js';

const LAYOUTS = ['wild', 'ring', 'islands', 'lanes'];
const SEEDS = Number(process.env.SEEDS ?? 4);
const DAYS = Number(process.env.DAYS ?? 120);

/** 每档布局的"越界"判据：AI 的矿/城分别落在哪一区。 */
function zoneOf(state, layout, p) {
  const m = state.map;
  const cx = (m.width - 1) / 2;
  const cy = (m.height - 1) / 2;
  if (layout === 'lanes') {
    const r0 = Math.round(m.height / 3);
    const r1 = Math.round((2 * m.height) / 3);
    return p.y < r0 - 1 ? '上' : p.y < r1 - 1 ? '中' : '下';
  }
  if (layout === 'islands') return p.x < cx ? '西' : '东';
  if (layout === 'ring') {
    const min = Math.min(m.width, m.height);
    const core = Math.max(3, min * 0.14);
    const moat = Math.max(1.5, min * 0.06);
    const outer = Math.max(core + moat + 2.5, min * 0.26) + moat;
    return Math.hypot(p.x - cx, p.y - cy) < outer ? '内' : '外';
  }
  return '全';
}

const rows = [];
for (const layout of LAYOUTS) {
  let days = 0;
  let mines = 0;
  let minMinesPerAi = 0;
  let spread = 0;
  let vaults = 0;
  let vaultsTotal = 0;
  let crossed = 0;
  for (let s = 0; s < SEEDS; s++) {
    const state = createGame({
      seed: 4242 + s * 977, layout, size: 'medium', opponents: 3, difficulty: 'hard',
    });
    const vaultIds = Object.values(state.map.objects)
      .filter((o) => o.kind === 'vault')
      .map((o) => o.id);
    vaultsTotal += vaultIds.length;
    // 记录每个 AI 英雄"有没有离开过自己那一区"——这才是"桥/缺口真的好用"的证据
    const homeZone = {};
    const roamed = new Set();
    for (const [id, h] of Object.entries(state.heroes)) {
      if (h.owner === 'p1') continue;
      homeZone[id] = zoneOf(state, layout, h.pos);
    }
    for (let d = 0; d < DAYS; d++) {
      endDay(state);
      // 玩家是活靶子、迟早出局；这里只测 AI 的长线行为，所以把他"复活"继续推演
      if (state.status !== 'playing') state.status = 'playing';
      for (const [id, h] of Object.entries(state.heroes)) {
        // 只统计开局就在的英雄：酒馆中途招来的新英雄没有"自己的区"可比
        if (h.owner === 'p1' || roamed.has(id) || !(id in homeZone)) continue;
        if (zoneOf(state, layout, h.pos) !== homeZone[id]) roamed.add(id);
      }
    }
    days += state.day;
    crossed += roamed.size;

    const ai = ['p2', 'p3', 'p4'];
    const owned = Object.values(state.map.objects).filter(
      (o) => o.kind === 'mine' && o.payload.owner && ai.includes(o.payload.owner),
    );
    mines += owned.length;
    minMinesPerAi += Math.min(
      ...ai.map((f) => owned.filter((o) => o.payload.owner === f).length),
    );
    // 越界：AI 占的矿铺开到几个分区（同心环看有没有进内环）
    const zones = new Set(owned.map((o) => zoneOf(state, layout, o.pos)));
    spread += zones.size;
    vaults += vaultIds.filter((id) => !state.map.objects[id]).length;
  }
  rows.push({
    layout,
    days: (days / SEEDS).toFixed(0),
    mines: (mines / SEEDS).toFixed(1),
    worst: (minMinesPerAi / SEEDS).toFixed(1),
    zones: (spread / SEEDS).toFixed(1),
    crossed: (crossed / SEEDS).toFixed(1),
    vaults: (vaults / SEEDS).toFixed(1),
    vaultsTotal: (vaultsTotal / SEEDS).toFixed(1),
  });
}
console.log('layout    天数  AI矿  最弱AI矿  分区数  越界AI英雄  开库');
for (const r of rows) {
  console.log(
    `${r.layout.padEnd(9)} ${r.days.padEnd(4)} ${r.mines.padEnd(5)} ${r.worst.padEnd(8)} ${r.zones.padEnd(7)} ${r.crossed.padEnd(11)} ${r.vaults}/${r.vaultsTotal}`,
  );
}
