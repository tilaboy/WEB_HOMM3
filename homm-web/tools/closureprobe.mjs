/**
 * closureprobe.mjs —— 可达染色的「轮廓闭合性」探针（**旁证尺，非验收数**）。
 *
 * 作者：`art-director`。原为一次性诊断脚本（曾只存在于 `/tmp`），`#155` 要用它做
 * 「修前 / 修后」对比 ⇒ 按 `368f68f` 规矩（**状态必须用可复现的定义表达**）
 * **入库**：`/tmp` 会被清空，留在那里的脚本等于不可复现。
 *
 * 用法：
 *   node tools/closureprobe.mjs <after.png> <before.png>
 *     after  = **染色开**；before = **染色关（`&devtint=0`）**
 *     ⚠️ 两张必须是**同场景 / 同相机 / 同帧 / 同一构建**下抓的（只差染色层）。
 *
 *   `WCAG=1 node tools/closureprobe.mjs <after.png> <before.png>`
 *     ⇒ 追加「缺口段 带-vs-雾」的**实测** WCAG 分布（每类：n / 中位 / 最小 / 最大）+ 判定
 *       （判据 = 该段至少有一条带 ≥3:1，team-lead ⑤）。**量实际像素色**（非标称色）。
 *     ⛔ **人口警告（2026-09-21 实测更正）**：本模式的人口 = **紧贴雾的那一条带像素**（4 邻接）
 *       ⇒ 而 `#155` 的带栈「红 → 亮芯 → **墨**」里**贴雾的恒是最外层的「墨」**
 *       ⇒ **本模式只能报 `ink`、看不到亮芯** ⇒ **它答不出⑤那条判据**（会把 13.7:1 的亮芯读成"无一条带 ≥3:1" ⇒ **假阴性**）。
 *       **答判据请用 `STACK=1`**；本模式保留（它回答的是另一个问题："紧贴雾那条带对比度多少"）。
 *
 *   `STACK=1 [STACK_PX=48] node tools/closureprobe.mjs <after.png> <before.png>`
 *     ⇒ 追加「缺口段**带栈**」逐族实测 WCAG（n / 中位 / 最小 / 最大 + 实际色）——
 *       **人口 = 整条带栈** = ⑤ 判据真正要的"该段"。默认关闭，不加则输出**逐字不变**。
 *
 * 问题（team-lead 裁定 ②）：方向信息由「闭包轮廓」承载 ⇒ 渲染上轮廓必须闭合。
 * 代码已知：`inRegion()` 对**未揭开**格返回 false，且主绘制循环对未揭开格 `continue`
 * ⇒ 可达区贴着**未探索区**的那一段**不描线**。本探针用像素回答"该缺口是否存在"。
 *
 * 口径：
 *   · changed = 通道差 max|Δ| > 4（与 `reachmeas.mjs` 同款）。
 *   · fog（未探索 / 图外）= after 里颜色 ≈ `#0b0d10`（未探索遮盖与画布底色**同色**）。
 *   · 缺口 = 「**变化的**（= 被染色层碰过）像素」与「fog 像素」**4 邻接**的那些边。
 *     若轮廓闭合，可达区贴雾处也应有带 ⇒ 该处 fog 邻接的应是**带**像素，而不是**填充(wash)**。
 *   · 归族：模型色 = 族色按 alpha 合成在 before 之上；取最近者（族定义与 §4.6 的四带一致）。
 *
 * ⛔ **本尺的边界（引用时必须一起写）**：
 *   · 只证「**缺口存在 / 被补上**」，**不证「缺口占轮廓多少」** —— `fog` 含**图外底色**、
 *     与未探索遮盖**同色 `#0b0d10`**，两者在像素上分不开。
 *   · 它是**旁证尺**，**不是 `§4.6` 的 `(ii)` 验收数**（验收数走 `tintab` 逐类×逐带）。
 *   · ⚠️ **本尺自己不冻帧**：`changed` 会把**动画像素**（水波 / 选中脉冲）算进去（= `#138` 那个病）。
 *     ⇒ **输入必须已冻帧（抓图侧 `SHOT_FREEZE=1`）且"同帧"**；否则结论无意义。**本尺不给"是否冻帧"的断言。**
 *
 * `#155`（修「轮廓在雾侧不闭合」）的取证口径 —— **★ 按 `engineering-lead` 最终确认的版本（`34d1208` 落库后修订）**：
 *   · ⚠️ **本段取代 `dfa7a1e` 里的旧版**（旧版把 (a) 写成「**带旗标 修前 vs 修后**」= 事实上的**跨构建**对照）。
 *     旧版**仍是"两个量分开报"的思路**、没有错，但 `eng-lead` 落库后把 (a) 收紧为「**同构建内**」、
 *     并明确 (b) 用 `HEAD worktree` 即可、**不必重建旧构建** ⇒ **以下为准；旧文字见 `git show dfa7a1e`（不静默替换，留痕可查）**。
 *   · **两个量分开报、各有各的对照，别混**：
 *     **(a) 同构建内：默认路径 vs `&devfogclose=1`** = **修法效果**
 *         （期望：`fogTouchFill` **下降**、`fogTouchBand` **上升**）；
 *     **(b) HEAD worktree vs 本版，且两侧都不带旗标** = **默认 0 像素差** = **"门票"证据（默认 no-op）**
 *         —— **`-2` 已证 `0 / 2 280 960` 像素、`maxd 0`；`eng-lead` 亦自证同形 ⇒ 不必再重建旧构建**。
 *   · ⚠️ **★ 必须带 `&devfogclose=1` 才能看到修法**（default-off ⇒ 不带旗标两次都走默认路径 ⇒ 逐像素相同
 *     ⇒ 会得出「修了等于没修」的**假阴性**）。**不要**用「旧构建 vs 新构建」去顶替 (a)：**跨构建只比方向/判定**。
 *   · ⚠️ 与历史读数（我 2026-09-21 那次 `n=1 020`）挂钩时：**只比方向/判定**，并**明写「跨构建只比方向」**
 *     —— 那次绑的是**已被覆盖的 `dist`**（`13d3b4200709`），**不是**当前构建。
 *   · ⚠️ 开关名：**`?devfogclose=1`**（**不是** `?devclosure`；用错名 = 静默量到"默认 no-op"）。
 *     它**已于 `34d1208` 落库** ⇒ 现为**代码里的实体**，可正式引用。
 *   · ⚠️ **产物别放 `/tmp`**：`eng-lead` 的一次性 outDir 与工作树被外部清空过，我的 `/tmp` 也曾失守
 *     ⇒ A/B 图请落**仓内**（如 `homm-web/tools/probes/` 或 `design/art-bible/shots/`），否则"证据"会消失。
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
    const ft = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[o + x - ch] : 0;
      const b = y > 0 ? out[o - stride + x] : 0;
      const c = (x >= ch && y > 0) ? out[o - stride + x - ch] : 0;
      let v = line[x];
      if (ft === 1) v = (v + a) & 255;
      else if (ft === 2) v = (v + b) & 255;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      out[o + x] = v;
    }
  }
  return { width, height, ch, data: out };
}

const [afterP, beforeP] = process.argv.slice(2);
if (!afterP || !beforeP) {
  console.error('用法: node tools/closureprobe.mjs <after.png 染色开> <before.png 染色关>');
  console.error('说明: 两张须同场景/同相机/同帧/同构建，只差 &devtint=0；本尺为旁证尺，非 (ii) 验收数。');
  process.exit(2);
}
const A = decodePng(readFileSync(afterP));
const B = decodePng(readFileSync(beforeP));
if (A.width !== B.width || A.height !== B.height) throw new Error('尺寸不一致');
const { width: W, height: H } = A;
const px = (im, i) => [im.data[i], im.data[i + 1], im.data[i + 2]];

const FAM = [
  ['fill', 120, 200, 255, 0.16],
  ['edge', 255, 96, 80, 0.42],
  ['glow', 255, 243, 200, 1],
  ['ink', 42, 26, 18, 1],
];

const changed = new Uint8Array(W * H);
const fam = new Uint8Array(W * H); // 0=未变 1..4=FAM idx+1
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * A.ch;
  const a = px(A, i), b = px(B, i);
  const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  if (d <= 4) continue;
  changed[y * W + x] = 1;
  let best = -1, bd = Infinity;
  for (let k = 0; k < FAM.length; k++) {
    const [, cr, cg, cb, al] = FAM[k];
    const e0 = al * cr + (1 - al) * b[0], e1 = al * cg + (1 - al) * b[1], e2 = al * cb + (1 - al) * b[2];
    const dd = (e0 - a[0]) ** 2 + (e1 - a[1]) ** 2 + (e2 - a[2]) ** 2;
    if (dd < bd) { bd = dd; best = k; }
  }
  fam[y * W + x] = best + 1;
}

const isFog = (x, y) => {
  const i = (y * W + x) * A.ch;
  const a = px(A, i);
  return Math.abs(a[0] - 11) <= 2 && Math.abs(a[1] - 13) <= 2 && Math.abs(a[2] - 16) <= 2;
};

let fogTotal = 0, fogTouchChanged = 0, fogTouchFill = 0, fogTouchBand = 0;
const fogTouchKind = { fill: 0, edge: 0, glow: 0, ink: 0 };
// ★ 可选：缺口段「带-vs-雾」的实测 WCAG（`WCAG=1` 开）—— 回答 team-lead ⑤
//   「闭合的判据 = 该段至少有一条带 ≥3:1」。**量的是实际像素色**（不是标称色），
//   因为 `vignette` / 档位会改变实际色（见 roadmap `#155` 那条纪律：按标称色计数必须写档位 + 容差）。
const bandVsFog = { fill: [], edge: [], glow: [], ink: [] };
const fogCol = { fill: [], edge: [], glow: [], ink: [] };
const relLum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const wcag = (c1, c2) => {
  const a = relLum(c1), b = relLum(c2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const median = (arr) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const gaps = []; // 例子坐标
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  if (!isFog(x, y)) continue;
  fogTotal++;
  let touched = false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (!changed[ny * W + nx]) continue;
    touched = true;
    const k = FAM[fam[ny * W + nx] - 1][0];
    fogTouchKind[k]++;
    if (process.env.WCAG) {
      bandVsFog[k].push(wcag(px(A, (ny * W + nx) * A.ch), px(A, (y * W + x) * A.ch)));
      fogCol[k].push(px(A, (y * W + x) * A.ch));
    }
    if (k === 'fill') { if (gaps.length < 12) gaps.push([nx, ny]); }
  }
  if (touched) {
    fogTouchChanged++;
    let hasFill = false, hasBand = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!changed[ny * W + nx]) continue;
      const k = FAM[fam[ny * W + nx] - 1][0];
      if (k === 'fill') hasFill = true; else hasBand = true;
    }
    if (hasFill) fogTouchFill++;
    if (hasBand) fogTouchBand++;
  }
}

console.log(`尺寸 ${W}x${H}   变化像素 n=${changed.reduce((s, v) => s + v, 0)}`);
console.log(`fog(#0b0d10±2) 像素 n=${fogTotal}`);
console.log(`  · fog 4 邻接"变化像素"的像素 n=${fogTouchChanged}（该处染色层碰到了雾边界）`);
console.log(`     其中邻接 **fill(水洗)** 的 n=${fogTouchFill}  **（像素计数）**   ← ★ 若轮廓闭合，此处应 ≈0（应为"带"）`);
console.log(`     其中邻接 **任意带(edge/glow/ink)** 的 n=${fogTouchBand}  **（像素计数）**`);
console.log(`  · ⚠️ 下面这张表的单位不同（**"边"计数：一条边算一次，不是像素**）—— 别与上面两行并列成"同一个量两个数"：`);
for (const k of ['fill', 'edge', 'glow', 'ink']) console.log(`     ${k.padEnd(5)} ${fogTouchKind[k]}`);
console.log(`  · 水洗贴雾的例子（前 12 个像素坐标）：${gaps.map(g => `(${g[0]},${g[1]})`).join(' ')}`);
if (process.env.WCAG) {
  console.log('  · ★ 缺口段「带-vs-雾」实测 WCAG（`WCAG=1`）—— 判据 = 该段至少有一条带 ≥3:1（team-lead ⑤）');
  console.log('     ★ 单位提醒：下面是「每一条"带像素↔相邻雾像素"边」的比值分布，**不是**逐类中位、**不是** (ii) 验收数。');
  for (const k of ['fill', 'edge', 'glow', 'ink']) {
    const v = bandVsFog[k];
    if (!v.length) { console.log(`     ${k.padEnd(5)} n=0（该段无此类带）`); continue; }
    console.log(`     ${k.padEnd(5)} n=${String(v.length).padEnd(5)} 中位 ${median(v).toFixed(2)}  最小 ${Math.min(...v).toFixed(2)}  最大 ${Math.max(...v).toFixed(2)}  相邻雾色(首) ${hex(fogCol[k][0])}`);
  }
  const pass = ['fill', 'edge', 'glow', 'ink'].filter((k) => bandVsFog[k].length && median(bandVsFog[k]) >= 3);
  console.log(`     ⇒ 该段可用带（中位 ≥3:1）= ${pass.length ? pass.join('/') : '（无）'}  ${pass.length ? '✅ 该段闭合可读' : '❌ 该段不闭合可读（无一条带达 3:1）'}`);
  console.log('     ⚠️⚠️ **本表的人口 =「紧贴雾的那一条带像素」（4 邻接）** ⇒ 它**只能**看到**最外层**那一条；');
  console.log('        而外侧恒为「墨」⇒ **本表天然答不出"该段至少有一条带 ≥3:1"**（判据要的是「该段」的**全部带**）。');
  console.log('        要答那条判据 **必须用 `STACK=1`**（见下）；把本表的 `ink` 中位当判据 = **人口错**。');
}
// ★ `STACK=1`：把「缺口段的**带栈**」整段量出来 —— 回答 team-lead ⑤ 的那条判据本身。
//   为什么要有它（2026-09-21 · `art-director` · 修 `WCAG=1` 的人口缺陷）：
//   `WCAG=1` 只量「雾 ↔ 紧贴雾的那个变化像素」⇒ 人口 = **最外层一条带**。而 `#155` 的带栈
//   从可达区向外是 **红(0) → 亮芯(EDGE_W) → 墨(2*EDGE_W)**（见尺子头注的栈序）⇒ **贴雾的恒是「墨」**，
//   于是 `WCAG=1` 只可能报 `ink`，**看不到亮芯** ⇒ 会得出「该段不闭合可读」的**假阴性**。
//   本模式改人口 = **从每个雾界像素沿"离开雾"的方向，把整条 `changed` 栈走一遍**，按族汇总
//   ⇒ 每族各给 n / 中位 / 最小 / 最大（对比参照 = 该雾像素的实际色）。**默认关闭、默认输出逐字不变。**
if (process.env.STACK) {
  const UPTO = Number(process.env.STACK_PX ?? 48); // 走到这么远就停（dpr3 下一条带 ≈12px、三条 ≈36px）
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const walked = new Uint8Array(W * H);
  const stackVsFog = { fill: [], edge: [], glow: [], ink: [] };
  const stackCol = { fill: [], edge: [], glow: [], ink: [] };
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!isFog(x, y)) continue;
    const fc = px(A, (y * W + x) * A.ch);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!changed[ny * W + nx] || walked[ny * W + nx]) continue;
      walked[ny * W + nx] = 1;
      for (let k = 0; k <= UPTO; k++) {
        const qx = nx + k * dx, qy = ny + k * dy;
        if (qx < 0 || qy < 0 || qx >= W || qy >= H) break;
        const q = qy * W + qx;
        if (!changed[q]) break; // 走出染色层（回到裸地形）即止
        const c = px(A, q * A.ch);
        const kk = FAM[fam[q] - 1][0];
        stackVsFog[kk].push(wcag(c, fc));
        if (stackCol[kk].length < 400) stackCol[kk].push(c);
      }
    }
  }
  console.log(`  · ★ 缺口段「带栈」逐族实测 WCAG（\`STACK=1\`；走了 ${UPTO}px / 与雾界像素数 = ${fogTouchChanged}）—— 判据 = 该段至少有一条带 ≥3:1（team-lead ⑤）`);
  console.log('     ⚠️ 人口 = **整条带栈**（= 判据要的"该段"），不是"紧贴雾那一条"。计数是"像素×边界"访问数，比例意义有限，**看中位**。');
  console.log('     ⚠️ `fill` 一列**不参与判定**：往外走会走进可达区，那列里混着**可达区地形**（实测 `#b0ad93` 亮沙）');
  console.log('        ⇒ 正是契约里「被『被染格恰好是亮地形』污染」那个坑。**本段新增的带 = edge/glow/ink 三条。**');
  const ok = [];
  for (const k of ['fill', 'edge', 'glow', 'ink']) {
    const v = stackVsFog[k];
    if (!v.length) { console.log(`     ${k.padEnd(5)} n=0`); continue; }
    const med = median(v);
    const cols = [...new Set(stackCol[k].map(hex))].slice(0, 4).join(' ');
    const usable = k !== 'fill'; // fill = 可达区水洗/地形混入 ⇒ 不作"带"
    console.log(`     ${k.padEnd(5)} n=${String(v.length).padEnd(6)} 中位 ${med.toFixed(2)}  最小 ${Math.min(...v).toFixed(2)}  最大 ${Math.max(...v).toFixed(2)}  实际色 ${cols}  ${usable ? (med >= 3 ? '✅' : '❌') : '（不参与判定）'}`);
    if (usable && med >= 3) ok.push(k);
  }
  console.log(`     ⇒ 该段可用带（edge/glow/ink 中位 ≥3:1）= ${ok.length ? ok.join('/') : '（无）'}  ${ok.length ? '✅ 该段闭合可读' : '❌ 该段不闭合可读（无一条带达 3:1）'}`);
}
console.log('⚠️ 边界：只证「缺口存在 / 被补上」，不证「缺口占轮廓多少」（fog 含图外底色、同色不可分）；本尺为旁证，非 (ii) 验收数。');
