/**
 * 封闭宝地（P0 / §18.1）的**几何**部分：找一块 8~20 格的连通面，
 * 给出一条入口 + 一圈要堵的外圈格。物件落谁、奖励抽什么由生成器负责。
 *
 * 为什么单独一支：这一步是纯几何（只读地图），探针可以不起浏览器直接量
 * "每块是不是真的只有一个口"，而生成器那边只负责把树栽上去。
 *
 * ★ 一条口径：外圈只要有一个**已有物件**的格子，这块就**不能选** ——
 *   那个格子堵不上，等于第二个入口（G3 要求恰好 1 个）。宁缺勿错。
 */
import { isPassable, idx } from './grid.js';
import type { GameMap, GridPos } from '../types.js';

/** §18.1：8~20 格的连通面 */
export const POCKET_MIN_CELLS = 8;
export const POCKET_MAX_CELLS = 20;

export interface PocketShell {
  /** 口袋内部（可站人） */
  cells: GridPos[];
  /** 唯一入口（外圈格；守卫站这里） */
  gate: GridPos;
  /** 要种树/堆石的外圈格（不含入口） */
  walls: GridPos[];
  /** 起点格距最近主城的曼哈顿格数（G4 要报"这一档到底有多深"） */
  dist: number;
}

export interface FindPocketOpts {
  /** 从英雄出生点出发的可达掩码（`reachableFrom` 的结果） */
  reachable: Uint8Array;
  /** 距最近主城的曼哈顿格数 */
  distance: (p: GridPos) => number;
  minDist: number;
  maxDist: number;
  /** 已被占的格子：城镇 / 英雄 / 已落的口袋（内部与墙都算） */
  blocked: Set<number>;
  /**
   * 这些格子的**四邻**不允许长进口袋（用于城门格）。
   *
   * 城门格本身"可通行 + 有 objectId"，若它落在外圈上，墙就缺一块 —— 而且它是
   * 一条真出口（口袋 → 城门格 → 城门外的空地）。小图上 4 座城让 `rimHasObject`
   * 吃掉绝大多数候选，实测就是这么来的。所以不是"发现再否掉"，是**一开始就躲开**。
   */
  avoidNear?: Set<number>;
  /** 打乱后的候选起点（格子索引）；调用方保证确定性 */
  order: number[];
  rng: () => number;
  /** 可选：各条排除原因的计数（探针用来区分"图上没有"与"尺子量不到"） */
  trace?: Record<string, number>;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function findPocketShell(map: GameMap, o: FindPocketOpts): PocketShell | null {
  const W = map.width;
  const H = map.height;

  const eligible = (i: number): boolean => {
    if (o.blocked.has(i)) return false;
    if (!o.reachable[i]) return false;
    if (map.tiles[i].objectId) return false;
    const x = i % W;
    const y = (i / W) | 0;
    if (!isPassable(map, x, y)) return false;
    return true;
  };

  // 城门四邻（预展开成掩码：每个格子一次判定，不必在 BFS 里反复查 4 个方向）
  let avoidMask: Uint8Array | null = null;
  if (o.avoidNear && o.avoidNear.size) {
    avoidMask = new Uint8Array(W * H);
    for (const g of o.avoidNear) {
      const gx = g % W;
      const gy = (g / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        avoidMask[ny * W + nx] = 1;
      }
    }
  }

  for (const seed of o.order) {
    if (!eligible(seed)) continue;
    if (avoidMask && avoidMask[seed]) continue;
    const sp = { x: seed % W, y: (seed / W) | 0 };
    const d = o.distance(sp);
    if (d < o.minDist || d > o.maxDist) continue;
    const hit = (k: string): void => {
      if (o.trace) o.trace[k] = (o.trace[k] ?? 0) + 1;
    };

    /**
     * 目标格数：**每次候选随机 8~20**，不是"能长到 20 就长到 20"。
     *
     * ★ 血债：固定长满 20 格，在 24×24 四家的小图上几乎必然失败 —— 20 格的
     *   外圈有 10~14 格，其中任何一格是城镇/英雄出生格/已有物件就整块作废。
     *   实测 ring/small 的 D1 档 `rimHasObject` 单档 133~137 次（整个 5~9 环带
     *   只有约 150 个候选起点）⇒ 三张图直接少一块 D1，[G1] 红。
     *   8~20 是 §18.1 给的范围，随机取目标既在规格内，又让紧凑的小口袋多起来。
     */
    const target = POCKET_MIN_CELLS +
      Math.floor(o.rng() * (POCKET_MAX_CELLS - POCKET_MIN_CELLS + 1));
    // 随机顺序 BFS 长出一块紧凑面（上限 = target）
    const inRegion = new Set<number>([seed]);
    const queue = [seed];
    for (let h = 0; h < queue.length && inRegion.size < target; h++) {
      const c = queue[h];
      const cx = c % W;
      const cy = (c / W) | 0;
      const dirs = shuffle(o.rng, DIRS.map((v) => v));
      for (const [dx, dy] of dirs) {
        if (inRegion.size >= target) break;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (inRegion.has(ni) || !eligible(ni)) continue;
        if (avoidMask && avoidMask[ni]) continue;
        inRegion.add(ni);
        queue.push(ni);
      }
    }
    if (inRegion.size < POCKET_MIN_CELLS) { hit('blobTooSmall'); continue; }

    // 外圈：所有贴着内部的格子（按"贴住几个内部格"计数）
    const touch = new Map<number, number>();
    for (const c of inRegion) {
      const cx = c % W;
      const cy = (c / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (inRegion.has(ni)) continue;
        touch.set(ni, (touch.get(ni) ?? 0) + 1);
      }
    }

    const walls: GridPos[] = [];
    const gates: number[] = [];
    let sealable = true;
    for (const [i, n] of touch) {
      const x = i % W;
      const y = (i / W) | 0;
      if (!isPassable(map, x, y)) continue; // 水/山本身就是墙，不用种树
      /**
       * 已有物件 ⇒ 堵不上，等于第二个口。
       *
       * ★ `blocked`（城镇门 / 英雄出生格 / 已围好的口袋）**同样堵不上** —— 这条是血债：
       *   英雄出生格在引擎里不是 `MapObject`（`objectId` 为空），只靠上面那条会漏过去，
       *   墙直接种在英雄脚下 ⇒ 那颗棋子整局动不了、也走不回来（实测 wild small seed 70453
       *   的 `hero_p3` 就这么被封死的）。内部早就用 `eligible()` 挡了 `blocked`，外圈漏了。
       */
      if (map.tiles[i].objectId || o.blocked.has(i)) {
        sealable = false;
        break;
      }
      // 只有"只贴住一个内部格"的外圈格才配当门（否则门内是斜着的一排，读不出"一个口"）
      if (n === 1) gates.push(i);
      walls.push({ x, y });
    }
    if (!sealable) { hit('rimHasObject'); continue; }
    if (!gates.length) { hit('noGateCell'); continue; }
    // 外圈可通行格很少 = 这块被山/水天然围住，只剩一个口。那是最理想的洞穴，
    // 不是"没围起来"。"到底围没围住"由生成器的漏水检验（oneDoor）负责，不靠外圈长度猜。

    hit('found');

    const gateIdx = gates[Math.floor(o.rng() * gates.length) % gates.length];
    const gate = { x: gateIdx % W, y: (gateIdx / W) | 0 };
    return {
      cells: [...inRegion].map((i) => ({ x: i % W, y: (i / W) | 0 })),
      gate,
      walls: walls.filter((w) => !(w.x === gate.x && w.y === gate.y)),
      dist: d,
    };
  }
  return null;
}

/** 口袋内部离入口最远的一格（奖励放这儿，跟着守卫的距离感最对）。 */
export function deepestCell(shell: PocketShell, dist: (a: GridPos, b: GridPos) => number): GridPos {
  let best = shell.cells[0];
  let bestD = -1;
  for (const c of shell.cells) {
    const d = dist(c, shell.gate);
    if (d > bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** 口袋内部（含外圈）的格子索引集合，用于去重与探针。 */
export function shellIndexSet(map: GameMap, shell: PocketShell): Set<number> {
  const s = new Set<number>();
  for (const c of shell.cells) s.add(idx(map, c.x, c.y));
  for (const c of shell.walls) s.add(idx(map, c.x, c.y));
  s.add(idx(map, shell.gate.x, shell.gate.y));
  return s;
}

function shuffle<T>(rng: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}
