import type { GameState, GridPos } from '../types.js';
import { TERRAIN } from '../data/terrains.js';
import { idx, isPassable } from './grid.js';

export interface PathField {
  cost: Float64Array;
  prev: Int32Array;
}

const DIRS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

class MinHeap {
  private item: number[] = [];
  private key: number[] = [];

  get size(): number {
    return this.item.length;
  }

  push(v: number, k: number): void {
    this.item.push(v);
    this.key.push(k);
    let i = this.item.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.key[p] <= this.key[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.item[0];
    const lastItem = this.item.pop()!;
    const lastKey = this.key.pop()!;
    if (this.item.length) {
      this.item[0] = lastItem;
      this.key[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let s = i;
        if (l < this.item.length && this.key[l] < this.key[s]) s = l;
        if (r < this.item.length && this.key[r] < this.key[s]) s = r;
        if (s === i) break;
        this.swap(i, s);
        i = s;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.item[a];
    this.item[a] = this.item[b];
    this.item[b] = ti;
    const tk = this.key[a];
    this.key[a] = this.key[b];
    this.key[b] = tk;
  }
}

/** 进入 (x,y) 一格所需的移动力；不可通行返回 Infinity。 */
export function stepCost(state: GameState, from: GridPos, to: GridPos): number {
  const m = state.map;
  if (to.x < 0 || to.y < 0 || to.x >= m.width || to.y >= m.height) return Infinity;
  if (!isPassable(m, to.x, to.y)) return Infinity;
  const base = TERRAIN[m.tiles[idx(m, to.x, to.y)].terrain].moveCost;
  const diagonal = from.x !== to.x && from.y !== to.y;
  // 不允许贴角穿越：两侧正交格都必须能走
  if (diagonal) {
    if (!isPassable(m, to.x, from.y) || !isPassable(m, from.x, to.y)) return Infinity;
    return Math.round(base * 1.4);
  }
  return base;
}

/**
 * 以 from 为源点的 Dijkstra。maxCost 用于只展开当日移动力内的格子
 * （传 Infinity 则全图展开，用于"移动力不够时先走一段"）。
 */
export function computePaths(state: GameState, from: GridPos, maxCost = Infinity): PathField {
  const m = state.map;
  const n = m.width * m.height;
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const start = idx(m, from.x, from.y);
  cost[start] = 0;
  const heap = new MinHeap();
  heap.push(start, 0);

  while (heap.size) {
    const cur = heap.pop();
    const curCost = cost[cur];
    const cx = cur % m.width;
    const cy = (cur / m.width) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
      const c = stepCost(state, { x: cx, y: cy }, { x: nx, y: ny });
      if (!isFinite(c)) continue;
      const ni = idx(m, nx, ny);
      const nc = curCost + c;
      if (nc < cost[ni] && nc <= maxCost) {
        cost[ni] = nc;
        prev[ni] = cur;
        heap.push(ni, nc);
      }
    }
  }
  return { cost, prev };
}

export function buildPath(state: GameState, field: PathField, from: GridPos, to: GridPos): GridPos[] {
  const m = state.map;
  const start = idx(m, from.x, from.y);
  const goal = idx(m, to.x, to.y);
  if (!isFinite(field.cost[goal])) return [];
  const path: GridPos[] = [];
  let cur = goal;
  let guard = 0;
  while (cur !== start && cur !== -1 && guard++ < 4096) {
    path.push({ x: cur % m.width, y: (cur / m.width) | 0 });
    cur = field.prev[cur];
  }
  if (cur !== start) return [];
  path.reverse();
  return path;
}
