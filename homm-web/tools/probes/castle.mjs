#!/usr/bin/env node
/**
 * castle.mjs —— 地图城堡按**城防**分四档的机检（`npm run probe:castle`，S6 / §14.3 G5）。
 *
 * ## 它守什么
 * G5 的原状是："木栅"和"堡垒"在地图上长得一模一样 —— 因为四档外形的选择依据
 * 是**兵营数量**，跟城墙毫无关系。所以升级了城防，玩家看不出任何变化。
 *
 * 修法有两半，两半都得验：
 *   ① **选对帧**：`wallLevelOf(town)` → `castle_<owner>_<0..3>`（`audit:townart` 的 [7] 验映射）；
 *   ② **真画到地图上**：帧换了，但渲染器可能没重绘、或被迷雾/光照盖住、或换了档位后
 *      位置跳了。这一半只能在真画布里量 —— 也就是本探针。
 *
 * ## 三条断言的分工
 * A. **帧名**（逐档精确）：`__castle.drawn()` 读的是渲染器 `draw()` 里**真正 blit 出去**的
 *    那张帧名，不是探针自己调选择器算出来的（那等于拿尺子验尺子）。
 * B. **不跑位**（逐档精确）：72×96 的帧换掉之后，屏幕矩形必须**逐位相同**。
 *    城堡是 2×2 占地 + 固定锚点，升级时挪一格就是"城跑了"。
 * C. **看得出**（本底对照）：同一坐标四档截屏两两不同。判据不能是一个魔法阈值 ——
 *    先量**同一档连拍两次**的本底（动画/光照噪声），再要求跨档差异 ≥ `max(20, 本底×4)` **格**。
 *    ⚠️ 单位是 8×8 的**格**（72×96 ⇒ 9×12 = 108 格），不是像素 —— 首版门槛写成 400"格"
 *    其实是把像素数搬过来了，四对全红。量纲写错比阈值写松更危险。
 *
 * ## 为什么用块签名而不是逐像素
 * 逐像素比的是"渲染器有没有重绘"，而这个探针要答的是"**人看得出来吗**"。
 * 8×8 像素块取均值 ⇒ 9×12 = 108 格，每格是"这一小块的平均颜色"：
 * 抗锯齿/光照噪声被平均掉，而"多了一座塔"这种结构变化一格都藏不住。
 *
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足
 */
import { distDir, printHeader, requireFile, freePort, serveInProcess } from '../_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from '../_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=castle');
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

/* `devlight=0.22` = 纯白无乘光（`applyLighting` 最亮相位）：块签名要的是**画了什么**，
 * 不是"这一刻的光照"。`devseed` 钉死地图，否则城镇位置每次都换。 */
const BASE = `http://127.0.0.1:${PORT}/?devquick=1&devsize=medium&devseed=20260917&devreveal=1&devlight=0.22&devcastle=1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let bad = 0;
const PASS = (c, m) => {
  if (!c) bad++;
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`);
};

/** 块签名：把屏幕矩形按 8 CSS px 一格取平均色，返回 [r,g,b]×108。 */
const sigJs = (rect) => `(() => {
  const c = document.getElementById('map');
  if (!c) return null;
  const dpr = c.width / c.clientWidth;
  const ctx = c.getContext('2d');
  const x = Math.max(0, Math.round(${rect.x} * dpr));
  const y = Math.max(0, Math.round(${rect.y} * dpr));
  const w = Math.max(1, Math.round(${rect.w} * dpr));
  const h = Math.max(1, Math.round(${rect.h} * dpr));
  const d = ctx.getImageData(x, y, w, h).data;
  const BX = 8, BY = 8;
  const gw = Math.max(1, Math.floor(w / (BX * dpr)));
  const gh = Math.max(1, Math.floor(h / (BY * dpr)));
  const out = [];
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let r = 0, g = 0, b = 0, n = 0;
      const x0 = Math.floor((gx * w) / gw), x1 = Math.floor(((gx + 1) * w) / gw);
      const y0 = Math.floor((gy * h) / gh), y1 = Math.floor(((gy + 1) * h) / gh);
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * w + px) * 4;
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        }
      }
      out.push(Math.round(r / n), Math.round(g / n), Math.round(b / n));
    }
  }
  return { gw, gh, cells: out };
})()`;

/** 两个签名里有几格"肉眼可辨"（任一通道差 > 8）—— 光照噪声通常 < 3。 */
function gridDiff(a, b) {
  if (!a || !b || a.gw !== b.gw || a.gh !== b.gh) return { diff: -1, cells: 0 };
  let diff = 0;
  for (let i = 0; i < a.cells.length; i += 3) {
    if (
      Math.abs(a.cells[i] - b.cells[i]) > 8 ||
      Math.abs(a.cells[i + 1] - b.cells[i + 1]) > 8 ||
      Math.abs(a.cells[i + 2] - b.cells[i + 2]) > 8
    ) {
      diff++;
    }
  }
  return { diff, cells: a.gw * a.gh };
}

async function boot(evaluate) {
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    try {
      const ok = await evaluate('!!(window.__castle && window.__castle.towns().length)');
      if (ok) return true;
    } catch {
      /* 导航中 */
    }
  }
  return false;
}

