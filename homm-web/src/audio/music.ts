/**
 * 音乐引擎（`design/audio-direction.md` §8.2 调度器 / §3.1 循环纪律 / §5.2 闪避）。
 *
 * **调度器（§8.2 原样落地）**：
 * ```
 * setInterval(tick, 25ms)                  // 25ms 探视（不用 rAF：后台被节流/暂停）
 * tick:
 *   if (ctx.state !== 'running') { rebase(); return; }   // ← R1 的解法，硬门禁
 *   while (下一事件时间 < ctx.currentTime + 0.120) { 排事件; 推进光标 }
 * ```
 * - **R1 守卫（后台音符雪崩）**：ctx 挂起期间**一个音符都不排**（重基后直接 return）。
 *   恢复后从重基点续播，迟到的事件（>5ms）跳过而不是补播 —— 探针
 *   `tools/probes/tp3-audio.mjs` 用 `lateSkipped`/`notes` 计数器量化验收。
 * - **迟到跳过**是第二道闸：即使某设备 resume 后 currentTime 前跳，也不会一次性
 *   吐出积压（那才是"雪崩"的听感）。
 *
 * **无缝循环（§3.1）**：循环点落在小节线；引擎把每个音符的 dur **钳到本遍结束拍**，
 * 任何延音尾巴都不许过接缝（数据侧由 tools/tp3-scorecheck.mjs 断言双保险）。
 *
 * **交叉淡入淡出（§3.1-3）**：切场景 600–900ms（默认 700ms），不硬切。
 *
 * **抗疲劳（§8.4）**：变体编排按遍循环 —— full → 撤打击 → 旋律降八度 → 只留音乐盒，
 * 且**每第 3 遍开头插 10s 纯环境音留白**（spec 建议 8–12s）。
 * ⚠️ §8.4 的"A/B/A′ 随机排列"未实现：四首曲的段落本身就是 A-A′-B-A″-Coda 的
 * 手写结构，随机排列会破坏动机呈示-展开-回归的叙事；留待试玩反馈再议。
 *
 * **战斗曲不变速**（§3.1-2）：引擎没有任何 playbackRate 入口，速度档碰不到音乐。
 */

import { ac, outMusic, duckMusic, onAudioResume, ctxState, voiceCount, isMusicOn } from './bus.js';
import { playPatch, type PatchId } from './patches.js';
import { noteFreq, secPerBeat, transpose } from './theory.js';
import { getScore } from './scores/index.js';
import type { Score, ScoreId } from './scores/types.js';
import { isLoop, loopBeats, loopStartBeat, totalBeats } from './scores/types.js';

/* ---------------- 事件模型 ---------------- */

interface Ev {
  beat: number;
  pitch: string;
  dur: number;
  patch: PatchId;
  gain: number;
}

/** §8.4 变体编排（按遍循环）。 */
type Arrangement = 'full' | 'noPerc' | 'octaveDown' | 'musicboxOnly';

function arrangementFor(pass: number): Arrangement {
  const v = pass % 4;
  if (v === 1) return 'noPerc';
  if (v === 2) return 'octaveDown';
  if (v === 3) return 'musicboxOnly';
  return 'full';
}

/** 每遍留白（§8.4：每 3 个循环后 8–12s 纯环境音）。第 3/6/9… 遍的开头静默 10s。 */
const REST_SEC = 10;

interface Player {
  id: ScoreId;
  score: Score;
  gain: GainNode;
  spb: number;
  /** 本遍事件相对曲首的拍偏移（pass 0 = 0；pass k = loopStart + (k-1)·loopBeats） */
  beatOffset: number;
  /** 本遍结束的绝对拍（循环钳制目标） */
  passEnd: number;
  pass: number;
  events: Ev[];
  cursor: number;
  /** 本遍留白截止的相对拍（< 它的事件全跳过） */
  restBeats: number;
  startTime: number;
  stopping: boolean;
}

const players = new Set<Player>();

/* ---------------- 计数器（探针读它们证明"引擎在干活/没雪崩"） ---------------- */

