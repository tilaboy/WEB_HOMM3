/**
 * 地形"地貌层" —— 给逐格铺开的地形砖叠一层**地图尺度**的明暗与冷暖。
 *
 * ## 为什么需要（这是 `cartoon-style.md §3.1` 修正的直接产物）
 *
 * `atlas.ts` 的 `terrainTile()` 用**周期 8** 的 fbm 生成单砖纹理。周期 8 意味着
 * 噪声在砖内就循环完了 ⇒ **同一型（同 variant）的砖逐像素长相完全一样**。铺开一张
 * 草地，得到的是**一张壁纸**：有笔触，但**没有大地貌**。§3.1 当年判"地形已经读起来
 * 像有笔触的像素画"——**这句话对单砖成立，对"铺满屏的地形"不成立**。
 * 玩家 90% 时间在看的那一层，因此是平的。本层就是补这一层"大起伏"。
 *
 * ## 做法：不改砖，只叠光
 *
 * 本层**不修改任何 `g_*` / `sh_*` / `deco_*` 资产**（§3.1 的成本论证继续成立），
 * 只在地形**烘焙**期按地图坐标叠一层低频信号：
 *   - **方向光**：阳光自北侧来 → 地图越靠上越亮、越靠下越暗（大尺度立体感）；
 *   - **地貌起伏**：低频 fbm → 大小不一的明暗团块（读成坡 / 谷 / 阴影）；
 *   - 亮处偏暖白、暗处偏冷紫 —— **同时动明度与冷暖**，比单纯压暗更像"光"。
 *
 * 全部在烘焙期完成 ⇒ **运行时零成本**（仍是每帧一次 `drawImage`）。
 * 与 §6.1 喜剧布景层同一种做法：**在地形之上新增一层，不重写地形**。
 *
 * ## 为什么是纯函数
 * 抽成纯函数，`tools/artshot.mjs` 才能对**同一份地形**分别渲染"加/不加本层"两张图，
 * 从而给出一张**只差这一处改动**的对照截图 —— 而不是"算式 vs 实测"。
 */
import { fbm, hash2 } from './pixel.js';

/**
 * 低频地貌起伏，值域 [-1, 1]。
 *
 * 频率 0.17 格⁻¹ ⇒ 一个明暗团约 **6 格**宽。这个数是**实测调出来的，不是拍的**：
 * 0.11（约 9 格/团）时逐格平均 L* 的**相邻差只有 1.3**——梯度太缓，眼睛把它读成
 * "没有"（人眼对**大面积低对比**的渐变几乎不敏感）。0.17 把同样的振幅摊在更短的
 * 距离上，相邻差升到 ~2.7，才读得出"坡 / 谷"。再高（>0.25）就成噪点、且和单砖纹理打架。
 */
export function macroTone(gx: number, gy: number): number {
  return (fbm(gx * 0.17, gy * 0.17, 6, 8821) - 0.5) * 2;
}

/** 方向光：北亮南暗，值域 [-1, 1]（地图顶行 +1、底行 -1）。 */
export function sunTone(gy: number, heightTiles: number): number {
  const t = gy / Math.max(1, heightTiles - 1);
  return 1 - 2 * t;
}

export interface Shade {
  /** 覆盖色（十六进制）。 */
  color: string;
  /** 覆盖透明度（0~1）。 */
  alpha: number;
}

/** 亮部色（暖白，模拟日光）。 */
export const SHADE_WARM = '#fff0cf';
/** 暗部色（冷紫，模拟阴影 —— 与 §3.2 的 `shadow` 冷紫同族）。 */
export const SHADE_COOL = '#191434';

/** 起伏与方向光的混合权重（起伏是主体，方向光只做整体倾向）。 */
const W_MACRO = 0.74;
const W_SUN = 0.26;
/** 最大覆盖透明度：亮 0.34 / 暗 0.40。够看得见，又不至于把色板压浊（实测这一档颜色仍清爽）。 */
const A_MAX_WARM = 0.34;
const A_MAX_COOL = 0.4;

/**
 * 增益（超 1 会把中段往两端推、到端点截断）。
 *
 * **为什么必须有**：`fbm` 底层的 `pnoise` 是**值噪声**，取值虽是 [0,1)，
 * 但分布**集中在 0.5 附近**（双线性插值把两端概率摊薄了）⇒ `(fbm-0.5)*2`
 * 实测只落在 ±0.45 内、常见 ±0.2。不做增益时，全图 alpha 挤在 0.03 上下
 * （实测 max 仅 0.098）—— 那就是"叠了一层看不见的光"。
 * 增益后再截断，才让"亮团 / 暗团"真正拉开。
 */
