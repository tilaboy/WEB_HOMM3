/**
 * 城市场景美术（HOMM3 观感 · 2026-11-19 第二版重新设计）。
 *
 * 这一版针对的是实拍反馈：**上一版 16 座里 12 座都是同一个"米色方盒 + 蓝色尖顶"**，
 * 摆在一起读不出功能，也不像一座城。现在按"建筑原型"重画：
 *   - 酒馆 = 半木结构陡坡屋顶 + 烟囱 + 酒旗
 *   - 市场 = 三顶条纹棚 + 货箱（锯齿剪影）
 *   - 市政厅 = 拱廊 + 平顶钟楼（不是尖顶）
 *   - 工坊 = 锯齿厂棚 + 高烟囱 + 水车
 *   - 兵营线 = 木栅 → 圆塔石墙 → 多层要塞
 *   - 兵营住宅 = 弧顶长屋 / 不对称木屋 / 双山墙排屋 / 柱廊宅 / 方塔庄园
 *   - 行会 = 圆塔天文台 / 穹顶学院 / 水晶尖塔
 * 并且底子加入城堡远景、主干道、广场、喷泉与路灯，建筑按远景/中景/前景三档缩放落位。
 *
 * 项目惯例不变：建筑本体四族**结构逐像素相同、只换材质**；差异由底子与配色承载。
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

/** 路面颜色导出给闸门：判"真的画了街"要数这个颜色的像素，不能只数边缘。 */
export const TOWN_ROAD_COLOR = '#9a8a66';
export const TOWN_PLAZA_COLOR = '#b4a47e';

/** 负向臂：`sameShape` 全塌成尖顶小屋，`sameBase` 底子同形，`noStreet` 抽掉街道，
 *  `sameTone` 把所有建材塌回"一族一色"（用户批评的旧配色），`flatCastle` 把远景城堡
 *  塌回一块灰墙，`noShadow` 抽掉落地投影。
 *  动画两条：`noAnim` 冻结相位（所有帧必须塌成同一张），`fxBeforeOutline` 把半透明
 *  烟火/光晕挪到描边**之前**（证明"光不该被墨线圈住"这条判据真的测得到）。 */
let sceneArtBreaks = {
  sameShape: false, sameBase: false, noStreet: false, sameTone: false,
  flatCastle: false, noShadow: false, noAnim: false, fxBeforeOutline: false,
};
export function setSceneArtBreaks(v: Partial<typeof sceneArtBreaks>): void {
  sceneArtBreaks = { ...sceneArtBreaks, ...v };
}

/* ------------------------------------------------------------------ 动画相位 */
/**
 * 城景的动画是**离线逐帧**，不是 canvas 里的实时插值：
 * 每一帧都是一次完整的 `buildSceneBuilding(..., phase)`，所以闸门能在 Node 里
 * 逐帧量（帧间差、质心位移、描边像素），浏览器只负责换图。
 *
 * 8 帧 × 170ms ≈ 1.36s 一轮。为什么是 8 而不是 4：旗面的飘幅要走过 0→+2→0→−1→0
 * 才像"布"，4 帧只能来回抖；水车一轮转 45°（8 根辐条的一个对称步）也正好要 8 帧才不重样。
 */
export const SCENE_ANIM_FRAMES = 8;

/**
 * 当前相位。**只在一次同步 build 内有效** —— `flag()` 被 16 个 recipe 调用，
 * 逐层加形参只会让每个调用点多一个用不到的参数；与 `footprint` 同一处理方式。
 */
let buildPhase = 0;
/** 给闸门读"这一帧是不是动画帧"，避免探针自己维护一份帧数。 */
export function sceneAnimFrame(): number { return buildPhase; }

/** 每面旗按自己的位置取相位偏移：全城旗子一起摆会像军训，错开才像风。 */
function phasedBy(seed: number): number {
  if (sceneArtBreaks.noAnim) return 0;
  const f = SCENE_ANIM_FRAMES;
  return (((buildPhase + (seed % f)) % f) + f) % f;
}
/** 三角波 -1..+1，用来做"飘"而不是"抖"。 */
const FLAG_SWAY = [0, 1, 2, 2, 1, 0, -1, -1] as const;

/**
 * 建筑内的半透明特效（烟、光晕）。**必须画在 outline 之后**：`outline()` 把所有
 * alpha>8 的像素都算进剪影，先画烟就会被墨线圈成一个灰泡泡（同 castShadow 的坑）。
 */
type BuildFxSpot =
  | { k: 'smoke'; x: number; y: number }
  | { k: 'motes'; x: number; y: number; rx: number; ry: number; color: string }
  | { k: 'flick'; x: number; y: number; r: number; color: string };
let buildFx: BuildFxSpot[] = [];

interface ScenePalette {
  wall: string; wallDark: string; wallLite: string;
  roof: string; roofDark: string;
  wood: string; woodDark: string;
  accent: string; glass: string;
  stone: string; stoneDark: string;
  cloth: string; clothDark: string;
  metal: string;
  outline: string;
}

/**
 * 16 座各自的建材。阵营色只作 22% 的轻微偏色 + 旗/饰带/窗光，
 * 所以同一座城里能同时看到红瓦、茅草、石板、砖窑、铜绿和水晶，
 * 但四族同功能建筑仍能被认出来（探针 S2 量四族色距）。
 */
export interface BuildingMaterial { roof: string; wall: string; cloth: string; glass: string; stone: string; }
export const TOWN_BUILDING_MATERIALS: Readonly<Record<string, BuildingMaterial>> = {
  tavern:   { roof: '#a95432', wall: '#d9c39a', cloth: '#8c3f28', glass: '#ffe3a0', stone: '#a89a7e' },
  market:   { roof: '#c28a3a', wall: '#e2cba3', cloth: '#d8b05c', glass: '#f6d88a', stone: '#a89a7e' },
  townhall: { roof: '#55677f', wall: '#cfc6a8', cloth: '#3f4f66', glass: '#bcd8e0', stone: '#9a9584' },
  workshop: { roof: '#5b534a', wall: '#9d7f67', cloth: '#7a4a32', glass: '#e8c98a', stone: '#8a7a68' },
  wall1:    { roof: '#7a4f2f', wall: '#8a6238', cloth: '#6a4226', glass: '#f0d268', stone: '#9a8f78' },
  wall2:    { roof: '#8f3f35', wall: '#a9a393', cloth: '#5e5748', glass: '#e8d6a0', stone: '#9a8f78' },
  wall3:    { roof: '#6f6a5a', wall: '#bdb39d', cloth: '#8a7c62', glass: '#e8d6a0', stone: '#9a8f78' },
  banner:   { roof: '#9a6a42', wall: '#b9a084', cloth: '#5a3f24', glass: '#ffe9a0', stone: '#9a8f78' },
  dwell1:   { roof: '#b99a58', wall: '#cfd3a8', cloth: '#8a7a48', glass: '#e0e8b0', stone: '#9a8f78' },
  dwell2:   { roof: '#9c4b3c', wall: '#d8c5a2', cloth: '#7a3a2e', glass: '#ffe0a0', stone: '#9a8f78' },
  dwell3:   { roof: '#6a7f5a', wall: '#c9b79a', cloth: '#8b6b4a', glass: '#ffe9a0', stone: '#9a8f78' },
  dwell4:   { roof: '#7d7166', wall: '#e0d9c4', cloth: '#6a6258', glass: '#cfe0e8', stone: '#b3ac98' },
  dwell5:   { roof: '#4d6b55', wall: '#b7b8a8', cloth: '#3c5544', glass: '#cfe0d8', stone: '#9a8f78' },
  guild1:   { roof: '#4f9c86', wall: '#aeb9ad', cloth: '#3a7a6a', glass: '#a8e0d0', stone: '#948f80' },
  guild2:   { roof: '#6c5a9a', wall: '#c8bed0', cloth: '#8372b3', glass: '#d8c8f0', stone: '#9a8f78' },
  guild3:   { roof: '#7d5aa6', wall: '#b3a6b8', cloth: '#5a3f7a', glass: '#8fe6e0', stone: '#8a7f96' },
};

