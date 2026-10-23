import type { GameMap, TerrainKind } from '../core/types.js';
import { TERRAIN } from '../core/data/terrains.js';
import { idx } from '../core/map/grid.js';
import { TILE } from './ortho.js';
import { getAtlas } from './atlas.js';
import { hash2, mix } from './pixel.js';
import { quality } from './quality.js';
import { shadeOf, wetEdgeAlpha, regionShade, regionOf } from './terrainShade.js';

/**
 * 地形过渡优先级：序号高的地形会向序号低的"漫"过去。
 * 沙滩漫进草地、雪原漫进一切——这是 HoMM/SoC 像素地图的经典处理，
 * 没有它地形之间是生硬的棋盘格边界。水面不走这套（有专门的岸线精灵）。
 */
const TERRAIN_SPREAD: Record<TerrainKind, number> = {
  grass: 0, swamp: 1, rock: 2, dirt: 3, sand: 4, snow: 5, water: -1,
};

/** 4×4 Bayer 抖动矩阵：把"颜色渐变"翻译成像素画能说的"疏密渐变"。 */
const BAYER4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

/** 过渡带深度（像素）：从邻接边向低优先级地形内部渗入的距离。 */
const FRINGE_DEPTH = 6;

/**
 * 单次 `fill()` 允许积累的矩形数上限（§M-02）。
 * 一条边的过渡像素最多 FRINGE_DEPTH×TILE 个；攒到上限就先提交再开新路径，
 * 保证瞬时路径内存有界、不随 TILE / FRINGE_DEPTH 常数放大。
 */
const FRINGE_CHUNK = 128;

/**
 * 地形烘焙画布字节数：W格 × H格 × TILE² × 每像素 4B。
 * 纯函数，供分档预算核算与单测：
 * 低端 32×32 → 4 MiB；中端 40×40 → 6.25 MiB；高端 48×48 → 9 MiB。
 */
export function bakeBytes(widthTiles: number, heightTiles: number, tile: number = TILE): number {
  return widthTiles * tile * heightTiles * tile * 4;
}

/** 越界告警只记一次，避免每帧刷屏。 */
let warnedOversize = false;

/**
 * `?devregion=0` ⇒ 关闭「地貌区层」（G1 / §3.1.2 X1）；不传 / 非 `'0'` ⇒ 开。
 * node 垫片（`artshot.mjs`）里 `location` 不存在 ⇒ 视为开，由脚本显式置 `terrain.regionShade`。
 * 与 `quality.ts` 自读 `?devdpr` 同一种做法：**无人传即不影响生产路径**。
 */
/**
 * `?devfringe=top` ⇒ 过渡带退回 2026-10-23 之前的`top`取色口径。
 * 与 `?devregion=0` 同一种做法：无人传即不影响生产路径；给 A/B 与探针负向对照用。
 */
function devFringeTop(): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URLSearchParams(location.search).get('devfringe') === 'top';
  } catch {
    return false;
  }
}

function devRegionOff(): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URLSearchParams(location.search).get('devregion') === '0';
  } catch {
    return false;
  }
}

/**
 * 地形层：把"永远不会动"的部分一次性烘进一张整图大小的离屏画布。
 *
 * 为什么值得烘：原来每帧对每个可见格做一次精灵 blit + 8 次邻居水面
 * 判断（岸线）+ 装饰判定，巨型图 48×48 下一屏上千格，全是白费——
 * 地形、岸线、装饰从生成那一刻起就不会再变。烘一次之后，每帧只剩
 * 一次 drawImage，邻居判断从 O(可见格×8) 变成 O(全图×8) 但只跑一次。
 *
 * 不烘什么（以及为什么）：
 * - 水面：有 4 帧波动动画（P1.2 还会加高光带），留在每帧通道里画，
 *   烘焙层把水面格留透明，叠上去正好。
 * - 迷雾/可达范围/路径/悬停：随输入与视野每帧变，留在主通道。
 * - 物件与英雄：有 y 排序遮挡和归属旗变化，留在主通道。
 *
 * 失效时机：地图对象换引用（开新局/读档）时 ensure() 自动重烘。
 * 游戏内目前没有改地形的机制，真要加了（如搭桥）调 invalidate() 即可。
 */
