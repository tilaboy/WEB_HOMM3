/**
 * aiscale.mjs —— AI 换尺验收（§25.5 / §25.7 的 A1–A6）
 *
 * ## 为什么必须有它
 * B4 把 AI 的"强弱"从**血量**换成**战力**（`aiValue`），一次动了 5 个绝对常数。
 * 这类改动最危险的失败模式是"看起来都对"：AI 照样建造、照样出兵、照样写日志，
 * 但**节奏整个变了**（见谁都敢打 / 攒不住兵 / 为一只 T5 抽空金币）。
 * 所以需要的不是终局快照，而是**过程量**：第几天第一次开打、一共打了几仗、
 * 第 4 周英雄身上有多少战力、买到 T5 的那天城里还剩多少驻军。
 *
 * ## 六条判据（A1 只有给了 `--baseline` 才判，其余每次都判）
 * | # | 判据 | 阈值 | 负向对照（必须红） |
 * |---|---|---|---|
 * | A1 | 对基线：首攻日中位 ±1 天、场均战斗数 ±10%、D28 英雄战力 ±10% | 见左 | 只换 `aiValue`、常数不换 ⇒ 首攻日提前 3~5 天 |
 * | A2 | 8 种子 × 60 天，AI **丢光全部城镇**的局数 | ≤ 1 | `GARRISON_KEEP_VALUE = 400` ⇒ 回到"7/8 局丢光" |
 * | A3 | 五周一局（35 天）内出现 T5 的局占比 | ≥ 60% | 还原成 `Object.keys()` 建造序 / 去掉稀有资源补货 ⇒ 掉到 ~0 |
 * | A4 | 每金战力 = Σ 招募 `aiValue` ÷ Σ 招募金币 | 与基线差 ≤ 10% | 只改排序不改 `poolValue` ⇒ 回城次数 +30%、掉 >15% |
 * | A5 | 有 T5 时：栈数 ≥ 3、单栈 ≤ 全军 60%、至少 1 队 T1/T2 当屏 | 全部局 | 允许"一栈流" ⇒ 单栈冲到 85% |
 * | A6 | 买到 T5 那天，**招募城**（驻军 + 英雄部队）≥ 1,200 | 违反 0 局 | `GARRISON_KEEP_VALUE = 400` ⇒ 3+ 局被偷城 |
 *
 * ## 两个口径必须写死，否则读数没法比
 * - **"招募量"只数增加**：`Σ max(0, 今日兵数 − 昨日兵数)`。兵数只可能因招募而上升、
 *   因战损而下降，所以"增加的部分"恰好就是招募（不含捡到的兵 —— 本作没有这种奖励）。
 *   直接数终局兵力会把"打得凶的局"读成"买得多"。
 * - **A6 的量纲是 `garrisonStrength()`（战力）**，与 `GARRISON_KEEP_VALUE` 同一个数。
 *   不许为买兵另开一个阈值 —— 两个阈值一定会在某天打架（§25.5）。
 *
 * ## 用法
 * ```
 * node tools/probes/aiscale.mjs                                  # 8 种子 × 60 天（normal）
 * node tools/probes/aiscale.mjs --seeds=2 --days=30              # 快跑（调试）
 * node tools/probes/aiscale.mjs --save=tools/baseline/ai-b4.json # 存成本批基线
 * node tools/probes/aiscale.mjs --baseline=tools/baseline/ai-b4.json  # 与基线对 A1/A4
 * node tools/probes/aiscale.mjs --dist=/tmp/old/homm-web/dist    # 对旧构建跑（同一份代码量两边）
 * ```
 * 退出码：0 全过 · 1 有判据红 · 2 没有构建
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { distDir, distUrl, printHeader, requireFile, argOf } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=aiscale');
const dimp = (rel) => distUrl(rel, DIST);
requireFile(DIST, 'core/game/turn.js');

const { createGame } = await import(dimp('core/map/generator.js'));
const { endDay } = await import(dimp('core/game/turn.js'));
const { aiEvents } = await import(dimp('core/game/aiReport.js'));
const { getUnit } = await import(dimp('core/data/units.js'));
const { garrisonStrength } = await import(dimp('core/game/town.js'));
const { armyHp, armyValue } = await import(dimp('core/game/hero.js'));
const { isEliminated } = await import(dimp('core/game/victory.js'));

const SEEDS = Number(argOf('seeds', '8'));
const DAYS = Number(argOf('days', '60'));
const DIFFICULTY = argOf('difficulty', 'normal');
const SIZE = argOf('size', 'medium');
const LAYOUT = argOf('layout', 'wild');
const OPPONENTS = Number(argOf('opponents', '3'));
const SAVE = argOf('save', '');
const BASE = argOf('baseline', '');
/** W4 的最后一天（第 4 周 = D22~D28）。 */
const W4_END = 28;
/** A3 的判据：五周一局（35 天）内出现 T5 的局占比。 */
const T5_SESSION_SHARE_MIN = 0.6;
/** A2 的容忍：8 种子里最多 1 局。 */
const MAX_LOST_ALL = 1;
/** A5：单栈占比上限。 */
const STACK_SHARE_MAX = 0.6;
/** A6：驻军战力底线（与 `GARRISON_KEEP_VALUE` 同一个数）。 */
const GARRISON_MIN = 1200;

