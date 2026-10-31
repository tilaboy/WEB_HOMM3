import type { GridPos } from '../core/types.js';
import { TILE, gridCenter, gridToWorld, worldToGrid } from './ortho.js';

/**
 * 允许的缩放档位：**0.5 / 1 / 2**（决策 8）。
 *
 * 只保留"整数或整数分之一"这三档：地图格 32 世界 px 在 1× 下正好 32 屏 px、
 * 0.5× 下 16、2× 下 64，源像素块边长恒为整数，最近邻放大不会出现 1/2px 交替。
 * 旧表 `[0.75, 1, 1.5, 2, 3]` 里 0.75 / 1.5 / 3 是 1.5 倍关系，加上默认值 1.2
 * **不在表里**，第一次双指缩放会直接跳档（放大到 1.5、缩到 1.0），手感上也像"卡一下"。
 */
const STEPS = [0.5, 1, 2];

/** 缩放动画时间常数（ms）：越小越跟手，越大越"滑"。 */
const ZOOM_TAU = 90;
/** 惯性衰减时间常数（ms）：松手后镜头滑行的"重量感"。 */
const FLING_TAU = 160;
/** 低于该速度（px/s）时惯性直接归零，避免永远爬行的亚像素抖动。 */
const FLING_STOP = 8;
/** 边缘滚屏：触发边距（px）与最大速度（px/s）。 */
const EDGE_MARGIN = 24;
const EDGE_SPEED = 460;

/**
 * 冒险地图镜头。
 *
 * 手感三件套：
 * - **惯性拖拽**：拖拽中 trackFling() 持续估计速度，松手后 update() 里按
 *   指数衰减继续滑行，撞到边界即停；
 * - **平滑缩放**：zoomAt() 只改 targetZoom 与锚点，update() 每帧向目标值
 *   靠拢，过程中锚点下的世界点保持不动（指哪放大哪）；
 * - **边缘滚屏**：edgeScroll() 在主循环里调用，鼠标贴边时按距离线性加速。
 */
export class Camera {
  x = 0;
  y = 0;
  /**
   * 初始缩放 **1.0**（2026-10-31 E1 批；旧值 1.2，更早试过 2 与 1.5）。
   *
   * 为什么放弃 1.2（真机实测，OPPO PMA110 · 792×360 CSS）：
   *   1.2 不是整数倍，最近邻放大后同一张图上的源像素宽度在 1 与 2 屏 px 之间跳，
   *   格线 / 道路边缘时粗时细 —— 这就是"地图糊"的两个来源之一（另一个是画布不整除）；
   *   1.2 还**不在 STEPS 里**，第一次双指缩放必然跳档。
   * 1.0 的代价：横向可见格从 22 涨到 26.4、城堡占屏高从 28% 降到 23%，
   * 读起来"退远了一档"，但每个像素都是 1:1。
   * `?devzoom=1.2` 仍然可用（`setZoom()` 只钳制不取档），供旧基线对账。
   */
  zoom = 1;
  /** 缩放动画的目标值；无动画时与 zoom 相等。 */
  targetZoom = 1;
  minZoom = 0.5;
  maxZoom = 2;

  /** 惯性速度（屏幕 px/s）。拖拽中由 trackFling 更新，松手后自行衰减。 */
  vx = 0;
  vy = 0;

  viewW = 0;
  viewH = 0;
  mapW = 24;
  mapH = 24;

  /** 缩放锚点：屏幕坐标 + 其对应的世界坐标。 */
  private anchorSx = 0;
  private anchorSy = 0;
  private anchorWx = 0;
  private anchorWy = 0;
  private zooming = false;

  worldToScreen(wx: number, wy: number): { sx: number; sy: number } {
    return { sx: wx * this.zoom + this.x, sy: wy * this.zoom + this.y };
  }

  screenToWorld(sx: number, sy: number): { wx: number; wy: number } {
    return { wx: (sx - this.x) / this.zoom, wy: (sy - this.y) / this.zoom };
  }

  pan(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.clamp();
  }

  /**
   * 拖拽中上报本次位移与耗时，用于估计松手后的惯性初速度。
   * 指数滑动平均，最近一次的权重最高。
   */
  trackFling(dx: number, dy: number, dtMs: number): void {
    if (dtMs <= 0) return;
    const ix = (dx / dtMs) * 1000;
    const iy = (dy / dtMs) * 1000;
    this.vx = this.vx * 0.55 + ix * 0.45;
    this.vy = this.vy * 0.55 + iy * 0.45;
  }

  /** 立刻停住惯性（按下指针 / 居中 / 边缘滚屏接管时调用）。 */
  stopFling(): void {
    this.vx = 0;
    this.vy = 0;
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    // 连续滚轮要基于"目标值"继续跳档，否则动画中途再滚会回退
    const cur = this.targetZoom;
    let next = cur;
    if (factor > 1) next = STEPS.find((s) => s > cur + 1e-6) ?? STEPS[STEPS.length - 1];
    else next = [...STEPS].reverse().find((s) => s < cur - 1e-6) ?? STEPS[0];
    next = Math.min(this.maxZoom, Math.max(this.minZoom, next));
    const w = this.screenToWorld(sx, sy);
    this.targetZoom = next;
    this.anchorSx = sx;
    this.anchorSy = sy;
    this.anchorWx = w.wx;
    this.anchorWy = w.wy;
    this.zooming = true;
  }

