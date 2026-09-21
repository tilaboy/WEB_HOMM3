#!/usr/bin/env node
/**
 * contactaudit.mjs —— 两张试玩图的**门控**（`design/maps/playtest-scenarios.md` §2.6 / §3.5 / §4）。
 *
 * 为什么单列一个门控：图二的核心承诺「**对手会主动来找你**」此前**无法被任何现有审计覆盖**
 * （`audit:layout` 看结构、`audit:mines` 看矿、`smoke` 看逻辑，都看不到"第几天接触"）。
 * 实测过：默认 AI 在中型图上 **21 天里 8/8 种子从不接近玩家** ⇒ 这条承诺**要么靠 `rush` 成立、
 * 要么整张图是空的**。所以把"接触日"固化成硬断言 —— `rush` 一旦失效（被改回、被绕过），这里会红。
 *
 * 两段：
 *   §1 图一《教学场》：证明**生成期覆盖项真的生效**（V2 + 弱怪 + 怪数），报 1 天圈资源数（V4）。
 *   §2 图二《对决场》：**对照组必须有** —— `rush` 生效 / 未生效各跑 8 seeds，报首次接触日中位数。
 *      ★ **对照必须是同一张图**：两组都从 `createGame({scenario:'duel'})` **生成同一张图**，
 *        control 组**只清** `state.config.scenario`（仅影响运行时 AI 意图）。若两组地图不同构
 *        （`tiles`+`objects[].pos` 不全等）⇒ **FAIL 且两组数字作废**（否则差值混进了"地图不同"）。
 *      硬断言：`median(rush) ≤ 18` **且** `median(rush) < median(control)`。
 *      （只报生效组 = 无法证明是 `rush` 起的作用 —— 规格 §3.5 裁定的硬条件。）
 *
 * 判据口径（主理人 2026-09-21 裁定）：
 *   - 接触 = AI 英雄首次进入"玩家主城 曼哈顿 ≤5 格"（`firstVis`）**或**"1 日可达"
 *     （行军代价 ≤ 1800，`firstMarch`）；取两者之先。
 *   - 上限 **18** 天是**硬**的（≈ 规格预测 4–6 天 + 宽裕余量）；`< 6` 天只 **WARN**
 *     （比预测还早 ⇒ 可能过激进/观感像作弊，值得看一眼，但不算失败）。
 *
 * 用法：npm run build && node tools/contactaudit.mjs
 * 退出码：0 = 全部通过；1 = 有硬断言不达标；2 = 环境没准备好（dist 缺失）；
 *         3 = **结果作废**（跑的过程中**被测构建**变了 —— 见下"元纪律"）。
 *         ★ 3 与 1/2 **不得混用**：1 是"跑了、没达标"，2 是"没跑成"，3 是"跑了但读数不可信"。
 *
 * 元纪律（roadmap 59f8dd1，**已落地** —— 见文件末尾）：
 *   ★ **作废判据 = 被测对象（`DIST`）的指纹跑前/跑后是否相同**，**不是** `git status`。
 *     **为什么不能拿 `git status` 当判据**：`dist/` 是 **gitignored**（`homm-web/.gitignore:3`）
 *     ⇒ `git status --porcelain` **结构上看不见被测对象** —— **真把 `dist` 重建了它也不会变**，
 *     却会被"别人提交一个 docs 文件"触发 ⇒ **该看见的看不见、不该动的乱动**（已实测：本门
 *     改前跑一次就因 `art-director` 提交 docs 而误报作废）。
 *     ⇒ 故判据改用 **`fingerprint(DIST)`**（`main.js` md5 + 复合 sha256 + 文件表）；
 *       `git status` **降级为「只 WARN 的旁证」**：它仍能提示"仓库在动"，但**不作废读数**
 *       （例：台账 `production/roadmap.md` 在飞 —— 与本次读数无关，不得因此作废）。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { distDir, distUrl, printHeader, fingerprint, REPO_ROOT } from './_dist.mjs';

/* `--dist=<dir>`（缺省 `<repo>/dist` = 旧 `../dist`，**逐字不变**）—— team-lead #164：
 * 跑门不必覆盖共用 `dist/`。下面 `../dist/...` 一律经 `u()` 解析到被测目录。 */
