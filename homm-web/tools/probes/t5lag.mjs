/**
 * t5lag.mjs —— **V4 的执行版**：T5 从「居所落成」到「买进队伍」的滞后（M7 · D1，2026-11-13）
 *
 * ## 为什么 V4 不再读「每金」
 * 旧 V4 判的是 `战力 / cost.gold`（名义价）单调 + 极差 20~30%。它有两个毛病，都是量出来的：
 *   ① 名义价**不是任何人付的价**：p3 要 2 宝石、p4 要 4 水晶，按市价折是 800/个
 *      ⇒ p4 的实付是名义的 5 倍。玩家真正感受到的不是"每金多少战力"，是**买不起、买得慢**。
 *   ② 拿它当判据会**为一个没人付的数背书**：旧读数 25.5% 全绿，而同一批数据里
 *      p4 的 T5 滞后中位 10 天、尾部 28 天。
 * 所以 V4 改读**滞后（天）**，名义每金降级为打印读数（仍打印，便于和历史对账）。
 *
 * ## 量的是哪一段（两段必须分开，否则会把两件事混成一件）
 * ```
 *   dwell5 落成 ──① 采购滞后（buyLag）──> 第一只 T5 入库 ──② 上阵滞后 ──> 英雄带着它出门
 * ```
 *   ① 是**价格/资源**问题 —— V4 判的就是这一段，稀有资源贵 = 这一段长。
 *   ② 是**编队/AI**问题 —— `refillFromGarrison` 在 1~2 栈军队上被 `capForStackShare`
 *      算成 0（D4 的病因）。主理人 2026-11-13 拍板**不做**，所以这一段只打印、不进退出码。
 * 把 ② 算进 V4 会让"编队规则"的锅扣在"价格"头上，两边都修不好。
 *
 * ## 判据（[L1]–[L5]，全部进退出码）
 *   [L1] 覆盖：每族 ≥3 个样本；并且「有落成」与「量到滞后」分开计数（没对象 ≠ 量不到）。
 *   [L2] 中位滞后 ≤ 6 天 —— **一周内买到第一只**。T5 周产 2 只，等超过一周说明卡在
 *        **资源**（买不起），不是卡在产量。这条是 V4 的本体。
 *        为什么不是 4 天：实测中位 2 / 2 / 4 / 2（新价）对 2 / 2 / 4 / **10**（旧价），
 *        4 天会让翠林的 4 天贴线，任一局抖动就误报；6 天仍能抓住 10 天的陷阱，且留 2 天余量。
 *   [L3] 最长 ≤ 14 天 —— 只防死锁（两周空窗是 D 复核里 p4 的 28 天那种形状），不追求均匀。
 *   [L4] 未买到率 ≤ 25% —— 建了居所却 60 天没买到一只，是"卖了个买不起的东西"。
 *   [L5] 度量有效：至少一族中位 > 0。全 0 说明夹具失效（例如居所与首只同时出现）。
 *        负向对照（旧造价）见下，它证明 [L2] 不是恒真式。
 *
 * ## 夹具（为什么 p1 要手动跑一个 AI 回合）
 * `turn.ts` 里写着 `if (player === 'p1') continue;` —— p1 是固定的人类席位。
 * 不补这一手，p1 会永远停在初始建筑（实测 8/8 局都没有 dwell5），
 * 而 p1 恰恰是"5 木 + 5 矿"的那一族，漏掉它等于漏掉最大的非金项。
 * 所以夹具把四族都标成 `isHuman = false`，然后**替 p1 调一次 `runAiTurn`**。
 * 代价：p1 的回合排在其他三族之后（正常对局里它先动），且它带着玩家的开局加成
 * （`playerStartMul`）。这两点都会让 p1 的读数**偏乐观**，读数时要知道。
 *
 * ## 负向对照
 * ```
 *   cp -R dist /tmp/dist-rareold   # 把两行造价改回 gem 2 / crystal 4
 *   node tools/probes/t5lag.mjs --dist=/tmp/dist-rareold --gate
 * ```
 * 要求 rc=1：**紫晶 [L2] 红**（旧价 10 天，新价 2~3）。翠林旧价 4 天、未触闸 ——
 * 它只是"宝石 2 → 1"的小改善，不是陷阱；真正让 T5 买不起的是 4 个水晶。
 *
 * ## 用法
 * ```
 *   node tools/probes/t5lag.mjs                  # 报告模式（退出码 0）
 *   node tools/probes/t5lag.mjs --gate           # 判据模式
 *   node tools/probes/t5lag.mjs --seeds=12 --json=tools/baseline/after-b5.json
 * ```
 */
