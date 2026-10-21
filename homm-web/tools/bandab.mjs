#!/usr/bin/env node
/**
 * bandab.mjs —— ④ 可达边界带「形态」对照台（`?devband=full|thin|art|soft|off`）。
 *
 * ## 它回答什么
 * 真机走查里主理人的一句话：**「英雄能走的地方跟树/水/山之间有直线来分割，很遮挡感官」**。
 * 那条线是 ④ 的三色边带（红 2px + 亮芯 2px + 墨 2px），1×1 的树四侧全贴可达区 ⇒ 一只闭合方框。
 * 本工具出**同构建 / 同会话 / 同帧**的四臂对照，让"厚薄"与"作用域"两刀各自可归因：
 *   · `full`（默认＝现网） · `thin`（只换厚度/色栈） · `art`（只换作用域） · `soft`（两刀同下）
 *
 * ## 口径（不自创，照抄既有通道）
 *   · 视口 = 真机 792×320 @DPR3（`deviceshot.mjs` 记的 OPPO PMA110 实测值）；
 *   · URL 基线 = `haloflip.mjs` 那条（`devquick/devsize/devseed/devreveal/devlight`），**不带 `devtint=0`**
 *     （带了 ⇒ 整层不画 ⇒ 四臂全同 ⇒ 假阴性）；
 *   · **时钟注入在导航之前**（`performance.now` 钉成常数 + 隐藏 `#hint`）⇒ 水面 4 帧相位、起点 toast
 *     在四臂之间**对称**；抓帧前后再停 `rAF`，连量两次必须逐块同（否则"冻帧没成功"，读数不作数）；
 *   · 比较用 16×16 分块 FNV（能报"多少块不同"，不是整图一个哈希）。
 *
 * ## 用法
 *   node tools/bandab.mjs --out=/tmp/band          # 四臂 PNG + 分块读数
 *   node tools/bandab.mjs --hash --dist=/tmp/dist-old   # 只打印指纹（用于"默认臂逐字节不变"的回溯）
 *
 * 退出码：0 = 全部量到 · 1 = 有臂量不到 · 2 = 前置不满足
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { distDir, printHeader, requireFile, freePort, serveInProcess, argOf } from './_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from './_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'tool=bandab');
requireFile(DIST, 'render/MapRenderer.js');
if (!chromeAvailable()) {
  console.error('✗ 前置不满足：找不到 Chrome（可用 env CHROME 覆盖）。');
  process.exit(2);
}

const OUT = argOf('out', null);
const HASH_ONLY = process.argv.includes('--hash');
const VW = Number(argOf('vw', '792'));
const VH = Number(argOf('vh', '320'));
const DPR = Number(argOf('dpr', '3'));
const ARMS = (argOf('arms', 'full,thin,art,soft') || '').split(',').filter(Boolean);
const EXTRA = argOf('extra', '') || '';
/* `--base=<url>` = 直接给基址（用于复现"教学场"这类不靠 `devquick` 的图）；
 * 给了它就不再加那串 dev 基线参数。 */
const BASE_OVERRIDE = argOf('base', null);
/* `--fresh` ＝ 每次导航前清空 localStorage ⇒ 回到"首启"（教学场只在首启进）。
 * 用途：教学场这张图**只能被第一个导航拿到**，之后存档一存，后面几臂全变成开始页（实测四臂 sum 全同 = 假对照）。 */
const FRESH = process.argv.includes('--fresh');
if (OUT) mkdirSync(OUT, { recursive: true });

const PORT = await freePort();
if (!(await serveInProcess(DIST, PORT))) {
  console.error(`✗ 前置不满足：自起 dev server 未就绪（port ${PORT}）。`);
  process.exit(2);
}
const BASE = BASE_OVERRIDE
  ? BASE_OVERRIDE.startsWith('/')
    ? `http://127.0.0.1:${PORT}${BASE_OVERRIDE}`
    : BASE_OVERRIDE
  : `http://127.0.0.1:${PORT}/?devquick=0&devsize=medium&devseed=20260917&devreveal=1&devlight=0.22` + EXTRA;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ★ 时钟钉在**固定常数**（不是"导航那一刻的 t0"）：水面 4 帧相位、英雄起伏都读
 *   `performance.now()`，若钉成 t0（每次导航 0~20ms 不等）⇒ **同内容两跑也可能差一格相位**
 *   ⇒ 指纹不可复现（本工具首版实测：同 URL 两次 sum 不同，1582114639 vs 1974697513）。
 *   钉常数后，四臂 / 两次跑 / 两份构建都在同一时刻取景。 */
