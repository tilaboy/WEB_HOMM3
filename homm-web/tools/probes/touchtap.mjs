#!/usr/bin/env node
/**
 * touchtap.mjs —— 触屏战斗交互的**双向**机检（`npm run probe:touchtap`）。
 *
 * ## 它守什么（D-1，2026-10-21 真机走查）
 * 手机上战斗界面原来教人「鼠标停在部队上（或右键点击）」，按钮挂着 `(D)/(空格)/(C)`
 * —— 手机既没有鼠标也没有那几个键。修法 = 按 `(hover: none)` 分叉：
 *   · 无悬停：按钮 `防御 / 等待 / 施法`、提示「点一下部队查看属性」，
 *     且**点一下部队必须真的弹属性牌**（触屏没有右键，这个"看属性"要自己兑现）；
 *   · 有悬停：原文案不变（`防御 (D)` …）—— 桌面玩家没被这次改动影响。
 *
 * ## 它还守什么（D-2，同一次真机走查）
 * `?devbattle=1` 的战斗层原来被开局页（`z-index:900`）整块盖住 —— DOM 断言全绿、截出来是开局页。
 * 判据 = **命中测试**：战场上 4 个采样点 `elementFromPoint` 必须都落在 `.battle` 里。
 * 只读 `display` 没有用：被盖住时它照样是 `flex`。
 *
 * ## 为什么两向都要测
 * 只测 `hover:none`，一个"文案写死成触屏版"的回归会绿；只测 `hover:hover`，
 * 一个"分支没生效"的回归也会绿。两臂都跑，才证明**分支存在且方向对**。
 *
 * ## 口径
 *   · 视口 792×320 @DPR3（真机 OPPO PMA110 实测），`mobile: true`；
 *   · `hover` 用 **CDP 的 `Emulation.setTouchEmulationEnabled`** 翻 —— 与真机同一个媒体查询
 *     （`(hover: none)`），不用 UA 猜测、也不给产品加测试专用旗标；
 *   · 点哪支部队由渲染器当帧真值 `__battleScene.units[].fx/fy` 给出（`?devprobe=1`），
 *     不盲扫 —— 盲扫会先点空格子、起动画、`busy()` 把后面的点击全吃掉（踩过）。
 *
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足
 */
