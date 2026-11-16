/**
 * 城镇建筑外观（M5 · B1 批）—— **16 座 × 4 族 = 64 帧**，44×44。
 *
 * 为什么是 16 不是 15：`BUILDINGS` 里是 16 条（酒馆/市场/议事堂/工坊 · 木栅/石墙/堡垒 ·
 * 五座兵营 · 主力营 · 三座行会）。三座行会走 S5 的 `guildArt.ts`（已有独立闸门与验收读数），
 * 本文件负责其余 **13 座**，帧名 `bld_<owner>_<id>`。
 *
 * 两条不能违反的约束：
 *   ① **原图 44×44 只进描述浮层**（`.bdesc-art`）。卡片是 4 列 × 179px，塞 44px 图会把
 *      建筑名截断、把「建造」挤成两行 —— S5 实拍过一次，别再试。卡片首行另外放 **28px**
 *      （`.bcard-art`，浏览器把 44 缩到 28），那是量过的落点，不是同一个尺寸。
 *   ② **四族只换材质不换结构**：剪影、门窗位置、识别件位置逐像素相同，
 *      差异只在调色板（与 S5 同一张表）。玩家换族不用重新学读图。
 *
 * 每座建筑的"识别点"是**一根能被量出来的东西**，不是"感觉不一样"：
 * 酒馆 = 左侧挑出的招牌、市场 = 条纹遮阳篷、议事堂 = 屋顶以上的旗、
 * 工坊 = 右侧齿轮（8 枚短齿，不是 4 枚长齿——那读成四角星）、木栅 = 八根尖桩、
 * 石墙 = 五个方城齿、堡垒 = 两座塔、农舍 = 篱笆、射箭场 = 草垛靶（方轮廓 + 实心圆，
 * 44px 上画同心环会变成花瓣）、兵营 = 交叉长矛、马厩 = 阁楼草料口、
 * 圣殿 = 透空柱廊、主力营 = 旗杆上的三角旗。
 * `tools/probes/buildingart.mjs` 的 `[B4]` 逐条量这些点，不量"像不像"。
 *
 * 纯函数、不碰 DOM：`PixBuf` 只写整数像素，node 里直接跑。
 *
 * ---- B2（同一批的续）：兵营线五座的 **Lv.2 / Lv.3 外形**，40 帧 ----
 *
 * 背景：`dwell1..5` 的 `maxLevel` 是 3（S4 的兵种升级入口），但此前外观只有 Lv.1，
 * 升到 Lv.2/3 只是名字后面多个 `Lv.N` —— 玩家付了钱，屏幕上什么都没变。
 *
 * 画法只有一条：**升级只加不拆**。Lv.1 的体块、门窗、识别件一律原地保留，
 * 新档在它上面/旁边**长出来**（披屋、二层、角楼、塔尖）。
 *   ① 这样"还是同一座建筑"不靠自觉 —— 掩码是逐档包含的（`[B6]` 量 L1⊆L2⊆L3）；
 *   ② 也省掉"每档重画一遍再对齐全部门窗"的返工（B1 上已经吃过五次）。
 * 三档的差别必须是**体量级**的（加一间、加一层、加一座塔），不是加一枚装饰：
 * 卡面只有 28px，DPR1 上还是 44→28 的缩图，加个 3×3 的部件在这里等于没加。
 *
 * 帧名：`bld_<owner>_<id>`（Lv.1，向后兼容）· `bld_<owner>_<id>_u2` / `_u3`。
 * `_u` 后缀与 S4 的兵种升级形态（`cu_*_u`）同一套约定。
 */
import { PixBuf, shade } from './pixel.js';
import { guildPaletteOf, type BuildingPalette } from './guildArt.js';
import type { SpriteOwner } from './atlas.js';

/** 描述浮层左栏的固定尺寸（`style.css` 的 `.bdesc-art` 必须与它一致）。 */
export const BUILDING_ART_SIZE = 44;

/** 地面线。所有建筑共用同一条基线，所以在浮层里逐张翻也不会"上下跳"。 */
const G = 40;

/** 本文件负责的 13 座（行会三座归 `guildArt.ts`）。顺序 = 城镇面板卡序。 */
export const BUILDING_ART_IDS = [
  'tavern',
  'market',
  'townhall',
  'workshop',
  'wall1',
  'wall2',
  'wall3',
  'dwell1',
  'dwell2',
  'dwell3',
  'dwell4',
  'dwell5',
  'banner',
] as const;

export type BuildingArtId = (typeof BUILDING_ART_IDS)[number];

/** 可升级的三档（只有兵营线五座；其余建筑没有 `maxLevel`）。 */
export const DWELLING_TIER_IDS = ['dwell1', 'dwell2', 'dwell3', 'dwell4', 'dwell5'] as const;
export const MAX_BUILDING_TIER = 3;

export type DwellingTierId = (typeof DWELLING_TIER_IDS)[number];

