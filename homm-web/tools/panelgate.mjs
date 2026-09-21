#!/usr/bin/env node
/**
 * panelgate.mjs —— 英雄面板「能开能关」的**两向**门（team-lead 开窗条件 ④，`engineering-lead`）。
 *
 * ## 为什么要有这把尺
 * `#156` 把 `#panel-toggle`（面板内那行「收起」按钮）**在展开态撤掉**，把**收起路径移到了拇指带
 * 的「英雄」按钮**。⇒ **就冒出一条新的、必须实测的可用性前提**：
 * > **展开后还收得回来吗？**（`#side` 在 `stage` 内、`#thumb` 在 `stage` 之下 ⇒ 理论可达；
 * >  但"理论可达"是**推论**，不是**实测**。）
 * team-lead 明确要求这一条，并点出它正是**"门必须双向可证"在 UI 上的形状**：
 * **只证"能开"不算门** —— 一个只能开不能关的面板，用户会被锁在里面。
 *
 * ## 判据（三向都量，缺一不可）
 *   ① **能开**：拇指带「英雄」点一次 ⇒ `#side` 非收起态 **且** 面板内容可见；
 *   ② **能关**：再点一次 ⇒ `#side` 回到收起态 **（或面板内容不可见）**；
 *   ③ **能再开**：第三次 ⇒ 又回到非收起态 ⇒ 证"是**开关**，不是**单向开**"。
 *   ★ 并**每次点击后都断言「拇指带按钮仍可点」** —— 否则"关了以后再也点不到"会漏过。
 *   ★ 三条里任何一条不成立 ⇒ **exit 1**（这正是"门能红"）。
 *
 * ## 与 `hpbudget.mjs` 的分工（同族但不同对象）
 *   · `hpbudget` 量**放得下**（`#side` 溢不溢、每段多高）—— 尺寸轴。
 *   · 本尺量**开合得动**（一个布尔状态能不能来回切）—— **可逆性轴**。
 *   两者都在 `#side` 上，但**问的是不同的问题** ⇒ **不合并**（合并会得到"一个数回答两个问题"的假清晰）。
 *
 * ## 用法
 *   node tools/panelgate.mjs                      # 量 ./dist（自起服务）
 *   node tools/panelgate.mjs --dist=/tmp/dist-xxx # 量隔离构建
 *
 * 退出码：0 = 三向皆过 · 1 = 有一向不过 · 2 = 前置不满足（无 Chrome / 构建不含英雄面板）
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { distDir, printHeader, requireFile, freePort, serveInProcess } from './_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from './_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=panelgate');

requireFile(DIST, 'ui/HeroPanel.js');
if (!readFileSync(path.join(DIST, 'ui', 'HeroPanel.js'), 'utf8').includes('hp-head')) {
  console.error('✗ 前置不满足：构建的 ui/HeroPanel.js 不含 `hp-head` ⇒ 不含英雄面板，读数无意义。');
  process.exit(2);
}
if (!chromeAvailable()) {
  console.error('✗ 前置不满足：找不到 Chrome（可用 env CHROME 覆盖）。');
  process.exit(2);
}
const PORT = await freePort();
if (!(await serveInProcess(DIST, PORT))) {
  console.error(`✗ 前置不满足：自起 dev server 未就绪（port ${PORT}）。`);
  process.exit(2);
}
const URL0 = `http://127.0.0.1:${PORT}/?devquick=0&devsize=medium&devseed=20260917`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const PASS = (c, m) => { if (!c) bad++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`); };

/** 面板状态：收起与否 + 内容可见与否 + 拇指带按钮是否可点。 */
const STATE = `(() => {
  const side = document.querySelector('#side');
  if (!side) return { ok: false, reason: '找不到 #side' };
  const head = side.querySelector('.hp-head');
  const r = side.getBoundingClientRect();
  const hr = head ? head.getBoundingClientRect() : null;
  const thumb = [...document.querySelectorAll('#thumb button')].find((b) => (b.textContent || '').includes('英雄'));
  const tr = thumb ? thumb.getBoundingClientRect() : null;
  return {
    ok: true,
    collapsed: side.classList.contains('collapsed'),
    sideW: Math.round(r.width),
    headVisible: !!(hr && hr.width > 0 && hr.height > 0 && getComputedStyle(head).display !== 'none'),
    thumbExists: !!thumb,
    thumbDisabled: thumb ? thumb.disabled === true : null,
    thumbClickable: !!(tr && tr.width > 0 && tr.height > 0),
  };
})()`;

