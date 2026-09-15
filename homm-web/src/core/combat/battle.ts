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
import type { Army } from '../types.js';
import { getUnit } from '../data/units.js';
import { getSpell } from '../data/spells.js';
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
  blocksLine,
  collapseNeighbors,
  blocksMove,
  createSiege,
  isMoat,
  liveTowers,
  structureById,
  type SiegeState,
  type SiegeStructure,
} from './siege.js';

export type { Hex };
export type { SiegeState, SiegeStructure };
export { MOAT_DEFENSE_PENALTY, STRUCTURE_NAME } from './siege.js';

export interface BattleSide {
  army: Army;
  attack: number;
  defense: number;
  /** 施法者（英雄）。野怪没有，中立城守军也没有。 */
  caster?: BattleCaster;
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
  waited: boolean;
  defending: boolean;
  /** 本回合是否已移动过（HOMM：一回合可"移动 + 攻击"，但不能移动两次）。 */
  moved: boolean;
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
  over: boolean;
  winner: 0 | 1 | null;
  fled: boolean;
  startArmies: [Army, Army];
  /** 两侧的施法者（英雄）。null = 这一侧不会施法。 */
  casters: [BattleCaster | null, BattleCaster | null];
  /** 本回合双方各可施法 1 次。 */
  castUsed: [boolean, boolean];
  rng: () => number;
  log: string[];
  /** 攻城结构（城墙 / 城门 / 箭塔）。没有城墙的战斗是 null。 */
  siege?: SiegeState | null;
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
  | { t: 'die'; unitId: string }
  /** 砸城墙 / 城门 / 箭塔。 */
  | {
      t: 'siege';
      unitId: string;
      structureId: string;
      kind: 'wall' | 'gate' | 'tower';
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
  return live.map((s, i) => {
    const u = getUnit(s.unitTypeId);
    return {
      id: `u${side}_${i}`,
      side,
      unitTypeId: s.unitTypeId,
      count: s.count,
      hpTop: u.hp,
      shots: u.shots ?? 0,
      hex: { col, row: Math.round(((i + 0.5) * FIELD_H) / Math.max(1, live.length)) },
      retaliated: false,
      waited: false,
      defending: false,
      moved: false,
      seq: seqBase + i,
      startCount: s.count,
      effects: [],
    };
  });
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
    log: [],
    siege: createSiege(siegeLevel),
  };
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
  return s.defBonus[u.side] + effDefBonus(u) + (u.defending ? 3 : 0) - moatPenalty(s, u);
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

/** 实际速度（加速 +2 / 减速 -2，下限 1）。 */
export function unitSpeed(_s: BattleState, u: BattleUnit): number {
  let v = getUnit(u.unitTypeId).speed;
  if (hasEffect(u, 'haste')) v += 2;
  if (hasEffect(u, 'slow')) v -= 2;
  return Math.max(1, v);
}

/* ---------------- damage ---------------- */

/** 期望伤害，AI 与 UI 提示都用它。 */
export function estimateDamage(s: BattleState, atk: BattleUnit, def: BattleUnit, ranged: boolean): number {
  const au = getUnit(atk.unitTypeId);
  const du = getUnit(def.unitTypeId);
  const avg = ((au.damageMin + au.damageMax) / 2) * atk.count;
  let mod = damageMod(
    Math.max(0, au.attack + s.atkBonus[atk.side] + effAtkBonus(atk, !ranged)),
    du.defense + defBonusOf(s, def),
  );
  if (ranged) {
    if (distance(atk.hex, def.hex) > LONG_RANGE) mod *= 0.5; // 远距离抛射衰减
    if (shotBlocked(s, atk, def)) mod *= 0.5; // 被自己人/敌人挡住
    if (hasEffect(def, 'shield')) mod *= 0.5; // 护盾
  }
  return Math.max(1, Math.round(avg * mod));
}

/**
 * 砸城防的期望伤害，UI 提示与 AI 决策共用。
 * 城防没有血量池概念，只有 hp，所以这里直接按"攻击力 vs 结构防御"算倍率。
 */
export function estimateSiegeDamage(s: BattleState, u: BattleUnit, st: SiegeStructure, ranged: boolean): number {
  const au = getUnit(u.unitTypeId);
  const avg = ((au.damageMin + au.damageMax) / 2) * u.count;
  let mod = damageMod(Math.max(0, au.attack + s.atkBonus[u.side] + effAtkBonus(u, !ranged)), st.defense);
  if (ranged) {
    if (distance(u.hex, st.hex) > LONG_RANGE) mod *= 0.5;
    if (blocksLine(s.siege, u.hex, st.hex)) mod *= 0.5;
  }
  return Math.max(1, Math.round(avg * mod));
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
    // 法术时效：进入新回合扣 1 轮，归零则消失
    u.effects = u.effects.filter((e) => {
      e.rounds -= 1;
      return e.rounds > 0;
    });
  }
  s.castUsed = [false, false];
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
    s.atkBonus[u.side] + effAtkBonus(u, true),
    getUnit(target.unitTypeId),
    defBonusOf(s, target),
  );
  const killed = applyDamage(target, dmg);
  ev.push({ t: 'melee', unitId: u.id, targetId: target.id, damage: dmg, killed, from, to });
  ev.push(...afterHit(target));

  // 反击：每回合每支部队限一次，伤害减半
  if (target.count > 0 && !target.retaliated) {
    target.retaliated = true;
    const back = Math.round(
      rollDamage(
        s.rng,
        getUnit(target.unitTypeId),
        target.count,
        s.atkBonus[target.side] + effAtkBonus(target, true),
        getUnit(u.unitTypeId),
        defBonusOf(s, u),
      ) * 0.5,
    );
    const k2 = applyDamage(u, back);
    ev.push({ t: 'retaliate', unitId: target.id, targetId: u.id, damage: back, killed: k2 });
    ev.push(...afterHit(u));
  }
  return ev;
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
    s.atkBonus[u.side] + effAtkBonus(u, false),
    getUnit(target.unitTypeId),
    defBonusOf(s, target),
  );
  if (blocked) dmg = Math.max(1, Math.round(dmg * 0.5));
  if (longRange) dmg = Math.max(1, Math.round(dmg * 0.5));
  if (hasEffect(target, 'shield')) dmg = Math.max(1, Math.round(dmg * 0.5)); // 护盾
  u.shots -= 1;
  const killed = applyDamage(target, dmg);
  ev.push({ t: 'shoot', unitId: u.id, targetId: target.id, damage: dmg, killed, from, to, blocked, longRange });
  ev.push(...afterHit(target));
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
  const towers = liveTowers(s.siege);
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

function afterHit(target: BattleUnit): BattleEvent[] {
  if (target.count > 0) return [];
  return [{ t: 'die', unitId: target.id }];
}

export function actWait(s: BattleState, u: BattleUnit): BattleEvent[] {
  if (u.waited) return [];
  u.waited = true;
  const i = s.order.indexOf(u.id);
  if (i >= 0) {
    s.order.splice(i, 1);
    s.order.push(u.id);
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

/**
 * 敌方 AI 的一次完整行动。
 * 优先级：先施法 → 能射就射 → 身边有敌人就砍 → 能走过去砍就走过去砍 → 否则尽量靠近。
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
      const dmg = estimateDamage(s, u, f, false);
      let score = dmg + threatOf(f) * 0.5;
      if (dmg >= poolOf(f)) score += 100000;
      score -= path.length * 2; // 同等条件下少走两步
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

  // 够不着：朝最近的敌人推进
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
