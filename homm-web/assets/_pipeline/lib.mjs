/**
 * lib.mjs —— 位图「7 步管线」的**零依赖**实现（`asset-spec.md §5`）。
 *
 * 为什么单独一个文件：`asset-spec §5.6 / §7` 把 `tools/import-sprite.mjs` 列为**待建**，
 * 但它一旦建在 `tools/` 就跨了 `art-director-3` 的写域（`bitmap-asset-options.md` + `homm-web/assets/`）。
 * ⇒ 本实现**只落在 `homm-web/assets/_pipeline/`**（自己的写域内），**不改 `tools/` / `src/`**。
 * ⇒ **它不进构建**（`tools/postbuild.mjs` 只并 `public/` + `src/style.css`）。
 *
 * 覆盖 `asset-spec §5.1` 的 [1]–[5] + [7]：
 *   [1] 抠底（背景键成透明）      keyOutBg()
 *   [2] 块众数降采样 8:1          blockModeDownsample()
 *   [3] 调色板钳制                clampToPalette()
 *   [4] 裁剪 → 整数比缩放 → 落位  cropBBox() / nearestScale() / placeInto()
 *   [5] 描边重建                  outlineInk()
 *   [7] PNG-8 ≤32 色              encodePngIndexed()
 *   [6] 手工修 —— **本实现不做**（无画师），见 §5.5：如实记「未做」。
 *
 * 另附：PNG 解码（读 AI 出图）、RGBA 编码（出对照图）、Δ 度量。
 * 语义纪律：**一律最近邻**，绝不插值（对齐 `imageSmoothingEnabled=false`）。
 */

import { deflateSync, inflateSync } from 'node:zlib';

/* ==================================================================== PNG 解码 */

