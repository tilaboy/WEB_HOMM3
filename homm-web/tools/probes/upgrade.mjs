#!/usr/bin/env node
/**
 * upgrade.mjs —— 兵种升级链（S4 · spec §2.5 / §2.4）的机检（`npm run probe:upgrade`）。
 *
 * ## 它守什么
 * 「兵营升到 L2 → 该兵营只产升级版」这条链有**四处只有实现期才看得见的接口**，
 * 每一处都能静默错，而且错法都不是抛异常：
 *
 *   ① **钱**：升级价必须是 0 金 + 木/矿 ×0.5（决策 60）。写成全价/逐级折半都不会报错，
 *      只会在五周预算里多吃一笔金币 —— G-E 系列量不出来（升级不进分母）。
 *   ② **池子**：L2 那一刻池里已有的基础版必须**免费**转成升级版（决策 59「未售出库存」）。
 *      漏了不崩：玩家只是发现自己攒的 3 只鹰不见了（池子没删）或永远招不到（键不同）。
 *   ③ **产出**：L2 之后 `dwellUnitId` 必须返回 `_u`；漏了不崩，只是"升级了但兵没变"。
 *   ④ **L3 产量**：+25%（§2.5 表最后一行）。漏了不崩，只是 L3 白花钱。
 *
 * ## 为什么是纯函数探针（不起浏览器）
 * 这条链全在 `core/game/town.ts`，没有一帧渲染参与。起 Chrome 只会把
 * 「逻辑错」和「页面没加载完」混成同一个红，判据反而变钝。
 *
 * ## 负向对照
 * · 差 1 个矿 ⇒ 升级必须**整体失败且零写入**（等级、资源、池子逐位相同）；
 * · 同日第二次升级 ⇒ 拒绝（每日一次，建造与升级共用）；
 * · 非兵营（市场）⇒ `maxLevel` 缺省 1，**不许**出现"花 0 资源升一级"的幽灵入口。
 *
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足
 */
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=upgrade');
requireFile(DIST, 'core/game/town.js');
requireFile(DIST, 'core/data/units.js');
requireFile(DIST, 'core/data/buildings.js');

const TOWN = await import(distUrl('core/game/town.js', DIST));
const UNITS = await import(distUrl('core/data/units.js', DIST));
const BUILDINGS = await import(distUrl('core/data/buildings.js', DIST));

const { build, buildStatus, canBuild, levelOf, nextUpgradeCost, recruitRows, applyWeeklyGrowth } = TOWN;
const { getUnit, upgradedUnitIdOf } = UNITS;

