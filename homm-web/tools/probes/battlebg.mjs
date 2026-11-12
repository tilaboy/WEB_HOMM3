#!/usr/bin/env node
/**
 * battlebg.mjs —— 战场地形背景（§11.1 / M5 · U3）的机检（`npm run probe:battlebg`）。
 *
 * ## 它守什么
 * §11.1 的五套背景有一条**可以被糊弄**的判据：「五套两两不同」。
 * 只要把颜色调一点点就能"不同"，但那是"两套几乎一样的草"，玩家读不出地形。
 * 所以这里守三件事，一件一个来源：
 *
 *   [A] **配色分层**（纯函数）：判据是「主色相角差 ≥40° 或 明度差 ≥15」，
 *       调的是 `battleBg.bgSeparation()` —— **与设计侧同一个函数**，不在探针里重写色差公式。
 *   [B] **地形映射**（纯函数）：`battleBgOf(terrain, siegeLevel)` 的 9 条分支，
 *       其中两条是负向对照（攻城档不许"粘住"；`siegeLevel = 0` 时必须回到地形色）。
 *   [C] **真画出来了**（无头 Chrome，读离屏画布）：光有配色表不等于画面上换了色 ——
 *       这一组读**渲染结果**：
 *        · 中场格的实拍颜色在五套之间两两满足上面那条判据（端到端，不是读表）；
 *        · 顶边 6px 里真的有远景剪影（暗像素 ≥ 20）；
 *        · 底边两角真的有前景剪影；
 *        · 前景**没有**越过 16px 内缩线（这条是"不许压住第一/最后一列单位的脚"）。
 *
 * ## 为什么读离屏画布而不是整页截图
 * 离屏画布 1px = 1 场单位、无缩放无 DPR、和 `draw()` 同一帧 —— 整页截图要走合成器，
 * 本机每张 2.5~15s，且会被鼠标悬停/高亮状态污染。`?devprobe=1` 暴露 `window.__battleOff`。
 *
 * ## 负向对照（复跑手册）
 * · `drawFloor()` 忽略 `bg`（写死 `cf_grass_`）⇒ [C1] 五套两两相同的读数必红；
 * · `draw()` 不调 `drawBackdrop()` ⇒ [C2] 顶边暗像素 0，必红；
 * · 前景的 `PAD + 16` 改成 `PAD` ⇒ [C4] 内缩线内出现前景色，必红；
 * · `battleBgOf` 里 `if (siegeLevel > 0) return 'siege'` 挪到 switch 之后 ⇒ [B7] 红。
 *
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足（缺 dist / 缺 Chrome / dev server 起不来）
 */
import { distDir, distUrl, printHeader, requireFile, freePort, serveInProcess } from '../_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from '../_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=battlebg');
requireFile(DIST, 'main.js');
const BG = await import(distUrl('render/battleBg.js', DIST));
const PX = await import(distUrl('render/pixel.js', DIST));
const HEXG = await import(distUrl('core/combat/hex.js', DIST));

// 地砖采样格：**右半场 6 格取中位数**，不取单格。
// 为什么不取单格：玩家回合的「可达」高亮会把大片格子染蓝（实测 col ≤ 7 全被染色，
// 读出来是 #4a726c 而不是 #4c6b34）—— 单点采样会读到高亮色，而不是地砖色。
// 为什么取中位数而不是均值：漏进来的单位/高亮是少数，中位数天然把它们剔掉。
// 格心坐标由 `hexCenter` 给，不在探针里写死 15.15 / 30.31（E1 踩过写死值的坑）。
const MID_CELLS = [
  { col: 9, row: 3 },
  { col: 11, row: 5 },
  { col: 13, row: 7 },
  { col: 10, row: 1 },
  { col: 12, row: 9 },
  { col: 9, row: 8 },
].map((c) => HEXG.hexCenter(c));

