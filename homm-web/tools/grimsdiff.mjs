#!/usr/bin/env node
/**
 * grimsdiff.mjs —— **难度三档在真实对局里是否真的生效**的实测台（图三 `grims-showcase`）。
 *
 * 为什么有本工具：`design/difficulty-spec.md` 的玩家侧四根杠杆（`playerStartMul` /
 * `playerGrowthBonus` / `playerMoveMul` / `monsterMul`）**此前从未有人实测验证**。规格 §8
 * 的 13 条改动清单标着「✅ 已落地」，但"代码里有这行"≠"真实对局里量得出来"。
 * ⇒ 本工具**只报实测数字**，不把规格里的期望值当结论。
 *
 * 量什么（每档都给数字）：
 *   ① 玩家起始资源  → `createGame` 后 `state.players.p1.resources`（验证 `playerStartMul`）
 *   ② 野怪强度      → 全图 `wanderingMonster` + `vault` 守卫 + 中立城驻军的**总兵数**
 *                      （验证 `monsterMul`；**同种子跨档对比** ⇒ 点位不变、只有数量变）
 *   ③ 玩家移动力    → `hero1.movePoints` 开局值 + `maxMovePoints()`（验证 `playerMoveMul`）
 *   ④ AI 出击时机   → **两组**：`rush`（场景原样）与 `norush`（只清 `config.scenario`）。
 *                      每组量：首次出击日 / 首次接触日 / **出城天数** / **累计行军格数**。
 *                      ★ 为什么必须两组：`aggression` 只作用于常规候选打分，而 `rush` 候选是
 *                        一个**不随难度变化**的常量分（`RUSH_BIAS`）⇒ 在 rush 图上它会被**完全掩盖**。
 *                        只量 rush 组会得到"三档一模一样"，那是**测量设计**造出来的，不是代码没生效。
 *   ⑤ 玩家周增长    → **冻结 AI**（p2/p3/p4 标成人类 ⇒ `endDay` 跳过它们）跑 7 天，
 *                      量 p1 名下总兵数增量（验证 `playerGrowthBonus`）。
 *                      ★ 为什么必须冻结：不冻结时 AI 会rush 掉玩家主城，增量里混进"被打死/丢城"。
 *
 * **角色 = 报表**（`tools/GATES.md` §一）：它**打印数字给人读**，`rc` **不是判词**。
 *   ⇒ `rc=0` 只表示"跑完了"，**不表示"难度没问题"**。判"过不过"要看下面那张表。
 *   退出码：0 = 跑完；2 = 前置不满足（dist 缺失 / 场景数据没接上）；
 *           3 = 读数不可信（跑的过程中**被测构建指纹**变了）。
 *
 * 用法：npm run build && node tools/grimsdiff.mjs [--dist=<dir>] [--seeds=8] [--days=21]
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { distDir, distUrl, printHeader, fingerprint, argOf } from './_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'report=grimsdiff');

if (!existsSync(path.join(DIST, 'core', 'map', 'generator.js'))) {
  console.error(`dist 不存在，请先 npm run build（或 --dist=<dir>）：${DIST}`);
  process.exit(2);
}
const fpKey = (fp) => `${fp.md5 ?? 'n/a'}|${fp.sha256 ?? 'n/a'}|${(fp.files ?? []).join(',')}`;
const FP0 = fpKey(fingerprint(DIST));

const { createGame, BASE_MOVE_POINTS } = await import(distUrl('core/map/generator.js', DIST));
const { computePaths } = await import(distUrl('core/map/pathfinding.js', DIST));
const { endDay } = await import(distUrl('core/game/turn.js', DIST));
const { maxMovePoints, heroPower } = await import(distUrl('core/game/hero.js', DIST));
const { SCENARIO_BY_ID } = await import(distUrl('core/data/scenarios.js', DIST));
const { DIFFICULTIES } = await import(distUrl('core/data/factions.js', DIST));

const grims = SCENARIO_BY_ID['grims-showcase'];
if (!grims) {
  console.error("SCENARIO_BY_ID['grims-showcase'] 不存在 —— 场景数据没接上");
  process.exit(2);
}

const N = Number.parseInt(argOf('seeds', '8'), 10) || 8;
const DAYS = Number.parseInt(argOf('days', '21'), 10) || 21;
const SEEDS = [2175, 1000, 8717, 16434, 24151, 31868, 39585, 47302, 55019, 62736].slice(0, N);
const DIFFS = ['easy', 'normal', 'hard'];
const NO = DAYS + 1;
const idx = (m, x, y) => y * m.width + x;
const median = (a) => {
  const n = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  return n.length ? n[(n.length - 1) >> 1] : NaN;
};
const fmt = (a) => a.map((x) => (x === NO ? `>${DAYS}` : String(x))).join(',');
const MED = (a) => {
  const m = median(a);
  return m === NO ? `>${DAYS}` : String(m);
};
const gen = (seed, difficulty) => createGame({ ...grims.config, difficulty, seed, scenario: grims.id });

/** 全图非玩家部队总兵数（野怪 + 宝库守卫 + 中立城驻军）。 */
function monsterMass(state) {
  let n = 0;
  for (const o of Object.values(state.map.objects)) {
    if (o.kind === 'wanderingMonster' || o.kind === 'vault') {
      for (const s of o.payload?.army ?? []) n += s.count;
    }
  }
  for (const t of Object.values(state.towns)) {
    if (t.owner === 'neutral') for (const s of t.garrison ?? []) n += s.count;
  }
  return n;
}

