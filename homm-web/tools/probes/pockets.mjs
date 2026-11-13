#!/usr/bin/env node
/**
 * pockets.mjs —— 封闭宝地（§18 / P0）的机检（`npm run probe:pockets`）。
 *
 * ## 它守什么
 * §18.4 的四条硬闸 + 一条负向对照，逐条落到读数上：
 *
 *   [G1] 每张图封闭块数 **≥3**（要装下 D1/D2/D3 各一块）。
 *   [G2] 每个块**块内奖励恰好 1 件**（不是 ≥1），且块内没有别的物件。
 *        量法：从奖励格洪水（禁走入口格），水量 == 内部格数；再数落在这个集合里的物件。
 *   [G3] 每个块**入口恰好 1 个**，且该格上是 `wanderingMonster`。
 *        量法：从奖励格洪水（禁走入口格），水量必须落在 **8~20**。多一格就是漏了 ——
 *        这条判据不数"门边有几个 8~20 格小区域"（生成后放的障碍会在门边圈出空壁龛，
 *        按那个数法会把壁龛当第二块口袋，实测 `BAD(18/20/770)` 全是假红）。
 *   [G4] 每张图 **D1/D2/D3 各 ≥1**，且同图内深度单调 `D1 ≤ D2 ≤ D3`。
 *        深度 = 入口格距最近主城的曼哈顿格数（生成器写进 `payload.pocketDist`）。
 *   [N1] `pockets:false` ⇒ 地图上**一个** `payload.pocket` 物件都没有。
 *   [G5] 同一张图里 `statBoost` 不许重样（§18.3 抽取规则 2）。
 *   [G6] 英雄出生格必须可通行 —— 外圈曾经能种树到英雄脚下（`blocked` 漏检），
 *        而 `audit:layout` 只会报"某座城走不到"，看起来不像口袋的错。
 *   [N3] **拆墙必漏**：随机挑一块口袋，拆掉它外圈的一件障碍，再从奖励格洪水；
 *        水量必须 **> 20**。这是 [G3] 尺子的负向对照 —— 如果拆了墙还量不出漏，
 *        说明洪水根本没穿过那圈墙，[G3] 的"8~20"就是白给的绿灯。
 *   [H1]–[H5] 属性物件（§21.8）的**行为**：领一次落实、每英雄一次、等级/金币两道闸。
 *        与 §18 同批交付（奖励表只有这一张），所以放在同一道门里。
 *
 * ## 读数口径
 * · 水位 8~20 是 §18.1 的硬指标，不是"差不多"。
 * · 深度只报实测值：小图（24×24 四家）全图最远空格只有 14~16 格，D3 的 16+ 落不下去，
 *   生成器会退到"这张图能给的最深处"。所以本门**不**断言 `D3 ≥ 16`，
 *   只断言三档单调 + 打印三档真实区间（要改这条得先改规格，不是改阈值）。
 *
 * ## 负向对照（复跑手册）
 * · `POCKET_MIN_CELLS` 改 12 ⇒ [G3] 红（现存 8~11 格的块全部"漏"）；
 * · 生成器里的 `oneDoor` 恒真 ⇒ [N3] 仍绿但 [G3] 会红（墙缺一口的块被放过）；
 * · 奖励改成"每档抽 2 件" ⇒ [G2] 红；
 * · 把 `payload.pocket` 从守卫身上去掉 ⇒ [G1]/[G4] 红（守卫不再被认作口袋）；
 * · `pockets:false` 时仍生成 ⇒ [N1] 红。
 *
 * 用法：`node tools/probes/pockets.mjs` / `SEEDS=5` / `--size=small`
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足
 */
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=pockets');
const u = (rel) => distUrl(rel, DIST);
requireFile(DIST, 'core/map/generator.js');
requireFile(DIST, 'core/map/grid.js');
requireFile(DIST, 'core/data/pocketRewards.js');
requireFile(DIST, 'core/data/statBoosts.js');
requireFile(DIST, 'core/game/interaction.js');

