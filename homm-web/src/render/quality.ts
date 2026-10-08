/**
 * 画质分档（QualitySettings）——移动端"同一份包跑低/中/高三档"的唯一定义来源。
 *
 * 设计约束（见 docs/architecture/mobile-platform.md §4）：
 * 1) 所有降级都是**运行时开关**，不是编译期分支——同一份 dist 要能跑三档。
 * 2) 渲染层**只读** `quality` 这个单例对象；改档只能通过 applyTier / initQuality。
 * 3) 分档判定以**启动期微基准**为主（iOS 拿不到 deviceMemory），静态线索只兜底。
 * 4) 探测结果缓存进 localStorage（key `homm.tier` + 版本 key，见 `PROBE_VERSION`），
 *    并提供用户手动覆盖（自动/低/中/高）。
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
    // 布景层（§6.1.5 / #85 裁定取 (a)）：
    // A 组是**烘焙层**（运行时仅 1 次 drawImage，与地形层同量级，而地形层不在任何档位被关），
    // 故 low 也开 `'static'` —— 成本证据：内存 ≤4 MiB / 烘焙 ≈10–30 ms 一次性 / 每帧 +1 drawImage。
    // ⚠️ B 组（立体道具）落地前必须先把 groundDressing(烘焙→全档) 与 propDressing(每帧→随档) 拆开，
    //    否则 low 会静默多出 B 组的每帧成本。见 cartoon-style.md §6.1.5。
    setDressing: 'static',
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

/* ---------------- 调试：`?devdpr=<n>` —— **只**改 dprCap（隔离实验） ---------------- */

/**
 * `?devdpr=1.5`：**只**覆写 `dprCap`（渲染倍率上限），**其它开关一律按档位正常生效**。
 *
 * 为什么需要它：`shots/README.md` 的实测表里，**档位 low↔high 的差（同构建内 2.28）明显大于单项氛围层**
 * （地貌层 1.41），但**分不清这里面多少是锐度（`dprCap`）、多少是氛围层开关** —— 档位把两者**捆在一起**。
 * 有了这个开关就能单变量：**同一个档位、只把 `dprCap` 压低**（或抬回 3）⇒ 差异里剔掉氛围层那一项。
 * （实测：只差 `dprCap` 就有 1.26 ⇒ 约占档位差的 **55%**，锐度不是次要项。）
 *
 * 与 `lightLayer.ts` 的 `?devlight=0.68` 是同一套查询参数惯例：
 * **无人传 ⇒ `null` ⇒ 生产路径逐字节不变**。fail-safe：非 DOM 环境（node / smoke）拿不到 `location` ⇒ `null`。
 */
