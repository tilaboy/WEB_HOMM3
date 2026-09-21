/**
 * import-crestl.mjs —— **§6.1 第 ① 项：(b) 门面位图** 的 7 步管线（`asset-spec.md §5`）。
 *
 * 输入：`assets/bitmap-proof/raw/<raw>.png` —— **AI 出图原稿**（洋红底、1024×1536）。
 * 输出：`assets/sprites/crestL/crestL_p1.png` —— 落盘资产（**PNG-8 ≤32 色、tRNS、≤24 KB**）。
 *
 * 七步与实现（`asset-spec §5.1`）：
 *   [1] 抠底            `lib.keyOutBg(auto)`   —— ⚠️ **必须在降采样之前**（§5.2①：先降采样会把洋红平均成粉边，且再也抠不掉）
 *   [2] 块众数降采样 8:1 `lib.blockModeDownsample(8)` —— **不用 nearest/bilinear**（§5.2②：mode 才吃过渡带 + 自动量化）
 *   [3] 钳色            `lib.clampToPalette(base+p1)` —— §5.2③：**HSL 分桶后取同台阶色相最近者**，禁朴素 RGB 欧氏距离
 *   [4] 裁剪/缩放/落位  `cropBBox` → **整数比** `nearestScale` → `placeInto`（居中 + 底基线对齐）
 *   [5] 描边重建        `lib.outlineInk(ink0, 2)` —— §5.4：**丢掉 AI 自带的边**，这是"像一家人"的唯一决定步骤
 *   [6] 手工修          **本实现不做**（本项目零画师）⇒ 报告里如实写"未做"，不假装
 *   [7] 存 PNG-8        `lib.encodePngIndexed(32)` —— 超 32 色直接抛，不偷偷降级
 *
 * 边界：不写 `src/**` / `tools/**`；**不进构建**（`tools/postbuild.mjs` 只并 `public/` + `src/style.css`）。
 * 用法（cwd = homm-web/）：node assets/bitmap-proof/pipeline/import-crestl.mjs <raw.png> [--faction p1]
 */
