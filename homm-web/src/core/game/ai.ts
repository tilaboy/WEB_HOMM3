import type { Army, FactionId, GameState, GridPos, GuardReward, Hero, Town } from '../types.js';
import { DIFFICULTIES, factionName } from '../data/factions.js';
import { BUILDINGS } from '../data/buildings.js';
import { WAR_MACHINES, WAR_MACHINE_IDS } from '../data/warmachines.js';
import { MARKET_RATES, marketBuy } from './town.js';
import type { TradableResource } from './town.js';
import { getUnit } from '../data/units.js';
import { mulberry32, deriveSeed, shuffle } from '../rng.js';
import { idx, isPassable } from '../map/grid.js';
import { buildPath, computePaths, stepCost } from '../map/pathfinding.js';
import { revealAround, isRevealed } from '../map/fog.js';
import { HERO_SIGHT } from '../map/generator.js';
import { quickBattle } from '../combat/battle.js';
import {
  applyHeroBattle,
  applyInteraction,
  enemyHeroAt,
  heroBattleSetup,
  pendingObjectAt,
  previewInteraction,
} from './interaction.js';
import { heroPower, manaMaxOf } from './hero.js';
import {
  build,
  canBuildToday,
  canHireHero,
  garrisonStrength,
  garrisonToHero,
  guildLevel,
  hireHero,
  ownedTowns,
  recruitToGarrison,
  recruitToHero,
  assembleWarMachine,
  hasBuilding,
  hasWarMachine,
  teachGuildSpells,
  townDefenseBonus,
} from './town.js';
import { pushLog } from './log.js';
import { isEliminated } from './victory.js';
import { SCENARIO_BY_ID } from '../data/scenarios.js';

/**
 * 电脑对手（"影子领主"）。设计目标不是聪明，而是**可信**：
 *   - 不作弊：收入、建造、征兵、移动全部走和玩家同一套规则与函数；
 *   - 每个动作都写日志，玩家能复盘 AI 这一天干了什么；
 *   - 不送兵：打不赢的守卫/城镇/英雄一律绕开。
 * 难度只影响起始资源、周增长（见 town.ts）与出兵门槛。
 */

/**
 * 建造顺序：先把 3 级兵营和市场拿到手，再考虑高级兵与经济/防御。
 * 市场必须排在高阶兵营前面——木/矿只有矿场能产，而矿场基本被中档以上的野怪守着，
 * 不先开市场换资源，AI 会一路卡在 dwell4 的 10 木上（实测过，这是最容易踩的坑）。
 */
const BUILD_ORDER = [
  'dwell3', 'market', 'workshop', 'wall1', 'dwell4', 'guild1', 'townhall', 'dwell5', 'guild2', 'wall2', 'wall3', 'guild3',
];

/** 出兵门槛：起始 20 弓手 = 200 血。aggression 越低越早出门。 */
const BASE_COMMIT = 200;

/**
 * 场景 `rush` 的候选权重（图二）。**它不是"覆盖"，是"一个候选"** —— 和附近值得抢的矿、
 * 打得赢的怪同场竞争，但它**必须高到能压过"顺路打只怪 / 捡堆资源"**：否则 AI 一路开打、
 * 部队被磨光、到不了对面（实测：权重 ≤300 时接触日中位 >21 天，FAIL）。
 *
 * **实测扫描（8 seeds · `tools/contactaudit.mjs`）**：`300` ⇒ 中位 >21（多颗种子"从不接触"）；
 * 提高后"从不接触"的种子数随之下降。
 *
 * ⭐ **主理人 2026-09-21 定 = 600，理由是"消除失败模式"而非"更快"**：
 * 用户抱怨的原话是"对手的智力没提升" ⇒ 要消灭的失败模式是**"对手从不出现"**。
 * 只要还有种子**21 天内一次都不接触**，就存在"玩家抽到一局根本没对手、还只当 AI 没变"的
 * 原始 bug 形状。**"会不会出现"是功能问题、"几天出现"是节奏问题** ⇒ 先取功能上不会失败的值，
 * 节奏以后再按图调。
 *
 * 它仍**低于"要回家补兵"的上限 pull**（wounded 400 + 池/驻军最多再 +420）⇒ 该回家照样回家，
 * 不会为冲而弃守；且 `rush` **一旦见过玩家的英雄/城/矿就失效**（见 `hasSeenAnyAssetOf`）——
 * 是"初始倾向"不是"全图透视"，**不算作弊**。
 *
 * ⚠️ 与规格 §1.3 #5 的措辞（原写"**低权重候选**"）有出入：实测"低权重"达不到规格自己的
 * 4–6 天验收 —— 已如实回报，主理人已裁（见上）。
 */
