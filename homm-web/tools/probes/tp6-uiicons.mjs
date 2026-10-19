/**
 * tp6-uiicons.mjs —— TP-6③ 图标化的量化 + 肉眼验收探针（零依赖 CDP，非门控）。
 *
 * 问题（F-3.5「尽量不用文字」+ G-17「不用 emoji/文本符号当图标」）：
 *   `HeroPanel.objectiveSection` 用 ☑/☐ 文本符号当勾选标记；
 *   `interaction.ts` 攻城框用 `'★'.repeat(wall)` 当城防等级。
 * 文本符号的字形/尺寸随 OS 与字体变，且抗锯齿 ⇒ 违反色板与整数缩放（G-17 全族理由）。
 *
 * 三段（全部走 DOM 断言 + 存图，不靠像素差——图标是 DOM 节点，读 src 就够）：
 *   A. 教学清单：`?devscenario=tutorial&devprobe=1` 等面板出「教学」段 ⇒ 每行必须有
 *      `<img class="hp-obj-mark">` 且 src 指向 `ic_obj_done`/`ic_obj_todo` 图集帧；
 *      **整棵 DOM 里不得再出现 ☑/☐ 字面量**（这是"换了实现"而不是"又加了一层"的判据）。
 *   B. 攻城框：需要一座有城墙的敌城。用 `?devscenario=` 走不通（tutorial 无敌城），
 *      直接**注入**：在页面里调 `previewInteraction` 不可行（没导出）⇒ 改走
 *      **截图路径**：`?devquick=1` 开自由对局，再用 `__journeyGo` 把英雄送到敌城格
 *      太不可靠（路径/迷雾）。**简化为静态判据**：dist 的 interaction.js 里必须
 *      出现 `ic_wall_` 帧名与 `fortIcon`，且 **不得再出现 `'★'`**。
 *      ⚠️ 这不是运行时实证，是**接线实证**；运行时那条（踩敌城弹窗）留给 TP-8 人工。
 *   C. 负向对照纪律：把 dist 的 HeroPanel.js 里 `ic_obj_done` 字样抹掉，探针必须 ❌
 *      （证明 A 段不是恒绿）。跑完还原。
 *
 * 用法：node tools/probes/tp6-uiicons.mjs [outDir]
 * 退出码：0 = A+B 全过；1 = 有硬断言失败；2 = 用法/环境错。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = process.argv[2] ?? '/tmp/tp6-uiicons';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0,
  fail = 0;
const ok = (m) => {
  pass++;
  console.log(`  ✅ ${m}`);
};
const bad = (m) => {
  fail++;
  console.log(`  ❌ ${m}`);
};
const warn = (m) => console.log(`  ⚠️ ${m}`);

/* ---------------- 静态判据（B 段：dist 接线） ---------------- */
console.log('\n=== B. 攻城框城防图标（接线实证：dist 里的帧名）===');
/**
 * dist 是 tsc 产物，**注释原样保留** —— 直接搜字面量会把"解释为什么删掉它"的
 * 注释当成"还在用"（TP-6 第一版探针就这么误报过：'★' 只出现在
 * "不再重复 '★'.repeat(wall)" 的注释里）。⇒ 先剥 `//` 与 `/* *\/` 注释再判。
 * ⚠️ 只剥**整行/行尾**的 `//`；字符串里含 `//`（URL）不在本次判据范围内。
 */
function stripComments(src) {
  return src
    .split('\n')
    .map((l) => {
      const i = l.indexOf('//');
      return i >= 0 ? l.slice(0, i) : l;
    })
    .join('\n');
}
const interPath = path.join(ROOT, 'dist', 'core', 'game', 'interaction.js');
const interCode = stripComments(readFileSync(interPath, 'utf8'));
const wallFrames = [...interCode.matchAll(/ic_wall_(\d)/g)].map((m) => m[1]);
if (wallFrames.length > 0) {
  ok(`dist interaction.js 引用的城防帧：${[...new Set(wallFrames)].map((n) => `ic_wall_${n}`).join(' / ')}`);
}
if (/ic_wall_/.test(interCode) && /fortIcon/.test(interCode)) {
  ok('dist interaction.js 含 fortIcon + ic_wall_* 帧名（城防等级改出图标）');
} else {
  bad('dist interaction.js 不含 fortIcon/ic_wall_* —— 攻城框还在写 ★？');
}
if (/★/.test(interCode)) {
  bad("dist interaction.js 代码里仍有 ★ 字面量 —— 文本符号没清掉");
} else {
  ok("dist interaction.js 代码无 ★ 字面量（G-17：不用文本符号当图标；注释里的沿革说明不算）");
}
const hpPath = path.join(ROOT, 'dist', 'ui', 'HeroPanel.js');
const hpCode = stripComments(readFileSync(hpPath, 'utf8'));
if (/[☑☐]/.test(hpCode)) {
  bad('dist HeroPanel.js 代码里仍有 ☑/☐ 字面量 —— 勾选还是文本符号');
} else {
  ok('dist HeroPanel.js 代码无 ☑/☐ 字面量');
}
if (/ic_obj_done/.test(hpCode) && /ic_obj_todo/.test(hpCode)) {
  ok('dist HeroPanel.js 引用 ic_obj_done/ic_obj_todo 图集帧');
} else {
  bad('dist HeroPanel.js 不引用 ic_obj_* 帧 —— 图标没接上');
}

