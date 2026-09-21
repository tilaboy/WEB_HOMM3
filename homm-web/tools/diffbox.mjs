#!/usr/bin/env node
/**
 * diffbox.mjs —— 两张 PNG 的**差分定位**：差异计数 + bbox + 「是否落在给定框内」。
 *
 * 作者：`art-director`（2026-09-21）。用途 = 判「某个改动/守卫到底改变了什么」，
 * 典型问法：「新加的抓帧守卫改动了几像素？落在哪？」（见 `deviceshot.mjs` 头注「抓帧免疫」）。
 *
 * 用法：
 *   node tools/diffbox.mjs <a.png> <b.png> [bx0,by0,bx1,by1]
 *     第 4 参可选：给一个框（**源图像素坐标**），额外报「差异有多少落在这个框内」。
 *
 * ⚠️ **阈值是两件事，别混报（我踩过）**：
 *   · 本工具的计数用 **`|Δ| > 4`**（与 `reachmeas` / `closureprobe` 同款）——
 *     这才是"**画面真的变了**"的那个量；
 *   · 若改用 `Δ != 0`（连 1 LSB 都算），数字会**大一个量级**且 bbox 会铺满整帧：
 *     实测例 = 隐藏一层 DOM toast（`#hint`）⇒ `|Δ|>4` 只 38 268 px（99 行、宽 412，全在 toast 区），
 *     而 `Δ!=0` 是 362 308 px、bbox 铺满 `2376×960` ⇒ **那 32 万是 ≤4 LSB 的整帧涟漪**，不是内容改变。
 *   ⇒ **报数时必须连阈值一起报**（"同一个量两个数"家族的又一例）。
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** 零依赖 PNG 解码（8-bit、非隔行、RGB/RGBA）—— 与 `closureprobe.mjs` / `reachmeas.mjs` 同族。 */
function decodePng(buf) {
  let off = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (colorType !== 2 && colorType !== 6) throw new Error('只支持 RGB/RGBA PNG');
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

const [pa, pb, boxArg] = process.argv.slice(2);
if (!pa || !pb) {
  console.error('用法：node tools/diffbox.mjs <a.png> <b.png> [bx0,by0,bx1,by1]');
  console.error('计数阈值 = |Δ|>4（与 reachmeas/closureprobe 同款）；报数请连阈值一起报。');
  process.exit(2);
}
const A = decodePng(readFileSync(pa));
const B = decodePng(readFileSync(pb));
if (A.width !== B.width || A.height !== B.height) {
  console.log(`尺寸不同：${A.width}x${A.height} vs ${B.width}x${B.height}`);
  process.exit(1);
}
const W = A.width, H = A.height, ch = A.ch;
let n = 0, maxd = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, inBox = 0, nz = 0;
const box = boxArg ? boxArg.split(',').map(Number) : null;
const rowN = new Array(H).fill(0);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * ch;
  const d = Math.max(
    Math.abs(A.data[i] - B.data[i]),
    Math.abs(A.data[i + 1] - B.data[i + 1]),
    Math.abs(A.data[i + 2] - B.data[i + 2]),
  );
  if (d !== 0) nz++;
  if (d <= 4) continue;
  n++; rowN[y]++;
  if (d > maxd) maxd = d;
  if (x < x0) x0 = x;
  if (x > x1) x1 = x;
  if (y < y0) y0 = y;
  if (y > y1) y1 = y;
  if (box && x >= box[0] && y >= box[1] && x <= box[2] && y <= box[3]) inBox++;
}
console.log(`尺寸 ${W}x${H}`);
console.log(`  |Δ|>4  不同像素 n=${n}   max|Δ|=${maxd}`);
console.log(`  任意差异（Δ≠0）像素 n=${nz}   ← ⚠️ 含 1 LSB 涟漪，别与上面那个数并列`);
if (n) {
  console.log(`  |Δ|>4 的 bbox = x[${x0}..${x1}] y[${y0}..${y1}]  (${x1 - x0 + 1}×${y1 - y0 + 1})`);
  const rows = rowN.reduce((s, v) => s + (v > 0 ? 1 : 0), 0);
  console.log(`  涉及行数 = ${rows} / ${H}`);
  const top = rowN.map((v, i) => [i, v]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`  差异最多的 3 行（行:像素）: ${top.map((t) => t[0] + ':' + t[1]).join('  ')}`);
}
if (box) console.log(`  落在给定框 [${box.join(',')}] 内 n=${inBox} / ${n}${n ? ` = ${(100 * inBox / n).toFixed(1)}%` : ''}`);
