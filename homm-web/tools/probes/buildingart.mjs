/**
 * 城镇建筑外观闸门（M5 · B1）—— 13 座 × 4 族 = 52 帧 + 行会 3 座 × 4 族 = 12 帧（归 S5）。
 *
 * 判据分五层，每层量的都是"会不会认错"，不是"像素够不够多"：
 *   [B0] 覆盖：13 × 4 = 52 帧、44×44、帧名 `bld_<owner>_<id>`、无空帧
 *   [B1] 四族**结构相同**：同一座建筑的 alpha 掩码逐像素相同（差异只在调色板）
 *   [B2] 四族**材质不同**：同 id 跨族的不透明像素平均色三次以上两两分开
 *   [B3] 没有两张一样的图：13 座两两 IoU 上限 / 均值
 *   [B4] **每座一根能被量出来的识别件**（13 条，逐条给读数）
 *
 * ⚠️ [B3] 的阈值**不是** S5 的 0.70。S5 量的是同一座塔的三阶（必须一眼看出"升级了"）；
 * 这里是 13 座不同建筑，剪影天然共享"房子"这个信封 —— 实测最大 0.855（木栅/马厩，
 * 一个是八根竖桩、一个是实心谷仓，人眼不会混）。0.90 只用来抓"两张图一样"，
 * 认不认得出由 [B4] 与人眼 ×8 负责（铁律 1）。
 *
 * 用法：
 * ```
 *   node tools/probes/buildingart.mjs              # 报告
 *   node tools/probes/buildingart.mjs --gate       # 判据（失败 rc=1）
 *   node tools/probes/buildingart.mjs --negctrl    # 连负向对照
 *   node tools/probes/buildingart.mjs --png=<dir>  # 导出 ×8 目检图（14 帧/族）
 *   node tools/probes/buildingart.mjs --marks      # 逐座识别件读数（doc §3 那张表）
 *   node tools/probes/buildingart.mjs --tiers      # 兵营线逐座面积 / 档间 IoU（B2）
 *   node tools/probes/buildingart.mjs --sheet=<dir> # 两张对照表（sheet-p1 / sheet-factions）
 * ```
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argOf, distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';
import { encodePng, montage, upscale } from '../_png.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=buildingart');
const u = (rel) => distUrl(rel, DIST);
requireFile(DIST, 'render/buildingArt.js');
requireFile(DIST, 'render/guildArt.js');
requireFile(DIST, 'render/pixel.js');

const {
  BUILDING_ART_IDS,
  BUILDING_ART_SIZE,
  DWELLING_TIER_IDS,
  MAX_BUILDING_TIER,
  buildBuildingArt,
  buildingArtName,
  getBuildingArtBreaks,
  setBuildingArtBreaks,
} = await import(u('render/buildingArt.js'));
const { guildPaletteOf } = await import(u('render/guildArt.js'));

const GATE = process.argv.includes('--gate');
const NEGCTRL = process.argv.includes('--negctrl');
const TIERS_TABLE = process.argv.includes('--tiers');
const PNG_DIR = argOf('png');
const SHEET_DIR = argOf('sheet');

const OWNERS = ['p1', 'p2', 'p3', 'p4'];
const IDS = [...BUILDING_ART_IDS];
const PAL = guildPaletteOf('p1');

let fail = 0;
function record(id, title, ok, detail) {
  if (!ok) fail++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] [${id}] ${title}${detail ? ` — ${detail}` : ''}`);
  return { id, title, ok, detail };
}

/* ---------------------------------------------------------------- 量具 */

const opaque = (pb, x, y) => pb.alphaAt(x, y) > 8;

function area(pb) {
  let n = 0;
  for (let y = 0; y < pb.h; y++) for (let x = 0; x < pb.w; x++) if (opaque(pb, x, y)) n++;
  return n;
}

