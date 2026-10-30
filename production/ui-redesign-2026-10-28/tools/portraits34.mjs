/**
 * portraits34.mjs — 兵牌头像生成器（统一 3/4 侧脸 · 按阵营分图集）
 *
 * 为什么不再从战场立绘裁：
 *   立绘是正面对称的（左右眼对称、身体对称），裁切 + 镜像都变不出 3/4 侧。
 *   所以头像单独一层画，战场立绘不动（不动 unitArt.ts，不碰 22 门回归闸）。
 *
 * 统一规则（全族共用，这是本批的"风格契约"）：
 *   1. 画布 56×56，面朝右 3/4（向屏幕右前方转约 35°）
 *   2. 光源左上：左上受光、右侧脸颊压一档
 *   3. 3/4 的三个硬线索：鼻尖伸出轮廓 / 远侧眼只露 2~3px 贴轮廓 / 下颌向右下收
 *   4. 轮廓 1px #241609，自动外描边
 *   5. **裁切框统一 50×50**（不是每张一个比例）——图集要求格子等大，
 *      但每张的**取景中心**按各自的 `keep` 自动算 ⇒ 风格统一、大小适中。
 *
 * 图集契约（2026-10-28 拍板 A：按阵营分图集）：
 *   - 4 列 × 2 行 = 8 格/族（T1~T5 占前 5 格，T6/T7 预留）
 *   - 单元格 200×200（源 50×50 @ Z=4），格间留 2px 护缝（防采样溢出）
 *   - 一族一张：atlas-p1 / atlas-p2 / atlas-p3 / atlas-p4 / atlas-neutral
 *   - 首屏只拉「本族 + neutral」两张，别族兵种见面时补拉
 *
 * `keep` = **不许被裁切**的矩形（头 + 标志性道具）。它是本管线唯一的机检尺子：
 *   keep 宽高 > 50 ⇒ 直接抛错（说明画得太大或裁切框该改），不静默切掉耳朵。
 *
 * 运行：node production/ui-redesign-2026-10-28/tools/portraits34.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'portraits34');

const S = 56; // 绘制画布
const CROP = 70; // 统一裁切边长（源 px）—— 由两条约束夹出来的唯一值，见下
const A_Z = 2; // 图集放大倍数 ⇒ 单元格 140（≈ CSS 37px 的 3.8 倍，够 DPR3）
const R_Z = 4; // 单张审阅图放大倍数 ⇒ 280
const COLS = 4;
const ROWS = 2;
const CAP = COLS * ROWS; // 8
const GUT = 2; // 护缝
const CELL = CROP * A_Z; // 140

/* 兵牌里的数量条：spec §1.3「collapsed 40×36 = 37×36 立绘 + 底部 12px 数量条」
 * ⇒ 牌面 y=25..36 被条压住，只有上 25px 可见。这是**硬遮挡**，构图必须让开。
 *   CROP 的取值就是这两条夹出来的：
 *     ① 头高 ≤ 68% of 牌高（spec §1.3）⇒ CROP ≥ keepH/0.68 ≈ 62
 *     ② 下巴必须落在数量条上方            ⇒ CROP ≥ keepH/(25/36) ≈ 69.1
 *   取 70（野猪 keep 48 是最高的一张）。 */
const CHIP_W = 37;
const CHIP_H = 36;
const BAR_TOP = 25; // 数量条上沿（牌内 y）

/* ---------- 基础工具 ---------- */
const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

class Cv {
  constructor() {
    this.d = new Uint8ClampedArray(S * S * 4);
    /** 整体纵向偏移：给「头顶要留光环」这类单位用（见 overangel）。 */
    this.ox = 0;
    this.oy = 0;
  }
  px(x, y, c, a = 1) {
    x = Math.round(x) + this.ox;
    y = Math.round(y) + this.oy;
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const [r, g, b] = hex(c);
    const i = (y * S + x) * 4;
    this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = Math.round(a * 255);
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
  }
  ell(x0, y0, x1, y1, c) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const rx = (x1 - x0) / 2 + 0.3, ry = (y1 - y0) / 2 + 0.3;
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++)
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.px(x, y, c);
      }
  }
  /** 椭圆环（1px）：光环比描边更细，且不实心。 */
  ring(x0, y0, x1, y1, c) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    for (let a = 0; a < 360; a += 2) {
      const r = (a * Math.PI) / 180;
      this.px(cx + rx * Math.cos(r), cy + ry * Math.sin(r), c);
    }
  }
  poly(pts, c) {
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const yc = y + 0.5, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc))
          xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2)
        for (let x = Math.round(xs[i]); x < Math.round(xs[i + 1]); x++) this.px(x, y, c);
    }
  }
  outline(ink = '#241609') {
    const snap = this.d.slice();
    const A = (x, y) => (x >= 0 && y >= 0 && x < S && y < S ? snap[(y * S + x) * 4 + 3] : 0);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        if (A(x, y) > 0) continue;
        if (A(x - 1, y) > 0 || A(x + 1, y) > 0 || A(x, y - 1) > 0 || A(x, y + 1) > 0)
          this.px(x - this.ox, y - this.oy, ink);
      }
  }
  bbox() {
    let x0 = S, y0 = S, x1 = -1, y1 = -1;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++)
        if (this.d[(y * S + x) * 4 + 3] > 8) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y);
          x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
    return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
}

/* ---------- 调色板 ---------- */
const P = {
  ink: '#241609',
  skin: '#E2AC74', skinL: '#F6CC9C', skinD: '#C08750', skinDD: '#96643A',
  white: '#E8EFF6', whiteD: '#B9C7D6', steel: '#96A6B6', steelD: '#6E7F90',
  gold: '#F2C14E', goldD: '#B9861E', goldL: '#FFE29A',
  blue: '#2F5686', blueL: '#3F76AE', blueH: '#63A0D6',
  orange: '#D1732F', orangeD: '#9C4B18', orangeL: '#E99448', orangeH: '#F7AE68',
  fur: '#8C8882', furL: '#B6B2AB', furD: '#5C5955', furEar: '#A87E72',
  boar: '#87676F', boarL: '#AC8D95', boarD: '#5A3D45', snout: '#A0707C',
  green: '#7C9C57', greenL: '#9DBC74', greenD: '#546F3D',
  ivory: '#F2E7CB', ivoryD: '#C6B48C',
  // 木器 / 灯火（提灯侍从、考勤表夹板用；取自游戏内 wood 族色阶，保持同族）
  wood: '#8A5F34', woodD: '#5F4022', woodL: '#A8703C',
  glow: '#FFD06A', glowL: '#FFF3C8', glowD: '#E09A2E',
};

