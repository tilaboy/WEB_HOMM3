/**
 * 矿场与宝库区的配置表（M7）。
 *
 * 数值口径（2026-10-31 B3a 后）：一座城每日基础税收 **600** 金，议事堂 **+450**，
 * 家门前金矿 **+400**（满建 **1,450/天**）。城墙线**不产金**（§27.3）。
 * 金矿 400/天 ≈ 1.5 座城的税收，是"值得为它打一仗"的量级；
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

/**
 * 家门前金矿的守卫规模 —— **按阵营**，因为四族的开局 T2 不是同一把尺子。
 *
 * 为什么不是 `monsterArmy(rng,'weak')`（20~28 狼）：实测（2026-10-31，24 种子，
 * `quickBattle`，英雄攻/防按各族模板）——
 *
 * | 阵营 | 开局 20 兵 | 20~28 狼时战损 | 结论 |
 * |---|---|---|---|
 * | p1 | `p1_crossbow`（远程） | 3% ~ 13% | 太软，进不了 G-M1 的 20~30% |
 * | p3 | `p3_junglearcher`（远程） | 12% ~ 24% | 勉强 |
 * | p2 | `p2_bronze`（近战·慢） | **35% ~ 54%** | 直接打崩 |
 * | p4 | `p4_zombie`（近战） | **41% ~ 61%** | 直接打崩 |
 *
 * 一个数字不可能同时让"远程 20 队"和"近战 20 队"都掉 25% 血 ——
 * 所以按族给区间，**目标都是：100% 胜、战损 20~30%**（G-M1）。
 * 调的是"几只狼"，不是狼的属性：野怪面板必须和野外 `weak` 档完全一致，
 * 否则玩家会看到"同样的狼、家门口的更凶"，而 UI 无从解释。
 *
 * ⚠️ **不吃 `monsterMul`**（难度倍率）：这不是难度杠杆，是"第一桶金"的入口。
 * 若困难档把狼乘到 1.25×，p4 的家门金矿第一天就打不过 ⇒ day3 夺矿的整条
 * 5 周预算（`econ-check` 的 MINE_DAY=3）在困难档直接失效。
 */
export const HOME_GOLD_GUARD: Record<'p1' | 'p2' | 'p3' | 'p4', { min: number; max: number }> = {
  p1: { min: 31, max: 34 },
  p2: { min: 19, max: 22 },
  p3: { min: 30, max: 32 },
  p4: { min: 18, max: 20 },
};

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

/**
 * 宝库守军。
 *
 * ⚠️ 这里用**canonical id**（`p1_*`），不许再写 `pikeman` / `archer` / `knight`
 * 这类旧版 H3 id。旧 id 只留给 `LEGACY_UNIT_IDS` 读旧档用；一旦出现在生成器里，
 * 宝库战斗就会画出旧 H3 立绘 —— 那是四族美术之外的东西（见
 * `production/ui-redesign-2026-10-28/spec-implementation.md` §4 未决 5）。
 *
 * 映射沿用 `LEGACY_UNIT_IDS` 的既有口径（旧兵整体归 p1 晨曦），B1 后按**同档**改指新兵：
 *   pikeman → **p1_eagle**（旧 T3 → 新 T3）· archer → **p1_crossbow** · knight → **p1_knight**
 * ⇒ 叙事上读作「晨曦骑士团留下的旧宝库」，四族都会遇到同一批守卫。
 *
 * ⚠️ 守军是**按旧兵的强度**配的数量（18~26 枪兵），而新 T3 是鹰（HP 14 vs 旧 20）。
 * 数量没跟着重算 ⇒ 宝库比 v7 略软。**这是已知的暂时态**：宝库难度没有独立闸，
 * 由 B5 的首轮基线（A1–A6）一起读；要调也只调 `count`，不要在这里塞第三个兵种。
 */
export const VAULTS: Record<'mid' | 'strong', VaultDef> = {
  mid: {
    tier: 'mid',
    army: [
      { unitTypeId: 'p1_eagle', count: [18, 26] },
      { unitTypeId: 'p1_crossbow', count: [12, 18] },
    ],
    reward: { gold: [2500, 4000], rare: [2, 3], artifactChance: 0.25 },
  },
  strong: {
    tier: 'strong',
    army: [
      { unitTypeId: 'ogre', count: [10, 14] },
      { unitTypeId: 'p1_knight', count: [8, 12] },
      { unitTypeId: 'p1_crossbow', count: [16, 24] },
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