const { createGame } = await import(u('core/map/generator.js'));
const { isPassable } = await import(u('core/map/grid.js'));
const { pocketRewardTable, POCKET_TIERS } = await import(u('core/data/pocketRewards.js'));
const { STAT_BOOSTS, STAT_BOOST_IDS } = await import(u('core/data/statBoosts.js'));
const I = await import(u('core/game/interaction.js'));

const LAYOUTS = ['wild', 'ring', 'islands', 'lanes'];
const SIZES = ['small', 'medium', 'large', 'huge'];
const TIERS = ['D1', 'D2', 'D3'];
const POCKET_MIN_CELLS = 8;
const POCKET_MAX_CELLS = 20;

const onlySize = (process.argv.find((a) => a.startsWith('--size=')) ?? '').slice(7) || null;
if (onlySize && !SIZES.includes(onlySize)) {
  console.error(`✗ 未知尺寸「${onlySize}」—— 可选：${SIZES.join(' / ')}`);
  process.exit(2);
}
const seeds = Math.max(1, Number(process.env.SEEDS ?? 3));

let bad = 0;
const PASS = (c, m) => {
  if (!c) bad += 1;
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`);
};
const HEAD = (t) => console.log(`\n== ${t} ==`);

/* ---------------- 量具 ---------------- */

/** 4 邻域洪水；`ban` = 不许踩的那一格（入口）。 */
function flood(map, start, ban = -1) {
  const W = map.width;
  const H = map.height;
  const seen = new Uint8Array(W * H);
  const s = start.y * W + start.x;
  if (s === ban || !isPassable(map, start.x, start.y)) return seen;
  seen[s] = 1;
  const q = [s];
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    const x = i % W;
    const y = (i / W) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (j === ban || seen[j] || !isPassable(map, nx, ny)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}
const wet = (m) => {
  let n = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) n += 1;
  return n;
};

/** 奖励池的键：同一件东西在池里和地图上形状不同，比较前先归一。 */
const poolKey = (r) =>
  r.kind === 'mine' ? `mine:${r.resource}`
  : r.kind === 'statBoost' ? `stat:${r.boostId}`
  : r.kind === 'vault' ? `vault:${r.tier}`
  : r.kind;
const objKey = (o) =>
  o.kind === 'mine' ? `mine:${o.payload.resource}`
  : o.kind === 'statBoost' ? `stat:${o.payload.boostId}`
  : o.kind === 'vault' ? `vault:${o.payload.tier}`
  : o.kind;

const POOL = Object.fromEntries(TIERS.map((t) => [t, new Set(pocketRewardTable(t).map((e) => poolKey(e.reward)))]));

/** 一张图的口袋读数。 */
function survey(state) {
  const objs = Object.values(state.map.objects);
  const guards = objs.filter((o) => o.kind === 'wanderingMonster' && o.payload?.pocket);
  const tagged = objs.filter((o) => o.payload?.pocket);
  const rewards = tagged.filter((o) => o.kind !== 'wanderingMonster');
  const W = state.map.width;
  const rows = [];
  for (const t of TIERS) {
    const gs = guards.filter((o) => o.payload.pocket === t);
    for (const g of gs) {
      const kill = state.map.tiles[g.pos.y * W + g.pos.x]?.objectId;
      const rw = rewards.filter((o) => o.payload.pocket === t);
      const inside = rw.length === 1 ? flood(state.map, rw[0].pos, g.pos.y * W + g.pos.x) : null;
      rows.push({
        tier: t,
        guardId: g.id,
        guardPos: g.pos,
        guardOnTile: kill === g.id,
        guardKind: g.kind,
        rewardCount: rw.length,
        reward: rw[0] ?? null,
        insideSize: inside ? wet(inside) : -1,
        inside,
        dist: g.payload.pocketDist ?? -1,
        extras: inside
          ? objs.filter((o) => o.id !== rw[0]?.id && inside[o.pos.y * W + o.pos.x] === 1).map((o) => o.kind)
          : [],
      });
    }
  }
  return { guards, tagged, rewards, rows, W, heroes: Object.values(state.heroes) };
}

/* ---------------- 跑图 ---------------- */

const stat = {
  maps: 0,
  g1Min: Infinity,
  g1Bad: [],
  shapeBad: [],
  rewardBad: [],
  extraBad: [],
  poolBad: [],
  guardBad: [],
  spawnBad: [],
  n1Bad: [],
  dupBoost: [],
  n3Runs: 0,
  n3Bad: [],
  n3Natural: [],
  dist: { D1: [], D2: [], D3: [] },
  orderBad: [],
};

for (const size of SIZES) {
  if (onlySize && size !== onlySize) continue;
  for (const layout of LAYOUTS) {
    for (let s = 0; s < seeds; s++) {
      const seed = 9100 + s * 977;
      const tag = `${layout}/${size}/${seed}`;
      stat.maps += 1;
      const st = createGame({ seed, layout, size, opponents: 3 });
      const sv = survey(st);
      const n = sv.guards.length;
      stat.g1Min = Math.min(stat.g1Min, n);

      // [G1]
      if (n < 3) stat.g1Bad.push(`${tag} 块数=${n}`);
      // [G4] 每档恰好 1 块
      for (const t of TIERS) {
        const c = sv.guards.filter((o) => o.payload.pocket === t).length;
        if (c !== 1) stat.orderBad.push(`${tag} ${t} 数量=${c}`);
      }

      for (const r of sv.rows) {
        stat.dist[r.tier].push(r.dist);
        // [G3] 入口格上真有守卫
        if (!r.guardOnTile || r.guardKind !== 'wanderingMonster') stat.guardBad.push(`${tag} ${r.tier}`);
        // [G2] 恰好 1 件奖励
        if (r.rewardCount !== 1) {
          stat.rewardBad.push(`${tag} ${r.tier} 奖励=${r.rewardCount}`);
          continue;
        }
        // [G2] 奖励来自本档池
        if (!POOL[r.tier].has(objKey(r.reward))) {
          stat.poolBad.push(`${tag} ${r.tier} ${objKey(r.reward)} ∉ 池`);
        }
        // [G3] 水量 8~20
        if (r.insideSize < POCKET_MIN_CELLS || r.insideSize > POCKET_MAX_CELLS) {
          stat.shapeBad.push(`${tag} ${r.tier} 内部=${r.insideSize}`);
        }
        // [G2] 块内没有别的物件
        if (r.extras.length) stat.extraBad.push(`${tag} ${r.tier} ${r.extras.join(',')}`);
      }

      // [G4] 深度单调
      const d = {};
      for (const t of TIERS) d[t] = sv.rows.find((r) => r.tier === t)?.dist ?? -1;
      if (!(d.D1 <= d.D2 && d.D2 <= d.D3)) {
        stat.orderBad.push(`${tag} 深度不单调 D1=${d.D1} D2=${d.D2} D3=${d.D3}`);
      }

      // [N1] 只跑第一颗种子，省时间
      if (s === 0) {
        const off = createGame({ seed, layout, size, opponents: 3, pockets: false });
        const offTagged = Object.values(off.map.objects).filter((o) => o.payload?.pocket);
        if (offTagged.length) stat.n1Bad.push(`${tag} 关掉后仍有 ${offTagged.length} 件`);
      }

      // [G5] 同一张图里 statBoost 不许重样（§18.3 抽取规则 2）
      const boosts = sv.rewards.filter((o) => o.kind === 'statBoost').map((o) => o.payload.boostId);
      if (new Set(boosts).size !== boosts.length) {
        stat.dupBoost.push(`${tag} ${boosts.join(',')}`);
      }

      /**
       * [G6] 英雄出生格必须站着人。
       *
       * 口袋的**外圈**曾经漏掉 `blocked` 这一档：出生格在引擎里不是 `MapObject`
       * （`objectId` 为空），于是墙可以种在英雄脚下 —— 棋子整局动不了，而且
       * `audit:layout` 报的是"某座城走不到"，看起来完全不像口袋的错
       * （实测 wild small seed 70453 的 `hero_p3`）。这条断言把因果钉在门口。
       */
      for (const h of sv.heroes) {
        if (!isPassable(st.map, h.pos.x, h.pos.y)) {
          const id = st.map.tiles[h.pos.y * sv.W + h.pos.x]?.objectId;
          stat.spawnBad.push(`${tag} ${h.id} 脚下是 ${id ? st.map.objects[id]?.kind : '地形'}`);
        }
      }

      // [N3] 拆一块墙，必须漏。天然洞穴（外圈全是山/水，没有可拆的障碍）换一块再试
      let measured = false;
      let natural = false;
      for (const row of sv.rows) {
        if (!row.inside || row.insideSize < POCKET_MIN_CELLS || row.insideSize > POCKET_MAX_CELLS) continue;
        const r = tryBreakOneWall(st, row);
        if (r === null) {
          natural = true;
          continue;
        }
        measured = true;
        stat.n3Runs += 1;
        if (!(r > POCKET_MAX_CELLS)) stat.n3Bad.push(`${tag} ${row.tier} 拆墙后仅 ${r} 格`);
        break;
      }
      if (natural && !measured) stat.n3Natural.push(tag);
      if (!measured && !natural) stat.n3Bad.push(`${tag} 没有可量的块`);
    }
  }
}

/**
 * 拆掉这块口袋外圈的一件障碍，再从奖励格洪水。
 * 返回新水量；`null` = 找不到"拆了会通向外面"的那一格（外圈全是山/水）。
 */
function tryBreakOneWall(state, row) {
  const W = state.map.width;
  const inside = row.inside;
  const gate = row.guardPos;
  const rim = [];
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i]) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= state.map.width || ny >= state.map.height) continue;
      const j = ny * W + nx;
      if (inside[j]) continue;
      if (nx === gate.x && ny === gate.y) continue;
      const id = state.map.tiles[j]?.objectId;
      if (!id) continue;
      const o = state.map.objects[id];
      if (!o || o.kind !== 'obstacle') continue;
      rim.push({ j, id });
    }
  }
  for (const c of rim.slice(0, 4)) {
    const t = state.map.tiles[c.j];
    const o = state.map.objects[c.id];
    if (!o) continue;
    // 临时拆除（只改这份内存里的地图，不落地）
    delete state.map.objects[c.id];
    t.objectId = null;
    const after = wet(flood(state.map, row.reward.pos, gate.y * W + gate.x));
    // 还原
    state.map.objects[c.id] = o;
    t.objectId = c.id;
    if (after > POCKET_MAX_CELLS) return after;
  }
  return null;
}

/* ---------------- H · 属性物件的行为（§21.8） ---------------- */

const hIssues = [];
{
  // 9 种定义必须都被某一档的池子引用（"没有对象"与"有对象量不到"要分开）
  const inPools = new Set();
  for (const t of TIERS) {
    for (const e of pocketRewardTable(t)) if (e.reward.kind === 'statBoost') inPools.add(e.reward.boostId);
  }
  for (const id of STAT_BOOST_IDS) if (!inPools.has(id)) hIssues.push(`H0 ${id} 不在任何一档的池里`);

  // 找一张真的有 statBoost 的图（找不到要单独报，不能当成 0 分通过）
  let hit = null;
  for (const size of ['small', 'medium']) {
    for (const layout of LAYOUTS) {
      for (const seed of [9100, 10077, 11054, 12031]) {
        if (hit) break;
        const st = createGame({ seed, layout, size, opponents: 3 });
        const o = Object.values(st.map.objects).find((x) => x.kind === 'statBoost');
        if (o) hit = { st, o };
      }
    }
  }
  if (!hit) {
    hIssues.push('H0 16 张图里一件 statBoost 都没有（口袋奖励没落到属性物件上）');
  } else {
    const { st, o } = hit;
    const hero = Object.values(st.heroes).find((x) => x.owner === 'p1');
    const bag = st.players.p1.resources;
    const snap = () => ({ ...hero.primary, level: hero.level, gold: bag.gold });
    const use = (id) => {
      o.payload.boostId = id;
      o.visitedBy = [];
    };
    const apply = () => I.applyInteraction(st, hero.id, o.id, true);

    // H1 领一次：属性真的加上、记名
    use('camp_attack');
    let a = snap();
    const r1 = apply();
    if (hero.primary.attack !== a.attack + 1) hIssues.push(`H1 攻击 ${a.attack}→${hero.primary.attack}（应 +1）`);
    if (!o.visitedBy.includes(hero.id)) hIssues.push('H1 visitedBy 没记下英雄 id');
    if (!r1.title) hIssues.push('H1 没返回标题');

    // H2 每英雄一次：不弹框、不再加、物件不移除
    a = snap();
    if (I.previewInteraction(st, hero.id, o.id) !== null) hIssues.push('H2 第二次访问仍弹框');
    apply();
    if (hero.primary.attack !== a.attack) hIssues.push('H2 第二次访问仍加属性');
    if (!st.map.objects[o.id]) hIssues.push('H2 物件被移除了（应原地保留）');
    if (I.pendingObjectAt(st, hero.id)?.objId === o.id) hIssues.push('H2 仍被列为待处理交互');

    // H3 等级闸（智者图书馆需 10 级）
    use('library');
    a = snap();
    const r3 = apply();
    if (!/10 级/.test(r3.message)) hIssues.push(`H3 等级不足没提示（msg=${r3.message.slice(0, 24)}）`);
    if (hero.primary.knowledge !== a.knowledge) hIssues.push('H3 等级不足却加了属性');
    if (o.visitedBy.length) hIssues.push('H3 等级不足却记了名（以后就再也领不到了）');

    // H4 金币闸（斗士学院 1000 金）
    use('fighters_guild');
    bag.gold = 0;
    const r4 = apply();
    if (!/付不起/.test(r4.message)) hIssues.push(`H4 金币不足没提示（msg=${r4.message.slice(0, 24)}）`);
    if (bag.gold !== 0) hIssues.push('H4 金币不足却扣了钱');
    if (o.visitedBy.length) hIssues.push('H4 金币不足却记了名');

    // H5 付得起：扣钱 + 加属性
    use('fighters_guild');
    bag.gold = 5000;
    a = snap();
    apply();
    if (bag.gold !== a.gold - 1000) hIssues.push(`H5 金币 ${a.gold}→${bag.gold}（应 -1000）`);
    if (hero.primary.attack !== a.attack + 1) hIssues.push('H5 斗士学院没加攻击');

    // H6 智慧树：+1 级 + 扣 2000
    use('wisdom_tree');
    bag.gold = 5000;
    a = snap();
    apply();
    if (hero.level !== a.level + 1) hIssues.push(`H6 等级 ${a.level}→${hero.level}（应 +1）`);
    if (bag.gold !== a.gold - 2000) hIssues.push(`H6 金币 ${a.gold}→${bag.gold}（应 -2000）`);
  }
}

/* ---------------- 断言 ---------------- */

HEAD('G1 · 每张图 ≥3 块');
PASS(stat.maps > 0 && stat.g1Min >= 3, `${stat.maps} 张图，最少 ${stat.g1Min} 块/图`);
for (const m of stat.g1Bad.slice(0, 6)) console.log(`       · ${m}`);

HEAD('G4 · 每张图 D1/D2/D3 各 1 块，深度单调');
PASS(stat.orderBad.length === 0, `档位数量/单调：${stat.orderBad.length} 处异常`);
for (const m of stat.orderBad.slice(0, 6)) console.log(`       · ${m}`);

HEAD('G3 · 入口恰好 1 个，且守卫站在入口格上');
PASS(stat.guardBad.length === 0, `守卫位置：${stat.guardBad.length} 处异常`);
PASS(stat.shapeBad.length === 0, `内部水量 ∈ [8,20]：${stat.shapeBad.length} 处越界`);
for (const m of stat.guardBad.slice(0, 4)) console.log(`       · ${m}`);
for (const m of stat.shapeBad.slice(0, 4)) console.log(`       · ${m}`);

HEAD('G2 · 块内奖励恰好 1 件、来自本档池、无其它物件');
PASS(stat.rewardBad.length === 0, `奖励数 = 1：${stat.rewardBad.length} 处异常`);
PASS(stat.poolBad.length === 0, `奖励 ∈ 本档池：${stat.poolBad.length} 处越池`);
PASS(stat.extraBad.length === 0, `块内无杂物件：${stat.extraBad.length} 处`);
for (const m of [...stat.rewardBad, ...stat.poolBad, ...stat.extraBad].slice(0, 6)) console.log(`       · ${m}`);

HEAD('G6 · 英雄出生格没被墙埋');
PASS(stat.spawnBad.length === 0, `出生格不可通行：${stat.spawnBad.length} 处`);
for (const m of stat.spawnBad.slice(0, 6)) console.log(`       · ${m}`);

HEAD('N1 · 关掉 pockets ⇒ 0 件（唯一的防伪）');
PASS(stat.n1Bad.length === 0, `pockets:false 后残留：${stat.n1Bad.length} 处`);
for (const m of stat.n1Bad.slice(0, 6)) console.log(`       · ${m}`);

HEAD('N3 · 拆一块墙必须漏出去（G3 尺子的负向对照）');
PASS(
  stat.n3Runs > 0 && stat.n3Bad.length === 0,
  `可拆墙 ${stat.n3Runs} 次全部漏水，异常 ${stat.n3Bad.length} 次；天然洞穴（外圈无墙）${stat.n3Natural.length} 张图改试下一块`,
);
for (const m of stat.n3Bad.slice(0, 6)) console.log(`       · ${m}`);

HEAD('G5 · 同一张图 statBoost 不重样');
PASS(stat.dupBoost.length === 0, `重复：${stat.dupBoost.length} 处`);
for (const m of stat.dupBoost.slice(0, 6)) console.log(`       · ${m}`);

HEAD('H · 属性物件行为（§21.8：领一次 / 每英雄一次 / 两道闸）');
PASS(hIssues.length === 0, `H0–H6：${hIssues.length} 处异常`);
for (const m of hIssues.slice(0, 8)) console.log(`       · ${m}`);

HEAD('读数（不作断言，供设计参考）');
const rng = (a) => (a.length ? `${Math.min(...a)}~${Math.max(...a)}（均 ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)}，n=${a.length}）` : '—');
for (const t of TIERS) {
  console.log(`  ${t} 距最近主城 ${rng(stat.dist[t])}  · 规格 ${POCKET_TIERS[t].minDist}~${POCKET_TIERS[t].maxDist === 999 ? '∞' : POCKET_TIERS[t].maxDist}`);
}
console.log('  ⚠ 小图（24×24 四家）全图最远空格只有 14~16 格 ⇒ D3 的 16+ 落不下去，只能取"这张图能给的最深处"。');

console.log('');
console.log(bad === 0 ? `✓ 全过（${stat.maps} 张图）` : `✗ ${bad} 条断言不过`);
process.exit(bad === 0 ? 0 : 1);
