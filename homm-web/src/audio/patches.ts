/**
 * 程序化音色（`design/audio-direction.md` §2.1 / §6.2 音色成本表）。
 *
 * 全部零素材、现场合成。四个正曲音色 + 一个喜剧音色：
 *  - `musicbox`  音乐盒/钢片琴：正弦 + 泛音列 + 指数衰减。**本作的签名音色**（§2.1）。
 *  - `lute`      Karplus–Strong 拨弦：噪声脉冲 → 延迟线 + 一阶低通反馈。最像
 *               "中世纪"的廉价方案（§6.2 强烈推荐）。
 *  - `woodblock` 木块/响板：带通噪声 + 极短包络。
 *  - `horn`      号角（仅 sting 用）：锯齿 + 滤波包络 + 微失谐双层。§6.2 判定"凑合"，
 *               所以只做短动机、不铺底。
 *  - `peck`      鸡啄（城镇喜剧点，§2.4）：比 woodblock 更轻的带通噪声，音量约 1/4。
 *
 * ⚠️ 与规格的一处**有据偏离**：§2.1 写音乐盒"20–40ms 指数衰减"——那是"叮"的起振
 * 质感；旋律音若只给 40ms 尾巴，曲调根本立不起来（听成雨点）。实现取
 * `decay = clamp(时值, 0.12, 0.9)s` + 指数曲线：音乐盒性格保留，旋律可唱。
 */

import { beginVoice } from './bus.js';

export type PatchId = 'musicbox' | 'lute' | 'woodblock' | 'horn' | 'peck';

/** 共享短噪声 buffer 缓存（§8.2：预生成复用，别每次逐样本 Math.random）。 */
const noiseCache = new Map<number, AudioBuffer>();

function noiseBuffer(c: AudioContext, ms: number): AudioBuffer {
  const key = ms;
  const hit = noiseCache.get(key);
  if (hit) return hit;
  const len = Math.max(1, Math.ceil((c.sampleRate * ms) / 1000));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseCache.set(key, buf);
  return buf;
}

/** 音乐盒 / 钢片琴。 */
function playMusicbox(c: AudioContext, dest: AudioNode, freq: number, t0: number, dur: number, gain: number): void {
  const decay = Math.max(0.12, Math.min(dur, 0.9));
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
  const stopAll = (): void => {
    for (const o of partials) {
      try {
        o.stop();
      } catch {
        /* ignore */
      }
    }
  };
  const partials: OscillatorNode[] = [];
  // 基频 + 两个泛音（钢片琴的"金属叮"来自泛音，不是来自波形）
  for (const [mul, gv] of [
    [1, 1],
    [2, 0.28],
    [3, 0.08],
  ] as const) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq * mul;
    const pg = c.createGain();
    pg.gain.value = gv;
    o.connect(pg).connect(g);
    partials.push(o);
    o.start(t0);
    o.stop(t0 + decay + 0.05);
  }
  g.connect(dest);
  beginVoice(partials[0], stopAll);
}

/** Karplus–Strong 拨弦（鲁特琴/竖琴）。 */
function playLute(c: AudioContext, dest: AudioNode, freq: number, t0: number, dur: number, gain: number): void {
  const sr = c.sampleRate;
  const N = Math.max(2, Math.round(sr / freq));
  const total = Math.max(1, Math.ceil(sr * dur));
  const buf = c.createBuffer(1, total, sr);
  const out = buf.getChannelData(0);
  // 激励 = 一阶低通滤波后的噪声（柔化"指甲"感）
  const line = new Float32Array(N);
  let last = 0;
  for (let i = 0; i < N; i++) {
    const w = Math.random() * 2 - 1;
    last = 0.5 * w + 0.5 * last;
    line[i] = last;
  }
  const decay = 0.9965; // 反馈衰减 ⇒ 音长
  for (let i = 0; i < total; i++) {
    if (i < N) {
      out[i] = line[i];
      continue;
    }
    const a = out[i - N];
    const b = out[i - N + 1];
    out[i] = decay * 0.5 * (a + b);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(g).connect(dest);
  beginVoice(src, () => {
    try {
      src.stop();
    } catch {
      /* ignore */
    }
  });
  src.start(t0);
}

/** 木块 / 响板。center = 带通中心频率（Hz），q = 品质因数。 */
function playWood(c: AudioContext, dest: AudioNode, _freq: number, t0: number, dur: number, gain: number, center: number, q: number): void {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, Math.max(30, Math.ceil(dur * 1000)));
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = center;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(bp).connect(g).connect(dest);
  beginVoice(src, () => {
    try {
      src.stop();
    } catch {
      /* ignore */
    }
  });
  src.start(t0);
}

/** 号角（sting 专用）：锯齿双层微失谐 + 滤波包络。 */
function playHorn(c: AudioContext, dest: AudioNode, freq: number, t0: number, dur: number, gain: number): void {
  const g = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.2;
  lp.frequency.setValueAtTime(Math.max(200, freq * 0.8), t0);
  lp.frequency.linearRampToValueAtTime(Math.max(400, freq * 3), t0 + Math.min(0.12, dur * 0.4));
  lp.frequency.linearRampToValueAtTime(Math.max(250, freq * 1.2), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.03);
  g.gain.setValueAtTime(gain, t0 + Math.max(0.04, dur * 0.7));
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  const oscs: OscillatorNode[] = [];
  for (const det of [1, 1.005]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq * det;
    o.connect(lp);
    oscs.push(o);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  lp.connect(g);
  g.connect(dest);
  beginVoice(oscs[0], () => {
    for (const o of oscs) {
      try {
        o.stop();
      } catch {
        /* ignore */
      }
    }
  });
}

/**
 * 统一入口。freq ≤ 0 = 休止（ pitch 类音色直接跳过；woodblock/peck 是噪声类，
 * 不查音高 —— 曲目数据里打击轨统一写 `'--'`）。
 * dur 单位秒；t0 单位 ctx.currentTime 秒。
 */
export function playPatch(
  patch: PatchId,
  c: AudioContext,
  dest: AudioNode,
  freq: number,
  t0: number,
  dur: number,
  gain: number,
): void {
  if (freq <= 0 && patch !== 'woodblock' && patch !== 'peck') return;
  switch (patch) {
    case 'musicbox':
      playMusicbox(c, dest, freq, t0, dur, gain);
      break;
    case 'lute':
      playLute(c, dest, freq, t0, dur, gain);
      break;
    case 'woodblock':
      playWood(c, dest, freq, t0, Math.min(dur, 0.09), gain, 950, 6);
      break;
    case 'peck':
      // 鸡啄（§2.4）：更轻、中心更高、间隔由曲目数据保证 ≥25s
      playWood(c, dest, freq, t0, 0.06, gain * 0.25, 1250, 4);
      break;
    case 'horn':
      playHorn(c, dest, freq, t0, dur, gain);
      break;
  }
}
