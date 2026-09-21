/**
 * 喜剧布景层（`cartoon-style.md §6.1`）—— **最小可实现切片**。
 *
 * ## 本文件实现了什么、没实现什么（诚实边界）
 *
 * §6.1 的规格是 17 型 / 38 帧、分 A（地面涂鸦）/ B（立体道具）/ C（活动物）三拨。
 * 本切片只做 **A 组地面涂鸦的 5 型**（`sd_g_*`）—— 它是**唯一不需要新建渲染通道**的一拨：
 * 地面涂鸦永不遮挡单位（§6.1.3），因此可以整体烘进一张离屏画布，每帧一次 `drawImage`。
 * **B 组（立体道具，须并入 y 排序）与 C 组（活动物，须每帧位移）本切片不做** ——
 * 它们要动 `MapRenderer` 的画家算法与新增每帧状态，是独立一单（见 §6.1.8 工程 2.5 人日）。
 *
 * ## 为什么单独一张画布（而不是烘进 TerrainLayer）
 * §6.1.6 的原话：烘进地形层会让开关无法独立于地形生效（切档要重烘整张地形）。
 * 所以本层自持一张与地形同尺寸的画布，`setDressing` 变化时只重烘它自己。
 *
 * ## 密度与语义锚点（本切片的第二条硬约束）
 *
 * 用户这一轮同时要了「**画质提升**」和「**画面简洁**」。在**地图上**这两者会打架：
 * 加道具 = 加信息量。所以本层用**两条**约束把"变花"堵在结构上，而不是靠调概率：
 *   1. **语义锚点**（`Decal.fits`）：每个道具只在**讲得通的地方**出现 —— 干草/头盔在路边、
 *      藏宝图在水边、跳房子与酒渍在镇旁。**空地不放。** 没语境 ⇒ 密度自然稀疏。
 *   2. **净距 `CLEAR`**：资源点 / 宝箱 / 镇子周围 **2 格内零布景** —— 保证"一眼要看到的
 *      东西"不被抢注意力。这是判据「道具不应让它旁边的东西变难找」的机器可检形式。
 *
 * ## 零游戏语义（§6.1.1 第 5 条，硬约束）
 * 布景**不写入 `map.tiles`、不进存档、不参与寻路 / 视野 / 迷雾 / 可达范围 / 选中**。
 * 位置完全由 `hash2(x, y, SEED)` 确定性给出 —— 同一张图每次进游戏逐格一致，
 * 不引入新随机源、不产生存档体积。
 *
 * ## 色板纪律（§6.1.7）
 * 只用 §3.2 全局基底色（`ink0` / `metal` / `canvas` / `stone` / `wood`）+ 1px `ink0` 描边。
 * ⚠️ 一处**刻意偏离**：`sd_g_hopscotch` 是**粉笔画**（涂鸦，不是立体物）——给它套 1px 深色描边
 * 会把"粉笔格"读成"铁栅栏"。C1 的判据是"1 画布像素 = 手机 4–6 物理像素，加粗即成一团墨"，
 * 针对的是**立体物的轮廓**；地面粉笔线属于 C4 里"地面层"那一类，故**不加描边**，仅以半透明粉笔白落笔。
 */
import type { GameMap, MapObjectKind, TerrainKind } from '../core/types.js';
import { idx } from '../core/map/grid.js';
import { TILE } from './ortho.js';
import { PixBuf, hash2 } from './pixel.js';
import { quality } from './quality.js';

/* ---------------- 色板（§3.2 全局基底） ---------------- */
const INK0 = '#2a1a12';
const METAL_HI = '#dfe6f0';
const METAL_MID = '#aab6c2';
const METAL_LO = '#6b7686';
const CANVAS_HI = '#e8d9a8';
const CANVAS_LO = '#b9a06a';
const STONE_MID = '#a9a093';
const CHALK = '#f2ecdd';
const WINE = '#5a1f2e';
const MARK_RED = '#c0392b';
const STRAW_A = '#e8d08a';
const STRAW_B = '#c9a94e';
const STRAW_C = '#8a6f2a';

/* ---------------- 三个确定性种子（§6.1.4 ①） ---------------- */
const SEED_PLACE = 7717;
const SEED_PICK = 9011;
const SEED_SCAN = 3301;
/** 每 6×6 格至多 1 个（§6.1.4 ③）。 */
const BLOCK = 6;
/**
 * 块级放置阈值：hash < 0.55。
 *
 * 这是**唯一**控制密度的旋钮 —— 因为"像不像噪声"这件事由 `fits`（语义锚点）负责，
 * 不由概率负责。实测（26×16 测试图，15 块）：≈ **8 个道具 / 整图**；真机一屏
 * （约 1/3 张图）≈ **3 个**。§6.1.4 ③ 原文写 0.35，那是在**没有**语义锚点时的取值；
 * 有了锚点后阈值可以放宽，否则"做了等于没做"（0.30 实测每屏仅 2 个）。
 */
