#!/usr/bin/env node
/**
 * reachmeas.mjs —— ④ 可达染色「状态 vs 其底」WCAG 复测（真机视口 A/B，绑构建）。
 *
 * ## 口径（与 accessibility-requirements.md §4.6 / tools/tintab.mjs 一致）
 *   · A/B = 同场景、同相机、**同像素**，只差 `MapRenderer` 那一层。
 *   · population **必填 + 不得用阈值筛人口**：覆盖判据 = 通道差 `max|Δ| > 4`（tintab 同款）。
 *   · 主统计量 = 变化像素上的 WCAG 对比度 **中位** + **≥3:1 像素占比**。
 *   · 分类帧 = **相位帧**（按 `before` 像素 = **同相位的底**分类）—— 这是契约第 1 条（口径=A/B，本工具）
 *     的**下游**，不是另设选项；旧的"正午帧"属跨相位错桶（会把夜间深草记进「草·中」）。
 *   · 桶定义（`population` 的类）= **单一权威 = `tools/tintab.mjs`**；本文件是复述，
 *     并由 `guardSameLadder()` **运行时比对**（漂移即 `exit 2`）—— 防 `ff7db9c`「两套定义出两个数」。
 *
 * ## 为什么这对图能直接量「状态 vs 其底」
 *   `68abf37 → 3e8084f` 只给「不可走边界」**加了一条外侧墨**（红的位置/厚度逐字未变，
 *   `EDGE_W`=旧的硬编码 2）⇒ 变化像素 = **新增的那圈墨**；这些像素在 before 图里
 *   = **裸地形** ⇒ `WCAG(after, before)` 正是「墨 vs 其底」。
 *
 * ## 附带两件诚实性检查
 *   · **污染检查**：after 像素是否就是"不透明墨色"（否则 = 水面动画/抗锯齿等噪声，须剔除并报告）。
 *   · **按地形分档**：均值过 ≠ 全过（§15.4 教训）—— 分档看哪片地不过。
 *
 * 用法：node tools/reachmeas.mjs <after.png> <before.png> <label>
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(buf) {
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) throw new Error('unsupported png');
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++]; const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev ? prev[x] : 0, c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v = (v + a) & 0xff; else if (f === 2) v = (v + b) & 0xff;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; v = (v + pr) & 0xff; }
      cur[x] = v;
    }
  }
  return { width, height, ch, data: out };
}
const px = (img, i) => [img.data[i], img.data[i + 1], img.data[i + 2]];
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const Y = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const Lstar = (r, g, b) => { const y = Y(r, g, b); return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y; };
const ratio = (p, q) => { const y1 = Y(...p), y2 = Y(...q); return (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05); };
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : 'n/a');
const pctl = (s, f) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : NaN);

/* 地形分档阈值 —— 契第 2 条（population = 按地形逐类）要求**两工具同套桶**。
 * **单一权威 = `tools/tintab.mjs` 的 `classify()` + `GRASS_L_BRIGHT/MID`**；本文件是**复述**。
 * 复述就会漂（`ff7db9c` 病根：两套定义出两个数）⇒ 下方 `guardSameLadder()` 运行时比对，不一致即硬失败。 */
const L_DARK_MAX = 22;      // L* < 22 ⇒ 暗（含物件/接缝，未再细分）
const WATER_DELTA = 12;     // b 最大且 b > r + 12 ⇒ 水
const SAND_MIN_R = 120;     // r 最大且 g ≥ b 且 r > 120 ⇒ 沙/土
const GRASS_L_BRIGHT = 55;  // 草·亮 L* ≥ 55
const GRASS_L_MID = 40;     // 草·中 40 ≤ L* < 55；其余（≥22）⇒ 草·深

function band(r, g, b) {   // 分类取 before 像素（=该相位的底 ⇒ 同相位帧）
  const L = Lstar(r, g, b); const mx = Math.max(r, g, b);
  if (L < L_DARK_MAX) return '暗(物件/接缝)';
  if (b === mx && b > r + WATER_DELTA) return '水(蓝主导)';
  if (r === mx && g >= b && r > SAND_MIN_R) return '沙/土(暖亮)';
  if (g >= r && g > b) return L >= GRASS_L_BRIGHT ? '草·亮' : L >= GRASS_L_MID ? '草·中' : '草·深';
  return '其他';
}
// 样本不足门槛：低于它**不得据此判"过"** —— 防"该类在本相位不存在 ⇒ 真空通过"（夜间 `草·亮` 会塌成 n≈0）
const MIN_N = 200;

