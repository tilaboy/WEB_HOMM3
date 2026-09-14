/**
 * HOMM2 风格精灵图集。
 *
 * 所有图形在启动时一次性画进一张离屏画布，之后渲染层只做 drawImage。
 * 好处：① 逐像素的"手绘感"只付一次代价；② 放大时关掉插值就是硬边像素风；
 * ③ core/ 完全不知道美术的存在，跟之前程序化绘制一样保持零耦合。
 */
import { PixBuf, fbm, hash2, mix, pnoise, shade } from './pixel.js';
import { FACTIONS, NEUTRAL_COLOR, NEUTRAL_DARK } from '../core/data/factions.js';

export const TILE = 32;

/**
 * 2×2 城堡精灵相对**左上角那一格**的绘制偏移。
 *
 * 城堡占地 64×64，精灵 72×96：左右各外扩 4px，上边多出 32px 给塔楼和旗子，
 * 底边则严格对齐占地格的下沿 —— 这样英雄站在城门格上时，脚正好落在城墙根。
 */
export const CASTLE_AX = -4;
export const CASTLE_AY = -32;

/** 需要单独出贴图的阵营（3 个电脑对手 + 无主），键名直接拼进 sprite 名。 */
export const SPRITE_OWNERS = ['p1', 'p2', 'p3', 'p4', 'neutral'] as const;
export type SpriteOwner = (typeof SPRITE_OWNERS)[number];

/** 阵营配色 → 城镇屋顶/墙体、英雄披风的像素色。 */
export function ownerPalette(owner: SpriteOwner): { roof: string; wall: string } {
  if (owner === 'neutral') {
    return { roof: NEUTRAL_COLOR, wall: '#a89f8c' };
  }
  const def = FACTIONS[owner];
  return { roof: def.color, wall: def.id === 'p1' ? '#d5ccb6' : shade('#d5ccb6', -0.12) };
}

/** 中立旗帜的暗色面，供 UI 复用。 */
export const NEUTRAL_DARK_COLOR = NEUTRAL_DARK;

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 相对格子左上角的绘制偏移。 */
  ax: number;
  ay: number;
}

const RAMP: Record<string, string[]> = {
  grass: ['#3f6b2a', '#4c7f33', '#5a9440', '#69a84c', '#79bd5a'],
  dirt: ['#7a5a34', '#8d6a3e', '#a17b49', '#b58d56', '#c9a065'],
  sand: ['#c2a469', '#d0b378', '#dec48a', '#ecd59d', '#f6e4b4'],
  snow: ['#b9c6d4', '#cbd6e1', '#dde5ee', '#eef3f8', '#fafcfd'],
  swamp: ['#3d4a2a', '#4a5934', '#586a3f', '#6b7d50', '#7d9063'],
  rock: ['#5f5b56', '#736e68', '#87817a', '#9b958d', '#aea8a0'],
  water: ['#1c4f80', '#245f94', '#2d70a8', '#3a81ba', '#4a93cc'],
};

const TERRAIN_KINDS = ['grass', 'dirt', 'sand', 'snow', 'swamp', 'rock', 'water'] as const;
type Kind = (typeof TERRAIN_KINDS)[number];

/* ---------------- 地形 ---------------- */

function rampPick(ramp: string[], t: number): string {
  const i = Math.max(0, Math.min(ramp.length - 1, Math.floor(t * ramp.length)));
  return ramp[i];
}

