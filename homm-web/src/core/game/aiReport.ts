import type { FactionId } from '../types.js';

/**
 * AI 活动事件（TP-7 / F-2.2）：让"结束一天"时玩家看得见电脑这一天的动作。
 *
 * 为什么不用日志文本解析：日志行格式随各站点演进而漂移（移动/交战/招募/退出
 * 的前缀各不相同，交战行还没有阵营前缀），按文本分组归类必然脆。所以在 AI 的
 * 行动站点直接记结构化事件；日志保持原样（日志面板与 hint 两个消费者不受影响）。
 *
 * 模块级缓冲：`endDay` 在 AI 行动前 reset、行动后由 UI 读取。
 * **不落盘、不进 GameState** ⇒ 存档格式零变化（旧档直接可读，无迁移成本）。
 */

/** 事件性质。 */
export type AiEventKind = 'move' | 'battle' | 'capture' | 'hire' | 'death' | 'out';

export interface AiEvent {
  kind: AiEventKind;
  /** 行动方（AI 阵营）。`death` 事件里是死者的阵营。 */
  player: FactionId;
  /** 主体（英雄名 / 城镇名 / 事件短语）。 */
  what: string;
  /** 一句人类可读的细节（坐标、结果）。 */
  detail: string;
  /**
   * 动手的英雄名。多数事件里 `what` 就是英雄名（冗余）；
   * **capture 类必须填** —— 否则"占领金矿"不知道是谁干的，
   * 玩家没法判断是哪员敌将在往哪儿去（F-2.2 要的是"对方英雄的活动"）。
   */
  hero?: string;
  /** 是否直接关系到人类玩家（打玩家的英雄 / 占玩家的资产 / 玩家英雄阵亡）。 */
  vsPlayer?: boolean;
  /** 行动方是否得手（战斗/占领）。 */
  win?: boolean;
}

let buf: AiEvent[] = [];

/**
 * AI 行动前清空（`endDay` 调）。
 * 单独跑 `runAiTurn` 的测试/工具不清 ⇒ 事件会跨调用累积，读的时候注意；
 * 生产路径只有 endDay 一个入口，不会累积。
 */
export function resetAiEvents(): void {
  buf = [];
}

/** 记一条。 */
export function noteAiEvent(e: AiEvent): void {
  buf.push(e);
}

/** 今天记录到的 AI 活动（发生序）。 */
export function aiEvents(): readonly AiEvent[] {
  return buf;
}
