/**
 * 攻城器械（HOMM3 的 war machines 简化版）。
 *
 * 只做两件，因为只有这两件直接改变攻城的决策：
 *   - **投石车**：唯一能隔着护城河砸城防的东西。没有它，攻方只能让步兵贴上去用兵器砍墙，
 *     一边挨箭塔一边砍 —— 这正是"该不该造投石车"这个问题的来源。
 *   - **弩车**：每回合自动补一发，相当于多带一个不会死的弓手。
 *
 * HOMM3 里还有弹药车（射手无限弹药）和急救帐篷（每回合治疗），
 * 这两件是纯数值增益、不改变决策，先不做。
 *
 * 简化取舍：器械**不是战场单位** —— 不能被瞄准、不会占格、不会死。
 * 它们在每回合开始自动开火（和箭塔对称）。只有英雄战败才会失去器械。
 * HOMM3 里器械是可以被打掉的，但那样会逼出"用先手秒掉投石车"的固定套路，
 * 对本作这个规模来说不值得。
 */
import type { ResourceBag } from '../types.js';

export type WarMachineId = 'catapult' | 'ballista';

export interface WarMachineDef {
  id: WarMachineId;
  name: string;
  desc: string;
  cost: ResourceBag;
  /** 每回合开火的伤害区间。 */
  damageMin: number;
  damageMax: number;
  /** 参与攻防修正的攻击力。 */
  attack: number;
  /** 打城防还是打部队。 */
  target: 'fortification' | 'unit';
}

export const WAR_MACHINES: Record<WarMachineId, WarMachineDef> = {
  catapult: {
    id: 'catapult',
    name: '投石车',
    desc: '每回合自动轰击城墙：优先砸城门，城门塌了改砸城墙。没有它，攻城只能让步兵贴上去砍墙。',
    cost: { gold: 1500, wood: 8, ore: 8 },
    damageMin: 70,
    damageMax: 110,
    attack: 8,
    target: 'fortification',
  },
  ballista: {
    id: 'ballista',
    name: '弩车',
    desc: '每回合自动射击守军威胁最高的一支队伍，相当于多带一个不会死的弓手。',
    cost: { gold: 1000, wood: 6 },
    damageMin: 24,
    damageMax: 36,
    attack: 6,
    target: 'unit',
  },
};

export const WAR_MACHINE_IDS: WarMachineId[] = ['catapult', 'ballista'];

export function warMachine(id: WarMachineId): WarMachineDef {
  return WAR_MACHINES[id];
}

/** 名字表，UI 与日志用。 */
export const WAR_MACHINE_NAME: Record<WarMachineId, string> = {
  catapult: '投石车',
  ballista: '弩车',
};