function terrainTile(kind: Kind, variant: number, phase = 0): PixBuf {
  const pb = new PixBuf(TILE, TILE);
  const ramp = RAMP[kind];
  const seed = variant * 7919 + kind.length * 131;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const n = fbm((x * 8) / TILE + phase, (y * 8) / TILE, 8, seed);
      // 水面收窄色域：大片水域要"平"，起伏交给波浪高光，否则会花
      pb.set(x, y, kind === 'water' ? rampPick(ramp, 0.35 + n * 0.3) : rampPick(ramp, n));
    }
  }

  const dark = shade(ramp[1], -0.45);
  const light = shade(ramp[3], 0.35);

  switch (kind) {
    case 'grass': {
      for (let i = 0; i < 14; i++) {
        const x = Math.floor(hash2(i, 11, seed) * TILE);
        const y = Math.floor(hash2(i, 23, seed) * TILE);
        pb.set(x, y, dark);
        pb.set(x - 1, y - 1, dark);
        pb.set(x + 1, y - 1, shade(dark, 0.25));
      }
      for (let i = 0; i < 5; i++) {
        const x = Math.floor(hash2(i, 37, seed) * TILE);
        const y = Math.floor(hash2(i, 41, seed) * TILE);
        pb.set(x, y, light);
      }
      break;
    }
    case 'dirt': {
      for (let i = 0; i < 16; i++) {
        const x = Math.floor(hash2(i, 13, seed) * (TILE - 2)) + 1;
        const y = Math.floor(hash2(i, 29, seed) * (TILE - 2)) + 1;
        pb.set(x, y, light);
        pb.set(x, y + 1, dark, 0.6);
      }
      for (let i = 0; i < 3; i++) {
        const x = Math.floor(hash2(i, 53, seed) * (TILE - 8)) + 4;
        const y = Math.floor(hash2(i, 59, seed) * (TILE - 6)) + 3;
        pb.line(x, y, x + 5, y + 2, dark, 0.5);
      }
      break;
    }
    case 'sand': {
      for (let i = 0; i < 6; i++) {
        const y = Math.floor(hash2(i, 17, seed) * TILE);
        const x = Math.floor(hash2(i, 19, seed) * 12);
        const len = 8 + Math.floor(hash2(i, 31, seed) * 14);
        for (let k = 0; k < len; k++) {
          const yy = y + Math.round(Math.sin((x + k) * 0.45) * 1.2);
          pb.set(x + k, yy, light, 0.7);
        }
      }
      for (let i = 0; i < 10; i++) {
        const x = Math.floor(hash2(i, 61, seed) * TILE);
        const y = Math.floor(hash2(i, 67, seed) * TILE);
        pb.set(x, y, dark, 0.5);
      }
      break;
    }
    case 'snow': {
      for (let i = 0; i < 18; i++) {
        const x = Math.floor(hash2(i, 71, seed) * TILE);
        const y = Math.floor(hash2(i, 73, seed) * TILE);
        pb.set(x, y, '#ffffff', 0.9);
      }
      for (let i = 0; i < 3; i++) {
        const y = Math.floor(hash2(i, 79, seed) * TILE);
        for (let x = 0; x < TILE; x++) {
          const yy = y + Math.round(Math.sin(x * 0.3 + i) * 1.5);
          pb.set(x, yy, shade(ramp[0], -0.2), 0.35);
        }
      }
      break;
    }
    case 'swamp': {
      for (let i = 0; i < 4; i++) {
        const cx = Math.floor(hash2(i, 83, seed) * (TILE - 8)) + 4;
        const cy = Math.floor(hash2(i, 89, seed) * (TILE - 8)) + 4;
        const r = 3 + Math.floor(hash2(i, 97, seed) * 3);
        pb.ellipse(cx, cy, r, r * 0.6, '#2f4030', 0.85);
        pb.ellipse(cx, cy - 1, r - 1, (r - 1) * 0.5, '#5c7a52', 0.5);
      }
      for (let i = 0; i < 12; i++) {
        const x = Math.floor(hash2(i, 101, seed) * TILE);
        const y = Math.floor(hash2(i, 103, seed) * TILE);
        pb.set(x, y, '#8f9a5a');
        pb.set(x, y - 1, '#8f9a5a');
        pb.set(x, y - 2, '#6f7d45');
      }
      break;
    }
    case 'rock': {
      for (let i = 0; i < 4; i++) {
        const x = Math.floor(hash2(i, 107, seed) * (TILE - 10)) + 5;
        const y = Math.floor(hash2(i, 109, seed) * (TILE - 10)) + 5;
        const len = 4 + Math.floor(hash2(i, 113, seed) * 6);
        pb.line(x, y, x + len, y + Math.floor(hash2(i, 127, seed) * 3) - 1, dark, 0.75);
      }
      for (let i = 0; i < 22; i++) {
        const x = Math.floor(hash2(i, 131, seed) * TILE);
        const y = Math.floor(hash2(i, 137, seed) * TILE);
        pb.set(x, y, light, 0.55);
      }
      break;
    }
    case 'water': {
      for (let i = 0; i < 7; i++) {
        const y = Math.floor(hash2(i, 139, seed) * TILE);
        const x = Math.floor(hash2(i, 149, seed) * 20);
        const len = 6 + Math.floor(hash2(i, 151, seed) * 8);
        for (let k = 0; k < len; k++) {
          const yy = (y + phase * 2 + Math.round(Math.sin((x + k + phase) * 0.7) * 1.4)) % TILE;
          pb.set(x + k, yy, '#9ed0ee', 0.55);
          pb.set(x + k, yy + 1, '#6fb0d8', 0.3);
        }
      }
      break;
    }
  }
  return pb;
}

/** 海岸/岸线过渡：沿某条边铺一条带波浪内缘的沙地。 */
function shoreTile(dir: string): PixBuf {
  const pb = new PixBuf(TILE, TILE);
  const ramp = RAMP.sand;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let d: number;
      switch (dir) {
        case 'n': d = y; break;
        case 's': d = TILE - 1 - y; break;
        case 'w': d = x; break;
        case 'e': d = TILE - 1 - x; break;
        case 'nw': d = Math.hypot(x, y); break;
        case 'ne': d = Math.hypot(TILE - 1 - x, y); break;
        case 'sw': d = Math.hypot(x, TILE - 1 - y); break;
        default: d = Math.hypot(TILE - 1 - x, TILE - 1 - y); break;
      }
      const w = 5 + pnoise((x * 6) / TILE, (y * 6) / TILE, 6, 4242) * 4;
      if (d < w) {
        const n = fbm((x * 8) / TILE, (y * 8) / TILE, 8, 313);
        const c = d < w - 2 ? rampPick(ramp, n) : mix(rampPick(ramp, n), '#eaf4fb', 0.45);
        pb.set(x, y, c, d < w - 1 ? 1 : 0.85);
      }
    }
  }
  return pb;
}