/* ---------- 共用人脸部件（3/4 朝右）---------- */

/** 头骨：梨形，右侧（远）收窄，下巴偏右 */
function skullTop(cv, c) {
  cv.poly([[26, 4], [36, 6], [42, 12], [44, 21], [43, 29], [39, 36], [32, 41], [24, 42], [18, 39], [13, 34], [10, 26], [10, 16], [16, 7]], c);
}
/** 远侧（右）压暗 */
function skullShade(cv, c) {
  cv.poly([[38, 8], [43, 14], [44, 22], [43, 30], [39, 36], [34, 40], [37, 26], [37, 11]], c);
}
/** 近侧（左）高光 */
function skullLight(cv, c) { cv.ell(11, 19, 21, 33, c); }
/** 下颌阴影 */
function jawShade(cv, c) { cv.poly([[20, 34], [34, 32], [31, 41], [23, 40]], c); }

/** 近侧眼：白 5×4，瞳 2×4 偏右（看右前方） */
function eyeNear(cv, x, y, pupil = P.ink) {
  cv.rect(x, y, 5, 4, P.white);
  cv.rect(x + 3, y, 2, 4, pupil);
  cv.px(x + 1, y, P.ink);
  cv.px(x + 1, y + 3, P.ink);
  cv.px(x + 4, y + 1, pupil);
  cv.px(x, y + 3, '#B9C3CC');
}
/** 远侧眼：只露 2×3，贴右轮廓 */
function eyeFar(cv, x, y, pupil = P.ink) {
  cv.rect(x, y, 3, 3, P.white);
  cv.rect(x + 1, y, 2, 3, pupil);
}
function browNear(cv, x, y, c) { cv.poly([[x, y + 2], [x + 4, y], [x + 9, y + 1], [x + 9, y + 3], [x, y + 4]], c); }

/** 3/4 鼻：鼻梁斜下、鼻尖伸出轮廓 */
function nose(cv, skinL, skinDD, y = 20) {
  cv.poly([[26, y - 1], [33, y + 4], [36, y + 9], [36, y + 12], [26, y + 12]], skinL);
  cv.rect(26, y + 11, 10, 1, skinDD);
  cv.px(35, y + 9, skinDD);
  cv.px(36, y + 9, skinDD);
  cv.px(36, y + 10, skinDD);
  cv.px(30, y + 3, '#FFFFFF');
  cv.px(34, y + 11, skinDD);
  cv.px(25, y + 11, skinDD);
}
function mouth(cv, skinDD, skinD, x = 25, y = 33, w = 9) {
  cv.rect(x, y, w, 1, skinDD);
  cv.rect(x + 1, y + 1, w - 3, 1, skinD);
  cv.px(x + w - 1, y + 1, skinDD);
}

/** 人类胸像底 */
function humanBody(cv) {
  cv.ell(0, 44, 56, 66, P.blue);
  cv.ell(3, 43, 53, 62, P.blueL);
  cv.rect(10, 48, 36, 4, P.blueH);
  cv.ell(15, 38, 44, 52, P.steelD);
  cv.ell(17, 39, 42, 50, P.steel);
  cv.rect(23, 34, 12, 12, P.skinD);
}

/** p1 垂直母题：罩衫中缝白竖条（战场立绘同款，别改成一整片白） */
function p1Stripe(cv, y0 = 44) {
  cv.rect(24, y0, 7, 22, P.blueH);
  cv.rect(26, y0, 2, 22, P.white);
}

/** 人类共用五官组（3/4 朝右）
 *  布局（56 画布，脸 x=9..44）：
 *    近眼 11..16 / 鼻梁 18..24 / 远眼 26..29 / 右颊 30..44
 *  3/4 的三条判据：远眼窄且紧贴鼻梁、鼻梁有亮暗交界、右颊面积小于左颊。
 */
function humanFace(cv, o = {}) {
  const skin = o.skin || P.skin;
  const skinL = o.skinL || P.skinL;
  const skinD = o.skinD || P.skinD;
  const skinDD = o.skinDD || P.skinDD;

  skullTop(cv, skin);
  cv.poly([[32, 10], [43, 16], [44, 24], [43, 32], [39, 38], [34, 41], [35, 20]], skinD);
  cv.ell(11, 20, 21, 34, skinL);
  cv.poly([[18, 35], [33, 33], [30, 41], [21, 41]], skinD);

  cv.poly([[9, 18], [16, 16], [17, 19], [9, 21]], skinDD);
  cv.rect(12, 21, 4, 3, P.white);
  cv.rect(14, 21, 2, 3, P.ink);
  cv.px(15, 21, '#FFFFFF');

  cv.poly([[19, 22], [23, 26], [23, 31], [19, 31]], skinL);
  cv.rect(19, 30, 5, 1, skinDD);
  cv.px(24, 28, skinDD);
  cv.px(24, 29, skinDD);
  cv.px(20, 22, '#FFFFFF');

  cv.poly([[26, 17], [32, 16], [33, 19], [26, 20]], skinDD);
  cv.rect(26, 21, 3, 3, P.white);
  cv.rect(27, 21, 1, 3, P.ink);

  cv.rect(20, 35, 10, 1, skinDD);
  cv.rect(21, 36, 6, 1, skinD);
  cv.px(19, 35, skinD);
  cv.px(30, 35, skinD);

  if (o.stache) {
    cv.rect(19, 33, 12, 1, o.stache);
    cv.px(18, 33, o.stache);
    cv.px(31, 33, o.stache);
  }
  if (o.stubble) {
    for (let i = 0; i < 14; i++) cv.px(20 + ((i * 7) % 13), 37 + ((i * 5) % 4), '#B2794A');
  }
  if (o.tired) {
    // 加班脸：上眼睑压一层、眼下 1px 青灰；不靠"闭眼"表达疲惫（37px 上会读成没有眼睛）
    cv.rect(12, 20, 4, 1, skinDD);
    cv.rect(26, 20, 3, 1, skinDD);
    cv.rect(12, 25, 4, 1, '#B2794A');
    cv.rect(26, 25, 3, 1, '#B2794A');
  }
}

/* ---------- 头像 ---------- */

