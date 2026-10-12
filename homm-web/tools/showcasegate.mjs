#!/usr/bin/env node
/**
 * showcasegate.mjs —— **展示图（grims-showcase）可玩性门**（Day 3 · 可玩性腿）。
 *
 * ## 为什么要有这把尺
 *
 * 用户原话 F-3.7「可玩性也没有什么提升」/ F-3.2 / F-3.5 / F-3.6 / G-13 都是**感受**，
 * 感受不能直接验收。本门把其中三条翻成**可在真 Chrome / 真机视口上读出来的数**：
 *
 *   ① **点击次数**（进图路径要几下）—— 一条路径，数得清；
 *   ② **开局页滚动比**（`scrollHeight / clientHeight`）—— G-13 实测 3.4 屏是这门要压的对象；
 *   ③ **常驻文字条**（屏上常驻、以文字承载信息、非按钮、非瞬时、非 modal 的条）——
 *      F-3.2 / F-3.5 / F-3.6 要减的那个东西。
 *
 * 三条都在**同一趟真 Chrome** 里读，读的是**同一份 dist**（`serveInProcess` 指向 `--dist`）。
 *
 * ## 三条判据（正向）
 *   A. **一键进图**：开始页上存在「试这张图」入口，**1 次点击**即进图，且进的是
 *      `grims-showcase`（以屏上出现 `#objectives` 目标清单为准）。
 *      ⚠️ 入口不存在时本门**降级**走旧路径（点场景卡 + 点「开始新游戏」）并把点击数
 *      如实记成 2 —— **这是"before"的读数来源**，不是"放过"。
 *   B. **开局页不滚**：`#start-screen.scrollHeight / clientHeight ≤ 1.10`。
 *   C. **常驻文字条**：进图后，撤离的常驻条（顶部日志条 / 底部移动力条）**必须为 0**，
 *      且顶部**只剩一条**目标清单（`#objectives`，≤3 条）。
 *
 * ## ★ 可证伪负测（`NEG=1`）—— 「门必须双向可证：能红也能绿」
 *   正向跑一次全绿**证明不了门能红**（可能是恒绿：选择器写错、永远 0 命中）。
 *   ⇒ `NEG=1` 只跑「故意弄坏」的三组，断言**都变红**：
 *     · **N1**：往顶栏塞回一条常驻日志条（`[data-neg-bar]`）⇒ C 的"撤离条 = 0"必须**翻红**；
 *     · **N2**：往底部塞回一条常驻移动力条 ⇒ C 同上必须**翻红**；
 *     · **N3**：往 `#start-screen` 塞一个 1200px 高的撑块 ⇒ B 的滚动比必须**> 1.10**（翻红）。
 *   `NEG-PASS` = 该判据**确实会红**；`NEG-FAIL` = 它是**恒绿**（门坏了，必须修）。
 *   负测**不进验收数**（与正向套件互斥：`NEG=1` 时不跑正向）。
 *
 * ## 用法
 *   npm run build
 *   node tools/showcasegate.mjs                      # 正向（自起服务，量 <repo>/dist）
 *   node tools/showcasegate.mjs --dist=/tmp/dist-x   # 量隔离构建
 *   NEG=1 node tools/showcasegate.mjs                # 负测（断言三条判据都能红）
 *   DUMP=1 node tools/showcasegate.mjs               # 只把屏上可见文字元素全打出来（取证用，不判过否）
 *   SHOT_W/SHOT_H/SHOT_DPR=…                         # 覆盖视口（默认 792×360@3）
 *
 * 退出码：0 全过 / 1 有 FAIL / 2 前置不满足（无 Chrome / 构建不含开始页 / 服务没起）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { distDir, distUrl, printHeader, requireFile, freePort, serveInProcess } from './_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from './_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=showcasegate');

const W = Number(process.env.SHOT_W ?? 792);
const H = Number(process.env.SHOT_H ?? 360);
const DPR = Number(process.env.SHOT_DPR ?? 3);
const NEG = process.env.NEG === '1';
const DUMP = process.env.DUMP === '1';
/**
 * `SHOT=<路径>`：顺手抓一张**开始页（已选「破碎罗盘」、难度行可点）**的截图。
 * 为什么要长在本门里：开始页那张"难度行现在可以点了"的状态**必须先点一下场景卡**才存在，
 * `deviceshot` / `chromeshot` 只做导航、不点击 ⇒ 抓不到这个状态。
 */
