#!/usr/bin/env node
/**
 * imagecmp.mjs —— 量两张 PNG 到底差多少（零依赖，自带 PNG 解码）。
 *
 * 为什么需要它：本轮反复出现「我说改了 / 看着像变了」这类**不可核验的断言**。
 * 对照图的唯一价值是**可复算**——所以差异必须落成一个能复现的数，而不是"看着不一样"。
 *
 * 它回答三个问题（对每张图 / 对一对图）：
 *   ① 每张图的平均 RGB 与平均 L\*（CIE 亮度，sRGB→线性→Y→L\*）；
 *   ② 两张图之间：平均 |ΔRGB|、**变化像素占比**（任一通道 |Δ| > 8）、平均 |ΔL\*|、p95 |ΔL\*|；
 *   ③ 若给两个尺寸不同的图（如不同 dprCap 档位），先**最近邻缩到小的一侧**再比，
 *      并在输出里显式标注「已重采样」——避免把"分辨率不同"错算成"颜色不同"。
 *
 * 用法：
 *   node tools/imagecmp.mjs <a.png> [b.png] [...]
 *
 * 退出码：0 成功 / 2 用法错 / 1 解码失败
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/* ---------------- PNG 解码（只支持 8-bit 非隔行 RGB/RGBA —— Chrome 截图就是这两种） ---------------- */

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`只支持 8-bit，收到 ${bitDepth}-bit`);
  if (interlace !== 0) throw new Error('不支持隔行 PNG');
  if (colorType !== 2 && colorType !== 6) throw new Error(`只支持 colorType 2/6，收到 ${colorType}`);

  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);

  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0; // 左
      const b = prev ? prev[x] : 0; // 上
      const c = prev && x >= ch ? prev[x - ch] : 0; // 左上
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a);
          const pb = Math.abs(pp - b);
          const pc = Math.abs(pp - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pred) & 0xff;
          break;
        }
        default: throw new Error(`未知 filter ${filter}（行 ${y}）`);
      }
      cur[x] = v;
    }
  }
  return { width, height, ch, data: out };
}

/* ---------------- 最近邻采样（用于尺寸不同的两张图） ---------------- */

/** 取 (x,y) 的 RGB；坐标按**源图宽高**给，越界夹紧。 */
function pixel(img, x, y) {
  const cx = x < 0 ? 0 : x >= img.width ? img.width - 1 : x;
  const cy = y < 0 ? 0 : y >= img.height ? img.height - 1 : y;
  const i = (cy * img.width + cx) * img.ch;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

/** 把 img 最近邻重采样到 w×h（整数坐标映射到源图比例位置）。 */
function resample(img, w, h) {
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.floor((x * img.width) / w);
      const sy = Math.floor((y * img.height) / h);
      const [r, g, b] = pixel(img, sx, sy);
      const i = (y * w + x) * 3;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
    }
  }
  return out;
}

/* ---------------- 颜色量 ---------------- */

const lin = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
/** CIE L\*（0–100）。 */
function lstar(r, g, b) {
  const Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
}

function stats(img) {
  const n = img.width * img.height;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  const ls = new Float64Array(n);
  let k = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const [r, g, b] = pixel(img, x, y);
      sr += r;
      sg += g;
      sb += b;
      ls[k++] = lstar(r, g, b);
    }
  }
  const sorted = Float64Array.from(ls).sort();
  const lMean = ls.reduce((a, b) => a + b, 0) / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (ls[i] - lMean) ** 2;
  return {
    mean: [sr / n, sg / n, sb / n],
    lMean,
    lMin: sorted[0],
    lMax: sorted[n - 1],
    lSd: Math.sqrt(varSum / n),
  };
}

/* ---------------- 逐格指标（G-18：0.49 → 2.22 这个数一直没脚本） ----------------
 *
 * `cartoon-style.md` §3.1.1 / `shots/README.md` 并列写过两个「客观量」：
 *   ① 逐格平均 L* **极差**  2.4 → 31.8   （有脚本：artshot.mjs 的 tileMeanLSpread）
 *   ② 相邻格平均 **|ΔL*|**  0.49 → 2.22  （**全仓没有脚本**，只在文字里 —— G-18 挂账）
 * 本函数就是把 ② 变成可复算的一段代码：按固定格宽切片、算每格平均 L*、
 * 再对**上下左右相邻格**取 |ΔL*| 的平均，同时给出 ① 的极差。
 *
 * ⚠️ 口径必须写死，否则又是一个「同一量两种算法」：
 *   - 格宽 = 给定的 tile 像素（本项目 TILE=32；带 UI 的整页截图**不适用**，格线对不齐）
 *   - **只取整格**：右边/下边不足一格的像素**丢弃**（不做边缘补格）
 *   - 相邻对 = 每格与**右邻**、每格与**下邻**；边界处缺邻即跳过
 */

