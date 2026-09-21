#!/usr/bin/env node
/**
 * tintab.mjs —— ④ 可达染色「净贡献」对照台　(owner: engineering-lead-2)
 *
 * ## 量什么
 * 染色对**最终画面**的净贡献 = 同像素「画染色 / 不画染色」之差。
 *
 * 为什么不用整图 `imagecmp`：`devlight` 的 multiply 会把每像素都压暗，
 * 整图平均 ΔL* 里绝大部分是**光照**、不是染色（实测全图 8.4~8.9 |ΔL*| / 67.9% 变化像素）。
 *
 * ## 怎么量（同会话逐模式切换）
 * CDP 注入 `CanvasRenderingContext2D.prototype.fillRect` 钩子，在同一次页面会话里
 * 逐模式切 `full / none / edge / reach` ⇒ **同水面动画、同相机**，逐像素差 = 该条染色的净贡献。
 *   blue(fill) 净贡献 = |reach版 − none版|
 *   red(edge)  净贡献 = |edge 版 − none版|
 *
 * ## 报什么（四列并陈 —— **单看任何一把尺子都会判糊**）
 *   ΔL*        明度差（cartoon-style §3.1.1 尺子用它；但它**只量明度**）
 *   ΔE*ab      普通视觉感知色差（CIE76）—— 本染色的线索**主要靠色相**，ΔL* 会低估
 *   色盲 ΔL*   Machado deuteranopia(1.0) 模拟后的明度差（a11y 代理：色相塌掉后还剩多少）
 *   WCAG       相对亮度对比度（3:1 门限）
 *
 * ## population **必填**
 * 每个数都必须能回答"在哪批像素上"。`--pop=list` 看可选项。
 * 依据：2026-09-21 出过「同一个量、两个 population、两个结论（1.89 vs 5.09）」。
 * 覆盖判据按**通道差**判「染色有没有盖到该像素」——**不得用 |ΔL*| 阈值筛人口**
 * （那是拿结果筛人口，会把均值抬成假高值；5.09 的病根）。
 *
 * ## 用法
 *   node tools/tintab.mjs --pop=uniform-grass
 *   node tools/tintab.mjs --pop=uniform-grass,sand --phase=0.22,0.68
 *   node tools/tintab.mjs --pop=list
 *
 * 前置：另开终端 `node tools/serve.mjs`（本脚本会探活，没有就 exit 2）。
 * 染色常量**从源码解析、不写死**：MapRenderer 改了名字/颜色，钩子自动跟。
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { withHeadlessChrome, checkDevServer } from './_chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ 参数 */

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
}

const POPS = ['uniform-grass', 'grass', 'all', 'sand', 'water', 'rock', 'dark'];
const popArg = arg('pop', '');
if (popArg === 'list' || !popArg) {
  console.error(`population 必填。可用：${POPS.join(' | ')}　（多个用逗号）\n例：node tools/tintab.mjs --pop=uniform-grass`);
  process.exit(popArg ? 0 : 2);
}
const requestedPops = popArg.split(',').map((s) => s.trim()).filter(Boolean);
for (const p of requestedPops) {
  if (!POPS.includes(p)) { console.error(`未知 population「${p}」。可用：${POPS.join(' | ')}`); process.exit(2); }
}
const PHASES = arg('phase', '0.22,0.68').split(',').map((s) => s.trim());
const SEED = arg('seed', '20260917');
const SIZE = arg('size', 'medium');
const PORT = Number(arg('port', '5173'));
const OUT = arg('out', '/tmp/tintab');
// 视口：画布高 = Emulation 高 − 页头/底栏。757 ⇒ 画布 1280×677 —— 与 2026-09-21 复核通过
// 的那批数同视口（避免"换视口=换 population 构成=又一组数"）。改视口请显式传 --vh 并在报告里写明。
const VH = Number(arg('vh', '757'));

/* ---------------------------------------------------- 溯源：从源码解析染色常量 */

function tintConsts() {
  const src = readFileSync(path.join(ROOT, 'src/render/MapRenderer.ts'), 'utf8');
  const out = [];
  const re = /const\s+(\w+)\s*=\s*'(rgba?\([^)]*\))'/g;
  let m;
  while ((m = re.exec(src))) {
    const [, name, rgba] = m;
    if (!/(REACH|NOGO)/i.test(name)) continue; // 可达染色的命名约定
    out.push({ name, rgba: rgba.replace(/\s+/g, ''), kind: /NOGO|EDGE/i.test(name) ? 'edge' : 'fill' });
  }
  return out;
}
const TINTS = tintConsts();
if (!TINTS.length) {
  console.error('在 src/render/MapRenderer.ts 里解析不到 REACH_*/NOGO_* 的 rgba 常量 —— 本脚本刻意不写死颜色，请核对命名约定。');
  process.exit(2);
}
const FILL = TINTS.filter((t) => t.kind === 'fill');
const EDGE = TINTS.filter((t) => t.kind === 'edge');
if (!FILL.length || !EDGE.length) {
  console.error(`染色常量分类异常：fill=[${FILL.map((t) => t.name)}] edge=[${EDGE.map((t) => t.name)}]`);
  process.exit(2);
}
const distMtime = (() => { try { return statSync(path.join(ROOT, 'dist/render/MapRenderer.js')).mtime.toISOString(); } catch { return '(无 dist)'; } })();

