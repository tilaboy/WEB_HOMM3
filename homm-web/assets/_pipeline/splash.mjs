/**
 * splash.mjs —— `#162` 安卓启动图**母图**合成器（team-lead 2026-09-21 定：**不用 AI**）。
 *
 * 硬约束（team-lead）：
 *   ① 用**我们自己的色板 + 既有渲染管线**合成 ⇒ 本脚本 `import dist/render/atlas.js`（**真图集**），
 *      **不重画**；构图自定，但**必须是可复算的脚本产物**。
 *   ② 两张母图，尺寸 = **现存 xxxhdpi 变体**：
 *      landscape → `drawable-land-xxxhdpi/splash.png` = **1920×1280**
 *      portrait  → `drawable-port-xxxhdpi/splash.png` = **1280×1920**
 *   ③ night 变体：**成本≈0 ⇒ 出**（同一条代码路径 + 一个色调后处理）。
 *   ④ **只交母图 + 「母图 → 各档」的可复算缩放说明**；写进 android 的 res 目录由 `engineering-lead` 做（不在此脚本写域内）。
 *   ⑤ 判据：**无第三方水印/授权污点**（全部像素来自本仓程序化图集 ⇒ 构造上无水印）；
 *      与 4 族平涂风格不冲突（同一图集 ⇒ 构造上同源）。
 *
 * 写域：只写 `homm-web/assets/**`。**不碰 `src/**` / `tools/**` / `android/**`**。
 *
 * 用法：node splash.mjs
 * 产出：out/splash_{land,port}{,_night}.png + out/splash_spec.json + out/splash_spec.md
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installShim } from '../../tools/_canvas.mjs';
import * as L from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'out');
const SRC = path.join(HERE, 'splash-src');
mkdirSync(OUT, { recursive: true });
mkdirSync(SRC, { recursive: true });

installShim();
const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex');

/* ---------------------------------------------------------------- 输入指纹（绑定）*/
const DIST_ATLAS = path.join(WEB, 'dist/render/atlas.js');
const DIST_MAIN = path.join(WEB, 'dist/main.js');
const INPUTS = {
  'dist/render/atlas.js': existsSync(DIST_ATLAS) ? md5(DIST_ATLAS) : '(缺)',
  'dist/main.js': existsSync(DIST_MAIN) ? md5(DIST_MAIN) : '(缺)',
};

/* ---------------------------------------------------------------- 拉真图集 */
const { getAtlas } = await import('../../dist/render/atlas.js');
const atlas = getAtlas();
const byName = new Map(atlas.metrics.items.map((it) => [it.name, it]));

function frame(name) {
  const f = byName.get(name);
  if (!f) throw new Error(`图集无此帧: ${name}`);
  const rgba = new Uint8ClampedArray(f.w * f.h * 4);
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const s = ((f.y + y) * atlas.canvas.width + (f.x + x)) * 4;
      const t = (y * f.w + x) * 4;
      rgba[t] = atlas.canvas.buf[s]; rgba[t + 1] = atlas.canvas.buf[s + 1];
      rgba[t + 2] = atlas.canvas.buf[s + 2]; rgba[t + 3] = atlas.canvas.buf[s + 3];
    }
  }
  return { w: f.w, h: f.h, rgba };
}

/* 把用到的帧**快照**到 splash-src/ ，使母图在 `dist` 变动后仍可复算 */
const USED = ['g_grass_0', 'g_grass_1', 'g_grass_2', 'g_dirt_0', 'g_dirt_1', 'g_dirt_2',
  'castle_p1_0', 'tree0', 'rock0', 'mtn0', 'hero_p1', 'u_p1_templar_map', 'u_p2_wolfrider_map'];
for (const n of USED) {
  const f = frame(n);
  writeFileSync(path.join(SRC, `${n}.png`), L.encodePngRGBA(f.w, f.h, f.rgba));
}

/* ---------------------------------------------------------------- 绘制原语 */
const BG = L.hex2rgb('#1b1f24'); // 与 capacitor.config backgroundColor / CSS --stone-3 一致

function fill(dst, dw, dh, rgb) {
  for (let i = 0; i < dw * dh; i++) {
    dst[i * 4] = rgb[0]; dst[i * 4 + 1] = rgb[1]; dst[i * 4 + 2] = rgb[2]; dst[i * 4 + 3] = 255;
  }
}
/**
 * 整数倍最近邻 blit；dx = 目标**左**边，footY = 目标**底**边（脚底锚定）。
 * ★ 两个必须记住的 `lib.mjs` 契约（本脚本第一版就是死在这里）：
 *   ① `nearestScale()` 返回 **`{rgba,width,height}`** 对象，**不是**裸数组 ⇒ 取 `.rgba`；
 *   ② `pasteRGBA()` 是**纯函数**（`const out = new Uint8ClampedArray(dst)`）⇒ **返回新缓冲、不改入参**
 *      ⇒ 必须**串接返回值**，否则一像素都画不上（且**不会抛**，静默全空）。这里统一 `return` 新缓冲。
 */
