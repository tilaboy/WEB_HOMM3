/**
 * 城市场景美术（HOMM3 观感 · 2026-11-19 重画）。
 *
 * 与 M9 那版的区别：**不是把 44px 建筑用 2× 代理放大**，而是 16 座建筑逐个重新画
 * （`SCENE_BUILDING_SIZE = 80`，一笔就是一笔），并且底子按阵营分成四种**结构不同**
 * 的场景：p1 石堡山丘 / p2 火山营地 / p3 巨树 / p4 神殿。
 *
 * 项目惯例不变：建筑本体四族**结构逐像素相同、只换材质**（与 B1 建筑帧同一口径），
 * 差异交给底子承载 —— 这样 64 帧里只要画 16 种形状，`probe:townview` 的 S2/S3
 * 会分别钉住"结构同"与"材质不同"。
 *
 * 零位图、零随机流：同一 owner/尺寸逐像素确定。
 */
import { PixBuf, hash2, mix, shade } from './pixel.js';
import { ownerPalette, type SpriteOwner } from './atlas.js';

/** 场景建筑的固定画布。80px 在 844×390 横屏下按 1:1 落位，不靠插值。 */
export const SCENE_BUILDING_SIZE = 80;
/** 城镇面板里的全部 16 座（与 `BUILD_TABS` / `BUILDINGS` 逐项对齐）。 */
export const TOWN_BUILDING_IDS = [
  'tavern', 'market', 'townhall', 'workshop', 'wall1', 'wall2', 'wall3', 'banner',
  'dwell1', 'dwell2', 'dwell3', 'dwell4', 'dwell5', 'guild1', 'guild2', 'guild3',
] as const;

interface ScenePalette {
  wall: string; wallDark: string; wallLite: string;
  roof: string; roofDark: string;
  wood: string; woodDark: string;
  accent: string; glass: string;
  stone: string; stoneDark: string;
  outline: string;
}

function paletteOf(owner: SpriteOwner): ScenePalette {
  const { roof: faction } = ownerPalette(owner);
  const wall = owner === 'p1' ? '#d8cdb2' : owner === 'p2' ? '#b9a084' : owner === 'p3' ? '#c6d0a6' : '#bfb4c6';
  return {
    wall,
    wallDark: shade(wall, -0.22),
    wallLite: shade(wall, 0.14),
    roof: faction,
    roofDark: shade(faction, -0.28),
    wood: owner === 'p4' ? '#6a4a34' : '#8a6238',
    woodDark: '#5a3f24',
    accent: owner === 'p1' ? '#f0d268' : owner === 'p2' ? '#ff9a4a' : owner === 'p3' ? '#b6e07a' : '#d8a8ff',
    glass: owner === 'p4' ? '#e0b0ff' : '#ffe9a0',
    stone: '#9a8f78',
    stoneDark: '#5e5748',
    outline: '#241c12',
  };
}

