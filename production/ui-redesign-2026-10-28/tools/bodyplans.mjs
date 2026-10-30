/**
 * 兵种体形比例尺 · 第二版（2026-10-28 新阵容）
 *
 * 只画**外接剪影 + 标志性装备**，不画脸、不画材质：要审的是"五个兵是不是五个形状"。
 * 单位：cell 150×150，基准线在 cell 底部 12px，H_REF=80 = T3 的标准身高。
 *
 * 与第一版的区别：第一版 20 个兵全是"两脚站立 + 一件手持物"，身高差不到 8%。
 * 这一版按用户新给的阵容重画，核心是四条**互相独立**的体形轴：
 *   ① 身高档（0.55 ~ 1.5）
 *   ② 宽高比（窄柱 0.3 ~ 横卧 1.6）
 *   ③ 姿态轴（直立 / 前倾 / 横卧 / 悬浮）
 *   ④ 翅膀朝向（飞禽=近平展 / 天使=上掠 / 恶魔·龙=下掠）
 * 每族至少一个"根本不是站着的人"（鹰 / 狼 / 树人·龙 / 骷髅·摄魂怪）。
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'unit-forms');
const Z = 3;
const CELL = 150;
const H_REF = 80;
const COLS = 5;
const ROWS = 4;
const LABEL_W = 44;
const HEAD_H = 26;
const W = LABEL_W + COLS * CELL + 12;
const H = HEAD_H + ROWS * CELL + 10;

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

class Cv {
  constructor() {
    this.d = new Uint8ClampedArray(W * H * 4);
  }
  px(x, y, c, a = 1) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const [r, g, b] = hex(c);
    const i = (y * W + x) * 4;
    this.d[i] = r;
    this.d[i + 1] = g;
    this.d[i + 2] = b;
    this.d[i + 3] = Math.round(a * 255);
  }
  rect(x, y, w, h, c, a = 1) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c, a);
  }
  ell(x0, y0, x1, y1, c, a = 1) {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const rx = (x1 - x0) / 2 + 0.3;
    const ry = (y1 - y0) / 2 + 0.3;
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++)
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.px(x, y, c, a);
      }
  }
  ring(x0, y0, x1, y1, c, t = 2) {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const rx = (x1 - x0) / 2;
    const ry = (y1 - y0) / 2;
    for (let y = Math.floor(y0) - t; y <= Math.ceil(y1) + t; y++)
      for (let x = Math.floor(x0) - t; x <= Math.ceil(x1) + t; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const r = dx * dx + dy * dy;
        const inner = Math.max(0, 1 - t / Math.max(rx, ry));
        if (r <= 1 && r >= inner * inner) this.px(x, y, c);
      }
  }
  poly(pts, c) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc))
          xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2)
        for (let x = Math.round(xs[i]); x < Math.round(xs[i + 1]); x++) this.px(x, y, c);
    }
  }
  line(x0, y0, x1, y1, c, t = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      if (t === 1) this.px(x, y, c);
      else this.rect(Math.round(x - (t - 1) / 2), Math.round(y - (t - 1) / 2), t, t, c);
    }
  }
  /** 两段腿（有膝/肘的折角），比一条直棍好认 */
  limb(x0, y0, x1, y1, x2, y2, c, t = 2) {
    this.line(x0, y0, x1, y1, c, t);
    this.line(x1, y1, x2, y2, c, t);
  }
}

/* ---------------- 颜色 ---------------- */
const F = {
  p1: { base: '#2f5686', lit: '#5a8cc4', trim: '#e8eef6' },
  p2: { base: '#8c3b26', lit: '#c2664a', trim: '#f0b27a' },
  p3: { base: '#3f5f2e', lit: '#6d9450', trim: '#cfe0a8' },
  p4: { base: '#533a72', lit: '#8f6cb8', trim: '#d8c6ef' },
};
const GOLD = '#f2c14e';
const INK = '#1b1610';
const STEEL = '#8b939c';
const STEEL_L = '#c9d2dc';
const BONE = '#ded6c2';
const BRONZE = '#a8763f';
const BRONZE_L = '#c99a5e';
const FLAME = '#ffb347';

