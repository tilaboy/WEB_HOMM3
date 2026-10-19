/**
 * 音频总线图（`design/audio-direction.md` §5.1 / §5.5）。
 *
 * ```
 * destination
 *  └── master (0.18, homm.mute 总开关, 保持不动)
 *       └── compressor (-12dB/4:1/knee6/a4ms/r180ms)   ← 防多源叠加削波
 *            ├── busUI      (1.00)  ← sfx.ts 的 10 个音（2026-10-18 改接）
 *            ├── busMusic   (0.50)  ← 音乐（homm.music 独立开关）
 *            │    └── musicDuck (1.0 → 0.6 瞬态闪避, §5.2)
 *            └── busAmbient (0.30)  ← 环境床（homm.amb 独立开关；P2/P3 落地）
 * ```
 *
 * 设计纪律（全部来自规格，实现时不许自行"优化"掉）：
 *  - **MASTER_VOL 恒 0.18**：用户已习惯这个响度；音乐进来后总能量上升由压缩器兜住。
 *  - **音乐/环境各串 90Hz 高通**（§5.5）：手机扬声器放不出 90Hz 以下，留着只吃动态余量。
 *  - **懒创建**：AudioContext 在首次用户手势内才建（sfx.ts 原逻辑原样上移），
 *    首屏不出声、不新增自动播放风险（§7）。
 *  - **静音只拧 gain 不销毁 ctx**（§1.1 现状语义保留）。
 *  - **voice 池全局 ≤16 抢占最旧**（§8.1）：音乐 ≤8 / 床 ≤2 / sfx ≤6。
 *
 * 调试插桩（探针专用，零音质影响）：master 与 busMusic 各挂一个 AnalyserNode，
 * `audioRms()` 读时域 RMS —— "真的在有声"的量化证据，而不是"节点建了"。
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let busUI: GainNode | null = null;
let busMusic: GainNode | null = null;
let busAmbient: GainNode | null = null;
let musicDuck: GainNode | null = null;
let anMaster: AnalyserNode | null = null;
let anMusic: AnalyserNode | null = null;

export const MASTER_VOL = 0.18;
const MUSIC_VOL = 0.5;
const AMBIENT_VOL = 0.3;
/** §8.1 并发语音硬上限（全局计数 + 抢占最旧）。 */
const VOICE_CAP = 16;

/** homm.mute：总开关（语义与键名不变，§10.2 零改动清单）。 */
let muted = localStorage.getItem('homm.mute') === '1';
/** homm.music：音乐独立开关（Q3 已拍板，默认开）。 */
let musicOn = localStorage.getItem('homm.music') !== '0';
/** homm.amb：环境音独立开关（Q3；环境音本体在 P2/P3，先留位）。 */
let ambOn = localStorage.getItem('homm.amb') !== '0';

/* ---------------- 开关 ---------------- */

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
  localStorage.setItem('homm.mute', v ? '1' : '0');
  if (master) master.gain.value = v ? 0 : MASTER_VOL;
}

export function isMusicOn(): boolean {
  return musicOn;
}

export function setMusicOn(v: boolean): void {
  musicOn = v;
  localStorage.setItem('homm.music', v ? '1' : '0');
  if (busMusic) busMusic.gain.value = v ? MUSIC_VOL : 0;
}

export function isAmbientOn(): boolean {
  return ambOn;
}

export function setAmbientOn(v: boolean): void {
  ambOn = v;
  localStorage.setItem('homm.amb', v ? '1' : '0');
  if (busAmbient) busAmbient.gain.value = v ? AMBIENT_VOL : 0;
}

/* ---------------- 生命周期 ---------------- */

/** 显式挂起（M-06）。由 lifecycle 在切后台时调用；只在 running 时才 suspend。 */
export function suspendAudio(): void {
  if (ctx?.state === 'running') void ctx.suspend();
}

/** 后台恢复钩子：音乐调度器在这里重基（R1 守卫的第二道，见 music.ts）。 */
const resumeHooks = new Set<() => void>();
export function onAudioResume(fn: () => void): () => void {
  resumeHooks.add(fn);
  return () => resumeHooks.delete(fn);
}

/**
 * 显式恢复（M-06）。**不要**依赖发声时自动 resume：后台被系统中断后下一次发声
 * 若猛地拉起上下文，部分设备会爆音（sfx.ts 原注释，原样保留该纪律）。
 * 恢复成功后通知调度器重基。
 */
export function resumeAudio(): void {
  if (ctx?.state !== 'suspended') return;
  void ctx
    .resume()
    .then(() => {
      for (const fn of resumeHooks) fn();
    })
    .catch(() => undefined);
}

