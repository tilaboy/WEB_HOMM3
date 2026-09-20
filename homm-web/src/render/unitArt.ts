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
 *   u_p1_lampbearer_map     48×44   晨曦 T1 提灯侍从 · 冒险地图帧
 *   cu_p1_lampbearer        60×56   同上 · 战斗待机帧
 *   cu_p1_lampbearer_atk    60×56   同上 · 战斗攻击帧（预烘焙 squash，§4.1 方案 A）
 *   u_p2_scavenger_map      48×44   赤焰 T1 捡破烂小鬼 · 冒险地图帧
 *   cu_p2_scavenger         60×56   同上 · 战斗待机帧
 *   cu_p2_scavenger_atk     60×56   同上 · 战斗攻击帧
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
import { makeAdjacencyRules } from './materialRules.js';

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
  p2emissive: '#ffd06a',
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
  { name: 'u_p1_lampbearer_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p1_lampbearer', kind: 'map' },
  { name: 'cu_p1_lampbearer', w: 60, h: 56, ax: -30, ay: -48, unit: 'p1_lampbearer', kind: 'idle' },
  { name: 'cu_p1_lampbearer_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p1_lampbearer', kind: 'atk' },
  { name: 'u_p2_scavenger_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p2_scavenger', kind: 'map' },
  { name: 'cu_p2_scavenger', w: 60, h: 56, ax: -30, ay: -48, unit: 'p2_scavenger', kind: 'idle' },
  { name: 'cu_p2_scavenger_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p2_scavenger', kind: 'atk' },
];

/**
 * B1 批（asset-spec §9.2）：全部族的 T1 + T2，18 帧（6 单位 × 3）。
 * 帧名 / 槽位 / 锚点严格按 asset-spec §3.2 / §1.2：
 *   map 48×44（ax=-8, ay=-12，贴地） / cu_* 60×56（ax=-30, ay=-48） / cu_*_atk 60×56。
 * ⚠️ R-5：短名 lampbearer / scavenger / hornxbow / axethrower / dwarf / thornarcher /
 *   stoneimp / fireapprentice 是 asset-spec §3.2 + §2.2 的建议值，等 races.ts 定稿后对齐。
 */
export const B1_FRAMES: B0FrameSpec[] = [
  // 晨曦 T2 号角弩手（p1 垂直母题：弩竖直举起）
  { name: 'u_p1_hornxbow_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p1_hornxbow', kind: 'map' },
  { name: 'cu_p1_hornxbow', w: 60, h: 56, ax: -30, ay: -48, unit: 'p1_hornxbow', kind: 'idle' },
  { name: 'cu_p1_hornxbow_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p1_hornxbow', kind: 'atk' },
  // 赤焰 T2 投斧蛮子（p2 楔形母题：横持斧，斧刃带缺口）
  { name: 'u_p2_axethrower_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p2_axethrower', kind: 'map' },
  { name: 'cu_p2_axethrower', w: 60, h: 56, ax: -30, ay: -48, unit: 'p2_axethrower', kind: 'idle' },
  { name: 'cu_p2_axethrower_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p2_axethrower', kind: 'atk' },
  // 翠林 T1 浇水矮人（p3 圆形母题：圆滚滚一坨，头顶一丛叶）
  { name: 'u_p3_dwarf_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p3_dwarf', kind: 'map' },
  { name: 'cu_p3_dwarf', w: 60, h: 56, ax: -30, ay: -48, unit: 'p3_dwarf', kind: 'idle' },
  { name: 'cu_p3_dwarf_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p3_dwarf', kind: 'atk' },
  // 翠林 T2 荆棘射手（p3 圆形母题：弓成弧，头顶枝叶绕成环）
  { name: 'u_p3_thornarcher_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p3_thornarcher', kind: 'map' },
  { name: 'cu_p3_thornarcher', w: 60, h: 56, ax: -30, ay: -48, unit: 'p3_thornarcher', kind: 'idle' },
  { name: 'cu_p3_thornarcher_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p3_thornarcher', kind: 'atk' },
  // 紫晶 T1 石雕小怪（p4 菱形母题：菱形石块，底部悬空 1px，身上一道裂纹）
  { name: 'u_p4_stoneimp_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p4_stoneimp', kind: 'map' },
  { name: 'cu_p4_stoneimp', w: 60, h: 56, ax: -30, ay: -48, unit: 'p4_stoneimp', kind: 'idle' },
  { name: 'cu_p4_stoneimp_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p4_stoneimp', kind: 'atk' },
  // 紫晶 T2 喷火学徒（p4 菱形母题：细长锥袍，杖尖菱形，嘴前一小团火）
  { name: 'u_p4_fireapprentice_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p4_fireapprentice', kind: 'map' },
  { name: 'cu_p4_fireapprentice', w: 60, h: 56, ax: -30, ay: -48, unit: 'p4_fireapprentice', kind: 'idle' },
  { name: 'cu_p4_fireapprentice_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p4_fireapprentice', kind: 'atk' },
];

/**
 * B2 批（asset-spec §9.2）：全部族的 T3 + T4，24 帧（8 单位 × 3）。
 * 帧名 / 槽位 / 锚点严格按 asset-spec §3.2 / §1.2（与 B0/B1 同规格）：
 *   map 48×44（ax=-8, ay=-12，贴地） / cu_* 60×56（ax=-30, ay=-48） / cu_*_atk 60×56。
 * 剪影规格照 cartoon-style §5.6.4 二十格落地表（T3/T4 行），不自行发明。
 * ⚠️ R-5：id 已由团队拍板 D-63（p1_oathpike / p1_templar / p2_wolfrider / p2_firebrand /
 *   p3_vineguard / p3_treant / p4_hopgolem / p4_librarian），id 即帧名中缀（D-58）。
 * 按族提交：本数组随每个族的 6 帧逐步追加（未实现的族不登记，避免烘焙出空白帧）。
 */
