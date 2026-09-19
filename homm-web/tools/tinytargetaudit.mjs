/**
 * 触摸目标回归守卫（触摸靶尺寸的布局审计）。
 *
 * 为什么需要它：有一类缺陷是"按钮太小、真机上点不中"——.btn.tiny 曾经只有 24px，
 * 低于 iOS 44pt / Android 48dp 的下限，而且它落在城镇招募弹窗这类核心交互上。
 * 这种缺陷**截图看不出来、单测也测不到**（smoke 跑的是纯逻辑，没有布局引擎），
 * 上次是"发现得很晚而且很偶然"。没人会手动去量命中区，所以把量测固化成审计：
 * 谁下次动了布局、把某个靶子改小，这里就会红。
 *
 * 关键：用 `document.elementFromPoint` 量**真实命中区**，不是 `getBoundingClientRect`。
 * 盒子看着 32px、靠 ::after 撑到 44px 命中区的情况，只有 elementFromPoint 才量得出来。
 *
 * 两轮视口：
 *   桌面 1000×1600 + 移动 792×360 @3x。**≤860px 的移动规则只有移动轮才被激活** ——
 *   在只有桌面轮之前，整份 IA 规格（都在改 ≤860px）改完都无人守护。
 *   移动轮用 `effectiveHit`（逐像素命中）能识破"被容器 overflow 裁掉"的缺陷。
 *
 * 断言的不变量：
 *   桌面（1000×1600）：
 *   - .btn.primary          视觉高 ≥ 48px
 *   - .btn（普通）          视觉高 ≥ 44px
 *   - 密集区 .hp-nav        视觉高 ≥ 40px，相邻纵向间距 ≥ 8px（§5.2 中心距 ≥48）
 *   - 密集区 .hp-tbtns      视觉高 ≥ 40px，相邻横向间距 ≥ 8px
 *   - .btn.tiny.tap         有效命中高 ≥ 43px（::after 纵向扩张）
 *   - .spellbook .btn.tiny  视觉高 ≥ 44px
 *   移动（792×360 @3x）：
 *   - #side.collapsed 的 #panel-toggle 有效命中高 ≥ 44px（不被 34px 容器裁掉）
 *   - 各 .btn.tiny 同上阈值（防将来加移动规则把靶子改小）
 *   - C3 横向滚动 = 0（document / #topbar）—— 默认「信息」级；STRICT=1 升格为硬断言
 *
 * 用法：npm run build && node tools/serve.mjs（另开一个终端）&& node tools/tinytargetaudit.mjs
 *       STRICT=1 node tools/tinytargetaudit.mjs   # 把「已知待办」(C3 横向滚动) 也当硬断言
 * 退出码：0 = 全部达标；1 = 有不达标；2 = 环境没准备好（dist / dev server / Chrome 连不上）。
 */
import { writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_PORT = Number(process.env.PORT ?? 5173);
// 每次用不同端口：固定端口下，如果上一轮 Chrome 没退干净，findTarget 会连到那个**陈旧**
// 的实例上，量到的是旧 DOM（假 PASS/假 FAIL）。按 PID 派生端口，各跑各的，互不串台。
const CDP_PORT = 9200 + (process.pid % 700);
const PROBE_NAME = '_tinytargetprobe.html';
const PROBE = path.join(dist, PROBE_NAME);
// 移动视口：与真机横屏目标一致（ux-ia《in-game IA》§4 按 792×360 算屏预算）。
const MOBILE = { w: 792, h: 360, dpr: 3 };
// C3 等"已知待办"项默认只报不卡；STRICT=1 时升格为硬断言（顶栏重构批落地后可开）。
const STRICT = process.env.STRICT === '1';

if (!existsSync(path.join(dist, 'style.css'))) {
  console.error('dist/style.css 不存在，请先 npm run build');
  process.exit(2);
}

/* ---------------- 探针页：摆出与真实站点同构的 DOM，交 CDP 量 ---------------- */

const rep = (n, s) => Array.from({ length: n }, () => s).join('');

writeFileSync(
  PROBE,
  `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="./style.css">
<style>
  html,body{margin:0;background:#241a0e;color:#e8dcc0;font-family:sans-serif;overflow:visible!important}
  /* 别在探针里裁切：#stage{overflow:hidden} / .modal{overflow:auto} 会把边缘按钮的 ::after
     命中区切掉，造成假 FAIL —— 量的是命中区，就得让命中区完整可见。 */
  /* #stage 真机是 overflow:hidden，flex 项的 min-height:auto 因此归零 → 壳高被锁在 flex:1。
     探针为量边缘 ::after 命中区改成 overflow:visible；但那样 flex 的 min-height:auto 生效，
     #stage 会长成内容高，把常驻 bottom:0 的 #side 顶出视口。显式 min-height:0 把壳高锁回真机值。 */
  #stage{overflow:visible!important;min-height:0!important}
  .modal{overflow:visible!important;max-height:none!important}
  /* #side 是 z-index:10 的右列；招募行 .rlist 宽满 #stage，最右按钮会被它压住。
     真实里 .rlist 在模态层（更高 z-index）之上 —— 探针把它抬上去，免得量测被遮挡造成假 FAIL。 */
  .rlist{position:relative;z-index:30}
</style>
<div id="app">
  <!-- 顶栏做成**与真实同构**（7 资源 chip + 日期 + 阵营 + 6 按钮）：C3 的横向滚动
       只有同构才量得出来 —— 真实顶栏在 ≤860px 下 overflow-x:auto，这正是被测对象。 -->
  <div id="topbar">
    ${rep(7, '<div class="res"><img alt="r"><span class="val">999</span></div>')}
    <div class="spacer"></div>
    <div class="date">3周2日</div>
    <div class="who"><i></i><span>晨曦</span></div>
    <button class="btn primary">结束一天</button>
    <button class="btn">存档</button>
    <button class="btn">音效</button>
    <button class="btn">光照</button>
    <button class="btn">画质</button>
    <button class="btn danger">新游戏</button>
  </div>
  <div id="stage">
    <div class="modal"><div class="actions">
      <button class="btn primary">自动</button>
      <button class="btn">低</button>
      <button class="btn">重新检测</button>
    </div></div>

    <div class="spellbook"><table>
      <tr><th>法术</th><th>等级</th><th>消耗</th><th></th></tr>
      ${rep(4, '<tr><td>法术</td><td class="lv">战斗 1</td><td class="cost">5</td><td><button class="btn tiny">施放</button></td></tr>')}
    </table></div>

    <div class="rlist">
      ${rep(3, '<div class="rrow"><span class="un">兵种 ×10</span><span class="uc">100 金</span>' + rep(4, '<button class="btn tiny tap">招 1</button>') + '</div>')}
    </div>

    <!-- 侧栏 #side 的内容宽 = 264px − 2×10px padding = 244px；给个同宽的容器，
         避免纵列 .hp-nav 被拉伸到整页宽（宽度不参与断言，但表格要如实）。 -->
    <div style="width:244px">
      <div class="hp-tlist">
        ${rep(3, '<div class="hp-trow"><div class="hp-tdot mine"></div><div class="hp-tname">城镇</div><div class="hp-tmeta">驻军 3</div><div class="hp-tbtns"><button class="btn tiny">管理</button><button class="btn tiny">定位</button></div></div>')}
      </div>

      <div class="hp-nav"><button class="btn tiny">‹</button><button class="btn tiny">›</button><button class="btn tiny">宝物▾</button></div>

      <div class="sec hp-bars"><button class="btn tiny tap" style="margin-top:6px">魔法书</button></div>
    </div>

    <!-- #side.collapsed：≤860px 的收起态。旧缺陷是 max-height:34px + overflow:hidden 会把
         44px 的 #panel-toggle 一起裁掉 —— 这里放同构 DOM，供移动视口量「有效命中高」。 -->
    <aside id="side" class="collapsed">
      <button id="panel-toggle" class="btn">展开面板</button>
      <div><div class="sec">面板内容（收起时应整体隐藏）</div></div>
    </aside>
  </div>
</div>
<script>window.__ready = true;</script>
`,
  'utf8',
);

/* ---------------- 前置：dev server 必须在跑 ---------------- */

try {
  const res = await fetch(`http://127.0.0.1:${APP_PORT}/${PROBE_NAME}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (e) {
  console.error(
    `dev server 没在 127.0.0.1:${APP_PORT} 上跑（${e.message}）；先另开一个终端 node tools/serve.mjs`,
  );
  rmSync(PROBE, { force: true });
  process.exit(2);
}

/* ---------------- 起 headless Chrome + 连 CDP ---------------- */

const profile = mkdtempSync(path.join(tmpdir(), 'tinytarget-'));
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
    '--window-size=1000,1600',
    `http://127.0.0.1:${APP_PORT}/${PROBE_NAME}`,
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 收尾：等 chrome 真的退出再删临时 profile（直接 kill 完就删会撞 ENOTEMPTY）。 */
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
      await sleep(200);
    }
  }
}

