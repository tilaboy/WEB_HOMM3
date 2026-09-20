import { Camera } from '../dist/render/camera.js';
import { lightTintAt } from '../dist/render/lightLayer.js';
import { BASE_MOVE_POINTS, createGame, monsterArmy } from '../dist/core/map/generator.js';
import { maxMovePoints } from '../dist/core/game/hero.js';
import { mulberry32 } from '../dist/core/rng.js';
import { computePaths, buildPath } from '../dist/core/map/pathfinding.js';
import { isRevealed } from '../dist/core/map/fog.js';
import { lossRatio, quickBattle } from '../dist/core/combat/battle.js';
import { previewInteraction, applyInteraction, battleSetup, enemyHeroAt, heroBattleSetup, applyHeroBattle, pendingObjectAt } from '../dist/core/game/interaction.js';
import { isPassable, castleCells, footprintOf } from '../dist/core/map/grid.js';
import { endDay } from '../dist/core/game/turn.js';
import { factionIds } from '../dist/core/data/factions.js';
import {
  NO_TOWN_GRACE_DAYS,
  advanceNoTownStreaks,
  eliminateFaction,
  evaluateOutcome,
  isEliminated,
  noTownDaysOf,
  outcomeSummary,
} from '../dist/core/game/victory.js';
import { BASE_TOWN_INCOME } from '../dist/core/data/buildings.js';
import { HOME_MINE_RING, MINE_NAME, MINE_PER_DAY, RARE_RESOURCES } from '../dist/core/data/mines.js';
import { MARKET_RATES, costText } from '../dist/core/game/town.js';
import { FACTION_UNITS, LEGACY_UNIT_IDS, UNITS, getUnit, meleeStyleOf, normalizeLegacyUnitIds, unitIdForTier } from '../dist/core/data/units.js';
import { bfs, distance, hexCenter, hexLine, hexList, inField, neighbors, pickHex, FIELD_H, FIELD_W } from '../dist/core/combat/hex.js';
import {
  actDefend,
  actFlee,
  actShoot,
  actWait,
  aiAct,
  autoResolve,
  canShoot,
  castSpell,
  createBattle,
  currentUnit,
  effAtkBonus,
  endActivation,
  hasEffect,
  poolOf,
  reachable,
  shootTargets,
  toOutcome,
  unitSpeed,
} from '../dist/core/combat/battle.js';
import { SPELLS, SPELL_ORDER, spellsOfGuild } from '../dist/core/data/spells.js';
import { canAdventureCast, castAdventure } from '../dist/core/game/spells.js';
import {
  build,
  buildStatus,
  canBuild,
  canBuildToday,
  canHireHero,
  countIn,
  garrisonToHero,
  guildLevel,
  hireHero,
  heroToGarrison,
  marketBuy,
  marketSell,
  recruitToGarrison,
  recruitToHero,
  townDailyIncome,
} from '../dist/core/game/town.js';
import { settingsForTier, classifyProbe, probeTier, allowedMapSizes, clampMapSize, TIER_ORDER } from '../dist/render/quality.js';
import {
  shouldEdgeScroll,
  normalizePointerType,
  shouldHover,
  isDoubleTap,
  DOUBLE_TAP_MAX_MS,
  DOUBLE_TAP_MAX_DIST,
} from '../dist/render/pointerIntent.js';
import { bakeBytes } from '../dist/render/terrainLayer.js';

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fails++;
};

for (const seed of [1, 42, 777, 20260912, 99999]) {
  const s = createGame({ seed, opponents: 0 });
  const m = s.map;
  const hero = s.heroes.hero1;

  ok(m.width === 32 && m.height === 32, `seed ${seed}: 地图 32×32`);
  ok(!!hero && isPassable(m, hero.pos.x, hero.pos.y), `seed ${seed}: 英雄出生在可通行地块`);
  ok(hero.army.length > 0 && hero.army[0].count === 20, `seed ${seed}: 起始 20 弓手`);
  ok(hero.movePoints === BASE_MOVE_POINTS, `seed ${seed}: 初始移动力 ${BASE_MOVE_POINTS}`);

  const kinds = {};
  for (const o of Object.values(m.objects)) kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
  ok((kinds.wanderingMonster ?? 0) >= 12, `seed ${seed}: 野怪 ${kinds.wanderingMonster} 组`);
  ok((kinds.treasureChest ?? 0) >= 9, `seed ${seed}: 宝箱 ${kinds.treasureChest}`);
  ok((kinds.resourcePile ?? 0) >= 14, `seed ${seed}: 资源堆 ${kinds.resourcePile}`);
  ok((kinds.town ?? 0) === 4, `seed ${seed}: 4 座城镇（1 主城 + 3 中立）`);
  ok((kinds.fountain ?? 0) === 4, `seed ${seed}: 4 处泉水`);

  // 每支野怪都得守着东西
  const monsters = Object.values(m.objects).filter((o) => o.kind === 'wanderingMonster');
  ok(monsters.every((o) => !!o.payload.guard), `seed ${seed}: 所有野怪都带守卫奖励`);
  ok(
    monsters.filter((o) => o.payload.guard.kind === 'mine').length >= 2,
    `seed ${seed}: 至少 2 处野怪守着矿`,
  );

  // 中立城不能躲在地图角落，也不能挨在一起
  const neutrals = Object.values(s.towns).filter((t) => t.owner === 'neutral');
  ok(neutrals.length === 3, `seed ${seed}: 3 座中立城`);
  const hp = s.towns.town_home.pos;
  for (const t of neutrals) {
    const d = Math.abs(t.pos.x - hp.x) + Math.abs(t.pos.y - hp.y);
    const edge = Math.min(t.pos.x, t.pos.y, m.width - 1 - t.pos.x, m.height - 1 - t.pos.y);
    ok(d >= 8 && d <= 40, `seed ${seed}: ${t.name} 距主城 ${d} 格（可达范围内）`);
    ok(edge >= 2, `seed ${seed}: ${t.name} 不在地图边缘`);
  }
  for (let i = 0; i < neutrals.length; i++) {
    for (let j = i + 1; j < neutrals.length; j++) {
      const d = Math.abs(neutrals[i].pos.x - neutrals[j].pos.x) + Math.abs(neutrals[i].pos.y - neutrals[j].pos.y);
      ok(d >= 6, `seed ${seed}: 中立城之间不挤在一起（相距 ${d}）`);
    }
  }

  // 所有可交互物都应在可达范围内
  const f = computePaths(s, hero.pos, Infinity);
  const unreachable = Object.values(m.objects).filter(
    (o) => o.blocking === false && !isFinite(f.cost[o.pos.y * m.width + o.pos.x]),
  );
  ok(unreachable.length === 0, `seed ${seed}: 可交互物全部可达（不可达 ${unreachable.length}）`);

  // 随便挑一个远点，必须能算出路径
  const target = Object.values(m.objects).find((o) => o.kind === 'wanderingMonster');
  const path = buildPath(s, f, hero.pos, target.pos);
  ok(path.length > 0, `seed ${seed}: 到野怪的路径长度 ${path.length}`);
  ok(path[path.length - 1].x === target.pos.x && path[path.length - 1].y === target.pos.y, `seed ${seed}: 路径终点正确`);

  // 迷雾初始只揭开一小片
  let revealed = 0;
  for (const v of s.players.p1.revealed) if (v) revealed++;
  ok(revealed > 20 && revealed < m.width * m.height * 0.5, `seed ${seed}: 初始揭开 ${revealed} 格`);
  ok(isRevealed(s, 'p1', hero.pos.x, hero.pos.y), `seed ${seed}: 英雄脚下已揭开`);

  // 战斗预估
  const pending = previewInteraction(s, 'hero1', target.id);
  ok(pending?.kind === 'battle' && !!pending.estimate, `seed ${seed}: 野怪触发战斗预估`);

  // 金币交互
  const pile = Object.values(m.objects).find((o) => o.kind === 'resourcePile');
  const before = s.players.p1.resources.gold ?? 0;
  const res = applyInteraction(s, 'hero1', pile.id, true);
  ok(res.message.length > 0, `seed ${seed}: 拾取资源堆 → ${res.message}`);
  ok((s.players.p1.resources.gold ?? 0) >= before, `seed ${seed}: 金币未减少`);
  ok(!s.map.objects[pile.id], `seed ${seed}: 资源堆已移除`);
}

function duelArmy(enemy, n = 80) {
  let wins = 0;
  let lossSum = 0;
  for (let i = 0; i < n; i++) {
    const o = quickBattle(
      { army: [{ unitTypeId: 'archer', count: 20 }], attack: 1, defense: 2 },
      { army: enemy, attack: 0, defense: 0 },
      1000 + i * 37,
    );
    if (o.win) wins++;
    lossSum += lossRatio(o);
  }
  return { winRate: wins / n, avgLoss: lossSum / n, rounds: 0 };
}

// 直接抽样生成器真实的野怪规模，避免"测试用的怪"和"地图上的怪"是两回事
function duelTier(tier, n = 120) {
  let wins = 0;
  let lossSum = 0;
  let rounds = 0;
  for (let i = 0; i < n; i++) {
    const army = monsterArmy(mulberry32(4000 + i * 131), tier);
    const o = quickBattle(
      { army: [{ unitTypeId: 'archer', count: 20 }], attack: 1, defense: 2 },
      { army, attack: 0, defense: 0 },
      1000 + i * 37,
    );
    if (o.win) wins++;
    lossSum += lossRatio(o);
    rounds += o.rounds;
  }
  return { winRate: wins / n, avgLoss: lossSum / n, rounds: rounds / n };
}

const hopeless = duelArmy([{ unitTypeId: 'ogre', count: 22 }], 60);
const report = (name, d) =>
  console.log(
    `  ${name}：胜率 ${(d.winRate * 100).toFixed(0)}% · 平均损失 ${(d.avgLoss * 100).toFixed(0)}%` +
      (d.rounds ? ` · 平均 ${d.rounds.toFixed(1)} 回合` : ''),
  );

const weakDuel = duelTier('weak');
const midDuel = duelTier('mid');
const strongDuel = duelTier('strong');
report('弱档（20~28 野狼）', weakDuel);
report('中档（11~15 野猪 / 狼+猪）', midDuel);
report('强档（10~13 食人魔 / 猪+魔）', strongDuel);
report('绝望 · 22 食人魔', hopeless);

ok(weakDuel.winRate >= 0.9, '弱档：20 弓手应稳胜');
ok(weakDuel.avgLoss < 0.3, '弱档：损失应较轻');
ok(midDuel.winRate >= 0.7, '中档：应多数能赢');
ok(strongDuel.winRate > 0.3 && strongDuel.winRate < 0.9, '强档：应是胜负有悬念的硬仗');
ok(strongDuel.avgLoss > 0.4, '强档：即使赢也要付出惨重代价');
ok(hopeless.winRate <= 0.05, '悬殊：必败');

const siegeDuel = duelArmy([{ unitTypeId: 'wolf', count: 20 }, { unitTypeId: 'boar', count: 10 }], 120);
report('中立城 · 20 野狼 + 10 野猪', siegeDuel);
ok(siegeDuel.winRate > 0.4 && siegeDuel.winRate < 0.95, '中立城：起始 20 弓手应是有风险但值得一试的目标');
ok(siegeDuel.avgLoss > 0.4, '中立城：即使攻下也会元气大伤');

/* ================= M2：城镇建设与兵种生产 ================= */
console.log('\n--- M2 城镇 ---');

const g = createGame({ seed: 20260913, opponents: 0 });
const home = g.towns.town_home;
const neutral = g.towns.town_n1;

ok(home.owner === 'p1', '主城归属玩家');
ok(neutral.owner === 'neutral', '第二座城为中立');
ok(!!g.towns.town_n2 && g.towns.town_n2.owner === 'neutral', '第三座城也为中立');
ok(!!g.towns.town_n3 && g.towns.town_n3.owner === 'neutral', '第四座城也为中立');
ok(home.buildings.includes('tavern') && home.buildings.includes('dwell2'), '主城预置酒馆与射箭场');
ok(townDailyIncome(home) === BASE_TOWN_INCOME, `主城基础税收 ${townDailyIncome(home)}`);

// 前置校验
ok(buildStatus(g, home, 'dwell4').unlocked === false, '马厩未解锁（缺兵营）');
ok(buildStatus(g, home, 'dwell1').built === true, '农舍已建成');

// 建造兵营
const goldBefore = g.players.p1.resources.gold;
ok(canBuild(g, home, 'dwell3'), '兵营可建造（2500 金 10 矿）');
ok(build(g, home, 'dwell3'), '建造兵营成功');
ok(g.players.p1.resources.gold === goldBefore - 2500, '建造扣除金币');
ok(home.buildings.includes('dwell3'), '兵营进入建筑列表');
ok(home.growthPool.pikeman === 0, '新兵营初始存量为 0');
ok(buildStatus(g, home, 'dwell4').unlocked === true, '马厩现已解锁');

// 周增长
g.players.p1.resources.gold = 99999;
g.players.p1.resources.wood = 99;
g.players.p1.resources.ore = 99;
const poolBefore = { ...home.growthPool };
for (let d = 0; d < 7; d++) endDay(g);
ok(g.day === 8, `过了 7 天（当前第 ${g.day} 天）`);
ok(home.growthPool.pikeman === (poolBefore.pikeman ?? 0) + 4, `枪兵周增长 +4（现 ${home.growthPool.pikeman}）`);
ok(home.growthPool.archer === (poolBefore.archer ?? 0) + 5, `弓手周增长 +5（现 ${home.growthPool.archer}）`);
ok(
  g.players.p1.resources.gold > 99999 - 99999 + BASE_TOWN_INCOME * 7 - 1,
  '每日税收已发放',
);

// 招募
const hero = g.heroes.hero1;
hero.pos = { ...home.pos };
const archersBefore = countIn(hero.army, 'archer');
const poolArchers = home.growthPool.archer;
const r1 = recruitToHero(g, home, hero, 'archer', 3);
ok(r1.taken === 3, `招募 3 弓手（${r1.reason || '成功'}）`);
ok(countIn(hero.army, 'archer') === archersBefore + 3, '弓手进入英雄部队');
ok(home.growthPool.archer === poolArchers - 3, '增长池相应减少');

// 兵种槽位上限
hero.army = [
  { unitTypeId: 'peasant', count: 1 },
  { unitTypeId: 'archer', count: 1 },
  { unitTypeId: 'pikeman', count: 1 },
  { unitTypeId: 'knight', count: 1 },
  { unitTypeId: 'angel', count: 1 },
];
home.growthPool.wolf = 5;
const r2 = recruitToHero(g, home, hero, 'wolf', 1);
ok(r2.taken === 0 && r2.reason.includes('5'), `第 6 个兵种被拒绝（${r2.reason}）`);
hero.army = [{ unitTypeId: 'archer', count: 20 }];

// 驻军调度
home.growthPool.archer = 10;
recruitToGarrison(g, home, 'archer', 4);
ok(countIn(home.garrison, 'archer') === 14, '驻军弓手 10 + 4');
garrisonToHero(hero, home, 'archer', 4);
ok(countIn(home.garrison, 'archer') === 10, '带走 4 名驻军');
heroToGarrison(hero, home, 'archer', 2);
ok(countIn(home.garrison, 'archer') === 12, '留守 2 名');

