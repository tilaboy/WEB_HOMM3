import type { UnitType } from '../types.js';
import { randInt } from '../rng.js';

/**
 * 攻防倍率 —— **两个口径，别混**（2026-10-29 H1 落地时定死）。
 *
 * ## 1) 实战：`damageMultiplier()` = H3 的分段式（决策 32）
 *
 *   差额 Δ = 攻 − 防
 *     Δ ≥ 0 → `1 + 0.05 × Δ`        （攻每高 1 点 +5%）
 *     Δ < 0 → `1 / (1 + 0.025 × |Δ|)`（防每高 1 点，**伤害少 2.5%**）
 *   整体夹在 `[0.3, 4.0]`。
 *
 * 和旧版（HoMM2 对称 ±5%）的差别**只在 Δ<0 那一半**：从 5%/点 改成 2.5%/点。
 * Δ≥0 那一半逐字不变 —— 这是"高攻真的有用、高防没那么神"的 H3 手感。
 *
 * ⚠️ **不要改成"攻侧倍率 ÷ 防侧倍率"**。那种写法看起来更"对称"，但它把参考点从
 * **差额**换成了**绝对 5 点**：弓手（4 攻）打野狼（1 防）会从 1.15 掉到 0.864（−25%），
 * 开局中立城直接变成陷阱。2026-10-29 实测过：`smoke` 里"20 弓手打 21 狼 + 11 猪"
 * 的胜率从绿色掉到 **21%**（门要求 40~95%）。那条红是**实现错**，不是读数该变。
 *
 * ## 2) 估值：`attackMultiplier()` / `defenseMultiplier()` + `powerRef()`（决策 49 的 B 口径）
 *
 * 这把尺子回答的是"这个兵值多少"，**参考对手固定为 5 攻 / 5 防**，所以必须拆成两侧：
 *
 *   攻侧 `min(1 + 0.05 × (攻 − 5), 4.0)`，防侧 `max(1 − 0.025 × (防 − 5), 0.3)`
 *   战力 = 平均伤害 × HP × 攻侧 / 防侧
 *
 * 它和实战公式**故意不同**：尺子要有"绝对强弱"，实战要有"相对强弱"。
 * 两者的排序一致（同一套 5%/2.5% 斜率），但数值不等 —— 所以 **`powerRef()` 只能用来估值，
 * 不许拿它冒充伤害**；反过来也不许把 `damageMultiplier()` 塞进 `aiValue`。
 */
export function damageMultiplier(attack: number, defense: number): number {
  const diff = attack - defense;
  const mod = diff >= 0 ? 1 + 0.05 * diff : 1 / (1 - 0.025 * diff);
  return Math.min(Math.max(mod, 0.3), 4.0);
}

/** 估值用：攻侧倍率（参考对手 5 攻）。**不是伤害倍率**。 */
export function attackMultiplier(attack: number): number {
  return Math.min(1 + 0.05 * (attack - 5), 4.0);
}

/** 估值用：防侧减伤（参考对手 5 防）。**不是伤害倍率**。 */
export function defenseMultiplier(defense: number): number {
  return Math.max(1 - 0.025 * (defense - 5), 0.3);
}

/**
 * 单兵战力（P2 / B 口径的落地版）。
 *
 * 这是 `aiValue`（B1 批）与 `spec-implementation.md §16.2 / §25.3` 所有读数的唯一来源；
 * **不要在 `ai.ts`、`town.ts` 或工具里再抄一份公式**。
 *
 * 本作实测区间（决策 56：攻防不拉宽到 1~25）：攻 1~12 ⇒ 0.80~1.35；防 1~10 ⇒ 1.10~0.875。
 * 两个 clamp（4.0 要攻 65、0.3 要防 33）在本作里**永远触发不到**，它们是代码正确性保证，不是设计参数。
 *
 * 负向对照：`powerRef(小孩)` 必须读 **3.3**；若读 4.5，说明有人把两端夹到 1 的 A 口径加回来了。
 */
export function powerRef(u: Pick<UnitType, 'attack' | 'defense' | 'damageMin' | 'damageMax' | 'hp'>): number {
  const avg = (u.damageMin + u.damageMax) / 2;
  return (avg * u.hp * attackMultiplier(u.attack)) / defenseMultiplier(u.defense);
}

export function rollDamage(
  rng: () => number,
  attacker: UnitType,
  count: number,
  attackBonus: number,
  defender: UnitType,
  defenseBonus: number,
): number {
  const raw = randInt(rng, attacker.damageMin, attacker.damageMax) * count;
  const mod = damageMultiplier(attacker.attack + attackBonus, defender.defense + defenseBonus);
  return Math.max(1, Math.round(raw * mod));
}