/** 等 CDP 起来并拿到探针页 target。 */
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

/** 在页面里跑一段表达式，拿回结构化结果。 */
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? '页面内异常');
  }
  return r.result?.value;
}

/**
 * 页面内量测：对每个按钮，沿纵轴用 elementFromPoint 逐像素往外探，
 * 找到"还命中该按钮"的最大偏移 up/down —— 命中高 = 视觉高 + up + down。
 * 这正是 ::after 扩张能被看见的原因；getBoundingClientRect 量不到它。
 */
const MEASURE = `(() => {
  const rect = (el) => el.getBoundingClientRect();
  const hitIs = (el, x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === el || el.contains(e)); };
  const all = (s) => [...document.querySelectorAll(s)];
  const label = (el) => ((el.textContent || '').trim().slice(0, 12) || el.className);
  const measure = (el) => {
    const r = rect(el); const cx = r.left + r.width / 2;
    let up = 0; for (let d = 1; d <= 24; d++) { if (hitIs(el, cx, r.top - d + 0.5)) up = d; else break; }
    let down = 0; for (let d = 1; d <= 24; d++) { if (hitIs(el, cx, r.bottom + d - 0.5)) down = d; else break; }
    return { label: label(el), w: +r.width.toFixed(1), h: +r.height.toFixed(1), up, down, hit: +(r.height + up + down).toFixed(1) };
  };
  const g = (sel) => all(sel).map(measure);
  const gapH = (e) => (e.length >= 2 ? +(rect(e[1]).left - rect(e[0]).right).toFixed(1) : null);
  const gapV = (e) => (e.length >= 2 ? +(rect(e[1]).top - rect(e[0]).bottom).toFixed(1) : null);
  const out = { groups: {}, gaps: {} };
  out.groups.primary   = g('#topbar .btn.primary, .modal .actions .btn.primary');
  out.groups.normal    = g('#topbar .btn:not(.primary):not(.tiny), .modal .actions .btn:not(.primary)');
  out.groups.spellbook = g('.spellbook .btn.tiny');
  out.groups.rrowTap   = g('.rrow .btn.tiny.tap');
  out.groups.hpTbtns   = g('.hp-tbtns .btn.tiny');
  out.groups.hpNav     = g('.hp-nav .btn.tiny');
  out.groups.magicTap  = g('.hp-bars .btn.tiny.tap');
  out.gaps.hpTbtns = gapH(all('.hp-tbtns .btn.tiny'));
  out.gaps.hpNav = gapV(all('.hp-nav .btn.tiny'));
  return out;
})()`;

/**
 * 移动视口（≤860px，792×360 @3x）量测 —— 只量这里才有意义的两个东西：
 *   ① #side.collapsed 的开关。用 `effectiveHit` 沿纵轴**逐像素**求"真正命中"的连续区间，
 *      能识破「视觉高 44、却被容器 overflow 裁到 34」这类缺陷
 *      （`getBoundingClientRect` 量不出裁切：被裁的部分 rect 仍在，只是点不到了）。
 *   ② C3 横向滚动：doc + #topbar 的 `scrollWidth − clientWidth`（由宽度决定，与高度无关）。
 * #panel-toggle 常驻 #side 底部（bottom:0），无需滚动即在视口内。
 */
