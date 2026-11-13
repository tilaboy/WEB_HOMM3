import type { GameState, GridPos, MapObject, PlayerId } from '../core/types.js';
import { factionColor } from '../core/data/factions.js';
import { STAT_BOOSTS } from '../core/data/statBoosts.js';
import { computeVisible, isRevealed } from '../core/map/fog.js';
import { drawAnchor, footprintOf, idx } from '../core/map/grid.js';
import { Camera } from './camera.js';
import { TILE } from './ortho.js';
import { getAtlas } from './atlas.js';
import { hash2 } from './pixel.js';
import { TerrainLayer } from './terrainLayer.js';
import { SetDressingLayer } from './setDressing.js';
import { currentLightTint, lightingOn } from './lightLayer.js';
import { townSpriteKey } from './townSprite.js';
import type { LightTint } from './lightLayer.js';
import { quality, syncAmbientBaseline } from './quality.js';
import {
  chooseBadgeSide,
  isOutbreakObject,
  outbreakMarkRect,
  pickRepresentativeUnit,
  sideCell,
  OUTBREAK_MARK_RIM,
  OUTBREAK_MARK_SIZE,
  type BadgeFrame,
  type BBox,
} from './mapBadge.js';
import { unitMapFrame } from './unitFrames.js';

export interface ViewModel {
  state: GameState;
  player: PlayerId;
  sight: number;
  reachable: Float64Array | null;
  /**
   * **不限移动力**的代价场（`computePaths(..., Infinity)`）。
   *
   * `reachable` 里"超出移动力"与"地形不可走"都是 `Infinity`，只靠它分不出这两种格；
   * 而 `shade` 默认要压暗的**只有前者**（"路能走、但这回合走不到"）—— 后者（树/水/山/城）
   * 由美术自己表达，压暗只会把湖面画脏。没有它时 `shade` 退化成"只铺蓝洗"。
   */
  walkable?: Float64Array | null;
  path: GridPos[] | null;
  /**
   * 预览路径的**起点**（英雄所在格）。
   *
   * `buildPath()` 只返回**步子**、不含起点（`pathfinding.ts:138` 的 `while (cur !== start)`），
   * 所以只拿 `path` 画折线会整整少一段"英雄→第一格"。§18 的提交信息写着"从英雄脚下出发"，
   * 当时并不成立 —— 2026-10-24 补上这个字段才算数。
   */
  pathFrom?: GridPos | null;
  /**
   * 沿 `path` 走**今天**能走完的步数（`path.length` 或省略 = 全程都是今天；`0` = 今天一步都走不了）。
   *
   * 由主程序沿路径累加 `stepCost` 算出，**不是**用"剩余移动力 ÷ 平均代价"估的 ——
   * 地形代价差 1~3 倍，估出来的分界会落在**走不到**的格子上（那正是这条信息要防的错）。
   */
  pathDay?: number;
  /**
   * 沿 `path` 每一天走完的步数（递增，末尾恒等于 `path.length`）。
   *
   * `pathDay` 只够画**一道**刻痕 —— 跨三天时第二道就没了，玩家会把三天读成两天。
   * 由主程序用 `dayStops()` 一次算出整天表；渲染器只负责照表画刻痕。
   */
  pathDays?: number[];
  /**
   * 英雄**一整天的移动力上限**（`maxMovePoints`，满值 1800）。
   *
   * 只喂给"虚线流动"的速度：走得快的英雄，虚线也该走得快 —— 否则这条动画在
   * 移速 2400 的英雄和 1200 的英雄身上是同一个节奏，等于一个与内容无关的装饰。
   * 传 0/省略 ⇒ 用基准速度（调试路径、没有英雄的场景）。
   */
  pathMp?: number;
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
      const own = t && t.owner !== 'neutral' ? t.owner : 'neutral';
      // 档位 = **城防等级**（wall1/2/3），不再是兵营数量（§14.3 G5，2026-11-06）。
      // 2×2 城堡用 `castle_*`（城门固定在左下角），1×1 用 `town_*`。
      return townSpriteKey(t, own, !!obj.footprint);
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
    case 'statBoost': {
      const def = STAT_BOOSTS[(obj.payload as { boostId: string }).boostId];
      // 未知 id 宁可不出图（§13.4 ③「宁可缺不可错」），也别随便给一个台子
      return def ? `stat_${def.iconStat}_${def.pips}` : null;
    }
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
 * 可达范围的**格心双色点**（`dots` 模式的全部落笔）。
 *
 * 为什么要两色：与边带同一套道理 —— 单色在任何一档地形上都会沉掉。
 * 暖芯 `#fff3c8`（= `hi1`）在暗草/夜相下亮；墨环 `#2a1a12`（= `ink0`）
 * 在沙地这类亮底上给它一个轮廓。两者叠在一个 4×4 的墨底 + 2×2 的芯上。
 *
 * 尺寸口径：世界 px。TILE=32，真机 zoom 1.2 ⇒ 4 世界 px ≈ **4.8 画面 px**，
 * 是"数得清的星星"而不是"贴了一张网点纸"。放大到 2× 时也不会变成色块。
 */
const REACH_DOT_INK = '#2a1a12';
const REACH_DOT_CORE = '#fff3c8';
/** 点心的半宽（世界 px）：墨底 2 ⇒ 4×4；暖芯 1 ⇒ 2×2。 */
const REACH_DOT_R = 2;
const REACH_DOT_CORE_R = 1;

/**
 * 预览路径的地标（`vm.path`，按住/悬停时那条路线）——**带方向的箭头**，不是圆点。
 *
 * ## 为什么从"方点"改成"箭头"（2026-10-24 第二轮）
 * 方点只回答"这格在路线里"，回答不了"**往哪走**"。玩家要读一条 10 步的路线，
 * 只能自己把点按顺序连成线 —— 而这条线是要用手指去点的，读错一步就多点一次。
 * HoMM3 的做法是连续箭头，这里用**每步一枚折角箭头（chevron）**近似：
 * 尖头朝下一格，末步换成实心三角（终点读起来更硬）。
 *
 * ## 为什么不是"一串连着的线"
 * 32px 格、真机 zoom 1.2 ⇒ 一格只有 38 画面 px；连续线会把地形压住，
 * 也不好在拐角处表达"这里要转"。折角箭头留在格心，拐角自然读得出来。
 *
 * ## 颜色与层级
 * 墨底 `#2a1a12` + 金 `#ffe6a0`（与跨天小旗 `rgba(240,205,110)` 同族）。
 * 层级「路线 > 边界」：可达点是 4×4 墨底 + 2×2 暖白芯；箭头跨 7×6 世界 px 且带方向。
 */
const PATH_DOT_INK = '#2a1a12';
const PATH_DOT_CORE = '#ffe6a0';
/** 折角的半长/半高（世界 px）：尖头到 +2.2、两翼到 −2.4 ± 2.9。 */
const PATH_ARROW_TIP = 2.2;
const PATH_ARROW_BACK = 2.4;
const PATH_ARROW_WING = 2.9;
/** 末步实心三角：尖 3.6、底 ±2.2。 */
const PATH_HEAD_TIP = 3.6;
const PATH_HEAD_BASE = 2.2;
/**
 * `probeReach`/`probeDots` 的取色半径（世界 px）。
 * 箭头不吃满一个 6×6 的方块，但它的两翼伸到 ±2.9、尖到 +3.6 ⇒ 取色窗必须够到那儿，
 * 否则"最亮点"会落到底色上、把箭头本身漏掉（那会把 4.09 读成 1.x）。
 */
const PATH_DOT_R = 4;

/**
 * "明天"那一段怎么画：**同一套金色、更细的笔画、虚线**。
 *
 * 首版用冷蓝（`#8fb6d6`）表达"明天"，实测**在城堡蓝屋顶上整段消失**
 * （截图 `production/render-pathday/01` 之前那一版：蓝线压蓝顶，对比≈0）。
 * 蓝色在这款游戏里是水位与屋顶的颜色，不能拿来当语义色 —— 它会被场景本身吃掉。
 * 所以差的不是"颜色"而是"线型"：今天粗实线、明天细虚线，交界一道刻痕。
 * 这样它在任何底色上都还靠那圈墨边站得住（与点、边带同一套双色锚）。
 */
const PATH_NEXT_INK = PATH_DOT_INK;
const PATH_NEXT_CORE = PATH_DOT_CORE;

/**
 * 画一枚方向地标（世界坐标，调用方已套好相机变换）。
 *
 * 画法刻意"像素友好"：不用圆头/阴影，全用 miter 折角与实心三角 ——
 * 32px 格上任何抗锯齿的柔边都会让它糊成一团（与 §15 的点同理）。
 * 折角箭头（chevron）负责"有方向"，末步实心三角负责"到这儿"。
 *
 * `next` = 走在"今天"之后的那一段（跨天行程）：**只换颜色、不换大小**。
 * 大小是层级（箭头 > 边界点），颜色才是"今天 / 明天"；混用两者会让两件事互相污染。
 */
function drawPathArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  head: boolean,
  next = false,
): void {
  const ink = next ? PATH_NEXT_INK : PATH_DOT_INK;
  const core = next ? PATH_NEXT_CORE : PATH_DOT_CORE;
  if (dx === 0 && dy === 0) return;
  ctx.save();
  ctx.translate(cx, cy);
  // 8 邻域 ⇒ 45° 的整数倍；`atan2` 用格坐标（y 向下），与屏幕一致。
  ctx.rotate(Math.atan2(dy, dx));
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  if (head) {
    ctx.beginPath();
    ctx.moveTo(PATH_HEAD_TIP, 0);
    ctx.lineTo(-PATH_HEAD_BASE, -PATH_HEAD_BASE);
    ctx.lineTo(-PATH_HEAD_BASE, PATH_HEAD_BASE);
    ctx.closePath();
    ctx.fillStyle = ink;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(PATH_HEAD_TIP - 1.5, 0);
    ctx.lineTo(-PATH_HEAD_BASE + 1.0, -PATH_HEAD_BASE + 1.2);
    ctx.lineTo(-PATH_HEAD_BASE + 1.0, PATH_HEAD_BASE - 1.2);
    ctx.closePath();
    ctx.fillStyle = core;
    ctx.fill();
  } else {
    const chevron = (): void => {
      ctx.beginPath();
      ctx.moveTo(-PATH_ARROW_BACK, -PATH_ARROW_WING);
      ctx.lineTo(PATH_ARROW_TIP, 0);
      ctx.lineTo(-PATH_ARROW_BACK, PATH_ARROW_WING);
    };
    chevron();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3.0;
    ctx.stroke();
    chevron();
    ctx.strokeStyle = core;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 一条预览路径的完整描述：**今天**段（实线、金）+ **明天**段（虚线、冷）+ 交界刻痕。
 *
 * 为什么要有第二段（2026-10-24 三版）：旧实现把整条路线画成同一条实线，
 * 玩家看不出"今天只能走到哪" —— 而跨天行程是**一回合一次决策**的游戏里最贵的一条信息
 * （点下去、英雄走一半停了、提示"明天按 M 继续"，然后玩家才发现自己点远了）。
 *
 * 三种表达叠在一起，是为了**不靠单一通道**也能读出来：
 *   ① 颜色：金（今天）/ 冷蓝（明天）—— 一眼分开两段；
 *   ② 线型：实线 / 虚线 —— 色觉障碍或极端底色下也分得开（也是可机检的那条，见 `probe:pathday`）；
 *   ③ 刻痕：交界格上一道垂直于前进方向的短杠 —— "今天到此收工"。
 */
type PathLine = {
  now: Array<[number, number]>;
  next: Array<[number, number]>;
  cornersNow: Array<[number, number, number, number]>;
  cornersNext: Array<[number, number, number, number]>;
  end: [number, number];
  /**
   * 每一天的交界格：`[cx, cy, dx, dy]`，`dy` 为**到达该格的方向**（刻痕横切它）。
   *
   * 是**数组**而不是单个：跨三天的行程有两天交界（§21）。只画一次的话，玩家看到
   * "一道刻痕 + 一段虚线"会读成"两天到"，而实际要三天 —— 这条信息是错的，不是不全。
   */
  cuts: Array<[number, number, number, number]>;
};

/** 一条折线（先墨后亮：外层保证在沙/雪这类亮底上也读得出，与点、边带同一套双色锚）。 */
function strokePath(
  ctx: CanvasRenderingContext2D,
  pts: Array<[number, number]>,
  ink: string,
  core: string,
  dash: number[] | null,
  inkW: number,
  coreW: number,
  dashOffset = 0,
): void {
  if (pts.length < 2) return;
  ctx.lineJoin = 'round';
  /* ★ 虚线必须用**平头**。圆头会把每段两端各延长 `lineWidth/2`
     （3.0 宽 ⇒ 两端共 3.0），3.4 的缺口只剩 0.4 ⇒ 看上去是实线，
     探针也永远量不到空档（实测：明天段 6 个采样点 0 个空）。
     这是"虚线画成实线"最常见的一种死法，且肉眼在长线上几乎看不出来。 */
  ctx.lineCap = dash ? 'butt' : 'round';
  ctx.setLineDash(dash ?? []);
  /* 负号 = 让虚线沿路径**前进**（`lineDashOffset` 增大是把图案往回挪）。
     这是流动的全部实现：几何一个像素都不动，只挪相位。 */
  ctx.lineDashOffset = dashOffset;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  };
  trace();
  ctx.strokeStyle = ink;
  ctx.lineWidth = inkW;
  ctx.stroke();
  trace();
  ctx.strokeStyle = core;
  ctx.lineWidth = coreW;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

/**
 * 连续折线形态（默认）：一条从**英雄脚下**出发、沿格心连到终点的带描边折线，
 * 拐点补小折角、末端加实心三角；跨天行程在交界处断开成两段（见 `PathLine`）。
 *
 * 为什么两臂都留着：折角箭头"不压地形、拐角清楚"但有约 30px 空隙；连续线"一眼读完"、
 * 但会从地砖中间穿过去。哪一臂更好看是审美判断，可量的部分是"压了多少地形"
 * （`probe:pathdots` 的 covered 与整屏差异）—— 所以先把两臂都做成可切换的。
 */
function drawPathLine(ctx: CanvasRenderingContext2D, L: PathLine, flow = 0): void {
  if (L.now.length < 2 && L.next.length < 2) return;
  // 今天：实线金。明天：虚线冷色 —— 虚线段长/间隔按世界 px（调用方已 scale）。
  strokePath(ctx, L.now, PATH_DOT_INK, PATH_DOT_CORE, null, 4.2, 1.9);
  /* 明天：同色、更细（3.0 / 1.3）、虚线。
     缺口 3.4 世界 px 必须**比探针的细窗宽**（2.5 世界 px，见 `probePath`），
     否则"虚线留空"这件事永远量不出来 —— 两侧的墨会被窗一起收进去。 */
  strokePath(ctx, L.next, PATH_NEXT_INK, PATH_NEXT_CORE, [3.0, 4.2], 3.0, 1.3, -flow);
  for (const [cx, cy, dx, dy] of L.cornersNow) drawPathArrow(ctx, cx, cy, dx, dy, false, false);
  for (const [cx, cy, dx, dy] of L.cornersNext) drawPathArrow(ctx, cx, cy, dx, dy, false, true);
  /* 交界刻痕：垂直于**明天第一步**的方向。它同时盖住今天线的末端与明天线的起点 ⇒
     玩家读到的是"这条线在这里被切了一刀"，而不是"两段颜色碰巧接上了"。 */
  for (const [cx, cy, dx, dy] of L.cuts) {
    ctx.save();
    ctx.translate(cx, cy);
    /* ★ `+ π/2` 不是可有可无的：`fillRect(-4.5, -1.1, 9, 2.2)` 的长轴在**局部 x** 上，
       而 `rotate(atan2(dy,dx))` 把局部 x 转到**行进方向** —— 于是这根 9px 的长杠
       顺着路走，看上去只是"线在那一格粗了一点"，根本没有"切一刀"的意思。
       转 90° 之后长轴才横跨路径。2026-10-24 实测：改之前 3× 特写下完全看不出刻痕，
       而 `cut-mark` 判据（只看中心像素是黑的）**照样是绿的** —— 因为顺着路的墨杠
       也把中心压黑了。判据必须量**两侧**（见 `probePath().day.cutCross`）。 */
    ctx.rotate(Math.atan2(dy, dx) + (CUT_CROSS ? Math.PI / 2 : 0));
    /* 整条压黑、**不留亮芯**。首版给了它一根金色内芯，结果刻痕中心是亮的（实测 0.8039）——
       "切一刀"读不出来，倒像线上多了个亮点；探针那条"中心被压黑"也就永远红。
       刻痕的语义是**否定**（今天到此为止），所以它必须比线更暗，不能比线更亮。 */
    /* 细长横杠（9 × 2.2 世界 px）：短边顺着路、长边横切过去。
       32px 格上 9px 约 1/4 格宽 —— 够看见，又不至于盖住地形。 */
    ctx.fillStyle = PATH_DOT_INK;
    ctx.fillRect(-4.5, -1.1, 9, 2.2);
    ctx.restore();
  }
  const pts = L.next.length >= 2 ? L.next : L.now;
  const last = pts[pts.length - 1];
  drawPathArrow(ctx, last[0], last[1], L.end[0], L.end[1], true, L.next.length >= 2);
}

/**
 * 路径地标也**画在光照之后**（默认开；`?devpathafter=0` 回退旧路径）。
 *
 * 旧代码里它是世界坐标里一枚 `rgba(255,246,214,0.85)` 的 4×4 —— 被整屏 multiply 一起乘暗，
 * 于是夜里**路线比边界点还暗**（路线是玩家下一步要点的东西，却是整屏最不清楚的一层）。
 * 与 §15.3 的点、§14 的过渡带同一条纪律 ⇒ 一律画在光照之后。
 */
const PATH_AFTER = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devpathafter') !== '0';
  } catch {
    return true;
  }
})();

