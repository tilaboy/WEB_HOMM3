/**
 * tp3-scorecheck.mjs —— TP-3 曲目数据不变量（零依赖，纯 node，非门控脚本但可当门用）。
 *
 * 断言的每一条都对应 `design/audio-direction.md` 的一条**成文纪律**，不是"我觉得对"：
 *
 *  - §3.1-1 无缝循环：循环点落在小节线，**任何音符不得跨循环点延音**
 *    （引擎侧也有钳制，这里是数据侧双保险——钳制会改音长，静默钳一下也是 bug）。
 *  - §3 曲目清单时长：menu 90–120s / map 120s / battle 60–75s / town 45–60s /
 *    victory·defeat 8–12s（ sting 不循环）。
 *  - §8.4 抗疲劳：map 旋律密度 ≤2 音/秒。
 *  - §2.4 喜剧配额表：menu 每 40s **整曲仅 1 处**低半音错误音（Bb4）；map 每 ~40s
 *    一处"拍外打击"（`.x....` 早一个八分）共 3 处；town 每 25s 一处鸡啄（`p`）共 1 处；
 *    **battle / defeat 零笑点**；victory 整段 1 处（第 6 音低半音 Eb5）。
 *  - §10.3 数据格式：chords/perc 长度 = bars；perc 模式字符 ∈ {X,x,.,p} 且
 *    长度 = 拍号×2（3/4 = 6 个八分位）；音名可解析（'--' 除外）。
 *
 * 用法：node tools/tp3-scorecheck.mjs（读 dist/audio/scores/index.js ⇒ 先 npm run build）
 * 退出码：0 = 全过；1 = 有断言失败。
 */

import { SCORES } from '../dist/audio/scores/index.js';
import { isLoop, loopBeats, loopStartBeat, totalBeats } from '../dist/audio/scores/types.js';