function unfilterInto(f, line, prev, bpp, stride) {
  for (let i = 0; i < stride; i++) {
    const a = i >= bpp ? line[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    let v = line[i];
    if (f === 1) v = (v + a) & 255;
    else if (f === 2) v = (v + b) & 255;
    else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
    else if (f === 4) {
      const pa = Math.abs(b - c);
      const pb = Math.abs(a - c);
      const pc = Math.abs(a + b - 2 * c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      v = (v + pr) & 255;
    }
    line[i] = v;
  }
}

/** 读 8-bit、非交错的 PNG（color type 0 / 2 / 3 / 6）。返回 { width, height, rgba }。 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len; // len(4) + type(4) + data(len) + crc(4)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
  }
  if (interlace) throw new Error('不支持交错 PNG');
  if (bitDepth !== 8) throw new Error(`只支持 8-bit，读到 ${bitDepth}`);
  const ch = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : colorType === 3 ? 1 : 0;
  if (!ch) throw new Error(`不支持的 color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = new Uint8ClampedArray(width * height * 4);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    unfilterInto(f, line, prev, ch, stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 0) {
        const g = line[x];
        out[o] = g; out[o + 1] = g; out[o + 2] = g; out[o + 3] = 255;
      } else if (colorType === 2) {
        out[o] = line[x * 3]; out[o + 1] = line[x * 3 + 1]; out[o + 2] = line[x * 3 + 2]; out[o + 3] = 255;
      } else if (colorType === 6) {
        out[o] = line[x * 4]; out[o + 1] = line[x * 4 + 1]; out[o + 2] = line[x * 4 + 2]; out[o + 3] = line[x * 4 + 3];
      } else {
        const i = line[x];
        out[o] = palette[i * 3]; out[o + 1] = palette[i * 3 + 1]; out[o + 2] = palette[i * 3 + 2];
        out[o + 3] = trns && i < trns.length ? trns[i] : 255;
      }
    }
    prev = line;
  }
  return { width, height, rgba: out };
}

/* ==================================================================== PNG 编码 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(b) {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** RGBA 8-bit（color type 6）。对照图 / 中间产物用。 */
export function encodePngRGBA(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[o++] = rgba[i]; raw[o++] = rgba[i + 1]; raw[o++] = rgba[i + 2]; raw[o++] = rgba[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * PNG-8（索引色，color type 3）+ tRNS。`asset-spec §3.3` 的落盘格式：
 * **≤ 32 色、alpha 只允许 0 / 255**（禁止半透明）。
 * 返回 { buf, colors }；颜色数超上限直接抛（不让它偷偷降级）。
 */
export function encodePngIndexed(w, h, rgba, maxColors = 32, { hardAlpha = true } = {}) {
  const map = new Map();
  const order = [];
  const idx = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    let a = rgba[i * 4 + 3];
    if (hardAlpha) a = a >= 128 ? 255 : 0;
    const key = (a << 24) | (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    let v = map.get(key);
    if (v === undefined) {
      v = order.length;
      if (v >= maxColors) throw new Error(`索引色超上限：>${maxColors} 色`);
      map.set(key, v);
      order.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], a]);
    }
    idx[i] = v;
  }
  const plte = Buffer.alloc(order.length * 3);
  const trns = Buffer.alloc(order.length);
  let anyAlpha = false;
  order.forEach(([r, g, b, a], i) => {
    plte[i * 3] = r; plte[i * 3 + 1] = g; plte[i * 3 + 2] = b;
    trns[i] = a;
    if (a !== 255) anyAlpha = true;
  });
  const raw = Buffer.alloc((w + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) raw[o++] = idx[y * w + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 3;
  const parts = [SIG, chunk('IHDR', ihdr), chunk('PLTE', plte)];
  if (anyAlpha) parts.push(chunk('tRNS', trns));
  parts.push(chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return { buf: Buffer.concat(parts), colors: order.length };
}

/* ==================================================================== 色彩工具 */

export function hex2rgb(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

/** sRGB → CIE L*（0–100）。判"看不看得出明度差"用这个，不用 (r+g+b)/3。 */
export function toLstar(r, g, b) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return Y > 0.008856 ? 116 * Y ** (1 / 3) - 16 : 903.3 * Y;
}

export function rgbToHsl(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60;
    else if (max === G) h = ((B - R) / d + 2) * 60;
    else h = ((R - G) / d + 4) * 60;
  }
  return { h, s, l };
}

export function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/* ==================================================================== [1] 抠底 */

/**
 * 抠底。`asset-spec §5.2①`：**必须在降采样之前**做，否则洋红会与边缘过渡带平均成**粉边**。
 * 支持 'magenta'（钉死 #FF00FF）与 'auto'（取四角众数当底色，抗 AI 换底）。
 * 返回 { rgba, bg, keyed, residualPink }。
 */
export function keyOutBg(rgba, w, h, { mode = 'magenta', threshold = 90 } = {}) {
  let bg = [255, 0, 255];
  if (mode === 'auto') {
    const counts = new Map();
    const touch = (x, y) => {
      const i = (y * w + x) * 4;
      const k = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
      counts.set(k, (counts.get(k) ?? 0) + 1);
    };
    for (let x = 0; x < w; x++) { touch(x, 0); touch(x, h - 1); }
    for (let y = 0; y < h; y++) { touch(0, y); touch(w - 1, y); }
    let best = -1, bestN = -1;
    for (const [k, n] of counts) if (n > bestN) { bestN = n; best = k; }
    bg = [(best >> 16) & 255, (best >> 8) & 255, best & 255];
  }
  const out = new Uint8ClampedArray(rgba);
  let keyed = 0;
  let residualPink = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const dr = out[o] - bg[0], dg = out[o + 1] - bg[1], db = out[o + 2] - bg[2];
    if (Math.sqrt(dr * dr + dg * dg + db * db) < threshold) {
      out[o + 3] = 0;
      keyed++;
    } else if (out[o] > 150 && out[o + 2] > 150 && out[o + 1] < 110) {
      residualPink++; // 洋红残留（§9.1 断言 1 的判据）
    }
  }
  return { rgba: out, bg, keyed, residualPink };
}

/* ==================================================================== [1b] 掩罩区（去水印角落） */

/**
 * 把一块矩形区域**整块置透明**。
 * 用途（§2.3 / team-lead 硬边界「交付的位图必须无水印」）：本环境的 AI 出图**自带平台水印**
 * （右下角 `AI生成 WORKBUDDY`），落在**纯背景角落、主体不经过**。
 * ⚠️ 本函数**只做"整块掩掉"，不做像素级抹除 / 修补**（那是"去水印"，性质不同）。
 * 产出的 256×384 是**方向证据**，**不是可交付素材** —— 商用/水印这一关**未解决**，见 README。
 */
export function maskRect(rgba, w, h, rect) {
  const out = new Uint8ClampedArray(rgba);
  const x0 = Math.max(0, Math.floor(rect.x0 * w));
  const y0 = Math.max(0, Math.floor(rect.y0 * h));
  const x1 = Math.min(w, Math.ceil(rect.x1 * w));
  const y1 = Math.min(h, Math.ceil(rect.y1 * h));
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { out[(y * w + x) * 4 + 3] = 0; n++; }
  return { rgba: out, masked: n, rect: { x0, y0, x1, y1 } };
}

/** 某矩形区域内还有多少**非透明**像素（用来确认"掩罩把水印全盖住了"）。 */
export function opaqueCount(rgba, w, h, rect) {
  const x0 = Math.max(0, Math.floor(rect.x0 * w));
  const y0 = Math.max(0, Math.floor(rect.y0 * h));
  const x1 = Math.min(w, Math.ceil(rect.x1 * w));
  const y1 = Math.min(h, Math.ceil(rect.y1 * h));
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (rgba[(y * w + x) * 4 + 3] > 0) n++;
  return n;
}

/* ==================================================================== [2] 块众数降采样 */

/**
 * 块众数降采样（`asset-spec §5.2②`）。**不用 nearest / bilinear**：
 * mode 天然吃掉块内过渡带（少数派过渡色被多数派真实色击败）+ 自动量化。
 * 全透明块 ⇒ 输出也透明。平票取"块内出现次数最多的那个"里**亮度中位**者。
 */
export function blockModeDownsample(rgba, w, h, k = 8) {
  const ow = Math.floor(w / k), oh = Math.floor(h / k);
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let by = 0; by < oh; by++) {
    for (let bx = 0; bx < ow; bx++) {
      const counts = new Map();
      let alpha = 0;
      for (let y = 0; y < k; y++) {
        for (let x = 0; x < k; x++) {
          const i = ((by * k + y) * w + bx * k + x) * 4;
          if (rgba[i + 3] < 128) { alpha++; continue; }
          const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      const o = (by * ow + bx) * 4;
      if (alpha > (k * k) / 2 || counts.size === 0) { out[o + 3] = 0; continue; }
      let best = -1, bestN = 0;
      for (const [key, n] of counts) {
        if (n > bestN) { bestN = n; best = key; }
      }
      // 平票里取亮度中位者（§5.2② 的原话）
      const ties = [...counts].filter(([, n]) => n === bestN).map(([key]) => key);
      if (ties.length > 1) {
        ties.sort((a, bb) => toLstar((a >> 16) & 255, (a >> 8) & 255, a & 255)
          - toLstar((bb >> 16) & 255, (bb >> 8) & 255, bb & 255));
        best = ties[ties.length >> 1];
      }
      out[o] = (best >> 16) & 255;
      out[o + 1] = (best >> 8) & 255;
      out[o + 2] = best & 255;
      out[o + 3] = 255;
    }
  }
  return { rgba: out, width: ow, height: oh };
}

/* ==================================================================== [3] 调色板钳制 */

/** 全局基底色板 + 四族主题色（`cartoon-style.md §3.2 / §3.3`）。 */
export function buildPalette() {
  const base = {
    ink0: '#2a1a12', ink1: '#4a3524', hi0: '#ffffff', hi1: '#fff3c8',
    woodLight: '#a8703c', woodMid: '#8a5f34', woodDark: '#5f4022',
    stoneLight: '#cfc6b4', stoneMid: '#a9a093', stoneDark: '#6f6858',
    metalLight: '#dfe6f0', metalMid: '#aab6c2', metalDark: '#6b7686',
    canvasLight: '#e8d9a8', canvasMid: '#b9a06a',
    skinLight: '#f0c79a', skinMid: '#d8a878', skinDark: '#a87450',
    leafLight: '#6fc24a', leafMid: '#4a8438', leafDark: '#2f5a24',
  };
  const fac = {
    p1: ['#3f8fe8', '#8ecdf8', '#22559e', '#eae3d2', '#b3a894', '#ffb020'],
    p2: ['#e04a34', '#f79a7a', '#9a2519', '#c98a4e', '#8a5a30', '#2fbfa0'],
    p3: ['#3fbe6e', '#93e8a8', '#1f7a45', '#7a7a48', '#4f5130', '#e0538f'],
    p4: ['#a165e8', '#d4aefc', '#6232a8', '#58526e', '#38334a', '#3fe0d0'],
    neutral: ['#a08a72', '#6b5b48', '#cfc6b4', '#d0d0d8'],
  };
  const out = [];
  for (const [name, hex] of Object.entries(base)) out.push({ name, hex, ...hslOf(hex) });
  for (const [f, list] of Object.entries(fac)) list.forEach((hex, i) => out.push({ name: `${f}_${i}`, hex, ...hslOf(hex) }));
  return out;
}

function hslOf(hex) {
  const [r, g, b] = hex2rgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  return { rgb: [r, g, b], h, s, l, bin: Math.min(4, Math.max(0, Math.floor(l * 5))) };
}

/**
 * 调色板钳制（`asset-spec §5.2③`）：**先在 HSL 分桶到 5 个明度台阶，再取同台阶内色相最近者**。
 * ⚠️ 明文禁止朴素 RGB 欧氏距离（它会把深红映射到深绿）。
 * 返回 { rgba, used:Set<hex>, unclamped }。
 */
export function clampToPalette(rgba, w, h, palette) {
  const out = new Uint8ClampedArray(rgba);
  const used = new Set();
  const cache = new Map();
  // ⚠️ 近中性色（低饱和）的**色相是没有意义的** —— 拿它去比色相会把奶白盔甲映射到叶绿。
  // ⇒ 中性色单独走「只比明度」的池子（这也正对上 `cartoon-style §2.4` 的「明度签名」思路）。
  const NEUTRAL_S = 0.12;
  const neutralPool = palette.filter((p) => p.s < 0.2);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) { out[o + 3] = 0; continue; }
    const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
    let hit = cache.get(key);
    if (!hit) {
      const { h: ph, s: ps, l: pl } = rgbToHsl(rgba[o], rgba[o + 1], rgba[o + 2]);
      let best, bestD = Infinity;
      if (ps < NEUTRAL_S && neutralPool.length) {
        for (const p of neutralPool) {
          const d = Math.abs(p.l - pl) * 2 + p.s * 0.2;
          if (d < bestD) { bestD = d; best = p; }
        }
      } else {
        const bin = Math.min(4, Math.max(0, Math.floor(pl * 5)));
        let pool = palette.filter((p) => p.bin === bin && p.s >= NEUTRAL_S);
        if (!pool.length) pool = palette.filter((p) => p.s >= NEUTRAL_S);
        if (!pool.length) pool = palette;
        for (const p of pool) {
          let dh = Math.abs(p.h - ph);
          if (dh > 180) dh = 360 - dh;
          const d = dh / 180 + Math.abs(p.l - pl) * 0.35; // 色相为主，明度次之
          if (d < bestD) { bestD = d; best = p; }
        }
      }
      hit = best;
      cache.set(key, best);
    }
    out[o] = hit.rgb[0]; out[o + 1] = hit.rgb[1]; out[o + 2] = hit.rgb[2];
    out[o + 3] = 255;
    used.add(hit.hex);
  }
  return { rgba: out, used };
}

/**
 * 色数收敛（`cartoon-style §3.4`：**单个精灵最多 24 色**）。
 * 钳色后仍可能超过上限（AI 会把相邻材质挤到色板的不同近邻上）⇒ 把**用量最少**的颜色
 * 合并到**离它最近的保留色**，直到 ≤ cap。合并**只在色板内**进行，不现场造色。
 */
export function reduceColors(rgba, w, h, cap = 24) {
  const counts = new Map();
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) continue;
    const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size <= cap) return { rgba, colors: counts.size, merged: 0 };
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const keep = sorted.slice(0, cap).map(([k]) => k);
  const drop = sorted.slice(cap).map(([k]) => k);
  const hsl = (k) => rgbToHsl((k >> 16) & 255, (k >> 8) & 255, k & 255);
  const keepHsl = keep.map(hsl);
  const remap = new Map();
  for (const k of drop) {
    const { h: ph, l: pl } = hsl(k);
    let bestK = keep[0], bestD = Infinity;
    keep.forEach((kk, i) => {
      let dh = Math.abs(keepHsl[i].h - ph);
      if (dh > 180) dh = 360 - dh;
      const d = dh / 180 + Math.abs(keepHsl[i].l - pl) * 0.35;
      if (d < bestD) { bestD = d; bestK = kk; }
    });
    remap.set(k, bestK);
  }
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (out[o + 3] < 128) continue;
    const key = (out[o] << 16) | (out[o + 1] << 8) | out[o + 2];
    const t = remap.get(key);
    if (t !== undefined) { out[o] = (t >> 16) & 255; out[o + 1] = (t >> 8) & 255; out[o + 2] = t & 255; }
  }
  return { rgba: out, colors: keep.length, merged: drop.length };
}