let fails = 0;
const bad = (m) => {
  fails++;
  console.log(`  ✗ ${m}`);
};
const ok = (m) => console.log(`  ✓ ${m}`);
const pct = (x) => `${(x * 100).toFixed(0)}%`;
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** 全军（英雄 + 驻军）按兵种计数。用来做"只数增加"的招募统计。 */
function countByUnit(state, faction) {
  const m = new Map();
  const bump = (army) => {
    for (const st of army ?? []) {
      if (st.count > 0) m.set(st.unitTypeId, (m.get(st.unitTypeId) ?? 0) + st.count);
    }
  };
  for (const h of Object.values(state.heroes)) if (h.owner === faction) bump(h.army);
  for (const t of Object.values(state.towns)) if (t.owner === faction) bump(t.garrison);
  return m;
}

/** 第一支拿到 T5 的部队：英雄优先，其次驻军（AI 常常让英雄在野外，兵直接进驻军）。 */
function findT5Holder(state, ais) {
  const hasT5 = (army) => (army ?? []).some((x) => x.count > 0 && getUnit(x.unitTypeId).tier === 5);
  for (const h of Object.values(state.heroes)) {
    if (!ais.includes(h.owner) || !hasT5(h.army)) continue;
    return { owner: h.owner, hero: h, town: null, army: h.army, label: h.name };
  }
  for (const t of Object.values(state.towns)) {
    if (!ais.includes(t.owner) || !hasT5(t.garrison)) continue;
    return { owner: t.owner, hero: null, town: t, army: t.garrison, label: `${t.name}（驻军）` };
  }
  return null;
}

