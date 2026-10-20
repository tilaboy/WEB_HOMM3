/**
 * 战斗引擎。
 *
 * 整个项目只有这一个战斗规则来源：
 *   - 战前「预估」= 让 AI 替你把这场仗打一遍（quickBattle）；
 *   - 战前「自动战斗」= 同样的 quickBattle，点了就是预估里那个结果；
 *   - 亲手指挥 = 同一套规则 + 同一颗种子，只是由你下指令，所以通常能打得更好。
 * M1 时代那个无位置的 solver 已经删掉了——它和战场上的实际结果差得太远，
 * 玩家会觉得"预估在吓唬人"。
 */
import type { Army, WarMachineId } from '../types.js';
import { getUnit } from '../data/units.js';
import { getSpell, SPELLS } from '../data/spells.js';
import { WAR_MACHINES } from '../data/warmachines.js';
import { mulberry32, randInt } from '../rng.js';
import { damageMultiplier, rollDamage } from './damage.js';
import {
  FIELD_H,
  FIELD_W,
  bfs,
  distance,
  hexEq,
  hexKey,
  hexLine,
  inField,
  isAdjacent,
  neighbors,
  type Hex,
} from './hex.js';
import {
  MOAT_DEFENSE_PENALTY,
  STRUCTURE_NAME,
  UNIT_SIEGE_RESIST,
  blocksLine,
  collapseNeighbors,
  blocksMove,
  GATE_ROW,
  createSiege,
  isMoat,
  liveFortifications,
  liveShooters,
  structureById,
  type SiegeState,
  type SiegeStructure,
  type StructureKind,
} from './siege.js';

export type { Hex };
export type { SiegeState, SiegeStructure };
export { MOAT_DEFENSE_PENALTY, STRUCTURE_NAME } from './siege.js';

export interface BattleSide {
  army: Army;
  attack: number;
  defense: number;
  /** 这一侧属于哪个阵营（`p1`~`p4`）。野怪/中立守军省略。 */
  faction?: string;
  /** 施法者（英雄）。野怪没有，中立城守军也没有。 */
  caster?: BattleCaster;
  /** 携带的攻城器械：每回合开始自动开火，不受指挥。 */
  warMachines?: WarMachineId[];
}

/** 战场上的英雄施法者：带法术表、魔力和魔力的实时余量（引擎直接扣）。 */
export interface BattleCaster {
  spells: string[];
  spellPower: number;
  mana: number;
}

/** 一条时效增益/减益（haste/slow/bless/...）。 */
export interface UnitEffect {
  spellId: string;
  /** 剩余回合数（含当回合；新回合开始时 -1，归零移除）。 */
  rounds: number;
}

export interface BattleLoss {
  unitTypeId: string;
  before: number;
  after: number;
}

export interface BattleOutcome {
  win: boolean;
  rounds: number;
  losses: BattleLoss[];
  enemyLosses: BattleLoss[];
  expGained: number;
  survivors: Army;
  enemySurvivors: Army;
  /** 主动从战场撤退（区别于被全歼）。 */
  fled?: boolean;
  /** 战后剩余法力（side 0 的施法者）。世界层据此写回英雄。 */
  casterMana?: number;
  /**
   * 这场仗的「实验事故」（紫晶参战才有）。
   * 带在 outcome 上是为了**战前公示**：预估与实战同一个种子 ⇒ 同一条事故。
   */
  accident?: BattleAccident | null;
}

/* ---------------- units ---------------- */

export interface BattleUnit {
  id: string;
  side: 0 | 1;
  unitTypeId: string;
  count: number;
  /** 队首那个"残血"单位还剩多少血；其余单位都是满血。 */
  hpTop: number;
  shots: number;
  hex: Hex;
  /** 本回合是否已反击过（每回合限一次）。 */
  retaliated: boolean;
  /**
   * 「弹跳袭击」是否已经用掉（**每队每场一次**）。
   *
   * 为什么不给无限次：免反击让这一支在近战里"只输出不挨打"，实测（§11.7）
   * 无限次会让紫晶对晨曦的攻方胜率 +38pt、贴脸镜像 70%→100%（结构性必赢）。
   * 收成每队一次之后，它变成一个**要挑时机花掉的资源**，而不是永久免疫。
   */
  freeHitUsed: boolean;
  waited: boolean;
  defending: boolean;
  /** 本回合是否已移动过（HOMM：一回合可"移动 + 攻击"，但不能移动两次）。 */
  moved: boolean;
  /**
   * **本回合已移动的格数**（0 = 原地没动）。每回合开始清零，`actMove` 写入路径长度。
   *
   * 存在理由：赤焰「冲锋」的判定不是"有没有移动"（`moved` 布尔），而是"冲了几格"
   * —— 移动 2 格和 5 格必须能被区分开（`production/faction-gameplay-review-2026-10-20.md §4`）。
   */
  moveDist: number;
  /** 建队序号，用于同速时的稳定排序。 */
  seq: number;
  /** 建队时的初始数量：复活/损失统计的基准。 */
  startCount: number;
  /** 身上的时效法术（M4）。 */
  effects: UnitEffect[];
}

export interface BattleState {
  units: BattleUnit[];
  round: number;
  order: string[];
  idx: number;
  atkBonus: [number, number];
  defBonus: [number, number];
  /**
   * 两侧所属阵营（`p1`~`p4`；野怪/中立守军为 `null`）。
   *
   * 这是**族动词**的唯一开关：赤焰冲锋只看 `factions[side] === 'p2'`。
   * 部队 id 前缀也能反推阵营，但显式传进来更可靠 —— 中立野怪用的是
   * canonical id 之外的旧 id，且未来可能出现"借兵"玩法。
   */
  factions: [string | null, string | null];
  over: boolean;
  winner: 0 | 1 | null;
  fled: boolean;
  startArmies: [Army, Army];
  /** 两侧的施法者（英雄）。null = 这一侧不会施法。 */
  casters: [BattleCaster | null, BattleCaster | null];
  /** 本回合双方各可施法 1 次。 */
  castUsed: [boolean, boolean];
  rng: () => number;
  /**
   * **事故专用的随机流**（与 `rng` 分开，同种子派生）。
   *
   * 为什么不开第二条流：事故只掷 1 次，但这一次抽样会把 `rng` 整体错位，
   * 于是"同一种子 + 不同事故"根本不是同一场战斗 —— 测事故影响时无法隔离，
   * 玩家侧也变成"开战骰子一响，整盘伤害序列全换一遍"。
   * 分开之后：同种子的对局在事故前后的每一次伤害抽样都一一对应。
   */
  accidentRng: () => number;
  log: string[];
  /** 攻城结构（城墙 / 城门 / 箭塔）。没有城墙的战斗是 null。 */
  siege?: SiegeState | null;
  /** 双方携带的攻城器械。不是单位，不占格、不能被瞄准。 */
  machines?: [WarMachineId[], WarMachineId[]];
  /**
   * 开战掷出的「实验事故」（紫晶族动词）。没有紫晶参战 = null。
   * 只在 `createBattle` 里掷一次、写在这里，UI 与探针都读这一份，不另算。
   */
  accident?: BattleAccident | null;
}

/** 超过这个格数算"远距离抛射"，伤害减半（HOMM 的经典设定）。 */
export const LONG_RANGE = 10;

const MAX_ROUNDS = 40;

/* ---------------- events ---------------- */

export type BattleEvent =
  | { t: 'round'; round: number }
  | { t: 'move'; unitId: string; path: Hex[]; from: Hex }
  | { t: 'melee'; unitId: string; targetId: string; damage: number; killed: number; from: Hex; to: Hex }
  | {
      t: 'shoot';
      unitId: string;
      targetId: string;
      damage: number;
      killed: number;
      from: Hex;
      to: Hex;
      blocked: boolean;
      longRange: boolean;
    }
  | { t: 'retaliate'; unitId: string; targetId: string; damage: number; killed: number }
  /** 「弹跳袭击」生效：攻方砸完弹开，守方这一下没能回手（每队每场一次）。 */
  | { t: 'bounce'; unitId: string; targetId: string }
  /** 翠林「缠根」生效：目标速度 −2，到它下一次行动结束。 */
  | { t: 'root'; unitId: string; targetId: string }
  | { t: 'die'; unitId: string }
  /** 攻城器械开火：投石车砸城防，弩车射部队。 */
  | {
      t: 'machine';
      side: 0 | 1;
      machine: WarMachineId;
      structureId?: string;
      targetId?: string;
      damage: number;
      killed: number;
      destroyed: boolean;
      to: Hex;
    }
  /** 砸城墙 / 城门 / 角塔 / 主楼。 */
  | {
      t: 'siege';
      unitId: string;
      structureId: string;
      kind: StructureKind;
      damage: number;
      destroyed: boolean;
      from: Hex;
      to: Hex;
    }
  /** 箭塔在回合开始时自动射击攻方。 */
  | { t: 'tower'; structureId: string; targetId: string; damage: number; killed: number }
  | { t: 'wait'; unitId: string }
  | { t: 'defend'; unitId: string }
  | {
      t: 'cast';
      side: 0 | 1;
      spellId: string;
      targetId?: string;
      hex?: Hex;
      damage?: number;
      killed?: number;
      revived?: number;
      wasDead?: boolean;
      /** 火球溅射：同一次施法的多段伤害，UI 用来画爆炸范围。 */
      splash?: boolean;
    }
  | { t: 'end'; winner: 0 | 1 | null; fled: boolean };

/* ---------------- setup ---------------- */

/** 把最多 5 支部队沿一列均匀铺开，两队分别贴左右边缘。 */
function deploy(army: Army, side: 0 | 1, seqBase: number): BattleUnit[] {
  const live = army.filter((s) => s.count > 0);
  const col = side === 0 ? 0 : FIELD_W - 1;
  // 部队只铺在第 1 ~ FIELD_H-2 行之间：上下两个角格留给攻城器械（drawWarMachines），
  // 否则满编 5 队时最后一队正好压在角上，和器械的精灵互相叠图。
  const TOP = 1;
  const BOT = FIELD_H - 2;
  const rowOf = (i: number): number =>
    live.length === 1 ? (TOP + BOT) / 2 : TOP + Math.round((i * (BOT - TOP)) / (live.length - 1));
  return live.map((s, i) => {
    const u = getUnit(s.unitTypeId);
    return {
      id: `u${side}_${i}`,
      side,
      unitTypeId: s.unitTypeId,
      count: s.count,
      hpTop: u.hp,
      shots: u.shots ?? 0,
      hex: { col, row: rowOf(i) },
      retaliated: false,
      freeHitUsed: false,
      waited: false,
      defending: false,
      moved: false,
      moveDist: 0,
      seq: seqBase + i,
      startCount: s.count,
      effects: [],
    };
  });
}