function paletteOf(owner: SpriteOwner, id?: string): ScenePalette {
  const { roof: faction } = ownerPalette(owner);
  const mat = id && !sceneArtBreaks.sameTone ? TOWN_BUILDING_MATERIALS[id] : undefined;
  const factionWall = owner === 'p1' ? '#d8cdb2' : owner === 'p2' ? '#b9a084' : owner === 'p3' ? '#c6d0a6' : '#bfb4c6';
  const roof = mat ? mix(mat.roof, faction, 0.22) : faction;
  const wall = mat ? mix(mat.wall, faction, 0.08) : factionWall;
  const stone = mat ? mix(mat.stone, faction, 0.38) : '#9a8f78';
  const woodMat = mat ? mix('#8a6238', mat.roof, 0.18) : (owner === 'p4' ? '#6a4a34' : '#8a6238');
  const wood = mat ? mix(woodMat, faction, 0.38) : woodMat;
  const clothBase = mat?.cloth ?? shade(faction, 0.22);
  return {
    wall,
    wallDark: shade(wall, -0.22),
    wallLite: shade(wall, 0.14),
    roof,
    roofDark: shade(roof, -0.28),
    wood,
    woodDark: '#5a3f24',
    accent: owner === 'p1' ? '#f0d268' : owner === 'p2' ? '#ff9a4a' : owner === 'p3' ? '#b6e07a' : '#d8a8ff',
    glass: mat ? mix(mat.glass, faction, 0.30) : (owner === 'p4' ? '#e0b0ff' : '#ffe9a0'),
    stone,
    stoneDark: shade(stone, -0.38),
    cloth: mat ? mix(clothBase, faction, 0.45) : shade(faction, 0.22),
    clothDark: shade(clothBase, -0.12),
    metal: '#7d8790',
    outline: '#241c12',
  };
}

/** 给闸门读"这座实际用的建材"，不许探针自己抄一份色表。 */
export function scenePaletteOf(owner: SpriteOwner, id: string): Pick<ScenePalette, 'roof' | 'wall' | 'cloth' | 'glass'> {
  const p = paletteOf(owner, id);
  return { roof: p.roof, wall: p.wall, cloth: p.cloth, glass: p.glass };
}

/* ------------------------------------------------------------------ 笔法 */
const B = 76; // 建筑落地基线（outline 再吃 1px，正好落在 80 画布内）

/**
 * 投影：月光在右上，影子压向左下。**必须在 outline 之后画**——描边会把 alpha>8
 * 的像素都算进剪影，先画影子会被圈上一圈墨线，看着像一块贴纸。
 * 宽度跟着 base() 记下的落地宽度走，塔楼不会拖出一条比本体还长的影子。
 */
function castShadow(pb: PixBuf): void {
  const cx = footprint.x + footprint.w / 2;
  const rx = Math.max(9, Math.round(footprint.w / 2) + 2);
  pb.ellipse(cx, 77, rx, 2, '#1c150d', 0.34);
  pb.ellipse(cx - 5, 78, Math.round(rx * 0.72), 1, '#1c150d', 0.22);
  pb.ellipse(cx - 8, 77, Math.round(rx * 0.45), 1, '#1c150d', 0.16);
}
function wall(pb: PixBuf, x: number, y: number, w: number, h: number, p: ScenePalette, color = p.wall): void {
  pb.rect(x, y, w, h, color);
  pb.rect(x, y, Math.max(2, Math.round(w * 0.16)), h, shade(color, 0.13));
  pb.rect(x + w - Math.max(2, Math.round(w * 0.16)), y, Math.max(2, Math.round(w * 0.16)), h, shade(color, -0.2));
  pb.hline(x, x + w - 1, y + h - 1, shade(color, -0.28));
}
/**
 * 落地：**只有草簇**。地面暗部与投影统一放到 outline 之后画——先画的话描边会把
 * 地面圈成一圈墨线，一块 80px 的画面里立刻读成"垫在下面的板"（旧版正是这个毛病）。
 */
let footprint = { x: 8, w: 64 };

function base(pb: PixBuf, x: number, w: number, _p: ScenePalette): void {
  footprint = { x, w };
  for (const [sx, r] of [[x - 4, 3], [x + w + 3, 3]] as [number, number][]) {
    pb.ellipse(sx, B - 2, r, 2, '#4a6a32');
    pb.ellipse(sx + 1, B - 1, r - 1, 1, '#3d5a28');
    pb.vline(sx, B - 5, B - 3, '#5f7f3c');
  }
}
/** 人字坡（酒馆/住宅用），顶在 y、檐在 y+h。 */
function gable(pb: PixBuf, x: number, y: number, w: number, h: number, p: ScenePalette, color = p.roof): void {
  pb.poly([[x - 2, y + h], [x + w / 2, y], [x + w + 2, y + h]], color);
  pb.poly([[x - 2, y + h], [x + w / 2, y], [x + w / 2, y + h]], shade(color, -0.24));
  pb.vline(Math.round(x + w / 2), y, y + h, shade(color, 0.18));
}
/** 四坡顶（市政厅/庄园）：梯形而不是三角，轮廓立刻和尖顶屋分开。 */
function hipRoof(pb: PixBuf, x: number, y: number, w: number, h: number, p: ScenePalette): void {
  pb.poly([[x - 2, y + h], [x + 5, y], [x + w - 5, y], [x + w + 2, y + h]], p.roof);
  pb.poly([[x - 2, y + h], [x + 5, y], [x + w / 2, y + h]], p.roofDark);
  pb.hline(x + 5, x + w - 5, y, shade(p.roof, 0.2));
}
/** 锯齿厂棚：工业建筑专用，绝不读成民居。 */
function sawRoof(pb: PixBuf, x: number, y: number, w: number, h: number, p: ScenePalette, teeth = 4): void {
  const step = w / teeth;
  for (let i = 0; i < teeth; i++) {
    const sx = x + i * step;
    pb.poly([[sx, y + h], [sx + step * 0.62, y], [sx + step, y + h]], i % 2 ? p.roof : p.cloth);
    pb.vline(Math.round(sx + step * 0.62), y, y + h, p.roofDark);
  }
}
/** 平顶城垛：堡垒/钟楼，和尖塔形成明确对比。 */
function flatTop(pb: PixBuf, x: number, y: number, w: number, p: ScenePalette, step = 6): void {
  pb.hline(x, x + w - 1, y, p.stoneDark);
  for (let i = x; i < x + w; i += step) pb.rect(i, y - 4, Math.max(3, step - 3), 4, p.stone);
}
/** 穹顶 / 弧顶：天文台、学院、长屋。 */
function dome(pb: PixBuf, cx: number, cy: number, rx: number, ry: number, p: ScenePalette, color = p.roof): void {
  pb.ellipse(cx, cy, rx, ry, color);
  pb.rect(cx - rx, cy, rx * 2, Math.max(3, Math.round(ry * 0.45)), color);
  pb.hline(cx - rx, cx + rx, cy, shade(color, -0.26));
  pb.ellipse(cx - Math.round(rx * 0.3), cy - Math.round(ry * 0.35), Math.max(2, Math.round(rx * 0.18)), Math.max(2, Math.round(ry * 0.18)), shade(color, 0.3), 0.8);
}
/** 圆塔（城墙角楼 / 天文台）：筒身 + 锥形或穹形顶。 */
function roundTower(pb: PixBuf, cx: number, bottom: number, r: number, h: number, p: ScenePalette, cap: 'cone' | 'dome' | 'flat'): void {
  const x = Math.round(cx - r);
  wall(pb, x, bottom - h, r * 2, h, p, p.wallLite);
  pb.vline(x + 2, bottom - h + 6, bottom - 1, p.wall);
  pb.vline(x + r * 2 - 3, bottom - h + 6, bottom - 1, p.wallDark);
  if (cap === 'cone') pb.poly([[x - 3, bottom - h + 3], [cx, bottom - h - 12], [x + r * 2 + 3, bottom - h + 3]], p.roof);
  else if (cap === 'dome') dome(pb, cx, bottom - h + 3, r + 2, 9, p);
  else flatTop(pb, x - 2, bottom - h + 2, r * 2 + 4, p, 5);
}
function doorway(pb: PixBuf, cx: number, bottom: number, w: number, h: number, p: ScenePalette): void {
  pb.rect(Math.round(cx - w / 2), bottom - h, w, h, '#2b1d10');
  pb.poly([[cx - w / 2, bottom - h + 3], [cx, bottom - h - 2], [cx + w / 2, bottom - h + 3]], '#2b1d10');
  pb.vline(Math.round(cx - w / 2) - 1, bottom - h + 3, bottom, p.wood);
  pb.vline(Math.round(cx + w / 2), bottom - h + 3, bottom, p.wood);
}
function windowAt(pb: PixBuf, x: number, y: number, p: ScenePalette, s = 3): void {
  pb.rect(x - 1, y - 1, s + 2, s + 2, p.woodDark);
  pb.rect(x, y, s, s, p.glass);
}
function archWindow(pb: PixBuf, cx: number, y: number, h: number, p: ScenePalette): void {
  pb.rect(cx - 3, y, 6, h, p.woodDark);
  pb.ellipse(cx, y, 3, 3, p.woodDark);
  pb.rect(cx - 2, y + 2, 4, h - 2, p.glass);
  pb.ellipse(cx, y + 2, 2, 2, p.glass);
}
function chimney(pb: PixBuf, x: number, y: number, w: number, h: number, p: ScenePalette, smoke = false): void {
  pb.rect(x, y, w, h, p.stoneDark);
  pb.hline(x - 2, x + w + 1, y, p.stone);
  pb.hline(x, x + w - 1, y + 3, p.stone);
  // 烟不在这里画：半透明的东西统一进特效层（见 drawBuildFx）
  if (smoke) buildFx.push({ k: 'smoke', x: x + Math.round(w / 2), y });
}
/** 旗杆是构件（每帧不动），旗面是布（逐帧摆）—— 拆开才能只让布动。 */
function flagPole(pb: PixBuf, x: number, y: number, p: ScenePalette): void {
  pb.vline(x, y, y + 16, p.woodDark);
}
/** 旗面；`x` 是旗杆列，`sway` 是飘端上下偏移（-2..+2）。城内底子的特效层复用同一段。 */
function flagClothInto(pb: PixBuf, x: number, y: number, len: number, sway: number, accent: string, cloth: string): void {
  pb.poly([[x + 1, y], [x + len, y + 3 + sway], [x + len - 2, y + 6 + sway], [x + 1, y + 7]], accent);
  pb.poly([[x + 1, y], [x + Math.round(len * 0.55), y + 2 + Math.round(sway / 2)], [x + 1, y + 4]], cloth);
}
function flag(pb: PixBuf, x: number, y: number, p: ScenePalette, len = 12): void {
  flagPole(pb, x, y, p);
  flagClothInto(pb, x, y, len, FLAG_SWAY[phasedBy(x * 3 + y * 5)]!, p.accent, p.cloth);
}
function crate(pb: PixBuf, x: number, bottom: number, s: number, p: ScenePalette): void {
  pb.rect(x, bottom - s, s, s, p.wood);
  pb.frame(x, bottom - s, s, s, p.woodDark);
  pb.line(x, bottom - s, x + s, bottom, p.woodDark);
  pb.line(x + s, bottom - s, x, bottom, p.woodDark);
}
function timberFrame(pb: PixBuf, x: number, y: number, w: number, h: number, p: ScenePalette): void {
  for (let i = x + 4; i < x + w; i += 12) pb.vline(i, y, y + h, p.woodDark);
  pb.hline(x, x + w, y + Math.round(h / 2), p.woodDark);
}
/**
 * 升级冠旗：L2 起在屋顶立一面小旗。
 *
 * **旗杆底必须落在实体像素上** —— 按列（左右各让 1px 找缝）从上往下找最高的不透明行。
 * 旧版是"给一个 y 直接画一条 24px 横杆 + 旗"，16 座里有 8 座的横杆悬在屋顶上方，
 * 远看像插在空中的招牌（×4 对照表一眼可见，闸门量不到这种错）。
 */
