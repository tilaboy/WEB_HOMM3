/**
 * §21.8 地图上的永久加属性物件（H3 有 9 种，我们此前 **0 种**）。
 *
 * 这一张表同时是**文案源**、**结算源**和**探针的判据源** —— 探针读 `STAT_BOOSTS`
 * 去核对口袋奖励，不允许再抄一遍 id 列表（铁律：尺子不许手抄引擎常量）。
 *
 * 三条口径写死在这里：
 *   ① 每英雄一次 —— 靠 `MapObject.visitedBy` 记 `hero.id`（**不是** owner），
 *      同一玩家换一个英雄再来，还能再拿一次；
 *   ② 生成期就定死 `boostId` 并进存档，**不许"走上去才抽"**（§18.3 第 5 条）；
 *   ③ `requireLevel` / `cost` 不满足时**无收益且不消耗**，交互框只说差什么。
 */
import type { HeroPrimary } from '../types.js';

export type StatKey = keyof HeroPrimary;

export interface StatBoostDef {
  id: string;
  /** 全名（交互框标题） */
  name: string;
  /** 半句效果，用于 aria / 日志 */
  effect: string;
  /** 永久加成。省略 = 只升等级（智慧树）。 */
  stats?: Partial<HeroPrimary>;
  /** 金币 / 宝石代价。省略 = 免费。 */
  cost?: { gold?: number; gem?: number };
  /** 等级门槛（智者图书馆 10 级）。 */
  requireLevel?: number;
  /** 智慧树：直接 +1 级。 */
  levelUp?: boolean;
  /** 地图图标按哪一维上色（4 帧：attack/defense/spellPower/knowledge）。 */
  iconStat: StatKey;
  /** 图标上叠的圆点数（+1 一个、+2 两个）—— 与颜色一起表达"加多少"。 */
  pips: number;
}

export const STAT_BOOSTS: Record<string, StatBoostDef> = {
  camp_attack: {
    id: 'camp_attack',
    name: '雇佣兵营帐',
    effect: '攻击 +1',
    stats: { attack: 1 },
    iconStat: 'attack',
    pips: 1,
  },
  tower_defense: {
    id: 'tower_defense',
    name: '马力特塔',
    effect: '防御 +1',
    stats: { defense: 1 },
    iconStat: 'defense',
    pips: 1,
  },
  star_axis: {
    id: 'star_axis',
    name: '星轴',
    effect: '魔力 +1',
    stats: { spellPower: 1 },
    iconStat: 'spellPower',
    pips: 1,
  },
  garden_knowledge: {
    id: 'garden_knowledge',
    name: '真理之园',
    effect: '知识 +1',
    stats: { knowledge: 1 },
    iconStat: 'knowledge',
    pips: 1,
  },
  fighters_guild: {
    id: 'fighters_guild',
    name: '斗士学院',
    effect: '攻击 +1（学费 1000 金）',
    stats: { attack: 1 },
    cost: { gold: 1000 },
    iconStat: 'attack',
    pips: 1,
  },
  magic_school: {
    id: 'magic_school',
    name: '魔法学校',
    effect: '魔力 +1（学费 1000 金）',
    stats: { spellPower: 1 },
    cost: { gold: 1000 },
    iconStat: 'spellPower',
    pips: 1,
  },
  arena: {
    id: 'arena',
    name: '竞技场',
    effect: '攻击 +2',
    stats: { attack: 2 },
    iconStat: 'attack',
    pips: 2,
  },
  library: {
    id: 'library',
    name: '智者图书馆',
    effect: '四维各 +2（需 10 级）',
    stats: { attack: 2, defense: 2, spellPower: 2, knowledge: 2 },
    requireLevel: 10,
    iconStat: 'knowledge',
    pips: 2,
  },
  wisdom_tree: {
    id: 'wisdom_tree',
    name: '智慧树',
    effect: '直接 +1 级（2000 金）',
    cost: { gold: 2000 },
    levelUp: true,
    iconStat: 'knowledge',
    pips: 1,
  },
};

export const STAT_BOOST_IDS = Object.keys(STAT_BOOSTS);

/** 互动框/日志共用的一行"效果 + 代价"，避免两处各写一份文案。 */
export function describeStatBoost(def: StatBoostDef): string {
  const parts = [def.effect];
  return parts.join(' · ');
}
