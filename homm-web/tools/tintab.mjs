#!/usr/bin/env node
/**
 * tintab.mjs —— ④ 可达染色「净贡献（差分）」对照台　(owner: engineering-lead-2)
 *
 * ★ 这是 engineering-lead-2 在 7dcbe59 之上的修复稿。因 tools/tintab.mjs 正被另一实例
 *   每 ~30s 覆写（livelock），本稿暂存 /tmp；其停写后 `cp` 覆盖即可。
 *   落地步骤：cp → `node --check tools/tintab.mjs` → `git add tools/tintab.mjs && git commit`。
 *
 * ## 分工（2026-09-21 team-lead 裁定，遵「同值多址」）
 *   空间口径的「状态 vs 其底」3:1  ⇒ 独立接口 **待补**：`imagecmp.mjs --edge` 在 HEAD **并不存在**
 *   （曾以 env `CMP_EDGE` 试过、后撤回）。该文件归 art-director，本文件**不碰、也不引用不存在的接口**。
 *   差分口径 + population + ΔE*ab + 色盲 ⇒ 本文件；**WCAG 列降级为"参考"**，验收数不看它。
 *
 * ## 族（从 **dist** 解析，不写死）
 * `REACH_*` → `fill`；`NOGO_*INK*` → `ink`；其余 `NOGO_*` / `*EDGE*` → `edge`。
 * 颜色支持 rgba(...) 与 #hex。两条踩过的坑：
 *   (a) 只认 rgba 的正则会静默漏掉 #hex 的墨；
 *   (b) Chrome fillStyle getter 对不透明色回报 #hex（不是 rgb(...)）⇒ 比对前必须归一，
 *       否则该族命中恒为 0 —— 静默空值 = 假绿。故对 0 命中的族硬告警 + 非零退出。
 *
 * ## src≠dist 守卫（新规则②b）：启动即逐常量比对 src vs dist，不一致 exit 2、不跑。
 * ## 自证未被并发改动（新规则③）：量测前后各记 src/dist 的 sha1+mtime，跑完再核；不一致 exit 3。
 *
 * ## population 必填（--pop=list 看选项）。覆盖判据按通道差 —— 不得用 |ΔL*| 阈值筛人口。
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { withHeadlessChrome, checkDevServer } from './_chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_REL = 'src/render/MapRenderer.ts';
const DIST_REL = 'dist/render/MapRenderer.js';

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
const VH = Number(arg('vh', '757')); // Emulation 高；757 ⇒ 画布 1280x677

/* ---------------------------------------------------- 指纹 & 常量解析 */

const sha1 = (p) => { try { return createHash('sha1').update(readFileSync(path.join(ROOT, p))).digest('hex').slice(0, 12); } catch { return '(缺)'; } };
const mtime = (p) => { try { return statSync(path.join(ROOT, p)).mtime.toISOString(); } catch { return '(缺)'; } };
const readSrc = (p) => { try { return readFileSync(path.join(ROOT, p), 'utf8'); } catch { return null; } };

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

