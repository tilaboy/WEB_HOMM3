#!/usr/bin/env node
/**
 * pathdotsprobe.mjs —— 预览路径与可达点阵的**互让**门（`npm run probe:pathdots`）。
 *
 * ## 为什么要有这把尺
 * 2026-10-24 之前这两层是各画各的：
 *   · 预览路径 = 世界坐标里一枚 `rgba(255,246,214,0.85)` 的 4×4，**画在光照之前** ⇒ 被整屏
 *     multiply 一起乘暗 ⇒ 夜里**路线比边界点还暗**（而路线正是玩家下一步要点的东西）；
 *   · 可达点 = 光照之后的 4×4 双色点，**同尺寸同位置** ⇒ 路径终点那一格上两枚点摞在一起。
 * 现在的约定是三层：
 *   ① 路径地标 **晚于光照**（与点、与边带同一条纪律）；
 *   ② 路径地标 **大一号、金色**（6×6 墨底 + 4×4 金芯）—— 层级「路线 > 边界」；
 *   ③ 路径所占的格 **不再落可达点**（路线本身已经回答了"这格能到"）。
 *
 * ## 判据（4 条，全部可机检）
 *   `pathmeta`     —— 渲染器自报的 `pathDots` = 路径步数（`__mapPreviewTo` 返回的 n − 1），且 ≥3；
 *   `mask`         —— 路径终点的可达点**从登记里消失**（不是"看起来淡了"），且渲染器报告 ≥1 枚被让位；
 *   `pathcontrast` —— 路径地标在光照之后画，最差对比 ≥3.0、无被盖住；
 *   `pathafter`    —— `drawnAfter === true`（管线位置是结构事实，不靠像素差猜）。
 *
 * 负向对照（`--selfcheck`，两条都要能变红）：
 *   `?devpathmask=0`   ⇒ 终点那格又落回一枚可达点 ⇒ `mask` 红；
 *   `?devpathafter=0`  ⇒ `drawnAfter=false` ⇒ `pathafter` 红（并打印旧路径的实测对比，作观察值）。
 *
 * 用法：`node tools/pathdotsprobe.mjs [--selfcheck] [--json] [--light=0.22]`
 * 退出码：0 全过 / 1 有判据不过
 */
import { spawn } from 'node:child_process';
import { withHeadlessChrome, checkDevServer } from './_chrome.mjs';

const opt = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const PORT = Number(opt('port', 5207));
const AS_JSON = process.argv.includes('--json');
const SELFCHECK = process.argv.includes('--selfcheck');
const SEED = opt('seed', '20260917');
/* 默认相位取 **0.68 = 深夜**（关键帧里最暗的一档，multiply ≈ 178/255）。
 *
 * 这条默认值是被两次错读数逼出来的：
 *   ① 先用 0.22（正午，纯白 = 无乘光）⇒ 新旧两臂逐位相同，"画在光照之后"根本测不出来；
 *   ② 再用 0.05/0.5/0.95 ⇒ 三档**都落在亮相位**（关键帧最暗在 0.68）⇒ 同样测不出来。
 * 换到 0.68 之后，旧路径的对比度掉到 **2.79**（不及格），新路径 4.09 —— 这才是这条判据的意义。 */
const LIGHT = opt('light', '0.68');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE =
  `http://127.0.0.1:${PORT}/index.html?devquick=1&devreveal=1&devprobe=1&devbandstats=1` +
  `&devreachprobe=1&devseed=${SEED}&devlight=${LIGHT}`;

const rows = [];
const check = (id, label, ok, detail) => {
  rows.push({ id, ok, label, detail });
  if (!AS_JSON) console.log(`${ok ? '✅' : '❌'} [${id}] ${label} — ${detail}`);
};

