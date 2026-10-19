/**
 * `victory` / `defeat` —— 战斗结算 sting（`design/audio-direction.md` §3 #5/#6 / §5.4）。
 *
 * **方案 i（Q4 已拍板）**：保留 `sfx.win()/lose()` 作为"结果已定"的即时反馈，
 * sting 在其后 **600ms** 叠加。两者音区错开（sfx 在 523–784，sting 走号角/低八度），
 * 不会撞；也不丢"点下去立刻有反应"的手感。
 *
 * - `victory`：号角动机庄厚上行 5 音（G4→D5），**第 6 个音低半音**（Eb5 —— "号手
 *   吹破了一个音"），然后照常收回 D5。整段 12s、**不循环**。这是 victory 的
 *   **整段唯一一处**荒诞（§2.4 配额表：victory 整段 1 处）。
 * - `defeat`：鲁特琴下行 8 音（A4→A3），无笑点（配额表 defeat = 0 处），11.5s、
 *   **不循环**。不用号角——败局不该有铜管。
 */

import type { Score } from './types.js';

export const VICTORY: Score = {
  id: 'victory',
  title: '胜利（吹破一个音）',
  bpm: 60,
  meter: [3, 4],
  bars: 4,
  loopFrom: 4, // = bars ⇒ 不循环
  melody: [
    [0, 'G4', 1.5],
    [1.5, 'A4', 1.5],
    [3, 'B4', 1.5],
    [4.5, 'C5', 1.5],
    [6, 'D5', 1.5],
    // 第 6 个音：理应是 E5，吹成 Eb5（低半音）—— 然后照常收，世界拒不回应
    [7.5, 'Eb5', 1.5],
    [9, 'D5', 3],
  ],
  chords: [null, null, null, null],
  perc: ['......', '......', '......', '......'],
  gains: { horn: 0.42 },
};

export const DEFEAT: Score = {
  id: 'defeat',
  title: '失败（褪色）',
  bpm: 60,
  meter: [3, 4],
  bars: 4,
  loopFrom: 4, // = bars ⇒ 不循环
  melody: [
    [0, 'A4', 1.5],
    [1.5, 'G4', 1.5],
    [3, 'F4', 1.5],
    [4.5, 'E4', 1.5],
    [6, 'D4', 1.5],
    [7.5, 'C4', 1.5],
    [9, 'B3', 1.5],
    [10.5, 'A3', 1.5], // dur 钳在曲尾（4×3=12 拍）；尾音落在下一遍循环点上不收尾
  ],
  chords: [null, null, null, null],
  perc: ['......', '......', '......', '......'],
  gains: { lute: 0.36 },
};