/* ------------------------------------------------------------------ 笔法 */
/** 地面接触影：比物件宽一点、贴底，给"落在地上"的读感。 */
function groundShadow(pb: PixBuf, cx: number, bottom: number, half: number): void {
  pb.ellipse(cx, bottom, half, 3, '#2a2114', 0.4);
}
/** 矩形墙 + 竖向明暗：左亮右暗，破"一整块色"。 */
function wall(pb: PixBuf, x: number, y: number, w: number, h: number, p: ScenePalette): void {
  pb.rect(x, y, w, h, p.wall);
  pb.rect(x, y, Math.max(2, Math.round(w * 0.18)), h, p.wallLite);
  pb.rect(x + w - Math.max(2, Math.round(w * 0.18)), y, Math.max(2, Math.round(w * 0.18)), h, p.wallDark);
  pb.hline(x, x + w - 1, y + h - 1, p.wallDark);
}
/** 人字屋顶：山墙 + 两坡，宽出墙体 2px 出檐。 */
function gable(pb: PixBuf, x: number, y: number, w: number, h: number, p: ScenePalette): void {
  pb.poly([[x - 2, y + h], [x + w / 2, y], [x + w + 2, y + h]], p.roof);
  pb.poly([[x - 2, y + h], [x + w / 2, y], [x + w / 2, y + h]], p.roofDark);
  pb.vline(Math.round(x + w / 2), y, y + h, shade(p.roof, 0.2));
}
/** 平顶城垛（城墙 / 堡垒）。 */
function crenels(pb: PixBuf, x: number, y: number, w: number, p: ScenePalette, step = 8): void {
  pb.hline(x, x + w - 1, y, p.stoneDark);
  for (let i = x; i < x + w; i += step) pb.rect(i, y - 4, Math.max(3, step - 4), 4, p.stone);
}
/** 拱门：深色洞 + 两侧门柱，一眼看出"能进人"。 */
function doorway(pb: PixBuf, cx: number, bottom: number, w: number, h: number, p: ScenePalette): void {
  pb.rect(cx - w / 2, bottom - h, w, h, '#2b1d10');
  pb.poly([[cx - w / 2, bottom - h + 3], [cx, bottom - h - 2], [cx + w / 2, bottom - h + 3]], '#2b1d10');
  pb.vline(cx - Math.round(w / 2) - 1, bottom - h + 3, bottom, p.wood);
  pb.vline(cx + Math.round(w / 2), bottom - h + 3, bottom, p.wood);
}
/** 方窗：亮芯 + 深色边框，DPR=1 下也 ≥2px。 */
function windowAt(pb: PixBuf, x: number, y: number, p: ScenePalette, s = 3): void {
  pb.rect(x - 1, y - 1, s + 2, s + 2, p.woodDark);
  pb.rect(x, y, s, s, p.glass);
}
/** 尖塔（塔楼 / 行会），带一面小旗。 */
function spire(pb: PixBuf, x: number, y: number, w: number, h: number, p: ScenePalette, flag = true): void {
  pb.poly([[x - 2, y + 6], [x + w / 2, y - 10], [x + w + 2, y + 6]], p.roofDark);
  wall(pb, x, y + 6, w, h - 6, p);
  windowAt(pb, Math.round(x + w / 2 - 1), y + 12, p, 3);
  if (flag) {
    pb.vline(x + Math.round(w / 2), y - 20, y - 10, p.woodDark);
    pb.poly([[x + Math.round(w / 2) + 1, y - 20], [x + Math.round(w / 2) + 9, y - 18], [x + Math.round(w / 2) + 1, y - 15]], p.accent);
  }
}
/** 石基：所有建筑共用的落脚台，保证底边同一条线。 */
function base(pb: PixBuf, x: number, bottom: number, w: number, p: ScenePalette): void {
  pb.rect(x - 2, bottom - 4, w + 4, 4, p.stone);
  pb.hline(x - 2, x + w + 1, bottom - 4, p.stoneDark);
}

type Recipe = (pb: PixBuf, p: ScenePalette, tier: number) => void;

/**
 * 16 种建筑各自一笔一笔重画。结构不随 owner 变（p 只提供颜色），
 * 因此四族掩码逐像素相同；`tier>1` 只加高一层/多一面旗，不改轮廓骨架。
 */
