/**
 * balance-p2.mjs —— §16.2 数值表的**执行版**（B0，2026-10-30）
 *
 * ## 它回答什么问题
 * `audit:power`（`tools/powerref.mjs`）证明的是「**公式**能复现文档里的 20 个数」——
 * 但那 20 组攻防血是**硬抄在脚本里**的，所以它证明不了「`units.ts` 里装的就是这 20 个兵」。
 * 本脚本把另一半补上：**从构建产物里读真实兵种**，与 §16.2 的目标表逐行对差。
 *
 * ## 三条口径（别改）
 * ① **不硬抄代码值**：20 行全部来自 `dist/core/data/units.js` 的 `UNITS` + `FACTION_UNITS`。
 *    （读 `dist` 而不是 `src`：门要验的是**会跑的那份**，与其余 30 门的 `_dist.mjs` 口径一致。）
 * ② **不重写公式**：`powerRef()` / `attackMultiplier()` / `defenseMultiplier()` 一律
 *    `import` 自 `dist/core/combat/damage.js`。脚本里只有 `--a` 的 A 口径是本地函数 ——
 *    它是**负向对照**，不是生产公式，允许重复一次（并且必须读出 小孩 4.5）。
 * ③ **表值来自规格**：`TARGET` 就是 §16.2 那张表。规格改了就改这里，**两边只留一份差**。
 * ④ **V4 不在本文件**（M7 · D1，2026-11-13 重登记）：它已从「名义每金」改成
 *    「**T5 采购滞后（天）**」，执行版是 `tools/probes/t5lag.mjs`（`probe:t5lag`）。
 *    原因：`cost.gold` 不是任何人付的价（p3 宝石 / p4 水晶按 `MARKET_RATES` 折是名义的 2.5~5 倍）。
 *    旧 V4 读 25.5% 全绿的那批数据里，紫晶的采购滞后中位是 **10 天**（新价 2~3 天）。
 *    本文件仍打印每金，但只是**读数**。
 *
 * ## 退出码
 * `0` 全过 · `1` 有 Δ>2% 或某条闸红 · `2` 前置缺失（`dist` 没构建）
 *
 * ## 用法
 * ```
 * node tools/balance-p2.mjs              # B 口径（正式）
 * node tools/balance-p2.mjs --a          # A 口径负向对照（T1 单只必须读 78%）
 * node tools/balance-p2.mjs --upgrades   # 20 个 _u 形态的封顶闸
 * node tools/balance-p2.mjs --tamper     # 自检：故意把 p1 T5 血量 ×1.3，必须变红
 * ```
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { distDir, distUrl, printHeader, requireFile } from './_dist.mjs';

const DIST = distDir();
const DIST_FP = printHeader(DIST, 'gate=balance');
requireFile(DIST, 'core/data/units.js');
requireFile(DIST, 'core/combat/damage.js');

const { powerRef } = await import(distUrl('core/combat/damage.js', DIST));
const { UNITS, FACTION_UNITS } = await import(distUrl('core/data/units.js', DIST));

const CALIBER = process.argv.includes('--a') ? 'A' : 'B';
const TAMPER = process.argv.includes('--tamper');
const WANT_UPGRADES = process.argv.includes('--upgrades');

/**
 * A 口径（两端都夹到 1）—— **只为负向对照存在**。
 * 生产公式在 `damage.ts`，读的是 B 口径；这里重复一次的是"错误的那一版"，
 * 目的是让"有人把 1 的夹子加回来"这件事在读数上显形（小孩 3.3 → 4.5）。
 */
const atkA = (a) => Math.min(Math.max(1 + 0.05 * (a - 5), 1), 4);
const defA = (d) => Math.min(Math.max(1 - 0.025 * (d - 5), 0.3), 1);
const ruler = (u) =>
  CALIBER === 'A'
    ? (((u.damageMin + u.damageMax) / 2) * u.hp * atkA(u.attack)) / defA(u.defense)
    : powerRef(u);

/* ------------------------------------------------------------------ *
 * §16.2 目标表（20 行）
 * 字段顺序：族 档 兵 攻 防 伤低 伤高 HP 速 弹 周产 金 木 矿 远程
 * ------------------------------------------------------------------ */