/* ==================================================================== [4] 裁剪 / 缩放 / 落位 */

export function cropBBox(rgba, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] > 0) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { rgba: new Uint8ClampedArray(0), width: 0, height: 0, x: 0, y: 0 };
  const cw = x1 - x0 + 1, chh = y1 - y0 + 1;
  const out = new Uint8ClampedArray(cw * chh * 4);
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
    const s = ((y0 + y) * w + (x0 + x)) * 4, t = (y * cw + x) * 4;
    out[t] = rgba[s]; out[t + 1] = rgba[s + 1]; out[t + 2] = rgba[s + 2]; out[t + 3] = rgba[s + 3];
  }
  return { rgba: out, width: cw, height: chh, x: x0, y: y0 };
}

/** 整数比缩放（`asset-spec §5.4`：**只用整数比**，禁止非整数比破坏像素栅格）。 */
export function nearestScale(rgba, w, h, k) {
  if (k === 1) return { rgba, width: w, height: h };
  const ow = w * k, oh = h * k;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const s = ((y / k | 0) * w + (x / k | 0)) * 4, t = (y * ow + x) * 4;
    out[t] = rgba[s]; out[t + 1] = rgba[s + 1]; out[t + 2] = rgba[s + 2]; out[t + 3] = rgba[s + 3];
  }
  return { rgba: out, width: ow, height: oh };
}

