/**
 * 周地图爆发（spec §19.3，EV2）。
 *
 * H3 **没有**这条玩法（它的"某生物周"只翻倍产量，不往地图上刷怪），所以没有手感兜底，
 * 只能自己定红线并全部带读数上线。规则（§19.3.2 / 决策 65）：
 *
 *   · 只掷 **3 次**：W3 = 4 / W4 = 5 / W5 = 6 栈，之后永不再刷；
 *   · 周首**预告**（"本周三：狼群过境"），到那天才落地；单栈打死才消失；
 *   · 全图上限 `OUTBREAK_CAP = 8`；周首若已满 ⇒ 本周直接判"路上已满"，不预告了却放 0 栈；
 *   · **只落在 `lost ≤ 40` 的小口袋门**（`lost > 40` 一刀切断半张图，ring 布局上
 *     这类格 100% 会把某座城切到对面 ⇒ 软锁）。这句是本文件唯一的地形红线；
 *   · 距任何英雄 ≥ **1 天路程**（`costFieldFromMap` 口径，不是曼哈顿格数）；
 *   · **不给金币赏金**（`guard` 一律 undefined）—— 挡路本身就是奖励，击杀照旧给经验。
 *
 * 随机流：`deriveSeed(seed, tag, week*31+3)` **单开两条**（预告一条、落点一条），
 * 与 `week.ts` 的周生长事件互不干扰 ⇒ 旧读数不该有任何变化（V5）。
 *
 * 为什么要缓存"结构性关口"：找落点要对每个候选格真做一次洪水填充（探针同款量法）。
 * huge 图 3,600 格 × 1,500 次填充 ≈ 5,000 万次邻居检查，直接塞进 `endDay` 会卡一帧。
 * 而**地形结构一局内不变**（爆发怪 `blocking:false`，捡走的资源也不改变通行性）⇒
 * 结构关口扫一次、按 `GameMap` 缓存；真正的判据（`lost` 按英雄起点重算、城里有没有人、
 * 距离够不够）每次落点都**重新量**，缓存只用来缩小候选集。
 */

import type {
  Army,
  GameMap,
  GameState,
  GridPos,
  MonsterPayload,
  OutbreakNotice,
  OutbreakState,
} from '../types.js';
import { deriveSeed, mulberry32, shuffle } from '../rng.js';
import { idx, isPassable } from '../map/grid.js';
import { costFieldFromMap } from '../map/pathfinding.js';
import { BASE_MOVE_POINTS, monsterArmy } from '../map/generator.js';
import { DIFFICULTIES } from '../data/factions.js';
import { DAYS_PER_WEEK, weekOf } from './calendar.js';
import { pushLog } from './log.js';

/** 全图同时存在的爆发栈上限（§19.3.4 C1：8 栈 ≈ 中型图 26% 的路口）。 */
export const OUTBREAK_CAP = 8;

/** 只掷这三周（决策 65）。W6 起永不再刷 —— 探针的负向对照就是往这张表里加 W6。 */
export const OUTBREAK_PLAN: Readonly<Record<number, number>> = { 3: 4, 4: 5, 5: 6 };

/** 与 §19.2 同一个教学期：第 1~2 周保证平静。 */
export const OUTBREAK_MIN_WEEK = 3;

/**
 * 最后一掷 = W5。**只作文档/读数用，不要拿它做判断** ——
 * "之后不再刷"必须来自 `OUTBREAK_PLAN` 里没有 W6 这一条，
 * 否则 `probe:outbreak` 的 C2 负向对照（往表里加 W6 就应该能落）会失效。
 */
export const OUTBREAK_LAST_WEEK = 5;

/** 爆发日 = 本周第三天（"本周三"）。周首预告，玩家有两天时间备战。 */
export const OUTBREAK_DAY_OF_WEEK = 3;

/** 小口袋门的红线：堵上它之后**最多**断掉这么多格（§19.3.1 实测表）。 */
export const POCKET_MAX_LOST = 40;

/** 落点距任何英雄至少一天路程（`BASE_MOVE_POINTS` = 1800 ≈ 一天）。 */
export const OUTBREAK_MIN_HOME_COST = BASE_MOVE_POINTS;

/**
 * 距离分档（§19.3.2 ②）：先按 1 天挑，挑不满再退到 3/4 天、半天。
 *
 * 为什么要有退让：规格写的"≥1 天"在**大图上成立、小图上不成立**。实测（本探针 A/C 组）：
 * wild 小图只有 **3** 个关口距所有英雄 ≥1800，而 W3 要落 **4** 栈；
 * wild 中图是 **0** 个（`BASE_MOVE_POINTS` = 1800 ≈ 18 格，24×24 的图上
 * "离所有英雄一天"几乎等于"离全图一天"）。硬按 1800 判 ⇒ 一栈都落不下，
 * 规则看起来"实现了"，实际是**死规则**。
 *
 * 退让的只有**距离**，`lost ≤ 40` 的软锁红线一步都不退（那是会把人关在城外的）。
 */
