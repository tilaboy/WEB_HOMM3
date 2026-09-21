#!/usr/bin/env node
/**
 * tintab.mjs —— ④ 可达染色「净贡献（差分）」对照台　(owner: engineering-lead-2)
 *
 * ★ 落库已完：修复稿已提交（`6867cff` / `bf92be4` / `5c0e757`）⇒ 不再是「暂存 /tmp 待 cp」的状态。
 *   改本文件后必须 `node --check tools/tintab.mjs`，再 `git commit -- tools/tintab.mjs`（显式 pathspec）。
 *
 * ★ 冻结（2026-09-21，team-lead 裁定，已写进 `production/roadmap.md`）：**本文件只有 `engineering-lead-2` 可写**；
 *   其它实例一律**只读**，**有增补交给 owner 并入**（内容不回退、只收口 —— 那些增补有价值，别丢）。
 *
 * ## 分工（2026-09-21 team-lead 裁定，遵「同值多址」）
 *   空间口径：
 *     **验收数（唯一出处）** → `tools/reachmeas.mjs`（A/B「状态 vs 其底」；§4.6 权威：午 2.93 / 夜 2.08）
 *     ⚠️ `imagecmp.mjs` 的 env `CMP_EDGE` 已按 team-lead 裁定**撤除**（`ddd9eea`，留墓碑不静默删）——
 *        它量的是该色在**整图**上的全部出现（物件描边也是 ink0）、**非只量 ④ 格缘** ⇒ 当不了验收数 ⇒ 撤代码。
 *        （**别把它读成"旁证缺失"**：撤的是一件不能当验收数的东西，不是"少了一个交付"。）
 *     ⚠️ 旗标形 `--edge` 从未存在（这条原先是对的，保留）
 *   差分口径 + population + ΔE*ab + 色盲 ⇒ 本文件；**WCAG 列降级为"参考"**，验收数不看它。
 *
 * ## 族（从 **dist** 解析，不写死）
 * `REACH_*` → `fill`；`*INK*` → `ink`；`*GLOW*` → `glow`；其余 `NOGO_*` / `*EDGE*` → `edge`。
 * ⚠️ `glow` 是 2026-09-21 为 `(ii)`「双色 halo（亮芯 + 暗边）」新拆的族：**亮芯必须与红/墨分开量**，
 *  否则"两极其一 ≥3:1"就被并成一个桶 ⇒ 又犯"均值掩盖"。该族名匹配 `/GLOW/i`（现网常量 `NOGO_EDGE_GLOW`）。
 * 颜色支持 rgba(...) 与 #hex。两条踩过的坑：
 *   (a) 只认 rgba 的正则会静默漏掉 #hex 的墨；
 *   (b) Chrome fillStyle getter 对不透明色回报 #hex（不是 rgb(...)）⇒ 比对前必须归一，
 *       否则该族命中恒为 0 —— 静默空值 = 假绿。故对 0 命中的族硬告警 + 非零退出。
 *
 * ## src≠dist 守卫（新规则②b）：启动即逐常量比对 src vs dist，不一致 exit 2、不跑。
 * ## 自证未被并发改动（新规则③）：量测前后各记 src/dist 的 sha1+mtime，跑完再核；不一致 exit 3。
 *
 * ## population 必填（--pop=list 看选项）。覆盖判据按通道差 —— 不得用 |ΔL*| 阈值筛人口。
 *
 * ## 草亮度分层（2026-09-21 加，team-lead 裁 `ff7db9c`）
 * `grass` 曾是一个**不分层**的桶 —— 而 §15.4 的 (α) **失败格恰恰是「草·深」** ⇒ 并进 `grass`
 *   聚合会 **"均值掩盖死区"**（把仍不过的暗格洗成过）。故按 `L*` 切三桶，**阈值即本文件内的单一权威定义**：
 *     `grass-bright`：L* ≥ 55 ｜ `grass-mid`：40 ≤ L* < 55 ｜ `grass-dark`：22 ≤ L* < 40
 *   （`L* < 22` 已归 `dark`；切法**沿用 §15.4 (α) 基线表**，使新表与该基线**可比**。）
 *   ⚠️ 历史病根：基线那张 7 行表出自**未入库**的 `/tmp/alpha_bin.mjs`，其 `cls()` 与本文件
 *   **不是同一套** ⇒ 两套定义出两个数。**收口（2026-09-21，owner）**：
 *     ① 上层分档条件 `classify()` 已改为与 `reachmeas.band()` / `alpha_bin.cls()` **逐字同条件**；
 *     ② 草三分阈值 L*≥55 / ≥40 同上（`grass-bright` / `grass-mid` / `grass-dark`）。
 *   ⇒ 本文件与 ④ 的**验收数工具 `reachmeas.mjs` 同桶定义**（跨工具数才可比）。
 *   ✅ **帧 = 身份帧（(a)：正午 0.22 的 `none` 底图；2026-09-21 定 —— **相位帧已废**）**：
 *      **分类**只用正午底图（地形身份不随光照变），**测量**逐相位各自做。与 `reachmeas` 第 4 参（身份帧）、
 *      `/tmp/alpha_bin.mjs`（`cls(TN)`，`TN = A2_noon_none`）**同帧** ⇒ 两边同名桶是**同一批像素**、可拼表。
 *      ⚠️ 为何废相位帧：按**相位底**分类时，夜深底被压暗 ⇒ 桶整体下移 ⇒ **夜「草·亮」塌成 n≈5**
 *      ⇒ 该"类"夜里不存在 ⇒ **判据被"该类为空"真空通过**、失败被藏（art-director 实测：相位帧 n=5⇒5.43"过" vs 身份帧 n=727⇒2.92 ❌）。
 *   ⚠️ 旧表机制（`art-director` 实测）：**「正午」列 6 类逐格可复现**；**「夜」列错格**（其夜草三行整体错开一格）
 *      ⇒ 旧夜行疑出自**相位帧**版本 ⇒ 引旧表夜行会与身份帧读数不同，**别当同一数**。
 *   ⚠️ 引用纪律：本文件 WCAG **均值列**（`WCAG均值(参考)`）与 **中位列**（`WCAG中位`，`#138` 加）**同格两数并存**、
 *     `reachmeas` = **中位** ⇒ 同格多数不同 ≠ 矛盾，是口径 + 统计量都不同；引用须连统计量一起报。
 *   ★ `#138`（2026-09-21）加：**WCAG 中位列**（四统计量统一取中位以便 A/B 减差）+ 自证三件套升级
 *     （并记 `dist/main.js` 指纹 + 测量时 HEAD）—— 供「动画冻结 A/B 证明」用。
 *   ⚠️ 样本守卫：`n < 200` 打「样本不足」—— 桶塌成空时该格**不得据此判过**（与 `reachmeas` 的 `MIN_N` 同族）。
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { withHeadlessChrome, checkDevServer } from './_chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_REL = 'src/render/MapRenderer.ts';
const DIST_REL = 'dist/render/MapRenderer.js';
const MAIN_REL = 'dist/main.js'; // 自证三件套③：并记入口 bundle 指纹（防"量了 dist 但入口是旧档"）

/* ------------------------------------------------------------------ 参数 */

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
}