/* ---------------- 物件 ---------------- */

const OUTLINE = '#241a10';

function shadow(pb: PixBuf, cx: number, y: number, rx: number, ry: number): void {
  pb.ellipse(cx, y, rx, ry, '#000000', 0.22);
}

function tree(pb: PixBuf, pine: boolean): void {
  const H = 40;
  pb.rect(14, 26, 4, 12, '#6b4a2a');
  pb.rect(14, 26, 1, 12, '#8a6240');
  pb.rect(17, 26, 1, 12, '#4a3320');
  if (pine) {
    for (let i = 0; i < 3; i++) {
      const top = 4 + i * 8;
      const half = 6 + i * 4;
      pb.tri([16, top], [16 - half, top + 14], [16 + half, top + 14], i === 2 ? '#2f5a24' : '#38682b');
      pb.tri([16, top], [16 - half, top + 14], [16, top + 14], '#4a8438', 0.55);
    }
  } else {
    pb.ellipse(16, 16, 12, 12, '#38682b');
    pb.ellipse(16, 14, 10, 9, '#4a8438');
    pb.ellipse(12, 10, 5, 4, '#66a84a', 0.85);
    pb.ellipse(21, 20, 4, 3, '#2b501f', 0.7);
  }
  pb.outline(OUTLINE);
  shadow(pb, 16, H - 2, 8, 2.5);
}

function rock(pb: PixBuf): void {
  pb.poly(
    [[6, 30], [3, 24], [6, 18], [12, 13], [20, 11], [27, 16], [30, 24], [27, 30]],
    '#8a857e',
  );
  pb.poly([[6, 30], [3, 24], [6, 18], [12, 13], [16, 14], [14, 30]], '#a49e96');
  pb.poly([[20, 11], [27, 16], [30, 24], [27, 30], [16, 30], [16, 14]], '#6b6760');
  pb.line(9, 22, 15, 25, '#5b574f', 0.8);
  pb.line(21, 19, 25, 26, '#5b574f', 0.8);
  pb.outline(OUTLINE);
  shadow(pb, 16, 31, 12, 2.5);
}

function mountain(pb: PixBuf): void {
  pb.tri([16, 2], [1, 42], [31, 42], '#8a857e');
  pb.tri([16, 2], [1, 42], [16, 42], '#a49e96');
  pb.tri([16, 2], [8, 16], [16, 20], '#f2f6f9');
  pb.tri([16, 2], [24, 15], [17, 19], '#dbe4ec');
  pb.tri([16, 2], [12, 12], [20, 12], '#ffffff', 0.9);
  pb.line(16, 22, 12, 32, '#5b574f', 0.7);
  pb.line(16, 22, 22, 34, '#5b574f', 0.7);
  pb.outline(OUTLINE);
  shadow(pb, 16, 43, 14, 3);
}

function chest(pb: PixBuf): void {
  pb.rect(6, 14, 20, 15, '#7a4f2a');
  pb.rect(6, 14, 20, 3, '#9a6a3c');
  pb.rect(6, 26, 20, 3, '#5a381d');
  pb.poly([[6, 14], [26, 14], [24, 8], [8, 8]], '#8a5c33');
  pb.rect(8, 11, 16, 2, '#c9a227');
  pb.rect(14, 16, 4, 6, '#c9a227');
  pb.set(16, 19, '#3a2a12');
  pb.outline(OUTLINE);
  shadow(pb, 16, 30, 10, 2.5);
}

function fountain(pb: PixBuf): void {
  pb.ellipse(16, 26, 13, 7, '#9a958c');
  pb.ellipse(16, 25, 10, 5, '#4aa3d8');
  pb.ellipse(16, 24, 7, 3, '#8fd3f0', 0.8);
  pb.rect(14, 12, 4, 12, '#b0aaa0');
  pb.ellipse(16, 11, 6, 4, '#9a958c');
  pb.ellipse(16, 10, 4, 2.5, '#4aa3d8');
  for (const [dx, dy] of [[-6, -4], [6, -4], [0, -8]] as [number, number][]) {
    pb.set(16 + dx, 10 + dy, '#8fd3f0', 0.9);
  }
  pb.outline(OUTLINE);
  shadow(pb, 16, 33, 12, 2.5);
}

function artifact(pb: PixBuf): void {
  pb.ellipse(16, 26, 9, 4, '#8a8578');
  pb.rect(12, 18, 8, 8, '#a09a8c');
  pb.poly([[16, 4], [22, 12], [16, 20], [10, 12]], '#c0409a');
  pb.poly([[16, 4], [22, 12], [16, 20]], '#8a2a6a', 0.8);
  pb.poly([[16, 6], [19, 12], [16, 17], [13, 12]], '#f0a8d8', 0.7);
  pb.set(16, 3, '#ffe8f6');
  pb.set(8, 9, '#ffe8f6', 0.8);
  pb.set(24, 9, '#ffe8f6', 0.8);
  pb.outline(OUTLINE);
  shadow(pb, 16, 29, 9, 2);
}

