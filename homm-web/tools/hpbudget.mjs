#!/usr/bin/env node
/**
 * hpbudget.mjs —— 英雄栏「信息预算」量尺（`#156` 的验收门，`engineering-lead`）。
 *
 * ## 判据（team-lead 2026-09-21 11:13 最终版 —— 本文件照此实现，**已废旧口径**）
 *   ① **硬**：**任意段/任意场景，tab 条不得被滚出视野、也不得位移**
 *      （切到每个 tab 后，tab 条的 top 偏移须与默认态**逐位相同**，且整条在 `#side` 可视框内）。
 *   ② **硬（目标）**：**默认段下 `#side` 不滚**（＝"打开面板第一眼不用滚"）。
 *      ⚠️ **不要**把它写成 `sideBody.scrollHeight ≤ sideBody.clientHeight` —— `sideBody` **无高度约束**
 *      ⇒ 两值**恒等**（基线 578/578、当前 242/242）⇒ **恒真、永不失败**（"空集通过"家族）。
 *      本文件用 **`#side` 滚不滚** 作判据；`sideBody` 只当**参考列**（team-lead ⑤ 要报的那个数）。
 *   ③ **允许**：非默认段内容过长时**只许段内滚动**（溢出必须在 `hp-pane` 内 ⇒ `sideBody` 不得滚）。
 *   ④ **`240` = 参考量，不作判据**；量 **`sideBody`**（`scrollHeight ≤ clientHeight`），
 *      **不是 `#side`**（`#side` 含 ≈52px 的 `#panel-toggle` 行，会混进账）。
 *   ⑤ 报数：`#side` / `#panel-toggle` / `sideBody` 三高度 + 每段三数 + **同场景**削减前/后两个数。
 *
 * ### 旧口径（**已废，留痕**）
 *   ~~"常驻态与每个分段都 ≤240"~~ —— 那版把 `#side` 的 240 当成 `sideBody` 的可用高
 *   （`#panel-toggle` 行 + padding 没扣），且漏了 tab 条本身。team-lead 自认此漏并改判。
 *   ⇒ 本文件**不再断言 240**，只把它当**参考列**打印。
 *
 * ## 门必须双向可证
 *   · 改前（`b701e27` 之前 / 无分段控件）：必然 RED（`#side` 660 > 240，且无 tab 条）。
 *   · 改后：应转 GREEN。**在隔离构建上跑**（`--dist=`），**不要拿陈旧 `dist` 当判据**。
 *
 * ## 用法
 *   node tools/hpbudget.mjs --dist=/tmp/dist-xxx [--label=削减前|削减后]
 *
 * 退出码：0 = ①②③ 全过 · 1 = 有一条不过 · 2 = 前置不满足（无 Chrome / 构建不含英雄栏）
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { distDir, printHeader, requireFile, freePort, serveInProcess, argOf } from './_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from './_chrome.mjs';

const DIST = distDir();
const LABEL = argOf('label', '');
printHeader(DIST, `gate=hpbudget${LABEL ? ` · label=${LABEL}` : ''}`);

/* ---------------------------------------------------------------- 前置 */
requireFile(DIST, 'ui/HeroPanel.js');
const heroSrc = readFileSync(path.join(DIST, 'ui', 'HeroPanel.js'), 'utf8');
const MISSING = ['hp-head'].filter((m) => !heroSrc.includes(m));
if (MISSING.length) {
  console.error(`✗ 构建不含英雄栏：ui/HeroPanel.js 缺 ${MISSING.join(' · ')} ⇒ 读数作废。`);
  process.exit(2);
}
const HAS_SEG = heroSrc.includes('hp-tab');
console.log(`[前置] 本构建是否含分段控件（hp-tab）：${HAS_SEG ? '是' : '否 ⇒ 按"改前"形态量，①②必红'}`);
if (!chromeAvailable()) {
  console.error('✗ 前置不满足：找不到 Chrome（可用 env CHROME 覆盖）。');
  process.exit(2);
}

const PORT = await freePort();
if (!(await serveInProcess(DIST, PORT))) {
  console.error(`✗ 前置不满足：自起 dev server 未就绪（port ${PORT}）。`);
  process.exit(2);
}
const URL0 = `http://127.0.0.1:${PORT}/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const PASS = (c, m) => { if (!c) bad++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`); };