const TARGET = [
  ['p1', 1, '小孩', 1, 1, 1, 2, 3, 2, 0, 16, 20, 0, 0, false],
  ['p1', 2, '弩手', 4, 2, 2, 4, 10, 4, 14, 5, 110, 0, 0, true],
  ['p1', 3, '鹰', 6, 3, 4, 6, 14, 9, 0, 4, 240, 0, 0, false],
  ['p1', 4, '骑士', 7, 8, 7, 9, 36, 7, 0, 3, 520, 0, 3, false],
  ['p1', 5, '天使', 10, 10, 13, 17, 65, 8, 0, 2, 1500, 5, 5, false],
  ['p2', 1, '火柴人', 2, 1, 1, 3, 3, 4, 8, 12, 30, 0, 0, true],
  ['p2', 2, '铜人', 3, 9, 2, 3, 15, 2, 0, 5, 120, 2, 0, false],
  ['p2', 3, '三头狼', 7, 3, 3, 8, 13, 7, 0, 4, 230, 0, 0, false],
  ['p2', 4, '熔岩巨人', 9, 7, 6, 9, 34, 4, 0, 3, 520, 0, 4, false],
  ['p2', 5, '恶魔', 12, 7, 14, 18, 55, 9, 0, 2, 1250, 0, 5, false],
  ['p3', 1, '矮人', 2, 3, 1, 2, 5, 3, 0, 10, 25, 0, 0, false],
  ['p3', 2, '丛林射手', 4, 3, 2, 3, 11, 4, 16, 5, 115, 0, 0, true],
  ['p3', 3, '树人', 4, 10, 3, 5, 20, 2, 0, 4, 260, 3, 0, false],
  ['p3', 4, '猿人', 8, 4, 7, 10, 30, 5, 10, 4, 540, 2, 0, true],
  ['p3', 5, '绿龙', 11, 9, 11, 15, 62, 7, 0, 2, 1100, 5, 0, false],
  ['p4', 1, '骷髅', 2, 1, 1, 3, 4, 4, 0, 9, 25, 0, 0, false],
  ['p4', 2, '僵尸', 2, 8, 2, 3, 15, 2, 0, 5, 115, 0, 0, false],
  ['p4', 3, '吸血鬼', 7, 4, 3, 6, 15, 8, 0, 5, 250, 0, 0, false],
  ['p4', 4, '牛头怪', 9, 6, 7, 10, 30, 6, 10, 5, 540, 0, 3, true],
  ['p4', 5, '摄魂怪', 10, 8, 10, 13, 60, 9, 0, 2, 800, 0, 0, false],
];
const asUnit = (r) => ({
  attack: r[3],
  defense: r[4],
  damageMin: r[5],
  damageMax: r[6],
  hp: r[7],
  speed: r[8],
  shots: r[9],
  growthPerWeek: r[10],
  gold: r[11],
  remote: r[14],
});

/** §16.2 表里印出来的战力（用来验 `powerRef()` 本身没漂） */
const PRINTED_POWER = [
  3.3, 26.5, 70.0, 342.5, 1392.9,
  4.6, 37.5, 74.9, 322.1, 1250.5,
  6.1, 24.9, 86.9, 286.1, 1164.2,
  6.2, 34.5, 72.4, 313.8, 932.4,
];
/** §25.3 表里印出来的 aiValue */
const PRINTED_AIVALUE = [
  3, 33, 70, 342, 1393,
  6, 38, 75, 322, 1251,
  6, 31, 87, 358, 1164,
  6, 34, 72, 392, 932,
];

const FAM = ['p1', 'p2', 'p3', 'p4'];
const REMOTE_K = 1.25;
const T3_BANNER = 1.5; // 主力营：本族 T3 周产 ×1.5（决策 42）

const spread = (a) => (Math.max(...a) / Math.min(...a) - 1) * 100;
const pad = (s, n) => String(s).padEnd(n, ' ');
const padl = (s, n) => String(s).padStart(n, ' ');
const n1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const pct = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;