/* ---------------- 3×5 小字 ---------------- */
const GLYPH = {
  P: ['110', '101', '110', '100', '100'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
};
function text(cv, str, x, y, c, s = 2) {
  let cx = x;
  for (const ch of str) {
    const g = GLYPH[ch];
    if (g) {
      for (let r = 0; r < 5; r++)
        for (let q = 0; q < 3; q++) if (g[r][q] === '1') cv.rect(cx + q * s, y + r * s, s, s, c);
    }
    cx += 4 * s;
  }
}

/* ---------------- 体形基元 ---------------- */
/** 人形：h = 头顶到脚底。o.lean>0 向后仰，<0 向前倾（上半身整体平移） */
function biped(cv, cx, base, h, f, o = {}) {
  const headR = h * (o.headR ?? 0.11);
  const lean = o.lean ?? 0;
  const shoulder = base - h * 0.78;
  const hip = base - h * 0.42;
  const bw = h * (o.w ?? 0.34);
  const legW = Math.max(2, Math.round(bw * (o.legW ?? 0.24)));
  cv.rect(cx - bw * 0.42, hip, legW, base - hip, f.base);
  cv.rect(cx + bw * 0.18, hip, legW, base - hip, f.base);
  cv.poly(
    [
      [cx - bw * 0.5 + lean, shoulder],
      [cx + bw * 0.5 + lean, shoulder],
      [cx + bw * 0.36, hip + 2],
      [cx - bw * 0.36, hip + 2],
    ],
    f.base,
  );
  if (o.arms !== false) {
    cv.rect(cx - bw * 0.62 + lean, shoulder + h * 0.03, Math.max(2, bw * 0.16), h * 0.3, f.base);
    cv.rect(cx + bw * 0.46 + lean, shoulder + h * 0.03, Math.max(2, bw * 0.16), h * 0.3, f.base);
  }
  const hy = shoulder - headR * 0.95;
  cv.ell(cx - headR + lean, hy - headR, cx + headR + lean, hy + headR, f.base);
  if (o.helmet) {
    // 圆盔：盖住上半头 + 一根护鼻
    // 只留"三角盔面 + 一条盔沿 + 护鼻"：整顶涂白会读成一顶白球帽
    cv.poly(
      [
        [cx - headR * 1.06 + lean, hy - headR * 0.42],
        [cx + lean, hy - headR * 1.34],
        [cx + headR * 1.06 + lean, hy - headR * 0.42],
      ],
      f.trim,
    );
    cv.rect(cx - headR * 1.1 + lean, hy - headR * 0.5, headR * 2.2, 2, f.trim);
    cv.rect(cx - 1 + lean, hy - headR * 0.45, 2, headR * 1.05, f.trim);
  }
  return { headY: hy, headR, shoulder, hip, lean };
}

/** 四足：h = 肩高；len = 身长（倍身高） */
function quad(cv, cx, base, h, f, o = {}) {
  const bodyH = h * 0.44;
  const y0 = base - h * 0.74;
  const bodyW = h * (o.len ?? 1.3);
  const lw = Math.max(2, Math.round(h * 0.07));
  // 四条腿带一点折角（直棍会读成桌腿）
  for (const [dx, bend] of [
    [-bodyW * 0.36, -3],
    [-bodyW * 0.2, 2],
    [bodyW * 0.2, -2],
    [bodyW * 0.36, 3],
  ]) {
    const top = y0 + bodyH * 0.55;
    cv.limb(cx + dx, top, cx + dx + bend, (top + base) / 2, cx + dx, base, f.base, lw);
  }
  cv.ell(cx - bodyW / 2, y0, cx + bodyW / 2, y0 + bodyH, f.base);
  return { y0, bodyH, bodyW, backY: y0 };
}

/** 树形 */
function tree(cv, cx, base, h, f) {
  const trunkW = h * 0.21;
  cv.rect(cx - trunkW / 2, base - h * 0.6, trunkW, h * 0.6, f.base);
  for (const dir of [-1, 1])
    cv.poly(
      [
        [cx + dir * trunkW * 0.4, base - h * 0.2],
        [cx + dir * trunkW * 1.5, base - h * 0.005],
        [cx + dir * trunkW * 0.25, base - h * 0.005],
      ],
      f.base,
    );
  // 冠：三团，中间最大
  cv.ell(cx - h * 0.3, base - h * 1.0, cx + h * 0.04, base - h * 0.52, f.lit);
  cv.ell(cx - h * 0.06, base - h * 1.04, cx + h * 0.31, base - h * 0.54, f.base);
  cv.ell(cx - h * 0.19, base - h * 0.86, cx + h * 0.21, base - h * 0.46, f.base);
  // 两侧伸出的枝（比冠细，不会糊成一团）
  cv.line(cx + trunkW * 0.4, base - h * 0.62, cx + h * 0.34, base - h * 0.74, f.base, 3);
  cv.line(cx - trunkW * 0.4, base - h * 0.58, cx - h * 0.3, base - h * 0.52, f.base, 3);
}

/** 羽毛翼：上掠，下缘带 3 个羽尖缺口（天使） */
function featherWing(cv, sx, sy, dir, span, up, c) {
  const p = (a, b) => [sx + dir * span * a, sy - up * b];
  cv.poly(
    [p(0.02, -0.04), p(0.4, 0.72), p(0.86, 0.96), p(1.0, 0.64), p(0.76, 0.56), p(0.86, 0.32), p(0.6, 0.26), p(0.64, 0.04), p(0.3, -0.06)],
    c,
  );
}

/** 蝠翼：下掠 + 两根指骨（恶魔 / 龙） */
function batWing(cv, sx, sy, dir, span, up, c, bone) {
  const p1 = [sx + dir * span * 0.55, sy - up * 0.68];
  const p2 = [sx + dir * span, sy - up];
  const p3 = [sx + dir * span * 0.9, sy - up * 0.16 + span * 0.2];
  const p4 = [sx + dir * span * 0.46, sy + span * 0.2];
  cv.poly([[sx, sy], p1, p2, p3, p4], c);
  for (const q of [p1, p2, p3]) cv.line(sx, sy, q[0], q[1], bone, 1);
}

/* ---------------- 20 个兵 ---------------- */
const UNITS = [
  /* ================= p1 晨曦 ================= */
  {
    f: 'p1',
    name: '小孩',
    draw(cv, cx, base, f) {
      const h = H_REF * 0.56;
      const headR = h * 0.23; // 头占身高 1/3
      // 短腿
      cv.rect(cx - h * 0.11, base - h * 0.26, Math.max(2, h * 0.085), h * 0.26, f.base);
      cv.rect(cx + h * 0.03, base - h * 0.26, Math.max(2, h * 0.085), h * 0.26, f.base);
      // 小身子
      cv.poly(
        [
          [cx - h * 0.15, base - h * 0.62],
          [cx + h * 0.15, base - h * 0.62],
          [cx + h * 0.12, base - h * 0.24],
          [cx - h * 0.12, base - h * 0.24],
        ],
        f.base,
      );
      // 手臂：挂在躯干**外面**，否则整个人是一个没有胳膊的团
      cv.rect(cx - h * 0.22, base - h * 0.58, Math.max(2, h * 0.07), h * 0.24, f.base);
      cv.rect(cx + h * 0.15, base - h * 0.58, Math.max(2, h * 0.07), h * 0.24, f.base);
      // 短脖子（留 2px 缝，头和身体才分得开）
      cv.rect(cx - 2, base - h * 0.68, 4, h * 0.08, f.base);
      // 大头
      cv.ell(cx - headR, base - h * 0.7 - headR * 2, cx + headR, base - h * 0.7, f.base);
      return { tip: '大头' };
    },
  },
  {
    f: 'p1',
    name: '弩手',
    draw(cv, cx, base, f) {
      const h = H_REF * 0.88;
      const bb = biped(cv, cx, base, h, f, { w: 0.32, headR: 0.105 });
      cv.rect(cx - bb.headR * 1.05, bb.headY - bb.headR * 0.35, bb.headR * 2.1, 2, f.trim);
      cv.rect(cx - 1, bb.headY - bb.headR * 0.35, 2, bb.headR * 0.85, f.trim);
      const y = base - h * 0.58;
      // 弩：短托 + 前端的横向弓臂 + 指向左的矢
      cv.rect(cx - h * 0.26, y - 2, h * 0.6, 5, GOLD);
      cv.line(cx - h * 0.26, y - h * 0.1, cx - h * 0.26, y + h * 0.12, GOLD, 3);
      cv.line(cx - h * 0.26, y - h * 0.1, cx - h * 0.12, y - h * 0.02, GOLD, 1);
      cv.line(cx - h * 0.26, y + h * 0.12, cx - h * 0.12, y + h * 0.04, GOLD, 1);
      cv.line(cx - h * 0.44, y + 1, cx - h * 0.24, y + 1, STEEL, 2);
      // 背后的箭袋
      cv.rect(cx + h * 0.1, base - h * 0.76, h * 0.09, h * 0.22, f.base);
      return { tip: '横弩' };
    },
  },
  {
    f: 'p1',
    name: '鹰',
    draw(cv, cx, base, f) {
      // 飞禽：身体横卧、双翼近平展、钩喙朝左、尾羽朝右、爪子收起
      const h = H_REF * 0.7;
      const cy = base - H_REF * 0.36; // 身体中心（离地）
      // 双翼：上缘一路升到身体**上方**，下缘带 3 个羽尖缺口
      for (const dir of [-1, 1]) {
        const p = (dx, dy) => [cx + dir * h * dx, cy + h * dy];
        cv.poly(
          [p(0.08, 0.04), p(0.3, -0.5), p(0.56, -0.72), p(0.7, -0.56), p(0.56, -0.5), p(0.64, -0.34), p(0.46, -0.3), p(0.5, -0.14), p(0.26, -0.08), p(0.14, 0.08)],
          f.lit,
        );
        cv.line(cx + dir * h * 0.1, cy - h * 0.06, cx + dir * h * 0.64, cy - h * 0.62, f.base, 1);
      }
      // 身体
      cv.ell(cx - h * 0.3, cy - h * 0.14, cx + h * 0.3, cy + h * 0.16, f.base);
      // 尾羽（右）
      cv.poly(
        [
          [cx + h * 0.2, cy - h * 0.04],
          [cx + h * 0.52, cy - h * 0.1],
          [cx + h * 0.46, cy + h * 0.14],
          [cx + h * 0.18, cy + h * 0.12],
        ],
        f.base,
      );
      // 头 + 钩喙
      cv.ell(cx - h * 0.42, cy - h * 0.34, cx - h * 0.16, cy - h * 0.02, f.base);
      cv.poly(
        [[cx - h * 0.4, cy - h * 0.26], [cx - h * 0.6, cy - h * 0.16], [cx - h * 0.4, cy - h * 0.06]],
        GOLD,
      );
      // 收起的两爪（离地 = 在飞）
      for (const dx of [-0.08, 0.08]) cv.line(cx + h * dx, cy + h * 0.16, cx + h * (dx + 0.03), cy + h * 0.34, f.base, 2);
      return { tip: '平展翼' };
    },
  },
  {
    f: 'p1',
    name: '骑士',
    draw(cv, cx, base, f) {
      const h = H_REF * 0.84;
      const b = quad(cv, cx, base, h, f, { len: 1.16 });
      const bw = b.bodyW;
      const y0 = b.y0;
      const bh = b.bodyH;
      // 脖子
      cv.poly(
        [
          [cx - bw * 0.34, y0 + bh * 0.9],
          [cx - bw * 0.42, y0 + bh * 0.2],
          [cx - bw * 0.64, y0 - bh * 0.5],
          [cx - bw * 0.46, y0 - bh * 0.5],
        ],
        f.base,
      );
      // 头 + 双耳 + 鬃
      cv.ell(cx - bw * 0.76, y0 - bh * 0.72, cx - bw * 0.5, y0 - bh * 0.3, f.base);
      cv.rect(cx - bw * 0.68, y0 - bh * 0.64, bw * 0.2, bh * 0.22, f.base);
      for (const dx of [-0.74, -0.6])
        cv.poly(
          [
            [cx + bw * dx, y0 - bh * 0.7],
            [cx + bw * (dx + 0.03), y0 - bh * 1.0],
            [cx + bw * (dx + 0.08), y0 - bh * 0.68],
          ],
          f.base,
        );
      // 马铠：只盖后胯一小块，不做大白布
      cv.poly(
        [
          [cx + bw * 0.04, y0 + bh * 0.15],
          [cx + bw * 0.44, y0 + bh * 0.15],
          [cx + bw * 0.42, y0 + bh * 0.9],
          [cx + bw * 0.2, y0 + bh * 1.05],
          [cx + bw * 0.08, y0 + bh * 0.9],
        ],
        f.lit,
      );
      // 马尾
      cv.line(cx + bw * 0.5, y0 + bh * 0.2, cx + bw * 0.6, y0 + bh * 0.9, f.base, 2);
      // 骑手（坐姿）
      const ry = y0 + bh * 0.1;
      const rh = h * 0.52;
      cv.poly(
        [
          [cx - rh * 0.16, ry],
          [cx + rh * 0.16, ry],
          [cx + rh * 0.14, ry - rh * 0.42],
          [cx - rh * 0.14, ry - rh * 0.42],
        ],
        f.base,
      );
      cv.ell(cx - rh * 0.12, ry - rh * 0.66, cx + rh * 0.12, ry - rh * 0.42, f.base);
      cv.poly(
        [
          [cx - rh * 0.15, ry - rh * 0.86],
          [cx + rh * 0.03, ry - rh * 0.98],
          [cx + rh * 0.13, ry - rh * 0.7],
          [cx - rh * 0.1, ry - rh * 0.62],
        ],
        f.trim,
      );
      // 长枪：从手**斜向上**举（水平平伸会横穿到隔壁格，也读成旗杆）
      cv.line(cx + rh * 0.08, ry - rh * 0.32, cx - bw * 0.7, ry - rh * 0.5, GOLD, 2);
      cv.poly(
        [
          [cx - bw * 0.7, ry - rh * 0.5],
          [cx - bw * 0.78, ry - rh * 0.52],
          [cx - bw * 0.72, ry - rh * 0.4],
        ],
        GOLD,
      );
      return { tip: '马+枪' };
    },
  },
  {
    f: 'p1',
    name: '天使',
    draw(cv, cx, base, f) {
      const h = H_REF * 1.12;
      const lift = 6;
      const bb = base - lift;
      const headR = h * 0.1;
      const shoulder = bb - h * 0.74;
      // 袍
      cv.poly(
        [
          [cx - h * 0.12, shoulder],
          [cx + h * 0.12, shoulder],
          [cx + h * 0.18, bb - h * 0.03],
          [cx - h * 0.18, bb - h * 0.03],
        ],
        f.base,
      );
      // 肩 + 头
      cv.rect(cx - h * 0.12, shoulder - h * 0.04, h * 0.24, h * 0.1, f.base);
      cv.ell(cx - headR, shoulder - headR * 2.1, cx + headR, shoulder - headR * 0.1, f.base);
      // 双翼上掠（羽尖缺口在下缘）
      featherWing(cv, cx - h * 0.05, shoulder + 2, -1, h * 0.6, h * 0.72, f.lit);
      featherWing(cv, cx + h * 0.05, shoulder + 2, 1, h * 0.6, h * 0.72, f.lit);
      // 光环：紧贴头顶，不飘到天上去
      const hy = shoulder - headR * 2.1;
      cv.ring(cx - h * 0.11, hy - headR * 0.62, cx + h * 0.11, hy + headR * 0.02, GOLD, 2);
      return { tip: '光环+上掠翼' };
    },
  },

  /* ================= p2 赤焰 ================= */
  {
    f: 'p2',
    name: '火柴人',
    draw(cv, cx, base, f) {
      const h = H_REF * 0.82;
      // 躯干 4px、四肢 3px —— 全表最窄
      cv.rect(cx - 2, base - h * 0.62, 4, h * 0.4, f.base);
      cv.line(cx, base - h * 0.58, cx - h * 0.2, base - h * 0.32, f.base, 3);
      cv.line(cx, base - h * 0.58, cx + h * 0.19, base - h * 0.44, f.base, 3);
      cv.line(cx - 1, base - h * 0.22, cx - h * 0.15, base, f.base, 3);
      cv.line(cx + 1, base - h * 0.22, cx + h * 0.15, base, f.base, 3);
      // 头 + 一簇火舌（不对称，才不像王冠）
      const hy = base - h * 0.76;
      cv.ell(cx - h * 0.1, hy - h * 0.1, cx + h * 0.1, hy + h * 0.1, f.base);
      cv.poly(
        [[cx - h * 0.06, hy - h * 0.06], [cx + h * 0.02, hy - h * 0.36], [cx + h * 0.1, hy - h * 0.14], [cx + h * 0.14, hy - h * 0.3], [cx + h * 0.12, hy + h * 0.02]],
        FLAME,
      );
      // 举在手上的火焰弹
      const fx = cx - h * 0.26;
      const fy = base - h * 0.32;
      cv.ell(fx - 6, fy - 6, fx + 6, fy + 6, FLAME);
      cv.ell(fx - 3, fy - 3, fx + 2, fy + 2, '#fff3c8');
      return { tip: '火焰' };
    },
  },
  {
    f: 'p2',
    name: '铜人',
    draw(cv, cx, base, f) {
      const m = { base: BRONZE, lit: BRONZE_L, trim: '#e2b878' };
      const h = H_REF * 0.78;
      const bw = h * 0.6;
      // 粗腿 + 脚
      cv.rect(cx - bw * 0.42, base - h * 0.36, bw * 0.3, h * 0.36, m.base);
      cv.rect(cx + bw * 0.12, base - h * 0.36, bw * 0.3, h * 0.36, m.base);
      cv.rect(cx - bw * 0.46, base - 3, bw * 0.36, 3, m.trim);
      cv.rect(cx + bw * 0.1, base - 3, bw * 0.36, 3, m.trim);
      // 躯干：上宽下窄的整块（不是矩形，"+"形会读成十字架）
      cv.poly(
        [
          [cx - bw * 0.52, base - h * 0.74],
          [cx + bw * 0.52, base - h * 0.74],
          [cx + bw * 0.4, base - h * 0.34],
          [cx - bw * 0.4, base - h * 0.34],
        ],
        m.base,
      );
      // 肩甲：两块压出来的斜面
      for (const dir of [-1, 1])
        cv.poly(
          [
            [cx + dir * bw * 0.2, base - h * 0.8],
            [cx + dir * bw * 0.54, base - h * 0.75],
            [cx + dir * bw * 0.5, base - h * 0.65],
            [cx + dir * bw * 0.2, base - h * 0.68],
          ],
          m.lit,
        );
      // 手臂 + 方拳
      cv.rect(cx - bw * 0.66, base - h * 0.68, bw * 0.16, h * 0.26, m.base);
      cv.rect(cx + bw * 0.5, base - h * 0.68, bw * 0.16, h * 0.26, m.base);
      cv.rect(cx - bw * 0.72, base - h * 0.44, bw * 0.24, h * 0.1, m.lit);
      cv.rect(cx + bw * 0.48, base - h * 0.44, bw * 0.24, h * 0.1, m.lit);
      // 头：直接坐进肩窝
      cv.rect(cx - bw * 0.26, base - h * 0.96, bw * 0.52, h * 0.22, m.base);
      cv.rect(cx - bw * 0.26, base - h * 0.96, bw * 0.52, 2, m.lit);
      cv.rect(cx - bw * 0.18, base - h * 0.88, bw * 0.36, 3, INK);
      cv.rect(cx - bw * 0.1, base - h * 0.8, bw * 0.2, 2, INK);
      // 铆钉
      cv.rect(cx - 1, base - h * 0.72, 2, h * 0.36, m.trim);
      return { tip: '方肩' };
    },
  },
  {
    f: 'p2',
    name: '三头狼',
    draw(cv, cx, base, f) {
      const h = H_REF * 0.7;
      const b = quad(cv, cx, base, h, f, { len: 1.3 });
      const bw = b.bodyW;
      const bh = b.bodyH;
      const y0 = b.y0;
      // 蓬尾
      cv.poly(
        [[cx + bw * 0.44, y0 + bh * 0.1], [cx + bw * 0.68, y0 - bh * 0.4], [cx + bw * 0.74, y0 + bh * 0.7]],
        f.base,
      );
      // 三个头：低前 / 高上 / 中间偏后 —— 拉开纵向间距，否则三张脸糊成一张
      const heads = [
        { x: -0.62, y: 0.78, r: 0.112, s: 1.0 },
        { x: -0.5, y: 0.06, r: 0.104, s: 0.95 },
        { x: -0.38, y: -0.66, r: 0.096, s: 0.9 },
      ];
      for (const hd of heads) {
        const hx = cx + bw * hd.x;
        const hy = y0 + bh * hd.y;
        const r = h * hd.r;
        // 脖子：从肩部连到各自的头
        cv.line(cx - bw * 0.2, y0 + bh * 0.35, hx + r * 0.3, hy, f.base, 3);
        // 吻部
        cv.poly(
          [[hx - r * 0.3, hy - r * 0.55], [hx - r * 2.0 * hd.s, hy - r * 0.05], [hx - r * 0.3, hy + r * 0.55]],
          f.base,
        );
        cv.ell(hx - r, hy - r, hx + r, hy + r, f.base);
        // 双耳
        for (const dx of [-0.45, 0.25])
          cv.poly(
            [
              [hx + r * dx, hy - r * 0.7],
              [hx + r * (dx + 0.12), hy - r * 1.75],
              [hx + r * (dx + 0.5), hy - r * 0.6],
            ],
            f.base,
          );
        cv.rect(hx - r * 0.45, hy - r * 0.25, 2, 2, GOLD);
      }
      return { tip: '三个吻' };
    },
  },
  {
    f: 'p2',
    name: '熔岩巨人',
    draw(cv, cx, base, f) {
      const h = H_REF * 1.4;
      biped(cv, cx, base, h, f, { w: 0.48, headR: 0.072, lean: 3 });
      // 岩肩：两块外挑的石板（比头低、比肩宽）；再大就成披风了
      for (const dir of [-1, 1])
        cv.poly(
          [
            [cx + dir * h * 0.08, base - h * 0.84],
            [cx + dir * h * 0.36, base - h * 0.76],
            [cx + dir * h * 0.32, base - h * 0.64],
            [cx + dir * h * 0.08, base - h * 0.67],
          ],
          f.lit,
        );
      // 熔岩裂缝（粗一点，才不止是一条金线）
      cv.poly(
        [[cx - h * 0.14, base - h * 0.66], [cx - h * 0.02, base - h * 0.5], [cx + h * 0.06, base - h * 0.58], [cx + h * 0.02, base - h * 0.3], [cx - h * 0.1, base - h * 0.42]],
        FLAME,
      );
      // 垂地的巨拳：小臂从肩外侧下来，拳头落在身体轮廓**之外**
      cv.line(cx + h * 0.28, base - h * 0.58, cx + h * 0.4, base - h * 0.22, f.base, 6);
      cv.ell(cx + h * 0.32, base - h * 0.24, cx + h * 0.54, base - h * 0.02, f.base);
      cv.ell(cx + h * 0.34, base - h * 0.22, cx + h * 0.5, base - h * 0.08, f.lit);
      return { tip: '岩肩' };
    },
  },
  {
    f: 'p2',
    name: '恶魔',
    draw(cv, cx, base, f) {
      const h = H_REF * 1.12;
      const lift = 10;
      const bb = base - lift;
      const headR = h * 0.095;
      const shoulder = bb - h * 0.74;
      // 躯干 + 腿
      cv.poly(
        [
          [cx - h * 0.11, shoulder],
          [cx + h * 0.11, shoulder],
          [cx + h * 0.08, bb - h * 0.16],
          [cx - h * 0.08, bb - h * 0.16],
        ],
        f.base,
      );
      for (const dir of [-1, 1]) {
        cv.line(cx + dir * h * 0.05, bb - h * 0.18, cx + dir * h * 0.09, bb - h * 0.02, f.base, 3);
        cv.poly(
          [[cx + dir * h * 0.05, bb - h * 0.04], [cx + dir * h * 0.16, bb], [cx + dir * h * 0.02, bb]],
          BONE,
        );
      }
      // 蝠翼向下外掠（天使向上、鹰水平，三个方向互不吞掉）
      batWing(cv, cx - h * 0.08, shoulder + h * 0.08, -1, h * 0.66, h * 0.26, f.lit, f.base);
      batWing(cv, cx + h * 0.08, shoulder + h * 0.08, 1, h * 0.66, h * 0.26, f.lit, f.base);
      // 头 + 双角
      const hy = shoulder - headR * 1.6;
      cv.ell(cx - headR, hy - headR, cx + headR, hy + headR, f.base);
      for (const dir of [-1, 1])
        cv.poly(
          [
            [cx + dir * headR * 0.35, hy - headR * 0.55],
            [cx + dir * headR * 1.15, hy - headR * 2.3],
            [cx + dir * headR * 1.05, hy - headR * 0.35],
          ],
          BONE,
        );
      // 尾巴 + 铲尖
      cv.line(cx + h * 0.06, bb - h * 0.28, cx + h * 0.34, bb - h * 0.06, f.base, 2);
      cv.poly([[cx + h * 0.32, bb - h * 0.1], [cx + h * 0.44, bb - h * 0.02], [cx + h * 0.3, bb - h * 0.01]], f.base);
      return { tip: '角+下掠蝠翼' };
    },
  },

  /* ================= p3 翠林 ================= */
  {
    f: 'p3',
    name: '矮人',
    draw(cv, cx, base, f) {
      const h = H_REF * 0.54;
      const headR = h * 0.17;
      // 短腿 + 宽身
      cv.rect(cx - h * 0.17, base - h * 0.3, Math.max(2, h * 0.13), h * 0.3, f.base);
      cv.rect(cx + h * 0.05, base - h * 0.3, Math.max(2, h * 0.13), h * 0.3, f.base);
      cv.poly(
        [
          [cx - h * 0.3, base - h * 0.72],
          [cx + h * 0.3, base - h * 0.72],
          [cx + h * 0.26, base - h * 0.28],
          [cx - h * 0.26, base - h * 0.28],
        ],
        f.base,
      );
      // 手臂
      cv.rect(cx - h * 0.38, base - h * 0.7, Math.max(2, h * 0.1), h * 0.3, f.base);
      cv.rect(cx + h * 0.28, base - h * 0.7, Math.max(2, h * 0.1), h * 0.3, f.base);
      // 头
      const hy = base - h * 0.72 - headR;
      cv.ell(cx - headR, hy - headR, cx + headR, hy + headR, f.base);
      // 大胡子：从两颊垂到胸口，下缘锯齿
      cv.poly(
        [
          [cx - headR * 0.82, hy + headR * 0.5],
          [cx + headR * 0.82, hy + headR * 0.5],
          [cx + headR * 0.58, hy + headR * 1.8],
          [cx + headR * 0.2, hy + headR * 1.4],
          [cx, hy + headR * 2.0],
          [cx - headR * 0.2, hy + headR * 1.4],
          [cx - headR * 0.58, hy + headR * 1.8],
        ],
        BONE,
      );
      // 盔：只盖上半头，留一圈脸（整头盖住会读成骷髅）
      cv.poly(
        [
          [cx - headR * 1.02, hy + headR * 0.05],
          [cx - headR * 0.9, hy - headR * 0.85],
          [cx, hy - headR * 1.3],
          [cx + headR * 0.9, hy - headR * 0.85],
          [cx + headR * 1.02, hy + headR * 0.05],
        ],
        f.trim,
      );
      cv.rect(cx - headR * 1.05, hy + headR * 0.0, headR * 2.1, 2, f.trim);
      for (const dir of [-1, 1])
        cv.poly(
          [
            [cx + dir * headR * 0.92, hy - headR * 0.7],
            [cx + dir * headR * 1.7, hy - headR * 1.35],
            [cx + dir * headR * 1.05, hy - headR * 0.25],
          ],
          BONE,
        );
      // 竖斧：斧柄高过头顶，刃朝左（同族出口占"右上"）
      const ax = cx + h * 0.48;
      cv.line(ax, base - h * 0.02, ax, base - h * 0.92, GOLD, 4);
      // 斧刃：胸口高度、约 0.4h 宽 —— 太小就只是一根带旗的杆
      cv.poly(
        [
          [ax, base - h * 0.96],
          [ax - h * 0.3, base - h * 0.88],
          [ax - h * 0.4, base - h * 0.7],
          [ax - h * 0.3, base - h * 0.52],
          [ax, base - h * 0.44],
          [ax - h * 0.1, base - h * 0.7],
        ],
        '#6f7681',
      );
      cv.line(ax - h * 0.36, base - h * 0.86, ax - h * 0.38, base - h * 0.56, STEEL_L, 1);
      return { tip: '竖斧+大胡子' };
    },
  },
  {
    f: 'p3',
    name: '丛林射手',
    draw(cv, cx, base, f) {
      const h = H_REF * 1.0;
      const b = biped(cv, cx, base, h, f, { w: 0.24, headR: 0.085, lean: 1, arms: false });
      // 尖兜帽（向后上方挑）
      cv.poly(
        [
          [cx - b.headR * 1.1, b.headY + b.headR * 0.55],
          [cx - b.headR * 1.05, b.headY - b.headR * 0.35],
          [cx + b.headR * 0.9, b.headY - b.headR * 1.35],
          [cx + b.headR * 1.15, b.headY - b.headR * 0.3],
          [cx + b.headR * 0.95, b.headY + b.headR * 0.5],
        ],
        f.lit,
      );
      // 持弓的手臂
      cv.line(cx + h * 0.1, base - h * 0.72, cx + h * 0.3, base - h * 0.56, f.base, 3);
      // 长弓：只画弧 + 一根极细的弦，不围成全封闭的 "D"
      const bx = cx + h * 0.34;
      const top = base - h * 0.98;
      const bot = base - h * 0.18;
      cv.line(bx, top, cx + h * 0.5, base - h * 0.72, GOLD, 2);
      cv.line(cx + h * 0.5, base - h * 0.72, cx + h * 0.5, base - h * 0.44, GOLD, 2);
      cv.line(cx + h * 0.5, base - h * 0.44, bx, bot, GOLD, 2);
      cv.line(bx, top, bx, bot, f.base, 1);
      // 搭在弦上的箭（指向左）
      cv.line(bx, base - h * 0.58, cx + h * 0.02, base - h * 0.58, BONE, 1);
      // 背上的箭袋（在左肩，不越过头部）
      cv.rect(cx - h * 0.22, base - h * 0.62, h * 0.09, h * 0.22, f.base);
      for (let i = 0; i < 2; i++)
        cv.line(cx - h * 0.21 + i * 4, base - h * 0.64, cx - h * 0.24 + i * 4, base - h * 0.74, BONE, 1);
      return { tip: '长弓' };
    },
  },
  {
    f: 'p3',
    name: '树人',
    draw(cv, cx, base, f) {
      const h = H_REF * 1.46;
      tree(cv, cx, base, h, f);
      // 树洞眼（两个深色孔，是"活物"的唯一线索）
      cv.ell(cx - h * 0.07, base - h * 0.68, cx - h * 0.01, base - h * 0.6, INK);
      cv.ell(cx + h * 0.02, base - h * 0.68, cx + h * 0.08, base - h * 0.6, INK);
      return { tip: '冠+根' };
    },
  },
  {
    f: 'p3',
    name: '猿人',
    draw(cv, cx, base, f) {
      const h = H_REF * 0.86;
      // 短弯腿
      for (const dir of [-1, 1]) cv.limb(cx + dir * h * 0.12, base - h * 0.3, cx + dir * h * 0.2, base - h * 0.16, cx + dir * h * 0.14, base, f.base, 4);
      // 大躯干（前倾，肩比胯宽）
      cv.poly(
        [
          [cx - h * 0.28, base - h * 0.72],
          [cx + h * 0.26, base - h * 0.72],
          [cx + h * 0.2, base - h * 0.26],
          [cx - h * 0.2, base - h * 0.26],
        ],
        f.base,
      );
      // 低头的头：无颈、宽下颌、眉脊
      const hy = base - h * 0.78;
      cv.ell(cx - h * 0.17, hy - h * 0.11, cx + h * 0.13, hy + h * 0.1, f.base);
      // 前突的吻 + 眉脊（没有这两样就只是一个绿方块）
      cv.rect(cx - h * 0.26, hy - h * 0.01, h * 0.12, h * 0.09, f.base);
      cv.rect(cx - h * 0.17, hy - h * 0.04, h * 0.28, 3, f.lit);
      cv.ell(cx - h * 0.19, hy - h * 0.02, cx - h * 0.13, hy + h * 0.05, f.base);
      cv.ell(cx + h * 0.1, hy - h * 0.02, cx + h * 0.16, hy + h * 0.05, f.base);
      cv.rect(cx - h * 0.24, hy + h * 0.04, h * 0.08, 2, INK);
      // 两条极长的手臂：一条垂地，一条折起来举香蕉
      cv.limb(cx - h * 0.28, base - h * 0.68, cx - h * 0.34, base - h * 0.34, cx - h * 0.3, base - h * 0.04, f.base, 5);
      cv.limb(cx + h * 0.26, base - h * 0.68, cx + h * 0.36, base - h * 0.5, cx + h * 0.24, base - h * 0.44, f.base, 5);
      // 拳
      cv.ell(cx - h * 0.34, base - h * 0.1, cx - h * 0.24, base, f.base);
      // 香蕉：紧贴手心，不飘在外面
      cv.line(cx + h * 0.18, base - h * 0.4, cx + h * 0.04, base - h * 0.58, GOLD, 4);
      cv.line(cx + h * 0.04, base - h * 0.58, cx + h * 0.12, base - h * 0.66, GOLD, 4);
      return { tip: '长臂+香蕉' };
    },
  },
  {
    f: 'p3',
    name: '绿龙',
    draw(cv, cx, base, f) {
      const h = H_REF * 0.92;
      const b = quad(cv, cx, base, h, f, { len: 0.98 });
      const bw = b.bodyW;
      const bh = b.bodyH;
      const y0 = b.y0;
      // 长脖：从身体前上方斜向左上
      cv.poly(
        [
          [cx - bw * 0.3, y0 + bh * 0.85],
          [cx - bw * 0.44, y0 + bh * 0.2],
          [cx - bw * 0.66, y0 - bh * 1.05],
          [cx - bw * 0.5, y0 - bh * 1.0],
        ],
        f.base,
      );
      // 头 + 长吻 + 后掠双角
      cv.ell(cx - bw * 0.78, y0 - bh * 1.3, cx - bw * 0.54, y0 - bh * 0.92, f.base);
      cv.poly(
        [[cx - bw * 0.74, y0 - bh * 1.24], [cx - bw * 1.0, y0 - bh * 1.14], [cx - bw * 0.74, y0 - bh * 0.94]],
        f.base,
      );
      cv.rect(cx - bw * 0.8, y0 - bh * 1.12, bw * 0.1, 3, INK);
      for (const dy of [0, 6])
        cv.line(cx - bw * 0.62, y0 - bh * 1.24 + dy, cx - bw * 0.48, y0 - bh * 1.5 + dy, BONE, 2);
      // 一只大翼（后侧）+ 一只小的（远侧），避免两边对称变成"两片叶子"
      batWing(cv, cx + bw * 0.0, y0 + bh * 0.15, 1, h * 0.5, h * 0.46, f.lit, f.base);
      batWing(cv, cx + bw * 0.0, y0 + bh * 0.2, -1, h * 0.28, h * 0.3, f.lit, f.base);
      // 尾
      cv.poly(
        [[cx + bw * 0.4, y0 + bh * 0.3], [cx + bw * 0.74, y0 - bh * 0.05], [cx + bw * 0.7, y0 + bh * 0.6]],
        f.base,
      );
      // 口前的一小簇火
      cv.poly(
        [[cx - bw * 1.0, y0 - bh * 1.16], [cx - bw * 1.14, y0 - bh * 1.2], [cx - bw * 1.0, y0 - bh * 1.02]],
        FLAME,
      );
      return { tip: '长颈+翼' };
    },
  },

  /* ================= p4 紫晶 ================= */
  {
    f: 'p4',
    name: '骷髅',
    draw(cv, cx, base, f) {
      const h = H_REF * 1.02;
      // 脊柱 + 肋骨（留空造骨感）
      cv.rect(cx - 1, base - h * 0.72, 3, h * 0.34, BONE);
      for (let i = 0; i < 4; i++) {
        const y = base - h * 0.68 + i * h * 0.07;
        cv.line(cx - h * 0.09, y, cx + h * 0.09, y, BONE, 2);
      }
      cv.rect(cx - h * 0.06, base - h * 0.4, h * 0.12, h * 0.05, BONE);
      // 腿：两段细骨
      for (const dir of [-1, 1]) {
        cv.line(cx + dir * 3, base - h * 0.36, cx + dir * h * 0.07, base - h * 0.18, BONE, 2);
        cv.line(cx + dir * h * 0.07, base - h * 0.18, cx + dir * 4, base, BONE, 2);
      }
      // 手臂 + 锈剑
      cv.line(cx - h * 0.07, base - h * 0.7, cx - h * 0.15, base - h * 0.44, BONE, 2);
      cv.line(cx + h * 0.07, base - h * 0.7, cx + h * 0.17, base - h * 0.48, BONE, 2);
      cv.line(cx + h * 0.17, base - h * 0.48, cx + h * 0.3, base - h * 0.1, STEEL, 2);
      // 头骨
      const hy = base - h * 0.84;
      cv.ell(cx - h * 0.095, hy - h * 0.11, cx + h * 0.095, hy + h * 0.1, BONE);
      cv.rect(cx - h * 0.055, hy + h * 0.06, h * 0.11, h * 0.05, BONE);
      cv.rect(cx - h * 0.065, hy - h * 0.04, 4, 4, INK);
      cv.rect(cx + h * 0.025, hy - h * 0.04, 4, 4, INK);
      return { tip: '肋骨' };
    },
  },
  {
    f: 'p4',
    name: '僵尸',
    draw(cv, cx, base, f) {
      const h = H_REF * 0.86;
      const lean = -5;
      // 一条腿在前、一条拖后
      cv.line(cx - h * 0.1, base - h * 0.34, cx - h * 0.16, base, f.base, 4);
      cv.line(cx + h * 0.1, base - h * 0.34, cx + h * 0.18, base, f.base, 4);
      // 前倾的躯干
      cv.poly(
        [
          [cx - h * 0.2 + lean, base - h * 0.74],
          [cx + h * 0.2 + lean, base - h * 0.74],
          [cx + h * 0.17, base - h * 0.32],
          [cx - h * 0.17, base - h * 0.32],
        ],
        f.base,
      );
      // 两条前伸的直臂（不同高度，中间留缝）
      cv.line(cx - h * 0.16 + lean, base - h * 0.72, cx - h * 0.44 + lean, base - h * 0.82, f.base, 3);
      cv.line(cx - h * 0.14 + lean, base - h * 0.5, cx - h * 0.4 + lean, base - h * 0.4, f.base, 3);
      cv.ell(cx - h * 0.49 + lean, base - h * 0.86, cx - h * 0.43 + lean, base - h * 0.78, f.base);
      cv.ell(cx - h * 0.45 + lean, base - h * 0.44, cx - h * 0.39 + lean, base - h * 0.36, f.base);
      // 破布下摆
      for (const dx of [-0.12, 0.02, 0.14])
        cv.poly(
          [
            [cx + h * dx - 3, base - h * 0.34],
            [cx + h * dx + 3, base - h * 0.34],
            [cx + h * dx, base - h * (0.24 + Math.abs(dx) * 0.4)],
          ],
          f.base,
        );
      // 歪头 + 张开的嘴
      const hy = base - h * 0.8;
      cv.ell(cx - h * 0.12 + lean * 1.3, hy - h * 0.11, cx + h * 0.1 + lean * 1.3, hy + h * 0.1, f.base);
      cv.rect(cx - h * 0.06 + lean * 1.3, hy + h * 0.02, h * 0.09, 3, INK);
      return { tip: '前伸双臂' };
    },
  },
  {
    f: 'p4',
    name: '漂浮吸血鬼',
    draw(cv, cx, base, f) {
      const h = H_REF * 1.04;
      const lift = 9;
      const bb = base - lift;
      // 披风：腰以下张成宽三角（与摄魂怪的窄柱形成对照）
      cv.poly(
        [
          [cx - h * 0.13, bb - h * 0.64],
          [cx + h * 0.13, bb - h * 0.64],
          [cx + h * 0.33, bb - h * 0.02],
          [cx + h * 0.18, bb - h * 0.1],
          [cx + h * 0.04, bb],
          [cx - h * 0.1, bb - h * 0.06],
          [cx - h * 0.24, bb],
          [cx - h * 0.33, bb - h * 0.02],
        ],
        f.base,
      );
      // 披风的两个折痕（让三角不是一块死板）
      cv.line(cx - h * 0.1, bb - h * 0.56, cx - h * 0.26, bb - h * 0.04, f.lit, 1);
      cv.line(cx + h * 0.1, bb - h * 0.56, cx + h * 0.26, bb - h * 0.04, f.lit, 1);
      // 竖领：贴着肩向外翻，不要做成两根上挑的尖角（那会读成恶魔的角）
      for (const dir of [-1, 1])
        cv.poly(
          [
            [cx + dir * h * 0.06, bb - h * 0.8],
            [cx + dir * h * 0.3, bb - h * 0.86],
            [cx + dir * h * 0.28, bb - h * 0.66],
            [cx + dir * h * 0.1, bb - h * 0.64],
          ],
          f.lit,
        );
      // 头 + 尖发际 + 一只亮眼
      const hy = bb - h * 0.84;
      cv.ell(cx - h * 0.1, hy - h * 0.1, cx + h * 0.1, hy + h * 0.1, f.base);
      cv.poly([[cx - h * 0.1, hy - h * 0.04], [cx, hy - h * 0.19], [cx + h * 0.1, hy - h * 0.04]], INK);
      cv.rect(cx - h * 0.05, hy - 1, 3, 2, GOLD);
      // 前伸的手
      cv.line(cx - h * 0.12, bb - h * 0.62, cx - h * 0.36, bb - h * 0.54, f.base, 4);
      cv.ell(cx - h * 0.4, bb - h * 0.58, cx - h * 0.33, bb - h * 0.5, BONE);
      return { tip: '宽披风' };
    },
  },
  {
    f: 'p4',
    name: '牛头怪',
    draw(cv, cx, base, f) {
      const h = H_REF * 1.16;
      // 粗腿 + 蹄
      cv.rect(cx - h * 0.18, base - h * 0.36, h * 0.14, h * 0.34, f.base);
      cv.rect(cx + h * 0.04, base - h * 0.36, h * 0.14, h * 0.34, f.base);
      cv.rect(cx - h * 0.2, base - 4, h * 0.16, 4, INK);
      cv.rect(cx + h * 0.04, base - 4, h * 0.16, 4, INK);
      // 厚躯干
      cv.poly(
        [
          [cx - h * 0.28, base - h * 0.74],
          [cx + h * 0.28, base - h * 0.74],
          [cx + h * 0.22, base - h * 0.34],
          [cx - h * 0.22, base - h * 0.34],
        ],
        f.base,
      );
      // 牛头：宽脸 + 前突口鼻
      const hy = base - h * 0.82;
      const r = h * 0.13;
      cv.ell(cx - r * 1.2, hy - r * 1.1, cx + r * 1.1, hy + r * 1.1, f.base);
      cv.rect(cx - r * 1.35, hy + r * 0.15, r * 1.4, r * 0.85, f.base);
      cv.rect(cx - r * 1.2, hy + r * 0.45, r * 0.5, 2, INK);
      // 双角：锥形（用两条 4px 线叠会糊成一顶白假发）
      for (const dir of [-1, 1]) {
        const x0 = cx + dir * r * 0.55;
        const y0h = hy - r * 0.85;
        cv.poly(
          [
            [x0, y0h + r * 0.2],
            [x0 + dir * r * 1.35, y0h - r * 0.35],
            [x0 + dir * r * 1.55, y0h - r * 0.6],
            [x0 + dir * r * 0.75, y0h - r * 0.45],
          ],
          BONE,
        );
      }
      // 巨斧：斜扛过肩，刃在左肩上方（不是浮在右边）
      cv.line(cx + h * 0.26, base - h * 0.36, cx + h * 0.34, base - h * 1.08, GOLD, 3);
      const hx = cx + h * 0.34;
      const hy2 = base - h * 1.08;
      cv.poly(
        [
          [hx, hy2 + 3],
          [hx - h * 0.22, hy2 - h * 0.06],
          [hx - h * 0.28, hy2 + h * 0.1],
          [hx - h * 0.12, hy2 + h * 0.2],
          [hx, hy2 + h * 0.14],
        ],
        '#6f7681',
      );
      cv.poly(
        [
          [hx, hy2 + 3],
          [hx + h * 0.2, hy2 - h * 0.04],
          [hx + h * 0.24, hy2 + h * 0.12],
          [hx + h * 0.08, hy2 + h * 0.18],
          [hx, hy2 + h * 0.14],
        ],
        '#6f7681',
      );
      cv.line(hx - h * 0.25, hy2 - h * 0.03, hx - h * 0.26, hy2 + h * 0.14, STEEL_L, 1);
      // 腰间第二把斧（2026-10-28 拍板：牛头怪改成**掷斧**远程）。
      // 肩上那把斧已经在"举/扛"之间，单靠它分不出投掷还是劈砍；
      // "腰里还插着一把"才是投掷手的语法（备弹）。
      cv.line(cx - h * 0.3, base - h * 0.3, cx - h * 0.15, base - h * 0.58, GOLD, 2);
      cv.poly(
        [
          [cx - h * 0.15, base - h * 0.58],
          [cx - h * 0.27, base - h * 0.64],
          [cx - h * 0.3, base - h * 0.52],
          [cx - h * 0.17, base - h * 0.5],
        ],
        '#6f7681',
      );
      return { tip: '双角+肩上斧+腰间备斧' };
    },
  },
  {
    f: 'p4',
    name: '摄魂怪',
    draw(cv, cx, base, f) {
      const h = H_REF * 1.3;
      const lift = 12;
      const bb = base - lift;
      // 兜帽 + 宽肩 + 破碎下摆。
      // ⚠️ 一次改版记录（2026-10-28）：第一版是"等宽长锥 + 内部暗椭圆"，
      //    看的人第一反应是**火箭/子弹**（内部暗椭圆 = 舷窗）。
      //    幽灵的可读性全靠两处**轮廓台阶**：① 窄兜帽 vs 宽肩（0.17h → 0.40h）；
      //    ② 下摆不是齐边，是长短不一的破布。缺任何一处都会塌回"锥形物体"。
      cv.poly(
        [
          [cx - h * 0.03, bb - h * 1.16], // 帽尖（略前倾）
          [cx + h * 0.09, bb - h * 0.99], // 帽檐前沿
          [cx + h * 0.005, bb - h * 0.955], // 帽口内壁 ⇒ 缺口切开外轮廓
          [cx + h * 0.02, bb - h * 0.88], // 帽腔下缘
          [cx + h * 0.2, bb - h * 0.845], // 右肩（第一个台阶：0.17h → 0.40h）
          [cx + h * 0.17, bb - h * 0.62],
          [cx + h * 0.145, bb - h * 0.3],
          [cx + h * 0.1, bb - h * 0.12],
          [cx + h * 0.12, bb - h * 0.02], // 破布尖 1
          [cx + h * 0.04, bb - h * 0.08],
          [cx - h * 0.01, bb], // 破布尖 2（最长）
          [cx - h * 0.06, bb - h * 0.09],
          [cx - h * 0.11, bb - h * 0.05], // 破布尖 3
          [cx - h * 0.15, bb - h * 0.22],
          [cx - h * 0.185, bb - h * 0.62],
          [cx - h * 0.2, bb - h * 0.85], // 左肩
          [cx - h * 0.09, bb - h * 0.93], // 帽后
        ],
        f.base,
      );
      // 帽腔里的两点眼光：落在缺口里（背景上），"帽子里有东西"而不是舷窗
      cv.rect(cx + h * 0.035, bb - h * 0.925, 3, 2, f.trim);
      cv.rect(cx + h * 0.085, bb - h * 0.91, 3, 2, f.trim);
      // 下摆的雾丝：仍要有，但只 3 根、且不等长（等长=拖把）
      const wisps = [
        [-0.06, 0.1],
        [0.0, 0.16],
        [0.07, 0.08],
      ];
      for (const [dx, len] of wisps) cv.rect(cx + dx * h, bb - h * 0.02, 3, h * len, f.lit);
      // 左侧冷轮廓光
      cv.line(cx - h * 0.2, bb - h * 0.85, cx - h * 0.15, bb - h * 0.3, f.trim, 1);
      return { tip: '窄柱+无脸' };
    },
  },
];

/* ---------------- 画 ---------------- */
const cv = new Cv();
cv.rect(0, 0, W, H, '#171310');
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const x = LABEL_W + c * CELL;
    const y = HEAD_H + r * CELL;
    cv.rect(x + 1, y + 1, CELL - 2, CELL - 2, '#211b15');
    cv.rect(x + 10, y + CELL - 12, CELL - 20, 1, '#3a3026');
  }
}
for (let r = 0; r < ROWS; r++) text(cv, `P${r + 1}`, 8, HEAD_H + r * CELL + 10, '#8f8f8f', 3);

