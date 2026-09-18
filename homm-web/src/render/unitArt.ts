/**
 * B0 最小验证批 · 程序化兵种精灵
 * ==========================================================================
 * 规格来源（动手前必读）：
 *   design/art-bible/asset-spec.md      §3.2 命名与前缀登记 / §5.3 禁止文字 / §9.1 B0 清单与 7 条验收断言
 *   design/art-bible/cartoon-style.md   §1.1 描边 / §1.2 转角 / §1.3 比例夸张（**每单位只有一处失调**）
 *                                       §1.4 高光与阴影 / §3.2 基底色板 / §3.3 每族色板 / §3.4 色板硬约束
 *                                       §4 H1–H6 搞笑规则 / §5.6 逐 tier 剪影矩阵
 *
 * 本批 6 帧（asset-spec §9.1）：
 *   u_p1_lampbearer_map     32×44   晨曦 T1 提灯侍从 · 冒险地图帧
 *   cu_p1_lampbearer        44×56   同上 · 战斗待机帧
 *   cu_p1_lampbearer_atk    44×56   同上 · 战斗攻击帧（预烘焙 squash，§4.1 方案 A）
 *   u_p2_scavenger_map      32×44   赤焰 T1 捡破烂小鬼 · 冒险地图帧
 *   cu_p2_scavenger         44×56   同上 · 战斗待机帧
 *   cu_p2_scavenger_atk     44×56   同上 · 战斗攻击帧
 *
 * 硬性纪律（违反即为 B0 不通过）：
 *   1. 颜色 **100% 取用 §3.2 / §3.3 的字面色板**，本文件不使用 shade()/mix() 现场造色（§3.4）。
 *   2. **不使用任何 alpha < 1 的绘制** —— 全图 alpha ∈ {0,255}（asset-spec §3.3 禁止半透明，
 *      也是验收断言 1「抠底无粉边」的前提）。投影改为 §1.4 的 AO 接触阴影（1px `ink1` 实色）。
 *   3. 每个单位 **只有一处**比例失调（§1.3）：p1 = 比人还高的提灯杆；p2 = 比身体还大的破袋。
 *   4. 唯一高光 = 双眼右上的 1px `hi0` 反光（§1.4：只画 1 处、只 1px、光源右上）。
 *   5. 所有人造物（提灯 / 破桶 / 飞出的石块）四角切 1px 斜角（§1.2 禁止直角）。
 *   6. 描边只在最后跑一次 `outline(ink0, 1)`，保证 1px 单线（asset-spec §5.4 描边重建）。
 *   7. **禁止任何文字**（asset-spec §5.3）——本文件无任何字形绘制。
 *
 * ⚠️ R-5（asset-spec §9.3）：`races.ts` 尚未交付，兵种短名 `lampbearer` / `scavenger`
 *    是 asset-spec §3.2 的**建议值**，等 D1 定稿后再对齐，不要各自假设。
 */

import { PixBuf } from './pixel.js';

/* ==========================================================================
 * 1. 色板（cartoon-style §3.2 基底 + §3.3 每族）
 *
 * 每条登记 = { hex, family, idx }：
 *   family = 材质族（用于「相邻色差」断言只比较**同族**像素）
 *   idx    = §3.4 五档明暗坡道的档位（-0.30 / -0.15 / 0 / +0.18 / +0.38 → 0 / 1 / 2 / 3 / 4）
 * 同族相邻的两个颜色档位差必须 ≥ 2，否则就是"连续渐变"（验收断言 2）。
 * 三档材质（木材/石材/金属/肤色/植被）直接落在 idx 0 / 2 / 4 上，天然满足。
 * ========================================================================== */

export interface PalEntry {
  hex: string;
  family: string;
  idx: number;
}