const clickThumb = (evaluate) =>
  evaluate(`(() => {
    const b = [...document.querySelectorAll('#thumb button')].find((x) => (x.textContent || '').includes('英雄'));
    if (!b) return 'NOT_FOUND';
    b.click();
    return 'OK';
  })()`);

/** 一个状态是否算「展开」。收起态 = `#side.collapsed`；同时要求内容可见（防"展开了但空"）。 */
const isOpen = (s) => s && s.ok && !s.collapsed && s.headVisible;
const isClosed = (s) => s && s.ok && (s.collapsed || !s.headVisible);

try {
  await withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Emulation.setDeviceMetricsOverride', { width: 792, height: 320, deviceScaleFactor: 3, mobile: true });
    await send('Page.navigate', { url: URL0 });
    for (let i = 0; i < 60; i++) {
      await sleep(150);
      try {
        if (await evaluate(`document.readyState === 'complete' && !!document.querySelector('#start-screen')`)) break;
      } catch { /* 导航中 */ }
    }
    await evaluate(`(() => { const b = [...document.querySelectorAll('#start-screen button')].find(x => (x.textContent||'').includes('开始新游戏')); if (b) b.click(); return true; })()`);
    await sleep(1800);

    const s0 = await evaluate(STATE);
    if (!s0 || !s0.ok) { PASS(false, `量不到面板状态：${s0 ? s0.reason : 'null'}`); return; }
    console.log(`[初始] 收起=${s0.collapsed} · #side 宽=${s0.sideW} · 内容可见=${s0.headVisible} · 拇指带「英雄」存在=${s0.thumbExists} 可点=${s0.thumbClickable}`);
    PASS(s0.thumbExists && s0.thumbClickable, '拇指带「英雄」按钮存在且可点（收起路径的载体在场）');

    const seq = [s0];
    for (let i = 1; i <= 3; i++) {
      const rc = await clickThumb(evaluate);
      await sleep(500);
      const s = await evaluate(STATE);
      seq.push(s);
      console.log(`[第 ${i} 次点「英雄」] 收起=${s.collapsed} · #side 宽=${s.sideW} · 内容可见=${s.headVisible} · 按钮可点=${s.thumbClickable}${rc !== 'OK' ? `（click=${rc}）` : ''}`);
      PASS(rc === 'OK', `第 ${i} 次点击「英雄」返回 OK（实为 ${rc}）`);
      PASS(s.thumbClickable === true, `第 ${i} 次点击后：拇指带按钮**仍可点**（收起来还找得到入口）`);
    }

    const [a0, a1, a2, a3] = seq;
    /* ① 能开：三态里至少出现一次"开" */
    PASS(seq.some(isOpen), `① 能开：出现过展开态（${seq.map((s) => (isOpen(s) ? '开' : '关')).join('→')}）`);
    /* ② 能关：三态里至少出现一次"关" */
    PASS(seq.some(isClosed), `② 能关：出现过收起态`);
    /* ③ 是开关而非单向：相邻两态必须两两互反（连点三次 ⇒ 开/关/开/关 交替） */
    const flips = [a0, a1, a2, a3].slice(1).map((s, i) => (isOpen(s) !== isOpen([a0, a1, a2][i]))).every(Boolean);
    PASS(flips, `③ 是**开关**：三次点击后状态逐次互反（${[a0, a1, a2, a3].map((s) => (isOpen(s) ? '开' : '关')).join('→')}）`);
  });
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  process.exit(e && e.prerequisite ? 2 : 1);
}

console.log('---------------------------------------------');
console.log(bad === 0 ? '[总结] 能开能关能再开（三向皆过）' : `[总结] FAIL ${bad} 条`);
process.exit(bad === 0 ? 0 : 1);