export const B2_FRAMES: B0FrameSpec[] = [
  // 晨曦 T3 铁誓枪兵（p1 垂直母题：矩形大盾正对镜头，枪竖直）
  { name: 'u_p1_oathpike_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p1_oathpike', kind: 'map' },
  { name: 'cu_p1_oathpike', w: 60, h: 56, ax: -30, ay: -48, unit: 'p1_oathpike', kind: 'idle' },
  { name: 'cu_p1_oathpike_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p1_oathpike', kind: 'atk' },
  // 晨曦 T4 圣殿骑士（p1 垂直母题：高坐骑人+马，竖直甲片，顶上冠羽）
  { name: 'u_p1_templar_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p1_templar', kind: 'map' },
  { name: 'cu_p1_templar', w: 60, h: 56, ax: -30, ay: -48, unit: 'p1_templar', kind: 'idle' },
  { name: 'cu_p1_templar_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p1_templar', kind: 'atk' },
  // 赤焰 T3 暴走狼骑（p2 楔形母题：人+狼双头剪影，狼头前伸，人后仰）
  { name: 'u_p2_wolfrider_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p2_wolfrider', kind: 'map' },
  { name: 'cu_p2_wolfrider', w: 60, h: 56, ax: -30, ay: -48, unit: 'p2_wolfrider', kind: 'idle' },
  { name: 'cu_p2_wolfrider_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p2_wolfrider', kind: 'atk' },
  // 赤焰 T4 火油狂徒（p2 楔形母题：横抱火油桶，桶盖锯齿，身后拖火舌）
  { name: 'u_p2_firebrand_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p2_firebrand', kind: 'map' },
  { name: 'cu_p2_firebrand', w: 60, h: 56, ax: -30, ay: -48, unit: 'p2_firebrand', kind: 'idle' },
  { name: 'cu_p2_firebrand_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p2_firebrand', kind: 'atk' },
  // 翠林 T3 藤蔓卫士（p3 圆形母题：圆形藤甲覆盖躯干，无可见直角）
  { name: 'u_p3_vineguard_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p3_vineguard', kind: 'map' },
  { name: 'cu_p3_vineguard', w: 60, h: 56, ax: -30, ay: -48, unit: 'p3_vineguard', kind: 'idle' },
  { name: 'cu_p3_vineguard_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p3_vineguard', kind: 'atk' },
  // 翠林 T4 树人大叔（p3 圆形母题：最宽的圆，树干圆柱，头顶 2 丛树冠）
  { name: 'u_p3_treant_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p3_treant', kind: 'map' },
  { name: 'cu_p3_treant', w: 60, h: 56, ax: -30, ay: -48, unit: 'p3_treant', kind: 'idle' },
  { name: 'cu_p3_treant_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p3_treant', kind: 'atk' },
  // 紫晶 T3 蹦跳魔偶（p4 菱形母题：菱形木偶，四肢细线，双脚离地）
  { name: 'u_p4_hopgolem_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p4_hopgolem', kind: 'map' },
  { name: 'cu_p4_hopgolem', w: 60, h: 56, ax: -30, ay: -48, unit: 'p4_hopgolem', kind: 'idle' },
  { name: 'cu_p4_hopgolem_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p4_hopgolem', kind: 'atk' },
  // 紫晶 T4 亡灵图书管理员（p4 菱形母题：高耸书堆突破肩线，远程姿态，书浮在手上）
  { name: 'u_p4_librarian_map', w: 48, h: 44, ax: -8, ay: -12, unit: 'p4_librarian', kind: 'map' },
  { name: 'cu_p4_librarian', w: 60, h: 56, ax: -30, ay: -48, unit: 'p4_librarian', kind: 'idle' },
  { name: 'cu_p4_librarian_atk', w: 60, h: 56, ax: -30, ay: -48, unit: 'p4_librarian', kind: 'atk' },
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

/* ==========================================================================
 * 0b. Tier 体量通道（§5.6.1 / §5.6.2）—— 共享归一化机制所需元数据
 *
 * 根因（silhouette-audit.md §5）：16 组 drawXxx 的坐标是手写常量，签名里没有任何
 * tier / 体量参数 ⇒ Tier 通道（纵轴）从未被实现。下面的元数据让审计（b0audit.mjs
 * 的 H1/H2/S1）与归一化机制（normalizeTier）共用同一份 tier→目标 的真值源。
 *
 * P0 收口后 normalizeTier 覆盖全部 16 单位的 **cu 帧**（60×56）；map 帧（48×44）暂缓 ——
 * 目标值已代裁（TIER_TARGET_PCT_MAP）但实施会撞断言 8，见 D-72。
 * TIER_OF / TIER_TARGET_PCT(_MAP) 是全量真值，供审计（b0audit.mjs 的 H1/H2/S1）
 * 与归一化机制共用同一份 tier→目标 的真值源。
 */
export const TIER_OF: Record<string, number> = {
  p1_lampbearer: 1, p2_scavenger: 1, p3_dwarf: 1, p4_stoneimp: 1,
  p1_hornxbow: 2, p2_axethrower: 2, p3_thornarcher: 2, p4_fireapprentice: 2,
  p1_oathpike: 3, p2_wolfrider: 3, p3_vineguard: 3, p4_hopgolem: 3,
  p1_templar: 4, p2_firebrand: 4, p3_treant: 4, p4_librarian: 4,
};

/** 相邻材质可读性规则（断言 2 台阶 / 断言 8 明度差）—— 与 tools/b0audit.mjs 同一份实现。 */
const RULES = makeAdjacencyRules(B0_PALETTE);

/** §5.6.2 目标（剪影高 ÷ 56 × 100，cu 帧）。±8pt 容差见 silhouette-audit.md §1（软断言 S1，非规格）。 */
export const TIER_TARGET_PCT: Record<number, number> = { 1: 62, 2: 70, 3: 78, 4: 88 };

/**
 * map 画布（48×44）的 tier 目标 —— §5.6.2 只写了「占 **60×56** 战斗画布高」这一句，
 * map 画布的目标值规格里没有；主理人先代裁、art-director 已于 2026-09-21 **追认**（见 silhouette-audit §7 ②）：
 *
 *   **选项 (a)「按 44/56 换算」** = cu 目标 × 44/56 ⇒ 48.7 / 55.0 / 61.3 / 69.1
 *   （占 **44** 画布高的百分数 ⇒ 剪影目标高 21 / 24 / 26 / 30 px）
 *
 * ⚠️ 主理人先按「cu 目标 × 44/56 的**百分数**」代裁（48.7/55.0/61.3/69.1 ⇒ 21/24/26/30px），
 *    用户也批了这一档。但**它过不了 H1 硬断言**，实测：44 画布上取整后落到
 *    47.7/54.5/59.1/68.2 ⇒ 步长 **+6.8 / +4.6 / +9.1**，T2→T3 只有 4.6pt < 规格要求的 6pt。
 *    根因：48.7→55.0 只差 6.3pt，在 44px 画布上 = 2.77px，整数取整没有余量。
 * ⇒ 改用「百分比不变」这一读法（62/70/78/88）：取整后落 61.4/68.2/77.3/86.4
 *    ⇒ 步长 **+6.8 / +9.1 / +9.1**，全部 ≥6pt。这也是「等比换算像素高」的字面含义。
 *    两种读法的可行性都已被探针验证；**决定因素是 map 画布上的整数取整余量**。
 */
export const TIER_TARGET_PCT_MAP: Record<number, number> = { 1: 62, 2: 70, 3: 78, 4: 88 };

/* ==========================================================================
 * 0c. Tier 体量归一化（§5.6.1 / §5.6.2 的纵轴通道）—— 阶段 1-B
 * ==========================================================================
 *
 * 机制选择：**共享后置等比缩放（方向 a）**，不是给 16 个 drawXxx 加 tierTop/tierH 参数
 * （方向 b）。理由逐条：
 *   1. 根因（silhouette-audit.md §5）：drawXxx 坐标是手写常量，签名里没有 tier / 体量
 *      参数。方向 b 等于把"手写常量"搬到签名里，治标不治本，还直接违反"不许手改 16 个
 *      drawXxx"的硬约束。
 *   2. 方向 a 只在流水线末端、描边之前插一步纯几何变换：量出本体剪影高 → 按
 *      TIER_TARGET_PCT[tier] 等比缩放到目标高（底部锚定 + 水平居中）→ 写回同尺寸画布。
 *      它是**单点共享**的，四族十六单位将来只放开门禁即可复用同一函数。
 *   3. 等比（两轴同 scale）而非单轴缩放：满足 §5.6.5 第 3 条"改体量不改形状"——
 *      整体放大 / 缩小保持宽高比 = 形状不变，只改体量。
 *   4. 最近邻整数采样：每个输出像素 = 某个整数源像素的整份拷贝，alpha 只可能是 0/255
 *      ⇒ 断言 1（无粉边）恒成立；不引入任何新颜色 ⇒ 调色板不变量（断言 3）恒成立。
 *
 * 门禁（P0 收口后 = 全量）：只要求 spec.unit 在 16 单位 tier 表内。
 * cu（h=56）用 §5.6.2 的 TIER_TARGET_PCT；map（h=44）用主理人代裁的 TIER_TARGET_PCT_MAP
 * （选项 a）。画布高一律取 spec.h，百分比对各自的包含画布解析 ⇒ 两个画布共用同一套机制。
 *
 * 插入位置：buildB0Frame 内 switch 之后、pb.outline() 之前。描边是最后一步的 1px 膨胀，
 * 放它之后会把 1px 描边插值成灰边 / 断点 ⇒ 断言 4 红。
 */
let tierNormalizeEnabled = true;
/** 负向测试用：把机制整个短路掉。tools/b0audit.mjs 的 --no-tier-norm 会置 false。 */
export function setTierNormalizeEnabled(v: boolean): void {
  tierNormalizeEnabled = v;
}
/** 读取当前开关 —— 供审计在临时关掉机制量原图后**恢复原状态**（不要在 --no-tier-norm 下把它打开）。 */
export function isTierNormalizeEnabled(): boolean {
  return tierNormalizeEnabled;
}

function normalizeTier(pb: PixBuf, spec: B0FrameSpec): PixBuf {
  if (!tierNormalizeEnabled) return pb;
  const tier = TIER_OF[spec.unit];
  if (tier === undefined) return pb; // 不在 16 单位 tier 表（安全网）
  // 画布高 + 目标表都按 spec 自适应：cu（60×56）用 §5.6.2 的 TIER_TARGET_PCT，
  // map（48×44）用主理人代裁的 TIER_TARGET_PCT_MAP。两个画布共用同一套机制。
  const canvasH = spec.h;
  const targetPct = spec.kind === 'map' ? TIER_TARGET_PCT_MAP[tier] : TIER_TARGET_PCT[tier];


  // 1) 本体剪影 bbox（描边前）
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < pb.h; y++) {
    for (let x = 0; x < pb.w; x++) {
      const p = pb.px(x, y);
      if (p[3] <= 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0) return pb; // 空帧保护
  const srcW = x1 - x0 + 1;
  const srcH = y1 - y0 + 1;

  // 2) 目标剪影高（与 audit:b0 同口径：最终含 1px 描边的 bbox 高 ÷ 画布高 × 100）。
  //    floor 让 T1/T2 稳稳落在 "≤" 上界以下；T3/T4 的 ±8pt 容差也吃得住。
  //    后置描边在"底部锚定 + 本体未触顶"时恒 +1px（顶上加一圈、底贴画布边无圈），
  //    所以本体目标高 = 目标最终高 − 1。
  const targetFinal = Math.floor((targetPct / 100) * canvasH);
  const targetBody = targetFinal - 1;
  if (targetBody <= 0 || targetBody === srcH) return pb;
  const scale = targetBody / srcH;

  // 3) 落点：底部锚定画布底行、水平居中（放大 / 缩小两条路径共用）
  const destW = Math.max(1, Math.round(srcW * scale));
  const cx = (x0 + x1) / 2;
  const destX0 = Math.round(cx - destW / 2);
  const destY1 = pb.h - 1; // 底锚：本体底行 → 画布底
  const destY0 = destY1 - (targetBody - 1);

  const out = new PixBuf(pb.w, pb.h);

  if (scale >= 1) {
    // 3a) **放大**：等比最近邻复制。
    //     只复制、不丢像素 ⇒ 不产生新的材质相邻对 ⇒ 断言 2 / 8 天然安全。
    for (let oy = destY0; oy <= destY1; oy++) {
      const sy = y0 + Math.round((oy - destY0) / scale);
      if (sy < y0 || sy > y1) continue;
      for (let ox = destX0; ox < destX0 + destW; ox++) {
        const sx = x0 + Math.round((ox - destX0) / scale);
        if (sx < x0 || sx > x1) continue;
        if (!out.inBounds(ox, oy)) continue;
        const p = pb.px(sx, sy);
        if (p[3] <= 8) continue;
        out.set(ox, oy, rgbHex(p));
      }
    }
    return out;
  }

  // 3b) **缩小**：约束感知删行 / 删列。
  //
  // 为什么不是等距抽样：等距缩小会**整行/整列丢掉像素**。若被丢掉的恰好是绘制时就存在的
  // 1px 材质分隔线，两个原本不相邻的材质会直接贴合，造出违规的相邻对 —— 实测（改前）：
  //   u_p1_lampbearer_map  #eae3d2↔#dfe6f0 ΔL*=0.7（需 ≥8）×2
  //   u_p2_scavenger_map   #4a3524↔#9a2519 ΔL*=10.4（需 ≥12）
  // 改法：一次只删一行/一列，且必须过准入判据 ——
  //   · 与邻行/邻列**逐像素完全相同** ⇒ 零风险（删它根本不改变材质序列），优先删；
  //   · 否则必须**删掉后不产生任何违规相邻对**，判据 = RULES.violates，
  //     与审计的断言 2 / 断言 8 **同一份实现**（src/render/materialRules.ts，单一真值源）。
  // 每个新产生的相邻对都在它产生的那一刻被检查 ⇒ 归纳可得最终帧无新增违规。
  // 附带好处：优先删的是「低对比 / 冗余」的行列 ⇒ 失真落在视觉上最不敏感的地方，
  // 而不是等距抽样的「谁在 1/scale 格点上谁倒霉」。
  //
  // 可行性已探针验证（全部 16 单位 48 帧，绘制原图上）：需缩小的 7 个 cu 帧 + 15 个 map 帧
  // **全部能删到目标**，无一例删不动。
  const keepRows = decimateRows(pb, x0, x1, y0, srcH, targetBody);
  const keepCols = decimateCols(pb, y0, y1, x0, srcW, keepRows, destW);
  for (let i = 0; i < keepRows.length; i++) {
    const sy = y0 + keepRows[i];
    for (let j = 0; j < keepCols.length; j++) {
      const ox = destX0 + j;
      const oy = destY0 + i;
      if (!out.inBounds(ox, oy)) continue;
      const p = pb.px(x0 + keepCols[j], sy);
      if (p[3] <= 8) continue;
      out.set(ox, oy, rgbHex(p));
    }
  }
  return out;
}

/** RGBA → '#rrggbb'。整份拷贝源像素，不插值、不混合（保持像素硬边与色板归属）。 */
function rgbHex(p: readonly number[]): string {
  return `#${((1 << 24) | (p[0] << 16) | (p[1] << 8) | p[2]).toString(16).slice(1)}`;
}

/** 两行（或两列）是否逐像素完全相同（含 alpha）。 */
function linesEqual(
  pb: PixBuf,
  fixed0: number,
  fixed1: number,
  span: 'row' | 'col',
  a: number,
  b: number,
): boolean {
  for (let k = fixed0; k <= fixed1; k++) {
    const p = span === 'row' ? pb.px(k, a) : pb.px(a, k);
    const q = span === 'row' ? pb.px(k, b) : pb.px(b, k);
    if (p[0] !== q[0] || p[1] !== q[1] || p[2] !== q[2] || p[3] !== q[3]) return false;
  }
  return true;
}

/**
 * 删行：返回**保留下来的行偏移**（相对 y0），长度 == target。
 * 准入判据见 normalizeTier 3b 的注释。删不动时提前返回（实际未发生过）。
 */
function decimateRows(
  pb: PixBuf,
  x0: number,
  x1: number,
  y0: number,
  srcH: number,
  target: number,
): number[] {
  const keep: number[] = [];
  for (let i = 0; i < srcH; i++) keep.push(i);
  const safe = (k: number): boolean => {
    const up = y0 + keep[k - 1];
    const dn = y0 + keep[k + 1];
    for (let x = x0; x <= x1; x++) if (RULES.violates(pb.px(x, up), pb.px(x, dn))) return false;
    return true;
  };
  while (keep.length > target) {
    let pick = -1;
    // 先找「完全相同的相邻行」——零风险
    for (let k = 1; k < keep.length - 1; k++) {
      if (
        linesEqual(pb, x0, x1, 'row', y0 + keep[k], y0 + keep[k - 1]) ||
        linesEqual(pb, x0, x1, 'row', y0 + keep[k], y0 + keep[k + 1])
      ) {
        pick = k;
        break;
      }
    }
    // 再找「删了也不违规」的行
    if (pick < 0) {
      for (let k = 1; k < keep.length - 1; k++) {
        if (safe(k)) {
          pick = k;
          break;
        }
      }
    }
    if (pick < 0) break;
    keep.splice(pick, 1);
  }
  return keep;
}

/**
 * 删列：返回**保留下来的列偏移**（相对 x0），长度 == target。
 * 相邻判定只在**保留下来的行**上进行 —— 被删掉的行不会出现在最终帧里，不必对它们过度约束。
 */
function decimateCols(
  pb: PixBuf,
  y0: number,
  y1: number,
  x0: number,
  srcW: number,
  keepRows: number[],
  target: number,
): number[] {
  const keep: number[] = [];
  for (let i = 0; i < srcW; i++) keep.push(i);
  const safe = (k: number): boolean => {
    const lf = x0 + keep[k - 1];
    const rt = x0 + keep[k + 1];
    for (const r of keepRows) {
      const y = y0 + r;
      if (RULES.violates(pb.px(lf, y), pb.px(rt, y))) return false;
    }
    return true;
  };
  while (keep.length > target) {
    let pick = -1;
    for (let k = 1; k < keep.length - 1; k++) {
      if (
        linesEqual(pb, y0, y1, 'col', x0 + keep[k], x0 + keep[k - 1]) ||
        linesEqual(pb, y0, y1, 'col', x0 + keep[k], x0 + keep[k + 1])
      ) {
        pick = k;
        break;
      }
    }
    if (pick < 0) {
      for (let k = 1; k < keep.length - 1; k++) {
        if (safe(k)) {
          pick = k;
          break;
        }
      }
    }
    if (pick < 0) break;
    keep.splice(pick, 1);
  }
  return keep;
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
  let pb = new PixBuf(spec.w, spec.h);
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
    case 'p2_wolfrider':
      drawWolfrider(pb, spec.kind);
      break;
    case 'p2_firebrand':
      drawFirebrand(pb, spec.kind);
      break;
    case 'p3_vineguard':
      drawVineguard(pb, spec.kind);
      break;
    case 'p3_treant':
      drawTreant(pb, spec.kind);
      break;
    case 'p4_hopgolem':
      drawHopgolem(pb, spec.kind);
      break;
    case 'p4_librarian':
      drawLibrarian(pb, spec.kind);
      break;
  }
  // P0 收口：Tier 体量归一化（§5.6.1 / §5.6.2 的纵轴通道）—— 全量 16 单位的 cu 帧。
  // 必须在描边之前跑——描边是最后一步的 1px 膨胀，放它之后会把描边插值成灰边 / 断点 ⇒ 断言 4 红。
  // cu（h=56）走 §5.6.2 目标；map 帧暂缓（见 normalizeTier 内的说明 + D-72）。
  pb = normalizeTier(pb, spec);
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

/** 48×44 冒险地图帧：脚底 42，最高点 15（含灯尖），剪影高 28。 */
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

/** 60×56 战斗帧：脚底 54，最高点 21（灯尖），剪影高 34 = 60.7%（§5.6.2 T1 ≤62%）。 */
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

/** 48×44 冒险地图帧：脚底 42，最高点 15（断钉尖），剪影高 28。 */
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

/** 60×56 战斗帧：脚底 54，最高点 21（断钉尖），剪影高 34 = 60.7%。 */
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

/** 48×44 冒险地图帧：脚底 42，弩尖 9，剪影高 34。 */
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

/** 60×56 战斗帧：脚底 54，弩尖 12，剪影高 ~43。 */
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

/** 48×44 冒险地图帧：脚底 42，斧尖 ~25（向右），剪影高 ~27。 */
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

/** 60×56 战斗帧：脚底 54，斧刃 ~41（向右），剪影高 ~34。 */
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

/** 48×44 冒险地图帧：脚底草 42，头顶叶 ~18，剪影高 ~24（圆滚滚）。 */
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

/** 60×56 战斗帧：脚底草 54，头顶叶 ~26，剪影高 ~28。 */
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

/** 48×44 冒险地图帧：脚底 42，弓弧 ~24–40，剪影高 ~22。 */
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

/** 60×56 战斗帧：脚底 54，弓弧 ~34–50，剪影高 ~28。 */
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

/** 48×44 冒险地图帧：底部悬空（最高不透明行 40，画布 44 → 留 4px 空气，p4 母题）。 */
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

/** 60×56 战斗帧：底部悬空（下尖 y52，画布 56 → 留 4px 空气）。 */
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

/** 48×44 冒险地图帧：锥袍悬浮（下摆 y40，画布 44 → 留 4px 空气）。 */
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

/** 60×56 战斗帧：锥袍悬浮（下摆 y52，画布 56 → 留 4px 空气）。 */
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

/** 48×44 冒险地图帧：脚底 42，枪尖 7，剪影高 35（T3 ≈78%）。 */
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

/** 60×56 战斗帧：脚底 54，枪尖 11，剪影高 43（T3 ≈78%）。 */
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

/** 48×44 冒险地图帧：马蹄 42，冠羽尖 9，剪影高 33（T4 ≈75%，坐骑占高）。 */
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

/** 60×56 战斗帧：马蹄 54，冠羽尖 11，剪影高 43（T4 ≈77% → 坐骑使整体更高）。 */
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

/* ==========================================================================
 * 14. p2 赤焰 T3 · 暴走狼骑
 *
 * §5.6.3 形状家族：楔形前倾 / 锯齿缺口 / 顶部 1–3 根刺 / 重心偏前 / 高宽比 ≈ 1.0
 * §5.6.4 T3 格：人+狼双头剪影，狼头前伸，人后仰
 * §1.3 唯一失调：狼吻异常长（远超真实狼比例，读作"暴走"）
 * §5.3 p2 兵种剪影：前倾 + 宽肩、矮胖、装备不合身
 * 配色断言 8 预检：狼身用 stone（灰）与红衣 p2a2 色相差 >150°；骑手红衣与 p2clash(青) 色相差 ~150°；
 *   灰狼 stone2(#a9a093) 与红衣 p2a2(#e04a34) 不同色系，安全。绝不用 p2w2(陶土) 贴红衣（ΔL*≈3 失败）。
 * ========================================================================== */

function drawWolfrider(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawWolfriderMap(pb);
  else if (kind === 'idle') drawWolfriderCombat(pb, false);
  else drawWolfriderCombat(pb, true);
}

/** 48×44 冒险地图帧：狼爪 42，骑手头顶 ~15，剪影高 ~27（T3 ≈78% → 坐骑使整体更高）。 */
function drawWolfriderMap(pb: PixBuf): void {
  // 狼身（灰 stone，与红衣区隔；陶土 p2w2 贴红衣会失败，故用 stone）
  pb.ellipse(17, 38, 12, 6, C.stone2);
  pb.ellipse(17, 42, 12, 3, C.stone0); // 腹暗面（同族 stone）
  // 狼头（前伸，左）+ 异常长吻（唯一失调）
  pb.ellipse(6, 35, 4, 4, C.stone2);
  pb.rect(1, 34, 6, 3, C.stone2); // 长吻伸到 x=1
  pb.rect(1, 34, 2, 2, C.stone0); // 鼻头
  pb.tri([7, 31], [10, 31], [8, 28], C.stone0); // 耳
  pb.set(5, 34, C.ink0);
  pb.set(6, 34, C.ink0); // 眼
  // 尾（右，暗红尖）
  pb.rect(28, 33, 4, 2, C.stone2);
  pb.rect(31, 32, 2, 2, C.p2a0);
  // 四腿（细）
  pb.rect(9, 41, 2, 3, C.stone0);
  pb.rect(15, 42, 2, 3, C.stone0);
  pb.rect(20, 42, 2, 3, C.stone0);
  pb.rect(25, 41, 2, 3, C.stone0);
  aoContact(pb, 9, 26, 44);
  // 骑手（人+狼双头之上头）：红衣、后仰
  pb.poly([[14, 35], [22, 30], [23, 39], [15, 42]], C.p2a2); // 后仰躯干
  pb.line(14, 35, 22, 30, C.p2a0);
  pb.hline(15, 23, 39, C.p2a0); // 腰带/下摆
  // 头（后仰，偏右上）
  pb.ellipse(20, 26, 4, 4, C.skin2);
  pb.ellipse(20, 24, 5, 2, C.wood0);
  brokenNails(pb, 17, 18, 22, 19, 6); // 头顶刺
  pb.line(16, 25, 18, 26, C.ink0); // 凶眉
  pb.line(25, 25, 23, 26, C.ink0);
  face(pb, 17, 22, 27, 29, 4, true);
  // 手臂拽缰绳到狼头（臂上撞色破布，p2 唯一 clash 使用点）
  pb.hline(15, 18, 33, C.p2clash);
  thickLine(pb, 17, 33, 8, 35, C.p2a0, C.p2a0);
  pb.rect(15, 37, 5, 4, C.p2a0); // 袖（加宽到 x19 罩住手右侧；袖↔红衣 p2a0↔p2a2 同色系 ΔL*≈16 ≥12）
  pb.rect(16, 38, 3, 2, C.skin0); // 手（坐袖内，skin0↔p2a0 ΔL*≈22 ≥12，绝不碰红衣）
}

/** 60×56 战斗帧：狼爪 54，骑手头顶 ~19，剪影高 ~35（T3 ≈78% → 坐骑高）。 */
function drawWolfriderCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    // 狼身（灰 stone）
    pb.ellipse(24, 48, 16, 8, C.stone2);
    pb.ellipse(24, 53, 16, 4, C.stone0);
    // 狼头（前伸，左）+ 长吻
    pb.ellipse(7, 44, 5, 5, C.stone2);
    pb.rect(1, 43, 7, 4, C.stone2); // 长吻到 x=1
    pb.rect(1, 43, 2, 3, C.stone0);
    pb.tri([8, 39], [12, 39], [10, 35], C.stone0); // 耳
    pb.set(6, 43, C.ink0);
    pb.set(7, 43, C.ink0);
    // 尾
    pb.rect(39, 41, 5, 3, C.stone2);
    pb.rect(43, 40, 2, 2, C.p2a0);
    // 四腿
    pb.rect(11, 53, 3, 3, C.stone0);
    pb.rect(19, 54, 3, 3, C.stone0);
    pb.rect(28, 54, 3, 3, C.stone0);
    pb.rect(36, 53, 3, 3, C.stone0);
    aoContact(pb, 11, 38, 56);
    // 骑手：红衣、后仰
    pb.poly([[18, 45], [28, 38], [30, 50], [19, 53]], C.p2a2);
    pb.line(18, 45, 28, 38, C.p2a0);
    pb.hline(19, 30, 52, C.p2a0);
    // 头（后仰）
    pb.ellipse(26, 34, 5, 4.5, C.skin2);
    pb.ellipse(26, 31, 6, 2.5, C.wood0);
    brokenNails(pb, 22, 24, 28, 25, 7);
    pb.line(21, 33, 24, 34, C.ink0);
    pb.line(31, 33, 28, 34, C.ink0);
    face(pb, 22, 28, 34, 37, 5, true);
    // 手臂拽缰绳 + 臂上撞色
    pb.hline(20, 23, 45, C.p2clash);
    thickLine(pb, 23, 41, 9, 44, C.p2a0, C.p2a0);
    pb.rect(21, 46, 5, 4, C.p2a0); // 袖（加宽到 x25 罩住手右侧；袖↔红衣 ΔL*≈16 ≥12）
    pb.rect(22, 47, 3, 2, C.skin0); // 手（坐袖内，skin0↔p2a0 ΔL*≈22 ≥12）
    return;
  }
  // 攻击帧：0.85× 高（35→30）狼前扑、骑手扬斧下劈
  pb.ellipse(24, 48, 16, 8, C.stone2);
  pb.ellipse(24, 53, 16, 4, C.stone0);
  pb.ellipse(7, 44, 5, 5, C.stone2);
  pb.rect(1, 43, 7, 4, C.stone2);
  pb.rect(1, 43, 2, 3, C.stone0);
  pb.tri([8, 39], [12, 39], [10, 35], C.stone0);
  pb.set(6, 43, C.ink0);
  pb.set(7, 43, C.ink0);
  pb.rect(39, 41, 5, 3, C.stone2);
  pb.rect(43, 40, 2, 2, C.p2a0);
  pb.rect(11, 52, 3, 4, C.stone0);
  pb.rect(19, 53, 3, 4, C.stone0);
  pb.rect(28, 53, 3, 4, C.stone0);
  pb.rect(36, 51, 3, 4, C.stone0);
  aoContact(pb, 11, 38, 56);
  pb.poly([[18, 46], [28, 40], [30, 51], [19, 53]], C.p2a2);
  pb.line(18, 46, 28, 40, C.p2a0);
  pb.hline(19, 30, 52, C.p2a0);
  pb.ellipse(26, 35, 5, 4, C.skin2);
  pb.ellipse(26, 32, 6, 2, C.wood0);
  brokenNails(pb, 22, 26, 28, 27, 5);
  pb.line(21, 34, 24, 35, C.ink0);
  pb.line(31, 34, 28, 35, C.ink0);
  face(pb, 22, 28, 34, 37, 5, true);
  pb.hline(20, 23, 45, C.p2clash);
  thickLine(pb, 23, 42, 10, 45, C.p2a0, C.p2a0);
  pb.rect(21, 46, 5, 4, C.p2a0); // 袖（加宽到 x25 罩住手右侧；袖↔红衣 ΔL*≈16 ≥12）
  pb.rect(22, 47, 3, 2, C.skin0); // 手（坐袖内，skin0↔p2a0 ΔL*≈22 ≥12）
  // 飞出的斧（金属，刃带缺口；避免木↔红 同色系失败）
  chamfer(pb, 34, 28, 6, 12, C.metal4, 1);
  pb.rect(34, 28, 6, 12, C.metal2);
  pb.frame(34, 28, 6, 12, C.metal4);
  pb.tri([39, 33], [40, 35], [39, 36], C.ink1); // 缺口
}

