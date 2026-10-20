#!/usr/bin/env node
/**
 * tp8crest.mjs —— **TP-8③：AI 立绘 `crestL_p1` 的机械化验收**（asset-spec §9.1 第 7 个资产）。
 *
 * ## 为什么需要这一支
 * `b0audit.mjs` 把这张图留在 MANUAL（见其「人工验收项」[3] / [+]）：
 *   > [3] 钳色后同色域（仅 AI 那一半）MANUAL 依赖 AI 资产 crestL_p1（256×384），本轮未产出
 * 而 `assets/_pipeline/audit-deliverables.mjs` 虽然 25/25 全绿，但它量的是**文件是否存在 /
 * 尺寸 / 字节数**，**没有一条**断言"颜色是否落在游戏色板里"。于是出现一个尴尬的空档：
 *   「AI 资产验收」这件事，谁都没真正做过。
 * 本闸就是把那句话变成可执行断言：**AI 资产的每一个不透明像素，都必须属于 `B0_PALETTE`**。
 *
 * ## 闸门（每条都可判红绿，无"人工项"）
 *   [Dims]   256×384（asset-spec §3.3 / §9.1 AI-1）
 *   [Bytes]  ≤ 24576 B（§3.3：普通精灵 ≤8 KB，`crestL_*` 放宽到 24 KB）
 *   [Colors] ≤ 32 色（PNG-8；§5.1 第 7 步 `encodePngIndexed(32)` 超色直接抛）
 *   [Alpha]  α ∈ {0,255}（硬透明；半透明边在 8:1 块众数降采样后必然是脏边）
 *   [Magenta]0 个洋红残留（§5.2①：抠底必须在降采样之前，否则粉边再也去不掉）
 *   [Ring]   2px ink0 描边：**从轮廓向内数的第 1、2 层必须 100% 是 ink0**
 *   [Pal]    不透明色 100% ∈ `B0_PALETTE`   ← 本条是全闸存在的理由
 *   [Ppipe]  管线色板 `buildPalette()` ⊆ `B0_PALETTE`（根因检查：钳色目标集本身跑偏）
 *
 * ## 为什么 [Pal] 和 [Ppipe] 要分开
 * 只查 [Pal] 会得到"图不对"，然后人会去改图；但图是**管线的输出**，
 * 管线把颜色钳到一套**游戏里不存在**的色板上 ⇒ 下次重跑又脏。
 * 两条一起查，才能把"哪一步错了"钉死到 `assets/_pipeline/lib.mjs` 的 `fac.neutral` 上。
 *
 * ## 刻意不共享的东西
 * 只从 `assets/_pipeline/lib.mjs` 借 `decodePng`（纯解码，不含任何判据）。
 * **不借** `buildPalette()` 当"应该的颜色"、**不借** `clampToPalette()` 判"钳得对不对"，
 * 否则就是让被测方给自己出卷子。期望色板一律取构建产物里的 `B0_PALETTE`（游戏真正用的那套）。
 *
 * 用法（cwd = homm-web/）：
 *   node tools/tp8crest.mjs                     # 默认查 assets/sprites/crestL/crestL_p1.png
 *   node tools/tp8crest.mjs --file=<x.png>      # 查别的文件（负向对照 / 交叉验证）
 *   node tools/tp8crest.mjs --report=<out.md>   # 同时写一份人看的报告
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { distDir, distUrl, printHeader, argOf, REPO_ROOT } from './_dist.mjs';
import { decodePng } from '../assets/_pipeline/lib.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=tp8crest');

const art = await import(distUrl('render/unitArt.js', DIST));
const { B0_PALETTE } = art;

const FILE = path.resolve(REPO_ROOT, argOf('file', 'assets/sprites/crestL/crestL_p1.png'));
const REPORT = argOf('report', null);

const WANT_W = 256;
const WANT_H = 384;
const MAX_BYTES = 24 * 1024;
const MAX_COLORS = 32;
const INK0 = B0_PALETTE.find((e) => e.family === 'ink0').hex.toLowerCase();
const PALETTE = new Set(B0_PALETTE.map((e) => e.hex.toLowerCase()));
const RING_W = 2;

/* ------------------------------------------------------------------ 工具 */