function devDprCapOverride(): number | null {
  if (typeof location === 'undefined') return null;
  try {
    const raw = new URLSearchParams(location.search).get('devdpr');
    if (raw === null) return null;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
const DEV_DPR_CAP = devDprCapOverride();

/* ---------------- 展示图氛围基线（G-15 · 画质腿） ---------------- */

/**
 * 需要"氛围基线"的场景 id。**只有这一个**场景会被抬档，其余场景逐字节不变。
 *
 * 起因：`grims-showcase`（破碎罗盘）是拿出去给人看的展示图，而 `TIER_TABLE.low`
 * 把 `vignette` / `warmOverlay` / `waterGlint` / `townGlow` 全关、`setDressing` 关；
 * 自动档一旦判成 low（G-15），这张图看到的正是"氛围层全灭"的版本 —— 也就是
 * F-3.7 那句"画面没有什么提升"。展示图不能赌探测结果，故在**该场景启动**时把
 * 这几层强制打开，作为画质基线。
 *
 * 为什么是"改单例"而不是改 `TIER_TABLE`：分档表是三档设备的共同契约，动它会把
 * 低端机一起抬起来（掉帧风险）。这里只在**这一个场景**上叠一层，范围可控。
 */
export const AMBIENT_BASELINE_SCENARIO = 'grims-showcase';

/** 基线要抬起来的开关（`lighting: 'full'` 是 `warmOverlay` 真正生效的前提，见 `MapRenderer.applyLighting`）。 */
const AMBIENT_BASELINE = {
  lighting: 'full' as LightingMode,
  vignette: true,
  warmOverlay: true,
  waterGlint: true,
  townGlow: true,
};

/** 当前处于基线状态的场景 id；null = 无基线（自由对局 / tutorial / duel 恒为此值）。 */
let baselineScenario: string | null = null;

/** 基线是否生效（只读，给渲染层/诊断用）。 */
export function ambientBaselineActive(): boolean {
  return baselineScenario !== null;
}

/**
 * 按**当前场景**同步氛围基线。`MapRenderer.draw` 每帧调一次（内部做了"值没变就不动"的短路）。
 *
 * - `scenario === 'grims-showcase'` ⇒ 抬到 `AMBIENT_BASELINE`；
 * - 其它任何值（含 `undefined` = 自由对局）⇒ 不做任何事；若上一帧还在基线里，
 *   按当前档位**重放一次**档位表，逐字节回到无基线状态。
 */
export function syncAmbientBaseline(scenario?: string): void {
  const want = scenario === AMBIENT_BASELINE_SCENARIO ? AMBIENT_BASELINE_SCENARIO : null;
  if (want === baselineScenario) return;
  baselineScenario = want;
  applyTier(quality.tier); // 重放档位表：带基线 / 不带基线（档位没变 ⇒ 不通知监听器）
}

/** 应用某一档（原地改写单例；档位变化时通知监听器）。返回生效档位。 */
export function applyTier(tier: Tier, hoverEffects: boolean = quality.hoverEffects): Tier {
  const changed = quality.tier !== tier;
  Object.assign(quality, settingsForTier(tier, hoverEffects));
  // 展示图基线：档位表落完之后再叠一层（切档 / 重放都不会把基线洗掉）。
  if (baselineScenario !== null) {
    Object.assign(quality, AMBIENT_BASELINE);
    // setDressing 只往上抬不往下压：'off' → 'static'（烘焙层，low 也是这个档），不追 'full'（每帧多活动物）。
    if (quality.setDressing === 'off') quality.setDressing = 'static';
  }
  // `?devdpr` 只动 dprCap，其余保持该档位的正常值（见 DEV_DPR_CAP 注释）；不传时为 null、整段不发生。
  if (DEV_DPR_CAP !== null) quality.dprCap = DEV_DPR_CAP;
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
/** 缓存为 low 时已沿用的启动次数（见 `LOW_CACHE_MAX_BOOTS`）。 */
const LOW_BOOT_KEY = 'homm.tierLowBoots';

/**
 * 探测逻辑版本。**采样语义一变就 +1** —— 否则老用户升包后仍吃旧版探测写下的缓存，
 * 出现「探测修好了、画面还是没变」的假阴性（这正是 G-15 那类"改了 A 处、B 处静默沿用"的病）。
 * 版本不符时 `readCachedTier()` 返回 null ⇒ 强制重测一次，之后按新版本缓存。
 *
 * v1 = 初版（无预热帧）；v2 = 丢弃启动预热帧（G-15 修复）。
 */
export const PROBE_VERSION = 2;
const VER_KEY = 'homm.tierProbeVer';

function isTier(v: string | null): v is Tier {
  return v === 'low' || v === 'mid' || v === 'high';
}

/** 读取缓存的探测档位；无缓存 / 损坏 / **版本不符** 一律回 null（触发重测）。 */
export function readCachedTier(): Tier | null {
  const v = readLS(TIER_KEY);
  if (!isTier(v)) return null;
  if (readLS(VER_KEY) !== String(PROBE_VERSION)) return null;
  return v;
}

/** 写入探测档位 + 当前探测版本（并清掉"沿用 low 的启动计数"，见 `LOW_CACHE_MAX_BOOTS`）。 */
export function cacheTier(tier: Tier): void {
  writeLS(TIER_KEY, tier);
  writeLS(VER_KEY, String(PROBE_VERSION));
  writeLS(LOW_BOOT_KEY, '0');
}

/** 清除探测缓存（设置页"重新检测"用）。 */
export function clearCachedTier(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TIER_KEY);
      localStorage.removeItem(VER_KEY);
      localStorage.removeItem(LOW_BOOT_KEY);
    }
  } catch {
    /* 同上 */
  }
}

