/**
 * 周生长事件（spec §19.2，EV1）。
 *
 * H3 的 `Growth` 是静态字段，只有随机事件会改它：**生物周 +5（只加未升级形态）**、
 * **瘟疫 ×0.5（只砍本周产量）**。我们照做，但有两处**刻意的不同**（§19.1 已定稿）：
 *
 *   ① 把 H3 的**月**事件缩成**周**：一局只有 1.4 个月，照抄月事件经常一次都不触发。
 *   ② `eventAdd` **按档递减 T1 +5 / T2 +3 / T3 +2**：H3 的 +5 是绝对量，
 *      而我们的 T3 周产只有 4~5 只 —— 照搬 +5 等于 +100%~+125%，再叠 `banner`（×1.5）
 *      单档周产战力直接翻倍（§19.2 的算式）。按档递减后落在 +31%~+60%，
 *      仍在 H3 自己的 +25%~+100% 区间里。
 *
 * 三条不能动的边界：
 *   · **第 1~2 周恒为平静**（教学期不能被腰斩），第 3 周起才掷；
 *   · **只抽 T1~T3**（T4/T5 留到种子批单独验证，不许顺手放开）；
 *   · **只改本周产量，不砍已招募部队**（读法 A，§19.2.1）。
 *
 * 随机流：`deriveSeed(seed, WEEK_TAG, week)` **单开一条**，不碰任何现有流
 * （铁律 7/8：动别人的流 = 改别人的测量 ⇒ 30 门回归全部保持有效）。
 */

import type { GameState, WeekEvent } from '../types.js';
import { deriveSeed, mulberry32 } from '../rng.js';
import { FACTION_UNITS, getUnit } from '../data/units.js';
import { FACTION_ORDER } from '../data/factions.js';
import { weekOf } from './calendar.js';
import { pushLog } from './log.js';

/** 第 3 周（而不是第 2 周）起才掷：与 §19.3 的爆发共用同一个教学期。 */
export const WEEK_EVENT_MIN_WEEK = 3;

/** 生物周 25% / 瘟疫 8% / 平静 67%（§19.2，`probe:weekevent` A 组按 ±3pt 判）。 */
export const GROWTH_EVENT_RATE = 0.25;
export const PLAGUE_EVENT_RATE = 0.08;

/** 按档递减的绝对增量（§19.2 表）：T1 +5 / T2 +3 / T3 +2。 */
export const GROWTH_EVENT_ADD: Readonly<Record<number, number>> = { 1: 5, 2: 3, 3: 2 };

/** `deriveSeed` 只吃数字；用它代替字符串 'week'（值本身无意义，只要唯一且稳定）。 */
const WEEK_TAG = 0x7765656b; // 'week'

/** 可以成为"某生物周"的兵：四族 T1~T3，顺序固定（同 seed 必须同结果）。 */
export function weekEventPool(): string[] {
  const out: string[] = [];
  for (const fid of FACTION_ORDER) {
    for (let tier = 1; tier <= 3; tier++) {
      const id = FACTION_UNITS[fid]?.[tier - 1];
      if (id) out.push(id);
    }
  }
  return out;
}

/**
 * 掷某一周的事件。**纯函数**：不读 `state.day`、不写日志、不改任何东西。
 *
 * 这样探针能直接跑 1,000 次分布，而不必真的推进 1,000 天（那会把 AI 也跑一遍，
 * 读数里混进 AI 的行为）。`endDay` 负责"什么时候掷、掷完写哪里"。
 */
export function weekEventFor(seed: number, week: number): WeekEvent {
  if (week < WEEK_EVENT_MIN_WEEK) {
    return { kind: 'calm', week, mult: 1, text: '本周平静' };
  }
  const rng = mulberry32(deriveSeed(seed, WEEK_TAG, week));
  const roll = rng();
  if (roll < GROWTH_EVENT_RATE) {
    const pool = weekEventPool();
    const baseId = pool[Math.floor(rng() * pool.length)] ?? pool[0]!;
    const u = getUnit(baseId);
    const add = GROWTH_EVENT_ADD[u.tier] ?? 0;
    return {
      kind: 'growth',
      week,
      unitTypeId: baseId,
      tier: u.tier,
      add,
      mult: 1,
      text: `本周是「${u.name}」周：所有产它的城镇产量 +${add}`,
    };
  }
  if (roll < GROWTH_EVENT_RATE + PLAGUE_EVENT_RATE) {
    return {
      kind: 'plague',
      week,
      mult: 0.5,
      text: '本周瘟疫：各城产量减半（只影响本周新增，已招募部队不受影响）',
    };
  }
  return { kind: 'calm', week, mult: 1, text: '本周平静' };
}

/** 当前周应发生的事件（按 `state.day` 定位）。 */
export function currentWeekEvent(state: GameState): WeekEvent {
  return weekEventFor(state.seed, weekOf(state.day));
}

/**
 * 事件 → `applyWeeklyGrowth` 的 `eventAdd` 回调。
 *
 * 参数是**当前产出的形态**（升过级就是 `_u`），所以先归一成基础版再比对：
 * 事件按兵种（基础 id）定义，升级后的巢穴同样要吃到 +5（§19.2「作用形态」）。
 * 不匹配的兵一律 0 —— 平静周与瘟疫周也走这条路径，不需要调用方分支。
 */
export function eventAddOf(ev: WeekEvent): (unitTypeId: string, tier: number) => number {
  if (ev.kind !== 'growth' || !ev.unitTypeId) return () => 0;
  const target = ev.unitTypeId;
  const add = ev.add ?? 0;
  return (unitTypeId: string, _tier: number) => (unitTypeId === target ? add : 0);
}

/**
 * 在周界掷事件、写进 `state.weekEvent`、并**立刻公告**（§19.2「公告」一行）。
 *
 * 公告必须在玩家当周第一次招募之前：`endDay` 里周增长就发生在这里，
 * 玩家醒来看到日志/横幅时，池子已经按事件结算过了 —— 不是先招后改。
 */
export function rollWeekEvent(state: GameState): WeekEvent {
  const ev = currentWeekEvent(state);
  state.weekEvent = ev;
  // 平静周不公告：它在日志里与"第 N 周开始"是同一句话，多写一行只是噪音。
  if (ev.kind !== 'calm') pushLog(state, ev.text);
  return ev;
}