export const OUTBREAK_HOME_STEPS: readonly number[] = [
  OUTBREAK_MIN_HOME_COST,
  Math.round(OUTBREAK_MIN_HOME_COST * 0.75),
  Math.round(OUTBREAK_MIN_HOME_COST * 0.5),
];

/**
 * 单栈档位与周系数：W3/W4 中档、W5 强档。
 *
 * 不用 `weak`：弱档（20~28 狼）在第 3 周对任何一家都是白送经验，挡不住路。
 * 倍率施加在 `randInt()` **之后**（`monsterArmy` 的红线），所以不影响随机数消耗顺序。
 */
export const OUTBREAK_TIER: Readonly<Record<number, 'weak' | 'mid' | 'strong'>> = {
  3: 'mid',
  4: 'mid',
  5: 'strong',
};
export const OUTBREAK_WEEK_MUL: Readonly<Record<number, number>> = { 3: 1, 4: 1.15, 5: 1.3 };

/** 能爆发的三家（§19.3.3 方案 A：只让现有 3 支中立怪爆发，0 美术成本）。 */
export const OUTBREAK_UNITS: readonly string[] = ['wolf', 'boar', 'ogre'];

/** 预告文案里的群名。兵种与"群名"必须同源，否则会出现"说好的狼群来了野猪"。 */
const OUTBREAK_NAMES: Readonly<Record<string, string>> = {
  wolf: '狼群',
  boar: '野猪群',
  ogre: '食人魔群',
};

/** `deriveSeed` 只吃数字：'outb'（预告）/ 'outp'（落点）两条流。 */
const TAG_NOTICE = 0x6f757462;
const TAG_PLACE = 0x6f757470;

const WEEKDAY_CN = ['', '一', '二', '三', '四', '五', '六', '日'];

export type { OutbreakNotice, OutbreakState };

export function outbreakOf(state: GameState): OutbreakState {
  if (!state.outbreak) state.outbreak = { lastDay: 0, spawned: 0, live: 0 };
  return state.outbreak;
}

/** 地图上现存的爆发栈（`payload.outbreak === true`）。**唯一真相源**。 */
export function outbreakStacks(state: GameState): MonsterPayload[] {
  const out: MonsterPayload[] = [];
  for (const obj of Object.values(state.map.objects)) {
    if (obj.kind !== 'wanderingMonster') continue;
    const p = obj.payload as MonsterPayload;
    if (p?.outbreak) out.push(p);
  }
  return out;
}

/** 当前在图栈数（并顺手刷新 `state.outbreak.live` 快照）。 */
export function outbreakCount(state: GameState): number {
  const n = outbreakStacks(state).length;
  if (state.outbreak) state.outbreak.live = n;
  return n;
}

/**
 * 周首：掷本周的爆发预告（W3/W4/W5 才有）。
 *
 * 为什么**周首就把 `armies` 生成好**：预告要写"狼群过境"，而到那天 `monsterArmy()`
 * 抽到什么兵是独立的。若落点那天再抽，文案与兵种会打架（说狼来了猪）。
 * 于是在周首一次抽完、存进 `notice`，落点时只用 `TAG_PLACE` 那条流挑格子。
 * 数量在周首就按 `OUTBREAK_CAP` 夹过，日志里写的栈数就是能落地的上限。
 */
