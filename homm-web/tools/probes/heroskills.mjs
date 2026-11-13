/**
 * heroskills.mjs —— M6 / H5 + H6 验收（§21.9 副技能 / §21.10 特长）
 *
 * ## 这批为什么必须有门
 *
 * 副技能的价值全在"数字真的进了结算"。这类改动最典型的四种坏法：
 *  ① **报价不可复现**：弹窗关掉再打开换了一批（玩家会以为游戏在耍他）；
 *  ② **钩子只接了一半**：实战乘了、预估没乘 ⇒ "提示 20、实际 24"，
 *     而没有任何断言会响（本项目在 `estimateDamage` 上踩过一次）；
 *  ③ **防御双算**：把 §21.2 的攻防差额和 §21.9 的减伤当成同一件事，乘两遍；
 *  ④ **死特长**：在"每天回满"的底子上写"额外回蓝"（§21.10 的 p4 原案就是这个）。
 *
 * ## 十一条断言
 *
 * | # | 判据 | 负向对照（必须红） |
 * |---|---|---|
 * | S1 | 6 条技能 / 3 级 / 3 槽 / 触发等级 = 2·4·6·8·10 | 换成"每 3 级一次"⇒ 只 3 次机会，点不出 2/2/1 |
 * | S2 | 报价可复现（连问 3 次逐位相同）、≤2 条、满级不出、槽满只出已学 | 已升到 3 级仍出现在报价里 ⇒ 必红 |
 * | S3 | 学点：同一技能 3 次到专家、第 4 次返回 null；槽满后新技能返回 null；点数同步递减 | 不扣点 / 允许第 4 级 ⇒ 必红 |
 * | S4 | 后勤 +10/20/30% 移动力（复算自 `BASE_MOVE_POINTS`，不写死数字） | 等级 0 也加成 ⇒ 必红 |
 * | S5 | 箭术 / 进攻 / 防御 / 巫术 / 纪律 / 蛮勇 六条钩子的**乘数与规格逐位相符** | 关掉技能 ⇒ 读数必须回到 1.00× |
 * | S6 | 预估 === 实战：同一对部队，`estimateDamage` 与 `actMelee/actShoot` 的技能系数一致 | 只给实战乘、预估不乘 ⇒ 比值偏离必红 |
 * | S7 | 急救：5/10/15% 向上取整，**全灭的兵种也能回来**，不超过战前人数 | 只复活残队 ⇒ 全灭那队缺额必红 |
 * | S8 | 祷言：0 法力也能放（`canCast` 放行）、不扣蓝、**只免一次**、`outcome.freeCastUsed` 回写 | 第二次也免蓝 ⇒ 必红 |
 * | S9 | 林地：草地消耗 ×0.75，**非草地一分不变**；只有游侠职业拿到 | 全地形减 ⇒ 非草地读数必红 |
 * | S10 | AI 升级当场花点（`skillPicks` 归 0）、人类玩家攒着等弹窗 | AI 也攒 ⇒ 永远不学 ⇒ 必红 |
 * | S11 | 真对局：35 天后 AI 英雄的技能覆盖率 > 0，且没有任何英雄的点数是负数 | 造一个负点数 ⇒ 必红 |
 *
 * ## 三条量法陷阱
 *
 * 1. **不能手算战斗伤害**：`estimateDamage` 里还有冲锋 / 祝福 / 誓约 / 长距离衰减，
 *    直接除一下得出"×1.5"会在带族动词的兵上算歪。S5 一律走**同一函数两臂相除**。
 * 2. **读 `BASE_MOVE_POINTS` 而不是写 1800**：常量会被调（铁律 13）。
 * 3. **"没量到"≠"量到 0"**：`skillOffers` 在池子只剩 1 条时返回 1 条（合法），
 *    不能把"长度 ≠ 2"判成失败；只有**池子 ≥2 时返回 ≠2** 才是 bug。
 *
 * ## 用法
 * ```
 * node tools/probes/heroskills.mjs          # 默认 4 seed × 35 天
 * SEEDS=2 node tools/probes/heroskills.mjs  # 快跑
 * ```
 * 退出码：0 全过 · 1 有断言不过 · 2 没有构建
 */
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=heroskills');
const u = (rel) => distUrl(rel, DIST);
for (const f of [
  'core/data/skills.js', 'core/data/specialties.js', 'core/data/heroes.js',
  'core/game/skills.js', 'core/game/hero.js', 'core/game/turn.js',
  'core/map/generator.js', 'core/map/pathfinding.js', 'core/combat/battle.js',
  'core/combat/hex.js',
]) requireFile(DIST, f);