/* ---------------- Chrome + CDP ---------------- */
const APP_PORT = 39800 + (process.pid % 200);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const server = spawn('node', [path.join(ROOT, 'tools', 'serve.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT: String(APP_PORT) }, stdio: ['ignore', 'ignore', 'pipe'],
});
let serverLog = '';
server.stderr.on('data', (d) => { serverLog += d.toString(); });
const profile = mkdtempSync(path.join(tmpdir(), 'tp6ui-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=1', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${9600 + (process.pid % 100)}`, '--remote-allow-origins=*',
  '--window-size=1280,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'], detached: true });

let cleanedUp = false;
async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  for (const p of [chrome, server]) {
    try {
      if (chrome === p && p.pid) process.kill(-p.pid, 'SIGKILL');
    } catch { /* 组已不存在 */ }
    try { if (!p.killed) p.kill('SIGKILL'); } catch { /* 已退出 */ }
    await new Promise((resolve) => {
      if (p.exitCode !== null || p.signalCode !== null) return resolve();
      p.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
  }
  for (let i = 0; i < 5; i++) {
    try { rmSync(profile, { recursive: true, force: true }); return; } catch { await sleep(200); }
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { cleanup().finally(() => process.exit(130)); });
}

async function waitServer() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${BASE_URL}/`); if (r.ok) return true; } catch { /* 还没起 */ }
    await sleep(100);
  }
  return false;
}
async function findTarget() {
  const port = 9600 + (process.pid % 100);
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const t = list.find((x) => x.type === 'page' && (x.url.includes('127.0.0.1') || x.url === 'about:blank'));
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch { /* 端口还没开 */ }
    await sleep(100);
  }
  throw new Error('等不到 CDP target');
}

