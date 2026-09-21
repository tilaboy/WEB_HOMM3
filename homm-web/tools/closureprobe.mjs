/**
 * closureprobe.mjs —— 可达染色的「轮廓闭合性」探针（**旁证尺，非验收数**）。
 *
 * 作者：`art-director`。原为一次性诊断脚本（曾只存在于 `/tmp`），`#155` 要用它做
 * 「修前 / 修后」对比 ⇒ 按 `368f68f` 规矩（**状态必须用可复现的定义表达**）
 * **入库**：`/tmp` 会被清空，留在那里的脚本等于不可复现。
 *
 * 用法：
 *   node tools/closureprobe.mjs <after.png> <before.png>
 *     after  = **染色开**；before = **染色关（`&devtint=0`）**
 *     ⚠️ 两张必须是**同场景 / 同相机 / 同帧 / 同一构建**下抓的（只差染色层）。
 *
 * 问题（team-lead 裁定 ②）：方向信息由「闭包轮廓」承载 ⇒ 渲染上轮廓必须闭合。
 * 代码已知：`inRegion()` 对**未揭开**格返回 false，且主绘制循环对未揭开格 `continue`
 * ⇒ 可达区贴着**未探索区**的那一段**不描线**。本探针用像素回答"该缺口是否存在"。
 *
 * 口径：
 *   · changed = 通道差 max|Δ| > 4（与 `reachmeas.mjs` 同款）。
 *   · fog（未探索 / 图外）= after 里颜色 ≈ `#0b0d10`（未探索遮盖与画布底色**同色**）。
 *   · 缺口 = 「**变化的**（= 被染色层碰过）像素」与「fog 像素」**4 邻接**的那些边。
 *     若轮廓闭合，可达区贴雾处也应有带 ⇒ 该处 fog 邻接的应是**带**像素，而不是**填充(wash)**。
 *   · 归族：模型色 = 族色按 alpha 合成在 before 之上；取最近者（族定义与 §4.6 的四带一致）。
 *
 * ⛔ **本尺的边界（引用时必须一起写）**：
 *   · 只证「**缺口存在 / 被补上**」，**不证「缺口占轮廓多少」** —— `fog` 含**图外底色**、
 *     与未探索遮盖**同色 `#0b0d10`**，两者在像素上分不开。
 *   · 它是**旁证尺**，**不是 `§4.6` 的 `(ii)` 验收数**（验收数走 `tintab` 逐类×逐带）。
 *   · ⚠️ **本尺自己不冻帧**：`changed` 会把**动画像素**（水波 / 选中脉冲）算进去（= `#138` 那个病）。
 *     ⇒ **输入必须已冻帧（抓图侧 `SHOT_FREEZE=1`）且"同帧"**；否则结论无意义。**本尺不给"是否冻帧"的断言。**
 *
 * `#155`（修「轮廓在雾侧不闭合」）的取证口径：
 *   · 修前 / 修后各跑一次，**两侧必须同构建**（`commit` + 构建命令 + 指纹 一并写进报告；
 *     跨构建的两个数**不得并列成"同一个量的两个数"**）。
 *   · ⚠️ **★ 两次都必须带 `&devfogclose=1`（对称 · 单变量）—— 否则「修后」跑的是默认路径 ⇒ 假阴性**：
 *     修法是 **default-off**；若不带旗标，修前/修后都是默认路径 ⇒ 逐像素不变 ⇒ 会得到「修了等于没修」（**错**）。
 *     带旗标后：修前（旧构建，**未知参数 ⇒ 被忽略 ⇒ = 默认**）vs 修后（旗标生效）= **唯一差别 = 代码里有没有这条修法**。
 *   · ★ **两个不同的量，别混报**：
 *     (a) **带旗标 修前 vs 修后** = **修法效果**（期望：`fogTouchFill` 下降、`fogTouchBand` 上升）；
 *     (b) **不带旗标 修后 vs 修前** = **默认路径 0 像素差**（= "门票"证据：默认 no-op）。
 *   · ⚠️ 开关名（据 `engineering-lead`，**落库前不得当"已存在的实体"引用**）：`?devfogclose=1`
 *     （**不是** `?devclosure`；用错名 = 静默量到"默认 no-op"）。
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(buf) {
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) throw new Error('unsupported png');
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[o + x - ch] : 0;
      const b = y > 0 ? out[o - stride + x] : 0;
      const c = (x >= ch && y > 0) ? out[o - stride + x - ch] : 0;
      let v = line[x];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + b) & 255;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      out[o + x] = v;
    }
  }
  return { width, height, ch, data: out };
}

const [afterP, beforeP] = process.argv.slice(2);
if (!afterP || !beforeP) {
  console.error('用法: node tools/closureprobe.mjs <after.png 染色开> <before.png 染色关>');
  console.error('说明: 两张须同场景/同相机/同帧/同构建，只差 &devtint=0；本尺为旁证尺，非 (ii) 验收数。');
  process.exit(2);
}
const A = decodePng(readFileSync(afterP));
const B = decodePng(readFileSync(beforeP));
if (A.width !== B.width || A.height !== B.height) throw new Error('尺寸不一致');
const { width: W, height: H } = A;
const px = (im, i) => [im.data[i], im.data[i + 1], im.data[i + 2]];

const FAM = [
  ['fill', 120, 200, 255, 0.16],
  ['edge', 255, 96, 80, 0.42],
  ['glow', 255, 243, 200, 1],
  ['ink', 42, 26, 18, 1],
];

const changed = new Uint8Array(W * H);
const fam = new Uint8Array(W * H); // 0=未变 1..4=FAM idx+1
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * A.ch;
  const a = px(A, i), b = px(B, i);
  const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  if (d <= 4) continue;
  changed[y * W + x] = 1;
  let best = -1, bd = Infinity;
  for (let k = 0; k < FAM.length; k++) {
    const [, cr, cg, cb, al] = FAM[k];
    const e0 = al * cr + (1 - al) * b[0], e1 = al * cg + (1 - al) * b[1], e2 = al * cb + (1 - al) * b[2];
    const dd = (e0 - a[0]) ** 2 + (e1 - a[1]) ** 2 + (e2 - a[2]) ** 2;
    if (dd < bd) { bd = dd; best = k; }
  }
  fam[y * W + x] = best + 1;
}

const isFog = (x, y) => {
  const i = (y * W + x) * A.ch;
  const a = px(A, i);
  return Math.abs(a[0] - 11) <= 2 && Math.abs(a[1] - 13) <= 2 && Math.abs(a[2] - 16) <= 2;
};

let fogTotal = 0, fogTouchChanged = 0, fogTouchFill = 0, fogTouchBand = 0;
const fogTouchKind = { fill: 0, edge: 0, glow: 0, ink: 0 };
const gaps = []; // 例子坐标
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  if (!isFog(x, y)) continue;
  fogTotal++;
  let touched = false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (!changed[ny * W + nx]) continue;
    touched = true;
    const k = FAM[fam[ny * W + nx] - 1][0];
    fogTouchKind[k]++;
    if (k === 'fill') { if (gaps.length < 12) gaps.push([nx, ny]); }
  }
  if (touched) {
    fogTouchChanged++;
    let hasFill = false, hasBand = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!changed[ny * W + nx]) continue;
      const k = FAM[fam[ny * W + nx] - 1][0];
      if (k === 'fill') hasFill = true; else hasBand = true;
    }
    if (hasFill) fogTouchFill++;
    if (hasBand) fogTouchBand++;
  }
}

console.log(`尺寸 ${W}x${H}   变化像素 n=${changed.reduce((s, v) => s + v, 0)}`);
console.log(`fog(#0b0d10±2) 像素 n=${fogTotal}`);
console.log(`  · fog 4 邻接"变化像素"的像素 n=${fogTouchChanged}（该处染色层碰到了雾边界）`);
console.log(`     其中邻接 **fill(水洗)** 的 n=${fogTouchFill}  **（像素计数）**   ← ★ 若轮廓闭合，此处应 ≈0（应为"带"）`);
console.log(`     其中邻接 **任意带(edge/glow/ink)** 的 n=${fogTouchBand}  **（像素计数）**`);
console.log(`  · ⚠️ 下面这张表的单位不同（**"边"计数：一条边算一次，不是像素**）—— 别与上面两行并列成"同一个量两个数"：`);
for (const k of ['fill', 'edge', 'glow', 'ink']) console.log(`     ${k.padEnd(5)} ${fogTouchKind[k]}`);
console.log(`  · 水洗贴雾的例子（前 12 个像素坐标）：${gaps.map(g => `(${g[0]},${g[1]})`).join(' ')}`);
console.log('⚠️ 边界：只证「缺口存在 / 被补上」，不证「缺口占轮廓多少」（fog 含图外底色、同色不可分）；本尺为旁证，非 (ii) 验收数。');
