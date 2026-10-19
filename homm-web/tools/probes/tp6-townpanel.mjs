/**
 * tp6-townpanel.mjs —— TP-6① 城镇面板「决策优先」量化验收探针（零依赖 CDP，非门控）。
 *
 * TP-6① 的原始诉求（用户原话上溯）：
 *   F-2.4「城市面板，英雄面板可以更紧凑一点么」；
 *   F-3.2「城市信息……太多太冗余……能不显示或者合并显示的就不要显示」；
 *   F-3.8「城市的这些出来进去……更简洁容易操作」。
 * 主理人派生尺子 = IA §3.4（in-game-ia.md）逐条，全部可量化：
 *   #49 拇指带常驻「城」一等入口（D-32：经营与探索并列，不许降级成附属区块）；
 *   #36 每日税收/城防/周增长三读数常驻（城镇页内）；
 *   #37 建筑网格分段、每页纵向可点行 ≤5、不滚动；造价行「还差」是决策处可见的
 *       唯一常驻载体（#35：建筑页顶部堆叠 chip 已删，别恢复）；
 *   #41 「关闭」在头部（headClose），不躺在滚动流末端；
 *   #50 市场页「我的资源」行（7 项当前量——市场页的全部决策变量）。
 *
 * 判据形式 = 页面内 evaluate 返回错误列表（空=过）；负向对照 = DOM 打桩后**重跑
 * 同一 evaluate**，必须转 ❌（证明判据不恒绿，也证明「代码写了」不等于「接对了」）。
 *
 * 用法：node tools/probes/tp6-townpanel.mjs [outDir] [--negctrl]
 * 退出码：0 = A+B 全过（+C 负向对照生效）；1 = 有硬断言失败；2 = 用法/环境错。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = process.argv[2] ?? '/tmp/tp6-town';
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

/* ================= 页面内判据（A/B/C 共用同一组函数） ================= */

// A：#49 拇指带一等入口
const J_THUMB_CITY = `(() => {
  const errs = [];
  const btns = [...document.querySelectorAll('#thumb button, .tb-btn')];
  const city = btns.find((b) => (b.textContent ?? '').trim() === '城');
  if (!city) errs.push('拇指带没有文本为「城」的按钮（#49：经营主面的一等常驻入口）');
  return errs;
})()`;

// B1：#36 三读数常驻
const J_META = `(() => {
  const errs = [];
  const meta = document.querySelector('.town-meta');
  if (!meta) return ['找不到 .town-meta（三读数行）'];
  const t = meta.textContent ?? '';
  for (const k of ['每日税收', '城防', '周增长']) {
    if (!t.includes(k)) errs.push('.town-meta 缺「' + k + '」（#36：经营时刻核心读数）');
  }
  return errs;
})()`;

// B2+B3+B4：建筑页结构（行数 ≤5 / 不滚动 / 每卡有状态行 / 建造按钮双态一致）
const J_BUILD_PAGE = `(() => {
  const errs = [];
  const grid = document.querySelector('.bgrid');
  if (!grid) return ['找不到 .bgrid（建筑卡网格）'];
  const cards = [...grid.querySelectorAll('.bcard')];
  if (!cards.length) errs.push('建筑页零卡片');
  // 行数：按 offsetTop 去重（3 列网格 ⇒ 7 张 = 3 行、8 张 = 3 行；R4/§5.4 要求 ≤5）
  const rows = new Set(cards.map((c) => c.offsetTop)).size;
  if (rows > 5) errs.push('建筑页 ' + rows + ' 行 > 5（R4/§5.4 每页纵向可点行 ≤5 ⇒ 只能靠滚动=「拉到底」摩擦）');
  // 不滚动：整个 modal 都不该出滚动条（出口/选项不许躺在流末端）
  const modal = document.querySelector('.modal');
  if (modal && modal.scrollHeight > modal.clientHeight + 1) {
    errs.push('modal 出现滚动（scrollHeight ' + modal.scrollHeight + ' > clientHeight ' + modal.clientHeight + '）');
  }
  // 每卡有状态行（.bs）且非空 ——「✓ 已建成」/「还差：…」/ reason 三态
  let bsCount = 0;
  for (const c of cards) {
    const bs = c.querySelector('.bs');
    if (bs && (bs.textContent ?? '').trim()) bsCount++;
  }
  if (cards.length && bsCount !== cards.length) {
    errs.push(bsCount + '/' + cards.length + '张卡有状态行（#37：造价行「还差」是决策处可见的唯一常驻载体）');
  }
  // 建造按钮双态一致：显示「还差」（.bs.short）⇒ 按钮必须 disabled；
  // 非 short 的未建卡 ⇒ 按钮必须 enabled（能不能点一眼可判，不许「看起来能点其实不能」）
  let checked = 0;
  for (const c of cards) {
    const bs = c.querySelector('.bs');
    const btn = c.querySelector('.brow .btn');
    if (!bs || !btn) continue;
    checked++;
    const short = bs.classList.contains('short');
    if (short && !btn.disabled) errs.push('卡片显示「还差」但建造按钮可点（' + (c.querySelector('.bn')?.textContent ?? '?') + '）—— 点了才报错 = 试错成本');
    if (!short && !bs.classList.contains('built') && btn.disabled) {
      errs.push('资源够、也未建成，但建造按钮禁用（' + (c.querySelector('.bn')?.textContent ?? '?') + '）');
    }
  }
  // 覆盖闸（铁律 3）：有对象（未建卡）但一个按钮都没检查到时必须红，不许静默跳过
  const unbuilt = cards.filter((c) => { const bs = c.querySelector('.bs'); return bs && !bs.classList.contains('built'); }).length;
  if (unbuilt > 0 && checked === 0) {
    errs.push('有 ' + unbuilt + ' 张未建卡却零个建造按钮可判（前置链全锁？面板渲染条件错了？）');
  }
  return errs;
})()`;