const BY_FAMILY = { fill: [], edge: [], ink: [] };
for (const [n, raw] of DIST) {
  const fam = /REACH|WALK/i.test(n) ? 'fill' : /INK/i.test(n) ? 'ink' : 'edge';
  BY_FAMILY[fam].push({ name: n, raw, canon: canonical(raw) });
}
const FAMILIES = ['fill', 'edge', 'ink'].filter((f) => BY_FAMILY[f].length);
const LABEL = { fill: '蓝fill  ', edge: '红(内侧)', ink: '墨(外侧)' };
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
        if (Math.abs(r1 - r0) <= 4 && Math.abs(g1 - g0) <= 4 && Math.abs(b1 - b0) <= 4) continue;
        if (!mask(i)) continue;
        Ls.push(Math.abs(Lp(r1, g1, b1) - Lp(r0, g0, b0)));
        Es.push(dE(lab(r1, g1, b1), lab(r0, g0, b0)));
        const [cr1, cg1, cb1] = deut(r1, g1, b1), [cr0, cg0, cb0] = deut(r0, g0, b0);
        Cs.push(Math.abs(Lp(cr1, cg1, cb1) - Lp(cr0, cg0, cb0)));
        sw += wcag(Yof(r1, g1, b1), Yof(r0, g0, b0)); n++;
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

  const fpBefore = { src: sha1(SRC_REL), srcM: mtime(SRC_REL), dist: sha1(DIST_REL), distM: mtime(DIST_REL) };

  console.log('=== ④ 可达染色净贡献对照（tintab.mjs，差分口径） ===');
  console.log(`指纹前 : src ${fpBefore.src} @ ${fpBefore.srcM}  |  dist ${fpBefore.dist} @ ${fpBefore.distM}`);
  console.log('src!=dist: 已核一致（不一致会 exit 2）');
  for (const f of FAMILIES) console.log(`族 ${LABEL[f]}: ${BY_FAMILY[f].map((t) => `${t.name}=${t.raw} => ${t.canon}`).join('  ')}`);
  console.log(`场景   : seed=${SEED} size=${SIZE} devreveal=1 视口 1280x${VH}(emulation,dpr1) => 画布 1280x${VH - 80}`);
  console.log(`相位   : ${PHASES.join(', ')}　（0.22=正午 0.68=深夜）`);
  console.log(`population: ${requestedPops.join(', ')}`);
  console.log('口径   : 净贡献=同像素画/不画之差；覆盖判据=通道差；ΔE=CIE76；色盲=Machado deuteranopia(1.0)');
console.log('统计量 : ΔL*/ΔE*ab/色盲 取**中位**；WCAG 取**均值**（列头已标）—— 与 reachmeas.mjs 口径不同，引用时须连统计量一起报');
  console.log('');

  mkdirSync(OUT, { recursive: true });
  const shots = await captureAll();
  const fpAfter = { src: sha1(SRC_REL), dist: sha1(DIST_REL), distM: mtime(DIST_REL) };
  const stable = fpBefore.src === fpAfter.src && fpBefore.dist === fpAfter.dist;

  let missing = false;
  for (const ph of PHASES) {
    const shot = shots[ph];
    for (const [mode, buf] of Object.entries(shot.modes)) writeFileSync(path.join(OUT, `tint_${ph}_${mode}.png`), buf);
    const { meta, rowsOut } = await analyze(ph, shot);
    console.log(`########## devlight=${ph}  canvas ${meta.canvas.w}x${meta.canvas.h} dpr ${meta.dpr} hero(${meta.hero.x},${meta.hero.y})`);
    console.log(`  fillRect 命中：${FAMILIES.map((f) => `${f}x${shot.hits[f]}`).join('  ')}`);
    for (const f of FAMILIES) if (!shot.hits[f]) { missing = true; console.log(`  [!] 族「${LABEL[f]}」命中 0 —— 颜色/名字可能已改，该族无效，勿引用！`); }
    console.log('  族        | population      | 像素数 | 色差ΔL*中位 | ΔE*ab中位 | 色盲ΔL*中位 | 色盲<2.22 | WCAG(参考)');
    for (const r of rowsOut) {
      console.log(`  ${LABEL[r.fam]} | ${r.pop.padEnd(15)} | ${String(r.n).padStart(6)} | ${f2(r.L).padStart(7)} | ${f2(r.E).padStart(9)} | ${f2(r.C).padStart(10)} | ${(Number.isFinite(r.cvdBelow) ? r.cvdBelow.toFixed(0) + '%' : '-').padStart(8)} | ${f2(r.wcag)}`);
    }
    console.log('');
  }
  console.log(`指纹后 : src ${fpAfter.src}  |  dist ${fpAfter.dist} @ ${fpAfter.distM}`);
  console.log(`自证   : ${stable ? 'OK 量测期间 src 与 dist 均未变（本组可信）' : 'FAIL 量测期间 src/dist 变了 —— 本组作废，请重跑'}`);
  console.log(`PNG 输出：${OUT}/tint_<phase>_<${Object.keys(MODES).join('|')}>.png`);
  if (!stable) process.exit(3);
  if (missing) { console.error('存在 0 命中的族 => 结果不完整，非零退出。'); process.exit(1); }
})().catch((e) => {
  console.error(e.message);
  process.exit(e.prerequisite ? 2 : 1);
});