/** §3.2 全局基底 + §3.3 每族主题色 —— 允许使用的**全部**颜色（本文件之外不再造色）。 */
export const B0_PALETTE: PalEntry[] = [
  // §3.2 基底
  { hex: '#2a1a12', family: 'ink0', idx: 2 },
  { hex: '#4a3524', family: 'ink1', idx: 2 },
  { hex: '#ffffff', family: 'hi0', idx: 2 },
  { hex: '#fff3c8', family: 'hi1', idx: 2 },
  { hex: '#a8703c', family: 'wood', idx: 4 },
  { hex: '#8a5f34', family: 'wood', idx: 2 },
  { hex: '#5f4022', family: 'wood', idx: 0 },
  { hex: '#cfc6b4', family: 'stone', idx: 4 },
  { hex: '#a9a093', family: 'stone', idx: 2 },
  { hex: '#6f6858', family: 'stone', idx: 0 },
  { hex: '#dfe6f0', family: 'metal', idx: 4 },
  { hex: '#aab6c2', family: 'metal', idx: 2 },
  { hex: '#6b7686', family: 'metal', idx: 0 },
  { hex: '#e8d9a8', family: 'canvas', idx: 4 },
  { hex: '#b9a06a', family: 'canvas', idx: 2 },
  { hex: '#f0c79a', family: 'skin', idx: 4 },
  { hex: '#d8a878', family: 'skin', idx: 2 },
  { hex: '#a87450', family: 'skin', idx: 0 },
  { hex: '#6fc24a', family: 'leaf', idx: 4 },
  { hex: '#4a8438', family: 'leaf', idx: 2 },
  { hex: '#2f5a24', family: 'leaf', idx: 0 },
  // §3.3 p1 晨曦军团
  { hex: '#22559e', family: 'p1accent', idx: 0 },
  { hex: '#3f8fe8', family: 'p1accent', idx: 2 },
  { hex: '#8ecdf8', family: 'p1accent', idx: 4 },
  { hex: '#eae3d2', family: 'p1wall', idx: 2 },
  { hex: '#b3a894', family: 'p1wall', idx: 0 },
  { hex: '#ffb020', family: 'p1clash', idx: 2 },
  // §3.3 p2 赤焰部落
  { hex: '#9a2519', family: 'p2accent', idx: 0 },
  { hex: '#e04a34', family: 'p2accent', idx: 2 },
  { hex: '#f79a7a', family: 'p2accent', idx: 4 },
  { hex: '#c98a4e', family: 'p2wall', idx: 2 },
  { hex: '#8a5a30', family: 'p2wall', idx: 0 },
  { hex: '#2fbfa0', family: 'p2clash', idx: 2 },
  { hex: '#ffd06a', family: 'p2emissive', idx: 2 },
];

/** §3.4 允许的 5 个明暗台阶（供验收脚本核对档位声明是否越界）。 */
export const B0_SHADE_STEPS = [-0.3, -0.15, 0, 0.18, 0.38];

const C = {
  ink0: '#2a1a12',
  ink1: '#4a3524',
  hi0: '#ffffff',
  hi1: '#fff3c8',
  wood4: '#a8703c',
  wood2: '#8a5f34',
  wood0: '#5f4022',
  stone4: '#cfc6b4',
  stone2: '#a9a093',
  stone0: '#6f6858',
  metal4: '#dfe6f0',
  metal2: '#aab6c2',
  metal0: '#6b7686',
  canv4: '#e8d9a8',
  canv2: '#b9a06a',
  skin4: '#f0c79a',
  skin2: '#d8a878',
  skin0: '#a87450',
  p1a0: '#22559e',
  p1a2: '#3f8fe8',
  p1a4: '#8ecdf8',
  p1w2: '#eae3d2',
  p1w0: '#b3a894',
  p1clash: '#ffb020',
  p2a0: '#9a2519',
  p2a2: '#e04a34',
  p2a4: '#f79a7a',
  p2w2: '#c98a4e',
  p2w0: '#8a5a30',
  p2clash: '#2fbfa0',
} as const;

/* ==========================================================================
 * 2. 帧登记（asset-spec §3.2 前缀表 + §1.2 网格表）
 * ========================================================================== */

