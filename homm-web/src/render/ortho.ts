/**
 * 正交俯视网格（HOMM2 冒险地图的做法）。
 *
 * 与之前的等距菱形相比：格子坐标 1:1 对应画面方块，不需要三角换算，
 * 也不需要按深度排序地块——但物件需要按 y 排序，这样"下面"的树会盖住"上面"的树。
 */
import type { GridPos } from '../core/types.js';
import { TILE } from './atlas.js';

export { TILE };

export function gridToWorld(x: number, y: number): { wx: number; wy: number } {
  return { wx: x * TILE, wy: y * TILE };
}

export function gridCenter(x: number, y: number): { wx: number; wy: number } {
  return { wx: x * TILE + TILE / 2, wy: y * TILE + TILE / 2 };
}

export function worldToGrid(wx: number, wy: number): GridPos {
  return { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) };
}
