/**
 * 画质分档（QualitySettings）——移动端"同一份包跑低/中/高三档"的唯一定义来源。
 *
 * 设计约束（见 docs/architecture/mobile-platform.md §4）：
 * 1) 所有降级都是**运行时开关**，不是编译期分支——同一份 dist 要能跑三档。
 * 2) 渲染层**只读** `quality` 这个单例对象；改档只能通过 applyTier / initQuality。
 * 3) 分档判定以**启动期微基准**为主（iOS 拿不到 deviceMemory），静态线索只兜底。
 * 4) 探测结果缓存进 localStorage（key `homm.tier`），并提供用户手动覆盖（自动/低/中/高）。
 *
 * 本模块是纯逻辑 + 少量 localStorage 访问，**不碰 DOM/Canvas**，
 * 因此可以在 node（smoke 测试）里直接 import，且探测在无 getImageData 环境下
 * 必须 fail-safe 退回 'mid'，绝不抛异常。
 */

import { MAP_SIZES } from '../core/types.js';
import type { MapSize } from '../core/types.js';

export type Tier = 'low' | 'mid' | 'high';
/** 用户可选项：自动探测，或强制某一档。 */
export type QualityMode = 'auto' | Tier;
/** 光照三态：off 完全关闭 / multiply 只叠色 / full 叠色+暖光+暗角。 */
export type LightingMode = 'off' | 'multiply' | 'full';
/** 喜剧布景层三态（§6.1.5）：off 整层关 / static 地面涂鸦+立体道具 / full 再加活动物。 */
export type SetDressingMode = 'off' | 'static' | 'full';

/** §4.4 降级开关清单。渲染层只读。 */
export interface QualitySettings {
  /** 当前生效档位。 */
  tier: Tier;
  lighting: LightingMode;
  vignette: boolean;
  warmOverlay: boolean;
  waterGlint: boolean;
  townGlow: boolean;
  gridLines: boolean;
  /** DPR 上限：1 | 1.5 | 2 | 3（保留小数——1.5 是合法档位）。 */
  dprCap: number;
  /** 地图尺寸上限（格）：32 | 40 | 48。 */
  maxMapSize: number;
  /** 悬停效果（触屏恒 false）。 */
  hoverEffects: boolean;
  selectionPulseHz: number;
  /** 喜剧布景层（§6.1.5）：off / static / full。渲染层只读。 */
  setDressing: SetDressingMode;
}

export const TIER_ORDER: Tier[] = ['low', 'mid', 'high'];
export const TIER_LABEL: Record<Tier, string> = { low: '低', mid: '中', high: '高' };

/**
 * §4.2 分档表 → 代码。
 * 低端：只留 multiply 单次、关暗角/暖光/水面高光/城镇灯火/网格线；DPR 1.5；地图 ≤32。
 * 中端：multiply + 暗角，关 overlay 暖光；DPR 2；地图 ≤40。
 * 高端：全开；DPR 3；地图 ≤48。
 */
const TIER_TABLE: Record<Tier, Omit<QualitySettings, 'tier' | 'hoverEffects'>> = {
  low: {
    lighting: 'multiply',
    vignette: false,
    warmOverlay: false,
    waterGlint: false,
    townGlow: false,
    gridLines: false,
    dprCap: 1.5,
    maxMapSize: 32,
    selectionPulseHz: 2,
    setDressing: 'off',
  },
  mid: {
    lighting: 'multiply',
    vignette: true,
    warmOverlay: false,
    waterGlint: true,
    townGlow: true,
    gridLines: true,
    dprCap: 2,
    maxMapSize: 40,
    selectionPulseHz: 4,
    setDressing: 'static',
  },
  high: {
    lighting: 'full',
    vignette: true,
    warmOverlay: true,
    waterGlint: true,
    townGlow: true,
    gridLines: true,
    dprCap: 3,
    maxMapSize: 48,
    selectionPulseHz: 4,
    setDressing: 'full',
  },
};

