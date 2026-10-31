/**
 * econ-check.mjs —— §27 的**执行版**（B0，2026-10-30）
 *
 * ## 为什么单独一个门
 * 2026-10-29 复核时发现：§23.5 / §27 的"全树造价"是**手算**的，与 `buildings.ts` 对不上，
 * 差过一次 500、一次 5,000。规矩就此定死：**造价只从源码累加，收入只在这里算**。
 * 城防线"产不产金"一改，整张表每一行都会动 —— 手改一次必错一次。
 *
 * ## 读什么
 * - `dist/core/data/buildings.js`：`BUILDINGS`（造价 / `dailyGold` / `growthBonus`）+ `BASE_TOWN_INCOME`
 * - `dist/core/data/mines.js`：`MINE_PER_DAY.gold`（家门前金矿 400/天）
 * - `dist/core/data/units.js`：`FACTION_UNITS` + `UNITS`（周产、单价）
 * **一个数都不硬抄**（`banner` 未实装时按 §23.4 的 1,000 预演，并显式打印"未实装"）。
 *
 * ## 五条闸
 * | 闸 | 判据 | 目标 |
 * |---|---|---|
 * | G-E1 | 5 周预算 ÷ 全树 ∈ [1.00, 1.20] | 1.125 / 1.021 |
 * | G-E2 | W5 账单 ÷ 周收入 ∈ [55%, 75%] | 68% |
 * | G-E3 | 城防线 `dailyGold` 合计 = 0 | 0（B2 之前是 700 ⇒ 红） |
 * | G-E4 | 满建名义账单 ÷ 收入 ≤ 110% | 102% |
 * | G-E5 | (预算 − 5 周招募) ÷ 全树 ∈ [0.65, 0.80] | 0.71 |
 *
 * ## 用法
 * ```
 * node tools/econ-check.mjs              # 正常
 * node tools/econ-check.mjs --nomine     # 决策 57：金矿丢了，不补偿
 * node tools/econ-check.mjs --nobanner   # 负向：全树少 1,000（40,800 → 39,800）
 * node tools/econ-check.mjs --tamper     # 自检：城墙恢复 100/200/400，G-E1 必须爆
 * ```
 * 退出码：`0` 全绿 · `1` 有闸红 · `2` 前置缺失
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { distDir, distUrl, printHeader, requireFile } from './_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=econ');
requireFile(DIST, 'core/data/buildings.js');
requireFile(DIST, 'core/data/units.js');
requireFile(DIST, 'core/data/mines.js');

const { BUILDINGS, BASE_TOWN_INCOME } = await import(distUrl('core/data/buildings.js', DIST));
const { UNITS, FACTION_UNITS } = await import(distUrl('core/data/units.js', DIST));
const { MINE_PER_DAY } = await import(distUrl('core/data/mines.js', DIST));

const NO_MINE = process.argv.includes('--nomine');
const NO_BANNER = process.argv.includes('--nobanner');
const TAMPER = process.argv.includes('--tamper');

/* ---------------- §27 的目标值（只用来对比，不参与计算） ---------------- */
const SPEC = {
  base: 600,
  townhall: 450,
  mine: 400,
  bannerCost: 1000,
  bannerT3: 1.5,
  wallGrowth: { wall2: 0.25, wall3: 0.25 },
  tree: 40800,
  budget: 45900,
  budgetSlow: 41650,
  G_E1: 1.125,
  G_E2: 0.68,
  G_E4: 1.02,
  G_E5: 0.71,
  recruit5w: 16830,
};
const DAYS = 35;
const MINE_DAY = 3;
const TOWNHALL_DAY = 10;
const FAM = ['p1', 'p2', 'p3', 'p4'];

const pad = (s, n) => String(s).padEnd(n, ' ');
const padl = (s, n) => String(s).padStart(n, ' ');
const fmt = (n) => Math.round(n).toLocaleString('en-US');

/* ---------------- 1) 建筑 ---------------- */
const ids = Object.keys(BUILDINGS);
const costOf = (id) => BUILDINGS[id]?.cost?.gold ?? 0;
const bannerPresent = Boolean(BUILDINGS.banner);
const bannerCost = bannerPresent ? costOf('banner') : SPEC.bannerCost;
const tree = ids.reduce((s, id) => s + costOf(id), 0) + (NO_BANNER ? 0 : bannerCost);
const wallDaily = ['wall1', 'wall2', 'wall3'].reduce((s, id) => s + (BUILDINGS[id]?.dailyGold ?? 0), 0);
const wallGrowth = ['wall1', 'wall2', 'wall3'].reduce((s, id) => s + (BUILDINGS[id]?.growthBonus ?? 0), 0);