function tierCrown(pb: PixBuf, p: ScenePalette, tier: number, x: number): void {
  if (tier <= 1) return;
  let top = -1;
  for (let y = 2; y < B && top < 0; y++) {
    for (const dx of [0, -1, 1]) {
      if (pb.alphaAt(x + dx, y) > 8) { top = y; break; }
    }
  }
  if (top < 0) top = 40;
  flag(pb, x, Math.max(1, top - 16), p, 9);
}

type Recipe = (pb: PixBuf, p: ScenePalette, tier: number) => void;

/** 负向臂专用：把所有建筑塌回"米色方盒 + 蓝色尖顶"，证明多样性判据测得到差异。 */
function genericSpire(pb: PixBuf, p: ScenePalette): void {
  const x = 18, w = 44, y = 34;
  base(pb, x, w, p);
  wall(pb, x, y + 14, w, B - y - 14, p);
  gable(pb, x, y, w, 18, p);
  pb.poly([[x + w / 2 - 6, y], [x + w / 2, y - 18], [x + w / 2 + 6, y]], p.roofDark);
  doorway(pb, x + 16, B, 12, 16, p);
  windowAt(pb, x + 6, y + 24, p, 4);
  windowAt(pb, x + 34, y + 24, p, 4);
  chimney(pb, x + w - 10, y - 10, 6, 16, p);
  flag(pb, x + w / 2, y - 30, p, 10);
}

