#!/usr/bin/env node
/**
 * arts.mjs —— 装备页（§9.1 / U2）的机检（`npm run probe:arts`）。
 *
 * ## 它守什么
 * 装备页把「宝物」从**只读展示**变成**可穿戴状态**，于是多出两条只有实现期才看得见的风险：
 *   ① **背包里没穿的宝物不能加属性** —— 这条在 U2 之前是**反的**：
 *      `effectivePrimary` 遍历的是整个 `artifacts` 数组，卸下＝没反应，面板永远显示"已加成"。
 *   ② **非法落点必须零写入** —— "点背包 → 点槽"是两次点击，中间任何一次误点
 *      都不能把状态改掉一半（否则玩家会看到"属性变了但槽没变"）。
 *
 * ## 两条独立的风险，各有一组断言
 * A. **规则**（844×390 设计尺寸）：穿上 / 卸下 / 类型不符 / 选中不加属性 / 件数守恒。
 * B. **几何**（792×320 矮机硬限制 + 844×390 设计尺寸）：三栏都不溢出、槽不小到点不中。
 *    只测一个必然漏 —— 40px 槽在 320 高的机器上会被压成 32，而 `--arts-slot` 是唯一变量源。
 *
 * ## 为什么规则不在脚本里重写一遍
 * 断言读的是**面板真的调的那个函数链**：`effectivePrimary` / `equippedOf` / `backpackOf`
 * 经 `?devarts=1` 暴露的 `window.__arts()`。脚本里再抄一份"槽→宝物"的表就变成第二个真值来源。
 *
 * ## 负向对照（两边都证）
 * · 该拒的拒：背包里选**盾**去点**武器槽** ⇒ `slot-mismatch`，且指纹**逐字节不变**；
 * · 该动的动：同一份状态点**盾槽** ⇒ 防御 1→3，背包 6→5 件（不是空操作）。
 * · 只选中不加属性：点背包选中后 `stats` 必须**逐位相同**（这条最容易照着 bug 写反）。
 *
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足
 */
import { distDir, printHeader, requireFile, freePort, serveInProcess } from '../_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from '../_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=arts');
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

const BASE = `http://127.0.0.1:${PORT}/?devquick=1&devsize=medium&devseed=20260917&devreveal=1&devlight=0.22&devarts=1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const PASS = (c, m) => {
  if (!c) bad++;
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`);
};

/** 点一个选择器（真实鼠标事件走 CDP，不用 `el.click()`：后者绕过命中测试）。 */
const clickJs = (sel) => `(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return { ok: false, reason: 'not-found', sel: ${JSON.stringify(sel)} };
  const r = e.getBoundingClientRect();
  return { ok: true, x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`;

async function point(evaluate, sel) {
  return evaluate(clickJs(sel));
}

async function click(send, evaluate, sel) {
  const p = await point(evaluate, sel);
  if (!p || !p.ok) return p;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(60);
  return { ok: true };
}

/** 双击：第二次按下带 `clickCount=2` —— Chrome 只在那一刻派发 dblclick。 */
async function dblclick(send, evaluate, sel) {
  const p = await point(evaluate, sel);
  if (!p || !p.ok) return p;
  for (const n of [1, 2]) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: n });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: n });
  }
  await sleep(80);
  return { ok: true };
}

const snap = (evaluate) => evaluate('window.__arts ? window.__arts() : null');

/** 指纹：只装状态，不含 DOM —— 用来证"非法操作零写入"。 */
const fp = (s) => JSON.stringify([s.stats, s.worn, s.bag, s.owned]);

async function boot(evaluate) {
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    try {
      const s = await evaluate('window.__arts ? window.__arts() : null');
      if (s && s.open) return s;
    } catch {
      /* 导航中 */
    }
  }
  return null;
}

