#!/usr/bin/env node
/**
 * terrainedgeprobe.mjs —— 「地形交界」的机检门（2026-10-23）
 *
 * 起因：主理人反复说"图很粗糙"。逐屏看完后定位到一条**比"没有过渡带"更糟**的事实：
 * 过渡带一直存在（`TerrainLayer.bakeFringes`），但它用的是色板**最亮**的一档
 * `TERRAIN[n].top`（沙地 `#e8d6a3`，L=214），而旁边的沙地砖经纹理+光照后只有 L≈175、
 * 草地只有 L≈120 ⇒ 每条地形界上都有一圈**比两侧都亮 39~94** 的实色边。
 * 眼睛把它读成"发光描边 / 剪纸贴片"。
 *
 * 为什么用**合成地图**在 node 里量，而不是截真机图：
 *   真机图里地形边界在哪、镜头停在哪、当天光照多亮，每次都不一样 ⇒ 数字不可复现。
 *   这里是 W×H 的合成图（左半 A / 右半 B），`TerrainLayer.bake()` 是**运行期同一份代码**
 *   （经 `tools/_canvas.mjs` 垫片）⇒ 量的是真实现，且每次逐像素可复现。
 *   诚实边界：垫片只做最近邻 + 实色填充 + alpha 合成，**不做合成算子/双线性**；
 *   而过渡带的绘制只用这几种原语 ⇒ 本探针的结论对该层成立，
 *   **不**外推到"真机整屏像素一致"（那一层另有 `probe:mapshadow` / 截图肉眼复核）。
 *
 * 判据（全部可数）：
 *   ① overshoot  交界剖面峰值 − 两侧砖亮度：≤ 12（改前 39/14/8/11）
 *   ② presence   过渡带仍在：低优先级一侧贴边那列「越过半程」的比例 ≥ 0.9
 *                （防止为了"不凸起"干脆不画）
 *   ③ lit        过渡带随光走：同一交界在地图最北与最南的亮度差 ≥ 5
 *                （旧口径是**恒定色**，这条必红）
 *
 * 负向对照（铁律 §2）：
 *   `--inject=top`   取色退回 `top`      ⇒ ① 变红
 *   `--inject=flat`  关掉两层光照       ⇒ ③ 变红
 *   `--inject=none`  过渡带深度设 0      ⇒ ② 变红
 *   `--selfcheck` 逐条跑并断言闸确实红。
 *
 * 用法：
 *   node tools/terrainedgeprobe.mjs             # 跑门（需要 dist/）
 *   node tools/terrainedgeprobe.mjs --selfcheck # 负向对照
 *   node tools/terrainedgeprobe.mjs --json
 *
 * 退出码：0 全绿 · 1 有判据红 · 2 前置不满足（无 dist / 垫片不可用）
 */
import { installShim } from './_canvas.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (k, d = null) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
let INJECT = opt('inject');
const SELFCHECK = has('--selfcheck');
const AS_JSON = has('--json');

const TILE = 32;
/** 四组交界：覆盖"亮→更亮 / 亮→暗 / 暗→亮 / 亮→灰"。 */
const PAIRS = [
  ['grass', 'sand', '草地→沙地'],
  ['grass', 'dirt', '草地→土路'],
  ['sand', 'snow', '沙地→雪原'],
  ['grass', 'rock', '草地→岩地'],
];

const rows = [];
function check(id, label, ok, detail) {
  rows.push({ id, label, ok: !!ok, detail });
  return ok;
}

installShim();
let TerrainLayer;
try {
  ({ TerrainLayer } = await import('../dist/render/terrainLayer.js'));
} catch (e) {
  console.error(`✗ 前置：读不到 dist（先 npm run build）。${e?.message ?? e}`);
  process.exit(2);
}

/** 合成一张 W×H、左半 a 右半 b 的地图并烘一次，返回可查询的像素表。 */
function bakePair(a, b, h = 24) {
  const W = 12;
  const tiles = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < W; x++) tiles.push({ terrain: x < W / 2 ? a : b, objectId: null });
  }
  const map = { width: W, height: h, tiles };
  const layer = new TerrainLayer();
  if (INJECT === 'top') layer.fringeTone = 'top';
  if (INJECT === 'none') layer.fringeDepth = 0;
  if (INJECT === 'flat') {
    layer.macroShade = false;
    layer.regionShade = false;
  }
  const cv = layer.ensure(map);
  const ctx = cv.getContext('2d');
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  const lum = (x, y) => {
    const i = (y * cv.width + x) * 4;
    return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
  };
  const rgb = (x, y) => {
    const i = (y * cv.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };
  // ⚠️ 单位：`hTiles` 是格数，`hPx` 才是像素高。早先把 24 格当 24 像素用，
  // 结果"每格中点"只采到第一格（`ty*TILE` 落进同一格）——探针的量尺必须和对象同单位。
  return { cv, lum, rgb, bx: (W / 2) * TILE, hTiles: h, hPx: h * TILE };
}

/** 某一列（相对交界的偏移 d）在所有行上的平均亮度。`y0/y1` 可只取一段行。 */
function colMean(p, d, y0 = 0, y1 = p.hPx) {
  let s = 0;
  for (let y = y0; y < y1; y++) s += p.lum(p.bx + d, y);
  return s / Math.max(1, y1 - y0);
}

