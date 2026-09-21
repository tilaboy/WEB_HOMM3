#!/usr/bin/env node
/**
 * chromeshot.mjs —— 用**真实 headless Chrome** 打开本项目的页面并截图。
 *
 * 为什么需要它：`tools/artshot.mjs` 用自建 Canvas2D 垫片在 node 里合成图，
 * 它是「运行期真实渲染代码」的输出，但**未验证**「垫片合成语义 vs 真实 Chrome
 * Canvas2D 是否一致」。本工具补的就是这一层：同一份 dist、同一台机器、真浏览器。
 *
 * 与 hoveraudit / destaudit 同一套 CDP 做法（零第三方依赖，Node 18+ 的 fetch
 * + Node 22+ 的全局 WebSocket）。区别只在：本工具**不注入测试序列**，只等页面
 * 渲染稳定后 `Page.captureScreenshot`。
 *
 * 用法：
 *   npm run build
 *   node tools/serve.mjs          # 另开一个终端
 *   node tools/chromeshot.mjs <输出文件> <URL>
 *
 * 例：
 *   node tools/chromeshot.mjs /tmp/shot.png \
 *     'http://127.0.0.1:5173/?devquick=0&devsize=medium&devseed=20260917&devreveal=1&devlight=0.22&devprobe=1'
 *
 * 退出码：0 成功 / 2 前置不满足 / 1 其他失败
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const outFile = process.argv[2];
const url = process.argv[3];
if (!outFile || !url) {
  console.error('用法：node tools/chromeshot.mjs <输出文件.png> <URL>');
  process.exit(2);
}

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

// 前置：dev server 必须在跑（相对路径的 ./style.css、./main.js 在 file:// 下起不来）
try {
  const res = await fetch(`http://127.0.0.1:${APP_PORT}/`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (e) {
  console.error(`dev server 没在 127.0.0.1:${APP_PORT} 上跑（${e.message}）；先另开终端 node tools/serve.mjs`);
  process.exit(2);
}

const profile = mkdtempSync(path.join(tmpdir(), 'chromeshot-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--remote-allow-origins=*',
    '--window-size=1280,900',
    url,
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

/** 等 CDP 起来并拿到 game 页面 target（排除 devtools 自身）。 */
async function findTarget() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const t = list.find((x) => x.type === 'page' && x.url.includes('127.0.0.1'));
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
    return { ok: true, w: canvas.width, h: canvas.height, cssW: canvas.clientWidth, cssH: canvas.clientHeight };
  })()`);

  if (!waited?.ok) throw new Error(`页面没就绪：${JSON.stringify(waited)}`);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
  console.log(`OK  ${outFile}  (canvas ${waited.w}x${waited.h} @css ${waited.cssW}x${waited.cssH})`);
} catch (e) {
  console.error(`失败：${e.message}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
