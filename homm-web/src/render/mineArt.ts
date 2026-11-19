/**
 * 七种矿的独立外观（M9 · 矿型辨识批）。
 *
 * 旧实现是一份 `mine()` 帐篷几何 + 右下角换一堆矿石色 —— 七帧**剪影逐像素相同**，
 * 玩家在 32×42 上只看到"一个洞口 + 一撮颜色"。本次每型各给一个能被量出来的
 * 识别件：木=锯架上的原木堆、石=阶梯崖壁与轨道、金=矿车与金锭、宝石=洞口晶簇、
 * 水晶=五根分离的尖塔、硫磺=喷气云、水银=浅池与陶罐。
 *
 * 两条硬约束：
 *  ① **剪影彼此不同**（`probe:mineart` 量两两 IoU ≤ 0.75，负向对照 sameShape 必须红）；
 *  ② 仍然共用 32×42 帧尺寸、贴地基线 y=39、同一份墨边与投影 —— 不搞"矿越大越不像矿"。
 *
 * 纯函数、不碰 DOM：`PixBuf` 只写整数像素，node 探针直接跑。
 */
import { PixBuf, shade } from './pixel.js';

export const MINE_ART_SIZE = { w: 32, h: 42 } as const;
export const MINE_KINDS = ['gold', 'wood', 'ore', 'gem', 'crystal', 'sulfur', 'mercury'] as const;
export type MineKind = (typeof MINE_KINDS)[number];

const INK = '#241c12';
const WOOD = '#8a5f34';
const WOOD_LITE = '#b98a54';
const WOOD_DARK = '#5f4022';
const STONE = '#7e7569';
const STONE_LITE = '#aaa297';
const STONE_DARK = '#514a42';
const CAVE = '#2a2118';

/** 帧名（与 atlas 注册名一致，探针用 `data-frame` 反查实际落点）。 */
export function mineArtName(kind: string): string {
  return `mine_${kind}`;
}

/**
 * 负向对照开关（**只给闸门用**，游戏里永远是默认值）。
 * `sameShape: true` = 七型退回同一个帐篷 ⇒ IoU 判据必须红。
 */
export interface MineArtBreaks {
  sameShape: boolean;
}
let breaks: MineArtBreaks = { sameShape: false };
export function setMineArtBreaks(o: Partial<MineArtBreaks>): void {
  breaks = { ...breaks, ...o };
}
export function getMineArtBreaks(): MineArtBreaks {
  return { ...breaks };
}

function ground(pb: PixBuf, rx: number): void {
  pb.ellipse(16, 39, rx, 2, '#000000', 0.22);
}

function finish(pb: PixBuf, rx: number): void {
  pb.outline(INK);
  ground(pb, rx);
}

/** 旧帐篷：只在负向对照里出现，用来证明闸门测的是"形状不同"而不是"颜色不同"。 */
function tent(pb: PixBuf, ore: string): void {
  pb.poly([[2, 38], [6, 20], [16, 12], [26, 20], [30, 38]], STONE);
  pb.poly([[16, 38], [16, 30], [26, 38]], CAVE);
  pb.poly([[9, 38], [9, 26], [14, 22], [18, 26], [18, 38]], WOOD_DARK);
  pb.ellipse(24, 35, 5, 3, ore);
  finish(pb, 13);
}

/**
 * 金：矿车 + 车斗里冒尖的金锭。识别件是**两个轮子 + 三角金堆**，
 * 与其余六型的"地面物件"完全不同。
 */
function goldMine(pb: PixBuf): void {
  pb.rect(4, 35, 25, 2, WOOD_DARK); // 枕木
  for (const x of [7, 15, 23]) pb.rect(x, 34, 3, 3, STONE_DARK);
  pb.poly([[6, 25], [26, 25], [23, 34], [9, 34]], WOOD);
  pb.hline(6, 26, 25, WOOD_LITE);
  pb.rect(8, 27, 16, 2, WOOD_DARK);
  // 金锭堆：三层错缝，顶点高出车斗
  pb.poly([[10, 25], [13, 16], [17, 25]], '#e0b62a');
  pb.poly([[15, 25], [19, 13], [23, 25]], '#f0cf46');
  pb.poly([[19, 13], [23, 25], [21, 25]], '#b98d1c');
  pb.hline(12, 17, 21, '#f7e98a');
  pb.hline(18, 21, 18, '#f7e98a');
  pb.ellipse(11, 35, 3, 3, STONE_DARK);
  pb.ellipse(11, 35, 1, 1, STONE_LITE);
  pb.ellipse(22, 35, 3, 3, STONE_DARK);
  pb.ellipse(22, 35, 1, 1, STONE_LITE);
  finish(pb, 13);
}

