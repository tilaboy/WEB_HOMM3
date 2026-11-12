/**
 * §11.2 施法时序：**总 800ms = 前摇 180 + 演出 420 + 结算 200**。
 *
 * 为什么单独成一个模块：这三段边界是**对外承诺**（"点击可跳到结算，但不跳过伤害"），
 * 必须有断言。探针 import 这里的常量与 `castFrame()`，不在探针里重抄 180/420/200 ——
 * 抄一份就是第二真值来源，改了一处另一处静默过期（铁律 13 的同族病）。
 *
 * 三个语义（判据就挂在它们上面）：
 *   · `windup` —— 目标格 1px 描边亮、施法方出 atk 帧；**伤害还没结算**；
 *   · `show`   —— 模板演出（弹体飞行 / 折线 / 符文…）；
 *   · `settle` —— 伤害浮字 + 目标抖动。**只在这一段发生，且只发生一次**。
 *
 * 时长按 `anim.t`（毫秒，已乘演出倍率）算：倍率是玩家偏好，边界不随倍率漂移。
 */
export const CAST_WINDUP_MS = 180;
export const CAST_SHOW_MS = 420;
export const CAST_SETTLE_MS = 200;
export const CAST_TOTAL_MS = CAST_WINDUP_MS + CAST_SHOW_MS + CAST_SETTLE_MS;

/** 演出段结束、结算开始的时刻（= 800 − 200）。 */
export const CAST_SETTLE_AT_MS = CAST_WINDUP_MS + CAST_SHOW_MS;

export type CastPhase = 'windup' | 'show' | 'settle' | 'done';

export interface CastFrame {
  phase: CastPhase;
  /** 演出段进度 0→1（前摇恒 0，结算/结束恒 1）。 */
  show: number;
  /** **本段**进度 0→1（前摇的描边淡入、结算的抖动用它）。 */
  local: number;
  /** 前摇：目标格描边 + 施法方抬手。 */
  windup: boolean;
  /** 结算：伤害浮字 + 目标抖动（调用方用 `settled` 守成一次性）。 */
  settle: boolean;
}

export function castFrame(ms: number): CastFrame {
  const t = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (t < CAST_WINDUP_MS) {
    return { phase: 'windup', show: 0, local: t / CAST_WINDUP_MS, windup: true, settle: false };
  }
  if (t < CAST_SETTLE_AT_MS) {
    const k = (t - CAST_WINDUP_MS) / CAST_SHOW_MS;
    return { phase: 'show', show: k, local: k, windup: false, settle: false };
  }
  if (t < CAST_TOTAL_MS) {
    return { phase: 'settle', show: 1, local: (t - CAST_SETTLE_AT_MS) / CAST_SETTLE_MS, windup: false, settle: true };
  }
  return { phase: 'done', show: 1, local: 1, windup: false, settle: true };
}
