#!/usr/bin/env node
/**
 * castbeat.mjs —— §11.2 施法时序（800ms 三段 + 点击跳到结算）的机检（`npm run probe:castbeat`）。
 *
 * ## 它守什么
 * §11.2 的两句话**不是美术**，是承诺：
 *   · 「总 800ms = 前摇 180 + 演出 420 + 结算 200」—— 三段的**顺序**与**边界**；
 *   · 「可点击跳到结算，**不跳过伤害**」—— 点快了也必须看到伤害数字。
 * 这两句都能被静默破坏：把三段合成一段（"反正都播了"）画面看着没差，
 * 但前摇没了=没有"锁定目标"的预告，结算没了=伤害数字和演出同帧冒出来。
 *
 * ## 两组尺子（一个来源各一把）
 *   [A] **纯函数**：`ui/castTimeline.ts` 的 `castFrame()` —— 边界 179/180、599/600、799/800。
 *       探针 import 这个模块，**不在探针里重抄 180/420/200**（否则改一处另一处静默过期）。
 *       [A5] 是负向对照：把三段压成"一上来就结算"的假实现，必须在同一条判据上失败。
 *   [B] **真演出**（无头 Chrome）：开一场战斗、真点施法、读 `window.__castTrace`。
 *       轨迹由 `BattleScreen` 在**跨段那一帧**记 `{phase, at}`（`at` = `anim.t` 毫秒，已乘
 *       演出倍率）⇒ 边界与倍率无关，也不受主线程抖动影响（比轮询采样稳）。
 *       · [B1] 顺序：windup → show → settle → done → end，一次都不许跳；
 *       · [B2] 边界：show@180±25 / settle@600±25 / end ∈ [790, 900]；
 *       · [B3] **伤害只在结算段**：`settled` 的 `at ≥ 595`，`fx` 的 `at ≥ 175`
 *              （反过来就是"演出还没开始，伤害数字已经飘完了"）；
 *       · [B4] 点一下（在 show 段内）⇒ 轨迹多出 `skip`，且 `skip` 后 ≤120ms 内结束，
 *              同时 `settled` **仍在**（这条就是"不跳过伤害"）；
 *       · [B5] 跳过之后没有残留状态（`end` 之后 `cast`/`arrow` 已清）；
 *       · [B6] 前摇**真的画了**目标格描边（采样到 `__battleScene.cast` 非空）；
 *       · [B7] 施法方**真的抬手**（前摇期间 `__battleLunge` 非空 ⇒ 该单位在画 atk 帧）。
 *
 * ## 负向对照（复跑手册）
 * · 把 `CAST_SHOW_MS` 改成 0 ⇒ [A1] 180 处直接 settle，必红；
 * · `settle()` 不幂等（去掉 `settled` 守）⇒ [B1] 出现两次 settle，必红；
 * · 点击处理器把 skip 分支放到 `busy()` 之后 ⇒ [B4] 没有 `skip`，必红；
 * · `skip()` 只设 `t` 不调 `settle()` ⇒ [B4b] `settled` 落到 817（实测过，红）；
 * · `drawCastWindup` 挪到 `drawUnits` 之前 ⇒ 描边被躯干盖掉（只剩几段碎线，1× 下几乎看不见）；
 * · 前摇不设 `lunge` ⇒ [B7] 红。
 *
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足（缺 dist / 缺 Chrome / dev server 起不来）
 */
import { distDir, distUrl, printHeader, requireFile, freePort, serveInProcess } from '../_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from '../_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=castbeat');
requireFile(DIST, 'main.js');
const T = await import(distUrl('ui/castTimeline.js', DIST));

