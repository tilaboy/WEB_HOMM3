/**
 * §21.6 经验曲线常量（H3 · M6/H3）。
 *
 * ## 权威表
 *
 * H3 的 **累计经验阈值**（不是每级跨度）：
 * <https://homm.fandom.com/wiki/Experience>，1~21 级为
 * `0, 1000, 2000, 3200, 4600, 6200, 8000, 10000, 12200, 14700, 17500,
 *  20600, 24320, 28784, 34140, 40567, 48279, 57533, 68637, 81961, 97949`。
 * §21.6 的两个锚点（2 级 1,000 / 20 级 81,961）逐位对得上。
 *
 * ⚠️ §21.6 那张对照表把「10 级」写成 12,200，其实是**上表的 9 级**；
 * 10 级应为 14,700。这里以 H3 原表为准，探针 `probe:herogrowth` 会打印
 * 2/4/6/8/10/20 六个锚点，避免再把 off-by-one 抄回代码。
 *
 * ## 为什么存「跨度」而不是「累计」
 *
 * `core/game/hero.ts` 的 `gainExp` 把 `hero.exp` 当作**本级内的余量**：
 * `while (exp >= expToNext(level)) { exp -= expToNext(level); level++ }`。
 * 所以 `expToNext` 的契约是「本级 → 下一级的跨度」，直接塞累计表会让
 * 每一级都按整段历史收费，曲线被悄悄抬高一个数量级。
 * 这里由累计表**差分一次**生成 20 行跨度，是唯一真相源。
 *
 * ## k
 *
 * 规格默认 `k = 0.5`（按 35 天一局校准，判据 V3：第 35 天 8~12 级）。
 * k 与表分开放，调平衡只动这一个数；**不要在别处再写一份曲线**。
 */

/** 35 天一局的缩放系数。调等级节奏只改这里。 */
export const EXP_CURVE_K = 0.5;

/** H3 累计经验阈值，下标 0 = 1 级（0）。刻意保留 21 级用于差分最后一行。 */
export const H3_EXP_CUMULATIVE: readonly number[] = [
  0, 1000, 2000, 3200, 4600, 6200, 8000, 10000, 12200, 14700, 17500,
  20600, 24320, 28784, 34140, 40567, 48279, 57533, 68637, 81961, 97949,
];

/** 20 行跨度：`H3_EXP_STEPS[level - 1]` = 从 `level` 升到 `level + 1` 所需经验。 */
export const H3_EXP_STEPS: readonly number[] = H3_EXP_CUMULATIVE.slice(1).map(
  (v, i) => v - H3_EXP_CUMULATIVE[i]!,
);

/**
 * 21 级以后沿用 H3 的 ~20% 递增（21→22 的 19,185 / 20→21 的 15,988 = 1.200），
 * 不让高等级卡死在最后一行的常数上。
 */
export const H3_EXP_TAIL_RATIO = 1.2;

/** 未缩放的第 `level` 级跨度。纯函数，给探针与旧曲线负向对照共用。 */
export function h3ExpStep(level: number): number {
  const i = Math.max(1, Math.floor(level)) - 1;
  if (i < H3_EXP_STEPS.length) return H3_EXP_STEPS[i]!;
  return Math.round(
    H3_EXP_STEPS[H3_EXP_STEPS.length - 1]! * Math.pow(H3_EXP_TAIL_RATIO, i - H3_EXP_STEPS.length + 1),
  );
}

/**
 * §21.6 之前的旧曲线（**只作负向对照**，不在运行时调用）。
 * `100 × level^1.8`：2 级只要 100，L2→L10 却涨 195× —— 前期暴富后期停滞。
 */
export function legacyExpStep(level: number): number {
  return Math.round(100 * Math.pow(Math.max(1, Math.floor(level)), 1.8));
}