/**
 * 纯映射：档位 → 降级开关。**这是分档逻辑的唯一真相来源**，方便单测。
 * hoverEffects 与档位无关（是输入设备能力），由调用方传入，默认 false（触屏优先）。
 */
export function settingsForTier(tier: Tier, hoverEffects = false): QualitySettings {
  return { tier, hoverEffects, ...TIER_TABLE[tier] };
}

/* ---------------- 单例：渲染层只读这个对象 ---------------- */

/**
 * 当前生效的画质设置。**默认 mid**——启动探测期间（约 0.5 s）先按中端渲染，
 * 探测完再切档，避免"先丑后美"。
 */
export const quality: QualitySettings = settingsForTier('mid', false);

type TierListener = (tier: Tier) => void;
const listeners = new Set<TierListener>();

/** 订阅档位变化（档位真正改变时才回调），返回取消订阅函数。 */
export function onTierChange(cb: TierListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** 应用某一档（原地改写单例；档位变化时通知监听器）。返回生效档位。 */
export function applyTier(tier: Tier, hoverEffects: boolean = quality.hoverEffects): Tier {
  const changed = quality.tier !== tier;
  Object.assign(quality, settingsForTier(tier, hoverEffects));
  if (changed) {
    for (const cb of listeners) {
      try {
        cb(tier);
      } catch {
        /* 单个监听器出错不应影响主流程 */
      }
    }
  }
  return tier;
}

/* ---------------- 环境读取（全部 fail-safe） ---------------- */

function readLS(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* 无痕模式 / 存储被回收：写不进去就算了，画质不是关键数据 */
  }
}

/** 设备像素比，读取失败回 1。 */
export function deviceDpr(): number {
  const d = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
  return typeof d === 'number' && d > 0 ? d : 1;
}

/**
 * 是否具备"悬停"能力（真实鼠标/触控板）。
 * 触屏恒 false——这决定了 hoverEffects 的默认值。
 */
export function hoverCapable(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;
  } catch {
    return false;
  }
}

/* ---------------- 持久化：探测缓存 + 手动覆盖 ---------------- */

const TIER_KEY = 'homm.tier';
const MODE_KEY = 'homm.tierMode';

function isTier(v: string | null): v is Tier {
  return v === 'low' || v === 'mid' || v === 'high';
}

/** 读取缓存的探测档位；无缓存/损坏回 null。 */
export function readCachedTier(): Tier | null {
  const v = readLS(TIER_KEY);
  return isTier(v) ? v : null;
}

/** 写入探测档位。 */
export function cacheTier(tier: Tier): void {
  writeLS(TIER_KEY, tier);
}

/** 清除探测缓存（设置页"重新检测"用）。 */
export function clearCachedTier(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(TIER_KEY);
  } catch {
    /* 同上 */
  }
}

/** 读取用户模式：默认 auto。 */
export function readMode(): QualityMode {
  const v = readLS(MODE_KEY);
  return isTier(v) ? v : 'auto';
}

/**
 * 设置用户模式并持久化。
 * - 非 auto：立刻生效（applyTier）。
 * - auto：清掉缓存后由 initQuality 重新走探测（调用方负责触发）。
 */
export function setMode(mode: QualityMode): void {
  writeLS(MODE_KEY, mode);
  if (mode !== 'auto') applyTier(mode);
}

/* ---------------- 地图尺寸上限（§4.2 maxMapSize） ---------------- */

const SIZE_ORDER: MapSize[] = ['small', 'medium', 'large', 'huge'];

/** 当前画质允许的可选地图尺寸（低端只剩 small/medium）。 */
export function allowedMapSizes(cap: number): MapSize[] {
  return SIZE_ORDER.filter((s) => MAP_SIZES[s].width <= cap);
}

/** 把尺寸夹到允许范围内：超出上限时退回"最大的可用档"。 */
export function clampMapSize(size: MapSize, cap: number): MapSize {
  const allowed = allowedMapSizes(cap);
  if (allowed.includes(size)) return size;
  return allowed[allowed.length - 1] ?? SIZE_ORDER[0];
}

/* ---------------- 启动期微基准（§4.3） ---------------- */

