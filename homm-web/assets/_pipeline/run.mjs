/**
 * run.mjs —— 产出 §6.1 的四项（`bitmap-asset-options.md` §6.1「产出」）：
 *   ① (b) 门面位图：`crestL_p1`（选族立绘 256×384），走 7 步管线
 *   ② (e) 等尺寸对照：**同设计 / 同尺寸**，程序化直出 vs 存 PNG-8 再读回
 *   ③ 改前/改后：真截图（改前）+ 合成示意（改后）—— 由 compose.mjs 出
 *   ④ 诚实预期说明：README.md（本脚本落 metrics.json，说明由人手写）
 *
 * 硬边界（team-lead 2026-09-21）：
 *   - 只写 `homm-web/assets/**`；**不碰 `src/**` / `tools/**` / `shots/**`**
 *   - (b) 只在「大尺寸 · 非平铺 · 静态 · 复用低」且**不在地图网格**的门面上（§2.4）
 *   - (e) **不改尺寸 / 帧数 / 网格**
 *   - (e) 的预期结果 = **「看不出变化」**，**不得包装成「提升」**
 *
 * 全仓**零位图**不变量在本脚本里没有被破坏：它不 import `src/**`、不写 `src/**`，
 * 只在 `assets/` 下产出「给用户看的证据图」。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installShim } from '../../tools/_canvas.mjs';
import * as L from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../..'); // homm-web/
const OUT = path.join(HERE, 'out');
mkdirSync(OUT, { recursive: true });

installShim();

const log = (...a) => console.log(...a);
const metrics = { generatedAt: new Date().toISOString(), steps: {}, panes: {} };

/* ---------------------------------------------------------------- 帧抽取 */
function frameRGBA(canvas, f) {
  const out = new Uint8ClampedArray(f.w * f.h * 4);
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const s = ((f.y + y) * canvas.width + (f.x + x)) * 4;
      const t = (y * f.w + x) * 4;
      out[t] = canvas.buf[s]; out[t + 1] = canvas.buf[s + 1];
      out[t + 2] = canvas.buf[s + 2]; out[t + 3] = canvas.buf[s + 3];
    }
  }
  return out;
}

const { getAtlas } = await import('../../dist/render/atlas.js');
const { getCombatAtlas } = await import('../../dist/render/combatAtlas.js');
const atlas = getAtlas();
const combat = getCombatAtlas();

const PALETTE = L.buildPalette();

function writeRGBA(name, w, h, rgba) {
  writeFileSync(path.join(OUT, name), L.encodePngRGBA(w, h, rgba));
}

function writeIndexed(name, w, h, rgba, maxColors) {
  const r = L.encodePngIndexed(w, h, rgba, maxColors);
  writeFileSync(path.join(OUT, name), r.buf);
  return { bytes: r.buf.length, colors: r.colors };
}

/* ================================================================ ① (b) crestL_p1 */
const rawDir = path.join(WEB, 'assets', 'ai-drafts');
const raws = existsSync(rawDir)
  ? readdirSync(rawDir).filter((f) => /(crestL_p1_raw|full_body).*\.png$/i.test(f)).sort()
  : [];
