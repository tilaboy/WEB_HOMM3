/**
 * 兵种**体形档**（§15.2 R1–R5 / §16.1 新阵容）· p1 晨曦第一批
 * ==========================================================================
 *
 * 为什么另起一个文件，而不是继续往 `unitArt.ts` 里堆 `drawXxx`：
 *
 *   `unitArt.ts` 里那 20 个 `drawXxx` 是按 **T1→T5 体量阶梯**（asset-spec §5.6.2
 *   的 62/70/78/88/100%）设计的 —— 那个阶梯假设「T5 一定比 T4 高」。新体形档
 *   明确**推翻**了这条：p1 的 T3 鹰（h=1.22）比 T4 骑士（h=1.04）高，因为骑士
 *   要占的是**宽体**档（`w ≥ 1.35h`）而不是「更高」档。两套判据不能塞进同一个
 *   函数里，否则读代码的人永远分不清某个数字是给哪套尺子用的。
 *
 *   所以这里**只写新体形**：一兵一函数、坐标全部用 `h`（该兵自己的剪影高）的
 *   比例表达 —— 也就是 `production/ui-redesign-2026-10-28/tools/bodyplans.mjs`
 *   那张定稿图里已经量过一遍的几何。换画布尺寸时只换 `u`（1 个 H_REF 单位 =
 *   多少像素），形状一个字都不用动。
 *
 * **H_REF 的唯一定义**：`bodyplans-v2.png` 里的 80px 基准 = T3 标准身高。
 * 本模块把「h」记成 **H_REF 的倍数**（小孩 0.65 / 天使 1.54 ……），
 * `BODY_PLAN_H_REF_PX = 36` 是它落到 64×56 战斗画布上的换算率 ——
 * 1.54 × 36 = 55.4 ≈ 画布高 56 ⇒ 天使占满，其余按比例。
 *
 * ⚠️ 体形档 ≠ tier，也 ≠ 能不能飞（§16.1 的警告）：
 *   鹰 `canFly = true` 却走**高**档，摄魂怪/吸血鬼同理；`canFly` 是战斗字段。
 */

import { PixBuf } from './pixel.js';

/* ==========================================================================
 * 1. 体形档表（§15.2 R1 的五档 + §15.2 的分配表）
 * ========================================================================== */

/** R1 的五档。判定**有优先级**：巨物 → 宽体 → 矮 → 中 → 高（见 `classify`）。 */
export type BodyClass = 'short' | 'mid' | 'tall' | 'wide' | 'huge';

export interface BodyPlan {
  cls: BodyClass;
  /** 剪影高，单位 = H_REF（bodyplans-v2 的 80px 基准 = T3 标准身高）。 */
  h: number;
  /** 档位特征（兵牌 R5 要认的那一处），只作人读的备注。 */
  tip: string;
}

/**
 * 已按新体形重画的兵种。**门控按这张表分regime**：
 *   · 在表里 ⇒ 由 `audit:bodyplan` 的 R1/R2/R5 判；
 *   · 不在表里 ⇒ 仍由 `b0audit` 的 H1/H2/S1（旧体量阶梯）判。
 * 两个 regime 必须**恰好覆盖**全部兵种 —— 覆盖断言在 `audit:bodyplan` 的 [0b]
 * （那边同时有 `BODY_PLAN` 与 `FACTION_UNITS` 两侧，`b0audit` 只有后者）。
 */
export const BODY_PLAN: Record<string, BodyPlan> = {
  // ── p1 晨曦（S3a，2026-11-06）─────────────────────────────────────
  // 矮：h ≤ 0.68 —— 大头小身子，全表最矮的人形
  p1_child: { cls: 'short', h: 0.65, tip: '大头' },
  // 中：0.84 ~ 1.00 —— 正常身高，横弩给出方向
  p1_crossbow: { cls: 'mid', h: 0.88, tip: '横弩' },
  // 高：h ≥ 1.18 —— **收翼立姿 + 长距后腿**（不是平展翼！见 §16.1 的警告）
  p1_eagle: { cls: 'tall', h: 1.22, tip: '收翼+长腿' },
  // 宽体：w ≥ 1.35h —— 四条腿 + 长枪，宽度换高度
  p1_knight: { cls: 'wide', h: 1.04, tip: '四腿+长枪' },
  // 巨物·飞行：h ≥ 1.45 —— 光环 + 上掠翼，占满画布
  p1_angel: { cls: 'huge', h: 1.54, tip: '光环+上掠翼' },

  // ── p2 赤焰（S3b，2026-11-06）─────────────────────────────────────
  // 矮：h ≤ 0.68 —— 细棍四肢 + 大头 + 头顶火苗（同档与 p1 小孩靠"细 vs 短袍"分开）
  p2_matchman: { cls: 'short', h: 0.64, tip: '火柴+火苗' },
  // 中：0.84 ~ 1.00 —— 方头方肩的铜制构装，glow 眼
  p2_bronze: { cls: 'mid', h: 0.88, tip: '方肩+铆钉' },
  // 高：h ≥ 1.18 —— 厚肩长臂、宽度 < 1.35h（宽体档归三头狼）
  p2_lavagiant: { cls: 'tall', h: 1.22, tip: '厚肩+熔岩缝' },
  // 宽体：w ≥ 1.35h —— 四足长身 + 三个错落的头
  p2_threewolf: { cls: 'wide', h: 0.95, tip: '四足+三头' },
  // 巨物·飞行：h ≥ 1.45 —— **下掠**翼 + 双角 + 尾（与天使上掠成镜像）
  p2_devil: { cls: 'huge', h: 1.5, tip: '下掠翼+双角' },
};

/** 已重画的族前缀。S3b/S3c 每落一族就往里加一个（不要按兵种逐个加）。 */
export const BODY_PLAN_FAMILIES = new Set(['p1', 'p2']);

/** 该 unit 是否走新体形档 regime。 */
export function hasBodyPlan(unit: string): boolean {
  return BODY_PLAN[unit] !== undefined;
}

/**
 * R1 的档位判定 —— **顺序就是优先级**，不要按 `if/else` 的书写顺序随便排：
 *   天使 h=1.54 同时也满足「高 ≥1.18」，若先判「高」它就会被判成高；
 *   骑士 h=1.04 落在 1.00~1.18 的空隙里，只能靠宽度归到宽体。
 *
 * ⚠️ `w ≥ 1.5h` 那一条**只对会飞的成立**（§15.2 的原话是「翼展」）。
 *    骑士的马+长枪也宽到 1.54h，若不看 `canFly` 就会被误判成「巨物·飞行」，
 *    于是 p1 的宽体档空掉、两档并成一档 —— 这正是「档位独占」要防的事。
 *
 * 判不出来（落在 1.00~1.18 的空隙且不够宽）时返回 `null`：**不许默认归到最近的档**，
 * 那会让一个画坏了的剪影静默通过。
 */
export function classify(wPerH: number, hPerH: number, canFly = false): BodyClass | null {
  if (hPerH >= 1.45 || (canFly && wPerH >= 1.5)) return 'huge';
  if (wPerH >= 1.35) return 'wide';
  if (hPerH <= 0.68) return 'short';
  if (hPerH >= 0.84 && hPerH <= 1.0) return 'mid';
  if (hPerH >= 1.18) return 'tall';
  return null; // 落在档与档之间的空隙 ⇒ 既不属于任何档，也不许蒙混过关
}

/** 1 个 H_REF 单位在 **64×56 战斗画布**上的像素数（56 ÷ 1.54 ≈ 36.36 → 天使刚好触顶）。
 *  ⚠️ 只作**文档常量**：绘制与审计都用 `画布高 ÷ H_REF_HUGE` 现算（map 画布是 44 高，
 *  写死 36 会让天使画出 55px 再被裁）。 */
export const BODY_PLAN_H_REF_PX = 36;

/**
 * 「占满画布」的那一档 = 巨物（天使 1.54）。**这是体形档的换算基准**：
 * 每张画布上 `1 H_REF = 画布高 ÷ 1.54`，于是天使永远触顶、其余按 h 等比例落位。
 *
 * 为什么不直接写 36：map 画布只有 44 高，用 36 会把天使画成 55px 再被裁掉。
 * 写成一个比例，两套画布（52×44 / 64×56）共用同一份换算，不会各写一份魔数。
 */
export const H_REF_HUGE = 1.54;

/* ==========================================================================
 * 2. 色板（p1 晨曦：蓝白 + 钢 + 金；与 B0_PALETTE 的 p1 族同源）
 * ========================================================================== */

/**
 * ⚠️ **每一个值都必须是 `B0_PALETTE` 里的字面 hex**（asset-spec §3.4 第 1 条：
 * 「颜色 100% 取用字面色板，不使用 shade()/mix() 现场造色」）。
 *
 * 第一版这里自己造了 18 个色（#2f5686 / #f2c14e / #e8bd92 …），比色板「好看」，
 * 但 `audit:b0` 的断言 2 逐帧查归属 ⇒ 15 帧全红，而且那正是规格要禁的事。
 * 现在改成**按材质族取三档**（每族只有 0/2/4 三个档位，天然满足「同族相邻差 ≥2 档」）：
 *
 *   布 · p1accent  #22559e(0) / #3f8fe8(2)   —— 第三档 #8ecdf8(79.7) 与肤/钢/金同档，本批不用
 *   白 · p1wall    #b3a894(0) / #eae3d2(2)            —— 天使袍、孩子内衬
 *   钢 · metal     #6b7686(0) / #aab6c2(2) / #dfe6f0(4) —— 头盔、剑、箭
 *   金 · canvas    #b9a06a(2) / #e8d9a8(4)            —— 腰带、弩臂、光环
 *   褐 · wood      #5f4022(0) / #8a5f34(2) / #a8703c(4) —— 皮革、马鬃、鹰羽
 *   肤 · skin      #d8a878(2) / #f0c79a(4)
 *   深 · ink0      #2a1a12                             —— 眼睛（描边也是它）
 *
 * 少了「中间调」的观感损失是**故意的**：这是 22px 的像素精灵，第三档在缩到 43×37
 * 之后常常只剩 1px 宽，反而会读成脏边。
 */