const RUSH_BIAS = 600;

interface Candidate {
  pos: GridPos;
  score: number;
  kind: 'town' | 'monster' | 'loot' | 'home';
}

function strengthOfTier(tier: string): number {
  return tier === 'strong' ? 3 : tier === 'mid' ? 2 : 1;
}

/** 把守卫奖励折算成一个"值不值得打"的分值。 */
function guardValue(guard: GuardReward | undefined): number {
  if (!guard) return 0;
  switch (guard.kind) {
    case 'gold':
      return Math.min(260, guard.amount / 25);
    case 'resource':
      return 60 + guard.amount * 6;
    case 'artifact':
      return 220;
    case 'mine':
      return 300 + guard.perDay * 0.6;
    default:
      return 0;
  }
}

function heroesOf(state: GameState, player: FactionId): Hero[] {
  return state.heroOrder
    .map((id) => state.heroes[id])
    .filter((h): h is Hero => !!h && h.owner === player);
}

function armyTop(army: Army): string {
  if (!army.length) return '（空）';
  return army
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .map((s) => `${getUnit(s.unitTypeId).name} ×${s.count}`)
    .join('、');
}

/* ---------------- 1. 建造 ---------------- */

function aiBuild(state: GameState, player: FactionId, rng: () => number): void {
  for (const town of ownedTowns(state, player)) {
    if (!canBuildToday(state, town)) continue;
    let built = false;
    for (const id of BUILD_ORDER) {
      if (town.buildings.includes(id)) continue;
      const def = BUILDINGS[id];
      if (!def) continue;
      if (!def.requires.every((r) => town.buildings.includes(r))) continue;
      if (build(state, town, id, player)) {
        built = true;
        break;
      }
    }
    // 主顺序里再也没有能建的了，就随机补一座（免得后期资源堆着不用）
    if (!built && rng() < 0.3) {
      const rest = Object.keys(BUILDINGS).filter((id) => !town.buildings.includes(id));
      for (const id of shuffle(rng, rest)) {
        if (build(state, town, id, player)) break;
      }
    }
  }
}

/* ---------------- 1.5 攻城器械 ---------------- */

/**
 * 给站在工坊城里的英雄配攻城器械。
 *
 * 为什么必须有这一步：AI 自己会造墙，玩家也会造墙，所以到中期它想打的每一座城
 * 都有城防。实测数据（中期部队 30 弓 + 20 枪 + 8 骑打 1 星城）：
 * 不带器械胜率 33%、损失 71%；带投石车胜率 100%、损失 54%。
 * 没有器械的 AI 会在别人的城墙前面反复送兵 —— 而"不送兵"正是这个 AI 的底线。
 *
 * 代价上留一手：只有金币明显宽裕时才添置，免得把募兵的钱花光。
 */
function aiArmWarMachines(state: GameState, player: FactionId): void {
  const bag = state.players[player]?.resources;
  if (!bag) return;
  const towns = ownedTowns(state, player).filter((t) => hasBuilding(t, 'workshop'));
  if (!towns.length) return;

  for (const hero of heroesOf(state, player)) {
    for (const town of towns) {
      if (hero.pos.x !== town.pos.x || hero.pos.y !== town.pos.y) continue;
      for (const id of WAR_MACHINE_IDS) {
        if (hasWarMachine(hero, id)) continue;
        const cost = WAR_MACHINES[id].cost;
        // 留 3 波兵的钱：器械是"增强"不是"全部家当"
        if ((bag.gold ?? 0) < (cost.gold ?? 0) + BASE_COMMIT * 3) continue;
        assembleWarMachine(state, town, hero, id);
      }
    }
  }
}

/* ---------------- 2. 征兵 ---------------- */

/**
 * 有市场就换资源。
 *
 * 木/矿除了矿场没有别的来源，而矿场大多被中档以上的野怪守着，
 * 所以"缺木就买"是电脑对手能不能持续发育的分水岭——没有这一步，AI 会一直卡在 dwell3。
 *
 * 走 `marketBuy` 而不是自己减金币加资源：那个函数是玩家 UI 用的同一个，
 * AI 与玩家共用一条汇率表，才谈得上"不作弊"。
 */
