#!/usr/bin/env node
/**
 * tintab.mjs —— ④ 可达染色「净贡献」对照台（**差分口径**）　(owner: engineering-lead-2)
 *
 * ## 量什么
 * 每条染色对**最终画面**的净贡献 = 同像素「画这条 / 不画」之差。
 * 为什么不用整图 `imagecmp`：`devlight` 的 multiply 会把每像素都压暗，整图平均 ΔL* 里
 * 绝大部分是**光照**、不是染色（实测全图 8.4~8.9 |ΔL*| / 67.9% 变化像素）。
 *
 * ## 口径分工（防"同值两址"）
 *   空间口径的 3:1（「状态 vs 其底」）⇒ 独立接口 **待补**（`imagecmp.mjs --edge` 在 HEAD **不存在**，
 *   且该文件归 art-director，不由本脚本作者实现 —— 本脚本**不引用一个不存在的接口**）。
 *   差分口径 + population + ΔE*ab + 色盲 ⇒ **本脚本**。
 *   ★ 本脚本的 WCAG 列 = **A/B 差分**值（同一像素 画/不画）；**同一验收数只由一处产出**，以 team-lead 裁定为准。
 *
 * ## ★ 产出纪律：必须标明是「(α) 正测」还是「ink-off 负测」
 * 本仓出现过多例"把负测当正测引用"。本脚本每跑一次都会打印三族命中数 + src/dist 指纹；
 * **引用任何一次输出，必须连"三族命中数 + src/dist 指纹"一起引**。
 * 墨族 `ink×0` 或 `NOGO_EDGE_INK=rgba(0,0,0,0)` ⇒ **那是 ink-off 负测，不是 (α) 的数**。
 *
 * ## 怎么量（同会话逐模式切换 —— 不许跨开页）
 * CDP 注入 `CanvasRenderingContext2D.prototype.fillRect` 钩子，在**同一次页面会话**里逐模式切
 * `full / none / <只画某条>`。同会话 ⇒ 水面动画帧、相机全同；跨开页噪声会在深夜把弱信号抬高一档
 * （实测：4 开页时红缘 ΔL* 2.34，单会话 1.61）。
 *
 * ## 族（family）—— 从源码解析，颜色支持 rgba 与 hex
 * `REACH_*` ⇒ `fill`；`NOGO_*INK*` ⇒ `ink`；其余 `NOGO_*` / `*EDGE*` ⇒ `edge`。
 * 归一：把 `#rrggbb` 折成 `rgb(r,g,b)`。★ Chrome 的 fillStyle getter 对**不透明色**回报 hex、
 * 对半透明回报 rgba ⇒ **钩子侧也要归一**，否则不透明描边命中数恒为 0（静默漏一族）。
 * ★ 每条族**一次都没画到**（0 命中）⇒ **显式告警 + 非零退出**，防"改了颜色/名字、脚本静默量空"的假绿。
 *
 * ## ★ 量测前置（team-lead 规则：src≢dist 会让量测"静默量到空"）
 * `dist` 里那条常量若与 `src` 不一致（例如 dist 是某人的实验态、或 dist 比 src 旧），
 * 对着 server 量到的可能是"一条根本不画的边"。故：**逐个染色常量核 `src ≡ dist`**，
 * 不一致直接 exit 3 拒跑；并打印 src / dist 指纹，**量测前后各记一次**，中途变了 ⇒ 该组作废。
 *
 * ## 用法
 *   node tools/tintab.mjs --pop=uniform-grass
 *   node tools/tintab.mjs --pop=uniform-grass,sand --phase=0.22,0.68
 *   node tools/tintab.mjs --pop=list
 * 前置：另开终端 `node tools/serve.mjs`（会探活，没有 exit 2）。改完本文件先 `node --check`。
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
// 视口：画布高 = Emulation 高 − 页头/底栏。757 ⇒ 画布 1280×677（与 2026-09-21 复核同视口）。
const VH = Number(arg('vh', '757'));

/* --------------------------------------------------- 指纹 / 一致性（量测前置） */

const SRC_REL = 'src/render/MapRenderer.ts';
const DIST_REL = 'dist/render/MapRenderer.js';

