import type { GameState, GridPos, MapObject, PlayerId } from '../core/types.js';
import { DWELLING_IDS } from '../core/data/buildings.js';
import { factionColor } from '../core/data/factions.js';
import { computeVisible, isRevealed } from '../core/map/fog.js';
import { drawAnchor, footprintOf, idx } from '../core/map/grid.js';
import { Camera } from './camera.js';
import { TILE } from './ortho.js';
import { getAtlas } from './atlas.js';
import { hash2 } from './pixel.js';
import { TerrainLayer } from './terrainLayer.js';
import { currentLightTint, lightingOn } from './lightLayer.js';

export interface ViewModel {
  state: GameState;
  player: PlayerId;
  sight: number;
  reachable: Float64Array | null;
  path: GridPos[] | null;
  hover: GridPos | null;
  /** 跨天行程的目的地：画一面小旗，提醒玩家"昨天没走完"。 */
  dest: GridPos | null;
  selectedHeroId: string | null;
  heroRender: Record<string, { x: number; y: number }>;
}

type DrawKind =
  | { t: 'obj'; y: number; x: number; obj: MapObject }
  | { t: 'hero'; y: number; x: number; id: string; fx: number; fy: number; owner: PlayerId };

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
      const own = t && t.owner !== 'neutral' ? t.owner : 'neutral';
      // 2×2 城堡用另一套精灵（城门固定在左下角）
      if (obj.footprint) return `castle_${own}_${tier}`;
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
    case 'vault':
      return 'vault';
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
  private terrain = new TerrainLayer();

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

  /**
   * 矿场归属旗。
   *
   * 为什么不是像城堡那样把颜色烘进精灵里：矿有 7 种 × 5 个阵营 = 35 张图，
   * 而旗子只是两笔——一根杆加一个三角，直接画比烘 35 张图划算得多。
   */
  private blitMineFlag(obj: MapObject, tx: number, ty: number): void {
    if (obj.kind !== 'mine') return;
    const owner = (obj.payload as { owner: string }).owner;
    if (!owner || owner === 'neutral') return; // 无主矿不插旗：一眼能看出哪些还没人占
    const ctx = this.ctx;
    const x = tx * TILE + TILE - 7;
    const y = ty * TILE + 4;
    ctx.fillStyle = '#3a2a18';
    ctx.fillRect(x, y, 1.5, 11);
    ctx.fillStyle = factionColor(owner as never);
    ctx.beginPath();
    ctx.moveTo(x + 1.5, y + 1);
    ctx.lineTo(x + 8, y + 4);
    ctx.lineTo(x + 1.5, y + 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,16,10,0.55)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }

  draw(vm: ViewModel): void {
    const ctx = this.ctx;
    const cam = this.camera;
    const { state, player } = vm;
    const map = state.map;
    const now = performance.now();
    // 水面翻页动画：4 帧一循环。260ms/帧比原来的 520ms 顺滑，
    // 再叠加下面连续移动的高光带，肉眼基本感觉不到跳帧
    const waterFrame = Math.floor(now / 260) % 4;
    // 夜深程度 0~1：决定城镇灯火光晕的强度（深夜≈0.4，正午=0）
    const lightTint = lightingOn() ? currentLightTint(now) : { r: 255, g: 255, b: 255, warm: 0 };
    const nightDepth = Math.max(0, 1 - (lightTint.r + lightTint.g + lightTint.b) / 765);

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

    /* --- 地形层：陆地/岸线/装饰整图烘焙，一帧一次 drawImage --- */
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrain.ensure(map), 0, 0);

    /* --- 水面：唯一会动的地形，按帧画（只占可见且已探索的格子） --- */
    // 高光带：一条沿对角线扫过整张地图的正弦波，只有波峰经过的格子
    // 才点亮 2px 高光。波是连续移动的，看起来就是"碎光在水面上淌"，
    // 这是 SoC 水面氛围里性价比最高的一笔。每格采三个固定采样点。
    const GLINT_SPOTS: readonly (readonly [number, number])[] = [[9, 12], [22, 20], [14, 26]];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (map.tiles[idx(map, x, y)].terrain !== 'water') continue;
        if (!isRevealed(state, player, x, y)) continue;
        const h = hash2(x, y, 17);
        this.blit(`g_water_${h < 0.5 ? 0 : 1}_${waterFrame}`, x, y);

        for (const [ox, oy] of GLINT_SPOTS) {
          const wx = x * TILE + ox;
          const wy = y * TILE + oy;
          const wave = Math.sin((wx + wy * 0.6) / 13 - now / 430);
          if (wave > 0.9) {
            ctx.fillStyle = 'rgba(196,228,246,0.55)';
            ctx.fillRect(wx, wy, 2, 1);
          } else if (wave > 0.82) {
            ctx.fillStyle = 'rgba(150,200,230,0.3)';
            ctx.fillRect(wx, wy, 1, 1);
          }
        }
      }
    }

    /* --- 未探索遮盖：烘焙层含全图，未探索区用底色盖回去（与迷雾语义一致） --- */
    ctx.fillStyle = '#0b0d10';
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!isRevealed(state, player, x, y)) {
          ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
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

    // 跨天行程的目的地小旗：杆 + 三角旗，金色与路径点呼应
    if (vm.dest && isRevealed(state, player, vm.dest.x, vm.dest.y)) {
      const bx = vm.dest.x * TILE + TILE / 2;
      const by = vm.dest.y * TILE;
      ctx.strokeStyle = 'rgba(240,205,110,0.95)';
      ctx.lineWidth = 1.5 / cam.zoom;
      ctx.beginPath();
      ctx.moveTo(bx, by + TILE - 1);
      ctx.lineTo(bx, by + 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(240,205,110,0.95)';
      ctx.beginPath();
      ctx.moveTo(bx, by + 2);
      ctx.lineTo(bx + 7, by + 4.5);
      ctx.lineTo(bx, by + 7);
      ctx.closePath();
      ctx.fill();
    }

    if (vm.hover && isRevealed(state, player, vm.hover.x, vm.hover.y)) {
      ctx.strokeStyle = 'rgba(240,205,110,0.95)';
      ctx.lineWidth = 2 / cam.zoom;
      ctx.strokeRect(vm.hover.x * TILE + 1, vm.hover.y * TILE + 1, TILE - 2, TILE - 2);
    }

    /* --- 第二遍：物件与英雄，按 y 排序保证遮挡正确 --- */
    const draws: DrawKind[] = [];
    // 2×2 城堡的四格挂的是同一个物件 id，这里按 id 去重、只在锚点画一次
    const seenObj = new Set<string>();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = idx(map, x, y);
        if (!isRevealed(state, player, x, y)) continue;
        const id = map.tiles[i].objectId;
        if (!id || seenObj.has(id)) continue;
        seenObj.add(id);
        const obj = map.objects[id];
        if (!obj) continue;
        const a = drawAnchor(obj);
        draws.push({ t: 'obj', y: a.y, x: a.x, obj });
      }
    }
    for (const hid of state.heroOrder) {
      const hero = state.heroes[hid];
      if (!hero) continue;
      const rp = vm.heroRender[hid] ?? { x: hero.pos.x, y: hero.pos.y };
      if (rp.x < x0 - 2 || rp.x > x1 + 2 || rp.y < y0 - 2 || rp.y > y1 + 2) continue;
      // 敌方英雄只在当前视野内出现：探索过的位置不会记住一个会走路的敌人
      if (hero.owner !== player && !vis[idx(map, Math.round(rp.x), Math.round(rp.y))]) continue;
      draws.push({ t: 'hero', y: rp.y, x: rp.x, id: hid, fx: rp.x, fy: rp.y, owner: hero.owner });
    }
    draws.sort((a, b) => a.y - b.y || a.x - b.x);

    for (const d of draws) {
      if (d.t === 'obj') {
        // 夜晚的城镇会亮灯：暖色光晕垫在精灵底下，像从窗户里透出来的光。
        // 只加深夜才看得见的那点火气——夜色越深灯越亮，正午完全不开。
        if (d.obj.kind === 'town' && nightDepth > 0.08) {
          const fp = d.obj.footprint ? 1 : 0.5;
          const cx = d.x * TILE + TILE * fp;
          const cy = d.y * TILE + TILE * fp;
          const radius = TILE * (d.obj.footprint ? 2.4 : 1.8);
          const alpha = Math.min(0.5, nightDepth * 1.15);
          const glow = ctx.createRadialGradient(cx, cy, TILE * 0.3, cx, cy, radius);
          glow.addColorStop(0, `rgba(255,186,92,${alpha.toFixed(3)})`);
          glow.addColorStop(0.55, `rgba(255,150,60,${(alpha * 0.4).toFixed(3)})`);
          glow.addColorStop(1, 'rgba(255,140,50,0)');
          ctx.fillStyle = glow;
          ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
        }
        const sprite = objSprite(state, d.obj, hash2(d.x, d.y, 91));
        if (sprite) this.blit(sprite, d.x, d.y);
        const mk = guardMarker(d.obj);
        if (mk) this.blitAt(mk, d.x * TILE + 17, d.y * TILE + 17);
        // 矿场归属旗：没旗子 = 还没人占，插上谁的旗就归谁产
        this.blitMineFlag(d.obj, d.x, d.y);
        // 记忆中的（已探索但当前不可见）物件压暗；多格物件逐格判断
        ctx.fillStyle = 'rgba(6,10,18,0.4)';
        for (const c of footprintOf(d.obj)) {
          if (!isRevealed(state, player, c.x, c.y)) continue;
          if (vis[idx(map, c.x, c.y)]) continue;
          ctx.fillRect(c.x * TILE, c.y * TILE, TILE, TILE);
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
        // 敌方英雄脚下加一圈阵营色底盘，多阵营混战时一眼看清谁是谁
        if (d.owner !== player) {
          ctx.fillStyle = factionColor(d.owner);
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.ellipse(d.fx * TILE + TILE / 2, d.fy * TILE + TILE - 4, 10, 4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        this.blit(`hero_${d.owner === 'neutral' ? 'neutral' : d.owner}`, Math.round(d.fx), Math.round(d.fy));
      }
    }

    ctx.restore();

    /* --- 光照层（屏幕空间）：昼夜 multiply 叠色 + 暖光 + 暗角 --- */
    if (lightingOn()) this.applyLighting(now);
  }

  /**
   * 屏幕空间光照：一次 multiply 全屏叠色（深夜压蓝、清晨黄昏带暖），
   * 再加一个很轻的暗角把视线往画面中心收。
   * 全在主画布上原地合成，不开离屏——multiply 覆盖全屏一次的开销可以忽略。
   */
  private applyLighting(now: number): void {
    const ctx = this.ctx;
    const { viewW: w, viewH: h } = this.camera;
    const tint = currentLightTint(now);

    if (tint.r < 255 || tint.g < 255 || tint.b < 255) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${tint.r},${tint.g},${tint.b})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // 清晨/黄昏的暖光：从右上斜进来的正橘色，强度随时间起伏
    if (tint.warm > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      const g = ctx.createLinearGradient(w, 0, 0, h);
      g.addColorStop(0, `rgba(255,196,120,${(tint.warm * 0.9).toFixed(3)})`);
      g.addColorStop(0.55, `rgba(255,170,100,${(tint.warm * 0.35).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,150,90,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // 暗角：很轻，只为把视线收向中心（SoC 截图里几乎张张都有）
    ctx.save();
    const v = ctx.createRadialGradient(
      w / 2, h / 2, Math.min(w, h) * 0.42,
      w / 2, h / 2, Math.hypot(w, h) / 1.6,
    );
    v.addColorStop(0, 'rgba(8,10,16,0)');
    v.addColorStop(1, 'rgba(8,10,16,0.22)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
