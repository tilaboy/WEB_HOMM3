/**
 * 自动结算「侧别偏置」诊断探针 + D1 走位闸（2026-10-20）。
 *
 * ## 为什么要这个探针
 * 四族诊断里发现：**同兵同量的镜像对打，攻方胜率不是 50%** ——
 * p1 0/60、p3 49/60（`production/faction-gameplay-review-2026-10-20.md §2`）。
 * 只要这个偏置存在，所有"四族强弱矩阵"的绝对值都不可信（方向或许还可读）。
 *
 * ## 它测什么（越往下越能排除干扰）
 *   [1] 整军镜像：2 周产量 × 5 队，AI 自己打（含走位）—— 玩家实际看到的那个数。
 *   [D1] 推进落点：**"推进了但没打出去"最后停在哪**。停在某个近战敌人一步之内，
 *       等于把"走一步 + 打一下"整手送给对方 —— 这就是 D1 的判据本身。
 *   [2] 贴脸对峙：把两只部队手工摆成相邻，**排除走位**，只留打击/反击经济。
 *   [3] 单栈镜像：一队 vs 一队，排除阵型与多队排序。
 *
 * ## 读法（这是本探针存在的意义）
 *   - [D1] 威胁区占比高 ⇒ 走位在送礼（D1）；
 *   - [2] 偏 ⇒ 打击经济本身偏（D2：先打的人打满、只吃半额反击）；
 *   - [2] 不偏但 [1] 偏 ⇒ 偏置来自"谁先动"，不是伤害公式。
 *
 * ## 用法
 *   node tools/probes/sidebias.mjs              # 报告模式（默认）：只诊断，永远 exit 0
 *   node tools/probes/sidebias.mjs --gate=d1    # **D1 闸**：走位相关断言（当前接入的那道）
 *   node tools/probes/sidebias.mjs --gate       # 全闸：含胜率对称性 —— D2 修好前必红
 *   node tools/probes/sidebias.mjs --seeds=200  # 加大样本
 *
 * 默认报告模式是**故意的**：整块对称性还没修完（D2 未修），
 * 把 `--gate` 接进"全绿"清单只会训练人忽略红色。
 *
 * ## 负向对照（复跑方法，2026-10-20 实测）
 *   把 `dist/core/combat/battle.js` 里的 `function incomingAt(...) {` 改成立刻 `return 0;`
 *   （= 威胁区判断失效，AI 退回"走到最远格"）⇒ `--gate=d1` 必须红、exit 1。
 *   用 md5 记录改前改后，跑完恢复。
 */
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'probe=sidebias');
requireFile(DIST, 'core/combat/battle.js');

const {
  aiAct,
  autoResolve,
  createBattle,
  currentUnit,
  endActivation,
  unitSpeed,
} = await import(distUrl('core/combat/battle.js', DIST));
const { FACTION_UNITS, UNITS, getUnit } = await import(distUrl('core/data/units.js', DIST));
const { distance } = await import(distUrl('core/combat/hex.js', DIST));

const args = process.argv.slice(2);
const GATE = args.includes('--gate');
const GATE_D1 = args.includes('--gate=d1');
const SEEDS = Number((args.find((a) => a.startsWith('--seeds=')) ?? '--seeds=60').split('=')[1]);
const WEEKS = 2;

const F = ['p1', 'p2', 'p3', 'p4'];
const FNAME = { p1: '晨曦', p2: '赤焰', p3: '翠林', p4: '紫晶' };

/** 2 周产量（用兵种表 growthPerWeek —— 2026-10-20 起它才是权威）。 */
const armyOf = (f) =>
  FACTION_UNITS[f].map((id) => ({ unitTypeId: id, count: UNITS[id].growthPerWeek * WEEKS }));

/** 靠走过来打人的兵（有箭的远程不算威胁区：换落点也躲不掉）。 */
const isMeleeThreat = (u) => {
  const d = getUnit(u.unitTypeId);
  return d.shots === undefined || u.shots <= 0;
};

/**
 * 手动跑完一局，顺便统计：
 *   `adv[s]`       = s 侧"推进了但没打出去"的次数（判据分母）
 *   `intoReach[s]` = 其中最后停在某个近战敌人"走一步就能打"范围内的次数（D1 分子）
 *   `waits[s]`     = s 侧主动等待的次数（修好后应当 > 0，否则说明分支是死代码）
 */
