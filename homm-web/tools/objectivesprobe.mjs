#!/usr/bin/env node
/**
 * objectivesprobe.mjs —— 展示图三条目标的**过程量 + 达成反馈**门（`npm run probe:objectives`）。
 *
 * ## 为什么要有这把尺
 * 2026-10-27 主理人：「我现在应该是完成了所有的探索任务：20% 占两座矿，击败一座敌舰，
 * 但是完全没有反应」。查下来判定逻辑本身是对的，缺的是**可见性**：
 *   · 行里只有一个 9px 的空方块，没有任何"还差多少" ⇒ 玩家无法判断是自己没做到，还是它没刷新；
 *   · 三条全勾之后**什么都不发生** ⇒ 达成也没有一次明确反馈。
 *
 * 所以这一批把过程量写进条里（`探索 20% 7%/20%` / `占 2 座矿 0/2` / `击败 1 名敌将 0/1`），
 * 并在三条全勾时给一次提示 + 整条描边转金。判据盯的就是这两件事。
 *
 * ## 判据（6 条 + 2 条对照）
 *   `strip`       —— 三条都在、文案与作者数据一致、每条都带「当前/目标」，
 *                    且数字与钩子读数**独立对账**（探针自己按 revealed/total、mines、kills 算一遍）；
 *   `prog-move`   —— 占 1 座矿时进度变 1/2 但**不勾**（证进度是过程量，不是结果量的别名）；
 *   `tick-mines`  —— 占满 2 座 ⇒ 该行 done=1、进度数字消失；
 *   `tick-foe`    —— 击败 1 名敌将 ⇒ 该行 done=1；
 *   `tick-explore`—— 揭开 ≥20% ⇒ 该行 done=1；
 *   `all-hint`    —— 三条全勾 ⇒ `#objectives[data-obj-all="1"]` + 提示条出现「全部达成」；
 *   `ctl-prog`    —— `?devobjprog=0` ⇒ 一枚进度数字都没有（证 `strip` 量的是这批新加的东西）；
 *   `ctl-hint`    —— `?devobjdone=0` ⇒ 同样三条全勾，但**不出现**提示（证 `all-hint` 的后半不是恒真）。
 *
 * 用法：`node tools/objectivesprobe.mjs [--json] [--port=5216]`
 * 退出码：0 全过 / 1 有判据不过 / 2 前置不满足
 */
import { spawn } from 'node:child_process';
import { withHeadlessChrome, checkDevServer } from './_chrome.mjs';

