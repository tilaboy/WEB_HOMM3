/**
 * 会生长的城市场景闸门（HOMM3 观感 · 2026-11-19 第二版重新设计）。
 *
 * 两层判据：
 *   ① **美术层**（纯 Node）：16 座 80×80 场景建筑按建筑原型重画（弧顶长屋 / 锯齿厂棚 /
 *      柱廊宅 / 圆塔 / 穹顶 / 平顶钟楼 / 水晶尖塔…），四族"结构同材质不同"、升级档改变剪影、
 *      **16 座两两 IoU <0.88**（上一版"12 座同款尖顶"必须转红）；底子新增城堡远景、主干道、
 *      广场与喷泉，四族底子在特征区域结构上不同；**16 座各有建材**（红瓦/茅草/石板/
 *      砖窑/铜绿/水晶…），阵营色退成旗、饰带与轻微偏色。负向臂 `sameShape` / `sameBase` /
 *      `noStreet` / `sameTone` 分别让建筑塌成同一张、底子塌成同一张、街道消失、
 *      建材塌回"一族一色"，证明判据测的是设计而不是"帧里有东西"。
 *   ② **接线/交互层**（真 Chrome）：844×390 横屏下从城镇面板打开城景，城堡 + 16 块地
 *      按 y 与远/中/近三档缩放落位；**只有已建的地块画建筑**，未建画浅地基，点两种地块都能出详情；
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
record('N0e', 'sameTone 负向对照：建材必须塌回"一族一色"（蓝顶白墙）',
  flatRoofUniq === 1 && flatWallUniq === 1, `屋顶 ${flatRoofUniq} 色 · 墙 ${flatWallUniq} 色`);
setSceneArtBreaks({ sameTone: false });

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
      const castle = slots.filter((s) => s.dataset.plot === '__castle');
      const ofKind = (k) => imgs.filter((i) => i.dataset.kind === k);
      const rects = slots.map((s) => s.getBoundingClientRect());
      const depths = slots.map((s) => ({ y: parseFloat(s.style.top), z: +getComputedStyle(s).zIndex }));
      const depthOk = depths.every((a, i) => depths.every((b, j) =>
        a.y === b.y || (a.y < b.y) === (a.z < b.z)));
      const rendered = ofKind('building').map((i) => Math.round(i.getBoundingClientRect().width));
      return {
        slots: slots.length, built: built.length, unbuilt: unbuilt.length, castle: castle.length,
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
        castleFrames: ofKind('castle').filter((i) => (i.dataset.frame ?? '').includes('_castle_')).length,
        bg: (() => { const c = document.querySelector('.tv-bg'); return c ? c.width + 'x' + c.height : '-'; })(),
      };
    })()`);
    // 点一个已建成建筑 → 详情有名字；再点一个未建 → 详情有建造/升级按钮
    const detail = await evaluate(`(() => {
      const built = document.querySelector('.tv-world .tv-plot.built[data-plot]:not([data-plot="__castle"])');
      if (!built) return { err: '没有已建建筑可点' };
      built.click();
      const nm = document.querySelector('.tv-detail-body strong')?.textContent ?? '';
      const art = document.querySelector('.tv-detail-art')?.dataset.frame ?? '';
      const un = document.querySelector('.tv-world .tv-plot.unbuilt');
      if (!un) return { err: '没有未建建筑可点', nm, art };
      un.click();
      const btn = [...document.querySelectorAll('.tv-detail .btn')].map((b) => b.textContent ?? '').join('/');
      const artKind = document.querySelector('.tv-detail-art')?.dataset.frame ?? '';
      return { nm, art, btn, artKind, foundationSelected: !!document.querySelector('.tv-plot.unbuilt.selected') };
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
    record('U1', '城堡 + 16 块地都在场景里', v.slots === 17 && v.castle === 1 && v.castleFrames === 1,
      `${v.slots} 槽 / ${v.castle} 城堡`);
    record('U2', '只画已建建筑：未建地块是同一张浅地基，没有偷画房子',
      v.built > 0 && v.unbuilt > 0 && v.buildingKind === v.built &&
      v.foundationKind === v.unbuilt && v.buildingOnUnbuilt === 0 &&
      v.foundationSrcs === 1,
      `built ${v.built} / unbuilt ${v.unbuilt} · 建筑帧 ${v.buildingKind} / 地基 ${v.foundationKind} / 错画 ${v.buildingOnUnbuilt}`);
    record('U3', '按 y 深度排序，844×390 下没有地块被裁掉，80px 源图落到 ≥44px',
      v.depthOk && v.outside === 0 && v.natural.length === 1 && v.natural[0] === 80 && v.minRendered >= 44,
      `depth=${v.depthOk} outside=${v.outside} natural=${v.natural.join(',')} rendered=${v.minRendered}~${v.maxRendered}`);
    record('U4', '已建地块全部用场景帧，等级帧确实接上',
      v.sceneFrames === v.built && v.castleKind === 1 && v.tier3 > 0 && v.tier3 <= v.built,
      `scene=${v.sceneFrames}/${v.built} u3=${v.tier3}`);
    record('U5', '背景按舞台实际像素绘制', /^\d+x\d+$/.test(v.bg) && v.bg !== '320x180', v.bg);
    const d = result.detail;
    record('U6', '点已建出详情大图，点空地出建造/升级按钮',
      !d.err && !!d.nm && (d.art ?? '').startsWith('scene_') &&
      /建造|升级/.test(d.btn ?? '') && d.foundationSelected, JSON.stringify(d));
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