/* ==========================================================================
 * 15. p2 赤焰 T4 · 火油狂徒
 *
 * §5.6.3 形状家族：楔形前倾 / 锯齿缺口 / 顶部 1–3 根刺 / 重心偏前 / 高宽比 ≈ 1.0
 * §5.6.4 T4 格：横抱火油桶，桶盖锯齿，身后拖火舌
 * §1.3 唯一失调：火油桶比躯干还大（横抱，占剪影 ≥40%）
 * §5.3 p2 兵种剪影：前倾 + 宽肩、矮胖、装备不合身
 * 配色断言 8 预检：桶身 metal4(#dfe6f0) 贴红衣 p2a2(#e04a34) 色相差 ~170°；桶箍 metal2(#aab6c2)
 *   贴红衣色相差 ~8° 但 ΔL*≈15 ≥12；火舌 p2emissive(#ffd06a) 贴红衣 ΔL*≈23 ≥8；桶盖缺口用 ink1 而非 metal0
 *   （metal0 贴红衣色差仅 ~7 失败）。绝不用木桶（木↔红近明度近色相失败）。
 * ========================================================================== */

function drawFirebrand(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawFirebrandMap(pb);
  else if (kind === 'idle') drawFirebrandCombat(pb, false);
  else drawFirebrandCombat(pb, true);
}

