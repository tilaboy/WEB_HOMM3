#!/usr/bin/env node
/**
 * reachshot.mjs —— 可达层「形态」对照台（`?devdots=all` / `?devband=shade` / `?devtint=0`）。
 *
 * ## 它回答什么
 * 2026-10-23 把默认从 `shade`（整格蓝洗 + 外圈压暗）翻成 `dots`（只描外缘的格心点）之后，
 * 报告里必须给出**同一机位**的形态对照，否则"更好看了"只是一句话。本工具出四臂：
 *   · `default` —— 现网：外缘点阵；
 *   · `all`     —— 每格一枚（被否掉的形态，留在代码里当反例）；
 *   · `shade`   —— 上一版默认（整格压暗）；
 *   · `none`    —— 整层不画（`?devtint=0`，量"这一层到底贡献了什么"）。
 *
 * ## 口径（不自创，抄的是 bandab 的规矩）
 *   · 四臂**同构建 / 同一浏览器进程 / 同一次运行**，只切一个查询参数；
 *   · 时钟钉常数 + 冻 `rAF`（水面相位、英雄起伏都读 `performance.now()`）⇒ 同内容可复现；
 *   · 裁切口径**由点自己给**：取 `__mapReachProbe().per[].px/py`（渲染器在同一帧取色时算的
 *     device px），求包围盒后**四臂共用同一个 clip** —— 不另猜镜头，也不会"四臂各裁一块"；
 *   · 特写用 `Page.captureScreenshot` 的 `clip.scale=3`（直接出 3× 图，不靠 sips 二次裁，
 *     避免"逻辑 px / device px"再一次算错 —— 这坑在 §14 已经踩过）。
 *
 * ## 用法
 *   node tools/reachshot.mjs --out=../production/render-reachdots
 *   node tools/reachshot.mjs --out=/tmp/reach --light=0.9     # 换个光照相位再拍
 *
 * 退出码：0 = 四臂都量到 · 1 = 有臂量不到 · 2 = 前置不满足
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { argOf, distDir, printHeader, requireFile, freePort, serveInProcess } from './_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from './_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'tool=reachshot');
requireFile(DIST, 'render/MapRenderer.js');
if (!chromeAvailable()) {
  console.error('✗ 前置不满足：找不到 Chrome（可用 env CHROME 覆盖）。');
  process.exit(2);
}

const OUT = argOf('out', null);
const LIGHT = argOf('light', '0.22');
const SEED = argOf('seed', '20260917');
const VW = Number(argOf('vw', '844'));
const VH = Number(argOf('vh', '390'));
const DPR = Number(argOf('dpr', '2'));
const ZOOM = Number(argOf('zoom', '3'));
if (OUT) mkdirSync(OUT, { recursive: true });

const PORT = await freePort();
if (!(await serveInProcess(DIST, PORT))) {
  console.error(`✗ 前置不满足：自起 dev server 未就绪（port ${PORT}）。`);
  process.exit(2);
}
/* `--extra=` 追加查询串：专门用来拍"同机位的旧路径"（`--extra=&devpathafter=0`）等对照臂。
 * 注意 shell 引用：`--extra='&devpathafter=0'`（不加引号会被 shell 截成后台任务）。
 * 首版没有这个参数时，两臂拿到**同一个 URL** ⇒ `pathafter=0` 从未生效、两张特写逐位相同 ——
 * 又一次"两臂读数一样"的假通过（与 §15.6 的补拍错事同型）。 */