/* ---------- 1) 把代码侧的 20 行取出来 ---------- */
const rows = TARGET.map((r, i) => {
  const [fam, tier, tname] = r;
  const id = FACTION_UNITS[fam]?.[tier - 1];
  const code = id ? UNITS[id] : undefined;
  const t = asUnit(r);
  const tPower = ruler(t);
  const cPower = code ? ruler(code) : NaN;
  const gold = code ? (code.cost?.gold ?? 0) : NaN;
  const growth = code ? code.growthPerWeek : NaN;
  return {
    idx: i,
    fam,
    tier,
    tname,
    id: id ?? '(缺)',
    t,
    code,
    tPower,
    cPower,
    printed: PRINTED_POWER[i],
    printedAi: PRINTED_AIVALUE[i],
    gold,
    growth,
    // 代码侧的"总值"：战力 × 周产（V1 读它）
    weekly: code ? cPower * growth : NaN,
    tWeekly: tPower * t.growthPerWeek,
  };
});

/* ---------- 2) 逐字段差异（这就是 B1 的工单） ---------- */
/** §16.2 的造价列里带资源（"520 金 3 矿"）。键用「族 T档」，不用 id（B1 前后 id 会变） */
const TARGET_RES = {
  'p1 T4': { ore: 3 },
  'p1 T5': { wood: 5, ore: 5 },
  'p2 T2': { wood: 2 },
  'p2 T4': { ore: 4 },
  'p2 T5': { ore: 5 },
  'p3 T3': { wood: 3 },
  'p3 T4': { wood: 2 },
  'p3 T5': { gem: 2, wood: 5 },
  'p4 T3': { crystal: 1 },
  'p4 T4': { ore: 3 },
  'p4 T5': { crystal: 4 },
};

const diffs = [];
for (const r of rows) {
  if (!r.code) {
    diffs.push(`${r.fam} T${r.tier} ${r.id} —— **代码里没有这一档**`);
    continue;
  }
  const res = TARGET_RES[`${r.fam} T${r.tier}`] ?? {};
  const want = [
    ['攻', r.t.attack, r.code.attack],
    ['防', r.t.defense, r.code.defense],
    ['伤低', r.t.damageMin, r.code.damageMin],
    ['伤高', r.t.damageMax, r.code.damageMax],
    ['HP', r.t.hp, r.code.hp],
    ['速', r.t.speed, r.code.speed],
    ['弹', r.t.shots, r.code.shots ?? 0],
    ['周产', r.t.growthPerWeek, r.code.growthPerWeek],
    ['金', r.t.gold, r.code.cost?.gold ?? 0],
    ['木', res.wood ?? 0, r.code.cost?.wood ?? 0],
    ['矿', res.ore ?? 0, r.code.cost?.ore ?? 0],
    ['宝石', res.gem ?? 0, r.code.cost?.gem ?? 0],
    ['水晶', res.crystal ?? 0, r.code.cost?.crystal ?? 0],
  ];
  const bad = want.filter(([, w, g]) => w !== g).map(([label, w, g]) => `${label} ${w}→${g}`);
  if (bad.length) diffs.push(`${r.fam} T${r.tier} ${pad(r.id, 14)} ${r.tname}: ${bad.join(' · ')}`);
}

/* ---------- 3) 打印 ---------- */
console.log(`=== 口径 ${CALIBER}${TAMPER ? ' · TAMPER（p1 T5 血量 ×1.3，用来验闸会红）' : ''} ===\n`);
const weeklyOf = () => FAM.map((f) => rows.filter((r) => r.fam === f).reduce((s, r) => s + r.weekly, 0));
let preTamperV1 = null;
if (TAMPER) {
  preTamperV1 = spread(weeklyOf());
  const t5 = rows.find((r) => r.fam === 'p1' && r.tier === 5);
  t5.cPower = ruler({ ...t5.code, hp: t5.code.hp * 1.3 });
  t5.weekly = t5.cPower * t5.growth;
}

