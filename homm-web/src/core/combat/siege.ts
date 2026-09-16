/**
 * 攻城战：城墙 / 城门 / 箭塔。
 *
 * 结构模仿 HOMM3 的城防线，简化了数量但保留了各自的战术意义：
 *   - **城墙**占满一整列（10 段），所以**挡路**是几何结果，不需要"不可穿越"标记；
 *   - **角塔**砌在城墙列的上下两端，是墙的一部分：拆掉它就真的在墙上开个口子；
 *   - **主楼**在城墙后两列正中，火力最猛，但不占城墙列 —— 拆它不会开出通路；
 *   - **城门**在城墙列正中，最硬，是攻方最想砸开的那一段；
 *   - **护城河**在城墙前一列，站上去的攻方防御 -2。
 *
 * 城墙**同时挡视线**：隔着完整的城墙，谁也打不到谁。守军躲在墙后是安全的，
 * 攻方在破墙之前也不会被城里点名 —— 第一目标清晰：先把墙砸开。
 *
 * 为什么最后选了"挡视线"而不是 HOMM3 的"只挡人不挡箭"：那个版本实测下来是灾难 ——
 * 弓箭手隔着墙对射，攻方步兵永远在挨打、永远打不到人，2 星城防以上就是 100% 团灭，
 * 没有决策只有送死。挡视线之后节奏反而清楚：破墙前互不损耗，破墙后才真正开打。
 *
 * 这里只放**纯几何与结构数据**（不认识 BattleState），
 * 所有涉及部队的逻辑都在 battle.ts 里，避免出现循环依赖。
 */
import type { Hex } from './hex.js';
import { FIELD_H, hexEq, hexLine } from './hex.js';
import type { Town } from '../types.js';

export type StructureKind = 'wall' | 'gate' | 'tower' | 'keep';

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
 * 守方城内还留得下 12、13 两列（14 列是守军部署列），主楼摆进去不挤。
 */
export const WALL_COL = 11;
/** 城门在第 5 行（战场正中）。 */
export const GATE_ROW = 5;
/** 主楼在城墙后两列、正中那一行 —— 守军部署在 14 列，不会撞上。 */
export const KEEP_COL = 13;
/** 护城河在城墙前一列：站上去的攻方部队防御 -2。 */
export const MOAT_COL = 10;
/** 站在护城河里的惩罚。 */
export const MOAT_DEFENSE_PENALTY = 2;

/**
 * 角塔（turret）**直接砌在城墙列上**，这是照 HOMM3 来的：
 * 城防线的上下两端各有一座塔楼，它们是墙的一部分，不是墙后面的独立建筑。
 *
 * 这么摆是玩法驱动：打掉一座角塔，城墙上就真的多了一个口子。
 * 早期版本把塔放在墙后一列（12 列），塔就只是个"飘在城里的射击点" ——
 * 既不像城防，拆它也没有任何战术意义。位置选错了。
 *
 * 主楼（keep）才是墙后那座高建筑：它不占城墙列，所以拆主楼不会开出通路，
 * 但它是火力最猛的射手，攻方要么忍着挨打，要么冲进去把它敲掉。
 */
const TURRET_ROWS: Record<number, number[]> = {
  1: [],
  2: [1],
  3: [1, FIELD_H - 2],
};

/**
 * 普通部队打城防的伤害折损。
 *
 * 这是让「投石车」有意义的关键设定：箭矢砸在石墙上基本是挠痒痒，只有投石车
 * 能按全额伤害轰。没有这条，30 个弓箭手 4 回合就能捅穿城墙，投石车那 1500 金
 * 买来的只是"快了一回合"—— 实测下来有没有它胜负完全一样，等于白给。
 */
export const UNIT_SIEGE_RESIST = 0.5;

/**
 * 一段墙塌了，紧挨着的那两段也要跟着掉血。
 *
 * 这不是为了好看：一个格子宽的口子只能容一支队伍挤进去，
 * 攻方会像排队送死一样被城里的守军点名 —— 实测下来 12 回合还打不下来。
 * 让缺口自己变宽之后，破门才真的意味着"冲进去"。
 */
export const COLLAPSE_RATIO = 0.4;