export interface B0FrameSpec {
  name: string;
  w: number;
  h: number;
  /** atlas.ts：ax 默认 (TILE-w)/2，ay 默认 TILE-h（贴地）。 */
  ax: number;
  ay: number;
  /** combatAtlas.ts 战斗单位锚点。 */
  unit: 'p1_lampbearer' | 'p2_scavenger';
  kind: 'map' | 'idle' | 'atk';
}

export const B0_FRAMES: B0FrameSpec[] = [
  { name: 'u_p1_lampbearer_map', w: 32, h: 44, ax: 0, ay: -12, unit: 'p1_lampbearer', kind: 'map' },
  { name: 'cu_p1_lampbearer', w: 44, h: 56, ax: -22, ay: -48, unit: 'p1_lampbearer', kind: 'idle' },
  { name: 'cu_p1_lampbearer_atk', w: 44, h: 56, ax: -22, ay: -48, unit: 'p1_lampbearer', kind: 'atk' },
  { name: 'u_p2_scavenger_map', w: 32, h: 44, ax: 0, ay: -12, unit: 'p2_scavenger', kind: 'map' },
  { name: 'cu_p2_scavenger', w: 44, h: 56, ax: -22, ay: -48, unit: 'p2_scavenger', kind: 'idle' },
  { name: 'cu_p2_scavenger_atk', w: 44, h: 56, ax: -22, ay: -48, unit: 'p2_scavenger', kind: 'atk' },
];

/** 第 7 个资产：AI 生成的 `crestL_p1`（256×384），本轮不做，只在验收脚本里留人工项。 */
export const B0_PENDING_AI_FRAME = 'crestL_p1';

export function b0FrameSpec(name: string): B0FrameSpec {
  const f = B0_FRAMES.find((s) => s.name === name);
  if (!f) throw new Error(`未知 B0 帧：${name}`);
  return f;
}

/**
 * @param name    帧名（见 B0_FRAMES）
 * @param outline 是否跑「描边重建」这一步（asset-spec §5.4 步骤 [5]）。
 *                默认 true = 成品帧。传 false 得到**描边前**的本体，供
 *                `tools/b0audit.mjs` 断言「轮廓 1px 单线、无断点」时还原
 *                outline() 的膨胀圈；AI 资产接进管线时也需要这个开关
 *                （先丢掉 AI 自带的边，再用本函数重跑一次描边）。
 */
export function buildB0Frame(name: string, outline = true): PixBuf {
  const spec = b0FrameSpec(name);
  const pb = new PixBuf(spec.w, spec.h);
  switch (spec.unit) {
    case 'p1_lampbearer':
      drawLampbearer(pb, spec.kind);
      break;
    case 'p2_scavenger':
      drawScavenger(pb, spec.kind);
      break;
  }
  // 描边重建（asset-spec §5.4）：最后一步、只跑一次、1px、满不透明。
  if (outline) pb.outline(C.ink0, 1);
  return pb;
}

/* ==========================================================================
 * 3. 通用原语
 * ========================================================================== */

/**
 * 人造物切角矩形 —— §1.2「人造物禁止直角，每栋建筑/道具的四个外转角至少切 1px 斜角」。
 * （PixBuf 没有擦除原语，所以按行内缩着画，而不是画完再抠角。）
 */
function chamfer(pb: PixBuf, x: number, y: number, w: number, h: number, color: string, cut = 1): void {
  for (let j = 0; j < h; j++) {
    let i0 = 0;
    let i1 = w - 1;
    if (j < cut) {
      const k = cut - j;
      i0 = k;
      i1 = w - 1 - k;
    }
    if (j >= h - cut) {
      const k = j - (h - cut) + 1;
      i0 = Math.max(i0, k);
      i1 = Math.min(i1, w - 1 - k);
    }
    for (let i = i0; i <= i1; i++) pb.set(x + i, y + j, color);
  }
}

