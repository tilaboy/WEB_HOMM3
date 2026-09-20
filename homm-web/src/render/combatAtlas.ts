/**
 * 战斗场景专用精灵图集。
 *
 * 与冒险地图的 atlas.ts 分开的原因：战斗里的单位要"看得清"，
 * 尺寸更大（64×56 vs 52×44）、姿势站直、脚下带队伍色圆环，
 * 和地图上那些斜着看的小图标是两套东西，混在一张图里只会互相迁就。
 *
 * 依然全部程序化绘制：零外部素材，启动一次性烘焙，之后只做 drawImage。
 */
import { PixBuf, hash2, shade } from './pixel.js';
import { UNIT_FRAMES, buildB0Frame } from './unitArt.js';
// 打包规则与冒险图集共用同一份（#24）：换行/行高/2px 间隙只有一处实现，
// 审计脚本 `tools/atlasaudit.mjs` 复算容量时拿到的就是运行时这套规则。
import { shelfAdvance, packMetrics, warnOverflow, type PackItem, type PackMetrics, type ShelfCursor } from './atlas.js';

export interface CFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 相对锚点（格子中心）的绘制偏移。 */
  ax: number;
  ay: number;
}

class Shelf {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cur: ShelfCursor = { px: 0, py: 0, rowH: 0 };
  private items: PackItem[] = [];

  constructor(readonly w: number, readonly h: number) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('无法创建图集画布');
    this.canvas = c;
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
  }

  place(name: string, pb: PixBuf, ax = 0, ay = 0): CFrame {
    const c = pb.toCanvas();
    shelfAdvance(this.cur, this.w, c.width);
    this.ctx.drawImage(c, this.cur.px, this.cur.py);
    const f: CFrame = { x: this.cur.px, y: this.cur.py, w: c.width, h: c.height, ax, ay };
    this.items.push({ name, x: f.x, y: f.y, w: f.w, h: f.h });
    this.cur.px += c.width + 2;
    this.cur.rowH = Math.max(this.cur.rowH, c.height);
    return f;
  }

  metrics(): PackMetrics {
    return packMetrics(this.items, this.w, this.h);
  }
}

export class CombatAtlas {
  private frames = new Map<string, CFrame>();
  private urls = new Map<string, string>();
  /** 容量体检报告（#24）：给审计脚本读。 */
  readonly metrics: PackMetrics;

  private constructor(readonly canvas: HTMLCanvasElement, metrics: PackMetrics) {
    this.metrics = metrics;
    if (metrics.overflow.length) warnOverflow('战斗图集', metrics);
  }

  get(name: string): CFrame | null {
    return this.frames.get(name) ?? null;
  }

  need(name: string): CFrame {
    const f = this.frames.get(name);
    if (!f) throw new Error(`缺少战斗精灵帧：${name}`);
    return f;
  }

  has(name: string): boolean {
    return this.frames.has(name);
  }

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