const SHOT = process.env.SHOT ?? null;

requireFile(DIST, 'ui/StartScreen.js');
if (!readFileSync(path.join(DIST, 'ui', 'StartScreen.js'), 'utf8').includes('start-screen')) {
  console.error('✗ 前置不满足：构建的 ui/StartScreen.js 不含 `start-screen` ⇒ 不含开始页，读数无意义。');
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
const URL0 = `http://127.0.0.1:${PORT}/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
let negBad = 0;
const PASS = (c, m) => { if (!c) bad++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`); };
const NEGPASS = (c, m) => { if (!c) negBad++; console.log(`[${c ? 'NEG-PASS' : 'NEG-FAIL'}] ${m}`); };

/* ------------------------------------------------------------------ 页面内探针 */

/**
 * 常驻文字条的槽位表。**逐个具名、逐个报可见与否** —— 不是一个"总数"了事，
 * 因为"总数 = 0"在槽位名写错时会静默变 0（空集假绿）。
 * 每个槽位同时回报 `text`（条上的可见文字），供人工核对**量到的就是那条**。
 */
const BAR_SLOTS = `[
  ['topbar-log',  '#topbar .log, #logbar, #topbar [data-neg-bar="log"]'],
  ['thumb-move',  '#thumb .tb-move, #tb-move, #thumb [data-neg-bar="move"]'],
  ['topbar-hud',  '#topbar .res'],
  ['topbar-date', '#topbar .date'],
  ['objectives',  '#objectives'],
  ['obj-banner',  '#obj-banner'],
  ['hint-toast',  '#hint.show'],
]`;

/** 量所有槽位：可见性 + 条上的文字（trim 后截断 40 字，便于打印）。 */
const PROBE_BARS = `(() => {
  const vis = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const slots = ${BAR_SLOTS};
  const out = {};
  let nVisible = 0;
  for (const [name, sel] of slots) {
    const els = [...document.querySelectorAll(sel)];
    const shown = els.filter(vis);
    const text = shown.map((e) => (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40)).join(' ǀ ');
    out[name] = { count: shown.length, visible: shown.length > 0, text };
  }
  for (const k of Object.keys(out)) if (out[k].visible) nVisible++;
  return { slots: out, nVisible };
})()`;

/** 开局页滚动比。对象 = `#start-screen`（`position:fixed; overflow:auto` 的那个滚动容器）。 */
const PROBE_FIT = `(() => {
  const el = document.querySelector('#start-screen');
  if (!el) return null;
  return { sh: el.scrollHeight, ch: el.clientHeight, ratio: +(el.scrollHeight / el.clientHeight).toFixed(3) };
})()`;

/** 目标清单（进图后顶上那一条）：在不在、几条、几条已达成。 */
const PROBE_OBJ = `(() => {
  const el = document.querySelector('#objectives');
  if (!el) return { present: false };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const rows = [...el.querySelectorAll('[data-obj-row]')];
  return {
    present: true,
    visible: cs.display !== 'none' && r.width > 0 && r.height > 0,
    h: Math.round(r.height),
    rows: rows.length,
    done: rows.filter((x) => x.getAttribute('data-obj-done') === '1').length,
    text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
  };
})()`;

/**
 * 真存档读数（`localStorage['homm-save-v1']`）：**实际生效**的 config + 地图实际尺寸 + p1 起始资源。
 * 为什么要读存档而不是读 UI：UI 上"选了困难"不等于"困难进了 `createGame`" ——
 * 只有存档里的 `config.difficulty` 与 `players.p1.resources.gold` 能证明它真的生效了。
 */
const PROBE_SAVE = `(() => {
  let s = null;
  try { s = JSON.parse(localStorage.getItem('homm-save-v1')); } catch (e) { s = null; }
  if (!s) return null;
  const cfg = s.config || {};
  const res = ((s.players || {}).p1 || {}).resources || {};
  return {
    scenario: cfg.scenario || null,
    size: cfg.size || null,
    difficulty: cfg.difficulty || null,
    mapW: s.map ? s.map.width : null,
    mapH: s.map ? s.map.height : null,
    gold: typeof res.gold === 'number' ? res.gold : null,
    wood: typeof res.wood === 'number' ? res.wood : null,
    ore: typeof res.ore === 'number' ? res.ore : null,
  };
})()`;

