/**
 * 招牌能力 + 高级兵自带魔法 验收探针（S4 · spec §16.3 / §10.3，2026-11-11）。
 *
 * 覆盖 **4 类招牌能力 + 6 条自带魔法**，每一条都必须能**单独归因**
 * （本项目铁律：新机制必须能单独证明自己活着，且要有负向对照）。
 *
 *   [A] 数据口径：`canFly` 恰好 6 个兵、`innate` 恰好 6 条且逐条对得上 §10.3 的表。
 *   [B] 飞行（§16.9① B 越墙）：越过城墙、落点仍禁「有人 / 有城防」、护城河不停步。
 *   [C] 吸血：近战造成伤害后按 `伤害×比例÷HP` 回补，上限 = 建队人数。
 *   [D] 自复活：本队被歼灭时 `max(1, ceil(战前人数×0.2))` 重返战场，**每场一次**。
 *   [E] 威压：命中让目标速度 −2（与减速/缠根同一条口径，不叠加）。
 *   [F] 六条自带魔法：誓约 / 熔岩护甲 / 烈焰缠身 / 投石压制 / 龙威 / 震慑。
 *
 * 用法：
 *   node tools/probes/innate.mjs
 *   node tools/probes/innate.mjs --dist=dist
 *   退出码 0 = 全过；1 = 有硬断言失败；2 = 构建缺产物。
 *
 * ⚠️ 负向对照（复跑手册）：
 *   · `reachable()` 删掉 `if (!u.canFly)` 分支 ⇒ [B1] 红（飞行和走路一样）。
 *   · `afterHit` 的 `Math.ceil` 改成 `Math.floor` ⇒ [D1] 红（1 只的天使复活 0 只）。
 *   · `applyOath` 首行 `return { dmg, ev: [] }` ⇒ [F1a/F1b] 红。
 *   · `lavaReflect` 去掉 `maxSafe` ⇒ [F2b] 红（反弹会把攻方打死）。
 *   · `useInnate` 删掉次数判断 ⇒ [F3c]/[F4c]/[F6b] 红（上限失效）。
 *   · `refreshFear` 首行 `return` ⇒ [F5a/F5b] 红。
 */
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'probe=innate');
for (const f of ['core/combat/battle.js', 'core/data/units.js', 'core/data/innates.js', 'core/combat/hex.js']) {
  requireFile(DIST, f);
}

const B = await import(distUrl('core/combat/battle.js', DIST));
const { UNITS, getUnit } = await import(distUrl('core/data/units.js', DIST));
const { INNATES, INNATE_BY_UNIT } = await import(distUrl('core/data/innates.js', DIST));
const { FIELD_H, FIELD_W, neighbors, hexKey, hexEq } = await import(distUrl('core/combat/hex.js', DIST));
const { MOAT_COL } = await import(distUrl('core/combat/siege.js', DIST));

const {
  actMelee,
  actMove,
  actShoot,
  createBattle,
  endActivation,
  estimateDamage,
  hasEffect,
  reachable,
  strikeAtkBonus,
  unitSpeed,
  DREAD_EFFECT,
  SUPPRESS_EFFECT,
  LAVA_REFLECT_RATE,
  FLAME_BODY_DAMAGE,
  STUN_DEF,
  OATH_REDUCE,
  FEAR_ATK,
} = B;

let fail = 0;
function ok(cond, title, detail = '') {
  if (!cond) fail += 1;
  console.log(`${cond ? '  ✅' : '  ❌'} ${title}${detail ? ` — ${detail}` : ''}`);
}
function section(t) {
  console.log(`\n${t}`);
}

/** 最小战场：两侧英雄加成给 0，免得别的数值混进读数。 */
function mk(att, def, seed = 20261111, siege = 0) {
  return createBattle(
    { army: att, attack: 0, defense: 0, faction: null },
    { army: def, attack: 0, defense: 0, faction: null },
    seed,
    siege,
  );
}
const one = (s, id) => s.units.find((u) => u.unitTypeId === id);
/** 找一个空格邻格（不叠人、不越界）。 */
function freeNeighbor(s, u) {
  for (const h of neighbors(u.hex)) {
    if (h.col < 0 || h.row < 0 || h.col >= FIELD_W || h.row >= FIELD_H) continue;
    if (s.units.some((x) => x.count > 0 && x.id !== u.id && hexEq(x.hex, h))) continue;
    return h;
  }
  return null;
}
const countEvents = (ev, t, innate) => ev.filter((e) => e.t === t && (!innate || e.innate === innate)).length;

