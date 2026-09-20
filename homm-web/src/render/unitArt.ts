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
 *      也是验收断言 1「抠底无粉边」的前提）。投影用 §1.4 末条的 1px `ink1` **实色** AO 圈。
 *      ⚠️ §1.4 的半透明冷紫投影 `rgba(58,42,74,0.28)` 已由美术于 2026-09-19 **正式撤回**，
 *      不适用于程序化精灵：1 画布像素 = 手机上 4~6 物理像素，0.28 alpha 在 zoom2×dpr3 下
 *      是一条 4~6px 宽的灰紫带，再被 lightLayer 的 multiply 一压就成脏边。冷紫只留给
 *      将来「地面上的大面积投影」，不进任何精灵。
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
  // §3.3 p3 翠林守望（B1 新增）
  { hex: '#1f7a45', family: 'p3accent', idx: 0 },
  { hex: '#3fbe6e', family: 'p3accent', idx: 2 },
  { hex: '#93e8a8', family: 'p3accent', idx: 4 },
  { hex: '#7a7a48', family: 'p3wall', idx: 2 },
  { hex: '#4f5130', family: 'p3wall', idx: 0 },
  { hex: '#e0538f', family: 'p3clash', idx: 2 },
  { hex: '#d6ff9a', family: 'p3emissive', idx: 4 },
  // §3.3 p4 紫晶密会（B1 新增）
  { hex: '#6232a8', family: 'p4accent', idx: 0 },
  { hex: '#a165e8', family: 'p4accent', idx: 2 },
  { hex: '#d4aefc', family: 'p4accent', idx: 4 },
  { hex: '#58526e', family: 'p4wall', idx: 2 },
  { hex: '#38334a', family: 'p4wall', idx: 0 },
  { hex: '#3fe0d0', family: 'p4clash', idx: 2 },
  { hex: '#8ffff0', family: 'p4emissive', idx: 4 },
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
  leaf4: '#6fc24a',
  leaf2: '#4a8438',
  leaf0: '#2f5a24',
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
  // §3.3 p3 翠林守望
  p3a0: '#1f7a45',
  p3a2: '#3fbe6e',
  p3a4: '#93e8a8',
  p3w2: '#7a7a48',
  p3w0: '#4f5130',
  p3clash: '#e0538f',
  p3emissive: '#d6ff9a',
  // §3.3 p4 紫晶密会
  p4a0: '#6232a8',
  p4a2: '#a165e8',
  p4a4: '#d4aefc',
  p4w2: '#58526e',
  p4w0: '#38334a',
  p4clash: '#3fe0d0',
  p4emissive: '#8ffff0',
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
  unit:
    | 'p1_lampbearer'
    | 'p1_hornxbow'
    | 'p1_oathpike'
    | 'p1_templar'
    | 'p2_scavenger'
    | 'p2_axethrower'
    | 'p2_wolfrider'
    | 'p2_firebrand'
    | 'p3_dwarf'
    | 'p3_thornarcher'
    | 'p3_vineguard'
    | 'p3_treant'
    | 'p4_stoneimp'
    | 'p4_fireapprentice'
    | 'p4_hopgolem'
    | 'p4_librarian';
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

/**
 * B1 批（asset-spec §9.2）：全部族的 T1 + T2，18 帧（6 单位 × 3）。
 * 帧名 / 槽位 / 锚点严格按 asset-spec §3.2 / §1.2：
 *   map 32×44（ax=0, ay=-12，贴地） / cu_* 44×56（ax=-22, ay=-48） / cu_*_atk 44×56。
 * ⚠️ R-5：短名 lampbearer / scavenger / hornxbow / axethrower / dwarf / thornarcher /
 *   stoneimp / fireapprentice 是 asset-spec §3.2 + §2.2 的建议值，等 races.ts 定稿后对齐。
 */
export const B1_FRAMES: B0FrameSpec[] = [
  // 晨曦 T2 号角弩手（p1 垂直母题：弩竖直举起）
  { name: 'u_p1_hornxbow_map', w: 32, h: 44, ax: 0, ay: -12, unit: 'p1_hornxbow', kind: 'map' },
  { name: 'cu_p1_hornxbow', w: 44, h: 56, ax: -22, ay: -48, unit: 'p1_hornxbow', kind: 'idle' },
  { name: 'cu_p1_hornxbow_atk', w: 44, h: 56, ax: -22, ay: -48, unit: 'p1_hornxbow', kind: 'atk' },
  // 赤焰 T2 投斧蛮子（p2 楔形母题：横持斧，斧刃带缺口）
  { name: 'u_p2_axethrower_map', w: 32, h: 44, ax: 0, ay: -12, unit: 'p2_axethrower', kind: 'map' },
  { name: 'cu_p2_axethrower', w: 44, h: 56, ax: -22, ay: -48, unit: 'p2_axethrower', kind: 'idle' },
  { name: 'cu_p2_axethrower_atk', w: 44, h: 56, ax: -22, ay: -48, unit: 'p2_axethrower', kind: 'atk' },
  // 翠林 T1 浇水矮人（p3 圆形母题：圆滚滚一坨，头顶一丛叶）
  { name: 'u_p3_dwarf_map', w: 32, h: 44, ax: 0, ay: -12, unit: 'p3_dwarf', kind: 'map' },
  { name: 'cu_p3_dwarf', w: 44, h: 56, ax: -22, ay: -48, unit: 'p3_dwarf', kind: 'idle' },
  { name: 'cu_p3_dwarf_atk', w: 44, h: 56, ax: -22, ay: -48, unit: 'p3_dwarf', kind: 'atk' },
  // 翠林 T2 荆棘射手（p3 圆形母题：弓成弧，头顶枝叶绕成环）
  { name: 'u_p3_thornarcher_map', w: 32, h: 44, ax: 0, ay: -12, unit: 'p3_thornarcher', kind: 'map' },
  { name: 'cu_p3_thornarcher', w: 44, h: 56, ax: -22, ay: -48, unit: 'p3_thornarcher', kind: 'idle' },
  { name: 'cu_p3_thornarcher_atk', w: 44, h: 56, ax: -22, ay: -48, unit: 'p3_thornarcher', kind: 'atk' },
  // 紫晶 T1 石雕小怪（p4 菱形母题：菱形石块，底部悬空 1px，身上一道裂纹）
  { name: 'u_p4_stoneimp_map', w: 32, h: 44, ax: 0, ay: -12, unit: 'p4_stoneimp', kind: 'map' },
  { name: 'cu_p4_stoneimp', w: 44, h: 56, ax: -22, ay: -48, unit: 'p4_stoneimp', kind: 'idle' },
  { name: 'cu_p4_stoneimp_atk', w: 44, h: 56, ax: -22, ay: -48, unit: 'p4_stoneimp', kind: 'atk' },
  // 紫晶 T2 喷火学徒（p4 菱形母题：细长锥袍，杖尖菱形，嘴前一小团火）
  { name: 'u_p4_fireapprentice_map', w: 32, h: 44, ax: 0, ay: -12, unit: 'p4_fireapprentice', kind: 'map' },
  { name: 'cu_p4_fireapprentice', w: 44, h: 56, ax: -22, ay: -48, unit: 'p4_fireapprentice', kind: 'idle' },
  { name: 'cu_p4_fireapprentice_atk', w: 44, h: 56, ax: -22, ay: -48, unit: 'p4_fireapprentice', kind: 'atk' },
];

