// econ-check.mjs —— §27 的收入/账单/预算 与 G-E1·G-E2 的唯一算式来源
// 运行：node production/ui-redesign-2026-10-28/tools/econ-check.mjs
//
// 为什么要有这个脚本：§23.5 的三条路线花费是手算的，2026-10-29 复核时发现与
// buildings.ts 对不上（差 500~1,000）。规矩：**造价只从源码读，不在文档里手写**。
//
// 2026-10-29 深夜（§27 对齐 HOMM3）的第二条规矩：**收入也只在这里算**。
// 因为"城墙线产不产金"一改，§23.5 整张表的所有行都会动，手改一次必错一次。
//
// `--nomine`：决策 57 的负向分支 —— 家门前金矿被抢走（不补偿）。
//   这条不是假设，是"金矿是目标、不是基建"的直接后果：丢了它 G-E1 会掉到 0.80。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const src = fs.readFileSync(path.join(root, 'homm-web/src/core/data/buildings.ts'), 'utf8');

// ---------- 1) 建筑造价：从 buildings.ts 读 ----------
const costs = {};
for (const m of src.matchAll(/\n {2}(\w+): \{\n([\s\S]*?)\n {2}\},/g)) {
  const [, id, body] = m;
  const g = body.match(/cost:\s*\{([^}]*)\}/);
  if (!g) continue;
  const gold = g[1].match(/gold:\s*(\d+)/);
  costs[id] = gold ? Number(gold[1]) : 0;
}

// 计划中（尚未进代码）
const PLANNED = { banner: 1000 };

// ---------- 2) 收入：按 §27.3 定稿 ----------
// 城墙线：0 金/天（H3 事实：Fort / Citadel / Castle 全部零收入）
const INCOME = {
  base: 600,        // 决策 43（原 500）
  townhall: 450,    // 决策 43（原 250）
  mine: 400,        // 决策 43 家门前金矿
  wall1: 0,
  wall2: 0,
  wall3: 0,
};

// 参考日程（熟练玩家；用于算 5 周总预算）
//   day 1  开局：base 600
//   day 3  打下家门前金矿（+400）
//   day 10 建成议事堂（+450）
const DAYS = 35;
const MINE_DAY = 3;
const TOWNHALL_DAY = 10;
const NO_MINE = process.argv.includes('--nomine');

let budget = 0;
const dayIncome = [];
for (let d = 1; d <= DAYS; d++) {
  let inc = INCOME.base + INCOME.wall1 + INCOME.wall2 + INCOME.wall3;
  if (!NO_MINE && d >= MINE_DAY) inc += INCOME.mine;
  if (d >= TOWNHALL_DAY) inc += INCOME.townhall;
  dayIncome.push(inc);
  budget += inc;
}
const week = (w) => dayIncome.slice((w - 1) * 7, w * 7).reduce((a, b) => a + b, 0);

// 一般玩家对照（day 8 才夺矿、day 15 才建成议事堂）
let budgetSlow = 0;
for (let d = 1; d <= DAYS; d++) {
  let inc = INCOME.base;
  if (!NO_MINE && d >= 8) inc += INCOME.mine;
  if (d >= 15) inc += INCOME.townhall;
  budgetSlow += inc;
}

const groups = {
  酒馆: ['tavern'],
  经济线: ['market', 'townhall'],
  工坊: ['workshop'],
  兵营线: ['dwell1', 'dwell2', 'dwell3', 'dwell4', 'dwell5'],
  城防线: ['wall1', 'wall2', 'wall3'],
  魔法线: ['guild1', 'guild2', 'guild3'],
};
const sum = (ids) => ids.reduce((s, id) => s + (costs[id] ?? 0), 0);
const treeNow = sum(Object.keys(costs));
const tree = treeNow + PLANNED.banner;

const routeA = sum(['dwell1', 'dwell2', 'dwell3', 'dwell4', 'dwell5', 'market', 'townhall', 'wall1']) + PLANNED.banner;
const routeB = routeA + sum(['wall2', 'wall3']);
const routeC = routeB + sum(['guild1', 'guild2', 'guild3']);

// ---------- 3) 账单：§16.2 的周产 × 金币单价 ----------
// growth / cost / tier；banner = T3 ×1.5；wall2 +25% 全城、wall3 再 +25%（合计 +50%）
const ROSTER = {
  p1: [[16, 20, 1], [5, 110, 2], [4, 240, 3], [3, 520, 4], [2, 1500, 5]],
  p2: [[12, 30, 1], [5, 120, 2], [4, 230, 3], [3, 520, 4], [2, 1250, 5]],
  p3: [[10, 25, 1], [5, 115, 2], [4, 260, 3], [4, 540, 4], [2, 1100, 5]],
  p4: [[9, 25, 1], [5, 115, 2], [5, 250, 3], [5, 540, 4], [2, 800, 5]],
};