let bad = 0;
const PASS = (c, m) => {
  if (!c) bad++;
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- [A] 时序纯函数 ---------------- */

const { CAST_WINDUP_MS, CAST_SHOW_MS, CAST_SETTLE_MS, CAST_TOTAL_MS, castFrame } = T;
const f0 = castFrame(0);
const f179 = castFrame(CAST_WINDUP_MS - 1);
const f180 = castFrame(CAST_WINDUP_MS);
const f599 = castFrame(CAST_WINDUP_MS + CAST_SHOW_MS - 1);
const f600 = castFrame(CAST_WINDUP_MS + CAST_SHOW_MS);
const f800 = castFrame(CAST_TOTAL_MS);

PASS(
  CAST_WINDUP_MS === 180 && CAST_SHOW_MS === 420 && CAST_SETTLE_MS === 200 && CAST_TOTAL_MS === 800,
  `[A0] 三段与总量 = 规格的 180 / 420 / 200 / 800（实测 ${CAST_WINDUP_MS} / ${CAST_SHOW_MS} / ${CAST_SETTLE_MS} / ${CAST_TOTAL_MS}）`,
);

PASS(
  f0.phase === 'windup' && f0.windup && !f0.settle && f179.windup && f180.phase === 'show' && !f180.windup,
  `[A1] 前摇恰好到 ${CAST_WINDUP_MS}ms：0→windup、${CAST_WINDUP_MS - 1}→windup、${CAST_WINDUP_MS}→show`,
);

PASS(
  !f599.settle && f600.settle && f600.phase === 'settle' && f800.settle && f800.phase === 'done',
  `[A2] 结算是"上一毫秒还没有、这一毫秒开始"：${CAST_WINDUP_MS + CAST_SHOW_MS - 1} 无 / ${CAST_WINDUP_MS + CAST_SHOW_MS} 有 / 800 done`,
);

/* 演出段进度必须严格单调（否则弹体中途会往回飞） */
let mono = true;
let prev = -1;
for (let ms = CAST_WINDUP_MS; ms <= CAST_WINDUP_MS + CAST_SHOW_MS; ms += 10) {
  const k = castFrame(ms).show;
  if (k < prev) mono = false;
  prev = k;
}
PASS(mono && Math.abs(castFrame(CAST_WINDUP_MS).show) < 1e-9 && Math.abs(f599.show - 1) < 0.01, '[A3] 演出进度 0→1 单调，起点 0 / 终点 ≈1');

/* 越界与非法输入不许产生 NaN（`end` 段还会被调一次 step(1)，非有限值会画出 NaN 圆） */
const neg = castFrame(-50);
const nan = castFrame(Number.NaN);
const far = castFrame(99999);
PASS(
  Number.isFinite(neg.show) && neg.phase === 'windup' &&
    Number.isFinite(nan.show) && nan.phase === 'windup' &&
    Number.isFinite(far.show) && far.phase === 'done' && far.settle === true,
  '[A4] 越界/NaN 输入被钳住（负数与 NaN 按 0 算、超时按 done 算，进度无 NaN）',
);

/* 负向对照：把三段压成"一上来就结算"的假实现，必须在 [A2] 那条判据上失败 */
const flat = (ms) => ({ phase: ms >= CAST_TOTAL_MS ? 'done' : 'show', show: 1, local: 1, windup: false, settle: true });
const flatCaught = !flat(0).windup && flat(0).settle && flat(CAST_WINDUP_MS + CAST_SHOW_MS - 1).settle;
PASS(flatCaught, `[A5] 负向对照：压成一段的假实现在 [A2] 上必红（它在 0ms 就已经 settle=true）`);

/* ---------------- [B] 真演出（无头 Chrome） ---------------- */

if (!chromeAvailable()) {
  console.error('✗ 前置不满足：找不到 Chrome（可用 env CHROME 覆盖）。');
  process.exit(2);
}
const PORT = await freePort();
if (!(await serveInProcess(DIST, PORT))) {
  console.error(`✗ 前置不满足：自起 dev server 未就绪（port ${PORT}）。`);
  process.exit(2);
}
const URL = `http://127.0.0.1:${PORT}/?devquick=1&devbattle=1&devprobe=1`;

/** 开一场战斗 → 打开法术书 → 选第一个可用法术 → 点敌方第一支部队。 */
const OPEN_AND_CAST = `(() => {
  const sc = window.__battleScene;
  if (!sc) return 'no-scene';
  const cv = document.querySelector('.bt-canvas');
  if (!cv) return 'no-canvas';
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('施法'));
  if (!btn) return 'no-cast-btn';
  btn.click();
  const sp = [...document.querySelectorAll('.bt-spells button')].find((b) => !b.disabled);
  if (!sp) return 'no-spell';
  sp.click();
  const foe = sc.units.filter((u) => u.side !== 0).sort((a, b) => b.bx - a.bx)[0];
  if (!foe) return 'no-foe';
  const r = cv.getBoundingClientRect();
  const k = r.width / sc.baseW;
  const x = r.left + (foe.fx + sc.pad) * k;
  const y = r.top + (foe.fy + sc.pad) * k;
  cv.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
  return 'ok';
})()`;

/** 演出中在画布上点一下（触发 §11.2 的"跳到结算"）。 */
const TAP = `(() => {
  const cv = document.querySelector('.bt-canvas');
  if (!cv) return false;
  const r = cv.getBoundingClientRect();
  cv.dispatchEvent(new MouseEvent('click', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true }));
  return true;
})()`;

async function runArm(skip) {
  return withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Page.navigate', { url: URL });
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      if (await evaluate('!!window.__battleScene').catch(() => false)) break;
    }
    const opened = await evaluate(OPEN_AND_CAST);
    if (opened !== 'ok') return { opened, trace: [], after: null, sawOutline: false, sawLunge: false };

    /* 边等边采样前摇：`__battleLunge` / `__battleScene.cast` 只在**当帧**有值，
       事后读只能读到 null。"前摇真的画了东西"必须在这一段里抓。 */
    let sawOutline = false;
    let sawLunge = false;
    let clicked = false;
    let trace = [];
    for (let i = 0; i < 220; i++) {
      trace = await evaluate('window.__castTrace || []').catch(() => []);
      const has = (ph) => trace.some((m) => m.phase === ph);
      if (has('windup')) {
        const st = await evaluate(
          '({ lunge: window.__battleLunge || null, cast: window.__battleScene ? window.__battleScene.cast : null })',
        ).catch(() => null);
        if (st && st.cast) sawOutline = true;
        if (st && st.lunge) sawLunge = true;
      }
      // 等到"演出段"已经开始再点：不管演出倍率是 1/2/3，都在模板起演之后
      if (skip && !clicked && has('show')) {
        clicked = true;
        await evaluate(TAP);
      }
      if (has('end')) break;
      await sleep(20);
    }
    await sleep(200);
    const after = await evaluate('window.__battleScene ? { arrow: window.__battleScene.arrow, cast: window.__battleScene.cast } : null').catch(() => null);
    return { opened, trace, after, sawOutline, sawLunge };
  });
}