/** 01 提灯侍从 · 皮帽 + 白竖条罩衫 + 右下手提灯（唯一失调：灯比头亮） */
function lampbearer(cv) {
  cv.ell(0, 44, 56, 66, P.blue);
  cv.ell(3, 43, 53, 62, P.blueL);
  p1Stripe(cv);
  cv.ell(15, 38, 44, 52, P.steelD);
  cv.rect(23, 34, 12, 12, P.skinD);
  humanFace(cv);
  // 皮帽：贴颅、露额头；右侧压暗
  cv.ell(7, 0, 45, 17, P.woodD);
  cv.ell(9, 1, 42, 14, P.wood);
  cv.poly([[32, 0], [45, 5], [45, 16], [32, 17]], P.woodD);
  cv.rect(6, 13, 40, 3, P.wood);
  cv.rect(6, 16, 40, 2, P.woodD);
  cv.rect(12, 3, 8, 2, P.woodL);
  // 提灯：**必须落在脸轮廓右侧外**（x≥45）——压在右颊上会破坏 3/4 判据③（右颊面积）
  cv.rect(52, 34, 3, 12, P.wood); // 灯杆：只到肩线为止（过长在 37px 上=一条噪线）
  cv.rect(45, 20, 10, 2, P.woodD); // 灯顶
  cv.poly([[45, 22], [55, 22], [54, 34], [46, 34]], P.glowD);
  cv.poly([[47, 24], [53, 24], [52, 32], [48, 32]], P.glow);
  cv.rect(48, 25, 3, 6, P.glowL); // 灯芯
  cv.rect(45, 33, 10, 2, P.woodD); // 灯座
  cv.outline();
}

/** 02 号角弩手 · 橙兜帽 + 肩后箭羽 */
function hornxbow(cv) {
  cv.ell(0, 44, 56, 66, P.blue);
  cv.ell(3, 43, 53, 62, P.blueL);
  cv.rect(10, 48, 36, 4, P.blueH);
  cv.poly([[6, 60], [18, 44], [24, 44], [12, 60]], '#5E3A1E'); // 斜挎带
  cv.poly([[45, 58], [51, 38], [53, 39], [47, 58]], '#8A5A32'); // 肩后箭杆
  cv.poly([[50, 38], [53, 31], [55, 40]], P.ivory);
  cv.ell(15, 38, 44, 52, P.steelD);
  cv.rect(23, 34, 12, 12, P.skinD);
  humanFace(cv, { stubble: true });
  cv.ell(4, -2, 46, 19, P.orange);
  cv.ell(6, -1, 44, 17, P.orangeL);
  cv.poly([[31, -1], [46, 6], [46, 17], [31, 18]], P.orange);
  cv.rect(5, 13, 40, 3, P.orangeD);
  cv.rect(5, 16, 40, 2, '#78340F');
  cv.poly([[9, 6], [1, -1], [11, -2], [20, 4]], P.orangeD); // 帽尖向左后垂
  cv.rect(10, 2, 10, 2, P.orangeH);
  cv.px(34, 6, P.orangeH);
  cv.outline();
}

/** 03 铁誓枪兵 · 白桶盔 + 蓝罩袍 */
function oathpike(cv) {
  humanBody(cv);
  humanFace(cv);
  cv.ell(6, 0, 44, 20, P.white);
  cv.ell(8, 1, 42, 18, '#F4F8FC');
  cv.poly([[31, 1], [44, 7], [44, 18], [31, 19]], P.whiteD);
  cv.rect(6, 15, 38, 2, P.steel);
  cv.rect(6, 17, 38, 2, P.steelD);
  cv.rect(24, 0, 2, 13, P.steel); // 顶脊
  cv.rect(10, 2, 9, 2, '#FFFFFF');
  cv.px(11, 5, '#FFFFFF');
  cv.px(38, 8, P.steelD);
  cv.px(39, 9, P.steelD);
  // 长枪：竖立于右缘、枪尖到 y=4 —— T3 的**剪影出口**（在脸的右外侧，不压任何五官）
  cv.rect(48, 14, 3, 42, P.wood);
  cv.rect(48, 14, 1, 42, P.woodL);
  cv.poly([[47, 15], [49, 4], [51, 15]], P.steel);
  cv.poly([[48, 14], [49, 7], [50, 14]], '#DCE8F2');
  cv.rect(46, 15, 7, 2, P.steelD);
}

/** 04 圣殿骑士 · 开放式钢盔 + 金冠带 + 侧羽 */
function templar(cv) {
  humanBody(cv);
  humanFace(cv, { stache: '#8A5A2E', skin: '#D8A16A', skinD: '#B4793F' });
  cv.ell(6, 0, 44, 20, P.steel);
  cv.ell(8, 1, 42, 18, '#BFCDDA');
  cv.poly([[31, 0], [44, 7], [44, 18], [31, 19]], P.steel);
  cv.rect(6, 13, 38, 3, P.steelD);
  cv.rect(6, 16, 38, 2, '#5E6E7E');
  cv.rect(7, 9, 36, 3, P.gold); // 金冠带
  cv.rect(7, 12, 36, 1, P.goldD);
  cv.rect(7, 8, 36, 1, P.goldL);
  for (const gx of [12, 21, 30]) cv.rect(gx, 10, 1, 2, P.goldD);
  cv.poly([[42, 9], [49, 1], [51, 12], [46, 19]], '#8E3C2B'); // 侧羽
  cv.poly([[44, 10], [48, 4], [49, 11]], '#B4503A');
  cv.outline();
}

