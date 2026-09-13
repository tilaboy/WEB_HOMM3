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

/** 地块本身可否通行（只看地形与阻挡物，不看英雄）。 */
export function isPassable(map: GameMap, x: number, y: number): boolean {
  const t = tileAt(map, x, y);
  if (!t) return false;
  if (!TERRAIN[t.terrain].passable) return false;
  const obj = t.objectId ? map.objects[t.objectId] : null;
  if (obj && obj.blocking) return false;
  return true;
}

export function dist(a: GridPos, b: GridPos): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function samePos(a: GridPos, b: GridPos): boolean {
  return a.x === b.x && a.y === b.y;
}