/* ---------------- 族动词 · 紫晶「实验事故」（2026-10-20） ----------------
 *
 * 规则（一句话）：**只要场上有紫晶（`p4`）的部队，开战先掷一条事故，双方同受** ——
 *   反重力（全场速度 +2）/ 试剂泄漏（远程弹药减半）/ 爆炸（双方各损 5% 兵力）。
 *
 * 为什么是"改变规则"而不是"加个数值"：另外三个动词分别在管空间（冲锋）、
 * 对手的空间（缠根）、时钟（加班）；紫晶要管的是**这一局的前提**。
 * 它不是"玩家的一个决定"，而是"这局要多想一件事"——开局先看一眼脚下是哪种世界。
 *
 * 四条边界（硬约束）：
 *   ① **双方同受，一条不落**。这是底线：只坑玩家的随机事件是最好的劝退设计
 *      （`design/gdd/races.md` 的「魔法实验室事故」设定本身也是"全员遭殃"）。
 *   ② **用战斗自己的种子**（`s.rng`），所以同一个种子的"预估"和"实战"必然是**同一条**
 *      —— 战前那个胜率里已经含了这场事故，不会出现"预估说能赢、进去发现换了规则"。
 *   ③ **在 `startRound` 之前结算**：反重力会影响第一回合的排序与移动力，
 *      爆炸掉的人要在第一回合就不在场。
 *   ④ **中立守军也会吃**（它们只是"另一方"，不是"不受规则约束的人"）。
 *      这意味着紫晶打野怪也带事故——这是族身份，不是 bug。
 */
export type AccidentKind = 'gravity' | 'leak' | 'boom';

export interface BattleAccident {
  kind: AccidentKind;
  name: string;
  /** 一句话规则说明：头部标签与战报共用同一句，探针直接断言它。 */
  detail: string;
}

/** 拥有这条动词的阵营。 */
export const ACCIDENT_FACTION = 'p4';
/** 爆炸按"当前总血量的百分之几"扣（不是按人数：5% 的 2 人队会四舍五入成 0）。 */
export const ACCIDENT_BOOM_RATE = 0.05;
/**
 * 反重力扣掉的**远程**伤害系数。
 *
 * 为什么载荷全在伤害轴、不上速度/弹药：实测（100 种子 × p4 六格）把速度 +1/+2
 * 或弹药减半当作"双方同受"的载荷，会把 `紫晶→翠林 91%` 打成 `0~23%`、
 * `紫晶→赤焰 100%` 打成 `22~54%` —— 因为这两条轴改的是**接触时间**，
 * 而紫晶的整套强度就建立在"先射几轮再被贴上"，一提前接触就整盘翻面。
 * 名字叫"同受"不等于"同影响"。改到伤害轴后摆动收到 19~28pp（见 §11.10）。
 *
 * 为什么是 0.9 而不是 0.8：0.8 时 `紫晶→翠林` 仍从 77% 掉到 17%（−60pp）——
 * 这张对战矩阵是"刀锋"状的（见 §11.10 末），再小的规则改动也会被放大。
 * 取 0.9 后最大摆动 28pp，和另两条（22 / 19）同一量级。
 */
export const ACCIDENT_RANGED_SCALE = 0.9;
/** 试剂泄漏扣掉的防御（双方同受）。 */
export const ACCIDENT_DEF_PENALTY = 1;

/** 三条事故的权威表（顺序 = 掷骰顺序，别改顺序：老种子的事故会跟着变）。 */
export const ACCIDENT_TABLE: readonly BattleAccident[] = [
  { kind: 'gravity', name: '反重力', detail: `远程伤害 −${Math.round((1 - ACCIDENT_RANGED_SCALE) * 100)}%（飘着射不准，双方同受）` },
  { kind: 'leak', name: '试剂泄漏', detail: `防御 −${ACCIDENT_DEF_PENALTY}（护甲被腐蚀，双方同受）` },
  { kind: 'boom', name: '爆炸', detail: `双方各损 ${Math.round(ACCIDENT_BOOM_RATE * 100)}% 当前兵力（同受）` },
];

/** 头部标签 / 战报的那一行（没有事故 = 空串，UI 直接判空）。 */
export function accidentLabel(a: BattleAccident | null | undefined): string {
  return a ? `实验室事故：${a.name} · ${a.detail}` : '';
}

/** 掷一条并立刻生效。没有紫晶参战 ⇒ null（且**不消耗**随机数，别动别人的随机流）。 */
export function rollAccident(s: BattleState): BattleAccident | null {
  if (s.factions[0] !== ACCIDENT_FACTION && s.factions[1] !== ACCIDENT_FACTION) return null;
  // 用专用流：这一抽不能挪动伤害序列（否则同种子不可比，见 `accidentRng` 的注释）
  const pick =
    ACCIDENT_TABLE[
      Math.min(ACCIDENT_TABLE.length - 1, Math.floor(s.accidentRng() * ACCIDENT_TABLE.length))
    ];
  // 反重力 / 试剂泄漏都是**读取时生效**的修正（见 `accidentAtkMod` / `defBonusOf`），
  // 不在掷骰阶段改任何单位的状态 —— 这样战前预估与实战走同一个函数，不可能算两套。
  if (pick.kind === 'boom') {
    let dead = 0;
    for (const u of s.units) {
      const pool = poolOf(u);
      // 留 1 点血：事故是"开战前挨了一下"，不该在掷骰阶段直接把某队抹掉
      if (pool <= 1) continue;
      dead += applyDamage(u, Math.min(pool - 1, Math.max(1, Math.round(pool * ACCIDENT_BOOM_RATE))));
    }
    // 5% 落在"血量"上，多单位小队常常一个人都死不掉 —— 战报必须写**实际死了几个**，
    // 否则玩家只看到战报说"各损 5%"，场上一个数字都没变。
    return {
      ...pick,
      detail:
        dead > 0
          ? `双方各损 ${Math.round(ACCIDENT_BOOM_RATE * 100)}% 当前兵力（同受），合计 −${dead} 人`
          : `双方各损 ${Math.round(ACCIDENT_BOOM_RATE * 100)}% 当前兵力（同受），无人阵亡（只削血线）`,
    };
  }
  return { ...pick };
}

export function createBattle(
  attacker: BattleSide,
  defender: BattleSide,
  seed: number,
  /** 守方城墙等级（1/2/3）；0 或省略 = 野战。 */
  siegeLevel = 0,
): BattleState {
  const a = deploy(attacker.army, 0, 0);
  const d = deploy(defender.army, 1, 100);
  const s: BattleState = {
    units: [...a, ...d],
    round: 0,
    order: [],
    idx: 0,
    atkBonus: [attacker.attack, defender.attack],
    defBonus: [attacker.defense, defender.defense],
    factions: [attacker.faction ?? null, defender.faction ?? null],
    over: false,
    winner: null,
    fled: false,
    startArmies: [attacker.army.map((x) => ({ ...x })), defender.army.map((x) => ({ ...x }))],
    casters: [
      attacker.caster ? { spells: [...attacker.caster.spells], spellPower: attacker.caster.spellPower, mana: attacker.caster.mana } : null,
      defender.caster ? { spells: [...defender.caster.spells], spellPower: defender.caster.spellPower, mana: defender.caster.mana } : null,
    ],
    castUsed: [false, false],
    rng: mulberry32(seed),
    accidentRng: mulberry32(seed ^ 0x5bf03635),
    log: [],
    siege: createSiege(siegeLevel),
    machines: [[...(attacker.warMachines ?? [])], [...(defender.warMachines ?? [])]],
    accident: null,
  };
  // 紫晶「实验事故」：在 `startRound` 之前掷，战报第一行就是它 ——
  // 规则变了必须看得见（而且第一回合的预估就已经按事故算，不会"先好后坏"）。
  const accident = rollAccident(s);
  if (accident) {
    s.accident = accident;
    s.log.push(accidentLabel(accident));
  }
  startRound(s);
  return s;
}

/* ---------------- queries ---------------- */

export function unitById(s: BattleState, id: string): BattleUnit | null {
  return s.units.find((u) => u.id === id) ?? null;
}

export function aliveOf(s: BattleState, side: 0 | 1): BattleUnit[] {
  return s.units.filter((u) => u.side === side && u.count > 0);
}

export function unitAt(s: BattleState, h: Hex): BattleUnit | null {
  return s.units.find((u) => u.count > 0 && hexEq(u.hex, h)) ?? null;
}

function occupied(s: BattleState, h: Hex, exceptId?: string): boolean {
  return s.units.some((u) => u.count > 0 && u.id !== exceptId && hexEq(u.hex, h));
}

export function currentUnit(s: BattleState): BattleUnit | null {
  if (s.over) return null;
  while (s.idx < s.order.length) {
    const u = unitById(s, s.order[s.idx]);
    if (u && u.count > 0) return u;
    s.idx += 1;
  }
  return null;
}

/** 护城河惩罚：只有攻城战里、只有攻方（side 0）踩在护城河上才吃亏。 */
function moatPenalty(s: BattleState, u: BattleUnit): number {
  if (!s.siege) return 0;
  if (u.side !== 0) return 0;
  return isMoat(u.hex) ? MOAT_DEFENSE_PENALTY : 0;
}

/** 一个部队当前的防御加/减值总和（护城河是减值，所以可能为负）。 */
function defBonusOf(s: BattleState, u: BattleUnit): number {
  // 「试剂泄漏」腐蚀护甲：双方同受（这里只管被结算方的防御，所以攻守都吃）。
  const leak = s.accident?.kind === 'leak' ? ACCIDENT_DEF_PENALTY : 0;
  return s.defBonus[u.side] + effDefBonus(u) + (u.defending ? 3 : 0) - moatPenalty(s, u) - leak;
}

/** 部队站不上去的格子：有人，或者还立着一截城墙。 */
function blockedHex(s: BattleState, h: Hex, exceptId?: string): boolean {
  if (occupied(s, h, exceptId)) return true;
  return blocksMove(s.siege, h);
}

/** 可移动到的格子 → 路径（不含起点）。 */
export function reachable(s: BattleState, u: BattleUnit): Map<string, Hex[]> {
  const speed = unitSpeed(s, u);
  return bfs(u.hex, speed, (h) => blockedHex(s, h, u.id));
}

/**
 * 这个部队能砸到哪些城防结构。
 * 近战要贴脸；远程可以隔着打（城墙挡人不挡箭，见 siege.ts 的设计说明）。
 */
export function siegeTargets(s: BattleState, u: BattleUnit, ranged: boolean): SiegeStructure[] {
  if (!s.siege) return [];
  return s.siege.structures.filter((st) => {
    if (st.hp <= 0) return false;
    // 近战要贴脸；远程要视线 —— 所以墙后的箭塔在破墙之前是打不到的
    return ranged ? !blocksLine(s.siege, u.hex, st.hex) : isAdjacent(u.hex, st.hex);
  });
}

