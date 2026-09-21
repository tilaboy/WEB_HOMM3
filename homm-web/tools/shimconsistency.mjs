#!/usr/bin/env node
/**
 * shimconsistency.mjs —— 回答那个一直悬着的问题：**自建 Canvas2D 垫片（`tools/_canvas.mjs`）
 * 与真实 Chrome Canvas2D，逐像素一致吗？**
 *
 * 为什么需要它：`tools/artshot.mjs` 出的 A/B 对照（`shots/a_*`、`b_*`、`c_*`）跑的是**真实渲染
 * 代码**，但合成用的是 node 里的自建垫片。垫子若不忠实，那批图与数字就带系统性偏差 ——
 * 而这个偏差**从来没人量过**。本工具就是那把尺子。
 *
 * ## 为什么不能直接拿两张"整机截图"相减
 *
 * `artshot`（垫片）画的是 26×16 的**合成地图**（无迷雾 / 无 UI / zoom 2），
 * `deviceshot`（真 Chrome）画的是**真实游戏**（有迷雾 / UI / 相机）。
 * 两者**画的是不同场景** ⇒ 整图相减只会得到"场景不同"，量不到"垫片忠不忠实"。
 * 真正能逐像素比的是**同一串绘制指令**在两套实现下的输出差别 —— 也就是合成算子本身。
 *
 * ## 本工具比什么
 *
 * 取本项目渲染代码**实际用到**的那几个合成算子，拼成一段固定指令（`OPS`）：
 *   ① 不透明实色 `fillRect`（地形砖底色）
 *   ② `globalAlpha` 半透明覆盖（地貌层亮/暗两笔，0.34 / 0.40）
 *   ③ `rgba()` 带 alpha 覆盖（迷雾 `rgba(6,10,18,0.52)`）
 *   ④ 整像素对齐的 `drawImage` 九参 blit，含**透明角**（图集精灵 + alpha≤0 跳过）
 *   ⑤ `globalCompositeOperation='multiply'` 叠色（夜间 L1/L2 tint）
 * 同一段指令在**垫片**里跑一次、在**真 Chrome**里跑一次，逐像素比。
 *
 * ## 怎么读结果
 *
 * `imageSmoothingEnabled=false` + 整像素落点下，两个实现**应当**一致到 ±1 LSB
 * （8-bit 存储的取整差）。所以判据不是"绝对相等"，而是：
 *   - **max |Δ| ≤ 1 且无结构性偏移** ⇒ 垫片忠实，`artshot` 的对照与数字可信；
 *   - **某算子整片偏移 >1** ⇒ 垫片在这一处不忠实 ⇒ 必须给 `artshot` 的结论加"垫片限定"。
 * 脚本会把每个算子的独立子图也分别报出来，避免"平均分掩盖某一片全错"。
 *
 * 用法：
 *   node tools/serve.mjs            # 另开一个终端；本工具要用真 Chrome 打开它
 *   node tools/shimconsistency.mjs
 * 退出码：0 全部 ≤1 LSB / 1 存在 >1 的偏移 / 2 前置不满足
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installShim } from './_canvas.mjs';

/* ------------------------------------------------------------------ 被测指令（两套实现共用同一段） */

/**
 * 这段函数**必须自洽**：只依赖 `document` 与传入的 `ctx` 语义，不含任何垫片/浏览器特有 API。
 * 它在垫片里与在 Chrome 里执行的是**逐字相同**的代码 —— 这正是"同指令、不同实现"的对照。
 *
 * 画布 24×24，横向切三条带，每条带只压一个算子，便于分别归因：
 *   带 1（y 0..7）  ：drawImage 九参 blit（8×8，含透明角）
 *   带 2（y 8..15） ：globalAlpha 0.34 的暖色覆盖
 *   带 3（y 16..23）：rgba() 0.52 的迷雾覆盖 + multiply 叠色
 */
export const OPS = function drawShimProbe() {
  const src = document.createElement('canvas');
  src.width = 8;
  src.height = 8;
  const sx = src.getContext('2d');
  sx.fillStyle = 'rgba(120,200,255,1)';
  sx.fillRect(0, 0, 8, 8);
  sx.fillStyle = 'rgba(20,30,52,0.55)';
  sx.fillRect(0, 0, 8, 4);
  sx.clearRect(6, 6, 2, 2); // 透明角：测 alpha=0 的跳过
  sx.fillStyle = 'rgba(255,240,207,0.34)';
  sx.fillRect(2, 2, 3, 3);

  const cv = document.createElement('canvas');
  cv.width = 24;
  cv.height = 24;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // 底：不透明实色（地形砖底色）
  ctx.fillStyle = '#4a7a3a';
  ctx.fillRect(0, 0, 24, 24);
  // 带 2 先铺一层略深的底，好让 0.34 的覆盖有可量的落差
  ctx.fillStyle = 'rgba(40,60,30,1)';
  ctx.fillRect(0, 8, 24, 8);

  // 带 1：九参 blit（整像素对齐，sw=dw）
  ctx.drawImage(src, 0, 0, 8, 8, 4, 0, 8, 8);

  // 带 2：globalAlpha 半透明覆盖（地貌层亮部那笔）
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = '#fff0cf';
  ctx.fillRect(0, 8, 24, 8);
  ctx.globalAlpha = 1;

  // 带 3：迷雾（带 alpha 的 source-over）+ 夜间 multiply 叠色
  ctx.fillStyle = 'rgba(6,10,18,0.52)';
  ctx.fillRect(0, 16, 24, 8);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgb(178,182,205)';
  ctx.fillRect(0, 16, 24, 8);
  ctx.globalCompositeOperation = 'source-over';

  const d = ctx.getImageData(0, 0, 24, 24).data;
  return { w: cv.width, h: cv.height, rgba: Array.from(d) };
};