// 市场
ok(!build(g, home, 'market') || true, '市场建造不报错');
const woodBefore = g.players.p1.resources.wood;
marketBuy(g, 'wood');
ok(g.players.p1.resources.wood === woodBefore + 5, '市场买入 5 木材');
const gold2 = g.players.p1.resources.gold;
marketSell(g, 'ore');
ok(g.players.p1.resources.gold === gold2 + 500, '市场卖出矿石 → 500 金');

// 酒馆
g.players.p1.resources.gold = 9999;
const heroesBefore = g.heroOrder.length;
const hired = hireHero(g, home);
ok(!!hired && g.heroOrder.length === heroesBefore + 1, `酒馆招募英雄：${hired?.name}`);
ok(canHireHero(g, home).ok === false, '同一周不能再招募');
g.day = 15; // 第 3 周
ok(canHireHero(g, home).ok === true, '新的一周可以再招募');

// 攻城
const g2 = createGame(555);
const nId = 'town_n1';
const townObj = Object.values(g2.map.objects).find((o) => o.kind === 'town' && o.payload.townId === nId);
const h2 = g2.heroes.hero1;
h2.pos = { ...townObj.pos };
const siege = previewInteraction(g2, 'hero1', townObj.id);
ok(siege?.kind === 'siege', `中立城触发攻城预估（${siege?.title}）`);
ok(siege.estimate?.losses?.length > 0, '攻城预估给出逐队损失');

h2.army = [{ unitTypeId: 'angel', count: 20 }];
const take = applyInteraction(g2, 'hero1', townObj.id, true);
ok(take.title === '攻陷城镇', `压倒性兵力攻城成功（${take.title}）`);
ok(g2.towns[nId].owner === 'p1', '中立城已易主');
ok(g2.towns[nId].garrison.length === 0, '攻陷后驻军清空');
ok(g2.towns[nId].buildings.includes('tavern'), '攻陷后补上酒馆，可开始建设');

// 空城接管
const g3 = createGame(556);
g3.towns[nId].garrison = [];
const obj3 = Object.values(g3.map.objects).find((o) => o.kind === 'town' && o.payload.townId === nId);
g3.heroes.hero1.pos = { ...obj3.pos };
const free = applyInteraction(g3, 'hero1', obj3.id, true);
ok(free.title === '兵不血刃' && g3.towns[nId].owner === 'p1', '空城可直接接管');

/* ================= M2.1：远程管理 / 每日限建 / 野怪守财 ================= */
console.log('\n--- M2.1 规则补丁 ---');

// 远程管理：英雄不在城里，建筑状态照样可查询、可建造
const g4 = createGame(31337);
const home4 = g4.towns.town_home;
g4.heroes.hero1.pos = { x: 0, y: 0 };
ok(buildStatus(g4, home4, 'dwell3').unlocked === true, '英雄不在城中也能看到建筑状态');
g4.players.p1.resources.gold = 99999;
g4.players.p1.resources.ore = 99;
ok(build(g4, home4, 'dwell3'), '英雄不在城中也能建造');

// 每日限建：同一天第二座建筑应被拒绝
ok(buildStatus(g4, home4, 'wall1').spentToday === true, '同一天其余建筑被标记为「今日已建造」');
ok(canBuild(g4, home4, 'wall1') === false, '同一天不能再建第二座');
ok(build(g4, home4, 'wall1') === false, '强行建造返回 false');
endDay(g4);
ok(canBuild(g4, home4, 'wall1') === true, '新的一天可以再建');
ok(build(g4, home4, 'wall1') === true, '新的一天建造成功');
ok(canBuild(g4, home4, 'market') === false, '同一天第二座仍被拒绝');
// 不同城镇互不影响
const g4b = createGame(31338);
g4b.players.p1.resources.gold = 99999;
g4b.players.p1.resources.ore = 99;
g4b.players.p1.resources.wood = 99;
ok(build(g4b, g4b.towns.town_home, 'dwell3'), '主城建造兵营');
const nTown = g4b.towns.town_n1;
nTown.owner = 'p1';
nTown.buildings.push('tavern');
ok(canBuildToday(g4b, nTown) === true, '另一座城的建造次数独立计算');

// 野怪守财
const g5 = createGame(24680);
const mon = Object.values(g5.map.objects).find(
  (o) => o.kind === 'wanderingMonster' && o.payload.guard?.kind === 'gold',
);
const h5 = g5.heroes.hero1;
h5.pos = { ...mon.pos };
const goldBefore5 = g5.players.p1.resources.gold ?? 0;
const guardGold = mon.payload.guard.amount;
const prevTile = { x: mon.pos.x, y: mon.pos.y - 1 };
h5.army = [{ unitTypeId: 'angel', count: 30 }];
const win5 = applyInteraction(g5, 'hero1', mon.id, true, { retreatTo: prevTile });
ok(win5.title === '战斗胜利', `打赢守财野怪（${win5.title}）`);
ok((g5.players.p1.resources.gold ?? 0) >= goldBefore5 + guardGold, `缴获 ${guardGold} 金币已入账`);
ok(!g5.map.objects[mon.id], '野怪已消失，可以通行');

// 撤退：被挡回上一格，本日不能再动
const g6 = createGame(13579);
const mon6 = Object.values(g6.map.objects).find((o) => o.kind === 'wanderingMonster');
const h6 = g6.heroes.hero1;
// 落点必须真的能站人（地图是随机生成的，别写死方向）
const from = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1]]
  .map(([dx, dy]) => ({ x: mon6.pos.x + dx, y: mon6.pos.y + dy }))
  .find((p) => p.x >= 0 && p.y >= 0 && p.x < g6.map.width && p.y < g6.map.height && isPassable(g6.map, p.x, p.y));
ok(!!from, '野怪旁边找得到可站立的撤退落点');
h6.pos = { ...mon6.pos };
const armyBefore = h6.army.reduce((s, st) => s + st.count, 0);
const flee = applyInteraction(g6, 'hero1', mon6.id, false, { retreatTo: from });
ok(flee.title === '撤退', '撤退返回结果');
ok(h6.pos.x === from.x && h6.pos.y === from.y, `撤退被挡回上一格 (${h6.pos.x},${h6.pos.y})`);
ok(h6.movePoints === 0, '撤退后本日移动力归零');
ok(h6.army.reduce((s, st) => s + st.count, 0) < armyBefore, '撤退损失了兵力');
ok(!!g6.map.objects[mon6.id], '野怪还活着，没打赢就过不去');

// 没有上一格时（原地触发）不应瞬移
const g7 = createGame(24689);
const mon7 = Object.values(g7.map.objects).find((o) => o.kind === 'wanderingMonster');
g7.heroes.hero1.pos = { ...mon7.pos };
applyInteraction(g7, 'hero1', mon7.id, false, { retreatTo: null });
ok(g7.heroes.hero1.pos.x === mon7.pos.x && g7.heroes.hero1.pos.y === mon7.pos.y, '无退路时原地不动');

// 矿场：打赢后生成，每日产出
const g8 = createGame(86420);
const mineMon = Object.values(g8.map.objects).find(
  (o) => o.kind === 'wanderingMonster' && o.payload.guard?.kind === 'mine',
);
ok(!!mineMon, '地图上存在守矿的野怪');
const h8 = g8.heroes.hero1;
h8.pos = { ...mineMon.pos };
h8.army = [{ unitTypeId: 'angel', count: 30 }];
// M7 起地图上本来就摆着十几座无主矿，所以这里只能断言"多出一座、且归我方"
const minesBefore = Object.values(g8.map.objects).filter((o) => o.kind === 'mine').length;
const win8 = applyInteraction(g8, 'hero1', mineMon.id, true);
ok(win8.message.includes('矿'), `攻下矿场（${win8.message.split('\n')[1] ?? ''}）`);
const mines = Object.values(g8.map.objects).filter((o) => o.kind === 'mine');
ok(mines.length === minesBefore + 1, `地图上多出一座矿（${minesBefore} → ${mines.length}）`);
const mine8 = mines.find((m) => m.payload.owner === 'p1');
ok(!!mine8, '矿场归我方');
const before8 = { ...g8.players.p1.resources };
endDay(g8);
const res8 = mine8.payload.resource;
ok(
  (g8.players.p1.resources[res8] ?? 0) > (before8[res8] ?? 0),
  `矿场每日产出 ${res8} +${mine8.payload.perDay} 已发放`,
);

/* ================= M3：六边形战术战斗 ================= */
console.log('\n--- M3 六边形战场 ---');

// 1. 坐标：六邻居互为距离 1，直线端点正确
{
  const all = hexList();
  ok(all.length === FIELD_W * FIELD_H, `战场 ${FIELD_W}×${FIELD_H} = ${all.length} 格`);
  const center = { col: 7, row: 5 };
  const nb = neighbors(center);
  ok(nb.length === 6, '每格 6 个邻居方向');
  ok(nb.every((h) => distance(center, h) === 1), '邻居距离恒为 1');
  ok(new Set(nb.map((h) => `${h.col},${h.row}`)).size === 6, '6 个邻居互不重复');

  const a = { col: 1, row: 1 };
  const b = { col: 12, row: 8 };
  const line = hexLine(a, b);
  ok(line.length === distance(a, b) + 1, `直线长度 = 距离 + 1（${line.length}）`);
  ok(line[0].col === a.col && line[0].row === a.row, '直线起点正确');
  ok(line[line.length - 1].col === b.col && line[line.length - 1].row === b.row, '直线终点正确');
  ok(line.every((h) => inField(h)), '直线不越界');

  // 像素 ↔ 格子 往返一致（鼠标点格子全靠它）
  let mismatch = 0;
  for (const h of all) {
    const c = hexCenter(h);
    const back = pickHex(c.x, c.y);
    if (back.col !== h.col || back.row !== h.row) mismatch++;
  }
  ok(mismatch === 0, `全部 ${all.length} 格的中心点都能被 pickHex 正确反解（错 ${mismatch}）`);

  // BFS：可达格都在步数内，且不重复占位
  const reach = bfs(center, 3, () => false);
  let outOfRange = 0;
  for (const k of reach.keys()) {
    const [c, r] = k.split(',').map(Number);
    if (distance(center, { col: c, row: r }) > 3) outOfRange++;
  }
  ok(outOfRange === 0, `BFS 结果都在 3 步内（越界 ${outOfRange}）`);
  ok(reach.size > 10, `3 步内可达 ${reach.size} 格`);
}

// 2. 布阵：两侧贴边、不重叠、都在场内
{
  const b = createBattle(
    { army: [{ unitTypeId: 'archer', count: 20 }, { unitTypeId: 'pikeman', count: 8 }], attack: 1, defense: 2 },
    { army: [{ unitTypeId: 'wolf', count: 14 }, { unitTypeId: 'boar', count: 5 }], attack: 0, defense: 0 },
    1234,
  );
  ok(b.units.length === 4, `4 支部队入场（${b.units.length}）`);
  ok(b.units.filter((u) => u.side === 0).every((u) => u.hex.col === 0), '我方贴左边缘');
  ok(b.units.filter((u) => u.side === 1).every((u) => u.hex.col === FIELD_W - 1), '敌方贴右边缘');
  ok(b.units.every((u) => inField(u.hex)), '全部部队在场地内');
  const keys = new Set(b.units.map((u) => `${u.hex.col},${u.hex.row}`));
  ok(keys.size === b.units.length, '没有两支队伍挤在同一格');
  ok(b.round === 1 && !!currentUnit(b), '开局进入第 1 回合且有部队可行动');

  // 远程：开局敌人很远，能射；弹药会消耗
  const archer = b.units.find((u) => u.unitTypeId === 'archer');
  ok(canShoot(b, archer), '弓手开局可射击');
  const shotsBefore = archer.shots;
  const wolf = b.units.find((u) => u.unitTypeId === 'wolf');
  actShoot(b, archer, wolf);
  ok(archer.shots === shotsBefore - 1, `射击消耗 1 发弹药（${shotsBefore} → ${archer.shots}）`);
  ok(poolOf(wolf) < 14 * getUnit('wolf').hp, '野狼总血量下降');
  ok(wolf.count < 14 || wolf.hpTop < getUnit('wolf').hp, '伤害先啃队首那只');
  ok(shootTargets(b, archer).length === 2, '远程可选目标 = 全部存活敌人');
}

// 3. 自动战斗：能收敛、结果自洽
function runTactical(attacker, defender, seed) {
  const b = createBattle(attacker, defender, seed);
  let guard = 0;
  while (!b.over && guard++ < 6000) {
    const u = currentUnit(b);
    if (!u) {
      endActivation(b);
      continue;
    }
    aiAct(b, u);
    endActivation(b);
  }
  return { state: b, outcome: toOutcome(b) };
}

{
  let bad = 0;
  let wins = 0;
  const N = 40;
  for (let i = 0; i < N; i++) {
    const { state, outcome } = runTactical(
      { army: [{ unitTypeId: 'archer', count: 20 }], attack: 1, defense: 2 },
      { army: [{ unitTypeId: 'wolf', count: 14 }], attack: 0, defense: 0 },
      5000 + i * 91,
    );
    if (!state.over) bad++;
    if (state.round > 40) bad++;
    if (state.units.some((u) => u.count < 0 || u.hpTop > getUnit(u.unitTypeId).hp || u.hpTop < 0)) bad++;
    if (outcome.survivors.length && outcome.enemySurvivors.length) bad++; // 不应双方都有残兵
    if (outcome.win) wins++;
  }
  ok(bad === 0, `${N} 场自动战斗全部正常收敛（异常 ${bad}）`);
  ok(wins / N >= 0.8, `20 弓手 vs 14 野狼：胜率 ${((wins / N) * 100).toFixed(0)}%`);

  // 双方都用同一套 AI 跑，autoResolve 与手动循环应当等价（同种子）
  const a1 = autoResolve(
    createBattle(
      { army: [{ unitTypeId: 'archer', count: 20 }], attack: 1, defense: 2 },
      { army: [{ unitTypeId: 'boar', count: 8 }], attack: 0, defense: 0 },
      777,
    ),
  );
  const a2 = runTactical(
    { army: [{ unitTypeId: 'archer', count: 20 }], attack: 1, defense: 2 },
    { army: [{ unitTypeId: 'boar', count: 8 }], attack: 0, defense: 0 },
    777,
  ).outcome;
  ok(a1.win === a2.win && a1.rounds === a2.rounds, 'autoResolve 与逐步推演结果一致');

  // 撤退
  const fb = createBattle(
    { army: [{ unitTypeId: 'archer', count: 20 }], attack: 1, defense: 2 },
    { army: [{ unitTypeId: 'ogre', count: 6 }], attack: 0, defense: 0 },
    99,
  );
  actFlee(fb);
  const fo = toOutcome(fb);
  ok(fo.fled === true && fo.win === false, '撤退：fled 标记为真、不记为胜利');
  ok(fo.survivors.reduce((n, s) => n + s.count, 0) === 20, '撤退不额外扣兵（扣兵规则交给冒险层）');

  // 死战：食人魔压倒性优势时应打不过
  let lost = 0;
  for (let i = 0; i < 20; i++) {
    const { outcome } = runTactical(
      { army: [{ unitTypeId: 'archer', count: 6 }], attack: 0, defense: 0 },
      { army: [{ unitTypeId: 'ogre', count: 12 }], attack: 0, defense: 0 },
      300 + i,
    );
    if (!outcome.win) lost++;
  }
  ok(lost === 20, `6 弓手 vs 12 食人魔：必败（${lost}/20）`);
}

