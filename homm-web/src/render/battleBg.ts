/**
 * 战场地形背景（§11.1）。**纯数据 + 纯函数，不碰 DOM** —— 判据（两两色相差 / 明度差）
 * 可以直接在 node 里跑，不用起 Chrome。
 *
 * 三条硬约束（§11.1 原文，实现时按这个顺序取舍）：
 * ① **不压格**：剪影只画在战场矩形外的外边距里（`PAD` 之内、格子之外）；
 * ② **单位优先**：地砖色必须让单位剪影读得出来，雪原套最容易把白色单位吞掉，
 *    靠 `cbase_*` 底盘保底；
 * ③ **同一 seed**：六边形 / 逐像素噪声 / 格缝由 `hash2(variant, …)` 决定，五套共用；
 *    地纹（草簇 / 车辙 / 冰裂 / 水洼 / 石板缝）按套不同，见 `combatAtlas.groundMarks()`。
 *    ⇒ "同一场战斗在 5 套下只差配色"这句话**只对底色与格缝成立**，地纹是刻意的例外
 *    （§11.1 表第 4 列本来就逐套列了不同的斑点）—— 与规格标题「只换调色板」的冲突
 *    记在 `production/s4f-battle-bg-2026-11-12.md`。
 *
 * ⚠️ 前景色（`fore`）必须**同时**与 `outer`/`rim` 拉开距离：前景画在场地内的地面上，
 * 而画面最外圈是 `outer`，两者若是同一个色阶，"前景有没有越过内缩线"这条判据
 * 就会把**画布边缘**读成前景（首轮实测 dirt/siege 各误报 30 px）。
 *
 * ⚠️ 与规格的一处**有意偏差**：§11.1 写「远景剪影带 高 12 / 前景 高 8」，
 * 而画布外边距只有 `PAD = 6`（`BASE_W/H = FIELD + PAD*2`，E1 缩格后定的）。
 * 把 PAD 抬到 12 会改掉 `BASE_W/H`（482×310 → 494×322）与 `fit()` 的缩放，
 * 所有战斗截图基线和 `probe:battle` 的坐标换算全部作废 —— 代价远大于收益。
 * 所以剪影按**可用外边距**画（6px，放大 2 倍 = 12 设备像素），
 * 硬约束①（不压格）优先于规格里的绝对像素数。
 */
import type { TerrainKind } from '../core/types.js';
import { hueOf, lstar, shade } from './pixel.js';

export type BattleBg = 'grass' | 'dirt' | 'snow' | 'swamp' | 'siege';

export interface BattleBgSpec {
  id: BattleBg;
  name: string;
  /** 地砖主色。**判据量的是它**：五套两两 色相差 ≥40° 或 ΔL* ≥15。 */
  base: string;
  /** 砖缝墨色（地砖内侧那圈暗边）。 */
  ink: string;
  /** 画布最外圈（战场之外的土地）。 */
  outer: string;
  /** 战场外一圈的近地色。 */
  rim: string;
  /** 远景剪影带色。 */
  far: string;
  /** 前景剪影色。 */
  fore: string;
}

/**
 * 五套配色。**主色的取值不是随手调的**：初版照抄规格字面值
 * （grass `#4c6b34` / dirt `#8a6a44` / snow `#cfdbe6` / swamp `#4a4a3c` / siege `#5a4a3a`）
 * 时有 **3 对不合格**：
 *
 * | 对 | 色相差 | ΔL* | 结果 |
 * |---|---|---|---|
 * | grass ↔ swamp | 34° | 10.6 | ✗ 两个绿 |
 * | dirt ↔ siege | 3° | 14.5 | ✗ 两个土黄（差 0.5 就到线） |
 * | swamp ↔ siege | 30° | 1.6 | ✗ 两个暗橄榄 |
 *
 * 改法只动**明度与一个色相**，不动"这套是什么地形"的读法：
 * `dirt` 提亮（#8a6a44 → #94734b，土路本来就比战场土浅）、
 * `swamp` 压暗并偏绿（#4a4a3c → #333d1c，沼泽是**湿暗**的，不是干土）、
 * 其余三套保持规格值。改后 10 对全部通过，最紧的一对是
 * grass ↔ swamp（色相差 16°，靠 ΔL* 17.6 过）。
 */
