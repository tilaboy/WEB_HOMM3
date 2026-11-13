#!/usr/bin/env node
/**
 * outbreak.mjs —— 周地图爆发（§19.3 / EV2）的机检（`npm run probe:outbreak`）。
 *
 * ## 它守什么
 * EV2 是**没有 H3 参照**的新玩法（H3 的"某生物周"只翻倍产量，不刷怪），
 * 所以每条规则都必须带读数，尤其是那三条"一改就变成软锁/堵死"的红线：
 *
 *   [A] 地形够不够（原报表，现在是门）：wild/ring × 4 尺寸，每张图
 *       `lost > 0` 的必经格 ≥ 8、其中小口袋门（`lost ≤ 40`）≥ 2。
 *   [B] 规则本体（直接调 `core/game/outbreak.ts`，不跑 AI，读数干净）：
 *       · 第 1~2 周不掷、也不创建 `state.outbreak`；
 *       · W3 周首预告 **4 栈**、日期 = 本周三（day 17）、文案带群名；
 *       · 到那天落地 4 栈，`payload.outbreak === true`、`guard` 必须 undefined；
 *       · 落点红线：**每一个**落点重算 `lost ≤ 40`、距最近英雄 ≥ 1 天、口袋里没有城；
 *       · 不重复落地（`lastDay` 闸）；W4 只落 4（上限 8 − 已有 4）；
 *       · W5 周首已满 ⇒ 不预告，日志写"路上已满"；
 *       · 同种子两臂：落点 / 兵种 / 数量**逐字节一致**。
 *   [C] 负向对照（三条，全部是"把阈值改坏必须立刻红"）：
 *       · C1 `maxLost = Infinity` ⇒ 候选里出现 `lost > 40`（red line 真的有活干）；
 *       · C2 `plan` 里加 W6 ⇒ W6 能落 6（"W5 之后不刷"来自表，不是硬编码）；
 *       · C3 `cap = Infinity` ⇒ 三周共 15 栈（上限压缩是真的）。
 *   [D] 债的结算：打掉 1 栈 ⇒ 金币 +0、格子恢复可通行、`spawned` 不回收；
 *       剩下的栈在下一周**仍在原地**（"打死才消失"）。
 *   [E] 接线（真 `endDay`）：连跑 21 天，W3 那天真的落了 4 栈、日志里有预警。
 *
 * ## 复跑手册（负向对照）
 * · `POCKET_MAX_LOST` 改成 400 ⇒ [B3] 红（ring 图会挑到大切断）；
 * · 去掉 `homes[i] >= minHome` ⇒ [B4] 红；
 * · `spawnOutbreak` 去掉 `lastDay` 闸 ⇒ [B6] 红（同一周落两遍）；
 * · `OUTBREAK_PLAN` 加 `6: 6` ⇒ [B9] 红；
 * · `OUTBREAK_CAP` 改成 99 ⇒ [B7] 红（W5 会落 6 而不是判满）。
 *
 * 用法：SEEDS=3 node tools/probes/outbreak.mjs [size]
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足（缺 dist）
 */
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=outbreak');
const dimp = (rel) => distUrl(rel, DIST);
for (const f of [
  'core/map/generator.js',
  'core/map/grid.js',
  'core/game/outbreak.js',
  'core/game/calendar.js',
  'core/game/interaction.js',
  'core/game/turn.js',
]) {
  requireFile(DIST, f);
}

const { createGame } = await import(dimp('core/map/generator.js'));
const { isPassable, idx } = await import(dimp('core/map/grid.js'));
const O = await import(dimp('core/game/outbreak.js'));
const CAL = await import(dimp('core/game/calendar.js'));
const { applyInteraction } = await import(dimp('core/game/interaction.js'));
const { endDay } = await import(dimp('core/game/turn.js'));

