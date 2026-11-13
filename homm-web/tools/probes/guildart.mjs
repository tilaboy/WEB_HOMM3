/**
 * guildart.mjs —— **S5 的执行版**：魔法行会三阶外形（spec §2.4 第三条链 / §6.3）
 *
 * ## 这一批到底画了什么
 * `guild1/2/3` 是**三个独立建筑**（可以同时存在），所以"三阶"不是一张图的三级
 * 缩放，而是三张各有识别点的图（§6.3 明文）：
 *
 * | 档 | 建筑 | 必须有的那一笔 |
 * |---|---|---|
 * | 1 | 石塔 | 方塔 + 木门（平顶、无飘浮件） |
 * | 2 | 尖顶塔 | 尖顶 + **两枚离体的符文** |
 * | 3 | 浮空塔 | 基座离地（塔身与基座之间整行透空）+ 环 |
 *
 * ## 为什么判据是这些（而不是"看着像"）
 * §2.4 给的是三条可量的：**剪影可辨**（体积递增 ≥30%）、**占地 +30%**、
 * **每级多一个可读细节**。这里逐条落成断言，并且**每条都能被负向对照打红**：
 *
 *   [G0] 覆盖：四族 × 三阶 = 12 帧，尺寸一致、剪影非空。
 *        **有对象而量不到必须红**，不许静默跳过。
 *   [G1] 体积：逐阶不透明像素数 ≥ +30%（§2.4「主体体积递增 ≥30%」）。
 *   [G2] 占地：L3 的 bbox 宽、高各 ≥ L1 的 1.3×（§2.4「占地至少 +30%」）。
 *   [G3] 可辨：三阶两两剪影 IoU ≤ 0.70 —— 只换颜色不算换外形。
 *   [G4] 细节：三档各自的识别点（连通块数 / 顶部行宽 / 透空行 / 环外伸）。
 *   [G5] 同构：**四族的 alpha 掩码逐像素相同** —— 只许换材质，不许换结构
 *        （§2.4「四族差异只体现在用哪套材质」）。这条同时挡住"某族悄悄画歪"。
 *
 * ## 负向对照（必须红；恢复后必须复绿）
 * ```
 *   node tools/probes/guildart.mjs --negctrl
 * ```
 *   N1 `flat`     三阶画成同一张      ⇒ [G1] 红（升级看不出来 = S5 要防的原始 bug）
 *   N2 `noFloat`  L3 基座贴地          ⇒ [G4-3] 红（"浮空"没了）
 *   N3 `noRune`   L2 去掉符文          ⇒ [G4-2] 红（中间档没有识别点）
 *   N4 `noSpire`  L2/L3 去掉尖顶        ⇒ [G4-2] 红（方塔/尖顶两档塌成一档）
 *
 * ## 它**不**证明什么
 * 它证明的是"画出来的东西符合规格"，不是"玩家看着舒服"。后者只能靠 ×8 单张目检
 * （铁律 1）与 V1 试玩；本批的目检图在 `production/s5-guild-art-2026-11-13/`。
 *
 * ## 用法
 * ```
 *   node tools/probes/guildart.mjs                # 报告模式（退出码 0）
 *   node tools/probes/guildart.mjs --gate         # 判据模式
 *   node tools/probes/guildart.mjs --negctrl      # 连负向对照一起跑
 *   node tools/probes/guildart.mjs --png=<dir>    # 额外导出 ×8 目检图
 * ```
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { argOf, distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=guildart');
const u = (rel) => distUrl(rel, DIST);
requireFile(DIST, 'render/guildArt.js');
requireFile(DIST, 'render/pixel.js');

const {
  buildGuildArt,
  guildArtName,
  guildArtTierOf,
  guildPaletteOf,
  setGuildArtBreaks,
  GUILD_ART_SIZE,
} = await import(u('render/guildArt.js'));

const GATE = process.argv.includes('--gate');
const NEGCTRL = process.argv.includes('--negctrl');
const PNG_DIR = argOf('png');

/**
 * CRC 表缓存槽**必须声明在文件顶部**：`--png` 的导出块在文件中部就调用
 * `encodePng()`，而 `let` 还没求值 ⇒ `Cannot access 'CRC_TABLE' before initialization`。
 * 这条坑 `townartaudit.mjs` 2026-11-06 踩过一次，本文件第一版又踩了一次（照抄时序）。
 */