/** 采样帧数。 */
export const PROBE_FRAMES = 30;
/** p95 超过此值判低端（33 ms 预算，留余量）。 */
export const PROBE_LOW_MS = 20;
/** p95 超过此值判中端。 */
export const PROBE_MID_MS = 12;

/** 纯分类器：p95 帧时间 + DPR → 档位。抽出来单测。 */
export function classifyProbe(p95ms: number, dprValue: number): Tier {
  if (p95ms > PROBE_LOW_MS) return 'low';
  if (p95ms > PROBE_MID_MS) return 'mid';
  return dprValue >= 2 ? 'high' : 'mid';
}

/** 计算升序样本数组的 p95（与文档 `t[floor(len*0.95)]` 一致，越界保护）。 */
export function percentile95(samples: number[]): number {
  if (samples.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...samples].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[i];
}

export interface ProbeDeps {
  /** 画一帧有代表性的内容（必须是真正的 MapRenderer.draw，别测空转）。 */
  draw: () => void;
  /** 强制 GPU 同步，例如 `ctx.getImageData(0,0,1,1)`；缺省或报错都会安全退回。 */
  sync?: () => void;
  /** 取时间戳；默认 performance.now()。 */
  now?: () => number;
  /** 帧间让出（等一次 rAF）；默认 requestAnimationFrame，node 下退化为宏任务。 */
  yieldFrame?: () => Promise<void>;
  /** 采样帧数；默认 30。 */
  frames?: number;
  /** DPR；默认从全局读。 */
  dpr?: number;
}

function defaultYield(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else if (typeof setTimeout === 'function') setTimeout(resolve, 0);
    else resolve();
  });
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * 启动期微基准：采样 N 帧、取 p95、按 §4.3 阈值分档。
 *
 * **fail-safe**：任何一步抛错（例如无头环境没有 getImageData）、有效样本不足，
 * 一律返回 'mid'，绝不抛出——这样 tools/smoke.mjs 之类的 headless 环境不会被它带崩。
 */
export async function probeTier(deps: ProbeDeps): Promise<Tier> {
  try {
    const now = deps.now ?? defaultNow;
    const yieldFrame = deps.yieldFrame ?? defaultYield;
    const frames = deps.frames ?? PROBE_FRAMES;
    const dpr = deps.dpr ?? deviceDpr();

    const samples: number[] = [];
    for (let i = 0; i < frames; i++) {
      const a = now();
      deps.draw();
      deps.sync?.();
      const dt = now() - a;
      if (Number.isFinite(dt) && dt >= 0) samples.push(dt);
      await yieldFrame();
    }

    // 有效样本不足（画不出来 / 时钟不可用）时保守居中，不冒进到 high。
    if (samples.length < Math.max(3, Math.floor(frames / 2))) return 'mid';
    return classifyProbe(percentile95(samples), dpr);
  } catch {
    return 'mid';
  }
}

export interface InitQualityOptions extends Omit<ProbeDeps, 'frames' | 'dpr'> {
  hoverCapable?: boolean;
  frames?: number;
}

/**
 * 启动入口：解析模式 → 缓存 → 探测，然后应用并返回生效档位。
 *
 * 注意：本函数会 await 探测（约 0.5 s）。调用方应**不阻塞首帧**——
 * 单例默认 mid，先让 rAF 循环跑起来，再 `void initQuality(...)`，
 * 档位确定后通过 onTierChange 触发 resize 即可。
 */
export async function initQuality(opts: InitQualityOptions): Promise<Tier> {
  const hover = opts.hoverCapable ?? hoverCapable();

  const mode = readMode();
  if (mode !== 'auto') return applyTier(mode, hover); // 手动覆盖优先，不探测

  const cached = readCachedTier();
  if (cached) return applyTier(cached, hover); // 命中缓存，省掉 30 帧

  const tier = await probeTier({
    draw: opts.draw,
    sync: opts.sync,
    now: opts.now,
    yieldFrame: opts.yieldFrame,
    frames: opts.frames,
  });
  cacheTier(tier);
  return applyTier(tier, hover);
}