/**
 * 帧名。**Lv.1 不带后缀**（`bld_p1_dwell3`）—— B1 的 52 帧已经发出去了，
 * 改名等于让旧存档/旧证据全部对不上；只有 Lv.2/3 加 `_u2` / `_u3`。
 */
export function buildingArtName(owner: string, id: string, tier = 1): string {
  const t = Math.max(1, Math.min(MAX_BUILDING_TIER, tier | 0));
  return t <= 1 ? `bld_${owner}_${id}` : `bld_${owner}_${id}_u${t}`;
}

/**
 * 负向对照开关（**只给闸门用**，游戏里永远是默认值）。
 * 每条都对应一个真会犯的错：
 *   plain     去掉全部识别件 ⇒ 16 座塌成"大小不同的方块"（[B4] 必须红）
 *   sameShape 16 座画成同一张 ⇒ 玩家分不清市场与兵营（[B3] 必须红）
 *   onePalette 四族共用 p1 材质 ⇒ "换族只换颜色"这条设计承诺没兑现（[B2] 必须红）
 *   jitter    p2 多一个像素 ⇒ 四族掩码不再逐像素相同（[B1]/[B7] 必须红）
 *   tiersFlat 三档画成同一档 ⇒ "升级看得见"这条承诺没兑现（[B5] 必须红）
 */
export interface BuildingArtBreaks {
  plain: boolean;
  sameShape: boolean;
  onePalette: boolean;
  jitter: boolean;
  tiersFlat: boolean;
}

let breaks: BuildingArtBreaks = {
  plain: false,
  sameShape: false,
  onePalette: false,
  jitter: false,
  tiersFlat: false,
};

export function setBuildingArtBreaks(o: Partial<BuildingArtBreaks>): void {
  breaks = { ...breaks, ...o };
}

export function getBuildingArtBreaks(): BuildingArtBreaks {
  return { ...breaks };
}

/* ---------------------------------------------------------------- 共用笔法 */

type Draw = (pb: PixBuf, pal: BuildingPalette, tier?: number) => void;

/** 墙体：左缘提亮、右缘压暗 —— 44px 下"有体积"只能靠这两列。 */
function body(pb: PixBuf, pal: BuildingPalette, x0: number, x1: number, y0: number, y1: number): void {
  pb.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, pal.wall);
  pb.vline(x0, y0, y1, pal.wallLite);
  pb.vline(x1, y0, y1, pal.wallDark);
}

/** 双坡屋顶：右半边压暗（方向性明暗比描边更能读出"这是个斜面"）。 */
function gable(pb: PixBuf, pal: BuildingPalette, cx: number, apexY: number, eaveY: number, halfW: number): void {
  pb.tri([cx, apexY], [cx - halfW, eaveY], [cx + halfW, eaveY], pal.roof);
  pb.tri([cx, apexY], [cx, eaveY], [cx + halfW, eaveY], pal.roofDark);
  pb.hline(cx - halfW, cx + halfW, eaveY, pal.roofDark);
}

/** 门：上沿收一格当"拱"，门框走深色 —— 44px 下这已是能读出的最圆的拱。 */
function doorway(pb: PixBuf, pal: BuildingPalette, cx: number, w: number, top: number, bottom = G): void {
  const x = cx - (w >> 1);
  pb.rect(x, top, w, bottom - top + 1, pal.wood);
  pb.rect(x + 1, top - 1, w - 2, 1, pal.wood);
  pb.frame(x, top, w, bottom - top + 1, pal.woodDark);
}

/** 窗：3×4 的深框里留一条 1×2 的光。再小就只剩一个黑点。 */
function win(pb: PixBuf, pal: BuildingPalette, x: number, y: number, w = 3, h = 4): void {
  pb.rect(x, y, w, h, pal.woodDark);
  pb.rect(x + 1, y + 1, w - 2, h - 2, pal.glow);
}

/** 立柱：5px 宽是 44px 下的下限（3px 会被两侧描边吃掉一半）。 */
function column(pb: PixBuf, pal: BuildingPalette, x: number, y0: number, y1: number, w = 5): void {
  pb.rect(x, y0, w, y1 - y0 + 1, pal.wall);
  pb.vline(x, y0, y1, pal.wallLite);
  pb.vline(x + w - 1, y0, y1, pal.wallDark);
}

/* ---------------------------------------------------------------- 13 座 */

/** 酒馆：宽坡屋顶 + 烟囱 + **左侧挑出的招牌**（识别点在墙外，不与墙同色相邻）。 */
const tavern: Draw = (pb, pal) => {
  body(pb, pal, 8, 35, 25, G);
  gable(pb, pal, 21, 13, 24, 16);
  // 烟囱：屋顶右段之上，四行宽；顶口留一条亮边
  pb.rect(27, 6, 4, 13, pal.wall);
  pb.vline(27, 6, 18, pal.wallLite);
  pb.vline(30, 6, 18, pal.wallDark);
  pb.hline(26, 31, 6, pal.wallDark);
  doorway(pb, pal, 21, 7, 32);
  win(pb, pal, 12, 28);
  win(pb, pal, 30, 28);
  if (breaks.plain) return;
  // 招牌：横臂从墙上挑出 6px，木牌挂在臂下 —— 招牌是这座建筑的"脸"
  pb.hline(3, 9, 28, pal.woodDark);
  pb.rect(1, 30, 7, 7, pal.wood);
  pb.hline(1, 7, 30, pal.wallLite);
  pb.frame(1, 30, 7, 7, pal.woodDark);
  pb.hline(3, 5, 33, pal.glow);
};