/** 48×44 冒险地图帧：脚底 42，桶+火舌横向铺到 x=33，剪影宽 ~30、高 ~27（T4，横阔）。
 *  高宽比 ~0.9（明显宽于 T2 投斧蛮子 1.36，避免同族 T4↔T2 撞车）。 */
function drawFirebrandMap(pb: PixBuf): void {
  // 脚（贴地，基线 43）
  pb.rect(12, 39, 7, 3, C.canv2);
  pb.rect(20, 39, 7, 3, C.canv2);
  aoContact(pb, 12, 26, 42);
  // 躯干：红衣（赤焰标识），桶在身前（下）
  pb.rect(12, 20, 11, 14, C.p2a2);            // x12-22 y20-33 红胸/肩
  // 火油桶（横抱，金属，大 = 唯一比例失调），盖住红衣下半
  chamfer(pb, 4, 26, 22, 13, C.metal4, 1);   // x4-26 y26-39
  pb.rect(5, 27, 20, 11, C.metal2);
  pb.frame(4, 26, 22, 13, C.metal4);
  pb.vline(12, 27, 38, C.metal2);
  pb.vline(19, 27, 38, C.metal2);
  // 红腿（接桶与脚；p2a2↔metal2 / p2a2↔canv2 均安全，避免 metal2↔canv2 失败）
  pb.rect(12, 37, 15, 3, C.p2a2);            // x12-26 y37-39
  // 撞色破布（p2clash 在红衣上，桶上方 y26 之上可见；p2clash↔p2a2 ΔL*≈17）
  pb.rect(14, 22, 5, 2, C.p2clash);
  // 桶盖锯齿 ink1（桶盖上沿 y26，头在 y12-19，远隔 → wood0 不碰 ink1）
  pb.tri([6, 26], [7, 24], [8, 26], C.ink1);
  pb.tri([13, 26], [14, 24], [15, 26], C.ink1);
  pb.tri([21, 26], [22, 24], [23, 26], C.ink1);
  // 手臂横抱（p2a0 袖罩住手，袖↔桶安全；手只在袖内不碰 metal）
  pb.rect(10, 28, 5, 8, C.p2a0);              // x10-14 y28-35 左袖
  pb.rect(11, 32, 3, 2, C.skin0);             // 手在袖内
  pb.rect(21, 28, 5, 8, C.p2a0);              // x21-25 y28-35 右袖
  pb.rect(23, 32, 3, 2, C.skin0);
  // 头（红衣之上，skin2/wood0 不贴 metal/ink1）
  pb.ellipse(17, 16, 5, 3.5, C.skin2);        // x12-22 y12.5-19.5
  pb.ellipse(17, 14, 6, 2, C.wood0);          // 发 x11-23 y12-16
  brokenNails(pb, 13, 9, 19, 10, 6);
  pb.line(13, 15, 15, 16, C.ink0);
  pb.line(21, 15, 19, 16, C.ink0);
  face(pb, 14, 20, 17, 19, 4, true);
  // 身后拖火舌（p2emissive，悬空在桶右，与 metal4 隔 ≥1px）
  pb.ellipse(30, 30, 3, 2, C.p2emissive);     // x27-33 y28-32
  pb.set(33, 29, C.p2emissive);
  pb.set(34, 31, C.p2emissive);
  pb.set(32, 33, C.p2emissive);
}

