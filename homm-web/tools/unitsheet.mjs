#!/usr/bin/env node
/**
 * unitsheet.mjs —— 把某一批程序化兵种帧拼成一张对照大图，供人工肉眼验收。
 *
 * 为什么不直接看单帧 PNG：单帧没有共同基线、没有并排对比，"眼睛已在 2×2px + 高光 +
 * 嘴线"这类判断必须靠并排才看得出来。这张表把同批的 map / cu idle / cu atk 三行
 * 按列对齐，**列 = 阵营，行 = 帧种类**，正好对应剪影圣经 §5.6 的
 * 「Tier 通道纵向 × Faction 通道横向」4×5 网格的读法。
 *
 * 用法：
 *   node tools/unitsheet.mjs <out.png> [batch] [zoom] [unitFilter]
 *     batch = B0 | B1 | B2 | B3 | all   （默认 B3，即最新一批 T5）
 *     unitFilter = 逗号分隔的兵种 id 子串，如 lavatroll,colossus；省略 = 整批
 *
 * 例：node tools/unitsheet.mjs /tmp/t5.png B3 6
 *     node tools/unitsheet.mjs /tmp/one.png B3 14 p2_lavatroll   ← 单体放大看细节
 *
 * 不入门控（b0audit 管"画得对不对"，这张表管"看起来对不对"——人工项）。
 * 零依赖：PNG 编码与 b0audit 同法。
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { distDir, distUrl } from './_dist.mjs';

const DIST = distDir();
const art = await import(distUrl('render/unitArt.js', DIST));

const BATCHES = {
  B0: art.B0_FRAMES,
  B1: art.B1_FRAMES,
  B2: art.B2_FRAMES,
  B3: art.B3_FRAMES,
};

const OUT = process.argv[2] ?? '/tmp/unitsheet.png';
const BATCH = (process.argv[3] ?? 'B3').toUpperCase();
const ZOOM = Number(process.argv[4] ?? 6);
const FILTER = process.argv[5] ?? '';
const GAP = 6;
const LABEL_H = 14; // 每格顶部留一条纯色带当"标签条"（不做字形，避免造字库）

const all = BATCH === 'ALL' ? Object.values(BATCHES).flat() : BATCHES[BATCH];
if (!all) {
  console.error(`批次名不认识：${BATCH}（可选 ${Object.keys(BATCHES).join(' / ')} / ALL）`);
  process.exit(2);
}
/** unitFilter 是逗号分隔的子串（任一命中即保留），空 = 全批 */
const frames = FILTER
  ? all.filter((f) => FILTER.split(',').some((s) => s.trim() && f.unit.includes(s.trim())))
  : all;
if (!frames.length) {
  console.error(`unitFilter 没匹配到任何帧：${FILTER}（批次 ${BATCH} 内无此兵种）`);
  process.exit(2);
}

/* ---- 零依赖 PNG（与 b0audit 同法） ---- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[o++] = rgba[i];
      raw[o++] = rgba[i + 1];
      raw[o++] = rgba[i + 2];
      raw[o++] = rgba[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const readRows = (pb) => {
  const rows = [];
  for (let y = 0; y < pb.h; y++) {
    const row = [];
    for (let x = 0; x < pb.w; x++) row.push(pb.px(x, y));
    rows.push(row);
  }
  return rows;
};

/* ---- 布局：列 = 兵种（按批内出现序），行 = map / idle / atk ---- */
const UNITS = [...new Set(frames.map((f) => f.unit))];
const KINDS = ['map', 'idle', 'atk'];
const BG = [24, 24, 30];

/** 标签条颜色 = 该族主色（p1 蓝 / p2 红 / p3 绿 / p4 紫），只用于分隔列，不参与美术判断 */
const FAMILY_COLOR = {
  p1: [63, 143, 232, 255],
  p2: [224, 74, 52, 255],
  p3: [31, 122, 69, 255],
  p4: [98, 50, 168, 255],
};
const familyOf = (unit) => FAMILY_COLOR[unit.slice(0, 2)] ?? [120, 120, 130, 255];

const maxW = Math.max(...frames.map((f) => f.w));
const maxH = Math.max(...frames.map((f) => f.h));
const cw = maxW * ZOOM;
const ch = maxH * ZOOM + LABEL_H;
const W = GAP + UNITS.length * (cw + GAP);
const H = GAP + KINDS.length * (ch + GAP);
const out = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) {
  out[i * 4] = BG[0];
  out[i * 4 + 1] = BG[1];
  out[i * 4 + 2] = BG[2];
  out[i * 4 + 3] = 255;
}

let missing = 0;
KINDS.forEach((kind, ri) => {
  UNITS.forEach((unit, ci) => {
    const spec = frames.find((f) => f.unit === unit && f.kind === kind);
    if (!spec) {
      missing++;
      return;
    }
    const pb = art.buildB0Frame(spec.name);
    const rows = readRows(pb);
    const ox = GAP + ci * (cw + GAP);
    const oy = GAP + ri * (ch + GAP);
    const lc = familyOf(unit);
    for (let y = oy; y < oy + LABEL_H; y++) {
      for (let x = ox; x < ox + cw; x++) {
        const i = (y * W + x) * 4;
        out[i] = lc[0];
        out[i + 1] = lc[1];
        out[i + 2] = lc[2];
        out[i + 3] = 255;
      }
    }
    const fw = spec.w * ZOOM;
    const fh = spec.h * ZOOM;
    const fx = ox + Math.round((cw - fw) / 2);
    const fy = oy + LABEL_H + Math.round((maxH * ZOOM - fh) / 2);
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const s = rows[Math.floor(y / ZOOM)][Math.floor(x / ZOOM)];
        if (s[3] <= 8) continue;
        const i = ((fy + y) * W + (fx + x)) * 4;
        const a = s[3] / 255;
        out[i] = Math.round(s[0] * a + BG[0] * (1 - a));
        out[i + 1] = Math.round(s[1] * a + BG[1] * (1 - a));
        out[i + 2] = Math.round(s[2] * a + BG[2] * (1 - a));
        out[i + 3] = 255;
      }
    }
  });
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, encodePng(W, H, out));
console.log(`${OUT}  ${W}×${H}  批次=${BATCH}  帧数=${frames.length}`);
console.log(`列（左→右）：${UNITS.join(' | ')}`);
console.log(`行（上→下）：${KINDS.join(' | ')}`);
if (missing) console.log(`[信息] ${missing} 个格子无对应帧（该兵种没有这一类）`);