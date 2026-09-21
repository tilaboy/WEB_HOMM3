/**
 * AI 发育诊断探针（E2）。
 *
 * 玩家反馈「电脑对手啥也不会干，从不建设」。这个脚本不猜，只出证据：
 * 跑无头长局，把每个电脑阵营的**逐日时间序列**打出来——
 *   · 城镇建筑：第几天造出了什么
 *   · 资源：金币/木/矿每天是多少（看它是不是长期贴着 0）
 *   · 部队：英雄+驻军的总血量（看它到底有没有在长兵）
 *   · 英雄轨迹：每天位置、有没有真的离开过主城
 *   · 占矿：第几天占了第一座矿、一共几座
 *   · 逐日日志：AI 这一天的 pushLog 原文
 *
 * 与 ailayout.mjs 的区别：那个只看终局快照，这个看"过程"。终局数字正常
 * 也可能掩盖"第 40 天才动了一下"这类问题。
 *
 * 用法：
 *   node tools/aidiagnose.mjs
 *   SEEDS=3 DAYS=60 node tools/aidiagnose.mjs
 *   POP=1 DAYS=45 SEEDS=1 node tools/aidiagnose.mjs      # 打印逐日明细表
 *   DIFFICULTY=hard SIZE=large LAYOUT=ring node tools/aidiagnose.mjs
 * 产物：
 *   stdout           汇总表 + 关键事件时间线
 *   tools/_aidiagnose.json   全量逐日数据（画图/深挖用）
 *   tools/_aidiagnose.log    全部 AI 相关日志（按天）
 */
import { writeFileSync } from 'node:fs';
import { distDir, distUrl, printHeader, requireFile } from './_dist.mjs';

/* `--dist=<dir>`（缺省 `<repo>/dist` = 旧 `../dist`，**逐字不变**）—— team-lead #164。
 * `requireFile`：缺构建 ⇒ **exit 2 + 友好提示**（与 `smoke`/`b0audit` **同一种红**；不吐模块解析栈）。 */
const DIST = distDir();
printHeader(DIST, 'gate=aidiagnose');
const dimp = (rel) => distUrl(rel, DIST);
requireFile(DIST, 'core/map/generator.js');

const { createGame } = await import(dimp('core/map/generator.js'));
const { endDay } = await import(dimp('core/game/turn.js'));
const { getUnit } = await import(dimp('core/data/units.js'));
const { BUILDINGS } = await import(dimp('core/data/buildings.js'));
const { heroPower } = await import(dimp('core/game/hero.js'));
const { factionName } = await import(dimp('core/data/factions.js'));
const { isEliminated, noTownDaysOf, NO_TOWN_GRACE_DAYS } = await import(dimp('core/game/victory.js'));

const SEEDS = Number(process.env.SEEDS ?? 3);
const DAYS = Number(process.env.DAYS ?? 60);
const DIFFICULTY = process.env.DIFFICULTY ?? 'normal';
const SIZE = process.env.SIZE ?? 'medium';
const LAYOUT = process.env.LAYOUT ?? 'wild';
const OPPONENTS = Number(process.env.OPPONENTS ?? 3);
/** 打印逐日明细的种子数（明细很长，默认只打 1 个）。 */
const POP = Number(process.env.POP ?? 1);

const armyHp = (army) =>
  (army ?? []).reduce((s, st) => s + (st.count > 0 ? st.count * getUnit(st.unitTypeId).hp : 0), 0);
const armyCount = (army) => (army ?? []).reduce((s, st) => s + Math.max(0, st.count), 0);

const mineOwners = (state) =>
  Object.values(state.map.objects).filter((o) => o.kind === 'mine' && o.payload?.owner);

function aiFactions(state) {
  return Object.values(state.players)
    .filter((p) => !p.isHuman)
    .map((p) => p.faction);
}

