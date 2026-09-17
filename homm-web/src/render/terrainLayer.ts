import type { GameMap } from '../core/types.js';
import { idx } from '../core/map/grid.js';
import { TILE } from './ortho.js';
import { getAtlas } from './atlas.js';
import { hash2 } from './pixel.js';

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
  }
}