let bad = 0;
const PASS = (c, m) => {
  if (!c) bad++;
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`);
};

const { BATTLE_BG_ORDER, BATTLE_BG_SPECS, battleBgOf, bgSeparation, floorRamp } = BG;

/* ---------------- [A] 配色分层 ---------------- */

PASS(BATTLE_BG_ORDER.length === 5, `[A1] 恰好 5 套（${BATTLE_BG_ORDER.join(' / ')}）`);
PASS(new Set(BATTLE_BG_ORDER).size === 5, '[A2] 5 个 id 互不重复');

let worst = null;
let badPairs = [];
for (let i = 0; i < BATTLE_BG_ORDER.length; i++) {
  for (let j = i + 1; j < BATTLE_BG_ORDER.length; j++) {
    const a = BATTLE_BG_ORDER[i];
    const b = BATTLE_BG_ORDER[j];
    const r = bgSeparation(a, b);
    if (!r.ok) badPairs.push(`${a}↔${b} ΔH=${r.dh.toFixed(0)}° ΔL*=${r.dl.toFixed(1)}`);
    // "最紧的一对"按 min(ΔH/40, ΔL*/15) 记，方便下一批上来就先看它
    const margin = Math.min(r.dh / 40, r.dl / 15);
    if (!worst || margin < worst.margin) worst = { pair: `${a}↔${b}`, margin, dh: r.dh, dl: r.dl };
  }
}
PASS(
  badPairs.length === 0,
  `[A3] 10 对全部满足「ΔH≥40° 或 ΔL*≥15」${badPairs.length ? ' · ' + badPairs.join(' · ') : ''}` +
    ` · 最紧 ${worst.pair} ΔH=${worst.dh.toFixed(0)}° ΔL*=${worst.dl.toFixed(1)}`,
);

// 色阶必须单调变亮：ramp 的第 0 项最暗、第 4 项最亮 —— 否则地砖上的噪声会读成"脏"
const rampsOk = BATTLE_BG_ORDER.every((bg) => {
  const r = floorRamp(bg).map((c) => PX.lstar(c));
  return r.length === 5 && r.every((v, i) => i === 0 || v > r[i - 1]);
});
PASS(rampsOk, '[A4] 每套 5 级地砖色阶严格变亮（暗→亮）');

/* ---------------- [B] 地形映射 ---------------- */

const map = [
  ['grass', 0, 'grass'],
  ['dirt', 0, 'dirt'],
  ['sand', 0, 'dirt'],
  ['snow', 0, 'snow'],
  ['swamp', 0, 'swamp'],
  ['rock', 0, 'swamp'],
  [undefined, 0, 'grass'],
  // 负向对照：攻城档只由 siegeLevel 决定，不许"粘住"上一场
  ['snow', 3, 'siege'],
  ['grass', 1, 'siege'],
];
const badMap = map.filter(([t, s, want]) => battleBgOf(t, s) !== want);
PASS(
  badMap.length === 0,
  `[B1] 地形→背景 ${map.length} 条全覆盖（含 sand/rock 归并、攻城强制 siege）` +
    `${badMap.length ? ' · 错: ' + badMap.map(([t, s, w]) => `${t ?? 'undefined'}/${s}→${battleBgOf(t, s)}≠${w}`).join(' ') : ''}`,
);

/* ---------------- [C] 真画出来了（无头 Chrome） ---------------- */

if (!chromeAvailable()) {
  console.error('✗ 前置不满足：找不到 Chrome（可用 env CHROME 覆盖）。');
  process.exit(2);
}
const PORT = await freePort();
if (!(await serveInProcess(DIST, PORT))) {
  console.error(`✗ 前置不满足：自起 dev server 未就绪（port ${PORT}）。`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 取离屏画布上的一批读数（同一帧内取完，避免中途重绘）。 */
const readProbe = `(() => {
  const c = window.__battleOff;
  const sc = window.__battleScene;
  if (!c || !sc) return null;
  const g = c.getContext('2d');
  const W = sc.baseW, H = sc.baseH, PAD = sc.pad;
  const img = g.getImageData(0, 0, W, H);
  const at = (x, y) => { const i = (y * W + x) * 4; return [img.data[i], img.data[i+1], img.data[i+2]]; };
  // ① 地砖：6 格各取 5×5 均值，再对每通道取中位数
  const pick = (px, py) => {
    let r = 0, g2 = 0, b = 0, n = 0;
    for (let y = py - 2; y <= py + 2; y++) for (let x = px - 2; x <= px + 2; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const p = at(x, y); r += p[0]; g2 += p[1]; b += p[2]; n++;
    }
    return [r / n, g2 / n, b / n];
  };
  const samples = ${JSON.stringify(MID_CELLS)}.map((c) => pick(Math.round(c.x) + PAD, Math.round(c.y) + PAD));
  const med = (k) => samples.map((p) => p[k]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  const mid = [Math.round(med(0)), Math.round(med(1)), Math.round(med(2))];
  // ② 顶边 6px（远景带）
  const topBand = [];
  for (let y = 0; y < PAD; y++) for (let x = 0; x < W; x++) topBand.push(at(x, y));
  // ③ 右下角**地面带**（不是画布底边）：y ∈ [H-PAD-10, H-PAD]，这一段在场地内、
  //    高于最后一排单位的脚（脚在格心），所以里面只可能是前景剪影。
  //    取右侧：左侧会被玩家可达高亮整片染蓝，颜色比对会被染色骗过。
  const foreZone = [];
  for (let y = H - PAD - 10; y < H - PAD; y++) for (let x = W - PAD - 16 - 32; x < W - PAD - 16; x++) foreZone.push(at(x, y));
  // ④ 内缩线以内（右侧同一条高度带，x ∈ [W-PAD-15, W-PAD]）：前景绝不许出现
  const insetZone = [];
  for (let y = H - PAD - 10; y < H - PAD; y++) for (let x = W - PAD - 15; x < W; x++) insetZone.push(at(x, y));
  return { W, H, PAD, mid, topBand, foreZone, insetZone };
})()`;

const shots = {};
await withHeadlessChrome(async ({ send, evaluate }) => {
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 520, deviceScaleFactor: 1, mobile: false });
  for (const bg of BATTLE_BG_ORDER) {
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?devquick=1&devbattle=1&devprobe=1&devbg=${bg}` });
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      await sleep(350);
      ready = await evaluate(`!!(window.__battleOff && window.__battleScene && window.__battleScene.baseW)`).catch(() => false);
    }
    if (!ready) continue;
    await sleep(500);
    const r = await evaluate(readProbe);
    if (r) shots[bg] = r;
  }
}, { devServerPort: PORT });