/** 05 加班天使 · 光环（悬空 1px 空气）+ 双翼 + 考勤表 + 加班脸 */
function overangel(cv) {
  // 光环：整只悬在头发上方、留 1px 空隙（战场立绘同款"唯一失调"）。
  // ⚠️ 不能画成"头后光环"——环的左右两端会被头发吃掉，只剩顶部一道金线，37px 上读不出。
  cv.ring(13, 0, 41, 7, P.gold);
  // 只在上左弧点 3px 高光：两圈整环在 37px 上会糊成一根金条（踩过）
  cv.px(17, 1, P.goldL); cv.px(18, 0, P.goldL); cv.px(19, 0, P.goldL);
  cv.oy = 5; // 整个人下移 5：y=0..7 让给光环，头发从 9 起 ⇒ 第 8 行留空
  // 长袍 + 竖条
  cv.ell(0, 44, 56, 66, P.blue);
  cv.ell(3, 43, 53, 62, P.blueL);
  p1Stripe(cv);
  // 近侧翼（3/4 只画近侧一只）：**必须分段羽片 + 羽缝**，
  // 整片白多边形在 37px 上会读成"一把白刀"（踩过）。
  // 只要**一块**受光面：整片纯白会和脸的受光同亮度，抢焦点（37px 上尤其明显）
  cv.poly([[16, 26], [2, 30], [6, 43], [17, 37]], P.whiteD); // 翼底
  cv.poly([[10, 30], [4, 34], [8, 41], [14, 38]], P.steel); // 暗羽缝
  cv.poly([[16, 27], [12, 31], [15, 37], [17, 35]], P.white); // 唯一受光羽片（贴肩）
  cv.ell(15, 38, 44, 52, P.steelD);
  cv.rect(23, 34, 12, 12, P.skinD);
  humanFace(cv, { tired: true });
  // 深色短发：只贴颅顶（**不许高过颅顶**，否则吃掉光环）
  cv.ell(8, 4, 44, 13, P.woodD);
  cv.ell(10, 4, 40, 11, P.wood);
  cv.poly([[31, 4], [46, 9], [46, 13], [31, 14]], P.woodD);
  // 考勤表：举在脸右侧外（x≥45），不压五官
  cv.rect(48, 20, 4, 2, P.woodD); // 夹子
  cv.poly([[45, 22], [55, 22], [55, 36], [45, 36]], P.ink);
  cv.poly([[46, 23], [54, 23], [54, 35], [46, 35]], P.wood);
  cv.poly([[47, 24], [53, 24], [53, 34], [47, 34]], P.ivory);
  cv.rect(48, 26, 4, 1, P.steelD);
  cv.rect(48, 28, 3, 1, P.steelD);
  cv.rect(48, 30, 4, 1, P.steelD);
  cv.px(48, 25, P.ink); // 打卡孔 ×2
  cv.px(52, 25, P.ink);
  cv.outline();
}

/** 06 野狼 · 3/4 侧，窄尖耳 + 长吻 */
function wolf(cv) {
  cv.ell(4, 38, 54, 60, P.furD);
  cv.ell(7, 37, 51, 54, P.fur);
  cv.poly([[8, 42], [16, 30], [24, 42]], P.furL);
  cv.poly([[32, 40], [40, 29], [46, 41]], P.fur);
  // 远侧耳（窄、压暗）——矮而宽，别画成兔耳
  cv.poly([[30, 4], [42, 8], [38, 20]], P.furD);
  cv.poly([[33, 7], [39, 9], [37, 16]], '#6E5A52');
  // 近侧耳
  cv.poly([[6, 10], [18, 2], [24, 19]], P.fur);
  cv.poly([[9, 11], [16, 6], [21, 17]], P.furEar);
  // 颅
  cv.ell(9, 11, 42, 44, P.fur);
  cv.ell(11, 14, 32, 40, P.furL);
  cv.poly([[33, 9], [43, 15], [42, 37], [36, 44], [33, 42]], P.fur);
  // 吻（朝右伸出）
  cv.poly([[33, 21], [47, 26], [47, 34], [33, 39]], P.furL);
  cv.poly([[33, 32], [47, 34], [33, 39]], P.fur);
  // 鼻头（大 + 高光）
  cv.ell(44, 24, 52, 33, P.ink);
  cv.px(46, 26, '#7A6A64');
  cv.px(47, 26, '#7A6A64');
  cv.px(45, 31, '#4A3C38');
  // 眼
  browNear(cv, 17, 20, P.furD);
  eyeNear(cv, 19, 22, '#1E1208');
  cv.px(20, 22, P.gold);
  eyeFar(cv, 33, 22, '#1E1208');
  // 嘴线 + 獠牙
  cv.rect(35, 32, 11, 1, P.furD);
  cv.poly([[37, 32], [40, 28], [41, 33]], P.ivory);
  cv.poly([[42, 33], [45, 29], [46, 33]], P.ivoryD);
  cv.outline();
}

/** 07 野猪 · 3/4 侧，鼻盘 + 近长远短双獠牙 */
function boar(cv) {
  cv.ell(2, 38, 54, 62, P.boarD);
  cv.ell(5, 36, 52, 56, P.boar);
  for (let i = 0; i < 6; i++) {
    const bx = 6 + i * 8;
    cv.poly([[bx, 40], [bx + 4, 30], [bx + 8, 40]], P.boarD);
  }
  cv.poly([[32, 5], [43, 11], [38, 22]], P.boarD); // 远侧耳
  cv.poly([[7, 8], [21, -1], [24, 19]], P.boar); // 近侧耳
  cv.poly([[10, 10], [19, 3], [21, 16]], '#9B727C');
  cv.ell(8, 11, 42, 46, P.boar);
  cv.ell(10, 14, 31, 41, P.boarL);
  cv.poly([[33, 9], [43, 16], [42, 38], [36, 46], [33, 44]], P.boar);
  cv.poly([[33, 24], [47, 28], [47, 40], [33, 43]], P.boarL); // 吻
  cv.poly([[33, 38], [47, 40], [33, 43]], P.boar);
  cv.ell(43, 27, 52, 39, P.snout); // 鼻盘（收到 52，别顶到裁切边）
  cv.ell(45, 29, 50, 37, '#7C4E58');
  cv.rect(46, 31, 2, 4, P.ink);
  cv.rect(49, 31, 1, 4, P.ink);
  browNear(cv, 14, 20, P.boarD);
  eyeNear(cv, 17, 24, '#241209');
  eyeFar(cv, 31, 24, '#241209');
  // 双獠牙（近长远短）
  cv.poly([[35, 43], [39, 31], [42, 43]], P.ivory);
  cv.poly([[43, 44], [46, 36], [48, 44]], P.ivory);
  cv.poly([[35, 43], [37, 38], [38, 43]], P.ivoryD);
  cv.outline();
}

/** 08 食人魔 · 3/4 侧，厚眉 + 下獠牙 */
function ogre(cv) {
  cv.ell(-4, 43, 60, 68, '#5E4222');
  cv.ell(-1, 41, 57, 62, '#8A6A3A');
  cv.rect(22, 36, 14, 12, P.greenD);
  cv.ell(6, 7, 44, 48, P.green);
  cv.ell(9, 11, 30, 40, P.greenL);
  cv.poly([[32, 8], [45, 15], [44, 38], [38, 48], [32, 47]], P.greenD);
  cv.poly([[8, 16], [43, 12], [44, 21], [8, 24]], P.greenD); // 厚眉骨
  cv.poly([[8, 16], [43, 12], [43, 16], [8, 20]], '#3F5730');
  cv.rect(13, 21, 5, 4, P.white);
  cv.rect(16, 21, 2, 4, '#2A1008');
  cv.px(14, 21, '#C4482C');
  cv.rect(32, 21, 3, 3, P.white);
  cv.rect(33, 21, 1, 3, '#2A1008');
  cv.poly([[34, 26], [46, 31], [46, 38], [34, 38]], P.greenL); // 扁鼻
  cv.rect(34, 37, 12, 1, P.greenD);
  cv.rect(37, 32, 1, 3, '#3E5530');
  cv.rect(43, 32, 1, 3, '#3E5530');
  cv.poly([[15, 40], [43, 37], [41, 45], [18, 46]], '#3A1D14'); // 阔嘴
  cv.rect(19, 43, 20, 2, '#6B2A22');
  cv.poly([[21, 46], [24, 35], [26, 45]], P.ivory);
  cv.poly([[34, 45], [37, 36], [39, 45]], P.ivory);
  cv.poly([[23, 46], [24, 40], [25, 45]], P.ivoryD);
  cv.poly([[42, 24], [49, 20], [48, 33], [42, 32]], P.greenD); // 耳
  cv.rect(17, 8, 9, 2, P.greenD); // 额疤
  cv.outline();
}

