#!/usr/bin/env node
/**
 * grimscontact.mjs —— 图三《破碎罗盘》`grims-showcase`（40×40 · 3 对手 · `aiIntent:'rush'`）
 * 的**接触日门控**。
 *
 * 为什么单列一个门：`tools/contactaudit.mjs` 只覆盖图二《对决场》（32×32 · 1 对手），
 * 而用户真机试玩看到的是**图三**。40×40 + 3 家 AI 与 32×32 + 1 家 AI 不是同一个量级的问题：
 * 距离更长、AI 更多（每家都要各自跨过半张图）、导入地形可能有走不通的海峡。
 * ⇒ **"图二达标"不能推出"图三达标"**，必须在新图上重测。
 *
 * 三组（同一批种子、同一张图）：
 *   A `rush`     —— 场景原样（`scenario:'grims-showcase'` ⇒ `aiIntent:'rush'` 生效）。**被测组**。
 *   B `norush`   —— 只清 `state.config.scenario`（地图/物件已生成完，清它只影响运行时 AI 意图）。
 *                   **信息组**：证明"是 rush 起的作用"，不是硬断言（图三的承诺只要求 A 达标）。
 *   C `frozen`   —— **阳性对照**：把 p2/p3/p4 的 `isHuman` 置 `true`
 *                   ⇒ `turn.ts:endDay()` 与 `ai.ts:runAiTurn()` **两处都会跳过它们** ⇒ AI 真正一天不动。
 *                   ★ 硬断言：C 必须报 **>8**（否则说明本测量**分辨不出"AI 不动"** ⇒ 门是假绿）。
 *
 * 判据：
 *   · 接触日 **中位数 ≤ 8**（本轮目标；比 `contactaudit` 给图二的 18 天硬上限更严，因为图三是展示图）。
 *   · 样本 ≥ 16 局。
 *   · 阳性对照（C）必须 >8。
 *
 * 退出码（沿用 `tools/GATES.md` §二 四码）：
 *   0 = 全过；1 = 实测不达标（**量到了，结论"不过"**）；2 = 前置不满足（dist 缺失）；
 *   3 = **读数不可信**（跑的过程中**被测构建指纹**变了 ⇒ 本次结论作废）。
 *   ★ 1 / 2 / 3 不得混用：2 是"没跑成"，3 是"量错了对象"，1 是"量到了但不过"。
 *   ★ 阳性对照失败归 **1**（它是一条**硬断言**：门本身不判 ⇒ 结论"不过"），并在输出里写明"门为假绿"。
 *
 * 用法：npm run build && node tools/grimscontact.mjs [--dist=<dir>] [--days=21] [--arm=rush]
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { distDir, distUrl, printHeader, fingerprint, argOf, REPO_ROOT } from './_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=grimscontact');

if (!existsSync(path.join(DIST, 'core', 'map', 'generator.js'))) {
  console.error(`dist 不存在，请先 npm run build（或 --dist=<dir> 指向隔离构建）：${DIST}`);
  process.exit(2);
}

/** 跑前指纹（元纪律：判据 = **被测对象**跑内是否变过，不是 `git status`）。 */
const fpKey = (fp) => `${fp.md5 ?? 'n/a'}|${fp.sha256 ?? 'n/a'}|${(fp.files ?? []).join(',')}`;
const FP0 = fpKey(fingerprint(DIST));

const { createGame, BASE_MOVE_POINTS } = await import(distUrl('core/map/generator.js', DIST));
const { computePaths } = await import(distUrl('core/map/pathfinding.js', DIST));
const { endDay } = await import(distUrl('core/game/turn.js', DIST));
const { SCENARIO_BY_ID } = await import(distUrl('core/data/scenarios.js', DIST));

const grims = SCENARIO_BY_ID['grims-showcase'];
if (!grims) {
  console.error("SCENARIO_BY_ID['grims-showcase'] 不存在 —— 场景数据没接上");
  process.exit(2);
}

const DAYS = Number.parseInt(argOf('days', '21'), 10) || 21;
const ARM_ONLY = argOf('arm', null);
/** `--deep=1`：不提前收工，跑满 `DAYS` 天以量"AI 最近逼近到几格"（信息用，慢一些）。 */
const DEEP = argOf('deep', '0') === '1';

/** 16 颗种子（前 8 颗与 `contactaudit.mjs` 的 SEEDS 逐字相同，便于两图对齐读数）。 */
const SEEDS = Array.from({ length: 16 }, (_, k) => 1000 + 7717 * k);
const idx = (m, x, y) => y * m.width + x;
/** 中位数：偶数个取**下中位**（与 `contactaudit.mjs` 同口径）。 */
const median = (a) => {
  const n = a.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((x, y) => x - y);
  return n.length ? n[(n.length - 1) >> 1] : NaN;
};