export function planOutbreak(
  state: GameState,
  opts: { cap?: number; plan?: Readonly<Record<number, number>> } = {},
): OutbreakNotice | null {
  const week = weekOf(state.day);
  const plan = opts.plan ?? OUTBREAK_PLAN;
  const want = plan[week] ?? 0;
  if (want <= 0) {
    // 不在掷的周里：**不创建** `state.outbreak`（前两周与平静周必须逐位不变，V5）
    if (state.outbreak) state.outbreak.notice = undefined;
    return null;
  }
  const ob = outbreakOf(state);
  const cap = opts.cap ?? OUTBREAK_CAP;
  const live = outbreakCount(state);
  if (live >= cap) {
    // 不能静默跳过：玩家会以为漏了一次（§19.3.4 C1）。
    ob.notice = undefined;
    pushLog(state, `本周路上已满（${live}/${cap} 栈），不会有新的爆发`);
    return null;
  }
  const count = Math.min(want, cap - live);
  const rng = mulberry32(deriveSeed(state.seed, TAG_NOTICE, week * 31 + OUTBREAK_DAY_OF_WEEK));
  const tier = OUTBREAK_TIER[week] ?? 'mid';
  const mul = (OUTBREAK_WEEK_MUL[week] ?? 1) * outbreakMulOf(state);
  const armies: Army[] = [];
  for (let i = 0; i < count; i++) armies.push(monsterArmy(rng, tier, mul));
  const unitTypeId = armies[0]?.[0]?.unitTypeId ?? 'wolf';
  const name = OUTBREAK_NAMES[unitTypeId] ?? '兽群';
  const day = (week - 1) * DAYS_PER_WEEK + OUTBREAK_DAY_OF_WEEK;
  const text = `本周${WEEKDAY_CN[OUTBREAK_DAY_OF_WEEK]}：${name}过境（${count} 栈，挡在必经之路上，打死才能通过）`;
  const notice: OutbreakNotice = { week, day, count, armies, unitTypeId, name, text };
  ob.notice = notice;
  pushLog(state, text);
  return notice;
}

/* ---------------- 落点 ---------------- */

interface ChokeCell {
  /** 格子索引 `y*W+x`。 */
  i: number;
  /** 结构性 `lost`（最大连通块、固定根口径；只作预筛，不是最终判据）。 */
  lost: number;
}

/**
 * 结构性关口（按 `GameMap` 缓存）：`lost` = 拿掉这格后**掉出主连通块**的格数。
 *
 * 这一步只看地形，与英雄站位无关（所以能缓存）；真正的落点判据在
 * `outbreakCandidates` 里用**英雄起点**重算一遍 —— 与探针同一把尺子。
 */
const chokeCache = new WeakMap<GameMap, ChokeCell[]>();

function passableIndex(map: GameMap): number[] {
  const n = map.width * map.height;
  const pass: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = i % map.width;
    const y = (i / map.width) | 0;
    if (isPassable(map, x, y)) pass.push(i);
  }
  return pass;
}

/** 从 `sources`（索引集合）做 4 邻域洪水；`ban` 视为不可通行。 */
function floodFrom(map: GameMap, sources: ArrayLike<number>, ban: number): Uint8Array {
  const W = map.width;
  const H = map.height;
  const seen = new Uint8Array(W * H);
  const q: number[] = [];
  for (let k = 0; k < sources.length; k++) {
    const i = sources[k];
    if (i === ban || seen[i]) continue;
    seen[i] = 1;
    q.push(i);
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    if (i === ban) continue;
    const x = i % W;
    const y = (i / W) | 0;
    if (x > 0) seed(i - 1);
    if (x < W - 1) seed(i + 1);
    if (y > 0) seed(i - W);
    if (y < H - 1) seed(i + W);
  }
  function seed(j: number): void {
    if (j === ban || seen[j]) return;
    const jx = j % W;
    const jy = (j / W) | 0;
    if (!isPassable(map, jx, jy)) return;
    seen[j] = 1;
    q.push(j);
  }
  return seen;
}

function countMask(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n += 1;
  return n;
}

function structuralChokes(map: GameMap): ChokeCell[] {
  const cached = chokeCache.get(map);
  if (cached) return cached;
  const pass = passableIndex(map);
  if (!pass.length) {
    chokeCache.set(map, []);
    return [];
  }
  /* 源必须是**同一个连通块**，不能把"所有可行走格"都当源 ——
     那样每一格在被 BFS 之前就已经是源，`lost` 恒为 0（首版就踩了这个坑，
     读数表现为"候选恒 0、爆发一栈都落不下"）。
     也不能拿 `pass[0]` 当种子：那多半是地图角落一个孤立小水洼，从它出发的连通块里
     一个关口都没有。要取**最大连通块**。 */
  let main = new Uint8Array(map.width * map.height) as Uint8Array;
  let mainSize = 0;
  const done = new Uint8Array(map.width * map.height);
  for (const start of pass) {
    if (done[start]) continue;
    const comp = floodFrom(map, [start], -1);
    for (let i = 0; i < comp.length; i++) if (comp[i]) done[i] = 1;
    const size = countMask(comp);
    if (size > mainSize) {
      mainSize = size;
      main = comp;
    }
  }
  const sources: number[] = [];
  for (const i of pass) if (main[i]) sources.push(i);
  const total = sources.length;
  /* 每一格都必须**从同一个根重新填一次**，才能量到"堵上就断"。
     不能把整块连通块都当源：那样每格在 BFS 之前已经是源，`lost` 恒为 0
     （首版与第二版都踩了这个坑，读数表现为"候选恒 0、一栈都落不下"）。
     根固定在块内第一格；它落在哪一侧不影响"是不是割点"这个布尔量，
     真正的 `lost` 由 `outbreakCandidates` 按英雄起点重算。 */
  const root = sources[0]!;
  const out: ChokeCell[] = [];
  for (const i of sources) {
    const seen = floodFrom(map, [root], i);
    const lost = total - 1 - countMask(seen);
    if (lost > 0) out.push({ i, lost });
  }
  chokeCache.set(map, out);
  return out;
}

