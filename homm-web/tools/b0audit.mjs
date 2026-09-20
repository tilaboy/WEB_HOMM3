#!/usr/bin/env node
/**
 * B0 最小验证批 · 验收脚本（design/art-bible/asset-spec.md §9.1）
 * ==========================================================================
 * 用法：
 *   node tools/b0audit.mjs                 跑 4 条自动断言 + 打印 3 条人工待验清单
 *   node tools/b0audit.mjs --preview       额外打印 ASCII 预览（复核"是不是真的画出来了"）
 *   node tools/b0audit.mjs --png <dir>     额外导出 PNG（原图 ×8 + 去色 32px 盲测表）
 *
 * 设计原则：**能自动化的就自动化，不能自动化的明确标成人工项，绝不伪造成"通过"。**
 *   asset-spec §9.1 的 7 条断言里：
 *     1 抠底无粉边   → 自动
 *     2 块众数降采样无糊 → 自动（色板归属 + 同族相邻台阶差）
 *     8 相邻材质明度差 → 自动（美术 2026-09-19 拍板：ΔL*≥8；色相差<30° 时 ≥12）
 *     3 钳色后同色域 → **半自动**：色板级不变量自动（3a 色板归属 / 3b ΔL*(ink0,ink1)≥12）；
 *                      AI 资产 crestL_p1 钳色后是否同色域 → 人工
 *     4 描边重跑干净 → 自动
 *     5 基线对齐     → 自动
 *     6 去色 32px 盲测 → **人工**（需要 3 个没看过文档的人各 3 次）
 *     7 手机表情可读 → **人工**（需要真机截图）
 *
 * 零新增依赖：只用到 node:fs / node:path / node:zlib。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  UNIT_FRAMES,
  B0_PALETTE,
  B0_SHADE_STEPS,
  B0_PENDING_AI_FRAME,
  buildB0Frame,
  TIER_OF,
  TIER_TARGET_PCT,
  TIER_TARGET_PCT_MAP,
  setTierNormalizeEnabled,
  isTierNormalizeEnabled,
} from '../dist/render/unitArt.js';
import { shade } from '../dist/render/pixel.js';

/* ---------------------------------------------------------------- 参数 */

const argv = process.argv.slice(2);
const wantPreview = argv.includes('--preview');
const pngIdx = argv.indexOf('--png');
const pngDir = pngIdx >= 0 ? argv[pngIdx + 1] : null;

// 负向测试：--no-tier-norm 把阶段 1-B 的归一化机制整个短路掉（必须在建帧之前生效）。
if (argv.includes('--no-tier-norm')) setTierNormalizeEnabled(false);

/* ------------------------------------------------- 色板（美术圣经 §3.2/§3.3 字面值） */

/** cartoon-style.md §3.2 基底色板 + §3.3 每族主题色的**字面** hex 全集（含 B1 的 p3 / p4）。 */
const SPEC_LITERALS = new Set([
  '#2a1a12', '#4a3524', '#ffffff', '#fff3c8',
  '#a8703c', '#8a5f34', '#5f4022',
  '#cfc6b4', '#a9a093', '#6f6858',
  '#dfe6f0', '#aab6c2', '#6b7686',
  '#e8d9a8', '#b9a06a',
  '#f0c79a', '#d8a878', '#a87450',
  '#6fc24a', '#4a8438', '#2f5a24',
  '#3f8fe8', '#8ecdf8', '#22559e', '#eae3d2', '#b3a894', '#ffb020',
  '#e04a34', '#f79a7a', '#9a2519', '#c98a4e', '#8a5a30', '#2fbfa0', '#ffd06a',
  '#a08a72', '#6b5b48', '#d0d0d8', '#cfc6b4',
  // §3.3 p3 翠林守望（B1）
  '#1f7a45', '#3fbe6e', '#93e8a8', '#7a7a48', '#4f5130', '#e0538f', '#d6ff9a',
  // §3.3 p4 紫晶密会（B1）
  '#6232a8', '#a165e8', '#d4aefc', '#58526e', '#38334a', '#3fe0d0', '#8ffff0',
]);

const INK0 = '#2a1a12';
const PAL = new Map(B0_PALETTE.map((e) => [e.hex, e]));

const hex2 = (n) => n.toString(16).padStart(2, '0');
const toHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** 洋红残留判据：红蓝都高、绿明显低（asset-spec §5.3 的抠底底色 #FF00FF 及其过渡带）。 */
function isMagenta(r, g, b) {
  return r > 180 && b > 180 && g < 100;
}

/** CIE L*（§2.4 用 L* 做明度签名）。 */
function lstar(r, g, b) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const Y = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  return Y <= 0 ? 0 : 116 * Math.cbrt(Y) - 16;
}

