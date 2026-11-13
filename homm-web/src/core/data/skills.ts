/**
 * §21.9 · 副技能表（M6/H5）。
 *
 * H3 是「28 条 × 3 级 × 8 槽」，我们不抄：一局只到 8~12 级（§21.6 校准后，
 * V3 实测中位 9.5），28 选 8 的构筑在一天一局的手机会话里既不成立也不需要。
 *
 * 只抄 6 条，**每条都映射到一个既有钩子**（没有一条需要新系统）：
 *
 * | 技能 | 基础 / 高级 / 专家 | 落点 |
 * |---|---|---|
 * | 后勤 | 移动力 +10 / 20 / 30% | `hero.ts:maxMovePoints` |
 * | 箭术 | 远程伤害 +10 / 25 / 50% | `battle.ts:actShoot` |
 * | 进攻 | 近战伤害 +10 / 20 / 30% | `battle.ts:actMelee` |
 * | 防御 | 受伤 −5 / 10 / 15% | 近战/反击/射击的**受方** |
 * | 急救 | 战后复活 5 / 10 / 15% 阵亡 | `interaction.ts` 战后结算 |
 * | 巫术 | 法术伤害 +5 / 10 / 15% | `battle.ts:castSpell` |
 *
 * ⚠️ **不采用「智慧」**（§21.9）：§9.3 定的是"进城把行会自动允许的法术**全部**学会"，
 * 没有持有上限 ⇒ "每级多学 1 个、上限 3/4/5"是一条**恒等于 0 的死技能**。
 * 要么换掉它（本表），要么给法术书加上限与替换 UI —— 两者不能同时成立。
 *
 * ⚠️ **防御不与 §21.2 的防御项双算**：§21.2 的防御走 `damageMultiplier()`
 * （攻防差额进的是**攻击力对比**），本表走的是**结果减伤**，两者相乘。
 * 这是 H3 的原始关系（Armorer 与 Defense 技能是两个独立乘数），不是重复计算。
 */

export type SkillId = 'logistics' | 'archery' | 'offense' | 'defense' | 'firstAid' | 'sorcery';

export interface SkillDef {
  id: SkillId;
  name: string;
  /** 基础 / 高级 / 专家三级的**一句话效果**（弹窗与面板共用，避免两处文案漂移） */
  desc: readonly [string, string, string];
}

/** 弹窗里的固定顺序（也是"同一次 offer 只给 2 个"的取样池顺序）。 */
export const SKILL_ORDER: readonly SkillId[] = [
  'logistics',
  'archery',
  'offense',
  'defense',
  'firstAid',
  'sorcery',
];

export const SKILLS: Record<SkillId, SkillDef> = {
  logistics: { id: 'logistics', name: '后勤', desc: ['移动力 +10%', '移动力 +20%', '移动力 +30%'] },
  archery: { id: 'archery', name: '箭术', desc: ['远程伤害 +10%', '远程伤害 +25%', '远程伤害 +50%'] },
  offense: { id: 'offense', name: '进攻', desc: ['近战伤害 +10%', '近战伤害 +20%', '近战伤害 +30%'] },
  defense: { id: 'defense', name: '防御', desc: ['受伤 −5%', '受伤 −10%', '受伤 −15%'] },
  firstAid: { id: 'firstAid', name: '急救', desc: ['战后复活 5% 阵亡', '战后复活 10% 阵亡', '战后复活 15% 阵亡'] },
  sorcery: { id: 'sorcery', name: '巫术', desc: ['法术伤害 +5%', '法术伤害 +10%', '法术伤害 +15%'] },
};

/** 每条技能最高 3 级（基础 / 高级 / 专家）。 */
export const SKILL_MAX_LEVEL = 3;
/** 槽位 3 个（不是 H3 的 8 个）：5 个点分布在 3 槽上 ⇒ 典型终局 2/2/1。 */
export const SKILL_SLOTS = 3;

/**
 * 触发等级：2 / 4 / 6 / 8 / 10 级各一次，共 **5 次**二选一。
 *
 * 为什么不是"每 3 级一次"：3 槽 + 每 3 级一次 ⇒ 一局只做 3 次选择、18 格用到 3 格；
 * 而「6 条 × 3 级」需要 5 个点才点得出 2/2/1。改成 5 次之后两者才同时成立（§21.9）。
 */
export const SKILL_PICK_LEVELS: readonly number[] = [2, 4, 6, 8, 10];

/** 后勤：移动力加成（按下标 = 等级 − 1）。 */
export const LOGISTICS_MOVE = [0.1, 0.2, 0.3] as const;
/** 箭术：远程伤害乘数。 */
export const ARCHERY_MUL = [1.1, 1.25, 1.5] as const;
/** 进攻：近战伤害乘数。 */
export const OFFENSE_MUL = [1.1, 1.2, 1.3] as const;
/** 防御：受方减伤比例。 */
export const DEFENSE_REDUCE = [0.05, 0.1, 0.15] as const;
/** 急救：战后复活比例。 */
export const FIRST_AID_RATIO = [0.05, 0.1, 0.15] as const;
/** 巫术：法术伤害乘数。 */
export const SORCERY_MUL = [1.05, 1.1, 1.15] as const;

/** 取某个等级（0 = 没学）在曲线上的值；越界夹回边界，绝不返回 undefined。 */
export function curveAt(curve: readonly number[], level: number): number {
  if (level <= 0) return 0;
  const i = Math.min(curve.length, level) - 1;
  return curve[i]!;
}
