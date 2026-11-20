/**
 * 会生长的城市场景闸门（HOMM3 观感 · 2026-11-19 第二版重新设计）。
 *
 * 两层判据：
 *   ① **美术层**（纯 Node）：16 座 80×80 场景建筑按建筑原型重画（弧顶长屋 / 锯齿厂棚 /
 *      柱廊宅 / 圆塔 / 穹顶 / 平顶钟楼 / 水晶尖塔…），四族"结构同材质不同"、升级档改变剪影、
 *      **16 座两两 IoU <0.88**（上一版"12 座同款尖顶"必须转红）；底子新增城堡远景、主干道、
 *      广场与喷泉，四族底子在特征区域结构上不同；**16 座各有建材**（红瓦/茅草/石板/
 *      砖窑/铜绿/水晶…），阵营色退成旗、饰带与轻微偏色；**远景主堡要有结构**（收分/砌石/
 *      城垛/门楼，实测 692 边缘像素），**16 座底部都要有接地投影**（半透明暗部）。
 *      **S10** 四族城心天际线两两 IoU ≤0.55；**S11** 城心材质呼应兵种（p2 熔岩+铜人、
 *      p4 紫晶+骨，p1/p3 不得串味）——S10 只证明"四座城不一样"，S11 才证明"p2 是火山、
 *      p4 是亡灵"。负向臂 `sameShape` / `sameBase` / `noStreet` / `sameTone` / `flatCastle` /
 *      `noShadow` 分别让建筑塌成同一张、底子塌成同一张、街道消失、建材塌回"一族一色"、
 *      城堡塌成一块灰墙、投影归零；`N0i` 用 flatCastle 验证 S11 的材质标记确实长在城心上。
 *   ② **接线/交互层**（真 Chrome）：844×390 横屏下从城镇面板打开城景，16 块地
 *      按 y 与远/中/近三档缩放落位；**只有已建的地块画建筑**，未建画浅地基，点两种地块都能出详情；
 *      城堡由底子直接画，DOM 里只有一个透明热区（点它出「城墙」详情，不再叠第二张城堡图）。
 *      `?devtownview=0` 负向臂必须看不到入口。
 *   ③ **英雄招募接线**：默认在「招募」页、`市场·工坊` 页没有；`?devhiretab=market`
 *      负向臂把它退回旧页，两条判据都必须翻转（证明测的是页签位置而不是字样）。
 *   ④ **存量转换接线**（决策 59）：`devtier=3` 下「驻军」页有 `.stack-convert` 按钮，
 *      点一下真的换成升级版；`?devnoconvert=1` 负向臂下按钮必须一个都没有。
 *
 * 用法：node tools/probes/townview.mjs [--gate] [--shot=<dir>]
 * 退出码：不给 --gate 时只报读数；给了 --gate 时 0=全过 / 1=FAIL / 2=前置不满足。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { argOf, distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';
import { installShim } from '../_canvas.mjs';
import { withHeadlessChrome, cdpPort } from '../_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=townview');
const u = (rel) => distUrl(rel, DIST);
requireFile(DIST, 'render/townSceneArt.js');
requireFile(DIST, 'ui/TownDialog.js');

const GATE = process.argv.includes('--gate');
const SHOT_DIR = argOf('shot');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
let fails = 0;
function record(id, title, ok, detail = '') {
  if (!ok) fails++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] [${id}] ${title}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================================================================ 美术层 */
installShim();
const {
  SCENE_BUILDING_SIZE,
  TOWN_BUILDING_IDS,
  buildSceneBuilding,
  buildTownBase,
  townPlots,
  setSceneArtBreaks,
  scenePaletteOf,
  TOWN_ROAD_COLOR,
} = await import(u('render/townSceneArt.js'));
const OWNERS = ['p1', 'p2', 'p3', 'p4'];