function tileMetrics(img, ts) {
  const gw = Math.floor(img.width / ts);
  const gh = Math.floor(img.height / ts);
  if (gw < 2 || gh < 2) throw new Error(`图太小，放不下 ${ts}px 的格（${gw}×${gh} 格）`);

  // 每格平均 L*
  const mean = new Float64Array(gw * gh);
  for (let ty = 0; ty < gh; ty++) {
    for (let tx = 0; tx < gw; tx++) {
      let sum = 0;
      let n = 0;
      for (let y = ty * ts; y < (ty + 1) * ts; y++) {
        for (let x = tx * ts; x < (tx + 1) * ts; x++) {
          const [r, g, b] = pixel(img, x, y);
          sum += lstar(r, g, b);
          n++;
        }
      }
      mean[ty * gw + tx] = sum / n;
    }
  }

  let min = Infinity;
  let max = -Infinity;
  for (const v of mean) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  let adjSum = 0;
  let adjN = 0;
  for (let ty = 0; ty < gh; ty++) {
    for (let tx = 0; tx < gw; tx++) {
      const v = mean[ty * gw + tx];
      if (tx + 1 < gw) {
        adjSum += Math.abs(v - mean[ty * gw + tx + 1]);
        adjN++;
      }
      if (ty + 1 < gh) {
        adjSum += Math.abs(v - mean[(ty + 1) * gw + tx]);
        adjN++;
      }
    }
  }

  return { gw, gh, min, max, spread: max - min, adjMean: adjN ? adjSum / adjN : NaN };
}

/* ---------------- 主流程 ---------------- */

/**
 * `CMP_CROP=top,bottom` —— 只比这个**行区间**（源图像素行，左上角为 0）。
 * 为什么需要：整屏截图里顶栏/底栏/侧栏是 UI，两版之间**逐像素相同**，
 * 会把"地图区到底差多少"摊薄。裁到地图区再比，才是"玩家看的画面差多少"。
 */
function cropRows(img, spec) {
  const [t, b] = spec.split(',').map(Number);
  if (!Number.isFinite(t) || !Number.isFinite(b) || t < 0 || b > img.height || t >= b) {
    throw new Error(`CMP_CROP 非法：${spec}（图高 ${img.height}）`);
  }
  const stride = img.width * img.ch;
  return { width: img.width, height: b - t, ch: img.ch, data: img.data.subarray(t * stride, b * stride) };
}

const files = process.argv.slice(2);
if (files.length < 1) {
  console.error('用法：node tools/imagecmp.mjs <a.png> [b.png] [...]');
  process.exit(2);
}
const CROP = process.env.CMP_CROP;

let failed = false;
const imgs = [];
for (const f of files) {
  try {
    let img = decodePng(readFileSync(f));
    if (CROP) img = cropRows(img, CROP);
    imgs.push({ file: f, img });
    const s = stats(img);
    const f3 = (v) => v.toFixed(1);
    console.log(
      `${f}${CROP ? ` [裁 ${CROP}]` : ''}\n  ${img.width}×${img.height} 平均 RGB ${f3(s.mean[0])}/${f3(s.mean[1])}/${f3(s.mean[2])}` +
        `  L* 均值 ${f3(s.lMean)} 极差 [${f3(s.lMin)}, ${f3(s.lMax)}] 全图 sd ${f3(s.lSd)}`,
    );
    // CMP_TILE=32 ⇒ 额外报「逐格 / 相邻格」两个空间指标（G-18 的 0.49→2.22 就在这两个上）
    const ts = Number(process.env.CMP_TILE ?? 0);
    if (Number.isFinite(ts) && ts > 0) {
      const t = tileMetrics(img, ts);
      console.log(
        `  逐格 L*（格宽 ${ts}px，${t.gw}×${t.gh} = ${t.gw * t.gh} 格）：` +
          `均值域 [${t.min.toFixed(2)}, ${t.max.toFixed(2)}] 极差 ${t.spread.toFixed(2)}` +
          `   相邻格平均 |ΔL*| ${t.adjMean.toFixed(2)}`,
      );
    }
  } catch (e) {
    console.error(`${f}：解码失败 —— ${e.message}`);
    failed = true;
  }
}

if (imgs.length >= 2) {
  const a = imgs[0].img;
  const b = imgs[1].img;
  const W = Math.min(a.width, b.width);
  const H = Math.min(a.height, b.height);
  const resampled = a.width !== b.width || a.height !== b.height;
  const A = resample(a, W, H);
  const B = resample(b, W, H);

  let dSum = 0;
  let dLSum = 0;
  let changed = 0;
  const dls = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const dr = Math.abs(A[i * 3] - B[i * 3]);
    const dg = Math.abs(A[i * 3 + 1] - B[i * 3 + 1]);
    const db = Math.abs(A[i * 3 + 2] - B[i * 3 + 2]);
    dSum += (dr + dg + db) / 3;
    if (dr > 8 || dg > 8 || db > 8) changed++;
    const dl = Math.abs(lstar(A[i * 3], A[i * 3 + 1], A[i * 3 + 2]) - lstar(B[i * 3], B[i * 3 + 1], B[i * 3 + 2]));
    dls[i] = dl;
    dLSum += dl;
  }
  const sorted = Float64Array.from(dls).sort();
  const f2 = (v) => v.toFixed(2);
  console.log(
    `\n【对照】${imgs[0].file}  →  ${imgs[1].file}` +
      (resampled ? `\n  ⚠️ 两图尺寸不同（${a.width}×${a.height} vs ${b.width}×${b.height}），已最近邻缩到 ${W}×${H} 再比 —— 差异里含"分辨率"一项，不是纯颜色差` : '') +
      `\n  平均 |ΔRGB| ${f2(dSum / (W * H))}   变化像素占比 ${((changed / (W * H)) * 100).toFixed(1)}%（任一通道 |Δ|>8）` +
      `\n  平均 |ΔL*| ${f2(dLSum / (W * H))}   p95 |ΔL*| ${f2(sorted[Math.floor((W * H) * 0.95)])}`,
  );
}

process.exit(failed ? 1 : 0);
