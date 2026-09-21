/**
 * startscreen.mjs —— **§6.1 第 ③ 项：改前 / 改后一对图**（真 Chrome 实拍）。
 *
 * 关键纪律：**一次只动一个变量**。
 * 所以本脚本在**同一次会话、同一页、同一滚动位置、同一帧序**上：
 *   ① 抓"改前" → ② 把门面位图**注入运行中的 DOM** → ③ 抓"改后"。
 * ⇒ 两张图之间**只差那一个 <img>**，不含任何"重开一次页面"的差异。
 *
 * **它不改任何源码**：注入走 CDP `Runtime.evaluate`，只活在这一次浏览器会话里。
 * 所以"改后"的**版式是我给的一个示意**（当前构建里根本没有"选族页"）——
 * 报告与页面上都**必须如实标注"示意，不是已落地的改动"**。
 *
 * 两个口径各抓一对（`shots/README.md` 提醒过："视口"是三个不同的量，别混）：
 *   · `phone`  = **792×320 @DPR3** —— 项目审计探针口径（真机横屏）
 *   · `desk`   = 1280×900 @DPR1  —— 立绘能 1:1 放下、看"门面感"的口径
 *
 * 用法（cwd = homm-web/）：
 *   node assets/bitmap-proof/pipeline/startscreen.mjs --inject=assets/sprites/crestL/crestL_p1.png
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withHeadlessChrome, checkDevServer } from '../../../tools/_chrome.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const FIGS = join(ROOT, 'assets', 'bitmap-proof', 'figs');
mkdirSync(FIGS, { recursive: true });

const args = process.argv.slice(2);
const argOf = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const injectPath = argOf('inject', '');
const PORT = Number(argOf('port', 5177));

const VIEWPORTS = [
  { id: 'phone', w: 792, h: 320, dpr: 3, imgw: 128, note: '真机横屏口径 792×320 @DPR3' },
  { id: 'desk', w: 1280, h: 900, dpr: 1, imgw: 256, note: '桌面口径 1280×900（立绘 1:1）' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spawnIfNeeded = !(await checkDevServer(PORT)).ok;

/* ---- 注入脚本（只在页面里跑；不改源码） ----
 * 位图缩放**只用整数比**：128 = 256×0.5 ✔、256 = 256×1 ✔（非整数比会踩 §3.3 的最近邻劣化）。 */
function injectExpr(dataUri, imgw) {
  return `(async () => {
    const brand = document.querySelector('#start-screen .ss-brand');
    if (!brand) return { ok: false, why: '没有 .ss-brand' };
    if (document.getElementById('__crest')) return { ok: true, why: 'already' };
    // ① 先把原来的 h1/p 包进一个"文字列"，否则 flex 会把标题和副标题拆成两列
    const text = document.createElement('div');
    text.style.cssText = 'flex:1 1 auto;min-width:0';
    while (brand.firstChild) text.appendChild(brand.firstChild);
    brand.appendChild(text);
    // ② 标题不折行（折成竖排会把"门面"读成排版事故）
    const h1 = text.querySelector('h1');
    if (h1) { h1.style.whiteSpace = 'nowrap'; }
    // ③ 立绘列
    brand.style.display = 'flex';
    brand.style.alignItems = 'center';
    brand.style.gap = '18px';
    const wrap = document.createElement('div');
    wrap.id = '__crest';
    wrap.style.cssText = 'flex:0 0 auto;line-height:0';
    const img = document.createElement('img');
    img.src = ${JSON.stringify(dataUri)};
    img.alt = '门面位图示意（运行时注入，未落地）';
    img.style.cssText = 'width:${imgw}px;height:auto;display:block;image-rendering:pixelated;' +
      'border:1px solid rgba(234,224,208,.18);border-radius:6px';
    wrap.appendChild(img);
    brand.appendChild(wrap);
    // 等图**真的解码完**再量 —— 否则 height:auto 的图在布局前量到的是 0/2px（假读数）
    try { await img.decode(); } catch (e) { return { ok: false, why: 'decode 失败: ' + e.message }; }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const box = brand.getBoundingClientRect();
    const ib = img.getBoundingClientRect();
    const nat = img.naturalWidth + 'x' + img.naturalHeight;
    return { ok: true, brandW: Math.round(box.width), brandH: Math.round(box.height),
             imgW: Math.round(ib.width), imgH: Math.round(ib.height), natural: nat,
             imgRatio: +(ib.width / img.naturalWidth).toFixed(3) };
  })()`;
}

let srv = null;
let failed = false;
const shots = [];
try {
  if (spawnIfNeeded) {
    srv = spawn('node', [join(ROOT, 'tools', 'serve.mjs')], {
      stdio: 'ignore',
      env: { ...process.env, PORT: String(PORT) },
    });
    for (let i = 0; i < 100; i++) {
      if ((await checkDevServer(PORT)).ok) break;
      await sleep(120);
    }
    if (!(await checkDevServer(PORT)).ok) throw new Error('dev server 起不来');
  }

  for (const vp of VIEWPORTS) {
    const outBefore = `before_${vp.id}.png`;
    const outAfter = `after_${vp.id}.png`;
    const res = await withHeadlessChrome(
      async ({ send, evaluate }) => {
        await send('Emulation.setDeviceMetricsOverride', {
          width: vp.w,
          height: vp.h,
          deviceScaleFactor: vp.dpr,
          mobile: vp.dpr > 1,
        });
        await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
        for (let i = 0; i < 160; i++) {
          try {
            if (await evaluate(`!!document.getElementById('start-screen')`)) break;
          } catch {
            /* 导航中 */
          }
          await sleep(100);
        }
        // 等"画完了"：字体 + 标题量到非零宽高
        await evaluate(`(async () => {
          const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
          if (document.fonts && document.fonts.ready) await document.fonts.ready;
          for (let i=0;i<60;i++){ const h=document.querySelector('#start-screen .ss-brand h1');
            if (h && h.getBoundingClientRect().width>0) break; await sleep(50); }
          await sleep(450);
          return true;
        })()`);
        const shotBefore = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(FIGS, outBefore), Buffer.from(shotBefore.data, 'base64'));

        let injectInfo = { ok: false, why: 'no --inject' };
        if (injectPath) {
          const uri = 'data:image/png;base64,' + readFileSync(join(ROOT, injectPath)).toString('base64');
          injectInfo = await evaluate(injectExpr(uri, vp.imgw));
          await sleep(350);
          const shotAfter = await send('Page.captureScreenshot', { format: 'png' });
          writeFileSync(join(FIGS, outAfter), Buffer.from(shotAfter.data, 'base64'));
        }
        return { injectInfo, w: vp.w, h: vp.h, dpr: vp.dpr };
      },
      { devServerPort: PORT, profilePrefix: `startscreen-${vp.id}-` },
    );
    console.log(
      `${vp.id.padEnd(6)} ${vp.note}  → figs/${outBefore}` +
        (injectPath ? `  +  figs/${outAfter}  注入:${JSON.stringify(res.injectInfo)}` : ''),
    );
    shots.push({
      id: vp.id,
      note: vp.note,
      cssW: vp.w,
      cssH: vp.h,
      dpr: vp.dpr,
      before: outBefore,
      after: injectPath ? outAfter : null,
      inject: res.injectInfo,
      injectedFrom: injectPath || null,
    });
  }
  writeFileSync(join(FIGS, 'shots_report.json'), JSON.stringify({ shots }, null, 2));
} catch (e) {
  console.error('[fail]', e.message);
  failed = true;
} finally {
  if (srv && !srv.killed) srv.kill('SIGKILL');
}
process.exit(failed ? 1 : 0);
