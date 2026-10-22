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
 *   ① **`default` ≡ `?devband=shade`**（逐块同）—— 证"默认 == shade"；
 *   ② **`default` ≠ `?devband=full`**（逐块差够一个数量级）—— 证"旧路径可达**且**不等价"；
 *   ③ **`default` ≠ `?devband=off`** —— 证"压暗那一层真的在画"（off = 只铺蓝洗、不压暗）；
 *   ④ **`?devband=soft` 仍在且与默认不同** —— 上一版形态可复现（翻默认必须留旧路径）；
 *   ⑤ **语义**（`?devbandstats=1` 的 `window.__bandStats`）：
 *      · `mode === 'shade'` —— 默认真的走在 shade 分支（不是"两臂恰好同色"）；
 *      · `rects === 0` —— **一条线都不画**（这正是主理人要去掉的"白框"）；
 *      · `shade > 0` —— 外圈压暗真的落笔（`walkable` 忘了传就是 0）；
 *      · `full` 的 `rects/px > 0` —— 旧路径没被掏空。
 *     · 有人把默认改回 `soft/full` ⇒ ① 红；
 *     · 有人删掉 `full` 分支 ⇒ ② 红；
 *     · 有人把线条加回默认 ⇒ ⑤ `rects===0` 红；
 *     · 有人漏传 `walkable` ⇒ ⑤ `shade>0` 红。
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
      (st ? ` · 边带 mode=${st.mode} rects=${st.rects} px=${st.px} artSkip=${st.artSkip} shade=${st.shade}` : ' · 边带 stats=(无)'),
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
    const SH = await capture(send, evaluate, '&devband=shade', '?devband=shade');
    const S = await capture(send, evaluate, '&devband=soft', '?devband=soft');
    const F = await capture(send, evaluate, '&devband=full', '?devband=full');
    const O = await capture(send, evaluate, '&devband=off', '?devband=off');

    if (!A || !A2 || !SH || !S || !F || !O) {
      PASS(false, '六条臂中有量不到的 ⇒ 无法判（见上）');
      return;
    }
    const floor = diffBlocks(A.blocks, A2.blocks);
    const ash = diffBlocks(A.blocks, SH.blocks);
    const as = diffBlocks(A.blocks, S.blocks);
    const af = diffBlocks(A.blocks, F.blocks);
    const ao = diffBlocks(A.blocks, O.blocks);
    console.log(
      `--- 逐块差（单位=块，分母=${A.blocks.bw * A.blocks.bh}）： 本底(default vs default#2) → ${floor}；` +
        ` default vs shade → ${ash}； vs soft → ${as}； vs full → ${af}； vs off → ${ao}`,
    );

    if (MEASURE) {
      console.log('（--measure：只打印，不判）');
      return;
    }

    const NOISE_MARGIN = 40; // 块 · 分母 6705 ⇒ 0.60% · 每跑
    const SIGNAL_MIN = 200; // 块 · 分母 6705 ⇒ 2.98% · 每跑·每模式对（`haloflip` 同值）
    const K = 10; // 信号 / 本底 的倍数下限
    const sound = Math.max(K * Math.abs(floor), SIGNAL_MIN);
    /* `off` 这一臂**只关边带、保留蓝洗** ⇒ 与默认的差就是"压暗那一层"本身，
     * 面积比 full 小得多；门槛沿用"显著高于本底"而不是 SIGNAL_MIN。 */
    const OFF_MIN = Math.max(3 * Math.abs(floor), 24); // 块 · 分母 6705 ⇒ 0.36%
    console.log(`    判据： ① 须 ≤ ${floor} + ${NOISE_MARGIN} = ${floor + NOISE_MARGIN}； ② 须 ≥ ${sound}； ③ 须 ≥ ${OFF_MIN}`);

    /* ⚠️ 每条都并验**那一臂自己解析成了什么 mode**（`__bandStats.mode`）：
     *   NEG 实测踩到的坑：改默认时若解析器把某个词一起漏掉，对照臂会**回落成默认**
     *   ⇒ 两臂同色 ⇒ 差=0 ⇒ 判据假绿（"对照臂被吞"）。 */
    PASS(
      ash <= Math.max(floor, 0) + NOISE_MARGIN && !!SH.st && SH.st.mode === 'shade',
      `① default ≡ ?devband=shade（${ash} ≤ ${Math.max(floor, 0) + NOISE_MARGIN}，且 shade 臂 mode=${SH.st ? SH.st.mode : '(无)'}）—— 证"默认 == shade"`,
    );
    PASS(
      af >= sound && !!F.st && F.st.mode === 'full',
      `② default ≠ ?devband=full（${af} ≥ ${sound}，且 full 臂 mode=${F.st ? F.st.mode : '(无)'}）—— 证"旧路径可达且不等价"`,
    );
    PASS(
      ao >= OFF_MIN && !!O.st && O.st.mode === 'off',
      `③ default ≠ ?devband=off（${ao} ≥ ${OFF_MIN}，且 off 臂 mode=${O.st ? O.st.mode : '(无)'}）—— 证"压暗那一层真的在画"`,
    );
    PASS(
      !!S.st && S.st.mode === 'soft' && as >= OFF_MIN,
      `④ ?devband=soft 仍在且与默认不同（mode=${S.st ? S.st.mode : '(无)'}，${as} ≥ ${OFF_MIN} 块）—— 上一版形态可复现`,
    );

    /* ⑤ 语义判据：默认必须**一条线都不画**，但压暗格数必须 > 0。
     *   · 只删 `shade` 分支 ⇒ `shade === 0` ⇒ 红（"默认退化成只铺蓝洗"）；
     *   · 有人把线条加回默认 ⇒ `rects > 0` ⇒ 红（这正是主理人要去掉的东西）；
     *   · 有人把 `walkable` 忘了传 ⇒ `shade === 0` 或远小于全图 ⇒ 红。 */
    PASS(!!A.st && A.st.mode === 'shade', `⑤a 默认走 shade 分支（mode=${A.st ? A.st.mode : '(无)'}）`);
    PASS(!!A.st && A.st.rects === 0, `⑤b 默认一条边带都不画（rects=${A.st ? A.st.rects : '(无)'} === 0）`);
    PASS(
      !!A.st && A.st.shade > 0,
      `⑤c 外圈压暗真的落笔（shade=${A.st ? A.st.shade : '(无)'} 格 · ${A.st ? A.st.shadePx : '?'} 世界 px²）`,
    );
    PASS(!!F.st && F.st.rects > 0 && F.st.px > 0, `⑤d full 旧路径仍画边带（rects=${F.st ? F.st.rects : '(无)'} · px=${F.st ? F.st.px : '(无)'}）`);
  });
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  process.exit(e && e.prerequisite ? 2 : 1);
}

console.log('---------------------------------------------');
console.log(bad === 0 ? '[总结] 全过' : `[总结] FAIL ${bad} 条`);
process.exit(bad === 0 ? 0 : 1);
