#!/usr/bin/env node
/**
 * tintab.mjs —— ④ 可达染色「净贡献（差分）」对照台　(owner: engineering-lead-2)
 *
 * ★ 落库已完：修复稿已提交（`6867cff` / `bf92be4` / `5c0e757`）⇒ 不再是「暂存 /tmp 待 cp」的状态。
 *   改本文件后必须 `node --check tools/tintab.mjs`，再 `git commit -- tools/tintab.mjs`（显式 pathspec）。
 *
 * ★ 冻结（2026-09-21，team-lead 裁定，已写进 `production/roadmap.md`）：**本文件只有 `engineering-lead-2` 可写**；
 *   其它实例一律**只读**，**有增补交给 owner 并入**（内容不回退、只收口 —— 那些增补有价值，别丢）。
 *
 * ## 分工（2026-09-21 team-lead 裁定，遵「同值多址」）
 *   空间口径：
 *     **验收数（唯一出处）** → `tools/reachmeas.mjs`（A/B「状态 vs 其底」；§4.6 权威：午 2.93 / 夜 2.08）
 *     ⚠️ `imagecmp.mjs` 的 env `CMP_EDGE` 已按 team-lead 裁定**撤除**（`ddd9eea`，留墓碑不静默删）——
 *        它量的是该色在**整图**上的全部出现（物件描边也是 ink0）、**非只量 ④ 格缘** ⇒ 当不了验收数 ⇒ 撤代码。
 *        （**别把它读成"旁证缺失"**：撤的是一件不能当验收数的东西，不是"少了一个交付"。）
 *     ⚠️ 旗标形 `--edge` 从未存在（这条原先是对的，保留）
 *   差分口径 + population + ΔE*ab + 色盲 ⇒ 本文件；**WCAG 列（中位/均值两列）均为"参考"**，验收数不看它。
 *
 * ## ★ 同格两数纪律（2026-09-21 team-lead 裁 · 本会话最该沉淀的一条）
 * **同一个格子出现两个数时 —— 不许删掉其中一个，也不许并排留白**；必须同时给出：
 *   ① **各自标注它的统计量**（如 `WCAG均值(参考)` / `WCAG中位`）；
 *   ② **指明哪一个才是判据**（本 ④ 的判据 = **中位**，出处 `tools/reachmeas.mjs`）；
 *   ③ 说明**哪些结论建在哪个量上**（例：本文件的「两极其一 ≥3:1」互补性结论建在 **`ΔL*` 中位**上，
 *      与 WCAG 的均值/中位之争无涉）。
 * 理由：本会话反复出事的形状 = **「并列的两个数被默认为同源」** / **「同一个量出现两个数」**。
 *   **长期解不是"只留一个数"（那会丢信息），而是"让每个数自带身份"。**
 * ⚠️ **可检验的判读**：**`中位 > 均值`** 是"两数不矛盾"的一条**方向性证据**（右偏分布下成立）——
 *   用它**证**"两数只是口径/统计量不同"，而不是靠嘴说"它们口径不同"。
 *   实例：`水` 亮芯 WCAG **均值 4.58 / 4.42 / 3.37**（本文件，`#138` 前）vs **中位 4.71 / 4.79 / 3.64**（`#138` 后）
 *   ⇒ 中位 > 均值 ⇒ **同批像素、两个统计量**，非数据漂移。
 *
 * ## 族（从 **dist** 解析，不写死）
 * `REACH_*` → `fill`；`*INK*` → `ink`；`*GLOW*` → `glow`；其余 `NOGO_*` / `*EDGE*` → `edge`。
 * ⚠️ `glow` 是 2026-09-21 为 `(ii)`「双色 halo（亮芯 + 暗边）」新拆的族：**亮芯必须与红/墨分开量**，
 *  否则"两极其一 ≥3:1"就被并成一个桶 ⇒ 又犯"均值掩盖"。该族名匹配 `/GLOW/i`（现网常量 `NOGO_EDGE_GLOW`）。
 * 颜色支持 rgba(...) 与 #hex。两条踩过的坑：
 *   (a) 只认 rgba 的正则会静默漏掉 #hex 的墨；
 *   (b) Chrome fillStyle getter 对不透明色回报 #hex（不是 rgb(...)）⇒ 比对前必须归一，
 *       否则该族命中恒为 0 —— 静默空值 = 假绿。故对 0 命中的族硬告警 + 非零退出。
 *
 * ## src≠dist 守卫（新规则②b）：启动即逐常量比对 src vs dist，不一致 exit 2、不跑。
 * ## 自证未被并发改动（新规则③）：量测前后各记 src/dist 的 sha1+mtime，跑完再核；不一致 exit 3。
 *
 * ## population 必填（--pop=list 看选项）。覆盖判据按通道差 —— 不得用 |ΔL*| 阈值筛人口。
 *
 * ## 视口 / DPR（2026-09-21 加，应 `art-director` 请 —— 供「通道独立腿」跑真机视口）
 * `--vw`（默认 1280）/ `--vh`（默认 757）/ `--dpr`（默认 1），或便捷形 `--viewport=792x320@3`。
 * `setDeviceMetricsOverride` 用它三个。**地图区**（避开顶/底栏）用 CSS 常量 `--maptop`（默认 42）/
 *   `--mapbottom`（默认 37），**按 DPR 放大** —— ⚠️ 旧代码写死 `42..min(720,H)`，**只在 dpr1 对**；
 *   直接 dpr3 会把顶栏算进地形（= 人口污染）。头部打印实际 `device y` 区间，可核。
 * ⚠️ **画布分辨率 ≠ 截图分辨率**：画布 dpr = `min(devicePixelRatio, quality.dprCap)`（档位 clamps：
 *   low1.5/mid2/high3）。`--dpr=3` 只让**截图** ×3；画布若被档位钳到 2 就会被**上采样**进截图（实测
 *   mid ⇒ canvas `1584x480 dpr2` 塞进 `2376x960` 截图）。要画布真正 ×3 用 **`--devdpr=3`**（透传既有
 *   `?devdpr`，只改 dprCap）。头部 `画布dpr` 行 + 每相位 `canvas ... dpr N` 会写明实际值。
 * ⚠️ 换视口 = **换 population**（像素集合不同）⇒ 与桌面跑的**逐格数不可直接比**，只比**方向/判定**；
 *   报告须写明视口 + dpr（与「指纹要写文件+算法+值」「population 必须写」同族）。
 * ⚠️ **非桌面视口（792×320@3）已解（2026-09-21，owner）**：曾见 `dark`(暗缝) 类的 `(a)并集/(b)全族`
 *   随帧序在 **1548 ↔ 32607** 互换。**根因 = 两个独立瞬态，都要治**：
 *     ① **首张 `captureScreenshot` 未 settle**（**非**曾疑的 `?devreveal` 雾未 settle —— 实测雾色 `#0b0d10`
 *        在 none/full/edge/ink **恒 = 90390 px**，雾是 settle 的）：同 mode 连抓三张 **#1≠#2/#3**、
 *        **#2==#3 逐位相同**，且与 mode 无关（谁先抓谁出格）⇒ **修法 = 录制前丢弃首帧**（G-15 同族）。
 *     ② **`#hint` 启动 toast**（DOM 覆盖层，约载入后 1.5s 出现在地图区下缘；见下「DOM 覆盖层门」）——
 *        **删首帧治不了它**（它比首帧晚，实测第 5 个捕获才出现）⇒ **修法 = 注入 `display:none` 隐藏**。
 *   ⇒ 两处落地后实测（792@3 · 0.22）：`dark` Σ=(a)=(b)=**1548**、缺口 0、缺源 0；`sand`/`water` 缺口恰 == 多源。
 *   ⇒ 该视口**可放行 `dark`**。判「雾是否 settle」请数**地图区内** `#0b0d10` 变没变（勿只靠推理）。
 *
 * ## ★ 瞬态抑制（2026-09-21，owner；与 `NOW_STUB` 冻结同族的第二类"非地形瞬态"）
 *   ② **启动 toast** `#hint`（`main.ts:604` `hint()`，文案 `main.ts:1121`）：**DOM 覆盖层**、约
 *      **载入后 1.5s** 出现于**地图区下缘**（792@3 实测 bbox device `412x93` = CSS `[328,233 137x31]`）、
 *      2s 淡出 ⇒ 落在测量窗内会**污染地图区**（曾把 `dark` `(a)并集` 抬高 **31059**）。
 *      **修法 = HOOK 注入 `#hint{display:none}`**（测量帧确定、可复现）；头部每相位打印
 *      「overlay门: #hint 注入隐藏 已生效（computed display:none）」（`getComputedStyle`）供核。
 *      ⚠️ 该 toast **与 canvas 渲染无关** —— 抑制它不改任何地图像素的绘制路径。
 *   ① 动画（水波/脉冲）由 `NOW_STUB` 冻结（见下）。
 *
 * ## 草亮度分层（2026-09-21 加，team-lead 裁 `ff7db9c`）
 * `grass` 曾是一个**不分层**的桶 —— 而 §15.4 的 (α) **失败格恰恰是「草·深」** ⇒ 并进 `grass`
 *   聚合会 **"均值掩盖死区"**（把仍不过的暗格洗成过）。故按 `L*` 切三桶，**阈值即本文件内的单一权威定义**：
 *     `grass-bright`：L* ≥ 55 ｜ `grass-mid`：40 ≤ L* < 55 ｜ `grass-dark`：22 ≤ L* < 40
 *   （`L* < 22` 已归 `dark`；切法**沿用 §15.4 (α) 基线表**，使新表与该基线**可比**。）
 *   ⚠️ 历史病根：基线那张 7 行表出自**未入库**的 `/tmp/alpha_bin.mjs`，其 `cls()` 与本文件
 *   **不是同一套** ⇒ 两套定义出两个数。**收口（2026-09-21，owner）**：
 *     ① 上层分档条件 `classify()` 已改为与 `reachmeas.band()` / `alpha_bin.cls()` **逐字同条件**；
 *     ② 草三分阈值 L*≥55 / ≥40 同上（`grass-bright` / `grass-mid` / `grass-dark`）。
 *   ⇒ 本文件与 ④ 的**验收数工具 `reachmeas.mjs` 同桶定义**（跨工具数才可比）。
 *   ✅ **帧 = 身份帧（(a)：正午 0.22 的 `none` 底图；2026-09-21 定 —— **相位帧已废**）**：
 *      **分类**只用正午底图（地形身份不随光照变），**测量**逐相位各自做。与 `reachmeas` 第 4 参（身份帧）、
 *      `/tmp/alpha_bin.mjs`（`cls(TN)`，`TN = A2_noon_none`）**同帧** ⇒ 两边同名桶是**同一批像素**、可拼表。
 *      ⚠️ 为何废相位帧：按**相位底**分类时，夜深底被压暗 ⇒ 桶整体下移 ⇒ **夜「草·亮」塌成 n≈5**
 *      ⇒ 该"类"夜里不存在 ⇒ **判据被"该类为空"真空通过**、失败被藏（art-director 实测：相位帧 n=5⇒5.43"过" vs 身份帧 n=727⇒2.92 ❌）。
 *   ⚠️ 旧表机制（`art-director` 实测）：**「正午」列 6 类逐格可复现**；**「夜」列错格**（其夜草三行整体错开一格）
 *      ⇒ 旧夜行疑出自**相位帧**版本 ⇒ 引旧表夜行会与身份帧读数不同，**别当同一数**。
 *   ⚠️ 引用纪律：本文件 WCAG **均值列**（`WCAG均值(参考)`）与 **中位列**（`WCAG中位`，`#138` 加）**同格两数并存**、
 *     `reachmeas` = **中位** ⇒ 同格多数不同 ≠ 矛盾，是口径 + 统计量都不同；引用须连统计量一起报。
 *   ★ `#138`（2026-09-21）加：**WCAG 中位列**（四统计量统一取中位以便 A/B 减差）+ 自证三件套升级
 *     （并记 `dist/main.js` 指纹 + 测量时 HEAD）—— 供「动画冻结 A/B 证明」用。
 *   ★ **`该类变化总数` 列 + 守恒断言**（team-lead 裁定三 `12d99d1`；owner 收口）：
 *     每行附**类总变化**，两个右端**并存**（同格两数纪律）：`(a)并集`（任一带触及）/ `(b)全族`（`full` vs `none`）。
 *     断言 `Σ(四带 n) ─ 右端`：**缺口 > 0 = 多源重叠的重复计数**（1px 交界 AA：`edge+glow`/`glow+ink`/`fill+edge`…），
 *     **不是漏归**；**真漏归看「缺源」列 = `full` 变但无任一单带变 ⇒ 应 ≈ 0**。
 *     实测（2026-09-21 · 三相位 · 冻结）：`(a)≈(b)`（差 ≤2）、**缺源 ≈ 0（water 仅 2，亚阈合成）** ⇒ **覆盖完整**；
 *     缺口 ≈ 多源数（如 sand `+719` vs 多源 `683`）⇒ **`Σ == 右端` 字面不成立是重叠所致，非缺陷**。
 *     ⚠️ 引用时用**右端（并集/全族）当"类的全量"**，`Σ(四带)` 是**带内视角**、含重复计数。
 *   ⚠️ 样本守卫：`n < 200` 打「样本不足」—— 桶塌成空时该格**不得据此判过**（与 `reachmeas` 的 `MIN_N` 同族）。
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { withHeadlessChrome, checkDevServer } from './_chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_REL = 'src/render/MapRenderer.ts';
const DIST_REL = 'dist/render/MapRenderer.js';
const MAIN_REL = 'dist/main.js'; // 自证三件套③：并记入口 bundle 指纹（防"量了 dist 但入口是旧档"）

/* ------------------------------------------------------------------ 参数 */

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
}

