import type {
  Army,
  GameConfig,
  GameMap,
  GameState,
  GridPos,
  GuardReward,
  Hero,
  MapLayout,
  MapObject,
  PlayerState,
  ResourceBag,
  ResourceKind,
  TerrainKind,
  Town,
} from '../types.js';
import { MAP_SIZES } from '../types.js';
import { TERRAIN } from '../data/terrains.js';
import { ARTIFACTS } from '../data/artifacts.js';
import { LAYOUTS } from '../data/layouts.js';
import {
  HOME_MINE_RING,
  MINE_PER_DAY,
  RARE_RESOURCES,
  VAULTS,
  vaultRareBundle,
} from '../data/mines.js';
import { HERO_TEMPLATES, START_ARMY } from '../data/heroes.js';
import { DEFAULT_CONFIG, DIFFICULTIES, FACTIONS, FACTION_ORDER } from '../data/factions.js';
import { mulberry32, randInt, shuffle, pick } from '../rng.js';
import { maxMovePoints } from '../game/hero.js';
import { castleCells, idx, isPassable } from './grid.js';
import { revealAround } from './fog.js';

export const BASE_MOVE_POINTS = 1800;
export const HERO_SIGHT = 5;
/** 存档兼容用的默认尺寸；真正的尺寸取自 config.size。 */
export const MAP_W = MAP_SIZES.medium.width;
export const MAP_H = MAP_SIZES.medium.height;

/* ---------------- noise ---------------- */

function noiseField(rng: () => number, w: number, h: number, cells: number): number[] {
  const gw = cells + 2;
  const g: number[] = [];
  for (let i = 0; i < gw * gw; i++) g.push(rng());
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const out = new Array<number>(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cells;
      const fy = (y / h) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = smooth(fx - x0);
      const ty = smooth(fy - y0);
      const i00 = g[(y0 + 1) * gw + (x0 + 1)];
      const i10 = g[(y0 + 1) * gw + (x0 + 2)];
      const i01 = g[(y0 + 2) * gw + (x0 + 1)];
      const i11 = g[(y0 + 2) * gw + (x0 + 2)];
      const a = i00 + (i10 - i00) * tx;
      const b = i01 + (i11 - i01) * tx;
      out[y * w + x] = a + (b - a) * ty;
    }
  }
  return out;
}

function fbm(rng: () => number, w: number, h: number): number[] {
  const o1 = noiseField(rng, w, h, 3);
  const o2 = noiseField(rng, w, h, 6);
  const o3 = noiseField(rng, w, h, 12);
  const out = new Array<number>(w * h);
  for (let i = 0; i < out.length; i++) out[i] = o1[i] * 0.6 + o2[i] * 0.3 + o3[i] * 0.1;
  return out;
}

/* ---------------- 宏观布局（M8） ---------------- */

/** 把 0~1 的噪声压到一条基准线附近：base ± amp/2。噪声只负责"纹理"。 */
function band(noise: number, base: number, amp: number): number {
  return base + (noise - 0.5) * amp;
}

/** 水面基准线（低于 classify 的 0.3 阈值），陆地基准线（落在草地~土路之间）。 */
const SEA = 0.12;
const LAND = 0.5;
/** 渡口/桥梁的基准高度：落在"土路"那一档，跨水的地方一眼能认出来是条路。 */
const CAUSEWAY = 0.66;

/**
 * 同心环的几条半径（**单位是格，不是归一化值**）。
 *
 * 这里刻意用绝对格数而不是"半径的百分比"：用百分比时小图上两道护城河加起来
 * 才一格宽，玩家看到的是一圈虚线；用格数则小/中/大三张图的河宽手感一致。
 * 主城环（home）取"外护城河外沿再往外一点"，并留在地图九成半径以内，
 * 免得城堡被海岸线吞掉。
 */
function ringRadii(w: number, h: number): {
  R: number;
  core: number;
  inner: number;
  ringEnd: number;
  outer: number;
  home: number;
} {
  const min = Math.min(w, h);
  const R = min / 2;
  const core = Math.max(3, min * 0.14);
  const moat = Math.max(1.5, min * 0.06);
  const inner = core + moat;
  const ringEnd = Math.max(inner + 2.5, min * 0.26);
  const outer = ringEnd + moat;
  return { R, core, inner, ringEnd, outer, home: Math.min(R * 0.9, outer + min * 0.1) };
}

/**
 * 按布局模板重写高度场。
 *
 * 关键取舍：**在噪声之上"盖章"，而不是替换噪声**。
 * 先用半径/距中线距离这类几何量划出结构带，再把每格的原噪声塞回带内，
 * 于是同一档布局在每局都保持同一个骨架，湖岸线却又各不相同。
 * 渡口/桥梁一律**最后刻**，盖在带之上——它们是布局的"承重墙"，
 * 一旦被别的规则改掉，整张图就断开成走不到的孤岛。
 */
