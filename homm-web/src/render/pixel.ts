/**
 * 极简像素画布。
 *
 * 为什么不用 Canvas 2D 的绘图 API：那些 API 会做抗锯齿，放大 2~3 倍后边缘是灰边，
 * 看起来像"糊掉的矢量图"而不是像素画。这里所有写入都落在整数像素上，
 * 再配合渲染层的 imageSmoothingEnabled = false，才能得到 HOMM2 那种硬边颗粒感。
 */

const colorCache = new Map<string, [number, number, number]>();

export function rgbOf(c: string): [number, number, number] {
  const hit = colorCache.get(c);
  if (hit) return hit;
  let r = 0;
  let g = 0;
  let b = 0;
  if (c.startsWith('#')) {
    const h = c.slice(1);
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
    } else {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    }
  }
  const out: [number, number, number] = [r, g, b];
  colorCache.set(c, out);
  return out;
}

/** amt > 0 提亮，amt < 0 压暗。 */
export function shade(c: string, amt: number): string {
  const [r, g, b] = rgbOf(c);
  const t = amt > 0 ? 255 : 0;
  const k = Math.abs(amt);
  const m = (v: number): number => Math.max(0, Math.min(255, Math.round(v + (t - v) * k)));
  return `#${((1 << 24) | (m(r) << 16) | (m(g) << 8) | m(b)).toString(16).slice(1)}`;
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgbOf(a);
  const [r2, g2, b2] = rgbOf(b);
  const m = (x: number, y: number): number => Math.round(x + (y - x) * t);
  return `#${((1 << 24) | (m(r1, r2) << 16) | (m(g1, g2) << 8) | m(b1, b2)).toString(16).slice(1)}`;
}

/** 整数哈希 → [0,1)。用于"看起来随机但可复现"的细节。
 *  注意必须用 Math.imul：普通乘法在 JS 里超出 2^53 会丢精度，
 *  那样这个哈希会退化成近似常数（我们就踩过这个坑——满地图都是同一种装饰）。 */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * 周期性值噪声。周期 = period，采样时在 [0, period) 上取模，
 * 因此 32px 的地砖左右/上下边缘天然接得上，铺开后不会有缝。
 */
export function pnoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const w = (i: number): number => ((i % period) + period) % period;
  const a = hash2(w(ix), w(iy), seed);
  const b = hash2(w(ix + 1), w(iy), seed);
  const c = hash2(w(ix), w(iy + 1), seed);
  const d = hash2(w(ix + 1), w(iy + 1), seed);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = a + (b - a) * sx;
  const bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}

/** 两个八度的周期性噪声，返回 [0,1)。 */
export function fbm(x: number, y: number, period: number, seed: number): number {
  const a = pnoise(x, y, period, seed);
  const b = pnoise(x * 2, y * 2, period * 2, seed + 977);
  return a * 0.65 + b * 0.35;
}

export class PixBuf {
  readonly w: number;
  readonly h: number;
  private d: Uint8ClampedArray;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  alphaAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.d[(y * this.w + x) * 4 + 3];
  }

  set(x: number, y: number, color: string, a = 1): void {
    if (!this.inBounds(x, y)) return;
    const [r, g, b] = rgbOf(color);
    const i = (y * this.w + x) * 4;
    const sa = Math.max(0, Math.min(1, a));
    const da = this.d[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    this.d[i] = (r * sa + this.d[i] * da * (1 - sa)) / oa;
    this.d[i + 1] = (g * sa + this.d[i + 1] * da * (1 - sa)) / oa;
    this.d[i + 2] = (b * sa + this.d[i + 2] * da * (1 - sa)) / oa;
    this.d[i + 3] = oa * 255;
  }

  rect(x: number, y: number, w: number, h: number, color: string, a = 1): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color, a);
  }

  frame(x: number, y: number, w: number, h: number, color: string, a = 1): void {
    for (let i = 0; i < w; i++) {
      this.set(x + i, y, color, a);
      this.set(x + i, y + h - 1, color, a);
    }
    for (let j = 0; j < h; j++) {
      this.set(x, y + j, color, a);
      this.set(x + w - 1, y + j, color, a);
    }
  }

  hline(x0: number, x1: number, y: number, color: string, a = 1): void {
    const s = Math.min(x0, x1);
    const e = Math.max(x0, x1);
    for (let x = s; x <= e; x++) this.set(x, y, color, a);
  }

  vline(x: number, y0: number, y1: number, color: string, a = 1): void {
    const s = Math.min(y0, y1);
    const e = Math.max(y0, y1);
    for (let y = s; y <= e; y++) this.set(x, y, color, a);
  }

  line(x0: number, y0: number, x1: number, y1: number, color: string, a = 1): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const ex = Math.round(x1);
    const ey = Math.round(y1);
    const dx = Math.abs(ex - x);
    const dy = Math.abs(ey - y);
    const sx = x < ex ? 1 : -1;
    const sy = y < ey ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.set(x, y, color, a);
      if (x === ex && y === ey) break;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: string, a = 1): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      const dy = (y - cy) / ry;
      if (Math.abs(dy) > 1) continue;
      const span = Math.sqrt(1 - dy * dy) * rx;
      const x0 = Math.round(cx - span);
      const x1 = Math.round(cx + span);
      for (let x = x0; x <= x1; x++) this.set(x, y, color, a);
    }
  }

  /** 扫描线多边形填充（奇偶规则），无抗锯齿。 */
  poly(pts: [number, number][], color: string, a = 1): void {
    if (pts.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of pts) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        if (y1 === y2) continue;
        if (y >= Math.min(y1, y2) && y < Math.max(y1, y2)) {
          xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const s = Math.round(xs[i]);
        const e = Math.round(xs[i + 1]);
        for (let x = s; x <= e; x++) this.set(x, y, color, a);
      }
    }
  }

  tri(a: [number, number], b: [number, number], c: [number, number], color: string, alpha = 1): void {
    this.poly([a, b, c], color, alpha);
  }

  /**
   * 描边：给所有"紧邻透明像素的不透明像素"外面补一圈深色。
   * 这是像素画统一风格的关键——所有物件共用同一圈轮廓。
   */
  outline(color = '#241c12', alpha = 1): void {
    const add: [number, number][] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.alphaAt(x, y) > 8) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (this.alphaAt(x + dx, y + dy) > 8) {
              near = true;
              break;
            }
          }
        }
        if (near) add.push([x, y]);
      }
    }
    for (const [x, y] of add) this.set(x, y, color, alpha);
  }

  /** 在指定矩形内把颜色按系数整体提亮/压暗，用于给平面加体积感。 */
  tint(x: number, y: number, w: number, h: number, amt: number): void {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const px = x + i;
        const py = y + j;
        if (!this.inBounds(px, py)) continue;
        const k = (py * this.w + px) * 4;
        if (this.d[k + 3] === 0) continue;
        const t = amt > 0 ? 255 : 0;
        const m = Math.abs(amt);
        this.d[k] += (t - this.d[k]) * m;
        this.d[k + 1] += (t - this.d[k + 1]) * m;
        this.d[k + 2] += (t - this.d[k + 2]) * m;
      }
    }
  }

  toCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('无法创建画布');
    const img = new ImageData(new Uint8ClampedArray(this.d), this.w, this.h);
    ctx.putImageData(img, 0, 0);
    return c;
  }
}