/** 锯齿下摆 —— §5.6.3 p2「边缘 = 锯齿 / 不规则缺口」，也是"破布"的读法。 */
function jagHem(pb: PixBuf, x0: number, x1: number, y: number, color: string, pat: number[]): void {
  for (let x = x0; x <= x1; x++) pb.vline(x, y, y + pat[(x - x0) % pat.length], color);
}

/** §1.4 AO 接触阴影：物件与地面接触处 1px `ink1`（**实色**，不是半透明），让单位"坐"在地上。 */
function aoContact(pb: PixBuf, x0: number, x1: number, y: number): void {
  pb.hline(x0, x1, y, C.ink1);
}

/** 2px 斜线（手臂 / 背带 / 提灯杆用）。 */
function thickLine(pb: PixBuf, x0: number, y0: number, x1: number, y1: number, color: string, shadeColor: string): void {
  pb.line(x0, y0, x1, y1, color);
  pb.line(x0 + 1, y0 + 1, x1 + 1, y1 + 1, shadeColor);
}

/**
 * §4 H3 表情：2px 以上可读眼睛 + 1px 嘴线。
 * 唯一高光 = 双眼右上各 1px 的 `hi0`（§1.4：只画 1 处、只 1px、光源右上）。
 */
function face(pb: PixBuf, lx: number, rx: number, ey: number, mouthY: number, mouthW: number, teeth: boolean): void {
  pb.rect(lx, ey, 2, 2, C.ink0);
  pb.rect(rx, ey, 2, 2, C.ink0);
  pb.set(lx + 1, ey, C.hi0);
  pb.set(rx + 1, ey, C.hi0);
  pb.rect(lx + 1, mouthY, mouthW, 1, C.ink0);
  if (teeth) {
    pb.set(lx + 2, mouthY, C.hi0);
    pb.set(lx + mouthW, mouthY, C.hi0);
  }
}

/* ==========================================================================
 * 4. p1 晨曦 T1 · 提灯侍从
 *
 * §5.6.3 形状家族：垂直矩形 / 平行线 / 左右对称 / 顶部 1 处尖角 / 平底站稳 / 高宽比 ≥ 1.25
 * §5.6.4 T1 格：竖直提灯杆比人高，灯光在正上方
 * §1.3 唯一失调：提灯（杆 + 灯）比人还高
 * §5.2 p1 兵种剪影：全部向上、高瘦（宽高比 ≤0.55 的轮廓）、装备最整齐
 * ========================================================================== */

/** 提灯（p1 唯一尖角 + 唯一撞色 `#ffb020` 的灯焰）。人工物，四角切斜角。 */
function lantern(pb: PixBuf, cx: number, top: number): void {
  const baseY = top + 3; // 尖顶高 3px
  const glassY = baseY;
  const glassH = 5;
  const glassW = 7;
  const x0 = cx - 3;
  // 玻璃罩（自发光 #fff3c8 = p1 emissive）+ 深色铁框
  // 框用 metal0 而不是 metal2：灯焰的暖黄与中灰金属明度几乎相同（ΔL*≈4），会糊成一团
  pb.rect(x0, glassY, glassW, glassH, C.hi1);
  pb.frame(x0, glassY, glassW, glassH, C.metal0);
  // 灯焰：p1 的撞色（暖黄），全精灵唯一的 clash 使用点（§4 H4：只 1 处、面积 ≤8%）
  // 四周留 1px 玻璃，避免灯焰与金属框直接相邻（两者明度几乎相同，会糊成一团）
  pb.rect(cx - 1, glassY + 2, 3, 2, C.p1clash);
  // 尖顶：p1 母题「尖角」，夹角 ≥60°
  pb.tri([cx, top], [x0 + glassW - 1, baseY], [x0, baseY], C.metal4);
  pb.tri([cx, top], [x0 + glassW - 1, baseY], [cx, baseY], C.metal2);
  // 灯座
  chamfer(pb, cx - 2, glassY + glassH, 5, 1, C.metal2, 1);
}

