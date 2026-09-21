#!/usr/bin/env node
/**
 * artshot.mjs —— 用**运行期的真实渲染代码**在 node 里渲出地图，产出改前/改后截图。
 *
 * 为什么能跑真实代码：`tools/_canvas.mjs` 提供了一个最小但**真实现**的 Canvas2D 垫片
 * （最近邻 blit / 实色填充 / alpha 合成）。于是 `TerrainLayer.bake()`、
 * `SetDressingLayer.bake()`、图集构建**一行不改**就能跑出像素。
 *
 * 诚实边界（必须在报告里照说）：
 * 本仓**有** headless 浏览器（Chrome + `tools/serve.mjs`）⇒「做不到浏览器合成对照」是**假的**。
 * 本轮**选择**用自建 Canvas2D 垫片（理由：快、零依赖、最近邻语义与原实现对齐）——
 * 是「**本轮没做**」，**不是「做不到」**（这两句话的区别，正是本项目今天反复治的那个病）。
 * 因此本工具能证明「地形烘焙的输出差在哪」，但**未做**「垫片合成语义 vs 真实 Chrome
 * Canvas2D 是否逐像素一致」这一层对照。真机层（DPR / 安全区 / 合成算子）另有现成通道：
 * `tools/devprobe.mjs` + `tools/probes/*` + `tools/phone-tunnel.sh`（设备离线时做不了，
 * 但那是「设备不在」，不是「没有通道」）。
 *
 * 用法：node tools/artshot.mjs [输出目录]
 */
import { installShim } from './_canvas.mjs';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

installShim();

const { getAtlas } = await import('../dist/render/atlas.js');
const { TerrainLayer } = await import('../dist/render/terrainLayer.js');
const { SetDressingLayer } = await import('../dist/render/setDressing.js');
const { quality } = await import('../dist/render/quality.js');
const { lightTintAt } = await import('../dist/render/lightLayer.js');

const TILE = 32;
const OUT = process.argv[2] ?? '../design/art-bible/shots';
const ZOOM = 2;

/* ---------------------------------------------------------------- PNG（零依赖，与 b0audit 同法） */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
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
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[o++] = rgba[i]; raw[o++] = rgba[i + 1]; raw[o++] = rgba[i + 2]; raw[o++] = rgba[i + 3];
    }
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

/* ---------------------------------------------------------------- 合成一个"代表性屏幕" */
const W = 26, H = 16;

function buildMap() {
  const tiles = [];
  const put = (x, y, terrain, objectId = null) => { tiles[y * W + x] = { terrain, objectId }; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let t = 'grass';
    // 雪原：左上
    if (x < 5 && y < 4) t = 'snow';
    // 岩地：左下角
    if (x < 4 && y > 11) t = 'rock';
    // 土路：一条横贯的路
    if (y === 8 && x > 3 && x < 22) t = 'dirt';
    // 湖：中右
    const dx = x - 18, dy = y - 5;
    if (dx * dx + dy * dy * 1.6 < 12) t = 'water';
    else if (dx * dx + dy * dy * 1.6 < 22) t = 'sand';
    // 沼泽：右下
    if (x > 20 && y > 11) t = 'swamp';
    put(x, y, t);
  }
  // 物件：一片森林 + 几处地标。用**真实 GameMap 形状**（objects 是 Record、带 kind），
  // 这样布景层的「语义锚点」才会真的生效（它读 map.objects[].kind）。
  const objects = {};
  const sprites = [];
  const add = (sprite, x, y, kind) => {
    const id = `o${sprites.length}`;
    objects[id] = { id, kind, pos: { x, y }, payload: null, once: false, blocking: true, visitedBy: [] };
    tiles[y * W + x].objectId = id;
    sprites.push({ sprite, x, y });
  };
  for (const [x, y] of [[2, 6], [3, 7], [2, 9], [5, 6], [6, 9], [5, 10], [9, 3], [10, 4], [9, 5]])
    add(sprites.length % 2 ? 'tree1' : 'tree0', x, y, 'obstacle');
  add('mtn0', 4, 12, 'obstacle');
  add('rock0', 8, 13, 'obstacle');
  add('res_gold', 12, 11, 'resourcePile');
  add('chest', 15, 3, 'treasureChest');
  add('fountain', 22, 12, 'fountain');
  // 2×2 城堡：占 (20..21, 6..7)，footprint = 4 格、pos = 城门
  const cid = `o${sprites.length}`;
  objects[cid] = {
    id: cid, kind: 'town', pos: { x: 20, y: 6 },
    footprint: [{ x: 20, y: 6 }, { x: 21, y: 6 }, { x: 20, y: 7 }, { x: 21, y: 7 }],
    payload: null, once: false, blocking: true, visitedBy: [],
  };
  tiles[6 * W + 20].objectId = cid; tiles[6 * W + 21].objectId = cid;
  tiles[7 * W + 20].objectId = cid; tiles[7 * W + 21].objectId = cid;
  sprites.push({ sprite: 'castle_p1_0', x: 20, y: 6 });
  add('town_p2_1', 12, 13, 'town');
  // 英雄不属于 MapObject（在 GameState.heroes），只进渲染列表
  sprites.push({ sprite: 'hero_p1', x: 7, y: 8 });
  return { map: { width: W, height: H, tiles, objects }, sprites };
}

