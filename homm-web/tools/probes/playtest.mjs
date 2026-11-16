/**
 * playtest.mjs —— M8 · V1「20 局手记」的**可自动化那部分**（F1–F6 + 节奏）
 *
 * ## 为什么要有它（以及它凭什么不算"假试玩"）
 *
 * V1 原定的做法是"5 人 × 3 局 + 2 局"的手记，判 F1–F6 六条采纳率 / 胜率。
 * 手记只有在有人真的坐下来玩时才有意义；但它测的六条里，
 * **F2/F3/F4/F5 和节奏其实可以先由模拟量出来** —— 它们问的是
 * "这套建造树在真实对局里会不会被选"、"爆发怪会被打还是绕"，
 * 而不是"玩家喜不喜欢"。这两件事不能互相替代，但可以分两栏摆。
 *
 * ⇒ 本脚本给的是**一栏**：20 局四族全 AI 的采纳率 / 存活 / 节奏。
 *    另两栏必须由人做，脚本不假装能测：
 *    - **F1**（前三次建造重合度 ≤70%）：AI 只有一套策略，重合度天然 100%。
 *      这里的数只能说明"存在压倒性最优路径"，**不能**当玩家多样性读。
 *    - **F6**（四族胜率各 20%~30%）：`createGame` 把 p1 固定成 `FACTION_ORDER[0]`，
 *      阵营与出生位绑死 ⇒ 本脚本只能给 **p1（骑士）的胜率** + 四族存活率，
 *      给不出"四族各当一次玩家"的胜率。要那一条只能真人轮换阵营。
 *
 * ## 口径（不许混）
 * - **p1 也跑 AI**：`turn.ts` 硬写 `if (player === 'p1') continue`，不补就只剩三族。
 *   补法是把 `players.p1.isHuman` 置 false 再 `runAiTurn(state, 'p1')`；
 *   **p1 排在三族之后行动** ⇒ 同一天里后手，读数偏乐观（同 11-16 那条记录）。
 * - **normal 档**：`playerStartMul/playerMoveMul/monsterMul` 全 1、AI 起始 ×1，
 *   p1 除了后手之外没有额外加成。另两档会把"AI 强"和"玩家被削"混在一起。
 * - **一局 = 35 天**（§27.7 的五周），继续跑到 60 天只为看终局，**判据取 D35**。
 * - **T5 只数"买到了"**：英雄或驻军里出现 tier 5 的兵即算，不看购买动作。
 * - **爆发怪"打/绕"**：id 从地图上消失且当天日志有「击败了」= 打；
 *   一直活到终局 = 绕。不把"消失但没打"算成打（那是对象被别的机制清掉）。
 *
 * ## 用法
 * ```
 * node tools/probes/playtest.mjs                        # 20 局（4 布局 × 5 种子）× 60 天
 * node tools/probes/playtest.mjs --games=4 --days=20    # 快跑（调试）
 * node tools/probes/playtest.mjs --json=/tmp/pt.json    # 存原始读数
 * ```
 * 退出码：0 全过 / 1 有判据越界 / 2 没有构建。
 *
 * ## 判据阈值来自 PROJECT-PLAN §10.1（V1），不是本脚本自定
 * F2 城防线 40%~70% · F3 魔法线 30%~60% · F4 T5 ≥60% · F5 打÷(打+绕) ≥40%
 * F1 ≤70%（本脚本只报数，不判，理由见上）· F6 20%~30%（同上）
 */
import { writeFileSync } from 'node:fs';
import { distDir, distUrl, printHeader, requireFile, argOf } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=playtest');
const dimp = (rel) => distUrl(rel, DIST);
requireFile(DIST, 'core/game/turn.js');
requireFile(DIST, 'core/game/ai.js');

const { createGame } = await import(dimp('core/map/generator.js'));
const { endDay } = await import(dimp('core/game/turn.js'));
const { runAiTurn } = await import(dimp('core/game/ai.js'));
const { getUnit } = await import(dimp('core/data/units.js'));
const { garrisonStrength } = await import(dimp('core/game/town.js'));
const { armyValue } = await import(dimp('core/game/hero.js'));
const { isEliminated } = await import(dimp('core/game/victory.js'));

const GAMES = Number(argOf('games', '20'));
const DAYS = Number(argOf('days', '60'));
const OUT = argOf('json', '');
/** 设计口径的"一局"：五周 = 35 天（§27.7）。判据只取这一天。 */
const SESSION = 35;
const DIFFICULTY = 'normal';
/** 四种布局轮转，抵消"p1 永远在同一起始位"的位置偏置（见头注 F6）。 */
const LAYOUTS = ['wild', 'ring', 'islands', 'lanes'];