const MOBILE_MEASURE = `(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const rect = (el) => el.getBoundingClientRect();
  const hitIs = (el, x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === el || el.contains(e)); };
  const all = (s) => [...document.querySelectorAll(s)];
  const label = (el) => ((el.textContent || '').trim().slice(0, 12) || el.className);

  // 逐像素求"有效命中高"：能识破被 overflow 裁掉的部分（rect 量不出裁切）。
  const effectiveHit = (el) => {
    const r = rect(el); const cx = r.left + r.width / 2;
    let first = null, last = null;
    for (let y = Math.floor(r.top); y <= Math.ceil(r.bottom); y++) {
      if (hitIs(el, cx, y + 0.5)) { if (first === null) first = y; last = y; }
    }
    let up = 0; for (let d = 1; d <= 24; d++) { if (hitIs(el, cx, r.top - d + 0.5)) up = d; else break; }
    let down = 0; for (let d = 1; d <= 24; d++) { if (hitIs(el, cx, r.bottom + d - 0.5)) down = d; else break; }
    return { label: label(el), w: +r.width.toFixed(1), h: +r.height.toFixed(1), up, down,
             hit: first === null ? 0 : (last - first + 1) };
  };
  const measure = (el) => {
    const r = rect(el); const cx = r.left + r.width / 2;
    let up = 0; for (let d = 1; d <= 24; d++) { if (hitIs(el, cx, r.top - d + 0.5)) up = d; else break; }
    let down = 0; for (let d = 1; d <= 24; d++) { if (hitIs(el, cx, r.bottom + d - 0.5)) down = d; else break; }
    return { label: label(el), w: +r.width.toFixed(1), h: +r.height.toFixed(1), up, down, hit: +(r.height + up + down).toFixed(1) };
  };

  // #side.collapsed 的开关常驻视口底部（bottom:0），直接量「有效命中高」以识破裁切。
  const toggle = all('#panel-toggle').map(effectiveHit);

  // C3：横向滚动（由宽度决定，与高度无关）。
  const de = document.scrollingElement || document.documentElement;
  const tb = document.querySelector('#topbar');
  return {
    toggle,
    overflow: {
      doc: Math.round(de.scrollWidth - de.clientWidth),
      topbar: tb ? Math.round(tb.scrollWidth - tb.clientWidth) : null,
    },
    viewport: { w: de.clientWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    debug: (() => {
      const s = document.querySelector('#side');
      const t = document.querySelector('#panel-toggle');
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
      const tr = r(t); const cx = tr.x + tr.w / 2, cy = tr.y + tr.h / 2;
      const at = document.elementFromPoint(cx, cy);
      return {
        mq860: matchMedia('(max-width:860px)').matches,
        innerW: window.innerWidth, innerH: window.innerHeight,
        app: r(document.querySelector('#app')), stage: r(document.querySelector('#stage')),
        side: r(s), toggle: tr,
        sideDisplay: getComputedStyle(s).display, toggleDisplay: getComputedStyle(t).display,
        sideW: getComputedStyle(s).width,
        atCenter: at ? (at.id || at.className || at.tagName) : null,
      };
    })(),
  };
})()`;

/**
 * 移动视口下的 .btn.tiny 目标尺寸。
 * 用 792×1000 的"高"视口让纵深里的元素也进视口再量 —— elementFromPoint 量不到视口外的元素，
 * 所以 360 高只能量到露头的那几个。宽仍 792，媒体查询口径与真机一致。
 */
const MOBILE_TARGETS = `(() => {
  const rect = (el) => el.getBoundingClientRect();
  const hitIs = (el, x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === el || el.contains(e)); };
  const all = (s) => [...document.querySelectorAll(s)];
  const label = (el) => ((el.textContent || '').trim().slice(0, 12) || el.className);
  const measure = (el) => {
    const r = rect(el); const cx = r.left + r.width / 2;
    let up = 0; for (let d = 1; d <= 24; d++) { if (hitIs(el, cx, r.top - d + 0.5)) up = d; else break; }
    let down = 0; for (let d = 1; d <= 24; d++) { if (hitIs(el, cx, r.bottom + d - 0.5)) down = d; else break; }
    return { label: label(el), w: +r.width.toFixed(1), h: +r.height.toFixed(1), up, down, hit: +(r.height + up + down).toFixed(1) };
  };
  const g = (s) => all(s).map(measure);
  return {
    groups: {
      spellbook: g('.spellbook .btn.tiny'),
      rrowTap: g('.rrow .btn.tiny.tap'),
      hpTbtns: g('.hp-tbtns .btn.tiny'),
      hpNav: g('.hp-nav .btn.tiny'),
      magicTap: g('.hp-bars .btn.tiny.tap'),
    },
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
  };
})()`;