const POPS = ['uniform-grass', 'grass', 'grass-bright', 'grass-mid', 'grass-dark', 'all', 'sand', 'water', 'rock', 'dark'];
const popArg = arg('pop', '');
if (popArg === 'list' || !popArg) {
  console.error(`population 必填。可用：${POPS.join(' | ')}　（多个用逗号）\n例：node tools/tintab.mjs --pop=uniform-grass`);
  process.exit(popArg ? 0 : 2);
}
const requestedPops = popArg.split(',').map((s) => s.trim()).filter(Boolean);
for (const p of requestedPops) {
  if (!POPS.includes(p)) { console.error(`未知 population「${p}」。可用：${POPS.join(' | ')}`); process.exit(2); }
}
const PHASES = arg('phase', '0.22,0.68').split(',').map((s) => s.trim());
const SEED = arg('seed', '20260917');
const SIZE = arg('size', 'medium');
const PORT = Number(arg('port', '5173'));
const OUT = arg('out', '/tmp/tintab');
let VH = Number(arg('vh', '757'));   // Emulation 高（CSS px）；757 ⇒ 画布 1280x677
let VW = Number(arg('vw', '1280'));  // Emulation 宽（CSS px）
let DPR = Number(arg('dpr', '1'));   // deviceScaleFactor
/* 便捷形 `--viewport=792x320@3`（一次给 宽/高/dpr；覆盖 --vw/--vh/--dpr）—— art-director 的「通道独立腿」用真机视口。 */
{
  const vp = arg('viewport', '');
  if (vp) {
    const m = /^(\d+)x(\d+)@([\d.]+)$/.exec(vp.trim());
    if (!m) { console.error('--viewport 形如 792x320@3'); process.exit(2); }
    VW = Number(m[1]); VH = Number(m[2]); DPR = Number(m[3]);
  }
}
/* 地图区 = [顶栏下, 底栏上]（**CSS px 常量**；源码原为 dpr1 下的 42..720 ⇒ 换 dpr 时必须 ×DPR）。
 *   ⚠️ 原来是 `gy0=42, gy1=min(720,H)`，只在 dpr1 正确 —— 直接跑 dpr3 会把顶栏算进地形。
 *   `--maptop`/`--mapbottom`（CSS px）可覆盖。 */
