/**
 * 自动结算「侧别偏置」诊断探针（2026-10-20）。
 *
 * ## 为什么要这个探针
 * 四族诊断里发现：**同兵同量的镜像对打，攻方胜率不是 50%** ——
 * p1 0/60、p3 49/60（`production/faction-gameplay-review-2026-10-20.md §2`）。
 * 只要这个偏置存在，所有"四族强弱矩阵"的绝对值都不可信（方向或许还可读）。
 * 所以先单开一支探针，把偏置**量化 + 拆分归因**，再决定改什么。
 *
 * ## 它测什么（四层，越往下越能排除干扰）
 *   [1] 整军镜像：2 周产量 × 5 队，AI 自己打（含走位）—— 玩家实际看到的那个数。
 *   [2] 回合首发：每回合第一个行动的是哪一侧。理论上镜像时两侧机会均等。
 *   [3] 首次近战命中：谁先打出第一下（先手优势的直接来源）。
 *   [4] 贴脸对峙：把两只部队手工摆成相邻，**排除走位**，只留打击/反击经济。
 *   [5] 单栈镜像：一队 vs 一队，排除阵型与多队排序。
 *
 * ## 读法（这是本探针存在的意义）
 *   - [1] 偏，[4] 不偏 ⇒ 问题在**走位/AI**：先动的一方走到敌人面前结束回合，
 *     把"本回合第一次出手"让给了对方 ⇒ 谁先动谁吃亏。
 *   - [1] 和 [4] 都偏 ⇒ 问题在**打击经济**（先手/反击结算）。
 *   - [2] 100% 是一侧 ⇒ 同速时的 tie-break 写死（`startRound` 里 `a.side - b.side`），
 *     镜像会变成确定性结果而不是 50/50。
 *
 * ## 用法
 *   node tools/probes/sidebias.mjs              # 报告模式（默认）：只诊断，永远 exit 0
 *   node tools/probes/sidebias.mjs --gate       # 闸模式：偏置超阈值 ⇒ exit 1
 *   node tools/probes/sidebias.mjs --seeds=200  # 加大样本
 *
 * 默认报告模式是**故意的**：这是一个**已知缺陷**的诊断工具，
 * 在修好之前把它接进"全绿"清单只会训练人忽略红色。
 * 修复后用 `--gate` 接入（阈值见下面 TOL）。
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
} = await import(distUrl('core/combat/battle.js', DIST));
const { FACTION_UNITS, UNITS } = await import(distUrl('core/data/units.js', DIST));

const args = process.argv.slice(2);
const GATE = args.includes('--gate');
const SEEDS = Number((args.find((a) => a.startsWith('--seeds=')) ?? '--seeds=60').split('=')[1]);
const WEEKS = 2;

const F = ['p1', 'p2', 'p3', 'p4'];
const FNAME = { p1: '晨曦', p2: '赤焰', p3: '翠林', p4: '紫晶' };

/** 2 周产量（用兵种表 growthPerWeek —— 2026-10-20 起它才是权威）。 */
const armyOf = (f) =>
  FACTION_UNITS[f].map((id) => ({ unitTypeId: id, count: UNITS[id].growthPerWeek * WEEKS }));

/** 手动跑完一局，顺便统计"回合首发"与"首次近战命中方"。 */
function runBattle(attacker, defender, seed, placeAdjacent = false) {
  const st = createBattle(attacker, defender, seed);
  if (placeAdjacent) {
    // 只留一队时才有意义：把两只部队摆到贴脸，排除走位
    st.units[0].hex = { col: 5, row: 5 };
    st.units[1].hex = { col: 6, row: 5 };
  }
  const openers = [0, 0];
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
    for (const e of ev) {
      if (e.t === 'melee' && firstMelee === null) firstMelee = u.side;
    }
    endActivation(st);
  }
  return { winner: st.winner, openers, firstMelee, rounds: st.round };
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
  }
  full[f] = { w0, w1, dr, op, fm };
  console.log(
    `    ${FNAME[f]}  ${pad(pct(w0, SEEDS), 5)}  ${pad(pct(w1, SEEDS), 5)}  ${pad(dr, 4)}   ` +
      `${pad(`${op[0]}/${op[1]}`, 12)}   ${pad(`${fm[0]}/${fm[1]}`, 14)}`,
  );
}

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

/* ---------------------------------------------------------------- 归因与判定 */
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

  const tags = [];
  if (Math.abs(bias) > 15) tags.push(`整军偏 ${bias.toFixed(0)}pt`);
  if (adjBias > 15) tags.push(`先手决定性（贴脸偏 ${adjBias.toFixed(0)}pt）`);
  if (laterMoverShare > 0.8) tags.push(`走位让先（后动方占首次近战 ${(laterMoverShare * 100).toFixed(0)}%）`);
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
    '  两条互相叠加的缺陷（2026-10-20 实测，均未修）：',
    '   D1 走位让先：AI 够不着时会"走到最近格"并结束行动，往往正好停在敌人身边；',
    '      于是**后动的一方拿到本回合第一次近战**（表中 3/4 族后动方占 100%）。',
    '   D2 先手决定性：贴脸单挑攻方 68~92% —— 先打的人打满、只吃半额反击，',
    '      在这套"无同时结算"的模型里先手几乎决定胜负。',
    '   ⇒ 两者相乘：谁先动谁把先手让出去，整军镜像才会出现 0% / 78% 这种极端值。',
    '   ⇒ 注意：赤焰冲锋会**放大** D1/D2（后动方不仅能先打，还带着 +2 冲进来），',
    '      所以这条探针必须和 `factionverbs` 一起看。',
  ].join('\n'),
);

/* ---------------------------------------------------------------- 闸模式 */
const TOL_FULL = 15; // 整军镜像允许的偏置（百分点）
const TOL_ADJ_HI = 70; // 贴脸对峙攻方胜率上限（先手优势可以有，但不该到 90%+）
const TOL_FIRST_MELEE = 75; // 首次近战命中方占比上限

if (!GATE) {
  console.log('\n（报告模式：不判定退出码。修好后用 `--gate` 接入。）');
  process.exit(0);
}

let fail = 0;
const chk = (cond, msg) => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${msg}`);
  if (!cond) fail++;
};
console.log('\n[闸模式]');
for (const f of F) {
  const bias = Math.abs(full[f].w0 / SEEDS - 0.5) * 100;
  chk(bias <= TOL_FULL + 1e-9, `${FNAME[f]} 整军镜像偏置 ≤ ${TOL_FULL}pt（实测 ${bias.toFixed(0)}pt）`);
  const adj = (100 * adjacent[f].w0) / SEEDS;
  chk(adj <= TOL_ADJ_HI, `${FNAME[f]} 贴脸攻方胜率 ≤ ${TOL_ADJ_HI}%（实测 ${adj.toFixed(0)}%）`);
  const fm = full[f].fm;
  const share = fm[0] + fm[1] ? (100 * fm[0]) / (fm[0] + fm[1]) : 50;
  chk(
    Math.abs(share - 50) <= TOL_FIRST_MELEE - 50,
    `${FNAME[f]} 首次近战命中方占比 50±${TOL_FIRST_MELEE - 50}%（实测攻方 ${share.toFixed(0)}%）`,
  );
}
console.log(`\n${fail === 0 ? '✅ 对称性达标' : `❌ ${fail} 条对称性断言失败`}`);
process.exit(fail === 0 ? 0 : 1);