const TONE_GAIN = 2.0;

/** 把中段往两端推、端点截断到 [-1,1]。 */
function expand(tone: number): number {
  return Math.max(-1, Math.min(1, tone * TONE_GAIN));
}

/**
 * 把两路信号合成"一次半透明覆盖"。
 * 阈值 0.008 以下返回 alpha≈0（调用方直接跳过，省一次 fillRect）。
 */
export function shadeOf(gx: number, gy: number, heightTiles: number): Shade {
  const tone = expand(macroTone(gx, gy) * W_MACRO + sunTone(gy, heightTiles) * W_SUN); // [-1,1]
  if (tone >= 0) return { color: SHADE_WARM, alpha: tone * A_MAX_WARM };
  return { color: SHADE_COOL, alpha: -tone * A_MAX_COOL };
}

/**
 * 近水湿边强度（0~1）：与水相邻的陆地格，朝水一侧压一条冷暗边 —— 让岸线不是"贴"在
 * 水上，而是"湿"进水里。参数 = 该格八邻域里的水格数。
 */
export function wetEdgeAlpha(waterNeighbours: number): number {
  return Math.min(1, waterNeighbours / 3) * 0.16;
}

/* ============================ 地貌区（G1 / §3.1.2 的 X1） ============================ */

/**
 * 地貌区场 —— 比 `macroTone`（≈6 格/团）**更大尺度**的低频信号（≈14 格/团）。
 *
 * `macroTone` 补的是"没有**大地貌**"这一半（缓坡 / 洼地）；本函数再往上一层，
 * 回答的是"**这是哪片地**"：成片林 / 成簇丘 / 裸岩，而不是一整张均匀草地。
 * 与 `macroTone` 是**两路独立信号**（不同 seed），互不抵消。
 */
export function regionField(gx: number, gy: number): number {
  return fbm(gx * 0.058, gy * 0.058, 4, 5127); // [0,1)
}

/** 地貌区数（§3.1.2 X1 取 3–4 个「地貌区」）。取 4。 */
export const REGION_COUNT = 4;

/**
 * 地貌区 id（`0 .. REGION_COUNT-1`）。
 *
 * 场值量化时加**格级抖动**（±0.05 场值）⇒ 区边界是**锯齿**而非直线，
 * 规避 §3.1.2 记的风险「分得太硬会读成'贴块分区'」。
 */
export function regionOf(gx: number, gy: number): number {
  const v = regionField(gx, gy);
  const jitter = (hash2(gx, gy, 613) - 0.5) * 0.10;
  return Math.max(0, Math.min(REGION_COUNT - 1, Math.floor((v + jitter) * REGION_COUNT)));
}

/**
 * 每区一套"地貌色偏"（**同时**动明度与冷暖）。索引 = `regionOf()`。
 *
 * 两条选择依据：
 * ① **不能只差色温** —— 只差色相在灰度下会被抹平（同 `accessibility-requirements.md §4.6` 的教训）；
 * ② **不能只差明度** —— 只差亮度会读成"同一片地的四个亮度"，不像"四片不同的地"。
 * 故四区在 **ΔL\* ≈ 6~8** 的档上再叠冷暖差：干爽草甸（亮暖黄）/ 密林洼地（暗绿）/
 * 旱地裸岩（中间调土黄）/ 冷湿沼泽（暗冷蓝）。这一档是"看得见但不脏"的量级。
 */
export const REGION_SHADES: ReadonlyArray<Shade> = [
  { color: '#e6d79b', alpha: 0.15 }, // 0 干爽草甸：偏亮、暖黄
  { color: '#16351f', alpha: 0.2 }, //  1 密林洼地：偏暗、深绿
  { color: '#b98f4e', alpha: 0.17 }, // 2 旱地裸岩：中间调、土黄
  { color: '#182740', alpha: 0.2 }, //  3 冷湿沼泽：偏暗、冷蓝
];

/** 该格的地貌区色偏（`regionOf` → `REGION_SHADES`）。 */
export function regionShade(gx: number, gy: number): Shade {
  return REGION_SHADES[regionOf(gx, gy)];
}
