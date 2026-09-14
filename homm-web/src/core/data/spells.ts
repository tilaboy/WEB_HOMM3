import type { ResourceBag } from '../types.js';

/**
 * M4 法术表。
 *
 * level 1-3：对应魔法行会的 1~3 级；行会 lv.N 解锁全部 ≤N 级法术。
 * combat = true 是战斗魔法（在战场上施放），false 是冒险魔法（在大地图施放）。
 *
 * target 说明（战斗魔法）：
 *   enemy   — 点一个敌方部队
 *   ally    — 点一个我方部队
 *   point   — 点一个格子（火球，溅射周围一圈）
 * 冒险魔法的 target 无意义，由各自的世界逻辑解释。
 */
export interface Spell {
  id: string;
  name: string;
  level: 1 | 2 | 3;
  manaCost: number;
  combat: boolean;
  target?: 'enemy' | 'ally' | 'point';
  desc: string;
}

export const SPELLS: Record<string, Spell> = {
  /* ---------------- 1 级战斗魔法 ---------------- */
  magicArrow: {
    id: 'magicArrow',
    name: '魔法箭',
    level: 1,
    manaCost: 3,
    combat: true,
    target: 'enemy',
    desc: '造成 8 + 6×魔力 点伤害。',
  },
  bless: {
    id: 'bless',
    name: '祝福',
    level: 1,
    manaCost: 3,
    combat: true,
    target: 'ally',
    desc: '目标我方部队攻击 +3，持续 魔力 回合。',
  },
  curse: {
    id: 'curse',
    name: '诅咒',
    level: 1,
    manaCost: 3,
    combat: true,
    target: 'enemy',
    desc: '目标敌方部队攻击 -3（不低于 0），持续 魔力 回合。',
  },
  haste: {
    id: 'haste',
    name: '加速',
    level: 1,
    manaCost: 3,
    combat: true,
    target: 'ally',
    desc: '目标我方部队速度 +2，持续 魔力 回合。',
  },
  shield: {
    id: 'shield',
    name: '护盾',
    level: 1,
    manaCost: 3,
    combat: true,
    target: 'ally',
    desc: '目标我方部队受到的远程伤害减半，持续 魔力 回合。',
  },

  /* ---------------- 2 级战斗魔法 ---------------- */
  lightningBolt: {
    id: 'lightningBolt',
    name: '闪电',
    level: 2,
    manaCost: 6,
    combat: true,
    target: 'enemy',
    desc: '造成 20 + 8×魔力 点伤害。',
  },
  slow: {
    id: 'slow',
    name: '减速',
    level: 2,
    manaCost: 4,
    combat: true,
    target: 'enemy',
    desc: '目标敌方部队速度 -2（不低于 1），持续 魔力 回合。',
  },
  stoneSkin: {
    id: 'stoneSkin',
    name: '石肤',
    level: 2,
    manaCost: 4,
    combat: true,
    target: 'ally',
    desc: '目标我方部队防御 +3，持续 魔力 回合。',
  },
  bloodlust: {
    id: 'bloodlust',
    name: '嗜血',
    level: 2,
    manaCost: 4,
    combat: true,
    target: 'ally',
    desc: '目标我方部队近战攻击 +4，持续 魔力 回合。',
  },
  iceBolt: {
    id: 'iceBolt',
    name: '冰箭',
    level: 2,
    manaCost: 5,
    combat: true,
    target: 'enemy',
    desc: '造成 15 + 9×魔力 点伤害。',
  },

  /* ---------------- 3 级战斗魔法 ---------------- */
  fireball: {
    id: 'fireball',
    name: '火球',
    level: 3,
    manaCost: 9,
    combat: true,
    target: 'point',
    desc: '命中格及其周围一圈所有部队受 10 + 6×魔力 点伤害（不分敌我）。',
  },
  resurrect: {
    id: 'resurrect',
    name: '复活',
    level: 3,
    manaCost: 8,
    combat: true,
    target: 'ally',
    desc: '复活目标我方部队 数量×20%×魔力 的士兵（战斗内有效）。',
  },

  /* ---------------- 冒险魔法（1~2 级，行会同样解锁） ---------------- */
  visions: {
    id: 'visions',
    name: '异视术',
    level: 1,
    manaCost: 2,
    combat: false,
    desc: '侦察 5 格内一支野怪的精确兵力，不必开战。',
  },
  viewAir: {
    id: 'viewAir',
    name: '观空术',
    level: 2,
    manaCost: 5,
    combat: false,
    desc: '揭开全图迷雾。',
  },
  viewEarth: {
    id: 'viewEarth',
    name: '观地术',
    level: 1,
    manaCost: 3,
    combat: false,
    desc: '汇总全图所有野怪的位置与规模情报。',
  },
  townPortal: {
    id: 'townPortal',
    name: '回城术',
    level: 2,
    manaCost: 8,
    combat: false,
    desc: '传送到任意一座己方城镇。',
  },
  dimensionDoor: {
    id: 'dimensionDoor',
    name: '次元门',
    level: 3,
    manaCost: 8,
    combat: false,
    desc: '瞬移到 8 格内任意可通行格，消耗当日 1/3 剩余移动力。',
  },
  // Summon Boat：本项目没有船只系统，按设计文档的预案跳过。
};

export const SPELL_ORDER = Object.keys(SPELLS);

export function getSpell(id: string): Spell {
  const s = SPELLS[id];
  if (!s) throw new Error(`unknown spell: ${id}`);
  return s;
}

/** 魔法行会 lv.N 学到的法术（全部 ≤N 级）。 */
export function spellsOfGuild(level: number): string[] {
  return SPELL_ORDER.filter((id) => SPELLS[id].level <= level);
}

/** 魔法行会建筑链定义（cost 的稀有资源是行会的存在感来源）。 */
export interface GuildLevel {
  id: string;
  name: string;
  cost: ResourceBag;
  desc: string;
}

export const GUILDS: GuildLevel[] = [
  {
    id: 'guild1',
    name: '魔法行会',
    cost: { gold: 2000, wood: 5, ore: 5 },
    desc: '解锁 1 级法术，来访英雄可学习。',
  },
  {
    id: 'guild2',
    name: '高级魔法行会',
    cost: { gold: 3000, gem: 4 },
    desc: '再解锁 2 级法术。',
  },
  {
    id: 'guild3',
    name: '大法师塔',
    cost: { gold: 4500, crystal: 4 },
    desc: '再解锁 3 级法术（火球、复活、次元门）。',
  },
];
