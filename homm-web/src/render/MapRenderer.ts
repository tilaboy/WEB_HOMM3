import type { GameState, GridPos, MapObject, PlayerId } from '../core/types.js';
import { DWELLING_IDS } from '../core/data/buildings.js';
import { factionColor } from '../core/data/factions.js';
import { computeVisible, isRevealed } from '../core/map/fog.js';
import { drawAnchor, footprintOf, idx } from '../core/map/grid.js';
import { Camera } from './camera.js';
import { TILE } from './ortho.js';
import { getAtlas } from './atlas.js';
import { hash2 } from './pixel.js';
import { TerrainLayer } from './terrainLayer.js';
import { SetDressingLayer } from './setDressing.js';
import { currentLightTint, lightingOn } from './lightLayer.js';
import type { LightTint } from './lightLayer.js';
import { quality } from './quality.js';
import {
  chooseBadgeSide,
  pickRepresentativeUnit,
  sideCell,
  type BadgeFrame,
  type BBox,
} from './mapBadge.js';

export interface ViewModel {
  state: GameState;
  player: PlayerId;
  sight: number;
  reachable: Float64Array | null;
  path: GridPos[] | null;
  hover: GridPos | null;
  /** 跨天行程的目的地：画一面小旗，提醒玩家"昨天没走完"。 */
  dest: GridPos | null;
  selectedHeroId: string | null;
  heroRender: Record<string, { x: number; y: number }>;
}

type DrawKind =
  | { t: 'obj'; y: number; x: number; obj: MapObject }
  | { t: 'hero'; y: number; x: number; id: string; fx: number; fy: number; owner: PlayerId };

function objSprite(state: GameState, obj: MapObject, hash: number): string | null {
  switch (obj.kind) {
    case 'obstacle': {
      const v = (obj.payload as { variant: string }).variant;
      if (v === 'tree') return hash < 0.5 ? 'tree0' : 'tree1';
      if (v === 'rock') return hash < 0.5 ? 'rock0' : 'rock1';
      return hash < 0.5 ? 'mtn0' : 'mtn1';
    }
    case 'town': {
      const t = state.towns[(obj.payload as { townId: string }).townId];
      const tier = t ? Math.min(3, Math.floor(t.buildings.filter((b) => DWELLING_IDS.includes(b)).length / 1.5)) : 0;
      const own = t && t.owner !== 'neutral' ? t.owner : 'neutral';
      // 2×2 城堡用另一套精灵（城门固定在左下角）
      if (obj.footprint) return `castle_${own}_${tier}`;
      return `town_${own}_${tier}`;
    }
    case 'wanderingMonster': {
      const army = (obj.payload as { army: { unitTypeId: string }[] }).army;
      const main = army[0]?.unitTypeId ?? 'wolf';
      return `mon_${main}`;
    }
    case 'resourcePile':
      return `res_${(obj.payload as { resource: string }).resource}`;
    case 'mine':
      return `mine_${(obj.payload as { resource: string }).resource}`;
    case 'vault':
      return 'vault';
    case 'treasureChest':
      return 'chest';
    case 'fountain':
      return 'fountain';
    case 'artifact':
      return 'artifact';
    default:
      return null;
  }
}

function guardMarker(obj: MapObject): string | null {
  if (obj.kind !== 'wanderingMonster') return null;
  const g = (obj.payload as { guard?: { kind: string } }).guard;
  if (!g) return null;
  if (g.kind === 'gold') return 'mk_gold';
  if (g.kind === 'resource') return 'mk_res';
  if (g.kind === 'mine') return 'mk_mine';
  return 'mk_chest';
}

/**
 * ④ 可达范围两色（替换底部常驻移动力条）。
 * - 可走：青蓝填充（用户原话"蓝色或绿色"），沿用旧值。
 * - 不可走：**只描格缘，不填色**。两条硬理由：
 *   ① 实测（engineering-lead-2 正午/深夜两张同 seed 图）：原 0.07 红填充**肉眼不可辨**
 *      —— 填了等于没填，却要为**每一格不可达格**（面积远大于可达）多付一次 `fillRect`，
 *      是热路径上的净浪费（且 team-lead 判据 =「靠格缘而不是靠填色」去区分）；
 *   ② 非色兜底 = 这圈**格缘**（形状/边界线索），色觉障碍者也读得出"可达性的边"。
 * 两态都只画在**已揭开的地面**上、且在实体循环之前（见 draw() 里的位置说明）。
 *
 * ★ 2026-09-21 修订（a11y，team-lead 裁定取 (α)）：原版只有**半透明红缘**（alpha 0.42）——
 *   实测它**纯靠色相、几乎没有亮度分量**（红缘 vs 底 WCAG 仅 ~1.05:1、灰度下不可辨；
 *   红缘与对面蓝格仅 ΔL*≈1.36）⇒ 不满足"两态灰度下可辨"。现在红缘**外侧**再补一条
 *   **墨色 `ink0` 描边**（**不透明**，与 §1.1 同色）作**明度锚**：灰度下由它把
 *   "可达 / 不可达"的**边界**画出来。验收判据 = `design/accessibility-requirements.md §4.6`
 *   （两态灰度下可辨，锚 WCAG 非文本 3:1，量「状态 vs 其底」）。
 *
 * ★ 2026-09-21 (ii) 修订（a11y §4.6 判 (a-1) 可做；team-lead 归 engineering-lead 落地）：单一**暗墨**
 *   在**暗底**上对比不足（§4.6 分档：草·深 2.33 / 暗 1.16 / 夜 2.08）—— 因为同一相位内"极亮底"与
 *   "极暗底"同时存在（沙·土 ↔ 草·深），**整条换任何单一颜色都会把一类地形留在失败侧**。故补一条
 *   **亮芯**（`hi1` 暖高光，明度锚·**亮极**），与暗墨（**暗极**）落在**同一格地形**上
 *   ⇒ **任何底色下两极其一必 ≥3:1**（暗底吃亮芯、亮底吃暗边）。红只作**色相锚**、不挤掉亮/墨任一侧。
 *   边界带（贴可达区 → 不可走侧）= **红 2px + 亮芯 2px + 暗墨 2px = 6px（= 3×`EDGE_W`，≤6px 上限）**。
 */