/**
 * 路径格上**不落可达点**（默认开；`?devpathmask=0` 关掉，作负向对照用）。
 *
 * 理由：一枚路径地标 = "我要从这格过"，此时再叠一枚"这格能到"的点，同一位置两个标记
 * 互相啃；而路径本身就是可达区内部的一条线，它的格子从来不需要"能到吗"的回答。
 */
const PATH_MASK = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devpathmask') !== '0';
  } catch {
    return true;
  }
})();

/**
 * 跨天分段（默认开；`?devpathday=0` 关掉，作负向对照与"退回整条实线"用）。
 *
 * 关掉时渲染器把整条路径都当"今天"画（一条实线金），**不画交界刻痕** ——
 * 这正是本批要改掉的旧表现，留着它才能让 `probe:pathday` 有一条会变红的对照臂。
 */
const PATH_DAY = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devpathday') !== '0';
  } catch {
    return true;
  }
})();

/**
 * 交界在**屏幕外**时，在屏幕边缘补一枚指示（默认开；`?devpathedge=0` 关掉，作负向对照）。
 *
 * 为什么需要它：满移动力（1800）时"今天"约 18 格，而视口纵向只有 11 格 ——
 * 交界通常落在**屏幕之外**。"今天走到哪"这条信息因此看不见，而这个功能存在的全部理由就是它。
 * 指示符沿用交界刻痕的同一套语言（一道横切短杠 + 朝外的一小段金线），
 * 读法是"路往那边去，今天在那儿为止"。
 */
const PATH_EDGE = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devpathedge') !== '0';
  } catch {
    return true;
  }
})();

/**
 * 屏幕边缘那枚指示符旁边写一句"还有 N 天"（默认开；`?devpathedgelabel=0` 关掉，作负向对照）。
 *
 * 为什么要文字：那枚指示符本身只说"今天在那边收工"，不说"还差几天"。
 * 玩家真正要判断的是"现在点这一下，是不是要花三天"——而这个数字一直只存在于
 * 悬停提示里（手指按住时被自己的手挡住，正是最需要的时候看不见）。
 *
 * 两条纪律：
 *   ① **只在出画时画**：交界在屏内时刻痕自己就是答案，再贴一块牌子只是噪音；
 *   ② 牌子必须**自己解决对比度**（深底 + 金字的暗牌），因为它压在任意地形上，
 *      而地图底色从雪原 `#eef3f7` 到沼泽 `#3a3a22` 差着几十级明度。
 */
const EDGE_LABEL = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devpathedgelabel') !== '0';
  } catch {
    return true;
  }
})();

/**
 * 路径"流动"：明天那一段的虚线沿路线**向前**走（HoMM3 同款）。
 *
 * 为什么值得做：一条静止的虚线只说明"这条路要分几天"，说不出"**往那边走**"。
 * 流动的虚线把方向也一起说了，而且不需要再加箭头或文字。
 *
 * 三条纪律：
 *   ① 只动**虚线相位**，不动几何 —— 位置、长度、颜色一个字都不改，判据的其余读数不受影响；
 *   ② 尊重 `prefers-reduced-motion`：系统开了"减少动态"就完全静止（实测可机检，见 `probe:pathflow`）；
 *   ③ `?devflowphase=0..1` 钉死相位，`?devflow=0` 关掉 —— 截图与判据要能重复，不能靠"抓一帧"。
 */
const FLOW = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devflow') !== '0';
  } catch {
    return true;
  }
})();
/** 固定相位（0~1 个周期）；不给则按墙上时间自由跑。 */
const FLOW_PIN = ((): number | null => {
  try {
    const v = new URLSearchParams(location.search).get('devflowphase');
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
})();
/** 流动的基准速度（世界 px / 秒，满移动力 1800 的英雄）与虚线周期（3.0 实 + 4.2 空）。 */
const FLOW_BASE = 9;
const FLOW_PERIOD = 7.2;
/** 基准移动力：`maxMovePoints` 的满值。速度按 `mp / 1800` 线性缩放。 */
const FLOW_REF_MP = 1800;
/** 缩放夹紧：太慢看着像卡住、太快像在抖（1200 的慢英雄 0.8×，2700 的快英雄 1.4×）。 */
const FLOW_MIN_K = 0.8;
const FLOW_MAX_K = 1.4;
/** 负向对照：`?devflowfixed=1` 让流速退回写死的基准值（`flow-pace-ctl` 用）。 */
const FLOW_FIXED = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devflowfixed') === '1';
  } catch {
    return false;
  }
})();
/** 测试用：`?devpathpace=2700` 直接指定移动力，不必造一个真有那么多移动力的英雄。 */
const FLOW_PACE_OVERRIDE = ((): number | null => {
  try {
    const v = new URLSearchParams(location.search).get('devpathpace');
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
})();

/**
 * 本帧的流动速度（世界 px/s）。
 *
 * 为什么按移动力缩放：这条动画唯一的语义是"**还在往前走**"。而"走多快"是有数据的 ——
 * 英雄一天的移动力（`maxMovePoints`）。同一个 9px/s 落在移速 1200 与 2400 的英雄身上，
 * 一个是"散步"、一个是"倒放"；跟内容挂钩之后，它才在说同一句实话。
 *
 * 夹紧到 0.8~1.4 是有意的：这不是仪表盘，慢到 0.3× 会像卡帧，快到 2× 会像抖动。
 */
function flowSpeed(mp?: number): number {
  /* `?devflowfixed=1`：退回"写死 9px/s"的旧行为 —— `flow-pace-ctl` 的负向对照。
     没有它，那条判据只能证明"两个数不相等"，证明不了"相等的原因是被固定住了"。 */
  if (FLOW_FIXED) return FLOW_BASE;
  const m = FLOW_PACE_OVERRIDE ?? mp;
  if (!m || !Number.isFinite(m) || m <= 0) return FLOW_BASE;
  const k = Math.max(FLOW_MIN_K, Math.min(FLOW_MAX_K, m / FLOW_REF_MP));
  return FLOW_BASE * k;
}
/** 系统"减少动态"：整层静止。 */
const REDUCE_MOTION = ((): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
})();

/** 当前相位（世界 px，0~周期）。三种来源：关掉 / 钉死 / 墙上时间。 */
function flowPhase(mp?: number): number {
  if (!FLOW || REDUCE_MOTION) return 0;
  if (FLOW_PIN !== null && Number.isFinite(FLOW_PIN)) {
    return (((FLOW_PIN % 1) + 1) % 1) * FLOW_PERIOD;
  }
  return ((performance.now() / 1000) * flowSpeed(mp)) % FLOW_PERIOD;
}

/**
 * 刻痕是否**横切**路径（默认开；`?devcutcross=0` 画成顺着路的一根墨杠，当负向对照）。
 *
 * 为什么需要这个开关：`cut-mark` 原来只量"交界格中心是不是黑的"，而一根**顺着路**的
 * 墨杠同样会把中心压黑 ⇒ 判据绿着、画面上什么也没有（2026-10-24 实测）。
 * 现在判据改成量**两侧**（法线 ±3.2 世界 px），这个开关就是它的负向对照：
 * 关掉之后两侧应该恢复成底色，判据必须变红。
 */
const CUT_CROSS = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devcutcross') !== '0';
  } catch {
    return true;
  }
})();

/**
 * 路径地标的**形态**：`line`（默认：连续折线 + 箭头头部）或 `chevron`（每格一枚折角箭头）。
 *
 * 为什么把默认从 chevron 翻成 line（2026-10-24 当晚，同机位两臂比过）：
 *   · `chevron` 步间有约 30px 空隙，10 步路线要靠眼睛把点连起来 —— 而这条线是要用手指点的；
 *   · `line` 一条线读完（1× 整屏截图里也是一条连贯的金线），代价是它**从地砖中间穿过去**，
 *     峰值对比从 4.21 降到 4.16、中位略降 —— 仍在 3.0 以上。
 * 两臂都保留：`?devpathline=0` 切回 chevron。这不是"留个开关好看"，是让
 * "连续线真的更连续"这件事可量（`probe:pathdots` 的 `pathcont`：相邻格**中点**上是否也有线）。
 */
const PATH_LINE = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devpathline') !== '0';
  } catch {
    return true;
  }
})();