try {
  await withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: BASE });
    if (!(await boot(evaluate))) {
      PASS(false, '地图没起来（`?devcastle=1` 的夹具坏了）');
      return;
    }

    const towns = await evaluate('window.__castle.towns()');
    const focus = await evaluate('window.__castle.focus()');
    if (!focus) {
      PASS(false, '找不到任何城镇（`?devquick=1` 没有建城）');
      return;
    }
    console.log(`[info] 目标城 ${focus.id} · 格 (${focus.x},${focus.y}) · 地图上共 ${towns.length} 座`);
    await sleep(400); // 让镜头稳定（centerOn 之后 clamp 一次）

    /* ---------- A/B：逐档取帧名与屏幕矩形 ---------- */
    const rows = [];
    for (const lv of [0, 1, 2, 3]) {
      const walls = await evaluate(`window.__castle.set(${JSON.stringify(focus.id)}, ${lv})`);
      await sleep(260); // 两个 rAF 以上，确保 draw() 已经用新状态重画
      const drawn = await evaluate(`window.__castle.drawn(${JSON.stringify(focus.id)})`);
      rows.push({ lv, walls, drawn });
      if (!drawn) {
        PASS(false, `第 ${lv} 档没画出来（渲染器没登记这张城）`);
        continue;
      }
      const want = `castle_${towns.find((t) => t.id === focus.id)?.owner ?? 'p1'}_${lv}`;
      PASS(drawn.sprite === want, `第 ${lv} 档画出的是 \`${drawn.sprite}\`（墙 ${walls.join('+') || '无'} ⇒ 应 \`${want}\`）`);
    }

    const ok = rows.filter((r) => r.drawn);
    if (ok.length !== 4) {
      PASS(false, `四档没取全（只有 ${ok.length} 档登记到）`);
      return;
    }

    const box = ok[0].drawn;
    const sameBox = ok.every(
      (r) => r.drawn.x === box.x && r.drawn.y === box.y && r.drawn.w === box.w && r.drawn.h === box.h,
    );
    PASS(
      sameBox,
      `四档画在同一个矩形上（${box.w.toFixed(1)}×${box.h.toFixed(1)} @ ${box.x.toFixed(1)},${box.y.toFixed(1)}）`,
    );

    /* ---------- C：块签名（含本底对照） ---------- */
    const rect = { x: box.x, y: box.y, w: box.w, h: box.h };
    /* 同一档连拍两张 = 本底：地图是连续动画（水面/旗子/光照），不先量本底就谈阈值
     * 一定会把"动画"读成"外形变了"。 */
    await evaluate(`window.__castle.set(${JSON.stringify(focus.id)}, 3)`);
    await sleep(260);
    const b1 = await evaluate(sigJs(rect));
    await sleep(200);
    const b2 = await evaluate(sigJs(rect));
    const base = gridDiff(b1, b2).diff;
    console.log(`[info] 同档本底：108 格里 ${base} 格有差异（动画/光照噪声）`);

    const sigs = [];
    for (const lv of [0, 1, 2, 3]) {
      await evaluate(`window.__castle.set(${JSON.stringify(focus.id)}, ${lv})`);
      await sleep(260);
      sigs.push({ lv, s: await evaluate(sigJs(rect)) });
      if (!sigs[sigs.length - 1].s) {
        PASS(false, `第 ${lv} 档取不到画面（画布读不出来）`);
        return;
      }
    }

    /* 门槛按**格**算：整张签名只有 9×12 = 108 格（8px 一格）。
     * 实测四档两两的差是 44~91 格、本底 0 格 ⇒ 20 格（≈18% 画面）留了 2.2× 余量。
     * 第一版写成 400（那是"像素"的量纲）⇒ 永远红 —— 量纲写错比阈值写松更危险。 */
    const need = Math.max(20, base * 4);
    let worst = { d: Infinity, pair: '' };
    let allDifferent = true;
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        const { diff, cells } = gridDiff(sigs[i].s, sigs[j].s);
        if (diff < need) {
          allDifferent = false;
          console.log(`[FAIL] ${i} 档 vs ${j} 档只差 ${diff}/${cells} 格（门槛 ${need}）`);
        }
        if (diff < worst.d) worst = { d: diff, pair: `${i}↔${j}` };
      }
    }
    PASS(allDifferent, `四档两两看得出差别（最接近的一对 ${worst.pair} 差 ${worst.d} 格 / 门槛 ${need}）`);

    /* 负向对照：把墙拆回 0 档，画面必须**回到** 0 档的签名（不是"只改数据"）。 */
    await evaluate(`window.__castle.set(${JSON.stringify(focus.id)}, 0)`);
    await sleep(260);
    const back = await evaluate(sigJs(rect));
    const backDiff = gridDiff(back, sigs[0].s).diff;
    PASS(backDiff <= Math.max(6, base * 3), `拆回 0 档 ⇒ 画面回到 0 档（差 ${backDiff} 格 ≤ 本底 ${base}×3）`);

    const shot = rows.map((r) => `${r.lv}:${r.drawn?.sprite ?? '—'}`).join(' ');
    console.log(`[info] 帧名：${shot}`);
  });
} catch (e) {
  console.error(`✗ 运行失败：${e?.message ?? e}`);
  bad++;
}

console.log(bad === 0 ? '\n结论：S6 城堡外形 全过' : `\n结论：${bad} 项不合格 —— 不要提交`);
process.exit(bad === 0 ? 0 : 1);
