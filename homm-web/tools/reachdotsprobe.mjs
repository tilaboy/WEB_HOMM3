#!/usr/bin/env node
/**
 * reachdotsprobe.mjs —— 可达「格心点阵」的**可读性**门（`npm run probe:reachdots`）。
 *
 * ## 为什么要有这把尺
 * 2026-10-23 把默认从 `shade`（整格蓝洗 + 外圈压暗）翻成 `dots`（格心双色点）之后，
 * **点成了默认路径上唯一的可达性提示**。此前"能不能到"由一整片蓝底回答，
 * 现在由一枚 4×4 世界 px 的点回答 —— 如果这枚点在沙地或暗草上看不见，
 * 那是**功能退步**，不是"风格问题"。所以必须有数，不能"看着还行"。
 *
 * ## 为什么取色在渲染器里做，而不是脚本里做模板匹配
 * 第一版就是在脚本里按 `#fff3c8` / `#2a1a12` 做模板匹配 —— **一枚都匹配不到**。
 * 原因是点画在 `applyLighting` **之前**，整屏 multiply 会把颜色乘暗（夜里更明显）。
 * 所以改成 `?devreachprobe=1` 登记坐标 + `MapRenderer.probeReach()` 在**同一帧缓冲**
 * 里取色：量到的才是"玩家看到的那枚点"。
 *
 * ## 判据
 *   ① `found`  —— 每枚登记的点都量得到，且数量 = 渲染器自报的 `__bandStats.dots`（防"画的不是数的"）；
 *   ② `contrast` —— `max(对比(最亮像素, 底色), 对比(最暗像素, 底色))` 的**最差那枚 ≥ 3.0**
 *        （双色锚：亮底吃墨边、暗底吃暖芯；3.0 = WCAG 非文本状态阈值，与 §4.6 同源）；
 *   ③ `clear`  —— 没有一枚点被实体盖住（块内明度差 < 40 ⇒ 记 `covered`，必须为 0）；
 *   ④ `selfcheck`（`--selfcheck`）—— `?devband=shade` 臂**一枚点都不画** ⇒
 *        登记数与量到的数都必须是 0（防"探针在没点的地方也报出数"）。
 *
 * 用法：`node tools/reachdotsprobe.mjs [--selfcheck] [--json]`
 * 退出码：0 全过 / 1 有判据不过
 */
import { spawn } from 'node:child_process';
import { withHeadlessChrome, checkDevServer } from './_chrome.mjs';

const opt = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const PORT = Number(opt('port', 5199));
const AS_JSON = process.argv.includes('--json');
const SELFCHECK = process.argv.includes('--selfcheck');
const SEED = opt('seed', '20260917');
/** 光照相位（0=深夜 … 1=正午）。默认 0.22 = 探针基线；扫相位用 `--light=`。 */
const LIGHT = opt('light', '0.22');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = `http://127.0.0.1:${PORT}/index.html?devquick=1&devreveal=1&devprobe=1&devbandstats=1&devreachprobe=1&devseed=${SEED}&devlight=${LIGHT}`;

async function arm(send, evaluate, query, label) {
  await send('Page.navigate', { url: BASE + query });
  for (let i = 0; i < 160; i++) {
    try {
      if (await evaluate(`!!document.querySelector('#thumb')`)) break;
    } catch {
      /* 导航中 */
    }
    await sleep(100);
  }
  await sleep(1800);
  const st = await evaluate('window.__bandStats || null');
  const m = await evaluate('window.__mapReachProbe ? window.__mapReachProbe() : null');
  if (!AS_JSON) {
    console.log(
      `[${label}] stats.dots=${st ? st.dots : '(无)'} · 量到 ${m ? m.n : '(无)'} 枚 · ` +
        `最差对比 ${m ? m.min : '?'}（中位 ${m ? m.median : '?'}）· 被盖住 ${m ? m.covered : '?'} · 出界 ${m ? m.offScreen : '?'}`,
    );
  }
  return { st, m };
}

const rows = [];
const check = (id, label, ok, detail) => {
  rows.push({ id, ok, label, detail });
  if (!AS_JSON) console.log(`${ok ? '✅' : '❌'} [${id}] ${label} — ${detail}`);
};

let srv = null;
let code = 0;
try {
  if (!(await checkDevServer(PORT)).ok) {
    srv = spawn('node', ['tools/serve.mjs'], { stdio: 'ignore', env: { ...process.env, PORT: String(PORT) } });
    for (let i = 0; i < 120; i++) {
      if ((await checkDevServer(PORT)).ok) break;
      await sleep(120);
    }
  }
  await withHeadlessChrome(
    async ({ send, evaluate }) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width: 844,
        height: 390,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'hover', value: 'none' },
          { name: 'pointer', value: 'coarse' },
        ],
      });

      const A = await arm(send, evaluate, '', 'default(dots)');
      const claim = A.st ? A.st.dots : -1;
      const m = A.m || { n: 0, min: 0, median: 0, covered: 0, per: [] };

      check(
        'found',
        '每枚登记的点都量得到，且数量与渲染器自报一致',
        m.n > 0 && m.n + m.offScreen === claim,
        `量到 ${m.n} 枚 + 出界 ${m.offScreen} 枚 = stats.dots ${claim} 枚`,
      );
      check(
        'contrast',
        '每枚点在自己的底色上都读得出（双色锚取较优者 ≥ 3.0）',
        m.min >= 3,
        `最差 ${m.min} · 中位 ${m.median}（暖芯/墨边各一，取较优）`,
      );
      check('clear', '没有一枚点被实体盖住', m.covered === 0, `covered ${m.covered} 枚（块内明度差 < 40）`);

      if (SELFCHECK) {
        const S = await arm(send, evaluate, '&devband=shade', 'shade(无点)');
        const sDots = S.st ? S.st.dots : -1;
        const sN = S.m ? S.m.n : -1;
        check(
          'no-phantom',
          '无点的臂上：登记数与量到数都必须是 0（防探针凭空造数）',
          sDots === 0 && sN === 0,
          `shade 臂 stats.dots=${sDots} · 量到 ${sN} 枚`,
        );
      }

      if (AS_JSON) console.log(JSON.stringify({ rows, dots: m }, null, 2));
      code = rows.every((r) => r.ok) ? 0 : 1;
    },
    { devServerPort: PORT, profilePrefix: 'rd-' },
  );
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  code = 1;
} finally {
  if (srv && !srv.killed) srv.kill('SIGKILL');
}

if (!AS_JSON) console.log(code === 0 ? '[总结] 全过' : `[总结] FAIL ${rows.filter((r) => !r.ok).length} 条`);
process.exit(code);