  static build(): CombatAtlas {
    const shelf = new Shelf(1024, 512);
    const frames = new Map<string, CFrame>();
    const put = (name: string, pb: PixBuf, ax = 0, ay = 0): void => {
      frames.set(name, shelf.place(name, pb, ax, ay));
    };

    for (let v = 0; v < 4; v++) put(`cf_${v}`, hexFloor(v), -20, -23);
    put('chi_move', hexOverlay('#4a86d8', 0.34, '#9fd0ff', '#dff0ff'), -20, -23);
    put('chi_atk', hexOverlay('#c0392b', 0.36, '#ff8f7a', '#ffd9cf'), -20, -23);
    put('chi_sel', hexOverlay('#e8be5a', 0.18, '#ffdf8a', '#fff3c8'), -20, -23);
    put('chi_hover', hexOverlay('#ffffff', 0.1, '#ffffff', '#ffffff'), -20, -23);
    // 施法目标：紫色，和移动蓝/攻击红区分开
    put('chi_spell', hexOverlay('#8e44ad', 0.34, '#d7a6ef', '#f0d9ff'), -20, -23);

    put('cbase_0', teamRing('#2f6fbf', '#9fd0ff'), -20, -8);
    put('cbase_1', teamRing('#a8322a', '#ff9b8c'), -20, -8);

    for (const id of ['peasant', 'archer', 'pikeman', 'knight', 'angel', 'wolf', 'boar', 'ogre']) {
      const pb = new PixBuf(44, 56);
      drawCombatUnit(pb, id);
      pb.outline('#1b1410', 0.9);
      put(`cu_${id}`, pb, -22, -48);
    }

    // B0 + B1 批（asset-spec §9.1 / §9.2）：战斗兵种槽位 `cu_<faction>_<unit>` 与
    // 预烘焙攻击帧 `cu_<faction>_<unit>_atk`，64×56，锚点 ax=-32 / ay=-48
    // （真值取自 `UNIT_FRAMES`，D-73 `acb5d50` 加宽；此处注释勿再写死旧值）。
    // ⚠️ R-5：短名 lampbearer / scavenger / hornxbow / axethrower / dwarf / thornarcher /
    //   stoneimp / fireapprentice 是 asset-spec §3.2 + §2.2 的建议值，等 races.ts 定稿后对齐。
    for (const spec of UNIT_FRAMES) {
      if (spec.kind === 'map') continue;
      put(spec.name, buildB0Frame(spec.name), spec.ax, spec.ay);
    }

    const atlas = new CombatAtlas(shelf.canvas, shelf.metrics());
    atlas.frames = frames;
    return atlas;
  }
}

let cached: CombatAtlas | null = null;

export function getCombatAtlas(): CombatAtlas {
  if (!cached) cached = CombatAtlas.build();
  return cached;
}

/* ---------------- hex ---------------- */

const HW = 40;
const HH = 46;
const HEX_PTS: [number, number][] = [
  [20, 1],
  [39, 12],
  [39, 34],
  [20, 45],
  [1, 34],
  [1, 12],
];

function strokePoly(pb: PixBuf, pts: [number, number][], color: string): void {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    pb.line(a[0], a[1], b[0], b[1], color);
  }
}

function hexFloor(variant: number): PixBuf {
  const pb = new PixBuf(HW, HH);
  const ramp = ['#3f6630', '#4b7538', '#578441', '#64944b', '#71a455'];
  const base = rampPick(ramp, 0.5 + hash2(variant, 7, 11) * 0.2);
  pb.poly(HEX_PTS, base);
  const seed = variant * 977 + 13;
  // 逐像素噪声：让每块地砖都不一样，但同 variant 的砖拼起来完全一致
  for (let y = 0; y < HH; y++) {
    for (let x = 0; x < HW; x++) {
      if (pb.alphaAt(x, y) < 200) continue;
      const n = hash2(x + variant * 31, y, seed);
      if (n < 0.12) pb.set(x, y, shade(base, -0.22));
      else if (n > 0.9) pb.set(x, y, shade(base, 0.18));
    }
  }
  for (let i = 0; i < 10; i++) {
    const x = 3 + Math.floor(hash2(i, 3, seed) * 34);
    const y = 4 + Math.floor(hash2(i, 5, seed) * 38);
    if (pb.alphaAt(x, y) > 200) {
      pb.set(x, y, shade(base, -0.3));
      pb.set(x, y - 1, shade(base, 0.25));
    }
  }
  // 内侧描一圈暗边，格子之间才有"格子感"（要足够深，否则绿底上一片糊）
  strokePoly(pb, HEX_PTS, '#16260f');
  strokePoly(
    pb,
    [
      [20, 2],
      [38, 12],
      [38, 34],
      [20, 44],
      [2, 34],
      [2, 12],
    ],
    shade(base, 0.22),
  );
  return pb;
}