let bad = 0;
const PASS = (c, m) => {
  if (!c) bad++;
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`);
};
const HEAD = (t) => console.log(`\n== ${t} ==`);
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ---------------- 共用量法 ---------------- */

/** 4 邻域洪水填充；`ban` = 临时视为不可通行的一格。 */
function flood(map, starts, ban = -1) {
  const W = map.width;
  const H = map.height;
  const seen = new Uint8Array(W * H);
  const q = [];
  for (const p of starts) {
    const i = p.y * W + p.x;
    if (i === ban || seen[i]) continue;
    if (!isPassable(map, p.x, p.y)) continue;
    seen[i] = 1;
    q.push(i);
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    if (i === ban) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (j === ban || seen[j]) continue;
      if (!isPassable(map, nx, ny)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}
function count(seen) {
  let n = 0;
  for (let i = 0; i < seen.length; i++) if (seen[i]) n += 1;
  return n;
}

/** 堵上 (x,y) 之后走不到的格数（与 `outbreak.ts` 同一口径：英雄起点为源）。 */
function lostAt(state, pos) {
  const starts = Object.values(state.heroes).map((h) => h.pos);
  if (!starts.length) return -1;
  const base = flood(state.map, starts);
  const reach = count(base);
  const cut = flood(state.map, starts, idx(state.map, pos.x, pos.y));
  return reach - count(cut) - 1;
}

/**
 * 距任何英雄的**移动力**代价（不是曼哈顿格数）。
 * 直接复用模块里的 `outbreakCandidates` 太重；这里用一个够用的近似会失真，
 * 所以老实调 `costFieldFromMap`。
 */
const { costFieldFromMap } = await import(dimp('core/map/pathfinding.js'));
function homeCost(state, pos) {
  let best = Infinity;
  for (const h of Object.values(state.heroes)) {
    const f = costFieldFromMap(state.map, h.pos);
    const c = f.cost[idx(state.map, pos.x, pos.y)];
    if (c < best) best = c;
  }
  return best;
}

const stacksOf = (state) =>
  Object.values(state.map.objects).filter(
    (o) => o.kind === 'wanderingMonster' && o.payload?.outbreak === true,
  );

/* ---------------- A. 地形门槛 ---------------- */

const SIZES = ['small', 'medium', 'large', 'huge'];
const LAYOUTS = ['wild', 'ring'];
const onlySize = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (onlySize && !SIZES.includes(onlySize)) {
  console.error(`✗ 未知尺寸「${onlySize}」—— 可选：${SIZES.join(' / ')}`);
  process.exit(2);
}
const seeds = Number(process.env.SEEDS ?? 3);

HEAD('A. 地形：必经格够不够（wild/ring × 4 尺寸）');
console.log('布局   尺寸    可达格  必经格  小口袋门  大切断  含城切断  结论');

let terrainBad = 0;
for (const size of SIZES) {
  if (onlySize && size !== onlySize) continue;
  for (const layout of LAYOUTS) {
    let reachSum = 0;
    let passSum = 0;
    let pocketGateSum = 0;
    let bigCutSum = 0;
    let castleCutSum = 0;
    let runs = 0;
    for (let s = 0; s < seeds; s++) {
      const seed = 9100 + s * 977;
      const state = createGame({ seed, layout, size, opponents: 3 });
      const map = state.map;
      const W = map.width;
      const H = map.height;
      const starts = Object.values(state.heroes).map((h) => h.pos);
      const base = flood(map, starts);
      const reach = count(base);

      const castleCells = new Set();
      for (const obj of Object.values(map.objects)) {
        if (obj.kind !== 'town') continue;
        for (const c of obj.footprint ?? [obj.pos]) castleCells.add(c.y * W + c.x);
      }

      let pass = 0;
      let pocketGate = 0;
      let bigCut = 0;
      let castleCut = 0;
      for (let i = 0; i < W * H; i++) {
        if (!base[i]) continue;
        const x = i % W;
        const y = (i / W) | 0;
        if (!isPassable(map, x, y)) continue;
        if (map.tiles[i].objectId) continue;
        const cut = flood(map, starts, i);
        const lost = reach - count(cut) - 1;
        if (lost <= 0) continue;
        pass += 1;
        if (lost <= 40) pocketGate += 1;
        else {
          bigCut += 1;
          let hit = false;
          for (const c of castleCells) {
            if (!cut[c] && base[c]) {
              hit = true;
              break;
            }
          }
          if (hit) castleCut += 1;
        }
      }
      reachSum += reach;
      passSum += pass;
      pocketGateSum += pocketGate;
      bigCutSum += bigCut;
      castleCutSum += castleCut;
      runs += 1;
    }
    const reach = Math.round(reachSum / runs);
    const pass = passSum / runs;
    const gate = pocketGateSum / runs;
    const big = bigCutSum / runs;
    const ccut = castleCutSum / runs;
    const ok = pass >= 8 && gate >= 2;
    if (!ok) terrainBad += 1;
    console.log(
      `${layout.padEnd(6)} ${size.padEnd(6)} ${String(reach).padStart(6)}  ${pass.toFixed(1).padStart(6)}  ${gate.toFixed(1).padStart(8)}  ${big.toFixed(1).padStart(6)}  ${ccut.toFixed(1).padStart(8)}  ${ok ? '可落点充足' : '★ 必经格不足'}`,
    );
  }
}
PASS(terrainBad === 0, `A1 每张图的必经格 ≥8 且小口袋门 ≥2（${terrainBad} 组不达标）`);

/* ---------------- B. 规则本体 ---------------- */

HEAD('B. 规则：预告 → 落地 → 上限 → 不再刷');

/** 一路推到 W3/W4/W5 的落地，返回过程读数。 */
function runWeeks(opts = {}, upToWeek = 5) {
  const state = createGame({
    seed: opts.seed ?? 20261112,
    layout: opts.layout ?? 'wild',
    size: opts.size ?? 'small',
    opponents: 3,
  });
  const trace = [];
  for (let week = 1; week <= upToWeek; week++) {
    state.day = (week - 1) * 7 + 1;
    const notice = O.planOutbreak(state, opts);
    const planLog = state.log[state.log.length - 1]?.text ?? '';
    state.day = (week - 1) * 7 + O.OUTBREAK_DAY_OF_WEEK;
    const before = O.outbreakCount(state);
    const placed = O.settleOutbreak(state, opts);
    trace.push({
      week,
      notice: clone(notice),
      planLog,
      placed,
      live: O.outbreakCount(state),
      before,
      stacks: stacksOf(state).map((o) => ({
        id: o.id,
        pos: o.pos,
        army: o.payload.army,
        outbreak: o.payload.outbreak,
        guard: o.payload.guard,
        tier: o.payload.tier,
      })),
    });
  }
  return { state, trace };
}

{
  // B0：第 1~2 周不掷、也不创建 state.outbreak（前两周必须与改动前逐位一致）
  const st = createGame({ seed: 777, layout: 'wild', size: 'small', opponents: 3 });
  st.day = 1;
  const n1 = O.planOutbreak(st);
  st.day = 8;
  const n2 = O.planOutbreak(st);
  PASS(n1 === null && n2 === null && st.outbreak === undefined,
    'B0 第 1~2 周不掷、且不创建 state.outbreak（教学期逐位不变）');
}

const base = runWeeks();
const at = (w) => base.trace.find((t) => t.week === w);
const t3 = at(3);
const t4 = at(4);
const t5 = at(5);

PASS(t3.notice?.count === 4 && t3.notice.day === 17,
  `B1 W3 周首预告 4 栈、日期 = day 17（本周三）—— 实读 count=${t3.notice?.count} day=${t3.notice?.day}`);
PASS(/过境/.test(t3.notice?.text ?? '') && t3.planLog === t3.notice?.text,
  `B2 预告进日志（"${t3.planLog.slice(0, 28)}…"）`);
PASS(t3.placed === 4 && t3.stacks.length === 4,
  `B3 W3 落地 4 栈（placed=${t3.placed}，图上 ${t3.stacks.length} 栈）`);
PASS(t3.stacks.every((o) => o.outbreak === true && o.guard === undefined),
  'B4 每栈都带 outbreak 标记且 **guard === undefined**（不给金币赏金）');

// B5：落点红线（每一个落点都重算，不看模块自己的说法）
{
  const losts = t3.stacks.map((o) => lostAt(base.state, o.pos));
  PASS(losts.every((l) => l > 0 && l <= 40),
    `B5 每个落点重算 lost ∈ (0, 40] —— 实测 [${losts.join(', ')}]`);
}
// B6：距离分档 —— 半天是硬底线，且"有合规格子就必须先用"
{
  const costs = t3.stacks.map((o) => homeCost(base.state, o.pos));
  const floor = Math.round(1800 * 0.5);
  const st0 = createGame({ seed: 20261112, layout: 'wild', size: 'small', opponents: 3 });
  st0.day = 15;
  const cands = O.outbreakCandidates(st0, { minHomeCost: floor });
  const compliant = cands.filter((c) => c.home >= 1800).length;
  const usedCompliant = costs.filter((c) => c >= 1800).length;
  PASS(
    costs.every((c) => c >= floor) && usedCompliant === Math.min(4, compliant),
    `B6 距离：全部 ≥ 半天（${floor}）且"一天档有几个就用几个"—— 实测 [${costs.map((c) => Math.round(c)).join(', ')}]，一天档候选 ${compliant} 个、用了 ${usedCompliant} 个`,
  );
  console.log(
    `       · 小图 wild 上"距所有英雄 ≥1 天"的关口只有 ${compliant} 个（W3 要 4 栈）⇒ 距离必须分档，见 OUTBREAK_HOME_STEPS`,
  );
}
// B7：口袋里的城（只在"原本能走到"的城里判 —— 孤岛上的城本来就走不到，不算被切断）
{
  const state = base.state;
  const W = state.map.width;
  const towns = [];
  for (const obj of Object.values(state.map.objects)) {
    if (obj.kind === 'town') for (const c of obj.footprint ?? [obj.pos]) towns.push(c.y * W + c.x);
  }
  const starts = Object.values(state.heroes).map((h) => h.pos);
  const before = flood(state.map, starts);
  const badTown = t3.stacks.filter((o) => {
    const cut = flood(state.map, starts, idx(state.map, o.pos.x, o.pos.y));
    return towns.some((c) => before[c] && !cut[c]);
  });
  PASS(badTown.length === 0, `B7 被切断的口袋里没有城镇（越界 ${badTown.length} 栈）`);
}
// B8：不重复落地（直接把预告塞回去，逼 `lastDay` 闸出手）
{
  const r3 = runWeeks({}, 3);
  const st = clone(r3.state);
  st.day = 17;
  st.outbreak.notice = {
    week: 3,
    day: 17,
    count: 4,
    armies: [],
    unitTypeId: 'wolf',
    name: '狼群',
    text: '（探针）',
  };
  const again = O.settleOutbreak(st);
  PASS(again === 0 && stacksOf(st).length === 4,
    `B8 预告还在、但 lastDay 已过 ⇒ 同日再结算 0 新增（lastDay 闸）`);
}
PASS(t4.placed === 4 && t4.before === 4,
  `B9 W4 只落 4 栈（上限 8 − 已有 4）—— 预告 count=${t4.notice?.count} 落 ${t4.placed}`);
PASS(t5.notice === null && /路上已满/.test(t5.planLog) && t5.placed === 0,
  `B10 W5 已满 ⇒ 不预告 + 日志写"路上已满"（"${t5.planLog}"）`);
PASS(base.state.outbreak.spawned === 8 && O.outbreakCount(base.state) === 8,
  `B11 三周累计落地 8 栈、在图 8 栈（spawned=${base.state.outbreak.spawned}）`);

// B12：同种子逐字节一致
{
  const a = runWeeks().state;
  const b = runWeeks().state;
  const key = (s) =>
    JSON.stringify(
      stacksOf(s)
        .map((o) => ({ pos: o.pos, army: o.payload.army }))
        .sort((x, y) => x.pos.y - y.pos.y || x.pos.x - y.pos.x),
    );
  PASS(key(a) === key(b), 'B12 同种子两臂的落点 + 编成逐字节一致');
}

// B13：W6 起不再生成
{
  const r = runWeeks({}, 6);
  const t6 = r.trace[5];
  PASS(t6.notice === null && t6.placed === 0 && r.state.outbreak.spawned === 8,
    `B13 W6 不预告、不落地（spawned 停在 ${r.state.outbreak.spawned}）`);
}

// B14：6×6 红角标（§19.3.4 C3）—— 纯几何，与渲染层同源
{
  const MB = await import(dimp('render/mapBadge.js'));
  const sil = { x0: 100, y0: 200, x1: 131, y1: 243 };
  const r = MB.outbreakMarkRect(sil, 3, 7);
  const w = r.x1 - r.x0 + 1;
  const h = r.y1 - r.y0 + 1;
  const onSprite = r.x1 === sil.x1 && r.y0 === sil.y0 - 1;
  const yes = MB.isOutbreakObject({ kind: 'wanderingMonster', payload: { outbreak: true } });
  const no = MB.isOutbreakObject({ kind: 'wanderingMonster', payload: { army: [] } });
  PASS(
    w === 6 && h === 6 && onSprite && yes && !no && MB.OUTBREAK_MARK_RIM === 1,
    `B14 角标 6×6 贴在剪影右上角（${w}×${h} @${r.x0},${r.y0}），只认 payload.outbreak`,
  );
}

// B15：连推 10 周（§19.4 V6）—— 在图数恒 ≤ 8，W6 起新增恒 0
{
  const r = runWeeks({}, 10);
  const liveMax = Math.max(...r.trace.map((t) => t.live));
  const late = r.trace.filter((t) => t.week >= 6).reduce((n, t) => n + t.placed, 0);
  PASS(
    liveMax <= 8 && late === 0 && r.state.outbreak.spawned === 8,
    `B15 10 周：在图峰值 ${liveMax} 栈（≤8）、W6 起新增 ${late} 栈、累计 ${r.state.outbreak.spawned}`,
  );
}

/* ---------------- C. 负向对照 ---------------- */

HEAD('C. 负向对照（把阈值改坏必须立刻红）');

// C1：红线阈值放开 ⇒ 候选里出现 lost > 40
{
  // ring huge / seed 20261112：这张图有 8 个"切得断、但口袋里没有城"的大切断
  // （strict 85 个候选里 lost>40 为 0，放开 maxLost ⇒ 93 个里有 8 个越界，最大 84），
  // 正好能把 `lost ≤ 40` 这条线单独拎出来验（wild 图上根本不存在大切断）。
  // ★ 2026-11-13：原来用的是 ring **large**，P0 封闭宝地的墙把那张图的大切断抹平了
  //   （`maxLost=∞` 时最大 lost 只有 38 ⇒ 负向对照**没有对象可量**，恒 0 不是门）。
  //   重新扫 4 布局 × 4 尺寸 × 12 种子，挑出越界候选最多的一张；判据与阈值一字未动。
  const st = createGame({ seed: 20261112, layout: 'ring', size: 'huge', opponents: 3 });
  st.day = 15;
  // 两臂只差 `maxLost` 这一项（距离档固定在同一档，否则量到的是别的过滤器）。
  const strict = O.outbreakCandidates(st, { minHomeCost: 900 });
  const loose = O.outbreakCandidates(st, { maxLost: Infinity, minHomeCost: 900 });
  const over = (list) => list.filter((c) => c.lost > 40).length;
  PASS(over(strict) === 0 && over(loose) > 0,
    `C1 maxLost=40 时候选 ${strict.length} 个、其中 lost>40 的 0 个；放开成 ∞ ⇒ ${loose.length} 个里有 ${over(loose)} 个越界（最大 lost ${Math.max(...loose.map((c) => c.lost))}）`);
}

// C2：plan 里加 W6 ⇒ W6 能落 6（"之后不刷"来自表）
{
  const plan = { 3: 4, 4: 5, 5: 6, 6: 6 };
  const r = runWeeks({ plan, cap: Infinity, size: 'large', layout: 'ring' }, 6);
  PASS(r.trace[5].placed === 6, `C2 plan 加 W6 ⇒ W6 落 ${r.trace[5].placed} 栈（证明"不刷"来自 OUTBREAK_PLAN）`);
}

// C3：cap 放开 ⇒ 三周 15 栈
{
  const r = runWeeks({ cap: Infinity, size: 'large', layout: 'ring' }, 5);
  PASS(r.state.outbreak.spawned === 15,
    `C3 cap=∞ ⇒ 三周共 ${r.state.outbreak.spawned} 栈（4+5+6；有上限时压到 8）`);
}

/* ---------------- D. 债的结算 ---------------- */

HEAD('D. 打死才消失：不给金币、格子恢复、剩下的一动不动');

{
  const { state } = runWeeks();
  const target = stacksOf(state)[0];
  const hero = Object.values(state.heroes).find((h) => h.owner === 'p1');
  const goldBefore = state.players.p1.resources.gold ?? 0;
  const lvlBefore = hero.level;
  const objId = target.id;
  const pos = target.pos;
  const res = applyInteraction(state, hero.id, objId, true, {
    outcome: {
      win: true,
      rounds: 1,
      losses: [],
      enemyLosses: [],
      expGained: 120,
      survivors: hero.army,
      enemySurvivors: [],
    },
  });
  const goldAfter = state.players.p1.resources.gold ?? 0;
  const tile = state.map.tiles[idx(state.map, pos.x, pos.y)];
  PASS(res.title === '战斗胜利' && goldAfter === goldBefore,
    `D1 打掉 1 栈：金币 ${goldBefore} → ${goldAfter}（+0，不给赏金）`);
  PASS(tile.objectId === null && isPassable(state.map, pos.x, pos.y),
    'D2 该格立刻恢复可通行（不会是永久路障）');
  PASS(hero.level > lvlBefore || hero.exp > 0, `D3 经验照发（level ${lvlBefore} → ${hero.level}）`);
  PASS(state.outbreak.spawned === 8,
    `D4 spawner 计数不因击杀回收（spawned 仍 ${state.outbreak.spawned}）`);

  // 下一周：没打掉的栈仍在原地
  const survivors = stacksOf(state).map((o) => `${o.pos.x},${o.pos.y}`).sort();
  state.day = 22;
  O.planOutbreak(state);
  state.day = 24;
  O.settleOutbreak(state);
  const now = stacksOf(state)
    .map((o) => `${o.pos.x},${o.pos.y}`)
    .sort();
  PASS(survivors.every((k) => now.includes(k)),
    `D5 未打掉的 3 栈下一周仍在原地（${survivors.length} → ${now.length} 栈，原位置全在）`);
}

/* ---------------- E. 接线（真 endDay） ---------------- */

HEAD('E. 接线：真推进 21 天');

{
  const state = createGame({ seed: 20261112, layout: 'wild', size: 'small', opponents: 3 });
  for (let i = 0; i < 21; i++) endDay(state);
  const spawned = state.outbreak?.spawned ?? 0;
  const log = state.log.map((l) => l.text).join('\n');
  const live = O.outbreakCount(state);
  PASS(spawned === 4, `E1 真 endDay 推到 day ${state.day}：累计落地 ${spawned} 栈`);
  PASS(/过境/.test(log), 'E2 日志里有 W3 的预警（"…过境…"）');
  PASS(state.outbreak && state.outbreak.live === live,
    `E3 存档里的 live 快照 = 图上实际（${state.outbreak?.live} = ${live}）`);
  PASS(state.day === 22 && CAL.weekOf(state.day) === 4,
    `E4 探测跑到 day ${state.day}（第 ${CAL.weekOf(state.day)} 周），没有中途结束`);
}

/* ---------------- 结论 ---------------- */

console.log('');
console.log(
  bad === 0
    ? '结论：预告 / 落地 / 上限 / 补结算 / 无赏金 / 不吃软锁 —— 全部有读数。'
    : `结论：${bad} 条断言不过 —— 见上面的 [FAIL]。`,
);
process.exit(bad ? 1 : 0);