import * as L from '../../_pipeline/lib.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const FIGS = join(ROOT, 'assets', 'bitmap-proof', 'figs');
const SPRITES = join(ROOT, 'assets', 'sprites');
const OUT_DIR = join(SPRITES, 'crestL');
mkdirSync(FIGS, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const rawPath = args.find((a) => !a.startsWith('--'));
const faction = (args.find((a) => a.startsWith('--faction=')) ?? '--faction=p1').split('=')[1];
/** `--out=<相对 homm-web 的路径>` / `--report=<figs 下的文件名>`：用于**交叉验证跑**
 *  （同一张原稿、第二条独立实现），默认落 `asset-spec §3.3` 的规范路径。 */
const outArg = args.find((a) => a.startsWith('--out='));
const reportArg = args.find((a) => a.startsWith('--report='));
if (!rawPath) {
  console.error('用法：node assets/bitmap-proof/pipeline/import-crestl.mjs <raw.png> [--faction=p1] [--out=assets/…/x.png] [--report=b_report.json]');
  process.exit(2);
}
const OUT_PATH = outArg ? join(ROOT, outArg.split('=').slice(1).join('=')) : join(OUT_DIR, `crestL_${faction}.png`);
const REPORT_NAME = reportArg ? reportArg.split('=').slice(1).join('=') : 'b_report.json';
mkdirSync(dirname(OUT_PATH), { recursive: true });

/* ---- 目标画布（`asset-spec §6` AI-1：`crestL_<faction>` = 256×384，**不进图集**，DOM <img>） ---- */
const CW = 256;
const CH = 384;
const K_BLOCK = 8; // §5.3：prompt 里要求 "each visible pixel block = 8×8 output pixels"
const NAME = `crestL_${faction}`;

const rawBuf = readFileSync(rawPath);
const raw = L.decodePng(rawBuf);
console.log(`[0] 出图  ${basename(rawPath)}  ${raw.width}×${raw.height}  ${rawBuf.length} B`);

/* [1] 抠底 —— 必须在降采样之前 */
const keyed = L.keyOutBg(raw.rgba, raw.width, raw.height, { mode: 'auto', threshold: 90 });
console.log(
  `[1] 抠底  bg=#${keyed.bg.map((x) => x.toString(16).padStart(2, '0')).join('')}` +
    `  键掉 ${keyed.keyed} px（${((keyed.keyed / (raw.width * raw.height)) * 100).toFixed(1)}%）` +
    `  洋红残留 ${keyed.residualPink} px  ← 断言 1 判据（应为 0）`,
);

/* [2] 块众数降采样 */
const ds = L.blockModeDownsample(keyed.rgba, raw.width, raw.height, K_BLOCK);
const colorsAfterDs = L.countColors(ds.rgba, ds.width, ds.height);
console.log(`[2] 降采样 ${raw.width}×${raw.height} /${K_BLOCK} → ${ds.width}×${ds.height}  颜色数 ${colorsAfterDs}`);

/* ---- [3b] 色数收敛（**`asset-spec §5` 的 7 步里缺的一步**） ------------------------------
 * 实测发现：只做 §5.2③ 的"钳到色板"**落不了盘** —— 色板共 **49** 条（基底 21 + 四族 6×4 + 中立 4），
 * 钳完实测 **40** 色 > `§3.3` 的 ≤32（更超 `§3.4` 的每精灵 ≤24）。⇒ 必须补一步"按用量收敛"。
 * 本实现**自带**（不引 `_pipeline/lib.mjs` 的 `reduceColors`，保证交叉验证是两条独立实现）：
 * 按用量保留前 cap-1 色（给 ink0 描边留 1 色），其余像素重映射到**最近的保留色**（同一色相-明度度量）。 */
function capColors(rgba, w, h, palette, cap) {
  const dist = (ph, pl, p) => {
    let dh = Math.abs(p.h - ph);
    if (dh > 180) dh = 360 - dh;
    return dh / 180 + Math.abs(p.l - pl) * 0.35;
  };
  const nearest = (r, g, b, pool) => {
    const { h: ph, l: pl } = L.rgbToHsl(r, g, b);
    let best = pool[0];
    let bestD = Infinity;
    for (const p of pool) {
      const d = dist(ph, pl, p);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  };
  const byHex = new Map(palette.map((p) => [p.hex, p]));
  // ① 逐像素钳到最近色板色（**以 hex 为准**：色板里有重复 hex，不能靠 indexOf）
  const use = new Map();
  const px = new Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) continue;
    const hex = nearest(rgba[o], rgba[o + 1], rgba[o + 2], palette).hex;
    px[i] = hex;
    use.set(hex, (use.get(hex) ?? 0) + 1);
  }
  // ② 按用量留前 cap-1
  const keptHex = [...use.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, cap - 1))
    .map(([hex]) => hex);
  const keptPool = keptHex.map((h) => byHex.get(h));
  const keptSet = new Set(keptHex);
  // ③ 其余重映射到最近的保留色
  const remap = new Map();
  for (const hex of use.keys()) {
    if (keptSet.has(hex)) continue;
    const p = byHex.get(hex);
    remap.set(hex, nearest(p.rgb[0], p.rgb[1], p.rgb[2], keptPool).hex);
  }
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) {
      out[o + 3] = 0;
      continue;
    }
    const hex = remap.get(px[i]) ?? px[i];
    const p = byHex.get(hex);
    out[o] = p.rgb[0];
    out[o + 1] = p.rgb[1];
    out[o + 2] = p.rgb[2];
    out[o + 3] = 255;
  }
  return { rgba: out, used: keptSet, dropped: use.size - keptHex.length };
}

/* [3] 钳色 —— 基底色板 + 四族主题色 */
const palette = L.buildPalette();
const clamped = L.clampToPalette(ds.rgba, ds.width, ds.height, palette);
const capped = capColors(clamped.rgba, ds.width, ds.height, palette, 23); // 留 1 色给 ink0
console.log(
  `[3] 钳色  ${colorsAfterDs} 色 → 色板命中 ${clamped.used.size}（色板全量 ${palette.length}）` +
    ` → **收敛到 ${capped.used.size} 色**（合并掉 ${capped.dropped} 个低频色）`,
);
console.log(
  `    ⚠️ 实测发现：\`asset-spec §5\` 的 7 步**没有"色数收敛"这一步** —— 只钳色会留下 ${clamped.used.size} 色，` +
    `落盘时直接撞 \`§3.3\` 的 ≤32 上限（第一次跑抛 "索引色超上限：>32 色"）。`,
);