const RECIPES: Record<string, Recipe> = {
  /* ------------------------------ 市政建筑 ------------------------------ */
  tavern: (pb, p, tier) => {
    const x = 10, w = 52, y = 38;
    base(pb, x, w, p);
    wall(pb, x, y + 16, w, B - y - 16, p);
    timberFrame(pb, x, y + 16, w, B - y - 16, p);
    gable(pb, x - 2, y, w + 4, 18, p, p.roof);
    pb.rect(x + 22, y - 6, 12, 10, p.wallLite); // 老虎窗
    pb.poly([[x + 20, y - 6], [x + 28, y - 16], [x + 36, y - 6]], p.roofDark);
    chimney(pb, x + 5, y - 14, 8, 20, p, true);
    doorway(pb, x + 20, B, 13, 18, p);
    windowAt(pb, x + 5, y + 24, p, 4); windowAt(pb, x + 41, y + 24, p, 4);
    // 悬挂酒旗：从屋檐伸出的横杆 + 方牌，一眼是酒馆
    pb.hline(x + w - 2, x + w + 8, y + 8, p.woodDark);
    pb.vline(x + w + 7, y + 8, y + 20, p.woodDark);
    pb.rect(x + w + 2, y + 12, 12, 12, p.wood);
    pb.hline(x + w + 4, x + w + 12, y + 16, p.accent);
    pb.hline(x + w + 4, x + w + 12, y + 20, p.cloth);
    tierCrown(pb, p, tier, 38);
  },
  market: (pb, p, tier) => {
    const x = 8;
    base(pb, x, 64, p);
    for (let i = 0; i < 3; i++) {
      const sx = x + i * 20;
      const awningY = 50 - (i === 1 ? 6 : 0);
      pb.vline(sx + 2, awningY + 4, B - 4, p.woodDark);
      pb.vline(sx + 16, awningY + 4, B - 4, p.woodDark);
      // 条纹棚：斜梯形 + 交替色条，剪影是三顶参差棚而不是一个屋顶
      pb.poly([[sx - 1, awningY + 8], [sx + 4, awningY], [sx + 18, awningY], [sx + 21, awningY + 8]], i % 2 ? p.cloth : p.roof);
      for (let k = 0; k < 4; k++) pb.poly([[sx + 2 + k * 4, awningY + 1], [sx + 4 + k * 4, awningY + 1], [sx + 3 + k * 4, awningY + 7], [sx + 1 + k * 4, awningY + 7]], i % 2 ? p.accent : p.wallLite, 0.85);
      pb.rect(sx + 3, B - 14, 14, 8, p.woodDark);
      pb.hline(sx + 3, sx + 17, B - 14, p.wood);
      if (i === 0) { pb.ellipse(sx + 7, B - 16, 3, 2, p.accent); pb.ellipse(sx + 12, B - 16, 3, 2, p.glass); }
      if (i === 2) { crate(pb, sx + 8, B, 7, p); }
    }
    pb.rect(x + 30, B - 6, 8, 6, p.stoneDark);
    tierCrown(pb, p, tier, 37);
  },
  townhall: (pb, p, tier) => {
    const x = 16, w = 48, y = 48;
    base(pb, x, w, p);
    wall(pb, x, y, w, B - y, p);
    hipRoof(pb, x, y - 10, w, 12, p);
    // 三连拱廊：市政厅的公共性
    for (let i = 0; i < 3; i++) {
      const ax = x + 7 + i * 14;
      pb.rect(ax, 60, 9, 11, '#2b1d10');
      pb.ellipse(ax + 4.5, 60, 4.5, 4, '#2b1d10');
    }
    pb.hline(x + 3, x + w - 3, 59, p.stoneDark);
    // 平顶钟楼（不是尖塔）：方塔 + 城垛 + 钟面
    const tx = 30;
    wall(pb, tx, 20, 18, 40, p, p.wallLite);
    flatTop(pb, tx - 2, 20, 22, p, 5);
    pb.ellipse(tx + 9, 30, 5, 5, p.accent);
    pb.ellipse(tx + 9, 30, 3, 3, p.glass);
    pb.hline(tx + 9, tx + 9, 30, p.woodDark);
    pb.vline(tx + 9, 30, 34, p.woodDark);
    archWindow(pb, tx + 9, 40, 12, p);
    flag(pb, tx + 9, 10, p, 10);
    tierCrown(pb, p, tier, 52);
  },
  workshop: (pb, p, tier) => {
    const x = 10, w = 60, y = 52;
    base(pb, x, w, p);
    wall(pb, x, y, w, B - y, p, p.stone);
    sawRoof(pb, x - 2, y - 12, w + 4, 12, p, 4);
    chimney(pb, 54, 18, 10, 24, p, true);
    pb.ellipse(26, 66, 11, 7, '#3a2b1c');
    pb.ellipse(26, 64, 7, 4, p.accent);
    pb.vline(26, 55, 60, p.metal);
    buildFx.push({ k: 'flick', x: 26, y: 64, r: 9, color: '#ffb347' });
    // 水车：圆 + 辐条，和住宅的圆窗不是一回事。**每个相位重画整只轮子**（每次 build
    // 都是新 PixBuf，不会有残影），辐条按相位转 90°/轮 —— 8 根辐条对称周期正好 45°，
    // 所以转 90° 后形状无缝接回下一轮。
    // 一轮转 45°（= 8 根辐条的一个对称步）：8 个相位各自站位不同，第 8 帧无缝接回第 1 帧。
    // 转 90° 会让第 1 帧和第 5 帧长得一模一样（2 个对称步）—— 看上去只有 4 帧，
    // 而且 265°/s 的水车快得像风扇。
    const rot = (phasedBy(0) / SCENE_ANIM_FRAMES) * (Math.PI / 4);
    pb.ellipse(70, 62, 9, 9, p.woodDark);
    pb.ellipse(70, 62, 6, 6, p.wood);
    for (let a = 0; a < 8; a++) {
      const th = (a * Math.PI) / 4 + rot;
      pb.line(70, 62, 70 + Math.round(Math.cos(th) * 7), 62 + Math.round(Math.sin(th) * 7), p.woodDark);
    }
    pb.rect(69, 61, 2, 2, p.metal);
    doorway(pb, 42, B, 11, 15, p);
    tierCrown(pb, p, tier, 34);
  },

  /* ------------------------------ 城防 ------------------------------ */
  wall1: (pb, p, tier) => {
    const x = 8, w = 64;
    base(pb, x, w, p);
    for (let i = x; i < x + w; i += 8) {
      pb.poly([[i, B - 3], [i, B - 32], [i + 4, B - 36], [i + 8, B - 32], [i + 8, B - 3]], p.wood);
      pb.poly([[i, B - 32], [i + 4, B - 36], [i + 8, B - 32]], p.roofDark);
      pb.vline(i + 4, B - 32, B - 5, p.woodDark);
    }
    pb.rect(x, B - 17, w, 6, p.roof); // 阵营漆带
    pb.hline(x, x + w - 1, B - 18, p.roofDark);
    pb.rect(32, B - 26, 16, 23, p.woodDark);
    pb.hline(32, 47, B - 26, p.accent);
    pb.vline(32, B - 26, B - 3, p.wood); pb.vline(47, B - 26, B - 3, p.wood);
    tierCrown(pb, p, tier, 22);
  },
  wall2: (pb, p, tier) => {
    const x = 14, w = 52, y = 46;
    base(pb, x, w, p);
    wall(pb, x, y, w, B - y, p, p.stone);
    flatTop(pb, x, y, w, p);
    // 两座高圆塔 + 锥顶：和 wall1 的木栅剪影彻底分开
    roundTower(pb, 18, B, 9, 44, p, 'cone');
    roundTower(pb, 62, B, 9, 44, p, 'cone');
    doorway(pb, 40, B, 15, 22, p);
    pb.rect(35, B - 26, 10, 4, p.metal);
    pb.vline(40, B - 26, B - 2, p.metal);
    for (const wx of [31, 49]) archWindow(pb, wx, 54, 10, p);
    tierCrown(pb, p, tier, 40);
  },
  wall3: (pb, p, tier) => {
    const x = 6, w = 68, y = 44;
    base(pb, x, w, p);
    wall(pb, x, y, w, B - y, p, p.stoneDark);
    flatTop(pb, x, y, w, p, 7);
    flatTop(pb, 10, y - 8, 14, p, 5);
    flatTop(pb, 56, y - 8, 14, p, 5);
    wall(pb, 30, 20, 20, B - 20, p, p.wallLite); // 中央高堡
    flatTop(pb, 28, 20, 24, p, 6);
    // 族色带必须够宽：wall3 主体是灰石，旗太小会让四族材质色距掉到 4.2
    pb.rect(30, 27, 20, 5, p.roof);
    pb.hline(30, 49, 26, p.roofDark);
    pb.rect(34, B - 20, 12, 3, p.cloth);
    doorway(pb, 40, B, 14, 22, p);
    pb.rect(34, B - 20, 12, 14, p.metal);
    for (let i = 0; i < 4; i++) pb.vline(35 + i * 3, B - 20, B - 6, p.stoneDark);
    flag(pb, 40, 8, p, 13);
    tierCrown(pb, p, tier, 17);
  },
  banner: (pb, p, tier) => {
    base(pb, 28, 24, p);
    pb.rect(33, B - 12, 14, 12, p.stoneDark);
    pb.hline(31, 49, B - 12, p.stone);
    pb.vline(40, 6, B - 10, p.woodDark);
    pb.ellipse(40, 6, 3, 3, p.accent);
    // 大旗在右、小旗在左，剪影极不对称。两面各自按相位飘 —— 同一风速下，
    // 大旗摆幅大、小旗几乎只抖边，才不会读成"一块布在同步抽搐"。
    const swayA = FLAG_SWAY[phasedBy(11)]!;
    const swayB = FLAG_SWAY[phasedBy(23)]!;
    pb.poly([[42, 10], [76, 16 + swayA], [66, 24 + swayA], [76, 32 + swayA], [42, 30]], p.roof);
    pb.poly([[42, 10], [62, 13 + swayA], [58, 20 + swayA], [42, 20]], p.accent);
    pb.poly([[38, 18], [18, 22 + swayB], [28, 28 + swayB], [18, 34 - swayB], [38, 32]], p.clothDark);
    if (tier > 1) flag(pb, 22, 40, p, 10);
    if (tier > 2) flag(pb, 54, 42, p, 10);
  },

  /* ------------------------------ 兵营住宅 ------------------------------ */
  dwell1: (pb, p, tier) => {
    const x = 16, w = 48, y = 54;
    base(pb, x, w, p);
    wall(pb, x + 2, y, w - 4, B - y, p);
    // 弧顶长屋：椭圆 + 直墙，不是三角屋顶
    dome(pb, x + w / 2, y + 2, w / 2 + 2, 13, p, p.roof);
    pb.hline(x + 8, x + w - 8, y + 10, p.roofDark);
    doorway(pb, x + 20, B, 11, 15, p);
    windowAt(pb, x + 8, 62, p, 3); windowAt(pb, x + 36, 62, p, 3);
    // 篱笆 + 草垛
    pb.hline(x - 3, x + w + 3, B - 6, p.woodDark);
    for (let i = x - 2; i < x + w + 2; i += 8) pb.vline(i, B - 13, B - 5, p.wood);
    pb.ellipse(70, B - 5, 8, 5, '#c8a95c');
    pb.hline(62, 78, B - 5, '#9c803e');
    tierCrown(pb, p, tier, 40);
  },
  dwell2: (pb, p, tier) => {
    const x = 12;
    base(pb, x, 56, p);
    wall(pb, x + 2, 48, 52, B - 48, p);
    // 不对称：左主山墙 + 右低披屋
    gable(pb, x, 30, 34, 18, p);
    pb.poly([[x + 34, 44], [x + 56, 52], [x + 68, 52], [x + 40, 42]], p.roofDark);
    pb.vline(x + 40, 42, 52, p.roofDark);
    pb.rect(x + 8, 38, 11, 8, p.wallLite);
    pb.poly([[x + 6, 38], [x + 13, 32], [x + 20, 38]], p.roofDark);
    chimney(pb, x + 26, 22, 6, 16, p, true);
    doorway(pb, x + 18, B, 11, 15, p);
    windowAt(pb, x + 6, 58, p, 3); windowAt(pb, x + 46, 58, p, 3);
    tierCrown(pb, p, tier, 29);
  },
  dwell3: (pb, p, tier) => {
    const x = 10;
    base(pb, x, 60, p);
    wall(pb, x + 2, 50, 56, B - 50, p);
    gable(pb, x, 34, 26, 16, p);
    gable(pb, x + 32, 26, 26, 24, p, p.cloth); // 右栋更高、换色
    pb.hline(x + 4, x + 58, 64, p.stoneDark); // 二层挑檐
    for (let i = 0; i < 3; i++) windowAt(pb, x + 8 + i * 18, 56, p, 3);
    doorway(pb, x + 24, B, 11, 14, p);
    pb.vline(x + 31, 50, 66, p.woodDark); // 排屋分界
    tierCrown(pb, p, tier, 55);
  },
  dwell4: (pb, p, tier) => {
    const x = 8, w = 64, y = 52;
    base(pb, x, w, p);
    wall(pb, x + 2, y, w - 4, B - y, p);
    // 平屋顶 + 低矮三角楣 + 柱廊：完全不是尖顶塔
    pb.hline(x, x + w, y - 2, p.stone);
    for (let i = x; i <= x + w; i += 9) pb.rect(i, y - 6, 4, 4, p.stone);
    pb.poly([[x + 24, y - 6], [x + 40, y - 18], [x + 56, y - 6]], p.roofDark);
    pb.poly([[x + 28, y - 6], [x + 40, y - 14], [x + 52, y - 6]], p.wallLite);
    for (let i = 0; i < 5; i++) {
      const px = x + 8 + i * 12;
      pb.rect(px, y + 4, 4, 18, p.wallLite);
      pb.hline(px - 1, px + 5, y + 3, p.stone);
    }
    pb.hline(x, x + w, B - 3, p.stone);
    doorway(pb, x + 36, B, 10, 13, p);
    tierCrown(pb, p, tier, 40);
  },
  dwell5: (pb, p, tier) => {
    const x = 6;
    base(pb, x, 68, p);
    // 两翼低坡顶 + 中央方塔（平顶城垛，不是尖塔）
    wall(pb, x, 52, 22, B - 52, p);
    wall(pb, x + 52, 52, 22, B - 52, p);
    gable(pb, x - 2, 42, 24, 10, p);
    gable(pb, x + 50, 42, 24, 10, p);
    wall(pb, 28, 22, 24, B - 22, p, p.wallLite);
    flatTop(pb, 26, 22, 28, p, 6);
    archWindow(pb, 40, 32, 12, p);
    windowAt(pb, 32, 52, p, 3); windowAt(pb, 45, 52, p, 3);
    doorway(pb, 40, B, 13, 17, p);
    flag(pb, 40, 12, p, 12);
    tierCrown(pb, p, tier, 17);
  },

  /* ------------------------------ 行会 ------------------------------ */
  guild1: (pb, p, tier) => {
    const x = 26, w = 28;
    base(pb, x, w, p);
    wall(pb, x + 2, 38, w - 4, B - 38, p, p.stone);
    dome(pb, 40, 34, 16, 13, p);
    // 星盘：外环 + 内盘 + 指针
    pb.ellipse(40, 28, 9, 9, p.accent);
    pb.ellipse(40, 28, 6, 6, p.glass);
    pb.line(35, 33, 45, 23, p.woodDark);
    pb.line(35, 23, 45, 33, p.woodDark);
    doorway(pb, 40, B, 10, 14, p);
    tierCrown(pb, p, tier, 52);
  },
  guild2: (pb, p, tier) => {
    const x = 14, w = 52;
    base(pb, x, w, p);
    wall(pb, x + 2, 46, w - 4, B - 46, p);
    dome(pb, 40, 38, 24, 18, p, p.cloth);
    roundTower(pb, 18, B, 6, 24, p, 'dome');
    roundTower(pb, 62, B, 6, 24, p, 'dome');
    for (const wx of [32, 48]) archWindow(pb, wx, 54, 12, p);
    doorway(pb, 40, B, 11, 15, p);
    pb.ellipse(40, 20, 4, 4, p.accent);
    tierCrown(pb, p, tier, 54);
  },
  guild3: (pb, p, tier) => {
    const x = 18, w = 44;
    base(pb, x, w, p);
    wall(pb, 24, 44, 32, B - 44, p, p.stoneDark);
    // 两侧扶壁让底座像塔而不是房屋
    pb.poly([[18, B], [22, 30], [26, 30], [24, B]], p.stone);
    pb.poly([[62, B], [58, 30], [54, 30], [56, B]], p.stone);
    wall(pb, 32, 20, 16, B - 20, p, p.wallLite);
    // 棱面水晶冠：唯一保留的尖顶，但和其他塔完全不是一个轮廓
    pb.poly([[40, 3], [50, 20], [40, 38], [30, 20]], p.glass);
    pb.poly([[40, 3], [40, 38], [30, 20]], p.accent);
    pb.poly([[40, 9], [46, 20], [40, 31], [34, 20]], p.glass);
    // 悬浮光尘绕着晶体转（旧版是一条实心光带，会把晶体中段盖掉 —— 见 drawBuildFx）
    buildFx.push({ k: 'motes', x: 40, y: 23, rx: 14, ry: 15, color: p.accent });
    archWindow(pb, 40, 50, 14, p);
    doorway(pb, 40, B, 11, 14, p);
    if (tier > 1) { pb.ellipse(22, 22, 4, 4, p.glass); pb.ellipse(58, 22, 4, 4, p.glass); }
    // L3 只加台基：旗杆穿水晶尖顶会读成"被钉住"，本座的动效由光尘承担
  },
};

