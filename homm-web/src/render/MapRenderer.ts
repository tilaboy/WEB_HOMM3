import type { GameState, GridPos, MapObject, PlayerId } from '../core/types.js';
import { DWELLING_IDS } from '../core/data/buildings.js';
import { computeVisible, isRevealed } from '../core/map/fog.js';
import { idx } from '../core/map/grid.js';
import { Camera } from './camera.js';
import { TILE } from './ortho.js';
import { getAtlas } from './atlas.js';
import { hash2 } from './pixel.js';

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

type DrawKind =
  | { t: 'obj'; y: number; x: number; obj: MapObject }
  | { t: 'hero'; y: number; x: number; id: string; fx: number; fy: number };

function objSprite(state: GameState, obj: MapObject, hash: number): string | null {
  switch (obj.kind) {
    case 'obstacle': {
      const v = (obj.payload as { variant: string }).variant;
      if (v === 'tree') return hash < 0.5 ? 'tree0' : 'tree1';
      if (v === 'rock') return hash < 0.5 ? 'rock0' : 'rock1';
      return hash < 0.5 ? 'mtn0' : 'mtn1';
    }
    case 'town': {
      const t = state.towns[(obj.payload as { townId: string }).townId];
      const tier = t ? Math.min(3, Math.floor(t.buildings.filter((b) => DWELLING_IDS.includes(b)).length / 1.5)) : 0;
      const own = t && t.owner === 'p1' ? 'p1' : 'neutral';
      return `town_${own}_${tier}`;
    }
    case 'wanderingMonster': {
      const army = (obj.payload as { army: { unitTypeId: string }[] }).army;
      const main = army[0]?.unitTypeId ?? 'wolf';
      return `mon_${main}`;
    }
    case 'resourcePile':
      return `res_${(obj.payload as { resource: string }).resource}`;
    case 'mine':
      return `mine_${(obj.payload as { resource: string }).resource}`;
    case 'treasureChest':
      return 'chest';
    case 'fountain':
      return 'fountain';
    case 'artifact':
      return 'artifact';
    default:
      return null;
  }
}