function sha12(buf) { return createHash('sha1').update(buf).digest('hex').slice(0, 12); }
function fingerprint(rel) {
  try {
    const p = path.join(ROOT, rel);
    return { mtime: statSync(p).mtime.toISOString(), sha: sha12(readFileSync(p)) };
  } catch { return { mtime: '(缺)', sha: '(缺)' }; }
}

/** 从 ts/js 里抓 `const NAME = 'value'`（单/双引号都认）。 */
function parseConsts(rel) {
  const map = new Map();
  let src;
  try { src = readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return map; }
  const re = /const\s+(\w+)\s*=\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) map.set(m[1], m[2]);
  return map;
}

/** 浏览器 fillStyle getter 的规范形（去空格）：`#2a1a12` ⇒ `rgb(42,26,18)`。 */
function canonical(color) {
  const c = String(color).trim();
  let m;
  if ((m = /^#([0-9a-f]{3})$/i.exec(c))) {
    const p = m[1].split('').map((h) => parseInt(h + h, 16));
    return `rgb(${p[0]},${p[1]},${p[2]})`;
  }
  if ((m = /^#([0-9a-f]{6})$/i.exec(c))) {
    const n = parseInt(m[1], 16);
    return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
  }
  if ((m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c))) {
    const [, r, g, b, a] = m;
    const alpha = a === undefined ? 1 : Number(a);
    return alpha >= 1 ? `rgb(${Number(r)},${Number(g)},${Number(b)})` : `rgba(${Number(r)},${Number(g)},${Number(b)},${alpha})`;
  }
  return null;
}

const srcConsts = parseConsts(SRC_REL);
const distConsts = parseConsts(DIST_REL);

const TINTS = [];
for (const [name, raw] of srcConsts) {
  if (!/(REACH|NOGO|WALK|BLOCK)/i.test(name)) continue;
  const canon = canonical(raw);
  if (!canon) continue;
  const family = /REACH|WALK/i.test(name) ? 'fill' : /INK/i.test(name) ? 'ink' : 'edge';
  TINTS.push({ name, raw, canon, family });
}
if (!TINTS.length) {
  console.error(`在 ${SRC_REL} 里解析不到 REACH_*/NOGO_* 色值常量 —— 本脚本刻意不写死颜色，请核对命名约定。`);
  process.exit(2);
}
const BY_FAMILY = { fill: TINTS.filter((t) => t.family === 'fill'), edge: TINTS.filter((t) => t.family === 'edge'), ink: TINTS.filter((t) => t.family === 'ink') };
const FAMILIES = ['fill', 'edge', 'ink'].filter((f) => BY_FAMILY[f].length);
const LABEL = { fill: '蓝fill  ', edge: '红(内侧)', ink: '墨(外侧)' };
// 色值 alpha（0 ⇒ 事实上不画）。`src≡dist` 一致性**抓不到**这种退化：两边都写 rgba(0,0,0,0) 也算"一致"。
const alphaOf = (canon) => { const m = /,\s*([\d.]+)\s*\)$/.exec(canon); return m ? Number(m[1]) : 1; };
const TRANSPARENT = TINTS.filter((t) => alphaOf(t.canon) === 0).map((t) => t.name);

/* ---------------------------------------------------------- 色彩数学 / 分类 */

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

/* ------------------------------------------------------------------ 注入钩子 */

const HOOK = `(() => {
  const FAMILIES = ${JSON.stringify(FAMILIES)};
  const COLORS  = ${JSON.stringify(Object.fromEntries(FAMILIES.map((f) => [f, BY_FAMILY[f].map((t) => t.canon)])))};
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.fillRect;
  window.__tintSkip = {}; for (const f of FAMILIES) window.__tintSkip[f] = false;
  window.__tintHits = {}; for (const f of FAMILIES) window.__tintHits[f] = 0;
  const norm = (s) => {
    const h6 = /^#([0-9a-f]{6})$/i.exec(s);
    if (h6) { const n = parseInt(h6[1], 16); return 'rgb(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ')'; }
    const h3 = /^#([0-9a-f]{3})$/i.exec(s);
    if (h3) { const p = h3[1].split('').map((x) => parseInt(x + x, 16)); return 'rgb(' + p[0] + ',' + p[1] + ',' + p[2] + ')'; }
    return s;
  };
  proto.fillRect = function (...a) {
    const fs = norm((typeof this.fillStyle === 'string') ? this.fillStyle.replace(/\\s+/g, '') : '');
    let hit = null;
    for (const f of FAMILIES) if (COLORS[f].indexOf(fs) >= 0) { hit = f; break; }
    if (hit) {
      window.__tintHits[hit]++;
      if (window.__tintSkip[hit]) return;
    }
    return orig.apply(this, a);
  };
})();`;