function runBattle(attacker, defender, seed, placeAdjacent = false) {
  const st = createBattle(attacker, defender, seed);
  if (placeAdjacent) {
    // 只留一队时才有意义：把两只部队摆到贴脸，排除走位
    st.units[0].hex = { col: 5, row: 5 };
    st.units[1].hex = { col: 6, row: 5 };
  }
  const openers = [0, 0];
  const adv = [0, 0];
  const intoReach = [0, 0];
  const waits = [0, 0];
  let firstMelee = null;
  let lastRound = 0;
  let guard = 0;
  while (!st.over && guard++ < 4000) {
    const u = currentUnit(st);
    if (!u) break;
    if (st.round !== lastRound) {
      lastRound = st.round;
      openers[u.side] += 1;
    }
    const ev = aiAct(st, u);
    if (ev.some((e) => e.t === 'wait')) waits[u.side] += 1;
    const moved = ev.some((e) => e.t === 'move');
    const attacked = ev.some(
      (e) => e.t === 'melee' || e.t === 'shoot' || e.t === 'siege' || e.t === 'machine',
    );
    if (moved && !attacked && isMeleeThreat(u)) {
      adv[u.side] += 1;
      const foes = st.units.filter((x) => x.side !== u.side && x.count > 0 && isMeleeThreat(x));
      // 敌人走 d−1 步就能贴身动手
      if (foes.some((f) => distance(u.hex, f.hex) - 1 <= unitSpeed(st, f))) intoReach[u.side] += 1;
    }
    for (const e of ev) {
      if (e.t === 'melee' && firstMelee === null) firstMelee = u.side;
    }
    endActivation(st);
  }
  return { winner: st.winner, openers, firstMelee, rounds: st.round, adv, intoReach, waits };
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : '—');
const pad = (s, w) => String(s).padStart(w);

/* ---------------------------------------------------------------- [1] 整军镜像 */
console.log(`\n[1] 整军镜像（${WEEKS} 周产量 × 5 队，AI 对打，${SEEDS} 个种子）`);
console.log('    族     攻方胜  守方胜  平局   回合首发(0/1)   首次近战命中(0/1)');
const full = {};
for (const f of F) {
  let w0 = 0;
  let w1 = 0;
  let dr = 0;
  const op = [0, 0];
  const fm = [0, 0];
  const adv = [0, 0];
  const intoReach = [0, 0];
  const waits = [0, 0];
  let rounds = 0;
  for (let s = 0; s < SEEDS; s++) {
    const r = runBattle(
      { army: armyOf(f), attack: 0, defense: 0, faction: f },
      { army: armyOf(f), attack: 0, defense: 0, faction: f },
      9000 + s,
    );
    if (r.winner === 0) w0++;
    else if (r.winner === 1) w1++;
    else dr++;
    op[0] += r.openers[0];
    op[1] += r.openers[1];
    if (r.firstMelee === 0) fm[0]++;
    else if (r.firstMelee === 1) fm[1]++;
    adv[0] += r.adv[0];
    adv[1] += r.adv[1];
    intoReach[0] += r.intoReach[0];
    intoReach[1] += r.intoReach[1];
    waits[0] += r.waits[0];
    waits[1] += r.waits[1];
    rounds += r.rounds;
  }
  full[f] = { w0, w1, dr, op, fm, adv, intoReach, waits, rounds };
  console.log(
    `    ${FNAME[f]}  ${pad(pct(w0, SEEDS), 5)}  ${pad(pct(w1, SEEDS), 5)}  ${pad(dr, 4)}   ` +
      `${pad(`${op[0]}/${op[1]}`, 12)}   ${pad(`${fm[0]}/${fm[1]}`, 14)}`,
  );
}

/* ---------------------------------------------------------------- [D1] 推进落点 */
console.log('\n[D1] 推进落点（"推进了但没打出去"最后停在哪）');
console.log('    族     推进次数  停在威胁区  占比   让手次数  平均回合');
let d1Adv = 0;
let d1Into = 0;
let d1Waits = 0;
for (const f of F) {
  const r = full[f];
  const a = r.adv[0] + r.adv[1];
  const i = r.intoReach[0] + r.intoReach[1];
  const w = r.waits[0] + r.waits[1];
  d1Adv += a;
  d1Into += i;
  d1Waits += w;
  console.log(
    `    ${FNAME[f]}  ${pad(a, 8)}  ${pad(i, 10)}  ${pad(pct(i, a), 5)}  ${pad(w, 8)}  ${pad((r.rounds / SEEDS).toFixed(1), 8)}`,
  );
}
console.log(`    合计    ${pad(d1Adv, 8)}  ${pad(d1Into, 10)}  ${pad(pct(d1Into, d1Adv), 5)}  ${pad(d1Waits, 8)}`);

