import type { GridPos } from '../core/types.js';

export const TILE_W = 64;
export const TILE_H = 32;
export const THICKNESS = 8;

/** 格子中心 → 世界坐标（顶面菱形的中心）。 */
export function gridToWorld(x: number, y: number): { wx: number; wy: number } {
  return { wx: (x - y) * (TILE_W / 2), wy: (x + y) * (TILE_H / 2) };
}

/** 世界坐标 → 格子。先算实数解再在 3×3 邻域里做精确命中，避免边界抖动。 */
export function worldToGrid(wx: number, wy: number): GridPos {
  const u = wx / TILE_W + wy / TILE_H;
  const v = wy / TILE_H - wx / TILE_W;
  const bx = Math.round(u);
  const by = Math.round(v);
  let best: GridPos = { x: bx, y: by };
  let bestScore = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = bx + dx;
      const y = by + dy;
      const c = gridToWorld(x, y);
      const p = Math.abs(wx - c.wx) / (TILE_W / 2);
      const q = Math.abs(wy - c.wy) / (TILE_H / 2);
      const score = p + q;
      if (score <= 1 && score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

/** 顶面菱形四个顶点。 */
export function diamondPoints(wx: number, wy: number): [number, number][] {
  return [
    [wx, wy - TILE_H / 2],
    [wx + TILE_W / 2, wy],
    [wx, wy + TILE_H / 2],
    [wx - TILE_W / 2, wy],
  ];
}

export function tracePolygon(ctx: CanvasRenderingContext2D, pts: [number, number][]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
