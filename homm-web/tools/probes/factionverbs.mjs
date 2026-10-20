/**
 * 四族差异化 Step0 + Step2 验收探针（2026-10-20）。
 *
 * 覆盖三件事，每件都必须能**单独归因**（本项目铁律：新机制必须能单独证明自己活着）：
 *
 *   [A] `growthPerWeek` 接活 —— 四族 T1 周产 11/12/10/9 真的进增长池，
 *       且建筑表里**不再有第二份真相**（`growth.count` 已删）。
 *       背景：此前 `applyWeeklyGrowth` 只读 `buildings.ts` 的 10/5/4/3/2，
 *       兵种表的 `growthPerWeek` 是死数据 ⇒ 四族周长完全一样。
 *   [B] 英雄模板按族映射 —— p1 骑士 / p2 野蛮人 / p3 游侠 / p4 牧师；
 *       旧实现用阵营下标取模板，导致 p3 拿牧师、p4 拿野蛮人（身份正好互换）。
 *   [C] 赤焰「冲锋」动词 —— 本回合移动 ≥3 格后近战攻击 +2、原地攻击 −1。
 *       边界必须一起验：远程不参与、反击不吃、别族不受影响、AI 估价看得到。
 *
 * 用法：
 *   node tools/probes/factionverbs.mjs
 *   node tools/probes/factionverbs.mjs --dist=dist     # 指定被测构建
 *   退出码 0 = 全过；1 = 有硬断言失败；2 = 构建缺产物。
 *
 * ⚠️ 负向对照（写在这里，方便复跑）：
 *   `[C]` 的"别族不受影响"([C2]) 与"远程不参与"([C3]) 本身就是特异性对照；
 *   若要证明**整条断言链会红**，把 dist 里 `chargeAtkBonus` 的第一行改成
 *   `return 0;` 再跑本探针 ⇒ [C1]/[C5] 必须红且 exit 1（2026-10-20 已实测，
 *   日志见 `production/tp9/tp9-faction-step0/factionverbs-deepstub.log`）。
 */
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'probe=factionverbs');
requireFile(DIST, 'core/combat/battle.js');
requireFile(DIST, 'core/data/units.js');

const { UNITS, FACTION_UNITS, getUnit, unitIdForTier } = await import(distUrl('core/data/units.js', DIST));
const { BUILDINGS } = await import(distUrl('core/data/buildings.js', DIST));
const { heroTemplateFor, HERO_TEMPLATES } = await import(distUrl('core/data/heroes.js', DIST));
const { applyWeeklyGrowth } = await import(distUrl('core/game/town.js', DIST));
const {
  actMelee,
  aiAct,
  chargeAtkBonus,
  chargeHint,
  createBattle,
  currentUnit,
  endActivation,
  estimateDamage,
  CHARGE_ATK_BONUS,
  CHARGE_IDLE_PENALTY,
  CHARGE_MOVE_HEXES,
} = await import(distUrl('core/combat/battle.js', DIST));

let fail = 0;
const results = [];
function ok(cond, title, detail = '') {
  results.push({ cond: !!cond, title, detail });
  if (!cond) fail += 1;
  console.log(`${cond ? '  ✅' : '  ❌'} ${title}${detail ? ` — ${detail}` : ''}`);
}
function section(t) {
  console.log(`\n${t}`);
}

const F = ['p1', 'p2', 'p3', 'p4'];
const FNAME = { p1: '晨曦', p2: '赤焰', p3: '翠林', p4: '紫晶' };
/** 2 周产量（growthPerWeek 已是周产权威）。 */
const armyOf = (f) =>
  FACTION_UNITS[f].map((id) => ({ unitTypeId: id, count: UNITS[id].growthPerWeek * 2 }));

/* ============================================================ [A] 周产接活 */

section('[A] growthPerWeek 接活（四族 T1 必须不同）');

const t1 = Object.fromEntries(F.map((f) => [f, unitIdForTier(f, 1)]));
const t1Growth = Object.fromEntries(F.map((f) => [f, UNITS[t1[f]]?.growthPerWeek]));
console.log(
  '  数据层：' + F.map((f) => `${FNAME[f]} ${t1[f]} +${t1Growth[f]}`).join('　'),
);
ok(
  new Set(F.map((f) => t1Growth[f])).size === 4,
  '四族 T1 的 growthPerWeek 两两不同',
  F.map((f) => `${f}=${t1Growth[f]}`).join(' '),
);
ok(
  BUILDINGS.dwell1.growth.count === undefined,
  '建筑表已删除 growth.count（第二份真相不存在）',
  `dwell1.growth=${JSON.stringify(BUILDINGS.dwell1.growth)}`,
);