const DIST = distDir();
printHeader(DIST, 'gate=contactaudit');
const u = (rel) => distUrl(rel, DIST);

if (!existsSync(path.join(DIST, 'core', 'map', 'generator.js'))) {
  console.error(`dist 不存在，请先 npm run build（或 --dist=<dir> 指向隔离构建）：${DIST}`);
  process.exit(2);
}

/** 取工作树快照（**旁证**用）；取不到（非 git 仓库 / 无 git）⇒ `null`。 */
const treeSnap = () => {
  try {
    return execSync('git status --porcelain', { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch {
    return null;
  }
};
/** 指纹归一成可比较的键：**含 `files` 表**（少一个文件 = 变了，md5 会变 null 也算变）。 */
const fpKey = (fp) => `${fp.md5 ?? 'n/a'}|${fp.sha256 ?? 'n/a'}|${(fp.files ?? []).join(',')}`;
/* ★ 元纪律「跑前」快照 —— 必须在任何读数之前。
 *   主判据 = 被测构建指纹；旁证 = 工作树。 */
const FP0 = fpKey(fingerprint(DIST));
const TREE0 = treeSnap();

const { createGame } = await import(u('core/map/generator.js'));
const { computePaths } = await import(u('core/map/pathfinding.js'));
const { endDay } = await import(u('core/game/turn.js'));
const { SCENARIO_BY_ID } = await import(u('core/data/scenarios.js'));

const SEEDS = [1000, 8717, 16434, 24151, 31868, 39585, 47302, 55019];
const DAY = 1800; // 英雄基准移动力/天（BASE_MOVE_POINTS）
const idx = (m, x, y) => y * m.width + x;
/** 中位数：偶数个取**下中位**（与既有 contactmeasure 口径一致）。 */
const median = (a) => {
  const n = a.filter((x) => typeof x === 'number').sort((x, y) => x - y);
  return n.length ? n[(n.length - 1) >> 1] : NaN;
};

let bad = 0;
const PASS = (c, msg) => {
  if (!c) bad++;
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${msg}`);
};
const WARNL = (msg) => console.log(`[WARN] ${msg}`);

/* ============================ §1 图一《教学场》 ============================ */
console.log('── §1 图一《教学场》· 生成期覆盖项是否真的生效（8 seeds） ──');
const tutorial = SCENARIO_BY_ID.tutorial;
if (!tutorial) {
  console.error('SCENARIO_BY_ID.tutorial 不存在 —— 场景数据没接上');
  process.exit(2);
}
{
  const perSeed = [];
  for (const seed of SEEDS) {
    const s = createGame({ ...tutorial.config, seed, scenario: tutorial.id });
    const objs = Object.values(s.map.objects);
    const monsters = objs.filter((o) => o.kind === 'wanderingMonster');
    const vaults = objs.filter((o) => o.kind === 'vault').length;
    const neutralTowns = Object.values(s.towns).filter((t) => t.owner === 'neutral').length;
    const tiers = monsters.map((o) => o.payload.tier);

    // 从玩家**英雄**起点算可达圈（教学图动线是"出门捡"，起点用英雄而非主城）。
    const hp = s.heroes['hero1'].pos;
    const pf = computePaths(s, hp, Infinity);
    const costAt = (p) => pf.cost[idx(s.map, p.x, p.y)];
    const inRing = (p, maxDay) => {
      const c = costAt(p);
      return Number.isFinite(c) && c > 0 && c <= maxDay * DAY;
    };
    const piles1 = objs.filter((o) => o.kind === 'resourcePile' && inRing(o.pos, 1)).length;
    const chests1 = objs.filter((o) => o.kind === 'treasureChest' && inRing(o.pos, 1)).length;
    const mon15 = monsters.filter((o) => inRing(o.pos, 1.5));
    const mon15Weak = mon15.filter((o) => o.payload.tier === 'weak').length;

    perSeed.push({ seed, total: monsters.length, vaults, neutralTowns, tiers, piles1, chests1, mon15: mon15.length, mon15Weak });
  }

  console.log('  seed   · 全图怪 · vault · 中立城 · 全弱? · 1天圈资源堆 · 宝箱 · 1.5天圈怪(弱)');
  for (const r of perSeed) {
    const allWeak = r.tiers.every((t) => t === 'weak');
    console.log(
      `  ${String(r.seed).padEnd(6)} · ${String(r.total).padStart(5)}  · ${String(r.vaults).padStart(4)}  · ${String(r.neutralTowns).padStart(5)}  · ${(allWeak ? '是' : '否').padEnd(4)} · ${String(r.piles1).padStart(10)}   · ${String(r.chests1).padStart(3)}  · ${r.mon15}(${r.mon15Weak})`,
    );
  }

  // 覆盖项生效 = 确定性的（不依赖种子分布），可硬断言：
  const allFive = perSeed.every((r) => r.total === tutorial.gen.monsterCount);
  const noVault = perSeed.every((r) => r.vaults === 0);
  const noNeutral = perSeed.every((r) => r.neutralTowns === 0);
  const allWeak = perSeed.every((r) => r.tiers.every((t) => t === 'weak'));
  PASS(noVault, `V2 全图 vault = 0（8/8；gen.vaults=0 生效）`);
  PASS(noNeutral, `V2 中立城 = 0（8/8；gen.neutralTowns=0 生效）`);
  PASS(allWeak, `V1 全图野怪**全为 weak**（gen.monsterTierBand 抬到 ∞ 生效）`);
  PASS(allFive, `V1 全图野怪数 = ${tutorial.gen.monsterCount}（8/8；gen.monsterCount 生效）`);
  const medMon15 = median(perSeed.map((r) => r.mon15));
  console.log(`[信息] 图一 1.5 天圈内野怪中位 = ${medMon15}（规格 V1 期望 ≥3 且全为 weak；playtest-scenarios §2.6 已更正"2–4"为低估）`);
  console.log(`[信息] 图一 1 天圈内资源堆/宝箱 中位 = ${median(perSeed.map((r) => r.piles1))} / ${median(perSeed.map((r) => r.chests1))}（规格 V4 期望 ≥4/≥2）`);
}

/* ============================ §2 图二《对决场》 ============================ */
console.log('\n── §2 图二《对决场》· 首次接触日（control vs rush，8 seeds） ──');
const duel = SCENARIO_BY_ID.duel;
if (!duel) {
  console.error('SCENARIO_BY_ID.duel 不存在 —— 场景数据没接上');
  process.exit(2);
}

/** 生成"图二"的一张图（带 `scenario:'duel'` ⇒ 带上 stamp 门控；AI 意图暂也开着）。 */
function genDuel(seed) {
  return createGame({ ...duel.config, seed, scenario: duel.id });
}

/**
 * 断言两张图**同构**：`tiles`（terrain+objectId）+ 全部物件（id/kind/pos）全等。
 *
 * 为什么必须有：**对照必须与处理组是同一张图**。旧版 control 用**不带** `scenario` 的
 * `createGame` ⇒ 它**没有** `stamp.midGuard` 那只中线怪 ⇒ 与 rush 组差一个物件、
 * **不是同一张图** ⇒ 两组"接触日"不可比（差值里混进了"地图不同"）。
 * 修正口径：两组都从**同一次** `createGame({scenario:'duel'})` 派生，control 组**只清**
 * `state.config.scenario`（地图/物件已生成完，清它只影响**运行时 AI 意图**）。
 */
function sameMap(a, b) {
  if (a.map.width !== b.map.width || a.map.height !== b.map.height) return false;
  if (a.map.tiles.length !== b.map.tiles.length) return false;
  for (let i = 0; i < a.map.tiles.length; i++) {
    const ta = a.map.tiles[i];
    const tb = b.map.tiles[i];
    if (ta.terrain !== tb.terrain || ta.objectId !== tb.objectId) return false;
  }
  const ka = Object.keys(a.map.objects).sort();
  const kb = Object.keys(b.map.objects).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  for (const k of ka) {
    const oa = a.map.objects[k];
    const ob = b.map.objects[k];
    if (oa.kind !== ob.kind || oa.pos.x !== ob.pos.x || oa.pos.y !== ob.pos.y) return false;
  }
  return true;
}

/** 从**已生成好的** state 跑最多 21 天，返回首次接触日（未接触记 99 哨兵，便于取中位）。 */
function runContact(state) {
  let first = null;
  for (let day = 1; day <= 21 && state.status === 'playing'; day++) {
    const home = state.towns['town_home'];
    if (!home || home.owner !== 'p1') break;
    const hp = home.pos;
    for (const h of Object.values(state.heroes)) {
      if (h.owner === 'p1' || h.owner === 'neutral') continue;
      const pf = computePaths(state, h.pos, Infinity);
      const c = pf.cost[idx(state.map, hp.x, hp.y)];
      if (!Number.isFinite(c)) continue;
      const man = Math.abs(h.pos.x - hp.x) + Math.abs(h.pos.y - hp.y);
      if (first === null && (man <= 5 || c <= DAY)) first = day;
    }
    if (first !== null) break;
    endDay(state);
  }
  return first ?? 99;
}

const control = [];
const rush = [];
let sameAll = true;
for (const seed of SEEDS) {
  const sRush = genDuel(seed);
  const sCtrl = genDuel(seed); // 同一次生成 ⇒ 同一张图
  sCtrl.config.scenario = undefined; // **只清意图**：地图/物件已生成，rush 从此不生效
  if (!sameMap(sRush, sCtrl)) sameAll = false;
  rush.push(runContact(sRush));
  control.push(runContact(sCtrl));
}
const medControl = median(control);
const medRush = median(rush);
const fmt = (a) => a.map((x) => (x === 99 ? '>21' : x)).join(',');

console.log(`  control（同图 · 仅清意图）: 首次接触日 = [${fmt(control)}] · 中位 ${medControl === 99 ? '>21' : medControl}`);
console.log(`  rush   （同图 · 意图生效）: 首次接触日 = [${fmt(rush)}] · 中位 ${medRush === 99 ? '>21' : medRush}`);

// 同构是**前置条件**：不同构 ⇒ 两组接触日不可比 ⇒ 数字作废（硬断言）。
PASS(sameAll, `两组地图同构（tiles + objects[].pos 全等，8/8）—— 不同构则下面两组数字作废`);
const maxOk = medRush <= 18;
const betterOk = medRush < medControl;
PASS(maxOk, `接触日中位(rush) = ${medRush === 99 ? '>21' : medRush} ≤ 18（硬上限；规格预测 4–6 天）`);
PASS(betterOk, `接触日中位(rush) ${medRush === 99 ? '>21' : medRush} < control ${medControl === 99 ? '>21' : medControl}（证明是 rush 起的作用）`);
if (medRush <= 18 && medRush < 6) {
  WARNL(`rush 中位 ${medRush} 天 < 6 —— 比规格预测（4–6）还早，可能过激进/观感像作弊，值得看一眼（不判失败）。`);
}

console.log(`\n${bad === 0 ? '全部通过' : `有 ${bad} 条硬断言不达标`}`);

/* ── 元纪律「跑后」快照 + 对比（roadmap 59f8dd1） ────────────────────────────
 * ① **主判据**：被测构建**指纹**变了 ⇒ 上面每一条 PASS/FAIL **一律作废** ⇒ **exit 3**。
 *    ★ 不降级成 1：1 会被读成"跑了、但没达标"，而此处是"**读数不可信**"
 *      —— 正是本轮在治的「退出码与判词脱钩」。
 * ② **旁证**：工作树变了 ⇒ 只 **WARN**（**不作废**）。因为 `dist/` 是 gitignored、
 *    `git status` 看不见被测对象；它能看见的那些（docs / 台账在飞）与本次读数无关 ——
 *    **拿它作废会把"别人在写文档"误判成"本次读数无效"**。 */
const FP1 = fpKey(fingerprint(DIST));
if (FP0 !== FP1) {
  console.error('✗ 结果作废（exit 3）：跑的过程中**被测构建变了** ——');
  console.error(`  跑前 ${FP0}`);
  console.error(`  跑后 ${FP1}`);
  console.error('  上面每一条 PASS/FAIL 都不可信（被测对象在脚下被改）。请在构建静止时重跑。');
  process.exit(3);
}
const TREE1 = treeSnap();
if (TREE0 !== null && TREE1 !== null && TREE0 !== TREE1) {
  WARNL('旁证：跑的过程中工作树变了（`git status --porcelain` 前后不一致）—— **不作废本次**（被测构建指纹未变），仅为提示。');
}
process.exit(bad === 0 ? 0 : 1);
