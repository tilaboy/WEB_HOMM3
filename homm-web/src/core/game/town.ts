import type {
  Army,
  GameState,
  Hero,
  MapObject,
  MinePayload,
  PlayerId,
  ResourceBag,
  ResourceKind,
  Town,
  WarMachineId,
} from '../types.js';
import { BASE_TOWN_INCOME, BUILDINGS, HERO_HIRE_COST } from '../data/buildings.js';
import { WAR_MACHINES } from '../data/warmachines.js';
import { DIFFICULTIES, factionIds, factionName } from '../data/factions.js';
import { getSpell, spellsOfGuild } from '../data/spells.js';
import { MAX_STACKS, getUnit } from '../data/units.js';
import { HERO_TEMPLATES } from '../data/heroes.js';
import { addResources } from './hero.js';
import { isNewWeek, weekOf } from './calendar.js';
import { pushLog } from './log.js';
import { idx, isPassable } from '../map/grid.js';
import { BASE_MOVE_POINTS } from '../map/generator.js';

/** 市场汇率：买入 1000 金 → 5 单位；卖出 5 单位 → 500 金。 */
export const MARKET_BUY_GOLD = 1000;
export const MARKET_BUY_AMOUNT = 5;
export const MARKET_SELL_GOLD = 500;
export const MARKET_SELL_AMOUNT = 5;

/**
 * 各资源的交易汇率（M7）。
 *
 * 稀有资源按"个"交易而不是按"批"：宝石水晶只喂魔法行会（各 4 个），
 * 一次买 5 个既用不完又贵得离谱；按个买卖才能让稀有矿的日产出真的有用。
 * 定价上刻意让稀有资源**卖出比买入划算一半**——市场是变现渠道，不是印钞机。
 */
export type TradableResource = Exclude<ResourceKind, 'gold'>;
export const MARKET_TRADABLE: TradableResource[] = ['wood', 'ore', 'gem', 'crystal', 'sulfur', 'mercury'];
export const MARKET_RATES: Record<TradableResource, { buyGold: number; buyAmount: number; sellGold: number; sellAmount: number }> = {
  wood: { buyGold: 1000, buyAmount: 5, sellGold: 500, sellAmount: 5 },
  ore: { buyGold: 1000, buyAmount: 5, sellGold: 500, sellAmount: 5 },
  gem: { buyGold: 800, buyAmount: 1, sellGold: 400, sellAmount: 1 },
  crystal: { buyGold: 800, buyAmount: 1, sellGold: 400, sellAmount: 1 },
  sulfur: { buyGold: 800, buyAmount: 1, sellGold: 400, sellAmount: 1 },
  mercury: { buyGold: 800, buyAmount: 1, sellGold: 400, sellAmount: 1 },
};

/* ---------------- queries ---------------- */

export function hasBuilding(town: Town, id: string): boolean {
  return town.buildings.includes(id);
}

export function townDailyIncome(town: Town): number {
  let g = BASE_TOWN_INCOME;
  for (const id of town.buildings) g += BUILDINGS[id]?.dailyGold ?? 0;
  return g;
}

/** 城墙取已建部分的最高档，不叠加。 */
export function townDefenseBonus(town: Town): number {
  let d = 0;
  for (const id of town.buildings) d = Math.max(d, BUILDINGS[id]?.defenseBonus ?? 0);
  return d;
}

export function townGrowthMultiplier(town: Town): number {
  let m = 1;
  for (const id of town.buildings) m += BUILDINGS[id]?.growthBonus ?? 0;
  return m;
}

export function ownedTowns(state: GameState, player: PlayerId): Town[] {
  return Object.values(state.towns).filter((t) => t.owner === player);
}

export function totalDailyIncome(state: GameState, player: PlayerId): number {
  return ownedTowns(state, player).reduce((s, t) => s + townDailyIncome(t), 0);
}

/* ---------------- resources ---------------- */

export function canAfford(state: GameState, player: PlayerId, cost: ResourceBag): boolean {
  const bag = state.players[player]?.resources ?? {};
  for (const [k, v] of Object.entries(cost) as [ResourceKind, number][]) {
    if (!v) continue;
    if ((bag[k] ?? 0) < v) return false;
  }
  return true;
}