const maskOf = (pb) => {
  const m = new Uint8Array(pb.w * pb.h);
  for (let y = 0; y < pb.h; y++) for (let x = 0; x < pb.w; x++) m[y * pb.w + x] = pb.alphaAt(x, y) > 8 ? 1 : 0;
  return m;
};
const areaOf = (m) => m.reduce((s, v) => s + v, 0);
const iouOf = (a, b) => {
  let it = 0, un = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] || b[i]) un++; if (a[i] && b[i]) it++; }
  return un ? it / un : 1;
};
const meanColor = (pb) => {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < pb.h; y++) for (let x = 0; x < pb.w; x++) {
    if (pb.alphaAt(x, y) <= 8) continue;
    const c = pb.px(x, y); r += c[0]; g += c[1]; b += c[2]; n++;
  }
  return [r / n, g / n, b / n];
};
/** 亮度梯度掩码：底子整幅不透明，不能用 alpha 判结构；取 4px 采样点的边缘。 */
const edgeMask = (pb, region = () => true) => {
  const m = new Uint8Array(pb.w * pb.h);
  const lum = (x, y) => { const c = pb.px(x, y); return (c[0] * 77 + c[1] * 150 + c[2] * 29) >> 8; };
  for (let y = 2; y < pb.h - 2; y += 4) for (let x = 2; x < pb.w - 2; x += 4) {
    if (!region(x, y, pb.w, pb.h)) continue;
    const g = Math.abs(lum(x + 2, y) - lum(x - 2, y)) + Math.abs(lum(x, y + 2) - lum(x, y - 2));
    if (g > 26) m[y * pb.w + x] = 1;
  }
  return m;
};
/** 四族底子的特征区域：天空/两侧地表/前景，避开四族共用的城堡与街道骨架。 */
const baseSignature = (x, y, W, H) => y < H * 0.20 || x < W * 0.13 || x > W * 0.87 || y > H * 0.55;
const maxPair = (arr, metric) => {
  let worst = 0;
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) worst = Math.max(worst, metric(arr[i], arr[j]));
  return worst;
};
const roadPixels = (pb) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(TOWN_ROAD_COLOR.slice(i, i + 2), 16));
  let n = 0;
  for (let y = Math.floor(pb.h * 0.44); y < pb.h; y++) for (let x = 0; x < pb.w; x++) {
    const c = pb.px(x, y);
    if (c[0] === r && c[1] === g && c[2] === b) n++;
  }
  return n;
};
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hueBucket = (h) => {
  const [r, g, b] = hexRgb(h).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return -1;
  const x = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.floor(x * 60 / 30); // 30° 一档
};
const colorPixels = (pb, hex) => {
  const [r, g, b] = hexRgb(hex);
  let n = 0;
  for (let y = 0; y < pb.h; y++) for (let x = 0; x < pb.w; x++) {
    const c = pb.px(x, y);
    if (c[0] === r && c[1] === g && c[2] === b) n++;
  }
  return n;
};

const big = new Map();
for (const owner of OWNERS) for (const id of TOWN_BUILDING_IDS) {
  big.set(`${owner}/${id}`, buildSceneBuilding(owner, id, 1));
}
record('S0', `16 座 × 4 族 = 64 张 ${SCENE_BUILDING_SIZE}px 场景建筑，无空帧`,
  big.size === 64 && [...big.values()].every((pb) =>
    pb.w === SCENE_BUILDING_SIZE && pb.h === SCENE_BUILDING_SIZE && areaOf(maskOf(pb)) > 400),
  `${big.size} 帧 · ${SCENE_BUILDING_SIZE}px`);

let maskSame = 0, colorSplit = 0;
const colorClose = [];
for (const id of TOWN_BUILDING_IDS) {
  const masks = OWNERS.map((o) => maskOf(big.get(`${o}/${id}`)));
  if (masks.slice(1).every((m) => iouOf(masks[0], m) === 1)) maskSame++;
  const cs = OWNERS.map((o) => meanColor(big.get(`${o}/${id}`)));
  let min = Infinity;
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    min = Math.min(min, Math.hypot(...cs[i].map((v, k) => v - cs[j][k])));
  }
  if (min >= 6) colorSplit++;
  else colorClose.push(`${id}:${min.toFixed(1)}`);
}
record('S1', '四族建筑结构逐像素相同（只换材质）', maskSame === 16, `${maskSame}/16`);
record('S2', '四族材质确实分开（最近两族色距 ≥6）', colorSplit === 16,
  `${colorSplit}/16${colorClose.length ? ` · 太近 ${colorClose.join(' ')}` : ''}`);

const tierDeltas = TOWN_BUILDING_IDS.map((id) => {
  const a1 = areaOf(maskOf(buildSceneBuilding('p1', id, 1)));
  const a3 = areaOf(maskOf(buildSceneBuilding('p1', id, 3)));
  return { id, a1, a3 };
});
const grown = tierDeltas.filter((d) => d.a3 > d.a1).length;
record('S3', '16 座 L3 剪影都比 L1 大（不是只改内部像素）',
  grown === 16, `${grown}/16 · ${tierDeltas.slice(0, 3).map((d) => `${d.id}:${d.a1}→${d.a3}`).join(' ')}`);

const bases = OWNERS.map((o) => buildTownBase(o, 760, 300));
const baseEdges = bases.map((b) => edgeMask(b, baseSignature));
const baseEdgeCounts = baseEdges.map(areaOf);
const baseEdgeIoU = maxPair(baseEdges, iouOf);
record('S4', '四族底子的特征区域结构不同（边缘掩码两两 IoU <0.65，且每张真有边缘）',
  bases.every((b) => b.w === 760 && b.h === 300) &&
  baseEdgeCounts.every((n) => n > 200) && baseEdgeIoU < 0.65,
  `边缘 ${baseEdgeCounts.join('/')} · 最大 IoU ${baseEdgeIoU.toFixed(3)}`);