function blit(dst, dw, dh, name, dx, footY, k, { flipX = false } = {}) {
  const f = frame(name);
  const scaled = L.nearestScale(f.rgba, f.w, f.h, k).rgba;   // ← ① .rgba
  const sw = f.w * k, sh = f.h * k;
  let src = scaled;
  if (flipX) {
    src = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const s = (y * sw + (sw - 1 - x)) * 4, t = (y * sw + x) * 4;
      src[t] = scaled[s]; src[t + 1] = scaled[s + 1]; src[t + 2] = scaled[s + 2]; src[t + 3] = scaled[s + 3];
    }
  }
  return L.pasteRGBA(dst, dw, dh, src, sw, sh, Math.round(dx), Math.round(footY - sh)); // ← ② 串接
}
/** 确定性伪随机（避免平铺读成壁纸） */
const hash = (a, b) => { let h = (a * 73856093) ^ (b * 19349663); h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/* ---------------------------------------------------------------- 构图 */
/**
 * 一块「浮空岛」：草皮一行 + 土两层（最底两层逐层内收）⇒ 有厚度的台地。
 * 所有立绘**脚底锚在草皮上沿**。
 *
 * ★ 竖向定位由 `safe`（**保证可见区**，由各档 cover+居中裁切反推，见 safeArea()）决定：
 *   内容总高 = 城堡(3T) + 台地(3T) = 6T，在安全区内**竖向居中** ⇒ 26 档里任何比例都不裁主体。
 */
function compose({ W, H, k, tiles, safe, dirtRows = 2 }) {
  let dst = new Uint8ClampedArray(W * H * 4);      // ★ 因 pasteRGBA 是纯函数 ⇒ dst 一路重绑
  fill(dst, W, H, BG);

  const T = 32 * k;                 // 一格的目标像素
  const islandW = tiles * T;
  const X0 = Math.round((W - islandW) / 2);
  const sTop = safe.y0 * H, sBot = safe.y1 * H;
  const contentH = (3 + 1 + dirtRows) * T;          // 城堡 3T（草皮面之上）+ 台地 (1+dirtRows)T
  const surfaceY = Math.round(sTop + (sBot - sTop - contentH) / 2 + 3 * T);  // 草皮上沿

  const tile = (name) => L.nearestScale(frame(name).rgba, 32, 32, k).rgba;

  // ① 草皮（三变体轮换）
  const grass = ['g_grass_0', 'g_grass_1', 'g_grass_2'];
  for (let i = 0; i < tiles; i++) {
    const n = grass[Math.floor(hash(i, 3) * 3) % 3];
    dst = L.pasteRGBA(dst, W, H, tile(n), T, T, X0 + i * T, surfaceY);
  }
  // ② 土层 dirtRows 层，逐层两侧内收（深处收窄 ⇒ 读作"浮空岛"而非"地面"）
  const dirt = ['g_dirt_0', 'g_dirt_1', 'g_dirt_2'];
  const maxInset = Math.floor((tiles - 1) / 2);
  for (let row = 0; row < dirtRows; row++) {
    const inset = Math.min(row, maxInset);       // 0,1,2… ⇒ 从与草皮同宽逐层收成一个锥
    const y = surfaceY + T * (row + 1);
    for (let i = inset; i < tiles - inset; i++) {
      const n = dirt[Math.floor(hash(i, 7 + row) * 3) % 3];
      dst = L.pasteRGBA(dst, W, H, tile(n), T, T, X0 + i * T, y);
    }
  }

  const placed = [];   // 每个立绘的 bbox —— 供"主体是否落在安全区"的可核断言
  const cx = (t) => X0 + t * T + T / 2;          // 第 t 格中心（t 可半格）
  const Lmin = Math.ceil(safe.x0 * W), Rmax = Math.floor(safe.x1 * W);   // 保证可见区（横）
  const at = (name, t, opt) => {
    const f = frame(name), cw = f.w * k, ch = f.h * k;
    let left = Math.round(cx(t) - cw / 2);
    // ★ 横向钳进保证可见区。land 的岛 ⊂ 安全区（自然满足）；port 的岛比安全区宽，
    //   故最外侧的树会被钳进来 —— 26 档任何比例都不裁主体。断言仍独立复核它没被钳错。
    left = Math.max(Lmin, Math.min(Rmax - cw, left));
    const top = surfaceY - ch;
    dst = blit(dst, W, H, name, left, surfaceY, k, opt);
    placed.push({ name, left, top, right: left + cw, bottom: surfaceY });
  };

  // 布局按 tiles **等比**（k 或 tiles 一变，间距随之缩放；比例沿用首版构图）
  at('mtn0', tiles * 0.10);                                   // ③ 远景（先画 = 在城堡之后）
  at('tree0', tiles * 0.86);
  at('rock0', tiles * 0.30);
  at('castle_p1_0', tiles * 0.50);                            // ④ 主体：城堡居中
  at('u_p1_templar_map', tiles * 0.24);                       // ⑤ 前景：两族单位 + 英雄
  at('u_p2_wolfrider_map', tiles * 0.74, { flipX: true });
  at('hero_p1', tiles * 0.64);

  return { dst, surfaceY, X0, islandW, T, placed };
}

/* ---------------------------------------------------------------- 夜色（成本≈0）*/
/** 朝深蓝压暗 + 轻降饱和；纯后处理，同一构图再出一份。 */
function nightify(rgba, w, h) {
  const NIGHT = L.hex2rgb('#141d33');
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    // ★ 注意 lib.mjs 的**不对称契约**：rgbToHsl() 返回 {h,s,l} 对象，而 hslToRgb(h,s,l) 收**位置参**。
    const { h, s, l } = L.rgbToHsl(rgba[o], rgba[o + 1], rgba[o + 2]);
    const [r2, g2, b2] = L.hslToRgb(h, s * 0.82, l * 0.62);
    out[o] = Math.round(r2 * 0.72 + NIGHT[0] * 0.28);
    out[o + 1] = Math.round(g2 * 0.72 + NIGHT[1] * 0.28);
    out[o + 2] = Math.round(b2 * 0.72 + NIGHT[2] * 0.28);
    out[o + 3] = 255;
  }
  return out;
}
/** 夜色后，背景也应同夜 ⇒ 用同一条变换压一遍（保持"整幅同夜"）。 */