/** 扣费，成功返回 true（不足时不扣）。 */
export function pay(state: GameState, player: PlayerId, cost: ResourceBag): boolean {
  if (!canAfford(state, player, cost)) return false;
  const bag = state.players[player]!.resources;
  for (const [k, v] of Object.entries(cost) as [ResourceKind, number][]) {
    if (!v) continue;
    bag[k] = (bag[k] ?? 0) - v;
  }
  return true;
}

/**
 * 造价的显示顺序与简称。
 *
 * **必须覆盖全部七种资源**：M7 之后宝石/水晶/硫磺/水银都真的会进造价
 * （大法师塔就要 4 水晶），而早期这里只印金/木/矿——玩家看到
 * "资源不足（4500 金）"、自己明明有两万金，真正缺的水晶却根本没露面。
 */
export const COST_ORDER: ResourceKind[] = [
  'gold', 'wood', 'ore', 'gem', 'crystal', 'sulfur', 'mercury',
];

export const COST_LABEL: Record<ResourceKind, string> = {
  gold: '金',
  wood: '木',
  ore: '矿',
  gem: '宝石',
  crystal: '水晶',
  sulfur: '硫磺',
  mercury: '水银',
};

export function costText(cost: ResourceBag): string {
  const parts = COST_ORDER.filter((k) => (cost[k] ?? 0) > 0).map(
    (k) => `${cost[k]} ${COST_LABEL[k]}`,
  );
  return parts.length ? parts.join(' · ') : '免费';
}

/** 还差哪些资源（现有 / 需要）。UI 直接拿它画红字，不用自己猜。 */
export function missingResources(
  state: GameState,
  player: PlayerId,
  cost: ResourceBag,
): { resource: ResourceKind; have: number; need: number }[] {
  const bag = state.players[player]?.resources ?? {};
  const out: { resource: ResourceKind; have: number; need: number }[] = [];
  for (const k of COST_ORDER) {
    const need = cost[k] ?? 0;
    if (!need) continue;
    const have = bag[k] ?? 0;
    if (have < need) out.push({ resource: k, have, need });
  }
  return out;
}

/* ---------------- building ---------------- */

export interface BuildStatus {
  built: boolean;
  /** 前置建筑是否齐备 */
  unlocked: boolean;
  affordable: boolean;
  /** 今天这座城是否已经建过别的建筑（HOMM 规则：每城每日限一座） */
  spentToday: boolean;
  reason: string;
  /** 这座建筑的完整造价（七种资源，UI 用来画明细） */
  cost: ResourceBag;
  /** 到底差哪些资源：UI 把这几项标红，玩家一眼知道缺什么 */
  missing: { resource: ResourceKind; have: number; need: number }[];
}

const NO_COST: ResourceBag = {};

function fail(reason: string, cost: ResourceBag = NO_COST): BuildStatus {
  return {
    built: false, unlocked: false, affordable: false, spentToday: false,
    reason, cost, missing: [],
  };
}

export function buildStatus(state: GameState, town: Town, id: string, actor: PlayerId = 'p1'): BuildStatus {
  const def = BUILDINGS[id];
  if (!def) return fail('未知建筑');
  if (town.owner !== actor) {
    return {
      built: hasBuilding(town, id), unlocked: false, affordable: false, spentToday: false,
      reason: '非我方城镇', cost: def.cost, missing: [],
    };
  }
  if (hasBuilding(town, id)) {
    return {
      built: true, unlocked: true, affordable: true, spentToday: false,
      reason: '已建成', cost: def.cost, missing: [],
    };
  }
  const lacks = def.requires.filter((r) => !hasBuilding(town, r));
  if (lacks.length) {
    const names = lacks.map((m) => BUILDINGS[m]?.name ?? m).join('、');
    return fail(`需先建造：${names}`, def.cost);
  }
  if (town.builtDay === state.day) {
    return {
      built: false, unlocked: true, affordable: false, spentToday: true,
      reason: `今日已在 ${town.name} 建造过，明日再来`, cost: def.cost, missing: [],
    };
  }
  // 差什么就说差什么，并把"现有 / 需要"一起报出来：
  // 只说"资源不足"而玩家看不到宝石水晶的库存，等于什么也没说
  const short = missingResources(state, town.owner, def.cost);
  return {
    built: false,
    unlocked: true,
    affordable: short.length === 0,
    spentToday: false,
    cost: def.cost,
    missing: short,
    reason: short.length
      ? `资源不足：${short.map((m) => `${COST_LABEL[m.resource]} ${m.have}/${m.need}`).join('、')}`
      : costText(def.cost),
  };
}

