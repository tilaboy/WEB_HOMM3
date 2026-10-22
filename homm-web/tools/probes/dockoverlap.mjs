#!/usr/bin/env node
/**
 * dockoverlap.mjs —— 探索态右下**半圆浮动盘**的几何机检（`npm run probe:dockoverlap`）。
 *
 * ## 它守什么（2026-10-21 主理人：「一个 half transparent 的 float window，好比一个圆形的
 * 或者半圆弧的，上面半可以摁的」）
 * `#thumb` 从 48px 通栏改成 `position:absolute` 的 240×124 半圆，4 个按钮 `position:absolute`
 * 各自摆位。**这四个盒子是人手算的坐标，不是布局引擎排的** —— 一改尺寸/字号就会咬在一起。
 *
 * 首版实测就咬了：菜单∩英雄 = 20×6px、城∩结束一天 = 24×8px。重叠区点下去落到谁身上
 * 由 DOM 顺序（后者覆盖前者）决定 ⇒ **想点「菜单」却打开了英雄栏**。
 * 这类错 `audit:touch` 抓不到：它量的是**中心距 vs 尺寸**，两个盒子叠一角时中心距仍然够。
 *
 * ## 判据（五条，都是几何真值，不看样式字符串）
 *   ① 盘在、且恰好 4 个 `.tb-btn`（结构前提，没有就无从量）；
 *   ② 每个按钮**命中高 ≥ 44px**（§5.2；`height` 写了也可能被 `min-height` 覆盖，故量 rect）；
 *   ③ **两两矩形零重叠**（重叠面积必须 = 0）；
 *   ④ 每个按钮**完整落在 `#thumb` 的盒子里**（坐标是相对盘的 `left/top`，算错就跑到盘外）；
 *   ⑤ **右缘无 48px 竖条**（2026-10-22 主理人：「右面那条竖条修掉吧」）——
 *      `#side` 收起态盒宽 = 0，且 `#panel-toggle` 不在 DOM（「英雄」入口只在盘里）。
 *
 * ## 负向对照（每次都验，别偷懒）
 *   把 `style.css` 的四组 `left/top` 改回首版（20/74 · 52/36 · 132/36 · 152/72）⇒ ③ 必红
 *   （两组各咬 20×6 / 24×8）；改回现位 ⇒ 全绿。
 *   ⑤ 的负向对照：把 `#side.collapsed` 改回 `width:48px`（不 display:none）⇒ ⑤ 必红。
 *
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足
 */
import path from 'node:path';
import { distDir, printHeader, requireFile, freePort, serveInProcess } from '../_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from '../_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=dockoverlap');
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
/* 与 `bandflip` 同一条基线 URL：真机尺寸、已揭开、不吃迷雾 */
const BASE =
  `http://127.0.0.1:${PORT}/?devquick=0&devsize=medium&devseed=20260917&devreveal=1&devlight=0.22`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const PASS = (c, m) => { if (!c) bad++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`); };

/** 读盘与 4 个按钮的矩形 + 两两重叠面积。 */
const MEASURE = `(() => {
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const dock = document.querySelector('#thumb');
  if (!dock) return { ok: false, reason: '找不到 #thumb' };
  const d = R(dock);
  const btns = [...dock.querySelectorAll('.tb-btn')].map((e) => ({
    t: (e.textContent || '').trim(),
    ...R(e),
  }));
  const overlaps = [];
  for (let i = 0; i < btns.length; i++) {
    for (let j = i + 1; j < btns.length; j++) {
      const a = btns[i], b = btns[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 0 && oy > 0) overlaps.push({ a: a.t, b: b.t, ox: Math.round(ox * 10) / 10, oy: Math.round(oy * 10) / 10 });
    }
  }
  const outside = btns.filter((b) =>
    b.x < d.x - 0.5 || b.y < d.y - 0.5 || b.x + b.w > d.x + d.w + 0.5 || b.y + b.h > d.y + d.h + 0.5,
  ).map((b) => b.t);
  /* ⑤ 右缘竖条：收起态 #side 必须不占宽；#panel-toggle 整个不该在 DOM 里。 */
  const side = document.querySelector('#side');
  const sr = side ? side.getBoundingClientRect() : null;
  const rail = {
    sideW: sr ? sr.width : null,
    sideDisplay: side ? getComputedStyle(side).display : 'MISSING',
    toggle: !!document.querySelector('#panel-toggle'),
  };
  return { ok: true, dock: d, btns, overlaps, outside, rail };
})()`;

try {
  await withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Emulation.setDeviceMetricsOverride', { width: 792, height: 360, deviceScaleFactor: 3, mobile: true });
    await send('Page.navigate', { url: BASE });
    let m = null;
    for (let i = 0; i < 60; i++) {
      await sleep(150);
      try {
        m = await evaluate(MEASURE);
        if (m && m.ok && m.btns.length === 4) break;
      } catch { /* 导航中 */ }
    }
    if (!m || !m.ok) {
      PASS(false, `量不到浮动盘：${m ? m.reason : 'null'}`);
      return;
    }
    console.log(
      `[盘] ${Math.round(m.dock.w)}×${Math.round(m.dock.h)} @ (${Math.round(m.dock.x)},${Math.round(m.dock.y)}) · ` +
        m.btns.map((b) => `${b.t}[${Math.round(b.x - m.dock.x)},${Math.round(b.y - m.dock.y)} ${Math.round(b.w)}×${Math.round(b.h)}]`).join(' '),
    );

    PASS(m.btns.length === 4, `① 盘里恰好 4 个按钮（${m.btns.length}）`);

    const short = m.btns.filter((b) => b.h < 43.5).map((b) => `${b.t} ${Math.round(b.h)}px`);
    PASS(short.length === 0, `② 每个按钮命中高 ≥ 44px（${short.length ? `不足：${short.join('、')}` : '全部达标'}）`);

    PASS(
      m.overlaps.length === 0,
      `③ 两两矩形零重叠（${m.overlaps.length === 0 ? '0 处' : m.overlaps.map((o) => `${o.a}∩${o.b} ${o.ox}×${o.oy}px`).join('、')}）`,
    );

    PASS(m.outside.length === 0, `④ 按钮不出盘（${m.outside.length ? `出界：${m.outside.join('、')}` : '全部在盘内'}）`);

    const r = m.rail || {};
    PASS(
      r.sideW === 0 && r.toggle === false,
      `⑤ 右缘无 48px 竖条（收起态 #side 宽=${r.sideW}px · display=${r.sideDisplay} · #panel-toggle 在 DOM=${r.toggle}）`,
    );
  });
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  process.exit(e && e.prerequisite ? 2 : 1);
}

console.log('---------------------------------------------');
console.log(bad === 0 ? '[总结] 全过' : `[总结] FAIL ${bad} 条`);
process.exit(bad === 0 ? 0 : 1);