/** HSL 色相（度）。低饱和度也照样给色相——断言 8 只看"是否同色系"。 */
function hueOf(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d === 0) return 0;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** 色相环上的最短距离（度）。 */
function hueGap(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * 断言 8 的双阈值（美术拍板，2026-09-19）：
 *   相邻不同材质对 ΔL\* ≥ 8；当两材质**色相差 < 30°（同色系）**时阈值升到 12。
 * 为什么不是单阈值 12：12 L\* 是 §2.4 的**族间**明度签名阈值，那一档要靠明度单通道
 * 完成"去色 32px 并排认族"，门槛必须高；精灵内相邻材质还有色相 / 形状 / 1px 描边
 * 三条通道兜底，硬套 12 会误杀大量合法配色。
 */
/**
 * S1 的容差（**非规格**，软带）。依据 silhouette-audit §7 ①（art-director 2026-09-21 裁定）：
 *   **2×容差必须 < 最小步长**，否则相邻档的接受带**重叠** ⇒ 判不出某帧属哪一档，
 *   S1 就退化成一个恒真的摆设。实测最小步长 cu 7.2 / map 6.8 ⇒ 容差上限 3.4/3.6 ⇒ 取 **3**。
 * ⚠️ 曾经的 ±8 会让 cu 的 T1 带 (52.7–68.7) 与 T2 带 (61.6–77.6) 重叠 —— 那是**无分辨力**的。
 */
const S1_TOL = 3;

const MIN_DL = 8;
const MIN_DL_SAME_HUE = 12;
const SAME_HUE_DEG = 30;

function requiredDl(h1, h2) {
  return hueGap(h1, h2) < SAME_HUE_DEG ? MIN_DL_SAME_HUE : MIN_DL;
}

/* ---------------------------------------------------------------- 取值 */

function readBuf(pb) {
  const { w, h } = pb;
  const d = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push(pb.px(x, y));
    d.push(row);
  }
  return d;
}