function hexOverlay(fill: string, alpha: number, ring: string, inner: string): PixBuf {
  const pb = new PixBuf(HW, HH);
  pb.poly(HEX_PTS, fill, alpha);
  strokePoly(pb, HEX_PTS, ring);
  const inset: [number, number][] = [
    [20, 3],
    [37, 13],
    [37, 33],
    [20, 43],
    [3, 33],
    [3, 13],
  ];
  strokePoly(pb, inset, inner);
  return pb;
}

function rampPick(ramp: string[], t: number): string {
  const i = Math.max(0, Math.min(ramp.length - 1, Math.floor(t * ramp.length)));
  return ramp[i];
}

/** 队伍色圆环：画在单位脚下，一眼分清敌我。 */
function teamRing(body: string, light: string): PixBuf {
  const pb = new PixBuf(40, 22);
  pb.ellipse(20, 11, 15, 6, body, 0.75);
  pb.ellipse(20, 11, 11, 4, shade(body, 0.35), 0.55);
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    pb.set(Math.round(20 + Math.cos(a) * 15), Math.round(11 + Math.sin(a) * 6), light, 0.9);
  }
  return pb;
}

/* ---------------- units ---------------- */

interface Look {
  skin: string;
  hair: string;
  cloth: string;
  clothDark: string;
  metal: string;
  metalDark: string;
  accent: string;
  weapon: 'bow' | 'spear' | 'sword' | 'staff' | 'none';
  shield?: boolean;
  helm?: 'none' | 'cap' | 'great';
  wings?: string;
  scale?: number;
}

function shadow(pb: PixBuf, cx: number, y: number, rx: number, ry: number): void {
  pb.ellipse(cx, y, rx, ry, '#000000', 0.28);
}