/** 落位到目标画布：**水平居中、底部基线严格对齐画布底边**（`asset-spec §5.4`）。 */
export function placeInto(rgba, w, h, cw, ch, { align = 'center', vAlign = 'bottom', pad = 0 } = {}) {
  const out = new Uint8ClampedArray(cw * ch * 4);
  let dx = align === 'center' ? Math.round((cw - w) / 2) : align === 'right' ? cw - w - pad : pad;
  let dy = vAlign === 'bottom' ? ch - h - pad : vAlign === 'center' ? Math.round((ch - h) / 2) : pad;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const tx = dx + x, ty = dy + y;
    if (tx < 0 || ty < 0 || tx >= cw || ty >= ch) continue;
    const s = (y * w + x) * 4, t = (ty * cw + tx) * 4;
    out[t] = rgba[s]; out[t + 1] = rgba[s + 1]; out[t + 2] = rgba[s + 2]; out[t + 3] = rgba[s + 3];
  }
  return { rgba: out, dx, dy };
}

/* ==================================================================== [5] 描边重建 */

/**
 * 描边重建（`asset-spec §5.4`）：**丢掉 AI 自带的边**（粗细不均 / 发灰 / 抗锯齿残留），
 * 用 `ink0` 重跑。这是"AI 资产与程序化资产像一家人"的**唯一决定步骤**。
 * width：`cartoon-style §1.1` —— 高 ≤64px 用 1px，≥65px 用 2px。
 */