// 4. 与世界层打通：battleSetup 给出双方参数，战术战果可直接回写
{
  const g9 = createGame(424242);
  const mon9 = Object.values(g9.map.objects).find((o) => o.kind === 'wanderingMonster');

  // 先摆好站位与兵力，再取 battleSetup —— 它引用的是当时的部队，顺序不能反
  g9.heroes.hero1.pos = { ...mon9.pos };
  g9.heroes.hero1.army = [{ unitTypeId: 'angel', count: 30 }];
  const setup = battleSetup(g9, 'hero1', mon9);
  ok(!!setup && setup.attacker.army.length > 0, 'battleSetup 给出攻方部队');
  ok(setup.defender.army.length > 0, 'battleSetup 给出守方部队');
  ok(Number.isFinite(setup.seed), 'battleSetup 给出战斗种子');

  const won = autoResolve(createBattle(setup.attacker, setup.defender, setup.seed));
  const res9 = applyInteraction(g9, 'hero1', mon9.id, true, { outcome: won });
  ok(won.win === true, '30 天使对野怪应取胜');
  ok(res9.title === '战斗胜利', `战术战果回写世界（${res9.title}）`);
  ok(!g9.map.objects[mon9.id], '野怪已清除');

  // 从战场上逃跑 → 走撤退分支（退回上一格 + 本日不能动）
  const g10 = createGame(424243);
  const mon10 = Object.values(g10.map.objects).find((o) => o.kind === 'wanderingMonster');
  // 撤退落点必须真的能站人（地图是随机生成的，别写死方向）
  const back = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1]]
    .map(([dx, dy]) => ({ x: mon10.pos.x + dx, y: mon10.pos.y + dy }))
    .find((p) => p.x >= 0 && p.y >= 0 && p.x < g10.map.width && p.y < g10.map.height && isPassable(g10.map, p.x, p.y));
  ok(!!back, '野怪旁边找得到可站立的撤退落点');
  g10.heroes.hero1.pos = { ...mon10.pos };
  const fledOutcome = { ...autoResolve(createBattle({ army: g10.heroes.hero1.army, attack: 0, defense: 0 }, { army: mon10.payload.army, attack: 0, defense: 0 }, 1)), fled: true, win: false };
  const res10 = applyInteraction(g10, 'hero1', mon10.id, true, { outcome: fledOutcome, retreatTo: back });
  ok(res10.title === '撤退', '战场内撤退 → 世界层按撤退处理');
  ok(g10.heroes.hero1.pos.x === back.x && g10.heroes.hero1.pos.y === back.y, '撤退退回上一格');
  ok(g10.heroes.hero1.movePoints === 0, '撤退后本日移动力归零');
  ok(!!g10.map.objects[mon10.id], '逃跑不算打赢，野怪仍在');
}

/* ---------------- M4：魔法 ---------------- */

// 1. 法术表：12 个战斗魔法 + 5 个冒险魔法
{
  const combat = SPELL_ORDER.filter((id) => SPELLS[id].combat);
  const adv = SPELL_ORDER.filter((id) => !SPELLS[id].combat);
  ok(combat.length === 12, `12 个战斗魔法（${combat.length}）`);
  ok(adv.length === 5, `5 个冒险魔法（${adv.length}）`);
  ok(SPELL_ORDER.every((id) => SPELLS[id].manaCost > 0 && SPELLS[id].level >= 1), '每个法术都有等级与消耗');
  ok(spellsOfGuild(1).length >= 5 && spellsOfGuild(3).length === SPELL_ORDER.length, '行会按等级解锁法术');
}

// 2. 魔法行会建成 → 己方英雄学会法术
{
  const g = createGame(555001);
  const town = g.towns.town_home;
  g.players.p1.resources = { gold: 99999, wood: 999, ore: 999, gem: 99, crystal: 99 };
  const before = g.heroes.hero1.spells.length;
  ok(before === 0, '开局不会任何法术');
  ok(build(g, town, 'guild1'), '建成魔法行会');
  ok(g.heroes.hero1.spells.length > 0, `行会建成后学会法术（${g.heroes.hero1.spells.length} 个）`);
  ok(!build(g, town, 'guild2'), '同一天不能再建第二座（每日限建一座）');
  g.day += 1;
  ok(build(g, town, 'guild2'), '次日可升级高级魔法行会');
  ok(g.heroes.hero1.spells.includes('lightningBolt'), '2 级法术已解锁');
  ok(guildLevel(town) === 2, 'guildLevel 反映建筑等级');
}

// 3. 法力：上限 = 知识×10，过一天回满
{
  const g = createGame(555002);
  const h = g.heroes.hero1;
  h.mana = 0;
  endDay(g);
  ok(h.mana === h.manaMax && h.manaMax === h.primary.knowledge * 10, `过一天法力回满（${h.mana}/${h.manaMax}）`);
}

// 4. 战斗魔法：伤害、每回合一次、增益生效、法力消耗
{
  const mk = (caster) => ({
    army: [{ unitTypeId: 'archer', count: 20 }],
    attack: 0,
    defense: 0,
    ...(caster ? { caster } : {}),
  });
  const foe = { army: [{ unitTypeId: 'ogre', count: 10 }], attack: 0, defense: 0 };
  const caster = { spells: ['magicArrow', 'bless', 'resurrect'], spellPower: 3, mana: 30 };

  const s = createBattle(mk(caster), foe, 77);
  const shooter = s.units.find((u) => u.side === 0);
  const target = s.units.find((u) => u.side === 1);
  const before = poolOf(target);
  const ev = castSpell(s, 0, 'magicArrow', target);
  ok(ev.length > 0, '施放魔法箭产生事件');
  ok(poolOf(target) < before, `魔法箭造成伤害（${before} → ${poolOf(target)}）`);
  ok(s.casters[0].mana === 30 - SPELLS.magicArrow.manaCost, '施法扣除法力');
  ok(castSpell(s, 0, 'magicArrow', target).length === 0, '同一回合不能施放第二次');
  ok(hasEffect(target, 'bless') === false, '未被施法的部队没有增益');

  // 增益类在另一场里测（每回合只能施一次法）
  const sB = createBattle(mk(caster), foe, 177);
  const buffed = sB.units.find((u) => u.side === 0);
  castSpell(sB, 0, 'bless', buffed);
  ok(hasEffect(buffed, 'bless'), '祝福已挂上');
  ok(effAtkBonus(buffed, false) === 3, '祝福 +3 攻击');

  const s2 = createBattle(mk({ ...caster, spells: ['haste'] }), foe, 78);
  const u2 = s2.units.find((u) => u.side === 0);
  const spd = unitSpeed(s2, u2);
  castSpell(s2, 0, 'haste', u2);
  ok(unitSpeed(s2, u2) === spd + 2, '加速 +2 速度');

  // 没有施法者的一侧不能施法
  const s3 = createBattle(mk(null), foe, 79);
  ok(castSpell(s3, 0, 'magicArrow', s3.units[1]).length === 0, '没学会/没英雄就施不了法');

  // 战后法力写回世界层
  const g = createGame(555004);
  const mon = Object.values(g.map.objects).find((o) => o.kind === 'wanderingMonster');
  g.heroes.hero1.spells = ['magicArrow'];
  g.heroes.hero1.mana = 20;
  g.heroes.hero1.pos = { ...mon.pos };
  g.heroes.hero1.army = [{ unitTypeId: 'angel', count: 30 }];
  const setup = battleSetup(g, 'hero1', mon);
  ok(!!setup.attacker.caster && setup.attacker.caster.spells.includes('magicArrow'), 'battleSetup 带上施法者');
  const outcome = autoResolve(createBattle(setup.attacker, setup.defender, setup.seed));
  applyInteraction(g, 'hero1', mon.id, true, { outcome });
  ok(g.heroes.hero1.mana === outcome.casterMana, `战后法力回写（${g.heroes.hero1.mana}）`);
}

// 5. 冒险魔法
{
  const g = createGame(555003);
  const h = g.heroes.hero1;
  h.spells = ['visions', 'viewAir', 'viewEarth', 'townPortal', 'dimensionDoor'];
  h.mana = 999;

  const r1 = castAdventure(g, 'hero1', 'viewAir');
  ok(r1.ok, '观空术可施放');
  ok(g.players.p1.revealed.every((v) => v === 1), '观空术揭开全图');

  const r2 = castAdventure(g, 'hero1', 'viewEarth');
  ok(r2.ok && (r2.report?.length ?? 0) > 0, '观地术给出野怪情报');

  const mon = Object.values(g.map.objects).find((o) => o.kind === 'wanderingMonster');
  h.pos = { x: mon.pos.x, y: mon.pos.y - 1 };
  const r3 = castAdventure(g, 'hero1', 'visions', { pos: { ...mon.pos } });
  ok(r3.ok && (r3.report?.length ?? 0) > 0, '异视术侦察野怪兵力');
  const far = castAdventure(g, 'hero1', 'visions', { pos: { x: mon.pos.x, y: mon.pos.y - 20 } });
  ok(!far.ok, '超过 5 格不能侦察');

  const r4 = castAdventure(g, 'hero1', 'townPortal');
  ok(!r4.ok && r4.needsTarget === 'town', '回城术需要先选城镇');
  const r5 = castAdventure(g, 'hero1', 'townPortal', { townId: 'town_home' });
  ok(r5.ok, '回城术生效');
  ok(h.pos.x === g.towns.town_home.pos.x || Math.abs(h.pos.x - g.towns.town_home.pos.x) <= 3, '回到目标城镇附近');

  // 挑一个确实能站人的落点
  let dest = null;
  for (let d = 1; d <= 8 && !dest; d++) {
    for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d]]) {
      const x = h.pos.x + dx;
      const y = h.pos.y + dy;
      if (x < 0 || y < 0 || x >= g.map.width || y >= g.map.height) continue;
      if (!isPassable(g.map, x, y)) continue;
      dest = { x, y };
      break;
    }
  }
  ok(!!dest, '找到可瞬移的落点');
  const r6 = castAdventure(g, 'hero1', 'dimensionDoor', { pos: dest });
  ok(r6.ok, `次元门生效（${r6.message ?? ''}）`);
  ok(h.pos.x === dest.x && h.pos.y === dest.y, '瞬移到目标格');

  h.mana = 0;
  ok(!canAdventureCast(g, h, 'viewAir').ok, '法力不足时不能施法');
}

/* ---------------- M5：开局设置 + 多阵营 + 电脑对手 ---------------- */

// 1. 设置项真的生效
{
  for (const [size, w] of [['small', 24], ['medium', 32], ['large', 40]]) {
    const g = createGame({ size, seed: 20260914, opponents: 0 });
    ok(g.map.width === w && g.map.height === w, `${size}: 地图 ${w}×${w}`);
  }

  const g1 = createGame({ size: 'medium', seed: 777, opponents: 1 });
  ok(Object.keys(g1.players).length === 2, '1 个对手 → 2 个阵营');
  const g3 = createGame({ size: 'large', seed: 777, opponents: 3 });
  ok(Object.keys(g3.players).length === 4, '3 个对手 → 4 个阵营');
  ok(factionIds(g3).join(',') === 'p1,p2,p3,p4', '阵营编号连续');
  ok(g3.players.p1.isHuman === true && g3.players.p2.isHuman === false, 'p1 是玩家、其余是电脑');
  ok(g3.config.opponents === 3 && g3.config.size === 'large', '开局设置随存档保存');

  // 每个阵营都有自己的城和英雄，主城互不重叠且留足间隔
  const homes = Object.values(g3.towns).filter((t) => t.owner !== 'neutral').map((t) => t.pos);
  ok(homes.length === 4, `4 座主城（${homes.length}）`);
  ok(new Set(homes.map((p) => `${p.x},${p.y}`)).size === 4, '主城位置互不重叠');
  let minGap = Infinity;
  for (let i = 0; i < homes.length; i++) {
    for (let j = i + 1; j < homes.length; j++) {
      minGap = Math.min(minGap, Math.abs(homes[i].x - homes[j].x) + Math.abs(homes[i].y - homes[j].y));
    }
  }
  ok(minGap >= 8, `主城之间至少隔 8 格（实际 ${minGap}）`);

  for (const fid of ['p1', 'p2', 'p3', 'p4']) {
    const town = Object.values(g3.towns).find((t) => t.owner === fid);
    const hero = Object.values(g3.heroes).find((h) => h.owner === fid);
    ok(!!town && !!hero && !!g3.players[fid].revealed, `${fid}: 有城、有将、有独立迷雾`);
  }
  ok(Object.values(g3.heroes).every((h) => h.army.reduce((n, s) => n + s.count, 0) === 20), '各阵营起手兵力一致');

  // 同一种子 → 同一张图
  const a = createGame({ size: 'small', seed: 4242, opponents: 2 });
  const b = createGame({ size: 'small', seed: 4242, opponents: 2 });
  ok(
    a.map.tiles.map((t) => t.terrain).join('') === b.map.tiles.map((t) => t.terrain).join(''),
    '同种子生成同一张地图',
  );
  ok(JSON.stringify(a.towns) === JSON.stringify(b.towns), '同种子的城镇布局一致');

  // 难度现在**同时影响玩家与电脑**（重设计核心）：玩家起始资源随 playerStartMul 缩放
  const easy = createGame({ size: 'medium', seed: 9, opponents: 1, difficulty: 'easy' });
  const hard = createGame({ size: 'medium', seed: 9, opponents: 1, difficulty: 'hard' });
  ok(easy.players.p1.resources.gold === 3000, '轻松档玩家起始金 3000（2500×1.2）');
  ok(hard.players.p1.resources.gold === 1750, '困难档玩家起始金 1750（2500×0.7）');
  ok(easy.players.p1.resources.gold > hard.players.p1.resources.gold, '轻松档玩家起始资源更多');
  ok(hard.players.p2.resources.gold > easy.players.p2.resources.gold, '困难档电脑起始资源更多');
  // 野怪随 monsterMul 缩放：困难档野狼应比轻松档更多
  const wolfOf = (g) => {
    const ms = Object.values(g.map.objects).filter((o) => o.kind === 'wanderingMonster');
    return ms.reduce((s, o) => s + (o.payload.army.find((x) => x.unitTypeId === 'wolf')?.count ?? 0), 0);
  };
  ok(wolfOf(hard) > wolfOf(easy), '困难档野怪规模更大（monsterMul 1.25 > 0.75）');
  // 困难档玩家英雄（含招新）的移动力被 playerMoveMul 罚减（1800×0.9 = 1620）
  ok(maxMovePoints(hard.heroes.hero1, hard) === 1620, '困难档玩家移动力上限 1620（1800×0.9）');
  ok(maxMovePoints(easy.heroes.hero1, easy) === 2070, '轻松档玩家移动力上限 2070（1800×1.15）');
  ok(maxMovePoints(hard.heroes.hero_p2, hard) === BASE_MOVE_POINTS, '困难档电脑移动力不受 playerMoveMul 影响');
}

// 2. 电脑对手真的会动
{
  const g = createGame({ size: 'medium', seed: 20260915, opponents: 2 });
  const townsBefore = JSON.stringify(g.towns);
  let aiMoved = false;
  for (let i = 0; i < 12; i++) {
    endDay(g);
    if (g.status !== 'playing') break;
    for (const id of g.heroOrder) {
      const h = g.heroes[id];
      if (h && h.owner !== 'p1' && h.movePoints < BASE_MOVE_POINTS) aiMoved = true;
    }
  }
  ok(g.day === 13, `连过 12 天（第 ${g.day} 天）`);
  ok(JSON.stringify(g.towns) !== townsBefore, '电脑对手改变了城镇状态（建设或占领）');
  ok(aiMoved, '电脑英雄消耗了移动力（确实在地图上行动）');
  ok(Object.values(g.heroes).filter((h) => h.owner !== 'p1').length > 0, '电脑阵营仍有英雄在场');
  ok(
    g.players.p2.resources.gold > 0 || Object.values(g.towns).some((t) => t.owner === 'p2'),
    '电脑阵营有经济产出',
  );
}