const pct = (x) => `${(x * 100).toFixed(0)}%`;
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** 一座城当前全部"建筑键"，升级记成 `id@N`（同一栋长大也算一步，否则建造序会把升级吞掉）。 */
function buildingKeys(town) {
  const out = [];
  for (const id of town.buildings) {
    const lv = Math.max(1, town.levels?.[id] ?? 1);
    out.push(lv > 1 ? `${id}@${lv}` : id);
  }
  return out;
}

function townsOf(state, f) {
  return Object.values(state.towns).filter((t) => t.owner === f);
}

function hasT5(state, f) {
  const army = [];
  for (const h of Object.values(state.heroes)) if (h.owner === f) army.push(...(h.army ?? []));
  for (const t of townsOf(state, f)) army.push(...(t.garrison ?? []));
  return army.some((x) => x.count > 0 && getUnit(x.unitTypeId).tier === 5);
}

function outbreakIds(state) {
  const ids = new Set();
  for (const o of Object.values(state.map.objects)) {
    if (o.kind === 'wanderingMonster' && o.payload?.outbreak) ids.add(o.id);
  }
  return ids;
}

const games = [];
for (let g = 0; g < GAMES; g++) {
  const layout = LAYOUTS[g % LAYOUTS.length];
  const seed = 6100 + Math.floor(g / LAYOUTS.length) * 977;
  const state = createGame({
    seed,
    size: 'medium',
    layout,
    opponents: 3,
    difficulty: DIFFICULTY,
    playerName: '指挥官',
  });
  // p1 也交给 AI：turn.ts 对 p1 无条件 continue，不置 false 就只有三族在动。
  state.players.p1.isHuman = false;

  const ids = Object.keys(state.players);
  const order = new Map(ids.map((f) => [f, []]));
  const seen = new Map(ids.map((f) => [f, new Set()]));
  const at35 = new Map();
  let t5Day = new Map(ids.map((f) => [f, 0]));
  let outbreakFought = 0;
  let outbreakVanished = 0;
  let liveOutbreak = new Set();
  let day = 0;
  let ms = 0;

  for (day = 1; day <= DAYS; day++) {
    const t0 = performance.now();
    endDay(state);
    if (state.status === 'playing') runAiTurn(state, 'p1');
    ms += performance.now() - t0;

    // 建造序：只记"新增的键"，按出现顺序
    for (const f of ids) {
      const set = seen.get(f);
      for (const t of townsOf(state, f)) {
        for (const k of buildingKeys(t)) {
          if (!set.has(k)) {
            set.add(k);
            order.get(f).push(`D${state.day}:${k}`);
          }
        }
      }
    }

    /* 爆发怪：**只认"消失当天有战斗日志"**。消失但没打 = 被别的机制清掉，
       既不算打也不算绕（记 vanished，不进分母）。一直活到终局才是"绕"。 */
    const now = outbreakIds(state);
    for (const id of liveOutbreak) {
      if (now.has(id)) continue;
      const foughtToday = state.log.some((l) => l.day === state.day && /击败了/.test(l.text));
      if (foughtToday) outbreakFought++;
      else outbreakVanished++;
    }
    liveOutbreak = now;

    for (const f of ids) if (!t5Day.get(f) && hasT5(state, f)) t5Day.set(f, state.day);

    if (state.day === SESSION) {
      at35.set(
        'snap',
        Object.fromEntries(
          ids.map((f) => [f, {
            alive: !isEliminated(state, f),
            towns: townsOf(state, f).length,
            heroes: Object.values(state.heroes).filter((h) => h.owner === f).length,
            power: townsOf(state, f).reduce((a, t) => a + garrisonStrength(t.garrison ?? []), 0) +
              Object.values(state.heroes).filter((h) => h.owner === f).reduce((a, h) => a + armyValue(h.army ?? []), 0),
            wall: townsOf(state, f).some((t) => t.buildings.some((b) => b.startsWith('wall'))),
            guild: townsOf(state, f).some((t) => t.buildings.some((b) => b.startsWith('guild'))),
            t5: !!t5Day.get(f),
          }]),
        ),
      );
    }
    if (state.status !== 'playing') break;
  }

  games.push({
    seed, layout, day, status: state.status,
    p1: {
      order: order.get('p1'),
      first3: order.get('p1').slice(0, 3),
      ...(at35.get('snap')?.p1 ?? {}),
    },
    snap: at35.get('snap') ?? null,
    factions: Object.fromEntries(ids.map((f) => [f, {
      t5Day: t5Day.get(f), order: order.get(f).length,
    }])),
    outbreak: { fought: outbreakFought, vanished: outbreakVanished, alive: liveOutbreak.size },
    msPerDay: ms / Math.max(1, day),
  });
  const s = at35.get('snap')?.p1;
  console.log(
    `  局 ${String(g + 1).padStart(2)} ${layout.padEnd(8)} seed ${seed}` +
    ` · 到 D${String(day).padStart(2)} ${state.status}` +
    ` · D35 ${s ? `${s.towns} 城 / 战力 ${s.power}` : '（未到）'}` +
    ` · 首三 ${(order.get('p1').slice(0, 3).join(' → ') || '—')}`,
  );
}