function applyLayout(layout: MapLayout, height: number[], w: number, h: number, rng: () => number): void {
  if (layout === 'wild') return;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const put = (x: number, y: number, v: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    height[y * w + x] = v;
  };

  if (layout === 'ring') {
    // 三层环带：中心高地（最富）→ 内护城河 → 内环（金矿）→ 外护城河 → 外环（四家起手）
    const N = height.slice();
    const { R: rR, core, inner, ringEnd, outer } = ringRadii(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const r = Math.hypot(x - cx, y - cy);
        const n = N[i];
        if (r < core) height[i] = band(n, 0.8, 0.14); // 中央高地：岩地雪原，藏着强档宝库
        else if (r < inner) height[i] = band(n, SEA, 0.08); // 内护城河
        else if (r < ringEnd) height[i] = band(n, 0.52, 0.2); // 内环：金矿与中等野怪
        else if (r < outer) height[i] = band(n, SEA, 0.08); // 外护城河
        else height[i] = band(n, LAND, 0.24); // 外环：四家起手区
      }
    }
    // 三处渡口：沿半径刻一条两格宽的浅滩，把三层串起来
    const gaps = 3;
    for (let g = 0; g < gaps; g++) {
      const ang = (g * Math.PI * 2) / gaps + (rng() - 0.5) * 0.7;
      for (let t = 0; t <= rR + 2; t += 0.5) {
        const x = Math.round(cx + Math.cos(ang) * t);
        const y = Math.round(cy + Math.sin(ang) * t);
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
          put(x + dx, y + dy, band(rng(), CAUSEWAY, 0.08));
        }
      }
    }
    return;
  }

  if (layout === 'islands') {
    // 一条蜿蜒的纵向海峡：用正弦把中线推开，看起来像真实的海峡而不是一条直沟
    const phase = rng() * Math.PI * 2;
    const amp = 1.2 + rng() * 1.1;
    const half = 1.5;
    const center = (y: number): number => cx + Math.sin(y * 0.4 + phase) * amp;
    const N = height.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const d = Math.abs(x - center(y));
        height[i] = d < half ? band(N[i], SEA, 0.08) : band(N[i], LAND, 0.24);
      }
    }
    // 两座桥：横向切过海峡（各两格宽，天然是"桥头堡"）
    for (let b = 0; b < 2; b++) {
      const by = Math.round(h * (0.26 + 0.42 * b) + (rng() - 0.5) * h * 0.06);
      for (let dy = 0; dy < 2; dy++) {
        for (let x = 0; x < w; x++) {
          if (Math.abs(x - center(by + dy)) < half + 2) {
            put(x, by + dy, band(rng(), CAUSEWAY, 0.08));
          }
        }
      }
    }
    return;
  }

  // lanes：两条横向河脊把地图切成三条走廊
  const ridges = [Math.round(h / 3), Math.round((2 * h) / 3)];
  const isRidge = new Set<number>();
  for (const r of ridges) {
    isRidge.add(r - 1);
    isRidge.add(r);
  }
  const N = height.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      height[i] = isRidge.has(y) ? band(N[i], SEA, 0.08) : band(N[i], LAND, 0.24);
    }
  }
  // 每条河脊只留两个缺口：绕路还是正面突破，是这张图的核心决策
  for (const r of ridges) {
    for (const base of [0.3, 0.7]) {
      const x0 = Math.max(
        2,
        Math.min(w - 4, Math.round(w * base + (rng() - 0.5) * w * 0.1)),
      );
      for (let dy = -1; dy <= 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          put(x0 + dx, r + dy, band(rng(), CAUSEWAY, 0.08));
        }
      }
    }
  }
}

/* ---------------- terrain ---------------- */

function buildTerrain(
  seed: number,
  w: number,
  h: number,
  layout: MapLayout,
): { map: GameMap; height: number[] } {
  const rngH = mulberry32(seed);
  const rngM = mulberry32(seed ^ 0x9e3779b9);
  const height = fbm(rngH, w, h);
  const moisture = fbm(rngM, w, h);

  // 布局在噪声之后、海岸线之前盖章：结构由模板定，纹理由种子定
  applyLayout(layout, height, w, h, mulberry32(seed ^ 0x1f2e3d4c));

  // 边缘一圈强制为水，形成自然海岸线（放在布局之后，否则模板会把边框变回陆地）
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edge === 0) height[y * w + x] = Math.min(height[y * w + x], 0.18);
      else if (edge === 1) height[y * w + x] *= 0.85;
    }
  }

  const map: GameMap = { width: w, height: h, tiles: [], objects: {} };
  for (let i = 0; i < w * h; i++) {
    const hh = height[i];
    const m = moisture[i];
    let t: TerrainKind;
    if (hh < 0.3) t = 'water';
    else if (hh < 0.36) t = 'sand';
    else if (hh < 0.62) t = m > 0.62 ? 'swamp' : 'grass';
    else if (hh < 0.74) t = 'dirt';
    else if (hh < 0.86) t = 'rock';
    else t = 'snow';
    map.tiles.push({ terrain: t, objectId: null });
  }
  return { map, height };
}

/** 只保留最大的连通陆地块，其余淹没为水，避免出现走不到的孤岛。 */
function keepLargestLandmass(map: GameMap): void {
  const n = map.width * map.height;
  const seen = new Uint8Array(n);
  let best: number[] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    if (!TERRAIN[map.tiles[s].terrain].passable) continue;
    const comp: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      comp.push(c);
      const cx = c % map.width;
      const cy = (c / map.width) | 0;
      const nb = [
        [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1],
      ];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const ni = ny * map.width + nx;
        if (seen[ni]) continue;
        if (!TERRAIN[map.tiles[ni].terrain].passable) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    if (comp.length > best.length) best = comp;
  }
  const keep = new Uint8Array(n);
  for (const c of best) keep[c] = 1;
  for (let i = 0; i < n; i++) {
    if (TERRAIN[map.tiles[i].terrain].passable && !keep[i]) map.tiles[i].terrain = 'water';
  }
}

/* ---------------- objects ---------------- */

class ObjectPlacer {
  private next = 1;
  constructor(private map: GameMap) {}

  add(obj: Omit<MapObject, 'id'>): MapObject {
    const id = `o${this.next++}`;
    const full: MapObject = { id, ...obj };
    this.map.objects[id] = full;
    this.map.tiles[idx(this.map, obj.pos.x, obj.pos.y)].objectId = id;
    return full;
  }

  get counter(): number {
    return this.next;
  }
}

function freeTiles(map: GameMap, exclude: Set<number>): number[] {
  const out: number[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = idx(map, x, y);
      if (exclude.has(i)) continue;
      if (!isPassable(map, x, y)) continue;
      if (map.tiles[i].objectId) continue;
      out.push(i);
    }
  }
  return out;
}

/** 从 start 出发做 4 邻域 BFS，检查 reserved 里的格子是否都还连着。 */
function allReachable(map: GameMap, start: GridPos, reserved: number[]): boolean {
  const seen = new Uint8Array(map.width * map.height);
  const s = idx(map, start.x, start.y);
  const stack = [s];
  seen[s] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const cx = c % map.width;
    const cy = (c / map.width) | 0;
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const ni = ny * map.width + nx;
      if (seen[ni] || !isPassable(map, nx, ny)) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return reserved.every((i) => seen[i] === 1);
}

function detachObject(map: GameMap, id: string): void {
  const obj = map.objects[id];
  if (!obj) return;
  const t = map.tiles[idx(map, obj.pos.x, obj.pos.y)];
  if (t.objectId === id) t.objectId = null;
  delete map.objects[id];
}