/* ---- 桶定义守卫：两工具不得各写一套（`ff7db9c` 病根）---------------------------
 * **不信任注释，直接读 `tintab.mjs` 的声明值比对。**
 *   · 读不到 ⇒ **只警告、不阻断**（本工具须能独立跑，不能依赖别的文件在位）；
 *   · 读得到但不一致 ⇒ **硬失败 `exit 2`**（0 命中硬守卫）。
 * 负测法：把 `tintab.mjs` 拷到别处改一个阈值，
 *   `TINTAB_SRC=/tmp/tintab_bad.mjs node tools/reachmeas.mjs <after> <before> <标签>` ⇒ 应 RED、退出码 2。
 */
function guardSameLadder() {
  const target = process.env.TINTAB_SRC || new URL('./tintab.mjs', import.meta.url);
  let text;
  try { text = readFileSync(target, 'utf8'); }
  catch { console.log('  ⚠️ 桶定义守卫：读不到 tintab.mjs ⇒ 本次未校验（不阻断）'); return; }
  const grab = (hay, re) => { const m = re.exec(hay); return m ? Number(m[1]) : null; };
  const body = (/function classify\(r, g, b\) \{([\s\S]*?)\n\}/.exec(text) || [])[1] || '';
  const theirs = {
    L_DARK_MAX: grab(body, /L < (\d+)/),
    WATER_DELTA: grab(body, /b > r \+ (\d+)/),
    SAND_MIN_R: grab(body, /r > (\d+)/),
    GRASS_L_BRIGHT: grab(text, /GRASS_L_BRIGHT = (\d+)/),
    GRASS_L_MID: grab(text, /GRASS_L_MID = (\d+)/),
  };
  const mine = { L_DARK_MAX, WATER_DELTA, SAND_MIN_R, GRASS_L_BRIGHT, GRASS_L_MID };
  const unknown = Object.keys(mine).filter((k) => theirs[k] === null);
  const bad = Object.keys(mine).filter((k) => theirs[k] !== null && mine[k] !== theirs[k]);
  if (unknown.length) console.log(`  ⚠️ 桶定义守卫：tintab.mjs 里 ${unknown.join('/')} 未解析出 ⇒ 这几项未校验`);
  if (bad.length) {
    for (const k of bad) console.error(`  ✖ 桶定义漂移：${k} — 本文件 ${mine[k]} vs tintab.mjs ${theirs[k]}`);
    console.error('  ⇒ 契约第 2 条要求两工具同套桶；桶不一致 ⇒ 两工具的数不可比（ff7db9c 病根）。改到一致后再复算。');
    process.exit(2);
  }
  if (!unknown.length) {
    console.log(`  ✅ 桶定义守卫：与 tintab.mjs 同套（L*<${theirs.L_DARK_MAX}→暗 ｜ b>r+${theirs.WATER_DELTA}→水 ｜ r>${theirs.SAND_MIN_R}→沙 ｜ 草 L*≥${theirs.GRASS_L_BRIGHT}/≥${theirs.GRASS_L_MID}）`);
  }
}
const ORDER = ['草·亮', '草·中', '草·深', '沙/土(暖亮)', '水(蓝主导)', '暗(物件/接缝)', '其他'];

const [afterF, beforeF, label, classRefF] = process.argv.slice(2);
const A = decodePng(readFileSync(afterF));
const B = decodePng(readFileSync(beforeF));
if (A.width !== B.width || A.height !== B.height) throw new Error('尺寸不同');
const n = A.width * A.height;

/* ★ 分类帧（契约第 2 条「`population` = **按地形**逐类」）-----------------------------------
 * 「地形」是**身份**、不是"此刻看起来多亮" ⇒ 分类必须在**光照恒等帧（正午 `none`）**上做，**测量仍按各相位**。
 * ⚠️ 若用**同相位底**分类：夜间 multiply 把底压到 L* < 55 ⇒「草·亮」塌成 n≈0（`-2` 实测 n=4–122）
 *    ⇒ 契约"每一类都必须 ≥3:1"会被"**该类在本相位不存在**"**真空通过** —— 这正是要防的死区洗白。
 * ⇒ **第 4 个参数 = 分类帧**（传**正午 `none` 的 before 底图**）。
 *    不给 ⇒ 退回同相位 before：**仅自洽，不可跨相位比、不可与 `tintab` 拼表**（同名桶不是同一批像素）。
 *   （旧 7 行表「草·深 夜 1.42」＝正午切桶、夜间测量 ⇒ 现在这是**规定动作**，不是缺陷。）
 * 复算：`node tools/reachmeas.mjs <after> <before> <标签> <正午 before 底图>`
 */