/** 开局页某一行（`label` 文本匹配）的可点项与其 disabled 状态。 */
const diffRowProbe = (label) => `(() => {
  const row = [...document.querySelectorAll('#start-screen .ss-field')]
    .find((r) => { const l = r.querySelector('label'); return !!l && l.textContent === ${JSON.stringify(label)}; });
  if (!row) return null;
  const items = [...row.querySelectorAll('.ss-seg-item')];
  return { labels: items.map((b) => (b.textContent || '').trim()), disabled: items.map((b) => b.disabled === true) };
})()`;

/** DUMP 用：开局页两栏与各块的实测高度（定位"是谁把屏撑高了"）。 */
const PROBE_PARTS = `(() => {
  const pick = ['.ss-panel', '.ss-preview', '#ss-map', '.ss-legend', '.ss-summary', '.ss-actions', '.ss-form'];
  const out = {};
  for (const s of pick) {
    const el = document.querySelector(s);
    if (!el) { out[s] = null; continue; }
    const r = el.getBoundingClientRect();
    out[s] = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }
  return out;
})()`;

/** DUMP：把屏上所有"自己带文字且可见"的元素打出来（取证用）。 */
const PROBE_DUMP = `(() => {
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.modal, #logpanel, #menu')) continue;
    if (!vis(el)) continue;
    // 只取"自己直接持有文字"的元素（不含纯容器）
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && (n.textContent || '').trim())
      .map((n) => n.textContent.trim()).join(' ');
    if (!own) continue;
    const r = el.getBoundingClientRect();
    out.push({ tag: el.tagName.toLowerCase(), id: el.id, cls: el.className, own, y: Math.round(r.top), h: Math.round(r.height) });
  }
  return out;
})()`;

/* ------------------------------------------------------------------ 交互助手 */

/** 按可见文字点一个元素；返回是否点到。 */
const clickText = (evaluate, sel, text) =>
  evaluate(`(() => {
    const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => (x.textContent || '').includes(${JSON.stringify(text)}));
    if (!b || b.disabled) return false;
    b.click();
    return true;
  })()`);

