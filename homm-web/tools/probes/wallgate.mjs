/**
 * 守方闸（B3b / 决策 61）：**建墙不能变弱**，以及"墙值多少"。
 *
 * ## 为什么需要这个探针
 * 塔数曲线是 0/1/3（L1 木栅**一个射手都没有**）。如果城墙还双向挡视线，
 * 建 `wall1` 之后守方的弓手被自己的墙封住、攻方只多等两轮 —— 建墙反而更弱，
 * 与「城防线卖防御」的文案直接相反。决策 61 把 `blocksLine` 改成**单向**
 * （只挡城外 → 城内），这个洞才消失。
 *
 * 本探针是这条规则唯一的机检，也是 B3b 定价的依据：
 *   同一份守军 + 同一个攻方种子批，比较 **不建墙 / wall1 / wall2 / wall3**。
 *
 * ## 两个读数（分开看，别混）
 *   [1] **破城门槛**：攻方要带多少倍于守军的兵力，才能把胜率打到 50%。
 *       → 回答"墙值多少"（定价与 AI 判据的输入）。这一列不会截断，是定价要用的那个数。
 *   [2] **守方胜率**：在"不建墙时正好五五开"的攻方兵力上，四档城防各自的守方胜率。
 *       → 回答"墙有没有用"（决策 61 的验收）。**这一列会被天花板截断**（守方 100% 就量不出更多）。
 *
 * ## 判据（[G1]–[G7] + [W1]–[W4]）
 *   [G1] 结构：墙完好时 `blocksLine(城外→城内)` = true，`blocksLine(城内→城外)` = false。
 *        （负向对照的锚：改回双向 ⇒ 这一条立刻红）
 *   [G2] 校准有效：每族都要找到"不建墙守方胜率 30%~70%"的攻方倍率，否则量不到对象。
 *        （只排除天花板/地板，**不要求正好 50%**：胜负是台阶曲线，多 1 个兵就掉 25pt。）
 *   [G3] 守方闸：同一倍率下 `wall1` 的守方胜率 **≥ 不建墙**（决策 61 的全部要求）。
 *   [G4] 层级不倒退：`wall2` / `wall3` 的守方胜率 ≥ `wall1` − 3pt（噪声容差）。
 *   [G5] 破城门槛单调：L1 ≤ L2 ≤ L3（+5% 容差）—— 更贵的墙必须更难攻。
 *   [G6] 门槛不失控：L1 的所需优势 ≤ +30%、L3 ≤ +100%（= 攻方不超过守军两倍；超过就是卡死）。
 *   [G7] 覆盖：四族 × 每格种子数 > 0，且守方真的射出过箭。
 *   [W1]–[W4] AI 墙估值表 `WALL_NEED` 与实测一致、单调、且真的被 `townNeedForAI` 消费（见下）。
 *
 * ## 规格 §14.4 的 "+0~30pt" 已被替换（A 案，主理人 2026-11-13 拍板）
 * 原文把"建 wall1 的守方胜率上升 0%~30%"当验收线。但**价格不改变"墙已建好那一局"的胜率**
 * （价格只改变有多少城会建墙）⇒ 拿价格永远修不绿；实测也不是 0~30，而是 **+13~+51pt**。
 * 现判据换成两条与价格无关、可执行的：
 *   [G3] 建 `wall1` 的守方胜率 **不下降**（方向闸；曲线无关的锚另有 `k1 ≥ k0 − 0.01`）
 *   [G6] **破城门槛**：L1 所需优势 ≤ +30%、L3 ≤ +100%
 * 合起来是"墙必须有用，但不能贵到打不下"。30pt 这个数**作废**，不再以 `⚠️` 形式保留。
 *
 * ## AI 墙估值（[W]，B3c）
 * `pickTarget` 原来用 `守军 + townDefenseBonus × 24`：L1 只加 48 战力，而实测墙值 ≈ 守军的 9%
 * ⇒ 低估一到两个数量级，AI 会带明显不够的兵去啃有墙的城。
 * 现在改成 `守军 × WALL_NEED[守方族][城防级]`，倍率就是本探针的 `k_level / k_0`。
 * [W2] 是**防表静默过期**：改了塔数/墙厚/护城河而没重跑本探针，比值一动这张表就红。
 * [W4] 是接线检查：表对了但 AI 没消费（有人把公式改回去）也必须红。
 *
 * ## 用法
 *   node tools/probes/wallgate.mjs                       # 报告模式，永远 exit 0
 *   node tools/probes/wallgate.mjs --gate                # 守方闸
 *   node tools/probes/wallgate.mjs --seeds=120           # 表读数样本（默认 120）
 *   node tools/probes/wallgate.mjs --cal-seeds=40        # 校准/二分样本（默认 40）
 *   node tools/probes/wallgate.mjs --json=tools/baseline/after-b5.json
 *   node tools/probes/wallgate.mjs --dist=/tmp/dist-bidir --gate   # 负向对照（双向）
 *   node tools/probes/wallgate.mjs --dist=/tmp/dist-oldai --gate   # 负向对照（旧 AI 估值）
 *
 * ## 负向对照（2026-11-13 实测）
 * 把 `dist/core/combat/siege.js` 的 `blocksLine` 改回双向（删掉 `isInsideCity(from)` 的早退），
 * 用 `--dist=` 指过去 ⇒ [G1] / [G3] 必须红（晨曦的 L1 守方胜率 55.0% → 1.7%）。读数记在
 * `production/m7-b3b-wall-2026-11-13.md` §4。
 *
 * ## 三条量法陷阱
 * 1. **别用"攻方胜率"判**：墙是给守方的，读数一定要写"守方胜率"，否则符号会反。
 * 2. **攻方倍率不能只取一个**：某一族 ×0.9 已经必输、另一族 ×1.2 还 80%，
 *    固定倍率会把"墙的价值"读成 0（天花板效应）。所以先校准，再在同一倍率上比四档。
 * 3. **不带投石车的那一列不能用来定价**：那一列包含"攻方没带工具"，
 *    把它算进墙价等于让墙替工坊收钱。定价只看带投石车那一列。
 */
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DIST = distDir();
printHeader(DIST, 'probe=wallgate');
requireFile(DIST, 'core/combat/battle.js');
requireFile(DIST, 'core/combat/siege.js');
requireFile(DIST, 'core/game/ai.js');