const P = {
  cloth: '#3f8fe8', // p1accent 2 —— 主体袍色
  clothDark: '#22559e', // p1accent 0 —— 裤 / 袍下摆暗部
  trim: '#aab6c2', // metal 2 —— 箭羽（浅档会与金/白撞）
  trimDark: '#aab6c2', // metal 2
  steel: '#aab6c2', // metal 2 —— 头盔主色
  steelLite: '#dfe6f0', // metal 4
  steelDark: '#6b7686', // metal 0 —— 护鼻、剑脊
  goldDark: '#b9a06a', // canvas 2
  skin: '#d8a878', // skin 2 —— 脸与手（**中档**：上邻白袍/浅金时仍差 15~18）
  hair: '#5f4022', // wood 0
  leather: '#8a5f34', // wood 2 —— 枪杆 / 箭袋
  leatherDark: '#5f4022', // wood 0 —— 靴 / 弩托
  // 鹰：暖褐羽 + 米白腹 + 黄喙
  feather: '#8a5f34', // wood 2
  featherLite: '#a8703c', // wood 4
  featherDark: '#5f4022', // wood 0
  belly: '#e8d9a8', // canvas 4
  beak: '#ffb020', // p1clash —— 唯一的高饱和色，只给喙
  // 天使：白袍 + 淡金
  white: '#eae3d2', // p1wall 2
  whiteMid: '#b3a894', // p1wall 0 —— 远翼 / 袍右暗面（**同族**，与白袍只差一档，断言 8 跳过）
  whiteDark: '#6b7686', // metal 0
  ink: '#2a1a12', // ink0
  hi: '#ffffff', // hi0 —— **只给眼睛右上角那一格**（§1.4 唯一高光）
} as const;

/**
 * p2 赤焰（S3b）：红布 + 棕皮 + 铜 + 熔岩。
 *
 * 同样**只用 `B0_PALETTE` 的字面值**（理由见上面 P 的注释）；族的主题色是
 * `p2accent`（红三档）、`p2wall`（棕两档）、`p2emissive`（发光黄）、`p2clash`（青绿）。
 * 铜人不借 p2accent 而借 `canvas` 族：p2 的红是"兽皮"，铜人必须是"金属"，
 * 否则它与熔岩巨人、恶魔在 22px 下是同一团红。
 */
const P2 = {
  red: '#e04a34', // p2accent 2
  redDark: '#9a2519', // p2accent 0
  redLite: '#f79a7a', // p2accent 4
  wall: '#c98a4e', // p2wall 2 —— 毛皮 / 皮革
  wallDark: '#8a5a30', // p2wall 0
  glow: '#ffd06a', // p2emissive —— 铜人的眼、熔岩裂缝
  clash: '#2fbfa0', // p2clash —— 只给恶魔的舌尖 / 三头狼的颈环（小面积高饱和）
  bronze: '#b9a06a', // canvas 2 —— 铜人主体
  bronzeLite: '#e8d9a8', // canvas 4 —— 铜人的高光面
  stoneDark: '#6f6858', // stone 0 —— 熔岩巨人的嘴线 / 岩缝
  metal0: '#6b7686',
  metal2: '#aab6c2',
  metal4: '#dfe6f0',
  wood0: '#5f4022',
  // 火柴人的细肢 / 铜人的暗面：必须比 `wallDark(#8a5a30)` 再暗一档。
  // 断言 8 实测：wallDark ↔ p2accent2 只差 ΔL 10.3（ΔH 20° 需 ≥12），
  // 而 wood0 与红差 18.7 —— 同样是"暗"，但跨过了门槛。
  limb: '#5f4022',
  skin: '#d8a878',
  ink: '#2a1a12',
  hi: '#ffffff',
} as const;

/**
 * 熔岩巨人的发光眼 + 石色嘴线。
 *
 * 它走 `audit:expr` 的 **glow** 通道（构装/巨人类可以没有 hi0）：眼是 2×2 **同色**
 * `#ffd06a`，嘴是 1px 高的 `stone0` 短横线。这与旧 `cu_p2_lavatroll` 同一条理由，
 * 只是体量从"巨魔"变成"巨人"。
 */
function glowFace(pb: PixBuf, lx: number, ey: number, gap: number, x0: number, mouthW: number, mouthDy: number): void {
  R(pb, lx, ey, 2, 2, P2.glow);
  R(pb, lx + 2 + gap, ey, 2, 2, P2.glow);
  if (mouthW > 0) R(pb, x0, ey + mouthDy, Math.max(3, Math.round(mouthW)), 1, P2.stoneDark);
}

/* ==========================================================================
 * 3. 绘制基元（PixBuf 只有 1px 线，粗线在这里补齐）
 * ========================================================================== */

/**
 * 取整矩形 —— **必须走这里，不要直接 `pb.rect()`**。
 *
 * `PixBuf.set()` 不取整：它用 `inBounds()` 判断（float 能过），随后算出的
 * `index = (y*w + x)*4` 是小数 ⇒ 写进 TypedArray 时被静默丢弃（不报错、不留痕）。
 * 本模块的坐标全是 `h` 的比例表达式，几乎每一个都是小数 —— 直接 `pb.rect()`
 * 的后果是「腿、手臂、腰带全部消失，只剩多边形和椭圆」（2026-11-06 实测）。
 * `poly()` / `ellipse()` 内部自己有 `Math.round`，所以只有矩形要包这一层。
 */
function R(pb: PixBuf, x: number, y: number, w: number, h: number, c: string, a = 1): void {
  pb.rect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), c, a);
}

/** 粗线：沿线段铺 `t×t` 的方砖（不插值，保持像素硬边）。 */
function tl(pb: PixBuf, x0: number, y0: number, x1: number, y1: number, c: string, t = 1): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
  const h = (t - 1) / 2;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    R(pb, Math.round(x - h), Math.round(y - h), t, t, c);
  }
}

/** 以包围盒写椭圆（bodyplans.mjs 的 `ell` 口径，便于逐行对照那张定稿图）。 */
function ell(pb: PixBuf, x0: number, y0: number, x1: number, y1: number, c: string, a = 1): void {
  pb.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, c, a);
}

/* ==========================================================================
 * 3b. 脸 —— 逐像素照 `audit:expr` 的签名画，不是"差不多像张脸"
 * ========================================================================== */

/**
 * §4 H3 表情。与 `unitArt.ts` 的 `face()` 同构，但**这里的坐标由调用方算**，
 * 因为五个兵的脑袋尺寸差一倍，写死 `lx+1` 会在小孩上把嘴画到耳朵外。
 *
 * `audit:expr` 的 ink 签名是逐像素认的：
 *   眼 = (x,y) ink0 ∧ (x+1,y) **hi0** ∧ (x,y+1) ink0 ∧ (x+1,y+1) ink0
 *   嘴 = 1~2px 高、3~14 宽的 ink0 净段，左右都被非墨包住，起点落在左眼下方
 * ⇒ 一、必须 2×2（1px 点凑不出这个窗口，S3a 首版五张全红就是这个原因）；
 *    二、高光必须正好在 2×2 的**右上格**，居中或左上都不认。
 *
 * @param lx      左眼方块左上角 x（整数）
 * @param ey      眼睛上排 y（整数）
 * @param gap     两眼之间的**净空**（1..8；判据上限 8）
 * @param mouthW  嘴线宽（夹到 3..12 —— 再宽就成甲沿了，判据会拒）
 * @param mouthDy 嘴在眼下第几行（2..8）
 */
function h3Face(pb: PixBuf, lx: number, ey: number, gap: number, mouthW: number, mouthDy: number): void {
  const rx = lx + 2 + gap;
  R(pb, lx, ey, 2, 2, P.ink);
  R(pb, rx, ey, 2, 2, P.ink);
  pb.set(lx + 1, ey, P.hi);
  pb.set(rx + 1, ey, P.hi);
  const mw = Math.max(3, Math.min(12, Math.round(mouthW)));
  R(pb, lx + 1, ey + mouthDy, mw, 1, P.ink);
}

/** 侧脸（兽形）：一只 2×2 眼，**没有独立嘴线** —— `audit:expr` 的 profile 通道。 */
function profileEye(pb: PixBuf, x: number, y: number): void {
  R(pb, x, y, 2, 2, P.ink);
  pb.set(x + 1, y, P.hi);
}


/* ==========================================================================
 * 4. p1 五兵
 * ========================================================================== */

/** 小孩 · 矮档 · 大头小身子。脚在 base，头顶在 base − h。 */
function drawChild(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean): void {
  const hr = h * 0.18; // 半径 0.18h ⇒ 头占身高 36%（全表最大）
  const headTop = base - h;
  const headCy = headTop + hr;
  // 腿：**两根之间留 2px 缝**（不留缝就与下摆连成一块蓝砖）
  const legW = Math.max(2, Math.round(h * 0.09));
  const legX = Math.max(2, Math.round(h * 0.1));
  R(pb, cx - legX - legW, base - h * 0.26, legW, h * 0.26, P.leather);
  R(pb, cx + legX, base - h * 0.26, legW, h * 0.26, P.leather);
  // 鞋
  R(pb, cx - legX - legW - 1, base - Math.max(1, h * 0.05), legW + 2, Math.max(1, h * 0.05), P.ink);
  R(pb, cx + legX - 1, base - Math.max(1, h * 0.05), legW + 2, Math.max(1, h * 0.05), P.ink);
  // 短袍（上宽下窄，下摆高于膝盖）
  pb.poly(
    [
      [cx - h * 0.19, base - h * 0.62],
      [cx + h * 0.19, base - h * 0.62],
      [cx + h * 0.15, base - h * 0.24],
      [cx - h * 0.15, base - h * 0.24],
    ],
    P.cloth,
  );
  R(pb, cx - h * 0.17, base - h * 0.6, Math.max(1, h * 0.03), h * 0.32, P.clothDark);
  // 腰带
  R(pb, cx - h * 0.17, base - h * 0.36, h * 0.34, Math.max(1, h * 0.04), P.ink);
  // 手臂：垂手 / atk 举一只手
  const armW = Math.max(2, Math.round(h * 0.07));
  R(pb, cx - h * 0.24, base - h * 0.6, armW, h * 0.3, P.skin);
  if (atk) {
    tl(pb, cx + h * 0.2, base - h * 0.58, cx + h * 0.34, base - h * 0.74, P.skin, armW);
  } else {
    R(pb, cx + h * 0.21, base - h * 0.6, armW, h * 0.3, P.skin);
  }
  // 脖子
  R(pb, cx - Math.max(1, Math.round(hr * 0.3)), base - h * 0.66, Math.max(2, Math.round(hr * 0.6)), h * 0.06, P.skin);
  // 大头
  pb.ellipse(cx, headCy, hr, hr, P.skin);
  // 头发：只盖**颅顶**（0 ~ 0.76 头半径）。
  // ⚠️ 第一版在 headTop+1.0hr 处又压了一条 0.25hr 的横带，正好盖住眼睛（眼在 1.15hr）
  //    ⇒ 8× 下读成「一个棕球脑袋」，22px 下就是「戴帽子的蓝人」。眼睛必须在发际线下面。
  // 现在收到 0.38hr（发际线 = headTop+0.76hr）：2×2 的眼块要占 2 行，原先 0.42hr 的
  // 发际线离眼睛只剩 1 行，放大后发梢会被最近邻复制下来啃掉眼白。
  pb.ellipse(cx, headTop + hr * 0.38, hr, hr * 0.38, P.hair);
  // 呆毛
  R(pb, cx + hr * 0.1, headTop - 1, Math.max(1, hr * 0.22), Math.max(1, hr * 0.3), P.hair);
  // 眼睛 + 嘴：2+1+2 的净宽正好吃掉 8.5px 脑袋的一大半 —— 这就是「大头小孩」该有的比例
  if (face) {
    const ey = Math.round(headTop + hr * 0.95);
    h3Face(pb, Math.round(cx) - 2, ey, 2, 3, 3);
  }
}