const PLACE_CUTOFF = 0.55;

/**
 * 任意两个布景的最小间距（格，按落点格算）—— 防"扎堆"。
 * 语义锚点只保证"每处都讲得通"，不保证"彼此不挤"；三处酒渍排成一行照样是噪声。
 */
const MIN_PROP_GAP = 3;

/**
 * **同型**道具的最小间距（格）—— 防"重复感"。
 * 实测（无此约束时）：26×16 图上前 4 个道具里 3 个是 `sd_g_stain` 且在同一行。
 * "同一件事发生 3 次"读起来像 bug，不像布景 —— 这是布景层最廉价也最致命的失败模式。
 */
const MIN_SAME_GAP = 9;

/**
 * 与**"一眼要看到的交互物"**的最小净距（格，切比雪夫）。
 *
 * 这是密度判据的一半（另一半是"语义锚点"，见 `fits`）：用户这一轮同时要
 * "画质提升"和"画面简洁"，而**地图上加道具 = 加信息量** —— 两者会打架。
 * 唯一可靠的判据是：**道具不能让它旁边的东西变难找**。资源点 / 宝箱 / 镇子
 * 是玩家要**一眼看到**的目标，所以它们周围 2 格内**一个布景都不放**。
 * （`sd_g_*` 本身永不遮挡单位，所以这不解决遮挡，只解决"抢注意力"。）
 *
 * ⚠️ **2026-09-21 修正（画面主线 · 自测揪出的真 bug）**：净距**只对"目标物"成立**，
 * **不能对一切 `objectId` 成立**。旧实现把 `CLEAR` 套给了**所有**物件 —— 包括地图上
 * 每张 **~130 个障碍物**（树 / 岩石 / 山）。后果有二，都是致命的：
 *   1. **本层几乎放不下东西**：障碍物密布全图 ⇒ "2 格内无任何物件"的格子在真图上几乎不存在。
 *      实测 9 张真实图（small/medium/large × seed 1/7/42）**总计只放下 9 个道具**
 *      （全是 `sd_g_map`，因为它锚在水边），等于 **0.33 个/屏 = 玩家看不到**。
 *   2. **与 `sd_g_helmet` 的语义锚点直接互斥**：头盔的 `fits` 要求"附近 2 格内有障碍物"，
 *      而 `canPlace` 要求"2 格内无任何物件" —— **二者不可能同时为真** ⇒ 头盔永远放不下。
 * 修正：净距只作用于 `TARGET_KINDS`；障碍物 / 游荡怪**只禁同格**（见 `canPlace` ①）。
 */
const CLEAR = 2;

/**
 * 布景必须避让的**"目标物"**（= 玩家要一眼找到的交互物）。
 *
 * 只列**交互语义**的物件；**障碍物 / 游荡怪刻意不在列** —— 它们本身就是景物的一部分，
 * 且多个 `fits` 锚点（如"路边有障碍物"）**依赖**附近有障碍物。把障碍纳入净距 = 自相矛盾。
 */
const TARGET_KINDS: readonly MapObjectKind[] = [
  'resourcePile', 'treasureChest', 'artifact', 'fountain', 'town', 'mine', 'vault',
];

/* ---------------------------------------------------------------- 道具绘制 */

/** 跳房子格（2×2 格 = 64×64）：粉笔。无描边（见文件头"刻意偏离"）。 */
function drawHopscotch(pb: PixBuf): void {
  const cells: [number, number][] = [
    [22, 4], [22, 24], [22, 44],
  ];
  // 三格单列 + 顶部一格分叉，最简跳房子形状
  for (const [x, y] of cells) pb.frame(x, y, 20, 20, CHALK, 0.75);
  // 顶部两格
  pb.frame(2, 4, 18, 20, CHALK, 0.7);
  pb.frame(42, 4, 18, 20, CHALK, 0.7);
  // 单脚点位：用"点数"代替数字（§5.3 no text）
  const pips: [number, number][] = [
    [8, 12], [24, 14], [26, 14], [28, 14], [30, 32], [28, 34], [32, 34], [30, 36],
    [28, 52], [30, 52], [32, 52], [28, 56], [32, 56],
  ];
  for (const [x, y] of pips) pb.set(x, y, CHALK, 0.9);
}