// 用户实拍反馈的核心：上一版 12/16 都是"米色方盒 + 蓝尖顶"。两两 IoU 必须真的分开。
const silhouettes = TOWN_BUILDING_IDS.map((id) => maskOf(big.get(`p1/${id}`)));
const silhouetteIoU = maxPair(silhouettes, iouOf);
record('S5', '16 座建筑轮廓互不相同（两两 IoU <0.88，不许 12 座同款尖顶）',
  silhouetteIoU < 0.88, `最大 IoU ${silhouetteIoU.toFixed(3)}`);

const roadN = roadPixels(bases[0]);
record('S6', '底子里真有主干道/广场（路面色像素 >5000）', roadN > 5000, `${roadN} px`);

// 用户第二轮实拍反馈：轮廓分开了，但"全是蓝顶白墙"仍单调。每座必须有自己的建材。
const mats = TOWN_BUILDING_IDS.map((id) => scenePaletteOf('p1', id));
const roofUniq = new Set(mats.map((m) => m.roof)).size;
const wallUniq = new Set(mats.map((m) => m.wall)).size;
const roofHues = new Set(mats.map((m) => hueBucket(m.roof))).size;
const wallHues = new Set(mats.map((m) => hueBucket(m.wall))).size;
const painted = TOWN_BUILDING_IDS.filter((id, i) =>
  Object.values(mats[i]).some((c) => colorPixels(big.get(`p1/${id}`), c) >= 25)).length;
record('S7', '16 座各有建材：16 种屋顶/墙色、≥5 个屋顶色相族，且每帧真画出自己的色',
  roofUniq === 16 && wallUniq === 16 && roofHues >= 5 && wallHues >= 4 && painted === 16,
  `屋顶 ${roofUniq} 色/${roofHues} 族 · 墙 ${wallUniq} 色/${wallHues} 族 · 上色 ${painted}/16`);

/* 用户在实拍里指出：中央城堡是一整块灰墙开个黑洞，占画面最大却最没设计。
   这里只量"主堡那一片有没有结构"，负向臂把城堡塌回一块灰墙。 */
const lum = (pb, x, y) => { const c = pb.px(x, y); return (c[0] * 77 + c[1] * 150 + c[2] * 29) >> 8; };
const edgeIn = (pb, x0, x1, y0, y1) => {
  let n = 0;
  for (let y = y0 + 2; y < y1 - 2; y += 2) for (let x = x0 + 2; x < x1 - 2; x += 2) {
    const g = Math.abs(lum(pb, x + 2, y) - lum(pb, x - 2, y)) + Math.abs(lum(pb, x, y + 2) - lum(pb, x, y - 2));
    if (g > 26) n++;
  }
  return n;
};
const keepRegion = (pb) => [Math.round(pb.w * 0.42), Math.round(pb.w * 0.58), Math.round(pb.h * 0.15), Math.round(pb.h * 0.42)];
const keepEdges = (pb) => edgeIn(pb, ...keepRegion(pb));
const keepN = keepEdges(bases[0]);
record('S8', '远景主堡真有结构（收分/城垛/箭孔/门楼），不是一块灰墙',
  keepN >= 450, `${keepN} 边缘像素`);

/* 落地：每帧底部要有一圈半透明投影，否则 16 座会排成三排"浮在板上"。 */
const shadowPixels = (pb) => {
  let n = 0;
  for (let y = pb.h - 7; y < pb.h; y++) for (let x = 0; x < pb.w; x++) {
    const a = pb.alphaAt(x, y);
    if (a > 8 && a < 170) n++;
  }
  return n;
};
const shadows = TOWN_BUILDING_IDS.map((id) => shadowPixels(big.get(`p1/${id}`)));
record('S9', '16 座底部都有接地投影（半透明暗部 ≥40px），不再靠一条石板承重',
  shadows.every((n) => n >= 40), `最少 ${Math.min(...shadows)}px / 合计 ${shadows.reduce((a, b) => a + b, 0)}px`);

/* 用户要求"其他种族也得是别的城"，不是同一座石堡换色。
   量的是**城心那一条天际线**（0.10–0.90 宽、0.13–0.45 高）：p1 方石堡 / p2 熔岩要塞 /
   p3 树冠木厅 / p4 紫晶尖塔。负向臂把三族城心塌回 p1 那面灰墙，IoU 必须明显抬起来。 */
const skylineRegion = (x, y, W, H) => x >= W * 0.10 && x <= W * 0.90 && y >= H * 0.13 && y <= H * 0.45;
const skylineEdges = bases.map((b) => edgeMask(b, skylineRegion));
const skylineN = skylineEdges.map(areaOf);
const skylineIoU = maxPair(skylineEdges, iouOf);
record('S10', '四族城心是四种剪影（天际线边缘两两 IoU ≤0.55，每张 ≥600 边缘像素·4px 采样）',
  skylineN.every((n) => n >= 600) && skylineIoU <= 0.55,
  `边缘 ${skylineN.join('/')} · 最大 IoU ${skylineIoU.toFixed(3)}`);