// tiers: 已解锁到第几档。walls: 0/1/2/3。banner: 是否已建
function bill(fam, { tiers = 5, walls = 0, banner = false } = {}) {
  const wallMult = 1 + (walls >= 2 ? 0.25 : 0) + (walls >= 3 ? 0.25 : 0);
  let total = 0;
  let byTier = {};
  for (const [g, cost, tier] of ROSTER[fam]) {
    if (tier > tiers) continue;
    let n = g * wallMult;
    if (banner && tier === 3) n *= 1.5;
    byTier[tier] = Math.round(n * cost);
    total += n * cost;
  }
  return { total: Math.round(total), byTier };
}

const pad = (s, n) => String(s).padEnd(n, ' ');
const fmt = (n) => n.toLocaleString('en-US');

if (NO_MINE) console.log('★ 负向分支：家门前金矿已丢失（决策 57：不补偿）\n');
console.log('=== 逐建筑（从 buildings.ts 读）===');for (const [g, ids] of Object.entries(groups)) {
  console.log(`${pad(g, 6)} ${pad(sum(ids), 7)}  ${ids.map((i) => `${i}=${costs[i] ?? '?'}`).join(' ')}`);
}
console.log(`${pad('计划', 6)} ${pad(PLANNED.banner, 7)}  banner（§23.4）`);
console.log(`\n全树（含 banner）：${fmt(tree)}`);

console.log('\n=== 收入（§27.3：城墙线 0）===');
console.log(`日收入：开局 ${INCOME.base} → 夺矿后 ${INCOME.base + INCOME.mine} → 建成议事堂后 ${INCOME.base + INCOME.mine + INCOME.townhall}`);
for (let w = 1; w <= 5; w++) console.log(`  W${w} ${fmt(week(w))}/周（${(week(w) / 7).toFixed(0)}/天）`);
console.log(`5 周预算（熟练：矿 day${MINE_DAY}、议事堂 day${TOWNHALL_DAY}）${fmt(budget)}`);
console.log(`5 周预算（一般：矿 day8、议事堂 day15）                ${fmt(budgetSlow)}`);
console.log(`G-E1  熟练 ${(budget / tree).toFixed(3)} ／ 一般 ${(budgetSlow / tree).toFixed(3)}`);

console.log('\n=== 周账单 / 周收入（p1；W5 收入取 10,150）===');
const phases = [
  ['W1 dwell1+2', { tiers: 2 }],
  ['W2 +dwell3', { tiers: 3 }],
  ['W3 +dwell4', { tiers: 4 }],
  ['W4 +主力营', { tiers: 4, banner: true }],
  ['W5 +dwell5', { tiers: 5, banner: true }],
  ['满建（+wall2/3，+50% 增长）', { tiers: 5, banner: true, walls: 3 }],
];
const incW = [week(1), week(2), week(3), week(4), week(5), week(5)];
phases.forEach(([name, opt], i) => {
  const b = bill('p1', opt);
  console.log(`  ${pad(name, 30)} 账单 ${pad(fmt(b.total), 6)}  收入 ${pad(fmt(incW[i]), 6)}  ${((b.total / incW[i]) * 100).toFixed(0)}%`);
});
const full = bill('p1', phases[5][1]);
const practical = full.byTier[3] + full.byTier[4] + full.byTier[5];
console.log(`  满建"实际支出"（只买 T3/T4/T5）${fmt(practical)} → ${((practical / week(5)) * 100).toFixed(0)}%`);

console.log('\n=== §27 三条路线 ===');
console.log(`A 兵营线+经济线+主力营   ${fmt(routeA)}  ${((routeA / budget) * 100).toFixed(0)}%`);
console.log(`B +城防线                ${fmt(routeB)}  ${((routeB / budget) * 100).toFixed(0)}%`);
console.log(`C +魔法线                ${fmt(routeC)}  ${((routeC / budget) * 100).toFixed(0)}%`);

console.log('\n=== 闸 ===');
const fail = [];
const r = budget / tree;
if (r < 1.0 || r > 1.2) fail.push(`G-E1 ${r.toFixed(3)} 不在 1.00~1.20`);
const w5 = bill('p1', phases[4][1]).total / week(5);
if (w5 < 0.55 || w5 > 0.75) fail.push(`G-E2 W5 账单占比 ${(w5 * 100).toFixed(0)}% 不在 55~75%`);
console.log(fail.length ? 'FAIL:\n  ' + fail.join('\n  ') : 'PASS（G-E1 / G-E2 绿）');
console.log(`负向对照：基础税回 850、城墙线恢复 100/200/400 ⇒ 预算约 ${fmt(Math.round(budget + 250 * 35 + 700 * 21))}，G-E1 约 ${((budget + 250 * 35 + 700 * 21) / tree).toFixed(2)}（必须 FAIL）`);
