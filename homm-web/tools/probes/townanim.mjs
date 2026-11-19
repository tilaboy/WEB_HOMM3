/**
 * 城景动画闸门（2026-11-19 第五轮：城"活着"）。
 *
 * 第五轮要证的不是"画得好看"，而是**画面在动，而且动的是该动的东西**。
 * 这条判据特别容易假绿：把整帧重画一遍、相位随机抖动、或者干脆整座建筑换一张图，
 * 帧间差都会 >0。所以这里同时钉三件事：
 *
 *   ① **该动的动**：旗面、烟、水车、法尘 —— 8 帧互不相同；
 *   ② **不该动的不动**：Lv.1 的 8 座（市场/木栅/石墙/长屋/排屋/柱廊宅/两座行会）
 *      一帧都不许变（这是脚本自带的负向对照：判据不是"帧里有东西"）；
 *   ③ **动的是局部**：旗杆整列 8 帧逐像素相同、水车轮毂 2×2 逐像素相同
 *      —— 证明是"旗在飘/轮在转"，不是"整座建筑被平移或换图"。
 *
 * 另外钉住两个渲染陷阱（第四轮踩过的那类）：
 *   · 半透明特效必须在 `outline()` **之后**画，否则烟圈会被墨线焊成一个灰泡泡
 *     —— `fxBeforeOutline` 负向臂让烟区的墨色像素从 0 涨到 400+；
 *   · 底子的动效**不能整帧重烘**（832×275 一张 0.9 MB、p1 一次 12 ms × 8 帧）
 *     —— 所以特效是独立精灵，锚点由底图生成时记录，`noStreet` 抽掉街道时
 *     喷泉与路灯的锚点必须一起消失。
 *
 * 浏览器层（844×390 真 Chrome）：
 *   [U1] 开城景后相位真的在推进，已建的 `<img>` 换图；
 *   [U2] 特效层画布不是空白、且在变（喷泉/火把/旗面）；
 *   [U3] 动画期间 DOM 不重建：16 块地还在、点已建仍能出详情；
 *   [U4] `?devtownanim=0` 负向臂 —— 相位恒 0、图不换、特效层两次采样完全相同；
 *   [U5] `prefers-reduced-motion: reduce` 同 U4（系统级减动效，不是第二个开关）。
 *
 * 用法：node tools/probes/townanim.mjs [--gate] [--shot=<dir>]
 * 退出码：不给 --gate 只报读数；给 --gate 时 0=全过 / 1=FAIL / 2=前置不满足。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { argOf, distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';
import { installShim } from '../_canvas.mjs';
import { withHeadlessChrome, cdpPort } from '../_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=townanim');
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
  SCENE_ANIM_FRAMES,
  TOWN_BUILDING_IDS,
  TOWN_FX_SPRITES,
  buildSceneBuilding,
  buildTownScene,
  buildTownFxSprite,
  setSceneArtBreaks,
} = await import(u('render/townSceneArt.js'));

const OWNERS = ['p1', 'p2', 'p3', 'p4'];
/** Lv.1 时**不该动**的 8 座（没有旗、没有烟、没有轮）。 */
const STATIC_T1 = ['market', 'wall1', 'wall2', 'dwell1', 'dwell3', 'dwell4', 'guild1', 'guild2'];

const alphaOf = (pb, x, y) => pb.alphaAt(x, y);
const diffPixels = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.d.length; i += 4) {
    if (a.d[i] !== b.d[i] || a.d[i + 1] !== b.d[i + 1] || a.d[i + 2] !== b.d[i + 2] || a.d[i + 3] !== b.d[i + 3]) n++;
  }
  return n;
};
const opaqueCount = (pb) => {
  let n = 0;
  for (let i = 3; i < pb.d.length; i += 4) if (pb.d[i] > 8) n++;
  return n;
};
const framesOf = (owner, id, tier) =>
  Array.from({ length: SCENE_ANIM_FRAMES }, (_, k) => buildSceneBuilding(owner, id, tier, k));
/** 与第 0 帧的最大逐像素差。 */
const maxSpread = (frames) => frames.slice(1).reduce((m, f) => Math.max(m, diffPixels(frames[0], f)), 0);