function bbox(pb) {
  let x0 = pb.w;
  let y0 = pb.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < pb.h; y++) {
    for (let x = 0; x < pb.w; x++) {
      if (!opaque(pb, x, y)) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const maskOf = (pb) => {
  const m = new Uint8Array(pb.w * pb.h);
  for (let y = 0; y < pb.h; y++) for (let x = 0; x < pb.w; x++) m[y * pb.w + x] = opaque(pb, x, y) ? 1 : 0;
  return m;
};

function maskDiff(a, b) {
  const ma = maskOf(a);
  const mb = maskOf(b);
  let n = 0;
  for (let i = 0; i < ma.length; i++) if (ma[i] !== mb[i]) n++;
  return n;
}

function iou(a, b) {
  const ma = maskOf(a);
  const mb = maskOf(b);
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < ma.length; i++) {
    if (ma[i] || mb[i]) uni++;
    if (ma[i] && mb[i]) inter++;
  }
  return uni ? inter / uni : 1;
}

/** 某一行上"不透明段"的数量（**必须传未描边的帧**：1px 的缝会被墨环填成实心）。 */
function spansAt(pb, y) {
  let n = 0;
  let prev = false;
  for (let x = 0; x < pb.w; x++) {
    const on = opaque(pb, x, y);
    if (on && !prev) n++;
    prev = on;
  }
  return n;
}

/** 同 `spansAt`，但只数 `x0..x1` 这一段 —— 圣殿两侧加了塔门之后，
 *  整行会多出两段（塔），柱廊本身必须**单独量**。 */
function spansBetween(pb, y, x0, x1) {
  let n = 0;
  let prev = false;
  for (let x = x0; x <= x1; x++) {
    const on = opaque(pb, x, y);
    if (on && !prev) n++;
    prev = on;
  }
  return n;
}

/** 44 → 28 最近邻降采：DPR1 上城镇面板卡面的**实际像素**。
 *  判"升级在卡面上看不看得出"必须看这张 —— ×8 会高估（铁律 16 同理）。 */
function card28(pb, s = 28) {
  const out = { w: s, h: s, d: new Uint8ClampedArray(s * s * 4) };
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const sx = Math.min(pb.w - 1, Math.floor(((x + 0.5) * pb.w) / s));
      const sy = Math.min(pb.h - 1, Math.floor(((y + 0.5) * pb.h) / s));
      const i = (sy * pb.w + sx) * 4;
      const j = (y * s + x) * 4;
      out.d[j] = pb.d[i];
      out.d[j + 1] = pb.d[i + 1];
      out.d[j + 2] = pb.d[i + 2];
      out.d[j + 3] = pb.d[i + 3];
    }
  }
  return out;
}

/** a 里不透明、b 里透明的像素数（"只加不拆"：L1 的每个点都必须在 L2 里）。 */
function onlyIn(a, b) {
  const ma = maskOf(a);
  const mb = maskOf(b);
  let n = 0;
  for (let i = 0; i < ma.length; i++) if (ma[i] && !mb[i]) n++;
  return n;
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** 区域内**精确颜色**的像素数 —— 区域计数在实心建筑上区分不了"有识别件/没有"。 */
function countColor(pb, hex, x0, y0, x1, y1) {
  const [R, G, B] = hexRgb(hex);
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [r, g, b, a] = pb.px(x, y);
      if (a > 8 && r === R && g === G && b === B) n++;
    }
  }
  return n;
}

function countBox(pb, x0, y0, x1, y1) {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (opaque(pb, x, y)) n++;
  return n;
}

/** 某一行上颜色变化的次数（条纹遮阳篷量这个）。 */
function colorRuns(pb, y) {
  let n = 1;
  let prev = null;
  for (let x = 0; x < pb.w; x++) {
    const [r, g, b, a] = pb.px(x, y);
    if (!a) continue;
    const k = `${r},${g},${b}`;
    if (prev !== null && k !== prev) n++;
    prev = k;
  }
  return n;
}