/**
 * B2 批（asset-spec §9.2）：全部族的 T3 + T4，24 帧（8 单位 × 3）。
 * 帧名 / 槽位 / 锚点严格按 asset-spec §3.2 / §1.2（与 B0/B1 同规格）：
 *   map 32×44（ax=0, ay=-12，贴地） / cu_* 44×56（ax=-22, ay=-48） / cu_*_atk 44×56。
 * 剪影规格照 cartoon-style §5.6.4 二十格落地表（T3/T4 行），不自行发明。
 * ⚠️ R-5：id 已由团队拍板 D-63（p1_oathpike / p1_templar / p2_wolfrider / p2_firebrand /
 *   p3_vineguard / p3_treant / p4_hopgolem / p4_librarian），id 即帧名中缀（D-58）。
 * 按族提交：本数组随每个族的 6 帧逐步追加（未实现的族不登记，避免烘焙出空白帧）。
 */
export const B2_FRAMES: B0FrameSpec[] = [
  // 晨曦 T3 铁誓枪兵（p1 垂直母题：矩形大盾正对镜头，枪竖直）
  { name: 'u_p1_oathpike_map', w: 32, h: 44, ax: 0, ay: -12, unit: 'p1_oathpike', kind: 'map' },
  { name: 'cu_p1_oathpike', w: 44, h: 56, ax: -22, ay: -48, unit: 'p1_oathpike', kind: 'idle' },
  { name: 'cu_p1_oathpike_atk', w: 44, h: 56, ax: -22, ay: -48, unit: 'p1_oathpike', kind: 'atk' },
  // 晨曦 T4 圣殿骑士（p1 垂直母题：高坐骑人+马，竖直甲片，顶上冠羽）
  { name: 'u_p1_templar_map', w: 32, h: 44, ax: 0, ay: -12, unit: 'p1_templar', kind: 'map' },
  { name: 'cu_p1_templar', w: 44, h: 56, ax: -22, ay: -48, unit: 'p1_templar', kind: 'idle' },
  { name: 'cu_p1_templar_atk', w: 44, h: 56, ax: -22, ay: -48, unit: 'p1_templar', kind: 'atk' },
];

/** unitArt.ts 内**全部**程序化兵种帧（B0 6 + B1 18 + B2 24 = 48），供 `tools/b0audit.mjs` 全扫描，
 *  `atlas.ts` / `combatAtlas.ts` 也遍历本数组烘焙（#24 已接好，无需改那两个文件）。 */
export const UNIT_FRAMES: B0FrameSpec[] = [...B0_FRAMES, ...B1_FRAMES, ...B2_FRAMES];

/** 第 7 个资产：AI 生成的 `crestL_p1`（256×384），本轮不做，只在验收脚本里留人工项。 */
export const B0_PENDING_AI_FRAME = 'crestL_p1';

export function b0FrameSpec(name: string): B0FrameSpec {
  const f = UNIT_FRAMES.find((s) => s.name === name);
  if (!f) throw new Error(`未知兵种帧：${name}`);
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
    case 'p1_hornxbow':
      drawHornxbow(pb, spec.kind);
      break;
    case 'p2_scavenger':
      drawScavenger(pb, spec.kind);
      break;
    case 'p2_axethrower':
      drawAxethrower(pb, spec.kind);
      break;
    case 'p3_dwarf':
      drawDwarf(pb, spec.kind);
      break;
    case 'p3_thornarcher':
      drawThornarcher(pb, spec.kind);
      break;
    case 'p4_stoneimp':
      drawStoneimp(pb, spec.kind);
      break;
    case 'p4_fireapprentice':
      drawFireapprentice(pb, spec.kind);
      break;
    case 'p1_oathpike':
      drawOathpike(pb, spec.kind);
      break;
    case 'p1_templar':
      drawTemplar(pb, spec.kind);
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
  pb.rect(16, 45, 2, 1, C.metal4); // 亮金属扣；必须避开竖条纹 p1w2（两者只差 0.7 L*）
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
  pb.rect(15, 36, 4, 3, C.p2a0);
  pb.rect(21, 35, 4, 3, C.p2a0);
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
    pb.rect(20, 47, 4, 3, C.p2a0);
    pb.rect(28, 47, 4, 3, C.p2a0);
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
    pb.hline(20, 30, 43, C.canv4);
    pb.hline(20, 30, 44, C.canv4);
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
  pb.rect(18, 47, 4, 4, C.p2a0);
  pb.rect(27, 46, 4, 4, C.p2a0);
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

/* ==========================================================================
 * 6. p1 晨曦 T2 · 号角弩手
 *
 * §5.6.3 形状家族：垂直矩形 / 左右对称 / 顶部尖角 / 平底落地 / 高宽比 ≥1.25
 * §5.6.4 T2 格：弩竖直举起，喇叭口在肩上
 * §1.3 唯一失调：竖直举起的弩比人还高（p1「一切向上」母题的最强一档）
 * §5.2 p1 兵种剪影：全部向上、高瘦、装备最整齐（头盔 + 竖条罩衫）
 * ========================================================================== */

/** 竖直弩（p1 唯一失调：比人高）。人工物，四角切斜角（§1.2）。 */
function crossbow(pb: PixBuf, x: number, top: number, bottom: number): void {
  const w = 3;
  // 枪托（竖直）
  chamfer(pb, x, top + 6, w, bottom - top - 6, C.wood4, 1);
  pb.rect(x + 1, top + 6, 1, bottom - top - 6, C.wood4);
  // 弩臂（横，在近顶端）
  pb.rect(x - 4, top + 4, w + 8, 2, C.wood4);
  pb.rect(x - 4, top + 3, w + 8, 1, C.metal2);
  // 弦
  pb.line(x - 4, top + 4, x - 4, bottom - 4, C.ink1);
  pb.line(x + w + 3, top + 4, x + w + 3, bottom - 4, C.ink1);
  // 上膛的弩箭（竖直指天）
  pb.rect(x, top, w, bottom - top - 4, C.metal4);
  pb.rect(x, top - 1, w + 1, 2, C.wood4); // 箭镞
  // 喇叭口（号角）弯钩，在弩臂右端（人造物，切角）
  chamfer(pb, x + w + 3, top + 1, 4, 4, C.metal4, 1);
  pb.set(x + w + 5, top, C.metal2);
  pb.set(x + w + 6, top + 1, C.metal2);
}

function drawHornxbow(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawHornxbowMap(pb);
  else if (kind === 'idle') drawHornxbowCombat(pb, false);
  else drawHornxbowCombat(pb, true);
}

/** 32×44 冒险地图帧：脚底 42，弩尖 9，剪影高 34。 */
function drawHornxbowMap(pb: PixBuf): void {
  const cx = 13;
  pb.rect(8, 39, 6, 3, C.canv2);
  pb.rect(14, 39, 6, 3, C.canv2);
  aoContact(pb, 8, 19, 42);
  pb.rect(9, 36, 4, 3, C.p1a0);
  pb.rect(14, 36, 4, 3, C.p1a0);
  pb.rect(8, 28, 11, 8, C.p1a2);
  pb.hline(8, 18, 28, C.p1a0);
  pb.rect(11, 29, 5, 6, C.p1w2);
  pb.rect(8, 34, 11, 1, C.p1a0);
  pb.hline(8, 18, 35, C.ink1);
  pb.rect(11, 35, 2, 1, C.metal4);
  pb.rect(6, 29, 3, 6, C.p1a0);
  pb.rect(6, 35, 3, 2, C.skin2);
  pb.rect(18, 29, 3, 4, C.p1a0);
  pb.rect(20, 31, 3, 3, C.p1a0);
  pb.rect(21, 33, 3, 2, C.skin2);
  pb.ellipse(cx, 24, 4.5, 4, C.skin2);
  pb.ellipse(cx, 22, 5.5, 2, C.wood0);
  pb.rect(8, 21, 11, 3, C.metal4); // 头盔（p1 装备最整齐）
  face(pb, 10, 14, 25, 27, 3, false);
  pb.rect(cx, 19, 2, 2, C.p1clash); // 盔顶撞色羽（§4 H4，≤8%）
  crossbow(pb, 20, 9, 34);
}

/** 44×56 战斗帧：脚底 54，弩尖 12，剪影高 ~43。 */
function drawHornxbowCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    pb.rect(13, 50, 6, 4, C.canv2);
    pb.rect(20, 50, 6, 4, C.canv2);
    aoContact(pb, 13, 26, 54);
    pb.rect(14, 46, 4, 4, C.p1a0);
    pb.rect(20, 46, 4, 4, C.p1a0);
    pb.rect(13, 35, 13, 11, C.p1a2);
    pb.hline(13, 25, 35, C.p1a0);
    pb.rect(17, 36, 5, 7, C.p1w2);
    pb.rect(17, 42, 5, 1, C.p1w0);
    pb.rect(13, 43, 13, 2, C.p1a0);
    pb.hline(13, 25, 45, C.ink1);
    pb.rect(18, 45, 3, 1, C.metal4);
    pb.rect(10, 36, 3, 8, C.p1a0);
    pb.rect(10, 44, 3, 2, C.skin2);
    pb.rect(23, 36, 3, 4, C.p1a0);
    pb.rect(25, 39, 3, 3, C.p1a0);
    pb.rect(27, 39, 3, 4, C.p1a0);
    pb.rect(29, 41, 3, 2, C.skin2);
    pb.ellipse(18, 29, 5.5, 5, C.skin2);
    pb.ellipse(18, 26, 5.5, 2, C.wood0);
    pb.rect(13, 25, 12, 3, C.metal4);
    face(pb, 15, 20, 30, 33, 3, false);
    pb.rect(17, 22, 2, 2, C.p1clash);
    crossbow(pb, 27, 12, 46);
    return;
  }
  // 攻击帧：前冲 + 弩向右前方刺出，弩箭脱手飞出（§4.1 方案 A 的 0.85× 高）
  pb.rect(11, 51, 6, 4, C.canv2);
  pb.rect(21, 50, 7, 5, C.canv2);
  aoContact(pb, 11, 27, 54);
  pb.rect(13, 47, 4, 4, C.p1a0);
  pb.rect(23, 45, 4, 5, C.p1a0);
  pb.poly([[14, 37], [26, 34], [28, 46], [16, 47]], C.p1a2);
  pb.line(14, 37, 26, 34, C.p1a0);
  pb.rect(18, 37, 5, 6, C.p1w2);
  pb.rect(14, 45, 14, 2, C.p1a0);
  pb.hline(14, 26, 45, C.ink1);
  pb.rect(18, 45, 3, 1, C.metal4);
  pb.rect(11, 38, 3, 6, C.p1a0);
  pb.rect(11, 44, 3, 2, C.skin2);
  pb.rect(25, 35, 3, 4, C.p1a0);
  pb.rect(27, 37, 3, 3, C.p1a0);
  pb.rect(29, 38, 3, 2, C.skin2);
  pb.ellipse(21, 31, 5, 4, C.skin2);
  pb.ellipse(21, 28, 5, 1.5, C.wood0);
  pb.rect(16, 27, 11, 3, C.metal4);
  face(pb, 18, 23, 31, 34, 3, false);
  // 弩被甩向右前方（横持，指右上）
  thickLine(pb, 28, 36, 35, 30, C.wood4, C.wood4);
  pb.rect(33, 28, 6, 2, C.wood4);
  pb.rect(33, 27, 6, 1, C.metal2);
  pb.rect(34, 26, 2, 6, C.metal4);
  // 脱手飞出的弩箭（人造物，切角）
  chamfer(pb, 38, 22, 3, 8, C.metal4, 1);
}