export function outlineInk(rgba, w, h, inkHex = '#2a1a12', width = 1) {
  const [ir, ig, ib] = hex2rgb(inkHex);
  const out = new Uint8ClampedArray(rgba);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 0) continue;
      let near = false;
      for (let dy = -width; dy <= width && !near; dy++) {
        for (let dx = -width; dx <= width; dx++) {
          if (dx * dx + dy * dy > width * width + 1) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (rgba[(ny * w + nx) * 4 + 3] > 0) { near = true; break; }
        }
      }
      if (near) {
        const o = (y * w + x) * 4;
        out[o] = ir; out[o + 1] = ig; out[o + 2] = ib; out[o + 3] = 255;
      }
    }
  }
  return out;
}

/* ==================================================================== 合成（给 mockup 用） */

/**
 * 把 src **1:1 贴**在 dst 的 (x,y)。**纯 alpha 合成、零缩放** ——
 * 免得 mockup 里的立绘被浏览器按非整数比例重采样（那正是 §3.3 要避免的劣化）。
 */
export function pasteRGBA(dst, dw, dh, src, sw, sh, x, y) {
  const out = new Uint8ClampedArray(dst);
  for (let j = 0; j < sh; j++) {
    const ty = y + j;
    if (ty < 0 || ty >= dh) continue;
    for (let i = 0; i < sw; i++) {
      const tx = x + i;
      if (tx < 0 || tx >= dw) continue;
      const s = (j * sw + i) * 4;
      if (src[s + 3] === 0) continue;
      const t = (ty * dw + tx) * 4;
      out[t] = src[s]; out[t + 1] = src[s + 1]; out[t + 2] = src[s + 2]; out[t + 3] = 255;
    }
  }
  return out;
}

/* ==================================================================== 度量 */
/** 逐像素 Δ（`shots/README.md` 的口径：平均 |ΔL*| + 变化像素占比）。 */
export function diffStats(a, b, w, h) {
  let sum = 0, n = 0, changed = 0, maxd = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const la = a[o + 3] < 128 ? null : toLstar(a[o], a[o + 1], a[o + 2]);
    const lb = b[o + 3] < 128 ? null : toLstar(b[o], b[o + 1], b[o + 2]);
    if (la === null && lb === null) continue;
    const d = la === null || lb === null ? 100 : Math.abs(la - lb);
    sum += d; n++;
    if (d > 1) changed++;
    if (d > maxd) maxd = d;
  }
  return { meanAbsL: n ? sum / n : 0, changedPct: n ? (changed / n) * 100 : 0, maxL: maxd, pixels: n };
}

export function countColors(rgba, w, h) {
  const s = new Set();
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) continue;
    s.add((rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2]);
  }
  return s.size;
}