/** 通用人形（弩手用）。返回头/肩/胯的落点，供装备挂上去。 */
function biped(
  pb: PixBuf,
  cx: number,
  base: number,
  h: number,
  o: { w?: number; headR?: number; lean?: number } = {},
): { headY: number; headR: number; shoulder: number; hip: number } {
  const headR = h * (o.headR ?? 0.11);
  const lean = o.lean ?? 0;
  const shoulder = base - h * 0.78;
  const hip = base - h * 0.42;
  const bw = h * (o.w ?? 0.34);
  const legW = Math.max(2, Math.round(bw * 0.24));
  // 腿
  R(pb, cx - bw * 0.42, hip, legW, base - hip - h * 0.03, P.clothDark);
  R(pb, cx + bw * 0.18, hip, legW, base - hip - h * 0.03, P.clothDark);
  R(pb, cx - bw * 0.44, base - h * 0.04, legW + 1, Math.max(1, h * 0.04), P.ink);
  R(pb, cx + bw * 0.16, base - h * 0.04, legW + 1, Math.max(1, h * 0.04), P.ink);
  // 躯干（上宽下窄）
  pb.poly(
    [
      [cx - bw * 0.5 + lean, shoulder],
      [cx + bw * 0.5 + lean, shoulder],
      [cx + bw * 0.36, hip + 2],
      [cx - bw * 0.36, hip + 2],
    ],
    P.cloth,
  );
  R(pb, cx - bw * 0.46 + lean, shoulder + 1, Math.max(1, bw * 0.08), (hip - shoulder) * 0.9, P.clothDark);
  // 手臂
  R(pb, cx - bw * 0.62 + lean, shoulder + h * 0.03, Math.max(2, bw * 0.16), h * 0.28, P.cloth);
  R(pb, cx + bw * 0.46 + lean, shoulder + h * 0.03, Math.max(2, bw * 0.16), h * 0.28, P.cloth);
  // 头
  const hy = shoulder - headR * 0.95;
  ell(pb, cx - headR + lean, hy - headR, cx + headR + lean, hy + headR, P.skin);
  return { headY: hy, headR, shoulder, hip };
}

/** 弩手 · 中档 · 横弩。弩是唯一的横向元素 —— 与「高」的鹰、「宽」的骑士都不撞。 */
function drawCrossbow(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean): void {
  const b = biped(pb, cx, base, h, { w: 0.32, headR: 0.115 });
  const lean = atk ? -1 : 0;
  const hx = cx + lean;
  const hr = b.headR;
  // 头盔：顶上一道帽檐 + 中间一截护鼻（不给整顶大盔 —— 那会读成骑士）
  // ⚠️ 护鼻必须**整截落在眼线之上**：首版压到眼高，2×2 的眼块被它从中间劈开，
  //    `audit:expr` 判「眼对数 = 0」——机器说的是实话，那张脸确实没有眼睛。
  R(pb, hx - hr * 1.1, b.headY - hr * 0.78, hr * 2.2, Math.max(1, hr * 0.3), P.steelLite);
  R(pb, hx - 1, b.headY - hr * 0.78, 2, Math.max(2, hr * 0.55), P.steelDark);
  // 弩：**短托 + 前端一张竖弓 + 一支短矢**，正面读成一个「T」。
  //
  // ⚠️ 首版是「0.62h 长的托 + 贴在托最左端的弓臂」⇒ 8× 下读成「怀里抱着一块木板」。
  //    第二版把托缩到 0.40h、弓臂换钢浅，结果弓被身体挡住、只剩前端那截白矢露在外面
  //    ⇒ **读成「举着一根白棍 / 一支步枪」**（S3a 第三版实拍，8× 下白矢比弓还显眼）。
  //    第四版：托**整体外移**到 `cx − 0.40h` 起（第二版横跨整个胸口 ⇒ 一眼是"棕色方块"），
  //    只有尾端压在身体上，弓因此完整地落在剪影**外面** —— 横线归弩、竖线归鹰、斜线归骑士。
  const y = atk ? base - h * 0.66 : base - h * 0.58;
  const len = h * 0.3;
  const x0 = cx - h * 0.4; // 托的前端 = 弓的落点（在躯干剪影之外）
  R(pb, x0, y - 1, len, Math.max(2, Math.round(h * 0.08)), P.leather);
  R(pb, x0, y + Math.max(1, Math.round(h * 0.08)) - 1, len, 1, P.leatherDark);
  // 竖弓：1px 竖线 + 两端**向前**折（向右折会与矢凑成一个十字架，5× 实拍整件读成"抱着十字架"）
  const bowH = h * 0.15;
  const yBolt = y - 1;
  R(pb, x0, yBolt - bowH, 1, bowH * 2 + 1, P.steelLite);
  R(pb, x0 - 1, yBolt - bowH, 2, 1, P.steelLite);
  R(pb, x0 - 1, yBolt + bowH, 2, 1, P.steelLite);
  // 弦：两梢收到托尾（墨线 —— 钢/金在木托上都只有 ΔL 6~8）⇒ 正面的 V 才是"弓"的签名
  tl(pb, x0, yBolt - bowH, x0 + h * 0.1, yBolt, P.ink, 1);
  tl(pb, x0, yBolt + bowH, x0 + h * 0.1, yBolt, P.ink, 1);
  // 矢**只在出手帧**画，而且从弦位往前 0.06h：常驻的一截白杆与竖弓会凑成一个十字
  // （8× 实拍读成"抱着十字架"），这是本兵第四版的样子 —— 宁可待机时不显矢。
  if (atk) {
    R(pb, Math.round(x0 + h * 0.06), yBolt, Math.round(h * 0.14), 1, P.steelLite);
    R(pb, Math.round(x0 + h * 0.02), yBolt - 1, 2, 2, P.steelLite); // 箭头
  }
  // 背上的箭袋
  R(pb, cx + h * 0.12, base - h * 0.78, Math.max(2, h * 0.09), h * 0.22, P.leather);
  for (let i = 0; i < 2; i++) {
    tl(pb, cx + h * 0.14 + i * 2, base - h * 0.78, cx + h * 0.11 + i * 2, base - h * 0.9, P.leather, 1);
  }
  // 前手托弩（落在托的后段 = 身体边缘，不是悬空）
  R(pb, x0 + h * 0.26, y + h * 0.05, Math.max(2, h * 0.07), Math.max(2, h * 0.08), P.skin);
  // 脸：眼在护鼻之下、嘴在眼下 3 行
  if (face) h3Face(pb, Math.round(hx) - 2, Math.round(b.headY - hr * 0.15), 2, 3, 3);
}

/**
 * 鹰 · 高档 · **收翼立姿 + 长距后腿**。
 *
 * ⚠️ 这里绝不能画平展翼：R1 的机械判据里 `w ≥ 1.5h` 就是「巨物·飞行」档，
 *    平展双翼会让鹰直接与天使落进同一档（§8.4 当场红）。而为了过闸把鹰画小，
 *    §15.4 要的「起跳就到」又没了。所以辨识靠**长度**：腿长、body 竖、翼贴体。
 */
