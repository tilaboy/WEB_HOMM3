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
import { BASE_TOWN_INCOME, BUILDINGS, DWELLING_IDS, HERO_HIRE_COST, upgradeCostOf } from '../data/buildings.js';
import { WAR_MACHINES } from '../data/warmachines.js';
import { DIFFICULTIES, factionIds, factionName } from '../data/factions.js';
import { getSpell, spellsOfGuild } from '../data/spells.js';
import { MAX_STACKS, baseUnitIdOf, getUnit, unitIdForTier, upgradeUnlockedFor } from '../data/units.js';
import { heroTemplateFor, startArmyFor } from '../data/heroes.js';
import { addResources, maxMovePoints } from './hero.js';
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

/**
 * 建筑等级（S4 · spec §2.4）：**没建 = 0，建了缺省 = 1**。
 *
 * 单独读 `town.levels` 而不是把等级塞进 `buildings` 里：`buildings` 是集合语义
 * （日收入 / 城防 / 周产都 `for (const id of town.buildings)` 遍历），
 * 重复 id 会让同一栋楼被结算两次。
 */
export function levelOf(town: Town, id: string): number {
  if (!hasBuilding(town, id)) return 0;
  return Math.max(1, town.levels?.[id] ?? 1);
}

/** 下一级造价；已满级 / 未知建筑返回 null。 */
export function nextUpgradeCost(town: Town, id: string): ResourceBag | null {
  const def = BUILDINGS[id];
  if (!def) return null;
  const lv = levelOf(town, id);
  const max = def.maxLevel ?? 1;
  if (lv < 1 || lv >= max) return null;
  return upgradeCostOf(def);
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

/**
 * 建筑的**全档**周增长倍率（1 = 不加成）。
 *
 * ⚠️ 它只负责"建筑那一半"，**难度加成要由调用方加进来、周事件要用乘法套在外面**
 * （§27.10 / 决策 53）。用法一律走 `weeklyGrowthMultiplier()`：
 *   建筑倍率 + 难度加成 = 加算（地板 0.5 只套这一段）
 *   再 × 周事件倍率      = 乘算
 * 把事件当成"负的 bonus"塞进来会让 `城墙 +50%` 与 `瘟疫 −50%` 抵消成 1.0，
 * 而正确值是 `1.5 × 0.5 = 0.75`。
 */
export function townGrowthMultiplier(town: Town): number {
  let m = 1;
  for (const id of town.buildings) m += BUILDINGS[id]?.growthBonus ?? 0;
  return m;
}

/**
 * 只看**某一档**的周产倍率（`banner`：本族 T3 ×1.5）。与 `growthBonus` 乘算。
 *
 * 用连乘而不是 `max`：同档多座加成建筑要能叠（现在只有一座，但语义别写死）。
 */
export function tierGrowthMultiplier(town: Town, tier: number): number {
  let m = 1;
  for (const id of town.buildings) {
    const b = BUILDINGS[id]?.tierGrowthBoost;
    if (b && b.tier === tier) m *= b.mult;
  }
  return m;
}

/**
 * 兵营等级 → 该档周产倍率（S4 · spec §2.5 表格最后一行）：
 * **L1 = 1、L2 = 1、L3 = 1.25**。
 *
 * 只有 L3 加产量，L2 不加 —— L2 的全部意义是"换成升级版"，再叠一个 +25%
 * 会让"升级"这一笔钱同时买到两种东西（单位变强 + 产量变多），
 * 玩家就分不清自己在为什么付钱（决策 59 把两笔钱分开的同一理由）。
 * 与 `banner`（T3 ×1.5）**乘算**：满建 T3 = 1.5 × 1.25 = 1.875。
 */
export function dwellingLevelGrowthMult(town: Town, tier: number): number {
  const id = DWELLING_IDS[tier - 1];
  if (!id) return 1;
  const lv = levelOf(town, id);
  return lv >= 3 ? 1.25 : 1;
}

/**
 * 周增长总倍率 —— **§27.10 的顺序就写在这一行里**，不许在别处重排。
 *
 *   townMult = max(0.5, 建筑倍率 + 难度加成)   // 加算，地板只套这一段
 *   mult     = townMult × eventMult             // 周事件乘算
 *
 * 两条负向对照（`audit:econ` 的 G-E6 就是这么量的）：
 *   ① wall2 + wall3 + 瘟疫：`1.5 × 0.5 = 0.75`；把 −0.5 塞进 bonus 会读成 **1.00**
 *   ② 无墙 + 瘟疫：`1.0 × 0.5 = 0.50`；把地板套在乘积上会读成 **0.25**
 */
export function weeklyGrowthMultiplier(
  town: Town,
  difficultyBonus = 0,
  eventMult = 1,
): number {
  const townMult = Math.max(0.5, townGrowthMultiplier(town) + difficultyBonus);
  return townMult * eventMult;
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
  /** 现有等级：未建 = 0，建成未升 = 1（S4 · spec §2.4） */
  level: number;
  maxLevel: number;
  /** 已建成、还有下一级 ⇒ UI 把「建造」换成「升级」 */
  canUpgrade: boolean;
  /** 前置建筑是否齐备 */
  unlocked: boolean;
  affordable: boolean;
  /** 今天这座城是否已经动过工（HOMM 规则：每城每日一次，建造与升级共用） */
  spentToday: boolean;
  reason: string;
  /** **下一笔**要花的钱：建造 = 全额；升级 = 0 金 + 木/矿半价；满级 = 空 */
  cost: ResourceBag;
  /** 到底差哪些资源：UI 把这几项标红，玩家一眼知道缺什么 */
  missing: { resource: ResourceKind; have: number; need: number }[];
}

const NO_COST: ResourceBag = {};

function fail(reason: string, cost: ResourceBag = NO_COST): BuildStatus {
  return {
    built: false, level: 0, maxLevel: 1, canUpgrade: false,
    unlocked: false, affordable: false, spentToday: false,
    reason, cost, missing: [],
  };
}

export function buildStatus(state: GameState, town: Town, id: string, actor: PlayerId = 'p1'): BuildStatus {
  const def = BUILDINGS[id];
  if (!def) return fail('未知建筑');
  const maxLevel = def.maxLevel ?? 1;
  const level = levelOf(town, id);
  // 兵种升级要等这一族的升级形态画完（`ELITE_ART_FAMILIES`）——
  // 没画完却给出「升级」按钮，玩家花木/矿换到一个什么都不变的等级。
  const artReady = !def.growth || upgradeUnlockedFor(town.owner, def.growth.tier);
  const tier = { level, maxLevel, canUpgrade: level >= 1 && level < maxLevel && artReady };
  if (town.owner !== actor) {
    return {
      ...tier, built: level > 0, unlocked: false, affordable: false, spentToday: false,
      reason: '非我方城镇', cost: def.cost, missing: [],
    };
  }
  if (level >= maxLevel) {
    return {
      ...tier, built: true, unlocked: true, affordable: true, spentToday: false,
      reason: level > 1 ? `已满级 Lv.${level}` : '已建成', cost: NO_COST, missing: [],
    };
  }
  if (level > 0 && !artReady) {
    // 形态还没画：如实说"未开放"，不给一个点了也没用的「升级」按钮
    return {
      ...tier, built: true, unlocked: true, affordable: false, spentToday: false,
      reason: '升级形态制作中', cost: NO_COST, missing: [],
    };
  }
  // 升级分支：先建后升，**升级不需要再满足前置**（前置在建 L1 时已经付过）
  const cost = level === 0 ? def.cost : (nextUpgradeCost(town, id) ?? NO_COST);
  const lacks = level === 0 ? def.requires.filter((r) => !hasBuilding(town, r)) : [];
  if (lacks.length) {
    const names = lacks.map((m) => BUILDINGS[m]?.name ?? m).join('、');
    return { ...fail(`需先建造：${names}`, cost), level };
  }
  if (town.builtDay === state.day) {
    return {
      ...tier, built: level > 0, unlocked: true, affordable: false, spentToday: true,
      reason: `今日已在 ${town.name} 动工，明日再来`, cost, missing: [],
    };
  }
  // 差什么就说差什么，并把"现有 / 需要"一起报出来：
  // 只说"资源不足"而玩家看不到宝石水晶的库存，等于什么也没说
  const short = missingResources(state, town.owner, cost);
  return {
    ...tier,
    built: level > 0,
    unlocked: true,
    affordable: short.length === 0,
    spentToday: false,
    cost,
    missing: short,
    reason: short.length
      ? `资源不足：${short.map((m) => `${COST_LABEL[m.resource]} ${m.have}/${m.need}`).join('、')}`
      : costText(cost),
  };
}

/** 今天还能不能在这座城动工。 */
export function canBuildToday(state: GameState, town: Town): boolean {
  return town.builtDay !== state.day;
}

export function canBuild(state: GameState, town: Town, id: string, actor: PlayerId = 'p1'): boolean {
  const s = buildStatus(state, town, id, actor);
  // 建 L1 与升下一级走同一个入口（spec §2.4「点已建建筑 → 建造换成升级」）
  return s.unlocked && s.affordable && !s.spentToday && (s.level === 0 || s.canUpgrade);
}

/**
 * 兵营升到 L2 时，池里的基础版**免费**转成升级版（决策 59「未售出库存」）。
 *
 * 为什么连 `growthRemainder` 一起搬：两张表的键是兵种 id，L2 之后周产只往升级版累加，
 * 基础版那条小数余数会永远停在原地 —— 不搬就是"升级后产量莫名少了一个零头"。
 * `delete` 而不是置 0：基础版绝版（spec §2.5「产出」一行），留下一个 0 键只会让
 * 面板继续列一行 0 个。
 */
function convertPoolToUpgrade(town: Town, tier: number): void {
  const base = unitIdForTier(town.owner, tier);
  const up = unitIdForTier(town.owner, tier, true);
  if (!base || !up || base === up) return;
  const n = town.growthPool[base] ?? 0;
  if (n > 0) town.growthPool[up] = (town.growthPool[up] ?? 0) + n;
  delete town.growthPool[base];
  const r = town.growthRemainder?.[base] ?? 0;
  if (r > 0) {
    if (!town.growthRemainder) town.growthRemainder = {};
    town.growthRemainder[up] = (town.growthRemainder[up] ?? 0) + r;
  }
  if (town.growthRemainder) delete town.growthRemainder[base];
}

/**
 * 兵营增长 → 这座城**实际**长出的兵种 id（段 2）。
 *
 * `buildings.ts` 的 `growth` 只记 `tier`（阵营无关），具体 id 必须按**城镇 owner**
 * 现解析：同一座 `dwell3` 在四族里长出四种兵；城镇易主后产的兵也随之改变。
 *
 * ⚠️ **中立方返回 `null`，绝不 fallback 到 p1**（`races.md §6.4.2` 规则 5）：
 * 静默 fallback 会把「中立城被当成晨曦」这类 bug 藏起来。调用方拿到 `null`
 * 必须**跳过并记日志**。这条路径当前实际不可达（中立城 `buildings: []`，
 * 且全项目没有任何一处把 `owner` 改回 `'neutral'`），所以显式失败是安全的。
 */
function dwellUnitId(town: Town, tier: number, where: string): string | null {
  // L2（兵营升过一次）之后只产升级版；L1 产基础版（spec §2.5「产出」一行）
  const dwellId = DWELLING_IDS[tier - 1];
  const upgraded = !!dwellId && levelOf(town, dwellId) >= 2;
  const id = unitIdForTier(town.owner, tier, upgraded);
  if (!id) {
    console.warn(
      `[town] ${where}: 城镇 ${town.id}（owner=${town.owner}）解析不出 tier${tier} 的兵种，已跳过（按规则 5 不 fallback 到 p1）`,
    );
  }
  return id;
}

export function build(state: GameState, town: Town, id: string, actor: PlayerId = 'p1'): boolean {
  if (!canBuild(state, town, id, actor)) return false;
  const def = BUILDINGS[id]!;
  const lv = levelOf(town, id);
  /* ---- 升级分支（S4 · spec §2.4）----
     与建造共用「每日一次」与同一个按钮；只收木/矿（兵营 0 金，决策 60）。 */
  if (lv > 0) {
    const cost = nextUpgradeCost(town, id);
    if (!cost) return false;
    if (!pay(state, actor, cost)) return false;
    town.levels = { ...(town.levels ?? {}), [id]: lv + 1 };
    town.builtDay = state.day;
    // 兵营刚升到 L2 ⇒ 池里的基础版免费转升级版（这一级就是兵种升级入口）
    const g = def.growth;
    if (g && lv + 1 === 2) convertPoolToUpgrade(town, g.tier);
    pushLog(state, `${town.name} 的「${def.name}」升级到 Lv.${lv + 1}`);
    return true;
  }
  if (!pay(state, actor, def.cost)) return false;
  town.buildings.push(id);
  town.builtDay = state.day;
  const g = def.growth;
  if (g) {
    // 兵种按 owner 现解析：四族各建各的 dwell1，池子里开出来的键也必须各不相同。
    const uid = dwellUnitId(town, g.tier, 'build');
    if (uid && !town.growthPool[uid]) town.growthPool[uid] = 0;
  }
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

/**
 * 每周增长：所有阵营一起结算。
 *
 * 此前 AI 的 `growthBonus` 因 `Math.floor(g.count * mult)` 对小产量兵种完全空转
 * （弓手 5 × 1.1 = 5.5 → floor 5 → 增量 0）。现在把小数余数攒进 `growthRemainder`，
 * 攒满 1 再进位进 `growthPool`，于是 +0.1 这类"小数加成"能真正多产兵。
 *
 * **周产数量的来源（2026-10-20 修正）**：唯一权威是 `UnitType.growthPerWeek`，
 * 不是 `BUILDINGS[id].growth.count`。后者曾是与兵种表并存的第二份真相，
 * 而本函数只读它 ⇒ 四族 T1 统统 +10、赤焰（12）与紫晶（9）的设计产量从未生效。
 * 现在按 `dwellUnitId(town, tier)` 解析出**本族**兵种，再查它的 `growthPerWeek`：
 * 同一座农舍在四个族里长出四种兵，也长出四个不同的数字。
 *
 * 玩家侧按 `playerGrowthBonus` 缩放（困难档为 0、即不罚）。
 * 口径见 `weeklyGrowthMultiplier()`：建筑+难度**加算**、地板只在那一半，
 * 周事件**乘算**（§27.10）。`banner` 另乘一档（`tierGrowthMultiplier`），
 * 于是满建 T3 = `1.5 × 1.5 = 2.25×`。
 *
 * `eventMult` 是 §19.2 周事件的**全局倍率**（瘟疫 0.5），`eventAdd` 是**单兵种绝对增量**
 * （生物周 T1 +5 / T2 +3 / T3 +2）。两者都在这里接入，而不是让调用方自己乘：
 * 顺序（先地板后乘）只在 `weeklyGrowthMultiplier` 里写一次，探针能直接量到它；
 * `eventAdd` 加在 `growthPerWeek` 上、再统一乘后面三个倍率 —— 于是 `banner`（×1.5）
 * 与兵营 L3（×1.25）也作用于事件增量，与 §19.2 的算式 `(growth + add) × …` 一致。
 */
export function applyWeeklyGrowth(
  state: GameState,
  eventMult = 1,
  eventAdd?: (unitTypeId: string, tier: number) => number,
): void {
  const diff = DIFFICULTIES[state.config?.difficulty ?? 'normal'];
  for (const player of factionIds(state)) {
    const isHuman = state.players[player]?.isHuman;
    const bonus = isHuman ? diff.playerGrowthBonus : diff.growthBonus;
    for (const town of ownedTowns(state, player)) {
      const mult = weeklyGrowthMultiplier(town, bonus, eventMult);
      if (!town.growthRemainder) town.growthRemainder = {};
      for (const id of town.buildings) {
        const g = BUILDINGS[id]?.growth;
        if (!g) continue;
        // 段 2：兵种按 owner × tier 现解析（中立方 → null ⇒ 跳过，不 fallback）。
        const unitTypeId = dwellUnitId(town, g.tier, 'applyWeeklyGrowth');
        if (!unitTypeId) continue;
        // 事件按**基础版 id**定义，升级后的巢穴同样吃到（归一后再比对）。
        const add = eventAdd ? eventAdd(baseUnitIdOf(unitTypeId), g.tier) : 0;
        const exact =
          (getUnit(unitTypeId).growthPerWeek + add) *
          mult *
          tierGrowthMultiplier(town, g.tier) *
          dwellingLevelGrowthMult(town, g.tier);
        const whole = Math.floor(exact);
        const frac = exact - whole;
        let pool = (town.growthPool[unitTypeId] ?? 0) + whole;
        let rem = (town.growthRemainder[unitTypeId] ?? 0) + frac;
        if (rem >= 1) {
          const carry = Math.floor(rem);
          pool += carry;
          rem -= carry;
        }
        town.growthPool[unitTypeId] = pool;
        town.growthRemainder[unitTypeId] = rem;
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
    // 段 2：兵种按 owner × tier 现解析（中立方 → null ⇒ 跳过，不 fallback）。
    const unitTypeId = dwellUnitId(town, g.tier, 'recruitRows');
    if (!unitTypeId) continue;
    const available = town.growthPool[unitTypeId] ?? 0;
    const cost = getUnit(unitTypeId).cost;
    rows.push({
      unitTypeId,
      available,
      cost,
      affordable: maxAffordable(state, town.owner, cost, available),
    });
  }
  return rows;
}

/**
 * 建筑描述（阵营感知版）。兵营类会把「本族每周 +N」拼进去 —— N 来自
 * `UnitType.growthPerWeek`，所以同一座农舍在四族里显示 11 / 12 / 10 / 9，
 * 而不是一句对三族都错的「+10」。
 *
 * 不直接改 `BUILDINGS[id].desc`：那张表是**阵营中立**的（一张表服务四族），
 * 一旦把某个族的数字写回去，就又变回了第二份真相。
 */
export function buildingDesc(town: Town, id: string): string {
  const def = BUILDINGS[id];
  if (!def) return '';
  const g = def.growth;
  if (g) {
    const lv = levelOf(town, id);
    const unitTypeId = unitIdForTier(town.owner, g.tier, lv >= 2);
    if (!unitTypeId) return def.desc;
    const u = getUnit(unitTypeId);
    const tail = (lv >= 2 ? ` · 产出 ${u.name}` : '') + (lv >= 3 ? ' · 周产 ×1.25' : '');
    return `${def.desc}（本族每周 +${u.growthPerWeek}${tail}）`;
  }
  // `banner`：把"×1.5"翻成本族的具体数字（16 → 24），否则玩家得自己算
  const boost = def.tierGrowthBoost;
  if (boost) {
    const unitTypeId = unitIdForTier(town.owner, boost.tier);
    if (!unitTypeId) return def.desc;
    const from = getUnit(unitTypeId).growthPerWeek;
    return `${def.desc}（本族 ${boost.tier} 级兵每周 ${from} → ${Math.round(from * boost.mult)}）`;
  }
  return def.desc;
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
  // 职业按**本阵营已有英雄数**轮换：第一位是招牌职业，之后才轮到其余三个模板。
  // 旧写法 `(n-1) % 4` 用的是**全局**英雄序号 ⇒ 同一个族的第二位英雄职业取决于
  // 别族招了几个人，且首位英雄职业也可能与种族错位（2026-10-20 修）。
  const ownHeroes = Object.values(state.heroes).filter((h) => h.owner === town.owner).length;
  const tpl = heroTemplateFor(town.owner, ownHeroes);
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
    army: startArmyFor(town.owner, tpl.startArmyCount),
    artifacts: [],
    spells: [],
    pos: spot,
    owner: town.owner,
  };
  // 走与 hero.ts:maxMovePoints 相同的修正逻辑（含 playerMoveMul），
  // 否则困难档玩家可反复招新英雄绕过移动力惩罚。必须在对象建好后再算。
  hero.movePoints = maxMovePoints(hero, state);
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

/**
 * 城镇驻军的"够不够守"—— **战力**，不是血量（§25.4 ③，2026-10-31 B4 换量纲）。
 *
 * 函数名故意没改：调用点有 6 处（AI 攻城判断、回城富余、`refillFromGarrison` 等），
 * 改名只会制造一次无收益的 diff；但**读数的量纲变了**，所以原来那些绝对常数
 * （`GARRISON_KEEP_HP = 200`、`need × 1.15` 的 `60` 地板）必须一起换，
 * 否则等于用"血"的阈值去卡"战力"的数——`count × aiValue` 一般比血量高 1.6~2.2 倍。
 */
export function garrisonStrength(garrison: Army): number {
  return garrison.reduce((s, st) => s + (st.count > 0 ? st.count * getUnit(st.unitTypeId).aiValue : 0), 0);
}

export { isNewWeek };
