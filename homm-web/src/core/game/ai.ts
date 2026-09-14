import type { Army, FactionId, GameState, GridPos, GuardReward, Hero } from '../types.js';
import { DIFFICULTIES, factionName } from '../data/factions.js';
import { BUILDINGS } from '../data/buildings.js';
import { MARKET_BUY_AMOUNT, MARKET_BUY_GOLD } from './town.js';
import { getUnit } from '../data/units.js';
import { mulberry32, deriveSeed, shuffle } from '../rng.js';
import { idx } from '../map/grid.js';
import { buildPath, computePaths, stepCost } from '../map/pathfinding.js';
import { revealAround, isRevealed } from '../map/fog.js';
import { HERO_SIGHT } from '../map/generator.js';
import { quickBattle } from '../combat/battle.js';
import {
  applyHeroBattle,
  applyInteraction,
  enemyHeroAt,
  heroBattleSetup,
  pendingObjectAt,
  previewInteraction,
} from './interaction.js';
import { heroPower, manaMaxOf } from './hero.js';
import {
  build,
  canBuildToday,
  canHireHero,
  garrisonStrength,
  guildLevel,
  hireHero,
  ownedTowns,
  recruitToGarrison,
  recruitToHero,
  teachGuildSpells,
  townDefenseBonus,
} from './town.js';
import { pushLog } from './log.js';

/**
 * 电脑对手（"影子领主"）。设计目标不是聪明，而是**可信**：
 *   - 不作弊：收入、建造、征兵、移动全部走和玩家同一套规则与函数；
 *   - 每个动作都写日志，玩家能复盘 AI 这一天干了什么；
 *   - 不送兵：打不赢的守卫/城镇/英雄一律绕开。
 * 难度只影响起始资源、周增长（见 town.ts）与出兵门槛。
 */

/**
 * 建造顺序：先把 3 级兵营和市场拿到手，再考虑高级兵与经济/防御。
 * 市场必须排在高阶兵营前面——木/矿只有矿场能产，而矿场基本被中档以上的野怪守着，
 * 不先开市场换资源，AI 会一路卡在 dwell4 的 10 木上（实测过，这是最容易踩的坑）。
 */
const BUILD_ORDER = [
  'dwell3', 'market', 'wall1', 'dwell4', 'guild1', 'townhall', 'dwell5', 'guild2', 'wall2', 'wall3', 'guild3',
];

/** 出兵门槛：起始 20 弓手 = 200 血。aggression 越低越早出门。 */
const BASE_COMMIT = 200;

interface Candidate {
  pos: GridPos;
  score: number;
  kind: 'town' | 'monster' | 'loot' | 'home';
}

function strengthOfTier(tier: string): number {
  return tier === 'strong' ? 3 : tier === 'mid' ? 2 : 1;
}

/** 把守卫奖励折算成一个"值不值得打"的分值。 */
function guardValue(guard: GuardReward | undefined): number {
  if (!guard) return 0;
  switch (guard.kind) {
    case 'gold':
      return Math.min(260, guard.amount / 25);
    case 'resource':
      return 60 + guard.amount * 6;
    case 'artifact':
      return 220;
    case 'mine':
      return 300 + guard.perDay * 0.6;
    default:
      return 0;
  }
}

function heroesOf(state: GameState, player: FactionId): Hero[] {
  return state.heroOrder
    .map((id) => state.heroes[id])
    .filter((h): h is Hero => !!h && h.owner === player);
}

function armyTop(army: Army): string {
  if (!army.length) return '（空）';
  return army
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .map((s) => `${getUnit(s.unitTypeId).name} ×${s.count}`)
    .join('、');
}

/* ---------------- 1. 建造 ---------------- */

function aiBuild(state: GameState, player: FactionId, rng: () => number): void {
  for (const town of ownedTowns(state, player)) {
    if (!canBuildToday(state, town)) continue;
    let built = false;
    for (const id of BUILD_ORDER) {
      if (town.buildings.includes(id)) continue;
      const def = BUILDINGS[id];
      if (!def) continue;
      if (!def.requires.every((r) => town.buildings.includes(r))) continue;
      if (build(state, town, id, player)) {
        built = true;
        break;
      }
    }
    // 主顺序里再也没有能建的了，就随机补一座（免得后期资源堆着不用）
    if (!built && rng() < 0.3) {
      const rest = Object.keys(BUILDINGS).filter((id) => !town.buildings.includes(id));
      for (const id of shuffle(rng, rest)) {
        if (build(state, town, id, player)) break;
      }
    }
  }
}

