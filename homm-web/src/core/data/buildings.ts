import type { BuildingDef } from '../types.js';

/**
 * 建筑树共 16 座（含预置的酒馆），分四条线：
 *   经济线  market → townhall
 *   城防线  wall1 → wall2 → wall3      —— **零金币**，卖的是防御与周增长（§27.3）
 *   兵营线  dwell1 → dwell2 → dwell3 → dwell4 → dwell5
 *   王牌线  dwell3 → banner            —— 本族 T3 周产 ×1.5（§23.4 / §27.3）
 *
 * ⚠️ 城防线**不产金**（对齐 H3：Fort / Citadel / Castle 收入全 0）。
 * 2026-10-29 之前这里是 100 / 200 / 400，等于给每个玩家开了第二条收入线，
 * 于是"建筑越贵越赚"——城墙变成投资品，而 H3 里它是**消耗品**。
 * 回报改成**增长**：wall2 +25%、wall3 +25%（合计 +50%，H3 是 +50%/+100%，取半量）。
 * `audit:econ` 的 G-E3 机检这一条：任一座 wall 出现 `dailyGold` 就红。
 */
export const BUILDINGS: Record<string, BuildingDef> = {
  tavern: {
    id: 'tavern',
    name: '酒馆',
    desc: '每周可招募一位英雄。',
    cost: {},
    requires: [],
    feature: 'tavern',
  },

  market: {
    id: 'market',
    name: '市场',
    desc: '开启资源交易：1000 金买入 5 木/矿，或卖出 5 木/矿换 500 金。',
    cost: { gold: 500, wood: 5 },
    requires: ['tavern'],
    feature: 'market',
  },
  townhall: {
    id: 'townhall',
    name: '议事堂',
    desc: '城镇税收提升，每日 +450 金币。',
    cost: { gold: 1500, wood: 10, ore: 5 },
    requires: ['market'],
    dailyGold: 450,
  },
  workshop: {
    id: 'workshop',
    name: '工坊',
    desc: '可在城内为英雄装配攻城器械：投石车（1500 金 / 8 木 / 8 矿）、弩车（1000 金 / 6 木）。',
    cost: { gold: 2000, wood: 10, ore: 10 },
    requires: ['market'],
    feature: 'workshop',
  },

  wall1: {
    id: 'wall1',
    name: '木栅',
    desc: '驻军防御 +2。不产金——城墙买的是守得住的夜晚。',
    cost: { gold: 1000, wood: 10 },
    requires: ['tavern'],
    defenseBonus: 2,
  },
  wall2: {
    id: 'wall2',
    name: '石墙',
    desc: '驻军防御 +4，全城周增长 +25%。',
    cost: { gold: 2500, ore: 10 },
    requires: ['wall1'],
    defenseBonus: 4,
    growthBonus: 0.25,
  },
  wall3: {
    id: 'wall3',
    name: '堡垒',
    desc: '驻军防御 +6，再为全城周增长 +25%（与石墙合计 +50%）。',
    cost: { gold: 5000, wood: 10, ore: 15 },
    requires: ['wall2'],
    defenseBonus: 6,
    growthBonus: 0.25,
  },

  /* ---------------- 兵营线：dwell1 → dwell5 ----------------
   *
 * `growth` **只写 `tier`，不写数量、也不写 `unitTypeId`**（段 2 + 2026-10-20）：
 *   ① 同一座 `dwell3` 在四族里必须长出四种兵 —— 写死 id 会让四族共用一张表，
 *      玩家就只看到配色差异（这正是「兵种都一样」抱怨的根因）；
 *   ② `tier` 是与阵营**正交**的坐标，阵营差异全部收敛到 `FACTION_UNITS` 一张表
 *      （`core/data/units.ts`），加第五个阵营时只改那一处，不用碰建筑树；
 *   ③ 具体 id 在**运行时**由 `unitIdForTier(town.owner, tier)` 解析
 *      —— owner 变了（城镇易主）兵种随之变，`growthPool` 的既有语义
 *      （键 = canonical unit id）保持不变；
 *   ④ **周产数量也不写在这里**：唯一权威是 `UnitType.growthPerWeek`
 *      （四族 T1 = 11/12/10/9）。旧字段 `growth.count` 是第二份真相，
 *      `applyWeeklyGrowth` 只读它 ⇒ 兵种表的周产从未生效（2026-10-20 删除）。
 *
 * ⇒ 因此 `desc` 也必须是**阵营中立**的写法（不写「解锁农民」，
 *    那句话只对晨曦成立；也不写「+10」，那对赤焰是 12、对紫晶是 9）。
 *    城镇面板用 `buildingDesc(town, id)` 动态拼出「本族每周 +N」。
 */
  dwell1: {
    id: 'dwell1',
    name: '农舍',
    desc: '解锁本族 1 级兵。',
    cost: { gold: 300, wood: 5 },
    requires: ['tavern'],
    growth: { tier: 1 },
  },
  dwell2: {
    id: 'dwell2',
    name: '射箭场',
    desc: '解锁本族 2 级兵。',
    cost: { gold: 1000, wood: 5, ore: 5 },
    requires: ['dwell1'],
    growth: { tier: 2 },
  },
  dwell3: {
    id: 'dwell3',
    name: '兵营',
    desc: '解锁本族 3 级兵。',
    cost: { gold: 2500, ore: 10 },
    requires: ['dwell2'],
    growth: { tier: 3 },
  },
  dwell4: {
    id: 'dwell4',
    name: '马厩',
    desc: '解锁本族 4 级兵。',
    cost: { gold: 5000, wood: 10, ore: 10 },
    requires: ['dwell3'],
    growth: { tier: 4 },
  },
  dwell5: {
    id: 'dwell5',
    name: '圣殿',
    desc: '解锁本族 5 级兵。',
    cost: { gold: 9000, wood: 10, ore: 20 },
    requires: ['dwell4'],
    growth: { tier: 5 },
  },

  /* ---------------- 王牌线：banner（§23.4 / §27.3） ----------------
   *
   * 为什么它必须挂在 `dwell3` 上、而且**只能**挂 T3：
   *   四族各挑一档去加成都算不平 —— 同一档在四族里的价值差 **11.9×**
   *   （T1 便宜到加成看不见，T5 一队就顶半支军队）。T3 是唯一
   *   "每周多出来的一队真的会上场、又不至于一波定胜负"的档位。
   *
   * 为什么是 1,000 金而不是更贵：它与城防线增长**乘算**，
   *   满建 `1.5 × 1.5 = 2.25×`。若定价过高，玩家会先买兵再建它，
   *   而"每周多半队 T3"正是这条线要卖的**复利**（§27.3 的 D-6 测算）。
   */
  banner: {
    id: 'banner',
    name: '主力营',
    desc: '本族 3 级兵周产 ×1.5（与城防线增长乘算，满建 2.25×）。',
    cost: { gold: 1000, wood: 5, ore: 5 },
    requires: ['dwell3'],
    tierGrowthBoost: { tier: 3, mult: 1.5 },
  },

  /* ---------------- 魔法线（M4）：guild1 → guild2 → guild3 ---------------- */
  guild1: {
    id: 'guild1',
    name: '魔法行会',
    desc: '解锁 1 级法术，建成时己方全部英雄立即学会。',
    cost: { gold: 2000, wood: 5, ore: 5 },
    requires: ['tavern'],
    feature: 'guild',
  },
  guild2: {
    id: 'guild2',
    name: '高级魔法行会',
    desc: '再解锁 2 级法术（闪电、减速、石肤、嗜血、冰箭、观空术、回城术）。',
    cost: { gold: 3000, gem: 4 },
    requires: ['guild1'],
    feature: 'guild',
  },
  guild3: {
    id: 'guild3',
    name: '大法师塔',
    desc: '再解锁 3 级法术（火球、复活、次元门）。',
    cost: { gold: 4500, crystal: 4 },
    requires: ['guild2'],
    feature: 'guild',
  },
};

