/**
 * 乐理小工具（`design/audio-direction.md` §10.3 曲目数据格式的支撑）。
 *
 * 曲目数据用**拍**记谱（`[拍, 音名, 时值]`），换 BPM / 换配器 / 做变体段都只改数据、
 * 不动引擎 —— 这也是 §6.1"预留文件通道"的落点。
 */

const SEMITONE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/**
 * 音名 → 频率（Hz）。支持 `D4` / `F#3` / `Bb5`（十二平均律，A4 = 440）。
 * 休止符（`'--'`）返回 0。
 */
export function noteFreq(name: string): number {
  if (name === '--' || name === '') return 0;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return 0;
  const base = SEMITONE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + base; // C4 = 60
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 移调（半音数，可为负）：`D4` +2 → `E4`。用于变体段的"旋律降八度"等。 */
export function transpose(name: string, semitones: number): string {
  if (noteFreq(name) === 0) return name;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return name;
  const base = SEMITONE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  let midi = (Number(m[3]) + 1) * 12 + base + semitones;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${names[pc]}${oct}`;
}

/** 每拍秒数。 */
export function secPerBeat(bpm: number): number {
  return 60 / bpm;
}

/**
 * 一段音符序列沿拍轴平移（拼接动机用）。
 * notes: [[拍, 音名, 时值], ...] → 每条拍的 +offset。
 */
export function shiftNotes(notes: readonly (readonly [number, string, number])[], offset: number): [number, string, number][] {
  return notes.map(([b, p, d]) => [b + offset, p, d] as [number, string, number]);
}