const FIXED_NOW = 1000;
const FREEZE = `(() => {
  if (!window.__bandAbFrozen) {
    try { performance.now = () => ${FIXED_NOW}; } catch (e) {}
    window.requestAnimationFrame = () => 0;
    window.__bandAbFrozen = true;
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
  let sum = 0;
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
      sum = (sum + h) % 4294967296;
    }
  }
  return { ok: true, w: W, h: H, bw, bh, sum, blocks: out };
})()`;

const diffBlocks = (a, b) => {
  if (!a || !b || a.bw !== b.bw || a.bh !== b.bh) return -1;
  let n = 0;
  for (let i = 0; i < a.blocks.length; i++) if (a.blocks[i] !== b.blocks[i]) n++;
  return n;
};

let bad = 0;
const PASS = (c, m) => { if (!c) bad++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`); };

try {
  await withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width: VW, height: VH, deviceScaleFactor: DPR, mobile: true,
    });
    // 时钟注入 + 隐藏 #hint：必须在 main.js 之前（四臂对称，故相消）
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source:
        `(() => { try { performance.now = () => ${FIXED_NOW}; } catch (e) {}` +
        ` const add = () => { const s = document.createElement('style'); s.textContent = '#hint{display:none !important}';` +
        ` (document.head || document.documentElement).appendChild(s); };` +
        ` if (document.head) add(); else document.addEventListener('DOMContentLoaded', add); })();`,
    });
    if (FRESH) {
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} })();`,
      });
    }
    if (FRESH) {
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} })();`,
      });
    }

    async function capture(arm) {
      // 拼接符按 BASE 里有没有 `?` 决定 —— `--base='/'` 时若硬写 `&` 会把参数拼进**路径**
      // ⇒ 四臂拿同一个 URL ⇒ 假对照（本工具首版实测：四臂 sum 全同）。
      const sep = BASE.includes('?') ? '&' : '?';
      const url = BASE + (arm === 'default' ? '' : `${sep}devband=${arm}`);
      await send('Page.navigate', { url });
      let ready = false;
      for (let i = 0; i < 80; i++) {
        await sleep(120);
        try {
          ready = await evaluate(`(() => { const c = document.querySelector('canvas'); return !!c && c.width > 0 && c.height > 0; })()`);
          if (ready) break;
        } catch { /* 导航中 */ }
      }
      if (!ready) { console.log(`[${arm}] 量不到：canvas 一直没起来`); return null; }
      await sleep(900);
      await evaluate(FREEZE);
      await sleep(350);
      const b1 = await evaluate(BLOCKS);
      await sleep(250);
      const b2 = await evaluate(BLOCKS);
      if (!b1 || !b1.ok) { console.log(`[${arm}] 量不到：${b1 ? b1.reason : 'null'}`); return null; }
      const d12 = diffBlocks(b1, b2);
      console.log(`[${arm}] canvas ${b1.w}×${b1.h} · 块 ${b1.bw}×${b1.bh} · 冻帧两次差异 ${d12} · sum=${b1.sum}`);
      PASS(d12 === 0, `${arm} 冻帧稳定`);
      if (!HASH_ONLY && OUT) {
        const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
        const file = path.join(OUT, `band-${arm}.png`);
        writeFileSync(file, Buffer.from(shot.data, 'base64'));
        console.log(`   → ${file}`);
      }
      return b1;
    }

    await capture('warmup'); // 预热丢弃（首导航是冷态，噪声本底 27 块，见 haloflip）
    const res = {};
    for (const a of (HASH_ONLY ? ['default'] : ARMS)) res[a] = await capture(a);
    if (!HASH_ONLY) {
      console.log('--- 逐块差（单位=块，分母=' + (res[ARMS[0]] ? res[ARMS[0]].bw * res[ARMS[0]].bh : '?') + '）');
      for (const a of ARMS.slice(1)) {
        if (res[a] && res[ARMS[0]]) console.log(`   ${ARMS[0]} vs ${a}: ${diffBlocks(res[ARMS[0]], res[a])}`);
      }
    }
  });
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  process.exit(e && e.prerequisite ? 2 : 1);
}

console.log(bad === 0 ? '[总结] 量到（冻帧稳定）' : `[总结] FAIL ${bad} 条`);
process.exit(bad === 0 ? 0 : 1);