const armA = await runArm(false);
const armB = await runArm(true);

const traceOf = (arm) => (arm.trace || []).map((m) => `${m.phase}@${m.at}`).join(' → ');
const wallOf = (trace, phase) => {
  const m = (trace || []).find((x) => x.phase === phase);
  return m ? m.ms : null;
};
const at = (trace, phase) => {
  const m = (trace || []).find((x) => x.phase === phase);
  return m ? m.at : null;
};

PASS(armA.opened === 'ok', `[B0a] 真点施法成功（${armA.opened}）`);
PASS(armB.opened === 'ok', `[B0b] 第二臂真点施法成功（${armB.opened}）`);

const tA = armA.trace || [];
const order = ['windup', 'show', 'settle', 'done', 'end'];
// 只取五段"主拍"（`fx`/`settled` 是段内事件，不参与顺序判定）
const seq = tA.map((m) => m.phase).filter((p) => order.includes(p)).filter((p, i, a) => a.indexOf(p) === i);
PASS(
  order.every((p) => tA.some((m) => m.phase === p)) && seq.join(',') === order.join(','),
  `[B1] 顺序 windup→show→settle→done→end（实测 ${traceOf(armA)}）`,
);

const showAt = at(tA, 'show');
const settleAt = at(tA, 'settle');
const endAt = at(tA, 'end');
PASS(
  showAt !== null && Math.abs(showAt - CAST_WINDUP_MS) <= 25 &&
    settleAt !== null && Math.abs(settleAt - (CAST_WINDUP_MS + CAST_SHOW_MS)) <= 25 &&
    endAt !== null && endAt >= CAST_TOTAL_MS - 10 && endAt <= CAST_TOTAL_MS + 100,
  `[B2] 边界落位：show@${showAt}（180±25）· settle@${settleAt}（600±25）· end@${endAt}（800+）`,
);