const hexOf = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const RGB = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}
function lstar(r, g, b) {
  const f = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const Y = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
}
function dE76(a, b) {
  const [r1, g1, b1] = RGB(a).map((v) => v / 255);
  const [r2, g2, b2] = RGB(b).map((v) => v / 255);
  // ⚠️ RGB 必须先归一到 0..1 再进 sRGB→XYZ 矩阵；忘了归一化会得到 ΔE≈96 这种
  // 一眼假的数（v1 就是这么错的，被"建议"栏里 96/113 的荒诞值暴露）。
  const lab = (r, g, b) => {
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const Y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 1.0;
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  };
  const p = lab(r1, g1, b1), q = lab(r2, g2, b2);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/**
 * 「按 §5.2③ 的规矩，这个色最该被钳到哪个色板色」—— 与 `clampToPalette` 同一套分桶：
 * 近中性（s<0.2）只比明度，其余先分 5 个明度台阶再比色相。
 * 这里**只用它给修复建议**，不参与判红绿（判据始终是"是否 ∈ 色板"这一件事）。
 */
function suggest(hex) {
  const { h, s, l } = rgbToHsl(...RGB(hex));
  const bin = Math.min(4, Math.max(0, Math.floor(l * 5)));
  const neutral = s < 0.12;
  let best = null;
  for (const e of B0_PALETTE) {
    const q = rgbToHsl(...RGB(e.hex));
    if (Math.min(4, Math.max(0, Math.floor(q.l * 5))) !== bin) continue;
    if (neutral) {
      const d = Math.abs(q.l - l);
      if (!best || d < best.d) best = { hex: e.hex, family: e.family, idx: e.idx, d };
    } else {
      const dh = Math.min(Math.abs(q.h - h), 1 - Math.abs(q.h - h));
      const d = dh + Math.abs(q.l - l) * 0.5;
      if (!best || d < best.d) best = { hex: e.hex, family: e.family, idx: e.idx, d };
    }
  }
  return best;
}

/* ------------------------------------------------------------------ 读数 */

const bytes = statSync(FILE).size;
const png = decodePng(readFileSync(FILE));
const { width: W, height: H, rgba } = png;

const results = [];
function gate(id, label, ok, detail = '') {
  results.push({ id, label, ok, detail });
  const mark = ok ? '✅' : '❌';
  console.log(`  ${mark} ${label} — ${detail}`);
}
const say = (id, msg, ok, detail = '') => {
  if (!ok) gate(id, msg, false, detail);
};

const px = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? [0, 0, 0, 0] : [
  rgba[(y * W + x) * 4],
  rgba[(y * W + x) * 4 + 1],
  rgba[(y * W + x) * 4 + 2],
  rgba[(y * W + x) * 4 + 3],
]);

console.log(`\n被测：${path.relative(REPO_ROOT, FILE)}  ${bytes} B  ${W}×${H}`);
console.log(`色板：B0_PALETTE ${B0_PALETTE.length} 色 · ink0=${INK0} · 描边 ${RING_W}px\n`);

/* [Dims] */
gate(
  'Dims',
  `尺寸 ${WANT_W}×${WANT_H}`,
  W === WANT_W && H === WANT_H,
  W === WANT_W && H === WANT_H ? `${W}×${H}` : `实得 ${W}×${H}`,
);

/* [Bytes] */
gate('Bytes', `文件 ≤ ${MAX_BYTES} B（≤24 KB）`, bytes <= MAX_BYTES, `${bytes} B（余量 ${MAX_BYTES - bytes}）`);

/* 逐像素统计 */
const colors = new Map(); // hex -> { n, minX, minY, maxX, maxY }
let opaque = 0, semi = 0, magenta = 0;

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const [r, g, b, a] = px(x, y);
    if (a === 0) continue;
    if (a !== 255) semi++;
    opaque++;
    const h = hexOf(r, g, b);
    const c = colors.get(h) ?? { n: 0, minX: x, minY: y, maxX: x, maxY: y };
    c.n++;
    if (x < c.minX) c.minX = x;
    if (y < c.minY) c.minY = y;
    if (x > c.maxX) c.maxX = x;
    if (y > c.maxY) c.maxY = y;
    colors.set(h, c);
    // 洋红残留（#ff00ff 系；抠底阈值 90 之后仍会有少量偏紫的边）
    if (r > 200 && g < 80 && b > 200) magenta++;
  }
}

/* [Colors] */
gate('Colors', `调色板 ≤ ${MAX_COLORS} 色（PNG-8）`, colors.size <= MAX_COLORS, `${colors.size} 色`);

/* [Alpha] */
gate('Alpha', 'α ∈ {0,255}（无半透明）', semi === 0, semi === 0 ? `${opaque} 个不透明像素` : `${semi} 个半透明像素`);

/* [Magenta] */
gate('Magenta', '0 个洋红残留', magenta === 0, `${magenta} px`);

/* [Ring] —— 分层判据
 *
 * 为什么不能用"透明像素离不透明 ≤2 ⇒ 必须被填"：描边的**外沿**天生就贴着透明区，
 * 这条判据对任何描边都不可能成立（实测宽容 2 时仍报 3928 px，纯属判据写错）。
 * 真正要保的是「**从轮廓向内数 2 层都是 ink0**」——1px 描边会在第 2 层露馅，
 * 无描边会在第 1 层就露馅，而 2px 描边刚好把两层填满。
 *
 * 分层口径：以**所有 alpha=0 像素**为源做 4-连通 BFS，不透明像素的层号 = 它到最近透明像素的步数。
 * 画布外一律视为透明（底下/右边被裁掉的精灵靠这条才判得对）。
 */