/** p1 名下总兵数（驻军 + 增长池 + 英雄部队）。 */
function playerMass(state) {
  let n = 0;
  for (const t of Object.values(state.towns)) {
    if (t.owner !== 'p1') continue;
    for (const s of t.garrison ?? []) n += s.count;
    for (const v of Object.values(t.growthPool ?? {})) n += v ?? 0;
  }
  for (const h of Object.values(state.heroes)) {
    if (h.owner === 'p1') for (const s of h.army ?? []) n += s.count;
  }
  return n;
}

const rows = {};
for (const d of DIFFS) rows[d] = [];

console.log(`── 图三《破碎罗盘》grims-showcase · 难度三档实测（${SEEDS.length} seeds · 同图同种子跨档对比）──`);
console.log(`   seeds = [${SEEDS.join(', ')}] · 动态观测 ${DAYS} 天 · BASE_MOVE_POINTS=${BASE_MOVE_POINTS}\n`);

/* ---------------- 静态四项（快） ---------------- */
for (const seed of SEEDS) {
  for (const d of DIFFS) {
    const s = gen(seed, d);
    const res = s.players.p1?.resources ?? {};
    const hero = s.heroes[s.heroOrder[0]] ?? Object.values(s.heroes).find((h) => h.owner === 'p1');
    // ⑤ 周增长：冻结 AI 后跑 7 天（day 1 → day 8，跨一次周结算）
    const s2 = gen(seed, d);
    for (const p of ['p2', 'p3', 'p4']) if (s2.players[p]) s2.players[p].isHuman = true;
    const before = playerMass(s2);
    for (let i = 0; i < 7 && s2.status === 'playing'; i++) endDay(s2);
    rows[d].push({
      seed,
      start: { gold: res.gold ?? 0, wood: res.wood ?? 0, ore: res.ore ?? 0 },
      mass: monsterMass(s),
      mp0: hero?.movePoints ?? NaN,
      mpMax: hero ? maxMovePoints(hero, s) : NaN,
      grow: playerMass(s2) - before,
    });
  }
}

console.log('── ① 玩家起始资源（验证 playerStartMul · 基准 2500 金 / 10 木 / 10 矿）──');
for (const d of DIFFS) {
  const def = DIFFICULTIES[d];
  const r = rows[d][0];
  const exp = (b) => Math.round(b * (def.playerStartMul ?? 1));
  const ok = r.start.gold === exp(2500) && r.start.wood === exp(10) && r.start.ore === exp(10);
  const same = rows[d].every((x) => x.start.gold === r.start.gold && x.start.wood === r.start.wood && x.start.ore === r.start.ore);
  console.log(
    `  ${d.padEnd(6)} playerStartMul=${String(def.playerStartMul).padEnd(4)} 实测 ${r.start.gold}/${r.start.wood}/${r.start.ore}` +
      ` · 期望 ${exp(2500)}/${exp(10)}/${exp(10)}  ${ok ? '✅' : '❌'} · 跨 ${rows[d].length} 种子恒定 ${same ? '是' : '否'}`,
  );
}