/* ============================================================ [A] 数据口径 */

section('[A] 数据口径（§16.3 / §10.3 的表必须逐条对上）');

const flyers = Object.values(UNITS)
  .filter((u) => u.canFly && !u.upgradeOf)
  .map((u) => u.id)
  .sort();
ok(flyers.length === 6, 'canFly 恰好 6 个基础兵（升级形态继承，不另计）', flyers.join(' / '));

const innates = Object.values(UNITS)
  .filter((u) => u.innate && !u.upgradeOf)
  .map((u) => `${u.id}:${u.innate.id}`)
  .sort();
const expectInnate = Object.values(INNATES)
  .map((d) => `${d.unitId}:${d.id}`)
  .sort();
ok(
  innates.length === 6 && innates.join('|') === expectInnate.join('|'),
  'innate 恰好 6 条，且与 INNATES 表逐条同源（不许换兵）',
  innates.join(' '),
);
ok(
  INNATE_BY_UNIT.p1_knight === 'oath' &&
    INNATE_BY_UNIT.p2_lavagiant === 'lavaArmor' &&
    INNATE_BY_UNIT.p2_devil === 'flameBody' &&
    INNATE_BY_UNIT.p3_ape === 'stoneSuppress' &&
    INNATE_BY_UNIT.p3_greendragon === 'dragonFear' &&
    INNATE_BY_UNIT.p4_minotaur === 'stun',
  '反查表与 §10.3 的分配一致',
);
ok(
  INNATES.oath.perBattle === 0 && INNATES.lavaArmor.perBattle === 0 && INNATES.dragonFear.perBattle === 0,
  '光环 / 被动不受次数约束（perBattle = 0）',
);
ok(
  INNATES.flameBody.perBattle === 2 && INNATES.stoneSuppress.perBattle === 3 && INNATES.stun.perBattle === 2,
  'trigger 类的上限是 2 / 3 / 2',
);
ok(
  getUnit('p1_angel').selfRevive === 0.2 && getUnit('p4_vampire').drain === 0.5 && getUnit('p4_wraith').drain === 0.3,
  '招牌能力是兵种字段（自复活 0.2 / 吸血 0.5 / 0.3）',
);
ok(
  getUnit('p4_vampire_u').drain === 0.5 && getUnit('p1_knight_u').innate?.id === 'oath' && getUnit('p1_angel_u').canFly,
  '升级形态继承招牌能力与自带魔法（makeUpgrade 的 ...base）',
);

/* ============================================================ [B] 飞行 */

section('[B] 飞行 = B 越墙（§16.9①）');

{
  const s = mk([{ unitTypeId: 'p1_eagle', count: 1 }], [{ unitTypeId: 'p1_child', count: 1 }], 7, 1);
  const eagle = one(s, 'p1_eagle');
  const child = one(s, 'p1_child');
  eagle.hex = { col: 5, row: 5 }; // 速度 9：从 0 起根本到不了墙（11）以外
  child.hex = { col: FIELD_W - 1, row: 0 };
  const wallCols = s.siege.structures.map((st) => st.hex.col);
  const maxWall = Math.max(...wallCols);
  const cols = (u) => [...reachable(s, u).keys()].map((k) => Number(k.split(',')[0]));

  ok(Math.max(...cols(eagle)) > maxWall, 'B1 飞行兵能越过城墙（可达格跨过墙线）', `最远 col ${Math.max(...cols(eagle))} / 墙 ${maxWall}`);

  // 负向对照：同一支部队关掉 canFly ⇒ 到不了墙内
  eagle.canFly = false;
  ok(Math.max(...cols(eagle)) <= maxWall, 'B1⁻ 同速地面兵到不了墙内（负向对照）', `最远 col ${Math.max(...cols(eagle))}`);
  eagle.canFly = true;

  ok(!reachable(s, eagle).has(hexKey(child.hex)), 'B2 落点禁「有人」（不能飞到已被占的格）');
  const wallHex = s.siege.structures.find((st) => st.hp > 0)?.hex;
  if (wallHex) ok(!reachable(s, eagle).has(hexKey(wallHex)), 'B2 落点禁「有城防」（不能停在墙上）');
}

