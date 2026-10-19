/**
 * 曲目注册表。`music.play(id)` 只认这里的 id —— 调用点与曲目数据彻底解耦，
 * 也是 §6.1"预留文件通道"的接口面（将来换文件播放只动这个注册表的实现）。
 */

import type { Score, ScoreId } from './types.js';
import { MENU } from './menu.js';
import { MAP } from './map.js';
import { BATTLE } from './battle.js';
import { TOWN } from './town.js';
import { VICTORY, DEFEAT } from './stings.js';

export const SCORES: Record<ScoreId, Score> = {
  menu: MENU,
  map: MAP,
  battle: BATTLE,
  town: TOWN,
  victory: VICTORY,
  defeat: DEFEAT,
};

export function getScore(id: ScoreId): Score {
  return SCORES[id];
}

export type { Score, ScoreId, Note } from './types.js';
export { isLoop, loopBeats, loopStartBeat, totalBeats } from './types.js';
