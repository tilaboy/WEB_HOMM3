import type { FactionId, GameState, GameStatus, Hero, Town } from '../types.js';
import { factionIds, factionName } from '../data/factions.js';
import { pushLog } from './log.js';
import { removeHero } from './interaction.js';

/**
 * 无城宽限期：电脑对手连续这么多天一座城都没有，就判它出局。
 *
 * 为什么需要这条：`isEliminated` 的老定义是"英雄和城都没了才算出局"，
 * 而一个**有英雄、没城**的阵营不是出局 —— 它没有收入、没有回城点，
 * `pickTarget` 的探索边界与回城补给又都以 `ownedTowns[0]` 为锚，于是它
 * 会带着一个空壳英雄在地图上永远游荡、什么也不建（实测修复"驻军→英雄"通道后，
 * 36 局里有 6 局落到这个状态）。
 *
 * 给 7 天而不是立刻出局：AI 之间互殴时丢掉最后一座城是正常战况，
 * 它应该还有机会夺回一座城翻盘；7 天足够跑一趟来回，又不至于让玩家
 * 对着一具僵尸空耗几十回合。玩家（p1）不吃这条规则。
 */
export const NO_TOWN_GRACE_DAYS = 7;

function ownsTown(state: GameState, player: FactionId): boolean {
  return Object.values(state.towns).some((t: Town) => t.owner === player);
}

/** 阵营当前的无城天数（旧存档没有这个字段，按 0 算）。 */
export function noTownDaysOf(state: GameState, player: FactionId): number {
  return state.players[player]?.noTownDays ?? 0;
}

/**
 * 胜负只用一个标准：**城池与英雄都没了就算出局**。
 * 只要还剩一座城，玩家就还能在酒馆重新招募英雄翻盘，所以不能按"英雄全灭"直接判负。
 *
 * 电脑对手另加一条无城宽限期（见 NO_TOWN_GRACE_DAYS）：撑满就出局，
 * 即使手里还攥着英雄。这是整个"出局"概念唯一的真相来源 ——
 * `factionStanding` / `livingEnemies` / `evaluateOutcome` 都走这里，所以它们自动跟着变。
 */
export function isEliminated(state: GameState, player: FactionId): boolean {
  const hasTown = ownsTown(state, player);
  // 玩家不吃无城规则：人类漫无目的地流浪是一种正当的打法
  if (player !== 'p1' && !hasTown && noTownDaysOf(state, player) >= NO_TOWN_GRACE_DAYS) {
    return true;
  }
  const hasHero = state.heroOrder.some((id) => state.heroes[id]?.owner === player);
  if (hasHero) return false;
  return !hasTown;
}

/**
 * 推进所有电脑阵营的"无城天数"。**每天只能在 endDay 里调一次。**
 *
 * 为什么不放在 `evaluateOutcome` 里：那个函数一天可能被调用多次
 * （结束一天、战斗结束、城镇易主都会调），放在那儿会把天数算多。
 *
 * 返回值 = 本次刚好撑满宽限期的阵营，交给调用方去做出局处置
 * （日志 + 清场），这样"记账"和"处置"各自单一职责。
 */
export function advanceNoTownStreaks(state: GameState): FactionId[] {
  const timedOut: FactionId[] = [];
  for (const id of factionIds(state)) {
    if (id === 'p1') continue; // 人类玩家不适用（见 isEliminated 的注释）
    const p = state.players[id];
    if (!p) continue;
    if (ownsTown(state, id)) {
      p.noTownDays = 0;
      continue;
    }
    const days = noTownDaysOf(state, id) + 1;
    p.noTownDays = days;
    if (days === NO_TOWN_GRACE_DAYS) timedOut.push(id);
  }
  return timedOut;
}

/**
 * 让一个出局阵营彻底退场：写一条日志，并把它名下的英雄从世界上摘掉
 * （复用战斗减员的 `removeHero`，所以地图上不会再留一尊不动的雕像）。
 * 幂等：英雄已经清空时再调不会有副作用。
 */
export function eliminateFaction(state: GameState, player: FactionId): void {
  const heroes = Object.values(state.heroes).filter((h) => h.owner === player);
  for (const h of heroes) removeHero(state, h.id);
  pushLog(
    state,
    `${factionName(player)} 已连续 ${NO_TOWN_GRACE_DAYS} 天没有城镇，退出了这场争夺`,
  );
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
