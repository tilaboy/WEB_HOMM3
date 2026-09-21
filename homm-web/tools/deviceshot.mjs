#!/usr/bin/env node
/**
 * deviceshot.mjs —— 用**真实 headless Chrome**、在**真机视口**下截图，并可选
 * 预注入画质档位，用来出「同一视角、只差一个变量」的**真浏览器**对照图。
 *
 * 为什么再要一个（与 `chromeshot.mjs` / `artshot.mjs` 的分工）：
 *   - `tools/artshot.mjs`：node 自建 Canvas2D 垫片合成。跑得快、能做单变量 A/B，
 *     但**未验证**垫片合成语义与真实 Chrome Canvas2D 逐像素一致（见 shots/README）。
 *   - `tools/chromeshot.mjs`：真实 Chrome，但用 `--window-size=1280,900`，且**不能**
 *     在页面加载前写 localStorage ⇒ 换不了档位、也换不了设备视口。
 *   - 本工具补两个口子：① `Emulation.setDeviceMetricsOverride` 用**真机视口**
 *     （默认 792×320 @ DPR3＝OPPO PMA110 实测值）；② `Page.addScriptToEvaluateOnNewDocument`
 *     在 **main.js 跑之前**写 `homm.tierMode` ⇒ 可以出「只差档位」的对照。
 *
 * 用法：
 *   npm run build
 *   node tools/serve.mjs                 # 另开一个终端
 *   node tools/deviceshot.mjs <out.png> <url> [low|mid|high]
 *
 * 例（同一视角，只差档位）：
 *   U='http://127.0.0.1:5173/?devquick=0&devsize=medium&devseed=20260917&devreveal=1&devlight=0.22'
 *   node tools/deviceshot.mjs /tmp/low.png  "$U" low
 *   node tools/deviceshot.mjs /tmp/high.png "$U" high
 *
 * 例（同一视角，只差地貌层）：
 *   node tools/deviceshot.mjs /tmp/shade_off.png "$U&devshade=0"
 *   node tools/deviceshot.mjs /tmp/shade_on.png  "$U"
 *
 * 环境变量：SHOT_W / SHOT_H / SHOT_DPR 覆盖视口（默认 792 / 320 / 3）。
 * 退出码：0 成功 / 2 前置不满足 / 1 其他失败
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [outFile, url, tier] = process.argv.slice(2);
if (!outFile || !url) {
  console.error('用法：node tools/deviceshot.mjs <out.png> <url> [low|mid|high]');
  process.exit(2);
}
if (tier && !['low', 'mid', 'high'].includes(tier)) {
  console.error(`档位只能是 low|mid|high，收到「${tier}」`);
  process.exit(2);
}

const VW = Number(process.env.SHOT_W ?? 792);
const VH = Number(process.env.SHOT_H ?? 320);
const VDPR = Number(process.env.SHOT_DPR ?? 3);

const root = process.cwd();
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) {
  console.error(`找不到 Chrome：${CHROME}`);
  process.exit(2);
}
if (!existsSync(path.join(root, 'dist', 'main.js'))) {
  console.error('dist/main.js 不存在，请先 npm run build');
  process.exit(2);
}

const APP_PORT = Number(process.env.PORT ?? 5173);
const CDP_PORT = 9700 + (process.pid % 200); // 每轮换端口，避免连到陈旧实例
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const res = await fetch(`http://127.0.0.1:${APP_PORT}/`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (e) {
  console.error(`dev server 没在 127.0.0.1:${APP_PORT} 上跑（${e.message}）；先另开终端 node tools/serve.mjs`);
  process.exit(2);
}

// 先开 about:blank —— 这样「注入 localStorage」能抢在导航之前，而不是等页面跑起来才补。
const profile = mkdtempSync(path.join(tmpdir(), 'deviceshot-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--remote-allow-origins=*',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

async function cleanup() {
  if (!chrome.killed) chrome.kill('SIGKILL');
  await new Promise((resolve) => {
    if (chrome.exitCode !== null || chrome.signalCode !== null) return resolve();
    chrome.once('exit', resolve);
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

/** 等 CDP 起来并拿到那个 about:blank 页面 target。 */
async function findTarget() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const t = list.find((x) => x.type === 'page');
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch {
      /* 端口还没开 */
    }
    await sleep(100);
  }
  throw new Error('等不到 CDP target');
}

