#!/usr/bin/env node
/**
 * haloflip.mjs —— 「翻默认」的**两向**机检门（team-lead 裁定 ①，`engineering-lead`）。
 *
 * ## 为什么要有这把尺（起因：一条"只证一向"的门）
 * `68533f7` 把 `HALO_AFTER` 由 `=== '1'` 翻成 `!== '0'`（默认开）。当时我给的证据是
 * **注释里的"静态等价"说明** —— 那只证了 **(a) 默认已翻**，**没证 (b) 旧路径还能取回**。
 * team-lead 升格为规矩：
 * > **凡"把某开关翻成默认"，必须同时留一条可复现的旧路径。**
 * 理由（照抄其裁定）：**新对照臂 = `default` vs `?devhaloafter=0`**；**若回退路径不存在或不等价
 * ⇒ 新臂退化成 `on vs on` ⇒ 又变回「对照臂被吞」** ⇒ 整个 A/B 成了恒等式。
 *
 * ## 本门的两条断言（**缺一不可**，且都锚在像素上）
 *   ① **`default` ≡ `?devhaloafter=1`**（逐块同）—— 证"默认 == 开"。
 *   ② **`default` ≠ `?devhaloafter=0`**（逐块**至少有一块不同**）—— 证"旧路径可达**且不等价**"。
 * ⇒ **两向可证**：
 *   · 若有人把默认改回 `=== '1'` ⇒ `default` 与 `=0` **都关** ⇒ ② **红**；
 *   · 若有人删掉回退（写死 `true`）⇒ `=0` 也开 ⇒ ② **红**；
 *   · 若有人把默认写死 `false`（等于没翻）⇒ ① **红**。
 *   **三向都躲不过** —— 这才叫"门"，不是"墙"。
 *
 * ## 口径（与既有通道对齐，不自创）
 *   · 视口 = **真机 792×320 @DPR3**（`deviceshot.mjs` 记的 OPPO PMA110 实测值）。
 *   · URL 基线 = `deviceshot.mjs` 例子里那条（`devquick/devsize/devseed/devreveal/devlight`）。
 *   · **`devhaloafter` 只在"染色层开"时才有意义** ⇒ **基线里不得带 `?devtint=0`**
 *     （带了 ⇒ 整个染色层关 ⇒ 两条边带都不画 ⇒ 三个 mode 逐块全同 ⇒ 假阴性）。
 *   · **冻帧**：等 toast 退场（≈4s）后再冻 —— 注入把 `performance.now()` 打平 + 停 `rAF`，
 *     然后连量两次，**两次必须逐块同**（否则"冻帧没成功"，读数不作数）。
 *   · 比较用 **16×16 分块 FNV**（不是整图哈希）：既省传输，又能报"**多少块不同**"，
 *     不会出现"A≠C 但不知道差在哪、差多少"。
 *
 * ## 用法
 *   node tools/haloflip.mjs                      # 量 ./dist（自起服务，空闲端口）
 *   node tools/haloflip.mjs --dist=/tmp/dist-xxx # 量隔离构建
 *
 * 退出码：0 = 两向皆过 · 1 = 有一条不过（含"两臂分不开"）· 2 = 前置不满足
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { distDir, printHeader, requireFile, freePort, serveInProcess } from './_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from './_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=haloflip');

/* ---------------------------------------------------------------- 前置 */
const MAPJS = path.join(DIST, 'render', 'MapRenderer.js');
requireFile(DIST, 'render/MapRenderer.js');
if (!readFileSync(MAPJS, 'utf8').includes('devhaloafter')) {
  console.error('✗ 前置不满足：构建的 render/MapRenderer.js 不含 `devhaloafter` ⇒ 这份构建早于该旗标。');
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
  `http://127.0.0.1:${PORT}/?devquick=0&devsize=medium&devseed=20260917&devreveal=1&devlight=0.22`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const PASS = (c, m) => { if (!c) bad++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`); };

/** 页面内：停 rAF + 把 performance.now 打平（冻帧）；量 16×16 分块 FNV。 */
const FREEZE = `(() => {
  if (!window.__haloflipFrozen) {
    const t0 = performance.now();
    try { performance.now = () => t0; } catch (e) {}
    window.requestAnimationFrame = () => 0;
    window.__haloflipFrozen = true;
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
  await sleep(4200); // 等 #hint 启动 toast 退场（≈1.5s 出现、~3.5s 消）⇒ 三臂同一状态
  await evaluate(FREEZE);
  await sleep(500);
  const b1 = await evaluate(BLOCKS);
  await sleep(400);
  const b2 = await evaluate(BLOCKS);
  if (!b1 || !b1.ok) { console.log(`[${label}] 量不到：${b1 ? b1.reason : 'null'}`); return null; }
  const stable = diffBlocks(b1, b2) === 0;
  console.log(`[${label}] canvas ${b1.w}×${b1.h} · 块 ${b1.bw}×${b1.bh} · 冻帧后两次差异块 = ${diffBlocks(b1, b2)}`);
  PASS(stable, `${label} 冻帧稳定（连量两次逐块同）`);
  return b1;
}

try {
  await withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Emulation.setDeviceMetricsOverride', { width: 792, height: 320, deviceScaleFactor: 3, mobile: true });
    /* 冻帧①：在 main.js 跑之前就把 performance.now 打平（照抄 deviceshot 的做法）。
     * ★ 并注入隐藏 `#hint` 的 CSS（**四臂对称**，故相消）：启动 toast 的淡入淡出走的是
     *   **渲染时钟**（不是 performance.now）⇒ 抓帧时刻的 ±抖动会漏进像素 ⇒ 就是本门
     *   首版 NEG2 那次「27 块"假差异"」的来源。`deviceshot.mjs` 已实测：**同配置隐藏 = 0/0**。 */
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source:
        `(() => { const t0 = performance.now(); try { performance.now = () => t0; } catch (e) {}` +
        ` const add = () => { const s = document.createElement('style'); s.textContent = '#hint{display:none !important}';` +
        ` (document.head || document.documentElement).appendChild(s); };` +
        ` if (document.head) add(); else document.addEventListener('DOMContentLoaded', add); })();`,
    });

    /* ★ 预热丢弃（照抄 deviceshot 的"预热帧"做法，但这里扔的是**整个导航**）：
     *   实测噪声本底恒为 **27 块**、且**每次都是同样的 27 块** ⇒ 说明差异来自"**首次导航** vs 后续导航"
     *   （冷/热状态：图集或字形缓存等），**不是**随机抖动。丢掉首次导航后，四条正式臂全在"热"态。 */
    await capture(send, evaluate, '', 'warmup(丢弃)');
    const A = await capture(send, evaluate, '', 'default');
    /* ★ 安慰剂臂（placebo）：**同 URL 再抓一次** —— 用来量出**导航噪声本底**。
     *   没有它，② 的判据 `>0` 会被噪声满足 ⇒ **"回退被吞"也能变绿**（本门首版 NEG2 实测到）。 */
    const A2 = await capture(send, evaluate, '', 'default#2(placebo)');
    const B = await capture(send, evaluate, '&devhaloafter=1', '?devhaloafter=1');
    const C = await capture(send, evaluate, '&devhaloafter=0', '?devhaloafter=0');

    if (A && A2 && B && C) {
      /* ★ 判据带**安全系数**，不用 `> floor` 的刀刃式比较：
       *   实测（三次运行）**信号 ≈ 676–678 块**（真差异）而**噪声本底在 0–28 块之间波动**
       *   ⇒ 刀刃式 `ac > floor` 在"噪声 30 / 信号 29"时会给假绿（NEG1 的 ② 实测到 29 vs 28，只赢 1 块）。
       *   ⇒ 改用：**噪声侧留余量 `NOISE_MARGIN`**、**信号侧要够一个数量级 `SIGNAL_MIN`**。
       *   ⚠️ **这两个阈值是 `engineering-lead` 的提议值、待主理人按数核定**（阈值的归属是主理人）。 */
      /* ★ 阈值必须**带单位 + 分母 + 口径**（`engineering-lead-2` 2026-09-21 指出：两个裸常量
       *   会变成下一个"无标签数"）。三样如下：
       *     单位 = **块**（16×16 px 分块）；分母 = **6705 块**（= 149×45；画布 2376×720 = 792×320@DPR3）；
       *     口径 = **每跑**（同一次进程内的 4 次导航 A / A2 / B / C），② 是"每跑·每模式对"。
       *   判据形（采纳「信号 ≥ 本底 × k」而不是两个裸常量）：
       *     ① diff(A,B) ≤ floor + NOISE_MARGIN
       *     ② diff(A,C) ≥ max(K × floor, SIGNAL_MIN)   —— K × floor 相对本底留倍数余量
       *   实测锚点：floor **0–28** 块、信号 **676 / 678** 块 ⇒ 比值 **≥24×**，K=10 有余量。
       *   ⚠️ **本底为何不是 0**：`haloflip` 已在 main.js 之前把 `performance.now()` 钉成常数并停 `rAF`，
       *     仍漂 0–28 ⇒ **成因未定**（候选：合成/文字光栅时刻、或隐藏 `#hint` 那一步）——
       *     **不写成"钉时钟就好"**；靠安慰剂臂 `floor` 吃掉它。 */
      const NOISE_MARGIN = 40; // 块 · 分母 6705 ⇒ 0.60% · 每跑
      const SIGNAL_MIN = 200;  // 块 · 分母 6705 ⇒ 2.98% · 每跑·每模式对
      const K = 10;            // 信号 / 本底 的倍数下限（实测 ≥24×）
      const floor = diffBlocks(A, A2);
      const ab = diffBlocks(A, B), ac = diffBlocks(A, C);
      console.log(`--- 逐块差（单位=块，分母=${A.bw * A.bh}）： 本底(default vs default#2) → ${floor}； default vs =1 → ${ab}； default vs =0 → ${ac}`);
      const sound = Math.max(K * floor, SIGNAL_MIN);
      console.log(`    判据： ① 须 ≤ ${floor} + ${NOISE_MARGIN} = ${floor + NOISE_MARGIN}； ② 须 ≥ max(${K}×${floor}, ${SIGNAL_MIN}) = ${sound}`);
      PASS(ab <= floor + NOISE_MARGIN, `① default ≡ ?devhaloafter=1（${ab} ≤ ${floor + NOISE_MARGIN}）—— 证"默认 == 开"`);
      PASS(ac >= sound, `② default ≠ ?devhaloafter=0（${ac} ≥ ${sound}）—— 证"旧路径可达且不等价"`);
      if (ac < sound) {
        console.log('   ⚠️ 两臂分不开（差异不够大）：**不是"门绿"，是"尺瞎或回退被吞"**。');
        console.log('      两种成因要分开看：(a) 本场景没画染色层（边带没画）⇒ 假阴性；');
        console.log('                        (b) 回退路径被吞（默认与 =0 同为开）⇒ **真缺陷**。');
      }
    } else {
      PASS(false, '四条臂中有量不到的 ⇒ 无法判（见上）');
    }
  });
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  process.exit(e && e.prerequisite ? 2 : 1);
}

console.log('---------------------------------------------');
console.log(bad === 0 ? '[总结] 两向皆过' : `[总结] FAIL ${bad} 条`);
process.exit(bad === 0 ? 0 : 1);
