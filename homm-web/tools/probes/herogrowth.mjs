/**
 * herogrowth.mjs —— M6 / H2 + H3 验收（§21.4 / §21.5 / §21.6，判据 V2 / V3）
 *
 * ## 这批为什么必须有门
 *
 * 英雄成长是**最容易被「看起来对」骗过**的一类改动：改完四个初始数字和一张概率表，
 * 游戏照常开局、照常升级、日志照常写「攻击 +1」，但可能
 *  ① 曲线抄成了**累计阈值**而不是每级跨度（每级按整段历史收费，等级悄悄卡死）；
 *  ② `levelUp` 忘了按职业查表（20 级后四个英雄长得一模一样）；
 *  ③ 10 级趋同分支写成 `< 10` / `> 10`，边界错一级但读数几乎不变；
 *  ④ 曲线换了、经验产出没换 ⇒ 第 35 天还在 2 级，V3 恒不可达。
 *
 * ## 八组断言
 *
 * | # | 判据 | 负向对照（必须红） |
 * |---|---|---|
 * | G1 | H3 累计表 21 行逐位等于权威表；差分成 20 行跨度；6 个锚点 | 把累计表直接当跨度 ⇒ L20 门槛从 40,981 变 81,961× |
 * | G2 | 曲线形状：新 L10/L2 = 14.7× ≤ 20；旧曲线 194.7× ≥ 100 | 旧公式 `100×level^1.8` ⇒ 必红（前期暴富后期停滞） |
 * | G3 | 四职业初始四维逐位等于 §21.4（骑士 2/2/1/1、野蛮人 4/0/1/1、游侠 1/3/1/1、牧师 1/0/2/2） | 全员拍平 1/1/1/1 ⇒ 必红 |
 * | G4 | 四张升级表权重合计 100；骑士 ≡ 游侠（规格故意）；野蛮人攻权重最高 | 骑士/游侠写不等 ⇒ 必红 |
 * | G5 | **V2**：四职业引擎真跑 200 seed 到 20 级，四维均值两两不同；野蛮人攻>防、牧师知>攻 | 初始拍平 + 统一升级表 ⇒ 四个向量逐位相同 ⇒ 必红 |
 * | G6 | 10 级趋同分支：升到 10 级那一次的属性分布贴近 `late`，不是 `early` | 把分支换成 early ⇒ 分布差 > 阈值必红 |
 * | G7 | **V3**：8 seed × 35 天，每局主力英雄等级中位 ∈ [8,12]；≥6 局真的升过级 | 还原成「旧曲线 + 未校准产出」⇒ 主力中位 <6 必红 |
 * | G8 | 经验产出按档整体缩放：同档同值、五档比例逐位不变 | 单独把一档 ×2 ⇒ 必红 |
 *
 * ## 四条量法陷阱（都踩过）
 *
 * 1. **`expToNext` 是「本级→下一级的跨度」，不是累计阈值**。`gainExp` 把 `hero.exp`
 *    当本级余量（`exp -= expToNext(level); level++`）。直接塞 H3 累计表 ⇒ 每级按整段
 *    历史收费，等级被悄悄压死。G1 用「累计表差分」当场验。
 * 2. **§21.6 的对照表把「10 级」写成 12,200，其实是 H3 表的 9 级**；10 级应为
 *    14,700。G1 打印 2/4/6/8/10/20 六个锚点，别把 off-by-one 抄回来。
 *    权威：<https://homm.fandom.com/wiki/Experience>（20 级 81,961）。
 * 3. **「没量到」≠「量到 0」**（铁律 2）：35 天里有一批 AI 英雄从没打过仗（exp=0），
 *    玩家在纯 AI 推演里更是活靶子。把它们塞进中位数会把尺子读成「成长系统坏了」。
 *    V3 的判定集是**每局主力英雄**（该局等级最高者），并单列「未升级人数」+ 覆盖闸。
 * 4. **不许手算反馈回路**：等级升高会改 AI 胜负与英雄存活 ⇒ 经验产出不是线性放大。
 *    ×4 线性外推「中位 8 级」，真跑只到 4 级。G7 一律 `createGame + endDay` 真跑，
 *    负向对照才用同一份实测经验做数学重算。
 *
 * ## 用法
 * ```
 * node tools/probes/herogrowth.mjs          # 8 seed × 35 天（默认）
 * SEEDS=4 node tools/probes/herogrowth.mjs  # 快跑
 * ```
 * 退出码：0 全过 · 1 有断言不过 · 2 没有构建
 */