/**
 * **缓存为 low 时最多沿用多少次启动**（G-15 修复 · 自愈）。
 *
 * 为什么只有 low 要限次：low 是"氛围层全关"那一档（暗角/暖光/水面高光/城镇灯火全灭），
 * **错判的代价最大且最容易被玩家读成"画面没提升"**。而一次探测只要赶上后台装包 / 冷启动拥堵 /
 * 瞬时降频，就会被写成 low；此后**只要缓存命中就永不重测**（`initQuality` 见到缓存直接返回），
 * 一次坏测量把机器**永久钉在 low**。故：low 沿用 N 次启动后强制重测一次，
 * mid/high 照旧无限沿用（它们的错判代价是掉帧，且探测本身也要花 40 帧）。
 *
 * 成本：每 N 次启动多 40 帧（≈0.7 s，异步、不阻塞首帧）。
 */
export const LOW_CACHE_MAX_BOOTS = 3;

/** 沿用一个 low 缓存：计数 +1 并返回新值；读写失败（无痕模式）时返回 Infinity ⇒ 视作未到期。 */
function bumpLowBoots(): number {
  const cur = Number.parseInt(readLS(LOW_BOOT_KEY) ?? '', 10);
  const next = Number.isFinite(cur) ? cur + 1 : 1;
  writeLS(LOW_BOOT_KEY, String(next));
  return next;
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

/**
 * 采样前**丢弃的预热帧数**。
 *
 * 启动最拥堵的时刻（地形首次烘焙 + WebView 预热 + `sync()` 里 getImageData 强制 GPU
 * 停顿）不代表稳态能力——把它算进 p95，会把旗舰机**系统性误判成 low**（G-15：真机稳态
 * JS 绘制 p95 仅 0.6ms，却因预热期 p95 >20ms 落到 low；而 low 档把氛围层全关）。
 * 先跑 N 帧只驱动渲染、不进样本，再开始采样。
 *
 * 代价：探测多花 ≈10 帧（60fps 下 ≈0.17s），异步执行、不阻塞首帧。
 * **阈值 20/12ms 不动**——它针对的是绘制耗时，与刷新率无关，设计本身站得住，问题只在采样时机。
 */
export const PROBE_WARMUP_FRAMES = 10;
/** 采样帧数。 */
export const PROBE_FRAMES = 30;
/** 单帧超此值算"超低端预算"（33 ms 预算，留余量）。 */
export const PROBE_LOW_MS = 20;
/** 单帧超此值算"超中端预算"。 */
export const PROBE_MID_MS = 12;
/**
 * **超预算帧占比**超过此值才降档（G-15 修复）。
 *
 * 为什么不再"p95 一票否决"：样本只有 30 个时 `percentile95` 取的是**第 29 个**
 * （= 次大值，见 `percentile95`）——**30 帧里只要 2 帧**超预算（6.7% 的帧），整档就从
 * high 掉到 low，而 low 正是"氛围层全关"那一档（F-3.7「画面没提升」的观感来源）。
 * 两次 GC / 后台抢占 / 瞬时降频的尖刺在移动端并不罕见。改成"有多少比例的帧超预算"后：
 *   · 真慢的设备（多数帧超预算）→ 照样落 low，护栏没被拆；
 *   · 偶发尖刺（30 帧里 ≤3 帧）→ 不再把整档打下去。
 * 取值 0.1 = 30 帧里容忍 3 帧（第 4 帧起降档）——受控对照见 `classify_check` 的 ⑤/⑤b。
 */
export const PROBE_SLOW_RATIO = 0.1;

/**
 * 纯分类器：**样本数组** + DPR → 档位。抽出来单测。
 *
 * 判据 = 超预算帧的**占比**（理由见 `PROBE_SLOW_RATIO`），两档预算各判一次：
 * 先问"有没有持续超低端预算"，再问"有没有持续超中端预算"，都不超才按 DPR 决定
 * 是否升到 high（DPR<2 不冒进——high 会把 `dprCap` 抬到 3，低密度屏拿不到收益）。
 */
export function classifySamples(samples: number[], dprValue: number): Tier {
  if (samples.length === 0) return 'mid';
  const overLow = samples.filter((s) => s > PROBE_LOW_MS).length / samples.length;
  if (overLow > PROBE_SLOW_RATIO) return 'low';
  const overMid = samples.filter((s) => s > PROBE_MID_MS).length / samples.length;
  if (overMid > PROBE_SLOW_RATIO) return 'mid';
  return dprValue >= 2 ? 'high' : 'mid';
}

/**
 * 单值形式（= `classifySamples([ms], dpr)`）：给"已知一个代表值"的调用方与既有单测用。
 * 分档语义**只有 `classifySamples` 一处**；本函数不复制规则，避免两处漂移。
 */
export function classifyProbe(frameMs: number, dprValue: number): Tier {
  return classifySamples([frameMs], dprValue);
}

/** 计算升序样本数组的 p95（与文档 `t[floor(len*0.95)]` 一致，越界保护）。 */
export function percentile95(samples: number[]): number {
  return percentile(samples, 0.95);
}

/** 分位数（0~1），升序取 `floor(len*q)`，越界夹到末位；空样本回 +∞。 */
export function percentile(samples: number[], q: number): number {
  if (samples.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...samples].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)));
  return sorted[i];
}

