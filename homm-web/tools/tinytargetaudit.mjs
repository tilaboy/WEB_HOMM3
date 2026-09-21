/**
 * 触摸目标回归守卫（触摸靶尺寸 + 顶栏/拇指带结构性约束）。
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
 * 三段视口 + 一个真实 app 阶段：
 *   ① 桌面 1000×1600（合成探针）—— 微观靶子（.btn/.btn.tiny/.hp-*），要确定性 DOM。
 *   ② 移动 792×360 @3x（合成探针）—— ≤860px 才激活的移动规则；`effectiveHit`（逐像素命中）
 *      能识破"被容器 overflow 裁掉"的缺陷（`getBoundingClientRect` 量不出裁切）。
 *   ③ **真实 app**（`index.html?devquick=1`）—— 顶栏只读（C4）与拇指带尺寸这类**结构性约束**
 *      必须量真实 DOM，否则就是"我自己写的 fixture 自证"，等于没测。
 *
 * 断言的不变量：
 *   桌面（1000×1600，合成探针）：
 *   - .btn.primary          视觉高 ≥ 48px
 *   - .btn（普通）          视觉高 ≥ 44px
 *   - .spellbook .btn.tiny  视觉高 ≥ 44px
 *   - .btn.tiny.tap         有效命中高 ≥ 43px（::after 纵向扩张）
 *   - 密集区 .hp-nav / .hp-tbtns  视觉高 ≥ 40px，间距满足 §5.2
 *   移动（792×360 @3x，合成探针）：
 *   - #side.collapsed 的 #panel-toggle 有效命中高 ≥ 44px（不被容器裁掉）
 *   - 各 .btn.tiny 同桌面阈值（防将来加移动规则把靶子改小）
 *   真实 app（顶栏 / 拇指带 —— 默认「信息」级；STRICT=1 升格为硬断言）：
 *   - C4 顶栏可点元素 = 0 且 `pointer-events:none`（R7 顶栏只读）
 *   - C3 多宽度(720/792/860)横向溢出 = 0，且子项不得高过顶栏（换行）
 *   - 拇指带高 ≤ 48px、无横向溢出、每个 .btn 视觉高 ≥ 44px（主操作 48）
 *
 * 用法：npm run build && node tools/tinytargetaudit.mjs
 *       （dev server 没在 127.0.0.1:5173 上跑就**自起** node tools/serve.mjs，结束时关掉）
 *       STRICT=1 node tools/tinytargetaudit.mjs   # 把「已知待办」(顶栏 C3/C4/换行) 也当硬断言
 * 退出码：0 = 全部达标；1 = 有不达标；2 = 环境没准备好（dist / Chrome 连不上 / app 起不来）。
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
// 移动视口：与**真机自然横屏**一致（792×320）。D-65：原用 792×360 是"理想横屏"，
// 真机顶部安全区会吃掉 40px（360→320）——同一份 CSS 下这 40px 会把城镇面板内容窗从 48 压到 18，
// 正是城镇面板回归（D-66）能绿灯放行的原因之一。守卫必须量真实值。
const MOBILE = { w: 792, h: 320, dpr: 3 };
// C3 等"已知待办"项默认只报不卡；STRICT=1 时升格为硬断言（顶栏重构批落地后已开）。
const STRICT = process.env.STRICT === '1';

if (!existsSync(path.join(dist, 'style.css'))) {
  console.error('dist/style.css 不存在，请先 npm run build');
  process.exit(2);
}

/* ---------------- 探针页：摆出与真实站点同构的微观靶子 DOM，交 CDP 量 ----------------
   注意：顶栏做成**只读**（与 2026-09-19 UI 重构批一致）—— 顶栏本身的可点性由「真实 app」
   阶段断言，这里只保留一个 read-only 顶栏，以免合成 fixture 制造假 C4 失败。 */

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
  <!-- 顶栏做成**只读**（与重构批一致）：3 资源 + 稀有聚合槽 + 日期 + 色点，零按钮。 -->
  <div id="topbar">
    ${rep(3, '<div class="res"><img alt=""><span class="val">999</span></div>')}
    <div class="res rare"><img alt=""><span class="val">7</span></div>
    <div class="spacer"></div>
    <div class="date">3周2日</div>
    <i class="who-dot"></i>
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

    <!-- #side.collapsed：**默认收起态**（48px 竖条，IA §4.2 / §9 F3）。
         旧缺陷是 max-height:34px + overflow:hidden 会把 44px 的 #panel-toggle 一起裁掉 ——
         这里放同构 DOM，供移动视口量「有效命中高」。 -->
    <aside id="side" class="collapsed">
      <button id="panel-toggle" class="btn">英雄</button>
      <div><div class="sec">面板内容（收起时应整体隐藏）</div></div>
    </aside>
  </div>