/* ---------- 升级形态（elite）----------
 * 升级**不是换一个人**，是「同一个战士被提拔」：
 *   脸 / 头型 / 颅骨比例**一律不动**（认得出是同一人），
 *   动的是三件事：① 剪影多一处 ≥4px 的凸起 ② 多一件能叫出名字的装备
 *                ③ 配色加深一档 + 一抹金/白高光。
 * 反例（禁止）：整体放大 10%、只换色相 —— 37px 上读不出差别，等于没升级。
 */

/** 提灯侍从 → 掌灯执事：金箍皮帽 + 左肩尖甲 + 灯升到过肩且灯芯纯白 + 罩衫金边 */
function lampbearerElite(cv) {
  // 袍：加深一档；竖条从白改金（唯一配色升级线索，37px 上仍能读出「换过料」）
  cv.ell(0, 44, 56, 66, '#28496F');
  cv.ell(3, 43, 53, 62, '#35638F');
  cv.rect(24, 44, 7, 22, P.blueH);
  cv.rect(25, 44, 2, 22, P.gold);
  // 左肩尖甲：**尖刺朝左上顶出 9px**（剪影判据）；只做「一块灰」在 37px 上读成围脖
  // 甲片**向外横向加宽**（不是竖着立一根尖刺——贴在脸旁边的银竖条会被读成匕首）
  cv.poly([[3, 39], [17, 33], [22, 43], [17, 50], [6, 51]], P.steelD);
  cv.poly([[0, 41], [3, 39], [6, 51], [2, 50]], P.steelD);   // 外缘再向外顶 4px
  cv.poly([[4, 41], [17, 35], [20, 42], [16, 47], [7, 47]], P.steel);
  cv.poly([[3, 40], [17, 33], [18, 36], [6, 43]], '#BCCBD8'); // 上沿受光
  cv.poly([[0, 41], [4, 39], [4, 44]], '#BCCBD8');
  cv.ell(15, 38, 44, 52, P.steelD);
  cv.rect(23, 34, 12, 12, P.skinD);
  humanFace(cv); // ← 脸不动：同一人
  // 帽：同形，帽檐改金箍（基础版是皮色）
  cv.ell(7, 0, 45, 17, P.woodD);
  cv.ell(9, 1, 42, 14, P.wood);
  cv.poly([[32, 0], [45, 5], [45, 16], [32, 17]], P.woodD);
  cv.rect(6, 13, 40, 3, P.gold);
  cv.rect(6, 16, 40, 2, P.woodD);
  cv.rect(24, 0, 3, 2, P.gold); // 帽顶铜钉（呼吸位，不碰光环那类悬空件）
  // 灯：整体上移 8px —— 灯顶(10)高过帽檐(13)，右缘剪影变高；灯芯纯白
  cv.rect(52, 24, 3, 24, P.wood);
  // 握把：袖口伸到灯杆下，否则整盏灯读成「浮在半空」
  cv.poly([[43, 46], [55, 44], [55, 53], [44, 54]], '#35638F');
  cv.rect(49, 45, 6, 4, P.skin);
  cv.rect(49, 48, 6, 1, P.skinD);
  cv.rect(45, 10, 10, 2, P.goldD);
  cv.poly([[45, 12], [55, 12], [54, 24], [46, 24]], P.glowD);
  cv.poly([[47, 14], [53, 14], [52, 22], [48, 22]], P.glow);
  cv.rect(48, 15, 3, 7, '#FFFFFF');
  cv.rect(45, 23, 10, 2, P.goldD);
  cv.outline();
}

/** 野狼 → 头狼：颈背竖鬃（剪影）+ 耳尖缺角 + 远颊伤疤 + 白胸毛 + 加长獠牙 */
function wolfElite(cv) {
  const Fur = '#6B6660', FurL = '#948E86', FurD = '#403D3A', Mane = '#2E2B29';
  // 竖鬃：先画，身体随后压住根部 ⇒ 左上方只留 4 根尖（剪影判据）
  cv.poly([[12, 44], [0, 33], [11, 36]], Mane);
  cv.poly([[10, 40], [0, 24], [12, 30]], FurD);
  cv.poly([[15, 36], [3, 17], [17, 27]], Mane);
  cv.poly([[21, 33], [12, 13], [24, 24]], FurD);
  // 身体（整体加深一档）
  cv.ell(4, 38, 54, 60, FurD);
  cv.ell(7, 37, 51, 54, Fur);
  // 白胸毛：低明度底上一块亮毛；**下沿锯齿**，平口会在 37px 上读成贴了张纸
  // 白毛领放在**外侧肩背**（左），不放吻下：右下会被数量条压暗、还会和獠牙的白糊成一块
  cv.poly([[9, 44], [22, 38], [30, 44], [27, 49], [21, 45], [15, 50], [11, 48]], '#C9C4BB');
  cv.poly([[11, 45], [21, 40], [27, 45], [22, 47], [16, 48]], '#E4E0D8');
  cv.poly([[8, 42], [16, 30], [24, 42]], FurL);
  cv.poly([[32, 40], [40, 29], [46, 41]], Fur);
  // 远侧耳
  cv.poly([[30, 4], [42, 8], [38, 20]], FurD);
  cv.poly([[33, 7], [39, 9], [37, 16]], '#5E4E48');
  // 近侧耳：**耳尖缺角**（三段折线做 V 口，不是贴一块暗色）
  cv.poly([[6, 10], [14, 3], [17, 7], [19, 3], [24, 19]], Fur);
  cv.poly([[9, 11], [15, 7], [18, 10], [21, 17]], P.furEar);
  // 颅
  cv.ell(9, 11, 42, 44, Fur);
  cv.ell(11, 14, 32, 40, FurL);
  cv.poly([[33, 9], [43, 15], [42, 37], [36, 44], [33, 42]], Fur);
  // 吻
  cv.poly([[33, 21], [47, 26], [47, 34], [33, 39]], FurL);
  cv.poly([[33, 32], [47, 34], [33, 39]], Fur);
  // 鼻头
  cv.ell(44, 24, 52, 33, P.ink);
  cv.px(46, 26, '#7A6A64');
  cv.px(47, 26, '#7A6A64');
  cv.px(45, 31, '#4A3C38');
  // 眼
  browNear(cv, 17, 20, FurD);
  eyeNear(cv, 19, 22, '#1E1208');
  cv.px(20, 22, P.goldL);
  eyeFar(cv, 33, 22, '#1E1208');
  // 远颊伤疤：斜 1px，跨过颧骨下沿（别压远眼，压了就成「瞎眼」）
  for (let i = 0; i < 11; i++) cv.px(35 + i * 0.55, 19 + i, '#C08E7C');
  // 嘴线 + 加长獠牙（基础版 28 起，升级到 25 起）
  cv.rect(35, 32, 11, 1, FurD);
  cv.poly([[36, 33], [39, 25], [42, 33]], P.ivory);
  cv.poly([[43, 33], [46, 27], [47, 33]], P.ivoryD);
  cv.outline();
}