const POPS = ['uniform-grass', 'grass', 'grass-bright', 'grass-mid', 'grass-dark', 'all', 'sand', 'water', 'rock', 'dark'];
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
const VH = Number(arg('vh', '757')); // Emulation 高；757 ⇒ 画布 1280x677

/* ---------------------------------------------------- 指纹 & 常量解析 */

const sha1 = (p) => { try { return createHash('sha1').update(readFileSync(path.join(ROOT, p))).digest('hex').slice(0, 12); } catch { return '(缺)'; } };
const mtime = (p) => { try { return statSync(path.join(ROOT, p)).mtime.toISOString(); } catch { return '(缺)'; } };
const readSrc = (p) => { try { return readFileSync(path.join(ROOT, p), 'utf8'); } catch { return null; } };
/* 自证三件套③：测量时 HEAD 是否为当前 HEAD（防"历史读数"—— eng-sprites 升级项）。 */
const headSha = () => { try { return execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().slice(0, 12); } catch { return '(未知)'; } };
const fp = (p) => ({ sha1: sha1(p), m: mtime(p) });

/** 浏览器 fillStyle getter 的规范形（去空格）：#2a1a12 ⇒ rgb(42,26,18)。 */
function canonical(color) {
  const c = color.trim();
  let m;
  if ((m = /^#([0-9a-f]{3})$/i.exec(c))) {
    const p = m[1].split('').map((h) => parseInt(h + h, 16));
    return `rgb(${p[0]},${p[1]},${p[2]})`;
  }
  if ((m = /^#([0-9a-f]{6})$/i.exec(c))) {
    const n = parseInt(m[1], 16);
    return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
  }
  if ((m = /^rgba?\(([\d.]+),([\d.]+),([\d.]+)(?:,([\d.]+))?\)$/i.exec(c.replace(/\s+/g, '')))) {
    const [, r, g, b, a] = m;
    const alpha = a === undefined ? 1 : Number(a);
    return alpha >= 1 ? `rgb(${Number(r)},${Number(g)},${Number(b)})` : `rgba(${Number(r)},${Number(g)},${Number(b)},${alpha})`;
  }
  return null;
}

function parseConsts(text) {
  const out = new Map();
  if (!text) return out;
  const re = /const\s+(\w+)\s*=\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(text))) {
    const [, name, val] = m;
    if (!/(REACH|NOGO|WALK|BLOCK)/i.test(name)) continue;
    if (!canonical(val)) continue;
    out.set(name, val);
  }
  return out;
}

