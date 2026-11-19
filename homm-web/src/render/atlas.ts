/**
 * HOMM2 风格精灵图集。
 *
 * 所有图形在启动时一次性画进一张离屏画布，之后渲染层只做 drawImage。
 * 好处：① 逐像素的"手绘感"只付一次代价；② 放大时关掉插值就是硬边像素风；
 * ③ core/ 完全不知道美术的存在，跟之前程序化绘制一样保持零耦合。
 */
import { PixBuf, chamferRect, fbm, hash2, mix, pnoise, shade } from './pixel.js';
import { NEUTRAL_ART_COLORS, UNIT_FRAMES, buildB0Frame, buildPortraitFrame } from './unitArt.js';
import { buildGuildArt, guildArtName } from './guildArt.js';
import { BUILDING_ART_IDS, DWELLING_TIER_IDS, MAX_BUILDING_TIER, buildBuildingArt, buildingArtName } from './buildingArt.js';
import { portraitOfCombatFrame } from './unitFrames.js';
import { MINE_KINDS, buildMineArt, mineArtName } from './mineArt.js';
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

/**
 * §21.8 属性物件：小石祠 + 一颗（+1）或两颗（+2）宝石。
 *
 * 为什么按"属性色 + 宝石颗数"编码，而不是画 9 张各不相同的图：
 * 32×40 上真正能读出来的只有**颜色 + 数量**；9 个 H3 名字（营帐/塔/星轴/花园…）
 * 缩到 32px 宽全是"一个台子顶个尖"，谁也认不出谁。玩家要判断的是"加什么、加多少"，
 * 这两件事在色相和颗数上，恰好是 1 秒能读完的。
 */