const EXTRA = argOf('extra', '');
const BASE =
  `http://127.0.0.1:${PORT}/index.html?devquick=1&devreveal=1&devprobe=1&devbandstats=1&devreachprobe=1` +
  `&devseed=${SEED}&devlight=${LIGHT}${EXTRA}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIXED_NOW = 1000;
const FREEZE = `(() => {
  if (!window.__reachShotFrozen) {
    try { performance.now = () => ${FIXED_NOW}; } catch (e) {}
    window.requestAnimationFrame = () => 0;
    window.__reachShotFrozen = true;
  }
  return true;
})()`;

/** 四臂：查询串后缀（default 为空串，但 `devdots=edge` 也显式可写）。 */
const ARMS = [
  ['default', ''],
  ['all', '&devdots=all'],
  ['shade', '&devband=shade'],
  ['none', '&devtint=0'],
];

/** 摆一条真实的预览路径（挑一枚可达点当终点，走 `main.ts` 的 `__mapPreviewTo`）。
 *  返回 {tx,ty,n} 或 null —— 截图标题里要写"到哪一格"，否则看图的人不知道该看哪条线。 */
const PREVIEW_REACH = `(() => {
  const m = window.__mapReachProbe ? window.__mapReachProbe() : null;
  const cands = (m && m.per ? m.per.slice().reverse() : []);
  for (const c of cands) {
    const r = window.__mapPreviewTo ? window.__mapPreviewTo(c.tx, c.ty) : null;
    if (r && r.ok && r.n >= 4) return { tx: c.tx, ty: c.ty, n: r.n };
  }
  return null;
})()`;

/** `--preview=day`：摆一条**今天走不完**的路径（临时移动力 200 ⇒ 今天 2 格、明天 2 格），
 *  用来拍跨天分段（实线金 / 虚线冷 / 交界刻痕）。 */
/* `--mp=full` ⇒ 用满移动力摆路径（交界远到出画，配合 `--extra='&devzoom=2.4'` 拍边缘指示符）；
   默认 200 ⇒ 今天 2 格、明天 2 格，整条路都在画面里。 */
const DAY_MP_ARG = argOf('mp', '') === 'full' ? '' : '200';
/* `--mincost=2100`：把目标钉进"第 3 天"区间（mp=200 ⇒ 第 2 天收工在累计 2000 附近），
   用来拍**两道刻痕**。配合 `--extra='&devzoom=0.55'` 把 20 步路线缩进一屏。 */
const DAY_MINCOST = argOf('mincost', '');
const DAY_CALL = DAY_MINCOST
  ? `${DAY_MP_ARG}, 'horiz', ${DAY_MINCOST}`
  : DAY_MP_ARG;
const PREVIEW_DAY = `(() => {
  const r = window.__mapPreviewDay ? window.__mapPreviewDay(${DAY_CALL}) : null;
  if (!r || !r.ok) return null;
  return { tx: r.target.x, ty: r.target.y, n: r.n, day: r.day, stops: r.stops };
})()`;

const PREVIEW = argOf('preview', 'reach') === 'day' ? PREVIEW_DAY : PREVIEW_REACH;



let bad = 0;
const PASS = (c, m) => {
  if (!c) bad++;
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`);
};