const MAP_TOP_CSS = Number(arg('maptop', '42'));
const MAP_BOTTOM_CSS = Number(arg('mapbottom', '37'));
/* ⚠️ 画布 DPR 上限 = **画质档的 `dprCap`**（`quality.ts`：low1.5 / mid2 / high3），不是 deviceScaleFactor。
 *   ⇒ 光设 `--dpr=3` 只让**截图**变 3 倍，画布仍可能被档位钳到 2（实测：mid ⇒ canvas 1584x480 dpr2）。
 *   `--devdpr=<n>` 透传既有 `?devdpr`（只改 dprCap，隔离实验）⇒ 画布真正跑到 n 倍。 */
const DEVDPR = arg('devdpr', '');
const DEVDPR_Q = DEVDPR ? `&devdpr=${encodeURIComponent(DEVDPR)}` : '';

/* ---------------------------------------------------- 指纹 & 常量解析 */

const sha1 = (p) => { try { return createHash('sha1').update(readFileSync(path.join(ROOT, p))).digest('hex').slice(0, 12); } catch { return '(缺)'; } };
const mtime = (p) => { try { return statSync(path.join(ROOT, p)).mtime.toISOString(); } catch { return '(缺)'; } };
const readSrc = (p) => { try { return readFileSync(path.join(ROOT, p), 'utf8'); } catch { return null; } };
/* 自证三件套③：测量时 HEAD 是否为当前 HEAD（防"历史读数"—— eng-sprites 升级项）。 */
const headSha = () => { try { return execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().slice(0, 12); } catch { return '(未知)'; } };
const fp = (p) => ({ sha1: sha1(p), m: mtime(p) });

/** 浏览器 fillStyle getter 的规范形（去空格）：#2a1a12 ⇒ rgb(42,26,18)。 */
function canonical(color) {
  const c = color.trim();
  let m;
  if ((m = /^#([0-9a-f]{3})$/i.exec(c))) {
    const p = m[1].split('').map((h) => parseInt(h + h, 16));
    return `rgb(${p[0]},${p[1]},${p[2]})`;
  }
  if ((m = /^#([0-9a-f]{6})$/i.exec(c))) {
    const n = parseInt(m[1], 16);
    return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
  }
  if ((m = /^rgba?\(([\d.]+),([\d.]+),([\d.]+)(?:,([\d.]+))?\)$/i.exec(c.replace(/\s+/g, '')))) {
    const [, r, g, b, a] = m;
    const alpha = a === undefined ? 1 : Number(a);
    return alpha >= 1 ? `rgb(${Number(r)},${Number(g)},${Number(b)})` : `rgba(${Number(r)},${Number(g)},${Number(b)},${alpha})`;
  }
  return null;
}

function parseConsts(text) {
  const out = new Map();
  if (!text) return out;
  const re = /const\s+(\w+)\s*=\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(text))) {
    const [, name, val] = m;
    if (!/(REACH|NOGO|WALK|BLOCK)/i.test(name)) continue;
    if (!canonical(val)) continue;
    out.set(name, val);
  }
  return out;
}

const srcText = readSrc(SRC_REL);
const distText = readSrc(DIST_REL);
const SRC = parseConsts(srcText);
const DIST = parseConsts(distText);

/* -------------------------------------------------- src≠dist 守卫（新规则②b） */

if (!srcText || !distText) {
  console.error(`读不到 ${!srcText ? SRC_REL : DIST_REL} —— 没有 dist 就先 build；本脚本只量"运行的 dist"。`);
  process.exit(2);
}
const names = [...new Set([...SRC.keys(), ...DIST.keys()])];
const mismatches = names.filter((n) => SRC.get(n) !== DIST.get(n)).map((n) => ({ n, s: SRC.get(n), d: DIST.get(n) }));
if (mismatches.length) {
  console.error('X src != dist —— 量测会"静默量到不存在的效果"，拒绝运行。');
  for (const m of mismatches) console.error(`   ${m.n}: src=${m.s ?? '(无)'}  dist=${m.d ?? '(无)'}`);
  console.error(`   ${SRC_REL} @ ${mtime(SRC_REL)}  vs  ${DIST_REL} @ ${mtime(DIST_REL)}`);
  console.error('   => 先重建 dist（并确认没人在做负测），再跑。');
  process.exit(2);
}
if (!DIST.size) { console.error(`${DIST_REL} 里解析不到 REACH_*/NOGO_* 色值常量 —— 核对命名约定。`); process.exit(2); }