  /**
   * 立即设定缩放（调试入口等），跳过动画。
   * `force` = 不钳到 `[minZoom, maxZoom]`：**只给 `?devzoom=` 用** ——
   * 探针里有 `?devzoom=2.4`（把路径交界挤出画面）与 `?devzoom=0.55`（一屏塞下 20 步），
   * 这两个值本来就在三档之外，钳了会让探针**静默换成另一档**（画面变了，判据还以为在量原口径）。
   */
  setZoom(z: number, force = false): void {
    this.zoom = force ? z : Math.min(this.maxZoom, Math.max(this.minZoom, z));
    this.targetZoom = this.zoom;
    this.zooming = false;
    this.clamp();
  }

  centerOn(gx: number, gy: number): void {
    const c = gridCenter(gx, gy);
    this.x = this.viewW / 2 - c.wx * this.zoom;
    this.y = this.viewH / 2 - c.wy * this.zoom;
    this.stopFling();
    this.clamp();
  }

  /**
   * 每帧推进：平滑缩放 + 惯性滑行。
   * @param dtMs 距上一帧的毫秒数
   */
  update(dtMs: number): void {
    if (this.zooming) {
      const k = 1 - Math.exp(-dtMs / ZOOM_TAU);
      const z = this.zoom + (this.targetZoom - this.zoom) * k;
      this.zoom = Math.abs(z - this.targetZoom) < 0.002 ? this.targetZoom : z;
      // 锚点下的世界点不动：sx = wx*zoom + x  ⇒  x = sx - wx*zoom
      this.x = this.anchorSx - this.anchorWx * this.zoom;
      this.y = this.anchorSy - this.anchorWy * this.zoom;
      if (this.zoom === this.targetZoom) this.zooming = false;
      this.clamp();
    }
    if (this.vx || this.vy) {
      const dt = dtMs / 1000;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      const decay = Math.exp(-dtMs / FLING_TAU);
      this.vx *= decay;
      this.vy *= decay;
      if (Math.hypot(this.vx, this.vy) < FLING_STOP) this.stopFling();
      const px = this.x;
      const py = this.y;
      this.clamp();
      // clamp 改写了坐标说明撞到边界，该轴速度清零
      if (this.x !== px) this.vx = 0;
      if (this.y !== py) this.vy = 0;
    }
  }

  /**
   * 边缘滚屏：鼠标（屏幕坐标）贴近视口边缘时平移镜头。
   * 速度随贴边深度线性增加。主循环在"无拖拽、无弹窗"时调用。
   */
  edgeScroll(sx: number, sy: number, dtMs: number): void {
    if (!this.viewW || !this.viewH) return;
    let dx = 0;
    let dy = 0;
    if (sx < EDGE_MARGIN) dx = -(1 - Math.max(0, sx) / EDGE_MARGIN);
    else if (sx > this.viewW - EDGE_MARGIN) dx = 1 - Math.max(0, this.viewW - sx) / EDGE_MARGIN;
    if (sy < EDGE_MARGIN) dy = -(1 - Math.max(0, sy) / EDGE_MARGIN);
    else if (sy > this.viewH - EDGE_MARGIN) dy = 1 - Math.max(0, this.viewH - sy) / EDGE_MARGIN;
    if (!dx && !dy) return;
    this.stopFling();
    const dt = dtMs / 1000;
    this.x += dx * EDGE_SPEED * dt;
    this.y += dy * EDGE_SPEED * dt;
    this.clamp();
  }

  clamp(): void {
    if (!this.viewW || !this.viewH) return;
    const z = this.zoom;
    const w = this.mapW * TILE * z;
    const h = this.mapH * TILE * z;
    // 越界余量：旧值 0.35×min(vw,vh)（真机 792×360 上 = **126px**）本意是"贴边别太硬"，
    // 但初始缩放降到 1.2 后，这 126px 就是一条完整露出来的**地图外空桌面** —— 读起来像画面缺一块。
    // 2026-10-21 收到 0.08（≈29px）：贴边仍有余量，但不会露出成片的空白。
    const pad = Math.min(this.viewW, this.viewH) * 0.08;
    const xLow = this.viewW - pad - w;
    const xHigh = pad;
    this.x = xLow > xHigh ? (xLow + xHigh) / 2 : Math.min(xHigh, Math.max(xLow, this.x));
    const yLow = this.viewH - pad - h;
    const yHigh = pad;
    this.y = yLow > yHigh ? (yLow + yHigh) / 2 : Math.min(yHigh, Math.max(yLow, this.y));
  }

  pick(sx: number, sy: number): GridPos {
    const { wx, wy } = this.screenToWorld(sx, sy);
    return worldToGrid(wx, wy);
  }
}

export { gridToWorld };
