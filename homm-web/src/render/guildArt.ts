/**
 * 魔法行会三阶外形（S5 · spec §2.4 第三条链 / §6.3）。
 *
 * 三阶不是三个抽象等级，而是 **`guild1/2/3` 三个独立建筑**各自的外观：
 *
 * | 档 | 建筑 | 外观（§6.3 明文） | 读得出的那一笔 |
 * |---|---|---|---|
 * | 1 | `guild1` 石塔 | 方塔 + 木门 | 平顶 + 拱形木门 |
 * | 2 | `guild2` 尖顶塔 | +尖顶 +悬浮符文 | 三角尖顶 + 塔两侧离体的符文 |
 * | 3 | `guild3` 浮空塔 | 基座离地 + 环 | 塔身与基座之间**整行透空** + 环带 |
 *
 * 为什么画 44×44 而不是沿用地图的 40×52：这三张图只出现在**城镇面板的行会卡**
 * 里（卡片左栏 44px），不参与地图拼贴。地图上的城堡轮廓归 S6（`townSprite.ts`，
 * 按城防档位选帧），两套东西不要互相借帧 —— 一个是"城长什么样"，一个是"塔长什么样"。
 *
 * ⚠️ **判据与实现共用几何常数**：闸门（`tools/probes/guildart.mjs`）量的是
 * 本文件建出来的像素，不在探针里重抄坐标 —— 抄一遍就会出现"改了画法、门还在
 * 按旧坐标量"的静默过期（项目铁律 13）。
 *
 * 纯函数、不碰 DOM：`PixBuf` 只写整数像素，node 里直接跑。
 */
import { PixBuf, chamferRect, shade } from './pixel.js';
import type { SpriteOwner } from './atlas.js';

/** 卡片左栏的固定尺寸（`style.css` 的 `.bart` 必须与它一致）。 */
export const GUILD_ART_SIZE = 44;

/**
 * 四族材质（§2.4「四族差异只体现在用哪套材质做这三阶」）：
 * 草坡石木 / 熔岩黑铁 / 枝干木构 / 浮空白石。
 *
 * 只换材质、不换结构：台阶数、门的位置、尖顶角度、符文与环的位置**四族完全一致**，
 * 所以"这一段是塔、那一段是尖顶"在任何一族都同构 —— 玩家换族不用重新学读图。
 */
export interface GuildPalette {
  wall: string;
  wallDark: string;
  wallLite: string;
  roof: string;
  roofDark: string;
  wood: string;
  woodDark: string;
  /** 符文 / 环 / 窗火。 */
  glow: string;
}

const PALETTES: Record<SpriteOwner, GuildPalette> = {
  /* 草坡石木：暖灰石 + 蓝瓦（族色）。 */
  p1: {
    wall: '#c9c2b0', wallDark: '#8b8271', wallLite: '#e6dfcc',
    roof: '#3f6fd0', roofDark: '#27467f', wood: '#7d5a34', woodDark: '#4e351d',
    glow: '#9fc0ff',
  },
  /* 熔岩黑铁：黑曜石墙 + 暗红铁顶 + 余烬。 */
  p2: {
    wall: '#5d4a44', wallDark: '#332622', wallLite: '#7d6760',
    roof: '#c0392b', roofDark: '#7d2119', wood: '#6b4a32', woodDark: '#3b2418',
    glow: '#ff8a45',
  },
  /* 枝干木构：树皮墙 + 叶绿顶。 */
  p3: {
    wall: '#9a7448', wallDark: '#5d4028', wallLite: '#c19a66',
    roof: '#2e9e5b', roofDark: '#1c6438', wood: '#6f4a29', woodDark: '#422a15',
    glow: '#8ce0a8',
  },
  /* 浮空白石：冷白石材 + 紫晶顶。 */
  p4: {
    wall: '#d8d2e4', wallDark: '#9b93b5', wallLite: '#f2eefb',
    roof: '#8a4fc9', roofDark: '#57317f', wood: '#6d5b78', woodDark: '#40334a',
    glow: '#c8a5ff',
  },
  /* 中立（不建行会，仅为了类型闭合；与 p1 同材质去掉族色）。 */
  neutral: {
    wall: '#a89f8c', wallDark: '#77705f', wallLite: '#cfc7b3',
    roof: '#8d8474', roofDark: '#5f584b', wood: '#7d5a34', woodDark: '#4e351d',
    glow: '#d8d2c0',
  },
};

export function guildPaletteOf(owner: SpriteOwner): GuildPalette {
  return PALETTES[owner] ?? PALETTES.p1;
}

/**
 * 负向对照开关（**只给闸门用**，游戏里永远是默认值）。
 *
 * 每条都对应一条真实会犯的错，而不是"随便改坏一个数"：
 *   flat      三阶画成同一张 ⇒ 玩家升了级看不出（这正是 S5 要防的原始 bug）
 *   noFloat   L3 基座贴地 ⇒ "浮空"这条细节没了，三阶只剩"变大"
 *   noRune    L2 去掉符文 ⇒ 三阶的中间档没有自己的识别点
 *   noSpire   L2/L3 去掉尖顶 ⇒ 方塔/尖顶两档的轮廓差消失
 */
