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
 *   [D] 紫晶「弹跳袭击」—— 移动 ≥1 格后近战不招反击，**每队每场一次**；守方身份不受影响。
 *       边界：原地不触发、第二次照常挨反击、别族照常挨反击、预估与结算同源、AI 会用。
 *   [E] 晨曦「加班」—— 第 4 回合起全军攻 +1，每回合再 +1，上限 +3。
 *       边界：别族/中立不吃、远程也吃、反击也吃、攻城不吃、提示与战报不静默、AI 预估同源。
 *   [F] 翠林「缠根」—— 近战命中让目标速度 −2（下限 1），"到它下次行动"。
 *       边界：远程不触发、反击不重复挂、与减速不叠（只扣一次）、AI 同分时偏爱未缠目标。
 *   [G] 紫晶「实验事故」—— 开战掷 1 条、双方同受（反重力/泄漏/爆炸）。
 *       边界：仅紫晶参战才掷、同种子可复现、预估===实战、**不许消耗主随机流**。
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
 *   `[D]` 两条（2026-10-20 实测）：① `dist` 里 `noRetaliate: true` → `false` ⇒ 4 红 exit 1；
 *   ② 把 `u.moveDist > 0` 从 `actMelee` 的条件里删掉 ⇒ 1 红 exit 1（正是 [D3]）。
 *   `[E]` 两条（2026-10-20 实测）：① `overtimeAtkBonus` 首行 `return 0` ⇒ 4 红 exit 1；
 *   ② `retaliationAtkBonus` 去掉加班项 ⇒ **只有 [E4] 1 红**（证明它没被别的机制顺带照亮）。
 *   `[F]` 三条（2026-10-20 实测）：① `rootApplies` 首行 `return false` ⇒ 12 红 exit 1；
 *   ② `applyRoot` 一律挂 2 轮 ⇒ 1 红；③ 注掉 `rootTargetBonus` ⇒ 1 红。
 *   `[G]` 四条（2026-10-20 实测）：① `rollAccident` 首行 `return null` ⇒ 9 红 exit 1；
 *   ② 泄漏/爆炸只作用于攻方 ⇒ 2 红；③ 预估侧去掉 `faction` ⇒ 2 红；
 *   ④ `s.accidentRng()` 改回 `s.rng()`（污染主随机流）⇒ **只有 [G11] 1 红**。
 */
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'probe=factionverbs');
requireFile(DIST, 'core/combat/battle.js');
requireFile(DIST, 'core/data/units.js');
requireFile(DIST, 'core/rng.js');