const SK = await import(u('core/data/skills.js'));
const SP = await import(u('core/data/specialties.js'));
const GS = await import(u('core/game/skills.js'));
const GH = await import(u('core/game/hero.js'));
const PF = await import(u('core/map/pathfinding.js'));
const BT = await import(u('core/combat/battle.js'));
const HEX = await import(u('core/combat/hex.js'));
const { createGame } = await import(u('core/map/generator.js'));
const { endDay } = await import(u('core/game/turn.js'));

const SEEDS = Number(process.env.SEEDS ?? 4);
let bad = 0;
const HEAD = (s) => console.log(`\n=== ${s} ===`);
const PASS = (cond, msg) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) bad++;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/** 一张能用的图（口袋关掉：这批与地图无关，别让生成器噪声进来）。 */
function fresh(seed = 20261113) {
  return createGame({
    seed,
    layout: 'wild',
    size: 'medium',
    opponents: 1,
    playerName: '测试',
    pockets: false,
  });
}

/* ---------------------------------------------------------------- S1 数据表 */
HEAD('S1 · 副技能表与规格逐位对齐');
const WANT = {
  logistics: [0.1, 0.2, 0.3],
  archery: [1.1, 1.25, 1.5],
  offense: [1.1, 1.2, 1.3],
  defense: [0.05, 0.1, 0.15],
  firstAid: [0.05, 0.1, 0.15],
  sorcery: [1.05, 1.1, 1.15],
};
PASS(SK.SKILL_ORDER.length === 6 && SK.SKILL_ORDER.every((id) => !!SK.SKILLS[id]), '恰好 6 条技能，且每条都有定义');
PASS(SK.SKILL_MAX_LEVEL === 3 && SK.SKILL_SLOTS === 3, `3 级上限 / 3 槽（实测 ${SK.SKILL_MAX_LEVEL} / ${SK.SKILL_SLOTS}）`);
PASS(
  JSON.stringify([...SK.SKILL_PICK_LEVELS]) === JSON.stringify([2, 4, 6, 8, 10]),
  `触发等级 = ${SK.SKILL_PICK_LEVELS.join('/')}（共 ${SK.SKILL_PICK_LEVELS.length} 次）`,
);
// 负向对照：规格否掉的那个方案（每 3 级一次）只给 3 次机会
const everyThree = [3, 6, 9];
PASS(everyThree.length < SK.SKILL_PICK_LEVELS.length, '负向对照：「每 3 级一次」只有 3 次点，点不出 2/2/1');
const curvePairs = [
  ['LOGISTICS_MOVE', SK.LOGISTICS_MOVE, WANT.logistics],
  ['ARCHERY_MUL', SK.ARCHERY_MUL, WANT.archery],
  ['OFFENSE_MUL', SK.OFFENSE_MUL, WANT.offense],
  ['DEFENSE_REDUCE', SK.DEFENSE_REDUCE, WANT.defense],
  ['FIRST_AID_RATIO', SK.FIRST_AID_RATIO, WANT.firstAid],
  ['SORCERY_MUL', SK.SORCERY_MUL, WANT.sorcery],
];
for (const [name, got, want] of curvePairs) {
  PASS(got.length === 3 && got.every((v, i) => near(v, want[i])), `${name} = ${got.join(' / ')}`);
}
PASS(
  SP.SPECIALTY_OF_CLASS.knight === 'discipline' &&
    SP.SPECIALTY_OF_CLASS.barbarian === 'ferocity' &&
    SP.SPECIALTY_OF_CLASS.ranger === 'woodland' &&
    SP.SPECIALTY_OF_CLASS.cleric === 'prayer',
  '四个职业各绑一个特长（p1 纪律 / p2 蛮勇 / p3 林地 / p4 祷言）',
);