/* ==========================================================================
 * 7. p2 赤焰 T2 · 投斧蛮子
 *
 * §5.6.3 形状家族：楔形前倾 / 锯齿缺口 / 顶部 1–3 根刺 / 重心偏前 / 高宽比 ≈1.0
 * §5.6.4 T2 格：横持斧，身体 15° 前倾，斧刃带缺口
 * §1.3 唯一失调：横持的斧比身体还宽（斧刃带缺口 = p2「破」母题）
 * §5.3 p2 兵种剪影：前倾 + 宽肩、矮胖、装备不合身
 * ========================================================================== */

/** 横持斧（p2 唯一失调：比身体宽，斧刃带缺口）。人造物，切角。
 *  ⚠️ 柄用金属（metal）而非木：木色 #8a5f34 与 p2 红衣 #e04a34 是**近明度近色相**邻接，
 *  会触发断言 8（ΔL*<12）。金属柄与红衣色相差 ~170°，安全。 */
function throwingAxe(pb: PixBuf, x: number, y: number): void {
  // 柄（金属，避免木↔族色近明度邻接）
  pb.rect(x, y, 9, 2, C.metal4);
  pb.rect(x, y + 1, 9, 1, C.metal2);
  // 斧头（金属，刃带缺口）
  chamfer(pb, x + 7, y - 5, 6, 12, C.metal4, 1);
  pb.rect(x + 7, y - 5, 6, 12, C.metal2);
  pb.frame(x + 7, y - 5, 6, 12, C.metal0);
  // 缺口（p2「破」）：刃上挖一个 ink1 三角
  pb.tri([x + 12, y - 1], [x + 13, y + 1], [x + 12, y + 2], C.ink1);
}

function drawAxethrower(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawAxethrowerMap(pb);
  else if (kind === 'idle') drawAxethrowerCombat(pb, false);
  else drawAxethrowerCombat(pb, true);
}

/** 32×44 冒险地图帧：脚底 42，斧尖 ~25（向右），剪影高 ~27。 */
function drawAxethrowerMap(pb: PixBuf): void {
  pb.rect(12, 38, 7, 4, C.canv2);
  pb.rect(20, 38, 7, 4, C.canv2);
  aoContact(pb, 12, 26, 42);
  pb.rect(14, 35, 4, 3, C.p2a0);
  pb.rect(20, 35, 4, 3, C.p2a0);
  pb.poly([[13, 27], [25, 27], [23, 35], [16, 35]], C.p2a2);
  pb.hline(13, 24, 27, C.p2a0);
  jagHem(pb, 16, 23, 36, C.p2a0, [1, 0]);
  pb.hline(14, 22, 35, C.canv4);
  pb.rect(11, 28, 4, 6, C.p2a0); // 左袖下延到 y=33，把左手包在暗红袖里（避开手直接贴亮红衣 p2a2）
  pb.hline(12, 15, 33, C.p2clash); // 臂上撞色破布（§4 H4）
  pb.rect(12, 33, 3, 2, C.skin0); // 左手（坐在袖口上，skin0↔p2a0 ΔL*≈29 通过）
  pb.rect(24, 28, 3, 4, C.p2a0);
  pb.rect(25, 31, 3, 3, C.p2a0);
  pb.rect(26, 33, 3, 2, C.skin0);
  pb.ellipse(18, 24, 5.5, 3.5, C.skin2);
  pb.ellipse(18, 22, 6, 2, C.wood0);
  brokenNails(pb, 15, 16, 20, 17, 6);
  pb.line(14, 25, 16, 26, C.ink0);
  pb.line(23, 25, 21, 26, C.ink0);
  face(pb, 15, 20, 26, 28, 4, true);
  throwingAxe(pb, 26, 26);
}

