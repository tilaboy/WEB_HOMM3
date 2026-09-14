import type { GameMap, MapObject, Tile, GridPos } from '../types.js';
import { TERRAIN } from '../data/terrains.js';

export function idx(map: GameMap, x: number, y: number): number {
  return y * map.width + x;
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function tileAt(map: GameMap, x: number, y: number): Tile | null {
  if (!inBounds(map, x, y)) return null;
  return map.tiles[idx(map, x, y)];
}

export function objectAt(map: GameMap, x: number, y: number): MapObject | null {
  const t = tileAt(map, x, y);
  if (!t || !t.objectId) return null;
  return map.objects[t.objectId] ?? null;
}

export function terrainAt(map: GameMap, x: number, y: number) {
  const t = tileAt(map, x, y);
  return t ? TERRAIN[t.terrain] : null;
}

/** 地块本身可否通行（只看地形与阻挡物，不看英雄）。
 *
 *  多格物件（2×2 城堡）只有入口那一格能站人：另外三格即使 `blocking` 为 false
 *  也一律算作阻挡，这样 A* 会自动把"进城"收敛到正面那一条路。 */
export function isPassable(map: GameMap, x: number, y: number): boolean {
  const t = tileAt(map, x, y);
  if (!t) return false;
  if (!TERRAIN[t.terrain].passable) return false;
  const obj = t.objectId ? map.objects[t.objectId] : null;
  if (!obj) return true;
  if (obj.footprint) return obj.pos.x === x && obj.pos.y === y;
  return !obj.blocking;
}

/* ---------------- 2×2 城堡几何 ---------------- */

/** 城堡固定占 2×2：城门在左下角，正面朝南（和 HOMM2 一样永远面向镜头）。 */
export const CASTLE_W = 2;
export const CASTLE_H = 2;

/** 城门所在的左下角格 → 整个 2×2 的左上角格。 */
export function castleAnchor(gate: GridPos): GridPos {
  return { x: gate.x, y: gate.y - 1 };
}

/** 由城门格推出 2×2 占据的四格，顺序固定，便于存档对比。 */
export function castleCells(gate: GridPos): GridPos[] {
  const a = castleAnchor(gate);
  return [
    { x: a.x, y: a.y },
    { x: a.x + 1, y: a.y },
    { x: a.x, y: a.y + 1 },
    { x: a.x + 1, y: a.y + 1 },
  ];
}

/** 多格物件占的全部格子；单格物件就是它自己。 */
export function footprintOf(obj: MapObject): GridPos[] {
  return obj.footprint ?? [obj.pos];
}

/** 精灵的绘制锚点：最上、再最左的那一格（保证一个物件只画一次）。 */
export function drawAnchor(obj: MapObject): GridPos {
  let best = obj.pos;
  for (const c of footprintOf(obj)) {
    if (c.y < best.y || (c.y === best.y && c.x < best.x)) best = c;
  }
  return best;
}

/** (x,y) 是不是这个物件的入口格（唯一可站立的那格）。 */
export function isEntrance(obj: MapObject, x: number, y: number): boolean {
  return obj.pos.x === x && obj.pos.y === y;
}

/** 物件是否占住了 (x,y) 这格。 */
export function occupies(obj: MapObject, x: number, y: number): boolean {
  return footprintOf(obj).some((c) => c.x === x && c.y === y);
}

export function dist(a: GridPos, b: GridPos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function samePos(a: GridPos, b: GridPos): boolean {
  return a.x === b.x && a.y === b.y;
}