/** 单个阵营在某一天的快照。 */
function snapshot(state, f) {
  const towns = Object.values(state.towns).filter((t) => t.owner === f);
  const heroes = Object.values(state.heroes).filter((h) => h.owner === f);
  const res = state.players[f]?.resources ?? {};
  const mines = mineOwners(state).filter((o) => o.payload.owner === f);
  return {
    day: state.day,
    eliminated: isEliminated(state, f),
    noTownDays: noTownDaysOf(state, f),
    buildings: towns.flatMap((t) => t.buildings),
    buildingCount: towns.reduce((s, t) => s + t.buildings.length, 0),
    gold: res.gold ?? 0,
    wood: res.wood ?? 0,
    ore: res.ore ?? 0,
    rare: (res.gem ?? 0) + (res.crystal ?? 0) + (res.sulfur ?? 0) + (res.mercury ?? 0),
    // 部队规模：英雄 + 驻军的总血量（跨兵种可比）
    heroHp: heroes.reduce((s, h) => s + armyHp(h.army), 0),
    garrisonHp: towns.reduce((s, t) => s + armyHp(t.garrison), 0),
    heroTroops: heroes.reduce((s, h) => s + armyCount(h.army), 0),
    garrisonTroops: towns.reduce((s, t) => s + armyCount(t.garrison), 0),
    growthPool: towns.reduce(
      (s, t) => s + Object.values(t.growthPool ?? {}).reduce((a, b) => a + b, 0),
      0,
    ),
    towns: towns.length,
    mines: mines.length,
    // 英雄轨迹
    heroes: heroes.map((h) => ({
      id: h.id,
      name: h.name,
      x: h.pos.x,
      y: h.pos.y,
      mp: Math.round(h.movePoints),
      power: Math.round(heroPower(h)),
      troops: armyCount(h.army),
      level: h.level,
      top: (h.army ?? [])
        .slice()
        .sort((a, b) => b.count - a.count)
        .slice(0, 2)
        .map((s) => `${s.unitTypeId}x${s.count}`)
        .join('+'),
    })),
    // 驻军构成（看它有没有把新兵囤在城里）
    garrison: towns.flatMap((t) => (t.garrison ?? []).map((s) => `${s.unitTypeId}x${s.count}`)),
    pool: towns.flatMap((t) =>
      Object.entries(t.growthPool ?? {}).map(([k, v]) => `${k}x${v}`),
    ),
  };
}