/**
 * 城门塌了会连带把两侧的城墙一起带塌 —— 门楼是嵌在城墙里的，它没了墙就站不住。
 *
 * 这条是「投石车值不值 1500 金」的关键。投石车优先砸城门，城门一塌就立刻
 * 出现一个三格宽的口子，部队能并排冲进去；没有投石车的话，攻方只能慢慢啃
 * 城墙段，啃开一个格子宽的洞，然后像排队送死一样被守军挨个点名。
 * 0.4 的普通崩塌比值撑不起这个差别 —— 实测有没有投石车胜负完全一样。
 */
export const GATE_COLLAPSE_RATIO = 1;

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
  const turretRows = TURRET_ROWS[lv];

  const segHp = 240 + 60 * lv;
  for (let row = 0; row < FIELD_H; row++) {
    if (row === GATE_ROW) continue; // 正中留作城门
    if (turretRows.includes(row)) continue; // 上下两端留给角塔
    structures.push({
      id: `wall_${row}`,
      kind: 'wall',
      hex: { col: WALL_COL, row },
      hp: segHp,
      maxHp: segHp,
      defense: 0,
    });
  }

  const gateHp = 480 + 120 * lv;
  structures.push({
    id: 'gate',
    kind: 'gate',
    hex: { col: WALL_COL, row: GATE_ROW },
    hp: gateHp,
    maxHp: gateHp,
    defense: 2,
  });

  const towerHp = 180 + 60 * lv;
  const towerAtk = 4 + 2 * lv;
  const shotMin = 8 + 2 * lv;
  const shotMax = 12 + 4 * lv;
  for (const row of turretRows) {
    structures.push({
      id: `tower_${row}`,
      kind: 'tower',
      hex: { col: WALL_COL, row },
      hp: towerHp,
      maxHp: towerHp,
      defense: 4,
      shotMin,
      shotMax,
      attack: towerAtk,
    });
  }

  // 主楼：城里那座高塔，火力最猛，但不占城墙列 —— 拆它不会开出通路
  //
  // 火力刻意压得比角塔只高一点点：主楼在 1 星城防就存在，
  // 如果它太猛，"没墙"和"1 星墙"之间会出现一道断崖 ——
  // 实测过一轮，主楼一轮能打死 2 个弓手时，开局那点兵去打哪怕是 1 星城也是 0% 胜率，
  // 玩家除了"先攒兵"之外没有任何选择。现在 1 星主楼约等于多一个弓手队，
  // 2~3 星再靠角塔把火力叠上去。
  const keepHp = 260 + 70 * lv;
  structures.push({
    id: 'keep',
    kind: 'keep',
    hex: { col: KEEP_COL, row: GATE_ROW },
    hp: keepHp,
    maxHp: keepHp,
    defense: 5,
    shotMin: 8 + 2 * lv,
    shotMax: 13 + 3 * lv,
    attack: 5 + lv,
  });

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

/** 还立着的城防射手：角塔 + 主楼。攻城时每回合开始各射一发。 */
export function liveShooters(siege: SiegeState | null | undefined): SiegeStructure[] {
  if (!siege) return [];
  return siege.structures.filter(
    (st) => st.hp > 0 && (st.kind === 'tower' || st.kind === 'keep'),
  );
}

/** 还立着的城墙列结构（墙 / 门 / 角塔）—— 投石车只砸这些。 */
export function liveFortifications(siege: SiegeState | null | undefined): SiegeStructure[] {
  if (!siege) return [];
  return siege.structures.filter((st) => st.hp > 0 && st.hex.col === WALL_COL);
}

/**
 * 一段墙被砸塌：连带削弱城墙列上紧挨着的那两段。
 * 角塔也算城墙的一部分，所以拆塔同样会震裂旁边的墙 —— 这正是"拆塔开口子"的由来。
 * 返回被这次崩塌一起带塌的结构 id（UI 用来一次性画掉）。
 */
export function collapseNeighbors(siege: SiegeState | null | undefined, st: SiegeStructure): string[] {
  if (!siege) return [];
  if (st.kind !== 'wall' && st.kind !== 'tower' && st.kind !== 'gate') return [];
  const fell: string[] = [];
  // 城门塌了门楼两侧的墙跟着全塌，普通墙段只震裂 40% —— 见 GATE_COLLAPSE_RATIO
  const ratio = st.kind === 'gate' ? GATE_COLLAPSE_RATIO : COLLAPSE_RATIO;
  const splash = Math.round(st.maxHp * ratio);
  for (const other of siege.structures) {
    if (other.hp <= 0) continue;
    if (other.kind !== 'wall' && other.kind !== 'tower') continue;
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
  tower: '角塔',
  keep: '主楼',
};
