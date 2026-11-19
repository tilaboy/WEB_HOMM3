/**
 * 城内一览（M9 · HOMM3 观感）的美术件。
 *
 * 这里不重画一百张图：44×44 的建筑帧先用 **2× 像素放大代理**重画一遍 —— 不是
 * `drawImage` 插值，而是把每一笔的坐标与笔宽一起乘 2，得到 88×88 的硬边像素画
 * （门、窗、旗、齿轮仍是 2px 实心块，不会变成 1px 细线飘在 88px 画布上）。
 * 行会本来就有 `outlinePx` 参数，直接出 2px 描边档。
 *
 * 背景是程序化的"山丘上的城堡 + 四族地形色"，**不是**把概念图当位图贴进来
 * （项目零位图约束不变）。同一族同一尺寸逐像素确定，不引入随机流。
 */
import { PixBuf, hash2, mix, shade } from './pixel.js';
import { buildBuildingArt } from './buildingArt.js';
import { buildGuildArt, guildArtTierOf } from './guildArt.js';
import { ownerPalette, type SpriteOwner } from './atlas.js';

/** 大版建筑的固定画布：44 × 2。 */
export const TOWN_BUILDING_SIZE = 88;
/** 城镇面板里的全部 16 座（与 `BUILD_TABS` 逐项对齐）。 */
export const TOWN_BUILDING_IDS = [
  'tavern', 'market', 'townhall', 'workshop', 'wall1', 'wall2', 'wall3', 'banner',
  'dwell1', 'dwell2', 'dwell3', 'dwell4', 'dwell5', 'guild1', 'guild2', 'guild3',
] as const;

/** 真正放大的像素代理：坐标、笔宽一起 ×2，保持硬边与识别件比例。 */
class Scale2PixBuf {
  constructor(private readonly pb: PixBuf) {}
  set(x: number, y: number, color: string, a = 1): void {
    const x0 = Math.round(x * 2), y0 = Math.round(y * 2);
    this.pb.rect(x0, y0, 2, 2, color, a);
  }
  rect(x: number, y: number, w: number, h: number, color: string, a = 1): void {
    this.pb.rect(Math.round(x * 2), Math.round(y * 2), Math.max(1, Math.round(w * 2)), Math.max(1, Math.round(h * 2)), color, a);
  }
  frame(x: number, y: number, w: number, h: number, color: string, a = 1): void {
    const x0 = Math.round(x * 2), y0 = Math.round(y * 2);
    const x1 = Math.round((x + w) * 2) - 1, y1 = Math.round((y + h) * 2) - 1;
    this.pb.rect(x0, y0, x1 - x0 + 1, 2, color, a);
    this.pb.rect(x0, y1 - 1, x1 - x0 + 1, 2, color, a);
    this.pb.rect(x0, y0, 2, y1 - y0 + 1, color, a);
    this.pb.rect(x1 - 1, y0, 2, y1 - y0 + 1, color, a);
  }
  hline(x0: number, x1: number, y: number, color: string, a = 1): void {
    this.rect(Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, color, a);
  }
  vline(x: number, y0: number, y1: number, color: string, a = 1): void {
    this.rect(x, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, color, a);
  }
  line(x0: number, y0: number, x1: number, y1: number, color: string, a = 1): void {
    let x = Math.round(x0), y = Math.round(y0);
    const ex = Math.round(x1), ey = Math.round(y1);
    const dx = Math.abs(ex - x), dy = Math.abs(ey - y);
    const sx = x < ex ? 1 : -1, sy = y < ey ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.set(x, y, color, a);
      if (x === ex && y === ey) break;
      const e2 = err * 2;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, color: string, a = 1): void {
    this.pb.ellipse(cx * 2, cy * 2, Math.max(1, rx * 2), Math.max(1, ry * 2), color, a);
  }
  poly(pts: [number, number][], color: string, a = 1): void {
    this.pb.poly(pts.map(([x, y]) => [x * 2, y * 2] as [number, number]), color, a);
  }
  tri(a: [number, number], b: [number, number], c: [number, number], color: string, alpha = 1): void {
    this.poly([a, b, c], color, alpha);
  }
  outline(color = '#241c12', alpha = 1): void {
    this.pb.outline(color, alpha);
  }
}

/** 88×88 的建筑大图；行会走三阶塔，其余走 `buildingArt.ts`。 */
export function buildTownBuilding(owner: SpriteOwner, id: string, tier = 1): PixBuf {
  const pb = new PixBuf(TOWN_BUILDING_SIZE, TOWN_BUILDING_SIZE);
  const s = new Scale2PixBuf(pb);
  if (id.startsWith('guild')) {
    // 行会那版描边参数是 1px 语义；要进同一张 88px 画布，仍走 2× 代理。
    const g = buildGuildArt(owner, guildArtTierOf(id), 1);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const [r, gg, b, a] = g.px(x, y);
      if (a) s.set(x, y, `#${((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1)}`, a / 255);
    }
  } else {
    const source = buildBuildingArt(owner, id, 1, Math.max(1, Math.min(3, tier | 0)));
    for (let y = 0; y < source.h; y++) for (let x = 0; x < source.w; x++) {
      const [r, g, b, a] = source.px(x, y);
      if (a) s.set(x, y, `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`, a / 255);
    }
  }
  pb.outline('#241c12');
  return pb;
}

