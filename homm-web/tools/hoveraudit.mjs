/**
 * 战斗"悬停印记残留"回归测试（CDP 版）。
 *
 * 玩家反馈："施法后，那个施法的印记没有消失，一直留在战场上"。
 * 根因是 BattleScreen 的 `hover`（战场上的白色六边形描边）只在 pointermove
 * 时刷新，动作结束后没人清理 —— 鼠标停在原地不动，那圈白框就一直挂着，
 * 看着就像施法留下的印记。修法是 clearAim()：每条动作出口都清一次。
 *
 * **这种 bug 截图看不出来**（headless 截图没有鼠标，压根复现不了）。
 * 所以要真把事件打进去，再读每帧实际画出去的那个悬停格
 * （BattleScreen 在 opts.debugProbe 下会写到 window.__battleHover）。
 *
 * 两个已经踩过的坑，别再走一遍：
 *   1) 不能用 --virtual-time-budget：虚拟时间下 requestAnimationFrame **不触发**，
 *      战斗的渲染循环根本不跑，__battleHover 永远是 undefined。
 *      必须用真实时间 + CDP（Runtime.evaluate awaitPromise）来驱动。
 *   2) chrome 一定要带 --user-data-dir=<临时目录>，否则会去动用户自己的
 *      Chrome 配置目录。
 *
 * 用法：npm run build && node tools/serve.mjs（另开终端）&& node tools/hoveraudit.mjs
 */
import { writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { argOf, distDir, printHeader, freePort, serveInProcess } from './_dist.mjs';

const root = process.cwd();
/* `--dist=<dir>`（缺省 `<cwd>/dist` = 旧行为，**逐字不变**）—— team-lead #164。 */
const dist = distDir({ base: root });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/* 端口（#164 要求②）：`--port=<n>` / env `PORT` ⇒ 连**调用方给的**；否则取**空闲端口**自起。 */
const PORT_ARG = argOf('port', null) ?? process.env.PORT ?? null;
const APP_PORT = PORT_ARG ? Number(PORT_ARG) : await freePort();
// 每次用不同端口：固定端口下若上一轮 Chrome 没退干净，findTarget 会连到那个**陈旧**实例、
// 量到旧 DOM（假 PASS/假 FAIL——对验证工具而言是最糟的失效方式）。
// 按 PID 派生端口，并与 tinytargetaudit.mjs 的 9200 段错开（9900 起），两个审计并行也不串台。
const CDP_PORT = 9900 + (process.pid % 90);
const PROBE_NAME = '_hoverprobe.html';
const PROBE = path.join(dist, PROBE_NAME);

/* ★ 首行打印「我服务的目录 + cwd + 指纹」（#164 要求③）。 */
printHeader(dist, `gate=hoveraudit · port=${APP_PORT}`);

if (!existsSync(path.join(dist, 'ui', 'BattleScreen.js'))) {
  console.error(`✗ ${dist}/ui/BattleScreen.js 不存在 —— 先 npm run build（或 --dist=<dir> 指向隔离构建）`);
  process.exit(2);
}

/** 探针页：只负责摆好一场战斗并打开 debugProbe，测试序列由 CDP 注入 */
writeFileSync(
  PROBE,
  `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./style.css">
<style>html,body{margin:0;background:#14181f;overflow:hidden}#stage{position:fixed;inset:0}</style>
<div id="stage"></div>
<script type="module">
import { openBattleScreen } from './ui/BattleScreen.js';
const state = { heroes: {} };
openBattleScreen(document.getElementById('stage'), {
  state, heroId: 'h', title: '悬停残留回归',
  attacker: { army: [
    { unitTypeId: 'archer', count: 30 }, { unitTypeId: 'pikeman', count: 20 }, { unitTypeId: 'knight', count: 8 },
  ], attack: 6, defense: 3, caster: { spells: ['magicArrow', 'lightningBolt', 'bless', 'haste'], spellPower: 3, mana: 40 }, warMachines: [] },
  defender: { army: [
    { unitTypeId: 'ogre', count: 6 }, { unitTypeId: 'wolf', count: 12 },
  ], attack: 0, defense: 4 },
  seed: 7,
  debugProbe: true,
  onDone: () => {},
});
window.__probeReady = true;
</script>
`,
  'utf8',
);

// 探针页要经 dev server 提供（./ui/... 是相对路径，file:// 起不来）
// `#164` 要求②：没给 `--port` 时**取空闲端口进程内自起** serve.mjs 指向 `dist`（不 spawn 子进程）。
try {
  const res = await fetch(`http://127.0.0.1:${APP_PORT}/${PROBE_NAME}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch {
  const okSrv = await serveInProcess(dist, APP_PORT);
  if (!okSrv) {
    console.error(`✗ dev server 起不来（dir=${dist} :${APP_PORT}）—— 手工跑 node tools/serve.mjs 再看`);
    rmSync(PROBE, { force: true });
    process.exit(2);
  }
}

const profile = mkdtempSync(path.join(tmpdir(), 'hoveraudit-'));
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
    `http://127.0.0.1:${APP_PORT}/${PROBE_NAME}`,
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 收尾：等 chrome 真的退出再删临时 profile。
 * 直接 kill 完就 rmSync 会撞上 ENOTEMPTY —— 它还在往 Default/ 里写东西。
 */
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
      await sleep(200); // 文件句柄还没放干净，等一下再试
    }
  }
  console.warn(`（临时 profile 没删掉，可手动清理：${profile}）`);
}