function drawLampbearer(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawLampbearerMap(pb);
  else if (kind === 'idle') drawLampbearerCombat(pb, false);
  else drawLampbearerCombat(pb, true);
}

/** 32×44 冒险地图帧：脚底 42，最高点 15（含灯尖），剪影高 28。 */
function drawLampbearerMap(pb: PixBuf): void {
  const cx = 13; // 人物中轴
  const poleX = 21;

  // 靴（§1.3 手脚放大 1.4×）
  pb.rect(8, 39, 6, 3, C.canv2);
  pb.rect(15, 39, 6, 3, C.canv2);
  aoContact(pb, 8, 19, 42);
  // 腿
  pb.rect(9, 36, 4, 3, C.p1a0);
  pb.rect(14, 36, 4, 3, C.p1a0);
  // 躯干 + 竖条纹罩衫（§5.2 p1 建筑/兵种签名：竖条）
  pb.rect(8, 28, 11, 8, C.p1a2);
  pb.hline(8, 18, 28, C.p1a0);
  pb.rect(11, 29, 5, 6, C.p1w2);
  pb.rect(11, 34, 5, 1, C.p1w0);
  pb.rect(8, 34, 11, 1, C.p1a0);
  // 腰带 + 金属扣
  pb.hline(8, 18, 35, C.ink1);
  pb.rect(12, 35, 2, 1, C.metal4);
  // 手臂：左垂、右上举握杆
  pb.rect(6, 29, 3, 6, C.p1a0);
  pb.rect(6, 35, 3, 2, C.skin2);
  pb.rect(19, 29, 3, 3, C.p1a0);
  pb.rect(21, 31, 2, 2, C.p1a0);
  pb.rect(21, 33, 3, 2, C.skin2);
  // 头（§1.3 头身比 1:3）
  pb.ellipse(cx, 22, 4.5, 4, C.skin2);
  pb.ellipse(cx, 20, 5.5, 2, C.wood0); // 头发（整齐，只盖头顶）
  face(pb, 10, 14, 23, 25, 3, false);
  // 提灯杆（唯一失调：比人高）
  pb.rect(poleX, 24, 2, 10, C.wood4);
  pb.rect(poleX + 1, 24, 1, 10, C.wood2);
  // 提灯
  lantern(pb, 22, 15);
}

