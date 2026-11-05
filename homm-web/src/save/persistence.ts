import type { GameConfig, GameState } from '../core/types.js';
import { SAVE_VERSION } from '../core/types.js';
import { dropUnknownUnits, normalizeLegacyUnitIds } from '../core/data/units.js';
import { DIFFICULTIES, viewerOf } from '../core/data/factions.js';

/* ------------------------------------------------------------------ *
 * 档位模型（规格 §30.2，2026-11-05 落地）
 *
 *   auto   自动档：按「结束一天」的瞬间、`endDay()` **之前**写，只读
 *   slot1–8 手动档：菜单里写，可覆盖不可删
 *   resume 救援档：每次状态变更 / onPause / pagehide 写，**不进档位列表**
 *
 * 外壳统一是 `{ shell: 1, savedAt, state }` —— 时间戳放在外壳里，不进
 * `GameState`：它只服务于「继续」排序，塞进 state 等于每存一次都改一次状态
 * 的哈希，而 P2 的逐字段深比较会因此永远不相等。
 * ------------------------------------------------------------------ */

export type ManualSlot = 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5' | 'slot6' | 'slot7' | 'slot8';
export type SaveSlot = 'auto' | ManualSlot | 'resume';

export const MANUAL_SLOTS: readonly ManualSlot[] = [
  'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8',
];
/** 读档列表的顺序：自动档在最上，然后 1–8（§30.6）。 */
export const LOAD_ORDER: readonly SaveSlot[] = ['auto', ...MANUAL_SLOTS];
/** 水合要遍历的固定清单（§30.5「不再写死两个」）。 */
export const ALL_SLOTS: readonly SaveSlot[] = [...LOAD_ORDER, 'resume'];

export const SLOT_KEYS: Record<SaveSlot, string> = {
  auto: 'homm-save-auto',
  slot1: 'homm-save-slot1',
  slot2: 'homm-save-slot2',
  slot3: 'homm-save-slot3',
  slot4: 'homm-save-slot4',
  slot5: 'homm-save-slot5',
  slot6: 'homm-save-slot6',
  slot7: 'homm-save-slot7',
  slot8: 'homm-save-slot8',
  resume: 'homm-save-resume',
};

/** 旧版单槽 key：首次启动迁移到 auto 后删除（§30.5）。 */
const LEGACY_KEY = 'homm-save-v1';
const CONFIG_KEY = 'homm-config-v1';
/**
 * 存档结构版本：字段有增删就 +1，旧存档会被安全丢弃而不是崩在半路。
 * **真值在 `core/types.ts` 的 `SAVE_VERSION`**（生成器也读它），这里只做别名。
 */
const VERSION = SAVE_VERSION;
/**
 * 能被**迁移**的最老版本。比它更老的档直接丢（没有迁移器 = 读到就是错数据）。
 * v7 → v8：兵种阵容 v3，20 个 canonical id 全换（§16.6）。
 */
const MIN_MIGRATABLE = 7;

/** 存档外壳：**时间戳在外壳里**，`state` 是整份 `GameState`（不写字段白名单，决策 72）。 */
interface SaveShell {
  shell: 1;
  savedAt: number;
  state: GameState;
}

export type SaveFailure = 'quota' | 'error';

export interface SaveResult {
  ok: boolean;
  reason: 'ok' | SaveFailure;
  /** 失败时给玩家看的一句话（配额满与"存储不可用"要分开说）。 */
  message?: string;
}

/**
 * `ok`     可读（含需要迁移的旧版本档 —— 点下去会走迁移器）
 * `stale`  版本闸失效（比当前新 / 比可迁移的最老还旧）⇒ 只废这一档
 * `broken` 外壳或必填字段缺失
 */
export type SlotStatus = 'empty' | 'ok' | 'stale' | 'broken';

export interface SlotInfo {
  slot: SaveSlot;
  status: SlotStatus;
  savedAt: number;
  day: number;
  heroName: string;
  difficultyName: string;
  /** 档里记的版本号（`stale` 时用来解释"被哪个版本丢的"）。 */
  version: number;
}

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
 * localStorage 兜底（同步）
 * ------------------------------------------------------------------ */

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 静默写：只给水合 / 迁移用（那两处失败没有可提示的对象）。玩家写档走 `writeSlot`。 */
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
 * 外壳 / 版本闸
 * ------------------------------------------------------------------ */

/**
 * 解外壳。**两种都认**：`{shell,state}` 新格式，与旧 key 里的**裸 `GameState`**
 * （迁移窗口期读写都可能撞上，认错的代价是"读到空档"）。
 */
