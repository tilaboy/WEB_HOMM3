#!/usr/bin/env node
/**
 * dayflowprobe.mjs —— 过天流程门（`npm run probe:dayflow`）。
 *
 * ## 为什么要这把尺
 * 2026-10-27 主理人裁定两条：
 *   ① 「每天结束一天的**对手动向**，没有必要」——那个弹窗每天必弹一屏 AI 之间的家务事；
 *   ② 「去掉拇指带上的数字角标」——未读条数改挂到「菜单 → 事件日志」那一行。
 *
 * 两条都是"减法"，而减法最容易被下一次改动悄悄加回来（弹窗一弹，谁也不会立刻发现）。
 * 所以这里各锁一条，并各配一个**能弹出来的对照臂**：
 *
 *   `no-daily`    —— 连过 3 天：**不出现**「第 N 天 · 对手动向」弹窗，但字幕仍是「第 N 天」；
 *   `devreport`   —— 同一场景加 `?devreport=1`（探针专用）：弹窗**必须**出现
 *                    （证 `no-daily` 不是"这个弹窗根本坏了"）；
 *   `logcount`    —— 拇指带上没有 `.tb-badge`；菜单里「事件日志」那一行带「N 条未读」，
 *                    且点进日志后条数归零（数字确实跟着"读没读"走）；
 *   `logcount-ctl`—— **只在 `--selfcheck` 下跑**：把 `.tb-badge` 塞回拇指带 ⇒ 同一判据当场翻红。
 *
 * 用法：`node tools/dayflowprobe.mjs [--json]`
 * 退出码：0 全过 / 1 有判据不过 / 2 前置不满足
 */
import { spawn } from 'node:child_process';
import { withHeadlessChrome, checkDevServer } from './_chrome.mjs';

const PORT = Number((process.argv.find((a) => a.startsWith('--port=')) || '').slice(7) || 5214);
const AS_JSON = process.argv.includes('--json');
/** `--selfcheck`：额外跑一条**篡改臂**，证明 `logcount` 的"角标那半"会红。 */
const SELFCHECK = process.argv.includes('--selfcheck');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = [];
const check = (id, label, ok, detail) => {
  rows.push({ id, ok: !!ok, label, detail });
  if (!AS_JSON) console.log(`${ok ? '✅' : '❌'} [${id}] ${label} — ${detail}`);
};

/**
 * `logcount` 的"读之前"那一半：拇指带**没有**角标，且菜单行写着「事件日志 · N 条未读」。
 * 抽成函数是为了让自检臂能拿同一组判据去套篡改后的读数（判据与自检必须字面同源）。
 */
const beforeOk = (r) =>
  !!r &&
  !r.error &&
  r.hasBadgeInThumb === false &&
  r.text === '事件日志' &&
  /^\d+$/.test(r.count || '') &&
  Number(r.count) > 0 &&
  new RegExp(`事件日志，${r.count} 条未读`).test(r.aria || '') &&
  r.wrap === false;

const BASE = `http://127.0.0.1:${PORT}/index.html?devquick=1&devreveal=1&devprobe=1`;

/** 当前屏：标题为「…对手动向」的模态 / 字幕文本 / 拇指带角标 / 菜单行。 */
const STATE = `(() => {
  const h = document.querySelector('.modal h2, .modal h3, .modal .m-title, .modal .h');
  const title = h ? (h.textContent || '').trim() : '';
  const hintEl = document.querySelector('#hint');
  const badge = document.querySelector('#thumb .tb-badge');
  return {
    modalTitle: title,
    hasModal: !!document.querySelector('.modal'),
    hint: hintEl ? (hintEl.textContent || '').trim() : '',
    badge: badge ? (badge.textContent || '').trim() : null,
  };
})()`;