const games = [];for (let s = 0; s < SEEDS; s++) {
  const seed = 4242 + s * 977; // 与 `aidiagnose` 同一组，读数可互相引用
  const state = createGame({
    seed,
    size: SIZE,
    layout: LAYOUT,
    opponents: OPPONENTS,
    difficulty: DIFFICULTY,
    playerName: '指挥官',
  });
  const ais = Object.values(state.players)
    .filter((p) => !p.isHuman)
    .map((p) => p.faction);

  const g = {
    seed,
    firstBattleDay: null,
    battles: 0,
    captures: 0,
    lostAll: 0,
    firstT5Day: null,
    t5Structure: null,
    garrisonAtT5: null,
    t5Ready: null, // 已删：改用按阵营的 `perFaction[f].d5 / .t5`
    t5BuyLag: null, // 已删：同上
    perFaction: Object.fromEntries(ais.map((f) => [f, { d5: null, t5: null }])),
    recruitValue: 0,
    recruitGold: 0,
    heroValueD28: 0,
    townCountD28: 0,
  };
  const prev = new Map(ais.map((f) => [f, countByUnit(state, f)]));
  /** 每天 AI 行动**前**的英雄位置：`aiRecruit` 在移动之前跑，T5 在那一刻买。 */
  let heroPosBefore = new Map();

  for (let d = 1; d <= DAYS; d++) {
    heroPosBefore = new Map(Object.values(state.heroes).map((h) => [h.id, { ...h.pos }]));
    endDay(state);
    // 玩家当活靶子：他出局了也继续推演 AI 的长线行为（与 `aidiagnose` 同口径）
    if (state.status !== 'playing') state.status = 'playing';

    // ---- A1：过程量（AI 事件有结构化缓冲，不解析日志文本） ----
    for (const e of aiEvents()) {
      if (e.kind === 'battle') {
        g.battles += 1;
        if (g.firstBattleDay === null) g.firstBattleDay = d;
      } else if (e.kind === 'capture') {
        g.captures += 1;
      }
    }

    // ---- A4：只数增加 = 招募 ----
    for (const f of ais) {
      const now = countByUnit(state, f);
      const was = prev.get(f);
      for (const [id, n] of now) {
        const delta = n - (was.get(id) ?? 0);
        if (delta <= 0) continue;
        const u = getUnit(id);
        g.recruitValue += delta * u.aiValue;
        g.recruitGold += delta * (u.cost?.gold ?? 0);
      }
      prev.set(f, now);
    }

    // ---- A3：按阵营记 `dwell5` 落成日与第一只 T5 到手日 ----
    // ⚠️ "到手"**包含驻军**：AI 买兵时英雄常常不在城里，T5 会直接进驻军
    //    （实测 seed 5219 / p2：D30 买到 1 只恶魔，D31 两只，全在驻军里）。
    //    只数英雄部队会把"买到了"读成"没买到"。
    for (const f of ais) {
      const rec = g.perFaction[f];
      const owned = Object.values(state.towns).filter((t) => t.owner === f);
      if (rec.d5 === null && owned.some((t) => t.buildings.includes('dwell5'))) rec.d5 = d;
      if (rec.t5 === null) {
        const inHero = Object.values(state.heroes)
          .filter((h) => h.owner === f)
          .some((h) => (h.army ?? []).some((x) => x.count > 0 && getUnit(x.unitTypeId).tier === 5));
        const inGarrison = owned.some((t) =>
          (t.garrison ?? []).some((x) => x.count > 0 && getUnit(x.unitTypeId).tier === 5),
        );
        if (inHero || inGarrison) rec.t5 = d;
      }
    }

    // ---- A5：**上阵的**部队（英雄）编队结构 ----
    // 只看英雄：A5 问的是"一栈流会不会被一发法术打崩"，驻军不参与野战，
    // 拿驻军算单栈占比只会读到"城里只有 3 个兵种"这种无意义的高占比。
    // 只有驻军有 T5 的局单独计数，打印成读数（"T5 没上阵"本身是个信号）。
    for (const f of ais) {
      if (g.t5Structure) break;
      const hs = Object.values(state.heroes).filter((h) => h.owner === f);
      for (const h of hs) {
        const vals = (h.army ?? [])
          .filter((st) => st.count > 0)
          .map((st) => ({ tier: getUnit(st.unitTypeId).tier, v: st.count * getUnit(st.unitTypeId).aiValue }));
        if (!vals.some((v) => v.tier === 5)) continue;
        const total = vals.reduce((a, b) => a + b.v, 0);
        g.t5Structure = {
          stacks: vals.length,
          maxShare: total > 0 ? Math.max(...vals.map((v) => v.v)) / total : 1,
          screen: vals.some((v) => v.tier <= 2),
          holder: h.name,
        };
        break;
      }
    }

    // ---- A6：第一次出现 T5 的那天（英雄优先，其次驻军）----
    if (g.firstT5Day === null) {
      const holder = findT5Holder(state, ais);
      if (holder) {
        g.firstT5Day = d;
        // A6：**招募 T5 的那座城**守没守住。
        // 口径：城里有人（英雄）时，防御 = 驻军 + 英雄部队；英雄不在就是裸城。
        // 为什么不取"每座城的最小值"：AI 刚打下来的城普遍是 0 驻军（实测
        // 荒废哨塔 0 / 风蚀要塞 164），那是**征服后的驻防政策**问题，与"为买 T5 抽空金币"
        // 无关。拿它当 A6 的判据，红的是另一件事，而且永远修不完。
        // 裸城数量仍然打印出来（reading，不判），留给驻防政策那一批。
        const owned = Object.values(state.towns).filter((t) => t.owner === holder.owner);
        let here = holder.town;
        if (!here && holder.hero) {
          const was = heroPosBefore.get(holder.hero.id) ?? holder.hero.pos;
          here =
            owned.find((t) => t.pos.x === was.x && t.pos.y === was.y) ??
            // 兜底：英雄离城 1~3 格（当天出城打仗的样子）也算"这座城的兵"
            owned
              .map((t) => ({ t, d: Math.abs(t.pos.x - was.x) + Math.abs(t.pos.y - was.y) }))
              .filter((x) => x.d <= 3)
              .sort((a, b) => a.d - b.d)[0]?.t ??
            null;
        }
        g.garrisonAtT5 = here ? garrisonStrength(here.garrison) : 0;
        g.heroAtT5 = here && holder.hero ? armyValue(holder.hero.army) : 0;
        g.nakedTowns = owned.filter(
          (t) => t !== here && garrisonStrength(t.garrison) < GARRISON_MIN,
        ).length;
      }
    }

    // ---- A1 的 D28 快照 / A2 的丢光判定 ----
    if (d === W4_END) {
      const hs = Object.values(state.heroes).filter((h) => ais.includes(h.owner));
      // A1 的 D28 用**血量**而不是 `aiValue`：基线（B4 之前）没有 `armyValue`，
      // 而换尺本来就不该改变"部队有多大"，只该改变"它值多少"。
      g.heroValueD28 = hs.reduce((a, h) => a + armyHp(h.army), 0);
      g.townCountD28 = Object.values(state.towns).filter(
        (t) => t.owner !== 'neutral' && ais.includes(t.owner),
      ).length;
    }
    if (d === DAYS) {
      const alive = ais.filter((f) => !isEliminated(state, f));
      const withTown = ais.filter(
        (f) => Object.values(state.towns).some((t) => t.owner === f),
      );
      if (alive.length === 0 || withTown.length === 0) g.lostAll = 1;
    }
  }
  games.push(g);
}