function drawEagle(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean): void {
  const lean = atk ? -h * 0.05 : 0;
  const lw = Math.max(2, Math.round(h * 0.05));
  // ── 长腿（这一档的招牌）：髋在 0.42h，脚在 base；中途一个后向的「膝」凸起 ──
  for (const dir of [-1, 1]) {
    const x = Math.round(cx + dir * h * 0.055);
    R(pb, x, base - h * 0.42, lw, h * 0.4, P.goldDark);
    // 后膝：往外鼓 1~2px（直棍会读成两根竹竿）
    R(pb, x + dir * Math.max(1, Math.round(h * 0.03)), base - h * 0.24, lw, Math.max(2, Math.round(h * 0.06)), P.goldDark);
  }
  // 爪：三趾（不画会读成两根竹竿）
  for (const dir of [-1, 1]) {
    const fx = Math.round(cx + dir * h * 0.055);
    R(pb, fx - Math.max(1, Math.round(h * 0.05)), base - Math.max(1, Math.round(h * 0.03)), Math.max(2, Math.round(h * 0.12)), Math.max(1, Math.round(h * 0.03)), P.featherDark);
    R(pb, fx + Math.max(1, Math.round(h * 0.03)), base - Math.max(1, Math.round(h * 0.03)), Math.max(2, Math.round(h * 0.08)), Math.max(1, Math.round(h * 0.03)), P.featherDark);
  }
  // ── 身体：竖椭圆（横椭圆就成鹌鹑了）──
  pb.ellipse(cx + lean, base - h * 0.62, h * 0.16, h * 0.22, P.feather);
  // 胸腹浅色（只占中间，不做整条白肚）
  pb.ellipse(cx + lean, base - h * 0.6, h * 0.1, h * 0.16, P.belly);
  // ── 收起的双翼：贴着身体两侧，向后下方收成尖 ──
  for (const dir of [-1, 1]) {
    pb.poly(
      [
        [cx + dir * h * 0.05 + lean, base - h * 0.8],
        [cx + dir * h * 0.18 + lean, base - h * 0.68],
        [cx + dir * h * 0.16 + lean, base - h * 0.44],
        [cx + dir * h * 0.25 + lean, base - h * 0.32],
        [cx + dir * h * 0.09 + lean, base - h * 0.46],
      ],
      dir < 0 ? P.featherLite : P.featherDark,
    );
    // 翼羽分缝：一道暗线让「收起的翼」不是一块披风
    tl(pb, cx + dir * h * 0.1 + lean, base - h * 0.72, cx + dir * h * 0.17 + lean, base - h * 0.4, P.featherDark, 1);
  }
  // 尾羽：三根长短不一的尖（齐边会读成一把扇子）
  pb.poly([[cx + h * 0.02, base - h * 0.46], [cx + h * 0.1, base - h * 0.46], [cx + h * 0.22, base - h * 0.2]], P.featherDark);
  pb.poly([[cx - h * 0.02, base - h * 0.46], [cx + h * 0.05, base - h * 0.46], [cx + h * 0.12, base - h * 0.24]], P.feather);
  // ── 颈 + 头 ──
  pb.poly(
    [
      [cx - h * 0.07 + lean, base - h * 0.82],
      [cx + h * 0.06 + lean, base - h * 0.82],
      [cx + h * 0.03 + lean, base - h * 0.9],
      [cx - h * 0.05 + lean, base - h * 0.9],
    ],
    P.feather,
  );
  const hy = base - h * 0.93;
  pb.ellipse(cx - h * 0.01 + lean, hy, h * 0.09, h * 0.075, P.featherLite);
  // 钩喙（朝左）：上喙带钩、下喙短
  pb.poly(
    [
      [cx - h * 0.09 + lean, hy - h * 0.03],
      [cx - h * 0.2 + lean, hy + h * 0.01],
      [cx - h * 0.17 + lean, hy + h * 0.05],
      [cx - h * 0.09 + lean, hy + h * 0.04],
    ],
    P.beak,
  );
  R(pb, Math.round(cx - h * 0.14 + lean), Math.round(hy + h * 0.03), Math.max(1, Math.round(h * 0.03)), Math.max(1, Math.round(h * 0.03)), P.featherDark);
  // 眉脊 + 眼（眉脊让「猛禽」读得出来；没有它是一张圆脸）
  //
  // 鹰走 `audit:expr` 的 **profile 通道**：侧向钩喙 + 一只眼就是侧脸的定义
  // （与独角兽同一条理由，见 FACE_LAW）。但"一只眼"也得是 2×2 —— 首版那个
  // 1px 的点在 profile 通道里同样认不出来，闸门红的是「眼对数 = 0」。
  tl(pb, cx - h * 0.1 + lean, hy - h * 0.068, cx - h * 0.008 + lean, hy - h * 0.068, P.featherDark, 1);
  if (face) profileEye(pb, Math.round(cx - h * 0.05 + lean), Math.round(hy - h * 0.042));
  // 冠羽（两小簇向后）
  pb.poly(
    [
      [cx + h * 0.05 + lean, hy - h * 0.05],
      [cx + h * 0.16 + lean, hy - h * 0.01],
      [cx + h * 0.04 + lean, hy + h * 0.01],
    ],
    P.featherLite,
  );
  // atk：抬爪前扑（不改变高度档）
  if (atk) {
    tl(pb, cx - h * 0.06, base - h * 0.3, cx - h * 0.2, base - h * 0.22, P.goldDark, lw);
    tl(pb, cx - h * 0.2, base - h * 0.22, cx - h * 0.26, base - h * 0.14, P.featherDark, 1);
  }
}

/**
 * 骑士 · 宽体档 · 四条腿 + 长枪。
 *
 * ⚠️ **宽高比是这一档的唯一判据**（`w ≥ 1.35h`），所以长枪必须一路伸到
 *    `cx − 0.72h`、马尾甩到 `cx + 0.7h`。把它画成「一个骑在马上的人」而
 *    总宽只有 1.1h，R1 会当场判它既不是宽体也不是高 —— 档位就塌了。
 */
function drawKnight(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean): void {
  // ── 马 ──
  const bodyTop = base - h * 0.62;
  const bodyBot = base - h * 0.3;
  const halfLen = h * 0.4;
  const lw = Math.max(2, Math.round(h * 0.07));
  // 四条腿：前后各一条主腿 + 一条远侧的（略暗），带折角
  for (const [dx, c] of [
    [-halfLen * 0.72, P.leatherDark],
    [-halfLen * 0.44, P.white],
    [halfLen * 0.5, P.white],
    [halfLen * 0.74, P.leatherDark],
  ] as [number, string][]) {
    const x = Math.round(cx + dx);
    R(pb, x, bodyBot - h * 0.02, lw, base - bodyBot, c);
    // 蹄
    R(pb, x - 1, base - Math.max(1, Math.round(h * 0.04)), lw + 2, Math.max(1, Math.round(h * 0.04)), P.ink);
  }
  // 躯干
  pb.ellipse(cx, (bodyTop + bodyBot) / 2, halfLen, (bodyBot - bodyTop) / 2, P.white);
  // 颈：从前胸斜向左上
  pb.poly(
    [
      [cx - halfLen * 0.62, bodyBot + h * 0.02],
      [cx - halfLen * 0.32, bodyBot + h * 0.02],
      [cx - halfLen * 1.16, base - h * 0.82],
      [cx - halfLen * 1.34, base - h * 0.8],
    ],
    P.white,
  );
  // 鬃毛（深色，压在颈背侧 —— 没有它颈就是一根白管子）
  tl(pb, cx - halfLen * 0.4, bodyTop + h * 0.02, cx - halfLen * 1.2, base - h * 0.84, P.leatherDark, Math.max(2, Math.round(h * 0.04)));
  // 马头 + 吻 + 双耳 + 眼
  const hx = cx - halfLen * 1.3;
  const hy = base - h * 0.86;
  pb.ellipse(hx, hy, h * 0.09, h * 0.07, P.white);
  R(pb, Math.round(hx - h * 0.14), Math.round(hy - h * 0.01), Math.max(2, Math.round(h * 0.07)), Math.max(2, Math.round(h * 0.06)), P.white);
  R(pb, Math.round(hx - h * 0.14), Math.round(hy + h * 0.02), Math.max(1, Math.round(h * 0.03)), Math.max(1, Math.round(h * 0.03)), P.ink);
  for (const dx of [-0.04, 0.03]) {
    pb.poly(
      [
        [hx + h * dx, hy - h * 0.05],
        [hx + h * (dx + 0.02), hy - h * 0.12],
        [hx + h * (dx + 0.05), hy - h * 0.05],
      ],
      P.white,
    );
  }
  pb.set(Math.round(hx - h * 0.04), Math.round(hy - h * 0.01), P.ink);
  // 马尾：甩到右侧把宽度撑满
  tl(pb, cx + halfLen * 0.92, bodyTop + h * 0.04, cx + h * 0.58, base - h * 0.42, P.white, Math.max(2, Math.round(h * 0.05)));
  tl(pb, cx + h * 0.58, base - h * 0.42, cx + h * 0.62, base - h * 0.24, P.leatherDark, Math.max(2, Math.round(h * 0.04)));
  // 马铠：只盖后胯，**窄**（宽了就与骑手连成一块蓝砖）
  // 马铠：只盖后胯、**上缘比马背低 0.04h** —— 骑手的蓝袍与蓝马铠之间要留一条白马背，
  // 否则骑手、鞍、马背连成一整块蓝砖（S3a 首版 8× 实拍就是这个结果）。
  pb.poly(
    [
      [cx + halfLen * 0.06, bodyTop + h * 0.05],
      [cx + halfLen * 0.72, bodyTop + h * 0.05],
      [cx + halfLen * 0.68, bodyBot + h * 0.02],
      [cx + halfLen * 0.3, bodyBot + h * 0.06],
    ],
    P.trim, // 钢制马铠：与白马的 ΔL 17、与蓝袍 15 —— 同时躲开「蓝砖」与断言 8
  );
  R(pb, Math.round(cx + halfLen * 0.3), Math.round(bodyTop + h * 0.05), Math.max(1, Math.round(h * 0.03)), Math.max(2, Math.round(h * 0.14)), P.leatherDark);
  // ── 长枪：**idle 举枪 / atk 平捅**，枪尖到 cx − 0.82h（宽度靠它撑到 1.4h）──
  //
  // ⚠️ 次序：枪必须画在**骑手之前**。枪是一条 `dy/dx ≈ 0.13` 的浅斜线，2px 粗
  //    ⇒ 每一行上它横跨 8~10 px（不是"一条细线穿过脸"）。首版把枪画在最后，
  //    第 18 行整段 x 26..31 被木色铺满，正好把左眼的下半格涂掉 —— `audit:expr`
  //    报「眼对数 = 0（候选 1 块）」，不是尺子刁，是脸真的被枪杆盖住了。
  //    画在骑手之前 ⇒ 头、肩、胸把它挡在背后，剪影一分不少，脸也干净。
  //
  // 为什么不画成「一直平端着」：水平长枪正好横穿马颈与马头，在 8× 下读成
  // 「马头上架了一根栏杆」（实测）。举枪时枪身从骑手手上一路斜到马头顶上方，
  // 与马颈不重叠；atk 再放平，两个姿势也顺带把「待机 / 出手」分开了。
  const handX = cx + h * 0.12;
  const handY = base - h * (atk ? 0.78 : 0.88);
  const tipX = cx - h * 0.82;
  const tipY = base - h * (atk ? 0.72 : 1.0);
  tl(pb, handX, handY, tipX, tipY, P.leather, Math.max(2, Math.round(h * 0.04)));
  // 枪杆下缘压一道暗线（2px 木色太像栏杆，有明暗才像「枪」）
  tl(pb, handX, handY + Math.max(1, Math.round(h * 0.025)), tipX, tipY + Math.max(1, Math.round(h * 0.025)), P.leatherDark, 1);
  // 枪尖
  pb.poly(
    [
      [tipX, tipY],
      [tipX + h * 0.02, tipY - Math.max(2, h * 0.045)],
      [tipX - h * 0.08, tipY + h * 0.005],
      [tipX + h * 0.02, tipY + Math.max(2, h * 0.05)],
    ],
    P.steel,
  );
  // ⚠️ 这里原来还有一面蓝白三角「枪旗」，已删：它挂在手的左下方、横跨 x 27..34 / y 17..21，
  //    同样压在左眼上。枪本身（木杆 + 暗边 + 钢尖）已经够撑宽体，不缺这面旗。
  // ── 骑手（坐在马背，最高点 = 盔冠 = 1.04h）──
  const hipY = base - h * 0.64;
  const shoulderY = base - h * 0.86;
  pb.poly(
    [
      [cx - h * 0.08, hipY],
      [cx + h * 0.08, hipY],
      [cx + h * 0.07, shoulderY],
      [cx - h * 0.07, shoulderY],
    ],
    P.cloth,
  );
  // 肩甲（横向 1px 外挑，读「骑士」）
  R(pb, Math.round(cx - h * 0.1), Math.round(shoulderY), Math.max(2, Math.round(h * 0.2)), Math.max(2, Math.round(h * 0.04)), P.steel);
  // 头 + 大盔
  // ⚠️ 头盔半径从 0.068h 放大到 0.105h：h3 脸要「2 + 净空 1 + 2」= 5px 的净宽，
  //    原来那颗 5px 宽的头盔连两只 2×2 的眼都放不下（放下就贴盔沿，归一化后粘成一条黑）。
  const rhy = base - h * 0.93;
  const rhR = h * 0.105;
  pb.ellipse(cx, rhy, rhR, rhR * 0.9, P.steel);
  // 面甲缝 → 「眼睛 + 呼吸缝」：原来那道 0.14h 宽的墨横线正好压在眼睛的高度上，
  // 留着它就永远画不出脸（首版 8× 下这里是一整条黑缝，读成「无脸铁罐头」）。
  if (face) h3Face(pb, Math.round(cx) - 2, Math.round(rhy - rhR * 0.2), 2, 3, 3);
  // 盔冠（白缨）—— 剪影最高点。
  // 高度给到 1.04h（= BODY_PLAN 的声明高）：归一化会把「比目标高的部分从顶上删掉」，
  // 首版写到 1.06h ⇒ 多出来的 2 行正好被删光，白缨整根消失。
  R(pb, Math.round(cx - h * 0.01), Math.round(base - h * 1.04), Math.max(1, Math.round(h * 0.03)), Math.max(2, Math.round(h * 0.05)), P.white);
  // 执枪的手（画在最后 ⇒ 压在枪杆上，看起来是"握着"而不是"穿过"）
  R(pb, Math.round(handX - h * 0.03), Math.round(handY - h * 0.02), Math.max(2, Math.round(h * 0.06)), Math.max(2, Math.round(h * 0.06)), P.steel);
}