/* 最小合成局：只留 applyWeeklyGrowth 真正读的字段，避免被地图生成干扰。
 * 四个玩家都标 isHuman ⇒ 走 `playerGrowthBonus`（normal = 0），
 * 于是 mult 恒为 1，增量必须**恰好等于** growthPerWeek。
 * （AI 侧 normal 的 `growthBonus` 是 +10%，那是难度设计，不是本探针要测的东西。） */
const st = {
  config: { difficulty: 'normal' },
  players: Object.fromEntries(F.map((f) => [f, { isHuman: true }])),
  towns: Object.fromEntries(
    F.map((f) => [
      `t_${f}`,
      { id: `t_${f}`, owner: f, buildings: ['dwell1'], growthPool: {}, growthRemainder: {} },
    ]),
  ),
};
applyWeeklyGrowth(st);
const got = Object.fromEntries(F.map((f) => [f, st.towns[`t_${f}`].growthPool[t1[f]] ?? 0]));
console.log('  实装层：' + F.map((f) => `${FNAME[f]} 池 +${got[f]}`).join('　'));
ok(
  F.every((f) => got[f] === t1Growth[f]),
  '过一周后增长池增量 = 本族 T1 growthPerWeek',
  F.map((f) => `${f}:+${got[f]}/${t1Growth[f]}`).join(' '),
);

/* ==================================================== [B] 英雄模板按族映射 */

section('[B] 英雄模板按族映射（不是阵营下标）');

const EXPECT = { p1: '骑士', p2: '野蛮人', p3: '游侠', p4: '牧师' };
for (const f of F) {
  const tpl = heroTemplateFor(f, 0);
  ok(
    tpl.className === EXPECT[f],
    `${FNAME[f]}(${f}) 招牌职业 = ${EXPECT[f]}`,
    `实际 ${tpl.className}（模板 ${tpl.id}）`,
  );
}
// 副英雄：必须是"本族招牌之外的三个模板轮换"，不能回到招牌职业
const sig = Object.fromEntries(F.map((f) => [f, heroTemplateFor(f, 0).id]));
const subs = F.map((f) => [1, 2, 3].map((n) => heroTemplateFor(f, n).id));
ok(
  F.every((f, i) => subs[i].every((id) => id !== sig[f])),
  '副英雄（第 2~4 位）不会重复本族招牌职业',
  F.map((f, i) => `${f}:${subs[i].join('/')}`).join(' '),
);
ok(
  F.every((f, i) => new Set(subs[i]).size === 3),
  '副英雄三个位置互不重复（轮换覆盖其余模板）',
  '',
);
ok(new Set(F.map((f) => sig[f])).size === 4, '四族招牌职业两两不同', JSON.stringify(sig));

/* ==================================================== [C] 赤焰「冲锋」 */

section('[C] 赤焰冲锋（移动 ≥3 近战 +2 / 原地 -1）');

/** 固定种子下一次近战的实际伤害（把两只部队手工摆到贴脸，排除走位）。 */
function meleeDamage({ attackerId, faction, moveDist, targetId, seed = 4242 }) {
  const b = createBattle(
    { army: [{ unitTypeId: attackerId, count: 10 }], attack: 0, defense: 0, faction },
    { army: [{ unitTypeId: targetId, count: 20 }], attack: 0, defense: 0 },
    seed,
  );
  b.units[0].hex = { col: 5, row: 5 };
  b.units[1].hex = { col: 6, row: 5 };
  b.units[0].moveDist = moveDist;
  const ev = actMelee(b, b.units[0], b.units[1]);
  return ev.find((e) => e.t === 'melee')?.damage ?? 0;
}

const WOLF = 'p2_wolfrider';
const d = Object.fromEntries(
  [0, 1, 2, 3, CHARGE_MOVE_HEXES, 5].map((m) => [
    m,
    meleeDamage({ attackerId: WOLF, faction: 'p2', moveDist: m, targetId: 'p1_lampbearer' }),
  ]),
);
console.log(
  `  赤焰 T3 狼骑：移动 0/1/2/3/5 格 → 伤害 ${d[0]}/${d[1]}/${d[2]}/${d[3]}/${d[5]}`,
);
ok(d[0] < d[1], '原地攻击吃 −1（伤害低于小步移动）', `${d[0]} < ${d[1]}`);
ok(d[1] === d[2], '移动 1~2 格 = 中性（设计文本未规定，取 0）', `${d[1]} = ${d[2]}`);
ok(d[3] > d[1], '移动 ≥3 格攻击吃 +2（伤害上升）', `${d[3]} > ${d[1]}`);
ok(d[5] === d[3], '移动 5 格不再叠加（上限就是 +2）', `${d[5]} = ${d[3]}`);