let bad = 0;
const PASS = (c, msg) => {
  if (!c) bad++;
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${msg}`);
};
const INFO = (msg) => console.log(`[信息] ${msg}`);

/** 生成图三的一张图（带 `scenario` ⇒ 静态地形 + rush 意图）。 */
const gen = (seed) => createGame({ ...grims.config, seed, scenario: grims.id });

/**
 * 跑最多 `DAYS` 天，返回首次接触日；未接触记哨兵 `NO`（= DAYS+1，打印成 `>DAYS`）。
 * 判据与 `contactaudit.mjs` 逐字一致：AI 英雄进入"玩家主城曼哈顿 ≤5 格"**或**"1 日可达"
 * （行军代价 ≤ BASE_MOVE_POINTS）。
 */
const NO = DAYS + 1;
function runContact(state) {
  let first = null;
  const start = Object.fromEntries(
    Object.values(state.heroes).filter((h) => h.owner !== 'p1' && h.owner !== 'neutral').map((h) => [h.id, { ...h.pos }]),
  );
  let sortie = null;
  let adj = null;
  let minMan = Infinity;
  let minCost = Infinity;
  for (let day = 1; day <= DAYS && state.status === 'playing'; day++) {
    const home = state.towns['town_home'];
    if (!home || home.owner !== 'p1') break;
    const hp = home.pos;
    for (const h of Object.values(state.heroes)) {
      if (h.owner === 'p1' || h.owner === 'neutral') continue;
      if (sortie === null && start[h.id]) {
        const d = Math.abs(h.pos.x - start[h.id].x) + Math.abs(h.pos.y - start[h.id].y);
        if (d >= 4) sortie = day;
      }
      const pf = computePaths(state, h.pos, Infinity);
      const c = pf.cost[idx(state.map, hp.x, hp.y)];
      const man = Math.abs(h.pos.x - hp.x) + Math.abs(h.pos.y - hp.y);
      if (first === null && (man <= 5 || (Number.isFinite(c) && c > 0 && c <= BASE_MOVE_POINTS))) first = day;
      // 只算"贴脸"（曼哈顿 ≤5）：排除"1 日可达"这个较松的口径，看真正的**见面**日。
      if (adj === null && man <= 5) adj = day;
      if (man < minMan) minMan = man;
      if (Number.isFinite(c) && c > 0 && c < minCost) minCost = c;
    }
    // `--deep=1` 时不提前收工：跑满 DAYS 天，好量"AI 到底最近逼近到几格"。
    if (!DEEP && first !== null) break;
    endDay(state);
  }
  return { contact: first ?? NO, adj: adj ?? NO, sortie: sortie ?? NO, minMan, minCost };
}

/** 阳性对照：把 AI 三家标成"人类" ⇒ `endDay` 与 `runAiTurn` 两道闸都跳过它们 ⇒ AI 一天不动。 */
function freezeAi(state) {
  for (const p of ['p2', 'p3', 'p4']) {
    const pl = state.players[p];
    if (pl) pl.isHuman = true;
  }
  return state;
}

const arms = ARM_ONLY ? [ARM_ONLY] : ['rush', 'norush', 'frozen'];
const results = {};
for (const arm of arms) results[arm] = [];

console.log(`── 图三《破碎罗盘》grims-showcase · 首次接触日（${SEEDS.length} seeds · ≤${DAYS} 天）──`);
console.log(`   地形=${grims.staticMap ? '静态导入 ' + grims.staticMap.width + '×' + grims.staticMap.height : '(无)'} · 对手=${grims.config.opponents} · aiIntent=${grims.aiIntent}`);
console.log(`   接触判据（与 contactaudit 同口径）：AI 英雄进入玩家主城曼哈顿 ≤5 格 或 行军代价 ≤ ${BASE_MOVE_POINTS}`);

for (const seed of SEEDS) {
  for (const arm of arms) {
    const s = gen(seed);
    if (arm === 'norush') s.config.scenario = undefined; // 地图已生成完 ⇒ 只关掉运行时 AI 意图
    if (arm === 'frozen') freezeAi(s);
    results[arm].push({ seed, ...runContact(s) });
  }
}
void REPO_ROOT;

const fmtAll = (rs) => rs.map((r) => (r.contact === NO ? `>${DAYS}` : String(r.contact))).join(',');
const fmtSortie = (rs) => rs.map((r) => (r.sortie === NO ? `>${DAYS}` : String(r.sortie))).join(',');

for (const arm of arms) {
  const rs = results[arm];
  const cs = rs.map((r) => r.contact);
  const m = median(cs);
  const never = cs.filter((x) => x === NO).length;
  console.log(`\n  ── ${arm} ──`);
  console.log(`  接触日   = [${fmtAll(rs)}]`);
  console.log(`  中位 ${m === NO ? `>${DAYS}` : m} · 均值 ${(cs.reduce((a, b) => a + (b === NO ? DAYS + 1 : b), 0) / cs.length).toFixed(2)} · 从不接触 ${never}/${cs.length}`);
  console.log(`  首次出击日 = [${fmtSortie(rs)}] · 中位 ${(() => { const s = median(rs.map((r) => r.sortie)); return s === NO ? `>${DAYS}` : s; })()}`);
  console.log(`  贴脸日(仅曼哈顿≤5) = [${rs.map((r) => (r.adj === NO ? `>${DAYS}` : String(r.adj))).join(',')}] · 中位 ${(() => { const s = median(rs.map((r) => r.adj)); return s === NO ? `>${DAYS}` : s; })()}`);
  // 分布（不只报中位数 —— 本项目踩过"被污染把中位拉向 1"的坑）
  const buckets = new Map();
  for (const c of cs) {
    const k = c === NO ? `>${DAYS}` : String(c);
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  const dist = [...buckets.entries()].sort((a, b) => {
    const na = a[0] === `>${DAYS}` ? 999 : Number(a[0]);
    const nb = b[0] === `>${DAYS}` ? 999 : Number(b[0]);
    return na - nb;
  });
  console.log(`  分布 = ${dist.map(([k, v]) => `${k}天×${v}`).join('  ')}`);
  if (DEEP) {
    console.log(`  最近逼近(曼哈顿格数) = [${rs.map((r) => (Number.isFinite(r.minMan) ? r.minMan : '-')).join(',')}] · 中位 ${median(rs.map((r) => r.minMan))}`);
    console.log(`  最近逼近(行军代价) = [${rs.map((r) => (Number.isFinite(r.minCost) ? Math.round(r.minCost) : '-')).join(',')}] · 中位 ${Math.round(median(rs.map((r) => r.minCost)))}（1 日 = ${BASE_MOVE_POINTS}）`);
  }
}

console.log('');
// ★ 空集守卫（`#180`）：`.every()` / `median([])` 在空样本上恒真 / `NaN` ⇒ 先钉住人口。
PASS(
  arms.every((a) => results[a].length === SEEDS.length) && SEEDS.length >= 16,
  `人口守卫：每组 ${arms.map((a) => `${a}=${results[a].length}`).join('/')}（须 =${SEEDS.length} 且 ≥16）—— **空集不得通过**`,
);

if (results.rush) {
  const cs = results.rush.map((r) => r.contact);
  const m = median(cs);
  PASS(m <= 8, `接触日中位(rush) = ${m === NO ? `>${DAYS}` : m} ≤ 8（${cs.length} 局；本轮目标 4–8 天内必遇 AI）`);
  INFO(`rush 从不接触 = ${cs.filter((x) => x === NO).length}/${cs.length}`);
}

if (results.norush) {
  const mc = median(results.norush.map((r) => r.contact));
  const mr = median(results.rush?.map((r) => r.contact) ?? []);
  INFO(`对照（仅清意图，AI 未被冻结）：中位 ${mc === NO ? `>${DAYS}` : mc} vs rush ${mr === NO ? `>${DAYS}` : mr} —— 只作信息，不作硬断言`);
}

if (results.frozen) {
  const cs = results.frozen.map((r) => r.contact);
  const m = median(cs);
  const ok = m > 8;
  PASS(
    ok,
    `★阳性对照：AI 被冻结时接触日中位 = ${m === NO ? `>${DAYS}` : m} **> 8**（${cs.filter((x) => x === NO).length}/${cs.length} 局从不接触）` +
      (ok ? '' : ' —— **门为假绿**：本测量分辨不出"AI 完全不动"，A 组的中位不可信'),
  );
}

console.log(`\n${bad === 0 ? '全部通过' : `有 ${bad} 条硬断言不达标`}`);

/* ── 元纪律：跑后指纹（主判据）—— 变了 ⇒ 上面每条 PASS/FAIL 一律作废 ⇒ exit 3 ── */
const FP1 = fpKey(fingerprint(DIST));
if (FP0 !== FP1) {
  console.error('✗ 结果作废（exit 3）：跑的过程中**被测构建变了** ——');
  console.error(`  跑前 ${FP0}`);
  console.error(`  跑后 ${FP1}`);
  console.error('  上面每一条 PASS/FAIL 都不可信（被测对象在脚下被改）。请在构建静止时重跑。');
  process.exit(3);
}
process.exit(bad === 0 ? 0 : 1);
