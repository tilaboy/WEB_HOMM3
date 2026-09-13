import type { UnitType } from '../types.js';
import { randInt } from '../rng.js';

/** HOMM2 风格攻防修正：每 1 点差值 ±5%，倍率封顶 0.3 ~ 3.0。 */
export function damageMultiplier(attack: number, defense: number): number {
  const mod = 1 + 0.05 * (attack - defense);
  return Math.min(Math.max(mod, 0.3), 3.0);
}

export function rollDamage(
  rng: () => number,
  attacker: UnitType,
  count: number,
  attackBonus: number,
  defender: UnitType,
  defenseBonus: number,
): number {
  const raw = randInt(rng, attacker.damageMin, attacker.damageMax) * count;
  const mod = damageMultiplier(attacker.attack + attackBonus, defender.defense + defenseBonus);
  return Math.max(1, Math.round(raw * mod));
}