let ws;
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? '页面内异常');
  return r.result?.value;
}

try {
  const wsUrl = await findTarget();
  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连不上')), { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');

  // ① 真机视口（默认＝OPPO PMA110 实测：CSS 792×320、DPR 3）
  await send('Emulation.setDeviceMetricsOverride', {
    width: VW,
    height: VH,
    deviceScaleFactor: VDPR,
    mobile: true,
  });

  // ② 档位必须在 main.js 之前写进去 —— addScriptToEvaluateOnNewDocument 正是这个时机。
  //    键名与 `quality.ts` 的 MODE_KEY 一致；mode !== 'auto' 时 initQuality 直接 applyTier、不探测。
  if (tier) {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem('homm.tierMode', ${JSON.stringify(tier)}); } catch (e) {}`,
    });
  }

  // ③ 可选：**冻结时间**（`SHOT_FREEZE=1`）—— 把 `performance.now()` 打平成常数。
  //    为什么必须能冻：水面是 4 帧循环、高光带按 `performance.now()` 正弦扫、
  //    选中脉冲也按它呼吸。两次截图落在**不同时刻** ⇒ 差异里混进「水在动」这一项，
  //    A/B 就不干净 —— 秒级噪声足以淹没地貌层那 ~3/255 的差。冻住后两次跑同一帧，
  //    差异只来自被测变量。`MapRenderer.draw()` 正是内部调 `performance.now()`，
  //    所以冻它就能冻住这几个动画。
  if (process.env.SHOT_FREEZE) {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { Object.defineProperty(performance, 'now', { value: () => 1e6, configurable: true }); } catch (e) {}`,
    });
  }

  await send('Page.navigate', { url });

  // 等游戏挂载 + 渲染若干帧（等的是「画完了」，不是「固定时长」）
  const waited = await evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const frames = (n) => new Promise((r) => { let i = 0; const s = () => (++i >= n ? r() : requestAnimationFrame(s)); requestAnimationFrame(s); });
    let canvas = null;
    for (let i = 0; i < 200; i++) {
      canvas = document.querySelector('canvas');
      if (canvas && canvas.width > 0 && canvas.height > 0) break;
      await sleep(50);
    }
    if (!canvas) return { ok: false, why: '没有 canvas' };
    await frames(45);               // 45 帧足够让地图/布景/光照都画出来
    const mode = (() => { try { return localStorage.getItem('homm.tierMode'); } catch { return null; } })();
    return { ok: true, w: canvas.width, h: canvas.height, cssW: canvas.clientWidth, cssH: canvas.clientHeight, mode };
  })()`);

  if (!waited?.ok) throw new Error(`页面没就绪：${JSON.stringify(waited)}`);

  // ④ 可选：**点一下**（`SHOT_CLICK='cssX,cssY'`，视口 CSS 坐标）—— 用来把
  //    "英雄选中 ⇒ 可达染色出现"这一步做出来（`vm.reachable` 只在有英雄选中时非空）。
  //    点完等若干帧，让 `recomputeField()` + 重绘都落地，再截图。
  if (process.env.SHOT_CLICK) {
    const [cx, cy] = process.env.SHOT_CLICK.split(',').map(Number);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) throw new Error(`SHOT_CLICK 格式应为 'x,y'，收到 ${process.env.SHOT_CLICK}`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', clickCount: 1, pointerType: 'mouse' });
    }
    await evaluate(`new Promise((r) => { let i = 0; const s = () => (++i >= 20 ? r(true) : requestAnimationFrame(s)); requestAnimationFrame(s); })`);
  }

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
  console.log(
    `OK  ${outFile}  (canvas ${waited.w}x${waited.h} @css ${waited.cssW}x${waited.cssH}` +
      ` · viewport ${VW}x${VH}@${VDPR}` +
      ` · tierMode=${waited.mode ?? '(未注入)'})`,
  );
} catch (e) {
  console.error(`失败：${e.message}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
