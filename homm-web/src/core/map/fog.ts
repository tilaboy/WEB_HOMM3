import type { GameState, GridPos, PlayerId } from '../types.js';
import { idx, inBounds } from './grid.js';

export function revealAround(state: GameState, player: PlayerId, pos: GridPos, radius: number): void {
  const m = state.map;
  const rev = state.players[player]?.revealed;
  if (!rev) return;
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = pos.x + dx;
      const y = pos.y + dy;
      if (!inBounds(m, x, y)) continue;
      rev[idx(m, x, y)] = 1;
    }
  }
}

export function isRevealed(state: GameState, player: PlayerId, x: number, y: number): boolean {
  const rev = state.players[player]?.revealed;
  if (!rev || !inBounds(state.map, x, y)) return false;
  return rev[idx(state.map, x, y)] === 1;
}

/** 当前所有存活英雄视野的并集，用于绘制"探索过但当前不可见"的半暗区域。 */
export function computeVisible(state: GameState, player: PlayerId, sight: number): Uint8Array {
  const m = state.map;
  const vis = new Uint8Array(m.width * m.height);
  for (const id of state.heroOrder) {
    const h = state.heroes[id];
    if (!h || h.owner !== player) continue;
    const r2 = sight * sight;
    for (let dy = -sight; dy <= sight; dy++) {
      for (let dx = -sight; dx <= sight; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = h.pos.x + dx;
        const y = h.pos.y + dy;
        if (!inBounds(m, x, y)) continue;
        vis[idx(m, x, y)] = 1;
      }
    }
  }
  return vis;
}
