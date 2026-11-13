import type { HeroClassId } from './heroes.js';

/**
 * §21.10 · 英雄特长（M6/H6）—— 四个小钩子，无新数据表。
 *
 * H3 是"每英雄一个特长、多为某技能/某兵种随等级 +5%"。我们四个英雄各一个，
 * **全部绑在已有钩子上**：这是「四个英雄不一样」最便宜的表达，比四维更明显
 * （四维要 10 级才看出差距，特长第 1 回合就在）。
 *
 * | 英雄 | 特长 | 落点 |
 * |---|---|---|
 * | p1 阿尔文（骑士） | 纪律：第 1 回合全军攻 +1（5 级起 +2） | `strikeAtkBonus` / `retaliationAtkBonus` |
 * | p2 格罗姆（野蛮人） | 蛮勇：近战伤害 +5% / 每 4 级（上限 +25%） | `actMelee` |
 * | p3 艾莉亚（游侠） | 林地：草地移动消耗 −25% | `pathfinding.stepCostOn` |
 * | p4 塞拉菲（牧师） | 祷言：每天第一场战斗的第一次施法不耗蓝 | `castSpell` |
 *
 * ⚠️ **p4 这条在 2026-10-29 改过一次**（§21.10 原文留痕）：原写"每日额外回 2+等级/3 法力"，
 * 但决策 39 是**每天回满**，在回满机制下"额外回蓝"恒等于 0（满蓝再加还是满）。
 * 这是"两个各自正确的决定叠成空操作"的标本 —— 凡是写"回复 / 加速 / 叠加"的特长，
 * 先确认底层是不是已经封顶。
 *
 * ⚠️ 特长**跟职业走**（副英雄用别的模板时也成立），不跟英雄 id 走：
 * 四个招牌英雄的职业恰好一一对应，写成 id 表会让"招到同职业的副英雄却没有特长"。
 */

export type SpecialtyId = 'discipline' | 'ferocity' | 'woodland' | 'prayer';

export interface SpecialtyDef {
  id: SpecialtyId;
  name: string;
  /** 面板与弹窗用的一句话 */
  text: string;
}

export const SPECIALTIES: Record<SpecialtyId, SpecialtyDef> = {
  discipline: { id: 'discipline', name: '纪律', text: '战斗第 1 回合全军攻 +1（5 级起 +2）' },
  ferocity: { id: 'ferocity', name: '蛮勇', text: '近战伤害 +5% / 每 4 级（上限 +25%）' },
  woodland: { id: 'woodland', name: '林地', text: '草地移动消耗 −25%' },
  prayer: { id: 'prayer', name: '祷言', text: '每天第一场战斗的第一次施法不耗蓝' },
};

/** 职业 → 特长（p1 骑士 / p2 野蛮人 / p3 游侠 / p4 牧师）。 */
export const SPECIALTY_OF_CLASS: Record<HeroClassId, SpecialtyId> = {
  knight: 'discipline',
  barbarian: 'ferocity',
  ranger: 'woodland',
  cleric: 'prayer',
};

/** 「纪律」：第 1 回合的攻加成；5 级起 +2。 */
export const DISCIPLINE_ATK = 1;
export const DISCIPLINE_ATK_ELITE = 2;
export const DISCIPLINE_ELITE_LEVEL = 5;

/** 「蛮勇」：每 4 级 +5%，上限 +25%。 */
export const FEROCITY_PER_STEP = 0.05;
export const FEROCITY_STEP_LEVELS = 4;
export const FEROCITY_CAP = 0.25;

/** 「林地」：草地移动消耗乘数。 */
export const WOODLAND_GRASS_MUL = 0.75;
