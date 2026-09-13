/**
 * 六边形战场坐标系统（HOMM2 / HOMM3 战斗网格的做法）。
 *
 * 采用 pointy-top（尖顶）+ odd-r 偏移：
 *   - 每个格子是"上下带尖角、左右是竖边"的六边形；
 *   - 奇数行整体右移半格，于是横排看起来像错缝的砖墙——这正是 HOMM 战场的样子。
 *
 * 所有几何运算都先转成 axial（轴向）坐标再做，偏移坐标只用于"存储 + 画格子"，
 * 这样邻居、距离、视线这些容易写错的地方只剩一份实现。
 */

export interface Hex {
  col: number;
  row: number;
}

/** 战场尺寸。比 HOMM2 的 13×9 稍大一点，给远程和包抄留出空间。 */
export const FIELD_W = 15;
export const FIELD_H = 11;

/* ---------------- 坐标转换 ---------------- */

function odd(r: number): number {
  return ((r % 2) + 2) % 2;
}

/** offset(odd-r) → axial(q, r) */
function toAxial(h: Hex): [number, number] {
  return [h.col - ((h.row - odd(h.row)) >> 1), h.row];
}

/** axial(q, r) → offset(odd-r) */
function fromAxial(q: number, r: number): Hex {
  return { col: q + ((r - odd(r)) >> 1), row: r };
}

/** axial → cube，距离与插值都在 cube 空间里算。 */
function toCube(q: number, r: number): [number, number, number] {
  return [q, -q - r, r];
}

function cubeRound(x: number, y: number, z: number): [number, number] {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx, rz];
}

export function hexKey(h: Hex): string {
  return `${h.col},${h.row}`;
}

export function hexEq(a: Hex, b: Hex): boolean {
  return a.col === b.col && a.row === b.row;
}

export function inField(h: Hex): boolean {
  return h.col >= 0 && h.col < FIELD_W && h.row >= 0 && h.row < FIELD_H;
}

export function hexList(): Hex[] {
  const out: Hex[] = [];
  for (let row = 0; row < FIELD_H; row++) for (let col = 0; col < FIELD_W; col++) out.push({ col, row });
  return out;
}

/* ---------------- 邻居 / 距离 / 视线 ---------------- */

/** axial 六方向：东、东北、西北、西、西南、东南。 */
const DIRS: [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export function neighbors(h: Hex): Hex[] {
  const [q, r] = toAxial(h);
  return DIRS.map(([dq, dr]) => fromAxial(q + dq, r + dr));
}

/** 相邻（距离 1）判断，比走一遍 neighbors 便宜。 */
export function isAdjacent(a: Hex, b: Hex): boolean {
  return distance(a, b) === 1;
}

export function distance(a: Hex, b: Hex): number {
  const [aq, ar] = toAxial(a);
  const [bq, br] = toAxial(b);
  const [ax, ay, az] = toCube(aq, ar);
  const [bx, by, bz] = toCube(bq, br);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}

/** 两格之间的直线（含首尾）。用于远程射击的遮挡判定。 */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = distance(a, b);
  if (n <= 0) return [{ ...a }];
  const [aq, ar] = toAxial(a);
  const [bq, br] = toAxial(b);
  const [ax, ay, az] = toCube(aq, ar);
  const [bx, by, bz] = toCube(bq, br);
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [q, r] = cubeRound(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
    out.push(fromAxial(q, r));
  }
  return out;
}

/** 广度优先：从 from 出发最多 maxSteps 步，blocked 里的格子不可进入。 */
export function bfs(from: Hex, maxSteps: number, blocked: (h: Hex) => boolean): Map<string, Hex[]> {
  const out = new Map<string, Hex[]>();
  if (blocked(from)) return out;
  out.set(hexKey(from), []);
  let frontier: Hex[] = [{ ...from }];
  for (let step = 0; step < maxSteps; step++) {
    const next: Hex[] = [];
    for (const cur of frontier) {
      const curPath = out.get(hexKey(cur))!;
      for (const nb of neighbors(cur)) {
        if (!inField(nb) || blocked(nb)) continue;
        const k = hexKey(nb);
        if (out.has(k)) continue;
        out.set(k, [...curPath, nb]);
        next.push(nb);
      }
    }
    if (!next.length) break;
    frontier = next;
  }
  return out;
}

/** 在 A* 缺失的情况下，给 AI 一个"往目标走"的贪心步。 */
export function stepToward(from: Hex, to: Hex, passable: (h: Hex) => boolean): Hex | null {
  let best: Hex | null = null;
  let bestD = distance(from, to);
  for (const nb of neighbors(from)) {
    if (!inField(nb) || !passable(nb)) continue;
    const d = distance(nb, to);
    if (d < bestD) {
      bestD = d;
      best = nb;
    }
  }
  return best;
}

/* ---------------- 像素几何 ---------------- */

/** 六边形外接圆半径（= 尖角到中心的距离）。 */
export const HEX_SIZE = 22;
/** 单格精灵尺寸：宽度取 40 是为了把左右两个尖角完整装进去（略大于 √3×22≈38.1）。 */
export const HEX_SPRITE_W = 40;
export const HEX_SPRITE_H = 46;
/** 相邻格中心间距：横向 √3×size≈38，纵向 1.5×size=33。 */
export const HEX_STEP_X = 38;
export const HEX_STEP_Y = 33;

/** 格子中心在战场位图中的坐标。 */
export function hexCenter(h: Hex): { x: number; y: number } {
  return {
    x: HEX_SPRITE_W / 2 + h.col * HEX_STEP_X + odd(h.row) * (HEX_STEP_X / 2),
    y: HEX_SPRITE_H / 2 + h.row * HEX_STEP_Y,
  };
}

export const FIELD_PX_W = HEX_SPRITE_W / 2 + (FIELD_W - 1) * HEX_STEP_X + HEX_STEP_X / 2 + HEX_SPRITE_W / 2;
export const FIELD_PX_H = HEX_SPRITE_H / 2 + (FIELD_H - 1) * HEX_STEP_Y + HEX_SPRITE_H / 2;

/** 鼠标/触摸点 → 格子。先转 axial 再做 cube 取整，边界处不会选错格。 */
export function pickHex(px: number, py: number): Hex {
  const x = px - HEX_SPRITE_W / 2;
  const y = py - HEX_SPRITE_H / 2;
  const q = ((Math.sqrt(3) / 3) * x - y / 3) / HEX_SIZE;
  const r = ((2 / 3) * y) / HEX_SIZE;
  const [cq, cr] = cubeRound(...toCube(q, r));
  return fromAxial(cq, cr);
}