try {
  await withHeadlessChrome(async ({ send, evaluate }) => {
    /* ---------- A. 几何：矮机 792×320（硬限制） ---------- */
    await send('Emulation.setDeviceMetricsOverride', { width: 792, height: 320, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: BASE });
    let s = await boot(evaluate);
    if (!s) {
      PASS(false, '面板没打开（`?devarts=1` 的入口坏了）');
      return;
    }
    const slotW = s.slots.map((x) => x.w);
    console.log(
      `[矮机] 盒 ${s.box.w}×${s.box.h} · 槽 ${[...new Set(slotW)].join('/')}px · ` +
        `三栏 ${s.cols.map((c) => `${c.w}×${c.h}`).join(' · ')}`,
    );
    PASS(s.box.h <= 302, `① 盒高 ≤ 302（320 的 94%）—— 实测 ${s.box.h}`);
    PASS(s.box.scrollH <= s.box.clientH + 1, `② 盒纵向不溢出（${s.box.scrollH} ≤ ${s.box.clientH}）`);
    PASS(
      s.cols.every((c) => c.scrollH <= c.clientH + 1),
      `③ 三栏都不裁内容（各栏 scrollH ≤ clientH：${s.cols.map((c) => `${c.scrollH}/${c.clientH}`).join(' ')}）`,
    );
    PASS(s.cols.length === 3, `④ 三栏都在（实读 ${s.cols.length}）`);
    PASS(Math.min(...slotW) >= 30, `⑤ 每个槽 ≥ 30px（最矮 ${Math.min(...slotW)}px；40 档在矮机会降到 32）`);
    PASS(s.rows.length === 5 && Math.min(...s.rows) >= 16, `⑥ 部队 5 行且行高 ≥ 16px（${s.rows.join('/')}）`);
    /* 单量一层：部队列表 `overflow:hidden`，被它裁掉的行不会进三栏的 scrollHeight。 */
    PASS(
      s.armyBox && s.armyBox.scrollH <= s.armyBox.clientH + 1,
      `⑥b 部队列表不裁行（${s.armyBox?.scrollH} ≤ ${s.armyBox?.clientH}，5 行要全在）`,
    );

    /* ---------- B. 几何：844×390（设计尺寸） ---------- */
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: BASE });
    s = await boot(evaluate);
    if (!s) {
      PASS(false, '844×390 下面板没打开');
      return;
    }
    console.log(`[设计尺寸] 盒 ${s.box.w}×${s.box.h} · 槽 ${[...new Set(s.slots.map((x) => x.w))].join('/')}px`);
    PASS(s.box.w <= 761 && s.box.w >= 700, `⑦ 盒宽 ≈760（实测 ${s.box.w}）`);
    PASS(
      s.cols.every((c) => c.scrollH <= c.clientH + 1),
      `⑧ 常规尺寸三栏也不裁内容（${s.cols.map((c) => `${c.scrollH}/${c.clientH}`).join(' ')}）`,
    );
    PASS(Math.min(...s.slots.map((x) => x.w)) >= 38, `⑨ 常规尺寸槽 ≥ 38px（实测 ${Math.min(...s.slots.map((x) => x.w))}）`);
    PASS(s.cells.length === 12, `⑩ 背包 4×3 = 12 格（实读 ${s.cells.length}）`);

    /* ---------- C. 规则 ---------- */
    const owned = s.owned.length;
    console.log(
      `[起始] 四维 ${JSON.stringify(s.stats)} · 穿戴 ${JSON.stringify(s.worn)} · ` +
        `背包 ${JSON.stringify(s.bag)}`,
    );
    PASS(owned === 6, `⑪ 六件宝物都在册（实读 ${owned}）`);
    PASS(
      s.stats.attack === 3 && s.stats.defense === 1,
      `⑫ 只有**穿着的**那把刀加属性（攻 ${s.stats.attack} 应 3 = 底 1 + 2；防 ${s.stats.defense} 应 1）`,
    );
    PASS(
      s.bag.length === owned - Object.keys(s.worn).length,
      `⑬ 背包 = 在册 − 穿戴（${s.bag.length} = ${owned} − ${Object.keys(s.worn).length}）`,
    );

    /* C1. 只选中不加属性（最容易照着 bug 写反的一条） */
    const fpIdle = fp(s);
    await click(send, evaluate, '.bag-cell[data-art="aegis"]');
    s = await snap(evaluate);
    PASS(s.sel === 'aegis' && s.reason === 'picked', `⑭ 点背包 = 选中（sel="${s.sel}" · reason="${s.reason}"）`);
    PASS(fp(s) === fpIdle, '⑮ 只选中**不加属性**（指纹与未选中时逐字节相同）');

    /* C2. 类型不符 ⇒ 该槽转红 + 零写入 */
    await click(send, evaluate, '.art-slot[data-slot="weapon"]');
    s = await snap(evaluate);
    PASS(s.reason === 'slot-mismatch', `⑯ 盾放武器槽被拒（reason="${s.reason}"）`);
    PASS(fp(s) === fpIdle, '⑰ 被拒时**零写入**（四维 / 穿戴 / 背包 / 在册全部不变）');

    /* C3. 该动的动：同一件盾放盾槽。
     * ⚠️ 这里**不能再点一次背包格** —— 点同一件 = 取消选中（toggle）。
     *    早先版本这么做，于是"点盾槽"落在无选中态⇒什么也没发生，
     *    后面三条断言全部**空过**（防御 1→1 被判成"卸下生效"）。
     *    这类"判据被上一步的实现细节喂饱"的假绿，只有把选中态也断言出来才防得住。 */
    PASS(s.sel === 'aegis', `⑱ 类型不符被拒后**仍保留选中**（sel="${s.sel}"）`);
    await click(send, evaluate, '.art-slot[data-slot="shield"]');
    s = await snap(evaluate);
    PASS(s.worn.shield === 'aegis', `⑲ 盾真的穿上了（worn.shield="${s.worn.shield}"）`);
    PASS(s.stats.defense === 3, `⑳ 防御 1 → 3（实读 ${s.stats.defense}）`);
    PASS(!s.bag.includes('aegis') && s.bag.length === 4, `㉑ 盾离开背包（剩 ${s.bag.length} 件）`);
    PASS(fp(s) !== fpIdle, '㉒ 合法操作**确实改写了状态**（不是空操作）');

    /* C4. 双击卸下 ⇒ 属性掉回去、回到背包 */
    const fpWorn = fp(s);
    await dblclick(send, evaluate, '.art-slot[data-slot="shield"]');
    s = await snap(evaluate);
    PASS(!s.worn.shield, `㉓ 双击卸下（worn.shields 空，实读 ${JSON.stringify(s.worn)}）`);
    PASS(s.stats.defense === 1, `㉔ 防御 3 → 1（实读 ${s.stats.defense}）`);
    PASS(s.bag.includes('aegis') && s.bag.length === 5, `㉕ 盾回到背包（${s.bag.length} 件）`);
    PASS(fp(s) !== fpWorn, '㉖ 卸下**确实改写了状态**（不是空操作）');

    /* C5. 长按 400ms 出物品浮层（按住不放时读，抬起即消失） */
    const p = await point(evaluate, '.bag-cell[data-art="aegis"]');
    let tipDuring = false;
    if (p && p.ok) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await sleep(560);
      tipDuring = await evaluate('!!document.querySelector(".arts-tip")');
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await sleep(80);
    }
    const tipAfter = await evaluate('!!document.querySelector(".arts-tip")');
    PASS(tipDuring && !tipAfter, `㉗ 长按出浮层、抬起即收（按住时 ${tipDuring} · 抬起后 ${tipAfter}）`);

    /* C6. 出口在头部，且能关掉（§R3：出口不滚动） */
    await click(send, evaluate, '.modal.arts .modal-head .btn.tiny');
    const closed = await evaluate('!document.querySelector(".modal.arts")');
    PASS(closed, '㉘ 头部「返回」能关掉面板');
  });
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  process.exit(e && e.prerequisite ? 2 : 1);
}

console.log('---------------------------------------------');
console.log(bad === 0 ? '[总结] 全过' : `[总结] FAIL ${bad} 条`);
process.exit(bad === 0 ? 0 : 1);
