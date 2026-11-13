/**
 * §18.3 口袋奖励池 —— **全文档唯一的奖励投放表**。
 *
 * 属性物件（§21.8）、稀有矿、宝库、地面宝物都只是这张表里的条目；
 * 家门前金矿是另一条通道（决策 43/46），**不在这里**。
 *
 * 抽取规则（规格写死，这里逐条对应）：
 *   ① 用地图 seed 的单开流 `deriveSeed(seed,'pocket',index)`，不碰现有随机流；
 *   ② 同一张图**同一件属性物件最多一次**（`usedBoosts` 由调用方累计）；
 *   ③ 权重只决定"抽到哪件"，不决定"有没有" —— 每块必出 1 件（G2 恰好 1）；
 *   ④ D3 的宝库/宝物只占 1 个槽，不与属性物件叠加。
 */
import type { ResourceKind, PocketTier } from '../types.js';
import { STAT_BOOSTS } from './statBoosts.js';

export type { PocketTier };

export interface PocketTierDef {
  tier: PocketTier;
  /** 距**最近主城**的曼哈顿格数（§18.3 表） */
  minDist: number;
  maxDist: number;
  /** 入口守卫档位 */
  guard: 'weak' | 'mid' | 'strong';
}

export const POCKET_TIERS: Record<PocketTier, PocketTierDef> = {
  D1: { tier: 'D1', minDist: 6, maxDist: 9, guard: 'weak' },
  D2: { tier: 'D2', minDist: 10, maxDist: 15, guard: 'mid' },
  D3: { tier: 'D3', minDist: 16, maxDist: 999, guard: 'strong' },
};

export const POCKET_TIER_ORDER: PocketTier[] = ['D1', 'D2', 'D3'];

export type PocketReward =
  | { kind: 'mine'; resource: ResourceKind }
  | { kind: 'statBoost'; boostId: string }
  | { kind: 'vault'; tier: 'mid' | 'strong' }
  | { kind: 'artifact' };

interface Weighted {
  w: number;
  make: () => PocketReward;
}

/** 四件 +1 属性物件（D1 池） */
const D1_BOOSTS = ['camp_attack', 'tower_defense', 'star_axis', 'garden_knowledge'];

const TABLE: Record<PocketTier, Weighted[]> = {
  D1: [
    { w: 55, make: () => ({ kind: 'mine', resource: 'gold' }) },
    ...D1_BOOSTS.map((id) => ({
      w: 45 / D1_BOOSTS.length,
      make: (): PocketReward => ({ kind: 'statBoost', boostId: id }),
    })),
  ],
  D2: [
    { w: 12.5, make: () => ({ kind: 'mine', resource: 'gem' }) },
    { w: 12.5, make: () => ({ kind: 'mine', resource: 'crystal' }) },
    { w: 12.5, make: () => ({ kind: 'mine', resource: 'sulfur' }) },
    { w: 12.5, make: () => ({ kind: 'mine', resource: 'mercury' }) },
    { w: 30, make: () => ({ kind: 'statBoost', boostId: 'arena' }) },
    /**
     * §18.3 的 D2 只写了「斗士学院（1,000 金 +1）20%」，但 §21.8 列了 **9 种**物件，
     * 其中「魔法学校（1,000 金 +1 力量）」在 §18.3 里没有位置 ⇒ 定义存在、永远刷不出来
     * （探针 H0 把它抓出来了）。处理：把那一档的 20% **对半劈**成斗士学院 / 魔法学校。
     *
     * 为什么可以劈：两者是同一价值量级（+1 四维、1,000 金、每英雄一次），
     * 期望收益**逐点不变** ⇒ V4「每图 ≥1.15」不受影响，只是口味从"只有攻"变成"攻/魔二选一"。
     * ⚠️ 若主理人要严格照抄 §18.3，另一条路是删掉 `magic_school` 的定义（9 种变 8 种），
     *    不能两个都要。
     */
    { w: 10, make: () => ({ kind: 'statBoost', boostId: 'fighters_guild' }) },
    { w: 10, make: () => ({ kind: 'statBoost', boostId: 'magic_school' }) },
  ],
  D3: [
    { w: 40, make: () => ({ kind: 'vault', tier: 'strong' }) },
    { w: 20, make: () => ({ kind: 'artifact' }) },
    { w: 20, make: () => ({ kind: 'statBoost', boostId: 'library' }) },
    { w: 20, make: () => ({ kind: 'statBoost', boostId: 'wisdom_tree' }) },
  ],
};

/** 只读表（探针用它核对"奖励 ∈ 池"，不另抄一份）。 */
export function pocketRewardTable(tier: PocketTier): ReadonlyArray<{ w: number; reward: PocketReward }> {
  return TABLE[tier].map((e) => ({ w: e.w, reward: e.make() }));
}

/**
 * 按权重抽一件。`usedBoosts` 里已有的属性物件会被**剔除再归一化**
 * （同一张图同一件最多一次；剩下全是属性物件时也不会抽空）。
 */
export function rollPocketReward(
  tier: PocketTier,
  rng: () => number,
  usedBoosts: Set<string>,
): PocketReward {
  const pool = TABLE[tier].filter((e) => {
    const r = e.make();
    return r.kind !== 'statBoost' || !usedBoosts.has(r.boostId);
  });
  const list = pool.length ? pool : TABLE[tier];
  const total = list.reduce((s, e) => s + e.w, 0);
  let roll = rng() * total;
  for (const e of list) {
    roll -= e.w;
    if (roll <= 0) return e.make();
  }
  return list[list.length - 1].make();
}

/** 文案（交互框/文档共用）。 */
export function describePocketReward(r: PocketReward): string {
  switch (r.kind) {
    case 'mine':
      return `${r.resource} 矿`;
    case 'statBoost':
      return STAT_BOOSTS[r.boostId]?.name ?? r.boostId;
    case 'vault':
      return '宝库';
    case 'artifact':
      return '地面宝物';
  }
}