/** 大图帧名（DOM 的 `data-frame` 写在它上面，与卡片的 44px 帧名分开）。 */
export function townBuildingFrameName(owner: SpriteOwner, id: string, tier = 1): string {
  const t = Math.max(1, Math.min(3, tier | 0));
  return `tv_${owner}_${id}${t > 1 ? `_u${t}` : ''}`;
}

/* ---------------------------------------------------------------- 背景 */

/**
 * 程序化城景：天空四段横带 + 远山 + 中央山丘 + 两条土路 + 林带 + 石阶。
 * 尺寸由舞台实际像素给定（不缩放位图），四族只换配色与远处山峰相位。
 */
export function buildTownSceneBg(owner: SpriteOwner, w: number, h: number): PixBuf {
  const pb = new PixBuf(Math.max(320, w | 0), Math.max(180, h | 0));
  const { roof, wall } = ownerPalette(owner);
  const W = pb.w, H = pb.h;
  const skyTop = mix('#1d3150', roof, 0.16);
  const skyLow = mix('#d8b57d', roof, 0.18);
  const ground = mix('#4b7130', roof, 0.1);
  const groundDark = shade(ground, -0.22);
  const hillTop = Math.round(H * 0.46);

  // 天空：四段横带（没有渐变，保持像素画的硬边）
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const c = t < 0.22 ? skyTop : t < 0.42 ? mix(skyTop, skyLow, 0.45)
      : t < 0.62 ? skyLow : '#e6cf9e';
    pb.hline(0, W - 1, y, c);
  }
  // 太阳：在远山之后先画
  const sunX = Math.round(W * (owner === 'p1' ? 0.78 : owner === 'p2' ? 0.2 : owner === 'p3' ? 0.7 : 0.3));
  pb.ellipse(sunX, Math.round(H * 0.2), Math.round(W * 0.035), Math.round(W * 0.035), '#f6e6a8', 0.9);

  // 远山：三段折线，族色只做很轻的偏移（不许抢建筑）
  for (let layer = 0; layer < 3; layer++) {
    const base = Math.round(H * (0.36 + layer * 0.045));
    const c = layer === 0 ? '#6d7c8a' : layer === 1 ? '#5a6a63' : '#4a5b46';
    const pts: [number, number][] = [[0, H]];
    for (let x = 0; x <= W; x += Math.max(24, W >> 5)) {
      const n = hash2(x, layer, 771 + owner.length);
      pts.push([x, base - Math.round(n * H * 0.09)]);
    }
    pts.push([W, H]);
    pb.poly(pts, c);
  }

  // 中央山丘：城堡脚下的台地（地面从这里开始）
  const hill: [number, number][] = [[0, H]];
  for (let x = 0; x <= W; x += Math.max(16, W >> 6)) {
    const d = Math.abs(x - W / 2) / (W / 2);
    const y = hillTop + Math.round(d * d * H * 0.08 + hash2(x, 3, 991) * 3);
    hill.push([x, y]);
  }
  hill.push([W, H]);
  pb.poly(hill, ground);
  // 台地压暗的下半部 + 两道草纹，破"整块绿色壁纸"
  pb.poly([[0, Math.round(H * 0.78)], [W, Math.round(H * 0.72)], [W, H], [0, H]], groundDark);
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(hash2(i, 7, 421) * W);
    const y = Math.floor(hillTop + hash2(i, 9, 421) * (H - hillTop - 6));
    if (x < W - 2) pb.hline(x, x + 2, y, shade(ground, 0.16), 0.8);
  }

  // 两条土路通向城堡（中间宽、两端窄），并在下沿分叉
  const road = '#b08b52';
  for (let y = Math.round(H * 0.6); y < H; y++) {
    const t = (y - H * 0.6) / (H * 0.4);
    const half = Math.round(8 + t * W * 0.06);
    const cx = Math.round(W / 2 + Math.sin(t * 2.2) * W * 0.05);
    pb.hline(cx - half, cx + half, y, road, 0.85);
    pb.hline(cx - half, cx - half + 2, y, '#8d6a3e', 0.7);
    pb.hline(cx + half - 2, cx + half, y, '#8d6a3e', 0.7);
  }

  // 林带：边缘几簇松树剪影（只在台地两侧，建筑槽位中央留空）
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < 14; i++) {
      const x = Math.round((side ? 0.72 + hash2(i, side, 313) * 0.27 : hash2(i, side, 313) * 0.28) * W);
      const y = Math.round(H * (0.58 + hash2(i, side, 517) * 0.3));
      const hh = Math.round(H * (0.045 + hash2(i, side, 619) * 0.05));
      pb.poly([[x, y - hh], [x - hh * 0.45, y], [x + hh * 0.45, y]], '#31562c');
      pb.vline(x, y, y + 3, '#5c4128');
    }
  }
  // 石阶：从台地到城堡门前
  for (let i = 0; i < 5; i++) {
    const y = Math.round(H * (0.53 + i * 0.018));
    const half = Math.round(W * (0.05 + i * 0.008));
    pb.hline(Math.round(W / 2 - half), Math.round(W / 2 + half), y, mix(wall, '#6d6559', 0.4));
    pb.hline(Math.round(W / 2 - half), Math.round(W / 2 + half), y + 1, '#6d6559');
  }
  return pb;
}