const runs = [];
for (let s = 0; s < SEEDS; s++) {
  const seed = 4242 + s * 977;
  const state = createGame({
    seed,
    layout: LAYOUT,
    size: SIZE,
    opponents: OPPONENTS,
    difficulty: DIFFICULTY,
    playerName: '指挥官',
  });

  const homeOf = {};
  const homeName = {};
  for (const t of Object.values(state.towns)) {
    if (t.owner !== 'neutral') {
      homeOf[t.owner] = { x: t.pos.x, y: t.pos.y };
      homeName[t.owner] = t.name;
    }
  }

  const fids = aiFactions(state);
  const series = {};
  for (const f of fids) series[f] = [];

  // 日志：log 只保留最近 60 条，必须逐日抓取，不能终局再读
  const seenLog = new Set();
  const logLines = [];

  for (let d = 0; d < DAYS; d++) {
    endDay(state);
    // 玩家当活靶子：他出局了也要继续推演 AI 的长线行为
    if (state.status !== 'playing') state.status = 'playing';

    for (const e of state.log) {
      const key = `${e.day}|${e.text}`;
      if (seenLog.has(key)) continue;
      seenLog.add(key);
      logLines.push(e);
    }
    for (const f of fids) series[f].push(snapshot(state, f));
  }

  // 从日志里抽关键事件
  const events = {};
  for (const f of fids) {
    const name = factionName(f);
    const names = Object.values(state.towns).filter((t) => t.owner === f).map((t) => t.name);
    const heroNames = Object.values(state.heroes).filter((h) => h.owner === f).map((h) => h.name);
    const mineLogs = logLines.filter((e) => /占领了|夺取了/.test(e.text));
    const buildLogs = logLines.filter(
      (e) => /建成/.test(e.text) && names.some((n) => e.text.includes(n)),
    );
    const recruitLogs = logLines.filter(
      (e) => /补充了|驻军增加了/.test(e.text) && names.some((n) => e.text.includes(n)),
    );
    const mineByFaction = mineLogs.filter((e) => heroNames.some((n) => e.text.startsWith(n)));
    // 英雄到底有没有拿到过补充兵？recruitToHero 的日志是「<城> 为 <英雄> 补充了 …」
    const heroRecruitLogs = logLines.filter(
      (e) => /为 .+ 补充了/.test(e.text) && heroNames.some((n) => e.text.includes(n)),
    );
    // 驻军拿到的补充兵：按"主城名"归属（AI 的主城基本一直握在手里）
    const hn = homeName[f];
    const garrisonRecruitLogs = logLines.filter(
      (e) => /驻军增加了/.test(e.text) && hn && e.text.startsWith(hn),
    );
    // 英雄第一次离开主城
    const home = homeOf[f];
    let firstLeave = null;
    let movedDays = 0;
    for (const snap of series[f]) {
      const away = snap.heroes.some((h) => h.x !== home?.x || h.y !== home?.y);
      if (away) {
        movedDays += 1;
        if (firstLeave === null) firstLeave = snap.day;
      }
    }
    const last = series[f][series[f].length - 1];
    events[f] = {
      factionName: name,
      firstBuild: buildLogs[0]?.day ?? null,
      buildDays: buildLogs.map((e) => ({ day: e.day, text: e.text })),
      firstRecruit: recruitLogs[0]?.day ?? null,
      recruitDays: recruitLogs.map((e) => ({ day: e.day, text: e.text })),
      firstMine: mineByFaction[0]?.day ?? null,
      mineDays: mineByFaction.map((e) => ({ day: e.day, text: e.text })),
      firstHeroLeaveHome: firstLeave,
      heroAwayDays: movedDays,
      /** 最后一次动工的日子：远早于终局 = 中后期建筑线停摆 */
      lastBuildDay: buildLogs.length ? buildLogs[buildLogs.length - 1].day : null,
      lastRecruitDay: recruitLogs.length ? recruitLogs[recruitLogs.length - 1].day : null,
      /** 英雄整个长局里拿到过几次补充兵（recruitToHero） */
      heroRecruitEvents: heroRecruitLogs.length,
      /** 驻军拿到补充兵的次数（recruitToGarrison，全场所有阵营合计） */
      garrisonRecruitEvents: garrisonRecruitLogs.length,
      /** 英雄部队规模的全程峰值：若 ≈ 开局 20，说明它一次都没补到过兵 */
      maxHeroTroops: Math.max(0, ...series[f].map((x) => x.heroTroops)),
      maxHeroHp: Math.max(0, ...series[f].map((x) => x.heroHp)),
      maxGarrisonHp: Math.max(0, ...series[f].map((x) => x.garrisonHp)),
      /** 英雄兵数全程为 0 的天数 */
      daysHeroEmpty: series[f].filter((x) => x.heroes.length === 0 || x.heroTroops === 0).length,
      /** 出局的日子（无城撑满宽限期），null = 整局都在场 */
      eliminatedDay: series[f].find((x) => x.eliminated)?.day ?? null,
      /** 无城天数的全程峰值（看它是不是长期没有城） */
      maxNoTownDays: Math.max(0, ...series[f].map((x) => x.noTownDays ?? 0)),
      /** 终局是否仍是 0 城 */
      endTownless: series[f][series[f].length - 1].towns === 0,
      /** 终局所在场上的英雄数（出局后应为 0：不该留僵尸） */
      endHeroes: series[f][series[f].length - 1].heroes.length,
      // 资源枯竭天数：金币贴着 0 / 木矿贴着 0
      daysGoldUnder200: series[f].filter((x) => x.gold < 200).length,
      daysOreZero: series[f].filter((x) => x.ore === 0).length,
      daysWoodZero: series[f].filter((x) => x.wood === 0).length,
      daysNoHero: series[f].filter((x) => x.heroes.length === 0).length,
      end: {
        day: last.day,
        buildings: last.buildingCount,
        gold: last.gold,
        wood: last.wood,
        ore: last.ore,
        rare: last.rare,
        heroHp: last.heroHp,
        garrisonHp: last.garrisonHp,
        heroTroops: last.heroTroops,
        garrisonTroops: last.garrisonTroops,
        mines: last.mines,
        growthPool: last.growthPool,
        pool: last.pool,
        poolDetail: last.pool.join(' '),
        heroDetail: last.heroes.map((h) => `${h.name} t${h.troops} L${h.level} ${h.top}`).join(' | '),
      },
    };
  }

  runs.push({ seed, fids, series, events, logLines, homeOf });
}

/* ---------------- 输出 ---------------- */

const pad = (v, n) => String(v).padEnd(n);
const num = (v, n) => String(v).padStart(n);

console.log(
  `=== AI 诊断：${SEEDS} 种子 × ${DAYS} 天 · ${LAYOUT}/${SIZE}/${DIFFICULTY} · ${OPPONENTS} 对手 ===\n`,
);