/** 市场：**条纹遮阳篷** + 两根立柱 + 柜台；篷与柜台之间整段透空（"露天摊位"）。 */
const market: Draw = (pb, pal) => {
  // 立柱先立，篷盖后压（顺序反了篷角会被柱顶吃掉）
  pb.rect(4, 26, 3, G - 26 + 1, pal.wood);
  pb.rect(37, 26, 3, G - 26 + 1, pal.wood);
  pb.vline(4, 26, G, pal.woodDark);
  pb.vline(39, 26, G, pal.woodDark);
  // 梯形篷：上沿 x8..35，下沿 x3..40，竖向条纹（族色 / 米白）
  for (let y = 18; y <= 25; y++) {
    const t = (y - 18) / 7;
    const x0 = Math.round(8 - 5 * t);
    const x1 = Math.round(35 + 5 * t);
    for (let x = x0; x <= x1; x++) {
      pb.set(x, y, Math.floor((x - x0) / 4) % 2 === 0 ? pal.roof : pal.wallLite);
    }
    pb.set(x0, y, pal.roofDark);
    pb.set(x1, y, pal.roofDark);
  }
  pb.hline(3, 40, 25, pal.roofDark);
  // 柜台：顶面亮、正面木；商品三块压在台面上
  pb.rect(6, 34, 32, 5, pal.wood);
  pb.hline(6, 37, 34, pal.wallLite);
  pb.hline(6, 37, 38, pal.woodDark);
  if (breaks.plain) return;
  pb.rect(10, 31, 3, 3, pal.roof);
  pb.rect(16, 31, 3, 3, pal.glow);
  pb.rect(22, 31, 3, 3, pal.wallLite);
  pb.rect(28, 31, 3, 3, pal.woodDark);
};

/** 议事堂：对称侧翼 + 中央塔 + **屋顶以上的旗**（全表唯一在高处只有 1px 竖线的东西）。 */
const townhall: Draw = (pb, pal) => {
  body(pb, pal, 4, 39, 28, G);
  pb.hline(4, 39, 28, pal.wallDark);
  pb.hline(4, 39, 29, pal.wallLite);
  body(pb, pal, 16, 26, 14, G);
  gable(pb, pal, 21, 6, 13, 7);
  doorway(pb, pal, 21, 7, 33);
  win(pb, pal, 8, 31);
  win(pb, pal, 33, 31);
  win(pb, pal, 20, 19);
  if (breaks.plain) return;
  // 旗：1px 杆 + 8×5 布。杆细到只剩墨环也够 —— 它在屋顶以上，背景全透空
  pb.vline(21, 1, 6, pal.woodDark);
  pb.rect(22, 2, 8, 5, pal.roof);
  pb.hline(22, 29, 6, pal.roofDark);
  pb.vline(29, 2, 5, pal.roofDark);
};

/** 工坊：**单坡屋顶**（左高右低）+ 右侧齿轮。
 *
 * 屋顶必须是单坡：双坡三角 + 右侧方形物件 = 射箭场的构图，两者 IoU 会到 0.77，
 * 玩家在 44px 下只能靠"那是靶还是齿轮"去分辨。单坡屋顶的剪影是一条斜边，
 * 全表只有这一座。 */
const workshop: Draw = (pb, pal) => {
  body(pb, pal, 4, 26, 24, G);
  pb.tri([3, 16], [28, 25], [3, 25], pal.roof);
  pb.tri([3, 21], [28, 25], [3, 25], pal.roofDark);
  pb.hline(3, 28, 25, pal.roofDark);
  pb.rect(7, 8, 4, 13, pal.wall);
  pb.vline(7, 8, 17, pal.wallLite);
  pb.hline(6, 11, 8, pal.wallDark);
  doorway(pb, pal, 12, 6, 32);
  win(pb, pal, 21, 28);
  if (breaks.plain) return;
  /* 轮：**实心轮盘 + 八枚短齿 + 深色轴心**。
     四枚长齿在 ×4 实拍里读成"四角星"（盘小、齿长 ⇒ 轮廓全是尖角）；
     八枚 3×3 的短齿才让外沿变成"一圈凸起"，那是齿轮唯一的识别特征。 */
  const cx = 34;
  const cy = 33;
  // 轴：从墙里伸出一根梁把轮子接上（悬空的轮子读成"旁边放了个齿轮道具"）
  pb.hline(25, 30, cy, pal.woodDark);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    pb.rect(Math.round(cx + 6 * Math.cos(a)) - 1, Math.round(cy + 6 * Math.sin(a)) - 1, 3, 3, pal.wood);
  }
  pb.ellipse(cx, cy, 5, 5, pal.wood);
  pb.ellipse(cx, cy, 2, 2, pal.woodDark);
  pb.set(cx, cy, pal.glow);
};

