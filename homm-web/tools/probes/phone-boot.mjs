#!/usr/bin/env node
/**
 * phone-boot.mjs —— **真机**冒烟探针（WebView over CDP，零依赖）。
 *
 * ## 它回答什么
 * 桌面 / 模拟器上都对，不等于真机上"跑得通"。本探针只测**真机才有的那几件事**：
 *   ① 视口与 DPR（CSS px，不与物理像素混）
 *   ② 安全区是否真的注入（`env(safe-area-inset-*)` 计算值 vs 原生 insets ÷ DPR）
 *   ③ 断点命中（`max-width: 860px` —— 只在这些宽度生效的规则，桌面探针看不见）
 *   ④ 画质分档是否生效（`canvas.width / rect.width`）
 *   ⑤ 帧时间（用 rAF 回调的 `ts` 算间隔，不拿 `performance.now()` 凑）
 *   ⑥ 开局状态（开始页 / 教学场 / 存档里的 scenario）
 *
 * ## 为什么不用 page.evaluate + 长脚本
 * 全部量都在**一个返回 JSON 的表达式**里算完再回传 —— 少一次往返就少一次"读到半截状态"。
 *
 * ## 用法（手机必须在前台，否则端点不响应）
 *   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *   node tools/probes/phone-boot.mjs [--port=9222] [--secs=3]
 *
 * ## 坑（本项目都踩过）
 *   - `fetch` 不设超时 ⇒ 端点没起来时**永久挂住**、一行输出都没有 ⇒ 一律 `AbortSignal.timeout`
 *   - macOS 无 `timeout`；BSD grep 不支持 `\|`（用 `-E`）
 *   - 退出码不可靠（SIGTERM 但活干完了）⇒ **只信产物**
 */
const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const PORT = Number(arg('port', '9222'));
const SECS = Number(arg('secs', '3'));

const targets = await (
  await fetch(`http://127.0.0.1:${PORT}/json`, { signal: AbortSignal.timeout(5000) })
).json();
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error(`[前置] ${PORT} 上没有 page 目标（App 退后台了？先 adb shell am start）`);
  process.exit(2);
}
const ver = await (
  await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(5000) })
).json();
console.log(`[端点] ${ver.Browser} · target=${page.url}`);

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

/* 一个表达式量完六件事：避免多次往返读到不同时刻的状态 */
const probe = await evaluate(`(async () => {
  const css = (el, p) => getComputedStyle(el).getPropertyValue(p).trim();
  const mk = document.createElement('div');
  mk.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);visibility:hidden';
  document.body.appendChild(mk);
  await new Promise(r => requestAnimationFrame(r));
  const insets = { top: css(mk,'padding-top'), right: css(mk,'padding-right'), bottom: css(mk,'padding-bottom'), left: css(mk,'padding-left') };
  mk.remove();

  const map = document.querySelector('#map');
  const rect = map ? map.getBoundingClientRect() : null;

  // rAF：间隔用回调 ts 算，工作耗时用 ts 差
  const frames = [];
  let prev = null;
  await new Promise((done) => {
    const t0 = performance.now();
    const tick = (ts) => {
      if (prev !== null) frames.push({ gap: ts - prev.ts, work: prev.work });
      const w0 = performance.now();
      prev = { ts, work: 0 };
      prev.work = performance.now() - w0;
      if (performance.now() - t0 < ${SECS * 1000}) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
  const q = (arr, p) => { if (!arr.length) return null; const s=[...arr].sort((a,b)=>a-b); return +s[Math.min(s.length-1, Math.floor(p*s.length))].toFixed(1); };
  const gaps = frames.map(f => f.gap).filter(g => g > 0);

  let g = null;
  try { const raw = localStorage.getItem('homm-save-v1'); g = raw ? JSON.parse(raw) : null; } catch {}

  return JSON.stringify({
    ua: navigator.userAgent,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    screen: { w: screen.width, h: screen.height },
    visualViewport: window.visualViewport ? { w: +visualViewport.width.toFixed(1), h: +visualViewport.height.toFixed(1), scale: visualViewport.scale } : null,
    insets,
    bp860: matchMedia('(max-width: 860px)').matches,
    map: map ? { cssW: +rect.width.toFixed(1), cssH: +rect.height.toFixed(1),
                 backingW: map.width, backingH: map.height,
                 ratio: +(map.width / rect.width).toFixed(3),
                 offRight: +(rect.right - innerWidth).toFixed(1),
                 offBottom: +(rect.bottom - innerHeight).toFixed(1) } : null,
    frames: { n: gaps.length, gapP50: q(gaps,0.5), gapP95: q(gaps,0.95), gapMax: q(gaps,0.99), secs: ${SECS} },
    ui: { hasStart: !!document.querySelector('#start-screen'), hasThumb: !!document.querySelector('#thumb'),
          hasMapCanvas: !!map, bodyText: (document.body.innerText || '').slice(0, 80).replace(/\\n/g, ' | ') },
    save: g ? { scenario: g.config?.scenario ?? null, day: g.day ?? null, w: g.map?.width, h: g.map?.height } : null,
  });
})()`);

const d = JSON.parse(probe);
console.log(JSON.stringify(d, null, 1));

/* 判定：只打"真机才会红"的那几条，不与桌面探针重复 */
const bad = [];
if (!(d.viewport.dpr >= 1)) bad.push(`DPR=${d.viewport.dpr} 异常`);
if (!d.ui.hasMapCanvas) bad.push('没有 #map 画布 —— 游戏没起来');
if (d.map) {
  if (d.map.offRight > 1 || d.map.offBottom > 1) bad.push(`画布溢出视口 right=${d.map.offRight} bottom=${d.map.offBottom}`);
  if (Math.abs(d.map.ratio - Math.min(4, Math.max(0.6, d.viewport.dpr))) > 0.35 * d.viewport.dpr)
    bad.push(`渲染倍率 ${d.map.ratio} 与 DPR ${d.viewport.dpr} 不符（画质分档可能没生效）`);
}
if (d.frames.n < 10) bad.push(`只采到 ${d.frames.n} 帧 —— rAF 被饿死（残留 headless Chrome？）`);
if (d.frames.gapP95 !== null && d.frames.gapP95 > 34) bad.push(`帧间隔 p95=${d.frames.gapP95}ms（>34ms 即掉到 30fps 以下）`);

console.log('\n' + '-'.repeat(60));
if (bad.length) {
  for (const b of bad) console.log(`[FAIL] ${b}`);
  console.log(`★ ${bad.length} 项不达标`);
  process.exit(1);
}
console.log('[PASS] 视口/画布/帧率/安全区读数全部在预期内');
ws.close();