PASS(
  Object.keys(shots).length === 5,
  `[C0] 五套都拿到了离屏画布读数（${Object.keys(shots).join(' / ') || '无'}）`,
);
if (Object.keys(shots).length === 5) {
  const hx = (p) => '#' + p.map((v) => v.toString(16).padStart(2, '0')).join('');

  // C1：端到端 —— 中场格实拍色两两可区分（不是读配色表，是读渲染结果）
  const mids = BATTLE_BG_ORDER.map((bg) => ({ bg, hex: hx(shots[bg].mid) }));
  const badMid = [];
  let tight = null;
  for (let i = 0; i < mids.length; i++) {
    for (let j = i + 1; j < mids.length; j++) {
      let dh = Math.abs(PX.hueOf(mids[i].hex) - PX.hueOf(mids[j].hex));
      if (dh > 180) dh = 360 - dh;
      const dl = Math.abs(PX.lstar(mids[i].hex) - PX.lstar(mids[j].hex));
      if (!(dh >= 40 || dl >= 15)) badMid.push(`${mids[i].bg}↔${mids[j].bg} ΔH=${dh.toFixed(0)} ΔL*=${dl.toFixed(1)}`);
      const m = Math.min(dh / 40, dl / 15);
      if (!tight || m < tight.m) tight = { m, pair: `${mids[i].hex}↔${mids[j].hex}`, dh, dl };
    }
  }
  PASS(
    badMid.length === 0,
    `[C1] 中场格实拍色 10 对全部可区分（${mids.map((m) => `${m.bg}=${m.hex}`).join(' ')}）` +
      `${badMid.length ? ' · 红: ' + badMid.join(' ') : ''} · 最紧 ${tight.pair} ΔH=${tight.dh.toFixed(0)}° ΔL*=${tight.dl.toFixed(1)}`,
  );

  // C2：顶边远景带真的画了剪影。判据用"比该套 outer 更暗的像素数"，
  //     不写死颜色 —— 五套的剪影色本来就不同。
  const bandCounts = BATTLE_BG_ORDER.map((bg) => {
    const outerL = PX.lstar(BATTLE_BG_SPECS[bg].outer);
    const dark = shots[bg].topBand.filter((p) => PX.lstar(hx(p)) < outerL - 2).length;
    return { bg, dark };
  });
  PASS(
    bandCounts.every((b) => b.dark >= 20),
    `[C2] 每套顶边都有远景剪影（暗于 outer 的像素）· ${bandCounts.map((b) => `${b.bg} ${b.dark}`).join(' / ')}`,
  );

  // 与某套的 `fore` 色距离 ≤ 20 的像素数（前景剪影是纯色块，匹配得住）
  const near = (p, hex, tol = 20) => {
    const [r, g, b] = PX.rgbOf(hex);
    return Math.abs(p[0] - r) + Math.abs(p[1] - g) + Math.abs(p[2] - b) <= tol;
  };
  // C3：右下角地面带里真的有该套的前景色
  const foreCounts = BATTLE_BG_ORDER.map((bg) => ({
    bg,
    n: shots[bg].foreZone.filter((p) => near(p, BATTLE_BG_SPECS[bg].fore)).length,
  }));
  PASS(
    foreCounts.every((b) => b.n >= 10),
    `[C3] 每套右下角都有前景剪影（匹配该套 fore 色的像素数）· ${foreCounts.map((b) => `${b.bg} ${b.n}`).join(' / ')}`,
  );

  // C4：前景不许越过 16px 内缩线（否则会压住最后一列单位的脚）
  const leaks = BATTLE_BG_ORDER.map((bg) => ({
    bg,
    n: shots[bg].insetZone.filter((p) => near(p, BATTLE_BG_SPECS[bg].fore)).length,
  }));
  PASS(
    leaks.every((l) => l.n === 0),
    `[C4] 内缩线内无前景剪影（不许压单位脚）· ${leaks.map((l) => `${l.bg} ${l.n}`).join(' / ')}`,
  );
}

console.log('');
if (bad) {
  console.log(`✗ ${bad} 条不过`);
  process.exit(1);
}
console.log('✓ 全过');
// 必须显式退出：`serveInProcess` 起的 http server 会让事件循环一直有活，
// 跑到最后不 exit 就是「全部 PASS 但命令永不返回」—— 首轮实测挂 14 分钟，
// 被外层 timeout 杀掉，看起来像"探针卡住"，其实是收尾漏了一行。
process.exit(0);