function drawWater(ctx, map, atlas) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (map.tiles[y * W + x].terrain !== 'water') continue;
    const v = (x * 31 + y * 17) % 2;
    const f = atlas.get(`g_water_${v}_0`);
    if (f) ctx.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, x * TILE + f.ax, y * TILE + f.ay, f.w, f.h);
  }
}

const atlas = getAtlas();

function render({ macroShade, setDressing, nightTint }) {
  const { map, sprites } = buildMap();
  const terrain = new TerrainLayer();
  terrain.macroShade = macroShade;
  quality.setDressing = setDressing;
  const dressing = new SetDressingLayer();

  const cv = document.createElement('canvas');
  cv.width = W * TILE;
  cv.height = H * TILE;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, cv.width, cv.height);

  // ① 地形（真实 bake）
  ctx.drawImage(terrain.ensure(map), 0, 0);
  // ② 布景层（§6.1.3：地形之后、水面之前）
  if (setDressing !== 'off') ctx.drawImage(dressing.ensure(map), 0, 0);
  // ③ 水面
  ctx.save();
  ctx.globalAlpha = 1;
  drawWater(ctx, map, atlas);
  ctx.restore();
  // ④ 物件（按 y 排序，锚点取图集帧自带的 ax/ay）
  const sorted = [...sprites].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const o of sorted) {
    const f = atlas.get(o.sprite);
    if (f) ctx.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, o.x * TILE + f.ax, o.y * TILE + f.ay, f.w, f.h);
  }
  // ⑤ 光照（multiply 叠色）
  if (nightTint) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${nightTint.r},${nightTint.g},${nightTint.b})`;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.restore();
  }
  return cv;
}

function save(name, canvas) {
  const up = upscale(canvas.buf, canvas.width, canvas.height, ZOOM);
  const png = encodePng(canvas.width * ZOOM, canvas.height * ZOOM, up);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), png);
  console.log(`  → ${join(OUT, name)}  (${(png.length / 1024).toFixed(0)} KB)`);
  return png;
}

/* ---------------------------------------------------------------- 出图 */
const OLD_NIGHT = { r: 148, g: 164, b: 208 }; // §2.3 L1/L2 之前的夜值（改前）
const NEW_NIGHT = lightTintAt(0.68);          // 现行 lightLayer 的夜值（改后）

console.log('渲染改前/改后（同一份代码 + 同一张图集；最近邻 ×2）…');

// 每行只差**一个变量**，避免"算式 vs 实测"式的混淆。
console.log('\n[A] 地貌层（只差 macroShade：关 / 开）');
save('a_shade_off.png', render({ macroShade: false, setDressing: 'off', nightTint: null }));
save('a_shade_on.png', render({ macroShade: true, setDressing: 'off', nightTint: null }));

console.log('\n[B] 喜剧布景层（只差 setDressing：off / static；地貌层两图都开）');
save('b_dress_off.png', render({ macroShade: true, setDressing: 'off', nightTint: null }));
save('b_dress_on.png', render({ macroShade: true, setDressing: 'static', nightTint: null }));

console.log('\n[C] 夜晚光照 §2.3 L1/L2（同一几何 = 全开，只换夜值）');
save('c_night_before.png', render({ macroShade: true, setDressing: 'static', nightTint: OLD_NIGHT }));
save('c_night_after.png', render({ macroShade: true, setDressing: 'static', nightTint: NEW_NIGHT }));
console.log(`  夜值 改前 rgb(${OLD_NIGHT.r},${OLD_NIGHT.g},${OLD_NIGHT.b}) → 改后 rgb(${NEW_NIGHT.r},${NEW_NIGHT.g},${NEW_NIGHT.b})`);

/* ---------------------------------------------------------------- 地貌层的客观量（"玩家能感觉到吗"的可核数字） */
/* 必须在一张**单一地形**的图上量：混地形的 L* 极差被"雪原 vs 沼泽"的固有色差主导，
   量不到地貌层本身。故这里另建一张全草地图，只差 macroShade 一个变量。 */
function uniformGrassMap() {
  const tiles = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tiles[y * W + x] = { terrain: 'grass', objectId: null };
  return { width: W, height: H, tiles, objects: [] };
}
function tileMeanLSpread(cv) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = (r, g, b) => 116 * Math.cbrt(0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)) - 16;
  const means = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
      const k = ((y * TILE + j) * W * TILE + (x * TILE + i)) * 4;
      s += L(cv.buf[k], cv.buf[k + 1], cv.buf[k + 2]); n++;
    }
    means.push(s / n);
  }
  return Math.max(...means) - Math.min(...means);
}
function uniformSpread(macroShade) {
  const map = uniformGrassMap();
  const t = new TerrainLayer();
  t.macroShade = macroShade;
  const cv = document.createElement('canvas');
  cv.width = W * TILE; cv.height = H * TILE;
  cv.getContext('2d').drawImage(t.ensure(map), 0, 0);
  return tileMeanLSpread(cv);
}
const sOff = uniformSpread(false), sOn = uniformSpread(true);
const metric = `同一张全草地图上，逐格平均 L* 极差 <b>${sOff.toFixed(1)} → ${sOn.toFixed(1)}</b>（改前几乎为 0 ＝壁纸感）`;

/* ---------------------------------------------------------------- 对照页 */
const en = (p) => 'data:image/png;base64,' + readFileSync(join(OUT, p)).toString('base64');
const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<title>地图层画面提升 · 改前/改后</title><style>
:root{--bg:#14110e;--panel:#1e1a16;--line:#3a322a;--fg:#eae0d0;--dim:#a2937f;--ok:#5bbf7a;--warn:#d9a441}
*{box-sizing:border-box}body{margin:0;padding:26px 20px 60px;background:var(--bg);color:var(--fg);
font:14px/1.65 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif}
h1{font-size:20px;margin:0 0 6px}h2{font-size:16px;margin:30px 0 6px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.sub{color:var(--dim);font-size:13px;margin:0 0 14px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.fig{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px}
.fig img{width:100%;display:block;image-rendering:pixelated;border-radius:4px}
.cap{font-size:12px;color:var(--dim);margin-bottom:6px}.cap.ok{color:var(--ok)}
.note{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:12px 0}
.note b{color:var(--warn)}
</style></head><body>
<h1>地图层画面提升 · 改前 / 改后</h1>
<p class="sub">零位图、程序化像素画；TILE=32 与画家算法未动。由 <code>tools/artshot.mjs</code> 用运行期真实渲染代码 headless 合成（最近邻 ×2）。</p>
<div class="note"><b>图从哪来（边界说清）</b>：同一份代码 + 同一张图集，但用<b>自建 Canvas2D 垫片</b>在 node 里合成 —— <b>不是浏览器渲染、也不是真机截图</b>。本仓 <b>有</b> headless Chrome（+ <code>tools/serve.mjs</code>）⇒ 可做浏览器合成对照，但<b>本轮没做</b>（选择：快、零依赖），<b>不是做不到</b>。<br>所以它回答"地形烘焙的输出差在哪"，<b>未答</b>"垫片合成语义 vs 真实 Chrome Canvas2D 是否逐像素一致"（这一层建议由共享通道 <code>chromeshot</code> 补）。<br>每行<b>只差一个变量</b>，便于归因。</div>

<h2>A · 地形「地貌层」（只差 macroShade）</h2>
<p class="sub">左＝关（地形逐格同型砖重复＝壁纸感）；右＝开（地图尺度方向光＋低频地貌起伏＋亮暖暗冷）。客观量 —— ${metric}。</p>
<div class="pair">
  <div class="fig"><div class="cap">改前（无地貌层）</div><img src="${en('a_shade_off.png')}"></div>
  <div class="fig"><div class="cap ok">改后（有地貌层）</div><img src="${en('a_shade_on.png')}"></div>
</div>

<h2>B · 喜剧布景层（只差 setDressing · A 组地面涂鸦最小切片）</h2>
<p class="sub">左＝off；右＝static。新增 5 型 <code>sd_g_*</code>：跳房子格 · 干草屑 · 落地头盔 · 酒渍碎陶 · 画错的藏宝图。全部程序化、零位图、零游戏语义（不入存档、不挡路）。</p>
<div class="pair">
  <div class="fig"><div class="cap">改前（无布景）</div><img src="${en('b_dress_off.png')}"></div>
  <div class="fig"><div class="cap ok">改后（有布景）</div><img src="${en('b_dress_on.png')}"></div>
</div>

<h2>C · 夜晚光照（§2.3 L1/L2）</h2>
<p class="sub">同一几何（皆全开），只换夜值：左＝旧 rgb(148,164,208)（floor 0.58、偏蓝）；右＝新 rgb(${NEW_NIGHT.r},${NEW_NIGHT.g},${NEW_NIGHT.b})（floor 0.70、去偏蓝）。</p>
<div class="pair">
  <div class="fig"><div class="cap">改前 夜值</div><img src="${en('c_night_before.png')}"></div>
  <div class="fig"><div class="cap ok">改后 夜值</div><img src="${en('c_night_after.png')}"></div>
</div>
</body></html>`;
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'index.html'), html);
console.log(`\n对照页 → ${join(OUT, 'index.html')}`);
console.log(`客观量：逐格平均 L* 极差 ${sOff.toFixed(1)} → ${sOn.toFixed(1)}`);
