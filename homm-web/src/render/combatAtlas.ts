/**
 * 战斗场景专用精灵图集。
 *
 * 与冒险地图的 atlas.ts 分开的原因：战斗里的单位要"看得清"，
 * 尺寸更大（64×56 vs 52×44）、姿势站直、脚下带队伍色圆环，
 * 和地图上那些斜着看的小图标是两套东西，混在一张图里只会互相迁就。
 *
 * 依然全部程序化绘制：零外部素材，启动一次性烘焙，之后只做 drawImage。
 */
import { PixBuf, hash2, mix, shade } from './pixel.js';
import { UNIT_FRAMES, buildB0Frame } from './unitArt.js';
import { BATTLE_BG_ORDER, BATTLE_BG_SPECS, floorRamp, type BattleBg } from './battleBg.js';
// 打包规则与冒险图集共用同一份（#24）：换行/行高/2px 间隙只有一处实现，
// 审计脚本 `tools/atlasaudit.mjs` 复算容量时拿到的就是运行时这套规则。
import { shelfAdvance, packMetrics, warnOverflow, type PackItem, type PackMetrics, type ShelfCursor } from './atlas.js';

/**
 * 退役 p1 别名帧（44×56，`drawCombatUnit` 手绘 switch）—— **S3a 起为空**。
 *
 * 历史：2026-10-14 四族 T5 曾因帧表没有 `cu_*`、`BattleRenderer` 静默 `return`，
 * 战斗中只剩队伍色底盘圈且无人察觉（`tools/b0audit.mjs` 的 `[C]` 就是为此加的）。
 * 2026-11-06 S3a 把 p1 五个兵按新体形档重画成真帧（`unitBodyPlan.ts`）并删掉
 * `FRAME_ALIAS` 的五条别名 ⇒ `cu_peasant` / `cu_archer` / `cu_pikeman` / `cu_knight`
 * / `cu_angel` 再无消费者，整批退出烘焙（省下 5×44×56 的图集空间，正好给新增的
 * 10 个 64×56 帧腾位置）。`drawCombatUnit()` 函数本身保留 —— 它只服务这条过渡路径，
 * 当前清单为空 ⇒ 实际不会执行，删掉它反而会让「将来再出现过渡帧」时无路可走。
 *
 * 保留这个空数组而不是删掉导出：`b0audit` 的 `[C]` 按「`UNIT_FRAMES` ∪ 本清单」
 * 算供给，删掉导出会让那条断言直接 import 失败。将来若再出现"图集里有、请求侧没有"
 * 的过渡帧，往这里加仍然是正确做法。
 */