console.log('=== 建筑（从 buildings.ts 读）===');
for (const id of ids) {
  const b = BUILDINGS[id];
  console.log(
    `  ${pad(id, 9)} 金 ${padl(costOf(id), 5)}  日金 ${padl(b.dailyGold ?? 0, 4)}  增长 +${((b.growthBonus ?? 0) * 100).toFixed(0)}%` +
      `${b.growth ? `  产 T${b.growth.tier}` : ''}`,
  );
}
console.log(
  `  全树 ${fmt(tree)}${NO_BANNER ? '（--nobanner：不含 banner）' : ''}` +
    `   §27 目标 ${fmt(SPEC.tree)}  ${tree === SPEC.tree ? '✓' : `Δ ${fmt(tree - SPEC.tree)}`}`,
);
console.log(
  `  banner：${bannerPresent ? '已实装' : `**未实装**（按 §23.4 的 ${SPEC.bannerCost} 预演）`}` +
    ` ｜ 城防线日金合计 ${wallDaily}（目标 0） ｜ 城防增长 +${(wallGrowth * 100).toFixed(0)}%（目标 +50%）`,
);
if (TAMPER) {
  console.log('\n  ★ --tamper：城墙额外产 700/天（负向对照；B2 之后应读到预算 70,400、G-E1 1.73）');
}

/* ---------------- 2) 收入 ---------------- */
const baseIncome = BASE_TOWN_INCOME;
const townhallIncome = BUILDINGS.townhall?.dailyGold ?? 0;
const mineIncome = MINE_PER_DAY.gold;
// --tamper：在**代码现值**之上再塞 700/天（§27.4 的负向对照"城墙恢复产金"）。
// B2 之后代码值是 0 ⇒ 这条正好读到 §27.4 记的预算 70,400 / G-E1 1.73。
const wallIncomeTotal = wallDaily + (TAMPER ? 700 : 0);

const dayIncome = [];
for (let d = 1; d <= DAYS; d++) {
  let inc = baseIncome + wallIncomeTotal;
  if (!NO_MINE && d >= MINE_DAY) inc += mineIncome;
  if (d >= TOWNHALL_DAY) inc += townhallIncome;
  dayIncome.push(inc);
}
const week = (w) => dayIncome.slice((w - 1) * 7, w * 7).reduce((a, b) => a + b, 0);
const budget = dayIncome.reduce((a, b) => a + b, 0);

// 一般档：day8 夺矿、day15 议事堂
let budgetSlow = 0;
for (let d = 1; d <= DAYS; d++) {
  let inc = baseIncome;
  if (!NO_MINE && d >= 8) inc += mineIncome;
  if (d >= 15) inc += townhallIncome;
  budgetSlow += inc;
}

console.log(`\n=== 收入（${NO_MINE ? '★ 金矿已丢失（决策 57：不补偿）' : `矿 day${MINE_DAY}、议事堂 day${TOWNHALL_DAY}`}）===`);
console.log(
  `  基础税 ${baseIncome}（目标 ${SPEC.base}${baseIncome === SPEC.base ? '' : ' ✗'}）` +
    ` ｜ 议事堂 ${townhallIncome}（目标 ${SPEC.townhall}${townhallIncome === SPEC.townhall ? '' : ' ✗'}）` +
    ` ｜ 金矿 ${mineIncome}（目标 ${SPEC.mine}${mineIncome === SPEC.mine ? '' : ' ✗'}）`,
);
for (let w = 1; w <= 5; w++) console.log(`  W${w} ${padl(fmt(week(w)), 6)}/周（${(week(w) / 7).toFixed(0)}/天）`);
console.log(
  `  5 周预算 熟练 ${fmt(budget)}（目标 ${fmt(SPEC.budget)}）／一般 ${fmt(budgetSlow)}（目标 ${fmt(SPEC.budgetSlow)}）`,
);