/** 通用人形：脚在 y=52，头顶约 y=8。 */
function humanoid(pb: PixBuf, o: Look): void {
  const cx = 22;
  shadow(pb, cx, 53, 11, 3);

  // 腿
  pb.rect(cx - 6, 40, 4, 12, o.clothDark);
  pb.rect(cx + 2, 40, 4, 12, o.clothDark);
  pb.rect(cx - 6, 49, 4, 3, shade(o.clothDark, -0.35));
  pb.rect(cx + 2, 49, 4, 3, shade(o.clothDark, -0.35));

  // 躯干
  pb.rect(cx - 7, 26, 14, 15, o.cloth);
  pb.rect(cx - 7, 26, 14, 3, shade(o.cloth, 0.25));
  pb.rect(cx - 7, 38, 14, 3, shade(o.cloth, -0.3));
  // 胸甲高光
  pb.rect(cx - 5, 28, 10, 6, o.metal, 0.85);
  pb.rect(cx - 5, 28, 10, 1, shade(o.metal, 0.4));
  pb.rect(cx - 5, 33, 10, 1, shade(o.metal, -0.4));

  // 手臂
  pb.rect(cx - 10, 28, 3, 11, o.clothDark);
  pb.rect(cx + 7, 28, 3, 11, o.clothDark);
  pb.rect(cx - 10, 38, 3, 2, o.skin);
  pb.rect(cx + 7, 38, 3, 2, o.skin);

  // 头
  pb.ellipse(cx, 21, 5, 6, o.skin);
  pb.rect(cx - 4, 17, 8, 3, o.hair);
  pb.set(cx - 3, 22, '#1d1712');
  pb.set(cx + 2, 22, '#1d1712');
  pb.rect(cx - 1, 24, 2, 1, shade(o.skin, -0.35));

  if (o.helm === 'cap') {
    pb.rect(cx - 6, 15, 12, 4, o.metal);
    pb.rect(cx - 6, 15, 12, 1, shade(o.metal, 0.45));
    pb.rect(cx - 6, 18, 12, 1, shade(o.metal, -0.4));
  }
  if (o.helm === 'great') {
    pb.ellipse(cx, 20, 6, 7, o.metal);
    pb.ellipse(cx, 20, 6, 4, shade(o.metal, 0.3), 0.5);
    pb.rect(cx - 1, 13, 2, 8, o.accent);
    pb.rect(cx - 6, 19, 12, 2, '#1b1410');
  }

  if (o.wings) {
    const w = o.wings;
    for (let i = 0; i < 9; i++) {
      pb.rect(cx - 12 - i * 0.6, 24 - i, 5, 3, i % 2 ? w : shade(w, 0.25), 0.9);
      pb.rect(cx + 8 + i * 0.6, 24 - i, 5, 3, i % 2 ? w : shade(w, 0.25), 0.9);
    }
  }

  // 武器
  switch (o.weapon) {
    case 'sword': {
      pb.rect(cx + 12, 14, 2, 20, o.metal);
      pb.rect(cx + 12, 14, 2, 2, shade(o.metal, 0.5));
      pb.rect(cx + 10, 33, 6, 2, o.accent);
      break;
    }
    case 'spear': {
      pb.rect(cx + 11, 8, 2, 40, '#6b4a24');
      pb.poly(
        [
          [cx + 12, 4],
          [cx + 15, 12],
          [cx + 9, 12],
        ],
        o.metal,
      );
      pb.rect(cx + 10, 12, 4, 1, shade(o.metal, -0.4));
      break;
    }
    case 'bow': {
      pb.ellipse(cx + 11, 28, 4, 12, '#6b4a24', 0.0);
      for (let i = -11; i <= 11; i++) {
        const x = cx + 11 + Math.round(4 * (1 - (i / 11) * (i / 11)));
        pb.set(x, 28 + i, '#7a5327');
      }
      pb.line(cx + 11, 17, cx + 11, 39, '#e8e0c8', 0.9);
      pb.rect(cx - 12, 30, 4, 9, '#5b3f22'); // 箭袋
      for (let i = 0; i < 3; i++) pb.rect(cx - 11 + i, 26 - i * 2, 1, 5, o.accent);
      break;
    }
    case 'staff': {
      pb.rect(cx + 12, 12, 2, 34, '#6b4a24');
      pb.ellipse(cx + 13, 10, 3, 3, o.accent);
      pb.set(cx + 13, 10, '#ffffff', 0.9);
      break;
    }
    default:
      break;
  }

  if (o.shield) {
    pb.poly(
      [
        [cx - 15, 26],
        [cx - 7, 26],
        [cx - 7, 38],
        [cx - 11, 42],
        [cx - 15, 38],
      ],
      o.metal,
    );
    pb.poly(
      [
        [cx - 13, 28],
        [cx - 9, 28],
        [cx - 9, 35],
        [cx - 11, 37],
        [cx - 13, 35],
      ],
      o.accent,
      0.8,
    );
  }
}

function quadruped(pb: PixBuf, body: string, dark: string, eye: string, tusks: boolean): void {
  const cx = 22;
  shadow(pb, cx, 53, 13, 3);
  // 躯干
  pb.ellipse(cx - 1, 36, 13, 8, body);
  pb.ellipse(cx - 1, 33, 12, 5, shade(body, 0.18));
  // 腿
  for (const dx of [-9, -5, 5, 9]) pb.rect(cx + dx, 42, 4, 10, dark);
  for (const dx of [-9, 5]) pb.rect(cx + dx, 50, 4, 2, shade(dark, -0.3));
  // 头
  pb.ellipse(cx + 11, 30, 7, 6, body);
  pb.poly(
    [
      [cx + 17, 28],
      [cx + 21, 32],
      [cx + 17, 35],
    ],
    shade(body, -0.15),
  );
  pb.set(cx + 21, 32, '#14100c');
  pb.set(cx + 13, 29, eye);
  pb.poly(
    [
      [cx + 6, 24],
      [cx + 9, 20],
      [cx + 11, 25],
    ],
    dark,
  );
  if (tusks) {
    pb.line(cx + 19, 34, cx + 22, 31, '#f0ead6');
    pb.line(cx + 19, 35, cx + 22, 37, '#f0ead6');
  }
  // 尾
  pb.line(cx - 13, 34, cx - 19, 28, dark);
  pb.line(cx - 19, 28, cx - 21, 24, dark);
}