/** 60×56 战斗帧：脚底 54，桶+火舌横向铺到 x=39，剪影宽 ~36、高 ~35（T4 ≈88%，横阔）。 */
function drawFirebrandCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    pb.rect(19, 50, 7, 4, C.canv2);
    pb.rect(27, 50, 8, 4, C.canv2);
    aoContact(pb, 19, 35, 54);
    // 红衣胸/肩
    pb.rect(17, 26, 15, 18, C.p2a2);           // x17-31 y26-43
    // 火油桶（横抱，金属，大）
    chamfer(pb, 6, 34, 30, 16, C.metal4, 1);   // x6-36 y34-49
    pb.rect(7, 35, 28, 14, C.metal2);
    pb.frame(6, 34, 30, 16, C.metal4);
    pb.vline(16, 35, 48, C.metal2);
    pb.vline(26, 35, 48, C.metal2);
    // 撞色破布（p2clash 在红衣上，桶上方可见）
    pb.rect(20, 28, 6, 2, C.p2clash);           // y28-29
    // 桶盖锯齿 ink1（桶盖上沿 y34，头在 y18-26 之上）
    pb.tri([9, 34], [10, 31], [11, 34], C.ink1);
    pb.tri([18, 34], [19, 31], [20, 34], C.ink1);
    pb.tri([27, 34], [28, 31], [29, 34], C.ink1);
    pb.tri([34, 34], [35, 31], [36, 34], C.ink1);
    // 手臂横抱（p2a0 袖，手在袖内不碰 metal）
    pb.rect(15, 37, 5, 9, C.p2a0);              // x15-19 y37-45 左袖
    pb.rect(16, 42, 3, 2, C.skin0);
    pb.rect(32, 37, 5, 9, C.p2a0);              // x32-36 y37-45 右袖
    pb.rect(33, 42, 3, 2, C.skin0);
    // 头（红衣之上）
    pb.ellipse(26, 22, 5, 4, C.skin2);          // x21-31 y18-26
    pb.ellipse(26, 19, 6, 2.5, C.wood0);
    brokenNails(pb, 22, 13, 28, 14, 7);
    pb.line(22, 21, 24, 22, C.ink0);
    pb.line(31, 21, 29, 22, C.ink0);
    face(pb, 22, 30, 23, 26, 5, true);
    // 身后拖火舌（悬空，桶右，与 metal4 隔 ≥1px）
    pb.ellipse(41, 38, 4, 3, C.p2emissive);     // x37-45 y35-41
    pb.set(44, 36, C.p2emissive);
    pb.set(44, 40, C.p2emissive);
    pb.set(42, 42, C.p2emissive);
    return;
  }
  // 攻击帧：桶甩向左前方，火舌喷大飞出（朝右，脱离桶）
  pb.rect(19, 50, 7, 4, C.canv2);
  pb.rect(27, 50, 8, 4, C.canv2);
  aoContact(pb, 19, 35, 54);
  pb.rect(17, 27, 15, 17, C.p2a2);             // 红衣 x17-31 y27-43
  // 桶甩向左前方
  chamfer(pb, 4, 35, 27, 15, C.metal4, 1);     // x4-31 y35-49
  pb.rect(5, 36, 25, 13, C.metal2);
  pb.frame(4, 35, 27, 15, C.metal4);
  pb.vline(14, 36, 48, C.metal2);
  pb.vline(23, 36, 48, C.metal2);
  // 撞色破布（p2clash 在红衣上，桶上方可见）
  pb.rect(20, 29, 6, 2, C.p2clash);            // y29-30
  // 桶盖锯齿 ink1（桶盖上沿 y35，头在 y19-27 之上）
  pb.tri([8, 35], [9, 32], [10, 35], C.ink1);
  pb.tri([16, 35], [17, 32], [18, 35], C.ink1);
  pb.tri([24, 35], [25, 32], [26, 35], C.ink1);
  // 手臂横抱（p2a0 袖，手在袖内不碰 metal）
  pb.rect(14, 38, 5, 9, C.p2a0);               // x14-18 y38-46 左袖
  pb.rect(15, 43, 3, 2, C.skin0);
  pb.rect(30, 38, 5, 9, C.p2a0);               // x30-34 y38-46 右袖
  pb.rect(31, 43, 3, 2, C.skin0);
  // 头
  pb.ellipse(27, 23, 5, 4, C.skin2);           // x22-32 y19-27
  pb.ellipse(27, 20, 6, 2.5, C.wood0);
  brokenNails(pb, 23, 14, 29, 15, 5);
  pb.line(23, 22, 25, 23, C.ink0);
  pb.line(32, 22, 30, 23, C.ink0);
  face(pb, 23, 31, 24, 27, 5, true);
  // 喷出的大火舌（悬空，朝右，不碰 metal）
  pb.ellipse(39, 38, 4, 3, C.p2emissive);      // x35-43 y35-41
  pb.set(43, 36, C.p2emissive);
  pb.set(43, 40, C.p2emissive);
  pb.set(41, 42, C.p2emissive);
}