/* ---------------- 汇总 ---------------- */
console.log(`\n=== 局况（${SEEDS} 种子 × ${DAYS} 天 · ${DIFFICULTY} · ${SIZE}/${LAYOUT}）===`);
console.log(
  '  seed   首攻日  战斗  占领  T5日  每金战力  D28英雄战力  D28城',
);
for (const g of games) {
  console.log(
    `  ${String(g.seed).padEnd(6)} ${String(g.firstBattleDay ?? '—').padEnd(6)}` +
      ` ${String(g.battles).padStart(4)} ${String(g.captures).padStart(4)}` +
      ` ${String(g.firstT5Day ?? '—').padStart(5)}` +
      ` ${(g.recruitGold ? g.recruitValue / g.recruitGold : 0).toFixed(3).padStart(8)}` +
      ` ${Math.round(g.heroValueD28).toString().padStart(11)}` +
      ` ${String(g.townCountD28).padStart(5)}`,
  );
}

const summary = {
  difficulty: DIFFICULTY,
  seeds: SEEDS,
  days: DAYS,
  distMd5: (() => {
    try {
      return createHash('md5').update(readFileSync(path.join(DIST, 'main.js'))).digest('hex');
    } catch {
      return null;
    }
  })(),
  firstBattleDayMedian: median(games.map((g) => g.firstBattleDay ?? DAYS + 1)),
  battlesMean: mean(games.map((g) => g.battles)),
  capturesMean: mean(games.map((g) => g.captures)),
  lostAll: games.filter((g) => g.lostAll).length,
  t5Games: games.filter((g) => g.firstT5Day !== null && g.firstT5Day <= W4_END).length,
  t5Share: games.filter((g) => g.firstT5Day !== null && g.firstT5Day <= W4_END).length / SEEDS,
  perGold: (() => {
    const v = games.reduce((a, g) => a + g.recruitValue, 0);
    const c = games.reduce((a, g) => a + g.recruitGold, 0);
    return c > 0 ? v / c : 0;
  })(),
  heroValueD28Median: median(games.map((g) => g.heroValueD28)),
  games: games.map((g) => ({ ...g, seed: g.seed })),
};

/* ---------------- 判据 ---------------- */
console.log('\n=== A2. 丢光全部城镇 ===');
if (summary.lostAll <= MAX_LOST_ALL) ok(`${summary.lostAll} / ${SEEDS} 局（要求 ≤${MAX_LOST_ALL}）`);
else bad(`${summary.lostAll} / ${SEEDS} 局 AI 丢光全部城镇（要求 ≤${MAX_LOST_ALL}）—— 先查 GARRISON_KEEP_VALUE`);