const BY_FAMILY = { fill: [], edge: [], glow: [], ink: [] };
for (const [n, raw] of DIST) {
  const fam = /REACH|WALK/i.test(n) ? 'fill' : /INK/i.test(n) ? 'ink' : /GLOW/i.test(n) ? 'glow' : 'edge';
  BY_FAMILY[fam].push({ name: n, raw, canon: canonical(raw) });
}
const FAMILIES = ['fill', 'edge', 'glow', 'ink'].filter((f) => BY_FAMILY[f].length);
const LABEL = { fill: '蓝fill  ', edge: '红(内侧)', glow: '亮芯(halo)', ink: '墨(外侧)' };
if (!FAMILIES.length) { console.error('本体化后没有可用族。'); process.exit(2); }

/* ------------------------------------------------------------------ 色彩数学 */

const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const Lp = (r, g, b) => { const Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y; };
const Yof = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const wcag = (y1, y2) => { const a = Math.max(y1, y2), b = Math.min(y1, y2); return (a + 0.05) / (b + 0.05); };
function lab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const dE = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
const DEUT = [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]];
const cl255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const deut = (r, g, b) => [
  cl255(DEUT[0][0] * r + DEUT[0][1] * g + DEUT[0][2] * b),
  cl255(DEUT[1][0] * r + DEUT[1][1] * g + DEUT[1][2] * b),
  cl255(DEUT[2][0] * r + DEUT[2][1] * g + DEUT[2][2] * b),
];
/* 地形分类 —— 与 `tools/reachmeas.mjs` 的 `band()`、`/tmp/alpha_bin.mjs` 的 `cls()` **逐字同条件**。
 * ⚠️ 这是 team-lead 裁的「两套定义出两个数」的另一半：原 `classify()` 用 `g-b>=15`/`r-b>=25` 等，
 *   与上述两者（`mx` 比较式）**不是同一套** ⇒ 桶成员不同 ⇒ 数不可比。此改后本文件 = reachmeas 同桶定义（跨工具一致）。 */
function classify(r, g, b) {
  const L = Lp(r, g, b);
  if (L < 22) return 'dark';
  const mx = Math.max(r, g, b);
  if (b === mx && b > r + 12) return 'water';
  if (r === mx && g >= b && r > 120) return 'sand';
  if (g >= r && g > b) return 'grass';
  return 'rock';
}
/* 草亮度分层 —— 单一权威定义（切法沿用 §15.4 (α) 基线表，使新表与基线可比） */
const GRASS_L_BRIGHT = 55, GRASS_L_MID = 40;
const GRASS_BIN = { 'grass-bright': 0, 'grass-mid': 1, 'grass-dark': 2 };
function grassBin(r, g, b) {
  if (classify(r, g, b) !== 'grass') return -1;
  const L = Lp(r, g, b);
  return L >= GRASS_L_BRIGHT ? 0 : L >= GRASS_L_MID ? 1 : 2;
}
const f2 = (v) => Number(v).toFixed(2);
const MIN_N = 200; // 样本不足门槛（与 reachmeas 一致）—— 防"桶塌成空"真空通过

/* ------------------------------------------------------------------ 抓图 */

// ★ 冻结"构建后动画"：`MapRenderer.draw()` 用 `performance.now()` 驱动
//    水波（`Math.sin((wx+wy*0.6)/13 - now/430)`，行 ~413）与选中脉冲（`Math.sin(now/pulseDiv)`，行 ~614）。
//    ⇒ **同一会话内**逐 mode 截图相隔数百 ms ⇒ 每次 `now` 前进 ⇒ 水波相位漂移
//    ⇒ "变化像素"里混入大量**水波**像素 —— 对**弱带 population**（water/dark）会淹没中位 = **污染**。
//    ⇒ 注入时把 `performance.now` 钉成常量，使动画相位确定。`NO_FREEZE=1` 可关（诊断动画本身用）。
//    **★ 实测证据（2026-09-21 · `--phase=0.22` · `diff(none,edge)`：本应只剩"红"）**：
//      · 未冻结 = **52576** 变化像素，其中**多出的 ~39k 全是 `blueish`（= 水波）**；
//      · 冻结   = **13305**（≈ 2px 边界像素量级 ⇒ 干净）。
//      · 跨 run（同 readiness）`none` vs `none` 仅 **42** 像素 ⇒ 水波相位 ≈ "载入后帧数"，
//        与同一会话内两次截图的**相隔时间**成正比 ⇒ 这才是本会话内 39k 的来由。
//      脚本：`/tmp/diff3.mjs`（一次性，按 terrain + blueish/reddish 分类）。
const FREEZE_ANIM = process.env.NO_FREEZE !== '1';
const NOW_STUB = FREEZE_ANIM
  ? `try{const F=function(){return 123456.789;};try{Object.defineProperty(Performance.prototype,'now',{value:F,configurable:true,writable:true});}catch(e){}try{performance.now=F;}catch(e){}}catch(e){}`
  : '';

const HOOK = `(() => {
  ${NOW_STUB}
  /* ★ 抑制启动 toast（#hint；main.ts:604 hint()，文案 main.ts:1121）——
   *   **DOM 覆盖层**（非 canvas 内容），约**载入后 1.5s** 出现于地图区**下缘**（实测 792@3：
   *   bbox device 412x93 = CSS[328,233 137x31]），2s 后淡出 ⇒ 若测量帧落在该窗内即**污染地图区读数**
   *   （实测曾把 dark 的 (a)并集 抬高 31059：ink-only 帧被 toast 盖住 ⇒ "该带在变"是假信号）。
   *   ⇒ 注入 CSS 隐藏，使测量帧确定 —— 与 NOW_STUB 冻结动画**同族**：都是"移除非地形瞬态"。
   *   ⚠️ 这是**唯一**被动的 DOM 瞬态；#objBanner（§14.2 教学目标）"载入即 3/3 不弹"、不在此窗内。 */
  try {
    const st = document.createElement('style');
    st.textContent = '#hint{display:none !important;}';
    const put = () => { try { (document.head || document.documentElement).appendChild(st); } catch (e) {} };
    put();
    document.addEventListener('DOMContentLoaded', put, { once: true });
  } catch (e) {}
  const FAMILIES = ${JSON.stringify(FAMILIES)};
  const COLORS = ${JSON.stringify(Object.fromEntries(FAMILIES.map((f) => [f, BY_FAMILY[f].map((t) => t.canon)])))};
  const norm = (s) => {
    const h6 = /^#([0-9a-f]{6})$/i.exec(s);
    if (h6) { const n = parseInt(h6[1], 16); return 'rgb(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ')'; }
    const h3 = /^#([0-9a-f]{3})$/i.exec(s);
    if (h3) { const p = h3[1].split('').map((x) => parseInt(x + x, 16)); return 'rgb(' + p[0] + ',' + p[1] + ',' + p[2] + ')'; }
    return s;
  };
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.fillRect;
  window.__tintSkip = {}; for (const f of FAMILIES) window.__tintSkip[f] = false;
  window.__tintHits = {}; for (const f of FAMILIES) window.__tintHits[f] = 0;
  proto.fillRect = function (...a) {
    const fs = norm((typeof this.fillStyle === 'string') ? this.fillStyle.replace(/\\s+/g, '') : '');
    let hit = null;
    for (const f of FAMILIES) if (COLORS[f].includes(fs)) { hit = f; break; }
    if (hit) { window.__tintHits[hit]++; if (window.__tintSkip[hit]) return; }
    return orig.apply(this, a);
  };
})();`;