export interface GuildArtBreaks {
  flat: boolean;
  noFloat: boolean;
  noRune: boolean;
  noSpire: boolean;
}

let breaks: GuildArtBreaks = { flat: false, noFloat: false, noRune: false, noSpire: false };

export function setGuildArtBreaks(o: Partial<GuildArtBreaks>): void {
  breaks = { ...breaks, ...o };
}

export function getGuildArtBreaks(): GuildArtBreaks {
  return { ...breaks };
}

/** 卡片要显示哪一档：三个行会建筑各自固定一档（不是"城镇当前等级"）。 */
export function guildArtTierOf(buildingId: string): number {
  if (buildingId === 'guild3') return 3;
  if (buildingId === 'guild2') return 2;
  return 1;
}

/** 图集帧名：`bard_<owner>_<tier>`（bard = 魔法塔，避免与 town_/castle_ 撞前缀）。 */
export function guildArtName(owner: string, tier: number): string {
  return `bard_${owner}_${Math.max(1, Math.min(3, tier | 0))}`;
}

/* ---------------------------------------------------------------- 几何 */

/**
 * 三档的**唯一**几何表。改画法只改这里；闸门读的是建出来的像素，
 * 所以这张表既能驱动画，也能被人对着读数复核。
 *
 * `BASE_TOP` = 40：地面线，留 3px 给描边（成品外扩 1px 后仍在 44×44 内）。
 * L3 的塔身在 31 收底，**32~36 五行整行透空**，37~40 才是悬浮基座 ——
 * "浮空"这条细节靠的是透空行，不是靠把基座画小（那只会读成"底座换了颜色"）。
 */
const BASE_TOP = 40;
const CX = 21.5;

const SHAPE = {
  1: { yTop: 18, wTop: 13, wBot: 16, apex: 0, lift: 0 },
  2: { yTop: 14, wTop: 18, wBot: 22, apex: 8, lift: 0 },
  3: { yTop: 9, wTop: 24, wBot: 28, apex: 8, lift: 5 },
} as const;

/** 塔身收底的行号：L3 抬起来 5 行给悬浮基座让位（`noFloat` 时贴回去 = 负向对照）。 */
function yBotOf(tier: 1 | 2 | 3): number {
  if (tier !== 3) return BASE_TOP;
  return BASE_TOP - 4 - (breaks.noFloat ? 0 : SHAPE[3].lift);
}

/** 塔身每一行的左右边界（写入与环带避让共用）。 */
function spanAt(tier: 1 | 2 | 3, y: number): [number, number] {
  const s = SHAPE[tier];
  const yb = yBotOf(tier);
  const t = (y - s.yTop) / Math.max(1, yb - s.yTop);
  const w = Math.round(s.wTop + (s.wBot - s.wTop) * t);
  const x0 = Math.round(CX - w / 2);
  return [x0, x0 + w - 1];
}

function body(pb: PixBuf, tier: 1 | 2 | 3, pal: GuildPalette): void {
  const s = SHAPE[tier];
  const yb = yBotOf(tier);
  for (let y = s.yTop; y <= yb; y++) {
    const [x0, x1] = spanAt(tier, y);
    pb.hline(x0, x1, y, pal.wall);
    pb.set(x0, y, pal.wallLite);
    pb.set(x1, y, pal.wallDark);
  }
  /* 平顶（L1）或檐口（L2/L3）：一条深色横线把"屋顶/塔身"分开。
     不画城齿 —— 城齿是兵营的母题（§2.4 兵营链），塔要的是"一层压一层"。 */
  const [t0, t1] = spanAt(tier, s.yTop);
  pb.hline(t0 - 1, t1 + 1, s.yTop, pal.wallDark);
  pb.hline(t0, t1, s.yTop - 1, pal.wallLite);
}

function spire(pb: PixBuf, tier: 2 | 3, pal: GuildPalette): void {
  if (breaks.noSpire) return;
  const s = SHAPE[tier];
  const apex = s.yTop - s.apex;
  const half = Math.round((s.wTop + 2) / 2);
  pb.tri([Math.round(CX), apex], [Math.round(CX) - half, s.yTop - 1], [Math.round(CX) + half, s.yTop - 1], pal.roof);
  /* 右半边压暗：小尺寸下"三角"只靠轮廓不够，得有一个方向性的明暗面。 */
  pb.tri([Math.round(CX), apex], [Math.round(CX), s.yTop - 1], [Math.round(CX) + half, s.yTop - 1], pal.roofDark);
}

function door(pb: PixBuf, tier: 1 | 2 | 3, pal: GuildPalette): void {
  const yb = yBotOf(tier);
  const w = tier === 3 ? 9 : tier === 2 ? 8 : 7;
  const h = tier === 3 ? 10 : tier === 2 ? 9 : 8;
  const x = Math.round(CX - w / 2);
  const y = yb - h + 1;
  pb.rect(x, y + 1, w, h - 1, pal.wood);
  /* 拱：上面两行逐级收窄，1px 台阶就够了（44px 尺度下"圆拱"只能这么写） */
  pb.rect(x + 1, y, w - 2, 1, pal.wood);
  pb.rect(x + 2, y - 1, w - 4, 1, pal.wood);
  pb.frame(x, y + 1, w, h - 1, pal.woodDark);
  pb.vline(x + (w >> 1), y + 2, yb, pal.woodDark);
}