/** 今天还能不能在这座城动工。 */
export function canBuildToday(state: GameState, town: Town): boolean {
  return town.builtDay !== state.day;
}

export function canBuild(state: GameState, town: Town, id: string, actor: PlayerId = 'p1'): boolean {
  const s = buildStatus(state, town, id, actor);
  return !s.built && s.unlocked && s.affordable && !s.spentToday;
}

export function build(state: GameState, town: Town, id: string, actor: PlayerId = 'p1'): boolean {
  if (!canBuild(state, town, id, actor)) return false;
  if (!pay(state, actor, BUILDINGS[id]!.cost)) return false;
  town.buildings.push(id);
  town.builtDay = state.day;
  const g = BUILDINGS[id]!.growth;
  if (g && !town.growthPool[g.unitTypeId]) town.growthPool[g.unitTypeId] = 0;
  pushLog(state, `${town.name} 建成了「${BUILDINGS[id]!.name}」`);
  if (BUILDINGS[id]!.feature === 'guild') spreadGuildSpells(state, town);
  return true;
}

/* ---------------- 魔法行会（M4） ---------------- */

/** 城镇的行会等级（0~3）。 */
export function guildLevel(town: Town): number {
  if (hasBuilding(town, 'guild3')) return 3;
  if (hasBuilding(town, 'guild2')) return 2;
  if (hasBuilding(town, 'guild1')) return 1;
  return 0;
}

/** 把城镇行会当前等级的法术教给一位英雄，返回新学的法术名列表。 */
export function teachGuildSpells(state: GameState, hero: Hero, town: Town): string[] {
  const learned: string[] = [];
  for (const spellId of spellsOfGuild(guildLevel(town))) {
    if (!hero.spells.includes(spellId)) {
      hero.spells.push(spellId);
      learned.push(getSpell(spellId).name);
    }
  }
  if (learned.length) {
    pushLog(state, `${hero.name} 在 ${town.name} 学会了 ${learned.join('、')}`);
  }
  return learned;
}

/** 行会建成 / 城镇易主后：该城行会的法术向己方全部英雄开放。 */
function spreadGuildSpells(state: GameState, town: Town): void {
  for (const id of state.heroOrder) {
    const h = state.heroes[id];
    if (h && h.owner === town.owner) teachGuildSpells(state, h, town);
  }
}

/* ---------------- 工坊：攻城器械（M6） ---------------- */

/** 英雄带在身上的攻城器械（老存档没有这个字段，统一兜底成空数组）。 */
export function heroWarMachines(hero: Hero): WarMachineId[] {
  return hero.warMachines ?? [];
}

export function hasWarMachine(hero: Hero, id: WarMachineId): boolean {
  return heroWarMachines(hero).includes(id);
}

export function canAssemble(
  state: GameState,
  town: Town,
  hero: Hero | null,
  id: WarMachineId,
): { ok: boolean; reason: string } {
  if (!hasBuilding(town, 'workshop')) return { ok: false, reason: '需要先建造「工坊」' };
  if (!hero) return { ok: false, reason: '需要一位英雄在城里' };
  if (hero.owner !== town.owner) return { ok: false, reason: '这位英雄不属于本城阵营' };
  if (hasWarMachine(hero, id)) return { ok: false, reason: `已经带了${WAR_MACHINES[id].name}` };
  const cost = WAR_MACHINES[id].cost;
  if (!canAfford(state, town.owner, cost)) {
    return { ok: false, reason: `资源不足（${costText(cost)}）` };
  }
  return { ok: true, reason: costText(cost) };
}