const srcText = readSrc(SRC_REL);
const distText = readSrc(DIST_REL);
const SRC = parseConsts(srcText);
const DIST = parseConsts(distText);

/* -------------------------------------------------- src≠dist 守卫（新规则②b） */

if (!srcText || !distText) {
  console.error(`读不到 ${!srcText ? SRC_REL : DIST_REL} —— 没有 dist 就先 build；本脚本只量"运行的 dist"。`);
  process.exit(2);
}
const names = [...new Set([...SRC.keys(), ...DIST.keys()])];
const mismatches = names.filter((n) => SRC.get(n) !== DIST.get(n)).map((n) => ({ n, s: SRC.get(n), d: DIST.get(n) }));
if (mismatches.length) {
  console.error('X src != dist —— 量测会"静默量到不存在的效果"，拒绝运行。');
  for (const m of mismatches) console.error(`   ${m.n}: src=${m.s ?? '(无)'}  dist=${m.d ?? '(无)'}`);
  console.error(`   ${SRC_REL} @ ${mtime(SRC_REL)}  vs  ${DIST_REL} @ ${mtime(DIST_REL)}`);
  console.error('   => 先重建 dist（并确认没人在做负测），再跑。');
  process.exit(2);
}
if (!DIST.size) { console.error(`${DIST_REL} 里解析不到 REACH_*/NOGO_* 色值常量 —— 核对命名约定。`); process.exit(2); }

const BY_FAMILY = { fill: [], edge: [], glow: [], ink: [] };
for (const [n, raw] of DIST) {
  const fam = /REACH|WALK/i.test(n) ? 'fill' : /INK/i.test(n) ? 'ink' : /GLOW/i.test(n) ? 'glow' : 'edge';
  BY_FAMILY[fam].push({ name: n, raw, canon: canonical(raw) });
}
const FAMILIES = ['fill', 'edge', 'glow', 'ink'].filter((f) => BY_FAMILY[f].length);
const LABEL = { fill: '蓝fill  ', edge: '红(内侧)', glow: '亮芯(halo)', ink: '墨(外侧)' };
if (!FAMILIES.length) { console.error('本体化后没有可用族。'); process.exit(2); }

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
const DEUT = [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]];
const cl255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const deut = (r, g, b) => [
  cl255(DEUT[0][0] * r + DEUT[0][1] * g + DEUT[0][2] * b),
  cl255(DEUT[1][0] * r + DEUT[1][1] * g + DEUT[1][2] * b),
  cl255(DEUT[2][0] * r + DEUT[2][1] * g + DEUT[2][2] * b),
];
/* 地形分类 —— 与 `tools/reachmeas.mjs` 的 `band()`、`/tmp/alpha_bin.mjs` 的 `cls()` **逐字同条件**。
 * ⚠️ 这是 team-lead 裁的「两套定义出两个数」的另一半：原 `classify()` 用 `g-b>=15`/`r-b>=25` 等，
 *   与上述两者（`mx` 比较式）**不是同一套** ⇒ 桶成员不同 ⇒ 数不可比。此改后本文件 = reachmeas 同桶定义（跨工具一致）。 */