/* 用户要求"城堡/背景/建筑风格要和种族、兵种相呼应"。S10 只证明"四座城不一样"，
   不证明"p2 是熔岩、p4 是亡灵"。这里量城心（x 0.38–0.62、y 0.02–0.42）里的
   **材质标记像素**（本探针 760×300、±8 容差实测）：p2 熔岩 **278** + 黄铜 **331** /
   p4 紫晶 **389** + 骨 **487**。容差是因为描边混合会挪动几个通道；p1 石灰岩会误命中
   32 个骨色像素，所以"专属"用数量级差判，不用绝对零。 */
const TOKENS = {
  lava: ['#ff7a2a', '#c23a12', '#ffd072'],
  brass: ['#b98a3e', '#e0b45c', '#e6dcc4'],
  amethyst: ['#a05cd8', '#d6a4ff', '#6b3a94'],
  bone: ['#ded3c0', '#a99c86'],
};
const tokenRgb = Object.fromEntries(Object.entries(TOKENS).map(([k, v]) =>
  [k, v.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)))]));
const tokenCount = (pb, key) => {
  const region = (x, y) => x >= pb.w * 0.38 && x <= pb.w * 0.62 && y >= pb.h * 0.02 && y <= pb.h * 0.42;
  const list = tokenRgb[key];
  let n = 0;
  for (let y = pb.h * 0.02 | 0; y < pb.h * 0.42; y++) for (let x = pb.w * 0.38 | 0; x < pb.w * 0.62; x++) {
    if (!region(x, y)) continue;
    const c = pb.px(x, y);
    if (list.some((t) => [0, 1, 2].every((i) => Math.abs(c[i] - t[i]) <= 8))) n++;
  }
  return n;
};
const tok = OWNERS.map((o) => Object.fromEntries(['lava', 'brass', 'amethyst', 'bone'].map((k) => [k, tokenCount(bases[OWNERS.indexOf(o)], k)])));
record('S11', '城心材质呼应兵种（p2 熔岩+铜人、p4 紫晶+骨；p1/p3 不得串味）',
  tok[1].lava >= 200 && tok[1].brass >= 200 && tok[3].amethyst >= 200 && tok[3].bone >= 300 &&
  // p1 石灰岩在 ±8 容差下会误命中少量骨/铜色；判"专属"用数量级差而非绝对零
  tok[0].bone * 3 < tok[3].bone && tok[0].brass * 3 < tok[1].brass &&
  tok[0].amethyst === 0 && tok[2].lava === 0 && tok[2].amethyst === 0,
  `p2 ${JSON.stringify(tok[1])} · p4 ${JSON.stringify(tok[3])} · p1/p3 ${JSON.stringify(tok[0])}/${JSON.stringify(tok[2])}`);

/* S10 量城心剪影、S11 量城心材质，都不管 16 块地摆在哪。用户要的"一看就知道哪个种族"
   还要靠**布局本身**：p1 棋盘横排 / p2 环形围炉 / p3 垂直分层挂树 / p4 放射甬道。
   量按地块 id 逐块对齐后的像素位移（844×390 舞台）+ 方向特征；sameLayout 负向臂全塌回 p1。 */
const plots = OWNERS.map((o) => townPlots(o));
const SCREEN = { w: 844, h: 390 };
const plotDisp = (a, b) => a.reduce((sum, pa, i) => sum + Math.hypot(
  (pa.x - b[i].x) * SCREEN.w, (pa.y - b[i].y) * SCREEN.h), 0) / a.length;
let minDisp = Infinity, minPair = '';
for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
  const d = plotDisp(plots[i], plots[j]);
  if (d < minDisp) { minDisp = d; minPair = `${OWNERS[i]}-${OWNERS[j]}`; }
}
const feat = plots.map((ps) => {
  const ys = ps.map((p) => p.y), xs = ps.map((p) => p.x);
  let rows = 0, cols = 0;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    if (Math.abs(ys[i] - ys[j]) < 0.015) rows++;
    if (Math.abs(xs[i] - xs[j]) < 0.015) cols++;
  }
  return {
    high: ys.filter((y) => y < 0.35).length,
    spread: Math.max(...ys) - Math.min(...ys), rows, cols,
  };
});
// 844×390 落位安全：每块地按 translate(-50%,-72%) 不能有越界，且 slot ≥76px
let outside = 0, minSlot = Infinity;
for (const ps of plots) for (const pl of ps) {
  const w = Math.max(44, SCREEN.w * 0.15 * pl.scale);
  const left = pl.x * SCREEN.w - w / 2, right = pl.x * SCREEN.w + w / 2;
  const top = pl.y * SCREEN.h - w * 0.72, bot = top + w;
  if (left < -1 || right > SCREEN.w + 1 || top < -1 || bot > SCREEN.h + 1) outside++;
  minSlot = Math.min(minSlot, w);
}
record('S12', '四族地块布局互不相同（逐块位移 ≥100px）、方向对、844×390 不越界',
  minDisp >= 100 && outside === 0 && minSlot >= 44 &&
  feat[2].high >= 2 && feat[2].spread >= 0.55 &&
  feat[0].rows > feat[0].cols * 2 && feat[3].cols >= feat[3].rows,
  `最小位移 ${minDisp.toFixed(0)}px(${minPair}) · 越界${outside}/最小格${minSlot.toFixed(0)}px · ` +
  `p3 高层${feat[2].high}/跨度${feat[2].spread.toFixed(2)} · p1 行${feat[0].rows}/列${feat[0].cols} · p4 行${feat[3].rows}/列${feat[3].cols}`);