/* [4] 裁剪 → 整数比缩放 → 落位 */
const bb = L.cropBBox(capped.rgba, ds.width, ds.height);
if (!bb.width) throw new Error('抠底后整张图全透明 —— 底色判定失败，检查 AI 原稿的底色');
const k = Math.max(1, Math.min(Math.floor(CW / bb.width), Math.floor(CH / bb.height)));
const sc = L.nearestScale(bb.rgba, bb.width, bb.height, k);
const placed = L.placeInto(sc.rgba, sc.width, sc.height, CW, CH, { align: 'center', vAlign: 'bottom' });
console.log(
  `[4] 裁剪 bbox ${bb.width}×${bb.height}@(${bb.x},${bb.y}) → 整数比 ×${k} → ${sc.width}×${sc.height}` +
    ` → 落位 ${CW}×${CH}（水平居中 dx=${placed.dx}、底对齐 dy=${placed.dy}）`,
);

/* [5] 描边重建 —— ≥65px 用 2px（`cartoon-style §1.1`） */
const OUTLINE_W = CH >= 65 ? 2 : 1;
const outlined = L.outlineInk(placed.rgba, CW, CH, '#2a1a12', OUTLINE_W);
const colorsFinal = L.countColors(outlined, CW, CH);
console.log(`[5] 描边重建 ink0 width=${OUTLINE_W}（丢掉 AI 自带的边）  终色数 ${colorsFinal}`);

/* [6] 手工修 —— 不做，如实记 */
console.log('[6] 手工修  **未做**（本项目零画师）—— 眼睛/毛边/穿模三类的状态见报告，不假装修过');

/* [7] 存 PNG-8 */
const enc = L.encodePngIndexed(CW, CH, outlined, 32, { hardAlpha: true });
const outFile = OUT_PATH;
writeFileSync(outFile, enc.buf);
const inlineBytes = Math.ceil(enc.buf.length / 3) * 4;
const outRel = outFile.slice(ROOT.length + 1);
console.log(
  `[7] 落盘  ${outRel}  ${enc.buf.length} B（${enc.colors} 色，预算 ≤24 KB` +
    `${enc.buf.length <= 24 * 1024 ? ' ✔' : ' ✖ 超预算 !'}）  内联 base64 ${inlineBytes} B`,
);

/* 页面用预览：PNG-8 读回来 → 1:1 RGBA（保证页面显示的就是落盘文件，不是内存里的中间态） */
const back = L.decodePng(readFileSync(outFile));
const previewName = REPORT_NAME === 'b_report.json' ? `b_${NAME}_ship.png` : REPORT_NAME.replace(/\.json$/, '.png');
writeFileSync(join(FIGS, previewName), L.encodePngRGBA(back.width, back.height, back.rgba));

const distMain = readFileSync(join(ROOT, 'dist/main.js'));
const report = {
  name: NAME,
  faction,
  distMd5: createHash('md5').update(distMain).digest('hex'),
  rawFile: basename(rawPath),
  rawW: raw.width,
  rawH: raw.height,
  rawBytes: rawBuf.length,
  bgHex: '#' + keyed.bg.map((x) => x.toString(16).padStart(2, '0')).join(''),
  keyedPx: keyed.keyed,
  residualPink: keyed.residualPink,
  blockK: K_BLOCK,
  dsW: ds.width,
  dsH: ds.height,
  colorsAfterDs,
  paletteUsed: [...clamped.used],
  paletteClampCount: clamped.used.size,
  colorsAfterCap: capped.used.size,
  capDropped: capped.dropped,
  colorsAfterOutline: colorsFinal,
  specGap:
    'asset-spec §5 的 7 步不含"色数收敛"：只钳色会留下 ' +
    clamped.used.size +
    ' 色 > §3.3 的 ≤32（更超 §3.4 的 ≤24）⇒ 落盘直接抛错。本实现补了一步按用量收敛到 23 色（给 ink0 留 1 色）。',
  bbox: { w: bb.width, h: bb.height, x: bb.x, y: bb.y },
  intScale: k,
  outW: CW,
  outH: CH,
  outlineWidth: OUTLINE_W,
  outColors: enc.colors,
  outBytes: enc.buf.length,
  inlineBytes,
  withinBudget24k: enc.buf.length <= 24 * 1024,
  step6ManualFix: 'not-done (no artist on team)',
};
writeFileSync(join(FIGS, REPORT_NAME), JSON.stringify(report, null, 2));
console.log(`\n明细 → assets/bitmap-proof/figs/${REPORT_NAME}`);
