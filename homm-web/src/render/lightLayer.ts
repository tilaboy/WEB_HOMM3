/**
 * 光照层：给冒险地图加"时间感"。
 *
 * SoC 的画面氛围很大程度来自光照——同样的地形，清晨的暖金和深夜的
 * 冷蓝完全是两种情绪。这里用最低成本的做法：一张全屏 multiply
 * 叠色 + 暗角，不开新画布、不动地形层。
 *
 * 两个刻意的设计约束：
 * 1) 周期跟真实时间走（约 4 分钟一轮），不跟游戏内"天"走。
 *    游戏里的"天"是回合，点一次"结束一天"地图闪一下会非常出戏；
 *    真实时间的缓慢流转则几乎察觉不到在变化，只觉得"画面是活的"。
 * 2) 深夜最多压到 55% 亮度。这是策略游戏不是恐怖游戏，
 *    任何时候都不能影响读图（资源堆、敌人、路径都要看得清）。
 */

export interface LightTint {
  /** multiply 叠色（白 = 无效果） */
  r: number;
  g: number;
  b: number;
  /** 暖色辉光强度（清晨/黄昏的正橘光），0 = 无 */
  warm: number;
}

/** 一个完整昼夜周期的时长（毫秒）。 */
export const LIGHT_CYCLE_MS = 4 * 60 * 1000;

/**
 * 昼夜关键帧（按相位 0~1 排序）：
 * 清晨 → 正午 → 黄昏 → 深夜 → 回到清晨。
 * rgb 是 multiply 叠色；warm 是额外叠加的暖光强度。
 */
const KEYFRAMES: { t: number; tint: LightTint }[] = [
  { t: 0.0, tint: { r: 255, g: 240, b: 214, warm: 0.10 } }, // 清晨：淡金
  { t: 0.22, tint: { r: 255, g: 255, b: 255, warm: 0 } }, // 正午：纯白（无效果）
  { t: 0.5, tint: { r: 255, g: 214, b: 168, warm: 0.16 } }, // 黄昏：橘暖
  { t: 0.68, tint: { r: 148, g: 164, b: 208, warm: 0 } }, // 深夜：冷蓝（压到 ~58%）
  { t: 0.86, tint: { r: 208, g: 208, b: 226, warm: 0.04 } }, // 黎明前：青灰回升
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 余弦缓动：关键帧之间平滑过渡，避免线性插值的"折点感"。 */
function smooth(t: number): number {
  return (1 - Math.cos(t * Math.PI)) / 2;
}

/**
 * 取某个相位（0~1）的光照参数。纯函数，方便进 smoke 测试。
 * 相位可以从 LIGHT_CYCLE_MS 对真实时间取模得到。
 */
export function lightTintAt(phase: number): LightTint {
  const p = ((phase % 1) + 1) % 1;
  let hi = 0;
  while (hi < KEYFRAMES.length - 1 && KEYFRAMES[hi + 1].t <= p) hi++;
  const a = KEYFRAMES[hi];
  const b = KEYFRAMES[(hi + 1) % KEYFRAMES.length];
  const span = hi === KEYFRAMES.length - 1 ? 1 - a.t + b.t : b.t - a.t;
  const local = smooth(((p - a.t + 1) % 1) / span);
  return {
    r: Math.round(lerp(a.tint.r, b.tint.r, local)),
    g: Math.round(lerp(a.tint.g, b.tint.g, local)),
    b: Math.round(lerp(a.tint.b, b.tint.b, local)),
    warm: lerp(a.tint.warm, b.tint.warm, local),
  };
}

/** 当前真实时间对应的光照。 */
export function lightTintNow(nowMs: number): LightTint {
  return lightTintAt(nowMs / LIGHT_CYCLE_MS);
}

/* ---------------- 调试相位覆盖 ---------------- */

let phaseOverride: number | null = null;

/** 调试：?devlight=0.68 锁定光照相位（截图/调色用），null 恢复真实时间。 */
export function setLightPhaseOverride(phase: number | null): void {
  phaseOverride = phase;
}

/** MapRenderer 每帧取光照的唯一入口（覆盖优先于真实时间）。 */
export function currentLightTint(nowMs: number): LightTint {
  return phaseOverride !== null ? lightTintAt(phaseOverride) : lightTintNow(nowMs);
}

/* ---------------- localStorage 开关 ---------------- */

const KEY = 'homm.lighting';

/** 光照开关：默认开。存 localStorage，下局沿用。 */
export function lightingOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setLightingOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* 无痕模式等场景下写不进去就算了 */
  }
}
