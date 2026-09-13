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
import { mulberry32 } from '../rng.js';
import { rollDamage } from './damage.js';
import { FIELD_H, FIELD_W, bfs, distance, hexEq, hexKey, hexLine, isAdjacent, type Hex } from './hex.js';

export type { Hex };

export interface BattleSide {
  army: Army;
  attack: number;
  defense: number;
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
  rng: () => number;
  log: string[];
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
  | { t: 'wait'; unitId: string }
  | { t: 'defend'; unitId: string }
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
    };
  });
}

export function createBattle(attacker: BattleSide, defender: BattleSide, seed: number): BattleState {
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
    rng: mulberry32(seed),
    log: [],
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

/** 可移动到的格子 → 路径（不含起点）。 */
export function reachable(s: BattleState, u: BattleUnit): Map<string, Hex[]> {
  const speed = Math.max(1, getUnit(u.unitTypeId).speed);
  return bfs(u.hex, speed, (h) => occupied(s, h, u.id));
}

export function canShoot(s: BattleState, u: BattleUnit): boolean {
  const def = getUnit(u.unitTypeId);
  if (def.shots === undefined || u.shots <= 0) return false;
  // HOMM 规则：被敌人贴身时不能放箭
  return !aliveOf(s, u.side === 0 ? 1 : 0).some((e) => isAdjacent(e.hex, u.hex));
}

/** 射击是否被其他单位挡住（挡住则伤害减半，这是 HOMM 的障碍射击惩罚）。 */
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
  return aliveOf(s, u.side === 0 ? 1 : 0);
}

/* ---------------- damage ---------------- */

/** 期望伤害，AI 与 UI 提示都用它。 */
export function estimateDamage(s: BattleState, atk: BattleUnit, def: BattleUnit, ranged: boolean): number {
  const au = getUnit(atk.unitTypeId);
  const du = getUnit(def.unitTypeId);
  const avg = ((au.damageMin + au.damageMax) / 2) * atk.count;
  let mod = damageMod(au.attack + s.atkBonus[atk.side], du.defense + s.defBonus[def.side] + (def.defending ? 3 : 0));
  if (ranged) {
    if (distance(atk.hex, def.hex) > LONG_RANGE) mod *= 0.5; // 远距离抛射衰减
    if (shotBlocked(s, atk, def)) mod *= 0.5; // 被自己人/敌人挡住
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
  }
  s.order = s.units
    .filter((u) => u.count > 0)
    .sort((a, b) => {
      const sa = getUnit(a.unitTypeId).speed;
      const sb = getUnit(b.unitTypeId).speed;
      return sb - sa || a.side - b.side || a.seq - b.seq;
    })
    .map((u) => u.id);
  s.idx = 0;
  s.log.push(`—— 第 ${s.round} 回合 ——`);
}

/** 结束当前单位的行动，推进行动指针。 */
export function endActivation(s: BattleState): BattleEvent[] {
  s.idx += 1;
  if (s.idx >= s.order.length) {
    if (checkOver(s)) return [{ t: 'end', winner: s.winner, fled: s.fled }];
    startRound(s);
    return [{ t: 'round', round: s.round }];
  }
  const u = currentUnit(s);
  if (!u) {
    if (checkOver(s)) return [{ t: 'end', winner: s.winner, fled: s.fled }];
    startRound(s);
    return [{ t: 'round', round: s.round }];
  }
  return [];
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
    s.atkBonus[u.side],
    getUnit(target.unitTypeId),
    s.defBonus[target.side] + (target.defending ? 3 : 0),
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
        s.atkBonus[target.side],
        getUnit(u.unitTypeId),
        s.defBonus[u.side] + (u.defending ? 3 : 0),
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
    s.atkBonus[u.side],
    getUnit(target.unitTypeId),
    s.defBonus[target.side] + (target.defending ? 3 : 0),
  );
  if (blocked) dmg = Math.max(1, Math.round(dmg * 0.5));
  if (longRange) dmg = Math.max(1, Math.round(dmg * 0.5));
  u.shots -= 1;
  const killed = applyDamage(target, dmg);
  ev.push({ t: 'shoot', unitId: u.id, targetId: target.id, damage: dmg, killed, from, to, blocked, longRange });
  ev.push(...afterHit(target));
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

/**
 * 敌方 AI 的一次完整行动。
 * 优先级：能射就射 → 身边有敌人就砍 → 能走过去砍就走过去砍 → 否则尽量靠近。
 */
export function aiAct(s: BattleState, u: BattleUnit): BattleEvent[] {
  const ev: BattleEvent[] = [];
  const foes = aliveOf(s, u.side === 0 ? 1 : 0);
  if (!foes.length) return ev;

  if (canShoot(s, u)) {
    const t = pickTarget(s, u, foes, true);
    if (t) ev.push(...actShoot(s, u, t));
    return ev;
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
    case 'die':
      return `${name(e.unitId)} 全灭`;
    case 'wait':
      return `${name(e.unitId)} 等待`;
    case 'defend':
      return `${name(e.unitId)} 转入防御`;
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
export function quickBattle(attacker: BattleSide, defender: BattleSide, seed: number): BattleOutcome {
  return autoResolve(createBattle(attacker, defender, seed));
}
