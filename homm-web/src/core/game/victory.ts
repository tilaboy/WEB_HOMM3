import type { FactionId, GameState, GameStatus, Hero, Town } from '../types.js';
import { factionIds, factionName } from '../data/factions.js';

/**
 * 胜负只用一个标准：**城池与英雄都没了就算出局**。
 * 只要还剩一座城，玩家就还能在酒馆重新招募英雄翻盘，所以不能按"英雄全灭"直接判负。
 */
export function isEliminated(state: GameState, player: FactionId): boolean {
  const hasHero = state.heroOrder.some((id) => state.heroes[id]?.owner === player);
  if (hasHero) return false;
  return !Object.values(state.towns).some((t: Town) => t.owner === player);
}

/** 阵营还剩几座城、几位英雄，用于终局结算面板。 */
export function factionStanding(
  state: GameState,
  player: FactionId,
): { towns: number; heroes: number; alive: boolean } {
  const towns = Object.values(state.towns).filter((t) => t.owner === player).length;
  const heroes = state.heroOrder.filter((id) => state.heroes[id]?.owner === player).length;
  return { towns, heroes, alive: !isEliminated(state, player) };
}

/**
 * 每次世界状态变化后调用（结束一天、战斗结束、城镇易主）。
 * 判定顺序：玩家出局 → 失败；其余阵营全部出局 → 胜利。
 */
export function evaluateOutcome(state: GameState): GameStatus {
  if (state.status !== 'playing') return state.status;
  const ids = factionIds(state);
  const enemies = ids.filter((id) => id !== 'p1');

  if (isEliminated(state, 'p1')) {
    state.status = 'lost';
    return state.status;
  }
  if (enemies.length && enemies.every((id) => isEliminated(state, id))) {
    state.status = 'won';
    return state.status;
  }
  return 'playing';
}

/** 结算面板用的一句话总结。 */
export function outcomeSummary(state: GameState): { title: string; lines: string[] } {
  const ids = factionIds(state);
  const lines = ids.map((id) => {
    const s = factionStanding(state, id);
    const you = id === 'p1' ? '（你）' : '';
    return `${factionName(id)}${you}：${s.towns} 城 · ${s.heroes} 名英雄${s.alive ? '' : ' · 已出局'}`;
  });
  if (state.status === 'won') {
    return { title: '大陆统一', lines: [...lines, `历时 ${state.day} 天，所有敌对阵营都被逐出了这片土地。`] };
  }
  return { title: '势力覆灭', lines: [...lines, '你的最后一座城与最后一位英雄都失去了。'] };
}

/** 只列出还活着的敌对方，用于日志与结算。 */
export function livingEnemies(state: GameState): FactionId[] {
  return factionIds(state).filter((id) => id !== 'p1' && !isEliminated(state, id));
}

export function heroOf(state: GameState, player: FactionId, index = 0): Hero | null {
  const ids = state.heroOrder.filter((id) => state.heroes[id]?.owner === player);
  const id = ids[index];
  return id ? state.heroes[id] : null;
}