let notesScheduled = 0;
let lateSkipped = 0;
let restSkipped = 0;
let suspendedTicks = 0;
let ticks = 0;

/* ---------------- 事件构建 ---------------- */

function melodyPatchOf(s: Score): PatchId {
  if (s.id === 'victory') return 'horn';
  if (s.id === 'defeat') return 'lute';
  return 'musicbox';
}

/** 把一曲数据展开成一遍的绝对拍事件表（intro 只在 pass 0）。 */
function buildEvents(s: Score, pass: number): Ev[] {
  const evs: Ev[] = [];
  const g = s.gains ?? {};
  const mbGain = g.musicbox ?? 0.34;
  const luteGain = g.lute ?? 0.3;
  const percGain = g.woodblock ?? 0.2;
  const peckGain = g.peck ?? 0.2;
  const patch = melodyPatchOf(s);
  // sting 不循环、只奏一遍 ⇒ 恒定 full 编排（闪过的荒诞只许出现一次）
  const arr: Arrangement = isLoop(s) ? arrangementFor(pass) : 'full';
  const shift = pass > 0 ? loopStartBeat(s) : 0;
  const semi = arr === 'octaveDown' ? -12 : 0;

  for (const [b, p, d] of s.melody) {
    if (pass > 0 && b < shift) continue; // intro 只在第 0 遍
    if (arr === 'musicboxOnly' && patch !== 'musicbox') continue;
    evs.push({ beat: b - shift, pitch: transpose(p, semi), dur: d, patch, gain: mbGain });
  }

  if (arr !== 'musicboxOnly') {
    const m = s.meter[0];
    for (let bar = 0; bar < s.bars; bar++) {
      if (pass > 0 && bar * m < shift) continue;
      const ch = s.chords[bar];
      if (!ch) continue;
      const b0 = bar * m - shift;
      // 和弦音：拍 0 全奏（dur 2 拍）+ 拍 2 挑高音（dur 1 拍）—— 拨奏的呼吸感
      for (const n of ch) evs.push({ beat: b0, pitch: n, dur: 2, patch: 'lute', gain: luteGain });
      evs.push({ beat: b0 + 2, pitch: ch[ch.length - 1], dur: 1, patch: 'lute', gain: luteGain * 0.8 });
    }
  }

  if (arr === 'full' || arr === 'octaveDown') {
    const m = s.meter[0];
    for (let bar = 0; bar < s.bars; bar++) {
      if (pass > 0 && bar * m < shift) continue;
      const pat = s.perc[bar];
      if (!pat) continue;
      const b0 = bar * m - shift;
      for (let slot = 0; slot < pat.length; slot++) {
        const c = pat[slot];
        if (c === '.') continue;
        const isPeck = c === 'p';
        evs.push({
          beat: b0 + slot * 0.5,
          pitch: '--', // 打击/鸡啄不用音高（playPatch 对噪声类音色不查 freq）
          dur: 0.5,
          patch: isPeck ? 'peck' : 'woodblock',
          gain: isPeck ? peckGain : c === 'X' ? percGain * 1.15 : percGain,
        });
      }
    }
  }

  evs.sort((a, b) => a.beat - b.beat);
  return evs;
}

/* ---------------- 播放器 ---------------- */

function createPlayer(score: Score): Player | null {
  const c = ac();
  const dest = outMusic();
  if (!c || !dest) return null;
  const g = c.createGain();
  g.gain.value = 0.0001;
  g.connect(dest);
  const p: Player = {
    id: score.id,
    score,
    gain: g,
    spb: secPerBeat(score.bpm),
    beatOffset: 0,
    passEnd: totalBeats(score),
    pass: 0,
    events: [],
    cursor: 0,
    restBeats: 0,
    startTime: c.currentTime + 0.05,
    stopping: false,
  };
  p.events = buildEvents(score, 0);
  return p;
}