/** 木栅：八根**尖桩**，高低交错；整体比石墙矮一档（栅栏是挡马匹的，不是挡攻城锤的）。 */
const wall1: Draw = (pb, pal) => {
  for (let k = 0; k < 8; k++) {
    const x = 2 + k * 5;
    const top = 23 + (k % 3) * 2;
    pb.rect(x, top + 2, 4, G - top - 1, pal.wood);
    pb.vline(x, top + 2, G, pal.woodDark);
    pb.vline(x + 3, top + 2, G, pal.wallLite);
    // 尖头：先 2px 再 4px，两级台阶
    pb.hline(x + 1, x + 2, top, pal.wood);
    pb.hline(x, x + 3, top + 1, pal.wood);
  }
  // 两道横梁：把八根桩绑成一排
  pb.rect(2, 30, 39, 2, pal.woodDark);
  pb.rect(2, 36, 39, 2, pal.woodDark);
};

/** 石墙：高而厚 + **五个方城齿**（与木栅的"矮而尖"正好相反）。 */
const wall2: Draw = (pb, pal) => {
  body(pb, pal, 2, 39, 27, G);
  // 石缝：三条错开的横缝，只写 1px，够读出"砌"而不是"一块板"
  pb.hline(3, 20, 32, pal.wallDark);
  pb.hline(22, 40, 32, pal.wallDark);
  pb.hline(6, 30, 36, pal.wallDark);
  if (breaks.plain) return;
  for (let k = 0; k < 5; k++) {
    const x = 2 + k * 8;
    body(pb, pal, x, x + 5, 16, 26);
    pb.hline(x, x + 5, 16, pal.wallLite);
  }
};

/** 堡垒：**两座塔**夹一段城墙 + 中央门洞；塔顶各有三枚城齿。 */
const wall3: Draw = (pb, pal) => {
  body(pb, pal, 11, 32, 26, G);
  body(pb, pal, 1, 11, 12, G);
  body(pb, pal, 32, 42, 12, G);
  if (!breaks.plain) {
    for (const tx of [1, 32]) {
      for (let k = 0; k < 3; k++) {
        const x = tx + k * 4;
        pb.rect(x, 9, 3, 4, pal.wall);
        pb.hline(x, x + 2, 9, pal.wallLite);
      }
    }
  }
  // 门洞：木闸 + 竖栅（栅条才是"城门"，纯色方块读成洞）
  pb.rect(17, 31, 9, G - 31 + 1, pal.woodDark);
  pb.rect(18, 30, 7, 1, pal.woodDark);
  for (let x = 18; x <= 24; x += 2) pb.vline(x, 31, G, pal.wood);
  // 塔窗
  win(pb, pal, 5, 17, 3, 4);
  win(pb, pal, 35, 17, 3, 4);
};

/**
 * 农舍：最低最小的一栋 + **四坡茅草顶** + 左侧篱笆。
 *
 * 屋顶必须换个母题：双坡三角已经是酒馆（宽檐）、射箭场（棚）、工坊、议事堂、圣殿的
 * 共同轮廓，再加一座"小一号的三角顶"在 44px 下就是同一张图缩小（S5 的兵牌批踩过一次：
 * 体块变化 1.6% 时人眼不认）。四坡顶 = 上脊 5px + 四条斜边，剪影上没有尖角。
 */