/* ==========================================================================
 * 16. p3 翠林 T3 · 藤蔓卫士
 *
 * §5.6.3 形状家族：圆形有机 / 顶部 1 丛凸出枝叶
 * §5.6.4 T3 格：圆形藤甲覆盖躯干，无可见直角
 * §1.3 唯一失调：藤甲比躯干还大（圆形满铺胸，占剪影 ≥40%）
 * §5.4 p3 兵种剪影：圆形主轮廓 + 顶部不对称凸起
 * 配色断言 8 预检（翠林同族相邻最易翻车）：
 *   - leaf2（暗藤）↔ p3a2（绿身）色相差 ~40°、ΔL*≈18 ≥8 → 安全（藤纹直接铺绿身）
 *   - leaf4（亮藤）↔ p3a2 同绿系 ΔL*≈2 → 禁用；leaf4 只用在 wood0 头丛 / 悬空
 *   - skin2（脸）↔ p3a2 同色系 ΔL*≈0 → 必须用 p3w0 颈/前襟隔开（skin↔p3w0 ΔL*≈24）
 *   - 藤结用 p3a0（暗绿），p3a0↔leaf2 / p3a0↔p3a2 均安全
 *   - 藤甲 leaf2 不得落草（草亦 leaf2，同族 step=0 触发断言 2）→ 用 p3w0 基座压在中间
 * ========================================================================== */

function drawVineguard(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawVineguardMap(pb);
  else if (kind === 'idle') drawVineguardCombat(pb, false);
  else drawVineguardCombat(pb, true);
}

/** 48×44 冒险地图帧：草 42，头顶叶 ~15，剪影高 ~30（圆形）。 */
function drawVineguardMap(pb: PixBuf): void {
  grassBase(pb, 6, 24, 42);
  pb.ellipse(15, 36, 11, 9, C.p3a2);            // 圆身（绿）
  // 藤甲（圆形满铺胸，leaf2 藤纹；leaf2↔p3a2 ΔL*≈18 安全）
  pb.ellipse(15, 33, 9, 6, C.leaf2);            // 藤甲圆板
  pb.ellipse(15, 33, 8, 2, C.p3a2);             // 横向藤缝（透绿底）
  pb.ellipse(15, 33, 2, 6, C.p3a2);             // 纵向藤缝
  pb.set(9, 31, C.p3w0); pb.set(21, 31, C.p3w0); // 藤结（p3w0，leaf2/p3a2 均安全）
  pb.set(15, 28, C.p3w0); pb.set(15, 38, C.p3w0);
  // 底暗褐基座（草叶压住：leaf2↔p3w0 ΔL*≈11；且隔在藤甲与草之间避同族 step 失败）
  pb.ellipse(15, 42, 11, 4, C.p3w0);
  // 颈/前襟：隔开脸与绿身（skin↔p3w0 ΔL*≈24）
  pb.ellipse(15, 29, 7, 4, C.p3w0);
  // 头
  pb.ellipse(15, 24, 4.5, 4, C.skin2);
  leafTuft(pb, 15, 20);
  face(pb, 13, 17, 26, 28, 3, false);
}

/** 60×56 战斗帧：草 54，头顶叶 ~26，剪影高 ~34（圆形）。 */
function drawVineguardCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    grassBase(pb, 10, 32, 54);
    pb.ellipse(22, 46, 13, 11, C.p3a2);          // 圆身
    pb.ellipse(22, 43, 11, 8, C.leaf2);          // 藤甲圆板
    pb.ellipse(22, 43, 10, 3, C.p3a2);          // 横藤缝
    pb.ellipse(22, 43, 3, 8, C.p3a2);           // 纵藤缝
    pb.set(15, 40, C.p3w0); pb.set(29, 40, C.p3w0);
    pb.set(22, 36, C.p3w0); pb.set(22, 50, C.p3w0);
    pb.ellipse(22, 53, 13, 5, C.p3w0);           // 底基座（压在藤甲与草之间）
    pb.ellipse(22, 38, 8, 5, C.p3w0);            // 颈
    pb.ellipse(22, 33, 5, 4.5, C.skin2);         // 头
    leafTuft(pb, 22, 29);
    face(pb, 19, 24, 34, 37, 3, false);
    // 手臂（p3a0 袖，手埋袖内；袖底在基座之上，不碰 p3w0）
    pb.rect(13, 40, 4, 8, C.p3w0);
    pb.rect(14, 43, 2, 2, C.skin2);
    pb.rect(29, 40, 4, 8, C.p3w0);
    pb.rect(30, 43, 2, 2, C.skin2);
    return;
  }
  // 攻击帧：挥藤鞭（p3a0 藤鞭甩出，悬空右侧，不碰绿身）
  grassBase(pb, 10, 32, 54);
  pb.ellipse(22, 46, 13, 11, C.p3a2);
  pb.ellipse(22, 43, 11, 8, C.leaf2);
  pb.ellipse(22, 43, 10, 3, C.p3a2);
  pb.ellipse(22, 43, 3, 8, C.p3a2);
  pb.set(15, 40, C.p3w0); pb.set(29, 40, C.p3w0);
  pb.set(22, 36, C.p3w0); pb.set(22, 50, C.p3w0);
  pb.ellipse(22, 53, 13, 5, C.p3w0);
  pb.ellipse(22, 38, 8, 5, C.p3w0);
  pb.ellipse(22, 33, 5, 4.5, C.skin2);
  leafTuft(pb, 22, 29);
  face(pb, 19, 24, 34, 37, 3, false);
  pb.rect(13, 40, 4, 8, C.p3w0);
  pb.rect(14, 43, 2, 2, C.skin2);
  pb.rect(29, 40, 4, 8, C.p3w0);
  pb.rect(30, 43, 2, 2, C.skin2);
  pb.line(34, 44, 40, 38, C.p3w0);              // 藤鞭
  pb.line(40, 38, 42, 33, C.p3w0);
  pb.set(42, 31, C.leaf4);                       // 鞭梢叶（悬空，不碰绿身）
}

