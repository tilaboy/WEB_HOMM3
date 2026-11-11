/**
 * 战斗场景渲染器。
 *
 * 做法：先在"基准分辨率"的离屏画布上按 1:1 画完（所有像素都落在整数上），
 * 再整体按整数倍放大到屏幕画布。这样放大后是硬边像素，而不是糊成一团的插值。
 */
import type { BattleState, BattleUnit } from '../core/combat/battle.js';
import { getUnit } from '../core/data/units.js';
import { FIELD_H, FIELD_PX_H, FIELD_PX_W, FIELD_W, HEX_STEP_Y, hexCenter, hexKey, type Hex } from '../core/combat/hex.js';
import { MOAT_COL, WALL_COL, type SiegeStructure } from '../core/combat/siege.js';
import { hash2 } from './pixel.js';
import { getCombatAtlas } from './combatAtlas.js';
import type { CombatAtlas } from './combatAtlas.js';
import { quality } from './quality.js';
import { unitCombatFrame } from './unitFrames.js';

const PAD = 6;
export { PAD };
/**
 * 战场离屏画布 = **几何战场 + 四周 PAD**。
 * 2026-10-31 E1：R 22→17.5 后战场从 591×376 收到 469.8×297.5，这里跟着收到 482×310。
 * **不要再写死数字** —— 写死的那一版在缩格后会多出 120px 空白，
 * 而 `fit()` 是"按画布宽高填满容器"的，多出来的空白会直接变成黑边。
 */
export const BASE_W = Math.round(FIELD_PX_W) + PAD * 2;
export const BASE_H = Math.round(FIELD_PX_H) + PAD * 2;

/**
 * 城墙的厚度与段高（世界 px）。
 * `WALL_T = 13` 是一格的 ~40%：城墙是一道立面，不该和整格一样厚。
 * `WALL_STEP = HEX_STEP_Y / 2` 让每段顶满上下两格交界，相邻段之间不留缝。
 */
const WALL_T = 13;
const WALL_HALF = WALL_T / 2;
const WALL_STEP = HEX_STEP_Y / 2;

/** H5 ① idle 浮动三帧（px）：0 / -1 / -2 循环，600ms 一轮（圣经 §4 H5）。 */
const IDLE_BOB = [0, -1, -2] as const;

export interface FloatText {
  text: string;
  x: number;
  y: number;
  life: number;
  color: string;
}

/**
 * 战斗演出模板（§11.2 的六类里，本批实现的是"能力"用到的那五类）。
 *
 * **为什么要有 `kind` 而不是只换颜色**：12 个法术里有 10 个原本长得一模一样
 * （都是一个扩张圆环），玩家分不出"这是火球还是冰箭"，更分不出
 * "我被吸血了"和"我被缠住了"。形状是唯一读得懂的线索，颜色只是第二线索。
 */
export type BattleFxKind =
  | 'ring' // 缺省：扩张圆环（法术 / 缠根）
  | 'drain' // 吸血：粒子从受害者流向攻方
  | 'revive' // 复活：金色光柱 + 上浮颗粒
  | 'dread' // 威压：暗环**下沉** + 碎屑下落
  | 'lava' // 熔岩护甲：四道外溅火星
  | 'flame' // 烈焰缠身：三簇上窜火舌
  | 'oath' // 誓约：目标头顶一道护罩弧
  | 'fly'; // 起落：地面两道尘环

export interface BattleFx {
  hex: Hex;
  life: number;
  color: string;
  splash?: boolean;
  kind?: BattleFxKind;
  /** `drain` 的终点（攻方所在格）：粒子从 `hex` 流向它。 */
  to?: Hex;
}

export interface BattleDraw {
  battle: BattleState;
  activeId: string | null;
  reachable: Set<string> | null;
  attackable: Set<string> | null;
  hover: Hex | null;
  posOverride: Record<string, { x: number; y: number }>;
  /** 攻击前冲表演（位移 + H5 squash&stretch 缩放；命中后缩放反向）。 */
  lunge: { unitId: string; dx: number; dy: number; sx?: number; sy?: number } | null;
  arrow: { x: number; y: number; tx: number; ty: number; color?: string } | null;
  floats: FloatText[];
  /** 施法目标格高亮（选了法术后点目标时用）。 */
  spellTargets?: Set<string> | null;
  /** 施法/能力特效。`life` 从 1 衰减到 0，`kind` 决定画什么（见 `BattleFxKind`）。 */
  spellFx?: BattleFx[];
  /** 闪电：从目标头顶劈下来（p: 剩余生命 1 → 0）。 */
  bolt?: { x: number; y: number; p: number } | null;
  /** 近战打击特效（p: 0 → 1 播放进度）。`unitId` = 受击方，供 H5 受击位移用。 */
  impacts?: { x: number; y: number; kind: 'thrust' | 'slash' | 'smash'; p: number; unitId?: string }[];
  time: number;
}

