/**
 * 零依赖 PNG 写出（`deflateSync` 来自 node:zlib）。
 *
 * 从 `probes/guildart.mjs` 提出来（B1 批要第二个使用者）：
 * 两个探针各抄一份 50 行编码器，改一处漏一处就会产出两种 PNG。
 *
 * ⚠️ 调用方若在**模块顶层**就用 `encodePng()`，`CRC_TABLE` 必须是**顶部声明**的
 * `let`（`townartaudit.mjs` 2026-11-06、`guildart.mjs` 2026-11-13 各踩过一次
 * `Cannot access 'CRC_TABLE' before initialization`）。本文件已把它放在最前。
 */
import { deflateSync } from 'node:zlib';

let CRC_TABLE;

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  CRC_TABLE = t;
  return t;
}

function crc32(buf) {
  const T = crcTable();
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** `{w, h, data}`（RGBA）→ PNG Buffer。 */
export function encodePng({ w, h, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(data.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 最近邻放大 ×k（像素画放大只能这样，插值会出灰边）。 */
export function upscale(pb, k) {
  const w = pb.w * k;
  const h = pb.h * k;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (((y / k) | 0) * pb.w + ((x / k) | 0)) * 4;
      const d = (y * w + x) * 4;
      data[d] = pb.d[s];
      data[d + 1] = pb.d[s + 1];
      data[d + 2] = pb.d[s + 2];
      data[d + 3] = pb.d[s + 3];
    }
  }
  return { w, h, data };
}

/**
 * 把若干帧拼成一张对照表（每格 `cell` px，格子间留 `gap` px 的深色缝）。
 * `frames` = [{ pb, label? }]，按 `cols` 列排。
 */
export function montage(frames, { cols = 4, cell = 132, gap = 6, bg = '#1b1409' } = {}) {
  const rows = Math.ceil(frames.length / cols);
  const w = cols * cell + (cols + 1) * gap;
  const h = rows * cell + (rows + 1) * gap;
  const data = new Uint8ClampedArray(w * h * 4);
  const [br, bgc, bb] = [1, 3, 9].map((i) => parseInt(bg.slice(i, i + 2), 16));
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = br;
    data[i * 4 + 1] = bgc;
    data[i * 4 + 2] = bb;
    data[i * 4 + 3] = 255;
  }
  frames.forEach(({ pb }, idx) => {
    const cx = gap + (idx % cols) * (cell + gap);
    const cy = gap + Math.floor(idx / cols) * (cell + gap);
    const k = Math.max(1, Math.floor(cell / Math.max(pb.w, pb.h)));
    const sw = pb.w * k;
    const sh = pb.h * k;
    const ox = cx + ((cell - sw) / 2) | 0;
    const oy = cy + ((cell - sh) / 2) | 0;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const s = (((y / k) | 0) * pb.w + ((x / k) | 0)) * 4;
        const a = pb.d[s + 3] / 255;
        if (a <= 0) continue;
        const d = ((oy + y) * w + (ox + x)) * 4;
        data[d] = pb.d[s] * a + data[d] * (1 - a);
        data[d + 1] = pb.d[s + 1] * a + data[d + 1] * (1 - a);
        data[d + 2] = pb.d[s + 2] * a + data[d + 2] * (1 - a);
        data[d + 3] = 255;
      }
    }
  });
  return { w, h, data };
}
