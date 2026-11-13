/**
 * homegold.mjs —— 家门前金矿（B3a / §25.6 / G-M1）
 *
 * ## 为什么单独一个门
 * 这一改有三件"看起来对、其实会坏"的事，任何一件都不靠肉眼能看出来：
 *   ① **先摆矿再叠怪** ⇒ `grantGuard()` 会**新建**矿，旧矿变成永远中立、永远走不到的孤儿；
 *   ② 守卫只该是**怪**，不是"中立矿 + 怪"——地图上"这格到底有什么"必须只有一个答案；
 *   ③ G-M1 要的是"打得过但肉疼"，而四族的开局 T2 差太多（远程 vs 近战，
 *      同一群狼的战损能从 3% 跨到 61%），所以守卫规模按族给（`HOME_GOLD_GUARD`）。
 *
 * ## 判据
 * | # | 判据 | 阈值 |
 * |---|---|---|
 * | A | 每座玩家主城 3~7 格（兜底 ≤12）内有一支守金矿的怪 | 全部 |
 * | B | 守怪格上没有第二个 mine 对象（无孤儿矿） | 0 个孤儿 |
 * | C | G-M1：各族 20×T2 打自家守卫，32 种子 | 胜率 100%，平均战损 18~32% |
 * | D | 教学场 / 对决场**没有**家门口金矿守卫（图一/图二强制关） | 0 支 |
 *
 * ## 负向对照（必须红）
 * - `--orphan`：在一格守怪上**再塞一个 mine**（复刻 `addMine()` + 叠怪的写法）⇒ B 必须报孤儿。
 * - `--strong`：守卫规模 ×1.6（同一兵种）⇒ C 的战损必须 >32% 或打不过。
 *   ⚠️ **不能**用"换成 mid 档（野猪）"当负向对照：实测野猪比狼**慢**，
 *   远程族（p1/p3）反而更好打（13 野猪：p1 战损 7%、p3 15%），
 *   只有近战族会崩 —— 用它当对照，一半的行会假绿。
 *
 * 用法：`node tools/probes/homegold.mjs [--orphan] [--strong]`
 * 退出码：0 全过 · 1 有判据红 · 2 没有构建
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=homegold');
requireFile(DIST, 'core/map/generator.js');
requireFile(DIST, 'core/combat/battle.js');

const { createGame } = await import(distUrl('core/map/generator.js', DIST));
const { HOME_GOLD_GUARD, HOME_MINE_RING, MINE_PER_DAY } = await import(
  distUrl('core/data/mines.js', DIST)
);
const { SCENARIO_BY_ID, scenarioGenOptions } = await import(
  distUrl('core/data/scenarios.js', DIST)
);
const { startArmyFor } = await import(distUrl('core/data/heroes.js', DIST));
const { getUnit } = await import(distUrl('core/data/units.js', DIST));
const { quickBattle } = await import(distUrl('core/combat/battle.js', DIST));
const { FACTION_ORDER } = await import(distUrl('core/data/factions.js', DIST));

const ORPHAN = process.argv.includes('--orphan');
const STRONG = process.argv.includes('--strong');

let fails = 0;
const bad = (m) => {
  fails++;
  console.log(`  ✗ ${m}`);
};
const ok = (m) => console.log(`  ✓ ${m}`);

const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const armyHp = (army) => army.reduce((s, a) => s + a.count * getUnit(a.unitTypeId).hp, 0);
const tileObjectId = (state, p) => state.map.tiles[p.y * state.map.width + p.x]?.objectId ?? null;

/** 全图的 orphan 矿：对象存在，但格子没指向它（= 走不到、永远中立）。 */
function orphanMines(state) {
  return Object.values(state.map.objects).filter(
    (o) => o.kind === 'mine' && tileObjectId(state, o.pos) !== o.id,
  );
}

/** 某座城门口那支"守金矿的怪"（最近一支）。
 *
 * 只认 `payload.tier === 'weak'`：野外守矿的怪在 `mineGuard()` 里只有 **strong** 档守金矿
 * （中/弱档守木石），所以"弱档 + 金矿"就是家门那一支，不会把深处的强怪误认成家门口的。
 */