const RECIPES: Record<string, Recipe> = {
  tavern: (pb, p) => {
    const x = 18, y = 40, w = 44, h = 34;
    base(pb, x, 80, w, p); wall(pb, x, y + 12, w, h - 12, p); gable(pb, x, y, w, 18, p);
    doorway(pb, x + 16, 80, 12, 16, p); windowAt(pb, x + 5, y + 22, p, 4); windowAt(pb, x + 34, y + 22, p, 4);
    pb.rect(x + w - 10, y - 12, 6, 14, p.stone); // 烟囱
    pb.rect(x + w - 10, y + 2, 14, 4, p.wood); // 悬挂招牌
    pb.poly([[x + w + 2, y + 2], [x + w + 8, y + 5], [x + w + 2, y + 8]], p.accent);
  },
  market: (pb, p) => {
    const x = 12, bottom = 80;
    base(pb, x, bottom, 56, p);
    for (let i = 0; i < 3; i++) {
      const sx = x + i * 19;
      wall(pb, sx + 2, bottom - 20, 16, 16, p);
      pb.poly([[sx, bottom - 24], [sx + 20, bottom - 24], [sx + 16, bottom - 32], [sx + 4, bottom - 32]], i % 2 ? p.accent : p.roof);
      pb.hline(sx + 4, sx + 16, bottom - 28, p.wallLite);
      pb.rect(sx + 5, bottom - 14, 10, 8, p.woodDark);
    }
    pb.rect(x + 30, bottom - 6, 8, 6, p.stoneDark); // 木箱
  },
  townhall: (pb, p) => {
    const x = 24, bottom = 80;
    base(pb, x, bottom, 34, p);
    wall(pb, x, 44, 34, 32, p); gable(pb, x, 34, 34, 12, p);
    // 中央钟楼：比主楼高，四面钟盘
    spire(pb, x + 10, 18, 16, 28, p, false);
    pb.ellipse(x + 18, 30, 4, 4, p.accent); pb.hline(x + 18, x + 18, 30, p.woodDark);
    doorway(pb, x + 17, bottom, 12, 16, p);
    windowAt(pb, x + 4, 52, p, 3); windowAt(pb, x + 27, 52, p, 3);
    pb.hline(x, x + 34, 62, p.wallLite);
  },
  workshop: (pb, p) => {
    const x = 16, bottom = 80;
    base(pb, x, bottom, 50, p); wall(pb, x, 46, 50, 30, p); gable(pb, x, 36, 50, 12, p);
    pb.rect(x + 34, 12, 12, 28, p.stoneDark); pb.hline(x + 32, x + 48, 12, p.stone); // 大烟囱
    pb.rect(x + 36, 14, 8, 6, '#3a2b1c');
    pb.ellipse(x + 18, 60, 10, 6, '#3a2b1c'); pb.ellipse(x + 18, 58, 6, 3, p.accent); // 炉火
    pb.rect(x + 4, 68, 12, 6, p.woodDark); // 铁砧台
    doorway(pb, x + 38, bottom, 10, 14, p);
  },
  wall1: (pb, p) => {
    const x = 8, bottom = 80;
    base(pb, x, bottom, 64, p);
    for (let i = x; i < x + 64; i += 8) {
      pb.poly([[i, bottom - 4], [i, bottom - 34], [i + 4, bottom - 38], [i + 8, bottom - 34], [i + 8, bottom - 4]], p.wood);
      pb.poly([[i, bottom - 34], [i + 4, bottom - 38], [i + 8, bottom - 34]], p.roof);
      pb.vline(i + 4, bottom - 34, bottom - 6, p.roofDark);
    }
    // 阵营色漆带：木栅本身四族同色，这里必须给足面积，否则四族均值色几乎相同
    pb.rect(x, bottom - 16, 64, 6, p.roof);
    pb.hline(x, x + 63, bottom - 17, p.roofDark);
    pb.rect(x + 28, bottom - 28, 16, 24, p.woodDark); // 门
    pb.hline(x + 28, x + 44, bottom - 28, p.accent);
  },
  wall2: (pb, p) => {
    const x = 8, bottom = 80;
    base(pb, x, bottom, 64, p);
    wall(pb, x, 44, 64, 32, p); crenels(pb, x, 44, 64, p);
    // 门楼比墙高
    wall(pb, x + 22, 32, 20, 44, p); crenels(pb, x + 22, 32, 20, p, 6);
    doorway(pb, x + 32, bottom, 14, 20, p);
    for (let i = 0; i < 4; i++) { windowAt(pb, x + 6 + i * 14, 56, p, 3); }
  },
  wall3: (pb, p) => {
    const x = 6, bottom = 80;
    base(pb, x, bottom, 68, p);
    wall(pb, x, 46, 68, 30, p); crenels(pb, x, 46, 68, p);
    spire(pb, x + 2, 30, 18, 46, p, false); spire(pb, x + 48, 30, 18, 46, p, false);
    wall(pb, x + 26, 34, 16, 42, p); crenels(pb, x + 26, 34, 16, p, 6);
    doorway(pb, x + 34, bottom, 14, 22, p);
    pb.poly([[x + 30, bottom - 16], [x + 38, bottom - 16], [x + 38, bottom], [x + 30, bottom]], '#2b1d10', 0.7); // 闸
  },
  banner: (pb, p) => {
    const x = 34, bottom = 80;
    base(pb, x - 12, bottom, 24, p);
    pb.rect(x - 2, bottom - 68, 4, 64, p.woodDark);
    pb.poly([[x + 2, bottom - 66], [x + 30, bottom - 58], [x + 2, bottom - 44]], p.roof);
    pb.poly([[x + 2, bottom - 66], [x + 16, bottom - 62], [x + 2, bottom - 55]], p.accent);
    pb.ellipse(x, bottom - 68, 3, 3, p.accent);
    pb.rect(x - 8, bottom - 8, 16, 4, p.stoneDark);
  },
  dwell1: (pb, p, tier) => {
    const x = 22, bottom = 80;
    base(pb, x, bottom, 36, p); wall(pb, x, 52, 36, 24, p);
    gable(pb, x, 32 + (tier > 1 ? -4 : 0), 36, 20, p);
    doorway(pb, x + 13, bottom, 10, 14, p); windowAt(pb, x + 5, 58, p, 3);
    pb.rect(x - 4, bottom - 8, 44, 2, p.woodDark); // 篱笆
    for (let i = x - 4; i < x + 40; i += 8) pb.vline(i, bottom - 14, bottom - 6, p.wood);
    if (tier > 1) pb.poly([[x + 36, 28], [x + 46, 32], [x + 36, 36]], p.accent);
  },
  dwell2: (pb, p, tier) => {
    const x = 18, bottom = 80;
    base(pb, x, bottom, 44, p); wall(pb, x, 48, 44, 28, p); gable(pb, x, 32, 44, 16, p);
    // 老虎窗
    pb.rect(x + 16, 40, 12, 8, p.wallLite); pb.poly([[x + 14, 40], [x + 22, 34], [x + 30, 40]], p.roofDark);
    doorway(pb, x + 17, bottom, 10, 14, p); windowAt(pb, x + 4, 56, p, 3); windowAt(pb, x + 34, 56, p, 3);
    pb.rect(x + 36, 24, 6, 16, p.stone);
    if (tier > 1) pb.rect(x + 8, 26, 6, 12, p.stone);
  },
  dwell3: (pb, p, tier) => {
    const x = 14, bottom = 80;
    base(pb, x, bottom, 52, p); wall(pb, x, 46, 52, 30, p);
    // 双山墙
    gable(pb, x, 30, 24, 16, p); gable(pb, x + 28, 30, 24, 16, p);
    doorway(pb, x + 22, bottom, 12, 16, p);
    for (let i = 0; i < 3; i++) windowAt(pb, x + 5 + i * 16, 56, p, 3);
    if (tier > 1) spire(pb, x + 20, 12, 12, 20, p);
  },
  dwell4: (pb, p, tier) => {
    const x = 12, bottom = 80;
    base(pb, x, bottom, 56, p); wall(pb, x + 2, 44, 52, 32, p);
    // 柱廊 + 阳台
    pb.rect(x, 40, 56, 5, p.stone);
    for (let i = 0; i < 5; i++) pb.rect(x + 3 + i * 11, 45, 4, 26, p.wallLite);
    pb.hline(x + 2, x + 54, 66, p.stoneDark);
    pb.poly([[x, 40], [x + 28, 26], [x + 56, 40]], p.roofDark);
    doorway(pb, x + 25, bottom, 10, 14, p);
    if (tier > 1) { pb.ellipse(x + 28, 24, 5, 5, p.accent); pb.vline(x + 28, 18, 24, p.woodDark); }
  },
  dwell5: (pb, p, tier) => {
    const x = 10, bottom = 80;
    base(pb, x, bottom, 60, p);
    wall(pb, x, 46, 60, 30, p); gable(pb, x, 32, 60, 14, p);
    // 两翼 + 中央高塔
    wall(pb, x - 4, 54, 12, 22, p); wall(pb, x + 60, 54, 12, 22, p);
    spire(pb, x + 22, 16, 16, 34, p, tier > 1);
    doorway(pb, x + 28, bottom, 14, 18, p); windowAt(pb, x + 8, 58, p, 4); windowAt(pb, x + 48, 58, p, 4);
  },
  guild1: (pb, p, tier) => {
    const x = 28, bottom = 80;
    base(pb, x, bottom, 26, p);
    spire(pb, x, 30, 26, 44, p, false);
    pb.ellipse(x + 13, 24, 6, 6, p.accent); pb.ellipse(x + 13, 24, 3, 3, p.glass);
    doorway(pb, x + 13, bottom, 10, 14, p);
    if (tier > 1) pb.vline(x + 13, 12, 18, p.accent);
  },
  guild2: (pb, p, tier) => {
    const x = 22, bottom = 80;
    base(pb, x, bottom, 38, p);
    spire(pb, x + 10, 16, 18, 60, p, tier > 2);
    spire(pb, x - 2, 44, 12, 30, p, false); spire(pb, x + 30, 44, 12, 30, p, false);
    pb.ellipse(x + 19, 30, 5, 5, p.accent);
    doorway(pb, x + 19, bottom, 10, 14, p);
  },
  guild3: (pb, p, tier) => {
    const x = 18, bottom = 80;
    base(pb, x, bottom, 46, p);
    spire(pb, x + 15, 14, 16, 62, p, tier > 2);
    spire(pb, x, 42, 14, 34, p, false); spire(pb, x + 34, 42, 14, 34, p, false);
    // 悬浮水晶：与其他塔的旗区分
    pb.poly([[x + 23, 20], [x + 28, 28], [x + 23, 36], [x + 18, 28]], p.glass);
    pb.poly([[x + 23, 20], [x + 23, 36], [x + 18, 28]], p.accent);
    doorway(pb, x + 23, bottom, 12, 16, p);
  },
};