/* ---------------------------------------------------------------- S2 报价 */
HEAD('S2 · 报价可复现、二选一、满级不出现');
{
  const st = fresh();
  const h = st.heroes.hero1;
  const a = GS.skillOffers(st, h);
  const b = GS.skillOffers(st, h);
  const c = GS.skillOffers(st, h);
  PASS(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(b) === JSON.stringify(c), `同一状态连问 3 次逐位相同（${a.join(' + ')}）`);
  PASS(a.length <= 2 && a.length >= 1, `给出 ${a.length} 条候选（池子 ≥2 时应为 2；池子只有 1 条时 1 条是合法的）`);
  PASS(new Set(a).size === a.length, '候选不重复');

  // 把 firstAid 升到专家 ⇒ 它必须从报价池里消失
  h.skills = [{ id: 'firstAid', level: 3 }];
  h.skillPicks = 3;
  const after = [];
  for (let i = 0; i < 20; i++) after.push(...GS.skillOffers(st, h));
  PASS(!after.includes('firstAid'), '已到专家的技能不再出现在任何一次报价里（20 次取样）');

  // 槽位满 3 条 ⇒ 只从已学里出
  h.skills = [
    { id: 'firstAid', level: 1 },
    { id: 'offense', level: 1 },
    { id: 'defense', level: 1 },
  ];
  h.skillPicks = 2;
  const full = [];
  for (let i = 0; i < 12; i++) full.push(...GS.skillOffers(st, h));
  PASS(full.length > 0 && full.every((id) => ['firstAid', 'offense', 'defense'].includes(id)), `槽满 3 条后只出已学的（实测 ${[...new Set(full)].join('/')}）`);
  PASS(GS.heroSkills(h).length === 3, '容错读取：3 条已学');
  // 负向对照：第 4 条本来就不该能学
  h.skillPicks = 1;
  PASS(GS.learnSkill(h, 'archery') === null, '负向对照：槽满时学第 4 条技能返回 null');
}

/* ---------------------------------------------------------------- S3 学点 */
HEAD('S3 · 学点：3 级封顶、点数同步递减');
{
  const st = fresh(20261114);
  const h = st.heroes.hero1;
  h.skills = [];
  h.skillPicks = 5;
  const t1 = GS.learnSkill(h, 'archery');
  const t2 = GS.learnSkill(h, 'archery');
  const t3 = GS.learnSkill(h, 'archery');
  const t4 = GS.learnSkill(h, 'archery');
  PASS(!!t1 && !!t2 && !!t3, `三次升级都成功：${[t1, t2, t3].join(' → ')}`);
  PASS(GS.skillLevel(h, 'archery') === 3, '第 3 次到专家（等级 = 3）');
  PASS(t4 === null, '负向对照：第 4 次返回 null（不许超过 3 级）');
  PASS(GS.pendingPicks(h) === 2, `点数从 5 递减到 ${GS.pendingPicks(h)}（只扣成功的那 3 次）`);
  h.skillPicks = 0;
  PASS(GS.learnSkill(h, 'offense') === null, '没有点数时学不了');
}

/* ---------------------------------------------------------------- S4 后勤 */
HEAD('S4 · 后勤：移动力 +10/20/30%');
{
  const st = fresh(20261115);
  const h = st.heroes.hero1;
  // 常量从模块读，不写死 1800（铁律 13）
  const base = GH.maxMovePoints(h, st);
  h.skills = [{ id: 'logistics', level: 0 }];
  const lv0 = GH.maxMovePoints(h, st);
  h.skills = [{ id: 'logistics', level: 1 }];
  const lv1 = GH.maxMovePoints(h, st);
  h.skills = [{ id: 'logistics', level: 2 }];
  const lv2 = GH.maxMovePoints(h, st);
  h.skills = [{ id: 'logistics', level: 3 }];
  const lv3 = GH.maxMovePoints(h, st);
  PASS(lv0 === base, `等级 0 = 基线 ${base}（负向对照：没学不该有任何加成）`);
  PASS(lv1 === Math.round(base * 1.1) && lv2 === Math.round(base * 1.2) && lv3 === Math.round(base * 1.3), `+10/20/30% ⇒ ${lv1}/${lv2}/${lv3}（基线 ${base}）`);
}