/** 剪影 bbox（含宽高），供横向适配断言用。 */
function bodyBox(name) {
  const pb = buildB0Frame(name, false);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let y = 0; y < pb.h; y++) {
    for (let x = 0; x < pb.w; x++) {
      if (pb.px(x, y)[3] <= 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, x1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const A = (d, x, y) => (y >= 0 && y < d.length && x >= 0 && x < d[0].length ? d[y][x] : [0, 0, 0, 0]);
const opaque = (p) => p[3] > 8;
const solid = (p) => p[3] === 255;

/* ---------------------------------------------------------------- 断言 */

const results = [];
function record(id, title, pass, detail) {
  results.push({ id, title, pass, detail });
}

/** 断言 1：抠底无粉边 —— 100% 边缘像素 alpha ∈ {0,255}，无洋红残留。 */
function assertNoFringe(name, d) {
  let semi = 0;
  let magenta = 0;
  let edgeBad = 0;
  let edges = 0;
  for (let y = 0; y < d.length; y++) {
    for (let x = 0; x < d[0].length; x++) {
      const p = d[y][x];
      const [r, g, b, a] = p;
      if (a !== 0 && a !== 255) semi++;
      if (isMagenta(r, g, b) && a > 0) magenta++;
      if (opaque(p)) {
        const n = [A(d, x - 1, y), A(d, x + 1, y), A(d, x, y - 1), A(d, x, y + 1)];
        if (n.some((q) => !opaque(q))) {
          edges++;
          if (!solid(p)) edgeBad++;
        }
      }
    }
  }
  const pass = semi === 0 && magenta === 0 && edgeBad === 0;
  record(1, '抠底无粉边', pass, {
    name,
    semiTransparent: semi,
    magentaPixels: magenta,
    edgePixels: edges,
    edgeNotSolid: edgeBad,
  });
  return pass;
}

/** 断言 2：块众数降采样无糊 —— 色板归属 + 同材质相邻台阶差 ≥2（不是连续渐变）。 */
function assertNoSmear(name, d) {
  const offPalette = new Map();
  const stepViolations = [];
  const colors = new Set();
  for (let y = 0; y < d.length; y++) {
    for (let x = 0; x < d[0].length; x++) {
      const p = d[y][x];
      if (!opaque(p)) continue;
      const hex = toHex(p[0], p[1], p[2]);
      colors.add(hex);
      const e = PAL.get(hex);
      if (!e) {
        offPalette.set(hex, (offPalette.get(hex) ?? 0) + 1);
        continue;
      }
      for (const [nx, ny] of [
        [x + 1, y],
        [x, y + 1],
      ]) {
        const q = A(d, nx, ny);
        if (!opaque(q)) continue;
        const qhex = toHex(q[0], q[1], q[2]);
        if (qhex === hex) continue;
        const f = PAL.get(qhex);
        if (!f) continue;
        if (f.family === e.family && Math.abs(f.idx - e.idx) < 2) {
          stepViolations.push(`(${x},${y}) ${hex}[${e.family}#${e.idx}] ↔ ${qhex}[#${f.idx}]`);
        }
      }
    }
  }
  const pass = offPalette.size === 0 && stepViolations.length === 0 && colors.size <= 24;
  record(2, '块众数降采样无糊', pass, {
    name,
    distinctColors: colors.size,
    offPalette: [...offPalette.entries()].map(([h, n]) => `${h}×${n}`),
    stepViolations,
  });
  return pass;
}

/** 断言 8：相邻材质对的明度差（美术 2026-09-19 拍板，双阈值 + 色相判据）。 */
function assertMaterialContrast(name, d) {
  const violations = [];
  let worst = { dl: Infinity, text: 'n/a' };
  for (let y = 0; y < d.length; y++) {
    for (let x = 0; x < d[0].length; x++) {
      const p = d[y][x];
      if (!opaque(p)) continue;
      const hex = toHex(p[0], p[1], p[2]);
      const e = PAL.get(hex);
      if (!e) continue;
      for (const [nx, ny] of [
        [x + 1, y],
        [x, y + 1],
      ]) {
        const q = A(d, nx, ny);
        if (!opaque(q)) continue;
        const qhex = toHex(q[0], q[1], q[2]);
        if (qhex === hex) continue;
        const f = PAL.get(qhex);
        if (!f || f.family === e.family) continue; // 同材质归断言 2 的台阶规则
        // ink0↔ink1 的 ΔL* 是**常量**（13.0，由 §3.2 两个字面值决定），不是某个精灵的
        // 布局风险。让它参与逐精灵扫描等于在每只靴子底下重复检查同一个常量，只制造余量-1
        // 噪声 → 移交给断言 3 的色板级不变量查一次（美术 2026-09-19 拍板）。
        const pair = [e.family, f.family].sort().join('|');
        if (pair === 'ink0|ink1') continue;
        const h1 = hueOf(p[0], p[1], p[2]);
        const h2 = hueOf(q[0], q[1], q[2]);
        const need = requiredDl(h1, h2);
        const dl = Math.abs(lstar(p[0], p[1], p[2]) - lstar(q[0], q[1], q[2]));
        const key = `${hex}|${qhex}`;
        const text = `${hex}↔${qhex} ΔL*=${dl.toFixed(1)} ΔH=${hueGap(h1, h2).toFixed(0)}° 需≥${need}`;
        if (dl < need) {
          const hit = violations.find((v) => v.key === key);
          if (hit) hit.n++;
          else violations.push({ key, text, n: 1, at: `(${x},${y})` });
        }
        if (dl < worst.dl) worst = { dl, text: `${text} @(${x},${y})` };
      }
    }
  }
  const pass = violations.length === 0;
  record(8, '相邻材质明度差（断言 8）', pass, {
    name,
    violations: violations.map((v) => `${v.text} ×${v.n} @${v.at}`),
    worstPair: worst.text,
  });
  return pass;
}

/**
 * 断言 3（自动部分）：色板级不变量 —— 「钳色后同色域」里能自动化的那一半。
 * 同一断言的**AI 资产那一半**（crestL_p1 钳色后是否 100% 落色板）仍列人工项。
 *
 * 3a 声明色板 100% 属于 §3.2/§3.3 字面值，或 §3.4 五档台阶的派生色；
 * 3b ΔL*(ink0, ink1) ≥ 12 —— §1.1 原文「ink1 比外描边浅一档，形成主次」的可执行化。
 *    这是**调色板属性**，查一次即可；放在逐精灵扫描里只会持续制造余量 1 的噪声。
 */
function assertPaletteInvariants() {
  const literalList = [...SPEC_LITERALS];
  const offSpec = [];
  for (const e of B0_PALETTE) {
    if (SPEC_LITERALS.has(e.hex)) continue;
    const derived = literalList.some((b) => B0_SHADE_STEPS.some((st) => shade(b, st) === e.hex));
    if (!derived) offSpec.push(e.hex);
  }
  const idxBad = B0_PALETTE.filter(
    (e) => !Number.isInteger(e.idx) || e.idx < 0 || e.idx > 4,
  ).map((e) => `${e.hex}#${e.idx}`);

  const ink0 = B0_PALETTE.find((e) => e.family === 'ink0');
  const ink1 = B0_PALETTE.find((e) => e.family === 'ink1');
  let inkGap = NaN;
  if (ink0 && ink1) {
    const a = lstar(...rgb(ink0.hex));
    const b = lstar(...rgb(ink1.hex));
    inkGap = Math.abs(a - b);
  }
  const pass = offSpec.length === 0 && idxBad.length === 0 && inkGap >= 12;
  record(3, '钳色后同色域（色板级；AI 部分人工）', pass, {
    paletteSize: B0_PALETTE.length,
    offSpecColors: offSpec,
    badStepIdx: idxBad,
    ink0VsInk1Luma: Number.isNaN(inkGap) ? 'n/a' : `${inkGap.toFixed(1)} L*（需 ≥12）`,
  });
  return pass;
}

/** '#rrggbb' → [r, g, b]。 */
function rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** 断言 4：描边重跑干净 —— 轮廓 1px 单线，无 2px 断点、无灰边。
 *
 * 口径说明（为什么要传两份缓冲）：`PixBuf.outline()` 的语义是「把所有紧邻**本体**的
 * 透明像素填成 ink0」，即一圈 **1 次膨胀**。所以必须拿**描边前**的本体去还原这圈
 * ring，再在**描边后**的成品上检查它；直接用成品反推会把斜角尖端的合法像素误判成断点。
 */
function assertOutlineClean(name, body, final) {
  const H = final.length;
  const W = final[0].length;
  const inRing = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      if (opaque(body[y][x])) {
        row.push(false);
        continue;
      }
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (opaque(A(body, x + dx, y + dy))) {
            near = true;
            break;
          }
        }
      }
      row.push(near);
    }
    inRing.push(row);
  }

  let ring = 0;
  let gaps = 0; // 该有描边的地方不是 ink0 / 不满不透明 → 断点或灰边
  let thick = 0; // 描边外面又叠了一层描边 → 2px 粗
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inRing[y][x]) continue;
      ring++;
      const p = final[y][x];
      // (a) 无断点 + 无灰边
      if (!solid(p) || toHex(p[0], p[1], p[2]) !== INK0) gaps++;
      // (b) 1px 单线：ink0 必须紧邻**彩色本体**，不能只挨着另一颗 ink0
      let nearBody = false;
      for (let dy = -1; dy <= 1 && !nearBody; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const q = A(body, x + dx, y + dy);
          if (opaque(q)) {
            nearBody = true;
            break;
          }
        }
      }
      if (!nearBody) thick++;
    }
  }

  // (c) 本体连通块数 vs 描边环数（信息项：p2 攻击帧飞出去的石块会多一个岛）
  const seen = new Set();
  let bodyIslands = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const key = `${x},${y}`;
      if (!opaque(body[y][x]) || seen.has(key)) continue;
      bodyIslands++;
      const stack = [[x, y]];
      seen.add(key);
      while (stack.length) {
        const [sx, sy] = stack.pop();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = sx + dx;
            const ny = sy + dy;
            const k2 = `${nx},${ny}`;
            if (seen.has(k2) || !opaque(A(body, nx, ny))) continue;
            seen.add(k2);
            stack.push([nx, ny]);
          }
        }
      }
    }
  }
  const seen2 = new Set();
  let contourLoops = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const key = `${x},${y}`;
      if (!inRing[y][x] || seen2.has(key)) continue;
      contourLoops++;
      const stack = [[x, y]];
      seen2.add(key);
      while (stack.length) {
        const [sx, sy] = stack.pop();
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = sx + dx;
            const ny = sy + dy;
            const k2 = `${nx},${ny}`;
            const inside = ny >= 0 && ny < H && nx >= 0 && nx < W && inRing[ny][nx];
            if (seen2.has(k2) || !inside) continue;
            seen2.add(k2);
            stack.push([nx, ny]);
          }
        }
      }
    }
  }

  const pass = gaps === 0 && thick === 0 && ring > 0;
  record(4, '描边重跑干净', pass, {
    name,
    ringPixels: ring,
    gaps,
    thickRuns: thick,
    bodyIslands,
    contourLoops,
  });
  return pass;
}