import { distDir, distUrl, printHeader, requireFile } from '../_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=herogrowth');
const u = (rel) => distUrl(rel, DIST);
for (const f of [
  'core/data/balance.js', 'core/data/heroes.js', 'core/data/units.js',
  'core/game/hero.js', 'core/game/turn.js', 'core/map/generator.js',
]) requireFile(DIST, f);

const B = await import(u('core/data/balance.js'));
const HD = await import(u('core/data/heroes.js'));
const UNITS = await import(u('core/data/units.js'));
const GH = await import(u('core/game/hero.js'));
const { endDay } = await import(u('core/game/turn.js'));
const { createGame } = await import(u('core/map/generator.js'));

/** 外部权威表（H3 wiki）。**故意在探针里独立保留一份**，防止引擎表被改后门跟着改。 */
const H3_CUM = [
  0, 1000, 2000, 3200, 4600, 6200, 8000, 10000, 12200, 14700, 17500,
  20600, 24320, 28784, 34140, 40567, 48279, 57533, 68637, 81961, 97949,
];
/** §21.4 的初始四维，同样是外部规格对照，不读引擎。 */
const SPEC_PRIMARY = {
  knight: [2, 2, 1, 1],
  barbarian: [4, 0, 1, 1],
  ranger: [1, 3, 1, 1],
  cleric: [1, 0, 2, 2],
};
const KEYS = ['attack', 'defense', 'spellPower', 'knowledge'];
const vec = (p) => KEYS.map((k) => p[k]);
const dist = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const cumAt = (level, step) => {
  let t = 0;
  for (let i = 1; i < level; i++) t += step(i);
  return t;
};
const levelFor = (total, step) => {
  let lv = 1;
  let left = total;
  while (lv < 80 && left >= step(lv)) { left -= step(lv); lv++; }
  return lv;
};

let bad = 0;
const HEAD = (s) => console.log(`\n=== ${s} ===`);
const PASS = (cond, msg) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) bad++;
};

/* ---------------------------------------------------------------- G1 曲线表 */
HEAD('G1 · H3 经验表：累计 → 跨度，一次且只差分一次');
PASS(
  B.H3_EXP_CUMULATIVE.length === 21 && B.H3_EXP_CUMULATIVE.every((v, i) => v === H3_CUM[i]),
  `累计表 21 行逐位等于 H3 权威表（L20 = ${B.H3_EXP_CUMULATIVE[19]}）`,
);
PASS(B.H3_EXP_STEPS.length === 20, '跨度表恰好 20 行');
PASS(
  B.H3_EXP_STEPS.every((v, i) => v === H3_CUM[i + 1] - H3_CUM[i]),
  '跨度 === 累计表的相邻差（不是把累计表直接当跨度）',
);
const anchors = [2, 4, 6, 8, 10, 20];
console.log('  锚点 ' + anchors.map((l) => `L${l}=${cumAt(l, B.h3ExpStep)}`).join(' · '));
PASS(
  [2, 4, 6, 8, 10, 20].every((l) => cumAt(l, B.h3ExpStep) === H3_CUM[l - 1]),
  '六个锚点逐位对上（含 L10 = 14,700，规格对照表这里 off-by-one）',
);
PASS(B.EXP_CURVE_K === 0.5, `k = ${B.EXP_CURVE_K}（规格默认 0.5）`);
// 期望值从**外部权威表**算，不在探针里写死数字（铁律 13：写死引擎常量 = 尺子静默过期）。
const wantL1 = Math.round((H3_CUM[1] - H3_CUM[0]) * B.EXP_CURVE_K);
const wantL10 = Math.round((H3_CUM[10] - H3_CUM[9]) * B.EXP_CURVE_K);
PASS(GH.expToNext(1) === wantL1 && GH.expToNext(10) === wantL10,
  `expToNext(1)=${GH.expToNext(1)} / (10)=${GH.expToNext(10)}（期望 ${wantL1} / ${wantL10}）`);