const layerDist = new Int16Array(W * H).fill(-1);
{
  const q = [];
  for (let i = 0; i < W * H; i++) if (rgba[i * 4 + 3] === 0) { layerDist[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (layerDist[j] !== -1) continue;
      layerDist[j] = layerDist[i] + 1;
      q.push(j);
    }
  }
}
const layerStat = [];
for (let L = 1; L <= RING_W; L++) {
  let n = 0, ink = 0, firstBad = null;
  for (let i = 0; i < W * H; i++) {
    if (rgba[i * 4 + 3] === 0 || layerDist[i] !== L) continue;
    n++;
    const h = hexOf(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    if (h === INK0) ink++;
    else if (!firstBad) firstBad = `${i % W},${(i / W) | 0}=${h}`;
  }
  layerStat.push({ L, n, ink, firstBad });
}
const ringBadLayers = layerStat.filter((s) => s.n > 0 && s.ink !== s.n);
gate(
  'Ring',
  `${RING_W}px ink0 描边：向内第 1~${RING_W} 层 100% ink0`,
  ringBadLayers.length === 0,
  layerStat.map((s) => `第${s.L}层 ${s.n} px / ink0 ${((s.ink / Math.max(1, s.n)) * 100).toFixed(1)}%`).join(' · ') +
    (ringBadLayers.length ? ` ← 例外首个 ${ringBadLayers[0].firstBad}` : ''),
);

/* [Pal] */
const off = [...colors.entries()]
  .filter(([h]) => !PALETTE.has(h))
  .map(([h, c]) => ({ hex: h, ...c, suggest: suggest(h) }))
  .sort((a, b) => b.n - a.n);
const offPx = off.reduce((s, o) => s + o.n, 0);
gate(
  'Pal',
  `不透明色 100% ∈ B0_PALETTE`,
  off.length === 0,
  off.length === 0
    ? `${colors.size}/${colors.size} 色在板内`
    : `${off.length} 色越界 · ${offPx} px（占不透明 ${((offPx / opaque) * 100).toFixed(3)}%）`,
);

/* [Ppipe] */
const pipePal = (await import('../assets/_pipeline/lib.mjs')).buildPalette();
const pipeOff = pipePal.filter((e) => !PALETTE.has(e.hex.toLowerCase()));
gate(
  'Ppipe',
  '管线色板 ⊆ B0_PALETTE（钳色目标集本身不许越界）',
  pipeOff.length === 0,
  pipeOff.length === 0
    ? `${pipePal.length}/${pipePal.length} 色在板内`
    : `${pipeOff.length}/${pipePal.length} 色越界：${pipeOff.map((e) => `${e.name}=${e.hex}`).join(' · ')}`,
);

/* ------------------------------------------------------------------ 越界明细 */

if (off.length) {
  console.log('\n── 越界色明细（按像素数排序）──');
  console.log('    色        像素   占不透明   包围盒            建议（§5.2③ 同款分桶）');
  for (const o of off) {
    const box = `${o.maxX - o.minX + 1}×${o.maxY - o.minY + 1} @${o.minX},${o.minY}`;
    const s = o.suggest;
    console.log(
      `    ${o.hex}  ${String(o.n).padStart(5)}  ${((o.n / opaque) * 100).toFixed(3).padStart(7)}%  ` +
        `${box.padEnd(16)}  ${s ? `${s.hex}（${s.family} idx${s.idx}，ΔE ${dE76(o.hex, s.hex).toFixed(1)}）` : '同台阶无候选'}`,
    );
  }
}

/* ------------------------------------------------------------------ 报告 */

if (REPORT) {
  const out = path.resolve(REPO_ROOT, REPORT);
  mkdirSync(path.dirname(out), { recursive: true });
  const lines = [
    `# TP-8③ ` + '`crestL_p1` 验收报告',
    '',
    `- 被测：\`${path.relative(REPO_ROOT, FILE)}\``,
    `- 字节：${bytes} B / ${MAX_BYTES} B · 像素：${W}×${H} · 不透明 ${opaque} px`,
    `- 色数：${colors.size} / ${MAX_COLORS} · 越界色 ${off.length} 个 / ${offPx} px`,
    '',
    '| 闸 | 判据 | 结果 | 读数 |',
    '|---|---|---|---|',
    ...results.map((r) => `| \`${r.id}\` | ${r.label} | ${r.ok ? '过' : '**不过**'} | ${r.detail} |`),
    '',
  ];
  if (off.length) {
    lines.push('## 越界色与建议', '', '| 色 | 像素 | 占比 | 建议 | ΔE |', '|---|---|---|---|---|');
    for (const o of off) {
      lines.push(
        `| \`${o.hex}\` | ${o.n} | ${((o.n / opaque) * 100).toFixed(3)}% | \`${o.suggest?.hex ?? '—'}\` (${o.suggest?.family ?? '—'}) | ${o.suggest ? dE76(o.hex, o.suggest.hex).toFixed(1) : '—'} |`,
      );
    }
    lines.push('');
  }
  writeFileSync(out, lines.join('\n'));
  console.log(`\n报告：${path.relative(REPO_ROOT, out)}`);
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${bad.length === 0 ? '✅' : '❌'} 共 ${results.length} 条断言：${results.length - bad.length} 过 / ${bad.length} 红`);
if (bad.length) console.log(`   红项：${bad.map((r) => r.id).join(' · ')}`);
process.exit(bad.length === 0 ? 0 : 1);