let bad = 0;
const pass = (ok, label, extra = '') => {
  if (!ok) bad += 1;
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` —— ${extra}` : ''}`);
};
const eq = (got, want, label) => pass(got === want, label, `got ${got} / want ${want}`);

function makeTown(extra = {}) {
  return {
    id: 't1', name: '测试城', pos: { x: 0, y: 0 }, owner: 'p1',
    buildings: ['tavern'], garrison: [], growthPool: {}, ...extra,
  };
}
function makeState(town) {
  return {
    day: 1, log: [],
    config: { difficulty: 'normal' },
    players: {
      p1: { name: 'P1', faction: 'p1', isHuman: true, resources: { gold: 20000, wood: 200, ore: 200 }, revealed: [] },
    },
    towns: { t1: town },
    heroes: {},
  };
}
const res = (st) => st.players.p1.resources;
const fp = (st, town) => JSON.stringify({ lv: town.levels ?? {}, pool: town.growthPool, r: res(st) });

/* ---------------- A. L1 建造 + L2 升级价 ---------------- */
console.log('\n=== A. 建造 → L2：价必须是 0 金 + 木/矿半价 ===');
{
  const town = makeTown();
  const st = makeState(town);
  eq(levelOf(town, 'dwell3'), 0, '没建时 levelOf = 0');
  eq(canBuild(st, town, 'dwell3'), false, '前置不满足时不能建（缺 dwell2）');

  town.buildings.push('dwell1', 'dwell2');
  eq(canBuild(st, town, 'dwell3'), true, '前置齐了可以建');
  eq(build(st, town, 'dwell3'), true, '建 dwell3 成功');
  eq(levelOf(town, 'dwell3'), 1, '建成后 level = 1');
  eq(res(st).gold, 20000 - 2500, 'L1 收 2500 金');
  eq(res(st).ore, 200 - 10, 'L1 收 10 矿');

  const up = nextUpgradeCost(town, 'dwell3');
  eq(up?.gold ?? 0, 0, 'L2 金币必须是 0（决策 60）');
  eq(up?.ore, 5, 'L2 矿 = 10 × 0.5 = 5');

  // 池里的基础版：三只鹰
  town.growthPool['p1_eagle'] = 3;
  town.builtDay = 0; // 换一天
  st.day = 2;
  const goldBefore = res(st).gold;
  eq(build(st, town, 'dwell3'), true, 'L2 升级成功');
  eq(levelOf(town, 'dwell3'), 2, 'level = 2');
  eq(res(st).gold, goldBefore, 'L2 一分金币都不收');
  eq(town.growthPool['p1_eagle'], undefined, '池里的基础版键已删除（绝版）');
  eq(town.growthPool['p1_eagle_u'], 3, '三只鹰原数免费转成金雕');

  const rows = recruitRows(st, town);
  const t3 = rows.find((r) => r.unitTypeId.includes('eagle'));
  eq(t3?.unitTypeId, 'p1_eagle_u', 'L2 之后只产升级版');
  eq(t3?.cost.gold, 288, '招募价 240 × 1.2 = 288');
  eq(t3?.available, 3, '可招数量 = 转换过来的 3');

  // L3：同样的价（不是逐级折半），且产量 +25%
  town.builtDay = 0;
  st.day = 3;
  eq(nextUpgradeCost(town, 'dwell3')?.ore, 5, 'L3 矿仍是 5（不是 2.5→3）');
  eq(build(st, town, 'dwell3'), true, 'L3 升级成功');
  eq(levelOf(town, 'dwell3'), 3, 'level = 3');
  eq(nextUpgradeCost(town, 'dwell3'), null, '满级后没有下一笔钱');
  eq(buildStatus(st, town, 'dwell3').canUpgrade, false, '满级后不再显示升级');
}

/* ---------------- B. 每日一次 + 负向对照（零写入） ---------------- */
console.log('\n=== B. 差 1 个矿 ⇒ 整体失败且零写入；同日不许连升 ===');
{
  const town = makeTown({ buildings: ['tavern', 'dwell1', 'dwell2', 'dwell3'], levels: { dwell3: 1 } });
  const st = makeState(town);
  st.players.p1.resources = { gold: 9999, wood: 200, ore: 4 }; // 正好差 1
  const before = fp(st, town);
  eq(build(st, town, 'dwell3'), false, '只有 4 矿时升级失败');
  eq(fp(st, town), before, '失败时等级/资源/池子逐字节不变（零写入）');

  st.players.p1.resources.ore = 5;
  eq(build(st, town, 'dwell3'), true, '补到 5 矿后升级成功');
  const afterFirst = fp(st, town);
  eq(build(st, town, 'dwell3'), false, '同一天再升一次被拒（每日一次）');
  eq(fp(st, town), afterFirst, '被拒时同样零写入');
}

/* ---------------- C. 非兵营没有幽灵升级 ---------------- */
console.log('\n=== C. 市场 maxLevel 缺省 1 ⇒ 建成即满级，不许有幽灵升级 ===');
{
  const town = makeTown({ buildings: ['tavern', 'market'] });
  const st = makeState(town);
  eq(BUILDINGS.BUILDINGS.market.maxLevel ?? 1, 1, '市场 maxLevel = 1');
  eq(nextUpgradeCost(town, 'market'), null, '市场没有下一笔钱');
  eq(buildStatus(st, town, 'market').canUpgrade, false, '市场不显示升级');
  eq(canBuild(st, town, 'market'), false, '市场不能被"再建一次"当升级');
  eq(levelOf(town, 'market'), 1, '市场 level = 1');
}

/* ---------------- D. L2 产量不变 / L3 +25% ---------------- */
console.log('\n=== D. 周产：L1 = L2，L3 ×1.25 ===');
{
  const growAt = (lv) => {
    const town = makeTown({ buildings: ['tavern', 'dwell1', 'dwell2', 'dwell3'], levels: { dwell3: lv } });
    const st = makeState(town);
    applyWeeklyGrowth(st);
    return town.growthPool[lv >= 2 ? 'p1_eagle_u' : 'p1_eagle'] ?? 0;
  };
  const l1 = growAt(1);
  const l2 = growAt(2);
  const l3 = growAt(3);
  eq(l1, 4, 'L1 每周 4 只鹰（growthPerWeek）');
  eq(l2, 4, 'L2 产量不变（升级只换形态）');
  eq(l3, 5, 'L3 4 × 1.25 = 5 只');
  pass(l3 === Math.ceil(l1 * 1.25), 'L3 = ceil(L1 × 1.25)');
}

/* ---------------- E. 旧档兼容 ---------------- */
console.log('\n=== E. 旧档（没有 levels 字段）按 L1 读 ===');
{
  const town = makeTown({ buildings: ['tavern', 'dwell1', 'dwell2', 'dwell3'] });
  const st = makeState(town);
  eq(town.levels, undefined, 'fixture 确实没有 levels 字段');
  eq(levelOf(town, 'dwell3'), 1, '缺字段时读 1（不需要迁移器）');
  eq(recruitRows(st, town).find((r) => r.unitTypeId === 'p1_eagle')?.available, 0, '旧档仍产基础版');
  eq(upgradedUnitIdOf('p1_eagle'), 'p1_eagle_u', 'upgradedUnitIdOf 能查到');
  eq(getUnit('p1_eagle_u').upgradeOf, 'p1_eagle', 'upgradeOf 自指正确');
}

console.log(`\n=== ${bad === 0 ? 'PASS' : `FAIL（${bad} 条）`} ===`);
if (bad > 0) process.exitCode = 1;
