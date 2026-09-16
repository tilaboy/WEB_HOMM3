/**
 * 矿场与宝库区的配置表（M7）。
 *
 * 数值口径：一座城每日基础税收 500 金，议事堂 +250、城墙线最高 +400。
 * 所以金矿 400/天 ≈ 一座建满的城，是"值得为它打一仗"的量级；
 * 木/矿 3/天看着少，但建筑树全线的木石需求是刚性的（AI 曾卡在 dwell4 的 10 木上），
 * 稀有资源 1/天则是为了喂魔法行会（高级行会 4 宝石、大法师塔 4 水晶）——
 * 没有稳定的稀有产出，三级法术基本靠运气捡。
 */
import type { ResourceBag, ResourceKind } from '../types.js';

/** 各资源一座矿的每日产量。 */
export const MINE_PER_DAY: Record<ResourceKind, number> = {
  gold: 400,
  wood: 3,
  ore: 3,
  gem: 1,
  crystal: 1,
  sulfur: 1,
  mercury: 1,
};

/** 稀有资源：只产在远离主城的深处，也是宝库区奖励的主料。 */
export const RARE_RESOURCES: ResourceKind[] = ['gem', 'crystal', 'sulfur', 'mercury'];

/** 会直接摆在地图上的独立矿场按这个顺序铺，前面的先保证。 */
export const MINE_ORDER: ResourceKind[] = ['wood', 'ore', 'gold', 'gem', 'crystal', 'sulfur', 'mercury'];

/** 矿场的名字（HOMM 叫法：锯木场 / 采石场 / 金矿…）。 */
export const MINE_NAME: Record<ResourceKind, string> = {
  gold: '金矿',
  wood: '锯木场',
  ore: '采石场',
  gem: '宝石矿',
  crystal: '水晶矿',
  sulfur: '硫磺矿',
  mercury: '水银矿',
};

/**
 * 每座主城保底的矿：木石各一座，摆在离家 3~7 格。
 *
 * 为什么保底：这两个是建筑树的硬通货，而矿场以前只能靠打死守卫怪才掉——
 * 一个开局运气不好、附近没有守矿野怪的阵营，会被木石卡死整整一周，
 * 那种"什么都没做错但就是玩不下去"的挫败感必须消掉。
 */
export const HOME_MINE_RING = { min: 3, max: 7 };

/* ---------------- 宝库区 ---------------- */

export interface VaultDef {
  tier: 'mid' | 'strong';
  /** 守卫：宝库不打无谓的仗，守军永远比同档野怪厚一圈。 */
  army: { unitTypeId: string; count: [number, number] }[];
  reward: {
    gold: [number, number];
    /** 每种稀有资源给多少（随机取区间内） */
    rare: [number, number];
    /** 掉落宝物的概率 */
    artifactChance: number;
  };
}

export const VAULTS: Record<'mid' | 'strong', VaultDef> = {
  mid: {
    tier: 'mid',
    army: [
      { unitTypeId: 'pikeman', count: [18, 26] },
      { unitTypeId: 'archer', count: [12, 18] },
    ],
    reward: { gold: [2500, 4000], rare: [2, 3], artifactChance: 0.25 },
  },
  strong: {
    tier: 'strong',
    army: [
      { unitTypeId: 'ogre', count: [10, 14] },
      { unitTypeId: 'knight', count: [8, 12] },
      { unitTypeId: 'archer', count: [16, 24] },
    ],
    reward: { gold: [4500, 7000], rare: [3, 5], artifactChance: 0.5 },
  },
};

/** 把宝库奖励里的稀有资源摊成一份 ResourceBag。 */
export function vaultRareBundle(rng: () => number, rare: [number, number]): ResourceBag {
  const out: ResourceBag = {};
  const each = rare[0] + Math.floor(rng() * (rare[1] - rare[0] + 1));
  for (const k of RARE_RESOURCES) {
    // 不是每种都给：随机挑几种，避免"开一次宝库就再也不缺资源"
    if (rng() < 0.6) out[k] = Math.max(1, each - (rng() < 0.4 ? 1 : 0));
  }
  return out;
}