const dwell1: Draw = (pb, pal, tier = 1) => {
  body(pb, pal, 12, 31, 27, G);
  // 四坡顶：脊线 y18（x19..23），檐口 y26（x9..33）
  const hip = (y: number): [number, number] => {
    const t = (y - 18) / 8;
    return [Math.round(19 - 10 * t), Math.round(23 + 10 * t)];
  };
  pb.poly([[19, 18], [23, 18], [33, 26], [9, 26]], pal.roof);
  pb.poly([[21, 18], [23, 18], [33, 26], [21, 26]], pal.roofDark);
  pb.hline(19, 23, 18, pal.roofDark);
  pb.hline(9, 33, 26, pal.roofDark);
  // 茅草：三道 1px 深色横纹（瓦顶是光面，草顶有层）
  for (let y = 21; y <= 25; y += 2) {
    const [x0, x1] = hip(y);
    pb.hline(x0 + 1, x1 - 1, y, pal.roofDark);
  }
  doorway(pb, pal, 21, 6, 33);
  win(pb, pal, 14, 29);
  if (!breaks.plain) {
    pb.vline(4, 34, G, pal.wood);
    pb.vline(7, 34, G, pal.wood);
    pb.vline(10, 34, G, pal.wood);
    pb.hline(4, 10, 36, pal.woodDark);
  }

  /* Lv.2：**加宽**——右侧接一间矮披屋 + 石砌墙基 + 屋顶烟囱。
     披屋的檐口必须**低于主屋檐口**（y33 vs y26），中间留 3 行天空 ——
     第一版把两片屋顶接在一起，×8 实拍读成"主屋的瓦片多伸了一角"，不像加了间房；
     墙角再补一根深色竖线，否则两段同色墙连成一片，44px 下没有交界。 */
  if (tier >= 2) {
    // 墙基：比墙宽一格、压暗 ⇒ 读成"石头垒的"，不是墙上刷了一条漆
    pb.rect(10, 38, 23, 3, pal.wallDark);
    pb.hline(10, 32, 38, pal.wallLite);
    // 披屋：单坡顶（左高右低），檐口压在 y33
    body(pb, pal, 31, 42, 32, 40);
    pb.tri([30, 29], [43, 33], [30, 33], pal.roof);
    pb.tri([37, 31], [43, 33], [37, 33], pal.roofDark);
    pb.hline(30, 43, 33, pal.roofDark);
    pb.vline(30, 32, 40, pal.woodDark);
    win(pb, pal, 34, 34);
    // 烟囱：站在右坡上，露头 5 行；顶口一条深色（没有它就是个方柱）
    pb.rect(24, 13, 4, 9, pal.wall);
    pb.vline(24, 13, 21, pal.wallLite);
    pb.vline(27, 13, 21, pal.wallDark);
    pb.hline(23, 28, 13, pal.woodDark);
  }

  /* Lv.3：**加高**——后部升起一座两层小楼（带自己的尖顶）。
     塔身压在屋脊上，不是"在屋顶旁边放个塔"：下沿必须与屋面重叠，
     否则 44px 下会读成"房子旁边立了根柱子"。 */
  if (tier >= 3) {
    body(pb, pal, 14, 21, 6, 20);
    gable(pb, pal, 17, 1, 6, 5);
    win(pb, pal, 16, 10);
    pb.hline(14, 21, 16, pal.wallDark);
  }
};

/** 射箭场：棚屋 + **右侧圆靶**（三层同心圆是全表唯一的圆形靶面）。 */
const dwell2: Draw = (pb, pal, tier = 1) => {
  body(pb, pal, 3, 24, 25, G);
  gable(pb, pal, 13, 16, 24, 11);
  doorway(pb, pal, 10, 6, 33);
  win(pb, pal, 19, 28);
  if (!breaks.plain) {
    /* 靶：**草垛 + 靶心**，不是"一个悬空的圆"。
       纯同心圆在 44px 下（r=7、三环各 2px）实拍读成八角星：环宽太窄、外沿的
       阶梯就是一圈尖角。草垛的方轮廓先把"这是一块靶板"讲清楚，靶心只是第二个信息。 */
    pb.vline(29, 36, G, pal.woodDark);
    pb.vline(37, 36, G, pal.woodDark);
    pb.rect(27, 26, 13, 13, pal.wallLite);
    for (let y = 28; y <= 38; y += 3) pb.hline(27, 39, y, pal.wall);
    /* 靶心：**一个实心圆 + 一个白点**。
       三环在 9px 直径上必然画成"花"：r=4/r=2 两圈椭圆的斜角阶梯互相错开，
       8× 实拍是一朵八瓣花 —— 环宽不到 2px 时，同心环这个母题就不成立了。 */
    pb.ellipse(33, 32, 4, 4, pal.roof);
    pb.set(33, 32, pal.wallLite);
  }

  /* Lv.2：**给靶位加个棚**——两根柱 + 一片双坡顶把草垛罩住。
     为什么不是"第二个靶"：宽度已经被棚（x3..24）与靶（x27..39）占满，
     再塞一个靶只能缩到 r=3，而 r=3 的靶在卡面上就是一个点（B1 的靶心返工三版才定稿）。
     为什么不是"棚顶搭个瞭望台"：第一版就是那样，×8 实拍读成"屋顶上放了张桌子" ——
     4 根 1px 的腿在 44px 上撑不起"塔"，只有**实心墙**才读得出体量。 */
  if (tier >= 2) {
    pb.vline(25, 21, 26, pal.woodDark);
    pb.vline(41, 21, 26, pal.woodDark);
    pb.tri([24, 20], [33, 15], [42, 20], pal.roof);
    pb.tri([33, 15], [33, 20], [42, 20], pal.roofDark);
    pb.hline(24, 42, 20, pal.roofDark);
  }

  /* Lv.3：**箭塔**——棚屋后半升起一座实心木塔（x4..16, y10..24）+ 尖顶 + 旗。
     塔压在棚屋的屋面与屋脊上（下沿 y24 = 檐口），不是"旁边立一根柱子"：
     44px 下只有让新体块的**下半截与老屋面重叠**，两者才会读成一个整体。 */
  if (tier >= 3) {
    body(pb, pal, 4, 16, 10, 24);
    gable(pb, pal, 10, 4, 10, 6);
    win(pb, pal, 8, 14);
    pb.vline(10, 1, 4, pal.woodDark);
    pb.tri([11, 1], [11, 6], [18, 3], pal.roof);
  }
};