function resGold(pb: PixBuf): void {
  for (let i = 0; i < 22; i++) {
    const x = 6 + Math.floor(hash2(i, 3, 11) * 20);
    const y = 14 + Math.floor(hash2(i, 7, 11) * 12);
    pb.ellipse(x, y, 3, 2, '#e0b62a');
    pb.ellipse(x, y - 1, 2, 1, '#f6dc70', 0.9);
    pb.set(x + 2, y + 1, '#a8801a', 0.6);
  }
  pb.outline(OUTLINE);
  shadow(pb, 16, 28, 11, 2.5);
}

function resWood(pb: PixBuf): void {
  for (let i = 0; i < 3; i++) {
    const y = 14 + i * 6;
    const x = 4 + (i % 2) * 3;
    pb.rect(x, y, 24, 5, '#8a5f34');
    pb.rect(x, y, 24, 1, '#a87a48');
    pb.rect(x, y + 4, 24, 1, '#5f4022');
    pb.ellipse(x + 23, y + 2, 2, 2.5, '#c49a63');
    pb.ellipse(x + 23, y + 2, 1, 1.5, '#8a5f34');
  }
  pb.outline(OUTLINE);
  shadow(pb, 16, 29, 12, 2.5);
}

function resOre(pb: PixBuf): void {
  const blobs: [number, number, number][] = [[11, 22, 6], [20, 20, 5], [16, 15, 4]];
  for (const [cx, cy, r] of blobs) {
    pb.ellipse(cx, cy, r, r * 0.8, '#8a857e');
    pb.ellipse(cx - 1, cy - 1, r - 2, (r - 2) * 0.7, '#a9a49b');
    pb.ellipse(cx + 1, cy + 1, r - 2, (r - 2) * 0.6, '#635f58', 0.7);
  }
  pb.outline(OUTLINE);
  shadow(pb, 16, 28, 11, 2.5);
}

function mine(pb: PixBuf, kind: 'gold' | 'wood' | 'ore'): void {
  const ore = kind === 'gold' ? '#e0b62a' : kind === 'wood' ? '#8a5f34' : '#8a857e';
  pb.poly([[2, 38], [6, 20], [16, 12], [26, 20], [30, 38]], '#5a5148');
  pb.poly([[2, 38], [6, 20], [16, 12], [16, 38]], '#6e6459');
  pb.poly([[16, 38], [16, 30], [26, 38]], '#241a10');
  pb.poly([[9, 38], [9, 26], [14, 22], [18, 26], [18, 38]], '#3a2a18');
  pb.rect(6, 20, 3, 18, '#7a5f34');
  pb.rect(23, 20, 3, 18, '#7a5f34');
  pb.rect(6, 18, 20, 3, '#8a6b3c');
  pb.ellipse(24, 35, 5, 3, ore);
  pb.ellipse(23, 34, 3, 2, shade(ore, 0.35), 0.9);
  pb.outline(OUTLINE);
  shadow(pb, 16, 39, 13, 2.5);
}

function town(pb: PixBuf, roof: string, wall: string, tier: number): void {
  const W = 40;
  const H = 52;
  const wallDark = shade(wall, -0.35);
  const wallLite = shade(wall, 0.2);

  const wallY = 34;
  pb.rect(4, wallY, W - 8, 14, wall);
  pb.rect(4, wallY, 12, 14, wallLite);
  pb.rect(W - 16, wallY, 12, 14, wallDark);
  for (let x = 4; x < W - 4; x += 4) pb.rect(x, wallY - 3, 2, 3, wall);
  pb.rect(4, wallY + 12, W - 8, 2, wallDark);

  const towers: number[] = tier >= 1 ? [2, W - 12] : [W - 14];
  for (const tx of towers) {
    pb.rect(tx, 18, 12, 30, wall);
    pb.rect(tx, 18, 4, 30, wallLite);
    pb.rect(tx + 8, 18, 4, 30, wallDark);
    for (let x = tx; x < tx + 12; x += 4) pb.rect(x, 15, 2, 3, wall);
    pb.tri([tx + 6, 15], [tx, 4], [tx + 12, 4], roof);
    pb.tri([tx + 6, 15], [tx + 6, 4], [tx + 12, 4], shade(roof, -0.28));
    pb.rect(tx + 4, 24, 4, 5, '#3a2a18');
  }

  if (tier >= 2) {
    const kx = 13;
    const ky = tier >= 3 ? 8 : 14;
    pb.rect(kx, ky, 14, H - ky - 4, wall);
    pb.rect(kx, ky, 5, H - ky - 4, wallLite);
    pb.rect(kx + 9, ky, 5, H - ky - 4, wallDark);
    for (let x = kx; x < kx + 14; x += 4) pb.rect(x, ky - 3, 2, 3, wall);
    pb.tri([kx + 7, ky - 3], [kx - 2, ky - 14], [kx + 16, ky - 14], roof);
    pb.tri([kx + 7, ky - 3], [kx + 7, ky - 14], [kx + 16, ky - 14], shade(roof, -0.28));
    pb.rect(kx + 5, ky + 6, 4, 5, '#3a2a18');
    pb.vline(kx + 7, ky - 26, ky - 14, '#5a4326');
    pb.tri([kx + 7, ky - 26], [kx + 18, ky - 23], [kx + 7, ky - 19], roof);
  }

  pb.poly([[16, H - 4], [16, 42], [20, 38], [24, 42], [24, H - 4]], '#3a2a18');
  pb.rect(7, 40, 3, 4, '#3a2a18');
  pb.rect(30, 40, 3, 4, '#3a2a18');
  pb.outline(OUTLINE);
  shadow(pb, W / 2, H - 3, 17, 3);
}