/** 44×56 战斗帧：脚底 54，斧刃 ~41（向右），剪影高 ~34。 */
function drawAxethrowerCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    pb.rect(19, 50, 7, 5, C.canv2);
    pb.rect(27, 50, 8, 5, C.canv2);
    aoContact(pb, 19, 34, 54);
    pb.rect(20, 47, 4, 3, C.p2a0);
    pb.rect(28, 47, 4, 3, C.p2a0);
    pb.poly([[19, 35], [31, 35], [29, 47], [21, 47]], C.p2a2);
    pb.hline(19, 31, 35, C.p2a0);
    pb.poly([[21, 45], [29, 45], [29, 47], [21, 47]], C.p2a0);
    jagHem(pb, 21, 29, 48, C.p2a0, [1, 0]);
    pb.hline(20, 30, 43, C.canv4);
    pb.hline(20, 30, 44, C.canv4);
    pb.rect(16, 36, 4, 5, C.p2a0);
    pb.hline(17, 19, 38, C.p2clash);
    pb.rect(15, 40, 3, 2, C.skin0);
    pb.rect(30, 36, 3, 5, C.p2a0);
    pb.rect(32, 40, 3, 3, C.p2a0);
    pb.rect(33, 42, 3, 2, C.skin0);
    pb.ellipse(24, 30, 5.5, 4, C.skin2);
    pb.ellipse(24, 28, 6, 2.5, C.wood0);
    brokenNails(pb, 21, 21, 26, 23, 7);
    pb.line(20, 29, 22, 30, C.ink0);
    pb.line(29, 29, 27, 30, C.ink0);
    face(pb, 21, 26, 31, 33, 5, true);
    throwingAxe(pb, 33, 30);
    return;
  }
  // 攻击帧：抡臂投掷，斧脱手飞出（旋转感用缺口表现），身体更狠前扑
  pb.rect(16, 51, 7, 4, C.canv2);
  pb.rect(25, 50, 8, 5, C.canv2);
  aoContact(pb, 16, 33, 54);
  pb.rect(18, 47, 4, 4, C.p2a0);
  pb.rect(27, 46, 4, 4, C.p2a0);
  pb.poly([[17, 37], [29, 34], [31, 47], [19, 47]], C.p2a2);
  pb.line(17, 37, 29, 34, C.p2a0);
  pb.poly([[19, 44], [31, 43], [31, 47], [19, 47]], C.p2a0);
  jagHem(pb, 19, 31, 48, C.p2a0, [1, 0]);
  pb.hline(18, 29, 43, C.canv4);
  pb.rect(16, 37, 4, 5, C.p2a0);
  pb.rect(13, 41, 3, 2, C.skin0);
  pb.rect(30, 34, 3, 4, C.p2a0);
  pb.rect(32, 31, 3, 4, C.p2a0);
  pb.rect(33, 30, 3, 2, C.skin0);
  pb.ellipse(27, 32, 5.5, 4, C.skin2);
  pb.ellipse(27, 30, 6, 2, C.wood0);
  brokenNails(pb, 24, 27, 29, 26, 5);
  pb.line(23, 31, 25, 32, C.ink0);
  pb.line(32, 31, 30, 32, C.ink0);
  face(pb, 24, 29, 32, 34, 5, true);
  // 脱手飞出的斧（旋转：刃在右上，缺口朝外）
  throwingAxe(pb, 36, 26);
}

/* ==========================================================================
 * 8. p3 翠林 T1 · 浇水矮人
 *
 * §5.6.3 形状家族：圆形有机 / 无直角 / 顶部 1–2 丛凸出枝叶 / 脚部不明显（与地面融合）
 * §5.6.4 T1 格：圆滚滚一坨，头顶一丛叶，脚埋在草里
 * §1.3 唯一失调：比身体还大的浇水壶（壶 + 溅出的水）
 * §5.4 p3 兵种剪影：圆形主轮廓 + 顶部不对称凸起 + 绿褐
 * ========================================================================== */

/** 脚埋进草里（p3 不画 AO，改用草叶压住基座，§5.6.3「脚部不明显」）。 */
function grassBase(pb: PixBuf, x0: number, x1: number, y: number): void {
  for (let x = x0; x <= x1; x++) {
    const h = 2 + ((x * 7) % 3);
    pb.rect(x, y - h + 1, 1, h, C.leaf2);
    if ((x * 3) % 2 === 0) pb.set(x, y - h, C.leaf2); // 叶尖用 leaf2（明度低于 p3a2 / 高于 p3w0，两族都不触发断言 8）
  }
}

/** 头顶一丛叶（p3 母题）。压在 wood0 头发上，不与皮肤直接相邻（ΔL* 安全）。 */
function leafTuft(pb: PixBuf, cx: number, top: number): void {
  pb.ellipse(cx, top + 1, 5, 3, C.wood0);
  pb.rect(cx - 4, top - 1, 3, 2, C.leaf4);
  pb.rect(cx + 1, top - 2, 3, 2, C.leaf4);
  pb.set(cx - 2, top - 2, C.leaf2);
  pb.set(cx + 3, top - 3, C.leaf2);
}

function drawDwarf(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawDwarfMap(pb);
  else if (kind === 'idle') drawDwarfCombat(pb, false);
  else drawDwarfCombat(pb, true);
}

/** 32×44 冒险地图帧：脚底草 42，头顶叶 ~18，剪影高 ~24（圆滚滚）。 */
function drawDwarfMap(pb: PixBuf): void {
  grassBase(pb, 6, 24, 42);
  pb.ellipse(15, 36, 11, 9, C.p3a2); // 圆滚滚一坨（绿身）
  pb.ellipse(15, 42, 11, 4, C.p3w0); // 底部暗褐基座（草叶压住：leaf↔p3w0 ΔL*≈12 通过）
  pb.ellipse(15, 31, 9, 6, C.p3w0); // 颈/前襟：把脸(skin)与绿身(p3a2)隔开（skin↔p3w0 ΔL*≈24）
  pb.rect(12, 33, 7, 5, C.p3w0); // 围裙（与基座/前襟同色 → 读作褐围兜）
  // 头（几乎埋进身体）
  pb.ellipse(15, 25, 4.5, 4, C.skin2);
  leafTuft(pb, 15, 21);
  face(pb, 13, 17, 26, 28, 3, false);
  // 浇水壶（唯一失调：比身体大），壶嘴朝左，溅出水珠
  chamfer(pb, 2, 24, 9, 10, C.metal4, 1);
  pb.rect(3, 25, 7, 8, C.metal2);
  pb.frame(2, 24, 9, 10, C.metal0);
  pb.rect(0, 26, 3, 2, C.metal4); // 壶嘴
  pb.rect(5, 22, 3, 2, C.metal0); // 提梁
  pb.set(11, 22, C.p3emissive); // 溅出的水珠（emissive 浅绿 = 水光）
  pb.set(12, 20, C.p3emissive);
  pb.set(10, 19, C.p3emissive);
}