{
  // 护城河：地面兵踩进去停步；飞行兵从上方过去、落在墙后，不停步也不吃 −2 防
  const s = mk([{ unitTypeId: 'p1_eagle', count: 1 }], [{ unitTypeId: 'p1_child', count: 1 }], 9, 1);
  const flyer = one(s, 'p1_eagle');
  const walker = one(s, 'p1_child');
  const moat = { col: MOAT_COL, row: 5 };

  walker.side = 0; // 护城河只坑攻方（side 0）
  walker.hex = { col: MOAT_COL - 1, row: 5 };
  const ev1 = actMove(s, walker, moat);
  ok(ev1.length === 1 && walker.moatStuck === true, 'B3 地面兵进护城河 ⇒ 本回合停步');

  flyer.hex = { col: MOAT_COL - 1, row: 5 };
  const behind = { col: 12, row: 5 }; // 护城河(10) + 城墙(11) 之后
  const ev2 = actMove(s, flyer, behind);
  ok(
    ev2.length === 1 && flyer.hex.col === 12 && flyer.moatStuck === false,
    'B3 飞行兵穿过护城河与城墙落到城内 ⇒ 不停步（§16.9① 第 3 条）',
    `落在 col ${flyer.hex.col}`,
  );
}

/* ============================================================ [C] 吸血 */

section('[C] 吸血（§16.3 第 2 条）');

{
  const s = mk([{ unitTypeId: 'p4_vampire', count: 20 }], [{ unitTypeId: 'p4_zombie', count: 12 }], 31);
  const vamp = one(s, 'p4_vampire');
  const z = one(s, 'p4_zombie');
  z.hex = freeNeighbor(s, vamp);
  // 满编时 room = 0（回补不能超过建队人数），所以先掉 5 个再看它吸回来
  vamp.count = 15;
  const before = vamp.count;
  const ev = actMelee(s, vamp, z);
  const drain = ev.find((e) => e.t === 'drain');
  ok(!!drain && vamp.count > before, 'C1 吸血鬼近战命中后回补人数', `+${drain?.healed ?? 0}`);

  // 上限 = 建队人数：起手 2/3，一次最多补到 3，第二击不再补
  const s2 = mk([{ unitTypeId: 'p4_vampire', count: 3 }], [{ unitTypeId: 'p4_zombie', count: 20 }], 31);
  const v2 = one(s2, 'p4_vampire');
  const d2 = one(s2, 'p4_zombie');
  v2.count = 2; // startCount 仍是 3
  s2.atkBonus[0] = 100; // 把伤害抬上去，否则 15 HP 的兵吸不到 1 个
  d2.hex = freeNeighbor(s2, v2);
  d2.retaliated = true;
  const e1 = actMelee(s2, v2, d2);
  const healed1 = e1.find((x) => x.t === 'drain')?.healed ?? 0;
  d2.retaliated = true;
  d2.hpTop = getUnit(d2.unitTypeId).hp;
  const e2 = actMelee(s2, v2, d2);
  ok(healed1 === 1 && v2.count === 3, 'C2 回补卡在建队人数（2 → 3）', `healed=${healed1} count=${v2.count}`);
  ok(!e2.some((x) => x.t === 'drain'), 'C2 满编后不再吸血（room = 0）');

  // 负向对照：没有 drain 字段的兵不触发
  const s3 = mk([{ unitTypeId: 'p4_skeleton', count: 20 }], [{ unitTypeId: 'p4_zombie', count: 12 }], 31);
  const sk = one(s3, 'p4_skeleton');
  const z3 = one(s3, 'p4_zombie');
  z3.hex = freeNeighbor(s3, sk);
  ok(!actMelee(s3, sk, z3).some((e) => e.t === 'drain'), 'C3 骷髅（无吸血）不触发（负向对照）');
}

/* ============================================================ [D] 自复活 */

section('[D] 天使自复活（§16.3 第 3 条）');