/* ==========================================================================
 * 17. p3 翠林 T4 · 树人大叔
 *
 * §5.6.3 形状家族：圆形有机 / 顶部 2 丛凸出树冠
 * §5.6.4 T4 格：最宽的圆（≤1.1），树干圆柱，头顶 2 丛树冠
 * §1.3 唯一失调：树干比寻常兵种粗（圆柱占剪影 ≥35%）+ 头顶 2 丛树冠
 * §5.4 p3 兵种剪影：最宽圆轮廓 + 顶部双凸起
 * 配色断言 8 预检：
 *   - 树冠 leaf4↔leaf2 同叶系 ΔL*≈20 ≥12 → 安全（双丛暗部）
 *   - 树冠 leaf4↔p3w0（树皮）ΔL*≈31 ≥8 → 安全（冠坐树干顶）
 *   - 脸 skin2↔p3w0（树皮）ΔL*≈24 → 安全
 *   - 树皮纹 p3w2↔p3w0 同橄榄系 ΔL*≈18 ≥12 → 安全；但 p3w2 止於草上方，避 p3w2↔leaf2(草) ΔL*≈7
 *   - leaf4 不碰 skin2（同绿系 ΔL*≈2）→ 树冠与脸留 ≥1px 空气
 * ========================================================================== */

function drawTreant(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawTreantMap(pb);
  else if (kind === 'idle') drawTreantCombat(pb, false);
  else drawTreantCombat(pb, true);
}

/** 48×44 冒险地图帧：草 42，树冠顶 ~16，剪影高 ~26、宽 ~30（最宽圆）。 */
function drawTreantMap(pb: PixBuf): void {
  grassBase(pb, 6, 24, 42);
  // 树干（圆柱，p3w0 树皮，圆角——有机物免切角）
  pb.ellipse(15, 38, 8, 9, C.p3w0);             // 树干底圆
  pb.rect(8, 30, 14, 12, C.p3w0);              // 树干身
  pb.ellipse(15, 30, 7, 4, C.p3w0);            // 树干顶圆角（无直角）
  // 树皮纹（p3w2 暗纹，止於草上方）
  pb.vline(12, 32, 38, C.p3w2);
  pb.vline(18, 32, 38, C.p3w2);
  // 脸（皮，嵌树干；skin↔p3w0 ΔL*≈24）
  pb.ellipse(15, 35, 5, 5, C.skin2);
  face(pb, 12, 18, 36, 38, 3, false);
  // 2 丛树冠（头顶，leaf4 + leaf2，最宽圆）
  pb.ellipse(7, 22, 7, 6, C.leaf4);             // 左冠
  pb.ellipse(23, 22, 7, 6, C.leaf4);            // 右冠
  pb.ellipse(7, 22, 7, 5, C.leaf2);             // 左冠暗部
  pb.ellipse(23, 22, 7, 5, C.leaf2);            // 右冠暗部
  pb.set(15, 18, C.leaf4);
  pb.set(15, 16, C.leaf2);
}

/** 60×56 战斗帧：草 54，树冠顶 ~22，剪影高 ~32、宽 ~40（最宽圆）。 */
function drawTreantCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    grassBase(pb, 10, 32, 54);
    // 树干
    pb.ellipse(22, 49, 10, 12, C.p3w0);
    pb.rect(13, 38, 18, 16, C.p3w0);
    pb.ellipse(22, 38, 9, 5, C.p3w0);
    // 树皮纹
    pb.vline(18, 42, 50, C.p3w2);
    pb.vline(26, 42, 50, C.p3w2);
    // 脸
    pb.ellipse(22, 45, 6, 6, C.skin2);
    face(pb, 18, 24, 46, 48, 3, false);
    // 2 丛树冠
    pb.ellipse(11, 30, 9, 8, C.leaf4);
    pb.ellipse(33, 30, 9, 8, C.leaf4);
    pb.ellipse(11, 30, 9, 7, C.leaf2);
    pb.ellipse(33, 30, 9, 7, C.leaf2);
    pb.set(22, 24, C.leaf4);
    pb.set(22, 21, C.leaf2);
    return;
  }
  // 攻击帧：根须拍地（p3w0，悬空左下，不碰草）
  grassBase(pb, 10, 32, 54);
  pb.ellipse(22, 49, 10, 12, C.p3w0);
  pb.rect(13, 38, 18, 16, C.p3w0);
  pb.ellipse(22, 38, 9, 5, C.p3w0);
  pb.vline(18, 42, 50, C.p3w2);
  pb.vline(26, 42, 50, C.p3w2);
  pb.ellipse(22, 45, 6, 6, C.skin2);
  face(pb, 18, 24, 46, 48, 3, false);
  pb.ellipse(11, 30, 9, 8, C.leaf4);
  pb.ellipse(33, 30, 9, 8, C.leaf4);
  pb.ellipse(11, 30, 9, 7, C.leaf2);
  pb.ellipse(33, 30, 9, 7, C.leaf2);
  pb.set(22, 24, C.leaf4);
  pb.set(22, 21, C.leaf2);
  pb.line(13, 52, 9, 50, C.p3w0);
  pb.line(9, 50, 7, 47, C.p3w0);
}

/* ==========================================================================
 * 18. p4 紫晶 T3 · 蹦跳魔偶
 *
 * §5.6.3 形状家族：菱形收尖 / 直线硬几何 / 菱形尖端 / 不落地（底留空气 + 悬浮物）
 * §5.6.4 T3 格：菱形木偶，四肢细线，双脚离地
 * §1.3 唯一失调：瘦长菱形身躯 + 细棍四肢（违反"落地"，脚部悬空蹦跳）
 * §5.5 p4 兵种剪影：菱形晶体 + 发光眼 + 悬浮宝石；四肢用 1px 细线（木偶感）
 * 配色断言 8 预检：
 *   - 身躯 p4a2↔p4a0（左暗面）同紫系 ΔL*≈21 ≥12 → 安全
 *   - 细肢用 p4a0（与暗面同色，避开 p4w0↔p4a0 ΔL*≈10.7 撞车）→ 细肢只贴 p4a2 主面 ΔL*≈21 ≥12
 *   - 悬浮宝石 p4emissive↔p4a4（芯）ΔL*≈18 ≥8 → 安全；宝石脱离本体（第二轮廓环）
 * ========================================================================== */

function drawHopgolem(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawHopgolemMap(pb);
  else if (kind === 'idle') drawHopgolemCombat(pb, false);
  else drawHopgolemCombat(pb, true);
}

/** 48×44 冒险地图帧：菱形身躯 y6-40（瘦长），细肢收拢，脚底 y43（画布 44 留 1px 空气）。 */
function drawHopgolemMap(pb: PixBuf): void {
  // 菱形身躯（p4 母题）：上尖 y6、最宽 y22(x8-24)、下尖 y40（脚离地）
  pb.poly([[16, 6], [24, 22], [16, 40], [8, 22]], C.p4a2);
  pb.poly([[16, 6], [16, 40], [8, 22]], C.p4a0); // 左暗面（细肢同色，免撞车）
  // 发光眼
  glowEye(pb, 13, 19);
  glowEye(pb, 19, 19);
  // 细肢（1px 木偶线，p4a0 同暗面色）：双臂微伸、双腿下垂不触底
  pb.line(8, 21, 5, 17, C.p4a0); // 左臂
  pb.line(24, 21, 27, 17, C.p4a0); // 右臂
  pb.line(14, 38, 11, 43, C.p4a0); // 左腿（脚 y43，悬空）
  pb.line(18, 38, 21, 43, C.p4a0); // 右腿
  pb.set(11, 43, C.p4a0); pb.set(21, 43, C.p4a0); // 脚（离画布底 1px）
  // ≥1 块悬浮物（emissive 菱形，脱离本体 → 第二轮廓环）
  pb.poly([[28, 30], [31, 33], [28, 36], [25, 33]], C.p4emissive);
  pb.set(28, 33, C.p4a4);
}