function classify(r, g, b) {
  const L = Lp(r, g, b);
  if (L < 22) return 'dark';
  const mx = Math.max(r, g, b);
  if (b === mx && b > r + 12) return 'water';
  if (r === mx && g >= b && r > 120) return 'sand';
  if (g >= r && g > b) return 'grass';
  return 'rock';
}
/* 草亮度分层 —— 单一权威定义（切法沿用 §15.4 (α) 基线表，使新表与基线可比） */
const GRASS_L_BRIGHT = 55, GRASS_L_MID = 40;
const GRASS_BIN = { 'grass-bright': 0, 'grass-mid': 1, 'grass-dark': 2 };
function grassBin(r, g, b) {
  if (classify(r, g, b) !== 'grass') return -1;
  const L = Lp(r, g, b);
  return L >= GRASS_L_BRIGHT ? 0 : L >= GRASS_L_MID ? 1 : 2;
}
const f2 = (v) => Number(v).toFixed(2);
const MIN_N = 200; // 样本不足门槛（与 reachmeas 一致）—— 防"桶塌成空"真空通过

/* ------------------------------------------------------------------ 抓图 */

// ★ 冻结"构建后动画"：`MapRenderer.draw()` 用 `performance.now()` 驱动
//    水波（`Math.sin((wx+wy*0.6)/13 - now/430)`，行 ~413）与选中脉冲（`Math.sin(now/pulseDiv)`，行 ~614）。
//    ⇒ 每次截图 `now` 不同 ⇒ "变化像素"里混入 ~50k 动画像素 —— 对**弱带 population**（water/dark）
//    会淹没中位 = **污染**（实测：`edge` 模式 51125 个变化像素里只有 2 个是红）。
//    ⇒ 注入时把 `performance.now` 钉成常量，使动画相位确定。`NO_FREEZE=1` 可关（诊断动画本身用）。
const FREEZE_ANIM = process.env.NO_FREEZE !== '1';
const NOW_STUB = FREEZE_ANIM
  ? `try{const F=function(){return 123456.789;};try{Object.defineProperty(Performance.prototype,'now',{value:F,configurable:true,writable:true});}catch(e){}try{performance.now=F;}catch(e){}}catch(e){}`
  : '';

const HOOK = `(() => {
  ${NOW_STUB}
  const FAMILIES = ${JSON.stringify(FAMILIES)};
  const COLORS = ${JSON.stringify(Object.fromEntries(FAMILIES.map((f) => [f, BY_FAMILY[f].map((t) => t.canon)])))};
  const norm = (s) => {
    const h6 = /^#([0-9a-f]{6})$/i.exec(s);
    if (h6) { const n = parseInt(h6[1], 16); return 'rgb(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ')'; }
    const h3 = /^#([0-9a-f]{3})$/i.exec(s);
    if (h3) { const p = h3[1].split('').map((x) => parseInt(x + x, 16)); return 'rgb(' + p[0] + ',' + p[1] + ',' + p[2] + ')'; }
    return s;
  };
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.fillRect;
  window.__tintSkip = {}; for (const f of FAMILIES) window.__tintSkip[f] = false;
  window.__tintHits = {}; for (const f of FAMILIES) window.__tintHits[f] = 0;
  proto.fillRect = function (...a) {
    const fs = norm((typeof this.fillStyle === 'string') ? this.fillStyle.replace(/\\s+/g, '') : '');
    let hit = null;
    for (const f of FAMILIES) if (COLORS[f].includes(fs)) { hit = f; break; }
    if (hit) { window.__tintHits[hit]++; if (window.__tintSkip[hit]) return; }
    return orig.apply(this, a);
  };
})();`;

const MODES = { full: Object.fromEntries(FAMILIES.map((f) => [f, false])), none: Object.fromEntries(FAMILIES.map((f) => [f, true])) };
for (const f of FAMILIES) MODES[f] = Object.fromEntries(FAMILIES.map((g) => [g, g !== f]));