/** 闸门负向对照：`sameShape` 让 16 座塌成一张，`sameBase` 让四族底子塌成一张。 */
let sceneArtBreaks = { sameShape: false, sameBase: false };
export function setSceneArtBreaks(v: Partial<typeof sceneArtBreaks>): void {
  sceneArtBreaks = { ...sceneArtBreaks, ...v };
}

/** 80×80 的场景建筑；tier 只影响附加装饰，不改骨架。 */
export function buildSceneBuilding(owner: SpriteOwner, id: string, tier = 1): PixBuf {
  const pb = new PixBuf(SCENE_BUILDING_SIZE, SCENE_BUILDING_SIZE);
  const p = paletteOf(owner);
  const recipe = RECIPES[sceneArtBreaks.sameShape ? 'tavern' : id] ?? RECIPES.tavern!;
  groundShadow(pb, SCENE_BUILDING_SIZE / 2, 78, 28);
  const t = Math.max(1, Math.min(3, tier | 0));
  recipe(pb, p, t);
  /* 升级档必须改变**剪影**，不能只是往同一张里加内部像素（那是"冻帧稳定但帧里没东西"）。
     台基逐级加宽 2px：L1 不加、L2 到 x=2..77、L3 到 x=0..79。
     四族共用同一段几何 ⇒ 跨族掩码仍然逐像素相同。 */
  if (t >= 2) {
    pb.rect(2, 76, 76, 3, p.stone);
    pb.hline(2, 77, 76, p.stoneDark);
  }
  if (t >= 3) {
    pb.rect(0, 73, 80, 3, p.stone);
    pb.hline(0, 79, 73, p.stoneDark);
  }
  pb.outline(p.outline);
  return pb;
}

