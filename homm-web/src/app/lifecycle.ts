/**
 * 应用生命周期（M-05）—— 移动端规格 `docs/architecture/mobile-platform.md` §5.4。
 *
 * 目的：切后台（Home 键 / 来电 / 锁屏）时不要让主循环空转、不要让音频上下文继续占用、
 * 并且**立即存档**（WebView 进程可能被系统 jetsam 杀掉，见规格 §7 风险②）。
 *
 * 信号来源（可靠性从高到低）：
 *  1. 原生壳：`@capacitor/app` 的 `appStateChange`——经原生注入的 `window.Capacitor`
 *     全局访问。**本工程零打包器**，`import '@capacitor/app'` 这种裸模块名在 WebView /
 *     静态服务里都解析不到，所以必须走全局桥而不是 import（这是对规格 §4.2「动态 import」
 *     用词的技术更正，意图——能力探测 + Web 不报错——保持不变且更稳）。
 *  2. Web / 原生兜底：`visibilitychange`（hidden → 暂停）、`pagehide`、`freeze`
 *     （iOS WKWebView 上 `visibilitychange` 偶有不触发，规格 §5.4 要求用 `pagehide` 兜底）。
 *
 * 职责划分（关键，决定了与 `main.ts` 的接线方式）：
 *  - 音频的 suspend / resume **由本模块负责**（规格 §5.4）。
 *  - 停 / 起 rAF 与存档**由调用方在回调里做**——rAF 句柄与存档状态在 `main.ts` 里。
 *
 * 恢复顺序严格遵循规格 §5.4：**先重置帧时间戳**（在 `onResume` 内），再恢复音频。
 */

import { resumeAudio, suspendAudio } from '../ui/sfx.js';

export interface LifecycleHandlers {
  /** 进入后台：本模块已先调 `suspendAudio()`。这里做「取消 rAF + 立即存档」。 */
  onPause?: () => void;
  /**
   * 回到前台：这里**必须先把帧时间戳重置**（`last = performance.now()`，否则
   * `now - last` 会等于整个后台时长），然后重启 rAF。本模块随后调 `resumeAudio()`。
   */
  onResume?: () => void;
}

/** 原生 `App` 插件对象的最小形态（只声明本模块用到的部分）。 */
interface AppPluginLike {
  addListener?: (
    event: string,
    cb: (data: { isActive: boolean }) => void,
  ) => Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
}

/** 原生注入的 Capacitor 运行时的最小形态。 */
interface CapacitorGlobal {
  Plugins?: Record<string, unknown>;
  registerPlugin?: (name: string) => unknown;
}

/**
 * 从原生桥取一个插件。原生壳会在任何页面脚本之前注入 capacitor.js，把运行时挂到
 * `window.Capacitor`；插件经 `Plugins[name]` 或 `registerPlugin(name)` 取得。
 * Web 浏览器里 `window.Capacitor` 根本不存在 → 返回 null（调用方退回 Web 事件）。
 */
function nativePlugin<T>(name: string): T | null {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap) return null;
  try {
    const byRegistry = cap.Plugins?.[name];
    if (byRegistry) return byRegistry as T;
    if (typeof cap.registerPlugin === 'function') return cap.registerPlugin(name) as T;
  } catch {
    /* 插件未注册或桥未就绪——交给 Web 事件兜底 */
  }
  return null;
}

let current: (() => void) | null = null;

/**
 * 安装生命周期监听。**幂等**：重复调用返回同一个卸载函数（避免重复注册）。
 *
 * @returns 卸载函数——移除全部监听，测试 / 热更用。
 */
export function installLifecycle(handlers: LifecycleHandlers = {}): () => void {
  if (current) return current;

  let paused = false;

  const pause = (): void => {
    if (paused) return;
    paused = true;
    suspendAudio();
    try {
      handlers.onPause?.();
    } catch (err) {
      console.error('[lifecycle] onPause 抛错：', err);
    }
  };

  const resume = (): void => {
    if (!paused) return;
    paused = false;
    try {
      // ① 先重置帧时间戳（在 onResume 内），这是本模块最重要的顺序约束
      handlers.onResume?.();
    } catch (err) {
      console.error('[lifecycle] onResume 抛错：', err);
    }
    // ② 再恢复音频
    resumeAudio();
  };

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') pause();
    else resume();
  };
  const onPageHide = (): void => pause();
  const onFreeze = (): void => pause();

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  // Page Lifecycle API（Chrome 68+）；不支持的浏览器没有该事件，静默忽略
  document.addEventListener('freeze', onFreeze);

  // 原生壳的权威信号：appStateChange（比 Web 事件可靠）
  let appHandle: { remove: () => Promise<void> } | null = null;
  const app = nativePlugin<AppPluginLike>('App');
  if (app?.addListener) {
    try {
      const maybe = app.addListener('appStateChange', (data) => {
        if (data.isActive) resume();
        else pause();
      });
      void Promise.resolve(maybe)
        .then((h) => {
          appHandle = h;
        })
        .catch(() => undefined);
    } catch {
      /* 桥不可用——Web 事件兜底 */
    }
  }

  current = () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('freeze', onFreeze);
    if (appHandle) void appHandle.remove().catch(() => undefined);
    current = null;
    paused = false;
  };
  return current;
}
