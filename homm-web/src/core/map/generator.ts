import type {
  Army,
  GameMap,
  GameState,
  GridPos,
  GuardReward,
  MapObject,
  TerrainKind,
  Town,
} from '../types.js';
import { TERRAIN } from '../data/terrains.js';
import { ARTIFACTS } from '../data/artifacts.js';
import { HERO_TEMPLATES } from '../data/heroes.js';
import { mulberry32, randInt, shuffle, pick } from '../rng.js';
import { idx, isPassable } from './grid.js';
import { revealAround } from './fog.js';

export const MAP_W = 24;
export const MAP_H = 24;
export const BASE_MOVE_POINTS = 1500;
export const HERO_SIGHT = 5;

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

function buildTerrain(seed: number): { map: GameMap; height: number[] } {
  const rngH = mulberry32(seed);
  const rngM = mulberry32(seed ^ 0x9e3779b9);
  const height = fbm(rngH, MAP_W, MAP_H);
  const moisture = fbm(rngM, MAP_W, MAP_H);

  // 边缘一圈强制为水，形成自然海岸线
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const edge = Math.min(x, y, MAP_W - 1 - x, MAP_H - 1 - y);
      if (edge === 0) height[y * MAP_W + x] = Math.min(height[y * MAP_W + x], 0.18);
      else if (edge === 1) height[y * MAP_W + x] *= 0.85;
    }
  }

  const map: GameMap = { width: MAP_W, height: MAP_H, tiles: [], objects: {} };
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const h = height[i];
    const m = moisture[i];
    let t: TerrainKind;
    if (h < 0.3) t = 'water';
    else if (h < 0.36) t = 'sand';
    else if (h < 0.62) t = m > 0.62 ? 'swamp' : 'grass';
    else if (h < 0.74) t = 'dirt';
    else if (h < 0.86) t = 'rock';
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

function monsterArmy(rng: () => number, tier: 'weak' | 'mid' | 'strong'): Army {
  if (tier === 'weak') return [{ unitTypeId: 'wolf', count: randInt(rng, 10, 18) }];
  if (tier === 'mid') {
    return rng() < 0.5
      ? [{ unitTypeId: 'boar', count: randInt(rng, 6, 11) }]
      : [{ unitTypeId: 'wolf', count: randInt(rng, 14, 20) }, { unitTypeId: 'boar', count: randInt(rng, 3, 6) }];
  }
  return rng() < 0.5
    ? [{ unitTypeId: 'ogre', count: randInt(rng, 4, 7) }]
    : [{ unitTypeId: 'boar', count: randInt(rng, 4, 7) }, { unitTypeId: 'ogre', count: randInt(rng, 2, 3) }];
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
  if (tier === 'strong') return { kind: 'mine', resource: 'gold', perDay: 400 };
  return { kind: 'mine', resource: rng() < 0.5 ? 'wood' : 'ore', perDay: 3 };
}

/** 挑一个远离地图边缘、距主城 10~18 格的地块做中立城，避免它躲在角落里永远找不到。 */
function pickTownSpots(
  rng: () => number,
  land: number[],
  homePos: GridPos,
  count: number,
): GridPos[] {
  const toPos = (i: number): GridPos => ({ x: i % MAP_W, y: (i / MAP_W) | 0 });
  const dHome = (p: GridPos) => Math.abs(p.x - homePos.x) + Math.abs(p.y - homePos.y);

  const pool = (min: number, max: number): number[] =>
    land.filter((i) => {
      const p = toPos(i);
      const edge = Math.min(p.x, p.y, MAP_W - 1 - p.x, MAP_H - 1 - p.y);
      if (edge < 2) return false;
      const d = dHome(p);
      return d >= min && d <= max;
    });

  let candidates = shuffle(rng, pool(10, 18));
  if (candidates.length < count) candidates = shuffle(rng, pool(8, 22));
  if (candidates.length < count) candidates = shuffle(rng, pool(6, 30));

  const chosen: GridPos[] = [];
  for (const i of candidates) {
    const p = toPos(i);
    if (chosen.length >= count) break;
    // 城与城之间至少隔 8 格，避免两座中立城挤在一起
    if (chosen.every((c) => Math.abs(c.x - p.x) + Math.abs(c.y - p.y) >= 8)) chosen.push(p);
  }
  // 兜底：实在挑不出就退回最远的一批
  let i = 0;
  while (chosen.length < count && i < candidates.length) {
    const p = toPos(candidates[i++]);
    if (!chosen.some((c) => c.x === p.x && c.y === p.y)) chosen.push(p);
  }
  return chosen;
}