/* ⚠️ 抓帧**顺序**（full 最先、none 次之、再各族）—— 自 **首帧丢弃**（见 `captureAll` 内「预热帧丢弃」）落地后
 *   已**不再敏感**：抓到的每张都是 settle 后的帧（实测同 mode 连抓 #2==#3 逐位相同）。
 *   历史（2026-09-21 前，未丢弃首帧时）：792@3 下 `dark` 的 `(a)并集/(b)全族` 会随"哪一帧最早/最晚"
 *   在 **1548 ↔ 32607** 间**互换** —— 根因 = **首张截图未 settle**（**非**曾疑的 `?devreveal` 雾未 settle：
 *   实测 `#0b0d10` 雾像素在 none/full/edge/ink **恒为 90390**，雾是 settle 的）。
 *   ⇒ 「真机视口独立腿」现可放行 `dark`；桌面视口本无此病（同差异未过阈）。 */
const MODES = { full: Object.fromEntries(FAMILIES.map((f) => [f, false])), none: Object.fromEntries(FAMILIES.map((f) => [f, true])) };
for (const f of FAMILIES) MODES[f] = Object.fromEntries(FAMILIES.map((g) => [g, g !== f]));

/* ★ DOM 覆盖层门（2026-09-21 owner · 解 792「dark 的 (b)全族」虚高）：
 *   `src/main.ts:604 hint()` 的底部 toast（元素 `#hint`；新局时 `main.ts:1121` 触发
 *   "〈玩家名〉的征程开始了"）载入后约 **1.5s 出现**（`classList:show` → `opacity:1`）、**2000ms+fade 后消失**。
 *   录制窗口若**跨过它** ⇒ 相邻两帧凭空差出**一整块 toast 区**（实测 bbox device [982,699..1393,791]
 *   = CSS 137×31）⇒ 被计成"变化" = 污染（曾把 792 `dark` 的 `(a)并集` 抬高 31059）。
 *   处置 = **注入侧隐藏**（HOOK 内注入 `#hint{display:none !important}`）—— 与 `NOW_STUB` 冻结动画**同族**：
 *   都是"移除非地形瞬态"。`#hint` 为 `position:absolute` + `pointer-events:none` ⇒ 隐藏**不改布局**、不动 canvas。
 *   ⚠️ 本门**不能**用"删首帧"代替（toast 比首帧晚，实测第 5 个捕获才出现）—— 与首帧丢弃是**两个独立机制**，都要。
 *   此处**只做可核验**：录制前核对注入的隐藏确实生效（`getComputedStyle(#hint).display === "none"`）。 */
const HINT_HIDDEN = '(()=>{const e=document.getElementById("hint");return e?getComputedStyle(e).display==="none":null})()';

async function captureAll() {
  return withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
    await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: DPR, mobile: false });
    const shots = {};
    for (const ph of PHASES) {
      const url = `http://127.0.0.1:${PORT}/?devquick=0&devsize=${SIZE}&devseed=${SEED}&devreveal=1&devprobe=1&devlight=${ph}${DEVDPR_Q}`;
      await send('Page.navigate', { url });
      for (let i = 0; i < 200; i++) {
        const ok = await evaluate('!!(window.__journey && window.__journey() && window.__journey().heroPos && document.querySelector("canvas") && window.__tintSkip)').catch(() => false);
        if (ok) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await evaluate('new Promise(r=>{let i=0;const s=()=>(++i>=30?r():requestAnimationFrame(s));requestAnimationFrame(s)})');
      /* ★ 覆盖层门**核验**：确认注入的 `#hint{display:none}` 生效（toast 不会在录制中占像素）。 */
      const hintHidden = await evaluate(HINT_HIDDEN).catch(() => null);
      /* ★ 预热帧丢弃（2026-09-21，解 792 `dark` 守恒右端互换 —— 见头注「首帧未就绪」）：
       *   `Page.captureScreenshot` 的**第一张**返回的是"尚未 settle"的合成帧。实测（792×320@3）：
       *   同一 mode 连抓三张，**#1 与 #2/#3 差 10w+ px，#2 == #3 逐位相同**；且与 mode 无关
       *   （none 先则 none#1 出格、full 先则 full#1 出格）。⇒ 首帧被当成数据 = 污染。
       *   修法 = **先抓一张丢弃**（与 G-15「预热帧丢弃 + 缓存版本门」同族），再开录。
       *   ⚠️ 桌面 1280 原亦隐有此病、只是同一差异未过 >4 阈（故此前 缺源≈0）；换视口才暴露。 */
      await send('Page.captureScreenshot', { format: 'png' });
      const meta = await evaluate('(()=>{const c=document.querySelector("canvas");const j=window.__journey();const h=document.getElementById("hint");return {canvas:{w:c.width,h:c.height},dpr:c.width/c.clientWidth,dprRaw:window.devicePixelRatio,hero:j.heroPos,hint:!!h,hintShown:!!(h&&h.classList&&h.classList.contains("show"))}})()');
      shots[ph] = { meta, hintHidden, modes: {} };
      for (const [mode, skip] of Object.entries(MODES)) {
        await evaluate(`window.__tintSkip = ${JSON.stringify(skip)}`);
        await evaluate('new Promise(r=>{let i=0;const s=()=>(++i>=3?r():requestAnimationFrame(s));requestAnimationFrame(s)})');
        const s = await send('Page.captureScreenshot', { format: 'png' });
        shots[ph].modes[mode] = Buffer.from(s.data, 'base64');
      }
      shots[ph].hits = await evaluate('window.__tintHits');
    }
    /* ★ 身份帧（identity）：分类只用「正午(0.22) none」底图，**不随相位变**。
     *   缘由（art-director 实测 + 我复现）：若按**相位底**分类，夜深时底被压暗 ⇒ 桶整体下移，
     *   夜「草·亮」塌成 n=5 ⇒ 该"类"在夜里不存在 ⇒ **判据被"该类为空"真空通过**，失败被藏。
     *   ⇒ 身份帧下同批像素恒定分类，跨相位可比、可拼表（与 `reachmeas` 第 4 参同帧）。 */
    const IDENTITY_PHASE = '0.22';
    if (shots[IDENTITY_PHASE]) {
      shots.identity = shots[IDENTITY_PHASE].modes.none;
    } else {
      const url = `http://127.0.0.1:${PORT}/?devquick=0&devsize=${SIZE}&devseed=${SEED}&devreveal=1&devprobe=1&devlight=${IDENTITY_PHASE}${DEVDPR_Q}`;
      await send('Page.navigate', { url });
      for (let i = 0; i < 200; i++) {
        const ok = await evaluate('!!(window.__journey && window.__journey() && window.__journey().heroPos && document.querySelector("canvas") && window.__tintSkip)').catch(() => false);
        if (ok) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await evaluate('new Promise(r=>{let i=0;const s=()=>(++i>=30?r():requestAnimationFrame(s));requestAnimationFrame(s)})');
      await send('Page.captureScreenshot', { format: 'png' });   // 预热帧丢弃（同上）
      await evaluate(`window.__tintSkip = ${JSON.stringify(MODES.none)}`);
      await evaluate('new Promise(r=>{let i=0;const s=()=>(++i>=3?r():requestAnimationFrame(s));requestAnimationFrame(s)})');
      const s = await send('Page.captureScreenshot', { format: 'png' });
      shots.identity = Buffer.from(s.data, 'base64');
    }
    return shots;
  }, { devServerPort: PORT, profilePrefix: 'tintab-' });
}

