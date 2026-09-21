/**
 * _chrome.mjs —— **真 Chrome / CDP 通道的共用胶水**（本仓唯一真相来源）。
 *
 * ## 为什么有本文件（起因：同值多址）
 *
 * `tools/` 下每个"用真 Chrome 抓图/探针"的脚本都把同一段胶水**各抄了一遍**：
 * Chrome 路径常量、CDP 端口按 pid 变换、`fetch` 探活 dev server、
 * `spawn(--headless=new …)`、等 `/json/list` 拿 target、零依赖 WebSocket 收发、清理临时 profile。
 *
 * 2026-09-21 数了一遍，**同一份 `const CHROME = '/Applications/…'` 有 6 处**：
 *   `tinytargetaudit.mjs` · `hoveraudit.mjs` · `destaudit.mjs` · `chromeshot.mjs`
 *   · `deviceshot.mjs` · `shimconsistency.mjs`
 * （主理人最初数成 4、我补报成 5 —— **都漏了 `deviceshot.mjs`，实为 6**。以本文件注释为准。）
 *
 * ## 收敛策略（主理人裁定，别顺手扩大）
 *
 * 那 6 个里前 4 个是**在跑的 live 门控 / 探针**（别的成员在用），**不在负载下改造共享工具**。
 * 故：**只新建本文件作为起点，新工具一律用它；老工具等空闲再迁。**
 * ⇒ 本文件**不得**被"顺手"改成同时改老工具 —— 一次只动一处，可回退。
 *
 * 覆盖范围＝上面列的那段最小胶水。**不含**任何工具特有逻辑（视口注入、档位注入、断言）。
 *
 * 用法（新工具照抄这段）：
 * ```js
 * import { checkDevServer, cdpPort, withHeadlessChrome } from './_chrome.mjs';
 * const ok = await checkDevServer(5173);
 * if (!ok.ok) { console.error(ok.reason); process.exit(2); }
 * const out = await withHeadlessChrome(async ({ send, evaluate }) => {
 *   await send('Page.navigate', { url });
 *   return evaluate('document.title');
 * }, { port: cdpPort() });
 * ```
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* ------------------------------------------------------------------ 路径 */

/**
 * Chrome 可执行文件。**用 env `CHROME` 可覆盖** —— 换机器 / CI / 非 macOS 时不必改代码。
 * 这是本文件存在的第一个理由：路径漂了，只改一行。
 */
export const CHROME_PATH =
  process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Chrome 在不在。不在就由调用方决定 exit(2) 并给一句人话。 */
export function chromeAvailable() {
  return existsSync(CHROME_PATH);
}

/* ------------------------------------------------------------------ 端口 */

/**
 * CDP 调试端口：**按 pid 偏移**，避免连到上一轮残留的实例（陈旧实例是这类脚本最常见的假绿来源）。
 */
export function cdpPort(base = 9700, span = 200) {
  return base + (process.pid % span);
}

/* ------------------------------------------------------------------ 前置：dev server 探活 */

/**
 * dev server（`tools/serve.mjs`）在不在。返回 `{ ok, reason }` 而不是抛 ——
 * 因为"没起服务"是**前置不满足（exit 2）**，不是运行失败（exit 1），调用方要能分开。
 */
export async function checkDevServer(port = 5173, host = '127.0.0.1') {
  try {
    const res = await fetch(`http://${host}:${port}/`);
    if (!res.ok) return { ok: false, reason: `dev server 返回 HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: `dev server 没在 ${host}:${port} 上跑（${e.message}）；先另开终端 node tools/serve.mjs`,
    };
  }
}

/* ------------------------------------------------------------------ 拉起 + 连接 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 拉起一个 headless Chrome（`--headless=new`）并返回 `{ proc, profile, cleanup }`。
 * 调用方**必须**在 finally 里 `await cleanup()` —— 它会 kill 进程 + 删临时 profile（带重试）。
 */
export function launchHeadless({ port, profilePrefix = 'chrome-' } = {}) {
  const cdp = port ?? cdpPort();
  const profile = mkdtempSync(path.join(tmpdir(), profilePrefix));
  const proc = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${cdp}`,
      '--remote-allow-origins=*',
      'about:blank', // 先 about:blank：这样"注入脚本/改视口"能抢在导航之前
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );

  async function cleanup() {
    if (!proc.killed) proc.kill('SIGKILL');
    await new Promise((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
      proc.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(profile, { recursive: true, force: true });
        return;
      } catch {
        await sleep(200);
      }
    }
  }

  return { proc, profile, cleanup, cdpPort: cdp };
}

/** 等 CDP 起来并拿到那个 page target 的 WebSocket URL。 */
export async function waitForPageTarget(port, { tries = 120, intervalMs = 100 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const t = list.find((x) => x.type === 'page');
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch {
      /* 端口还没开 */
    }
    await sleep(intervalMs);
  }
  throw new Error('等不到 CDP target');
}

/**
 * 连上 CDP WebSocket，返回 `{ send, evaluate, close }`。
 * 零依赖：用 node 内建 `WebSocket`（node ≥22）。`send` 是 Promise 化的 `{id,method,params}` 往返。
 */
export async function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连不上')), { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const send = (method, params = {}) => {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  /** `Runtime.evaluate` 的薄封装：页面内抛错会被转成 node 异常，不留假绿。 */
  async function evaluate(expression, { awaitPromise = true } = {}) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? '页面内异常');
    return r.result?.value;
  }
  return { send, evaluate, close: () => ws.close() };
}

/**
 * 一句话入口：**探活（可选）→ 拉起 → 等 target → 连接 → 跑 `fn` → 无论成败都清理**。
 *
 * `fn` 拿到 `{ send, evaluate, cdpPort, profile }`；返回值即本函数返回值。
 * `devServerPort` 给了就先探活 dev server，不满足则抛（调用方 catch 后 `exit(2)`）。
 */
export async function withHeadlessChrome(fn, opts = {}) {
  const { port, profilePrefix, devServerPort } = opts;

  if (!chromeAvailable()) throw new Error(`找不到 Chrome：${CHROME_PATH}（可用 env CHROME 覆盖）`);
  if (devServerPort != null) {
    const probe = await checkDevServer(devServerPort);
    if (!probe.ok) {
      const err = new Error(probe.reason);
      err.prerequisite = true; // 让调用方能区分"前置不满足(2)"与"运行失败(1)"
      throw err;
    }
  }

  const launched = launchHeadless({ port, profilePrefix });
  try {
    const wsUrl = await waitForPageTarget(launched.cdpPort);
    const cdp = await connectCdp(wsUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    try {
      return await fn({ ...cdp, cdpPort: launched.cdpPort, profile: launched.profile });
    } finally {
      cdp.close();
    }
  } finally {
    await launched.cleanup();
  }
}
