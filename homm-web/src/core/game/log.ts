import type { GameState } from '../types.js';

export function pushLog(state: GameState, text: string): void {
  state.log.push({ day: state.day, text });
  if (state.log.length > 60) state.log.splice(0, state.log.length - 60);
}
