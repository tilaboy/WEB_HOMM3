import type { Army, FactionId, GameState, GridPos, GuardReward, Hero, MapObject, PlayerId, Town } from '../types.js';
import { DIFFICULTIES, factionName, viewerOf } from '../data/factions.js';
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
import { armyValue, grassMoveMul, heroPower, manaMaxOf } from './hero.js';
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
} from './town.js';
import { wallLevelOf, wallNeedMultiplier } from '../combat/siege.js';
import { pushLog } from './log.js';
import { noteAiEvent } from './aiReport.js';
import type { AiEvent } from './aiReport.js';
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
 *
 * `banner` 紧跟在 `dwell3` 之后（§27.9 #4 / §23.4）：它只吃 1,000 金 + 5 木 5 矿，
 * 却把每周 T3 产量乘 1.5 —— 对 AI 是"花小钱把兵营变成两座"。排在市场前面
 * 不会卡资源：`aiBuild` 逐条 try，买不起就跳过继续下一条。
 *
 * `townhall` 提到 `workshop` **之前**（§25.4 尾，2026-10-31 B4）：城墙不再产金之后，
 * 先花 2,000 金建工坊会让 AI 比玩家穷一截 —— 议事堂 1,500 金换 **+450/天**，
 * 第 4 天就回本；工坊只是让攻城器械能造，没有即时收益。
 *
 * `dwell5` 提到 `guild*` / `wall*` **之前**（2026-10-31 B4 实测改）：城墙不产金之后
 * 全树 40,800 金只够"一条半线"，`guild1..3`（9,500）+ 城墙（8,500）会把 `dwell5` 顶到
 * 第 6 周之后 —— 实测 8 种子 × 60 天只有 2 局在 D53/D57 才买到第一只 T5，
 * 而 §16.2 给四族各配了一只 T5，**AI 一辈子看不到自己的顶级兵**。
 * 魔法线与城防属于"有余钱再补"，`dwell5` 才是 T5 的唯一入口。
 * `workshop` 也一起排到 `dwell5` 之后：它 2,000 金，只换来"攻城器械能造"，
 * 而 AI 在兵力不足时本来就不该去啃有墙的城（`pickTarget` 走 `townNeedForAI`，墙按实测倍率折兵）。
 * 排在前面等于用 1.4 天的收入换一个中期才用得上的能力。
 */
const BUILD_ORDER = [
  'dwell3', 'banner', 'market', 'townhall', 'dwell4', 'dwell5', 'workshop', 'guild1', 'wall1', 'guild2', 'wall2', 'wall3', 'guild3',
];

/**
 * 本城"下一座"目标：`BUILD_ORDER` 里第一座**前置已满足**的未建建筑。
 *
 * 提出来单独一份，是因为它现在有**两个**消费者（`aiBuild` 的"不许往下跳"与
 * `buildReserve` 的"给下一座留钱"）。两处各写一遍，某天改一处就会变成
 * "攒钱为了 A、建造却先建 B"，两个规则互相抵消，而且查起来像随机行为。
 */
function nextBuildTarget(town: Town): string | null {
  for (const id of BUILD_ORDER) {
    if (town.buildings.includes(id)) continue;
    const def = BUILDINGS[id];
    if (!def) continue;
    if (!def.requires.every((r) => town.buildings.includes(r))) continue;
    return id;
  }
  return null;
}

/**
 * 目标建筑是否**只差金币**（木/矿都够了）。
 *
 * 这种状态下不许往后面的便宜建筑跳：`aiBuild` 原来的写法是"逐条 try，失败就下一条"，
 * 于是每一次"钱不够"都自动变成"买一座更便宜的侧楼"——9,000 金的 `dwell5`
 * 永远排不到队（实测 D28 时 AI 已经建了 13 座，`dwell5` 还是没影）。
 *
 * 只差木/矿时**允许**往下跳：那说明瓶颈不是金币，等着也变不出来（矿场可能被怪守着），
 * 而便宜的建筑至少能消化金币。这一条同时防住了"严格顺序死锁"。
 */
function shortOfGoldOnly(state: GameState, player: FactionId, id: string): boolean {
  const bag = state.players[player]?.resources;
  const cost = BUILDINGS[id]?.cost;
  if (!bag || !cost) return false;
  return (
    (bag.gold ?? 0) < (cost.gold ?? 0) &&
    (bag.wood ?? 0) >= (cost.wood ?? 0) &&
    (bag.ore ?? 0) >= (cost.ore ?? 0)
  );
}