/**
 * 在工坊为英雄装配一台攻城器械。
 *
 * 刻意做成"一次性买断、不占部队格、打输了才会丢"：HOMM3 里器械被摧毁要重买，
 * 那套规则会逼出"用先手秒掉对方投石车"的固定套路，对这个体量不值得。
 */
export function assembleWarMachine(
  state: GameState,
  town: Town,
  hero: Hero,
  id: WarMachineId,
): AssembleResult {
  const check = canAssemble(state, town, hero, id);
  if (!check.ok) return { ok: false, reason: check.reason };
  if (!pay(state, town.owner, WAR_MACHINES[id].cost)) return { ok: false, reason: '资源不足' };
  hero.warMachines = [...heroWarMachines(hero), id];
  pushLog(state, `${town.name} 的工坊为 ${hero.name} 装配了「${WAR_MACHINES[id].name}」`);
  return { ok: true, reason: '' };
}

export interface AssembleResult {
  ok: boolean;
  reason: string;
}

/* ---------------- weekly growth ---------------- */

/** 每周增长：所有阵营一起结算，电脑对手按难度再拿一点额外增长。 */
export function applyWeeklyGrowth(state: GameState): void {
  const aiBonus = DIFFICULTIES[state.config?.difficulty ?? 'normal'].growthBonus;
  for (const player of factionIds(state)) {
    const bonus = state.players[player]?.isHuman ? 0 : aiBonus;
    for (const town of ownedTowns(state, player)) {
      const mult = townGrowthMultiplier(town) + bonus;
      for (const id of town.buildings) {
        const g = BUILDINGS[id]?.growth;
        if (!g) continue;
        const add = Math.floor(g.count * mult);
        town.growthPool[g.unitTypeId] = (town.growthPool[g.unitTypeId] ?? 0) + add;
      }
    }
  }
}

/* ---------------- army helpers ---------------- */

export function addToArmy(army: Army, unitTypeId: string, count: number): void {
  if (count <= 0) return;
  const s = army.find((a) => a.unitTypeId === unitTypeId);
  if (s) s.count += count;
  else army.push({ unitTypeId, count });
}

export function takeFromArmy(army: Army, unitTypeId: string, count: number): number {
  const s = army.find((a) => a.unitTypeId === unitTypeId);
  if (!s) return 0;
  const t = Math.min(count, s.count);
  s.count -= t;
  if (s.count <= 0) army.splice(army.indexOf(s), 1);
  return t;
}

export function countIn(army: Army, unitTypeId: string): number {
  return army.find((a) => a.unitTypeId === unitTypeId)?.count ?? 0;
}

/** 部队是否还能容纳一个新兵种。 */
export function canAddNewStack(army: Army, unitTypeId: string): boolean {
  if (army.some((a) => a.unitTypeId === unitTypeId)) return true;
  return army.length < MAX_STACKS;
}

/* ---------------- recruiting ---------------- */

export interface RecruitRow {
  unitTypeId: string;
  available: number;
  cost: ResourceBag;
  /** 当前金币能买得起的数量 */
  affordable: number;
}

export function recruitRows(state: GameState, town: Town): RecruitRow[] {
  const rows: RecruitRow[] = [];
  for (const id of town.buildings) {
    const g = BUILDINGS[id]?.growth;
    if (!g) continue;
    const available = town.growthPool[g.unitTypeId] ?? 0;
    const cost = getUnit(g.unitTypeId).cost;
    rows.push({
      unitTypeId: g.unitTypeId,
      available,
      cost,
      affordable: maxAffordable(state, town.owner, cost, available),
    });
  }
  return rows;
}

export function maxAffordable(
  state: GameState,
  player: PlayerId,
  unitCost: ResourceBag,
  limit: number,
): number {
  const bag = state.players[player]?.resources ?? {};
  let n = limit;
  for (const [k, v] of Object.entries(unitCost) as [ResourceKind, number][]) {
    if (!v) continue;
    n = Math.min(n, Math.floor((bag[k] ?? 0) / v));
  }
  return Math.max(0, n);
}

export function unitCost(count: number, unitCost: ResourceBag): ResourceBag {
  const out: ResourceBag = {};
  for (const [k, v] of Object.entries(unitCost) as [ResourceKind, number][]) {
    if (v) out[k] = v * count;
  }
  return out;
}

