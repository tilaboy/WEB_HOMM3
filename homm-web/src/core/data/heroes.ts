import type { HeroPrimary, Stack } from '../types.js';
import { unitIdForTier } from './units.js';

export const HERO_TEMPLATES: {
  id: string;
  name: string;
  className: string;
  portrait: string;
  primary: HeroPrimary;
  /**
   * 酒馆招募时带的兵**数量** —— 兵种**不写死在这里**：
   * 四个模板带的都是同一批兵，只有数量不同（20 / 8 / 8 / 8），
   * 兵种一律由 `startArmyFor(owner, count)` 按阵营解析（段 2）。
   */
  startArmyCount: number;
}[] = [
  {
    id: 'knight',
    name: '阿尔文',
    className: '骑士',
    portrait: '#4a7fb5',
    primary: { attack: 1, defense: 2, spellPower: 1, knowledge: 1 },
    startArmyCount: 20,
  },
  {
    id: 'ranger',
    name: '艾莉亚',
    className: '游侠',
    portrait: '#3f8f5a',
    primary: { attack: 2, defense: 1, spellPower: 1, knowledge: 1 },
    startArmyCount: 8,
  },
  {
    id: 'cleric',
    name: '塞拉菲',
    className: '牧师',
    portrait: '#8a6fbf',
    primary: { attack: 1, defense: 1, spellPower: 2, knowledge: 2 },
    startArmyCount: 8,
  },
  {
    id: 'barbarian',
    name: '格罗姆',
    className: '野蛮人',
    portrait: '#b06a3a',
    primary: { attack: 2, defense: 2, spellPower: 1, knowledge: 1 },
    startArmyCount: 8,
  },
];

/**
 * 起始部队的 tier = **2**。
 *
 * 旧 `START_ARMY` 是「20 弓手」，而弓手在 canonical 表里是 **T2**
 * （`archer → p1_hornxbow`）。所以对齐 T2 才是**零平衡改动**的换法；
 * 换成 T1 会把开局战力从「角弓」降到「灯侍」，那是实打实的削弱 ——
 * `design/difficulty-spec.md` 明写「不动 START_ARMY（20 弓手）」，
 * 本函数改的只是**哪个阵营的** T2，不是 tier、也不是总量。
 */
export const START_ARMY_TIER = 2;
/** 起始部队总量（沿用旧 20 弓手的基准）。 */
export const START_ARMY_COUNT = 20;

/**
 * 起始部队（段 2）：**按 owner 解析**到本族 canonical 兵种。
 *
 * 四族开局各带各的兵 —— 写死 `archer` 会让赤焰/翠林/紫晶的英雄一出场就扛着
 * 晨曦的角弓，这正是「四族兵种都一样」抱怨的一部分。
 *
 * ⚠️ **中立 / 未知 owner：返回空数组并记日志，绝不 fallback 到 p1**
 * （`units.ts:255-258` 规则 5）。合同写在注释里、由 smoke 断言守住：
 * 调用方拿到的是「0 兵」而不是「错阵营的兵」。当前实际不可达
 * （只有有主城镇能招英雄，中立城 `buildings: []` 没有酒馆）。
 */
export function startArmyFor(owner: string, count: number = START_ARMY_COUNT): Stack[] {
  if (count <= 0) return [];
  const id = unitIdForTier(owner, START_ARMY_TIER);
  if (!id) {
    console.warn(
      `[heroes] startArmyFor: owner=${owner} 解析不出 T${START_ARMY_TIER} 的兵种，返回空部队（按规则 5 不 fallback 到 p1）`,
    );
    return [];
  }
  return [{ unitTypeId: id, count }];
}