/**
 * 天使 · 巨物·飞行档 · 光环 + **上掠**翼。
 *
 * 翅膀朝向是全表唯一的两档（§16.1）：天使上掠、恶魔与龙下掠、鹰收翼。
 * 这一条不是画风 —— 它是「同族五个兵各占一档」之外的第二层区分。
 */
function drawAngel(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean): void {
  // ── 自上而下的高度预算（这一版最要紧的结构改动）──
  //
  // 首版把 h 全给了「身体」、又拿 `bb = base − 0.04h` 当基准往上画，三处一起塌：
  //   ① 头顶画到 y = −1（画布外 1px）⇒ 8× 图上是**平顶**；
  //   ② 光环在 hy − 2.1·headR ⇒ y ≈ −5，**整圈在画布外**，等于没画；
  //   ③ 翼尖在 shoulder − 0.62h ⇒ y ≈ −18，被裁成两根竖板 —— 读成「头上长了两只犄角」。
  // 现在一律从 `topY = base − h` 往下排：光环占最上面 2·haloRy，然后留 2px 描边缝、
  // 头、肩、袍依次往下。这样 h 就是**含光环的整个剪影高**，与 R1 量的是同一件事。
  const topY = base - h; // 剪影最高点 = 光环上缘
  const feet = base - h * 0.035; // 悬浮 1~2px：脚不落地，但也不飘
  const headR = h * 0.095;
  const haloRy = Math.max(2, Math.round(h * 0.036));
  const haloCy = topY + haloRy;
  const headTop = haloCy + haloRy + 3; // 留 3px：1~2px 的缝会被描边灌成一根「天线」
  const hy = headTop + headR;
  const shoulder = hy + headR * 1.35;
  const hem = feet - h * 0.02;
  // ── 翼：先画（在袍与头**后面**）──
  //
  // 高度只抬到「头顶略下」：再高就越过光环，剪影最高点从光环变成翼尖。
  // 宽度 0.40h：h 归一化到 56 时缩放约 1.1 倍，再宽就撑破 64px 画布（audit:b0 断言 12）。
  const wY = shoulder + h * 0.02;
  const wH = wY - (headTop + h * 0.02);
  const wW = h * 0.4;
  for (const dir of [-1, 1]) {
    const sx = cx + dir * h * 0.13;
    const p = (a: number, b: number): [number, number] => [sx + dir * wW * a, wY - wH * b];
    pb.poly(
      [
        p(0.0, 0.0),
        p(0.3, 0.52),
        p(0.72, 0.92),
        p(0.9, 0.72),
        p(0.66, 0.56),
        p(0.8, 0.38),
        p(0.52, 0.28),
        p(0.58, 0.06),
        p(0.24, 0.0),
      ],
      P.white,
    );
    // 两根羽骨（而不是"一只白翼一只灰翼"）：首版右翼用 p1wall0，43×37 下读成
    // 一块灰板、左翼读成一只白翼 —— 不对称在剪影层会被当成"坏了"，不是"打光"。
    tl(pb, sx, wY, sx + dir * wW * 0.72, wY - wH * 0.9, P.whiteDark, 1);
    tl(pb, sx + dir * wW * 0.06, wY - wH * 0.1, sx + dir * wW * 0.6, wY - wH * 0.42, P.whiteMid, 1);
  }
  // ── 袍（下摆略张，但**不能**做成宽体 —— 宽度留给翼展判断）──
  pb.poly(
    [
      [cx - h * 0.12, shoulder],
      [cx + h * 0.12, shoulder],
      [cx + h * 0.2, hem],
      [cx - h * 0.2, hem],
    ],
    P.white,
  );
  pb.poly(
    [
      [cx + h * 0.02, shoulder],
      [cx + h * 0.12, shoulder],
      [cx + h * 0.2, hem],
      [cx + h * 0.04, hem],
    ],
    P.whiteMid,
  );
  // 腰带
  R(pb, cx - h * 0.13, shoulder + h * 0.16, h * 0.26, Math.max(2, h * 0.035), P.leatherDark);
  // 肩 + 头
  R(pb, cx - h * 0.13, shoulder - h * 0.04, h * 0.26, h * 0.1, P.white);
  ell(pb, cx - headR, hy - headR, cx + headR, hy + headR, P.skin);
  // 发：只盖颅顶（0.65 头半径），给 2×2 的眼睛留出发际线以下的位置
  ell(pb, cx - headR, hy - headR, cx + headR, hy - headR * 0.35, P.hair);
  // 脸
  if (face) h3Face(pb, Math.round(cx) - 2, Math.round(hy - headR * 0.15), 2, 3, 3);
  // 光环：**实心**扁椭圆（画布没有"擦除"，1px 的环会被描边灌成一枚黑环）
  pb.ellipse(cx, haloCy, headR * 1.15, haloRy, P.goldDark);
  // 剑：idle 垂在身侧（**在袍外、翼下** —— 首版从翼后面穿出来，43×37 下像一片蓝胶带），
  // atk 举过头顶。
  const swx = cx + h * 0.245;
  if (atk) {
    tl(pb, cx + h * 0.14, shoulder + h * 0.06, cx + h * 0.2, hy - h * 0.26, P.steelDark, Math.max(2, Math.round(h * 0.03)));
    R(pb, cx + h * 0.18, hy - h * 0.3, Math.max(2, Math.round(h * 0.05)), Math.max(2, Math.round(h * 0.05)), P.leatherDark);
  } else {
    R(pb, swx, shoulder + h * 0.3, Math.max(2, Math.round(h * 0.035)), h * 0.34, P.steelDark);
    R(pb, swx - h * 0.02, shoulder + h * 0.27, Math.max(2, Math.round(h * 0.075)), Math.max(2, Math.round(h * 0.035)), P.leatherDark);
  }
  // 两只脚（点在袍下，证明是「悬浮」而不是「站着但看不出来」）
  R(pb, cx - h * 0.07, feet - h * 0.03, Math.max(2, h * 0.05), Math.max(1, h * 0.03), P.leatherDark);
  R(pb, cx + h * 0.03, feet - h * 0.03, Math.max(2, h * 0.05), Math.max(1, h * 0.03), P.leatherDark);
}

/* ==========================================================================
 * 4b. p2 赤焰五兵（S3b，2026-11-06）
 *
 * 这一族是**身高跨度最大**的一组（矮 0.64 → 巨物 1.50，差 2.3 倍），
 * 也是验证「五档真的分得开」最有力的一组：四足、构装、巨人、翼魔四种骨架
 * 同时出现，没有两个兵可以靠"换顶帽子"糊过去。
 * ========================================================================== */

