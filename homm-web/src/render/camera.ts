import { TILE_H, TILE_W, gridToWorld, worldToGrid } from './iso.js';
import type { GridPos } from '../core/types.js';

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  minZoom = 0.45;
  maxZoom = 2.4;

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
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += (after.wx - before.wx) * this.zoom;
    this.y += (after.wy - before.wy) * this.zoom;
    this.clamp();
  }

  centerOn(gx: number, gy: number): void {
    const c = gridToWorld(gx, gy);
    this.x = this.viewW / 2 - c.wx * this.zoom;
    this.y = this.viewH / 2 - c.wy * this.zoom;
    this.clamp();
  }

  /** 允许自由拖动，但保证地图始终有一部分留在视野内。 */
  clamp(): void {
    if (!this.viewW || !this.viewH) return;
    const z = this.zoom;
    const wxMin = -(this.mapH - 1) * (TILE_W / 2) - TILE_W;
    const wxMax = (this.mapW - 1) * (TILE_W / 2) + TILE_W;
    const wyMin = -TILE_H;
    const wyMax = (this.mapW + this.mapH) * (TILE_H / 2) + TILE_H;

    const xLow = 80 - wxMax * z;
    const xHigh = this.viewW - 80 - wxMin * z;
    this.x = xLow > xHigh ? (xLow + xHigh) / 2 : Math.min(xHigh, Math.max(xLow, this.x));

    const yLow = 80 - wyMax * z;
    const yHigh = this.viewH - 80 - wyMin * z;
    this.y = yLow > yHigh ? (yLow + yHigh) / 2 : Math.min(yHigh, Math.max(yLow, this.y));
  }

  /** 屏幕像素点 → 格子。 */
  pick(sx: number, sy: number): GridPos {
    const { wx, wy } = this.screenToWorld(sx, sy);
    return worldToGrid(wx, wy);
  }
}