/** 干草屑（1×1 = 32×32）：一路洒过去、没人扫（§6.1.2 A 组）。 */
function drawStraw(pb: PixBuf): void {
  const strokes: [number, number, number][] = [
    [3, 8, 5], [10, 6, 4], [16, 11, 6], [23, 7, 5], [27, 13, 4],
    [5, 18, 6], [12, 16, 5], [19, 20, 6], [25, 18, 5], [8, 25, 5],
    [15, 27, 6], [22, 26, 5], [27, 28, 4], [4, 29, 3],
  ];
  strokes.forEach(([x, y, len], i) => {
    const c = i % 3 === 0 ? STRAW_C : i % 2 === 0 ? STRAW_B : STRAW_A;
    const dy = i % 2 === 0 ? 1 : -1;
    pb.line(x, y, x + len, y + dy, c, 0.9);
  });
}

/** 落地的头盔（1×1 = 32×32）：一顶倒扣的骑士头盔躺着，主人不在（§6.1.2 A 组）。 */
function drawHelmet(pb: PixBuf): void {
  // 倒扣：穹顶朝下、帽檐朝上
  pb.ellipse(16, 18, 11, 10, METAL_MID);
  pb.ellipse(12, 16, 7, 6, METAL_HI, 0.85); // 唯一一处 1px 级高光（§1.4）
  pb.rect(3, 25, 26, 4, METAL_LO);
  pb.rect(3, 25, 26, 1, METAL_MID);
  // 面甲缝（内部结构线用 ink1 口径的深色，1px）
  pb.hline(8, 24, 20, '#3d4650');
  pb.set(16, 13, METAL_HI);
  pb.outline(INK0);
}

/** 酒渍（1×1 = 32×32）：一滩酒 + 一块碎陶片（§6.1.2 A 组）。 */
function drawStain(pb: PixBuf): void {
  pb.ellipse(14, 18, 9, 6, WINE, 0.72);
  pb.ellipse(21, 21, 5, 4, WINE, 0.5);
  pb.ellipse(12, 15, 4, 3, '#7a3040', 0.6);
  // 碎陶片
  pb.poly([[24, 24], [29, 26], [27, 30], [23, 28]], STONE_MID);
  pb.outline(INK0);
}

/** 画错的藏宝图（1×1 = 32×32）：红十字标在一片明显是水的地方（§6.1.2 A 组）。 */
function drawTreasureMap(pb: PixBuf): void {
  pb.poly([[6, 9], [26, 7], [27, 24], [5, 26]], CANVAS_HI);
  pb.poly([[26, 7], [27, 24], [23, 24], [22, 8]], CANVAS_LO); // 卷边
  pb.line(11, 12, 15, 22, '#5b7fa6', 0.6); // 蓝色水纹
  pb.line(13, 12, 17, 22, '#5b7fa6', 0.5);
  // 红十字：两个 1px 粗的笔画
  pb.line(14, 13, 22, 21, MARK_RED, 0.95);
  pb.line(22, 13, 14, 21, MARK_RED, 0.95);
  pb.outline(INK0);
}

/* ---------------------------------------------------------------- 道具登记 */

/* ---------------------------------------------------------------- 语境 / 语义锚点 */

/**
 * 放置语境：只回答"这一格周围有什么"，不持有任何地图以外的东西。
 * 抽成接口是为了让 `fits` 是**纯判断**、可单独读、不散落地图遍历。
 */
interface Ctx {
  /** 半径 r（切比雪夫）内是否有指定地形。 */
  hasTerrain: (kinds: readonly TerrainKind[], r: number) => boolean;
  /** 半径 r 内是否有指定种类的游戏物件。 */
  hasObject: (kinds: readonly MapObjectKind[], r: number) => boolean;
}

interface Decal {
  name: string;
  /** 占地边长（格）：1 或 2。 */
  span: number;
  build: (pb: PixBuf) => void;
  /**
   * **语义锚点**：这个道具"讲得通"的地方。
   *
   * 为什么必须有：均匀随机撒道具 = **噪声**（每处都没有理由），而用户要的是
   * "简洁"。有理由的道具读作**场景**（"广场上的跳房子"），没理由的道具读作**杂物**。
   * ⇒ **空地不放**。密度因此不是靠调概率压下来的，而是靠"没语境就没道具"自然稀疏。
   */
  fits: (c: Ctx) => boolean;
}