/* ------------------------------------------------------------------ 垫片侧 */

function runShim() {
  installShim();
  // 用 `eval` 而非直接调 `OPS`：保证两套实现拿到的是**同一个函数体文本**，
  // 避免"我在 node 里调了函数、在浏览器里又重写了一遍"这种假对照。
  const fn = new Function(`return (${OPS.toString()})`)();
  return fn();
}

/* ------------------------------------------------------------------ Chrome 侧 */

const APP_PORT = Number(process.env.PORT ?? 5173);
const CDP_PORT = 9800 + (process.pid % 150);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) {
  console.error(`找不到 Chrome：${CHROME}`);
  process.exit(2);
}
try {
  const res = await fetch(`http://127.0.0.1:${APP_PORT}/`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (e) {
  console.error(`dev server 没在 127.0.0.1:${APP_PORT} 上跑（${e.message}）；先另开终端 node tools/serve.mjs`);
  process.exit(2);
}

const profile = mkdtempSync(path.join(tmpdir(), 'shimconsistency-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`,
    '--remote-allow-origins=*', 'about:blank',
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
    try { rmSync(profile, { recursive: true, force: true }); return; } catch { await sleep(200); }
  }
}

async function findTarget() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const t = list.find((x) => x.type === 'page');
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch { /* 端口还没开 */ }
    await sleep(100);
  }
  throw new Error('等不到 CDP target');
}

let chromeOut = null;
try {
  const wsUrl = await findTarget();
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连不上')), { once: true });
  });
  let seq = 0;
  const pending = new Map();
  const send = (method, params = {}) => {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });

  await send('Runtime.enable');
  const r = await send('Runtime.evaluate', {
    expression: `(${OPS.toString()})()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(`页面内异常：${r.exceptionDetails.exception?.description ?? ''}`);
  chromeOut = r.result?.value;
} catch (e) {
  console.error(`失败：${e.message}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}

if (!chromeOut?.rgba) {
  if (!process.exitCode) console.error('没拿到 Chrome 侧像素');
  process.exit(process.exitCode || 1);
}

/* ------------------------------------------------------------------ 比 */

const shim = runShim();
const A = shim.rgba;
const B = chromeOut.rgba;
if (A.length !== B.length) {
  console.error(`像素数不同：垫片 ${A.length / 4} vs Chrome ${B.length / 4}`);
  process.exit(1);
}

const W = shim.w;
const H = shim.h;
const rows = [
  { name: '带1 drawImage 九参 blit（含透明角）', y0: 0, y1: 8 },
  { name: '带2 globalAlpha 0.34 暖色覆盖', y0: 8, y1: 16 },
  { name: '带3 迷雾 rgba0.52 + multiply 叠色', y0: 16, y1: 24 },
];

let globalMax = 0;
let totalNonZero = 0;
let totalPx = 0;
const report = [];
for (const band of rows) {
  let max = 0;
  let sum = 0;
  let n = 0;
  let worst = null;
  for (let y = band.y0; y < band.y1; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) {
        const d = Math.abs(A[i + c] - B[i + c]);
        if (d > max) { max = d; worst = { x, y, c, shim: A[i + c], chrome: B[i + c] }; }
        if (d > 0) totalNonZero++;
        sum += d;
        n++;
      }
    }
  }
  totalPx += (band.y1 - band.y0) * W;
  globalMax = Math.max(globalMax, max);
  report.push({ band, max, avg: sum / n, worst });
}

console.log(`垫片 ${W}×${H} vs 真 Chrome —— 同一段指令（${OPS.name}）`);
for (const { band, max, avg, worst } of report) {
  console.log(
    `  ${band.name}\n    通道 max|Δ| = ${max}   avg|Δ| = ${avg.toFixed(3)}` +
      (worst ? `   最差点 (x${worst.x},y${worst.y}) ch${'RGBA'[worst.c]} 垫片${worst.shim} vs Chrome${worst.chrome}` : ''),
  );
}
const ch = ['R', 'G', 'B', 'A'];
console.log(
  `\n总计：通道 max|Δ| = ${globalMax}；非零差异样本占比 ` +
    `${((totalNonZero / (totalPx * 4)) * 100).toFixed(1)}%`,
);
if (globalMax <= 1) {
  console.log('结论：所有算子在 ±1 LSB 内一致 ⇒ 垫片合成**忠实**，artshot 的对照/数字可作为 Chrome 行为的代理。');
} else {
  console.log('结论：存在 >1 LSB 的结构性偏移 ⇒ 垫片某算子不忠实，artshot 结论必须加「垫片限定」。');
}
console.log(`（通道序 ${ch.join('')}；±1 LSB 是 8-bit 取整差的正常范围，不算不忠实。）`);

process.exit(globalMax <= 1 ? 0 : 1);
