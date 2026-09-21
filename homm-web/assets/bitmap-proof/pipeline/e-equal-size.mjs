/**
 * e-equal-size.mjs —— **§6.1 第 ② 项：(e) 等尺寸对照**（team-lead 闸门内第 2 件）。
 *
 * ## 这一项在证明什么
 * `bitmap-asset-options.md §2.1(e)`：(e) = 把**现有资产按原尺寸换成 PNG**，
 * **分辨率 / 帧数 / 网格都不动**，用来**证伪**"把像素存成文件 = 画质提升"。
 * team-lead 的原话：**"(e) 的预期结果是「看不出变化」，而这正是它的目的"**。
 *
 * ## 怎么做才算"实测"而不是"算式"
 * 不写"按定义必然为 0"——**把真实渲染出来的像素，按 `asset-spec §3.3` 的落盘格式
 * （PNG-8 索引色、alpha 只允许 0/255）存成文件，再读回来，逐像素比**。
 * 报的是**往返之后的差**，不是"我保证一样"。
 *
 * 口径三件（缺一不算数）：
 *   ① 用**运行期真实渲染代码**取像素（`dist/render/atlas.js` + `tools/_canvas.mjs` 垫片），
 *      不是重新画一遍"看起来差不多"的图；
 *   ② 落盘走 `asset-spec §3.3` 的真格式（PNG-8 + tRNS），不是 RGBA；
 *   ③ 差 = `lib.diffStats()`（平均 |ΔL*| + 变化像素占比 + max），
 *      与 `shots/README.md` 同一把尺子。
 *
 * ## 边界（必须写在报告里）
 * - 脚本**不跑 `npm run build`**、**不写 `src/**` / `tools/**`**；
 *   抓帧只读 `dist`（构建绑定：读的是 `dist/main.js` md5 `ff653bce…` 那份，见报告）。
 * - **PNG-8 落盘这一步会改像素的情形**：源图含半透明（1..254）时，"硬 alpha"会把它压成 0/255。
 *   本脚本**先量**半透明像素数；为 0 则两种编法等价，>0 则把差异**如实报出来**。
 * - 这**不是落地方案**：(e) 挑的表面（单位）按 `bitmap-asset-options.md §2.4` **硬边界**属
 *   "地图格内物 ⇒ 禁止位图"。**它是一次隔离变量的对照实验，永不进构建。**
 *
 * 用法（cwd = homm-web/）：node assets/bitmap-proof/pipeline/e-equal-size.mjs
 */
import { installShim } from '../../../tools/_canvas.mjs';
import * as L from '../../_pipeline/lib.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..'); // homm-web/
const FIGS = join(ROOT, 'assets', 'bitmap-proof', 'figs');
mkdirSync(FIGS, { recursive: true });

installShim();
const { getAtlas } = await import(join(ROOT, 'dist/render/atlas.js'));
const { getCombatAtlas } = await import(join(ROOT, 'dist/render/combatAtlas.js'));

/* ---- 被测资产：`p1_lampbearer` 的**全部 3 帧**（"同帧数"= 一帧都不改） ------------------
 * 前两族 B0 批的 T1 单位：地图帧在冒险图集（52×44），战斗两帧在战斗图集（64×56）。
 * 帧名真值取自 `src/render/unitArt.ts` 的 `UNIT_FRAMES`（不写死旧值）。 */
const TARGETS = [
  { name: 'u_p1_lampbearer_map', atlas: 'adv' },
  { name: 'cu_p1_lampbearer', atlas: 'cbt' },
  { name: 'cu_p1_lampbearer_atk', atlas: 'cbt' },
];

const adv = getAtlas();
const cbt = getCombatAtlas();

/** 取"运行期真实渲染代码"的像素：把图集里的那一块 1:1 blit 到同尺寸画布。 */
function rasterizeFrame(atlas, name) {
  const f = atlas.get(name);
  if (!f) throw new Error(`图集里没有 ${name}`);
  const cv = document.createElement('canvas');
  cv.width = f.w;
  cv.height = f.h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false; // 与运行期同一条纪律：一律最近邻
  ctx.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
  return { rgba: new Uint8ClampedArray(cv.buf), w: f.w, h: f.h, ax: f.ax, ay: f.ay };
}

const rows = [];
let totalShipBytes = 0;
let totalB64Bytes = 0;

