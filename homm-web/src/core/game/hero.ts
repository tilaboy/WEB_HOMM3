import type { Army, GameState, Hero, HeroPrimary, PlayerId, ResourceBag } from '../types.js';
import { ARTIFACTS } from '../data/artifacts.js';
import { getUnit } from '../data/units.js';
import { BASE_MOVE_POINTS } from '../map/generator.js';
import { DIFFICULTIES } from '../data/factions.js';
import { deriveSeed, mulberry32 } from '../rng.js';

export function effectivePrimary(hero: Hero): HeroPrimary {
  const p: HeroPrimary = { ...hero.primary };
  for (const id of hero.artifacts) {
    const m = ARTIFACTS[id]?.mods;
    if (!m) continue;
    p.attack += m.attack ?? 0;
    p.defense += m.defense ?? 0;
    p.spellPower += m.spellPower ?? 0;
    p.knowledge += m.knowledge ?? 0;
  }
  return p;
}

/**
 * 英雄每日移动力上限（含宝物加成）。
 *
 * 传入 `state` 时，若英雄属于玩家（p1）则再乘难度的 `playerMoveMul`，
 * 这样困难档玩家被罚移动力，且**无论新招还是老英雄、无论开局还是每日刷新都走同一处**，
 * 不会被"反复招新英雄"绕过（见 town.ts 的 hireHero 与 turn.ts 的每日刷新）。
 * 缺省 `state` 时不缩放（UI 预览等无需状态的场景安全退化）。
 */
export function maxMovePoints(hero: Hero, state?: GameState): number {
  let m = BASE_MOVE_POINTS;
  for (const id of hero.artifacts) m += ARTIFACTS[id]?.moveBonus ?? 0;
  if (state && hero.owner === 'p1') {
    const diff = DIFFICULTIES[state.config?.difficulty ?? 'normal'];
    m = Math.round(m * (diff.playerMoveMul ?? 1));
  }
  return m;
}

/** 法力上限 = 有效知识 × 10（含宝物加成）。 */
export function manaMaxOf(hero: Hero): number {
  return effectivePrimary(hero).knowledge * 10;
}

export function dailyGoldBonus(hero: Hero): number {
  let g = 0;
  for (const id of hero.artifacts) g += ARTIFACTS[id]?.dailyGold ?? 0;
  return g;
}

/** 升到下一级所需经验（本级到下一级之间的跨度）。 */
export function expToNext(level: number): number {
  return Math.round(100 * Math.pow(level, 1.8));
}

function levelUp(hero: Hero, seed: number): string {
  const rng = mulberry32(seed);
  const r = rng();
  if (r < 0.4) {
    hero.primary.attack += 1;
    return '攻击 +1';
  }
  if (r < 0.8) {
    hero.primary.defense += 1;
    return '防御 +1';
  }
  if (r < 0.9) {
    hero.primary.spellPower += 1;
    return '魔力 +1';
  }
  hero.primary.knowledge += 1;
  return '知识 +1';
}

export function gainExp(state: GameState, hero: Hero, amount: number): string[] {
  hero.exp += amount;
  const notes: string[] = [];
  let guard = 0;
  while (hero.exp >= expToNext(hero.level) && guard++ < 50) {
    hero.exp -= expToNext(hero.level);
    hero.level += 1;
    notes.push(levelUp(hero, deriveSeed(state.seed, hero.level, hero.exp, state.day)));
  }
  return notes;
}

export function addResources(state: GameState, player: PlayerId, bag: ResourceBag): void {
  const p = state.players[player];
  if (!p) return;
  for (const [k, v] of Object.entries(bag) as [keyof ResourceBag, number][]) {
    if (!v) continue;
    p.resources[k] = (p.resources[k] ?? 0) + v;
  }
}

export function armySize(hero: Hero): number {
  return hero.army.reduce((s, st) => s + st.count, 0);
}

/** 部队总血量，用作"这支部队有多强"的粗略度量（AI 决策与驻军评估共用）。 */
export function armyHp(army: Army): number {
  return army.reduce((s, st) => s + (st.count > 0 ? st.count * getUnit(st.unitTypeId).hp : 0), 0);
}

/** 英雄的战斗力：血量 × 四维带来的粗略加成，只用于比较大小。 */
export function heroPower(hero: Hero): number {
  const p = effectivePrimary(hero);
  return armyHp(hero.army) * (1 + (p.attack + p.defense) * 0.03);
}
