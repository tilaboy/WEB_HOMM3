#!/usr/bin/env node
/**
 * hpbudget.mjs —— 英雄栏「信息预算」量尺（`#156` D-1 的验收门，`engineering-lead` 自备）。
 *
 * ## 为什么另立一把尺（不复用 `iaaccept.mjs` / `scenarioaudit.mjs`）
 * 这两把量的都是 **`.hp-teach` 一个块**（`#137` 教学线）。`#156` 要守的对象是
 * **「英雄栏在真机视口里放不放得下」** —— 不是"某个块有没有溢出"，也不是"某个类名还在不在"。
 * ★ 尤其：**不许用 `grep 类名` 当验收** —— `hp-factions` 按 D-1 **不删、进分段**
 * ⇒ 任何"类名命中 = 0"的判据**在 D-1 下落不了地**（只能红不能绿 = 墙不是门）。
 * 本尺量的是**量本身**：`sideBody` 的直接子元素高之和 vs 可用高，以及 `#side` 有没有纵向滚动。
 *
 * ## 被测对象（逐字来自 `design/ux/in-game-ia.md §3.3` 的验收行）
 * 「**常驻态与每个分段都 ≤240 且无纵向滚动**（同一把尺：`sideBody` 直接子元素高）」
 * ⇒ 本探针**逐状态**量 `sideBody` 的直接子元素高之和（`contentH`）与可用高（`availH`），
 *   并断言 **`#side` 无纵向滚动**（`scrollHeight ≤ clientHeight`）。
 *   `availH` 由实测推得（`#side.clientHeight` − `sideBody` 相对 `#side` 的顶部偏移 − 底部内边距），
 *   **不写死 240** —— 240 是规格给的靶，**靶与实测并列打印**，对不上就看得见。
 *
 * ## 门必须双向可证
 * 今日（**削减前**）预期 **RED（exit 1）** —— 这就是"削减前"那个数。
 * 实现 D-1 后应转 **GREEN（exit 0）**。**一把只能红或只能绿的尺都不是尺。**
 *
 * ## 构建前置（防"拿早于被测对象的构建跑出假罪状"）
 * 按「文件 + 标志」断言被测构建里**真的有英雄栏**（零打包器 ⇒ 标志在 `ui/HeroPanel.js`，
 * **不在 `main.js`**）；缺即 `exit(2)`。见 `iaaccept.mjs` 记的那次假罪状。
 *
 * ## 用法
 *   node tools/hpbudget.mjs                       # 量 ./dist（自起服务，空闲端口）
 *   node tools/hpbudget.mjs --dist=/tmp/dist-xxx  # 量隔离构建（**服务的就是它**，不碰共用 dist）
 *
 * 退出码：0 = 常驻态与每个分段都放得下（且无纵向滚动）
 *         1 = 有状态放不下（**今日 = 削减前基线**）
 *         2 = 前置不满足（无 Chrome / 构建不含英雄栏）
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { distDir, printHeader, requireFile, freePort, serveInProcess } from './_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from './_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=hpbudget');

/* ---------------------------------------------------------------- 构建前置 */
/** 英雄栏的标志串（零打包器 ⇒ 在 `ui/HeroPanel.js` 里，不在 `main.js`）。 */
const CAND = path.join(DIST, 'ui', 'HeroPanel.js');
requireFile(DIST, 'ui/HeroPanel.js');
const heroSrc = readFileSync(CAND, 'utf8');
const MISSING = ['hp-head', 'hp-bars', 'hp-army'].filter((m) => !heroSrc.includes(m));
if (MISSING.length) {
  console.error(`✗ 构建不含英雄栏：ui/HeroPanel.js 缺 ${MISSING.join(' · ')} ⇒ 读数作废。先 npm run build。`);
  process.exit(2);
}

if (!chromeAvailable()) {
  console.error('✗ 前置不满足：找不到 Chrome（可用 env CHROME 覆盖）。');
  process.exit(2);
}

/* ---------------------------------------------------------------- 自起服务 */
const PORT = await freePort();
const ready = await serveInProcess(DIST, PORT);
if (!ready) {
  console.error(`✗ 前置不满足：自起 dev server 未就绪（port ${PORT}）。`);
  process.exit(2);
}
const URL0 = `http://127.0.0.1:${PORT}/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
let undone = 0;
const PASS = (c, m) => { if (!c) bad++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`); };
const UNDECIDED = (m) => { undone++; console.log(`[未判] ${m}`); };

