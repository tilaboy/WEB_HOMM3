#!/usr/bin/env node
/**
 * reachmeas.mjs —— ④ 可达染色「状态 vs 其底」WCAG 复测（真机视口 A/B，绑构建）。
 *
 * ## 口径（与 accessibility-requirements.md §4.6 / tools/tintab.mjs 一致）
 *   · A/B = 同场景、同相机、**同像素**，只差 `MapRenderer` 那一层。
 *   · population **必填 + 不得用阈值筛人口**：覆盖判据 = 通道差 `max|Δ| > 4`（tintab 同款）。
 *   · 主统计量 = 变化像素上的 WCAG 对比度 **中位** + **≥3:1 像素占比**。
 *   · 分类帧 = **身份帧**（**分类**取第 4 参 = **正午 `none` 的 before 底图**；**测量**逐相位各自做）。
 *     「地形」是**身份**、不随光照变 ⇒ 同一像素跨相位落同一桶、可与 `tintab` 拼表。
 *     ⛔ **相位帧已废**（按 `before` 同相位底分类）：夜间 multiply 把底压暗 ⇒「草·亮」塌成 n≈0
 *     ⇒ 契约第 3 条「每一类都必须 ≥3:1」被"**该类在本相位不存在**"**真空通过**（`-2` 实测 n=5）。
 *     不给第 4 参 ⇒ 退回同相位并**告警**（仅自洽，**不可与 `tintab` 拼表**）。
 *
 * ## ⚠️ 已核：本表「按地形分档」那一列的人口 = **`±3` 墨核**（地形偏置，勿当全部）
 *   本文件**逐类那一列**只统计 `after ≈ 众数变化色(±3)` 的像素（= 污染检查留下的"纯墨核"）。
 *   实测（`i_reach_*` 身份帧，2026-09-21）：该 `±3` 门槛**对暗底偏置** —— 暗底上墨达不到纯墨色
 *   （`after` 落在比"墨"和"底"都更暗的一簇，如 `rgb(24,18,17)`），于是**暗类的墨核被大量漏掉**：
 *   暗类实际变化 `11094(午)/10785(夜)`，其中 `±3` 墨核只有 `15(午)/517(夜)`。
 *   ⇒ 判据（逐类全过 ≥3:1）在**两种人口下同判**（暗 `1.16` vs 全变化 `1.20`；夜 `1.13` vs `1.11`），
 *     **故现行判词不受此偏置影响**；但"某格 n=15"**不等于"该类只有 15 个像素"**，引用时勿混。
 *   ⇒ 全变化人口另见 `/tmp/watercheck.mjs`（一次性诊断，**非验收数**）；是否把它并入本表待裁。
 *   ⚠️ **未决**：暗/岩底上"非墨、且**不与墨核 8 邻接**"的变化占非墨变化的 **81%**（午 `17346/21460`），
 *     且 `after` 暗于"墨"与"底"两者 ⇒ **不能只归因抗锯齿** ⇒ 疑本就非染色层一次变化 ⇒ **待查**。
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
const darkSplit = new Map([['暗·墨撞（before≈本相位墨色）', []], ['暗·底暗（影/缝/地形）', []]]);
let darkEnd = 0;   // after 落在"暗端"= 墨像素特征（比精确色匹配鲁棒）
for (const r of rows) {
  const c = ratio(r.a, r.b); all.push(c);
  if (r.a[0] < 80 && r.a[1] < 70) darkEnd++;
  if (isInk(r.a)) {
    inkPx.push(c);
    const kk = classOf(r.i, r);
    perBand.get(kk).push(c);
    if (kk === '暗(物件/接缝)') darkSplit.get(isInk(r.b) ? '暗·墨撞（before≈本相位墨色）' : '暗·底暗（影/缝/地形）').push(c);
  }
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
/* ── 诊断：「暗(物件/接缝)」拆两半（判 (a)/(b)/(c) 用）────────────────────────────────
 * 判据：该类的**失败机制**决定处方 ——
 *   ① `暗·墨撞`（`before` ≈ **本相位的墨色**）⇒ 是「**同色线相撞**」（④ 描边撞上物件自带的 `ink0` 描边）
 *      ⇒ 量的是"墨 vs 墨" ⇒ **不是"底太暗"** ⇒ 处方 = **插亮带/改 z-order**（(ii) 的亮芯正好破它）。
 *   ② `暗·底暗`（底是去饱和的地形/影/缝）⇒ 是「**底本来就暗**」⇒ 处方 = **亮芯**（(ii) 的目的）。
 * ⇒ 若 ① 占比极低 ⇒ 该类基本是"底暗" ⇒ **不必 (a)/(b)**，交 (ii)。
 * ⇒ 若 ① 占比高 ⇒ 才轮到 (a)「描边画在物件之上」；(a) 也不可接受时才 (b) 排除+写明理由。
 */
