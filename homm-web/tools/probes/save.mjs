#!/usr/bin/env node
/**
 * save.mjs —— 存档 / 读档（§30 / U4）的机检（`npm run probe:save`）。
 *
 * ## 它守什么
 * 多槽化把「一个 key 存一切」变成 **10 个 key × 各自的版本闸**，于是风险全部变了：
 *   P1 自动档的**时点**（推进前 / 推进后，差一天）
 *   P2 「整份状态」是不是真的整份（逐字段深比较）
 *   P3 槽位隔离（写 7 不许动到 6）
 *   P4 覆盖要问、取消零写入
 *   P5 一个坏档只废它自己（不许一档坏了静默变新局）
 *   P6 配额满必须可见（旧实现 `catch {}` 吞掉，UI 仍说"已存档"）
 *   P7 档名的唯一来源是 `weekOf/dayOfWeek`，不是 `state.day`
 *
 * ## 为什么深比较在页面内做
 * 整份 `GameState` 序列化 50–130KB；搬两趟只会让失败信息变成"不相等"。
 * `__save.mark()/diff()` 返回**顶层键的差异清单**，红了直接说是哪个字段没进档。
 *
 * ## 负向对照（两边都证）
 * · `bump()` 改一个必须进档的字段（`log`）⇒ `diff()` 必须变红；
 * · 取消覆盖 ⇒ 该档的 localStorage **字符串逐字节不变**（不是"看起来没变"）。
 *
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足
 */
import { distDir, printHeader, requireFile, freePort, serveInProcess } from '../_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from '../_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=save');
requireFile(DIST, 'main.js');
if (!chromeAvailable()) {
  console.error('✗ 前置不满足：找不到 Chrome（可用 env CHROME 覆盖）。');
  process.exit(2);
}
const PORT = await freePort();
if (!(await serveInProcess(DIST, PORT))) {
  console.error(`✗ 前置不满足：自起 dev server 未就绪（port ${PORT}）。`);
  process.exit(2);
}

const PLAY = `http://127.0.0.1:${PORT}/?devquick=1&devsize=medium&devseed=20260917&devstart=1&devsave=1`;
const START = `http://127.0.0.1:${PORT}/?devstart=1&devsave=1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const PASS = (c, m) => {
  if (!c) bad++;
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`);
};

/**
 * 点击前**先滚到可见**并做命中检查。
 *
 * 教训（2026-11-05 首跑）：792×320 下列表视口只有 233px，第 6 行以后整行都在
 * 折叠线下。直接取 `getBoundingClientRect()` 的中心点是**被裁掉的那部分**，
 * 鼠标事件落在列表外的 `.modal` 上 —— 表现为"点了没反应"，而断言会误报成
 * "覆盖确认没弹 / 存档没写"。所以：先 `scrollIntoView`，再用 `elementFromPoint`
 * 证明这个点真的属于目标（真实玩家的点击也必须成立），否则直接判失败。
 */
const clickJs = (sel) => `(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return { ok: false, reason: 'not-found' };
  if (e.disabled) return { ok: false, reason: 'disabled' };
  e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = e.getBoundingClientRect();
  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  return {
    ok: true, x, y,
    hit: !!hit && (hit === e || e.contains(hit)),
    hitTag: hit ? hit.tagName + '.' + hit.className : 'null',
  };
})()`;

async function click(send, evaluate, sel) {
  const p = await evaluate(clickJs(sel));
  if (!p || !p.ok) {
    console.log(`  · 点不到 ${sel}：${p?.reason ?? 'unknown'}`);
    return p ?? { ok: false };
  }
  if (!p.hit) {
    console.log(`  · ${sel} 被遮挡：点 ${Math.round(p.x)},${Math.round(p.y)} 落在 ${p.hitTag}`);
    return { ok: false, reason: 'covered' };
  }
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(90);
  return { ok: true };
}

/** 关掉面板（走真实出口：头部「返回」）。 */
async function closePanel(send, evaluate) {
  if (!(await evaluate(`!!document.querySelector('.modal.saves')`))) return true;
  const r = await click(send, evaluate, '.modal.saves .modal-head .btn.tiny');
  await sleep(160);
  return r.ok;
}

async function boot(evaluate) {
  for (let i = 0; i < 120; i++) {
    await sleep(120);
    try {
      const ok = await evaluate('!!(window.__save && window.__save.list)');
      if (ok) return true;
    } catch {
      /* 导航中 */
    }
  }
  return false;
}