/**
 * 出兵门槛：**战力**，不是血量（2026-10-31 B4 换量纲）。
 *
 * 旧注释写"起始 20 弓手 = 200 血"；换成 `aiValue` 之后同一支部队 ≈ 660（T2 远程 33/个）。
 * 取 400 = **约 12 个 T2**：开局那 20 个兵不够，得再攒半队才敢打有主的城/敌将。
 * 这个形状和改前一致（改前 200 血 ≈ 开局部队的 0.9 倍，改后 400 ≈ 0.6 倍）——
 * 改前的数字其实是**偏低**的，`aggression` 三档长期空转，这里顺手把它拉回"要攒一下"。
 */
const BASE_COMMIT = 400;

/**
 * ★ `aggression`（= `commit`）是**两处**门槛，缺一不可（2026-09-29 实测修）。
 *
 * 原先 `commit` **只**用在下面 `wounded`（"部队打残了就回家"）这一处 ⇒ 它实际是
 * "被打得多惨才回家"，**从来没有拦过"敢不敢动手"**。而开局英雄 20 弓手 ≈ 220 战力，
 * 三档阈值（easy 300 / normal 220 / hard 160）在**第 1 天就都不触发**，之后 AI 只会越攒越厚
 * ⇒ 这条杠杆**全程空转**。
 *
 * 实测（图三 21 天 · 8 seeds · rush 与 norush 两组）：三档的
 * **首次出击日逐颗种子完全相同**（全 2）、**接触日逐颗种子完全相同**、出城天数中位 20/20/20、
 * 累计行军格 274/272/281（无序）⇒ `aggression` 在真实对局里**量不出任何有序差别**。
 *
 * 修法是补上它**本来的那一半**（`difficulty-spec.md §3` 杠杆 C 的原话：
 * "AI **出击门槛**"、"兵力不足时不会主动出击"）：打**有主**的城、打**敌方英雄**
 * 这两类真正的"出击"，兵力不到 `commit` 就压根不进候选表。
 * 打**中立**城/野怪不算"出击"（那是发育，不是开战）⇒ 不加门槛，免得轻松档 AI 连发育都不会。
 */

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
    // 只差金币的目标 ⇒ 今天**只**试它，不许往后面的便宜建筑跳（见 `shortOfGoldOnly`）
    const target = nextBuildTarget(town);
    const saving = target ? shortOfGoldOnly(state, player, target) : false;
    let built = false;
    for (const id of BUILD_ORDER) {
      if (saving && id !== target) continue;
      if (town.buildings.includes(id)) continue;
      const def = BUILDINGS[id];
      if (!def) continue;
      if (!def.requires.every((r) => town.buildings.includes(r))) continue;
      if (build(state, town, id, player)) {
        built = true;
        break;
      }
    }
    // 主顺序里再也没有能建的了，就随机补一座（免得后期资源堆着不用）。
    // 攒钱期间不补：那笔钱就是留给 `target` 的。
    if (!built && !saving && rng() < 0.3) {
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
  // 攒钱期间不添器械：一件 500~800 金，正好是下一座建筑（`dwell5` 9,000）的零头，
  // 而它不解决"AI 一辈子见不到 T5"的问题。`aiBuild`/`aiRecruit` 已经同口径。
  if (buildReserve(state, player) > 0) return;

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
 * 守城要留的**战力**（§25.4 ④，2026-10-31 B4 换量纲；旧名 `GARRISON_KEEP_HP = 400`）。
 *
 * 1,200 是"400 血 × 值/血 ≈3"换算出来的**起点**，然后按同一把尺子重标：
 * 判据是**丢城局数 ≤1**（8 种子 × 60 天），不是"换算对了"。
 *
 * 取两波而不是一波，是实测调出来的：留一波时英雄会把城搬空，
 * 主城只剩一波驻军 + 城墙，被另一个 AI 一波带走 —— 8 种子 × 60 天里
 * 有 7 局 AI 丢掉全部城镇（原状只有 1 局），丢城之后它没有收入、没有回城点，
 * 建筑数与募兵直接归零，"不建设"反而更严重。
 * ⇒ **不要把 1,200 往下调来"让 AI 更有攻击性"**：省下的那点兵力换的是一整座城。
 */
const GARRISON_KEEP_VALUE = 1200;

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
/**
 * 单栈上限：一栈不得超过英雄全军 `aiValue` 的 **60%**（spec §25.5 / A5）。
 *
 * 为什么这条必须在 AI 里、而不是只写在探针里：A5 是**设计约束**（"一栈流会被一发法术
 * 打崩"），探针只能事后判红；AI 的征兵顺序是"高档优先"（`poolOrder` / `refillFromGarrison`），
 * 天生倾向把战力堆进同一栈 —— 没有这条闸，任何一次增长波动都可能把某个种子推过 60%。
 * 2026-11-12 实测：周事件接入后 seed 10104 的 T4 栈 53% → 61%，A5 立刻红。
 *
 * 算法：设当前该栈战力 `s`、单只 `u`、全军 `V`，再加 `x` 只后要求
 * `s + x·u ≤ 0.6·(V + x·u)` ⇒ `x ≤ (0.6V − s) / (0.4u)`。
 * **空军队不设限**（`V = 0` 时无论加什么都占 100%，先把人派出去再谈结构）。
 */
const MAX_STACK_SHARE = 0.6;

function capForStackShare(hero: Hero, unitTypeId: string, ask: number): number {
  if (ask <= 0) return 0;
  const total = armyValue(hero.army);
  if (total <= 0) return ask;
  const each = getUnit(unitTypeId).aiValue;
  if (each <= 0) return ask;
  const cur = (hero.army.find((s) => s.unitTypeId === unitTypeId)?.count ?? 0) * each;
  const room = (MAX_STACK_SHARE * total - cur) / (each * (1 - MAX_STACK_SHARE));
  return Math.max(0, Math.min(ask, Math.floor(room)));
}

function refillFromGarrison(state: GameState, hero: Hero, town: Town): void {
  let ghValue = garrisonStrength(town.garrison);
  if (ghValue <= GARRISON_KEEP_VALUE) return;
  // 先搬高档兵：把最值钱的战力放到英雄身上，城防留低档的够用就行
  const stacks = [...town.garrison].sort(
    (a, b) => getUnit(b.unitTypeId).tier - getUnit(a.unitTypeId).tier,
  );
  let moved = 0;
  for (const st of stacks) {
    if (ghValue <= GARRISON_KEEP_VALUE) break;
    // ⚠️ 量纲必须与 `garrisonStrength` 一致：按 `hp` 扣会把 `spare` 高估 10 倍以上
    //    （`aiValue` 一般比 `hp` 大 1.6~2.2 倍 ⇒ 反过来会抽过头，驻军被抽到底线以下），
    //    结果就是"AI 丢光城镇"那个老 bug 换个形式回来。
    const valueEach = getUnit(st.unitTypeId).aiValue;
    const spare = Math.floor((ghValue - GARRISON_KEEP_VALUE) / valueEach);
    const count = Math.min(st.count, spare, capForStackShare(hero, st.unitTypeId, Infinity));
    if (count <= 0) continue;
    const t = garrisonToHero(hero, town, st.unitTypeId, count);
    moved += t;
    ghValue -= t * valueEach;
  }
  if (moved > 0) {
    pushLog(state, `${hero.name} 从 ${town.name} 的驻军带走了 ${moved} 名士兵（${armyTop(hero.army)}）`);
  }
}

/**
 * 增长池的取兵顺序：**高档优先**（§25.5，2026-10-31 B4）。
 *
 * `Object.keys()` 是**建造序**（dwell1 → dwell5），也就是低档在前。后果是金币不够时
 * 钱全花在 T1–T3 上，T5（1,500 金一只）永远排不到队 —— AI 的军队"数量很多、质量很烂"。
 * 和 `refillFromGarrison` 的 `sort` **必须同一口径**。
 *
 * 两处调用（`aiRecruit` 与 `runAiTurn` 的城内补兵）共用这一个函数：
 * 各写一遍的话，某天只改一处，就等于"一处买高档、一处买低档"，净效果为零。
 */
function poolOrder(pool: Record<string, number>): string[] {
  return Object.keys(pool).sort((a, b) => getUnit(b).tier - getUnit(a).tier);
}

/** 会出现在**兵种**造价里的稀有资源（`aiStockUnitRares` 与 `buildReserve` 共用一份）。 */
const RARE_RES: TradableResource[] = ['gem', 'crystal', 'sulfur', 'mercury'];

/**
 * 给"下一座建筑"留的金币：**大头留给建筑、小头继续买兵**（2026-10-31 B4 新增）。
 *
 * 为什么必须有这一步：`aiRecruit` 每天都把增长池买光，金币长期停在 0~30（实测 4 局 × 60 天）。
 * 于是 9,000 金的 `dwell5` 永远攒不到 —— **8 局 × 60 天只有 1 局在 D56 摸到 T5**，
 * 一个五周的对局里 AI 根本不会出现 5 级兵。这不是"AI 弱"，是"T5 对 AI 不存在"：
 * 新阵容给四族各配了一只 T5，玩家会买，AI 一辈子看不到。
 *
 * **比例是量出来的，不是拍的**：先取"对半分"（`gold × 0.5`），实测 8 局里
 * `dwell5` 落在 D17~D34、`p2` 八局全落空（金币每天只涨净收入的一半，
 * 9,000 要涨到第 6 周）。改成 `0.8` 之后四族都能在五周内建起来（见 A3 读数）。
 * 留 20% 是**刻意**的：`aiArmWarMachines`、`aiBuyRare` 和一两队兵还要从这里面出，
 * 全额锁死会让 AI 在攒钱那几天彻底不买兵 —— 那正是 A2 盯的失败模式。
 *
 * 上限 `gap`：只攒"还差多少"，攒够就停 —— 否则它会为了一座买不起的 dwell5 一直囤钱。
 * 例外：**建得起却没建**（缺木/矿，或今天已经建过一座）时不留钱 —— 那笔钱攒着也没用。
 */
/** 攒钱比例：留 80% 给下一座建筑，20% 继续买兵（见 `buildReserve` 的长注释）。 */
const BUILD_RESERVE_SHARE = 0.8;

function buildReserve(state: GameState, player: FactionId): number {
  const gold = state.players[player]?.resources.gold ?? 0;
  if (gold <= 0) return 0;
  // 池子里躺着 **T4/T5** 时，攒钱的目标改成"把它买下来"：
  // · 还买不起 ⇒ 全部金币留给它（返回 `gold`，预算归零）
  // · 买得起   ⇒ 不留钱，让 `aiRecruit` 立刻买走
  //
  // 只留"按比例的预算"是**不够的**：实测 19 个阵营建成了 `dwell5`，只有 3 个买到了 T5 ——
  // 每天的预算只有 200~400 金，`floor(预算 / 1,500) = 0` 于是当天一只都不买、
  // 转头把这点钱买成 T1（低档池天天都在产），T5 在池子里躺到下个月。
  // 这就是 §25.5 说的"为一只 T5 抽空金币"的**反面**：连抽都抽不出来。
  for (const town of ownedTowns(state, player)) {
    for (const [unitTypeId, n] of Object.entries(town.growthPool ?? {})) {
      if (n <= 0 || getUnit(unitTypeId).tier < 4) continue;
      // ⚠️ 价格必须**把稀有资源折成金币**：`p4_wraith` 只写 `gold: 800`，
      //    但还要 4 水晶（市场 800/个）⇒ 真价 4,000。只看 `cost.gold` 的话
      //    "买得起"永远成立，预算每天照常放出去买 T1，T5 反而永远攒不齐。
      const cost = getUnit(unitTypeId).cost;
      const bag = state.players[player]?.resources;
      const price =
        (cost.gold ?? 0) +
        RARE_RES.filter((r) => (cost[r] ?? 0) > 0).reduce(
          (s, r) => s + Math.max(0, (cost[r] ?? 0) - (bag?.[r] ?? 0)) * MARKET_RATES[r].buyGold,
          0,
        );
      return gold >= price ? 0 : gold;
    }
  }
  let gap = 0;
  // 目标如果是**高级兵营**（dwell4 / dwell5），而且部队已经够打一场：
  // 全额攒钱，连那 20% 也不买。理由：这两座是 5,000 / 9,000 的整笔支出，
  // 按 80% 攒要 10 天以上，而五周一局只剩三周；有兵在身时"多买两个 T1"
  // 远不如"早四天有 T5"。部队不够时仍按 80% 走（A2 盯的就是这个）。
  const army = heroesOf(state, player).reduce((s, h) => s + armyValue(h.army), 0);
  const rush = army >= BASE_COMMIT * 2.5;
  for (const town of ownedTowns(state, player)) {
    const id = nextBuildTarget(town);
    if (!id) continue; // 这座城已经建完了，不用给它留钱
    const need = (BUILDINGS[id].cost.gold ?? 0) - gold;
    if (need <= 0) return 0; // 建得起 ⇒ 今天不用攒，交给 `aiBuild`
    gap = gap === 0 ? need : Math.min(gap, need);
    if (rush && (id === 'dwell4' || id === 'dwell5')) return gold;
  }
  return Math.min(gap, Math.floor(gold * BUILD_RESERVE_SHARE));
}

/**
 * 给**增长池里的兵**补稀有资源（2026-10-31 B4 新增）。
 *
 * 兵种造价里也吃稀有资源：吸血鬼 `crystal 1`、摄魂怪 `crystal 4`、绿龙 `sulfur` 等。
 * `aiBuyRare` 只按**建筑**的造价补货，于是这些兵会永远躺在池子里 ——
 * 实测（seed 10104 / p4）：摄魂怪在池子里等了 20+ 天，金币 2,471 也买不动，
 * 因为缺 4 水晶；同一个池子里的牛头怪（只吃矿）天天被买走。
 * 后果不是"AI 弱"，是**AI 永远没有 5 级兵**：19 个建成了 `dwell5` 的阵营里只有 3 个买到了 T5。
 *
 * 只补"够买一只"的量，且手里至少留 2 份的钱 —— 稀有资源 800 金/个，
 * 4 个水晶就是 3,200 金，比兵本身还贵，不能无脑囤。
 */
function aiStockUnitRares(state: GameState, player: FactionId): void {
  const bag = state.players[player]?.resources;
  if (!bag) return;
  const towns = ownedTowns(state, player);
  if (!towns.some((t) => t.buildings.includes('market'))) return;

  for (const town of towns) {
    for (const unitTypeId of poolOrder(town.growthPool)) {
      if ((town.growthPool[unitTypeId] ?? 0) <= 0) continue;
      const cost = getUnit(unitTypeId).cost;
      for (const res of RARE_RES) {
        const need = cost[res] ?? 0;
        if (!need) continue;
        let guard = 0;
        while (
          (bag[res] ?? 0) < need &&
          (bag.gold ?? 0) >= MARKET_RATES[res].buyGold * 2 &&
          guard++ < 8
        ) {
          if (!marketBuy(state, res, player)) break;
        }
      }
    }
  }
}

/** 本回合买兵可用的金币：`{ left }` 逐笔扣减，**一处买兵、两处共用**。 */
type GoldBudget = { left: number };

function recruitBudget(state: GameState, player: FactionId): GoldBudget {
  const gold = state.players[player]?.resources.gold ?? 0;
  return { left: Math.max(0, gold - buildReserve(state, player)) };
}

function aiRecruit(state: GameState, player: FactionId, budget: GoldBudget): void {
  const heroes = heroesOf(state, player);
  for (const town of ownedTowns(state, player)) {
    const inTown = heroes.find((h) => h.pos.x === town.pos.x && h.pos.y === town.pos.y) ?? null;
    for (const unitTypeId of poolOrder(town.growthPool)) {
      const goldEach = getUnit(unitTypeId).cost.gold ?? 0;
      let guard = 0;
      while ((town.growthPool[unitTypeId] ?? 0) > 0 && guard++ < 40) {
        const left = town.growthPool[unitTypeId] ?? 0;
        // 预算不够就整批跳过（不去"能买几个买几个"——那样高档兵永远轮不到）
        const ask0 = goldEach > 0 ? Math.min(left, Math.floor(budget.left / goldEach)) : left;
        if (ask0 <= 0) break;
        /* A5 单栈上限：能进英雄的进英雄，**装不下的买进驻军**。
           不能像最初那样 `break` —— 那只让兵留在池子里（钱也花不出去），
           实测会把英雄战力砍掉 1/3（seed 4242 D28 1315 → 1003）。 */
        let taken = 0;
        if (inTown) {
          const room = capForStackShare(inTown, unitTypeId, ask0);
          if (room > 0) taken += recruitToHero(state, town, inTown, unitTypeId, room).taken;
          if (taken < ask0) taken += recruitToGarrison(state, town, unitTypeId, ask0 - taken).taken;
        } else {
          taken = recruitToGarrison(state, town, unitTypeId, ask0).taken;
        }
        if (taken <= 0) break;
        budget.left -= taken * goldEach;
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

/**
 * 打下一座城"需要多少战力" —— **算上城墙**。
 *
 * `garrisonStrength` 只读守军，完全看不见墙；把它乘上 `WALL_NEED[守方][城防级]`
 * 才是实测的破城门槛（买墙之前 vs 之后，攻方要多带几成兵）。
 * 提出来单独一份，是因为它现在有**两个**消费者：`pickTarget` 的门槛
 * 与 `probe:wallgate` 的 `[W]` 接线检查（探针不许另抄一份公式，见铁律 13）。
 *
 * 空城（`garrison` 为空 / 只有 0 兵）返回 0 —— 城墙挡不住"走进去"，
 * 门槛由调用方的 `max(120, …)` 地板负责。
 */
export function townNeedForAI(town: Town): number {
  const g = garrisonStrength(town.garrison);
  if (g <= 0) return 0;
  return g * wallNeedMultiplier(town.owner, wallLevelOf(town));
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
      // ★ 出击门槛（`aggression`）：打**有主**的城算开战，兵力不到 `commit` 就不进候选表。
      //   中立城不算（那是扩张，不是开战），否则轻松档 AI 连发育都不会。
      if (town.owner !== 'neutral' && power < commit) continue;
      // 城防折成"要带多少兵"：**守军战力 × `WALL_NEED[守方族][城防级]`**（B3c）。
      // 倍率来自 `probe:wallgate` 的破城门槛实测（k_level / k_0），查表轴是**守方**阵营。
      // 旧写法是 `+ townDefenseBonus × 24`（L1 只加 48 战力，实测墙值 ≈ 守军的 9%）
      // ⇒ 低估 12~88 倍，AI 会带一支明显不够的兵去啃有墙的城。
      // 分母地板 `max(120, …)` 保留 —— 空城也要有守卫成本，否则任何一支小队都算"稳赢"。
      const need = townNeedForAI(town);
      const odds = power / Math.max(120, need * 1.15);
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
    // ★ 同上：打敌方英雄是最纯粹的"出击"，同样受 `commit` 门槛约束。
    if (power < commit) continue;
    const odds = power / Math.max(120, heroPower(foe));
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
  // 就把增长池抽干送进驻军，所以轮到 pickTarget 做决定时池子基本是空的 ——
  // 唯一那个"家里有兵"的信号被自己抹掉了，英雄于是永远不回家，
  // 驻军囤到 2000+ 战力也没人带走（实测：去掉这一条，36 局里英雄补兵次数从 2.8 掉到 1.7）。
  // 加上它之后闭环才成立：回家 → 带走富余驻军 → 再出门。
  //
  // ⚠️ **`poolValue` 不是 `pool`**（§25.5，2026-10-31 B4）：买兵改成高档优先之后，
  // 金币不够时 T1 池会一直躺着 ⇒ `pool > 0` 恒真 ⇒ 每一回合都多出一个回城候选，
  // AI 被自己拖在家里。判据必须是"池子里的兵**值一次出征**"：
  // `BASE_COMMIT × 0.5`（写成公式，不写死 200 —— 它跟着 `BASE_COMMIT` 缩放）。
  const homes = ownedTowns(state, player);
  const poolValue = homes.reduce(
    (s, t) =>
      s +
      Object.entries(t.growthPool).reduce(
        (a, [id, n]) => a + (n > 0 ? n * getUnit(id).aiValue : 0),
        0,
      ),
    0,
  );
  const surplus = homes.reduce(
    (s, t) => s + Math.max(0, garrisonStrength(t.garrison) - GARRISON_KEEP_VALUE),
    0,
  );
  const wounded = power < commit * 0.6;
  if (poolValue >= BASE_COMMIT * 0.5 || surplus > 0 || wounded) {
    for (const town of homes) {
      const cost = costAt(town.pos);
      if (!isFinite(cost) || cost <= 0) continue; // 到不了 / 已经在家
      const pull =
        Math.min(120, poolValue * 0.5) + (surplus > 0 ? Math.min(300, surplus * 0.4) : 0) + (wounded ? 400 : 0);
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
  // H6「林地」：AI 走同一条规则（不做弊，也不吃亏）
  const grassMul = grassMoveMul(hero);
  const field = computePaths(state, hero.pos, Infinity, grassMul);
  const path = buildPath(state, field, hero.pos, target);

  for (const step of path) {
    const cost = stepCost(state, hero.pos, step, grassMul);
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
    const prevOwner = ownerOfObject(state, arrived);
    const res = applyInteraction(state, hero.id, arrived.id, true);
    if (res.heroDefeated) {
      noteAiEvent({ kind: 'death', player, what: hero.name, detail: '部队被全歼' });
      return;
    }
    if (res.title) {
      pushLog(state, `${hero.name}：${res.message.split('\n')[0]}`);
      noteAiEvent(arrivalEvent(state, player, hero.name, arrived, prevOwner, res.title));
    }
    if (stops) return; // 大事件（战斗/攻城）之后今日收工
  }
}

/** 物件当前归属（mine/town 有 owner；其余返回 null）。供"是否打到玩家头上"判定。 */
function ownerOfObject(state: GameState, obj: MapObject): string | null {
  if (obj.kind === 'mine') return (obj.payload as { owner?: string }).owner ?? 'neutral';
  if (obj.kind === 'town') {
    return state.towns[(obj.payload as { townId: string }).townId]?.owner ?? null;
  }
  return null;
}

/**
 * 把一次抵达结算翻成结构化事件（TP-7）。
 * 分类：城镇 = 攻城占领；矿场 = 插旗占领；野怪/宝库 = 交战。
 * 调用方已排除 heroDefeated（战死）与空 title（路过自家城）两种分支。
 */
function arrivalEvent(
  state: GameState,
  player: FactionId,
  heroName: string,
  obj: MapObject,
  prevOwner: string | null,
  title: string,
): AiEvent {
  const human = viewerOf(state);
  const vsPlayer = prevOwner === human;
  if (obj.kind === 'town') {
    const town = state.towns[(obj.payload as { townId: string }).townId];
    const verb = title === '兵不血刃' ? '兵不血刃拿下' : '攻陷了';
    return {
      kind: 'capture',
      player,
      hero: heroName,
      what: `${verb}${town?.name ?? '一座城镇'}`,
      detail: '',
      vsPlayer,
      win: true,
    };
  }
  if (obj.kind === 'mine') {
    const perDay = (obj.payload as { perDay?: number }).perDay;
    return {
      kind: 'capture',
      player,
      hero: heroName,
      what: title,
      detail: perDay ? `每日 +${perDay}` : '',
      vsPlayer,
      win: true,
    };
  }
  // 野怪 / 宝库：走到这里必然是战斗胜利（战死分支已提前返回）。
  // `what` 必须是**动手的人**。改前这里是 `foeNameOf(obj)`（= "野怪"），渲染出来是
  // 「野怪 清掉了挡路的敌人」—— 读起来像野怪把别人清了，主理人每天在字幕里看到的就是这句。
  // 事件模型里 `what` 是主体、`detail` 是"发生了什么"（见 main.ts 的 `aiEventLine`）。
  const foe = foeNameOf(obj);
  return {
    kind: 'battle',
    player,
    hero: heroName,
    what: heroName,
    detail: obj.kind === 'vault' ? `攻破了${foe}` : `清掉了挡路的${foe}`,
    win: true,
  };
}

/** 野怪/宝库物件的中文主体名（宝库带档位）。 */
function foeNameOf(obj: MapObject): string {
  if (obj.kind === 'vault') {
    const tier = (obj.payload as { tier?: string }).tier;
    return tier === 'strong' ? '重兵把守的宝库' : '宝库';
  }
  return '野怪';
}

/** AI 主动打敌方英雄：无头结算，结果写回世界。 */
function aiFightHero(state: GameState, attacker: Hero, defender: Hero): void {
  const odds = heroPower(attacker) / Math.max(120, heroPower(defender));
  if (odds < 1.05) return; // 打不赢就绕开，等下次
  const setup = heroBattleSetup(state, attacker.id, defender.id);
  if (!setup) return;
  const outcome = quickBattle(setup.attacker, setup.defender, setup.seed);
  const res = applyHeroBattle(state, attacker.id, defender.id, outcome);
  if (res.title) pushLog(state, `${attacker.name}：${res.title}`);
  const vsPlayer = defender.owner === viewerOf(state);
  noteAiEvent({
    kind: 'battle',
    player: attacker.owner as FactionId,
    what: attacker.name,
    detail: outcome.win
      ? `击败了${vsPlayer ? '你的英雄' : ''}${defender.name}`
      : `进攻 ${defender.name} 失利`,
    vsPlayer,
    win: outcome.win,
  });
  // 生死可见（F-2.2 的核心诉求）：败者从 state.heroes 消失，这里补一条死亡事件。
  if (!state.heroes[defender.id]) {
    noteAiEvent({
      kind: 'death',
      player: defender.owner as FactionId,
      what: defender.name,
      detail: vsPlayer ? '你的英雄阵亡了' : '被敌军击溃',
      vsPlayer,
    });
  }
  if (!state.heroes[attacker.id]) {
    noteAiEvent({
      kind: 'death',
      player: attacker.owner as FactionId,
      what: attacker.name,
      detail: '进攻失利，全军覆没',
    });
  }
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
      noteAiEvent({
        kind: 'hire',
        player,
        what: hired.name,
        detail: `在 ${town.name} 加入战局`,
      });
      return;
    }
  }
}

/* ---------------- 每日入口 ---------------- */

/** `who` 阵营的任一英雄，能不能看到 `pos`。半径用 `HERO_SIGHT` —— 与迷雾渲染同一常数。 */
function seenBy(state: GameState, who: PlayerId, pos: GridPos): boolean {
  for (const id of state.heroOrder) {
    const h = state.heroes[id];
    if (!h || h.owner !== who) continue;
    const dx = h.pos.x - pos.x;
    const dy = h.pos.y - pos.y;
    if (dx * dx + dy * dy <= HERO_SIGHT * HERO_SIGHT) return true;
  }
  return false;
}

/**
 * 敌方行军：**只报"从雾里走进你视野"的那一次**（2026-10-23 主理人）。
 *
 * 改前 AI 每走一步都往战报写「紫晶 · 城主 从 (19,27) 移动到 (17,23)，部队 弓手 ×20」——
 * 而 `doEndDay` 收尾会把最后一条日志当**字幕**弹在屏幕上。问题不在文案长短：
 * 玩家地图上没有坐标可对照，这行字既定位不了那支部队、也推不出该怎么应对。
 *
 * 现在只剩一种情况值得说：它刚从雾里走进来（你此前看不见、现在看得见）。
 *   · 全程都在视野里 ⇒ 你亲眼看着它走，再念一遍是噪音；
 *   · 始终在雾里 / 进来又出去 ⇒ 你根本看不见，"看不见的东西不报"是 HoMM3 的同一套规矩。
 * 进出都不报"离开视野"：看不见之后说什么都无法核对，只会让人以为地图上还有影子。
 */
function reportMoveIfSeen(state: GameState, player: FactionId, hero: Hero, before: GridPos): void {
  const viewer = viewerOf(state);
  if (seenBy(state, viewer, before)) return;
  if (!seenBy(state, viewer, hero.pos)) return;
  pushLog(state, `${factionName(player)} · ${hero.name} 出现在你的视野内`);
  noteAiEvent({ kind: 'move', player, what: hero.name, detail: '进入你的视野' });
}

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
  // 先补"池里那只兵缺的稀有资源"，再算募兵预算：顺序反了就会用旧金币数算预算
  aiStockUnitRares(state, player);
  aiArmWarMachines(state, player);
  // 一份预算贯穿"募兵"与"城内补兵"两处：只卡一处等于没卡
  const budget = recruitBudget(state, player);
  aiRecruit(state, player, budget);

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
      // ⚠️ **必须走同一份预算**。这里原来是无条件把增长池的剩余买空：
      //    `aiRecruit` 刚按预算买过一轮，剩下的刚好是"预算买不起"的那部分，
      //    这一段再买就等于把留给下一座建筑的钱花掉 —— 实测 p3 拿着 3,500 金
      //    卡在 12 座建筑 26 天，`dwell5` 一次都没动工。
      for (const unitTypeId of poolOrder(town.growthPool)) {
        const left = town.growthPool[unitTypeId] ?? 0;
        if (left <= 0) continue;
        const goldEach = getUnit(unitTypeId).cost.gold ?? 0;
        const ask0 = goldEach > 0 ? Math.min(left, Math.floor(budget.left / goldEach)) : left;
        if (ask0 <= 0) continue;
        // 同上：能进英雄的进英雄，装不下的买进驻军（不许把兵晾在池子里）。
        const room = capForStackShare(hero, unitTypeId, ask0);
        let got = room > 0 ? recruitToHero(state, town, hero, unitTypeId, room).taken : 0;
        if (got < ask0) got += recruitToGarrison(state, town, unitTypeId, ask0 - got).taken;
        budget.left -= got * goldEach;
      }
      // 增长池通常已被当天的 aiRecruit 抽干送进驻军，这里把驻军的富余兵力搬回英雄身上
      refillFromGarrison(state, hero, town);
      hero.manaMax = manaMaxOf(hero);
      hero.mana = hero.manaMax;
    }

    if (before.x !== hero.pos.x || before.y !== hero.pos.y) {
      reportMoveIfSeen(state, player, hero, before);
    }
  }

  maybeHireHero(state, player);
}