/* ------------------------------------------------------------------ 色彩数学 */

const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const Lp = (r, g, b) => { const Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y; };
const Yof = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const wcag = (y1, y2) => { const a = Math.max(y1, y2), b = Math.min(y1, y2); return (a + 0.05) / (b + 0.05); };
function lab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const dE = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
// 红绿色盲模拟（Machado 2009, deuteranopia severity 1.0）
const DEUT = [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]];
const cl255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const deut = (r, g, b) => [
  cl255(DEUT[0][0] * r + DEUT[0][1] * g + DEUT[0][2] * b),
  cl255(DEUT[1][0] * r + DEUT[1][1] * g + DEUT[1][2] * b),
  cl255(DEUT[2][0] * r + DEUT[2][1] * g + DEUT[2][2] * b),
];

function classify(r, g, b) {
  if (Lp(r, g, b) < 22) return 'dark';
  if (b - r >= 15) return 'water';
  if (g - b >= 15 && g >= r - 10) return 'grass';
  if (r - b >= 25 && r >= g) return 'sand';
  return 'rock';
}
const f2 = (v) => Number(v).toFixed(2);

/* ------------------------------------------------------------------ 抓图 */

const HOOK = `(() => {
  const FILL = ${JSON.stringify(FILL.map((t) => t.rgba))};
  const EDGE = ${JSON.stringify(EDGE.map((t) => t.rgba))};
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.fillRect;
  window.__tintSkip = { fill: false, edge: false };
  window.__tintHits = { fill: 0, edge: 0 };
  proto.fillRect = function (...a) {
    const fs = (typeof this.fillStyle === 'string') ? this.fillStyle.replace(/\\s+/g, '') : '';
    const isFill = FILL.includes(fs), isEdge = EDGE.includes(fs);
    if (isFill) window.__tintHits.fill++;
    else if (isEdge) window.__tintHits.edge++;
    if ((isFill && window.__tintSkip.fill) || (isEdge && window.__tintSkip.edge)) return;
    return orig.apply(this, a);
  };
})();`;

const MODES = {
  full: { fill: false, edge: false },
  none: { fill: true, edge: true },
  edge: { fill: true, edge: false },
  reach: { fill: false, edge: true },
};

async function captureAll() {
  return withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: VH, deviceScaleFactor: 1, mobile: false });
    const shots = {};
    for (const ph of PHASES) {
      const url = `http://127.0.0.1:${PORT}/?devquick=0&devsize=${SIZE}&devseed=${SEED}`
        + `&devreveal=1&devprobe=1&devlight=${ph}`;
      await send('Page.navigate', { url });
      // 等游戏就绪 + 钩子在场
      for (let i = 0; i < 200; i++) {
        const ok = await evaluate('!!(window.__journey && window.__journey() && window.__journey().heroPos && document.querySelector("canvas") && window.__tintSkip)').catch(() => false);
        if (ok) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await evaluate('new Promise(r=>{let i=0;const s=()=>(++i>=30?r():requestAnimationFrame(s));requestAnimationFrame(s)})');
      const meta = await evaluate('(()=>{const c=document.querySelector("canvas");const j=window.__journey();return {canvas:{w:c.width,h:c.height},dpr:c.width/c.clientWidth,hero:j.heroPos,cam:{x:j.cam.x,y:j.cam.y,zoom:j.cam.zoom}}})()');
      shots[ph] = { meta, modes: {} };
      for (const [mode, skip] of Object.entries(MODES)) {
        await evaluate(`window.__tintSkip = ${JSON.stringify(skip)}`);
        await evaluate('new Promise(r=>{let i=0;const s=()=>(++i>=3?r():requestAnimationFrame(s));requestAnimationFrame(s)})');
        const s = await send('Page.captureScreenshot', { format: 'png' });
        shots[ph].modes[mode] = Buffer.from(s.data, 'base64');
      }
      shots[ph].hits = await evaluate('window.__tintHits');
    }
    return shots;
  }, { devServerPort: PORT, profilePrefix: 'tintab-' });
}

/* ------------------------------------------------------------------ 计算 */

async function raw(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: data, w: info.width, h: info.height, c: info.channels };
}