function meanRgb(pb) {
  let r = 0;
  let g = 0;
  let b = 0;
  let c = 0;
  for (let y = 0; y < pb.h; y++) {
    for (let x = 0; x < pb.w; x++) {
      const [R, G, B, A] = pb.px(x, y);
      if (A <= 8) continue;
      r += R;
      g += G;
      b += B;
      c++;
    }
  }
  return c ? [r / c, g / c, b / c] : [0, 0, 0];
}

/* ---------------------------------------------------------------- 建帧 */

const fresh = new Map();
const bare = new Map();
function rebuild() {
  for (const o of OWNERS) {
    for (const id of IDS) {
      fresh.set(`${o}:${id}`, buildBuildingArt(o, id));
      bare.set(`${o}:${id}`, buildBuildingArt(o, id, 0));
    }
  }
}
rebuild();

/* ---------------------------------------------------------------- [B0] 覆盖 */

{
  const bad = [];
  for (const o of OWNERS) {
    for (const id of IDS) {
      const pb = fresh.get(`${o}:${id}`);
      const want = buildingArtName(o, id);
      if (pb.w !== BUILDING_ART_SIZE || pb.h !== BUILDING_ART_SIZE) bad.push(`${want} 尺寸 ${pb.w}×${pb.h}`);
      if (area(pb) < 400) bad.push(`${want} 面积 ${area(pb)}`);
      if (want !== `bld_${o}_${id}`) bad.push(`帧名 ${want}`);
    }
  }
  const minArea = Math.min(...[...fresh.values()].map(area));
  record('B0', `Lv.1 覆盖 ${IDS.length} × ${OWNERS.length} = ${IDS.length * OWNERS.length} 帧 · ${BUILDING_ART_SIZE}×${BUILDING_ART_SIZE}（三档 40 帧另见 [B5]）`,
    bad.length === 0, bad.length ? bad.slice(0, 4).join('；') : `最小面积 ${minArea}`);
}

/* ---------------------------------------------------------------- [B1] 四族同构 */

{
  const diffs = [];
  for (const id of IDS) {
    const base = fresh.get(`p1:${id}`);
    for (const o of ['p2', 'p3', 'p4']) {
      const d = maskDiff(base, fresh.get(`${o}:${id}`));
      if (d) diffs.push(`${id}/${o} 差 ${d}px`);
    }
  }
  record('B1', '四族 alpha 掩码逐像素相同（只换材质，不换结构）', diffs.length === 0,
    diffs.length ? diffs.slice(0, 4).join('；') : `${IDS.length} 座 × 3 组对照 = 0 差异`);
}

/* ---------------------------------------------------------------- [B2] 四族材质 */

{
  const tooClose = [];
  let minD = Infinity;
  for (const id of IDS) {
    for (let i = 0; i < OWNERS.length; i++) {
      for (let j = i + 1; j < OWNERS.length; j++) {
        const a = meanRgb(fresh.get(`${OWNERS[i]}:${id}`));
        const b = meanRgb(fresh.get(`${OWNERS[j]}:${id}`));
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        minD = Math.min(minD, d);
        if (d < 12) tooClose.push(`${id} ${OWNERS[i]}/${OWNERS[j]} Δ${d.toFixed(1)}`);
      }
    }
  }
  record('B2', '同建筑跨族平均色两两分开（判据 ≥12）', tooClose.length === 0,
    tooClose.length ? tooClose.slice(0, 4).join('；') : `最接近的一对 Δ${minD.toFixed(1)}`);
}

/* ---------------------------------------------------------------- [B3] 没有两张一样的图 */