/** 44×56 战斗帧：脚底 54，最高点 21（灯尖），剪影高 34 = 60.7%（§5.6.2 T1 ≤62%）。 */
function drawLampbearerCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    const cx = 19;
    // 靴 + AO
    pb.rect(13, 51, 6, 4, C.canv2);
    pb.rect(20, 51, 6, 4, C.canv2);
    aoContact(pb, 13, 24, 54);
    // 腿
    pb.rect(14, 46, 4, 5, C.p1a0);
    pb.rect(20, 46, 4, 5, C.p1a0);
    // 躯干 + 竖条纹罩衫
    pb.rect(13, 35, 13, 10, C.p1a2);
    pb.hline(13, 25, 35, C.p1a0);
    pb.rect(17, 36, 5, 7, C.p1w2);
    pb.rect(17, 42, 5, 1, C.p1w0);
    pb.rect(13, 43, 13, 2, C.p1a0);
    // 腰带 + 金属扣
    pb.hline(13, 25, 45, C.ink1);
    pb.rect(18, 45, 3, 1, C.metal4);
    // 手臂：左垂、右上举握杆
    pb.rect(10, 36, 3, 8, C.p1a0);
    pb.rect(10, 44, 3, 2, C.skin2);
    pb.rect(23, 36, 3, 4, C.p1a0);
    pb.rect(25, 39, 3, 3, C.p1a0);
    pb.rect(27, 41, 3, 3, C.p1a0);
    pb.rect(28, 43, 3, 2, C.skin2);
    // 头
    pb.ellipse(cx, 29, 5.5, 5, C.skin2);
    pb.ellipse(cx, 26, 5.5, 2, C.wood0);
    face(pb, 16, 21, 30, 33, 3, false);
    // 提灯杆（唯一失调：比人高）
    pb.rect(29, 30, 2, 15, C.wood4);
    pb.rect(30, 30, 1, 15, C.wood2);
    // 提灯：最高点 21，正在头顶正上方
    lantern(pb, 30, 21);
    return;
  }

  /* ---- 攻击帧：0.85× 高（34→29）、1.15× 宽（24→27）的前冲击灯（§4.1 H5 / §4.1 方案 A） ---- */
  // 靴 + AO：后脚蹬地、前脚跨出
  pb.rect(11, 51, 6, 4, C.canv2);
  pb.rect(21, 50, 7, 5, C.canv2);
  aoContact(pb, 11, 27, 54);
  // 腿：后腿弯、前腿伸
  pb.rect(13, 47, 4, 4, C.p1a0);
  pb.rect(23, 45, 4, 5, C.p1a0);
  // 躯干前倾（楔形向出手侧压）
  pb.poly(
    [
      [14, 37],
      [26, 34],
      [28, 46],
      [16, 47],
    ],
    C.p1a2,
  );
  pb.line(14, 37, 26, 34, C.p1a0);
  pb.line(19, 37, 21, 46, C.p1w2);
  pb.line(20, 37, 22, 46, C.p1w2);
  pb.poly(
    [
      [16, 45],
      [28, 44],
      [28, 46],
      [16, 47],
    ],
    C.p1a0,
  );
  pb.line(15, 45, 27, 44, C.ink1);
  pb.rect(20, 45, 2, 1, C.metal0); // 暗金属扣：亮金属与石灰白罩衫明度几乎相同，会糊
  // 手臂：左手后摆、右手向前下方刺出
  pb.rect(11, 38, 3, 6, C.p1a0);
  pb.rect(11, 44, 3, 2, C.skin2);
  pb.rect(25, 35, 3, 4, C.p1a0);
  pb.rect(27, 37, 3, 3, C.p1a0);
  pb.rect(29, 38, 3, 2, C.skin2);
  // 头（压低，随身体前倾）
  pb.ellipse(21, 31, 5, 4, C.skin2);
  pb.ellipse(21, 28, 5, 1.5, C.wood0);
  face(pb, 18, 23, 31, 34, 3, false);
  // 提灯杆随刺击甩向前下方
  thickLine(pb, 30, 40, 34, 34, C.wood4, C.wood2);
  // 提灯：最高点 26 → 剪影高 29
  lantern(pb, 34, 26);
}

/* ==========================================================================
 * 5. p2 赤焰 T1 · 捡破烂小鬼
 *
 * §5.6.3 形状家族：楔形前倾 / 锯齿不规则缺口 / 顶部 1–3 根刺 / 重心偏前的支点 / 高宽比 ≈ 1.0
 * §5.6.4 T1 格：歪背带 + 露底口袋，锯齿破布，头顶两根断钉
 * §1.3 唯一失调：比身体还大的破袋（露底，破烂掉出来）
 * §5.3 p2 兵种剪影：前倾 + 宽肩、矮胖、装备不合身、表情很凶但很笨
 * ========================================================================== */

/** 头顶两根断钉（§5.6.3 p2「顶部 1–3 根刺」）—— 一长一短，读成"断了的钉子"。 */
function brokenNails(pb: PixBuf, xa: number, ya: number, xb: number, yb: number, len: number): void {
  pb.rect(xa, ya, 1, len, C.metal0);
  pb.rect(xb, yb, 1, len - 2, C.metal0);
  pb.set(xb, yb - 1, C.metal2); // 断口
  pb.set(xa, ya - 1, C.metal0);
}