// B5：#41 关闭按钮在头部
const J_HEAD_CLOSE = `(() => {
  const errs = [];
  const modal = document.querySelector('.modal');
  if (!modal) return ['没有 modal'];
  const head = modal.querySelector('.modal-head');
  if (!head) return ['没有 .modal-head（关闭按钮该在头部）'];
  const mr = modal.getBoundingClientRect();
  const close = [...head.querySelectorAll('button')][0];
  if (!close) return ['.modal-head 里没有按钮'];
  const cr = close.getBoundingClientRect();
  if (cr.top - mr.top > 48) errs.push('关闭按钮距 modal 顶 ' + Math.round(cr.top - mr.top) + 'px（#41：头部常驻，不躺滚动流末端）');
  return errs;
})()`;

// B6：#50 市场页「我的资源」行（先由调用方切 tab）
const J_MARKET_MINE = `(() => {
  const errs = [];
  const mine = document.querySelector('.my-res');
  if (!mine) return ['市场页没有 .my-res（#50：我的资源行——市场页全部决策变量）'];
  const t = mine.textContent ?? '';
  if (!t.includes('我的资源')) errs.push('.my-res 里没有「我的资源」字样');
  for (const k of ['金', '木', '矿', '宝石', '水晶', '硫磺', '水银']) {
    if (!t.includes(k)) errs.push('.my-res 缺「' + k + '」当前量');
  }
  return errs;
})()`;

/* ================= 运行时：教学局 → 拇指带「城」→ 城镇面板 ================= */

