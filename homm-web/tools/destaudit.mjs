/**
 * 跨天行程（点击移动 + 目的地记忆 + 次日续走）端到端审计（CDP 版）。
 *
 * P0.2 的完整闭环：
 *   1) 点一个一天走不到的远处格子 → 英雄出发，移动力耗尽后自动停下，
 *      pendingDest 记住目的地，提示"明天按 M 继续行程"，地图上插小旗；
 *   2) 结束一天 → 移动力回满，提示"按 M 继续昨日的行程"；
 *   3) 按 M → 英雄重新出发朝目的地走。
 *
 * 这条链路涉及鼠标点击、动画逐格走、过天结算，单元测试覆盖不到，
 * 截图又驱动不了输入，所以和 hoveraudit 一样用真实时间 + CDP 注入。
 * 页面侧的状态通过 ?devprobe=1 暴露的 window.__journey() 读取。
 *
 * 用法：npm run build && node tools/serve.mjs（另开终端）&& node tools/destaudit.mjs
 */
import { existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
// TILE 一定要从构建产物里取真值（32）：第一版拍脑袋写了 16，
// 屏幕坐标全错，点击落点偏了一倍，查了半天"英雄为什么只走 8 格"
import { TILE } from '../dist/render/atlas.js';

const root = process.cwd();
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_PORT = Number(process.env.PORT ?? 5173);
const CDP_PORT = 9334;
// 无对手（避免 AI 变数）、固定种子、掀开全图（点远处不需要先探索）、
// 清掉可交互物件（长途行程不被野怪/宝箱打断）
const URL = `http://127.0.0.1:${APP_PORT}/?devquick=0&devsize=large&devlayout=wild&devseed=20260917&devreveal=1&devclear=1&devprobe=1&devzoom=0.75`;

if (!existsSync(path.join(root, 'dist', 'main.js'))) {
  console.error('dist/main.js 不存在，请先 npm run build');
  process.exit(2);
}

try {
  const res = await fetch(`http://127.0.0.1:${APP_PORT}/`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (e) {
  console.error(`dev server 没在 127.0.0.1:${APP_PORT} 上跑（${e.message}）；先另开终端 node tools/serve.mjs`);
  process.exit(2);
}

const profile = mkdtempSync(path.join(tmpdir(), 'destaudit-'));
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
    '--window-size=1280,900',
    URL,
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 收尾：等 chrome 真退出再删 profile，否则 ENOTEMPTY（hoveraudit 踩过） */
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

async function findTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const t = list.find((x) => x.type === 'page' && x.url.includes('devprobe=1'));
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
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? '页面内异常');
  }
  return r.result?.value;
}

async function screenshot(file) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(path.join(root, 'screenshots', 'p0'), { recursive: true });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path.join(root, 'screenshots', 'p0', file), Buffer.from(r.data, 'base64'));
}

