import type { BuildingDef } from '../types.js';

/**
 * 建筑树共 12 座（含预置的酒馆），分三条线：
 *   经济线  market → townhall
 *   城防线  wall1 → wall2 → wall3
 *   兵营线  dwell1 → dwell2 → dwell3 → dwell4 → dwell5
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
    desc: '城镇税收提升，每日 +250 金币。',
    cost: { gold: 1500, wood: 10, ore: 5 },
    requires: ['market'],
    dailyGold: 250,
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
    desc: '驻军防御 +2，每日 +100 金。',
    cost: { gold: 1000, wood: 10 },
    requires: ['tavern'],
    defenseBonus: 2,
    dailyGold: 100,
  },
  wall2: {
    id: 'wall2',
    name: '石墙',
    desc: '驻军防御 +4，每日 +200 金。',
    cost: { gold: 2500, ore: 10 },
    requires: ['wall1'],
    defenseBonus: 4,
    dailyGold: 200,
  },
  wall3: {
    id: 'wall3',
    name: '堡垒',
    desc: '驻军防御 +6，每日 +400 金，全城周增长 +25%。',
    cost: { gold: 5000, wood: 10, ore: 15 },
    requires: ['wall2'],
    defenseBonus: 6,
    dailyGold: 400,
    growthBonus: 0.25,
  },

  /* ---------------- 兵营线：dwell1 → dwell5 ----------------
   *
   * `growth` **只写 `tier`，不写 `unitTypeId`**（段 2）。理由：
   *   ① 同一座 `dwell3` 在四族里必须长出四种兵 —— 写死 id 会让四族共用一张表，
   *      玩家就只看到配色差异（这正是「兵种都一样」抱怨的根因）；
   *   ② `tier` 是与阵营**正交**的坐标，阵营差异全部收敛到 `FACTION_UNITS` 一张表
   *      （`core/data/units.ts`），加第五个阵营时只改那一处，不用碰建筑树；
   *   ③ 具体 id 在**运行时**由 `unitIdForTier(town.owner, tier)` 解析
   *      —— owner 变了（城镇易主）兵种随之变，`growthPool` 的既有语义
   *      （键 = canonical unit id）保持不变。
   *
   * ⇒ 因此 `desc` 也必须是**阵营中立**的写法（不写「解锁农民」，
   *    那句话只对晨曦成立）。UI 若要显示具体兵名，调 `unitIdForTier` 自己取。
   */
  dwell1: {
    id: 'dwell1',
    name: '农舍',
    desc: '解锁本族 1 级兵，每周增长 +10。',
    cost: { gold: 300, wood: 5 },
    requires: ['tavern'],
    growth: { tier: 1, count: 10 },
  },
  dwell2: {
    id: 'dwell2',
    name: '射箭场',
    desc: '解锁本族 2 级兵，每周增长 +5。',
    cost: { gold: 1000, wood: 5, ore: 5 },
    requires: ['dwell1'],
    growth: { tier: 2, count: 5 },
  },
  dwell3: {
    id: 'dwell3',
    name: '兵营',
    desc: '解锁本族 3 级兵，每周增长 +4。',
    cost: { gold: 2500, ore: 10 },
    requires: ['dwell2'],
    growth: { tier: 3, count: 4 },
  },
  dwell4: {
    id: 'dwell4',
    name: '马厩',
    desc: '解锁本族 4 级兵，每周增长 +3。',
    cost: { gold: 5000, wood: 10, ore: 10 },
    requires: ['dwell3'],
    growth: { tier: 4, count: 3 },
  },
  dwell5: {
    id: 'dwell5',
    name: '圣殿',
    desc: '解锁本族 5 级兵，每周增长 +2。',
    cost: { gold: 9000, wood: 10, ore: 20 },
    requires: ['dwell4'],
    growth: { tier: 5, count: 2 },
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
  'dwell4',
  'dwell5',
  'guild1',
  'guild2',
  'guild3',
] as const;

/** 兵营 id → 对应兵种，用于渲染城镇外观等级。 */
export const DWELLING_IDS = ['dwell1', 'dwell2', 'dwell3', 'dwell4', 'dwell5'];

export const HERO_HIRE_COST = 2500;

/** 城镇基础每日税收。 */
export const BASE_TOWN_INCOME = 500;

export function getBuilding(id: string): BuildingDef {
  const b = BUILDINGS[id];
  if (!b) throw new Error(`未知建筑: ${id}`);
  return b;
}