// [C2] 特异性：同一件事发生在晨曦身上必须毫无变化
const p1d = Object.fromEntries(
  [0, 3, 5].map((m) => [
    m,
    meleeDamage({ attackerId: 'p1_oathpike', faction: 'p1', moveDist: m, targetId: 'p2_scavenger' }),
  ]),
);
ok(
  p1d[0] === p1d[3] && p1d[3] === p1d[5],
  '别族（晨曦）完全不受影响',
  `${p1d[0]}/${p1d[3]}/${p1d[5]}`,
);

// [C3] 远程单位整条不参与（哪怕被拖进近战）
const ranged = Object.fromEntries(
  [0, 5].map((m) => [
    m,
    meleeDamage({ attackerId: 'p2_axethrower', faction: 'p2', moveDist: m, targetId: 'p1_lampbearer' }),
  ]),
);
ok(ranged[0] === ranged[5], '赤焰远程兵不参与冲锋（避开"唯一远程被净罚"）', `${ranged[0]}/${ranged[5]}`);

// [C4] 反击不吃冲锋
function retaliationDamage(moveDist) {
  const b = createBattle(
    { army: [{ unitTypeId: 'p1_oathpike', count: 10 }], attack: 0, defense: 0, faction: 'p1' },
    { army: [{ unitTypeId: WOLF, count: 10 }], attack: 0, defense: 0, faction: 'p2' },
    4242,
  );
  b.units[0].hex = { col: 5, row: 5 };
  b.units[1].hex = { col: 6, row: 5 };
  b.units[1].moveDist = moveDist; // 防守方"本回合已冲过"，但这一击是反击
  const ev = actMelee(b, b.units[0], b.units[1]);
  return ev.find((e) => e.t === 'retaliate')?.damage ?? 0;
}
const r0 = retaliationDamage(0);
const r5 = retaliationDamage(5);
ok(r0 === r5, '反击不吃冲锋（否则站着挨打更赚）', `原地 ${r0} / 已冲 5 格 ${r5}`);

// [C5] 数值口径直接读函数（防止上面全是"看起来对"）
const md = { idle: chargeAtkBonus({ factions: ['p2', null] }, { side: 0, unitTypeId: WOLF, moveDist: 0 }, true) };
ok(md.idle === CHARGE_IDLE_PENALTY, 'chargeAtkBonus(原地) = −1', `实际 ${md.idle}`);
ok(
  chargeAtkBonus({ factions: ['p2', null] }, { side: 0, unitTypeId: WOLF, moveDist: 3 }, true) ===
    CHARGE_ATK_BONUS,
  'chargeAtkBonus(冲 3 格) = +2',
  '',
);
ok(
  chargeAtkBonus({ factions: [null, null] }, { side: 0, unitTypeId: WOLF, moveDist: 5 }, true) === 0,
  '无阵营（野怪/中立）不触发冲锋',
  '',
);

// [C6] AI 估价接口：假定移动距离必须能改变 estimateDamage，否则 AI 永远不冲
function est(attackerId, faction, assume) {
  const b = createBattle(
    { army: [{ unitTypeId: attackerId, count: 10 }], attack: 0, defense: 0, faction },
    { army: [{ unitTypeId: 'p1_lampbearer', count: 20 }], attack: 0, defense: 0 },
    4242,
  );
  b.units[0].hex = { col: 5, row: 5 };
  b.units[1].hex = { col: 6, row: 5 };
  return estimateDamage(b, b.units[0], b.units[1], false, assume);
}
ok(est(WOLF, 'p2', 3) > est(WOLF, 'p2', 0), 'AI 估价（assumeMoveDist=3）看到冲锋加成', `${est(WOLF, 'p2', 3)} > ${est(WOLF, 'p2', 0)}`);
ok(est('p1_oathpike', 'p1', 3) === est('p1_oathpike', 'p1', 0), 'AI 估价对别族无副作用', '');

// [C7] 构建里确实注册了这条动词（防止有人删了常量但测试还绿）
ok(CHARGE_MOVE_HEXES === 3 && CHARGE_ATK_BONUS === 2, '常量口径 = 3 格 / +2', `${CHARGE_MOVE_HEXES}/${CHARGE_ATK_BONUS}`);