/**
 * 2×2 城堡。精灵画成 72×88，落到地上时正好铺满两格宽、两格高（见 render 里的锚点）。
 * 城门永远在**左下角**那一格，也就是正面朝南 —— 城堡背面与右侧都是实墙，
 * 所以"只能从正面进"这件事在美术上是看得见的，不是靠代码硬掰。
 */
function castle(pb: PixBuf, roof: string, wall: string, tier: number): void {
  const W = 72;
  const H = 96;
  const wallDark = shade(wall, -0.35);
  const wallLite = shade(wall, 0.2);
  const roofDark = shade(roof, -0.28);
  const hollow = '#1a1208';

  const keepTop = tier >= 1 ? 30 : 36;
  const towerTop = tier >= 2 ? 36 : 40;
  /** 主体下沿：城墙从这里开始往下铺 */
  const bodyBase = 74;

  /* 屋顶上的旗：先画，屋脊会把旗杆下半段盖住，看着才像插在塔尖上 */
  pb.vline(36, 5, keepTop - 4, '#5a4326');
  pb.tri([36, 5], [50, 10], [36, 15], roof);

  /* 中央主楼：比角塔更高更宽，撑住整个剪影 */
  pb.rect(22, keepTop, 28, bodyBase - keepTop, wall);
  pb.rect(22, keepTop, 7, bodyBase - keepTop, wallLite);
  pb.rect(43, keepTop, 7, bodyBase - keepTop, wallDark);
  for (let x = 22; x < 50; x += 5) pb.rect(x, keepTop - 4, 3, 4, wall);
  pb.tri([36, keepTop - 4], [18, keepTop - 22], [54, keepTop - 22], roof);
  pb.tri([36, keepTop - 4], [36, keepTop - 22], [54, keepTop - 22], roofDark);
  pb.rect(32, keepTop + 14, 8, 14, hollow);

  /* 两座角塔 */
  for (const tx of [2, 52]) {
    pb.rect(tx, towerTop, 18, bodyBase - towerTop, wall);
    pb.rect(tx, towerTop, 5, bodyBase - towerTop, wallLite);
    pb.rect(tx + 13, towerTop, 5, bodyBase - towerTop, wallDark);
    for (let x = tx; x < tx + 18; x += 5) pb.rect(x, towerTop - 4, 3, 4, wall);
    pb.tri([tx + 9, towerTop - 4], [tx - 2, towerTop - 18], [tx + 20, towerTop - 18], roof);
    pb.tri([tx + 9, towerTop - 4], [tx + 9, towerTop - 18], [tx + 20, towerTop - 18], roofDark);
    pb.rect(tx + 7, towerTop + 12, 5, 9, hollow);
  }

  /* 正面城墙：横跨整整两格，也是唯一敞开的一面 */
  pb.rect(4, 68, W - 8, 20, wall);
  pb.rect(4, 68, 16, 20, wallLite);
  pb.rect(52, 68, 16, 20, wallDark);
  for (let x = 4; x < W - 6; x += 5) pb.rect(x, 64, 3, 4, wall);
  pb.rect(2, 88, W - 4, 8, wallDark);
  pb.rect(4, 87, W - 8, 2, shade(wall, -0.5));

  /* 城门：左下角那格的正中，正面唯一能站人的位置 */
  pb.poly([[14, H], [14, 85], [17, 77], [23, 77], [26, 85], [26, H]], hollow);
  pb.rect(15, 91, 10, 5, '#4a3524');
  pb.rect(11, 76, 4, 20, wallDark);
  pb.rect(25, 76, 4, 20, wallDark);
  pb.rect(12, 72, 17, 3, roof); // 城门上的小檐
  pb.rect(12, 75, 17, 1, roofDark);

  pb.outline(OUTLINE);
  shadow(pb, W / 2, H - 3, 30, 4);
}