export class TerrainLayer {
  private canvas: HTMLCanvasElement | null = null;
  private bakedFor: GameMap | null = null;

  /**
   * 地貌层开关（`terrainShade.ts` 的地图尺度明暗）。默认 `true`。
   * 与 `MapRenderer.badgesVisible` 同一种 dev 开关：仅供 `tools/artshot.mjs`
   * 渲染"加/不加本层"的对照截图。**无人关闭 ⇒ 非生产路径**。
   */
  macroShade = true;

  /**
   * 地貌区层开关（`terrainShade.ts` 的 G1 / §3.1.2 X1）。默认 `true`；`?devregion=0` 关。
   * 供真机视口做「只差这一层」的对照（口径见 `shots/README.md` 的「数字必须绑构建」）。
   *
   * **就地读查询参数**（不接 `main.ts` / `MapRenderer.ts`）：按 `production/roadmap.md`
   * 的单一 owner 登记表，那两个文件归 `engineering-lead`、本文件归 `art-director`
   * ⇒ 开关的"源"放在本文件里，避免为一行开关跨 owner 改文件。
   */
  regionShade = !devRegionOff();

  /** 强制下一帧重烘（预留：未来有改变地形的机制时调用）。 */
  invalidate(): void {
    this.bakedFor = null;
  }

  /**
   * 过渡带取色口径（2026-10-23）。默认 `'blend'`；`'top'` = 2026-10-23 之前的旧行为。
   *
   * **为什么要这个开关**：这是本仓唯一能对"过渡带亮度口径"做因果 A/B 的手段 ——
   * `tools/terrainedgeprobe.mjs` 拿它当负向对照（切成 `'top'` 必须让判据变红）。
   * 生产路径永远是 `'blend'`，没有任何调用方改它。
   */
  fringeTone: 'blend' | 'top' = devFringeTop() ? 'top' : 'blend';

  /**
   * 过渡带深度（像素）。生产恒为 {@link FRINGE_DEPTH}；只有探针的负向对照会设成 0
   * （`--inject=none` ⇒ 断言"过渡带确实存在"的那条必须变红）。
   */
  fringeDepth = FRINGE_DEPTH;

  /**
   * 过渡带该用哪个颜色 —— 这是"地形边界像不像贴纸"的关键一笔。
   *
   * **旧口径（`top`）的实测缺陷**：`TERRAIN[n].top` 是色板**最亮**的一档
   * （沙地 `#e8d6a3`，L=214），而旁边的沙地砖经纹理 + 光照后只有 L≈175、草地 L≈120。
   * 于是每条地形边界上都出现一圈 **比两侧都亮 39~94** 的实色边 ——
   * 72 行平均剖面：草地 120 → **214（连续 3px）** → 沙地 175。
   * 眼睛把它读成"发光描边 / 剪纸贴片"，正是主理人说的"粗糙"。
   *
   * **现在的口径**：直接取**那块地形砖的真实平均色**（`g_<kind>_0` 的像素均值），
   * 再叠加**本格的光照**（宏观明暗 + 地貌区色偏，与 `bakeShade` 同一组参数）
   * ⇒ 过渡带就是"邻居地形在本处光照下的颜色"。
   *
   * 为什么不是手调一个 `mix(top,left,k)`：k 对不同地形并不一致（实测草地→土路仍凸起 14，
   * 沙地→雪原 8）。均值是"这块砖看起来什么颜色"的直接答案，换色板也不用重调。
   */
  private fringeColor(
    neighbor: TerrainKind,
    shade1: { color: string; alpha: number },
    shade2: { color: string; alpha: number },
  ): string {
    // `'top'` = **2026-10-23 之前的完整旧口径**：既用最亮色、且**不叠任何光照**
    // （旧代码就是 `ctx.fillStyle = TERRAIN[n].top`）。负向对照要能一次红两条判据，
    // 所以这里不能只回退颜色、却留着新加的光照。
    if (this.fringeTone === 'top') return TERRAIN[neighbor].top;
    let base = this.terrainAvg(neighbor);
    // 与 `bakeShade` 完全同一组覆盖（宏观明暗 → 地貌区色偏），顺序也一致。
    if (shade1.alpha > 0.006) base = mix(base, shade1.color, shade1.alpha);
    if (shade2.alpha > 0.006) base = mix(base, shade2.color, shade2.alpha);
    return base;
  }