function aiTrade(state: GameState, player: FactionId): void {
  if (!ownedTowns(state, player).some((t) => t.buildings.includes('market'))) return;
  const bag = state.players[player]?.resources;
  if (!bag) return;

  // 木/矿：一次买 5 个，攒到 4 批的钱才开始换（沿用原来的节奏，避免把募兵的钱花光）
  let bought = 0;
  while ((bag.gold ?? 0) >= MARKET_RATES.wood.buyGold * 4 && bought < 3) {
    if ((bag.wood ?? 0) >= 25 && (bag.ore ?? 0) >= 25) break;
    const res: TradableResource = (bag.wood ?? 0) <= (bag.ore ?? 0) ? 'wood' : 'ore';
    if (!marketBuy(state, res, player)) break;
    bought += 1;
  }

  aiBuyRare(state, player);
}

/**
 * 补稀有资源：guild2 要 4 宝石、guild3 要 4 水晶。
 *
 * 为什么单列一步：市场是 AI 拿到宝石/水晶最稳的一条路——稀有矿大多压在野怪手里，
 * 而且 pickTarget 给稀有矿打的分（240）还低于木/矿（280）与金矿（430），
 * 永远排不到"今天要去的地方"。少了这一步，AI 的建筑线在 13 座之后**永久停摆**
 * （实测 3 种子 × 60 天：末次动工普遍停在第 22~28 天，之后 30 多天一座不建，
 * 金币堆到 5.7 万无处可花）——这正是玩家说的"对手都不建设"。
 *
 * 花钱很克制：只补"下一座真正轮得到、且只差稀有资源"的那一种，只补到够用，
 * 且手里至少留 3 份的钱（募兵优先于买宝石）。
 */
function aiBuyRare(state: GameState, player: FactionId): void {
  const towns = ownedTowns(state, player);
  const bag = state.players[player]?.resources;
  if (!bag || !towns.length) return;
  for (const id of BUILD_ORDER) {
    const def = BUILDINGS[id];
    if (!def) continue;
    if (towns.every((t) => t.buildings.includes(id))) continue;
    const rare = (Object.keys(def.cost) as TradableResource[]).filter(
      (k) => k === 'gem' || k === 'crystal',
    );
    // 还没轮到需要稀有资源的建筑（前面几座只等木/矿），交给上面那一段
    if (!rare.length) return;
    for (const res of rare) {
      const need = def.cost[res] ?? 0;
      let guard = 0;
      while (
        (bag[res] ?? 0) < need &&
        (bag.gold ?? 0) >= MARKET_RATES[res].buyGold * 3 &&
        guard++ < 8
      ) {
        if (!marketBuy(state, res, player)) break;
      }
    }
    return; // 一天只推进一座建筑缺的稀有资源
  }
}

/* ---------------- 2.5 驻军 → 英雄 ---------------- */

/**
 * 守城要留的血量：两波兵。
 *
 * 取两波而不是一波，是实测调出来的：留一波（200 血）时英雄会把城搬空，
 * 主城只剩 200 血的驻军 + 城墙，被另一个 AI 一波带走 —— 8 种子 × 60 天里
 * 有 7 局 AI 丢掉全部城镇（原状只有 1 局），丢城之后它没有收入、没有回城点，
 * 建筑数与募兵直接归零，"不建设"反而更严重。
 */
const GARRISON_KEEP_HP = BASE_COMMIT * 2;

/**
 * 把驻军的富余兵力搬给英雄。
 *
 * 为什么必须有这一步（这是"电脑啥也不会干"的最大根因）：
 * `aiRecruit` 在英雄行动**之前**就把当天的增长池抽干、全部送进驻军，
 * 而英雄打完仗回到城里时池子已经空了——`recruitToHero` 什么也拿不到。
 * 在此之前 AI 根本没有"驻军 → 英雄"这条通道，于是：
 *   · 驻军一路囤到 200~290 名兵，躺着不动；
 *   · 出门的英雄（玩家唯一看得见、打得着的 AI 单位）从头到尾只有开局那 20 个弓手，
 *     打几仗就归零，然后 0 兵在城里城外来回晃。
 * 实测 3 种子 × 60 天：9 个 AI 局里 5 局英雄**一次都没补到过兵**、3 局终局英雄 0 兵，
 * 而同期驻军兵数增长 23~40 次——军队全长在玩家看不见的地方。
 */