if (darkSplit.size) {
  console.log(`  ── 诊断：「暗(物件/接缝)」拆两半（判 (a)/(b)/(c) 用）`);
  for (const [k, arr] of darkSplit) {
    const s = stat(arr);
    if (!s.n) { console.log(`     ${k.padEnd(26)} | n=0`); continue; }
    console.log(`     ${k.padEnd(26)} | ${String(s.n).padStart(6)} | WCAG 中位 ${f2(s.med).padStart(6)} | ≥3:1 ${s.ge3.toFixed(1)}%`);
  }
}

/* ── 诊断：④ 边带**族感知**（`REACH_FAMILIES=1` 才跑；**默认输出一字不改**）──────────────
 * 为什么非有不可：上面那张逐类表的人口 = `isInk(a)`（**暗像素**谓词）。
 *   `(ii)` 的**亮芯 `#fff3c8` 是亮极**、**不是暗像素** ⇒ 那张表**永远看不见它** ⇒
 *   拿它量 `(ii)` 就是**尺子量错对象**（`ff7db9c`「两套定义两个数」的同型病：
 *   验收工具量的是**旧修法**（单条墨），线上跑的是**新修法**（双色 halo））。
 * 做法：从 **dist** 解析四个族色，对每个变化像素，取"**该族色按自身 alpha 合成在 `before` 之上**"
 *   的**模型色**的最近者 ⇒ 归族（不透明族模型色 = 族色本身）。
 *   ⇒ 输出 **族 × 地形** 的 n 与 WCAG 中位（判据 = `max(glow, ink)`，见 `§4.6` 契约第 6 条：
 *     「两极其一 ≥3:1」，**不得**用混合 population 的中位 —— 红/水洗两族中位恒 ~1.1，
 *     会把任何做对的 halo **按构造判死**）。
 * ⚠️ 残差中位会打印：残差大 ⇒ 该格被**多层叠加**（模型色对不上单层）⇒ 别硬信归族。
 * 负测法：`REACH_FAMILIES=1 node tools/reachmeas.mjs <after> <before> 标签 <正午底图>`；
 *   想验证"尺子确实瞎"：拿一对 **before 无选择态** 的图 ⇒ 应报 `fill` 占比 ≈100%、`glow/ink` ≈0。
 */