export function sceneBuildingFrameName(owner: SpriteOwner, id: string, tier = 1): string {
  const t = Math.max(1, Math.min(3, tier | 0));
  return `scene_${owner}_${id}${t > 1 ? `_u${t}` : ''}`;
}

/* ------------------------------------------------------------------ 地块 */
/** 地块坐标用舞台百分比；`y` 越大越靠前（画家算法按它排序）。 */
export interface TownPlot { id: string; x: number; y: number; }
export const TOWN_PLOTS: readonly TownPlot[] = [
  { id: 'wall1', x: 0.10, y: 0.44 }, { id: 'wall2', x: 0.25, y: 0.40 }, { id: 'wall3', x: 0.40, y: 0.37 },
  { id: 'townhall', x: 0.60, y: 0.37 }, { id: 'guild3', x: 0.75, y: 0.40 }, { id: 'guild2', x: 0.90, y: 0.44 },
  { id: 'dwell1', x: 0.08, y: 0.64 }, { id: 'dwell2', x: 0.18, y: 0.61 },
  { id: 'dwell3', x: 0.31, y: 0.59 }, { id: 'dwell4', x: 0.45, y: 0.57 },
  { id: 'dwell5', x: 0.59, y: 0.59 }, { id: 'tavern', x: 0.72, y: 0.61 },
  { id: 'market', x: 0.87, y: 0.64 },
  { id: 'workshop', x: 0.22, y: 0.87 }, { id: 'banner', x: 0.50, y: 0.84 }, { id: 'guild1', x: 0.78, y: 0.87 },
];
export const CASTLE_PLOT: TownPlot = { id: '__castle', x: 0.50, y: 0.30 };