/** 打开菜单、读「事件日志」那一行；`clickLog` 为真时顺手点进去（点开即清零）。 */
const menuRead = (clickLog) => `(() => {
  const b = [...document.querySelectorAll('#thumb .tb-btn')].find((x) => /菜单/.test(x.textContent || ''));
  if (!b) return { error: '拇指带无「菜单」' };
  const hasBadgeInThumb = !!b.querySelector('.tb-badge');
  b.click();
  const root = document.getElementById('menu');
  const items = root ? [...root.querySelectorAll('.menu-item')].map((x) => (x.textContent || '').trim()) : [];
  const log = root ? [...root.querySelectorAll('.menu-item')].find((x) => /事件日志/.test(x.textContent || '')) : null;
  /* 文案只取**文本节点**：textContent 会把右侧胶囊里的数字也拼进来（读到「事件日志6」）。 */
  const text = log
    ? [...log.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
    : null;
  const aria = log ? (log.getAttribute('aria-label') || '') : '';
  /* 条数现在是一枚右侧小胶囊（.mi-count），不进文案：文案 =「事件日志」四个字。
     ⚠️ 这段是**模板字符串内部**：注释里不许出现反引号，否则模板提前结束（本轮踩过）。 */
  const cntEl = log ? log.querySelector('.mi-count') : null;
  const count = cntEl ? (cntEl.textContent || '').trim() : null;
  /* 折行检查：菜单是 2 列网格，一行塞不下的文案会折成两行（"事件日志 · 10 条" / "未读"）。
     折行不是"看着丑"，是**格高被撑开**、跟着把整块面板顶出安全区。 */
  const wrap = log ? Math.round(log.getBoundingClientRect().height) > 52 : false;
  if (${clickLog} && log) log.click();
  else if (root) root.remove();
  return { items, text, aria, count, wrap, hasBadgeInThumb };
})()`;

/** 关掉最上层弹窗（事件日志的「关闭」或任意 backdrop）。 */
const CLOSE_TOP = `(() => {
  const b = [...document.querySelectorAll('button, .btn')].find((x) => /^(关闭|返回|继续)$/.test((x.textContent || '').trim()));
  if (b) { b.click(); return 'closed'; }
  const m = [...document.querySelectorAll('.modal')];
  const top = m[m.length - 1];
  if (top) { top.click(); return 'backdrop'; }
  return 'none';
})()`;

/**
 * 过一天：点「结束一天」，**等到字幕真的换成下一天**再返回。
 *
 * ⚠️ 这里必须返回"过没过成"，不能点完就 `sleep(2400)` 然后读屏：
 * 2026-11-12 全量跑时 `devreport` 臂读到 `模态=false`，而同一个门单跑全过 ——
 * 根因是按钮还在演出里 `disabled`、40 次重试全落空，点没点成与"没弹窗"
 * 在读数上**长得一模一样**（铁律 2：要分「没有对象」与「有对象量不到」）。
 * 现在返回 `{ ok, from, to }`：`ok=false` 时判据直接红并写明"这一天没过去"。
 */
async function nextDay(evaluate) {
  const hintNow = async () =>
    await evaluate(`(() => { const e = document.querySelector('#hint'); return e ? (e.textContent||'').trim() : ''; })()`);
  const from = await hintNow();
  let clicked = 0;
  /* 点一次不够：`doEndDay` 开头有 `if (isModalOpen() || anim || isBattleOpen()) return;` ——
     上一次的模态/演出还没收干净时，**点击被静默吞掉**，按钮也不是 disabled。
     所以"点了"不等于"过了一天"：没翻页就再点，最多 3 次。 */
  for (let attempt = 0; attempt < 3; attempt++) {
    for (let i = 0; i < 40; i++) {
      const st = await evaluate(`(() => {
        const b = [...document.querySelectorAll('#thumb .tb-btn')].find((x) => /结束一天/.test(x.textContent || ''));
        if (!b) return 'missing';
        if (b.disabled) return 'disabled';
        b.click();
        return 'clicked';
      })()`);
      if (st === 'clicked') {
        clicked++;
        break;
      }
      await sleep(200);
    }
    if (!clicked) return { ok: false, from, to: from, why: '按钮一直不可点（演出没结束 / 被遮）' };
    for (let i = 0; i < 22; i++) {
      /* 两条都算"这天过去了"：
         ① 字幕换了；
         ② **「对手动向」弹出来**了 —— `showAiDayReport()` 故意把收尾 hint 交给关闭回调
            （否则 toast 会在模态背后 2 秒蒸发），所以弹着的时候字幕**仍然停在前一天**。
            首版只认 ①，devreport 臂因此把"弹窗已经出来了"读成"点了 3 次没换天"（2026-11-12 踩到）。 */
      const snap = await evaluate(`(() => {
        const e = document.querySelector('#hint');
        const h = document.querySelector('.modal h2, .modal h3, .modal .m-title, .modal .h');
        return {
          hint: e ? (e.textContent || '').trim() : '',
          modal: !!document.querySelector('.modal'),
          title: h ? (h.textContent || '').trim() : '',
        };
      })()`);
      if (snap.hint && snap.hint !== from) {
        await sleep(260);
        return { ok: true, from, to: snap.hint, via: 'hint', clicks: clicked };
      }
      if (snap.modal && /对手动向/.test(snap.title)) {
        await sleep(260);
        return { ok: true, from, to: snap.hint, via: 'report', clicks: clicked };
      }
      await sleep(120);
    }
  }
  return { ok: false, from, to: await hintNow(), why: `点了 ${clicked} 次，字幕一直没换天` };
}