function pairMetrics(a, b) {
  const p = bakePair(a, b);
  const left = colMean(p, -14);
  const right = colMean(p, 14);
  // 剖面：从低优先级一侧的贴边列（d=-1）向外 6px
  const prof = [];
  for (let d = -6; d <= 0; d++) prof.push(colMean(p, d));
  const peak = Math.max(...prof, colMean(p, 1));
  const overshoot = peak - Math.max(left, right);

  // presence：贴边那列离"左砖"有多远 —— 用**颜色距离**而不是亮度。
  // 亮度差对「草地→土路」这类**同亮度、不同色相**的交界失效（实测 0%，
  // 但过渡带其实画满了），必须用 RGB 距离。
  const meanRgb = (x0, x1) => {
    let r = 0;
    let g = 0;
    let bl = 0;
    let n = 0;
    for (let y = 0; y < p.hPx; y++) {
      for (let x = p.bx + x0; x <= p.bx + x1; x++) {
        const c = p.rgb(x, y);
        r += c[0];
        g += c[1];
        bl += c[2];
        n++;
      }
    }
    return [r / n, g / n, bl / n];
  };
  const dist = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
  const cLeft = meanRgb(-14, -8);
  const cRight = meanRgb(8, 14);
  const span = Math.max(1, dist(cLeft, cRight));
  let cls = 0;
  let n = 0;
  for (let y = 0; y < p.hPx; y++) {
    const dRatio = dist(p.rgb(p.bx - 1, y), cLeft) / span;
    if (dRatio >= 0.5) cls++;
    n++;
  }
  return { left, right, peak, overshoot, presence: cls / n, prof };
}

/**
 * 过渡带是否**跟着光照走**：取交界贴边那一列，在每一格的中心采样，算跨行标准差。
 *
 * 为什么不用"最北 vs 最南"两点差：那只是两个采样，macroTone 的起伏可能刚好抵消
 * 方向光（实测南北只差 4.5）。标准差是"它到底有没有随位置变"的直接量。
 *
 * ⚠️ 取样必须是不同**格**：早先写成 y=1 与 y=22，两者都在 tile row 0
 * （一格 32px），量到"南北完全一样"——那是探针的错，不是实现的错。
 *
 * 旧口径（`top`）= 恒定色 ⇒ 标准差 **0.00**；新口径 15.7。
 */
function litSpread(a, b) {
  const p = bakePair(a, b, 24);
  const rows = p.hTiles;
  const vals = [];
  for (let ty = 0; ty < rows; ty++) vals.push(p.lum(p.bx - 1, ty * TILE + TILE / 2));
  const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((x, y) => x + (y - mean) ** 2, 0) / vals.length);
  return { min: Math.min(...vals), max: Math.max(...vals), sd };
}

function judge() {
  rows.length = 0;

  const ms = PAIRS.map(([a, b, label]) => ({ label, ...pairMetrics(a, b) }));
  const worst = ms.reduce((m, x) => (x.overshoot > m.overshoot ? x : m), ms[0]);
  check(
    'overshoot',
    '交界处的过渡带不比两侧更亮（≤12）',
    ms.every((m) => m.overshoot <= 12),
    ms.map((m) => `${m.label} ${m.overshoot.toFixed(0)}`).join(' · ') + `（最差 ${worst.label} ${worst.overshoot.toFixed(0)}）`,
  );

  const thin = ms.filter((m) => m.presence < 0.9);
  check(
    'presence',
    '过渡带仍然存在（贴边列 ≥90% 越过半程）',
    thin.length === 0,
    ms.map((m) => `${m.label} ${(m.presence * 100).toFixed(0)}%`).join(' · '),
  );

  const lit = litSpread('grass', 'sand');
  check(
    'lit',
    '过渡带跟着光照变（跨格标准差 ≥5）',
    lit.sd >= 5,
    `L 范围 ${lit.min.toFixed(0)}~${lit.max.toFixed(0)} · 标准差 ${lit.sd.toFixed(1)}（恒定色为 0）`,
  );

  // 顺带把"剖面"打出来，避免只看三个数字
  for (const m of ms) {
    rows.push({
      id: `profile:${m.label}`,
      label: '剖面（d=-6…0）',
      ok: true,
      detail: m.prof.map((v) => v.toFixed(0)).join(' → ') + `（两侧 ${m.left.toFixed(0)} / ${m.right.toFixed(0)}）`,
    });
  }
  return rows.filter((r) => !r.id.startsWith('profile:')).every((r) => r.ok);
}

const green = judge();
if (AS_JSON) {
  console.log(JSON.stringify({ green, inject: INJECT, rows }, null, 2));
} else {
  for (const r of rows) console.log(`${r.ok ? '✅' : '❌'} [${r.id}] ${r.label} — ${r.detail}`);
  if (INJECT) console.log(`   · 注入 ${INJECT}`);
}

if (SELFCHECK) {
  let bad = 0;
  for (const which of ['top', 'flat', 'none']) {
    INJECT = which;
    const g = judge();
    const ok = g === false;
    console.log(`${ok ? '✅' : '❌'} 负向对照 --inject=${which} → 闸${ok ? '变红' : '仍绿（闸失效）'}`);
    if (!ok) bad++;
  }
  process.exit(bad ? 1 : 0);
}
process.exit(green ? 0 : 1);