export class BattleRenderer {
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private atlas: CombatAtlas;
  /** 缺帧告警去重：`drawUnit` 每帧都会被调，不去重会刷满控制台。 */
  private readonly missingSpriteWarned = new Set<string>();
  /** 每帧各部队精灵的**实际落笔矩形**（整数屏幕坐标，drawUnit 算完就记）。
   *  TP-5 探针（tools/probes/tp5-animframes.mjs）用它做两件事：
   *  ① 两帧间"理应发生的位移"直接取矩形差 —— 精确到像素，不用建模（lunge 的
   *     dx/dy 是 k 插值小数、squash 还有锚点补偿，建模必漏项，踩过）；
   *  ② 场景安静闸：别的部队矩形逐一相等 ⇒ 它们的 bob/受击抖动/移动全都没动
   *     （这些是**绘制期**偏移，不在任何场景状态里，只查 fx/fy 查不出来，踩过）。 */
  readonly lastBlit = new Map<string, { x: number; y: number; w: number; h: number }>();
  /** 每帧各部队**实际 blit 的图集帧**（name = 选中的帧名，x/y/w/h = 图集里的矩形）。
   *  TP-5 探针用它做三件事：
   *  ① 换帧实证：攻击演出期 name 必须是 `cu_<id>_atk`（帧烘焙了但渲染器从不 blit
   *     就是这个项目 TP-5 之前的真实状态，光看画面像素分不清"换了帧"和"位移更大"）；
   *  ② squash 实证：落笔矩形 w/h 与这里的自然 w/h 之差就是缩放系数（1.15/0.85 ⇒
   *     74×48 / 54×64），差 0 = 缩放没生效；
   *  ③ 屏幕=图集实证：拿这个矩形去图集里裁出那一帧，和离屏画布同位置逐像素比
   *     （imageSmoothingEnabled=false ⇒ 最近邻缩放是精确拷贝，容差 0）。
   *  ⚠️ 与 lastBlit 同在 drawUnit 里、同一处维护；缺帧早退时两个都 delete。 */
  readonly lastFrame = new Map<string, { name: string; x: number; y: number; w: number; h: number }>();
  scale = 2;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建战斗画布');
    this.ctx = ctx;
    this.off = document.createElement('canvas');
    this.off.width = BASE_W;
    this.off.height = BASE_H;
    const o = this.off.getContext('2d');
    if (!o) throw new Error('无法创建战斗离屏画布');
    this.offCtx = o;
    this.atlas = getCombatAtlas();
  }

  /** 调试探针专用：离屏画布（BASE_W×BASE_H 场像素，1px = 1 场单位，无缩放无 DPR）。
   *  TP-5 探针（tools/probes/tp5-animframes.mjs）读它而不是整页截图：截图要走
   *  合成器，本机每张 2.5~15s，520ms 的攻击演出会被系统性漏掉（实测零 lunge
   *  片段——不是动画没做，是采样节奏永远错过它）。离屏画布 toDataURL 是纯 JS
   *  操作，且和 __battleScene 钩子同帧同源，天然对齐。 */
  get offscreen(): HTMLCanvasElement {
    return this.off;
  }

  /** 调试探针专用：战斗图集画布（含 alpha）。TP-5 探针拿它裁出 lastFrame 指向的帧，
   *  与离屏画布同位置逐像素比对（"屏幕上这块就是图集里这一帧"的零容差实证）。 */
  get atlasCanvas(): HTMLCanvasElement {
    return this.atlas.canvas;
  }

  /**
   * 按容器可用空间决定放大倍数。
   * 优先取整数倍（像素最整齐）；差一点放不下整数倍时才退回小数倍，
   * 否则 600px 宽的战场在大屏幕上会小得可怜。
   * 同时乘上 devicePixelRatio，让逻辑像素对齐物理像素。
   */
  fit(availW: number, availH: number): void {    // §5.3：套上画质 DPR 上限；本渲染器已支持小数倍缩放，只需钳制即可
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), quality.dprCap);
    const raw = Math.min(availW / BASE_W, availH / BASE_H);
    /**
     * 下限从 **0.6 → 0.35**（2026-10-21 真机走查修的 bug）。
     *
     * 旧下限在 792×360 的手机上会算出 `min(0.505, …)` 后**硬抬到 0.6** ⇒ 画布 362×233，
     * 比 body（196）高 37px ⇒ 溢出容器、还压住顶栏 18px（实测 `canvas.y=68 < body.y=86`）。
     * 下限的本意只是"别缩到看不见"，0.35 足够；真正的保底交给上面的 `availH`。
     */
    let s = Math.min(4, Math.max(0.35, raw));
    const fl = Math.floor(s);
    if (fl >= 1 && s / fl <= 1.12) s = fl;
    this.scale = s;
    this.canvas.width = Math.round(BASE_W * s * dpr);
    this.canvas.height = Math.round(BASE_H * s * dpr);
    /**
     * CSS 尺寸**由 backing store 反算**，不许两边各自 `Math.round`。
     *
     * 两边各自取整时，只有 `round(W·s·dpr) == dpr·round(W·s)` 才碰巧对齐；
     * 旧 BASE_W=603 在 s=0.5 / 1.5 两档比值差 3‰ / 1‰ ⇒ 浏览器把整屏重采样一遍，
     * 比 1.2 的非整数缩放还糊（§13.1 第 2 条，这是本次 E1 顺带修掉的真 bug）。
     */
    this.canvas.style.width = `${this.canvas.width / dpr}px`;
    this.canvas.style.height = `${this.canvas.height / dpr}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  draw(d: BattleDraw): void {
    const g = this.offCtx;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, BASE_W, BASE_H);

    // 背景：战场外的深色土地
    g.fillStyle = '#2a2417';
    g.fillRect(0, 0, BASE_W, BASE_H);
    g.fillStyle = '#3b321f';
    g.fillRect(PAD - 3, PAD - 3, BASE_W - (PAD - 3) * 2, BASE_H - (PAD - 3) * 2);

    this.drawFloor(g);
    this.drawSiege(g, d);
    this.drawHighlights(g, d);
    this.drawUnits(g, d);
    // 器械画在最后：它不是单位，但必须永远可见，不能被部队盖住
    this.drawWarMachines(g, d);

    if (d.arrow) {
      g.fillStyle = d.arrow.color ?? '#f4e7c0';
      const a = d.arrow;
      for (let i = 0; i < 4; i++) {
        g.fillRect(Math.round(a.x - (a.tx - a.x) * 0.02 * i), Math.round(a.y - (a.ty - a.y) * 0.02 * i), 2, 2);
      }
    }

    if (d.bolt) this.drawBolt(g, d.bolt);
    for (const im of d.impacts ?? []) this.drawImpact(g, im);

    for (const f of d.floats) this.drawFloat(g, f);
    for (const fx of d.spellFx ?? []) this.drawSpellFx(g, fx);

    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.off, 0, 0, BASE_W, BASE_H, 0, 0, this.canvas.width, this.canvas.height);
  }

  /** 闪电：主干 + 两道分叉，命中点闪白。 */
  private drawBolt(g: CanvasRenderingContext2D, b: { x: number; y: number; p: number }): void {
    const x = b.x + PAD;
    const y = b.y + PAD;
    const a = Math.max(0, Math.min(1, b.p));
    const segs: [number, number][] = [
      [0, -46],
      [-5, -34],
      [4, -22],
      [-3, -10],
      [0, 0],
    ];
    g.globalAlpha = a;
    for (const [w, color] of [
      [3, '#f4f0ff'],
      [1, '#8fb8ff'],
    ] as const) {
      g.strokeStyle = color;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x + segs[0][0], y + segs[0][1]);
      for (let i = 1; i < segs.length; i++) g.lineTo(x + segs[i][0], y + segs[i][1]);
      g.stroke();
    }
    if (a > 0.5) {
      g.globalAlpha = (a - 0.5) * 1.6;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(x, y, 5 + (1 - a) * 8, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  /** 近战打击特效：突刺 = 十字星，挥砍 = 弧光，重砸 = 扩散尘环 + 碎屑。 */
  private drawImpact(
    g: CanvasRenderingContext2D,
    im: { x: number; y: number; kind: 'thrust' | 'slash' | 'smash'; p: number },
  ): void {
    const x = im.x + PAD;
    const y = im.y + PAD;
    const p = Math.max(0, Math.min(1, im.p));
    const a = 1 - p;
    g.globalAlpha = a;
    if (im.kind === 'thrust') {
      // 十字星：命中瞬间的白光
      const r = 2 + p * 7;
      g.strokeStyle = '#fff6d8';
      g.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) {
        const ang = (Math.PI / 2) * i + 0.4;
        g.beginPath();
        g.moveTo(x + Math.cos(ang) * 2, y + Math.sin(ang) * 2);
        g.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
        g.stroke();
      }
    } else if (im.kind === 'slash') {
      // 弧光：一道扫过的月牙
      g.strokeStyle = '#ffe9b0';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 9 + p * 4, -0.9 + p * 1.2, 0.7 + p * 1.2);
      g.stroke();
    } else {
      // 重砸：扩散的尘环 + 四溅的碎屑
      g.strokeStyle = 'rgba(210, 180, 130, 0.9)';
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(x, y + 8, 4 + p * 14, 2 + p * 5, 0, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#c9a86a';
      for (let i = 0; i < 4; i++) {
        const ang = -Math.PI + (Math.PI / 3) * i;
        const d = p * 13;
        g.fillRect(Math.round(x + Math.cos(ang) * d), Math.round(y + 6 + Math.sin(ang) * d * 0.5 - p * 4), 2, 2);
      }
    }
    g.globalAlpha = 1;
  }

  private drawFloor(g: CanvasRenderingContext2D): void {
    for (let row = 0; row < FIELD_H; row++) {
      for (let col = 0; col < FIELD_W; col++) {
        const v = Math.floor(hash2(col, row, 4242) * 4);
        this.blit(g, `cf_${v}`, col, row);
      }
    }
  }

  /* ---------------- 攻城：城墙 / 城门 / 角塔 / 主楼 ---------------- */

  private drawSiege(g: CanvasRenderingContext2D, d: BattleDraw): void {
    const siege = d.battle.siege;
    if (!siege) return;
    this.drawMoat(g);
    const alive = siege.structures.filter((st) => st.hp > 0);

    // ① 主楼：在城内，先画（它不占城墙列，砸塌它不会开出通路）
    for (const st of alive) {
      if (st.kind !== 'keep') continue;
      const c = hexCenter(st.hex);
      const x = Math.round(c.x + PAD);
      const y = Math.round(c.y + PAD);
      this.drawKeepSeg(g, x, y, st.hp / st.maxHp);
      this.drawStructureHp(g, x, y, st.hp / st.maxHp, 22, 24);
    }

    // ② 城墙列：**整条连续墙体一次画完**，再让城门 / 角塔压在它上面。
    //    逐段各画一块的做法会把相邻段的描边叠成一道缝，整列读成"一排墓碑"
    //    （用户 2026-10-28 的原话）。而且墙厚 34 ≈ 一格宽，看着像一堵石头堤坝，不像城墙。
    this.drawWallRuns(g, alive);

    // ③ 城门与角塔：都比墙厚、都比墙高，剪影上必须能一眼认出"这里是个建筑"
    for (const st of alive) {
      if (st.kind !== 'gate' && st.kind !== 'tower') continue;
      const c = hexCenter(st.hex);
      const x = this.wallColumnX();
      const y = Math.round(c.y + PAD);
      if (st.kind === 'gate') this.drawGateSeg(g, x, y, st.hp / st.maxHp);
      else this.drawTowerSeg(g, x, y, st.hp / st.maxHp);
      // 血条压在建筑**脚下**：挂在塔身中段会读成一道绿色横梁
      this.drawStructureHp(g, x, y, st.hp / st.maxHp, 20, 27);
    }
  }

  /**
   * 城墙：整列画成**一条连续、竖直、13px 厚的墙**。
   *
   * 为什么不再逐格画块（2026-10-28 用户拍板）：
   *   1. 逐段各画一块会把相邻段的描边叠成缝，整列读成"一排墓碑"；
   *   2. 墙厚 34 ≈ 一格宽，看着像石头堤坝 —— 城墙是立面，不该和整格一样厚。
   *
   * 为什么墙**不跟着格心走**：本作是 pointy-top + odd-r，同一列的奇偶行中心相差 19px
   * （比墙厚 13 还大）。跟着格心画会得到一条"错位台阶"，在 13px 厚度下必然裂开。
   * 取两行的中点当墙线，墙就是直的；反正城墙列没有任何部队会站上去。
   */
  private drawWallRuns(g: CanvasRenderingContext2D, alive: SiegeStructure[]): void {
    const walls = alive
      .filter((st) => st.kind === 'wall' && st.hex.col === WALL_COL)
      .sort((a, b) => a.hex.row - b.hex.row);
    if (!walls.length) return;
    const wallX = this.wallColumnX();

    const runs: SiegeStructure[][] = [];
    for (const st of walls) {
      const last = runs[runs.length - 1];
      if (last && st.hex.row === last[last.length - 1].hex.row + 1) last.push(st);
      else runs.push([st]);
    }

    for (const run of runs) {
      const nodes = run.map((st) => {
        const c = hexCenter(st.hex);
        return { y: Math.round(c.y + PAD), ratio: st.hp / st.maxHp, row: st.hex.row };
      });
      const yTop = nodes[0].y - WALL_STEP;
      const yBot = nodes[nodes.length - 1].y + WALL_STEP;
      const h = yBot - yTop;
      const l = wallX - WALL_HALF;

      // ① 一圈外描边 + 石面（一次成型，内部没有任何接缝）
      g.fillStyle = '#38332b';
      g.fillRect(l - 1, yTop - 1, WALL_T + 2, h + 2);
      g.fillStyle = '#8a8477';
      g.fillRect(l, yTop, WALL_T, h);
      // 左亮右暗：立面有一点体积，但不要做成圆柱
      g.fillStyle = '#9b9585';
      g.fillRect(l + 1, yTop, 3, h);
      g.fillStyle = '#6e695d';
      g.fillRect(l + WALL_T - 4, yTop, 4, h);

      // ② 砌块：11px 一层（7px 太密，会让整条墙读成梯子），错缝 + 每层轻微的色差
      g.fillStyle = '#767163';
      for (let yy = yTop + 10; yy < yBot - 1; yy += 11) g.fillRect(l, yy, WALL_T, 1);
      for (const n of nodes) {
        g.fillStyle = n.row % 2 === 0 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
        g.fillRect(l, n.y - WALL_STEP, WALL_T, WALL_STEP * 2);
        g.fillStyle = '#6f6a5c';
        const jx = l + 4 + (n.row % 2 === 0 ? 0 : 3);
        g.fillRect(jx, n.y - WALL_STEP + 1, 1, WALL_STEP * 2 - 2);
      }

      // ③ 攻方一侧的垛口：每 9px 一颗，凸出墙外 3px —— "墙"最容易被认出来的齿
      for (let yy = yTop + 2; yy < yBot - 5; yy += 9) {
        g.fillStyle = '#8f8a7c';
        g.fillRect(l - 3, yy, 3, 6);
        g.fillStyle = '#b8b2a0';
        g.fillRect(l - 3, yy, 3, 1);
      }

      // ④ 顶沿雉堞 + 墙脚阴影（让墙"站"在地上，而不是浮着）
      g.fillStyle = '#7d786b';
      for (let i = 0; i < 3; i++) g.fillRect(l - 1 + i * 5, yTop - 4, 4, 5);
      g.fillStyle = 'rgba(0,0,0,0.32)';
      g.fillRect(l - 1, yBot, WALL_T + 2, 2);

      // ⑤ 受损：缺失的石块自上而下啃掉，并在**只有掉血时**画血条
      for (const n of nodes) {
        if (n.ratio >= 0.999) continue;
        const ruin = 1 - n.ratio;
        g.fillStyle = '#3f3b33';
        const bite = Math.min(WALL_STEP * 2 - 4, Math.round(ruin * WALL_STEP * 2));
        g.fillRect(l, n.y - WALL_STEP, WALL_T, bite);
        this.drawStructureHp(g, wallX, n.y, n.ratio, 18);
      }
    }
  }

  /** 城墙列的世界 x：取该列奇偶两行格心的中点（见 `drawWallRuns` 的说明）。 */
  private wallColumnX(): number {
    const a = hexCenter({ col: WALL_COL, row: 0 }).x;
    const b = hexCenter({ col: WALL_COL, row: 1 }).x;
    return Math.round((a + b) / 2 + PAD);
  }

  /**
   * 攻城器械：不是战场单位，所以画在攻方部署区的最外一列，
   * 用一个小底座 + 器械本体表示"它在，而且每回合都在开火"。
   * 守方有器械就画在城内右下角。
   */
  private drawWarMachines(g: CanvasRenderingContext2D, d: BattleDraw): void {
    const machines = d.battle.machines;
    if (!machines) return;
    // 摆在部署列的两个角上：deploy() 把部队铺在第 1 ~ FIELD_H-2 行之间，
    // 上下两个角格专属于攻城器械，永远不会被己方部队盖住。
    const spotsL: [number, number][] = [
      [0, 0],
      [0, FIELD_H - 1],
    ];
    const spotsR: [number, number][] = [
      [FIELD_W - 1, 0],
      [FIELD_W - 1, FIELD_H - 1],
    ];
    const draw = (id: string, c: number, r: number, flip: boolean) => {
      const cc = hexCenter({ col: c, row: r });
      const x = Math.round(cc.x + PAD);
      const y = Math.round(cc.y + PAD);
      const dir = flip ? -1 : 1;
      if (id === 'catapult') {
        // 投石车：木架 + 抛臂 + 石弹
        g.fillStyle = '#3a2a18';
        g.fillRect(x - 13, y + 10, 26, 5);
        g.fillStyle = '#6b4a26';
        g.fillRect(x - 11, y - 2, 22, 12);
        g.fillStyle = '#8a6234';
        g.fillRect(x - 11, y - 2, 22, 3);
        g.strokeStyle = '#4a3524';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x - dir * 9, y - 2);
        g.lineTo(x + dir * 5, y - 17);
        g.stroke();
        g.fillStyle = '#5c5c5c';
        g.beginPath();
        g.arc(x + dir * 6, y - 19, 5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#7d7d7d';
        g.beginPath();
        g.arc(x + dir * 4 - 1, y - 21, 2, 0, Math.PI * 2);
        g.fill();
      } else {
        // 弩车：底座 + 大弩 + 弦
        g.fillStyle = '#3a2a18';
        g.fillRect(x - 12, y + 10, 24, 5);
        g.fillStyle = '#6b4a26';
        g.fillRect(x - 10, y + 2, 20, 9);
        g.fillStyle = '#5a3d20';
        g.fillRect(x - dir * 2, y - 12, dir * 16, 4);
        g.strokeStyle = '#d8d2c4';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x + dir * 12, y - 14);
        g.lineTo(x - dir * 2, y - 8);
        g.lineTo(x + dir * 12, y - 2);
        g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x - 13, y + 16, 26, 2);
    };
    machines[0].forEach((id, i) => {
      const s = spotsL[i];
      if (s) draw(id, s[0], s[1], false);
    });
    machines[1].forEach((id, i) => {
      const s = spotsR[i];
      if (s) draw(id, s[0], s[1], true);
    });
  }

  /** 护城河：贴着城墙外侧的那条窄水。站进去的攻方防御 -2，画面上得让人看得见。 */
  private drawMoat(g: CanvasRenderingContext2D): void {
    g.fillStyle = 'rgba(38,86,124,0.55)';
    for (let row = 0; row < FIELD_H; row++) {
      const c = hexCenter({ col: MOAT_COL, row });
      const cx = c.x + PAD;
      const cy = c.y + PAD;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 180 * (60 * i - 30);
        const px = cx + Math.cos(a) * 19;
        const py = cy + Math.sin(a) * 19;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
    }
  }

  /** 城门：比墙厚一圈的门楼 + 拱顶 + 包铁双扇门（它是墙上唯一的"建筑"，不是一段墙）。 */
  private drawGateSeg(g: CanvasRenderingContext2D, x: number, y: number, ratio: number): void {
    const w = 27;
    const h = 50;
    const l = x - w / 2;
    const t = y - h / 2;

    // 门楼主体：左右各比墙宽 7px，上沿比墙顶高 8px
    g.fillStyle = '#38332b';
    g.fillRect(l - 1, t - 1, w + 2, h + 3);
    g.fillStyle = '#6f6a5e';
    g.fillRect(l, t, w, h);
    g.fillStyle = '#7d7869';
    g.fillRect(l + 2, t + 2, w - 6, h - 4);

    // 拱门洞（上圆下方）
    const ax = x;
    const ay = t + 13;
    const ah = h - 16;
    g.fillStyle = '#241a10';
    g.beginPath();
    g.moveTo(ax - 8, ay + ah);
    g.lineTo(ax - 8, ay + 4);
    g.quadraticCurveTo(ax, ay - 8, ax + 8, ay + 4);
    g.lineTo(ax + 8, ay + ah);
    g.closePath();
    g.fill();

    // 双扇木门：血量越低，门板越矮（门是被砸穿的）
    const doorH = Math.max(4, Math.round(ah * ratio));
    g.fillStyle = '#6b4a2f';
    g.fillRect(ax - 7, ay + ah - doorH, 6, doorH);
    g.fillRect(ax + 1, ay + ah - doorH, 6, doorH);
    g.fillStyle = '#3d3a33';
    for (let i = 1; i < 4; i++) {
      const by = ay + ah - doorH + i * 7;
      if (by < ay + ah - 1) {
        g.fillRect(ax - 7, by, 6, 1);
        g.fillRect(ax + 1, by, 6, 1);
      }
    }

    // 门楣石 + 两侧墩柱 + 顶沿雉堞
    g.fillStyle = '#5d594e';
    g.fillRect(l, t + 4, w, 3);
    g.fillRect(l - 2, t + 8, 4, h - 8);
    g.fillRect(l + w - 2, t + 8, 4, h - 8);
    g.fillStyle = '#8f8a7c';
    for (let i = 0; i < 4; i++) g.fillRect(l + 1 + i * 7, t - 4, 5, 5);
  }

  /** 箭塔：比墙更宽更高（h 50 vs 墙 13 厚），塔身带箭孔，顶上一面旗。 */
  private drawTowerSeg(g: CanvasRenderingContext2D, x: number, y: number, ratio: number): void {
    const w = 22;
    const h = 50;
    const l = x - w / 2;
    const t = y - h / 2;
    // 塔基压住墙带：左右各比墙宽 4.5px，上沿比墙顶高 10px
    g.fillStyle = '#38332b';
    g.fillRect(l - 1, t - 1, w + 2, h + 2);
    g.fillStyle = '#8a8578';
    g.fillRect(l, t, w, h);
    g.fillStyle = '#a09a8a';
    g.fillRect(l + 2, t + 2, w - 7, h - 4);
    g.fillStyle = '#6a6559';
    g.fillRect(l + w - 5, t + 2, 5, h - 4);
    // 石缝
    g.fillStyle = '#736e62';
    for (let r = t + 7; r < t + h - 2; r += 7) g.fillRect(l + 2, r, w - 4, 1);
    // 箭孔（朝攻方，即左侧）：两个竖缝
    g.fillStyle = '#22190f';
    g.fillRect(l + 3, t + 14, 3, 8);
    g.fillRect(l + 3, t + 30, 3, 8);
    // 出檐：比塔身每侧宽 3px，把"塔"从"墙"的剪影里切出来
    g.fillStyle = '#5d594e';
    g.fillRect(l - 3, t - 4, w + 6, 4);
    // 顶沿雉堞 3 颗
    g.fillStyle = '#8f8a7c';
    for (let i = 0; i < 3; i++) g.fillRect(l + 1 + i * 7, t - 9, 5, 6);
    // 旗：全城最高的红点，血量过半才展开
    g.fillStyle = '#5a4326';
    g.fillRect(x + 6, t - 19, 1, 12);
    g.fillStyle = ratio > 0.5 ? '#c0392b' : '#6b4238';
    if (ratio > 0.5) {
      g.beginPath();
      g.moveTo(x + 7, t - 19);
      g.lineTo(x + 18, t - 15);
      g.lineTo(x + 7, t - 11);
      g.closePath();
      g.fill();
    } else {
      g.fillRect(x + 7, t - 14, 9, 2);
    }
  }

  /**
   * 主楼：城内那座高塔。它不占城墙列，所以砸塌它不会开出通路，
   * 但它是火力最猛的射手 —— 画得比角塔更高更宽，让人一眼看出该先打谁。
   */
  private drawKeepSeg(g: CanvasRenderingContext2D, x: number, y: number, ratio: number): void {
    const w = 40;
    const h = 54;
    const l = x - w / 2;
    const t = y - h / 2 - 8;
    g.fillStyle = '#3a362e';
    g.fillRect(l - 2, t - 2, w + 4, h + 10);
    g.fillStyle = '#7f7a6c';
    g.fillRect(l, t, w, h);
    g.fillStyle = '#968f7f';
    g.fillRect(l + 3, t + 3, w - 12, h - 6);
    g.fillStyle = '#635e53';
    g.fillRect(l + w - 9, t + 3, 9, h - 6);
    // 石缝
    g.fillStyle = '#6d6859';
    for (let r = t + 9; r < t + h - 3; r += 9) g.fillRect(l + 3, r, w - 6, 1);
    // 高窗：两排，朝攻方一侧开
    g.fillStyle = '#1d1610';
    g.fillRect(l + 5, t + 14, 6, 10);
    g.fillRect(l + 5, t + 32, 6, 10);
    g.fillRect(l + w - 22, t + 14, 6, 10);
    g.fillRect(l + w - 22, t + 32, 6, 10);
    // 垛口
    g.fillStyle = '#5d594e';
    for (let i = 0; i < 5; i++) g.fillRect(l + 3 + i * 8, t - 6, 6, 6);
    // 塔尖的旗：血少了旗就垂下
    g.fillStyle = '#5a4326';
    g.fillRect(x, t - 30, 2, 24);
    g.fillStyle = ratio > 0.5 ? '#c0392b' : '#6b4238';
    if (ratio > 0.5) {
      g.beginPath();
      g.moveTo(x + 2, t - 30);
      g.lineTo(x + 19, t - 25);
      g.lineTo(x + 2, t - 20);
      g.closePath();
      g.fill();
    } else {
      g.fillRect(x + 2, t - 22, 12, 3);
    }
  }

  /** 结构血条：画在格子底部，一眼看出还剩多少。墙段只在受损时调用（满血绿条会读成青苔）。 */
  private drawStructureHp(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    ratio: number,
    w = 26,
    dy = 16,
  ): void {
    const bx = Math.round(x - w / 2);
    const by = Math.round(y + dy);
    g.fillStyle = 'rgba(16,12,8,0.72)';
    g.fillRect(bx - 1, by - 1, w + 2, 4);
    g.fillStyle = ratio > 0.5 ? '#9ad06a' : ratio > 0.22 ? '#e8c35a' : '#e0664a';
    g.fillRect(bx, by, Math.max(1, Math.round(w * ratio)), 2);
  }

  private drawHighlights(g: CanvasRenderingContext2D, d: BattleDraw): void {
    if (d.reachable) {
      for (const k of d.reachable) {
        const [c, r] = k.split(',').map(Number);
        this.blit(g, 'chi_move', c, r);
      }
    }
    if (d.attackable) {
      for (const k of d.attackable) {
        const [c, r] = k.split(',').map(Number);
        this.blit(g, 'chi_atk', c, r);
      }
    }
    if (d.hover) this.blit(g, 'chi_hover', d.hover.col, d.hover.row);
    if (d.spellTargets) {
      for (const k of d.spellTargets) {
        const [c, r] = k.split(',').map(Number);
        this.blit(g, 'chi_spell', c, r);
      }
    }

    const active = d.activeId ? d.battle.units.find((u) => u.id === d.activeId) : null;
    if (active && active.count > 0) {
      const pulse = 0.55 + 0.45 * Math.sin(d.time / 260);
      g.globalAlpha = 0.45 + 0.35 * pulse;
      this.blit(g, 'chi_sel', active.hex.col, active.hex.row);
      g.globalAlpha = 1;
    }
  }

  private drawUnits(g: CanvasRenderingContext2D, d: BattleDraw): void {
    const list = d.battle.units
      .filter((u) => u.count > 0)
      .slice()
      .sort((a, b) => a.hex.row - b.hex.row || a.hex.col - b.hex.col);

    for (const u of list) this.drawUnit(g, d, u);
  }

  private drawUnit(g: CanvasRenderingContext2D, d: BattleDraw, u: BattleUnit): void {
    const c = hexCenter(u.hex);
    const ov = d.posOverride[u.id];
    let cx = (ov ? ov.x : c.x) + PAD;
    let cy = (ov ? ov.y : c.y) + PAD;
    // H5 ① idle 浮动：0 / -1 / -2px 三帧循环（600ms，圣经 §4 H5）。
    // 相位按格子哈希错开——否则整屏部队同呼吸，一眼假。
    // posOverride（移动演出）期间不加：那会儿坐标是动画权威，叠浮动会抖。
    // ⚠️ hash2 返回 [0,1) 小数，必须先 ×3 取整再当索引用——
    //   直接 `IDLE_BOB[小数]` = undefined，`cy += undefined` = NaN，
    //   而 canvas 对 NaN 坐标是**静默不画**（单位全体隐形、零报错）。踩过，别再犯。
    if (!ov) {
      const off = Math.floor(hash2(u.hex.col, u.hex.row, 91) * IDLE_BOB.length);
      const ph = ((Math.floor(d.time / 200) + off) % IDLE_BOB.length + IDLE_BOB.length) % IDLE_BOB.length;
      cy += IDLE_BOB[ph];
    }
    // NaN 防线：canvas 对 NaN 坐标**静默不画**（单位隐形且零报错——TP-5 真踩过）。
    // 宁可画在错位置 + 留一条 warn，也不许静默消失。
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
      const tag = `pos:${u.id}`;
      if (!this.missingSpriteWarned.has(tag)) {
        this.missingSpriteWarned.add(tag);
        console.warn(`[战斗精灵] ${u.id}(${u.unitTypeId}) 屏幕坐标非有限（cx=${cx} cy=${cy}）→ 已回退到格子中心。查动画侧 posOverride/lunge 的数值来源。`);
      }
      cx = c.x + PAD;
      cy = c.y + PAD;
    }

    const team = this.atlas.need(`cbase_${u.side}`);
    g.drawImage(
      this.atlas.canvas,
      team.x, team.y, team.w, team.h,
      Math.round(cx + team.ax), Math.round(cy + team.ay), team.w, team.h,
    );

    const idleName = unitCombatFrame(u.unitTypeId);
    // TP-5①：攻击表演期换 atk 帧（帧早已烘焙、成本已付，此前渲染器从不 blit）。
    // 中性怪（狼/野猪/食人魔）没烘 atk 帧 ⇒ 回退 idle，不影响它们的表现。
    const atkName = `${idleName}_atk`;
    const name = d.lunge && d.lunge.unitId === u.id && this.atlas.has(atkName) ? atkName : idleName;
    // 兜底**保留**（不抛：抛了=开局白屏，比少一张精灵更糟——同 `atlas.ts` `warnOverflow` 的取舍），
    // 但**不许再静默**。背景：四族 T5 曾因图集里没有 `cu_*` 帧、这一行直接 return，战斗中
    // 只剩队伍色底盘圈（无精灵 / 无数量牌 / 无血条），而且**没有任何提示**，谁都没察觉
    // （`PROJECT-WRAPUP.md` §13.2① 记的就是这个后果，只是当时把位置记成了地图侧）。
    // ⇒ 兜底照留，但缺帧必须留下可观测的痕迹。
    if (!this.atlas.has(name)) {
      if (!this.missingSpriteWarned.has(name)) {
        this.missingSpriteWarned.add(name);
        console.warn(
          `[战斗精灵] 图集缺 ${name}（unitTypeId=${u.unitTypeId}）→ 该兵种只画队伍色底盘圈，` +
            `不画本体/数量牌/血条。检查 unitArt.ts 的帧表与 combatAtlas.ts 的烘焙循环。`,
        );
      }
      return;
    }
    this.lastBlit.delete(u.id); // 缺帧没画本体 ⇒ 不留给探针一个过期矩形
    this.lastFrame.delete(u.id);
    const f = this.atlas.need(name);
    this.lastFrame.set(u.id, { name, x: f.x, y: f.y, w: f.w, h: f.h }); // TP-5 探针用（见字段注释）
    const lg = d.lunge && d.lunge.unitId === u.id ? d.lunge : null;
    const ox = lg ? lg.dx : 0;
    const oy = lg ? lg.dy : 0;
    // H5 ③ 受击位移：冲击特效的新鲜期内整图 +2px 右移（圣经"1 帧"按冲击时长
    // 折算成 p<0.3 的可见窗口——rAF 下单帧 16ms 读不出，那等于没做）。
    const jerked = (d.impacts ?? []).some((im) => im.unitId === u.id && im.p < 0.3) ? 2 : 0;
    // H5 ② 攻击 squash & stretch：出击 1.15× 宽 / 0.85× 高，命中帧反过来
    //（BattleScreen 的 meleeAnim 按 hit 状态反号后写进 lunge.sx/sy）。
    const sx = lg?.sx ?? 1;
    const sy = lg?.sy ?? 1;
    const sw = Math.max(1, Math.round(f.w * sx));
    const sh = Math.max(1, Math.round(f.h * sy));
    // 缩放锚点 = 底边中点（脚不离开地面）+ 当前位移；否则拉伸时单位会"飘"
    // （变量名带 s 前缀：本函数后半段还有数量牌的 bx/by，不能撞名）
    const sbx = Math.round(cx + f.ax + ox + jerked + (f.w - sw) / 2);
    const sby = Math.round(cy + f.ay + oy + (f.h - sh));
    this.lastBlit.set(u.id, { x: sbx, y: sby, w: sw, h: sh }); // TP-5 探针用（见字段注释）
    g.drawImage(this.atlas.canvas, f.x, f.y, f.w, f.h, sbx, sby, sw, sh);

    // 数量牌
    const def = getUnit(u.unitTypeId);
    const label = String(u.count);
    g.font = 'bold 11px "Palatino", Georgia, serif';
    const w = Math.max(14, g.measureText(label).width + 8);
    const bx = Math.round(cx - w / 2);
    const by = Math.round(cy + 8);
    g.fillStyle = 'rgba(20,14,8,0.78)';
    g.fillRect(bx, by, w, 13);
    g.fillStyle = u.side === 0 ? '#ffd98a' : '#ff9c8c';
    g.fillRect(bx, by, w, 1);
    g.fillStyle = u.side === 0 ? '#ffeec2' : '#ffd6cf';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, bx + w / 2, by + 7);

    // 队首残血条
    if (u.hpTop < def.hp) {
      const bw = 22;
      const pct = Math.max(0, u.hpTop / def.hp);
      g.fillStyle = 'rgba(10,8,4,0.8)';
      g.fillRect(Math.round(cx - bw / 2) - 1, by + 14, bw + 2, 4);
      g.fillStyle = pct > 0.5 ? '#7ab55a' : pct > 0.25 ? '#d9a13a' : '#d0553f';
      g.fillRect(Math.round(cx - bw / 2), by + 15, Math.round(bw * pct), 2);
    }

    // 远程单位剩余弹药
    if (def.shots !== undefined) {
      g.fillStyle = u.shots > 0 ? '#cfe4ff' : '#8a7f6a';
      for (let i = 0; i < Math.min(6, def.shots ?? 0); i++) {
        if (i >= u.shots) break;
        g.fillRect(Math.round(cx - 12 + i * 4), by - 6, 2, 4);
      }
    }
  }

  private drawFloat(g: CanvasRenderingContext2D, f: FloatText): void {
    const a = Math.max(0, Math.min(1, f.life));
    g.globalAlpha = a;
    g.font = 'bold 13px "Palatino", Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#120c06';
    g.fillText(f.text, f.x + PAD + 1, f.y + PAD + 1);
    g.fillStyle = f.color;
    g.fillText(f.text, f.x + PAD, f.y + PAD);
    g.globalAlpha = 1;
  }

  /**
   * 施法与能力演出。五种形状，**一眼能分开**：
   *   ring（扩张环）/ drain（粒子回流）/ revive（光柱上浮）/ dread（暗环下沉）/ lava·flame·oath（短促脉冲）
   * 全部是 canvas 图元，**0 新图集**（§11.2 的实现口径）。
   */
  private drawSpellFx(g: CanvasRenderingContext2D, fx: BattleFx): void {
    const c = hexCenter(fx.hex);
    const cx = c.x + PAD;
    const cy = c.y + PAD;
    const p = 1 - Math.max(0, Math.min(1, fx.life)); // 0 → 1 进度
    const a = Math.max(0, 1 - p) * 0.9;
    const kind = fx.kind ?? 'ring';

    if (kind === 'drain') {
      // 吸血：血珠从受害者（hex）沿直线飞向攻方（to），越飞越小。
      //
      // ① 珠径 2.2 → 3.0：第一版 2.2px 在 482×310 的战场上只有 1 设备像素，
      //    ×图纸目检时整列"几乎空白"（`#b8324a` 压在土色上本来就不亮）。
      // ② 用**亮芯 + 暗边**两层：暗红单色在棕色地面上读不出来，而换成纯亮红
      //    又会和「熔岩火星」撞色 —— 外层保留 fx.color（族色/主题色），
      //    内层固定高光，形状靠"一串往回飞的珠子"而不是靠色相。
      // ③ 起点相位拉开（0 / 0.34 / 0.68）：第一版三颗挤在起点一起出发，
      //    中途又同时变小 ⇒ 任一时刻只看得见 1~2 个点，读不成"一条流"。
      const to = hexCenter(fx.to ?? fx.hex);
      const tx = to.x + PAD;
      const ty = to.y + PAD;
      g.globalAlpha = Math.max(0, 1 - p * 0.55);
      for (let i = 0; i < 3; i++) {
        const k = Math.max(0, Math.min(1, (p - i * 0.17) * 1.5 + i * 0.05));
        if (k <= 0 || k >= 1) continue;
        const r = 3.0 - k * 1.4;
        const x = cx + (tx - cx) * k;
        const y = cy + (ty - cy) * k - Math.sin(k * Math.PI) * 9;
        g.fillStyle = fx.color;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ff8fa0';
        g.beginPath();
        g.arc(x - r * 0.22, y - r * 0.28, Math.max(0.7, r * 0.42), 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      return;
    }

    if (kind === 'revive') {
      // 复活：4px 金柱从地面顶到单位头顶 + 8 粒上浮（§11.2 模板 6）
      const h = 34;
      g.globalAlpha = Math.max(0, 1 - p) * 0.95;
      g.fillStyle = fx.color;
      g.fillRect(cx - 2, cy + 8 - h * Math.min(1, p * 1.6), 4, h * Math.min(1, p * 1.6));
      g.globalAlpha = Math.max(0, 1 - p) * 0.7;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const rad = 5 + ((i * 7) % 5);
        const rise = p * 26 + ((i * 11) % 9);
        g.fillRect(cx + Math.cos(ang) * rad - 1, cy + 8 - rise, 2, 2);
      }
      g.globalAlpha = 1;
      return;
    }

    if (kind === 'dread') {
      // 威压：暗环**下沉** + 3 片碎屑下落（与"缠根"的上浮藤蔓方向相反）
      g.globalAlpha = a;
      g.strokeStyle = fx.color;
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(cx, cy + 4 + p * 6, 10 + p * 4, 4 + p * 2, 0, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = fx.color;
      for (let i = 0; i < 3; i++) {
        const x = cx + (i - 1) * 7;
        g.fillRect(x, cy - 2 + p * 14 + i * 3, 2, 2);
      }
      g.globalAlpha = 1;
      return;
    }

    if (kind === 'lava') {
      // 熔岩护甲：四道沿对角外溅的火星（短、快、只播一次）
      g.globalAlpha = a;
      g.strokeStyle = fx.color;
      g.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const ang = Math.PI * 0.25 + (i * Math.PI) / 2;
        const r0 = 4 + p * 10;
        const r1 = r0 + 4;
        g.beginPath();
        g.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0 * 0.6);
        g.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1 * 0.6);
        g.stroke();
      }
      g.globalAlpha = 1;
      return;
    }

    if (kind === 'flame') {
      // 烈焰缠身：三簇上窜火舌。
      //
      // ×3 图纸目检（`tools/fxsheet.mjs`）第一版读成 **「||| 」三根竖条**：
      // 底宽只有 4px、三簇等高、间距 6px ⇒ 间隔 2px 的等宽竖条，形状上就是条形码。
      // 三处改：底宽 5px（斜率看得见）· 中簇最高（高低起伏）· 每簇加一层亮芯。
      const hs = [0.78, 1, 0.86];
      g.globalAlpha = a;
      for (let i = 0; i < 3; i++) {
        const x = cx + (i - 1) * 7;
        const hh = (8 + (1 - p) * 11) * hs[i];
        g.fillStyle = fx.color;
        g.beginPath();
        g.moveTo(x - 2.6, cy + 6);
        g.lineTo(x, cy + 6 - hh);
        g.lineTo(x + 2.6, cy + 6);
        g.closePath();
        g.fill();
        g.fillStyle = '#ffd9a0';
        g.beginPath();
        g.moveTo(x - 1.1, cy + 6);
        g.lineTo(x, cy + 6 - hh * 0.55);
        g.lineTo(x + 1.1, cy + 6);
        g.closePath();
        g.fill();
      }
      g.globalAlpha = 1;
      return;
    }

    if (kind === 'oath') {
      // 誓约：护罩弧从头顶浮起（不画整圈 —— 整圈会被读成"又一个法术环"）
      g.globalAlpha = a;
      g.strokeStyle = fx.color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy - 2 + p * 5, 9 + p * 3, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
      g.globalAlpha = 1;
      return;
    }

    if (kind === 'fly') {
      // 起落尘环：两道贴地扁环向外散（飞行兵起落各一次）
      g.globalAlpha = a * 0.8;
      g.strokeStyle = fx.color;
      g.lineWidth = 1.5;
      for (let i = 0; i < 2; i++) {
        const r = 6 + p * 10 + i * 4;
        g.beginPath();
        g.ellipse(cx, cy + 6, r, r * 0.32, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
      return;
    }

    // 缺省：原有的扩张圆环
    const r = (fx.splash ? 8 : 5) + p * (fx.splash ? 26 : 14);
    g.globalAlpha = a;
    g.strokeStyle = fx.color;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    if (p < 0.35) {
      g.globalAlpha = a * 0.35;
      g.fillStyle = fx.color;
      g.beginPath();
      g.arc(cx, cy, (fx.splash ? 16 : 9) * (1 - p), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  private blit(g: CanvasRenderingContext2D, name: string, col: number, row: number): void {
    const f = this.atlas.need(name);
    const c = hexCenter({ col, row });
    g.drawImage(
      this.atlas.canvas,
      f.x, f.y, f.w, f.h,
      Math.round(c.x + f.ax) + PAD, Math.round(c.y + f.ay) + PAD, f.w, f.h,
    );
  }
}

export { hexKey, hexCenter };