/** 打开面板（走真实入口 `saveDialog.open`，与菜单点进去同一条路径）。 */
async function openPanel(evaluate, mode) {
  await evaluate(`window.__save.open(${JSON.stringify(mode)})`);
  await sleep(220);
}

const info = (evaluate, slot) => evaluate(`window.__save.info(${JSON.stringify(slot)})`);
const diff = (evaluate) => evaluate('window.__save.diff()');
const raw = (evaluate, key) => evaluate(`localStorage.getItem(${JSON.stringify(key)})`);

try {
  await withHeadlessChrome(async ({ send, evaluate }) => {
    /* ================= A. 几何（792×320 矮机） ================= */
    await send('Emulation.setDeviceMetricsOverride', { width: 792, height: 320, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: PLAY });
    if (!(await boot(evaluate))) {
      PASS(false, '`?devsave=1` 夹具没起来');
      return;
    }

    await openPanel(evaluate, 'save');
    const geo = await evaluate(`(() => {
      const rows = [...document.querySelectorAll('.slot-row')];
      const list = document.querySelector('.sd-list');
      const head = document.querySelector('.modal.saves .modal-head');
      const hr = head.getBoundingClientRect();
      list.scrollTop = 120;
      const hr2 = head.getBoundingClientRect();
      list.scrollTop = 0;
      return {
        n: rows.length,
        h: rows.map(r => Math.round(r.getBoundingClientRect().height)),
        hasAuto: !!document.querySelector('.slot-row[data-slot="auto"]'),
        scrolls: list.scrollHeight > list.clientHeight + 1,
        headFixed: Math.round(hr.y) === Math.round(hr2.y),
        overflowX: list.scrollWidth > list.clientWidth + 1,
      };
    })()`);
    console.log(
      `[矮机] 行 ${geo.n} · 行高 ${[...new Set(geo.h)].join('/')}px · 可滚=${geo.scrolls} · 头部固定=${geo.headFixed}`,
    );
    PASS(geo.n === 8, `P0a 存档模式只列 8 个手动档（实读 ${geo.n}）`);
    PASS(!geo.hasAuto, 'P0b 存档模式**不出现**自动档（自动档只读，不是写入目标）');
    PASS(Math.min(...geo.h) === 44, `P0c 行高 = 44px（触达下限；实测 ${[...new Set(geo.h)].join('/')}）`);
    PASS(geo.scrolls, 'P0d 9/8 行放不下时列表滚动（不是把行压扁）');
    PASS(geo.headFixed, 'P0e 滚动时头部不动（R3：出口不滚走）');
    PASS(!geo.overflowX, 'P0f 列表没有横向溢出');

    /* ================= P1 自动档时点 ================= */
    /* 先退出面板：`doEndDay()` 的第一道守卫就是 `isModalOpen()` —— 面板开着点按钮
       会被静默吃掉（首跑就是这么红的，看着像"结束一天坏了"）。 */
    const closed = await closePanel(send, evaluate);
    PASS(closed && !(await evaluate('!!document.querySelector(".modal.saves")')), 'P1a0 进入 P1 时面板已关闭（不是开着面板点按钮）');

    const dayBefore = await evaluate('window.__save.day()');
    const mpBefore = await evaluate('window.__save.mp()');
    const autoBefore = await info(evaluate, 'auto');
    /* 走真实按钮（不是调 `endDay()`）：存档点就挂在 `doEndDay()` 里。 */
    const clicked = await click(send, evaluate, '.btn.tb-btn.tb-end');
    PASS(clicked.ok, 'P1a 找到并点了「结束一天」');
    await sleep(900);
    const dayAfter = await evaluate('window.__save.day()');
    const auto = await info(evaluate, 'auto');
    const resume = await info(evaluate, 'resume');
    console.log(
      `[P1] day ${dayBefore}→${dayAfter} · 自动档 day=${auto.day} · ` +
        `savedAt auto=${auto.savedAt} resume=${resume.savedAt} · 行动前 mp=${mpBefore}`,
    );
    PASS(dayAfter === dayBefore + 1, `P1b 游戏推进了一天（${dayBefore} → ${dayAfter}）`);
    PASS(auto.status === 'ok', `P1c 自动档已写入（status=${auto.status}）`);
    /* ★ 核心：自动档必须是**推进前**的那一天。写成推进后 = 差一天，且 AI 行动已不可撤销。 */
    PASS(auto.day === dayBefore, `P1d 自动档记的是**推进前**那天（${auto.day} 应 ${dayBefore}，不是 ${dayAfter}）`);
    PASS(
      auto.savedAt > autoBefore.savedAt,
      `P1e 自动档确实被这次「结束一天」刷过（${autoBefore.savedAt} → ${auto.savedAt}）`,
    );
    PASS(resume.savedAt >= auto.savedAt, 'P1f 救援档不比自动档旧（SA6：否则「继续」会退回今天）');

    /* ================= P6 配额（先做，免污染后面的状态） ================= */
    await evaluate(`(() => {
      window.__origSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); };
      return true;
    })()`);
    await openPanel(evaluate, 'save');
    await click(send, evaluate, '.slot-row[data-slot="slot8"]');
    await sleep(200);
    const quota = await evaluate(`(() => {
      const m = document.querySelector('.sd-msg');
      return {
        msg: m ? m.textContent : '',
        stillOpen: !!document.querySelector('.modal.saves'),
        slot8: window.__save.info('slot8').status,
      };
    })()`);
    await evaluate('Storage.prototype.setItem = window.__origSetItem; true');
    console.log(`[P6] msg="${quota.msg}" · 面板仍开=${quota.stillOpen} · slot8=${quota.slot8}`);
    PASS(/空间不足/.test(quota.msg), 'P6a 配额失败有明说「存档失败：空间不足」（旧实现是静默吞掉）');
    PASS(quota.stillOpen, 'P6b 失败时面板不关（关了就变成"看起来存上了"）');
    PASS(quota.slot8 === 'empty', 'P6c 失败的那一档没有写进去');
    await evaluate('document.querySelector("#modal-root")?.remove(); true');
    await sleep(150);

    /* ================= P2 逐字段深比较 ================= */
    /* 先给两个**可选字段**塞值（开局第一天它们往往是 undefined）：白名单裁字段
       只在"有值"时才会暴露 —— undefined 被裁掉再读回来还是 undefined。 */
    const poke = await evaluate('window.__save.poke()');
    await evaluate('window.__save.bump()'); // 日志先有一条，P2c 才不是空判
    const markLen = await evaluate('window.__save.mark()');
    await openPanel(evaluate, 'save');
    const s5click = await click(send, evaluate, '.slot-row[data-slot="slot5"]');
    await sleep(250);
    const s5 = await info(evaluate, 'slot5');
    PASS(s5click.ok && s5.status === 'ok', `P2a 空档点了就能写（slot5=${s5.status}）`);

    const shell = await evaluate(`(() => {
      const raw = localStorage.getItem('homm-save-slot5');
      if (!raw) return null;
      const sh = JSON.parse(raw);
      const st = sh.state || {};
      const t = st.towns?.[${JSON.stringify(poke.tid)}] || {};
      return {
        shell: sh.shell,
        savedAt: sh.savedAt,
        logLen: (st.log || []).length,
        probeLog: (st.log || []).some(e => String(e.text).includes('[probe]')),
        heroOrder: (st.heroOrder || []).length,
        nextObjectId: st.nextObjectId,
        growth: t.growthRemainder?.[${JSON.stringify(poke.uid)}],
        noTownDays: st.players?.[${JSON.stringify(poke.pid)}]?.noTownDays,
        revealed: (st.players?.p1?.revealed || []).length,
        bytes: raw.length,
      };
    })()`);
    console.log(
      `[P2] 档 ${Math.round((shell?.bytes ?? 0) / 1024)}KB · 外壳 shell=${shell?.shell} · ` +
        `log ${shell?.logLen} 条 · 增长余数 ${shell?.growth} · 无城天数 ${shell?.noTownDays}`,
    );
    PASS(shell && shell.shell === 1 && shell.savedAt > 0, 'P2b 外壳是 `{shell:1, savedAt, state}`，时间戳在外壳');
    PASS((shell?.logLen ?? 0) > 0 && shell.probeLog, `P2c 日志进了档（${shell?.logLen} 条，含探针那条）`);
    PASS((shell?.heroOrder ?? 0) > 0, 'P2d `heroOrder` 顺序进了档');
    PASS(typeof shell?.nextObjectId === 'number', 'P2e `nextObjectId` 进了档');
    PASS(shell?.growth === 0.5, `P2f 城的 \`growthRemainder\` 逐值进档（${JSON.stringify(shell?.growth)} 应 0.5）`);
    PASS(shell?.noTownDays === 3, `P2g 玩家的 \`noTownDays\` 逐值进档（${JSON.stringify(shell?.noTownDays)} 应 3）`);
    PASS((shell?.revealed ?? 0) > 0, `P2h 迷雾掩码进了档（${shell?.revealed} 格）`);

    /* 负向对照：改一个必须进档的字段 ⇒ diff 必须发现 */
    await evaluate('window.__save.bump()');
    const badDiff = await diff(evaluate);
    PASS(!badDiff.equal && badDiff.diff.includes('log'), `P2i 负向对照：改了 log ⇒ diff 变红（${badDiff.diff.join(',')}）`);

    /* 读回来 ⇒ 与存档那一刻**逐字段相同** */
    await openPanel(evaluate, 'load');
    await click(send, evaluate, '.slot-row[data-slot="slot5"]');
    await sleep(200);
    const asked = await evaluate('!!document.querySelector("[data-ask-ok]")');
    PASS(asked, 'P2j 读档前有二次确认（「当前进度将丢弃」）');
    await click(send, evaluate, '[data-ask-ok]');
    await sleep(600);
    const same = await diff(evaluate);
    console.log(`[P2] 读档后 diff=${same.equal ? '逐字段相同' : same.diff.join(',')} · 快照 ${markLen}B`);
    PASS(same.equal, `P2k 读档后与存档那一刻**逐字段相同**（差异：${same.diff.join(',') || '无'}）`);

    /* ================= P3 槽位隔离 ================= */
    await openPanel(evaluate, 'save');
    await click(send, evaluate, '.slot-row[data-slot="slot6"]');
    await sleep(250);
    const s6before = await info(evaluate, 'slot6');
    const s6raw = await raw(evaluate, 'homm-save-slot6');
    PASS(s6before.status === 'ok', 'P3a slot6 已写入');

    await evaluate('window.__save.bump()'); // 状态变了，再写另外两档
    await openPanel(evaluate, 'save');
    await click(send, evaluate, '.slot-row[data-slot="slot7"]');
    await sleep(250);
    const s7 = await info(evaluate, 'slot7');
    PASS(s7.status === 'ok', 'P3b slot7 已写入（内容与 slot6 不同）');
    PASS(
      (await raw(evaluate, 'homm-save-slot6')) === s6raw,
      'P3c 写 slot7 **没有碰** slot6（localStorage 字符串逐字节不变）',
    );

    await openPanel(evaluate, 'load');
    await click(send, evaluate, '.slot-row[data-slot="slot6"]');
    await sleep(180);
    await click(send, evaluate, '[data-ask-ok]');
    await sleep(600);
    const afterLoad6 = await diff(evaluate);
    PASS(afterLoad6.equal, `P3d 读回 slot6 拿到的是那一份（差异：${afterLoad6.diff.join(',') || '无'}）`);

    /* ================= P4 覆盖取消 ================= */
    await openPanel(evaluate, 'save');
    const beforeOverwrite = { raw: await raw(evaluate, 'homm-save-slot6'), at: (await info(evaluate, 'slot6')).savedAt };
    await click(send, evaluate, '.slot-row[data-slot="slot6"]');
    await sleep(200);
    const ask = await evaluate(`(() => {
      const b = document.querySelector('.sd-body');
      const p = document.querySelector('.sd-ask p');
      return { kind: b?.dataset.ask ?? '', text: p ? p.textContent : '' };
    })()`);
    console.log(`[P4] ask=${ask.kind} · "${ask.text}"`);
    PASS(ask.kind === 'overwrite', `P4a 点已占用的档会先问（ask=${ask.kind}）`);
    PASS(/覆盖/.test(ask.text) && /档位 6/.test(ask.text), `P4b 问句写清了覆盖哪一档（"${ask.text}"）`);
    await click(send, evaluate, '[data-ask-cancel]');
    await sleep(250);
    const afterCancel = {
      raw: await raw(evaluate, 'homm-save-slot6'),
      at: (await info(evaluate, 'slot6')).savedAt,
      open: await evaluate('!!document.querySelector(".modal.saves")'),
      ask: await evaluate('!!document.querySelector(".sd-ask")'),
    };
    PASS(afterCancel.at === beforeOverwrite.at, `P4c 取消后 savedAt 不变（${afterCancel.at}）`);
    PASS(afterCancel.raw === beforeOverwrite.raw, 'P4d 取消 ⇒ 该档**零写入**（字符串逐字节不变）');
    PASS(afterCancel.open && !afterCancel.ask, 'P4e 取消后回到列表（不是把面板关掉）');
    await evaluate('document.querySelector("#modal-root")?.remove(); true');

    /* ================= P7 档名 ================= */
    await openPanel(evaluate, 'load');
    /* 用**已写入的** slot5 做样本：空档的 day 是 0，拿它算周次得到"第 0 周第 0 天"，
       是尺子自己错了（首跑就这么误报的）。 */
    const nine = await evaluate(`(() => ({
      n: document.querySelectorAll('.slot-row').length,
      hasAuto: !!document.querySelector('.slot-row[data-slot="auto"]'),
      text: document.querySelector('.slot-row[data-slot="slot5"]').textContent,
    }))()`);
    const s1 = await info(evaluate, 'slot5');
    const wk = Math.floor((s1.day - 1) / 7) + 1;
    const dw = ((s1.day - 1) % 7) + 1;
    const want = `第 ${wk} 周第 ${dw} 天`;
    console.log(`[P7] 读档 ${nine.n} 行 · slot5 行="${nine.text.trim()}" · 期望含"${want}"（day=${s1.day}）`);
    PASS(nine.n === 9 && nine.hasAuto, `P7a 读档模式 9 行且含自动档（实读 ${nine.n} 行）`);
    PASS(s1.status === 'ok' && nine.text.includes(want), `P7b 档名 = weekOf/dayOfWeek 的结果（"${want}"）`);
    PASS(!nine.text.includes(`D${s1.day}`), `P7c 不印裸天数（不许出现 D${s1.day}）`);

    /* ================= P5 单档版本失效（重新启动） ================= */
    await evaluate(`(() => {
      const raw = localStorage.getItem('homm-save-slot7');
      const sh = JSON.parse(raw);
      sh.state.version = 999;
      localStorage.setItem('homm-save-slot7', JSON.stringify(sh));
      return true;
    })()`);
    await send('Page.navigate', { url: START });
    if (!(await boot(evaluate))) {
      PASS(false, 'P5 重启后夹具没起来');
      return;
    }
    await sleep(900); // 等开始页渲染
    const p5 = await evaluate(`(() => {
      const note = document.querySelector('.ss-note');
      const cont = document.querySelector('#ss-continue');
      return {
        note: note ? note.textContent : '',
        stale: note?.dataset.stale ?? '',
        cont: cont ? cont.textContent : '',
        s7: window.__save.info('slot7').status,
        s6: window.__save.info('slot6').status,
        latest: window.__save.latest(),
      };
    })()`);
    console.log(`[P5] note="${p5.note}" · slot7=${p5.s7} · slot6=${p5.s6} · 继续="${p5.cont}"`);
    PASS(p5.s7 === 'stale', `P5a 被改坏的那一档单独失效（slot7=${p5.s7}）`);
    PASS(p5.s6 === 'ok', `P5b 其余档照常可读（slot6=${p5.s6}）`);
    PASS(/旧存档已随版本更新失效/.test(p5.note), 'P5c 开始页明说失效（不许静默变新局）');
    PASS(!!p5.latest, `P5d 「继续」仍指向可读的档（${p5.latest}）`);
    PASS(/周/.test(p5.cont), `P5e 「继续」写明了是哪一份（"${p5.cont.replace(/\s+/g, ' ').trim()}"）`);

    /* ================= 设计尺寸下的行高不变 ================= */
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: PLAY });
    if (!(await boot(evaluate))) {
      PASS(false, '844×390 重启后夹具没起来');
      return;
    }
    await openPanel(evaluate, 'load');
    const tall = await evaluate(`(() => {
      const rows = [...document.querySelectorAll('.slot-row')];
      const box = document.querySelector('.modal.saves').getBoundingClientRect();
      return { h: rows.map(r => Math.round(r.getBoundingClientRect().height)), w: Math.round(box.width), hh: Math.round(box.height) };
    })()`);
    console.log(`[设计尺寸] 盒 ${tall.w}×${tall.hh} · 行高 ${[...new Set(tall.h)].join('/')}px`);
    PASS(Math.min(...tall.h) === 44, `P8 844×390 行高仍是 44px（${[...new Set(tall.h)].join('/')}）`);
    PASS(tall.w <= 421, `P9 盒宽 ≤ 420（实测 ${tall.w}）`);
  });
} catch (e) {
  console.error('✗ 运行失败：', e);
  process.exit(2);
}

console.log(bad === 0 ? '\n✓ probe:save 全过' : `\n✗ ${bad} 条不过`);
process.exit(bad === 0 ? 0 : 1);