async function captureAll() {
  return withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: VH, deviceScaleFactor: 1, mobile: false });
    const shots = {};
    for (const ph of PHASES) {
      const url = `http://127.0.0.1:${PORT}/?devquick=0&devsize=${SIZE}&devseed=${SEED}&devreveal=1&devprobe=1&devlight=${ph}`;
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
    /* ★ 身份帧（identity）：分类只用「正午(0.22) none」底图，**不随相位变**。
     *   缘由（art-director 实测 + 我复现）：若按**相位底**分类，夜深时底被压暗 ⇒ 桶整体下移，
     *   夜「草·亮」塌成 n=5 ⇒ 该"类"在夜里不存在 ⇒ **判据被"该类为空"真空通过**，失败被藏。
     *   ⇒ 身份帧下同批像素恒定分类，跨相位可比、可拼表（与 `reachmeas` 第 4 参同帧）。 */
    const IDENTITY_PHASE = '0.22';
    if (shots[IDENTITY_PHASE]) {
      shots.identity = shots[IDENTITY_PHASE].modes.none;
    } else {
      const url = `http://127.0.0.1:${PORT}/?devquick=0&devsize=${SIZE}&devseed=${SEED}&devreveal=1&devprobe=1&devlight=${IDENTITY_PHASE}`;
      await send('Page.navigate', { url });
      for (let i = 0; i < 200; i++) {
        const ok = await evaluate('!!(window.__journey && window.__journey() && window.__journey().heroPos && document.querySelector("canvas") && window.__tintSkip)').catch(() => false);
        if (ok) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await evaluate('new Promise(r=>{let i=0;const s=()=>(++i>=30?r():requestAnimationFrame(s));requestAnimationFrame(s)})');
      await evaluate(`window.__tintSkip = ${JSON.stringify(MODES.none)}`);
      await evaluate('new Promise(r=>{let i=0;const s=()=>(++i>=3?r():requestAnimationFrame(s));requestAnimationFrame(s)})');
      const s = await send('Page.captureScreenshot', { format: 'png' });
      shots.identity = Buffer.from(s.data, 'base64');
    }
    return shots;
  }, { devServerPort: PORT, profilePrefix: 'tintab-' });
}

/* ------------------------------------------------------------------ 计算 */

async function raw(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: data, w: info.width, h: info.height, c: info.channels };
}

async function analyze(ph, shot, identityBuf) {
  const { meta, modes } = shot;
  const B = await raw(modes.none);        // 该相位「before」（测量用：画/不画之差）
  const I = await raw(identityBuf);       // 身份帧（分类用：恒正午底，不随相位变）
  const W = B.w, H = B.h, N = W * H, C4 = B.c;
  if (I.w !== W || I.h !== H) throw new Error(`身份帧 ${I.w}x${I.h} ≠ 相位帧 ${W}x${H} —— 分类与测量不在同一坐标系，拒绝出数。`);
  const gy0 = 42, gy1 = Math.min(720, H);
  const cls = new Uint8Array(N);
  const gb = new Int8Array(N);
  const CODE = { dark: 0, water: 1, grass: 2, sand: 3, rock: 4 };
  for (let i = 0; i < N; i++) { const o = i * C4; cls[i] = CODE[classify(I.d[o], I.d[o + 1], I.d[o + 2])]; gb[i] = grassBin(I.d[o], I.d[o + 1], I.d[o + 2]); }
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
    if (which in GRASS_BIN) { const bi = GRASS_BIN[which]; return (i) => gb[i] === bi; }
    const code = CODE[which]; return (i) => cls[i] === code;
  };
  const rowsOut = [];
  for (const fam of FAMILIES) {
    const withImg = await raw(modes[fam]);
    for (const pop of requestedPops) {
      const mask = popMask(pop);
      const Ls = [], Es = [], Cs = [], Ws = [];
      let n = 0, sw = 0;
      for (let y = gy0; y < gy1; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, o = i * C4;
        const r0 = B.d[o], g0 = B.d[o + 1], b0 = B.d[o + 2];
        const r1 = withImg.d[o], g1 = withImg.d[o + 1], b1 = withImg.d[o + 2];
        if (Math.abs(r1 - r0) <= 4 && Math.abs(g1 - g0) <= 4 && Math.abs(b1 - b0) <= 4) continue;
        if (!mask(i)) continue;
        Ls.push(Math.abs(Lp(r1, g1, b1) - Lp(r0, g0, b0)));
        Es.push(dE(lab(r1, g1, b1), lab(r0, g0, b0)));
        const [cr1, cg1, cb1] = deut(r1, g1, b1), [cr0, cg0, cb0] = deut(r0, g0, b0);
        Cs.push(Math.abs(Lp(cr1, cg1, cb1) - Lp(cr0, cg0, cb0)));
        const w = wcag(Yof(r1, g1, b1), Yof(r0, g0, b0));
        Ws.push(w); sw += w; n++;
      }
      const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[(a.length - 1) >> 1] : NaN);
      const pct = (a, t) => (a.length ? (100 * a.filter((v) => v < t).length) / a.length : NaN);
      /* ★ 加 WCAG 中位（Wc）：team-lead #138 要求四统计量**统一取中位**以做 A/B 减差；
       *   原 WCAG 列是**均值**（`wcag`），保留不动（统计量纪律：同格两数须连统计量一起报）。 */
      rowsOut.push({ fam, pop, n, L: med(Ls), E: med(Es), C: med(Cs), cvdBelow: pct(Cs, 2.22), wcag: n ? sw / n : NaN, Wc: med(Ws) });
    }
  }
  return { meta, rowsOut };
}