if (process.env.REACH_FAMILIES) {
  const distUrl = process.env.REACH_DIST || new URL('../dist/render/MapRenderer.js', import.meta.url);
  let dtext = '';
  try { dtext = readFileSync(distUrl, 'utf8'); }
  catch { console.log('\n  ⚠️ 族诊断：读不到 dist/render/MapRenderer.js ⇒ 跳过（**不是"没有该族"**）'); }
  const grabConst = (nm) => { const m = new RegExp(`const\\s+${nm}\\s*=\\s*'([^']+)'`).exec(dtext); return m ? m[1] : null; };
  const parseColor = (s) => {
    if (!s) return null;
    let m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) { const v = Number.parseInt(m[1], 16); return { c: [(v >> 16) & 255, (v >> 8) & 255, v & 255], a: 1 }; }
    m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/i.exec(s);
    if (!m) return null;
    return { c: [Number(m[1]), Number(m[2]), Number(m[3])], a: m[4] === undefined ? 1 : Number(m[4]) };
  };
  const FAM = [['fill', 'REACH_TINT'], ['edge', 'NOGO_EDGE'], ['glow', 'NOGO_EDGE_GLOW'], ['ink', 'NOGO_EDGE_INK']]
    .map(([k, nm]) => { const raw = grabConst(nm); const v = parseColor(raw); return v ? { k, nm, raw, ...v } : null; })
    .filter(Boolean);
  if (dtext && !FAM.length) console.log('\n  ⚠️ 族诊断：dist 里一个族色都没解析出 ⇒ 跳过（**别读成"没有该族"**）');
  if (FAM.length) {
    const byFam = new Map(FAM.map((f) => [f.k, { n: 0, res: [], cls: new Map(), clsR: new Map() }]));
    let tot = 0;
    for (const r of rows) {
      tot++;
      let best = FAM[0], bestD = Infinity;
      for (const f of FAM) {
        const e0 = Math.round(f.a * f.c[0] + (1 - f.a) * r.b[0]);
        const e1 = Math.round(f.a * f.c[1] + (1 - f.a) * r.b[1]);
        const e2 = Math.round(f.a * f.c[2] + (1 - f.a) * r.b[2]);
        const d = (e0 - r.a[0]) ** 2 + (e1 - r.a[1]) ** 2 + (e2 - r.a[2]) ** 2;
        if (d < bestD) { bestD = d; best = f; }
      }
      const g = byFam.get(best.k); g.n++; g.res.push(Math.sqrt(bestD));
      const kk = classOf(r.i, r);
      g.cls.set(kk, (g.cls.get(kk) || 0) + 1);
      if (!g.clsR.has(kk)) g.clsR.set(kk, []);
      g.clsR.get(kk).push(ratio(r.a, r.b));
    }
    console.log(`\n  ── 族诊断（REACH_FAMILIES=1）：变化像素**归族**（模型色 = 族色按 alpha 合成在 before 之上）`);
    console.log(`     族   | 常量            | 族色                  |     n    |  占比  | 残差中位`);
    const share = new Map();
    for (const f of FAM) {
      const g = byFam.get(f.k);
      const rs = g.res.slice().sort((x, y) => x - y);
      share.set(f.k, tot ? (100 * g.n) / tot : 0);
      console.log(
        `     ${f.k.padEnd(5)} | ${f.nm.padEnd(15)} | ${String(f.raw).padEnd(21)} | ${String(g.n).padStart(8)} | ` +
          `${(tot ? (100 * g.n) / tot : 0).toFixed(1).padStart(5)}% | ${f2(pctl(rs, 0.5)).padStart(8)}`,
      );
    }
    console.log(`     ── 族 × 地形（WCAG 中位；该类取 **max(glow, ink)** 判「两极其一 ≥3:1」）`);
    const clsAll = [...new Set(FAM.flatMap((f) => [...byFam.get(f.k).cls.keys()]))];
    const seen = [...new Set([...ORDER, ...clsAll])];
    console.log(`       地形              |${FAM.map((f) => f.k.padStart(9)).join('|')}|  max(glow,ink)`);
    for (const k of seen) {
      const cells = FAM.map((f) => byFam.get(f.k).clsR.get(k) ?? []);
      if (!cells.some((c) => c.length)) continue;
      const meds = cells.map((c) => (c.length ? pctl(c.slice().sort((x, y) => x - y), 0.5) : NaN));
      const gi = [FAM.findIndex((f) => f.k === 'glow'), FAM.findIndex((f) => f.k === 'ink')].filter((j) => j >= 0);
      const best = gi.map((j) => meds[j]).filter((v) => Number.isFinite(v));
      const ns = cells.map((c) => String(c.length).padStart(9));
      console.log(
        `       ${k.padEnd(16)} |${ns.join('|')}|  ${best.length ? f2(Math.max(...best)) : '—'}` +
          `${best.length && Math.max(...best) < 3 ? '  ❌' : best.length ? '  ✅' : ''}`,
      );
    }
    console.log(`       （n 在各自族列里；**n<${MIN_N} 的族**不得据此判过）；族占比最大者 = 该对实际在量什么`);
    const resTop = Math.max(...FAM.map((f) => {
      const rs = byFam.get(f.k).res.slice().sort((x, y) => x - y);
      return rs.length ? pctl(rs, 0.5) : 0;
    }));
    if (resTop > 40) {
      console.log(`     ⚠️ **残差中位 ${f2(resTop)} 偏大 ⇒ 归族不可尽信**：变化像素多为**多层叠加**（模型色是对"单层"算的）`);
      console.log(`        ⇒ 本列只用来回答「**这对到底在量哪一族**」，**不要**当逐族验收数用。`);
    }
    /* 判"这对能不能当 ④ 的 A/B 验收数"：④ 边带画在**不可走格**内、水洗只覆盖**可走格**
     * ⇒ **只要水洗也变了**，population 就被"水洗 vs 无水洗"灌满 ⇒ 量的不是「边 vs 其底」。
     * ⇒ 判据 = `fill` 占比必须**可忽略**（≤5%）。 */
    const fillShare = share.get('fill') ?? 0;
    if (fillShare > 5) {
      console.log(`     ⛔ **这对不能当 ④ 的 A/B 验收数**：fill（水洗）占 ${fillShare.toFixed(1)}% ⇒ 它混进了「水洗 vs 无水洗」。`);
      console.log(`        「边 vs 其底」要求 **选择态恒定、只差边带**（水洗覆盖**可走格**、④ 边带画在**不可走格**内）`);
      console.log(`        ⇒ 典型错法 = before 用"**没选择英雄**"（此时整条可达区都没水洗）⇒ 逐类表读的是水洗。`);
    }
  }
}