/** 44×56 战斗帧：脚底草 54，头顶叶 ~26，剪影高 ~28。 */
function drawDwarfCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    grassBase(pb, 9, 33, 54);
    pb.ellipse(22, 46, 13, 11, C.p3a2); // 绿身
    pb.ellipse(22, 53, 13, 5, C.p3w0); // 底部暗褐基座
    pb.ellipse(22, 39, 11, 7, C.p3w0); // 颈/前襟：隔开脸与绿身
    pb.rect(18, 42, 9, 6, C.p3w0); // 围裙
    // 头
    pb.ellipse(22, 33, 5, 4.5, C.skin2);
    leafTuft(pb, 22, 28);
    face(pb, 19, 24, 34, 37, 3, false);
    // 浇水壶（唯一失调：比身体大），壶嘴朝左
    chamfer(pb, 3, 32, 11, 13, C.metal4, 1);
    pb.rect(4, 33, 9, 11, C.metal2);
    pb.frame(3, 32, 11, 13, C.metal0);
    pb.rect(0, 35, 4, 3, C.metal4);
    pb.rect(6, 29, 4, 3, C.metal0);
    pb.set(15, 29, C.p3emissive);
    pb.set(16, 27, C.p3emissive);
    return;
  }
  // 攻击帧：壶前倾浇水，水珠呈弧线喷出（仍是「浇水」，不是投掷）
  grassBase(pb, 9, 33, 54);
  pb.ellipse(22, 46, 13, 11, C.p3a2); // 绿身
  pb.ellipse(22, 53, 13, 5, C.p3w0); // 底部暗褐基座
  pb.ellipse(22, 39, 11, 7, C.p3w0); // 颈/前襟
  pb.rect(18, 42, 9, 6, C.p3w0); // 围裙
  pb.ellipse(22, 33, 5, 4.5, C.skin2);
  leafTuft(pb, 22, 28);
  face(pb, 19, 24, 34, 37, 3, false);
  // 壶甩向左前方浇水
  chamfer(pb, 6, 34, 10, 12, C.metal4, 1);
  pb.rect(7, 35, 8, 10, C.metal2);
  pb.frame(6, 34, 10, 12, C.metal0);
  pb.rect(3, 36, 4, 3, C.metal4);
  pb.rect(8, 31, 4, 3, C.metal0);
  // 水珠弧线（emissive，脱离本体 → 第二轮廓环）
  pb.set(2, 33, C.p3emissive);
  pb.set(1, 30, C.p3emissive);
  pb.set(0, 27, C.p3emissive);
  pb.set(2, 25, C.p3emissive);
}

/* ==========================================================================
 * 9. p3 翠林 T2 · 荆棘射手
 *
 * §5.6.3 形状家族：圆形有机 / 顶部 1–2 丛凸出枝叶（绕成环）
 * §5.6.4 T2 格：圆身 + 弓成弧，头顶枝叶绕成环
 * §1.3 唯一失调：弓拉成完整的弧（比直弓夸张，占剪影 ≥15%）
 * §5.4 p3 兵种剪影：圆形主轮廓 + 顶部不对称凸起
 * ========================================================================== */

/** 弓成弧（p3 远程姿态的剪影特征）。右手法 + 弧形木弓 + 一支箭。 */
function arcBow(pb: PixBuf, cx: number, top: number, bottom: number): void {
  for (let y = top; y <= bottom; y++) {
    const t = (y - top) / (bottom - top); // 0..1
    const bulge = Math.round(8 * Math.sin(Math.PI * t)); // 中间外凸
    pb.set(cx + bulge, y, C.wood4);
    pb.set(cx + bulge - 1, y, C.wood2);
  }
  pb.line(cx + 1, top, cx + 1, bottom, C.ink1); // 弦
  pb.rect(cx + 3, (top + bottom) / 2 - 4, 2, 9, C.metal4); // 搭着的箭
  pb.rect(cx + 4, (top + bottom) / 2 - 5, 2, 2, C.wood4); // 箭头
}

/** 头顶枝叶绕成环（p3 T2 母题）。 */
function leafCrown(pb: PixBuf, cx: number, top: number): void {
  pb.ellipse(cx, top + 2, 6, 3, C.wood0);
  pb.rect(cx - 5, top, 3, 3, C.leaf4);
  pb.rect(cx + 2, top - 1, 3, 3, C.leaf4);
  pb.set(cx - 3, top - 2, C.leaf2);
  pb.set(cx + 4, top - 2, C.leaf2);
  pb.set(cx, top - 3, C.leaf4);
}

function drawThornarcher(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawThornarcherMap(pb);
  else if (kind === 'idle') drawThornarcherCombat(pb, false);
  else drawThornarcherCombat(pb, true);
}

/** 32×44 冒险地图帧：脚底 42，弓弧 ~24–40，剪影高 ~22。 */
function drawThornarcherMap(pb: PixBuf): void {
  grassBase(pb, 7, 23, 42);
  pb.ellipse(15, 35, 10, 9, C.p3a2); // 绿身
  pb.ellipse(15, 42, 9, 4, C.p3w0); // 底部暗褐基座（草叶压住：leaf↔p3w0 ΔL*≥12 通过）
  pb.ellipse(15, 31, 8, 5, C.p3w0); // 颈/前襟：隔开脸与绿身
  pb.rect(12, 33, 7, 4, C.p3w0); // 围裙
  pb.ellipse(15, 26, 4.5, 4, C.skin2);
  leafCrown(pb, 15, 22);
  face(pb, 13, 17, 27, 29, 3, false);
  arcBow(pb, 24, 24, 36); // 弓弧收到草叶之上，避免弓(wood)贴草(leaf)
}

/** 44×56 战斗帧：脚底 54，弓弧 ~34–50，剪影高 ~28。 */
function drawThornarcherCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    grassBase(pb, 10, 32, 54);
    pb.ellipse(21, 45, 12, 11, C.p3a2); // 绿身
    pb.ellipse(21, 53, 10, 5, C.p3w0); // 底部暗褐基座
    pb.ellipse(21, 40, 10, 6, C.p3w0); // 颈/前襟
    pb.rect(17, 42, 9, 5, C.p3w0); // 围裙
    pb.ellipse(21, 33, 5, 4.5, C.skin2);
    leafCrown(pb, 21, 28);
    face(pb, 18, 23, 34, 37, 3, false);
    // 手臂伸向弓
    pb.rect(30, 38, 4, 8, C.p3a0); // 手臂（暗绿袖，手埋在袖里避免 skin↔p3a2）
    pb.rect(31, 43, 2, 2, C.skin2); // 手（被袖包住）
    arcBow(pb, 35, 32, 46); // 弓右移 1px：弓底阴影落在 x=34，避开 p3a0 手臂(x≤33)
    return;
  }
  // 攻击帧：拉弓放箭，箭脱手飞出（弧线朝右上）
  grassBase(pb, 10, 32, 54);
  pb.ellipse(21, 45, 12, 11, C.p3a2); // 绿身
  pb.ellipse(21, 53, 10, 5, C.p3w0); // 底部暗褐基座
  pb.ellipse(21, 40, 10, 6, C.p3w0); // 颈/前襟
  pb.rect(17, 42, 9, 5, C.p3w0); // 围裙
  pb.ellipse(21, 33, 5, 4.5, C.skin2);
  leafCrown(pb, 21, 28);
  face(pb, 18, 23, 34, 37, 3, false);
  pb.rect(31, 38, 4, 8, C.p3a0); // 手臂（手埋在袖里）
  pb.rect(32, 43, 2, 2, C.skin2); // 手
  // 弓仍成弧，但弦已松（箭飞出）；弓右移 1px 避开 p3a0 手臂
  for (let y = 32; y <= 46; y++) {
    const t = (y - 32) / 14;
    const bulge = Math.round(8 * Math.sin(Math.PI * t));
    pb.set(35 + bulge, y, C.wood4);
  }
  pb.rect(35, 32, 1, 15, C.ink1);
  // 脱手飞出的箭（人造物，切角）
  chamfer(pb, 38, 26, 3, 2, C.metal4, 1);
  pb.rect(40, 25, 3, 1, C.wood4);
  pb.set(43, 25, C.wood4);
}

