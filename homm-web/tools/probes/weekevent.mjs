#!/usr/bin/env node
/**
 * weekevent.mjs —— 周生长事件（§19.2 / EV1）的机检（`npm run probe:weekevent`）。
 *
 * ## 它守什么
 * §19.2 有三处**很容易实现成"差不多"**的地方，每一处都要有读数：
 *
 *   [A] 概率：**生物周 25% / 瘟疫 8% / 平静 67%**，第 3 周起才掷。
 *       只读"掷了一次是生物周"不算数 —— 必须跑足够多次看分布（±3pt）。
 *   [B] 教学期：第 1~2 周**恒为平静**。这条是负数判据：若把 `MIN_WEEK` 改成 1，
 *       B1 会立刻数出非平静。
 *   [C] 数值：`exact = (growthPerWeek + eventAdd) × townMult × eventMult × …`。
 *       探针不重算这个公式，而是**跑两臂**：同一份存档，一臂平静、一臂带事件，
 *       逐城逐兵比 `growthPool + growthRemainder` 的差 —— 差必须**恰好**等于
 *       `eventAdd × townMult × tierMult × dwellMult`。
 *       · C2 是"按档递减"：T1 +5 / T2 +3 / T3 +2，不是一律 +5；
 *       · C3 是"只加被抽中的兵"：同城其它档、异族同档都必须为 0；
 *       · C4 是"加到当前产出的形态"：兵营 L2 后增量必须落在 `_u`，基础版池为 0。
 *   [D] 瘟疫：两臂的池子比 = 0.5（±1 整数化），且**已招募部队一个都不少**
 *       （§19.2.1 读法 A；若谁把"减半"实现成砍部队，这条会红）。
 *   [E] 接进 `endDay`：第 3/4 周真的掷了、日志里有公告、`weekEvent` 与周号一致、
 *       同种子重跑逐字段一致（事件走单开的 `deriveSeed(seed,'week',week)` 流）。
 *   [F] 回归：**不传事件的旧调用**与"平静周"的新调用逐位相同 —— 这是
 *       "不碰现有随机流"的可执行版本（旧读数因此全部保持有效）。
 *
 * ## 负向对照（复跑手册）
 * · `WEEK_EVENT_MIN_WEEK` 改成 1 ⇒ [B1] 红；
 * · `GROWTH_EVENT_ADD` 改成一律 5 ⇒ [C2] 红；
 * · `eventAddOf()` 不比对 `unitTypeId`（对所有兵生效）⇒ [C3] 红；
 * · `applyWeeklyGrowth` 里用 `unitTypeId`（而不是 `baseUnitIdOf`）比对 ⇒ [C4] 红；
 * · 瘟疫改成 `takeFromArmy` ⇒ [D2] 红；
 * · `deriveSeed` 少传 week（每周同结果）⇒ [A1]/[E2] 红。
 *
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足（缺 dist）
 */
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=weekevent');
requireFile(DIST, 'core/game/week.js');
requireFile(DIST, 'core/game/turn.js');

const W = await import(distUrl('core/game/week.js', DIST));
const T = await import(distUrl('core/game/town.js', DIST));
const U = await import(distUrl('core/data/units.js', DIST));
const F = await import(distUrl('core/data/factions.js', DIST));
const B = await import(distUrl('core/data/buildings.js', DIST));
const CAL = await import(distUrl('core/game/calendar.js', DIST));
const { createGame } = await import(distUrl('core/map/generator.js', DIST));
const { endDay } = await import(distUrl('core/game/turn.js', DIST));

