/**
 * tp7-aidays.mjs —— TP-7 验证探针（非门控，进 tools/probes/）。
 *
 * 验 F-2.2「过天看得见 AI 活动 + 英雄生死可知」的结构化正确性：
 *   A. grims（3 对手）连过 N 天，逐天 dump `aiEvents()`；
 *   B. 断言：每个事件的 text 字段非空；kind 合法；
 *   C. 断言：凡是 death 事件提到的英雄，当天结束时确实不在 state.heroes 里
 *      （防止"报了死亡但其实没死"的假阳性）；
 *   D. 反向自检：tutorial（0 对手）过天 ⇒ aiEvents 必须为空（防止恒绿）；
 *   E. 玩家英雄若在跑动中阵亡，必须有一条 vsPlayer 的 death 事件。
 *
 * 读数绑构建：跑前打 dist 指纹。
 */
import { createHash } from 'node:crypto';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../../dist/', import.meta.url).pathname;
const { createGame } = await import(DIST + 'core/map/generator.js');
const { endDay } = await import(DIST + 'core/game/turn.js');
const { aiEvents } = await import(DIST + 'core/game/aiReport.js');

function distFingerprint() {
  const h = createHash('sha256');
  let count = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        h.update(name);
        h.update(readFileSync(p));
        count++;
      }
    }
  };
  walk(DIST);
  return `${h.digest('hex').slice(0, 12)} (${count} 文件)`;
}

const KIND_SET = new Set(['move', 'battle', 'capture', 'hire', 'death', 'out']);
let fail = 0;
const bad = (msg) => {
  console.log('  ❌ ' + msg);
  fail++;
};

console.log('dist 指纹: ' + distFingerprint());

/* ---------- A/B/C：grims 连过 12 天 ---------- */
console.log('\n=== grims-showcase 连过 12 天（逐天 dump）===');
const state = createGame({
  size: 'large', layout: 'wild', seed: 2175, opponents: 3,
  difficulty: 'normal', scenario: 'grims-showcase',
});
for (let d = 1; d <= 12 && state.status === 'playing'; d++) {
  endDay(state);
  const evs = aiEvents();
  const day = state.day;
  console.log(`D${day} (${evs.length} 条)`);
  for (const e of evs) {
    console.log(`   [${e.kind}] ${e.player}${e.vsPlayer ? '★' : ''} ${e.hero ? e.hero + ' ' : ''}${e.what}${e.detail ? `（${e.detail}）` : ''}`);
    if (!KIND_SET.has(e.kind)) bad(`未知 kind: ${e.kind}`);
    if (!e.what) bad(`事件 what 为空: ${JSON.stringify(e)}`);
    // capture 必须带 hero（否则"占领金矿"不知道是谁干的）；detail 允许为空（城镇类把动词并进 what）
    if (e.kind === 'capture' && !e.hero) bad(`capture 事件缺 hero: ${JSON.stringify(e)}`);
    if (!e.detail && e.kind !== 'capture') bad(`事件 detail 为空: ${JSON.stringify(e)}`);
  }
  // C：death 事件的英雄当天结束必须真的不在场
  for (const e of evs) {
    if (e.kind !== 'death') continue;
    const alive = Object.values(state.heroes).some((h) => h.name === e.what);
    if (alive) bad(`D${day} 报了 ${e.what} 阵亡，但他还在 state.heroes 里`);
  }
}
const stats = { move: 0, battle: 0, capture: 0, hire: 0, death: 0, out: 0, vsPlayer: 0 };
// 重跑一遍统计 + E：挂机跑到终局（≤40 天）。本 seed 下 AI 第 7 天攻陷玩家主城、
// 第 8 天击杀玩家英雄 —— 正好覆盖 F-2.2 的两个核心场景。
const state2 = createGame({
  size: 'large', layout: 'wild', seed: 2175, opponents: 3,
  difficulty: 'normal', scenario: 'grims-showcase',
});
let sawPlayerDeath = false;
let sawPlayerAssetLost = false;
for (let d = 0; d < 40 && state2.status === 'playing'; d++) {
  endDay(state2);
  for (const e of aiEvents()) {
    stats[e.kind]++;
    if (e.vsPlayer) stats.vsPlayer++;
    if (e.kind === 'death' && e.vsPlayer) sawPlayerDeath = true;
    if (e.kind === 'capture' && e.vsPlayer) sawPlayerAssetLost = true;
  }
}
console.log(`\n挂机 ${state2.day} 天到终局（status=${state2.status}）累计: ` + JSON.stringify(stats));
if (stats.move === 0) bad('零移动事件 —— AI 根本没在记');
if (stats.battle === 0 && stats.capture === 0) bad('零交战/占领 —— 事件面太窄，F-2.2 的"敌方活动"不成立');
if (!sawPlayerAssetLost) bad('挂机到终局都没出现"玩家资产易主"事件 —— vsPlayer 捕获路径没验到');
if (!sawPlayerDeath) bad('挂机到终局都没出现"玩家英雄阵亡"事件 —— F-2.2 核心场景没验到');

/* ---------- D：反向自检（tutorial 0 对手必须零事件） ---------- */
console.log('\n=== 反向自检：tutorial（0 对手）===');
const tut = createGame({ size: 'small', layout: 'wild', seed: 247944, opponents: 0, difficulty: 'easy', scenario: 'tutorial' });
endDay(tut);
const tutEvs = aiEvents();
console.log(`tutorial 过 1 天: ${tutEvs.length} 条事件`);
if (tutEvs.length !== 0) bad(`0 对手图不该有 AI 事件，却有 ${tutEvs.length} 条`);

/* ---------- E：duel 冒烟（另一张图、另一种 AI 配置下不崩、不漏记） ---------- */
console.log('\n=== duel 冒烟（1 对手 rush，挂机 60 天）===');
const duel = createGame({ size: 'medium', layout: 'ring', seed: 170774, opponents: 1, difficulty: 'normal', scenario: 'duel' });
let duelEvents = 0;
for (let d = 0; d < 60 && duel.status === 'playing'; d++) {
  endDay(duel);
  for (const e of aiEvents()) {
    duelEvents++;
    if (!e.what) bad(`duel 事件 what 为空: ${JSON.stringify(e)}`);
    if (!KIND_SET.has(e.kind)) bad(`duel 未知 kind: ${e.kind}`);
  }
}
console.log(`duel 挂机 ${duel.day} 天: status=${duel.status} | 累计 ${duelEvents} 条事件`);
if (duelEvents === 0) bad('duel 60 天零事件 —— rush AI 什么都没记上');

console.log('\n' + (fail === 0 ? '✅ TP-7 结构断言全过' : `❌ ${fail} 条断言失败`));
process.exit(fail === 0 ? 0 : 1);
