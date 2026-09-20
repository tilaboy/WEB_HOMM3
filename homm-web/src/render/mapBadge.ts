/**
 * 地图「队伍徽标」布局 —— 纯几何，**无 DOM / Canvas 依赖**。
 *
 * 规格：
 *   · `design/gdd/races.md §7 第 6 条 (a)` —— "英雄棋子旁显示队伍兵种"（信息价值）。
 *   · `design/ux/in-game-ia.md §13.4` —— 选侧 / 只落"无信息"格 / 落不下就不画。
 *   · `design/ux/in-game-ia.md §13.5` —— 探针 A / B′ / D 的判据。
 *
 * 为什么单独一个模块：§13.4 的布局算法**必须由渲染层与审计探针共用同一份实现**
 * （规格明写"这条要与 eng 实现同源，别两处各写一套"）⇒ `tools/mapbadgeaudit.mjs`
 * 与 `MapRenderer` 都从这里取。本模块不碰 DOM/Canvas，故可在 Node 里直接跑（探针需要）。
 *
 * 边界：本模块**只做布局几何与代表兵种选取**，不做 id 迁移（那是段 2 的活）。
 * 段 1 兼容：旧 5 键经 `LEGACY_UNIT_IDS` 归一到 canonical；野怪等非兵种 ⇒ 无帧、跳过。
 */
import { TILE } from './ortho.js';
import { LEGACY_UNIT_IDS, UNITS } from '../core/data/units.js';
import type { Stack } from '../core/types.js';

/** 徽标落点（§13.4 规则 1：右 → 左 → 上 → 下）。 */
export type BadgeSide = 'right' | 'left' | 'up' | 'down';

/** 像素包围盒（含端点）。 */
export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 徽标帧几何：画布 w/h + 帧自带锚点 ax/ay + 画布内**可见剪影** bbox（含端点）。 */
export interface BadgeFrame {
  w: number;
  h: number;
  ax: number;
  ay: number;
  sil: BBox;
}

/** 邻格实体（物件精灵 / guard 标记 `mk_*` / 其它英雄棋子）的像素包围盒。 */
export type EntityBBox = BBox;

/** §13.4 规则 1 的落点优先级。 */
const SIDE_ORDER: readonly { side: BadgeSide; dx: number; dy: number }[] = [
  { side: 'right', dx: 1, dy: 0 },
  { side: 'left', dx: -1, dy: 0 },
  { side: 'up', dx: 0, dy: -1 },
  { side: 'down', dx: 0, dy: 1 },
];

export function bboxOverlaps(a: BBox, b: BBox): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

/**
 * 徽标落到 (tx,ty) 格时，其**可见剪影**的像素包围盒。
 * §13.4：「用帧自带锚点（ax/ay 相对**目标格**）—— 落到哪个格，就按那个格居中贴地」。
 */
export function badgeBBoxAt(frame: BadgeFrame, tx: number, ty: number): BBox {
  return {
    x0: tx * TILE + frame.ax + frame.sil.x0,
    y0: ty * TILE + frame.ay + frame.sil.y0,
    x1: tx * TILE + frame.ax + frame.sil.x1,
    y1: ty * TILE + frame.ay + frame.sil.y1,
  };
}

/**
 * §13.4 规则 1 / 规则 3：按 **右 → 左 → 上 → 下** 取第一个「徽标矩形与该格所有实体包围盒
 * 都不相交」的相邻格；四侧皆不满足 ⇒ 返回 `null`（**不画**，不做降级）。
 *
 * ⚠️ **英雄本体必须一并作为障碍传入**（`heroBody`）。§13.4 规则 1 的字面实体集只列了
 * 「物件 ∪ `mk_*` ∪ **其它**英雄棋子」，但英雄棋子 `ay=−12` ⇒ 本体上探自身格 12px，
 * 徽标落到**上/下**邻格时会压住棋子本体（实测：上 16/16 帧压 4px、下 10/16 帧压），
 * 与 §13.5 D 的断言「徽标 ∩ 英雄棋子主体 = ∅」**自相矛盾**。把英雄本体纳入障碍集即可自洽：
 * 上/下被自然否决 ⇒ 徽标只可能落在**左右**（也正是"挂在棋子旁"的读法）。
 * 本函数把它作为**独立参数**（而非让调用方塞进 `obstacles`）就是为了不让人漏传。
 */
export function chooseBadgeSide(
  heroX: number,
  heroY: number,
  frame: BadgeFrame,
  obstacles: readonly EntityBBox[],
  heroBody: EntityBBox,
): BadgeSide | null {
  const hits = (b: BBox): boolean =>
    bboxOverlaps(b, heroBody) || obstacles.some((e) => bboxOverlaps(b, e));
  for (const s of SIDE_ORDER) {
    const b = badgeBBoxAt(frame, heroX + s.dx, heroY + s.dy);
    if (!hits(b)) return s.side;
  }
  return null;
}

/** 落点为某个 `side` 时的邻格坐标。 */
export function sideCell(heroX: number, heroY: number, side: BadgeSide): { x: number; y: number } {
  const s = SIDE_ORDER.find((k) => k.side === side)!;
  return { x: heroX + s.dx, y: heroY + s.dy };
}

/**
 * 兵种 id → canonical（`p<n>_*`）。
 * 段 1：旧 5 键经 `LEGACY_UNIT_IDS` 归一；已是 canonical 的原样返回；
 * 野怪 / 未知 ⇒ `null`（无 `u_*_map` 帧，按 §13.4 ③「宁可缺不可错」跳过）。
 */
export function toCanonicalUnitId(id: string): string | null {
  const alias = LEGACY_UNIT_IDS[id];
  if (alias) return alias;
  return /^p[1-4]_[a-z]+$/.test(id) ? id : null;
}

/**
 * §13.4：代表兵种 = **max(tier ↓, count ↓, canonical id ↑)** 的那一项。
 * 返回 canonical id，或 `null`（队里没有可解析的兵种）。
 * ⚠️ 与渲染层同源（都调这一个函数）—— 规格要求"别两处各写一套"。
 */
export function pickRepresentativeUnit(army: readonly Stack[]): string | null {
  let best: { id: string; tier: number; count: number } | null = null;
  for (const st of army) {
    const cid = toCanonicalUnitId(st.unitTypeId);
    if (!cid) continue;
    const u = UNITS[cid];
    if (!u) continue; // canonical 名但未登记（T5 等）⇒ 跳过
    const cand = { id: cid, tier: u.tier, count: st.count };
    if (!best) {
      best = cand;
      continue;
    }
    const better =
      cand.tier > best.tier ||
      (cand.tier === best.tier && cand.count > best.count) ||
      (cand.tier === best.tier && cand.count === best.count && cand.id < best.id);
    if (better) best = cand;
  }
  return best ? best.id : null;
}
