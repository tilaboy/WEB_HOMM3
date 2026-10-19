/**
 * 曲目数据格式（`design/audio-direction.md` §10.3，定稿前建议版的落地）。
 *
 * 用**拍**而不是秒记谱：换 BPM / 换配器 / 做变体段都是改数据，不动引擎。
 * 这也是 §6.1"预留文件通道"的落点 —— 将来把某个 `scores/x.ts` 换成
 * `scores/x.url.ts`（一个 URL + 循环点），`music.play()` 切到 `<audio>`，
 * 调用点一行不动。
 *
 * 目录按规格建议的 `scores/<id>.ts` 一曲一文件；`index.ts` 汇总注册表。
 */

export type ScoreId = 'menu' | 'map' | 'battle' | 'town' | 'victory' | 'defeat';

/** [拍, 音名, 时值(拍)]；音名 '--' = 休止。拍为**绝对拍**（从曲首 0 起算）。 */
export type Note = readonly [beat: number, pitch: string, dur: number];

export interface Score {
  id: ScoreId;
  title: string;
  /** 拍/分钟 */
  bpm: number;
  /** 拍号（本作全部 3/4 进行曲） */
  meter: readonly [number, number];
  /** 总小节数（含 intro） */
  bars: number;
  /**
   * 循环起点（小节索引）。`loopFrom < bars` ⇒ 前 loopFrom 小节为只播一次的 intro，
   * 循环体 = [loopFrom, bars)。**等于 bars 表示不循环**（sting）。
   */
  loopFrom: number;
  /** 主旋律（musicbox 或 horn），绝对拍 */
  melody: readonly Note[];
  /** 每小节一个和弦（lute 拨奏）；null = 该小节无和声。长度须 = bars。 */
  chords: readonly (readonly string[] | null)[];
  /**
   * 每小节打击模式，meter[0]×2 个字符（3/4 = 6 个八分位）：
   * `X` 重音 / `x` 击 / `.` 停 / `p` 鸡啄（城镇喜剧点 §2.4）。长度须 = bars。
   */
  perc: readonly string[];
  /** 各音色增益（默认值见 engine）。 */
  gains?: {
    musicbox?: number;
    lute?: number;
    woodblock?: number;
    peck?: number;
    horn?: number;
  };
}

/** 循环体拍数（= (bars - loopFrom) × 每小节拍数）。 */
export function loopBeats(s: Score): number {
  return (s.bars - s.loopFrom) * s.meter[0];
}

/** 是否循环（loopFrom < bars）。sting 类不循环。 */
export function isLoop(s: Score): boolean {
  return s.loopFrom < s.bars;
}

/** 循环起点对应的绝对拍。 */
export function loopStartBeat(s: Score): number {
  return s.loopFrom * s.meter[0];
}

/** 总拍数（含 intro）。 */
export function totalBeats(s: Score): number {
  return s.bars * s.meter[0];
}