export function canShoot(s: BattleState, u: BattleUnit): boolean {
  const def = getUnit(u.unitTypeId);
  if (def.shots === undefined || u.shots <= 0) return false;
  // HOMM 规则：被敌人贴身时不能放箭
  return !aliveOf(s, u.side === 0 ? 1 : 0).some((e) => isAdjacent(e.hex, u.hex));
}

/** 射击是否被挡住（挡住则伤害减半）：部队会挡，立着的城墙也会挡。 */
export function shotBlocked(s: BattleState, u: BattleUnit, target: BattleUnit): boolean {
  const line = hexLine(u.hex, target.hex);
  for (let i = 1; i < line.length - 1; i++) {
    const other = unitAt(s, line[i]);
    if (other && other.id !== u.id && other.id !== target.id) return true;
  }
  return false;
}

export function meleeTargets(s: BattleState, u: BattleUnit): BattleUnit[] {
  return aliveOf(s, u.side === 0 ? 1 : 0).filter((e) => isAdjacent(e.hex, u.hex));
}

export function shootTargets(s: BattleState, u: BattleUnit): BattleUnit[] {
  // 完整的城墙挡视线：隔着墙既打不到城里的人，城里的人也打不出来
  return aliveOf(s, u.side === 0 ? 1 : 0).filter((f) => !blocksLine(s.siege, u.hex, f.hex));
}

/* ---------------- 法术效果（M4） ---------------- */

export function hasEffect(u: BattleUnit, spellId: string): boolean {
  return u.effects.some((e) => e.spellId === spellId);
}

function addEffect(u: BattleUnit, spellId: string, rounds: number): void {
  const cur = u.effects.find((e) => e.spellId === spellId);
  if (cur) cur.rounds = Math.max(cur.rounds, rounds);
  else u.effects.push({ spellId, rounds });
}

/**
 * `effects` 里**不只有法术**：族动词也会挂效果（「缠根」）。
 * UI 以前直接 `getSpell(e.spellId).name`，遇到非法术 id 会抛异常 —— 统一走这里。
 */
export const EFFECT_LABEL: Record<string, string> = { root: '缠根' };

export function effectLabel(effectId: string): string {
  return SPELLS[effectId]?.name ?? EFFECT_LABEL[effectId] ?? effectId;
}

/** 攻击的临时加成：祝福 +3，嗜血 +4（仅近战），诅咒 -3（合并后不低于 -原攻击）。 */
export function effAtkBonus(u: BattleUnit, melee: boolean): number {
  let b = 0;
  if (hasEffect(u, 'bless')) b += 3;
  if (melee && hasEffect(u, 'bloodlust')) b += 4;
  if (hasEffect(u, 'curse')) b -= 3;
  return b;
}

/** 防御的临时加成：石肤 +3（防御姿态的 +3 另算）。 */
export function effDefBonus(u: BattleUnit): number {
  return hasEffect(u, 'stoneSkin') ? 3 : 0;
}

/* ---------------- 族动词（2026-10-20） ----------------
 *
 * 四族差异此前只有数值纹理（见 `production/faction-gameplay-review-2026-10-20.md`）。
 * 这里落第一个**动词**：赤焰「冲锋」。判断标准是"玩家每回合要多想一件事"，
 * 不是"多一个 +1"。
 *
 * 规则（一句话能说清）：
 *   赤焰的近战部队，**本回合移动 ≥3 格后攻击：攻 +2；原地不动就攻击：攻 −1**。
 *
 * 三条边界（都是有意的，写死在这里而不是散落在调用点）：
 *   ① **只算子自己的攻击动作**：反击不吃冲锋 —— 反击是"被撞了一下回手"，
 *      不是冲过去，吃了会变成"站着挨打反而更赚"。
 *   ② **远程单位整条不参与**（`shots` 有值的兵）：投斧蛮子站在原地扔斧子，
 *      不冲也不萎；否则族里唯一的远程会被净罚 −1，等于白送一个负面被动。
 *      即使它被迫近战，也不吃冲锋 —— 规则按"兵种"关闭，不按"这一次是近战还是射击"关闭，
 *      否则同一支部队在两种攻击之间会有两套加成，玩家无法预期。
 *   ③ **攻城不计**：冲城墙不是冲锋（`estimateSiegeDamage` 不调本函数）。
 */

/** 拥有冲锋动词的阵营。 */
export const CHARGE_FACTION = 'p2';
/** 触发冲锋所需的本回合移动格数。 */
export const CHARGE_MOVE_HEXES = 3;
/** 冲起来之后的攻击加成。 */
export const CHARGE_ATK_BONUS = 2;
/** 原地不动就出手的惩罚。 */
export const CHARGE_IDLE_PENALTY = -1;

/**
 * 冲锋带来的攻击修正（0 = 这个单位/这一击不吃这条规则）。
 *
 * `moveDist` 可显式传入：AI 在**评估某个落点**时单位还没真的移动过去，
 * 必须用"假定走了这么远"来算伤害，否则它会低估冲锋、永远不冲。
 */
export function chargeAtkBonus(
  s: BattleState,
  u: BattleUnit,
  melee: boolean,
  moveDist: number = u.moveDist,
): number {
  if (!melee) return 0;
  if (s.factions[u.side] !== CHARGE_FACTION) return 0;
  if (getUnit(u.unitTypeId).shots !== undefined) return 0; // 远程单位整条不参与
  if (moveDist >= CHARGE_MOVE_HEXES) return CHARGE_ATK_BONUS;
  if (moveDist === 0) return CHARGE_IDLE_PENALTY;
  return 0;
}

/**
 * 战场提示文案（1 行 = 1 个数字，不弹窗、不加面板）。
 *
 * 放在 core 而不是 UI，是因为它需要能被断言：`tools/probes/factionverbs.mjs`
 * 直接验这三种状态的文字，避免"UI 那行看起来对"却没人量过。
 * 返回 `null` = 这个单位不吃这条规则（别族 / 远程），UI 不该显示任何东西。
 */
export function chargeHint(s: BattleState, u: BattleUnit): string | null {
  if (s.factions[u.side] !== CHARGE_FACTION) return null;
  if (getUnit(u.unitTypeId).shots !== undefined) return null;
  const b = chargeAtkBonus(s, u, true);
  if (b > 0) return `冲锋 +${b}（本回合已冲 ${u.moveDist} 格）`;
  if (b < 0) return `冲锋 ${b}（原地出手，动起来才 +${CHARGE_ATK_BONUS}）`;
  return `冲锋 ±0（冲 ${CHARGE_MOVE_HEXES} 格以上 +${CHARGE_ATK_BONUS}）`;
}

/* ---------------- 族动词 · 晨曦「加班」 ----------------
 *
 * 规则（一句话）：**从第 4 回合起，晨曦全军每回合攻 +1，上限 +3**。
 *
 * 和「冲锋」的区别在于它不改变玩家"这一手怎么走"，而是改变**整场仗的节奏**：
 *   晨曦想拖、对手想快；赤焰的仗 3.5 回合就结束 ⇒ 加班根本来不及生效。
 * 这正是设计文档里写的反制关系（§4：加班 ← 被赤焰式爆发在 3 回合内拆掉）。
 *
 * 三条边界（同冲锋一样写死在这里）：
 *   ① **只跟回合数有关**，不看单位、不看走位、不看是否远程 —— 全军一起加班，
 *      所以射击也吃、反击也吃（这是"部队的攻击力变高了"，不是"这一下有加成"）。
 *   ② **攻城不计**：砸城墙不是"交战"（`actSiege` / `estimateSiegeDamage` 都不调本函数），
 *      和冲锋的边界保持一致，免得玩家要记两套规则。
 *   ③ **按回合数线性**，第 4 回合 +1、5 回合 +2、6 回合起恒 +3。
 *
 * 为什么从第 4 回合：切在"正常战斗已经打了 3 回合"的位置，玩家能明确感到
 * "这仗拖长了要变天"，而不是从第一回合就有个看不见的数值差。
 */
export const OVERTIME_FACTION = 'p1';
/** 加班从第几回合开始生效（这一回合的攻击就已经 +1）。 */
export const OVERTIME_START_ROUND = 4;
/** 加班攻击加成的上限。 */
export const OVERTIME_MAX = 3;

/** 该阵营此刻的加班加成（0 = 不生效 / 别族）。 */
export function overtimeAtkBonus(s: BattleState, side: 0 | 1): number {
  if (s.factions[side] !== OVERTIME_FACTION) return 0;
  return Math.min(OVERTIME_MAX, Math.max(0, s.round - (OVERTIME_START_ROUND - 1)));
}

/**
 * 加班提示文案（1 行、1 个数字）。返回 `null` = 这个单位不吃这条规则（别族）。
 *
 * 和 `chargeHint` 一样放在 core，是为了能被探针直接断言 —— 否则"UI 看起来对"
 * 但没人量过文案与实际加成是否一致。
 */
export function overtimeHint(s: BattleState, u: BattleUnit): string | null {
  if (s.factions[u.side] !== OVERTIME_FACTION) return null;
  const b = overtimeAtkBonus(s, u.side);
  if (b > 0) return `加班 +${b}（第 ${s.round} 回合，上限 +${OVERTIME_MAX}）`;
  return `加班 +0（第 ${OVERTIME_START_ROUND} 回合起每回合 +1，上限 +${OVERTIME_MAX}）`;
}

/**
 * **事故给出的伤害系数**（只有「反重力」有：远程 ×0.9，近战不动）。
 *
 * 为什么不做成"攻击 −2"：`estimateDamage` 与结算都对攻击加成做了 `Math.max(0, …)`，
 * 英雄不加攻时负修正会被**整条吃掉**（探针 [G5] 就是这么红的）。而且 −2 点攻击
 * 对 5 攻打 2 防是 ×0.8、对 20 攻打 10 防只有 ×0.97 —— 越小越狠，不是一条能写进
 * 说明书的规则。用固定系数，任何人一读就知道"远程少两成"。
 */
export function accidentDamageScale(s: BattleState, ranged: boolean): number {
  if (s.accident?.kind !== 'gravity' || !ranged) return 1;
  return ACCIDENT_RANGED_SCALE;
}

/**
 * **自己发起的一次攻击**的总攻击力：英雄加成 + 法术临时加成 + 族动词修正。
 *
 * 所有"本单位出手"的伤害入口都必须走这里（近战 / 射击 / 战前预估 / AI 评分）——
 * 少接一处就会出现"预估说 +2、实战没吃到"的分裂，而那种 bug 没有任何断言会响。
 */
export function strikeAtkBonus(
  s: BattleState,
  u: BattleUnit,
  melee: boolean,
  assumeMoveDist?: number,
): number {
  return (
    s.atkBonus[u.side] +
    effAtkBonus(u, melee) +
    chargeAtkBonus(s, u, melee, assumeMoveDist) +
    overtimeAtkBonus(s, u.side)
  );
}