/** 兵营：方块营房 + **屋顶以上的交叉长矛**（X 是全表唯一的斜线母题）。 */
const dwell3: Draw = (pb, pal, tier = 1) => {
  body(pb, pal, 6, 37, 24, G);
  pb.hline(5, 38, 24, pal.wallDark);
  pb.hline(5, 38, 23, pal.wallLite);
  doorway(pb, pal, 21, 8, 32);

  /* Lv.2：**加一层**（x7..36, y14..23）。
     必须比 Lv.1 的四枚城齿宽：二层要盖住原来的檐口与城齿，否则掩码不是包含关系
     （`[B6]` 量的就是"只加不拆" —— 城齿改到二层顶上重画，老位置被墙体接住）。 */
  if (tier >= 2) {
    body(pb, pal, 7, 36, 14, 23);
    pb.hline(7, 36, 14, pal.wallLite);
    pb.hline(7, 36, 23, pal.wallDark);
    win(pb, pal, 12, 17);
    win(pb, pal, 26, 17);
  }

  /* Lv.3：**右角楼**（x32..41, y10..40）+ 三枚城齿 + 一面旗。
     角楼是这座建筑从"营房"变成"要塞"的那一步；它压在右端，左侧的交叉长矛
     仍然是全表唯一的斜线母题 —— 升级不能把识别件挤掉。 */
  if (tier >= 3) {
    body(pb, pal, 32, 41, 10, G);
    for (let k = 0; k < 3; k++) {
      const x = 32 + k * 3;
      pb.rect(x, 7, 2, 3, pal.wall);
      pb.hline(x, x + 1, 7, pal.wallLite);
    }
    win(pb, pal, 35, 15);
    pb.vline(33, 2, 10, pal.woodDark);
    pb.tri([34, 2], [34, 9], [41, 5], pal.roof);
  }

  if (!breaks.plain) {
    // 城齿：Lv.1 在檐上（y20），Lv.2 起在二层顶上（y11）—— 位置跟着高度走
    const cy = tier >= 2 ? 11 : 20;
    const step = tier >= 2 ? 7 : 8;
    for (let k = 0; k < 4; k++) {
      const x = 8 + k * step;
      pb.rect(x, cy, 4, 4, pal.wall);
      pb.hline(x, x + 3, cy, pal.wallLite);
    }
    // 交叉长矛：矛杆**插到地面**（停在墙腰上会读成两根斜插的棍子），枪尖用三角。
    // Lv.2 起城齿抬到 y11，枪尖必须**高过城齿**（y5..10）—— 第一版枪尖留在 y8，
    // 正好落在城齿的浅色块里，×8 实拍整根矛"没有尖"。
    const topY = tier >= 2 ? 6 : 9;
    const tipY = tier >= 2 ? 5 : 8;
    // 尖角一律画到 y13：Lv.2 起的枪尖整体抬高 3 行，底边仍压在原位 ——
    // 否则 L1 那三行枪尖的像素在新档里"消失"，`[B6]` 的"只加不拆"当场红 13px。
    const tipBase = 13;
    if (tier >= 2) {
      // L1 的斜线只到 y9，抬高后落点会差 1px ⇒ 旧线也画一遍，保证"只加不拆"
      pb.line(9, G, 30, 9, pal.woodDark);
      pb.line(10, G, 31, 9, pal.woodDark);
      pb.line(31, G, 11, 9, pal.woodDark);
      pb.line(32, G, 12, 9, pal.woodDark);
    }
    pb.line(9, G, 30, topY, pal.woodDark);
    pb.line(10, G, 31, topY, pal.woodDark);
    pb.line(31, G, 11, topY, pal.woodDark);
    pb.line(32, G, 12, topY, pal.woodDark);
    pb.tri([30, tipY], [28, tipBase], [33, tipBase], pal.wallLite);
    pb.tri([11, tipY], [9, tipBase], [14, tipBase], pal.wallLite);
  }
};

