#!/usr/bin/env node
/**
 * pathflowprobe.mjs —— 预览路径「流动」门（`npm run probe:pathflow`）。
 *
 * ## 为什么要这把尺
 * 虚线只说明"这条路要分几天"，说不出"**往那边走**"。这一层让"明天"那一段的虚线
 * 沿路线向前走（HoMM3 同款），方向不用再加箭头或文字。
 *
 * 但"在动"这件事最难验：
 *   · 只量一次相位 → 只能证明"有个数在变"，证明不了画面上在动；
 *   · 只比两张截图 → 会连**今天那段实线**也一起比，而它本来就不该动。
 * 所以判据分两层，且**同一时刻取两次**：
 *   ① 结构层：`flow.offset`（世界 px 相位）在 Δt 内前进，且不越出周期；
 *   ② 像素层：明天段的中点上，"实/空"分布必须**变了**；今天段的中点必须**一个字都没变**。
 *
 * 另外两条必须有的对照：
 *   · `?devflow=0`：相位恒 0、像素不变（证判据量的是这一层，不是地图自己在动）；
 *   · `prefers-reduced-motion: reduce`：整层静止（无障碍要求，也是 DOM 层唯一能机检的一条）。
 *
 * 速度不再写死（§25）：
 *   · `flow-wired` —— 这一帧的 `mp` 必须就是英雄一整天的移动力，`speed` = 9 × clamp(mp/1800)；
 *   · `flow-pace`  —— `?devpathpace=1200` 与 `=2700` 两臂各量**每秒相位前进**，比值 ≈ 1.75。
 *     只读回传的 `speed` 等于在测公式本身，所以这里量的是动画真的快了。
 *
 * 用法：`node tools/pathflowprobe.mjs [--json] [--light=0.68] [--seed=…] [--dt=360]`
 * 退出码：0 全过 / 1 有判据不过
 */
import { spawn } from 'node:child_process';
import { withHeadlessChrome, checkDevServer } from './_chrome.mjs';

const opt = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const PORT = Number(opt('port', 5209));
const AS_JSON = process.argv.includes('--json');
const SEED = opt('seed', '20260917');
const LIGHT = opt('light', '0.68');
/** 两次取样的间隔（ms）。0.36s × 9 世界 px/s ≈ 3.2px，约半个虚线周期 —— 足够翻好几枚采样。 */
const DT = Number(opt('dt', 360));
/** 临时移动力：200 ⇒ 今天 2 格、明天 2~3 格，两段都在 844×390 内。 */
const MP = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE =
  `http://127.0.0.1:${PORT}/index.html?devquick=1&devreveal=1&devprobe=1&devbandstats=1` +
  `&devreachprobe=1&devseed=${SEED}&devlight=${LIGHT}`;

const rows = [];
const check = (id, label, ok, detail) => {
  rows.push({ id, ok, label, detail });
  if (!AS_JSON) console.log(`${ok ? '✅' : '❌'} [${id}] ${label} — ${detail}`);
};

/** 把两组中点采样按世界坐标对起来，返回"实/空"翻转的个数。 */
function flips(a, b) {
  const A = new Map((a || []).map((q) => [`${q.wx},${q.wy}`, q.spread]));
  let n = 0;
  for (const q of b || []) {
    const prev = A.get(`${q.wx},${q.wy}`);
    if (prev === undefined) continue;
    // 虚线的实段 spread ≈ 200、空档 ≈ 5~25 ⇒ 阈值 40 分得很开
    if ((prev > 40) !== (q.spread > 40)) n++;
  }
  return n;
}