const { aiAct, createBattle, currentUnit, endActivation } = await import(
  distUrl('core/combat/battle.js', DIST)
);
const { blocksLine, isInsideCity, WALL_COL, WALL_NEED, wallNeedMultiplier } = await import(
  distUrl('core/combat/siege.js', DIST)
);
const { townNeedForAI } = await import(distUrl('core/game/ai.js', DIST));
const { FACTION_UNITS, UNITS } = await import(distUrl('core/data/units.js', DIST));
const { MARKET_RATES, garrisonStrength } = await import(distUrl('core/game/town.js', DIST));

const args = process.argv.slice(2);
const GATE = args.includes('--gate');
const SEEDS = Number((args.find((a) => a.startsWith('--seeds=')) ?? '--seeds=120').split('=')[1]);
const CAL_SEEDS = Number(
  (args.find((a) => a.startsWith('--cal-seeds=')) ?? '--cal-seeds=40').split('=')[1],
);
const JSON_OUT = args.find((a) => a.startsWith('--json='))?.slice('--json='.length) ?? null;

const F = ['p1', 'p2', 'p3', 'p4'];
const FNAME = { p1: '晨曦', p2: '赤焰', p3: '翠林', p4: '紫晶' };
const LEVELS = [0, 1, 2, 3];
const WEEKS = 3;
/** 攻方形态：带投石车 = 现实攻城（`workshop` 在 AI 建造序里）。 */
const CAT = ['catapult'];

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
const pad = (s, w) => String(s).padStart(w);
const median = (xs) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/** 兵种的有效金价：金币 + 非金按市场买入价折算（与 B5 的 T5 口径一致）。 */
function unitGold(def) {
  let g = def.cost.gold ?? 0;
  for (const [k, v] of Object.entries(def.cost)) {
    if (k === 'gold' || !v) continue;
    const r = MARKET_RATES[k];
    g += (v * r.buyGold) / r.buyAmount;
  }
  return g;
}
const armyGold = (army) => army.reduce((s, a) => s + unitGold(UNITS[a.unitTypeId]) * a.count, 0);

