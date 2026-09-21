/**
 * 极小 Canvas2D 垫片 —— 让运行期的**真实渲染代码**能在 node 里跑出像素。
 *
 * 与 `tools/atlasaudit.mjs` 的 `StubCtx` 的区别：那个是**空实现**（只为量打包几何），
 * 这个是**真实现**（最近邻 blit、实色填充、alpha 合成）。因此它能跑
 * `TerrainLayer.bake()` / `SetDressingLayer.bake()` / 图集构建，产出可肉眼看的图。
 *
 * 覆盖范围：只实现本项目渲染代码实际用到的那部分 Canvas2D。
 * 语义对齐点：`imageSmoothingEnabled=false` ⇒ 本垫片**一律最近邻**，绝不插值。
 */

function parseColor(c) {
  if (typeof c !== 'string') return [255, 0, 255, 1]; // 未实现的 fillStyle（渐变）——洋红报警
  if (c[0] === '#') {
    const h = c.slice(1);
    if (h.length === 3) {
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 1];
    }
    if (h.length === 6) {
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    }
    if (h.length === 8) {
      return [
        parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16) / 255,
      ];
    }
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(',').map((s) => parseFloat(s.trim()));
    return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? p[3] : 1];
  }
  return [255, 0, 255, 1];
}

class Ctx {
  constructor(canvas) {
    this.canvas = canvas;
    this.imageSmoothingEnabled = true;
    this.fillStyle = '#000000';
    this.strokeStyle = '#000000';
    this.lineWidth = 1;
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this._stack = [];
    this._rects = [];
    this._path = [];
    this._cur = null;
  }

  save() {
    this._stack.push({
      fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth,
      globalAlpha: this.globalAlpha, gco: this.globalCompositeOperation,
    });
  }
  restore() {
    const s = this._stack.pop();
    if (!s) return;
    this.fillStyle = s.fillStyle; this.strokeStyle = s.strokeStyle; this.lineWidth = s.lineWidth;
    this.globalAlpha = s.globalAlpha; this.globalCompositeOperation = s.gco;
  }
  setTransform() {}
  translate() {}
  scale() {}
  rotate() {}

  _blend(x, y, r, g, b, a) {
    const cv = this.canvas;
    if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return;
    const i = (y * cv.width + x) * 4;
    const d = cv.buf;
    const sa = Math.max(0, Math.min(1, a));
    if (sa <= 0) return;
    if (this.globalCompositeOperation === 'multiply') {
      d[i] = (d[i] * (r / 255)) * 1;
      d[i + 1] = (d[i + 1] * (g / 255)) * 1;
      d[i + 2] = (d[i + 2] * (b / 255)) * 1;
      return;
    }
    const da = d[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    d[i] = (r * sa + d[i] * da * (1 - sa)) / oa;
    d[i + 1] = (g * sa + d[i + 1] * da * (1 - sa)) / oa;
    d[i + 2] = (b * sa + d[i + 2] * da * (1 - sa)) / oa;
    d[i + 3] = oa * 255;
  }

  clearRect(x, y, w, h) {
    const cv = this.canvas;
    const d = cv.buf;
    for (let j = Math.max(0, y | 0); j < Math.min(cv.height, (y + h) | 0); j++) {
      for (let i = Math.max(0, x | 0); i < Math.min(cv.width, (x + w) | 0); i++) {
        const k = (j * cv.width + i) * 4;
        d[k] = d[k + 1] = d[k + 2] = d[k + 3] = 0;
      }
    }
  }

  fillRect(x, y, w, h) {
    const [r, g, b, a] = parseColor(this.fillStyle);
    const ga = this.globalAlpha * a;
    const x0 = Math.round(x), y0 = Math.round(y);
    const x1 = Math.round(x + w), y1 = Math.round(y + h);
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) this._blend(i, j, r, g, b, ga);
  }
  strokeRect() {}