const APP_PORT = 39800 + (process.pid % 200);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const server = spawn('node', [path.join(ROOT, 'tools', 'serve.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT: String(APP_PORT) }, stdio: ['ignore', 'ignore', 'pipe'],
});
let serverLog = '';
server.stderr.on('data', (d) => { serverLog += d.toString(); });
const profile = mkdtempSync(path.join(tmpdir(), 'tp6town-'));
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
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');

  // 教学局（?devprobe=1 自动进；无存档且没教过）。town_home 在 (5,15)、hero1 在 (4,14)。
  // ?devstart 别加——会落开始页；拇指带「城」直接开主城，不需要走路。
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

  /* ============ A. 拇指带一等入口（#49） ============ */
  console.log('\n=== A. 拇指带「城」一等入口（#49 / D-32）===');
  {
    const errs = await evaluate(J_THUMB_CITY);
    if (!errs.length) ok('拇指带有文本「城」的常驻按钮（经营与探索并列，不埋在英雄面板末尾）');
    else errs.forEach((e) => bad(e));
  }

  // 点「城」开城镇面板（openHomeTown ⇒ openTownById）
  const cityBtn = await evaluate(`(() => {
    for (const b of document.querySelectorAll('#thumb button, .tb-btn')) {
      if ((b.textContent ?? '').trim() === '城') { const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; }
    }
    return null;
  })()`);
  if (!cityBtn) throw new Error('找不到拇指带「城」按钮');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cityBtn.x, y: cityBtn.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cityBtn.x, y: cityBtn.y, button: 'left', clickCount: 1 });
  let sawTown = false;
  for (let i = 0; i < 50; i++) {
    try {
      if (await evaluate(`!!document.querySelector('.town-meta')`)) { sawTown = true; break; }
    } catch { /* 导航中 */ }
    await sleep(200);
  }
  if (!sawTown) throw new Error('点了「城」但城镇面板没出（openHomeTown 接线断？）');

  /* ============ B. 面板结构（#36/#37/#41 + #50） ============ */
  console.log('\n=== B. 城镇面板结构（#36 三读数 / #37 建筑页 / #41 头部关闭 / #50 市场页）===');
  {
    const e1 = await evaluate(J_META);
    if (!e1.length) ok('三读数常驻：每日税收 / 城防 / 周增长（#36，顶栏没有的经营核心读数）');
    else e1.forEach((e) => bad(e));

    const e2 = await evaluate(J_BUILD_PAGE);
    const cards = await evaluate(`document.querySelectorAll('.bgrid .bcard').length`);
    const rows = await evaluate(`new Set([...document.querySelectorAll('.bgrid .bcard')].map((c) => c.offsetTop)).size`);
    const modalScroll = await evaluate(`(() => { const m = document.querySelector('.modal'); return m ? m.scrollHeight + '/' + m.clientHeight : '—'; })()`);
    console.log(`  建筑页：${cards} 张卡 / ${rows} 行，modal 滚动 ${modalScroll}`);
    if (!e2.length) ok(`建筑页 ${rows} 行 ≤5 且无滚动、每卡有状态行、建造按钮双态一致（#37 + #35 不恢复堆叠 chip）`);
    else e2.forEach((e) => bad(e));

    const e3 = await evaluate(J_HEAD_CLOSE);
    if (!e3.length) ok('「关闭」在 modal 头部（#41：出口不滚动，不躺流末端）');
    else e3.forEach((e) => bad(e));

    // 切「市场·工坊」tab 验 #50
    const mkTab = await evaluate(`(() => {
      for (const b of document.querySelectorAll('.town-tabs .btn')) {
        if ((b.textContent ?? '').trim() === '市场·工坊') { const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; }
      }
      return null;
    })()`);
    if (!mkTab) bad('找不到「市场·工坊」tab');
    else {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mkTab.x, y: mkTab.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mkTab.x, y: mkTab.y, button: 'left', clickCount: 1 });
      await sleep(300);
      const e4 = await evaluate(J_MARKET_MINE);
      if (!e4.length) ok('市场页「我的资源」行：金/木/矿 + 4 稀有当前量（#50：决策输入事先可见）');
      else e4.forEach((e) => bad(e));
    }
  }

  // 存图：建筑页 + 市场页（肉眼复核用）
  await evaluate(`(() => { for (const b of document.querySelectorAll('.town-tabs .btn')) { if ((b.textContent ?? '').trim() === '建筑') b.click(); } })()`);
  await sleep(300);
  await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
    if (r?.data) writeFileSync(path.join(OUT_DIR, 'tp6-town-build.png'), Buffer.from(r.data, 'base64'));
  }).catch(() => warn('建筑页截图失败（软项）'));
  await evaluate(`(() => { for (const b of document.querySelectorAll('.town-tabs .btn')) { if ((b.textContent ?? '').trim() === '市场·工坊') b.click(); } })()`);
  await sleep(300);
  await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
    if (r?.data) writeFileSync(path.join(OUT_DIR, 'tp6-town-market.png'), Buffer.from(r.data, 'base64'));
  }).catch(() => warn('市场页截图失败（软项）'));

  /* ============ C. 负向对照（DOM 打桩 → 重跑同一判据，必须 ❌） ============ */
  // ⚠️ 每个子项都**重开面板**：C1 删掉的 .bs 会让 C2 的双态检查被 continue 跳过
  //   （第一版就这在里假绿——打桩 A 弄脏了打桩 B 的现场）。重开 = reload + 点「城」；
  //   reload 会重跑 addScriptToEvaluateOnNewDocument（清存档）⇒ 回到教学局初始态。
  const reopenTown = async () => {
    await send('Page.reload', { ignoreCache: false });
    let back = false;
    for (let i = 0; i < 100; i++) {
      try {
        if (await evaluate(`document.body.classList.contains('in-battle') === false && !!document.getElementById('hint') && document.getElementById('hint').textContent.includes('教学')`)) { back = true; break; }
      } catch { /* 导航中 */ }
      await sleep(200);
    }
    if (!back) throw new Error('C 段：reload 后回不到教学局');
    const b = await evaluate(`(() => {
      for (const x of document.querySelectorAll('#thumb button, .tb-btn')) {
        if ((x.textContent ?? '').trim() === '城') { const r = x.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; }
      }
      return null;
    })()`);
    if (!b) throw new Error('C 段：reload 后找不到「城」按钮');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
    for (let i = 0; i < 50; i++) {
      try { if (await evaluate(`!!document.querySelector('.town-meta')`)) return; } catch { /* 导航中 */ }
      await sleep(200);
    }
    throw new Error('C 段：重开后城镇面板没出');
  };

  if (process.argv.includes('--negctrl')) {
    console.log('\n=== C. 负向对照（DOM 打桩 → 同一判据必须转 ❌）===');
    // ⚠️ 先切回「建筑」tab：上面存图两步把面板停在市场页，那里没有 .bgrid。
    // ⚠️ C1 删掉的 .bs 会弄脏 C2 的现场（双态检查 continue 跳过）⇒ C2 前重开面板。
    await evaluate(`(() => { for (const b of document.querySelectorAll('.town-tabs .btn')) { if ((b.textContent ?? '').trim() === '建筑') b.click(); } })()`);
    await sleep(300);
    // C1：删掉所有状态行 ⇒ B3 必须 ❌（证明「每卡有还差行」不是恒绿）
    await evaluate(`(() => { for (const b of document.querySelectorAll('.bgrid .bcard .bs')) b.remove(); })()`);
    {
      const e = await evaluate(J_BUILD_PAGE);
      if (e.some((x) => x.includes('状态行'))) ok('C1 删状态行后建筑页判据转 ❌ ⇒ 「每卡有还差行」判据敏感');
      else bad(`C1 删了状态行但判据没红（${JSON.stringify(e)}）—— 恒绿！`);
    }
    // C2：独立现场重开 ⇒ **反向打桩**（禁用第一个可负担卡的建造按钮）⇒ 双态判据必须 ❌。
    //   ⚠️ 为什么反向：教学局初始资源下，带按钮的卡（market/townhall/wall1）全都
    //   可负担，short 卡（wall3）因前置链未建**没有按钮** ⇒ 正向桩（全 enabled）
    //   没有作用对象（第一版就这么假绿过）。反向桩不受资源局面影响。
    await reopenTown();
    const stubOk = await evaluate(`(() => {
      for (const c of document.querySelectorAll('.bgrid .bcard')) {
        const bs = c.querySelector('.bs');
        const btn = c.querySelector('.brow .btn');
        if (bs && btn && !bs.classList.contains('short') && !bs.classList.contains('built')) { btn.disabled = true; return true; }
      }
      return false;
    })()`);
    if (!stubOk) bad('C2 桩无效：找不到可负担未建卡的建造按钮（覆盖闸该在正式跑就报）');
    else {
      const e = await evaluate(J_BUILD_PAGE);
      if (e.some((x) => x.includes('禁用'))) ok('C2 禁用可负担卡的按钮后双态判据转 ❌ ⇒ 「资源够却禁用」判据敏感');
      else bad(`C2 禁用了按钮但判据没红（${JSON.stringify(e)}）—— 恒绿！`);
    }
    // C3：删拇指带「城」按钮 ⇒ A 必须 ❌（最后跑：它毁的就是入口本身）
    await evaluate(`(() => { for (const b of document.querySelectorAll('#thumb button, .tb-btn')) { if ((b.textContent ?? '').trim() === '城') b.remove(); } })()`);
    {
      const e = await evaluate(J_THUMB_CITY);
      if (e.length) ok('C3 删「城」按钮后 #49 判据转 ❌ ⇒ 一等入口判据敏感');
      else bad('C3 删了「城」按钮但判据没红 —— 恒绿！');
    }
  }

  await cleanup();
  console.log(`\n${fail === 0 ? '✅' : '❌'} TP-6① 城镇面板实证：${pass} 过 / ${fail} 不过`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error('\n💥 探针异常：', e.message);
  await cleanup();
  process.exit(2);
}