/**
 * 最近一次探测的**可读数**（G-15 取证用）。
 *
 * 为什么要有它：分档判错时，"用户被判成了哪一档"此前只能靠档位开关间接反推，
 * 而同一档位在不同设备上的**成因不同**（预热拥堵 / GPU 同步开销 / 真的慢）。
 * 这里把分类器实际吃到的那几个数原样留下来，供 `?devprobe` 类脚本与真机 CDP 读出，
 * 使"判成 low"这条结论能被复核、而不是靠猜。
 *
 * 纯内存、不写 localStorage、不影响任何分档路径 ⇒ 生产行为不变。
 */
export interface ProbeDiagnostic {
  /** 样本 p95（ms）——留作对比：旧判据用的就是它；样本不足时为 NaN。 */
  p95: number;
  /** 同批样本的中位数——用来分辨「整体慢」与「个别尖刺」。 */
  median: number;
  /** 同批样本的最大值。 */
  max: number;
  /** **判据输入**：超 `PROBE_LOW_MS` 的帧占比（> `PROBE_SLOW_RATIO` 即降 low）。 */
  overLowRatio: number;
  /** **判据输入**：超 `PROBE_MID_MS` 的帧占比。 */
  overMidRatio: number;
  /** 参与统计的样本数（不含预热帧）。 */
  samples: number;
  /** 采样前丢弃的预热帧数。 */
  warmup: number;
  /** 分类器拿到的 DPR。 */
  dpr: number;
  /** 分档结果（含 fail-safe 的 'mid'）。 */
  tier: Tier;
  /** true = 走的是 fail-safe（异常 / 有效样本不足），不是真测出来的档位。 */
  failSafe: boolean;
}

let lastProbeDiagnostic: ProbeDiagnostic | null = null;

/** 取最近一次探测的读数；从未探测过时为 null。 */
export function probeDiagnostic(): ProbeDiagnostic | null {
  return lastProbeDiagnostic;
}