function drawCombatUnit(pb: PixBuf, id: string): void {
  switch (id) {
    case 'peasant':
      humanoid(pb, {
        skin: '#d8a878', hair: '#6b4a2a', cloth: '#9c8a63', clothDark: '#6f6042',
        metal: '#8b7c58', metalDark: '#5b4c33', accent: '#4b3d27', weapon: 'staff',
      });
      break;
    case 'archer':
      humanoid(pb, {
        skin: '#d8a878', hair: '#4a3a22', cloth: '#7c6236', clothDark: '#54421f',
        metal: '#b9a06a', metalDark: '#6b5a34', accent: '#e8d9a8', weapon: 'bow', helm: 'cap',
      });
      break;
    case 'pikeman':
      humanoid(pb, {
        skin: '#d8a878', hair: '#5a4630', cloth: '#6d7d8c', clothDark: '#454f5b',
        metal: '#aab6c2', metalDark: '#5f6b78', accent: '#c0392b', weapon: 'spear', helm: 'cap', shield: true,
      });
      break;
    case 'knight':
      humanoid(pb, {
        skin: '#d8a878', hair: '#3a2f22', cloth: '#5a6a8a', clothDark: '#37425a',
        metal: '#c8ccd8', metalDark: '#7a8090', accent: '#4f7fbf', weapon: 'sword', helm: 'great', shield: true,
      });
      break;
    case 'angel':
      humanoid(pb, {
        skin: '#f0d8c0', hair: '#e3b869', cloth: '#f4f4f7', clothDark: '#c8c8d4',
        metal: '#f8f8fb', metalDark: '#a8a8b8', accent: '#e3b869', weapon: 'sword', wings: '#fbfbff',
      });
      break;
    case 'wolf':
      quadruped(pb, '#8a8a92', '#3a3a42', '#d8c23a', false);
      break;
    case 'boar':
      quadruped(pb, '#6b4a2f', '#241a10', '#c86a2a', true);
      break;
    case 'ogre': {
      const cx = 22;
      shadow(pb, cx, 53, 13, 3);
      pb.rect(cx - 10, 24, 20, 20, '#4f6b3a');
      pb.rect(cx - 10, 24, 20, 4, '#639050');
      pb.rect(cx - 10, 40, 20, 4, '#33471f');
      pb.rect(cx - 13, 26, 4, 16, '#3a5029');
      pb.rect(cx + 9, 26, 4, 16, '#3a5029');
      pb.rect(cx - 8, 44, 7, 8, '#3a5029');
      pb.rect(cx + 2, 44, 7, 8, '#3a5029');
      pb.ellipse(cx, 18, 7, 7, '#5f7a44');
      pb.rect(cx - 6, 13, 12, 3, '#2e3f1c');
      pb.set(cx - 3, 18, '#e8d84a');
      pb.set(cx + 3, 18, '#e8d84a');
      pb.rect(cx - 3, 22, 6, 2, '#241a10');
      pb.line(cx - 2, 22, cx - 2, 21, '#f0ead6');
      pb.line(cx + 2, 22, cx + 2, 21, '#f0ead6');
      // 狼牙棒
      pb.rect(cx + 14, 16, 3, 26, '#5b3f22');
      pb.ellipse(cx + 15, 14, 5, 5, '#7a6a55');
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pb.rect(Math.round(cx + 15 + Math.cos(a) * 5) - 1, Math.round(14 + Math.sin(a) * 5) - 1, 2, 2, '#c9c2ad');
      }
      break;
    }
    default:
      humanoid(pb, {
        skin: '#d8a878', hair: '#4a3a22', cloth: '#7c6236', clothDark: '#54421f',
        metal: '#b9a06a', metalDark: '#6b5a34', accent: '#e8d9a8', weapon: 'none',
      });
  }
}