console.log('单兵战力：表值 vs 代码');
console.log(`  ${pad('族/档', 7)}${pad('兵', 12)}${pad('表值', 9)}${pad('代码', 9)}${pad('Δ', 9)}${pad('aiValue(码)', 12)}`);
for (const r of rows) {
  const d = ((r.cPower - r.tPower) / r.tPower) * 100;
  const bad = Math.abs(d) > 2;
  const ai = r.code?.aiValue;
  console.log(
    `  ${pad(`${r.fam} T${r.tier}`, 7)}${pad(r.tname, 12)}${pad(n1(r.tPower), 9)}${pad(n1(r.cPower), 9)}` +
      `${pad(bad ? `✗${pct(d)}` : pct(d), 9)}${pad(Number.isFinite(ai) ? ai.toFixed(1) : 'undefined', 12)}`,
  );
}

const printPowDrift = Math.max(...rows.map((r) => Math.abs((r.tPower - r.printed) / r.printed) * 100));
if (CALIBER === 'B') {
  console.log(`\n  §16.2 印出的战力 vs 公式复算：最大差 ${printPowDrift.toFixed(2)}%（容差 2%）`);
} else {
  // A 口径下"表值"整列都要重算 —— 这一行只是提醒别把 A 的读数当 §16.2
  console.log('\n  ※ A 口径：上表"表值"列同样按 A 重算，**不是 §16.2 的原值**（负向对照专用）');
}

if (TAMPER) {
  const nowV1 = spread(weeklyOf());
  console.log(
    `\n  ★ 自检（--tamper）：把 p1 T5 血量 ×1.3 ⇒ V1 从 ${preTamperV1.toFixed(1)}% 变成 ${nowV1.toFixed(1)}%` +
      `${nowV1 > preTamperV1 ? '（闸响应正常）' : '（✗ 闸没响应 —— 读数链路断了）'}`,
  );
}

console.log('\n=== 逐字段差异（B1 的工单：只列不一致的行）===');
if (!diffs.length) console.log('  （无）代码与 §16.2 逐字段一致');
else for (const d of diffs) console.log('  ' + d);

/* ---------- 4) 五条数值闸（全部读**代码**，不读表） ---------- */
const byTier = (t) => rows.filter((r) => r.tier === t);
const famWeekly = FAM.map((f) => rows.filter((r) => r.fam === f).reduce((s, r) => s + r.weekly, 0));
const famBill = FAM.map((f) =>
  rows
    .filter((r) => r.fam === f)
    .reduce((s, r) => s + (r.gold * (r.tier === 3 ? r.growth * T3_BANNER : r.growth)), 0),
);
const famAi = FAM.map((f) =>
  rows.filter((r) => r.fam === f).reduce((s, r) => s + (Number.isFinite(r.code?.aiValue) ? r.code.aiValue : r.cPower * (r.t.remote ? REMOTE_K : 1)) * r.growth, 0),
);
const t1Weekly = FAM.map((f) => rows.find((r) => r.fam === f && r.tier === 1).weekly);
// T1 单只极差按**表值**算：这是决策 49 的负向对照（B 88.9% / A 78%），不是代码读数
const t1Single = FAM.map((f) => rows.find((r) => r.fam === f && r.tier === 1).tPower);
const t1Ai = FAM.map((f) => {
  const r = rows.find((x) => x.fam === f && x.tier === 1);
  return (Number.isFinite(r.code?.aiValue) ? r.code.aiValue : r.cPower * (r.t.remote ? REMOTE_K : 1)) * r.growth;
});
const t5 = byTier(5);
const t5Power = t5.map((r) => r.cPower);
const t5PerGold = t5.map((r) => r.cPower / r.gold);