/** 轮询直到「对手动向」弹出来（最长 `ms`），返回最后一次读数。 */
async function waitReport(evaluate, ms = 6000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await evaluate(STATE);
    if (last && last.hasModal && /对手动向/.test(last.modalTitle || '')) return last;
    await sleep(150);
  }
  return last;
}

/**
 * 把当前所有模态关掉。
 * `openMenu()` 开头 `if (isModalOpen()) return;` —— 过完一天若有 vsPlayer 事件，
 * `showAiDayReport()` 会先弹一屏；此时读菜单会拿到 `items: []`，读成"菜单不见了"。
 * 这不是功能问题，是**读数被挡**，所以先清场再量。
 */
async function clearModals(evaluate) {
  for (let i = 0; i < 6; i++) {
    const had = await evaluate(`(() => {
      if (!document.querySelector('.modal')) return false;
      const b = [...document.querySelectorAll('button, .btn')].find((x) => /^(关闭|返回|继续)$/.test((x.textContent || '').trim()));
      if (b) b.click();
      else { const m = [...document.querySelectorAll('.modal')]; if (m.length) m[m.length - 1].click(); }
      return true;
    })()`);
    if (!had) return true;
    await sleep(220);
  }
  return !(await evaluate(`!!document.querySelector('.modal')`));
}