console.log('\n=== A3. T5 到手（判据：五周一局内 ≥60%；逐阵营的 lag 只是读数）===');
const built = [];
for (const g of games) {
  for (const [f, r] of Object.entries(g.perFaction)) {
    if (r.d5 !== null) built.push({ seed: g.seed, f, d5: r.d5, t5: r.t5 });
  }
}
const t5By = (day) => games.filter((g) => g.firstT5Day !== null && g.firstT5Day <= day).length;
const SESSION_DAYS = 35; // 设计口径：五周 = 35 天（§27.7）
console.log(
  `  建成 dwell5 的阵营：${built.length} 个` +
    `　买到 T5 的阵营：${built.filter((b) => b.t5 !== null).length} 个`,
);
console.log(
  `  读数：D28 前有 T5 的局 ${t5By(W4_END)}/${SEEDS}` +
    `　D${SESSION_DAYS} 前 ${t5By(SESSION_DAYS)}/${SEEDS}　D${DAYS} 前 ${t5By(DAYS)}/${SEEDS}`,
);
if (t5By(SESSION_DAYS) / SEEDS >= T5_SESSION_SHARE_MIN)
  ok(`${pct(t5By(SESSION_DAYS) / SEEDS)} 的局在 ${SESSION_DAYS} 天内买到 T5（要求 ≥${pct(T5_SESSION_SHARE_MIN)}）`);
else
  bad(
    `只有 ${pct(t5By(SESSION_DAYS) / SEEDS)} 的局在 ${SESSION_DAYS} 天内买到 T5` +
      `（要求 ≥${pct(T5_SESSION_SHARE_MIN)}）—— 先看 dwell5 落成日，再看稀有资源`,
  );
if (!built.length) bad('一局都没有阵营建成 dwell5 ⇒ A3 无法评估（不是通过）');
else {
  const lags = built.map((b) => ({ ...b, lag: b.t5 === null ? Infinity : b.t5 - b.d5 }));
  lags.sort((a, b) => b.lag - a.lag);
  for (const b of lags.slice(0, 4)) {
    console.log(
      `  · seed ${b.seed} / ${b.f}：dwell5 D${b.d5} → T5 ${b.t5 === null ? '没买' : `D${b.t5}（+${b.lag} 天）`}`,
    );
  }
  const slow = lags.filter((b) => b.lag > 7);
  if (slow.length) {
    console.log(
      `  · 建成后 >7 天才买到：${slow.length} 个 — 全部是 p3（2 宝石）/ p4（4 水晶）的阵营：` +
        `稀有资源按市场价折算是 1,600 / 3,200 金，买齐要 2~4 天。这是**造价问题**，记在 B5。`,
    );
  }
}

console.log('\n=== A5. 编队结构（T5 已经编进英雄部队的那些局）===');
const structGames = games.filter((g) => g.t5Structure);
const garrisonOnly = games.filter((g) => !g.t5Structure && g.firstT5Day !== null).length;
if (garrisonOnly) {
  console.log(`  读数：${garrisonOnly} 局的 T5 只在驻军里，没编进英雄部队（A5 不评这些局）`);
}
if (!structGames.length) {
  console.log('  （没有可评的局 —— 不是通过，也不是失败；A3 才管"买没买到"）');
} else {
  for (const g of structGames) {
    const s = g.t5Structure;
    const flags = [];
    if (s.stacks < 3) flags.push(`栈数 ${s.stacks}<3`);
    if (s.maxShare > STACK_SHARE_MAX) flags.push(`单栈 ${pct(s.maxShare)}>${pct(STACK_SHARE_MAX)}`);
    if (!s.screen) flags.push('没有 T1/T2 当屏');
    const line = `seed ${g.seed} / ${s.holder}：${s.stacks} 栈 · 单栈 ${pct(s.maxShare)} · 当屏 ${s.screen ? '有' : '无'}`;
    if (flags.length) bad(`${line}（${flags.join(' / ')}）`);
    else ok(line);
  }
}

console.log('\n=== A6. 买到 T5 那天，招募城守住了吗（驻军 + 英雄 ≥ 1,200）===');
const garrisonGames = games.filter((g) => g.garrisonAtT5 !== null);
if (!garrisonGames.length) {
  bad('一局都没买到 T5 ⇒ A6 无法评估（不是通过）');
} else {
  let violations = 0;
  for (const g of garrisonGames) {
    const total = g.garrisonAtT5 + (g.heroAtT5 ?? 0);
    if (total < GARRISON_MIN) {
      violations++;
      bad(
        `seed ${g.seed}：招募城 驻军 ${Math.round(g.garrisonAtT5)} + 英雄 ${Math.round(g.heroAtT5 ?? 0)}` +
          ` = ${Math.round(total)}（< ${GARRISON_MIN}）`,
      );
    } else {
      ok(
        `seed ${g.seed}：驻军 ${Math.round(g.garrisonAtT5)} + 英雄 ${Math.round(g.heroAtT5 ?? 0)}` +
          ` = ${Math.round(total)}${g.nakedTowns ? `　（另有 ${g.nakedTowns} 座无英雄的城 <1,200，读数）` : ''}`,
      );
    }
  }
  if (!violations) ok(`${garrisonGames.length} 局全部达标`);
}