/* [A0] 8 相位 × 16 座 × 4 族 × 两档：每帧非空，动画不画出画布 */
{
  let empty = 0, clipped = 0, minPx = 1e9;
  const bad = [];
  for (const owner of OWNERS) {
    for (const id of TOWN_BUILDING_IDS) {
      for (const tier of [1, 3]) {
        const frames = framesOf(owner, id, tier);
        for (const f of frames) {
          const n = opaqueCount(f);
          minPx = Math.min(minPx, n);
          if (n < 300) empty++;
        }
        // 帧间差的包围盒不许贴到 1px 边框：贴到就是"动画被画布裁了"
        let x0 = 99, x1 = -1, y0 = 99, y1 = -1;
        for (let k = 1; k < frames.length; k++) {
          for (let y = 0; y < 80; y++) {
            for (let x = 0; x < 80; x++) {
              const i = (y * 80 + x) * 4;
              const a = frames[0].d, b = frames[k].d;
              if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3]) continue;
              x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
            }
          }
        }
        if (x1 >= 0 && (x0 < 1 || y0 < 1 || x1 > 78 || y1 > 78)) {
          clipped++;
          if (bad.length < 3) bad.push(`${owner}/${id}/L${tier} bbox ${x0},${y0}~${x1},${y1}`);
        }
      }
    }
  }
  record('A0', '8 相位 × 16 座 × 4 族 × 两档：帧都非空，动画没有被画布裁掉',
    empty === 0 && clipped === 0,
    `空帧 ${empty} · 贴边 ${clipped} · 最少不透明像素 ${minPx}${bad.length ? ` · ${bad.join(' / ')}` : ''}`);
}

/* [A1] Lv.1 的动画覆盖表：该动的动、不该动的**一像素都不许动** */
{
  const spreads = Object.fromEntries(TOWN_BUILDING_IDS.map((id) => [id, maxSpread(framesOf('p1', id, 1))]));
  const staticMoved = STATIC_T1.filter((id) => spreads[id] !== 0);
  const animStill = TOWN_BUILDING_IDS.filter((id) => !STATIC_T1.includes(id) && spreads[id] < 20);
  record('A1', 'Lv.1：8 座该动的都动了（≥20px），8 座没有动效的一像素都没变',
    staticMoved.length === 0 && animStill.length === 0,
    `静止却有差 ${JSON.stringify(staticMoved)} · 该动却没动 ${JSON.stringify(animStill)} · ` +
    Object.entries(spreads).map(([k, v]) => `${k}:${v}`).join(' '));
}

/* [A2] Lv.3：16/16 都有动效（升级档每座都加了冠旗），最小帧差 ≥12 */
{
  const spreads = TOWN_BUILDING_IDS.map((id) => maxSpread(framesOf('p1', id, 3)));
  const min = Math.min(...spreads);
  record('A2', 'Lv.3：16 座全部有动效，最小帧差 ≥12px',
    spreads.every((s) => s >= 12), `min ${min} · ${spreads.join(',')}`);
}

/* [A3] 烟必须**成缕**：竖向跨度 ≥8px、相邻帧都在变、且不是 2 周期（原地蹦的 bug） */
{
  const boxes = { tavern: [4, 32], workshop: [48, 78], dwell2: [20, 44] };
  const rows = [];
  let ok = true;
  for (const [id, [x0, x1]] of Object.entries(boxes)) {
    const frames = framesOf('p1', id, 1);
    const spans = [], adj = [], two = [];
    for (let k = 0; k < frames.length; k++) {
      let mn = 999, mx = -1, n = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = x0; x < x1; x++) {
          const a = alphaOf(frames[k], x, y);
          if (a > 8 && a < 250) { mn = Math.min(mn, y); mx = Math.max(mx, y); n++; }
        }
      }
      spans.push(n ? mx - mn : 0);
      adj.push(diffPixels(frames[k], frames[(k + 1) % 8]));
      two.push(diffPixels(frames[k], frames[(k + 2) % 8]));
    }
    const minSpan = Math.min(...spans);
    const minAdj = Math.min(...adj);
    const period2 = two.filter((d) => d < 10).length;
    const pass = minSpan >= 8 && minAdj >= 20 && period2 === 0;
    if (!pass) ok = false;
    rows.push(`${id} 跨度${minSpan} 邻帧${minAdj} 二周期${period2}`);
  }
  record('A3', '烟成缕：竖向跨度 ≥8px、每对相邻帧都不同、且不是 2 周期（原地蹦）', ok, rows.join(' · '));
}