/** 马厩：最宽最矮 + **敞开的大门**（全表唯一一个门洞里是黑的）+ 草料阁楼。 */
const dwell4: Draw = (pb, pal, tier = 1) => {
  body(pb, pal, 3, 40, 28, G);
  // 长而浅的屋顶：一坡压到右，避免与农舍/酒馆的尖顶撞读
  pb.tri([21, 21], [2, 28], [41, 28], pal.roof);
  pb.tri([21, 21], [21, 28], [41, 28], pal.roofDark);
  pb.hline(2, 41, 28, pal.roofDark);
  /* 大门：**敞开的门洞**（深色内里 + 拱顶 + 木框），门洞里堆草。
     为什么不是"关着的门 + 马蹄铁"：×8 实拍里 44px 的马蹄铁只有两种归宿 ——
     2px 笔画读成门上的方斑，3px 笔画读成门框；U 形的两个端头根本占不到像素。
     敞开的黑洞是全表唯一的"门里是暗的"，剪影上直接可辨。 */
  pb.rect(14, 31, 13, G - 31 + 1, pal.wood);
  pb.rect(15, 30, 11, 1, pal.wood);
  pb.frame(14, 31, 13, G - 31 + 1, pal.woodDark);
  pb.rect(16, 33, 9, 8, pal.woodDark);
  pb.rect(17, 32, 7, 1, pal.woodDark);
  // 门洞里的草：两块浅色，压在下沿 —— 草料是这座建筑的功能
  pb.rect(16, 38, 4, 3, pal.wallLite);
  pb.rect(21, 39, 4, 2, pal.wallLite);
  if (!breaks.plain) {
    // 阁楼草料口：小方口 + 溢出的草（挂在门左侧的墙上，门的正上方只有 2 行）
    pb.rect(6, 30, 7, 5, pal.woodDark);
    pb.hline(7, 11, 35, pal.wallLite);
    pb.set(7, 34, pal.wallLite);
    pb.set(11, 34, pal.wallLite);
  }

  /* Lv.2：**钟楼**——屋顶中段升起方塔（x29..36, y12..28），顶为小双坡。
     为什么不是"右侧接一间披屋"：这座建筑已经宽到 x3..40，往右接就顶到画框，
     ×8 实拍读成"墙被裁掉了"（第一版就是这么死的）。马厩只能往上长。 */
  if (tier >= 2) {
    body(pb, pal, 29, 36, 12, 28);
    gable(pb, pal, 32, 6, 12, 4);
    win(pb, pal, 31, 16);
    pb.hline(29, 36, 28, pal.roofDark);
    // 门前草堆：三层收口 + 一道草纹，压深底边（纯色方块读成"墙根的石墩"）
    pb.hline(5, 7, 36, pal.wallLite);
    pb.hline(3, 8, 37, pal.wallLite);
    pb.rect(2, 38, 8, 3, pal.wallLite);
    pb.hline(3, 7, 38, pal.wall);
    pb.hline(2, 9, 40, pal.woodDark);
    pb.vline(2, 38, 40, pal.woodDark);
  }

  /* Lv.3：**草料阁楼**——屋顶中段再起一道横向山墙（x12..26, y14..24 + 顶 y9..14）。
     这是马厩真正的升级：上面能存草了。钟楼留着 —— 两座竖向体块分居左右、
     中间抬起一道横山墙，剪影从"一字型"变成"凸"字型，28px 下也分得清。 */
  if (tier >= 3) {
    body(pb, pal, 12, 26, 14, 24);
    gable(pb, pal, 19, 9, 14, 7);
    pb.rect(17, 17, 5, 5, pal.woodDark);
    pb.hline(18, 20, 17, pal.wallLite);
  }
};