// 1) 汇总表：把多个种子的同一阵营取平均
console.log('【1】终局汇总（多种子平均）');
console.log(
  'day  阵营  城  建筑  金    木   矿   英雄HP  驻军HP  兵总数  占矿  增长池  金币<200天  木=0天  矿=0天  英雄离家天',
);
const allFids = [...new Set(runs.flatMap((r) => r.fids))];
for (const f of allFids) {
  const evs = runs.map((r) => r.events[f]).filter(Boolean);
  const avg = (fn) => evs.reduce((s, e) => s + fn(e), 0) / evs.length;
  const end = (fn) => evs.reduce((s, e) => s + fn(e.end), 0) / evs.length;
  console.log(
    `${num(DAYS, 3)}  ${pad(f, 4)}  ${num(end((x) => x.buildings > 0 ? 1 : 0), 2)}  ` +
      `${num(end((x) => x.buildings).toFixed(1), 4)}  ${num(end((x) => x.gold).toFixed(0), 4)}  ` +
      `${num(end((x) => x.wood).toFixed(1), 4)}  ${num(end((x) => x.ore).toFixed(1), 4)}  ` +
      `${num(end((x) => x.heroHp).toFixed(0), 6)}  ${num(end((x) => x.garrisonHp).toFixed(0), 6)}  ` +
      `${num(end((x) => x.heroTroops + x.garrisonTroops).toFixed(0), 6)}  ` +
      `${num(end((x) => x.mines).toFixed(1), 4)}  ${num(end((x) => x.growthPool).toFixed(0), 6)}  ` +
      `${num(avg((e) => e.daysGoldUnder200), 9)}  ${num(avg((e) => e.daysWoodZero), 6)}  ` +
      `${num(avg((e) => e.daysOreZero), 6)}  ${num(avg((e) => e.heroAwayDays), 10)}`,
  );
}

// 1b) 一行汇总：便于修复前后做机器可比对的 diff
{
  const all = runs.flatMap((r) => Object.values(r.events));
  const sum = (fn) => all.reduce((s, e) => s + fn(e), 0);
  const avg = (fn) => sum(fn) / all.length;
  console.log(
    `AGG 局数=${all.length} ` +
      `建筑数=${avg((e) => e.end.buildings).toFixed(1)} ` +
      `占矿=${avg((e) => e.end.mines).toFixed(1)} ` +
      `英雄兵=${avg((e) => e.end.heroTroops).toFixed(1)} ` +
      `英雄兵峰=${avg((e) => e.maxHeroTroops).toFixed(1)} ` +
      `驻军兵=${avg((e) => e.end.garrisonTroops).toFixed(1)} ` +
      `英雄补兵次数=${avg((e) => e.heroRecruitEvents).toFixed(1)} ` +
      `驻军补兵次数=${avg((e) => e.garrisonRecruitEvents).toFixed(1)} ` +
      `英雄0兵天数=${avg((e) => e.daysHeroEmpty).toFixed(1)}/${DAYS} ` +
      `末建=${avg((e) => e.lastBuildDay ?? 0).toFixed(1)} ` +
      `末募兵=${avg((e) => e.lastRecruitDay ?? 0).toFixed(1)} ` +
      `终局金=${avg((e) => e.end.gold).toFixed(0)} ` +
      `丢城局数=${all.filter((e) => e.endTownless).length} ` +
      `出局局数=${all.filter((e) => e.eliminatedDay !== null).length}`,
  );

  // 1c) 只看"终局仍在场上"的阵营：出局的阵营各项都是 0，会把均值冲淡
  const live = all.filter((e) => e.eliminatedDay === null);
  if (live.length && live.length !== all.length) {
    const lsum = (fn) => live.reduce((s, e) => s + fn(e), 0);
    const lavg = (fn) => lsum(fn) / live.length;
    console.log(
      `AGG-live 存活局数=${live.length}/${all.length} ` +
        `建筑数=${lavg((e) => e.end.buildings).toFixed(1)} ` +
        `占矿=${lavg((e) => e.end.mines).toFixed(1)} ` +
        `英雄兵=${lavg((e) => e.end.heroTroops).toFixed(1)} ` +
        `英雄兵峰=${lavg((e) => e.maxHeroTroops).toFixed(1)} ` +
        `驻军兵=${lavg((e) => e.end.garrisonTroops).toFixed(1)} ` +
        `英雄0兵天数=${lavg((e) => e.daysHeroEmpty).toFixed(1)}/${DAYS} ` +
        `末建=${lavg((e) => e.lastBuildDay ?? 0).toFixed(1)} ` +
        `终局金=${lavg((e) => e.end.gold).toFixed(0)}`,
    );
  }
}