/* [A4] 水车：轮毂 2×2 八帧逐像素相同，轮辐区域每帧都在变（转，而不是整体挪） */
{
  const frames = framesOf('p1', 'workshop', 1);
  const hub = new Set(), rim = new Set();
  for (const f of frames) {
    let s = '';
    for (let y = 61; y < 63; y++) for (let x = 69; x < 71; x++) s += f.px(x, y).join('/') + ';';
    hub.add(s);
    // 轮辐是**不透明**的：只数 alpha 会把八帧读成同一张（整只轮子都覆盖着）
    let r = '';
    for (let y = 53; y < 72; y++) for (let x = 60; x < 80; x++) r += f.px(x, y).join(',') + '.';
    rim.add(r);
  }
  const wheelDiff = diffPixels(frames[0], frames[4]);
  record('A4', '水车在转：轮毂 8 帧不变，轮辐 8 帧互不相同',
    hub.size === 1 && rim.size === 8 && wheelDiff >= 80,
    `轮毂 ${hub.size} 种 / 轮辐 ${rim.size} 种 / 0↔4 帧差 ${wheelDiff}px`);
}

/* [A5] 旗：杆整列八帧相同，旗面每帧不同（旗在飘，杆没动） */
{
  const frames = framesOf('p1', 'dwell5', 1);
  const pole = new Set();
  for (const f of frames) {
    let s = '';
    for (let y = 12; y < 29; y++) s += f.px(40, y).join('/') + ';';
    pole.add(s);
  }
  let cloth = 0;
  for (let k = 1; k < frames.length; k++) {
    for (let y = 10; y < 22; y++) for (let x = 41; x < 56; x++) {
      if (frames[0].px(x, y).join() !== frames[k].px(x, y).join()) cloth++;
    }
  }
  record('A5', '旗在飘、杆没动：旗杆整列 8 帧逐像素相同，旗面累计变化 ≥60px',
    pole.size === 1 && cloth >= 60, `杆 ${pole.size} 种 / 旗面累计 ${cloth}px`);
}

/* [A6] 半透明特效必须在描边之后：烟区墨色像素 = 0；负向臂挪到描边前必须 >200 */
{
  const OUTLINE = [36, 28, 18];
  const inkInSmoke = () => {
    let n = 0;
    for (let k = 0; k < 8; k++) {
      const f = buildSceneBuilding('p1', 'tavern', 1, k);
      for (let y = 0; y < 20; y++) for (let x = 4; x < 32; x++) {
        const p = f.px(x, y);
        if (p[0] === OUTLINE[0] && p[1] === OUTLINE[1] && p[2] === OUTLINE[2]) n++;
      }
    }
    return n;
  };
  const normal = inkInSmoke();
  setSceneArtBreaks({ fxBeforeOutline: true });
  const broken = inkInSmoke();
  setSceneArtBreaks({ fxBeforeOutline: false });
  record('A6', '烟/光晕画在描边之后：烟区墨色像素 0；挪到描边前必须涨到 200+',
    normal === 0 && broken > 200, `正常 ${normal} · 负向 ${broken}`);
}