/**
 * 点阵铺在**哪些格**上：`edge`（默认，只描可达区外缘）或 `all`（每格一枚）。
 *
 * 实测对比：`all` 是"每格一个点"，在 844×390 上形成一张**规则格子阵** ——
 * 它把 32px 网格又强调了一遍，反而更像工程网格而不是"能走到这儿"。
 * `edge` 只在外缘落点 ⇒ 得到的是一条**点状轮廓**，内部干净，且外缘正是玩家要判断的那条线。
 * `?devdots=all` 可切回全铺（A/B 与负向对照用）。
 */
const REACH_DOT_MODE = ((): 'edge' | 'all' => {
  try {
    return new URLSearchParams(location.search).get('devdots') === 'all' ? 'all' : 'edge';
  } catch {
    return 'edge';
  }
})();

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

/**
 * ④ 边界带的**形态**（`?devband=full|thin|art|soft|off`）。
 *
 * 起因（2026-10-21 真机走查 · 主理人反馈）：`phone-01-tutorial.png` 上「英雄能走的地方」
 * 与树 / 水 / 山之间**被直线切开**，每个障碍物都像被套了一只方框。
 *
 * 读码：那不是地图美术，是 ④ 的**三色边带** —— 每一格不可走、只要有一侧贴可达区，
 * 就在那一侧画 `红 2px + 亮芯 2px + 墨 2px`。**1×1 的树四侧全贴可达区 ⇒ 得到一只闭合方框**；
 * 6 世界 px 在真机 `s=0.784 × DPR3` 下 ≈ **14 物理 px**，比任何一格美术都粗。
 * 于是"可达性提示"变成了地图上最响的图形元素 —— 这是**层的作用域**问题，不是配色问题。
 *
 * **默认暂置 `shade`**（2026-10-21：`soft` 仍被嫌"白框"，方案 D「外圈压暗」= 一条线都不画。
 * ⚠️ 这是**待拍板的推荐值**，不是已定案；`production/design-session-2026-10-21.md` §1 给了 A/B/C/D 四案，
 * 选别的只需改下面 `BAND_MODE` 的兜底串一行。先置成 D 是为了让你直接看实物再决定。）
 * 做法：可达区铺 16% 蓝色水洗；**已揭开、地形本身能走但超出移动力**的格子压暗 16% ⇒
 * 边界由两侧**明度差**读出来，像阴影而不是描边（与"暗缝用双色 halo"同源：一暗一亮，都不靠线条）。
 * 自带形体的不可走格（树/岩/山/水/城）**一律不动** —— 它们的轮廓本来就由美术给出，
 * 而且"压暗湖面"会把水画脏。雾界也不压（雾本来就比可达区暗，压了看不出差别）。
 *
 * 旧路径全部保留，`?devband=` 可逐块取回：
 *   · `shade`（**默认**）＝ 蓝洗 + 外圈压暗，无任何线条；
 *   · `soft`  ＝ 亮芯 1px + 墨 1px，且自带形体不描（上一版默认）；
 *   · `full`  ＝ 旧版：红 + 亮芯 + 墨 各 2px，所有贴可达区的一侧都画；
 *   · `thin`  ＝ 只换厚度与色栈：亮芯 1px + 墨 1px（去红锚），作用域不变；
 *   · `art`   ＝ 只换作用域：自带形体的不可走格不描；
 *   · `off`   ＝ 只关边带、保留蓝色水洗（`?devtint=0` 是连水洗一起关）。
 * ⚠️ `art` / `soft` 的"自带形体豁免"**只作用于已揭开的格子** —— 未探索格贴可达区那一侧是
 *   `#155` 的雾界闭合段，必须原样保留（否则会把 `#155` 修好的洞重新打开）。
 * ⚠️ `shade` 没有边带 ⇒ `#155`（雾界结构 274/274 全补）与 `#154`（3:1 对比度）两条判词
 *   在默认路径上**不再适用**，需要按"两侧明度差"重钉尺子；旧尺子仍可用 `?devband=full` 复现。
 * ⚠️ **翻默认必须留旧路径**（`haloflip` 那条规矩）：两向由 `tools/bandflip.mjs`
 *   （`npm run audit:bandflip`）机检 —— 默认≡shade、默认≠full、默认≠soft。
 */
const BAND_MODE = ((): 'dots' | 'shade' | 'full' | 'thin' | 'art' | 'soft' | 'off' => {
  try {
    const v = new URLSearchParams(location.search).get('devband');
    return v === 'shade' || v === 'full' || v === 'thin' || v === 'art' || v === 'soft' || v === 'off'
      ? v
      : 'dots';
  } catch {
    return 'dots';
  }
})();
/**
 * 新默认（2026-10-23 主理人「一块一块的色斑」之后）：
 * 可达范围 = **格心双色点阵**，不再整格铺蓝、也不再给外圈压暗。
 *
 * 为什么换掉 `shade`：铺 16% 蓝的观感是「一层 UI 水洗压在美术上」，
 * 且可达区/不可达区之间是一道**按格切齐的明度台阶**（32px 方角）——
 * 主理人看的正是这道台阶。点阵不加色块、不切台阶，只在格心给一个可数的记号。
 *
 * 为什么**不**顺手把边带加回来：`soft/full` 的边带会给 1×1 的树套一只闭合方框
 * （`bandflip.mjs` 头部记的就是这条投诉）。点阵模式下仍沿用 `shade` 的「不画线」。
 */
const BAND_DOTS = BAND_MODE === 'dots';
/** 旧默认：不画线，靠"外圈压暗"读边界（`?devband=shade` 仍可逐像素复现）。 */
const BAND_SHADE = BAND_MODE === 'shade';
/** 色栈换薄（`thin` / `soft`）：去掉红色色相锚，两条亮度锚各压到 1px。 */
const BAND_THIN = BAND_MODE === 'thin' || BAND_MODE === 'soft';
/** 作用域收窄（`art` / `soft`）：自带形体的不可走格不描边。 */
const BAND_ART_ONLY = BAND_MODE === 'art' || BAND_MODE === 'soft';
/**
 * `shade` 的外圈压暗强度。
 *
 * 0.16 与蓝色水洗的 0.16 同量级 ⇒ 两侧对底色的改动**等量相反**（一边加蓝光、一边减亮），
 * 任何底色下都能读出差；再深（≥0.25）草地会像入夜，再浅（≤0.10）在 0.22 正午光照下几乎看不出。
 */
const SHADE_OUT = 'rgba(24,14,6,0.16)';
/**
 * `?devbandstats=1`：把**本帧边带的落笔量**写进 `window.__bandStats`（`tools/bandflip.mjs` 用）。
 *
 * 为什么数"落笔面积"而不是数像素颜色：`NOGO_EDGE_INK`/`GLOW` 与美术调色板的
 * `ink0`/`hi1` **同值**（`#2a1a12` / `#fff3c8`，见 `unitArt.ts`）⇒ 逐像素数色会被树/兵/描边
 * 污染，量到的不是边带。落笔面积是这条通道**唯一干净**的尺：它只由本函数的 `band()` 累加。
 * 只计数、不改绘制 ⇒ 不带此旗标时与不计数逐字节同。
 */
const BAND_STATS = ((): boolean => {
  try {
    return new URLSearchParams(location.search).has('devbandstats');
  } catch {
    return false;
  }
})();

/**
 * 接地影总开关（2026-10-23，默认开）。
 *
 * 主理人对画面的原话是「图像基本上都是非常粗糙的」。粗糙感有一半不在色/形，而在
 * **物件像贴纸**：树、矿、城、野怪都是把精灵直接 `drawImage` 到格子上，脚下一片干净的草地，
 * 于是每个精灵都"浮"在地表 1~2px 的位置。补一层压在脚下的软影，是零新资产、
 * 只加一次 `drawImage` 的一笔。
 *
 * `?devshadow=0` 关掉 —— 与 `devband`、`devbadge` 同一套 A/B 规矩：能在**同一次会话、同一帧**
 * 里开关，才能证明"看到的变化"确实是这一层带来的（换 seed 对比会混进地图差异）。
 */
const SHADOW_ON = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devshadow') !== '0';
  } catch {
    return true;
  }
})();

/** `?devshadowstats=1`：把本帧接地影的落笔量写进 `window.__shadowStats`（探针用）。 */
const SHADOW_STATS = ((): boolean => {
  try {
    return new URLSearchParams(location.search).has('devshadowstats');
  } catch {
    return false;
  }
})();

/**
 * `?devshadowprobe=1`：登记本帧每层影的落点，供 `__mapShadowProbe()` 做**脚边/影外**取色。
 *
 * 为什么需要它：跨帧整屏比对**证明不了**接地影 —— 昼夜光照每秒都在变，
 * 两帧之间全屏都有 ±1 的亮度漂移（实测 16.9% 的像素变了，全屏散布）。
 * 同一帧内「影里」与「影外同一排」两点相减，光照、地形光照因子、迷雾都一样 ⇒ 只剩影本身。
 */
const SHADOW_PROBE = ((): boolean => {
  try {
    return new URLSearchParams(location.search).has('devshadowprobe');
  } catch {
    return false;
  }
})();

/**
 * `?devreachprobe=1`：登记本帧每枚格心点的**世界坐标**，供 `__mapReachProbe()` 取色。
 *
 * 为什么不在探针脚本里按颜色做模板匹配：点是画在**光照之前**的，`applyLighting`
 * 会整屏 multiply ⇒ 屏上颜色不是 `#fff3c8` / `#2a1a12`（实测按固定色值一枚都匹配不到）。
 * 由渲染器登记坐标、再在同一帧缓冲里取样，才是"玩家看到的那枚点"。
 */