const fxAt = at(tA, 'fx');
const settledAt = at(tA, 'settled');
PASS(
  fxAt !== null && fxAt >= CAST_WINDUP_MS - 5 && settledAt !== null && settledAt >= CAST_WINDUP_MS + CAST_SHOW_MS - 5,
  `[B3] 演出与伤害都不抢跑：fx@${fxAt} ≥175 · settled@${settledAt} ≥595`,
);

const tB = armB.trace || [];
const skipAt = at(tB, 'skip');
const bEnd = at(tB, 'end');
const bSettled = at(tB, 'settled');
/* "跳完"要看**墙钟**：`at` 被 `skip()` 直接拽到 800，`end.at − skip.at` 恒 ≈617，
 * 量不出"点了之后多快结束"。墙钟差才能证"一下子就到结算"，不是又播了一件。 */
const skipWall = wallOf(tB, 'skip');
const endWall = wallOf(tB, 'end');
PASS(
  skipAt !== null && skipAt >= CAST_WINDUP_MS && skipAt < CAST_TOTAL_MS &&
    bEnd !== null && bEnd >= CAST_TOTAL_MS &&
    endWall !== null && skipWall !== null && endWall - skipWall <= 120,
  `[B4a] 演出中点击 ⇒ skip@${skipAt} → 结束@${bEnd}（墙钟 ${endWall === null ? 'null' : endWall - skipWall}ms ≤ 120）`,
);
/* 只看"有没有 settled"分辨力不够：`step(done)` 里还有一次兜底 `settle()`，
 * 就算 `skip()` 忘了结算，伤害数字也会在下一帧补上 —— 那是对的设计，但它让这条判据
 * 变成恒真。要证的是"**点下的那一帧就结算**"，不是"过一帧也会结算"。 */
PASS(
  bSettled !== null && skipAt !== null && bSettled <= skipAt + 40,
  `[B4b] **不跳过伤害**：skip@${skipAt} 当帧即结算 settled@${bSettled}（≤ +40ms）`,
);

PASS(
  armA.after && armA.after.arrow === null && armA.after.cast === null &&
    armB.after && armB.after.arrow === null && armB.after.cast === null,
  `[B5] 演完没有残留状态（arrow=${JSON.stringify(armA.after && armA.after.arrow)}/${JSON.stringify(armB.after && armB.after.arrow)} · cast=${JSON.stringify(armA.after && armA.after.cast)}/${JSON.stringify(armB.after && armB.after.cast)}）`,
);

PASS(
  armA.sawOutline && armB.sawOutline,
  `[B6] 前摇真的画了目标格描边（两臂都采到 \`__battleScene.cast\` 非空：${armA.sawOutline}/${armB.sawOutline}）`,
);
PASS(
  armA.sawLunge && armB.sawLunge,
  `[B7] 施法方确实"抬手"（前摇期间 \`__battleLunge\` 非空 = 该单位在画 atk 帧：${armA.sawLunge}/${armB.sawLunge}）`,
);

console.log('');
/* `serveInProcess` 让事件循环常驻 ⇒ **判词先于退出**，且必须显式 exit（GATES §五）。 */
if (bad) {
  console.log(`✗ ${bad} 条不过`);
  process.exit(1);
}
console.log('✓ 全过');
process.exit(0);