/** 摆好一臂：导航 → 等主循环 → 选一枚可达点当终点 → 摆预览路径 → 读三处数 */
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
  // 等到渲染循环真的画过一帧（`__bandStats` 每帧写一次；导航刚完时可能还没有）
  for (let i = 0; i < 40; i++) {
    if (await evaluate('!!window.__bandStats')) break;
    await sleep(150);
  }
  await sleep(300);

  // 先拿"没有路径时"的可达点（含格坐标），用它挑一个**真实存在的边界格**当终点
  const before = await evaluate('window.__mapReachProbe ? window.__mapReachProbe() : null');
  const cands = ((before && before.per) || []).slice().reverse(); // 远端的点更可能给出长路径
  let picked = null;
  for (const c of cands) {
    const ok = await evaluate(
      `window.__mapPreviewTo ? window.__mapPreviewTo(${c.tx}, ${c.ty}) : { ok: false }`,
    );
    if (ok && ok.ok && ok.n >= 4) {
      picked = { tx: c.tx, ty: c.ty, n: ok.n, path: ok.path || [] };
      break;
    }
  }
  await sleep(320); // 让渲染循环至少画过一帧

  const st = await evaluate('window.__bandStats || null');
  const pp = await evaluate('window.__mapPathProbe ? window.__mapPathProbe() : null');
  const after = await evaluate('window.__mapReachProbe ? window.__mapReachProbe() : null');
  if (!AS_JSON) {
    console.log(
      `[${label}] 终点 (${picked ? `${picked.tx},${picked.ty}` : '无'}) · 路径 ${picked ? picked.n : '?'} 步 · ` +
        `地标 ${st && st.pathDots !== undefined ? st.pathDots : '(无)'} 枚 · 让位 ${st && st.dotsOnPath !== undefined ? st.dotsOnPath : '(无)'} 枚 · ` +
        `地标最差对比 ${pp ? pp.min : '?'}（中位 ${pp ? pp.median : '?'}）· 平均亮度 ${pp ? pp.meanBL : '?'} · 终点仍有可达点 ${afterEndDot(after, picked) ? '是' : '否'}`,
    );
  }
  return { st, pp, after, picked, before };
}