function refillFromGarrison(state: GameState, hero: Hero, town: Town): void {
  let ghHp = garrisonStrength(town.garrison);
  if (ghHp <= GARRISON_KEEP_HP) return;
  // 先搬高档兵：把最值钱的战力放到英雄身上，城防留低档的够用就行
  const stacks = [...town.garrison].sort(
    (a, b) => getUnit(b.unitTypeId).tier - getUnit(a.unitTypeId).tier,
  );
  let moved = 0;
  for (const st of stacks) {
    if (ghHp <= GARRISON_KEEP_HP) break;
    const hpEach = getUnit(st.unitTypeId).hp;
    const spare = Math.floor((ghHp - GARRISON_KEEP_HP) / hpEach);
    const count = Math.min(st.count, spare);
    if (count <= 0) continue;
    const t = garrisonToHero(hero, town, st.unitTypeId, count);
    moved += t;
    ghHp -= t * hpEach;
  }
  if (moved > 0) {
    pushLog(state, `${hero.name} 从 ${town.name} 的驻军带走了 ${moved} 名士兵（${armyTop(hero.army)}）`);
  }
}

function aiRecruit(state: GameState, player: FactionId): void {
  const heroes = heroesOf(state, player);
  for (const town of ownedTowns(state, player)) {
    const inTown = heroes.find((h) => h.pos.x === town.pos.x && h.pos.y === town.pos.y) ?? null;
    for (const unitTypeId of Object.keys(town.growthPool)) {
      let guard = 0;
      while ((town.growthPool[unitTypeId] ?? 0) > 0 && guard++ < 40) {
        const left = town.growthPool[unitTypeId] ?? 0;
        const res = inTown
          ? recruitToHero(state, town, inTown, unitTypeId, left)
          : recruitToGarrison(state, town, unitTypeId, left);
        if (res.taken <= 0) break;
      }
    }
  }
}

/* ---------------- 3. 目标选择 ---------------- */

/**
 * 各资源的"够用线"：库存到这条线就视为不缺。
 * 金币的收支比其它资源大一个数量级（一次建筑 1500~9000、每天税收 500+），
 * 所以参考值必须分开给 —— 用一个统一数字的话，对金币永远不触发、对稀有资源永远触发。
 */
const RESOURCE_REF: Record<string, number> = {
  gold: 3000, wood: 20, ore: 20, gem: 6, crystal: 6, sulfur: 6, mercury: 6,
};

/**
 * 资源缺口系数：1.0（库存充足）~ 2.2（一点都没有）。
 *
 * 为什么不改 `base` 而乘一个系数：base 表达的是"这种矿本身值多少"，
 * 是稳定的；这里表达的是"这个阵营此刻有多缺它"，是随局势变的。
 * 两者相乘，库存充裕的阵营排出来的顺序和以前基本一致，
 * 而卡在某一种资源上的阵营会把对应的矿顶到最前面 ——
 * 这正是"缺什么资源就优先抢什么矿"想要的行为。
 */
function scarcityNeed(stock: Record<string, number | undefined>, res: string): number {
  const ref = RESOURCE_REF[res];
  if (!ref) return 1;
  const missing = Math.max(0, ref - (stock[res] ?? 0)) / ref;
  return 1 + Math.min(1, missing) * 1.2;
}

/**
 * AI 是否**已经见过玩家（人类）的任何资产**：英雄 / 城镇 / 已占领的矿。
 * 用于把 `rush` 钉在"初始倾向"而非"全图透视"（`playtest-scenarios §3.5` 裁定）。
 */
function hasSeenAnyAssetOf(state: GameState, ai: FactionId, foe: FactionId, seen: (p: GridPos) => boolean): boolean {
  for (const h of Object.values(state.heroes)) {
    if (h.owner === foe && h.owner !== ai && seen(h.pos)) return true;
  }
  for (const t of Object.values(state.towns)) {
    if (t.owner === foe && seen(t.pos)) return true;
  }
  for (const obj of Object.values(state.map.objects)) {
    if (obj.kind === 'mine' && (obj.payload as { owner?: string } | null)?.owner === foe && seen(obj.pos)) {
      return true;
    }
  }
  return false;
}

