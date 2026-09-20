/**
 * 相邻材质的可读性规则 —— **单一真值源**。
 *
 * 为什么单独成文件：这套规则有两个消费者，且必须永远一致 ——
 *   1. `tools/b0audit.mjs` 拿它做**断言 2 / 断言 8**（判定交付帧合不合格）
 *   2. `render/unitArt.ts` 的**降采样**拿它做**删行/删列的准入判据**
 *      （「删掉这一行会不会造出违规的相邻材质的」）
 * 如果两边各写一份，改阈值时必然漂移：审计会放行渲染器认为非法的帧，或反之。
 * 所以规则只写在这里，两边 import。
 *
 * 规则原文（美术 2026-09-19 拍板）：
 *   · **断言 2（台阶）**：相邻且**同 family** 时，`|idx 差|` 必须 ≥ 2（否则看起来糊成一坨）。
 *   · **断言 8（明度差）**：相邻且**异 family** 时，ΔL* ≥ 8；若两材质**色相差 < 30°（同色系）**
 *     则阈值升到 12。两条例外：`ink0↔ink1` 的 ΔL* 是常量（13.0，由色板字面值决定），
 *     合并在每只精灵里重复检查只制造噪声 ⇒ 移交给断言 3 的色板级不变量；
 *     完全相同颜色本来就不构成「相邻材质对」⇒ 直接跳过。
 *
 * 为什么断言 8 不是单阈值 12：12 L* 是 §2.4 的**族间**明度签名阈値，那一档要靠明度单通道
 * 完成「去色 32px 并排认族」，门槛必须高；精灵内相邻材质还有色相 / 形状 / 1px 描边三条通道
 * 兜底，硬套 12 会误杀大量合法配色。
 */

export type RGBA = [number, number, number, number];

/** 调色板条目（形状与 unitArt 的 PalEntry 一致；此处用结构类型避免循环 import）。 */
export interface PaletteEntryLike {
  hex: string;
  family: string;
  idx: number;
}

export const MIN_DL = 8;
export const MIN_DL_SAME_HUE = 12;
export const SAME_HUE_DEG = 30;
/** alpha 高于此值算「不透明」；低于等于则视为空洞（与 PixBuf 的 8 位 alpha 约定一致）。 */
export const OPAQUE_ALPHA = 8;

export const isOpaque = (p: RGBA): boolean => p[3] > OPAQUE_ALPHA;

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');
export const rgbToHex = (r: number, g: number, b: number): string => '#' + hex2(r) + hex2(g) + hex2(b);
export const hexOf = (p: RGBA): string => rgbToHex(p[0], p[1], p[2]);

/** CIE L*（§2.4 用 L* 做明度签名）。 */
export function lstarOf(r: number, g: number, b: number): number {
  const f = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const Y = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  return Y <= 0 ? 0 : 116 * Math.cbrt(Y) - 16;
}

/** HSL 色相（度）。低饱和度也照样给色相 —— 规则只看「是否同色系」。 */
export function hueOf(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d === 0) return 0;
  let h: number;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** 色相环上的最短距离（度）。 */
export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** 该色相对的 ΔL* 门槛：同色系（色相差 < 30°）要 12，否则 8。 */
export function requiredDl(h1: number, h2: number): number {
  return hueGap(h1, h2) < SAME_HUE_DEG ? MIN_DL_SAME_HUE : MIN_DL;
}

/** 相邻材质对的判定接口 —— 渲染器与审计共用同一实现。 */
export interface AdjacencyRules {
  /** 断言 2：同 family 且 |idx 差| < 2 ⇒ 违规。 */
  stepViolation(p: RGBA, q: RGBA): boolean;
  /** 断言 8：异 family 且 ΔL* < requiredDl ⇒ 违规（ink0↔ink1 例外）。 */
  contrastViolation(p: RGBA, q: RGBA): boolean;
  /** 两者之一 ⇒ 这一对相邻像素不可接受（渲染器删行/删列的准入判据）。 */
  violates(p: RGBA, q: RGBA): boolean;
  /** 该对实测 ΔL*（用于报告）。 */
  deltaL(p: RGBA, q: RGBA): number;
  /** 该对所需 ΔL*（用于报告）。 */
  requiredDlFor(p: RGBA, q: RGBA): number;
  /** 该对是否因「同材质 / 同色 / 空洞」而被规则跳过。 */
  skipped(p: RGBA, q: RGBA): boolean;
}

export function makeAdjacencyRules(palette: PaletteEntryLike[]): AdjacencyRules {
  const PAL = new Map(palette.map((e) => [e.hex, e] as const));

  const pairOf = (p: RGBA, q: RGBA) => {
    if (!isOpaque(p) || !isOpaque(q)) return null; // 空洞
    const hp = hexOf(p);
    const hq = hexOf(q);
    if (hp === hq) return null; // 同色
    const e = PAL.get(hp);
    const f = PAL.get(hq);
    if (!e || !f) return null; // 不在色板（由断言 2 的 offPalette 分支负责）
    return { e, f };
  };

  return {
    stepViolation(p, q) {
      const r = pairOf(p, q);
      if (!r) return false;
      if (r.f.family !== r.e.family) return false; // 异材质归断言 8
      return Math.abs(r.f.idx - r.e.idx) < 2;
    },
    contrastViolation(p, q) {
      const r = pairOf(p, q);
      if (!r) return false;
      if (r.f.family === r.e.family) return false; // 同材质归断言 2
      const pair = [r.e.family, r.f.family].sort().join('|');
      if (pair === 'ink0|ink1') return false; // 常量，已移交断言 3
      return this.deltaL(p, q) < this.requiredDlFor(p, q);
    },
    violates(p, q) {
      return this.stepViolation(p, q) || this.contrastViolation(p, q);
    },
    deltaL(p, q) {
      return Math.abs(lstarOf(p[0], p[1], p[2]) - lstarOf(q[0], q[1], q[2]));
    },
    requiredDlFor(p, q) {
      return requiredDl(hueOf(p[0], p[1], p[2]), hueOf(q[0], q[1], q[2]));
    },
    skipped(p, q) {
      return pairOf(p, q) === null;
    },
  };
}