const REACH_TINT = 'rgba(120,200,255,0.16)';
/** 格缘的**内侧红**（色相锚，贴可达区一侧）—— 沿用旧值；只作色相锚，不承担对比度。 */
const NOGO_EDGE = 'rgba(255,96,80,0.42)';
/** 格缘的**亮芯**（明度锚·**亮极**，不透明，复用 §3.2 的 `hi1` 暖高光）—— (ii) 救「暗底」。 */
const NOGO_EDGE_GLOW = '#fff3c8';
/** 格缘的**暗边墨色 `ink0`**（明度锚·**暗极**，不透明，复用 §1.1 的墨色）—— 救「亮底」。 */
const NOGO_EDGE_INK = '#2a1a12';
/** 格缘单边厚度（px）；**红 + 亮芯 + 暗墨三条** ⇒ 边界总宽 `3 * EDGE_W`（= 6px ≤ 6px 上限）。 */
const EDGE_W = 2;

/**
 * 调试旗标：`?devtint=0` ⇒ **不画** ④ 可达染色层（蓝填充 + 不可走边界三带）。
 *
 * 用途 = **单变量**因果 A/B：「染色开 vs 关」在同一构建 / 同一次会话 / 同一帧下取对照
 * （`tools/deviceshot.mjs` 之类真 Chrome，或 `tools/artshot.mjs` 垫片）。此前那对
 * `i_reach_*.png` 绑的是**旧构建**、又是两个不同来源 ⇒ 数量不成立。
 *
 * 与 `render/quality.ts` 的 `?devdpr` 同一套做法：**查询参数在渲染模块内读**，
 * 不惊动 `main.ts`。**不传旗标 ⇒ `true`** ⇒ 生产路径逐字节不变（默认空操作）。
 * 非浏览器环境（node 垫片 / 单测）拿不到 `location` ⇒ 走 catch ⇒ 同样恒开。
 */
const DEV_TINT = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devtint') !== '0';
  } catch {
    return true;
  }
})();

/**
 * 候选修法 (2)：`?devhalocomp=1` ⇒ 对 halo 的**描边色**按当前光照因子**反算**（默认关）。
 *
 * 机制（`art-director` 实测，非推测）：halo 画在 `applyLighting` **上游**（世界坐标），
 * 整屏 `multiply` 把它与地面**一起**乘暗 ⇒ 同一对颜色「只因相位变暗就单调走低」
 * （暗缝 4.00→3.46→2.77、岩石 3.18→2.83→2.36，**与画质档位无关**）。WCAG 比值带 `+0.05`
 * 底 ⇒ 两侧同时被乘小 ⇒ 这是**管线产物**，不是配色问题。
 *
 * 口径：把描边色按因子反算（`目标屏色 ÷ 乘光因子`），使其**被乘光后落到标称亮度**；
 * 结果 `clamp` 到 `[0,255]`（会被乘暗的相位下屏上上限是 `255*因子` ⇒ **只能救「亮极」**）。
 * **只作用于 halo 的描边**：不碰地面、不碰其它覆盖层、**不改绘制顺序、不动 `applyLighting` 位置**。
 *
 * ⚠️ 硬条件 (i)：**不得嵌在 `tintEnabled` 守卫内部** —— 否则 `?devtint=0` 会连它一起关，
 * 「量测仪器」与「被测对象」共用一个开关 ⇒ 永远说不清测到的是哪一层。故本开关在下面
 * 与 tint 块**解耦**求值（见 `compOn`）。
 */
const HALO_COMP = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devhalocomp') === '1';
  } catch {
    return false;
  }
})();

/**
 * ④ 光照修法 (1)：三条边带**改画在 `applyLighting` 之后**（结构性修法，免于整屏 multiply）。
 *
 * **现在默认 = 开**（`#154` 定案后翻默认；判据 = `accessibility-requirements.md §4.6`
 * **四格全绿** `6.16 / 6.10 / 14.66 / 7.92` + 无回归，见该档 `V1.23`）。
 * `?devhaloafter=0` 回退**旧路径**（三条带在光照**之前**画）。
 *
 * 静态等价（本次改动的门票 —— 只动了一个布尔表达式、调用点未动）：
 *   · 翻默认前的 `default`      ≡ 本版 `?devhaloafter=0`（两侧同为 `haloAfter === false`）；
 *   · 翻默认前的 `?devhaloafter=1` ≡ 本版 `default`      （两侧同为 `haloAfter === true`）。
 *   ⇒ 两向逐像素等价**由调用点保证**（与 DEV_TINT 同款：查询参数在渲染模块内读、不惊动 `main.ts`）。
 *
 * 绘制仍走**世界坐标 + 相机变换**，故坐标与遮挡关系与旧版一致；
 * 唯一差别 = 这三条带不再被乘暗（也因此不再被 y 排序的实体遮挡 —— 已接受为有意设计；
 * "线横穿单位"记为**已知未判风险**，由真机试玩覆盖）。
 */
const HALO_AFTER = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devhaloafter') !== '0';
  } catch {
    return true;
  }
})();

/**
 * `#155`：让 ④ 的边界轮廓**在「可达区 × 未探索区」交界处也闭合**。
 *
 * ★ **2026-09-21 翻默认（`#155` 收口）**：本修法 **默认开**（生产路径即闭合版）；
 *   **`?devfogclose=0` = 一条可复现的旧路径**（回到"未探索格不参与 ⇒ 逐像素与旧版一致"）。
 *   **留旧路径不是可选项** —— 它是「默认 vs `?devfogclose=0`」这对对照臂能成立的前提：
 *   若旧路径不存在或不等价 ⇒ 新臂退化成 `on vs on` ⇒ 又变回**「对照臂被吞」**。
 *   （同 `#174` 的 `HALO_AFTER`。规矩由 team-lead 采纳：**凡把某开关翻成默认，
 *   必须同时留一条可复现的旧路径**。）
 *
 * **缺陷（真缺陷，team-lead `368f68f` 判「要修」；`design/accessibility-requirements.md` §4.6 存证）**：
 * 一句话 = **同一个量在「可见性闸」与「可达性闸」上口径不一致** ——
 * `core/map/pathfinding.ts computePaths()` **不看 `isRevealed`**（`vm.reachable` 的有限 cost 会落在未探索格上），
 * 而 ④ 绘制循环首句与 `const inRegion =` **都看 `isRevealed`** ⇒ 二者的交集 = **可达区贴雾那一段 = 洞**。
 * 像素腿（同构建 `dist-139`、`?devtint=0` A/B）：雾像素 4 邻接「被染色层碰过」者 `n=1020`，
 * **邻接水洗 100% / 邻接任意带 0** ⇒ 可达区贴雾处**一条带都没画**，轮廓在那里是开的。
 * ⇒ 这直接动摇 `§4.6` 的方向判据前提「**可达区 = 落在墨色闭合轮廓内**」。
 *
 * **本候选修法（= 修法之一，非默认）**：把未探索格也纳入边界带的候选，**带画在未探索格贴可达区的那一侧** ——
 * 即**沿用既有约定**（带落在**可达区之外**的那一格上：旧版画在「已揭开的不可走格」，
 * 这里画在「未探索格」）⇒ 轮廓仍是**包围**可达区、只是把缺的那一段补齐。**不改 `computePaths`、不改绘制顺序、
 * 不动光照管线**（与 `#154` 的「带画在光照哪一侧」正交 —— team-lead 特意把两条线的变量分开以便归因）。
 *
 * ⚠️ **`?devfogclose=0` ⇒ 生产路径逐像素回到旧版**（未探索格走 `if (!rev) continue;`）；
 *    **默认（不传参）走闭合版**。旧路径随时可重跑 ⇒ A/B 的两臂都在。
 * ⚠️ **已知边界（如实记，不夸大）**：本修法只补「未探索交界」这一种洞；**地图外缘**（越界、无格承载）仍不开，
 * 且 `fog` 与图外底色同色 `#0b0d10`、像素上分不开 ⇒ 本旗标**不声称**"轮廓全局闭合"，
 * 只声称"**可达区贴雾那一侧**的那一段补上"，前后对比由 `closureprobe` + 同构建出（`art-director`）。
 */
