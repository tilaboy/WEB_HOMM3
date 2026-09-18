import type { GameMap, TerrainKind } from '../core/types.js';
import { TERRAIN } from '../core/data/terrains.js';
import { idx } from '../core/map/grid.js';
import { TILE } from './ortho.js';
import { getAtlas } from './atlas.js';
import { hash2 } from './pixel.js';
import { quality } from './quality.js';

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

  /** 强制下一帧重烘（预留：未来有改变地形的机制时调用）。 */
  invalidate(): void {
    this.bakedFor = null;
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
        blit(`g_${terrain}_${Math.floor(hsh * 3) % 3}`, x, y);

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

    /* --- 地形边缘抖动过渡：高优先级地形向低优先级"漫"一条疏密渐变的边 --- */
    this.bakeFringes(ctx, map);
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
        for (const { dx, dy, edge } of DIRS) {
          const n = terrainAt(x + dx, y + dy);
          if (!n || n === 'water' || n === self) continue;
          if (TERRAIN_SPREAD[n] <= selfPrio) continue;

          ctx.fillStyle = TERRAIN[n].top;
          // 一条边的过渡像素攒进当前路径、每 FRINGE_CHUNK 个矩形提交一次：
          // 逐像素 fillRect 会让开局烘焙多花几百 ms；而把整条边（乃至整张图）
          // 攒成一个大路径，又会让瞬时路径内存随地图尺寸膨胀。折中是
          // **按边、分块**提交，峰值矩形数恒定，与地图大小无关。
          let pending = 0;
          ctx.beginPath();
          for (let d = 0; d < FRINGE_DEPTH; d++) {
            // 越深越稀：阈值从 0 升到 1，Bayer 值小于阈值的像素不画
            const threshold = d / FRINGE_DEPTH;
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