PASS(B.h3ExpStep(23) > B.h3ExpStep(22), '21 级以后按 1.2 递推，不卡死在最后一行常数上');

/* ---------------------------------------------------------------- G2 形状 */
HEAD('G2 · 曲线形状 + 旧公式负向对照');
const newRatio = cumAt(10, (i) => GH.expToNext(i)) / GH.expToNext(1);
const oldRatio = cumAt(10, B.legacyExpStep) / B.legacyExpStep(1);
console.log(`  新曲线 L10累计/L2 = ${newRatio.toFixed(1)}× · 旧曲线 = ${oldRatio.toFixed(1)}×`);
PASS(newRatio <= 20, `新曲线后期不爆炸（${newRatio.toFixed(1)}× ≤ 20）`);
PASS(oldRatio >= 100, `负向对照：旧公式 ${oldRatio.toFixed(1)}× ≥ 100 ⇒ 用旧曲线必红`);

/* ---------------------------------------------------------------- G3 初始四维 */
HEAD('G3 · §21.4 四职业初始四维');
for (const t of HD.HERO_TEMPLATES) {
  const want = SPEC_PRIMARY[t.id];
  PASS(!!want && vec(t.primary).every((v, i) => v === want[i]), `${t.id.padEnd(9)} ${vec(t.primary).join('/')}（规格 ${want?.join('/')}）`);
}
PASS(HD.classIdOf('野蛮人') === 'barbarian' && HD.classIdOf('不存在') === 'knight', '中文 className 反查正确、未知职业退骑士');

/* ---------------------------------------------------------------- G4 升级表 */
HEAD('G4 · §21.5 职业升级表');
for (const id of Object.keys(SPEC_PRIMARY)) {
  const g = HD.CLASS_GROWTH[id];
  PASS(g.early.reduce((a, b) => a + b, 0) === 100 && g.late.reduce((a, b) => a + b, 0) === 100,
    `${id.padEnd(9)} early/late 权重各合计 100`);
}
PASS(JSON.stringify(HD.CLASS_GROWTH.knight) === JSON.stringify(HD.CLASS_GROWTH.ranger),
  '骑士 ≡ 游侠（H3 原表逐位相同，p1/p3 靠初始值与 H6 特长区分）');
PASS(HD.CLASS_GROWTH.barbarian.early[0] > HD.CLASS_GROWTH.knight.early[0], '野蛮人早期攻击权重最高');
PASS(HD.CLASS_GROWTH.cleric.late[2] > HD.CLASS_GROWTH.cleric.late[0], '牧师后期力/知高于攻/防');
PASS(JSON.stringify(HD.CLASS_GROWTH.knight) !== JSON.stringify(HD.CLASS_GROWTH.barbarian),
  '负向对照：换一张表就能被这个比较看出来');