export interface RecruitResult {
  taken: number;
  reason: string;
}

export function recruitToHero(
  state: GameState,
  town: Town,
  hero: Hero | null,
  unitTypeId: string,
  count: number,
): RecruitResult {
  if (!hero) return { taken: 0, reason: '没有英雄在城里' };
  const base = getUnit(unitTypeId).cost;
  let n = Math.min(count, town.growthPool[unitTypeId] ?? 0);
  n = Math.min(n, maxAffordable(state, town.owner, base, n));
  if (n <= 0) return { taken: 0, reason: '可招募数量不足或资源不足' };
  if (!canAddNewStack(hero.army, unitTypeId)) {
    return { taken: 0, reason: `英雄部队已有 ${MAX_STACKS} 个兵种` };
  }
  if (!pay(state, town.owner, unitCost(n, base))) return { taken: 0, reason: '资源不足' };
  town.growthPool[unitTypeId] = (town.growthPool[unitTypeId] ?? 0) - n;
  addToArmy(hero.army, unitTypeId, n);
  pushLog(state, `${town.name} 为 ${hero.name} 补充了 ${getUnit(unitTypeId).name} ×${n}`);
  return { taken: n, reason: '' };
}

export function recruitToGarrison(
  state: GameState,
  town: Town,
  unitTypeId: string,
  count: number,
): RecruitResult {
  const base = getUnit(unitTypeId).cost;
  let n = Math.min(count, town.growthPool[unitTypeId] ?? 0);
  n = Math.min(n, maxAffordable(state, town.owner, base, n));
  if (n <= 0) return { taken: 0, reason: '可招募数量不足或资源不足' };
  if (!canAddNewStack(town.garrison, unitTypeId)) {
    return { taken: 0, reason: '驻军兵种已满' };
  }
  if (!pay(state, town.owner, unitCost(n, base))) return { taken: 0, reason: '资源不足' };
  town.growthPool[unitTypeId] = (town.growthPool[unitTypeId] ?? 0) - n;
  addToArmy(town.garrison, unitTypeId, n);
  pushLog(state, `${town.name} 驻军增加了 ${getUnit(unitTypeId).name} ×${n}`);
  return { taken: n, reason: '' };
}

/* ---------------- garrison <-> hero ---------------- */

/** 英雄把部队留下守城。 */
export function heroToGarrison(hero: Hero, town: Town, unitTypeId: string, count: number): number {
  if (!canAddNewStack(town.garrison, unitTypeId)) return 0;
  const t = takeFromArmy(hero.army, unitTypeId, count);
  if (t > 0) addToArmy(town.garrison, unitTypeId, t);
  return t;
}

/** 英雄从驻军中带走部队。 */
export function garrisonToHero(hero: Hero, town: Town, unitTypeId: string, count: number): number {
  if (!canAddNewStack(hero.army, unitTypeId)) return 0;
  const t = takeFromArmy(town.garrison, unitTypeId, count);
  if (t > 0) addToArmy(hero.army, unitTypeId, t);
  return t;
}

/* ---------------- tavern ---------------- */

export function canHireHero(state: GameState, town: Town): { ok: boolean; reason: string } {
  if (!hasBuilding(town, 'tavern')) return { ok: false, reason: '尚未建造酒馆' };
  if ((state.players[town.owner]?.resources.gold ?? 0) < HERO_HIRE_COST) {
    return { ok: false, reason: `需要 ${HERO_HIRE_COST} 金币` };
  }
  if (town.hiredWeek === weekOf(state.day)) return { ok: false, reason: '本周已招募过英雄' };
  if (!freeTileNear(state, town)) return { ok: false, reason: '城镇周围没有空地' };
  return { ok: true, reason: '' };
}

function isOccupied(state: GameState, x: number, y: number): boolean {
  if (!isPassable(state.map, x, y)) return true;
  if (state.map.tiles[idx(state.map, x, y)].objectId) return true;
  for (const id of state.heroOrder) {
    const h = state.heroes[id];
    if (h && h.pos.x === x && h.pos.y === y) return true;
  }
  return false;
}