/** 3 周产量的五队（守方基准）。 */
const baseArmy = (f) =>
  FACTION_UNITS[f].map((id) => ({ unitTypeId: id, count: UNITS[id].growthPerWeek * WEEKS }));
const scaleArmy = (army, k) =>
  army.map((a) => ({ unitTypeId: a.unitTypeId, count: Math.max(1, Math.round(a.count * k)) }));

/** 跑完一局，统计守方射击 / 护城河 / 破墙回合。 */
function runBattle(attacker, defender, seed, level) {
  const st = createBattle(attacker, defender, seed, level);
  let shots = 0;
  let atkShots = 0;
  let moatStuck = 0;
  let breachRound = null;
  let guard = 0;
  while (!st.over && guard++ < 6000) {
    const u = currentUnit(st);
    if (!u) break;
    const ev = aiAct(st, u);
    for (const e of ev) {
      if (e.t === 'shoot') {
        if (u.side === 1) shots++;
        else atkShots++;
      }
      if (e.t === 'siege' && e.destroyed && breachRound === null) breachRound = st.round;
    }
    if (u.side === 0 && u.moatStuck) moatStuck++;
    endActivation(st);
  }
  const wallsDown = st.siege ? st.siege.structures.filter((x) => x.hp <= 0).length : 0;
  return { winner: st.winner, rounds: st.round, shots, atkShots, moatStuck, breachRound, wallsDown };
}

const defRate = (f, k, level, seeds) => {
  const defArmy = baseArmy(f);
  const atkArmy = scaleArmy(defArmy, k);
  let w = 0;
  for (let s = 0; s < seeds; s++) {
    const r = runBattle(
      { army: atkArmy, attack: 0, defense: 0, faction: f, warMachines: CAT },
      { army: defArmy, attack: 0, defense: 0, faction: f },
      5000 + s,
      level,
    );
    if (r.winner === 1) w++;
  }
  return w / seeds;
};

/**
 * 破城门槛：最小的攻方倍率 k 使"守方胜率 ≤ 50%"。
 * 兵力是整数、胜负又是二值，所以曲线是台阶状 —— 二分到 0.01 就够，
 * 返回 `hi`（第一次掉到 50% 以下的那一侧）作为门槛，比"停在 50% 附近"可复现。
 */
function thresholdK(f, level, seeds) {
  let lo = 0.6;
  let hi = 2.4;
  if (defRate(f, lo, level, seeds) < 0.5) return { k: lo, censored: 'low' };
  if (defRate(f, hi, level, seeds) >= 0.5) return { k: hi, censored: 'high' };
  for (let it = 0; it < 9; it++) {
    const mid = (lo + hi) / 2;
    if (defRate(f, mid, level, seeds) >= 0.5) lo = mid;
    else hi = mid;
  }
  return { k: Math.round(hi * 100) / 100, lo: Math.round(lo * 100) / 100, censored: null };
}

/* ---------------------------------------------------------------- [G1] 结构 */
console.log('\n[G1] 结构：墙只挡「城外 → 城内」（决策 61）');
const outside = { col: 9, row: 5 };
const inside = { col: 14, row: 5 };
const keepHex = { col: 13, row: 5 };
const fakeSiege = {
  level: 1,
  structures: [
    { id: 'gate', kind: 'gate', hex: { col: WALL_COL, row: 5 }, hp: 600, maxHp: 600, defense: 2 },
  ],
};
const outToIn = blocksLine(fakeSiege, outside, inside);
const inToOut = blocksLine(fakeSiege, inside, outside);
const outToKeepInside = blocksLine(fakeSiege, outside, keepHex);
const insideIsInside = isInsideCity(inside) && !isInsideCity(outside);
console.log(`  城外(9,5) → 城内(14,5)：${outToIn ? '断线' : '通'}（要求断线）`);
console.log(`  城内(14,5) → 城外(9,5)：${inToOut ? '断线' : '通'}（要求通）`);
console.log(`  城外 → 主楼(13,5)：${outToKeepInside ? '断线' : '通'}（要求断线：破墙前打不到主楼）`);
console.log(`  isInsideCity：城内 ${isInsideCity(inside)} / 城外 ${isInsideCity(outside)}`);