/* ---------- 角色表 ----------
 *  faction: p1..p4 / neutral
 *  tier:    图集列序（T1..T5 占前 5 格）
 *  keep:    **不许被裁切**的矩形 [x0,y0,x1,y1]（含描边前的外扩 1px 余量）
 *           —— 裁切框由它自动算；它放不进 50×50 就直接报错。
 */
const ROLES = [
  { id: 'p1_lampbearer', name: '提灯侍从', faction: 'p1', tier: 1, draw: lampbearer, keep: [6, 0, 55, 40] },
  { id: 'p1_hornxbow', name: '号角弩手', faction: 'p1', tier: 2, draw: hornxbow, keep: [6, 0, 45, 42] },
  { id: 'p1_oathpike', name: '铁誓枪兵', faction: 'p1', tier: 3, draw: oathpike, keep: [6, 0, 52, 42] },
  { id: 'p1_templar', name: '圣殿骑士', faction: 'p1', tier: 4, draw: templar, keep: [6, 0, 45, 42] },
  { id: 'p1_overangel', name: '加班天使', faction: 'p1', tier: 5, draw: overangel, keep: [8, 0, 55, 47] },

  { id: 'wolf', name: '野狼', faction: 'neutral', tier: 1, draw: wolf, keep: [4, 2, 53, 46] },
  { id: 'boar', name: '野猪', faction: 'neutral', tier: 3, draw: boar, keep: [7, 0, 52, 47] },
  { id: 'ogre', name: '食人魔', faction: 'neutral', tier: 4, draw: ogre, keep: [6, 7, 50, 46] },
];

const FACTION_ORDER = ['p1', 'p2', 'p3', 'p4', 'neutral'];
const FACTION_NAME = { p1: '晨曦', p2: '赤焰', p3: '翠林', p4: '紫晶', neutral: '中立' };

/* ---------- 裁切框：从 keep 反解 ---------- */
function cropBox(r) {
  const [kx0, ky0, kx1, ky1] = r.keep;
  const kw = kx1 - kx0 + 1, kh = ky1 - ky0 + 1;
  if (kw > CROP || kh > CROP)
    throw new Error(
      `${r.id}: keep ${kw}×${kh} 放不进 ${CROP}×${CROP} —— 收小 drawing，或改 CROP（会改整族图集尺寸）`,
    );
  // ② 数量条：keep 下沿必须落在条上方，否则嘴/下巴被吃掉（旧批次就栽在这，见文件头）
  const chipBottom = ((ky1 + 1) * CHIP_H) / CROP;
  if (chipBottom >= BAR_TOP)
    throw new Error(
      `${r.id}: 下巴会落进数量条（牌内 y=${chipBottom.toFixed(1)} ≥ ${BAR_TOP}）` +
        ` —— keep 太高，或 CROP 太小；改 drawing 别改阈值`,
    );
  // ① 头高：按**可见带**（数量条以上那 25px）衡量，不是按整张牌。
  //    整张牌 36 里有 11 是条，按整牌算会把"刚好合适"误判成"太小"。
  const visH = (BAR_TOP * CROP) / CHIP_H; // 可见带对应的源 px 高度
  const fill = (kh / visH) * 100;
  // 上界给到 100%：keep 里可能含道具（光环/提灯），别拿含道具的高度去卡"头太大"
  if (fill < 74 || fill > 100)
    throw new Error(`${r.id}: 头高只占可见带的 ${fill.toFixed(0)}%，低于 74%（牌上会显小）`);

  // 纵向一律顶到画布顶（0）：所有 drawing 都把头顶画在 y≈0，顶对齐 = 可见面积最大
  const y0 = Math.min(0, ky0);
  // 横向：按 keep 居中，并夹住「keep 必须完整在里面」
  const lo = kx1 - CROP + 1, hi = kx0;
  if (lo > hi) throw new Error(`${r.id}: keep 与画布不兼容（可行区间为空）`);
  const x0 = Math.min(hi, Math.max(lo, Math.round((kx0 + kx1) / 2 - CROP / 2)));
  return { x0, y0 };
}

/* ---------- PNG 编码 ---------- */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (t, d) => {
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const b = Buffer.concat([Buffer.from(t, 'ascii'), d]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(b));
  return Buffer.concat([l, b, c]);
};
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[o++] = rgba[i]; raw[o++] = rgba[i + 1]; raw[o++] = rgba[i + 2]; raw[o++] = rgba[i + 3];
    }
  }
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ih), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 渲染单张 ---------- */
function render(r, Z) {
  const cv = new Cv();
  r.draw(cv);
  const { x0, y0 } = r.box;
  const W = CROP * Z;
  const out = new Uint8ClampedArray(W * W * 4);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const sx = x0 + Math.floor(x / Z), sy = y0 + Math.floor(y / Z);
      if (sx < 0 || sy < 0 || sx >= S || sy >= S) continue;
      const si = (sy * S + sx) * 4, di = (y * W + x) * 4;
      out[di] = cv.d[si]; out[di + 1] = cv.d[si + 1];
      out[di + 2] = cv.d[si + 2]; out[di + 3] = cv.d[si + 3];
    }
  return out;
}

/* ---------- 跑 ---------- */
mkdirSync(OUT, { recursive: true });