{
  let max = 0;
  let pair = '';
  let sum = 0;
  let n = 0;
  for (let i = 0; i < IDS.length; i++) {
    for (let j = i + 1; j < IDS.length; j++) {
      const v = iou(fresh.get(`p1:${IDS[i]}`), fresh.get(`p1:${IDS[j]}`));
      sum += v;
      n++;
      if (v > max) {
        max = v;
        pair = `${IDS[i]}/${IDS[j]}`;
      }
    }
  }
  const mean = sum / n;
  record('B3', '13 座两两剪影 IoU（判据 max ≤0.90 · mean ≤0.65）', max <= 0.9 && mean <= 0.65,
    `max ${max.toFixed(3)} (${pair}) · mean ${mean.toFixed(3)} · ${n} 对`);
}

/* ---------------------------------------------------------------- [B4] 每座一根识别件 */

/**
 * 五座的识别点就是剪影本身（木栅的八根竖桩 / 石墙的五个城齿 / 堡垒的两座塔 /
 * 圣殿的四根柱 / 市场的条纹篷），没有独立装饰件 —— 负向对照 `plain` 拿不掉它们，
 * 所以那里只该红 8 座，见 `STRUCTURAL`。
 */
/** 每座的**读数**（数字），阈值单列 —— 这样 `--marks` 打出来的就是 doc 里那张表。
 *  `f`/`b` 是帧表（带描边 / 不带描边），默认真实帧；负向对照传自己那套。 */
const MEASURE = {
  tavern: (f = fresh) => countColor(f.get('p1:tavern'), PAL.wood, 0, 27, 7, 37),
  market: (f = fresh) => colorRuns(f.get('p1:market'), 21),
  townhall: (f = fresh) => countBox(f.get('p1:townhall'), 0, 0, 43, 6),
  workshop: (f = fresh) => countColor(f.get('p1:workshop'), PAL.wood, 27, 16, 43, 43),
  wall1: (f, b = bare) => spansAt(b.get('p1:wall1'), 29),
  wall2: (f, b = bare) => spansAt(b.get('p1:wall2'), 20),
  wall3: (f, b = bare) => spansAt(b.get('p1:wall3'), 16),
  dwell1: (f = fresh) => countColor(f.get('p1:dwell1'), PAL.wood, 0, 32, 11, 40),
  dwell2: (f = fresh) => countColor(f.get('p1:dwell2'), PAL.wallLite, 26, 0, 43, 43),
  dwell3: (f = fresh) => countBox(f.get('p1:dwell3'), 0, 0, 43, 18),
  dwell4: (f = fresh) => countColor(f.get('p1:dwell4'), PAL.woodDark, 5, 29, 13, 35),
  dwell5: (f, b = bare) => spansAt(b.get('p1:dwell5'), 30),
  banner: (f = fresh) => countBox(f.get('p1:banner'), 34, 0, 43, 15),
};

/** 阈值。`cmp` 缺省 `ge`；`eq` 用于"数出来正好 N 段"（结构型识别点）。 */
const NEED = {
  tavern: { v: 12 }, market: { v: 10 }, townhall: { v: 20 }, workshop: { v: 60 },
  wall1: { v: 8, cmp: 'eq' }, wall2: { v: 5, cmp: 'eq' }, wall3: { v: 2, cmp: 'eq' },
  dwell1: { v: 12 }, dwell2: { v: 50 }, dwell3: { v: 30 }, dwell4: { v: 20 },
  dwell5: { v: 4, cmp: 'eq' }, banner: { v: 20 },
};

/** 读数是否达标（`[B4]` 与负向对照 `plain` 共用，避免两套写法漂移）。 */
function markOk(id, f, b) {
  const { v, cmp } = NEED[id];
  const n = MEASURE[id](f, b);
  return cmp === 'eq' ? n === v : n >= v;
}

const MARKS = Object.fromEntries(IDS.map((id) => [id, () => markOk(id)]));