export const BUILDING_ORDER = [
  'tavern',
  'market',
  'townhall',
  'workshop',
  'wall1',
  'wall2',
  'wall3',
  'dwell1',
  'dwell2',
  'dwell3',
  'banner',
  'dwell4',
  'dwell5',
  'guild1',
  'guild2',
  'guild3',
] as const;

/** 兵营 id → 对应兵种，用于渲染城镇外观等级。 */
export const DWELLING_IDS = ['dwell1', 'dwell2', 'dwell3', 'dwell4', 'dwell5'];

export const HERO_HIRE_COST = 2500;

/**
 * 城镇基础每日税收。
 *
 * 2026-10-31（B3a）：500 → **600**，议事堂 250 → **450**。
 * 起因是城墙去掉 700/天之后，收入必须从"基建"补回来，否则 5 周预算
 * 连基础树都建不完（G-E1 0.912）。补齐口径 = **基础税 + 议事堂 + 家门前金矿**：
 * 600 + 450 + 400 = **1,450/天**（满建）。三个数字合起来才是 §27 的预算 45,900。
 */
export const BASE_TOWN_INCOME = 600;

export function getBuilding(id: string): BuildingDef {
  const b = BUILDINGS[id];
  if (!b) throw new Error(`未知建筑: ${id}`);
  return b;
}