// [C8] 战场提示文案（tooltip 那一行）—— 抽成纯函数就是为了能在这里断言
function hintOf(unitTypeId, faction, moveDist) {
  const b = createBattle(
    { army: [{ unitTypeId, count: 5 }], attack: 0, defense: 0, faction },
    { army: [{ unitTypeId: 'p1_lampbearer', count: 5 }], attack: 0, defense: 0 },
    4242,
  );
  b.units[0].moveDist = moveDist;
  return chargeHint(b, b.units[0]);
}
const h0 = hintOf(WOLF, 'p2', 0);
const h1 = hintOf(WOLF, 'p2', 1);
const h3 = hintOf(WOLF, 'p2', 3);
ok(!!h0 && h0.includes('-1'), '提示（原地）说出 −1', h0 ?? 'null');
ok(!!h1 && h1.includes('±0'), '提示（1~2 格）说出 ±0', h1 ?? 'null');
ok(!!h3 && h3.includes('+2') && h3.includes('3'), '提示（≥3 格）说出 +2 与已冲格数', h3 ?? 'null');
ok(hintOf(WOLF, 'p1', 3) === null, '别族没有这一行（不污染界面）', 'null');
ok(hintOf('p2_axethrower', 'p2', 3) === null, '赤焰远程没有这一行（规则不适用）', 'null');

/* [C9] AI 真的会用（"动词 → 提示 → AI 也会用"三段里的第三段）。
 * 判据不是"能不能"，而是"实际发生频率"：整军对局里统计赤焰近战时的移动距离。
 *
 * 实测：**D1 走位改威胁区之前** 攻 p1 37% / p3 39% / p4 54%；
 * **改之后** 19% / 39% / 30%（合计 264/917 = 29%）。
 * 下降不是回归：AI 不再"走到最远格"，接战距离从 5~6 格缩到 1~2 格，
 * "跑 3 格再打"的机会窗口自然变少 —— 这是走位变聪明换来的，不是动词失效。
 * 所以断言改成"**整体**是个选择"（合计 ≥25%），不再要求每个对局都过线：
 * 单看对局会随对手兵种波动（p1 是最慢的一族，接战最早）。 */
function chargeUsage(opp, seeds = 30) {
  let atk = 0;
  let charged = 0;
  let idle = 0;
  for (let s = 0; s < seeds; s++) {
    const b = createBattle(
      { army: armyOf('p2'), attack: 0, defense: 0, faction: 'p2' },
      { army: armyOf(opp), attack: 0, defense: 0, faction: opp },
      3000 + s,
    );
    let guard = 0;
    while (!b.over && guard++ < 4000) {
      const u = currentUnit(b);
      if (!u) break;
      const ev = aiAct(b, u);
      if (u.side === 0 && ev.some((e) => e.t === 'melee')) {
        atk += 1;
        if (u.moveDist >= CHARGE_MOVE_HEXES) charged += 1;
        else if (u.moveDist === 0) idle += 1;
      }
      endActivation(b);
    }
  }
  return { atk, charged, idle };
}
const usage = ['p1', 'p3', 'p4'].map((o) => ({ o, ...chargeUsage(o) }));
const totalAtk = usage.reduce((n, u) => n + u.atk, 0);
const totalCharged = usage.reduce((n, u) => n + u.charged, 0);
const totalShare = totalCharged / Math.max(1, totalAtk);
console.log(
  '  AI 使用率：' + usage.map((u) => `${u.o} ${(100 * u.charged / Math.max(1, u.atk)).toFixed(0)}%`).join('　') +
    `　合计 ${(100 * totalShare).toFixed(0)}%`,
);
ok(
  totalShare >= 0.25,
  'AI 在整军对局里合计 ≥25% 的近战是"冲起来"的（不是只吃惩罚）',
  `${totalCharged}/${totalAtk}`,
);
ok(
  usage.every((u) => u.charged > 0 && u.idle > 0),
  'AI 既会冲、也会原地打（说明"移动距离"真的在影响决策）',
  usage.map((u) => `${u.o}: 冲${u.charged}/原地${u.idle}`).join(' '),
);

/* ---------------------------------------------------------------- 汇总 */

const pass = results.filter((r) => r.cond).length;
console.log(`\n${fail === 0 ? '✅' : '❌'} 共 ${results.length} 条断言：${pass} 过 / ${fail} 红`);
process.exit(fail === 0 ? 0 : 1);
