/**
 * 程序化音效（WebAudio，零素材）。
 *
 * 所有音色都是振荡器 + 滤波噪声现场合成的，不加载任何音频文件。
 * 浏览器要求音频必须在用户手势之后启动，所以 AudioContext 懒创建：
 * 第一次发声一定发生在某次点击之后，天然满足自动播放策略。
 *
 * 全局开关：localStorage 'homm.mute'，master gain 实时跟随，
 * 静音只拧音量不销毁上下文，切回来立刻有声。
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = localStorage.getItem('homm.mute') === '1';

const MASTER_VOL = 0.18;

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
  localStorage.setItem('homm.mute', v ? '1' : '0');
  if (master) master.gain.value = v ? 0 : MASTER_VOL;
}

function ac(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOL;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  /** 频率滑到多少（Hz），做上扬/下坠 */
  slide?: number;
  delay?: number;
}

/** 单个音：振荡器 + 指数衰减包络。 */
function tone(freq: number, dur: number, opts: ToneOpts = {}): void {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const osc = c.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, opts.slide), t0 + dur);
  const g = c.createGain();
  const peak = opts.gain ?? 0.4;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

interface NoiseOpts {
  gain?: number;
  /** 带通中心频率（Hz） */
  freq?: number;
  q?: number;
  delay?: number;
  /** 滤波频率滑到多少，做"嗖"的扫频感 */
  sweep?: number;
}

/** 噪声打击感：白噪声 + 带通滤波 + 快速衰减。 */
function noise(dur: number, opts: NoiseOpts = {}): void {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const len = Math.max(1, Math.ceil(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(opts.freq ?? 1000, t0);
  if (opts.sweep) bp.frequency.exponentialRampToValueAtTime(Math.max(40, opts.sweep), t0 + dur);
  bp.Q.value = opts.q ?? 1;
  const g = c.createGain();
  const peak = opts.gain ?? 0.4;
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t0);
}

/** 游戏内可用的音效集。调用点只管语义，不管实现。 */
export const sfx = {
  /** UI 点击 */
  click(): void {
    tone(660, 0.05, { type: 'triangle', gain: 0.22 });
  },
  /** 英雄走一格 */
  step(): void {
    noise(0.045, { gain: 0.1, freq: 500, q: 0.8 });
  },
  /** 拾取资源/宝箱 */
  pickup(): void {
    tone(523, 0.07, { type: 'triangle', gain: 0.3 });
    tone(784, 0.1, { type: 'triangle', gain: 0.3, delay: 0.06 });
  },
  /** 近战打击 */
  hit(): void {
    noise(0.1, { gain: 0.45, freq: 900, q: 0.7 });
    tone(130, 0.1, { type: 'sine', gain: 0.35, slide: 70 });
  },
  /** 远程射击 */
  shoot(): void {
    noise(0.14, { gain: 0.3, freq: 2400, sweep: 500, q: 1.4 });
  },
  /** 施法 */
  spell(): void {
    tone(880, 0.18, { type: 'sine', gain: 0.22, slide: 1320 });
    tone(1108, 0.22, { type: 'sine', gain: 0.16, slide: 1660, delay: 0.05 });
  },
  /** 建造完成 */
  build(): void {
    noise(0.08, { gain: 0.3, freq: 300, q: 0.9 });
    tone(392, 0.12, { type: 'triangle', gain: 0.28, delay: 0.07 });
  },
  /** 结束一天 / 新的一天 */
  day(): void {
    tone(440, 0.1, { type: 'triangle', gain: 0.2 });
    tone(554, 0.14, { type: 'triangle', gain: 0.2, delay: 0.08 });
  },
  /** 战斗胜利 */
  win(): void {
    tone(523, 0.12, { type: 'triangle', gain: 0.3 });
    tone(659, 0.12, { type: 'triangle', gain: 0.3, delay: 0.1 });
    tone(784, 0.2, { type: 'triangle', gain: 0.32, delay: 0.2 });
  },
  /** 战斗失败/撤退 */
  lose(): void {
    tone(392, 0.14, { type: 'sawtooth', gain: 0.16 });
    tone(311, 0.2, { type: 'sawtooth', gain: 0.16, delay: 0.12 });
    tone(233, 0.28, { type: 'sawtooth', gain: 0.16, delay: 0.24 });
  },
  /** 操作无效 */
  error(): void {
    tone(170, 0.12, { type: 'square', gain: 0.14 });
  },
};
