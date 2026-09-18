/**
 * 指针意图（纯逻辑）——从 main.ts 的输入处理里抽出的可测谓词。
 *
 * 为什么单独成模块：`main.ts` 顶层就建 DOM/canvas，node 里 import 不了，
 * 于是任何写在 main.ts 里的判断都进不了 smoke。把"该不该边缘滚屏"这类
 * 纯判断搬到这里，就能被单测覆盖，且不改变运行时行为。
 */

export type PointerKind = 'mouse' | 'touch' | 'pen';

/** 把 PointerEvent.pointerType 归一化为已知类型；未知/空串回 null。 */
export function normalizePointerType(t: string | null | undefined): PointerKind | null {
  return t === 'mouse' || t === 'touch' || t === 'pen' ? t : null;
}

export interface EdgeScrollState {
  /** 最近一次指针事件的类型。 */
  lastPointerType: PointerKind | null;
  /** 指针是否悬停在画布内（原 main.ts 的 mouseIn）。 */
  hoverActive: boolean;
  /** 当前按下的指针数量（>0 表示正在拖拽/捏合）。 */
  activePointers: number;
  modalOpen: boolean;
  battleOpen: boolean;
}

/**
 * 边缘滚屏是否应该生效（M-01 守卫）。
 *
 * 关键一条：`lastPointerType === 'mouse'`——触屏没有"悬停"，抬手后
 * PointerLeave 在 pointer capture 下的触发时机不可靠，会让 mouseIn 残留为 true
 * 而使镜头自爬。所以边缘滚屏只认真实鼠标，与事件顺序无关。
 */
export function shouldEdgeScroll(s: EdgeScrollState): boolean {
  return (
    s.lastPointerType === 'mouse' &&
    s.hoverActive &&
    s.activePointers === 0 &&
    !s.modalOpen &&
    !s.battleOpen
  );
}

/**
 * 悬停效果是否应该处理（Q-11）。
 *
 * 触屏没有"悬停"这一状态：手指抬起后不会留下 hover，指针一直在动。
 * 如果在触屏上跑 `updateHover`，每次拖拽/点按都会走一遍"拾取格子→写 hint→
 * 重建预览路径"的完整逻辑，既浪费又会在移动端留下"卡在半格"的假高亮。
 * 因此只放行真正有悬停能力的鼠标/触控笔。
 */
export function shouldHover(lastPointerType: PointerKind | null): boolean {
  return lastPointerType === 'mouse' || lastPointerType === 'pen';
}

/* ---------------- 双击识别（M-11：双击同一格居中） ---------------- */

/** 两次点击的最大间隔（毫秒），超过就算两次独立单击。 */
export const DOUBLE_TAP_MAX_MS = 300;
/** 两次点击的最大位移（像素），超过就算点在别处。 */
export const DOUBLE_TAP_MAX_DIST = 12;

export interface TapRecord {
  /** 点击时间戳（performance.now()）。 */
  t: number;
  /** 屏幕坐标（相对画布）。 */
  x: number;
  y: number;
}

/**
 * 判断 `cur` 是否与上一次点击 `prev` 构成"双击"（M-11）。
 *
 * prev 为 null（本次是首次点击）时返回 false；时间倒退（时钟异常）也判否。
 * 阈值抽成常量以便单测覆盖边界（正好 300 ms / 12 px 算双击）。
 */
export function isDoubleTap(prev: TapRecord | null, cur: TapRecord): boolean {
  if (!prev) return false;
  const dt = cur.t - prev.t;
  if (dt < 0 || dt > DOUBLE_TAP_MAX_MS) return false;
  return Math.hypot(cur.x - prev.x, cur.y - prev.y) <= DOUBLE_TAP_MAX_DIST;
}