/**
 * **反击**的攻击力：英雄加成 + 法术临时加成 + 加班（不含冲锋）。
 *
 * 单独一个函数是因为有两处必须一字不差：`actMelee` 的结算 和 `estimateRetaliation`
 * 的预估。以前这两处各写一遍，改一处就会分裂（"提示说 40、实际挨 60"）。
 */
function retaliationAtkBonus(s: BattleState, u: BattleUnit): number {
  return s.atkBonus[u.side] + effAtkBonus(u, true) + overtimeAtkBonus(s, u.side);
}

/* ---------------- 族动词 · 翠林「缠根」（2026-10-20） ----------------
 *
 * 规则（一句话）：**翠林的近战命中后，目标速度 −2（最低 1），正好影响它的一次行动**。
 *
 * 和「冲锋」正好互换：冲锋是"我要空间"，缠根是"我不给你空间"。
 * 翠林全军速度 3（只有 T5 独角兽 6），永远比赤焰/紫晶慢半拍 ⇒ 它最需要
 * 把对面最快那支按住，否则每回合都在挨"走一步 + 打一下"。这也是反制关系里
 * 写的「冲锋 ← 被缠根/减速堵住」的那一半。
 *
 * 三条边界（与冲锋同构，写死在函数里而不是散在调用点）：
 *   ① **只算自己发起的那次近战**：射击不缠、反击不缠、攻城不缠 ——
 *      否则翠林站着挨打就能控场，动词会退化成"别动"（和冲锋不吃反击同一个道理）。
 *   ② **远程单位整条不参与**（`shots` 有值的兵）：荆棘射手不"缠"，它只是射。
 *   ③ **与「减速」法术不叠加**：两者都是 −2，取一次（见 `unitSpeed`）。
 *      叠到 −4 会让狼骑 7→3，一支兵被两次控制就废掉，玩家也算不清。
 *
 * ⚠️ 时效陷阱（不写下来一定会踩）：`startRound` 会把所有效果的 `rounds` 减 1，
 *    而**行动顺序也是在 `startRound` 里按 `unitSpeed` 排的**。所以挂 `rounds: 1`
 *    时，下一回合一开始就被清掉、顺序还没排 —— 缠根等于什么都没做（实测：p3 全军
 *    速度 3，等它出手时敌人基本都动过了，效果 100% 落空）。
 *    要么挂 2 轮（吃它下一手），要么承认"目标本回合还没动"时这一手已经被缠住。
 *    因此：
 *      · 目标本回合已行动（`i < s.idx`）⇒ `rounds = 2`（吃它**下一**手）
 *      · 目标本回合还没动            ⇒ `rounds = 1`（吃它**这一**手）
 *    两种情况都正好是"**一次行动**"，既不落空也不连吃两次控制。
 */
export const ROOT_FACTION = 'p3';
/** `effects` 里的键名。故意不复用 `slow`：那是法术，时长按魔力算，混在一起玩家分不清。 */
export const ROOT_EFFECT = 'root';
export const ROOT_SPEED_PENALTY = 2;

/** 这个单位这一击会不会缠根（近战兵 + 本族）。UI 提示与结算共用。 */
export function rootApplies(s: BattleState, u: BattleUnit): boolean {
  if (s.factions[u.side] !== ROOT_FACTION) return false;
  return getUnit(u.unitTypeId).shots === undefined;
}

/** 目标本回合是否已经行动过（决定缠根挂几轮，见上面的时效陷阱）。 */
function actedThisRound(s: BattleState, u: BattleUnit): boolean {
  const i = s.order.indexOf(u.id);
  return i >= 0 && i < s.idx;
}

/**
 * 给目标挂缠根，返回"这一下是不是新缠上的"。
 * 已经缠着的目标再被砸**不刷新**（`addEffect` 取 max，轮数不会变长）——
 * 所以不推事件、不重复记战报，免得每回合刷一行"缠根"。
 */
export function applyRoot(s: BattleState, u: BattleUnit, target: BattleUnit): boolean {
  if (!rootApplies(s, u)) return false;
  if (target.count <= 0) return false;
  const fresh = !hasEffect(target, ROOT_EFFECT);
  addEffect(target, ROOT_EFFECT, actedThisRound(s, target) ? 2 : 1);
  return fresh;
}

/**
 * 悬停提示那一行（1 行 = 1 条规则，不弹窗）。
 *   被缠住的部队 → "被缠根：速度 −2"
 *   翠林的近战兵 → "缠根：近战命中让目标速度 −2"
 *   其余（别族 / 翠林远程）→ null，UI 不该显示任何东西。
 */
export function rootHint(s: BattleState, u: BattleUnit): string | null {
  if (hasEffect(u, ROOT_EFFECT)) return `被缠根：速度 −${ROOT_SPEED_PENALTY}（到它下次行动）`;
  if (!rootApplies(s, u)) return null;
  return `缠根：近战命中让目标速度 −${ROOT_SPEED_PENALTY}（到它下次行动）`;
}

/**
 * AI 眼里"缠他值多少"：**只做同分时的偏好**，不压过威胁/击杀这些硬指标。
 * 已经缠住的目标给 0（再砸只是延长期限，不如去缠另一支）；
 * 越快的目标给得越多（按住 7 速的狼骑，比按住 3 速的枪兵更值钱）。
 */
export function rootTargetBonus(s: BattleState, u: BattleUnit, t: BattleUnit): number {
  if (!rootApplies(s, u)) return 0;
  if (hasEffect(t, ROOT_EFFECT)) return 0;
  return Math.max(0, unitSpeed(s, t) - 1) * 0.5;
}

/**
 * 实际速度：基础 + 加速 +2 −（减速 / 缠根，**取一次** −2），下限 1。
 *
 * 为什么减速与缠根不叠加：两者都是"速度 −2"的同一种手感，叠起来 −4 会把
 * 一支 7 速的突击兵按成 3 速（等于两张控制牌废掉一整队），且玩家无法从界面上
 * 分辨"我到底该再放一张减速吗"。取 max 之后规则一句话说得完。
 *
 * 事故**不**碰这条式子：反重力原来给"全场速度 +2"，实测会把 `紫晶→翠林 91%`
 * 打成 `0~23%`（改的是接触时间，而紫晶就靠先射几轮活着），载荷因此搬到伤害轴。
 */
export function unitSpeed(_s: BattleState, u: BattleUnit): number {
  let v = getUnit(u.unitTypeId).speed;
  if (hasEffect(u, 'haste')) v += 2;
  if (hasEffect(u, 'slow') || hasEffect(u, ROOT_EFFECT)) v -= 2;
  return Math.max(1, v);
}

/* ---------------- damage ---------------- */

/** 期望伤害，AI 与 UI 提示都用它。
 *
 * `assumeMoveDist` 只给 AI 评分用：评估"走到 X 再打"时，单位实际还没移动，
 * 用它把冲锋加成算进去（见 `chargeAtkBonus`）。 */
export function estimateDamage(
  s: BattleState,
  atk: BattleUnit,
  def: BattleUnit,
  ranged: boolean,
  assumeMoveDist?: number,
): number {
  const au = getUnit(atk.unitTypeId);
  const du = getUnit(def.unitTypeId);
  const avg = ((au.damageMin + au.damageMax) / 2) * atk.count;
  let mod = damageMod(
    Math.max(0, strikeAtkBonus(s, atk, !ranged, assumeMoveDist)),
    du.defense + defBonusOf(s, def),
  );
  if (ranged) {
    if (distance(atk.hex, def.hex) > LONG_RANGE) mod *= 0.5; // 远距离抛射衰减
    if (shotBlocked(s, atk, def)) mod *= 0.5; // 被自己人/敌人挡住
    if (hasEffect(def, 'shield')) mod *= 0.5; // 护盾
    mod *= accidentDamageScale(s, true); // 反重力：远程少两成（同受）
  }
  return Math.max(1, Math.round(avg * mod));
}

/**
 * 砸城防的期望伤害，UI 提示与 AI 决策共用。
 * 城防没有血量池概念，只有 hp，所以这里直接按"攻击力 vs 结构防御"算倍率。
 *
 * ⚠️ 这里**故意不调 `strikeAtkBonus`**：攻城不计族动词（冲城墙不是冲锋）。
 */
export function estimateSiegeDamage(s: BattleState, u: BattleUnit, st: SiegeStructure, ranged: boolean): number {
  const au = getUnit(u.unitTypeId);
  const avg = ((au.damageMin + au.damageMax) / 2) * u.count;
  let mod = damageMod(Math.max(0, au.attack + s.atkBonus[u.side] + effAtkBonus(u, !ranged)), st.defense);
  if (ranged) {
    if (distance(u.hex, st.hex) > LONG_RANGE) mod *= 0.5;
    if (blocksLine(s.siege, u.hex, st.hex)) mod *= 0.5;
  }
  // 箭矢砍不动石墙：只有投石车能按全额伤害轰
  return Math.max(1, Math.round(avg * mod * UNIT_SIEGE_RESIST));
}

function damageMod(attack: number, defense: number): number {
  return Math.min(Math.max(1 + 0.05 * (attack - defense), 0.3), 3.0);
}

/** 一个部队的"总血量"：满血单位 + 队首残血。 */
export function poolOf(u: BattleUnit): number {
  return Math.max(0, (u.count - 1) * getUnit(u.unitTypeId).hp + u.hpTop);
}

function applyDamage(u: BattleUnit, dmg: number): number {
  const hp = getUnit(u.unitTypeId).hp;
  const before = u.count;
  let d = dmg;
  while (d > 0 && u.count > 0) {
    if (d >= u.hpTop) {
      d -= u.hpTop;
      u.count -= 1;
      u.hpTop = hp;
    } else {
      u.hpTop -= d;
      d = 0;
    }
  }
  if (u.count <= 0) {
    u.count = 0;
    u.hpTop = 0;
  }
  return before - u.count;
}

/* ---------------- turn loop ---------------- */

function startRound(s: BattleState): void {
  s.round += 1;
  for (const u of s.units) {
    u.retaliated = false;
    u.waited = false;
    u.defending = false;
    u.moved = false;
    u.moveDist = 0;
    // 法术时效：进入新回合扣 1 轮，归零则消失
    u.effects = u.effects.filter((e) => {
      e.rounds -= 1;
      return e.rounds > 0;
    });
  }
  s.castUsed = [false, false];
  // 行动顺序：速度降序；**同速时攻方（side 0）先动** —— 这是刻意的，不是 bug。
  // HOMM3 同款：攻方本来就该有先手优势（2026-10-20 拍板保留，原本差点被"洗牌"掉）。
  // 代价要写清楚：镜像对打（双方每一对兵速度都一样）时攻方胜率 78~93%（整军，120 种子），
  // 因为每个速度档内攻方每一支都先于自己的对手动手。非镜像的实战里速度构成不同，
  // 这个先手会被速度差稀释，不会到 90%。读数见 `faction-gameplay-review` §11.5。
  s.order = s.units
    .filter((u) => u.count > 0)
    .sort((a, b) => {
      const sa = unitSpeed(s, a);
      const sb = unitSpeed(s, b);
      return sb - sa || a.side - b.side || a.seq - b.seq;
    })
    .map((u) => u.id);
  s.idx = 0;
  s.log.push(`—— 第 ${s.round} 回合 ——`);
  // 晨曦「加班」开张的那一回合给一行战报：玩家必须**看得到**规则变了，
  // 否则"敌人怎么越打越疼"会变成隐藏数值（设计红线：1 个动词 = 1 行文字）。
  if (s.round === OVERTIME_START_ROUND && s.factions.includes(OVERTIME_FACTION)) {
    s.log.push(
      `晨曦开始加班：全军攻击 +1（每回合再 +1，上限 +${OVERTIME_MAX}）`,
    );
  }
}