function hero(pb: PixBuf, cloth: string): void {
  pb.rect(13, 32, 3, 8, '#4a3524');
  pb.rect(18, 32, 3, 8, '#4a3524');
  pb.poly([[11, 21], [21, 21], [23, 33], [9, 33]], cloth);
  pb.poly([[11, 21], [16, 21], [16, 33], [9, 33]], shade(cloth, 0.25));
  pb.rect(9, 22, 2, 7, '#e0b98a');
  pb.rect(21, 22, 2, 7, '#e0b98a');
  pb.ellipse(16, 17, 4, 4, '#e8b48a');
  pb.ellipse(16, 15, 5, 4, '#b9c3cc');
  pb.rect(11, 15, 10, 1, '#8f9aa4');
  pb.tri([16, 9], [13, 13], [19, 13], '#c9a227');
  pb.rect(24, 8, 1, 30, '#6b4a2a');
  pb.tri([25, 9], [36, 13], [25, 18], cloth);
  pb.tri([25, 9], [36, 13], [25, 14], shade(cloth, -0.25));
  pb.outline(OUTLINE);
  shadow(pb, 16, 41, 8, 2);
}

function wolf(pb: PixBuf): void {
  pb.ellipse(14, 15, 10, 6, '#5a5f66');
  pb.ellipse(12, 13, 8, 4, '#6e747c', 0.8);
  pb.ellipse(24, 12, 5, 4, '#63696f');
  pb.poly([[21, 9], [22, 4], [24, 9]], '#4a4f56');
  pb.poly([[26, 9], [27, 4], [29, 10]], '#4a4f56');
  pb.rect(27, 12, 4, 2, '#3a3f45');
  pb.set(29, 13, '#1a1a1a');
  pb.set(25, 11, '#d04a4a');
  pb.rect(8, 20, 2, 7, '#43484e');
  pb.rect(12, 20, 2, 7, '#4e545b');
  pb.rect(18, 20, 2, 7, '#4e545b');
  pb.rect(22, 20, 2, 7, '#43484e');
  pb.line(4, 13, 0, 7, '#4a4f56');
  pb.line(4, 14, 0, 9, '#4a4f56');
  pb.outline(OUTLINE);
  shadow(pb, 15, 27, 10, 2);
}

function boar(pb: PixBuf): void {
  pb.ellipse(14, 16, 11, 7, '#6b4a30');
  pb.ellipse(12, 14, 8, 5, '#825c3c', 0.85);
  pb.ellipse(25, 15, 5, 4.5, '#5a3d26');
  pb.rect(28, 15, 4, 3, '#7a5537');
  pb.set(31, 17, '#2a1c10');
  pb.set(30, 16, '#e8e0c8');
  pb.set(30, 18, '#e8e0c8');
  pb.set(26, 13, '#d04a4a');
  for (let i = 0; i < 6; i++) pb.line(8 + i * 2, 11, 9 + i * 2, 8, '#3d2a1a', 0.8);
  pb.rect(9, 22, 3, 6, '#4a3320');
  pb.rect(14, 22, 3, 6, '#573c26');
  pb.rect(19, 22, 3, 6, '#573c26');
  pb.rect(24, 22, 3, 6, '#4a3320');
  pb.outline(OUTLINE);
  shadow(pb, 15, 28, 11, 2);
}

function ogre(pb: PixBuf): void {
  pb.rect(11, 32, 4, 9, '#4a5f30');
  pb.rect(18, 32, 4, 9, '#3f5228');
  pb.poly([[9, 14], [23, 14], [26, 34], [6, 34]], '#6f8f4a');
  pb.poly([[9, 14], [16, 14], [16, 34], [6, 34]], '#83a659', 0.85);
  pb.rect(8, 18, 3, 10, '#83a659');
  pb.rect(22, 16, 3, 12, '#5c7a3c');
  pb.ellipse(16, 10, 5, 5, '#7fa055');
  pb.set(14, 9, '#d04a4a');
  pb.set(18, 9, '#d04a4a');
  pb.rect(13, 13, 6, 1, '#3f5228');
  pb.rect(25, 8, 3, 14, '#7a5a34');
  pb.ellipse(26, 7, 4, 4, '#8a6a3c');
  pb.ellipse(26, 7, 2.5, 2.5, '#5f4426', 0.7);
  pb.outline(OUTLINE);
  shadow(pb, 16, 42, 11, 2.5);
}

function marker(pb: PixBuf, kind: 'gold' | 'res' | 'chest' | 'mine'): void {
  if (kind === 'gold') {
    pb.ellipse(8, 10, 6, 5, '#e8c23a');
    pb.ellipse(8, 9, 4, 3, '#f8e68a', 0.9);
    pb.set(8, 6, '#fff6c8');
  } else if (kind === 'res') {
    pb.rect(2, 9, 7, 4, '#8a5f34');
    pb.ellipse(11, 10, 3, 2.5, '#8a857e');
    pb.ellipse(5, 8, 3, 1.5, '#a87a48', 0.8);
  } else if (kind === 'chest') {
    pb.rect(3, 7, 11, 8, '#7a4f2a');
    pb.rect(3, 7, 11, 2, '#9a6a3c');
    pb.rect(7, 9, 3, 4, '#e8c23a');
  } else {
    pb.rect(7, 3, 2, 11, '#7a5a34');
    pb.poly([[3, 5], [13, 9], [3, 10]], '#b9c3cc');
    pb.poly([[3, 7], [9, 9], [3, 10]], '#8f9aa4', 0.8);
  }
  pb.outline('#241a10', 0.85);
}