/** 一臂：导航 → 摆一条跨天路径 → 间隔 DT 读两次。 */
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
  await sleep(1200);
  for (let i = 0; i < 40; i++) {
    if (await evaluate('!!window.__bandStats')) break;
    await sleep(150);
  }
  await sleep(300);
  const hook = await evaluate(
    `window.__mapPreviewDay ? window.__mapPreviewDay(${MP}) : { ok: false }`,
  );
  await sleep(420);
  /* 两次读数前后各取一次**页面自己的**时钟：Node 侧的 `sleep` 不含 evaluate 往返，
     而 `flow-pace` 要算"每秒前进多少"。用页面时钟把这段开销一起算进分母。 */
  const t1 = await evaluate('performance.now()');
  const p1 = await evaluate('window.__mapPathProbe ? window.__mapPathProbe() : null');
  await sleep(DT);
  const p2 = await evaluate('window.__mapPathProbe ? window.__mapPathProbe() : null');
  const t2 = await evaluate('performance.now()');
  if (!AS_JSON) {
    const d1 = (p1 && p1.day) || {};
    const f1 = d1.flow || {};
    console.log(
      `[${label}] 路径 ${hook && hook.n ? hook.n : '?'} 步 · 交界 ${d1.cut}/${d1.len}` +
        ` · 流动 on=${f1.on} 相位 ${f1.offset}/${f1.period} · reduced=${f1.reduced}`,
    );
  }
  return { hook, p1, p2, t1, t2 };
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
      await send('Emulation.setDeviceMetricsOverride', {
        width: 844,
        height: 390,
        deviceScaleFactor: 2,
        mobile: true,
      });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      /** `reduce` = 连系统"减少动态"一起模拟；判据 `flow-reduced` 要用。 */
      const media = (reduce) =>
        send('Emulation.setEmulatedMedia', {
          features: [
            { name: 'hover', value: 'none' },
            { name: 'pointer', value: 'coarse' },
            ...(reduce ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : []),
          ],
        });
      await media(false);

      // ---- 1. 默认：虚线段在动，今天段不动 ----
      const A = await arm(send, evaluate, '', '默认（流动开）');
      const a1 = (A.p1 && A.p1.day) || {};
      const a2 = (A.p2 && A.p2.day) || {};
      const f1 = a1.flow || {};
      const f2 = a2.flow || {};
      const period = f1.period || 7.2;
      /* 相位差：两帧可能跨过周期回绕，取模到 [0, period) 再判"确实前进了"。
         速度 9px/s、间隔 0.36s ⇒ 期望 3.24px；给一半的容差（定时器抖动 + rAF 抓帧）。 */
      const raw = (f2.offset ?? 0) - (f1.offset ?? 0);
      const adv = ((raw % period) + period) % period;
      check(
        'flow-advance',
        '虚线相位在 Δt 内前进（且没有越出周期）',
        f1.on === true && f2.on === true && adv > 0.6 && adv < period - 0.6,
        `相位 ${f1.offset} → ${f2.offset}（周期 ${period}，前进 ${adv.toFixed(2)}，期望 ≈ ${((9 * DT) / 1000).toFixed(2)}）`,
      );

      const nextFlips = flips(a1.next && a1.next.finePer, a2.next && a2.next.finePer);
      const nowFlips = flips(a1.now && a1.now.finePer, a2.now && a2.now.finePer);
      check(
        'flow-pixels',
        '明天段的实/空分布在两帧之间变了，今天段一个字都没变',
        nextFlips >= 2 && nowFlips === 0,
        `明天翻转 ${nextFlips} 枚 / 今天翻转 ${nowFlips} 枚（今天 ${(a1.now && a1.now.fineN) || 0} 枚、明天 ${(a1.next && a1.next.fineN) || 0} 枚采样）`,
      );

      /* --- 速度按移动力缩放：先对"接线"，再量"真的变快了" ---
         ① 接线：这一帧回传的 `mp` 必须就是英雄一整天的移动力（`__mapPreviewDay` 的 `maxMp`），
            并且 `speed` 等于 9 × clamp(mp/1800, 0.8, 1.4)。只量相位证明不了"速度跟谁挂钩"。
         ② 行为：用 `?devpathpace=` 指定两个极端预算，各量一次**每秒相位前进**，
            比值必须 ≈ 1.75（1200 ⇒ 0.8×，2700 ⇒ 1.4×）。 */
      const expectSpeed = (mp) => 9 * Math.max(0.8, Math.min(1.4, (mp || 0) / 1800));
      const hookMp = A.hook ? A.hook.maxMp : null;
      check(
        'flow-wired',
        '流速取自英雄一整天的移动力（不是写死的 9）：mp 与 speed 两处同时对账',
        typeof f1.mp === 'number' &&
          typeof hookMp === 'number' &&
          f1.mp === hookMp &&
          Math.abs((f1.speed ?? 0) - expectSpeed(f1.mp)) < 0.05,
        `mp=${f1.mp}（钩子 maxMp=${hookMp}）· speed=${f1.speed}（应 ${expectSpeed(f1.mp).toFixed(2)}，基准 ${f1.base}）`,
      );

      /* 每次读数都取页面自己的 `performance.now()`：Node 侧计时会被两次 evaluate 的
         往返与探针自身取色（几十毫秒）算进去，而这里要的是**动画自己的**速率。 */
      const rateArmWith = async (pace, extra, label) => {
        const r = await arm(send, evaluate, `&devpathpace=${pace}${extra}`, label);
        const g1 = (r.p1 && r.p1.day && r.p1.day.flow) || {};
        const g2 = (r.p2 && r.p2.day && r.p2.day.flow) || {};
        const per = g1.period || 7.2;
        const d = ((((g2.offset ?? 0) - (g1.offset ?? 0)) % per) + per) % per;
        const dt = Math.max(1, (r.t2 ?? 0) - (r.t1 ?? 0)) / 1000;
        return { d, dt: +dt.toFixed(3), rate: +(d / dt).toFixed(2), speed: g1.speed, mp: g1.mp };
      };
      const rateArm = (pace, label) => rateArmWith(pace, '', label);
      const rateArmFixed = (pace, label) => rateArmWith(pace, '&devflowfixed=1', label);
      const P1 = await rateArm(1200, 'devpathpace=1200（慢英雄）');
      const P2 = await rateArm(2700, 'devpathpace=2700（快英雄）');
      const ratio = P1.rate > 0.5 && P2.rate > 0.5 ? P2.rate / P1.rate : 0;
      check(
        'flow-pace',
        '移动力更高 ⇒ 虚线确实走得更快（1200 与 2700 两臂的**每秒**相位前进比 ≈ 1.75）',
        ratio > 1.55 && ratio < 2.0,
        `1200: speed ${P1.speed} · ${P1.d.toFixed(2)}px/${P1.dt}s = ${P1.rate}px/s · ` +
          `2700: speed ${P2.speed} · ${P2.d.toFixed(2)}px/${P2.dt}s = ${P2.rate}px/s · ` +
          `比值 ${ratio.toFixed(2)}（应 1.75）`,
      );

      /* 负向对照：把速度钉回写死的 9px/s（`?devflowfixed=1`）⇒ 两臂比值必须塌回 ≈1。
         没有这一条，`flow-pace` 只能证明"两个数不相等"，证明不了"是移动力让它不相等"。 */
      const F1 = await rateArmFixed(1200, 'devflowfixed=1 · 1200');
      const F2 = await rateArmFixed(2700, 'devflowfixed=1 · 2700');
      const fratio = F1.rate > 0.5 && F2.rate > 0.5 ? F2.rate / F1.rate : 0;
      check(
        'flow-pace-ctl',
        '把流速钉回写死的 9px/s 后，两臂比值塌回 ≈1（证 flow-pace 量的是移动力这条线）',
        F1.speed === 9 && F2.speed === 9 && fratio > 0.75 && fratio < 1.3,
        `1200: speed ${F1.speed} rate ${F1.rate} · 2700: speed ${F2.speed} rate ${F2.rate} · 比值 ${fratio.toFixed(2)}（应 ≈1）`,
      );

      // ---- 2. 关掉流动：相位恒 0、像素不变 ----
      const O = await arm(send, evaluate, '&devflow=0', 'devflow=0（关掉流动）');
      const o1 = (O.p1 && O.p1.day) || {};
      const o2 = (O.p2 && O.p2.day) || {};
      const of = o1.flow || {};
      const offFlips = flips(o1.next && o1.next.finePer, o2.next && o2.next.finePer);
      check(
        'flow-off',
        '关掉之后相位恒 0 且像素不再变化（证"在动"由这一层负责）',
        of.on === false &&
          of.offset === 0 &&
          (o2.flow || {}).offset === 0 &&
          offFlips === 0,
        `on=${of.on} · 相位 ${of.offset} → ${(o2.flow || {}).offset} · 明天翻转 ${offFlips} 枚`,
      );

      // ---- 3. 系统"减少动态"：整层静止（无障碍） ----
      await media(true);
      const R = await arm(send, evaluate, '', 'prefers-reduced-motion: reduce');
      const r1 = (R.p1 && R.p1.day) || {};
      const r2 = (R.p2 && R.p2.day) || {};
      const rf = r1.flow || {};
      const redFlips = flips(r1.next && r1.next.finePer, r2.next && r2.next.finePer);
      check(
        'flow-reduced',
        '系统开了"减少动态"时整层静止（无障碍要求）',
        rf.reduced === true && rf.on === false && rf.offset === 0 && redFlips === 0,
        `reduced=${rf.reduced} · on=${rf.on} · 相位 ${rf.offset} → ${(r2.flow || {}).offset} · 明天翻转 ${redFlips} 枚`,
      );
      await media(false);

      if (AS_JSON) {
        console.log(
          JSON.stringify(
            {
              rows,
              default: { day: a1, flow2: f2, nextFlips, nowFlips },
              off: { day: o1, flow2: o2.flow, offFlips },
              reduced: { day: r1, flow2: r2.flow, redFlips },
            },
            null,
            2,
          ),
        );
      }
      code = rows.every((r) => r.ok) ? 0 : 1;
    },
    { devServerPort: PORT, profilePrefix: 'pflow-' },
  );
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  code = 1;
} finally {
  if (srv && !srv.killed) srv.kill('SIGKILL');
}
if (!AS_JSON) console.log(code === 0 ? '[总结] 全过' : `[总结] FAIL ${rows.filter((r) => !r.ok).length} 条`);
process.exit(code);