function reachableFrom(map: GameMap, start: GridPos): Uint8Array {
  const n = map.width * map.height;
  const seen = new Uint8Array(n);
  const s = idx(map, start.x, start.y);
  const stack = [s];
  seen[s] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const cx = c % map.width;
    const cy = (c / map.width) | 0;
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const ni = ny * map.width + nx;
      if (seen[ni]) continue;
      if (!isPassable(map, nx, ny)) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return seen;
}

/* ---------------- 城堡选址（2×2，正面开门） ---------------- */

/** 城门外侧的两个正交邻居（西 / 南）里有几个能站人 —— 这就是"正面开口"。 */
function gateOpenings(map: GameMap, gate: GridPos): number {
  let n = 0;
  if (isPassable(map, gate.x - 1, gate.y)) n += 1;
  if (isPassable(map, gate.x, gate.y + 1)) n += 1;
  return n;
}

/** 2×2 外圈能站人的格子数。用来挑"不憋屈"的地址，纯观感偏好。 */
function castleRoom(map: GameMap, gate: GridPos): number {
  let n = 0;
  for (let dy = -1; dy <= 2; dy++) {
    for (let dx = -1; dx <= 2; dx++) {
      if (dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1) continue; // 城堡自身占地
      if (isPassable(map, gate.x + dx, gate.y + dy)) n += 1;
    }
  }
  return n;
}

/**
 * 2×2 城堡能不能落在以 gate 为城门的位置上。
 *
 * 硬性条件只有两条：四格都得是没被占用的可通行地形；正面至少留一个开口。
 * 第二条最容易被忽略 —— 没有开口就等于英雄被自己家的城墙关在门外，
 * 那座城等于不存在，比"城挤在角落里"严重得多。
 */
function castleFits(map: GameMap, gate: GridPos): boolean {
  if (gate.x < 1 || gate.y < 1) return false;
  for (const c of castleCells(gate)) {
    if (c.x < 0 || c.y < 0 || c.x >= map.width || c.y >= map.height) return false;
    const t = map.tiles[idx(map, c.x, c.y)];
    if (t.objectId) return false;
    if (!TERRAIN[t.terrain].passable) return false;
  }
  return gateOpenings(map, gate) >= 1;
}

/**
 * 野怪规模是按"战术战场"实测出来的，不是拍脑袋：
 * 起手 20 弓手在 15×11 战场上能白嫖 3~4 轮射击，所以怪必须扛得住那几轮才有威胁。
 * 目标手感：弱 ≈ 稳赢小亏、中 ≈ 赢得下来但肉疼、强 ≈ 一半一半、绝望档必败。
 *
 * `mul`（默认 1）是难度对野怪的缩放倍率（monsterMul）。
 * 红线：倍率必须施加在 `randInt()` **之后**，`randInt` 的调用次数与顺序绝不能变，
 * 否则同种子生成的地图（地形 / 城镇坐标 / 野怪点位）会全部错位。
 * 用 `Math.max(1, Math.round(...))` 兜底，避免倍率过低把某个兵栈缩成 0 而崩战斗。
 */
export function monsterArmy(
  rng: () => number,
  tier: 'weak' | 'mid' | 'strong',
  mul = 1,
): Army {
  const scale = (count: number): number => Math.max(1, Math.round(count * mul));
  if (tier === 'weak') return [{ unitTypeId: 'wolf', count: scale(randInt(rng, 20, 28)) }];
  if (tier === 'mid') {
    return rng() < 0.5
      ? [{ unitTypeId: 'boar', count: scale(randInt(rng, 11, 15)) }]
      : [{ unitTypeId: 'wolf', count: scale(randInt(rng, 18, 26)) }, { unitTypeId: 'boar', count: scale(randInt(rng, 4, 7)) }];
  }
  return rng() < 0.5
    ? [{ unitTypeId: 'ogre', count: scale(randInt(rng, 10, 13)) }]
    : [{ unitTypeId: 'boar', count: scale(randInt(rng, 7, 10)) }, { unitTypeId: 'ogre', count: scale(randInt(rng, 5, 7)) }];
}

/** 野怪看守的东西：越强的怪守得越值钱，其中一部分守着能长期产出的矿。 */
function guardFor(rng: () => number, tier: 'weak' | 'mid' | 'strong'): GuardReward {
  const r = rng();
  if (tier === 'weak') {
    if (r < 0.55) return { kind: 'gold', amount: randInt(rng, 700, 1600) };
    return { kind: 'resource', resource: rng() < 0.5 ? 'wood' : 'ore', amount: randInt(rng, 4, 9) };
  }
  if (tier === 'mid') {
    if (r < 0.4) return { kind: 'artifact', artifactId: pick(rng, Object.keys(ARTIFACTS)) };
    if (r < 0.75) return { kind: 'gold', amount: randInt(rng, 1800, 3200) };
    return { kind: 'resource', resource: rng() < 0.5 ? 'wood' : 'ore', amount: randInt(rng, 8, 14) };
  }
  if (r < 0.45) return { kind: 'artifact', artifactId: pick(rng, Object.keys(ARTIFACTS)) };
  return { kind: 'gold', amount: randInt(rng, 3500, 6500) };
}

function mineGuard(rng: () => number, tier: 'weak' | 'mid' | 'strong'): GuardReward {
  // 守着矿的野怪：强档守金矿，中弱档守木/石矿。稀有矿不靠掉落，直接摆在深处（见下）
  if (tier === 'strong') return { kind: 'mine', resource: 'gold', perDay: MINE_PER_DAY.gold };
  const res = rng() < 0.5 ? 'wood' : 'ore';
  return { kind: 'mine', resource: res, perDay: MINE_PER_DAY[res] };
}

/**
 * 各阵营主城的**理想锚点**。
 *
 * 旷野与同心环沿用"围绕地图中心的正多边形"：整体旋转 + 整体平移，
 * 于是任意两家的相对距离在每一局里都完全相等，谁也不会抽到更近的邻居，
 * 但整张布局随种子旋转，每局的开局方位又不一样。
 * 双子岛与三路走廊则直接给出"这一档该在哪一带"的锚点——地形骨架已经明确了，
 * 主城再随机就白做了。
 */