const MARK_DESC = {
  tavern: '左侧挑出的招牌（木色像素）',
  market: '条纹遮阳篷（行内颜色变化）',
  townhall: '屋顶以上的旗',
  workshop: '右侧齿轮（木色像素）',
  wall1: '八根尖桩（一行 8 段）',
  wall2: '五个方城齿（一行 5 段）',
  wall3: '两座塔（一行 2 段）',
  dwell1: '左侧篱笆（木色像素）',
  dwell2: '草垛靶（浅色像素）',
  dwell3: '屋顶以上的交叉长矛',
  dwell4: '阁楼草料口（深木色像素）',
  dwell5: '四根透空柱廊（一行 4 段）',
  banner: '旗杆上的三角旗',
};

{
  const bad = [];
  const lines = [];
  for (const id of IDS) {
    const ok = MARKS[id]();
    if (!ok) bad.push(id);
    lines.push(`${id} ${ok ? '✓' : '✗'}`);
  }
  record('B4', `13 座各有识别件（${Object.keys(MARK_DESC).length} 条）`, bad.length === 0,
    bad.length ? `失败：${bad.join(', ')}` : lines.slice(0, 6).join(' · ') + ' · …');

  // 逐座读数 = doc §3 那张表；平时不刷屏，`--marks` 才打。
  if (process.argv.includes('--marks')) {
    console.log('\n  建筑        读数   阈值  判  识别件');
    for (const id of IDS) {
      const n = MEASURE[id]();
      const { v, cmp = 'ge' } = NEED[id];
      const sym = cmp === 'eq' ? '=' : '≥';
      console.log(`  ${id.padEnd(10)} ${String(n).padStart(5)}  ${sym}${String(v).padEnd(4)} ${markOk(id) ? '✓' : '✗'}  ${MARK_DESC[id]}`);
    }
  }
}

/* ---------------------------------------------------------------- [B5]–[B7] 三档 */

const TIERS = [1, 2, 3];
const tierFresh = new Map();
const tierBare = new Map();
function rebuildTiers() {
  for (const o of OWNERS) {
    for (const id of DWELLING_TIER_IDS) {
      for (const t of TIERS) {
        tierFresh.set(`${o}:${id}:${t}`, buildBuildingArt(o, id, 1, t));
        tierBare.set(`${o}:${id}:${t}`, buildBuildingArt(o, id, 0, t));
      }
    }
  }
}
rebuildTiers();

/** 跨档保留的识别件。阈值与 `[B4]` 同源，但**区域跟着档位的几何走**：
 *  兵营的矛尖在 Lv.2 抬到了城齿之上，圣殿两侧多了塔门（柱廊要限定 x6..37 再数）。 */
function tierMark(id, f, b) {
  if (id === 'dwell1') {
    const n = countColor(f, PAL.wood, 0, 32, 11, 40);
    return { ok: n >= 12, detail: `篱笆 ${n}/12` };
  }
  if (id === 'dwell2') {
    const n = countColor(f, PAL.wallLite, 26, 0, 43, 43);
    return { ok: n >= 50, detail: `草垛靶 ${n}/50` };
  }
  if (id === 'dwell3') {
    const n = countBox(f, 0, 0, 31, 13);
    return { ok: n >= 12, detail: `矛尖 ${n}/12` };
  }
  if (id === 'dwell4') {
    const n = countColor(f, PAL.woodDark, 5, 29, 13, 35);
    return { ok: n >= 20, detail: `草料口 ${n}/20` };
  }
  const n = spansBetween(b, 30, 6, 37);
  return { ok: n === 4, detail: `柱 ${n}/4 段` };
}