/* ---------------------------------------------------------------- 破城门槛 */
console.log(`\n[1] 破城门槛：攻方要带多少倍于守军的兵力才能 50% 拿下（带投石车，${CAL_SEEDS} 种子/格）`);
console.log('  族     不建墙    wall1    wall2    wall3      L1 所需优势   L3 所需优势');
const kTh = {};
const edge = {};
for (const f of F) {
  kTh[f] = {};
  for (const level of LEVELS) kTh[f][level] = thresholdK(f, level, CAL_SEEDS);
  const k0 = kTh[f][0].k;
  edge[f] = {};
  for (const level of LEVELS) edge[f][level] = kTh[f][level].k / k0 - 1;
  console.log(
    `  ${FNAME[f]}  ${pad(`×${kTh[f][0].k.toFixed(2)}`, 7)}  ${pad(`×${kTh[f][1].k.toFixed(2)}`, 7)}  ` +
      `${pad(`×${kTh[f][2].k.toFixed(2)}`, 7)}  ${pad(`×${kTh[f][3].k.toFixed(2)}`, 7)}   ` +
      `${pad(`${(edge[f][1] * 100).toFixed(0)}%`, 10)}   ${pad(`${(edge[f][3] * 100).toFixed(0)}%`, 10)}`,
  );
}
console.log('  （不建墙那一列 = 五五开所需的攻方兵力，作为比较基准；L1/L3 的百分比 = 相对它的额外优势）');

/* ---------------------------------------------------------------- 四档表 */
// 表读数用的"五五开兵力"：胜负是台阶状的（多 1 个兵就从 62% 掉到 36%），
// 所以不追"正好 50%"，而是在门槛附近 ±5% 里**扫一遍**，取最接近 50% 的那个倍率。
// 这不是挑数据：扫的是同一个 k 邻域，选法写死，且四条门槛本身由 [2] 的二分给出。
const parityK = {};
for (const f of F) {
  const base = kTh[f][0].k;
  let best = null;
  for (let d = -5; d <= 5; d++) {
    const k = Math.round((base + d * 0.01) * 100) / 100;
    const r = defRate(f, k, 0, SEEDS);
    if (!best || Math.abs(r - 0.5) < Math.abs(best.r - 0.5)) best = { k, r };
  }
  parityK[f] = best.k;
}
const k0Of = parityK;
console.log(`\n[2] 守方胜率：攻方固定在"不建墙五五开"的兵力（${SEEDS} 种子/格）`);
console.log('  族    城防   守方胜%   中位回合  破墙回合  守方射击   护城河卡住   倒塌段数');
const table = {};
for (const f of F) {
  const defArmy = baseArmy(f);
  const atkArmy = scaleArmy(defArmy, k0Of[f]);
  table[f] = {};
  for (const level of LEVELS) {
    let w = 0;
    let shots = 0;
    let atkShots = 0;
    let moat = 0;
    let down = 0;
    const rounds = [];
    const breach = [];
    for (let s = 0; s < SEEDS; s++) {
      const r = runBattle(
        { army: atkArmy, attack: 0, defense: 0, faction: f, warMachines: CAT },
        { army: defArmy, attack: 0, defense: 0, faction: f },
        5000 + s,
        level,
      );
      if (r.winner === 1) w++;
      shots += r.shots;
      atkShots += r.atkShots;
      moat += r.moatStuck;
      down += r.wallsDown;
      rounds.push(r.rounds);
      if (r.breachRound !== null) breach.push(r.breachRound);
    }
    table[f][level] = {
      defWin: w / SEEDS,
      roundsMedian: median(rounds),
      breachMedian: median(breach),
      defShots: shots,
      atkShots,
      moatStuck: moat,
      wallsDownMean: down / SEEDS,
    };
    console.log(
      `  ${FNAME[f]}  L${level}    ${pad(pct(w, SEEDS), 7)}   ${pad(median(rounds) ?? '—', 8)}  ` +
        `${pad(median(breach) ?? '—', 8)}  ${pad(shots, 8)}  ${pad(moat, 10)}  ${pad((down / SEEDS).toFixed(1), 8)}`,
    );
  }
}

