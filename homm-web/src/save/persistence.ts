import type { GameConfig, GameState } from '../core/types.js';
import { normalizeLegacyUnitIds } from '../core/data/units.js';

const KEY = 'homm-save-v1';
const CONFIG_KEY = 'homm-config-v1';
/** 存档结构版本：字段有增删就 +1，旧存档会被安全丢弃而不是崩在半路。 */
const VERSION = 7;

/* ------------------------------------------------------------------ *
 * 原生存储桥（@capacitor/preferences）—— M-13，规格 §2.8 / §7 风险③
 *
 * 为什么需要：iOS WKWebView 会在存储压力 / 系统升级 / 长期未使用时**回收
 * localStorage**，而原生壳里没有浏览器「站点数据」提示，玩家会静默丢档。
 * Preferences 底层是 NSUserDefaults / SharedPreferences，随 App 一起备份。
 *
 * 为什么走全局而不是 import：本工程**零打包器**，`import '@capacitor/preferences'`
 * 的裸模块名在 WebView / 静态服务里都解析不到。原生壳注入的 `window.Capacitor`
 * 才是插件入口；Web 浏览器里它不存在 → 全模块退回 localStorage，功能不受影响。
 * ------------------------------------------------------------------ */

interface PreferencesPluginLike {
  get(opts: { key: string }): Promise<{ value: string | null }>;
  set(opts: { key: string; value: string }): Promise<void>;
  remove(opts: { key: string }): Promise<void>;
}

interface CapacitorGlobal {
  Plugins?: Record<string, unknown>;
  registerPlugin?: (name: string) => unknown;
}

function nativePreferences(): PreferencesPluginLike | null {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap) return null;
  try {
    const viaRegistry = cap.Plugins?.Preferences;
    const candidate =
      (viaRegistry as PreferencesPluginLike | undefined) ??
      (typeof cap.registerPlugin === 'function'
        ? (cap.registerPlugin('Preferences') as PreferencesPluginLike)
        : null);
    return candidate && typeof candidate.get === 'function' ? candidate : null;
  } catch {
    return null;
  }
}

const prefs = nativePreferences();

/** Preferences 是否可用：原生壳里为 true，Web 为 false（不影响功能，只是退化为 localStorage）。 */
export function preferencesAvailable(): boolean {
  return prefs !== null;
}

/** 读 Preferences（异步，权威）。失败一律当「没有值」。 */
async function prefsGet(key: string): Promise<string | null> {
  if (!prefs) return null;
  try {
    return (await prefs.get({ key })).value ?? null;
  } catch {
    return null;
  }
}

/** 写 Preferences（异步、fire-and-forget；失败不影响 localStorage 兜底）。 */
function prefsSet(key: string, value: string): void {
  if (!prefs) return;
  void prefs.set({ key, value }).catch(() => undefined);
}

function prefsRemove(key: string): void {
  if (!prefs) return;
  void prefs.remove({ key }).catch(() => undefined);
}

/* ------------------------------------------------------------------ *
 * localStorage 兜底（同步，保持既有函数签名不变，调用点零改动）
 * ------------------------------------------------------------------ */

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 隐私模式 / 配额满：写入失败不影响游戏 */
  }
}

function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * 启动期水合（关键）
 * ------------------------------------------------------------------ */

/**
 * 把 Preferences（权威）灌回 localStorage（同步读的兜底）。
 *
 * **必须在任何 `loadGame()` / `hasSave()` 之前 `await` 一次**——否则 iOS 上
 * localStorage 被系统回收后，同步读会拿到 null 从而误判「没有存档」，玩家看到的
 * 是「新游戏」而不是「继续」。这是 M-13 能否真正防丢档的关键一步。
 *
 * 反向也做一次迁移：Preferences 为空但 localStorage 有值（例如 Web 版玩到一半
 * 换到原生壳）时，把 localStorage 的值补写进 Preferences。
 *
 * Web / Preferences 不可用时立即 resolve，无任何副作用。
 */
export async function hydratePersistence(): Promise<void> {
  if (!prefs) return;
  const [save, config] = await Promise.all([prefsGet(KEY), prefsGet(CONFIG_KEY)]);
  if (save) {
    lsSet(KEY, save);
  } else {
    const local = lsGet(KEY);
    if (local) prefsSet(KEY, local);
  }
  if (config) {
    lsSet(CONFIG_KEY, config);
  } else {
    const local = lsGet(CONFIG_KEY);
    if (local) prefsSet(CONFIG_KEY, local);
  }
}

/* ------------------------------------------------------------------ *
 * 对外 API（6 个函数签名与语义保持原样）
 * ------------------------------------------------------------------ */

export function saveGame(state: GameState): void {
  let json: string;
  try {
    json = JSON.stringify(state);
  } catch {
    return;
  }
  lsSet(KEY, json);
  prefsSet(KEY, json); // 双写：Preferences（权威）+ localStorage（兜底）
}

export function loadGame(): GameState | null {
  const raw = lsGet(KEY);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as GameState;
    if (!obj || obj.version !== VERSION) return null;
    if (!obj.map || !obj.heroes || !obj.config) return null;
    // 旧档兼容（D-58 §6.4.4）：把 4 个容器里的旧通用兵种 id 一次性换成 canonical id。
    // **只在这里做一次** —— 写档一律写新 id，旧词不会通过「读 → 改 → 存」渗回来。
    // 不放进 getUnit()：写档用的是调用方传进来的字符串，getUnit 兜底救不了写档。
    normalizeLegacyUnitIds(obj);
    return obj;
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  const raw = lsGet(KEY);
  if (!raw) return false;
  try {
    const obj = JSON.parse(raw) as GameState;
    return !!obj && obj.version === VERSION;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  lsRemove(KEY);
  prefsRemove(KEY);
}

/** 记住上一次的开局设置，下次打开设置页就是上次的选项。 */
export function saveConfig(config: GameConfig): void {
  let json: string;
  try {
    json = JSON.stringify(config);
  } catch {
    return;
  }
  lsSet(CONFIG_KEY, json);
  prefsSet(CONFIG_KEY, json);
}

export function loadConfig(): GameConfig | null {
  const raw = lsGet(CONFIG_KEY);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as GameConfig;
    if (!obj || typeof obj.seed !== 'number') return null;
    return obj;
  } catch {
    return null;
  }
}
