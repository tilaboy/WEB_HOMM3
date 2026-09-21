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
import { SetDressingLayer } from './setDressing.js';
import { currentLightTint, lightingOn } from './lightLayer.js';
import { quality } from './quality.js';
import {
  chooseBadgeSide,
  pickRepresentativeUnit,
  sideCell,
  type BadgeFrame,
  type BBox,
} from './mapBadge.js';

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
  /** §6.1 喜剧布景层（A 组地面涂鸦）。低端 `setDressing==='off'` 时整层不烘、不画。 */
  private dressing = new SetDressingLayer();
  /** 光照梯度按视口尺寸缓存：尺寸不变就复用，消除每帧 createXxxGradient 的 GC 压力。 */
  private warmGrad: CanvasGradient | null = null;
  private warmGradW = -1;
  private warmGradH = -1;
  private vigGrad: CanvasGradient | null = null;
  private vigGradW = -1;
  private vigGradH = -1;
  /**
   * §13.4 队伍徽标：帧的**可见剪影**几何（含 1px 描边）按帧名缓存。
   * 为什么缓存：`getImageData` 每帧都跑太贵；而剪影是静态资产属性，只算一次。
   * 为什么要剪影而不是画布框：必须与审计探针 `tools/mapbadgeaudit.mjs` **同源** ——
   * 探针用 `buildB0Frame` 的真实剪影 bbox 判"压格 / 不遮物"，运行时若用 52 宽画布框
   * 会判出不同的落点 ⇒ 探针绿 ≠ 接线对。透明留白不算遮挡，剪影才算。
   */
  private silCache = new Map<string, { w: number; h: number; ax: number; ay: number; sil: BBox } | null>();

  /**
   * 队伍徽标可见性。**默认 `false`** —— 用户试玩裁决：英雄后面跟队伍「点起来更麻烦、
   * 反而增加页面复杂度、更难操作」⇒ 撤掉默认显示。帧（`u_*_map`）与 `audit:badge` 保留。
   * `?devbadge` 置 `true` —— 保留因果 A/B 能力（同一次会话、同一帧，开/关只差徽标）。
   */
  badgesVisible = false;

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
    const raw = window.devicePixelRatio || 1;
    // §5.3：只做上限钳制，**保留小数**——1.5 是合法档位，旧的 Math.round 会把它吞成 2。
    // backing 尺寸取整，setTransform 用原始小数，逻辑坐标（camera.viewW/H）不变。
    const dpr = Math.min(Math.max(raw, 1), quality.dprCap);
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

  /** 帧的可见剪影几何（懒算 + 缓存）。无此帧或无实心像素 ⇒ null。 */
  private silOf(name: string): { w: number; h: number; ax: number; ay: number; sil: BBox } | null {
    if (this.silCache.has(name)) return this.silCache.get(name)!;
    let geo: { w: number; h: number; ax: number; ay: number; sil: BBox } | null = null;
    const f = this.atlas.get(name);
    // 读图集画布：图集由本工程的 PixBuf 绘制（同源），getImageData 不会被污染拦截。
    const actx = this.atlas.canvas.getContext('2d');
    if (f && actx) {
      const d = actx.getImageData(f.x, f.y, f.w, f.h).data;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          if (d[(y * f.w + x) * 4 + 3] <= 8) continue; // alpha ≤ 8 视为透明（与 audit:b0 同口径）
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      if (x1 >= x0) geo = { w: f.w, h: f.h, ax: f.ax, ay: f.ay, sil: { x0, y0, x1, y1 } };
    }
    this.silCache.set(name, geo);
    return geo;
  }

  /** blit(name,gx,gy) 语义下（含帧自带锚点 ax/ay）该帧可见剪影的世界包围盒。 */
  private silBBoxAt(name: string, gx: number, gy: number): BBox | null {
    const g = this.silOf(name);
    if (!g) return null;
    const px = gx * TILE + g.ax;
    const py = gy * TILE + g.ay;
    return { x0: px + g.sil.x0, y0: py + g.sil.y0, x1: px + g.sil.x1, y1: py + g.sil.y1 };
  }

  /** blitAt(name,px,py) 语义下（画布左上角显式落点）该帧可见剪影的世界包围盒。 */
  private silBBoxPx(name: string, px: number, py: number): BBox | null {
    const g = this.silOf(name);
    if (!g) return null;
    return { x0: px + g.sil.x0, y0: py + g.sil.y0, x1: px + g.sil.x1, y1: py + g.sil.y1 };
  }

  /**
   * §13.4 规则 1 的"已揭示实体"：英雄周围 r 格内已揭示物件的**精灵 + guard 标记**剪影包围盒。
   * 半径 2 足够 —— 徽标是 52×44（剪影 ≤43），即使落在邻格、再外扩 ~10px 也只够到 2 格外。
   */
  private collectObstacles(vm: ViewModel, hx: number, hy: number, r: number): BBox[] {
    const { state, player } = vm;
    const map = state.map;
    const out: BBox[] = [];
    const seen = new Set<string>();
    for (let y = hy - r; y <= hy + r; y++) {
      for (let x = hx - r; x <= hx + r; x++) {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
        if (!isRevealed(state, player, x, y)) continue; // 未揭示的物件不参与（记忆里的也算信息）
        const id = map.tiles[idx(map, x, y)].objectId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const obj = map.objects[id];
        if (!obj) continue;
        const a = drawAnchor(obj);
        const sprite = objSprite(state, obj, hash2(a.x, a.y, 91));
        if (sprite) {
          const bb = this.silBBoxAt(sprite, a.x, a.y);
          if (bb) out.push(bb);
        }
        const mk = guardMarker(obj);
        if (mk) {
          // 与 draw() 中 `blitAt(mk, x*TILE+17, y*TILE+17)` 同源。
          const bb = this.silBBoxPx(mk, a.x * TILE + 17, a.y * TILE + 17);
          if (bb) out.push(bb);
        }
      }
    }
    return out;
  }

  /**
   * 画出英雄棋子旁的**队伍徽标**（§13.4 · D-64「地图单位接地图」）。
   *
   * 与审计探针 `tools/mapbadgeaudit.mjs` **同源**：落点算法取自 `./mapBadge.js`
   * （`chooseBadgeSide` / `pickRepresentativeUnit`），剪影几何与探针同口径。
   * 四条硬条件（team-lead）：
   *   ① 并入 y 排序 pass —— 本函数只在英雄那一趟里、`blit(hero_*)` 之后调用，
   *      徽标与英雄共享同一个 (y,x) 序，遮挡关系与英雄/怪物一致；
   *   ② 只横向压格、不纵向压 —— 直接用帧自带锚点落位，**不缩放**（缩放会伪造高度、破 y 排序）；
   *   ③ 可见性沿用英雄 —— 只在英雄会被画出的那一支里调；敌方英雄本就只在当前视野内出现
   *      ⇒ 不会在记忆/迷雾里泄漏敌队编成；
   *   ④ T5 取不到帧 ⇒ 跳过不画（`pickRepresentativeUnit` 未登记 + `silOf` 无帧双重兜底）。
   * 代表兵种 = `max(tier↓, count↓, canonicalId↑)`（§13.4，与探针同一个函数）。
   * 不随画质档：low/mid/high 一致（信息不能因档位缺失）。
   */
  private drawTeamBadge(vm: ViewModel, hid: string, owner: PlayerId, fx: number, fy: number): void {
    if (!this.badgesVisible) return; // 默认关；?devbadge 可开（因果 A/B 用）
    const hero = vm.state.heroes[hid];
    if (!hero) return;
    const cid = pickRepresentativeUnit(hero.army);
    if (!cid) return; // 空队 / 野怪 / T5 未登记
    const frameName = `u_${cid}_map`; // ⑤ 帧名只用 canonical id，owner 不参与
    const g = this.silOf(frameName);
    if (!g) return; // T5 等无帧 ⇒ 跳过不画（TODO：T5 精灵到位后自然生效）
    const hx = Math.round(fx);
    const hy = Math.round(fy);
    const heroName = `hero_${owner === 'neutral' ? 'neutral' : owner}`;
    // 障碍按"整枚棋子剪影（含旗）"取 —— 旗也是"这队是谁的"的信息载体，遮住即丢信息。
    const heroBody = this.silBBoxAt(heroName, hx, hy);
    if (!heroBody) return;
    const obstacles = this.collectObstacles(vm, hx, hy, 2);
    for (const oid of vm.state.heroOrder) {
      if (oid === hid) continue;
      const oh = vm.state.heroes[oid];
      if (!oh) continue;
      const rp = vm.heroRender[oid] ?? { x: oh.pos.x, y: oh.pos.y };
      const ob = this.silBBoxAt(`hero_${oh.owner === 'neutral' ? 'neutral' : oh.owner}`, Math.round(rp.x), Math.round(rp.y));
      if (ob) obstacles.push(ob);
    }
    const frame: BadgeFrame = { w: g.w, h: g.h, ax: g.ax, ay: g.ay, sil: g.sil };
    const side = chooseBadgeSide(hx, hy, frame, obstacles, heroBody);
    if (!side) return; // 四侧皆不满足 ⇒ 不画（不做降级）
    const c = sideCell(hx, hy, side);
    this.blit(frameName, c.x, c.y);
  }

  draw(vm: ViewModel): void {
    const ctx = this.ctx;
    const cam = this.camera;
    const { state, player } = vm;
    const map = state.map;
    const now = performance.now();
    // 水面翻页动画：4 帧一循环。260ms/帧比原来的 520ms 顺滑，
    // 再叠加下面连续移动的高光带，肉眼基本感觉不到跳帧
    // 低端档（waterGlint=false）水面冻结成静态帧，省掉逐格重建
    const waterFrame = quality.waterGlint ? Math.floor(now / 260) % 4 : 0;
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

    /* --- §6.1 喜剧布景层 · A 组地面涂鸦：紧接地形之后、水面之前（§6.1.3）。
       地面涂鸦永不遮挡单位 ⇒ 被后面所有图层（水 / 迷雾 / 路径 / 物件 / 英雄）自然盖住。 --- */
    if (quality.setDressing !== 'off') {
      ctx.drawImage(this.dressing.ensure(map), 0, 0);
    }

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

        if (!quality.waterGlint) continue; // 低端：不做水面高光
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

    /* --- 网格线（很淡，仅为可读性；低端关闭） --- */
    if (quality.gridLines) {
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
    }

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
        // 低端关灯火；中端半径 ×0.7（§4.2）。
        if (d.obj.kind === 'town' && quality.townGlow && nightDepth > 0.08) {
          const fp = d.obj.footprint ? 1 : 0.5;
          const cx = d.x * TILE + TILE * fp;
          const cy = d.y * TILE + TILE * fp;
          const rMul = quality.tier === 'mid' ? 0.7 : 1;
          const radius = TILE * (d.obj.footprint ? 2.4 : 1.8) * rMul;
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
          // 低端把选中脉冲降到慢呼吸（selectionPulseHz=2），中/高端维持原手感
          const pulseDiv = quality.selectionPulseHz >= 4 ? 260 : 500;
          const pulse = 0.35 + 0.25 * Math.sin(now / pulseDiv);
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
        // §13.4 队伍徽标：紧跟在英雄之后、同一趟 y 排序里画（硬条件 ①「并入 y 排序」）。
        this.drawTeamBadge(vm, d.id, d.owner, d.fx, d.fy);
      }
    }

    ctx.restore();

    /* --- 光照层（屏幕空间）：昼夜 multiply 叠色 + 暖光 + 暗角 --- */
    if (lightingOn()) this.applyLighting(now);
  }

  /**
   * 屏幕空间光照（§4.2 分档，§M-03）：
   * - quality.lighting === 'off' → 整段跳过（也受既有 lightingOn() 总开关约束）；
   * - multiply 单次叠色：深夜压蓝、清晨黄昏带暖（低/中端都有）；
   * - warm overlay 暖光：仅 full 档且 warmOverlay 打开；
   * - 暗角：仅 vignette 打开（低端关）。
   *
   * 性能：两个 gradient 都按视口尺寸缓存，尺寸不变时不重建；暖光强度改用
   * globalAlpha 承载，这样梯度对象可以复用（CanvasGradient 的 colorStop 不能清空，
   * 之前每帧新建正是 GC 压力的来源）。
   */
  private applyLighting(now: number): void {
    if (quality.lighting === 'off') return;
    const ctx = this.ctx;
    const { viewW: w, viewH: h } = this.camera;
    if (!w || !h) return;
    const tint = currentLightTint(now);

    if (tint.r < 255 || tint.g < 255 || tint.b < 255) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${tint.r},${tint.g},${tint.b})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // 清晨/黄昏的暖光：从右上斜进来的正橘色，强度随时间起伏
    if (quality.lighting === 'full' && quality.warmOverlay && tint.warm > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = tint.warm; // 强度走 globalAlpha，梯度按 warm=1 复用
      ctx.fillStyle = this.warmGradient(w, h);
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // 暗角：很轻，只为把视线收向中心（SoC 截图里几乎张张都有）
    if (quality.vignette) {
      ctx.save();
      ctx.fillStyle = this.vignetteGradient(w, h);
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  /** 暖光梯度（固定 warm=1，强度由 globalAlpha 施加），按尺寸缓存。 */
  private warmGradient(w: number, h: number): CanvasGradient {
    if (!this.warmGrad || this.warmGradW !== w || this.warmGradH !== h) {
      const g = this.ctx.createLinearGradient(w, 0, 0, h);
      g.addColorStop(0, 'rgba(255,196,120,0.9)');
      g.addColorStop(0.55, 'rgba(255,170,100,0.35)');
      g.addColorStop(1, 'rgba(255,150,90,0)');
      this.warmGrad = g;
      this.warmGradW = w;
      this.warmGradH = h;
    }
    return this.warmGrad;
  }

  /** 暗角径向梯度（静态），按尺寸缓存。 */
  private vignetteGradient(w: number, h: number): CanvasGradient {
    if (!this.vigGrad || this.vigGradW !== w || this.vigGradH !== h) {
      const v = this.ctx.createRadialGradient(
        w / 2, h / 2, Math.min(w, h) * 0.42,
        w / 2, h / 2, Math.hypot(w, h) / 1.6,
      );
      v.addColorStop(0, 'rgba(8,10,16,0)');
      v.addColorStop(1, 'rgba(8,10,16,0.22)');
      this.vigGrad = v;
      this.vigGradW = w;
      this.vigGradH = h;
    }
    return this.vigGrad;
  }
}