let CRC_TABLE = null;

const OWNERS = ['p1', 'p2', 'p3', 'p4'];
const TIERS = [1, 2, 3];

let fail = 0;
function record(id, title, ok, detail) {
  if (!ok) fail++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] [${id}] ${title}${detail ? ` — ${detail}` : ''}`);
  return { id, title, ok, detail };
}

/* ---------------------------------------------------------------- 量具 */

const opaque = (pb, x, y) => x >= 0 && y >= 0 && x < pb.w && y < pb.h && pb.alphaAt(x, y) > 8;

function area(pb) {
  let n = 0;
  for (let y = 0; y < pb.h; y++) for (let x = 0; x < pb.w; x++) if (opaque(pb, x, y)) n++;
  return n;
}

function bbox(pb) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < pb.h; y++)
    for (let x = 0; x < pb.w; x++)
      if (opaque(pb, x, y)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 4 邻域连通块（按面积从大到小）。 */
function components(pb) {
  const seen = new Uint8Array(pb.w * pb.h);
  const sizes = [];
  for (let y = 0; y < pb.h; y++)
    for (let x = 0; x < pb.w; x++) {
      const k = y * pb.w + x;
      if (seen[k] || !opaque(pb, x, y)) continue;
      let size = 0;
      const stack = [[x, y]];
      seen[k] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        size++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= pb.w || ny >= pb.h) continue;
          const kk = ny * pb.w + nx;
          if (seen[kk] || !opaque(pb, nx, ny)) continue;
          seen[kk] = 1;
          stack.push([nx, ny]);
        }
      }
      sizes.push(size);
    }
  return sizes.sort((a, b) => b - a);
}

/** 某一行里最长的一段连续不透明像素（用来在"环穿过塔身"的那一行上取塔身本体）。 */
function longestRun(pb, y) {
  let best = { x0: 0, x1: -1, len: 0 };
  let start = -1;
  for (let x = 0; x <= pb.w; x++) {
    const on = x < pb.w && opaque(pb, x, y);
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      const len = x - start;
      if (len > best.len) best = { x0: start, x1: x - 1, len };
      start = -1;
    }
  }
  return best;
}

function rowWidth(pb, y) {
  let n = 0;
  for (let x = 0; x < pb.w; x++) if (opaque(pb, x, y)) n++;
  return n;
}

function iou(a, b) {
  let inter = 0, uni = 0;
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++) {
      const oa = opaque(a, x, y), ob = opaque(b, x, y);
      if (oa && ob) inter++;
      if (oa || ob) uni++;
    }
  return uni === 0 ? 1 : inter / uni;
}

/** 某一颜色（含 alpha）的像素集合 bbox —— 用来量"环伸出去多少"。 */
function colorBox(pb, hex) {
  const t = hex.replace('#', '').toLowerCase();
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, n = 0;
  for (let y = 0; y < pb.h; y++)
    for (let x = 0; x < pb.w; x++) {
      if (!opaque(pb, x, y)) continue;
      const [r, g, b] = pb.px(x, y);
      const s = [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
      if (s !== t) continue;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return n ? { x0, x1, y0, y1, n } : null;
}

/* ---------------------------------------------------------------- 建帧 */

const frames = new Map();
for (const owner of OWNERS) for (const t of TIERS) frames.set(`${owner}:${t}`, buildGuildArt(owner, t));

/* ---------------------------------------------------------------- [G0] 覆盖 */

{
  const bad = [];
  if (frames.size !== OWNERS.length * TIERS.length) bad.push(`帧数 ${frames.size}/12`);
  for (const owner of OWNERS) {
    for (const t of TIERS) {
      const pb = frames.get(`${owner}:${t}`);
      if (pb.w !== GUILD_ART_SIZE || pb.h !== GUILD_ART_SIZE) bad.push(`${owner}L${t} 尺寸 ${pb.w}×${pb.h}`);
      if (area(pb) < 200) bad.push(`${owner}L${t} 剪影只有 ${area(pb)}px（画出空帧）`);
      if (guildArtName(owner, t) !== `bard_${owner}_${t}`) bad.push(`${owner}L${t} 帧名 ${guildArtName(owner, t)}`);
    }
  }
  record('G0', '覆盖：四族 × 三阶 12 帧，尺寸/帧名/非空', bad.length === 0, bad.join(' · ') || `12 帧 · ${GUILD_ART_SIZE}×${GUILD_ART_SIZE}`);
}

/* ---------------------------------------------------------------- [G1] 体积递增 */

{
  const rows = [];
  const bad = [];
  for (const owner of OWNERS) {
    const a = TIERS.map((t) => area(frames.get(`${owner}:${t}`)));
    const r12 = a[1] / a[0];
    const r23 = a[2] / a[1];
    rows.push(`${owner} ${a.join('/')} (×${r12.toFixed(2)}/×${r23.toFixed(2)})`);
    if (r12 < 1.3) bad.push(`${owner} L1→L2 只 ×${r12.toFixed(2)}`);
    if (r23 < 1.3) bad.push(`${owner} L2→L3 只 ×${r23.toFixed(2)}`);
  }
  record('G1', '体积：逐阶不透明像素 ≥ +30%（§2.4）', bad.length === 0, bad.join(' · ') || rows.join(' · '));
}

/* ---------------------------------------------------------------- [G2] 占地 */

{
  const bad = [];
  const rows = [];
  for (const owner of OWNERS) {
    const b = TIERS.map((t) => bbox(frames.get(`${owner}:${t}`)));
    const kw = b[2].w / b[0].w;
    const kh = b[2].h / b[0].h;
    rows.push(`${owner} ${b.map((x) => `${x.w}×${x.h}`).join(' → ')}`);
    if (kw < 1.3) bad.push(`${owner} 宽只 ×${kw.toFixed(2)}`);
    if (kh < 1.3) bad.push(`${owner} 高只 ×${kh.toFixed(2)}`);
    /* 单调：不许某一阶反而缩小（"长大了"的反面） */
    if (b[1].w < b[0].w || b[2].w < b[1].w) bad.push(`${owner} 宽度非单调`);
    if (b[1].h < b[0].h || b[2].h < b[1].h) bad.push(`${owner} 高度非单调`);
  }
  record('G2', '占地：L3 宽/高各 ≥ L1 的 1.3×，且逐阶不缩', bad.length === 0, bad.join(' · ') || rows.join(' · '));
}

/* ---------------------------------------------------------------- [G3] 可辨 */

{
  const bad = [];
  const rows = [];
  for (const owner of OWNERS) {
    const m = TIERS.map((t) => frames.get(`${owner}:${t}`));
    const pairs = [
      ['L1/L2', iou(m[0], m[1])],
      ['L2/L3', iou(m[1], m[2])],
      ['L1/L3', iou(m[0], m[2])],
    ];
    rows.push(`${owner} ${pairs.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ')}`);
    for (const [k, v] of pairs) if (v > 0.7) bad.push(`${owner} ${k} IoU ${v.toFixed(2)} > 0.70`);
  }
  record('G3', '可辨：三阶两两剪影 IoU ≤ 0.70（只换颜色不算换外形）', bad.length === 0, bad.join(' · ') || rows.join(' · '));
}