/* ------------------------------------------------------------------ 底子 */
/** 四族**结构不同**的空城底子（不是换配色）：石堡山丘 / 火山营地 / 巨树 / 神殿。 */
export function buildTownBase(owner: SpriteOwner, w: number, h: number): PixBuf {
  const pb = new PixBuf(Math.max(320, w | 0), Math.max(180, h | 0));
  const W = pb.w, H = pb.h;
  const p = paletteOf(owner);
  if (owner === 'p1' || sceneArtBreaks.sameBase) baseHill(pb, W, H, p);
  else if (owner === 'p2') baseCamp(pb, W, H, p);
  else if (owner === 'p3') baseTree(pb, W, H, p);
  else baseTemple(pb, W, H, p);
  return pb;
}

function skyBands(pb: PixBuf, W: number, H: number, top: string, low: string): void {
  for (let y = 0; y < H; y++) {
    const t = y / H;
    pb.hline(0, W - 1, y, t < 0.3 ? top : t < 0.55 ? mix(top, low, 0.5) : low);
  }
}
function grassGrain(pb: PixBuf, W: number, H: number, y0: number, seed: number): void {
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(hash2(i, 7, seed) * W);
    const y = Math.floor(y0 + hash2(i, 9, seed) * (H - y0 - 4));
    if (x < W - 3) pb.hline(x, x + 2, y, '#e8e0b8', 0.18);
  }
}