/** A 组 5 型（`asset-spec.md §2.3` 的 `sd_g_*`）。全程序化，0 张 AI（§6.1.2）。 */
const DECALS: readonly Decal[] = [
  // 广场跳房子：得有人住、有广场 —— 放镇子（含城堡，kind 同为 town）附近
  { name: 'sd_g_hopscotch', span: 2, build: drawHopscotch, fits: (c) => c.hasObject(['town'], 4) },
  // 干草屑：车辙边上掉的 —— 必须在土路上
  { name: 'sd_g_straw', span: 1, build: drawStraw, fits: (c) => c.hasTerrain(['dirt'], 1) },
  // 落地的头盔：骑士在路边/林边掉的
  { name: 'sd_g_helmet', span: 1, build: drawHelmet, fits: (c) => c.hasTerrain(['dirt'], 1) || c.hasObject(['obstacle'], 2) },
  // 酒渍：酒馆门口 —— 同镇子锚点（与跳房子占同一语境，靠 pick 分流）
  { name: 'sd_g_stain', span: 1, build: drawStain, fits: (c) => c.hasObject(['town'], 4) },
  // 画错的藏宝图：笑点就在"红十字标在一片明显是水的中央" ⇒ 必须在水边
  { name: 'sd_g_map', span: 1, build: drawTreasureMap, fits: (c) => c.hasTerrain(['water'], 1) },
];

/** 每个道具的 PixBuf 画布（惰性建一次；`toCanvas()` 有分配，不该每次烘焙重建）。 */
let decalCanvases: HTMLCanvasElement[] | null = null;
function decalCanvas(i: number): HTMLCanvasElement {
  if (!decalCanvases) {
    decalCanvases = DECALS.map((d) => {
      const n = d.span * TILE;
      const pb = new PixBuf(n, n);
      d.build(pb);
      return pb.toCanvas();
    });
  }
  return decalCanvases[i];
}

/* ---------------------------------------------------------------- 放置 */

/** 每种游戏物件占哪些格 → 逐格标记它的 `kind`（多格物件用 `footprint`）。 */
function buildKindGrid(map: GameMap): (MapObjectKind | null)[] {
  const g: (MapObjectKind | null)[] = new Array(map.width * map.height).fill(null);
  for (const id of Object.keys(map.objects)) {
    const o = map.objects[id];
    for (const p of o.footprint ?? [o.pos]) {
      if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) continue;
      g[idx(map, p.x, p.y)] = o.kind;
    }
  }
  return g;
}

function makeCtx(map: GameMap, kindGrid: (MapObjectKind | null)[], x: number, y: number): Ctx {
  const inB = (nx: number, ny: number) => nx >= 0 && ny >= 0 && nx < map.width && ny < map.height;
  return {
    hasTerrain(kinds, r) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (inB(nx, ny) && kinds.includes(map.tiles[idx(map, nx, ny)].terrain)) return true;
      }
      return false;
    },
    hasObject(kinds, r) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (!inB(nx, ny)) continue;
        const k = kindGrid[idx(map, nx, ny)];
        if (k && kinds.includes(k)) return true;
      }
      return false;
    },
  };
}

/**
 * 该格（及 `span×span` footprint）能否放。三层判据，**从宽到严**：
 *
 * ① **本格（footprint）**：在界内、非水、**无任何 `objectId`** —— 布景不与任何物件抢同格
 *    （障碍物 / 游荡怪也只到这一层就够：同格必须避开，但**相邻可以**）。
 * ② **目标物净距**：`TARGET_KINDS` 外沿 `CLEAR` 格内零布景 —— 保"一眼要看到的交互物"。
 * ③ 其余（障碍物 / 游荡怪）**不设净距** —— 见 `CLEAR` 的 2026-09-21 修正。
 */
function canPlace(map: GameMap, x: number, y: number, span: number): boolean {
  // ① footprint：在界内、非水、无物件（任何 kind）
  for (let dy = 0; dy < span; dy++) {
    for (let dx = 0; dx < span; dx++) {
      const cx = x + dx, cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) return false;
      const c = map.tiles[idx(map, cx, cy)];
      if (c.terrain === 'water') return false;
      if (c.objectId) return false;
    }
  }
  // ② 目标物净距：只避 TARGET_KINDS
  for (let dy = -CLEAR; dy < span + CLEAR; dy++) {
    for (let dx = -CLEAR; dx < span + CLEAR; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const c = map.tiles[idx(map, nx, ny)];
      if (!c.objectId) continue;
      if (TARGET_KINDS.includes(map.objects[c.objectId].kind)) return false;
    }
  }
  return true;
}

/* ---------------------------------------------------------------- 落点（可核） */