let bad = 0;
const PASS = (c, m) => {
  if (!c) bad++;
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`);
};
const HEAD = (t) => console.log(`\n== ${t} ==`);

const clone = (v) => JSON.parse(JSON.stringify(v));

/** 某城镇某兵种"池子 + 小数余数"= 这周实际长了多少（整数化不丢精度）。 */
function total(town, unitId) {
  return (town.growthPool?.[unitId] ?? 0) + (town.growthRemainder?.[unitId] ?? 0);
}

/** 某阵营某档的周产倍率三件套（与 `applyWeeklyGrowth` 同一个来源，不在探针里重写）。 */
function mults(state, town, tier, eventMult) {
  const isHuman = !!state.players[town.owner]?.isHuman;
  const diff = F.DIFFICULTIES[state.config?.difficulty ?? 'normal'];
  const bonus = isHuman ? diff.playerGrowthBonus : diff.growthBonus;
  return (
    T.weeklyGrowthMultiplier(town, bonus, eventMult) *
    T.tierGrowthMultiplier(town, tier) *
    T.dwellingLevelGrowthMult(town, tier)
  );
}

/* ==================================================================== *
 * A. 概率分布（纯函数，跑 3,000 次）
 * ==================================================================== */
HEAD('A. 概率：25% / 8% / 67%（第 3 周起）');
const N = 3000;
const tally = { growth: 0, plague: 0, calm: 0 };
let week3NonCalm = 0;
for (let i = 0; i < N; i++) {
  const seed = 4000 + i * 7919;
  const week = 3 + (i % 23);
  const ev = W.weekEventFor(seed, week);
  tally[ev.kind] += 1;
  if (week === 3 && ev.kind !== 'calm') week3NonCalm += 1;
}
const pct = (k) => (tally[k] / N) * 100;
PASS(Math.abs(pct('growth') - 25) <= 3, `A1 生物周 ${pct('growth').toFixed(1)}% ∈ 25±3（${tally.growth}/${N}）`);
PASS(Math.abs(pct('plague') - 8) <= 3, `A2 瘟疫 ${pct('plague').toFixed(1)}% ∈ 8±3（${tally.plague}/${N}）`);
PASS(Math.abs(pct('calm') - 67) <= 3, `A3 平静 ${pct('calm').toFixed(1)}% ∈ 67±3（${tally.calm}/${N}）`);
PASS(week3NonCalm > 0, `A4 第 3 周确实会掷出非平静（${week3NonCalm} 次）`);

/* ==================================================================== *
 * B. 教学期
 * ==================================================================== */
HEAD('B. 教学期：第 1~2 周恒为平静');
let early = 0;
for (let s = 0; s < 400; s++) {
  for (const wk of [1, 2]) {
    if (W.weekEventFor(1000 + s * 31, wk).kind !== 'calm') early++;
  }
}
PASS(early === 0, `B1 800 次（400 seed × 第 1/2 周）非平静 ${early} 次，必须 0`);

/* ==================================================================== *
 * C. 数值：两臂对比
 * ==================================================================== */
HEAD('C. 数值：两臂对比（同存档，一臂平静、一臂带事件）');

/** 造一份可控存档：四阵营的有主城镇补齐 T1~T3 兵营，池子清零。 */
function armedState(seed) {
  const st = createGame({ seed, layout: 'wild', size: 'small', opponents: 3 });
  for (const town of Object.values(st.towns)) {
    if (!st.players[town.owner]) continue; // 中立城没有产出
    town.buildings = town.buildings.filter((b) => !['dwell1', 'dwell2', 'dwell3'].includes(b));
    town.buildings.push('dwell1', 'dwell2', 'dwell3');
    town.growthPool = {};
    town.growthRemainder = {};
    town.levels = {};
  }
  return st;
}

/** 找一个指定事件类型的种子（第 3 周），保证 C/D 量的是事件而不是平静。 */
function seedWith(kind, week = 3) {
  for (let s = 1; s < 4000; s++) if (W.weekEventFor(s, week).kind === kind) return s;
  return 1;
}

const growthSeed = seedWith('growth');
const evG = W.weekEventFor(growthSeed, 3);
console.log(`   （生物周 seed=${growthSeed}：${evG.unitTypeId} T${evG.tier} +${evG.add}）`);

const armCalm = armedState(growthSeed);
const armGrow = clone(armCalm);
T.applyWeeklyGrowth(armCalm, 1, () => 0);
T.applyWeeklyGrowth(armGrow, evG.mult, W.eventAddOf(evG));

let c1ok = true;
let c3ok = true;
let hitTiers = new Set();
for (const town of Object.values(armGrow.towns)) {
  const twin = armCalm.towns[town.id];
  if (!twin) continue;
  for (const b of town.buildings) {
    const g = B.BUILDINGS[b]?.growth;
    if (!g) continue;
    const uid = U.unitIdForTier(town.owner, g.tier, false);
    if (!uid) continue;
    const upId = U.unitIdForTier(town.owner, g.tier, true) ?? uid;
    const delta =
      total(town, uid) + (upId !== uid ? total(town, upId) : 0) -
      (total(twin, uid) + (upId !== uid ? total(twin, upId) : 0));
    const isTarget = evG.unitTypeId === U.baseUnitIdOf(uid);
    const expect = isTarget ? (evG.add ?? 0) * mults(armGrow, twin, g.tier, evG.mult) : 0;
    if (Math.abs(delta - expect) > 1e-9) {
      c1ok = false;
      console.log(`      ✗ ${town.id} ${uid}: 实测 ${delta} ≠ 期望 ${expect}`);
    }
    if (isTarget && delta > 1e-9) hitTiers.add(g.tier);
    if (!isTarget && Math.abs(delta) > 1e-9) c3ok = false;
  }
}
PASS(c1ok, 'C1 每个城镇的增量 = eventAdd × townMult × tierMult × dwellMult（误差 0）');
PASS(
  W.GROWTH_EVENT_ADD[1] === 5 && W.GROWTH_EVENT_ADD[2] === 3 && W.GROWTH_EVENT_ADD[3] === 2,
  `C2 按档递减表 = {T1:5, T2:3, T3:2}（实测 ${JSON.stringify(W.GROWTH_EVENT_ADD)}）`,
);
PASS(
  (evG.add ?? 0) === W.GROWTH_EVENT_ADD[evG.tier] && hitTiers.size === 1 && hitTiers.has(evG.tier),
  `C2b 事件增量只出现在 T${evG.tier}（+${evG.add}），没有波及其它档`,
);
PASS(c3ok, 'C3 只有被抽中的兵有增量；异族同档、同城其它档恒 0');

// C4：兵营 L2 ⇒ 加到升级形态；基础版池必须为 0
{
  const st = armedState(growthSeed);
  const target = evG.unitTypeId;
  const owner = target.slice(0, 2);
  const town = Object.values(st.towns).find((t) => t.owner === owner && st.players[t.owner]);
  const dwellId = ['dwell1', 'dwell2', 'dwell3'][evG.tier - 1];
  town.levels = { [dwellId]: 2 };
  const before = clone(st);
  T.applyWeeklyGrowth(st, evG.mult, W.eventAddOf(evG));
  const upId = U.upgradedUnitIdOf(target);
  const baseGain = total(st.towns[town.id], target) - total(before.towns[town.id], target);
  const upGain = upId ? total(st.towns[town.id], upId) - total(before.towns[town.id], upId) : 0;
  const expect = upId
    ? (U.getUnit(upId).growthPerWeek + (evG.add ?? 0)) *
      mults(st, before.towns[town.id], evG.tier, evG.mult)
    : 0;
  PASS(
    !!upId && Math.abs(upGain - expect) < 1e-9 && Math.abs(baseGain) < 1e-9,
    `C4 L2 兵营：增量落在 ${upId}（+${upGain.toFixed(2)}，期望 ${expect.toFixed(2)}），基础版 ${target} 增 ${baseGain}`,
  );
}

/* ==================================================================== *
 * D. 瘟疫
 * ==================================================================== */
HEAD('D. 瘟疫：产量 ×0.5，已招募部队不动');
const plagueSeed = seedWith('plague');
const evP = W.weekEventFor(plagueSeed, 3);
console.log(`   （瘟疫 seed=${plagueSeed}）`);
{
  const st = armedState(plagueSeed);
  const a = clone(st);
  const b = clone(st);
  T.applyWeeklyGrowth(a, 1, () => 0);
  T.applyWeeklyGrowth(b, evP.mult, W.eventAddOf(evP));
  let d1 = true;
  let sample = '';
  for (const town of Object.values(b.towns)) {
    const twin = a.towns[town.id];
    if (!twin) continue;
    for (const uid of new Set([...Object.keys(town.growthPool), ...Object.keys(twin.growthPool)])) {
      const got = total(town, uid);
      const was = total(twin, uid);
      if (was <= 0) continue;
      if (Math.abs(got - was * 0.5) > 1) {
        d1 = false;
        console.log(`      ✗ ${town.id} ${uid}: 瘟疫 ${got} ≠ 平静 ${was} 的一半`);
      }
      if (!sample) sample = `${uid} ${was} → ${got}`;
    }
  }
  PASS(d1, `D1 每兵种池子 = 平静周的 0.5 倍（±1 整数化；样本 ${sample}）`);
}
{
  // D2：跑真 endDay。只看 p1 —— AI 在增长之后还会招募，混进来就不是"瘟疫砍部队"的读数。
  const st = createGame({ seed: plagueSeed, layout: 'wild', size: 'small', opponents: 3 });
  while (st.day < 14) endDay(st);
  const p1Army = () =>
    JSON.stringify(
      st.heroOrder.filter((id) => st.heroes[id]?.owner === 'p1').map((id) => st.heroes[id].army),
    );
  const before = p1Army();
  endDay(st); // day 15 = 第 3 周
  PASS(
    st.weekEvent?.kind === 'plague' && before === p1Army(),
    `D2 第 3 周确为瘟疫（${st.weekEvent?.kind}），p1 已招募部队 ${before === p1Army() ? '完全未变' : '被砍了'}`,
  );
}

/* ==================================================================== *
 * E. 接进 endDay
 * ==================================================================== */
HEAD('E. 接进 endDay：掷点 / 公告 / 确定性');
const seed = growthSeed;
const st = createGame({ seed, layout: 'wild', size: 'small', opponents: 3 });
const seen = [];
/** 公告必须在**当天**就在日志里（日志只留 60 条，第 28 天再回头查会被挤掉）。 */
const announced = [];
for (let i = 0; i < 28; i++) {
  endDay(st);
  if (CAL.isNewWeek(st.day)) {
    const ev = clone(st.weekEvent);
    seen.push({ day: st.day, week: CAL.weekOf(st.day), ev });
    if (ev.kind !== 'calm') {
      announced.push({
        day: st.day,
        ok: st.log.some((l) => l.day === st.day && l.text === ev.text),
        text: ev.text,
      });
    }
  }
}
PASS(seen.length === 4, `E0 28 天跨 4 个周界（实测 ${seen.length}）`);
PASS(seen[0].ev.kind === 'calm', `E1 第 2 周恒平静（实测 ${seen[0].ev.kind}）`);
PASS(
  seen.slice(1).every((s) => JSON.stringify(s.ev) === JSON.stringify(W.weekEventFor(seed, s.week))),
  'E2 第 3~5 周的事件 = weekEventFor(seed, 周号)（逐字段一致）',
);
PASS(
  seen.every((s) => s.ev.week === s.week),
  'E3 weekEvent.week 恒等于当前周号（不会残留上周）',
);
{
  const miss = announced.filter((a) => !a.ok);
  PASS(
    miss.length === 0,
    `E4 每个非平静周都在当天日志里公告（${announced.length} 个事件周，缺 ${miss.length}）${
      miss.length ? ` · 缺：${miss.map((m) => `第${m.day}天「${m.text}」`).join(' / ')}` : ''
    }`,
  );
}
{
  const round = JSON.parse(JSON.stringify(st));
  PASS(
    !!round.weekEvent && round.weekEvent.kind === st.weekEvent.kind,
    'E5 weekEvent 进 JSON 存档后仍可读（读档能解释"池子为什么多/少"）',
  );
}
{
  const st2 = createGame({ seed, layout: 'wild', size: 'small', opponents: 3 });
  for (let i = 0; i < 28; i++) endDay(st2);
  const pools = (s) =>
    JSON.stringify(
      Object.values(s.towns)
        .map((t) => [t.id, t.growthPool, t.growthRemainder])
        .sort(),
    );
  PASS(
    JSON.stringify(st.weekEvent) === JSON.stringify(st2.weekEvent) && pools(st) === pools(st2),
    'E6 同种子两次 28 天：周事件与增长池逐字节一致',
  );
}

/* ==================================================================== *
 * F. 回归
 * ==================================================================== */
HEAD('F. 回归：旧调用 == 平静周的新调用');
{
  const a = armedState(growthSeed);
  const b = clone(a);
  T.applyWeeklyGrowth(a); // 旧签名（eventMult 默认 1、没有 eventAdd）
  T.applyWeeklyGrowth(b, 1, () => 0); // 事件系统接上后的"平静"路径
  const dump = (s) =>
    JSON.stringify(
      Object.values(s.towns)
        .map((t) => [t.id, t.growthPool, t.growthRemainder])
        .sort(),
    );
  PASS(dump(a) === dump(b), 'F1 不传事件时，增长池与改动前逐位相同（其它门的读数不受影响）');
}

console.log('');
if (bad) console.log(`✗ ${bad} 条断言未过`);
else console.log('✓ 周生长事件全过');
process.exit(bad ? 1 : 0);