/* ==========================================================================
 * 10. p4 紫晶 T1 · 石雕小怪
 *
 * §5.6.3 形状家族：菱形收尖 / 直线硬几何 / 菱形尖端 / 不落地（底部留 1–2px 空气 + ≥1 块悬浮小物）
 * §5.6.4 T1 格：菱形石块，底部悬空 1px，身上一道裂纹
 * §1.3 唯一失调：悬浮的菱形石块（无腿、违反"东西要落地"的直觉）
 * §5.5 p4 兵种剪影：无腿长袍/锥、上细下宽、发光眼
 * ========================================================================== */

/** 发光眼（p4 唯一用 emissive 当眼睛，§5.5）。 */
function glowEye(pb: PixBuf, x: number, y: number): void {
  pb.rect(x, y, 2, 2, C.p4emissive);
}

function drawStoneimp(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawStoneimpMap(pb);
  else if (kind === 'idle') drawStoneimpCombat(pb, false);
  else drawStoneimpCombat(pb, true);
}

/** 32×44 冒险地图帧：底部悬空（最高不透明行 40，画布 44 → 留 4px 空气，p4 母题）。 */
function drawStoneimpMap(pb: PixBuf): void {
  // 菱形石块（p4 母题）：上尖 y8、最宽 y24(x6-26)、下尖 y40（悬空）
  pb.poly([[16, 8], [26, 24], [16, 40], [6, 24]], C.p4w2);
  pb.poly([[16, 8], [16, 40], [6, 24]], C.p4w0); // 左侧暗面
  pb.poly([[16, 24], [26, 24], [16, 40]], C.p4w0); // 右下暗面
  // 身上一道裂纹（ink0，硬几何；p4w0 暗面与 ink0 ΔL*≈11.6，与 p4w2 更大，均过断言 8）
  pb.line(16, 12, 14, 20, C.ink0);
  pb.line(14, 20, 18, 28, C.ink0);
  pb.line(18, 28, 15, 36, C.ink0);
  // 发光眼
  glowEye(pb, 12, 22);
  glowEye(pb, 18, 22);
  // 小短手（暗石）
  pb.rect(4, 22, 3, 2, C.p4w0);
  pb.rect(25, 22, 3, 2, C.p4w0);
  // ≥1 块悬浮小物（emissive 菱形，脱离本体 → 第二轮廓环）
  pb.poly([[30, 30], [33, 33], [30, 36], [27, 33]], C.p4emissive);
}

/** 44×56 战斗帧：底部悬空（下尖 y52，画布 56 → 留 4px 空气）。 */
function drawStoneimpCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    pb.poly([[22, 10], [34, 30], [22, 52], [10, 30]], C.p4w2);
    pb.poly([[22, 10], [22, 52], [10, 30]], C.p4w0);
    pb.poly([[22, 30], [34, 30], [22, 52]], C.p4w0);
    pb.line(22, 16, 19, 28, C.ink0);
    pb.line(19, 28, 25, 38, C.ink0);
    pb.line(25, 38, 21, 48, C.ink0);
    glowEye(pb, 16, 28);
    glowEye(pb, 24, 28);
    pb.rect(7, 28, 4, 2, C.p4w0);
    pb.rect(33, 28, 4, 2, C.p4w0);
    pb.poly([[40, 36], [44, 40], [40, 44], [36, 40]], C.p4emissive); // 悬浮宝石
    return;
  }
  // 攻击帧：悬浮宝石被甩出（更大，朝右上飞），本体纹丝不动
  pb.poly([[22, 10], [34, 30], [22, 52], [10, 30]], C.p4w2);
  pb.poly([[22, 10], [22, 52], [10, 30]], C.p4w0);
  pb.poly([[22, 30], [34, 30], [22, 52]], C.p4w0);
  pb.line(22, 16, 19, 28, C.ink0);
  pb.line(19, 28, 25, 38, C.ink0);
  pb.line(25, 38, 21, 48, C.ink0);
  glowEye(pb, 16, 28);
  glowEye(pb, 24, 28);
  pb.rect(7, 28, 4, 2, C.p4w0);
  pb.rect(33, 28, 4, 2, C.p4w0);
  // 飞出的宝石（更大，菱形，脱离本体）
  pb.poly([[40, 24], [46, 30], [40, 36], [34, 30]], C.p4emissive);
  pb.set(40, 29, C.p4a4);
}

/* ==========================================================================
 * 11. p4 紫晶 T2 · 喷火学徒
 *
 * §5.6.3 形状家族：菱形收尖 / 上细下宽 / 不落地
 * §5.6.4 T2 格：细长锥袍，杖尖菱形，嘴前一小团火（悬空）
 * §1.3 唯一失调：细长锥袍 + 悬浮（袍子底下什么都没有，违反"落地"直觉）
 * §5.5 p4 兵种剪影：无腿长袍 + 垂坠感 + 发光眼
 * ========================================================================== */

function drawFireapprentice(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawFireapprenticeMap(pb);
  else if (kind === 'idle') drawFireapprenticeCombat(pb, false);
  else drawFireapprenticeCombat(pb, true);
}

/** 32×44 冒险地图帧：锥袍悬浮（下摆 y40，画布 44 → 留 4px 空气）。 */
function drawFireapprenticeMap(pb: PixBuf): void {
  // 细长锥袍（上细下宽，悬浮）
  pb.poly([[16, 10], [22, 10], [27, 40], [11, 40]], C.p4w2);
  pb.poly([[16, 10], [16, 40], [11, 40]], C.p4w0); // 左暗面
  pb.rect(14, 22, 5, 10, C.p4w0); // 袍上暗纹
  // 兜帽 + 发光眼 + 嘴
  pb.ellipse(16, 14, 4.5, 4, C.p4w0);
  glowEye(pb, 13, 14);
  glowEye(pb, 17, 14);
  pb.rect(14, 18, 4, 1, C.p4w0); // 嘴线
  // 杖（右，暗石，尖端 emissive 菱形）
  pb.rect(26, 12, 2, 28, C.p4w0);
  pb.poly([[29, 9], [31, 12], [29, 15], [27, 12]], C.p4emissive);
  // 嘴前悬空的小火团（emissive，脱离本体 → 第二轮廓环）
  pb.ellipse(11, 18, 2, 2, C.p4emissive);
}

/** 44×56 战斗帧：锥袍悬浮（下摆 y52，画布 56 → 留 4px 空气）。 */
function drawFireapprenticeCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    pb.poly([[22, 14], [30, 14], [38, 52], [14, 52]], C.p4w2);
    pb.poly([[22, 14], [22, 52], [14, 52]], C.p4w0);
    pb.rect(19, 28, 7, 16, C.p4w0);
    pb.ellipse(22, 20, 5.5, 5, C.p4w0); // 兜帽
    glowEye(pb, 18, 20);
    glowEye(pb, 24, 20);
    pb.rect(19, 26, 6, 1, C.p4w0);
    // 杖（左前方伸出，暗石，尖端 emissive 菱形）
    pb.rect(33, 18, 2, 34, C.p4w0);
    pb.poly([[36, 13], [38, 17], [36, 21], [34, 17]], C.p4emissive);
    // 嘴前悬空小火团
    pb.ellipse(15, 26, 2, 2, C.p4emissive);
    return;
  }
  // 攻击帧：杖前指，火团喷大飞出（朝左下），袍前倾
  pb.poly([[22, 14], [30, 14], [38, 52], [14, 52]], C.p4w2);
  pb.poly([[22, 14], [22, 52], [14, 52]], C.p4w0);
  pb.rect(19, 28, 7, 16, C.p4w0);
  pb.ellipse(23, 20, 5.5, 5, C.p4w0);
  glowEye(pb, 19, 20);
  glowEye(pb, 25, 20);
  pb.rect(20, 26, 6, 1, C.p4w0);
  // 杖甩向前（右上方）
  pb.rect(30, 14, 2, 30, C.p4w0);
  pb.poly([[33, 9], [35, 13], [33, 17], [31, 13]], C.p4emissive);
  // 喷出的大火团（更大，菱形，脱离本体）
  pb.poly([[16, 30], [20, 26], [24, 30], [20, 34]], C.p4emissive);
  pb.set(20, 29, C.p4a4);
}