try {
  await withHeadlessChrome(
    async ({ send, evaluate }) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width: VW, height: VH, deviceScaleFactor: DPR, mobile: true,
      });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }],
      });
      // 隐藏起点 toast（会压在镜头中央，四臂对称也得先去掉）
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source:
          `(() => { const add = () => { const s = document.createElement('style');` +
          ` s.textContent = '#hint{display:none !important}'; (document.head || document.documentElement).appendChild(s); };` +
          ` if (document.head) add(); else document.addEventListener('DOMContentLoaded', add); })();`,
      });

      /** 一臂：导航 → 等 canvas → 冻帧 → 读数（+ 截图） */
      async function capture(arm, clip, pre = null) {
        /* 不在 `ARMS` 里的臂（如 `path`、`warmup`）沿用默认查询串 —— 它们靠 `pre` 改状态，不靠 URL。 */
        const suffix = (ARMS.find(([n]) => n === arm) || [arm, ''])[1];
        await send('Page.navigate', { url: BASE + suffix });
        let ready = false;
        for (let i = 0; i < 120; i++) {
          await sleep(120);
          try {
            ready = await evaluate(`(() => { const c = document.querySelector('canvas'); return !!c && c.width > 0; })()`);
            if (ready) break;
          } catch { /* 导航中 */ }
        }
        if (!ready) {
          console.log(`[${arm}] 量不到：canvas 一直没起来`);
          return null;
        }
        await sleep(1400);
        if (pre) {
          const r = await evaluate(pre);
          if (r) console.log(`[${arm}] 预置：${JSON.stringify(r)}`);
          await sleep(420); // 让主循环按新状态画过一帧
        }
        await evaluate(FREEZE);
        await sleep(320);
        const st = await evaluate('window.__bandStats || null');
        const m = await evaluate('window.__mapReachProbe ? window.__mapReachProbe() : null');
        const pm = await evaluate('window.__mapPathProbe ? window.__mapPathProbe() : null');
        if (arm !== 'warmup') {
          console.log(
            `[${arm}] stats.dots=${st ? st.dots : '(无)'} · 量到 ${m ? m.n : '(无)'} 枚 · ` +
              `最差对比 ${m ? m.min : '?'}（中位 ${m ? m.median : '?'}）· covered ${m ? m.covered : '?'} · 出界 ${m ? m.offScreen : '?'}`,
          );
        }
        if (OUT && arm !== 'warmup') {
          // 全屏一枚（1×，供报告里"整屏看"）
          const full = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
          writeFileSync(path.join(OUT, `reach-${arm}-full.png`), Buffer.from(full.data, 'base64'));
          // 特写：四臂共用 clip（由 default 臂的点包围盒给）
          if (clip) {
            const z = await send('Page.captureScreenshot', {
              format: 'png', fromSurface: true, clip: { ...clip, scale: ZOOM },
            });
            writeFileSync(path.join(OUT, `reach-${arm}-zoom.png`), Buffer.from(z.data, 'base64'));
          }
        }
        return { st, m, pm };
      }

      const warm = await capture('warmup', null);
      PASS(!!warm, '预热臂起来了（首导航冷态，读数丢弃）');

      const A = await capture('default', null);
      const claim = A && A.st ? A.st.dots : -1;
      PASS(!!A && A.m && A.m.n > 0, `default 臂量到点（${A && A.m ? A.m.n : 0} 枚 / 自报 ${claim}）`);

      /* clip = **点最密的那一小块**，四臂共用。
       *
       * 首版取的是「所有点的包围盒」—— 实测包围盒 = 178,83 → 1483,467 device
       * ≈ 整屏 837×329 CSS ⇒ 3× 特写退化成"整屏 3×"，一张图 2512×988，
       * 报告里要看的"这枚点在沙地上读不读得出"反而更小。所以改成滑窗找密度峰：
       * 窗口 260×170 CSS（≈ 8×5 格，能同时看到"点 + 点之间的空白"），步长 40。
       */
      let clip = null;
      /* `--clip=x,y,w,h`（CSS px）可显式指定特写窗口 —— 自动窗是"点最密"，
         但最密处往往正好是城镇/水岸这种物件扎堆的地方，报告里需要的可能是
         "点落在沙地/雪原上"这种特定底色 ⇒ 留一个人工口径，照样四臂共用。 */
      const CLIP_ARG = argOf('clip', null);
      if (CLIP_ARG) {
        const [x, y, w, h] = CLIP_ARG.split(',').map(Number);
        clip = { x, y, width: w, height: h };
        console.log(`[clip] 人工指定 ${JSON.stringify(clip)}（四臂共用）`);
      } else if (A && A.m && A.m.per && A.m.per.length) {
        const pts = A.m.per.map((p) => ({ x: p.px / DPR, y: p.py / DPR }));
        const CW = 260;
        const CH = 170;
        let best = { n: -1, x: 0, y: 0 };
        for (let y = 0; y + CH <= VH; y += 40) {
          for (let x = 0; x + CW <= VW; x += 40) {
            const n = pts.filter((p) => p.x >= x && p.x < x + CW && p.y >= y && p.y < y + CH).length;
            if (n > best.n) best = { n, x, y };
          }
        }
        clip = { x: best.x, y: best.y, width: CW, height: CH };
        const bxs = pts.map((p) => p.x);
        const bys = pts.map((p) => p.y);
        console.log(
          `[clip] 点分布 CSS ${Math.min(...bxs).toFixed(0)},${Math.min(...bys).toFixed(0)} → ` +
            `${Math.max(...bxs).toFixed(0)},${Math.max(...bys).toFixed(0)}` +
            ` ⇒ 取最密窗口 ${JSON.stringify(clip)}（窗内 ${best.n} / 共 ${A.m.per.length} 枚，四臂共用）`,
        );
      }

      /* 拿到窗口后**四臂（含 default）重跑一遍** —— 每臂的特写必须在**该臂自己的页面上**拍。
       * 首版是"四臂跑完再补拍 default"，那时页面停在最后一臂（`none`）⇒
       * `reach-default-zoom.png` 与 `reach-none-zoom.png` 逐字节相同（拍的其实是空层）。
       * 这种错在图上完全看不出来（"没有点"也像"点很淡"），只有比对两张文件才发现。 */
      const rest = {};
      for (const [name] of ARMS) rest[name] = await capture(name, clip);

      PASS(
        rest.all && rest.all.st && rest.all.st.dots > (rest.default && rest.default.st ? rest.default.st.dots : 0),
        `all 臂落点更多（${rest.all && rest.all.st ? rest.all.st.dots : '?'} > ${rest.default && rest.default.st ? rest.default.st.dots : '?'}）`,
      );
      PASS(rest.shade && rest.shade.st && rest.shade.st.dots === 0, `shade 臂一枚点都不画（${rest.shade && rest.shade.st ? rest.shade.st.dots : '?'}）`);
      PASS(!!rest.none && (!rest.none.st || rest.none.st.dots === 0), `none 臂一枚点都不画（整层不画 ⇒ 连 __bandStats 都不写）`);
      PASS(!!(rest.shade && rest.shade.st && rest.shade.st.shade > 0), `shade 臂仍在压暗格（${rest.shade && rest.shade.st ? rest.shade.st.shade : '?'} 格）`);

      /* 第五臂：**预览路径**（`__mapPreviewTo`）。窗口要跟着路径走 —— 路径通常横跨大半个屏，
         用点的窗口会把它裁掉一半；所以先跑一趟读 `__mapPathProbe().per`，再按路径包围盒补拍。 */
      const P0 = await capture('path', null, PREVIEW);
      const ppts = ((P0 && P0.pm && P0.pm.per) || []).map((p) => ({ x: p.px / DPR, y: p.py / DPR }));
      PASS(
        !!P0 && P0.pm && P0.pm.n > 0,
        `路径臂量到地标（${P0 && P0.pm ? P0.pm.n : 0} 枚 · 最差 ${P0 && P0.pm ? P0.pm.min : '?'} · ` +
          `平均亮度 ${P0 && P0.pm ? P0.pm.meanBL : '?'} · drawnAfter=${P0 && P0.pm ? P0.pm.drawnAfter : '?'}）`,
      );
      if (ppts.length >= 3) {
        const pad = 46;
        const x0 = Math.max(0, Math.min(...ppts.map((p) => p.x)) - pad);
        const y0 = Math.max(0, Math.min(...ppts.map((p) => p.y)) - pad);
        const x1 = Math.min(VW, Math.max(...ppts.map((p) => p.x)) + pad);
        const y1 = Math.min(VH, Math.max(...ppts.map((p) => p.y)) + pad);
        const clipPath = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
        console.log(`[clip] 路径包围盒 ⇒ ${JSON.stringify(clipPath)}（只用于 path 臂）`);
        await capture('path', clipPath, PREVIEW);
      }
    },
  );
} catch (e) {
  console.error(`跑对照台失败：${e.message}`);
  process.exit(1);
}

console.log(bad ? `\n✗ ${bad} 条不过` : '\n全过：四臂同机位、点阵与旧路径都能复现');
process.exit(bad ? 1 : 0);
