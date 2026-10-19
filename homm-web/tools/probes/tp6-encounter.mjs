/**
 * tp6-encounter.mjs —— TP-6② 遭遇框结论化（F-3.4）量化验收探针（零依赖 CDP，非门控）。
 *
 * F-3.4 用户原话痛点：「遇到野兵要提示什么，对方兵力，看守者预估结果，然后每个都是
 * 一行，然后我方兵力，敌方兵力，然后再重复一遍……然后才有选项，然后如果你如果想要做
 * 选择的话，你要拉到最下面」。
 * **派生验收尺子**（playtest-feedback.md F-3.4 派生条）：
 *   ① 消息压到 **2 行**（一个换行符）；
 *   ② **不再重复**「我方兵力 / 敌方兵力」（玩家自己知道）；
 *   ③ 保留「打不打得过」这个**决策结论**（可以取胜/难以攻克）且在第 2 行首；
 *   ④ **选项首屏可见、不滚动**（modal 无滚动条 + 两个按钮都在视口内）。
 *
 * 三段：
 *   A. 内容侧（node 单测 `previewInteraction` 纯函数，dist 同代码）：
 *      tutorial 局（seed 247944 固定）的野怪 + 默认局（seed 12345）的中立城 siege。
 *   B. 布局侧（运行时 DOM）：教学局 `__journeyGo` 踩最近的狼 ⇒ 弹遭遇框 ⇒ 量
 *      `.modal` scrollHeight ≤ clientHeight（无滚动）+ 两个按钮 rect 在视口内 + 两行。
 *   C. 负向对照（仅 --negctrl）：把「坏消息」样本喂给 A 段同一断言函数，必须 ❌
 *      （三行消息 / 缺结论 / 写了我方兵力 —— 证明 A 段判据不是恒绿）。
 *   D. F-3.6 第 3 条复查（运行时）：当前单位高亮（选中态接线）+ 可达染色层
 *      **真的在画** —— 同会话两帧像素 A/B，唯一变量 = `renderer.tintEnabled`
 *      （开 vs 关差异 ≥800 px；negctrl 的 关 vs 关残差必须 < 主差异 10%——
 *      绝对残差几千 px 是脉冲动画的正常呼吸，判据量的是"小一个量级"）。
 *
 * 用法：node tools/probes/tp6-encounter.mjs [outDir] [--negctrl]
 * 退出码：0 = A+B 全过（+C 负向对照生效）；1 = 有硬断言失败；2 = 用法/环境错。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = process.argv[2] ?? '/tmp/tp6-encounter';
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

/* ================= A. 内容侧：previewInteraction 纯函数断言 ================= */

const { createGame } = await import(path.join(ROOT, 'dist', 'core', 'map', 'generator.js'));
const { SCENARIO_BY_ID, scenarioGenOptions } = await import(path.join(ROOT, 'dist', 'core', 'data', 'scenarios.js'));
const { previewInteraction } = await import(path.join(ROOT, 'dist', 'core', 'game', 'interaction.js'));

/**
 * F-3.4 派生四条判据。返回错误列表（空 = 过）。
 * 负向对照也用它：喂"坏消息"必须返回非空 ⇒ 判据不恒绿。
 */
function checkEncounter(pending, tag) {
  const errs = [];
  if (!pending) return [`${tag}: previewInteraction 返回 null`];
  const lines = String(pending.message ?? '').split('\n');
  if (lines.length !== 2) errs.push(`${tag}: 消息 ${lines.length} 行（F-3.4① 要求恰好 2 行）`);
  if (/我方兵力|敌方兵力/.test(pending.message ?? '')) errs.push(`${tag}: 消息里重复了「我方/敌方兵力」（F-3.4②）`);
  const concl = lines[1] ?? '';
  if (!/可以取胜|难以攻克|可以攻下/.test(concl)) errs.push(`${tag}: 第 2 行没有「打不打得过」结论（F-3.4③）`);
  if (!pending.confirmLabel || !pending.cancelLabel) errs.push(`${tag}: 缺 confirm/cancel 标签（选项不成对）`);
  return errs;
}