function pickTarget(state: GameState, hero: Hero, player: FactionId): Candidate | null {
  const field = computePaths(state, hero.pos, Infinity);
  const m = state.map;
  const power = heroPower(hero);
  const diff = DIFFICULTIES[state.config?.difficulty ?? 'normal'];
  const commit = BASE_COMMIT * diff.aggression;
  const candidates: Candidate[] = [];

  const costAt = (p: GridPos): number => {
    if (p.x < 0 || p.y < 0 || p.x >= m.width || p.y >= m.height) return Infinity;
    return field.cost[idx(m, p.x, p.y)];
  };
  /** 电脑对手只能针对自己"见过"的东西：不透视迷雾，是难度之外最基本的公平。 */
  const seen = (p: GridPos): boolean => isRevealed(state, player, p.x, p.y);
  /** 这个阵营的资源库存，用于给矿场按"缺口"加权。 */
  const stock = (state.players[player]?.resources ?? {}) as Record<string, number | undefined>;

  for (const obj of Object.values(m.objects)) {
    if (obj.kind === 'obstacle') continue;
    if (!seen(obj.pos)) continue;
    const cost = costAt(obj.pos);
    if (!isFinite(cost) || cost <= 0) continue;
    const travelPenalty = cost * 0.06;

    if (obj.kind === 'town') {
      const town = state.towns[(obj.payload as { townId: string }).townId];
      if (!town || town.owner === player) continue;
      const need = garrisonStrength(town.garrison) + townDefenseBonus(town) * 12;
      const odds = power / Math.max(60, need * 1.15);
      if (odds < 0.85) continue; // 打不过就别去
      const value = town.owner === 'neutral' ? 620 : 760;
      candidates.push({
        pos: obj.pos, kind: 'town',
        score: value * Math.min(1.6, odds) - travelPenalty,
      });
      continue;
    }

    if (obj.kind === 'wanderingMonster') {
      const payload = obj.payload as { army: Army; tier: string; guard?: GuardReward };
      const preview = previewInteraction(state, hero.id, obj.id);
      if (!preview?.estimate?.win) continue; // 打不赢的守卫直接不考虑
      const lost = preview.estimate.losses.reduce((s, l) => s + (l.before - l.after), 0);
      const total = preview.estimate.losses.reduce((s, l) => s + l.before, 0);
      if (total > 0 && lost / total > 0.7) continue; // 惨胜不值当
      const value = 240 + guardValue(payload.guard) + strengthOfTier(payload.tier) * 40;
      candidates.push({ pos: obj.pos, kind: 'monster', score: value - travelPenalty });
      continue;
    }

    // 宝库区：和野怪同一套"打不赢就不去"的规矩，只是更值钱
    if (obj.kind === 'vault') {
      const payload = obj.payload as { tier: string };
      const preview = previewInteraction(state, hero.id, obj.id);
      if (!preview?.estimate?.win) continue;
      const lost = preview.estimate.losses.reduce((s, l) => s + (l.before - l.after), 0);
      const total = preview.estimate.losses.reduce((s, l) => s + l.before, 0);
      if (total > 0 && lost / total > 0.7) continue; // 惨胜不值当
      const value = payload.tier === 'strong' ? 620 : 450;
      candidates.push({ pos: obj.pos, kind: 'monster', score: value - travelPenalty });
      continue;
    }

    // 矿场：踩上去就插旗，不用打。这份分值就是"AI 会不会去抢矿"的全部原因
    if (obj.kind === 'mine') {
      const p = obj.payload as { resource: string; perDay: number; owner: string };
      if (p.owner === player) continue;
      // 金矿一天 400 ≈ 一座建满的城；木石是建筑线硬通货；稀有资源喂魔法行会
      const base =
        p.resource === 'gold' ? 430
        : p.resource === 'wood' || p.resource === 'ore' ? 280
        : 240;
      // 从敌人手里抢，既加自己又减对方，值当一些
      const denial = p.owner === 'neutral' ? 1 : 1.35;
      // 再按"这个阵营到底缺不缺这种资源"加权：缺什么就先抢什么矿
      candidates.push({
        pos: obj.pos,
        kind: 'loot',
        score: base * scarcityNeed(stock, p.resource) * denial - travelPenalty,
      });
      continue;
    }

    const value =
      obj.kind === 'artifact' ? 200
      : obj.kind === 'treasureChest' ? 170
      : obj.kind === 'resourcePile' ? ((obj.payload as { resource: string }).resource === 'gold' ? 130 : 100)
      : obj.kind === 'fountain' ? 40
      : 0;
    if (!value) continue;
    candidates.push({ pos: obj.pos, kind: 'loot', score: value - travelPenalty });
  }

  // 敌方英雄：兵力压得过、而且见过，才考虑
  for (const id of state.heroOrder) {
    const foe = state.heroes[id];
    if (!foe || foe.owner === player) continue;
    if (!seen(foe.pos)) continue;
    const cost = costAt(foe.pos);
    if (!isFinite(cost) || cost <= 0) continue;
    const odds = power / Math.max(60, heroPower(foe));
    if (odds < 1.15) continue;
    candidates.push({ pos: foe.pos, kind: 'monster', score: 820 * Math.min(1.5, odds) - cost * 0.05 });
  }

  // 探索：迷雾边缘的格子才是开局唯一"看得见"的目标。
  // 越往外给分越高，AI 才会真的向外扩张，而不是在自家门口转圈。
  const home = ownedTowns(state, player)[0];
  if (home) {
    const frontier: GridPos[] = [];
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        if (!isRevealed(state, player, x, y)) continue;
        let edge = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
          if (!isRevealed(state, player, nx, ny)) {
            edge = true;
            break;
          }
        }
        if (edge) frontier.push({ x, y });
      }
    }
    // 只取离主城最远的若干处，够用且不会让候选列表爆炸
    frontier.sort(
      (a, b) =>
        Math.abs(b.x - home.pos.x) + Math.abs(b.y - home.pos.y) -
        (Math.abs(a.x - home.pos.x) + Math.abs(a.y - home.pos.y)),
    );
    for (const p of frontier.slice(0, 40)) {
      const cost = costAt(p);
      if (!isFinite(cost) || cost <= 0) continue;
      const outward = Math.abs(p.x - home.pos.x) + Math.abs(p.y - home.pos.y);
      candidates.push({
        pos: p, kind: 'loot',
        score: 90 + outward * 3 * (1.2 - diff.aggression * 0.3) - cost * 0.03,
      });
    }
  }

  // 回城补给：家里攒着兵、家里有富余驻军、或部队打残了就回家。
  //
  // 为什么"驻军富余"也要算成回城的理由：`aiRecruit` 每天在英雄行动**之前**
  // 就把增长池抽干送进驻军，所以轮到 pickTarget 做决定时 pool 恒为 0 ——
  // 唯一那个"家里有兵"的信号被自己抹掉了，英雄于是永远不回家，
  // 驻军囤到 2000+ 血也没人带走（实测：去掉这一条，36 局里英雄补兵次数从 2.8 掉到 1.7）。
  // 加上它之后闭环才成立：回家 → 带走富余驻军 → 再出门。
  const homes = ownedTowns(state, player);
  const pool = homes.reduce((s, t) => s + Object.values(t.growthPool).reduce((a, b) => a + b, 0), 0);
  const surplus = homes.reduce(
    (s, t) => s + Math.max(0, garrisonStrength(t.garrison) - GARRISON_KEEP_HP),
    0,
  );
  const wounded = power < commit * 0.6;
  if (pool > 0 || surplus > 0 || wounded) {
    for (const town of homes) {
      const cost = costAt(town.pos);
      if (!isFinite(cost) || cost <= 0) continue; // 到不了 / 已经在家
      const pull =
        Math.min(120, pool * 22) + (surplus > 0 ? Math.min(300, surplus * 0.4) : 0) + (wounded ? 400 : 0);
      candidates.push({ pos: town.pos, kind: 'home', score: pull - cost * 0.03 });
    }
  }

  // 场景「rush」（图二）：**仅在"尚未见过任何玩家资产之前"**，把"朝玩家主城推进"
  // 作为**一个候选**加进来 —— 沿用同一套候选评分，谁分高谁去（不是无脑覆盖）。
  //
  // 这是主理人批准的"脚本化初始倾向"（`playtest-scenarios §3.5` 裁定）；它**不透视**：
  // 一旦 AI 见过玩家的英雄/城/矿（任一处），本条立即失效，回到常规候选。
  const intent = state.config?.scenario
    ? SCENARIO_BY_ID[state.config.scenario]?.aiIntent
    : undefined;
  if (intent === 'rush' && !hasSeenAnyAssetOf(state, player, 'p1', seen)) {
    // 人类玩家固定 p1（见 types.ts）。主城没了（被灭）就不追。
    const foeHome = state.towns['town_home'];
    if (foeHome && foeHome.owner === 'p1') {
      const W = m.width;
      const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      /** 这个格"会打起来"或"挡路"（野怪/宝库/城/障碍）—— rush 的行军要绕开它们。 */
      const isFight = (x: number, y: number): boolean => {
        const oid = m.tiles[y * W + x]?.objectId;
        if (!oid) return false;
        const o = m.objects[oid];
        return !!o && (o.blocking || o.kind === 'wanderingMonster' || o.kind === 'vault' || o.kind === 'town');
      };
      const free = (x: number, y: number): boolean =>
        x >= 0 && y >= 0 && x < W && y < m.height && isPassable(m, x, y) && !isFight(x, y);

      // ① 从玩家主城做一次"只走空格"的 BFS（8 邻域）⇒ 得到"朝目标多远"的梯度
      const bdist = new Int32Array(W * m.height).fill(-1);
      const gi = foeHome.pos.y * W + foeHome.pos.x;
      bdist[gi] = 0;
      const queue = [gi];
      for (let qi = 0; qi < queue.length; qi++) {
        const cur = queue[qi];
        const cx = cur % W;
        const cy = (cur / W) | 0;
        for (const [dx, dy] of DIRS8) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!free(nx, ny)) continue;
          const ni = ny * W + nx;
          if (bdist[ni] !== -1) continue;
          bdist[ni] = bdist[cur] + 1;
          queue.push(ni);
        }
      }
      // ② 英雄侧沿梯度走出一条"朝目标且不穿战斗格"的链
      const chain: GridPos[] = [];
      let cur = { x: hero.pos.x, y: hero.pos.y };
      for (let i = 0; i < 96; i++) {
        const here = bdist[cur.y * W + cur.x];
        if (here < 0) break; // 英雄与目标之间**没有"不打仗"的通路**（唯一的桥被守卫卡死）
        let best: GridPos | null = null;
        let bestD = here;
        for (const [dx, dy] of DIRS8) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          if (!free(nx, ny)) continue;
          const d = bdist[ny * W + nx];
          if (d >= 0 && d < bestD) {
            bestD = d;
            best = { x: nx, y: ny };
          }
        }
        if (!best) break;
        chain.push(best);
        cur = best;
        if (bdist[cur.y * W + cur.x] === 0) break;
      }
      // ③ 取链上**最远**、且 `aiMarch` 真正会走的那条路（`buildPath`，它不看物件）**不穿战斗格**的一点。
      //    为什么不是"下一格"：那会变成一天挪 1 格，40 格要 40 天。
      //    为什么不是"主城那个远点"：`aiMarch` 的 repath 忽略物件，会从一只打不过的野怪身上
      //    穿过去、到那儿就停 ⇒ 若一直锁着同一个远点就**永久卡死**（实测 seed 1000：英雄卡在
      //    (27,12)，路被 (27,11) 的野怪挡住，第 5 天停到第 21 天）。
      let waypoint: GridPos | null = null;
      for (let i = chain.length - 1; i >= 0; i--) {
        const T = chain[i];
        const path = buildPath(state, field, hero.pos, T);
        if (!path.length) continue;
        if (path.every((s) => !isFight(s.x, s.y))) {
          waypoint = T;
          break;
        }
      }
      if (waypoint) candidates.push({ pos: waypoint, kind: 'loot', score: RUSH_BIAS });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

