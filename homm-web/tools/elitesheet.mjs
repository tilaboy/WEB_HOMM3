#!/usr/bin/env node
/**
 * elitesheet.mjs —— S4 升级形态**逐兵**放大对照（人工项，不入门控）。
 *
 * 为什么不能只看 `unitsheet.mjs`：那张表是「列 = 兵种、行 = 帧种」，升级版和基础版
 * 会被排进不同列，隔着几十条像素带；而这里要判的是「同一个兵换了一档，还认不认得出
 * 是同一个兵 + 看得出是升级了没有」—— 必须**并排贴着看**。
 *
 * 每张图三行（行 = 同一个兵）：
 *   ① cu idle **×12**：基础版 | 升级形态        ← 判「多出来的那件东西叫什么」
 *   ② 43×37 兵牌 **×10**：基础版 | 升级形态      ← 判「小尺寸上还成不成立」
 *   ③ map 图标 **×10**：基础版 | 升级形态        ← 判「地图上会不会认错」
 * 左半永远是基础版，右半永远是升级形态，中间一道 8px 竖线。**不标名字**——
 * 认得出才是认得出，标了名字就变成"照着答案找"。
 *
 * 用法：
 *   node tools/elitesheet.mjs <outdir> [fam] [zoom]
 *     fam  = p1 | p2 | p3 | p4（默认 p1）；只出**已登记帧**的兵，缺帧直接跳过并打印
 *     zoom = cu 行的放大倍数（默认 12；兵牌/map 固定 10×，与 cu 解耦）
 *
 * 前置：`npm run build`（读 dist 里的渲染代码，与线上逐字节同源）。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { distDir, distUrl } from './_dist.mjs';

const DIST = distDir();
const art = await import(distUrl('render/unitArt.js', DIST));
const { unitCombatFrame, unitMapFrame } = await import(distUrl('render/unitFrames.js', DIST));
const { UNITS, upgradedUnitIdOf } = await import(distUrl('core/data/units.js', DIST));

const OUT = process.argv[2] ?? '/tmp/elitesheet';
const FAM = (process.argv[3] ?? 'p1').toLowerCase();
const ZOOM = Number(process.argv[4] ?? 12);
const CARD_ZOOM = 10;
const GAP = 10;
const BG = [24, 24, 30];

/* ---- 零依赖 PNG（与 unitsheet / b0audit 同法） ---- */
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

/** 最近邻放大后贴到画布上（与 unitsheet 同语义：整数倍、不插值）。 */
function blit(dst, W, H, pb, ox, oy, z) {
  for (let y = 0; y < pb.h; y++) {
    for (let x = 0; x < pb.w; x++) {
      const p = pb.px(x, y);
      if (p[3] === 0) continue;
      for (let dy = 0; dy < z; dy++) {
        const ty = oy + y * z + dy;
        if (ty < 0 || ty >= H) continue;
        for (let dx = 0; dx < z; dx++) {
          const tx = ox + x * z + dx;
          if (tx < 0 || tx >= W) continue;
          const i = (ty * W + tx) * 4;
          dst[i] = p[0];
          dst[i + 1] = p[1];
          dst[i + 2] = p[2];
          dst[i + 3] = 255;
        }
      }
    }
  }
}

const ids = Object.keys(UNITS).filter((id) => id.startsWith(`${FAM}_`) && !id.endsWith('_u') && UNITS[id].tier);
ids.sort((a, b) => (UNITS[a].tier ?? 0) - (UNITS[b].tier ?? 0));

const rows = [];
const skipped = [];
for (const id of ids) {
  const up = upgradedUnitIdOf(id);
  if (!up || !UNITS[up]) {
    skipped.push(`${id}: 没有升级形态`);
    continue;
  }
  const have = (n) => art.UNIT_FRAMES.some((sp) => sp.name === n);
  const names = {
    baseCu: unitCombatFrame(id),
    upCu: unitCombatFrame(up),
    baseMap: unitMapFrame(id),
    upMap: unitMapFrame(up),
  };
  const missing = Object.entries(names).filter(([, n]) => !have(n));
  if (missing.length) {
    skipped.push(`${up}: 缺帧 ${missing.map(([, n]) => n).join(', ')}`);
    continue;
  }
  rows.push({ id, up, names });
}