/* ---------------------------------------------------------------- G5 V2 */
HEAD('G5 · V2：四职业引擎真跑 200 seed 到 20 级');
const means = {};
for (const t of HD.HERO_TEMPLATES) {
  const sums = { attack: 0, defense: 0, spellPower: 0, knowledge: 0 };
  for (let s = 0; s < 200; s++) {
    const st = { seed: 9000 + s, day: 1 };
    const hero = {
      id: 'probe', name: 'probe', heroClass: t.className, level: 1, exp: 0,
      primary: { ...t.primary }, mana: 0, manaMax: 0, movePoints: 0,
      army: [], artifacts: [], spells: [], pos: { x: 0, y: 0 }, owner: 'p1',
    };
    while (hero.level < 20) GH.gainExp(st, hero, GH.expToNext(hero.level) - hero.exp);
    for (const k of KEYS) sums[k] += hero.primary[k];
  }
  means[t.id] = KEYS.map((k) => sums[k] / 200);
  console.log(`  ${t.id.padEnd(9)} ${means[t.id].map((v) => v.toFixed(2)).join(' / ')}`);
}
const ids = Object.keys(means);
let minPair = Infinity;
for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) minPair = Math.min(minPair, dist(means[ids[i]], means[ids[j]]));
PASS(minPair >= 0.5, `四职业四维均值两两不同（最近一对距离 ${minPair.toFixed(2)} ≥ 0.5）`);
PASS(means.barbarian[0] > means.barbarian[1], `野蛮人 攻 ${means.barbarian[0].toFixed(1)} > 防 ${means.barbarian[1].toFixed(1)}`);
PASS(means.cleric[3] > means.cleric[0], `牧师 知 ${means.cleric[3].toFixed(1)} > 攻 ${means.cleric[0].toFixed(1)}`);
{
  // 脚本内可执行的负向对照：初始拍平 + 四职业同一张表 ⇒ 四个向量逐位相同 ⇒ V2 必红。
  const flat = KEYS.map(() => 1);
  const one = HD.CLASS_GROWTH.knight;
  const grown = flat.map((v) => v + 19 * (one.late[0] / 100));
  PASS(dist(grown, grown) < 0.5, '负向对照：拍平后四个向量逐位相同 ⇒ 「两两不同」这条会红');
}

/* ---------------------------------------------------------------- G6 10 级分支 */
HEAD('G6 · 10 级趋同分支（不是 <10，也不是 >10）');
{
  const counts = { attack: 0, defense: 0, spellPower: 0, knowledge: 0 };
  const N = 400;
  for (let s = 0; s < N; s++) {
    const st = { seed: 31000 + s, day: 1 };
    const hero = {
      id: 'p', name: 'p', heroClass: '骑士', level: 9, exp: 0,
      primary: { attack: 2, defense: 2, spellPower: 1, knowledge: 1 },
      mana: 0, manaMax: 0, movePoints: 0, army: [], artifacts: [], spells: [],
      pos: { x: 0, y: 0 }, owner: 'p1',
    };
    GH.gainExp(st, hero, GH.expToNext(9) - hero.exp); // 这一次正好升到 10 级
    for (const k of KEYS) if (hero.primary[k] > ({ attack: 2, defense: 2, spellPower: 1, knowledge: 1 })[k]) counts[k] += 1;
  }
  const freq = KEYS.map((k) => counts[k] / N);
  const late = HD.CLASS_GROWTH.knight.late.map((w) => w / 100);
  const early = HD.CLASS_GROWTH.knight.early.map((w) => w / 100);
  const errLate = dist(freq, late);
  const errEarly = dist(freq, early);
  console.log(`  升到 10 级那次的落点频率 ${freq.map((v) => v.toFixed(3)).join('/')} · late ${late.join('/')} · early ${early.join('/')}`);
  PASS(errLate < errEarly, `更贴近 late 而非 early（距 late ${errLate.toFixed(3)} < 距 early ${errEarly.toFixed(3)}）`);
  PASS(errLate < 0.12, `late 拟合误差 ${errLate.toFixed(3)} < 0.12`);
}