/* ---------------- 2. 征兵 ---------------- */

/**
 * 有市场就换资源。
 * 木/矿除了矿场没有别的来源，而矿场大多被中档以上的野怪守着，
 * 所以"缺木就买"是电脑对手能不能持续发育的分水岭——没有这一步，AI 会一直卡在 dwell3。
 */
function aiTrade(state: GameState, player: FactionId): void {
  const market = ownedTowns(state, player).find((t) => t.buildings.includes('market'));
  if (!market) return;
  const bag = state.players[player]?.resources;
  if (!bag) return;
  let bought = 0;
  while ((bag.gold ?? 0) >= 4000 && bought < 3) {
    const wood = bag.wood ?? 0;
    const ore = bag.ore ?? 0;
    if (wood >= 25 && ore >= 25) break;
    const res = wood <= ore ? 'wood' : 'ore';
    bag.gold = (bag.gold ?? 0) - MARKET_BUY_GOLD;
    bag[res] = (bag[res] ?? 0) + MARKET_BUY_AMOUNT;
    bought += 1;
  }
}

function aiRecruit(state: GameState, player: FactionId): void {
  const heroes = heroesOf(state, player);
  for (const town of ownedTowns(state, player)) {
    const inTown = heroes.find((h) => h.pos.x === town.pos.x && h.pos.y === town.pos.y) ?? null;
    for (const unitTypeId of Object.keys(town.growthPool)) {
      let guard = 0;
      while ((town.growthPool[unitTypeId] ?? 0) > 0 && guard++ < 40) {
        const left = town.growthPool[unitTypeId] ?? 0;
        const res = inTown
          ? recruitToHero(state, town, inTown, unitTypeId, left)
          : recruitToGarrison(state, town, unitTypeId, left);
        if (res.taken <= 0) break;
      }
    }
  }
}

/* ---------------- 3. 目标选择 ---------------- */