if (!rows.length) {
  console.error(`没有可出图的升级形态（fam=${FAM}）。缺帧情况：\n  ${skipped.join('\n  ')}`);
  process.exit(2);
}

/* ---- 布局：**一兵一图**。三行（cu / 兵牌 / map），左 = 基础版，右 = 升级形态 ---- */
const ROW_BLOCKS = [
  { kind: 'cu', z: ZOOM, key: ['baseCu', 'upCu'] },
  { kind: 'card', z: CARD_ZOOM, key: ['baseCu', 'upCu'], portrait: true },
  { kind: 'map', z: CARD_ZOOM, key: ['baseMap', 'upMap'] },
];

mkdirSync(OUT, { recursive: true });

const built = [];
for (const r of rows) {
  // 每行的高度按该兵自己在两侧取最大（兵与兵尺寸不同，取全批最大会让矮兵悬在半空）
  const cellW = [];
  const cellH = [];
  for (const b of ROW_BLOCKS) {
    let w = 0;
    let h = 0;
    for (const k of b.key) {
      const pb = b.portrait ? art.buildPortraitFrame(r.names[k]) : art.buildB0Frame(r.names[k]);
      w = Math.max(w, pb.w * b.z);
      h = Math.max(h, pb.h * b.z);
    }
    cellW.push(w);
    cellH.push(h);
  }

  const SEP_W = 8;
  const W = GAP * 3 + Math.max(...cellW) * 2 + SEP_W;
  let H = GAP;
  for (const h of cellH) H += h + GAP;

  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = BG[0];
    out[i * 4 + 1] = BG[1];
    out[i * 4 + 2] = BG[2];
    out[i * 4 + 3] = 255;
  }

  const colW = Math.max(...cellW);
  const xLeft = GAP;
  const SEP_X = GAP + colW + GAP;
  const xRight = SEP_X + SEP_W + GAP;

  // 分隔线整幅通高：左半永远是基础版，右半永远是升级形态，避免"哪边是升级"看错
  for (let y = 0; y < H; y++) {
    for (let dx = 0; dx < SEP_W; dx++) {
      const i = (y * W + SEP_X + dx) * 4;
      out[i] = 70;
      out[i + 1] = 70;
      out[i + 2] = 82;
    }
  }

  let y = GAP;
  for (let bi = 0; bi < ROW_BLOCKS.length; bi++) {
    const b = ROW_BLOCKS[bi];
    for (let side = 0; side < 2; side++) {
      const name = r.names[b.key[side]];
      const pb = b.portrait ? art.buildPortraitFrame(name) : art.buildB0Frame(name);
      const ox = side === 0 ? xLeft : xRight;
      const oy = y + cellH[bi] - pb.h * b.z; // 底对齐：脚在同一条基线上
      blit(out, W, H, pb, ox, oy, b.z);
    }
    y += cellH[bi] + GAP;
  }

  const file = join(OUT, `${FAM}-${r.id}.png`);
  writeFileSync(file, encodePng(W, H, out));
  built.push({ file, w: W, h: H, r });
}

console.log(`[elitesheet] ${FAM} · ${rows.length} 兵 · cu ×${ZOOM} / 兵牌与图标 ×${CARD_ZOOM}`);
console.log(`  左 = 基础版，右 = 升级形态；三行从上到下：cu idle / 43×37 兵牌 / map 图标`);
for (const b of built) console.log(`  T${UNITS[b.r.id].tier} ${b.r.id} → ${b.r.up}   ${b.w}×${b.h}  ${b.file}`);
if (skipped.length) console.log(`  跳过：\n    ${skipped.join('\n    ')}`);