if (!raws.length) {
  log('⚠️  没有找到 AI 出图（assets/ai-drafts/crestL_p1_raw*.png）⇒ 跳过 (b)');
  metrics.steps.b = { status: 'no-ai-raw' };
} else {
  const rawName = raws[raws.length - 1];
  const raw = L.decodePng(readFileSync(path.join(rawDir, rawName)));
  log(`[0] 出图 ${rawName} = ${raw.width}×${raw.height}`);
  metrics.steps.b = { raw: rawName, rawSize: `${raw.width}×${raw.height}` };

  // [1a] 掩掉平台水印所在的**纯背景角落**（主体不经过）。见 lib.mjs maskRect 的说明。
  const WM = { x0: 0.82, y0: 0.92, x1: 1.0, y1: 1.0 };
  const beforeWm = L.opaqueCount(raw.rgba, raw.width, raw.height, WM);
  const masked = L.maskRect(raw.rgba, raw.width, raw.height, WM);
  const afterWm = L.opaqueCount(masked.rgba, raw.width, raw.height, WM);
  log(`[1a] 掩水印角落 x≥82% y≥92%：该区域非透明像素 ${beforeWm} → ${afterWm}`);
  metrics.steps.b.watermarkRect = WM;
  metrics.steps.b.watermarkPxInRect = beforeWm;
  metrics.steps.b.watermarkMasked = afterWm === 0;
  metrics.steps.b.watermarkFinding =
    '本环境 AI 出图**自带平台水印**（右下角 `AI生成 WORKBUDDY`，原图见 assets/ai-drafts/）⇒ 按 team-lead 硬边界「交付位图必须无水印 + 明确可商用」，**它不达标**。';

  // [1] 抠底（必须在降采样之前 —— §5.2①）
  const keyed = L.keyOutBg(masked.rgba, raw.width, raw.height, { mode: 'auto' });
  metrics.steps.b.bg = '#' + keyed.bg.map((v) => v.toString(16).padStart(2, '0')).join('');
  metrics.steps.b.keyedPx = keyed.keyed;
  metrics.steps.b.residualPink = keyed.residualPink;
  log(`[1] 抠底：底色 ${metrics.steps.b.bg}，键掉 ${keyed.keyed} px，洋红残留 ${keyed.residualPink} px`);

  // [2] 块众数降采样 8:1
  const K = 8;
  const ds = L.blockModeDownsample(keyed.rgba, raw.width, raw.height, K);
  const colorsPreClamp = L.countColors(ds.rgba, ds.width, ds.height);
  log(`[2] 块众数降采样 ${K}:1 → ${ds.width}×${ds.height}（钳色前 ${colorsPreClamp} 色）`);

  // [3] 调色板钳制 + 色数收敛（§3.3 ≤32 色落盘 / §3.4 ≤24 色）
  const cl0 = L.clampToPalette(ds.rgba, ds.width, ds.height, PALETTE);
  const cl = L.reduceColors(cl0.rgba, ds.width, ds.height, 24);
  log(`[3] 钳色 → ${cl0.used.size} 色，收敛到 ${cl.colors} 色（合并 ${cl.merged} 个，上限 24）`);

  // [4] 裁剪 → 整数比缩放 → 落位
  const bb = L.cropBBox(cl.rgba, ds.width, ds.height);
  const CW = 256, CH = 384;
  const kScale = Math.min(CW / bb.width, CH / bb.height) >= 2 ? 2 : 1;
  const up = L.nearestScale(bb.rgba, bb.width, bb.height, kScale);
  const placed = L.placeInto(up.rgba, up.width, up.height, CW, CH, { align: 'center', vAlign: 'bottom' });
  log(`[4] bbox ${bb.width}×${bb.height} → ×${kScale} = ${up.width}×${up.height} → 落位 ${CW}×${CH}（dx=${placed.dx}, dy=${placed.dy}）`);

  // [5] 描边重建（≥65px ⇒ 2px，cartoon-style §1.1）
  const finalColors = L.reduceColors(placed.rgba, CW, CH, 23); // 给 ink0 描边留 1 色
  const outlined = L.outlineInk(finalColors.rgba, CW, CH, '#2a1a12', 2);
  log('[5] 描边重建 ink0 2px');

  // [7] PNG-8 ≤32 色
  const encB = writeIndexed('b_crestL_p1.png', CW, CH, outlined, 32);
  writeRGBA('b_crestL_p1.preview.png', CW, CH, outlined);
  log(`[7] PNG-8 ${encB.bytes} B / ${encB.colors} 色 → out/b_crestL_p1.png`);
  metrics.steps.b.downsample = `${ds.width}×${ds.height}`;
  metrics.steps.b.colorsPreClamp = colorsPreClamp;
  metrics.steps.b.paletteUsed = cl0.used.size;
  metrics.steps.b.colorsFinal = cl.colors;
  metrics.steps.b.bbox = `${bb.width}×${bb.height}`;
  metrics.steps.b.scale = `×${kScale}`;
  metrics.steps.b.canvas = `${CW}×${CH}`;
  metrics.steps.b.pngBytes = encB.bytes;
  metrics.steps.b.pngColors = encB.colors;
  // [6] 手工修 = 如实记为「未做」
  metrics.steps.b.step6Manual = '未做（无画师）：§5.5 的「眼睛 / 毛毛边 / 遮挡穿模」三类需人手，本产出**未做**，见 README 诚实边界';
}

/* ================================================================ ② (e) 等尺寸对照 */
const E_CANVAS = { w: 64, h: 56 };
const eName = 'cu_p1_lampbearer';
const ef = combat.get(eName);
if (!ef) throw new Error(`战斗图集缺 ${eName}`);
const proc = frameRGBA(combat.canvas, ef);
writeRGBA('e_proc_direct.png', E_CANVAS.w, E_CANVAS.h, proc);
const procColors = L.countColors(proc, E_CANVAS.w, E_CANVAS.h);