  /** 地形砖的真实平均色（读图集 `g_<kind>_0` 的像素均值），按地形缓存一次。 */
  private avgCache = new Map<TerrainKind, string>();

  private terrainAvg(kind: TerrainKind): string {
    const hit = this.avgCache.get(kind);
    if (hit) return hit;
    let out = TERRAIN[kind].left;
    const atlas = getAtlas();
    const f = atlas.get(`g_${kind}_0`);
    const actx = atlas.canvas.getContext('2d');
    if (f && actx) {
      const d = actx.getImageData(f.x, f.y, f.w, f.h).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] <= 8) continue;
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }
      if (n > 0) {
        const hex = (v: number): string => Math.round(v / n).toString(16).padStart(2, '0');
        out = `#${hex(r)}${hex(g)}${hex(b)}`;
      }
    }
    this.avgCache.set(kind, out);
    return out;
  }

  /** 拿到这张地图的烘焙画布；地图换了就重烘。 */
  ensure(map: GameMap): HTMLCanvasElement {
    if (this.bakedFor === map && this.canvas) return this.canvas;
    this.bake(map);
    this.bakedFor = map;
    return this.canvas!;
  }

  private bake(map: GameMap): void {
    const w = map.width * TILE;
    const h = map.height * TILE;
    // §M-02：烘焙面 = 地图格数 × TILE² × 4B。真正的上限由 quality.maxMapSize
    // 在开局处夹紧（低端 ≤32 格 → ≤4 MiB）；这里只在越界时记一次警告，便于定位回归。
    if ((map.width > quality.maxMapSize || map.height > quality.maxMapSize) && !warnedOversize) {
      warnedOversize = true;
      const mib = (bakeBytes(map.width, map.height) / 1048576).toFixed(1);
      console.warn(`[terrain] 烘焙面 ${map.width}×${map.height}（${mib} MiB）超出画质上限 ${quality.maxMapSize} 格`);
    }
    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建地形层画布上下文');
    const atlas = getAtlas();
    ctx.clearRect(0, 0, w, h);

    const blit = (name: string, gx: number, gy: number): void => {
      const f = atlas.get(name);
      if (!f) return;
      ctx.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, gx * TILE + f.ax, gy * TILE + f.ay, f.w, f.h);
    };
    const blitAt = (name: string, wx: number, wy: number): void => {
      const f = atlas.get(name);
      if (!f) return;
      ctx.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, wx, wy, f.w, f.h);
    };

    const isWater = (nx: number, ny: number): boolean =>
      nx >= 0 && ny >= 0 && nx < map.width && ny < map.height &&
      map.tiles[idx(map, nx, ny)].terrain === 'water';

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = idx(map, x, y);
        const terrain = map.tiles[i].terrain;
        // 水面留透明：动画帧在主通道按帧画，这里只烘静止的陆地
        if (terrain === 'water') continue;
        const hsh = hash2(x, y, 17);
        // 地貌区参与**砖变体**选择：同一区以某个变体为主（按区号旋转），再叠逐格哈希抖动。
        // 关掉地貌区层时 region 恒取 0 ⇒ 回到原行为（干净的 A/B 对照）。
        const region = this.regionShade ? regionOf(x, y) : 0;
        blit(`g_${terrain}_${(Math.floor(hsh * 3) + region) % 3}`, x, y);

        // 岸线：陆地与水相接的八方向描边
        if (isWater(x, y - 1)) blit('sh_n', x, y);
        if (isWater(x, y + 1)) blit('sh_s', x, y);
        if (isWater(x - 1, y)) blit('sh_w', x, y);
        if (isWater(x + 1, y)) blit('sh_e', x, y);
        if (isWater(x - 1, y - 1) && !isWater(x, y - 1) && !isWater(x - 1, y)) blit('sh_nw', x, y);
        if (isWater(x + 1, y - 1) && !isWater(x, y - 1) && !isWater(x + 1, y)) blit('sh_ne', x, y);
        if (isWater(x - 1, y + 1) && !isWater(x, y + 1) && !isWater(x - 1, y)) blit('sh_sw', x, y);
        if (isWater(x + 1, y + 1) && !isWater(x, y + 1) && !isWater(x + 1, y)) blit('sh_se', x, y);

        // 空地装饰：与原来逐帧判断用的是同一组哈希，烘出来逐像素一致
        const hasObj = !!map.tiles[i].objectId;
        const hd = hash2(x, y, 233);
        if (!hasObj && hd < 0.22) {
          blitAt(`deco_${Math.floor(hd * 100) % 6}`, x * TILE + 8, y * TILE + 10);
        }
      }
    }

    /* --- 地貌层：地图尺度的明暗（新，见 terrainShade.ts）——
       在地形砖之后、抖动过渡带之前：先铺光，再让地形边界从光里穿出来 --- */
    if (this.macroShade) this.bakeShade(ctx, map);

    /* --- 地形边缘抖动过渡：高优先级地形向低优先级"漫"一条疏密渐变的边 --- */
    this.bakeFringes(ctx, map);
  }

  /**
   * 地貌层烘焙：按地图坐标叠一层低频明暗 + 近水湿边。
   *
   * 只作用于陆地格（水面走自己的动画通道、在水面那一趟绘制，这里不能给它上色，
   * 否则会在水面格上留下一条不随波浪变化的"死带"）。
   * 全部是一次性成本：这段代码只在地图加载时跑一次，运行时仍是每帧一次 drawImage。
   */
  private bakeShade(ctx: CanvasRenderingContext2D, map: GameMap): void {
    const waterAt = (nx: number, ny: number): boolean =>
      nx >= 0 && ny >= 0 && nx < map.width && ny < map.height &&
      map.tiles[idx(map, nx, ny)].terrain === 'water';

    const prevAlpha = ctx.globalAlpha;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.tiles[idx(map, x, y)].terrain === 'water') continue;

        // ① 大尺度明暗：亮部暖、暗部冷
        const sh = shadeOf(x, y, map.height);
        if (sh.alpha > 0.006) {
          ctx.globalAlpha = sh.alpha;
          ctx.fillStyle = sh.color;
          ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        }

        // ①b 地貌区色偏（G1 / X1）：比 ① 更大尺度，回答"这是哪片地"。
        //     同为一次半透明覆盖 ⇒ 仍是**烘焙期一次性成本、运行时零成本**；关闭时整段不发生。
        if (this.regionShade) {
          const rs = regionShade(x, y);
          if (rs.alpha > 0.006) {
            ctx.globalAlpha = rs.alpha;
            ctx.fillStyle = rs.color;
            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
          }
        }

        // ② 近水湿边：朝水的每一条边压一条两段式冷暗带（外深内浅，免生硬直线）
        let wn = 0;
        if (waterAt(x, y - 1)) wn++;
        if (waterAt(x, y + 1)) wn++;
        if (waterAt(x - 1, y)) wn++;
        if (waterAt(x + 1, y)) wn++;
        const wa = wetEdgeAlpha(wn);
        if (wa <= 0.006) continue;
        const x0 = x * TILE;
        const y0 = y * TILE;
        const near = (wa * 1.15).toFixed(3);
        const far = (wa * 0.5).toFixed(3);
        ctx.fillStyle = `rgba(20,30,52,${near})`;
        if (waterAt(x, y - 1)) ctx.fillRect(x0, y0, TILE, 2);
        if (waterAt(x, y + 1)) ctx.fillRect(x0, y0 + TILE - 2, TILE, 2);
        if (waterAt(x - 1, y)) ctx.fillRect(x0, y0, 2, TILE);
        if (waterAt(x + 1, y)) ctx.fillRect(x0 + TILE - 2, y0, 2, TILE);
        ctx.fillStyle = `rgba(20,30,52,${far})`;
        if (waterAt(x, y - 1)) ctx.fillRect(x0, y0 + 2, TILE, 4);
        if (waterAt(x, y + 1)) ctx.fillRect(x0, y0 + TILE - 6, TILE, 4);
        if (waterAt(x - 1, y)) ctx.fillRect(x0 + 2, y0, 4, TILE);
        if (waterAt(x + 1, y)) ctx.fillRect(x0 + TILE - 6, y0, 4, TILE);
      }
    }
    ctx.globalAlpha = prevAlpha;
  }

  /**
   * 相邻两块不同地形之间画抖动过渡带。
   *
   * 单方向绘制：只有高优先级一侧的颜色漫进低优先级一侧，避免两边互画
   * 打架。抖动用 Bayer 矩阵控制密度（越深越稀），再叠一层坐标哈希
   * 抖动打散规则感——纯 Bayer 会有明显的"纱窗"纹理。
   */
  private bakeFringes(ctx: CanvasRenderingContext2D, map: GameMap): void {
    const terrainAt = (nx: number, ny: number): TerrainKind | null =>
      nx >= 0 && ny >= 0 && nx < map.width && ny < map.height
        ? map.tiles[idx(map, nx, ny)].terrain
        : null;

    // 四个方向：dx/dy 是邻居方位，fringe 画在本格贴邻居的那条边上
    const DIRS: { dx: number; dy: number; edge: 'n' | 's' | 'w' | 'e' }[] = [
      { dx: 0, dy: -1, edge: 'n' },
      { dx: 0, dy: 1, edge: 's' },
      { dx: -1, dy: 0, edge: 'w' },
      { dx: 1, dy: 0, edge: 'e' },
    ];

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const self = map.tiles[idx(map, x, y)].terrain;
        if (self === 'water') continue;
        const selfPrio = TERRAIN_SPREAD[self];
        // 本格的两层覆盖（与 `bakeShade` 同一组参数）：过渡带要跟着**本处**的光走，
        // 否则夜里的地图上会浮着一圈恒亮的边（旧口径 `top` 就是这个毛病）。
        const sh = this.macroShade
          ? shadeOf(x, y, map.height)
          : { color: '#000000', alpha: 0 };
        const rs = this.regionShade ? regionShade(x, y) : { color: '#000000', alpha: 0 };
        for (const { dx, dy, edge } of DIRS) {
          const n = terrainAt(x + dx, y + dy);
          if (!n || n === 'water' || n === self) continue;
          if (TERRAIN_SPREAD[n] <= selfPrio) continue;

          ctx.fillStyle = this.fringeColor(n, sh, rs);
          // 一条边的过渡像素攒进当前路径、每 FRINGE_CHUNK 个矩形提交一次：
          // 逐像素 fillRect 会让开局烘焙多花几百 ms；而把整条边（乃至整张图）
          // 攒成一个大路径，又会让瞬时路径内存随地图尺寸膨胀。折中是
          // **按边、分块**提交，峰值矩形数恒定，与地图大小无关。
          let pending = 0;
          ctx.beginPath();
          for (let d = 0; d < this.fringeDepth; d++) {
            // 越深越稀：阈值从 0 升到 1，Bayer 值小于阈值的像素不画
            const threshold = d / this.fringeDepth;
            for (let p = 0; p < TILE; p++) {
              let px: number;
              let py: number;
              switch (edge) {
                case 'n': px = p; py = d; break;
                case 's': px = p; py = TILE - 1 - d; break;
                case 'w': px = d; py = p; break;
                default: px = TILE - 1 - d; py = p; break;
              }
              const bayer = BAYER4[(py % 4) * 4 + (px % 4)] / 16;
              // 坐标哈希打散规则纹理，让边缘"咬"出不规则小齿
              const jitter = hash2(x * TILE + px, y * TILE + py, 997) * 0.3;
              if (bayer + jitter < threshold) continue;
              ctx.rect(x * TILE + px, y * TILE + py, 1, 1);
              if (++pending >= FRINGE_CHUNK) {
                ctx.fill();
                ctx.beginPath();
                pending = 0;
              }
            }
          }
          if (pending) ctx.fill();
        }
      }
    }
  }
}