const C = classRefF ? decodePng(readFileSync(classRefF)) : null;
if (C && (C.width !== B.width || C.height !== B.height)) {
  throw new Error(`分类帧尺寸不同：${C.width}×${C.height} vs before ${B.width}×${B.height}`);
}
const classOf = (i, r) => (C ? band(...px(C, i * C.ch)) : band(...r.b));

// 先找 after 里"最常出现的变化色"= 不透明墨色（自动适应相位乘光）
const hist = new Map();
const rows = [];
for (let i = 0; i < n; i++) {
  const a = px(A, i * A.ch), b = px(B, i * B.ch);
  if (Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) <= 4) continue;
  const k = a.join(',');
  hist.set(k, (hist.get(k) || 0) + 1);
  rows.push({ a, b, k, i });
}
const inkKey = [...hist.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
const ink = inkKey ? inkKey.split(',').map(Number) : null;
const isInk = (a) => ink && Math.abs(a[0] - ink[0]) <= 3 && Math.abs(a[1] - ink[1]) <= 3 && Math.abs(a[2] - ink[2]) <= 3;

const all = [], inkPx = [], perBand = new Map(ORDER.map((k) => [k, []]));
let darkEnd = 0;   // after 落在"暗端"= 墨像素特征（比精确色匹配鲁棒）
for (const r of rows) {
  const c = ratio(r.a, r.b); all.push(c);
  if (r.a[0] < 80 && r.a[1] < 70) darkEnd++;
  if (isInk(r.a)) { inkPx.push(c); perBand.get(classOf(r.i, r)).push(c); }
}
const stat = (s) => { s = s.slice().sort((x, y) => x - y); return { n: s.length, med: pctl(s, 0.5), p10: pctl(s, 0.1), p90: pctl(s, 0.9), ge3: s.length ? (100 * s.filter((c) => c >= 3).length) / s.length : NaN }; };

console.log(`\n[${label}]`);
console.log(`  after = ${afterF.split('/').pop()}   before = ${beforeF.split('/').pop()}`);
console.log(`  population = 变化像素（通道差 max|Δ| > 4）`);
console.log(
  C
    ? `  分类帧 = **身份帧（${classRefF.split('/').pop()}）** ✅ —— 同一像素跨相位落同一桶 ⇒ 与 tintab（受控场景=身份）同 population`
    : `  ⚠️ 分类帧 = 同相位 before（**未给第 4 参**）⇒ 与 tintab 的**同名桶不是同一批像素、不可拼表**；且夜间「草·亮」可能塌成 n≈0 ⇒ **真空通过**。契约第 2 条要"按地形" ⇒ 请把正午 none 底图作为第 4 参传入`,
);
console.log(`  （★ 分类**只用身份帧**；**测量逐相位** —— 这正是契约"每一类 × 每一相位都必须 ≥3:1"要的）`);
guardSameLadder();
const sa = stat(all), si = stat(inkPx);
console.log(`  全部变化像素 : n=${sa.n} (${((sa.n / n) * 100).toFixed(2)}% 屏)  WCAG 中位 ${f2(sa.med)}  p10 ${f2(sa.p10)}  p90 ${f2(sa.p90)}  ≥3:1 ${sa.ge3.toFixed(1)}%`);
console.log(`  暗端检查      : after 落在暗端(a[0]<80 且 a[1]<70) 占 ${((100 * darkEnd) / sa.n).toFixed(1)}% ← 墨像素特征；≈90% ⇒ population 基本就是新增墨`);
console.log(`  强墨像素(±3)  : n=${si.n}（受暗角/渐变影响会漏，**只作旁证**）  WCAG 中位 ${f2(si.med)}  ≥3:1 ${si.ge3.toFixed(1)}%`);
console.log(`  ── 墨像素按"其底地形"分档（均值过 ≠ 全过）`);
console.log(`     地形              |    n   | WCAG 中位 | ≥3:1`);
const thin = [];
for (const k of ORDER) {
  const s = stat(perBand.get(k));
  if (!s.n) { thin.push(`${k}(n=0)`); continue; }
  const bad = s.n < MIN_N;
  if (bad) thin.push(`${k}(n=${s.n})`);
  console.log(`     ${k.padEnd(16)} | ${String(s.n).padStart(6)} | ${f2(s.med).padStart(8)}  | ${s.ge3.toFixed(1)}%${bad ? `   ← ⚠️ n<${MIN_N} 样本不足，不得据此判过` : ''}`);
}
if (thin.length) console.log(`     ⚠️ 样本不足/不存在：${thin.join('、')} ⇒ 这些类**不能算"过"**（防真空通过）`);
console.log(`     锚 = WCAG 1.4.11 非文本 3:1`);
