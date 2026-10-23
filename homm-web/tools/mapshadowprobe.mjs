#!/usr/bin/env node
/**
 * mapshadowprobe.mjs —— 「接地影」的机检门（2026-10-23）
 *
 * 为什么会需要一道门：接地影是本项目里**最容易"看起来加了、其实没落在地上"**的一笔。
 * 影画在精灵之前、中心压在剪影底边上，上沿全被精灵盖住 —— 画歪 20px 时，
 * 整屏截图照样"好像有层次"，只有取色能戳穿它。
 *
 * 判据（全部在**同一次导航**里量，见 `MapRenderer.probeShadow` 注释）：
 *   ① samples  ≥ 20 个可取样落点（少于这个数说明屏上物件太少，结论不可靠）
 *   ② grounded 开影与关影的「脚边 − 影外同排」之差 ≤ −8（脚下确实被压暗）
 *   ③ offClean 关影时该差值 ≈ 0（|·| ≤ 12）—— 否则"暗"来自地形而不是影
 *   ④ stable   连测两次（关→开）差值一致（±3），且落点数相同
 *
 * 为什么不用整屏帧间差分：昼夜光照每帧都在变，两帧之间全屏都有 ±1 的漂移
 * （实测 16.9% 的像素变了且散布全屏）。这里取「同坐标、开/关两次相减」，
 * 精灵墨色、地形印花、光照因子全部抵销，只剩这一层影。
 *
 * 负向对照（铁律 §2）：`--inject=up|down` 用只给探针的 `__mapShadowOffset` 把影推离脚下，
 * ② 必须变红。`--selfcheck` 逐条跑这两个注入并断言闸确实红了 ——
 * 它证明的是"判据量的是脚边的影"，不是"屏幕上任何一处变暗的像素"。
 *
 * 用法：
 *   node tools/mapshadowprobe.mjs              # 跑门（dev server 需已在 5199 上）
 *   node tools/mapshadowprobe.mjs --selfcheck  # 负向对照
 *   node tools/mapshadowprobe.mjs --json
 *
 * 退出码：0 全绿 · 1 有判据红 · 2 前置不满足
 */
import { checkDevServer, withHeadlessChrome, chromeAvailable, CHROME_PATH } from './_chrome.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (k, d = null) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};

const PORT = Number(opt('port', 5199));
let INJECT = opt('inject');
const SELFCHECK = has('--selfcheck');
const AS_JSON = has('--json');
const VIEW = { width: 844, height: 390, dpr: 2 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 把影推离脚下的两种方式：往天上、往下一格。两者都该让 ② 变红。 */
const INJECTS = { up: -46, down: 44 };

const rows = [];
function check(id, label, ok, detail) {
  rows.push({ id, label, ok: !!ok, detail });
  return ok;
}

const median = (a) => {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  return b[Math.floor(b.length / 2)];
};
const deltas = (p) => p.foot.map((f, i) => f - p.ref[i]);

/* ------------------------------------------------------------------ 采集 */

async function measure(send, evaluate) {
  const base = `http://127.0.0.1:${PORT}/index.html`;
  await send('Emulation.setDeviceMetricsOverride', {
    width: VIEW.width,
    height: VIEW.height,
    deviceScaleFactor: VIEW.dpr,
    mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // 真机形态：桌面 hover 会额外点亮一些东西，和"手上那台"不是同一张画面。
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }],
  });
  await send('Page.navigate', {
    url: `${base}?devquick=1&devreveal=1&devprobe=1&devshadowprobe=1&devshadowstats=1`,
  });

  // 等相机停稳：初始会有一段缩放缓动，量到中途的画面会让两次取样对不上。
  let stable = 0;
  let last = '';
  for (let i = 0; i < 120; i++) {
    try {
      const sig = await evaluate('(() => { const c = window.__journey().cam; return `${c.x.toFixed(1)},${c.y.toFixed(1)},${c.zoom.toFixed(2)}`; })()');
      if (sig === last) stable++;
      else stable = 0;
      last = sig;
      if (stable >= 3) break;
    } catch {
      /* 还没加载完 */
    }
    await sleep(150);
  }
  await sleep(400);

  const probe = () => evaluate('window.__mapShadowProbe()');
  const setOn = (on) => evaluate(`window.__mapShadow(${on ? 'true' : 'false'})`);
  const setOffset = (dy) => evaluate(`window.__mapShadowOffset(${dy})`);

  if (INJECT) {
    await setOffset(INJECTS[INJECT] ?? 0);
    // ⚠️ 必须等一帧再取色：`probeShadow()` 读的是**当前缓冲**，设完偏移立刻读
    // 拿到的仍是上一帧（影还在脚下）—— 负向对照会因此假绿，本轮踩过。
    await sleep(700);
  }
  const on1 = await probe();
  await setOn(false);
  await sleep(800);
  const off = await probe();
  await setOn(true);
  await sleep(800);
  const on2 = await probe();
  return { on1, off, on2 };
}