/** 地表小装饰：不阻挡、不交互，纯为了让大地"活"起来（HOMM2 的地图从不满铺纯色）。 */
function decoration(pb: PixBuf, kind: number): void {
  switch (kind % 6) {
    case 0: {
      for (const [dx, c] of [[-2, '#d04a4a'], [0, '#f0d24a'], [2, '#e8e8f0']] as [number, string][]) {
        pb.set(8 + dx, 9, c);
        pb.set(8 + dx, 8, shade(c, 0.3), 0.7);
        pb.set(8 + dx, 10, '#3f6b2a');
      }
      break;
    }
    case 1: {
      pb.ellipse(8, 10, 5, 3, '#4a8438', 0.9);
      pb.set(6, 8, '#66a84a');
      pb.set(10, 9, '#66a84a');
      pb.set(8, 7, '#79bd5a');
      break;
    }
    case 2: {
      pb.ellipse(8, 11, 4, 3, '#9a958c');
      pb.ellipse(6, 10, 2, 1.5, '#b9b4aa');
      pb.set(11, 12, '#6b6760');
      break;
    }
    case 3: {
      pb.rect(7, 9, 3, 4, '#e8dcc8');
      pb.ellipse(8, 8, 3, 2, '#c04a3a');
      pb.set(7, 7, '#e07a5a');
      break;
    }
    case 4: {
      pb.line(5, 12, 5, 6, '#5c7a52');
      pb.line(8, 12, 8, 4, '#6f8a5e');
      pb.line(11, 12, 11, 7, '#5c7a52');
      pb.set(8, 3, '#8fa878');
      pb.set(5, 5, '#8fa878');
      break;
    }
    default: {
      pb.ellipse(8, 11, 6, 2, '#7d9063', 0.8);
      pb.set(5, 10, '#6b7d50');
      pb.set(11, 11, '#6b7d50');
    }
  }
  pb.outline('#241a10', 0.55);
}

function resIcon(pb: PixBuf, kind: string): void {
  const c: Record<string, string> = {
    gold: '#e8c23a', wood: '#8a5f34', ore: '#8a857e',
    gem: '#d05fa0', crystal: '#7ec8e3', sulfur: '#e0d24a', mercury: '#b8b8c4',
  };
  const col = c[kind] ?? '#8a857e';
  if (kind === 'gold') {
    pb.ellipse(9, 10, 7, 6, col);
    pb.ellipse(9, 9, 5, 4, shade(col, 0.35), 0.95);
    pb.ellipse(9, 11, 3, 2, shade(col, -0.2), 0.6);
  } else if (kind === 'wood') {
    pb.rect(2, 6, 14, 9, col);
    pb.rect(2, 6, 14, 2, shade(col, 0.3));
    pb.ellipse(14, 10, 2.5, 4, shade(col, 0.2));
    pb.ellipse(14, 10, 1.2, 2, shade(col, -0.3));
  } else if (kind === 'gem') {
    pb.poly([[9, 2], [15, 8], [9, 16], [3, 8]], col);
    pb.poly([[9, 2], [15, 8], [9, 16]], shade(col, -0.25), 0.85);
    pb.poly([[9, 5], [12, 8], [9, 12], [6, 8]], shade(col, 0.5), 0.7);
  } else if (kind === 'crystal') {
    pb.poly([[9, 2], [14, 9], [11, 16], [7, 16], [4, 9]], col);
    pb.poly([[9, 2], [14, 9], [11, 16]], shade(col, -0.2), 0.85);
    pb.poly([[9, 4], [11, 9], [9, 14]], shade(col, 0.45), 0.7);
  } else {
    pb.poly([[4, 13], [3, 8], [8, 4], [14, 6], [15, 12], [11, 15]], col);
    pb.poly([[4, 13], [3, 8], [8, 4], [9, 12]], shade(col, 0.28));
    pb.poly([[9, 12], [14, 6], [15, 12], [11, 15]], shade(col, -0.28), 0.85);
  }
  pb.outline('#3a2a18', 0.9);
}

/* ---------------- 打包 ---------------- */

class Packer {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private px = 0;
  private py = 0;
  private rowH = 0;

  constructor(w: number, h: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建图集画布');
    this.ctx = ctx;
  }