console.log('\n=== 族级读数（读代码）===');
FAM.forEach((f, i) =>
  console.log(
    `  ${f}  周产战力 ${padl(n1(famWeekly[i]), 7)}  aiValue ${padl(n1(famAi[i]), 7)}  周账单 ${padl(Math.round(famBill[i]), 6)}  战力/账单 ${(famWeekly[i] / famBill[i]).toFixed(3)}`,
  ),
);
console.log(`  战力极差 ${spread(famWeekly).toFixed(1)}%（目标 6.8%）  账单极差 ${spread(famBill).toFixed(1)}%（目标 9.0%）  aiValue 极差 ${spread(famAi).toFixed(1)}%（目标 9.8%）`);
const t1SingleSpread = spread(t1Single);
const wantT1 = CALIBER === 'B' ? 88.9 : 78.0;
const t1ok = Math.abs(t1SingleSpread - wantT1) <= 3;
console.log(
  `  T1 单只战力（表值）${t1Single.map(n1).join(' / ')} 极差 ${t1SingleSpread.toFixed(1)}%  ` +
    `${t1ok ? '✓' : '✗'} 应读 ${wantT1}%（决策 49 的负向对照：A 会把它压到 78%）`,
);
console.log(`  T1 周产战力 ${t1Weekly.map((x) => x.toFixed(1)).join(' / ')} 极差 ${spread(t1Weekly).toFixed(1)}%（目标 15.5%）`);
console.log(`  T1 周产 aiValue ${t1Ai.map((x) => x.toFixed(1)).join(' / ')} 极差 ${spread(t1Ai).toFixed(1)}%（目标 30.7%）`);
console.log(`  T5 战力 ${t5Power.map(n1).join(' / ')} 极差 ${((Math.max(...t5Power) / Math.min(...t5Power) - 1) * 100).toFixed(1)}%（目标 49.4% = 1.49×）`);
console.log(
  `  T5 每金 ${t5PerGold.map((x) => x.toFixed(3)).join(' / ')} 极差 ${spread(t5PerGold).toFixed(1)}%` +
    `（**读数**，判据已改成采购滞后：\`probe:t5lag\`）`,
);

const verdict = [];
const chk = (name, ok, detail) => verdict.push({ name, ok, detail });

chk('V1 族级周产战力极差 ≤8%', spread(famWeekly) <= 8, `${spread(famWeekly).toFixed(1)}%`);
chk('V2 周账单极差 ≤12%', spread(famBill) <= 12, `${spread(famBill).toFixed(1)}%`);
const v3 = Math.max(...t5Power) / Math.min(...t5Power);
chk('V3 T5 战力极差 ∈[1.40,1.60]×', v3 >= 1.4 && v3 <= 1.6, `${v3.toFixed(2)}×`);
/* V4 不在这里：它已改成「T5 采购滞后（天）」，执行版是 `probe:t5lag`（见文件头 ④）。 */
const v5a = spread(t1Weekly) <= 30;
const t2 = byTier(2);
const t2m = t2.filter((r) => !r.t.remote).map((r) => r.cPower);
const t2r = t2.filter((r) => r.t.remote).map((r) => r.cPower);
chk('V5 同档（T1 周产 ≤30%）', v5a, `${spread(t1Weekly).toFixed(1)}%`);
chk(`V5 口径 T1 单只应读 ${wantT1}%`, t1ok, `${t1SingleSpread.toFixed(1)}%`);
chk('V5 同档（T2 近战 ≤10%）', spread(t2m) <= 10, `${spread(t2m).toFixed(1)}%`);
chk('V5 同档（T2 远程 ≤10%）', spread(t2r) <= 10, `${spread(t2r).toFixed(1)}%`);
chk('V5 同档（T3 ≤40%）', spread(byTier(3).map((r) => r.cPower)) <= 40, `${spread(byTier(3).map((r) => r.cPower)).toFixed(1)}%`);
chk('V5 同档（T4 ≤40%）', spread(byTier(4).map((r) => r.cPower)) <= 40, `${spread(byTier(4).map((r) => r.cPower)).toFixed(1)}%`);
const hasAi = rows.every((r) => Number.isFinite(r.code?.aiValue));
if (hasAi) {
  chk('V6 族级 aiValue 极差 ≤12%', spread(famAi) <= 12, `${spread(famAi).toFixed(1)}%`);
  chk('V6 T1 aiValue 极差 ≤40%', spread(t1Ai) <= 40, `${spread(t1Ai).toFixed(1)}%`);
  // §25.3 印出的 20 个 aiValue 必须与代码一致（容差 ±2% 或 ±1，取宽）
  const aiBad = rows.filter((r) => Math.abs(r.code.aiValue - r.printedAi) > Math.max(1, r.printedAi * 0.02));
  chk('V6 aiValue 与 §25.3 一致', aiBad.length === 0, aiBad.length ? `${aiBad.length} 行不符` : '20/20');
}