/* ---------------- 跑 ---------------- */

let res;
let mobile;
let mobileTall;
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
  for (let i = 0; i < 60; i++) {
    if (await evaluate('!!window.__ready')) break;
    await sleep(100);
  }
  await sleep(250); // 等一次布局稳定
  res = await evaluate(MEASURE);

  // Phase B：切移动视口（792×360，DPR 3）重排后再量 —— 所有 ≤860px 的移动规则只有在这里才被激活。
  await send('Emulation.setDeviceMetricsOverride', {
    width: MOBILE.w,
    height: MOBILE.h,
    deviceScaleFactor: MOBILE.dpr,
    mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await sleep(350); // 等媒体查询重算 + 重排
  mobile = await evaluate(MOBILE_MEASURE);

  // Phase C：同宽、把高度加到 1000 —— 让纵深里的 .btn.tiny 也进视口，量它们的移动口径尺寸
  // （elementFromPoint 量不到视口外的元素；360 高只能量到露头的那几个）。
  await send('Emulation.setDeviceMetricsOverride', {
    width: MOBILE.w,
    height: 1000,
    deviceScaleFactor: MOBILE.dpr,
    mobile: true,
  });
  await sleep(300);
  mobileTall = await evaluate(MOBILE_TARGETS);
} catch (e) {
  console.error(`跑审计失败：${e.message}`);
  await cleanup();
  rmSync(PROBE, { force: true });
  process.exit(2);
}

await cleanup();
rmSync(PROBE, { force: true });

/* ---------------- 表格 + 断言 ---------------- */

const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
let bad = 0;

function reportGroup(name, list, pred, desc) {
  console.log(`\n[${name}] ${desc}`);
  if (!list || !list.length) {
    console.log('  FAIL  没找到任何元素（探针 DOM 变了？）');
    bad++;
    return;
  }
  for (const m of list) {
    const ok = pred(m);
    if (!ok) bad++;
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${pad(m.label, 14)} 视觉 ${pad(m.w + '×' + m.h, 11)}命中高 ${pad(m.hit, 6)}(±${m.up}/${m.down})`,
    );
  }
}

console.log('触摸目标审计（真实命中区，elementFromPoint 量测）');

reportGroup('primary', res.groups.primary, (m) => m.h >= 48, '.btn.primary 视觉高 ≥ 48px');
reportGroup('normal', res.groups.normal, (m) => m.h >= 44, '.btn 普通 视觉高 ≥ 44px');
reportGroup('spellbook', res.groups.spellbook, (m) => m.h >= 44, '.spellbook .btn.tiny 视觉高 ≥ 44px');
reportGroup('rrow .tap', res.groups.rrowTap, (m) => m.hit >= 43, '.btn.tiny.tap 有效命中高 ≥ 43px');
reportGroup('hp-tbtns', res.groups.hpTbtns, (m) => m.h >= 40, '密集区 .hp-tbtns 视觉高 ≥ 40px（§5.2 密集区 ≥40×40）');
reportGroup('hp-nav', res.groups.hpNav, (m) => m.h >= 40, '密集区 .hp-nav 视觉高 ≥ 40px（§5.2 密集区 ≥40×40）');
reportGroup('魔法书 .tap', res.groups.magicTap, (m) => m.hit >= 43, '孤立 .btn.tiny.tap 有效命中高 ≥ 43px');

// 所有 .btn.tiny 的绝对底线：真实盒子 ≥ 40px（ux-ia §5.2：密集区元素 ≥40×40）
const allTiny = [].concat(
  res.groups.spellbook,
  res.groups.rrowTap,
  res.groups.hpTbtns,
  res.groups.hpNav,
  res.groups.magicTap,
);
const tinyFloor = allTiny.every((m) => m.h >= 40);
if (!tinyFloor) bad++;
console.log(`\n[底线] 所有 .btn.tiny 真实盒子 ≥ 40px —— ${tinyFloor ? 'PASS' : 'FAIL'}`);

// 密集区间距
const gapT = res.gaps.hpTbtns;
const gapN = res.gaps.hpNav;
const okGapT = typeof gapT === 'number' && gapT >= 8;
// §5.2 密集区「中心距 ≥ 48px」：40px 盒 + gap ≥ 8 = 48。
const okGapN = typeof gapN === 'number' && gapN >= 8;
if (!okGapT) bad++;
if (!okGapN) bad++;
console.log(`[间距] .hp-tbtns 横向间距 ${gapT}px ≥ 8 —— ${okGapT ? 'PASS' : 'FAIL'}`);
console.log(`[间距] .hp-nav 纵向间距 ${gapN}px ≥ 8（§5.2 中心距 ≥48）—— ${okGapN ? 'PASS' : 'FAIL'}`);

/* ---------------- 移动视口（≤860px）：只有在此，移动规则才被激活 ---------------- */

const vp = mobile.viewport;
console.log(`\n── 移动视口 ${vp.w}×${vp.h} @${vp.dpr}x（≤860px 规则在此激活） ──`);

// ① #side.collapsed：开关不被容器裁掉（§5.3 / §8-B）。
//    用 effectiveHit ——「视觉高 44 但被容器裁到 34」这种，只有逐像素命中才看得出来。
reportGroup('side.collapsed', mobile.toggle, (m) => m.hit >= 44,
  '#side.collapsed 的 #panel-toggle 有效命中高 ≥ 44px（不被 34px 容器裁掉）');

// ② .btn.tiny 的移动口径尺寸（792 宽 × 1000 高量；宽≤860 目前无覆盖，量上防将来加移动规则）。
const mt = mobileTall.viewport;
console.log(`\n── 移动口径 .btn.tiny（${mt.w} 宽 × ${mt.h} 高） ──`);
reportGroup('m.spellbook', mobileTall.groups.spellbook, (m) => m.h >= 44, '移动 · .spellbook .btn.tiny 视觉高 ≥ 44px');
reportGroup('m.rrow .tap', mobileTall.groups.rrowTap, (m) => m.hit >= 43, '移动 · .btn.tiny.tap 有效命中高 ≥ 43px');
reportGroup('m.hp-tbtns', mobileTall.groups.hpTbtns, (m) => m.h >= 40, '移动 · 密集区 .hp-tbtns 视觉高 ≥ 40px');
reportGroup('m.hp-nav', mobileTall.groups.hpNav, (m) => m.h >= 40, '移动 · 密集区 .hp-nav 视觉高 ≥ 40px');
reportGroup('m.魔法书 .tap', mobileTall.groups.magicTap, (m) => m.hit >= 43, '移动 · 孤立 .btn.tiny.tap 有效命中高 ≥ 43px');

// ③ C3：禁止任何常驻元素引发横向滚动（现顶栏 overflow-x:auto）。
//    已知待办 → 默认只报不卡；顶栏重构批落地后设 STRICT=1 升格为硬断言。
const docOver = mobile.overflow.doc;
const tbOver = mobile.overflow.topbar;
const overflowOK = docOver <= 0 && (tbOver === null || tbOver <= 0);
if (!overflowOK && STRICT) bad++;
console.log(
  `\n[${overflowOK ? 'PASS' : STRICT ? 'FAIL' : '信息'}] C3 横向滚动：document ${docOver}px / #topbar ${tbOver}px（应为 0）` +
    (overflowOK || STRICT ? '' : ' —— 已知待办（顶栏重构批移除 #topbar overflow-x:auto）；STRICT=1 可升格为硬断言'),
);

// 信息（非断言）：移动端 #side 应是**整宽底部抽屉**（≤860 规则写的是 width:auto）。
// 实测若远小于视口宽 → 说明有更高优先级的 `#side{width:252px}` 把它盖掉了。见报告。
const sideW = mobile.debug.side.w;
const sideFull = sideW >= vp.w * 0.9;
console.log(
  `[${sideFull ? 'PASS' : '信息'}] 移动 · #side 底部抽屉宽度 ${sideW}px / 视口 ${vp.w}px（≤860 期望整宽 auto）` +
    (sideFull ? '' : ' —— 被更高优先级的 #side{width:252px} 覆盖；见报告'),
);

console.log(bad === 0 ? '\n全部通过：触摸目标达标' : `\n${bad} 项不合格`);
process.exit(bad === 0 ? 0 : 1);
