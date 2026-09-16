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

  dwell1: {
    id: 'dwell1',
    name: '农舍',
    desc: '解锁农民，每周增长 +10。',
    cost: { gold: 300, wood: 5 },
    requires: ['tavern'],
    growth: { unitTypeId: 'peasant', count: 10 },
  },
  dwell2: {
    id: 'dwell2',
    name: '射箭场',
    desc: '解锁弓手，每周增长 +5。',
    cost: { gold: 1000, wood: 5, ore: 5 },
    requires: ['dwell1'],
    growth: { unitTypeId: 'archer', count: 5 },
  },
  dwell3: {
    id: 'dwell3',
    name: '兵营',
    desc: '解锁枪兵，每周增长 +4。',
    cost: { gold: 2500, ore: 10 },
    requires: ['dwell2'],
    growth: { unitTypeId: 'pikeman', count: 4 },
  },
  dwell4: {
    id: 'dwell4',
    name: '马厩',
    desc: '解锁骑士，每周增长 +3。',
    cost: { gold: 5000, wood: 10, ore: 10 },
    requires: ['dwell3'],
    growth: { unitTypeId: 'knight', count: 3 },
  },
  dwell5: {
    id: 'dwell5',
    name: '圣殿',
    desc: '解锁天使，每周增长 +2。',
    cost: { gold: 9000, wood: 10, ore: 20 },
    requires: ['dwell4'],
    growth: { unitTypeId: 'angel', count: 2 },
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