/* ---------------------------------------------------------------- S5 钩子 */
HEAD('S5 · 六条战斗钩子的乘数');
const ARMY_A = [{ unitTypeId: 'p1_knight', count: 8 }];
const ARMY_D = [{ unitTypeId: 'p3_dwarf', count: 14 }];
const sideOf = (over = {}) => ({ army: ARMY_A.map((x) => ({ ...x })), attack: 4, defense: 4, faction: 'p1', ...over });
const foeOf = (over = {}) => ({ army: ARMY_D.map((x) => ({ ...x })), attack: 2, defense: 3, faction: 'p3', ...over });
const battle = (over = {}, foeOver = {}) => BT.createBattle(sideOf(over), foeOf(foeOver), 12345);
const firstOf = (s, side) => s.units.find((x) => x.side === side);
/** 两臂相除：同一种子、同一对部队，只差技能表。 */
function ratio(fn) {
  const plain = fn(battle());
  const buffed = fn(battle({ skills: { archery: 3, offense: 3 } }));
  return buffed / plain;
}
{
  // 箭术：预估远程伤害 ×1.5（专家）
  const s0 = battle();
  const s1 = battle({ skills: { archery: 3 } });
  const r0 = BT.estimateDamage(s0, firstOf(s0, 0), firstOf(s0, 1), true);
  const r1 = BT.estimateDamage(s1, firstOf(s1, 0), firstOf(s1, 1), true);
  PASS(near(r1 / r0, 1.5, 0.02), `箭术专家 ⇒ 远程预估 ×${(r1 / r0).toFixed(3)}（规格 1.50）`);

  const m0 = battle();
  const m1 = battle({ skills: { offense: 3 } });
  const q0 = BT.estimateDamage(m0, firstOf(m0, 0), firstOf(m0, 1), false);
  const q1 = BT.estimateDamage(m1, firstOf(m1, 0), firstOf(m1, 1), false);
  PASS(near(q1 / q0, 1.3, 0.02), `进攻专家 ⇒ 近战预估 ×${(q1 / q0).toFixed(3)}（规格 1.30）`);

  // 防御：受方带技能 ⇒ 受伤 ×0.85
  const d0 = battle();
  const d1 = battle({}, { skills: { defense: 3 } });
  const t0 = BT.estimateDamage(d0, firstOf(d0, 0), firstOf(d0, 1), false);
  const t1 = BT.estimateDamage(d1, firstOf(d1, 0), firstOf(d1, 1), false);
  PASS(near(t1 / t0, 0.85, 0.02), `防御专家 ⇒ 受伤 ×${(t1 / t0).toFixed(3)}（规格 0.85）`);

  // 巫术：magicArrow 伤害 ×1.15（专家）。同一颗种子、同一目标，只差技能表。
  const castDmg = (skills) => {
    const s = battle({ skills, caster: { spells: ['magicArrow'], spellPower: 3, mana: 30 } });
    const ev = BT.castSpell(s, 0, 'magicArrow', firstOf(s, 1));
    return ev.find((e) => e.t === 'cast')?.damage ?? 0;
  };
  const c0 = castDmg({});
  const c1 = castDmg({ sorcery: 3 });
  PASS(near(c1 / c0, 1.15, 0.03), `巫术专家 ⇒ 法术伤害 ×${(c1 / c0).toFixed(3)}（规格 1.15）`);

  // 纪律：第 1 回合 +1，5 级起 +2，第 2 回合 0
  const disc = (level, round) => {
    const s = battle({ specialty: 'discipline', heroLevel: level });
    s.round = round;
    return BT.disciplineAtk(s, 0);
  };
  PASS(disc(1, 1) === 1 && disc(4, 1) === 1 && disc(5, 1) === 2 && disc(20, 1) === 2, `纪律：1 级 +${disc(1, 1)} / 4 级 +${disc(4, 1)} / 5 级 +${disc(5, 1)} / 20 级 +${disc(20, 1)}`);
  PASS(disc(20, 2) === 0, '负向对照：第 2 回合纪律归零（不是全程 +2）');

  // 蛮勇：每 4 级 +5%，上限 +25%
  const fero = (level) => {
    const s = battle({ specialty: 'ferocity', heroLevel: level });
    return BT.meleeDamageMul(s, 0);
  };
  PASS(near(fero(3), 1) && near(fero(4), 1.05) && near(fero(8), 1.1), `蛮勇：3 级 ×${fero(3)} / 4 级 ×${fero(4)} / 8 级 ×${fero(8)}`);
  PASS(near(fero(40), 1.25), `蛮勇封顶 ×${fero(40)}（上限 +25%，不是无限涨）`);
  // 负向对照：没这个特长就是干净的 ×1
  const none = battle();
  PASS(near(BT.meleeDamageMul(none, 0), 1) && near(BT.rangedDamageMul(none, 0), 1), '负向对照：没有技能/特长时两条乘数都是 1.00');
}

