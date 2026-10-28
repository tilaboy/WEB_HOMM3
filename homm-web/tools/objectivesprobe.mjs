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
 * ## 判据（10 条 + 4 条对照）
 *   `strip`       —— 三条都在、文案与作者数据一致、每条都带「当前/目标」，
 *                    且数字与钩子读数**独立对账**（探针自己按 revealed/total、mines、kills 算一遍）；
 *   `guide`       —— 条里同时有「向导」标签与「敌国 n/3」计数（2026-10-27 主理人把三条读成
 *                    胜利条件 ⇒ 前者说明这三条是什么，后者才是终局进度）；计数与钩子对账且在屏内；
 *   `prog-move`   —— 占 1 座矿时进度变 1/2 但**不勾**（证进度是过程量，不是结果量的别名）；
 *   `tick-mines`  —— 占满 2 座 ⇒ 该行 done=1、进度数字消失；
 *   `tick-foe`    —— 击败 1 名敌将 ⇒ 该行 done=1；
 *   `tick-explore`—— 揭开 ≥20% ⇒ 该行 done=1；
 *   `all-hint`    —— 三条全勾 ⇒ `#objectives[data-obj-all="1"]` + 提示条出现「全部达成」；
 *   `foes-drop`   —— 让一个敌族整族出局 ⇒ 计数 3/3 → 2/3（证它跟着 `isEliminated` 走，不是常量）；
 *   `guide-narrow`—— 792 宽 + 英雄栏展开（顶栏右收 208px）⇒ 计数仍完整落在顶栏内；
 *   `startline`   —— 开局页写着「三家全部出局」，且在横屏矮机**可见**；
 *   `ctl-prog`    —— `?devobjprog=0` ⇒ 一枚进度数字都没有（证 `strip` 量的是这批新加的东西）；
 *   `ctl-hint`    —— `?devobjdone=0` ⇒ 同样三条全勾，但**不出现**提示（证 `all-hint` 的后半不是恒真）；
 *   `ctl-guide`   —— `?devobjguide=0` ⇒ 无标签、无计数（证 `guide` 量的不是既有 DOM）；
 *   `ctl-hidden`  —— 同视口下 `.ss-hint` 是 display:none ⇒ `startline` 的可见性判据有牙。
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
  const foes = document.querySelector('#objectives .obj-foes');
  const guide = document.querySelector('#objectives .obj-guide');
  const fr = foes ? foes.getBoundingClientRect() : null;
  return {
    exists: !!strip,
    all: strip ? strip.getAttribute('data-obj-all') : null,
    cls: strip ? strip.className : null,
    hint: (document.getElementById('hint') || {}).textContent || '',
    guide: guide ? guide.textContent : null,
    foes: foes ? foes.textContent : null,
    foesN: foes ? Number(foes.getAttribute('data-obj-foes')) : null,
    foesBox: fr ? { l: Math.round(fr.left), r: Math.round(fr.right), w: Math.round(fr.width), h: Math.round(fr.height) } : null,
    vw: window.innerWidth,
    topR: strip && strip.parentElement ? Math.round(strip.parentElement.getBoundingClientRect().right) : null,
    sideOpen: document.body.classList.contains('side-open'),
    rows: rows.map((r) => ({
      text: (r.querySelector('.obj-text') || {}).textContent || '',
      prog: (r.querySelector('.obj-prog') || {}).textContent || null,
      done: r.getAttribute('data-obj-done') === '1',
      aria: r.getAttribute('aria-label') || '',
    })),
  };
})()`;

/** 开局页：胜利条件那行的**可见性**（`.ss-hint` 在横屏矮机被 display:none ⇒ 借用它会失效）。 */
const START = `(() => {
  const win = document.querySelector('#start-screen .ss-win');
  const hint = document.querySelector('#start-screen .ss-hint');
  const r = win ? win.getBoundingClientRect() : null;
  return {
    has: !!win,
    text: win ? win.textContent : null,
    shown: !!(win && getComputedStyle(win).display !== 'none' && r.height > 4),
    inView: r ? r.right <= innerWidth + 1 && r.left >= -1 && r.bottom <= innerHeight + 1 : false,
    hintHidden: hint ? getComputedStyle(hint).display === 'none' : null,
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

      // ---------------- ①b 向导 vs 敌国：两套东西都在条里 ----------------
      /* 主理人问「三个都完成不该结束吗」的根因：条里只有三条向导，没有任何终局信息。
         这里锁两件事：① 左边有「向导」标签；② 右边有「敌国 3/3」，且数字与钩子对账、盒子在屏内。 */
      check(
        'guide',
        '「向导」标签 + 「敌国 3/3」· 数字与钩子独立对账 · 计数不被挤出屏',
        s0.guide === '向导' &&
          s0.foes === `敌国 ${o0.foesAlive}/${o0.foesTotal}` &&
          s0.foesN === o0.foesAlive &&
          !!s0.foesBox &&
          s0.foesBox.w > 0 &&
          s0.foesBox.h > 0 &&
          s0.foesBox.r <= s0.vw - 1 &&
          s0.foesBox.l >= 0,
        `标签「${s0.guide}」· 计数「${s0.foes}」· 盒子 ${s0.foesBox && s0.foesBox.l}~${s0.foesBox && s0.foesBox.r} / 屏宽 ${s0.vw}（钩子 ${o0.foesAlive}/${o0.foesTotal}）`,
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

      // ---------------- ⑨ 敌国计数跟着 `isEliminated` 走 ----------------
      /* 一个写死的 "3/3" 也能通过 `guide`（只要文案对）⇒ 必须让它真的掉一格。 */
      await boot(send, evaluate, '');
      const sf0 = await evaluate(STRIP);
      const gone = await evaluate(`window.__devObjFoeOut ? window.__devObjFoeOut() : null`);
      await sleep(450);
      const sf1 = await evaluate(STRIP);
      const of1 = await evaluate(OBJ);
      check(
        'foes-drop',
        '让一个敌族整族出局 ⇒ 「敌国」3/3 掉到 2/3（量的是存活家数，不是常量）',
        !!gone && sf0.foes === '敌国 3/3' && sf1.foes === '敌国 2/3' && sf1.foesN === 2 && of1.foesAlive === 2,
        `摘掉 ${gone}：${sf0.foes} → ${sf1.foes}（钩子 foesAlive=${of1.foesAlive}）`,
      );

      // ---------------- ⑨b 最窄可用形态：792 宽 + 英雄栏展开 ----------------
      /* 「敌国」是终局进度，**任何时候都得看得见**。最坏的组合是矮机 792 + 右侧英雄栏展开
         （顶栏右边界收 208px）⇒ 这一臂专门在那种状态下量：计数盒子必须仍完整落在顶栏之内。 */
      await send('Emulation.setDeviceMetricsOverride', { width: 792, height: 390, deviceScaleFactor: 2, mobile: true });
      await boot(send, evaluate, '');
      await evaluate(`(() => {
        const b = [...document.querySelectorAll('#thumb .tb-btn')].find((x) => (x.textContent || '').includes('英雄'));
        if (b) b.click();
        return !!b;
      })()`);
      await sleep(400);
      const sn = await evaluate(STRIP);
      check(
        'guide-narrow',
        '792 宽 + 英雄栏展开 ⇒ 「敌国」计数仍完整在顶栏内（向导先让位，终局进度不让）',
        sn.sideOpen === true &&
          !!sn.foesBox &&
          sn.foesBox.w > 40 &&
          sn.foesBox.r <= sn.topR + 1 &&
          sn.foesBox.l >= 0,
        `side-open=${sn.sideOpen} · 计数 ${sn.foesBox && sn.foesBox.l}~${sn.foesBox && sn.foesBox.r} / 顶栏右缘 ${sn.topR}（屏宽 ${sn.vw}）`,
      );
      await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });

      // ---------------- ⑩ 对照：关掉向导标签与敌国计数 ----------------
      await boot(send, evaluate, '&devobjguide=0');
      const sg = await evaluate(STRIP);
      check(
        'ctl-guide',
        '?devobjguide=0 ⇒ 无「向导」标签、无「敌国」计数（证上面量的是这批新加的东西）',
        sg.rows.length === 3 && sg.guide === null && sg.foes === null,
        `guide=${sg.guide} · foes=${sg.foes} · rows=${sg.rows.length}`,
      );

      // ---------------- ⑪⑫ 开局页写着胜利条件，且在横屏矮机看得见 ----------------
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?devprobe=1&devstart=1` });
      for (let i = 0; i < 120; i++) {
        try {
          if (await evaluate(`!!document.querySelector('#start-screen .ss-win')`)) break;
        } catch {
          /* 导航中 */
        }
        await sleep(100);
      }
      const st = await evaluate(START);
      check(
        'startline',
        '开局页写着胜利条件「三家全部出局」，且在横屏矮机**可见**（不随 .ss-hint 被撤）',
        st.has && /三家全部出局/.test(st.text || '') && st.shown && st.inView,
        `「${st.text}」· shown=${st.shown} · inView=${st.inView}`,
      );
      /* 负向对照（无新参数）：同一视口 `.ss-hint` 确实是 display:none ⇒
         `shown` 这条判据有牙，而不是"凡在 DOM 里就算可见"。 */
      check(
        'ctl-hidden',
        '同视口下 `.ss-hint` 是 display:none ⇒ 可见性判据不是恒真',
        st.hintHidden === true,
        `.ss-hint display:none = ${st.hintHidden}`,
      );

      if (AS_JSON) console.log(JSON.stringify({ rows, s0, s1, s2, s3, sAll, sc, sd, sf0, sf1, sg, st }, null, 2));
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
