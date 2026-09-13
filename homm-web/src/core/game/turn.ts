import type { GameState, ResourceKind } from '../types.js';
import { addResources, dailyGoldBonus, maxMovePoints } from './hero.js';
import { applyWeeklyGrowth, mineIncome, ownedTowns, townDailyIncome } from './town.js';
import { isNewWeek } from './calendar.js';
import { pushLog } from './log.js';

export { DAYS_PER_WEEK, dayOfWeek, weekOf, isNewWeek } from './calendar.js';
export { pushLog } from './log.js';

const RESOURCE_NAME: Record<string, string> = {
  gold: '金币', wood: '木材', ore: '矿石',
};

export function endDay(state: GameState): void {
  state.day += 1;

  // 城镇税收
  let townGold = 0;
  for (const town of ownedTowns(state, 'p1')) townGold += townDailyIncome(town);

  // 英雄移动力恢复 + 宝物每日收益
  let gold = townGold;
  for (const id of state.heroOrder) {
    const h = state.heroes[id];
    if (!h) continue;
    h.movePoints = maxMovePoints(h);
    gold += dailyGoldBonus(h);
  }
  if (gold > 0) addResources(state, 'p1', { gold });

  // 矿场产出（野怪守着的矿打赢后归你）
  const mine = mineIncome(state, 'p1');
  const mineParts: string[] = [];
  for (const [k, v] of Object.entries(mine) as [ResourceKind, number][]) {
    if (!v) continue;
    addResources(state, 'p1', { [k]: v } as never);
    mineParts.push(`${RESOURCE_NAME[k] ?? k} +${v}`);
  }

  if (isNewWeek(state.day)) {
    applyWeeklyGrowth(state);
    pushLog(state, `第 ${Math.floor((state.day - 1) / 7) + 1} 周开始，各城兵力增长`);
  }

  pushLog(
    state,
    `第 ${state.day} 天开始，税收 +${townGold}${mineParts.length ? `，矿场 ${mineParts.join('、')}` : ''}，移动力已恢复`,
  );
}