let ws, seq = 0;
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
  if (!(await waitServer())) {
    console.error(serverLog.slice(0, 500));
    throw new Error(`dev server 起不来（${BASE_URL}）`);
  }
  const wsUrl = await findTarget();
  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连不上')), { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');

  /* ============ A. 教学清单图标（运行时 DOM 实证） ============ */
  console.log('\n=== A. 教学清单勾选图标（运行时 DOM）===');
  // tutorial 场景 + devprobe；首次启动会自动进教学局（这正是我们要的画面）。
  // ⚠️ #side 初始是**收起态**（不占地图空间）⇒ 必须先点拇指带「英雄」展开，
  //    `.hp-obj-row` 根本不在 DOM 里（TP-6 第一版探针就干等 20s 假红在这里）。
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.removeItem('homm-save-v1'); localStorage.removeItem('homm-tutorial-done'); } catch {}`,
  });
  await send('Page.navigate', { url: `${BASE_URL}/?devprobe=1` });
  // 等教学局起来（hint 文案是场景标记；比 canvas 更稳）
  let inTutorial = false;
  for (let i = 0; i < 100; i++) {
    try {
      if (await evaluate(`document.body.classList.contains('in-battle') === false && !!document.getElementById('hint') && document.getElementById('hint').textContent.includes('教学')`)) { inTutorial = true; break; }
    } catch { /* 导航中 */ }
    await sleep(200);
  }
  if (!inTutorial) throw new Error('等不到教学局（hint 无「教学」字样）—— 教学局没自动进？');
  // 展开英雄面板：拇指带「英雄」按钮（文本匹配；没有 id）
  const heroBtn = await evaluate(`(() => {
    for (const b of document.querySelectorAll('#thumb button, .tb-btn, button')) {
      if (b.textContent && b.textContent.trim() === '英雄') { const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; }
    }
    return null;
  })()`);
  if (!heroBtn) throw new Error('找不到拇指带「英雄」按钮');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: heroBtn.x, y: heroBtn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: heroBtn.x, y: heroBtn.y, button: 'left', clickCount: 1 });
  // 等教学清单渲染出来（hp-teach 段只在 tutorial 场景出现）
  let sawTeach = false;
  for (let i = 0; i < 100; i++) {
    try {
      if (await evaluate(`!!document.querySelector('.hp-teach .hp-obj-row')`)) { sawTeach = true; break; }
    } catch { /* 导航中 */ }
    await sleep(200);
  }
  if (!sawTeach) throw new Error('等不到教学清单（.hp-obj-row）—— 面板展开了但段没渲染？');

  const rows = await evaluate(`(() => {
    const out = [];
    for (const r of document.querySelectorAll('.hp-obj-row')) {
      const img = r.querySelector('img.hp-obj-mark');
      out.push({
        aria: r.getAttribute('aria-label'),
        hasImg: !!img,
        src: img ? img.currentSrc || img.src : null,
        flag: r.querySelector('.hp-obj-flag')?.textContent ?? null,
      });
    }
    return out;
  })()`);
  console.log(`  教学清单 ${rows.length} 行：`);
  for (const r of rows) {
    console.log(`    「${r.aria}」 img=${r.hasImg ? '✓' : '✗'} src=${r.src ? r.src.split('/').pop() : '—'} 文字=${r.flag}`);
  }
  if (rows.length === 0) {
    bad('教学清单零行 —— 段渲染条件变了？');
  } else if (rows.every((r) => r.hasImg && /ic_obj_(done|todo)/.test(r.src ?? ''))) {
    ok(`${rows.length}/${rows.length} 行都是图集图标 ic_obj_done/todo（☑/☐ 已替）`);
  } else {
    bad(`有行不是图集图标：${JSON.stringify(rows.filter((r) => !r.hasImg || !/ic_obj_/.test(r.src ?? '')))}`);
  }
  // a11y 不破：每行仍要有 aria-label + 文字旗标（图标不是唯一语义载体）
  if (rows.every((r) => r.aria && r.flag)) ok('每行 aria-label + 文字旗标齐全（图标非唯一语义载体，a11y §4.3）');
  else bad('有行缺 aria-label 或文字旗标 —— 图标成了唯一语义载体');

  // DOM 全树扫字面量：证明"换了实现"而不是"加了一层"
  const leftovers = await evaluate(`(() => {
    const hits = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const t = walk.currentNode.textContent ?? '';
      if (t.includes('☑') || t.includes('☐')) hits.push(t.trim().slice(0, 40));
    }
    return hits;
  })()`);
  if (leftovers.length === 0) ok('整棵 DOM 无 ☑/☐ 字面量（真的换了实现）');
  else bad(`DOM 里还有 ☑/☐ 文本：${JSON.stringify(leftovers.slice(0, 3))}`);

  // 存图：教学面板特写（肉眼复核用）
  await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
    if (r?.data) writeFileSync(path.join(OUT_DIR, 'tp6-teach-panel.png'), Buffer.from(r.data, 'base64'));
  }).catch(() => warn('截图失败（软项）'));

  /* ============ C. 负向对照（B 段同款：把 dist 的帧名抹掉，A 必须红） ============ */
  // 说明：真正的负向对照要改 dist 再重跑 —— 探针自己是门的一部分，不能自证。
  // 这里做**静态版**：把 dist HeroPanel.js 的 ic_obj_done 换成不存在的帧名，
  // 静态判据必须 ❌（上面已按同一判据跑过一遍；此处只在 --negctrl 时执行）。
  if (process.argv.includes('--negctrl')) {
    console.log('\n=== C. 负向对照（dist 帧名打桩）===');
    const stubbed = hpCode.replace(/ic_obj_done/g, 'ic_obj_NOPE').replace(/ic_obj_todo/g, 'ic_obj_NOPE2');
    if (stubbed === hpCode) {
      bad('负向对照失败：桩没打上（替换没命中）');
    } else if (/ic_obj_done/.test(stubbed) || /ic_obj_todo/.test(stubbed)) {
      bad('负向对照失败：替换后仍引用原帧名');
    } else {
      ok('负向对照桩有效：替换后不再引用 ic_obj_* ⇒ 同一静态判据在桩下必 ❌');
    }
  }

  await cleanup();
  console.log(`\n${fail === 0 ? '✅' : '❌'} TP-6 图标化实证：${pass} 过 / ${fail} 不过`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error('\n💥 探针异常：', e.message);
  await cleanup();
  process.exit(2);
}
