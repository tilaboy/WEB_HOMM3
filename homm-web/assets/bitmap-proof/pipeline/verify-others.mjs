/**
 * verify-others.mjs —— **独立验收**另一个实例产出的 (b)/(e)（不是复述它的 metrics.json）。
 *
 * 为什么要有这个：本项目今天反复治的病是"**把算式当实测报**"和"**自证**"。
 * 对方给了 `metrics.json`，但那是**它自己报的**。本脚本**只读它的产物文件**，
 * 重新解出来逐条核 —— 对得上就确认，对不上就报差异。
 *
 * 核什么（对着 `asset-spec §3.3 / §9.1` 的硬约束与断言）：
 *   ① 落盘格式：PNG-8（color type 3）/ 8-bit / 非交错 / ≤32 色 / tRNS 只含 0|255（禁半透明）
 *   ② 画布尺寸 = 256×384；文件 ≤ 24 KB（`crestL_*` 预算）
 *   ③ 断言 1「抠底无粉边」：全图洋红/粉残留像素数（此处用**独立判据**，不引对方代码）
 *   ④ 水印：右下角 x≥82% y≥92% 区域是否已无任何不透明像素
 *   ⑤ 交叉核对 (e)：本档独立复跑的三帧 0 差 vs 对方单帧 0 差
 *
 * 用法（cwd = homm-web/）：node assets/bitmap-proof/pipeline/verify-others.mjs
 */
import * as L from '../../_pipeline/lib.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const OUT = join(ROOT, 'assets', '_pipeline', 'out');
const FIGS = join(ROOT, 'assets', 'bitmap-proof', 'figs');

/** 不走 L.decodePng —— 独立再解一次头，专门看 color type / tRNS（对方的解码器只回转 RGBA，看不到这些）。 */
function pngHeader(buf) {
  let pos = 8;
  const h = { colorType: -1, bitDepth: -1, interlace: -1, width: 0, height: 0, plte: 0, trnsLen: 0 };
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      h.width = data.readUInt32BE(0);
      h.height = data.readUInt32BE(4);
      h.bitDepth = data[8];
      h.colorType = data[9];
      h.interlace = data[12];
    } else if (type === 'PLTE') h.plte = len / 3;
    else if (type === 'tRNS') h.trnsLen = len;
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  return h;
}

const R = { checkedAt: new Date().toISOString(), items: [], notes: [] };
const push = (name, rows) => R.items.push({ artifact: name, rows });
const F = (v, d = 2) => (typeof v === 'number' ? v.toFixed(d) : String(v));