/** 音频上下文（懒创建；返回 null = 环境无 WebAudio，调用方静默降级）。 */
export function ac(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    comp.knee.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOL;
    master.connect(comp);
    comp.connect(ctx.destination);

    busUI = ctx.createGain();
    busUI.gain.value = 1;
    busUI.connect(master);

    // 闪避层在 busMusic 之下：独立开关拧 busMusic，闪避拧 musicDuck，互不覆盖。
    musicDuck = ctx.createGain();
    musicDuck.gain.value = 1;
    const hpMusic = ctx.createBiquadFilter();
    hpMusic.type = 'highpass';
    hpMusic.frequency.value = 90;
    busMusic = ctx.createGain();
    busMusic.gain.value = musicOn ? MUSIC_VOL : 0;
    musicDuck.connect(busMusic);
    busMusic.connect(hpMusic);
    hpMusic.connect(master);

    const hpAmb = ctx.createBiquadFilter();
    hpAmb.type = 'highpass';
    hpAmb.frequency.value = 90;
    busAmbient = ctx.createGain();
    busAmbient.gain.value = ambOn ? AMBIENT_VOL : 0;
    busAmbient.connect(hpAmb);
    hpAmb.connect(master);

    // 调试插桩：RMS 探针（fftSize 2048 时域数据，成本可忽略；无音质影响）。
    anMaster = ctx.createAnalyser();
    anMaster.fftSize = 2048;
    master.connect(anMaster);
    anMusic = ctx.createAnalyser();
    anMusic.fftSize = 2048;
    busMusic.connect(anMusic);
  }
  // 自动播放策略：首次发声必然在用户手势里，此时 resume() 允许 —— 只推一次
  // （sfx.ts 原 unlocked 逻辑原样上移）；之后一概不自动 resume（M-06）。
  if (ctx.state === 'suspended' && !unlocked) {
    unlocked = true;
    void ctx.resume();
  }
  return ctx;
}

let unlocked = false;

/** sfx 出口（busUI）。null = 无 WebAudio 环境。 */
export function outUI(): GainNode | null {
  ac();
  return busUI;
}

/** 音乐出口（musicDuck，闪避层之下、各播放器交叉淡入的汇点）。 */
export function outMusic(): GainNode | null {
  ac();
  return musicDuck;
}

/** 环境音出口（busAmbient）。P2/P3 用。 */
export function outAmbient(): GainNode | null {
  ac();
  return busAmbient;
}

/* ---------------- voice 池（§8.1） ---------------- */

const voices = new Map<AudioScheduledSourceNode, () => void>();

export function voiceCount(): number {
  return voices.size;
}

/**
 * 登记一个**语音**（= 一个音，可能含多个振荡器 partial）。
 * `stopAll` 必须停掉该音的全部节点 —— 抢占最旧时不能只停基频留下泛音。
 * 满了按规格 §8.1"抢占最旧"踢掉最早的。
 */
export function beginVoice(primary: AudioScheduledSourceNode, stopAll: () => void): void {
  if (voices.size >= VOICE_CAP) {
    const oldest = voices.entries().next().value;
    if (oldest) {
      try {
        oldest[1]();
      } catch {
        /* 已停过的节点再 stop 会抛——忽略 */
      }
      voices.delete(oldest[0]);
    }
  }
  voices.set(primary, stopAll);
  primary.addEventListener(
    'ended',
    () => {
      voices.delete(primary);
    },
    { once: true },
  );
}

/* ---------------- 闪避（§5.2） ---------------- */

let duckTimer: number | null = null;

/**
 * 音乐闪避：只对低密度重要事件（win/lose/build）做，200ms 下 / 500ms 回。
 * 高频事件（hit/shoot/spell/step/click）**不闪避**——会听成"抽水"（§5.2 原话）。
 */
export function duckMusic(): void {
  const c = ac();
  if (!c || !musicDuck) return;
  const t = c.currentTime;
  musicDuck.gain.cancelScheduledValues(t);
  musicDuck.gain.setValueAtTime(Math.max(0.0001, musicDuck.gain.value), t);
  musicDuck.gain.linearRampToValueAtTime(0.6, t + 0.2);
  musicDuck.gain.linearRampToValueAtTime(1, t + 0.7);
  if (duckTimer !== null) clearTimeout(duckTimer);
  duckTimer = setTimeout(() => {
    duckTimer = null;
  }, 800) as unknown as number;
}

/* ---------------- 调试插桩 ---------------- */

/** 时域 RMS（0 = 没声音）。探针用它证明"真的在有声"。 */
export function audioRms(which: 'master' | 'music' = 'master'): number {
  const an = which === 'master' ? anMaster : anMusic;
  if (!an) return 0;
  const buf = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

export function ctxState(): string {
  return ctx?.state ?? 'none';
}

/* ---------------- 调试表面（?devprobe=1 才挂；探针 tools/probes/tp3-audio.mjs 用） ---------------- */

if (typeof window !== 'undefined' && location.search.includes('devprobe')) {
  (window as unknown as { __audioDebug: () => unknown }).__audioDebug = () => ({
    ctx: ctxState(),
    masterRms: audioRms('master'),
    musicRms: audioRms('music'),
    voices: voiceCount(),
    muted: isMuted(),
    musicOn: isMusicOn(),
    ambOn: isAmbientOn(),
  });
  (window as unknown as { __audioCtl: unknown }).__audioCtl = {
    suspend: suspendAudio,
    resume: resumeAudio,
    setMuted,
    setMusicOn,
  };
}