const MODES = {
  full: Object.fromEntries(FAMILIES.map((f) => [f, false])),
  none: Object.fromEntries(FAMILIES.map((f) => [f, true])),
};
for (const f of FAMILIES) MODES[f] = Object.fromEntries(FAMILIES.map((g) => [g, g !== f]));

/* ------------------------------------------------------------------ 抓图 */

async function captureAll() {
  return withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: VH, deviceScaleFactor: 1, mobile: false });
    const shots = {};
    for (const ph of PHASES) {
      const url = `http://127.0.0.1:${PORT}/?devquick=0&devsize=${SIZE}&devseed=${SEED}`
        + `&devreveal=1&devprobe=1&devlight=${ph}`;
      await send('Page.navigate', { url });
      for (let i = 0; i < 200; i++) {
        const ok = await evaluate('!!(window.__journey && window.__journey() && window.__journey().heroPos && document.querySelector("canvas") && window.__tintSkip)').catch(() => false);
        if (ok) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await evaluate('new Promise(r=>{let i=0;const s=()=>(++i>=30?r():requestAnimationFrame(s));requestAnimationFrame(s)})');
      const meta = await evaluate('(()=>{const c=document.querySelector("canvas");const j=window.__journey();return {canvas:{w:c.width,h:c.height},dpr:c.width/c.clientWidth,hero:j.heroPos}})()');
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

async function analyze(shot) {
  const { meta, modes } = shot;
  const B = await raw(modes.none);
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

  const rowsOut = [];
  for (const fam of FAMILIES) {
    const withImg = await raw(modes[fam]);
    for (const pop of requestedPops) {
      const mask = popMask(pop);
      const Ls = [], Es = [], Cs = [];
      let n = 0, sw = 0;
      for (let y = gy0; y < gy1; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, o = i * C4;
        const r0 = B.d[o], g0 = B.d[o + 1], b0 = B.d[o + 2];
        const r1 = withImg.d[o], g1 = withImg.d[o + 1], b1 = withImg.d[o + 2];
        // 覆盖判据 = 通道差（不得用 |ΔL*| 筛人口 —— 那是拿结果筛人口）
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
      rowsOut.push({ fam, pop, n, L: med(Ls), E: med(Es), C: med(Cs), cvdBelow: pct(Cs, 2.22), wcag: n ? sw / n : NaN });
    }
  }
  return { meta, rowsOut };
}

/* ------------------------------------------------------------------ 主流程 */

(async () => {
  const probe = await checkDevServer(PORT);
  if (!probe.ok) { console.error(probe.reason); process.exit(2); }

  const mism = [];
  for (const t of TINTS) {
    const d = distConsts.get(t.name);
    if (d === undefined) mism.push(`${t.name}: dist 里没有`);
    else if (canonical(d) !== t.canon) mism.push(`${t.name}: src=${t.raw} vs dist=${d}`);
  }
  const srcFp = fingerprint(SRC_REL);
  const distFp = fingerprint(DIST_REL);
  const mainFp = fingerprint('dist/main.js');

  console.log('=== ④ 可达染色净贡献对照（tintab.mjs · 差分口径） ===');
  console.log('owner     : engineering-lead-2　（空间 3:1 验收归 imagecmp.mjs --edge；本表 WCAG 列仅参考）');
  console.log(`指纹 src  : ${srcFp.sha}  ${SRC_REL}`);
  console.log(`指纹 dist : ${distFp.sha}  ${DIST_REL}  mtime=${distFp.mtime}`);
  console.log(`指纹 main : ${mainFp.sha}  dist/main.js`);
  if (mism.length) {
    console.error(`★ 量测前置不满足：src 不等于 dist ——\n  ${mism.join('\n  ')}\n  dev server 服务的 dist 与源码不一致 ⇒ 结果作废，先 build。`);
    process.exit(3);
  }
  console.log('一致性    : src 等于 dist ✓（逐个染色常量比对通过）');
  if (TRANSPARENT.length) {
    console.log(`[警告] 全透明（alpha=0）⇒ 事实上不画：${TRANSPARENT.join(', ')}`);
    console.log('       这多半是别人在跑 "on/off A/B" 的**关**态。这些族的行**无意义**，勿当 (α) 验收数。');
    console.log('       （src≡dist 一致性抓不到这种退化：两边都写 rgba(0,0,0,0) 也算"一致"。）');
  }
  for (const f of FAMILIES) console.log(`族 ${LABEL[f]}: ${BY_FAMILY[f].map((t) => `${t.name}=${t.raw} 归一=${t.canon}`).join('  ')}`);
  console.log(`场景      : seed=${SEED} size=${SIZE} devreveal=1 视口 1280x${VH}(emulation) ⇒ 画布 1280x${VH - 80}`);
  console.log(`相位      : ${PHASES.join(', ')}　（0=清晨 0.22=正午 0.5=黄昏 0.68=深夜）`);
  console.log(`population: ${requestedPops.join(', ')}`);
  console.log('口径      : 净贡献=同像素画/不画逐像素差；覆盖=通道差；ΔE=CIE76；色盲=Machado deuteranopia(1.0)');
  console.log('');

  mkdirSync(OUT, { recursive: true });
  const shots = await captureAll();

  const distAfter = fingerprint(DIST_REL);
  const stable = distAfter.sha === distFp.sha;

  let missing = false;
  for (const ph of PHASES) {
    const shot = shots[ph];
    for (const [mode, buf] of Object.entries(shot.modes)) writeFileSync(path.join(OUT, `tint_${ph}_${mode}.png`), buf);
    const { meta, rowsOut } = await analyze(shot);
    console.log(`########## devlight=${ph}  canvas ${meta.canvas.w}x${meta.canvas.h} dpr ${meta.dpr} hero(${meta.hero.x},${meta.hero.y})`);
    console.log(`  fillRect 命中：${FAMILIES.map((f) => `${f}×${shot.hits[f]}`).join('  ')}`);
    for (const f of FAMILIES) if (!shot.hits[f]) { missing = true; console.log(`  [警告] 族「${LABEL[f]}」0 命中 —— 颜色/名字可能已改，本表对该族无效，勿引用。`); }
    console.log('  族        | population      | 像素数 | ΔL*中位 | ΔE*ab中位 | 色盲ΔL*中位 | 色盲<2.22 | WCAG(参考)');
    for (const r of rowsOut) {
      console.log(`  ${LABEL[r.fam]} | ${r.pop.padEnd(15)} | ${String(r.n).padStart(6)} | ${f2(r.L).padStart(7)} | ${f2(r.E).padStart(9)} | ${f2(r.C).padStart(10)} | ${(Number.isFinite(r.cvdBelow) ? r.cvdBelow.toFixed(0) + '%' : '-').padStart(8)} | ${f2(r.wcag)}`);
    }
    console.log('');
  }
  console.log(`dist 指纹 : 前 ${distFp.sha} / 后 ${distAfter.sha} => ${stable ? '未变 ✓' : '★变了=本轮作废'}`);
  console.log(`PNG 输出  : ${OUT}/tint_<phase>_<${Object.keys(MODES).join('|')}>.png`);
  if (missing) { console.error('存在 0 命中的族 ⇒ 结果不完整，非零退出。'); process.exit(1); }
  if (!stable) { console.error('量测期间 dist 被改动 ⇒ 本轮结果作废，重跑。'); process.exit(4); }
})().catch((e) => {
  console.error(e.message);
  process.exit(e.prerequisite ? 2 : 1);
});