function nextPass(p: Player): void {
  p.pass += 1;
  p.beatOffset = p.pass === 0 ? 0 : loopStartBeat(p.score) + (p.pass - 1) * loopBeats(p.score);
  p.passEnd = p.beatOffset + (p.pass === 0 ? totalBeats(p.score) : loopBeats(p.score));
  p.events = buildEvents(p.score, p.pass);
  p.cursor = 0;
  // §8.4 留白：每第 3 遍开头 10s 纯环境音
  p.restBeats = p.pass > 0 && p.pass % 3 === 0 ? REST_SEC / p.spb : 0;
  // ⚠️ 绝不在此时改 startTime：时间模型是「startTime = 绝对拍 0 的时刻」，
  // 新一遍的绝对拍已由 beatOffset 承接（上一遍最后一个事件的绝对拍 +1）。
  // 在这里重基会把之后每一遍都推迟一个 intro 的量（2026-10-18 修）。
}

/* ---------------- 调度器 ---------------- */

const TICK_MS = 25;
const LOOKAHEAD = 0.12; // 120ms 调度窗口（§8.2）
let timer: number | null = null;

function ensureScheduler(): void {
  if (timer !== null) return;
  timer = setInterval(tick, TICK_MS) as unknown as number;
}

function maybeStopScheduler(): void {
  if (timer !== null && players.size === 0) {
    clearInterval(timer);
    timer = null;
  }
}

/** R1：重基到"下一未排事件 = now + 60ms"，**不排任何音符**。 */
function rebaseAll(c: AudioContext): void {
  for (const p of players) {
    const ev = p.events[Math.min(p.cursor, p.events.length - 1)];
    // 绝对拍 = beatOffset + 事件的本遍相对拍（漏了 beatOffset 会把恢复点算早一个
    // intro 的量 —— 2026-10-18 修）。
    const absBeat = ev ? p.beatOffset + ev.beat : p.beatOffset;
    p.startTime = c.currentTime + 0.06 - absBeat * p.spb;
  }
}

function tick(): void {
  const c = ac();
  if (!c) return;
  ticks++;
  // R1 硬门禁（§8.2 伪码原样）：挂起期间不排音符 —— 否则恢复瞬间补播积压 = 雪崩。
  if (c.state !== 'running') {
    suspendedTicks++;
    rebaseAll(c);
    return;
  }
  const horizon = c.currentTime + LOOKAHEAD;
  for (const p of [...players]) {
    if (p.stopping) continue;
    // 落后（恢复/主线程卡顿）⇒ 丢迟到事件而不是补播（第二道闸）
    for (;;) {
      if (p.cursor >= p.events.length) {
        if (isLoop(p.score)) {
          nextPass(p);
          if (p.events.length === 0) break;
        } else {
          p.stopping = true; // sting 奏完自然退场
          fadeOut(p, 0.4);
          break;
        }
      }
      const ev = p.events[p.cursor];
      const t = p.startTime + (p.beatOffset + ev.beat) * p.spb;
      if (t >= horizon) break;
      p.cursor++;
      if (t < c.currentTime - 0.005) {
        lateSkipped++; // 迟到 >5ms ⇒ 跳过（绝不补播）
        continue;
      }
      if (ev.beat < p.restBeats) {
        restSkipped++; // 留白段（§8.4）
        continue;
      }
      scheduleEvent(p, ev, t, c);
    }
  }
  maybeStopScheduler();
}

function scheduleEvent(p: Player, ev: Ev, t: number, c: AudioContext): void {
  let dur = ev.dur * p.spb;
  // 无缝循环（§3.1）：dur 钳到本遍结束拍，延音尾巴不过接缝
  const endBeat = p.beatOffset + ev.beat + ev.dur;
  if (endBeat > p.passEnd) dur = Math.max(0.05, (p.passEnd - (p.beatOffset + ev.beat)) * p.spb);
  playPatch(ev.patch, c, p.gain, noteFreq(ev.pitch), t, dur, ev.gain);
  notesScheduled++;
}

/* ---------------- 公开 API ---------------- */