console.log('\n── ② 野怪总兵数（验证 monsterMul · 野怪 + 宝库守卫 + 中立城驻军，同种子跨档）──');
const base = new Map(rows.normal.map((r) => [r.seed, r.mass]));
for (const d of DIFFS) {
  const def = DIFFICULTIES[d];
  const per = rows[d].map((r) => r.mass / base.get(r.seed));
  console.log(
    `  ${d.padEnd(6)} monsterMul=${String(def.monsterMul).padEnd(4)} 中位比值 ${median(per).toFixed(3)}` +
      ` · 逐种子 [${per.map((x) => x.toFixed(2)).join(', ')}] · 总兵数 [${rows[d].map((r) => r.mass).join(', ')}]` +
      `  ${Math.abs(median(per) - def.monsterMul) < 0.06 ? '✅' : '❌'}`,
  );
}

console.log(`\n── ③ 玩家移动力（验证 playerMoveMul · BASE=${BASE_MOVE_POINTS}）──`);
for (const d of DIFFS) {
  const def = DIFFICULTIES[d];
  const exp = Math.round(BASE_MOVE_POINTS * (def.playerMoveMul ?? 1));
  const ok = rows[d].every((r) => r.mp0 === exp && r.mpMax === exp);
  console.log(
    `  ${d.padEnd(6)} playerMoveMul=${String(def.playerMoveMul).padEnd(4)} 开局 movePoints=[${rows[d].map((r) => r.mp0).join(',')}]` +
      ` · maxMovePoints=[${rows[d].map((r) => r.mpMax).join(',')}] · 期望 ${exp}  ${ok ? '✅' : '❌'}`,
  );
}

console.log('\n── ⑤ 玩家周增长（验证 playerGrowthBonus · 冻结 AI 后第 1→8 天 p1 总兵数增量）──');
for (const d of DIFFS) {
  const def = DIFFICULTIES[d];
  console.log(
    `  ${d.padEnd(6)} playerGrowthBonus=${String(def.playerGrowthBonus).padEnd(5)} 增量/种子 [${rows[d].map((r) => r.grow).join(', ')}] · 中位 ${median(rows[d].map((r) => r.grow))}`,
  );
}