console.log('\n=== A. 遭遇框内容侧（previewInteraction 纯函数，dist 同代码）===');
{
  // ① tutorial 局（seed 247944 固定 ⇒ 复现性强）：野怪遭遇
  const tut = createGame(scenarioGenOptions(SCENARIO_BY_ID['tutorial']));
  const monObj = Object.values(tut.map.objects).find((o) => o.kind === 'wanderingMonster');
  const p1 = previewInteraction(tut, 'hero1', monObj.id);
  const e1 = checkEncounter(p1, 'tutorial 野怪');
  console.log(`  「${p1?.title}」消息：\n${String(p1?.message).split('\n').map((l) => `    | ${l}`).join('\n')}`);
  if (e1.length === 0) ok('tutorial 野怪框：两行 / 无我方兵力重复 / 有结论 / 选项成对');
  else e1.forEach((e) => bad(e));

  // ② 默认局（seed 12345 固定）：中立城 siege（TP-6③ 的 fortIcon 也一并验）
  const def = createGame({ seed: 12345, opponents: 1 });
  // ⚠️ 必须挑**中立/敌方**的城：find 第一个 town 对象会拿到我方主城（"我方据点。"
  //    一行、无选项）——第一版探针就这么假红过。
  const neutralTown = Object.values(def.towns).find((t) => t.owner !== 'p1');
  const townObj = Object.values(def.map.objects).find(
    (o) => o.kind === 'town' && o.payload?.townId === neutralTown.id,
  );
  const p2 = previewInteraction(def, 'hero1', townObj.id);
  const e2 = checkEncounter(p2, '默认局中立城');
  console.log(`  「${p2?.title}」消息：\n${String(p2?.message).split('\n').map((l) => `    | ${l}`).join('\n')}`);
  console.log(`    fortIcon=${p2?.fortIcon ?? '（无）'} siegeLevel=${p2?.siegeLevel ?? '—'}`);
  if (e2.length === 0) ok('中立城攻城框（无城墙态）：两行 / 无我方兵力重复 / 有结论 / 选项成对');
  else e2.forEach((e) => bad(e));
  if (p2?.siegeLevel === 0 && !p2.fortIcon && /无城墙，野战/.test(p2.message ?? '')) {
    ok('无城墙态：siegeLevel=0、不出图标、消息明说「无城墙，野战」');
  } else {
    bad(`无城墙态异常：siegeLevel=${p2?.siegeLevel} fortIcon=${p2?.fortIcon}`);
  }
  // 建两级墙（wall2 ∈ 合法建筑态；生成器不给中立城建墙，但玩家自己的城能建）
  // ⇒ siegeLevel=2、fortIcon=ic_wall_2（TP-6③：等级出图标，文本不写 ★）。
  neutralTown.buildings.push('wall2');
  const p3 = previewInteraction(def, 'hero1', townObj.id);
  const e3 = checkEncounter(p3, '两级墙中立城');
  console.log(`  「${p3?.title}」消息（建 wall2 后）：\n${String(p3?.message).split('\n').map((l) => `    | ${l}`).join('\n')}`);
  console.log(`    fortIcon=${p3?.fortIcon ?? '（无）'} siegeLevel=${p3?.siegeLevel ?? '—'}`);
  if (e3.length === 0) ok('两级墙攻城框：两行 / 无我方兵力重复 / 有结论 / 选项成对');
  else e3.forEach((e) => bad(e));
  if (p3?.siegeLevel === 2 && p3.fortIcon === 'ic_wall_2') {
    ok(`有墙态：siegeLevel=2 → fortIcon=ic_wall_2（城防等级改出图标）`);
  } else {
    bad(`有墙态异常：siegeLevel=${p3?.siegeLevel} fortIcon=${p3?.fortIcon}（期望 2 / ic_wall_2）`);
  }
}

/* ================= B. 布局侧：遭遇弹窗运行时（不滚 + 按钮首屏） ================= */