setSceneArtBreaks({ sameShape: true });
const flatMasks = TOWN_BUILDING_IDS.map((id) => maskOf(buildSceneBuilding('p1', id, 1)));
const flatIoU = maxPair(flatMasks, iouOf);
record('N0', 'sameShape 负向对照：16 座必须全塌成尖顶小屋（两两 IoU >0.95）', flatIoU > 0.95, `IoU ${flatIoU.toFixed(3)}`);
setSceneArtBreaks({ sameShape: false });

setSceneArtBreaks({ sameBase: true });
const flatBases = OWNERS.map((o) => edgeMask(buildTownBase(o, 760, 300), baseSignature));
const flatBaseIoU = maxPair(flatBases, iouOf);
record('N0b', 'sameBase 负向对照：四张底子必须塌成同一张（IoU = 1）',
  flatBaseIoU === 1, `IoU ${flatBaseIoU.toFixed(3)}`);
setSceneArtBreaks({ sameBase: false });

setSceneArtBreaks({ noStreet: true });
const noRoadN = roadPixels(buildTownBase('p1', 760, 300));
record('N0d', 'noStreet 负向对照：抽掉街道后路面色像素 = 0', noRoadN === 0, `${noRoadN} px`);
setSceneArtBreaks({ noStreet: false });

setSceneArtBreaks({ sameTone: true });
const flatMats = TOWN_BUILDING_IDS.map((id) => scenePaletteOf('p1', id));
const flatRoofUniq = new Set(flatMats.map((m) => m.roof)).size;
const flatWallUniq = new Set(flatMats.map((m) => m.wall)).size;
setSceneArtBreaks({ sameTone: false }); // 负向臂只留 flatCastle 一个变量
setSceneArtBreaks({ flatCastle: true });
const flatSkyBases = OWNERS.map((o) => buildTownBase(o, 760, 300));
const flatSky = flatSkyBases.map((b) => edgeMask(b, skylineRegion));
const flatSkyIoU = maxPair(flatSky, iouOf);
record('N0h', 'flatCastle 负向对照：城心塌回同一面灰墙后，天际线 IoU 必须涨到 ≥0.60',
  flatSkyIoU >= 0.60, `最大 IoU ${flatSkyIoU.toFixed(3)}（正常 ${skylineIoU.toFixed(3)}）`);
const flatTok = [1, 3].map((i) => Object.fromEntries(['lava', 'brass', 'amethyst', 'bone'].map((k) => [k, tokenCount(flatSkyBases[i], k)])));
record('N0i', 'flatCastle 负向对照：城心塌成灰墙后 p2 熔岩/p4 紫晶标记必须归零',
  flatTok.every((t) => t.lava === 0 && t.brass === 0 && t.amethyst === 0 && t.bone === 0),
  `flat-p2 ${JSON.stringify(flatTok[0])} · flat-p4 ${JSON.stringify(flatTok[1])}`);
setSceneArtBreaks({ flatCastle: false });

setSceneArtBreaks({ sameLayout: true });
const flatPlots = OWNERS.map((o) => townPlots(o));
let flatMaxDisp = 0;
for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) flatMaxDisp = Math.max(flatMaxDisp, plotDisp(flatPlots[i], flatPlots[j]));
record('N0j', 'sameLayout 负向对照：四族地块塌回同一套棋盘后逐块位移必须归零',
  flatMaxDisp === 0, `最大位移 ${flatMaxDisp.toFixed(1)}px（正常最小 ${minDisp.toFixed(0)}px）`);
setSceneArtBreaks({ sameLayout: false });

record('N0e', 'sameTone 负向对照：建材必须塌回"一族一色"（蓝顶白墙）',
  flatRoofUniq === 1 && flatWallUniq === 1, `屋顶 ${flatRoofUniq} 色 · 墙 ${flatWallUniq} 色`);
setSceneArtBreaks({ sameTone: false });

