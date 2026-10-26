#!/usr/bin/env node
/**
 * longlistprobe.mjs —— 战斗"满编 6~7 队"侧列的**可读性**门（`npm run probe:longlist`）。
 *
 * ## 为什么要有这把尺
 * 390 高下，动作簇占掉列底 148px，名单只剩 ~160px ≈ 4.7 张卡 ⇒ 满编 7 队必然要滚。
 * 滚本身可以接受（要塞下 7 张卡只能压到 23px，那样既违反 28px 下限、也点不准），
 * **不可接受的是"轮到的那一支在窗外"**：`renderSides()` 每次签名变化都会重建行，
 * `scrollTop` 随之归零 —— 于是第 5~7 支行动时玩家看到的是"名单还在，但没人高亮"。
 * 这不是排版问题，是**回合信息丢失**。
 *
 * 修法：`revealActive()` 只做最小位移，把 `.act` 那张卡贴进可视窗。
 *
 * ## 判据（3 条）
 *   `full`       —— 前提：每侧 7 张卡且列表**确实溢出**（不溢出则下面的判据没有分辨力）；
 *   `reveal`     —— 连点「等待」≥6 次，每一次有行动单位的那一列都把 `.act` 卡整张包在可视窗内，
 *                   且至少一次轮到第 5 张之后（证"真的轮到过窗外那张"）；
 *   `reveal-ctl` —— `?devautoscroll=0` 的同一序列里**至少有一次** `.act` 卡在窗外
 *                   （证判据量的是这次滚动，不是"名单本来就没溢出"）。
 *
 * 用法：`node tools/longlistprobe.mjs [--json] [--wait=6]`
 * 退出码：0 全过 / 1 有判据不过 / 2 前置不满足
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withHeadlessChrome, checkDevServer } from './_chrome.mjs';

const opt = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const PORT = Number(opt('port', 5212));
const AS_JSON = process.argv.includes('--json');
/** 点几次「等待」：7 队 ⇒ 6 次就足以把最后一支推到行动位。 */
const CLICKS = Number(opt('wait', 6));
/** `--shot=DIR` 每次采样存一张整屏（证据图：同一时刻自动带入 / 不带的对照）。 */
const SHOT = opt('shot', null);
if (SHOT) mkdirSync(SHOT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = [];
const check = (id, label, ok, detail) => {
  rows.push({ id, ok, label, detail });
  if (!AS_JSON) console.log(`${ok ? '✅' : '❌'} [${id}] ${label} — ${detail}`);
};

/** 每一列：卡片数、可视高/内容高、滚到哪、行动卡是第几张、整张在不在窗内。 */
const LIST = `(() => {
  const cols = [...document.querySelectorAll('.bt-side')].map((c) => {
    const list = c.querySelector('.bt-side-list');
    if (!list) return null;
    const act = list.querySelector('.bt-side-row.act');
    const lr = list.getBoundingClientRect();
    const ar = act ? act.getBoundingClientRect() : null;
    const all = [...list.querySelectorAll('.bt-side-row')];
    return {
      rows: all.length,
      ch: Math.round(list.clientHeight),
      sh: Math.round(list.scrollHeight),
      scrollTop: Math.round(list.scrollTop),
      actRow: act ? all.indexOf(act) : -1,
      actName: act ? ((act.querySelector('.n') || {}).textContent || '') : null,
      /* 整张卡都在窗内（±1 容差 = 亚像素取整）。半张卡露着不算"看得见"。 */
      inside: ar ? ar.top >= lr.top - 1 && ar.bottom <= lr.bottom + 1 : null,
      colH: Math.round(lr.height),
    };
  });
  return cols.filter(Boolean);
})()`;

/** 点「等待」——与玩家手指点的是同一个按钮。 */
const CLICK_WAIT = `(() => {
  const b = [...document.querySelectorAll('.bt-actions .btn')].find((x) => /等待/.test(x.textContent || ''));
  if (!b || b.disabled) return false;
  b.click();
  return true;
})()`;

const BASE =
  `http://127.0.0.1:${PORT}/index.html?devquick=1&devreveal=1&devprobe=1&devbandstats=1&devbattle=full`;

/** 一臂：导航 → 等战斗挂载 → 连点「等待」并逐次采样。 */
async function arm(send, evaluate, query, label, tag) {
  await send('Page.navigate', { url: BASE + query });
  for (let i = 0; i < 200; i++) {
    try {
      if (await evaluate(`!!document.querySelector('.bt-side-list')`)) break;
    } catch {
      /* 导航中 */
    }
    await sleep(100);
  }
  await sleep(1200);
  const first = await evaluate(LIST);
  const samples = [];
  for (let k = 0; k < CLICKS; k++) {
    /* 「等待」在 AI 行动 / 动画播放期间是 disabled 的，点下去不生效。
       所以**重试到真的点中**再采样 —— 否则 6 次采样里五条是同一个状态的复印件，
       判据看起来"读了 6 次"，实际上只验了一次。 */
    let clicked = false;
    for (let t = 0; t < 12 && !clicked; t++) {
      clicked = await evaluate(CLICK_WAIT);
      if (!clicked) await sleep(280);
    }
    await sleep(420);
    samples.push({ k, clicked, cols: await evaluate(LIST) });
    if (SHOT) {
      const png = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      writeFileSync(path.join(SHOT, `${tag}-${k + 1}.png`), Buffer.from(png.data, 'base64'));
    }
  }
  if (!AS_JSON) {
    const c0 = first && first[0] ? first[0] : {};
    console.log(
      `[${label}] 列 ${(first || []).length} · 卡 ${c0.rows} 张 · 可视 ${c0.ch}/${c0.sh}px` +
        ` · 采样 ${samples.length} 次（点到 ${samples.filter((s) => s.clicked).length} 次）`,
    );
  }
  return { first, samples };
}

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
      await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'hover', value: 'none' },
          { name: 'pointer', value: 'coarse' },
        ],
      });

      const A = await arm(send, evaluate, '', 'devbattle=full（默认：自动带入视野）', 'A');
      const cols = A.first || [];
      const fullOk = cols.length === 2 && cols.every((c) => c.rows === 7 && c.sh > c.ch + 1);
      check(
        'full',
        '前提：满编 7 队两侧 · 名单确实溢出（不溢出则后面的判据没有分辨力）',
        fullOk,
        cols.map((c) => `${c.rows} 张 ${c.ch}/${c.sh}px`).join(' · ') || '没读到列',
      );

      /* 逐次采样：只看**有行动单位的那一列**（另一边没有 `.act`，`inside` 是 null）。 */
      const pick = (sm) => {
        const actCols = (sm.cols || []).filter((c) => c.actRow >= 0);
        return actCols[0] || null;
      };
      const got = A.samples.map(pick).filter(Boolean);
      const outOfView = got.filter((c) => c.inside !== true);
      const deep = got.filter((c) => c.actRow >= 4);
      check(
        'reveal',
        '连点「等待」后，每次轮到的那张卡都整张在可视窗内（且真的轮到过第 5 张之后）',
        got.length >= 5 && outOfView.length === 0 && deep.length >= 1,
        `${got.length} 次读数 · 窗外 ${outOfView.length} 次 · 轮到第 5 张之后 ${deep.length} 次 · ` +
          got
            .slice(0, 6)
            .map((c) => `#${c.actRow + 1}${c.inside ? '✓' : '✗'}(top ${c.scrollTop})`)
            .join(' '),
      );

      /* 负向对照：只关掉自动带入 ⇒ 同一序列里必然出现"轮到的那张在窗外"。 */
      const B = await arm(send, evaluate, '&devautoscroll=0', 'devautoscroll=0（负向对照）', 'B');
      const ctl = B.samples.map(pick).filter(Boolean);
      const ctlOut = ctl.filter((c) => c.inside === false);
      check(
        'reveal-ctl',
        '关掉自动带入后，同一序列里轮到的那张卡会落在窗外（证判据有分辨力）',
        ctlOut.length >= 1,
        `${ctl.length} 次读数 · 窗外 ${ctlOut.length} 次 · ` +
          ctl
            .slice(0, 6)
            .map((c) => `#${c.actRow + 1}${c.inside ? '✓' : '✗'}`)
            .join(' '),
      );

      if (AS_JSON) console.log(JSON.stringify({ rows, A, B }, null, 2));
      code = rows.every((r) => r.ok) ? 0 : 1;
    },
    { devServerPort: PORT, profilePrefix: 'll-' },
  );
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  code = 2;
} finally {
  if (srv && !srv.killed) srv.kill('SIGKILL');
}

if (!AS_JSON) console.log(code === 0 ? '[总结] 全过' : `[总结] FAIL ${rows.filter((r) => !r.ok).length} 条`);
process.exit(code);