/**
 * 木：两棵剥皮原木竖着当锯架，三根横木搁在上面。识别件是**双高柱 + 横木**，
 * 剪影又瘦又高，和其余"贴地矿洞"分开。
 */
function woodMine(pb: PixBuf): void {
  pb.rect(4, 10, 5, 28, WOOD);
  pb.vline(4, 10, 37, WOOD_LITE);
  pb.vline(8, 10, 37, WOOD_DARK);
  pb.ellipse(6, 10, 2.5, 2, WOOD_LITE); // 锯口
  pb.rect(23, 14, 5, 24, WOOD);
  pb.vline(23, 14, 37, WOOD_LITE);
  pb.vline(27, 14, 37, WOOD_DARK);
  pb.ellipse(25, 14, 2.5, 2, WOOD_LITE);
  for (const y of [24, 30, 35]) {
    pb.rect(7, y, 19, 5, WOOD);
    pb.hline(7, 25, y, WOOD_LITE);
    pb.hline(7, 25, y + 4, WOOD_DARK);
    pb.ellipse(26, y + 2, 2, 2.5, WOOD_LITE);
    pb.ellipse(26, y + 2, 1, 1, WOOD_DARK);
  }
  finish(pb, 13);
}

/**
 * 石：分层崖壁 + 矿洞 + 出矿轨道。识别件是**左侧两级台阶**与斜轨道，
 * 上缘是阶梯状，不是金矿的尖堆也不是宝石的晶簇。
 */
function oreMine(pb: PixBuf): void {
  pb.poly([[2, 38], [2, 22], [11, 19], [11, 13], [25, 16], [30, 22], [30, 38]], STONE);
  pb.poly([[2, 22], [11, 19], [11, 13], [14, 14], [14, 38], [2, 38]], STONE_LITE);
  pb.hline(2, 11, 22, STONE_DARK);
  pb.hline(14, 30, 16, STONE_DARK);
  for (const x of [5, 18, 26]) pb.vline(x, 24, 37, STONE_DARK);
  pb.poly([[12, 38], [12, 29], [16, 25], [21, 29], [21, 38]], CAVE);
  pb.poly([[13, 38], [13, 30], [16, 27], [20, 30], [20, 38]], WOOD_DARK);
  // 斜轨道从洞口伸到右下（金属轨 + 三根枕木）
  pb.line(14, 34, 30, 38, STONE_DARK, 1);
  pb.line(14, 36, 30, 40, STONE_DARK, 1);
  for (const [x, y] of [[18, 35], [23, 37], [28, 39]] as [number, number][]) {
    pb.vline(x, y, y + 3, WOOD_DARK);
  }
  pb.ellipse(17, 33, 3, 2, '#8a857e');
  pb.ellipse(17, 32, 2, 1, '#a9a49b');
  finish(pb, 14);
}

/**
 * 宝石：矮洞口 + 三根粉紫晶簇。识别件是**从洞顶伸出的三根粗棱柱**，
 * 与水晶的"五根细高塔、没有洞"刻意分开。
 */
function gemMine(pb: PixBuf): void {
  pb.poly([[5, 38], [8, 26], [16, 22], [24, 26], [27, 38]], STONE);
  pb.poly([[5, 38], [8, 26], [16, 22], [15, 38]], STONE_LITE);
  pb.poly([[11, 38], [11, 29], [16, 25], [21, 29], [21, 38]], CAVE);
  pb.poly([[12, 38], [12, 30], [16, 27], [20, 30], [20, 38]], WOOD_DARK);
  const gems: [number, number, number][] = [[9, 9, 5], [16, 6, 6], [23, 11, 5]];
  for (const [cx, top, half] of gems) {
    pb.poly([[cx, top], [cx - half, 25], [cx + half, 25]], '#d05fa0');
    pb.poly([[cx, top], [cx, 25], [cx + half, 25]], '#963b73');
    pb.poly([[cx, top + 3], [cx - 1, 25], [cx + 1, 25]], '#f0a8d4');
  }
  finish(pb, 12);
}