function layoutHomeIdeals(
  rng: () => number,
  layout: MapLayout,
  w: number,
  h: number,
  count: number,
): GridPos[] {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const min = Math.min(w, h);
  const jit = (amount: number): number => (rng() - 0.5) * amount;

  if (layout === 'islands') {
    // 一岛一家（两家时），四家时每岛两家、一北一南
    const wx = Math.round(w * 0.23);
    const ex = Math.round(w * 0.77);
    const seq: GridPos[] = [
      { x: wx, y: Math.round(cy) },
      { x: ex, y: Math.round(cy) },
      { x: wx, y: Math.round(h * 0.28) },
      { x: ex, y: Math.round(h * 0.72) },
    ];
    return seq.slice(0, count).map((p) => ({ x: p.x + jit(min * 0.08), y: p.y + jit(min * 0.08) }));
  }

  if (layout === 'lanes') {
    // 走廊两端：p1 固定在中路西端，对手分别占中路东端与上下两路
    const laneY = [0, 1, 2].map((i) => Math.round(((i + 0.5) * h) / 3));
    const lx = Math.round(w * 0.14);
    const rx = Math.round(w * 0.86);
    const seq: GridPos[] = [
      { x: lx, y: laneY[1] },
      { x: rx, y: laneY[1] },
      { x: lx, y: laneY[0] },
      { x: rx, y: laneY[2] },
    ];
    return seq.slice(0, count).map((p) => ({ x: p.x + jit(min * 0.08), y: p.y + jit(min * 0.06) }));
  }

  // wild / ring：围绕中心的正多边形，p1 从正左方出发，其余按逆时针均分
  // 同心环的主城必须落在"外护城河之外"，所以半径直接取环带几何算出来的 home
  const radius = layout === 'ring' ? ringRadii(w, h).home : min * 0.35;
  const rot = (rng() - 0.5) * Math.PI * 0.5;
  const jx = (rng() - 0.5) * 4;
  const jy = (rng() - 0.5) * 4;
  const out: GridPos[] = [];
  for (let k = 0; k < count; k++) {
    const angle = Math.PI + rot + (k * Math.PI * 2) / count;
    out.push({
      x: Math.round(cx + jx + Math.cos(angle) * radius),
      y: Math.round(cy + jy + Math.sin(angle) * radius),
    });
  }
  return out;
}

/**
 * 把理想锚点"吸附"到真正放得下 2×2 城堡的格子上。
 *
 * 只从 `castleFits` 通过的格子（城门位）里挑，否则后面还要回退，得不偿失。
 */