/* ==========================================================================
 * 12. p1 晨曦 T3 · 铁誓枪兵
 *
 * §5.6.3 形状家族：垂直矩形 / 平行线 / 左右对称 / 顶部 1 处尖角 / 平底落地 / 高宽比 ≥ 1.25
 * §5.6.4 T3 格：矩形大盾正对镜头，枪竖直
 * §1.3 唯一失调：竖直长枪比人还高（p1「一切向上」母题最强一档，T3 体量 ≈78%）
 * §5.2 p1 兵种剪影：全部向上、高瘦、装备最整齐（头盔 + 竖条罩衫 + 矩形盾）
 * 配色断言 8 预检：盾面 p1w2(#eae3d2, L*≈90) 只贴 p1a0(#22559e, L*≈38)/p1a2(#3f8fe8, L*≈62)，
 *   色相差均 >150° → ΔL* 门槛仅 8；金属 boss 贴蓝衣 p1a2 色相差 ~8° 但 ΔL*≈29 ≥12；均过。
 * ========================================================================== */

/** 矩形大盾（p1 T3 的「板」：覆盖躯干正面 ≥40%）。人造物，四角切斜角（§1.2）。
 *  ⚠️ boss 用 metal0（暗金属），绝不用 metal4：metal4(#dfe6f0) 与盾面 p1w2(#eae3d2)
 *   同为近白，ΔL*=0.7 触发断言 8。metal0(#6b7686) 与 p1w2 ΔL*≈34 安全。 */
function bigShield(pb: PixBuf, x: number, y: number, w: number, h: number): void {
  chamfer(pb, x, y, w, h, C.p1w2, 1); // 石灰白盾面
  pb.frame(x, y, w, h, C.p1a0); // 蓝边
  pb.rect(x + ((w / 2) | 0) - 1, y + ((h / 2) | 0) - 2, 3, 4, C.metal0); // 中央暗金属 boss
  pb.set(x + ((w / 2) | 0), y + ((h / 2) | 0) + 1, C.metal2);
}

function drawOathpike(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawOathpikeMap(pb);
  else if (kind === 'idle') drawOathpikeCombat(pb, false);
  else drawOathpikeCombat(pb, true);
}

/** 32×44 冒险地图帧：脚底 42，枪尖 7，剪影高 35（T3 ≈78%）。 */
function drawOathpikeMap(pb: PixBuf): void {
  const cx = 14;
  pb.rect(9, 39, 6, 3, C.canv2);
  pb.rect(16, 39, 6, 3, C.canv2);
  aoContact(pb, 9, 21, 42);
  pb.rect(10, 36, 4, 3, C.p1a0);
  pb.rect(16, 36, 4, 3, C.p1a0);
  // 躯干：垂直矩形（p1 母题），竖条罩衫
  pb.rect(9, 27, 13, 9, C.p1a2);
  pb.hline(9, 21, 27, C.p1a0);
  pb.rect(13, 28, 5, 7, C.p1w2);
  pb.rect(9, 35, 13, 1, C.p1a0);
  // 头 + 头盔（p1 装备最整齐，金属盔 + 尖顶）
  pb.ellipse(cx, 23, 4.5, 4, C.skin2);
  pb.ellipse(cx, 21, 5.5, 2, C.wood0);
  pb.rect(9, 18, 11, 3, C.metal4);
  pb.rect(cx, 16, 2, 2, C.p1clash); // 盔顶撞色羽（§4 H4，面积 ≤8%）
  face(pb, 11, 15, 24, 26, 3, false);
  // 矩形大盾正对镜头（覆盖躯干正面 ≥40%）
  bigShield(pb, 10, 26, 12, 13);
  // 竖直长枪（唯一失调：比人高，枪尖在头顶之上）
  pb.rect(25, 9, 2, 27, C.metal4);
  pb.rect(25, 9, 1, 27, C.metal2);
  pb.rect(24, 7, 4, 3, C.wood4); // 枪镞
  pb.rect(26, 36, 2, 5, C.p1a0); // 右手握杆
  pb.rect(26, 40, 2, 2, C.skin2);
}

/** 44×56 战斗帧：脚底 54，枪尖 11，剪影高 43（T3 ≈78%）。 */
function drawOathpikeCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    const cx = 19;
    pb.rect(13, 51, 6, 4, C.canv2);
    pb.rect(21, 51, 6, 4, C.canv2);
    aoContact(pb, 13, 27, 54);
    pb.rect(14, 46, 4, 5, C.p1a0);
    pb.rect(21, 46, 4, 5, C.p1a0);
    // 躯干：垂直矩形 + 竖条罩衫
    pb.rect(13, 35, 14, 11, C.p1a2);
    pb.hline(13, 26, 35, C.p1a0);
    pb.rect(18, 36, 6, 9, C.p1w2);
    pb.rect(13, 44, 14, 2, C.p1a0);
    pb.hline(13, 26, 45, C.ink1);
    pb.rect(18, 45, 3, 1, C.metal4);
    // 头 + 金属盔 + 尖顶
    pb.ellipse(cx, 29, 5.5, 5, C.skin2);
    pb.ellipse(cx, 26, 5.5, 2, C.wood0);
    pb.rect(13, 24, 13, 3, C.metal4);
    pb.rect(cx, 21, 2, 3, C.p1clash);
    face(pb, 16, 21, 30, 33, 3, false);
    // 矩形大盾正对镜头
    bigShield(pb, 14, 33, 16, 18);
    // 竖直长枪（唯一失调：比人高）
    pb.rect(31, 13, 2, 33, C.metal4);
    pb.rect(31, 13, 1, 33, C.metal2);
    pb.rect(30, 10, 4, 4, C.wood4);
    pb.rect(33, 42, 3, 7, C.p1a0);
    pb.rect(33, 47, 3, 2, C.skin2);
    return;
  }
  // 攻击帧：0.85× 高（43→36）前冲刺枪，盾上抬
  pb.rect(11, 51, 6, 4, C.canv2);
  pb.rect(21, 50, 7, 5, C.canv2);
  aoContact(pb, 11, 27, 54);
  pb.rect(13, 47, 4, 4, C.p1a0);
  pb.rect(23, 45, 4, 5, C.p1a0);
  pb.poly([[14, 37], [26, 34], [28, 46], [16, 47]], C.p1a2);
  pb.line(14, 37, 26, 34, C.p1a0);
  pb.rect(18, 37, 6, 8, C.p1w2);
  pb.rect(14, 45, 14, 2, C.p1a0);
  pb.rect(18, 45, 3, 1, C.metal4);
  pb.ellipse(21, 31, 5, 4, C.skin2);
  pb.ellipse(21, 28, 5, 1.5, C.wood0);
  pb.rect(16, 26, 11, 3, C.metal4);
  pb.rect(20, 23, 2, 3, C.p1clash);
  face(pb, 18, 23, 31, 34, 3, false);
  // 盾上抬（贴前胸）
  bigShield(pb, 14, 35, 15, 16);
  // 枪向前下方刺出（金属杆 + 木镞）；枪杆起点 x≥30，与白盾(p1w2, x≤28) 隔 1px 空气，绝不相邻
  pb.rect(29, 42, 2, 2, C.skin2); // 手（白盾右侧外，skin2↔p1w2 ΔL*≈17 ≥12）
  thickLine(pb, 30, 42, 38, 33, C.metal4, C.metal4);
  pb.rect(36, 31, 6, 2, C.metal4);
  pb.rect(36, 30, 6, 1, C.metal2);
  pb.rect(37, 29, 2, 6, C.wood4);
}

