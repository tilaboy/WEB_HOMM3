#!/usr/bin/env node
/**
 * phone-ui-probe.mjs —— 真机 UI 断言探针（D-1 / D-2 的回归尺）。
 *
 * 只做两件事，都是**手机才有的**：
 *   D-1 触屏文案：`(hover: none)` 是否命中；三个战斗按钮是否**不带**键盘快捷键；
 *       底栏提示是不是触屏版；点一下自己部队是否弹出属性牌（触屏没有右键）。
 *   D-2 调试入口：`?devbattle=1` 时开局页是否让位（`#start-screen` 不可见、
 *       战斗层至少占住视口中心）。
 *
 * 用法（手机在前台）：
 *   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *   node tools/probes/phone-ui-probe.mjs --base=https://localhost
 *
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足
 */
const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const PORT = Number(arg('port', '9222'));
const BASE = arg('base', 'https://localhost');

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(5000) })).json();
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error(`[前置] ${PORT} 上没有 page 目标（App 退后台了？先 adb shell am start）`);
  process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', () => rej(new Error('WebSocket 连不上')), { once: true });
});
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let bad = 0;
const PASS = (c, m) => { if (!c) bad++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`); };

// ① 触屏能力（D-1 的前提：手机上必须命中 hover:none，否则文案分支根本没走）
const hover = await evaluate(`matchMedia('(hover: none)').matches`);
console.log(`[环境] (hover: none) = ${hover}`);
PASS(hover === true, '手机上命中 (hover: none) —— 触屏分支会被走');

// ② 进调试战斗（D-2 的输入，也是 D-1 的观察台）
await send('Page.navigate', { url: `${BASE}/?devbattle=1&devprobe=1` });
await sleep(2500);
let ok = false;
for (let i = 0; i < 40; i++) {
  ok = await evaluate(`!!document.querySelector('.battle .bt-actions')`);
  if (ok) break;
  await sleep(250);
}
PASS(ok === true, '?devbattle=1 战斗层已挂上 DOM');

const d2 = await evaluate(`(() => {
  const ss = document.getElementById('start-screen');
  const b = document.querySelector('.battle');
  const r = b ? b.getBoundingClientRect() : null;
  const cx = Math.round(window.innerWidth / 2), cy = Math.round(window.innerHeight / 2);
  const hit = document.elementFromPoint(cx, cy);
  return {
    startDisplay: ss ? getComputedStyle(ss).display : '(无#start-screen)',
    startZ: ss ? getComputedStyle(ss).zIndex : null,
    battleRect: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null,
    centerTag: hit ? (hit.className || hit.id || hit.tagName) : '(无)',
    inBattle: !!(hit && hit.closest && hit.closest('.battle')),
  };
})()`);
console.log(`[D-2] #start-screen display=${d2.startDisplay} z=${d2.startZ} · .battle rect=${JSON.stringify(d2.battleRect)} · 视口中心命中 <${d2.centerTag}>`);
PASS(d2.startDisplay === 'none', '#start-screen 已让位（display:none）');
PASS(d2.inBattle === true, '视口中心落在 .battle 内 —— 截屏看到的就是战斗，不是开局页');

// ③ 触屏文案（D-1）
const copy = await evaluate(`(() => {
  const btns = [...document.querySelectorAll('.bt-actions .btn')].map((b) => b.textContent.trim());
  const hint = (document.querySelector('.bt-hint') || {}).textContent || '';
  const speed = [...document.querySelectorAll('.bt-head .btn')].find((b) => /速度/.test(b.textContent));
  return { btns, hint, speedTitle: speed ? speed.title : '(无)' };
})()`);
console.log(`[D-1] 按钮=${JSON.stringify(copy.btns)} · 提示="${copy.hint}" · 速度 title="${copy.speedTitle}"`);
const joined = copy.btns.join('|');
PASS(!/\(D\)|\(空格\)|\(C\)|（D）|（空格）|（C）/.test(joined), '三个按钮不带键盘快捷键');
PASS(copy.btns.includes('防御') && copy.btns.includes('等待') && copy.btns.includes('施法'), '按钮文案 = 防御 / 等待 / 施法');
PASS(copy.hint.includes('点一下部队查看属性'), '底栏提示 = 触屏版');
PASS(!copy.speedTitle.includes('键盘'), '速度按钮 title 不教键盘');

// ④ 点一下自己部队 ⇒ 属性牌（触屏没有右键，这条必须自己兑现）
/* 为什么用 `__battleScene`（`?devprobe=1`）而不是"盲扫战场"：
 *   盲扫会先点到空格子 ⇒ `playerMove` 起动画 ⇒ `busy()` 为真 ⇒ 之后所有点击被丢，
 *   于是"扫完都没弹出"是**探针自己造的**假红（第一版实测）。改为读渲染器给的**当帧真值**
 *   （`fx/fy` = 含移动插值的场坐标），点部队脚下 —— 那一下只会走"看属性"或"攻击"两条路。 */
const tap = await (async () => {
  const units = await evaluate(`((window.__battleScene || {}).units || []).map((u) => ({ id: u.id, side: u.side, fx: u.fx, fy: u.fy }))`);
  if (!units.length) return { err: '__battleScene 没有单位（devprobe 没生效？）' };
  const box = await evaluate(`(() => { const cv = document.querySelector('.bt-canvas'); const b = cv.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; })()`);
  const BASE_W = 603, BASE_H = 388, PAD = 6;
  // 先试**我方**：点自己人永远不会起动画（`playerMove/playerAttack` 都排除在外），
  // 所以这一串点击不会把 `busy()` 打开、也就不会把后面的点击都吃掉。
  const order = [...units].sort((a, b) => a.side - b.side);
  for (const u of order) {
    const x = box.l + (u.fx + PAD) * (box.w / BASE_W);
    const y = box.t + (u.fy + PAD) * (box.h / BASE_H);
    await evaluate(`(() => {
      const cv = document.querySelector('.bt-canvas');
      cv.dispatchEvent(new MouseEvent('click', { clientX: ${x}, clientY: ${y}, bubbles: true }));
      return true;
    })()`);
    await sleep(120);
    const t = await evaluate(`(() => { const el = document.querySelector('.bt-tip'); return el && getComputedStyle(el).display !== 'none' ? el.textContent : ''; })()`);
    if (t && t.includes('攻')) return { unit: u.id, side: u.side, text: t.split('\n')[0] };
  }
  return { err: '逐个点了所有单位，都没有弹出属性牌' };
})();
console.log(`[D-1] 点按探针 → ${JSON.stringify(tap)}`);
PASS(!tap.err, `点一下部队弹出属性牌（${tap.err || tap.text}）`);

console.log(bad === 0 ? '[总结] 全过' : `[总结] FAIL ${bad} 条`);
process.exit(bad === 0 ? 0 : 1);