function freeTileNear(state: GameState, town: Town): { x: number; y: number } | null {
  const ring: [number, number][] = [
    [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
    [2, 0], [0, 2], [-2, 0], [0, -2],
  ];
  for (const [dx, dy] of ring) {
    const x = town.pos.x + dx;
    const y = town.pos.y + dy;
    if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) continue;
    if (!isOccupied(state, x, y)) return { x, y };
  }
  return null;
}

export function hireHero(state: GameState, town: Town): Hero | null {
  const check = canHireHero(state, town);
  if (!check.ok) return null;
  const spot = freeTileNear(state, town);
  if (!spot) return null;
  if (!pay(state, town.owner, { gold: HERO_HIRE_COST })) return null;

  let n = 1;
  while (state.heroes[`hero${n}`]) n += 1;
  const id = `hero${n}`;
  const tpl = HERO_TEMPLATES[(n - 1) % HERO_TEMPLATES.length];
  const hero: Hero = {
    id,
    name: tpl.name,
    heroClass: tpl.className,
    portrait: tpl.portrait,
    level: 1,
    exp: 0,
    primary: { ...tpl.primary },
    mana: tpl.primary.knowledge * 10,
    manaMax: tpl.primary.knowledge * 10,
    movePoints: BASE_MOVE_POINTS,
    army: tpl.startArmy.map((s) => ({ ...s })),
    artifacts: [],
    spells: [],
    pos: spot,
    owner: town.owner,
  };
  state.heroes[id] = hero;
  state.heroOrder.push(id);
  teachGuildSpells(state, hero, town);
  town.hiredWeek = weekOf(state.day);
  pushLog(state, `${hero.name} 在 ${town.name} 应征入伍`);
  return hero;
}

/* ---------------- market ---------------- */

/**
 * 在市场买入 / 卖出。
 *
 * `actor` 默认 'p1'（玩家的 UI 调用点不用改），电脑对手传自己的阵营 id ——
 * AI 必须和玩家走**同一个函数**，否则汇率的每一次调整都要在两处同步，
 * 而 ai.ts 里那份抄下来的「1000 金 → 5 单位」只对木/矿成立，会把稀有资源堵死。
 */
export function marketBuy(
  state: GameState,
  res: TradableResource,
  actor: PlayerId = 'p1',
): boolean {
  const rate = MARKET_RATES[res];
  if (!rate) return false;
  if (!pay(state, actor, { gold: rate.buyGold })) return false;
  addResources(state, actor, { [res]: rate.buyAmount });
  return true;
}

export function marketSell(
  state: GameState,
  res: TradableResource,
  actor: PlayerId = 'p1',
): boolean {
  const rate = MARKET_RATES[res];
  if (!rate) return false;
  if (!pay(state, actor, { [res]: rate.sellAmount })) return false;
  addResources(state, actor, { gold: rate.sellGold });
  return true;
}

/* ---------------- mines ---------------- */

/** 玩家已占领的矿场。 */
export function ownedMines(state: GameState, player: PlayerId): MapObject[] {
  return Object.values(state.map.objects).filter(
    (o) => o.kind === 'mine' && (o.payload as MinePayload).owner === player,
  );
}

/** 矿场每日产出汇总。 */
export function mineIncome(state: GameState, player: PlayerId): ResourceBag {
  const out: ResourceBag = {};
  for (const m of ownedMines(state, player)) {
    const p = m.payload as MinePayload;
    out[p.resource] = (out[p.resource] ?? 0) + p.perDay;
  }
  return out;
}

/* ---------------- capture ---------------- */

export function captureTown(state: GameState, town: Town, player: PlayerId): void {
  town.owner = player;
  town.garrison = [];
  if (!town.buildings.includes('tavern')) town.buildings.push('tavern');
  if (!town.growthPool) town.growthPool = {};
  pushLog(state, `${town.name} 被${factionName(player)}占领`);
  if (guildLevel(town) > 0) spreadGuildSpells(state, town);
}

/** 城镇驻军是否还有战斗力。 */
export function garrisonStrength(garrison: Army): number {
  return garrison.reduce((s, st) => s + (st.count > 0 ? st.count * getUnit(st.unitTypeId).hp : 0), 0);
}

export { isNewWeek };