const DEV_FOG_CLOSE = ((): boolean => {
  try {
    /* ★ 翻默认：不传参 ⇒ 开；`?devfogclose=0` ⇒ 取回旧路径（可复现）。 */
    return new URLSearchParams(location.search).get('devfogclose') !== '0';
  } catch {
    /* 没有 `location.search`（非浏览器上下文）⇒ 取默认（开）。 */
    return true;
  }
})();

/** 单条（或四边）边带的绘制参数：世界坐标下的一个矩形 + 填充色。 */
interface BandRect {
  x: number;
  y: number;
  w: number;
  h: number;
  c: string;
}

/**
 * 把一个 CSS 颜色按光照因子**反算**：`目标屏色 ÷ 因子`，`clamp` 到 `[0,255]`。
 * 支持 `#rrggbb` 与 `rgb()/rgba()`（alpha 原样保留）。解析不了就**原样返回**
 * （宁可不补，不可改错色）。
 */
function lightCompColor(css: string, lt: LightTint): string {
  const f = (v: number): number => (v > 0 ? v / 255 : 1);
  const up = (v: number, k: number): number => Math.max(0, Math.min(255, Math.round(v / k)));
  const hex = /^#([0-9a-f]{6})$/i.exec(css);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return `rgb(${up((n >> 16) & 255, f(lt.r))},${up((n >> 8) & 255, f(lt.g))},${up(n & 255, f(lt.b))})`;
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(css);
  if (m) {
    const p = m[1].split(',').map((s) => Number.parseFloat(s.trim()));
    const a = p.length > 3 ? p[3] : 1;
    return `rgba(${up(p[0], f(lt.r))},${up(p[1], f(lt.g))},${up(p[2], f(lt.b))},${a})`;
  }
  return css;
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private atlas = getAtlas();
  private terrain = new TerrainLayer();
  /** §6.1 喜剧布景层（A 组地面涂鸦）。低端 `setDressing==='off'` 时整层不烘、不画。 */
  private dressing = new SetDressingLayer();
  /** 光照梯度按视口尺寸缓存：尺寸不变就复用，消除每帧 createXxxGradient 的 GC 压力。 */
  private warmGrad: CanvasGradient | null = null;
  private warmGradW = -1;
  private warmGradH = -1;
  private vigGrad: CanvasGradient | null = null;
  private vigGradW = -1;
  private vigGradH = -1;
  /**
   * §13.4 队伍徽标：帧的**可见剪影**几何（含 1px 描边）按帧名缓存。
   * 为什么缓存：`getImageData` 每帧都跑太贵；而剪影是静态资产属性，只算一次。
   * 为什么要剪影而不是画布框：必须与审计探针 `tools/mapbadgeaudit.mjs` **同源** ——
   * 探针用 `buildB0Frame` 的真实剪影 bbox 判"压格 / 不遮物"，运行时若用 52 宽画布框
   * 会判出不同的落点 ⇒ 探针绿 ≠ 接线对。透明留白不算遮挡，剪影才算。
   */
  private silCache = new Map<string, { w: number; h: number; ax: number; ay: number; sil: BBox } | null>();

  /**
   * 队伍徽标可见性。**默认 `false`** —— 用户试玩裁决：英雄后面跟队伍「点起来更麻烦、
   * 反而增加页面复杂度、更难操作」⇒ 撤掉默认显示。帧（`u_*_map`）与 `audit:badge` 保留。
   * `?devbadge` 置 `true` —— 保留因果 A/B 能力（同一次会话、同一帧，开/关只差徽标）。
   */
  badgesVisible = false;

  /**
   * ④ 可达染色层总开关（蓝填充 `REACH_TINT` + 不可走边界三带）。
   *
   * **默认 `true`** —— 不传旗标时这一层照常画，行为与引入本开关之前**逐字节一致**
   * （门是 `if (cost && this.tintEnabled)`，`true` 时等价于原来的 `if (cost)`）。
   * `?devtint=0` 置 `false` —— 供**同构建 / 同会话 / 同帧**的因果 A/B（染色开 vs 关），
   * 这是 `i_reach_*` 那对非单变量证据图的替代品（与 `?devbadge` / `?devshade` 同一套惯例）。
   *
   * 旗标**在本模块内读**（`DEV_TINT`，做法同 `render/quality.ts` 的 `?devdpr`）⇒ 不惊动
   * `main.ts`，本开关是单文件改动。
   */
  tintEnabled = DEV_TINT;

  /**
   * 候选修法 (2)：halo 描边色**光照预补偿**（`?devhalocomp=1`）。**默认 `false`** ⇒
   * 不补、描边色照旧 ⇒ 生产路径逐像素不变。开启时**只改 halo 三条描边的填充色**。
   * ⚠️ 与 `tintEnabled` **解耦**（硬条件 i）—— 二者是两个独立旗标，不互相门控。
   */
  haloLightComp = HALO_COMP;

  /**
   * ④ 光照修法 (1)：三条边带**改画在光照之后**。**现在默认 = 开**（`#154` 定案后翻默认）。
   * `?devhaloafter=0` 回退旧路径（世界坐标、实体之前）⇒ 生产路径可逐像素回退到翻默认前。
   * 开启时把三条边带的绘制推迟到 `applyLighting` 之后（仍走世界坐标 + 相机变换）⇒ 免于整屏 multiply。
   */
  haloAfter = HALO_AFTER;

  /**
   * `#155`：把边界轮廓补满到「可达区 × 未探索区」交界（**默认开**；`?devfogclose=0` 取回旧路径）。
   * 默认即把未探索格也当候选，带画在**未探索格贴可达区那一侧**（沿用"带落在可达区之外那一格"
   * 的既有约定）⇒ 补齐贴雾的缺口。`?devfogclose=0` ⇒ 未探索格不参与 ⇒ 生产路径**逐像素回到旧版**。
   * ⚠️ 与 `tintEnabled` 同族门控（**属于 ④ 染色层内部**）——`?devtint=0` 会把它一起关，
   * 因为"未探索处要不要描边"本身就是染色层的语义，不是独立的量测仪器（对比 `haloLightComp`
   * 那种"仪器"必须**解耦**；这两类的区别见各自注释）。
   */
  fogClose = DEV_FOG_CLOSE;

  /**
   * 调试：开关地形「地貌层」（`terrainShade.ts` 的地图尺度明暗），并立即重烘。
   *
   * 为什么是方法而不是直接暴露字段：`terrain` 是 `private`，且 `macroShade` 只在
   * **烘焙**时生效（`TerrainLayer.bake()`）—— 改了它必须 `invalidate()` 让下一帧重烘，
   * 否则烘焙缓存还在，开关看着"没反应"。把这两步收进一个方法，避免调用方漏掉重烘。
   *
   * 与 `badgesVisible` 同一种 dev 开关：**仅供对照截图**（`?devshade=0`，见 `main.ts`）。
   * 无人调用 ⇒ 恒为默认开 ⇒ 不影响生产路径。
   */
  setMacroShade(on: boolean): void {
    this.terrain.macroShade = on;
    this.terrain.invalidate();
  }

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 画布上下文');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const raw = window.devicePixelRatio || 1;
    // §5.3：只做上限钳制，**保留小数**——1.5 是合法档位，旧的 Math.round 会把它吞成 2。
    // backing 尺寸取整，setTransform 用原始小数，逻辑坐标（camera.viewW/H）不变。
    const dpr = Math.min(Math.max(raw, 1), quality.dprCap);
    const host = this.canvas.parentElement;
    const w = this.canvas.clientWidth || host?.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || host?.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.camera.viewW = w;
    this.camera.viewH = h;
    this.dpr = dpr;
  }

  private blit(name: string, gx: number, gy: number): void {
    const f = this.atlas.get(name);
    if (!f) return;
    this.ctx.drawImage(
      this.atlas.canvas, f.x, f.y, f.w, f.h,
      gx * TILE + f.ax, gy * TILE + f.ay, f.w, f.h,
    );
  }

  private blitAt(name: string, wx: number, wy: number): void {
    const f = this.atlas.get(name);
    if (!f) return;
    this.ctx.drawImage(this.atlas.canvas, f.x, f.y, f.w, f.h, wx, wy, f.w, f.h);
  }

  /**
   * 矿场归属旗。
   *
   * 为什么不是像城堡那样把颜色烘进精灵里：矿有 7 种 × 5 个阵营 = 35 张图，
   * 而旗子只是两笔——一根杆加一个三角，直接画比烘 35 张图划算得多。
   */
  private blitMineFlag(obj: MapObject, tx: number, ty: number): void {
    if (obj.kind !== 'mine') return;
    const owner = (obj.payload as { owner: string }).owner;
    if (!owner || owner === 'neutral') return; // 无主矿不插旗：一眼能看出哪些还没人占
    const ctx = this.ctx;
    const x = tx * TILE + TILE - 7;
    const y = ty * TILE + 4;
    ctx.fillStyle = '#3a2a18';
    ctx.fillRect(x, y, 1.5, 11);
    ctx.fillStyle = factionColor(owner as never);
    ctx.beginPath();
    ctx.moveTo(x + 1.5, y + 1);
    ctx.lineTo(x + 8, y + 4);
    ctx.lineTo(x + 1.5, y + 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,16,10,0.55)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  /** 帧的可见剪影几何（懒算 + 缓存）。无此帧或无实心像素 ⇒ null。 */
  private silOf(name: string): { w: number; h: number; ax: number; ay: number; sil: BBox } | null {
    if (this.silCache.has(name)) return this.silCache.get(name)!;
    let geo: { w: number; h: number; ax: number; ay: number; sil: BBox } | null = null;
    const f = this.atlas.get(name);
    // 读图集画布：图集由本工程的 PixBuf 绘制（同源），getImageData 不会被污染拦截。
    const actx = this.atlas.canvas.getContext('2d');
    if (f && actx) {
      const d = actx.getImageData(f.x, f.y, f.w, f.h).data;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          if (d[(y * f.w + x) * 4 + 3] <= 8) continue; // alpha ≤ 8 视为透明（与 audit:b0 同口径）
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      if (x1 >= x0) geo = { w: f.w, h: f.h, ax: f.ax, ay: f.ay, sil: { x0, y0, x1, y1 } };
    }
    this.silCache.set(name, geo);
    return geo;
  }

  /** blit(name,gx,gy) 语义下（含帧自带锚点 ax/ay）该帧可见剪影的世界包围盒。 */
  private silBBoxAt(name: string, gx: number, gy: number): BBox | null {
    const g = this.silOf(name);
    if (!g) return null;
    const px = gx * TILE + g.ax;
    const py = gy * TILE + g.ay;
    return { x0: px + g.sil.x0, y0: py + g.sil.y0, x1: px + g.sil.x1, y1: py + g.sil.y1 };
  }

  /** blitAt(name,px,py) 语义下（画布左上角显式落点）该帧可见剪影的世界包围盒。 */
  private silBBoxPx(name: string, px: number, py: number): BBox | null {
    const g = this.silOf(name);
    if (!g) return null;
    return { x0: px + g.sil.x0, y0: py + g.sil.y0, x1: px + g.sil.x1, y1: py + g.sil.y1 };
  }

  /**
   * §13.4 规则 1 的"已揭示实体"：英雄周围 r 格内已揭示物件的**精灵 + guard 标记**剪影包围盒。
   * 半径 2 足够 —— 徽标是 52×44（剪影 ≤43），即使落在邻格、再外扩 ~10px 也只够到 2 格外。
   */
  private collectObstacles(vm: ViewModel, hx: number, hy: number, r: number): BBox[] {
    const { state, player } = vm;
    const map = state.map;
    const out: BBox[] = [];
    const seen = new Set<string>();
    for (let y = hy - r; y <= hy + r; y++) {
      for (let x = hx - r; x <= hx + r; x++) {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
        if (!isRevealed(state, player, x, y)) continue; // 未揭示的物件不参与（记忆里的也算信息）
        const id = map.tiles[idx(map, x, y)].objectId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const obj = map.objects[id];
        if (!obj) continue;
        const a = drawAnchor(obj);
        const sprite = objSprite(state, obj, hash2(a.x, a.y, 91));
        if (sprite) {
          const bb = this.silBBoxAt(sprite, a.x, a.y);
          if (bb) out.push(bb);
        }
        const mk = guardMarker(obj);
        if (mk) {
          // 与 draw() 中 `blitAt(mk, x*TILE+17, y*TILE+17)` 同源。
          const bb = this.silBBoxPx(mk, a.x * TILE + 17, a.y * TILE + 17);
          if (bb) out.push(bb);
        }
      }
    }
    return out;
  }

  /**
   * 画出英雄棋子旁的**队伍徽标**（§13.4 · D-64「地图单位接地图」）。
   *
   * 与审计探针 `tools/mapbadgeaudit.mjs` **同源**：落点算法取自 `./mapBadge.js`
   * （`chooseBadgeSide` / `pickRepresentativeUnit`），剪影几何与探针同口径。
   * 四条硬条件（team-lead）：
   *   ① 并入 y 排序 pass —— 本函数只在英雄那一趟里、`blit(hero_*)` 之后调用，
   *      徽标与英雄共享同一个 (y,x) 序，遮挡关系与英雄/怪物一致；
   *   ② 只横向压格、不纵向压 —— 直接用帧自带锚点落位，**不缩放**（缩放会伪造高度、破 y 排序）；
   *   ③ 可见性沿用英雄 —— 只在英雄会被画出的那一支里调；敌方英雄本就只在当前视野内出现
   *      ⇒ 不会在记忆/迷雾里泄漏敌队编成；
   *   ④ T5 取不到帧 ⇒ 跳过不画（`pickRepresentativeUnit` 未登记 + `silOf` 无帧双重兜底）。
   * 代表兵种 = `max(tier↓, count↓, canonicalId↑)`（§13.4，与探针同一个函数）。
   * 不随画质档：low/mid/high 一致（信息不能因档位缺失）。
   */
  private drawTeamBadge(vm: ViewModel, hid: string, owner: PlayerId, fx: number, fy: number): void {
    if (!this.badgesVisible) return; // 默认关；?devbadge 可开（因果 A/B 用）
    const hero = vm.state.heroes[hid];
    if (!hero) return;
    const cid = pickRepresentativeUnit(hero.army);
    if (!cid) return; // 空队 / 野怪 / T5 未登记
    const frameName = `u_${cid}_map`; // ⑤ 帧名只用 canonical id，owner 不参与
    const g = this.silOf(frameName);
    if (!g) return; // T5 等无帧 ⇒ 跳过不画（TODO：T5 精灵到位后自然生效）
    const hx = Math.round(fx);
    const hy = Math.round(fy);
    const heroName = `hero_${owner === 'neutral' ? 'neutral' : owner}`;
    // 障碍按"整枚棋子剪影（含旗）"取 —— 旗也是"这队是谁的"的信息载体，遮住即丢信息。
    const heroBody = this.silBBoxAt(heroName, hx, hy);
    if (!heroBody) return;
    const obstacles = this.collectObstacles(vm, hx, hy, 2);
    for (const oid of vm.state.heroOrder) {
      if (oid === hid) continue;
      const oh = vm.state.heroes[oid];
      if (!oh) continue;
      const rp = vm.heroRender[oid] ?? { x: oh.pos.x, y: oh.pos.y };
      const ob = this.silBBoxAt(`hero_${oh.owner === 'neutral' ? 'neutral' : oh.owner}`, Math.round(rp.x), Math.round(rp.y));
      if (ob) obstacles.push(ob);
    }
    const frame: BadgeFrame = { w: g.w, h: g.h, ax: g.ax, ay: g.ay, sil: g.sil };
    const side = chooseBadgeSide(hx, hy, frame, obstacles, heroBody);
    if (!side) return; // 四侧皆不满足 ⇒ 不画（不做降级）
    const c = sideCell(hx, hy, side);
    this.blit(frameName, c.x, c.y);
  }

  draw(vm: ViewModel): void {
    const ctx = this.ctx;
    const cam = this.camera;
    const { state, player } = vm;
    const map = state.map;
    const now = performance.now();
    // 水面翻页动画：4 帧一循环。260ms/帧比原来的 520ms 顺滑，
    // 再叠加下面连续移动的高光带，肉眼基本感觉不到跳帧
    // 低端档（waterGlint=false）水面冻结成静态帧，省掉逐格重建
    const waterFrame = quality.waterGlint ? Math.floor(now / 260) % 4 : 0;
    // 夜深程度 0~1：决定城镇灯火光晕的强度（深夜≈0.4，正午=0）
    const lightTint = lightingOn() ? currentLightTint(now) : { r: 255, g: 255, b: 255, warm: 0 };
    const nightDepth = Math.max(0, 1 - (lightTint.r + lightTint.g + lightTint.b) / 765);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);

    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.zoom, cam.zoom);

    const vis = computeVisible(state, player, vm.sight);
    const x0 = Math.max(0, Math.floor(-cam.x / (TILE * cam.zoom)) - 1);
    const y0 = Math.max(0, Math.floor(-cam.y / (TILE * cam.zoom)) - 1);
    const x1 = Math.min(map.width - 1, Math.ceil((cam.viewW - cam.x) / (TILE * cam.zoom)) + 1);
    const y1 = Math.min(map.height - 1, Math.ceil((cam.viewH - cam.y) / (TILE * cam.zoom)) + 1);

    /* --- 地形层：陆地/岸线/装饰整图烘焙，一帧一次 drawImage --- */
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrain.ensure(map), 0, 0);

    /* --- §6.1 喜剧布景层 · A 组地面涂鸦：紧接地形之后、水面之前（§6.1.3）。
       地面涂鸦永不遮挡单位 ⇒ 被后面所有图层（水 / 迷雾 / 路径 / 物件 / 英雄）自然盖住。 --- */
    if (quality.setDressing !== 'off') {
      ctx.drawImage(this.dressing.ensure(map), 0, 0);
    }

    /* --- 水面：唯一会动的地形，按帧画（只占可见且已探索的格子） --- */
    // 高光带：一条沿对角线扫过整张地图的正弦波，只有波峰经过的格子
    // 才点亮 2px 高光。波是连续移动的，看起来就是"碎光在水面上淌"，
    // 这是 SoC 水面氛围里性价比最高的一笔。每格采三个固定采样点。
    const GLINT_SPOTS: readonly (readonly [number, number])[] = [[9, 12], [22, 20], [14, 26]];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (map.tiles[idx(map, x, y)].terrain !== 'water') continue;
        if (!isRevealed(state, player, x, y)) continue;
        const h = hash2(x, y, 17);
        this.blit(`g_water_${h < 0.5 ? 0 : 1}_${waterFrame}`, x, y);

        if (!quality.waterGlint) continue; // 低端：不做水面高光
        for (const [ox, oy] of GLINT_SPOTS) {
          const wx = x * TILE + ox;
          const wy = y * TILE + oy;
          const wave = Math.sin((wx + wy * 0.6) / 13 - now / 430);
          if (wave > 0.9) {
            ctx.fillStyle = 'rgba(196,228,246,0.55)';
            ctx.fillRect(wx, wy, 2, 1);
          } else if (wave > 0.82) {
            ctx.fillStyle = 'rgba(150,200,230,0.3)';
            ctx.fillRect(wx, wy, 1, 1);
          }
        }
      }
    }

    /* --- 未探索遮盖：烘焙层含全图，未探索区用底色盖回去（与迷雾语义一致） --- */
    ctx.fillStyle = '#0b0d10';
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!isRevealed(state, player, x, y)) {
          ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        }
      }
    }

    /* --- 网格线（很淡，仅为可读性；低端关闭） --- */
    if (quality.gridLines) {
      ctx.strokeStyle = 'rgba(0,0,0,0.07)';
      ctx.lineWidth = 1 / cam.zoom;
      ctx.beginPath();
      for (let x = x0; x <= x1 + 1; x++) {
        ctx.moveTo(x * TILE, y0 * TILE);
        ctx.lineTo(x * TILE, (y1 + 1) * TILE);
      }
      for (let y = y0; y <= y1 + 1; y++) {
        ctx.moveTo(x0 * TILE, y * TILE);
        ctx.lineTo((x1 + 1) * TILE, y * TILE);
      }
      ctx.stroke();
    }

    /* --- 迷雾 --- */
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = idx(map, x, y);
        if (!isRevealed(state, player, x, y)) continue;
        if (vis[i]) continue;
        ctx.fillStyle = 'rgba(6,10,18,0.52)';
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }

    /* --- ④ 可达范围染色：可走=蓝、不可走=红格缘+墨色外描边（替换底部那条常驻移动力条）---
       位置**保持在世界坐标、实体循环之前**（与旧版一致）。这不是偷懒：
       世界坐标在 `ctx.restore()` 结束，而 `applyLighting` 是**屏幕空间**
       且在实体循环之后 ⇒ 把染色"搬"到光照之后，会**既错坐标、又盖住单位**。
       team-lead 的"夜间也要读得出"改用**对比度**解决（见常量处注释：红=色相锚、墨=明度锚），不改管线。
       不可走**只描格缘、不填色**（填色实测不可辨且面积巨大，见常量处注释）；
       格缘(红+墨)只画在**已揭开**、且外邻落在**可达区**（含英雄自身格）的那一侧。
       `#155`（**默认开**；`?devfogclose=0` 关）：再补"未探索格贴可达区那一侧"⇒ 轮廓在贴雾处闭合
       （`?devfogclose=0` 时未探索格不参与，逐像素回到旧版；见 `DEV_FOG_CLOSE` 的缺陷存证）。 --- */
    const cost = vm.reachable;
    // halo 预补偿（`?devhalocomp=1`）—— **与 `tintEnabled` 解耦**（硬条件 i）：本开关不嵌在
    // tint 守卫内，`?devtint=0` 不会连它一起关 ⇒ 「量测仪器」与「被测对象」互不门控。
    // multiply 是**全屏均匀**的 ⇒ 三条描边色每帧只反算一次。`lighting==='off'` 时 `applyLighting`
    // 提前 return（不乘光）⇒ 不能补，否则会把不乘光的画面错误提亮。
    const compOn = this.haloLightComp && quality.lighting !== 'off';
    const compLight: LightTint = compOn ? lightTint : { r: 255, g: 255, b: 255, warm: 0 };
    const edgeRed = compOn ? lightCompColor(NOGO_EDGE, compLight) : NOGO_EDGE;
    const edgeGlow = compOn ? lightCompColor(NOGO_EDGE_GLOW, compLight) : NOGO_EDGE_GLOW;
    const edgeInk = compOn ? lightCompColor(NOGO_EDGE_INK, compLight) : NOGO_EDGE_INK;
    // 修法 (1)（默认开；`?devhaloafter=0` 回退）：边带**推迟到光照之后**画 ⇒ 先登记、不立即填充。
    const afterBands: BandRect[] | null = this.haloAfter ? [] : null;
    // 边带落笔：默认（`afterBands===null`）立即填充，与原实现逐像素一致；开启 (1) 时只登记。
    const band = (c: string, bx: number, by: number, bw: number, bh: number): void => {
      if (afterBands) afterBands.push({ x: bx, y: by, w: bw, h: bh, c });
      else {
        ctx.fillStyle = c;
        ctx.fillRect(bx, by, bw, bh);
      }
    };
    // `?devtint=0` ⇒ `tintEnabled === false` ⇒ 整块跳过（染色层空操作）；
    // 不传旗标时 `tintEnabled === true` ⇒ `cost && true` ≡ `cost` ⇒ 与今天逐字节一致。
    if (cost && this.tintEnabled) {
      // 前沿判定：**含英雄自身格**（Dijkstra 起点 cost===0 也属于可达区），
      // 并要求相邻格**已揭开**（未探索处不出红线，否则红线会顺迷雾边界乱爬）。
      const inRegion = (x: number, y: number): boolean => {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
        if (!isRevealed(state, player, x, y)) return false;
        return isFinite(cost[idx(map, x, y)]);
      };
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const rev = isRevealed(state, player, x, y);
          // `#155`：**默认（不传参 ⇒ `fogClose === true`）让未探索格继续往下走**，只可能落在
          // "贴可达区那一侧"的边界带上（见下方 `top/bot/lft/rgt`）；`?devfogclose=0` ⇒ 未探索格
          // 在此 `continue` ⇒ 与旧版**同路**（逐像素回到旧版）。
          if (!rev && !this.fogClose) continue; // `?devfogclose=0` 时未探索不染色
          const c = cost[idx(map, x, y)];
          // `rev &&` 两道守卫：未探索格**永不填蓝、永不当英雄自身格** —— 即便默认开
          // 且它在迷雾里其实可走（`computePaths` 不看 `isRevealed`，故 fog 格可能有有限 cost）。
          if (rev && isFinite(c) && c > 0) {
            ctx.fillStyle = REACH_TINT; // 可走：蓝填充
            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
            continue;
          }
          if (rev && isFinite(c)) continue; // 英雄自身格（c===0）：在可达区内部，不填不描
          // ↓ 未探索格（**默认开**时）也会落到这里：`inRegion()` 要求相邻格**已揭开且可达**
          //   ⇒ 只有"贴可达区的那一侧"为真 ⇒ 恰好补上贴雾的缺口，且不在雾内部乱描。
          // 不可走：紧邻可达区的那一侧画**三线 = 红（色相锚）+ 亮芯 + 暗墨（双色 halo）**。
          // 顺序（贴可达区 → 不可走侧）：红(0) → 亮芯(EDGE_W) → 暗墨(2*EDGE_W)；亮/暗两锚落在**同一格地形**
          // ⇒ 暗底吃亮芯、亮底吃暗边 ⇒ 任何底色下两极其一必 ≥3:1（§4.6 (a-1)/(ii)）。
          const px = x * TILE;
          const py = y * TILE;
          const top = inRegion(x, y - 1);
          const bot = inRegion(x, y + 1);
          const lft = inRegion(x - 1, y);
          const rgt = inRegion(x + 1, y);
          if (top) band(edgeRed, px, py, TILE, EDGE_W); // ① 内侧红（色相锚，贴可达区一侧）
          if (bot) band(edgeRed, px, py + TILE - EDGE_W, TILE, EDGE_W);
          if (lft) band(edgeRed, px, py, EDGE_W, TILE);
          if (rgt) band(edgeRed, px + TILE - EDGE_W, py, EDGE_W, TILE);
          if (top) band(edgeGlow, px, py + EDGE_W, TILE, EDGE_W); // ② 亮芯（明度锚·亮极，不透明）
          if (bot) band(edgeGlow, px, py + TILE - EDGE_W * 2, TILE, EDGE_W);
          if (lft) band(edgeGlow, px + EDGE_W, py, EDGE_W, TILE);
          if (rgt) band(edgeGlow, px + TILE - EDGE_W * 2, py, EDGE_W, TILE);
          if (top) band(edgeInk, px, py + EDGE_W * 2, TILE, EDGE_W); // ③ 暗边墨（明度锚·暗极，不透明）
          if (bot) band(edgeInk, px, py + TILE - EDGE_W * 3, TILE, EDGE_W);
          if (lft) band(edgeInk, px + EDGE_W * 2, py, EDGE_W, TILE);
          if (rgt) band(edgeInk, px + TILE - EDGE_W * 3, py, EDGE_W, TILE);
        }
      }
    }

    if (vm.path && vm.path.length > 1) {
      ctx.fillStyle = 'rgba(255,246,214,0.85)';
      for (let k = 1; k < vm.path.length; k++) {
        const p = vm.path[k];
        ctx.fillRect(p.x * TILE + TILE / 2 - 2, p.y * TILE + TILE / 2 - 2, 4, 4);
      }
    }

    // 跨天行程的目的地小旗：杆 + 三角旗，金色与路径点呼应
    if (vm.dest && isRevealed(state, player, vm.dest.x, vm.dest.y)) {
      const bx = vm.dest.x * TILE + TILE / 2;
      const by = vm.dest.y * TILE;
      ctx.strokeStyle = 'rgba(240,205,110,0.95)';
      ctx.lineWidth = 1.5 / cam.zoom;
      ctx.beginPath();
      ctx.moveTo(bx, by + TILE - 1);
      ctx.lineTo(bx, by + 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(240,205,110,0.95)';
      ctx.beginPath();
      ctx.moveTo(bx, by + 2);
      ctx.lineTo(bx + 7, by + 4.5);
      ctx.lineTo(bx, by + 7);
      ctx.closePath();
      ctx.fill();
    }

    if (vm.hover && isRevealed(state, player, vm.hover.x, vm.hover.y)) {
      ctx.strokeStyle = 'rgba(240,205,110,0.95)';
      ctx.lineWidth = 2 / cam.zoom;
      ctx.strokeRect(vm.hover.x * TILE + 1, vm.hover.y * TILE + 1, TILE - 2, TILE - 2);
    }

    /* --- 第二遍：物件与英雄，按 y 排序保证遮挡正确 --- */
    const draws: DrawKind[] = [];
    // 2×2 城堡的四格挂的是同一个物件 id，这里按 id 去重、只在锚点画一次
    const seenObj = new Set<string>();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = idx(map, x, y);
        if (!isRevealed(state, player, x, y)) continue;
        const id = map.tiles[i].objectId;
        if (!id || seenObj.has(id)) continue;
        seenObj.add(id);
        const obj = map.objects[id];
        if (!obj) continue;
        const a = drawAnchor(obj);
        draws.push({ t: 'obj', y: a.y, x: a.x, obj });
      }
    }
    for (const hid of state.heroOrder) {
      const hero = state.heroes[hid];
      if (!hero) continue;
      const rp = vm.heroRender[hid] ?? { x: hero.pos.x, y: hero.pos.y };
      if (rp.x < x0 - 2 || rp.x > x1 + 2 || rp.y < y0 - 2 || rp.y > y1 + 2) continue;
      // 敌方英雄只在当前视野内出现：探索过的位置不会记住一个会走路的敌人
      if (hero.owner !== player && !vis[idx(map, Math.round(rp.x), Math.round(rp.y))]) continue;
      draws.push({ t: 'hero', y: rp.y, x: rp.x, id: hid, fx: rp.x, fy: rp.y, owner: hero.owner });
    }
    draws.sort((a, b) => a.y - b.y || a.x - b.x);

    for (const d of draws) {
      if (d.t === 'obj') {
        // 夜晚的城镇会亮灯：暖色光晕垫在精灵底下，像从窗户里透出来的光。
        // 只加深夜才看得见的那点火气——夜色越深灯越亮，正午完全不开。
        // 低端关灯火；中端半径 ×0.7（§4.2）。
        if (d.obj.kind === 'town' && quality.townGlow && nightDepth > 0.08) {
          const fp = d.obj.footprint ? 1 : 0.5;
          const cx = d.x * TILE + TILE * fp;
          const cy = d.y * TILE + TILE * fp;
          const rMul = quality.tier === 'mid' ? 0.7 : 1;
          const radius = TILE * (d.obj.footprint ? 2.4 : 1.8) * rMul;
          const alpha = Math.min(0.5, nightDepth * 1.15);
          const glow = ctx.createRadialGradient(cx, cy, TILE * 0.3, cx, cy, radius);
          glow.addColorStop(0, `rgba(255,186,92,${alpha.toFixed(3)})`);
          glow.addColorStop(0.55, `rgba(255,150,60,${(alpha * 0.4).toFixed(3)})`);
          glow.addColorStop(1, 'rgba(255,140,50,0)');
          ctx.fillStyle = glow;
          ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
        }
        const sprite = objSprite(state, d.obj, hash2(d.x, d.y, 91));
        if (sprite) this.blit(sprite, d.x, d.y);
        const mk = guardMarker(d.obj);
        if (mk) this.blitAt(mk, d.x * TILE + 17, d.y * TILE + 17);
        // 矿场归属旗：没旗子 = 还没人占，插上谁的旗就归谁产
        this.blitMineFlag(d.obj, d.x, d.y);
        // 记忆中的（已探索但当前不可见）物件压暗；多格物件逐格判断
        ctx.fillStyle = 'rgba(6,10,18,0.4)';
        for (const c of footprintOf(d.obj)) {
          if (!isRevealed(state, player, c.x, c.y)) continue;
          if (vis[idx(map, c.x, c.y)]) continue;
          ctx.fillRect(c.x * TILE, c.y * TILE, TILE, TILE);
        }
      } else {
        const sel = d.id === vm.selectedHeroId;
        if (sel) {
          // 低端把选中脉冲降到慢呼吸（selectionPulseHz=2），中/高端维持原手感
          const pulseDiv = quality.selectionPulseHz >= 4 ? 260 : 500;
          const pulse = 0.35 + 0.25 * Math.sin(now / pulseDiv);
          ctx.fillStyle = `rgba(240,205,110,${pulse.toFixed(3)})`;
          ctx.beginPath();
          ctx.ellipse(d.fx * TILE + TILE / 2, d.fy * TILE + TILE - 4, 11, 4.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // 敌方英雄脚下加一圈阵营色底盘，多阵营混战时一眼看清谁是谁
        if (d.owner !== player) {
          ctx.fillStyle = factionColor(d.owner);
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.ellipse(d.fx * TILE + TILE / 2, d.fy * TILE + TILE - 4, 10, 4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        this.blit(`hero_${d.owner === 'neutral' ? 'neutral' : d.owner}`, Math.round(d.fx), Math.round(d.fy));
        // §13.4 队伍徽标：紧跟在英雄之后、同一趟 y 排序里画（硬条件 ①「并入 y 排序」）。
        this.drawTeamBadge(vm, d.id, d.owner, d.fx, d.fy);
      }
    }

    ctx.restore();

    /* --- 光照层（屏幕空间）：昼夜 multiply 叠色 + 暖光 + 暗角 --- */
    if (lightingOn()) this.applyLighting(now);

    /* --- 修法 (1)：三条边带改画在光照**之后**（默认开；`?devhaloafter=0` 回退旧路径） ---
       仍走世界坐标 + 相机变换（`ctx.restore()` 后变换已回到 dpr 基准，`applyLighting`
       内部自带 save/restore 不改它）⇒ 坐标与旧版一致；唯一差别 = 这三条带不再被上面的
       multiply 乘暗。`?devhaloafter=0`（回退）时 `afterBands===null` ⇒ 本段空操作。 --- */
    if (afterBands && afterBands.length > 0) {
      ctx.save();
      ctx.translate(cam.x, cam.y);
      ctx.scale(cam.zoom, cam.zoom);
      for (const b of afterBands) {
        ctx.fillStyle = b.c;
        ctx.fillRect(b.x, b.y, b.w, b.h);
      }
      ctx.restore();
    }
  }

  /**
   * 屏幕空间光照（§4.2 分档，§M-03）：
   * - quality.lighting === 'off' → 整段跳过（也受既有 lightingOn() 总开关约束）；
   * - multiply 单次叠色：深夜压蓝、清晨黄昏带暖（低/中端都有）；
   * - warm overlay 暖光：仅 full 档且 warmOverlay 打开；
   * - 暗角：仅 vignette 打开（低端关）。
   *
   * 性能：两个 gradient 都按视口尺寸缓存，尺寸不变时不重建；暖光强度改用
   * globalAlpha 承载，这样梯度对象可以复用（CanvasGradient 的 colorStop 不能清空，
   * 之前每帧新建正是 GC 压力的来源）。
   */
  private applyLighting(now: number): void {
    if (quality.lighting === 'off') return;
    const ctx = this.ctx;
    const { viewW: w, viewH: h } = this.camera;
    if (!w || !h) return;
    const tint = currentLightTint(now);

    if (tint.r < 255 || tint.g < 255 || tint.b < 255) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${tint.r},${tint.g},${tint.b})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // 清晨/黄昏的暖光：从右上斜进来的正橘色，强度随时间起伏
    if (quality.lighting === 'full' && quality.warmOverlay && tint.warm > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = tint.warm; // 强度走 globalAlpha，梯度按 warm=1 复用
      ctx.fillStyle = this.warmGradient(w, h);
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // 暗角：很轻，只为把视线收向中心（SoC 截图里几乎张张都有）
    if (quality.vignette) {
      ctx.save();
      ctx.fillStyle = this.vignetteGradient(w, h);
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  /** 暖光梯度（固定 warm=1，强度由 globalAlpha 施加），按尺寸缓存。 */
  private warmGradient(w: number, h: number): CanvasGradient {
    if (!this.warmGrad || this.warmGradW !== w || this.warmGradH !== h) {
      const g = this.ctx.createLinearGradient(w, 0, 0, h);
      g.addColorStop(0, 'rgba(255,196,120,0.9)');
      g.addColorStop(0.55, 'rgba(255,170,100,0.35)');
      g.addColorStop(1, 'rgba(255,150,90,0)');
      this.warmGrad = g;
      this.warmGradW = w;
      this.warmGradH = h;
    }
    return this.warmGrad;
  }

  /** 暗角径向梯度（静态），按尺寸缓存。 */
  private vignetteGradient(w: number, h: number): CanvasGradient {
    if (!this.vigGrad || this.vigGradW !== w || this.vigGradH !== h) {
      const v = this.ctx.createRadialGradient(
        w / 2, h / 2, Math.min(w, h) * 0.42,
        w / 2, h / 2, Math.hypot(w, h) / 1.6,
      );
      v.addColorStop(0, 'rgba(8,10,16,0)');
      v.addColorStop(1, 'rgba(8,10,16,0.22)');
      this.vigGrad = v;
      this.vigGradW = w;
      this.vigGradH = h;
    }
    return this.vigGrad;
  }
}