const { UNITS, FACTION_UNITS, getUnit, unitIdForTier } = await import(distUrl('core/data/units.js', DIST));
const { BUILDINGS } = await import(distUrl('core/data/buildings.js', DIST));
const { heroTemplateFor, HERO_TEMPLATES } = await import(distUrl('core/data/heroes.js', DIST));
const { applyWeeklyGrowth } = await import(distUrl('core/game/town.js', DIST));
const { mulberry32 } = await import(distUrl('core/rng.js', DIST));
const {
  actMelee,
  actMove,
  aiAct,
  chargeAtkBonus,
  chargeHint,
  createBattle,
  currentUnit,
  describeEvent,
  endActivation,
  estimateDamage,
  estimateRetaliation,
  reachable,
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

/* ---------------------------------------------------------------- [D] 紫晶「弹跳袭击」 */

section('[D] 紫晶「弹跳袭击」：蹦过去那一下不招反击（每队每场一次）');
{
  const { neighbors } = await import(distUrl('core/combat/hex.js', DIST));
  const keyOf = (h) => `${h.col},${h.row}`;

  /** 可控几何：攻方 (4,5)、守方 (4+gap,5)。只用来验规则，不代表真实阵型。 */
  function staged(atkId, defId, gap, fa = 'p4', fd = 'p1') {
    const b = createBattle(
      { army: [{ unitTypeId: atkId, count: 10 }], attack: 0, defense: 0, faction: fa },
      { army: [{ unitTypeId: defId, count: 10 }], attack: 0, defense: 0, faction: fd },
      4242,
    );
    b.units[0].hex = { col: 4, row: 5 };
    b.units[1].hex = { col: 4 + gap, row: 5 };
    return { b, a: b.units[0], d: b.units[1] };
  }
  /** 走一格贴到守方身边（挑 1 格路径，保证 moveDist === 1）。 */
  function bounceIn(b, a, d) {
    const paths = reachable(b, a);
    const spot = neighbors(d.hex).find((h) => paths.get(keyOf(h))?.length === 1);
    if (!spot) return null;
    actMove(b, a, spot);
    return spot;
  }

  // [D1] 正例：蹦过去打 ⇒ 无反击 + 有 bounce 事件 + 日志说得出名字
  {
    const { b, a, d } = staged('p4_hopgolem', 'p1_oathpike', 2);
    const spot = bounceIn(b, a, d);
    const ev = actMelee(b, a, d);
    const bounced = ev.some((e) => e.t === 'bounce');
    const retal = ev.some((e) => e.t === 'retaliate');
    ok(
      !!spot && bounced && !retal,
      '蹦过去打：守方这一下没有反击（bounce 事件替代 retaliate）',
      `moveDist=${a.moveDist} bounce=${bounced} retaliate=${retal}`,
    );
    const text = ev.map((e) => describeEvent(b, e)).join(' / ');
    ok(/弹跳袭击/.test(text), '战斗日志说得出「弹跳袭击」（不是静默机制）', text.slice(0, 48));
  }

  // [D2] 一次性：同一队下一回合原地再打 ⇒ 正常挨反击
  {
    const { b, a, d } = staged('p4_hopgolem', 'p1_oathpike', 2);
    bounceIn(b, a, d);
    actMelee(b, a, d);
    d.retaliated = false; // 模拟下一回合（反击标记按回合重置）
    a.moveDist = 0; // 已经贴脸，原地砸
    const ev2 = actMelee(b, a, d);
    ok(
      ev2.some((e) => e.t === 'retaliate') && !ev2.some((e) => e.t === 'bounce'),
      '第二次（原地）就正常挨反击：这是"每场一次的偷袭"，不是永久免疫',
      `freeHitUsed=${a.freeHitUsed}`,
    );
  }

  // [D3] 前提：必须移动过。"贴脸站着砸"不触发 —— 否则贴脸开打就退化成先手必赢。
  {
    const { b, a, d } = staged('p4_hopgolem', 'p1_oathpike', 1);
    const ev = actMelee(b, a, d);
    ok(
      ev.some((e) => e.t === 'retaliate') && !ev.some((e) => e.t === 'bounce'),
      '原地不动直接砸不触发（"蹦"是前提）',
      `moveDist=${a.moveDist}`,
    );
  }

  // [D4] 特异性：别族单位走上去打照样挨反击
  {
    const { b, a, d } = staged('p1_oathpike', 'p4_hopgolem', 2, 'p1', 'p4');
    bounceIn(b, a, d);
    const ev = actMelee(b, a, d);
    ok(ev.some((e) => e.t === 'retaliate'), '别族单位走上去打照样挨反击（不是全员免疫）', '');
  }

  // [D5] 提示与结算同源：estimateRetaliation 跟着走位变
  {
    const { b, a, d } = staged('p4_hopgolem', 'p1_oathpike', 2);
    const before = estimateRetaliation(b, a, d, false, 10);
    bounceIn(b, a, d);
    const after = estimateRetaliation(b, a, d, false, 10);
    ok(before > 0 && after === 0, '预估反击跟着走位变：原地 >0、蹦过去 =0', `${before} → ${after}`);
  }

  // [D6] AI 真的会用，且每队每场最多一次
  {
    let total = 0;
    let maxPerUnit = 0;
    for (let s = 0; s < 12; s++) {
      const b = createBattle(
        { army: armyOf('p4'), attack: 0, defense: 0, faction: 'p4' },
        { army: armyOf('p3'), attack: 0, defense: 0, faction: 'p3' },
        6100 + s,
      );
      const per = new Map();
      let guard = 0;
      while (!b.over && guard++ < 4000) {
        const u = currentUnit(b);
        if (!u) break;
        for (const e of aiAct(b, u)) {
          if (e.t !== 'bounce') continue;
          per.set(e.unitId, (per.get(e.unitId) ?? 0) + 1);
          total += 1;
        }
        endActivation(b);
      }
      for (const n of per.values()) maxPerUnit = Math.max(maxPerUnit, n);
    }
    ok(total > 0, 'AI 在整军对局里真的会蹦（不是玩家的专属技巧）', `12 场共 ${total} 次`);
    ok(maxPerUnit <= 1, '同一支部队每场最多蹦一次（一次性资源没被写穿）', `max=${maxPerUnit}`);
  }
}

/* ---------------------------------------------------------------- [E] 晨曦「加班」 */

section('[E] 晨曦「加班」：第 4 回合起全军每回合攻 +1，上限 +3');
{
  const { estimateSiegeDamage, overtimeAtkBonus, overtimeHint, OVERTIME_MAX, OVERTIME_START_ROUND } =
    await import(distUrl('core/combat/battle.js', DIST));

  /** 造一个"只改回合数、其余全同"的场面：p1 枪兵 vs 中立狼。 */
  function atRound(r, { fa = 'p1', atkId = 'p1_oathpike', defId = 'wolf', fn = null } = {}) {
    const b = createBattle(
      { army: [{ unitTypeId: atkId, count: 10 }], attack: 0, defense: 0, faction: fa },
      { army: [{ unitTypeId: defId, count: 10 }], attack: 0, defense: 0, ...(fn ? { faction: fn } : {}) },
      5150,
    );
    b.round = r;
    b.units[0].hex = { col: 5, row: 5 };
    b.units[1].hex = { col: 6, row: 5 };
    return b;
  }

  // [E1] 阶梯：第 1/3 回合 0，第 4 回合 +1，第 5 回合 +2，第 6 回合起恒 +3
  {
    const l = [1, 3, 4, 5, 6, 9].map((r) => {
      const b = atRound(r);
      return overtimeAtkBonus(b, 0);
    });
    ok(
      l[0] === 0 && l[1] === 0 && l[2] === 1 && l[3] === 2 && l[4] === OVERTIME_MAX && l[5] === OVERTIME_MAX,
      `加成阶梯 0/0/1/2/${OVERTIME_MAX}/${OVERTIME_MAX}（第 1/3/4/5/6/9 回合）`,
      `实测 ${l.join('/')}`,
    );
  }

  // [E2] 特异性：别族与中立守军都不吃
  {
    const other = overtimeAtkBonus(atRound(9, { fa: 'p2', atkId: 'p2_wolfrider' }), 0);
    const neutral = (() => {
      const b = createBattle(
        { army: [{ unitTypeId: 'wolf', count: 10 }], attack: 0, defense: 0 },
        { army: [{ unitTypeId: 'wolf', count: 10 }], attack: 0, defense: 0 },
        5150,
      );
      b.round = 9;
      return overtimeAtkBonus(b, 0);
    })();
    ok(other === 0 && neutral === 0, '别族与中立守军都不吃加班（不是全局计时器）', `p2=${other} 中立=${neutral}`);
  }

  // [E3] 全军都吃：近战与远程共用 `strikeAtkBonus`，伤害预估必须一起涨
  {
    const b3 = atRound(3);
    const b6 = atRound(6);
    const melee3 = estimateDamage(b3, b3.units[0], b3.units[1], false);
    const melee6 = estimateDamage(b6, b6.units[0], b6.units[1], false);
    const r3 = atRound(3, { atkId: 'p1_hornxbow' });
    const r6 = atRound(6, { atkId: 'p1_hornxbow' });
    const shoot3 = estimateDamage(r3, r3.units[0], r3.units[1], true);
    const shoot6 = estimateDamage(r6, r6.units[0], r6.units[1], true);
    ok(
      melee6 > melee3 && shoot6 > shoot3,
      '近战和远程的期望伤害都随回合上升（"全军"不是"只算近战"）',
      `近战 ${melee3}→${melee6}　远程 ${shoot3}→${shoot6}`,
    );
    ok(
      melee6 / melee3 >= 1.1,
      '满层（+3）时伤害涨幅 ≥10%（+3 攻 ≈ +15% 伤害倍率）',
      `${((melee6 / melee3 - 1) * 100).toFixed(0)}%`,
    );
  }

  // [E4] 反击也吃：加班是"部队攻击力变高"，不是"这一下有加成"
  {
    const b3 = atRound(3, { defId: 'p1_templar', fn: 'p1' });
    const b6 = atRound(6, { defId: 'p1_templar', fn: 'p1' });
    const back3 = estimateRetaliation(b3, b3.units[0], b3.units[1], false, 10);
    const back6 = estimateRetaliation(b6, b6.units[0], b6.units[1], false, 10);
    ok(back6 > back3, '反击也吃加班（和冲锋不同：这不是"这一下的加成"）', `${back3} → ${back6}`);
  }

  // [E5] 攻城不吃：砸城墙不是"交战"（和冲锋边界一致）
  {
    const siege = (r) => {
      const b = createBattle(
        { army: [{ unitTypeId: 'p1_oathpike', count: 10 }], attack: 0, defense: 0, faction: 'p1' },
        { army: [{ unitTypeId: 'p3_vineguard', count: 10 }], attack: 0, defense: 0, faction: 'p3' },
        5150,
        2,
      );
      b.round = r;
      b.units[0].hex = { col: 10, row: 1 };
      return estimateSiegeDamage(b, b.units[0], b.siege.structures[0], false);
    };
    ok(siege(3) === siege(9), '攻城伤害不随回合变（砸墙不算加班）', `r3=${siege(3)} r9=${siege(9)}`);
  }

  // [E6] 文案与数值同源：提示里的数字必须等于函数返回值，否则玩家会按错数字决策
  {
    const b3 = atRound(3);
    const b6 = atRound(6);
    const other = atRound(9, { fa: 'p2', atkId: 'p2_wolfrider' });
    const h3 = overtimeHint(b3, b3.units[0]);
    const h6 = overtimeHint(b6, b6.units[0]);
    // 只认开头那个数字（"上限 +3" 里也有 +3，不能用 includes 蒙混过关）
    const shown = (h) => Number(/加班 \+(\d)/.exec(h ?? '')?.[1] ?? NaN);
    ok(
      !!h3 && h3.includes(String(OVERTIME_START_ROUND)) && shown(h3) === 0,
      `没到第 ${OVERTIME_START_ROUND} 回合时提示改期（预告，不装作已经生效）`,
      h3 ?? 'null',
    );
    ok(
      shown(h6) === overtimeAtkBonus(b6, 0),
      '生效后提示里的数字 === 实际加成',
      `${h6 ?? 'null'}`,
    );
    ok(overtimeHint(other, other.units[0]) === null, '别族的悬停提示里没有加班这一行', '');
  }

  // [E7] 不静默：打到第 4 回合，战报必须说一句"晨曦开始加班"
  {
    const b = createBattle(
      { army: armyOf('p1'), attack: 0, defense: 0, faction: 'p1' },
      { army: armyOf('p1'), attack: 0, defense: 0, faction: 'p1' },
      5151,
    );
    let guard = 0;
    while (!b.over && b.round < 5 && guard++ < 4000) {
      const u = currentUnit(b);
      if (!u) break;
      aiAct(b, u);
      endActivation(b);
    }
    ok(
      b.round >= 5 && b.log.some((l) => /加班/.test(l)),
      '第 4 回合战报里有"晨曦开始加班"（规则变化看得见）',
      b.log.filter((l) => /加班/.test(l)).join(' / ').slice(0, 60),
    );
  }

  // [E8] AI 与结算同源：AI 打分用的 `estimateDamage` 必须能预测真实掷出的伤害
  {
    const b = atRound(6);
    const au = getUnit('p1_oathpike');
    const avg = (au.damageMin + au.damageMax) / 2;
    const est = estimateDamage(b, b.units[0], b.units[1], false);
    const ev = actMelee(b, b.units[0], b.units[1]);
    const dmg = ev.find((e) => e.t === 'melee')?.damage ?? 0;
    // 掷骰区间是 [min,max]，估算用均值 ⇒ 真实伤害必须落在按同一攻击力折算的区间内
    const lo = Math.floor((est * au.damageMin) / avg);
    const hi = Math.ceil((est * au.damageMax) / avg);
    ok(
      dmg >= lo && dmg <= hi,
      'AI 的伤害预估能预测实战掷骰（加班没有分裂成"预估一套、结算一套"）',
      `估计 ${est}，区间 ${lo}~${hi}，实战 ${dmg}`,
    );
  }
}

/* ---------------------------------------------------------------- [F] 翠林「缠根」 */

section('[F] 翠林「缠根」：近战命中后目标速度 −2，正好影响它一次行动');
{
  const {
    actShoot,
    castSpell,
    effectLabel,
    hasEffect,
    rootHint,
    rootTargetBonus,
    unitSpeed,
    ROOT_SPEED_PENALTY,
    ROOT_EFFECT,
  } = await import(distUrl('core/combat/battle.js', DIST));
  const { neighbors } = await import(distUrl('core/combat/hex.js', DIST));
  const keyOf = (h) => `${h.col},${h.row}`;

  /** 可控几何：攻方 (4,5)、守方 (4+gap,5)。只验规则，不代表真实阵型。 */
  function staged(atkId, defId, gap, { fa = 'p3', fd = 'p1', caster = null, defs = null } = {}) {
    const b = createBattle(
      {
        army: [{ unitTypeId: atkId, count: 10 }],
        attack: 0,
        defense: 0,
        faction: fa,
        ...(caster ? { caster } : {}),
      },
      { army: defs ?? [{ unitTypeId: defId, count: 10 }], attack: 0, defense: 0, faction: fd },
      4242,
    );
    b.units[0].hex = { col: 4, row: 5 };
    b.units[1].hex = { col: 4 + gap, row: 5 };
    return { b, a: b.units[0], d: b.units[1] };
  }

  // [F1] 正例：命中即缠，速度真的掉 2，事件与战报说得出名字
  {
    const { b, a, d } = staged('p3_vineguard', 'p1_templar', 1);
    const base = unitSpeed(b, d);
    const ev = actMelee(b, a, d);
    ok(
      d.count > 0 && hasEffect(d, ROOT_EFFECT) && unitSpeed(b, d) === base - ROOT_SPEED_PENALTY,
      `近战命中 ⇒ 目标被缠根、速度 ${base} → ${base - ROOT_SPEED_PENALTY}`,
      `effects=${JSON.stringify(d.effects)}`,
    );
    const text = ev.map((e) => describeEvent(b, e)).join(' / ');
    ok(/缠根/.test(text) && /速度 −2/.test(text), '战斗日志说得出「缠根 / 速度 −2」（不是静默机制）', text.slice(0, 56));
    ok(effectLabel(ROOT_EFFECT) === '缠根', '效果名走 `effectLabel`（UI 不会拿它去查法术表然后崩）', effectLabel(ROOT_EFFECT));
  }

  // [F2] 已经缠住的目标再被砸：不刷新（轮数不变）⇒ 不重复推事件/战报
  {
    const { b, a, d } = staged('p3_vineguard', 'p1_templar', 1);
    actMelee(b, a, d);
    const roundsBefore = d.effects.find((e) => e.spellId === ROOT_EFFECT)?.rounds;
    const ev2 = actMelee(b, a, d);
    const roundsAfter = d.effects.find((e) => e.spellId === ROOT_EFFECT)?.rounds;
    ok(
      hasEffect(d, ROOT_EFFECT) && roundsBefore > 0 && roundsAfter === roundsBefore && !ev2.some((e) => e.t === 'root'),
      '已经缠住的再砸不刷新、不重复刷战报（否则每回合都刷一行）',
      `剩 ${roundsBefore} → ${roundsAfter}`,
    );
  }

  // [F3] 特异性：别族的近战命中完全不缠
  {
    const { b, a, d } = staged('p1_oathpike', 'p3_vineguard', 1, { fa: 'p1', fd: 'p3' });
    actMelee(b, a, d);
    ok(!hasEffect(d, ROOT_EFFECT), '别族（晨曦）近战命中不缠根（不是全员控制）', '');
  }

  // [F4] 翠林远程整条不参与：射不缠，被拖进近战也不缠（规则按兵种关闭）
  {
    const { b, a, d } = staged('p3_thornarcher', 'p1_templar', 4);
    const ev = actShoot(b, a, d);
    const shot = ev.some((e) => e.t === 'shoot');
    ok(shot && !hasEffect(d, ROOT_EFFECT), '荆棘射手射击不缠根（远程不参与这条规则）', `shot=${shot}`);
    const melee = staged('p3_thornarcher', 'p1_templar', 1);
    actMelee(melee.b, melee.a, melee.d);
    ok(!hasEffect(melee.d, ROOT_EFFECT), '翠林远程兵被拖进近战也不缠（口径按兵种，不按这一击）', '');
  }

  // [F5] 反击不缠：翠林挨打时回手，打它的人不会被缠
  {
    const { b, a, d } = staged('p1_oathpike', 'p3_unicorn', 1, { fa: 'p1', fd: 'p3' });
    const ev = actMelee(b, a, d);
    ok(
      ev.some((e) => e.t === 'retaliate') && !hasEffect(a, ROOT_EFFECT),
      '翠林的反击不缠根（否则站着挨打也能控场，动词退化成"别动"）',
      '',
    );
  }

  // [F6] 速度下限：3 速与 2 速都被压到 1，不会出现 0 或负数
  // 目标给 40 只：这一击必须打不死它，否则"死人不需要减速"（无对象可判）
  {
    const low = staged('p3_vineguard', 'p1_lampbearer', 1, { defs: [{ unitTypeId: 'p1_lampbearer', count: 40 }] }); // 3 速
    actMelee(low.b, low.a, low.d);
    const lower = staged('p3_vineguard', 'p4_stoneimp', 1, {
      fd: null,
      defs: [{ unitTypeId: 'p4_stoneimp', count: 40 }], // 2 速（中立守军）
    });
    actMelee(lower.b, lower.a, lower.d);
    ok(
      low.d.count > 0 && lower.d.count > 0 && unitSpeed(low.b, low.d) === 1 && unitSpeed(lower.b, lower.d) === 1,
      '速度下限 = 1（3 速和 2 速都压到 1，不会变 0 / 负数）',
      `${unitSpeed(low.b, low.d)} / ${unitSpeed(lower.b, lower.d)}`,
    );
  }

  // [F7] 与「减速」法术不叠加：两者都是 −2，取一次
  {
    const { b, a, d } = staged('p3_vineguard', 'p1_templar', 1, {
      caster: { spells: ['slow'], spellPower: 2, mana: 10 },
    });
    const base = unitSpeed(b, d);
    castSpell(b, 0, 'slow', d);
    const slowed = unitSpeed(b, d);
    actMelee(b, a, d);
    ok(
      hasEffect(d, ROOT_EFFECT) && slowed === base - 2 && unitSpeed(b, d) === base - 2,
      '减速 + 缠根只扣一次 −2（叠成 −4 会把 7 速突击兵按成 3 速）',
      `${base} → 减速后 ${slowed} → 再缠根 ${unitSpeed(b, d)}`,
    );
  }

  // [F8] 时效（关键）：目标本回合已行动 ⇒ 缠根撑到**下一回合**，并且真的改了排序
  {
    const { b, a, d } = staged('p3_vineguard', 'p1_templar', 1, {
      defs: [
        { unitTypeId: 'p1_templar', count: 10 }, // 6 速
        { unitTypeId: 'p2_lavatroll', count: 10 }, // 5 速
      ],
    });
    const slow5 = b.units[2];
    const order0 = unitSpeed(b, d) > unitSpeed(b, slow5);
    b.idx = b.order.indexOf(d.id) + 1; // 模拟"守方本回合已经动过"
    actMelee(b, a, d);
    b.idx = b.order.length - 1;
    endActivation(b); // 推进到第 2 回合（startRound 会重排 + 扣效果轮数）
    ok(
      b.round === 2 && hasEffect(d, ROOT_EFFECT) && unitSpeed(b, d) === 4,
      '目标本回合已行动 ⇒ 下一回合仍然 −2（这正是它有用的前提）',
      `round=${b.round} speed=${unitSpeed(b, d)}`,
    );
    ok(
      order0 && b.order.indexOf(slow5.id) < b.order.indexOf(d.id),
      '下一回合的排序真的被改了（原本 6 速先动，被缠成 4 速后让 5 速先动）',
      `order=${b.order.join(',')}`,
    );
  }

  // [F9] 时效（另一半）：目标本回合还没动 ⇒ 正好吃这一手，下一回合恢复
  {
    const { b, a, d } = staged('p3_vineguard', 'p1_templar', 1);
    b.idx = 0; // 本回合谁都没动
    actMelee(b, a, d);
    ok(hasEffect(d, ROOT_EFFECT), '本回合还没动的目标：这一手立刻被缠（当回合剩余移动被砍）', '');
    b.idx = b.order.length - 1;
    endActivation(b);
    ok(
      b.round === 2 && !hasEffect(d, ROOT_EFFECT) && unitSpeed(b, d) === 6,
      '它只吃"一次行动"：下一回合已经恢复（不会连吃两次控制）',
      `round=${b.round} speed=${unitSpeed(b, d)}`,
    );
  }

  // [F10] 提示文案：三种身份三种说法，别族 / 远程静默
  {
    const mine = staged('p3_vineguard', 'p1_templar', 1);
    const ranged = staged('p3_thornarcher', 'p1_templar', 4);
    ok(/缠根/.test(rootHint(mine.b, mine.a) ?? '') && rootHint(mine.b, mine.a).includes('−2'), '翠林近战有「缠根 −2」这一行', rootHint(mine.b, mine.a));
    ok(rootHint(ranged.b, ranged.a) === null, '翠林远程没有这一行（规则不适用）', 'null');
    ok(rootHint(mine.b, mine.d) === null, '没被缠的别族单位没有这一行', 'null');
    actMelee(mine.b, mine.a, mine.d);
    ok(/被缠根/.test(rootHint(mine.b, mine.d) ?? ''), '被缠住的目标看到「被缠根」', rootHint(mine.b, mine.d));
  }

  // [F11] AI：两个完全相同的目标，一个已被缠 ⇒ 优先去打**没被缠**的那支
  {
    const b = createBattle(
      { army: [{ unitTypeId: 'p3_vineguard', count: 10 }], attack: 0, defense: 0, faction: 'p3' },
      {
        army: [
          { unitTypeId: 'p1_templar', count: 10 },
          { unitTypeId: 'p1_templar', count: 10 },
        ],
        attack: 0,
        defense: 0,
        faction: 'p1',
      },
      4242,
    );
    const a = b.units[0];
    const rooted = b.units[1];
    const fresh = b.units[2];
    a.hex = { col: 5, row: 5 };
    const around = neighbors(a.hex).filter((h) => h.col >= 5);
    rooted.hex = around[0];
    fresh.hex = around[1];
    rooted.effects.push({ spellId: ROOT_EFFECT, rounds: 2 }); // 先把第一支缠住（它排在数组前面）
    const bonusFresh = rootTargetBonus(b, a, fresh);
    const bonusRooted = rootTargetBonus(b, a, rooted);
    const ev = aiAct(b, a);
    const hit = ev.find((e) => e.t === 'melee');
    ok(
      hit?.targetId === fresh.id,
      'AI 同分时优先缠"还没被缠"的那支（已经缠住的再砸只是浪费）',
      `打了 ${hit?.targetId}（期望 ${fresh.id}）bonus ${bonusFresh} vs ${bonusRooted}`,
    );
  }

  // [F12] AI 在整军对局里真的会缠（不是玩家的专属技巧）
  {
    let battles = 0;
    let withRoot = 0;
    for (let s = 0; s < 20; s++) {
      const b = createBattle(
        { army: armyOf('p3'), attack: 0, defense: 0, faction: 'p3' },
        { army: armyOf('p2'), attack: 0, defense: 0, faction: 'p2' },
        4300 + s,
      );
      let n = 0;
      let guard = 0;
      while (!b.over && guard++ < 4000) {
        const u = currentUnit(b);
        if (!u) break;
        for (const e of aiAct(b, u)) if (e.t === 'root') n += 1;
        endActivation(b);
      }
      battles += 1;
      if (n > 0) withRoot += 1;
    }
    ok(withRoot === battles, 'AI 每一场整军对局都至少缠一次（20/20）', `${withRoot}/${battles}`);
  }
}

/* ---------------------------------------------------------------- [G] 紫晶「实验事故」 */

section('[G] 紫晶「实验事故」：开战掷一条，双方同受');
{
  const {
    accidentLabel,
    ACCIDENT_BOOM_RATE,
    ACCIDENT_DEF_PENALTY,
    ACCIDENT_RANGED_SCALE,
    ACCIDENT_TABLE,
    estimateDamage,
    unitSpeed,
    quickBattle,
  } = await import(distUrl('core/combat/battle.js', DIST));
  const { createGame } = await import(distUrl('core/map/generator.js', DIST));
  const { battleSetup, previewInteraction } = await import(distUrl('core/game/interaction.js', DIST));

  const bigArmy = [
    { unitTypeId: 'p4_fireapprentice', count: 20 },
    { unitTypeId: 'p4_hopgolem', count: 20 },
    { unitTypeId: 'p1_hornxbow', count: 20 },
    { unitTypeId: 'p1_templar', count: 20 },
  ];
  /** p4 vs p1（双方都有远程，方便验泄漏；血量池够大，方便验爆炸）。 */
  function withAccident(seed, forced = null) {
    const b = createBattle(
      { army: bigArmy.slice(0, 2), attack: 0, defense: 0, faction: 'p4' },
      { army: bigArmy.slice(2), attack: 0, defense: 0, faction: 'p1' },
      seed,
    );
    if (forced && b.accident?.kind !== forced) return null;
    return b;
  }
  /** 扫种子找一条指定事故：三条事故都是 1/3，扫 200 个必出。 */
  function findSeed(kind) {
    for (let s = 1; s <= 200; s++) {
      const b = withAccident(s, kind);
      if (b) return { seed: s, b };
    }
    return null;
  }

  // [G1] 没有紫晶参战 ⇒ 恒为 null（不污染别人家的对局）
  {
    let bad = 0;
    for (let s = 1; s <= 40; s++) {
      const b = createBattle(
        { army: armyOf('p1'), attack: 0, defense: 0, faction: 'p1' },
        { army: armyOf('p2'), attack: 0, defense: 0, faction: 'p2' },
        4300 + s,
      );
      if (b.accident || b.speedBonus) bad += 1;
    }
    ok(bad === 0, '没有紫晶参战的 40 场：一场事故都没有（不是全局随机事件）', `坏 ${bad}/40`);
  }

  // [G2] 有紫晶 ⇒ 一定有，且三种都真的会出现
  {
    const seen = {};
    let nulls = 0;
    for (let s = 1; s <= 60; s++) {
      const b = createBattle(
        { army: armyOf('p4'), attack: 0, defense: 0, faction: 'p4' },
        { army: armyOf('p1'), attack: 0, defense: 0, faction: 'p1' },
        s,
      );
      if (!b.accident) nulls += 1;
      else seen[b.accident.kind] = (seen[b.accident.kind] ?? 0) + 1;
    }
    ok(nulls === 0, '紫晶参战的 60 场：每场都有事故（开战必掷）', `空 ${nulls}/60`);
    ok(
      ACCIDENT_TABLE.every((a) => seen[a.kind] > 0),
      '三种事故在 60 个种子里都出现过（不是只写死了其中一条）',
      JSON.stringify(seen),
    );
  }

  // [G3] 同种子 ⇒ 同一条（所以"预估"和"实战"看到的是同一个世界）
  {
    const kinds = new Set();
    for (let s = 1; s <= 10; s++) {
      const a = createBattle(
        { army: armyOf('p4'), attack: 0, defense: 0, faction: 'p4' },
        { army: armyOf('p3'), attack: 0, defense: 0, faction: 'p3' },
        s,
      );
      const b = createBattle(
        { army: armyOf('p4'), attack: 0, defense: 0, faction: 'p4' },
        { army: armyOf('p3'), attack: 0, defense: 0, faction: 'p3' },
        s,
      );
      kinds.add(a.accident?.kind === b.accident?.kind);
    }
    ok(kinds.size === 1 && kinds.has(true), '同种子的两次建局掷出同一条事故（可复现）', '');
  }

  // [G4] 试剂泄漏：**双方防御 −1** —— 打谁都更疼（结算与预估同一个 `defBonusOf`）
  //
  // 载荷为什么在防御上：早先设想的"弹药减半"实测会把 `紫晶→翠林 91%` 打成 0%
  // （改的是"还能射几轮"，而紫晶整套强度就建立在先射几轮上）。见 §11.10。
  {
    const found = findSeed('leak');
    if (!found) ok(false, '找不到泄漏的种子（事故表坏了）', '');
    else {
      const { b, seed } = found;
      const plain = createBattle(
        { army: bigArmy.slice(0, 2), attack: 0, defense: 0, faction: 'p1' },
        { army: bigArmy.slice(2), attack: 0, defense: 0, faction: 'p1' },
        seed,
      );
      // 每一方挑一支**近战**和一支**远程**，各算"我打对面第一支"的期望伤害
      const pick = (st, side, ranged) =>
        st.units.find((u) => u.side === side && !!getUnit(u.unitTypeId).shots === ranged);
      const cmp = (side, ranged) => {
        const tgt = (st) => st.units.find((u) => u.side !== side);
        return [
          estimateDamage(b, pick(b, side, ranged), tgt(b), ranged),
          estimateDamage(plain, pick(plain, side, ranged), tgt(plain), ranged),
        ];
      };
      const rows = [];
      let allUp = true;
      for (const side of [0, 1]) for (const ranged of [false, true]) {
        const [now, base] = cmp(side, ranged);
        rows.push(`${side === 0 ? '攻' : '守'}${ranged ? '远' : '近'} ${base.toFixed(1)}→${now.toFixed(1)}`);
        if (!(now > base)) allUp = false;
      }
      ok(allUp, '泄漏：双方防御 −1，近战和远程打谁都更疼（同受，不是只坑一边）', rows.join('　'));
      ok(/防御 −1/.test(b.accident?.detail ?? ''), '泄漏的文案写的是"防御 −1"（不是还留着弹药那句话）', b.accident?.detail ?? '');
      ok(
        b.units.every((u) => u.shots === (getUnit(u.unitTypeId).shots ?? 0)),
        '泄漏**不再**动弹药（弹药属于"接触节奏"那条轴，一动就翻盘）',
        JSON.stringify(b.units.map((u) => [u.unitTypeId, u.shots])),
      );
    }
  }

  // [G5] 反重力：**远程伤害 ×0.8，近战一点不动**
  {
    const found = findSeed('gravity');
    if (!found) ok(false, '找不到反重力的种子（事故表坏了）', '');
    else {
      const { b, seed } = found;
      const plain = createBattle(
        { army: bigArmy.slice(0, 2), attack: 0, defense: 0, faction: 'p1' },
        { army: bigArmy.slice(2), attack: 0, defense: 0, faction: 'p1' },
        seed,
      );
      const pick = (st, side, ranged) =>
        st.units.find((u) => u.side === side && !!getUnit(u.unitTypeId).shots === ranged);
      const dmg = (st, side, ranged) =>
        estimateDamage(st, pick(st, side, ranged), st.units.find((u) => u.side !== side), ranged);
      const rangedDown = [0, 1].every((s) => dmg(b, s, true) < dmg(plain, s, true));
      const meleeSame = [0, 1].every((s) => dmg(b, s, false) === dmg(plain, s, false));
      ok(
        rangedDown && meleeSame,
        `反重力：双方远程伤害 ×${ACCIDENT_RANGED_SCALE}（−${Math.round((1 - ACCIDENT_RANGED_SCALE) * 100)}%），近战一点不动`,
        [0, 1].map((s) => `side${s} 远 ${dmg(plain, s, true).toFixed(1)}→${dmg(b, s, true).toFixed(1)}／近 ${dmg(plain, s, false).toFixed(1)}→${dmg(b, s, false).toFixed(1)}`).join('　'),
      );
      ok(
        unitSpeed(b, b.units[0]) === unitSpeed(plain, plain.units[0]),
        '反重力**不再**改速度（速度=接触时间，一动就整盘翻面）',
        `速 ${unitSpeed(plain, plain.units[0])} → ${unitSpeed(b, b.units[0])}`,
      );
    }
  }

  // [G6] 爆炸：双方都有伤亡；每队至少留 1 个（事故不该在掷骰阶段抹掉一队）
  {
    const found = findSeed('boom');
    if (!found) ok(false, '找不到爆炸的种子（事故表坏了）', '');
    else {
      const { b } = found;
      const bySide = (side) =>
        b.units.filter((u) => u.side === side).reduce((n, u) => n + (u.startCount - u.count), 0);
      ok(
        bySide(0) > 0 && bySide(1) > 0 && b.units.every((u) => u.count > 0),
        '爆炸：攻守双方都掉人（同受），且没有任何一队被抹掉',
        `攻 −${bySide(0)} / 守 −${bySide(1)}`,
      );
      ok(/合计 −\d+ 人|无人阵亡/.test(b.accident?.detail ?? ''), '爆炸的战报写出**实际**死了几个（不是空话）', b.accident?.detail ?? '');
    }
  }

  // [G7] 不静默：战报第一行就是事故，且标签与规则同一句
  {
    const b = withAccident(2);
    const label = accidentLabel(b?.accident);
    ok(
      !!b && b.log[0] === label && /实验室事故/.test(b.log[0]),
      '战报第一行就是「实验室事故：…」（规则变了看得见）',
      b?.log[0] ?? 'null',
    );
    ok(label.includes(b?.accident?.name ?? '@'), '标签里带事故名字（头部标签与战报同一句）', label);
    ok(accidentLabel(null) === '', '没有事故时标签是空串（UI 直接判空，不显示空壳）', '');
  }

  // [G8] 口径常数（防止有人只改文案不改数值）
  {
    ok(
      ACCIDENT_BOOM_RATE === 0.05 &&
        ACCIDENT_RANGED_SCALE === 0.9 &&
        ACCIDENT_DEF_PENALTY === 1 &&
        ACCIDENT_TABLE.length === 3,
      '口径：爆炸 5% / 反重力 远程 ×0.9 / 泄漏 防御 −1 / 三条表',
      `${ACCIDENT_BOOM_RATE} ${ACCIDENT_RANGED_SCALE} ${ACCIDENT_DEF_PENALTY} ${ACCIDENT_TABLE.length}`,
    );
  }

  // [G9] 中立守军对中立守军（野怪互殴）没有事故
  {
    const b = createBattle(
      { army: [{ unitTypeId: 'wolf', count: 10 }], attack: 0, defense: 0 },
      { army: [{ unitTypeId: 'boar', count: 10 }], attack: 0, defense: 0 },
      7,
    );
    ok(b.accident === null, '中立 vs 中立：没有事故（不是"有战斗就掷"）', '');
  }

  // [G10] 预估 === 实战：p4 英雄打野怪，战前预估里必须含同一条事故
  //
  // 2026-10-20 在这里抓到过一个真洞：`interaction.sides()`（战前预估用的那一份）
  // 漏了 `faction`，于是**预估按无族规则跑、实战按有族规则跑** —— 同一场仗两套规则。
  // 这条断言挑"事故真的会改变结果"的对局（否则它没有分辨力），
  // 修好之后两者逐字节一致；把 `faction` 删掉 ⇒ 立刻红。
  {
    let fixture = null;
    for (let gs = 1; gs <= 60 && !fixture; gs++) {
      const g = createGame(gs);
      const hero = g.heroes.hero1;
      const mon = Object.values(g.map.objects).find((o) => o.kind === 'wanderingMonster');
      if (!hero || !mon) continue;
      hero.owner = 'p4';
      hero.army = [{ unitTypeId: 'p4_hopgolem', count: 12 }];
      const setup = battleSetup(g, 'hero1', mon);
      if (!setup) continue;
      const withF = JSON.stringify(quickBattle(setup.attacker, setup.defender, setup.seed));
      const noF = JSON.stringify(
        quickBattle({ ...setup.attacker, faction: undefined }, setup.defender, setup.seed),
      );
      if (withF === noF) continue; // 这条种子上"有没有族"结果一样 ⇒ 没分辨力，换一个
      const est = previewInteraction(g, 'hero1', mon.id);
      if (!est?.estimate) continue;
      fixture = { g, setup, est, withF, noF };
    }
    if (!fixture) {
      ok(false, '找不到"事故会改变结果"的野怪对局（族动词可能根本没接进预估）', '');
    } else {
      const { setup, est, withF, noF } = fixture;
      const actual = JSON.stringify(quickBattle(setup.attacker, setup.defender, setup.seed));
      ok(
        JSON.stringify(est.estimate) === actual && actual === withF,
        'p4 英雄打野怪：战前预估 === 实战（同种子同一条事故，不玩两套规则）',
        `预估 ${est.estimate.rounds} 回合 vs 实战 ${JSON.parse(actual).rounds} 回合`,
      );
      ok(actual !== noF, '这条断言有分辨力：去掉族之后结果确实不同（否则它测不出东西）', '');
      // 公示：事故能把 p4 六格胜率摆动 19~60pp，"打不打"的答案会随开战骰改变。
      // 所以预估框里必须出现它 —— 玩家在按下开战前就知道这一场是什么规则。
      ok(
        /实验室事故/.test(est.message) && est.message.includes(String(est.estimate.accident?.name ?? '@')),
        '战前预估框公示事故（不是开战后才告诉玩家规则变了）',
        est.message.split('\n').pop() ?? '',
      );
    }
  }

  // [G11] 事故**不许**动主随机流
  //
  // 2026-10-20 实测：事故那一抽原本走 `s.rng()`，只多消耗 1 个数，却把整条伤害序列
  // 整体错位 ⇒ 同种子换个事故就变成另一场仗。表现是 `probe:d2` 的紫晶贴脸镜像
  // 从 70% 漂到 82%（跨过 80% 上限），而规则其实一点没动。
  // 现在走 `accidentRng`；这条断言按"前 8 个抽样必须与同种子新流一致"来锁死。
  {
    let pinned = null;
    for (let s = 1; s <= 40 && !pinned; s++) {
      const b = createBattle(
        { army: [{ unitTypeId: 'p4_hopgolem', count: 20 }], attack: 0, defense: 0, faction: 'p4' },
        { army: [{ unitTypeId: 'p4_hopgolem', count: 20 }], attack: 0, defense: 0, faction: 'p4' },
        s,
      );
      if (b.accident) pinned = { s, b };
    }
    if (!pinned) ok(false, '找不到会掷事故的种子（事故整条没接上）', '');
    else {
      const ref = mulberry32(pinned.s);
      const got = Array.from({ length: 8 }, () => pinned.b.rng());
      const want = Array.from({ length: 8 }, () => ref());
      ok(
        got.every((v, i) => Math.abs(v - want[i]) < 1e-12),
        '事故不消耗主随机流（同种子前 8 个伤害抽样与全新流逐个对齐）',
        `seed=${pinned.s}（${pinned.b.accident.kind}）首值 ${got[0].toFixed(6)} vs ${want[0].toFixed(6)}`,
      );
    }
  }
}

/* ---------------------------------------------------------------- 汇总 */

const pass = results.filter((r) => r.cond).length;
console.log(`\n${fail === 0 ? '✅' : '❌'} 共 ${results.length} 条断言：${pass} 过 / ${fail} 红`);
process.exit(fail === 0 ? 0 : 1);