/** 断言 5：基线对齐 —— 两个族的 map 帧并排，脚底基线偏差 = 0px。 */
function baselineOf(d) {
  for (let y = d.length - 1; y >= 0; y--) {
    if (d[y].some((p) => opaque(p))) return y;
  }
  return -1;
}

/** 剪影诊断（信息项，用来佐证"两族横向可辨"，不是断言）。 */
function silhouette(d) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let area = 0;
  for (let y = 0; y < d.length; y++) {
    for (let x = 0; x < d[0].length; x++) {
      if (!opaque(d[y][x])) continue;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const h = y1 - y0 + 1;
  const w = x1 - x0 + 1;
  // 顶部尖角：最高那一行是否只有 1–3 px 宽
  let topWidth = 0;
  for (let x = 0; x < d[0].length; x++) if (opaque(d[y0][x])) topWidth++;
  // 左右对称度：逐行镜像重合率
  let same = 0;
  let tot = 0;
  const mid = (x0 + x1) / 2;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const mx = Math.round(2 * mid - x);
      tot++;
      if (opaque(d[y][x]) === opaque(A(d, mx, y))) same++;
    }
  }
  return {
    bbox: `${w}×${h}`,
    ratio: (h / w).toFixed(2),
    topWidth,
    symmetry: `${((same / tot) * 100).toFixed(0)}%`,
    area,
    fill: `${((area / (w * h)) * 100).toFixed(0)}%`,
  };
}

/* ---------------------------------------------------------------- 输出 */

const RAMP = ' .:-=+*#%@';

function ascii(d) {
  const out = [];
  for (let y = 0; y < d.length; y++) {
    let line = '';
    for (let x = 0; x < d[0].length; x++) {
      const [r, g, b, a] = d[y][x];
      if (a < 8) {
        line += ' ';
        continue;
      }
      const L = lstar(r, g, b);
      const hex = toHex(r, g, b);
      if (hex === INK0) line += '#';
      else line += RAMP[Math.min(9, Math.max(1, Math.floor((L / 100) * 9)))];
    }
    out.push(line.replace(/\s+$/, ''));
  }
  return out.join('\n');
}