/** 量一个状态。**以 `sideBody` 为主体**（不是 `#side`）。 */
const MEASURE = `(() => {
  const side = document.querySelector('#side');
  if (!side) return { ok: false, reason: '找不到 #side' };
  const toggle = document.querySelector('#panel-toggle');
  const body = [...side.children].find((c) => c !== toggle) || null;
  if (!body) return { ok: false, reason: '找不到 sideBody（#side 的第一个非 toggle 子元素）' };
  const sr = side.getBoundingClientRect();
  const br = body.getBoundingClientRect();
  const tabs = document.querySelector('#side .hp-tabs');
  const pane = document.querySelector('#side .hp-pane');
  const tr = tabs ? tabs.getBoundingClientRect() : null;
  const round = (n) => Math.round(n);
  const sections = [...body.children].map((c) => ({
    cls: String(c.className || c.tagName),
    h: round(c.getBoundingClientRect().height),
    hidden: c.offsetParent === null || getComputedStyle(c).display === 'none',
  }));
  const paneSections = pane
    ? [...pane.children].map((c) => ({ cls: String(c.className || c.tagName), h: round(c.getBoundingClientRect().height) }))
    : [];
  return {
    ok: true,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    sideClient: round(side.clientHeight),
    sideScroll: round(side.scrollHeight),
    /* ★ 真正的判据量：**side 到底滚不滚**。
     *   ⚠️ 不要用 sideBody.scrollHeight <= sideBody.clientHeight —— sideBody **无高度约束**
     *   ⇒ clientHeight **恒等于** scrollHeight（基线 578/578、当前 242/242）
     *   ⇒ 那条式子**恒真、永不失败**（"空集通过"家族）⇒ **它当不了判据**，只作参考列。
     *   ⚠️ 本文件是反引号模板：这段注释里**不得出现反引号**（会提前闭合模板 ⇒ SyntaxError）。 */
    sideScrolls: side.scrollHeight > side.clientHeight + 1,
    toggleH: toggle ? round(toggle.getBoundingClientRect().height) : 0,
    bodyClient: round(body.clientHeight),
    bodyScroll: round(body.scrollHeight),
    /* ★ ① 的判据量：tab 条相对 sideBody 顶的偏移 + 是否整条在 #side 可视框内 */
    tabsTopRel: tr ? round(tr.top - br.top) : null,
    tabsInView: tr ? (tr.top >= sr.top - 0.5 && tr.bottom <= sr.bottom + 0.5) : null,
    tabsH: tr ? round(tr.height) : null,
    paneClient: pane ? round(pane.clientHeight) : null,
    paneScroll: pane ? round(pane.scrollHeight) : null,
    paneScrolls: pane ? pane.scrollHeight > pane.clientHeight + 1 : null,
    activeTab: (() => {
      const on = document.querySelector('#side .hp-tab.on, #side .hp-tab[aria-checked="true"]');
      return on ? (on.textContent || '').trim() : null;
    })(),
    sections, paneSections,
  };
})()`;

function row(label, m) {
  if (!m || !m.ok) { console.log(`  ${label}: 量不到（${m ? m.reason : 'null'}）`); return; }
  const fmt = (arr) => arr.map((s) => `${String(s.cls).replace(/^sec /, '')}=${s.h}`).join(' · ');
  console.log(
    `  ${label} [${m.activeTab ?? '?'}] #side ${m.sideClient}/${m.sideScroll}${m.sideScrolls ? ' ⟵滚' : ''}` +
      ` · sideBody ${m.bodyClient}/${m.bodyScroll}(参考) · pane ${m.paneClient ?? '-'}/${m.paneScroll ?? '-'}${m.paneScrolls ? ' ⟵段内滚' : ''}` +
      ` · tabsTop=${m.tabsTopRel} tabsH=${m.tabsH}${m.tabsInView ? '' : ' ⟵出框'}`,
  );
  console.log(`      sideBody 子: ${fmt(m.sections) || '(无)'}`);
  if (m.paneSections.length) console.log(`      pane 子:     ${fmt(m.paneSections)}`);
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
        } catch { /* 导航中 */ }
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
    await clickText('#start-screen .ss-seg-item', '教学场');
    await sleep(200);
    await clickText('#start-screen button', '开始新游戏');
    await sleep(1500);
    const opened = await clickText('#thumb button', '英雄');
    await sleep(800);
    console.log(`[开面板] 拇指带「英雄」= ${opened}`);

    const base = await evaluate(MEASURE);
    if (!base || !base.ok) { PASS(false, `量不到面板：${base ? base.reason : 'null'}`); return; }

    console.log(`[三高度] #side client=${base.sideClient} scroll=${base.sideScroll}（**削减前/后同场景的总数**） · #panel-toggle=${base.toggleH} · sideBody client=${base.bodyClient} scroll=${base.bodyScroll}`);
    console.log(`[视口] ${JSON.stringify(base.viewport)} · 参考靶 240（**不作判据**）`);
    row('默认段', base);

    /* ---- ① 硬：tab 条不得出框、不得位移 ---- */
    if (!HAS_SEG) {
      PASS(false, '① tab 条不存在 ⇒ 硬判据不成立（本构建＝改前形态）');
    }
    PASS(base.tabsInView === true, `① 默认段：tab 条整条在 #side 可视框内（tabsTop=${base.tabsTopRel}）`);

    /* ---- ② 硬（目标）：默认段下**面板不滚** ---- */
    PASS(!base.sideScrolls, `② 默认段：#side 不滚（${base.sideScroll} ≤ ${base.sideClient}）—— "打开面板第一眼不用滚"`);

    /* ---- 逐段：切 tab、复量（① 每段都要成立；③ 非默认段只许段内滚） ---- */
    const tabs = await evaluate(`[...document.querySelectorAll('#side .hp-tab')].map((t) => (t.textContent || '').trim())`);
    if (!tabs || !tabs.length) {
      console.log('  （本构建无 tab ⇒ 无法逐段）');
    } else {
      for (const t of tabs) {
        await clickText('#side .hp-tab', t);
        await sleep(500);
        const m = await evaluate(MEASURE);
        row(`段「${t}」`, m);
        if (!m || !m.ok) { PASS(false, `段「${t}」量不到`); continue; }
        PASS(m.tabsInView === true, `① 段「${t}」：tab 条仍在框内`);
        PASS(m.tabsTopRel === base.tabsTopRel, `① 段「${t}」：tab 条未位移（${m.tabsTopRel} == 默认 ${base.tabsTopRel}）`);
        /* ③ 非默认段只许段内滚动：溢出只能落在 pane 里，`#side` 不得滚 */
        PASS(!m.sideScrolls, `③ 段「${t}」：#side 不滚、溢出只在段内（${m.sideScroll} ≤ ${m.sideClient}${m.paneScrolls ? '；段内滚 ✓' : ''}）`);
      }
    }
  });
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  process.exit(e && e.prerequisite ? 2 : 1);
}

console.log('---------------------------------------------');
console.log(bad === 0 ? '[总结] ①②③ 全过' : `[总结] FAIL ${bad} 条`);
process.exit(bad === 0 ? 0 : 1);