</div>
<script>window.__ready = true;</script>
`,
  'utf8',
);

/* ---------------- 前置：dev server 必须在跑（没跑就自起） ---------------- */

// 这道守卫值得"顺手能跑" —— 起不来的话没人会跑它，等于没有守卫。
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reachable = async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${APP_PORT}/${PROBE_NAME}`, {
      signal: AbortSignal.timeout(2000),
    });
    return r.ok;
  } catch {
    return false;
  }
};

let serverProc = null;
if (!(await reachable())) {
  console.error(`[tiny] dev server 未响应 → 自起 node tools/serve.mjs（:${APP_PORT}）…`);
  serverProc = spawn('node', ['tools/serve.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(APP_PORT) },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 40 && !(await reachable()); i++) await wait(150);
}

if (!(await reachable())) {
  console.error(`[tiny] dev server 起不来（127.0.0.1:${APP_PORT}）—— 手工跑 node tools/serve.mjs 再看`);
  serverProc?.kill('SIGKILL');
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
  if (serverProc && !serverProc.killed) serverProc.kill('SIGKILL');
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
 * 移动视口（≤860px，792×360 @3x）量测 —— 只量这里才有意义的 #side.collapsed 开关。
 * 用 `effectiveHit` 沿纵轴**逐像素**求"真正命中"的连续区间，
 * 能识破「视觉高 44、却被容器 overflow 裁到 34」这类缺陷
 * （`getBoundingClientRect` 量不出裁切：被裁的部分 rect 仍在，只是点不到了）。
 */
const MOBILE_MEASURE = `(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await raf();
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

  const toggle = all('#panel-toggle').map(effectiveHit);
  const de = document.scrollingElement || document.documentElement;
  return {
    toggle,
    debug: (() => {
      const s = document.querySelector('#side');
      const t = document.querySelector('#panel-toggle');
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
      return {
        mq860: matchMedia('(max-width:860px)').matches,
        innerW: window.innerWidth, innerH: window.innerHeight,
        side: s ? r(s) : null, toggle: t ? r(t) : null,
        sideW: s ? getComputedStyle(s).width : null,
      };
    })(),
    viewport: { w: de.clientWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
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

/**
 * **真实 app** 顶栏体检（供多宽度扫描 720 / 792 / 860）。
 * C3 的口径是「**任何目标宽度**都不得横向溢出」—— 只在 792 测等于守卫闲置。
 * 同时量 C4（可点元素 = 0）与换行（子项高 ≤ 条高，越窄越容易换行）。
 */
const APP_TOPBAR = `(() => {
  const tb = document.querySelector('#topbar');
  if (!tb) return null;
  const rect = (el) => el.getBoundingClientRect();
  const tbr = rect(tb);
  const kids = [...tb.children];
  const clickable = tb.querySelectorAll('button, a[href], input, select, textarea, [tabindex]').length;
  const taller = kids
    .filter((c) => rect(c).height > tbr.height + 0.5)
    .map((c) => (String(c.className || c.tagName)) + '=' + rect(c).height.toFixed(0));
  const de = document.scrollingElement || document.documentElement;
  return {
    vw: de.clientWidth,
    topbarOverflow: Math.round(tb.scrollWidth - tb.clientWidth),
    docOverflow: Math.round(de.scrollWidth - de.clientWidth),
    barH: +tbr.height.toFixed(1),
    maxChildH: kids.length ? +Math.max(...kids.map((c) => rect(c).height)).toFixed(1) : 0,
    clickable,
    pe: getComputedStyle(tb).pointerEvents,
    taller,
  };
})()`;

/** **真实 app** 拇指带体检：高 ≤48、无横向溢出、每个 .btn 视觉高 ≥44。 */
const APP_THUMB = `(() => {
  const th = document.querySelector('#thumb');
  if (!th) return null;
  const rect = (el) => el.getBoundingClientRect();
  const btns = [...th.querySelectorAll('.btn')].map((b) => ({
    t: (b.textContent || '').trim().replace(/\\s+/g, ' '),
    h: +rect(b).height.toFixed(1),
    w: +rect(b).width.toFixed(1),
    primary: b.classList.contains('primary'),
  }));
  const de = document.scrollingElement || document.documentElement;
  return {
    barH: +rect(th).height.toFixed(1),
    overflow: Math.round(th.scrollWidth - th.clientWidth),
    docOverflow: Math.round(de.scrollWidth - de.clientWidth),
    count: btns.length,
    btns,
    minBtnH: btns.length ? +Math.min(...btns.map((b) => b.h)).toFixed(1) : 0,
    minPrimaryH: btns.filter((b) => b.primary).length
      ? +Math.min(...btns.filter((b) => b.primary).map((b) => b.h)).toFixed(1)
      : 0,
  };
})()`;

/**
 * **真实 app** 菜单体检（④ / F-3.6 / IA §15.4）：把「日志入口」从拇指带**搬进菜单一级项**、
 * 「未读角标」迁到常驻的「菜单」按钮之后，**必须有一条会红的回归守卫**证明"搬过了、没搬丢"。
 * 没有它的话，谁下次把「日志」按钮加回拇指带（或从菜单删掉「事件日志」）都能绿灯放行
 * —— 这正是本次改动的语义资产（IA §3.2 #23 ①②③「信息只搬家不丢失」）。
 *
 * 读的是**真实 DOM**：点一下「菜单」，数 `.menu-item`，再 remove 复原以免污染后续阶段。
 * 说明：`count`（菜单一级项数）作**上限守卫**（≤ §7 上限，现为 6）**硬断言** —— 守卫的是
 * 「菜单不膨胀」这条要求，**不是当时的读数**。判据与理由见断言处注释。
 */
const APP_MENU = `(() => {
  const btns = [...document.querySelectorAll('#thumb .btn')];
  const menuBtn = btns.find((b) => (b.textContent || '').includes('菜单'));
  if (!menuBtn) return { error: '拇指带无「菜单」按钮' };
  const thumbLabels = btns.map((b) => (b.textContent || '').trim().replace(/\\s+/g, ' '));
  const thumbHasLog = thumbLabels.some((t) => t.includes('日志'));
  const badgeOnMenu = !!menuBtn.querySelector('.tb-badge');
  const menuAria = menuBtn.getAttribute('aria-label') || '';
  menuBtn.click();
  const root = document.getElementById('menu');
  const items = root ? [...root.querySelectorAll('.menu-item')].map((b) => (b.textContent || '').trim()) : [];
  if (root) root.remove();
  return { thumbLabels, thumbHasLog, badgeOnMenu, menuAria, items, count: items.length };
})()`;

/**
 * **真实 app** 城镇面板体检（D-66 / D-68）：把 P3 最重要的窗口**真的打开来量**。
 *
 * 为什么单列一段：本探针此前**从不打开城镇面板**（没有任何动作打开它），
 * 于是 P3 的内容窗回归（`.town-pane` 被挤到 48px、7 张卡一张看不全）**全程绿灯放行**。
 * 「判有没有覆盖要找行为，不是数 token」（D-65）。这里用 `?devtown=1` 真开面板
 * （等价于点 #side 的「管理」，但更稳、不依赖 UI 文案）。
 *
 * 量：pane 的 clientHeight（应 ≥120）、建筑页**完整可见**的 .bcard 数（应 ≥4 = 2 列 × 2 行）、
 * 及其余 4 页各 ≥1 个完整可见的行块。判「完整可见」= 该块 rect 完整落在 pane 的 rect 内。
 */
const TOWN_PANEL = `(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const qa = (s, root = document) => [...root.querySelectorAll(s)];
  const rect = (el) => el.getBoundingClientRect();
  let pane = null;
  for (let i = 0; i < 60 && !pane; i++) { await raf(); pane = document.querySelector('.modal.wide .town-pane'); }
  if (!pane) return { error: '没打开 .modal.wide .town-pane（?devtown=1 没进对局 / 无己方城镇？）' };
  const modal = document.querySelector('.modal.wide');
  const head = document.querySelector('.modal.wide .modal-head');
  const tabs = qa('.town-tabs .btn');
  const visible = (r, pr) => r.bottom <= pr.bottom + 0.5 && r.top >= pr.top - 0.5;
  const measureTab = async (label) => {
    if (label) {
      const b = tabs.find((x) => (x.textContent || '').trim() === label);
      if (!b) return { label, error: '找不到标签' };
      b.click();
      await raf();
    }
    const pr = rect(pane);
    const cards = qa('.bcard', pane).map((c) => ({ h: +rect(c).height.toFixed(1), full: visible(rect(c), pr) }));
    const rows = qa('.rrow, .ex-row, .my-res', pane).map((c) => ({ h: +rect(c).height.toFixed(1), full: visible(rect(c), pr) }));
    return {
      label: label || '(当前页)',
      paneClientH: pane.clientHeight,
      paneScrollH: pane.scrollHeight,
      cardsTotal: cards.length,
      cardsFull: cards.filter((c) => c.full).length,
      rowsTotal: rows.length,
      rowsFull: rows.filter((r) => r.full).length,
      firstCardH: cards.length ? cards[0].h : null,
      firstRowH: rows.length ? rows[0].h : null,
    };
  };
  const out = {
    modalH: +rect(modal).height.toFixed(1),
    headH: head ? +rect(head).height.toFixed(1) : null,
    paneClientH: pane.clientHeight,
    paneScrollH: pane.scrollHeight,
    paneH: +rect(pane).height.toFixed(1),
    vp: { w: window.innerWidth, h: window.innerHeight },
    tabs: {},
  };
  out.tabs.build = await measureTab('建筑');
  out.debug = (() => {
    const cs = getComputedStyle(modal);
    const root = document.querySelector('#modal-root');
    const stg = document.querySelector('#stage');
    const meta = document.querySelector('.town-meta');
    const tabsEl = document.querySelector('.town-tabs');
    const h = (el) => (el ? +rect(el).height.toFixed(1) : null);
    // 实测「天花板」：把面板撑到 modal-root 的内容盒满高，看 pane 最多能拿多少。
    const paneBefore = pane.clientHeight;
    modal.style.height = '100%';
    modal.style.maxHeight = '100%';
    const paneAt100 = pane.clientHeight; // 读 clientHeight 强制重排
    modal.style.height = '';
    modal.style.maxHeight = '';
    return {
      modalH: cs.height, modalMaxH: cs.maxHeight,
      rootH: root ? getComputedStyle(root).height : null,
      rootPad: root ? getComputedStyle(root).padding : null,
      rootContentH: root ? root.clientHeight : null,
      stageH: stg ? getComputedStyle(stg).height : null,
      appH: document.querySelector('#app') ? getComputedStyle(document.querySelector('#app')).height : null,
      headH: h(document.querySelector('.modal.wide .modal-head')),
      metaH: h(meta), tabsH: h(tabsEl), townH: h(document.querySelector('.modal.wide > .town')),
      paneBeforeH: paneBefore, paneAt100H: paneAt100,
      cardH: h(document.querySelector('.bcard')),
      bsClamp: (() => { const bs = document.querySelector('.bcard .bs'); return bs ? { clientW: bs.clientWidth, scrollW: bs.scrollWidth, clipped: bs.scrollWidth > bs.clientWidth + 1 } : null; })(),
      innerH: window.innerHeight,
    };
  })();

  // D-70：点建筑名 → 描述浮层。验收：desc 高>0 且在 pane 内，且**点击前后**完整可见卡数仍 ≥4。
  out.d70 = await (async () => {
    const bn = pane.querySelector('.bcard .bn');
    if (!bn) return { error: '没有 .bcard .bn' };
    const count = () => {
      const pr = rect(pane);
      return qa('.bcard', pane).filter((c) => { const r = rect(c); return r.bottom <= pr.bottom + 0.5 && r.top >= pr.top - 0.5; }).length;
    };
    const beforeCards = count();
    bn.click();
    await raf();
    const el = pane.querySelector('.bdesc');
    const pr = rect(pane);
    const r = el ? rect(el) : null;
    return {
      beforeCards,
      afterCards: count(),
      descH: r ? +r.height.toFixed(1) : 0,
      descInPane: !!r && r.bottom <= pr.bottom + 0.5 && r.top >= pr.top - 0.5,
      descText: el ? (el.textContent || '').slice(0, 16) : null,
    };
  })();

  out.tabs.dwell = await measureTab('兵营·行会');
  out.tabs.recruit = await measureTab('招募');
  out.tabs.army = await measureTab('驻军');
  out.tabs.market = await measureTab('市场·工坊');
  // 收尾：关面板，别影响后面的 a11y 阶段
  const back = document.querySelector('.modal.wide .modal-head .btn');
  if (back) { back.click(); await raf(); }
  return out;
})()`;

/** a11y 可机检项（`accessibility-requirements.md` §5 第 2/3/4/5 条）。 */
const A11Y = `(() => {
  const out = { focusVisible: { found: false, width: 0 }, reducedMotion: false, labels: {}, mediaTexts: [] };
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list) => {
      for (const r of list) {
        if (r.media) {
          const cond = r.conditionText || r.media.mediaText || '';
          out.mediaTexts.push(cond);
          if (/prefers-reduced-motion/.test(cond)) out.reducedMotion = true;
          if (r.cssRules) walk(r.cssRules);
          continue;
        }
        if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; }
        if (!r.selectorText) continue;
        if (/:focus-visible/.test(r.selectorText)) {
          const m = /outline:\\s*([\\d.]+)px/.exec(r.cssText || '');
          if (m) { out.focusVisible.found = true; out.focusVisible.width = Math.max(out.focusVisible.width, parseFloat(m[1])); }
        }
      }
    };
    walk(rules);
  }
  // §4.3：「图标 + 数字」项必须有可访问名（否则读屏只念一个孤零零的数字）
  const res = [...document.querySelectorAll('#topbar .res')];
  out.labels.topbarItems = res.length;
  out.labels.topbarNamed = res.filter((e) => !!((e.getAttribute('aria-label') || '').trim())).length;
  // 拇指带 = 纯文字标签（§2 #9「标签即名称」）
  const thumbs = [...document.querySelectorAll('#thumb .btn')];
  out.labels.thumbBtns = thumbs.length;
  out.labels.thumbWithText = thumbs.filter((b) => (b.textContent || '').trim().length > 0).length;
  return out;
})()`;

/* ---------------- 跑 ---------------- */

let res;
let mobile;
let mobileTall;
let appTopbar = [];
let appThumb = null;
let appMenu = null;
let townPanel = null;
let a11y = null;
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

  // Phase B：切移动视口（792×320，DPR 3）重排后再量 —— 所有 ≤860px 的移动规则只有在这里才被激活。
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

  // Phase D：切到**真实 app**。顶栏只读（C4）与拇指带尺寸这类结构性约束必须在真实 DOM 上断言 ——
  // 合成探针只负责量微观靶子；用自己写的 fixture 去证明自己的布局，等于没测。
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/index.html?devquick=1` });
  let appReady = false;
  for (let i = 0; i < 140; i++) {
    try {
      appReady = await evaluate(`!!document.querySelector('#thumb') && !!document.querySelector('#topbar')`);
      if (appReady) break;
    } catch {
      /* 导航中执行上下文未就绪，继续等 */
    }
    await sleep(120);
  }
  if (!appReady) throw new Error('真实 app 未挂载出 #topbar / #thumb（?devquick=1 没进对局？）');
  await sleep(450); // 等首帧 + refresh() 写入

  // C3 多宽度扫描（720 / 792 / 860）：只在 792 测等于守卫闲置，任何目标宽度都不得横向溢出。
  for (const w of [720, 792, 860]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: MOBILE.h,
      deviceScaleFactor: MOBILE.dpr,
      mobile: true,
    });
    await sleep(280);
    appTopbar.push({ w, ...(await evaluate(APP_TOPBAR)) });
  }
  await send('Emulation.setDeviceMetricsOverride', {
    width: MOBILE.w,
    height: MOBILE.h,
    deviceScaleFactor: MOBILE.dpr,
    mobile: true,
  });
  await sleep(280);
  appThumb = await evaluate(APP_THUMB);
  // ④ 守卫：同一页（?devquick=1、已复位到 792×320）点开菜单量一次，再复原。
  appMenu = await evaluate(APP_MENU);

  // Phase D2（D-66 / D-68）：真打开城镇面板量内容窗。用 `?devtown=1` 直接开我方首座城镇，
  // 避开"合成 fixture 自证"的陷阱，也避开关窗文案依赖。视口沿用 792×320（真机自然横屏）。
  await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/index.html?devquick=1&devtown=1` });
  let townReady = false;
  for (let i = 0; i < 160; i++) {
    try {
      townReady = await evaluate(`!!document.querySelector('.modal.wide .town-pane')`);
      if (townReady) break;
    } catch {
      /* 导航中执行上下文未就绪，继续等 */
    }
    await sleep(100);
  }
  await sleep(320); // 等首帧 + 面板布局稳定
  townPanel = await evaluate(TOWN_PANEL);

  // Phase E：a11y —— ① 扫 CSSOM 找 `:focus-visible` 与 `prefers-reduced-motion` 块；
  // ② **行为验证**：用 CDP 模拟 reduce，看**计算样式**是否真的缩短（只看源码字符串会被"改了注释也算过"骗到）。
  a11y = await evaluate(A11Y);
  // 注意：Chrome 会把 0.001ms 归一成 `1e-06s`（科学计数法）—— 别用 `([\d.]+)(ms|s)` 去抓，
  // 那会把 "1e-06s" 里的 "06s" 当成 6 秒，断言恰好反着走。parseFloat 认得科学计数法。
  const durSec = (s) => {
    const v = parseFloat(s);
    if (!Number.isFinite(v)) return 0;
    return /ms\s*$/.test(String(s)) ? v / 1000 : v;
  };
  a11y.reducedBefore = await evaluate(`getComputedStyle(document.querySelector('#hint')).transitionDuration`);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(220);
  a11y.reducedAfter = await evaluate(`getComputedStyle(document.querySelector('#hint')).transitionDuration`);
  await send('Emulation.setEmulatedMedia', { features: [] });
  a11y.reducedWorks =
    durSec(a11y.reducedAfter) < durSec(a11y.reducedBefore) && durSec(a11y.reducedAfter) <= 1e-3 + 1e-9;
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

/* ---------------- 移动视口（≤860px，合成探针）：只有在此，移动规则才被激活 ---------------- */

const vp = mobile.viewport;
console.log(`\n── 合成探针 · 移动视口 ${vp.w}×${vp.h} @${vp.dpr}x（≤860px 规则在此激活） ──`);

// ① #side.collapsed：开关不被容器裁掉（§5.3 / §8-B）。
//    用 effectiveHit ——「视觉高 44 但被容器裁到 34」这种，只有逐像素命中才看得出来。
reportGroup('side.collapsed', mobile.toggle, (m) => m.hit >= 44,
  '#side.collapsed 的 #panel-toggle 有效命中高 ≥ 44px（不被 34px 容器裁掉）');

// ② .btn.tiny 的移动口径尺寸（792 宽 × 1000 高量；宽≤860 目前无覆盖，量上防将来加移动规则）。
const mt = mobileTall.viewport;
console.log(`\n── 合成探针 · 移动口径 .btn.tiny（${mt.w} 宽 × ${mt.h} 高） ──`);
reportGroup('m.spellbook', mobileTall.groups.spellbook, (m) => m.h >= 44, '移动 · .spellbook .btn.tiny 视觉高 ≥ 44px');
reportGroup('m.rrow .tap', mobileTall.groups.rrowTap, (m) => m.hit >= 43, '移动 · .btn.tiny.tap 有效命中高 ≥ 43px');
reportGroup('m.hp-tbtns', mobileTall.groups.hpTbtns, (m) => m.h >= 40, '移动 · 密集区 .hp-tbtns 视觉高 ≥ 40px');
reportGroup('m.hp-nav', mobileTall.groups.hpNav, (m) => m.h >= 40, '移动 · 密集区 .hp-nav 视觉高 ≥ 40px');
reportGroup('m.魔法书 .tap', mobileTall.groups.magicTap, (m) => m.hit >= 43, '移动 · 孤立 .btn.tiny.tap 有效命中高 ≥ 43px');

/* ---- 真实 app：顶栏 C4/C3/换行 + 拇指带 —— 「已知待办」级（STRICT=1 才卡） ---- */
const T = (ok) => (ok ? 'PASS' : STRICT ? 'FAIL' : '信息');
const bump = (ok) => {
  if (!ok && STRICT) bad++;
};
console.log('\n── 真实 app（index.html?devquick=1）· 顶栏 / 拇指带 ──');

const tb0 = appTopbar[0];
const c4ok = appTopbar.every((s) => s.clickable === 0);
const peOk = appTopbar.every((s) => s.pe === 'none');
const c3ok = appTopbar.every((s) => s.topbarOverflow <= 0 && s.docOverflow <= 0);
const wrapOk = appTopbar.every((s) => s.taller.length === 0);
bump(c4ok);
bump(peOk);
bump(c3ok);
bump(wrapOk);

console.log(`[${T(c4ok)}] C4 顶栏可点元素 = ${tb0.clickable} 个（应为 0 —— R7 顶栏只读）`);
console.log(`[${T(peOk)}] 顶栏 pointer-events = ${tb0.pe}（应为 none —— 只读展示层）`);
console.log('── C3 多宽度扫描（720/792/860；横向溢出应为 0） ──');
for (const s of appTopbar) {
  const o = s.topbarOverflow <= 0 && s.docOverflow <= 0;
  const wrapNote = s.taller.length ? ` · 换行：${s.taller.join(', ')}` : '';
  console.log(
    `[${T(o)}] ${s.w}px → 顶栏溢出 ${s.topbarOverflow}px · document ${s.docOverflow}px · 最高子项 ${s.maxChildH}px / 条 ${s.barH}px${wrapNote}`,
  );
}
console.log(`[${T(wrapOk)}] 换行（任一宽度下子项高 ≤ 条高）`);

const thOk = !!appThumb && appThumb.barH <= 48.5;
const thOv = !!appThumb && appThumb.overflow <= 0 && appThumb.docOverflow <= 0;
const thHit = !!appThumb && appThumb.minBtnH >= 44;
const thMain = !!appThumb && appThumb.minPrimaryH >= 44;
bump(thOk);
bump(thOv);
bump(thHit);
bump(thMain);
console.log('── 拇指带（≤48px，全部可交互；纯文字标签） ──');
if (!appThumb) {
  console.log('[信息] 没量到 #thumb（app 阶段失败？）');
} else {
  console.log(`[${T(thOk)}] 拇指带高 ${appThumb.barH}px ≤ 48`);
  console.log(`[${T(thOv)}] 拇指带横向溢出 ${appThumb.overflow}px = 0`);
  console.log(`[${T(thHit)}] 拇指带按钮最低视觉高 ${appThumb.minBtnH}px ≥ 44`);
  console.log(`[${T(thMain)}] 主操作「结束一天」视觉高 ${appThumb.minPrimaryH}px ≥ 44`);
  console.log(
    `        共 ${appThumb.count} 个按钮：${appThumb.btns.map((b) => `${b.t || '?'}(${Math.round(b.w)}×${Math.round(b.h)}${b.primary ? '*' : ''})`).join(' · ')}`,
  );
}

/* ---- ④（F-3.6 / IA §15.4）· 日志入口搬家 + 角标随迁 —— **始终硬断言**（已落地） ---- */
console.log('\n── 真实 app（?devquick=1）· ④ 日志入口搬家（F-3.6 / §15.4） ──');
if (!appMenu || appMenu.error) {
  console.log(`[FAIL] 没能读到菜单：${appMenu?.error ?? '未测到'}`);
  bad++;
} else {
  const noLogThumb = appMenu.thumbHasLog === false;
  const logInMenu = appMenu.items.includes('事件日志');
  const badgeMoved = appMenu.badgeOnMenu === true;
  const ariaOk = appMenu.menuAria.startsWith('菜单');
  // 菜单「不膨胀」守卫：断言的是**规格上限**，不是随便一个当时读数。
  // 写死 `=== 6` 是「固化读数」（菜单加一项就红，很快被当噪声关掉 = 没守卫）；
  // 但上限**必须等于 §7 的值** —— 容忍到 7 就等于「别人加第 7 项时放行」，守不住「不膨胀」。
  // ⇒ 判据 = §7 现行上限 **6**（design/ux/in-game-ia.md §7：一级 ≤ 6）。§7 改 ⇒ 只改这一处常量。
  const MENU_MAX = 6;
  const countOk = typeof appMenu.count === 'number' && appMenu.count <= MENU_MAX;
  for (const ok of [noLogThumb, logInMenu, badgeMoved, ariaOk, countOk]) if (!ok) bad++;
  console.log(
    `[${noLogThumb ? 'PASS' : 'FAIL'}] 拇指带已无「日志」入口（实测拇指带：${appMenu.thumbLabels.join(' / ')}）`,
  );
  console.log(`[${logInMenu ? 'PASS' : 'FAIL'}] 菜单一级项含「事件日志」（复用 openLogPanel，函数不变）`);
  console.log(`[${badgeMoved ? 'PASS' : 'FAIL'}] 未读角标已迁到「菜单」按钮（.tb-badge 在 menuBtn 内）`);
  console.log(
    `[${ariaOk ? 'PASS' : 'FAIL'}] 「菜单」按钮 aria-label 以「菜单」起（实测「${appMenu.menuAria}」，a11y §4.3 数字不得为唯一语义）`,
  );
  console.log(
    `[${countOk ? 'PASS' : 'FAIL'}] 菜单一级项 ${appMenu.count} 项 ≤ ${MENU_MAX}（§7 上限=6；守卫『不膨胀』而非当时读数）：${appMenu.items.join(' / ')}`,
  );
}

/* ---- 城镇面板内容窗（D-66 / D-68）—— **始终硬断言**：P3 核心表面，回归过一次 ---- */
console.log('\n── 真实 app（?devquick=1&devtown=1）· 城镇面板内容窗（792×320） ──');
if (!townPanel || townPanel.error) {
  console.log(`[FAIL] 没能打开城镇面板：${townPanel?.error ?? '未测到'}`);
  bad++;
} else {
  const paneOk = townPanel.paneClientH >= 120;
  const bt = townPanel.tabs.build;
  const buildOk = (bt?.cardsFull ?? 0) >= 4;
  const tabOk = (t) => (t?.cardsFull ?? 0) + (t?.rowsFull ?? 0) >= 1;
  const dwellOk = tabOk(townPanel.tabs.dwell);
  const recruitOk = tabOk(townPanel.tabs.recruit);
  const armyOk = tabOk(townPanel.tabs.army);
  const marketOk = tabOk(townPanel.tabs.market);
  for (const ok of [paneOk, buildOk, dwellOk, recruitOk, armyOk, marketOk]) if (!ok) bad++;
  console.log(
    `[${paneOk ? 'PASS' : 'FAIL'}] 内容窗 .town-pane clientHeight ${townPanel.paneClientH}px ≥ 120（modal ${townPanel.modalH} · head ${townPanel.headH} · 视口 ${townPanel.vp.w}×${townPanel.vp.h}）`,
  );
  const screens = bt ? (bt.paneScrollH / Math.max(1, bt.paneClientH)).toFixed(1) : '?';
  console.log(
    `[${buildOk ? 'PASS' : 'FAIL'}] 建筑页完整可见 .bcard ${bt?.cardsFull ?? 0}/${bt?.cardsTotal ?? 0} 张 ≥ 4（首卡 ${bt?.firstCardH ?? '?'}px · 需滚 ${screens} 屏）`,
  );
  for (const k of ['dwell', 'recruit', 'army', 'market']) {
    const t = townPanel.tabs[k];
    const full = (t?.cardsFull ?? 0) + (t?.rowsFull ?? 0);
    console.log(
      `[${full >= 1 ? 'PASS' : 'FAIL'}] ${t?.label ?? k} 完整可见行块 ${full} ≥ 1（卡 ${t?.cardsTotal ?? 0} · 行 ${t?.rowsTotal ?? 0}${t?.error ? ' · ' + t.error : ''}）`,
    );
  }
  const d70 = townPanel.d70;
  const d70ok = !!d70 && d70.descH > 0 && d70.descInPane && d70.beforeCards >= 4 && d70.afterCards >= 4;
  if (!d70ok) bad++;
  console.log(
    `[${d70ok ? 'PASS' : 'FAIL'}] D-70 点建筑名 → 描述浮层：高 ${d70?.descH ?? 0}px · 在 pane 内 ${d70?.descInPane ?? '?'} · 完整可见卡 前 ${d70?.beforeCards ?? '?'} / 后 ${d70?.afterCards ?? '?'}（均需 ≥4）`,
  );
  if (townPanel.debug) console.log(`[信息] modal computed: ${JSON.stringify(townPanel.debug)}`);
}

/* ---- a11y 可机检项（基线 §5）—— **始终硬断言**（不是"已知待办"） ---- */
console.log('── a11y 可机检项（accessibility-requirements.md §5） ──');
const fvOk = !!a11y && a11y.focusVisible.found && a11y.focusVisible.width >= 2;
const rmOk = !!a11y && a11y.reducedMotion && a11y.reducedWorks;
const lblOk = !!a11y && a11y.labels.topbarItems > 0 && a11y.labels.topbarNamed === a11y.labels.topbarItems;
const tagOk = !!a11y && a11y.labels.thumbBtns > 0 && a11y.labels.thumbWithText === a11y.labels.thumbBtns;
for (const ok of [fvOk, rmOk, lblOk, tagOk]) if (!ok) bad++;
console.log(`[${fvOk ? 'PASS' : 'FAIL'}] :focus-visible 且 outline ≥2px（实测 ${a11y?.focusVisible.width ?? '?'}px）`);
console.log(
  `[${rmOk ? 'PASS' : 'FAIL'}] prefers-reduced-motion 生效（#hint transition ${a11y?.reducedBefore} → ${a11y?.reducedAfter}）`,
);
console.log(
  `[${lblOk ? 'PASS' : 'FAIL'}] 顶栏「图标+数字」可访问名 ${a11y?.labels.topbarNamed}/${a11y?.labels.topbarItems}`,
);
console.log(
  `[${tagOk ? 'PASS' : 'FAIL'}] 拇指带「标签即名称」 ${a11y?.labels.thumbWithText}/${a11y?.labels.thumbBtns}`,
);

if ((!c3ok || !c4ok || !wrapOk || !peOk || !thOk || !thOv || !thHit || !thMain) && !STRICT) {
  console.log('  ↑ 以上非 PASS 项均为**已知待办**（顶栏重构批 R7）；STRICT=1 升格为硬断言时应 RED。');
}

// 信息（非断言）：移动端 #side 宽度，仅记录（P2 已把底部抽屉改为右侧竖栏）。
console.log(`\n[信息] 合成探针 · 移动端 #side 宽度 ${mobile.debug.sideW}`);

console.log(bad === 0 ? '\n全部通过：触摸目标与顶栏/拇指带达标' : `\n${bad} 项不合格`);
process.exit(bad === 0 ? 0 : 1);
