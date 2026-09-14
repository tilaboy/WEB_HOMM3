import type { GameConfig, GameState } from '../core/types.js';

const KEY = 'homm-save-v1';
const CONFIG_KEY = 'homm-config-v1';
/** 存档结构版本：字段有增删就 +1，旧存档会被安全丢弃而不是崩在半路。 */
const VERSION = 7;

export function saveGame(state: GameState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 隐私模式下写入失败不影响游戏 */
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as GameState;
    if (!obj || obj.version !== VERSION) return null;
    if (!obj.map || !obj.heroes || !obj.config) return null;
    return obj;
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const obj = JSON.parse(raw) as GameState;
    return !!obj && obj.version === VERSION;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** 记住上一次的开局设置，下次打开设置页就是上次的选项。 */
export function saveConfig(config: GameConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
}

export function loadConfig(): GameConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as GameConfig;
    if (!obj || typeof obj.seed !== 'number') return null;
    return obj;
  } catch {
    return null;
  }
}