const clickSel = (evaluate, sel) =>
  evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true; })()`);

/** 等"页面真的起来了"：轮询而不是死等固定毫秒 —— 40×40 静态图的开局在真机上不算快。 */
const waitInGame = async (evaluate, tries = 80) => {
  for (let i = 0; i < tries; i++) {
    await sleep(150);
    try {
      if (
        await evaluate(
          `document.readyState === 'complete' && !document.querySelector('#start-screen') && !!document.querySelector('#map')`,
        )
      )
        return i * 150;
    } catch {
      /* 导航中，evaluate 会抛 */
    }
  }
  return null;
};

const waitStart = async (evaluate) => {
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    try {
      if (await evaluate(`document.readyState === 'complete' && !!document.querySelector('#start-screen')`)) return true;
    } catch { /* 导航中 */ }
  }
  return false;
};

/** 回到干净的开始页（清 localStorage ⇒ 不出现「继续上次存档」分支）。 */
const boot = async (send, evaluate) => {
  await send('Page.navigate', { url: URL0 });
  const ok = await waitStart(evaluate);
  if (!ok) throw new Error('等不到 #start-screen（导航未完成）');
  await sleep(600);
  return ok;
};

/* ------------------------------------------------------------------ 主体 */

try {
  await withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true });

    /* ---- DUMP 模式：只取证，不判过否（rc 恒 0）---- */
    if (DUMP) {
      await boot(send, evaluate);
      const fit = await evaluate(PROBE_FIT);
      console.log(`# [DUMP] 视口 ${W}×${H}@${DPR} · #start-screen scrollHeight=${fit.sh} clientHeight=${fit.ch} ratio=${fit.ratio}`);
      console.log('# [DUMP] 开局页分块：' + JSON.stringify(await evaluate(PROBE_PARTS)));
      console.log('# [DUMP] 开始页可见文字元素：');
      for (const d of await evaluate(PROBE_DUMP)) {
        console.log(`  <${d.tag}${d.id ? '#' + d.id : ''}${d.cls ? '.' + String(d.cls).split(' ').join('.') : ''}> y=${d.y} h=${d.h} :: ${d.own}`);
      }
      // 进图（优先一键；没有就走旧路径）
      const quick = await clickText(evaluate, '#start-screen button', '试这张图');
      if (!quick) {
        await clickText(evaluate, '#start-screen .ss-seg-item', '破碎罗盘');
        await sleep(400);
        await clickText(evaluate, '#start-screen button', '开始新游戏');
      }
      await sleep(2500);
      console.log(`# [DUMP] 进图后可见文字元素（quick=${quick}）：`);
      for (const d of await evaluate(PROBE_DUMP)) {
        console.log(`  <${d.tag}${d.id ? '#' + d.id : ''}${d.cls ? '.' + String(d.cls).split(' ').join('.') : ''}> y=${d.y} h=${d.h} :: ${d.own}`);
      }
      console.log('# [DUMP] 槽位：' + JSON.stringify(await evaluate(PROBE_BARS)));
      console.log('# [DUMP] 目标清单：' + JSON.stringify(await evaluate(PROBE_OBJ)));
      return;
    }

    /* ---- 负测：只跑「故意弄坏」的三组，断言都变红 ---- */
    if (NEG) {
      await boot(send, evaluate);

      /* N1 / N2：把 F-3.6 撤掉的两条常驻条**加回来** ⇒ 撤离条计数必须 0 → 2 */
      const before1 = await evaluate(PROBE_BARS);
      await evaluate(`(() => {
        const top = document.querySelector('#topbar');
        const b1 = document.createElement('div');
        b1.className = 'log'; b1.setAttribute('data-neg-bar', 'log');
        b1.textContent = 'D3 · 你的英雄拾取了 320 金';
        top.appendChild(b1);
        const th = document.querySelector('#thumb');
        const b2 = document.createElement('div');
        b2.className = 'tb-move'; b2.setAttribute('data-neg-bar', 'move');
        b2.textContent = '移动力 12 / 12';
        th.appendChild(b2);
        return true;
      })()`);
      await sleep(200);
      const after1 = await evaluate(PROBE_BARS);
      const removed = ['topbar-log', 'thumb-move'];
      const nRemoved = (b) => removed.reduce((n, k) => n + b.slots[k].count, 0);
      NEGPASS(
        nRemoved(before1) === 0 && nRemoved(after1) === 2,
        `N1/N2 常驻条判据可红：加回「顶部日志条 + 底部移动力条」⇒ 撤离条计数 ${nRemoved(before1)} → ${nRemoved(after1)}（topbar-log=${after1.slots['topbar-log'].text} / thumb-move=${after1.slots['thumb-move'].text}）`,
      );

      /* N3：把开局页撑高 ⇒ 滚动比必须 > 1.10 */
      await boot(send, evaluate);
      const before3 = await evaluate(PROBE_FIT);
      await evaluate(`(() => {
        const el = document.querySelector('#start-screen');
        const s = document.createElement('div');
        s.setAttribute('data-neg-bar', 'tall');
        s.style.height = '1200px';
        el.appendChild(s);
        return true;
      })()`);
      await sleep(200);
      const after3 = await evaluate(PROBE_FIT);
      NEGPASS(
        before3.ratio <= 1.1 && after3.ratio > 1.1,
        `N3 滚动比判据可红：撑高 1200px ⇒ ratio ${before3.ratio} → ${after3.ratio}（阈值 1.10）`,
      );

      /* N4（node 级，同一份 dist）：**把修复撤掉** ⇒ low 档必须**崩**；带着修复 ⇒ 三档都能开。
       * 这是"修复真的修了东西"的直接证据 —— 否则 E 组的绿可能只是"从来就没崩过"。 */
      const dimp = (rel) => distUrl(rel, DIST);
      const { createGame } = await import(dimp('core/map/generator.js'));
      const { scenarioGenOptions, SCENARIO_BY_ID } = await import(dimp('core/data/scenarios.js'));
      const { applyTier, clampMapSize, quality } = await import(dimp('render/quality.js'));
      const def = SCENARIO_BY_ID['grims-showcase'];
      const cfg = scenarioGenOptions(def);
      const oldRes = {};
      const newRes = {};
      for (const tier of ['low', 'mid', 'high']) {
        applyTier(tier);
        const clamped = clampMapSize(cfg.size, quality.maxMapSize);
        // 旧行为：一律钳制（不豁免静态地形）
        try {
          const g = createGame({ ...cfg, size: clamped });
          oldRes[tier] = `${g.map.width}×${g.map.height}`;
        } catch (e) {
          oldRes[tier] = `THROW: ${String(e.message).slice(0, 40)}`;
        }
        // 新行为：`staticSized()` —— 带静态地形的场景不参与钳制
        const fixed = def.staticMap ? def.config.size : clamped;
        try {
          const g = createGame({ ...cfg, size: fixed });
          newRes[tier] = `${g.map.width}×${g.map.height}`;
        } catch (e) {
          newRes[tier] = `THROW: ${String(e.message).slice(0, 40)}`;
        }
      }
      console.log(`  旧（一律钳制）: ${JSON.stringify(oldRes)}`);
      console.log(`  新（豁免静态地形）: ${JSON.stringify(newRes)}`);
      NEGPASS(
        /^THROW/.test(oldRes.low) && ['low', 'mid', 'high'].every((t) => newRes[t] === '40×40'),
        `N4 静态地形豁免可红：撤掉修复 ⇒ low 档崩（${oldRes.low}）；带修复 ⇒ 三档都是 40×40`,
      );

      console.log(`\n${negBad ? `★ ${negBad} 项 NEG-FAIL —— 判据可能**恒绿**（门坏了，必须修）` : '负测全部通过：N1/N2/N3/N4 四类判据**都能红**（门不是恒绿）'}`);
      return;
    }

    /* ---- 正向 ---- */

    /* B. 开局页滚动比 */
    await boot(send, evaluate);
    const fit = await evaluate(PROBE_FIT);
    console.log(`[读数] #start-screen scrollHeight=${fit.sh} · clientHeight=${fit.ch} · ratio=${fit.ratio}`);
    PASS(fit.ratio <= 1.1, `B 开局页滚动比 ≤ 1.10（实测 ${fit.ratio}）`);

    /* 取证截图：开始页 + 已选「破碎罗盘」⇒ 难度行处于可点状态 */
    if (SHOT) {
      const picked = await clickText(evaluate, '#start-screen .ss-seg-item', '破碎罗盘');
      await sleep(900);
      const row = await evaluate(diffRowProbe('难度'));
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
      console.log(`[截图] ${SHOT}（开始页 · 选中「破碎罗盘」=${picked} · 难度行 ${JSON.stringify(row)} · ${W}×${H}@${DPR}）`);
    }

    /* A. 一键进图：点几次 */
    let clicks = 0;
    const quick = await clickText(evaluate, '#start-screen button', '试这张图');
    if (quick) {
      clicks += 1;
    } else {
      console.log('[读数] 未找到「试这张图」⇒ 降级走旧路径（场景卡 + 开始新游戏），点击数如实记 2');
      const a = await clickText(evaluate, '#start-screen .ss-seg-item', '破碎罗盘');
      await sleep(500);
      const b = await clickText(evaluate, '#start-screen button', '开始新游戏');
      clicks += (a ? 1 : 0) + (b ? 1 : 0);
    }
    await sleep(3000);
    const inGame = await evaluate(`!document.querySelector('#start-screen') && !!document.querySelector('#map')`);
    console.log(`[读数] 进图路径点击次数 = ${clicks}（quick 入口存在=${quick}）`);
    PASS(quick, 'A1 开始页存在「试这张图」一键入口');
    PASS(inGame, 'A2 点击后确实进了游戏（#start-screen 已移除且 #map 在场）');
    PASS(clicks === 1, `A3 进图路径 = 1 次点击（实测 ${clicks}）`);

    /* C. 常驻文字条 */
    const bars = await evaluate(PROBE_BARS);
    for (const [k, v] of Object.entries(bars.slots)) {
      console.log(`[读数] 槽位 ${k.padEnd(11)} 可见=${v.visible ? 'Y' : 'n'} 命中=${v.count}${v.text ? ` 「${v.text}」` : ''}`);
    }
    console.log(`[读数] 常驻文字条（可见槽位）合计 = ${bars.nVisible}`);
    PASS(bars.slots['topbar-log'].count === 0, 'C1 顶部常驻日志条 = 0（F-3.6）');
    PASS(bars.slots['thumb-move'].count === 0, 'C2 底部常驻移动力条 = 0（F-3.6，改地图可达染色）');

    const obj = await evaluate(PROBE_OBJ);
    console.log(`[读数] 目标清单 = ${JSON.stringify(obj)}`);
    PASS(obj.present && obj.visible, 'C3 顶部有目标清单（`#objectives` 可见）');
    PASS(obj.rows > 0 && obj.rows <= 3, `C4 目标清单 ≤ 3 条（实测 ${obj.rows} 条，已达成 ${obj.done}）`);
    PASS(bars.slots['obj-banner'].count === 0, 'C5 教学 banner 不在展示图上');

    /* D. 红线：自由对局不参与 ⇒ 展示图专属的一切不得出现在自由对局里 */
    await boot(send, evaluate);
    await clickText(evaluate, '#start-screen button', '开始新游戏');
    await sleep(2500);
    const freeObj = await evaluate(PROBE_OBJ);
    const freeBars = await evaluate(PROBE_BARS);
    PASS(!freeObj.present || !freeObj.visible, 'D1 自由对局：顶上无目标清单（减法只在展示图生效）');
    PASS(freeBars.slots['topbar-hud'].count > 0, 'D2 自由对局：顶栏资源条照旧在场（既有路径未被动过）');

    /* ---- E. 三档画质下展示图都要能开起来 ----
     * 为什么单列一组：low 档 `maxMapSize = 32`，而展示图的静态地形是 40×40 ——
     * 只要 `startNewGame` 还对它做 `clampMapSize`，low 档就是**一点就崩**。
     * 判据 = 「真进了对局」+「地图真的是 40×40」+「目标清单在场」（证明进的是展示图）。 */
    for (const tier of ['low', 'mid', 'high']) {
      await boot(send, evaluate);
      // 手动覆盖画质档（`quality.ts`：`homm.tierMode !== 'auto'` ⇒ 直接 `applyTier`，不探测）
      await evaluate(`(() => { localStorage.setItem('homm.tierMode', ${JSON.stringify(tier)}); return true; })()`);
      await send('Page.navigate', { url: URL0 + '?devshowcase=1' });
      const waited = await waitInGame(evaluate);
      const started = waited !== null;
      const obj = await evaluate(PROBE_OBJ);
      const sv = await evaluate(PROBE_SAVE);
      const where = await evaluate(`({ href: location.href, ready: document.readyState, ss: !!document.querySelector('#start-screen'), map: !!document.querySelector('#map'), tier: localStorage.getItem('homm.tierMode') })`);
      console.log(
        `[读数] E-${tier}：进图=${started}（等待 ${waited === null ? '超时' : waited + 'ms'}） · 存档 ${sv ? `${sv.size} ${sv.mapW}×${sv.mapH} difficulty=${sv.difficulty}` : 'null'} · 目标清单=${obj.visible} · ${JSON.stringify(where)}`,
      );
      PASS(
        started && !!sv && sv.mapW === 40 && sv.mapH === 40 && obj.visible,
        `E-${tier} 档下展示图能开起来：地图 ${sv ? sv.mapW + '×' + sv.mapH : '?'}（静态地形 40×40，不得被 clamp）`,
      );
      // 复原手动档 ⇒ 后面的检查仍在默认（auto）档上跑
      await evaluate(`(() => { localStorage.setItem('homm.tierMode', 'auto'); return true; })()`);
    }

    /* ---- F. 展示图难度可选，且真的进 `createGame` ----
     * 判据不是"能点"，是"点完开出来的局资源真的变了"（引擎侧实测 easy 3000 / hard 1750）。 */
    const pickDifficulty = async (card, label) => {
      await boot(send, evaluate);
      await clickText(evaluate, '#start-screen .ss-seg-item', card);
      await sleep(400);
      const row = await evaluate(diffRowProbe('难度'));
      const clicked = await clickText(evaluate, '#start-screen .ss-seg-item', label);
      await sleep(300);
      await clickText(evaluate, '#start-screen button', '开始新游戏');
      await sleep(3000);
      return { row, clicked, save: await evaluate(PROBE_SAVE) };
    };

    const showEasy = await pickDifficulty('破碎罗盘', '轻松');
    console.log(`[读数] 展示图难度行 = ${JSON.stringify(showEasy.row)}`);
    PASS(!!showEasy.row && showEasy.row.disabled.every((d) => d === false), `F1 展示图：难度行 ${showEasy.row ? showEasy.row.labels.join('/') : '?'} 全可点`);
    console.log(`[读数] 选「轻松」开局 = ${JSON.stringify(showEasy.save)}`);
    PASS(
      !!showEasy.save && showEasy.save.difficulty === 'easy' && showEasy.save.gold === 3000 && showEasy.save.wood === 12,
      `F2 选「轻松」⇒ 存档 difficulty=${showEasy.save ? showEasy.save.difficulty : '?'} 资源 金${showEasy.save ? showEasy.save.gold : '?'}/木${showEasy.save ? showEasy.save.wood : '?'}/矿${showEasy.save ? showEasy.save.ore : '?'}（预期 easy / 3000 / 12 / 12）`,
    );

    const showHard = await pickDifficulty('破碎罗盘', '困难');
    console.log(`[读数] 选「困难」开局 = ${JSON.stringify(showHard.save)}`);
    PASS(
      !!showHard.save && showHard.save.difficulty === 'hard' && showHard.save.gold === 1750 && showHard.save.wood === 7,
      `F3 选「困难」⇒ 存档 difficulty=${showHard.save ? showHard.save.difficulty : '?'} 资源 金${showHard.save ? showHard.save.gold : '?'}/木${showHard.save ? showHard.save.wood : '?'}/矿${showHard.save ? showHard.save.ore : '?'}（预期 hard / 1750 / 7 / 7）`,
    );

    /* ---- G. 红线：教学场 / 对决场的难度仍锁定（它们的难度是设计的一部分）---- */
    for (const [name, card, want] of [['tutorial', '教学场', 'easy'], ['duel', '对决场', 'normal']]) {
      await boot(send, evaluate);
      await clickText(evaluate, '#start-screen .ss-seg-item', card);
      await sleep(400);
      const row = await evaluate(diffRowProbe('难度'));
      await clickText(evaluate, '#start-screen button', '开始新游戏');
      await sleep(2500);
      const sv = await evaluate(PROBE_SAVE);
      console.log(`[读数] G-${name} 难度行 = ${JSON.stringify(row)}`);
      PASS(!!row && row.disabled.every((d) => d === true), `G1-${name}：难度行仍**全锁定**（${row ? row.labels.join('/') : '?'}）`);
      PASS(!!sv && sv.difficulty === want, `G2-${name}：难度仍是场景固定值 ${sv ? sv.difficulty : '?'}（预期 ${want}）`);
    }

    /* D3/D4：tutorial / duel 两条既有路径同样不得被本轮的减法碰到 */
    for (const [name, card] of [['tutorial', '教学场'], ['duel', '对决场']]) {
      await boot(send, evaluate);
      const picked = await clickText(evaluate, '#start-screen .ss-seg-item', card);
      await sleep(500);
      await clickText(evaluate, '#start-screen button', '开始新游戏');
      await sleep(2500);
      const o = await evaluate(PROBE_OBJ);
      const b = await evaluate(PROBE_BARS);
      const cls = await evaluate(`document.querySelector('#topbar').classList.contains('showcase')`);
      PASS(picked, `D3-${name} 场景卡「${card}」可点（既有路径未被挡）`);
      PASS(!o.present && !cls && b.slots['topbar-hud'].count > 0, `D4-${name}：无目标清单 / 顶栏无 showcase 类 / 资源条照旧`);
    }
  });
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  process.exit(e && e.prerequisite ? 2 : 1);
}

console.log('---------------------------------------------');
console.log(bad === 0 ? '[总结] 展示图可玩性门全过' : `[总结] FAIL ${bad} 条`);
process.exit(NEG ? (negBad ? 1 : 0) : bad ? 1 : 0);