/** 破袋（唯一失调：比身体大）+ 露底口袋 + 掉出来的破烂。 */
function ragSack(pb: PixBuf, x: number, y: number, w: number, h: number): void {
  chamfer(pb, x, y, w, h, C.canv2, 1);
  chamfer(pb, x + 2, y - 3, w - 4, 3, C.canv4, 1); // 袋口束起
  pb.hline(x, x + w - 1, y, C.canv4);
  jagHem(pb, x, x + w - 1, y + h, C.canv2, [2, 0, 1]); // 锯齿破口下摆
  // 露底：袋子底部撕开一块，露出暗部
  const hx = x + 4;
  const hy = y + h - 5;
  pb.rect(hx, hy, 5, 5, C.ink1);
  // 掉出来的破烂：一根骨头 + 一块暗石（都不用 p2clash——青绿与麻袋布明度几乎相同，会糊）
  pb.rect(hx + 1, y + h + 1, 2, 2, C.stone4);
  pb.rect(hx + 4, y + h, 2, 3, C.stone0);
}

function drawScavenger(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawScavengerMap(pb);
  else if (kind === 'idle') drawScavengerCombat(pb, false);
  else drawScavengerCombat(pb, true);
}

/** 32×44 冒险地图帧：脚底 42，最高点 15（断钉尖），剪影高 28。 */
function drawScavengerMap(pb: PixBuf): void {
  // 破袋（背在身后，比身体大）
  ragSack(pb, 2, 22, 11, 15);
  // 靴 + AO：矮胖宽站姿
  pb.rect(13, 39, 7, 3, C.canv2);
  pb.rect(21, 38, 7, 4, C.canv2);
  aoContact(pb, 13, 26, 42);
  // 腿（短）
  pb.rect(15, 36, 4, 3, C.p2w0);
  pb.rect(21, 35, 4, 3, C.p2w0);
  // 躯干：楔形前倾（上宽下窄）
  pb.poly(
    [
      [14, 27],
      [24, 27],
      [23, 35],
      [16, 35],
    ],
    C.p2a2,
  );
  pb.hline(14, 24, 27, C.p2a0); // 下巴投影（§1.4）：不用 accentLight，它与肤色明度几乎相同
  jagHem(pb, 16, 23, 36, C.p2a0, [1, 0]);
  // 歪背带（斜跨胸口）
  thickLine(pb, 9, 26, 22, 35, C.canv4, C.canv4);
  // 手臂：左手拽着袋子、右手前伸
  pb.rect(12, 28, 4, 5, C.p2a0);
  pb.rect(10, 33, 3, 2, C.skin0);
  pb.rect(24, 28, 3, 4, C.p2a0);
  pb.rect(25, 31, 3, 3, C.p2a0);
  pb.rect(26, 33, 3, 2, C.skin0);
  // 头 + 断钉
  pb.ellipse(19, 24, 5.5, 3.5, C.skin2);
  pb.ellipse(19, 22, 6, 2, C.wood0);
  brokenNails(pb, 16, 16, 21, 17, 6);
  pb.line(15, 25, 17, 26, C.ink0);
  pb.line(24, 25, 22, 26, C.ink0);
  face(pb, 16, 21, 26, 28, 4, true);
}