/* ------------------------------------------------------------------ 主流程 */

(async () => {
  const probe = await checkDevServer(PORT);
  if (!probe.ok) { console.error(probe.reason); process.exit(2); }

  const fpBefore = { src: fp(SRC_REL), dist: fp(DIST_REL), main: fp(MAIN_REL) };
  const headBefore = headSha();

  console.log('=== ④ 可达染色净贡献对照（tintab.mjs，差分口径） ===');
  console.log(`指纹前 : src ${fpBefore.src.sha1} @ ${fpBefore.src.m} | dist ${fpBefore.dist.sha1} @ ${fpBefore.dist.m} | main ${fpBefore.main.sha1} @ ${fpBefore.main.m}`);
  console.log(`HEAD   : ${headBefore}（测量前；跑完再核是否仍是当前 HEAD —— 防"历史读数"）`);
  console.log('src!=dist: 已核一致（不一致会 exit 2）');
  for (const f of FAMILIES) console.log(`族 ${LABEL[f]}: ${BY_FAMILY[f].map((t) => `${t.name}=${t.raw} => ${t.canon}`).join('  ')}`);
  console.log(`场景   : seed=${SEED} size=${SIZE} devreveal=1 视口 1280x${VH}(emulation,dpr1) => 画布 1280x${VH - 80}`);
  console.log(`相位   : ${PHASES.join(', ')}　（0.22=正午 0.5=黄昏 0.68=深夜）`);
  console.log(`population: ${requestedPops.join(', ')}`);
  console.log(`分类帧 : **身份帧 = 正午(0.22) none 底图**（不随相位变）—— 防"相位越暗、桶越塌 ⇒ 凭空通过"；与 reachmeas 第4参同帧`);
  console.log(`样本守卫: n < ${MIN_N} 标「样本不足」—— 该格不得据此判过（防"桶塌成空"真空通过）`);
  console.log(`草分层 : grass-bright L*>=${GRASS_L_BRIGHT} ｜ grass-mid ${GRASS_L_MID}<=L*<${GRASS_L_BRIGHT} ｜ grass-dark 22<=L*<${GRASS_L_MID}（tintab 内单一权威定义，与 §15.4 (α) 基线表同切法）`);
  console.log(`动画   : ${FREEZE_ANIM ? '已冻结 performance.now（水波/脉冲相位确定 —— 防动画像素污染"变化集"）' : '⚠️ 未冻结（NO_FREEZE=1）—— water/dark 等弱带 population 会被动画污染，勿引'}`);
  console.log("分桶定义: classify() = { L*<22→dark ; b=max且b>r+12→water ; r=max且g≥b且r>120→sand ; g≥r且g>b→grass ; 其余→rock }（与 reachmeas.band() 逐字同条件）");
  console.log(`          草三分 L*≥${GRASS_L_BRIGHT}/${GRASS_L_MID}–${GRASS_L_BRIGHT}/22–${GRASS_L_MID}；uniform-grass = 5×5 邻域 terrain 码一致；暗缝 = 「dark」桶（含物件/接缝，未再细分）`);
  console.log('口径   : 净贡献=同像素画/不画之差；覆盖判据=通道差；ΔE=CIE76；色盲=Machado deuteranopia(1.0)');
console.log('统计量 : ΔL*/ΔE*ab/色盲 取**中位**；WCAG 取**均值**（列头已标）—— 与 reachmeas.mjs 口径不同，引用时须连统计量一起报');
  console.log('');

  mkdirSync(OUT, { recursive: true });
  const shots = await captureAll();
  const fpAfter = { src: fp(SRC_REL), dist: fp(DIST_REL), main: fp(MAIN_REL) };
  const headAfter = headSha();
  const stable = fpBefore.src.sha1 === fpAfter.src.sha1 && fpBefore.dist.sha1 === fpAfter.dist.sha1 && fpBefore.main.sha1 === fpAfter.main.sha1;
  const headSame = headBefore === headAfter && headBefore !== '(未知)';

  let missing = false;
  for (const ph of PHASES) {
    const shot = shots[ph];
    for (const [mode, buf] of Object.entries(shot.modes)) writeFileSync(path.join(OUT, `tint_${ph}_${mode}.png`), buf);
    const { meta, rowsOut } = await analyze(ph, shot, shots.identity);
    console.log(`########## devlight=${ph}  canvas ${meta.canvas.w}x${meta.canvas.h} dpr ${meta.dpr} hero(${meta.hero.x},${meta.hero.y})`);
    console.log(`  fillRect 命中：${FAMILIES.map((f) => `${f}x${shot.hits[f]}`).join('  ')}`);
    for (const f of FAMILIES) if (!shot.hits[f]) { missing = true; console.log(`  [!] 族「${LABEL[f]}」命中 0 —— 颜色/名字可能已改，该族无效，勿引用！`); }
    console.log('  族        | population      | 像素数 | ΔL*中位 | ΔE*ab中位 | 色盲ΔL*中位 | 色盲<2.22 | WCAG中位 | WCAG均值(参考)');
    for (const r of rowsOut) {
      console.log(`  ${LABEL[r.fam]} | ${r.pop.padEnd(15)} | ${String(r.n).padStart(6)} | ${f2(r.L).padStart(7)} | ${f2(r.E).padStart(9)} | ${f2(r.C).padStart(10)} | ${(Number.isFinite(r.cvdBelow) ? r.cvdBelow.toFixed(0) + '%' : '-').padStart(8)} | ${f2(r.Wc).padStart(7)} | ${f2(r.wcag)}${r.n < MIN_N ? '  ⚠样本不足' : ''}`);
      console.log(`##ROW\t${ph}\t${r.fam}\t${r.pop}\t${r.n}\t${f2(r.L)}\t${f2(r.E)}\t${f2(r.C)}\t${f2(r.Wc)}\t${f2(r.wcag)}`);
    }
    console.log('');
  }
  console.log(`指纹后 : src ${fpAfter.src.sha1} | dist ${fpAfter.dist.sha1} @ ${fpAfter.dist.m} | main ${fpAfter.main.sha1} @ ${fpAfter.main.m}`);
  console.log(`自证①  : src≠dist 已核一致（启动时；不一致 exit 2）—— 量的是"运行的 dist"`);
  console.log(`自证②  : ${stable ? 'OK 量测期间 src/dist/main 指纹均未变（本组可信）' : 'FAIL 量测期间 src/dist/main 变了 —— 本组作废，请重跑'}`);
  console.log(`自证③  : HEAD 测前 ${headBefore} / 测后 ${headAfter} ⇒ ${headSame ? 'OK = 当前 HEAD（非历史读数）' : '⚠️ 测量期间 HEAD 变了 —— 须核对读数归属'}`);
  console.log(`PNG 输出：${OUT}/tint_<phase>_<${Object.keys(MODES).join('|')}>.png`);
  if (!stable) process.exit(3);
  if (missing) { console.error('存在 0 命中的族 => 结果不完整，非零退出。'); process.exit(1); }
})().catch((e) => {
  console.error(e.message);
  process.exit(e.prerequisite ? 2 : 1);
});