const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) || '').slice(7) || 5216);
const AS_JSON = process.argv.includes('--json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = [];
const check = (id, label, ok, detail) => {
  rows.push({ id, ok: !!ok, label, detail });
  if (!AS_JSON) console.log(`${ok ? '✅' : '❌'} [${id}] ${label} — ${detail}`);
};

const BASE = `http://127.0.0.1:${PORT}/index.html?devprobe=1&devstart=1&devshowcase=1`;

/** 条 + 三行 + 每行的勾/进度/文案；另外把提示条文本一起带走（all-hint 用）。 */
const STRIP = `(() => {
  const strip = document.getElementById('objectives');
  const rows = [...document.querySelectorAll('#objectives .obj-row')];
  return {
    exists: !!strip,
    all: strip ? strip.getAttribute('data-obj-all') : null,
    cls: strip ? strip.className : null,
    hint: (document.getElementById('hint') || {}).textContent || '',
    rows: rows.map((r) => ({
      text: (r.querySelector('.obj-text') || {}).textContent || '',
      prog: (r.querySelector('.obj-prog') || {}).textContent || null,
      done: r.getAttribute('data-obj-done') === '1',
      aria: r.getAttribute('aria-label') || '',
    })),
  };
})()`;

/** 钩子读数（判定输入）—— 探针用它**独立**算一遍期望值，不读渲染结果。 */
const OBJ = `window.__objectives ? window.__objectives() : null`;

async function boot(send, evaluate, extra, wait = 2600) {
  await send('Page.navigate', { url: BASE + extra });
  for (let i = 0; i < 200; i++) {
    try {
      if (await evaluate(`!!document.querySelector('#thumb .tb-btn')`)) break;
    } catch {
      /* 导航中 */
    }
    await sleep(100);
  }
  await sleep(wait);
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

      // ---------------- ① 初始条：文案 + 进度独立对账 ----------------
      await boot(send, evaluate, '');
      const s0 = await evaluate(STRIP);
      const o0 = await evaluate(OBJ);
      const wantExplore = o0 ? Math.min(20, Math.floor((o0.revealed * 100) / o0.total)) : -1;
      const texts = (s0.rows || []).map((r) => r.text);
      check(
        'strip',
        '三条目标都在 · 每条带「当前/目标」· 数字与钩子读数独立对账',
        !!s0.exists &&
          s0.rows.length === 3 &&
          texts.join('|') === '探索 20%|占 2 座矿|击败 1 名敌将' &&
          s0.rows.every((r) => typeof r.prog === 'string' && r.prog.length > 0) &&
          s0.rows[0].prog === `${wantExplore}%` &&
          s0.rows[1].prog === `${o0.mines}/2` &&
          s0.rows[2].prog === `${Math.max(0, o0.peak - o0.foe)}/1`,
        `${texts.join(' · ')} ⇒ 进度 ${(s0.rows || []).map((r) => r.prog).join(' · ')}（钩子：revealed ${o0 && o0.revealed}/${o0 && o0.total} · mines ${o0 && o0.mines} · foe ${o0 && o0.foe}/peak ${o0 && o0.peak}）`,
      );

      // ---------------- ② 占 1 座矿：进度走、勾不动 ----------------
      await evaluate(`window.__devObjMines(1)`);
      await sleep(400);
      const s1 = await evaluate(STRIP);
      check(
        'prog-move',
        '占 1 座矿 ⇒ 进度变 1/2 但仍未勾选（进度是过程量，不是结果的别名）',
        s1.rows[1].prog === '1/2' && s1.rows[1].done === false,
        `进度 ${s1.rows[1].prog} · done=${s1.rows[1].done}`,
      );

      // ---------------- ③ 占满 2 座 ⇒ 勾上、数字退场 ----------------
      await evaluate(`window.__devObjMines(1)`);
      await sleep(400);
      const s2 = await evaluate(STRIP);
      const o2 = await evaluate(OBJ);
      check(
        'tick-mines',
        '占满 2 座矿 ⇒ 该行勾上、进度数字消失（勾就是答案，数字是噪音）',
        s2.rows[1].done === true && s2.rows[1].prog === null && o2.mines === 2,
        `done=${s2.rows[1].done} · prog=${s2.rows[1].prog} · 钩子 mines=${o2.mines}`,
      );

      // ---------------- ④ 击败一名敌将 ----------------
      const killed = await evaluate(`window.__devObjFoe()`);
      await sleep(400);
      const s3 = await evaluate(STRIP);
      check(
        'tick-foe',
        '击败 1 名敌将 ⇒ 该行勾上（敌方英雄数跌破峰值即算）',
        !!killed && s3.rows[2].done === true,
        `摘掉的英雄=${killed} · done=${s3.rows[2].done}`,
      );

      // ---------------- ⑤⑥ 揭开 20% ⇒ 三条全勾 + 提示 ----------------
      /* 另起一页（`devreveal` 只在启动时生效）：先 `__devObjMines(0)` 逼一次 refresh，
         让 reveal 后的 100% 被判定到；再补齐另两条 —— 最后一次 refresh 时全勾，提示应在此刻出现。 */
      await boot(send, evaluate, '&devreveal=1');
      await evaluate(`window.__devObjMines(0)`);
      await sleep(300);
      await evaluate(`window.__devObjMines(2)`);
      await sleep(300);
      const beforeAll = await evaluate(STRIP);
      await evaluate(`window.__devObjFoe()`);
      await sleep(350);
      const sAll = await evaluate(STRIP);
      const oAll = await evaluate(OBJ);
      check(
        'tick-explore',
        '揭开 ≥20% ⇒ 探索那条勾上（阈值按全图比例算，不是按"走了几步"）',
        beforeAll.rows[0].done === true && oAll.revealed >= oAll.need,
        `done=${beforeAll.rows[0].done} · revealed ${oAll.revealed} ≥ need ${oAll.need}`,
      );
      check(
        'all-hint',
        '三条全勾 ⇒ `data-obj-all=1` + 整条标记 + 提示「三条目标全部达成」',
        sAll.all === '1' && sAll.cls.includes('all') && /全部达成/.test(sAll.hint),
        `all=${sAll.all} · cls=${sAll.cls} · hint「${sAll.hint}」`,
      );

      // ---------------- ⑦ 对照：关掉进度数字 ----------------
      await boot(send, evaluate, '&devobjprog=0');
      const sc = await evaluate(STRIP);
      check(
        'ctl-prog',
        '?devobjprog=0 ⇒ 一枚进度数字都没有（证 strip 量的是这批新加的过程量）',
        sc.rows.length === 3 && sc.rows.every((r) => r.prog === null),
        `进度数字 ${sc.rows.filter((r) => r.prog).length} 枚（应 0）`,
      );

      // ---------------- ⑧ 对照：关掉"全部达成"提示 ----------------
      await boot(send, evaluate, '&devreveal=1&devobjdone=0');
      await evaluate(`window.__devObjMines(0)`);
      await evaluate(`window.__devObjMines(2)`);
      await evaluate(`window.__devObjFoe()`);
      await sleep(400);
      const sd = await evaluate(STRIP);
      check(
        'ctl-hint',
        '?devobjdone=0 ⇒ 同样三条全勾，但提示不出现（证 all-hint 的后半不是恒真）',
        sd.all === '1' && !/全部达成/.test(sd.hint),
        `all=${sd.all} · hint「${sd.hint}」`,
      );

      if (AS_JSON) console.log(JSON.stringify({ rows, s0, s1, s2, s3, sAll, sc, sd }, null, 2));
      code = rows.every((r) => r.ok) ? 0 : 1;
    },
    { devServerPort: PORT, profilePrefix: 'objectives-' },
  );
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  if (process.env.OBJ_DEBUG) console.error(e && e.stack ? e.stack : e);
  code = 2;
} finally {
  if (srv && !srv.killed) srv.kill('SIGKILL');
}
if (!AS_JSON) console.log(code === 0 ? '[总结] 全过' : `[总结] FAIL ${rows.filter((r) => !r.ok).length} 条`);
process.exit(code);