/** 结束当前单位的行动，推进行动指针。 */
export function endActivation(s: BattleState): BattleEvent[] {
  s.idx += 1;
  if (s.idx >= s.order.length) return nextRound(s);
  const u = currentUnit(s);
  if (!u) return nextRound(s);
  return [];
}

/** 开新回合：先让箭塔射一轮，再判定胜负（塔可能直接打死最后一支攻方部队）。 */
function nextRound(s: BattleState): BattleEvent[] {
  if (checkOver(s)) return [{ t: 'end', winner: s.winner, fled: s.fled }];
  startRound(s);
  const ev: BattleEvent[] = [{ t: 'round', round: s.round }];
  ev.push(...machinePhase(s));
  ev.push(...towerPhase(s));
  if (checkOver(s)) ev.push({ t: 'end', winner: s.winner, fled: s.fled });
  return ev;
}

export function checkOver(s: BattleState): boolean {
  if (s.over) return true;
  const a = aliveOf(s, 0).length;
  const d = aliveOf(s, 1).length;
  if (a === 0 || d === 0) {
    s.over = true;
    s.winner = a > 0 ? 0 : d > 0 ? 1 : null;
    return true;
  }
  if (s.round >= MAX_ROUNDS) {
    s.over = true;
    s.winner = null;
    return true;
  }
  return false;
}

/* ---------------- actions ---------------- */

export function actMove(s: BattleState, u: BattleUnit, to: Hex): BattleEvent[] {
  const paths = reachable(s, u);
  const path = paths.get(hexKey(to));
  if (!path || !path.length) return [];
  const from = { ...u.hex };
  u.hex = { ...to };
  u.moved = true;
  // `path` 不含起点（见 `reachable`），所以长度 = 移动格数。
  u.moveDist = path.length;
  return [{ t: 'move', unitId: u.id, path, from }];
}

export function actMelee(s: BattleState, u: BattleUnit, target: BattleUnit): BattleEvent[] {
  if (!isAdjacent(u.hex, target.hex) || target.count <= 0) return [];
  const ev: BattleEvent[] = [];
  const from = { ...u.hex };
  const to = { ...target.hex };
  const dmg = rollDamage(
    s.rng,
    getUnit(u.unitTypeId),
    u.count,
    strikeAtkBonus(s, u, true),
    getUnit(target.unitTypeId),
    defBonusOf(s, target),
  );
  const killed = applyDamage(target, dmg);
  ev.push({ t: 'melee', unitId: u.id, targetId: target.id, damage: dmg, killed, from, to });
  ev.push(...afterHit(target));

  // 翠林「缠根」：命中之后才缠（不是命中前），且只在本族近战兵**自己出手**时触发。
  // 放在反击之前：藤蔓是先缠住才轮到对面回手，顺序上说得通；机制上互不影响（缠根不碰攻击力）。
  if (target.count > 0 && applyRoot(s, u, target)) {
    ev.push({ t: 'root', unitId: u.id, targetId: target.id });
  }

  // 反击：每回合每支部队限一次，**全额**。
  //
  // 2026-10-20 恢复 HOMM3 原设计（原先是 ×0.5）。为什么取消减半：
  //   反击用的是"被打完之后的人数"（下面 `applyDamage` 已经把伤亡扣掉了），
  //   人数本身就把这一击摊薄了 —— 实测只值 −10~25%（20 队 T3 对砍，见
  //   `production/faction-gameplay-review-2026-10-20.md` §11.5）。
  //   再乘 0.5 等于二次打折：一次交换变成 46% / 38%，胜负几乎由"谁先碰到对手"决定。
  //
  // ⚠️ 反击**不吃族动词**（冲锋）：这是"被撞了一下回手"，不是自己冲过去。
  //    否则赤焰部队站着挨打反而更赚，动词会退化成"别动"。
  //
  // 「弹跳袭击」(`noRetaliate`)：攻方带这条 ⇒ 守方**不能**回手（HOMM3 吸血伯爵同款）。
  //   注意方向：只免"我打你时你的反击"，不免"你打我时我的反击"。
  //   **每队每场一次**：无限次实测会把紫晶推成结构性强族（见 §11.7），
  //   收成一次性之后它变成"要挑时机花掉的资源"。
  //   判定与 `estimateRetaliation` 必须同源，否则提示说"不会挨反击"、实际还是挨了一记。
  const wouldRetaliate = target.count > 0 && !target.retaliated;
  const bounce = wouldRetaliate && getUnit(u.unitTypeId).noRetaliate === true && !u.freeHitUsed && u.moveDist > 0;
  if (bounce) {
    // 只有"本来会挨这一下"才消耗；目标被一击打死则不消耗（那一击本来就没反击）。
    u.freeHitUsed = true;
    ev.push({ t: 'bounce', unitId: u.id, targetId: target.id });
  } else if (wouldRetaliate) {
    target.retaliated = true;
    const back = rollDamage(
      s.rng,
      getUnit(target.unitTypeId),
      target.count,
      retaliationAtkBonus(s, target),
      getUnit(u.unitTypeId),
      defBonusOf(s, u),
    );
    const k2 = applyDamage(u, back);
    ev.push({ t: 'retaliate', unitId: target.id, targetId: u.id, damage: back, killed: k2 });
    ev.push(...afterHit(u));
  }
  checkOver(s);
  return ev;
}

/**
 * 这一击会招致的反击（期望值）—— UI 提示与 AI 评分共用。
 *
 * 边界必须和 `actMelee` 的结算一字不差，否则出现"提示说 40、实际挨 60"的分裂：
 *   ① 远程不招反击（只有近战贴脸才会被回手）；
 *   ② 目标被这一击打死 ⇒ 没有反击；
 *   ③ 目标本回合已经反击过 ⇒ 不再反击；
 *   ④ 反击按**减掉这一击伤亡之后**的人数出手（`countAfterDamage`）；
 *   ⑤ 反击不吃冲锋，但**吃加班**（加班是"全军攻击力变高"，不是"这一下有加成"），
 *      所以统一走 `retaliationAtkBonus`（和 actMelee 里那行参数同源）；
 *   ⑥ 攻方这一击能触发「弹跳袭击」⇒ 恒为 0（和 actMelee 的 `noRetaliate` 判定同源：
 *      带标记 + 这次攻击前移动过 + 这场还没用过）。
 */
export function estimateRetaliation(
  s: BattleState,
  atk: BattleUnit,
  def: BattleUnit,
  ranged: boolean,
  forwardDmg: number,
  /** 这一击之前走了几格。UI 传当前值（玩家先走再点目标），AI 传它正在评估的路径长度。 */
  moveDist = atk.moveDist,
): number {
  if (ranged || def.retaliated) return 0;
  if (getUnit(atk.unitTypeId).noRetaliate === true && !atk.freeHitUsed && moveDist > 0) return 0;
  if (forwardDmg >= poolOf(def)) return 0;
  const remain = countAfterDamage(def, forwardDmg);
  if (remain <= 0) return 0;
  const du = getUnit(def.unitTypeId);
  const avg = ((du.damageMin + du.damageMax) / 2) * remain;
  const mod = damageMod(
    Math.max(0, retaliationAtkBonus(s, def)),
    getUnit(atk.unitTypeId).defense + defBonusOf(s, atk),
  );
  return Math.max(1, Math.round(avg * mod));
}

/** 挨 `dmg` 之后还剩几个 —— `applyDamage` 的只读版（预估不能改状态）。 */
function countAfterDamage(u: BattleUnit, dmg: number): number {
  const hp = getUnit(u.unitTypeId).hp;
  let d = dmg;
  let count = u.count;
  let top = u.hpTop;
  while (d > 0 && count > 0) {
    if (d >= top) {
      d -= top;
      count -= 1;
      top = hp;
    } else {
      top -= d;
      d = 0;
    }
  }
  return Math.max(0, count);
}

export function actShoot(s: BattleState, u: BattleUnit, target: BattleUnit): BattleEvent[] {
  if (!canShoot(s, u) || target.count <= 0) return [];
  const ev: BattleEvent[] = [];
  const from = { ...u.hex };
  const to = { ...target.hex };
  const blocked = shotBlocked(s, u, target);
  const longRange = distance(u.hex, target.hex) > LONG_RANGE;
  let dmg = rollDamage(
    s.rng,
    getUnit(u.unitTypeId),
    u.count,
    strikeAtkBonus(s, u, false),
    getUnit(target.unitTypeId),
    defBonusOf(s, target),
  );
  if (blocked) dmg = Math.max(1, Math.round(dmg * 0.5));
  if (longRange) dmg = Math.max(1, Math.round(dmg * 0.5));
  if (hasEffect(target, 'shield')) dmg = Math.max(1, Math.round(dmg * 0.5)); // 护盾
  dmg = Math.max(1, Math.round(dmg * accidentDamageScale(s, true))); // 反重力
  u.shots -= 1;
  const killed = applyDamage(target, dmg);
  ev.push({ t: 'shoot', unitId: u.id, targetId: target.id, damage: dmg, killed, from, to, blocked, longRange });
  ev.push(...afterHit(target));
  checkOver(s);
  return ev;
}

/**
 * 砸城防。近战要贴脸、远程要视线（城墙会挡住墙后的箭塔）。
 *
 * 城防不会反击 —— 这是刻意的：反击是"部队"的概念，
 * 让城墙反击会让攻方在破门前就被磨掉一大半，攻城变成纯粹的消耗。
 */