/* [A7] 底子动效锚点：族相关；`noStreet` 抽掉喷泉与路灯；精灵 8 帧都有差 */
{
  const kindsOf = (owner, breaks = {}) => {
    setSceneArtBreaks(breaks);
    const { fx } = buildTownScene(owner, 832, 275);
    setSceneArtBreaks({ noStreet: false });
    const by = {};
    for (const s of fx) by[s.k] = (by[s.k] ?? 0) + 1;
    return by;
  };
  const p1 = kindsOf('p1'), p2 = kindsOf('p2'), p3 = kindsOf('p3'), p4 = kindsOf('p4');
  const noStreet = kindsOf('p1', { noStreet: true });
  const baseOk = p1.flagCloth === 7 && p1.torch === 2 && p1.lamp === 4 && p1.fountain === 1 &&
    p2.fire === 2 && p4.crystal === 2 && p3.fire === undefined &&
    noStreet.fountain === undefined && noStreet.lamp === undefined && noStreet.flagCloth === 7;

  const spriteSpreads = {};
  for (const kind of Object.keys(TOWN_FX_SPRITES)) {
    const f0 = buildTownFxSprite('p1', kind, 0, { len: 12 });
    let mx = 0;
    for (let k = 1; k < 8; k++) mx = Math.max(mx, diffPixels(f0, buildTownFxSprite('p1', kind, k, { len: 12 })));
    spriteSpreads[kind] = { mx, px: opaqueCount(f0) };
  }
  const spritesOk = Object.values(spriteSpreads).every((s) => s.mx > 0 && s.px > 10);

  setSceneArtBreaks({ noAnim: true });
  const frozen = buildTownFxSprite('p1', 'fountain', 5, { len: 12 });
  const frozen0 = buildTownFxSprite('p1', 'fountain', 0, { len: 12 });
  const frozenDiff = diffPixels(frozen, frozen0);
  setSceneArtBreaks({ noAnim: false });

  record('A7', '底子动效锚点：7 旗 + 2 火把 + 4 路灯 + 喷泉；火山加篝火、神殿加水晶；noStreet 抽掉喷泉/路灯',
    baseOk, `p1 ${JSON.stringify(p1)} · p2 ${JSON.stringify(p2)} · p4 ${JSON.stringify(p4)} · noStreet ${JSON.stringify(noStreet)}`);
  record('A8', '6 类特效精灵逐帧都有变化（>0px）、都有实体；noAnim 负向臂把喷泉帧差打到 0',
    spritesOk && frozenDiff === 0,
    Object.entries(spriteSpreads).map(([k, v]) => `${k}:${v.mx}px/${v.px}`).join(' ') + ` · noAnim 帧差 ${frozenDiff}`);
}

/* [A9] 8 帧互不相同（不是 2 帧来回切） */
{
  const seen = new Set(framesOf('p1', 'tavern', 3).map((f) => f.d.join(',')));
  record('A9', 'Lv.3 酒馆的 8 个相位互不相同', seen.size === 8, `${seen.size}/8 张不同`);
}

if (SHOT_DIR) {
  mkdirSync(SHOT_DIR, { recursive: true });
}

/* ================================================================ 接线层 */
const APP_PORT = 39900 + (process.pid % 150);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const server = spawn('node', [path.join(ROOT, 'tools', 'serve.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT: String(APP_PORT) }, stdio: ['ignore', 'ignore', 'pipe'],
});
let serverLog = '';
server.stderr.on('data', (d) => { serverLog += d.toString(); });
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(BASE_URL)).ok) break; } catch { /* 还没起 */ }
  await sleep(100);
}