/**
 * 水晶：没有洞、没有土堆 —— **五根彼此分离的细高晶柱**直接插在地上，
 * 最高的两根到 y=5。剪影是一排梳齿，和宝石的三根粗棱柱不会混。
 */
function crystalMine(pb: PixBuf): void {
  const spires: [number, number, number][] = [[4, 14, 2], [9, 6, 2], [15, 11, 3], [21, 5, 2], [27, 13, 2]];
  for (const [cx, top, half] of spires) {
    pb.poly([[cx, top], [cx - half, 38], [cx + half, 38]], '#7ec8e3');
    pb.poly([[cx, top], [cx, 38], [cx + half, 38]], '#3d86ab');
    pb.poly([[cx, top + 4], [cx - 1, 38], [cx + 1, 38]], '#d8f3ff');
  }
  finish(pb, 11);
}

/**
 * 硫磺：矮喷口 + 三层分离的黄烟团。识别件是**烟云在喷口之上、有断缝**，
 * 不靠颜色也能看出"这东西在冒气"。
 */
function sulfurMine(pb: PixBuf): void {
  pb.poly([[7, 38], [9, 29], [23, 29], [25, 38]], STONE);
  pb.ellipse(16, 30, 7, 3, '#e0d24a');
  pb.ellipse(16, 30, 4, 2, '#f5e987');
  pb.poly([[13, 29], [14, 23], [18, 23], [19, 29]], '#c9b83a');
  pb.ellipse(16, 19, 5, 4, '#e0d24a', 0.9);
  pb.ellipse(13, 18, 3, 2, '#f5e987', 0.9);
  pb.ellipse(19, 12, 5, 4, '#e0d24a', 0.85);
  pb.ellipse(15, 8, 4, 3, '#f0e27a', 0.8);
  pb.ellipse(21, 7, 3, 3, '#e0d24a', 0.75);
  finish(pb, 10);
}

/**
 * 水银：宽浅石池 + 两只高罐。识别件是**左右两只细颈罐夹一片扁平银池**，
 * 低矮、左右对称的轮廓和所有尖顶型分开。
 */
function mercuryMine(pb: PixBuf): void {
  pb.poly([[2, 33], [30, 33], [29, 39], [3, 39]], STONE);
  pb.ellipse(16, 34, 12, 3, '#b8b8c4');
  pb.ellipse(16, 33, 9, 2, '#e0e4ee');
  pb.ellipse(11, 33, 2, 1, '#ffffff', 0.9);
  // 两只罐：细颈 + 胖腹，贴地站在池子两端
  for (const [cx, top] of [[7, 20], [25, 18]] as [number, number][]) {
    pb.rect(cx - 2, top, 4, 5, '#9a6b46');
    pb.ellipse(cx, top + 10, 5, 6, '#b58258');
    pb.ellipse(cx - 1, top + 9, 3, 4, shade('#b58258', 0.25));
    pb.hline(cx - 2, cx + 2, top, '#d9ad7d');
    pb.ellipse(cx, top + 17, 4, 2, '#8a5c3c');
  }
  finish(pb, 15);
}

const DRAW: Record<MineKind, (pb: PixBuf) => void> = {
  gold: goldMine,
  wood: woodMine,
  ore: oreMine,
  gem: gemMine,
  crystal: crystalMine,
  sulfur: sulfurMine,
  mercury: mercuryMine,
};

/** 画一帧 32×42 的矿场。`kind` 未登记时回退到石矿（不抛错，免得地图渲染挂掉）。 */
export function buildMineArt(kind: string): PixBuf {
  const pb = new PixBuf(MINE_ART_SIZE.w, MINE_ART_SIZE.h);
  const k = (MINE_KINDS as readonly string[]).includes(kind) ? (kind as MineKind) : 'ore';
  if (breaks.sameShape) {
    const ore = ({ gold: '#e0b62a', wood: '#8a5f34', ore: '#8a857e', gem: '#d05fa0',
      crystal: '#7ec8e3', sulfur: '#e0d24a', mercury: '#b8b8c4' } as Record<string, string>)[k];
    tent(pb, ore);
  } else {
    DRAW[k](pb);
  }
  return pb;
}