export function actSiege(s: BattleState, u: BattleUnit, st: SiegeStructure): BattleEvent[] {
  if (st.hp <= 0) return [];
  const ranged = !isAdjacent(u.hex, st.hex);
  const ev: BattleEvent[] = [];
  const from = { ...u.hex };
  const to = { ...st.hex };
  const au = getUnit(u.unitTypeId);
  let dmg = rollDamage(
    s.rng,
    au,
    u.count,
    s.atkBonus[u.side] + effAtkBonus(u, !ranged),
    { ...au, defense: st.defense, name: STRUCTURE_NAME[st.kind] },
    0,
  );
  if (ranged) {
    if (distance(u.hex, st.hex) > LONG_RANGE) dmg = Math.max(1, Math.round(dmg * 0.5));
    if (blocksLine(s.siege, u.hex, st.hex)) dmg = Math.max(1, Math.round(dmg * 0.5));
    u.shots -= 1;
  }
  // 箭矢砍不动石墙：只有投石车能按全额伤害轰
  dmg = Math.max(1, Math.round(dmg * UNIT_SIEGE_RESIST));
  st.hp = Math.max(0, st.hp - dmg);
  const destroyed = st.hp <= 0;
  if (destroyed && s.siege) collapseNeighbors(s.siege, st);
  ev.push({ t: 'siege', unitId: u.id, structureId: st.id, kind: st.kind, damage: dmg, destroyed, from, to });
  return ev;
}

/**
 * 回合开始时箭塔自动射击（HOMM3 的老规矩：塔不听人指挥，自己挑目标打）。
 *
 * 每座塔只打一次，目标是"当前威胁最高"的攻方部队。
 * 塔是守方的一部分，所以只有攻方的部队会被打。
 */
export function towerPhase(s: BattleState): BattleEvent[] {
  const ev: BattleEvent[] = [];
  const towers = liveShooters(s.siege);
  if (!towers.length) return ev;
  for (const tower of towers) {
    const foes = aliveOf(s, 0);
    if (!foes.length) break;
    let target = foes[0];
    let best = -Infinity;
    for (const f of foes) {
      // 优先能一发带走残血的，否则打威胁最高的
      const score = threatOf(f) + (poolOf(f) <= (tower.shotMax ?? 0) ? 400 : 0);
      if (score > best) {
        best = score;
        target = f;
      }
    }
    const du = getUnit(target.unitTypeId);
    const raw = randInt(s.rng, tower.shotMin ?? 10, tower.shotMax ?? 20);
    const mod = damageMultiplier(tower.attack ?? 5, du.defense + defBonusOf(s, target));
    const dmg = Math.max(1, Math.round(raw * mod));
    const killed = applyDamage(target, dmg);
    ev.push({ t: 'tower', structureId: tower.id, targetId: target.id, damage: dmg, killed });
    ev.push(...afterHit(target));
  }
  return ev;
}

/**
 * 攻城器械开火，和箭塔对称：每回合开始自动打，不听指挥。
 *
 * 投石车优先砸城门；城门塌了就砸**离城门最近的那一段** ——
 * HOMM3 原版是随机挑一段，但随机意味着火力被摊平，十回合也开不出口子，
 * 投石车就成了摆设。集中火力才对得起它 1500 金的造价。
 */
export function machinePhase(s: BattleState): BattleEvent[] {
  const ev: BattleEvent[] = [];
  if (!s.machines) return ev;
  for (const side of [0, 1] as const) {
    for (const id of s.machines[side]) {
      const def = WAR_MACHINES[id];
      if (!def) continue;
      if (def.target === 'fortification') ev.push(...machineHitFortification(s, side, def));
      else ev.push(...machineHitUnit(s, side, def));
    }
  }
  return ev;
}

function machineHitFortification(
  s: BattleState,
  side: 0 | 1,
  def: (typeof WAR_MACHINES)[WarMachineId],
): BattleEvent[] {
  const list = liveFortifications(s.siege);
  if (!list.length) return [];
  const gate = list.find((st) => st.kind === 'gate');
  let target = gate;
  if (!target) {
    // 城门没了：挑离正中最近的一段，让火力集中在一个口子上
    let best = Infinity;
    for (const st of list) {
      const d = Math.abs(st.hex.row - GATE_ROW);
      if (d < best) {
        best = d;
        target = st;
      }
    }
  }
  if (!target) return [];
  const raw = randInt(s.rng, def.damageMin, def.damageMax);
  const dmg = Math.max(1, Math.round(raw * damageMultiplier(def.attack, target.defense)));
  target.hp = Math.max(0, target.hp - dmg);
  const destroyed = target.hp <= 0;
  if (destroyed && s.siege) collapseNeighbors(s.siege, target);
  return [
    {
      t: 'machine',
      side,
      machine: def.id,
      structureId: target.id,
      damage: dmg,
      killed: 0,
      destroyed,
      to: target.hex,
    },
  ];
}

function machineHitUnit(
  s: BattleState,
  side: 0 | 1,
  def: (typeof WAR_MACHINES)[WarMachineId],
): BattleEvent[] {
  const foes = aliveOf(s, side === 0 ? 1 : 0);
  if (!foes.length) return [];
  let target = foes[0];
  let best = -Infinity;
  for (const f of foes) {
    // 和箭塔同一套选靶逻辑：能一发带走残血的优先，否则打威胁最高的
    const score = threatOf(f) + (poolOf(f) <= def.damageMax ? 400 : 0);
    if (score > best) {
      best = score;
      target = f;
    }
  }
  const du = getUnit(target.unitTypeId);
  const raw = randInt(s.rng, def.damageMin, def.damageMax);
  const mod = damageMultiplier(def.attack, du.defense + defBonusOf(s, target));
  const dmg = Math.max(1, Math.round(raw * mod));
  const killed = applyDamage(target, dmg);
  return [
    { t: 'machine', side, machine: def.id, targetId: target.id, damage: dmg, killed, destroyed: false, to: target.hex },
    ...afterHit(target),
  ];
}

function afterHit(target: BattleUnit): BattleEvent[] {
  if (target.count > 0) return [];
  return [{ t: 'die', unitId: target.id }];
}

export function actWait(s: BattleState, u: BattleUnit): BattleEvent[] {
  if (u.waited) return [];
  u.waited = true;
  const i = s.order.indexOf(u.id);
  if (i >= 0 && i < s.order.length - 1) {
    s.order.splice(i, 1);
    s.order.push(u.id);
    // 把自己挪到队尾，会让排在后面的单位整体前移一格，而 idx 是按位置走的：
    // 不回退指针的话，紧随其后的那个单位会被整回合跳过——
    // "食人魔站着一动不动被动挨打"的真凶（枪兵速度更快、每回合先等待，把它跳了）
    if (i <= s.idx) s.idx -= 1;
  }
  return [{ t: 'wait', unitId: u.id }];
}

export function actDefend(u: BattleUnit): BattleEvent[] {
  u.defending = true;
  return [{ t: 'defend', unitId: u.id }];
}

/* ---------------- 施法（M4） ---------------- */

/** 法术伤害（无视防御，这是 HOMM 的老规矩）。 */
function spellDamage(spellId: string, spellPower: number): number {
  const p = Math.max(1, spellPower);
  if (spellId === 'magicArrow') return 8 + 6 * p;
  if (spellId === 'iceBolt') return 15 + 9 * p;
  if (spellId === 'lightningBolt') return 20 + 8 * p;
  if (spellId === 'fireball') return 10 + 6 * p;
  return 0;
}

/** 这一侧本回合还能不能施这个法术；UI 与 AI 共用。 */
export function canCast(s: BattleState, side: 0 | 1, spellId: string): boolean {
  const c = s.casters[side];
  if (!c || s.over || s.castUsed[side]) return false;
  if (!c.spells.includes(spellId)) return false;
  return c.mana >= getSpell(spellId).manaCost;
}

/**
 * 施放一个战斗法术。目标由法术类型决定：
 *   enemy → 敌方部队 / ally → 我方（含已阵亡待复活的）/ point → 格子（火球溅射一圈）
 * 施法不占用部队行动，每回合每方 1 次，扣的是英雄的法力。
 */
export function castSpell(
  s: BattleState,
  side: 0 | 1,
  spellId: string,
  target?: BattleUnit | Hex,
): BattleEvent[] {
  if (!canCast(s, side, spellId)) return [];
  const spell = getSpell(spellId);
  if (!spell.combat) return [];
  const c = s.casters[side]!;
  const sp = Math.max(1, c.spellPower);
  const ev: BattleEvent[] = [];

  const unit = (u: unknown): BattleUnit | null => (u && typeof u === 'object' && (u as BattleUnit).unitTypeId ? (u as BattleUnit) : null);
  const tgt = unit(target);

  if (spell.target === 'enemy') {
    if (!tgt || tgt.side === side || tgt.count <= 0) return [];
  } else if (spell.target === 'ally') {
    if (!tgt || tgt.side !== side) return [];
  } else if (spell.target === 'point') {
    const h = target && !tgt ? (target as Hex) : null;
    if (!h || !inField(h)) return [];
  }

  c.mana -= spell.manaCost;
  s.castUsed[side] = true;

  switch (spellId) {
    case 'magicArrow':
    case 'iceBolt':
    case 'lightningBolt': {
      const t = tgt!;
      const dmg = spellDamage(spellId, sp);
      const killed = applyDamage(t, dmg);
      ev.push({ t: 'cast', side, spellId, targetId: t.id, hex: { ...t.hex }, damage: dmg, killed });
      ev.push(...afterHit(t));
      break;
    }
    case 'fireball': {
      const h = (target as Hex) ?? tgt!.hex;
      const dmg = spellDamage('fireball', sp);
      const area = [h, ...neighbors(h)];
      for (const cell of area) {
        const v = unitAt(s, cell);
        if (!v || v.count <= 0) continue;
        const killed = applyDamage(v, dmg);
        ev.push({ t: 'cast', side, spellId, targetId: v.id, hex: { ...cell }, damage: dmg, killed, splash: true });
        ev.push(...afterHit(v));
      }
      if (!ev.length) ev.push({ t: 'cast', side, spellId, hex: { ...h }, damage: 0, killed: 0, splash: true });
      break;
    }
    case 'bless':
    case 'curse':
    case 'haste':
    case 'slow':
    case 'shield':
    case 'stoneSkin':
    case 'bloodlust': {
      const t = tgt!;
      addEffect(t, spellId, sp);
      ev.push({ t: 'cast', side, spellId, targetId: t.id, hex: { ...t.hex } });
      break;
    }
    case 'resurrect': {
      const t = tgt!;
      const maxRevive = Math.floor(t.startCount * 0.2 * sp);
      const lost = Math.max(0, t.startCount - t.count);
      const revived = Math.min(maxRevive, lost);
      if (revived <= 0) {
        // 没人可复活就退回法力，不让玩家白白损失一回合的施法机会
        c.mana += spell.manaCost;
        s.castUsed[side] = false;
        return [];
      }
      const wasDead = t.count <= 0;
      t.count += revived;
      if (t.hpTop <= 0) t.hpTop = getUnit(t.unitTypeId).hp;
      ev.push({ t: 'cast', side, spellId, targetId: t.id, hex: { ...t.hex }, revived, wasDead });
      break;
    }
    default:
      break;
  }
  checkOver(s);
  return ev;
}

