import type { FactionId, GameState, ResourceKind } from '../types.js';
import { factionIds, factionName } from '../data/factions.js';
import { addResources, dailyGoldBonus, manaMaxOf, maxMovePoints } from './hero.js';
import { applyWeeklyGrowth, mineIncome, ownedTowns, townDailyIncome } from './town.js';
import { isNewWeek } from './calendar.js';
import { pushLog } from './log.js';
import { runAiTurn } from './ai.js';
import { evaluateOutcome } from './victory.js';

export { DAYS_PER_WEEK, dayOfWeek, weekOf, isNewWeek } from './calendar.js';
export { pushLog } from './log.js';

const RESOURCE_NAME: Record<string, string> = {
  gold: '金币', wood: '木材', ore: '矿石',
  gem: '宝石', crystal: '水晶', sulfur: '硫磺', mercury: '水银',
};

export interface IncomeReport {
  townGold: number;
  mines: ResourceBag;
}

type ResourceBag = Partial<Record<ResourceKind, number>>;

/** 单一阵营的每日收入：城镇税收 + 矿场产出 + 英雄/宝物的每日金币。 */
export function collectIncome(state: GameState, player: FactionId): IncomeReport {
  const mine = mineIncome(state, player);
  const mines = { ...mine };
  for (const [k, v] of Object.entries(mine) as [ResourceKind, number][]) {
    if (v) addResources(state, player, { [k]: v } as never);
  }

  let gold = 0;
  for (const town of ownedTowns(state, player)) gold += townDailyIncome(town);
  for (const id of state.heroOrder) {
    const h = state.heroes[id];
    if (h && h.owner === player) gold += dailyGoldBonus(h);
  }
  if (gold) addResources(state, player, { gold });

  return { townGold: gold, mines };
}

/** 移动力与法力每天回满（所有阵营都一样，AI 不额外作弊）。 */
function restoreHeroes(state: GameState, player: FactionId): void {
  for (const id of state.heroOrder) {
    const h = state.heroes[id];
    if (!h || h.owner !== player) continue;
    h.movePoints = maxMovePoints(h);
    h.manaMax = manaMaxOf(h);
    h.mana = h.manaMax;
  }
}

/**
 * 结束一天。顺序是「先全员结算经济 → 再轮到电脑对手行动 → 最后判定胜负」，
 * 这样玩家点下"结束一天"时看到的税收和 AI 的动向是同一个回合里的结果。
 */
export function endDay(state: GameState): void {
  if (state.status !== 'playing') return;
  state.day += 1;

  const ids = factionIds(state);
  const parts: string[] = [];
  for (const player of ids) {
    const inc = collectIncome(state, player);
    restoreHeroes(state, player);
    const mineParts: string[] = [];
    for (const [k, v] of Object.entries(inc.mines) as [ResourceKind, number][]) {
      if (!v) continue;
      mineParts.push(`${RESOURCE_NAME[k] ?? k} +${v}`);
    }
    if (player === 'p1') {
      parts.push(`税收 +${inc.townGold}${mineParts.length ? `，矿场 ${mineParts.join('、')}` : ''}`);
    } else if (mineParts.length) {
      parts.push(`${factionName(player)} 矿场 ${mineParts.join('、')}`);
    }
  }

  if (isNewWeek(state.day)) {
    applyWeeklyGrowth(state);
    pushLog(state, `第 ${Math.floor((state.day - 1) / 7) + 1} 周开始，各城兵力增长`);
  }

  pushLog(state, `第 ${state.day} 天开始，${parts.join('；')}，移动力已恢复`);

  for (const player of ids) {
    if (player === 'p1') continue;
    if (!state.players[player]?.isHuman) runAiTurn(state, player);
  }

  evaluateOutcome(state);
}