/** 终点格上是否还登记着一枚可达点（`null` 一律当"还在"，避免"量不到"被读成"没有"）。 */
function afterEndDot(probe, picked) {
  if (!picked) return true;
  if (!probe || !probe.per) return true;
  return probe.per.some((p) => p.tx === picked.tx && p.ty === picked.ty);
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

      const A = await arm(send, evaluate, '', 'default');
      const st = A.st || {};
      const pp = A.pp || {};
      const expect = A.picked ? A.picked.n - 1 : -1;

      check(
        'pathmeta',
        '渲染器自报的地标数 = 路径步数（每步一枚，不多不少）',
        !!A.picked && st.pathDots === expect && expect >= 3,
        `地标 ${st.pathDots} vs 路径 ${A.picked ? A.picked.n : '?'} 步 ⇒ 期望 ${expect}`,
      );
      check(
        'mask',
        '路径终点不再落可达点（登记里消失，不是"看起来淡"）',
        !!A.picked && st.dotsOnPath >= 1 && !afterEndDot(A.after, A.picked),
        `让位 ${st.dotsOnPath} 枚 · 终点(${A.picked ? `${A.picked.tx},${A.picked.ty}` : '?'})仍有登记点=${afterEndDot(A.after, A.picked)}`,
      );
      /* 方向对账：渲染器自报的 `dx/dy` 必须等于**路径自己**的步子方向
         （两处独立算：`main.ts` 的 `buildPath` vs `MapRenderer` 的 `Math.sign(next-cur)`）。
         末步没有"下一格"⇒ 两边都该沿用上一步的方向。 */
      const pv = A.picked;
      const badDir = [];
      const seenDir = new Set();
      let checked = 0;
      if (pv && pv.path && pv.path.length > 2) {
        for (let k = 1; k < pv.path.length; k++) {
          const cur = pv.path[k];
          const nxt = k + 1 < pv.path.length ? pv.path[k + 1] : null;
          const prv = pv.path[k - 1];
          const ex = nxt ? Math.sign(nxt.x - cur.x) : Math.sign(cur.x - prv.x);
          const ey = nxt ? Math.sign(nxt.y - cur.y) : Math.sign(cur.y - prv.y);
          const got = ((A.pp && A.pp.per) || []).find((q) => q.tx === cur.x && q.ty === cur.y);
          if (!got) continue; // 出界/未量到：交给 found 那条管
          checked++;
          seenDir.add(`${got.dx},${got.dy}`);
          if (got.dx !== ex || got.dy !== ey) badDir.push(`(${cur.x},${cur.y}) ${got.dx},${got.dy}≠${ex},${ey}`);
        }
      }
      check(
        'pathdir',
        '每步箭头都指向下一格（渲染器与 buildPath 各自算，必须一致）',
        checked >= 3 && badDir.length === 0,
        badDir.length
          ? `不一致 ${badDir.length} 处：${badDir.slice(0, 3).join(' · ')}`
          : `${checked} 步全部对上 · 方向种类 ${seenDir.size} 种（${[...seenDir].join(' / ')}）`,
      );

      check(
        'pathcontrast',
        '路径地标在自己的底色上读得出（最差 ≥ 3.0，且没被实体盖住）',
        pp.n > 0 && pp.min >= 3 && pp.covered === 0,
        `量到 ${pp.n} 枚 · 最差 ${pp.min} · 中位 ${pp.median} · covered ${pp.covered}`,
      );
      check(
        'pathafter',
        '地标画在光照之后（结构事实，不靠像素差猜）',
        pp.drawnAfter === true,
        `drawnAfter=${pp.drawnAfter}`,
      );

      /* 常驻 A/B：同一张图、同一个终点、只差 `?devpathafter`。
       * 对比度对"整屏等比乘暗"不敏感（点和它的底色一起被乘 ⇒ 比值近似不变，实测两臂都是 3.83），
       * 所以这条判据看的是**平均绝对亮度**：旧路径必须更暗，否则"画在光照之后"这件事没有效果。 */
      const OLD = await arm(send, evaluate, '&devpathafter=0', 'pathafter=0（旧路径）');
      const oPp = OLD.pp || {};
      check(
        'pathlit',
        '地标不再被整屏乘暗（同图同格：新路径比旧路径更亮）',
        pp.meanBL > oPp.meanBL && pp.meanBL - oPp.meanBL >= 0.01,
        `平均亮度 ${pp.meanBL} vs 旧 ${oPp.meanBL}（差 ${(pp.meanBL - oPp.meanBL).toFixed(4)}）`,
      );

      if (SELFCHECK) {
        const M = await arm(send, evaluate, '&devpathmask=0', 'mask=0（负向对照）');
        const mSt = M.st || {};
        check(
          'ctl-mask',
          '关掉互让后：终点又落回一枚可达点（证 mask 判据有分辨力）',
          afterEndDot(M.after, M.picked) || mSt.dotsOnPath === 0,
          `让位 ${mSt.dotsOnPath} · 终点仍有登记点=${afterEndDot(M.after, M.picked)}`,
        );
        check(
          'ctl-oldfails',
          '夜相位下旧路径确实不及格（证这次修的是真缺陷，不是风格偏好）',
          oPp.min < 3,
          `旧路径最差对比 ${oPp.min}（< 3.0）· 新路径 ${pp.min}`,
        );
        check(
          'ctl-after',
          '退回旧路径后：drawnAfter=false（证 pathafter 判据有分辨力）',
          oPp.drawnAfter === false,
          `drawnAfter=${oPp.drawnAfter} · 旧路径平均亮度 ${oPp.meanBL}`,
        );
      }

      if (AS_JSON) console.log(JSON.stringify({ rows, default: { st, pp, picked: A.picked } }, null, 2));
      code = rows.every((r) => r.ok) ? 0 : 1;
    },
    { devServerPort: PORT, profilePrefix: 'pd-' },
  );
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  code = 1;
} finally {
  if (srv && !srv.killed) srv.kill('SIGKILL');
}

if (!AS_JSON) console.log(code === 0 ? '[总结] 全过' : `[总结] FAIL ${rows.filter((r) => !r.ok).length} 条`);
process.exit(code);