/** 44×56 战斗帧：脚底 54，最高点 21（断钉尖），剪影高 34 = 60.7%。 */
function drawScavengerCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    // 破袋（背在身后，比身体大 —— 唯一失调）
    ragSack(pb, 3, 28, 14, 18);
    // 靴 + AO：宽站姿、重心偏前
    pb.rect(19, 50, 7, 5, C.canv2);
    pb.rect(27, 50, 8, 5, C.canv2);
    aoContact(pb, 19, 33, 54);
    // 腿（短）
    pb.rect(20, 47, 4, 3, C.p2w0);
    pb.rect(28, 47, 4, 3, C.p2w0);
    // 躯干：楔形前倾（肩宽、下摆收）
    pb.poly(
      [
        [19, 35],
        [31, 35],
        [29, 47],
        [21, 47],
      ],
      C.p2a2,
    );
    pb.hline(19, 31, 35, C.p2a0); // 同上：下巴投影
    pb.poly(
      [
        [21, 45],
        [29, 45],
        [29, 47],
        [21, 47],
      ],
      C.p2a0,
    );
    jagHem(pb, 21, 29, 48, C.p2a0, [1, 0]);
    // 破布腰带
    pb.hline(20, 30, 43, C.p2w0);
    pb.hline(20, 30, 44, C.p2w0);
    // 歪背带：从袋子斜跨到对侧胯
    thickLine(pb, 13, 30, 26, 45, C.canv4, C.canv4);
    // 手臂：左手拽袋（臂上系一块撞色破布，p2 唯一 clash 使用点，§4 H4）、右手拎破桶
    pb.rect(16, 36, 4, 5, C.p2a0);
    pb.hline(17, 19, 38, C.p2clash); // 青绿 vs 暗红袖子 ΔL*≈43，不会糊
    pb.rect(15, 40, 3, 2, C.skin0);
    pb.rect(30, 36, 3, 5, C.p2a0);
    pb.rect(32, 40, 3, 3, C.p2a0);
    pb.rect(33, 42, 3, 2, C.skin0);
    chamfer(pb, 33, 44, 5, 5, C.metal0, 1);
    pb.hline(33, 37, 44, C.metal4); // 桶沿：亮金属 vs 手（ΔL*≈26）；中灰 vs 手只有 1.3，会糊
    pb.line(34, 43, 37, 43, C.metal4);
    // 头 + 断钉
    pb.ellipse(24, 30, 5.5, 4, C.skin2);
    pb.ellipse(24, 28, 6, 2.5, C.wood0);
    brokenNails(pb, 21, 21, 26, 23, 7);
    pb.line(20, 29, 22, 30, C.ink0); // 凶眉（内侧压低）
    pb.line(29, 29, 27, 30, C.ink0);
    face(pb, 21, 26, 31, 33, 5, true);
    return;
  }

  /* ---- 攻击帧：0.85× 高（34→29）的弯腰前扑 + 抡出破烂 ---- */
  // 破袋（被抡到背上，压扁）
  ragSack(pb, 6, 31, 12, 15);
  // 靴 + AO：后脚蹬、前脚跨
  pb.rect(16, 51, 7, 4, C.canv2);
  pb.rect(25, 50, 8, 5, C.canv2);
  aoContact(pb, 16, 32, 54);
  // 腿
  pb.rect(18, 47, 4, 4, C.p2w0);
  pb.rect(27, 46, 4, 4, C.p2w0);
  // 躯干：更狠的前扑楔形
  pb.poly(
    [
      [17, 37],
      [29, 34],
      [31, 47],
      [19, 47],
    ],
    C.p2a2,
  );
  pb.line(17, 37, 29, 34, C.p2a0); // 同上：下巴投影
  pb.poly(
    [
      [19, 44],
      [31, 43],
      [31, 47],
      [19, 47],
    ],
    C.p2a0,
  );
  jagHem(pb, 19, 31, 48, C.p2a0, [1, 0]);
  thickLine(pb, 18, 43, 30, 42, C.canv4, C.canv4);
  // 手臂：左手拽袋、右手抡出去
  pb.rect(16, 37, 4, 5, C.p2a0);
  pb.rect(13, 41, 3, 2, C.skin0);
  pb.rect(30, 34, 3, 4, C.p2a0);
  pb.rect(32, 31, 3, 4, C.p2a0);
  pb.rect(33, 30, 3, 2, C.skin0);
  // 头（压低前探）
  pb.ellipse(27, 32, 5.5, 4, C.skin2);
  pb.ellipse(27, 30, 6, 2, C.wood0);
  brokenNails(pb, 24, 27, 29, 26, 5);
  pb.line(23, 31, 25, 32, C.ink0);
  pb.line(32, 31, 30, 32, C.ink0);
  face(pb, 24, 29, 32, 34, 5, true);
  // 飞出去的破烂（人造物，切角）
  chamfer(pb, 37, 26, 4, 4, C.stone0, 1);
  pb.set(37, 26, C.stone2);
}