// 3. 胜负判定
{
  const g = createGame({ size: 'medium', seed: 55, opponents: 1 });
  ok(evaluateOutcome(g) === 'playing', '开局判定为进行中');
  for (const t of Object.values(g.towns)) if (t.owner === 'p2') t.owner = 'neutral';
  for (const id of [...g.heroOrder]) {
    if (g.heroes[id]?.owner === 'p2') {
      delete g.heroes[id];
      g.heroOrder = g.heroOrder.filter((x) => x !== id);
    }
  }
  ok(isEliminated(g, 'p2'), 'p2 已出局');
  ok(evaluateOutcome(g) === 'won', '敌方全灭 → 判定胜利');
  ok(outcomeSummary(g).lines.length >= 2, '结算面板列出各阵营战果');

  const g2 = createGame({ size: 'medium', seed: 56, opponents: 1 });
  for (const t of Object.values(g2.towns)) if (t.owner === 'p1') t.owner = 'neutral';
  delete g2.heroes.hero1;
  g2.heroOrder = g2.heroOrder.filter((x) => x !== 'hero1');
  ok(evaluateOutcome(g2) === 'lost', '玩家出局 → 判定失败');
}

// 4. 英雄遭遇战：打了别人的英雄，败者下场、胜者接管位置
{
  const g = createGame({ size: 'medium', seed: 31337, opponents: 1 });
  const foe = Object.values(g.heroes).find((h) => h.owner === 'p2');
  ok(!!foe, '找得到电脑英雄');

  g.heroes.hero1.army = [{ unitTypeId: 'angel', count: 30 }];
  g.heroes.hero1.pos = { x: foe.pos.x + 1, y: foe.pos.y };
  ok(enemyHeroAt(g, foe.pos.x, foe.pos.y, 'p1')?.id === foe.id, '能识别站在该格的敌方英雄');
  ok(enemyHeroAt(g, foe.pos.x, foe.pos.y, 'p2') === null, '己方英雄不算敌方');

  const spot = { ...foe.pos };
  const setup = heroBattleSetup(g, 'hero1', foe.id);
  ok(!!setup && setup.attacker.army.length > 0 && setup.defender.army.length > 0, '遭遇战给出双方参数');
  ok(heroBattleSetup(g, 'hero1', 'hero1') === null, '不能和自己开战');

  const out = quickBattle(setup.attacker, setup.defender, setup.seed);
  const res = applyHeroBattle(g, 'hero1', foe.id, out);
  ok(out.win === true && res.title === '遭遇战胜利', '30 天使打残兵：必胜');
  ok(!g.heroes[foe.id], '败者英雄离开地图');
  ok(!g.heroOrder.includes(foe.id), 'heroOrder 同步清理败者');
  ok(g.heroes.hero1.pos.x === spot.x && g.heroes.hero1.pos.y === spot.y, '胜者接管败者的位置');
}

/* ---------------- M5.2：2×2 城堡 + 正面城门 ---------------- */

// 6. 城堡占地与"只能从正面进"
{
  const g = createGame({ size: 'medium', seed: 424242, opponents: 3 });
  const townObjs = Object.values(g.map.objects).filter((o) => o.kind === 'town');
  ok(townObjs.length >= 4, `地图上至少有 4 座城（${townObjs.length}）`);
  ok(townObjs.every((o) => footprintOf(o).length === 4), '每座城都占 2×2 四格');
  ok(
    townObjs.every((o) => footprintOf(o).some((c) => c.x === o.pos.x && c.y === o.pos.y)),
    '城门格包含在占地里',
  );

  // 城堡记录和地图物件必须描述同一块地，否则渲染和寻路会各说各话
  let fpMatch = true;
  for (const o of townObjs) {
    const town = g.towns[o.payload.townId];
    const a = footprintOf(o).map((c) => `${c.x},${c.y}`).sort().join('|');
    const b = (town.footprint ?? []).map((c) => `${c.x},${c.y}`).sort().join('|');
    if (a !== b || town.pos.x !== o.pos.x || town.pos.y !== o.pos.y) fpMatch = false;
  }
  ok(fpMatch, '城记录与地图物件的占地一致');

  // 3 格实墙 + 1 格城门
  let blockedOk = true;
  let singleGate = true;
  for (const o of townObjs) {
    const cells = castleCells(o.pos);
    for (const c of cells) {
      const isGate = c.x === o.pos.x && c.y === o.pos.y;
      if (isGate) continue;
      if (isPassable(g.map, c.x, c.y)) blockedOk = false;
    }
    if (cells.filter((c) => isPassable(g.map, c.x, c.y)).length !== 1) singleGate = false;
  }
  ok(blockedOk, '城墙三格一律不可通行');
  ok(singleGate, '2×2 里只有城门一格能站人');
  ok(townObjs.every((o) => isPassable(g.map, o.pos.x, o.pos.y)), '城门本身可通行');

  // 背面（北）与右（东）都是墙：进门只能走正面
  ok(townObjs.every((o) => !isPassable(g.map, o.pos.x, o.pos.y - 1)), '城门正上方是墙，进不来');
  ok(townObjs.every((o) => !isPassable(g.map, o.pos.x + 1, o.pos.y)), '城门右侧是墙，进不来');
  ok(
    townObjs.every(
      (o) => isPassable(g.map, o.pos.x - 1, o.pos.y) || isPassable(g.map, o.pos.x, o.pos.y + 1),
    ),
    '城门正面至少留一个开口',
  );
}

// 7. 所有城都走得到，而且进城的最后一步必定来自正面
{
  const g = createGame({ size: 'medium', seed: 424242, opponents: 3 });
  const startId = g.heroOrder[0];
  const start = g.heroes[startId].pos;
  const field = computePaths(g, start, Infinity);
  const towns = Object.values(g.towns);
  let allReachable = true;
  let frontOnly = true;
  let checked = 0;
  for (const t of towns) {
    const path = buildPath(g, field, start, t.pos);
    if (!path.length) {
      allReachable = false;
      continue;
    }
    checked += 1;
    // 城门就在旁边时 path 只有一步，这时"上一步"就是出发点
    const prev = path.length >= 2 ? path[path.length - 2] : start;
    const fromWest = prev.x === t.pos.x - 1 && prev.y === t.pos.y;
    const fromSouth = prev.x === t.pos.x && prev.y === t.pos.y + 1;
    if (!fromWest && !fromSouth) frontOnly = false;
  }
  ok(allReachable && checked === towns.length, `每座城都走得到（${checked}/${towns.length}）`);
  ok(frontOnly, '进城的最后一步必定落在城门正面');
}

// 8. 站上城门 = 进城；多张地图上都成立
{
  const g = createGame({ size: 'medium', seed: 424242, opponents: 1 });
  const homeTown = Object.values(g.towns).find((t) => t.owner === 'p1');
  g.heroes.hero1.pos = { x: homeTown.pos.x, y: homeTown.pos.y };
  const pending = pendingObjectAt(g, 'hero1');
  ok(!!pending && pending.kind === 'town', '英雄站在城门上能触发进城');
  ok(previewInteraction(g, 'hero1', pending.id)?.kind === 'town', '自家城门给出"我方据点"');

  let bad = 0;
  for (const size of ['small', 'medium', 'large']) {
    for (let seed = 1; seed <= 10; seed++) {
      const s = createGame({ size, seed: seed * 9973, opponents: 3 });
      for (const o of Object.values(s.map.objects)) {
        if (o.kind !== 'town') continue;
        const cells = castleCells(o.pos);
        if (cells.filter((c) => isPassable(s.map, c.x, c.y)).length !== 1) bad += 1;
        if (!footprintOf(o).some((c) => c.x === o.pos.x && c.y === o.pos.y)) bad += 1;
      }
    }
  }
  ok(bad === 0, `30 张地图 × 4 座城，占地规则全部成立（异常 ${bad}）`);
}

/* ---------------- M6：攻城战（城墙 / 城门 / 角塔 / 主楼 / 攻城器械） ---------------- */
{
  console.log('--- M6 攻城战 ---');
  const {
    createSiege,
    wallLevelOf,
    blocksMove,
    liveShooters,
    liveFortifications,
    UNIT_SIEGE_RESIST,
    COLLAPSE_RATIO,
    GATE_COLLAPSE_RATIO,
    WALL_COL,
    GATE_ROW,
    KEEP_COL,
    MOAT_COL,
  } = await import('../dist/core/combat/siege.js');
  const { actSiege, siegeTargets, towerPhase, estimateSiegeDamage, machinePhase } =
    await import('../dist/core/combat/battle.js');
  const { WAR_MACHINES } = await import('../dist/core/data/warmachines.js');

  const wallsOf = (s) => s.structures.filter((x) => x.kind === 'wall').length;
  const turretsOf = (s) => s.structures.filter((x) => x.kind === 'tower').length;
  const keepOf = (s) => s.structures.find((x) => x.kind === 'keep');
  const gateOf = (s) => s.structures.find((x) => x.kind === 'gate');
  const wallAt = (s, row) => s.structures.find((x) => x.kind === 'wall' && x.hex.row === row);

  // 1. 结构生成：等级决定角塔数量，主楼每一级都有
  ok(createSiege(0) === null, '没有城墙 = 野战（createSiege(0) 返回 null）');
  const s1 = createSiege(1);
  const s2 = createSiege(2);
  const s3 = createSiege(3);
  ok(wallsOf(s1) === FIELD_H - 1, '城墙段数 = 列高 − 1（正中让给城门）');
  ok(turretsOf(s1) === 0 && turretsOf(s2) === 1 && turretsOf(s3) === 2, '角塔随城防 0 / 1 / 2 座');
  ok(keepOf(s1) && keepOf(s2) && keepOf(s3), '每一级城防都有主楼');
  ok(
    s3.structures.filter((x) => x.kind === 'tower').every((x) => x.hex.col === WALL_COL),
    '角塔砌在城墙列上（不是墙后）—— 拆掉它就是墙上一个口子',
  );
  ok(keepOf(s3).hex.col === KEEP_COL && KEEP_COL !== WALL_COL, '主楼在城墙之后，不占城墙列');
  ok(gateOf(s3).hex.col === WALL_COL && gateOf(s3).hex.row === GATE_ROW, '城门在城墙列正中');
  ok(s3.structures.every((x) => x.maxHp > 0), '所有结构都有血量');
  ok(
    liveShooters(s3).length === 3 && liveFortifications(s3).length === FIELD_H,
    '射手 = 角塔 2 + 主楼 1；城墙列结构占满整列（投石车只能砸这些）',
  );

  // 2. wallLevelOf 从城镇建筑推导
  const g = createGame({ size: 'medium', seed: 4242, opponents: 1 });
  const myTown = Object.values(g.towns).find((t) => t.owner === 'p1');
  ok(wallLevelOf(myTown) === 0, '刚开局的城没有城墙');
  myTown.buildings.push('wall1', 'wall2');
  ok(wallLevelOf(myTown) === 2, 'wall1 + wall2 = 城防 2 星');
  myTown.buildings.push('wall3');
  ok(wallLevelOf(myTown) === 3, 'wall3 = 城防 3 星');

  // 3. 城墙挡路：攻方一整列都过不去，只有砸掉才能通过
  const atk = { army: [{ unitTypeId: 'pikeman', count: 20 }], attack: 5, defense: 3 };
  const def = { army: [{ unitTypeId: 'archer', count: 15 }], attack: 0, defense: 0 };
  const b = createBattle(atk, def, 7, 2);
  const u = b.units[0];
  u.hex = { col: WALL_COL - 2, row: GATE_ROW };
  const paths = reachable(b, u);
  ok(![...paths.keys()].some((k) => Number(k.split(',')[0]) >= WALL_COL), '城墙没破之前，攻方过不了城墙列');

  // 4. 砸墙：血量下降，砸塌之后那一格能走了，相邻墙段还会跟着掉血
  const seg = wallAt(b.siege, GATE_ROW - 1);
  const nb = wallAt(b.siege, GATE_ROW - 2);
  const hp0 = seg.hp;
  u.hex = { col: MOAT_COL, row: seg.hex.row };
  actSiege(b, u, seg);
  ok(seg.hp < hp0, 'actSiege 让城墙掉血');
  const before = nb.hp;
  let guard = 0;
  while (seg.hp > 0 && guard++ < 200) actSiege(b, u, seg);
  ok(seg.hp === 0, '城墙可以被砸塌');
  ok(nb.hp < before, '一段墙塌了，相邻墙段跟着掉血（缺口会自己变宽）');

  // 5. 城门塌了会带塌两侧 —— 出现三格宽的口子（投石车的价值来源）
  const { createBattle: cb2 } = await import('../dist/core/combat/battle.js');
  const bg = cb2(atk, def, 7, 3);
  const gate = gateOf(bg.siege);
  const gUp = wallAt(bg.siege, GATE_ROW - 1);
  const gDn = wallAt(bg.siege, GATE_ROW + 1);
  gate.hp = 1;
  const ug = bg.units[0];
  ug.hex = { col: MOAT_COL, row: GATE_ROW };
  actSiege(bg, ug, gate);
  ok(gate.hp === 0, '城门可以被砸塌');
  ok(GATE_COLLAPSE_RATIO > COLLAPSE_RATIO, '城门崩塌比普通墙段更彻底');
  ok(gUp.hp === 0 && gDn.hp === 0, '城门塌了，两侧城墙跟着塌');
  ok(
    !blocksMove(bg.siege, { col: WALL_COL, row: GATE_ROW }) &&
      !blocksMove(bg.siege, { col: WALL_COL, row: GATE_ROW - 1 }) &&
      !blocksMove(bg.siege, { col: WALL_COL, row: GATE_ROW + 1 }),
    '塌出来的三格都能走 —— 部队可以并排冲进去',
  );

  // 6. 城墙挡视线：隔墙谁也射不到谁
  const b2 = createBattle(atk, def, 7, 1);
  const shooter = b2.units[0];
  shooter.hex = { col: 2, row: GATE_ROW };
  shooter.unitTypeId = 'archer';
  shooter.shots = 12;
  ok(shootTargets(b2, shooter).length === 0, '完整的城墙挡视线：攻方射不到城里的人');
  ok(towerPhase(b2).length > 0, '主楼在回合开始时自动射击');

  // 7. 角塔在墙上（打得到），主楼在墙后（打不到）
  const b2t = createBattle(atk, def, 7, 2);
  const shooter2 = b2t.units[0];
  shooter2.hex = { col: 2, row: GATE_ROW };
  shooter2.unitTypeId = 'archer';
  shooter2.shots = 12;
  const turret = b2t.siege.structures.find((x) => x.kind === 'tower');
  const keep2 = keepOf(b2t.siege);
  ok(
    siegeTargets(b2t, shooter2, true).some((x) => x.id === turret.id),
    '角塔砌在城墙上，远程可以直接点名它',
  );
  ok(
    siegeTargets(b2t, shooter2, true).every((x) => x.id !== keep2.id),
    '主楼在墙后，破墙之前远程打不到',
  );

  // 8. 部队砸墙有折损，投石车按全额轰 —— 这是投石车值 1500 金的原因
  ok(UNIT_SIEGE_RESIST > 0 && UNIT_SIEGE_RESIST < 1, '部队打城防有伤害折损（箭矢砍不动石墙）');

  // 9. 攻城器械：投石车砸城防（优先城门），弩车射部队
  const MID = [
    { unitTypeId: 'archer', count: 30 },
    { unitTypeId: 'pikeman', count: 20 },
    { unitTypeId: 'knight', count: 8 },
  ];
  const GARR = [
    { unitTypeId: 'archer', count: 20 },
    { unitTypeId: 'pikeman', count: 12 },
  ];
  const DEFG = { army: GARR, attack: 0, defense: 0 };

  const bm = createBattle({ army: MID, attack: 6, defense: 3, warMachines: ['catapult'] }, DEFG, 7, 3);
  const mEv = machinePhase(bm);
  ok(mEv.length === 1 && mEv[0].t === 'machine', '投石车每回合自动开火一次');
  ok(mEv[0].structureId === 'gate', '投石车优先砸城门');
  ok(!machinePhase(bm).length === false, '投石车不会因为目标已残而停火');
  ok(bm.units.length === MID.length + GARR.length, '器械不是战场单位：不占格、不会被瞄准');
  gateOf(bm.siege).hp = 0;
  const mEv2 = machinePhase(bm);
  ok(
    mEv2.length === 1 && mEv2[0].structureId !== 'gate',
    '城门塌了之后，投石车改砸离城门最近的墙段',
  );

  const bb2 = createBattle({ army: MID, attack: 6, defense: 3, warMachines: ['ballista'] }, DEFG, 7, 3);
  const bEv = machinePhase(bb2);
  ok(bEv.length === 1 && !!bEv[0].targetId && !bEv[0].structureId, '弩车每回合自动射击守军');

  const noMach = createBattle({ army: MID, attack: 6, defense: 3 }, DEFG, 7, 1);
  ok(machinePhase(noMach).length === 0, '没带器械就没有器械开火');

  // 10. 投石车让攻城更划算：同一支兵打同一座 1 星城，带投石车损失更小
  const midVsL1 = (mach) => {
    let loss = 0;
    for (let i = 0; i < 9; i++) {
      const out = quickBattle({ army: MID, attack: 6, defense: 3, warMachines: mach }, DEFG, 1000 + i * 7, 1);
      loss += lossRatio(out);
    }
    return loss / 9;
  };
  ok(midVsL1(['catapult']) < midVsL1([]), '投石车让攻城损失明显变小（同一支兵打同一座城）');

  // 11. AI 攻城能在 MAX_ROUNDS 内打完，且最终会破墙
  let noBreach = 0;
  let tooLong = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const bb = createBattle(
      { army: MID, attack: 6, defense: 3, warMachines: ['catapult', 'ballista'] },
      { army: [{ unitTypeId: 'archer', count: 20 }, { unitTypeId: 'pikeman', count: 10 }], attack: 0, defense: 0 },
      seed,
      2,
    );
    const out = autoResolve(bb);
    if (!bb.siege.structures.some((x) => x.hp <= 0)) noBreach += 1;
    if (out.rounds >= 40) tooLong += 1;
  }
  ok(noBreach === 0, `20 场城防 2 星的攻城战全部破墙（没破 ${noBreach} 场）`);
  ok(tooLong === 0, `没有打到 40 回合上限的僵局（${tooLong} 场）`);

  // 12. 城防会提高攻城门槛（同一支部队打同一座城，墙越高损失越大）
  const losses = (lv) => {
    const out = quickBattle({ army: MID, attack: 6, defense: 3 }, DEFG, 11, lv);
    return lossRatio(out);
  };
  const l0 = losses(0);
  const l1 = losses(1);
  const l2 = losses(2);
  const l3 = losses(3);
  ok(
    l0 < l1 && l1 <= l2 && l2 <= l3,
    `城防越高攻方损失越大：0 星 ${Math.round(l0 * 100)}% < 1 星 ${Math.round(l1 * 100)}% ≤ 2 星 ${Math.round(l2 * 100)}% ≤ 3 星 ${Math.round(l3 * 100)}%`,
  );

  // 13. 攻城战里城防不会反击
  const b3 = createBattle(atk, def, 7, 3);
  const u3 = b3.units[0];
  const k3 = keepOf(b3.siege);
  u3.hex = { col: KEEP_COL - 2, row: GATE_ROW };
  const evs = actSiege(b3, u3, k3);
  ok(evs.length === 1 && evs[0].t === 'siege' && evs[0].damage > 0, '主楼可以被近战砸掉血');
  ok(u3.count === atk.army[0].count, '城防不会反击（攻方部队数量不变）');

  // 14. 器械的定义是完整的
  ok(
    WAR_MACHINES.catapult.target === 'fortification' && WAR_MACHINES.ballista.target === 'unit',
    '投石车打城防、弩车打部队',
  );
  ok(WAR_MACHINES.catapult.cost.gold > 0 && WAR_MACHINES.ballista.cost.gold > 0, '两种器械都要花钱');
}