function parseShell(raw: string | null): { savedAt: number; state: GameState } | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<SaveShell> & Partial<GameState>;
    if (!obj || typeof obj !== 'object') return null;
    if (obj.shell === 1 && obj.state) {
      return { savedAt: Number(obj.savedAt) || 0, state: obj.state as GameState };
    }
    // 旧格式：裸 GameState。没有 savedAt ⇒ 记 0，让任何救援档都比它"新"。
    if (typeof obj.version === 'number' && obj.map) return { savedAt: 0, state: obj as GameState };
    return null;
  } catch {
    return null;
  }
}

/** 只判"这档能不能读"，不修改对象（列表渲染走这里，不能顺手迁移 9 份档）。 */
function statusOf(state: GameState | null | undefined): SlotStatus {
  if (!state || typeof state.version !== 'number') return 'broken';
  if (!state.map || !state.heroes || !state.config) return 'broken';
  if (state.version > VERSION) return 'stale';
  if (state.version < MIN_MIGRATABLE) return 'stale';
  return 'ok';
}

/**
 * 版本闸 + 一次性迁移。**每档独立**：判的是 `state.version`，一档坏了不影响其余。
 * 返回 `null` 表示这档不能读（调用方必须当作"空档"，不许半路崩）。
 */
function revive(state: GameState | null): GameState | null {
  if (statusOf(state) !== 'ok') return null;
  const obj = state as GameState;
  if (obj.version < VERSION) {
    /* v7 → v8（B1 阵容 v3）：把 4 个容器里的旧兵种 id 一次性换成新 canonical id。
       **必须用版本闸锁住"只跑一次"**：`p3_treant` 在新旧阵容里指两个不同的兵，
       对 v8 档再跑一遍会把新 T3 树人变成 T4 猿人（静默、且看起来"只是换了个兵"）。 */
    normalizeLegacyUnitIds(obj);
    obj.version = VERSION;
  }
  /* 迁移之后仍可能有未知 id（手改档 / 更早的实验数据）。**在这里丢掉并留日志**，
     而不是让 `getUnit()` 在战斗第一帧抛 —— 抛了就是白屏，玩家只会说"读档坏了"。 */
  const unknown = dropUnknownUnits(obj);
  if (unknown.stacks || unknown.keys) {
    console.warn(
      `[存档] 丢弃未知兵种：部队 ${unknown.stacks} 栈 / 产量键 ${unknown.keys} 个（${unknown.ids.join(', ')}）`,
    );
  }
  return obj;
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
 * 2026-11-05（U4）：遍历**固定清单**（auto + slot1–8 + resume + config），
 * 不再写死两个 key —— 否则新建的手动档在 iOS 上永远进不了权威层。
 * Web / Preferences 不可用时只做旧 key 迁移，无其它副作用。
 */
export async function hydratePersistence(): Promise<void> {
  migrateLegacyKey();
  if (!prefs) return;
  const keys = [...ALL_SLOTS.map((s) => SLOT_KEYS[s]), CONFIG_KEY];
  const values = await Promise.all(keys.map((k) => prefsGet(k)));
  keys.forEach((key, i) => {
    const value = values[i];
    if (value) {
      lsSet(key, value);
    } else {
      const local = lsGet(key);
      if (local) prefsSet(key, local);
    }
  });
}

/**
 * 旧版单槽 → 自动档。**只做一次，不改内容**（§30.5）：把裸 `GameState` 原样包进
 * 外壳复制过去，然后删旧 key。auto 已存在时不覆盖（新机制已经在跑），但仍删旧 key，
 * 否则每次启动都白跑一趟。
 */
function migrateLegacyKey(): void {
  const raw = lsGet(LEGACY_KEY);
  if (!raw) return;
  const parsed = parseShell(raw);
  if (parsed && !lsGet(SLOT_KEYS.auto)) {
    const shell = JSON.stringify({ shell: 1, savedAt: Date.now(), state: parsed.state } satisfies SaveShell);
    lsSet(SLOT_KEYS.auto, shell);
    prefsSet(SLOT_KEYS.auto, shell);
  }
  lsRemove(LEGACY_KEY);
  prefsRemove(LEGACY_KEY);
}

/* ------------------------------------------------------------------ *
 * 写 / 读 / 列表
 * ------------------------------------------------------------------ */

/**
 * 写一个档位。**配额失败必须可见**（§30.5）：`setItem` 抛 `QuotaExceededError`
 * 时返回 `reason:'quota'`，由调用方提示「存档失败：空间不足」——
 * 以前这里 `catch {}` 吞掉，玩家点「存档」看到"已存档"但磁盘上什么都没有。
 */
export function saveToSlot(slot: SaveSlot, state: GameState): SaveResult {
  let json: string;
  try {
    json = JSON.stringify({ shell: 1, savedAt: Date.now(), state } satisfies SaveShell);
  } catch {
    return { ok: false, reason: 'error', message: '存档失败：数据无法序列化' };
  }
  try {
    localStorage.setItem(SLOT_KEYS[slot], json);
  } catch (e) {
    const name = (e as { name?: string } | null)?.name ?? '';
    const quota = name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
    return quota
      ? { ok: false, reason: 'quota', message: '存档失败：空间不足' }
      : { ok: false, reason: 'error', message: '存档失败：本机存储不可用' };
  }
  /* Preferences 只在 localStorage 成功之后写：否则原生侧有、Web 侧没有，
     同一台机器上「继续」能进、读档列表却是空的（两套账）。 */
  prefsSet(SLOT_KEYS[slot], json);
  return { ok: true, reason: 'ok' };
}

/** 读一个档位（含版本迁移）。不可读一律 `null`。 */
export function loadSlot(slot: SaveSlot): GameState | null {
  const parsed = parseShell(lsGet(SLOT_KEYS[slot]));
  return parsed ? revive(parsed.state) : null;
}

/** 档位摘要（列表渲染用）。不迁移、不改盘。 */
export function slotInfo(slot: SaveSlot): SlotInfo {
  const raw = lsGet(SLOT_KEYS[slot]);
  const empty: SlotInfo = {
    slot,
    status: 'empty',
    savedAt: 0,
    day: 0,
    heroName: '',
    difficultyName: '',
    version: 0,
  };
  if (!raw) return empty;
  const parsed = parseShell(raw);
  if (!parsed) return { ...empty, status: 'broken' };
  const st = parsed.state;
  const status = statusOf(st);
  if (!st || typeof st !== 'object') return { ...empty, status: 'broken', savedAt: parsed.savedAt };

  const pid = viewerOf(st);
  const heroId = st.heroOrder?.find((id) => st.heroes?.[id]?.owner === pid) ?? st.heroOrder?.[0];
  return {
    slot,
    status,
    savedAt: parsed.savedAt,
    day: Number(st.day) || 0,
    heroName: (heroId ? st.heroes?.[heroId]?.name : '') ?? '',
    difficultyName: st.config?.difficulty ? DIFFICULTIES[st.config.difficulty]?.name ?? '' : '',
    version: Number(st.version) || 0,
  };
}

/** 一次取多个档位的摘要（读档列表 9 行 / 存档列表 8 行）。 */
export function listSlots(slots: readonly SaveSlot[]): SlotInfo[] {
  return slots.map(slotInfo);
}

/**
 * 「继续」用哪一份：**只在 auto 与 resume 之间按时间戳取最新**（§30.6）。
 * 手动档不参与 —— 它们是"回看 / 回退"，必须由玩家主动从读档列表里选。
 */
export function latestSlot(): SaveSlot | null {
  const cands = (['auto', 'resume'] as const)
    .map(slotInfo)
    .filter((s) => s.status === 'ok');
  if (!cands.length) return null;
  cands.sort((a, b) => b.savedAt - a.savedAt);
  return cands[0].slot;
}

/** 删掉指定档位（放弃本局 = auto + resume；手动档保留，§30.7）。 */
export function clearSlots(slots: readonly SaveSlot[]): void {
  for (const slot of slots) {
    lsRemove(SLOT_KEYS[slot]);
    prefsRemove(SLOT_KEYS[slot]);
  }
}

/* ------------------------------------------------------------------ *
 * 对外兼容 API（调用点语义保持：整局级，不是某个槽）
 * ------------------------------------------------------------------ */

/** 旧签名保留：写**救援档**。手动档只能由菜单写（§30.3 纪律）。 */
export function saveGame(state: GameState): SaveResult {
  return saveToSlot('resume', state);
}

/** 「继续」：auto / resume 里较新的那份。 */
export function loadGame(): GameState | null {
  const slot = latestSlot();
  return slot ? loadSlot(slot) : null;
}

/** 有没有可继续的档（auto 或 resume 之一可读）。手动档不算。 */
export function hasSave(): boolean {
  return latestSlot() !== null;
}

/** 放弃本局：删 auto + resume，**保留 8 个手动档**（§30.7）。 */
export function clearSave(): void {
  clearSlots(['auto', 'resume']);
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
