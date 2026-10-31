#!/usr/bin/env node
/**
 * exchange.mjs —— 会面交换（§9.2）的机检（`npm run probe:exchange`）。
 *
 * ## 它守什么
 * 2026-10-31 之前全库 0 处 exchange/transfer/swap：两位友军走到同一格**什么都不发生**，
 * H3 的「主英雄打、副英雄运兵」这条物流循环是断的。这条比任何一张头像都影响一局能不能打完。
 *
 * ## 两条独立的风险，各有一组断言
 * ① **规则**：合并 / 移入 / 互换 / 分兵 / 满编拒绝，且非法操作**零写入**；
 * ② **几何**：760×352 的盒子在 **844×390 与 792×320** 两个尺寸下都不溢出。
 *    前者是"设计值"，后者是"矮机硬限制"——只测一个必然漏。
 *
 * ## 为什么规则不在脚本里重写一遍
 * 脚本调的是**面板真的会调的那个函数**（`core/game/exchange.ts`，经 `window.__exchange`
 * 暴露的同一份 state）。脚本里再抄一份 `Σcount` 算法就变成第二个真值来源，
 * 断言会照着 bug 长成合适的样子。
 *
 * ## 负向对照（两边都证，别只证"改了"）
 * · `=full` 场景下点对面必须 `target-full` **且指纹逐字节不变**（该拒的拒了）；
 * · 同一场景合并成功时 `Σcount` 不变但分布**必须变**（该动的动了）。
 *
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足
 */
import { distDir, printHeader, requireFile, freePort, serveInProcess } from '../_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from '../_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=exchange');
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

const BASE = `http://127.0.0.1:${PORT}/?devquick=1&devsize=medium&devseed=20260917&devreveal=1&devlight=0.22`;
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

async function click(send, evaluate, sel) {
  const p = await evaluate(clickJs(sel));
  if (!p || !p.ok) return p;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(60);
  return { ok: true };
}

const snap = (evaluate) => evaluate('window.__exchange ? window.__exchange() : null');