/* ================= M7：矿场与宝库区 ================= */
console.log('\n--- M7 矿场与宝库区 ---');

// 1. 独立矿场：每张图都该有一批，且七种资源迟早都会出现
{
  const seen = new Set();
  let minMines = 999;
  for (const seed of [1, 42, 777, 20260912, 99999]) {
    const g = createGame(seed);
    const mines = Object.values(g.map.objects).filter((o) => o.kind === 'mine');
    minMines = Math.min(minMines, mines.length);
    for (const m of mines) seen.add(m.payload.resource);
  }
  ok(minMines >= 8, `每张图至少 8 座独立矿场（最少的一张 ${minMines} 座）`);
  ok(
    RARE_RESOURCES.every((r) => seen.has(r)),
    `七种资源都有矿：${[...seen].map((r) => MINE_NAME[r]).join('、')}`,
  );
}

// 2. 每家主城 3~7 格内保底一座锯木场 + 一座采石场
{
  const g = createGame({ seed: 20260912, opponents: 3, difficulty: 'normal', playerName: 'P' });
  // 只看阵营主城：中立城走下面单独那条断言（M9 之后中立城也要配齐木石矿）
  const homes = Object.values(g.towns).filter((t) => t.owner !== 'neutral');
  const mines = Object.values(g.map.objects).filter((o) => o.kind === 'mine');
  let missing = 0;
  for (const t of homes) {
    for (const res of ['wood', 'ore']) {
      const near = mines.some(
        (m) =>
          m.payload.resource === res &&
          Math.abs(m.pos.x - t.pos.x) + Math.abs(m.pos.y - t.pos.y) <= HOME_MINE_RING.max,
      );
      if (!near) missing++;
    }
  }
  ok(missing === 0, `每座城附近都有木矿与石矿（缺 ${missing} 处）`);
}

// 3. 矿场初始无主；踩上去就插旗，敌方也能抢走
{
  const g = createGame({ seed: 4242, opponents: 3, difficulty: 'normal', playerName: 'P' });
  const mine = Object.values(g.map.objects).find((o) => o.kind === 'mine');
  ok(mine.payload.owner === 'neutral', '独立矿场开局无主');
  ok(mine.payload.perDay > 0, `${MINE_NAME[mine.payload.resource]} 每日 +${mine.payload.perDay}`);

  const h = g.heroes.hero1;
  h.pos = { ...mine.pos };
  const res = applyInteraction(g, 'hero1', mine.id, true);
  ok(mine.payload.owner === 'p1', '我方英雄踩上去即占领');
  ok(res.title.includes('占领'), `占领提示：${res.title}`);
  // 自家矿不再反复弹窗
  ok(pendingObjectAt(g, 'hero1') === null, '自家矿场不再触发交互');

  // 敌方（p2）来抢
  const foeId = g.heroOrder.find((id) => g.heroes[id].owner === 'p2');
  const foe = g.heroes[foeId];
  foe.pos = { ...mine.pos };
  const steal = applyInteraction(g, foeId, mine.id, true);
  ok(mine.payload.owner === 'p2', '敌方英雄可以夺走矿场');
  ok(steal.title.includes('夺取'), `夺取提示：${steal.title}`);
  ok(steal.message.includes('晨曦') || steal.message.includes('赤焰') || steal.message.includes('翠林') || steal.message.includes('紫晶'), '夺取时点名了原来的主人');

  // 我方再抢回来
  h.pos = { ...mine.pos };
  applyInteraction(g, 'hero1', mine.id, true);
  ok(mine.payload.owner === 'p1', '矿场可以反复易主');
}

// 4. 七种资源都能进每日收入
{
  const g = createGame(555);
  const mine = Object.values(g.map.objects).find((o) => o.kind === 'mine');
  mine.payload.resource = 'mercury';
  mine.payload.perDay = MINE_PER_DAY.mercury;
  mine.payload.owner = 'p1';
  const before = g.players.p1.resources.mercury ?? 0;
  endDay(g);
  ok(
    (g.players.p1.resources.mercury ?? 0) === before + MINE_PER_DAY.mercury,
    `水银矿每日 +${MINE_PER_DAY.mercury} 已发放（${before} → ${g.players.p1.resources.mercury}）`,
  );
}

// 5. 宝库区：重兵守宝，打赢才拿得到，拿完就没了
{
  const g = createGame(31337);
  const vaults = Object.values(g.map.objects).filter((o) => o.kind === 'vault');
  ok(vaults.length >= 2, `地图上有 ${vaults.length} 处宝库区`);
  ok(
    vaults.every((v) => v.payload.army.length > 0 && v.payload.reward.gold > 0),
    '每处宝库都有守军和财物',
  );

  const v = vaults[0];
  const h = g.heroes.hero1;
  h.pos = { ...v.pos };
  h.army = [{ unitTypeId: 'angel', count: 200 }];
  const preview = previewInteraction(g, 'hero1', v.id);
  ok(preview?.kind === 'battle', '宝库要先打一仗');
  ok(preview.message.includes('库中财物'), '预估里写明了库中财物');
  ok(!!preview.estimate, '宝库战斗带损失预估');

  const goldBefore = g.players.p1.resources.gold ?? 0;
  const win = applyInteraction(g, 'hero1', v.id, true);
  ok(win.title.length > 0 && (g.players.p1.resources.gold ?? 0) > goldBefore, `开库得金（+${(g.players.p1.resources.gold ?? 0) - goldBefore}）`);
  ok(!g.map.objects[v.id], '宝库拿完就没了（一次性）');

  // 打不过就是打不过
  const v2 = Object.values(g.map.objects).find((o) => o.kind === 'vault');
  if (v2) {
    const h2 = g.heroes.hero1;
    h2.pos = { ...v2.pos };
    h2.army = [{ unitTypeId: 'peasant', count: 1 }];
    const lose = applyInteraction(g, 'hero1', v2.id, true);
    ok(lose.heroDefeated === true, '兵力不足强攻宝库会全军覆没');
    ok(!!g.map.objects[v2.id], '没打赢，宝库还立在那儿');
  }

  // 宝库能进战术战场（和野怪共用一套战斗参数）
  // 换一局：上面那位英雄已经在强攻中阵亡了
  const g9 = createGame(31337);
  const v3 = Object.values(g9.map.objects).find((o) => o.kind === 'vault');
  const setup = battleSetup(g9, 'hero1', v3);
  ok(!!setup && setup.defender.army.length > 0, '宝库战可以启动战术战场');
  ok(setup.defender.army[0].count > 0, `守库兵力 ${setup.defender.army.map((s) => s.count + ' ' + s.unitTypeId).join('，')}`);
}

// 6. 隘口守卫：深处的宝贝前面都有强档野怪挡着
{
  let guarded = 0;
  let total = 0;
  for (const seed of [1, 42, 777, 20260912, 99999]) {
    const g = createGame(seed);
    const deep = Object.values(g.map.objects).filter(
      (o) => o.kind === 'vault' || (o.kind === 'mine' && RARE_RESOURCES.includes(o.payload.resource)),
    );
    const strong = Object.values(g.map.objects).filter(
      (o) => o.kind === 'wanderingMonster' && o.payload.tier === 'strong',
    );
    for (const d of deep) {
      total++;
      if (strong.some((m) => Math.abs(m.pos.x - d.pos.x) <= 6 && Math.abs(m.pos.y - d.pos.y) <= 6)) guarded++;
    }
  }
  ok(
    guarded === total,
    `宝库与稀有矿都有强档守卫挡路（${guarded}/${total}）`,
  );
}

// 7. 市场：稀有资源按个交易
{
  const g = createGame(2468);
  const t = Object.values(g.towns).find((x) => x.owner === 'p1');
  t.buildings.push('market');
  g.players.p1.resources.gold = 5000;
  g.players.p1.resources.gem = 0;
  ok(marketBuy(g, 'gem') === true, '可以买 1 个宝石');
  ok(g.players.p1.resources.gem === 1, '买到 1 个宝石');
  ok(g.players.p1.resources.gold === 5000 - MARKET_RATES.gem.buyGold, `扣了 ${MARKET_RATES.gem.buyGold} 金`);
  ok(marketSell(g, 'gem') === true, '可以卖 1 个宝石');
  ok(g.players.p1.resources.gem === 0 && g.players.p1.resources.gold === 5000 - MARKET_RATES.gem.buyGold + MARKET_RATES.gem.sellGold, `卖得 ${MARKET_RATES.gem.sellGold} 金`);
  // 木石仍是按批交易的老规矩
  g.players.p1.resources.wood = 10;
  marketSell(g, 'wood');
  ok(g.players.p1.resources.wood === 5, '木/矿仍是 5 个一批');
}


/* ================= M8：战斗回合与终局回归（线上 bug 复现） ================= */
console.log('\n--- M8 战斗回合与终局回归 ---');

// 1. 等待不再跳过下一个单位（食人魔站桩 bug）：
//    速度 4/4/3 → 序列 [弓, 枪, 食人魔]；枪兵一等待，食人魔曾被整回合跳过
{
  const b = createBattle(
    { army: [{ unitTypeId: 'archer', count: 1 }, { unitTypeId: 'pikeman', count: 1 }], attack: 0, defense: 0 },
    { army: [{ unitTypeId: 'ogre', count: 1 }], attack: 0, defense: 0 },
    9, 0,
  );
  actDefend(currentUnit(b));
  endActivation(b); // 弓手完事 → 枪兵
  const p = currentUnit(b);
  ok(p.unitTypeId === 'pikeman', '轮到枪兵');
  actWait(b, p);
  endActivation(b); // UI 里等待之后必然紧跟 endActivation 推进指针
  const u2 = currentUnit(b);
  ok(!!u2 && u2.unitTypeId === 'ogre', `等待后紧随其后的食人魔行动（实际：${u2 ? u2.unitTypeId : 'null'}）`);
  const before = { ...u2.hex };
  aiAct(b, u2);
  ok(
    u2.hex.col !== before.col || u2.hex.row !== before.row,
    `食人魔同一回合真的动了（${before.col},${before.row} → ${u2.hex.col},${u2.hex.row}）`,
  );
}

// 2. 等待者本人仍会在回合末行动（不能把等待变成"跳过自己"）
{
  const b = createBattle(
    { army: [{ unitTypeId: 'archer', count: 1 }], attack: 0, defense: 0 },
    { army: [{ unitTypeId: 'ogre', count: 1 }], attack: 0, defense: 0 },
    9, 0,
  );
  const a = currentUnit(b);
  actWait(b, a);
  const u2 = currentUnit(b); // 食人魔
  aiAct(b, u2);
  endActivation(b);
  const u3 = currentUnit(b);
  ok(!!u3 && u3.id === a.id, '等待的弓手在回合末获得行动权');
}