async function boot(send, evaluate, query) {
  await send('Page.navigate', { url: BASE + query });
  for (let i = 0; i < 200; i++) {
    try {
      if (await evaluate(`!!document.querySelector('#thumb')`)) break;
    } catch {
      /* 导航中 */
    }
    await sleep(100);
  }
  await sleep(2200);
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

      // ---- ① 默认：连过 3 天，不许弹「对手动向」 ----
      await boot(send, evaluate, '');
      const days = [];
      const advances = [];
      for (let d = 0; d < 3; d++) {
        const adv = await nextDay(evaluate);
        advances.push(adv);
        days.push(await evaluate(STATE));
      }
      const daily = days.filter((s) => s.hasModal && /对手动向/.test(s.modalTitle));
      // 三条都要：天真的翻过去了（否则"没弹窗"是假的）、字幕是第 N 天、弹窗 0 次
      const dayOk = advances.every((a) => a.ok);
      const hintOk = days.every((s) => /第 \d+ 天/.test(s.hint));
      check(
        'no-daily',
        '连过 3 天不弹「对手动向」，但字幕仍是「第 N 天」（去掉了噪音、没丢"现在是第几天"）',
        dayOk && daily.length === 0 && hintOk,
        `${dayOk ? '' : `⚠ 没量到：${advances.find((a) => !a.ok).why}｜`}弹窗 ${daily.length}/3 次 · 字幕 ${days.map((s) => `「${s.hint}」`).join(' ')}`,
      );

      // ---- ② 对照臂：?devreport=1 必须弹得出来 ----
      await boot(send, evaluate, '&devreport=1');
      const advRep = await nextDay(evaluate);
      const rep = await waitReport(evaluate);
      check(
        'devreport',
        '?devreport=1 时同一弹窗照样出现（证 no-daily 不是"弹窗坏了"）',
        advRep.ok && !!rep && rep.hasModal && /对手动向/.test(rep.modalTitle),
        `${advRep.ok ? '' : `⚠ 没量到：${advRep.why}｜`}模态=${rep && rep.hasModal} · 标题「${rep ? rep.modalTitle : ''}」`,
      );

      // ---- ③ 未读条数：拇指带无角标，菜单那一行带条数，读完归零 ----
      /* 这一臂**另起一页**：上一臂故意把「对手动向」弹出来了，残留的模态会让 `openMenu()`
         在 `isModalOpen()` 上直接返回（首版就栽在这里：读到 `items: []`，看起来像"菜单没了"）。
         新页只过一天 —— 有 AI 事件进日志，又没有 vsPlayer 事件要弹窗，状态最干净。 */
      await boot(send, evaluate, '');
      const advLog = await nextDay(evaluate);
      await sleep(600);
      await clearModals(evaluate); // 有 vsPlayer 事件时先弹了「对手动向」，不清场 openMenu 会直接返回
      const before = await evaluate(menuRead(true));
      await sleep(900);
      await evaluate(CLOSE_TOP);
      await sleep(700);
      const after = await evaluate(menuRead(false));
      check(
        'logcount',
        '拇指带无数字角标 · 菜单行「事件日志」右侧一枚 N 胶囊（不折行 · 完整句子在 aria-label）· 读过后归零',
        beforeOk(before) && after && after.text === '事件日志' && after.count === null,
        `${advLog.ok ? '' : `⚠ 没量到：${advLog.why}｜`}拇指带角标=${before && before.hasBadgeInThumb} · 读前「${before && before.text}」+胶囊 ${before && before.count} 折行=${before && before.wrap} · aria「${before && before.aria}」· 读后「${after && after.text}」胶囊=${after && after.count}`,
      );

      if (SELFCHECK) {
        /* 负向对照 · 角标那半：把 `.tb-badge` 塞回拇指带的「菜单」按钮，再读一次。
           判据必须**当场翻红** —— 否则 `hasBadgeInThumb === false` 可能只是"页面上根本没有这个类"。
           （条数那半不需要造：`after` 就是"读完之后"的真实状态，`beforeOk(after)` 天然是 false。） */
        await nextDay(evaluate);
        await sleep(600);
        await clearModals(evaluate);
        await evaluate(`(() => {
          const b = [...document.querySelectorAll('#thumb .tb-btn')].find((x) => /菜单/.test(x.textContent || ''));
          if (!b) return 0;
          const sp = document.createElement('span');
          sp.className = 'tb-badge';
          sp.textContent = '15';
          b.appendChild(sp);
          return 1;
        })()`);
        const tampered = await evaluate(menuRead(false));
        check(
          'logcount-ctl',
          '把角标塞回拇指带后同一判据翻红（证它测的是"没有角标"，不是"没有这个类名"）',
          !beforeOk(tampered) && !!tampered && tampered.hasBadgeInThumb === true,
          `塞回后：拇指带角标=${tampered && tampered.hasBadgeInThumb} · 行「${tampered && tampered.text}」⇒ 判据=${beforeOk(tampered) ? '仍绿（错）' : '红（对）'}`,
        );
      }

      if (AS_JSON) console.log(JSON.stringify({ rows, days, rep, before, after }, null, 2));
      code = rows.every((r) => r.ok) ? 0 : 1;
    },
    { devServerPort: PORT, profilePrefix: 'dayflow-' },
  );
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  if (process.env.DF_DEBUG) console.error(e && e.stack ? e.stack : e);
  if (process.env.DF_DEBUG) console.error(e && e.stack ? e.stack : e);
  code = 2;
} finally {
  if (srv && !srv.killed) srv.kill('SIGKILL');
}
if (!AS_JSON) console.log(code === 0 ? '[总结] 全过' : `[总结] FAIL ${rows.filter((r) => !r.ok).length} 条`);
process.exit(code);