/* 音名 → 频率（与 src/audio/theory.ts 同算法；这里只验"可解析"） */
function noteFreq(name) {
  if (name === '--' || name === '') return 0;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return NaN;
  const semi = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midi = (Number(m[3]) + 1) * 12 + semi[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

let failures = 0;
function check(cond, label, detail = '') {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.log(`  ❌ ${label}${detail ? ` —— ${detail}` : ''}`);
  }
}

/** 时长目标（秒）：[循环体下限, 循环体上限]；sting 用总时长。 */
const DUR = {
  menu: [90, 120],
  map: [108, 132],
  battle: [60, 75],
  town: [45, 60],
  victory: [8, 12],
  defeat: [8, 12],
};

console.log('=== TP-3 曲目不变量（audio-direction.md §3.1 / §3 / §8.4 / §2.4）===');
const ids = Object.keys(SCORES);
check(ids.length === 6 && ids.every((k) => ['menu', 'map', 'battle', 'town', 'victory', 'defeat'].includes(k)), '注册表 6 首齐全', `实际 ${ids.join('/')}`);

for (const id of ids) {
  const s = SCORES[id];
  const spb = 60 / s.bpm;
  const bar = s.meter[0] * spb;
  console.log(`\n--- ${id}（${s.bpm}bpm ${s.meter[0]}/4 · ${s.bars} 小节 · loopFrom=${s.loopFrom}）---`);

  check(s.bpm > 0 && s.meter[0] === 3 && s.meter[1] === 4, '拍号 3/4 且 bpm 合法');
  check(s.chords.length === s.bars, 'chords 长度 = bars', `${s.chords.length} vs ${s.bars}`);
  check(s.perc.length === s.bars, 'perc 长度 = bars', `${s.perc.length} vs ${s.bars}`);
  const badPerc = s.perc.filter((p) => typeof p !== 'string' || p.length !== 6 || /[^Xx.p]/.test(p));
  check(badPerc.length === 0, 'perc 模式 = 6 字符且仅含 X/x/./p', `坏模式 ${badPerc.length} 个`);

  // §3.1-1 无缝循环：无音符跨循环点 / 跨曲尾
  const lsb = loopStartBeat(s);
  const tb = totalBeats(s);
  const crossLoop = s.melody.filter(([b, , d]) => (isLoop(s) ? b < lsb && b + d > lsb : false));
  const crossEnd = s.melody.filter(([b, , d]) => b + d > tb + 1e-9);
  check(crossLoop.length === 0, '无音符跨循环点延音', `越界 ${crossLoop.length} 个：${crossLoop.slice(0, 3).map((n) => n.join(':')).join(' ')}`);
  check(crossEnd.length === 0, '无音符跨曲尾', `越界 ${crossEnd.length} 个`);
  const badPitch = s.melody.filter(([, p]) => !(p === '--' || noteFreq(p) > 0));
  check(badPitch.length === 0, '旋律音名全部可解析', `坏音名 ${badPitch.length} 个`);
  const badChord = s.chords.flat().filter((n) => n !== null && !(noteFreq(n) > 0));
  check(badChord.length === 0, '和弦音名全部可解析', `坏音名 ${badChord.length} 个`);
  const sorted = s.melody.every(([b], i, a) => i === 0 || b >= a[i - 1][0]);
  check(sorted, '旋律按拍升序（数据可读性）');

  // §3 时长
  const [lo, hi] = DUR[id];
  const sec = (isLoop(s) ? loopBeats(s) : tb) * spb;
  check(sec >= lo && sec <= hi, `时长 ${lo}–${hi}s`, `实测 ${sec.toFixed(1)}s`);

  // §2.4 喜剧配额（按曲目逐个判，判据各不相同）
  const acc = s.melody.filter(([, p]) => /[#b]/.test(p));
  if (id === 'menu') {
    check(acc.length === 1 && acc[0][1] === 'Bb4', 'menu 恰 1 处低半音错误音（Bb4，§2.4 每 40s 一处）', `实际 ${acc.length} 处：${acc.map((n) => n[1]).join(',') || '无'}`);
  } else if (id === 'map') {
    const gags = s.perc.filter((p) => p === '.x....').length;
    check(acc.length === 0 && gags === 3, 'map 恰 3 处拍外打击（.x....）且无错误音', `拍外 ${gags} 处 / 错误音 ${acc.length} 处`);
    const bodyNotes = s.melody.filter(([b]) => b >= lsb).length;
    const density = bodyNotes / (loopBeats(s) * spb);
    check(density <= 2, 'map 旋律密度 ≤2 音/秒（§8.4 抗疲劳）', `实测 ${density.toFixed(2)} 音/秒`);
  } else if (id === 'town') {
    const pecks = s.perc.join('').split('').filter((c) => c === 'p').length;
    check(pecks === 1, 'town 恰 1 处鸡啄（§2.4 每 25s 一处）', `实际 ${pecks} 处`);
  } else if (id === 'battle') {
    check(acc.length === 0 && !s.perc.join('').includes('p'), 'battle 零笑点（§2.4 配额表：战斗要紧张）', `错误音 ${acc.length} / 鸡啄 ${s.perc.join('').includes('p')}`);
  } else if (id === 'victory') {
    check(acc.length === 1 && acc[0][1] === 'Eb5', 'victory 恰 1 处：第 6 音低半音（Eb5，§2.4/§5.4）', `实际 ${acc.length} 处：${acc.map((n) => n[1]).join(',') || '无'}`);
  } else if (id === 'defeat') {
    check(acc.length === 0 && !s.perc.join('').includes('p'), 'defeat 零笑点', `错误音 ${acc.length}`);
  }

  // sting 不循环；正曲循环
  check(isLoop(s) === (id !== 'victory' && id !== 'defeat'), '循环属性符合曲目类型（sting 不循环）');
}

console.log(`\n${failures === 0 ? '✅ 曲目不变量全过' : `❌ ${failures} 条不过`}`);
process.exit(failures === 0 ? 0 : 1);
