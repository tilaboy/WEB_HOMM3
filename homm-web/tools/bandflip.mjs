#!/usr/bin/env node
/**
 * bandflip.mjs —— ④ 边带「翻默认」的**两向**机检门（`npm run audit:bandflip`）。
 *
 * ## 起因
 * 2026-10-21 真机走查，主理人看 `phone-01-tutorial.png`：「英雄能走的地方跟树 / 水 / 山
 * 之间有直线来分割……可以让地图更自然一点吗？」
 * 那条直线不是地图美术，是 ④ 的边带：每个贴可达区的不可走格画 `红 2px + 亮芯 2px + 墨 2px`；
 * **1×1 的树四侧全贴可达区 ⇒ 得到一只闭合方框**。四臂 A/B 后把默认从 `full` 翻成 `soft`
 * （亮芯/墨各 1px + 自带形体的格子不描）。
 *
 * ## 为什么要有这把尺（照 `haloflip` 的规矩）
 * > **凡"把某开关翻成默认"，必须同时留一条可复现的旧路径。**
 * 否则新对照臂退化成 `on vs on` ⇒ A/B 成恒等式。本门把"旧路径还在且不等价"钉在像素上：
 *
 *   ① **`default` ≡ `?devband=soft`**（逐块同）—— 证"默认 == soft"；
 *   ② **`default` ≠ `?devband=full`**（逐块差够一个数量级）—— 证"旧路径可达**且**不等价"；
 *   ③ **`default` ≠ `?devband=off`**（同上）—— 证"关掉这条路也还在"；
 *      ⚠️ 这条的像素差**故意小**：实测 66 块（0.98%）—— 边带本来就被改轻了。
 *      所以门槛不沿用 `SIGNAL_MIN`，而是「`off` 的 `rects === 0` 且默认 `rects > 0`」+「> 本底 3 倍」。
 *   ④ **落笔量**（`?devbandstats=1` 的 `window.__bandStats`）：
 *      · `mode === 'soft'` —— 默认真的走在 soft 分支（不是"两臂恰好同色"）；
 *      · `artSkip > 0` —— 作用域收窄真的生效（否则"树被套方框"会**静默回潮**）；
 *      · `px(default) ≤ PX_RATIO × px(full)` —— "边带变轻了"是这条改动的**目的**，
 *        须有数，不能只靠"看着顺眼"。
 *   三条像素判据 + 一条语义判据，**缺一不可**：
 *     · 有人把默认改回 `full` ⇒ ① 红；
 *     · 有人删掉 `full` 分支（写死 soft）⇒ ② 红；
 *     · 有人删掉 `art` 例外 ⇒ ④ 的 `artSkip>0` 红；
 *     · 有人把 `thin` 的 1px 改回 2px ⇒ ④ 的 `px` 比值红。
 *
 * ## 口径（与 `haloflip` 对齐，不自创）
 *   · 视口 = 真机 **792×320 @DPR3**（OPPO PMA110 实测）；
 *   · URL 基线 = `haloflip` 那条（`devquick/devsize/devseed/devreveal/devlight`）；
 *   · **冻帧**：`performance.now()` 钉常数 + 停 `rAF`，连量两次**必须逐块同**；
 *   · 比较用 **16×16 分块 FNV**；另设**安慰剂臂**（同 URL 抓两次）量导航噪声本底。
 *
 * ## 用法
 *   node tools/bandflip.mjs                        # 量 ./dist
 *   node tools/bandflip.mjs --dist=/tmp/dist-old   # 量隔离构建
 *   node tools/bandflip.mjs --measure              # 只打印四臂的 __bandStats / 块差，不判
 *
 * 退出码：0 = 全过 · 1 = 有判据不过 · 2 = 前置不满足
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { distDir, printHeader, requireFile, freePort, serveInProcess } from './_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from './_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=bandflip');
const MEASURE = process.argv.includes('--measure');

/* ---------------------------------------------------------------- 前置 */
const MAPJS = path.join(DIST, 'render', 'MapRenderer.js');
requireFile(DIST, 'render/MapRenderer.js');
const mapjs = readFileSync(MAPJS, 'utf8');
if (!mapjs.includes('devband')) {
  console.error('✗ 前置不满足：构建的 render/MapRenderer.js 不含 `devband` ⇒ 这份构建早于该旗标。');
  process.exit(2);
}
if (!mapjs.includes('devbandstats')) {
  console.error('✗ 前置不满足：构建不含 `devbandstats` ⇒ ④ 无从量起（先 `npm run build`）。');
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
const BASE =
  `http://127.0.0.1:${PORT}/?devquick=0&devsize=medium&devseed=20260917&devreveal=1&devlight=0.22&devbandstats=1`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const PASS = (c, m) => { if (!c) bad++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`); };

/** 页面内：停 rAF + 把 performance.now 打平（冻帧）；量 16×16 分块 FNV。 */
const FREEZE = `(() => {
  if (!window.__bandFlipFrozen) {
    const t0 = 1000;
    try { performance.now = () => t0; } catch (e) {}
    window.requestAnimationFrame = () => 0;
    window.__bandFlipFrozen = true;
  }
  return true;
})()`;

const BLOCKS = `(() => {
  const cs = [...document.querySelectorAll('canvas')].filter((c) => c.width > 0 && c.height > 0);
  if (!cs.length) return { ok: false, reason: '没有已绘制的 canvas' };
  cs.sort((a, b) => b.width * b.height - a.width * a.height);
  const c = cs[0];
  const ctx = c.getContext('2d');
  if (!ctx) return { ok: false, reason: 'canvas 没有 2d ctx' };
  const W = c.width, H = c.height, B = 16;
  const d = ctx.getImageData(0, 0, W, H).data;
  const bw = Math.ceil(W / B), bh = Math.ceil(H / B);
  const out = new Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let h = 2166136261 >>> 0;
      const x1 = Math.min(W, (bx + 1) * B), y1 = Math.min(H, (by + 1) * B);
      for (let y = by * B; y < y1; y++) {
        let i = (y * W + bx * B) * 4;
        for (let x = bx * B; x < x1; x++) {
          h ^= d[i]; h = Math.imul(h, 16777619) >>> 0;
          h ^= d[i + 1]; h = Math.imul(h, 16777619) >>> 0;
          h ^= d[i + 2]; h = Math.imul(h, 16777619) >>> 0;
          i += 4;
        }
      }
      out[by * bw + bx] = h >>> 0;
    }
  }
  return { ok: true, w: W, h: H, bw, bh, blocks: out };
})()`;

const diffBlocks = (a, b) => {
  if (!a || !b || a.bw !== b.bw || a.bh !== b.bh) return -1;
  let n = 0;
  for (let i = 0; i < a.blocks.length; i++) if (a.blocks[i] !== b.blocks[i]) n++;
  return n;
};

async function capture(send, evaluate, extra, label) {
  await send('Page.navigate', { url: BASE + extra });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    try {
      ready = await evaluate(`(() => { const c = document.querySelector('canvas'); return !!c && c.width > 0 && c.height > 0; })()`);
      if (ready) break;
    } catch { /* 导航中 */ }
  }
  await sleep(4200); // 等启动 toast 退场（≈4s），四臂同一状态
  await evaluate(FREEZE);
  await sleep(500);
  const st = await evaluate('window.__bandStats || null');
  const b1 = await evaluate(BLOCKS);
  await sleep(400);
  const b2 = await evaluate(BLOCKS);
  if (!b1 || !b1.ok) { console.log(`[${label}] 量不到：${b1 ? b1.reason : 'null'}`); return null; }
  const stable = diffBlocks(b1, b2) === 0;
  console.log(
    `[${label}] canvas ${b1.w}×${b1.h} · 块 ${b1.bw}×${b1.bh} · 冻帧后两次差异块 = ${diffBlocks(b1, b2)}` +
      (st ? ` · 边带 mode=${st.mode} rects=${st.rects} px=${st.px} artSkip=${st.artSkip}` : ' · 边带 stats=(无)'),
  );
  PASS(stable, `${label} 冻帧稳定（连量两次逐块同）`);
  return { blocks: b1, st };
}

try {
  await withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Emulation.setDeviceMetricsOverride', { width: 792, height: 320, deviceScaleFactor: 3, mobile: true });
    // `#hint` 启动 toast 的淡入淡出走渲染时钟 ⇒ 抓帧时刻的抖动会漏进像素（`haloflip` 踩过）。
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source:
        `(() => { const t0 = 1000; try { performance.now = () => t0; } catch (e) {}` +
        ` const add = () => { const s = document.createElement('style'); s.textContent = '#hint{display:none !important}';` +
        ` (document.head || document.documentElement).appendChild(s); };` +
        ` if (document.head) add(); else document.addEventListener('DOMContentLoaded', add); })();`,
    });

    // 预热丢弃：首次导航是"冷"态（图集/字形缓存），与本门无关
    await capture(send, evaluate, '', 'warmup(丢弃)');
    const A = await capture(send, evaluate, '', 'default');
    // 安慰剂臂：同 URL 再抓一次 ⇒ 量出导航噪声本底
    const A2 = await capture(send, evaluate, '', 'default#2(placebo)');
    const S = await capture(send, evaluate, '&devband=soft', '?devband=soft');
    const F = await capture(send, evaluate, '&devband=full', '?devband=full');
    const O = await capture(send, evaluate, '&devband=off', '?devband=off');

    if (!A || !A2 || !S || !F || !O) {
      PASS(false, '五条臂中有量不到的 ⇒ 无法判（见上）');
      return;
    }
    const floor = diffBlocks(A.blocks, A2.blocks);
    const as = diffBlocks(A.blocks, S.blocks);
    const af = diffBlocks(A.blocks, F.blocks);
    const ao = diffBlocks(A.blocks, O.blocks);
    console.log(
      `--- 逐块差（单位=块，分母=${A.blocks.bw * A.blocks.bh}）： 本底(default vs default#2) → ${floor}；` +
        ` default vs soft → ${as}； default vs full → ${af}； default vs off → ${ao}`,
    );

    if (MEASURE) {
      console.log('（--measure：只打印，不判）');
      return;
    }

    const NOISE_MARGIN = 40; // 块 · 分母 6705 ⇒ 0.60% · 每跑
    const SIGNAL_MIN = 200; // 块 · 分母 6705 ⇒ 2.98% · 每跑·每模式对（`haloflip` 同值）
    const K = 10; // 信号 / 本底 的倍数下限
    const sound = Math.max(K * Math.abs(floor), SIGNAL_MIN);
    /* ③ 的尺度**不能**沿用 `SIGNAL_MIN`：这条改动的目的就是让边带变轻，
     * 实测 default vs off 只有 **66 块**（0.98%）—— 拿 200 当门槛会红，而那不是缺陷。
     * 所以 ③ 用「语义 + 像素」两条并存，像素那条只要**显著高于本底**（实测本底 0，66 ≥ 24）。
     */
    const OFF_MIN = Math.max(3 * Math.abs(floor), 24); // 块 · 分母 6705 ⇒ 0.36%
    console.log(`    判据： ① 须 ≤ ${floor} + ${NOISE_MARGIN} = ${floor + NOISE_MARGIN}； ② 须 ≥ ${sound}； ③ 须 ≥ ${OFF_MIN} 且 off 的 rects=0`);

    /* ⚠️ ① / ② 必须同时验**那一臂自己解析成了什么 mode**（`__bandStats.mode`）。
     *   NEG1 实测踩到的坑：把默认改回 `full` 时，若 `soft` 这个词也一起从解析器里掉了，
     *   `?devband=soft` 会**回落成默认** ⇒ 两臂同色 ⇒ `as=0` ⇒ ①**假绿**（"对照臂被吞"）。
     *   本门首版就是这么绿着过的，只有 ④a 响了。现在把"臂的身份"并进 ①/② 的判据里。 */
    PASS(
      as <= Math.max(floor, 0) + NOISE_MARGIN && !!S.st && S.st.mode === 'soft',
      `① default ≡ ?devband=soft（${as} ≤ ${Math.max(floor, 0) + NOISE_MARGIN}，且 soft 臂 mode=${S.st ? S.st.mode : '(无)'}）—— 证"默认 == soft"`,
    );
    PASS(
      af >= sound && !!F.st && F.st.mode === 'full',
      `② default ≠ ?devband=full（${af} ≥ ${sound}，且 full 臂 mode=${F.st ? F.st.mode : '(无)'}）—— 证"旧路径可达且不等价"`,
    );
    PASS(!!O.st && O.st.rects === 0 && !!A.st && A.st.rects > 0, `③a ?devband=off 真把边带关干净（off rects=${O.st ? O.st.rects : '(无)'}，默认 rects=${A.st ? A.st.rects : '(无)'}）`);
    PASS(ao >= OFF_MIN, `③b default ≠ ?devband=off（${ao} ≥ ${OFF_MIN} 块）`);

    /* ④ 落笔量：语义判据。`px` = 边带矩形总面积（世界 px²），只由 `band()` 累加 ⇒
     * 不受美术里同值墨色（`#2a1a12`/`#fff3c8`）污染。 */
    const pxA = A.st ? A.st.px : -1;
    const pxF = F.st ? F.st.px : -1;
    PASS(!!A.st && A.st.mode === 'soft', `④a 默认走 soft 分支（mode=${A.st ? A.st.mode : '(无)'}）`);
    PASS(!!A.st && A.st.artSkip > 0, `④b 作用域收窄生效（artSkip=${A.st ? A.st.artSkip : '(无)'} > 0）—— 自带形体的格子没被描`);
    const PX_RATIO = 0.12; // 默认落笔面积 / full 的上限；实测 **4.2%**（320 vs 7680）⇒ 留 2.9 倍余量
    PASS(pxA > 0 && pxF > 0 && pxA <= PX_RATIO * pxF, `④c 边带落笔面积 default ${pxA} ≤ ${PX_RATIO}×full ${pxF}（= ${Math.round(PX_RATIO * pxF)}）`);
  });
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  process.exit(e && e.prerequisite ? 2 : 1);
}

console.log('---------------------------------------------');
console.log(bad === 0 ? '[总结] 全过' : `[总结] FAIL ${bad} 条`);
process.exit(bad === 0 ? 0 : 1);