// 3. 法术击杀最后一个敌人 → 战斗立即终局（UI 卡死 bug 的根源）
{
  const b = createBattle(
    {
      army: [{ unitTypeId: 'archer', count: 30 }],
      attack: 4, defense: 8,
      caster: { spells: ['lightningBolt'], spellPower: 5, mana: 20 },
    },
    { army: [{ unitTypeId: 'peasant', count: 1 }], attack: 0, defense: 0 },
    42, 0,
  );
  const t = b.units.find((u) => u.unitTypeId === 'peasant');
  castSpell(b, 0, 'lightningBolt', t);
  ok(b.over && b.winner === 0, '法术收掉最后一个敌人后 battle.over 立即为真');
}

// 4. 射击击杀最后一个敌人 → 战斗立即终局（不再等回合结束）
{
  const b = createBattle(
    { army: [{ unitTypeId: 'archer', count: 30 }], attack: 9, defense: 8 },
    { army: [{ unitTypeId: 'peasant', count: 1 }], attack: 0, defense: 0 },
    42, 0,
  );
  const u = currentUnit(b);
  const t = b.units.find((x) => x.unitTypeId === 'peasant');
  actShoot(b, u, t);
  ok(b.over && b.winner === 0, '射击收掉最后一个敌人后 battle.over 立即为真');
}


/* ================= M9：地图布局模板 ================= */
console.log('\n--- M9 地图布局模板 ---');

/** 从起点 4 邻域洪泛，返回 Uint8Array（只走可通行格）。 */
function flood(map, start) {
  const seen = new Uint8Array(map.width * map.height);
  const st = [start.y * map.width + start.x];
  seen[st[0]] = 1;
  while (st.length) {
    const c = st.pop();
    const x = c % map.width;
    const y = (c / map.width) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const ni = ny * map.width + nx;
      if (seen[ni] || !isPassable(map, nx, ny)) continue;
      seen[ni] = 1;
      st.push(ni);
    }
  }
  return seen;
}

const LAYOUT_IDS = ['wild', 'ring', 'islands', 'lanes'];
const tileCount = (map, pred) => map.tiles.filter(pred).length;

// 1. 老存档/老调用没有 layout 字段 → 必须补成旷野，行为与 M7 一致
ok(createGame({ seed: 7, layout: undefined }).config.layout === 'wild', '不传 layout 时默认旷野');

// 2. 四种布局 × 12 种子：都生得出来，且四家全部连通、城镇四格都可通行
{
  let bad = [];
  for (const layout of LAYOUT_IDS) {
    for (let i = 0; i < 12; i++) {
      const st = createGame({ seed: 500 + i * 977, layout, size: 'medium', opponents: 3 });
      const map = st.map;
      if (Object.keys(st.towns).length < 6) bad.push(`${layout}#${i} 城太少`);
      if (st.config.layout !== layout) bad.push(`${layout}#${i} 配置回退`);
      const seen = flood(map, st.heroes[st.heroOrder[0]].pos);
      for (const t of Object.values(st.towns)) {
        if (seen[t.pos.y * map.width + t.pos.x] !== 1) bad.push(`${layout}#${i} 城走不到`);
        // 城门可通行，其余三格被城堡自己挡住（"有门的城"这条规则不能破）
        const cells = castleCells(t.pos);
        if (!isPassable(map, t.pos.x, t.pos.y)) bad.push(`${layout}#${i} 城门不可通行`);
        for (const c of cells) {
          if (c.x === t.pos.x && c.y === t.pos.y) continue;
          if (isPassable(map, c.x, c.y)) bad.push(`${layout}#${i} 城堡侧格能站人`);
        }
      }
      for (const h of Object.values(st.heroes)) {
        if (seen[h.pos.y * map.width + h.pos.x] !== 1) bad.push(`${layout}#${i} 英雄走不到`);
      }
    }
  }
  ok(bad.length === 0, `四种布局各 12 局全部生成成功且连通（${bad.slice(0, 2).join(' / ') || 'ok'}）`);
}

// 3. 布局真的换了地形：同一颗种子下，三档布局与旷野的差异都很大
{
  const base = createGame({ seed: 9090, layout: 'wild', size: 'medium' });
  for (const layout of ['ring', 'islands', 'lanes']) {
    const st = createGame({ seed: 9090, layout, size: 'medium' });
    const diff = st.map.tiles.filter(
      (t, i) => t.terrain !== base.map.tiles[i].terrain,
    ).length / st.map.tiles.length;
    ok(diff > 0.3, `同心环/双子岛/三路走廊与旷野地形差异 ${(diff * 100).toFixed(0)}%（${layout}）`);
  }
}

// 4. 同心环：两道护城河真的存在，中央高地最富（强档宝库落在中心）
{
  const st = createGame({ seed: 9137, layout: 'ring', size: 'medium', opponents: 3 });
  const map = st.map;
  const cx = (map.width - 1) / 2;
  const cy = (map.height - 1) / 2;
  const min = Math.min(map.width, map.height);
  const core = Math.max(3, min * 0.14);
  const moat = Math.max(1.5, min * 0.06);
  const inner = core + moat;
  const ringEnd = Math.max(inner + 2.5, min * 0.26);
  const outer = ringEnd + moat;
  const isWater = (x, y) => map.tiles[y * map.width + x].terrain === 'water';
  // 在 12 个方向各采一次：内护城河与外护城河都该是水（渡口最多占三分之一）
  let innerWater = 0;
  let outerWater = 0;
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    const wx = Math.round(cx + Math.cos(a) * (inner - moat / 2));
    const wy = Math.round(cy + Math.sin(a) * (inner - moat / 2));
    const ox = Math.round(cx + Math.cos(a) * (outer - moat / 2));
    const oy = Math.round(cy + Math.sin(a) * (outer - moat / 2));
    if (isWater(wx, wy)) innerWater++;
    if (isWater(ox, oy)) outerWater++;
  }
  ok(innerWater >= 8, `内护城河在 12 个方向上 ${innerWater} 处是水`);
  ok(outerWater >= 8, `外护城河在 12 个方向上 ${outerWater} 处是水`);
  // 强档宝库：同心环的腹地是中心，所以中心附近必须拿得到强档那一份
  const vaults = Object.values(map.objects).filter((o) => o.kind === 'vault');
  const strongCore = vaults.filter(
    (v) => v.payload.tier === 'strong' && Math.hypot(v.pos.x - cx, v.pos.y - cy) < core * 1.4,
  );
  ok(strongCore.length >= 1, `中央高地有强档宝库（${strongCore.length} 座）`);
  // 四家都在外护城河之外，起手区不会被河切开
  const towns = Object.values(st.towns).filter((t) => t.owner !== 'neutral');
  ok(
    towns.every((t) => Math.hypot(t.pos.x - cx, t.pos.y - cy) > outer - 1),
    '同心环四家主城都在外护城河之外',
  );
  ok(tileCount(map, (t) => t.terrain === 'water') > 0.1 * map.tiles.length, '同心环水面占比够高');
}

// 5. 双子岛：一条纵向海峡、两座桥，四家两家一岛
{
  const st = createGame({ seed: 9137, layout: 'islands', size: 'medium', opponents: 3 });
  const map = st.map;
  const mid = (map.width - 1) / 2;
  let west = 0;
  let east = 0;
  for (const t of Object.values(st.towns)) {
    if (t.owner === 'neutral') continue;
    if (t.pos.x < mid) west++;
    else east++;
  }
  ok(west === 2 && east === 2, `双子岛四家 2/2 分居东西（${west}/${east}）`);
  // 海峡：中线上"水占多数"的行要够多
  let wetRows = 0;
  for (let y = 3; y < map.height - 3; y++) {
    const row = [Math.floor(mid) - 1, Math.floor(mid), Math.ceil(mid)].filter((x) =>
      map.tiles[y * map.width + x].terrain === 'water',
    ).length;
    if (row >= 2) wetRows++;
  }
  ok(wetRows >= (map.height - 6) * 0.5, `中线上 ${wetRows} 行是水（海峡成立）`);
  ok(
    map.tiles.filter((t) => t.terrain === 'water').length > 0.08 * map.tiles.length,
    '双子岛水面占比 ≥8%',
  );
}

// 6. 三路走廊：两道河脊各有缺口，四家分居三条走廊
{
  const st = createGame({ seed: 9137, layout: 'lanes', size: 'medium', opponents: 3 });
  const map = st.map;
  const ridges = [Math.round(map.height / 3), Math.round((2 * map.height) / 3)];
  let ridgeOk = 0;
  let gapsOk = 0;
  for (const r of ridges) {
    // 河脊两行里水要占绝大多数
    let wet = 0;
    for (const y of [r - 1, r]) {
      for (let x = 2; x < map.width - 2; x++) {
        if (map.tiles[y * map.width + x].terrain === 'water') wet++;
      }
    }
    if (wet > (map.width - 4) * 1.2) ridgeOk++;
    // 缺口：某一列两行都能走（这就是唯一的过路点）
    let gaps = 0;
    for (let x = 2; x < map.width - 2; x++) {
      if (r > 0 && r < map.height - 1) {
        const mid = map.tiles[r * map.width + x];
        const above = map.tiles[(r - 1) * map.width + x];
        if (mid.terrain !== 'water' && above.terrain !== 'water') gaps++;
      }
    }
    if (gaps >= 1) gapsOk++;
  }
  ok(ridgeOk === 2, '两条河脊都以水为主');
  ok(gapsOk === 2, '两条河脊都留着可通行的缺口');
  const laneOf = (y) => (y < ridges[0] - 1 ? 0 : y < ridges[1] - 1 ? 1 : 2);
  const lanes = Object.values(st.towns)
    .filter((t) => t.owner !== 'neutral')
    .map((t) => laneOf(t.pos.y));
  ok(new Set(lanes).size === 3, `四家铺满三条走廊（${lanes.join(',')}）`);
}

// 7. 每种布局的资源都不缺：矿场 ≥ 8、宝库 ≥ 2、深处宝贝有守卫
{
  for (const layout of LAYOUT_IDS) {
    const st = createGame({ seed: 31337, layout, size: 'medium', opponents: 3 });
    const objs = Object.values(st.map.objects);
    const mines = objs.filter((o) => o.kind === 'mine').length;
    const vaults = objs.filter((o) => o.kind === 'vault').length;
    const monsters = objs.filter((o) => o.kind === 'wanderingMonster').length;
    ok(mines >= 8 && vaults >= 2 && monsters >= 8, `${layout}：矿 ${mines} / 宝库 ${vaults} / 野怪 ${monsters}`);
  }
}


/* ================= M9.2：巨型地图 + 每座城都配木石矿 ================= */
console.log('\n--- M9.2 巨型地图与每城木石矿 ---');

// 1. 巨型地图（48×48）能生成、四家连通、资源不缺
{
  let bad = [];
  for (const layout of LAYOUT_IDS) {
    const st = createGame({ seed: 8642, layout, size: 'huge', opponents: 3 });
    const map = st.map;
    if (map.width !== 48 || map.height !== 48) bad.push(`${layout} 尺寸不对`);
    const seen = flood(map, st.heroes[st.heroOrder[0]].pos);
    for (const t of Object.values(st.towns)) {
      if (seen[t.pos.y * map.width + t.pos.x] !== 1) bad.push(`${layout} 城走不到`);
    }
    const objs = Object.values(map.objects);
    if (objs.filter((o) => o.kind === 'mine').length < 20) bad.push(`${layout} 矿太少`);
    if (objs.filter((o) => o.kind === 'vault').length < 4) bad.push(`${layout} 宝库太少`);
  }
  ok(bad.length === 0, `巨型地图四档布局全部生成成功且连通（${bad.slice(0, 2).join(' / ') || 'ok'}）`);
}

// 2. 每座城（含中立城）附近都要有锯木场与采石场：抢来的城也得能马上开工
{
  let bad = [];
  for (const size of ['small', 'medium', 'large']) {
    for (const layout of ['wild', 'lanes']) {
      const g = createGame({ seed: 777 + size.length * 31, opponents: 3, size, layout });
      const mines = Object.values(g.map.objects).filter((o) => o.kind === 'mine');
      for (const t of Object.values(g.towns)) {
        for (const res of ['wood', 'ore']) {
          const near = mines.some(
            (m) =>
              m.payload.resource === res &&
              Math.abs(m.pos.x - t.pos.x) + Math.abs(m.pos.y - t.pos.y) <= HOME_MINE_RING.max + 5,
          );
          if (!near) bad.push(`${size}/${layout} ${t.id} 缺 ${res}`);
        }
      }
    }
  }
  ok(bad.length === 0, `每座城（含中立城）附近都有木矿与石矿（${bad.slice(0, 2).join(' / ') || 'ok'}）`);
}

// 3. 建造面板要说清楚"到底缺什么"：不能只报金币而玩家金币一大把
{
  const g = createGame({ seed: 4242, opponents: 0 });
  const town = g.towns.town_home;
  town.buildings = ['tavern', 'guild1', 'guild2'];  // 前置齐备，只剩"钱够不够"
  g.players.p1.resources = { gold: 99999, wood: 99, ore: 99 };  // 金木矿管够，稀有资源为零
  const st = buildStatus(g, town, 'guild3');                    // 大法师塔：4500 金 + 4 水晶
  ok(!st.affordable && st.reason.includes('水晶'), `大法师塔如实报告缺水晶（${st.reason}）`);
  ok(
    st.missing.some((m) => m.resource === 'crystal' && m.need === 4 && m.have === 0),
    '缺料明细带"现有 / 需要"',
  );
  ok(costText(st.cost).includes('水晶'), `造价文本覆盖稀有资源（${costText(st.cost)}）`);
  g.players.p1.resources = { gold: 99999, wood: 99, ore: 99, crystal: 4 };
  ok(buildStatus(g, town, 'guild3').affordable, '补上水晶后大法师塔可建');
}

/* ================= P0.1：镜头手感（惯性 / 平滑缩放 / 边缘滚屏） ================= */
console.log('\n--- P0.1 镜头手感 ---');

function freshCam() {
  const cam = new Camera();
  cam.viewW = 800;
  cam.viewH = 600;
  cam.mapW = 48;
  cam.mapH = 48;
  cam.centerOn(24, 24);
  return cam;
}

// 1. 惯性：松手后镜头继续滑行，且按指数衰减最终停稳
{
  const cam = freshCam();
  for (let i = 0; i < 5; i++) cam.trackFling(5, 0, 16);
  ok(cam.vx > 100, `拖拽轨迹累积出惯性初速度（vx=${Math.round(cam.vx)}px/s）`);
  const x0 = cam.x;
  cam.update(16);
  ok(cam.x > x0, '松手后第一帧继续沿惯性方向滑行');
  for (let i = 0; i < 300; i++) cam.update(16);
  ok(cam.vx === 0 && cam.vy === 0, '惯性最终衰减到完全停止');
  const xs = cam.x;
  for (let i = 0; i < 30; i++) cam.update(16);
  ok(cam.x === xs, '停稳后不再漂移（无亚像素爬行）');
}