/** 量一个状态：`sideBody` 直接子元素高之和 vs 可用高 + `#side` 是否滚。 */
const MEASURE = `(() => {
  const side = document.querySelector('#side');
  if (!side) return { ok: false, reason: '找不到 #side' };
  const toggle = document.querySelector('#panel-toggle');
  const body = [...side.children].find((c) => c !== toggle) || null;
  if (!body) return { ok: false, reason: '找不到 sideBody（#side 的第一个非 toggle 子元素）' };
  const sr = side.getBoundingClientRect();
  const br = body.getBoundingClientRect();
  const cs = getComputedStyle(side);
  const padTop = parseFloat(cs.paddingTop) || 0;
  const padBottom = parseFloat(cs.paddingBottom) || 0;
  const sections = [...body.children].map((c) => ({
    cls: String(c.className || c.tagName),
    h: Math.round(c.getBoundingClientRect().height),
    hidden: c.offsetParent === null || getComputedStyle(c).display === 'none',
  }));
  const sumChildren = sections.filter((s) => !s.hidden).reduce((n, s) => n + s.h, 0);
  /* ★ 口径与 §3.3 的实测逐字对齐：**可用高 = #side.clientHeight**（= 240）、
   *   **内容高 = #side.scrollHeight**（= 660）—— 本探针首跑即复现这两个数。
   *   sumChildren 另报（"同一把尺：sideBody 直接子元素高"那一路），差额 = 间距/边框。 */
  return {
    ok: true,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    sideClient: Math.round(side.clientHeight),
    sideScroll: Math.round(side.scrollHeight),
    scrolls: side.scrollHeight > side.clientHeight + 1,
    contentH: Math.round(side.scrollHeight),
    availH: Math.round(side.clientHeight),
    sumChildren,
    target240: 240,
    sections,
    tabs: [...document.querySelectorAll('#side [role="tab"], #side .hp-seg-item, #side .hp-tab')]
      .map((t) => (t.textContent || '').trim()).filter(Boolean),
    collapsed: side.classList.contains('collapsed'),
  };
})()`;

function report(label, m) {
  if (!m || !m.ok) { PASS(false, `${label}：量不到（${m ? m.reason : 'null'}）`); return null; }
  const secs = m.sections.filter((s) => !s.hidden).map((s) => `${String(s.cls).replace(/^sec /, '')}=${s.h}`).join(' · ');
  console.log(`  ${label}: 内容高=${m.contentH} · 可用高=${m.availH}（靶 ${m.target240}；子元素和=${m.sumChildren}）· #side ${m.sideClient}/${m.sideScroll}${m.scrolls ? ' ⟵滚' : ''}${m.collapsed ? ' · 收起态' : ''}`);
  console.log(`         分段: ${secs || '(无)'}`);
  PASS(!m.scrolls, `${label} #side 无纵向滚动（scroll ${m.sideScroll} ≤ client ${m.sideClient}）`);
  PASS(m.contentH <= m.target240, `${label} 内容高 ${m.contentH} ≤ ${m.target240}（§3.3 验收行）`);
  return m;
}

try {
  await withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Emulation.setDeviceMetricsOverride', { width: 792, height: 320, deviceScaleFactor: 3, mobile: true });

    const boot = async () => {
      await send('Page.navigate', { url: URL0 });
      for (let i = 0; i < 50; i++) {
        await sleep(150);
        try {
          if (await evaluate(`document.readyState === 'complete' && !!document.querySelector('#start-screen')`)) return;
        } catch { /* 导航中：重试 */ }
      }
      await sleep(1200);
    };
    const clickText = (sel, text) =>
      evaluate(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => (b.textContent || '').includes(${JSON.stringify(text)}));
        if (!el) return 'NOT_FOUND';
        if (el.disabled) return 'DISABLED';
        el.click();
        return 'OK';
      })()`);

    await boot();
    /* 开教学场（英雄栏在任意场景都在；用教学场是为了与 §3.3 的实测口径一致）。 */
    await clickText('#start-screen .ss-seg-item', '教学场');
    await sleep(200);
    await clickText('#start-screen button', '开始新游戏');
    await sleep(1400);
    const opened = await clickText('#thumb button', '英雄');
    await sleep(700);
    console.log(`[开面板] 拇指带「英雄」= ${opened}`);

    /* ---- 常驻态 ---- */
    const base = await evaluate(MEASURE);
    const m0 = report('常驻态', base);
    if (m0 && m0.tabs.length) {
      /* ---- 逐分段：能点的都点一遍（实现 D-1 后自动覆盖） ---- */
      for (const name of m0.tabs) {
        await clickText('#side [role="tab"], #side .hp-seg-item, #side .hp-tab', name);
        await sleep(350);
        report(`分段「${name}」`, await evaluate(MEASURE));
      }
    } else {
      UNDECIDED('未发现分段控件（`.hp-tab`/`[role=tab]`/`.hp-seg-item`）⇒ 分段态**未判**（D-1 未实现）');
    }
    console.log(`[视口] ${JSON.stringify(m0 ? m0.viewport : null)}`);
  });
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  process.exit(e && e.prerequisite ? 2 : 1);
}

console.log('---------------------------------------------');
console.log(bad === 0 ? `[总结] 全 PASS（未判 ${undone}）` : `[总结] FAIL ${bad} 条（未判 ${undone}）`);
process.exit(bad === 0 ? 0 : 1);
