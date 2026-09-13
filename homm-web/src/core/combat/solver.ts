import type { Army } from '../types.js';
import { getUnit } from '../data/units.js';
import { mulberry32 } from '../rng.js';
import { rollDamage } from './damage.js';

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
}

interface S {
  side: 0 | 1;
  unitId: string;
  count: number;
  pool: number;
  shots: number;
}

const MAX_ROUNDS = 20;

/**
 * 无头战斗解算器。M1 直接用它出「预估损失」，M3 会改成产出事件流供动画消费，
 * 但核心规则保持一致，所以战斗逻辑不需要重写。
 */
export function simulateBattle(attacker: BattleSide, defender: BattleSide, seed: number): BattleOutcome {
  const rng = mulberry32(seed);
  const mk = (side: 0 | 1, army: Army): S[] =>
    army.map((s) => {
      const u = getUnit(s.unitTypeId);
      return { side, unitId: s.unitTypeId, count: s.count, pool: s.count * u.hp, shots: u.shots ?? 0 };
    });

  const a = mk(0, attacker.army);
  const d = mk(1, defender.army);
  const all = [...a, ...d];

  const alive = (side: 0 | 1) => all.filter((s) => s.side === side && s.count > 0);
  let rounds = 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    rounds = round;
    if (!alive(0).length || !alive(1).length) break;

    const order = all
      .filter((s) => s.count > 0)
      .sort((x, y) => getUnit(y.unitId).speed - getUnit(x.unitId).speed || x.side - y.side);

    const countered = new Set<S>();
    for (const s of order) {
      if (s.count <= 0) continue;
      const enemies = alive(s.side === 0 ? 1 : 0);
      if (!enemies.length) break;

      const su = getUnit(s.unitId);
      const isRanged = su.shots !== undefined && s.shots > 0;
      // 远程优先集火残血；近战优先打威胁最高的
      const target = isRanged
        ? enemies.reduce((b, e) => (e.pool < b.pool ? e : b))
        : enemies.reduce((b, e) => (getUnit(e.unitId).attack * e.count > getUnit(b.unitId).attack * b.count ? e : b));

      const tu = getUnit(target.unitId);
      const myAtk = s.side === 0 ? attacker.attack : defender.attack;
      const foeDef = s.side === 0 ? defender.defense : attacker.defense;
      const dmg = rollDamage(rng, su, s.count, myAtk, tu, foeDef);
      if (isRanged) s.shots -= 1;
      applyDamage(target, dmg);

      // 反击：每回合每支部队限一次，伤害减半
      if (target.count > 0 && !countered.has(target)) {
        countered.add(target);
        const backAtk = target.side === 0 ? attacker.attack : defender.attack;
        const backDef = target.side === 0 ? defender.defense : attacker.defense;
        const back = rollDamage(rng, tu, target.count, backAtk, su, backDef);
        applyDamage(s, Math.round(back * 0.5));
      }
      if (!alive(0).length || !alive(1).length) break;
    }
  }

  const win = alive(0).length > 0 && alive(1).length === 0;
  const survivors = (side: 0 | 1): Army =>
    all
      .filter((s) => s.side === side && s.count > 0)
      .map((s) => ({ unitTypeId: s.unitId, count: s.count }));

  const expGained = d.reduce((sum, s, i) => {
    const before = defender.army[i]?.count ?? 0;
    return sum + Math.max(0, before - s.count) * getUnit(s.unitId).expValue;
  }, 0);

  return {
    win,
    rounds,
    losses: a.map((s, i) => ({ unitTypeId: s.unitId, before: attacker.army[i]?.count ?? 0, after: s.count })),
    enemyLosses: d.map((s, i) => ({ unitTypeId: s.unitId, before: defender.army[i]?.count ?? 0, after: s.count })),
    expGained,
    survivors: survivors(0),
    enemySurvivors: survivors(1),
  };
}

function applyDamage(s: S, dmg: number): void {
  const hp = getUnit(s.unitId).hp;
  s.pool -= dmg;
  if (s.pool <= 0) {
    s.count = 0;
    s.pool = 0;
  } else {
    s.count = Math.max(1, Math.ceil(s.pool / hp));
  }
}

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