console.log('\n=== 闸（读代码，不读表）===');
for (const v of verdict) console.log(`  ${v.ok ? '✓' : '✗'} ${pad(v.name, 30)} ${v.detail}`);
if (!hasAi) console.log('  · V6 跳过：`aiValue` 字段尚未装载（B1 之前是预期的，不是失败）');

/* ---------- 5) --upgrades：20 个 _u 形态的封顶闸 ---------- */
let upFail = 0;
if (WANT_UPGRADES) {
  console.log('\n=== 升级形态封顶闸（§2.5：powerRef(_u) ≤ 同族下一档 × 0.9）===');
  for (const f of FAM) {
    for (let t = 1; t <= 4; t++) {
      const base = rows.find((r) => r.fam === f && r.tier === t);
      const next = rows.find((r) => r.fam === f && r.tier === t + 1);
      if (!base?.code || !next?.code) continue;
      const uu = {
        attack: base.code.attack + 1,
        defense: base.code.defense + 1,
        damageMin: base.code.damageMin,
        damageMax: base.code.damageMax + 1,
        hp: Math.ceil(base.code.hp * 1.25),
      };
      const p = ruler(uu);
      const cap = ruler(next.code) * 0.9;
      const ok = p <= cap;
      if (!ok) upFail += 1;
      console.log(
        `  ${ok ? '✓' : '✗'} ${pad(`${f} T${t}→${t + 1}`, 10)} ${pad(base.tname, 12)} ${padl(n1(p), 7)} ≤ ${padl(n1(cap), 7)}  ${((p / cap) * 100).toFixed(1)}%`,
      );
      void next;
    }
  }
}

/* ---------- 6) 汇总 ---------- */
/* ---------- 7) --json=<file>：基线存档（M0 的交付物） ---------- */
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
  cur.balance = {
    caliber: CALIBER,
    dist: DIST,
    distMd5: DIST_FP.md5,
    printedPowerDriftPct: Number(printPowDrift.toFixed(2)),
    rows: rows.map((r) => ({
      fam: r.fam,
      tier: r.tier,
      id: r.id,
      name: r.tname,
      target: r.t,
      code: r.code
        ? {
            attack: r.code.attack,
            defense: r.code.defense,
            damageMin: r.code.damageMin,
            damageMax: r.code.damageMax,
            hp: r.code.hp,
            speed: r.code.speed,
            shots: r.code.shots ?? 0,
            growthPerWeek: r.code.growthPerWeek,
            cost: r.code.cost,
            aiValue: r.code.aiValue ?? null,
          }
        : null,
      targetPower: Number(r.tPower.toFixed(2)),
      codePower: Number(r.cPower.toFixed(2)),
      weeklyCode: Number(r.weekly.toFixed(1)),
      deltaPct: Number((((r.cPower - r.tPower) / r.tPower) * 100).toFixed(1)),
    })),
    family: Object.fromEntries(
      FAM.map((f, i) => [f, { weeklyPower: Number(famWeekly[i].toFixed(1)), weeklyBill: Math.round(famBill[i]), weeklyAi: Number(famAi[i].toFixed(1)) }]),
    ),
    gates: verdict,
  };
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out, JSON.stringify(cur, null, 2) + '\n');
  console.log(`\n  基线已写入 ${out}（section: balance）`);
}

const badPower = rows.filter((r) => !(Math.abs((r.cPower - r.tPower) / r.tPower) <= 0.02));
const failed = verdict.filter((v) => !v.ok);
const exitCode = badPower.length || failed.length || upFail || printPowDrift > 2 ? 1 : 0;

console.log('\n=== 汇总 ===');
console.log(`  战力差 >2%：${badPower.length}/20 行 ｜ 闸红：${failed.length} 条${WANT_UPGRADES ? ` ｜ 升级越界：${upFail} 个` : ''}`);
if (badPower.length) {
  console.log('  ✗ 20 行还没装进代码 —— 这就是 B1 的工单（M0 的通过标准是"差异可见"，不是"全绿"）');
}
console.log(exitCode ? 'FAIL' : 'PASS');
process.exit(exitCode);