function snapHomeSpots(
  map: GameMap,
  land: number[],
  w: number,
  h: number,
  ideals: GridPos[],
): GridPos[] {
  const toPos = (i: number): GridPos => ({ x: i % w, y: (i / w) | 0 });
  const count = ideals.length;
  const minGap = Math.max(8, Math.round(Math.min(w, h) * 0.3));

  const fits = land.map(toPos).filter((p) => castleFits(map, p));
  if (fits.length < count) return [];
  /** 外圈宽敞一点，别把城堡塞进一格宽的缝里。 */
  const roomy = (p: GridPos): boolean => castleRoom(map, p) >= 8;

  const out: GridPos[] = [];
  for (let k = 0; k < count; k++) {
    const ideal = ideals[k];
    const gapOk = fits.filter((p) =>
      out.every((o) => Math.abs(o.x - p.x) + Math.abs(o.y - p.y) >= minGap),
    );
    // 优先挑四周有地的格子；一张图如果全都不宽敞（小地图），再逐步放宽间距
    const roomyOk = gapOk.filter(roomy);
    let pool = roomyOk.length ? roomyOk : gapOk;
    if (!pool.length) {
      const loose = Math.max(4, Math.round(minGap / 2));
      pool = fits.filter((p) =>
        out.every((o) => Math.abs(o.x - p.x) + Math.abs(o.y - p.y) >= loose),
      );
    }
    // 城堡是后放的，前面几座会把地占掉：选之前再按当前地图复核一次，
    // 顺带挡住"两座 2×2 叠在一起"（叠了会互相覆盖 tile 上的 objectId）
    pool = pool.filter(
      (p) =>
        castleFits(map, p) &&
        out.every((o) => Math.max(Math.abs(o.x - p.x), Math.abs(o.y - p.y)) >= 2),
    );
    if (!pool.length) return [];
    let best = pool[0];
    let bestD = Infinity;
    for (const p of pool) {
      const d = Math.hypot(p.x - ideal.x, p.y - ideal.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    out.push(best);
  }
  return out;
}

/** 挑一个远离地图边缘、距主城一定距离的地块做中立城，避免它躲在角落里永远找不到。
 *  距离档位按地图尺寸缩放，否则小地图上凑不出候选点、大地图上又全挤在门口。 */
function pickTownSpots(
  rng: () => number,
  land: number[],
  w: number,
  h: number,
  homePos: GridPos,
  count: number,
  fits: (p: GridPos) => boolean,
): GridPos[] {
  const toPos = (i: number): GridPos => ({ x: i % w, y: (i / w) | 0 });
  const k = Math.min(w, h) / 32;
  const dHome = (p: GridPos) => Math.abs(p.x - homePos.x) + Math.abs(p.y - homePos.y);
  const gap = Math.max(6, Math.round(8 * k));

  const pool = (min: number, max: number): number[] =>
    land.filter((i) => {
      const p = toPos(i);
      const edge = Math.min(p.x, p.y, w - 1 - p.x, h - 1 - p.y);
      if (edge < 2) return false;
      const d = dHome(p);
      if (d < min || d > max) return false;
      return fits(p); // 中立城同样是 2×2，放不下就不能选
    });

  let candidates = shuffle(rng, pool(Math.round(14 * k), Math.round(24 * k)));
  if (candidates.length < count) candidates = shuffle(rng, pool(Math.round(11 * k), Math.round(30 * k)));
  if (candidates.length < count) candidates = shuffle(rng, pool(Math.round(8 * k), Math.round(40 * k)));

  const chosen: GridPos[] = [];

  /** 两座 2×2 城堡只在城门格 Chebyshev 距离 ≥2 时才互不重叠。 */
  const clear = (p: GridPos): boolean =>
    chosen.every((c) => Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) >= 2);

  for (const i of candidates) {
    const p = toPos(i);
    if (chosen.length >= count) break;
    // 城与城之间留出间隔，避免两座中立城挤在一起
    if (chosen.every((c) => Math.abs(c.x - p.x) + Math.abs(c.y - p.y) >= gap)) chosen.push(p);
  }
  // 兜底：实在挑不出就放宽间距，但**绝不能重叠** —— 重叠的两座城会互相覆盖
  // tile 上的 objectId，结果就是"城堡有 2 格能站人"，找路和渲染都会跟着错。
  let i = 0;
  while (chosen.length < count && i < candidates.length) {
    const p = toPos(candidates[i++]);
    if (clear(p) && fits(p)) chosen.push(p);
  }
  return chosen;
}

/* ---------------- entry ---------------- */

const NEUTRAL_NAMES = ['荒废哨塔', '风蚀要塞', '灰岩堡', '碎石关卡', '枯井村', '远望台'];

/** 开局设置：可以只传种子（保持 `createGame(42)` 的老用法），也可以传完整配置。 */
export type GenOptions = Partial<GameConfig>;

function normalizeConfig(opts: number | GenOptions): GameConfig {
  const o: GenOptions = typeof opts === 'number' ? { seed: opts } : opts;
  const rawName = (o.playerName ?? '').trim();
  return {
    size: o.size ?? DEFAULT_CONFIG.size,
    seed: o.seed ?? Math.floor(Math.random() * 1e9),
    // 老存档/老调用没有 layout 字段：补成旷野，行为与 M7 完全一致
    layout: o.layout && LAYOUTS[o.layout] ? o.layout : DEFAULT_CONFIG.layout,
    opponents: Math.max(0, Math.min(3, Math.floor(o.opponents ?? DEFAULT_CONFIG.opponents))),
    difficulty: o.difficulty ?? DEFAULT_CONFIG.difficulty,
    playerName: rawName || DEFAULT_CONFIG.playerName,
  };
}

export function createGame(opts: number | GenOptions = {}): GameState {
  return buildGame(normalizeConfig(opts), 0);
}

/**
 * 地形不理想时换个种子重试的**上限**。
 * 超过上限说明这一档布局在这组设置下根本落不下四座城（比如小图上被水切得太碎），
 * 那就退回旷野——旷野是验证过的最强兜底。没有这道闸，重试会一路递归到栈溢出。
 */
const MAX_GEN_ATTEMPTS = 20;

function buildGame(cfg: GameConfig, attempt: number): GameState {
  if (attempt >= MAX_GEN_ATTEMPTS) {
    if (cfg.layout !== 'wild') return buildGame({ ...cfg, layout: 'wild' }, 0);
    // 旷野都生不出来只能认账：给一张最小尺寸的图，至少不崩
    if (cfg.size !== 'small') return buildGame({ ...cfg, size: 'small' }, 0);
  }
  // 地形不理想时换个种子重试，所以实际种子会带上重试次数
  const seed = (cfg.seed + attempt * 7919) >>> 0;
  const size = MAP_SIZES[cfg.size];
  const w = size.width;
  const h = size.height;
  /** 物件密度按面积缩放，小图不至于挤满、大图不至于空旷。 */
  const k = (w * h) / (MAP_SIZES.medium.width * MAP_SIZES.medium.height);

  const { map } = buildTerrain(seed, w, h, cfg.layout);
  keepLargestLandmass(map);

  const rng = mulberry32(seed ^ 0x5bf03635);
  const diff = DIFFICULTIES[cfg.difficulty];
  const placer = new ObjectPlacer(map);
  const toPos = (i: number): GridPos => ({ x: i % w, y: (i / w) | 0 });

  const land: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (isPassable(map, i % w, (i / w) | 0)) land.push(i);
  }
  if (land.length < Math.round(150 * k)) return buildGame(cfg, attempt + 1);

  // 1. 各阵营主城：先按布局模板取理想锚点，再吸附到真正放得下城堡的格子
  const factions = FACTION_ORDER.slice(0, 1 + cfg.opponents);
  const ideals = layoutHomeIdeals(rng, cfg.layout, w, h, factions.length);
  const homeSpots = snapHomeSpots(map, land, w, h, ideals);
  // 地图太碎、放不下这么多 2×2 城堡 → 换个偏移种子重掷地形
  if (homeSpots.length < factions.length) return buildGame(cfg, attempt + 1);
  const homePos = homeSpots[0];

  /**
   * 落一座 2×2 城堡：四格都挂同一个物件 id，但只有城门那格可通行。
   * 分两笔写 tile 是刻意的 —— placer.add 只认 pos 那一格。
   */
  const addCastle = (gate: GridPos, townId: string): void => {
    const cells = castleCells(gate);
    const obj = placer.add({
      kind: 'town', pos: gate, footprint: cells, payload: { townId },
      once: false, blocking: false, visitedBy: [],
    });
    for (const c of cells) {
      if (c.x === gate.x && c.y === gate.y) continue;
      map.tiles[idx(map, c.x, c.y)].objectId = obj.id;
    }
  };

  // 先落主城。顺序很关键：中立城要靠 castleFits 看见主城的占地，
  // 否则两座 2×2 可能叠在一起，tile 上的 objectId 互相覆盖。
  homeSpots.forEach((gate, i) => {
    const fid = factions[i];
    addCastle(gate, i === 0 ? 'town_home' : `town_${fid}`);
  });

  // 2. 中立城：放在中等距离的内陆，别再塞进地图角落；对手越多中立城越少
  const neutralCount = Math.max(
    2,
    Math.round(3 * k) - Math.round(cfg.opponents * 0.5),
  );
  const neutralSpots = pickTownSpots(rng, land, w, h, homePos, neutralCount, (p) =>
    castleFits(map, p),
  );
  neutralSpots.forEach((gate, i) => addCastle(gate, `town_n${i + 1}`));

  // 3. 英雄出生点：贴着城门找一格空地（城门正面优先，找不到就退一圈）
  const taken = new Set<number>([
    ...homeSpots.map((p) => idx(map, p.x, p.y)),
    ...neutralSpots.map((p) => idx(map, p.x, p.y)),
  ]);
  const heroSpots: GridPos[] = [];
  for (const gate of homeSpots) {
    let spot: GridPos | null = null;
    for (let ring = 1; ring <= 2 && !spot; ring++) {
      const ringCells: GridPos[] = [];
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          ringCells.push({ x: gate.x + dx, y: gate.y + dy });
        }
      }
      for (const c of shuffle(rng, ringCells)) {
        if (c.x < 0 || c.y < 0 || c.x >= w || c.y >= h) continue;
        const ni = idx(map, c.x, c.y);
        // 城堡另外三格这时已经挂上物件了，isPassable + objectId 两道闸都会把它们挡掉
        if (isPassable(map, c.x, c.y) && !map.tiles[ni].objectId && !taken.has(ni)) {
          spot = c;
          break;
        }
      }
    }
    if (spot) taken.add(idx(map, spot.x, spot.y));
    heroSpots.push(spot ?? gate);
  }

  // 3b. 城堡一次占掉 3 格，理论上能把地图切成孤岛；真切了就换个偏移种子重来
  {
    const fromStart = reachableFrom(map, heroSpots[0]);
    const mustReach = [...homeSpots, ...neutralSpots, ...heroSpots];
    if (!mustReach.every((p) => fromStart[idx(map, p.x, p.y)] === 1)) {
      return buildGame(cfg, attempt + 1);
    }
  }

  // 4. 障碍物（先放，之后只在仍连通的格子上放可交互物）
  const reserved = [
    ...homeSpots.map((p) => idx(map, p.x, p.y)),
    ...heroSpots.map((p) => idx(map, p.x, p.y)),
    ...neutralSpots.map((p) => idx(map, p.x, p.y)),
  ];
  const obstaclePool = shuffle(rng, freeTiles(map, taken));
  const obstacleCount = Math.min(Math.round(130 * k), Math.floor(obstaclePool.length * 0.25));
  let placed = 0;
  for (let i = 0; i < obstaclePool.length && placed < obstacleCount; i++) {
    const p = toPos(obstaclePool[i]);
    const r = rng();
    const variant = r < 0.6 ? 'tree' : r < 0.85 ? 'rock' : 'mountain';
    const obj = placer.add({
      kind: 'obstacle', pos: p, payload: { variant },
      once: false, blocking: true, visitedBy: [],
    });
    // 不允许障碍把任何一座城或任何一位英雄封死
    if (!heroSpots.every((hp) => allReachable(map, hp, reserved))) {
      detachObject(map, obj.id);
      continue;
    }
    taken.add(obstaclePool[i]);
    placed += 1;
  }

  // 5. 可达区域（放完障碍后再算，保证每个可交互物对每个阵营都走得到）
  const reach = new Uint8Array(w * h);
  for (const hp of heroSpots) {
    const r = reachableFrom(map, hp);
    for (let i = 0; i < reach.length; i++) if (r[i]) reach[i] = 1;
  }
  const spots = shuffle(
    rng,
    freeTiles(map, taken).filter((i) => reach[i] === 1),
  );
  let cursor = 0;
  const takeSpot = (): GridPos | null => {
    while (cursor < spots.length) {
      const i = spots[cursor++];
      if (!map.tiles[i].objectId && reach[i] === 1) return toPos(i);
    }
    return null;
  };

  /** 到最近一座主城的距离，用来给野怪分档：每个阵营身边都该有自己的新手区。 */
  const dNearestHome = (p: GridPos) =>
    Math.min(...homeSpots.map((hp) => Math.abs(hp.x - p.x) + Math.abs(hp.y - p.y)));

  /**
   * "深处"的度量。旷野/双子岛/三路走廊都是"离所有主城都远"，
   * 但同心环的腹地是**地图中心**——那里的同心环中心离各家主城只有六七格，
   * 用 dNearestHome 会得出一张"中间啥都没有"的环带图，白瞎了布局。
   * 系数 1.35 是把半径（格）换算到与上面几个 kl 档位同一个量纲：
   * 中心（最深处）在三种尺寸下都刚好越过"强档宝库"的 16·kl 门槛。
   */
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const deepness = (p: GridPos): number => {
    if (cfg.layout !== 'ring') return dNearestHome(p);
    return Math.round((Math.min(w, h) / 2 - Math.hypot(p.x - cx, p.y - cy)) * 1.35);
  };

  // 野怪：按距最近主城的距离分档，每支都守着一份战利品
  const weakMax = 9 * k;
  const midMax = 18 * k;
  const monsterCount = Math.max(6, Math.round(18 * k));
  const monsterSpots: { p: GridPos; tier: 'weak' | 'mid' | 'strong' }[] = [];
  for (let i = 0; i < monsterCount; i++) {
    const p = takeSpot();
    if (!p) break;
    const d = dNearestHome(p);
    monsterSpots.push({ p, tier: d < weakMax ? 'weak' : d < midMax ? 'mid' : 'strong' });
  }
  // 至少三处野怪守着真正的矿（中档/强档各来一处，有富余再补一处）
  const mineAt = new Set<number>();
  const byTier = (t: 'weak' | 'mid' | 'strong') =>
    monsterSpots.map((m, i) => ({ m, i })).filter((o) => o.m.tier === t);
  const mids = byTier('mid');
  const strongs = byTier('strong');
  if (mids.length) mineAt.add(pick(rng, mids).i);
  if (strongs.length) mineAt.add(pick(rng, strongs).i);
  else if (mids.length > 1) mineAt.add(mids[1].i);
  if (mids.length > 1 && !mineAt.has(mids[1].i)) mineAt.add(pick(rng, mids).i);
  if (strongs.length > 1 && !mineAt.has(strongs[1].i)) mineAt.add(pick(rng, strongs).i);

  monsterSpots.forEach((spot, i) => {
    const guard = mineAt.has(i) ? mineGuard(rng, spot.tier) : guardFor(rng, spot.tier);
    placer.add({
      kind: 'wanderingMonster',
      pos: spot.p,
      payload: { army: monsterArmy(rng, spot.tier, diff.monsterMul), tier: spot.tier, guard },
      once: true, blocking: false, visitedBy: [],
    });
  });

  /* ---------------- 矿场与宝库区（M7） ---------------- */

  const walkable = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && isPassable(map, x, y);

  /**
   * 按候选顺序挑第一个满足条件的格子，并把它"消耗掉"。
   * 消耗方式是把它换到游标位置再前进——spots 本身是打乱过的，所以结果仍然随机。
   */
  const takeWhere = (pred: (p: GridPos) => boolean): GridPos | null => {
    for (let i = cursor; i < spots.length; i++) {
      const cell = spots[i];
      if (map.tiles[cell].objectId || reach[cell] !== 1) continue;
      const p = toPos(cell);
      if (!pred(p)) continue;
      const tmp = spots[cursor];
      spots[cursor] = cell;
      spots[i] = tmp;
      cursor += 1;
      return p;
    }
    return null;
  };

  const addMine = (p: GridPos, resource: ResourceKind): void => {
    placer.add({
      kind: 'mine',
      pos: p,
      // 独立矿场开局归"中立"：谁先走到就是谁的，和 HOMM 一致
      payload: { resource, perDay: MINE_PER_DAY[resource], owner: 'neutral' as const },
      once: false,
      blocking: false,
      visitedBy: [],
    });
  };

  // 1) **每座城**（含中立城）保底一座锯木场 + 一座采石场，摆在 3~7 格外。
  //    木石是建筑树硬通货，开局摸不到矿的阵营会被卡死整整一周；
  //    中立城同样要配齐——占了城却发现方圆十格没木没石，那座城就是个摆设，
  //    而"抢中立城"正是中期最主要的扩张手段。
  //    城挨得近时环带会被别的城先占掉，这时退一档放到更外面（+5 格），
  //    免得出现"地图上明明有城，却没有木矿"的死角。
  const allTowns: GridPos[] = [...homeSpots, ...neutralSpots];
  for (const town of allTowns) {
    const dHome = (q: GridPos): number => Math.abs(q.x - town.x) + Math.abs(q.y - town.y);
    for (const res of ['wood', 'ore'] as const) {
      let p = takeWhere(
        (q) => dHome(q) >= HOME_MINE_RING.min && dHome(q) <= HOME_MINE_RING.max,
      );
      if (!p) {
        p = takeWhere((q) => dHome(q) >= 2 && dHome(q) <= HOME_MINE_RING.max + 5);
      }
      if (p) addMine(p, res);
    }
  }

  // 2) 散布的金矿与稀有矿：金矿别贴着主城，稀有矿一律藏在深处
  //    注意这里用的是**线性**尺度 kl，不是上面那个按面积算的 k：
  //    面积翻一倍地图边长只长 41%，用面积尺度会把"深处"推到地图之外，
  //    实测中型/大型图上稀有矿和宝库区一座都放不出来。
  const kl = Math.min(w, h) / 32;
  const goldMines = Math.max(1, Math.round(1.5 * k));
  const rareEach = Math.max(1, Math.round(0.8 * k));
  const deepSpots: GridPos[] = [];
  for (let i = 0; i < goldMines; i++) {
    const p = takeWhere((q) => deepness(q) >= 8 * kl);
    if (p) addMine(p, 'gold');
  }
  for (const res of RARE_RESOURCES) {
    for (let i = 0; i < rareEach; i++) {
      const p = takeWhere((q) => deepness(q) >= 14 * kl);
      if (!p) continue;
      addMine(p, res);
      deepSpots.push(p);
    }
  }

  // 3) 宝库区：重兵守着的一库金子，打赢才拿得到，拿完就没了
  const vaultCount = Math.max(2, Math.round(3 * k));
  for (let i = 0; i < vaultCount; i++) {
    const p = takeWhere((q) => deepness(q) >= 13 * kl);
    if (!p) continue;
    const tier = deepness(p) >= 16 * kl ? 'strong' : 'mid';
    const def = VAULTS[tier];
    // 宝库守军同样受 monsterMul 缩放；倍率施加在 randInt 之后，保持 rng 调用顺序不变
    const army: Army = def.army.map((s) => ({
      unitTypeId: s.unitTypeId,
      count: Math.max(1, Math.round(randInt(rng, s.count[0], s.count[1]) * diff.monsterMul)),
    }));
    const reward = {
      gold: randInt(rng, def.reward.gold[0], def.reward.gold[1]),
      resources: vaultRareBundle(rng, def.reward.rare),
      artifactId:
        rng() < def.reward.artifactChance ? pick(rng, Object.keys(ARTIFACTS)) : undefined,
    };
    placer.add({
      kind: 'vault',
      pos: p,
      payload: { army, tier, reward },
      once: true,
      blocking: false,
      visitedBy: [],
    });
    deepSpots.push(p);
  }

  // 4) 隘口守卫：给每处深处的宝贝配一个"卡在路口"的强档野怪
  //    走廊格 = 正交邻居里恰好两个能走、而且是正对的一对（南北通或东西通）
  for (const target of deepSpots) {
    const targetD = dNearestHome(target);
    /** 找守卫位：优先真正的走廊格，找不到就退而求其次挑最窄的那一格。 */
    let best: { p: GridPos; score: number } | null = null;
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const x = target.x + dx;
        const y = target.y + dy;
        if (!walkable(x, y)) continue;
        const cell = idx(map, x, y);
        if (map.tiles[cell].objectId || reach[cell] !== 1) continue;
        // 守卫必须比它守的东西更靠近主城，这样才是"进谷口先挨一仗"
        if (dNearestHome({ x, y }) >= targetD) continue;
        const n = walkable(x, y - 1);
        const s = walkable(x, y + 1);
        const e = walkable(x + 1, y);
        const w2 = walkable(x - 1, y);
        const open = [n, s, e, w2].filter(Boolean).length;
        if (open === 0) continue;
        const corridor = (n && s && !e && !w2) || (e && w2 && !n && !s);
        // 走廊格给 10 分底分，普通格用"越窄越好"折算（最多 9 分），再减一点路程
        const score = (corridor ? 10 : 4 - open * 0.1 + (open === 2 ? 2 : 0)) * 10 - (Math.abs(dx) + Math.abs(dy));
        if (!best || score > best.score) best = { p: { x, y }, score };
      }
    }
    if (!best) continue;
    placer.add({
      kind: 'wanderingMonster',
      pos: best.p,
      payload: {
        army: monsterArmy(rng, 'strong', diff.monsterMul),
        tier: 'strong',
        guard: { kind: 'gold', amount: randInt(rng, 1200, 2200) },
      },
      once: true,
      blocking: false,
      visitedBy: [],
    });
  }

  // 资源堆（大头战利品在野怪身上；宝石/水晶是魔法行会的硬通货）
  const pileTotal = Math.round(20 * k);
  const pileKinds: ('gold' | 'wood' | 'ore' | 'gem' | 'crystal')[] = [];
  for (let i = 0; i < pileTotal; i++) {
    const r = i % 5;
    pileKinds.push(r === 0 ? 'gold' : r === 1 ? 'wood' : r === 2 ? 'ore' : r === 3 ? 'gem' : 'crystal');
  }
  for (const kind of pileKinds) {
    const p = takeSpot();
    if (!p) break;
    const amount =
      kind === 'gold' ? randInt(rng, 500, 1500)
      : kind === 'gem' || kind === 'crystal' ? randInt(rng, 2, 4)
      : randInt(rng, 5, 12);
    placer.add({
      kind: 'resourcePile', pos: p, payload: { resource: kind, amount },
      once: true, blocking: false, visitedBy: [],
    });
  }

  // 宝箱
  const chestCount = Math.max(4, Math.round(12 * k));
  for (let i = 0; i < chestCount; i++) {
    const p = takeSpot();
    if (!p) break;
    const gold = randInt(rng, 1000, 3000);
    const artifactId = rng() < 0.2 ? pick(rng, Object.keys(ARTIFACTS)) : undefined;
    placer.add({
      kind: 'treasureChest', pos: p, payload: { gold, artifactId },
      once: true, blocking: false, visitedBy: [],
    });
  }

  // 泉水
  const fountainCount = Math.max(3, Math.round(4 * k));
  for (let i = 0; i < fountainCount; i++) {
    const p = takeSpot();
    if (!p) break;
    placer.add({
      kind: 'fountain', pos: p, payload: { moveRestore: 0.5 },
      once: false, blocking: false, visitedBy: [],
    });
  }

  // 地面宝物
  const artifactPool = shuffle(rng, Object.keys(ARTIFACTS));
  const artifactCount = Math.min(artifactPool.length, Math.max(4, Math.round(6 * k)));
  for (let i = 0; i < artifactCount; i++) {
    const p = takeSpot();
    if (!p) break;
    placer.add({
      kind: 'artifact', pos: p, payload: { artifactId: artifactPool[i] },
      once: true, blocking: false, visitedBy: [],
    });
  }

  /* ---------------- state ---------------- */

  const heroes: Record<string, Hero> = {};
  const heroOrder: string[] = [];
  const players: Record<string, PlayerState> = {};
  const towns: Record<string, Town> = {};

  const startRes = { gold: 2500, wood: 10, ore: 10 };

  factions.forEach((fid, i) => {
    const def = FACTIONS[fid];
    const isHuman = fid === 'p1';
    const tpl = HERO_TEMPLATES[Math.min(i, HERO_TEMPLATES.length - 1)];
    // 电脑对手按难度给起始资源；玩家按 playerStartMul 缩放
    const mul = isHuman ? diff.playerStartMul : diff.startMul;
    const res: ResourceBag = {
      gold: Math.round(startRes.gold * mul),
      wood: Math.round(startRes.wood * mul),
      ore: Math.round(startRes.ore * mul),
    };

    players[fid] = {
      name: isHuman ? cfg.playerName : def.lord,
      faction: fid,
      isHuman,
      resources: res,
      revealed: new Array(w * h).fill(0),
    };

    const heroId = isHuman ? 'hero1' : `hero_${fid}`;
    const hero: Hero = {
      id: heroId,
      name: isHuman ? cfg.playerName : def.lord,
      heroClass: tpl.className,
      portrait: tpl.portrait,
      level: 1,
      exp: 0,
      primary: { ...tpl.primary },
      mana: tpl.primary.knowledge * 10,
      manaMax: tpl.primary.knowledge * 10,
      movePoints: BASE_MOVE_POINTS,
      army: START_ARMY.map((s) => ({ ...s })),
      artifacts: [],
      spells: [],
      pos: heroSpots[i],
      owner: fid,
    };
    heroes[heroId] = hero;
    heroOrder.push(heroId);

    const townId = isHuman ? 'town_home' : `town_${fid}`;
    towns[townId] = {
      id: townId,
      name: def.home,
      pos: homeSpots[i],
      footprint: castleCells(homeSpots[i]),
      owner: fid,
      buildings: ['tavern', 'dwell1', 'dwell2'],
      garrison: [{ unitTypeId: 'archer', count: 10 }],
      growthPool: { peasant: 10, archer: 5 },
    };
  });

  neutralSpots.forEach((pos, i) => {
    const id = `town_n${i + 1}`;
    towns[id] = {
      id,
      name: NEUTRAL_NAMES[i] ?? `中立据点 ${i + 1}`,
      pos,
      footprint: castleCells(pos),
      owner: 'neutral',
      buildings: [],
      // 中立城驻军同样受 monsterMul 缩放（无 rng，直接乘）
      garrison: [
        { unitTypeId: 'wolf', count: Math.max(1, Math.round(20 * diff.monsterMul)) },
        { unitTypeId: 'boar', count: Math.max(1, Math.round(10 * diff.monsterMul)) },
      ],
      growthPool: {},
    };
  });

  const state: GameState = {
    version: 7,
    seed,
    config: cfg,
    map,
    heroes,
    towns,
    players,
    day: 1,
    heroOrder,
    log: [],
    nextObjectId: placer.counter,
    status: 'playing',
  };

  for (const fid of factions) {
    const h = heroes[fid === 'p1' ? 'hero1' : `hero_${fid}`];
    revealAround(state, fid, h.pos, HERO_SIGHT);
    revealAround(state, fid, towns[fid === 'p1' ? 'town_home' : `town_${fid}`].pos, 4);
  }

  // 起始英雄的移动力上限也要过 maxMovePoints：困难档玩家（p1）才会按 playerMoveMul
  // 缩放，AI 不受影响。这样开局第一天玩家就拿到正确的移动力，而不是要到 endDay 才刷新。
  for (const id of heroOrder) {
    const h = state.heroes[id];
    if (h) h.movePoints = maxMovePoints(h, state);
  }

  return state;
}
