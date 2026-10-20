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
 *   - [2] 首击/反击比 ⇒ 反击折扣（2026-10-20 起应为全额 ≈ 0.75~0.9；出现 0.4 说明有人加回了 ×0.5）；
 *   - [2] 攻方胜率 ⇒ 先手值多少。**攻方先手是设计**（HOMM3 同款，同速时攻方先动），
 *     不是缺陷；只有接近"必赢"（>90%）才算过头。
 *
 * ## 用法
 *   node tools/probes/sidebias.mjs              # 报告模式（默认）：只诊断，永远 exit 0
 *   node tools/probes/sidebias.mjs --gate=d1    # **D1 闸**：走位相关断言
 *   node tools/probes/sidebias.mjs --gate=d2    # **D2 闸**：反击全额 + 攻方先手在合理区间
 *   node tools/probes/sidebias.mjs --gate       # 两个都判
 *   node tools/probes/sidebias.mjs --seeds=200  # 加大样本
 *
 * 2026-10-20 拍板：排序**保留**（攻方先手 = 设计，HOMM3 同款）；反击改**全额**（原 ×0.5
 * 是二次打折，人数损失已经摊薄过一次）。所以本探针不再要求"镜像 50/50"。
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
const GATE_D2 = args.includes('--gate=d2');
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
  // 首回合"首击 → 反击"这一对：用来判"反击是否还是减半"（全额 ≈ 0.75~0.9，减半 ≈ 0.4）
  let firstPair = null;
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
      if (e.t === 'melee') {
        if (firstMelee === null) firstMelee = u.side;
        if (firstPair === null) firstPair = { dmg: e.damage, back: 0 };
      } else if (e.t === 'retaliate' && firstPair && firstPair.back === 0) {
        firstPair.back = e.damage;
      }
    }
    endActivation(st);
  }
  return { winner: st.winner, openers, firstMelee, rounds: st.round, adv, intoReach, waits, firstPair };
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
console.log('    族/兵种                     攻方胜  守方胜  首击→反击');
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
  let sumRatio = 0;
  let nRatio = 0;
  for (let s = 0; s < SEEDS; s++) {
    const r = runBattle(
      { army: [{ unitTypeId: id, count: 20 }], attack: 0, defense: 0, faction: f },
      { army: [{ unitTypeId: id, count: 20 }], attack: 0, defense: 0, faction: f },
      700 + s,
      true,
    );
    if (r.winner === 0) w0++;
    else if (r.winner === 1) w1++;
    if (r.firstPair && r.firstPair.back > 0) {
      sumRatio += r.firstPair.back / Math.max(1, r.firstPair.dmg);
      nRatio++;
    }
  }
  const ratio = nRatio ? sumRatio / nRatio : 0;
  adjacent[f] = { w0, w1, id, ratio };
  console.log(
    `    ${FNAME[f]} ${id.padEnd(18)} ${pad(pct(w0, SEEDS), 5)}  ${pad(pct(w1, SEEDS), 5)}  ${pad(ratio.toFixed(2), 6)}`,
  );
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
console.log('\n[归因]（先手优势是设计，只有"接近必赢"或"反击又被打折"才算问题）');
let worstFull = 0;
let worstFaction = '';
for (const f of F) {
  const bias = (full[f].w0 / SEEDS - 0.5) * 100;
  if (Math.abs(bias) > Math.abs(worstFull)) {
    worstFull = bias;
    worstFaction = f;
  }
  const fm = full[f].fm;
  const opShare =
    (full[f].op[0] + full[f].op[1]) ? full[f].op[0] / (full[f].op[0] + full[f].op[1]) : 0.5;
  const intoShare =
    full[f].adv[0] + full[f].adv[1]
      ? (full[f].intoReach[0] + full[f].intoReach[1]) / (full[f].adv[0] + full[f].adv[1])
      : 0;

  const tags = [];
  if (bias >= 45) tags.push(`先手近乎必赢（+${bias.toFixed(0)}pt）`);
  else if (bias >= 12) tags.push(`攻方 +${bias.toFixed(0)}pt（设计内）`);
  else tags.push('先手优势不明显');
  if (intoShare > 0.55) tags.push(`推进送礼（${(intoShare * 100).toFixed(0)}% 停进威胁区）`);
  if (adjacent[f].ratio > 0 && adjacent[f].ratio < 0.6)
    tags.push(`反击只值 ${(adjacent[f].ratio * 100).toFixed(0)}% —— 是不是又减半了？`);

  console.log(
    `  ${FNAME[f]}：${tags.join('｜')}｜回合首发 0 侧 ${(opShare * 100).toFixed(0)}%` +
      `｜首击→反击 ${(adjacent[f].ratio * 100).toFixed(0)}%`,
  );
}
console.log(
  `\n  攻方最大优势：${FNAME[worstFaction]} ${worstFull >= 0 ? '+' : ''}${worstFull.toFixed(0)}pt ` +
    `(攻方 ${full[worstFaction].w0}/${SEEDS})`,
);
console.log(
  [
    '',
    '  2026-10-20 拍板后的口径：',
    '   D1（走位）已修：推进改"安全落点 → 让一手 → 最不亏的暴露落点"，',
    '      判据是"站上去会不会被先打一下"，不是"走到多近"。威胁区 73% → 41%。',
    '   先手（排序）：**保留攻方先手** —— 同速时攻方先动，HOMM3 同款，主理人拍板。',
    '      代价写在 `battle.ts::startRound` 注释里：镜像整军攻方 63~85%（只有镜像才这么高，',
    '      实战里速度构成不同会被稀释）。',
    '   反击：改**全额**（原 ×0.5）。人数损失本来就把反击摊薄了 10~25%，再减半＝二次打折；',
    '      首击→反击从 0.45 回到 0.75~0.90，交锋不再"谁先碰到谁赢"。',
    '   残留：镜像散差仍随族波动（贴脸 45~70% / 整军 63~85%），与配置无关，',
    '      属"速度构成 + 兵种差异"，未再追；别把"攻方优势"当成 bug 反复修。',
  ].join('\n'),
);