/* ------------------------------------------------------- PNG（零依赖） */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 真彩色 RGBA PNG（无滤波）。棋盘底代表透明。 */
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[o++] = rgba[i];
      raw[o++] = rgba[i + 1];
      raw[o++] = rgba[i + 2];
      raw[o++] = rgba[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 最近邻整数放大（保持硬边像素风）。 */
function upscale(d, k) {
  const w = d[0].length * k;
  const h = d.length * k;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = d[Math.floor(y / k)][Math.floor(x / k)];
      const i = (y * w + x) * 4;
      out[i] = s[0];
      out[i + 1] = s[1];
      out[i + 2] = s[2];
      out[i + 3] = s[3];
    }
  }
  return { w, h, data: out };
}

/** 去色 + 缩到 32px 高（asset-spec §9.1 断言 6 的盲测素材）。 */
function desaturateScale(d, targetH) {
  const sw = d[0].length;
  const sh = d.length;
  const tw = Math.max(1, Math.round((sw * targetH) / sh));
  const out = [];
  for (let y = 0; y < targetH; y++) {
    const row = [];
    for (let x = 0; x < tw; x++) {
      const s = d[Math.min(sh - 1, Math.floor((y * sh) / targetH))][Math.min(sw - 1, Math.floor((x * sw) / tw))];
      const L = lstar(s[0], s[1], s[2]);
      const v = Math.round((Math.max(0, Math.min(100, L)) / 100) * 255);
      row.push([v, v, v, s[3]]);
    }
    out.push(row);
  }
  return out;
}

function grid(rows, gap, bg) {
  const w = Math.max(...rows.map((r) => r.length)) + gap * 2;
  const cellH = rows[0].length;
  const h = cellH * rows.length + gap * 2;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = bg[0];
    out[i * 4 + 1] = bg[1];
    out[i * 4 + 2] = bg[2];
    out[i * 4 + 3] = bg[3];
  }
  rows.forEach((r, ri) => {
    for (let y = 0; y < r.length; y++) {
      for (let x = 0; x < r[0].length; x++) {
        const i = ((gap + ri * cellH + y) * w + gap + x) * 4;
        const s = r[y][x];
        out[i] = s[0];
        out[i + 1] = s[1];
        out[i + 2] = s[2];
        out[i + 3] = s[3];
      }
    }
  });
  return { w, h, data: out };
}

/* ---------------------------------------------------------------- 主流程 */

console.log('B0+B1 程序化兵种批 · 验收（asset-spec §9.1 / §9.2）');
console.log('扫描范围：unitArt.ts 内全部帧（B0 6 + B1 18 = 24），阈值未放宽');
console.log('='.repeat(64));

const frames = UNIT_FRAMES.map((spec) => ({
  spec,
  d: readBuf(buildB0Frame(spec.name, true)), // 成品（含 1px ink0 描边）
  body: readBuf(buildB0Frame(spec.name, false)), // 描边前本体（断言 4 还原膨胀圈用）
}));

assertPaletteInvariants(); // 色板级，查一次，不逐帧

// 断言 1 / 2 / 4 / 8：逐帧
for (const f of frames) {
  assertNoFringe(f.spec.name, f.d);
  assertNoSmear(f.spec.name, f.d);
  assertOutlineClean(f.spec.name, f.body, f.d);
  assertMaterialContrast(f.spec.name, f.d);
}

// 断言 5：两族 map 帧脚底基线
const mapA = frames.find((f) => f.spec.name === 'u_p1_lampbearer_map');
const mapB = frames.find((f) => f.spec.name === 'u_p2_scavenger_map');
const bA = baselineOf(mapA.d);
const bB = baselineOf(mapB.d);
record(5, '基线对齐（两族 map 帧）', bA === bB && bA >= 0, {
  'u_p1_lampbearer_map': bA,
  'u_p2_scavenger_map': bB,
  delta: Math.abs(bA - bB),
});

// 断言 12：等比缩放**不得横向溢出画布**。
//
// 机制是等比（两轴同 scale），宽度由目标高决定：destW = round(srcW × 目标体高 ÷ srcH)。
// 若 destW > 画布宽，精灵两侧会被硬裁 —— 画布是精灵槽位，裁掉的部分在游戏里就是没了。
// 这里按同一算式复算而不是「检测是否触边」：被裁掉的那一列**可能本来就是透明的**，
// 触边法会漏报；复算精确。代价是机制改几何时要同步改这里 —— 但那只会**误报（红）**，
// 不会漏报，方向是安全的。
{
  const wasOn = isTierNormalizeEnabled();
  setTierNormalizeEnabled(false);
  const raw = new Map();
  for (const f of frames) raw.set(f.spec.name, bodyBox(f.spec.name));
  setTierNormalizeEnabled(wasOn); // ★ 恢复原状态（--no-tier-norm 下不要把它打开）

  const bad = [];
  if (wasOn) {
    for (const f of frames) {
      const b = raw.get(f.spec.name);
      const t = TIER_OF[f.spec.unit];
      const pct = f.spec.kind === 'map' ? TIER_TARGET_PCT_MAP[t] : TIER_TARGET_PCT[t];
      const targetBody = Math.floor((pct / 100) * f.spec.h) - 1;
      const destW = Math.max(1, Math.round(b.w * (targetBody / b.h)));
      if (destW > f.spec.w) {
        bad.push(`${f.spec.name} destW=${destW} > 画布宽 ${f.spec.w}（两侧共溢出 ${destW - f.spec.w}px）`);
      }
    }
  }
  record(12, '等比缩放不横向溢出画布', bad.length === 0, {
    name: '横向适配',
    说明: wasOn ? '机制开启' : '机制关闭（不缩放 ⇒ 无溢出，本条不适用）',
    溢出帧数: bad.length,
    明细: bad,
  });
}

