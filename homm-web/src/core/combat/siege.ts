/**
 * 攻城战：城墙 / 城门 / 箭塔。
 *
 * 设计取向是"够用且讲得通"，不是复刻 HOMM3 的完整攻城规则：
 *   - 城墙占满一整列，所以**挡路**是几何结果，不需要额外的"不可穿越"标记；
 *   - 城墙**只挡人不挡箭**：远程可以隔着墙对射（HOMM3 就是这样），
 *     但近战进不去 —— 于是"攻城"变成一道组合题：射手在墙外压制，
 *     步兵把墙砸开，砸开之前谁也别想碰到城里的守军；
 *   - 箭塔每轮自动射击，逼攻方在"挨打"和"破门"之间做取舍。
 *
 * 为什么不让城墙挡视线：挡视线的版本看着更"真实"，但会让躲在城里的弓箭手
 * 完全派不上用场，攻方也可以站在墙根下白砸 —— 两边都很无聊。挡人不挡箭
 * 反而逼出了 HOMM 攻城战真正的味道：护城河一带是屠宰场，谁站谁挨箭。
 *
 * 这里只放**纯几何与结构数据**（不认识 BattleState），
 * 所有涉及部队的逻辑都在 battle.ts 里，避免出现循环依赖。
 */
import type { Hex } from './hex.js';
import { FIELD_H, hexEq, hexLine } from './hex.js';
import type { Town } from '../types.js';

export type StructureKind = 'wall' | 'gate' | 'tower';

export interface SiegeStructure {
  id: string;
  kind: StructureKind;
  hex: Hex;
  hp: number;
  maxHp: number;
  /** 参与攻防修正的"防御力"：城墙没有，城门和箭塔有。 */
  defense: number;
  /** 箭塔专用：每轮自动射击的伤害区间与攻击力。 */
  shotMin?: number;
  shotMax?: number;
  attack?: number;
}

export interface SiegeState {
  /** 城墙等级 1/2/3，来自城镇的 wall1 / wall2 / wall3 建筑。 */
  level: number;
  structures: SiegeStructure[];
}

/* ---------------- 布局 ---------------- */

/**
 * 城墙列。攻方（side 0）在左边，守方（side 1）在右边。
 *
 * 选 11 是因为它同时满足：攻方有 0~10 共 11 列可以展开兵力，
 * 守方城内还留得下 13、14 两列站人，箭塔（12 列）不至于贴着守军。
 */
export const WALL_COL = 11;
/** 城门在第 5 行（战场正中）。 */
export const GATE_ROW = 5;
/** 箭塔在城墙后一列。 */
export const TOWER_COL = 12;
/** 护城河在城墙前一列：站上去的攻方部队防御 -2。 */
export const MOAT_COL = 10;
/** 站在护城河里的惩罚。 */
export const MOAT_DEFENSE_PENALTY = 2;

/** 箭塔数量随城墙等级递增：先中塔，再上侧塔，最后下侧塔。 */
const TOWER_ROWS: Record<number, number[]> = {
  1: [GATE_ROW],
  2: [1, GATE_ROW],
  3: [1, GATE_ROW, FIELD_H - 2],
};

/**
 * 一段墙塌了，紧挨着的那两段也要跟着掉血。
 *
 * 这不是为了好看：一个格子宽的口子只能容一支队伍挤进去，
 * 攻方会像排队送死一样被城里的守军点名 —— 实测下来 12 回合还打不下来。
 * 让缺口自己变宽之后，破门才真的意味着"冲进去"。
 */
export const COLLAPSE_RATIO = 0.4;

/* ---------------- 建造 ---------------- */

/**
 * 按城墙等级生成攻城结构。level ≤ 0 表示没有城墙，返回 null —— 那就是一场野战。
 *
 * 血量是拿中期部队实测出来的：20 枪兵贴脸砸一轮约 60 点、30 弓手隔墙一轮约 110 点，
 * 所以一段墙要 2~3 轮砸开、城门要 4~5 轮。够守军和箭塔打出存在感，
 * 又不至于把攻城拖到 MAX_ROUNDS 变成僵持。
 */