async function analyze(ph, shot) {
  const { meta, modes } = shot;
  const B = await raw(modes.none), C = await raw(modes.edge), D = await raw(modes.reach);
  const W = B.w, H = B.h, N = W * H, C4 = B.c;
  const gy0 = 42, gy1 = Math.min(720, H);

  const cls = new Uint8Array(N);
  const CODE = { dark: 0, water: 1, grass: 2, sand: 3, rock: 4 };
  for (let i = 0; i < N; i++) { const o = i * C4; cls[i] = CODE[classify(B.d[o], B.d[o + 1], B.d[o + 2])]; }
  const uniform = new Uint8Array(N);
  for (let y = gy0; y < gy1; y++) for (let x = 0; x < W; x++) {
    const c0 = cls[y * W + x]; let ok = 1;
    for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      if (cls[yy * W + xx] !== c0) { ok = 0; break; }
    }
    uniform[y * W + x] = ok;
  }

  const popMask = (which) => {
    if (which === 'all') return () => true;
    if (which === 'uniform-grass') return (i) => cls[i] === 2 && uniform[i];
    const code = CODE[which]; return (i) => cls[i] === code;
  };

  function row(family, withImg, pop) {
    const mask = popMask(pop);
    const Ls = [], Es = [], Cs = [];
    let n = 0, sw = 0;
    for (let y = gy0; y < gy1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, o = i * C4;
      const r0 = B.d[o], g0 = B.d[o + 1], b0 = B.d[o + 2];
      const r1 = withImg.d[o], g1 = withImg.d[o + 1], b1 = withImg.d[o + 2];
      // 覆盖判据 = 通道差（**不得**用 |ΔL*| 筛人口）
      if (Math.abs(r1 - r0) <= 4 && Math.abs(g1 - g0) <= 4 && Math.abs(b1 - b0) <= 4) continue;
      if (!mask(i)) continue;
      Ls.push(Math.abs(Lp(r1, g1, b1) - Lp(r0, g0, b0)));
      Es.push(dE(lab(r1, g1, b1), lab(r0, g0, b0)));
      const [cr1, cg1, cb1] = deut(r1, g1, b1), [cr0, cg0, cb0] = deut(r0, g0, b0);
      Cs.push(Math.abs(Lp(cr1, cg1, cb1) - Lp(cr0, cg0, cb0)));
      sw += wcag(Yof(r1, g1, b1), Yof(r0, g0, b0));
      n++;
    }
    const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[(a.length - 1) >> 1] : NaN);
    const pct = (a, t) => (a.length ? (100 * a.filter((v) => v < t).length) / a.length : NaN);
    return { family, pop, n, L: med(Ls), E: med(Es), C: med(Cs), cvdBelow: pct(Cs, 2.22), wcag: n ? sw / n : NaN };
  }

  const out = [];
  for (const p of requestedPops) {
    out.push(row('蓝fill', D, p));
    out.push(row('红缘', C, p));
  }
  return { meta, out, hits: shot.hits };
}

/* ------------------------------------------------------------------ 主流程 */

(async () => {
  const probe = await checkDevServer(PORT);
  if (!probe.ok) { console.error(probe.reason); process.exit(2); }

  console.log('=== ④ 可达染色净贡献对照（tintab.mjs） ===');
  console.log(`构建绑定 : dist/render/MapRenderer.js mtime = ${distMtime}`);
  console.log(`染色常量 : ${TINTS.map((t) => `${t.name}=${t.rgba}(${t.kind})`).join('  ')}`);
  console.log(`场景     : seed=${SEED} size=${SIZE} devreveal=1 视口 1280x${VH}(emulation, dpr1) ⇒ 画布 1280x${VH - 80}`);
  console.log(`相位     : ${PHASES.join(', ')}　（0=清晨 0.22=正午 0.5=黄昏 0.68=深夜）`);
  console.log(`population: ${requestedPops.join(', ')}`);
  console.log('口径     : 净贡献=同像素「画/不画」逐像素差；覆盖判据=通道差；ΔE=CIE76；色盲=Machado deuteranopia(1.0)');
  console.log('');

  mkdirSync(OUT, { recursive: true });
  const shots = await captureAll();

  for (const ph of PHASES) {
    const shot = shots[ph];
    for (const [mode, buf] of Object.entries(shot.modes)) writeFileSync(path.join(OUT, `tint_${ph}_${mode}.png`), buf);
    const { meta, out } = await analyze(ph, shot);
    console.log(`########## devlight=${ph}  canvas ${meta.canvas.w}x${meta.canvas.h} dpr ${meta.dpr} zoom ${meta.zoom} hero(${meta.hero.x},${meta.hero.y})`);
    console.log(`  fillRect 命中：fill×${shot.hits.fill}  edge×${shot.hits.edge}`);
    console.log('  族    | population      | 像素数 | ΔL*中位 | ΔE*ab中位 | 色盲ΔL*中位 | 色盲<2.22 | WCAG');
    for (const r of out) {
      console.log(`  ${r.family.padEnd(5)} | ${r.pop.padEnd(15)} | ${String(r.n).padStart(6)} | ${f2(r.L).padStart(7)} | ${f2(r.E).padStart(9)} | ${f2(r.C).padStart(10)} | ${(Number.isFinite(r.cvdBelow) ? r.cvdBelow.toFixed(0) + '%' : '-').padStart(8)} | ${f2(r.wcag)}`);
    }
    console.log('');
  }
  console.log(`PNG 输出：${OUT}/tint_<phase>_<full|none|edge|reach>.png`);
})().catch((e) => {
  console.error(e.message);
  process.exit(e.prerequisite ? 2 : 1);
});
