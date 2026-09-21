#!/usr/bin/env node
/**
 * dressshot.mjs —— 在**真实生成的图**上出「布景层改前/改后」对照（真 Chrome）。
 *
 * 为什么要它（本轮找出的真 bug 的证据工具）：
 *   `tools/artshot.mjs` 用的是一张**手搭的 26×16 测试图**。那张图上物件少（十几处），
 *   `sd_g_*` 的净距规则几乎不咬合 ⇒ 老实现也能放出 ~8 个道具 —— **测试图掩盖了 bug**。
 *   一旦换成 `createGame()` 真实生成的图（每张 130+ 障碍物），老实现**几乎放不下东西**。
 *   所以「密度」这件事**只能在真图上量**。
 *
 * 本工具复用运行期真实代码（`TerrainLayer` / `SetDressingLayer` / 图集），
 * 用自建 Canvas2D 垫片在 node 里合成（同 artshot.mjs 的口径与诚实边界）。
 *
 * 用法：node tools/dressshot.mjs [输出目录]
 */
import { installShim } from './_canvas.mjs';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

installShim();
const ROOT = process.cwd();
const { getAtlas } = await import(join(ROOT, 'dist/render/atlas.js'));
const { TerrainLayer } = await import(join(ROOT, 'dist/render/terrainLayer.js'));
const { SetDressingLayer, placementsOf } = await import(join(ROOT, 'dist/render/setDressing.js'));
const { quality } = await import(join(ROOT, 'dist/render/quality.js'));
const { createGame } = await import(join(ROOT, 'dist/core/map/generator.js'));

const TILE = 32;
const OUT = process.argv[2] ?? '../design/art-bible/shots';
const ZOOM = 2;

/* ---------------- PNG（零依赖，与 artshot/b0audit 同法） ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; raw[o++] = rgba[i]; raw[o++] = rgba[i + 1]; raw[o++] = rgba[i + 2]; raw[o++] = rgba[i + 3]; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function upscale(rgba, w, h, k) {
  const out = new Uint8ClampedArray(w * k * h * k * 4);
  for (let y = 0; y < h * k; y++) for (let x = 0; x < w * k; x++) {
    const s = ((y / k | 0) * w + (x / k | 0)) * 4, t = (y * w * k + x) * 4;
    out[t] = rgba[s]; out[t + 1] = rgba[s + 1]; out[t + 2] = rgba[s + 2]; out[t + 3] = rgba[s + 3];
  }
  return out;
}

/* ---------------- 物件 → 精灵（复刻 MapRenderer.objSprite 的**只读子集**） ---------------- */
function spriteOf(obj, state, hx, hy) {
  const hash = ((hx * 73856093) ^ (hy * 19349663)) >>> 0 / 2 ** 32;
  switch (obj.kind) {
    case 'obstacle': {
      const v = obj.payload.variant;
      if (v === 'tree') return hash < 0.5 ? 'tree0' : 'tree1';
      if (v === 'rock') return hash < 0.5 ? 'rock0' : 'rock1';
      return hash < 0.5 ? 'mtn0' : 'mtn1';
    }
    case 'wanderingMonster': return `mon_${obj.payload.army[0]?.unitTypeId ?? 'wolf'}`;
    case 'resourcePile': return `res_${obj.payload.resource}`;
    case 'mine': return `mine_${obj.payload.resource}`;
    case 'vault': return 'vault';
    case 'treasureChest': return 'chest';
    case 'fountain': return 'fountain';
    case 'artifact': return 'artifact';
    case 'town': return obj.footprint ? 'castle_neutral_0' : 'town_neutral_0';
    default: return null;
  }
}