export function createSiege(level: number): SiegeState | null {
  if (level <= 0) return null;
  const lv = Math.min(3, Math.max(1, level));

  const structures: SiegeStructure[] = [];

  const segHp = 200 + 55 * lv;
  for (let row = 0; row < FIELD_H; row++) {
    if (row === GATE_ROW) continue; // 正中留作城门
    structures.push({
      id: `wall_${row}`,
      kind: 'wall',
      hex: { col: WALL_COL, row },
      hp: segHp,
      maxHp: segHp,
      defense: 0,
    });
  }

  const gateHp = 380 + 110 * lv;
  structures.push({
    id: 'gate',
    kind: 'gate',
    hex: { col: WALL_COL, row: GATE_ROW },
    hp: gateHp,
    maxHp: gateHp,
    defense: 2,
  });

  const towerHp = 120 + 50 * lv;
  const towerAtk = 4 + 2 * lv;
  const shotMin = 8 + 2 * lv;
  const shotMax = 12 + 4 * lv;
  for (const row of TOWER_ROWS[lv]) {
    structures.push({
      id: `tower_${row}`,
      kind: 'tower',
      hex: { col: TOWER_COL, row },
      hp: towerHp,
      maxHp: towerHp,
      defense: 4,
      shotMin,
      shotMax,
      attack: towerAtk,
    });
  }

  return { level: lv, structures };
}

/** 城镇的城墙等级：wall1/2/3 建到第几级就是几级。 */
export function wallLevelOf(town: Town): number {
  let lv = 0;
  if (town.buildings.includes('wall1')) lv = 1;
  if (town.buildings.includes('wall2')) lv = 2;
  if (town.buildings.includes('wall3')) lv = 3;
  return lv;
}

/* ---------------- 查询 ---------------- */

/** 该格上还立着的结构（被砸掉的 hp ≤ 0，视同不存在）。 */
export function structureAt(siege: SiegeState | null | undefined, h: Hex): SiegeStructure | null {
  if (!siege) return null;
  for (const st of siege.structures) {
    if (st.hp > 0 && hexEq(st.hex, h)) return st;
  }
  return null;
}

export function structureById(siege: SiegeState | null | undefined, id: string): SiegeStructure | null {
  if (!siege) return null;
  return siege.structures.find((st) => st.id === id) ?? null;
}

/** 结构还立着就挡路（打掉了那一格就能走）。 */
export function blocksMove(siege: SiegeState | null | undefined, h: Hex): boolean {
  return structureAt(siege, h) !== null;
}

/** 连线中途有没有立着的结构 —— 城墙挡视线的依据。端点本身不算遮挡。 */
export function blocksLine(siege: SiegeState | null | undefined, from: Hex, to: Hex): boolean {
  if (!siege) return false;
  const line = hexLine(from, to);
  for (let i = 1; i < line.length - 1; i++) {
    if (structureAt(siege, line[i])) return true;
  }
  return false;
}

/** 护城河：只有攻方（贴着城墙外侧那一列）会踩进去吃亏。 */
export function isMoat(h: Hex): boolean {
  return h.col === MOAT_COL;
}

/** 还立着的箭塔。 */
export function liveTowers(siege: SiegeState | null | undefined): SiegeStructure[] {
  if (!siege) return [];
  return siege.structures.filter((st) => st.kind === 'tower' && st.hp > 0);
}

/**
 * 一段墙被砸塌：连带削弱上下相邻的两段。
 * 返回被这次崩塌一起带塌的结构 id（UI 用来一次性画掉）。
 */
export function collapseNeighbors(siege: SiegeState | null | undefined, st: SiegeStructure): string[] {
  if (!siege || st.kind !== 'wall') return [];
  const fell: string[] = [];
  const splash = Math.round(st.maxHp * COLLAPSE_RATIO);
  for (const other of siege.structures) {
    if (other.kind !== 'wall' || other.hp <= 0) continue;
    if (other.hex.col !== st.hex.col) continue;
    if (Math.abs(other.hex.row - st.hex.row) !== 1) continue;
    other.hp = Math.max(0, other.hp - splash);
    if (other.hp <= 0) fell.push(other.id);
  }
  return fell;
}

/** 城门 / 城墙是否已经开了口子：攻方能不能从这里进去。 */
export function isBreached(siege: SiegeState | null | undefined): boolean {
  return blocksMove(siege, { col: WALL_COL, row: GATE_ROW }) === false;
}

export const STRUCTURE_NAME: Record<StructureKind, string> = {
  wall: '城墙',
  gate: '城门',
  tower: '箭塔',
};