import { argOf, distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';

const DIST = distDir();
const DIST_FP = printHeader(DIST, 'gate=t5lag');
requireFile(DIST, 'core/map/generator.js');
requireFile(DIST, 'core/game/turn.js');
requireFile(DIST, 'core/game/ai.js');
requireFile(DIST, 'core/data/units.js');
requireFile(DIST, 'core/combat/damage.js');

const { createGame } = await import(distUrl('core/map/generator.js', DIST));
const { endDay } = await import(distUrl('core/game/turn.js', DIST));
const { runAiTurn } = await import(distUrl('core/game/ai.js', DIST));
const { getUnit, UNITS, FACTION_UNITS } = await import(distUrl('core/data/units.js', DIST));
const { powerRef } = await import(distUrl('core/combat/damage.js', DIST));

const SEEDS = Number(argOf('seeds', 16));
const DAYS = Number(argOf('days', 60));
const GATE = process.argv.includes('--gate');
const JSON_OUT = argOf('json', null);

const F = ['p1', 'p2', 'p3', 'p4'];
const FNAME = { p1: '晨曦', p2: '赤焰', p3: '翠林', p4: '紫晶' };
const SEED0 = 4242;
const SEED_STEP = 977;

const hasT5 = (army) => (army ?? []).some((a) => a.count > 0 && getUnit(a.unitTypeId).tier === 5);
const med = (xs) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const pct = (n, d) => (d ? (100 * n) / d : 0);

console.log(`\n=== T5 滞后（${SEEDS} 局 × ${DAYS} 天，种子 ${SEED0}+${SEED_STEP}s）===`);

/** 每族的逐局读数。`neverBuy` 单独记：建了居所却没买到 = 最坏的价格读数。 */
const rec = Object.fromEntries(F.map((f) => [f, { dwell: [], buyLag: [], fieldLag: [], neverBuy: 0, noDwell: 0 }]));
let statusResets = 0;
let t5Games = 0;

for (let s = 0; s < SEEDS; s++) {
  const seed = SEED0 + s * SEED_STEP;
  const state = createGame({
    seed,
    size: 'medium',
    layout: 'wild',
    opponents: 3,
    difficulty: 'normal',
    playerName: '指挥官',
  });
  /* 四族都交给 AI（理由见文件头）。p1 那一手仍要手动补，因为 `turn.ts` 按 id 跳过。 */
  for (const p of Object.values(state.players)) p.isHuman = false;

  const got = Object.fromEntries(F.map((f) => [f, { dwell: null, buy: null, field: null }]));
  for (let d = 1; d <= DAYS; d++) {
    endDay(state);
    if (state.status !== 'playing') {
      state.status = 'playing';
      statusResets++;
    }
    runAiTurn(state, 'p1');

    for (const f of F) {
      const g = got[f];
      const towns = Object.values(state.towns).filter((t) => t.owner === f);
      const heroes = Object.values(state.heroes).filter((h) => h.owner === f);
      if (g.dwell === null && towns.some((t) => t.buildings.includes('dwell5'))) g.dwell = d;
      const inGarrison = towns.some((t) => hasT5(t.garrison));
      const onHero = heroes.some((h) => hasT5(h.army));
      if (g.buy === null && (inGarrison || onHero)) g.buy = d;
      if (g.field === null && onHero) g.field = d;
    }
  }

  for (const f of F) {
    const g = got[f];
    const r = rec[f];
    if (g.dwell === null) {
      r.noDwell++;
      continue;
    }
    r.dwell.push(g.dwell);
    if (g.buy === null) {
      r.neverBuy++;
      continue; // 截尾：不能当 0 天，也不能悄悄丢掉 —— 单独计数
    }
    r.buyLag.push(g.buy - g.dwell);
    if (g.field !== null) r.fieldLag.push(g.field - g.buy);
    t5Games++;
  }
}

const table = {};
for (const f of F) {
  const r = rec[f];
  table[f] = {
    dwellSamples: r.dwell.length,
    buySamples: r.buyLag.length,
    buyLagMedian: med(r.buyLag),
    buyLagMax: r.buyLag.length ? Math.max(...r.buyLag) : null,
    neverBuy: r.neverBuy,
    noDwell: r.noDwell,
    fieldLagMedian: med(r.fieldLag),
    buyLags: r.buyLag,
    fieldLags: r.fieldLag,
  };
}

console.log('\n  族   落成  买到   中位  最长  建了没买   上阵滞后中位');
for (const f of F) {
  const t = table[f];
  const pad = (v, n) => String(v ?? '—').padStart(n);
  console.log(
    `  ${FNAME[f]} ${pad(t.dwellSamples, 4)}  ${pad(t.buySamples, 4)}  ${pad(t.buyLagMedian ?? '—', 5)}  ` +
      `${pad(t.buyLagMax ?? '—', 4)}  ${pad(t.neverBuy, 8)}   ${pad(t.fieldLagMedian ?? '—', 10)}`,
  );
  console.log(`       逐局 ${t.buyLags.length ? t.buyLags.join(',') : '—'}`);
}

/* 名义每金：不再是判据，只留作对账（旧 V4 的 25.5% 就是这一列）。 */
const t5 = F.map((f) => {
  const id = FACTION_UNITS[f].find((x) => UNITS[x].tier === 5);
  const u = UNITS[id];
  return { id, power: powerRef(u), gold: u.cost.gold, cost: u.cost };
});
const perGold = t5.map((x) => x.power / x.gold);
console.log(
  `\n  [读数] 名义每金 ${perGold.map((x) => x.toFixed(3)).join(' / ')}` +
    ` 极差 ${((Math.max(...perGold) / Math.min(...perGold) - 1) * 100).toFixed(1)}%（旧 V4 判据，已不作数）`,
);
console.log(`  [读数] T5 造价 ${t5.map((x) => `${getUnit(x.id).name} ${JSON.stringify(x.cost)}`).join(' · ')}`);

/* ---------------------------------------------------------------- 闸 */
const verdict = [];
const chk = (name, ok, detail) => verdict.push({ name, ok, detail });
/* 固定 3，不随局数放大：`[L2]` 的 6 天阈值已经为小样本留了余量（见文件头）。
   按比例放大（16 局 ⇒ 4）会让紫晶这种"被强势 p1 压到只剩 4 局"的族随机掉闸。 */
const SAMPLE_MIN = 3;
const SHARE_MAX = 25; // 未买到率上限（%）

for (const f of F) {
  const t = table[f];
  chk(
    `[L1] ${FNAME[f]} 覆盖 ≥${SAMPLE_MIN} 个样本（落成 ${t.dwellSamples} / 买到 ${t.buySamples}）`,
    t.buySamples >= SAMPLE_MIN,
    t.buySamples >= SAMPLE_MIN ? 'ok' : `只有 ${t.buySamples}`,
  );
  chk(
    `[L2] ${FNAME[f]} 采购滞后中位 ≤6 天`,
    t.buyLagMedian !== null && t.buyLagMedian <= 6,
    t.buyLagMedian === null ? '量不到' : `${t.buyLagMedian} 天`,
  );
  chk(
    `[L3] ${FNAME[f]} 最长 ≤14 天（只防死锁）`,
    t.buyLagMax !== null && t.buyLagMax <= 14,
    t.buyLagMax === null ? '量不到' : `${t.buyLagMax} 天`,
  );
  chk(
    `[L4] ${FNAME[f]} 建了居所却没买到的比例 ≤${SHARE_MAX}%`,
    pct(t.neverBuy, t.dwellSamples) <= SHARE_MAX,
    `${t.neverBuy}/${t.dwellSamples} = ${pct(t.neverBuy, t.dwellSamples).toFixed(0)}%`,
  );
}
const anyPositive = F.some((f) => (table[f].buyLagMedian ?? 0) > 0);
chk('[L5] 度量有效：至少一族中位 >0（全 0 = 夹具失效）', anyPositive, anyPositive ? 'ok' : '全 0');

console.log('\n=== 判据 ===');
for (const v of verdict) console.log(`  ${v.ok ? '✓' : '✗'} ${v.name} :: ${v.detail}`);
const fail = verdict.filter((v) => !v.ok).length;
console.log(`\n  覆盖：${t5Games} 个「有 T5 的族-局」；状态复位 ${statusResets} 次（夹具把已分胜负的局继续推进）`);
console.log(`  上阵滞后（只读，D4 已拍板不做）：${F.map((f) => `${FNAME[f]} ${table[f].fieldLagMedian ?? '—'}`).join(' / ')}`);
console.log(fail ? `\n❌ ${fail} 条断言失败` : '\n✅ T5 采购滞后达标');

if (JSON_OUT) {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
  const path = await import('node:path');
  const seg = {
    date: '2026-11-13',
    batch: 'D1',
    seeds: SEEDS,
    days: DAYS,
    distMd5: DIST_FP?.md5 ?? null,
    perFaction: table,
    nominalPerGold: Object.fromEntries(F.map((f, i) => [f, perGold[i]])),
    criteria: { medianMax: 6, tailMax: 14, neverBuyShareMax: SHARE_MAX, sampleMin: SAMPLE_MIN },
    verdict: verdict.map((v) => ({ name: v.name, ok: v.ok, detail: v.detail })),
  };
  /* 读-改-写：只替换 `t5lag` 段，别把别的段冲掉（B5/B3b/B3c 都在同一份基线里）。 */
  let base = {};
  try {
    base = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
  } catch {
    base = {};
  }
  mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify({ ...base, t5lag: seg }, null, 2) + '\n');
  console.log(`  已写入 ${JSON_OUT}（t5lag 段）`);
}

process.exit(GATE && fail ? 1 : 0);