/** 等 CDP 起来并拿到页面 target */
async function findTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const t = list.find((x) => x.type === 'page' && x.url.includes(PROBE_NAME));
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch {
      /* 端口还没开，继续等 */
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

/** 在页面里跑一段 async 代码，拿回结构化结果 */
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

/** 注入到页面里跑的测试序列（真实时间，rAF 会正常触发） */
const TEST = `(async () => {
  const out = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n) => new Promise((r) => {
    let i = 0;
    const step = () => (++i >= n ? r() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
  const hover = () => (typeof window.__battleHover === 'undefined' ? undefined : window.__battleHover);
  const btn = (text) =>
    [...document.querySelectorAll('button')].find((x) => x.textContent.includes(text)) ?? null;

  // 等战斗挂载 + 探针开始出数
  for (let i = 0; i < 120; i++) {
    if (window.__probeReady && typeof window.__battleHover !== 'undefined') break;
    await sleep(50);
  }
  out.probeActive = typeof window.__battleHover !== 'undefined';
  const canvas = document.querySelector('canvas');
  out.hasCanvas = !!canvas;
  if (!canvas) return out;

  // 注意：__battleHover 每帧才写一次，别用"固定几帧"去等 ——
  // 无头环境帧率不稳，会读到上一拍的陈旧值（第一版就栽在这）。
  // 用轮询直到条件成立，同时把"等了多久"带回来，方便看出是慢还是真没发生。
  const waitFor = async (pred, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (pred()) return Date.now() - t0;
      await sleep(40);
    }
    return -1;
  };
  // 等演出结束（按钮恢复可用即视为 settle）
  const settle = async () => {
    for (let i = 0; i < 200; i++) {
      const w = btn('等待');
      if (w && !w.disabled) { await frames(3); return; }
      await sleep(40);
    }
  };
  const moveTo = (fx, fy) => {
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: r.left + r.width * fx, clientY: r.top + r.height * fy,
      bubbles: true, cancelable: true, pointerType: 'mouse',
    }));
  };

  await settle();

  // 1) 悬停必须能画出白框
  moveTo(0.5, 0.55);
  out.hoverMs = await waitFor(() => hover() != null);
  out.afterHover = hover();

  // 2) 点"等待"清场 —— 回归点：以前白框会留在原地不动
  btn('等待')?.click();
  out.clearedMs = await waitFor(() => hover() == null);
  out.afterWait = hover();

  // 3) 悬停要能重新出现（别把功能修没了）
  await settle();
  moveTo(0.5, 0.55);
  out.hover2Ms = await waitFor(() => hover() != null);
  out.afterHover2 = hover();

  // 4) 打开法术书（selectSpell 出口）—— 用户报的施法路径
  btn('施法')?.click();
  out.cleared2Ms = await waitFor(() => hover() == null);
  out.afterSpellbook = hover();

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
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  await send('Runtime.enable');
  results = await evaluate(TEST);
} catch (e) {
  console.error(`跑探针失败：${e.message}`);
  await cleanup();
  process.exit(2);
}

await cleanup();

const j = (v) => JSON.stringify(v ?? null);
const ms = (v) => (v < 0 ? '超时' : `${v}ms`);
console.log('探针输出：');
console.log(`  __battleHover 探针已启用 = ${results.probeActive}`);
console.log(`  悬停后            = ${j(results.afterHover)}  （等了 ${ms(results.hoverMs)}）`);
console.log(`  点"等待"后        = ${j(results.afterWait)}   （等了 ${ms(results.clearedMs)}）`);
console.log(`  再次悬停后        = ${j(results.afterHover2)}   （等了 ${ms(results.hover2Ms)}）`);
console.log(`  打开法术书后      = ${j(results.afterSpellbook)}   （等了 ${ms(results.cleared2Ms)}）`);

let bad = 0;
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) bad++;
};

console.log('');
if (!results.probeActive || !results.hasCanvas) {
  console.log('FAIL  探针没起来（检查 dev server / build）');
  process.exit(2);
}
check('悬停时白框出现（本来就会画）', results.afterHover != null);
check('点"等待"后白框消失（回归点）', results.afterWait == null);
check('再次悬停白框回来（功能没被修掉）', results.afterHover2 != null);
check('打开法术书后白框消失（用户报的施法路径）', results.afterSpellbook == null);

console.log(bad === 0 ? '\n全部通过：悬停印记不再残留' : `\n${bad} 项不合格`);
process.exit(bad === 0 ? 0 : 1);