function homeGoldGuard(state, town) {
  let best = null;
  let bestD = Infinity;
  for (const o of Object.values(state.map.objects)) {
    if (o.kind !== 'wanderingMonster') continue;
    const g = o.payload?.guard;
    if (g?.kind !== 'mine' || g.resource !== 'gold') continue;
    if (o.payload?.tier !== 'weak') continue;
    const d = manhattan(o.pos, town.pos);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best ? { obj: best, d: bestD } : null;
}

const cases = [];
for (const size of ['small', 'medium', 'large']) {
  for (let s = 0; s < 2; s++) {
    cases.push({
      name: `自由 ${size} seed=${900 + s * 7}`,
      state: createGame({ seed: 900 + s * 7, size, layout: 'wild', opponents: 3 }),
      expectGuard: true,
      scenario: null,
    });
  }
}
for (const id of ['grims-showcase', 'tutorial', 'duel']) {
  const def = SCENARIO_BY_ID[id];
  cases.push({
    name: `场景 ${def.name}`,
    state: createGame(scenarioGenOptions(def)),
    expectGuard: id !== 'tutorial' && id !== 'duel',
    scenario: id,
  });
}

/* ---------------- A：地图 ---------------- */
console.log('\n=== A. 每座玩家主城有没有"守金矿的怪" ===');
let townsChecked = 0;
let guardsChecked = 0;
const distAll = [];
for (const c of cases) {
  const state = c.state;
  const players = Object.values(state.towns).filter((t) => t.owner !== 'neutral');
  const homeGuards = Object.values(state.map.objects).filter(
    (o) =>
      o.kind === 'wanderingMonster' &&
      o.payload?.tier === 'weak' &&
      o.payload?.guard?.kind === 'mine' &&
      o.payload.guard.resource === 'gold',
  );
  if (c.expectGuard && homeGuards.length !== players.length) {
    bad(`${c.name}：家门口守卫 ${homeGuards.length} 支 / 玩家城 ${players.length} 座（应一一对应）`);
  }
  if (!c.expectGuard && homeGuards.length) {
    bad(`${c.name}：不该有家门口守卫，实测 ${homeGuards.length} 支`);
  }
  if (c.expectGuard && !players.length) bad(`${c.name}：一座玩家城都没有，判据空转`);

  let hits = 0;
  const ds = [];
  for (const t of players) {
    townsChecked++;
    const hit = homeGoldGuard(state, t);
    if (!c.expectGuard) {
      if (hit) bad(`${c.name} / ${t.owner}：教学/对决场不该有家门口金矿守卫（实测 ${hit.d} 格）`);
      continue;
    }
    if (!hit) {
      bad(`${c.name} / ${t.owner}：找不到守金矿的怪`);
      continue;
    }
    guardsChecked++;
    hits++;
    ds.push(hit.d);
    distAll.push(hit.d);
    const limit = HOME_MINE_RING.max + 5;
    if (hit.d < 2 || hit.d > limit) bad(`${c.name} / ${t.owner}：守卫在 ${hit.d} 格（要求 3~7，兜底 ≤${limit}）`);
    const g = hit.obj.payload.guard;
    if (g.perDay !== MINE_PER_DAY.gold) bad(`${c.name} / ${t.owner}：守卫给的是 ${g.perDay}/天，应为 ${MINE_PER_DAY.gold}`);
    if (hit.obj.payload.tier !== 'weak') bad(`${c.name} / ${t.owner}：档位是 ${hit.obj.payload.tier}，应为 weak`);
    // 守怪格上**不能**已经有矿：否则就是"矿 + 怪"的孤儿写法
    const onTile = state.map.objects[tileObjectId(state, hit.obj.pos) ?? ''];
    if (onTile && onTile.kind === 'mine') {
      bad(`${c.name} / ${t.owner}：守怪脚下已经有矿对象（${onTile.id}）—— 先 addMine 再叠怪`);
    }
  }
  // ★ 每张图都留一行读数：静默通过等于没跑
  const span = ds.length ? `${Math.min(...ds)}~${Math.max(...ds)} 格` : '—';
  console.log(
    `  ${c.expectGuard ? '·' : '○'} ${c.name}：玩家城 ${players.length} 座 / 全图弱档守金矿怪 ${homeGuards.length} 支` +
      `（定位到 ${hits} 支 · ${span}）${c.expectGuard ? '' : '［教学/对决：要求 0 支］'}`,
  );
}

/* ---------------- B：孤儿矿 ---------------- */
console.log('\n=== B. 有没有孤儿矿 ===');
if (ORPHAN) {
  // 负向对照：复刻错误写法（同格再塞一个 mine），孤儿探测器必须报出来
  const c = cases[0];
  const victim = Object.values(c.state.map.objects).find(
    (o) => o.kind === 'wanderingMonster' && o.payload?.guard?.kind === 'mine',
  );
  if (!victim) bad('负向对照没找到可用于造孤儿的守怪');
  else {
    const id = `orphan_test`;
    c.state.map.objects[id] = {
      id,
      kind: 'mine',
      pos: { ...victim.pos },
      payload: { resource: 'gold', perDay: MINE_PER_DAY.gold, owner: 'neutral' },
      once: false,
      blocking: false,
      visitedBy: [],
    };
  }
}
const orphanCount = cases.reduce((s, c) => s + orphanMines(c.state).length, 0);
if (orphanCount) bad(`孤儿矿 ${orphanCount} 个（对象存在但格子指不到 ⇒ 永远中立、永远走不到）`);
else ok(`孤儿矿 0 个（${townsChecked} 座玩家城）`);

/* ---------------- C：G-M1 ---------------- */
console.log('\n=== C. G-M1：各族开局 20×T2 打自家守卫（32 种子）===');
const ATK_DEF = { p1: [1, 2], p2: [2, 1], p3: [1, 1], p4: [1, 1] };
const gmLoss = [];
for (const f of FACTION_ORDER) {
  const band = HOME_GOLD_GUARD[f];
  if (!band) {
    bad(`${f} 没有 HOME_GOLD_GUARD（四族都必须有，否则玩家 vs AI 不对称）`);
    continue;
  }
  const [atk, def] = ATK_DEF[f] ?? [1, 1];
  let win = 0;
  let lossSum = 0;
  let min = 1;
  let max = 0;
  let trials = 0;
  for (let w = band.min; w <= band.max; w++) {
    for (let s = 0; s < 8; s++) {
      const army = startArmyFor(f, 20);
      // `--strong`：负向对照，同一兵种规模 ×1.6 —— 必须过不了
      const enemy = [{ unitTypeId: 'wolf', count: STRONG ? Math.round(w * 1.6) : w }];
      const out = quickBattle(
        { army, attack: atk, defense: def, faction: f },
        { army: enemy, attack: 0, defense: 0 },
        1000 + s * 37 + w * 13,
      );
      trials++;
      if (out.win) {
        const l = 1 - armyHp(out.survivors) / armyHp(army);
        win++;
        lossSum += l;
        min = Math.min(min, l);
        max = Math.max(max, l);
      }
    }
  }
  const winPct = (win / trials) * 100;
  const avg = win ? (lossSum / win) * 100 : 100;
  gmLoss.push({
    f,
    band: { min: band.min, max: band.max },
    trials,
    winPct,
    lossPct: avg,
    lossMinPct: min * 100,
    lossMaxPct: max * 100,
  });
  const name = `${f} 狼 ${band.min}~${band.max}`;
  if (winPct < 100) bad(`G-M1 ${name}：胜率 ${winPct.toFixed(0)}%（要求 100%）`);
  else if (avg < 18 || avg > 32) bad(`G-M1 ${name}：平均战损 ${avg.toFixed(0)}%（要求 18~32%，目标 20~30）`);
  else
    ok(
      `G-M1 ${name}：胜率 100%，平均战损 ${avg.toFixed(0)}%（单局 ${(min * 100).toFixed(0)}~${(max * 100).toFixed(0)}%）`,
    );
}

/* ---------------- 汇总 ---------------- */
console.log(
  `\n共 ${cases.length} 张图 / ${townsChecked} 座玩家城 / ${guardsChecked} 支守金矿的怪` +
    `（距离 ${distAll.length ? `${Math.min(...distAll)}~${Math.max(...distAll)}` : '—'} 格，环带 ${HOME_MINE_RING.min}~${HOME_MINE_RING.max} + 兜底 ≤${HOME_MINE_RING.max + 5}）。`,
);
if (ORPHAN) console.log('  ★ --orphan：已复刻"先 addMine 再叠怪"，上面必须看到 1 个孤儿矿');
if (STRONG) console.log('  ★ --strong：守卫规模已 ×1.6，G-M1 必须红');

/* `--json=<file>`：与 `balance-p2` / `econ-check` / `aiscale` 同一种写法，
 * 把 G-M1 的读数写进批次基线。**不手抄进 md** —— 手抄的那一份一定会在下次改表后过期。 */
const jsonArg = process.argv.find((x) => x.startsWith('--json='));
if (jsonArg) {
  const out = jsonArg.slice('--json='.length);
  let cur = {};
  if (existsSync(out)) {
    try {
      cur = JSON.parse(readFileSync(out, 'utf8'));
    } catch {
      cur = {};
    }
  }
  cur.homegold = {
    distMd5: (() => {
      try {
        return createHash('md5').update(readFileSync(path.join(DIST, 'main.js'))).digest('hex');
      } catch {
        return null;
      }
    })(),
    orphanNegative: ORPHAN,
    strongNegative: STRONG,
    maps: cases.length,
    townsChecked,
    guardsChecked,
    guardDistance: distAll.length ? { min: Math.min(...distAll), max: Math.max(...distAll) } : null,
    orphanMines: orphanCount,
    gm1: gmLoss,
  };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(cur, null, 2));
  console.log(`  已写入基线：${out}（section: homegold）`);
}

console.log(fails === 0 ? '\nPASS' : `\nFAIL（${fails} 条）`);
process.exit(fails === 0 ? 0 : 1);
