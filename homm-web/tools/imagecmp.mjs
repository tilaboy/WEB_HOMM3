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

/* ---- CIE L\*a\*b\*（D65）与 ΔE\*ab -------------------------------------------------
 * 为什么除了 L\* 还要 a\*b\*（roadmap `3f11752`）：L\* 只量**明度**差。
 * 若一次改动主要是**色相/饱和度**（如"草地偏青、沼泽偏冷"，或可达染色的蓝/红），
 * 只报 |ΔL\*| 会**系统性低估**它；判"玩家看不看得出"要用**同维度的尺子**＝ ΔE\*ab。
 * （色觉障碍另论：那要问"红绿色盲下 ΔL\* 还剩多少"，`tintab.mjs` 有该列。）
 */
function labFromRgb(r, g, b) {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / 0.95047);
  const fy = f(Y);
  const fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function dEab(a, b) {
  const d0 = a[0] - b[0];
  const d1 = a[1] - b[1];
  const d2 = a[2] - b[2];
  return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
}

/* ---------------- 边缘对比（CMP_EDGE=<hex>）：量「某色描边 vs 其相邻底色」的 WCAG 对比 ----------------
 *
 * 用途：④ 可达染色改 (α) 后，格缘描边 = **不透明 `ink0` `#2a1a12`**（`MapRenderer.ts` 的 `NOGO_EDGE_INK`）。
 * 判据（`accessibility-requirements.md §4.6`）= **WCAG 非文本 3:1**，量的对象是「**状态（描边）vs 其底（相邻地形）**」。
 *
 * 做法：找出容差内与目标色相近的像素；对每个，向**四邻（含隔 1px 的第二圈）找第一个非目标色**像素作"底"，
 * 算 WCAG 对比 = (Yhi+0.05)/(Ylo+0.05)（Y = 相对亮度）。报 中位 / p10 / min / p90 + 底色 L* 分布 + "<3:1 占比"。
 *
 * ⚠️ 口径（诚实边界）：目标色若在图上**还出现在别处**（如物件描边也是 `ink0`），会一并计入 ——
 *   因**颜色相同 ⇒ 对比同源**，对"`ink0` 能不能达 3:1"这个判断**无偏**；但它**不是**只量那圈 ④ 格缘。
 *   要只量 ④ 格缘，需"染色开/关"两张图做差（见 §4.6 的 A/B 口径）。屏幕截图经 DPR 上采样 ⇒ 描边像素被插值，
 *   故必须给容差 `CMP_EDGE_TOL`（默认 ±12），并以 **n（命中的描边像素数）** 判读数是否够量。
 */
function relY(r, g, b) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function wcagRatio(y1, y2) {
  const hi = Math.max(y1, y2);
  const lo = Math.min(y1, y2);
  return (hi + 0.05) / (lo + 0.05);
}

function edgeContrast(img, hex, tol) {
  const t = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  const hit = (x, y) => {
    const [r, g, b] = pixel(img, x, y);
    return Math.abs(r - t[0]) <= tol && Math.abs(g - t[1]) <= tol && Math.abs(b - t[2]) <= tol;
  };
  const ratios = [];
  const baseLs = [];
  // 8 方向：先看紧邻，再看隔 1px 的第二圈 —— 描边宽度（④ 为 2 边 × `EDGE_W`=2px）可能 >1px
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]];
  const yc = relY(t[0], t[1], t[2]);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (!hit(x, y)) continue;
      let found = null;
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue;
        if (hit(nx, ny)) continue;
        found = pixel(img, nx, ny);
        break;
      }
      if (!found) continue;
      ratios.push(wcagRatio(yc, relY(found[0], found[1], found[2])));
      baseLs.push(lstar(found[0], found[1], found[2]));
    }
  }
  const n = ratios.length;
  if (!n) return { n: 0 };
  const rs = Float64Array.from(ratios).sort();
  const bl = Float64Array.from(baseLs).sort();
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  return {
    n,
    median: q(rs, 0.5),
    p10: q(rs, 0.1),
    p90: q(rs, 0.9),
    min: rs[0],
    baseLMedian: q(bl, 0.5),
    baseLMin: bl[0],
    baseLMax: bl[bl.length - 1],
    below3: ratios.filter((v) => v < 3).length / n,
  };
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
    // CMP_EDGE=<hex> ⇒ 量「该色描边 vs 其相邻底色」的 WCAG 对比（④ (α) 的 3:1 判据，见 accessibility §4.6）
    const edgeHex = process.env.CMP_EDGE;
    if (edgeHex) {
      const tol = Number(process.env.CMP_EDGE_TOL ?? 12);
      const e = edgeContrast(img, edgeHex.replace(/^#/, ''), tol);
      if (!e.n) {
        console.log(`  边缘对比 #${edgeHex}：图里找不到该色（容差 ±${tol}）`);
      } else {
        console.log(
          `  边缘对比 #${edgeHex}（容差 ±${tol}，n=${e.n}）：` +
            `中位 ${e.median.toFixed(2)}  p10 ${e.p10.toFixed(2)}  min ${e.min.toFixed(2)}  p90 ${e.p90.toFixed(2)}` +
            `  <3:1 占比 ${(e.below3 * 100).toFixed(1)}%  底色 L* 中位 ${e.baseLMedian.toFixed(1)} [${e.baseLMin.toFixed(1)}, ${e.baseLMax.toFixed(1)}]`,
        );
      }
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
  let dESum = 0;
  let changed = 0;
  const dls = new Float64Array(W * H);
  const des = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const dr = Math.abs(A[i * 3] - B[i * 3]);
    const dg = Math.abs(A[i * 3 + 1] - B[i * 3 + 1]);
    const db = Math.abs(A[i * 3 + 2] - B[i * 3 + 2]);
    dSum += (dr + dg + db) / 3;
    if (dr > 8 || dg > 8 || db > 8) changed++;
    const dl = Math.abs(lstar(A[i * 3], A[i * 3 + 1], A[i * 3 + 2]) - lstar(B[i * 3], B[i * 3 + 1], B[i * 3 + 2]));
    dls[i] = dl;
    dLSum += dl;
    const de = dEab(
      labFromRgb(A[i * 3], A[i * 3 + 1], A[i * 3 + 2]),
      labFromRgb(B[i * 3], B[i * 3 + 1], B[i * 3 + 2]),
    );
    des[i] = de;
    dESum += de;
  }
  const sorted = Float64Array.from(dls).sort();
  const sortedE = Float64Array.from(des).sort();
  const f2 = (v) => v.toFixed(2);
  console.log(
    `\n【对照】${imgs[0].file}  →  ${imgs[1].file}` +
      (resampled ? `\n  ⚠️ 两图尺寸不同（${a.width}×${a.height} vs ${b.width}×${b.height}），已最近邻缩到 ${W}×${H} 再比 —— 差异里含"分辨率"一项，不是纯颜色差` : '') +
      `\n  平均 |ΔRGB| ${f2(dSum / (W * H))}   变化像素占比 ${((changed / (W * H)) * 100).toFixed(1)}%（任一通道 |Δ|>8）` +
      `\n  平均 |ΔL*| ${f2(dLSum / (W * H))}   p95 |ΔL*| ${f2(sorted[Math.floor((W * H) * 0.95)])}` +
      `\n  平均 ΔE*ab ${f2(dESum / (W * H))}   p95 ΔE*ab ${f2(sortedE[Math.floor((W * H) * 0.95)])}`,
  );
}

process.exit(failed ? 1 : 0);