function pickTarget(state: GameState, hero: Hero, player: FactionId): Candidate | null {
  const field = computePaths(state, hero.pos, Infinity);
  const m = state.map;
  const power = heroPower(hero);
  const diff = DIFFICULTIES[state.config?.difficulty ?? 'normal'];
  const commit = BASE_COMMIT * diff.aggression;
  const candidates: Candidate[] = [];

  const costAt = (p: GridPos): number => {
    if (p.x < 0 || p.y < 0 || p.x >= m.width || p.y >= m.height) return Infinity;
    return field.cost[idx(m, p.x, p.y)];
  };
  /** 电脑对手只能针对自己"见过"的东西：不透视迷雾，是难度之外最基本的公平。 */
  const seen = (p: GridPos): boolean => isRevealed(state, player, p.x, p.y);

  for (const obj of Object.values(m.objects)) {
    if (obj.kind === 'obstacle') continue;
    if (!seen(obj.pos)) continue;
    const cost = costAt(obj.pos);
    if (!isFinite(cost) || cost <= 0) continue;
    const travelPenalty = cost * 0.06;

    if (obj.kind === 'town') {
      const town = state.towns[(obj.payload as { townId: string }).townId];
      if (!town || town.owner === player) continue;
      const need = garrisonStrength(town.garrison) + townDefenseBonus(town) * 12;
      const odds = power / Math.max(60, need * 1.15);
      if (odds < 0.85) continue; // 打不过就别去
      const value = town.owner === 'neutral' ? 620 : 760;
      candidates.push({
        pos: obj.pos, kind: 'town',
        score: value * Math.min(1.6, odds) - travelPenalty,
      });
      continue;
    }

    if (obj.kind === 'wanderingMonster') {
      const payload = obj.payload as { army: Army; tier: string; guard?: GuardReward };
      const preview = previewInteraction(state, hero.id, obj.id);
      if (!preview?.estimate?.win) continue; // 打不赢的守卫直接不考虑
      const lost = preview.estimate.losses.reduce((s, l) => s + (l.before - l.after), 0);
      const total = preview.estimate.losses.reduce((s, l) => s + l.before, 0);
      if (total > 0 && lost / total > 0.7) continue; // 惨胜不值当
      const value = 240 + guardValue(payload.guard) + strengthOfTier(payload.tier) * 40;
      candidates.push({ pos: obj.pos, kind: 'monster', score: value - travelPenalty });
      continue;
    }

    const value =
      obj.kind === 'artifact' ? 200
      : obj.kind === 'treasureChest' ? 170
      : obj.kind === 'resourcePile' ? ((obj.payload as { resource: string }).resource === 'gold' ? 130 : 100)
      : obj.kind === 'fountain' ? 40
      : 0;
    if (!value) continue;
    candidates.push({ pos: obj.pos, kind: 'loot', score: value - travelPenalty });
  }

  // 敌方英雄：兵力压得过、而且见过，才考虑
  for (const id of state.heroOrder) {
    const foe = state.heroes[id];
    if (!foe || foe.owner === player) continue;
    if (!seen(foe.pos)) continue;
    const cost = costAt(foe.pos);
    if (!isFinite(cost) || cost <= 0) continue;
    const odds = power / Math.max(60, heroPower(foe));
    if (odds < 1.15) continue;
    candidates.push({ pos: foe.pos, kind: 'monster', score: 820 * Math.min(1.5, odds) - cost * 0.05 });
  }

  // 探索：迷雾边缘的格子才是开局唯一"看得见"的目标。
  // 越往外给分越高，AI 才会真的向外扩张，而不是在自家门口转圈。
  const home = ownedTowns(state, player)[0];
  if (home) {
    const frontier: GridPos[] = [];
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        if (!isRevealed(state, player, x, y)) continue;
        let edge = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
          if (!isRevealed(state, player, nx, ny)) {
            edge = true;
            break;
          }
        }
        if (edge) frontier.push({ x, y });
      }
    }
    // 只取离主城最远的若干处，够用且不会让候选列表爆炸
    frontier.sort(
      (a, b) =>
        Math.abs(b.x - home.pos.x) + Math.abs(b.y - home.pos.y) -
        (Math.abs(a.x - home.pos.x) + Math.abs(a.y - home.pos.y)),
    );
    for (const p of frontier.slice(0, 40)) {
      const cost = costAt(p);
      if (!isFinite(cost) || cost <= 0) continue;
      const outward = Math.abs(p.x - home.pos.x) + Math.abs(p.y - home.pos.y);
      candidates.push({
        pos: p, kind: 'loot',
        score: 90 + outward * 3 * (1.2 - diff.aggression * 0.3) - cost * 0.03,
      });
    }
  }

  // 回城补给：增长池攒着兵、或部队打残了就回家
  const homes = ownedTowns(state, player);
  const pool = homes.reduce((s, t) => s + Object.values(t.growthPool).reduce((a, b) => a + b, 0), 0);
  const wounded = power < commit * 0.6;
  if (pool > 0 || wounded) {
    for (const town of homes) {
      const cost = costAt(town.pos);
      if (!isFinite(cost) || cost <= 0) continue; // 到不了 / 已经在家
      const pull = Math.min(120, pool * 22) + (wounded ? 400 : 0);
      candidates.push({ pos: town.pos, kind: 'home', score: pull - cost * 0.03 });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

/* ---------------- 4. 移动与结算 ---------------- */

function aiMarch(state: GameState, hero: Hero, target: GridPos): void {
  const player = hero.owner as FactionId;
  const field = computePaths(state, hero.pos, Infinity);
  const path = buildPath(state, field, hero.pos, target);

  for (const step of path) {
    const cost = stepCost(state, hero.pos, step);
    if (!isFinite(cost) || cost > hero.movePoints) return;

    // 敌方英雄挡路：改成打遭遇战
    const foe = enemyHeroAt(state, step.x, step.y, player);
    if (foe) {
      aiFightHero(state, hero, foe);
      return;
    }

    // 目的地上有东西：先判断打不打得过，打不过就原地不动
    const objId = state.map.tiles[idx(state.map, step.x, step.y)].objectId;
    if (objId) {
      const obj = state.map.objects[objId];
      if (obj?.blocking) return;
      if (obj) {
        const preview = previewInteraction(state, hero.id, objId);
        if ((preview?.kind === 'battle' || preview?.kind === 'siege') && !preview.estimate?.win) return;
      }
    }

    hero.pos = { x: step.x, y: step.y };
    hero.movePoints -= cost;
    revealAround(state, player, hero.pos, HERO_SIGHT);

    const arrived = pendingObjectAt(state, hero.id);
    if (!arrived) continue;
    const preview = previewInteraction(state, hero.id, arrived.id);
    if (preview?.kind === 'info') continue; // 只是看了眼说明，继续走

    const stops = arrived.kind === 'wanderingMonster' || arrived.kind === 'town';
    const res = applyInteraction(state, hero.id, arrived.id, true);
    if (res.heroDefeated) return;
    if (res.title) pushLog(state, `${hero.name}：${res.message.split('\n')[0]}`);
    if (stops) return; // 大事件（战斗/攻城）之后今日收工
  }
}

/** AI 主动打敌方英雄：无头结算，结果写回世界。 */
function aiFightHero(state: GameState, attacker: Hero, defender: Hero): void {
  const odds = heroPower(attacker) / Math.max(60, heroPower(defender));
  if (odds < 1.05) return; // 打不赢就绕开，等下次
  const setup = heroBattleSetup(state, attacker.id, defender.id);
  if (!setup) return;
  const outcome = quickBattle(setup.attacker, setup.defender, setup.seed);
  const res = applyHeroBattle(state, attacker.id, defender.id, outcome);
  if (res.title) pushLog(state, `${attacker.name}：${res.title}`);
}

/* ---------------- 5. 扩编 ---------------- */

/** 城多将少时补一位英雄，让 AI 能同时经营两个方向；手里没将时无条件补。 */
function maybeHireHero(state: GameState, player: FactionId): void {
  const towns = ownedTowns(state, player);
  if (!towns.length) return;
  const heroes = heroesOf(state, player);
  const desperate = heroes.length === 0;
  if (!desperate && towns.length <= heroes.length) return;
  const gold = state.players[player]?.resources.gold ?? 0;
  if (gold < (desperate ? 2500 : 6000)) return;
  for (const town of towns) {
    if (!canHireHero(state, town).ok) continue;
    const hired = hireHero(state, town);
    if (hired) {
      pushLog(state, `${factionName(player)} 在 ${town.name} 招募了新英雄 ${hired.name}`);
      return;
    }
  }
}

/* ---------------- 每日入口 ---------------- */

export function runAiTurn(state: GameState, player: FactionId): void {
  if (state.status !== 'playing') return;
  if (state.players[player]?.isHuman !== false) return;

  const rng = mulberry32(deriveSeed(state.seed, state.day, player.charCodeAt(1) * 7919));

  aiBuild(state, player, rng);
  aiTrade(state, player);
  aiBuild(state, player, rng);
  aiRecruit(state, player);

  for (const hero of heroesOf(state, player)) {
    if (state.status !== 'playing') break;
    const target = pickTarget(state, hero, player);
    if (!target) continue;
    const before = { x: hero.pos.x, y: hero.pos.y };
    aiMarch(state, hero, target.pos);

    // 站到自家城镇上：学法术 + 把增长池里的兵补进队伍
    const town = ownedTowns(state, player).find((t) => t.pos.x === hero.pos.x && t.pos.y === hero.pos.y);
    if (town) {
      if (guildLevel(town) > 0) teachGuildSpells(state, hero, town);
      for (const unitTypeId of Object.keys(town.growthPool)) {
        recruitToHero(state, town, hero, unitTypeId, town.growthPool[unitTypeId] ?? 0);
      }
      hero.manaMax = manaMaxOf(hero);
      hero.mana = hero.manaMax;
    }

    if (before.x !== hero.pos.x || before.y !== hero.pos.y) {
      pushLog(
        state,
        `${factionName(player)} · ${hero.name} 从 (${before.x},${before.y}) 移动到 (${hero.pos.x},${hero.pos.y})，部队 ${armyTop(hero.army)}`,
      );
    }
  }

  maybeHireHero(state, player);
}