/* ---------------- 3) 账单 ---------------- */
const growthOf = (fam) => FACTION_UNITS[fam].map((id) => UNITS[id]);
// banner 未实装时按 §23.4 的 ×1.5 预演（上面已显式打印"未实装"，不是静默兜底）
const t3Bonus = SPEC.bannerT3;
const bannerOn = !NO_BANNER;

/** tiers = 已解锁到第几档；walls = 是否已建满（增长倍率另算）；banner = 是否已建主力营 */
function bill(fam, { tiers = 5, mult = 1, banner = false } = {}) {
  let total = 0;
  const byTier = {};
  for (const u of growthOf(fam)) {
    if (u.tier > tiers) continue;
    let n = u.growthPerWeek * mult;
    if (banner && u.tier === 3) n *= t3Bonus;
    byTier[u.tier] = Math.round(n * (u.cost.gold ?? 0));
    total += n * (u.cost.gold ?? 0);
  }
  return { total: Math.round(total), byTier };
}

// 阶段：W1 T1-2 / W2 +T3 / W3 +T4 / W4 +主力营（T5 尚未出货）/ W5 全开
const PHASES = [
  ['W1 dwell1+2', { tiers: 2 }],
  ['W2 +dwell3', { tiers: 3 }],
  ['W3 +dwell4', { tiers: 4 }],
  ['W4 +主力营', { tiers: 4, banner: bannerOn }],
  ['W5 全开（T5 起售）', { tiers: 5, banner: bannerOn }],
  ['满建（+50% 增长）', { tiers: 5, banner: bannerOn, mult: 1 + wallGrowth }],
];
const SPEC_BILL = [870, 1830, 3390, 3870, 6870, 10305];
const SPEC_BILL_PRACTICAL = 9000;

console.log(`\n=== p1 周账单（增长倍率 ${(PHASES[4].mult ?? 1).toFixed(2)}×，含主力营 T3×${t3Bonus}）===`);
console.log(`  ${pad('阶段', 22)}${pad('账单(代码)', 10)}${pad('§27.5', 9)}${pad('周收入', 9)}占比`);
PHASES.forEach(([name, opt], i) => {
  const b = bill('p1', opt);
  const inc = week(Math.min(i + 1, 5));
  console.log(
    `  ${pad(name, 22)}${pad(fmt(b.total), 10)}${pad(fmt(SPEC_BILL[i]), 9)}${pad(fmt(inc), 9)}${((b.total / inc) * 100).toFixed(0)}%`,
  );
});

/* 存量表（零英雄基线；建造按 §27.5 的日程，招募按上表的账单） */
const BUILD_PLAN = [
  ['W1', ['dwell1', 'dwell2']],
  ['W2', ['townhall', 'dwell3', 'wall1']],
  ['W3', ['dwell4']],
  ['W4', ['dwell5']],
  ['W5', []],
];
console.log('\n=== 存量（零英雄基线）===');
console.log(`  ${pad('周', 4)}${pad('期初', 8)}${pad('+收入', 8)}${pad('−建造', 8)}${pad('−招募', 8)}期末`);
let cash = 0;
const recruitWeeks = [];
for (let i = 0; i < 5; i++) {
  const b = bill('p1', PHASES[i][1]);
  const build = BUILD_PLAN[i][1].reduce((s, id) => s + costOf(id), 0);
  const inc = week(i + 1);
  const end = cash + inc - build - b.total;
  recruitWeeks.push(b.total);
  console.log(
    `  ${pad(BUILD_PLAN[i][0], 4)}${padl(fmt(cash), 7)}${padl(fmt(inc), 8)}${padl(fmt(build), 8)}${padl(fmt(b.total), 8)}${padl(fmt(end), 8)}`,
  );
  cash = end;
}
const recruit5w = recruitWeeks.reduce((a, b) => a + b, 0);
const built5w = BUILD_PLAN.flatMap((p) => p[1]).reduce((s, id) => s + costOf(id), 0);
console.log(
  `  五周建掉 ${fmt(built5w)}，期末现金 ${fmt(cash)} ⇒ (${fmt(built5w)} + ${fmt(cash)}) ÷ ${fmt(tree)} = ` +
    `${((built5w + cash) / tree).toFixed(2)}（G-E5 的另一种读法，§27.5 结论 2）`,
);

/* ---------------- 4) 闸 ---------------- */
const verdict = [];
const chk = (name, ok, detail) => verdict.push({ name, ok, detail });