/** p1：石堡山丘 —— 三层岩台 + 松林 + 石阶，最"骑士"的一张。 */
function baseHill(pb: PixBuf, W: number, H: number, p: ScenePalette): void {
  skyBands(pb, W, H, '#2b4266', '#d9bd86');
  pb.ellipse(Math.round(W * 0.82), Math.round(H * 0.18), Math.round(W * 0.035), Math.round(W * 0.035), '#f4e6ae', 0.9);
  for (let layer = 0; layer < 3; layer++) {
    const base = Math.round(H * (0.34 + layer * 0.05));
    const pts: [number, number][] = [[0, H]];
    for (let x = 0; x <= W; x += Math.max(22, W >> 5)) pts.push([x, base - Math.round(hash2(x, layer, 71) * H * 0.08)]);
    pts.push([W, H]); pb.poly(pts, ['#7d8790', '#69766c', '#556450'][layer]);
  }
  pb.poly([[0, Math.round(H * 0.48)], [W * 0.18, Math.round(H * 0.42)], [W * 0.82, Math.round(H * 0.42)], [W, Math.round(H * 0.48)], [W, H], [0, H]], '#546f30');
  pb.poly([[0, Math.round(H * 0.74)], [W, Math.round(H * 0.70)], [W, H], [0, H]], '#3e5626');
  grassGrain(pb, W, H, Math.round(H * 0.5), 411);
  for (let side = 0; side < 2; side++) for (let i = 0; i < 13; i++) {
    const x = Math.round((side ? 0.78 + hash2(i, side, 11) * 0.2 : hash2(i, side, 11) * 0.22) * W);
    const y = Math.round(H * (0.55 + hash2(i, side, 13) * 0.3));
    const hh = Math.round(H * (0.05 + hash2(i, side, 17) * 0.05));
    pb.poly([[x, y - hh], [x - hh * 0.4, y], [x + hh * 0.4, y]], '#2f4f28');
  }
  for (let i = 0; i < 6; i++) {
    const y = Math.round(H * (0.5 + i * 0.022));
    pb.hline(Math.round(W * (0.44 - i * 0.012)), Math.round(W * (0.56 + i * 0.012)), y, p.stone);
  }
}

/** p2：火山营地 —— 黑岩、熔岩缝、兽骨图腾、火堆。 */
function baseCamp(pb: PixBuf, W: number, H: number, p: ScenePalette): void {
  skyBands(pb, W, H, '#3a1d18', '#9d4b2a');
  for (let i = 0; i < 5; i++) {
    const x = Math.round(hash2(i, 3, 61) * W);
    const hh = Math.round(H * (0.12 + hash2(i, 5, 61) * 0.16));
    pb.poly([[x - hh, H * 0.5], [x, H * 0.5 - hh], [x + hh, H * 0.5]], '#4a2a20');
  }
  pb.poly([[0, H * 0.5], [W * 0.2, H * 0.44], [W * 0.8, H * 0.46], [W, H * 0.5], [W, H], [0, H]], '#4a3226');
  pb.poly([[0, H * 0.76], [W, H * 0.72], [W, H], [0, H]], '#35231a');
  // 熔岩缝：折线 + 亮芯
  let lx = Math.round(W * 0.08);
  for (let y = Math.round(H * 0.56); y < H; y += Math.max(6, H >> 5)) {
    const nx = lx + Math.round((hash2(y, 2, 91) - 0.5) * W * 0.08);
    pb.line(lx, y, nx, y + Math.max(6, H >> 5), '#c4471e', 0.9);
    pb.hline(lx - 1, lx + 1, y, '#ffb347', 0.9);
    lx = nx;
  }
  for (let i = 0; i < 7; i++) {
    const x = Math.round(hash2(i, 8, 31) * W), y = Math.round(H * (0.6 + hash2(i, 9, 31) * 0.3));
    pb.vline(x, y - 14, y, '#d8cbb0'); pb.vline(x - 5, y - 12, y - 8, '#d8cbb0'); pb.vline(x + 5, y - 12, y - 8, '#d8cbb0');
  }
  for (const fx of [0.16, 0.84]) {
    const x = Math.round(W * fx), y = Math.round(H * 0.82);
    pb.ellipse(x, y, 12, 6, '#241610'); pb.poly([[x, y - 22], [x - 8, y - 4], [x + 8, y - 4]], '#ff8b2a');
    pb.poly([[x, y - 14], [x - 4, y - 4], [x + 4, y - 4]], p.accent);
  }
}