function render(state, { setDressing }) {
  const map = state.map;
  const atlas = getAtlas();
  const terrain = new TerrainLayer();
  terrain.macroShade = true;
  quality.setDressing = setDressing;
  const dressing = new SetDressingLayer();

  const W = map.width, H = map.height;
  const cv = document.createElement('canvas');
  cv.width = W * TILE; cv.height = H * TILE;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, cv.width, cv.height);

  ctx.drawImage(terrain.ensure(map), 0, 0);
  if (setDressing !== 'off') ctx.drawImage(dressing.ensure(map), 0, 0);

  // 水面
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (map.tiles[y * W + x].terrain !== 'water') continue;
    const v = (x * 31 + y * 17) % 2;
    const f = atlas.get(`g_water_${v}_0`);
    if (f) ctx.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, x * TILE + f.ax, y * TILE + f.ay, f.w, f.h);
  }

  // 物件（按 y 排序）
  const objs = Object.keys(map.objects).map((id) => map.objects[id]);
  objs.sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
  for (const o of objs) {
    const name = spriteOf(o, state, o.pos.x, o.pos.y);
    if (!name) continue;
    const f = atlas.get(name);
    if (!f) continue;
    ctx.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, o.pos.x * TILE + f.ax, o.pos.y * TILE + f.ay, f.w, f.h);
  }
  return cv;
}

function save(name, canvas) {
  const up = upscale(canvas.buf, canvas.width, canvas.height, ZOOM);
  const png = encodePng(canvas.width * ZOOM, canvas.height * ZOOM, up);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), png);
  console.log(`  → ${join(OUT, name)}  (${(png.length / 1024).toFixed(0)} KB)`);
}

/** 从整图渲染里裁一块（设备像素）并放大 —— 供人眼读"一屏里到底多了什么"。 */
function saveCrop(name, canvas, x0, y0, cw, ch, k) {
  const out = new Uint8ClampedArray(cw * k * ch * k * 4);
  for (let y = 0; y < ch * k; y++) for (let x = 0; x < cw * k; x++) {
    const sx = (x0 + (x / k | 0)), sy = (y0 + (y / k | 0));
    const s = (sy * canvas.width + sx) * 4, t = (y * cw * k + x) * 4;
    out[t] = canvas.buf[s]; out[t + 1] = canvas.buf[s + 1]; out[t + 2] = canvas.buf[s + 2]; out[t + 3] = canvas.buf[s + 3];
  }
  const png = encodePng(cw * k, ch * k, out);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), png);
  console.log(`  → ${join(OUT, name)}  (${(png.length / 1024).toFixed(0)} KB)`);
}

const SEED = 20260921;
const SIZE = 'medium';
const st = createGame({ seed: SEED, size: SIZE });
console.log(`真实生成图 ${st.map.width}x${st.map.height} seed=${SEED} · 物件 ${Object.keys(st.map.objects).length} 处`);

const placed = placementsOf(st.map);
const byType = {};
for (const p of placed) byType[p.name] = (byType[p.name] ?? 0) + 1;
console.log(`布景落点（现行代码）：共 ${placed.length} 个 → ${JSON.stringify(byType)}`);

console.log('\n渲染真实图：布景 off / on');
const cvOff = render(st, { setDressing: 'off' });
const cvOn = render(st, { setDressing: 'static' });
save('h_real_dress_off.png', cvOff);
save('h_real_dress_on.png', cvOn);

/* 找"最挤的一屏"（12×4 格，真机口径）—— 人眼只需看最坏那屏，不必看整图 */
const W = st.map.width, H = st.map.height;
const SW = 12, SH = 4;
let best = { x: 0, y: 0, n: -1 };
for (let y = 0; y + SH <= H; y++) for (let x = 0; x + SW <= W; x++) {
  const n = placed.filter((p) => p.x >= x && p.x < x + SW && p.y >= y && p.y < y + SH).length;
  if (n > best.n) best = { x, y, n };
}
const screens = (W * H) / (SW * SH);
console.log(`\n最挤一屏（12×4 格）：${best.n} 个布景 @ tile(${best.x},${best.y})`);
const cx = best.x * TILE, cy = best.y * TILE, cw = SW * TILE, ch = SH * TILE;
saveCrop('h_real_dress_off_crop.png', cvOff, cx, cy, cw, ch, 3);
saveCrop('h_real_dress_on_crop.png', cvOn, cx, cy, cw, ch, 3);
console.log(`\n道具数：${placed.length}（真机口径一屏≈${(placed.length / screens).toFixed(2)}）`);