export const LEGACY_COMBAT_SPRITE_IDS: readonly string[] = [];

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

    // 地砖锚点 = 格心在像素盒里的位置取负；与 HW/HH/HEX_CX/HEX_CY 同源，
    // 换格尺寸时不许只改一边（否则地砖整体相对单位偏移）。
    //
    // §11.1：五套地形各 4 块（`cf_<bg>_<v>` = 20 帧）。**同一份几何、只换颜色** ——
    // 斑点位置由 `hash2(variant, …)` 决定，与套无关，所以两套之间可以逐像素对照
    // （只有 RGB 不同、alpha 通道完全相同），这正是"0 新图集"能成立的原因。
    // `cf_<v>` 保留为 grass 的别名：历史探针/截图脚本按旧名取帧，改名会让它们
    // 静默拿到 undefined（`need()` 才抛，而它们直接读 frames）。
    for (const bg of BATTLE_BG_ORDER) {
      for (let v = 0; v < 4; v++) put(`cf_${bg}_${v}`, hexFloor(v, bg), -HEX_CX, -HEX_CY);
    }
    for (let v = 0; v < 4; v++) frames.set(`cf_${v}`, frames.get(`cf_grass_${v}`)!);
    put('chi_move', hexOverlay('#4a86d8', 0.34, '#9fd0ff', '#dff0ff'), -HEX_CX, -HEX_CY);
    put('chi_atk', hexOverlay('#c0392b', 0.36, '#ff8f7a', '#ffd9cf'), -HEX_CX, -HEX_CY);
    put('chi_sel', hexOverlay('#e8be5a', 0.18, '#ffdf8a', '#fff3c8'), -HEX_CX, -HEX_CY);
    put('chi_hover', hexOverlay('#ffffff', 0.1, '#ffffff', '#ffffff'), -HEX_CX, -HEX_CY);
    // 施法目标：紫色，和移动蓝/攻击红区分开
    put('chi_spell', hexOverlay('#8e44ad', 0.34, '#d7a6ef', '#f0d9ff'), -HEX_CX, -HEX_CY);

    put('cbase_0', teamRing('#2f6fbf', '#9fd0ff'), -20, -8);
    put('cbase_1', teamRing('#a8322a', '#ff9b8c'), -20, -8);

    for (const id of LEGACY_COMBAT_SPRITE_IDS) {
      const pb = new PixBuf(44, 56);
      drawCombatUnit(pb, id);
      pb.outline('#1b1410', 0.9);
      put(`cu_${id}`, pb, -22, -48);
    }

    // 说明：S3a 后 `LEGACY_COMBAT_SPRITE_IDS` 为空，上面这个循环当前不产生任何帧。
    // 保留循环体是为了将来过渡期的帧仍走同一条路径（别改成 if / 特例）。

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

/**
 * 格精灵像素盒 **31×36**：几何是 30.3×35（`hex.ts` 的 `HEX_SPRITE_W/H`），
 * 像素缓冲必须取整，所以四周各多留半像素。中心固定在 (15.15, 17.5)，
 * 因此 `put(...)` 的锚点是 **−15.15 / −17.5** —— 换格尺寸时**这两处一起改**，
 * 只改一处会让整片地砖相对单位平移（表现为单位浮在格缝上）。
 *
 * 2026-10-31 E1：R 22 → 17.5，盒从 40×46 收到 31×36。旧盒是给 R=22 的尖角留白的，
 * 缩格后不留白；再留白会在 30px 格上读成一圈黑边。
 */
const HW = 31;
const HH = 36;
/** 格心在像素盒里的位置（= `HEX_SPRITE_W/2, HEX_SPRITE_H/2`）。 */
const HEX_CX = 15.15;
const HEX_CY = 17.5;

/** 以 (cx,cy) 为心、外接圆 r 的尖顶六边形顶点；`inset` 用于内圈描边。 */
function hexPts(cx: number, cy: number, r: number, inset = 0): [number, number][] {
  const h = r - inset;
  const w = (Math.sqrt(3) / 2) * h;
  return [
    [cx, cy - h],
    [cx + w, cy - h / 2],
    [cx + w, cy + h / 2],
    [cx, cy + h],
    [cx - w, cy + h / 2],
    [cx - w, cy - h / 2],
  ];
}

const HEX_PTS = hexPts(HEX_CX, HEX_CY, 17.5);

function strokePoly(pb: PixBuf, pts: [number, number][], color: string): void {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    pb.line(a[0], a[1], b[0], b[1], color);
  }
}