/* ==========================================================================
 * 13. p1 晨曦 T4 · 圣殿骑士
 *
 * §5.6.3 形状家族：垂直矩形 / 左右对称 / 顶部尖角（冠羽）/ 平底落地 / 高宽比 ≥ 1.25
 * §5.6.4 T4 格：高坐骑，人+马，全套竖直甲片，顶上冠羽
 * §1.3 唯一失调：冠羽比头盔还高（p1「一切向上」母题在 T4 的尖角峰值）
 * §5.2 p1 兵种剪影：全部向上、高瘦、装备最整齐
 * 配色断言 8 预检：白马 p1w2(L*≈90) 只贴 p1a0 鞍裙(L*≈38)/p1a2 骑手(L*≈62)，色相差 >150°；
 *   骑手金属甲片 metal4 贴蓝衣 p1a2 色相差 ~8° 但 ΔL*≈29 ≥12；马蹄 stone0 贴白马同族(stone)。
 * ========================================================================== */

function drawTemplar(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawTemplarMap(pb);
  else if (kind === 'idle') drawTemplarCombat(pb, false);
  else drawTemplarCombat(pb, true);
}

/** 32×44 冒险地图帧：马蹄 42，冠羽尖 9，剪影高 33（T4 ≈75%，坐骑占高）。 */
function drawTemplarMap(pb: PixBuf): void {
  // 马身（白马 p1w2）+ 暗面 p1a0 鞍裙隔开与骑手
  pb.ellipse(15, 34, 11, 6, C.p1w2); // 马身
  pb.ellipse(15, 38, 11, 3, C.stone2); // 马腹暗面（同族 stone）
  pb.rect(4, 33, 5, 4, C.p1w2); // 马头（前伸，左）
  pb.rect(3, 33, 2, 2, C.stone0); // 口鼻
  pb.rect(24, 33, 3, 5, C.p1a0); // 马尾（暗蓝）
  // 四腿（细）
  pb.rect(8, 39, 2, 3, C.stone0);
  pb.rect(13, 39, 2, 3, C.stone0);
  pb.rect(18, 39, 2, 3, C.stone0);
  pb.rect(22, 39, 2, 3, C.stone0);
  aoContact(pb, 8, 23, 42);
  // 鞍裙（暗蓝，隔开白马与蓝骑手）
  pb.rect(12, 30, 8, 5, C.p1a0);
  // 骑手（人+马双头剪影的上头）：垂直甲片 + 蓝衣
  pb.rect(13, 22, 6, 9, C.p1a2);
  pb.rect(15, 22, 2, 9, C.metal4); // 竖直甲片（金属）
  pb.ellipse(16, 19, 4, 3.5, C.skin2);
  pb.rect(13, 16, 6, 3, C.metal4); // 头盔
  // 冠羽（唯一失调：比头盔高）
  pb.rect(16, 11, 2, 5, C.p1clash);
  pb.set(16, 10, C.p1clash);
  face(pb, 14, 18, 19, 21, 3, false);
}

/** 44×56 战斗帧：马蹄 54，冠羽尖 11，剪影高 43（T4 ≈77% → 坐骑使整体更高）。 */
function drawTemplarCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    // 马身（白马）+ 暗面
    pb.ellipse(22, 46, 15, 8, C.p1w2);
    pb.ellipse(22, 51, 15, 4, C.stone2);
    pb.rect(4, 44, 7, 6, C.p1w2); // 马头前伸（左）
    pb.rect(2, 44, 3, 3, C.stone0); // 口鼻
    pb.rect(38, 43, 4, 7, C.p1a0); // 马尾
    // 四腿
    pb.rect(10, 52, 3, 3, C.stone0);
    pb.rect(18, 53, 3, 3, C.stone0);
    pb.rect(27, 53, 3, 3, C.stone0);
    pb.rect(34, 52, 3, 3, C.stone0);
    aoContact(pb, 10, 36, 55);
    // 鞍裙（暗蓝）
    pb.rect(17, 40, 11, 7, C.p1a0);
    // 骑手：垂直甲片 + 蓝衣 + 金属胸甲
    pb.rect(18, 29, 8, 12, C.p1a2);
    pb.rect(21, 29, 3, 12, C.metal4); // 竖直甲片
    pb.hline(18, 25, 41, C.p1a0);
    pb.rect(18, 40, 8, 1, C.p1a0);
    // 手臂握缰（暗蓝袖）
    pb.rect(15, 32, 3, 6, C.p1a0);
    pb.rect(26, 32, 3, 6, C.p1a0);
    pb.rect(15, 37, 3, 2, C.skin2);
    pb.rect(26, 37, 3, 2, C.skin2);
    // 头 + 金属盔
    pb.ellipse(22, 25, 5, 4, C.skin2);
    pb.ellipse(22, 22, 5, 1.5, C.wood0);
    pb.rect(17, 19, 11, 3, C.metal4);
    face(pb, 19, 24, 26, 28, 3, false);
    // 冠羽（唯一失调：比头盔高，突破肩线）
    pb.rect(22, 12, 3, 7, C.p1clash);
    pb.set(22, 11, C.p1clash);
    pb.set(23, 11, C.p1clash);
    return;
  }
  // 攻击帧：0.85× 高（43→36）马前蹄扬起、骑手举枪下劈
  pb.ellipse(22, 46, 15, 8, C.p1w2);
  pb.ellipse(22, 51, 15, 4, C.stone2);
  pb.rect(4, 44, 7, 6, C.p1w2);
  pb.rect(2, 44, 3, 3, C.stone0);
  pb.rect(38, 43, 4, 7, C.p1a0);
  pb.rect(10, 50, 3, 5, C.stone0); // 后蹄蹬
  pb.rect(18, 49, 3, 5, C.stone0);
  pb.rect(27, 52, 3, 4, C.stone0);
  pb.rect(34, 49, 3, 5, C.stone0); // 前蹄扬
  aoContact(pb, 10, 36, 55);
  pb.rect(17, 40, 11, 7, C.p1a0);
  pb.poly([[18, 30], [27, 27], [28, 40], [17, 41]], C.p1a2);
  pb.line(18, 30, 27, 27, C.p1a0);
  pb.rect(21, 30, 3, 11, C.metal4);
  pb.rect(15, 32, 3, 6, C.p1a0);
  pb.rect(26, 31, 3, 6, C.p1a0);
  pb.rect(15, 37, 3, 2, C.skin2);
  pb.rect(26, 36, 3, 2, C.skin2);
  pb.ellipse(22, 25, 5, 4, C.skin2);
  pb.ellipse(22, 22, 5, 1.5, C.wood0);
  pb.rect(17, 19, 11, 3, C.metal4);
  face(pb, 19, 24, 26, 28, 3, false);
  pb.rect(22, 12, 3, 7, C.p1clash);
  pb.set(22, 11, C.p1clash);
  // 长枪下劈（金属杆 + 木镞指左下）
  thickLine(pb, 26, 30, 34, 38, C.metal4, C.metal4);
  pb.rect(32, 37, 6, 2, C.metal4);
  pb.rect(31, 36, 2, 6, C.wood4);
}