/** 撤退：战斗立即结束，攻方（side 0）认输但保住英雄。 */
export function actFlee(s: BattleState): BattleEvent[] {
  s.over = true;
  s.fled = true;
  s.winner = 1;
  return [{ t: 'end', winner: 1, fled: true }];
}

/* ---------------- AI ---------------- */

function threatOf(u: BattleUnit): number {
  return getUnit(u.unitTypeId).attack * u.count;
}

/** 目标打分：能一击杀的最优先，其次威胁最高，最后补刀残血。 */
function pickTarget(s: BattleState, u: BattleUnit, pool: BattleUnit[], ranged: boolean): BattleUnit | null {
  if (!pool.length) return null;
  let best = pool[0];
  let bestScore = -Infinity;
  for (const t of pool) {
    const dmg = estimateDamage(s, u, t, ranged);
    const poolHp = poolOf(t);
    let score = threatOf(t);
    if (dmg >= poolHp) score += 100000; // 能秒
    if (poolHp <= poolOf(u) * 0.25) score += 500; // 残血优先
    if (ranged) score += (getUnit(t.unitTypeId).hp - poolHp) * 0.5;
    // 反击改全额之后，"打谁"必须把要挨的那一下算进去：否则 AI 会拿自己的高攻部队
    // 去换一个高反击目标（尤其是打残血但没死的坦）。按"占我总血量的比例"折算，
    // 不按绝对值——同样的反击打在 20 血和 200 血的部队上代价完全不同。
    if (!ranged) {
      score -= (estimateRetaliation(s, u, t, false, dmg) / Math.max(1, poolOf(u))) * 400;
    }
    // 翠林「缠根」：同分时的偏好（打谁不是只看这一下的伤害，还看能按住谁）。
    // 权重刻意压得很小（≤ 3 分，对比威胁值 20~60 分）——它只该在"两个目标差不多"时说话。
    score += rootTargetBonus(s, u, t);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** AI 的施法判断：伤害法术优先，其次给最强部队上增益，最后给敌人挂减速。 */
function aiCast(s: BattleState, side: 0 | 1): BattleEvent[] {
  if (!canCastAny(s, side)) return [];
  const c = s.casters[side]!;
  const foes = aliveOf(s, side === 0 ? 1 : 0);
  const mine = aliveOf(s, side);

  const damageSpells = ['lightningBolt', 'iceBolt', 'magicArrow'].filter((id) => canCast(s, side, id));
  if (damageSpells.length && foes.length) {
    // 优先能一击带走的目标，否则打威胁最高的
    let best: BattleUnit | null = null;
    let bestDmg = 0;
    for (const id of damageSpells) {
      const dmg = spellDamage(id, c.spellPower);
      if (dmg > bestDmg) bestDmg = dmg;
    }
    let top = foeThreat(foes);
    for (const f of foes) if (poolOf(f) <= bestDmg) { top = f; break; }
    const pick = damageSpells.find((id) => canCast(s, side, id))!;
    best = top;
    if (best) return castSpell(s, side, pick, best);
  }

  if (mine.length && canCast(s, side, 'bless')) {
    const t = mine.slice().sort((a, b) => threatOf(b) - threatOf(a))[0];
    return castSpell(s, side, 'bless', t);
  }
  if (mine.length && canCast(s, side, 'bloodlust')) {
    const t = mine.slice().sort((a, b) => threatOf(b) - threatOf(a))[0];
    return castSpell(s, side, 'bloodlust', t);
  }
  if (foes.length && canCast(s, side, 'slow')) {
    const t = foes.slice().sort((a, b) => unitSpeed(s, b) - unitSpeed(s, a))[0];
    return castSpell(s, side, 'slow', t);
  }
  if (mine.length && canCast(s, side, 'shield')) {
    const t = mine.slice().sort((a, b) => b.count - a.count)[0];
    return castSpell(s, side, 'shield', t);
  }
  return [];
}

function canCastAny(s: BattleState, side: 0 | 1): boolean {
  const c = s.casters[side];
  return !!c && !s.over && !s.castUsed[side];
}

function foeThreat(foes: BattleUnit[]): BattleUnit {
  return foes.slice().sort((a, b) => threatOf(b) - threatOf(a))[0] ?? foes[0];
}

/* ---------------- 走位：威胁区（D1 修法，2026-10-20） ----------------
 *
 * 缺陷（`probe:sidebias` 实测）：AI 够不着时只会"走到能到的最远格"，
 * 整军镜像里 **54~95% 的不攻击推进最后都停在某个近战敌人的一步之内**。
 * 于是它这一回合只完成"走到脸前"，下一手由对方完成"走一步 + 打一下" ——
 * 先手等于白送。探针里表现为"后动方拿首次近战"（3/4 族 100%）。
 *
 * 这里把"推进"改成三档：
 *   ① 安全落点：站上去不会被任何近战敌人在它下一次行动里打到 —— 优先，且尽量少浪费步数；
 *   ② 没有安全落点：**等待**（每回合一次）—— 把行动推到本回合末尾，
 *      对方要是先动进来，就轮到我们打它；这也正是 HOMM 里"等待"的用处；
 *   ③ 等待已经用过（或本回合后面没人可等）：**在有暴露的落点里挑最不亏的**，
 *      而不是走到最远格。
 *
 * 三条边界：
 *   - 远程敌人不算进威胁区：它站多远都能射你，换落点躲不掉，算了只会让 AI 原地不动。
 *   - 判据用"敌人走到贴身还要打一下"（`unitSpeed + 1`），并且把对方的冲锋算进去
 *     （远一点反而更容易被 +2 冲进来，这个反直觉的结论必须让 AI 看得到）。
 *   - 会被一击打死的落点直接排除（除非没有别的可走）。
 *
 * 试过但**没用**的做法（别再加一遍）：给"能冲锋的落点 +8"补偿 —— 走位改完后
 * 冲锋使用率 37%→19%，可在落点评分里加偏好实测**完全无变化**：能冲锋时 AI 已经在 2 格内，
 * 落点全是 1 格，机会窗口根本不在这里。使用率下降是接战距离缩短的必然结果（记在 §11.3）。
 */

/** 这个单位是"靠走过来打人"的吗（有箭的远程不算威胁区）。 */
function isMeleeThreat(u: BattleUnit): boolean {
  const d = getUnit(u.unitTypeId);
  return d.shots === undefined || u.shots <= 0;
}

/** 站到 `h` 上、还没出手时，会被哪些敌人先打一下：预计总伤害。 */
function incomingAt(s: BattleState, u: BattleUnit, h: Hex, foes: BattleUnit[]): number {
  let dmg = 0;
  for (const f of foes) {
    if (!isMeleeThreat(f)) continue;
    const d = distance(h, f.hex);
    // 走 d−1 步贴身再打；够不到就不是威胁
    if (d - 1 > unitSpeed(s, f)) continue;
    dmg += estimateDamage(s, f, u, false, Math.max(0, d - 1));
  }
  return dmg;
}

/** 离最近敌人几格。 */
function nearestDistance(h: Hex, foes: BattleUnit[]): number {
  let d = Infinity;
  for (const f of foes) d = Math.min(d, distance(h, f.hex));
  return d;
}

/**
 * 敌方 AI 的一次完整行动。
 * 优先级：先施法 → 能射就射 → 身边有敌人就砍 → 能走过去砍就走过去砍
 *        → 否则推进到"不会白挨一下"的落点（见文件头"走位：威胁区"）。
 */
export function aiAct(s: BattleState, u: BattleUnit): BattleEvent[] {
  const ev: BattleEvent[] = [];
  const foes = aliveOf(s, u.side === 0 ? 1 : 0);
  if (!foes.length) return ev;

  if (!s.castUsed[u.side] && s.casters[u.side]) ev.push(...aiCast(s, u.side));

  const shootable = shootTargets(s, u);
  if (canShoot(s, u) && shootable.length) {
    const t = pickTarget(s, u, shootable, true);
    if (t) ev.push(...actShoot(s, u, t));
    return ev;
  }

  // 攻城：够不着人就先砸墙开门（远程砸墙、近战贴脸砸）
  if (s.siege && u.side === 0) {
    const structs = siegeTargets(s, u, canShoot(s, u));
    if (structs.length) {
      // 优先补掉已经快塌的那一段，尽快开出口子
      const st = structs.reduce((a, b) => (b.hp < a.hp ? b : a));
      ev.push(...actSiege(s, u, st));
      return ev;
    }
  }

  const adjacent = meleeTargets(s, u);
  if (adjacent.length) {
    const t = pickTarget(s, u, adjacent, false);
    if (t) ev.push(...actMelee(s, u, t));
    return ev;
  }

  // 找一个"走过去就能砍到"的落点
  const paths = reachable(s, u);
  let bestHex: Hex | null = null;
  let bestTarget: BattleUnit | null = null;
  let bestScore = -Infinity;
  for (const [k, path] of paths) {
    const [c, r] = k.split(',').map(Number);
    const h: Hex = { col: c, row: r };
    for (const f of foes) {
      if (!isAdjacent(h, f.hex)) continue;
      // 用"假定已经走了 path.length 格"算伤害：赤焰冲锋的 +2 只有算进去，
      // AI 才会为了冲起来而选更远的落点（否则它永远按原地 -1 估价）。
      const dmg = estimateDamage(s, u, f, false, path.length);
      let score = dmg + threatOf(f) * 0.5;
      if (dmg >= poolOf(f)) score += 100000;
      score -= path.length * 2; // 同等条件下少走两步
      // 走出去打也要看"能按住谁"：同一档威胁里，优先去缠那支快的（见 `rootTargetBonus`）。
      score += rootTargetBonus(s, u, f);
      // 全额反击：走过去打也要付反击成本（能一击打死就不付）——
      // 否则 AI 会为了"多走两步的冲锋"去换一个打不死的坦克，白吃一整轮反击。
      score -= (estimateRetaliation(s, u, f, false, dmg, path.length) / Math.max(1, poolOf(u))) * 400;
      if (score > bestScore) {
        bestScore = score;
        bestHex = h;
        bestTarget = f;
      }
    }
  }
  if (bestHex && bestTarget) {
    ev.push(...actMove(s, u, bestHex));
    if (isAdjacent(u.hex, bestTarget.hex) && bestTarget.count > 0) ev.push(...actMelee(s, u, bestTarget));
    return ev;
  }

  // 攻城：走过去能砸到城墙/城门也行
  if (s.siege && u.side === 0) {
    let wallHex: Hex | null = null;
    let wallTarget: SiegeStructure | null = null;
    let wallScore = -Infinity;
    for (const [k, path] of paths) {
      const [c, r] = k.split(',').map(Number);
      const h: Hex = { col: c, row: r };
      for (const st of s.siege.structures) {
        if (st.hp <= 0 || !isAdjacent(h, st.hex)) continue;
        const score = -st.hp - path.length * 3;
        if (score > wallScore) {
          wallScore = score;
          wallHex = h;
          wallTarget = st;
        }
      }
    }
    if (wallHex && wallTarget) {
      ev.push(...actMove(s, u, wallHex));
      const still = siegeTargets(s, u, false);
      if (still.length) {
        const st = still.reduce((a, b) => (b.hp < a.hp ? b : a));
        ev.push(...actSiege(s, u, st));
      }
      return ev;
    }
  }

  // 够不着：推进。先找"站上去不会立刻挨打"的落点（见文件头"威胁区"说明）。
  const dNow = nearestDistance(u.hex, foes);
  const myPool = Math.max(1, poolOf(u));
  let safeStep: Hex | null = null;
  let safeScore = -Infinity;
  let riskyStep: Hex | null = null;
  let riskyScore = -Infinity;
  for (const [k, path] of paths) {
    if (!path.length) continue;
    const [c, r] = k.split(',').map(Number);
    const h: Hex = { col: c, row: r };
    const prog = dNow - nearestDistance(h, foes);
    if (prog <= 0) continue; // 不后退：只考虑"更靠近"的格子
    const inc = incomingAt(s, u, h, foes);
    if (inc <= 0) {
      // ① 安全：同等靠近时少走两步（别为了摆姿势把移动力烧光）
      const score = prog * 10 - path.length * 0.1;
      if (score > safeScore) {
        safeScore = score;
        safeStep = h;
      }
    } else if (inc < myPool) {
      // ③ 必须交火时的备选：推进量打折后减去"要挨的那一下"
      const score = prog - (inc / myPool) * 6;
      if (score > riskyScore) {
        riskyScore = score;
        riskyStep = h;
      }
    }
    // inc >= pool：站上去就被打死，除非无处可去，否则不选
  }
  if (safeStep) {
    ev.push(...actMove(s, u, safeStep));
    return ev;
  }
  if (!u.waited && s.idx < s.order.length - 1) {
    // ② 让一手：本回合后面还有人，等一下再动；对方先动进来就是我们打它
    return actWait(s, u);
  }
  if (riskyStep) {
    ev.push(...actMove(s, u, riskyStep));
    return ev;
  }

  // 兜底：连"挨打但能推进"的格子都没有（全是一击必死），退回老逻辑朝最近的敌人挪
  let nearest = foes[0];
  let nd = Infinity;
  for (const f of foes) {
    const d = distance(u.hex, f.hex);
    if (d < nd) {
      nd = d;
      nearest = f;
    }
  }
  let bestStep: Hex | null = null;
  let bd = distance(u.hex, nearest.hex);
  for (const [k, path] of paths) {
    if (!path.length) continue;
    const [c, r] = k.split(',').map(Number);
    const h: Hex = { col: c, row: r };
    const d = distance(h, nearest.hex);
    if (d < bd || (d === bd && bestStep === null && path.length > 0)) {
      bd = d;
      bestStep = h;
    }
  }
  if (bestStep) ev.push(...actMove(s, u, bestStep));
  else if (paths.size) {
    // 被堵住时随便挪一步，避免站着不动卡住回合
    const first = [...paths.values()].find((p) => p.length === 1);
    if (first) ev.push(...actMove(s, u, first[0]));
  }
  return ev;
}

/** 双方都交给 AI，一帧跑完（「自动战斗」按钮用）。 */
export function autoResolve(s: BattleState): BattleOutcome {
  let guard = 0;
  while (!s.over && guard++ < 4000) {
    const u = currentUnit(s);
    if (!u) {
      if (checkOver(s)) break;
      startRound(s);
      continue;
    }
    aiAct(s, u);
    if (!checkOver(s)) endActivation(s);
  }
  if (!s.over) checkOver(s);
  return toOutcome(s);
}

/* ---------------- result ---------------- */

export function toOutcome(s: BattleState): BattleOutcome {
  const survivorsOf = (side: 0 | 1): Army =>
    s.units
      .filter((u) => u.side === side && u.count > 0)
      .map((u) => ({ unitTypeId: u.unitTypeId, count: u.count }));

  const lossOf = (side: 0 | 1): BattleLoss[] => {
    const start = s.startArmies[side];
    const out: BattleLoss[] = start.map((st) => ({
      unitTypeId: st.unitTypeId,
      before: st.count,
      after: 0,
    }));
    for (const u of s.units) {
      if (u.side !== side) continue;
      const row = out.find((o) => o.unitTypeId === u.unitTypeId && o.after === 0);
      if (row) row.after = u.count;
    }
    return out.filter((o) => o.before > 0);
  };

  const enemyLosses = lossOf(1);
  const expGained = enemyLosses.reduce(
    (sum, l) => sum + Math.max(0, l.before - l.after) * getUnit(l.unitTypeId).expValue,
    0,
  );

  return {
    win: s.winner === 0,
    rounds: s.round,
    losses: lossOf(0),
    enemyLosses,
    expGained,
    survivors: survivorsOf(0),
    enemySurvivors: survivorsOf(1),
    fled: s.fled || undefined,
    casterMana: s.casters[0]?.mana,
    // 战前预估也要把它带回去：事故会把胜负摆动几十个百分点，
    // 玩家必须在**按下开战之前**看到（详见 ACCIDENT_TABLE 上面那段读数）。
    accident: s.accident ?? null,
  };
}

/** 给 UI 用的一行战报。 */
export function describeEvent(s: BattleState, e: BattleEvent): string {
  const name = (id: string) => {
    const u = unitById(s, id);
    return u ? getUnit(u.unitTypeId).name : '?';
  };
  switch (e.t) {
    case 'round':
      return `第 ${e.round} 回合`;
    case 'move':
      return `${name(e.unitId)} 移动`;
    case 'melee':
      return `${name(e.unitId)} 近战命中 ${name(e.targetId)}，造成 ${e.damage} 伤害${e.killed ? `，击杀 ${e.killed}` : ''}`;
    case 'shoot':
      return (
        `${name(e.unitId)} 射击 ${name(e.targetId)}，造成 ${e.damage} 伤害` +
        (e.longRange ? '（超远距离，伤害减半）' : '') +
        (e.blocked ? '（被遮挡，伤害减半）' : '') +
        (e.killed ? `，击杀 ${e.killed}` : '')
      );
    case 'retaliate':
      return `${name(e.unitId)} 反击 ${name(e.targetId)}，造成 ${e.damage} 伤害${e.killed ? `，击杀 ${e.killed}` : ''}`;
    case 'bounce':
      return `${name(e.unitId)} 弹跳袭击，${name(e.targetId)} 来不及反击`;
    case 'root':
      return `${name(e.unitId)} 缠根：${name(e.targetId)} 速度 −${ROOT_SPEED_PENALTY}（到它下次行动）`;
    case 'machine': {
      const m = WAR_MACHINES[e.machine];
      const what = e.structureId
        ? STRUCTURE_NAME[structureById(s.siege, e.structureId)?.kind ?? 'wall']
        : name(e.targetId ?? '');
      return (
        `${m.name} 轰击${what}，造成 ${e.damage} 伤害` +
        (e.destroyed ? `，${what}崩塌！` : '') +
        (e.killed ? `，击杀 ${e.killed}` : '')
      );
    }
    case 'siege': {
      const who = STRUCTURE_NAME[e.kind];
      return (
        `${name(e.unitId)} 攻击${who}，造成 ${e.damage} 伤害` +
        (e.destroyed ? `，${who}崩塌！` : '')
      );
    }
    case 'tower': {
      const st = structureById(s.siege, e.structureId);
      return (
        `${st ? STRUCTURE_NAME[st.kind] : '箭塔'}射击 ${name(e.targetId)}，造成 ${e.damage} 伤害` +
        (e.killed ? `，击杀 ${e.killed}` : '')
      );
    }
    case 'die':
      return `${name(e.unitId)} 全灭`;
    case 'wait':
      return `${name(e.unitId)} 等待`;
    case 'defend':
      return `${name(e.unitId)} 转入防御`;
    case 'cast': {
      const sp = getSpell(e.spellId);
      const who = e.side === 0 ? '我方' : '敌方';
      const tgt = e.targetId ? name(e.targetId) : '';
      const head = `${who}施放「${sp.name}」${tgt ? ` → ${tgt}` : ''}`;
      if (e.revived) return `${head}，复活 ${e.revived}${e.wasDead ? '，部队重返战场' : ''}`;
      if (e.damage !== undefined) return `${head}，造成 ${e.damage} 伤害${e.killed ? `，击杀 ${e.killed}` : ''}`;
      return head;
    }
    case 'end':
      return e.fled ? '主动撤退，战斗结束' : e.winner === null ? '战斗陷入僵持' : e.winner === 0 ? '我方获胜' : '我方战败';
    default:
      return '';
  }
}

/* ---------------- 损失表述（原 solver 的对外接口，保留给 UI 与测试） ---------------- */

/** 把损失比例翻译成玩家看得懂的文案。 */
export function lossGrade(ratio: number): { text: string; tone: 'win' | 'loss' } {
  if (ratio <= 0) return { text: '完胜，兵不血刃', tone: 'win' };
  if (ratio < 0.15) return { text: '轻微损失', tone: 'win' };
  if (ratio < 0.4) return { text: '中等损失', tone: 'loss' };
  if (ratio < 0.7) return { text: '惨重损失', tone: 'loss' };
  return { text: '几乎全灭', tone: 'loss' };
}

/**
 * 战前公示的一行（没有事故 = 空串）。
 *
 * 为什么必须公示：三条事故会把 p4 六格的胜率摆动 19~60 个百分点（§11.10 读数），
 * 也就是说"打不打"的答案会随开战骰改变。玩家在**按下开战之前**就该看到它，
 * 否则等于用一次掷骰替玩家做决定。预估与实战同一个种子 ⇒ 同一条事故。
 */
export function accidentNotice(o: BattleOutcome): string {
  return o.accident ? `\n${accidentLabel(o.accident)}` : '';
}

/** 按血量加权的总损失比例（0~1）。 */
export function lossRatio(outcome: BattleOutcome, side: 'attacker' | 'defender' = 'attacker'): number {
  const list = side === 'attacker' ? outcome.losses : outcome.enemyLosses;
  let before = 0;
  let after = 0;
  for (const l of list) {
    const hp = getUnit(l.unitTypeId).hp;
    before += l.before * hp;
    after += l.after * hp;
  }
  if (before <= 0) return 0;
  return Math.min(1, Math.max(0, (before - after) / before));
}

/**
 * 一键结算：不开界面、不播动画，直接把这场仗打完。
 * 战前预估、「自动战斗」、以及没有走战术界面的兜底路径都走它，
 * 所以玩家看到的预估和亲手打出来的结果是同一套规则算出来的。
 */
export function quickBattle(
  attacker: BattleSide,
  defender: BattleSide,
  seed: number,
  siegeLevel = 0,
): BattleOutcome {
  return autoResolve(createBattle(attacker, defender, seed, siegeLevel));
}