/** 把一批样本折算成诊断读数（样本为 null = 没量到，统计项取 NaN）。 */
function diag(
  samples: number[] | null,
  count: number,
  warmup: number,
  dpr: number,
  tier: Tier,
  failSafe: boolean,
): ProbeDiagnostic {
  const s = samples ?? [];
  return {
    p95: s.length ? percentile95(s) : Number.NaN,
    median: s.length ? percentile(s, 0.5) : Number.NaN,
    max: s.length ? s.reduce((a, b) => Math.max(a, b), 0) : Number.NaN,
    overLowRatio: s.length ? s.filter((v) => v > PROBE_LOW_MS).length / s.length : Number.NaN,
    overMidRatio: s.length ? s.filter((v) => v > PROBE_MID_MS).length / s.length : Number.NaN,
    samples: count, warmup, dpr, tier, failSafe,
  };
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
  /** 采样前丢弃的预热帧数；默认 `PROBE_WARMUP_FRAMES`。规则回归测试用。 */
  warmupFrames?: number;
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
 * 启动期微基准：**先丢弃 `warmupFrames` 帧预热**（冷启动拥堵期，不代表稳态能力），
 * 再采样 N 帧、取 p95、按 §4.3 阈值分档。丢弃预热的理由见 `PROBE_WARMUP_FRAMES`（G-15）。
 *
 * **fail-safe**：任何一步抛错（例如无头环境没有 getImageData）、有效样本不足，
 * 一律返回 'mid'，绝不抛出——这样 tools/smoke.mjs 之类的 headless 环境不会被它带崩。
 */
export async function probeTier(deps: ProbeDeps): Promise<Tier> {
  try {
    const now = deps.now ?? defaultNow;
    const yieldFrame = deps.yieldFrame ?? defaultYield;
    const frames = deps.frames ?? PROBE_FRAMES;
    const warmup = deps.warmupFrames ?? PROBE_WARMUP_FRAMES;
    const dpr = deps.dpr ?? deviceDpr();

    const samples: number[] = [];
    const total = warmup + frames;
    for (let i = 0; i < total; i++) {
      const a = now();
      deps.draw();
      deps.sync?.();
      const dt = now() - a;
      // 预热帧只驱动渲染、不进样本：它们量的是"冷启动拥堵"，不是"稳态绘制耗时"。
      if (i >= warmup && Number.isFinite(dt) && dt >= 0) samples.push(dt);
      await yieldFrame();
    }

    // 有效样本不足（画不出来 / 时钟不可用）时保守居中，不冒进到 high。
    if (samples.length < Math.max(3, Math.floor(frames / 2))) {
      lastProbeDiagnostic = diag(null, samples.length, warmup, dpr, 'mid', true);
      return 'mid';
    }
    const tier = classifySamples(samples, dpr);
    lastProbeDiagnostic = diag(samples, samples.length, warmup, dpr, tier, false);
    return tier;
  } catch {
    lastProbeDiagnostic = diag(null, 0, deps.warmupFrames ?? PROBE_WARMUP_FRAMES, deps.dpr ?? 0, 'mid', true);
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
  // 命中缓存 ⇒ 省掉 30 帧；但 **low 不永久沿用**（见 `LOW_CACHE_MAX_BOOTS`）：
  // 到期的 low 落下去重测，让"一次坏测量把机器钉在 low"能自己好。
  if (cached && (cached !== 'low' || bumpLowBoots() < LOW_CACHE_MAX_BOOTS)) {
    return applyTier(cached, hover);
  }

  const tier = await probeTier({
    draw: opts.draw,
    sync: opts.sync,
    now: opts.now,
    yieldFrame: opts.yieldFrame,
    frames: opts.frames,
    warmupFrames: opts.warmupFrames,
  });
  cacheTier(tier);
  return applyTier(tier, hover);
}