/* ------------------------------------------------------------------ 计算 */

async function raw(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: data, w: info.width, h: info.height, c: info.channels };
}

async function analyze(ph, shot, identityBuf) {
  const { meta, modes } = shot;
  const B = await raw(modes.none);        // 该相位「before」（测量用：画/不画之差）
  const I = await raw(identityBuf);       // 身份帧（分类用：恒正午底，不随相位变）
  const W = B.w, H = B.h, N = W * H, C4 = B.c;
  if (I.w !== W || I.h !== H) throw new Error(`身份帧 ${I.w}x${I.h} ≠ 相位帧 ${W}x${H} —— 分类与测量不在同一坐标系，拒绝出数。`);
  /* 地图区（device y）：顶栏下 .. 底栏上；CSS 常量 ×DPR。原 `42..min(720,H)` 仅 dpr1 对。 */
  const gy0 = Math.min(Math.round(MAP_TOP_CSS * DPR), H);
  const gy1 = Math.max(gy0, Math.min(H, Math.round((VH - MAP_BOTTOM_CSS) * DPR)));
  const cls = new Uint8Array(N);
  const gb = new Int8Array(N);
  const CODE = { dark: 0, water: 1, grass: 2, sand: 3, rock: 4 };
  for (let i = 0; i < N; i++) { const o = i * C4; cls[i] = CODE[classify(I.d[o], I.d[o + 1], I.d[o + 2])]; gb[i] = grassBin(I.d[o], I.d[o + 1], I.d[o + 2]); }
  const uniform = new Uint8Array(N);
  for (let y = gy0; y < gy1; y++) for (let x = 0; x < W; x++) {
    const c0 = cls[y * W + x]; let ok = 1;
    for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      if (cls[yy * W + xx] !== c0) { ok = 0; break; }
    }
    uniform[y * W + x] = ok;
  }
  const popMask = (which) => {
    if (which === 'all') return () => true;
    if (which === 'uniform-grass') return (i) => cls[i] === 2 && uniform[i];
    if (which in GRASS_BIN) { const bi = GRASS_BIN[which]; return (i) => gb[i] === bi; }
    const code = CODE[which]; return (i) => cls[i] === code;
  };
  /* ★ 该类变化总数（守恒断言右端 · team-lead 裁定三 `12d99d1`）—— **两个右端并存、各自标身份**
   *  （遵本文件头「同格两数纪律」）：`Σ(四带 n)` 要对上的"类总变化"有**两种定义**，一般不等：
   *   (a) `并集(任一染)` = 该类里**被任一染色带触及**的像素 = 四带变化集的**并集**。
   *   (b) `全族(full)`  = 该类里**四带一起画**（`MODES.full`）相对**不画**的变化总数。
   *   二者差异的来源：
   *     · **族重叠**：同一像素被 ≥2 带覆盖 ⇒ `Σ(四带 n)` **>** 并集（Σ 把重叠像素数了多遍）；
   *     · **合成效应**：单带各自都不过阈值、**合画才过** ⇒ `全族` **>** 并集。
   *   ⇒ 断言分别对 (a)/(b) 跑；不等即报缺口，并给**归属诊断**（多源 / 缺源）。
   *   （血案：`±3 墨核 15` vs `类全量 11094` —— "带的和"必须能对上"类的全量"。）
   *   ⚠️ **归属诊断只报数**（多出的落在哪 / 缺的是什么颜色），**不下结论**。 */
  const famImg = {};
  const famBit = new Uint16Array(N);   // 每位 = 一个族是否改变该像素（族数 ≤4 ⇒ ≤4 bit）
  const anyChg = new Uint8Array(N);    // (a) 并集(任一染)
  for (let fi = 0; fi < FAMILIES.length; fi++) {
    const fam = FAMILIES[fi], bit = 1 << fi;
    const img = await raw(modes[fam]);
    famImg[fam] = img;
    for (let y = gy0; y < gy1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, o = i * C4;
      if (Math.abs(img.d[o] - B.d[o]) > 4 || Math.abs(img.d[o + 1] - B.d[o + 1]) > 4 || Math.abs(img.d[o + 2] - B.d[o + 2]) > 4) { famBit[i] |= bit; anyChg[i] = 1; }
    }
  }
  /* (b) 全族变化：MODES.full（四带一起画）vs MODES.none（不画） */
  const fullImg = await raw(modes.full);
  const fullChg = new Uint8Array(N);
  for (let y = gy0; y < gy1; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * C4;
    if (Math.abs(fullImg.d[o] - B.d[o]) > 4 || Math.abs(fullImg.d[o + 1] - B.d[o + 1]) > 4 || Math.abs(fullImg.d[o + 2] - B.d[o + 2]) > 4) fullChg[i] = 1;
  }
  const bitCount = (v) => { let c = 0; while (v) { c += v & 1; v >>= 1; } return c; };
  const popTotal = new Map();   // (a) 并集
  const popFull = new Map();    // (b) 全族
  const popMulti = new Map();   // 被 ≥2 族同时改变（= "多"的来源：族重叠）
  const popZero = new Map();    // 全族变、但**无任一单族**变（= "缺"的来源：合成 or 窗口外）
  const zeroSamples = new Map();
  for (const pop of requestedPops) {
    const mask = popMask(pop);
    let uni = 0, full = 0, multi = 0, zero = 0; const zs = [];
    for (let y = gy0; y < gy1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!mask(i)) continue;
      if (anyChg[i]) uni++;
      if (fullChg[i]) full++;
      const pc = bitCount(famBit[i]);
      if (pc >= 2) multi++;
      if (fullChg[i] && pc === 0) {
        zero++;
        if (zs.length < 5) { const o = i * C4; zs.push(`(${x},${y}) none(${B.d[o]},${B.d[o + 1]},${B.d[o + 2]})→full(${fullImg.d[o]},${fullImg.d[o + 1]},${fullImg.d[o + 2]})`); }
      }
    }
    popTotal.set(pop, uni); popFull.set(pop, full); popMulti.set(pop, multi); popZero.set(pop, zero); zeroSamples.set(pop, zs);
  }
  const rowsOut = [];
  for (const fam of FAMILIES) {
    const withImg = famImg[fam];
    for (const pop of requestedPops) {
      const mask = popMask(pop);
      const Ls = [], Es = [], Cs = [], Ws = [];
      let n = 0, sw = 0;
      for (let y = gy0; y < gy1; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, o = i * C4;
        const r0 = B.d[o], g0 = B.d[o + 1], b0 = B.d[o + 2];
        const r1 = withImg.d[o], g1 = withImg.d[o + 1], b1 = withImg.d[o + 2];
        if (Math.abs(r1 - r0) <= 4 && Math.abs(g1 - g0) <= 4 && Math.abs(b1 - b0) <= 4) continue;
        if (!mask(i)) continue;
        Ls.push(Math.abs(Lp(r1, g1, b1) - Lp(r0, g0, b0)));
        Es.push(dE(lab(r1, g1, b1), lab(r0, g0, b0)));
        const [cr1, cg1, cb1] = deut(r1, g1, b1), [cr0, cg0, cb0] = deut(r0, g0, b0);
        Cs.push(Math.abs(Lp(cr1, cg1, cb1) - Lp(cr0, cg0, cb0)));
        const w = wcag(Yof(r1, g1, b1), Yof(r0, g0, b0));
        Ws.push(w); sw += w; n++;
      }
      const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[(a.length - 1) >> 1] : NaN);
      const pct = (a, t) => (a.length ? (100 * a.filter((v) => v < t).length) / a.length : NaN);
      /* ★ 加 WCAG 中位（Wc）：team-lead #138 要求四统计量**统一取中位**以做 A/B 减差；
       *   原 WCAG 列是**均值**（`wcag`），保留不动（统计量纪律：同格两数须连统计量一起报）。 */
      rowsOut.push({ fam, pop, n, L: med(Ls), E: med(Es), C: med(Cs), cvdBelow: pct(Cs, 2.22), wcag: n ? sw / n : NaN, Wc: med(Ws), totalU: popTotal.get(pop), totalF: popFull.get(pop) });
    }
  }
  return { meta, rowsOut, popTotal, popFull, popMulti, popZero, zeroSamples };
}

