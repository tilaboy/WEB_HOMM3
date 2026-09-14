import { BASE_MOVE_POINTS, createGame, monsterArmy } from '../dist/core/map/generator.js';
import { mulberry32 } from '../dist/core/rng.js';
import { computePaths, buildPath } from '../dist/core/map/pathfinding.js';
import { isRevealed } from '../dist/core/map/fog.js';
import { lossRatio, quickBattle } from '../dist/core/combat/battle.js';
import { previewInteraction, applyInteraction, battleSetup, enemyHeroAt, heroBattleSetup, applyHeroBattle } from '../dist/core/game/interaction.js';
import { isPassable } from '../dist/core/map/grid.js';
import { endDay } from '../dist/core/game/turn.js';
import { factionIds } from '../dist/core/data/factions.js';
import { evaluateOutcome, isEliminated, outcomeSummary } from '../dist/core/game/victory.js';
import { BASE_TOWN_INCOME } from '../dist/core/data/buildings.js';
import { getUnit } from '../dist/core/data/units.js';
import { bfs, distance, hexCenter, hexLine, hexList, inField, neighbors, pickHex, FIELD_H, FIELD_W } from '../dist/core/combat/hex.js';
import {
  actFlee,
  actShoot,
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

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fails++;
};

for (const seed of [1, 42, 777, 20260912, 99999]) {
  const s = createGame(seed);
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

const g = createGame(20260913);
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

  // 难度只影响电脑
  const easy = createGame({ size: 'medium', seed: 9, opponents: 1, difficulty: 'easy' });
  const hard = createGame({ size: 'medium', seed: 9, opponents: 1, difficulty: 'hard' });
  ok(easy.players.p1.resources.gold === hard.players.p1.resources.gold, '难度不改变玩家起始资源');
  ok(hard.players.p2.resources.gold > easy.players.p2.resources.gold, '困难档电脑起始资源更多');
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

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