/**
 * 建筑内的特效层：烟、火光、法环。**在 outline 之后**调用（`fxBeforeOutline` 是
 * 证明这条的负向臂：挪到描边前，烟圈边缘会出现一圈墨色）。
 */
function drawBuildFx(pb: PixBuf, phase: number): void {
  const f = SCENE_ANIM_FRAMES;
  for (const s of buildFx) {
    if (s.k === 'smoke') {
      // 烟：四团依次上升、变大、变淡。上升幅度受"头顶还有多少画布"限制 ——
      // 工坊的烟囱原来顶在 y=8，烟只能挤在 4px 里（实拍是一坨白点）；
      // 把烟囱降到 y=18 后才有 16px 的烟道。
      // 半径与相位都按 f/4 排开，四团互相搭接才是"缕"，三团分离会读成爆米花（×8 目检）。
      const rise = Math.min(16, Math.max(6, s.y - 5));
      for (let i = 0; i < 4; i++) {
        // 相位间隔**不是等距**：等距（f/4=2）会让"第 k 帧"和"第 k+2 帧"是同一组烟团，
        // 只是换了画序 ⇒ 逐帧看是原地蹦，不是往上飘（实测 topY 5,8,5,8…）。
        const t = ((phase + ((s.x * 5 + s.y * 3) % f) + [0, 2.2, 4.3, 6.4][i]!) % f) / f;
        const py = s.y - 2 - t * rise;
        const r = 1.6 + t * 2.4;
        // 两端淡出、中段满：烟团在烟囱口"生出来"、在顶端"散掉"，循环接缝才看不见。
        // 不能用纯 sin —— 它让烟团刚出烟囱时几乎透明，烟柱和烟囱之间出现一道空档。
        const a = 0.46 * Math.min(1, t * 7) * Math.min(1, (1 - t) * 4);
        pb.ellipse(s.x + Math.round((i - 1.5) * 1.4 * (1 - t)), Math.round(py),
          Math.max(1, Math.round(r)), Math.max(1, Math.round(r * 0.85)), '#b6b0a0', a);
      }
    } else if (s.k === 'flick') {
      // 炉火/火把：只让**光晕**呼吸，火芯本身不动（动火芯会读成一团跳动的噪点）
      const pulse = 0.5 + 0.5 * Math.sin((phase / f) * Math.PI * 2 + (s.x % 3));
      const k = 0.85 + pulse * 0.3;
      pb.ellipse(s.x, s.y, Math.round(s.r * k), Math.round(s.r * 0.7 * k), s.color, 0.11 + pulse * 0.1);
    } else {
      // 法环改成**四粒绕晶体的光尘**：环形光带在 80px 上要么填实盖住晶体
      // （读成"被黄带子缠住"），要么只剩左右两瓣（读成"长了两只耳朵"）。
      // 光尘是点，不遮结构，绕一圈正好一轮。
      for (let i = 0; i < 4; i++) {
        const th = (i / 4 + phase / f) * Math.PI * 2;
        const px = s.x + Math.round(Math.cos(th) * s.rx);
        const py = s.y + Math.round(Math.sin(th) * s.ry * 0.55);
        const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(th * 2));
        pb.ellipse(px, py, 3, 3, s.color, 0.14 * tw);
        pb.ellipse(px, py, 1, 1, s.color, 0.85 * tw);
      }
    }
  }
}

/**
 * 80×80 的场景建筑；tier 只影响附加装饰，不改骨架。
 * `phase` 是动画相位（0..SCENE_ANIM_FRAMES-1）：同一座建筑每帧都是从头重画，
 * 所以不存在"上一帧的辐条留在原地"这种残影。
 */
