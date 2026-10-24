#!/usr/bin/env node
/**
 * pathdayprobe.mjs —— 预览路径的**跨天分段**门（`npm run probe:pathday`）。
 *
 * ## 为什么要有这把尺
 * 跨天行程（一天走不完）在 2026-10-24 之前是一条**一以贯之的实线**：
 * 玩家点远处一格，线整条亮着，英雄走到一半停下、提示"明天按 M 继续" ——
 * 这才发现自己点远了。而"今天能走到哪"恰恰是一回合一次决策的游戏里最贵的一条信息。
 *
 * 现在同一条路径分成两段：今天 = 实线金，明天 = 虚线冷蓝，交界格一道"收工"刻痕。
 *
 * ## 判据（4 条 + 1 条对照）
 *   `pathday`      —— 结构：`0 < cut < len`，`split === true`，两段都量到样本（今天 ≥2、明天 ≥1）；
 *   `pathday-cost` —— 算术：`costs[cut-1] <= mp < costs[cut]`（分界正好落在最后一格可负担的格子上）；
 *   `pathday-dash` —— 视觉：今天段中点**全部**有笔触，明天段中点**有缺口**（虚线的结构证据）；
 *   `cut-mark`     —— 刻痕：交界格**中心像素**被压黑（相对亮度 < 0.15）；
 *   `pathday-ctl`  —— 对照臂 `?devpathday=0`：`split === false`、无刻痕、明天段 0 样本（= 旧表现）。
 *
 * 为什么 `pathday-dash` 用"中点有没有笔触"而不是比颜色：颜色会被昼夜光照的 multiply 拉偏
 * （暖色 tint 能把冷蓝拉回中性），而**虚线在格与格之间留下空档**是几何事实，光照改不了它。
 *
 * 为什么 `pathday` 需要一个专门的钩子：分段只在"目标超出今日移动力"时出现，
 * 而按可达点边缘选目标**永远**在今日范围内 ⇒ 用老钩子测分段，测出来永远是"没有分段"。
 * `__mapPreviewDay(mp)` 还会临时把移动力设小：满 1800 的跨天目标在十几格之外，
 * 整段"明天"都在屏幕外，取不到像素（`offScreen` 会把它记成"量不到"）。
 *
 * 用法：`node tools/pathdayprobe.mjs [--selfcheck] [--json] [--light=0.68] [--mp=300] [--seed=…]`
 * 退出码：0 全过 / 1 有判据不过
 */
import { spawn } from 'node:child_process';
import { withHeadlessChrome, checkDevServer } from './_chrome.mjs';

const opt = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const PORT = Number(opt('port', 5208));
const AS_JSON = process.argv.includes('--json');
const SELFCHECK = process.argv.includes('--selfcheck');
const SEED = opt('seed', '20260917');
/* 相位 0.68 = 深夜（关键帧最暗的一档）。选它不是为了好看：白天两段都足够亮，
 * 分段判据在白天不容易分辨"冷色被拉暖"这种事（§18.4 的老账）。 */
const LIGHT = opt('light', '0.68');
/** 临时移动力：200 ⇒ 今天约 2 格、明天再 2~3 格，两段都能完整落在 844×390 里。
 *  300 试过：目标 7 步，竖直方向会把"明天"整段顶出画布（实测出界 3/4，明天只剩 1 枚样本）。 */
const MP = Number(opt('mp', 200));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE =
  `http://127.0.0.1:${PORT}/index.html?devquick=1&devreveal=1&devprobe=1&devbandstats=1` +
  `&devreachprobe=1&devseed=${SEED}&devlight=${LIGHT}`;

const rows = [];
const check = (id, label, ok, detail) => {
  rows.push({ id, ok, label, detail });
  if (!AS_JSON) console.log(`${ok ? '✅' : '❌'} [${id}] ${label} — ${detail}`);
};

/** 摆好一臂：导航 → 等主循环 → 让主程序摆一条"今天走不完"的路径 → 读探针。 */
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
    `window.__mapPreviewDay ? window.__mapPreviewDay(${MP}) : { ok: false, reason: '没有钩子' }`,
  );
  await sleep(420); // 让渲染循环按新状态画过一帧
  const pp = await evaluate('window.__mapPathProbe ? window.__mapPathProbe() : null');
  if (!AS_JSON) {
    const d = (pp && pp.day) || {};
    console.log(
      `[${label}] 目标 ${hook && hook.target ? `(${hook.target.x},${hook.target.y})` : '无'}` +
        ` · 路径 ${hook && hook.n ? hook.n : '?'} 步 · 今日 ${d.cut} 步（mp=${hook ? hook.mp : '?'}）` +
        ` · split=${d.split} · 今天 ${d.now ? d.now.n : '?'} 枚 / 明天 ${d.next ? d.next.n : '?'} 枚`,
    );
  }
  return { hook, pp };
}

