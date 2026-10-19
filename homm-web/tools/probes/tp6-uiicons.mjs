/**
 * tp6-uiicons.mjs —— TP-6③ 图标化的量化 + 肉眼验收探针（零依赖 CDP，非门控）。
 *
 * 问题（F-3.5「尽量不用文字」+ G-17「不用 emoji/文本符号当图标」）：
 *   `HeroPanel.objectiveSection` 用 ☑/☐ 文本符号当勾选标记；
 *   `interaction.ts` 攻城框用 `'★'.repeat(wall)` 当城防等级。
 * 文本符号的字形/尺寸随 OS 与字体变，且抗锯齿 ⇒ 违反色板与整数缩放（G-17 全族理由）。
 *
 * 三段：
 *   A. 教学清单（运行时 DOM）：教学局 → 展开英雄面板 → 切「属性」段 ⇒ 每行必须有
 *      `<img class="hp-obj-mark">` 且 src **精确等于**页面内 `getAtlas().url('ic_obj_done')`
 *      或 `url('ic_obj_todo')`；**整棵 DOM 里不得再出现 ☑/☐ 字面量**（这是"换了实现"
 *      而不是"又加了一层"的判据）。
 *   B. 攻城框（静态接线实证）：dist 的 interaction.js 必须出现 `ic_wall_` 帧名与
 *      `fortIcon`，且代码里不得再出现 `'★'`（注释剥掉再判——tsc 保留注释，
 *      第一版探针把"解释为什么删掉它"的注释当成"还在用"误报过）。
 *      ⚠️ 运行时那条（踩敌城弹窗）留给 TP-8 人工。
 *   C. 负向对照（**运行时**，仅 --negctrl）：把 dist/ui/HeroPanel.js 的
 *      `ic_obj_done/todo` 换成不存在的帧名后**重跑 A 段**，必须转 ❌
 *      （证明 A 段不是恒绿；跑完还原 dist 并校验还原结果）。
 *
 * 用法：node tools/probes/tp6-uiicons.mjs [outDir] [--negctrl]
 * 退出码：0 = A+B 全过（+C 负向对照生效）；1 = 有硬断言失败；2 = 用法/环境错。
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
  /**
   * 走一遍：教学局 → 展开英雄面板 → 切「属性」段 → 读教学清单每行的 img。
   * 自带 {p, f} 计数并返回（负向对照要用：打桩后重跑必须 f>0，且不污染总账）。
   *
   * 三个坑（都踩过，写在这里为了下一个人）：
   *   ① `#side` 初始**收起态** ⇒ `.hp-obj-row` 根本不在 DOM，先点拇指带「英雄」；
   *   ② `hp-teach` 落**「属性」段**首行（#156 现行 spec），默认段是「部队」
   *      ⇒ 必须再点「属性」tab（TP-6 探针 A 段两次假红都在这两个坑上）；
   *   ③ 图集 url 是 **data: URL**（内联 PNG，帧名不在 src 里）⇒ 判据 = 与页面内
   *      `getAtlas().url('ic_obj_done'/'ic_obj_todo')` **精确串比**（url() 按名缓存，
   *      确定性；未知帧返回 '' ⇒ 打桩后必然不匹配 ⇒ 负向对照天然敏感）。
   */
  async function teachIconCheck(tag) {
    let p = 0, f = 0;
    const ok = (m) => { p++; console.log(`  ✅ ${m}`); };
    const bad = (m) => { f++; console.log(`  ❌ ${m}`); };
    console.log(`\n=== ${tag} 教学清单勾选图标（运行时 DOM）===`);
    // tutorial 场景 + devprobe；首次启动会自动进教学局（这正是我们要的画面）。
    // ⚠️ 不要加 ?devstart=1 —— 它会跳过自动教学落开始页，教学清单再也不出现。
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
    // 等面板展开（tab 条渲染 = 面板真的上屏）
    let sawTabs = false;
    for (let i = 0; i < 100; i++) {
      try {
        if (await evaluate(`!!document.querySelector('.hp-tabs .hp-tab')`)) { sawTabs = true; break; }
      } catch { /* 导航中 */ }
      await sleep(200);
    }
    if (!sawTabs) throw new Error('面板展开了但 tab 条没渲染');
    // ★ 切段：`hp-teach` 落「属性」段首行（#156 现行 spec），默认段是「部队」
    //   ⇒ `.hp-obj-row` 不在 DOM 里，必须点「属性」tab。
    const attrTab = await evaluate(`(() => {
      for (const b of document.querySelectorAll('.hp-tabs .hp-tab')) {
        if (b.textContent && b.textContent.trim() === '属性') { const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; }
      }
      return null;
    })()`);
    if (!attrTab) throw new Error('找不到「属性」tab（段键改了？）');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: attrTab.x, y: attrTab.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: attrTab.x, y: attrTab.y, button: 'left', clickCount: 1 });
    // 等教学清单渲染出来（hp-teach 段只在 tutorial 场景 + 「属性」段出现）
    let sawTeach = false;
    for (let i = 0; i < 100; i++) {
      try {
        if (await evaluate(`!!document.querySelector('.hp-teach .hp-obj-row')`)) { sawTeach = true; break; }
      } catch { /* 导航中 */ }
      await sleep(200);
    }
    if (!sawTeach) throw new Error('等不到教学清单（.hp-obj-row）—— 面板展开了、段也切了，但段没渲染？');

    // 帧名判据：页面内 import 图集模块，拿两个合法帧的 data URL 精确串比。
    // （unknown frame ⇒ url() 返回 '' ⇒ 必然不匹配 ⇒ 负向对照敏感。）
    const probe = await evaluate(`(async () => {
      const atlas = await import('/render/atlas.js');
      const a = atlas.getAtlas();
      const doneUrl = a.url('ic_obj_done');
      const todoUrl = a.url('ic_obj_todo');
      const out = [];
      for (const r of document.querySelectorAll('.hp-obj-row')) {
        const img = r.querySelector('img.hp-obj-mark');
        const src = img ? img.currentSrc || img.src : null;
        out.push({
          aria: r.getAttribute('aria-label'),
          hasImg: !!img,
          frame: src === doneUrl ? 'ic_obj_done' : src === todoUrl ? 'ic_obj_todo' : null,
          flag: r.querySelector('.hp-obj-flag')?.textContent ?? null,
        });
      }
      return { doneUrl, todoUrl, rows: out };
    })()`);
    if (!probe) throw new Error('帧名探针没返回');
    if (probe.doneUrl && probe.todoUrl && probe.doneUrl !== probe.todoUrl) {
      ok('图集里 ic_obj_done / ic_obj_todo 是两个不同的非空帧（done≠todo）');
    } else {
      bad(`图集帧异常：done=${probe.doneUrl ? '有' : '空'} todo=${probe.todoUrl ? '有' : '空'} 相同=${probe.doneUrl === probe.todoUrl}`);
    }
    const rows = probe.rows;
    console.log(`  教学清单 ${rows.length} 行：`);
    for (const r of rows) {
      console.log(`    「${r.aria}」 img=${r.hasImg ? '✓' : '✗'} 帧=${r.frame ?? '✗ 非图集帧'} 文字=${r.flag}`);
    }
    if (rows.length === 0) {
      bad('教学清单零行 —— 段渲染条件变了？');
    } else if (rows.every((r) => r.frame === 'ic_obj_done' || r.frame === 'ic_obj_todo')) {
      ok(`${rows.length}/${rows.length} 行都是图集帧 ic_obj_done/todo（☑/☐ 已替，src 精确串比）`);
    } else {
      bad(`有行不是图集帧：${JSON.stringify(rows.filter((r) => r.frame !== 'ic_obj_done' && r.frame !== 'ic_obj_todo'))}`);
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
    return { p, f };
  }
  {
    const r = await teachIconCheck('A.');
    pass += r.p; fail += r.f;
  }

  /* ============ C. 负向对照（真·运行时：打桩 dist 后重跑 A 段，必须红） ============ */
  // 纪律（项目铁律②）：每个新闸都要有负向对照——插桩造失败，确认判据不是恒绿。
  // 静态版（对源字符串打桩）不够：它证不了"运行时判据会红"。这里**真改 dist 再重跑**：
  //   ① 备份 dist/ui/HeroPanel.js；② `ic_obj_done/todo` → 不存在的帧名（url() 返回 ''，
  //      src 精确串比必然不匹配）；③ 重跑 A 段必须 f>0；④ 还原并逐字节校验还原结果。
  //   ⚠️ dist 是测量对象（team-lead #164）——打桩是**临时**的，finally 里还原，
  //      还原后与备份逐字节比对，不一致 = 硬失败（不能带着脏 dist 离开）。
  if (process.argv.includes('--negctrl')) {
    console.log('\n=== C. 负向对照（dist 打桩 → 重跑 A 段 → 必须 ❌ → 还原）===');
    const hpBak = readFileSync(hpPath);
    const stubbed = hpBak.toString('utf8').replace(/ic_obj_done/g, 'ic_obj_NOPE').replace(/ic_obj_todo/g, 'ic_obj_NOPE2');
    if (stubbed === hpBak.toString('utf8')) {
      bad('负向对照失败：桩没打上（替换没命中）');
    } else {
      writeFileSync(hpPath, stubbed);
      let r;
      try {
        r = await teachIconCheck('C1. 负向对照（ic_obj_* → ic_obj_NOPE*）');
      } finally {
        writeFileSync(hpPath, hpBak);
      }
      if (readFileSync(hpPath).equals(hpBak)) ok('dist 已还原（与备份逐字节一致）');
      else bad('dist 还原失败！备份与还原后不一致 —— 立即手动检查 dist/ui/HeroPanel.js');
      if (r && r.f > 0) ok(`负向对照生效：打桩后 A 段 ${r.f} 条判据转 ❌ ⇒ 正式跑的绿不是恒绿`);
      else bad('负向对照失败：打桩后 A 段仍全绿 —— 判据恒真，这道门是摆设');
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