async function openScene(send, evaluate, extra = '', before = null) {
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  if (before) await before();
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); } catch {}` });
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

const sampleScene = `(() => {
  const ov = document.querySelector('.townview');
  const imgs = [...document.querySelectorAll('.tv-plot.built img')];
  const fx = document.querySelector('.tv-fx');
  let fxStat = { n: 0, h: 0 };
  if (fx && fx.width) {
    const d = fx.getContext('2d').getImageData(0, 0, fx.width, fx.height).data;
    let h = 0, n = 0;
    for (let i = 3; i < d.length; i += 4) { if (d[i] > 8) { n++; h = (h * 31 + i + d[i]) >>> 0; } }
    fxStat = { n, h };
  }
  return {
    phase: ov?.dataset.phase ?? '',
    srcs: imgs.map((i) => i.src.length + ':' + i.src.slice(-40)),
    imgPhases: [...new Set(imgs.map((i) => i.dataset.phase ?? ''))],
    plots: document.querySelectorAll('.tv-world .tv-plot').length,
    fxStat,
  };
})()`;

try {
  const result = await withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Page.enable');
    await send('Runtime.enable');

    /* ---- U1/U2/U3：默认开动画 ---- */
    const a = await openScene(send, evaluate);
    if (!a.toggle || !a.scene) return { err: '城景没打开', a };
    const s0 = await evaluate(sampleScene);
    await sleep(1100);
    const s1 = await evaluate(sampleScene);
    await sleep(600);
    const s2 = await evaluate(sampleScene);
    const detail = await evaluate(`(() => {
      const built = document.querySelector('.tv-world .tv-plot.built[data-plot]:not([data-plot="__castle"])');
      if (!built) return { err: '没有已建建筑' };
      built.click();
      return { nm: document.querySelector('.tv-detail-body strong')?.textContent ?? '',
               art: document.querySelector('.tv-detail-art')?.dataset.frame ?? '' };
    })()`);
    if (SHOT_DIR) {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(path.join(SHOT_DIR, 'townanim-844x390.png'), Buffer.from(shot.data, 'base64'));
    }

    /* ---- U4：?devtownanim=0 负向臂 ---- */
    const off = await openScene(send, evaluate, '&devtownanim=0');
    const o0 = await evaluate(sampleScene);
    await sleep(1100);
    const o1 = await evaluate(sampleScene);

    /* ---- U5：prefers-reduced-motion: reduce ---- */
    const rm = await openScene(send, evaluate, '', async () => {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    });
    const r0 = await evaluate(sampleScene);
    await sleep(1100);
    const r1 = await evaluate(sampleScene);
    await send('Emulation.setEmulatedMedia', { features: [] });

    return { s0, s1, s2, detail, off, o0, o1, rm, r0, r1 };
  }, { port: cdpPort(9820, 150), devServerPort: APP_PORT });

  if (result.err) {
    record('U0', '城景能从城镇面板打开', false, `${result.err}（${JSON.stringify(result.a)}）`);
  } else {
    const { s0, s1, s2, detail, off, o0, o1, rm, r0, r1 } = result;
    const changed = (a, b) => a.srcs.filter((s, i) => s !== b.srcs[i]).length;
    record('U0', '城景能从城镇面板打开', true);
    record('U1', '相位在推进、已建建筑换图，img 上的相位与覆盖层一致',
      +s1.phase > 0 && +s2.phase !== +s1.phase && changed(s1, s2) >= 2 &&
      s2.imgPhases.length === 1 && s2.imgPhases[0] === s2.phase,
      `相位 ${s0.phase}→${s1.phase}→${s2.phase} · 换图 ${changed(s1, s2)}/${s2.srcs.length} · img 相位 ${JSON.stringify(s2.imgPhases)}`);
    record('U2', '特效层不是空白且在变（旗面/火把/喷泉）',
      s1.fxStat.n > 600 && s1.fxStat.h !== s2.fxStat.h,
      `像素 ${s1.fxStat.n} · 哈希 ${s1.fxStat.h}→${s2.fxStat.h}`);
    record('U3', '动画期间 DOM 不重建：16 块地都在，点已建仍出详情',
      s2.plots === 16 && !detail.err && !!detail.nm && /^scene_/.test(detail.art),
      `地块 ${s2.plots} · 详情「${detail.nm}」${detail.art}`);
    record('U4', 'devtownanim=0 负向臂：相位恒 0、不换图、特效层两次采样完全相同',
      off.toggle && off.scene && o1.phase === '0' && changed(o0, o1) === 0 &&
      o1.imgPhases.every((p) => p === '0') && o0.fxStat.h === o1.fxStat.h,
      `相位 ${o0.phase}→${o1.phase} · 换图 ${changed(o0, o1)} · fx ${o0.fxStat.h}→${o1.fxStat.h}`);
    record('U5', 'prefers-reduced-motion: reduce 也停：相位恒 0、不换图',
      rm.toggle && rm.scene && r1.phase === '0' && changed(r0, r1) === 0 && r0.fxStat.h === r1.fxStat.h,
      `相位 ${r0.phase}→${r1.phase} · 换图 ${changed(r0, r1)}`);
  }
} catch (e) {
  record('U0', 'Chrome 前置/运行', false, `${e.message}${serverLog ? ` · ${serverLog.slice(-200)}` : ''}`);
} finally {
  server.kill('SIGKILL');
}

console.log(`\n合计：${fails === 0 ? '全过' : `${fails} 条 FAIL`}`);
if (GATE) process.exit(fails === 0 ? 0 : 1);