/* ---------------------------------------------------------------- S6 预估 === 实战 */
HEAD('S6 · 预估与实战用同一串乘数');
{
  /**
   * 做法：把同一场仗打一遍，取**第一次近战**的实际伤害，与战前 `estimateDamage`
   * 的期望值比。骰点是 1..max 的均匀分布，单次抽样必然有偏差 ⇒ 不比绝对值，
   * 比**两臂的比值**（无技能 vs 进攻专家），两个比值必须同为 1.30。
   */
  /**
   * ⚠️ 不能用 `hex.x + 1` 造相邻格：战场是**偏移坐标的正六边形**，
   * 相邻关系不等于"x 加一"（S6 第一版就是这么写的，两臂都读到 0，
   * 看起来像"技能没生效"，其实是 `actMelee` 判定不贴脸直接返回空）。
   * 正确做法是问引擎要邻居。
   */
  const actual = (skills) => {
    const s = battle({ skills });
    const atk = firstOf(s, 0);
    const def = firstOf(s, 1);
    /* ⚠️ 战场的 `Hex` 是 `{col,row}`（不是地图的 `{x,y}`）。
     * 第一版写 `x.hex.x === h.x` ⇒ 两边都是 undefined ⇒ **恒等成立** ⇒
     * 每个邻格都被判成"已占用"，报"找不到空邻格"（又一个"看起来对"的坑）。 */
    const free = HEX.neighbors(atk.hex).find(
      (h) => HEX.inField(h) && !s.units.some((x) => x.count > 0 && x.hex.col === h.col && x.hex.row === h.row),
    );
    if (!free) throw new Error('S6：找不到空邻格');
    def.hex = { ...free };
    const ev = BT.actMelee(s, atk, def);
    const dmg = ev.find((e) => e.t === 'melee')?.damage ?? 0;
    if (!dmg) throw new Error('S6：actMelee 没打出伤害（夹具坏了，不是技能坏了）');
    return dmg;
  };
  const a0 = actual({});
  const a1 = actual({ offense: 3 });
  const est0 = (() => {
    const s = battle();
    return BT.estimateDamage(s, firstOf(s, 0), firstOf(s, 1), false);
  })();
  const est1 = (() => {
    const s = battle({ skills: { offense: 3 } });
    return BT.estimateDamage(s, firstOf(s, 0), firstOf(s, 1), false);
  })();
  PASS(near(a1 / a0, est1 / est0, 0.08), `实战比 ${(a1 / a0).toFixed(3)} === 预估比 ${(est1 / est0).toFixed(3)}（同一串乘数）`);
  PASS(a1 > a0, `进攻专家确实更疼：${a0} → ${a1}`);
}

/* ---------------------------------------------------------------- S7 急救 */
HEAD('S7 · 急救：5/10/15% 向上取整，全灭的兵种也能回来');
{
  const st = fresh(20261116);
  const h = st.heroes.hero1;
  const losses = [
    { unitTypeId: 'p1_crossbow', before: 20, after: 0 },   // 整队死光
    { unitTypeId: 'p1_child', before: 10, after: 7 },       // 死了 3 个
    { unitTypeId: 'p1_eagle', before: 5, after: 5 },        // 一个没死
  ];
  h.skills = [];
  PASS(GS.fieldHospital(h, losses).length === 0, '没学急救 ⇒ 一个都不回');
  h.skills = [{ id: 'firstAid', level: 1 }];
  const a1 = GS.fieldHospital(h, losses);
  PASS(a1.length === 2, `基础：只对死过人的两档生效（${a1.map((x) => `${x.unitTypeId}+${x.count}`).join(' ')}）`);
  const got1 = Object.fromEntries(a1.map((x) => [x.unitTypeId, x.count]));
  PASS(got1.p1_crossbow === 1 && got1.p1_child === 1, `基础 5%：20 死光 ⇒ +${got1.p1_crossbow}（ceil 1）、10 死 3 ⇒ +${got1.p1_child}（ceil 1）`);
  h.skills = [{ id: 'firstAid', level: 3 }];
  const a3 = Object.fromEntries(GS.fieldHospital(h, losses).map((x) => [x.unitTypeId, x.count]));
  PASS(a3.p1_crossbow === 3 && a3.p1_child === 1, `专家 15%：20 死光 ⇒ +${a3.p1_crossbow}（ceil 3）、10 死 3 ⇒ +${a3.p1_child}（ceil 1）`);
  PASS(a3.p1_crossbow <= 20 && a3.p1_child <= 3, '不会超过战前人数');
  // 负向对照：如果只复活"残队"（把 after=0 的跳过），全灭那档会缺额
  const partial = losses.filter((l) => l.after > 0).map((l) => Math.max(1, Math.ceil((l.before - l.after) * 0.15)));
  PASS(partial.every((v) => v !== a3.p1_crossbow), '负向对照：跳过全灭兵种的算法给出不同读数（说明这一档真的被覆盖了）');
}