{
  // 6 只：ceil(6×0.2)=2，floor=1 ⇒ 这一条能真正分开 ceil 与 floor
  const s = mk([{ unitTypeId: 'p1_angel', count: 6 }], [{ unitTypeId: 'p2_lavagiant', count: 120 }], 41);
  const angel = one(s, 'p1_angel');
  const giant = one(s, 'p2_lavagiant');
  giant.hex = freeNeighbor(s, angel);
  const ev = actMelee(s, giant, angel);
  ok(!!ev.find((e) => e.t === 'revive') && angel.count === 2, 'D1 6 只的天使被歼灭 ⇒ 复活 2 只（ceil(6×0.2)，floor 会得 1）', `count=${angel.count}`);

  angel.count = 2;
  angel.hpTop = getUnit('p1_angel').hp;
  giant.retaliated = true;
  const ev2 = actMelee(s, giant, angel);
  ok(!ev2.some((e) => e.t === 'revive') && angel.count === 0, 'D2 第二次被歼灭 ⇒ 不再复活（每场一次）');

  // 负向对照
  const s2 = mk([{ unitTypeId: 'p1_knight', count: 1 }], [{ unitTypeId: 'p2_lavagiant', count: 40 }], 41);
  const k = one(s2, 'p1_knight');
  const g2 = one(s2, 'p2_lavagiant');
  g2.hex = freeNeighbor(s2, k);
  ok(!actMelee(s2, g2, k).some((e) => e.t === 'revive') && k.count === 0, 'D3 骑士被歼灭 ⇒ 不复活（负向对照）');
}

/* ============================================================ [E] 威压 */

section('[E] 威压（§16.3 第 4 条：复用缠根实现）');

{
  const s = mk([{ unitTypeId: 'p4_wraith', count: 6 }], [{ unitTypeId: 'p4_zombie', count: 20 }], 51);
  const w = one(s, 'p4_wraith');
  const z = one(s, 'p4_zombie');
  z.hex = freeNeighbor(s, w);
  const speed0 = unitSpeed(s, z);
  const ev = actMelee(s, w, z);
  ok(ev.some((e) => e.t === 'dread') && hasEffect(z, DREAD_EFFECT), 'E1 摄魂怪命中 ⇒ 挂上威压');
  ok(unitSpeed(s, z) === Math.max(1, speed0 - 2), 'E2 速度 −2（下限 1）', `${speed0} → ${unitSpeed(s, z)}`);

  z.effects.push({ spellId: 'slow', rounds: 2 });
  ok(unitSpeed(s, z) === Math.max(1, speed0 - 2), 'E3 与减速不叠加（四条 −2 只取一次）', `speed=${unitSpeed(s, z)}`);
}

/* ============================================================ [F] 六条自带魔法 */

section('[F1] 誓约（p1 T4 骑士）');

{
  function hitWithKnight(withKnight) {
    const defArmy = [{ unitTypeId: 'p1_child', count: 20 }];
    if (withKnight) defArmy.push({ unitTypeId: 'p1_knight', count: 1 });
    const s = mk([{ unitTypeId: 'p2_lavagiant', count: 8 }], defArmy, 61);
    const giant = one(s, 'p2_lavagiant');
    const child = one(s, 'p1_child');
    child.hex = freeNeighbor(s, giant) ?? child.hex;
    const knight = one(s, 'p1_knight');
    if (knight) {
      const h = freeNeighbor(s, child);
      if (h) knight.hex = h;
    }
    const ev = actMelee(s, giant, child);
    return { dmg: ev.find((e) => e.t === 'melee')?.damage ?? 0, oath: ev.find((e) => e.t === 'innate') };
  }
  const a = hitWithKnight(true);
  const b = hitWithKnight(false);
  ok(!!a.oath && a.oath.innate === 'oath', 'F1a 骑士在场 ⇒ 触发「誓约」');
  ok(a.dmg === b.dmg - OATH_REDUCE, 'F1b 该次伤害比无骑士时少 1', `${b.dmg} → ${a.dmg}`);

  // 每回合每格一次：同一回合第二次打同一目标不再减
  const s2 = mk(
    [{ unitTypeId: 'p2_lavagiant', count: 8 }],
    [{ unitTypeId: 'p1_child', count: 20 }, { unitTypeId: 'p1_knight', count: 1 }],
    62,
  );
  const g2 = one(s2, 'p2_lavagiant');
  const c2 = one(s2, 'p1_child');
  c2.hex = freeNeighbor(s2, g2);
  const k2 = one(s2, 'p1_knight');
  const kh = freeNeighbor(s2, c2);
  if (kh) k2.hex = kh;
  const e1 = actMelee(s2, g2, c2);
  c2.retaliated = true;
  const e2 = actMelee(s2, g2, c2);
  ok(countEvents(e1, 'innate', 'oath') === 1 && countEvents(e2, 'innate', 'oath') === 0, 'F1c 每回合每格只挡一次');
}