{
  const bad = [];
  let maxIou = 0;
  let maxPair = '';
  let minIou = 1;
  let minPair = '';
  for (const id of DWELLING_TIER_IDS) {
    const a = TIERS.map((t) => area(tierFresh.get(`p1:${id}:${t}`)));
    if (!(a[0] < a[1] && a[1] < a[2])) bad.push(`${id} 面积 ${a.join(' / ')}`);
    for (const [x, y] of [[1, 2], [2, 3]]) {
      const v = iou(tierFresh.get(`p1:${id}:${x}`), tierFresh.get(`p1:${id}:${y}`));
      if (v > maxIou) { maxIou = v; maxPair = `${id} L${x}/L${y}`; }
      if (v < minIou) { minIou = v; minPair = `${id} L${x}/L${y}`; }
      if (v > 0.88) bad.push(`${id} L${x}/L${y} IoU ${v.toFixed(3)}`);
    }
  }
  for (const o of OWNERS) {
    for (const id of DWELLING_TIER_IDS) {
      for (const t of [2, 3]) {
        const pb = tierFresh.get(`${o}:${id}:${t}`);
        if (pb.w !== BUILDING_ART_SIZE || pb.h !== BUILDING_ART_SIZE) bad.push(`${o}:${id}:u${t} 尺寸`);
        if (buildingArtName(o, id, t) !== `bld_${o}_${id}_u${t}`) bad.push(`帧名 ${buildingArtName(o, id, t)}`);
      }
    }
  }
  record('B5', `${DWELLING_TIER_IDS.length} 座 × ${TIERS.length - 1} 档 × ${OWNERS.length} 族 = 40 帧 · 面积逐档递增 · 档间 IoU ≤0.88`,
    bad.length === 0,
    bad.length ? bad.slice(0, 4).join('；') : `最大 ${maxIou.toFixed(3)}（${maxPair}）· 最小 ${minIou.toFixed(3)}（${minPair}）`);
}

{
  const bad = [];
  const lost = [];
  for (const id of DWELLING_TIER_IDS) {
    // ① 只加不拆：L1 ⊆ L2 ⊆ L3（用未描边帧 —— 墨环会盖住外沿 1px）
    const d12 = onlyIn(tierBare.get(`p1:${id}:1`), tierBare.get(`p1:${id}:2`));
    const d23 = onlyIn(tierBare.get(`p1:${id}:2`), tierBare.get(`p1:${id}:3`));
    if (d12) bad.push(`${id} L1⊄L2 少 ${d12}px`);
    if (d23) bad.push(`${id} L2⊄L3 少 ${d23}px`);
    // ② 识别件必须跨档还在（升级不能把"这是哪座建筑"弄丢）
    for (const t of TIERS) {
      const r = tierMark(id, tierFresh.get(`p1:${id}:${t}`), tierBare.get(`p1:${id}:${t}`));
      if (!r.ok) lost.push(`${id} L${t} ${r.detail}`);
    }
  }
  record('B6', '升级只加不拆（L1⊆L2⊆L3）· 识别件跨三档保留', bad.length === 0 && lost.length === 0,
    bad.length || lost.length ? [...bad, ...lost].slice(0, 4).join('；') : '5 座 × 3 档 = 15 组全部包含 + 识别件 15/15');
}

{
  const bad = [];
  for (const id of DWELLING_TIER_IDS) {
    for (const t of TIERS) {
      const base = tierFresh.get(`p1:${id}:${t}`);
      for (const o of ['p2', 'p3', 'p4']) {
        const d = maskDiff(base, tierFresh.get(`${o}:${id}:${t}`));
        if (d) bad.push(`${id} L${t}/${o} 差 ${d}px`);
      }
    }
  }
  record('B7', `三档 × 四族只换材质（${DWELLING_TIER_IDS.length}×${TIERS.length}×3 = 45 组掩码差 0）`,
    bad.length === 0, bad.length ? bad.slice(0, 4).join('；') : '45 组逐像素相同');
}

/* 逐座读数表（批次文档 §3 那张）：面积与 IoU 都用**已描边帧**，与 [B5] 同口径。
   列出来是为了让人能对着看"哪一座的升级最弱"，不是给闸门用的。 */