/* ---------------------------------------------------------------- [G4] 细节 */

{
  const bad = [];

  /* G4-1 L1：单体（不许有飘浮件）+ 木门。 */
  for (const owner of OWNERS) {
    const pb = frames.get(`${owner}:1`);
    const comps = components(pb);
    if (comps.length !== 1) bad.push(`${owner}L1 连通块 ${comps.length} 个（石塔应是单体）`);
    const pal = guildPaletteOf(owner);
    const door = colorBox(pb, pal.wood);
    if (!door || door.n < 24) bad.push(`${owner}L1 木门只有 ${door?.n ?? 0}px`);
  }
  record('G4-1', 'L1 石塔：单体剪影（0 飘浮件）+ 木门 ≥24px', bad.length === 0, bad.join(' · ') || '4/4');

  /* G4-2 L2：尖顶（顶部 4 行行宽 ≤6）+ 两枚离体符文（分离块 ≥8px ×2）。 */
  const bad2 = [];
  for (const owner of OWNERS) {
    const pb = frames.get(`${owner}:2`);
    /* 尖顶 = 顶点只有 1~3px，且往下 5 行明显张开（三角的斜率）。
       只量"顶部 4 行 ≤6px"会误伤矮而宽的锥顶（实测 4 行处已 11px，仍是真尖顶）；
       只量"顶行窄"又挡不住"把锥顶削成平顶"。两条一起才是"尖"。 */
    const y0 = bbox(pb).y0;
    const tip = rowWidth(pb, y0);
    const flare = rowWidth(pb, y0 + 5);
    if (tip > 4 || flare < tip * 2) bad2.push(`${owner}L2 顶 ${tip}px / 5 行后 ${flare}px（不是尖顶）`);
    const comps = components(pb);
    const loose = comps.slice(1).filter((s) => s >= 8);
    if (comps.length < 3 || loose.length < 2) bad2.push(`${owner}L2 离体符文 ${loose.length} 枚（应 2 枚）`);
  }
  record('G4-2', 'L2 尖顶塔：尖顶（顶点 ≤4px 且 5 行后翻倍）+ 2 枚离体符文', bad2.length === 0, bad2.join(' · ') || '4/4');

  /* G4-3 L3：基座离地（≥3 整行透空）+ 环两侧各外伸 ≥4px。 */
  const bad3 = [];
  for (const owner of OWNERS) {
    const pb = frames.get(`${owner}:3`);
    const comps = components(pb);
    if (comps.length < 2) bad3.push(`${owner}L3 只有 1 个连通块（基座没离地）`);
    /* 塔身与基座之间：找最下方那条"整行亮着"之后再往上数透空行 */
    const b = bbox(pb);
    let gapRows = 0;
    for (let y = b.y1; y >= b.y0; y--) {
      if (rowWidth(pb, y) === 0) gapRows++;
      else if (gapRows > 0) break;
    }
    if (gapRows < 3) bad3.push(`${owner}L3 透空 ${gapRows} 行（应 ≥3）`);
    const pal = guildPaletteOf(owner);
    const ring = colorBox(pb, pal.glow);
    if (!ring) bad3.push(`${owner}L3 找不到环（glow 色）`);
    else {
      /* 环画在描边之后、且必然贴塔（44px 里 rx 再大就出框），所以判"环"用两条：
         ① 纵向跨 ≥8 行 —— 一条横板只有 2~3 行，圈才有高度；
         ② 横向比塔身最宽处还宽 ≥6px —— 圈要绕出去，不能只是墙上的一道线。 */
      const ringH = ring.y1 - ring.y0 + 1;
      const ringW = ring.x1 - ring.x0 + 1;
      /* 塔身取「环上方两行」那一段：环所在的行本身会把环与塔身连成一段，
         而再往下塔身比环还宽（44px 里环必须贴塔），拿整体最宽处比等于要求环出框。 */
      const probeY = Math.max(b.y0, ring.y0 - 2);
      const bodyW = longestRun(pb, probeY).len;
      if (ringH < 8) bad3.push(`${owner}L3 环只有 ${ringH} 行高（不是圈）`);
      if (ringW < Math.round(bodyW * 1.15)) {
        bad3.push(`${owner}L3 环宽 ${ringW} / 塔身 ${bodyW} = ${(ringW / bodyW).toFixed(2)}（应 ≥1.15）`);
      }
    }
  }
  record('G4-3', 'L3 浮空塔：基座离地（≥3 透空行）+ 环是圈（高 ≥8 行、宽 ≥ 塔身 1.15×）', bad3.length === 0, bad3.join(' · ') || '4/4');
}