/** 一个布景落点。 */
export interface Placement {
  /** `DECALS` 下标。 */
  index: number;
  name: string;
  x: number;
  y: number;
  span: number;
}

/**
 * 计算一张图的**全部布景落点**（确定性：同图同档 ⇒ 逐格一致）。
 *
 * 与绘制分离的理由：落点规则是本层最该被核对的东西（"有没有放在讲得通的地方"、
 * "有没有挡住游戏物件"），分离后 `tools/` 可以直接对它断言，而不必去数画布像素。
 */
export function placementsOf(map: GameMap): Placement[] {
  const out: Placement[] = [];
  const kindGrid = buildKindGrid(map);
  const bx = Math.ceil(map.width / BLOCK);
  const by = Math.ceil(map.height / BLOCK);

  for (let byi = 0; byi < by; byi++) {
    for (let bxi = 0; bxi < bx; bxi++) {
      // 每块先掷一次"这块要不要有布景"。密度**只**由这一处控制：
      // `fits` 已经保证"放下就讲得通"，所以这里不需要再靠低概率去压噪声。
      if (hash2(bxi, byi, SEED_PLACE) >= PLACE_CUTOFF) continue;

      // 块内从确定性起点起扫，找第一个"能放 **且** 有讲得通的候选"的格。
      // ⚠️ 候选是**先看有哪种讲得通、再在其中挑**，不是先挑一种再看放不放得下 ——
      // 后者会让"路边块"因为挑中了跳房子而整块判空（实测把每屏道具压到 2 个 = 做了等于没做）。
      const cells = BLOCK * BLOCK;
      const start = Math.floor(hash2(bxi, byi, SEED_SCAN) * cells);

      for (let k = 0; k < cells; k++) {
        const c = (start + k) % cells;
        const cx = bxi * BLOCK + (c % BLOCK);
        const cy = byi * BLOCK + ((c / BLOCK) | 0);
        const dctx = makeCtx(map, kindGrid, cx, cy);

        const cand: number[] = [];
        for (let i = 0; i < DECALS.length; i++) {
          if (!DECALS[i].fits(dctx)) continue;
          if (!canPlace(map, cx, cy, DECALS[i].span)) continue;
          cand.push(i);
        }
        if (cand.length === 0) continue;

        const pick = cand[Math.floor(hash2(bxi, byi, SEED_PICK + k) * cand.length)];
        // 间距约束：太挤（任意型）或太近的同型 ⇒ 换下一个候选格，而不是放弃整块
        const cheb = (q: Placement, px: number, py: number) => Math.max(Math.abs(q.x - px), Math.abs(q.y - py));
        if (out.some((q) => cheb(q, cx, cy) < MIN_PROP_GAP)) continue;
        if (out.some((q) => q.index === pick && cheb(q, cx, cy) < MIN_SAME_GAP)) continue;

        out.push({ index: pick, name: DECALS[pick].name, x: cx, y: cy, span: DECALS[pick].span });
        break;
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------- 图层 */

/**
 * 地面涂鸦层：把 §6.1.2 A 组道具确定性烘进一张整图大小的离屏画布。
 * 每帧只做一次 `drawImage`（§6.1.6）。
 */
export class SetDressingLayer {
  private canvas: HTMLCanvasElement | null = null;
  private bakedFor: GameMap | null = null;
  private bakedMode: string | null = null;

  /** 强制下一帧重烘（`setDressing` 档位变化时调用，§6.1.6"切档行为"）。 */
  invalidate(): void {
    this.bakedFor = null;
  }

  /** 拿到这张地图的布景画布；地图或档位变了就重烘。 */
  ensure(map: GameMap): HTMLCanvasElement {
    const mode = quality.setDressing;
    if (this.bakedFor === map && this.canvas && this.bakedMode === mode) return this.canvas;
    this.bake(map, mode);
    this.bakedFor = map;
    this.bakedMode = mode;
    return this.canvas!;
  }

  private bake(map: GameMap, mode: string): void {
    const w = map.width * TILE;
    const h = map.height * TILE;
    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建布景层画布上下文');
    ctx.clearRect(0, 0, w, h);
    if (mode === 'off') return; // 低端：整层不烘（§6.1.5）

    for (const p of placementsOf(map)) {
      // 地面涂鸦贴格顶左；1 格道具在格内下沉一点，读起来像"掉在地上"
      const drop = p.span === 1 ? 4 : 0;
      ctx.drawImage(decalCanvas(p.index), p.x * TILE, p.y * TILE + drop);
    }
  }
}