/** 等面板开（导航后 startNewGame 要跑一会儿）。 */
async function boot(evaluate, url) {
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    try {
      const s = await evaluate('window.__exchange ? window.__exchange() : null');
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
    await send('Page.navigate', { url: `${BASE}&devexchange=1` });
    let s = await boot(evaluate, `${BASE}&devexchange=1`);
    if (!s) {
      PASS(false, '面板没打开（`?devexchange=1` 的入口坏了）');
      return;
    }
    console.log(
      `[矮机] 盒 ${s.box.w}×${s.box.h} · 行高 ${[...new Set(s.rows)].join('/')}px · ` +
        `scrollH ${s.box.scrollH} vs clientH ${s.box.clientH}`,
    );
    PASS(s.box.h <= 302, `① 盒高 ≤ 302（320 的 94%）—— 实测 ${s.box.h}`);
    PASS(s.box.scrollH <= s.box.clientH + 1, `② 盒纵向不溢出（${s.box.scrollH} ≤ ${s.box.clientH}）`);
    PASS(!s.ex || s.ex.scrollH <= s.ex.clientH + 1, `③ 内容区纵向不溢出（${s.ex?.scrollH} ≤ ${s.ex?.clientH}）`);
    PASS(s.rows.length === 10, `④ 两侧各 5 行（共 ${s.rows.length}）`);
    PASS(
      Math.min(...s.rows) >= 30,
      `⑤ 每行 ≥ 30px（最矮 ${Math.min(...s.rows)}px；40 档在矮机会降到 32）`,
    );

    /* ---------- B. 规则：844×390（设计尺寸） ---------- */
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: `${BASE}&devexchange=1` });
    s = await boot(evaluate);
    if (!s) {
      PASS(false, '844×390 下面板没打开');
      return;
    }
    console.log(`[设计尺寸] 盒 ${s.box.w}×${s.box.h} · 行高 ${[...new Set(s.rows)].join('/')}px`);
    PASS(s.box.w <= 761 && s.box.w >= 700, `⑥ 盒宽 ≈760（实测 ${s.box.w}）`);
    PASS(Math.min(...s.rows) >= 38, `⑦ 常规尺寸每行 ≥ 38px（最矮 ${Math.min(...s.rows)}px，应 40）`);

    const total0 = s.a.total + s.b.total;
    const dist0 = JSON.stringify([s.a.army, s.b.army]);
    console.log(`[起始] A=${JSON.stringify(s.a.army)} B=${JSON.stringify(s.b.army)} Σ=${total0}`);

    /* B1. 合并：A 灯侍 12 → B 灯侍 5 */
    await click(send, evaluate, '.ex-side[data-side="a"] .ex-row[data-idx="0"]');
    await click(send, evaluate, '.ex-side[data-side="b"] .ex-row[data-idx="0"]');
    s = await snap(evaluate);
    const merged = s.b.army.find(([t]) => t === 'p1_child');
    PASS(merged && merged[1] === 17, `⑧ 合并且数量正确（B 小孩 5+12=17，实读 ${merged && merged[1]}）`);
    PASS(s.a.total + s.b.total === total0, `⑨ 合并后 Σ 不变（${s.a.total + s.b.total} = ${total0}）`);
    PASS(JSON.stringify([s.a.army, s.b.army]) !== dist0, '⑩ 合并**确实改写了分布**（不是空操作）');

    /* B2. 分兵一半：A 角弓 8 → 选"一半" = 4 → B 空槽 */
    await click(send, evaluate, '.ex-side[data-side="a"] .ex-row[data-idx="0"]');
    await click(send, evaluate, '.ex-side[data-side="a"] .ex-row[data-idx="0"]'); // 再点一次 = 开分兵
    const hasAmt = await evaluate('!!document.querySelector(".ex-amt")');
    PASS(hasAmt, '⑪ 再点同一栈弹出「全部 / 一半 / 1」三键');
    if (hasAmt) {
      await click(send, evaluate, '.ex-amt[data-amt="half"]');
      await click(send, evaluate, '.ex-side[data-side="b"] .ex-row[data-idx="3"]'); // 空槽
      s = await snap(evaluate);
      const moved = s.b.army.filter(([t]) => t === 'p1_crossbow').reduce((n, [, c]) => n + c, 0);
      const left = s.a.army.filter(([t]) => t === 'p1_crossbow').reduce((n, [, c]) => n + c, 0);
      PASS(moved === 4 && left === 4, `⑫ 一半分兵：移走 4 / 留下 4（实读 ${moved} / ${left}）`);
      PASS(s.a.total + s.b.total === total0, `⑬ 分兵后 Σ 不变（${s.a.total + s.b.total}）`);
    }

    /* B3. 异兵种互换：A 角弓 4 → B 灯侍 17 */
    const beforeA = (await snap(evaluate)).a.army;
    await click(send, evaluate, '.ex-side[data-side="a"] .ex-row[data-idx="0"]');
    await click(send, evaluate, '.ex-side[data-side="b"] .ex-row[data-idx="0"]');
    s = await snap(evaluate);
    const swapped = s.a.army.some(([t, c]) => t === 'p1_child' && c === 17);
    PASS(swapped, `⑭ 异兵种整队互换（A 拿到灯侍 17，实读 ${JSON.stringify(s.a.army)}）`);
    PASS(s.a.total + s.b.total === total0, `⑮ 互换后 Σ 不变（${s.a.total + s.b.total}）`);
    PASS(beforeA.length === s.a.army.length, '⑯ 互换不改栈数（只换兵种与数量）');

    /* B4. 装备：A 武器槽 → B 武器槽 */
    const art0 = s.a.artifacts.length + s.b.artifacts.length;
    await click(send, evaluate, '.ex-side[data-side="a"] .ex-slot[data-slot="weapon"]');
    await click(send, evaluate, '.ex-side[data-side="b"] .ex-slot[data-slot="weapon"]');
    s = await snap(evaluate);
    PASS(s.a.artifacts.length + s.b.artifacts.length === art0, `⑰ 宝物件数守恒（${art0}）`);
    PASS(!s.a.artifacts.includes('blade_of_fury') && s.b.artifacts.includes('blade_of_fury'), '⑱ 宝物真的换了手');

    /* ---------- C. 满编：=full 场景 ---------- */
    await send('Page.navigate', { url: `${BASE}&devexchange=full` });
    s = await boot(evaluate);
    if (!s) {
      PASS(false, '`?devexchange=full` 没打开面板');
      return;
    }
    PASS(s.b.army.length === 5, `⑲ 满编场景 B 有 5 栈（实读 ${s.b.army.length}）`);
    /* Σ 从场景自身读，不手写常数：上一版写死 12+8+5+4+2+1+3+2（把 =1 场景的三栈
       和 =full 的两栈混着加），场景一改断言就变成"照着旧数组数数"。 */
    const totalFull = s.a.total + s.b.total;

    /* C1. 满编 + 想塞"一半" ⇒ 接不住：红描边 + 「目标已满」+ 点击被拒 + 零写入 */
    await click(send, evaluate, '.ex-side[data-side="a"] .ex-row[data-idx="0"]');
    await click(send, evaluate, '.ex-side[data-side="a"] .ex-row[data-idx="0"]'); // 开分兵
    await click(send, evaluate, '.ex-amt[data-amt="half"]');
    s = await snap(evaluate);
    PASS(s.fullBadge, '⑳ 满编且无同兵种 + 只移一半 ⇒ 头部「目标已满」');
    PASS(s.blocked > 0, `㉑ 对面行红描边（${s.blocked} 行）`);

    const fp0 = JSON.stringify([s.a.army, s.b.army, s.a.artifacts, s.b.artifacts]);
    await click(send, evaluate, '.ex-side[data-side="b"] .ex-row[data-idx="0"]');
    s = await snap(evaluate);
    PASS(s.reason === 'target-full', `㉒ 点击被拒且给出 reason（实读 "${s.reason}"）`);
    PASS(
      JSON.stringify([s.a.army, s.b.army, s.a.artifacts, s.b.artifacts]) === fp0,
      '㉓ 非法操作**零写入**（前后指纹逐字节相同）',
    );

    /* C2. 满编下**整队互换仍然合法**（H3 同款）—— 防止判据"一律挡满编"挡过头。
       这一条与上面两条是**反向对照**：同一个满编状态，一个该拒、一个该放。 */
    await click(send, evaluate, '.ex-side[data-side="a"] .ex-row[data-idx="0"]'); // 再点开分兵
    await click(send, evaluate, '.ex-amt[data-amt="all"]'); // 关掉分兵、恢复整队
    await click(send, evaluate, '.ex-side[data-side="b"] .ex-row[data-idx="0"]');
    s = await snap(evaluate);
    const swappedFull = s.a.army.some(([t]) => t === 'p1_eagle') && s.b.army.some(([t]) => t === 'p1_child');
    PASS(swappedFull && s.b.army.length === 5, '㉔ 满编下整队互换仍然放行（栈数不变、兵种对调）');
    PASS(s.a.total + s.b.total === totalFull, `㉕ 互换后 Σ 仍守恒（${s.a.total + s.b.total} = ${totalFull}）`);
  });
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  process.exit(e && e.prerequisite ? 2 : 1);
}

console.log('---------------------------------------------');
console.log(bad === 0 ? '[总结] 全过' : `[总结] FAIL ${bad} 条`);
process.exit(bad === 0 ? 0 : 1);