import path from 'node:path';
import { distDir, printHeader, requireFile, freePort, serveInProcess } from '../_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from '../_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=touchtap');
requireFile(DIST, 'main.js');
if (!chromeAvailable()) {
  console.error('✗ 前置不满足：找不到 Chrome（可用 env CHROME 覆盖）。');
  process.exit(2);
}
const PORT = await freePort();
if (!(await serveInProcess(DIST, PORT))) {
  console.error(`✗ 前置不满足：自起 dev server 未就绪（port ${PORT}）。`);
  process.exit(2);
}
const BASE = `http://127.0.0.1:${PORT}/?quick=0`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const PASS = (c, m) => { if (!c) bad++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`); };

/**
 * 把 `hover` 媒体特性钉成指定值（`none` = 触屏 / `hover` = 桌面）。
 *
 * ⚠️ 别用 `Emulation.setEmulatedMedia{features:[{name:'hover'}]}` —— 实测**不生效**
 * （本机 Chrome 151：media 覆写后 `matchMedia('(hover: none)')` 仍 false）。
 * 真正翻转它的是 **`Emulation.setTouchEmulationEnabled`**：开启后
 * `hover:none / any-hover:none / pointer:coarse` 三个同时变 true，关闭即回桌面。
 * （本门首版就是被这个静默无效的覆写骗成"触屏臂全红"，别再用那条路。）
 */
const setHover = (send, value) =>
  send('Emulation.setTouchEmulationEnabled', { enabled: value === 'none', maxTouchPoints: 5 });

/** 导航到调试战斗并等战斗层就绪。 */
async function openBattle(send, evaluate, extra = '') {
  await send('Page.navigate', { url: BASE + '&devbattle=1&devprobe=1' + extra });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    try {
      ready = await evaluate(`!!document.querySelector('.battle .bt-actions')`);
      if (ready) break;
    } catch { /* 导航中 */ }
  }
  return ready;
}

const readCopy = (evaluate) =>
  evaluate(`(() => {
    const btns = [...document.querySelectorAll('.bt-actions .btn')].map((b) => b.textContent.trim());
    const hint = (document.querySelector('.bt-hint') || {}).textContent || '';
    const speed = [...document.querySelectorAll('.bt-head .btn, .bt-head button')].find((b) => /速度/.test(b.textContent));
    return { btns, hint, speedTitle: speed ? speed.title : '(无)' };
  })()`);

try {
  await withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Emulation.setDeviceMetricsOverride', { width: 792, height: 320, deviceScaleFactor: 3, mobile: true });

    /* ================= 臂 A：触屏（hover: none） ================= */
    await setHover(send, 'none');

    /* ★ 前置：先把**存档**造出来。
     * D-2 只在「有存档」时发生 —— 没存档时 boot 走教学场（`startScenario('tutorial')`），
     * `#start-screen` 压根不存在，命中测试当然全绿：那是**被"无对象"满足的假绿**。
     * 真机 OPPO 上就是这样：机器里有过一局 ⇒ 开局页开出 ⇒ 战斗层躺在它下面。
     * 先跑一局 `?devquick=1` 让存档落地，再进 `?devbattle=1`。 */
    await send('Page.navigate', { url: BASE + '&devquick=1' });
    let seeded = false;
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      try {
        seeded = await evaluate(`(() => { const r = localStorage.getItem('homm-save-v1'); if (!r) return false; try { return JSON.parse(r).version === 7; } catch (e) { return false; } })()`);
        if (seeded) break;
      } catch { /* 导航中 */ }
    }
    PASS(seeded, '[前置] 存档已落地（没有它 D-2 无从复现，断言会被"无开局页"假绿）');

    PASS(await openBattle(send, evaluate), '[触屏] ?devbattle=1 战斗层已就绪');
    /* D-2（2026-10-21 真机走查）：**"就绪"不等于"看得见"**。
     * 开局页是 `position:fixed; z-index:900`，`.battle` 只有 150 ⇒ 战斗层整块躺在它下面，
     * DOM 断言全绿、截出来却是开局页。所以这里用**命中测试**（`elementFromPoint`）——
     * 读 `display` 是骗人的：被盖住时它照样是 `flex`。
     * 同时要求开局页**确实在场**（`sawStart`），否则这条又变成"没有对象也算过"。 */
    const cover = await evaluate(`(() => {
      const spots = [[0.5, 0.5], [0.25, 0.35], [0.75, 0.65], [0.5, 0.9]];
      const hits = spots.map(([fx, fy]) => {
        const el = document.elementFromPoint(innerWidth * fx, innerHeight * fy);
        return { at: [fx, fy], inBattle: !!(el && el.closest('.battle')), got: el ? (el.id || el.className || el.tagName) : '(null)' };
      });
      const ss = document.getElementById('start-screen');
      return { ok: hits.every((h) => h.inBattle), hits, sawStart: !!ss, start: ss ? getComputedStyle(ss).display : '(无开局页)' };
    })()`);
    PASS(cover.sawStart, '[触屏] 开局页确实在场（D-2 的出事前提）');
    PASS(cover.ok, `[触屏] 战斗层没被开局页盖住（4 点命中全在 .battle 内 · start-screen display=${cover.start}）`);
    if (!cover.ok) console.log(`       实际命中=${JSON.stringify(cover.hits)}`);
    const hoverA = await evaluate(`matchMedia('(hover: none)').matches`);
    PASS(hoverA === true, `[触屏] 媒体查询真的覆写成 hover:none（${hoverA}）`);

    const a = await readCopy(evaluate);
    console.log(`[触屏] 按钮=${JSON.stringify(a.btns)} · 提示="${a.hint}" · 速度 title="${a.speedTitle}"`);
    PASS(a.btns.join('|') === '防御|等待|施法', '[触屏] 按钮 = 防御 / 等待 / 施法（不带键盘键）');
    PASS(a.hint === '点一下部队查看属性', '[触屏] 底栏提示 = 点一下部队查看属性');
    PASS(!a.speedTitle.includes('键盘'), '[触屏] 速度 title 不教键盘');

    /* 点一下部队 ⇒ 属性牌。**两条分支要分开断言** —— 只写一条"点部队能弹牌"是假判据：
     * 点敌方走的是「够不着，先移动过去」那条边，会把"点自己人没反应"这个回归兜绿
     * （本门首版实测：把 `if (target)` 里的 showTip 删掉，那条断言照样 PASS）。
     *   · 自己部队（side 0）：点了本身就是空指令 ⇒ 必须直接弹牌；
     *   · 敌方且够不着：弹牌 + 「够不着」提示。
     * 点我方永远不会起动画（`playerMove/playerAttack` 都排除了），所以这串点击不会把 `busy()` 打开。 */
    const units = await evaluate(`((window.__battleScene || {}).units || []).map((u) => ({ id: u.id, side: u.side, fx: u.fx, fy: u.fy }))`);
    PASS(units.length > 0, `[触屏] 渲染器给出了当帧单位真值（${units.length} 支）`);
    const box = await evaluate(`(() => { const cv = document.querySelector('.bt-canvas'); const b = cv.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; })()`);
    const BASE_W = 603, BASE_H = 388, PAD = 6; // = BattleRenderer 的 BASE_W/BASE_H/PAD
    const tapUnit = async (u) => {
      const x = box.l + (u.fx + PAD) * (box.w / BASE_W);
      const y = box.t + (u.fy + PAD) * (box.h / BASE_H);
      await evaluate(`(() => { const cv = document.querySelector('.bt-canvas'); cv.dispatchEvent(new MouseEvent('click', { clientX: ${x}, clientY: ${y}, bubbles: true })); return true; })()`);
      await sleep(120);
      return evaluate(`(() => { const el = document.querySelector('.bt-tip'); return el && getComputedStyle(el).display !== 'none' ? el.textContent : ''; })()`);
    };

    /* ① 点自己人：一次就得弹牌（这一条才守 D-1 的"触屏没有右键"）。 */
    let ownTip = null;
    for (const u of units.filter((u) => u.side === 0)) {
      const text = await tapUnit(u);
      if (text && text.includes('攻')) { ownTip = { unit: u.id, text: text.split('\n')[0] }; break; }
    }
    console.log(`[触屏] 点自己部队 → ${JSON.stringify(ownTip || null)}`);
    PASS(!!ownTip, `[触屏] 点自己部队就弹属性牌（不靠点敌方兜底）${ownTip ? '：' + ownTip.text : ''}`);

    /* ② 点敌方且够不着：弹牌 + 提示「够不着」。 */
    let foeTip = null;
    for (const u of units.filter((u) => u.side !== 0)) {
      const text = await tapUnit(u);
      if (text && text.includes('攻')) { foeTip = { unit: u.id, text: text.split('\n')[0] }; break; }
    }
    console.log(`[触屏] 点敌方部队 → ${JSON.stringify(foeTip || null)}`);
    PASS(!!foeTip, `[触屏] 点敌方部队也弹属性牌${foeTip ? '：' + foeTip.text : ''}`);

    /* ================= 臂 B：桌面（hover: hover）—— 原文案不许变 ================= */
    await setHover(send, 'hover');
    PASS(await openBattle(send, evaluate), '[桌面] 战斗层已就绪');
    const hoverB = await evaluate(`matchMedia('(hover: none)').matches`);
    PASS(hoverB === false, `[桌面] 媒体查询回到 hover:hover（hover:none=${hoverB}）`);
    const b = await readCopy(evaluate);
    console.log(`[桌面] 按钮=${JSON.stringify(b.btns)} · 提示="${b.hint}"`);
    PASS(b.btns[0].includes('(D)') && b.btns[1].includes('空格') && b.btns[2].includes('(C)'), '[桌面] 三个按钮仍带键盘快捷键');
    PASS(b.hint.includes('鼠标停在部队上'), '[桌面] 底栏提示仍是鼠标版');
  });
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  process.exit(1);
}

console.log('---------------------------------------------');
console.log(bad === 0 ? '[总结] 两臂皆过' : `[总结] FAIL ${bad} 条`);
process.exit(bad === 0 ? 0 : 1);