function hexFloor(variant: number, bg: BattleBg = 'grass'): PixBuf {
  const pb = new PixBuf(HW, HH);
  const ramp = floorRamp(bg);
  const base = rampPick(ramp, 0.5 + hash2(variant, 7, 11) * 0.2);
  pb.poly(HEX_PTS, base);
  const seed = variant * 977 + 13;
  // 逐像素噪声：让每块地砖都不一样，但同 variant 的砖拼起来完全一致。
  // ⚠️ 幅度**必须小于地纹**（`groundMarks` 用 ±0.3~0.45）：噪声一旦压过地纹，
  //    地纹就变成"斑点里的杂色"，读不出形状（首轮实测：雪原的冰裂整条消失在噪点里，
  //    沼泽的水洼反倒是全砖最亮的一条 —— 因为噪声没给后面的形状留余量）。
  for (let y = 0; y < HH; y++) {
    for (let x = 0; x < HW; x++) {
      if (pb.alphaAt(x, y) < 200) continue;
      const n = hash2(x + variant * 31, y, seed);
      // 雪原的颗粒要更细更浅：同一个 9% 的暗点在浅蓝白底上比在草地上显眼一倍，
      // 首轮直接读成"雪地脏了"（雪是五套里唯一不能靠"脏"来表达质感的一套）
      const pDark = bg === 'snow' ? 0.045 : 0.09;
      const amtDark = bg === 'snow' ? -0.1 : -0.16;
      if (n < pDark) pb.set(x, y, shade(base, amtDark));
      else if (n > 0.93) pb.set(x, y, shade(base, 0.13));
    }
  }
  // 碎石：位置按新盒收（旧值 34/38 是按 40×46 算的，照搬会全落到格角外）
  // 雪原不铺碎石：`shade(base,-0.3)` 在浅蓝白底上会读成"雪地上的脏点"，
  // 雪原的碎屑由 `groundMarks()` 用**亮**的冰屑画（方向相反）。
  if (bg !== 'snow') {
    for (let i = 0; i < 6; i++) {
      const x = 2 + Math.floor(hash2(i, 3, seed) * 27);
      const y = 3 + Math.floor(hash2(i, 5, seed) * 30);
      if (pb.alphaAt(x, y) > 200) {
        pb.set(x, y, shade(base, -0.3));
        pb.set(x, y - 1, shade(base, 0.25));
      }
    }
  }
  // 地纹：见 `groundMarks()` 头注（规格 §11.1 表第 4 列）。
  groundMarks(pb, bg, base, seed, variant);
  // 内侧描一圈暗边，格子之间才有"格子感"（要足够深，否则绿底上一片糊）
  //
  // ⚠️ 暗边颜色**不能**按 base 派生：雪原的 base 是浅蓝白，`shade(base, -0.5)` 仍然
  //    比草地暗边亮 20 L*，格缝会在雪地上消失（整片雪地连成一块）。
  //    ⇒ 每套自带 `ink`（规格给的底色 / 我对暗部的手调）。内侧那圈亮边照旧派生。
  strokePoly(pb, HEX_PTS, BATTLE_BG_SPECS[bg].ink);
  strokePoly(pb, hexPts(HEX_CX, HEX_CY, 17.5, 1.2), shade(base, 0.22));
  return pb;
}

/**
 * 地纹（§11.1 表第 4 列）—— **同一块六边形，地上要长不同的东西**。
 *
 * 为什么非要有这一层：只换调色板时，×1 下读到的永远是"同一个场地换了五种颜色"
 * （三块砖并排看，噪声斑点、碎石位置逐像素相同）。§11.1 的判据（色相差 / 明度差）
 * 只保证"五套不一样"，保证不了"这是五个地方"—— 地点感靠的是**地上有什么**：
 * 草的草簇与小白花、土路的车辙与干草、雪原的冰裂与雪堆、沼泽的水洼与骨片、
 * 城战的石板缝与缝里的草。
 *
 * 三条纪律（都是本仓踩过的坑）：
 * ① 锚点一律落在**内切圆 r ≤ 12**（六边形外接半径 17.5）：贴到格边就会被格缝裁掉，
 *    读成"格缝上的杂色"；
 * ② **幅度要压过噪声**：逐像素噪声是 ±0.16，地纹取 ±0.3~0.45 —— 首轮把地纹也放在
 *    0.2 档，结果雪原的冰裂整条消失在噪点里、沼泽的水洼成了砖上最亮的一条横杠。
 *    地砖是**地面**不是贴纸，但"看不出形状的纹理"等于没有；
 * ③ 全部由 `variant + seed` 决定 ⇒ 同一块砖每帧一致，不同砖不同（§11.1 硬约束 3）。
 */