/* ---------------------------------------------------------------- [W] AI 墙估值 */
// 旧公式（B3b 之前）：`守军 + townDefenseBonus × 24`。城墙的 defenseBonus 是 2/4/6，
// 于是 L1/L2/L3 只折 48/96/144 战力 —— 一个常数，与守军规模无关。
// 新公式：`守军 × WALL_NEED[守方族][级]`，倍率取上面 [1] 的 k_level / k_0。
const WALL_BONUS = { 1: 2, 2: 4, 3: 6 };
const wallRows = {};
console.log('\n[W] AI 墙估值：旧公式 vs 实测倍率（守军 = 3 周产量）');
console.log('  族    城防   实测 k/ k0   表内倍率   墙值占守军   旧折战力   新折战力   低估倍数');
for (const f of F) {
  wallRows[f] = {};
  const garrison = baseArmy(f);
  const gs = garrisonStrength(garrison);
  for (const level of LEVELS) {
    const ratio = kTh[f][level].k / kTh[f][0].k;
    const tableMul = WALL_NEED[f]?.[level] ?? WALL_NEED.neutral[level];
    const newNeed = townNeedForAI({ owner: f, buildings: level ? [`wall${level}`] : [], garrison });
    const oldNeed = gs + (WALL_BONUS[level] ?? 0) * 24;
    const wallShare = newNeed / gs - 1;
    const under = level ? (newNeed - gs) / Math.max(1e-9, oldNeed - gs) : 1;
    const underTxt = level === 0 ? '—' : under >= 1 ? `×${under.toFixed(0)}` : under < 0.01 ? '—（实测 +0%）' : `÷${(1 / under).toFixed(0)}`;
    wallRows[f][level] = { ratio, tableMul, oldNeed, newNeed, wallShare, under };
    console.log(
      `  ${FNAME[f]}  L${level}    ${pad(ratio.toFixed(3), 9)}   ${pad(tableMul.toFixed(2), 9)}   ` +
        `${pad(`${(wallShare * 100).toFixed(0)}%`, 11)}   ${pad(Math.round(oldNeed), 9)}   ` +
        `${pad(Math.round(newNeed), 9)}   ${pad(underTxt, 8)}`,
    );
  }
}
console.log('  （低估倍数 = 旧公式给墙折算的战力 ÷ 实测应该折算的；L1 中位约 ×35，四族 L1~L3 跨 12~88）');