// 1) 校验 + 定框
const ids = new Set();
for (const r of ROLES) {
  if (ids.has(r.id)) throw new Error(`重复 id：${r.id}`);
  ids.add(r.id);
  if (!FACTION_ORDER.includes(r.faction)) throw new Error(`${r.id}: 未知阵营 ${r.faction}`);
  r.box = cropBox(r);
}
const groups = new Map();
for (const k of FACTION_ORDER) groups.set(k, []);
for (const r of ROLES) groups.get(r.faction).push(r);
for (const [k, list] of groups) {
  list.sort((a, b) => a.tier - b.tier);
  if (list.length > CAP) throw new Error(`${k}: ${list.length} 张 > 图集 ${CAP} 格`);
}

// 2) 逐张渲染 + 落审阅图（R_Z 倍）+ 打印牌内坐标
const rendered = new Map();
const review = new Map();
console.log(`CROP ${CROP}  CELL ${CELL} (A_Z=${A_Z})  GRID ${COLS}×${ROWS}  牌内可见 y<${BAR_TOP}\n`);
console.log('id'.padEnd(17) + 'crop'.padEnd(10) + 'head%'.padEnd(7) + '下巴@牌'.padEnd(9) + '裕量 L/R/T/B');
for (const r of ROLES) {
  const img = render(r, A_Z);
  rendered.set(r.id, img);
  writeFileSync(join(OUT, `${r.id}.png`), png(CROP * R_Z, CROP * R_Z, render(r, R_Z)));
  const [kx0, ky0, kx1, ky1] = r.keep;
  const { x0, y0 } = r.box;
  const m = [kx0 - x0, x0 + CROP - 1 - kx1, ky0 - y0, y0 + CROP - 1 - ky1];
  const headPct = (((ky1 - ky0 + 1) / CROP) * 100).toFixed(0);
  const chin = (((ky1 + 1) * CHIP_H) / CROP).toFixed(1);
  console.log(
    `${r.id.padEnd(17)}${`${x0},${y0}`.padEnd(10)}${`${headPct}%`.padEnd(7)}${chin.padEnd(9)}` +
      m.map((v) => String(v).padStart(2)).join('/'),
  );
}

// 3) 每族一张图集 + manifest
const manifest = {
  version: 1,
  note: '兵牌头像图集。首屏只加载「本族 + neutral」两张；别族兵种首次出现时补拉。',
  cell: CELL,
  crop: CROP,
  zoom: A_Z,
  cols: COLS,
  rows: ROWS,
  gutter: GUT,
  chip: { w: CHIP_W, h: CHIP_H, barTop: BAR_TOP },
  atlases: {},
  pending: [],
};

const atlasBuf = new Map();
for (const k of FACTION_ORDER) {
  const list = groups.get(k);
  if (!list.length) { manifest.pending.push(k); continue; }
  const W = COLS * CELL + (COLS - 1) * GUT;
  const H = ROWS * CELL + (ROWS - 1) * GUT;
  const buf = new Uint8ClampedArray(W * H * 4);
  const units = {};
  list.forEach((r, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const px0 = col * (CELL + GUT), py0 = row * (CELL + GUT);
    const img = rendered.get(r.id);
    for (let y = 0; y < CELL; y++)
      for (let x = 0; x < CELL; x++) {
        const si = (y * CELL + x) * 4, di = ((py0 + y) * W + (px0 + x)) * 4;
        buf[di] = img[si]; buf[di + 1] = img[si + 1];
        buf[di + 2] = img[si + 2]; buf[di + 3] = img[si + 3];
      }
    units[r.id] = { name: r.name, tier: r.tier, col, row, sx: px0, sy: py0, sw: CELL, sh: CELL };
  });
  const file = `atlas-${k}.png`;
  writeFileSync(join(OUT, file), png(W, H, buf));
  atlasBuf.set(k, buf);
  manifest.atlases[k] = { family: FACTION_NAME[k], file, w: W, h: H, used: list.length, cap: CAP, units };
  console.log(`\n${file.padEnd(18)} ${W}×${H}  ${list.length}/${CAP} 格  [${list.map((r) => r.name).join(' / ')}]`);
}