/* ---------------------------------------------------------------- 各档目标 & 保证可见区 */
/**
 * 现存 26 个变体的**实际**尺寸（本脚本自己量，不抄文档）。
 * 规则：**cover 缩放 + 居中裁切**（不留边、构图居中）。
 */
function variantTargets() {
  const resDir = path.join(WEB, 'android/app/src/main/res');
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/^splash.*\.png$/.test(e.name)) continue;
      const b = readFileSync(p);
      out.push({ rel: path.relative(resDir, p), w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
    }
  };
  walk(resDir);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const ALL = variantTargets();
const isPortRel = (rel, w, h) => /^drawable-port/.test(rel) || h > w;

/**
 * ★ 由变体集**反推**「保证可见区」：cover 缩放 + 居中裁切后，母图上仍然可见的区域（分数）。
 * 取全体变体的**交集** ⇒ 把主体放进交集中，26 档**任何比例**都不会裁到主体。
 */
function safeArea(mw, mh, vs) {
  let x0 = 0, x1 = 1, y0 = 0, y1 = 1;
  for (const v of vs) {
    const k = Math.max(v.w / mw, v.h / mh);            // cover
    const fx0 = (mw - v.w / k) / 2 / mw, fx1 = (mw + v.w / k) / 2 / mw;
    const fy0 = (mh - v.h / k) / 2 / mh, fy1 = (mh + v.h / k) / 2 / mh;
    x0 = Math.max(x0, fx0); x1 = Math.min(x1, fx1);
    y0 = Math.max(y0, fy0); y1 = Math.min(y1, fy1);
  }
  return { x0, x1, y0, y1 };
}

/* ---------------------------------------------------------------- 出图 */
const jobs = [
  { key: 'land', W: 1920, H: 1280, k: 5, tiles: 10, dirtRows: 2 },
  { key: 'port', W: 1280, H: 1920, k: 6, tiles: 6, dirtRows: 3 },
];
for (const j of jobs) {
  j.safe = safeArea(j.W, j.H, ALL.filter((v) => isPortRel(v.rel, v.w, v.h) === (j.key === 'port')));
}

const spec = {
  generatedAt: new Date().toISOString(),
  inputs: INPUTS,
  note: '母图由 assets/_pipeline/splash.mjs 从本仓程序化图集合成；像素 100% 来自 dist/render/atlas.js ⇒ 无水印、无第三方授权面。',
  scaleRule: 'cover 缩放（k = max(tw/mw, th/mh)）+ 居中裁切；母图主体**全部落在保证可见区**内 ⇒ 26 档任何比例都不裁到主体。',
  masters: {},
  variants: [],
};