  beginPath() { this._rects = []; this._path = []; this._cur = null; }
  closePath() {}
  rect(x, y, w, h) { this._rects.push([x, y, w, h]); }
  moveTo(x, y) { this._cur = [x, y]; }
  lineTo(x, y) { if (this._cur) this._path.push([this._cur, [x, y]]); this._cur = [x, y]; }
  fill() {
    const [r, g, b, a] = parseColor(this.fillStyle);
    for (const [x, y, w, h] of this._rects) this.fillRect(x, y, w, h);
    void r; void g; void b; void a;
    this._rects = [];
  }
  stroke() {
    const [r, g, b, a] = parseColor(this.strokeStyle);
    const ga = this.globalAlpha * a;
    for (const [[x0, y0], [x1, y1]] of this._path) {
      let x = Math.round(x0), y = Math.round(y0);
      const ex = Math.round(x1), ey = Math.round(y1);
      const dx = Math.abs(ex - x), dy = Math.abs(ey - y);
      const sx = x < ex ? 1 : -1, sy = y < ey ? 1 : -1;
      let err = dx - dy;
      for (;;) {
        this._blend(x, y, r, g, b, ga);
        if (x === ex && y === ey) break;
        const e2 = err * 2;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
    }
    this._path = [];
  }

  /** 最近邻 blit。支持 3 / 5 / 9 参数形式。 */
  drawImage(img, ...a) {
    if (!img || !img.buf) return;
    let sx = 0, sy = 0, sw = img.width, sh = img.height, dx = 0, dy = 0, dw, dh;
    if (a.length === 2) { [dx, dy] = a; dw = sw; dh = sh; }
    else if (a.length === 4) { [dx, dy, dw, dh] = a; }
    else if (a.length === 8) { [sx, sy, sw, sh, dx, dy, dw, dh] = a; }
    else return;
    const cv = this.canvas;
    const ga = this.globalAlpha;
    for (let j = 0; j < dh; j++) {
      const ty = Math.round(dy + j);
      if (ty < 0 || ty >= cv.height) continue;
      const srcY = Math.max(0, Math.min(img.height - 1, Math.floor(sy + (j * sh) / dh)));
      for (let i = 0; i < dw; i++) {
        const tx = Math.round(dx + i);
        if (tx < 0 || tx >= cv.width) continue;
        const srcX = Math.max(0, Math.min(img.width - 1, Math.floor(sx + (i * sw) / dw)));
        const k = (srcY * img.width + srcX) * 4;
        const al = img.buf[k + 3] / 255;
        if (al <= 0) continue;
        this._blend(tx, ty, img.buf[k], img.buf[k + 1], img.buf[k + 2], al * ga);
      }
    }
  }

  putImageData(img, dx, dy) {
    const cv = this.canvas;
    for (let j = 0; j < img.height; j++) {
      for (let i = 0; i < img.width; i++) {
        const tx = dx + i, ty = dy + j;
        if (tx < 0 || ty < 0 || tx >= cv.width || ty >= cv.height) continue;
        const s = (j * img.width + i) * 4, t = (ty * cv.width + tx) * 4;
        cv.buf[t] = img.data[s]; cv.buf[t + 1] = img.data[s + 1];
        cv.buf[t + 2] = img.data[s + 2]; cv.buf[t + 3] = img.data[s + 3];
      }
    }
  }

  getImageData(x, y, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    const cv = this.canvas;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const sx = x + i, sy = y + j;
        if (sx < 0 || sy < 0 || sx >= cv.width || sy >= cv.height) continue;
        const s = (sy * cv.width + sx) * 4, t = (j * w + i) * 4;
        out[t] = cv.buf[s]; out[t + 1] = cv.buf[s + 1]; out[t + 2] = cv.buf[s + 2]; out[t + 3] = cv.buf[s + 3];
      }
    }
    return new globalThis.ImageData(out, w, h);
  }

  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
}

class Canvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.style = {};
    this.buf = new Uint8ClampedArray(0);
    this._ctx = new Ctx(this);
  }
  _ensure() {
    const need = this.width * this.height * 4;
    if (this.buf.length !== need) this.buf = new Uint8ClampedArray(need);
  }
  getContext() { this._ensure(); return this._ctx; }
  toDataURL() { return ''; }
}

/** 安装垫片。返回 Canvas 类供调用方直接 new。 */
export function installShim() {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
  };
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error(`画布垫片只垫了 canvas，遇到 <${tag}>`);
      return new Canvas();
    },
  };
  globalThis.window = globalThis.window || {};
  if (typeof globalThis.localStorage === 'undefined') {
    const m = new Map();
    globalThis.localStorage = {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  }
  return { Canvas, Ctx };
}

export { Canvas };