/* ---------------------------------------------------------------- S8 祷言 */
HEAD('S8 · 祷言：0 法力也能放，只免一次，用掉要回写');
{
  const s = battle({ caster: { spells: ['magicArrow'], spellPower: 2, mana: 0 }, freeFirstCast: true });
  const target = firstOf(s, 1);
  PASS(BT.canCast(s, 0, 'magicArrow') === true, '0 法力 + 免蓝首法 ⇒ canCast 放行');
  const ev = BT.castSpell(s, 0, 'magicArrow', target);
  PASS(ev.length > 0 && s.casters[0].mana === 0, `第一发真的打出去了，且法力仍是 ${s.casters[0].mana}`);
  PASS(s.freeCastUsed[0] === true, '本场记下"用掉了免蓝首法"');
  const out = BT.toOutcome(s);
  PASS(out.freeCastUsed === true, 'outcome 带出 freeCastUsed（世界层据此写 hero.freeCastDay）');

  const s2 = battle({ caster: { spells: ['magicArrow'], spellPower: 2, mana: 0 }, freeFirstCast: true });
  BT.castSpell(s2, 0, 'magicArrow', firstOf(s2, 1));
  // 同一回合只能施法一次，所以要等下一回合才验"第二次不免蓝"
  s2.castUsed[0] = false;
  PASS(BT.canCast(s2, 0, 'magicArrow') === false, '负向对照：第二发不再免蓝 ⇒ 0 法力放不出来');
  // 没带自由施法的一侧：0 法力本来就不能放
  const s3 = battle({ caster: { spells: ['magicArrow'], spellPower: 2, mana: 0 } });
  PASS(BT.canCast(s3, 0, 'magicArrow') === false, '负向对照：没有特长时 0 法力不能放（说明差异来自特长）');
}

/* ---------------------------------------------------------------- S9 林地 */
HEAD('S9 · 林地：草地 ×0.75，非草地一分不变');
{
  const st = fresh(20261117);
  const h = st.heroes.hero1;
  // 找一对相邻的草地格与一对相邻的非草地格
  const W = st.map.width;
  const H = st.map.height;
  const T = (x, y) => st.map.tiles[y * W + x].terrain;
  const passable = (x, y) => PF.stepCostOn(st.map, { x, y }, { x, y }) === 0 || PF.stepCostOn(st.map, { x: x - 1, y }, { x, y });
  let grass = null;
  let other = null;
  for (let y = 1; y < H - 1 && (!grass || !other); y++) {
    for (let x = 2; x < W - 1; x++) {
      const c = PF.stepCostOn(st.map, { x: x - 1, y }, { x, y });
      if (!isFinite(c)) continue;
      if (T(x, y) === 'grass' && !grass) grass = { from: { x: x - 1, y }, to: { x, y } };
      if (T(x, y) !== 'grass' && !other) other = { from: { x: x - 1, y }, to: { x, y } };
      if (grass && other) break;
    }
  }
  PASS(!!grass && !!other, `地图上找到草地与非草地各一对（草地 ${grass ? `${grass.to.x},${grass.to.y}` : '缺'} / 其他 ${other ? `${other.to.x},${other.to.y}` : '缺'}）`);
  if (grass && other) {
    const g0 = PF.stepCostOn(st.map, grass.from, grass.to);
    const g1 = PF.stepCostOn(st.map, grass.from, grass.to, 0.75);
    const o0 = PF.stepCostOn(st.map, other.from, other.to);
    const o1 = PF.stepCostOn(st.map, other.from, other.to, 0.75);
    PASS(g1 === Math.round(g0 * 0.75), `草地 ${g0} → ${g1}（×0.75）`);
    PASS(o0 === o1, `负向对照：非草地 ${o0} → ${o1}（一分没少）`);
  }
  // 只有游侠拿到这个特长
  h.heroClass = '游侠';
  PASS(near(GH.grassMoveMul(h), 0.75), '游侠 ⇒ 草地乘数 0.75');
  h.heroClass = '骑士';
  PASS(near(GH.grassMoveMul(h), 1), '负向对照：骑士 ⇒ 1.00');
  h.heroClass = '野蛮人';
  PASS(near(GH.grassMoveMul(h), 1), '负向对照：野蛮人 ⇒ 1.00');
}