const gE1 = budget / tree;
chk('G-E1 预算 ÷ 全树 ∈[1.00,1.20]', gE1 >= 1.0 && gE1 <= 1.2, `${gE1.toFixed(3)}（目标 ${SPEC.G_E1}）`);

const w5 = bill('p1', PHASES[4][1]).total / week(5);
chk('G-E2 W5 账单占比 ∈[55%,75%]', w5 >= 0.55 && w5 <= 0.75, `${(w5 * 100).toFixed(0)}%（目标 68%）`);

chk('G-E3 城防线日金合计 = 0', wallDaily === 0, `${wallDaily}${wallDaily ? '（B2 之前为 700，红是预期的）' : ''}`);

const fullBill = bill('p1', PHASES[5][1]).total;
const gE4 = fullBill / week(5);
chk('G-E4 满建名义账单 ≤110%', gE4 <= 1.1, `${(gE4 * 100).toFixed(0)}%（目标 102%）`);

const gE5 = (budget - recruit5w) / tree;
chk('G-E5 (预算−招募) ÷ 全树 ∈[0.65,0.80]', gE5 >= 0.65 && gE5 <= 0.8, `${gE5.toFixed(3)}（目标 ${SPEC.G_E5}）`);

console.log('\n=== 闸 ===');
for (const v of verdict) console.log(`  ${v.ok ? '✓' : '✗'} ${pad(v.name, 26)} ${v.detail}`);

const practical = [3, 4, 5].reduce((s, t) => s + bill('p1', PHASES[5][1]).byTier[t], 0);
console.log(
  `\n  满建"实际支出"（只买 T3/T4/T5）${fmt(practical)} → ${((practical / week(5)) * 100).toFixed(0)}%` +
    `（§27.5 目标 89%）`,
);
console.log(`  5 周招募合计（代码）${fmt(recruit5w)}（§27.5 目标 ${fmt(SPEC.recruit5w)}）`);

/* 两条负向对照 */
if (NO_MINE) {
  const specBudget = 32700;
  console.log(
    `\n  负向（--nomine）：预算 ${fmt(budget)}（§27.4 目标 ${fmt(specBudget)}）⇒ G-E1 ${gE1.toFixed(3)}` +
      `（目标 0.801）、G-E2 ${(w5 * 100).toFixed(0)}%（目标 93%）`,
  );
}
if (NO_BANNER) console.log(`\n  负向（--nobanner）：全树 ${fmt(tree)}（40,800 → 39,800）⇒ G-E1 ${gE1.toFixed(3)}（目标 1.153）`);

/* ---------- 5) --json=<file>：与 balance 写进同一份基线 ---------- */
const jsonArg = process.argv.find((x) => x.startsWith('--json='));
if (jsonArg) {
  const out = jsonArg.slice('--json='.length);
  let cur = {};
  if (existsSync(out)) {
    try {
      cur = JSON.parse(readFileSync(out, 'utf8'));
    } catch {
      cur = {};
    }
  }
  cur.econ = {
    dist: DIST,
    noMine: NO_MINE,
    noBanner: NO_BANNER,
    buildings: Object.fromEntries(
      ids.map((id) => [
        id,
        { gold: costOf(id), dailyGold: BUILDINGS[id].dailyGold ?? 0, growthBonus: BUILDINGS[id].growthBonus ?? 0, growth: BUILDINGS[id].growth ?? null },
      ]),
    ),
    bannerPresent,
    tree,
    income: { base: baseIncome, townhall: townhallIncome, mine: mineIncome, wallDaily },
    weeks: [1, 2, 3, 4, 5].map((w) => week(w)),
    budget,
    budgetSlow,
    bills: Object.fromEntries(PHASES.map(([name, opt], i) => [name, bill('p1', opt).total])),
    recruit5w,
    cashEnd: Math.round(cash),
    gates: verdict.map((v) => ({ ...v, detail: v.detail })),
  };
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out, JSON.stringify(cur, null, 2) + '\n');
  console.log(`\n  基线已写入 ${out}（section: econ）`);
}

const failed = verdict.filter((v) => !v.ok);
console.log('\n=== 汇总 ===');
console.log(`  闸红 ${failed.length}/${verdict.length}`);
console.log(failed.length ? 'FAIL' : 'PASS');
process.exit(failed.length ? 1 : 0);