/* ---------------------------------------------------------------- [2] 贴脸对峙 */
console.log('\n[2] 贴脸对峙（同兵同量、手工摆相邻，排除走位）');
console.log('    族/兵种                     攻方胜  守方胜');
const adjacent = {};
const sampleUnits = {
  p1: 'p1_oathpike',
  p2: 'p2_wolfrider',
  p3: 'p3_vineguard',
  p4: 'p4_hopgolem',
};
for (const f of F) {
  const id = sampleUnits[f];
  let w0 = 0;
  let w1 = 0;
  for (let s = 0; s < SEEDS; s++) {
    const r = runBattle(
      { army: [{ unitTypeId: id, count: 20 }], attack: 0, defense: 0, faction: f },
      { army: [{ unitTypeId: id, count: 20 }], attack: 0, defense: 0, faction: f },
      700 + s,
      true,
    );
    if (r.winner === 0) w0++;
    else if (r.winner === 1) w1++;
  }
  adjacent[f] = { w0, w1, id };
  console.log(`    ${FNAME[f]} ${id.padEnd(18)} ${pad(pct(w0, SEEDS), 5)}  ${pad(pct(w1, SEEDS), 5)}`);
}

/* ---------------------------------------------------------------- [3] 单栈镜像 */
console.log('\n[3] 单栈镜像（一队 vs 一队，含走位，排除阵型）');
console.log('    族     攻方胜  守方胜');
const single = {};
for (const f of F) {
  const id = sampleUnits[f];
  let w0 = 0;
  let w1 = 0;
  for (let s = 0; s < SEEDS; s++) {
    const st = createBattle(
      { army: [{ unitTypeId: id, count: 20 }], attack: 0, defense: 0, faction: f },
      { army: [{ unitTypeId: id, count: 20 }], attack: 0, defense: 0, faction: f },
      700 + s,
    );
    autoResolve(st);
    if (st.winner === 0) w0++;
    else if (st.winner === 1) w1++;
  }
  single[f] = { w0, w1 };
  console.log(`    ${FNAME[f]}  ${pad(pct(w0, SEEDS), 5)}  ${pad(pct(w1, SEEDS), 5)}`);
}

/* ---------------------------------------------------------------- 归因 */
console.log('\n[归因]');
let worstFull = 0;
let worstFaction = '';
for (const f of F) {
  const bias = Math.abs(full[f].w0 / SEEDS - 0.5) * 100;
  if (bias > worstFull) {
    worstFull = bias;
    worstFaction = f;
  }
  const adjBias = Math.abs(adjacent[f].w0 / SEEDS - 0.5) * 100;
  const fm = full[f].fm;
  const laterMoverShare = fm[0] + fm[1] ? fm[1] / (fm[0] + fm[1]) : 0.5;
  const op0 = full[f].op[0];
  const op1 = full[f].op[1];
  const opShare = op0 + op1 ? op0 / (op0 + op1) : 0.5;
  const intoShare =
    full[f].adv[0] + full[f].adv[1]
      ? (full[f].intoReach[0] + full[f].intoReach[1]) / (full[f].adv[0] + full[f].adv[1])
      : 0;

  const tags = [];
  if (Math.abs(bias) > 15) tags.push(`整军偏 ${bias.toFixed(0)}pt`);
  if (adjBias > 15) tags.push(`先手决定性（贴脸偏 ${adjBias.toFixed(0)}pt）`);
  if (intoShare > 0.55) tags.push(`推进送礼（${(intoShare * 100).toFixed(0)}% 停进威胁区）`);
  if (laterMoverShare > 0.8) tags.push(`后动方先手 ${(laterMoverShare * 100).toFixed(0)}%`);
  if (tags.length === 0) tags.push('无显著偏置');

  console.log(
    `  ${FNAME[f]}：${tags.join('｜')}｜回合首发 0 侧 ${(opShare * 100).toFixed(0)}%`,
  );
}
console.log(
  `\n  最大偏置：${FNAME[worstFaction]} ${worstFull.toFixed(0)}pt ` +
    `(攻方 ${full[worstFaction].w0}/${SEEDS})`,
);
console.log(
  [
    '',
    '  已修（2026-10-20）：',
    '   D1 走位让先 —— `aiAct` 的推进分支改成"安全落点 → 让一手 → 最不亏的暴露落点"，',
    '      判据不再看"走到多近"，而是"站上去会不会被先打一下"。',
    '      实测：停在威胁区的比例 73% → 44%（四族），首次近战归属从"后动方 100%"',
    '      改为"攻方先手"（p1 那张 0/60 已变成 60/0）。',
    '  仍未修：',
    '   D2 先手决定性 —— 贴脸单挑攻方 68~92%：先打的人打满、只吃半额反击。',
    '      D1 修完后镜像胜率偏置**没有消失**（p1 0%→90% / p3 78%→98%），',
    '      说明胜率主要由 D2 决定，D1 只决定"谁吃白打"。这条必须单独立项。',
  ].join('\n'),
);