const REACH_PROBE = ((): boolean => {
  try {
    return new URLSearchParams(location.search).has('devreachprobe');
  } catch {
    return false;
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
   * 接地影的**软椭圆贴图**（懒建，只建一次）。
   *
   * 为什么预渲染而不是每次 `createRadialGradient`：一屏能同时看到 100+ 个物件，
   * 逐帧逐物建渐变会把 GC 压到掉帧（`applyLighting` 那段注释里已经踩过同一个坑）。
   * 96×32 的白底黑影，用 `drawImage` 拉伸到目标尺寸——拉伸后的模糊正好是"软"的来源，
   * 而且能开 `imageSmoothingEnabled` 而不影响其它图（其它图必须保持像素硬边）。
   */
  private shadowCv: HTMLCanvasElement | null = null;
  /**
   * 接地影开关（会话内可切）。
   *
   * 初值来自 `?devshadow=0`；但**真正的 A/B 靠这个字段**，由 `?devprobe=1` 暴露的
   * `window.__mapShadow(on)` 在**同一次导航、同一帧**里翻 —— 跨导航比会混进镜头位置、
   * 水面相位、AI 已走的步数，看到的差异未必来自影。同一套规矩见 `tintEnabled`。
   */
  shadowOn = SHADOW_ON;
  /**
   * 影的纵向偏移（世界 px）。**生产恒为 0**，只由 `?devprobe=1` 暴露的
   * `window.__mapShadowOffset(dy)` 改动 —— 用途只有一个：把影推到半空，
   * 验证 `probe:mapshadow` 量到的确实是"脚下的影"，而不是"屏幕上任何变暗的像素"。
   */
  shadowOffsetY = 0;
  /** 本帧接地影落笔量（`?devshadowstats=1` 时写进 `window.__shadowStats`）。 */
  private shadowCount = 0;
  private shadowPx = 0;
  /**
   * 本帧每个城镇**实际用了哪张帧、落在屏幕哪个矩形**（仅 `?devcastle=1` 时登记）。
   *
   * 为什么要在渲染器里记、而不是让探针自己调 `townSpriteKey()`：那等于拿选择器
   * 验选择器。这里记的是 `draw()` 真正 blit 出去的那一张 —— 探针问"画了什么"，
   * 而不是"本该画什么"。矩形用 CSS px（× `devicePixelRatio` 才是画布像素）。
   */
  devTownDrawn: Map<string, { sprite: string; x: number; y: number; w: number; h: number }> | null = null;
  /**
   * 本帧落点（仅 `?devshadowprobe=1` 时登记），供 `probeShadow()` 取色。
   */
  private shadowSpots: Array<{ cx: number; yb: number; w: number }> = [];
  /** 本帧格心点（仅 `?devreachprobe=1` 时登记），供 `probeReach()` 取色。 */
  private reachSpots: Array<{ x: number; y: number; terrain: string }> = [];
  /** 本帧路径地标（仅 `?devreachprobe=1` 时登记），供 `probePath()` 取色。
   *  `dx/dy` = 该步的单位方向（格坐标，末步沿用前一步）—— 探针要拿它跟路径本身对账。 */
  private pathSpots: Array<{ x: number; y: number; terrain: string; dx: number; dy: number; day: 0 | 1 }> = [];
  /** 本帧落在「预览路径」上的可达点数量（默认应为 0 —— 路径已经表达了这条路）。 */
  private dotsOnPath = 0;
  /**
   * 相邻两格之间的**中点**（仅 `?devreachprobe=1` 时登记）：判"折线是否连续"用。
   *
   * `day` 决定它归哪一段 —— 这也让"明天是虚线"可以机检：虚线在**中点**处会留空，
   * 实线不会（见 `probe:pathday` 的 `pathday-dash`）。
   */
  private pathMidSpots: Array<{
    x: number;
    y: number;
    terrain: string;
    day: 0 | 1;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  }> = [];
  /** 本帧路径的步数、以及"今天走完几步"的交界（`0` 或 `===len` 表示没有跨天）。 */
  private pathLen = 0;
  private pathCut = 0;
  /** 本帧**全部**交界步数（多天时多于一个）。 */
  private pathCutsSeen: number[] = [];
  /** 本帧的流动相位（`probePath` 回传，判据据此验"它在动"）。 */
  private pathFlowSeen = {
    on: false,
    offset: 0,
    period: FLOW_PERIOD,
    reduced: false,
    /** 本帧用的流速（世界 px/s）与它依据的移动力 —— 两者都要能被判据读到。 */
    speed: FLOW_BASE,
    mp: null as number | null,
    base: FLOW_BASE,
    /** 是否被 `?devflowfixed=1` 钉回基准速度（负向对照）。 */
    fixed: false,
  };
  /** 每道刻痕的屏幕坐标（诊断/取景用）。 */
  private pathCutsScreen: Array<{ step: number; x: number; y: number; dx: number; dy: number }> =
    [];
  /** 本帧实际用的起点与头两步（`probePath` 回传，供对账）。 */
  private pathFromSeen: { x: number; y: number } | null = null;
  /** 起点对：英雄格 + 第一步（`probePath` 回传）。 */
  private pathStartSeen: { from: { x: number; y: number }; first: { x: number; y: number } | null } | null =
    null;
  private pathHeadSeen: Array<{ x: number; y: number }> = [];
  /** 交界格中心像素的相对亮度（仅跨天且开分段时量；`null` = 没有交界）。 */
  private pathCutLum: number | null = null;
  /** 边缘指示符（屏幕 CSS 坐标）；`null` = 没画（交界在屏内，或开关关掉）。 */
  private pathEdgeSeen: { x: number; y: number } | null = null;
  /** 边缘指示旁的"还有 N 天"牌子（屏幕 CSS 坐标 + 文字）；`null` = 没画。 */
  private pathEdgeLabel: { text: string; x: number; y: number; w: number; h: number } | null = null;
  /** 本帧行程共几天（`vm.pathDays.length`；没有路径 = 1）。写牌子时要用它算"还差几天"。 */
  private pathDayCount = 1;
  /** 交界格的屏幕坐标与视口（不管画没画都记，诊断用）。 */
  private pathEdgeCalc: {
    ex: number;
    ey: number;
    vw: number;
    vh: number;
    inside: boolean;
    cutWorld: [number, number];
    cam: [number, number, number];
  } | null = null;
  /** 路径地标是否画在光照之后（`?devpathafter=0` 回退）。 */
  pathAfter = PATH_AFTER;

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

  /**
   * 过渡带取色口径（同会话可切）。切成 `'top'` = 2026-10-23 之前的旧行为，
   * 改完重烘一次 —— 给"同一机位、同一张图、只差这一笔"的 A/B 用。
   */
  setFringeTone(tone: 'blend' | 'top'): void {
    this.terrain.fringeTone = tone;
    this.terrain.invalidate();
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

  /**
   * 爆发怪的 6×6 红角标（§19.3.4 C3）。
   *
   * 三条画法上的理由：
   *   ① **先铺墨再压亮** —— 纯红 6×6 落在土色/雪地上几乎与地面同明度，
   *      必须先画 1px 墨边把它从地上"抠"出来（铁律：暗底吃亮芯、亮底吃暗边）；
   *   ② 贴**剪影右上角**而不是格角 —— 物件精灵的 `ay` 是负的（站得比格高），
   *      按格角画会跟 32×44 的狼头错开，读成"地上一个红点"；
   *   ③ 只多点 1px 高光，不画感叹号/骷髅 —— 6px 里塞第二层符号会变成噪点。
   * 位置由 `outbreakMarkRect()` 给（与探针同源），本函数只管落笔。
   */
  private drawOutbreakMark(sprite: string, gx: number, gy: number): void {
    const bb = this.silBBoxAt(sprite, gx, gy);
    const r = outbreakMarkRect(bb, gx, gy);
    const ctx = this.ctx;
    const pad = OUTBREAK_MARK_RIM;
    ctx.fillStyle = '#2a1a12';
    ctx.fillRect(
      r.x0 - pad, r.y0 - pad,
      OUTBREAK_MARK_SIZE + pad * 2, OUTBREAK_MARK_SIZE + pad * 2,
    );
    ctx.fillStyle = '#d4362a';
    ctx.fillRect(r.x0, r.y0, OUTBREAK_MARK_SIZE, OUTBREAK_MARK_SIZE);
    ctx.fillStyle = '#ffc9b8';
    ctx.fillRect(r.x0 + 1, r.y0 + 1, 1, 1);
  }

  /** 懒建软椭圆影贴图（见字段注释）。 */
  private shadowSprite(): HTMLCanvasElement {    if (this.shadowCv) return this.shadowCv;
    const w = 96;
    const h = 32;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d');
    if (c) {
      c.translate(w / 2, h / 2);
      c.scale(1, h / w); // 圆 ⇒ 椭圆（避免半透明的椭圆渐变要手算像素）
      const g = c.createRadialGradient(0, 0, 0, 0, 0, w / 2);
      // 三段停靠：芯部够深才看得出"接触"，外沿必须归零否则会出现一圈硬边。
      g.addColorStop(0, 'rgba(12,7,2,0.62)');
      g.addColorStop(0.5, 'rgba(12,7,2,0.34)');
      g.addColorStop(0.82, 'rgba(12,7,2,0.10)');
      g.addColorStop(1, 'rgba(12,7,2,0)');
      c.fillStyle = g;
      c.fillRect(-w / 2, -w / 2, w, w);
    }
    this.shadowCv = cv;
    return cv;
  }

  /**
   * 在剪影底部压一层接地影。
   *
   * 几何口径与 `silBBoxAt` **同源**（含 1px 描边的 alpha>8 剪影），不是画布框：
   * 帧画布带透明留白（树冠比树干宽、城堡比地基宽），用画布框会在半空画出一道影。
   *
   * 影子中心压在剪影底边上、只往下露出约 1/3：
   * 上 2/3 被精灵自己盖住，露出来的那圈读作"地面被压暗"，而不是"脚下有个黑饼"。
   */
  private drawContactShadow(bb: BBox): void {
    const inkW = bb.x1 - bb.x0;
    if (inkW < 6) return; // 太窄的东西（1px 物件）加上影只会糊成一团
    // 1.06×剪影宽：**比剪影略宽**是"接地边"的关键 —— 只等于剪影宽时，影的左右翼
    // 正好被精灵自己盖住（实测暗化只有 ~6 个亮度单位，肉眼读作"没加"）；
    // 探出 6% 之后，脚下才会出现一圈 2~3px 的暗边，读作"这个物件压在地上"。
    const w = Math.min(190, Math.max(12, inkW * 1.06));
    const h = Math.max(5, Math.min(13, w * 0.28));
    const cx = (bb.x0 + bb.x1) / 2;
    // ⚠️ 落点登记必须在 `shadowOn` 之前：关影时也要登记，否则"关掉后差值为 0"
    // 只是因为**没取到点**（假绿）。开关两种情况都取同样 42 个位置，差值才有可比性。
    if (SHADOW_PROBE && this.shadowSpots.length < 80) {
      this.shadowSpots.push({ cx, yb: bb.y1, w });
    }
    if (!this.shadowOn) return;
    const ctx = this.ctx;
    ctx.save();
    // 只在这一笔上开平滑：软影靠插值，其它精灵必须保持像素硬边。
    ctx.imageSmoothingEnabled = true;
    // 中心压在底边之上 0.5h ⇒ 下沿只露 ~3px；上沿全被精灵盖住，不会出现"黑饼"。
    ctx.drawImage(this.shadowSprite(), cx - w / 2, bb.y1 - h * 0.5 + this.shadowOffsetY, w, h);
    ctx.restore();
    this.shadowCount++;
    this.shadowPx += w * h;
  }

  /**
   * 接地影的**同帧**取色（`?devshadowprobe=1` + `window.__mapShadowProbe()`）。
   *
   * 为什么不能用"整屏帧间差分"：昼夜光照每帧都在变，两帧之间全屏都有 ±1 的漂移
   * （实测 16.9% 的像素变了，且散布全屏）—— 差值里分不出哪一点是影。
   *
   * 取两点、同一排：`foot` = 剪影底边往下 2px 的正中（在影里），
   * `ref` = 同一 y、向左 0.78w（在影外）。返回**原始亮度**，差值交给探针算 ——
   * 判据是「开影的 (foot−ref)」减「关影的 (foot−ref)」：同一坐标两次相减，
   * 精灵自身的墨色、地形印花、光照漂移全部抵销，剩下的才是这条影。
   */
  probeShadow(): { on: boolean; n: number; foot: number[]; ref: number[] } {
    const ctx = this.ctx;
    const { viewW, viewH } = this.camera;
    const dpr = this.dpr;
    const img = ctx.getImageData(0, 0, Math.round(viewW * dpr), Math.round(viewH * dpr));
    const data = img.data;
    const W = img.width;
    const H = img.height;
    const lumAt = (wx: number, wy: number): number | null => {
      const px = Math.round((wx * this.camera.zoom + this.camera.x) * dpr);
      const py = Math.round((wy * this.camera.zoom + this.camera.y) * dpr);
      if (px < 1 || py < 1 || px >= W - 1 || py >= H - 1) return null;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const o = ((py + dy) * W + (px + dx)) * 4;
          sum += 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
        }
      }
      return sum / 9;
    };
    /**
     * 取两点：脚边（影内，贴着底边往下 2px）与影外同排参照。
     * 返回**原始亮度**，差值留给探针算 —— 因为真正的判据是
     * 「开影时的 (foot−ref)」减「关影时的 (foot−ref)」：同一坐标两次相减，
     * 精灵自身的墨色、地形印花、光照漂移全部抵销，剩下的才是这条影。
     */
    const foot: number[] = [];
    const ref: number[] = [];
    for (const s of this.shadowSpots) {
      const y = s.yb + 2;
      const f = lumAt(s.cx, y);
      const r = lumAt(s.cx - s.w * 0.78, y);
      if (f === null || r === null) continue;
      foot.push(Number(f.toFixed(1)));
      ref.push(Number(r.toFixed(1)));
    }
    return { on: this.shadowOn, n: foot.length, foot, ref };
  }

  /**
   * 格心点的**可读性**取色（`?devreachprobe=1` + `window.__mapReachProbe()`）。
   *
   * 每枚点在自己的 4×4 世界里：外圈墨、内 2×2 暖芯。取三样东西：
   *   · `core` / `ink` —— 该块内**最亮**与**最暗**的像素（不按固定色值认：光照会整屏乘暗）；
   *   · `bg` —— 距中心 ±12 device px 四个方向的中位色（避开邻格的美术）。
   * 判据 = `max(对比(core,bg), 对比(ink,bg))` —— 双色锚，亮底吃墨边、暗底吃暖芯。
   *
   * `spread = L(core) − L(ink)` 同时检查"这块里真的有一枚点"：被实体盖住或根本没画时，
   * 块内明度差会塌到个位数 ⇒ 探针能分辨"没画"和"画了但看不清"，而不是一律报低对比。
   */
  probeReach() {
    return this.probeDots(this.reachSpots, REACH_DOT_R);
  }

  /**
   * 预览路径的地标（`probeReach` 的同款量法，半径按 `PATH_DOT_R`）+ **每步的方向**。
   *
   * 方向单独回传的理由：它是这一层新加的信息，而"箭头朝哪儿"不能靠截图看（截图上
   * 看得见"像不像箭头"，看不出"是不是该朝那一边"）。探针拿它跟 `vm.path` 的步子对账。
   */
  probePath() {
    const r = this.probeDots(this.pathSpots, PATH_DOT_R);
    const dir = new Map<string, [number, number]>();
    for (const s of this.pathSpots) {
      dir.set(`${Math.floor(s.x / TILE)},${Math.floor(s.y / TILE)}`, [s.dx, s.dy]);
    }
    const per = r.per.map((p) => {
      const d = dir.get(`${p.tx},${p.ty}`) ?? [0, 0];
      return { ...p, dx: d[0], dy: d[1] };
    });
    /* 中点只量"有没有笔触"，不看方向 ⇒ 复用同一套取色，半径按线宽定（4 世界 px 够覆盖线 + 墨边）。 */
    const mid = this.probeDots(this.pathMidSpots, 4);
    /**
     * 分段：把**同一套**取色分别跑在"今天"与"明天"的样本上。
     *
     * 为什么要分开跑：`min` 是个会被最差那一段绑架的统计量。两段混在一起时，
     * "今天实线 4.2、明天虚线 2.4" 会报成"最差 2.4"，玩家看到的却是"今天的线很清楚" ——
     * 数字没错，但它回答的不是这个问题。
     */
    const seg = (d: 0 | 1) => {
      const dots = this.probeDots(
        this.pathSpots.filter((q) => q.day === d),
        PATH_DOT_R,
      );
      const mids = this.probeDots(
        this.pathMidSpots.filter((q) => q.day === d),
        4,
      );
      /* 细窗（半径 1 世界 px ≈ 2.5px 窗）：判"虚线有没有留空"。
         宽窗（半径 4）会把缺口两侧的墨一起收进来 ⇒ 虚线也永远"有笔触"，
         那就等于拿一把量不出差别的尺去证差别（§18.4 的同类错）。 */
      const fine = this.probeDots(
        this.pathMidSpots.filter((q) => q.day === d),
        1,
      );
      return {
        n: dots.n,
        min: dots.min,
        median: dots.median,
        covered: dots.covered,
        offScreen: dots.offScreen,
        midN: mids.n,
        midCovered: mids.covered,
        midMedian: mids.median,
        midMin: mids.min,
        fineN: fine.n,
        fineCovered: fine.covered,
        /* 细窗逐枚明细：判据红的时候要能一眼看出"是哪一枚空了"，否则只能猜。 */
        finePer: fine.per.map((q) => ({
          wx: q.wx,
          wy: q.wy,
          tx: q.tx,
          ty: q.ty,
          px: q.px,
          py: q.py,
          spread: q.spread,
          bgL: q.bg,
          best: q.best,
          bRGB: q.bRGB,
          bgRGB: q.bgRGB,
        })),
      };
    };
    this.pathCutLum = this.cutCenterLum();
    return {
      ...r,
      per,
      mid: { n: mid.n, min: mid.min, median: mid.median, offScreen: mid.offScreen },
      dotsOnPath: this.dotsOnPath,
      drawnAfter: this.pathAfter,
      lineMode: PATH_LINE,
      daySplit: PATH_DAY,
      /* 渲染器**自己**看到的起点与前两步：判据红的时候先对这三个数，
         不要拿"钩子说的路径"去推（两边看到的若是两条不同的路径，越推越远）。 */
      from: this.pathFromSeen,
      head: this.pathHeadSeen,
      startPair: this.pathStartSeen,
      /**
       * 边缘指示符：`drawn` 是结构事实（真的画了），`lum` 是**那一格中心像素**的亮度
       * （指示符的横杠是墨色 ⇒ 应当很暗）。两个都报，才能分开"画了但看不见"与"根本没画"。
       */
      edge: this.pathEdgeSeen
        ? {
            drawn: true,
            x: +this.pathEdgeSeen.x.toFixed(1),
            y: +this.pathEdgeSeen.y.toFixed(1),
            lum: this.lumAtCss(this.pathEdgeSeen.x, this.pathEdgeSeen.y),
          }
        : { drawn: false, x: null, y: null, lum: null },
      edgeCalc: this.pathEdgeCalc,
      /** 边缘牌子：文字 + 矩形 + 亮度统计（`null` = 没画）。 */
      edgeLabel: (() => {
        const L = this.pathEdgeLabel;
        if (!L) return null;
        return { ...L, ...(this.rectLum(L) ?? {}) };
      })(),
      /** 本帧行程天数（牌子上写的是 `edgeDays - 1`）。 */
      edgeDays: this.pathDayCount,
      /* 原始登记（不走 `probeDots`）：中点坐标若与路径对不上，先看这一行，
         不要从 `per` 里的统计量反推（那是二次加工过的）。 */
      midsRaw: this.pathMidSpots.map((q) => ({
        x: q.x,
        y: q.y,
        day: q.day,
        from: [q.fromX, q.fromY],
        to: [q.toX, q.toY],
      })),
      day: {
        len: this.pathLen,
        cut: this.pathCut,
        /** 全部交界步数（多天时 >1 个）；`cut` 是第一道的兼容别名。 */
        cuts: this.pathCutsSeen,
        cutScreen: this.pathCutsScreen,
        /** 流动：`on` 是否启用、`offset` 本帧相位（世界 px）、`reduced` 是否因系统设置静止。 */
        flow: this.pathFlowSeen,
        /**
         * 每道刻痕的**横向取样**：中心 + 路径两侧各一枚（沿法线 ±3.2 世界 px）。
         *
         * 为什么必须量两侧：`cut-mark` 原来只量"中心是不是黑的"，而一根**顺着路**的
         * 墨杠也会把中心压黑 —— 判据绿着，画面上却什么都没有（2026-10-24 实测：
         * 3× 特写里那道刻痕根本看不出来）。横向被压黑才证明"横着切过去了"。
         */
        cutCross: this.pathCutsScreen.map((g) => {
          const len = Math.hypot(g.dx, g.dy) || 1;
          const nx = -g.dy / len;
          const ny = g.dx / len;
          const off = 3.2 * this.camera.zoom;
          return {
            step: g.step,
            center: this.lumAtCss(g.x, g.y),
            a: this.lumAtCss(g.x + nx * off, g.y + ny * off),
            b: this.lumAtCss(g.x - nx * off, g.y - ny * off),
          };
        }),
        /** 只有"今天走不完"且开关打开时才真的有交界。 */
        split: PATH_DAY && this.pathCut > 0 && this.pathCut < this.pathLen,
        cutLum: this.pathCutLum,
        now: seg(0),
        next: seg(1),
      },
    };
  }

  /**
   * 一小块矩形里的亮度统计（用来判"牌子上的字读不读得出"）。
   *
   * `max` = 字（金）+ 描边；`p35` = 底色（牌子挡着的地图/牌底混合）——
   * 字在 12px 粗体下大约占三成面积，取 35 分位是为了**避开字的抗锯齿边**
   * 又不至于像最小值那样被一颗暗像素绑架。
   * 对比度按 WCAG 相对亮度算：`(L亮+0.05)/(L暗+0.05)`（与 `lumAtCss` 同一套 γ 解码）。
   */
  private rectLum(r: { x: number; y: number; w: number; h: number }): {
    px: number;
    max: number;
    p35: number;
    min: number;
    contrast: number;
  } | null {
    const ctx = this.ctx;
    const { viewW, viewH } = this.camera;
    const dpr = this.dpr;
    const x0 = Math.max(0, Math.round(r.x * dpr));
    const y0 = Math.max(0, Math.round(r.y * dpr));
    const x1 = Math.min(Math.round(viewW * dpr), Math.round((r.x + r.w) * dpr));
    const y1 = Math.min(Math.round(viewH * dpr), Math.round((r.y + r.h) * dpr));
    if (x1 <= x0 || y1 <= y0) return null;
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    const f = (v: number): number => {
      const u = v / 255;
      return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
    };
    const lum: number[] = [];
    for (let i = 0; i < d.length; i += 4) lum.push(0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2]));
    lum.sort((a, b) => a - b);
    const max = lum[lum.length - 1] ?? 0;
    const min = lum[0] ?? 0;
    const p35 = lum[Math.floor(lum.length * 0.35)] ?? 0;
    return {
      px: lum.length,
      max: +max.toFixed(4),
      p35: +p35.toFixed(4),
      min: +min.toFixed(4),
      contrast: +((max + 0.05) / (p35 + 0.05)).toFixed(2),
    };
  }

  /**
   * 交界格**中心像素**的相对亮度。
   *
   * 为什么不复用 `probeDots` 的 `min/bg`：刻痕是画在**线上面**的一小段深色短杠，
   * 它的证据是"这一格的正中心被压黑了" —— 而 `probeDots` 统计的是整块窗口的最亮/最暗，
   * 会被旁边的金色线头拉回原样。取单点才能把"刻痕在不在"与"线在不在"分开。
   */
  /** 取屏幕（CSS px）某一点像素的相对亮度；越界返回 null。 */
  private lumAtCss(cx: number, cy: number): number | null {
    const ctx = this.ctx;
    const { viewW, viewH } = this.camera;
    const dpr = this.dpr;
    const px = Math.round(cx * dpr);
    const py = Math.round(cy * dpr);
    if (px < 0 || py < 0 || px >= Math.round(viewW * dpr) || py >= Math.round(viewH * dpr)) return null;
    const d = ctx.getImageData(px, py, 1, 1).data;
    const f = (v: number): number => {
      const u = v / 255;
      return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
    };
    return +(0.2126 * f(d[0]) + 0.7152 * f(d[1]) + 0.0722 * f(d[2])).toFixed(4);
  }

  private cutCenterLum(): number | null {    if (this.pathCut <= 0 || this.pathCut >= this.pathLen) return null;
    const spot = this.pathSpots.find((q) => q.day === 0);
    if (!spot) return null;
    /* 交界格的坐标 = 今天的最后一步。`pathSpots` 里 day===0 的最后一枚就是它。 */
    const todays = this.pathSpots.filter((q) => q.day === 0);
    const last = todays[todays.length - 1] ?? spot;
    const ctx = this.ctx;
    const { viewW, viewH } = this.camera;
    const dpr = this.dpr;
    const px = Math.round((last.x * this.camera.zoom + this.camera.x) * dpr);
    const py = Math.round((last.y * this.camera.zoom + this.camera.y) * dpr);
    if (px < 0 || py < 0 || px >= Math.round(viewW * dpr) || py >= Math.round(viewH * dpr)) return null;
    const d = ctx.getImageData(px, py, 1, 1).data;
    const f = (v: number): number => {
      const u = v / 255;
      return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
    };
    return +(0.2126 * f(d[0]) + 0.7152 * f(d[1]) + 0.0722 * f(d[2])).toFixed(4);
  }

  /**
   * 逐枚点量"它在自己的底色上读不读得出"，并按**地形**分组回传。
   *
   * 分组不是好看：§15 只给了全局最差（3.89），而全局最差只说明"有**某一枚**在某个底色上够亮"，
   * 说明不了"每一类地形都够亮"。雪原 `#eef3f7` 与岩地 `#a3a09a` 差了 100 多级明度，
   * 一个混在一起的 min 会被最暗那只地形绑架 ⇒ 亮底地形可能整体不及格却看不出来。
   * 所以判据改成**逐地形**：只要该地形上落过点（`reg > 0`），它的最差就必须 ≥3.0；
   * 并且每个"落过点"的地形都必须**量得到**（`n > 0`）—— 有对象无可判数据就是假绿（铁律 3）。
   */
  private probeDots(spots: Array<{ x: number; y: number; terrain: string }>, dotR: number) {
    const ctx = this.ctx;
    const { viewW, viewH } = this.camera;
    const dpr = this.dpr;
    const img = ctx.getImageData(0, 0, Math.round(viewW * dpr), Math.round(viewH * dpr));
    const data = img.data;
    const W = img.width;
    const H = img.height;
    const rgbAt = (px: number, py: number): [number, number, number] | null => {
      if (px < 0 || py < 0 || px >= W || py >= H) return null;
      const o = (py * W + px) * 4;
      return [data[o], data[o + 1], data[o + 2]];
    };
    const lum = (c: [number, number, number]): number => {
      const f = (v: number): number => {
        const u = v / 255;
        return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const ratio = (a: [number, number, number], b: [number, number, number]): number => {
      const l1 = lum(a);
      const l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const per: Array<{
      px: number;
      py: number;
      wx: number;
      wy: number;
      /** 所属格（世界格坐标）—— 探针用它把"路径格"与"落点格"对上同一套 id。 */
      tx: number;
      ty: number;
      terrain: string;
      core: number;
      ink: number;
      bg: number;
      spread: number;
      best: number;
      bRGB: string;
      dRGB: string;
      bgRGB: string;
      bL: number;
    }> = [];
    let covered = 0;
    let offScreen = 0;
    /** 逐地形：登记数 / 其中出界的 / 量到数 / 最差 / 中位。
     *  `off` 单独记的理由：只有 1~4 枚点、且全在视口边缘的地形很常见（小片沼泽、一条土路）。
     *  那不是"读不出"，是"这一帧没有可判样本" ⇒ 判据必须能区分这两件事，
     *  否则随机图上一片贴边的沼泽就会把门染红（本探针 2026-10-24 实测：seed 222/333/555 全红）。 */
    const byTerrain: Record<string, { reg: number; off: number; n: number; min: number; median: number }> = {};
    const half = Math.max(2, Math.round(dotR * this.camera.zoom * dpr));
    for (const s of spots) {
      const bucket = (byTerrain[s.terrain] ??= { reg: 0, off: 0, n: 0, min: 99, median: 0 });
      bucket.reg++;
      const px = Math.round((s.x * this.camera.zoom + this.camera.x) * dpr);
      const py = Math.round((s.y * this.camera.zoom + this.camera.y) * dpr);
      /* 视口边缘的格：点确实画了，但中心落在画布外 ⇒ 取不到像素。
         单独计数（而不是当成"没画"），判据用「量到 + 出界 === 自报」。 */
      const pad = Math.round(6 * this.camera.zoom * dpr);
      if (px < pad || py < pad || px >= W - pad || py >= H - pad) {
        offScreen++;
        bucket.off++;
        continue;
      }
      let bright: [number, number, number] | null = null;
      let dark: [number, number, number] | null = null;
      let lb = -1;
      let ld = 999;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const c = rgbAt(px + dx, py + dy);
          if (!c) continue;
          const l = lum(c);
          if (l > lb) {
            lb = l;
            bright = c;
          }
          if (l < ld) {
            ld = l;
            dark = c;
          }
        }
      }
      if (!bright || !dark) continue;
      const spread = (lb - ld) * 255;
      // 四个方向取中位色。**必须贴近点**（≈2.5 世界 px）：树/岩石精灵会溢出本格，
      // 采到 12 device px 外时，四面里可能三面是邻格的树冠 ⇒ 底色被算成深绿，
      // 于是"点在深色树影上对比不足"——那是探针的错觉，不是玩家的观感。
      const around: Array<[number, number, number]> = [];
      const off = Math.max(4, Math.round(Math.max(2.5, dotR + 0.5) * this.camera.zoom * dpr));
      for (const [ox, oy] of [
        [off, 0],
        [-off, 0],
        [0, off],
        [0, -off],
      ]) {
        const c = rgbAt(px + ox, py + oy);
        if (c) around.push(c);
      }
      if (!around.length) continue;
      around.sort((a, b) => lum(a) - lum(b));
      const bg = around[Math.floor(around.length / 2)];
      if (spread < 40) covered++;
      const best = Math.max(ratio(bright, bg), ratio(dark, bg));
      per.push({ px, py, wx: +s.x.toFixed(1), wy: +s.y.toFixed(1), tx: Math.floor(s.x / TILE), ty: Math.floor(s.y / TILE), terrain: s.terrain, core: +ratio(bright, bg).toFixed(2), ink: +ratio(dark, bg).toFixed(2), bg: +lum(bg).toFixed(3), spread: +spread.toFixed(0), best: +best.toFixed(2), bRGB: bright.join(','), dRGB: dark.join(','), bL: +lum(bright).toFixed(3), bgRGB: bg.join(',') });
      bucket.n++;
      if (best < bucket.min) bucket.min = +best.toFixed(2);
    }
    for (const [k, b] of Object.entries(byTerrain)) {
      const vals = per.filter((p) => p.terrain === k).map((p) => p.best).sort((a, b2) => a - b2);
      b.median = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
      if (b.n === 0) b.min = 0;
    }
    const sorted = per.map((p) => p.best).sort((a, b) => a - b);
    /* 平均绝对亮度（`bL` = 该点最亮像素的相对亮度）。对比度对"整屏等比乘暗"**不敏感**
     * （点与底色一起被乘 ⇒ 比值近似不变），所以想证"画在光照之后"必须看绝对值：
     * 同一帧、同一格，画面乘暗后旧路径的绝对亮度一定更低。 */
    const meanBL = per.length ? per.reduce((a, p) => a + p.bL, 0) / per.length : 0;
    return {
      n: per.length,
      min: sorted.length ? sorted[0] : 0,
      median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
      meanBL: +meanBL.toFixed(4),
      covered,
      offScreen,
      byTerrain,
      per: per.slice(0, 40),
    };
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
    if (!cid) return; // 空队 / 野怪 / 未登记兵种
    const frameName = unitMapFrame(cid); // ⑤ 帧名只经别名层；owner 不参与
    const g = this.silOf(frameName);
    // 缺帧 ⇒ 只跳过这一枚**徽标**（不是英雄本体——本体在上面先画）。
    // T5 四族的 u_*_map 已于 2026-10-14（TP-1）并入 UNIT_FRAMES，这里不再是"T5 恒缺"；
    // 它仍保留是因为徽标默认关（`badgesVisible`），且它是缺帧的最后一道网 ——
    // 与 BattleRenderer 的同类分支同取舍：**告警不静默、不抛**（throw = 白屏）。
    if (!g) return;
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
    // 城镇帧登记同样在开画前清空（否则滚出屏幕的城会留下上一帧的记录）
    if (this.devTownDrawn) this.devTownDrawn.clear();
    // 格心点登记必须**在本帧开画前**清空：它填在可达染色那一趟（早于实体、早于光照），
    // 而 `shadowSpots` 的清空点在实体循环前 —— 若照抄那一行，会在登记完之后立刻清掉。
    if (REACH_PROBE) {
      this.reachSpots = [];
      this.pathSpots = [];
      this.pathMidSpots = [];
      this.pathLen = 0;
      this.pathCut = 0;
      this.pathCutLum = null;
      this.dotsOnPath = 0;
    }
    const { state, player } = vm;
    const map = state.map;
    // 画质基线（G-15 画质腿）：展示图 `grims-showcase` 强制开氛围层。
    // 其余场景（自由对局 / tutorial / duel）传 undefined ⇒ 函数内部短路，一个字节都不改。
    syncAmbientBaseline(state.config?.scenario);
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
    // 地图边界外的"桌面"：2026-10-21 由近黑蓝 #0b0d10 改成暖褐 ——
    // 初始缩放降到 1.2 后，小地图左右会露出边界外的空区，冷黑在暖色地图旁边像**一个洞**；
    // 暖褐读起来像"地图铺在石桌上"，与边框同族。（只改底色，不动任何地形/单位绘制。）
    ctx.fillStyle = '#150f08';
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

    /* --- 地图外缘投影（2026-10-21） ---
     * 初始缩放降到 1.2 后，比视口窄的小地图两侧会露出**边界外**的桌面底色；
     * 只填一个深色时读起来像"地图上破了个洞"。加一圈由外向内变淡的暗边 +
     * 一条极淡的亮边，边界就有了"地图铺在石桌上"的实体感（纯绘制，不动地形/单位）。 */
    {
      const mw = map.width * TILE;
      const mh = map.height * TILE;
      ctx.lineWidth = 12 / cam.zoom;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.34)';
      ctx.strokeRect(-6 / cam.zoom, -6 / cam.zoom, mw + 12 / cam.zoom, mh + 12 / cam.zoom);
      ctx.lineWidth = 1.5 / cam.zoom;
      ctx.strokeStyle = 'rgba(255, 232, 170, 0.10)';
      ctx.strokeRect(0, 0, mw, mh);
    }

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
    /** `dots` 的落笔也推迟到光照之后（与边带同一条理由，见落笔处注释）。 */
    const afterDots: Array<[number, number]> = [];
    /** 预览路径的地标：同样推迟到光照之后。
     *  `null` 才是"立即画"的哨兵 —— 与 `afterBands` 同一套约定。
     *  ★ 首版写成 `this.pathAfter ? [] : []`（两支都是空数组 ⇒ 永远 truthy）⇒
     *    `?devpathafter=0` 的旧路径分支成了**死代码**，两臂读数逐位相同，
     *    看上去"这条判据通过了"，其实是两臂都没走另一条路。 */
    const afterPath: Array<[number, number, number, number, number, number]> | null = this.pathAfter ? [] : null;
    /** `line` 形态的折线（同样推迟到光照之后；`null` = 不画）。 */
    let afterLine: PathLine | null = null;
    let statPathDots = 0;
    // 边带落笔：默认（`afterBands===null`）立即填充，与原实现逐像素一致；开启 (1) 时只登记。
    // `statRects/statPx` 只累加、不参与绘制（见 `BAND_STATS`）。
    let statRects = 0;
    let statPx = 0;
    let statArtSkip = 0;
    /** `shade`：压暗了多少格（只计数，不参与绘制）。 */
    let statShade = 0;
    /** `dots`：落了多少枚格心点（只计数，不参与绘制）。 */
    let statDots = 0;
    const band = (c: string, bx: number, by: number, bw: number, bh: number): void => {
      statRects++;
      statPx += bw * bh;
      if (afterBands) afterBands.push({ x: bx, y: by, w: bw, h: bh, c });
      else {
        ctx.fillStyle = c;
        ctx.fillRect(bx, by, bw, bh);
      }
    };
    // `?devtint=0` ⇒ `tintEnabled === false` ⇒ 整块跳过（染色层空操作）；
    // 不传旗标时 `tintEnabled === true` ⇒ `cost && true` ≡ `cost` ⇒ 与今天逐字节一致。
    if (cost && this.tintEnabled) {
      // 边带**色栈**：从"贴可达区那一侧"往外依次落笔。`full` = 现网三段（3×2px = 6px）；
      // `thin` = 亮芯 1px + 墨 1px（见 `BAND_MODE`）。每帧只建一次，不进逐格热循环。
      const stack: ReadonlyArray<readonly [string, number]> = BAND_THIN
        ? [[edgeGlow, 1], [edgeInk, 1]]
        : [[edgeRed, EDGE_W], [edgeGlow, EDGE_W], [edgeInk, EDGE_W]];
      // 前沿判定：**含英雄自身格**（Dijkstra 起点 cost===0 也属于可达区），
      // 并要求相邻格**已揭开**（未探索处不出红线，否则红线会顺迷雾边界乱爬）。
      const inRegion = (x: number, y: number): boolean => {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
        if (!isRevealed(state, player, x, y)) return false;
        return isFinite(cost[idx(map, x, y)]);
      };
      // 「自带形体」：物件精灵（树/岩石/山/矿/城/怪）或水面岸线 —— 它们的轮廓已由美术给出，
      // 再套一圈 6px 方框只会把 1×1 的树描成一只方框（`BAND_ART_ONLY`）。
      const hasOwnArt = (i: number): boolean => {
        const t = map.tiles[i];
        return !!t.objectId || t.terrain === 'water';
      };
      /* 预览路径占用的格（`vm.path` 只在"选中英雄 + 悬停"时非空）。
         用它做两件事：① 这些格不落可达点；② 路径地标自己单独画（见 `afterPath`）。
         注意路径里**包含英雄自身格**（k=0），那一格本来就没有点，无需特殊处理。 */
      const pathKeys = new Set<number>();
      if (PATH_MASK && vm.path) {
        for (const p of vm.path) pathKeys.add(p.y * map.width + p.x);
      }
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const rev = isRevealed(state, player, x, y);
          // `#155`：**默认（不传参 ⇒ `fogClose === true`）让未探索格继续往下走**，只可能落在
          // "贴可达区那一侧"的边界带上（见下方 `top/bot/lft/rgt`）；`?devfogclose=0` ⇒ 未探索格
          // 在此 `continue` ⇒ 与旧版**同路**（逐像素回到旧版）。
          if (!rev && !this.fogClose) continue; // `?devfogclose=0` 时未探索不染色
          const i = idx(map, x, y);
          const c = cost[i];
          // `rev &&` 两道守卫：未探索格**永不填蓝、永不当英雄自身格** —— 即便默认开
          // 且它在迷雾里其实可走（`computePaths` 不看 `isRevealed`，故 fog 格可能有有限 cost）。
          if (rev && isFinite(c) && c > 0) {
            if (BAND_DOTS) {
              // 只在外缘落点（`edge`，默认）或每格都落（`all`）—— 见 `REACH_DOT_MODE`。
              // 边缘判定用同一个 `inRegion`（= 已揭开 + 有限 cost），与边带同一口径，
              // 不另造一套"可达"定义。
              const onEdge =
                REACH_DOT_MODE === 'all' ||
                !inRegion(x, y - 1) ||
                !inRegion(x, y + 1) ||
                !inRegion(x - 1, y) ||
                !inRegion(x + 1, y);
              if (onEdge) {
                /* 「自带形体」豁免：有物件的格（城门口、资源堆、矿）不落点。
                   点现在画在光照之后 ⇒ 也就在实体之后 ⇒ 会直接印在城门/宝箱的像素上
                   （实测城堡门洞里出现一枚白点）。这类格本来就由美术自己回答"能点"，
                   与边带 `BAND_ART_ONLY` 同一口径。 */
                if (hasOwnArt(i)) continue;
                /* 路径让位：这一格已经被"路线"占用了 ⇒ 不再叠一枚"能到"的点。
                   `?devpathmask=0` 时不建 `pathKeys`（空集）⇒ 点照旧落下，
                   这里也就能把"被抑制的数量"数出来（负向对照用，见 `dotsOnPath`）。 */
                if (pathKeys.has(i)) {
                  this.dotsOnPath++;
                  continue;
                }
                // 只**登记**世界坐标，落笔推迟到 `applyLighting` 之后（见文件末尾重放段）。
                // 理由与边带同款、而且这里更硬：点的两色是**明度锚**，一旦被整屏 multiply 乘暗，
                // 暖芯（#fff3c8）会掉到灰度 123 上下、墨边又贴着暗底 ⇒ 实测最差对比 **2.33**。
                // 放在光照后画 ⇒ 亮底靠墨边、暗底靠暖芯，两锚都保持标称亮度。
                const cx = x * TILE + TILE / 2;
                const cy = y * TILE + TILE / 2;
                afterDots.push([cx, cy]);
                statDots++;
                if (REACH_PROBE && this.reachSpots.length < 400) {
                  this.reachSpots.push({ x: cx, y: cy, terrain: map.tiles[i].terrain });
                }
              }
            } else {
              ctx.fillStyle = REACH_TINT; // `shade`（旧默认）：可走 = 整格蓝填充
              ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
            }
            continue;
          }
          if (rev && isFinite(c)) continue; // 英雄自身格（c===0）：在可达区内部，不填不描
          // ---- `shade`（旧默认）/ `dots`（新默认）：**一条线都不画** ----
          // `shade`：超出移动力但地形能走的格子压暗 16%，靠两侧明度差读边界。
          // `dots` ：**不压暗** —— 可达区已经由格心点阵表达，再压一圈会在可达区外缘
          //          留下一道按格切齐的明度台阶（正是这一批要去掉的"色斑"）。
          // 判据链（仅 shade）：已揭开 + 本回合不可达 + 不限移动力时可达（`walkable`）⇒ 压暗。
          // 树/水/山/城/物件 在 `walkable` 里也是 Infinity ⇒ 天然被排除（美术自己会说话）；
          // 未探索格不压（雾本来就暗，压了读不出差）。
          if (BAND_SHADE || BAND_DOTS) {
            if (BAND_SHADE && rev && vm.walkable && isFinite(vm.walkable[i])) {
              ctx.fillStyle = SHADE_OUT;
              ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
              statShade++;
            }
            continue;
          }
          // ↓ 未探索格（**默认开**时）也会落到这里：`inRegion()` 要求相邻格**已揭开且可达**
          //   ⇒ 只有"贴可达区的那一侧"为真 ⇒ 恰好补上贴雾的缺口，且不在雾内部乱描。
          if (BAND_MODE === 'off') continue;
          // 作用域收窄：已揭开、且自带形体的不可走格 —— 不描（美术轮廓即边界）。
          // 未探索格**不参与**这条例外（雾界那一段是 `#155` 的修法本体）。
          if (BAND_ART_ONLY && rev && hasOwnArt(i)) {
            statArtSkip++;
            continue;
          }
          // 不可走：紧邻可达区的那一侧画**三线 = 红（色相锚）+ 亮芯 + 暗墨（双色 halo）**。
          // 顺序（贴可达区 → 不可走侧）：红(0) → 亮芯(EDGE_W) → 暗墨(2*EDGE_W)；亮/暗两锚落在**同一格地形**
          // ⇒ 暗底吃亮芯、亮底吃暗边 ⇒ 任何底色下两极其一必 ≥3:1（§4.6 (a-1)/(ii)）。
          const px = x * TILE;
          const py = y * TILE;
          const top = inRegion(x, y - 1);
          const bot = inRegion(x, y + 1);
          const lft = inRegion(x - 1, y);
          const rgt = inRegion(x + 1, y);
          let off = 0;
          for (const [c2, w] of stack) {
            if (top) band(c2, px, py + off, TILE, w);
            if (bot) band(c2, px, py + TILE - off - w, TILE, w);
            if (lft) band(c2, px + off, py, w, TILE);
            if (rgt) band(c2, px + TILE - off - w, py, w, TILE);
            off += w;
          }
        }
      }
      if (BAND_STATS) {
        (window as unknown as { __bandStats?: unknown }).__bandStats = {
          mode: BAND_MODE,
          rects: statRects, // 画了多少条矩形
          px: statPx, // 这些矩形的总面积（世界 px²）—— 「边带有多响」的干净读数
          artSkip: statArtSkip, // 因「自带形体」而整格跳过的数量
          shade: statShade, // `shade` 模式压暗的格数（世界 px² 口径见 `shadePx`）
          shadePx: statShade * TILE * TILE,
          dots: statDots, // `dots` 模式落的格心点数（`audit:bandflip` ⑤ 用它证"点真的在画"）
          /** 被预览路径"让位"掉的可达点数量（默认应 >0 且这些格上最终**没有**点）。 */
          dotsOnPath: this.dotsOnPath,
        };
      }
    }

    if (vm.path && vm.path.length > 1) {
      const steps = vm.path;
      /* 起点 = **英雄脚下**。`buildPath()` 只返回步子、**不含起点**（`pathfinding.ts:138`），
         所以不能拿 `steps[0]` 当起点 —— 那会把"英雄→第一格"整段丢掉。
         §18 的提交信息写着"从英雄脚下出发"，当时其实短了一格，这里补上。 */
      const fromP: GridPos = vm.pathFrom ?? steps[0];
      /* 每天走完的步数。`PATH_DAY=false`（负向对照）⇒ 整条都算今天，等同旧表现。 */
      const len = steps.length;
      const days = PATH_DAY ? (vm.pathDays ?? [vm.pathDay ?? len]) : [len];
      /* 交界 = 每天结束的那一步（**不含最后一天**：那是终点，不是"今天到此为止"）。
         只保留 0 < cut < len 的，其余（走不完/正好走完）都不该落刻痕。 */
      const cuts = days.filter((d) => d > 0 && d < len);
      this.pathLen = len;
      this.pathCut = cuts[0] ?? 0;
      this.pathCutsSeen = cuts.slice();
      /* 天数表（末尾恒 = len）⇒ 条数就是总天数。边缘牌子上写的"还差几天"= 条数 − 1
         （今天这一段不算"还差"）。 */
      this.pathDayCount = days.length;
      /** 第 k 步（0-based）属于第几天：越过了几道交界就是第几天。0 = 今天。 */
      const segOf = (k: number): number => {
        let n = 0;
        for (const c of cuts) if (k >= c) n++;
        return n;
      };
      this.pathFromSeen = { x: fromP.x, y: fromP.y };
      this.pathHeadSeen = steps.slice(0, 3).map((q) => ({ x: q.x, y: q.y }));
      /* 起点对（英雄格 → 第一步）：这是"折线真的从脚下出发"的硬证据。 */
      this.pathStartSeen = {
        from: { x: fromP.x, y: fromP.y },
        first: steps[0] ? { x: steps[0].x, y: steps[0].y } : null,
      };
      const hasSplit = cuts.length > 0;
      /* 折线上的点（含英雄脚下那一枚）：`pts[i]`（i≥1）= 第 i 步的格心 ⇒ 分段只需比 `i <= cut`。 */
      const pts: Array<{ x: number; y: number }> = [
        { x: fromP.x * TILE + TILE / 2, y: fromP.y * TILE + TILE / 2 },
      ];
      const cornersNow: Array<[number, number, number, number]> = [];
      const cornersNext: Array<[number, number, number, number]> = [];
      let prevDx = 0;
      let prevDy = 0;
      let endDir: [number, number] = [0, 0];
      /** 每道交界的**到达方向**（记在交界步 `c-1` 上）；按 cut 值索引。 */
      const cutDirs = new Map<number, [number, number]>();
      /* ★ 从 k = 0 起：`buildPath()` 返回的是**纯步子**，`steps[0]` 就是第一格。
         首版（§18）写的是 `for (k = 1; ...)` 并把 `steps[0]` 当起点 —— 那是把
         "步子数组"当成了"含起点数组"。后果不是"少一条线段"，而是
         **英雄→第 0 步→第 1 步被画成一条直线**（在拐角处抄近路），
         探针量到的中点因此落在没有线的格子上（实测 112,400 那枚空窗）。 */
      for (let k = 0; k < steps.length; k++) {
        const p = steps[k];
        const cx = p.x * TILE + TILE / 2;
        const cy = p.y * TILE + TILE / 2;
        /* 方向：指向下一格；末步没有"下一格"⇒ 沿用上一步的方向（否则终点会画成一个无向的团）。
           ★ 别照抄"四邻接"这个想当然：`pathfinding.ts` 的 `DIRS` 是 **8 邻域**（含对角），
           实测一条 10 步路线里就出现过 `1,-1` ⇒ `dx/dy` 可能同时非 0（45° 箭头）。 */
        const next = k + 1 < steps.length ? steps[k + 1] : null;
        const prev = k === 0 ? fromP : steps[k - 1];
        const dx = next ? Math.sign(next.x - p.x) : Math.sign(p.x - prev.x);
        const dy = next ? Math.sign(next.y - p.y) : Math.sign(p.y - prev.y);
        const isLast = !next;
        /* 第 k 步（0-based）属于第几天：越过几道交界就是第几天（0 = 今天）。 */
        const day: 0 | 1 = segOf(k) === 0 ? 0 : 1;
        pts.push({ x: cx, y: cy });
        /* 刻痕要**横切"今天"这条路** ⇒ 记的是**到达方向**（上一格 → 本格），
           不是 `dx/dy`（本格 → 下一格）。
           ★ 这两个在本格拐弯时**正好差 90°**，混用不会报错、只会看起来"有时候对"：
           2026-10-24 首次实现取了 `dx/dy`，那条路恰好在交界处北→东拐弯，
           于是"顺着离开方向的长杠"碰巧横切了竖线，看上去是对的；
           等到换成一条**不拐弯**的直线路径，同一份代码就会画出与线平行的黑条 —— 完全看不见。
           多天时每一天都要一道，所以按 cut 值分别记。 */
        if (hasSplit && cuts.includes(k + 1)) {
          cutDirs.set(k + 1, [Math.sign(p.x - prev.x), Math.sign(p.y - prev.y)]);
        }
        statPathDots++;
        if (REACH_PROBE && this.pathSpots.length < 400) {
          this.pathSpots.push({
            x: cx,
            y: cy,
            terrain: map.tiles[idx(map, p.x, p.y)].terrain,
            dx,
            dy,
            day,
          });
        }
        if (REACH_PROBE && this.pathMidSpots.length < 400) {
          /* 第 k 步那一段的**中点**。`prev` 在 k===1 时是英雄脚下 ——
             旧代码写的是 `steps[k-1]`，k=1 时算出来是"第一步→第一步"的中点，
             也就是把"英雄→第一格"漏掉、还多量了一枚落在格心上的假样本。 */
          /* 每步取 **3 个**采样点（25% / 50% / 75%），不是只要中点。
             理由是为了量"虚线"：虚线的实段与空档按 3.2/3.4 交替，而采样点相隔一整格（32px），
             每个采样点落在实段还是空档基本是随机的 —— 只取 1 个点，遇到"恰好落在实段"的概率
             ~48%，两段合计就足以让一条真虚线被读成实线（实测：明天 2 枚采样 0 空）。
             3 个点 × 多步之后，空档比例会收敛到占空比（~51%），判据才有分辨力。 */
          const px0 = prev.x * TILE + TILE / 2;
          const py0 = prev.y * TILE + TILE / 2;
          const px1 = p.x * TILE + TILE / 2;
          const py1 = p.y * TILE + TILE / 2;
          for (const f of [0.25, 0.5, 0.75]) {
            this.pathMidSpots.push({
              x: px0 + (px1 - px0) * f,
              y: py0 + (py1 - py0) * f,
              terrain: map.tiles[idx(map, p.x, p.y)].terrain,
              day,
              fromX: prev.x,
              fromY: prev.y,
              toX: p.x,
              toY: p.y,
            });
          }
        }
        if (PATH_LINE) {
          /* 只在**拐点**补一枚小折角：折线本身已经把方向说清楚了，
             连续在每格都补就等于又退回"折角箭头"那一版。 */
          /* 交界格不补折角：那里已经有一道刻痕，两个标记摞在同一格会互相啃
             （实测 3× 特写里那一格是"黑条 + 金箭头 + 虚线起点"糊成一团）。 */
          /* 交界格**两侧**都不补折角：`k` 是交界格本身（当天最后一步），
             `k+1` 是次日的起点 —— 这两个格子上已经有刻痕/虚线起点，
             再叠一枚金色折角就变成"楔子 + 黑条"糊在一起（3× 特写里看得很清楚）。
             多天时每一道交界都按这条来（`cuts.some`）。 */
          const nearCut = hasSplit && cuts.some((c) => k === c || k === c - 1);
          if (k > 0 && (dx !== prevDx || dy !== prevDy) && !nearCut) {
            (day === 0 ? cornersNow : cornersNext).push([cx, cy, dx, dy]);
          }
          if (isLast) endDir = [dx, dy];
        } else if (afterPath) {
          // 默认：只登记，落笔在光照之后（见文件末尾重放段）
          afterPath.push([cx, cy, dx, dy, isLast ? 1 : 0, day === 0 ? 0 : 1]);
        } else {
          // `?devpathafter=0`：旧路径 —— 立刻画、且被整屏 multiply 乘暗（负向对照用）
          drawPathArrow(ctx, cx, cy, dx, dy, isLast, day === 1);
        }
        prevDx = dx;
        prevDy = dy;
      }
      /** 本帧的流动相位（世界 px）；`?devflow=0` / 减少动态 ⇒ 恒 0。 */
      const flow = flowPhase(vm.pathMp);
      /* `speed`/`mp` 一起回传：判据要能对账"这一帧用的速度是不是按移动力算出来的"，
         而不只是"相位在变"。 */
      this.pathFlowSeen = {
        on: FLOW && !REDUCE_MOTION,
        offset: +flow.toFixed(2),
        period: FLOW_PERIOD,
        reduced: REDUCE_MOTION,
        speed: +flowSpeed(vm.pathMp).toFixed(2),
        mp: FLOW_PACE_OVERRIDE ?? vm.pathMp ?? null,
        base: FLOW_BASE,
        fixed: FLOW_FIXED,
      };
      if (PATH_LINE) {
        /* 分段：今天 = pts[0..cuts[0]]，其余（第 2 天起）全归"明天"那一段 ——
           它们共享交界点，线才不断开。
           为什么不按天拆成 N 条不同线型的线：**通道不够**。虚线已经占用"不是今天"，
           再用线型分第 3 天就只能往"更细的虚线"上退，32px 格上分不出来。
           所以第 3 天起**靠刻痕数量**表达（一道 = 明天，两道 = 后天），线型统一。 */
        const first = cuts[0] ?? len;
        const now = pts.slice(0, first + 1).map((q): [number, number] => [q.x, q.y]);
        const nextPts =
          first < pts.length - 1 ? pts.slice(first).map((q): [number, number] => [q.x, q.y]) : [];
        const tick = (c: number): [number, number, number, number] => {
          const d = cutDirs.get(c) ?? [0, 0];
          return [pts[c].x, pts[c].y, d[0], d[1]];
        };
        const L: PathLine = {
          now,
          next: nextPts,
          cornersNow,
          cornersNext,
          end: endDir,
          cuts: cuts.map(tick),
        };
        /* 每道刻痕的**屏幕坐标**（CSS px，诊断用）：写报告要裁特写时靠它定位，
           比"在整屏截图里找一小段黑杠"快得多，也不会裁错格。 */
        this.pathCutsScreen = cuts.map((c) => {
          const d = cutDirs.get(c) ?? [0, 0];
          return {
            step: c,
            x: +(pts[c].x * cam.zoom + cam.x).toFixed(1),
            y: +(pts[c].y * cam.zoom + cam.y).toFixed(1),
            dx: d[0],
            dy: d[1],
          };
        });
        if (this.pathAfter) {
          afterLine = L;
        } else {
          // 负向对照：同样画在光照之前
          drawPathLine(ctx, L, flow);
        }
      }
    }
    /* `pathDots` 只能在这趟之后写（`statPathDots` 是上面这段数出来的）⇒ 合并进已写好的对象，
       不重写整只 —— 否则会把 `dots`/`shade` 那几笔覆盖成 0。 */
    if (BAND_STATS && statPathDots > 0) {
      const w = window as unknown as { __bandStats?: Record<string, unknown> };
      if (w.__bandStats) w.__bandStats.pathDots = statPathDots;
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
    this.shadowCount = 0;
    this.shadowPx = 0;
    if (SHADOW_PROBE) this.shadowSpots = [];
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
        if (sprite) {
          /**
           * §21.8「每英雄一次」的**可见**那一半：当前英雄已经领过的属性物件压暗。
           *
           * 三条口径：
           *   ① 按**当前选中的英雄**判断，不按"我方任意英雄"——物件对别的英雄仍然有效，
           *      全灰会把"换个英雄还能拿"这件事直接说错；
           *   ② 只压精灵（0.45），不动接地影与地面 ⇒ 读成"这件领过了"，不是"这里没东西"；
           *   ③ 物件**不移除**（`applyInteraction` 也不移除）——所以必须有这个视觉差，
           *      否则玩家会一直走上去看同一句"已经领过了"。
           */
          const spent =
            d.obj.kind === 'statBoost' &&
            vm.selectedHeroId != null &&
            d.obj.visitedBy.includes(vm.selectedHeroId);
          // 接地影先落笔、精灵后盖 ⇒ 只留脚下那一圈，不在半空留黑饼（见 drawContactShadow）。
          const bb = this.silBBoxAt(sprite, d.x, d.y);
          if (bb) this.drawContactShadow(bb);
          if (spent) ctx.globalAlpha = 0.45;
          this.blit(sprite, d.x, d.y);
          if (spent) ctx.globalAlpha = 1;
          // §19.3.4 C3：爆发怪 = 普通野怪图标 + 6×6 红角标（不改图集）。
          // 分不出"能绕的"和"挡路的"，玩家会以为所有野怪都必须打、全程绕路。
          if (isOutbreakObject(d.obj)) {
            this.drawOutbreakMark(sprite, d.x, d.y);
          }
          // §14.3 G5 的验收把手：记下真正画出去的帧名与屏幕矩形（仅 ?devcastle=1）
          if (this.devTownDrawn && d.obj.kind === 'town') {
            const f = this.atlas.get(sprite);
            if (f) {
              const p = this.camera.worldToScreen(d.x * TILE + f.ax, d.y * TILE + f.ay);
              this.devTownDrawn.set((d.obj.payload as { townId: string }).townId, {
                sprite,
                x: p.sx,
                y: p.sy,
                w: f.w * this.camera.zoom,
                h: f.h * this.camera.zoom,
              });
            }
          }
        }
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
        // 英雄也垫一层接地影（先于选中脉冲/阵营底盘落笔）：棋子是全地图最"该站在地上"的东西。
        const heroFrame = `hero_${d.owner === 'neutral' ? 'neutral' : d.owner}`;
        const hb = this.silBBoxAt(heroFrame, Math.round(d.fx), Math.round(d.fy));
        if (hb) this.drawContactShadow(hb);
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
        this.blit(heroFrame, Math.round(d.fx), Math.round(d.fy));
        // §13.4 队伍徽标：紧跟在英雄之后、同一趟 y 排序里画（硬条件 ①「并入 y 排序」）。
        this.drawTeamBadge(vm, d.id, d.owner, d.fx, d.fy);
      }
    }

    if (SHADOW_STATS) {
      (window as unknown as { __shadowStats?: unknown }).__shadowStats = {
        on: this.shadowOn,
        n: this.shadowCount, // 本帧压了几层影
        px: Math.round(this.shadowPx), // 落笔面积（世界 px²）
      };
    }

    ctx.restore();

    /* --- 光照层（屏幕空间）：昼夜 multiply 叠色 + 暖光 + 暗角 --- */
    if (lightingOn()) this.applyLighting(now);

    /* --- 格心点：同样画在光照**之后**（`dots` 模式；其它模式本数组为空） ---
       走世界坐标 + 相机变换，与边带同一套；落笔顺序放在边带**之前**，让边界那圈线压住点。
       已知取舍（与边带相同、已接受）：这两个元素不再被 y 排序的实体遮挡。
       实测影响很小 —— 点只落在可走且本回合可达的格上，树/怪/城所在格本就不是可走格。 --- */
    if (afterDots.length > 0) {
      ctx.save();
      ctx.translate(cam.x, cam.y);
      ctx.scale(cam.zoom, cam.zoom);
      for (const [cx, cy] of afterDots) {
        ctx.fillStyle = REACH_DOT_INK;
        ctx.fillRect(cx - REACH_DOT_R, cy - REACH_DOT_R, REACH_DOT_R * 2, REACH_DOT_R * 2);
        ctx.fillStyle = REACH_DOT_CORE;
        ctx.fillRect(
          cx - REACH_DOT_CORE_R,
          cy - REACH_DOT_CORE_R,
          REACH_DOT_CORE_R * 2,
          REACH_DOT_CORE_R * 2,
        );
      }
      ctx.restore();
    }

    /* --- 预览路径的地标：与点同一趟、画在光照**之后**（`?devpathafter=0` 时本数组为空） ---
       顺序在点之后 ⇒ 路线压在边界点之上（层级：路线 > 边界）。 --- */
    if (afterPath && afterPath.length > 0) {
      ctx.save();
      ctx.translate(cam.x, cam.y);
      ctx.scale(cam.zoom, cam.zoom);
      for (const [cx, cy, dx, dy, last, nxt] of afterPath) {
        drawPathArrow(ctx, cx, cy, dx, dy, last === 1, nxt === 1);
      }
      ctx.restore();
    }
    if (afterLine) {
      ctx.save();
      ctx.translate(cam.x, cam.y);
      ctx.scale(cam.zoom, cam.zoom);
      drawPathLine(ctx, afterLine, this.pathFlowSeen.offset);
      ctx.restore();
    }
    /* --- 交界在屏幕外 ⇒ 屏幕边缘补一枚指示 ---
       这一段是**屏幕空间**（`restore()` 之后变换回到 dpr 基准，坐标单位 = CSS px），
       理由：它要贴着视口边缘，跟着世界走会跟着滚出画面。颜色不受光照 multiply 影响。 --- */
    this.pathEdgeSeen = null;
    this.pathEdgeLabel = null;
    /* 只跟**第一道**交界（今天的收工点）：边缘指示回答的是"今天走到哪"，
       第二道之后的信息本来就在屏幕外，一条射线也只能指一个方向。 */
    if (afterLine && afterLine.cuts.length > 0 && PATH_EDGE) {
      const [wx, wy] = afterLine.cuts[0];
      const { viewW: vw, viewH: vh } = cam;
      const m = 14; // 离边缘留出的余量（CSS px）：够画一道短杠，又不至于被裁
      const ex = wx * cam.zoom + cam.x;
      const ey = wy * cam.zoom + cam.y;
      const inside = ex >= m && ex <= vw - m && ey >= m && ey <= vh - m;
      /* 把"交界落在屏幕哪儿"也记下来（不管画没画）：判据红的时候，
         第一个要排除的就是"它其实在屏内"或"相机没跟在英雄身上"。 */
      this.pathEdgeCalc = {
        ex: +ex.toFixed(1),
        ey: +ey.toFixed(1),
        vw,
        vh,
        inside,
        cutWorld: [wx, wy],
        cam: [+cam.x.toFixed(1), +cam.y.toFixed(1), cam.zoom],
      };
      if (!inside) {
        /* 从**英雄**脚下朝交界打一条射线，夹到内缩矩形上 ——
           用英雄当原点而不是视口中心：镜头没跟随时两者不同，而"我还能走多远"
           这个问题的原点永远是英雄。 */
        const from = vm.pathFrom ?? { x: 0, y: 0 };
        const hx = from.x * cam.zoom + cam.x + TILE * cam.zoom * 0.5;
        const hy = from.y * cam.zoom + cam.y + TILE * cam.zoom * 0.5;
        const dx = ex - hx;
        const dy = ey - hy;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const tx = ux > 0 ? (vw - m - hx) / ux : ux < 0 ? (m - hx) / ux : Infinity;
        const ty = uy > 0 ? (vh - m - hy) / uy : uy < 0 ? (m - hy) / uy : Infinity;
        const t = Math.min(tx, ty);
        if (Number.isFinite(t) && t > 0) {
          const px = hx + ux * t;
          const py = hy + uy * t;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(Math.atan2(uy, ux));
          // 朝外的一小段金线（与"明天"同一套虚线语言：路还在继续）
          ctx.lineCap = 'butt';
          ctx.setLineDash([]);
          ctx.strokeStyle = PATH_DOT_INK;
          ctx.lineWidth = 3.6;
          ctx.beginPath();
          ctx.moveTo(1.5, 0);
          ctx.lineTo(9, 0);
          ctx.stroke();
          ctx.strokeStyle = PATH_DOT_CORE;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(1.5, 0);
          ctx.lineTo(9, 0);
          ctx.stroke();
          // 横切短杠 = 交界刻痕的同款语言（比格内那道略大：它要压过 4.2 宽的线 + 墨边）
          ctx.fillStyle = PATH_DOT_INK;
          ctx.fillRect(-1.5, -6.5, 3.0, 13);
          ctx.restore();

          /* --- "还有 N 天"：只在交界出画时画 ---
             屏内时刻痕自己就是答案；出画时这是唯一能说出"这一下要花几天"的地方。
             牌子压在内侧（朝外方向的反方向退开 gap），再夹进视口 —— 被裁掉半句等于没写。 */
          if (EDGE_LABEL && this.pathDayCount > 1) {
            const text = `还有 ${this.pathDayCount - 1} 天`;
            ctx.save();
            ctx.font = '600 12px ui-sans-serif, system-ui, -apple-system, "PingFang SC", sans-serif';
            const w = Math.ceil(ctx.measureText(text).width) + 12;
            const h = 18;
            const gap = 12;
            const vertical = Math.abs(uy) > Math.abs(ux);
            const cx = px - ux * (gap + (vertical ? 0 : w / 2));
            const cy = py - uy * (gap + (vertical ? h / 2 : 0));
            const lx = Math.round(Math.min(Math.max(cx - w / 2, m), vw - m - w));
            const ly = Math.round(Math.min(Math.max(cy - h / 2, m), vh - m - h));
            const r = 4;
            ctx.beginPath();
            ctx.moveTo(lx + r, ly);
            ctx.arcTo(lx + w, ly, lx + w, ly + h, r);
            ctx.arcTo(lx + w, ly + h, lx, ly + h, r);
            ctx.arcTo(lx, ly + h, lx, ly, r);
            ctx.arcTo(lx, ly, lx + w, ly, r);
            ctx.closePath();
            ctx.fillStyle = 'rgba(26,17,9,0.88)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,230,160,0.45)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = PATH_DOT_CORE;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, lx + w / 2, ly + h / 2 + 0.5);
            ctx.restore();
            this.pathEdgeLabel = { text, x: lx, y: ly, w, h };
          }
          this.pathEdgeSeen = { x: px, y: py };
        }
      }
    }

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