if (TIERS_TABLE) {
  console.log('\n  建筑       面积 L1 / L2 / L3        IoU L1/L2 · L2/L3');
  for (const id of DWELLING_TIER_IDS) {
    const f = [1, 2, 3].map((t) => tierFresh.get(`p1:${id}:${t}`));
    const a = f.map(area);
    console.log(
      `  ${id.padEnd(9)} ${a.map((n) => String(n).padStart(4)).join(' / ')}` +
        `        ${iou(f[0], f[1]).toFixed(3)} · ${iou(f[1], f[2]).toFixed(3)}`,
    );
  }
}

/* ---------------------------------------------------------------- 负向对照 */

const negatives = [];
function run(name, breaks, fn) {
  const before = getBuildingArtBreaks();
  setBuildingArtBreaks({ ...before, ...breaks });
  const r = fn();
  setBuildingArtBreaks(before);
  negatives.push({ name, ...r });
  console.log(`[N-${name}] ${r.ok ? '如期变红' : '**没有变红**'} — ${r.detail}`);
}

if (NEGCTRL) {
  console.log('\n--- 负向对照（每条都必须变红，跑完复原） ---');

  run('plain', { plain: true }, () => {
    // 结构型识别点拿不掉：它们就是剪影本身（八根桩 / 五个齿 / 两座塔 / 四根柱 / 条纹篷），
    // 不是贴上去的装饰件。所以 `plain` 只该红**装饰型**的 8 座。
    const STRUCTURAL = new Set(['wall1', 'wall2', 'wall3', 'dwell5', 'market']);
    const bad = IDS.filter((id) => {
      if (STRUCTURAL.has(id)) return false;
      // 即时建帧，绕开 fresh 缓存（plain 是在 rebuild 之后才翻的）
      return !markOk(id, new Map([[`p1:${id}`, buildBuildingArt('p1', id)]]));
    });
    return { ok: bad.length === 8, detail: `识别件消失的 ${bad.length} 座（应 8）：${bad.join(',')}` };
  });

  run('sameShape', { sameShape: true }, () => {
    let max = 0;
    for (let i = 0; i < IDS.length; i++) {
      for (let j = i + 1; j < IDS.length; j++) {
        max = Math.max(max, iou(buildBuildingArt('p1', IDS[i]), buildBuildingArt('p1', IDS[j])));
      }
    }
    return { ok: max > 0.9, detail: `13 张图的 max IoU ${max.toFixed(3)}` };
  });

  run('onePalette', { onePalette: true }, () => {
    const a = meanRgb(buildBuildingArt('p1', 'tavern'));
    const b = meanRgb(buildBuildingArt('p2', 'tavern'));
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    return { ok: d < 12, detail: `酒馆 p1/p2 平均色 Δ${d.toFixed(1)}（四族共用 p1 材质）` };
  });

  run('jitter', { jitter: true }, () => {
    const d = maskDiff(buildBuildingArt('p1', 'wall2'), buildBuildingArt('p2', 'wall2'));
    return { ok: d > 0, detail: `石墙 p1/p2 掩码差 ${d}px` };
  });

  // [B5] 的反面：三档画成同一档（就是 B2 之前的样子 —— 玩家付了钱、屏幕没变）。
  // 面积不再递增、档间 IoU 冲到 1.000，[B5] 必须红。这条量的是"闸会不会红"，不是画得好不好。
  run('tiersFlat', { tiersFlat: true }, () => {
    const id = 'dwell3'; // 剪影最规整的一座，最容易"看起来没变"还过闸
    const f = [1, 2, 3].map((t) => buildBuildingArt('p1', id, 1, t));
    const a = f.map(area);
    const i12 = iou(f[0], f[1]);
    const i23 = iou(f[1], f[2]);
    const red = !(a[0] < a[1] && a[1] < a[2]) || i12 > 0.88 || i23 > 0.88;
    return { ok: red, detail: `面积 ${a.join(' / ')} · IoU ${i12.toFixed(3)}/${i23.toFixed(3)}` };
  });
}