export const BATTLE_BG_SPECS: Record<BattleBg, BattleBgSpec> = {
  grass: {
    id: 'grass',
    name: '草地',
    base: '#4c6b34',
    ink: '#16260f',
    outer: '#2a2417',
    rim: '#3b321f',
    far: '#16230e',
    fore: '#1d3316',
  },
  dirt: {
    id: 'dirt',
    name: '土路 / 沙地',
    base: '#94734b',
    ink: '#2b1f12',
    outer: '#3a2f20',
    rim: '#4c3d29',
    far: '#2e2114',
    fore: '#241a10',
  },
  snow: {
    id: 'snow',
    name: '雪原',
    base: '#cfdbe6',
    ink: '#6b7d92',
    outer: '#7f93a6',
    rim: '#93a6b8',
    far: '#6f8296',
    fore: '#5d7085',
  },
  swamp: {
    id: 'swamp',
    name: '沼泽 / 岩地',
    base: '#333d1c',
    ink: '#11150a',
    outer: '#1e2114',
    rim: '#272b1a',
    far: '#0c1007',
    fore: '#121809',
  },
  siege: {
    id: 'siege',
    name: '城战',
    base: '#5a4a3a',
    ink: '#1d1710',
    outer: '#2c241b',
    rim: '#3a2f24',
    far: '#231a12',
    fore: '#1a130c',
  },
};

export const BATTLE_BG_ORDER: readonly BattleBg[] = ['grass', 'dirt', 'snow', 'swamp', 'siege'];

/**
 * 两套背景的"可区分度"（§11.1 判据：**主色相角差 ≥40° 或 明度差 ≥15**）。
 *
 * 这个函数是**判据的唯一实现**：门 `tools/probes/battlebg.mjs` 直接调它，
 * 不在探针里重写一遍色差公式 —— 抄一份就会出现"实现改了、门按旧尺子量"。
 */
export function bgSeparation(a: BattleBg, b: BattleBg): { dh: number; dl: number; ok: boolean } {
  const ca = BATTLE_BG_SPECS[a].base;
  const cb = BATTLE_BG_SPECS[b].base;
  let dh = Math.abs(hueOf(ca) - hueOf(cb));
  if (dh > 180) dh = 360 - dh;
  const dl = Math.abs(lstar(ca) - lstar(cb));
  return { dh, dl, ok: dh >= 40 || dl >= 15 };
}

/** 5 级地砖色阶（暗 → 亮），与旧 `hexFloor` 的 ramp 同构。 */
export function floorRamp(bg: BattleBg): string[] {
  const { base } = BATTLE_BG_SPECS[bg];
  return [-0.26, -0.12, 0, 0.12, 0.24].map((t) => shade(base, t));
}

/**
 * 战斗发起格地形 + 城防 ⇒ 背景套。**攻城强制 `siege`**（§11.1：墙在战场上，
 * 地面就该是城里的石板，而不是发起格那片草）。
 *
 * `water` 理论上不能开战（`TERRAIN.water.passable = false`）；真要有水战
 * （船/渡口）按湿地处理，不留 `undefined` 分支。
 */
export function battleBgOf(terrain: TerrainKind | undefined, siegeLevel = 0): BattleBg {
  if (siegeLevel > 0) return 'siege';
  switch (terrain) {
    case 'dirt':
    case 'sand':
      return 'dirt';
    case 'snow':
      return 'snow';
    case 'swamp':
    case 'rock':
    case 'water':
      return 'swamp';
    default:
      return 'grass';
  }
}
