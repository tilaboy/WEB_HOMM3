import type { GameState, GridPos, PlayerId } from '../core/types.js';
import { TERRAIN } from '../core/data/terrains.js';
import { DWELLING_IDS } from '../core/data/buildings.js';
import { computeVisible, isRevealed } from '../core/map/fog.js';
import { idx } from '../core/map/grid.js';
import { Camera } from './camera.js';
import { TILE_H, TILE_W, diamondPoints, gridToWorld, tracePolygon } from './iso.js';
import { drawHero, drawObject, drawTile } from './sprites.js';

export interface ViewModel {
  state: GameState;
  player: PlayerId;
  sight: number;
  reachable: Float64Array | null;
  path: GridPos[] | null;
  hover: GridPos | null;
  selectedHeroId: string | null;
  heroRender: Record<string, { x: number; y: number }>;
}

const THICK = 8;

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 画布上下文');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const host = this.canvas.parentElement;
    const w = this.canvas.clientWidth || host?.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || host?.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.camera.viewW = w;
    this.camera.viewH = h;
    this.dpr = dpr;
  }

  draw(vm: ViewModel): void {
    const ctx = this.ctx;
    const { state, player, camera } = { ...vm, camera: this.camera };
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0d1116';
    ctx.fillRect(0, 0, camera.viewW, camera.viewH);

    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    const vis = computeVisible(state, player, vm.sight);
    const map = state.map;

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = idx(map, x, y);
        if (!isRevealed(state, player, x, y)) continue;
        const { wx, wy } = gridToWorld(x, y);
        // 视口裁剪
        if (
          wx * camera.zoom + camera.x < -TILE_W ||
          wx * camera.zoom + camera.x > camera.viewW + TILE_W ||
          wy * camera.zoom + camera.y < -TILE_H * 2 ||
          wy * camera.zoom + camera.y > camera.viewH + TILE_H * 3
        ) {
          continue;
        }
        const tile = map.tiles[i];
        drawTile(ctx, wx, wy, TERRAIN[tile.terrain]);

        if (tile.objectId) {
          const obj = map.objects[tile.objectId];
          if (obj) {
            if (obj.kind === 'town') {
              const t = state.towns[(obj.payload as { townId: string }).townId];
              drawObject(ctx, wx, wy, obj, t
                ? { owner: t.owner, level: t.buildings.filter((b) => DWELLING_IDS.includes(b)).length }
                : undefined);
            } else {
              drawObject(ctx, wx, wy, obj);
            }
          }
        }

        if (!vis[i]) {
          tracePolygon(ctx, [
            [wx, wy - TILE_H / 2],
            [wx + TILE_W / 2, wy],
            [wx + TILE_W / 2, wy + THICK],
            [wx, wy + TILE_H / 2 + THICK],
            [wx - TILE_W / 2, wy + THICK],
            [wx - TILE_W / 2, wy],
          ]);
          ctx.fillStyle = 'rgba(8,10,14,0.55)';
          ctx.fill();
        }
      }
    }

    // 可移动范围
    if (vm.reachable) {
      for (let i = 0; i < vm.reachable.length; i++) {
        const c = vm.reachable[i];
        if (!isFinite(c) || c <= 0) continue;
        if (!isRevealed(state, player, i % map.width, (i / map.width) | 0)) continue;
        const { wx, wy } = gridToWorld(i % map.width, (i / map.width) | 0);
        tracePolygon(ctx, diamondPoints(wx, wy));
        ctx.fillStyle = 'rgba(120,200,255,0.13)';
        ctx.fill();
      }
    }

    // 路径预览
    if (vm.path && vm.path.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (const p of vm.path) {
        const { wx, wy } = gridToWorld(p.x, p.y);
        ctx.beginPath();
        ctx.arc(wx, wy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      const last = vm.path[vm.path.length - 1];
      const { wx, wy } = gridToWorld(last.x, last.y);
      tracePolygon(ctx, diamondPoints(wx, wy));
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 悬停高亮
    if (vm.hover && isRevealed(state, player, vm.hover.x, vm.hover.y)) {
      const { wx, wy } = gridToWorld(vm.hover.x, vm.hover.y);
      tracePolygon(ctx, diamondPoints(wx, wy));
      ctx.strokeStyle = 'rgba(227,184,105,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 英雄
    const pulse = performance.now();
    for (const id of state.heroOrder) {
      const hero = state.heroes[id];
      if (!hero) continue;
      const rp = vm.heroRender[id] ?? { x: hero.pos.x, y: hero.pos.y };
      const { wx, wy } = gridToWorld(rp.x, rp.y);
      drawHero(ctx, wx, wy, hero, id === vm.selectedHeroId ? pulse : 0);
    }

    ctx.restore();
  }
}