function statShrine(pb: PixBuf, color: string, pips: number): void {
  // 石台 + 柱身（左侧受光）
  pb.ellipse(16, 38, 12, 4, '#7b7264');
  pb.rect(9, 28, 14, 9, '#8f8678');
  pb.poly([[11, 29], [12, 15], [20, 15], [21, 29]], '#a49a8c');
  pb.poly([[11, 29], [12, 15], [16, 15], [16, 29]], '#b8ae9e');
  pb.rect(8, 12, 16, 3, '#8a8076');
  // 宝石：+1 一颗居中；+2 两颗并排
  const xs = pips >= 2 ? [11, 21] : [16];
  for (const cx of xs) {
    pb.poly([[cx, 3], [cx + 4, 8], [cx, 13], [cx - 4, 8]], color);
    pb.poly([[cx, 3], [cx + 4, 8], [cx, 13]], '#00000033');
    pb.set(cx - 1, 6, '#ffffff', 0.85);
  }
  pb.outline(OUTLINE);
  shadow(pb, 16, 39, 11, 2);
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

/** 七种矿各一张独立剪影（M9）；旧版"七顶同款帐篷 + 换矿石色"已删除。 */

/**
 * 宝库区：一座嵌在山体里的石门，门缝里透出金光。
 * 和野怪精灵（狼/猪/魔）在剪影上刻意拉开距离——它是一栋建筑，不是一队兵。
 */
function vault(pb: PixBuf): void {
  pb.poly([[1, 40], [6, 14], [16, 6], [26, 14], [31, 40]], '#585047');
  pb.poly([[1, 40], [6, 14], [16, 6], [16, 40]], '#6b6257');
  for (let x = 3; x < 30; x += 5) pb.rect(x, 18, 2, 20, '#4c453d', 0.5);
  // 门洞：外框石拱 + 里面一层金光
  pb.poly([[16, 16], [23, 22], [23, 40], [9, 40], [9, 22]], '#2a2018');
  pb.poly([[16, 18], [21, 23], [21, 40], [11, 40], [11, 23]], '#c9a227', 0.85);
  pb.poly([[16, 22], [19, 26], [19, 40], [13, 40], [13, 26]], '#f0d24a', 0.9);
  pb.rect(9, 22, 14, 3, '#8a6b3c');
  pb.set(16, 20, '#f7e98a');
  pb.outline(OUTLINE);
  shadow(pb, 16, 41, 14, 2.5);
}

/**
 * TP-4「城堡去矩形」的测试钩（默认全开）—— 与 `unitArt` 的
 * `setTierNormalizeEnabled` 同一用途：让验收门（tools/townartaudit.mjs）
 * 能插桩造失败，证明闸门有分辨力。运行期不碰它。
 */
export interface TownArtOptions {
  /** §1.2 切角。false = 退回纯 `rect` 直角（负向对照 N1）。 */
  chamfer: boolean;
  /** 城堡描边宽度（§1.1 例外条款：只有 72×96 的 2×2 城堡用 2px）。 */
  castleOutline: number;
  /** 城镇描边宽度（§1.1：帧高 52 ≤ 64 ⇒ 1px）。 */
  townOutline: number;
  /** 地面投影（半透明椭圆）。门控重建本体时关掉它，避免污染轮廓判据。 */
  shadow: boolean;
}

let townArt: TownArtOptions = { chamfer: true, townOutline: 1, castleOutline: 2, shadow: true };

export function setTownArtOptions(o: Partial<TownArtOptions>): void {
  townArt = { ...townArt, ...o };
}

/** 城镇/城堡帧的固定画布尺寸（§1.1 描边分档 + 图集打包都按它）。 */
export const TOWN_FRAME_SIZE = { w: 40, h: 52 } as const;
export const CASTLE_FRAME_SIZE = { w: 72, h: 96 } as const;

/**
 * 四档外形 = **城防等级**（§14.3 G5，2026-11-06）。
 *
 * 这 4 档原来按**兵营数量**选（`DWELLING_IDS` 的个数 / 1.5），所以木栅与堡垒
 * 长得一模一样 —— "升级了却看不出来"。现在选择依据换成 `wallLevelOf(town)`，
 * 每一档画成不同的轮廓：
 *
 * | 等级 | 墙 | 塔 | 战斗里的依据（`createSiege`） |
 * |---|---|---|---|
 * | 0 | 无 | 0 | `null`（没有攻城战） |
 * | 1 | 木栅 | 0 | 只有墙段 + 城门（**L1 无箭塔**，2026-10-28 定的 0/1/3） |
 * | 2 | 石墙 | 1 | `keep` 一座（主楼开火） |
 * | 3 | 石墙 | 3 | `keep` + 两座 `tower` 角塔 |
 *
 * `towers` 这一列是**地图轮廓与战斗结构的唯一对齐点**：`audit:townart` 直接拿
 * 它和 `createSiege(lv)` 的 `tower`/`keep` 数量对账，防止两边各自漂移。
 */
export const CASTLE_WALL_SPEC = {
  0: { wall: 'none', towers: 0 },
  1: { wall: 'palisade', towers: 0 },
  2: { wall: 'stone', towers: 1 },
  3: { wall: 'stone', towers: 3 },
} as const;

/**
 * 尖顶屋面：**顶点朝上**的正三角，右半边压暗做体积。
 *
 * ★ 2026-11-06 修：原来 `tri([cx, eave], [cx-w, eave-h], [cx+w, eave-h])` 三个点
 *   写成了「底边在上、顶点朝下」——渲出来是一只**倒扣的漏斗**（`--png` 导出后
 *   肉眼一看就露）。之所以一直没被机检抓到，是因为闸门只管描边/直角/尺寸，
 *   没有任何一条判"屋顶朝哪"。
 *
 * 出挑只给 2~3px：§1.2 的直角判据 MIN_RUN=6，出挑 <6 的檐口不读成"矩形"，
 * 所以不用为了躲直角再把屋顶倒过来画（那正是旧写法的由来）。
 */
function roofTri(
  pb: PixBuf,
  cx: number,
  eave: number,
  halfW: number,
  h: number,
  roof: string,
  roofDark: string,
): void {
  pb.tri([cx, eave - h], [cx - halfW, eave], [cx + halfW, eave], roof);
  pb.tri([cx, eave - h], [cx, eave], [cx + halfW, eave], roofDark);
  // 檐口一线（1px）：把屋顶与墙身分开，不然同色相接会糊成一片
  pb.hline(cx - halfW, cx + halfW - 1, eave, shade(roof, -0.45));
}


/**
 * 离线验收入口：直接建 1×1 城镇帧的**像素**（不走图集画布，也不需要 DOM）。
 * tools/townartaudit.mjs 消费；`Atlas.build()` 也复用它，尺寸只有这一份真源。
 */
export function buildTownFrame(owner: SpriteOwner, tier: number): PixBuf {
  const { roof, wall } = ownerPalette(owner);
  const pb = new PixBuf(TOWN_FRAME_SIZE.w, TOWN_FRAME_SIZE.h);
  town(pb, roof, wall, tier);
  return pb;
}

/** 离线验收入口：2×2 城堡帧（72×96，地图上真正会被看到的那一版）。 */
export function buildCastleFrame(owner: SpriteOwner, tier: number): PixBuf {
  const { roof, wall } = ownerPalette(owner);
  const pb = new PixBuf(CASTLE_FRAME_SIZE.w, CASTLE_FRAME_SIZE.h);
  castle(pb, roof, wall, tier);
  return pb;
}

/**
 * 1×1 城镇精灵（40×52）。
 *
 * TP-4「城堡去矩形」（2026-10-19）：墙体/塔楼/主楼全部改 `chamferRect` 四角切 1px
 * —— cartoon-style.md §1.2「人造物禁止直角」：32px 尺度下的纯 90° 直角读成
 * 「程序员的矩形」（圣经原话点的就是这堵墙）。切角档位按 §1.1 的**高度**判据：
 * 本帧高 52 ≤ 64 ⇒ 切 1px、描边 1px（2px 是 72×96 城堡的专属例外）。
 * 城齿、门窗、屋顶尖顶与族旗不动：尖角只留给屋顶母题（§1.2 末条）。
 */
function town(pb: PixBuf, roof: string, wall: string, tier: number): void {
  const W = TOWN_FRAME_SIZE.w;
  const H = TOWN_FRAME_SIZE.h;
  const wallDark = shade(wall, -0.35);
  const wallLite = shade(wall, 0.2);
  const roofDark = shade(roof, -0.28);
  const wood = '#7d5a34';
  const woodDark = shade(wood, -0.32);
  /** 人造块统一入口：切角开 = chamferRect（四角各切 c px），关 = 纯 rect（负向对照）。 */
  const block = (x: number, y: number, w: number, h: number, c: number, color: string): void => {
    if (townArt.chamfer) chamferRect(pb, x, y, w, h, c, color);
    else pb.rect(x, y, w, h, color);
  };
  /** 挂在墙上的族旗：横杆 + **下垂的三角幡**。
   *  第一版是「竖矩形 + 底带」，1× 尺度实拍读成**窗户 / 蓝木盒**（1×1 城与木栅城都中招）——
   *  矩形的"旗"只有在有风有布纹的大尺寸下才成立；三角才是小尺寸里唯一读得出"旗"的形状。
   *  整块必须落在不透明区内 ⇒ 不制造新外轮廓（0/1 档的最高点仍压在屋顶以下）。 */
  const banner = (x: number, y: number, w = 8, h = 11): void => {
    pb.rect(x, y, w, 1, '#4a3524');
    pb.tri([x, y + 1], [x + w - 1, y + 1], [x + Math.floor((w - 1) / 2), y + h], roof);
    pb.vline(x + Math.floor((w - 1) / 2), y + 2, y + h - 1, roofDark);
  };

  if (tier === 0 || tier === 1) {
    /* 无墙 / 木栅：主屋 + 一间偏屋，**没有塔**（对应战斗里的 0 塔）。 */
    block(11, 26, 21, 20, 1, wall);
    block(11, 26, 6, 20, 1, wallLite);
    block(26, 26, 6, 20, 1, wallDark);
    roofTri(pb, 21, 26, 13, 12, roof, roofDark);
    pb.rect(24, 34, 5, 11, '#3a2a18');

    if (tier === 1) {
      // 木栅：竖桩 3px + 1px 缝，两道横梁；门洞留空
      for (let x = 1; x < 39; x += 4) {
        if (x >= 15 && x <= 24) continue;
        const top = 32 + (((x >> 2) & 1) as number);
        block(x, top, 3, 46 - top, 0, wood);
        pb.rect(x + 2, top, 1, 46 - top, woodDark);
      }
      pb.rect(1, 39, 13, 2, woodDark);
      pb.rect(25, 39, 14, 2, woodDark);
      pb.rect(1, 43, 13, 1, woodDark);
      pb.rect(25, 43, 14, 1, woodDark);
      block(13, 28, 3, 18, 0, wood);
      block(25, 28, 3, 18, 0, wood);
      block(12, 26, 15, 3, 0, woodDark);
      block(15, 34, 10, 12, 0, '#8a7550');
    } else {
      // 无墙：偏屋与土路，让"这里没设防"看得出来
      block(1, 34, 10, 12, 1, wall);
      roofTri(pb, 6, 34, 6, 6, roof, roofDark);
      block(2, 46, 36, 4, 1, '#8a7550');
    }
    // 族旗：挂低一点贴在墙上（贴着屋檐会读成烟囱）；整块落在不透明区内 ⇒ 不制造新轮廓
    banner(tier === 1 ? 28 : 14, 33, 8, 9);
  } else {
    /* 石墙档：正面城墙 + 垛口；2 = 一座主楼，3 = 主楼 + 两座小角塔。 */
    block(4, 34, W - 8, 12, 1, wall);
    block(4, 34, 12, 12, 1, wallLite);
    block(W - 16, 34, 12, 12, 1, wallDark);
    for (let x = 4; x < W - 4; x += 4) pb.rect(x, 31, 2, 3, wall);
    // 墙脚暗带：左右各让 1px，避开墙体已切掉的底角（2px 高的带子切角会退化成直角）
    pb.rect(5, 44, W - 10, 2, wallDark);

    if (tier >= 3) {
      for (const tx of [2, W - 10]) {
        block(tx, 22, 8, 24, 1, wall);
        block(tx, 22, 3, 24, 1, wallLite);
        roofTri(pb, tx + 4, 22, 4, 12, roof, roofDark);
      }
    }

    const ky = tier >= 3 ? 16 : 18;
    block(13, ky, 14, 46 - ky, 1, wall);
    block(13, ky, 5, 46 - ky, 1, wallLite);
    block(22, ky, 5, 46 - ky, 1, wallDark);
    roofTri(pb, 20, ky, 9, tier >= 3 ? 12 : 10, roof, roofDark);
    pb.rect(18, ky + 6, 4, 6, '#3a2a18');
    // 旗：插在主楼尖上
    pb.vline(20, ky - 14, (tier >= 3 ? 12 : 10) + ky - 2, '#5a4326');
    pb.tri([20, ky - 14], [31, ky - 11], [20, ky - 8], roof);
    /* 城门：只在墙体内挖一个拱，**不许垂到墙脚以下** ——
     * 城门若比墙多露 5px，墙脚会在门洞两侧各留一个 90° 台阶（下沿 10px、竖边 39px，
     * 两条都过 MIN_RUN=6），[1] 去直角当场红。 */
    pb.poly([[16, 45], [16, 42], [19, 38], [23, 38], [26, 42], [26, 45]], '#3a2a18');
    pb.rect(7, 40, 3, 4, '#3a2a18');
    pb.rect(30, 40, 3, 4, '#3a2a18');
  }

  // §1.1：帧高 52 ≤ 64 ⇒ 1px 描边（2px 是 72×96 城堡的专属例外）
  for (let i = 0; i < townArt.townOutline; i++) pb.outline(OUTLINE);
  if (townArt.shadow) shadow(pb, W / 2, H - 3, 17, 3);
}

/**
 * 2×2 城堡。精灵画成 72×96，落到地上时正好铺满两格宽、两格高（见 render 里的锚点）。
 * 城门永远在**左下角**那一格，也就是正面朝南 —— 城堡背面与右侧都是实墙，
 * 所以"只能从正面进"这件事在美术上是看得见的，不是靠代码硬掰。
 *
 * TP-4「城堡去矩形」（2026-10-19）：
 *  ① 主楼 / 角塔 / 正面城墙 / 基座全部 `chamferRect` 四角切 **2px** —— §1.2
 *     「大建筑（≥64px）切 2px」，72×96 正是大建筑档；
 *  ② 描边改 **2px** —— §1.1 例外条款：全图集只有 72×96 的城堡用 2px
 *     （1×1 城镇高 52 ≤ 64，仍守 1px）。实现 = `outline()` 迭代两次
 *     （§8.1「粗描边」原语的落地方式：补两圈而非改膨胀核）；
 *  ③ 与轮廓共享角的装饰元素（条纹 / 檐线 / 墙脚线）同步让位，否则会把切掉的角
 *     重新画成直角 —— 验收门 `townartaudit` 的 T1 专抓这一类回退。
 * 尖角仍只留给屋顶与族旗（§1.2 末条：母题只留一处）。
 */
function castle(pb: PixBuf, roof: string, wall: string, tier: number): void {
  const W = CASTLE_FRAME_SIZE.w;
  const H = CASTLE_FRAME_SIZE.h;
  const wallDark = shade(wall, -0.35);
  const wallLite = shade(wall, 0.2);
  const roofDark = shade(roof, -0.28);
  const hollow = '#1a1208';
  const wood = '#7d5a34';
  const woodDark = shade(wood, -0.32);
  const woodLite = shade(wood, 0.2);
  const earth = '#8a7550';
  /** 同 town() 的 block：切角开 = chamferRect，关 = 纯 rect（负向对照 N1）。 */
  const block = (x: number, y: number, w: number, h: number, c: number, color: string): void => {
    if (townArt.chamfer) chamferRect(pb, x, y, w, h, c, color);
    else pb.rect(x, y, w, h, color);
  };

  /** 主体下沿：城墙从这里开始往下铺。 */
  const bodyBase = 74;
  /** 族旗：插在最高那处屋顶的尖上（2/3 档用）。旗面与屋顶同色，杆要留够 —— 太短会糊成一坨。 */
  const flag = (cx: number, apex: number): void => {
    const top = Math.max(2, apex - 10);
    pb.vline(cx, top, apex, '#5a4326');
    pb.tri([cx, top], [cx + 14, top + 3], [cx, top + 6], roof);
  };
  /**
   * 挂在墙上的族旗（0/1 档用）。**必须整个落在不透明的墙/栅栏之内**：
   * 那样它不制造新的外轮廓，也就不会把"塔带"里多出一个色块
   * （无墙档的最高点只能到 y=46，旗杆再往上就与"0 塔"的判据打架了）。
   * 形状是横杆 + 下垂三角幡 —— 见 `town()` 里同名函数的说明（矩形读成窗户）。
   */
  const banner = (x: number, y: number, w = 8, h = 12): void => {
    pb.rect(x, y, w, 1, '#4a3524');
    pb.tri([x, y + 1], [x + w - 1, y + 1], [x + Math.floor((w - 1) / 2), y + h], roof);
    pb.vline(x + Math.floor((w - 1) / 2), y + 2, y + h - 1, roofDark);
  };

  /* ---------------- 石墙档（2 / 3）：正面城墙 + 城门，唯一敞开的一面 ---------------- */
  const stoneFront = (): void => {
    block(4, 68, W - 8, 20, 2, wall);
    block(4, 68, 16, 20, 2, wallLite);
    block(52, 68, 16, 20, 2, wallDark);
    for (let x = 4; x < W - 6; x += 5) pb.rect(x, 64, 3, 4, wall);
    block(2, 88, W - 4, 8, 2, wallDark);
    // 墙脚线：左右各让 2px，避开城墙/基座已切掉的底角（2px 高的线切角会退化成直角）
    pb.rect(6, 87, W - 12, 2, shade(wall, -0.5));

    /* 城门：左下角那格的正中，正面唯一能站人的位置 */
    pb.poly([[14, H], [14, 85], [17, 77], [23, 77], [26, 85], [26, H]], hollow);
    pb.rect(15, 91, 10, 5, '#4a3524');
    pb.rect(11, 76, 4, 20, wallDark);
    pb.rect(25, 76, 4, 20, wallDark);
    block(12, 72, 17, 3, 1, roof); // 城门上的小檐
    pb.rect(13, 75, 15, 1, roofDark); // 檐影（1px 高：左端让 1px 避开檐口切角）
  };

  if (tier === 0) {
    /* ---------------- 无墙：**村落**。没有城墙/城门，也就不该有任何塔 ----------------
     * 剪影口径：最高的只有屋脊（y=46），y<36 的"塔带"里空无一物 —— 这是玩家
     * 一眼读出"这里没设防"的依据，也是 `audit:townart` 数塔的那条线。
     */
    // 主屋：村子的主体，仍要能撑住 2×2 的剪影
    block(20, 62, 32, 24, 2, wall);
    block(20, 62, 8, 24, 2, wallLite);
    block(44, 62, 8, 24, 2, wallDark);
    roofTri(pb, 36, 62, 18, 16, roof, roofDark);
    block(32, 68, 8, 11, 1, hollow);
    // 左右两间小屋（没有围墙把它们连成一体，缝隙要留着）
    block(3, 70, 15, 16, 2, wall);
    roofTri(pb, 10, 70, 9, 10, roof, roofDark);
    pb.rect(8, 74, 5, 6, '#3a2a18');
    block(56, 72, 14, 14, 2, wall);
    roofTri(pb, 63, 72, 8, 9, roof, roofDark);
    pb.rect(59, 76, 5, 5, '#3a2a18');
    /* 前庭：两个重叠的**土丘椭圆**，不是一条直边色块 ——
     * 直边色块实拍读成"木台子"（三栋房子架在一块板子上），
     * 弧顶才读成"地面"。也顺带避开了 §1.2 的 90° 判据。 */
    pb.ellipse(24, 90, 22, 6, earth);
    pb.ellipse(48, 90, 20, 6, earth);
    banner(22, 66, 8, 12);
  } else if (tier === 1) {
    /* ---------------- 木栅：**挡路不挡箭**（战斗里 L1 零箭塔，呼应 0/1/3 曲线） ----------------
     * 木桩 3px 宽 + 1px 缝，顶上参差 1px；两道横梁。没有石垛口、没有塔。
     * 门洞必须在**竖桩和横梁上都留空** —— 只摆两根高桩、栅栏照样横着铺，
     * 看着就不像能进去（实拍第一版正是这样）。
     */
    // 栅栏后的主屋：屋顶露在栅栏之上，身体被挡住 —— 这是"里面有人"的读法
    block(18, 58, 34, 28, 2, wall);
    block(18, 58, 8, 28, 2, wallLite);
    block(44, 58, 8, 28, 2, wallDark);
    roofTri(pb, 35, 58, 19, 12, roof, roofDark);
    // 门洞里的土路 + 栅栏脚下的地面带：先铺地，再让栅栏压上来
    // （地面带用 c=2 切角：一整条 64×9 的直角色块会被 [1] 抓成 90°）
    pb.ellipse(36, 90, 32, 6, earth);
    /* 门洞：**宽而低**的缺口，不是一根高而窄的暗柱。
     * 第一版做的是"两根高桩 + 门楣挑在栅栏之上、下面整个挖空"——
     * 8×36 的暗色竖条实拍就是一根柱子，完全读不出"能走进去"。
     * 现在：缺口 14 宽 × 16 高（x14..27 / y71..86），上面压一道门梁，
     * 两侧各一根门柱；门洞底边压在土丘里（土丘先画）⇒ 门下不会挖出洞。 */
    pb.rect(14, 64, 14, 23, '#1a1208');
    // 竖桩（门洞 x14..27 留空）
    for (let x = 2; x < 70; x += 4) {
      if (x >= 13 && x <= 26) continue;
      const top = 58 + (((x >> 2) & 1) as number);
      block(x, top, 3, 86 - top, 1, wood);
      pb.rect(x + 2, top, 1, 86 - top, woodDark);
      pb.rect(x, top, 1, 86 - top, woodLite);
    }
    // 横梁断在门洞两侧
    pb.rect(2, 70, 12, 2, woodDark);
    pb.rect(28, 70, 42, 2, woodDark);
    pb.rect(2, 78, 12, 2, woodDark);
    pb.rect(28, 78, 42, 2, woodDark);
    // 门柱 + 门梁（梁比横梁厚 1px，把入口框出来）
    block(11, 58, 4, 28, 1, wood);
    pb.rect(14, 58, 1, 28, woodDark);
    block(27, 58, 4, 28, 1, wood);
    pb.rect(30, 58, 1, 28, woodDark);
    block(11, 58, 20, 6, 1, woodDark);
    pb.rect(12, 59, 18, 1, woodLite);
    // 族旗：挂在栅栏上（整块落在栅栏轮廓之内，不参与"塔带"）
    banner(56, 60, 8, 11);
  } else if (tier === 2) {
    /* ---------------- 石墙 + **1 塔**：只有中央主楼（`createSiege` 的 keep） ----------------
     * 两侧不放塔，只放低矮的附属屋子：它们的屋脊在 y=46，落在塔带之外，
     * 所以"数塔"只会数到主楼这一座。
     */
    block(24, 34, 24, bodyBase - 34, 2, wall);
    block(24, 34, 6, bodyBase - 34, 2, wallLite);
    block(42, 34, 6, bodyBase - 34, 2, wallDark);
    roofTri(pb, 36, 34, 15, 24, roof, roofDark);
    block(32, 46, 8, 14, 1, hollow);
    // 左右附属屋：**必须是"屋"，不能是"矮一号的塔"** ——
    // 第一版给了它们和 3 档角塔同宽（18）同款的**蓝尖顶**，实拍 2 档也读成"三座塔"，
    // 于是 1 塔 / 3 塔这条 S6 的全部意义当场作废（机检只数 y<26，眼睛数的是尖顶）。
    // 现在：宽而低的**茅草顶**（木色）+ 方窗，蓝尖顶只属于塔。
    for (const hx of [2, 52]) {
      block(hx, 60, 20, bodyBase - 60, 1, wall);
      block(hx, 60, 5, bodyBase - 60, 1, wallLite);
      roofTri(pb, hx + 9, 60, 11, 7, wood, woodDark);
      pb.rect(hx + 7, 66, 5, 6, '#3a2a18');
    }
    stoneFront();
    flag(36, 10);
  } else {
    /* ---------------- 堡垒 + **3 塔**：主楼 + 两座角塔（= createSiege 的 keep + 2 tower） ---------------- */
    block(22, 32, 28, bodyBase - 32, 2, wall);
    block(22, 32, 7, bodyBase - 32, 2, wallLite);
    block(43, 32, 7, bodyBase - 32, 2, wallDark);
    roofTri(pb, 36, 32, 17, 20, roof, roofDark);
    // 主楼大窗（8×14，两边都 ≥6 ⇒ 按同一把尺子切 1px；塔楼小窗 5×9 不切）
    block(32, 46, 8, 14, 1, hollow);
    for (const tx of [2, 52]) {
      block(tx, 40, 18, bodyBase - 40, 2, wall);
      block(tx, 40, 5, bodyBase - 40, 2, wallLite);
      block(tx + 13, 40, 5, bodyBase - 40, 2, wallDark);
      roofTri(pb, tx + 9, 40, 11, 18, roof, roofDark);
      pb.rect(tx + 7, 52, 5, 9, hollow);
    }
    stoneFront();
    flag(36, 12);
  }

  // §1.1 例外：只有 72×96 城堡用 2px 描边（outline 一次 = 1px 圈，迭代两次 = 2px）
  for (let i = 0; i < townArt.castleOutline; i++) pb.outline(OUTLINE);
  if (townArt.shadow) shadow(pb, W / 2, H - 3, 30, 4);
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

/**
 * TP-4② `mon_*` 中立怪地图图标的测试钩（默认全开）—— 与 `townArt` 同一用途：
 * 让验收门（tools/neutralaudit.mjs）能插桩造失败，证明闸门有分辨力。运行期不碰它。
 */
export interface MonArtOptions {
  /** 描边（图集墨 OUTLINE）。false = 退回无描边（负向对照 N1）。 */
  outline: boolean;
}
let monArt: MonArtOptions = { outline: true };
export function setMonArtOptions(o: Partial<MonArtOptions>): void {
  monArt = { ...monArt, ...o };
}

/** `mon_*` 帧的固定画布尺寸（TP-4② 同尺寸替换，不占新容量）。 */
export const MON_FRAME_SIZE = {
  wolf: { w: 32, h: 30 },
  boar: { w: 32, h: 30 },
  ogre: { w: 32, h: 44 },
} as const;

/** 离线验收入口：`mon_<id>` 地图图标帧的**像素**（不走图集画布，也不需要 DOM）。 */
export function buildMonFrame(id: 'wolf' | 'boar' | 'ogre'): PixBuf {
  const size = MON_FRAME_SIZE[id];
  const pb = new PixBuf(size.w, size.h);
  if (id === 'wolf') wolf(pb);
  else if (id === 'boar') boar(pb);
  else ogre(pb);
  return pb;
}

/**
 * TP-4②（2026-10-20）：`mon_*` 三只中立怪的地图图标与 `unitArt.ts` B4 批的
 * `cu_*` 战斗帧**同批翻新**——旧画法是椭圆 blob + 矩形腿 + 1px 眼 + 0.8 半透明，
 * 正是圣经 §1.2/§1.3/§4 H3 点的反面教材。新画法取色与造型语言与战斗帧同源
 * （`NEUTRAL_ART_COLORS`），零半透明、2px 眼、每单位一处失调。
 * 尺寸不变（32×30/32×30/32×44）⇒ 冒险图集容量零增长。
 */
function wolf(pb: PixBuf): void {
  pb.tri([7, 12], [9, 8], [11, 12], NEUTRAL_ART_COLORS.fur0); // 双尖耳（母题）
  pb.ellipse(8, 15, 4, 4, NEUTRAL_ART_COLORS.fur2); // 头
  pb.rect(2, 14, 6, 3, NEUTRAL_ART_COLORS.fur2); // 长吻（唯一失调）
  pb.rect(2, 14, 2, 2, NEUTRAL_ART_COLORS.fur0); // 鼻头
  pb.hline(3, 7, 17, NEUTRAL_ART_COLORS.ink); // 嘴线
  pb.set(5, 17, NEUTRAL_ART_COLORS.tusk); // 1px 獠牙
  pb.line(5, 11, 9, 12, NEUTRAL_ART_COLORS.ink); // 平眉（H6：T1 最认真）
  pb.rect(7, 13, 2, 2, NEUTRAL_ART_COLORS.eyeWhite); // 2px 眼白 + 1px 瞳孔（H3）
  pb.set(8, 14, NEUTRAL_ART_COLORS.ink);
  pb.ellipse(18, 19, 9, 5, NEUTRAL_ART_COLORS.fur2); // 躯干
  pb.ellipse(18, 22, 8, 2, NEUTRAL_ART_COLORS.fur0); // 腹暗面
  for (const x of [12, 16, 20, 24]) {
    pb.rect(x, 22, 2, 4, NEUTRAL_ART_COLORS.fur0); // 四腿
    pb.rect(x, 26, 3, 2, NEUTRAL_ART_COLORS.fur0); // 1.4× 掌
  }
  pb.rect(26, 16, 3, 2, NEUTRAL_ART_COLORS.fur2); // 蓬尾
  pb.rect(28, 14, 2, 2, NEUTRAL_ART_COLORS.fur0);
  pb.hline(11, 27, 28, NEUTRAL_ART_COLORS.ao); // AO（画布内）
  if (monArt.outline) pb.outline(OUTLINE);
}

function boar(pb: PixBuf): void {
  for (const [x, tip] of [
    [11, 13],
    [15, 11],
    [19, 10],
    [23, 11],
  ] as [number, number][]) {
    pb.tri([x, 15], [x + 2, tip], [x + 4, 15], NEUTRAL_ART_COLORS.bristle0); // 锯齿背鬃
  }
  pb.ellipse(18, 18, 10, 6, NEUTRAL_ART_COLORS.bristle2); // 躯干
  pb.ellipse(18, 21, 9, 3, NEUTRAL_ART_COLORS.bristle0);
  pb.ellipse(12, 16, 5, 4, NEUTRAL_ART_COLORS.bristle2); // 肩
  pb.ellipse(8, 15, 5, 5, NEUTRAL_ART_COLORS.bristle2); // 头
  pb.rect(2, 16, 6, 4, NEUTRAL_ART_COLORS.bristle2); // 吻
  pb.rect(2, 17, 2, 2, NEUTRAL_ART_COLORS.bristle0); // 鼻头
  pb.hline(3, 7, 20, NEUTRAL_ART_COLORS.ink); // 嘴线
  // 一对大獠牙（唯一失调）
  pb.poly(
    [
      [4, 21],
      [1, 15],
      [7, 19],
    ],
    NEUTRAL_ART_COLORS.tusk,
  );
  pb.poly(
    [
      [7, 21],
      [5, 17],
      [10, 20],
    ],
    NEUTRAL_ART_COLORS.tusk,
  );
  pb.ellipse(11, 11, 2, 2, NEUTRAL_ART_COLORS.bristle0); // 圆耳
  pb.line(5, 11, 10, 12, NEUTRAL_ART_COLORS.ink); // 凶眉
  pb.rect(7, 13, 2, 2, NEUTRAL_ART_COLORS.eyeWhite);
  pb.set(8, 14, NEUTRAL_ART_COLORS.ink);
  for (const x of [11, 15, 21, 25]) {
    pb.rect(x, 23, 3, 4, NEUTRAL_ART_COLORS.bristle0); // 四腿
    pb.rect(x, 26, 3, 2, NEUTRAL_ART_COLORS.ink); // 蹄（ink0：贴 wood0 的 ΔL* 理由同 cu 帧）
  }
  pb.rect(27, 16, 2, 2, NEUTRAL_ART_COLORS.bristle2); // 小卷尾
  pb.hline(10, 28, 28, NEUTRAL_ART_COLORS.ao);
  if (monArt.outline) pb.outline(OUTLINE);
}

function ogre(pb: PixBuf): void {
  // 超长狼牙棒（唯一失调）
  pb.rect(24, 10, 3, 10, NEUTRAL_ART_COLORS.club0);
  pb.ellipse(26, 6, 4, 4, NEUTRAL_ART_COLORS.club4);
  chamferRect(pb, 23, 3, 2, 2, 1, NEUTRAL_ART_COLORS.stud); // 棒钉（人造物切角）
  chamferRect(pb, 28, 5, 2, 2, 1, NEUTRAL_ART_COLORS.stud);
  pb.rect(22, 18, 3, 5, NEUTRAL_ART_COLORS.hide2); // 右臂举棒
  pb.rect(21, 21, 5, 4, NEUTRAL_ART_COLORS.hide4); // 1.4× 拳
  pb.rect(7, 18, 3, 6, NEUTRAL_ART_COLORS.hide2); // 左臂
  pb.rect(6, 23, 5, 4, NEUTRAL_ART_COLORS.hide4);
  pb.ellipse(16, 12, 5, 5, NEUTRAL_ART_COLORS.hide2); // 头
  pb.ellipse(12, 12, 2, 2, NEUTRAL_ART_COLORS.hide0); // 耳（收紧到头侧：右耳让开 club 杆 1px）
  pb.ellipse(20, 12, 2, 2, NEUTRAL_ART_COLORS.hide0);
  pb.line(10, 8, 14, 9, NEUTRAL_ART_COLORS.ink); // 呆怒眉
  pb.line(18, 9, 22, 8, NEUTRAL_ART_COLORS.ink);
  pb.rect(12, 10, 2, 2, NEUTRAL_ART_COLORS.eyeWhite);
  pb.set(13, 11, NEUTRAL_ART_COLORS.ink);
  pb.rect(18, 10, 2, 2, NEUTRAL_ART_COLORS.eyeWhite);
  pb.set(19, 11, NEUTRAL_ART_COLORS.ink);
  pb.hline(13, 19, 15, NEUTRAL_ART_COLORS.ink); // 嘴线
  pb.set(14, 15, NEUTRAL_ART_COLORS.tusk); // 小獠牙
  pb.set(17, 15, NEUTRAL_ART_COLORS.tusk);
  pb.ellipse(16, 24, 8, 7, NEUTRAL_ART_COLORS.hide2); // 躯干
  pb.rect(11, 28, 11, 4, NEUTRAL_ART_COLORS.cloth); // 腰布
  for (let x = 12; x <= 20; x++) {
    const pat = [1, 0, 2, 0][(x - 12) % 4];
    pb.vline(x, 32, 32 + pat, NEUTRAL_ART_COLORS.ao); // 锯齿下摆
  }
  pb.rect(10, 32, 5, 6, NEUTRAL_ART_COLORS.hide0); // 双腿
  pb.rect(18, 32, 5, 6, NEUTRAL_ART_COLORS.hide0);
  pb.rect(9, 37, 7, 3, NEUTRAL_ART_COLORS.hide0); // 大脚（探到画布底-3 内：贴地）
  pb.rect(17, 37, 7, 3, NEUTRAL_ART_COLORS.hide0);
  pb.hline(8, 25, 40, NEUTRAL_ART_COLORS.ao); // AO
  if (monArt.outline) pb.outline(OUTLINE);
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

/**
 * 稀有资源**聚合槽**图标 `ic_rare`（D-38② / UX Q8）。
 * 形状语言 = **钱袋剪影**，必须与 `ic_gem` 的实心粉菱形（`#d05fa0`）明显区分，
 * 否则两图互相冒充（gem 已是实心菱形，这里改用上窄下宽的口袋 + 绳结）。
 * 基色走暖木棕，不撞任何稀有色（粉/青/黄/银）。
 */
function rareBagIcon(pb: PixBuf): void {
  const bag = '#b0813f';
  // 袋身：上窄下宽
  pb.poly([[5, 7], [13, 7], [16, 15], [2, 15]], bag);
  // 收口
  pb.rect(6, 4, 6, 3, shade(bag, -0.18));
  // 绳结
  pb.rect(7, 2, 4, 2, '#7d5a24');
  // 左上高光，读出"鼓"的体积
  pb.poly([[6, 9], [9, 9], [7, 14], [4, 14]], shade(bag, 0.3), 0.8);
  pb.outline('#3a2a18', 0.9);
}

/**
 * setup **音效**开关两态：`ic_sound_on` = 喇叭 + 声波弧；`ic_sound_off` = 同一喇叭 + 对角斜杠。
 * 替掉原顶栏的两个音效 emoji（G-17：emoji 全彩 / 抗锯齿 / 尺寸随 OS 变，违反色板与整数缩放）。
 * （基线 §5 的可机检项「src/ 里不得出现 emoji 当图标」要求这里也不再写字面 emoji。）
 */
function soundIcon(pb: PixBuf, on: boolean): void {
  const metal = '#c7d0d8';
  // 喇叭：矩形号角 + 外张的喇叭口
  pb.poly([[2, 7], [6, 7], [10, 3], [10, 15], [6, 11], [2, 11]], metal);
  pb.rect(2, 7, 2, 4, shade(metal, -0.2));
  if (on) {
    pb.line(12, 6, 12, 12, shade(metal, 0.15));
    pb.line(14, 4, 14, 14, shade(metal, 0.25), 0.85);
  } else {
    pb.line(11, 5, 16, 13, '#d0553f');
    pb.line(16, 5, 11, 13, '#d0553f');
  }
  pb.outline('#3a2a18', 0.85);
}

/**
 * setup **光照**开关两态（形状语言依 `asset-spec.md §2.3.1`）：
 * `ic_light_on` = 月牙（昼夜光照启用）；`ic_light_off` = 圆盘太阳 + 短射线（恒定正午）。
 * 替掉原顶栏的两个光照 emoji（同上 G-17 理由）。
 */
function lightIcon(pb: PixBuf, on: boolean): void {
  if (on) {
    // 月牙：外弧（左）+ 内弧（右）围出一弯
    pb.poly([[9, 2], [5, 4], [3, 7], [3, 11], [5, 14], [9, 16], [12, 13], [13, 9], [12, 5]], '#e6edf5');
    pb.set(6, 7, '#ffffff', 0.7);
  } else {
    pb.ellipse(9, 9, 4, 4, '#f2c94a');
    pb.ellipse(8, 8, 2, 2, '#fff0a0', 0.9);
    for (const [dx, dy] of [[0, -6], [0, 6], [-6, 0], [6, 0], [4, 4], [4, -4], [-4, 4], [-4, -4]]) {
      pb.set(9 + dx, 9 + dy, '#e8b23a');
    }
  }
  pb.outline('#3a2a18', 0.85);
}

/**
 * setup **音乐**开关两态（TP-3，Q3 独立开关）：`ic_music_on` = 八分音符；
 * `ic_music_off` = 同一音符 + 对角斜杠。与 `ic_sound_*`（喇叭）必须一眼分得清——
 * 设置里「音效 / 音乐」两行并列，图标撞形会被读成同一项。
 */
function musicIcon(pb: PixBuf, on: boolean): void {
  const ink = '#d8c48a';
  // 符头：椭圆；符杆：右上竖线；符尾：单旗
  pb.ellipse(6, 12, 3, 2.4, ink);
  pb.rect(8, 3, 1.4, 9, ink);
  pb.poly([[9, 3], [13, 5], [13, 7], [9, 5]], ink);
  pb.set(5, 11, '#ffffff', 0.5); // 符头高光
  if (!on) {
    pb.line(2, 2, 15, 15, '#d0553f');
    pb.line(15, 2, 2, 15, '#d0553f');
  }
  pb.outline('#3a2a18', 0.85);
}

/**
 * 教学清单勾选两态（TP-6③ / F-3.5）：`ic_obj_done` = 实心方块 + 对勾；
 * `ic_obj_todo` = 空心方框。替掉 `HeroPanel.objectiveSection` 里的 ☑/☐ 文本符号
 * （G-17 同族理由：文本符号尺寸/字形随 OS 与字体变，且是"用文字当图标"）。
 *
 * 形状语言 = 「勾选框」而不是「圆点」：`hp-obj-row` 是**只读**清单行，勾选框的
 * 方轮廓跟文本基线对齐比圆点稳。对勾用两段折线，不用曲线（整数像素 + B0 风格）。
 */
function objCheckIcon(pb: PixBuf, done: boolean): void {
  const ink = done ? '#7fc25f' : '#8d8578';
  if (done) {
    pb.rect(3, 3, 12, 12, '#1d2a16');
    pb.poly([[4, 9], [7, 12], [14, 4]], ink); // 长划
    pb.poly([[7, 12], [8, 12], [14, 5]], shade(ink, 0.25)); // 短划高光
  } else {
    pb.rect(3, 3, 12, 12, '#141019');
    // 空心：四条边各一条 1px 线（PixBuf 没有 stroke 概念，手绘）
    pb.rect(3, 3, 12, 1, ink);
    pb.rect(3, 14, 12, 1, ink);
    pb.rect(3, 3, 1, 12, ink);
    pb.rect(14, 3, 1, 12, ink);
  }
  pb.outline('#3a2a18', 0.8);
}

/**
 * 城防等级图标（TP-6③ / F-3.5）：`ic_wall_1` / `ic_wall_2` = 城墙剖面（雉堊数 = 等级）。
 * 替掉 `interaction.ts` 攻城框里的 `'★'.repeat(wall)` 文本符号。
 * 等级 0 不出图标（那句话整体换成「无城墙，野战」文字，不再是符号）。
 */
function wallLevelIcon(pb: PixBuf, level: number): void {
  const stone = '#9b948a';
  // 城墙身
  pb.rect(2, 9, 14, 6, stone);
  pb.rect(2, 9, 14, 2, shade(stone, 0.18));
  pb.rect(2, 13, 14, 2, shade(stone, -0.22));
  // 雉堊：等级 1 = 左右两座；等级 2 = 左中右三座
  const merlons = level >= 2 ? [2, 7, 12] : [2, 12];
  for (const mx of merlons) pb.rect(mx, 5, 4, 4, stone);
  pb.outline('#3a2a18', 0.85);
}

/* ---------------- 打包 ---------------- */

/** 一帧在图集里的落点（打包器产出的几何，不含锚点）。 */
export interface PackItem {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 图集容量体检报告。给 `tools/atlasaudit.mjs`（#24）做机检断言用。 */
export interface PackMetrics {
  /** 图集画布尺寸。 */
  w: number;
  h: number;
  /** 落点清单，按打包顺序。 */
  items: PackItem[];
  /** 行数（不同 y 的行数）。 */
  rows: number;
  /** 最宽一行的宽度（px）。 */
  maxRowW: number;
  /** 纵向占用：最后一帧的底边 y+h。 */
  usedH: number;
  /** 落点面积总和（px²，不含 2px 间隙）。 */
  usedPx: number;
  /** 越界帧：x+w>W 或 y+h>H。这些帧会被画布**静默裁掉**——运行时不报错，只是精灵消失。 */
  overflow: PackItem[];
}

/** 行式打包器的游标。冒险图集（Packer）与战斗图集（Shelf）共用。 */
export interface ShelfCursor {
  px: number;
  py: number;
  rowH: number;
}

/**
 * 换行规则（**唯一一份**）：本行放不下就换行，行高取本行最高帧，行间留 2px。
 *
 * 冒险图集的 `Packer` 与战斗图集的 `Shelf` 都走这里；审计脚本 `tools/atlasaudit.mjs`
 * 复算容量时也走这里 —— 规则只有一份，审计的尺子和运行时是同一把尺子，
 * 不会出现"审计说装得下、运行时却裁掉"的偏差。
 */
export function shelfAdvance(cur: ShelfCursor, w: number, itemW: number): void {
  if (cur.px + itemW > w) {
    cur.px = 0;
    cur.py += cur.rowH + 2;
    cur.rowH = 0;
  }
}

/** 图集装不下时的运行时提示（战斗图集也用）：只 warn，不抛 —— 抛了就是开局白屏，比少几个精灵更糟。 */
export function warnOverflow(label: string, m: PackMetrics): void {
  const names = m.overflow.slice(0, 5).map((i) => `${i.name}@(${i.x},${i.y}) ${i.w}×${i.h}`);
  console.warn(
    `[图集容量] ${label} ${m.w}×${m.h} 装不下：${m.overflow.length} 帧越界` +
      `（最低需要 y=${m.usedH}）→ ${names.join(' · ')}${m.overflow.length > 5 ? ' …' : ''}`,
  );
}

/** 从落点清单算容量指标（纯函数，不碰 canvas）。 */
export function packMetrics(items: readonly PackItem[], w: number, h: number): PackMetrics {
  const rows = new Set<number>();
  const overflow: PackItem[] = [];
  let maxRowW = 0;
  let usedH = 0;
  let usedPx = 0;
  let rowEnd = 0;
  let prevY = -1;
  for (const it of items) {
    if (it.y !== prevY) {
      if (prevY >= 0) maxRowW = Math.max(maxRowW, rowEnd);
      rowEnd = 0;
      prevY = it.y;
      rows.add(it.y);
    }
    rowEnd = Math.max(rowEnd, it.x + it.w);
    usedH = Math.max(usedH, it.y + it.h);
    usedPx += it.w * it.h;
    if (it.x + it.w > w || it.y + it.h > h) overflow.push(it);
  }
  maxRowW = Math.max(maxRowW, rowEnd);
  return { w, h, items: items.slice(), rows: rows.size || 0, maxRowW, usedH, usedPx, overflow };
}

/**
 * 纯函数版行式打包：只算落点，不画。
 * 审计脚本拿它做**分辨力自检**（把画布缩到 256×256 复算，必须报越界）。
 */
export function shelfPack(
  sizes: readonly { name: string; w: number; h: number }[],
  w: number,
  h: number,
): PackMetrics {
  const cur: ShelfCursor = { px: 0, py: 0, rowH: 0 };
  const items: PackItem[] = [];
  for (const s of sizes) {
    shelfAdvance(cur, w, s.w);
    items.push({ name: s.name, x: cur.px, y: cur.py, w: s.w, h: s.h });
    cur.px += s.w + 2;
    cur.rowH = Math.max(cur.rowH, s.h);
  }
  return packMetrics(items, w, h);
}

class Packer {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cur: ShelfCursor = { px: 0, py: 0, rowH: 0 };
  private items: PackItem[] = [];

  constructor(w: number, h: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建图集画布');
    this.ctx = ctx;
  }

  place(name: string, pb: PixBuf, ax?: number, ay?: number): Frame {
    const c = pb.toCanvas();
    shelfAdvance(this.cur, this.canvas.width, c.width);
    this.ctx.drawImage(c, this.cur.px, this.cur.py);
    const f: Frame = {
      x: this.cur.px,
      y: this.cur.py,
      w: c.width,
      h: c.height,
      ax: ax ?? Math.round((TILE - c.width) / 2),
      ay: ay ?? TILE - c.height,
    };
    this.items.push({ name, x: f.x, y: f.y, w: f.w, h: f.h });
    this.cur.px += c.width + 2;
    this.cur.rowH = Math.max(this.cur.rowH, c.height);
    return f;
  }

  metrics(): PackMetrics {
    return packMetrics(this.items, this.canvas.width, this.canvas.height);
  }
}

export class Atlas {
  readonly canvas: HTMLCanvasElement;
  /** 容量体检报告（#24）：给审计脚本读，运行时不消耗它。 */
  readonly metrics: PackMetrics;
  private frames = new Map<string, Frame>();
  private urls = new Map<string, string>();

  private constructor(packer: Packer) {
    this.canvas = packer.canvas;
    this.metrics = packer.metrics();
    if (this.metrics.overflow.length) warnOverflow('冒险图集', this.metrics);
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
            const nm = `g_water_${v}_${p}`;
            frames.set(nm, packer.place(nm, terrainTile('water', v, p), 0, 0));
          }
        }
      } else {
        for (let v = 0; v < 3; v++) {
          const nm = `g_${kind}_${v}`;
          frames.set(nm, packer.place(nm, terrainTile(kind, v), 0, 0));
        }
      }
    }

    for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      frames.set(`sh_${d}`, packer.place(`sh_${d}`, shoreTile(d), 0, 0));
    }

    const put = (name: string, pb: PixBuf, ax?: number, ay?: number): void => {
      frames.set(name, packer.place(name, pb, ax, ay));
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

    for (const k of MINE_KINDS) put(mineArtName(k), buildMineArt(k));

    b = p(32, 44);
    vault(b);
    put('vault', b);

    // §21.8 属性物件：只出**用得到**的 6 帧（不按 9 个名字出图，见 statShrine 注释）
    const STAT_COLOR = {
      attack: '#c0392b',
      defense: '#2e6fb5',
      spellPower: '#7b4fa8',
      knowledge: '#c9a227',
    } as const;
    for (const [stat, pips] of [
      ['attack', 1], ['attack', 2],
      ['defense', 1],
      ['spellPower', 1],
      ['knowledge', 1], ['knowledge', 2],
    ] as Array<[keyof typeof STAT_COLOR, number]>) {
      b = p(32, 42);
      statShrine(b, STAT_COLOR[stat], pips);
      put(`stat_${stat}_${pips}`, b);
    }

    for (const key of SPRITE_OWNERS) {
      const { roof } = ownerPalette(key);
      for (let t = 0; t < 4; t++) {
        // 城镇/城堡帧一律走 buildXxxFrame（画布尺寸只有那一份真源，门控也读它）
        put(`town_${key}_${t}`, buildTownFrame(key, t));
        // 2×2 城堡：往上、往左右各借一点边界，落点对齐见 render/MapRenderer
        put(`castle_${key}_${t}`, buildCastleFrame(key, t), CASTLE_AX, CASTLE_AY);
      }
      /* S5（§2.4 第三条链）：魔法行会三阶外形，只给城镇面板的行会卡用。
         44×44 与地图的 town_/castle_ 两套帧无关 —— 别互相借帧。 */
      for (let t = 1; t <= 3; t++) put(guildArtName(key, t), buildGuildArt(key, t));
      /* B1（M5）：其余 13 座建筑的城镇外观，同样 44×44、同样只进描述浮层。
         与 guild 分开注册是因为行会那三帧有自己的闸门与读数（S5），别在同一批里改。 */
      for (const id of BUILDING_ART_IDS) put(buildingArtName(key, id), buildBuildingArt(key, id));
      /* B2：兵营线五座的 Lv.2 / Lv.3（5 × 2 × 4 = 40 帧）。
         Lv.1 走上面那一行（帧名不带后缀）；这里只补升级档，别把 Lv.1 再注册一遍。 */
      for (const id of DWELLING_TIER_IDS) {
        for (let t = 2; t <= MAX_BUILDING_TIER; t++) {
          put(buildingArtName(key, id, t), buildBuildingArt(key, id, 1, t));
        }
      }
      b = p(32, 44);
      hero(b, roof);
      put(`hero_${key}`, b);
    }

  // 中立怪地图图标（TP-4② 翻新）：一律走 buildMonFrame（画布尺寸只有那一份真源，门控也读它）
  put('mon_wolf', buildMonFrame('wolf'));
  put('mon_boar', buildMonFrame('boar'));
  put('mon_ogre', buildMonFrame('ogre'));

  // B0 + B1 批（asset-spec §9.1 / §9.2）：地图兵种槽位 `u_<faction>_<unit>_map` 52×44（D-73 二次加宽至 52），
  // 锚点走 Packer 默认（ax=(TILE-w)/2、ay=TILE-h 贴地），与 §1.2 网格表一致。
  for (const spec of UNIT_FRAMES) {
    if (spec.kind !== 'map') continue;
    put(spec.name, buildB0Frame(spec.name));
  }

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

    // UI 状态图标（D-38③ / UX Q8）：稀有聚合槽 + 音效两态 + 光照两态 + 音乐两态（TP-3）。
    // 帧名以 asset-spec.md §2.3.1 为准（引区块、不引散行）。18×18 与既有 ic_* 同尺度。
    b = p(18, 18);
    rareBagIcon(b);
    put('ic_rare', b);
    for (const [name, on] of [['ic_sound_on', true], ['ic_sound_off', false]] as [string, boolean][]) {
      b = p(18, 18);
      soundIcon(b, on);
      put(name, b);
    }
    for (const [name, on] of [['ic_light_on', true], ['ic_light_off', false]] as [string, boolean][]) {
      b = p(18, 18);
      lightIcon(b, on);
      put(name, b);
    }
    for (const [name, on] of [['ic_music_on', true], ['ic_music_off', false]] as [string, boolean][]) {
      b = p(18, 18);
      musicIcon(b, on);
      put(name, b);
    }
    // TP-6③（F-3.5）：教学清单勾选两态 + 城防等级两态。替 HeroPanel ☑/☐ 与
    // interaction.ts 攻城框 ★ 文本符号（G-17 同族：不用文字当图标）。
    for (const [name, done] of [['ic_obj_done', true], ['ic_obj_todo', false]] as [string, boolean][]) {
      b = p(18, 18);
      objCheckIcon(b, done);
      put(name, b);
    }
    for (const lv of [1, 2]) {
      b = p(18, 18);
      wallLevelIcon(b, lv);
      put(`ic_wall_${lv}`, b);
    }

    for (let k = 0; k < 6; k++) {
      b = p(16, 16);
      decoration(b, k);
      put(`deco_${k}`, b);
    }

    /**
     * 兵牌立绘 `pt_*`（S2 · 22×30 全身缩略，§16.9④）。
     *
     * 为什么进**这张**图集而不是战斗图集：
     *   · 战斗图集是 1024×512，最宽行已到 1005/1024，22×30 的帧塞不进去；
     *   · 这张是 2048×2048，23 帧只占约 0.3%，而 `audit:atlas` 的红线
     *     （横向 ≤2042 / 纵向 ≤2048）本来就在这条图上量。
     *
     * ⚠️ **必须放在 build() 的最后**（2026-11-01 实测）：这批帧一开始插在
     * `u_*_map` 之后，结果把一条**本来正好 2042/2048** 的窄行顶到了 2048/2048
     * —— 压线没越界，但已经踩到红线上（`audit:atlas` 只会报"装得下"，
     * 拦不住这件事）。追加到末尾则只往最后一行（原本就只用到 562px）里长，
     * 前三条行的落点**逐帧不变**。
     *
     * 为什么按 `kind === 'idle'` 而不是按 20 个新 id：中立野怪（狼/猪/食人魔）
     * 也会出现在战场上，**任何能上场的单位都必须有立绘**，否则那张牌上是空的。
     * 帧名由 `portraitOfCombatFrame` 统一给（别名层自带），这里不拼字符串。
     */
    for (const spec of UNIT_FRAMES) {
      if (spec.kind !== 'idle') continue;
      put(portraitOfCombatFrame(spec.name), buildPortraitFrame(spec.name));
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