/** 注入页面跑的测试序列 */
const TEST = `(async () => {
  const out = { tries: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const J = () => (typeof window.__journey === 'function' ? window.__journey() : null);
  for (let i = 0; i < 120 && !J(); i++) await sleep(50);
  if (!J()) return out;
  const canvas = document.querySelector('canvas');
  if (!canvas) return out;
  const r = canvas.getBoundingClientRect();
  const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  const waitFor = async (pred, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (pred()) return Date.now() - t0;
      await sleep(60);
    }
    return -1;
  };

  out.start = J();

  // 1) 合成鼠标点击"英雄隔壁一格"：验证 点击 → 寻路 → 出发 这条输入链路
  const TILE = ${TILE};
  const tileScreen = (tx, ty) => {
    const { cam } = J();
    return { sx: (tx * TILE + TILE / 2) * cam.zoom + cam.x, sy: (ty * TILE + TILE / 2) * cam.zoom + cam.y };
  };
  const clickTile = (tx, ty) => {
    const { sx, sy } = tileScreen(tx, ty);
    const rect = canvas.getBoundingClientRect();
    out.lastClick = { sx: Math.round(sx), sy: Math.round(sy), rectW: Math.round(rect.width), rectH: Math.round(rect.height) };
    if (sx < 4 || sy < 4 || sx > rect.width - 4 || sy > rect.height - 4) return false;
    const opts = { clientX: rect.left + sx, clientY: rect.top + sy, bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 1 };
    canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
    canvas.dispatchEvent(new PointerEvent('pointerup', opts));
    return true;
  };
  out.clickWalking = false;
  out.clickTries = [];
  // 英雄出生点在城堡 2×2  footprint 里，紧邻四格是城墙（那里去不了），点 3 格开外
  for (const [dx, dy] of [[3, 0], [0, 3], [-3, 0], [0, -3], [2, 2], [-2, 2], [2, -2], [-2, -2]]) {
    const h = J().heroPos;
    const { sx, sy } = tileScreen(h.x + dx, h.y + dy);
    if (!clickTile(h.x + dx, h.y + dy)) { out.clickTries.push({ dx, dy, off: true }); continue; }
    await sleep(350);
    const j = J();
    out.clickTries.push({ dx, dy, sx: Math.round(sx), sy: Math.round(sy), walking: j.walking, hint: j.hint });
    if (j.walking) { out.clickWalking = true; break; }
  }
  // 短程走完（最多 3s），鼠标挪回画布中央避免触发边缘滚屏
  await waitFor(() => !J().walking, 3000);
  const rect0 = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new PointerEvent('pointermove', {
    clientX: rect0.left + rect0.width / 2, clientY: rect0.top + rect0.height / 2,
    bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 1,
  }));

  // 2) 确定性长途：直接发指令到 +19/+19（约 3800 移动力，一天走不完）
  const h0 = J().heroPos;
  window.__journeyGo(h0.x + 19, h0.y + 19);
  out.departed = await waitFor(() => J().walking, 1500) >= 0;
  if (!out.departed) return out;

  // 3) 等第一段行程停下（移动力耗尽 → pendingDest 应被记住）
  out.leg1Ms = await waitFor(() => !J().walking, 40000);
  out.afterLeg1 = J();

  // 4) 结束一天 → 移动力回满 + 提示按 M 继续
  key('Enter');
  out.dayMs = await waitFor(() => J().movePoints > 0 && !J().walking, 8000);
  out.afterEndDay = J();

  // 5) 按 M 续走 → 英雄重新出发且位置真的发生变化
  const before = J().heroPos;
  key('m');
  out.resumeMs = await waitFor(() => J().walking, 3000);
  const moved = await waitFor(() => {
    const p = J().heroPos;
    return p && before && (p.x !== before.x || p.y !== before.y);
  }, 5000);
  out.movedMs = moved;
  out.afterResume = J();
  return out;
})()`;

let results;
try {
  const wsUrl = await findTarget();
  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: res2, reject: rej2 } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej2(new Error(msg.error.message)) : res2(msg.result);
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  results = await evaluate(TEST);
  // 第一段走完、小旗挂着时抓一张图（目检目的地旗）
  await screenshot('dest-flag.png');
} catch (e) {
  console.error(`跑审计失败：${e.message}`);
  await cleanup();
  process.exit(2);
}

await cleanup();

let bad = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `（${detail}）` : ''}`);
  if (!ok) bad++;
};

console.log('过程记录：');
console.log(`  起点: ${JSON.stringify(results.start?.heroPos)} movePoints=${results.start?.movePoints} cam=${JSON.stringify(results.start?.cam)}`);
for (const t of results.clickTries ?? []) {
  console.log(
    t.off
      ? `  点击隔壁 (${t.dx}, ${t.dy}) → 屏幕外 ${JSON.stringify(results.lastClick)}`
      : `  点击隔壁 (${t.dx}, ${t.dy}) @屏(${t.sx},${t.sy}) → walking=${t.walking} hint="${t.hint}"`,
  );
}
console.log('');
if (!results.start) {
  console.log('FAIL  __journey 探针没起来（devprobe=1 没生效？）');
  process.exit(2);
}
check('合成鼠标点击隔壁格 → 英雄出发（点击链路通）', results.clickWalking === true);
check('长途指令发出后英雄出发', results.departed === true);
if (!results.departed) process.exit(1);

const a1 = results.afterLeg1 ?? {};
check('第一段行程在移动力耗尽后停下', results.leg1Ms >= 0, `走了 ${(results.leg1Ms / 1000).toFixed(1)}s`);
check('目的地被记住（pendingDest）', !!a1.pendingDest, a1.pendingDest ? `→ (${a1.pendingDest.dest.x}, ${a1.pendingDest.dest.y})` : 'null');
check('停下时提示"按 M 继续"', (a1.hint ?? '').includes('按 M'), a1.hint);

const ad = results.afterEndDay ?? {};
check('结束一天后移动力回满', results.dayMs >= 0 && ad.movePoints > 1000, `movePoints=${ad.movePoints}`);
check('过天后提示"按 M 继续昨日的行程"', (ad.hint ?? '').includes('按 M 继续昨日'), ad.hint);
check('过天后目的地仍在', !!ad.pendingDest);

const ar = results.afterResume ?? {};
check('按 M 后重新出发', results.resumeMs >= 0, `等了 ${results.resumeMs}ms`);
check('英雄位置真的动了', results.movedMs >= 0, `等了 ${results.movedMs}ms`);

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`);
process.exit(bad === 0 ? 0 : 1);