/* ------------------------------------------------------------------ 汇总 */
const with35 = games.filter((g) => g.p1 && typeof g.p1.towns === 'number');
const rate = (f) => (with35.length ? with35.filter(f).length / with35.length : 0);
const F2 = rate((g) => g.p1.wall);
const F3 = rate((g) => g.p1.guild);
const F4 = rate((g) => g.p1.t5);
const fought = games.reduce((a, g) => a + g.outbreak.fought, 0);
const aliveOb = games.reduce((a, g) => a + g.outbreak.alive, 0);
const vanished = games.reduce((a, g) => a + g.outbreak.vanished, 0);
/** F5 的分母只收"打掉的 + 还活着的"；**消失但没打的既不进分子也不进分母**。 */
const F5 = fought + aliveOb ? fought / (fought + aliveOb) : 0;

// F1：前三次建造的平均两两重合度（AI 单策略 ⇒ 预期接近 100%，不是玩家读数）
const triples = with35.map((g) => new Set(g.p1.first3)).filter((s) => s.size > 0);
let pairSum = 0, pairN = 0;
for (let i = 0; i < triples.length; i++) {
  for (let j = i + 1; j < triples.length; j++) {
    const inter = [...triples[i]].filter((x) => triples[j].has(x)).length;
    pairSum += inter / Math.max(1, Math.min(triples[i].size, triples[j].size));
    pairN++;
  }
}
const F1 = pairN ? pairSum / pairN : 0;

const dayOf = (order, re) => {
  const hit = order.find((x) => re.test(x));
  return hit ? Number(hit.slice(1).split(':')[0]) : 0;
};
const wallDays = games.map((g) => dayOf(g.p1.order, /:wall/)).filter((x) => x > 0);
const guildDays = games.map((g) => dayOf(g.p1.order, /:guild/)).filter((x) => x > 0);

const factionStats = {};
for (const f of ['p1', 'p2', 'p3', 'p4']) {
  factionStats[f] = {
    alive35: with35.length ? with35.filter((g) => g.snap?.[f]?.alive).length / with35.length : 0,
    towns35: mean(with35.map((g) => g.snap?.[f]?.towns ?? 0)),
    power35: Math.round(mean(with35.map((g) => g.snap?.[f]?.power ?? 0))),
    t5: with35.length ? with35.filter((g) => g.snap?.[f]?.t5).length / with35.length : 0,
  };
}

console.log(`\n—— V1 读数（${games.length} 局 · 四族全 AI · ${DIFFICULTY} · 判据取 D${SESSION}）——`);
console.log('  ⚠️ 下面 F1–F6 是**玩家**指标；AI 只有一套策略，这些数只能当"树的形状"读，');
console.log('     不能当"玩家会怎么选"。人那一栏仍然是 0 局。');
console.log(`  F1 前三次建造重合度      ${pct(F1)}   （阈值 ≤70%）· 前三次：${with35[0]?.p1.first3.join(' → ') ?? '—'}`);
console.log(`  F2 城防线采纳率          ${pct(F2)}   （阈值 40%~70%）· 首建日中位 ${median(wallDays) || '—'} 天`);
console.log(`  F3 魔法线采纳率          ${pct(F3)}   （阈值 30%~60%）· 首建日中位 ${median(guildDays) || '—'} 天`);
console.log(`  F4 T5 购买率（D35）      ${pct(F4)}   （阈值 ≥60%）`);
console.log(`  F5 爆发怪 打÷(打+绕)     ${pct(F5)}   （阈值 ≥40%）· 打 ${fought} / 绕 ${aliveOb} / 另有 ${vanished} 消失但无战斗`);
console.log(`  F6 四族胜率              —       （p1 固定为骑士，脚本给不了；下面给存活与战力）`);
console.log(`  一局长度                 中位 ${median(games.map((g) => g.day))} 天 · 每模拟日 ${mean(games.map((g) => g.msPerDay)).toFixed(1)} ms`);
console.log('\n  四族 D35 存活率 / 城数 / 战力 / T5 率：');
for (const [f, v] of Object.entries(factionStats)) {
  console.log(`    ${f}  ${pct(v.alive35).padStart(4)} · ${v.towns35.toFixed(1)} 城 · ${String(v.power35).padStart(6)} · ${pct(v.t5)}`);
}