section('[F2] 熔岩护甲（p2 T4 熔岩巨人）');

{
  const s = mk([{ unitTypeId: 'p1_child', count: 30 }], [{ unitTypeId: 'p2_lavagiant', count: 1 }], 71);
  const kid = one(s, 'p1_child');
  const giant = one(s, 'p2_lavagiant');
  kid.hex = freeNeighbor(s, giant);
  const ev = actMelee(s, kid, giant);
  const dealt = ev.find((e) => e.t === 'melee')?.damage ?? 0;
  const reflect = ev.find((e) => e.t === 'innate' && e.innate === 'lavaArmor');
  ok(!!reflect && reflect.amount === Math.round(dealt * LAVA_REFLECT_RATE), 'F2a 反弹 25% 伤害', `dealt=${dealt} reflect=${reflect?.amount}`);

  // 不致死：攻方只剩 1 点血时反弹必须是 0
  const s2 = mk([{ unitTypeId: 'p1_child', count: 1 }], [{ unitTypeId: 'p2_lavagiant', count: 1 }], 72);
  const kid2 = one(s2, 'p1_child');
  const g2 = one(s2, 'p2_lavagiant');
  kid2.hex = freeNeighbor(s2, g2);
  kid2.count = 1;
  kid2.hpTop = 1;
  g2.retaliated = true; // 只看反弹这一路（反击另算）
  const ev2 = actMelee(s2, kid2, g2);
  ok(!ev2.some((e) => e.t === 'innate' && e.innate === 'lavaArmor') && kid2.count === 1, 'F2b 反弹不致死（1 点血时反弹 0）');

  // 负向对照：铜人没有这条
  const s3 = mk([{ unitTypeId: 'p1_child', count: 30 }], [{ unitTypeId: 'p2_bronze', count: 1 }], 71);
  const kid3 = one(s3, 'p1_child');
  const bronze = one(s3, 'p2_bronze');
  kid3.hex = freeNeighbor(s3, bronze);
  ok(!actMelee(s3, kid3, bronze).some((e) => e.t === 'innate'), 'F2c 铜人不反弹（负向对照）');
}

section('[F3] 烈焰缠身（p2 T5 恶魔）');

{
  const s = mk([{ unitTypeId: 'p1_child', count: 30 }], [{ unitTypeId: 'p2_devil', count: 1 }], 81);
  const kid = one(s, 'p1_child');
  const devil = one(s, 'p2_devil');
  kid.hex = freeNeighbor(s, devil);
  const before = kid.count;
  const ev = actMelee(s, kid, devil);
  const flame = ev.find((e) => e.t === 'innate' && e.innate === 'flameBody');
  ok(!!flame && flame.damage === FLAME_BODY_DAMAGE, 'F3a 被近战命中 ⇒ 攻方吃 6 点', `damage=${flame?.damage}`);
  ok(kid.count < before, 'F3b 这 6 点真的落账（不是只发事件）', `${before} → ${kid.count}`);

  // 上限 2 次
  let uses = 0;
  const s2 = mk([{ unitTypeId: 'p1_child', count: 60 }], [{ unitTypeId: 'p2_devil', count: 10 }], 82);
  const k2 = one(s2, 'p1_child');
  const d2 = one(s2, 'p2_devil');
  k2.hex = freeNeighbor(s2, d2);
  for (let i = 0; i < 5; i++) {
    k2.count = 60;
    k2.hpTop = getUnit('p1_child').hp;
    k2.retaliated = true;
    uses += countEvents(actMelee(s2, k2, d2), 'innate', 'flameBody');
  }
  ok(uses === 2, 'F3c 每场 2 次（第 3 次起不再触发）', `实际 ${uses}`);
}