/* ---------------------------------------------------------------- PNG 目检 */

if (PNG_DIR) {
  mkdirSync(PNG_DIR, { recursive: true });
  let n = 0;
  for (const o of OWNERS) {
    for (const id of IDS) {
      writeFileSync(join(PNG_DIR, `${o}_${id}.png`), encodePng(upscale(buildBuildingArt(o, id), 8)));
      n++;
    }
    // 兵营线三档：Lv.1 已在上面，这里补 Lv.2 / Lv.3（帧名与图集一致：_u2 / _u3）
    for (const id of DWELLING_TIER_IDS) {
      for (let t = 2; t <= MAX_BUILDING_TIER; t++) {
        writeFileSync(join(PNG_DIR, `${o}_${id}_u${t}.png`),
          encodePng(upscale(buildBuildingArt(o, id, 1, t), 8)));
        n++;
      }
    }
  }
  console.log(`\nPNG 已导出 → ${PNG_DIR}（${n} 帧 ×8，含兵营 40 帧三档）`);
}

/* ---------------------------------------------------------------- 对照表 */

if (SHEET_DIR) {
  mkdirSync(SHEET_DIR, { recursive: true });
  const opt = { cols: 4, cell: 132, gap: 6 };

  // ① 13 座 × p1：一眼看完整个"建筑列表长什么样"
  writeFileSync(join(SHEET_DIR, 'sheet-p1.png'),
    encodePng(montage(IDS.map((id) => ({ pb: buildBuildingArt('p1', id) })), opt)));

  // ② 4 座代表 × 4 族：只换材质不换结构，跨族一眼看穿
  const REPS = ['tavern', 'wall2', 'dwell5', 'banner'];
  const cross = [];
  for (const id of REPS) for (const o of OWNERS) cross.push({ pb: buildBuildingArt(o, id) });
  writeFileSync(join(SHEET_DIR, 'sheet-factions.png'), encodePng(montage(cross, opt)));

  // ③ 兵营线 5 座 × 3 档（p1）：每行一座，左→右 Lv.1/Lv.2/Lv.3。
  //    ×8 用在 44px 上，判"新体块长在房子上、不是摆在旁边"。
  const tierFrames = [];
  for (const id of DWELLING_TIER_IDS) {
    for (const t of [1, 2, 3]) tierFrames.push({ pb: buildBuildingArt('p1', id, 1, t) });
  }
  writeFileSync(join(SHEET_DIR, 'sheet-tiers-p1.png'),
    encodePng(montage(tierFrames, { cols: 3, cell: 352, gap: 6 })));

  // ④ 同一批降到 28px（= DPR1 城镇面板上卡面实际像素），再 ×6 放大看。
  //    这张才是判"升级在卡面上看不看得出"的那张；看 ×8 会高估。
  writeFileSync(join(SHEET_DIR, 'sheet-tiers-28-p1.png'),
    encodePng(montage(tierFrames.map(({ pb }) => ({ pb: card28(pb) })), { cols: 3, cell: 168, gap: 6 })));

  console.log(`\n对照表已导出 → ${SHEET_DIR}（sheet-p1 13 格 · sheet-factions 4×4 · sheet-tiers-p1 5×3 · sheet-tiers-28-p1 5×3@28px）`);
}

/* ---------------------------------------------------------------- 汇总 */

console.log('\n' + '='.repeat(72));
console.log(`断言：${fail === 0 ? '全部通过' : `${fail} 条失败`}`);
if (NEGCTRL) {
  const red = negatives.filter((x) => x.ok).length;
  console.log(`负向对照：${red}/${negatives.length} 条如期变红`);
}
console.log('人工项：×8 单张目检（铁律 1）—— 判"13 座认得出、分得开"，不判"面积达标"');
console.log('='.repeat(72));
process.exit(GATE && fail ? 1 : 0);