// 2. 平滑缩放：滚轮只改目标值，动画收敛后锚点下的世界点不动
{
  const cam = freshCam();
  const ax = 220;
  const ay = 180;
  const before = cam.screenToWorld(ax, ay);
  cam.zoomAt(ax, ay, 1.2);
  ok(cam.targetZoom > cam.zoom, `滚轮先改目标缩放（${cam.zoom} → ${cam.targetZoom}）`);
  cam.zoomAt(ax, ay, 1.2); // 动画没播完又滚一下：基于目标值续档，不回退
  for (let i = 0; i < 200 && cam.zoom !== cam.targetZoom; i++) cam.update(16);
  ok(cam.zoom === cam.targetZoom, '缩放动画收敛到目标档位');
  const after = cam.screenToWorld(ax, ay);
  ok(
    Math.abs(after.wx - before.wx) < 0.02 && Math.abs(after.wy - before.wy) < 0.02,
    `缩放全程锚点下的世界点不动（偏差 ${Math.abs(after.wx - before.wx).toFixed(4)} 格）`,
  );
}

// 3. 边缘滚屏：贴边平移、随深度加速，且会接管惯性
{
  const cam = freshCam();
  cam.vx = 300; // 先给个惯性，边缘滚屏应接管（清零）
  const x0 = cam.x;
  cam.edgeScroll(4, 300, 16);
  ok(cam.x < x0, '鼠标贴左边，镜头向左滚');
  ok(cam.vx === 0, '边缘滚屏接管并停掉惯性');
  const slow = Math.abs(cam.x - x0);
  const x1 = cam.x;
  cam.edgeScroll(0, 300, 16); // 贴得更死 → 更快
  ok(Math.abs(cam.x - x1) > slow, '贴边越深滚得越快');
  const x2 = cam.x;
  cam.edgeScroll(400, 300, 16); // 居中不滚
  ok(cam.x === x2, '鼠标居中时不滚屏');
}

/* ================= P1.3：昼夜光照（lightTintAt 纯函数） ================= */
console.log('\n--- P1.3 昼夜光照 ---');

// 1. 正午是无效果的纯白（亮度不能被常态光照拉低）
{
  const t = lightTintAt(0.22);
  ok(t.r === 255 && t.g === 255 && t.b === 255, `正午纯白无叠色（实际 rgb(${t.r},${t.g},${t.b})）`);
  ok(t.warm === 0, '正午无暖光');
}

// 2. 深夜显著压暗且偏蓝，但不能黑到影响读图（下限 55% 亮度）
{
  const t = lightTintAt(0.68);
  ok(t.r < 170 && t.b > t.r, `深夜压暗且偏蓝（rgb(${t.r},${t.g},${t.b})）`);
  ok(t.r >= 120, `深夜不黑过下限（r=${t.r} ≥ 120，保住可读性）`);
}

// 3. 黄昏偏暖（r > b）且带暖光
{
  const t = lightTintAt(0.5);
  ok(t.r > t.b && t.warm > 0.1, `黄昏暖橘（rgb(${t.r},${t.g},${t.b}) warm=${t.warm.toFixed(2)}）`);
}

// 4. 连续性：全周期细扫，相邻相位不能跳变（渐变必须平滑）
{
  let maxJump = 0;
  let prev = lightTintAt(0);
  for (let i = 1; i <= 720; i++) {
    const cur = lightTintAt(i / 720);
    const jump = Math.max(Math.abs(cur.r - prev.r), Math.abs(cur.g - prev.g), Math.abs(cur.b - prev.b));
    if (jump > maxJump) maxJump = jump;
    prev = cur;
  }
  ok(maxJump <= 2, `全周期相邻相位最大跳变 ${maxJump}（≤2 视为平滑）`);
}

// 5. 相位取模：负数与 >1 的相位不会炸，且与归一化后一致
{
  const a = lightTintAt(1.68);
  const b = lightTintAt(0.68);
  const c = lightTintAt(-0.32);
  ok(a.r === b.r && a.g === b.g && a.b === b.b, '相位 1.68 ≡ 0.68（正向取模）');
  ok(c.r === b.r && c.g === b.g && c.b === b.b, '相位 -0.32 ≡ 0.68（负向取模）');
}

/* ================= 移动端画质分档（quality 纯逻辑） ================= */
console.log('\n--- 移动端画质分档 ---');

// 1. 三档映射（§4.2 分档表）
{
  const low = settingsForTier('low');
  ok(low.lighting === 'multiply' && !low.vignette && !low.warmOverlay, '低端：只 multiply，关暗角与暖光');
  ok(!low.waterGlint && !low.townGlow && !low.gridLines, '低端：关水面高光/城镇灯火/网格线');
  ok(low.dprCap === 1.5, `低端 DPR 上限 1.5（实际 ${low.dprCap}）`);
  ok(low.maxMapSize === 32, `低端地图上限 32（实际 ${low.maxMapSize}）`);

  const mid = settingsForTier('mid');
  ok(mid.lighting === 'multiply' && mid.vignette && !mid.warmOverlay, '中端：multiply + 暗角，关 overlay 暖光');
  ok(mid.dprCap === 2 && mid.maxMapSize === 40, `中端 DPR 2 / 地图 40（实际 ${mid.dprCap}/${mid.maxMapSize}）`);

  const high = settingsForTier('high');
  ok(high.lighting === 'full' && high.vignette && high.warmOverlay, '高端：光照全开');
  ok(high.dprCap === 3 && high.maxMapSize === 48, `高端 DPR 3 / 地图 48（实际 ${high.dprCap}/${high.maxMapSize}）`);

  ok(settingsForTier('high').hoverEffects === false, 'hoverEffects 默认 false（触屏优先）');
  ok(settingsForTier('high', true).hoverEffects === true, 'hoverEffects 可由设备能力置 true');
  ok(TIER_ORDER.every((t) => settingsForTier(t).tier === t), '每档回填正确的 tier');
}

// 2. 探测分类器边界（§4.3 阈值）
{
  ok(classifyProbe(25, 3) === 'low', 'p95=25ms → 低端');
  ok(classifyProbe(20.1, 3) === 'low', 'p95 略超 20ms → 低端');
  ok(classifyProbe(20, 3) === 'mid', 'p95=20ms 不算超 → 中端');
  ok(classifyProbe(15, 3) === 'mid', 'p95=15ms → 中端');
  ok(classifyProbe(12, 3) === 'high', 'p95=12ms 且 DPR3 → 高端');
  ok(classifyProbe(5, 1) === 'mid', '轻载但 DPR1 → 中端（不冒进高端）');
  ok(classifyProbe(5, 1.5) === 'mid', '轻载但 DPR1.5 → 中端');
  ok(classifyProbe(5, 2) === 'high', '轻载且 DPR2 → 高端');
}

// 3. probeTier：注入时钟与让帧，验证阈值与 fail-safe（无头环境绝不抛）
{
  let t = 0;
  const mk = (dt, opts = {}) => {
    t = 0;
    return probeTier({
      draw: opts.draw ?? (() => {}),
      sync: opts.sync,
      now: opts.now ?? (() => (t += dt)),
      yieldFrame: () => Promise.resolve(),
      frames: 30,
      dpr: opts.dpr ?? 3,
    });
  };
  ok((await mk(25)) === 'low', 'probeTier 全帧 25ms → 低端');
  ok((await mk(15)) === 'mid', 'probeTier 全帧 15ms → 中端');
  ok((await mk(5, { dpr: 3 })) === 'high', 'probeTier 全帧 5ms/DPR3 → 高端');
  ok((await mk(5, { dpr: 1 })) === 'mid', 'probeTier 全帧 5ms/DPR1 → 中端');

  const safeSync = await mk(5, { dpr: 3, sync: () => { throw new Error('no getImageData'); } });
  ok(safeSync === 'mid', 'probeTier 在 sync 抛错时 fail-safe 退回 mid');
  const safeDraw = await mk(5, { dpr: 3, draw: () => { throw new Error('boom'); } });
  ok(safeDraw === 'mid', 'probeTier 在 draw 抛错时 fail-safe 退回 mid');
  const nan = await probeTier({ draw: () => {}, now: () => Number.NaN, yieldFrame: () => Promise.resolve(), frames: 30, dpr: 3 });
  ok(nan === 'mid', 'probeTier 时钟不可用（NaN）时退回 mid');
}

// 4. 地图尺寸夹紧（§4.2 maxMapSize 的落地）
{
  ok(JSON.stringify(allowedMapSizes(32)) === JSON.stringify(['small', 'medium']), '低端可选尺寸只剩 small/medium');
  ok(allowedMapSizes(40).includes('large') && !allowedMapSizes(40).includes('huge'), '中端到 large、不含 huge');
  ok(allowedMapSizes(48).length === 4, '高端四档全开');
  ok(clampMapSize('huge', 32) === 'medium', '低端把 huge 夹到 medium');
  ok(clampMapSize('huge', 40) === 'large', '中端把 huge 夹到 large');
  ok(clampMapSize('huge', 48) === 'huge', '高端 huge 保持 huge');
  ok(clampMapSize('small', 32) === 'small', '小图不受上限影响');
}

// 5. M-01 边缘滚屏守卫（纯谓词）
{
  const base = { lastPointerType: 'mouse', hoverActive: true, activePointers: 0, modalOpen: false, battleOpen: false };
  ok(shouldEdgeScroll(base) === true, '鼠标悬停且无按下 → 允许边缘滚屏');
  ok(shouldEdgeScroll({ ...base, lastPointerType: 'touch' }) === false, '触屏 → 禁止边缘滚屏（M-01 核心）');
  ok(shouldEdgeScroll({ ...base, lastPointerType: 'pen' }) === false, '手写笔 → 禁止');
  ok(shouldEdgeScroll({ ...base, lastPointerType: null }) === false, '未识别指针类型 → 禁止');
  ok(shouldEdgeScroll({ ...base, hoverActive: false }) === false, '指针不在画布内 → 禁止');
  ok(shouldEdgeScroll({ ...base, activePointers: 1 }) === false, '正按下指针（拖拽/捏合）→ 禁止');
  ok(shouldEdgeScroll({ ...base, modalOpen: true }) === false, '弹窗打开 → 禁止');
  ok(shouldEdgeScroll({ ...base, battleOpen: true }) === false, '战斗界面 → 禁止');
  ok(normalizePointerType('mouse') === 'mouse' && normalizePointerType('touch') === 'touch' && normalizePointerType('pen') === 'pen', 'pointerType 归一化');
  ok(normalizePointerType('') === null && normalizePointerType(undefined) === null, '空/未知 pointerType → null');
}

// 6. M-02 地形烘焙字节预算
{
  const mib = (n) => n / 1048576;
  ok(bakeBytes(32, 32) === 32 * 32 * 32 * 32 * 4, 'bakeBytes 公式正确');
  ok(mib(bakeBytes(32, 32)) === 4, `低端 32×32 烘焙 4 MiB（实际 ${mib(bakeBytes(32, 32))}）`);
  ok(mib(bakeBytes(40, 40)) === 6.25, `中端 40×40 烘焙 6.25 MiB（实际 ${mib(bakeBytes(40, 40))}）`);
  ok(mib(bakeBytes(48, 48)) === 9, `高端 48×48 烘焙 9 MiB（实际 ${mib(bakeBytes(48, 48))}）`);
  ok(mib(bakeBytes(settingsForTier('low').maxMapSize, settingsForTier('low').maxMapSize)) <= 4, '低端上限能把烘焙面压到 ≤4 MiB');
}

/* ================= E3 无城 7 日宽限期出局 ================= */
console.log('\n--- E3 无城 7 日出局 ---');

// 1. 边界：有英雄、没城，恰好在第 NO_TOWN_GRACE_DAYS 天出局
{
  const g = createGame({ size: 'medium', seed: 91, opponents: 1 });
  for (const t of Object.values(g.towns)) if (t.owner === 'p2') t.owner = 'neutral';
  ok(g.heroOrder.some((id) => g.heroes[id]?.owner === 'p2'), '前置：p2 丢掉最后一座城，但还有英雄');
  ok(noTownDaysOf(g, 'p2') === 0, '刚丢城当天，无城天数从 0 起算');
  ok(!isEliminated(g, 'p2'), '丢城当天不出局（还有翻盘窗口）');

  for (let d = 0; d < NO_TOWN_GRACE_DAYS - 1; d++) advanceNoTownStreaks(g);
  ok(noTownDaysOf(g, 'p2') === NO_TOWN_GRACE_DAYS - 1, `撑到第 ${NO_TOWN_GRACE_DAYS - 1} 天：天数已累计但未满`);
  ok(!isEliminated(g, 'p2'), '第 6 天仍在宽限期内 → 未出局');

  const timedOut = advanceNoTownStreaks(g); // 第 7 天
  ok(noTownDaysOf(g, 'p2') === NO_TOWN_GRACE_DAYS, '第 7 天：无城天数恰好到达上限');
  ok(timedOut.includes('p2'), `advanceNoTownStreaks 恰好在第 ${NO_TOWN_GRACE_DAYS} 天把 p2 报出`);
  ok(isEliminated(g, 'p2'), `恰好第 ${NO_TOWN_GRACE_DAYS} 天 → 判定 p2 出局`);
}

// 2. 处置：出局即清场（不留"有英雄但不动"的僵尸）并写一条日志
{
  const g = createGame({ size: 'medium', seed: 92, opponents: 1 });
  for (const t of Object.values(g.towns)) if (t.owner === 'p2') t.owner = 'neutral';
  for (let d = 0; d < NO_TOWN_GRACE_DAYS; d++) advanceNoTownStreaks(g);
  const logsBefore = g.log.length;
  eliminateFaction(g, 'p2');
  ok(!g.heroOrder.some((id) => g.heroes[id]?.owner === 'p2'), '出局后 p2 名下的英雄全部退场');
  ok(g.log.length === logsBefore + 1, '出局写了一条日志');
  eliminateFaction(g, 'p2'); // 再处置一次：英雄已清空，不应报错
  ok(!g.heroOrder.some((id) => g.heroes[id]?.owner === 'p2'), '重复处置幂等（已清空的英雄不会再动）');
}

// 3. 有城的阵营不计时：重新拿回一座城 → 无城天数归零
{
  const g = createGame({ size: 'medium', seed: 93, opponents: 1 });
  ok(Object.values(g.towns).some((t) => t.owner === 'p2'), '前置：p2 开局有城');
  g.players.p2.noTownDays = 4; // 模拟它此前短暂丢过城
  advanceNoTownStreaks(g);
  ok(noTownDaysOf(g, 'p2') === 0, '只要手上还有城，无城天数就归零');
  ok(!isEliminated(g, 'p2'), '有城阵营永远不因这条规则出局');
}

// 4. 玩家（p1）豁免：无城再久也不计时、不进超时名单
{
  const g = createGame({ size: 'medium', seed: 94, opponents: 1 });
  for (const t of Object.values(g.towns)) if (t.owner === 'p1') t.owner = 'neutral';
  const seen = [];
  for (let d = 0; d < NO_TOWN_GRACE_DAYS + 5; d++) seen.push(...advanceNoTownStreaks(g));
  ok(!seen.includes('p1'), 'advanceNoTownStreaks 从不把 p1 计入超时名单');
  ok(noTownDaysOf(g, 'p1') === 0, 'p1 的无城天数始终为 0（人类不吃这条规则）');
  ok(!isEliminated(g, 'p1'), '玩家无城也能继续（还有英雄）');
}

// 5. 与 evaluateOutcome 的联动：唯一对手撑满宽限期 → 玩家判定胜利
{
  const g = createGame({ size: 'medium', seed: 95, opponents: 1 });
  for (const t of Object.values(g.towns)) if (t.owner === 'p2') t.owner = 'neutral';
  for (let d = 0; d < NO_TOWN_GRACE_DAYS; d++) {
    for (const f of advanceNoTownStreaks(g)) eliminateFaction(g, f);
    evaluateOutcome(g);
  }
  ok(isEliminated(g, 'p2'), '连续 7 天后 p2 出局');
  ok(g.status === 'won', '敌方全部出局 → evaluateOutcome 自动判定胜利');
}

