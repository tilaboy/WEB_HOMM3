import type { UnitType } from '../types.js';

export const UNITS: Record<string, UnitType> = {
  peasant: {
    id: 'peasant', name: '农民', tier: 1,
    attack: 1, defense: 1, damageMin: 1, damageMax: 2, hp: 3, speed: 3,
    expValue: 4, growthPerWeek: 10, cost: { gold: 20 },
    body: '#9c8a63', accent: '#5b4c33',
  },
  archer: {
    id: 'archer', name: '弓手', tier: 2,
    attack: 4, defense: 2, damageMin: 2, damageMax: 3, hp: 10, speed: 4, shots: 12,
    expValue: 12, growthPerWeek: 5, cost: { gold: 100 },
    body: '#8a6a3a', accent: '#e8d9a8',
  },
  pikeman: {
    id: 'pikeman', name: '枪兵', tier: 3,
    attack: 5, defense: 5, damageMin: 3, damageMax: 5, hp: 18, speed: 4,
    expValue: 20, growthPerWeek: 4, cost: { gold: 200, wood: 2 },
    body: '#7a8a99', accent: '#c9d3db',
  },
  knight: {
    id: 'knight', name: '骑士', tier: 4,
    attack: 7, defense: 7, damageMin: 6, damageMax: 9, hp: 35, speed: 6,
    expValue: 45, growthPerWeek: 3, cost: { gold: 500, ore: 3 },
    body: '#b8b8c4', accent: '#4f7fbf',
  },
  angel: {
    id: 'angel', name: '天使', tier: 5,
    attack: 10, defense: 10, damageMin: 12, damageMax: 16, hp: 60, speed: 8,
    expValue: 120, growthPerWeek: 2, cost: { gold: 1200, ore: 5, wood: 5 },
    body: '#f4f4f7', accent: '#e3b869',
  },
  wolf: {
    id: 'wolf', name: '野狼', tier: 1,
    attack: 3, defense: 1, damageMin: 2, damageMax: 3, hp: 8, speed: 6,
    expValue: 8, growthPerWeek: 0, cost: {},
    body: '#8a8a92', accent: '#3a3a42',
  },
  boar: {
    id: 'boar', name: '野猪', tier: 3,
    attack: 5, defense: 4, damageMin: 3, damageMax: 5, hp: 24, speed: 4,
    expValue: 18, growthPerWeek: 0, cost: {},
    body: '#6b4a2f', accent: '#241a10',
  },
  ogre: {
    id: 'ogre', name: '食人魔', tier: 4,
    attack: 8, defense: 5, damageMin: 6, damageMax: 10, hp: 30, speed: 3,
    expValue: 40, growthPerWeek: 0, cost: {},
    body: '#4f6b3a', accent: '#1e2a15',
  },
};

export function getUnit(id: string): UnitType {
  const u = UNITS[id];
  if (!u) throw new Error(`未知兵种: ${id}`);
  return u;
}

/** 玩家可招募的兵种（按兵营等级从低到高）。 */
export const PLAYER_UNIT_IDS = ['peasant', 'archer', 'pikeman', 'knight', 'angel'];

/** 中立野怪，不进兵营。 */
export const MONSTER_UNIT_IDS = ['wolf', 'boar', 'ogre'];

/** 英雄部队最多 5 个兵种槽位（HOMM 规则）。 */
export const MAX_STACKS = 5;
