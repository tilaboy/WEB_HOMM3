import type { GameState, Hero, HeroPrimary, PlayerId, ResourceBag } from '../types.js';
import { ARTIFACTS } from '../data/artifacts.js';
import { BASE_MOVE_POINTS } from '../map/generator.js';
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

export function maxMovePoints(hero: Hero): number {
  let m = BASE_MOVE_POINTS;
  for (const id of hero.artifacts) m += ARTIFACTS[id]?.moveBonus ?? 0;
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