// 「换个介质」= 同一张图存成 PNG-8 位图文件、再读回来
let eEnc;
try {
  eEnc = L.encodePngIndexed(E_CANVAS.w, E_CANVAS.h, proc, 32);
  metrics.panes.e = { png8Cap: 32 };
} catch {
  eEnc = L.encodePngIndexed(E_CANVAS.w, E_CANVAS.h, proc, 256);
  metrics.panes.e = { png8Cap: 256, note: '程序化帧的色数 > 32 ⇒ 要落成 §3.3 的 ≤32 色就必须量化' };
}
writeFileSync(path.join(OUT, 'e_bitmap_samesize.png'), eEnc.buf);
const back = L.decodePng(eEnc.buf);
const dSame = L.diffStats(proc, back.rgba, E_CANVAS.w, E_CANVAS.h);
writeRGBA('e_bitmap_back.preview.png', E_CANVAS.w, E_CANVAS.h, back.rgba);
log(`[e] ${eName} ${E_CANVAS.w}×${E_CANVAS.h}：程序化 ${procColors} 色 → PNG-8(${eEnc.colors} 色) ${eEnc.buf.length} B`);
log(`[e] 同设计同尺寸 Δ：平均 |ΔL*| ${dSame.meanAbsL.toFixed(3)} / 最大 ${dSame.maxL.toFixed(1)} / 变化像素 ${dSame.changedPct.toFixed(1)}%`);

// §3.3 的 ≤32 色版本（若原帧色数 > 32，量化会引入 Δ —— 如实报）
let d32 = null;
if (procColors > 32) {
  const q = L.clampToPalette(proc, E_CANVAS.w, E_CANVAS.h, PALETTE);
  const qe = L.encodePngIndexed(E_CANVAS.w, E_CANVAS.h, q.rgba, 32);
  const qb = L.decodePng(qe.buf);
  d32 = L.diffStats(proc, qb.rgba, E_CANVAS.w, E_CANVAS.h);
  writeRGBA('e_png32_back.preview.png', E_CANVAS.w, E_CANVAS.h, qb.rgba);
  log(`[e] 若收紧到 §3.3 的 ≤32 色（需量化）：平均 |ΔL*| ${d32.meanAbsL.toFixed(3)} / 变化像素 ${d32.changedPct.toFixed(1)}%`);
}
metrics.panes.e = {
  ...metrics.panes.e,
  frame: eName,
  canvas: `${E_CANVAS.w}×${E_CANVAS.h}`,
  procColors,
  png8Colors: eEnc.colors,
  png8Bytes: eEnc.buf.length,
  deltaSameDesign: { meanAbsL: dSame.meanAbsL, maxL: dSame.maxL, changedPct: dSame.changedPct },
  deltaIf32Cap: d32 ? { meanAbsL: d32.meanAbsL, changedPct: d32.changedPct } : null,
};

/* ------------------------------------------------ (e) 附表：换来源（用已排除草稿） */
const archPath = path.join(rawDir, '16_bit_SNES_style_pixel_art_ga_2026-09-17T09-19-33.png');
let eAi = null;
if (existsSync(archPath)) {
  const a = L.decodePng(readFileSync(archPath));
  const k = Math.max(1, Math.round(a.width / E_CANVAS.w)); // 该草稿"真像素"≈1024/16=64
  const ka = L.keyOutBg(a.rgba, a.width, a.height, { mode: 'auto' });
  const das = L.blockModeDownsample(ka.rgba, a.width, a.height, k);
  const cla = L.clampToPalette(das.rgba, das.width, das.height, PALETTE);
  const bba = L.cropBBox(cla.rgba, das.width, das.height);
  const kk = Math.min(1, 1);
  const pla = L.placeInto(bba.rgba, bba.width, bba.height, E_CANVAS.w, E_CANVAS.h, { align: 'center', vAlign: 'bottom' });
  const oa = L.outlineInk(pla.rgba, E_CANVAS.w, E_CANVAS.h, '#2a1a12', 1);
  const ea = writeIndexed('e_ai_source_64x56.png', E_CANVAS.w, E_CANVAS.h, oa, 32);
  writeRGBA('e_ai_source.preview.png', E_CANVAS.w, E_CANVAS.h, oa);
  const da = L.diffStats(proc, oa, E_CANVAS.w, E_CANVAS.h);
  eAi = { k, downsample: `${das.width}×${das.height}`, bbox: `${bba.width}×${bba.height}`, bytes: ea.bytes, colors: ea.colors, deltaVsProc: { meanAbsL: da.meanAbsL, changedPct: da.changedPct } };
  log(`[e·附] AI 草稿块尺寸 k=${k} ⇒ ${das.width}×${das.height}，剪到 ${E_CANVAS.w}×${E_CANVAS.h}：${ea.bytes} B / ${ea.colors} 色`);
  log(`[e·附] 与程序化帧比：平均 |ΔL*| ${da.meanAbsL.toFixed(2)} / 变化像素 ${da.changedPct.toFixed(1)}%（≠0 ⇒ 换了来源，同一尺寸下**并不相同**）`);
}
metrics.panes.eAi = eAi;
metrics.panes.eAiNote = '这张草稿已在 §3.5 被排除（水印 + 40 色浑浊），此处**只借它演示「同尺寸下位图不更强」**，不代表可用素材；它同时证明硬边界「地图格内不位图」是对的。';

writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 2));
log(`\nmetrics → assets/_pipeline/out/metrics.json`);