/* ---------------------------------------------------------------- S10 AI 花点 */
HEAD('S10 · AI 升级当场花点，人类攒着等弹窗');
{
  const st = fresh(20261118);
  const human = st.heroes.hero1;
  human.skillPicks = 0;
  human.skills = [];
  PASS(GS.grantSkillPicks(st, human, 2) === true, '2 级触发一次发点');
  PASS(GS.pendingPicks(human) === 1 && GS.heroSkills(human).length === 0, `人类玩家：点攒着（${GS.pendingPicks(human)} 点，0 条已学）`);
  PASS(GS.grantSkillPicks(st, human, 6) === true && GS.pendingPicks(human) === 2, '6 级再发 1 点 ⇒ 共 2 点');
  PASS(GS.grantSkillPicks(st, human, 3) === false, '负向对照：3 级不是触发等级，不发点');

  const ai = Object.values(st.heroes).find((x) => x.owner !== human.owner && !st.players[x.owner]?.isHuman);
  PASS(!!ai, '图上有 AI 英雄');
  if (ai) {
    ai.skills = [];
    ai.skillPicks = 0;
    GS.grantSkillPicks(st, ai, 2);
    PASS(GS.pendingPicks(ai) === 0 && GS.heroSkills(ai).length === 1, `AI：当场花掉（剩 ${GS.pendingPicks(ai)} 点，已学 ${GS.heroSkills(ai).length} 条）`);
    // 负向对照：把 AI 当人类处理后，它就不学了
    ai.skills = [];
    ai.skillPicks = 0;
    st.players[ai.owner].isHuman = true;
    GS.grantSkillPicks(st, ai, 4);
    PASS(GS.pendingPicks(ai) === 1 && GS.heroSkills(ai).length === 0, '负向对照：把 isHuman 翻成 true ⇒ 点也不花（证明分流来自 isHuman 而不是别的）');
    st.players[ai.owner].isHuman = false;
  }
}

/* ---------------------------------------------------------------- S11 真对局 */
HEAD(`S11 · 真对局：${SEEDS} seed × 35 天`);
{
  let covered = 0;
  let total = 0;
  let negative = 0;
  let maxed = 0;
  for (let i = 0; i < SEEDS; i++) {
    const st = createGame({
      seed: 77001 + i * 131,
      layout: 'wild',
      size: 'medium',
      opponents: 2,
      playerName: '测试',
    });
    for (let d = 0; d < 35; d++) {
      if (st.status !== 'playing') break;
      endDay(st);
    }
    for (const h of Object.values(st.heroes)) {
      total++;
      const learned = GS.heroSkills(h);
      if (learned.length) covered++;
      if ((h.skillPicks ?? 0) < 0) negative++;
      if (learned.some((s) => s.level > 3)) maxed++;
    }
  }
  console.log(`  35 天后存活英雄 ${total} 人，其中学过副技能 ${covered} 人（${total ? Math.round((covered / total) * 100) : 0}%）`);
  PASS(total > 0, `量到了对象（${total} 个英雄；0 个 ⇒ 是"没量到"，不是"量到 0"）`);
  PASS(covered > 0, '至少有一个英雄真的学到了副技能（AI 升级链路通了）');
  PASS(negative === 0, '没有任何英雄的点数是负数');
  PASS(maxed === 0, '没有任何技能超过 3 级');
}

console.log(`\n${bad ? `✗ 失败 ${bad} 条` : '✓ 全过'}（H5 副技能 + H6 特长）`);
process.exit(bad ? 1 : 0);