// 2) 关键事件时间线
console.log('\n【2】关键事件时间线（第一次发生的日子，"—" = 整局没发生）');
for (const r of runs) {
  for (const f of r.fids) {
    const e = r.events[f];
    console.log(
      `seed ${r.seed} ${f} ${pad(e.factionName, 6)}：` +
        `首建 ${pad(e.firstBuild ?? '—', 4)} · 末建 ${pad(e.lastBuildDay ?? '—', 4)} · ` +
        `首募兵 ${pad(e.firstRecruit ?? '—', 4)} · 末募兵 ${pad(e.lastRecruitDay ?? '—', 4)} · ` +
        `首占矿 ${pad(e.firstMine ?? '—', 4)} · 首离家 ${pad(e.firstHeroLeaveHome ?? '—', 4)} · ` +
        `建筑数 ${e.end.buildings} · 占矿 ${e.end.mines} · 金 ${e.end.gold} 木 ${e.end.wood} 矿 ${e.end.ore} 稀有 ${e.end.rare}\n` +
        `            英雄兵: 终 ${pad(e.end.heroTroops, 4)} / 峰 ${pad(e.maxHeroTroops, 4)}（开局 20）· ` +
        `驻军兵: 终 ${pad(e.end.garrisonTroops, 4)} / 峰HP ${pad(e.maxGarrisonHp, 5)} · ` +
        `英雄补兵次数 ${pad(e.heroRecruitEvents, 3)} · 驻军补兵次数 ${pad(e.garrisonRecruitEvents, 3)} · ` +
        `英雄0兵天数 ${e.daysHeroEmpty}/${DAYS} · ` +
        (e.eliminatedDay !== null
          ? `**第 ${e.eliminatedDay} 天出局**（无城天数峰 ${e.maxNoTownDays}，终局英雄 ${e.endHeroes}）`
          : `在场（终局英雄 ${e.endHeroes}）`),
    );
  }
}

// 3) 建筑时间线（每个阵营第几天造出了什么）
console.log('\n【3】建造时间线');
for (const r of runs) {
  for (const f of r.fids) {
    const e = r.events[f];
    if (!e.buildDays.length) {
      console.log(`seed ${r.seed} ${f}：**整局一座建筑都没造**`);
      continue;
    }
    const byDay = e.buildDays
      .map((b) => {
        const cn = b.text.match(/「(.+?)」/)?.[1];
        const id = Object.values(BUILDINGS).find((x) => x.name === cn)?.id ?? cn ?? b.text;
        return `D${b.day}:${id}`;
      })
      .join(' ');
    console.log(`seed ${r.seed} ${f}：${byDay}`);
  }
}

// 4) 逐日明细（默认只打第一个种子）
if (POP > 0) {
  console.log(`\n【4】逐日明细（前 ${POP} 个种子）`);
  for (const r of runs.slice(0, POP)) {
    console.log(`\n--- seed ${r.seed} ---`);
    console.log(
      'day 阵营  金    木   矿   英雄HP 驻军HP 兵数 增长池 占矿  英雄(位置/移动力/兵/等级)',
    );
    for (const f of r.fids) {
      for (const x of r.series[f]) {
        const hs = x.heroes.map((h) => `(${h.x},${h.y}) mp${h.mp} t${h.troops} L${h.level}`).join(' ');
        console.log(
          `${num(x.day, 3)} ${pad(f, 4)} ${num(x.gold, 5)} ${num(x.wood, 4)} ${num(x.ore, 4)} ` +
            `${num(x.heroHp, 6)} ${num(x.garrisonHp, 6)} ${num(x.heroTroops + x.garrisonTroops, 4)} ` +
            `${num(x.growthPool, 6)} ${num(x.mines, 4)}  ${hs}`,
        );
      }
      console.log('');
    }
  }
}

// 5) AI 相关日志（按天，仅第一个种子，便于人读）
{
  const r = runs[0];
  const actorNames = new Set();
  for (const f of r.fids) {
    actorNames.add(factionName(f));
    for (const snap of r.series[f]) {
      for (const h of snap.heroes) actorNames.add(h.name);
    }
  }
  const lines = r.logLines.filter(
    (e) =>
      [...actorNames].some((n) => e.text.includes(n)) ||
      /占领了|夺取了|建成|驻军增加了|补充了/.test(e.text),
  );
  console.log(
    `\n【5】AI 相关日志（seed ${r.seed}，共 ${lines.length} 条，完整见 tools/_aidiagnose.log）`,
  );
  for (const e of lines.slice(-60)) console.log(`D${num(e.day, 3)} ${e.text}`);
}

/* ---------------- 落盘 ---------------- */
const raw = runs.map((r) => ({
  seed: r.seed,
  fids: r.fids,
  events: r.events,
  series: r.series,
}));
writeFileSync(new URL('./_aidiagnose.json', import.meta.url), JSON.stringify(raw, null, 1));
writeFileSync(
  new URL('./_aidiagnose.log', import.meta.url),
  runs
    .flatMap((r) => r.logLines.map((e) => `seed${r.seed} D${e.day} ${e.text}`))
    .join('\n'),
);
console.log('\n已写出 tools/_aidiagnose.json 与 tools/_aidiagnose.log');