/** 圣殿：台阶 + **四根透空柱廊** + 山花（柱间整列透空是全表唯一的竖向节奏）。 */
const dwell5: Draw = (pb, pal, tier = 1) => {
  pb.rect(2, 37, 39, 4, pal.wallDark);
  pb.hline(2, 40, 37, pal.wallLite);
  for (const x of [6, 15, 24, 33]) column(pb, pal, x, 23, 36);
  pb.rect(3, 20, 38, 3, pal.wall);
  pb.hline(3, 40, 20, pal.wallLite);
  pb.hline(3, 40, 22, pal.wallDark);
  // Lv.3 把山花抬到 y3：三角形底边不动、顶点升高 ⇒ 旧的三角形被完全包住（只加不拆）
  const apexY = tier >= 3 ? 3 : 8;
  pb.tri([21, apexY], [2, 19], [40, 19], pal.roof);
  pb.tri([21, apexY], [21, 19], [40, 19], pal.roofDark);
  pb.hline(2, 40, 19, pal.roofDark);

  /* Lv.2：**加一级台基 + 山花两端的小方墩 + 檐下金饰带**。
     柱数**不加**：4 根透空柱是这座建筑的识别件（`[B4]` 量 y=30 上的 4 段），
     6 根在 44px 上需要 6×5px 柱 + 5×2px 缝 = 40px，刚好放不下；
     硬塞成 1px 缝，描边会把缝填死 —— 柱廊变实墙，识别件当场没了。
     所以升级走"台基更宽、山花更繁"，柱廊本身不动。 */
  if (tier >= 2) {
    pb.rect(1, 39, 42, 2, pal.wallDark);
    pb.hline(1, 42, 39, pal.wallLite);
    /* 两侧塔门（pylon）：从地面长到檐上，顶上一格挑出。
       第一版是"山花两端各加一个 3×3 方墩"，×8 实拍读成**两只耳朵** ——
       3px 的方块贴在斜边上，既不是柱也不是塔，只是"多了两块东西"。
       塔门必须**落地**：44px 下能读出"这是建筑的一部分"的，只有从地面连续长上来的体块。 */
    // 塔身离画框 1px：贴边会让描边画不出来，×8 读成"被裁掉的墙"
    for (const px of [1, 38]) {
      pb.rect(px, 17, 5, G - 17 + 1, pal.wall);
      pb.vline(px, 17, G, pal.wallLite);
      pb.vline(px + 4, 17, G, pal.wallDark);
      // 挑出一格的檐 + 两层收口的顶：檐比塔身宽，才不会被读成"墙加了个盖子"
      pb.rect(px - (px === 1 ? 0 : 1), 15, 7, 2, pal.roof);
      pb.hline(px - (px === 1 ? 0 : 1), px + 5, 15, pal.wallLite);
      pb.rect(px + 1, 13, 3, 2, pal.roof);
      pb.set(px + 2, 12, pal.roofDark);
      pb.hline(px, px + 4, 39, pal.wallDark);
    }
    pb.hline(6, 37, 21, pal.glow);
  }

  /* Lv.3：**阁楼层 + 更高的山花**。
     圣殿是五座里最难升级的一座：44px 的宽度已经被柱廊（x2..40）占满，
     左右加任何东西都只能贴在画框边（第一版的两座塔门 ×8 读成"门柱"）。
     剩下的空间只在屋顶：Lv.3 在檐部与山花之间塞进一层**阁楼**（带两扇窗），
     山花随之上移 —— 旧屋顶被"阁楼带 + 新山花"完全包住（只加不拆）。
     只把山花画高一点是不够的：L2/L3 的 IoU 会到 0.93，等于没升级（第一版实测）。 */
  if (tier >= 3) {
    body(pb, pal, 3, 40, 12, 19);
    pb.hline(3, 40, 12, pal.wallLite);
    pb.hline(3, 40, 19, pal.wallDark);
    win(pb, pal, 11, 13);
    win(pb, pal, 27, 13);
    pb.tri([21, 1], [2, 12], [40, 12], pal.roof);
    pb.tri([21, 1], [21, 12], [40, 12], pal.roofDark);
    pb.hline(2, 40, 12, pal.roofDark);
    /* 顶点**不放宝顶**：第一版在 (21,0) 加了一颗 glow，×24 实拍是一根
       3 格高的针（墨 / 亮点 / 屋顶），读成天线而不是装饰。38px 宽的山花
       顶点本身已经是"尖"，再顶一颗只会变成针 —— 希腊山花也没有顶尖饰。 */
  }
};;;

/** 主力营：帐篷 + **旗杆大旗**（旗在最高处、面积最大的一块纯族色）。 */
const banner: Draw = (pb, pal) => {
  pb.tri([17, 18], [3, G], [31, G], pal.roof);
  pb.tri([17, 18], [17, G], [31, G], pal.roofDark);
  pb.tri([17, 29], [12, G], [23, G], pal.woodDark);
  pb.hline(3, 31, G, pal.roofDark);
  if (breaks.plain) return;
  pb.vline(32, 4, G, pal.woodDark);
  pb.vline(33, 4, G, pal.woodDark);
  // 三角旗：矩形旗在 44px 下与"招牌"撞读，燕尾/三角才是"军旗"
  pb.tri([34, 5], [34, 13], [42, 9], pal.roof);
  pb.tri([34, 9], [34, 13], [42, 9], pal.roofDark);
  // 旗面上一道亮条：纯色块在 44px 下容易被读成"色卡"
  pb.hline(36, 38, 7, pal.wallLite);
};

const SHAPES: Record<BuildingArtId, Draw> = {
  tavern,
  market,
  townhall,
  workshop,
  wall1,
  wall2,
  wall3,
  dwell1,
  dwell2,
  dwell3,
  dwell4,
  dwell5,
  banner,
};

/**
 * 建一帧。**顺序**：先结构、后识别件、最后统一描边。
 * 描边只给外沿加墨，内部接缝靠颜色差 —— 与 S5 的塔同一套笔法。
 *
 * `tier` 只有兵营线五座认（其余建筑忽略）。**默认 1 且不带后缀**，
 * 所以 B1 的 52 帧一个像素都不会变。
 */
export function buildBuildingArt(owner: SpriteOwner, id: string, outlinePx = 1, tier = 1): PixBuf {
  const key = (BUILDING_ART_IDS as readonly string[]).includes(id) ? (id as BuildingArtId) : 'tavern';
  const pb = new PixBuf(BUILDING_ART_SIZE, BUILDING_ART_SIZE);
  const pal = breaks.onePalette ? guildPaletteOf('p1') : guildPaletteOf(owner);
  const draw = breaks.sameShape ? tavern : SHAPES[key];
  const t = breaks.tiersFlat ? 1 : Math.max(1, Math.min(MAX_BUILDING_TIER, tier | 0));
  draw(pb, pal, t);
  if (breaks.jitter && owner === 'p2') pb.set(0, 43, pal.wallDark);
  if (outlinePx > 0) pb.outline(shade(pal.wallDark, -0.55), 1);
  return pb;
}