/* ---------------- 4. 移动与结算 ---------------- */

function aiMarch(state: GameState, hero: Hero, target: GridPos): void {
  const player = hero.owner as FactionId;
  const field = computePaths(state, hero.pos, Infinity);
  const path = buildPath(state, field, hero.pos, target);

  for (const step of path) {
    const cost = stepCost(state, hero.pos, step);
    if (!isFinite(cost) || cost > hero.movePoints) return;

    // 敌方英雄挡路：改成打遭遇战
    const foe = enemyHeroAt(state, step.x, step.y, player);
    if (foe) {
      aiFightHero(state, hero, foe);
      return;
    }

    // 目的地上有东西：先判断打不打得过，打不过就原地不动
    const objId = state.map.tiles[idx(state.map, step.x, step.y)].objectId;
    if (objId) {
      const obj = state.map.objects[objId];
      if (obj?.blocking) return;
      if (obj) {
        const preview = previewInteraction(state, hero.id, objId);
        if ((preview?.kind === 'battle' || preview?.kind === 'siege') && !preview.estimate?.win) return;
      }
    }

    hero.pos = { x: step.x, y: step.y };
    hero.movePoints -= cost;
    revealAround(state, player, hero.pos, HERO_SIGHT);

    const arrived = pendingObjectAt(state, hero.id);
    if (!arrived) continue;
    const preview = previewInteraction(state, hero.id, arrived.id);
    if (preview?.kind === 'info') continue; // 只是看了眼说明，继续走

    const stops = arrived.kind === 'wanderingMonster' || arrived.kind === 'town';
    const res = applyInteraction(state, hero.id, arrived.id, true);
    if (res.heroDefeated) return;
    if (res.title) pushLog(state, `${hero.name}：${res.message.split('\n')[0]}`);
    if (stops) return; // 大事件（战斗/攻城）之后今日收工
  }
}