/* ---------------------------------------------------------------- 闸模式 */
const TOL_FULL = 15; // 整军镜像允许的偏置（百分点）
const TOL_ADJ_HI = 70; // 贴脸对峙攻方胜率上限（先手优势可以有，但不该到 90%+）
const TOL_FIRST_MELEE = 75; // 首次近战命中方占比上限

const chk = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`);
  return cond ? 0 : 1;
};

if (GATE_D1) {
  // D1 闸：只判"走位"，不含胜率对称性（那要等 D2）。
  // 阈值取整、留余量：改前合计 73%、改后 44%；单族上限 60%（改前 p2 95% / p1 78% / p4 64%）。
  console.log('\n[闸模式 · D1]');
  let fail = 0;
  fail += chk(d1Adv > 0, `采样到推进（${d1Adv} 次，> 0）`);
  fail += chk(
    d1Into / Math.max(1, d1Adv) <= 0.55,
    `合计停在威胁区 ≤ 55%（实测 ${pct(d1Into, d1Adv)}）`,
  );
  for (const f of F) {
    const a = full[f].adv[0] + full[f].adv[1];
    const i = full[f].intoReach[0] + full[f].intoReach[1];
    fail += chk(i / Math.max(1, a) <= 0.6, `${FNAME[f]} 停在威胁区 ≤ 60%（实测 ${pct(i, a)}）`);
  }
  const fmTotal = F.map((f) => full[f].fm).reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
  const atkFirst = fmTotal[0] / Math.max(1, fmTotal[0] + fmTotal[1]);
  fail += chk(atkFirst >= 0.4, `首次近战归攻方 ≥ 40%（实测 ${(100 * atkFirst).toFixed(0)}%）`);
  const draws = F.reduce((n, f) => n + full[f].dr, 0);
  fail += chk(draws === 0, `没有把仗拖成平局（平局 ${draws}）`);
  fail += chk(d1Waits > 0, `"让一手"分支真的在用（${d1Waits} 次，> 0）`);
  console.log(`\n${fail === 0 ? '✅ D1 达标' : `❌ ${fail} 条 D1 断言失败`}`);
  process.exit(fail === 0 ? 0 : 1);
}

if (!GATE) {
  console.log(
    '\n（报告模式：不判定退出码。`--gate=d1` 判走位；整块对称性等 D2 修好后再用 `--gate`。）',
  );
  process.exit(0);
}

let fail = 0;
console.log('\n[闸模式]');
for (const f of F) {
  const bias = Math.abs(full[f].w0 / SEEDS - 0.5) * 100;
  fail += chk(
    bias <= TOL_FULL + 1e-9,
    `${FNAME[f]} 整军镜像偏置 ≤ ${TOL_FULL}pt（实测 ${bias.toFixed(0)}pt）`,
  );
  const adj = (100 * adjacent[f].w0) / SEEDS;
  fail += chk(adj <= TOL_ADJ_HI, `${FNAME[f]} 贴脸攻方胜率 ≤ ${TOL_ADJ_HI}%（实测 ${adj.toFixed(0)}%）`);
  const fm = full[f].fm;
  const share = fm[0] + fm[1] ? (100 * fm[0]) / (fm[0] + fm[1]) : 50;
  fail += chk(
    Math.abs(share - 50) <= TOL_FIRST_MELEE - 50,
    `${FNAME[f]} 首次近战命中方占比 50±${TOL_FIRST_MELEE - 50}%（实测攻方 ${share.toFixed(0)}%）`,
  );
}
console.log(`\n${fail === 0 ? '✅ 对称性达标' : `❌ ${fail} 条对称性断言失败（D2 未修，预期红）`}`);
process.exit(fail === 0 ? 0 : 1);
