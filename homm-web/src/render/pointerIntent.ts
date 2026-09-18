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