/* ---------------- ④ 动态：AI 出击时机（慢） ---------------- */
console.log('\n── ④ AI 出击时机（验证 aggression · 全跑 21 天，不提前收工）──');
const dyn = {};
for (const arm of ['rush', 'norush']) {
  dyn[arm] = {};
  for (const d of DIFFS) dyn[arm][d] = [];
  for (const seed of SEEDS) {
    for (const d of DIFFS) {
      const s = gen(seed, d);
      if (arm === 'norush') s.config.scenario = undefined;
      const start = Object.fromEntries(
        Object.values(s.heroes).filter((h) => h.owner !== 'p1' && h.owner !== 'neutral').map((h) => [h.id, { ...h.pos }]),
      );
      let contact = NO;
      let sortie = NO;
      let deployed = 0;
      let travel = 0;
      // 「敢不敢动手」的可观测量：**有主**城镇易主（打中立城算发育，不算开战）
      let firstCapture = NO;
      let captures = 0;
      // 机制核对：门槛**到底有没有在拦**（而不是"恰好都达标 ⇒ 差异来自别处"）
      let maxPower = 0;
      let daysAbove = 0;
      for (let day = 1; day <= DAYS && s.status === 'playing'; day++) {
        const home = s.towns['town_home'];
        if (!home || home.owner !== 'p1') break;
        const hp = home.pos;
        let farToday = false;
        for (const h of Object.values(s.heroes)) {
          if (h.owner === 'p1' || h.owner === 'neutral') continue;
          const st = start[h.id];
          if (!st) continue;
          const far = Math.abs(h.pos.x - st.x) + Math.abs(h.pos.y - st.y) >= 4;
          if (far) {
            farToday = true;
            if (sortie === NO) sortie = day;
          }
          const c = computePaths(s, h.pos, Infinity).cost[idx(s.map, hp.x, hp.y)];
          const man = Math.abs(h.pos.x - hp.x) + Math.abs(h.pos.y - hp.y);
          if (contact === NO && (man <= 5 || (Number.isFinite(c) && c > 0 && c <= BASE_MOVE_POINTS))) contact = day;
          const pw = heroPower(h);
          if (pw > maxPower) maxPower = pw;
        }
        const best = Math.max(
          0,
          ...Object.values(s.heroes).filter((h) => h.owner !== 'p1' && h.owner !== 'neutral').map((h) => heroPower(h)),
        );
        if (best >= Math.round(200 * DIFFICULTIES[d].aggression)) daysAbove += 1;
        if (farToday) deployed += 1;
        const snap = Object.fromEntries(
          Object.values(s.heroes).filter((h) => h.owner !== 'p1' && h.owner !== 'neutral').map((h) => [h.id, { ...h.pos }]),
        );
        const owners = Object.fromEntries(Object.values(s.towns).map((t) => [t.id, t.owner]));
        endDay(s);
        for (const [id, p] of Object.entries(snap)) {
          const q = s.heroes[id];
          if (!q) continue;
          travel += Math.abs(q.pos.x - p.x) + Math.abs(q.pos.y - p.y);
        }
        for (const t of Object.values(s.towns)) {
          const was = owners[t.id];
          if (was && was !== 'neutral' && t.owner !== was) {
            captures += 1;
            if (firstCapture === NO) firstCapture = day;
          }
        }
      }
      dyn[arm][d].push({ seed, contact, sortie, deployed, travel, firstCapture, captures, maxPower, daysAbove });
    }
  }
  console.log(`\n  ── ${arm === 'rush' ? 'rush（场景原样）' : 'norush（只清 config.scenario）'} ──`);
  for (const d of DIFFS) {
    const def = DIFFICULTIES[d];
    const rs = dyn[arm][d];
    console.log(
      `  ${d.padEnd(6)} aggression=${String(def.aggression).padEnd(4)} 阈值 ${Math.round(200 * def.aggression)} 血` +
        ` · 出击日 [${fmt(rs.map((r) => r.sortie))}] 中位 ${MED(rs.map((r) => r.sortie))}` +
        ` · 接触日 [${fmt(rs.map((r) => r.contact))}] 中位 ${MED(rs.map((r) => r.contact))}` +
        `（从不接触 ${rs.filter((r) => r.contact === NO).length}/${rs.length}）`,
    );
    console.log(
      `         ${''.padEnd(6)} ★首开战日(有主城易主) [${fmt(rs.map((r) => r.firstCapture))}] 中位 ${MED(rs.map((r) => r.firstCapture))}` +
        ` · 21 天易主次数 [${rs.map((r) => r.captures).join(',')}] 合计 ${rs.reduce((a, b) => a + b.captures, 0)}`,
    );
    console.log(
      `         ${''.padEnd(6)} 出城天数 [${rs.map((r) => r.deployed).join(',')}] 中位 ${median(rs.map((r) => r.deployed))}/${DAYS}` +
        ` · 累计行军格 [${rs.map((r) => r.travel).join(',')}] 中位 ${median(rs.map((r) => r.travel))}`,
    );
    console.log(
      `         ${''.padEnd(6)} 机制核对：AI 最强英雄战力峰值 [${rs.map((r) => Math.round(r.maxPower)).join(',')}] 中位 ${Math.round(median(rs.map((r) => r.maxPower)))}` +
        ` · 达门槛天数 [${rs.map((r) => r.daysAbove).join(',')}] 中位 ${median(rs.map((r) => r.daysAbove))}/${DAYS}（门槛 ${Math.round(200 * DIFFICULTIES[d].aggression)}）`,
    );
  }
}

console.log('\n（本工具是**报表**：`rc=0` 只表示跑完了 —— 判"过不过"请读上面五张表。）');

const FP1 = fpKey(fingerprint(DIST));
if (FP0 !== FP1) {
  console.error('✗ 读数不可信（exit 3）：跑的过程中**被测构建变了**。');
  console.error(`  跑前 ${FP0}`);
  console.error(`  跑后 ${FP1}`);
  process.exit(3);
}
process.exit(0);