setSceneArtBreaks({ flatCastle: true });
const flatKeepN = keepEdges(buildTownBase('p1', 760, 300));
record('N0f', 'flatCastle 负向对照：主堡塌回一块灰墙后边缘像素必须掉到 260 以下',
  flatKeepN < 260, `${flatKeepN} 边缘像素（正常 ${keepN}）`);
setSceneArtBreaks({ flatCastle: false });

setSceneArtBreaks({ noShadow: true });
const noShadowN = TOWN_BUILDING_IDS.map((id) => shadowPixels(buildSceneBuilding('p1', id, 1)));
record('N0g', 'noShadow 负向对照：抽掉投影后底部半透明像素必须归零',
  noShadowN.every((n) => n === 0), `合计 ${noShadowN.reduce((a, b) => a + b, 0)}px`);
setSceneArtBreaks({ noShadow: false });

/* ================================================================ 接线层 */
const APP_PORT = 39800 + (process.pid % 200);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const server = spawn('node', [path.join(ROOT, 'tools', 'serve.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT: String(APP_PORT) }, stdio: ['ignore', 'ignore', 'pipe'],
});
let serverLog = '';
server.stderr.on('data', (d) => { serverLog += d.toString(); });
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(BASE_URL)).ok) break; } catch { /* 服务还没起 */ }
  await sleep(100);
}

async function openTownAndScene(send, evaluate, extra = '') {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.clear(); } catch {}`,
  });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 844, height: 390, deviceScaleFactor: 1, mobile: true,
  });
  await send('Page.navigate', { url: `${BASE_URL}/?devquick=1&devtown=1&devtier=3${extra}` });
  for (let i = 0; i < 100; i++) {
    try { if (await evaluate(`!!document.querySelector('.town-meta')`)) break; } catch { /* 导航中 */ }
    await sleep(100);
  }
  const toggle = await evaluate(`!!document.querySelector('.town-view-toggle')`);
  if (!toggle) return { toggle: false, scene: false };
  await evaluate(`document.querySelector('.town-view-toggle').click()`);
  for (let i = 0; i < 60; i++) {
    try { if (await evaluate(`!!document.querySelector('.townview')`)) break; } catch { /* 重绘中 */ }
    await sleep(100);
  }
  return { toggle: true, scene: await evaluate(`!!document.querySelector('.townview')`) };
}

/** 切到指定页签，返回该页是否含「招募英雄」按钮（读文本节点，不靠 title）。 */
async function heroHireIn(send, evaluate, tabLabel, extra = '') {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.clear(); } catch {}`,
  });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 844, height: 390, deviceScaleFactor: 1, mobile: true,
  });
  await send('Page.navigate', { url: `${BASE_URL}/?devquick=1&devtown=1${extra}` });
  for (let i = 0; i < 100; i++) {
    try { if (await evaluate(`!!document.querySelector('.town-meta')`)) break; } catch { /* 导航中 */ }
    await sleep(100);
  }
  return await evaluate(`(() => {
    const tab = [...document.querySelectorAll('.town-tabs .btn')]
      .find((b) => (b.textContent ?? '').trim() === ${JSON.stringify(tabLabel)});
    if (!tab) return { tab: false, hire: false, text: '' };
    tab.click();
    const row = document.querySelector('.town-pane .hero-hire');
    return { tab: true, hire: !!row, text: row ? (row.textContent ?? '') : '' };
  })()`);
}