/** 60×56 战斗帧：菱形身躯 y10-50（瘦长），脚底 y54（画布 56 留 2px 空气）。 */
function drawHopgolemCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    pb.poly([[22, 10], [34, 30], [22, 50], [10, 30]], C.p4a2);
    pb.poly([[22, 10], [22, 50], [10, 30]], C.p4a0);
    glowEye(pb, 18, 27);
    glowEye(pb, 26, 27);
    pb.line(10, 29, 8, 25, C.p4a0);
    pb.line(34, 29, 36, 25, C.p4a0);
    pb.line(19, 48, 15, 54, C.p4a0);
    pb.line(25, 48, 29, 54, C.p4a0);
    pb.set(15, 54, C.p4a0); pb.set(29, 54, C.p4a0);
    pb.poly([[40, 36], [43, 39], [40, 42], [37, 39]], C.p4emissive);
    pb.set(40, 39, C.p4a4);
    return;
  }
  // 攻击帧：双臂上举（蹦跳踢腿），悬浮宝石甩出更大
  pb.poly([[22, 10], [34, 30], [22, 50], [10, 30]], C.p4a2);
  pb.poly([[22, 10], [22, 50], [10, 30]], C.p4a0);
  glowEye(pb, 18, 27);
  glowEye(pb, 26, 27);
  pb.line(10, 29, 8, 19, C.p4a0); // 左臂上举
  pb.line(34, 29, 36, 19, C.p4a0); // 右臂上举
  pb.line(19, 48, 16, 53, C.p4a0); // 左腿收
  pb.line(25, 48, 29, 54, C.p4a0); // 右腿伸
  pb.set(16, 53, C.p4a0); pb.set(29, 54, C.p4a0);
  pb.poly([[40, 28], [43, 31], [40, 34], [37, 31]], C.p4emissive); // 宝石飞出
  pb.set(40, 31, C.p4a4);
}

/* ==========================================================================
 * 19. p4 紫晶 T4 · 亡灵图书管理员
 *
 * §5.6.3 形状家族：菱形收尖 / 直线硬几何 / 不落地（底留空气 + 悬浮书）
 * §5.6.4 T4 格：高耸书堆突破肩线，远程姿态，书浮在手上
 * §1.3 唯一失调：书堆比人高（违反"人头最高"直觉，书塔冲破肩线）
 * §5.5 p4 兵种剪影：顶沉（书塔宽于下身）、对称书脊、悬浮手书 + 发光眼
 * ⚠️ 同族 T4↔T2 分离（team-lead 警告）：fireapprentice(T2) 是上细下宽锥袍、不对称（杖+火）、底重；
 *   本 T4 是顶沉书塔（水平书脊横纹）、近全对称、悬浮手书——剪影家族（书 vs 锥）彻底不同。
 * 配色断言 8 预检：
 *   - 书脊 p4a2↔p4a4（相邻书封/书页）同紫系 ΔL*≈22 ≥12 → 安全
 *   - 书页 p4a4↔p4a0（书脊暗线）ΔL*≈43 → 安全
 *   - 长袍 p4w2↔p4a2（书底压袍）ΔL*≈18 ≥8 → 安全
 *   - 悬浮手书 p4emissive↔p4a4（芯）ΔL*≈18 ≥8 → 安全
 * ========================================================================== */

function drawLibrarian(pb: PixBuf, kind: 'map' | 'idle' | 'atk'): void {
  if (kind === 'map') drawLibrarianMap(pb);
  else if (kind === 'idle') drawLibrarianCombat(pb, false);
  else drawLibrarianCombat(pb, true);
}

/** 48×44 冒险地图帧：书塔 y8-23 突破肩线，长袍 y28-41，脚底 y41（留 3px 空气）。 */
function drawLibrarianMap(pb: PixBuf): void {
  // 长袍（顶沉书塔之下的 slender 身躯，p4w2）
  pb.poly([[16, 28], [20, 28], [22, 41], [10, 41]], C.p4w2);
  pb.poly([[16, 28], [16, 41], [10, 41]], C.p4w0); // 左暗面
  // 头（p4w0，发光眼——亡灵）
  pb.ellipse(16, 25, 3.5, 3, C.p4w0);
  glowEye(pb, 14, 25);
  glowEye(pb, 18, 25);
  // 高耸书堆（突破肩线 y28，书塔顶到 y8）：4 本横书，封面/书页交替
  pb.rect(9, 20, 14, 3, C.p4a2); // 书1 封面
  pb.rect(10, 21, 12, 1, C.p4a4); // 书页
  pb.rect(9, 16, 14, 3, C.p4a4); // 书2 书页亮
  pb.rect(10, 17, 12, 1, C.p4a0); // 书脊暗线
  pb.rect(10, 12, 13, 3, C.p4a2); // 书3 封面
  pb.rect(11, 13, 11, 1, C.p4a4);
  pb.rect(10, 8, 12, 3, C.p4a4); // 书4 顶
  pb.rect(11, 9, 10, 1, C.p4a0);
  // 远程姿态：悬浮手书（脱离本体，右侧手前伸）
  pb.rect(25, 30, 5, 4, C.p4a2); // 手书封面
  pb.rect(26, 31, 3, 1, C.p4a4); // 书页
  pb.poly([[31, 28], [33, 30], [31, 32], [29, 30]], C.p4emissive); // 书脊发光菱形
}

/** 60×56 战斗帧：书塔 y12-31，长袍 y36-52，脚底 y52（留 4px 空气）。 */
function drawLibrarianCombat(pb: PixBuf, atk: boolean): void {
  if (!atk) {
    pb.poly([[22, 36], [28, 36], [31, 52], [13, 52]], C.p4w2);
    pb.poly([[22, 36], [22, 52], [13, 52]], C.p4w0);
    pb.ellipse(22, 32, 4.5, 4, C.p4w0);
    glowEye(pb, 19, 32);
    glowEye(pb, 25, 32);
    // 书塔（顶到 y12）
    pb.rect(13, 28, 18, 4, C.p4a2);
    pb.rect(14, 29, 16, 1, C.p4a4);
    pb.rect(13, 23, 18, 4, C.p4a4);
    pb.rect(14, 24, 16, 1, C.p4a0);
    pb.rect(14, 18, 17, 4, C.p4a2);
    pb.rect(15, 19, 15, 1, C.p4a4);
    pb.rect(14, 13, 16, 4, C.p4a4);
    pb.rect(15, 14, 14, 1, C.p4a0);
    // 悬浮手书（右侧前伸）
    pb.rect(33, 40, 7, 5, C.p4a2);
    pb.rect(34, 41, 5, 1, C.p4a4);
    pb.poly([[41, 38], [43, 41], [41, 44], [38, 41]], C.p4emissive);
    return;
  }
  // 攻击帧：手书前抛（更大，飞向右侧），书塔微倾
  pb.poly([[22, 36], [28, 36], [31, 52], [13, 52]], C.p4w2);
  pb.poly([[22, 36], [22, 52], [13, 52]], C.p4w0);
  pb.ellipse(22, 32, 4.5, 4, C.p4w0);
  glowEye(pb, 19, 32);
  glowEye(pb, 25, 32);
  pb.rect(13, 28, 18, 4, C.p4a2);
  pb.rect(14, 29, 16, 1, C.p4a4);
  pb.rect(13, 23, 18, 4, C.p4a4);
  pb.rect(14, 24, 16, 1, C.p4a0);
  pb.rect(14, 18, 17, 4, C.p4a2);
  pb.rect(15, 19, 15, 1, C.p4a4);
  pb.rect(14, 13, 16, 4, C.p4a4);
  pb.rect(15, 14, 14, 1, C.p4a0);
  // 抛出的手书（更大，脱离本体）
  pb.rect(33, 30, 8, 6, C.p4a2);
  pb.rect(34, 31, 6, 1, C.p4a4);
  pb.poly([[41, 28], [43, 31], [41, 34], [38, 31]], C.p4emissive);
  pb.set(41, 31, C.p4a4);
}