// 断言 13：**S3 帧内居中不变量** —— 剪影的水平中心必须等于**帧中心**（±1px）。
//
// 为什么必须有这条（`silhouette-audit §6④`，art-director 裁定）：
//   `ax = −w/2`（map −10 / cu −32）这套锚点的**前提就是「剪影在帧内居中」**。
//   而 `drawXxx` 的坐标是按**旧画布宽**（map 32 / cu 44）写死的历史常量（硬约束：不许手改），
//   画布加宽后本体在帧内**偏左** ⇒ 若归一化按「本体自身中心」居中，整只精灵会再被推左，
//   `ax = −w/2` 就落不到格心/六边形中心。
//   ⚠️ 它与 S2 正交：S2 管「别太宽」，S3 管「在帧内居中」——**缺任一条 `ax` 都不成立**。
//   ⚠️ 也是**既有潜伏缺陷**：H1/H2/S1 只测**体量**，横向从没被测过 ⇒ 48 帧里曾有 46 帧违例。
{
  const bad = [];
  for (const f of frames) {
    const d = f.d;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (let y = 0; y < d.length; y++) {
      for (let x = 0; x < d[0].length; x++) {
        if (!opaque(d[y][x])) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
    if (x1 < x0) continue;
    const c = (x0 + x1) / 2;
    const fc = (f.spec.w - 1) / 2;
    if (Math.abs(c - fc) > 1 + 1e-9) {
      bad.push(`${f.spec.name} 剪影中心 ${c} vs 帧中心 ${fc}（偏 ${(c - fc).toFixed(1)}）`);
    }
  }
  record(13, 'S3 帧内居中（剪影中心 = 帧中心 ±1px）', bad.length === 0, {
    name: 'S3·帧内居中',
    违例帧数: bad.length,
    明细: bad,
  });
}

/* ---------------------------------------------------------------- 剪影矩阵断言（§5.6.1 / §5.6.2）

 * 体量 = 剪影高 ÷ **该画布高** × 100，与 silhouette() 诊断同口径（含 1px 描边）。
 * 范围：**两个画布都覆盖** ——
 *   · cu（64×56）：目标 = TIER_TARGET_PCT（§5.6.2 的原文定义画布；画布宽经 D-73 加宽）
 *   · map（52×44）：目标 = TIER_TARGET_PCT_MAP（§5.6.2 的表头只定义了战斗画布；map 目标由主理人代裁、art-director 已追认）
 * ⚠️ 为什么必须覆盖 map：本 P0 之所以能潜伏到 B2 之后，正是**「实现的通道没有断言」**。
 *    只断言 cu 等于把同一个坑在 map 上再挖一次。
 * H1/H2 硬（不依赖容差）；S1 软（自设 **±3pt**，非规格，裁定见 silhouette-audit.md §7①；
 * 为什么不是 ±8：2×容差必须 < 最小步长，否则相邻档接受带重叠 ⇒ 判不出属哪一档）。
 *
 * 只取 idle 帧作 tier 体量代表（与 silhouette-audit.md 的 16 单位 / 120 对口径一致；
 * 每个单位 2 张帧，atk 是该单位的攻击变体，不计入矩阵）。
 */
function checkTierMatrix({ label, kind, targets }) {
  // ⚠️ 只按 kind 筛，**不要按硬编码的帧宽筛** —— 帧宽是画布尺寸，D-73 把槽位
  //   从 32/44 加宽到 48/60 时，按宽度筛的写法会瞬间匹配 0 帧。
  const list = frames.filter((f) => f.spec.kind === kind);
  const canvasH = list.length ? list[0].spec.h : 0;
  // ★ 真空守卫：过滤器写错（比如拿 'idle' 去筛 map 帧）会得到空列表 ⇒ 三条断言全部
  //   「无记录可判」而 PASS。**一条什么都没测的绿断言比红的更危险** ——
  //   本次就真踩了：map 帧的 kind 是 'map' 不是 'idle'，H1·map 一度是真空 PASS。
  const nonEmpty = list.length > 0;
  const volOf = (f) => {
    const m = silhouette(f.d).bbox.match(/^(\d+)×(\d+)$/);
    return ((m ? +m[2] : 0) / canvasH) * 100;
  };
  const byFaction = new Map();
  for (const f of list) {
    const fac = f.spec.unit.slice(0, 2);
    if (!byFaction.has(fac)) byFaction.set(fac, []);
    byFaction.get(fac).push(f);
  }

  // H1：四族各自的 T1→T4 体量严格递增，且最小步长 ≥6pt
  {
    const detail = {};
    let allOk = true;
    for (const [fac, fs] of byFaction) {
      const order = [1, 2, 3, 4].map((t) => fs.find((f) => TIER_OF[f.spec.unit] === t));
      const vals = order.map((f) => (f ? +volOf(f).toFixed(1) : NaN));
      let ok = true;
      for (let t = 0; t < 4; t++) {
        if (!order[t] || !isFinite(vals[t])) { ok = false; break; }
        if (t > 0 && vals[t] - vals[t - 1] < 6 - 1e-9) ok = false; // 严格递增 + 步长 ≥6pt
      }
      if (!ok) allOk = false;
      detail[`${fac} T1→T4`] = vals.map((v) => (isFinite(v) ? v.toFixed(1) : '—')).join(' / ');
    }
    record(9, `H1 体量阶梯严格递增(步长≥6pt) · ${label}`, allOk && nonEmpty, { 画布: label, 帧数: list.length, ...detail, name: `H1·${label}` });
  }

  // H2：跨族 tier 倒挂对 = 0（tier 低却比 tier 高的大，即矩阵纵轴塌掉）
  {
    const l = list.map((f) => ({ unit: f.spec.unit, tier: TIER_OF[f.spec.unit], v: volOf(f) }));
    let inv = 0;
    const samples = [];
    for (let i = 0; i < l.length; i++) {
      for (let j = 0; j < l.length; j++) {
        if (i === j) continue;
        const a = l[i];
        const b = l[j];
        if (a.tier < b.tier && a.v > b.v + 1e-9) {
          inv++;
          if (samples.length < 10) samples.push(`${a.unit}(T${a.tier},${a.v.toFixed(1)}%)>${b.unit}(T${b.tier},${b.v.toFixed(1)}%)`);
        }
      }
    }
    record(10, `H2 跨族 tier 倒挂对 = 0 · ${label}`, inv === 0 && nonEmpty, { 画布: label, 帧数: list.length, 倒挂对: inv, 示例: samples.join('  '), name: `H2·${label}` });
  }

  // S1：每族每 tier 落在该画布目标 ±3pt（软带；值见常量 S1_TOL，裁定见 silhouette-audit §7①）
  {
    let bad = 0;
    const detail = {};
    for (const f of list) {
      const t = TIER_OF[f.spec.unit];
      const v = volOf(f);
      const off = v - targets[t];
      if (Math.abs(off) > S1_TOL + 1e-9) {
        bad++;
        detail[f.spec.unit] = `${v.toFixed(1)}%(靶${targets[t].toFixed(1)},偏${off >= 0 ? '+' : ''}${off.toFixed(1)})`;
      }
    }
    record(11, `S1 每族每 tier 落在目标 ±${S1_TOL}pt(非规格容差) · ${label}`, bad === 0 && nonEmpty, { 画布: label, 帧数: list.length, 越界帧数: bad, ...detail, name: `S1·${label}` });
  }
}

checkTierMatrix({ label: 'cu 战斗帧', kind: 'idle', targets: TIER_TARGET_PCT });
checkTierMatrix({ label: 'map 地图帧', kind: 'map', targets: TIER_TARGET_PCT_MAP });

/* ---------------------------------------------------------------- 报告 */

const byId = new Map();
for (const r of results) {
  if (!byId.has(r.id)) byId.set(r.id, []);
  byId.get(r.id).push(r);
}

console.log('\n── 自动断言（逐帧 1/2/4/8 + 色板级 3 + 基线 5） ──');
const verdict = new Map();
for (const id of [1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13]) {
  const rs = byId.get(id) ?? [];
  const pass = rs.every((r) => r.pass);
  verdict.set(id, pass);
  const title = rs[0]?.title ?? `断言 ${id}`;
  console.log(`\n[${id}] ${title}  →  ${pass ? 'PASS' : 'FAIL'}`);
  if (id === 5) {
    console.log(`    u_p1_lampbearer_map 脚底行 = ${bA}`);
    console.log(`    u_p2_scavenger_map  脚底行 = ${bB}`);
    console.log(`    偏差 = ${Math.abs(bA - bB)} px`);
    continue;
  }
  for (const r of rs) {
    const mark = r.pass ? 'PASS' : 'FAIL';
    // detail 有两种形态，**不要假设 name 一定存在**：
    //   · 逐帧断言（1 / 2 / 4 / 8）→ detail.name = 帧名，用它当标签；
    //   · 一次性 / 色板级断言（3）→ 无 name（它的 detail 描述的是整块色板，不是某一帧），
    //     退回用 title 当标签。
    // 旧版直接 `name.padEnd` 会在遇到非逐帧记录时抛
    // `TypeError: Cannot read properties of undefined (reading 'padEnd')`。
    const { name, ...rest } = r.detail;
    const label = typeof name === 'string' ? name : r.title;
    const bits = Object.entries(rest)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? (v.length ? v.join(', ') : '0') : v}`)
      .join('  ');
    console.log(`    ${mark}  ${label.padEnd(24)} ${bits}`);
  }
}

console.log('\n── 剪影诊断（信息项，佐证 §5.6 横向可辨，非断言） ──');
for (const f of frames) {
  const s = silhouette(f.d);
  const bl = baselineOf(f.d);
  console.log(
    `    ${f.spec.name.padEnd(24)} ${f.spec.w}×${f.spec.h}  剪影 ${s.bbox.padEnd(7)} 高宽比 ${s.ratio.padEnd(5)} ` +
      `顶宽 ${String(s.topWidth).padStart(2)}px  左右对称 ${s.symmetry.padStart(4)}  占地 ${s.fill.padStart(4)}  脚底行 ${bl}`,
  );
}

/* ---------------------------------------------------------------- 人工项 */

console.log('\n── 人工验收项（脚本不代为判定，禁止伪造成通过） ──');
// 断言 3 已拆两半：色板级不变量（3a 色板归属 / 3b ΔL*(ink0,ink1)≥12）= 自动，见上方 [3]；
// 这里只剩**依赖 AI 资产的那一半**（crestL_p1 钳色后是否 100% 落色板）。
console.log(`  [3] 钳色后同色域（仅 AI 那一半）MANUAL  依赖 AI 资产 ${B0_PENDING_AI_FRAME}（256×384），本轮未产出`);
console.log('                                 判据：AI 资产的颜色 100% 属于 cartoon-style §3 色板');
console.log('                                 （色板级 3a / 3b 已自动判定，见上方「自动断言」的 [3]）');
console.log('  [6] 去色 32px 可辨（核心）MANUAL  3 个盲测者 × 各 3 次，晨曦 T1 与赤焰 T1 去色缩到 32px');
console.log('                                 判据：全部答对（§5.6.5 的 20 格版本阈值 = 命中率 ≥90%）');
console.log('  [7] 手机上表情可读      MANUAL  64×56 帧在 zoom 2 × dpr 3 下截图，眼与嘴线可辨');
console.log(`  [+] ${B0_PENDING_AI_FRAME} 全流程    MANUAL  七步管线（抠底→块众数降采样→钳色→落位→描边重建→手工修→PNG-8）`);
console.log('        （本轮只做 6 个程序化帧；crestL_p1 是 asset-spec §9.1 的第 7 个资产，留到下一批）');

/* ---------------------------------------------------------------- 预览 */

if (wantPreview) {
  console.log('\n── ASCII 预览（# = ink0 描边，空格 = 透明，其余按明度分级） ──');
  for (const f of frames) {
    console.log(`\n${f.spec.name}  (${f.spec.w}×${f.spec.h})`);
    console.log(ascii(f.d));
  }
}

if (pngDir) {
  mkdirSync(pngDir, { recursive: true });
  for (const f of frames) {
    const up = upscale(f.d, 8);
    writeFileSync(join(pngDir, `${f.spec.name}.png`), encodePng(up.w, up.h, up.data));
  }
  // 盲测素材：两族 map 帧去色 → 32px 高 → 并排（**不打标**，答案另给）
  const sheet = grid([desaturateScale(mapA.d, 32), desaturateScale(mapB.d, 32)], 4, [128, 128, 128, 255]);
  const up = upscale(
    (() => {
      const rows = [];
      for (let y = 0; y < sheet.h; y++) {
        const row = [];
        for (let x = 0; x < sheet.w; x++) {
          const i = (y * sheet.w + x) * 4;
          row.push([sheet.data[i], sheet.data[i + 1], sheet.data[i + 2], sheet.data[i + 3]]);
        }
        rows.push(row);
      }
      return rows;
    })(),
    6,
  );
  writeFileSync(join(pngDir, 'blindtest_32px.png'), encodePng(up.w, up.h, up.data));
  console.log(`\nPNG 已导出 → ${pngDir}`);
  console.log('  6 帧 ×8 原图 + blindtest_32px.png（去色 32px 盲测表，**答案：上=晨曦提灯侍从，下=赤焰捡破烂小鬼**）');
}

/* ---------------------------------------------------------------- 汇总 */

const allPass = [...verdict.values()].every(Boolean);
console.log('\n' + '='.repeat(64));
console.log(
  `自动断言汇总： ${[...verdict.entries()]
    .map(([id, p]) => `[${id}] ${p ? 'PASS' : 'FAIL'}`)
    .join('  ')}`,
);
console.log(`人工项： [3 的 AI 半] MANUAL  [6] MANUAL  [7] MANUAL  [+${B0_PENDING_AI_FRAME}] MANUAL`);
console.log(`结论：自动部分 ${allPass ? '全过（B0 的 6 帧仍 PASS，B1 的 18 帧亦 PASS）' : '未全过 —— 不要提交'}`);
console.log('='.repeat(64));

process.exit(allPass ? 0 : 1);