const APP_PORT = 39800 + (process.pid % 200);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const server = spawn('node', [path.join(ROOT, 'tools', 'serve.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT: String(APP_PORT) }, stdio: ['ignore', 'ignore', 'pipe'],
});
let serverLog = '';
server.stderr.on('data', (d) => { serverLog += d.toString(); });
const profile = mkdtempSync(path.join(tmpdir(), 'tp6enc-'));
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
  process.on(sig, () => cleanup().finally(() => process.exit(130)));
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

  /* ============ B. 遭遇弹窗布局（教学局 → journeyGo 踩狼） ============ */
  console.log('\n=== B. 遭遇弹窗布局（运行时：无滚动 + 选项首屏）===');
  // 教学局（?devprobe=1 自动进，无存档且没教过）里 hero1=(4,14)、狼在 (2,15)
  // （node 端同代码复现过，见 A 段）。?devstart 别加——会落开始页。
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.removeItem('homm-save-v1'); localStorage.removeItem('homm-tutorial-done'); } catch {}`,
  });
  await send('Page.navigate', { url: `${BASE_URL}/?devprobe=1` });
  let inTutorial = false;
  for (let i = 0; i < 100; i++) {
    try {
      if (await evaluate(`document.body.classList.contains('in-battle') === false && !!document.getElementById('hint') && document.getElementById('hint').textContent.includes('教学')`)) { inTutorial = true; break; }
    } catch { /* 导航中 */ }
    await sleep(200);
  }
  if (!inTutorial) throw new Error('等不到教学局');
  // __journeyGo 发移动指令（合成点击依赖相机换算，无头下边缘格不可靠——main.ts 原注释）
  await evaluate(`window.__journeyGo && window.__journeyGo(2, 15)`);
  // 等遭遇弹窗（title 含「遭遇」= wanderingMonster 框）
  let sawModal = false;
  for (let i = 0; i < 100; i++) {
    try {
      if (await evaluate(`(() => { const m = document.querySelector('.modal'); return !!m && (m.querySelector('h2')?.textContent ?? '').includes('遭遇'); })()`)) { sawModal = true; break; }
    } catch { /* 导航中 */ }
    await sleep(200);
  }
  if (!sawModal) throw new Error('journeyGo(2,15) 没弹出遭遇框 —— 移动被挡（教学锁？移动力不够？）');

  const m = await evaluate(`(() => {
    const box = document.querySelector('.modal');
    const ps = [...box.querySelectorAll('p')].map((p) => p.textContent ?? '');
    const btns = [...box.querySelectorAll('.actions .btn')].map((b) => ({
      label: b.textContent,
      rect: (() => { const r = b.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; })(),
    }));
    return {
      scrollH: box.scrollHeight, clientH: box.clientHeight,
      boxRect: (() => { const r = box.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })(),
      viewH: window.innerHeight,
      ps, btns,
    };
  })()`);
  console.log(`  modal：scrollHeight=${m.scrollH} clientHeight=${m.clientH} 视口高=${m.viewH}`);
  console.log(`  消息 ${m.ps.length} 段：${m.ps.map((t) => `「${t}」`).join(' ')}`);
  console.log(`  按钮：${m.btns.map((b) => b.label).join(' / ')}`);

  if (m.scrollH <= m.clientH + 1) ok(`modal 无滚动（scrollHeight ${m.scrollH} ≤ clientHeight ${m.clientH}）⇒ 选项不被折叠到屏外`);
  else bad(`modal 有滚动（scrollHeight ${m.scrollH} > clientHeight ${m.clientH}）—— F-3.4④「选项首屏可见」不成立`);
  if (m.btns.length === 2 && m.btns.every((b) => b.rect.bottom <= m.viewH && b.rect.top >= 0)) {
    ok(`两个选项按钮都在视口内（bottom ≤ ${m.viewH}）⇒ 不翻屏就能选`);
  } else {
    bad(`按钮不在视口内：${JSON.stringify(m.btns)}`);
  }
  const bodyLines = m.ps.join('\n').split('\n').length;
  if (bodyLines === 2) ok('弹窗正文恰好 2 行（与 A 段内容判据一致）');
  else bad(`弹窗正文 ${bodyLines} 行`);

  // 存图：遭遇框全貌（肉眼复核用）
  await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
    if (r?.data) writeFileSync(path.join(OUT_DIR, 'tp6-encounter-modal.png'), Buffer.from(r.data, 'base64'));
  }).catch(() => warn('截图失败（软项）'));

  /* ============ C. 负向对照（坏样本喂同一断言函数，必须 ❌） ============ */
  if (process.argv.includes('--negctrl')) {
    console.log('\n=== C. 负向对照（坏样本 → A 段判据必须 ❌）===');
    const bads = [
      ['三行消息（旧版式：我军/敌军/预估各一行）', { title: '遭遇', message: '敌军：狼 ×17\n我军：弓箭手 ×20\n预估：可以取胜，约损失 10%', confirmLabel: '开战', cancelLabel: '撤退' }],
      ['缺结论行', { title: '遭遇', message: '狼 ×17，看守 500 金币\n（没有结论）', confirmLabel: '开战', cancelLabel: '撤退' }],
      ['重复我方兵力', { title: '遭遇', message: '狼 ×17\n可以取胜 · 我方兵力 弓箭手 ×20', confirmLabel: '开战', cancelLabel: '撤退' }],
      ['选项不成对', { title: '遭遇', message: '狼 ×17\n可以取胜', confirmLabel: '', cancelLabel: '' }],
    ];
    let allRed = true;
    for (const [name, sample] of bads) {
      const errs = checkEncounter(sample, name);
      if (errs.length > 0) ok(`坏样本「${name}」被判 ❌（${errs.length} 条）⇒ 判据敏感`);
      else {
        allRed = false;
        bad(`坏样本「${name}」竟然通过 —— 判据恒绿！`);
      }
    }
    if (allRed) ok('负向对照生效：4/4 坏样本全被 A 段判据抓住 ⇒ 正式跑的绿不是恒绿');
  }

  /* ============ D. F-3.6 第 3 条：当前单位高亮 + 可达染色（同会话因果 A/B） ============ */
  // F-3.6 三条：① 日志入口（已撤→菜单）② 移动力常驻条（已撤→地图染色+面板按需）
  // ③ 当前单位高亮（选中英雄金色脉冲椭圆，MapRenderer:820）。①②在 IA 规格有记录
  // （in-game-ia.md #23/#25，commit 80cb345），此处验 ③ + 染色层**真的在画**。
  // 判据形式 = 同会话两帧像素对比，唯一变量 = renderer.tintEnabled（__mapTint）：
  //   开 vs 关 ⇒ 差异必须**大**（整个可达区蓝填+边界带）；
  //   关 vs 关（negctrl）⇒ 差异必须**小**（只剩选中脉冲/动画相位残差）。
  // 两个阈值差 4 倍以上，中间不留灰度带。
  // ⚠️ D2 阈值用**相对判据**（残差 < 主差异 10%），不用绝对像素数：同会话里还有
  //    选中脉冲椭圆在呼吸（MapRenderer:820，没有开关可关）+ 旗帜等小动画，绝对
  //    残差几千 px 是正常的——关键是它必须比主 A/B 差异小一个量级（实测 3%），
  //    否则才说明大差异是动画/光照掺出来的（第一版用绝对 200 就是在这里误红）。
  console.log('\n=== D. 当前单位高亮 + 可达染色层（同会话因果 A/B）===');
  await send('Page.navigate', { url: `${BASE_URL}/?devprobe=1&devlight=0.22` }); // devlight 锁光照相位，排除昼夜变量
  let inTutorial2 = false;
  for (let i = 0; i < 100; i++) {
    try {
      if (await evaluate(`document.body.classList.contains('in-battle') === false && !!document.getElementById('hint') && document.getElementById('hint').textContent.includes('教学')`)) { inTutorial2 = true; break; }
    } catch { /* 导航中 */ }
    await sleep(200);
  }
  if (!inTutorial2) throw new Error('D 段：等不到教学局');
  const sel = await evaluate(`window.__journey ? window.__journey().selected : null`);
  if (sel) ok(`当前选中单位 = ${sel}（选中态接线在；金色脉冲椭圆由 MapRenderer:820 画在英雄脚下）`);
  else bad('没有选中单位 —— F-3.6③「当前单位高亮」前提不成立');
  await sleep(600); // 等镜头稳定 + 渲染几帧
  // 帧 1（染色开）存页面内，帧 2（关）与它比 —— 只回传计数/质心，不传 4.6MB 像素。
  // ⚠️ store/cmp 必须是两个显式动作：D2 的"关vs关"要用同一参照系（帧1' 存、
  //    帧2' 比），若共用一个"不存在才存"的函数，第二次 grab 会拿当前帧去比帧1
  //    （染色开），量的其实是"关vs开"——复测直接失效（TP-6 D 段踩过）。
  const grabStore = `(() => {
    const c = document.querySelector('canvas');
    const ctx = c.getContext('2d');
    window.__f1 = ctx.getImageData(0, 0, c.width, c.height);
    return { w: c.width, h: c.height };
  })()`;
  const grabCmp = `(() => {
    const c = document.querySelector('canvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const f = window.__f1;
    if (!f) return null;
    let diff = 0, sx = 0, sy = 0;
    for (let i = 0; i < d.data.length; i += 4) {
      const dr = Math.abs(d.data[i] - f.data[i]) + Math.abs(d.data[i+1] - f.data[i+1]) + Math.abs(d.data[i+2] - f.data[i+2]);
      if (dr > 24) { diff++; const px = (i / 4) % c.width, py = Math.floor((i / 4) / c.width); sx += px; sy += py; }
    }
    return { diff, cx: diff ? sx / diff : -1, cy: diff ? sy / diff : -1, w: c.width, h: c.height };
  })()`;
  await evaluate(grabStore); // 帧 1：染色开（默认）
  await evaluate(`window.__mapTint && window.__mapTint(false)`);
  await sleep(120); // 一帧之后
  const ab = await evaluate(grabCmp); // 帧 2：染色关
  if (!ab) throw new Error('D 段 A/B：第二帧没取到');
  console.log(`  染色 开vs关：差异像素 ${ab.diff}（阈值 ≥800 算"在画"），质心 (${ab.cx.toFixed(0)}, ${ab.cy.toFixed(0)})，画布 ${ab.w}×${ab.h}`);
  if (ab.diff >= 800) ok(`可达染色层真的在画（开vs关 差异 ${ab.diff} px ≥ 800）—— F-3.6②「移动力改地图染色」有着落`);
  else bad(`染色层开vs关差异仅 ${ab.diff} px —— 层没在画？（tintEnabled 接线断了？）`);
  // 存图：染色开（D 段开始时那一帧已存页面内，这里补一张关的做对照）
  await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
    if (r?.data) writeFileSync(path.join(OUT_DIR, 'tp6-reach-tint-off.png'), Buffer.from(r.data, 'base64'));
  }).catch(() => warn('截图失败（软项）'));

  if (process.argv.includes('--negctrl')) {
    console.log('\n=== D2. 负向对照（关vs关：唯一变量失效 ⇒ 差异必须小）===');
    // 注意：此时 tint 已是关。再抓两帧都是"关" ⇒ 若判据对"层没在画"敏感，
    // 差异应回落到脉冲/动画残差级别（<200）。若这时差异仍然巨大，说明 A/B 里
    // 掺了别的变量（光照相位？镜头动？），上面的 ≥800 通过就是假绿。
    await evaluate(grabStore); // 帧 1'：关（同一参照系重开）
    await sleep(120);
    const ab2 = await evaluate(grabCmp); // 帧 2'：还是关
    const pct = ab2 && ab ? ((ab2.diff / ab.diff) * 100).toFixed(1) : '—';
    console.log(`  染色 关vs关：差异像素 ${ab2?.diff ?? '—'}（质心 ${ab2 ? `(${ab2.cx.toFixed(0)}, ${ab2.cy.toFixed(0)})` : '—'}）= 主 A/B 的 ${pct}%（阈值 <10% 算通过）`);
    if (ab2 && ab2.diff < ab.diff * 0.1) ok(`关vs关 残差 ${ab2.diff} px（主差异的 ${pct}%）< 10% ⇒ 开vs关 的大差异 90%+ 归因于染色层，不是脉冲/光照掺的`);
    else bad(`关vs关 残差 ${ab2?.diff} px = 主差异的 ${pct}% ≥ 10% —— A/B 掺了别的变量，D 段判据假绿！`);
  }

  await cleanup();
  console.log(`\n${fail === 0 ? '✅' : '❌'} TP-6② 遭遇框实证：${pass} 过 / ${fail} 不过`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error('\n💥 探针异常：', e.message);
  await cleanup();
  process.exit(2);
}