  place(pb: PixBuf, ax?: number, ay?: number): Frame {
    const c = pb.toCanvas();
    if (this.px + c.width > this.canvas.width) {
      this.px = 0;
      this.py += this.rowH + 2;
      this.rowH = 0;
    }
    this.ctx.drawImage(c, this.px, this.py);
    const f: Frame = {
      x: this.px,
      y: this.py,
      w: c.width,
      h: c.height,
      ax: ax ?? Math.round((TILE - c.width) / 2),
      ay: ay ?? TILE - c.height,
    };
    this.px += c.width + 2;
    this.rowH = Math.max(this.rowH, c.height);
    return f;
  }
}

export class Atlas {
  readonly canvas: HTMLCanvasElement;
  private frames = new Map<string, Frame>();
  private urls = new Map<string, string>();

  private constructor(packer: Packer) {
    this.canvas = packer.canvas;
  }

  get(name: string): Frame | null {
    return this.frames.get(name) ?? null;
  }

  need(name: string): Frame {
    const f = this.frames.get(name);
    if (!f) throw new Error(`缺少精灵帧：${name}`);
    return f;
  }

  has(name: string): boolean {
    return this.frames.has(name);
  }

  /** DOM 用：把单帧导出成 data URL，供 <img> 显示。 */
  url(name: string): string {
    const hit = this.urls.get(name);
    if (hit) return hit;
    const f = this.frames.get(name);
    if (!f) return '';
    const c = document.createElement('canvas');
    c.width = f.w;
    c.height = f.h;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(this.canvas, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    const u = c.toDataURL();
    this.urls.set(name, u);
    return u;
  }

  static build(): Atlas {
    const packer = new Packer(2048, 2048);
    const frames = new Map<string, Frame>();

    for (const kind of TERRAIN_KINDS) {
      if (kind === 'water') {
        for (let v = 0; v < 2; v++) {
          for (let p = 0; p < 4; p++) {
            frames.set(`g_water_${v}_${p}`, packer.place(terrainTile('water', v, p), 0, 0));
          }
        }
      } else {
        for (let v = 0; v < 3; v++) {
          frames.set(`g_${kind}_${v}`, packer.place(terrainTile(kind, v), 0, 0));
        }
      }
    }

    for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      frames.set(`sh_${d}`, packer.place(shoreTile(d), 0, 0));
    }

    const put = (name: string, pb: PixBuf, ax?: number, ay?: number): void => {
      frames.set(name, packer.place(pb, ax, ay));
    };

    const p = (w: number, h: number): PixBuf => new PixBuf(w, h);
    let b = p(32, 40);
    tree(b, false);
    put('tree0', b);
    b = p(32, 40);
    tree(b, true);
    put('tree1', b);
    b = p(32, 34);
    rock(b);
    put('rock0', b);
    b = p(32, 34);
    rock(b);
    put('rock1', b);
    b = p(32, 46);
    mountain(b);
    put('mtn0', b);
    b = p(32, 46);
    mountain(b);
    put('mtn1', b);

    b = p(32, 32);
    chest(b);
    put('chest', b);
    b = p(32, 36);
    fountain(b);
    put('fountain', b);
    b = p(32, 32);
    artifact(b);
    put('artifact', b);

    b = p(32, 32);
    resGold(b);
    put('res_gold', b);
    b = p(32, 32);
    resWood(b);
    put('res_wood', b);
    b = p(32, 32);
    resOre(b);
    put('res_ore', b);

    for (const k of ['gold', 'wood', 'ore'] as const) {
      b = p(32, 42);
      mine(b, k);
      put(`mine_${k}`, b);
    }

    for (const key of SPRITE_OWNERS) {
      const { roof, wall } = ownerPalette(key);
      for (let t = 0; t < 4; t++) {
        b = p(40, 52);
        town(b, roof, wall, t);
        put(`town_${key}_${t}`, b);
        // 2×2 城堡：往上、往左右各借一点边界，落点对齐见 render/MapRenderer
        b = p(72, 96);
        castle(b, roof, wall, t);
        put(`castle_${key}_${t}`, b, CASTLE_AX, CASTLE_AY);
      }
      b = p(32, 44);
      hero(b, roof);
      put(`hero_${key}`, b);
    }

    b = p(32, 30);
    wolf(b);
    put('mon_wolf', b);
    b = p(32, 30);
    boar(b);
    put('mon_boar', b);
    b = p(32, 44);
    ogre(b);
    put('mon_ogre', b);

    for (const k of ['gold', 'res', 'chest', 'mine'] as const) {
      b = p(16, 16);
      marker(b, k);
      put(`mk_${k}`, b);
    }

    for (const k of ['gold', 'wood', 'ore', 'gem', 'crystal', 'sulfur', 'mercury']) {
      b = p(18, 18);
      resIcon(b, k);
      put(`ic_${k}`, b);
    }

    for (let k = 0; k < 6; k++) {
      b = p(16, 16);
      decoration(b, k);
      put(`deco_${k}`, b);
    }

    const atlas = new Atlas(packer);
    atlas.frames = frames;
    return atlas;
  }
}

let cached: Atlas | null = null;

export function getAtlas(): Atlas {
  if (!cached) cached = Atlas.build();
  return cached;
}