/** p3：巨树 —— 一整棵树冠当背景，树根与蘑菇落在台地上。 */
function baseTree(pb: PixBuf, W: number, H: number, _p: ScenePalette): void {
  skyBands(pb, W, H, '#1f3a2e', '#b9d49a');
  pb.poly([[0, H * 0.5], [W * 0.3, H * 0.4], [W * 0.7, H * 0.42], [W, H * 0.52], [W, H], [0, H]], '#4c7038');
  pb.poly([[0, H * 0.78], [W, H * 0.74], [W, H], [0, H]], '#38582a');
  // 树干：从画面底部贯到 H*0.16，两侧树冠叠团
  const cx = Math.round(W * 0.5);
  pb.rect(cx - Math.round(W * 0.045), Math.round(H * 0.2), Math.round(W * 0.09), Math.round(H * 0.8), '#6b4a2c');
  pb.vline(cx - Math.round(W * 0.03), Math.round(H * 0.22), H, '#8a6238');
  for (let i = 0; i < 7; i++) {
    const ox = Math.round((hash2(i, 4, 23) - 0.5) * W * 0.56);
    const oy = Math.round(H * (0.1 + hash2(i, 6, 23) * 0.22));
    pb.ellipse(cx + ox, oy, Math.round(W * (0.09 + hash2(i, 8, 23) * 0.05)), Math.round(H * 0.1), i % 2 ? '#2f6b34' : '#3d7d3c');
  }
  for (let i = 0; i < 10; i++) {
    const x = Math.round(hash2(i, 2, 77) * W), y = Math.round(H * (0.7 + hash2(i, 3, 77) * 0.25));
    pb.rect(x, y - 3, 2, 4, '#e8dcc0'); pb.ellipse(x + 1, y - 3, 4, 2, i % 2 ? '#d8564a' : '#e0c978');
  }
  grassGrain(pb, W, H, Math.round(H * 0.55), 913);
}

/** p4：神殿 —— 紫色晶柱、断柱、祭坛台阶，暗色石台。 */
function baseTemple(pb: PixBuf, W: number, H: number, p: ScenePalette): void {
  skyBands(pb, W, H, '#241a33', '#6d4a74');
  pb.ellipse(Math.round(W * 0.22), Math.round(H * 0.16), Math.round(W * 0.025), Math.round(W * 0.025), '#e2c8f4', 0.8);
  pb.poly([[0, H * 0.46], [W * 0.25, H * 0.4], [W * 0.75, H * 0.42], [W, H * 0.48], [W, H], [0, H]], '#4a4050');
  pb.poly([[0, H * 0.74], [W, H * 0.7], [W, H], [0, H]], '#332b3b');
  // 断柱：成排但不齐，最像"神殿遗迹"
  for (let i = 0; i < 9; i++) {
    const x = Math.round((0.06 + i * 0.108) * W);
    const hh = Math.round(H * (0.1 + hash2(i, 2, 57) * 0.12));
    pb.rect(x, Math.round(H * 0.58 - hh), 7, hh, '#8a7f96');
    pb.hline(x - 2, x + 8, Math.round(H * 0.58 - hh), '#b3a7bd');
    pb.hline(x - 2, x + 8, Math.round(H * 0.58 - hh + 3), '#b3a7bd');
  }
  for (let i = 0; i < 6; i++) {
    const y = Math.round(H * (0.5 + i * 0.025));
    pb.hline(Math.round(W * (0.42 - i * 0.02)), Math.round(W * (0.58 + i * 0.02)), y, '#6f647a');
  }
  for (const fx of [0.1, 0.88]) {
    const x = Math.round(W * fx), y = Math.round(H * 0.62);
    pb.poly([[x, y - 34], [x + 10, y - 12], [x, y], [x - 10, y - 12]], '#b58cd8');
    pb.poly([[x, y - 34], [x, y], [x - 10, y - 12]], p.accent);
  }
}