/** AI 主动打敌方英雄：无头结算，结果写回世界。 */
function aiFightHero(state: GameState, attacker: Hero, defender: Hero): void {
  const odds = heroPower(attacker) / Math.max(60, heroPower(defender));
  if (odds < 1.05) return; // 打不赢就绕开，等下次
  const setup = heroBattleSetup(state, attacker.id, defender.id);
  if (!setup) return;
  const outcome = quickBattle(setup.attacker, setup.defender, setup.seed);
  const res = applyHeroBattle(state, attacker.id, defender.id, outcome);
  if (res.title) pushLog(state, `${attacker.name}：${res.title}`);
}

/* ---------------- 5. 扩编 ---------------- */

/** 城多将少时补一位英雄，让 AI 能同时经营两个方向；手里没将时无条件补。 */
function maybeHireHero(state: GameState, player: FactionId): void {
  const towns = ownedTowns(state, player);
  if (!towns.length) return;
  const heroes = heroesOf(state, player);
  const desperate = heroes.length === 0;
  if (!desperate && towns.length <= heroes.length) return;
  const gold = state.players[player]?.resources.gold ?? 0;
  if (gold < (desperate ? 2500 : 6000)) return;
  for (const town of towns) {
    if (!canHireHero(state, town).ok) continue;
    const hired = hireHero(state, town);
    if (hired) {
      pushLog(state, `${factionName(player)} 在 ${town.name} 招募了新英雄 ${hired.name}`);
      return;
    }
  }
}