/* ------------------------------------------------------------------ 闸（只判"模拟是否成立"，不判设计好坏） */
/**
 * 闸写成纯函数：`--negctrl` 要能喂它一份**坏数据**证明它会红。
 * 这不是为了好看 —— 恒绿的闸等于没有（铁律 2）。
 */
function judge(list, with35) {
  const fails = [];
  const ok = (m) => console.log(`  ✓ ${m}`);
  const bad = (m) => { fails.push(m); console.log(`  ✗ ${m}`); };

  if (with35.length === 0) {
    bad(`0 局走到 D${SESSION} —— 空集不许读成"没需求"（先查 --days 是不是小于 35）`);
  } else if (with35.length !== list.length) {
    bad(`只有 ${with35.length}/${list.length} 局走到 D${SESSION}（早退的游戏不参与采纳率）`);
  } else {
    ok(`${list.length}/${list.length} 局都走到 D${SESSION}，状态 ${list.map((g) => g.status).join('/')}`);
  }

  const reach = [
    ['墙', with35.length ? with35.filter((g) => g.p1.wall).length / with35.length : 0],
    ['行会', with35.length ? with35.filter((g) => g.p1.guild).length / with35.length : 0],
    ['T5', with35.length ? with35.filter((g) => g.p1.t5).length / with35.length : 0],
  ];
  const dead = reach.filter(([, r]) => r === 0);
  if (dead.length) {
    bad(`${dead.map(([n]) => n).join('、')} 在 ${list.length} 局里一次都没被 AI 选中 —— 先怀疑建造树/资源，别读成"玩家不爱建"`);
  } else {
    ok(`三条线都可达：${reach.map(([n, r]) => `${n} ${pct(r)}`).join(' · ')}（可达 ≠ 采纳率）`);
  }

  const f = list.reduce((a, g) => a + g.outbreak.fought, 0);
  const al = list.reduce((a, g) => a + g.outbreak.alive, 0);
  if (f + al === 0) bad('爆发怪 0 对象：既没有打也没有绕 —— 先查第 3 周有没有落地，别读成 0% 交战');
  else ok(`爆发怪有对象：打 ${f} / 绕 ${al}`);

  return fails;
}

if (process.argv.includes('--negctrl')) {
  console.log('\n—— 负向对照（闸必须会红）——');
  const wiped = games.map((g) => ({
    ...g,
    p1: { ...g.p1, wall: false, guild: false, t5: false },
    outbreak: { ...g.outbreak, fought: 0, alive: 0 },
  }));
  const nw = wiped.filter((g) => typeof g.p1.towns === 'number');
  const f1 = judge(wiped, nw);
  const hit = f1.length >= 2;
  console.log(hit ? '  ✓ 抹掉墙/行会/T5 与爆发怪 ⇒ 「可达」与「有对象」两条同时红' : '  ✗ 负向对照没红 —— 闸是恒绿的');
  const f2 = judge(games.filter(() => false), []);
  console.log(f2.length ? '  ✓ 空集（0 局到 D35）⇒ 空集闸红' : '  ✗ 空集闸没红');
  process.exit(hit && f2.length ? 0 : 1);
}

const fails = judge(games, with35);

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    meta: {
      games: games.length, days: DAYS, session: SESSION, difficulty: DIFFICULTY,
      dist: DIST, at: new Date().toISOString(),
    },
    readings: { F1, F2, F3, F4, F5, wallDays, guildDays, fought, aliveOb, vanished },
    faction: factionStats,
    games,
  }, null, 2) + '\n');
  console.log(`\n原始读数 → ${OUT}`);
}

process.exit(fails.length ? 1 : 0);