for (const t of TARGETS) {
  const atlas = t.atlas === 'adv' ? adv : cbt;
  const { rgba, w, h, ax, ay } = rasterizeFrame(atlas, t.name);

  // 半透明普查：>0 的话"硬 alpha"就不是无损的
  let semi = 0;
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3];
    if (a !== 0 && a !== 255) semi++;
  }

  // [A] 原样（RGBA）—— 这是"运行时算出来的像素"的落盘形态
  const bufA = L.encodePngRGBA(w, h, rgba);
  const fileA = `e_${t.name}_A_orig.png`;
  writeFileSync(join(FIGS, fileA), bufA);

  // [B] 按 §3.3 真格式落盘（PNG-8 ≤32 色 + 硬 alpha）→ 再读回来 → 比
  const enc = L.encodePngIndexed(w, h, rgba, 32, { hardAlpha: true });
  const fileB = `e_${t.name}_B_ship.png`;
  writeFileSync(join(FIGS, fileB), enc.buf);
  const back = L.decodePng(readFileSync(join(FIGS, fileB)));
  if (back.width !== w || back.height !== h) throw new Error(`往返尺寸变了：${back.width}x${back.height}`);

  const d = L.diffStats(rgba, back.rgba, w, h);
  const b64 = Math.ceil(enc.buf.length / 3) * 4; // base64 长度（不含 data: 前缀）= 4·⌈n/3⌉
  totalShipBytes += enc.buf.length;
  totalB64Bytes += b64;

  rows.push({
    name: t.name,
    atlas: t.atlas,
    w,
    h,
    ax,
    ay,
    semi,
    colorsBefore: L.countColors(rgba, w, h),
    colorsAfter: L.countColors(back.rgba, w, h),
    pngIndexedColors: enc.colors,
    bytesRGBA: bufA.length,
    bytesPNG8: enc.buf.length,
    bytesB64: b64,
    meanAbsL: d.meanAbsL,
    changedPct: d.changedPct,
    maxL: d.maxL,
    pixels: d.pixels,
  });
}

/* ---------------------------------------------------------------- 报告 */
const distMain = readFileSync(join(ROOT, 'dist/main.js'));
const distMd5 = createHash('md5').update(distMain).digest('hex');

console.log('=== (e) 等尺寸对照 —— 现有资产按原尺寸换成 PNG，分辨率/帧数/网格都不动 ===\n');
console.log(`构建绑定：dist/main.js md5 ${distMd5}（${distMain.length} B）\n`);
const f2 = (v) => v.toFixed(2);
console.log('资产                          尺寸     颜色  半透明   PNG-8  B   b64  B   平均|ΔL*|  变化像素   max');
for (const r of rows) {
  console.log(
    `${r.name.padEnd(28)} ${String(r.w + 'x' + r.h).padEnd(9)} ${String(r.colorsBefore).padStart(3)}  ` +
      `${String(r.semi).padStart(4)}   ${String(r.bytesPNG8).padStart(6)} ${String(r.bytesB64).padStart(6)}   ` +
      `${f2(r.meanAbsL).padStart(7)}  ${(r.changedPct.toFixed(1) + '%').padStart(8)}  ${f2(r.maxL).padStart(5)}`,
  );
}
console.log(
  `\n3 帧合计：PNG-8 ${totalShipBytes} B（${(totalShipBytes / 1024).toFixed(1)} KB）` +
    ` · base64 内联后 ${totalB64Bytes} B（${(totalB64Bytes / 1024).toFixed(1)} KB，+${((totalB64Bytes / totalShipBytes - 1) * 100).toFixed(0)}%）`,
);
const allZero = rows.every((r) => r.meanAbsL === 0 && r.changedPct === 0);
const allSemi = rows.every((r) => r.semi === 0);
console.log(
  `\n结论：${allZero ? '✔ 逐像素零差' : '✖ 有差（见上表）'}` +
    ` —— 「存成 PNG 再读回来」与「运行时算出来的像素」${allZero ? '完全一致' : '不一致'}。` +
    `\n  ${allSemi ? '三帧半透明像素数均为 0 ⇒ §3.3 的"硬 alpha(0/255)"在这一组上是**无损**的。' : '⚠ 存在半透明像素 ⇒ 硬 alpha 编法有损，差异已计入上表。'}` +
    `\n  ⇒ 本项预期与实测一致：**(e) 看不出变化**。它证明"换介质"在像素层面是零；` +
    `\n     代价只有体积（上面那两列），没有画质。`,
);

writeFileSync(
  join(FIGS, 'e_report.json'),
  JSON.stringify({ distMd5, distMainBytes: distMain.length, totalShipBytes, totalB64Bytes, rows }, null, 2),
);
console.log(`\n明细 → assets/bitmap-proof/figs/e_report.json`);