/** 驻军页存量转换接线：切 tab → 数按钮 → 点第一个 → 看清单是否换帧；可带负向臂。 */
async function armyConvertIn(send, evaluate, extra = '') {
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.clear(); } catch {}`,
  });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 844, height: 390, deviceScaleFactor: 1, mobile: true,
  });
  await send('Page.navigate', { url: `${BASE_URL}/?devquick=1&devtown=1&devtier=3${extra}` });
  for (let i = 0; i < 100; i++) {
    try { if (await evaluate(`!!document.querySelector('.town-meta')`)) break; } catch { /* 导航中 */ }
    await sleep(100);
  }
  return await evaluate(`(() => {
    const tab = [...document.querySelectorAll('.town-tabs .btn')]
      .find((b) => (b.textContent ?? '').trim() === '驻军');
    if (!tab) return { tab: false, buttons: 0 };
    tab.click();
    const btns = [...document.querySelectorAll('.town-pane .stack-convert')];
    const before = [...document.querySelectorAll('.town-pane .rrow .un')].map((e) => e.textContent ?? '');
    const titles = btns.map((b) => b.title);
    const labels = btns.map((b) => (b.textContent ?? '').trim());
    const whyText = [...document.querySelectorAll('.town-pane .cv-why')].map((e) => e.textContent ?? '');
    const clicked = btns.find((b) => !b.disabled);
    if (clicked) clicked.click();
    // say() 重绘整个 pane：必须重新查 DOM，不能沿用旧引用
    const after = [...document.querySelectorAll('.town-pane .rrow .un')].map((e) => e.textContent ?? '');
    const note = document.querySelector('.town-note')?.textContent ?? '';
    return {
      tab: true,
      buttons: btns.length,
      enabled: btns.filter((b) => !b.disabled).length,
      titles, labels, whyText,
      changed: before.join('|') !== after.join('|'),
      before, after, note,
    };
  })()`);
}

try {
  const result = await withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Page.enable');
    await send('Runtime.enable');
    const a = await openTownAndScene(send, evaluate);
    if (!a.toggle || !a.scene) return { err: '城景入口/覆盖层没打开', a };
    const view = await evaluate(`(() => {
      const slots = [...document.querySelectorAll('.tv-world .tv-plot')];
      const imgs = slots.map((s) => s.querySelector('img')).filter(Boolean);
      const built = slots.filter((s) => s.dataset.plot !== '__castle' && s.classList.contains('built'));
      const unbuilt = slots.filter((s) => s.classList.contains('unbuilt'));
      const hot = document.querySelector('.tv-world .tv-castle-hot');
      const ofKind = (k) => imgs.filter((i) => i.dataset.kind === k);
      const rects = slots.map((s) => s.getBoundingClientRect());
      const depths = slots.map((s) => ({ y: parseFloat(s.style.top), z: +getComputedStyle(s).zIndex }));
      const depthOk = depths.every((a, i) => depths.every((b, j) =>
        a.y === b.y || (a.y < b.y) === (a.z < b.z)));
      const rendered = ofKind('building').map((i) => Math.round(i.getBoundingClientRect().width));
      return {
        slots: slots.length, built: built.length, unbuilt: unbuilt.length,
        castleHot: hot ? 1 : 0,
        castleHotFrame: hot?.dataset.frame ?? '',
        castleHotOnTop: hot ? +hot.style.zIndex || 0 : -1,
        buildingKind: ofKind('building').length,
        foundationKind: ofKind('foundation').length,
        castleKind: ofKind('castle').length,
        buildingOnUnbuilt: unbuilt.filter((s) => s.querySelector('img')?.dataset.kind === 'building').length,
        foundationSrcs: [...new Set(ofKind('foundation').map((i) => i.src))].length,
        natural: [...new Set(ofKind('building').map((i) => i.naturalWidth))],
        minRendered: Math.min(...rendered), maxRendered: Math.max(...rendered),
        outside: rects.filter((r) => r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1).length,
        depthOk,
        tier3: ofKind('building').filter((i) => (i.dataset.frame ?? '').includes('_u3')).length,
        sceneFrames: ofKind('building').filter((i) => (i.dataset.frame ?? '').startsWith('scene_p1_')).length,
        bg: (() => { const c = document.querySelector('.tv-bg'); return c ? c.width + 'x' + c.height : '-'; })(),
      };
    })()`);
    // 点一个已建成建筑 → 详情有名字；再点一个未建 → 详情有建造/升级按钮
    const detail = await evaluate(`(() => {
      const hot = document.querySelector('.tv-world .tv-castle-hot');
      hot?.click();
      const castleName = document.querySelector('.tv-detail-body strong')?.textContent ?? '';
      const castleBar = !!document.querySelector('.tv-castle-hot.selected');
      const built = document.querySelector('.tv-world .tv-plot.built[data-plot]:not([data-plot="__castle"])');
      if (!built) return { err: '没有已建建筑可点', castleName, castleBar };
      built.click();
      const nm = document.querySelector('.tv-detail-body strong')?.textContent ?? '';
      const art = document.querySelector('.tv-detail-art')?.dataset.frame ?? '';
      const un = document.querySelector('.tv-world .tv-plot.unbuilt');
      if (!un) return { err: '没有未建建筑可点', nm, art };
      un.click();
      const btn = [...document.querySelectorAll('.tv-detail .btn')].map((b) => b.textContent ?? '').join('/');
      const artKind = document.querySelector('.tv-detail-art')?.dataset.frame ?? '';
      return { nm, art, btn, artKind, castleName, castleBar, foundationSelected: !!document.querySelector('.tv-plot.unbuilt.selected') };
    })()`);
    if (SHOT_DIR) {
      mkdirSync(SHOT_DIR, { recursive: true });
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(path.join(SHOT_DIR, 'townview-844x390.png'), Buffer.from(shot.data, 'base64'));
    }
    // 负向臂：同一构建、关掉城景开关 ⇒ 入口必须不存在
    const n = await openTownAndScene(send, evaluate, '&devtownview=0');
    // 英雄招募：默认在「招募」页；市场页必须没有（负向臂 devhiretab=market 把入口退回旧页）
    const hireRecruit = await heroHireIn(send, evaluate, '招募');
    const hireMarket = await heroHireIn(send, evaluate, '市场·工坊');
    const hireNegRecruit = await heroHireIn(send, evaluate, '招募', '&devhiretab=market');
    const hireNegMarket = await heroHireIn(send, evaluate, '市场·工坊', '&devhiretab=market');
    const conv = await armyConvertIn(send, evaluate);
    const convNeg = await armyConvertIn(send, evaluate, '&devnoconvert=1');
    return { view, detail, neg: n, hireRecruit, hireMarket, hireNegRecruit, hireNegMarket, conv, convNeg };
  }, { port: cdpPort(9800, 150), devServerPort: APP_PORT });

  if (result.err) {
    record('U0', '城景能从城镇面板打开', false, `${result.err}（${JSON.stringify(result.a)}）`);
  } else {
    const v = result.view;
    record('U0', '城景能从城镇面板打开', true);
    record('U1', '16 块地 + 一个城堡热区，城堡不再另叠一张图', v.slots === 16 && v.castleHot === 1 &&
      v.castleKind === 0 && /_castle_/.test(v.castleHotFrame),
      `${v.slots} 地块 / 热区 ${v.castleHot} / 叠图 ${v.castleKind} / ${v.castleHotFrame}`);
    record('U2', '只画已建建筑：未建地块是同一张浅地基，没有偷画房子',
      v.built > 0 && v.unbuilt > 0 && v.buildingKind === v.built &&
      v.foundationKind === v.unbuilt && v.buildingOnUnbuilt === 0 &&
      v.foundationSrcs === 1,
      `built ${v.built} / unbuilt ${v.unbuilt} · 建筑帧 ${v.buildingKind} / 地基 ${v.foundationKind} / 错画 ${v.buildingOnUnbuilt}`);
    record('U3', '按 y 深度排序，844×390 下没有地块被裁掉，80px 源图落到 ≥44px',
      v.depthOk && v.outside === 0 && v.natural.length === 1 && v.natural[0] === 80 && v.minRendered >= 44,
      `depth=${v.depthOk} outside=${v.outside} natural=${v.natural.join(',')} rendered=${v.minRendered}~${v.maxRendered}`);
    record('U4', '已建地块全部用场景帧，等级帧确实接上',
      v.sceneFrames === v.built && v.tier3 > 0 && v.tier3 <= v.built,
      `scene=${v.sceneFrames}/${v.built} u3=${v.tier3}`);
    record('U5', '背景按舞台实际像素绘制', /^\d+x\d+$/.test(v.bg) && v.bg !== '320x180', v.bg);
    const d = result.detail;
    record('U6', '点已建出详情大图，点空地出建造/升级按钮',
      !d.err && !!d.nm && (d.art ?? '').startsWith('scene_') &&
      /建造|升级/.test(d.btn ?? '') && d.foundationSelected, JSON.stringify(d));
    record('U9', '点城堡热区选中城墙并出详情（不再是压在城门上的第二座城）',
      /城墙/.test(d.castleName ?? '') && d.castleBar === true, `detail=${d.castleName}`);
    record('N1', 'devtownview=0 负向对照：入口与城景都必须消失',
      result.neg && !result.neg.toggle && !result.neg.scene, JSON.stringify(result.neg));
    const hr = result.hireRecruit, hm = result.hireMarket;
    record('U7', '英雄招募在「招募」页、不在「市场·工坊」页',
      hr?.tab && hr.hire && hr.text.includes('招募英雄') && hm?.tab && !hm.hire,
      `招募=${hr?.hire} 市场=${hm?.hire}`);
    const nr = result.hireNegRecruit, nm = result.hireNegMarket;
    record('N2', 'devhiretab=market 负向对照：入口退回市场页',
      nr?.tab && !nr.hire && nm?.tab && nm.hire, `招募=${nr?.hire} 市场=${nm?.hire}`);
    const cv = result.conv;
    record('U8', '驻军页有转换按钮，造价写在脸上，点一下真的换成升级版',
      cv?.tab && cv.buttons > 0 && cv.enabled > 0 && cv.changed &&
      cv.labels.some((l) => /\d+\s*金/.test(l)),
      `按钮=${cv?.buttons} 可点=${cv?.enabled} 换帧=${cv?.changed} 标签=${JSON.stringify(cv?.labels)}`);
    record('N3', 'devnoconvert=1 负向对照：转换按钮一个都没有',
      result.convNeg?.tab && result.convNeg.buttons === 0, `按钮=${result.convNeg?.buttons}`);
  }
} catch (e) {
  record('U0', 'Chrome 前置/运行', false, `${e.message}${serverLog ? ` · ${serverLog.slice(-200)}` : ''}`);
} finally {
  server.kill('SIGKILL');
}

console.log(`\n合计：${fails === 0 ? '全过' : `${fails} 条 FAIL`}`);
if (GATE) process.exit(fails === 0 ? 0 : 1);