function windowSlit(pb: PixBuf, tier: 1 | 2 | 3, pal: GuildPalette): void {
  const y = tier === 1 ? 23 : tier === 2 ? 21 : 14;
  const [x0, x1] = spanAt(tier, y);
  const cx = Math.round((x0 + x1) / 2);
  pb.rect(cx - 1, y, 3, 4, pal.woodDark);
  pb.rect(cx, y + 1, 1, 2, pal.glow);
}

/** L2：两枚离体的符文（必须离塔身 ≥4px，否则 1px 描边会把它们焊在塔上）。 */
function runes(pb: PixBuf, tier: 2, pal: GuildPalette): void {
  if (breaks.noRune) return;
  const [l, r] = spanAt(tier, 22);
  /* 菱形而不是方块：3×3 的方块在这套美术里已经是"窗/砖"的母题，
     转 45° 之后才是"悬浮的符文"（形状差异比颜色差异在小尺寸下更可靠）。 */
  const put = (x: number, y: number): void => {
    pb.set(x + 1, y, pal.glow);
    pb.set(x, y + 1, pal.glow);
    pb.set(x + 1, y + 1, '#ffffff');
    pb.set(x + 2, y + 1, pal.glow);
    pb.set(x + 1, y + 2, pal.glow);
  };
  put(l - 7, 20);
  put(r + 5, 17);
}

/** L3：悬浮基座（塔身与它之间**整行透空**；`noFloat` 时塔身贴回地面 = 负向对照）。 */
function base(pb: PixBuf, pal: GuildPalette): void {
  const top = 37; // 37..41：五行，底沿离框底留 2px 给描边
  chamferRect(pb, Math.round(CX) - 15, top, 30, 5, 1, pal.wallDark);
  pb.hline(Math.round(CX) - 14, Math.round(CX) + 14, top, pal.wall);
  pb.hline(Math.round(CX) - 11, Math.round(CX) + 11, top + 1, pal.wallDark);
}

/**
 * L3：环带（§6.3「+环」）—— **一整圈闭合的椭圆**，穿过塔身前侧。
 *
 * 四版实拍换来的结论（44px 的极限就在这里）：
 *   ① 只画塔身外的两段弧 → 读成一对括号；
 *   ② 横平带 → 读成一块横板；
 *   ③ 中间低两头上翘 → 读成下垂的绳子；
 *   ④ 外端尖、内端厚 → 读成两只箭头。
 * 只有**闭合椭圆**在 44px 下还能读出"圈"：环在塔前，挡住墙面是它对的地方。
 * 环的左右两端必须各外伸 ≥4px（`[G4]` 就量这个），否则整圈都会被塔身吃掉。
 */
function ring(pb: PixBuf, pal: GuildPalette): void {
  const cy = 19;
  const rx = 17;
  const ry = 6;
  const cx = Math.round(CX);
  /* 按角度走一圈，而不是分别按 x/y 两遍解方程：两遍解法会在左右两端各画出一个
     "小环"（同一段弧被 x 扫描和 y 扫描各画一次，坐标在小数处错开）—— 实拍是两枚耳环。 */
  const steps = 160;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const px = cx + Math.round(rx * Math.cos(a));
    const py = cy + Math.round(ry * Math.sin(a));
    /* 两行厚：1px 的闭合曲线被 1px 墨环包住之后，在最左/最右的切点会
       剩下一个**空心小眼**（实拍像两只耳环）。补一行让它成为实心带。 */
    pb.set(px, py, pal.glow);
    pb.set(px, py + 1, pal.glow);
  }
}

/**
 * 建一帧。**顺序有意义**：塔身 → 檐口 → 尖顶 → 门/窗 → 基座 → 环 → 符文，
 * 最后统一描边（`outline` 只在外沿加一圈墨，内部接缝靠颜色差，不靠墨）。
 */
export function buildGuildArt(owner: SpriteOwner, tier: number, outlinePx = 1): PixBuf {
  const t = (breaks.flat ? 1 : Math.max(1, Math.min(3, tier | 0))) as 1 | 2 | 3;
  const pal = guildPaletteOf(owner);
  const pb = new PixBuf(GUILD_ART_SIZE, GUILD_ART_SIZE);

  body(pb, t, pal);
  if (t !== 1) spire(pb, t, pal);
  door(pb, t, pal);
  windowSlit(pb, t, pal);
  if (t === 2) runes(pb, t, pal);
  if (t === 3) base(pb, pal);
  if (outlinePx > 0) pb.outline(shade(pal.wallDark, -0.55), 1);
  /* 环**画在描边之后**：44px 下它必然贴着塔身（rx 再大就出框），
     一旦走描边就会被墨线焊进墙里，左右各留一团黑疙瘩。魔法环是光，不是构件。 */
  if (t === 3) ring(pb, pal);
  return pb;
}