function fadeOut(p: Player, sec: number): void {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  p.stopping = true;
  p.gain.gain.cancelScheduledValues(t);
  p.gain.gain.setValueAtTime(Math.max(0.0001, p.gain.gain.value), t);
  p.gain.gain.linearRampToValueAtTime(0.0001, t + sec);
  const death = setTimeout(() => players.delete(p), sec * 1000 + 150);
  void death;
}

/**
 * 播放场景曲（幂等：同一首已在播就不重启，避免地图内重复触发把循环进度清零）。
 * 切场景 = 交叉淡入淡出（默认 700ms，§3.1-3 的 600–900ms 中值）。
 */
export function play(id: ScoreId, fadeSec = 0.7): void {
  const c = ac();
  if (!c) return;
  if ([...players].some((p) => p.id === id && !p.stopping)) return; // 已在播
  const score = getScore(id);
  const player = createPlayer(score);
  if (!player) return;
  players.add(player);
  ensureScheduler();
  const t = c.currentTime;
  player.gain.gain.setValueAtTime(0.0001, t);
  player.gain.gain.linearRampToValueAtTime(1, t + fadeSec);
  // 旧的（含可能的 sting）交叉淡出
  for (const old of [...players]) {
    if (old === player || old.stopping) continue;
    old.gain.gain.cancelScheduledValues(t);
    old.gain.gain.setValueAtTime(Math.max(0.0001, old.gain.gain.value), t);
    old.gain.gain.linearRampToValueAtTime(0.0001, t + fadeSec);
    old.stopping = true;
    const death = setTimeout(() => players.delete(old), fadeSec * 1000 + 150);
    void death;
  }
}

/** 停掉全部音乐（交叉淡出）。 */
export function stop(fadeSec = 0.7): void {
  if (players.size === 0) return;
  for (const p of [...players]) fadeOut(p, fadeSec);
}

/**
 * 结算 sting（§5.4 方案 i）：`sfx.win/lose` 的即时反馈之后 600ms 叠加。
 * 闪避当前音乐 0.6×（§5.2：win/lose 属于"该让位"的低密度重要事件）。
 */
export function sting(id: 'victory' | 'defeat', delaySec = 0.6): void {
  duckMusic();
  const fire = (): void => {
    const c = ac();
    if (!c) return;
    if ([...players].some((p) => p.id === id && !p.stopping)) return;
    const player = createPlayer(getScore(id));
    if (!player) return;
    players.add(player);
    ensureScheduler();
    const t = c.currentTime;
    player.gain.gain.setValueAtTime(0.0001, t);
    player.gain.gain.linearRampToValueAtTime(1, t + 0.05);
  };
  if (delaySec <= 0) fire();
  else setTimeout(fire, delaySec * 1000);
}

/* ---------------- R1：恢复即重基 ---------------- */

onAudioResume(() => {
  const c = ac();
  if (c) rebaseAll(c);
});

/* ---------------- 调试表面（?devprobe=1 才挂，探针专用） ---------------- */

export interface MusicDebugState {
  ctx: string;
  players: { id: ScoreId; pass: number; stopping: boolean; gain: number }[];
  notes: number;
  late: number;
  rest: number;
  suspendedTicks: number;
  ticks: number;
  voices: number;
  musicOn: boolean;
}

export function musicDebug(): MusicDebugState {
  return {
    ctx: ctxState(),
    players: [...players].map((p) => ({ id: p.id, pass: p.pass, stopping: p.stopping, gain: p.gain.gain.value })),
    notes: notesScheduled,
    late: lateSkipped,
    rest: restSkipped,
    suspendedTicks,
    ticks,
    voices: voiceCount(),
    musicOn: isMusicOn(),
  };
}

if (typeof window !== 'undefined' && location.search.includes('devprobe')) {
  (window as unknown as { __musicDebug: () => MusicDebugState }).__musicDebug = musicDebug;
  (window as unknown as { __musicCtl: unknown }).__musicCtl = { play, stop, sting };
}

/** 测试/热更用：清空全部播放器与计数器。 */
export function resetMusicForTest(): void {
  players.clear();
  notesScheduled = 0;
  lateSkipped = 0;
  restSkipped = 0;
  suspendedTicks = 0;
  ticks = 0;
}