function groundMarks(pb: PixBuf, bg: BattleBg, base: string, seed: number, variant: number): void {
  /** 第 i 个锚点：极坐标 + 稳定抖动，限制在内切圆里。 */
  const A = (i: number): [number, number] => {
    const a = hash2(i, 21, seed) * Math.PI * 2;
    const r = 4 + hash2(i, 23, seed) * 7.5;
    return [Math.round(HEX_CX + Math.cos(a) * r), Math.round(HEX_CY + Math.sin(a) * r * 0.88)];
  };
  const inside = (x: number, y: number): boolean => pb.alphaAt(x, y) > 200;

  if (bg === 'grass') {
    // 草簇：三根草叶，间距 2px、中间最高 —— 挨着画会糊成一根柱子，等高会读成栅栏。
    // 顶端 1px 提亮 = "叶尖",否则整簇读成一团压暗的污渍（首轮实测）。
    // ⚠️ 四块砖里只长三块：每块都长一簇，×3 放大后是**等距圆点壁纸**（实测），
    //    地面感靠"疏密不均"，不靠"每格都有"。
    if (variant !== 3) {
      const [x, y] = A(0);
      const tip = variant % 2 ? 1 : -1; // 每块砖往不同方向歪，破"一模一样的草"
      for (let i = -1; i <= 1; i++) {
        const bx = x + i * 2;
        const hh = i === 0 ? 5 : i === tip ? 4 : 3;
        for (let k = 0; k < hh; k++) {
          // 越往上越往外斜 ⇒ 一簇"张开的草"，不是三根平行的竖线（首轮读成了 ılı）
          const px = bx + Math.round((k / Math.max(1, hh - 1)) * i);
          if (!inside(px, y - k)) continue;
          pb.set(px, y - k, k === hh - 1 ? shade(base, 0.22) : shade(base, -0.42));
        }
      }
    }
    // 土斑：3×2 压暗（草没长满的地方）—— 幅度必须低于草簇，否则两者抢
    const [sx, sy] = A(1);
    pb.rect(sx, sy, 3, 2, shade(base, -0.14));
    // 小白花：四块砖只有一块长，颜色压到米白（纯白 1px 会读成坏点）
    if (variant === 1) {
      const [fx, fy] = A(2);
      if (inside(fx, fy)) {
        pb.set(fx, fy, '#d8d3a6');
        pb.set(fx, fy + 1, shade(base, -0.42));
      }
    }
  } else if (bg === 'dirt') {
    // 车辙：两条**一样长、一样斜**的线，间距 2px —— 5px 太短会读成划痕，这里拉到 9px
    const [x, y] = A(0);
    const rut = shade(base, -0.36);
    pb.line(x - 4, y + 2, x + 4, y - 1, rut);
    pb.line(x - 4, y + 4, x + 4, y + 1, rut);
    // 干草：两根 3px 短线，暖色（与土同族但更亮、更黄）
    const [gx, gy] = A(1);
    const straw = mix('#d0a860', base, 0.4);
    pb.line(gx, gy, gx + 2, gy - 1, straw);
    pb.line(gx + 2, gy + 2, gx + 4, gy + 1, straw);
    // 一块有体积的石头：1px 的碎石读不出体积，2×2 + 亮顶才可以
    const [rx, ry] = A(2);
    pb.set(rx, ry, shade(base, -0.42));
    pb.set(rx + 1, ry, shade(base, -0.42));
    pb.set(rx, ry - 1, shade(base, 0.26));
    pb.set(rx + 1, ry - 1, shade(base, 0.26));
  } else if (bg === 'snow') {
    // 冰裂：五段折线、拉到 9px、**冷蓝**（灰会混进噪点里）—— 雪原唯一"硬边"的东西
    const [x, y] = A(0);
    const crack = mix('#7c93b0', base, 0.26);
    pb.line(x - 4, y - 1, x - 2, y, crack);
    pb.line(x - 2, y, x, y - 2, crack);
    pb.line(x, y - 2, x + 2, y - 1, crack);
    pb.line(x + 2, y - 1, x + 4, y - 3, crack);
    // 雪堆：3px 亮顶 + 下缘 1px 压暗（有体积才不像脏点）
    const [sx, sy] = A(1);
    pb.hline(sx, sx + 2, sy, '#f4f8fc');
    pb.hline(sx, sx + 2, sy + 1, shade(base, -0.16));
    // 蓝影：两段错开 1px 的冷灰（整块矩形会读成一条贴上去的横杠）
    const [bx2, by2] = A(2);
    const shadow = mix('#a9bdd4', base, 0.28);
    pb.hline(bx2, bx2 + 2, by2, shadow);
    pb.hline(bx2 + 1, bx2 + 3, by2 + 1, shadow);
  } else if (bg === 'swamp') {
    // 水洼：4 宽 × 2 高、上下两行错开 1px（对称椭圆会读成"一条 UI 横杠"）
    const [x, y] = A(0);
    const wet = shade(base, -0.45);
    pb.hline(x - 1, x + 2, y, wet);
    pb.hline(x - 2, x + 1, y + 1, wet);
    pb.set(x, y, mix('#7d97a0', base, 0.3)); // 一点反光就够，画成整条会抢眼
    // 苔斑：2×2 亮绿（湿地上的浮萍色）
    const [mx, my] = A(1);
    pb.rect(mx, my, 2, 2, mix('#5f7e2e', base, 0.65));
    // 骨片：每三块砖才有一块（满地骨头就变成墓地了）；横条 + 1px 折角，不画成十字
    if (variant % 3 === 1) {
      const [bx, by] = A(2);
      pb.hline(bx, bx + 2, by, '#bdb795');
      pb.set(bx + 2, by - 1, '#bdb795');
    }
  } else {
    // 城战：石板缝 = 一条 9px 折线（1px，跨过砖心）+ 一条 3px 支缝。
    // 首轮画成"7px 横 + 4px 竖"的 T 形 ⇒ 读成砖心浮着一个 T 字，不像缝：
    // 缝必须**长、细、带折**，而且要接到靠近格边的位置。
    const [x, y] = A(0);
    const seam = shade(base, -0.38);
    pb.line(x - 4, y + 1, x - 1, y, seam);
    pb.line(x - 1, y, x + 4, y - 1, seam);
    pb.line(x, y - 1, x + 1, y - 3, seam);
    // 泥：2×2 压暗（车马踩出来的）
    const [mx, my] = A(1);
    pb.rect(mx, my, 2, 2, shade(base, -0.16));
    // 缝里长的草：两点，低饱和
    const [wx, wy] = A(2);
    const weed = mix('#5b6b33', base, 0.45);
    pb.set(wx, wy, weed);
    pb.set(wx + 1, wy - 1, weed);
  }
}

function hexOverlay(fill: string, alpha: number, ring: string, inner: string): PixBuf {
  const pb = new PixBuf(HW, HH);
  pb.poly(HEX_PTS, fill, alpha);
  strokePoly(pb, HEX_PTS, ring);
  strokePoly(pb, hexPts(HEX_CX, HEX_CY, 17.5, 2), inner);
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
    // 狼 / 野猪 / 食人魔：TP-4② 迁往 unitArt.ts B4 批（新卡通帧，64×56）
    default:
      humanoid(pb, {
        skin: '#d8a878', hair: '#4a3a22', cloth: '#7c6236', clothDark: '#54421f',
        metal: '#b9a06a', metalDark: '#6b5a34', accent: '#e8d9a8', weapon: 'none',
      });
  }
}
