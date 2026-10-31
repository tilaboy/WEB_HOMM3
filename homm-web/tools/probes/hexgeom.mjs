#!/usr/bin/env node
/**
 * E1 · 战斗六角格几何闸（spec §1.1）
 *
 * 为什么不用浏览器：这三条全是**纯几何**判据，只依赖 `dist/core/combat/hex.js`
 * 的常量与 `hexCenter()`。开 Chromium 只会把"算错了"和"画错了"混在一起，
 * 而缩格这件事最容易错的恰恰是算法（格心 / 共边），不是绘制。
 *
 * 三条判据：
 *   G1 常量：R=17.5 · stepX=30.31 · stepY=26.25 · 战场 469.8×297.5（±0.2）
 *   G2 格心：15×11 全部满足 `cx = 15.15 + 30.31c + 15.16(r&1)`、`cy = 17.5 + 26.25r`，误差 ≤0.5px
 *   G3 共边：相邻两格的共享边两端点差 < 1px（顶点由格心 + R 重建，pointy-top）
 *
 * 负向对照（`--legacy`）：把参考几何换成缩格前的 22 / 38 / 33 / 40×46，
 * **必须整体变红**。它证明的不是"数字改了"，而是"这套判据真的在量代码"——
 * 若哪天有人把 `hex.ts` 改回旧值而忘了改判据，G1 会直接指出是哪一项。
 *
 * 退出码：0 通过（`--legacy` 时为"如期变红"）/ 1 判据红 / 2 前置缺失（dist 没构建）
 *
 * 用法：
 *   node tools/probes/hexgeom.mjs            # 正跑
 *   node tools/probes/hexgeom.mjs --legacy   # 负向对照
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const distHex = resolve(here, '../../dist/core/combat/hex.js');
const legacy = process.argv.includes('--legacy');

if (!existsSync(distHex)) {
  console.error(`[hexgeom] 前置缺失：${distHex} 不存在 —— 先 npm run build`);
  process.exit(2);
}

const H = await import(distHex);

/** 参考几何：默认 = spec §1.1 的目标值；`--legacy` = 缩格前的实测值。 */
const REF = legacy
  ? { R: 22, stepX: 38, stepY: 33, spriteW: 40, spriteH: 46, fieldW: 591, fieldH: 376 }
  : { R: 17.5, stepX: 30.31, stepY: 26.25, spriteW: 30.3, spriteH: 35, fieldW: 469.8, fieldH: 297.5 };

const rows = [];
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ---------------- G1 常量 ---------------- */

function g1() {
  const checks = [
    ['R (HEX_SIZE)', H.HEX_SIZE, REF.R, 0.01],
    ['HEX_STEP_X', H.HEX_STEP_X, REF.stepX, 0.05],
    ['HEX_STEP_Y', H.HEX_STEP_Y, REF.stepY, 0.05],
    ['精灵盒宽', H.HEX_SPRITE_W, REF.spriteW, 0.01],
    ['精灵盒高', H.HEX_SPRITE_H, REF.spriteH, 0.01],
    ['战场宽 FIELD_PX_W', H.FIELD_PX_W, REF.fieldW, 0.2],
    ['战场高 FIELD_PX_H', H.FIELD_PX_H, REF.fieldH, 0.2],
  ];
  const bad = checks.filter(([, got, want, tol]) => !near(got, want, tol));
  for (const [name, got, want, tol] of checks) {
    rows.push({
      id: `G1.${name}`,
      ok: near(got, want, tol),
      detail: `实测 ${round(got)} / 目标 ${want}（±${tol}）`,
    });
  }
  return bad.length === 0;
}

/* ---------------- G2 格心 ---------------- */

function g2() {
  let worst = 0;
  let worstAt = '';
  for (let r = 0; r < H.FIELD_H; r++) {
    for (let c = 0; c < H.FIELD_W; c++) {
      const got = H.hexCenter({ col: c, row: r });
      // spec 的写法（15.16 是 stepX/2 的四舍五入）；代码用 stepX/2，差 0.005 属正常
      const wx = REF.spriteW / 2 + REF.stepX * c + (REF.stepX / 2) * (r & 1);
      const wy = REF.spriteH / 2 + REF.stepY * r;
      const d = Math.max(Math.abs(got.x - wx), Math.abs(got.y - wy));
      if (d > worst) {
        worst = d;
        worstAt = `(${c},${r}) 实测 ${round(got.x)},${round(got.y)} / 期望 ${round(wx)},${round(wy)}`;
      }
    }
  }
  rows.push({
    id: 'G2.格心公式',
    ok: worst <= 0.5,
    detail: `15×11 最大误差 ${round(worst)}px（≤0.5）${worstAt ? ' · 最差点 ' + worstAt : ''}`,
  });
  return worst <= 0.5;
}

