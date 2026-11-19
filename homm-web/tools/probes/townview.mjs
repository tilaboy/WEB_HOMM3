/**
 * 城内一览闸门（M9）。
 *
 * 两层判据：
 *   ① **美术层**（纯 Node）：16 座 88×88 大图、四族"结构同材质不同"、升级帧确有体量差、
 *      四张背景不重样；负向对照 `sameShape` 必须让大图塌成同一张。
 *   ② **接线/交互层**（真 Chrome）：844×390 横屏下从城镇面板打开城景，16 座 + 城堡
 *      全在槽位里、按等级换 `data-frame`、点选出现详情、未建/已建双态都在；
 *      `?devtownview=0` 负向臂必须看不到入口（证明判测的是新视图）。
 *   ③ **英雄招募接线**：默认在「招募」页、`市场·工坊` 页没有；`?devhiretab=market`
 *      负向臂把它退回旧页，两条判据都必须翻转（证明测的是页签位置而不是字样）。
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
requireFile(DIST, 'render/townViewArt.js');
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
const { TOWN_BUILDING_IDS, buildTownBuilding, buildTownSceneBg, townBuildingFrameName } =
  await import(u('render/townViewArt.js'));
const { setBuildingArtBreaks } = await import(u('render/buildingArt.js'));
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

const big = new Map();
for (const owner of OWNERS) for (const id of TOWN_BUILDING_IDS) {
  const pb = buildTownBuilding(owner, id, 1);
  big.set(`${owner}/${id}`, pb);
}
record('T0', `16 座 × 4 族 = 64 张 88×88 大图，无空帧`,
  big.size === 64 && [...big.values()].every((pb) => pb.w === 88 && pb.h === 88 && areaOf(maskOf(pb)) > 200),
  `${big.size} 帧`);

let maskSame = 0, colorSplit = 0;
for (const id of TOWN_BUILDING_IDS) {
  const masks = OWNERS.map((o) => maskOf(big.get(`${o}/${id}`)));
  if (masks.slice(1).every((m) => iouOf(masks[0], m) === 1)) maskSame++;
  const cs = OWNERS.map((o) => meanColor(big.get(`${o}/${id}`)));
  let min = Infinity;
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    min = Math.min(min, Math.hypot(...cs[i].map((v, k) => v - cs[j][k])));
  }
  if (min >= 6) colorSplit++;
}
record('T1', '四族结构逐像素相同（只换材质）', maskSame === 16, `${maskSame}/16`);
record('T2', '四族材质确实分开（最近两族色距 ≥6）', colorSplit === 16, `${colorSplit}/16`);

const l1 = buildTownBuilding('p1', 'dwell3', 1);
const l3 = buildTownBuilding('p1', 'dwell3', 3);
const a1 = areaOf(maskOf(l1)), a3 = areaOf(maskOf(l3));
const iou13 = iouOf(maskOf(l1), maskOf(l3));
record('T3', '升级后体量变大且不是同一张（L3 面积 > L1、IoU <0.95）',
  a3 > a1 && iou13 < 0.95, `${a1}→${a3} · IoU ${iou13.toFixed(3)}`);

const bgs = OWNERS.map((o) => buildTownSceneBg(o, 760, 300));
const bgColors = bgs.map((pb) => {
  const s = new Set();
  for (let i = 0; i < pb.w * pb.h; i += 97) {
    const p = pb.px(i % pb.w, (i / pb.w) | 0);
    s.add((p[0] << 16) | (p[1] << 8) | p[2]);
  }
  return s.size;
});
record('T4', '四张 760×300 背景不透明且不是纯色块',
  bgs.every((b) => b.w === 760 && b.h === 300) && bgColors.every((n) => n > 12),
  `抽样色数 ${bgColors.join('/')}`);

setBuildingArtBreaks({ sameShape: true });
const flat1 = maskOf(buildTownBuilding('p1', 'tavern', 1));
const flat2 = maskOf(buildTownBuilding('p1', 'market', 1));
const flatIoU = iouOf(flat1, flat2);
record('N0', 'sameShape 负向对照：大图必须塌成同一张（IoU >0.95）', flatIoU > 0.95, `IoU ${flatIoU.toFixed(3)}`);
setBuildingArtBreaks({ sameShape: false });

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

try {
  const result = await withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Page.enable');
    await send('Runtime.enable');
    const a = await openTownAndScene(send, evaluate);
    if (!a.toggle || !a.scene) return { err: '城景入口/覆盖层没打开', a };
    const view = await evaluate(`(() => {
      const slots = [...document.querySelectorAll('.tv-grid .tv-slot')];
      const buildingImgs = slots.filter((s) => !s.classList.contains('tv-castle'))
        .map((s) => s.querySelector('img')).filter(Boolean);
      const imgs = slots.map((s) => s.querySelector('img')).filter(Boolean);
      const frames = buildingImgs.map((i) => i.dataset.frame ?? '');
      const cols = getComputedStyle(document.querySelector('.tv-grid')).gridTemplateColumns.split(' ').length;
      const natural = [...new Set(buildingImgs.map((i) => i.naturalWidth))];
      const rendered = buildingImgs.map((i) => Math.round(i.getBoundingClientRect().width));
      return {
        slots: slots.length, built: slots.filter((s) => s.classList.contains('built')).length,
        unbuilt: slots.filter((s) => s.classList.contains('unbuilt')).length,
        cols, natural, minRendered: Math.min(...rendered), maxRendered: Math.max(...rendered),
        tier3: frames.filter((f) => f.includes('_u3')).length,
        castleFrames: slots.filter((s) => s.classList.contains('tv-castle'))
          .flatMap((s) => [...s.querySelectorAll('img')]).filter((i) => (i.dataset.frame ?? '').includes('_castle_')).length,
        townFrames: frames.filter((f) => f.startsWith('tv_p1_')).length,
        bg: (() => { const c = document.querySelector('.tv-bg'); return c ? c.width + 'x' + c.height : '-'; })(),
      };
    })()`);
    // 点一个已建成建筑 → 详情有名字；再点一个未建 → 详情有建造/升级按钮
    const detail = await evaluate(`(() => {
      const built = document.querySelector('.tv-slot.built:not(.tv-castle)');
      if (!built) return { err: '没有已建建筑可点' };
      built.click();
      const nm = document.querySelector('.tv-detail-body strong')?.textContent ?? '';
      const art = document.querySelector('.tv-detail-art')?.dataset.frame ?? '';
      const un = document.querySelector('.tv-slot.unbuilt');
      if (!un) return { err: '没有未建建筑可点', nm, art };
      un.click();
      const btn = [...document.querySelectorAll('.tv-detail .btn')].map((b) => b.textContent ?? '').join('/');
      return { nm, art, btn };
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
    return { view, detail, neg: n, hireRecruit, hireMarket, hireNegRecruit, hireNegMarket };
  }, { port: cdpPort(9800, 150), devServerPort: APP_PORT });

  if (result.err) {
    record('U0', '城景能从城镇面板打开', false, `${result.err}（${JSON.stringify(result.a)}）`);
  } else {
    const v = result.view;
    record('U0', '城景能从城镇面板打开', true);
    record('U1', '16 座建筑 + 城堡都在槽位里', v.slots === 17 && v.castleFrames === 1, `${v.slots} 槽 / ${v.castleFrames} 城堡`);
    record('U2', '已建/未建双态同时可见', v.built > 0 && v.unbuilt > 0, `built ${v.built} / unbuilt ${v.unbuilt}`);
    record('U3', '八列网格 + 88px 源图（手机横屏渲染 ≥44px）',
      v.cols === 8 && v.natural.length === 1 && v.natural[0] === 88 && v.minRendered >= 44,
      `cols=${v.cols} natural=${v.natural.join(',')} rendered=${v.minRendered}~${v.maxRendered}`);
    record('U4', '等级帧真的接上了（devtier=3 ⇒ 五座 _u3）', v.tier3 === 5 && v.townFrames === 16,
      `u3=${v.tier3} townFrames=${v.townFrames}`);
    record('U5', '背景按舞台实际像素绘制', /^\d+x\d+$/.test(v.bg) && v.bg !== '320x180', v.bg);
    const d = result.detail;
    record('U6', '点建筑出详情（名字 + 大图 + 建造/升级按钮）',
      !d.err && !!d.nm && !!d.art && /建造|升级/.test(d.btn), JSON.stringify(d));
    record('N1', 'devtownview=0 负向对照：入口与城景都必须消失',
      result.neg && !result.neg.toggle && !result.neg.scene, JSON.stringify(result.neg));
    const hr = result.hireRecruit, hm = result.hireMarket;
    record('U7', '英雄招募在「招募」页、不在「市场·工坊」页',
      hr?.tab && hr.hire && hr.text.includes('招募英雄') && hm?.tab && !hm.hire,
      `招募=${hr?.hire} 市场=${hm?.hire}`);
    const nr = result.hireNegRecruit, nm = result.hireNegMarket;
    record('N2', 'devhiretab=market 负向对照：入口退回市场页',
      nr?.tab && !nr.hire && nm?.tab && nm.hire, `招募=${nr?.hire} 市场=${nm?.hire}`);
  }
} catch (e) {
  record('U0', 'Chrome 前置/运行', false, `${e.message}${serverLog ? ` · ${serverLog.slice(-200)}` : ''}`);
} finally {
  server.kill('SIGKILL');
}

console.log(`\n合计：${fails === 0 ? '全过' : `${fails} 条 FAIL`}`);
if (GATE) process.exit(fails === 0 ? 0 : 1);