function guardMarker(obj: MapObject): string | null {
  if (obj.kind !== 'wanderingMonster') return null;
  const g = (obj.payload as { guard?: { kind: string } }).guard;
  if (!g) return null;
  if (g.kind === 'gold') return 'mk_gold';
  if (g.kind === 'resource') return 'mk_res';
  if (g.kind === 'mine') return 'mk_mine';
  return 'mk_chest';
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private atlas = getAtlas();

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
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const host = this.canvas.parentElement;
    const w = this.canvas.clientWidth || host?.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || host?.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.camera.viewW = w;
    this.camera.viewH = h;
    this.dpr = dpr;
  }

  private blit(name: string, gx: number, gy: number): void {
    const f = this.atlas.get(name);
    if (!f) return;
    this.ctx.drawImage(
      this.atlas.canvas, f.x, f.y, f.w, f.h,
      gx * TILE + f.ax, gy * TILE + f.ay, f.w, f.h,
    );
  }

  private blitAt(name: string, wx: number, wy: number): void {
    const f = this.atlas.get(name);
    if (!f) return;
    this.ctx.drawImage(this.atlas.canvas, f.x, f.y, f.w, f.h, wx, wy, f.w, f.h);
  }

  draw(vm: ViewModel): void {
    const ctx = this.ctx;
    const cam = this.camera;
    const { state, player } = vm;
    const map = state.map;
    const now = performance.now();
    const waterFrame = Math.floor(now / 520) % 4;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);

    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.zoom, cam.zoom);

    const vis = computeVisible(state, player, vm.sight);
    const x0 = Math.max(0, Math.floor(-cam.x / (TILE * cam.zoom)) - 1);
    const y0 = Math.max(0, Math.floor(-cam.y / (TILE * cam.zoom)) - 1);
    const x1 = Math.min(map.width - 1, Math.ceil((cam.viewW - cam.x) / (TILE * cam.zoom)) + 1);
    const y1 = Math.min(map.height - 1, Math.ceil((cam.viewH - cam.y) / (TILE * cam.zoom)) + 1);

    /* --- 第一遍：地块 + 岸线 --- */
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = idx(map, x, y);
        if (!isRevealed(state, player, x, y)) continue;
        const terrain = map.tiles[i].terrain;
        const h = hash2(x, y, 17);
        const name = terrain === 'water'
          ? `g_water_${h < 0.5 ? 0 : 1}_${waterFrame}`
          : `g_${terrain}_${Math.floor(h * 3) % 3}`;
        this.blit(name, x, y);

        if (terrain !== 'water') {
          const isW = (nx: number, ny: number): boolean =>
            nx >= 0 && ny >= 0 && nx < map.width && ny < map.height &&
            map.tiles[idx(map, nx, ny)].terrain === 'water';
          if (isW(x, y - 1)) this.blit('sh_n', x, y);
          if (isW(x, y + 1)) this.blit('sh_s', x, y);
          if (isW(x - 1, y)) this.blit('sh_w', x, y);
          if (isW(x + 1, y)) this.blit('sh_e', x, y);
          if (isW(x - 1, y - 1) && !isW(x, y - 1) && !isW(x - 1, y)) this.blit('sh_nw', x, y);
          if (isW(x + 1, y - 1) && !isW(x, y - 1) && !isW(x + 1, y)) this.blit('sh_ne', x, y);
          if (isW(x - 1, y + 1) && !isW(x, y + 1) && !isW(x - 1, y)) this.blit('sh_sw', x, y);
          if (isW(x + 1, y + 1) && !isW(x, y + 1) && !isW(x + 1, y)) this.blit('sh_se', x, y);

          // 空地撒装饰：约 1/5 的格子有小花/草丛/碎石，让大地不显得空
          const hasObj = !!map.tiles[i].objectId;
          const hd = hash2(x, y, 233);
          if (!hasObj && hd < 0.22) {
            this.blitAt(`deco_${Math.floor(hd * 100) % 6}`, x * TILE + 8, y * TILE + 10);
          }
        }
      }
    }

    /* --- 网格线（很淡，仅为可读性） --- */
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 1 / cam.zoom;
    ctx.beginPath();
    for (let x = x0; x <= x1 + 1; x++) {
      ctx.moveTo(x * TILE, y0 * TILE);
      ctx.lineTo(x * TILE, (y1 + 1) * TILE);
    }
    for (let y = y0; y <= y1 + 1; y++) {
      ctx.moveTo(x0 * TILE, y * TILE);
      ctx.lineTo((x1 + 1) * TILE, y * TILE);
    }
    ctx.stroke();

    /* --- 迷雾 --- */
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = idx(map, x, y);
        if (!isRevealed(state, player, x, y)) continue;
        if (vis[i]) continue;
        ctx.fillStyle = 'rgba(6,10,18,0.52)';
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }

    /* --- 可移动范围 / 路径 / 悬停 --- */
    if (vm.reachable) {
      ctx.fillStyle = 'rgba(120,200,255,0.16)';
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = idx(map, x, y);
          const c = vm.reachable[i];
          if (!isFinite(c) || c <= 0) continue;
          if (!isRevealed(state, player, x, y)) continue;
          ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        }
      }
    }

    if (vm.path && vm.path.length > 1) {
      ctx.fillStyle = 'rgba(255,246,214,0.85)';
      for (let k = 1; k < vm.path.length; k++) {
        const p = vm.path[k];
        ctx.fillRect(p.x * TILE + TILE / 2 - 2, p.y * TILE + TILE / 2 - 2, 4, 4);
      }
    }

    if (vm.hover && isRevealed(state, player, vm.hover.x, vm.hover.y)) {
      ctx.strokeStyle = 'rgba(240,205,110,0.95)';
      ctx.lineWidth = 2 / cam.zoom;
      ctx.strokeRect(vm.hover.x * TILE + 1, vm.hover.y * TILE + 1, TILE - 2, TILE - 2);
    }

    /* --- 第二遍：物件与英雄，按 y 排序保证遮挡正确 --- */
    const draws: DrawKind[] = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = idx(map, x, y);
        if (!isRevealed(state, player, x, y)) continue;
        const id = map.tiles[i].objectId;
        if (!id) continue;
        const obj = map.objects[id];
        if (obj) draws.push({ t: 'obj', y, x, obj });
      }
    }
    for (const hid of state.heroOrder) {
      const hero = state.heroes[hid];
      if (!hero) continue;
      const rp = vm.heroRender[hid] ?? { x: hero.pos.x, y: hero.pos.y };
      if (rp.x < x0 - 2 || rp.x > x1 + 2 || rp.y < y0 - 2 || rp.y > y1 + 2) continue;
      draws.push({ t: 'hero', y: rp.y, x: rp.x, id: hid, fx: rp.x, fy: rp.y });
    }
    draws.sort((a, b) => a.y - b.y || a.x - b.x);

    for (const d of draws) {
      if (d.t === 'obj') {
        const sprite = objSprite(state, d.obj, hash2(d.x, d.y, 91));
        if (sprite) this.blit(sprite, d.x, d.y);
        const mk = guardMarker(d.obj);
        if (mk) this.blitAt(mk, d.x * TILE + 17, d.y * TILE + 17);
        if (!vis[idx(map, d.x, d.y)]) {
          ctx.fillStyle = 'rgba(6,10,18,0.4)';
          ctx.fillRect(d.x * TILE, d.y * TILE, TILE, TILE);
        }
      } else {
        const sel = d.id === vm.selectedHeroId;
        if (sel) {
          const pulse = 0.35 + 0.25 * Math.sin(now / 260);
          ctx.fillStyle = `rgba(240,205,110,${pulse.toFixed(3)})`;
          ctx.beginPath();
          ctx.ellipse(d.fx * TILE + TILE / 2, d.fy * TILE + TILE - 4, 11, 4.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        this.blit('hero_p1', Math.round(d.fx), Math.round(d.fy));
      }
    }

    ctx.restore();
  }
}