writeFileSync(join(OUT, 'atlas-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

/* ---------- 兵牌观感对照 ----------
 * 从**图集本身**按 manifest 坐标取样：贴图错位会立刻看出来。
 * 并且**画出数量条和侧条**——上一批的教训：预览不画遮挡物，等于没验。 */
const K = 4, PAD = 14, GAP = 12;
const rows = FACTION_ORDER.filter((k) => groups.get(k).length);
const SW = PAD * 2 + CAP * (CHIP_W * K + GAP) - GAP;
const SH = PAD * 2 + rows.length * (CHIP_H * K + GAP) - GAP;
const sheet = new Uint8ClampedArray(SW * SH * 4);
const put = (i, r, g, b) => { sheet[i] = r; sheet[i + 1] = g; sheet[i + 2] = b; sheet[i + 3] = 255; };
for (let i = 0; i < SW * SH; i++) put(i * 4, 26, 16, 8);

rows.forEach((k, ri) => {
  const list = groups.get(k);
  list.forEach((r, i) => {
    const u = manifest.atlases[k].units[r.id];
    const img = atlasBuf.get(k);
    const a = manifest.atlases[k];
    const ox = PAD + i * (CHIP_W * K + GAP), oy = PAD + ri * (CHIP_H * K + GAP);
    for (let y = 0; y < CHIP_H * K; y++)
      for (let x = 0; x < CHIP_W * K; x++) {
        const sx = u.sx + Math.min(CELL - 1, Math.floor((x / (CHIP_W * K)) * CELL));
        const sy = u.sy + Math.min(CELL - 1, Math.floor((y / (CHIP_H * K)) * CELL));
        const si = (sy * a.w + sx) * 4;
        let rr = img[si], gg = img[si + 1], bb = img[si + 2];
        const aa = img[si + 3];
        // 牌底（头像透出来的部分压到 26,16,8）
        let t = aa / 255;
        rr = rr * t + 26 * (1 - t); gg = gg * t + 16 * (1 - t); bb = bb * t + 8 * (1 - t);
        // 侧条 3px：rgba(255,255,255,0.12)
        if (x < 3 * K) { rr = rr * 0.88 + 255 * 0.12; gg = gg * 0.88 + 255 * 0.12; bb = bb * 0.88 + 255 * 0.12; }
        // 数量条 y=25..36：黑 60%
        if (y >= BAR_TOP * K) { rr *= 0.62; gg *= 0.62; bb *= 0.62; }
        put(((oy + y) * SW + (ox + x)) * 4, Math.round(rr), Math.round(gg), Math.round(bb));
      }
    // 数量条上沿 1px 亮线（spec §1.3 描边）
    for (let x = 0; x < CHIP_W * K; x++) {
      const di = ((oy + BAR_TOP * K) * SW + (ox + x)) * 4;
      const c = [150, 150, 150];
      put(di, c[0], c[1], c[2]);
    }
    // 数字占位：3 个色块示意（预览不排字，只验"字会不会压到脸"）
    for (let d = 0; d < 3; d++) {
      for (let y = 0; y < 6 * K; y++)
        for (let x = 0; x < 3 * K; x++)
          put(
            ((oy + (BAR_TOP + 3) * K + y) * SW + (ox + (13 + d * 5) * K + x)) * 4,
            236, 226, 200,
          );
    }
  });
});
writeFileSync(join(OUT, 'sheet-chips.png'), png(SW, SH, sheet));
console.log(`\nsheet-chips ${SW}×${SH} -> ${join(OUT, 'sheet-chips.png')}（每行一族，从左到右按 tier；已画侧条+数量条）`);
console.log(`manifest    -> ${join(OUT, 'atlas-manifest.json')}`);

/* ---------- 升级形态 A/B（本批只出两对，用于验证规则；全量待拍板） ---------- */
const ELITES = [
  { id: 'p1_lampbearer_elite', name: '掌灯执事', base: 'p1_lampbearer', draw: lampbearerElite, keep: [3, 0, 55, 40] },
  { id: 'wolf_elite', name: '头狼', base: 'wolf', draw: wolfElite, keep: [0, 2, 53, 46] },
];

for (const e of ELITES) {
  e.box = cropBox(e);
  writeFileSync(join(OUT, `${e.id}.png`), png(CROP * R_Z, CROP * R_Z, render(e, R_Z)));
  const [kx0, ky0, kx1, ky1] = e.keep;
  const { x0, y0 } = e.box;
  const m = [kx0 - x0, x0 + CROP - 1 - kx1, ky0 - y0, y0 + CROP - 1 - ky1];
  const chin = (((ky1 + 1) * CHIP_H) / CROP).toFixed(1);
  console.log(
    `elite ${e.id.padEnd(22)} crop=${x0},${y0}  下巴@牌=${chin}  裕量 L/R/T/B ` +
      m.map((v) => String(v).padStart(2)).join('/'),
  );
}

/* A/B 对照条：左基础 / 右升级，同一裁切带，方便肉眼比对剪影差 */
{
  const K = 4, GAP = 10, PAD = 10;
  const CW = CROP * K;
  const SW = PAD * 2 + CW * 2 + GAP;
  const SH = PAD * 2 + ELITES.length * (CW + GAP) - GAP;
  const sheet2 = new Uint8ClampedArray(SW * SH * 4);
  for (let i = 0; i < SW * SH; i++) {
    sheet2[i * 4] = 26; sheet2[i * 4 + 1] = 16; sheet2[i * 4 + 2] = 8; sheet2[i * 4 + 3] = 255;
  }
  ELITES.forEach((e, ri) => {
    const baseRole = ROLES.find((r) => r.id === e.base);
    const pair = [render(baseRole, K), render(e, K)];
    pair.forEach((img, ci) => {
      const ox = PAD + ci * (CW + GAP), oy = PAD + ri * (CW + GAP);
      for (let y = 0; y < CW; y++)
        for (let x = 0; x < CW; x++) {
          const si = (y * CW + x) * 4;
          if (img[si + 3] < 8) continue;
          const di = ((oy + y) * SW + (ox + x)) * 4;
          const a = img[si + 3] / 255;
          sheet2[di] = Math.round(img[si] * a + 26 * (1 - a));
          sheet2[di + 1] = Math.round(img[si + 1] * a + 16 * (1 - a));
          sheet2[di + 2] = Math.round(img[si + 2] * a + 8 * (1 - a));
          sheet2[di + 3] = 255;
        }
    });
  });
  writeFileSync(join(OUT, 'sheet-elite.png'), png(SW, SH, sheet2));
  console.log(`sheet-elite ${SW}×${SH}（每行一对：左=基础，右=升级）`);
}

/* 37px 真实牌面 A/B：按兵牌的实际采样方式（70→37×36 最近邻）重采样，
 * 再 ×6 放大给人看。这一步是判据本身——2× 好看不代表 37px 读得出。 */
{
  const K = 6, GAP = 8, PAD = 8;
  const CW = CHIP_W * K, CH = CHIP_H * K;
  const SW = PAD * 2 + CW * 2 + GAP;
  const SH = PAD * 2 + ELITES.length * (CH + GAP) - GAP;
  const buf = new Uint8ClampedArray(SW * SH * 4);
  for (let i = 0; i < SW * SH; i++) {
    buf[i * 4] = 26; buf[i * 4 + 1] = 16; buf[i * 4 + 2] = 8; buf[i * 4 + 3] = 255;
  }
  ELITES.forEach((e, ri) => {
    const baseRole = ROLES.find((r) => r.id === e.base);
    [baseRole, e].forEach((role, ci) => {
      const img = render(role, 1); // CROP×CROP 源，逐像素最近邻取到 37×36
      const ox = PAD + ci * (CW + GAP), oy = PAD + ri * (CH + GAP);
      for (let y = 0; y < CH; y++)
        for (let x = 0; x < CW; x++) {
          const sx = Math.min(CROP - 1, Math.floor((x / CW) * CROP));
          const sy = Math.min(CROP - 1, Math.floor((y / CH) * CROP));
          const si = (sy * CROP + sx) * 4;
          if (img[si + 3] < 8) continue;
          const a = img[si + 3] / 255;
          let rr = img[si] * a + 26 * (1 - a), gg = img[si + 1] * a + 16 * (1 - a), bb = img[si + 2] * a + 8 * (1 - a);
          if (y >= BAR_TOP * K) { rr *= 0.62; gg *= 0.62; bb *= 0.62; }
          const di = ((oy + y) * SW + (ox + x)) * 4;
          buf[di] = Math.round(rr); buf[di + 1] = Math.round(gg); buf[di + 2] = Math.round(bb); buf[di + 3] = 255;
        }
    });
  });
  writeFileSync(join(OUT, 'sheet-elite-chip.png'), png(SW, SH, buf));
  console.log(`sheet-elite-chip ${SW}×${SH}（37×36 真实牌面 ×6；左基础/右升级）`);
}