section('[F4] 投石压制（p3 T4 猿人）');

{
  const s = mk([{ unitTypeId: 'p3_ape', count: 4 }], [{ unitTypeId: 'p4_zombie', count: 20 }], 91);
  const ape = one(s, 'p3_ape');
  const z = one(s, 'p4_zombie');
  const speed0 = unitSpeed(s, z);
  const ev = actShoot(s, ape, z);
  ok(ev.some((e) => e.t === 'innate' && e.innate === 'stoneSuppress') && hasEffect(z, SUPPRESS_EFFECT), 'F4a 远程命中 ⇒ 挂上「投石压制」');
  ok(unitSpeed(s, z) === Math.max(1, speed0 - 2), 'F4b 目标速度 −2', `${speed0} → ${unitSpeed(s, z)}`);

  let uses = 1; // F4a 那一发已经用掉 1 次
  for (let i = 0; i < 5; i++) {
    z.effects = [];
    ape.shots = 10;
    uses += countEvents(actShoot(s, ape, z), 'innate', 'stoneSuppress');
  }
  ok(uses === 3, 'F4c 每场 3 次', `实际 ${uses}`);

  // 负向对照：弩手没有这条
  const s2 = mk([{ unitTypeId: 'p1_crossbow', count: 4 }], [{ unitTypeId: 'p4_zombie', count: 20 }], 91);
  ok(!actShoot(s2, one(s2, 'p1_crossbow'), one(s2, 'p4_zombie')).some((e) => e.t === 'innate'), 'F4d 弩手不压制（负向对照）');
}

section('[F5] 龙威（p3 T5 绿龙）');

{
  // 邻接：建局后把小孩贴上去，再推一回合（`endActivation` → nextRound → startRound → refreshFear）
  const s = mk([{ unitTypeId: 'p3_greendragon', count: 1 }], [{ unitTypeId: 'p1_child', count: 10 }], 101);
  const dragon = one(s, 'p3_greendragon');
  const kid = one(s, 'p1_child');
  const h = freeNeighbor(s, dragon);
  if (h) kid.hex = h;
  s.idx = s.order.length;
  endActivation(s);
  ok(kid.feared === true, 'F5a 邻格敌军在回合开始被压住（feared=true）');
  ok(strikeAtkBonus(s, kid, true) === -FEAR_ATK, 'F5b 被压住 ⇒ 攻击 −1', `bonus=${strikeAtkBonus(s, kid, true)}`);
  const dmgFeared = estimateDamage(s, kid, dragon, false);
  kid.feared = false;
  const dmgFree = estimateDamage(s, kid, dragon, false);
  ok(dmgFeared < dmgFree, 'F5c 预估同源（被压住时预估更低）', `${dmgFree} → ${dmgFeared}`);

  // 负向对照：离得远就不压
  const s2 = mk([{ unitTypeId: 'p3_greendragon', count: 1 }], [{ unitTypeId: 'p1_child', count: 10 }], 101);
  const kid2 = one(s2, 'p1_child');
  kid2.hex = { col: FIELD_W - 1, row: FIELD_H - 1 };
  s2.idx = s2.order.length;
  endActivation(s2);
  ok(kid2.feared === false && strikeAtkBonus(s2, kid2, true) === 0, 'F5d 不在邻格 ⇒ 不受影响（负向对照）');
}

section('[F6] 震慑（p4 T4 牛头怪）');