/* ---------------------------------------------------------------- 闸模式 */
const chk = (cond, msg) => {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`);
  return cond ? 0 : 1;
};
let fail = 0;

if (GATE_D1 || GATE) {
  // D1 闸：只判"走位"。
  // 阈值取整、留余量：改前合计 73%、改后 41~44%；单族上限 60%（改前 p2 95% / p1 78% / p4 64%）。
  console.log('\n[闸模式 · D1]');
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
  console.log(`  ${fail === 0 ? '✅ D1 达标' : `❌ 累计 ${fail} 条 D1 断言失败`}`);
}

if (GATE_D2 || GATE) {
  // D2 闸：判两件事 —— ① 反击是全额（不是又被减半）；② 攻方先手在"合理优势"区间内。
  // 为什么不再要求 50/50：攻方先手是设计（HOMM3 同款），见文件头与 §11.5。
  console.log('\n[闸模式 · D2]');
  const before = fail;
  for (const f of F) {
    const r = adjacent[f].ratio;
    // 全额实测 0.75~0.90；加回 ×0.5 会掉到 0.35~0.45 ⇒ 0.60 是安全分界。
    fail += chk(r >= 0.6, `${FNAME[f]} 首击→反击 ≥ 60%（实测 ${(100 * r).toFixed(0)}%）`);
  }
  for (const f of F) {
    const adj = (100 * adjacent[f].w0) / SEEDS;
    fail += chk(adj >= 40 && adj <= 80, `${FNAME[f]} 贴脸攻方胜率 40~80%（实测 ${adj.toFixed(0)}%）`);
  }
  for (const f of F) {
    const fm = (100 * full[f].w0) / SEEDS;
    fail += chk(fm >= 55 && fm <= 95, `${FNAME[f]} 整军攻方胜率 55~95%（实测 ${fm.toFixed(0)}%）`);
  }
  const draws = F.reduce((n, f) => n + full[f].dr, 0);
  fail += chk(draws === 0, `平局 0（实测 ${draws}）`);
  // 同速攻方先动 = 设计；但"整支军队都先动"是这条设计的具体形态，
  // 有人把它改成洗牌/随机时这里会掉下来（实测 74~100%）。
  const opShare = full.p1.op[0] / Math.max(1, full.p1.op[0] + full.p1.op[1]);
  fail += chk(opShare >= 0.6, `回合首发 0 侧 ≥ 60%（晨曦实测 ${(100 * opShare).toFixed(0)}%，攻方先手仍成立）`);
  console.log(`  ${fail === before ? '✅ D2 达标' : `❌ 累计 ${fail - before} 条 D2 断言失败`}`);
}

if (!GATE && !GATE_D1 && !GATE_D2) {
  console.log(
    '\n（报告模式：不判定退出码。`--gate=d1` 判走位，`--gate=d2` 判反击全额+先手区间。）',
  );
  process.exit(0);
}

console.log(`\n${fail === 0 ? '✅ 全部达标' : `❌ ${fail} 条断言失败`}`);
process.exit(fail === 0 ? 0 : 1);