/** 火柴人 · 矮档 · 细棍四肢 + 大头 + 头顶火苗。 */
function drawMatchman(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean): void {
  const topY = base - h;
  // 火苗占最上面 0.12h：剪影最高点必须是火苗尖，否则归一化会把头削平
  const flameH = h * 0.12;
  const headR = h * 0.2;
  const headCy = topY + flameH + headR;
  const neck = headCy + headR * 0.92;
  const hip = base - h * 0.3;
  // 1px 的四肢在 22px 下整根消失（S3b 首轮实拍：只剩一个圆头 + 一点红）
  const limbW = Math.max(2, Math.round(h * 0.065));
  // 腿：两根细斜线。**不许加粗** —— "细"就是这一档的辨识（p1 小孩同档但穿短袍）
  tl(pb, cx - h * 0.02, hip, cx - h * 0.16, base - 1, P2.limb, limbW);
  tl(pb, cx + h * 0.02, hip, cx + h * 0.16, base - 1, P2.limb, limbW);
  // 脚：两个墨点（少了它们，22px 下是两根悬空的线）
  R(pb, cx - h * 0.21, base - 1, Math.max(2, Math.round(h * 0.08)), 1, P2.ink);
  R(pb, cx + h * 0.13, base - 1, Math.max(2, Math.round(h * 0.08)), 1, P2.ink);
  // 躯干：一根竖线
  tl(pb, cx, neck, cx, hip, P2.limb, Math.max(1, Math.round(h * 0.05)));
  // 短裤：胯部一小块红 —— 没有它整个人是个"十"字，读不出朝向
  R(pb, cx - h * 0.07, hip - h * 0.04, h * 0.14, Math.max(2, h * 0.09), P2.red);
  // 手臂：X 形张开（火柴人的签名）
  tl(pb, cx, neck + h * 0.02, cx - h * 0.26, base - h * 0.36, P2.limb, limbW);
  if (atk) tl(pb, cx, neck + h * 0.02, cx + h * 0.3, neck - h * 0.02, P2.limb, limbW);
  else tl(pb, cx, neck + h * 0.02, cx + h * 0.26, base - h * 0.36, P2.limb, limbW);
  // 大头
  pb.ellipse(cx, headCy, headR, headR, P.skin);
  // 脸：头径 0.4h ≈ 9.3px，2+2+2 的两眼刚好放下
  if (face) h3Face(pb, Math.round(cx) - 2, Math.round(headCy - headR * 0.28), 2, 3, 3);
  // 火苗：三尖，压在最上面（既是"火柴"的命名理由，也是剪影最高点）
  pb.poly([[cx, topY], [cx - h * 0.075, topY + flameH * 0.92], [cx - h * 0.02, topY + flameH * 0.72]], P2.glow);
  pb.poly([[cx, topY], [cx + h * 0.075, topY + flameH * 0.92], [cx + h * 0.02, topY + flameH * 0.72]], P2.red);
  R(pb, cx - h * 0.03, topY + flameH * 0.58, Math.max(2, h * 0.06), Math.max(1, flameH * 0.42), P2.redDark);
  // 手持的火柴：atk 举到脸侧（出口象限 = 右上），idle 垂在右手
  if (atk) {
    tl(pb, cx + h * 0.3, neck, cx + h * 0.44, topY + h * 0.24, P2.wood0, Math.max(1, Math.round(h * 0.035)));
    R(pb, cx + h * 0.41, topY + h * 0.2, Math.max(2, h * 0.06), Math.max(2, h * 0.06), P2.red);
  } else {
    tl(pb, cx + h * 0.24, base - h * 0.38, cx + h * 0.3, base - h * 0.22, P2.wood0, Math.max(1, Math.round(h * 0.035)));
    R(pb, cx + h * 0.28, base - h * 0.24, Math.max(2, h * 0.05), Math.max(2, h * 0.05), P2.red);
  }
}

/**
 * 铜人 · 中档 · 方头方肩的铜制构装。
 *
 * 走 `audit:expr` 的 glow 通道：眼是 2×2 同色 `#ffd06a`，**没有 hi0**（§1.4 的
 * 「唯一高光」不适用于构装）。脸上那道横缝是 `metal0` 的面甲缝，不是嘴线 ——
 * glow 通道允许无嘴，但**不许**用 ink0 画一道 3px 以上的横线（那会被当成嘴，
 * 而嘴的上下行必须不是同样宽的墨，构装脸上没有那个结构）。
 */
function drawBronze(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean): void {
  // ── 为什么这一版是**矮胖方盒**（h 0.90 → 0.88、躯干加宽到 0.5h）──
  //
  // `audit:bodyplan` 的 [4] 在 22×30 下量「同族两两剪影差 ≥15%」，铜人与熔岩巨人
  // 只差 **10%** 被红。原因不是画错，是**兵牌把宽高比归一化掉了**：两张都按高缩到
  // 30px 后，铜人 21×30、巨人 20×30 —— 轮廓几乎重合（都是"头-宽肩-窄腿"）。
  // 修法只能是让**形状**不同：铜人做成"横方块 + 外挑肩 + 身侧大锤"（缩到 22 宽后
  // 只有 25 高），巨人保持"窄高 + 沙漏腰"（20×30）。这样两者的 bbox 就不一样了。
  const topY = base - h;
  const headW = h * 0.24;
  const headH = h * 0.17;
  const headTop = topY + h * 0.02;
  const shoulder = headTop + headH + h * 0.03;
  const hip = base - h * 0.26;
  const bw = h * 0.5;
  // 腿：两根粗短方柱，中间留 0.11h 的缝（缩略图上还剩 1px，正是"两条腿"的证据）
  const legW = Math.max(2, Math.round(h * 0.15));
  R(pb, cx - h * 0.19, hip, legW, base - hip, P2.bronze);
  R(pb, cx + h * 0.04, hip, legW, base - hip, P2.bronze);
  R(pb, cx - h * 0.2, base - Math.max(1, h * 0.05), legW + 2, h * 0.05, P2.metal0);
  R(pb, cx + h * 0.03, base - Math.max(1, h * 0.05), legW + 2, h * 0.05, P2.metal0);
  // 躯干（倒梯形，比旧版宽 0.06h）
  pb.poly(
    [
      [cx - bw * 0.5, shoulder],
      [cx + bw * 0.5, shoulder],
      [cx + bw * 0.4, hip],
      [cx - bw * 0.4, hip],
    ],
    P2.bronze,
  );
  // 右侧暗面：没有它整块铜是一个平面（铜人 22px 下就是这个"平面"最容易糊成一块砖）
  R(pb, cx + bw * 0.3, shoulder + 1, Math.max(2, bw * 0.14), hip - shoulder - 1, P2.limb);
  // 铆钉三颗（构装的签名）
  for (const dx of [-0.12, -0.02, 0.08]) {
    R(pb, cx + h * dx, shoulder + h * 0.05, 2, 2, P2.metal0);
  }
  // 肩甲：两块**外挑到 ±0.40h** 的方块（总宽的一半靠它们）
  R(pb, cx - bw * 0.5 - h * 0.15, shoulder - h * 0.03, Math.max(3, h * 0.15), Math.max(2, h * 0.08), P2.bronzeLite);
  R(pb, cx + bw * 0.5, shoulder - h * 0.03, Math.max(3, h * 0.15), Math.max(2, h * 0.08), P2.bronzeLite);
  // 手臂：**贴在肩甲外沿**，与躯干之间留 1px 缝（构装的手臂是挂上去的，不是长出来的）
  const armW = Math.max(2, Math.round(h * 0.1));
  R(pb, cx - bw * 0.5 - h * 0.14, shoulder + h * 0.04, armW, h * 0.26, P2.bronze);
  R(pb, cx + bw * 0.5 + h * 0.04, shoulder + h * 0.04, armW, h * 0.26, P2.bronze);
  // 头：方块 + 顶面高光
  // ⚠️ 顶面那一条**不能用 bronzeLite**：它与 glow 眼（#ffd06a）ΔL 只 1.1，
  //    而这一行正好压在眼的上方 1px（h=32 时头高只有 5px）⇒ 断言 8 红。
  //    换 metal0：与铜差 24、与发光眼差 30，仍然读得出"顶面受光"。
  R(pb, cx - headW * 0.5, headTop, headW, headH, P2.bronze);
  R(pb, cx - headW * 0.5, headTop, headW, 1, P2.metal0);
  // 面甲缝（metal0，不是 ink0 —— 见函数头注释）
  R(pb, cx - headW * 0.3, headTop + headH * 0.76, headW * 0.6, 1, P2.metal0);
  if (face) glowFace(pb, Math.round(cx) - 2, Math.round(headTop + headH * 0.34), 2, 0, 0, 0);
  // 方锤：idle 垂在身侧外沿（把总宽撑到 0.88h），atk 举过肩
  const hx = cx + bw * 0.5 + h * 0.12;
  if (atk) {
    tl(pb, hx, shoulder + h * 0.24, hx + h * 0.12, shoulder - h * 0.1, P2.wood0, Math.max(2, Math.round(h * 0.045)));
    R(pb, hx + h * 0.06, shoulder - h * 0.2, Math.max(3, h * 0.2), Math.max(3, h * 0.11), P2.bronzeLite);
  } else {
    tl(pb, hx, shoulder + h * 0.22, hx, hip + h * 0.02, P2.wood0, Math.max(2, Math.round(h * 0.045)));
    R(pb, hx - h * 0.08, hip, Math.max(3, h * 0.2), Math.max(3, h * 0.11), P2.bronzeLite);
  }
  // 执锤的手（最后画，压在柄上 ⇒ 读"握着"）
  R(pb, hx - Math.max(1, h * 0.03), shoulder + h * 0.22, Math.max(3, h * 0.08), Math.max(3, h * 0.07), P2.bronzeLite);
}

/**
 * 熔岩巨人 · 高档 · 厚肩 + 长臂 + 岩缝发光。
 *
 * ⚠️ 宽度必须 **< 1.35h**：宽体档归三头狼。§15.4 也明说「慢而硬」靠高度与肩厚，
 *    不靠横张 —— 横张是猿人/牛头怪的语法，不能借给巨人。
 */