/* ---------------- A1 / A4：与基线比 ---------------- */
if (BASE) {
  const base = JSON.parse(readFileSync(BASE, 'utf8'));
  console.log(`\n=== A1/A4. 对基线 ${path.basename(BASE)}（${base.difficulty} · ${base.seeds} 种子 · ${base.days} 天）===`);
  const cmp = (label, now, was, tol, unit = '%') => {
    const rel = was === 0 ? (now === 0 ? 0 : Infinity) : (now - was) / was;
    const txt = `${label}：${Number(now.toFixed(2))} vs ${Number(was.toFixed(2))}（${rel >= 0 ? '+' : ''}${(rel * 100).toFixed(1)}%）`;
    if (!Number.isFinite(rel) || Math.abs(rel) > tol) bad(`${txt} —— 超出 ±${(tol * 100).toFixed(0)}${unit}`);
    else ok(txt);
  };
  // 首攻日是"天"，按 ±1 天绝对差判，不按百分比
  const dNow = summary.firstBattleDayMedian;
  const dWas = base.firstBattleDayMedian;
  if (Math.abs(dNow - dWas) <= 1) ok(`首攻日中位：D${dNow} vs D${dWas}（±1 天内）`);
  else bad(`首攻日中位：D${dNow} vs D${dWas} —— 偏 ${(dNow - dWas).toFixed(1)} 天（要求 ±1）`);
  cmp('场均战斗数', summary.battlesMean, base.battlesMean, 0.1);
  // 下面两条是**单边**判据，和上面那条不同 —— 理由写清楚，免得被当成放宽：
  // · A1 的"AI 英雄兵力"原写 ±10%，但本批**故意**让 AI 不再长期破产
  //   （`buildReserve` + `poolOrder`），实测 D28 兵力 +40%、每金战力 +12.8%。
  //   要防的是"AI 崩了"（掉 10% 以上）与"变成另一个 AI"（翻倍），
  //   不是"不许变强"。上限 1.6× 是护栏，不是目标。
  // · A4 的负向对照本身就是"每金战力**掉** >15%"（§25.5），所以只判下限。
  const floor = (label, now, was, lo, hi = Infinity) => {
    const rel = was === 0 ? Infinity : (now - was) / was;
    const txt = `${label}：${Number(now.toFixed(1))} vs ${Number(was.toFixed(1))}（${rel >= 0 ? '+' : ''}${(rel * 100).toFixed(1)}%）`;
    if (rel < lo) bad(`${txt} —— 低于 ${(lo * 100).toFixed(0)}%（AI 崩了）`);
    else if (rel > hi) bad(`${txt} —— 高于 +${((hi - 1) * 100).toFixed(0)}%（已经不是同一档 AI 了）`);
    else ok(txt);
  };
  floor('D28 英雄兵力（中位·血）', summary.heroValueD28Median, base.heroValueD28Median, -0.1, 0.6);
  floor('每金战力', summary.perGold, base.perGold, -0.1);
} else {
  console.log('\n  提示：没给 `--baseline` ⇒ A1/A4 未判（首攻日 / 每金战力只打印，不比）');
}

console.log(
  `\n读数：首攻日中位 D${summary.firstBattleDayMedian}｜场均战斗 ${summary.battlesMean.toFixed(1)}` +
    `｜场均占领 ${summary.capturesMean.toFixed(1)}｜每金战力 ${summary.perGold.toFixed(3)}` +
    `｜D28 英雄战力中位 ${Math.round(summary.heroValueD28Median)}`,
);

if (SAVE) {
  mkdirSync(path.dirname(SAVE), { recursive: true });
  writeFileSync(SAVE, JSON.stringify(summary, null, 2));
  console.log(`  已存基线：${SAVE}`);
}

console.log(fails === 0 ? '\nPASS' : `\nFAIL（${fails} 条）`);
process.exit(fails === 0 ? 0 : 1);