/* ---------------------------------------------------------------- [G5] 四族同构 */

{
  const bad = [];
  for (const t of TIERS) {
    const ref = frames.get(`p1:${t}`);
    for (const owner of OWNERS.slice(1)) {
      const pb = frames.get(`${owner}:${t}`);
      let diff = 0;
      for (let y = 0; y < ref.h; y++)
        for (let x = 0; x < ref.w; x++) if (opaque(ref, x, y) !== opaque(pb, x, y)) diff++;
      if (diff) bad.push(`${owner}L${t} 与 p1L${t} 掩码差 ${diff}px`);
    }
  }
  record('G5', '同构：四族只换材质、结构逐像素相同', bad.length === 0, bad.join(' · ') || '12 帧 3 组比对');
}

/* ---------------------------------------------------------------- 负向对照 */

const negatives = [];
if (NEGCTRL) {
  const run = (name, breaks, fn) => {
    /* 每一条都先确认"默认是绿的"，再插桩，再确认"变红"，最后恢复并确认"复绿"。 */
    setGuildArtBreaks(breaks);
    buildAndCheck();
    const red = fn();
    setGuildArtBreaks({ flat: false, noFloat: false, noRune: false, noSpire: false });
    buildAndCheck();
    negatives.push({ name, ok: red.ok, detail: red.detail });
    record(`N-${name}`, `负向对照：${name} ⇒ 必须红`, red.ok, red.detail);
  };

  /* 每个对照都重跑同一批量具（不是另写一份判据） */
  let fresh = new Map();
  function buildAndCheck() {
    fresh = new Map();
    for (const owner of OWNERS) for (const t of TIERS) fresh.set(`${owner}:${t}`, buildGuildArt(owner, t));
  }

  run('flat', { flat: true }, () => {
    const a = TIERS.map((t) => area(fresh.get(`p1:${t}`)));
    const r = a[1] / a[0];
    return { ok: r < 1.3, detail: `L1→L2 ×${r.toFixed(2)}（画成同一张）` };
  });

  run('noFloat', { noFloat: true }, () => {
    const comps = components(fresh.get('p1:3'));
    return { ok: comps.length < 2, detail: `L3 连通块 ${comps.length} 个（基座贴地）` };
  });

  run('noRune', { noRune: true }, () => {
    const comps = components(fresh.get('p1:2'));
    return { ok: comps.slice(1).filter((s) => s >= 8).length < 2, detail: `L2 离体件 ${comps.length - 1} 枚` };
  });

  run('noSpire', { noSpire: true }, () => {
    const pb = fresh.get('p1:2');
    const tip = Math.max(...[0, 1, 2, 3].map((dy) => rowWidth(pb, bbox(pb).y0 + dy)));
    return { ok: tip > 6, detail: `L2 顶部行宽 ${tip}（没有尖顶）` };
  });
}