export function buildSceneBuilding(owner: SpriteOwner, id: string, tier = 1, phase = 0): PixBuf {
  const pb = new PixBuf(SCENE_BUILDING_SIZE, SCENE_BUILDING_SIZE);
  const p = paletteOf(owner, id);
  const recipe = sceneArtBreaks.sameShape ? genericSpire : (RECIPES[id] ?? RECIPES.tavern!);
  const t = Math.max(1, Math.min(3, tier | 0));
  buildPhase = ((phase | 0) % SCENE_ANIM_FRAMES + SCENE_ANIM_FRAMES) % SCENE_ANIM_FRAMES;
  buildFx = [];
  footprint = { x: 8, w: 64 };
  recipe(pb, p, t);
  /* 升级档必须改变**剪影**：L2 台基到 x=2..77，L3 到 x=0..79（四族共用同一段几何）。
     画成带竖缝的砌石，不是一条纯色板——否则读成"垫在下面的板"。 */
  if (t >= 2) {
    pb.rect(2, 76, 76, 3, p.stone);
    pb.hline(2, 77, 76, p.stoneDark);
    for (let i = 8; i < 76; i += 9) pb.vline(i, 76, 78, p.stoneDark);
  }
  if (t >= 3) {
    pb.rect(0, 73, 80, 3, p.stone);
    pb.hline(0, 79, 73, p.stoneDark);
    for (let i = 4; i < 80; i += 11) pb.vline(i, 73, 75, p.stoneDark);
  }
  if (sceneArtBreaks.fxBeforeOutline) drawBuildFx(pb, buildPhase);
  pb.outline(p.outline);
  if (!sceneArtBreaks.noShadow) castShadow(pb);
  if (!sceneArtBreaks.fxBeforeOutline) drawBuildFx(pb, buildPhase);
  return pb;
}

export function sceneBuildingFrameName(owner: SpriteOwner, id: string, tier = 1): string {
  const t = Math.max(1, Math.min(3, tier | 0));
  return `scene_${owner}_${id}${t > 1 ? `_u${t}` : ''}`;
}

/* ------------------------------------------------------------------ 地块 */
/** 地块坐标用舞台百分比；`y` 越大越靠前，`scale` 给出远/中/近三档体量。 */
export interface TownPlot { id: string; x: number; y: number; scale: number; }
export const TOWN_PLOTS: readonly TownPlot[] = [
  // 远景：城墙线（小、高、互相搭接，读成一条防线）
  { id: 'wall1', x: 0.08, y: 0.44, scale: 0.76 },
  { id: 'wall2', x: 0.24, y: 0.43, scale: 0.76 },
  { id: 'wall3', x: 0.40, y: 0.42, scale: 0.78 },
  { id: 'townhall', x: 0.61, y: 0.43, scale: 0.84 },
  { id: 'guild3', x: 0.77, y: 0.44, scale: 0.80 },
  { id: 'guild2', x: 0.92, y: 0.46, scale: 0.74 },
  // 中景：沿主干道两侧排开，广场在中间留空
  { id: 'dwell1', x: 0.07, y: 0.62, scale: 0.92 },
  { id: 'dwell2', x: 0.20, y: 0.63, scale: 0.92 },
  { id: 'dwell3', x: 0.33, y: 0.64, scale: 0.90 },
  { id: 'dwell4', x: 0.67, y: 0.64, scale: 0.92 },
  { id: 'dwell5', x: 0.80, y: 0.63, scale: 0.94 },
  { id: 'guild1', x: 0.93, y: 0.65, scale: 0.86 },
  // 近景：三座大房子压住画面下沿，给纵深
  { id: 'tavern', x: 0.20, y: 0.88, scale: 1.12 },
  { id: 'market', x: 0.48, y: 0.86, scale: 1.06 },
  { id: 'workshop', x: 0.76, y: 0.88, scale: 1.12 },
  // 旗杆立在广场边，不是另一排房子
  { id: 'banner', x: 0.61, y: 0.73, scale: 0.72 },
];
export const CASTLE_PLOT: TownPlot = { id: '__castle', x: 0.50, y: 0.46, scale: 0.60 };

/* ------------------------------------------------------------------ 底子 */
/**
 * 底子的动画元素**不进底图**，而是作为"锚点"返回给上层，由一张透明特效画布逐帧叠加。
 *
 * 为什么不把 8 帧底图整个烘出来：832×275 一张 RGBA 就 0.9 MB，8 张 7 MB，而且 p1 的
 * 山丘底子一次要 12 ms —— 每帧重画等于给手机上挂一个常态卡顿。底图只画一次
 * （地形/城堡/街道都不动），动的只有旗面、火把光晕、喷泉、路灯 —— 十来个几十像素的精灵。
 */
export type TownFxKind = 'flagCloth' | 'torch' | 'lamp' | 'fire' | 'crystal' | 'fountain';
export interface TownFxSpot {
  k: TownFxKind;
  /** 锚点：旗=旗杆顶，火/灯=火芯，水晶=晶柱中段，喷泉=出水口。 */
  x: number; y: number;
  /** 旗面长度（只对 flagCloth 有效）。 */
  len?: number;
  /** 相位偏移：同一种特效在城里多处出现时错开，免得整城一起眨眼。 */
  off?: number;
}
let baseFx: TownFxSpot[] = [];
function pushBaseFx(s: TownFxSpot): void { baseFx.push(s); }

/** 精灵几何：w/h 是画布尺寸，dx/dy 是"精灵左上角相对锚点"的偏移（负=向左上）。 */
export const TOWN_FX_SPRITES: Readonly<Record<TownFxKind, { w: number; h: number; dx: number; dy: number }>> = {
  flagCloth: { w: 24, h: 14, dx: -1, dy: -2 },
  torch: { w: 26, h: 30, dx: -13, dy: -15 },
  lamp: { w: 22, h: 26, dx: -11, dy: -13 },
  fire: { w: 44, h: 40, dx: -22, dy: -27 },
  crystal: { w: 34, h: 44, dx: -17, dy: -26 },
  fountain: { w: 52, h: 44, dx: -26, dy: -20 },
};

/**
 * 单帧特效精灵（透明底）。上层按 `(phase + off) % SCENE_ANIM_FRAMES` 取帧并叠在底图上。
 * 这里画的全是**半透明/发光**的东西：底图不带它们，所以永远不会被描边圈住。
 */
export function buildTownFxSprite(owner: SpriteOwner, kind: TownFxKind, phase: number, o: { len?: number; off?: number } = {}): PixBuf {
  const s = TOWN_FX_SPRITES[kind];
  const pb = new PixBuf(s.w, s.h);
  const ax = -s.dx, ay = -s.dy;
  const p = paletteOf(owner);
  const f = SCENE_ANIM_FRAMES;
  const ph = sceneArtBreaks.noAnim ? 0 : ((((phase | 0) + (o.off ?? 0)) % f) + f) % f;
  const pulse = 0.5 + 0.5 * Math.sin((ph / f) * Math.PI * 2);
  if (kind === 'flagCloth') {
    flagClothInto(pb, ax, ay, o.len ?? 12, FLAG_SWAY[ph]!, p.accent, p.cloth);
  } else if (kind === 'torch') {
    // 火把：光晕呼吸 + 火舌尖端上下 1px（只有光晕会读成"屏幕在闪"，加个舌尖才是火）
    pb.ellipse(ax, ay, Math.round(7 + pulse), Math.round(8 + pulse), '#ffa93a', 0.13 + pulse * 0.12);
    pb.ellipse(ax, ay - 3 - Math.round(pulse), 1, 2, '#ffcf6b', 0.75);
  } else if (kind === 'lamp') {
    pb.ellipse(ax, ay, Math.round(6 + pulse), Math.round(7 + pulse), p.accent, 0.1 + pulse * 0.1);
  } else if (kind === 'fire') {
    // 篝火：外焰两片轮流抬高，内焰芯不动（动芯会读成噪点）
    pb.ellipse(ax, ay + 4, Math.round(13 + pulse * 2), Math.round(9 + pulse), '#ff8b2a', 0.16 + pulse * 0.1);
    for (const dir of [-1, 1]) {
      const h = 10 + ((ph + (dir > 0 ? 3 : 0)) % f < 4 ? 4 : 0);
      pb.poly([[ax + dir * 3, ay + 6], [ax + dir * 6, ay + 6 - h], [ax + dir * 9, ay + 6]], '#ffb347');
    }
    pb.poly([[ax, ay + 5], [ax - 3, ay - 7], [ax + 3, ay - 7]], p.accent);
  } else if (kind === 'crystal') {
    pb.ellipse(ax, ay, Math.round(11 + pulse * 2), Math.round(14 + pulse * 2), p.accent, 0.1 + pulse * 0.08);
    pb.ellipse(ax, ay, 5, 7, '#e8d0ff', 0.16 + pulse * 0.1);
  } else {
    // 喷泉：5 滴水按抛物线从出水口散开落回池面；池面反光两处交替亮
    for (let i = 0; i < 5; i++) {
      const t = (((ph + i * (f / 5)) % f) / f);
      const dir = i % 2 ? 1 : -1;
      const dx = dir * Math.round(2 + t * 12);
      const dy = Math.round(-Math.sin(t * Math.PI) * 8 + t * t * 13);
      pb.hline(ax + dx, ax + dx + 1, ay + dy, '#cdeef4', 0.85);
      pb.hline(ax + dx, ax + dx, ay + dy + 1, '#8fc3cf', 0.5);
    }
    for (const s2 of [-1, 1]) {
      const on = (ph + (s2 > 0 ? 3 : 0)) % f < 4;
      pb.ellipse(ax + s2 * 8, ay + 16, 3, 1, '#cdeef4', on ? 0.85 : 0.35);
    }
  }
  return pb;
}