/* ---------------- entry ---------------- */

export function createGame(seed = Math.floor(Math.random() * 1e9)): GameState {
  const { map } = buildTerrain(seed);
  keepLargestLandmass(map);

  const rng = mulberry32(seed ^ 0x5bf03635);
  const placer = new ObjectPlacer(map);
  const toPos = (i: number): GridPos => ({ x: i % map.width, y: (i / map.width) | 0 });

  // 1. 主城：靠左侧的可通行地块
  const land: number[] = [];
  for (let i = 0; i < map.width * map.height; i++) {
    if (isPassable(map, i % map.width, (i / map.width) | 0)) land.push(i);
  }
  if (land.length < 80) return createGame(seed + 1);

  const home = land.reduce((best, i) => {
    const p = toPos(i);
    const b = toPos(best);
    const d = (q: GridPos) => Math.abs(q.x - MAP_W * 0.22) + Math.abs(q.y - MAP_H * 0.5);
    return d(p) < d(b) ? i : best;
  }, land[0]);
  const homePos = toPos(home);

  // 2. 中立城 2 座：放在中等距离的内陆，别再塞进地图角落
  const neutralSpots = pickTownSpots(rng, land, homePos, 2);
  const NEUTRAL_NAMES = ['荒废哨塔', '风蚀要塞'];

  const townIds = ['town_home'];
  placer.add({
    kind: 'town', pos: homePos, payload: { townId: 'town_home' },
    once: false, blocking: false, visitedBy: [],
  });
  neutralSpots.forEach((pos, i) => {
    const id = `town_n${i + 1}`;
    townIds.push(id);
    placer.add({
      kind: 'town', pos, payload: { townId: id },
      once: false, blocking: false, visitedBy: [],
    });
  });

  // 3. 英雄出生点：主城旁一格
  const taken = new Set<number>([home, ...neutralSpots.map((p) => idx(map, p.x, p.y))]);
  let heroPos: GridPos | null = null;
  for (const [dx, dy] of shuffle(rng, [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]])) {
    const nx = homePos.x + dx;
    const ny = homePos.y + dy;
    if (isPassable(map, nx, ny) && !map.tiles[idx(map, nx, ny)].objectId) {
      heroPos = { x: nx, y: ny };
      taken.add(idx(map, nx, ny));
      break;
    }
  }
  if (!heroPos) heroPos = homePos;

  // 4. 障碍物（先放，之后只在仍连通的格子上放可交互物）
  const reserved = [home, idx(map, heroPos.x, heroPos.y), ...neutralSpots.map((p) => idx(map, p.x, p.y))];
  const obstaclePool = shuffle(rng, freeTiles(map, taken));
  const obstacleCount = Math.min(70, Math.floor(obstaclePool.length * 0.25));
  let placed = 0;
  for (let i = 0; i < obstaclePool.length && placed < obstacleCount; i++) {
    const p = toPos(obstaclePool[i]);
    const r = rng();
    const variant = r < 0.6 ? 'tree' : r < 0.85 ? 'rock' : 'mountain';
    const obj = placer.add({
      kind: 'obstacle', pos: p, payload: { variant },
      once: false, blocking: true, visitedBy: [],
    });
    // 不允许障碍把城镇或英雄封死
    if (!allReachable(map, heroPos, reserved)) {
      detachObject(map, obj.id);
      continue;
    }
    taken.add(obstaclePool[i]);
    placed += 1;
  }

  // 5. 可达区域（放完障碍后再算，保证每个可交互物都走得到）
  const reach = reachableFrom(map, heroPos);
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

  const dHome = (p: GridPos) => Math.abs(p.x - homePos.x) + Math.abs(p.y - homePos.y);

  // 野怪 12：按距主城距离分档，每支都守着一份战利品
  const monsterSpots: { p: GridPos; tier: 'weak' | 'mid' | 'strong' }[] = [];
  for (let i = 0; i < 12; i++) {
    const p = takeSpot();
    if (!p) break;
    const d = dHome(p);
    monsterSpots.push({ p, tier: d < 7 ? 'weak' : d < 14 ? 'mid' : 'strong' });
  }
  // 至少两处野怪守着真正的矿（一处中档、一处强档）
  const mineAt = new Set<number>();
  const byTier = (t: 'weak' | 'mid' | 'strong') =>
    monsterSpots.map((m, i) => ({ m, i })).filter((o) => o.m.tier === t);
  const mids = byTier('mid');
  const strongs = byTier('strong');
  if (mids.length) mineAt.add(pick(rng, mids).i);
  if (strongs.length) mineAt.add(pick(rng, strongs).i);
  else if (mids.length > 1) mineAt.add(mids[1].i);

  monsterSpots.forEach((spot, i) => {
    const guard = mineAt.has(i) ? mineGuard(rng, spot.tier) : guardFor(rng, spot.tier);
    placer.add({
      kind: 'wanderingMonster',
      pos: spot.p,
      payload: { army: monsterArmy(rng, spot.tier), tier: spot.tier, guard },
      once: true, blocking: false, visitedBy: [],
    });
  });

  // 资源堆 14（大头战利品在野怪身上）
  const pileKinds: ('gold' | 'wood' | 'ore')[] = [];
  for (let i = 0; i < 14; i++) pileKinds.push(i % 3 === 0 ? 'gold' : i % 3 === 1 ? 'wood' : 'ore');
  for (const kind of pileKinds) {
    const p = takeSpot();
    if (!p) break;
    const amount = kind === 'gold' ? randInt(rng, 500, 1500) : randInt(rng, 5, 12);
    placer.add({
      kind: 'resourcePile', pos: p, payload: { resource: kind, amount },
      once: true, blocking: false, visitedBy: [],
    });
  }

  // 宝箱 8
  for (let i = 0; i < 8; i++) {
    const p = takeSpot();
    if (!p) break;
    const gold = randInt(rng, 1000, 3000);
    const artifactId = rng() < 0.2 ? pick(rng, Object.keys(ARTIFACTS)) : undefined;
    placer.add({
      kind: 'treasureChest', pos: p, payload: { gold, artifactId },
      once: true, blocking: false, visitedBy: [],
    });
  }

  // 泉水 3
  for (let i = 0; i < 3; i++) {
    const p = takeSpot();
    if (!p) break;
    placer.add({
      kind: 'fountain', pos: p, payload: { moveRestore: 0.5 },
      once: false, blocking: false, visitedBy: [],
    });
  }

  // 地面宝物 4
  const artifactPool = shuffle(rng, Object.keys(ARTIFACTS));
  for (let i = 0; i < Math.min(4, artifactPool.length); i++) {
    const p = takeSpot();
    if (!p) break;
    placer.add({
      kind: 'artifact', pos: p, payload: { artifactId: artifactPool[i] },
      once: true, blocking: false, visitedBy: [],
    });
  }

  /* ---------------- state ---------------- */

  const tpl = HERO_TEMPLATES[0];
  const hero = {
    id: 'hero1',
    name: tpl.name,
    heroClass: tpl.className,
    portrait: tpl.portrait,
    level: 1,
    exp: 0,
    primary: { ...tpl.primary },
    mana: 10,
    manaMax: 10,
    movePoints: BASE_MOVE_POINTS,
    army: tpl.startArmy.map((s) => ({ ...s })),
    artifacts: [],
    pos: heroPos,
    owner: 'p1' as const,
  };

  const towns: Record<string, Town> = {
    town_home: {
      id: 'town_home', name: '曙光城', pos: homePos, owner: 'p1',
      buildings: ['tavern', 'dwell1', 'dwell2'],
      garrison: [{ unitTypeId: 'archer', count: 10 }],
      growthPool: { peasant: 10, archer: 5 },
    },
  };
  neutralSpots.forEach((pos, i) => {
    towns[`town_n${i + 1}`] = {
      id: `town_n${i + 1}`,
      name: NEUTRAL_NAMES[i] ?? `中立据点 ${i + 1}`,
      pos,
      owner: 'neutral',
      buildings: [],
      garrison: [
        { unitTypeId: 'wolf', count: 12 },
        { unitTypeId: 'boar', count: 6 },
      ],
      growthPool: {},
    };
  });

  const state: GameState = {
    version: 3,
    seed,
    map,
    heroes: { hero1: hero },
    towns,
    players: {
      p1: { resources: { gold: 2500, wood: 10, ore: 10 }, revealed: new Array(map.width * map.height).fill(0) },
    },
    day: 1,
    heroOrder: ['hero1'],
    log: [],
    nextObjectId: placer.counter,
  };

  revealAround(state, 'p1', heroPos, HERO_SIGHT);
  revealAround(state, 'p1', homePos, 4);
  return state;
}