/** 四条主判据抽成函数：正常臂要全 true，对照臂要全 false（这就是负向对照）。 */
function crit(pp) {
  const d = (pp && pp.day) || {};
  const n = d.now || {};
  const x = d.next || {};
  return {
    day: d.split === true && d.cut > 0 && d.cut < d.len && n.n >= 2 && x.n >= 1,
    /* 用**细窗**（半径 1）的 covered：宽窗会把缺口两侧的墨一起收进来，虚线也永远"有笔触"。 */
    dash:
      n.fineN >= 2 &&
      n.fineCovered === 0 &&
      x.fineN >= 1 &&
      x.fineCovered >= Math.max(1, Math.ceil(x.fineN * 0.2)),
    mark: typeof d.cutLum === 'number' && d.cutLum < 0.15,
  };
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
      await send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'hover', value: 'none' },
          { name: 'pointer', value: 'coarse' },
        ],
      });

      const A = await arm(send, evaluate, '', 'default（跨天分段）');
      const pp = A.pp || {};
      const d = pp.day || {};
      const hk = A.hook || {};
      const c = crit(pp);

      check(
        'pathday',
        '今天走不完时路径分成两段（交界既不在起点也不在终点，两段都有样本）',
        c.day,
        `split=${d.split} · cut=${d.cut}/${d.len} · 今天 ${d.now ? d.now.n : '?'} 枚（出界 ${d.now ? d.now.offScreen : '?'}）· 明天 ${d.next ? d.next.n : '?'} 枚（出界 ${d.next ? d.next.offScreen : '?'}）`,
      );

      /* 算术对账：`cut` 是"今天走完的**步数**"，所以第 cut 步（1-based）= `costs[cut-1]`（0-based）。
         它必须是"最后一格付得起的"，下一格必须付不起 —— 差一格就是"英雄在玩家没预料的地方停下"。 */
      const costs = (hk && hk.costs) || [];
      const cut = typeof d.cut === 'number' ? d.cut : -1;
      const prevOk = cut > 0 && cut <= costs.length && costs[cut - 1] <= hk.mp;
      const nextOk = cut >= 0 && cut < costs.length && costs[cut] > hk.mp;
      check(
        'pathday-cost',
        '分界落在"最后一格付得起、下一格付不起"（走的是同一个 stepCost）',
        prevOk && nextOk,
        `costs[${cut - 1}]=${costs[cut - 1]} ≤ mp=${hk.mp} < costs[${cut}]=${costs[cut]}`,
      );

      check(
        'pathday-dash',
        '今天实线、明天虚线（虚线在格与格之间留空 —— 几何事实，光照改不了）',
        c.dash,
        `今天中点 ${d.now ? d.now.fineN : '?'} 枚（细窗空 ${d.now ? d.now.fineCovered : '?'}）· ` +
          `明天中点 ${d.next ? d.next.fineN : '?'} 枚（细窗空 ${d.next ? d.next.fineCovered : '?'}）`,
      );

      check(
        'cut-mark',
        '交界格中心被刻痕压黑（"今天到此收工"）',
        c.mark,
        `交界格中心相对亮度 ${d.cutLum}（< 0.15）`,
      );

      /* 对照臂：关掉分段 = 旧表现（整条实线、无刻痕）。它必须**真的一分为二**，
         否则上面四条等于在测"有个钩子在跑"。 */
      const C = await arm(send, evaluate, '&devpathday=0', 'pathday=0（旧表现）');
      const cPp = C.pp || {};
      const cd = cPp.day || {};
      const cc = crit(cPp);
      check(
        'pathday-ctl',
        '关掉分段后回到旧表现：无交界、无刻痕、明天段 0 样本',
        cd.split === false && cd.cutLum === null && (cd.next ? cd.next.n : 0) === 0,
        `split=${cd.split} · cut=${cd.cut}/${cd.len} · cutLum=${cd.cutLum} · 明天 ${cd.next ? cd.next.n : 0} 枚`,
      );

      if (SELFCHECK) {
        /* 负向对照的本质：把**同一组判据**套到对照臂上，每一条都必须变红。
           只检"对照臂的 split=false"是不够的 —— 那只能证明钩子关了，
           证明不了 dash / cut-mark 这两条判据真的在测"今天/明天"而不是在测任何一条线。 */
        const flipped = ['pathday', 'pathday-dash', 'cut-mark'].filter((k) => {
          if (k === 'pathday') return cc.day;
          if (k === 'pathday-dash') return cc.dash;
          return cc.mark;
        });
        check(
          'ctl-flip',
          '把同一组判据套到对照臂上，三条全变红（证每条都有分辨力）',
          flipped.length === 0,
          flipped.length ? `仍是绿的：${flipped.join('、')}` : 'pathday / pathday-dash / cut-mark 三条全红',
        );
      }

      if (AS_JSON) {
        console.log(JSON.stringify({ rows, default: { hook: hk, pp }, control: { hook: C.hook, pp: cPp } }, null, 2));
      }
      code = rows.every((r) => r.ok) ? 0 : 1;
    },
    { devServerPort: PORT, profilePrefix: 'pday-' },
  );
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  code = 1;
} finally {
  if (srv && !srv.killed) srv.kill('SIGKILL');
}

if (!AS_JSON) console.log(code === 0 ? '[总结] 全过' : `[总结] FAIL ${rows.filter((r) => !r.ok).length} 条`);
process.exit(code);