/* ================= 第四轮移动端打磨：Q-11 hover 门控 + M-11 双击居中 ================= */

// 7. Q-11 hover 门控（纯谓词，配合 main.ts 里 `if (!dragged && shouldHover(...)) updateHover(e)`）
{
  ok(shouldHover('mouse') === true, 'Q-11：鼠标 → 处理悬停');
  ok(shouldHover('pen') === true, 'Q-11：触控笔 → 处理悬停');
  ok(shouldHover('touch') === false, 'Q-11：触屏 → 不处理悬停（核心：触屏无 hover）');
  ok(shouldHover(null) === false, 'Q-11：未识别/空指针类型 → 不处理悬停');
}

// 8. M-11 双击识别（纯分类器 + 边界：时间 300ms、位移 12px 都算"含"）
{
  const t0 = 1000;
  const first = { t: t0, x: 100, y: 100 };
  ok(isDoubleTap(null, first) === false, 'M-11：首次点击（无前次记录）不算双击');
  ok(isDoubleTap(first, { t: t0 + 120, x: 104, y: 103 }) === true, 'M-11：120ms / 5px 内 → 双击');
  ok(
    isDoubleTap(first, { t: t0 + DOUBLE_TAP_MAX_MS, x: 100 + DOUBLE_TAP_MAX_DIST, y: 100 }) === true,
    'M-11：正好 300ms / 12px → 双击（边界含）',
  );
  ok(
    isDoubleTap(first, { t: t0 + DOUBLE_TAP_MAX_MS + 1, x: 100, y: 100 }) === false,
    'M-11：301ms → 不算（超时）',
  );
  ok(
    isDoubleTap(first, { t: t0 + 100, x: 100 + DOUBLE_TAP_MAX_DIST + 1, y: 100 }) === false,
    'M-11：位移 13px → 不算（太远）',
  );
  // 用 hypot 判距离：3-4-5 对角线 5px 算双击，5-12-13 对角线 13px 不算
  ok(isDoubleTap(first, { t: t0 + 100, x: 103, y: 104 }) === true, 'M-11：对角 5px（3-4-5）→ 双击');
  ok(isDoubleTap(first, { t: t0 + 100, x: 105, y: 112 }) === false, 'M-11：对角 13px（5-12-13）→ 不算');
  // 时间倒退（时钟异常）必须判否，否则会把"未来点"误当双击
  ok(
    isDoubleTap({ t: t0 + 200, x: 100, y: 100 }, { t: t0 + 100, x: 100, y: 100 }) === false,
    'M-11：时间倒退（时钟异常）→ 不算',
  );
}

/* ================= D-58/D-61/D-63：canonical 兵种 id 与旧档迁移（段 1） ================= */

// 9. 20 格 id 表自身的一致性：四族 × 五阶、id 存在、tier 对得上、无重名
{
  const fids = ['p1', 'p2', 'p3', 'p4'];
  ok(Object.keys(FACTION_UNITS).length === 4, 'FACTION_UNITS 有且只有 4 个阵营');
  const all = [];
  let tierOk = true;
  let existOk = true;
  for (const f of fids) {
    const row = FACTION_UNITS[f];
    if (!row || row.length !== 5) { tierOk = false; continue; }
    row.forEach((id, i) => {
      all.push(id);
      const u = UNITS[id];
      if (!u) { existOk = false; return; }
      if (u.tier !== i + 1) tierOk = false;
      if (u.id !== id) existOk = false;
    });
  }
  ok(existOk, 'FACTION_UNITS 的 20 个 id 都在 UNITS 里、且 id 字段与键一致');
  ok(tierOk, 'FACTION_UNITS 每族的第 i 个 id 的 tier 正好是 i+1');
  ok(new Set(all).size === 20, '20 格 id 无重复');
  ok(all.every((id) => /^p[1-4]_[a-z]+$/.test(id)), '20 个 id 全部符合 p{n}_{shortname} 形式');
}

// 10. unitIdForTier：四族解析正确；中立方 / 未知 owner 返回 null（**不 fallback**）
{
  ok(unitIdForTier('p1', 1) === 'p1_lampbearer', 'unitIdForTier(p1,1) = p1_lampbearer');
  ok(unitIdForTier('p3', 4) === 'p3_treant', 'unitIdForTier(p3,4) = p3_treant');
  ok(unitIdForTier('p4', 5) === 'p4_colossus', 'unitIdForTier(p4,5) = p4_colossus');
  ok(unitIdForTier('p2', 3) === 'p2_wolfrider', 'unitIdForTier(p2,3) = p2_wolfrider');
  ok(unitIdForTier('neutral', 3) === null, 'unitIdForTier(neutral,3) = null（中立方不静默 fallback 到 p1）');
  ok(unitIdForTier('p9', 1) === null, 'unitIdForTier(未知阵营) = null');
  ok(unitIdForTier('p1', 6) === null, 'unitIdForTier(tier 越界) = null');
  // 关键回归：同一座兵营在四族里必须长出**不同**的兵（D-58 §6.4.4 的核心正确性风险）
  const tier3 = ['p1', 'p2', 'p3', 'p4'].map((f) => unitIdForTier(f, 3));
  ok(new Set(tier3).size === 4, '同一 tier=3 在四族解析出 4 个不同兵种（四族不再长同一种兵）');
}

// 11. LEGACY_UNIT_IDS：5 条、目标都存在、且目标不是旧词
{
  const pairs = Object.entries(LEGACY_UNIT_IDS);
  ok(pairs.length === 5, '别名表恰好 5 条（旧通用 5 级树）');
  ok(pairs.every(([, v]) => !!UNITS[v]), '别名表的每个目标都在 UNITS 里');
  ok(pairs.every(([, v]) => !LEGACY_UNIT_IDS[v]), '别名表没有链式指向（目标不再是旧 id）');
  ok(pairs.map(([k]) => k).sort().join(',') === 'angel,archer,knight,peasant,pikeman', '别名表的键正好是旧通用 5 级树');
  ok(LEGACY_UNIT_IDS['peasant'] === 'p1_lampbearer', 'peasant → p1_lampbearer');
  ok(LEGACY_UNIT_IDS['angel'] === 'p1_overangel', 'angel → p1_overangel');
}

// 12. 旧档迁移：4 个容器全部重映射、旧键清零、值不丢、幂等
{
  const legacySave = {
    heroes: {
      hero1: { army: [{ unitTypeId: 'archer', count: 20 }, { unitTypeId: 'angel', count: 2 }] },
    },
    towns: {
      town_home: {
        garrison: [{ unitTypeId: 'peasant', count: 10 }, { unitTypeId: 'wolf', count: 4 }],
        growthPool: { peasant: 12, archer: 5, wolf: 3 },
        growthRemainder: { archer: 0.75, ogre: 0.25 },
      },
    },
  };
  const rep = normalizeLegacyUnitIds(legacySave);
  ok(legacySave.heroes.hero1.army[0].unitTypeId === 'p1_hornxbow', 'army：archer → p1_hornxbow');
  ok(legacySave.heroes.hero1.army[1].unitTypeId === 'p1_overangel', 'army：angel → p1_overangel');
  ok(legacySave.towns.town_home.garrison[0].unitTypeId === 'p1_lampbearer', 'garrison：peasant → p1_lampbearer');
  ok(legacySave.towns.town_home.garrison[1].unitTypeId === 'wolf', 'garrison：野怪 wolf **不动**');
  ok(rep.stacks === 3, '报告 stacks=3（2 个 army + 1 个 garrison 条目）');

  const gp = legacySave.towns.town_home.growthPool;
  ok(gp['p1_lampbearer'] === 12 && gp['p1_hornxbow'] === 5, 'growthPool：旧键整体改名为新键、数值保留');
  ok(gp['peasant'] === undefined && gp['archer'] === undefined, 'growthPool：旧键已删除（无双份）');
  ok(gp['wolf'] === 3, 'growthPool：野怪键不动');

  const gr = legacySave.towns.town_home.growthRemainder;
  ok(gr['p1_hornxbow'] === 0.75 && gr['ogre'] === 0.25, 'growthRemainder：小数余数跟着 id 搬迁、不丢进度');
  ok(gr['archer'] === undefined, 'growthRemainder：旧键已删除');
  ok(rep.keys === 3, '报告 keys=3（growthPool 2 个 + growthRemainder 1 个；ogre 是野怪、不计）');

  // 幂等：再跑一次不得有任何改动
  const rep2 = normalizeLegacyUnitIds(legacySave);
  ok(rep2.stacks === 0 && rep2.keys === 0, '迁移是幂等的（第二次跑 0 改动）');

  // 迁移后每一个 id 都必须能被 getUnit 解析（这就是"不迁移就崩"的那一步）
  let allResolvable = true;
  for (const h of Object.values(legacySave.heroes)) for (const st of h.army) { try { getUnit(st.unitTypeId); } catch { allResolvable = false; } }
  for (const t of Object.values(legacySave.towns)) {
    for (const st of t.garrison) { try { getUnit(st.unitTypeId); } catch { allResolvable = false; } }
    for (const k of Object.keys(t.growthPool)) { try { getUnit(k); } catch { allResolvable = false; } }
  }
  ok(allResolvable, '迁移后所有 id 都能被 getUnit 解析（不再抛未知兵种）');
}

// 13. 键碰撞：旧 id 与新 id 同时存在时求和，不能覆盖
{
  const s = { towns: { t: { growthPool: { archer: 7, p1_hornxbow: 5 } } } };
  normalizeLegacyUnitIds(s);
  ok(s.towns.t.growthPool['p1_hornxbow'] === 12, '键碰撞时合并求和（7+5=12）而不是覆盖');
  ok(s.towns.t.growthPool['archer'] === undefined, '碰撞后旧键已删除');
}

// 14. 缺字段 / 空档不炸（更老的存档没有 growthRemainder，也没有 towns）
{
  ok(normalizeLegacyUnitIds({}).stacks === 0, '空对象迁移不炸');
  ok(normalizeLegacyUnitIds({ towns: { t: {} } }).keys === 0, '城镇缺 growthPool / growthRemainder 不炸');
  ok(normalizeLegacyUnitIds({ heroes: { h: {} } }).stacks === 0, '英雄缺 army 不炸');
}

// 15. 过渡态守卫：段 1 里旧 5 键必须**仍在** UNITS 里（这就是"零行为变化"的定义）
//     ⚠️ 段 2 删掉它们之后，本条要**改成反向断言**：旧 id 必须抛错、且报错含 canonical 名。
{
  const stillThere = Object.keys(LEGACY_UNIT_IDS).every((id) => !!UNITS[id]);
  ok(stillThere, '段1 过渡态：5 个旧键仍在 UNITS 里（段2 删除后本断言改为反向）');
  let threw = false;
  let msg = '';
  try { getUnit('__no_such_unit__'); } catch (e) { threw = true; msg = String(e.message); }
  ok(threw && msg.includes('未知兵种'), 'getUnit(未知 id) 抛错且报文含「未知兵种」');
}

// 16. 中立方永远不该有兵营建筑（D-58 §6.4.2 规则 5 的守卫）
//     现在这条路径不可达；将来谁让中立城能产兵，这里会先响。
{
  const g = createGame({ size: 'medium', seed: 7, opponents: 3 });
  const neutralWithDwell = Object.values(g.towns).filter(
    (t) => t.owner === 'neutral' && t.buildings.some((b) => /^dwell/.test(b)),
  );
  ok(neutralWithDwell.length === 0, '没有一座中立城拥有 dwell 建筑（unitIdForTier 的中立路径保持不可达）');
  const neutralProducing = Object.values(g.towns).filter(
    (t) => t.owner === 'neutral' && Object.keys(t.growthPool).length > 0,
  );
  ok(neutralProducing.length === 0, '没有一座中立城有非空 growthPool');
}

// 17. anim（近战表演风格）改为**数据驱动** —— races.md §6.4.2 规则 4 / §6.4.4 item 2
//     取值由 art-director 按「攻击肢剪影第一读法」逐兵种复核（D-63 批次）：
//       thrust = 直线纵深（长杆 / 前冲兽 / 独角）；smash = 垂直下压（重质剪影）；其余 slash。
{
  const EXPECT_ANIM = {
    // thrust
    p1_oathpike: 'thrust', p2_wolfrider: 'thrust', p3_unicorn: 'thrust',
    // smash
    p2_lavatroll: 'smash', p3_treant: 'smash', p4_hopgolem: 'smash', p4_colossus: 'smash',
    // slash（T1/T2 全部 8 个 + 其余 T3–T5）
    p1_lampbearer: 'slash', p1_hornxbow: 'slash', p1_templar: 'slash', p1_overangel: 'slash',
    p2_scavenger: 'slash', p2_axethrower: 'slash', p2_firebrand: 'slash',
    p3_dwarf: 'slash', p3_thornarcher: 'slash', p3_vineguard: 'slash',
    p4_stoneimp: 'slash', p4_fireapprentice: 'slash', p4_librarian: 'slash',
  };
  const allIds = Object.values(FACTION_UNITS).flat();
  ok(allIds.length === 20, 'canonical 兵种共 20 个（4 族 × T1–T5）');
  ok(allIds.every((id) => id in EXPECT_ANIM), '本断言表覆盖全部 20 个 canonical id');
  const mismatches = allIds
    .map((id) => [id, meleeStyleOf(id), EXPECT_ANIM[id]])
    .filter(([, got, want]) => got !== want)
    .map(([id, got, want]) => `${id}:${got}≠${want}`);
  ok(mismatches.length === 0,
    `20 个 canonical 的近战风格全部符合 art-director 复核（${mismatches.join(', ') || '全部一致'}）`);
  ok(allIds.every((id) => ['thrust', 'slash', 'smash'].includes(meleeStyleOf(id))),
    '所有 canonical 风格取值都在 {thrust,slash,smash} 内（不新增第 4 类）');
  // 缺省语义：未知 id → slash（旧 meleeStyle 的兜底）
  ok(meleeStyleOf('__no_such_unit__') === 'slash', 'meleeStyleOf(未知 id) 缺省 slash');
  ok(meleeStyleOf('peasant') === 'slash', 'legacy peasant 缺省 slash');
  // 零行为变化：旧 meleeStyle() 的 3 条显式判定必须原样保留（段 2 删键前）
  ok(meleeStyleOf('pikeman') === 'thrust', 'legacy pikeman 仍 thrust（旧 meleeStyle 行为保留）');
  ok(meleeStyleOf('ogre') === 'smash', '野怪 ogre 仍 smash（旧行为保留）');
  ok(meleeStyleOf('boar') === 'smash', '野怪 boar 仍 smash（旧行为保留）');
  ok(meleeStyleOf('wolf') === 'slash', '野怪 wolf 为 slash（旧行为保留）');
  // 契约：anim 挂在 UNITS 数据上（而不是靠 id 字面量 if 链）
  ok(UNITS.p1_oathpike.anim === 'thrust' && UNITS.p2_lavatroll.anim === 'smash'
    && UNITS.p3_unicorn.anim === 'thrust' && UNITS.p4_hopgolem.anim === 'smash',
    'anim 字段确实挂在 UNITS 上（数据驱动，非 id 字面量判断）');
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
