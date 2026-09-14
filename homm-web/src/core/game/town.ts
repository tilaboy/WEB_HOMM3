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
} from '../types.js';
import { BASE_TOWN_INCOME, BUILDINGS, HERO_HIRE_COST } from '../data/buildings.js';
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

export function costText(cost: ResourceBag): string {
  const parts: string[] = [];
  if (cost.gold) parts.push(`${cost.gold} 金`);
  if (cost.wood) parts.push(`${cost.wood} 木`);
  if (cost.ore) parts.push(`${cost.ore} 矿`);
  return parts.length ? parts.join(' · ') : '免费';
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
}

function fail(reason: string): BuildStatus {
  return { built: false, unlocked: false, affordable: false, spentToday: false, reason };
}

export function buildStatus(state: GameState, town: Town, id: string, actor: PlayerId = 'p1'): BuildStatus {
  const def = BUILDINGS[id];
  if (!def) return fail('未知建筑');
  if (town.owner !== actor) {
    return {
      built: hasBuilding(town, id), unlocked: false, affordable: false, spentToday: false,
      reason: '非我方城镇',
    };
  }
  if (hasBuilding(town, id)) {
    return { built: true, unlocked: true, affordable: true, spentToday: false, reason: '已建成' };
  }
  const missing = def.requires.filter((r) => !hasBuilding(town, r));
  if (missing.length) {
    const names = missing.map((m) => BUILDINGS[m]?.name ?? m).join('、');
    return { ...fail(`需先建造：${names}`) };
  }
  if (town.builtDay === state.day) {
    return {
      built: false, unlocked: true, affordable: false, spentToday: true,
      reason: `今日已在 ${town.name} 建造过，明日再来`,
    };
  }
  const affordable = canAfford(state, town.owner, def.cost);
  return {
    built: false,
    unlocked: true,
    affordable,
    spentToday: false,
    reason: affordable ? costText(def.cost) : `资源不足（${costText(def.cost)}）`,
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

export function marketBuy(state: GameState, res: 'wood' | 'ore'): boolean {
  if (!pay(state, 'p1', { gold: MARKET_BUY_GOLD })) return false;
  addResources(state, 'p1', { [res]: MARKET_BUY_AMOUNT });
  return true;
}

export function marketSell(state: GameState, res: 'wood' | 'ore'): boolean {
  if (!pay(state, 'p1', { [res]: MARKET_SELL_AMOUNT })) return false;
  addResources(state, 'p1', { gold: MARKET_SELL_GOLD });
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