{
  // 同一个小兵当"尺子"：防御 −2 会让它的预估伤害变高，且随机流不受影响
  const s = mk([{ unitTypeId: 'p4_minotaur', count: 4 }, { unitTypeId: 'p1_child', count: 20 }], [{ unitTypeId: 'p2_bronze', count: 20 }], 111);
  const mino = one(s, 'p4_minotaur');
  const kid = one(s, 'p1_child');
  const bronze = one(s, 'p2_bronze');
  bronze.hex = freeNeighbor(s, mino);
  const d0 = estimateDamage(s, kid, bronze, false);
  const ev = actMelee(s, mino, bronze);
  ok(ev.some((e) => e.t === 'innate' && e.innate === 'stun') && bronze.stunDef === -STUN_DEF, 'F6a 命中 ⇒ 目标防御 −2', `stunDef=${bronze.stunDef}`);
  const d1 = estimateDamage(s, kid, bronze, false);
  ok(d1 > d0, 'F6b 防御 −2 进了统一式子（预估伤害变高）', `${d0} → ${d1}`);

  // 上限 2 次
  let uses = 1;
  for (let i = 0; i < 3; i++) {
    bronze.count = 20;
    bronze.hpTop = getUnit('p2_bronze').hp;
    bronze.retaliated = true;
    uses += countEvents(actMelee(s, mino, bronze), 'innate', 'stun');
  }
  ok(uses === 2 && bronze.stunDef === -2 * STUN_DEF, 'F6c 每场 2 次（最多 −4）', `uses=${uses} stunDef=${bronze.stunDef}`);

  // 负向对照：别族 T4 不震慑
  const s2 = mk([{ unitTypeId: 'p1_knight', count: 4 }], [{ unitTypeId: 'p2_bronze', count: 20 }], 111);
  const kn = one(s2, 'p1_knight');
  const b2 = one(s2, 'p2_bronze');
  b2.hex = freeNeighbor(s2, kn);
  ok(!actMelee(s2, kn, b2).some((e) => e.t === 'innate' && e.innate === 'stun'), 'F6d 骑士不震慑（负向对照）');
}

/* ============================================================ [G] 玩家看得见吗 */

{
  // 这十条规则**不占按钮、不耗蓝、没有施法动作** —— 界面上一行字都没有的话，
  // 玩家永远不知道骑士有誓约、牛头有震慑。浮框文案是它们唯一的存在，所以必须测。
  // 断言的是 `unitAbilityHints`（浮框真的调的就是它，见 `BattleScreen.unitTipText`）。
  const { unitAbilityHints, innateHint } = await import(distUrl('core/data/innates.js', DIST));

  const has = (id, needle) => {
    const lines = unitAbilityHints(getUnit(id));
    return lines.some((l) => l.includes(needle));
  };

  // 招牌能力四条：各挑一个代表兵
  ok(has('p1_eagle', '飞行'), 'G1 飞行印在浮框上');
  ok(has('p4_vampire', '吸血') && has('p4_vampire', '50%'), 'G2 吸血印了比例（50%）');
  ok(has('p1_angel', '不屈') && has('p1_angel', '20%'), 'G3 自复活印了「每场 1 次」与 20%');
  ok(has('p4_wraith', '威压'), 'G4 威压印在浮框上');

  // 六条自带魔法：逐条按名字断言
  const want = { p1_knight: '誓约', p2_lavagiant: '熔岩护甲', p2_devil: '烈焰缠身', p3_ape: '投石压制', p3_greendragon: '龙威', p4_minotaur: '震慑' };
  const missing = Object.entries(want).filter(([id, name]) => !has(id, name));
  ok(missing.length === 0, 'G5 六条自带魔法都在浮框里', missing.length ? missing.map(([i]) => i).join(',') : '6/6');

  // 负向对照：一条都没有的兵不该凭空多出一行
  const plain = unitAbilityHints(getUnit('p1_child'));
  ok(plain.length === 0, 'G6 近卫兵没有能力行（负向对照）', `lines=${plain.length}`);
  ok(innateHint(undefined) === null, 'G7 没有 innate 时 innateHint 返回 null（不是空串）');

  // 顺序：招牌能力在前，自带魔法在后（§16.3 → §10.3）
  const ang = unitAbilityHints(getUnit('p1_angel'));
  ok(ang.length === 2 && ang[0].includes('飞行') && ang[1].includes('不屈'), 'G8 天使两行且顺序是 飞行 → 不屈', ang.join(' / '));
  // 升级形态继承（否则伯爵/幽冥摄魂的浮框会缺行）
  ok(unitAbilityHints(getUnit('p4_vampire_u')).length === unitAbilityHints(getUnit('p4_vampire')).length, 'G9 升级形态继承同一套浮框文案');
}

/* ============================================================ 汇总 */

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} · 失败 ${fail} 条`);
process.exit(fail === 0 ? 0 : 1);
