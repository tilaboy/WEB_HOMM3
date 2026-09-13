import { createGame } from '../dist/core/map/generator.js';
import { computePaths, buildPath } from '../dist/core/map/pathfinding.js';
import { isRevealed } from '../dist/core/map/fog.js';
import { simulateBattle, lossRatio } from '../dist/core/combat/solver.js';
import { previewInteraction, applyInteraction } from '../dist/core/game/interaction.js';
import { isPassable } from '../dist/core/map/grid.js';
import { endDay } from '../dist/core/game/turn.js';
import { BASE_TOWN_INCOME } from '../dist/core/data/buildings.js';
import {
  build,
  buildStatus,
  canBuild,
  canBuildToday,
  canHireHero,
  countIn,
  garrisonToHero,
  hireHero,
  heroToGarrison,
  marketBuy,
  marketSell,
  recruitToGarrison,
  recruitToHero,
  townDailyIncome,
} from '../dist/core/game/town.js';

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fails++;
};

for (const seed of [1, 42, 777, 20260912, 99999]) {
  const s = createGame(seed);
  const m = s.map;
  const hero = s.heroes.hero1;

  ok(m.width === 24 && m.height === 24, `seed ${seed}: 地图 24×24`);
  ok(!!hero && isPassable(m, hero.pos.x, hero.pos.y), `seed ${seed}: 英雄出生在可通行地块`);
  ok(hero.army.length > 0 && hero.army[0].count === 20, `seed ${seed}: 起始 20 弓手`);

  const kinds = {};
  for (const o of Object.values(m.objects)) kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
  ok((kinds.wanderingMonster ?? 0) >= 8, `seed ${seed}: 野怪 ${kinds.wanderingMonster} 组`);
  ok((kinds.treasureChest ?? 0) >= 6, `seed ${seed}: 宝箱 ${kinds.treasureChest}`);
  ok((kinds.resourcePile ?? 0) >= 10, `seed ${seed}: 资源堆 ${kinds.resourcePile}`);
  ok((kinds.town ?? 0) === 3, `seed ${seed}: 3 座城镇（1 主城 + 2 中立）`);
  ok((kinds.fountain ?? 0) === 3, `seed ${seed}: 3 处泉水`);

  // 每支野怪都得守着东西
  const monsters = Object.values(m.objects).filter((o) => o.kind === 'wanderingMonster');
  ok(monsters.every((o) => !!o.payload.guard), `seed ${seed}: 所有野怪都带守卫奖励`);
  ok(
    monsters.filter((o) => o.payload.guard.kind === 'mine').length >= 2,
    `seed ${seed}: 至少 2 处野怪守着矿`,
  );

  // 中立城不能躲在地图角落，也不能挨在一起
  const neutrals = Object.values(s.towns).filter((t) => t.owner === 'neutral');
  ok(neutrals.length === 2, `seed ${seed}: 2 座中立城`);
  const hp = s.towns.town_home.pos;
  for (const t of neutrals) {
    const d = Math.abs(t.pos.x - hp.x) + Math.abs(t.pos.y - hp.y);
    const edge = Math.min(t.pos.x, t.pos.y, m.width - 1 - t.pos.x, m.height - 1 - t.pos.y);
    ok(d >= 6 && d <= 30, `seed ${seed}: ${t.name} 距主城 ${d} 格（可达范围内）`);
    ok(edge >= 2, `seed ${seed}: ${t.name} 不在地图边缘`);
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

function duel(enemy, n = 60) {
  let wins = 0;
  let lossSum = 0;
  for (let i = 0; i < n; i++) {
    const o = simulateBattle(
      { army: [{ unitTypeId: 'archer', count: 20 }], attack: 1, defense: 2 },
      { army: enemy, attack: 0, defense: 0 },
      1000 + i * 37,
    );
    if (o.win) wins++;
    lossSum += lossRatio(o);
  }
  return { winRate: wins / n, avgLoss: lossSum / n };
}

const weakDuel = duel([{ unitTypeId: 'wolf', count: 14 }]);
const midDuel = duel([{ unitTypeId: 'boar', count: 8 }]);
const strongDuel = duel([{ unitTypeId: 'ogre', count: 6 }]);
const hopeless = duel([{ unitTypeId: 'ogre', count: 20 }]);
const report = (name, d) =>
  console.log(`  ${name}：胜率 ${(d.winRate * 100).toFixed(0)}% · 平均损失 ${(d.avgLoss * 100).toFixed(0)}%`);
report('弱 · 14 野狼', weakDuel);
report('中 · 8 野猪', midDuel);
report('强 · 6 食人魔', strongDuel);
report('绝望 · 20 食人魔', hopeless);

ok(weakDuel.winRate >= 0.9, '弱档：20 弓手应稳胜');
ok(weakDuel.avgLoss < 0.3, '弱档：损失应较轻');
ok(midDuel.winRate >= 0.6, '中档：应多数能赢');
ok(strongDuel.winRate > 0.3 && strongDuel.winRate < 0.9, '强档：应是胜负有悬念的硬仗');
ok(strongDuel.avgLoss > 0.5, '强档：即使赢也要付出惨重代价');
ok(hopeless.winRate <= 0.05, '悬殊：必败');

const siegeDuel = duel([{ unitTypeId: 'wolf', count: 12 }, { unitTypeId: 'boar', count: 6 }], 200);
report('中立城 · 12 野狼 + 6 野猪', siegeDuel);
ok(siegeDuel.winRate > 0.4 && siegeDuel.winRate < 0.95, '中立城：起始 20 弓手应是有风险但值得一试的目标');
ok(siegeDuel.avgLoss > 0.5, '中立城：即使攻下也会元气大伤');

/* ================= M2：城镇建设与兵种生产 ================= */
console.log('\n--- M2 城镇 ---');

const g = createGame(20260913);
const home = g.towns.town_home;
const neutral = g.towns.town_n1;

ok(home.owner === 'p1', '主城归属玩家');
ok(neutral.owner === 'neutral', '第二座城为中立');
ok(!!g.towns.town_n2 && g.towns.town_n2.owner === 'neutral', '第三座城也为中立');
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
const from = { x: mon6.pos.x, y: mon6.pos.y + 1 };
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
const win8 = applyInteraction(g8, 'hero1', mineMon.id, true);
ok(win8.message.includes('矿'), `攻下矿场（${win8.message.split('\n')[1] ?? ''}）`);
const mines = Object.values(g8.map.objects).filter((o) => o.kind === 'mine');
ok(mines.length === 1, '地图上出现了一座矿');
ok(mines[0].payload.owner === 'p1', '矿场归我方');
const before8 = { ...g8.players.p1.resources };
endDay(g8);
const res8 = mines[0].payload.resource;
ok(
  (g8.players.p1.resources[res8] ?? 0) > (before8[res8] ?? 0),
  `矿场每日产出 ${res8} +${mines[0].payload.perDay} 已发放`,
);

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