/** 城区格集合（判"被切断的小口袋里有没有城"）。 */
function townCells(state: GameState): number[] {
  const W = state.map.width;
  const out: number[] = [];
  for (const obj of Object.values(state.map.objects)) {
    if (obj.kind !== 'town') continue;
    for (const c of obj.footprint ?? [obj.pos]) out.push(c.y * W + c.x);
  }
  return out;
}

/**
 * 合规落点的**完整候选集**（未挑选、未打散），每项带 `lost`。
 *
 * 单独导出是为了让探针能确定性地质问红线：`maxLost = 40` 时候选里 `lost > 40` 必须是 0 个；
 * 把阈值放开成 `Infinity` 必须立刻出现 —— 否则"红线生效"这句话没有读数支撑
 * （随机挑 4 个格子，可能一次都没挑到大切断，负向对照就成了碰运气）。
 */
export function outbreakCandidates(
  state: GameState,
  opts: { maxLost?: number; minHomeCost?: number } = {},
): Array<{ pos: GridPos; lost: number; home: number }> {
  const map = state.map;
  const W = map.width;
  const maxLost = opts.maxLost ?? POCKET_MAX_LOST;
  const minHome = opts.minHomeCost ?? OUTBREAK_MIN_HOME_COST;

  const heroes = Object.values(state.heroes);
  const starts = heroes.map((h) => h.pos);
  if (!starts.length) return [];

  const base = floodFrom(map, starts.map((p) => idx(map, p.x, p.y)), -1);
  const reach = countMask(base);
  const homes = new Float64Array(W * map.height).fill(Infinity);
  for (const s of starts) {
    const f = costFieldFromMap(map, s);
    for (let i = 0; i < homes.length; i++) if (f.cost[i] < homes[i]) homes[i] = f.cost[i];
  }
  const towns = townCells(state);
  const taken = new Set<number>(starts.map((p) => idx(map, p.x, p.y)));

  const out: Array<{ pos: GridPos; lost: number; home: number }> = [];
  for (const { i } of structuralChokes(map)) {
    if (!base[i] || taken.has(i)) continue;
    if (map.tiles[i].objectId) continue;
    if (!(homes[i] >= minHome)) continue;
    // 堵上这一格之后，从英雄起点还能走到哪些格（探针同一把尺子：真填一遍，不估算）
    const after = floodFrom(map, starts.map((p) => idx(map, p.x, p.y)), i);
    const lost = reach - countMask(after) - 1;
    if (lost <= 0 || lost > maxLost) continue;
    // 口袋里若含城镇 ⇒ 有人当天回不了家（§19.3.2 ③）
    let townInside = false;
    for (const t of towns) {
      if (base[t] && !after[t]) {
        townInside = true;
        break;
      }
    }
    if (townInside) continue;
    out.push({ pos: { x: i % W, y: (i / W) | 0 }, lost, home: homes[i] });
  }
  return out;
}

/**
 * 从候选里挑 `want` 个：**距离分档**（一天 → 3/4 天 → 半天）后再**尽量拉开**
 * （切比雪夫 ≥3 格）。宁可挤、宁可近一点，也不可少 —— 栈数是 §19.3.2 定死的。
 *
 * 分档只在"上一档挑不满"时才往下走，所以**只要地图上有合规格子，就一定先用它**。
 */