/* ---------------- G3 共边 ---------------- */

/** 尖顶六边形六个顶点：顶点朝上，θ = -90° + 60°k。 */
function corners(cx, cy, R) {
  const out = [];
  for (let k = 0; k < 6; k++) {
    const a = (-90 + 60 * k) * (Math.PI / 180);
    out.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
  }
  return out;
}

function g3() {
  // 邻居表：offset(odd-r) 坐标下**奇偶行的 (dc,dr) 集合本来就不同**
  // （奇数行是 (1,1)，偶数行是 (-1,1)），所以不能拿一张写死的 axial 表去比 ——
  // 那样量到的是"坐标写法"，不是"邻居对不对"。这里量三条真性质：
  //   ① 每格恰好 6 个邻居；② 每个邻居距离都是 1；③ 互为邻居（对称）。
  let nbOk = true;
  let nbDetail = '';
  for (const h of [
    { col: 7, row: 4 }, // 偶数行
    { col: 7, row: 5 }, // 奇数行
  ]) {
    const nbs = H.neighbors(h);
    const keys = new Set(nbs.map((n) => `${n.col},${n.row}`));
    const badDist = nbs.filter((n) => H.distance(h, n) !== 1);
    const badSym = nbs.filter((n) => !H.neighbors(n).some((x) => x.col === h.col && x.row === h.row));
    if (nbs.length !== 6 || keys.size !== 6 || badDist.length || badSym.length) {
      nbOk = false;
      nbDetail += ` (${h.col},${h.row}) 邻居 ${nbs.length} 个/去重 ${keys.size} 个，距离≠1 有 ${badDist.length} 个，不对称 ${badSym.length} 个;`;
    }
  }
  let worst = 0;
  let worstPair = '';
  let shared = 0;
  for (let r = 0; r < H.FIELD_H; r++) {
    for (let c = 0; c < H.FIELD_W; c++) {
      const ca = H.hexCenter({ col: c, row: r });
      const caPts = corners(ca.x, ca.y, REF.R);
      for (const nb of H.neighbors({ col: c, row: r })) {
        if (!H.inField(nb)) continue;
        // 只跑"右半边"的邻居，避免同一对算两遍
        if (nb.col < c || (nb.col === c && nb.row < r)) continue;
        const cb = H.hexCenter(nb);
        const cbPts = corners(cb.x, cb.y, REF.R);
        // 共享边 = 两组顶点里距离最小的两个配对
        let localWorst = Infinity;
        let matched = 0;
        for (const p of caPts) {
          let best = Infinity;
          for (const q of cbPts) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
          if (best < 1) matched++;
          localWorst = Math.min(localWorst, best);
        }
        if (matched >= 2) shared++;
        // 判据用"两个顶点都 <1px"：只量一个点的话，整列平移一格也能过
        if (matched < 2) {
          const d = localWorst;
          if (d > worst) {
            worst = d;
            worstPair = `(${c},${r})→(${nb.col},${nb.row}) 最近顶点差 ${round(d)}px`;
          }
        }
      }
    }
  }
  rows.push({
    id: 'G3.邻居表',
    ok: nbOk,
    detail: nbOk ? '奇偶行各 6 邻居 · 距离全为 1 · 互为邻居' : nbDetail,
  });
  rows.push({
    id: 'G3.共边',
    ok: worst < 1e-6 && shared > 0,
    detail: `共享边 ${shared} 对 · 最大顶点错位 ${round(worst)}px（判据 <1px）${worstPair ? ' · ' + worstPair : ''}`,
  });
  return nbOk && worst < 1e-6 && shared > 0;
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

const g1ok = g1();
const g2ok = g2();
const g3ok = g3();

for (const row of rows) {
  console.log(`${row.ok ? '  ✓' : '  ✗'} ${row.id.padEnd(20)} ${row.detail}`);
}

const pass = g1ok && g2ok && g3ok;

if (legacy) {
  if (pass) {
    console.log('\n[hexgeom] 负向对照**没红** —— 这套判据量不到旧几何，等于空闸。');
    process.exit(1);
  }
  console.log('\n[hexgeom] 负向对照如期变红（旧几何 22/38/33 被 G1/G2 抓到）。负向对照 PASS');
  process.exit(0);
}

console.log(
  `\n读数：R ${H.HEX_SIZE} · step ${H.HEX_STEP_X}×${H.HEX_STEP_Y} · 战场 ${round(H.FIELD_PX_W)}×${round(H.FIELD_PX_H)}`,
);
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