function drawLavaGiant(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean): void {
  const topY = base - h;
  const headR = h * 0.085;
  const headCy = topY + headR + h * 0.015;
  const shoulder = headCy + headR + h * 0.04;
  const hip = base - h * 0.26;
  const bw = h * 0.46;
  const legW = Math.max(2, Math.round(h * 0.14));
  // 腿：短粗 + **中间留 0.13h 的缝**（22×30 下这是"两条腿"的唯一证据）
  R(pb, cx - h * 0.21, hip, legW, base - hip, P2.redDark);
  R(pb, cx + h * 0.07, hip, legW, base - hip, P2.redDark);
  R(pb, cx - h * 0.22, base - Math.max(1, h * 0.04), legW + 2, h * 0.04, P2.ink);
  R(pb, cx + h * 0.06, base - Math.max(1, h * 0.04), legW + 2, h * 0.04, P2.ink);
  // 躯干：肩宽**腰极窄**（沙漏）—— 这是与铜人"方盒"最省的区分：
  // 两者在 22×30 下都被压成实心块，只有"块的两侧是否内收"还看得出来。
  pb.poly(
    [
      [cx - bw * 0.5, shoulder],
      [cx + bw * 0.5, shoulder],
      [cx + bw * 0.24, hip],
      [cx - bw * 0.24, hip],
    ],
    P2.redDark,
  );
  // 胸口熔岩块：亮红压在暗红上（ΔL 够，且是**大面积**，22px 下读"滚烫的胸")
  pb.poly(
    [
      [cx - bw * 0.18, shoulder + h * 0.07],
      [cx + bw * 0.15, shoulder + h * 0.09],
      [cx + bw * 0.09, hip - h * 0.03],
      [cx - bw * 0.15, hip - h * 0.01],
    ],
    P2.red,
  );
  // 裂缝：三段发光细线（这是"熔岩"的唯一证据；没有它就是一块红石头）
  tl(pb, cx - bw * 0.16, shoulder + h * 0.12, cx - bw * 0.04, hip - h * 0.08, P2.glow, 2);
  tl(pb, cx + bw * 0.02, shoulder + h * 0.16, cx + bw * 0.1, hip - h * 0.06, P2.glow, 2);
  // 肩：两块厚岩（横向只到 bw*0.56 ⇒ 总宽仍远小于 1.35h）
  R(pb, cx - bw * 0.56, shoulder - h * 0.04, Math.max(3, bw * 0.3), Math.max(2, h * 0.1), P2.red);
  R(pb, cx + bw * 0.26, shoulder - h * 0.04, Math.max(3, bw * 0.3), Math.max(2, h * 0.1), P2.red);
  // 肩刺：两根向上外的岩尖（高度压在 headTop 之下 —— 剪影最高点仍是头顶的角）
  pb.poly(
    [
      [cx - bw * 0.56, shoulder + h * 0.01],
      [cx - bw * 0.7, shoulder - h * 0.15],
      [cx - bw * 0.3, shoulder - h * 0.03],
    ],
    P2.redDark,
  );
  pb.poly(
    [
      [cx + bw * 0.56, shoulder + h * 0.01],
      [cx + bw * 0.7, shoulder - h * 0.15],
      [cx + bw * 0.3, shoulder - h * 0.03],
    ],
    P2.redDark,
  );
  // 长臂：垂到膝下（"慢而硬"的体量感）
  const armW = Math.max(2, Math.round(h * 0.12));
  // 手臂用**亮红**：暗红贴暗红在缩略图上完全融合（S3b 首轮实拍是一只"没有手臂的红方块"）。
  // 与躯干同族（p2accent），断言 8 跳过，但 ΔL 14 足够读出两条手臂。
  R(pb, cx - bw * 0.58, shoulder, armW, h * 0.44, P2.red);
  R(pb, cx + bw * 0.46, shoulder, armW, h * 0.44, P2.red);
  // 拳头
  R(pb, cx - bw * 0.6, shoulder + h * 0.44, Math.max(3, armW + 2), h * 0.1, P2.red);
  R(pb, cx + bw * 0.44, shoulder + h * 0.44, Math.max(3, armW + 2), h * 0.1, P2.red);
  if (atk) {
    // 出手：右拳砸向前下方（不改变高度档）
    tl(pb, cx + bw * 0.5, shoulder + h * 0.1, cx + bw * 0.72, shoulder + h * 0.34, P2.red, armW);
    R(pb, cx + bw * 0.66, shoulder + h * 0.32, Math.max(3, h * 0.12), Math.max(3, h * 0.1), P2.red);
  }
  // 头：小、嵌在肩里
  pb.ellipse(cx, headCy, headR, headR * 0.95, P2.red);
  // 头顶岩角两簇（剪影最高点 = topY）
  pb.poly([[cx - headR * 0.85, headCy - headR * 0.55], [cx - headR * 1.35, topY], [cx - headR * 0.35, topY + headR * 0.25]], P2.redDark);
  pb.poly([[cx + headR * 0.3, headCy - headR * 0.8], [cx + headR * 0.85, topY + h * 0.012], [cx + headR * 1.15, headCy - headR * 0.35]], P2.redDark);
  // 眼（glow）+ 嘴（stone0 横线，在下巴位置 —— 巨人的嘴就是一道裂口）
  if (face) glowFace(pb, Math.round(cx) - 2, Math.round(headCy - headR * 0.1), 1, Math.round(cx) - h * 0.09, h * 0.18, 5);
}

/**
 * 三头狼 · 宽体档 · 四足长身 + **三个分开的头**。
 *
 * ⚠️ 宽高比是这一档的唯一判据（`w ≥ 1.35h`），但**成品要留余量**：
 *    R1 量的是加完 1px 描边的 bbox，描边会让高多 2px、宽也多 2px，
 *    而比值对"矮而宽"的剪影是**变小**的（分母涨得比分子快）。
 *    所以这里画到 1.42h，成品落在 1.40~1.45，不会贴着 1.35 的线。
 *
 * ⚠️ 首版在 8× 下读成**长颈鹿**（S3b 第一轮实拍）：脖子 8px、身体只有 4px 厚、
 *    三个头叠成一团。这一版把三处一起收紧：身体加厚到 0.16h、脖子压到 0.04~0.08h、
 *    三个头在 x 上拉开 0.18h 且高度错落 0.08h —— 22px 下能数出三个凸起。
 *
 * ⚠️ 三个头只有**主头**画 ink 眼：`audit:expr` 的 profile 通道要求「恰好 1 只眼」。
 *    另两颗头是"远侧的头"，用 `p2wall0` 的暗点 —— 它们凑不出 `ink0 + hi0` 的
 *    2×2 窗口，所以不会被数成眼。这不是绕过判据：兽形侧脸的定义本来就是一只眼，
 *    三个头里的两只是侧影，画成高光眼反而会读成"三个正面脸"。
 */
function drawThreeWolf(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean): void {
  const bodyCy = base - h * 0.46;
  const halfLen = h * 0.3;
  const legW = Math.max(2, Math.round(h * 0.08));
  // 尾：粗短、末端蓬松（首版是一根细天线 + 一个球）
  tl(pb, cx + halfLen * 0.8, bodyCy + h * 0.02, cx + h * 0.8, base - h * 0.6, P2.wall, Math.max(3, Math.round(h * 0.09)));
  pb.poly([[cx + h * 0.74, base - h * 0.68], [cx + h * 0.88, base - h * 0.58], [cx + h * 0.72, base - h * 0.5]], P2.wallDark);
  // 四腿：短粗，前后各两条（远侧暗一档 ⇒ 读"四足"而不是"两块板"）
  for (const [dx, near] of [
    [-halfLen * 0.78, false],
    [-halfLen * 0.5, true],
    [halfLen * 0.44, true],
    [halfLen * 0.72, false],
  ] as [number, boolean][]) {
    const x = Math.round(cx + dx);
    R(pb, x, bodyCy + h * 0.1, legW, base - (bodyCy + h * 0.1) - h * 0.02, near ? P2.wall : P2.wallDark);
    R(pb, x - 1, base - Math.max(1, h * 0.03), legW + 2, h * 0.03, P2.ink);
  }
  // 躯干：加厚到 0.16h（首版 0.115h 是一条腊肠）
  pb.ellipse(cx, bodyCy, halfLen, h * 0.16, P2.wall);
  // 背脊鬃（暗红）—— 没有它，这团棕色读成"猪"
  pb.poly(
    [
      [cx - halfLen * 0.7, bodyCy - h * 0.13],
      [cx + halfLen * 0.55, bodyCy - h * 0.13],
      [cx + halfLen * 0.4, bodyCy - h * 0.18],
      [cx - halfLen * 0.56, bodyCy - h * 0.18],
    ],
    P2.redDark,
  );
  // 腹：暗一档
  pb.ellipse(cx, bodyCy + h * 0.07, halfLen * 0.82, h * 0.06, P2.wallDark);
  // ── 颈部横梁：把三个头连成**一片** ──
  //
  // 不是为了省事：头与头之间留 1px 透明缝时，`buildB0Frame` 的描边会把那道缝
  // 灌成一段 3px 宽的 ink0 —— 而它正好落在左眼的找嘴窗口里（x ∈ [l.x−3, l.x+7]），
  // `audit:expr` 的 [Contr] 于是把它当成"一条贴着透明的嘴线"（ΔE 15.5）判红。
  // 连成一片之后，眼下 8 行内只有连续的皮毛色，三个头靠**吻 + 耳 + 高度差**区分
  // （H3 的刻耳柏洛斯也是连着画的）。
  R(pb, cx - h * 0.54, base - h * 0.8, h * 0.56, Math.max(3, h * 0.12), P2.wall);
  // 三个头：x 上拉开 0.21h、高度错落 **0.16h**、头半径 0.068h。
  //
  // 第三轮：头与头之间用 `wallDark` **暗线**分隔，而不是留透明缝。
  // 透明缝会被描边灌成 ink0（见上），暗线不会 —— 3px 的暗线在 22×30 下正好
  // 是"两个头之间的那道影子"，比"三个球并排"更像多头兽。
  const heads: { x: number; y: number; r: number; main: boolean }[] = [
    { x: cx - h * 0.47, y: base - h * 0.68, r: h * 0.068, main: false },
    { x: cx - h * 0.26, y: base - h * 0.86, r: h * 0.075, main: true },
    { x: cx - h * 0.05, y: base - h * 0.74, r: h * 0.068, main: false },
  ];
  // 两头之间的暗缝（画在头**之前**，头再压上去 ⇒ 只有中间那一条露出来）
  for (const sx of [-0.365, -0.155]) R(pb, cx + h * sx, base - h * 0.86, Math.max(2, h * 0.03), Math.max(3, h * 0.2), P2.wallDark);
  for (const hd of heads) {
    // 颈：短（首版 0.19h 的颈把整只狼拉成了长颈鹿）
    tl(pb, hd.x + hd.r * 0.4, hd.y + hd.r * 0.8, hd.x + h * 0.09, bodyCy - h * 0.1, P2.wall, Math.max(2, Math.round(h * 0.07)));
    // 头
    pb.ellipse(hd.x, hd.y, hd.r, hd.r * 0.85, P2.wall);
    // 吻（朝左）
    pb.poly(
      [
        [hd.x - hd.r * 0.8, hd.y - hd.r * 0.25],
        [hd.x - hd.r * 1.5, hd.y + hd.r * 0.05],
        [hd.x - hd.r * 1.42, hd.y + hd.r * 0.55],
        [hd.x - hd.r * 0.75, hd.y + hd.r * 0.5],
      ],
      P2.wallDark,
    );
    // 双耳：前耳亮、后耳暗（近远关系）
    pb.poly([[hd.x - hd.r * 0.4, hd.y - hd.r * 0.65], [hd.x - hd.r * 0.5, hd.y - hd.r * 1.75], [hd.x - hd.r * 0.02, hd.y - hd.r * 0.7]], P2.wall);
    pb.poly([[hd.x + hd.r * 0.15, hd.y - hd.r * 0.68], [hd.x + hd.r * 0.34, hd.y - hd.r * 1.5], [hd.x + hd.r * 0.5, hd.y - hd.r * 0.6]], P2.wallDark);
    // 眼：主头 ink（profile 的单眼），远侧两头是暗点
    if (hd.main) {
      // 眼必须落在头的**上半部**：首版放在 −0.2r（几乎贴着头底），
      // 头下方那道 1px 透明缝被描边灌成 ink0 段，`audit:expr` 的 [Contr]
      // 把它当成"嘴线"（ΔE 15.5 vs 透明）⇒ 红。−0.55r 时眼下全是头/颈/身体。
      if (face) profileEye(pb, Math.round(hd.x - hd.r * 0.55), Math.round(hd.y - hd.r * 0.55));
    } else {
      pb.set(Math.round(hd.x - hd.r * 0.6), Math.round(hd.y - hd.r * 0.12), P2.wallDark);
    }
  }
  if (atk) {
    // 出手：前爪抬起前扑
    tl(pb, cx - halfLen * 0.62, bodyCy + h * 0.06, cx - h * 0.48, base - h * 0.28, P2.wall, Math.max(2, Math.round(h * 0.1)));
    R(pb, cx - h * 0.52, base - h * 0.3, Math.max(2, h * 0.09), Math.max(1, h * 0.04), P2.ink);
  }
}
/**
 * 恶魔 · 巨物·飞行档 · **下掠翼** + 双角 + 尾。
 *
 * 翅膀朝向是全表第二层区分（§16.1）：天使上掠、恶魔与绿龙下掠、鹰收翼。
 * 下掠翼的宽度必须控制在 `1.12h` 以内 —— h=1.50 归一化到 55px 时要乘 1.06，
 * 再宽就顶破 64px 画布（`audit:b0` 断言 12）。
 */