export function outbreakCells(
  state: GameState,
  want: number,
  rng: () => number,
  opts: { maxLost?: number; minHomeCost?: number } = {},
): GridPos[] {
  const W = state.map.width;
  const steps = opts.minHomeCost !== undefined ? [opts.minHomeCost] : OUTBREAK_HOME_STEPS;
  const floor = steps[steps.length - 1]!;
  const cands = outbreakCandidates(state, { maxLost: opts.maxLost, minHomeCost: floor });
  const keys = cands.map((c) => c.pos.y * W + c.pos.x);
  const order = shuffle(rng, keys);
  const byKey = new Map<number, { lost: number; home: number }>();
  cands.forEach((c, i) => byKey.set(keys[i]!, { lost: c.lost, home: c.home }));
  const picked: number[] = [];
  const far = (a: number, b: number): boolean => {
    const ax = a % W;
    const ay = (a / W) | 0;
    const bx = b % W;
    const by = (b / W) | 0;
    return Math.abs(ax - bx) >= 3 || Math.abs(ay - by) >= 3;
  };
  for (const need of steps) {
    for (const i of order) {
      if (picked.length >= want) break;
      if (picked.includes(i)) continue;
      if ((byKey.get(i)?.home ?? 0) < need) continue;
      if (picked.some((p) => !far(p, i))) continue;
      picked.push(i);
    }
    if (picked.length >= want) break;
    // 同一档内先保距离、再讲好看：还有合规的格子就先把它们用完，
    // 宁可两栈挨着，也不为了"拉开"去用更近的格子（距离是安全规则，间距只是美观）。
    for (const i of order) {
      if (picked.length >= want) break;
      if (picked.includes(i)) continue;
      if ((byKey.get(i)?.home ?? 0) < need) continue;
      picked.push(i);
    }
    if (picked.length >= want) break;
  }
  return picked.map((i) => ({ x: i % W, y: (i / W) | 0 }));
}

/** 在指定格放一栈爆发怪（非阻挡：英雄走上去才触发交互，拒绝就被推回上一格）。 */
function addOutbreakMonster(
  state: GameState,
  pos: GridPos,
  army: Army,
  week: number,
): string {
  const id = `o${state.nextObjectId++}`;
  state.map.objects[id] = {
    id,
    kind: 'wanderingMonster',
    pos,
    payload: { army, tier: OUTBREAK_TIER[week] ?? 'mid', outbreak: true, outbreakWeek: week },
    once: true,
    blocking: false,
    visitedBy: [],
  };
  state.map.tiles[idx(state.map, pos.x, pos.y)].objectId = id;
  return id;
}

/**
 * 落地：到预告日按**当时**余量生成（不足不补发）。
 * 返回真正落地的栈数；`0` 也要写日志（否则玩家以为预告失效）。
 */
export function spawnOutbreak(
  state: GameState,
  opts: { cap?: number } = {},
): number {
  const ob = outbreakOf(state);
  const notice = ob.notice;
  if (!notice) return 0;
  const cap = opts.cap ?? OUTBREAK_CAP;
  const take = Math.min(notice.count, Math.max(0, cap - outbreakCount(state)));
  ob.lastDay = state.day;
  if (take <= 0) {
    pushLog(state, `${notice.name}爆发日到了，但路上已满（0 栈落地）`);
    return 0;
  }
  const rng = mulberry32(deriveSeed(state.seed, TAG_PLACE, notice.week * 31 + OUTBREAK_DAY_OF_WEEK));
  const cells = outbreakCells(state, take, rng);
  let placed = 0;
  for (const cell of cells) {
    addOutbreakMonster(state, cell, notice.armies[placed] ?? notice.armies[0]!, notice.week);
    placed += 1;
  }
  ob.spawned += placed;
  ob.live = outbreakCount(state);
  pushLog(
    state,
    placed < take
      ? `${notice.name}爆发：只落地 ${placed} 栈（${take - placed} 栈找不到合规路口，不补发）`
      : `${notice.name}爆发：地图上出现 ${placed} 栈，挡在必经之路上`,
  );
  return placed;
}

/**
 * 日界：到点落地 + **离线补结算**（§19.3.4 C4）。
 *
 * 弹性会话意味着玩家可能周二离线、周四回来。`lastDay >= notice.day` 是唯一闸门 ——
 * 一天一天推进时它保证只落一次；直接从 day 20 跳到 day 25 时它保证补上而不是永远错过。
 */
export function settleOutbreak(state: GameState, opts: { cap?: number } = {}): number {
  const notice = state.outbreak?.notice;
  if (!notice || state.day < notice.day) return 0;
  const ob = outbreakOf(state);
  if (ob.lastDay >= notice.day) {
    ob.notice = undefined;
    return 0;
  }
  const placed = spawnOutbreak(state, opts);
  ob.notice = undefined;
  return placed;
}

/** 难度对爆发栈的缩放（与地图野怪同一把 `monsterMul`，否则"轻松"只是在别处轻松）。 */
export function outbreakMulOf(state: GameState): number {
  return DIFFICULTIES[state.config?.difficulty ?? 'normal']?.monsterMul ?? 1;
}

/** 只给探针/UI 用：本周是否有待落地的预告。 */
export function pendingOutbreak(state: GameState): OutbreakNotice | null {
  return state.outbreak?.notice ?? null;
}