for (const j of jobs) {
  const { dst, placed } = compose(j);
  // ★ 可核断言：每个立绘 bbox 必须落在「保证可见区」内（否则 26 档里必有一档裁到它）
  const S = { l: j.safe.x0 * j.W, r: j.safe.x1 * j.W, t: j.safe.y0 * j.H, b: j.safe.y1 * j.H };
  const violations = placed.filter((p) => p.left < S.l || p.right > S.r || p.top < S.t || p.bottom > S.b);
  const base = path.join(OUT, `splash_${j.key}_${j.W}x${j.H}`);
  const enc = (rgba, tag) => {
    const r = L.encodePngIndexed(j.W, j.H, rgba, 256);   // → {buf, colors}（colors 是**数**，不是集合）
    const p = `${base}${tag}.png`;
    writeFileSync(p, r.buf);
    return { file: path.basename(p), bytes: r.buf.length, colors: r.colors, md5: md5(p) };
  };
  spec.masters[j.key] = {
    size: `${j.W}x${j.H}`, integerScale: j.k, islandTiles: j.tiles, dirtRows: j.dirtRows,
    safeVisibleArea: `x ${(j.safe.x0 * 100).toFixed(2)}%–${(j.safe.x1 * 100).toFixed(2)}% · y ${(j.safe.y0 * 100).toFixed(2)}%–${(j.safe.y1 * 100).toFixed(2)}%`,
    safeRectPx: { l: Math.round(S.l), r: Math.round(S.r), t: Math.round(S.t), b: Math.round(S.b) },
    subjectsInsideSafe: violations.length === 0,
    subjectViolations: violations,
    subjects: placed,
    day: enc(dst, ''),
    night: enc(nightify(dst, j.W, j.H), '_night'),
  };
  if (violations.length) console.error(`★ ${j.key}：${violations.length} 个主体越出保证可见区 →`, violations.map((v) => v.name).join(','));
}

for (const v of ALL) {
  const isPort = isPortRel(v.rel, v.w, v.h);
  const m = spec.masters[isPort ? 'port' : 'land'];
  const [mw, mh] = m.size.split('x').map(Number);
  const k = Math.max(v.w / mw, v.h / mh);
  spec.variants.push({
    rel: v.rel, target: `${v.w}x${v.h}`, master: isPort ? 'port' : 'land',
    coverScale: Number(k.toFixed(5)), crop: `${Math.round(mw * k - v.w)}×${Math.round(mh * k - v.h)}`,
  });
}

writeFileSync(path.join(OUT, 'splash_spec.json'), JSON.stringify(spec, null, 2));

const md = [];
md.push('# `#162` 启动图母图 —— 规格与「母图 → 各档」缩放说明\n');
md.push('> 生成物：`assets/_pipeline/splash.mjs`（可复算）。**像素 100% 来自本仓程序化图集** `dist/render/atlas.js` ⇒ **无水印、无第三方授权面**。');
md.push(`> 绑定（构建输入）：\`dist/render/atlas.js\` md5 \`${INPUTS['dist/render/atlas.js']}\` · \`dist/main.js\` md5 \`${INPUTS['dist/main.js']}\`\n`);
md.push('## 母图\n');
md.push('| 取向 | 目标尺寸 | 整数倍 | 台地格数 | 保证可见区 | 主体全在区内 | 日间 | 夜间 |');
md.push('|---|---|---|---|---|---|---|---|');
for (const [k, m] of Object.entries(spec.masters)) {
  md.push(`| ${k} | **${m.size}** | ×${m.integerScale} | ${m.islandTiles} | ${m.safeVisibleArea} | ${m.subjectsInsideSafe ? '✓ 是' : '✗ 否'} | \`${m.day.file}\` ${m.day.bytes} B / ${m.day.colors} 色 | \`${m.night.file}\` ${m.night.bytes} B / ${m.night.colors} 色 |`);
}
md.push('\n## 缩放规则\n');
md.push(spec.scaleRule);
md.push('\n## 母图 → 26 个现存变体\n');
md.push('| 变体 | 目标 | 用哪张母图 | cover 倍率 | 裁掉 |');
md.push('|---|---|---|---|---|');
for (const v of spec.variants) md.push(`| \`${v.rel}\` | ${v.target} | ${v.master} | ×${v.coverScale} | ${v.crop} |`);
writeFileSync(path.join(OUT, 'splash_spec.md'), md.join('\n') + '\n');

console.log(JSON.stringify({
  inputs: INPUTS, variantCount: spec.variants.length,
  masters: Object.fromEntries(Object.entries(spec.masters).map(([k, m]) => [k, {
    size: m.size, scale: m.integerScale, tiles: m.islandTiles,
    safe: m.safeVisibleArea, safeRectPx: m.safeRectPx,
    subjectsInsideSafe: m.subjectsInsideSafe,
    day: `${m.day.bytes}B/${m.day.colors}c/${m.day.md5.slice(0, 10)}`,
    night: `${m.night.bytes}B/${m.night.colors}c/${m.night.md5.slice(0, 10)}`,
  }])),
}, null, 2));