/* ------------------------------------------------------------------ 判据 */

function judge(m) {
  rows.length = 0;
  const d1 = deltas(m.on1);
  const d2 = deltas(m.on2);
  const dOff = deltas(m.off);
  const md1 = median(d1);
  const md2 = median(d2);
  const mdOff = median(dOff);

  check(
    'samples',
    '可取样落点 ≥ 20',
    m.on1.n >= 20,
    `${m.on1.n} 个（开）· ${m.off.n} 个（关）`,
  );
  check(
    'grounded',
    '开影：脚边比影外同排暗 ≥ 8',
    md1 - mdOff <= -8,
    `开 ${md1.toFixed(1)} / 关 ${mdOff.toFixed(1)} ⇒ 净效果 ${(md1 - mdOff).toFixed(1)}`,
  );
  check(
    'offClean',
    '关影：脚边与影外基本持平（|差| ≤ 12）',
    Math.abs(mdOff) <= 12,
    `关 ${mdOff.toFixed(1)}（若这里就明显偏暗，说明暗来自地形不是影）`,
  );
  check(
    'stable',
    '连测两次一致（落点数相同、差值 ±3 内）',
    m.on1.n === m.on2.n && Math.abs(md1 - md2) <= 3,
    `n ${m.on1.n}/${m.on2.n} · 差值 ${md1.toFixed(1)}/${md2.toFixed(1)}`,
  );
  return rows.every((r) => r.ok);
}

/* ------------------------------------------------------------------ 主流程 */

async function run() {
  const srv = await checkDevServer(PORT);
  if (!srv.ok) {
    console.error(`✗ 前置：127.0.0.1:${PORT} 上没有 dev server（先 npm run serve 或 PORT=${PORT} node tools/serve.mjs）`);
    process.exit(2);
  }
  if (!chromeAvailable()) {
    console.error(`✗ 前置：找不到 Chrome（${CHROME_PATH}）`);
    process.exit(2);
  }
  return withHeadlessChrome(
    async ({ send, evaluate }) => {
      const m = await measure(send, evaluate);
      const green = judge(m);
      if (AS_JSON) {
        console.log(JSON.stringify({ green, inject: INJECT, rows }, null, 2));
      } else {
        for (const r of rows) console.log(`${r.ok ? '✅' : '❌'} [${r.id}] ${r.label} — ${r.detail}`);
        if (INJECT) console.log(`   · 注入 ${INJECT}（影偏移 ${INJECTS[INJECT]}px）`);
      }
      return green;
    },
    { devServerPort: PORT, profilePrefix: 'mapshadow-' },
  );
}

(async () => {
  if (SELFCHECK) {
    let bad = 0;
    for (const which of Object.keys(INJECTS)) {
      INJECT = which;
      const green = await run();
      const ok = green === false;
      console.log(`${ok ? '✅' : '❌'} 负向对照 --inject=${which}（影偏移 ${INJECTS[which]}px） → 闸${ok ? '变红' : '仍绿（闸失效）'}`);
      if (!ok) bad++;
    }
    process.exit(bad ? 1 : 0);
  }
  const green = await run();
  process.exit(green ? 0 : 1);
})().catch((e) => {
  console.error('✗', e?.message ?? e);
  process.exit(2);
});
