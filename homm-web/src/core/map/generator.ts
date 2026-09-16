import type {
  Army,
  GameConfig,
  GameMap,
  GameState,
  GridPos,
  GuardReward,
  Hero,
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

/* ---------------- terrain ---------------- */

function buildTerrain(seed: number, w: number, h: number): { map: GameMap; height: number[] } {
  const rngH = mulberry32(seed);
  const rngM = mulberry32(seed ^ 0x9e3779b9);
  const height = fbm(rngH, w, h);
  const moisture = fbm(rngM, w, h);

  // 边缘一圈强制为水，形成自然海岸线
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
 */
export function monsterArmy(rng: () => number, tier: 'weak' | 'mid' | 'strong'): Army {
  if (tier === 'weak') return [{ unitTypeId: 'wolf', count: randInt(rng, 20, 28) }];
  if (tier === 'mid') {
    return rng() < 0.5
      ? [{ unitTypeId: 'boar', count: randInt(rng, 11, 15) }]
      : [{ unitTypeId: 'wolf', count: randInt(rng, 18, 26) }, { unitTypeId: 'boar', count: randInt(rng, 4, 7) }];
  }
  return rng() < 0.5
    ? [{ unitTypeId: 'ogre', count: randInt(rng, 10, 13) }]
    : [{ unitTypeId: 'boar', count: randInt(rng, 7, 10) }, { unitTypeId: 'ogre', count: randInt(rng, 5, 7) }];
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
 * 各阵营的主城位置：围绕地图中心均分成一个正多边形（p1 从正左方开始）。
 *
 * 关键点是**整体旋转 + 整体平移**，而不是每家各自随机：
 * 这样任意两家的相对距离在每一局里都完全相等，谁也不会抽到更近的邻居；
 * 但整张布局随种子旋转，所以每局的开局位置又不一样。
 */
function pickHomeSpots(
  rng: () => number,
  map: GameMap,
  land: number[],
  w: number,
  h: number,
  count: number,
): GridPos[] {
  const toPos = (i: number): GridPos => ({ x: i % w, y: (i / w) | 0 });
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.35;
  const minGap = Math.max(8, Math.round(Math.min(w, h) * 0.3));

  // 只从"放得下 2×2 城堡"的格子（城门位）里挑，否则后面还要回退，得不偿失
  const fits = land.map(toPos).filter((p) => castleFits(map, p));
  if (fits.length < count) return [];
  /** 外圈宽敞一点，别把城堡塞进一格宽的缝里。 */
  const roomy = (p: GridPos): boolean => castleRoom(map, p) >= 8;

  const rot = (rng() - 0.5) * Math.PI * 0.5;
  const jx = (rng() - 0.5) * 4;
  const jy = (rng() - 0.5) * 4;

  const out: GridPos[] = [];
  for (let k = 0; k < count; k++) {
    // p1 从正左方出发，其余按逆时针均分
    const angle = Math.PI + rot + (k * Math.PI * 2) / count;
    const ideal = {
      x: cx + jx + Math.cos(angle) * radius,
      y: cy + jy + Math.sin(angle) * radius,
    };
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
    opponents: Math.max(0, Math.min(3, Math.floor(o.opponents ?? DEFAULT_CONFIG.opponents))),
    difficulty: o.difficulty ?? DEFAULT_CONFIG.difficulty,
    playerName: rawName || DEFAULT_CONFIG.playerName,
  };
}

export function createGame(opts: number | GenOptions = {}): GameState {
  return buildGame(normalizeConfig(opts), 0);
}

function buildGame(cfg: GameConfig, attempt: number): GameState {
  // 地形不理想时换个种子重试，所以实际种子会带上重试次数
  const seed = (cfg.seed + attempt * 7919) >>> 0;
  const size = MAP_SIZES[cfg.size];
  const w = size.width;
  const h = size.height;
  /** 物件密度按面积缩放，小图不至于挤满、大图不至于空旷。 */
  const k = (w * h) / (MAP_SIZES.medium.width * MAP_SIZES.medium.height);

  const { map } = buildTerrain(seed, w, h);
  keepLargestLandmass(map);

  const rng = mulberry32(seed ^ 0x5bf03635);
  const placer = new ObjectPlacer(map);
  const toPos = (i: number): GridPos => ({ x: i % w, y: (i / w) | 0 });

  const land: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (isPassable(map, i % w, (i / w) | 0)) land.push(i);
  }
  if (land.length < Math.round(150 * k)) return buildGame(cfg, attempt + 1);

  // 1. 各阵营主城：围绕地图中心均分，p1 固定从左侧出发
  const factions = FACTION_ORDER.slice(0, 1 + cfg.opponents);
  const homeSpots = pickHomeSpots(rng, map, land, w, h, factions.length);
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
      payload: { army: monsterArmy(rng, spot.tier), tier: spot.tier, guard },
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

  // 1) 每家保底一座锯木场 + 一座采石场，摆在离家 3~7 格
  //    （木石是建筑树硬通货，开局摸不到矿的阵营会被卡死整整一周）
  for (const home of homeSpots) {
    for (const res of ['wood', 'ore'] as const) {
      const p = takeWhere((q) => {
        const d = Math.abs(q.x - home.x) + Math.abs(q.y - home.y);
        return d >= HOME_MINE_RING.min && d <= HOME_MINE_RING.max;
      });
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
    const p = takeWhere((q) => dNearestHome(q) >= 8 * kl);
    if (p) addMine(p, 'gold');
  }
  for (const res of RARE_RESOURCES) {
    for (let i = 0; i < rareEach; i++) {
      const p = takeWhere((q) => dNearestHome(q) >= 14 * kl);
      if (!p) continue;
      addMine(p, res);
      deepSpots.push(p);
    }
  }

  // 3) 宝库区：重兵守着的一库金子，打赢才拿得到，拿完就没了
  const vaultCount = Math.max(2, Math.round(3 * k));
  for (let i = 0; i < vaultCount; i++) {
    const p = takeWhere((q) => dNearestHome(q) >= 13 * kl);
    if (!p) continue;
    const tier = dNearestHome(p) >= 16 * kl ? 'strong' : 'mid';
    const def = VAULTS[tier];
    const army: Army = def.army.map((s) => ({
      unitTypeId: s.unitTypeId,
      count: randInt(rng, s.count[0], s.count[1]),
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
        army: monsterArmy(rng, 'strong'),
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
  const diff = DIFFICULTIES[cfg.difficulty];

  factions.forEach((fid, i) => {
    const def = FACTIONS[fid];
    const isHuman = fid === 'p1';
    const tpl = HERO_TEMPLATES[Math.min(i, HERO_TEMPLATES.length - 1)];
    // 电脑对手按难度给起始资源；玩家永远是标准配置
    const mul = isHuman ? 1 : diff.startMul;
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
      garrison: [
        { unitTypeId: 'wolf', count: 20 },
        { unitTypeId: 'boar', count: 10 },
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
  return state;
}