/** 四族**结构不同**的空城底子（不是换配色）：石堡山丘 / 火山营地 / 巨树 / 神殿。
 *  返回静态底图 + 需要逐帧叠加的特效锚点。 */
export function buildTownScene(owner: SpriteOwner, w: number, h: number): { base: PixBuf; fx: TownFxSpot[] } {
  const pb = new PixBuf(Math.max(320, w | 0), Math.max(180, h | 0));
  const W = pb.w, H = pb.h;
  const p = paletteOf(owner);
  // sameBase 负向臂也要统一材质，否则塔顶/路灯仍带族色，IoU 到不了 1
  const bp = sceneArtBreaks.sameBase ? paletteOf('p1') : p;
  baseFx = [];
  if (owner === 'p1' || sceneArtBreaks.sameBase) baseHill(pb, W, H, bp);
  else if (owner === 'p2') baseCamp(pb, W, H, p);
  else if (owner === 'p3') baseTree(pb, W, H, p);
  else baseTemple(pb, W, H, p);
  castleBackdrop(pb, W, H, bp);
  if (!sceneArtBreaks.noStreet) townInfrastructure(pb, W, H, bp, owner);
  return { base: pb, fx: baseFx.slice() };
}

/** 只要静态底图时用这个（闸门的 S4/S6/S8 都读它）。 */
export function buildTownBase(owner: SpriteOwner, w: number, h: number): PixBuf {
  return buildTownScene(owner, w, h).base;
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

/**
 * 远景城堡：幕墙 + 角塔 + **三层收分主堡** + 门楼。
 * 旧版是一整块灰矩形开个黑洞，占画面最大面积却最没有设计——这里把纵向做碎：
 * 每层各自有城垛、箭孔和受光边，顶上再收两座小角楼，剪影才有 HOMM3 的层次。
 */
function castleBackdrop(pb: PixBuf, W: number, H: number, p: ScenePalette): void {
  const wallY = Math.round(H * 0.40);
  const wallH = Math.round(H * 0.12);
  const wallB = wallY + wallH;
  const x0 = Math.round(W * 0.10), x1 = Math.round(W * 0.90);
  const stone = '#6f6858', lite = '#938b77', dark = '#4a4538';

  if (sceneArtBreaks.flatCastle) {
    // 负向臂：旧版"一块灰墙 + 一个洞"，用来证明判据量的是结构
    pb.rect(x0, wallY, x1 - x0, wallH, stone);
    pb.rect(Math.round(W * 0.5) - 11, wallB - 26, 22, 26, '#2b2419');
    return;
  }

  /* ---- 幕墙 ---- */
  pb.rect(x0, wallY, x1 - x0, wallH, stone);
  pb.rect(x0, wallY, x1 - x0, 2, lite); // 顶面受光
  pb.hline(x0, x1, wallB - 1, dark);
  for (let y = wallY + 6; y < wallB - 2; y += 7) pb.hline(x0, x1, y, '#5d5749', 0.45);
  for (let x = x0; x < x1; x += 13) pb.rect(x, wallY - 5, 7, 5, lite); // 城垛
  for (let x = x0 + 10; x < x1 - 8; x += 27) {
    if (Math.abs(x - W * 0.5) < 52) continue; // 别和主堡/门楼打架
    pb.rect(x, wallY + 8, 2, 7, '#2b2419');
  }

  /* ---- 四座角塔 ---- */
  const towerR = Math.max(6, Math.round(W * 0.021));
  const towerH = Math.round(H * 0.19);
  for (const fx of [0.12, 0.285, 0.715, 0.88]) {
    const cx = Math.round(W * fx);
    roundTower(pb, cx, wallB, towerR, towerH, p, 'cone');
    // 杆留在底图上（构件），旗面交给特效层（会飘）
    flagPole(pb, cx, wallB - towerH - 14, p);
    pushBaseFx({ k: 'flagCloth', x: cx, y: wallB - towerH - 14, len: 9, off: cx % SCENE_ANIM_FRAMES });
  }

  /* ---- 主堡：三层收分 ---- */
  const bands: [number, number, number][] = [
    [0.424, 0.576, 0.318],
    [0.444, 0.556, 0.238],
    [0.461, 0.539, 0.168],
  ];
  bands.forEach(([fa, fb, fy], i) => {
    const bx = Math.round(W * fa), bw = Math.round(W * (fb - fa));
    const by = Math.round(H * fy);
    // 每层只画到自己头顶为止：三段都铺到墙根的话，后画的会把前一段整段盖掉，
    // 收分就消失成一个方盒子（第一版就是这个错）。
    const nextY = i < 2 ? Math.round(H * bands[i + 1]![2]) : wallB;
    // 三层各自一个明度台阶，否则收分只体现在宽窄上，远看还是一整块
    const face = ['#6d6656', '#787160', '#847c69'][i]!;
    pb.rect(bx, by, bw, nextY - by, face);
    pb.rect(bx, by, 4, nextY - by, lite); // 左受光
    pb.rect(bx + 4, by, 1, nextY - by, '#5f5949'); // 受光面与正面的转折
    pb.rect(bx + bw - 6, by, 6, nextY - by, '#585245'); // 右背光
    pb.hline(bx, bx + bw - 1, by, dark);
    pb.hline(bx, bx + bw - 1, by + 3, '#524c3f', 0.85); // 城垛投在墙面上的暗带
    // 砌石横缝：不加的话主堡就是一大片纯色，远看像没画完
    for (let my = by + 9; my < nextY - 2; my += 7) pb.hline(bx + 5, bx + bw - 7, my, '#5b5546', 0.32);
    for (let x = bx; x < bx + bw - 3; x += 11) pb.rect(x, by - 5, 6, 5, lite);
    // 箭孔：底层给门楼让位
    for (let x = bx + 9; x < bx + bw - 9; x += 16) {
      if (i === 0 && Math.abs(x - W * 0.5) < 26) continue;
      if (by + 12 > nextY - 2) continue;
      pb.rect(x, by + 10, 2, 6, '#2b2419');
    }
    // 亮着的窗：主堡是唯一在夜里还醒着的建筑
    if (i === 1) for (const s of [-1, 1]) {
      pb.rect(Math.round(W * 0.5) + s * 22 - 2, by + 14, 4, 6, p.woodDark);
      pb.rect(Math.round(W * 0.5) + s * 22 - 1, by + 15, 2, 4, p.glass);
      pb.ellipse(Math.round(W * 0.5) + s * 22, by + 17, 5, 5, p.glass, 0.12);
    }
  });
  // 顶收两座小角楼，把方盒子破掉
  const topY = Math.round(H * 0.168);
  for (const s of [-1, 1]) roundTower(pb, Math.round(W * 0.5) + s * Math.round(W * 0.038), topY + 12, 4, 12, p, 'cone');
  flagPole(pb, Math.round(W * 0.5), topY - 24, p);
  pushBaseFx({ k: 'flagCloth', x: Math.round(W * 0.5), y: topY - 24, len: 18, off: 3 });
  // 两条长旗从城垛垂下来：主堡正面最缺的就是"人的痕迹"
  for (const s of [-1, 1]) {
    const bnx = Math.round(W * 0.5) + s * 17 - 4;
    pb.rect(bnx, topY + 6, 9, 26, p.clothDark);
    pb.rect(bnx + 1, topY + 7, 7, 23, p.accent);
    pb.poly([[bnx + 1, topY + 30], [bnx + 4, topY + 26], [bnx + 8, topY + 30]], p.clothDark);
    pb.vline(bnx + 4, topY + 8, topY + 28, p.cloth);
  }

  /* ---- 门楼：拱门 + 闸门 + 火把 ---- */
  const gx = Math.round(W * 0.5);
  const gh = Math.round(H * 0.105);
  // 门楼是主堡底座上凸出的一块，用比底座更深的石头，才不会像贴上去的浅色板
  pb.rect(gx - 22, wallB - gh - 12, 44, gh + 12, '#645d4d');
  pb.rect(gx - 22, wallB - gh - 12, 3, gh + 12, '#8d8471');
  pb.rect(gx + 19, wallB - gh - 12, 3, gh + 12, '#4f493c');
  for (let my = wallB - gh; my < wallB - 2; my += 6) pb.hline(gx - 19, gx + 18, my, '#55503f', 0.4);
  for (let x = gx - 22; x < gx + 22; x += 10) pb.rect(x, wallB - gh - 17, 6, 5, lite);
  // 拱洞
  pb.rect(gx - 12, wallB - gh, 24, gh, '#241c12');
  pb.ellipse(gx, wallB - gh, 12, 8, '#241c12');
  pb.ellipse(gx, wallB - 5, 9, 5, '#c98a3a', 0.5); // 门洞里透出的火光
  pb.ellipse(gx, wallB - gh + 5, 7, 5, '#e0a24a', 0.2);
  // 闸门栅条
  for (let i = -1; i <= 1; i++) pb.vline(gx + i * 6, wallB - gh + 3, wallB - 1, '#3a3126');
  pb.hline(gx - 12, gx + 12, wallB - gh + 9, '#3a3126');
  pb.hline(gx - 12, gx + 12, wallB - 3, '#3a3126');
  // 拱券石 + 门口火把（火把先画托架，不然就是两个悬空黄点）
  pb.vline(gx - 13, wallB - gh, wallB, '#8d8471');
  pb.vline(gx + 13, wallB - gh, wallB, '#8d8471');
  for (const s of [-1, 1]) {
    const tx = gx + s * 18;
    pb.hline(tx - 2, tx + 2, wallB - 25, '#3a3126');
    pb.vline(tx, wallB - 25, wallB - 17, '#3a3126');
    pb.ellipse(tx, wallB - 26, 2, 3, '#ffcf6b');
    pushBaseFx({ k: 'torch', x: tx, y: wallB - 26, off: s > 0 ? 4 : 0 });
  }
  // 幕墙上的两面色旗，把"这是谁的城"摊到整条防线
  for (const fx of [0.36, 0.64]) {
    const wx = Math.round(W * fx);
    flagPole(pb, wx, wallY - 16, p);
    pushBaseFx({ k: 'flagCloth', x: wx, y: wallY - 16, len: 12, off: wx % SCENE_ANIM_FRAMES });
  }
}

/** 城市骨架：主干道 + 中央广场 + 喷泉 + 支路 + 路灯。负向臂 noStreet 整段抽掉。 */
function townInfrastructure(pb: PixBuf, W: number, H: number, p: ScenePalette, owner: SpriteOwner): void {
  // 路面跟着地形走：同一块米色铺在火山黑土或紫色神殿地上，会像贴上去的一块沙盘。
  // 负向臂 sameBase 连路面一起塌回 p1，否则"底子同形"还剩一层族色差。
  const road = sceneArtBreaks.sameBase ? TOWN_ROAD_COLOR
    : owner === 'p1' ? TOWN_ROAD_COLOR
    : owner === 'p2' ? mix(TOWN_ROAD_COLOR, '#5a3a24', 0.55)
      : owner === 'p3' ? mix(TOWN_ROAD_COLOR, '#5f6f3a', 0.42)
        : mix(TOWN_ROAD_COLOR, '#4b3d5e', 0.5);
  const roadDark = shade(road, -0.26);
  const plaza = shade(road, 0.1);
  const stoneLite = shade(road, 0.16), stoneDeep = shade(road, -0.18);
  const topY = Math.round(H * 0.44);
  const roadTop = Math.round(W * 0.035), roadBot = Math.round(W * 0.10);
  // 主干道：从城门向屏幕下方张开
  pb.poly([
    [Math.round(W * 0.5 - roadTop), topY], [Math.round(W * 0.5 + roadTop), topY],
    [Math.round(W * 0.5 + roadBot), H], [Math.round(W * 0.5 - roadBot), H],
  ], road);
  pb.line(W * 0.5 - roadTop, topY, W * 0.5 - roadBot, H, roadDark, 1.5);
  pb.line(W * 0.5 + roadTop, topY, W * 0.5 + roadBot, H, roadDark, 1.5);
  // 支路：广场向左右延伸，暗示"城里还有别的街"
  const py = Math.round(H * 0.70);
  pb.rect(0, py - 5, Math.round(W * 0.5), 10, road);
  pb.rect(Math.round(W * 0.5), py - 5, Math.round(W * 0.5), 10, road);
  pb.hline(0, W, py - 5, roadDark, 0.5);
  pb.hline(0, W, py + 5, roadDark, 0.5);
  // 铺石纹理：按位置哈希，不引入随机流。只用比底子略深/略浅两色，
  // 大面积纯色会读成一块沙地（2x 目检时最明显的问题）。
  for (let i = 0; i < 420; i++) {
    const t = hash2(i, 3, 2026);
    const y = Math.round(topY + t * (H - topY));
    const halfW = Math.round(roadTop + (t * (roadBot - roadTop)));
    const x = Math.round(W * 0.5 + (hash2(i, 4, 2026) - 0.5) * halfW * 1.78);
    const tone = hash2(i, 5, 2026) > 0.5 ? stoneLite : stoneDeep;
    pb.hline(x, x + 4, y, tone, 0.8);
    if (i % 3 === 0) pb.vline(x, y, y + 2, roadDark, 0.5);
  }
  // 中央广场
  const plazaRx = Math.round(W * 0.15), plazaRy = Math.round(H * 0.085);
  pb.ellipse(W * 0.5, py, plazaRx, plazaRy, roadDark);
  pb.ellipse(W * 0.5, py, plazaRx - 4, plazaRy - 3, plaza);
  // 喷泉：池体与出水柱是构件，水花交给特效层（逐帧散开落回池面）
  pb.ellipse(W * 0.5, py + 4, 18, 7, '#5b5346');
  pb.ellipse(W * 0.5, py + 2, 15, 5, '#5a8fa0');
  pb.rect(Math.round(W * 0.5 - 2), py - 14, 4, 15, '#8b8472');
  pb.ellipse(W * 0.5, py - 15, 4, 3, '#8b8472');
  pushBaseFx({ k: 'fountain', x: W * 0.5, y: py - 15 });
  // 路灯：杆 + 暖光，沿街不挡建筑
  [0.26, 0.38, 0.62, 0.74].forEach((fx, i) => {
    const x = Math.round(W * fx), y = Math.round(H * (fx < 0.5 ? 0.78 : 0.78));
    pb.vline(x, y - 18, y, '#3a2f22');
    pb.ellipse(x, y - 19, 3, 4, p.accent, 0.95);
    pushBaseFx({ k: 'lamp', x, y: y - 19, off: (i * 3) % SCENE_ANIM_FRAMES });
  });
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
  let lx = Math.round(W * 0.08);
  const fissure = Math.max(6, H >> 5);
  for (let y = Math.round(H * 0.56); y < H; y += fissure) {
    const nx = lx + Math.round((hash2(y, 2, 91) - 0.5) * W * 0.08);
    // 岩唇 → 熔岩 → 高光三层，单根细线在这个尺寸下只会读成一道涂鸦
    for (let k = -2; k <= 2; k++) pb.line(lx, y + k, nx, y + fissure + k, '#2a120a', 1);
    for (let k = -1; k <= 1; k++) pb.line(lx, y + k, nx, y + fissure + k, '#c4471e', 1);
    pb.line(lx, y, nx, y + fissure, '#ffb347', 0.95);
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
    // 火焰本体是构件，跳动由特效层的两片外焰承担（同一条流水线的火把规则）
    pushBaseFx({ k: 'fire', x, y: y - 13, off: fx < 0.5 ? 0 : 5 });
  }
}

/** p3：巨树 —— 一整棵树冠当背景，树根与蘑菇落在台地上。 */
function baseTree(pb: PixBuf, W: number, H: number, _p: ScenePalette): void {
  skyBands(pb, W, H, '#1f3a2e', '#b9d49a');
  pb.poly([[0, H * 0.5], [W * 0.3, H * 0.4], [W * 0.7, H * 0.42], [W, H * 0.52], [W, H], [0, H]], '#4c7038');
  pb.poly([[0, H * 0.78], [W, H * 0.74], [W, H], [0, H]], '#38582a');
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
    pushBaseFx({ k: 'crystal', x, y: y - 17, off: fx < 0.5 ? 2 : 6 });
  }
}