/* ---------------- 每日入口 ---------------- */

export function runAiTurn(state: GameState, player: FactionId): void {
  if (state.status !== 'playing') return;
  if (state.players[player]?.isHuman !== false) return;
  // 已出局（含"连续 7 天没有城镇"）的阵营不再行动。turn.ts 也会跳过它们，
  // 这里是第二道闸：单独跑 runAiTurn 的测试/工具也不会让出局阵营复活。
  if (isEliminated(state, player)) return;

  const rng = mulberry32(deriveSeed(state.seed, state.day, player.charCodeAt(1) * 7919));

  aiBuild(state, player, rng);
  aiTrade(state, player);
  aiBuild(state, player, rng);
  aiArmWarMachines(state, player);
  aiRecruit(state, player);

  for (const hero of heroesOf(state, player)) {
    if (state.status !== 'playing') break;
    const target = pickTarget(state, hero, player);
    if (!target) continue;
    const before = { x: hero.pos.x, y: hero.pos.y };
    aiMarch(state, hero, target.pos);

    // 站到自家城镇上：学法术 + 把增长池里的兵补进队伍 + 从驻军抽调野战部队
    const town = ownedTowns(state, player).find((t) => t.pos.x === hero.pos.x && t.pos.y === hero.pos.y);
    if (town) {
      if (guildLevel(town) > 0) teachGuildSpells(state, hero, town);
      for (const unitTypeId of Object.keys(town.growthPool)) {
        recruitToHero(state, town, hero, unitTypeId, town.growthPool[unitTypeId] ?? 0);
      }
      // 增长池通常已被当天的 aiRecruit 抽干送进驻军，这里把驻军的富余兵力搬回英雄身上
      refillFromGarrison(state, hero, town);
      hero.manaMax = manaMaxOf(hero);
      hero.mana = hero.manaMax;
    }

    if (before.x !== hero.pos.x || before.y !== hero.pos.y) {
      pushLog(
        state,
        `${factionName(player)} · ${hero.name} 从 (${before.x},${before.y}) 移动到 (${hero.pos.x},${hero.pos.y})，部队 ${armyTop(hero.army)}`,
      );
    }
  }

  maybeHireHero(state, player);
}