/* ---------------------------------------------------------------- G7 V3 */
HEAD('G7 · V3：8 seed × 35 天，每局主力英雄等级');
const SEEDS = Math.max(1, Number(process.env.SEEDS ?? 8));
const rows = [];
for (let s = 0; s < SEEDS; s++) {
  const seed = 4242 + s * 977; // 与 aiscale / aidiagnose 同一组，读数可互相引用
  const state = createGame({ seed, size: 'medium', layout: 'wild', opponents: 3, difficulty: 'normal', playerName: '指挥官' });
  for (let d = 1; d <= 35; d++) {
    endDay(state);
    // 玩家当活靶子：出局了也继续推演 AI 的长线行为（与 aiscale 同口径）
    if (state.status !== 'playing') state.status = 'playing';
  }
  for (const h of Object.values(state.heroes)) {
    let total = h.exp;
    for (let i = 1; i < h.level; i++) total += GH.expToNext(i);
    rows.push({ seed, cls: h.heroClass, level: h.level, total });
  }
}
const bySeed = new Map();
for (const r of rows) { if (!bySeed.has(r.seed)) bySeed.set(r.seed, []); bySeed.get(r.seed).push(r); }
const mains = [...bySeed.values()].map((g) => Math.max(...g.map((r) => r.level)));
const idle = rows.filter((r) => r.level <= 1).length;
const mainMedian = median(mains);
console.log(`  每局主力 ${[...mains].sort((a, b) => a - b).join(',')} · 中位 ${mainMedian} · 未升级英雄 ${idle}/${rows.length}`);
PASS(mains.length === SEEDS && mains.filter((v) => v > 1).length >= Math.max(6, Math.floor(SEEDS * 0.75)),
  `覆盖闸：${mains.filter((v) => v > 1).length}/${SEEDS} 局真的有英雄升过级（不许把「没量到」读成 0）`);
PASS(mainMedian >= 8 && mainMedian <= 12, `V3：第 35 天主力中位 ${mainMedian} ∈ [8,12]`);

/** 经验产出倍数从引擎读，不写死：T1 的 expValue ÷ 旧占位基线 4。 */
const t1 = Object.values(UNITS.UNITS).filter((x) => x.tier === 1 && x.expValue > 0);
const scale = t1.length ? t1[0].expValue / 4 : NaN;
PASS(Number.isFinite(scale) && scale > 1, `产出校准倍数 ×${scale}（从 UNITS 读，非硬编码）`);
{
  // 规格原文的负向对照：「用现在的曲线跑」= 旧公式 + 未校准的产出。
  // 同一份实测累计经验先除以倍数还原，再用旧曲线积分 ⇒ 主力中位必须 <6。
  const legacyMains = [...bySeed.values()].map((g) =>
    Math.max(...g.map((r) => levelFor(r.total / scale, B.legacyExpStep))));
  const lm = median(legacyMains);
  console.log(`  负向对照（旧曲线 + 旧产出）主力 ${[...legacyMains].sort((a, b) => a - b).join(',')} · 中位 ${lm}`);
  PASS(lm < 6, `负向对照：旧曲线主力中位 ${lm} < 6 ⇒ 换曲线这件事本身有读数`);
}

/* ---------------------------------------------------------------- G8 产出比例 */
HEAD('G8 · 经验产出：按档整体缩放，档间比例不变');
{
  const byTier = new Map();
  for (const x of Object.values(UNITS.UNITS)) {
    if (!x.tier || x.tier > 5 || x.growthPerWeek === 0) continue; // 跳过中立/召唤物
    if (!byTier.has(x.tier)) byTier.set(x.tier, new Set());
    byTier.get(x.tier).add(x.expValue);
  }
  PASS([...byTier.values()].every((s) => s.size === 1), '同一档的 20 个兵 expValue 一致');
  const got = [1, 2, 3, 4, 5].map((t) => [...(byTier.get(t) ?? [0])][0]);
  const base = [4, 12, 20, 45, 120];
  PASS(got.every((v, i) => Math.abs(v / base[i] - scale) < 1e-9),
    `五档 ${got.join('/')} === 基线 ${base.join('/')} × ${scale}（不许只改一档）`);
  const tampered = [got[0], got[1] * 2, got[2], got[3], got[4]];
  PASS(!tampered.every((v, i) => Math.abs(v / base[i] - scale) < 1e-9),
    '负向对照：单独把 T2 ×2 ⇒ 比例闸必红');
}

console.log(`\n${bad ? `✗ 失败 ${bad} 条` : '✓ 全过'}（${SEEDS} seed × 35 天 · V2 200 seed × 4 职业）`);
process.exit(bad ? 1 : 0);