function drawDevil(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean): void {
  const topY = base - h;
  const headR = h * 0.1;
  const headCy = topY + h * 0.19;
  const shoulder = headCy + headR * 1.35;
  const hip = base - h * 0.34;
  // ── 下掠双翼（先画，在身体后面）──
  const wRootY = shoulder + h * 0.02;
  const wW = h * 0.44;
  for (const dir of [-1, 1]) {
    const sx = cx + dir * h * 0.12;
    pb.poly(
      [
        [sx, wRootY],
        [sx + dir * wW * 0.55, wRootY + h * 0.06],
        [sx + dir * wW * 1.0, base - h * 0.1], // 翼尖低垂（与天使的上掠镜像）
        [sx + dir * wW * 0.76, base - h * 0.16],
        [sx + dir * wW * 0.88, base - h * 0.28],
        [sx + dir * wW * 0.52, base - h * 0.3],
        [sx + dir * wW * 0.58, base - h * 0.42],
        [sx + dir * wW * 0.18, base - h * 0.3],
      ],
      P2.redDark,
    );
    // 翼骨：一根亮红，避免整片暗红在 22px 下是一块抹布
    tl(pb, sx, wRootY, sx + dir * wW * 0.9, base - h * 0.12, P2.red, 1);
  }
  // ── 角：从头顶向上外，角尖 = 剪影最高点 ──
  for (const dir of [-1, 1]) {
    pb.poly(
      [
        [cx + dir * headR * 0.82, headCy - headR * 0.5],
        [cx + dir * headR * 1.55, topY],
        [cx + dir * headR * 0.35, headCy - headR * 0.62],
      ],
      P2.bronze,
    );
  }
  // ── 躯干 ──
  pb.poly(
    [
      [cx - h * 0.16, shoulder],
      [cx + h * 0.16, shoulder],
      [cx + h * 0.12, hip],
      [cx - h * 0.12, hip],
    ],
    P2.red,
  );
  // 胸腹暗面（红上压暗红：ΔL 够，且是窄条）
  R(pb, cx - h * 0.12, shoulder + h * 0.02, Math.max(2, h * 0.1), hip - shoulder - h * 0.02, P2.redDark);
  // 腿 + 蹄
  const legW = Math.max(2, Math.round(h * 0.08));
  R(pb, cx - h * 0.11, hip, legW, base - hip - h * 0.04, P2.red);
  R(pb, cx + h * 0.03, hip, legW, base - hip - h * 0.04, P2.red);
  R(pb, cx - h * 0.12, base - h * 0.04, legW + 2, h * 0.04, P2.ink);
  R(pb, cx + h * 0.02, base - h * 0.04, legW + 2, h * 0.04, P2.ink);
  // 头
  pb.ellipse(cx, headCy, headR, headR * 0.92, P2.red);
  // 脸：恶魔是人形正脸（有角但不是侧脸）⇒ h3
  if (face) h3Face(pb, Math.round(cx) - 2, Math.round(headCy - headR * 0.15), 2, 3, 3);
  // 尾：从臀部向右下，末端一个三角（"尾巴"是恶魔与天使的第三处不同）
  tl(pb, cx + h * 0.1, hip, cx + h * 0.42, base - h * 0.16, P2.redDark, Math.max(2, Math.round(h * 0.035)));
  pb.poly([[cx + h * 0.4, base - h * 0.2], [cx + h * 0.5, base - h * 0.08], [cx + h * 0.36, base - h * 0.1]], P2.red);
  if (atk) {
    // 出手：前爪横扫（右臂抬起），不改变高度档
    tl(pb, cx + h * 0.14, shoulder + h * 0.08, cx + h * 0.42, shoulder + h * 0.02, P2.red, Math.max(2, Math.round(h * 0.06)));
    R(pb, cx + h * 0.4, shoulder - h * 0.02, Math.max(3, h * 0.07), Math.max(3, h * 0.06), P2.redDark);
  }
}

/* ==========================================================================
 * 5. 入口
 * ========================================================================== */

/**
 * 把某个兵种画进 `pb`（**不含描边、不含归一化** —— 那两步在 `buildB0Frame`）。
 *
 * @param kind `map` 用同一套形状按更小的 `u` 画（地图图标只要认得出体形档；
 *             兵牌的辨识度由 `cu_*` 负责，见 §15.2 的分工）。
 * @returns 是否画了（false = 这个 id 不归本模块管，调用方继续走旧树）。
 */
export function drawBodyPlanUnit(
  pb: PixBuf,
  unit: string,
  kind: 'map' | 'idle' | 'atk',
): boolean {
  const plan = BODY_PLAN[unit];
  if (!plan) return false;
  // `u` = 1 个 H_REF 单位的像素数 = 画布高 ÷ 1.54（天使触顶），再按「最高的那个兵
  // 也要留出 2px 描边余量」压一次 —— 只影响**归一化之前**的绘制尺寸，
  // 两轴同倍 ⇒ 宽高比不变，归一化之后一律回到目标高。
  const u = Math.min(pb.h / H_REF_HUGE, (pb.h - 4) / plan.h);
  const h = plan.h * u;
  const base = pb.h - 3;
  const cx = pb.w / 2;
  const atk = kind === 'atk';
  // 地图帧不画脸：那一步只负责**剪影**（§15.2 的分工），而 52×44 画布上归一化后
  // 只剩 20~24px 高，2×2 的眼块会占掉脑袋宽度的 2/3 —— 22px 下读成一条黑杠。
  // 兵牌（cu_* / cu_*_atk）必须画，`audit:expr` 认的就是它们。
  const face = kind !== 'map';
  switch (unit) {
    case 'p1_child':
      drawChild(pb, cx, base, h, atk, face);
      break;
    case 'p1_crossbow':
      drawCrossbow(pb, cx, base, h, atk, face);
      break;
    case 'p1_eagle':
      drawEagle(pb, cx, base, h, atk, face);
      break;
    case 'p1_knight':
      drawKnight(pb, cx, base, h, atk, face);
      break;
    case 'p1_angel':
      drawAngel(pb, cx, base, h, atk, face);
      break;
    case 'p2_matchman':
      drawMatchman(pb, cx, base, h, atk, face);
      break;
    case 'p2_bronze':
      drawBronze(pb, cx, base, h, atk, face);
      break;
    case 'p2_lavagiant':
      drawLavaGiant(pb, cx, base, h, atk, face);
      break;
    case 'p2_threewolf':
      drawThreeWolf(pb, cx, base, h, atk, face);
      break;
    case 'p2_devil':
      drawDevil(pb, cx, base, h, atk, face);
      break;
    default:
      return false;
  }
  return true;
}

/** 供门控/审计读：某兵种的**目标剪影高**（像素，含 1px 描边，口径 = 成品帧 bbox 高）。 */
export function bodyPlanTargetHeight(unit: string, canvasH: number): number | null {
  const plan = BODY_PLAN[unit];
  if (!plan) return null;
  return Math.round((plan.h / H_REF_HUGE) * canvasH);
}

/** 供门控读：一条可打印的档位清单（不要在各处各写一份中文档名）。 */
export const BODY_CLASS_LABEL: Record<BodyClass, string> = {
  short: '矮',
  mid: '中',
  tall: '高',
  wide: '宽体',
  huge: '巨物·飞行',
};
