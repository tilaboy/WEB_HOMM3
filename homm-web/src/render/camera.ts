import type { GridPos } from '../core/types.js';
import { TILE, gridCenter, gridToWorld, worldToGrid } from './ortho.js';

/** 允许的缩放档位。整数/半整数保证像素放大后不出现锯齿不均。 */
const STEPS = [0.75, 1, 1.5, 2, 3];

export class Camera {
  x = 0;
  y = 0;
  zoom = 2;
  minZoom = 0.75;
  maxZoom = 3;

  viewW = 0;
  viewH = 0;
  mapW = 24;
  mapH = 24;

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

  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    const cur = this.zoom;
    let next = cur;
    if (factor > 1) next = STEPS.find((s) => s > cur + 1e-6) ?? STEPS[STEPS.length - 1];
    else next = [...STEPS].reverse().find((s) => s < cur - 1e-6) ?? STEPS[0];
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, next));
    const after = this.screenToWorld(sx, sy);
    this.x += (after.wx - before.wx) * this.zoom;
    this.y += (after.wy - before.wy) * this.zoom;
    this.clamp();
  }

  centerOn(gx: number, gy: number): void {
    const c = gridCenter(gx, gy);
    this.x = this.viewW / 2 - c.wx * this.zoom;
    this.y = this.viewH / 2 - c.wy * this.zoom;
    this.clamp();
  }

  clamp(): void {
    if (!this.viewW || !this.viewH) return;
    const z = this.zoom;
    const w = this.mapW * TILE * z;
    const h = this.mapH * TILE * z;
    const pad = Math.min(this.viewW, this.viewH) * 0.35;
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