/* ------------------------------------------------------------------ 主流程 */

(async () => {
  const probe = await checkDevServer(PORT);
  if (!probe.ok) { console.error(probe.reason); process.exit(2); }

  const fpBefore = { src: fp(SRC_REL), dist: fp(DIST_REL), main: fp(MAIN_REL) };
  const headBefore = headSha();

  console.log('=== ④ 可达染色净贡献对照（tintab.mjs，差分口径） ===');
  console.log(`指纹前 : src ${fpBefore.src.sha1} @ ${fpBefore.src.m} | dist ${fpBefore.dist.sha1} @ ${fpBefore.dist.m} | main ${fpBefore.main.sha1} @ ${fpBefore.main.m}`);
  console.log('指纹算法: sha1 前 12 位（本文件）；team-lead 报的是 md5 前 8 位 —— 算法不同、非矛盾（shasum -a 1 <file> 可逐位复算）。引用请写「文件名 + 算法 + 值」。HEAD = git sha1 前 12；m = mtime(ISO)；main = dist/main.js 入口 bundle。');
  console.log(`HEAD   : ${headBefore}（测量前；跑完再核是否仍是当前 HEAD —— 防"历史读数"）`);
  console.log('src!=dist: 已核一致（不一致会 exit 2）');
  for (const f of FAMILIES) console.log(`族 ${LABEL[f]}: ${BY_FAMILY[f].map((t) => `${t.name}=${t.raw} => ${t.canon}`).join('  ')}`);
  console.log(`场景   : seed=${SEED} size=${SIZE} devreveal=1 视口 ${VW}x${VH}@dpr${DPR}(emulation) => 截图 ${VW * DPR}x${VH * DPR}(device)`);
  console.log(`画布dpr : ${DEVDPR ? `覆写 ?devdpr=${DEVDPR}（画布真正 ×${DEVDPR}）` : '⚠️ 未覆写 ⇒ 按画质档 dprCap（mid=2）—— 截图 ×dpr 但画布可能被档位钳小（见每相位头 canvas ... dpr N）'}`);
  console.log(`URL    : http://127.0.0.1:${PORT}/?devquick=0&devsize=${SIZE}&devseed=${SEED}&devreveal=1&devprobe=1&devlight=<相位>${DEVDPR_Q}`);
  console.log(`地图区 : device y [${Math.round(MAP_TOP_CSS * DPR)} .. ${Math.round((VH - MAP_BOTTOM_CSS) * DPR)}]（= CSS y [${MAP_TOP_CSS} .. ${VH - MAP_BOTTOM_CSS}] ×dpr${DPR}；顶/底栏各 ${MAP_TOP_CSS}/${MAP_BOTTOM_CSS} CSS px）—— 换 dpr 会随之缩放`);
  console.log(`相位   : ${PHASES.join(', ')}　（0.22=正午 0.5=黄昏 0.68=深夜）`);
  console.log(`population: ${requestedPops.join(', ')}`);
  console.log(`分类帧 : **身份帧 = 正午(0.22) none 底图**（不随相位变）—— 防"相位越暗、桶越塌 ⇒ 凭空通过"；与 reachmeas 第4参同帧`);
  console.log(`样本守卫: n < ${MIN_N} 标「样本不足」—— 该格不得据此判过（防"桶塌成空"真空通过）`);
  console.log(`草分层 : grass-bright L*>=${GRASS_L_BRIGHT} ｜ grass-mid ${GRASS_L_MID}<=L*<${GRASS_L_BRIGHT} ｜ grass-dark 22<=L*<${GRASS_L_MID}（tintab 内单一权威定义，与 §15.4 (α) 基线表同切法）`);
  console.log(`动画   : ${FREEZE_ANIM ? '已冻结 performance.now（水波/脉冲相位确定 —— 防动画像素污染"变化集"）' : '⚠️ 未冻结（NO_FREEZE=1）—— water/dark 等弱带 population 会被动画污染，勿引'}`);
  console.log("分桶定义: classify() = { L*<22→dark ; b=max且b>r+12→water ; r=max且g≥b且r>120→sand ; g≥r且g>b→grass ; 其余→rock }（与 reachmeas.band() 逐字同条件）");
  console.log(`          草三分 L*≥${GRASS_L_BRIGHT}/${GRASS_L_MID}–${GRASS_L_BRIGHT}/22–${GRASS_L_MID}；uniform-grass = 5×5 邻域 terrain 码一致；暗缝 = 「dark」桶（含物件/接缝，未再细分）`);
  console.log('口径   : 净贡献=同像素画/不画之差；覆盖判据=通道差；ΔE=CIE76；色盲=Machado deuteranopia(1.0)');
console.log('统计量 : ΔL*/ΔE*ab/色盲 取**中位**；WCAG 取**均值**（列头已标）—— 与 reachmeas.mjs 口径不同，引用时须连统计量一起报');
  console.log('');

  mkdirSync(OUT, { recursive: true });
  const shots = await captureAll();
  const fpAfter = { src: fp(SRC_REL), dist: fp(DIST_REL), main: fp(MAIN_REL) };
  const headAfter = headSha();
  const stable = fpBefore.src.sha1 === fpAfter.src.sha1 && fpBefore.dist.sha1 === fpAfter.dist.sha1 && fpBefore.main.sha1 === fpAfter.main.sha1;
  const headSame = headBefore === headAfter && headBefore !== '(未知)';

  let missing = false;
  for (const ph of PHASES) {
    const shot = shots[ph];
    for (const [mode, buf] of Object.entries(shot.modes)) writeFileSync(path.join(OUT, `tint_${ph}_${mode}.png`), buf);
    const { meta, rowsOut, popTotal, popFull, popMulti, popZero, zeroSamples } = await analyze(ph, shot, shots.identity);
    console.log(`########## devlight=${ph}  canvas ${meta.canvas.w}x${meta.canvas.h} dpr ${meta.dpr}（window.devicePixelRatio=${meta.dprRaw}）hero(${meta.hero.x},${meta.hero.y})`);
    const tst = shots[ph].hintHidden;
    /* 唯一权威判定 = **computed display**（注入是否真生效）；`classList.show` 只作说明：
     * `hint()` 无论是否被 CSS 隐藏都会置 `.show` ⇒ 它恒为 true，**非异常**，别拿它判隐藏是否生效。 */
    console.log(`  overlay门: #hint 注入隐藏 ${tst === true ? '已生效（computed display:none）✅' : tst === null ? '⚠️ 无 #hint 元素（未核）' : '❌ 未生效 ⇒ toast 可能在录制中占像素，读数存疑'} · 录制前已丢弃首帧 · classList.show=${meta.hintShown}（恒置位，非异常）`);
    console.log(`  fillRect 命中：${FAMILIES.map((f) => `${f}x${shot.hits[f]}`).join('  ')}`);
    for (const f of FAMILIES) if (!shot.hits[f]) { missing = true; console.log(`  [!] 族「${LABEL[f]}」命中 0 —— 颜色/名字可能已改，该族无效，勿引用！`); }
    console.log('  族        | population      | 像素数 | ΔL*中位 | ΔE*ab中位 | 色盲ΔL*中位 | 色盲<2.22 | WCAG中位 | WCAG均值(参考) | 类总变化(a并集/b全族)');
    for (const r of rowsOut) {
      console.log(`  ${LABEL[r.fam]} | ${r.pop.padEnd(15)} | ${String(r.n).padStart(6)} | ${f2(r.L).padStart(7)} | ${f2(r.E).padStart(9)} | ${f2(r.C).padStart(10)} | ${(Number.isFinite(r.cvdBelow) ? r.cvdBelow.toFixed(0) + '%' : '-').padStart(8)} | ${f2(r.Wc).padStart(7)} | ${f2(r.wcag).padStart(10)} | ${String(r.totalU ?? '-').padStart(6)}/${String(r.totalF ?? '-').padStart(6)}${r.n < MIN_N ? '  ⚠样本不足' : ''}`);
      console.log(`##ROW\t${ph}\t${r.fam}\t${r.pop}\t${r.n}\t${f2(r.L)}\t${f2(r.E)}\t${f2(r.C)}\t${f2(r.Wc)}\t${f2(r.wcag)}\t${r.totalU}\t${r.totalF}`);
    }
    /* ★ 守恒断言（team-lead 裁定三）：`Σ(四带 n)` 对**两个右端**分别跑 —— (a)并集 / (b)全族；
     *   不等即报缺口，并给归属（多源=族重叠 / 缺源=全族变但无单族变）。**只报数、不下结论。** */
    const sumN = new Map();
    for (const r of rowsOut) sumN.set(r.pop, (sumN.get(r.pop) || 0) + r.n);
    console.log('  守恒断言 Σ(四带n) ── (a)并集 / (b)全族；缺口 = Σ−(右端)（缺口>0 = **多源重叠的重复计数**，非漏归；真漏归看「缺源」列，缺源==0 即覆盖完整）：');
    for (const p of requestedPops) {
      const s = sumN.get(p) || 0, uni = popTotal.get(p) || 0, full = popFull.get(p) || 0;
      const gU = s - uni, gF = s - full, sign = (v) => `${v > 0 ? '+' : ''}${v}`;
      console.log(`    [${p.padEnd(13)}] Σ=${String(s).padStart(6)} | (a)并集=${String(uni).padStart(6)} 缺口${sign(gU).padStart(6)} | (b)全族=${String(full).padStart(6)} 缺口${sign(gF).padStart(6)} | 多源(≥2族)=${popMulti.get(p)} 缺源(全族·无单族)=${popZero.get(p)}`);
    }
    for (const p of requestedPops) { const zs = zeroSamples.get(p); if (zs && zs.length) console.log(`    缺源样本[${p}]: ${zs.join('  ')}`); }
    console.log(`  ##CONS\t${ph}\t${requestedPops.map((p) => `${p}:sum=${sumN.get(p) || 0},uni=${popTotal.get(p) || 0},full=${popFull.get(p) || 0},multi=${popMulti.get(p)},zero=${popZero.get(p)}`).join('|')}`);
    console.log('');
  }
  console.log(`指纹后 : src ${fpAfter.src.sha1} | dist ${fpAfter.dist.sha1} @ ${fpAfter.dist.m} | main ${fpAfter.main.sha1} @ ${fpAfter.main.m}`);
  console.log(`自证①  : src≠dist 已核一致（启动时；不一致 exit 2）—— 量的是"运行的 dist"`);
  console.log(`自证②  : ${stable ? 'OK 量测期间 src/dist/main 指纹均未变（本组可信）' : 'FAIL 量测期间 src/dist/main 变了 —— 本组作废，请重跑'}`);
  console.log(`自证③  : HEAD 测前 ${headBefore} / 测后 ${headAfter} ⇒ ${headSame ? 'OK = 当前 HEAD（非历史读数）' : '⚠️ 测量期间 HEAD 变了 —— 须核对读数归属'}`);
  console.log(`PNG 输出：${OUT}/tint_<phase>_<${Object.keys(MODES).join('|')}>.png`);
  if (!stable) process.exit(3);
  if (missing) { console.error('存在 0 命中的族 => 结果不完整，非零退出。'); process.exit(1); }
})().catch((e) => {
  console.error(e.message);
  process.exit(e.prerequisite ? 2 : 1);
});