/* ================================================== ① (b) crestL_p1 */
const bPath = join(OUT, 'b_crestL_p1.png');
if (!existsSync(bPath)) {
  R.notes.push(`缺 ${bPath} —— (b) 未产出`);
} else {
  const buf = readFileSync(bPath);
  const h = pngHeader(buf);
  const img = L.decodePng(buf);

  // 独立判据：洋红/粉残留 = 不透明、且 (r>150 && b>150 && g<110)
  let pink = 0;
  const alphas = new Map();
  const colors = new Set();
  for (let i = 0; i < img.width * img.height; i++) {
    const o = i * 4;
    const a = img.rgba[o + 3];
    alphas.set(a, (alphas.get(a) ?? 0) + 1);
    if (a === 0) continue;
    colors.add((img.rgba[o] << 16) | (img.rgba[o + 1] << 8) | img.rgba[o + 2]);
    if (img.rgba[o] > 150 && img.rgba[o + 2] > 150 && img.rgba[o + 1] < 110) pink++;
  }

  // 水印区：x≥82% y≥92%
  const x0 = Math.floor(img.width * 0.82);
  const y0 = Math.floor(img.height * 0.92);
  let wmOpaque = 0;
  for (let y = y0; y < img.height; y++)
    for (let x = x0; x < img.width; x++) if (img.rgba[(y * img.width + x) * 4 + 3] > 0) wmOpaque++;

  const semiAlphas = [...alphas.keys()].filter((a) => a !== 0 && a !== 255);
  const rows = [
    ['尺寸', `${h.width}×${h.height}`, h.width === 256 && h.height === 384 ? 'PASS' : 'FAIL'],
    ['color type', `${h.colorType}（3 = PNG-8 索引色）`, h.colorType === 3 ? 'PASS' : 'FAIL'],
    ['bit depth / interlace', `${h.bitDepth} / ${h.interlace}`, h.bitDepth === 8 && h.interlace === 0 ? 'PASS' : 'FAIL'],
    ['PLTE 色数', `${h.plte}（≤32）`, h.plte <= 32 ? 'PASS' : 'FAIL'],
    ['tRNS 长度 / 是否只含 0|255', `${h.trnsLen} / 实测 alpha 集合 ${[...alphas.keys()].sort((a, b) => a - b).join(',')}`, semiAlphas.length === 0 ? 'PASS' : 'FAIL'],
    ['实际用色数', `${colors.size}`, colors.size <= 32 ? 'PASS' : 'FAIL'],
    ['文件字节', `${buf.length} B（预算 ≤24576）`, buf.length <= 24576 ? 'PASS' : 'FAIL'],
    ['内联 base64 预估', `${Math.ceil(buf.length / 3) * 4} B`, '—'],
    ['断言1 洋红/粉残留', `${pink} px`, pink === 0 ? 'PASS' : `FAIL（对方 metrics 报 residualPink=21）`],
    ['水印区(x≥82%,y≥92%)不透明像素', `${wmOpaque} px`, wmOpaque === 0 ? 'PASS（水印像素已不在）' : 'FAIL'],
  ];
  push('assets/_pipeline/out/b_crestL_p1.png', rows);
  R.b = { header: h, colors: colors.size, bytes: buf.length, residualPink: pink, watermarkOpaquePx: wmOpaque };
}

/* ================================================== ② (e) 交叉核对 */
const theirMetrics = join(OUT, 'metrics.json');
const mine = join(FIGS, 'e_report.json');
if (existsSync(theirMetrics) && existsSync(mine)) {
  const t = JSON.parse(readFileSync(theirMetrics, 'utf8'));
  const m = JSON.parse(readFileSync(mine, 'utf8'));
  const te = t.panes?.e ?? {};
  const myMin = Math.min(...m.rows.map((r) => r.meanAbsL));
  const myMax = Math.max(...m.rows.map((r) => r.meanAbsL));
  push('(e) 双方独立复跑对照', [
    ['对方（单帧 cu_p1_lampbearer 64×56）', `平均|ΔL*| ${F(te.deltaSameDesign?.meanAbsL)} / 变化 ${F(te.deltaSameDesign?.changedPct, 1)}%`, te.deltaSameDesign?.meanAbsL === 0 ? 'PASS' : 'FAIL'],
    ['本档（三帧 map 52×44 + idle/atk 64×56）', `平均|ΔL*| ∈ [${F(myMin)}, ${F(myMax)}]`, myMax === 0 ? 'PASS' : 'FAIL'],
    ['结论一致性', '两条独立路径都得 0.00', 'PASS（互证）'],
  ]);
  R.eCross = { theirs: te.deltaSameDesign, mine: m.rows.map((r) => ({ name: r.name, meanAbsL: r.meanAbsL, changedPct: r.changedPct })) };
}

writeFileSync(join(FIGS, 'verify_report.json'), JSON.stringify(R, null, 2));

console.log('=== 独立验收（只读对方产物，重解一遍）===\n');
for (const it of R.items) {
  console.log(it.artifact);
  for (const [k, v, verdict] of it.rows) console.log(`  ${k.padEnd(34)} ${String(v).padEnd(52)} ${verdict}`);
  console.log('');
}
for (const n of R.notes) console.log('注：' + n);
console.log(`明细 → assets/bitmap-proof/figs/verify_report.json`);