/** 单独画一遍求外接框（不含网格与序号），用来算 宽高比 */
const measure = (fn, f, cx, base) => {
  const t = new Cv();
  fn(t, cx, base, f);
  let x0 = 1e9;
  let x1 = -1e9;
  let y0 = 1e9;
  let y1 = -1e9;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (t.d[(y * W + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return x1 < x0 ? null : { w: (x1 - x0 + 1) / H_REF, h: (y1 - y0 + 1) / H_REF };
};

const rows = [];
for (let i = 0; i < UNITS.length; i++) {
  const r = Math.floor(i / COLS);
  const c = i % COLS;
  const x = LABEL_W + c * CELL;
  const y = HEAD_H + r * CELL;
  const cx = x + CELL / 2;
  const base = y + CELL - 12;
  const f = F[UNITS[i].f];
  const info = UNITS[i].draw(cv, cx, base, f);
  text(cv, String((i % COLS) + 1), x + 6, y + 6, '#d8d2c4', 2);
  const m = measure(UNITS[i].draw, f, cx, base);
  rows.push({ f: UNITS[i].f, name: UNITS[i].name, tip: info?.tip ?? '', ...m });
}

/* ---------------- 放大 + 写盘 ---------------- */
const out = new Uint8ClampedArray(W * Z * H * Z * 4);
const OW = W * Z;
for (let y = 0; y < H * Z; y++) {
  for (let x = 0; x < OW; x++) {
    const si = (Math.floor(y / Z) * W + Math.floor(x / Z)) * 4;
    const di = (y * OW + x) * 4;
    out[di] = cv.d[si];
    out[di + 1] = cv.d[si + 1];
    out[di + 2] = cv.d[si + 2];
    out[di + 3] = cv.d[si + 3];
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of body) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  const cb = Buffer.alloc(4);
  cb.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([len, body, cb]);
}

const raw = Buffer.alloc((OW * 4 + 1) * (H * Z));
let o = 0;
for (let y = 0; y < H * Z; y++) {
  raw[o++] = 0;
  for (let x = 0; x < OW; x++) {
    const i = (y * OW + x) * 4;
    raw[o++] = out[i];
    raw[o++] = out[i + 1];
    raw[o++] = out[i + 2];
    raw[o++] = out[i + 3];
  }
}
const ih = Buffer.alloc(13);
ih.writeUInt32BE(OW, 0);
ih.writeUInt32BE(H * Z, 4);
ih[8] = 8;
ih[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ih),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(OUT, { recursive: true });
const file = join(OUT, 'bodyplans-v2.png');
writeFileSync(file, png);
console.log('OK', file, `${OW}x${H * Z}`);

/* ---------------- 读数：外接框 + 同族两两最小差异 ---------------- */
console.log('\n族  兵            宽/身高  高/身高  最该看见的');
for (const r of rows)
  console.log(`${r.f}  ${r.name.padEnd(6, '　')}  ${r.w.toFixed(2)}     ${r.h.toFixed(2)}     ${r.tip}`);
console.log('\n同族两两"至少一维差 ≥18%"（R2）：');
for (const f of ['p1', 'p2', 'p3', 'p4']) {
  const g = rows.filter((r) => r.f === f);
  let worst = { d: 2, a: '', b: '' };
  for (let i = 0; i < g.length; i++)
    for (let j = i + 1; j < g.length; j++) {
      const dw = Math.abs(g[i].w - g[j].w) / Math.max(g[i].w, g[j].w);
      const dh = Math.abs(g[i].h - g[j].h) / Math.max(g[i].h, g[j].h);
      const d = Math.max(dw, dh);
      if (d < worst.d) worst = { d, a: g[i].name, b: g[j].name };
    }
  const flag = worst.d >= 0.18 ? 'PASS' : worst.d >= 0.12 ? 'WARN' : 'FAIL';
  console.log(`  ${f} 最差一对 ${worst.a}/${worst.b} = ${(worst.d * 100).toFixed(0)}%  ${flag}`);
}