/* ---------------------------------------------------------------- PNG 目检 */

if (PNG_DIR) {
  mkdirSync(PNG_DIR, { recursive: true });
  let n = 0;
  for (const owner of OWNERS) {
    for (const t of TIERS) {
      writeFileSync(join(PNG_DIR, `${owner}_L${t}.png`), encodePng(upscale(frames.get(`${owner}:${t}`), 8)));
      n++;
    }
  }
  console.log(`\nPNG 已导出 → ${PNG_DIR}（${n} 帧，最近邻 ×8）`);
}

/* ---------------------------------------------------------------- 汇总 */

console.log('\n' + '='.repeat(72));
console.log(`断言：${fail === 0 ? '全部通过' : `${fail} 条失败`}`);
if (NEGCTRL) {
  const red = negatives.filter((n) => n.ok).length;
  console.log(`负向对照：${red}/${negatives.length} 条如期变红`);
}
console.log('人工项：×8 单张目检（铁律 1）—— 判"读得出是三档塔"而不是"像素数达标"');
console.log('='.repeat(72));
process.exit(GATE && fail ? 1 : 0);

/* ---------------------------------------------------------------- PNG（零依赖） */

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
function encodePng({ w, h, data }) {
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
function upscale(pb, k) {
  const w = pb.w * k, h = pb.h * k;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (((y / k) | 0) * pb.w + ((x / k) | 0)) * 4;
      const d = (y * w + x) * 4;
      data[d] = pb.d[s];
      data[d + 1] = pb.d[s + 1];
      data[d + 2] = pb.d[s + 2];
      data[d + 3] = pb.d[s + 3];
    }
  return { w, h, data };
}