/* ---------------------------------------------------------------- 闸 */
let fail = 0;
const chk = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`);
  return cond ? 0 : 1;
};

if (GATE) {
  console.log('\n[闸模式 · 守方闸]');
  fail += chk(outToIn === true, '城外 → 城内 断线');
  fail += chk(inToOut === false, '城内 → 城外 通（双向 = 这条红）');
  fail += chk(outToKeepInside === true, '城外 → 主楼 断线（破墙前打不到）');
  fail += chk(insideIsInside, 'isInsideCity 只认城墙列右边');

  for (const f of F) {
    const r0 = table[f][0].defWin;
    // 台阶曲线：多 1 个兵就从 62% 掉到 36%，所以不要求正好 50%，
    // 只要求"没被天花板/地板截断"（100% 或 0% 就量不出墙的价值）。
    fail += chk(
      r0 >= 0.3 && r0 <= 0.7,
      `${FNAME[f]} 校准有效：不建墙守方胜率 ${pct(r0 * SEEDS, SEEDS)} ∈ [30%,70%]`,
    );
  }
  for (const f of F) {
    // 比胜率更稳的一条：建 wall1 不能让它更容易被攻下。
    const k0 = kTh[f][0].k;
    const k1 = kTh[f][1].k;
    fail += chk(
      k1 >= k0 - 0.01,
      `${FNAME[f]} 建墙不会更好打：破城门槛 L0 ×${k0.toFixed(2)} → L1 ×${k1.toFixed(2)}`,
    );
  }
  for (const f of F) {
    const l0 = table[f][0].defWin;
    const l1 = table[f][1].defWin;
    const lift = (l1 - l0) * 100;
    fail += chk(
      lift >= 0,
      `${FNAME[f]} L1 守方胜率不下降（${pct(l0 * SEEDS, SEEDS)} → ${pct(l1 * SEEDS, SEEDS)}，${lift >= 0 ? '+' : ''}${lift.toFixed(1)}pt）`,
    );
    for (const level of [2, 3]) {
      const lv = table[f][level].defWin;
      fail += chk(
        lv >= l1 - 0.03,
        `${FNAME[f]} L${level} 不低于 L1 − 3pt（L1 ${pct(l1 * SEEDS, SEEDS)} / L${level} ${pct(lv * SEEDS, SEEDS)}）`,
      );
    }
  }
  for (const f of F) {
    const e = edge[f];
    fail += chk(
      e[1] <= e[2] + 0.05 && e[2] <= e[3] + 0.05,
      `${FNAME[f]} 破城门槛单调 L1≤L2≤L3（${(e[1] * 100).toFixed(0)}% / ${(e[2] * 100).toFixed(0)}% / ${(e[3] * 100).toFixed(0)}%）`,
    );
    fail += chk(e[1] <= 0.3, `${FNAME[f]} L1 所需优势 ≤ 30%（实测 ${(e[1] * 100).toFixed(0)}%）`);
    // 上限取"攻方不超过守军 2 倍"：超过就是五周一局里事实上打不下（不是平衡问题，是卡死）。
    fail += chk(e[3] <= 1.0, `${FNAME[f]} L3 所需优势 ≤ 100%（实测 ${(e[3] * 100).toFixed(0)}%）`);
  }
  const totalShots = F.reduce((n, f) => n + LEVELS.reduce((m, l) => m + table[f][l].defShots, 0), 0);
  fail += chk(totalShots > 0, `守方真的射出过箭（${totalShots} 次，> 0）`);

  // 规格 §14.4 的 "+0~30pt" 已按 A 案作废（价格改不了已建墙那一局的胜率）。
  // 现在守方闸 = [G3] 方向 + 上面那条 k1 ≥ k0 − 0.01，上限由 [G6] 的破城门槛接管。
  const lifts = F.map((f) => (table[f][1].defWin - table[f][0].defWin) * 100);
  console.log(
    `  §14.4 现判据（A 案）：L1 守方胜率 ${lifts.map((x) => `${x >= 0 ? '+' : ''}${x.toFixed(0)}`).join(' / ')}pt ≥ 0` +
      ` + 破城门槛 L1 ≤ 30% / L3 ≤ 100%（旧的 "+0~30pt" 上限已作废，见文件头）`,
  );

  /* ---- [W] AI 墙估值：表与实测同源、单调、且真的被消费 ---- */
  console.log('\n[W] AI 墙估值表');
  for (const f of F) {
    const row = WALL_NEED[f];
    fail += chk(
      Array.isArray(row) && row.length === 4 && row[0] === 1 && row[1] <= row[2] && row[2] <= row[3],
      `${FNAME[f]} WALL_NEED 单调且 L0 = 1（${row.join(' / ')}）`,
    );
  }
  // [W2] 防表静默过期：改塔数/墙厚/护城河后不重跑本探针，这一条会红。
  // 容差 5%：k 的二分粒度是 0.01，比值本身带 ~1% 量化误差。
  let driftMax = 0;
  let driftAt = '';
  for (const f of F) {
    for (const level of [1, 2, 3]) {
      const { ratio, tableMul } = wallRows[f][level];
      const dev = Math.abs(tableMul / ratio - 1);
      if (dev > driftMax) {
        driftMax = dev;
        driftAt = `${FNAME[f]} L${level}`;
      }
    }
  }
  fail += chk(
    driftMax <= 0.05,
    `WALL_NEED 与实测同源（最大偏差 ${(driftMax * 100).toFixed(1)}% @ ${driftAt}，容差 5%）`,
  );
  // [W3] 中立行必须是四族中位：中立城没有"阵营兵种构成"，只能用中位。
  let medMax = 0;
  for (const level of [1, 2, 3]) {
    const med = median(F.map((f) => wallRows[f][level].ratio));
    medMax = Math.max(medMax, Math.abs(med - WALL_NEED.neutral[level]));
  }
  fail += chk(medMax <= 0.02, `neutral 行 = 四族中位（最大偏差 ${medMax.toFixed(3)}，容差 0.02）`);

  // [W4] 接线检查：表对了但 AI 没消费也必须红。
  // 负向对照：把 ai.ts 改回 `守军 + defenseBonus × 24` ⇒ L3 比值落到 ~1.01 ⇒ 这条红。
  for (const f of F) {
    const mk = (level) => ({ owner: f, buildings: level ? [`wall${level}`] : [], garrison: baseArmy(f) });
    const ratio = townNeedForAI(mk(3)) / townNeedForAI(mk(0));
    fail += chk(
      Math.abs(ratio - WALL_NEED[f][3]) < 1e-9 && ratio >= 1.4,
      `${FNAME[f]} AI 用上了表：L3/L0 = ×${ratio.toFixed(2)}（表内 ×${WALL_NEED[f][3]}，且 ≥1.4）`,
    );
  }
  fail += chk(
    wallNeedMultiplier('neutral', 3) === WALL_NEED.neutral[3] &&
      wallNeedMultiplier('nobody', 9) === WALL_NEED.neutral[3] &&
      wallNeedMultiplier('p2', -1) === 1,
    'wallNeedMultiplier 兜底正确（中立/未知阵营 → 中位行；越界等级夹到 0~3）',
  );

  console.log(`\n  ${fail === 0 ? '✅ 守方闸达标' : `❌ ${fail} 条断言失败`}`);
}

/* ---------------------------------------------------------------- 落盘 */
if (JSON_OUT) {
  const out = {
    date: '2026-11-13',
    batch: 'B3b+B3c',
    seeds: SEEDS,
    calSeeds: CAL_SEEDS,
    weeks: WEEKS,
    calibratedK: k0Of,
    defenderArmyGold: Object.fromEntries(F.map((f) => [f, Math.round(armyGold(baseArmy(f)))])),
    thresholdK: kTh,
    requiredEdge: edge,
    levels: Object.fromEntries(
      F.map((f) => [
        f,
        Object.fromEntries(
          LEVELS.map((l) => [
            l,
            {
              defWin: table[f][l].defWin,
              roundsMedian: table[f][l].roundsMedian,
              breachMedian: table[f][l].breachMedian,
              defShots: table[f][l].defShots,
              moatStuck: table[f][l].moatStuck,
            },
          ]),
        ),
      ]),
    ),
    liftL1pt: Object.fromEntries(F.map((f) => [f, (table[f][1].defWin - table[f][0].defWin) * 100])),
    // B3c：AI 墙估值。`table` = 代码里的常量（`siege.ts:WALL_NEED`），
    // `measuredRatio` = 本轮实测 k_level/k_0；两者偏差 > 5% ⇒ [W2] 红。
    wallNeed: {
      table: WALL_NEED,
      measuredRatio: Object.fromEntries(
        F.map((f) => [f, Object.fromEntries([1, 2, 3].map((l) => [l, Math.round(wallRows[f][l].ratio * 1000) / 1000]))]),
      ),
      wallSharePct: Object.fromEntries(
        F.map((f) => [f, Object.fromEntries([1, 2, 3].map((l) => [l, Math.round(wallRows[f][l].wallShare * 1000) / 10]))]),
      ),
      underEstimateOld: Object.fromEntries(
        F.map((f) => [f, Object.fromEntries([1, 2, 3].map((l) => [l, Math.round(wallRows[f][l].under)]))]),
      ),
    },
  };
  let base = {};
  try {
    base = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
  } catch {
    base = {};
  }
  mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify({ ...base, wallgate: out }, null, 2) + '\n');
  console.log(`\n  已写入 ${JSON_OUT}（wallgate 段）`);
}

if (!GATE) {
  console.log('\n（报告模式：不判定退出码。`--gate` 才判守方闸。）');
  process.exit(0);
}
process.exit(fail === 0 ? 0 : 1);
