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

  // ── p3 翠林（S3c，2026-11-06）─────────────────────────────────────
  // 档位分配逐格照抄 spec §15.2 的「p3 行」，不许按 tier 顺排。
  // 矮：h ≤ 0.68 —— 大头 + 宽胡子 + 宽刃斧（与 p1 小孩靠胡子/斧、p2 火柴人靠体宽分开）
  p3_dwarf: { cls: 'short', h: 0.65, tip: '大头+宽胡子+斧' },
  // 中：0.84~1.00 —— **竖**长弓 + 叶披风（p1 弩手是横弩，方向相反）
  p3_junglearcher: { cls: 'mid', h: 0.88, tip: '竖长弓+叶披风' },
  // 高：h ≥ 1.18 —— 树冠 + 树干 + 根系（§15.4「读拔不起来」）；w 必须 <1.11h 才不落宽体档
  p3_treant: { cls: 'tall', h: 1.22, tip: '树冠+根系' },
  // 宽体：w ≥ 1.35h —— 横张肩背 + 举石（§15.4：要投石，不许真四足）
  p3_ape: { cls: 'wide', h: 0.95, tip: '横张肩背+举石' },
  // 巨物·飞行：h ≥ 1.45 —— 长颈 + 横身 + 长尾 + **下掠翼**（与恶魔同向，靠骨架分）
  p3_greendragon: { cls: 'huge', h: 1.5, tip: '长颈+长尾+下掠翼' },

  // ── p4 紫晶（S3d，2026-11-08）─────────────────────────────────────
  // 档位逐格照抄 spec §15.2 的「p4 行」。这一族的判据是**骨架**不是颜色：
  // 五个兵全是紫 + 骨，靠"全骨 / 前倾 / 及地斗篷 / 横张肩背 / 无脚"分。
  // 矮：h ≤0.68 —— 全骨（唯一没有布料主色的兵）+ 大头骨 + 右出锈剑
  p4_skeleton: { cls: 'short', h: 0.65, tip: '大头骨+锈剑' },
  // 中：0.84~1.00 —— 前倾 + 左臂前伸 + 两腿不齐（同档的 p1 弩手是正面站）
  p4_zombie: { cls: 'mid', h: 0.88, tip: '前倾+左伸手' },
  // 高：h ≥1.18 —— **收拢的蝠翼** + 立领触顶 + 及地斗篷（展开翼会先判成宽体）
  p4_vampire: { cls: 'tall', h: 1.22, tip: '立领+收翼' },
  // 宽体：w ≥1.35h —— 横张肩背 + 高举的斧；§15.4 要求**必须留两条腿**
  p4_minotaur: { cls: 'wide', h: 0.95, tip: '横张肩背+举斧' },
  // 巨物·飞行：h ≥1.45 —— 兜帽 + **锯齿下摆垂到地（无脚）**，读"不走路"
  p4_wraith: { cls: 'huge', h: 1.5, tip: '兜帽+破碎下摆' },
};

/** 已重画的族前缀。S3b/S3c 每落一族就往里加一个（不要按兵种逐个加）。 */
export const BODY_PLAN_FAMILIES = new Set(['p1', 'p2', 'p3', 'p4']);

/** `p1_child_u` → `p1_child`；基础版原样返回。升级形态与基础版**共用同一档**。 */
export function baseUnitOf(unit: string): string {
  return unit.endsWith('_u') ? unit.slice(0, -2) : unit;
}

/** 体形档查询：升级形态没有自己的档，直接读基础版那条（§2.5「脸不动、比例不变」）。 */
export function planOf(unit: string): BodyPlan | undefined {
  return BODY_PLAN[baseUnitOf(unit)];
}

/** 该 unit 是否走新体形档 regime（**含升级形态**）。 */
export function hasBodyPlan(unit: string): boolean {
  return planOf(unit) !== undefined;
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
 * p3 翠林（S3c，2026-11-06）：深翠绿 + 叶 + 树皮 + 石。
 *
 * 只用 `B0_PALETTE` 的字面 hex（§3.4 第 1 条）。S3b 交接单 §7 提醒的那条撞色先算过：
 *   `p3accent2 #3fbe6e`(L*68.8/H142) ↔ `p2clash #2fbfa0`(L*69.8/H167) ΔL*=1.0、ΔH=25°
 *   ⇒ 若两者贴边必红（同色相需 ≥12）。本族**不引入 `p2clash`**，逐帧断言 8 只看帧内相邻像素，
 *   所以那条风险在 p3 上根本不会发生；但为稳妥，主布用更暗的 `p3accent0`(L*45.1)，
 *   亮绿只作同族亮档（`idx 0 ↔ idx 2` 差 2，断言 2 也过）。
 *
 * 逐对核算过的另一处：`leaf4 #6fc24a` ↔ `skin2 #d8a878` ΔL*=1.0（ΔH 71° 需 ≥8）⇒
 * 叶**不许贴脸**；脸周围一律是 `cloth`/`bark`/`ink0`（ΔL* 分别 27 / 42 / 61）。
 * `leaf0` ↔ `wood0` 只差 ΔL* 4.1 ⇒ 树冠暗斑不许压到树皮，中间留叶亮档或墨缝。
 */
const P3 = {
  cloth: '#1f7a45', // p3accent 0 —— 主布 / 龙身 / 兜帽（**万能中间调**，贴脸、贴树皮、贴叶都够）
  trim: '#3fbe6e', // p3accent 2 —— 同族亮档，只贴 cloth
  leaf: '#6fc24a', // leaf 4 —— 树冠 / 叶披风 / 龙翼骨
  leafDark: '#2f5a24', // leaf 0 —— 树冠暗斑 / 下掠翼（同族，只许贴 leaf 或 cloth）
  bark: '#5f4022', // wood 0 —— 树干 / 长弓 / 根 / 靴 / 猿人毛
  barkLite: '#a8703c', // wood 4 —— 同族亮档，只贴 bark
  skin: '#d8a878', // skin 2 —— 脸与手
  rock: '#cfc6b4', // stone 4 —— 斧刃 / 箭镞 / 猿人的石弹
  bloom: '#e0538f', // p3clash —— 小面积花果（对谁都 ΔL* ≥11）
  ink: '#2a1a12', // ink0
  hi: '#ffffff', // hi0 —— 只给眼睛右上角那一格
} as const;

/**
 * p4 紫晶（亡灵）· **只用 `B0_PALETTE` 的字面值**。
 *
 * 与 p3 同一套纪律（见上面 P3 的注释）：先算 ΔL* 与色相差，再决定谁贴谁。
 * 断言 8 要求相邻异材质 ΔL* ≥8，色相差 <30° 时 ≥12。本组里**必须避开的四对**：
 *   · `plumDark` ↔ `robe`   ΔL*=10.7，色相差 11° ⇒ 需 12，**差一点点**（最容易踩）
 *   · `plum`     ↔ `robe`   ΔL*=3.1  ⇒ 主紫**不许贴**主袍色
 *   · `plumLite` ↔ `bone`   ΔL*=3.3  ⇒ 亮紫**不许贴**骨/脸
 *   · `bone`     ↔ `ironLite` ΔL*=6.7 ⇒ 骨**不许贴**亮铁
 * 于是分工是：`plum` 只贴 `plumDark`/`ink`/`bone`；`robe` 只贴 `robeDark`/`flesh`/`bone`；
 * `plumDark` 永远夹在 `plum` 与 `ink` 之间（不在袍子上开紫花）。
 */
const P4 = {
  robe: '#58526e', // p4wall 2 —— 主袍 / 斗篷外皮（万能中间调：贴骨 43.7、贴肉 16.9）
  robeDark: '#38334a', // p4wall 0 —— 同族暗档，只贴 robe / flesh
  plum: '#a165e8', // p4accent 2 —— 主紫（披风 / 兜帽 / 腰布）
  plumDark: '#6232a8', // p4accent 0 —— 只贴 plum / ink（贴 robe 只有 10.7，红）
  plumLite: '#d4aefc', // p4accent 4 —— 只贴 plum（贴骨 3.3，红）
  bone: '#cfc6b4', // stone 4 —— 骨 / 角 / 獠牙 / 苍白脸
  boneDark: '#a9a093', // stone 2 —— 骨暗面（贴骨 13.9）
  flesh: '#a87450', // skin 0 —— 僵尸/牛头怪的皮（贴骨 26.8）
  iron: '#6b7686', // metal 0 —— 锈剑 / 斧 / 蹄铁
  ironLite: '#aab6c2', // metal 2 —— 只贴 iron / plum（贴骨 6.7，红）
  glow: '#8ffff0', // p4emissive 4 —— 摄魂怪的发光眼
  clash: '#3fe0d0', // p4clash —— 小面积魂火（贴骨 1.1 ⇒ **离骨远**）
  ink: '#2a1a12', // ink0
  hi: '#ffffff', // hi0 —— h3 脸的右上角那一格
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

/**
 * 兵牌的脸：**只有两只眼，没有嘴**。
 *
 * 43×37 的头上，眼睛占两行、嘴占一行 —— 三行墨在 5~6px 的脸上就是"一整块黑"，
 * 8× 实拍读成「张着嘴的方块」。而眉眼距在这个尺寸上根本不存在：
 * 一只 6px 的头只能表达"这是正面"或"这是侧面"，表达不了表情。
 * 所以兵牌一律省掉嘴线；`audit:expr` 判的是 `cu_*`（战斗帧），那条不受影响。
 */
function cardFace(pb: PixBuf, lx: number, ey: number, gap = 1): void {
  const rx = lx + 2 + gap;
  R(pb, lx, ey, 2, 2, P.ink);
  R(pb, rx, ey, 2, 2, P.ink);
  pb.set(lx + 1, ey, P.hi);
  pb.set(rx + 1, ey, P.hi);
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
function drawChild(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false, elite = false): void {
  // 兵牌（h≈12）：头必须**再大一点**才撑得住"大头"这条档位特征 —— 0.18h 在 12px 上
  // 只剩 4.3px 宽的脑袋，2×2 的眼块会顶到脑壳外。0.22h ⇒ 5.3px，正好放下
  // 「2 + 净空 1 + 2」。
  const hr = card ? Math.max(2.6, h * 0.22) : h * 0.18; // 半径 0.18h ⇒ 头占身高 36%（全表最大）
  const headTop = base - h;
  const headCy = headTop + hr;
  // 腿：**两根之间留 2px 缝**（不留缝就与下摆连成一块蓝砖）
  const legW = Math.max(2, Math.round(h * 0.09));
  const legX = Math.max(2, Math.round(h * 0.1));
  R(pb, cx - legX - legW, base - h * 0.26, legW, h * 0.26, P.leather);
  R(pb, cx + legX, base - h * 0.26, legW, h * 0.26, P.leather);
  // 鞋
  // 兵牌上**不加宽**（`legW+2` 在 12px 的身高上等于给鞋加了两只脚掌：两只鞋
  // 从 10px 涨到 14px，整个人因此胖一圈 —— R5 的 57% 漂移就是这么来的）。
  const shoeGrow = card ? 0 : 1;
  R(pb, cx - legX - legW - shoeGrow, base - Math.max(1, h * 0.05), legW + shoeGrow * 2, Math.max(1, h * 0.05), P.ink);
  R(pb, cx + legX - shoeGrow, base - Math.max(1, h * 0.05), legW + shoeGrow * 2, Math.max(1, h * 0.05), P.ink);
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
  // 腰带：兵牌上**不画** —— 12px 的身高里，那道 1px 墨线横跨 4px 宽的袍子，
  // 读出来是「腰上有一道黑箍」，不是腰带（腰带要有上下两条边才成立）。
  if (!card) R(pb, cx - h * 0.17, base - h * 0.36, h * 0.34, Math.max(1, h * 0.04), P.ink);
  // 手臂：垂手 / atk 举一只手
  // 兵牌上手臂要**露在袍子外面**（±0.26h、2px）：0.24h 时只探出半个像素，
  // 缩到 12px 就是「袍子两侧各多一格肤色」，读不出是手。
  const armW = Math.max(2, Math.round(h * 0.07));
  const armX = card ? h * 0.27 : h * 0.24;
  R(pb, cx - armX, base - h * 0.6, armW, h * 0.34, P.skin);
  if (atk) {
    tl(pb, cx + armX - armW, base - h * 0.58, cx + h * 0.38, base - h * 0.76, P.skin, armW);
  } else {
    R(pb, cx + armX - armW, base - h * 0.6, armW, h * 0.34, P.skin);
  }
  // 脖子
  R(pb, cx - Math.max(1, Math.round(hr * 0.3)), base - h * 0.66, Math.max(2, Math.round(hr * 0.6)), h * 0.06, P.skin);
  // 大头
  pb.ellipse(cx, headCy, hr, hr, P.skin);
  // 头发：只盖**颅顶**（0 ~ 0.76 头半径）。兵牌上再压低 0.04hr —— 12px 的头只有
  // 6 行，发际线多占一行就会把 2×2 的眼睛啃掉半格。
  pb.ellipse(cx, headTop + hr * (card ? 0.32 : 0.38), hr, hr * (card ? 0.32 : 0.38), P.hair);
  // 呆毛
  R(pb, cx + hr * 0.1, headTop - 1, Math.max(1, hr * 0.22), Math.max(1, hr * 0.3), P.hair);
  if (elite) {
    // ── 孩子王（S4）：纸王冠 + 一面小旗 ──
    // 王冠画在**头发上**，不压皮肤：goldDark ↔ skin 的 ΔL 只有 5、色相也同属暖色，
    // 贴在一起会被断言 8 判红（P4 的 plum↔flesh 同一个坑）。
    R(pb, cx - hr * 0.82, headTop + hr * 0.22, hr * 1.64, Math.max(1, hr * 0.3), P.goldDark);
    for (const dx of [-0.52, 0, 0.52]) {
      R(pb, cx + hr * dx - Math.max(1, hr * 0.12), headTop + hr * 0.02, Math.max(1, hr * 0.24), Math.max(1, hr * 0.24), P.goldDark);
    }
    // 旗：从左手向外挑 0.30h（cu 上 ≈6px）。
    // ⚠️ 它不是「凸起判据」的对象：`audit:bodyplan [6]` 已把"外接框凸起"降级为读数
    // （归一化按高度等比缩放 + 按中心居中，单侧伸出的东西会被对半分），
    // 真正判的是**自然身高不变 + 43×37 兵牌像素差 ≥8%**。
    const poleX = Math.round(cx - h * 0.3);
    R(pb, poleX, base - h * 0.86, Math.max(1, Math.round(h * 0.03)), h * 0.4, P.leather);
    R(pb, poleX - h * 0.26, base - h * 0.86, h * 0.26, h * 0.18, P.white);
    // 旗的下缘用 **ink**（第一版是 steelDark）：steelDark ↔ 旗杆 leather 的 ΔL 只有 5.3，
    // 而杆是 1~2px 宽、旗面下缘必然贴着它 ⇒ 断言 8 三张帧全红。ink ↔ leather 的 ΔL ≈ 22。
    R(pb, poleX - h * 0.26, base - h * 0.7, h * 0.26, Math.max(1, Math.round(h * 0.03)), P.ink);
  }
  // 眼睛 + 嘴：2+1+2 的净宽正好吃掉 8.5px 脑袋的一大半 —— 这就是「大头小孩」该有的比例
  if (face) {
    const ey = Math.round(headTop + hr * 0.95);
    if (card) cardFace(pb, Math.round(cx) - 2, ey);
    else h3Face(pb, Math.round(cx) - 2, ey, 2, 3, 3);
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
function drawCrossbow(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false, elite = false): void {
  const b = biped(pb, cx, base, h, { w: 0.32, headR: card ? 0.13 : 0.115 });
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
  const y = atk ? base - h * (card ? 0.62 : 0.66) : base - h * (card ? 0.52 : 0.58);
  // 兵牌：托加粗到 **3px**（1.4px 的托在 18px 的身高上只剩一行，和身体同色 ⇒ 读成
  // 「胸前有一小块棕」）。加粗后托的下缘那道暗线才有地方落，才像一根**木托**。
  const len = h * (card ? 0.34 : 0.3);
  const x0 = cx - h * 0.4; // 托的前端 = 弓的落点（在躯干剪影之外）
  const stockH = card ? 3 : Math.max(2, Math.round(h * 0.08));
  R(pb, x0, y - 1, len, stockH, P.leather);
  R(pb, x0, y + stockH - 2, len, 1, P.leatherDark);
  // 竖弓：1px 竖线 + 两端**向前**折（向右折会与矢凑成一个十字架，5× 实拍整件读成"抱着十字架"）
  // 兵牌上弓臂加长到 0.17h（≈3px 半高）：18px 的身高上，2.7px 的弓只是个小钩子。
  const bowH = h * (card ? 0.17 : 0.15);
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
  if (elite) {
    // ── 连弩手（S4）：**第二具弩**（右手，指向右）+ 金肩甲 ──
    //
    // 走过两版弯路，记在这里免得再走：
    //   ① 背后一根水平浅钢杆 + 最外端竖弓 ⇒ ×12 读成悬空的**横杠 / 路牌**；
    //   ② 改成"斜挎"（弓臂放肩线上、托往右下斜）⇒ 弓臂那条横线正好落在**头的范围里**
    //      （头 y ∈ −1.005h ~ −0.775h，我把它放在 −0.84h）⇒ ×12 读成**白额带**，
    //      托把脸颊划了一道。斜挎在正面视图里没有景深线索，怎么摆都像"身上多一根杆"。
    //
    // 现在：**第二具弩就在右手里、指向右**，与左手那具**一高一低**（胸 vs 腰）错开。
    // 「连弩」的字面意思就是"两具弩"，两根平行的短托比任何斜挎都直接；
    // 高低错开是为了不合成一根长横杠（那会读成"端着一根扁担"）。
    const y2 = base - h * (card ? 0.46 : 0.5);
    const x2 = Math.round(cx + h * 0.1);
    const len2 = h * (card ? 0.26 : 0.28);
    R(pb, x2, y2 - 1, Math.round(len2), stockH, P.leather);
    R(pb, x2, y2 + stockH - 2, Math.round(len2), 1, P.leatherDark);
    // 竖弓：托的右端（与左手那具同样的"弓在剪影外"口径）
    const bowH2 = h * (card ? 0.15 : 0.14);
    const bx2 = x2 + Math.round(len2);
    R(pb, bx2, y2 - 1 - bowH2, 1, bowH2 * 2 + 1, P.steelLite);
    R(pb, bx2 - 1, y2 - 1 - bowH2, 2, 1, P.steelLite);
    R(pb, bx2 - 1, y2 - 1 + bowH2, 2, 1, P.steelLite);
    // 握着它的小臂（画在托上 ⇒ 读成"握"，不是"穿过"）
    R(pb, x2 + Math.round(h * 0.02), y2 + Math.round(h * 0.03), Math.max(2, Math.round(h * 0.07)), Math.max(2, Math.round(h * 0.08)), P.skin);
    // 肩甲：**先铺 1px ink 边框、再填金**。理由不是审美，是断言 8：
    // goldDark ↔ skin 的 ΔL 只有 5.3（map 帧实测），而这块甲正好卡在肩线上、
    // 上缘贴着脖子/下巴；只要留出 1px ink，四周邻接就都不足为患。
    // 位置再往**外侧**挪 0.05h（第一版压在脖子边，×12 读成"下巴上贴了块金箔"）。
    const ax = Math.round(cx - h * 0.25);
    const ay = Math.round(b.shoulder);
    const aw = Math.max(2, Math.round(h * 0.1));
    const ah = Math.max(1, Math.round(h * 0.05));
    R(pb, ax - 1, ay - 1, aw + 2, ah + 2, P.ink);
    R(pb, ax, ay, aw, ah, P.goldDark);
  }
  // 脸：眼在护鼻之下、嘴在眼下 3 行
  if (face) {
    const fey = Math.round(b.headY - hr * 0.15);
    if (card) cardFace(pb, Math.round(hx) - 2, fey);
    else h3Face(pb, Math.round(hx) - 2, fey, 2, 3, 3);
  }
}

/**
 * 鹰 · 高档 · **收翼立姿 + 长距后腿**。
 *
 * ⚠️ 这里绝不能画平展翼：R1 的机械判据里 `w ≥ 1.5h` 就是「巨物·飞行」档，
 *    平展双翼会让鹰直接与天使落进同一档（§8.4 当场红）。而为了过闸把鹰画小，
 *    §15.4 要的「起跳就到」又没了。所以辨识靠**长度**：腿长、body 竖、翼贴体。
 */
function drawEagle(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false, elite = false): void {
  const lean = atk ? -h * 0.05 : 0;
  const lw = Math.max(2, Math.round(h * 0.05));
  // 兵牌：两条腿的间距从 0.055h 拉到 0.075h。0.055h 在 26px 的身高上只有 1.4px，
  // 两条 2px 的腿一画就**并成一根柱子** —— 而"长腿"正是这一档的招牌。
  const legX = h * (card ? 0.075 : 0.055);
  // ── 长腿（这一档的招牌）：髋在 0.42h，脚在 base；中途一个后向的「膝」凸起 ──
  for (const dir of [-1, 1]) {
    const x = Math.round(cx + dir * legX);
    R(pb, x, base - h * 0.42, lw, h * 0.4, P.goldDark);
    // 后膝：往外鼓 1~2px（直棍会读成两根竹竿）
    R(pb, x + dir * Math.max(1, Math.round(h * 0.03)), base - h * 0.24, lw, Math.max(2, Math.round(h * 0.06)), P.goldDark);
  }
  // 爪：三趾（不画会读成两根竹竿）
  for (const dir of [-1, 1]) {
    const fx = Math.round(cx + dir * legX);
    R(pb, fx - Math.max(1, Math.round(h * 0.05)), base - Math.max(1, Math.round(h * 0.03)), Math.max(2, Math.round(h * 0.12)), Math.max(1, Math.round(h * 0.03)), P.featherDark);
    R(pb, fx + Math.max(1, Math.round(h * 0.03)), base - Math.max(1, Math.round(h * 0.03)), Math.max(2, Math.round(h * 0.08)), Math.max(1, Math.round(h * 0.03)), P.featherDark);
  }
  // ── 身体：竖椭圆（横椭圆就成鹌鹑了）──
  pb.ellipse(cx + lean, base - h * 0.62, h * 0.16, h * 0.22, P.feather);
  // 胸腹浅色（只占中间，不做整条白肚）
  pb.ellipse(cx + lean, base - h * 0.6, h * 0.1, h * 0.16, P.belly);
  // ── 收起的双翼：贴着身体两侧，向后下方收成尖 ──
  //
  // 兵牌（h≈26）上原样画会读成「两片披风」：翼尖只到 0.25h、且和身体同宽，
  // 外缘没有一处"伸出去"的尖。所以翼尖拉到 **0.30h 并把高度压到 0.26h** ——
  // 它在体外露出 3~4px，尖朝后下方，这是 43px 上唯一还能读出"收翼"的形状。
  for (const dir of [-1, 1]) {
    const wing = card
      ? ([
          [cx + dir * h * 0.055, base - h * 0.82],
          [cx + dir * h * 0.19, base - h * 0.7],
          [cx + dir * h * 0.2, base - h * 0.48],
          [cx + dir * h * 0.3, base - h * 0.26],
          [cx + dir * h * 0.16, base - h * 0.4],
          [cx + dir * h * 0.09, base - h * 0.5],
        ] as [number, number][])
      : ([
          [cx + dir * h * 0.05, base - h * 0.8],
          [cx + dir * h * 0.18, base - h * 0.68],
          [cx + dir * h * 0.16, base - h * 0.44],
          [cx + dir * h * 0.25, base - h * 0.32],
          [cx + dir * h * 0.09, base - h * 0.46],
        ] as [number, number][]);
    pb.poly(
      wing.map(([x, y]) => [x + lean, y] as [number, number]),
      dir < 0 ? P.featherLite : P.featherDark,
    );
    // 翼羽分缝：一道暗线让「收起的翼」不是一块披风
    // 兵牌上这根缝要**一直通到翼尖**，它同时也是"翼"与"身体"的分界
    tl(
      pb,
      cx + dir * h * 0.1 + lean,
      base - h * (card ? 0.75 : 0.72),
      cx + dir * h * (card ? 0.27 : 0.17) + lean,
      base - h * (card ? 0.3 : 0.4),
      P.featherDark,
      1,
    );
  }
  // 尾羽：三根长短不一的尖（齐边会读成一把扇子）
  // S4：升级形态把两根尾羽**都换成 goldDark**（§2.5 不改比例，改材质）。
  // 第一版只把其中一根换成 belly（浅金）⇒ ×12 实拍那块浅色三角比腿还大，
  // 读成"拖到地上的一片翅膀"。两根同色 ⇒ 融成一束**金尾**，形状与原图一致，只换材质。
  pb.poly([[cx + h * 0.02, base - h * 0.46], [cx + h * 0.1, base - h * 0.46], [cx + h * 0.22, base - h * 0.2]], elite ? P.goldDark : P.featherDark);
  pb.poly([[cx - h * 0.02, base - h * 0.46], [cx + h * 0.05, base - h * 0.46], [cx + h * 0.12, base - h * 0.24]], elite ? P.goldDark : P.feather);
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
  pb.ellipse(cx - h * 0.01 + lean, hy, h * (card ? 0.105 : 0.09), h * (card ? 0.088 : 0.075), P.featherLite);
  // 钩喙（朝左）：上喙带钩、下喙短
  // 兵牌上喙要更**长而尖**（0.09h → 0.11h 的伸出量）：26px 的身高上，
  // 2.8px 的短喙会被描边吃掉一半，"猛禽"就只剩一团棕色。
  const bk = card ? 1.12 : 1;
  pb.poly(
    [
      [cx - h * 0.09 * bk + lean, hy - h * 0.03 * bk],
      [cx - h * 0.2 * bk + lean, hy + h * 0.01],
      [cx - h * 0.17 * bk + lean, hy + h * 0.05 * bk],
      [cx - h * 0.09 + lean, hy + h * 0.04 * bk],
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
  if (elite) {
    // ── 金雕（S4）：淡金颈背 + 白翼尖 + 一根长尾羽 ──
    // 金雕的识别点本来就是「淡色颈背」，不是"整体刷金"：featherLite ↔ belly 的
    // ΔL ≈ 30，贴在一起干净；把全身换成 goldDark 反而会和尾羽、喙糊成一块棕。
    // 淡金颈背：**偏右（背侧）**、只到 −0.81h。
    // 第一版从 cx−0.07h 起、压到 −0.90h —— 与左上方的钩喙只隔 0.02h，
    // map 帧归一化后不足 1px ⇒ beak ↔ belly 的 ΔL 9.3 < 12，断言 8 红（(20,14)）。
    // 喙朝左、颈背在右，这本来就是"鹰"的解剖关系，不是为了让闸变绿而挪。
    pb.poly(
      [
        [cx - h * 0.02 + lean, base - h * 0.89],
        [cx + h * 0.09 + lean, base - h * 0.88],
        [cx + h * 0.07 + lean, base - h * 0.81],
        [cx - h * 0.01 + lean, base - h * 0.81],
      ],
      P.belly,
    );
    // 白翼尖：**已删**。第一版在 ±0.23h / −0.33h 各点了 2×1px 白，×12 实拍是两颗
    // 悬在翼外的白点 —— 那个高度上收翼的末端还差 0.05h，点不到翼上，读成噪点。
    // 「金雕」的证据现在交给**金尾**（下面）与颈背：两处都落在本来就有的形里。
    // 一根长尾羽：从金尾的根部长出去 0.24h、**细而尖**（0.09h 宽）。
    // 第一版是一块 0.14h 宽的实心三角、一路拖到 −0.12h —— ×12 实拍像一片拖到地上的
    // 浅色板（比腿还大），既不像羽毛也不像尾巴。羽毛要**窄、直、收尖**。
    pb.poly(
      [
        [cx + h * 0.1, base - h * 0.44],
        [cx + h * 0.19, base - h * 0.44],
        [cx + h * 0.34, base - h * 0.16],
        [cx + h * 0.28, base - h * 0.2],
      ],
      P.goldDark,
    );
  }
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
function drawKnight(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false, elite = false): void {
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
    elite
      ? P.goldDark // 圣骑士：**金色马铠**（基础版是钢）。金↔白 23.5 / 皮革 21 / 蓝袍 8.4，全过
      : P.trim, // 钢制马铠：与白马的 ΔL 17、与蓝袍 15 —— 同时躲开「蓝砖」与断言 8
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
  if (elite) {
    // ── 圣骑士（S4）：金色马铠 + 枪旗 + 加长白缨 ──
    //
    // 马铠的金色在**上面那条 poly 里**换（`elite ? goldDark : trim`），不在这里补 ——
    // 这块甲本来就压在白马背上，是整只兵里面积最大、离钢件最远的一块平面。
    //
    // 为什么不是"双金肩甲"（第一版就是）：肩线上下全是钢 —— 盔底（−0.836h）和
    // **握枪的手**（`P.steel`，画在本函数最后，会直接压上来）都在那儿，
    // goldDark ↔ steel 只有 **6.6**（需 ≥8）；补 1px ink 边也没用，
    // 盔与手是在 elite 块之后画的，会把缝重新盖掉。深蓝肩甲则又撞皮革（7.4）。
    //
    // 枪旗：**从枪尖往下挂**的三角旗（不是往上挑）。
    //
    // 第一版往上挑 0.12h，实测把整只兵的自然身高抬了 3px（41→44）——
    // 归一化是按高度等比缩放的，于是整只被压小 7%，**升级版反而比基础版窄**，
    // 剪影凸起变成负数。任何"往上加"的东西都会踩这个坑：骑士的盔冠本来就在 1.04h
    // （= BODY_PLAN 声明高），再往上就是逼着归一化砍自己。
    // 下垂的旗不改变最高点，面积照加，读起来也更像"枪上挂的令旗"。
    const px0 = tipX + h * 0.06;
    const py0 = tipY;
    pb.poly(
      [
        [px0, py0],
        [px0 + h * 0.16, py0],
        [px0 + h * 0.13, py0 + h * 0.13],
        [px0 + h * 0.03, py0 + h * 0.15],
      ],
      P.white,
    );
    // 白马十字：直接压在金马铠正中（**这是本兵升级后最亮的一笔**）。
    //
    // 为什么必须有它：只把马铠从钢换成金，×12 实拍读成「鞍垫换了块布」——
    // 同一个形状换个颜色，玩家看到的是调色，不是「升级了」。十字是**新出现的图案**，
    // 在 43×37 上只剩 1~2px 宽也仍然是一块亮斑（goldDark ↔ white 的 ΔL≈20）。
    // 白十字还有个副作用是好的：它是「圣」这个字在 8px 尺度上唯一还成立的符号。
    const bx = cx + halfLen * 0.39;
    const by = (bodyTop + bodyBot) / 2 - h * 0.01;
    const arm = Math.max(1, Math.round(h * 0.025));
    R(pb, Math.round(bx - arm / 2), Math.round(by - h * 0.1), arm, Math.max(3, Math.round(h * 0.2)), P.white);
    R(pb, Math.round(bx - h * 0.08), Math.round(by - arm / 2), Math.max(3, Math.round(h * 0.16)), arm, P.white);
    // 白缨的加长**不在这里**：缨在下面「盔冠」那一句里画，这里补一笔会被它盖回去
    // （第一版就是这么写的：0.07h 的缨先画、0.05h 的缨后画，落地几乎看不出差别，
    //   注释却写着"加长一档"）。改成让那一句自己按 elite 取宽。
  }
  // 头 + 大盔
  // ⚠️ 头盔半径从 0.068h 放大到 0.105h：h3 脸要「2 + 净空 1 + 2」= 5px 的净宽，
  //    原来那颗 5px 宽的头盔连两只 2×2 的眼都放不下（放下就贴盔沿，归一化后粘成一条黑）。
  const rhy = base - h * 0.93;
  // 兵牌：头盔半径 0.105h → 0.12h（25px 身高上 2.6 → 3px）。h3 脸要 5px 净宽，
  // 2.6px 的盔连两只 2×2 的眼都放不下（放下就贴盔沿，读成一条黑缝）。
  const rhR = h * (card ? 0.12 : 0.105);
  pb.ellipse(cx, rhy, rhR, rhR * 0.9, P.steel);
  // 面甲缝 → 「眼睛 + 呼吸缝」：原来那道 0.14h 宽的墨横线正好压在眼睛的高度上，
  // 留着它就永远画不出脸（首版 8× 下这里是一整条黑缝，读成「无脸铁罐头」）。
  if (face) {
    const fey = Math.round(rhy - rhR * 0.2);
    if (card) cardFace(pb, Math.round(cx) - 2, fey);
    else h3Face(pb, Math.round(cx) - 2, fey, 2, 3, 3);
  }
  // 盔冠（白缨）—— 剪影最高点。
  // 高度给到 1.04h（= BODY_PLAN 的声明高）：归一化会把「比目标高的部分从顶上删掉」，
  // 首版写到 1.06h ⇒ 多出来的 2 行正好被删光，白缨整根消失。
  // S4：升级形态**只加宽不加高**（0.03h → 0.05h）—— 加高就会被归一化砍掉。
  R(pb, Math.round(cx - h * 0.01), Math.round(base - h * 1.04), Math.max(1, Math.round(h * (elite ? 0.05 : 0.03))), Math.max(2, Math.round(h * 0.05)), P.white);
  // 执枪的手（画在最后 ⇒ 压在枪杆上，看起来是"握着"而不是"穿过"）
  R(pb, Math.round(handX - h * 0.03), Math.round(handY - h * 0.02), Math.max(2, Math.round(h * 0.06)), Math.max(2, Math.round(h * 0.06)), P.steel);
}

/**
 * 天使 · 巨物·飞行档 · 光环 + **上掠**翼。
 *
 * 翅膀朝向是全表唯一的两档（§16.1）：天使上掠、恶魔与龙下掠、鹰收翼。
 * 这一条不是画风 —— 它是「同族五个兵各占一档」之外的第二层区分。
 */
function drawAngel(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false, elite = false): void {
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
  // 兵牌：光环压成 **1px 横杠 + 两端下折的角**（7~9px 宽）。
  // 实心扁椭圆在 31px 的身高上是 7×4 的一坨，读出来是"头顶扣了个碗"；
  // 而 1px 的**空心环**会被描边灌成一枚黑环（本文件头注释里记过这条）。
  // 折中：一根亮金横杠，两端各下一格 —— 正视光环（edge-on）本来就是这个形状。
  const haloRy = card ? 1 : Math.max(2, Math.round(h * 0.036));
  const haloCy = topY + haloRy;
  // 兵牌上光环与头发之间留 2px（描边会吃掉 1px），比原版近 4px —— 否则光环比头还远
  const headTop = haloCy + haloRy + (card ? 2 : 3); // 留 3px：1~2px 的缝会被描边灌成一根「天线」
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
  if (elite) {
    // 大天使：**深蓝腰封**（+ 加宽光环，见下方）。
    //
    // 第一版是金腰带，被断言 8 判红：袍子右半是 `whiteMid`（暗面），
    // goldDark ↔ whiteMid 的 ΔL 只有 **2.4**（需 12）—— 金压在暗白上就是一滩泥。
    // 腰带横跨整件袍子，**任何位置都会压到那条暗面**，所以这里不能靠挪位置解决。
    // 改用 clothDark（p1 蓝的暗档）：↔ white 50 / ↔ whiteMid 32，两边都够；
    // 「大天使」的金色记忆点交给**光环加宽 40%**（那是 43×37 上唯一还读得出的一笔）。
    R(pb, cx - h * 0.13, shoulder + h * 0.16, h * 0.26, Math.max(2, h * 0.04), P.clothDark);
  }
  // 肩 + 头
  R(pb, cx - h * 0.13, shoulder - h * 0.04, h * 0.26, h * 0.1, P.white);
  ell(pb, cx - headR, hy - headR, cx + headR, hy + headR, P.skin);
  // 发：只盖颅顶（0.65 头半径），给 2×2 的眼睛留出发际线以下的位置
  ell(pb, cx - headR, hy - headR, cx + headR, hy - headR * 0.35, P.hair);
  // 脸
  if (face) {
    const fey = Math.round(hy - headR * 0.15);
    if (card) cardFace(pb, Math.round(cx) - 2, fey);
    else h3Face(pb, Math.round(cx) - 2, fey, 2, 3, 3);
  }
  // 光环：**实心**扁椭圆（画布没有"擦除"，1px 的环会被描边灌成一枚黑环）
  if (card) {
    // 大天使：光环**加宽 40%**（每侧多 1~2px）—— 头上面那一横是唯一在 12px 上还在的"身份"
    const hw = Math.max(3, Math.round(headR * (elite ? 1.9 : 1.35)));
    R(pb, cx - hw, haloCy, hw * 2 + 1, 1, P.goldDark);
    pb.set(cx - hw, haloCy + 1, P.goldDark);
    pb.set(cx + hw, haloCy + 1, P.goldDark);
    if (elite) R(pb, cx - hw + 1, haloCy - 1, hw * 2 - 1, 1, P.goldDark);
  } else {
    pb.ellipse(cx, haloCy, headR * (elite ? 1.55 : 1.15), haloRy, P.goldDark);
  }
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
function drawMatchman(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false): void {
  const topY = base - h;
  // 火苗占最上面 0.12h：剪影最高点必须是火苗尖，否则归一化会把头削平。
  // 兵牌（h≈14）上给 **3px 下限**：1.4px 的火苗落到画布上就是头顶的一道红边，
  // 8× 实拍读成「戴红帽子」。火苗要有 **尖** 才成立 —— 尖占 1px、底占 3px。
  const flameH = card ? Math.max(3, h * 0.14) : h * 0.12;
  const headR = h * (card ? 0.21 : 0.2);
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
  // 脸：头径 0.4h ≈ 9.3px，2+2+2 的两眼刚好放下；兵牌上净空收到 1（头只有 6px）
  if (face) {
    const fey = Math.round(headCy - headR * 0.28);
    if (card) cardFace(pb, Math.round(cx) - 2, fey);
    else h3Face(pb, Math.round(cx) - 2, fey, 2, 3, 3);
  }
  // 火苗：三尖，压在最上面（既是"火柴"的命名理由，也是剪影最高点）
  // 兵牌上把火苗**整体收窄**（0.075h → 0.06h）并让尖占满 1px：
  // 宽了就是一道红边（帽子），窄了才是一个尖（火）。
  const fw = card ? Math.max(1.5, h * 0.06) : h * 0.075;
  pb.poly([[cx, topY], [cx - fw, topY + flameH * 0.92], [cx - fw * 0.27, topY + flameH * 0.72]], P2.glow);
  pb.poly([[cx, topY], [cx + fw, topY + flameH * 0.92], [cx + fw * 0.27, topY + flameH * 0.72]], P2.red);
  R(pb, cx - fw * 0.4, topY + flameH * 0.58, Math.max(2, fw * 0.8), Math.max(1, flameH * 0.42), P2.redDark);
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
function drawBronze(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false): void {
  // ── 为什么这一版是**矮胖方盒**（h 0.90 → 0.88、躯干加宽到 0.5h）──
  //
  // `audit:bodyplan` 的 [4] 在 22×30 下量「同族两两剪影差 ≥15%」，铜人与熔岩巨人
  // 只差 **10%** 被红。原因不是画错，是**兵牌把宽高比归一化掉了**：两张都按高缩到
  // 30px 后，铜人 21×30、巨人 20×30 —— 轮廓几乎重合（都是"头-宽肩-窄腿"）。
  // 修法只能是让**形状**不同：铜人做成"横方块 + 外挑肩 + 身侧大锤"（缩到 22 宽后
  // 只有 25 高），巨人保持"窄高 + 沙漏腰"（20×30）。这样两者的 bbox 就不一样了。
  const topY = base - h;
  // 兵牌：头加宽到 0.30h（4.3 → 5.4px）。glow 眼是 **2×2**，两只眼加净空要 5px，
  // 原来的 4.3px 头宽放不下 —— 右眼会被挤到脸外，读出来是「方头上一个黄点」。
  const headW = h * (card ? 0.3 : 0.24);
  const headH = h * (card ? 0.19 : 0.17);
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
  if (face) glowFace(pb, Math.round(cx) - 2, Math.round(headTop + headH * 0.34), card ? 1 : 2, 0, 0, 0);
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
function drawLavaGiant(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false): void {
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
  if (face) glowFace(pb, Math.round(cx) - 2, Math.round(headCy - headR * 0.1), 1, Math.round(cx) - h * (card ? 0.055 : 0.09), card ? Math.max(3, h * 0.13) : h * 0.18, 5);
}

/**
 * 三头狼 · 宽体档 · 四足长身 + **三个头**。
 *
 * ⚠️ 宽高比是这一档的唯一判据（`w ≥ 1.35h`），但**成品要留余量**：
 *    R1 量的是加完 1px 描边的 bbox，描边会让高多 2px、宽也多 2px，
 *    而比值对"矮而宽"的剪影是**变小**的（分母涨得比分子快）。
 *    所以这里画到 1.5h 以上，成品落在 1.55~1.60，不会贴着 1.35 的线。
 *
 * ⚠️ 画了**五轮**才读得出来，前四轮的失败模式各记一句（换下一个人别再走一遍）：
 *    ① 脖子 0.19h、身体 0.115h ⇒ 长颈鹿；
 *    ② 头挨太近 ⇒ 一圈鬃毛（狮子）；
 *    ③ 头拉开 + 高度错落 ⇒ 三根触手（脖子被拉长）；
 *    ④ 把颈间空隙填满 ⇒ 洞没了，三头也并成一块。
 *    最终判据换了：**不看"头顶几个峰"，看"左缘三张朝向不同的吻"** ——
 *    22px 下数的是**外缘的尖**，内部的分缝会被缩放和描边一起抹掉。
 *    所以三颗头**同一高度**、间距 0.22h，吻各转 −0.8 / 0.03 / 0.82 rad、长 1.85r。
 *
 * ⚠️ 三颗头在 **64×56** 才数得出；43×37 兵牌是从这一帧**多数票缩**出来的，
 *    1~2px 的暗缝会被投掉（见 `production/s3b-p2-bodyplan-2026-11-06.md` §5c）。
 *    这是管线问题，不是这张画的问题 —— 别再用改画法去救兵牌。
 *
 * ⚠️ 三个头只有**主头**画 ink 眼：`audit:expr` 的 profile 通道要求「恰好 1 只眼」。
 *    另两颗头是"远侧的头"，用 `p2wall0` 的暗点 —— 它们凑不出 `ink0 + hi0` 的
 *    2×2 窗口，所以不会被数成眼。这不是绕过判据：兽形侧脸的定义本来就是一只眼，
 *    三个头里的两只是侧影，画成高光眼反而会读成"三个正面脸"。
 */
function drawThreeWolf(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false): void {
  const bodyCy = base - h * 0.46;
  const halfLen = h * 0.3;
  const legW = Math.max(2, Math.round(h * 0.08));
  // 尾：粗短、末端蓬松（首版是一根细天线 + 一个球）
  //
  // 兵牌上尾要**收细到 2px 并去掉末端那道叉**：43×37 里尾长 0.8h ≈ 16px，
  // 比整簇头（约 12px）还长，而末端那个 wallDark 三角在 1× 下正好读成
  // "张开的上下颚 + 一只暗眼" ⇒ 三头狼变成"两头狼，右边那颗头更大"。
  // 兵牌的识别点是**左端三颗头**，右端只许当尾巴看，不许跟头抢。
  tl(
    pb,
    cx + halfLen * 0.8,
    bodyCy + h * 0.02,
    cx + h * 0.8,
    base - h * (card ? 0.64 : 0.6),
    P2.wall,
    card ? 2 : Math.max(3, Math.round(h * 0.09)),
  );
  if (!card) {
    pb.poly([[cx + h * 0.74, base - h * 0.68], [cx + h * 0.88, base - h * 0.58], [cx + h * 0.72, base - h * 0.5]], P2.wallDark);
  }
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
  // ── 肩丘：只把「颈根」连成一片，**不填头与头之间的缝** ──
  //
  // 上一版这里是一条 0.56h × 0.12h 的横梁，顶边在 `base−0.80h` —— 比两颗低头的
  // 头顶（−0.75h）还高。结果三个头在剪影上连成一条**平顶的带子**，8× 下读成一团
  // 「鬃毛」，三头一个也数不出来（S3b 第四轮实拍）。
  // 肩丘只需要堵住"头底到肩"这一段，让描边不至于把颈间缝隙灌成 ink0
  // （那是 `audit:expr` 的 [Contr] 误判的根源）；它的**顶边必须压到头下面**，
  // 颈间那道缝才能一路通到剪影外，成为真正的 V 形缺口。
  R(pb, cx - h * 0.62, base - h * 0.6, h * 0.64, Math.max(3, h * 0.1), P2.wall);
  // 颈间空隙先**填满毛色**：留空会在剪影里留下两个白洞（8× 下像脖子中间开了窗）。
  // 只填 `wall`：这个位置同时贴着鬃毛（accent）和三张吻（wall 暗档），
  // `wallDark` 与 `redDark` 只差 ΔL 8.1（断言 8 要 12）、`redDark` 又与吻撞同一对数
  // ⇒ 只有"和吻同族"的 `wall` 能同时过两关。分离改由下面那道暗缝负责。
  //
  // ⚠️ 这块 **0.68h × 0.2h 的矩形是"三头读不出来"的一半原因**（2026-11-06 复核）：
  // 它从 −0.78h 铺到 −0.58h，正好横穿三颗头之间，把上面所有 V 形缺口在**根部**堵死，
  // 于是三颗头虽然在顶上各自凸出，底下却是一条连续带子 —— 8×/14× 实拍（cu 与兵牌
  // 都一样）读成"一颗头 + 一排鬃毛尖"。兵牌改用下面的"细颈汇一点"，不再铺矩形。
  if (!card) R(pb, cx - h * 0.64, base - h * 0.78, h * 0.68, Math.max(3, h * 0.2), P2.wall);
  // 三头 = **三张吻**，不是三根脖子。
  //
  // 前四轮的教训：把头拉开、垫高 ⇒ 脖子变长，8× 下读成"长颈鹿/触手"；
  // 把头放大到能看清 ⇒ 它们又互相粘成一块。真正让"三头"读出来的**不是
  // 头的位置，是三个朝不同方向的吻尖** —— H3 的刻耳柏洛斯也是三颗头几乎
  // 并排、靠三张嘴的指向分开的。
  //
  // 所以：三颗头**同一高度**、x 上只隔 0.21h（缝由描边压成一道暗痕），
  // 吻各转 −0.55 / 0.02 / 0.58 rad ⇒ 剪影左缘伸出三个方向不同的吻尖。
  // 这一版不再靠"高度错落"制造凸起：错落会把脖子拉长，而 22px 下看的
  // 是**外缘有几个尖**，不是头顶有几个峰。
  // 三颗头的**尺寸与间距**在兵牌上是另一套数（见下）：
  //   · 战斗帧：r = 0.078h（56 画布上 2.7px），间距 0.22h；
  //   · 兵牌：  r = max(2.2, 0.12h)（19px 身高上 2.3px），间距 0.28h。
  // 为什么兵牌的头**相对更大**：43×37 上 2.7px 的圆头只剩 3px 直径，
  // 加上描边就是三个墨点；而"三个头"是这一档唯一的识别点，头必须撑到 4.5~5px。
  const heads: { x: number; y: number; r: number; dir: number; main: boolean }[] = card
    ? [
        // 兵牌：**三颗头各自成一个圆**，靠 1px 透空缝分开（描边会把缝压成墨线），
        // 吻各朝上左 / 正左 / 下左 ⇒ 左缘出现三个高度不同的尖（阶梯向右上）。
        //
        // 两版都失败的复盘（2026-11-06）：
        //   · 第一版"同高、全朝左"：三颗头中心只隔 0.24h，而头径 0.28h ⇒ 互相重叠，
        //     剪影是一块；三根吻也全挤在同一段左缘 ⇒ 读成"一颗头 + 两只耳"。
        //   · 第二版"对角但头更小"：头与头仍相交，靠 wallDark 暗缝分——而 wallDark
        //     与 wall 只差一档明度，1× 下是一条软褶，不是边界。
        // 结论：这个尺寸上**只有透空缝**能把两颗头分开（描边灌墨 = 硬边界），
        // 暗色缝不行；所以头必须小到 r≈0.11h（直径 4.4px）、间距拉到 0.24h+。
        { x: cx - h * 0.6, y: -0.75, r: Math.max(2.1, h * 0.11), dir: 0.75, main: false },
        { x: cx - h * 0.36, y: -0.85, r: Math.max(2.2, h * 0.115), dir: 0.0, main: true },
        { x: cx - h * 0.12, y: -0.95, r: Math.max(2.1, h * 0.11), dir: -0.75, main: false },
      ]
    : [
        { x: cx - h * 0.56, y: -0.8, r: h * 0.078, dir: -0.55, main: false },
        { x: cx - h * 0.34, y: -0.8, r: h * 0.086, dir: 0.02, main: true },
        { x: cx - h * 0.12, y: -0.8, r: h * 0.075, dir: 0.58, main: false },
      ];
  // 兵牌：三根 2px 短颈汇到肩丘。颈只负责"连住"，一长就成天鹅颈；
  // 头必须**离开身体独立成圆**，否则头和躯干同色，头就不见了。
  if (card) {
    for (const hd of heads) {
      tl(pb, hd.x + hd.r * 0.15, base + h * hd.y + hd.r * 0.5, cx - h * 0.2, bodyCy - h * 0.08, P2.wall, 2);
    }
  }
  for (const hd of heads) {
    const hy = base + h * hd.y;
    // 颈：短而粗（首版 0.19h 的细颈把整只狼拉成了长颈鹿）；兵牌不画，见上。
    if (!card) {
      tl(pb, hd.x + hd.r * 0.4, hy + hd.r * 0.8, hd.x + h * 0.05, bodyCy - h * 0.04, P2.wall, Math.max(3, Math.round(h * 0.085)));
    }
    // 头
    pb.ellipse(hd.x, hy, hd.r, hd.r * 0.85, P2.wall);
    // 吻：绕头心转 `dir`（三个吻尖是"三头"在 22px 下唯一还剩下的证据）
    // 兵牌上吻**加长 25%**：头大了，吻不变长就会缩进头的轮廓里，三个尖全看不见。
    const ca = Math.cos(hd.dir), sa = Math.sin(hd.dir);
    const k = card ? 1.25 : 1;
    const rot = (dx: number, dy: number): [number, number] => [
      hd.x + (dx * ca - dy * sa) * hd.r * (dx < 0 ? k : 1),
      hy + (dx * sa + dy * ca) * hd.r,
    ];
    pb.poly([rot(-0.78, -0.3), rot(-1.58, 0.02), rot(-1.46, 0.6), rot(-0.72, 0.54)], P2.wallDark);
    // 兵牌：吻尖点 1px 墨鼻。兵牌上吻是一根 4px 长的深色横条，
    // 没有鼻尖就只是一道色块；三个墨鼻分别落在三个高度上，"三张嘴"才数得出来。
    if (card) {
      const tip = rot(-1.58, 0.02);
      pb.set(Math.round(tip[0]), Math.round(tip[1]), P2.ink);
    }
    // 双耳：前耳亮、后耳暗（近远关系）
    // 兵牌上耳收到 1.25r（原 1.75r）：2.3px 的头配 4px 的耳，读出来是"三只兔子"。
    // 兵牌：三颗头**各留一只耳**（耳是"这算一颗头"的第二信号，和墨鼻配对）。
    // 只留前耳、不留后耳：两只耳 × 三颗头会在顶边连成一排尖齿。
    const earH = card ? 1.1 : 1.75;
    pb.poly([[hd.x - hd.r * 0.4, hy - hd.r * 0.65], [hd.x - hd.r * 0.5, hy - hd.r * earH], [hd.x - hd.r * 0.02, hy - hd.r * 0.7]], P2.wall);
    if (!card) {
      pb.poly([[hd.x + hd.r * 0.15, hy - hd.r * 0.68], [hd.x + hd.r * 0.34, hy - hd.r * 1.5], [hd.x + hd.r * 0.5, hy - hd.r * 0.6]], P2.wallDark);
    }
    // 眼：主头 ink（profile 的单眼），远侧两头是暗点
    if (face) {
      if (card) {
        // 兵牌：**三颗头各给 1px 眼**。"这是张脸"最强的信号是眼，不是耳朵；
        // 只画主头的眼，另外两颗就退化成"头顶的疙瘩"。
        // 眼必须落在头的**浅色中央**：放在左半边会和吻/描边同色（都是 ink），
        // 三个眼全部消失。中央 1px 是唯一还露着 wall 的位置。
        pb.set(Math.round(hd.x), Math.round(hy - hd.r * 0.2), P2.ink);
      } else if (hd.main) {
        // 眼必须落在头的**上半部**：首版放在 −0.2r（几乎贴着头底），
        // 头下方那道 1px 透明缝被描边灌成 ink0 段，`audit:expr` 的 [Contr]
        // 把它当成"嘴线"（ΔE 15.5 vs 透明）⇒ 红。−0.55r 时眼下全是头/颈/身体。
        profileEye(pb, Math.round(hd.x - hd.r * 0.55), Math.round(hy - hd.r * 0.55));
      }
    }
    if (!hd.main && !card) pb.set(Math.round(hd.x - hd.r * 0.6), Math.round(hy - hd.r * 0.12), P2.wallDark);
  }
  // 头与头之间的**一道暗缝**（1~2px），画在头**之后**才不会被颈盖掉。
  // 只占头部那一段（y −0.90h ~ −0.65h），**不下到肩**：背脊鬃在 −0.59h，
  // 离缝底还有 2px ⇒ 不会和 `redDark` 相邻（那对 ΔL 只有 8.1，差 12 一点点）。
  //
  // 兵牌上**不画**这道缝：三颗头之间本来就留了 1px 透明缝（间距 0.28h >
  // 头径），描边会把它灌成 ink0 —— 那道墨缝比自己填的棕缝更清楚，
  // 而且不会把三个头粘回一块。
  //
  // ⚠️ 上面那句在兵牌上**站不住**（2026-11-06 复核）：头径 2r = 0.26~0.28h，
  // 间距 0.28h ⇒ 缝只有 **0~1px**，还是斜的，"间距 > 头径"不成立。
  // 对角扇形这一版头更大（r 0.13~0.14h），相邻两颗必然重叠 1px 左右，
  // 所以兵牌**反过来必须自己画缝**：在每个接缝中点落一道 1px wallDark，
  // 从较高那颗头的顶一路压到肩丘，让"两颗头"有一条读得出来的分界。
  if (!card) {
    for (const sx of [-0.45, -0.23]) {
      R(pb, cx + h * sx, base - h * 0.9, Math.max(1, Math.round(h * 0.03)), Math.max(3, Math.round(h * 0.25)), P2.wallDark);
    }
  } else {
    for (let i = 0; i + 1 < heads.length; i++) {
      const a = heads[i];
      const b = heads[i + 1];
      const xm = Math.round((a.x + b.x) / 2);
      const top = Math.round(Math.min(base + h * a.y - a.r, base + h * b.y - b.r));
      const bot = Math.round(Math.max(base + h * a.y + a.r, base + h * b.y + b.r));
      R(pb, xm, top, 1, Math.max(2, bot - top), P2.ink);
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
function drawDevil(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false): void {
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
    tl(pb, sx, wRootY, sx + dir * wW * 0.9, base - h * 0.12, P2.red, card ? 2 : 1);
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
  if (face) {
    const fey = Math.round(headCy - headR * 0.15);
    if (card) cardFace(pb, Math.round(cx) - 2, fey);
    else h3Face(pb, Math.round(cx) - 2, fey, 2, 3, 3);
  }
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
 * 4c. p3 翠林五兵（S3c）
 *
 * 档位按 spec §15.2 的分配表：矮人矮 / 丛林射手中 / 树人高 / 猿人宽体 / 绿龙巨物·飞行。
 * §15.4 另给了两条玩法约束：树人要「树形 + 根系，读拔不起来」；绿龙与恶魔同为**下掠翼**，
 * 所以族内不能靠翼向分，必须靠**长颈 + 横身 + 长尾**把龙和直立人形的恶魔分开。
 *
 * R4 出口象限：矮人=左（斧）· 射手=左上（长弓）· 树人=上（树冠）· 猿人=右上（举石）·
 *              绿龙=右下（长尾）。同族五个方向各占一个。
 * ========================================================================== */

/** 矮人 · 矮档 · 大头 + 宽胡子 + 左手的宽刃斧。 */
function drawDwarf(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false): void {
  const topY = base - h;
  const hr = h * (card ? 0.235 : 0.215);
  const hy = topY + hr * 1.12;
  const shoulder = hy + hr * 0.92;
  const hip = base - h * 0.30;

  // ── 斧（出口象限：左）── 先画，柄压在身体后面
  const ax = cx - h * 0.42;
  tl(pb, ax, shoulder + h * 0.02, ax - h * 0.07, base - h * 0.04, P3.bark, Math.max(2, Math.round(h * 0.055)));
  // 宽刃扇面：石浅色与树皮 ΔL* 50，和主布 ΔL* 35 —— 两侧都安全
  pb.poly(
    [
      [ax + h * 0.02, shoulder - h * 0.12],
      [ax - h * 0.22, shoulder - h * 0.19],
      [ax - h * 0.25, shoulder + h * 0.02],
      [ax - h * 0.19, shoulder + h * 0.13],
      [ax + h * 0.02, shoulder + h * 0.06],
    ],
    P3.rock,
  );
  // 1px 墨缝：兵牌上删（<2px 的特征不画）
  if (!card) tl(pb, ax - h * 0.01, shoulder - h * 0.1, ax - h * 0.01, shoulder + h * 0.05, P3.ink, 1);

  // ── 圆桶身
  pb.poly(
    [
      [cx - h * 0.29, shoulder],
      [cx + h * 0.29, shoulder],
      [cx + h * 0.33, hip],
      [cx - h * 0.33, hip],
    ],
    P3.cloth,
  );
  R(pb, cx - h * 0.24, shoulder + h * 0.04, Math.max(2, h * 0.075), hip - shoulder - h * 0.08, P3.trim);
  R(pb, cx - h * 0.32, hip - h * 0.045, h * 0.64, Math.max(2, h * 0.05), P3.ink);
  const legW = Math.max(2, Math.round(h * 0.105));
  R(pb, cx - h * 0.24, hip, legW, base - hip - h * 0.03, P3.bark);
  R(pb, cx + h * 0.12, hip, legW, base - hip - h * 0.03, P3.bark);
  R(pb, cx - h * 0.26, base - h * 0.04, legW + 1, Math.max(1, h * 0.04), P3.ink);
  R(pb, cx + h * 0.10, base - h * 0.04, legW + 1, Math.max(1, h * 0.04), P3.ink);

  // ── 大头：盔只盖颅顶（S3a 教训：盖到 −0.35hr 以下就会压住眼）
  ell(pb, cx - hr, hy - hr, cx + hr, hy + hr, P3.skin);
  pb.poly(
    [
      [cx - hr * 1.05, hy - hr * 0.34],
      [cx - hr * 0.86, hy - hr * 1.16],
      [cx + hr * 0.86, hy - hr * 1.16],
      [cx + hr * 1.05, hy - hr * 0.34],
    ],
    P3.cloth,
  );
  // 宽胡子从颧骨下缘开始（**不许盖住嘴线**：嘴在 hy+0.12hr+3，胡子顶在 hy+0.82hr）
  pb.poly(
    [
      [cx - hr * 0.72, hy + hr * 0.82],
      [cx + hr * 0.72, hy + hr * 0.82],
      [cx + hr * 0.52, shoulder + h * 0.09],
      [cx - hr * 0.52, shoulder + h * 0.09],
    ],
    P3.bark,
  );
  // ⚠️ 胡子上的亮点**不画**：这簇胡子只有 2~3px 高，任何浅色小块都会同时贴到
  //    肤色（stone4↔skin2 ΔL* 7.9、ΔH 10° 需 ≥12）与主布（wood4↔p3accent0 ΔL* 7.0）。
  //    试过 barkLite / rock / 挪位置三种，都逃不开其中一条；通则「<2px 的特征不画」在这里
  //    同样适用 —— 一整块深棕梯形在 43×37 上比两条亮点更像胡子。
  if (face) {
    const lx = Math.round(cx) - (card ? 2 : 3);
    const ey = Math.round(hy - hr * 0.12);
    if (card) cardFace(pb, lx, ey);
    else h3Face(pb, lx, ey, 1, 3, 3);
  }
  if (atk) {
    // 出手：斧整体前推一点，不改剪影高度（档位不受动作影响）
    tl(pb, ax - h * 0.22, shoulder - h * 0.02, ax - h * 0.34, shoulder + h * 0.06, P3.rock, Math.max(2, Math.round(h * 0.05)));
  }
}

/** 丛林射手 · 中档 · 竖长弓（与 p1 的**横**弩区分）+ 叶披风。 */
function drawJungleArcher(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false): void {
  const topY = base - h;
  const hr = h * (card ? 0.16 : 0.14);
  const hy = topY + hr * 1.2;
  const shoulder = hy + hr * 1.05;
  const hip = base - h * 0.36;

  // ── 长弓（出口象限：左上）── 一张**张开的 D**：细弓臂 + 直弦。
  //    S3c 目检两轮：
  //      ① 两段折线 + 墨弦 ⇒ 拐杖（折点硬、弦看不见）；
  //      ② 四段弧 + 0.13h 弯度 ⇒ 弦与弓臂之间只剩 1px，被描边灌满 ⇒ 盾牌。
  //    现在弯度加到 0.20h、弓臂压到 2px：中间留出 4px 透空，才读成"弓"。
  const bx = cx - h * 0.3;
  const bowTop = topY + h * 0.1;
  const bowBot = base - h * 0.1;
  const bowMidY = (bowTop + bowBot) / 2;
  const bend = h * 0.2;
  const bowT = Math.max(2, Math.round(h * 0.045));
  tl(pb, bx, bowTop, bx - bend, bowMidY, P3.bark, bowT);
  tl(pb, bx - bend, bowMidY, bx, bowBot, P3.bark, bowT);

  // ── 领口：脸与叶披风之间的深翠绿隔层。
  //    skin2 ↔ leaf4 只差 ΔL* 1.0、skin2 ↔ p3accent2 差 3.4 —— 直接贴必红。
  //    布（p3accent0）对脸 27、对叶 26，两头都够；1px 的叶脉索性删（<2px 不画）。
  R(pb, cx - h * 0.17, shoulder - h * 0.02, h * 0.34, Math.max(2, h * 0.07), P3.cloth);
  // ── 叶披风（顶边下移到领口之下，不再碰脸）
  pb.poly(
    [
      [cx - h * 0.30, shoulder + h * 0.05],
      [cx + h * 0.26, shoulder + h * 0.05],
      [cx + h * 0.34, hip],
      [cx - h * 0.36, hip],
    ],
    P3.leaf,
  );
  // 躯干露在披风中间
  pb.poly(
    [
      [cx - h * 0.16, shoulder],
      [cx + h * 0.16, shoulder],
      [cx + h * 0.13, hip],
      [cx - h * 0.13, hip],
    ],
    P3.cloth,
  );
  // 躯干亮条用树皮色：leaf↔trim 只差 ΔL* 2.4，而 bark 对 leaf 41、对 cloth 15。
  R(pb, cx - h * 0.02, shoulder + h * 0.05, Math.max(2, h * 0.035), hip - shoulder - h * 0.05, P3.bark);
  const legW = Math.max(2, Math.round(h * 0.075));
  R(pb, cx - h * 0.13, hip, legW, base - hip - h * 0.025, P3.bark);
  R(pb, cx + h * 0.05, hip, legW, base - hip - h * 0.025, P3.bark);
  R(pb, cx - h * 0.15, base - h * 0.035, legW + 1, Math.max(1, h * 0.035), P3.ink);
  R(pb, cx + h * 0.03, base - h * 0.035, legW + 1, Math.max(1, h * 0.035), P3.ink);

  // ── 兜帽 + 脸
  ell(pb, cx - hr, hy - hr, cx + hr, hy + hr, P3.skin);
  pb.poly(
    [
      [cx - hr * 1.12, hy - hr * 0.2],
      [cx - hr * 0.9, hy - hr * 1.3],
      [cx + hr * 0.9, hy - hr * 1.3],
      [cx + hr * 1.12, hy - hr * 0.2],
    ],
    P3.cloth,
  );
  if (face) {
    const lx = Math.round(cx) - (card ? 2 : 3);
    const ey = Math.round(hy - hr * 0.1);
    if (card) cardFace(pb, lx, ey);
    else h3Face(pb, lx, ey, 1, 3, 3);
  }
  // ── 弓弦：**最后画**（压在叶披风上），否则会被披风盖掉半截，D 形就散了。
  //    rock ↔ bark ΔL* 50 / rock ↔ leaf ΔL* 9.0（门槛 8），断言 8 两头都过。
  //    兵牌也画：这不是「<2px 的装饰」，它是把弧认成弓的那一根线。
  tl(pb, bx, bowTop, bx, bowBot, P3.rock, 1);
  if (atk) {
    // 搭箭：杆横过身体，箭镞用石浅色（对 bark ΔL* 50、对 cloth ΔL* 35）
    tl(pb, bx - bend, bowMidY, cx + h * 0.34, bowMidY - h * 0.02, P3.bark, 2);
    pb.poly(
      [
        [cx + h * 0.30, bowMidY - h * 0.06],
        [cx + h * 0.42, bowMidY - h * 0.02],
        [cx + h * 0.30, bowMidY + h * 0.03],
      ],
      P3.rock,
    );
  }
}

/** 树人 · 高档 · 树冠 + 根系。宽度必须 <1.11h，否则会落进「宽体」档（classify 的 w/h 用 H_REF 换算）。 */
function drawTreant(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false): void {
  const topY = base - h;
  const canopyBot = topY + h * 0.29;
  const trunkTop = canopyBot - h * 0.01;
  const hip = base - h * 0.16;

  // ── 树冠：三团叶（card 用两团），最宽 0.88h —— 留出枝臂的余量
  ell(pb, cx - h * 0.38, canopyBot - h * 0.24, cx + h * 0.38, canopyBot, P3.leaf);
  ell(pb, cx - h * 0.3, topY, cx + h * 0.06, canopyBot - h * 0.07, P3.leaf);
  if (!card) ell(pb, cx + h * 0.04, topY + h * 0.03, cx + h * 0.44, canopyBot - h * 0.05, P3.leaf);
  // ── 冠上的花（`bloom`）：**错落、不成对**。
  //    S3c ×12 目检：旧版两团对称暗斑正好长在树干脸的正上方，读成「第二双眼睛」，
  //    一张脸变两张脸。改成偏左 / 偏右的三簇小花，只给"开花的树"这一条识别点，
  //    不制造任何左右对称的孔洞。bloom ↔ leaf ΔL* 15.1，断言 8 安全。
  const blooms: [number, number][] = card
    ? [[-0.06, 0.03]]
    : [
        [-0.24, 0.055],
        [0.14, 0.075],
        [0.3, 0.11],
      ];
  for (const [fx, fy] of blooms) {
    const fw = card ? Math.max(2, h * 0.12) : Math.max(2, h * 0.075);
    R(pb, cx + h * fx, topY + h * fy, fw, Math.max(2, h * 0.055), P3.bloom);
  }

  // ── 树干（bark / barkLite 同族，脸盘也是 barkLite）
  pb.poly(
    [
      [cx - h * 0.19, trunkTop],
      [cx + h * 0.19, trunkTop],
      [cx + h * 0.15, hip],
      [cx - h * 0.15, hip],
    ],
    P3.bark,
  );
  R(pb, cx - h * 0.12, trunkTop + h * 0.02, Math.max(2, h * 0.045), hip - trunkTop - h * 0.04, P3.barkLite);

  // ── 两根横枝（枝端叶团贴树皮 ΔL* 41，安全）
  const armT = Math.max(2, Math.round(h * 0.055));
  tl(pb, cx - h * 0.16, trunkTop + h * 0.15, cx - h * 0.47, trunkTop + h * 0.02, P3.bark, armT);
  tl(pb, cx + h * 0.16, trunkTop + h * 0.17, cx + h * 0.47, trunkTop + h * 0.1, P3.bark, armT);
  ell(pb, cx - h * 0.55, trunkTop - h * 0.05, cx - h * 0.4, trunkTop + h * 0.08, P3.leaf);
  ell(pb, cx + h * 0.4, trunkTop + h * 0.02, cx + h * 0.55, trunkTop + h * 0.15, P3.leaf);

  // ── 根系：兵牌只留两根（四根在 20px 高上会并成一块墨）
  const roots = card ? [-0.3, 0.3] : [-0.36, -0.12, 0.14, 0.36];
  for (const r of roots) {
    tl(pb, cx + h * r * 0.3, hip, cx + h * r, base, P3.bark, Math.max(2, Math.round(h * 0.06)));
  }

  // ── 脸：树皮上的浅色面盘（barkLite ↔ bark 同族），h3 的墨眼/嘴在上面 ΔE 足够
  const fy = trunkTop + h * 0.14;
  const fr = h * (card ? 0.14 : 0.115);
  ell(pb, cx - fr, fy - fr, cx + fr, fy + fr, P3.barkLite);
  if (face) {
    const lx = Math.round(cx) - (card ? 2 : 3);
    const ey = Math.round(fy - fr * 0.25);
    if (card) cardFace(pb, lx, ey);
    else h3Face(pb, lx, ey, 1, Math.max(3, h * 0.09), 3);
  }
  if (atk) {
    // 出手：右枝抬高，树冠不动
    tl(pb, cx + h * 0.16, trunkTop + h * 0.17, cx + h * 0.47, trunkTop - h * 0.02, P3.bark, armT);
  }
}

/** 猿人 · 宽体档 · 横张肩背 + 举石。R1 的机械判据只有 w≥1.35h，不许真画成四足（要投石）。 */
function drawApe(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false): void {
  const topY = base - h;
  const hr = h * (card ? 0.17 : 0.145);
  const hy = topY + hr * 1.05; // 头往下压，埋进肩背里（不再是「坐在桌上的罐子」）
  const shoulder = hy + hr * 0.55; // 肩线抬到头的下半部，省掉脖子
  const hip = base - h * 0.3;
  const outer = h * 0.76; // 肩头外缘 ±0.86h（含圆肩头）⇒ w≈1.7h，稳住宽体档
  const armT = Math.max(3, Math.round(h * 0.09));

  // ── 举石的手 + 石弹（出口象限：右上）── 先画，压在肩块后面。
  //    stY 不许高过 topY + 0.03h：石弹顶超出 bbox 会把整只猿重新缩放（改档位）。
  const stX = cx + h * 0.7;
  const stY = shoulder - h * 0.1;
  // 出手帧把**同一颗**石弹挪到右上，而不是再画一颗（旧版 atk 会同时出现两块石头）。
  const stoneX = atk ? cx + h * 0.76 : stX;
  const stoneY = atk ? stY - h * 0.02 : stY;
  tl(pb, cx + h * 0.6, shoulder + h * 0.1, stX, stY + h * 0.06, P3.bark, armT);
  ell(pb, stoneX - h * 0.12, stoneY - h * 0.1, stoneX + h * 0.12, stoneY + h * 0.1, P3.rock);
  if (!card && !atk) R(pb, stX - h * 0.02, stY - h * 0.06, Math.max(2, h * 0.04), Math.max(2, h * 0.05), P3.bloom);

  // ── 肩背：一整块**拱顶**多边形，最高点在脖子正中、两边往外下斜。
  //    S3c 二次目检：两块斜楔子仍拼成一条水平通栏（还是桌子）。现在顶边是 ∧ 形
  //    （没有水平边），再加左右圆肩头 + 一道浅色胸斑，把连续棕带切成三段。
  pb.poly(
    [
      [cx - outer, shoulder + h * 0.14],
      [cx - h * 0.26, shoulder - h * 0.04],
      [cx, shoulder - h * 0.1],
      [cx + h * 0.26, shoulder - h * 0.04],
      [cx + outer, shoulder + h * 0.14],
      [cx + outer * 1.04, shoulder + h * 0.3],
      [cx + h * 0.24, shoulder + h * 0.26],
      [cx - h * 0.24, shoulder + h * 0.26],
      [cx - outer * 1.04, shoulder + h * 0.3],
    ],
    P3.bark,
  );
  for (const dir of [-1, 1]) {
    ell(
      pb,
      cx + dir * outer - h * 0.1,
      shoulder + h * 0.06,
      cx + dir * outer + h * 0.1,
      shoulder + h * 0.3,
      P3.bark,
    );
  }
  // 浅色胸斑（barkLite↔bark ΔL* 22.2 / ↔skin 20.1 / ↔trim 16.7，三条都过门槛）
  ell(pb, cx - h * 0.17, shoulder + h * 0.11, cx + h * 0.17, shoulder + h * 0.29, P3.barkLite);

  // ── 左臂**折肘**：上臂外斜 → 肘 → 前臂回收 → 拳。直柱是「桌腿」的全部来源。
  const elbowY = shoulder + h * 0.45;
  tl(pb, cx - h * 0.7, shoulder + h * 0.22, cx - h * 0.82, elbowY, P3.bark, armT);
  // 前臂与拳必须**重叠 ≥1px**：22×30 时 0.02h < 1px，取整后会断成一颗孤立的点（目检实测）。
  tl(pb, cx - h * 0.82, elbowY, cx - h * 0.74, base - h * 0.05, P3.bark, armT);
  ell(pb, cx - h * 0.74 - h * 0.085, base - h * 0.14, cx - h * 0.74 + h * 0.085, base - h * 0.02, P3.bark);

  // ── 躯干 + 叶围裙（trim 贴 bark ΔL* 38.8；离脸很远，不会撞 skin）
  pb.poly(
    [
      [cx - h * 0.26, shoulder + h * 0.24],
      [cx + h * 0.26, shoulder + h * 0.24],
      [cx + h * 0.19, hip],
      [cx - h * 0.19, hip],
    ],
    P3.bark,
  );
  pb.poly(
    [
      [cx - h * 0.2, hip - h * 0.1],
      [cx + h * 0.2, hip - h * 0.1],
      [cx + h * 0.22, hip + h * 0.04],
      [cx - h * 0.22, hip + h * 0.04],
    ],
    P3.trim,
  );
  const legW = Math.max(2, Math.round(h * 0.1));
  R(pb, cx - h * 0.17, hip, legW, base - hip - h * 0.03, P3.bark);
  R(pb, cx + h * 0.07, hip, legW, base - hip - h * 0.03, P3.bark);
  R(pb, cx - h * 0.19, base - h * 0.04, legW + 1, Math.max(1, h * 0.04), P3.ink);
  R(pb, cx + h * 0.05, base - h * 0.04, legW + 1, Math.max(1, h * 0.04), P3.ink);

  // ── 小头 + 眉脊（bark 贴 skin ΔL* 42）
  ell(pb, cx - hr, hy - hr, cx + hr, hy + hr, P3.skin);
  R(pb, cx - hr * 0.9, hy - hr * 0.58, hr * 1.8, Math.max(2, hr * 0.34), P3.bark);
  if (face) {
    const lx = Math.round(cx) - (card ? 2 : 3);
    const ey = Math.round(hy - hr * 0.05);
    if (card) cardFace(pb, lx, ey);
    else h3Face(pb, lx, ey, 1, 3, 3);
  }
  // 出手姿态已在石弹位置里表达（见上），这里不再补第二颗石头。
}

/** 绿龙 · 巨物·飞行档 · 长颈 + 横身 + 长尾 + **下掠翼**。
 *  §16.1：恶魔也是下掠翼，两者只能靠「直立人形 vs 横身长颈长尾」分，不许靠翼向。
 *  ⚠️ 画布宽 64 ⇒ 高 54px 的龙，宽必须 ≤64（w/h ≤1.18），否则断言 12 横向溢出。 */
function drawGreenDragon(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false): void {
  const topY = base - h;
  const bodyCy = base - h * 0.42;

  // ── 下掠双翼（先画，在身体后面）：**亮膜 + 暗翼骨**，翼尖朝下，与 p2 恶魔同向。
  //    S3c ×12 目检：旧版膜是 leafDark（深色卡面上几乎看不见），只剩两条亮斜线
  //    ⇒ 读成「两根斜杆」。现在膜用亮叶色、翼骨用暗色；所有翼点都推到 |x| ≥ 0.30h，
  //    避开腿区。leaf↔leafDark ΔL* 37 / leaf↔cloth ΔL* 26，断言 8 两头都过。
  for (const dir of [-1, 1]) {
    const sx = cx + dir * h * 0.1;
    const tipX = cx + dir * h * 0.5;
    pb.poly(
      [
        [sx, bodyCy - h * 0.12],
        [cx + dir * h * 0.52, bodyCy - h * 0.02],
        [tipX, base - h * 0.12],
        [cx + dir * h * 0.34, base - h * 0.24],
        [cx + dir * h * 0.3, bodyCy + h * 0.1],
      ],
      P3.leaf,
    );
    // 两根翼骨：从肩到外下尖 / 到外上角，压在亮膜上才读成翼骨而不是孤立的杆
    tl(pb, sx, bodyCy - h * 0.1, tipX, base - h * 0.12, P3.leafDark, card ? 1 : 2);
    tl(pb, sx, bodyCy - h * 0.1, cx + dir * h * 0.52, bodyCy - h * 0.02, P3.leafDark, 1);
  }

  // ── 长颈（左上）+ 头：整只龙的最高点由后掠冠给出
  tl(pb, cx - h * 0.22, bodyCy - h * 0.02, cx - h * 0.3, topY + h * 0.25, P3.cloth, Math.max(3, Math.round(h * 0.1)));
  const hx = cx - h * 0.32;
  const hyH = topY + h * 0.2;
  ell(pb, hx - h * 0.12, hyH - h * 0.09, hx + h * 0.12, hyH + h * 0.09, P3.cloth);
  // 吻朝左，伸出剪影（识别点不许藏在体内）
  pb.poly(
    [
      [hx - h * 0.06, hyH - h * 0.02],
      [hx - h * 0.2, hyH - h * 0.01],
      [hx - h * 0.2, hyH + h * 0.06],
      [hx - h * 0.06, hyH + h * 0.07],
    ],
    P3.trim,
  );
  // 后掠冠：触到 topY，保证 bbox 高 = h（巨物档靠高度，不靠翼展）
  pb.poly(
    [
      [hx + h * 0.02, hyH - h * 0.07],
      [hx + h * 0.18, topY],
      [hx + h * 0.16, hyH - h * 0.02],
    ],
    P3.leaf,
  );

  // ── 横身 + **分节腹甲**：一整条通栏亮边配四条直腿，×12 实拍也读成一张桌子。
  //    改成三片短甲，中间留缝；trim↔cloth ΔL* 23.6，安全。
  ell(pb, cx - h * 0.28, bodyCy - h * 0.12, cx + h * 0.28, bodyCy + h * 0.12, P3.cloth);
  for (let i = -1; i <= 1; i++) {
    R(pb, cx + h * (i * 0.15 - 0.055), bodyCy + h * 0.045, Math.max(2, h * 0.11), Math.max(2, h * 0.042), P3.trim);
  }
  // ── 两条**折腿**（大腿 → 膝 → 胫 → 足）：四条等宽直柱在 cu 上读成「栅栏」。
  //    与恶魔分家靠的是横身 + 长颈 + 长尾，不靠腿数，所以两种尺寸统一收成两足。
  const legXs = card ? [-0.14, 0.18] : [-0.18, 0.18];
  for (const lx of legXs) {
    const x0 = cx + h * lx;
    const kneeY = base - h * 0.17;
    tl(pb, x0, bodyCy + h * 0.06, x0 + h * 0.045, kneeY, P3.cloth, Math.max(2, Math.round(h * 0.085)));
    tl(pb, x0 + h * 0.045, kneeY, x0 - h * 0.01, base - h * 0.03, P3.cloth, Math.max(2, Math.round(h * 0.055)));
    R(pb, x0 - h * 0.055, base - h * 0.045, Math.max(3, h * 0.11), Math.max(1, h * 0.035), P3.ink);
  }

  // ── 长尾（出口象限：右下）：这是与恶魔分家的第二处
  tl(pb, cx + h * 0.26, bodyCy, cx + h * 0.48, bodyCy + h * 0.06, P3.cloth, Math.max(3, Math.round(h * 0.065)));
  pb.poly(
    [
      [cx + h * 0.44, bodyCy - h * 0.02],
      [cx + h * 0.52, bodyCy + h * 0.02],
      [cx + h * 0.44, bodyCy + h * 0.1],
    ],
    P3.leaf,
  );

  // ── 脸：兽形侧脸（profile 通道），单眼、无嘴线
  if (face) {
    const ex = Math.round(hx - h * 0.01);
    const ey = Math.round(hyH - h * 0.05);
    if (card) pb.set(ex, ey, P3.ink);
    else profileEye(pb, ex, ey);
  }
  if (atk) {
    // 喷火：吻前一簇（用小面积高饱和 `bloom`，不改剪影高度）
    R(pb, hx - h * 0.3, hyH + h * 0.01, Math.max(3, h * 0.08), Math.max(2, h * 0.045), P3.bloom);
  }
}


/* ==========================================================================
 * 4b. p4 紫晶五兵（S3d）
 *
 * 档位照 §15.2 的「p4 行」：骷髅(矮) / 僵尸(中) / 吸血鬼(高) / 牛头怪(宽体) / 摄魂怪(巨物·飞行)。
 * 出口按 §8.2 的五个上半扇区各占一个：
 *   骷髅 **右**（锈剑）· 僵尸 **左**（前伸的臂）· 吸血鬼 **上**（立领的顶边）·
 *   牛头怪 **右上**（扛在肩上的斧）· 摄魂怪 **左上**（伸出的骨爪）。
 *
 * ⚠️ 三条硬约束（与 p1–p3 相同，别在这里"例外"一次）：
 *   ① **没有任何形状可以高过 `topY`**：`normalizeTier` 按剪影 bbox 归位，谁多出一像素，
 *      整只兵就被等比缩小一次，`[1]` 的档位读数会整体偏矮（S3c 的弓顶就是这么栽的）。
 *   ② 巨物档靠**高度**（h ≥1.45），不靠翼展；高个档（吸血鬼）**必须收翼**，
 *      否则 w ≥1.35h 会先被判成宽体。
 *   ③ 兵牌（`card`）上 **<2px 的特征一律不画** —— 肋缝、指骨、鼻孔都属此列。
 *
 * ── S3d 目检记录（×12/×16 单张 + 逐像素 ASCII，2026-11-08）──────────────
 * 这一批**两次**目检都没过，记下来：断言只能证"合法"（档位、色差、眼嘴），
 * 证不了"像"；而缩略图拼版会把 1px 的缝糊平，必须单张放大 + dump 像素。
 *   第一版（五个全重画）：
 *     · 骷髅 胸腔是一整块骨 ⇒ "米色小人"；剑太短 ⇒ "勺子"。
 *     · 僵尸 头顶骨块 ⇒ 金发；1px 肋条 ⇒ 创可贴；整体像健康人。
 *     · 吸血鬼 两根竖领尖 ⇒ 猫耳；蝠翼被斗篷盖住 ⇒ 紫裙法师。
 *     · 牛头怪 水平通栏肩 + 两手同高 ⇒ 稻草人/十字架；斧柄用 ink ⇒ 斧头浮空。
 *     · 摄魂怪 对称深 V 锯齿轮 ⇒ 两条腿。
 *   第二版（改完仍有四张读错，说明只改局部没用）：
 *     · 骷髅 暗腔被**脊柱竖条**和"比腔还宽"的骨条整块盖住 ⇒ 肋缝一次都没露出来。
 *       ⇒ 删脊柱；骨条比腔**窄** 1px，靠左右露出的暗边当肋缝。
 *     · 吸血鬼 立领改成一整块梯形面板后 ⇒ 变成**灯罩帽**（帽檐压着头）。
 *       ⇒ 领子分两片、**只到下颌高度**，头必须完整露在领口上方。
 *     · 牛头怪 举斧的斜臂 + 平肩仍读十字架；斧刃是长平行四边形 ⇒ 砍刀。
 *       ⇒ 改 spec §16.5 的**扛斧**：斧扛在右肩、斧刃在肩后，左臂垂下带拳。
 *     · 摄魂怪 下摆改浅扇贝后**跑到地上站着了**（§15.4 要"读不走路"）。
 *       ⇒ 裙摆收到 3~4 条**长短不齐的垂布**，外侧两角切高 ≥0.08h。
 *   军规：**暗色缝不是边界，透空缝才是**（描边会给暗缝灌墨）；兵牌必须单独按
 *   目标像素高设计一遍（骷髅兵牌只有 **13px 高**，cu 帧是 24px —— 同一套比例搬
 *   下来，Math.max 的地板会把 3px 的躯干撑成 7px）。
 * ========================================================================== */

/** 骷髅 · 矮档（0.65）· 大颅骨 + 露肋的空腔 + 右出锈剑。
 *  与同档三家分开的判据：**唯一全骨**（骨 + 空腔暗，没有布料主色），
 *  且颅骨占身高 ~30%（矮档里唯一"头比身子显眼"的）。 */
function drawSkeleton(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false): void {
  const topY = base - h;
  // 兵牌只有 13px 高：颅骨半径给像素下限，否则装不下 2×2 眼 + 1 行嘴。
  const ry = card ? 2.4 : h * 0.15;
  const sy = topY + ry; // 颅心
  const skullB = topY + ry * 2;
  const shoulder = skullB + Math.max(1, h * 0.03);
  const hip = base - h * 0.29;
  const halfW = Math.max(2, Math.round(h * 0.145)); // 胸腔半宽：cu 3 / card 2

  // ── 锈剑（出口：右）。先画，握把压在手臂后面。
  //    短一寸就读成勺子（第一版 0.32h 实测）⇒ 刃长 0.46h，且**护手必须是竖的一横**，
  //    没有护手的横线在 22px 下与"棍子"没有区别。
  const gy = shoulder + (hip - shoulder) * 0.30;
  const gx = cx + halfW + Math.max(1, Math.round(h * 0.02));
  const tx = cx + h * 0.60;
  const bladeT = Math.max(1, Math.round(h * 0.07)); // cu 2 / card 1
  tl(pb, gx, gy, tx, gy - h * 0.04, P4.iron, bladeT);
  R(pb, tx - Math.max(1, h * 0.03), gy - h * 0.07, Math.max(2, h * 0.05), Math.max(1, h * 0.04), P4.ironLite); // 剑尖
  if (!card) tl(pb, gx, gy - h * 0.02, tx - h * 0.03, gy - h * 0.055, P4.ironLite, 1); // 刃口亮线
  // 护手：竖直一横（ink↔iron 38.2），上端高出刃 2px 才看得见"十字"
  const guardH = Math.max(3, Math.round(h * 0.16));
  R(pb, gx - Math.max(1, Math.round(h * 0.02)), gy - guardH * 0.5, Math.max(1, Math.round(h * 0.045)), guardH, P4.ink);
  R(pb, gx - Math.max(2, h * 0.05), gy - Math.max(1, h * 0.025), Math.max(2, h * 0.05), Math.max(1, h * 0.035), P4.ink); // 柄头

  // ── 腿（骨）+ 足（ink）：**腿宽 ≥2px、腿间透空 ≥2px**。
  //    兵牌上 h 只有 13px，1px 的腿会被后置描边整根吃掉（12x 图里是一块黑砖），
  //    所以这里给的是**像素下限**，不是 h 的比例。
  const legT = Math.max(2, Math.round(h * 0.055));
  const legOff = card ? 2 : Math.max(3, Math.round(halfW * 1.05));
  for (const dir of [-1, 1] as const) {
    tl(pb, cx + dir * legOff, hip, cx + dir * (legOff + 1), base - h * 0.04, P4.bone, legT);
    R(pb, cx + dir * (legOff + 1) - (dir < 0 ? legT + 1 : 0), base - Math.max(2, h * 0.045), legT + 1, Math.max(1, h * 0.035), P4.ink);
  }
  R(pb, cx - halfW * 0.72, hip, halfW * 1.44, Math.max(2, Math.round(h * 0.06)), P4.bone); // 骨盆

  // ── 胸廓：**骨为主体，暗缝只做 1px 且不碰外缘**。
  //    第三次改的原因：前两版都是"暗腔 + 骨条"，暗面积大于骨 ⇒ 22px 下读成
  //    **深色条纹上衣**（蓝灰底 + 白条），完全不像肋。骨架的读法相反：
  //    胸廓是**一整块骨**，肋缝是**几条短横线**，所以留 1px 骨边、缝宽只 1px。
  const cavH = Math.max(3, hip - shoulder - Math.max(1, h * 0.03));
  R(pb, cx - halfW, shoulder, halfW * 2, cavH, P4.bone);
  const ribs = cavH >= 6 ? 3 : cavH >= 4 ? 2 : 1;
  for (let i = 1; i <= ribs; i++) {
    const gy2 = shoulder + Math.round((cavH * i) / (ribs + 1));
    R(pb, cx - halfW + 1, gy2, Math.max(1, halfW * 2 - 2), 1, P4.robeDark);
  }

  // ── 左臂（骨，**与躯干留 1px 透空**）。兵牌上不画：1px 的臂会被描边吃掉，
  //    只在轮廓外多出一条黑边，反而让"瘦"变成"糊"。
  if (!card) {
    tl(pb, cx - halfW - Math.max(2, h * 0.045), shoulder + h * 0.02, cx - halfW - Math.max(2, h * 0.055), hip + h * 0.04, P4.bone, legT);
    // 左前臂：折一下，末端 2×2 指骨 —— 直的会读成一根挂着的棍
    tl(pb, cx - halfW - Math.max(2, h * 0.055), hip + h * 0.04, cx - halfW - h * 0.02, hip + h * 0.10, P4.bone, legT);
  }

  // ── 颅骨 + 下颌 + 齿列
  ell(pb, cx - ry * 1.02, sy - ry, cx + ry * 1.02, sy + ry, P4.bone);
  const jawW = Math.max(3, Math.round(h * 0.12));
  R(pb, cx - jawW / 2, skullB - Math.max(1, h * 0.02), jawW, Math.max(1, h * 0.045), P4.bone);
  if (!card) {
    // 齿缝：下颌上一道 ink，宽 3，不能贴到轮廓（落到透明会被读成背景）
    R(pb, cx - 1, skullB - Math.max(1, h * 0.015), 3, 1, P4.ink);
    // 颧骨下的一道暗（boneDark↔bone 13.9），离眼 ≥2 行
    R(pb, cx - ry * 0.75, sy + ry * 0.42, ry * 1.5, 1, P4.boneDark);
  }

  if (face) {
    const lx = Math.round(cx) - 2;
    const ey = Math.round(sy - ry * 0.45);
    if (card) {
      // 兵牌：眼 2×2 + **嘴也给一行**（13px 上"只有眼睛"读成幽灵，加一行才是骷髅）
      cardFace(pb, lx, ey);
      R(pb, lx + 1, ey + 3, 3, 1, P4.ink);
    } else {
      h3Face(pb, lx - (card ? 0 : 1), ey, 1, 3, 2);
    }
  }
  if (atk) {
    // 挥剑：刃上多一道高光；不加高、不加宽（动作不改档位）
    tl(pb, cx + h * 0.26, gy - h * 0.03, cx + h * 0.56, gy - h * 0.07, P4.hi, 1);
  }
}

/** 僵尸 · 中档（0.88）· 前倾 + 左臂前伸 + 破衣露肋。
 *  第四次定稿的形状判据（每次目检都推翻一次，记下来）：
 *    ① 露出的肋**不能是一块米色补丁**（读成围兜）⇒ 改成破衣上两道 1px 的骨白横线；
 *    ② 头**不能圆**（读成小孩）⇒ 下颌要掉下来：颌骨与颅之间留一道 ink 开口；
 *    ③ 两腿**不能并成一根柱**（读成木桩）⇒ 一条直、一条屈，中间 2px 透空。 */
function drawZombie(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false): void {
  const lean = h * 0.05; // 整体前探（向左手方向）
  const c0 = cx - lean;
  const topY = base - h;
  const hr = card ? Math.max(2.9, h * 0.135) : h * 0.13;
  const hy = topY + hr; // 颅心
  const jaw = hy + hr * 0.80;
  const shoulderY = jaw + hr * 0.35;
  const hip = base - h * 0.33;
  const bodyW = Math.max(4, Math.round(h * 0.21)); // 躯干半宽
  const armT = Math.max(2, Math.round(h * 0.075));

  // ── 左臂（出口：左）：水平前伸 + **折腕** + 三根短指（一根平杆读成木板）
  const armY = shoulderY + h * 0.05;
  const handX = c0 - h * 0.42;
  tl(pb, c0 - bodyW, armY, handX, armY - h * 0.01, P4.flesh, armT);
  R(pb, handX - Math.max(2, h * 0.02), armY - h * 0.02, Math.max(2, h * 0.05), Math.max(2, h * 0.06), P4.flesh); // 腕
  const fw = Math.max(1, Math.round(h * 0.025));
  for (let i = 0; i < 3; i++) {
    R(pb, handX - Math.max(3, h * 0.055) + i * (fw + 1), armY + h * 0.02, fw, Math.max(2, h * 0.045), P4.flesh);
  }

  // ── 腿：**一条直、一条屈**，中间 2px 透空；ink 脚
  const legT = Math.max(3, Math.round(h * 0.105));
  tl(pb, c0 - bodyW * 0.55, hip, c0 - bodyW * 0.62, base - h * 0.04, P4.flesh, legT);
  tl(pb, c0 + bodyW * 0.60, hip, c0 + bodyW * 0.78, base - h * 0.12, P4.flesh, legT);
  tl(pb, c0 + bodyW * 0.78, base - h * 0.12, c0 + bodyW * 0.70, base - h * 0.03, P4.flesh, Math.max(2, legT - 1));
  R(pb, c0 - bodyW * 0.62 - Math.max(2, h * 0.03), base - Math.max(1, h * 0.045), Math.max(3, h * 0.10), Math.max(1, h * 0.035), P4.ink);
  R(pb, c0 + bodyW * 0.56, base - Math.max(1, h * 0.045), Math.max(3, h * 0.10), Math.max(1, h * 0.035), P4.ink);

  // ── 躯干：**深色破衣**，下摆两个尖角（撕口），左肩露一块皮（衣服烂掉了）
  pb.poly(
    [
      [c0 - bodyW, shoulderY],
      [c0 + bodyW, shoulderY],
      [c0 + bodyW * 0.95, hip + h * 0.02],
      [c0 + bodyW * 0.42, hip + h * 0.10],
      [c0 + bodyW * 0.12, hip + h * 0.01],
      [c0 - bodyW * 0.46, hip + h * 0.08],
      [c0 - bodyW * 0.96, hip + h * 0.01],
    ],
    P4.robeDark,
  );
  // 露肩：左边一块**斜的**皮（不是直角补丁）
  pb.poly(
    [
      [c0 - bodyW, shoulderY + h * 0.005],
      [c0 - bodyW * 0.42, shoulderY + h * 0.005],
      [c0 - bodyW * 0.55, shoulderY + h * 0.10],
      [c0 - bodyW * 0.98, shoulderY + h * 0.14],
    ],
    P4.flesh,
  );
  // 露出的肋：破衣上两道 1px 骨白横线（**不是补丁**；bone↔robeDark 57.5）
  const ribX = c0 - bodyW * 0.55;
  const ribY = shoulderY + h * 0.16;
  const ribW = Math.max(3, Math.round(h * 0.165));
  R(pb, ribX, ribY, ribW, 1, P4.bone);
  R(pb, ribX + 1, ribY + Math.max(2, h * 0.055), ribW - 1, 1, P4.bone);
  if (!card) R(pb, ribX + 1, ribY + Math.max(2, h * 0.055) * 2, ribW - 2, 1, P4.bone);

  // ── 右臂：垂下、比正常长一截（到膝盖），末端 2px 拳
  tl(pb, c0 + bodyW - 1, shoulderY + h * 0.02, c0 + bodyW + h * 0.015, hip + h * 0.14, P4.flesh, Math.max(2, Math.round(h * 0.075)));

  // ── 头：前探 + **掉下来的下颌**（颌与颅之间一道 ink 开口）
  const hx = c0 - h * 0.035;
  ell(pb, hx - hr, hy - hr, hx + hr, hy + hr, P4.flesh);
  const mouthW = Math.max(3, Math.round(h * 0.075));
  R(pb, hx - mouthW / 2 - 1, jaw - Math.max(1, h * 0.02), mouthW + 2, Math.max(1, Math.round(h * 0.04)), P4.ink);
  R(pb, hx - mouthW / 2, jaw + Math.max(1, Math.round(h * 0.02)), mouthW, Math.max(1, Math.round(h * 0.035)), P4.flesh); // 下颌

  if (face) {
    const lx = Math.round(hx) - 2;
    const ey = Math.round(hy - hr * 0.35);
    if (card) cardFace(pb, lx, ey);
    else h3Face(pb, lx - 1, ey, 1, 3, 2);
  }
  if (atk) {
    // 抓击：前伸的手再往前一格（横移，不加高）
    R(pb, handX - Math.max(3, h * 0.10), armY + h * 0.01, Math.max(2, h * 0.05), Math.max(2, h * 0.07), P4.boneDark);
  }
}

/** 吸血鬼 · 高档（1.22）· 立领 + 收翼 + 及地斗篷。
 *  三次目检的结论都在这三条里：
 *    ① 立领**不能是两根竖尖**（猫耳），也**不能是一整块梯形面板**（灯罩）⇒
 *       两片**向外斜的短领片**，只到下颌，头必须完整露在领口上方；
 *    ② 翼必须**伸出斗篷轮廓之外**（第二版画在里侧，被斗篷全盖住）；
 *    ③ 斗篷中央**不能有一条贯通的深色竖条**（读成神父的圣带）⇒ 去掉内衬，
 *       中央只留下摆的一小段暗边。 */
function drawVampire(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false): void {
  const topY = base - h;
  const hr = card ? Math.max(3.0, h * 0.085) : h * 0.082;
  const hy = topY + hr * 1.05; // 颅心（头顶贴 topY）
  const jaw = hy + hr * 0.92;
  const shoulderY = jaw + hr * 0.30;
  const sleeveW = Math.max(4, Math.round(h * 0.115)); // 肩半宽
  const hem = base;

  // ── 蝠翼（先画，在斗篷**后面**，但外缘必须比斗篷宽 ≥0.05h）：亮紫 + 暗骨架
  // **收翼**：翼只从肩后露出两个尖（0.10h），主体的识别交给立领。
  // 给到 0.24h 时有三个扇贝的翼在 26px 下读成"泡泡袖"（目检实测两次）。
  const wingOut = Math.max(3, Math.round(h * 0.10));
  for (const dir of [-1, 1]) {
    const x0 = cx + dir * (sleeveW - 2);
    const x1 = cx + dir * (sleeveW + wingOut);
    const y0 = shoulderY + h * 0.06;
    pb.poly(
      [
        [x0, y0],
        [x1, y0 - h * 0.06],
        [x1 - dir * h * 0.01, y0 + h * 0.10],
        [x0 + dir * h * 0.02, y0 + h * 0.12],
      ],
      P4.plum,
    );
  }

  // ── 斗篷（暗紫，及地）：肩窄、下摆宽 + 三个尖；**中央不画竖条**
  pb.poly(
    [
      [cx - sleeveW, shoulderY],
      [cx + sleeveW, shoulderY],
      [cx + sleeveW * 1.55, hem - h * 0.12],
      [cx + sleeveW * 1.30, hem],
      [cx + sleeveW * 0.55, hem - h * 0.04],
      [cx, hem],
      [cx - sleeveW * 0.55, hem - h * 0.04],
      [cx - sleeveW * 1.30, hem],
      [cx - sleeveW * 1.55, hem - h * 0.12],
    ],
    P4.plumDark,
  );
  // 下摆内侧：两道亮边（plum），把"及地"与"垂坠"分开
  if (!card) {
    tl(pb, cx - sleeveW * 1.30, hem - 1, cx - sleeveW * 0.55, hem - h * 0.04 - 1, P4.plum, 1);
    tl(pb, cx + sleeveW * 0.55, hem - h * 0.04 - 1, cx + sleeveW * 1.30, hem - 1, P4.plum, 1);
  }

  // ── 立领：**两片高到耳际的领子**，把脸夹在中间（德拉库拉的唯一识别点）。
  //    与斗篷同色（同色相邻不违反断言 8；换成亮紫会读成围脖）。
  for (const dir of [-1, 1]) {
    pb.poly(
      [
        [cx + dir * hr * 0.62, jaw + h * 0.01],
        [cx + dir * (hr * 0.62 + h * 0.03), hy - hr * 0.35], // 领尖到耳际
        [cx + dir * (hr * 0.62 + h * 0.075), hy - hr * 0.15],
        [cx + dir * (sleeveW + h * 0.02), shoulderY + h * 0.04],
      ],
      P4.plumDark,
    );
  }

  // ── 头：骨白 + 深色头发（美人尖）+ 眼
  ell(pb, cx - hr, hy - hr * 0.95, cx + hr, hy + hr * 0.95, P4.bone);
  pb.poly(
    [
      [cx - hr * 1.0, hy - hr * 0.50],
      [cx + hr * 1.0, hy - hr * 0.50],
      [cx + hr * 1.0, hy - hr * 0.95],
      [cx - hr * 1.0, hy - hr * 0.95],
    ],
    P4.robeDark,
  );
  pb.poly(
    [
      [cx - hr * 0.55, hy - hr * 0.52],
      [cx + hr * 0.55, hy - hr * 0.52],
      [cx, hy - hr * 0.12],
    ],
    P4.robeDark,
  );
  if (face) {
    const lx = Math.round(cx) - 2;
    const ey = Math.round(hy - hr * 0.10);
    if (card) cardFace(pb, lx, ey);
    else h3Face(pb, lx - 1, ey, 1, 3, 2);
  }

  // ── 手：两只骨白的手从斗篷两侧探出（垂在身侧）
  for (const dir of [-1, 1]) {
    const wx = cx + dir * sleeveW - (dir < 0 ? Math.max(2, h * 0.045) : 0);
    R(pb, wx, shoulderY + h * 0.13, Math.max(2, h * 0.045), Math.max(2, h * 0.06), P4.bone);
  }

  if (atk) {
    // 扑击：翼尖再向外 1~2px（横移，不加高）
    for (const dir of [-1, 1]) {
      R(pb, cx + dir * (sleeveW + wingOut) - (dir < 0 ? 2 : 0), shoulderY - h * 0.02, 2, Math.max(2, h * 0.06), P4.plum);
    }
  }
}

/** 牛头怪 · 宽体档（0.95）· 横张肩背 + 持斧（spec §16.5：肩上斧 / 掷斧）。
 *  "稻草人"的两次成因都写在这里，别再犯：
 *    ① **肩是一条横杠 + 两只手臂同高同向** ⇒ 十字架；
 *    ② **手臂直接长在斜肩上**（没有腋窝缺口）⇒ 臂与躯干连成一块肉饼。
 *  现在的结构：窄躯干（±0.28h）+ **肩横板**（±0.46h）+ 两条从横板两端出发、
 *  **与躯干之间留缺口**的手臂；宽度由「左拳 −0.66h」与「斧面 +0.76h」拿到
 *  `w≈1.4h`，稳过宽体判据（§15.2 R1）。 */
function drawMinotaur(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false): void {
  const topY = base - h;
  const hr = card ? Math.max(2.9, h * 0.15) : h * 0.125;
  const hy = topY + hr * 1.12; // 颅心（角尖顶到 topY）
  const jawY = hy + hr * 0.90;
  const shoulderY = jawY + hr * 0.28;
  const hip = base - h * 0.30;
  const padW = Math.max(4, Math.round(h * 0.46)); // 肩横板半宽
  const armT = Math.max(3, Math.round(h * 0.115));

  // ── 斧：**柄竖直立在身体右侧**（不斜穿躯干，否则柄被躯干压掉一半 ⇒ 斧面浮空），
  //    斧面挂在柄的上段、向右伸出（出口：右上）。
  const haftX = cx + h * 0.50;
  tl(pb, haftX, hip + h * 0.06, haftX, shoulderY - h * 0.22, P4.plumDark, Math.max(2, Math.round(h * 0.055)));
  pb.poly(
    [
      [haftX, shoulderY - h * 0.22],
      [cx + h * 0.72, shoulderY - h * 0.16],
      [cx + h * 0.72, shoulderY - h * 0.02],
      // 斧面下缘**不许贴到右臂**：iron↔flesh 只有 ΔL*=4.1（门槛 8），
      // 下缘落到 shoulderY+0.05h 时正好压在手臂上 ⇒ `audit:b0 [8]` 必红。
      [haftX, shoulderY - h * 0.01],
    ],
    P4.iron,
  );
  if (!card) tl(pb, cx + h * 0.70, shoulderY - h * 0.15, cx + h * 0.70, shoulderY - h * 0.03, P4.ironLite, 1);

  // ── 腿：两条粗腿 + ink 蹄，中间 2px 透空（四足就举不起斧，§15.4）
  const legT = Math.max(4, Math.round(h * 0.14));
  const legGap = Math.max(2, Math.round(h * 0.055));
  tl(pb, cx - legGap / 2 - legT / 2, hip, cx - legGap / 2 - legT / 2 - h * 0.01, base - h * 0.04, P4.flesh, legT);
  tl(pb, cx + legGap / 2 + legT / 2, hip, cx + legGap / 2 + legT / 2 + h * 0.01, base - h * 0.04, P4.flesh, legT);
  R(pb, cx - legGap / 2 - legT / 2 - Math.max(2, h * 0.04), base - Math.max(1, h * 0.05), Math.max(3, legT + h * 0.02), Math.max(1, h * 0.045), P4.ink);
  R(pb, cx + legGap / 2 + legT / 2 - Math.max(1, h * 0.02), base - Math.max(1, h * 0.05), Math.max(3, legT + h * 0.02), Math.max(1, h * 0.045), P4.ink);

  // ── 腰布（紫，plumDark↔flesh 20.0）
  pb.poly(
    [
      [cx - h * 0.24, hip - h * 0.04],
      [cx + h * 0.24, hip - h * 0.04],
      [cx + h * 0.20, hip + h * 0.07],
      [cx - h * 0.20, hip + h * 0.07],
    ],
    P4.plumDark,
  );

  // ── 躯干：**窄**（±0.28h），上宽下略窄；肩线交给横板
  pb.poly(
    [
      [cx - h * 0.28, shoulderY + h * 0.02],
      [cx + h * 0.28, shoulderY + h * 0.02],
      [cx + h * 0.26, hip],
      [cx - h * 0.26, hip],
    ],
    P4.flesh,
  );
  // ── 肩横板：两端圆头（横张肩背），比躯干宽得多 ⇒ 出"肩"的读法
  for (const dir of [-1, 1]) {
    ell(pb, cx + dir * h * 0.10, shoulderY - h * 0.02, cx + dir * padW, shoulderY + h * 0.16, P4.flesh);
  }
  // 斜方肌：从脖子斜到肩板，把 ∧ 顶补上
  pb.poly(
    [
      [cx - h * 0.14, shoulderY - h * 0.04],
      [cx + h * 0.14, shoulderY - h * 0.04],
      [cx + padW * 0.92, shoulderY + h * 0.06],
      [cx - padW * 0.92, shoulderY + h * 0.06],
    ],
    P4.flesh,
  );

  // ── 左臂：从肩板左端**向下外斜**到 −0.62h，末端拳；与躯干之间靠肩板下缘出缺口
  tl(pb, cx - padW + h * 0.03, shoulderY + h * 0.10, cx - h * 0.60, hip - h * 0.02, P4.flesh, armT);
  ell(pb, cx - h * 0.68, hip - h * 0.10, cx - h * 0.56, hip + h * 0.03, P4.flesh);
  // ── 右臂：从肩板右端**向外下伸**，拳握在竖直的柄上（骨白拳↔plumDark 46）
  tl(pb, cx + padW - h * 0.04, shoulderY + h * 0.12, haftX - h * 0.02, shoulderY + h * 0.30, P4.flesh, armT);
  ell(pb, haftX - h * 0.075, shoulderY + h * 0.24, haftX + h * 0.05, shoulderY + h * 0.36, P4.boneDark);

  // ── 牛头：颅 + 吻 + 双角（角向外上，顶到 topY，不碰斧面）
  ell(pb, cx - hr, hy - hr * 0.98, cx + hr, hy + hr * 0.90, P4.flesh);
  R(pb, cx - hr * 0.52, hy + hr * 0.20, Math.max(3, hr * 1.04), Math.max(2, hr * 0.78), P4.flesh);
  if (!card) {
    R(pb, cx - hr * 0.36, hy + hr * 0.70, Math.max(1, hr * 0.20), Math.max(1, hr * 0.16), P4.ink); // 鼻孔
    R(pb, cx + hr * 0.16, hy + hr * 0.70, Math.max(1, hr * 0.20), Math.max(1, hr * 0.16), P4.ink);
  }
  for (const dir of [-1, 1]) {
    pb.poly(
      [
        [cx + dir * hr * 0.60, hy - hr * 0.55],
        [cx + dir * (hr * 0.60 + h * 0.045), hy - hr * 0.95],
        [cx + dir * (hr * 0.60 + h * 0.085), hy - hr * 0.72],
        [cx + dir * hr * 0.92, hy - hr * 0.10],
      ],
      P4.bone,
    );
  }
  if (face) {
    const lx = Math.round(cx) - 2;
    const ey = Math.round(hy - hr * 0.42);
    if (card) cardFace(pb, lx, ey);
    else h3Face(pb, lx - 1, ey, 1, 4, 3);
  }
  if (atk) {
    // 掷斧：手里那把不动，**多一把**小斧飞向右上（横移，不越 topY）
    pb.poly(
      [
        [cx + h * 0.80, topY + h * 0.18],
        [cx + h * 0.92, topY + h * 0.09],
        [cx + h * 0.94, topY + h * 0.21],
        [cx + h * 0.81, topY + h * 0.26],
      ],
      P4.iron,
    );
  }
}

/** 摄魂怪 · 巨物·飞行档（1.5）· 兜帽 + 破碎下摆 + 骨爪。
 *  §15.4 要"漂浮 + 破碎下摆（无脚），读不走路"。第二版的浅扇贝裙摆**落到了地上**，
 *  这一版裙摆收成 3~4 条长短不齐的垂布，外侧两角切高 —— 站着的人没有这种下摆。 */
function drawWraith(pb: PixBuf, cx: number, base: number, h: number, atk: boolean, face: boolean, card = false): void {
  const topY = base - h;
  const hoodR = Math.max(3.0, card ? h * 0.085 : h * 0.075);
  const hoodTop = topY;
  const hoodCy = topY + hoodR * 1.25;
  const shoulderY = hoodCy + hoodR * 1.05;
  const waist = base - h * 0.34;
  const hem = base;
  const bodyW = Math.max(4, Math.round(h * 0.155));

  // ── 裙（robe）：上窄下略宽，下缘**不收边**，交给垂布条
  pb.poly(
    [
      [cx - bodyW * 0.85, shoulderY],
      [cx + bodyW * 0.85, shoulderY],
      [cx + bodyW * 1.18, waist],
      [cx + bodyW * 1.02, hem - h * 0.10],
      [cx - bodyW * 1.02, hem - h * 0.10],
      [cx - bodyW * 1.18, waist],
    ],
    P4.robe,
  );
  // ── 破碎下摆：3~4 条垂布，长短不齐；**外侧两角切高 0.10h**（否则读成"站在地上"）
  const strips = card ? 3 : 4;
  const stripSpan = bodyW * 1.75;
  const stripW = Math.max(2, Math.round(stripSpan / (strips * 2 - 1)));
  const step = stripW + Math.max(2, Math.round(stripW * 0.9));
  for (let i = 0; i < strips; i++) {
    const sx = cx - stripSpan / 2 + i * step;
    // 长短不齐：1、3 条几乎到地，2、4 条断在半空 —— 站着的人没有这种下摆
    const drop = i === 1 ? h * 0.16 : i === 2 ? h * 0.05 : i === 0 ? h * 0.12 : h * 0.22;
    R(pb, sx, hem - h * 0.16, stripW, h * 0.16 + drop, P4.robeDark);
  }
  // 裙摆内侧的暗（左侧一块，给"布"一点厚度）
  pb.poly(
    [
      [cx - bodyW * 0.95, shoulderY + h * 0.02],
      [cx - bodyW * 0.55, shoulderY + h * 0.02],
      [cx - bodyW * 0.72, waist],
      [cx - bodyW * 1.05, waist],
    ],
    P4.robeDark,
  );

  // ── 上肢：左爪高举（出口：左上），右爪收到腰侧
  const armT = Math.max(3, Math.round(h * 0.075));
  const clX = cx - bodyW * 1.55;
  const clY = shoulderY - h * 0.10;
  tl(pb, cx - bodyW * 0.75, shoulderY + h * 0.03, clX + h * 0.02, clY + h * 0.05, P4.robe, armT);
  // 骨爪：腕 + 3 指（1~2px，指间留 1px 透空）+ 拇指
  const fw = Math.max(1, Math.round(h * 0.022));
  const fl = Math.max(3, Math.round(h * 0.075));
  R(pb, clX - fw, clY, Math.max(3, h * 0.06), Math.max(3, h * 0.055), P4.bone);
  for (let i = 0; i < 3; i++) {
    R(pb, clX - fw + i * (fw + 1), clY - fl, fw, fl + 1, P4.bone);
  }
  R(pb, clX + Math.max(3, h * 0.06) - fw, clY + 1, fw, fl * 0.7, P4.bone); // 拇指
  // 右臂：垂在体侧，末端 2 根短指（从袖口伸出）
  tl(pb, cx + bodyW * 0.75, shoulderY + h * 0.05, cx + bodyW * 1.12, waist - h * 0.04, P4.robe, armT);
  R(pb, cx + bodyW * 1.05, waist - h * 0.05, Math.max(3, h * 0.05), Math.max(2, h * 0.05), P4.bone);
  R(pb, cx + bodyW * 1.05, waist + h * 0.005, fw, Math.max(2, h * 0.04), P4.bone);

  // ── 兜帽：圆锥 + 帽口（梯形，内壁 robeDark）+ 帽尖略后掠
  pb.poly(
    [
      [cx, hoodTop],
      [cx + hoodR * 1.18, hoodTop + hoodR * 0.70],
      [cx + hoodR * 1.05, shoulderY + h * 0.01],
      [cx - hoodR * 1.05, shoulderY + h * 0.01],
      [cx - hoodR * 1.18, hoodTop + hoodR * 0.70],
    ],
    P4.robe,
  );
  pb.poly(
    [
      [cx - hoodR * 0.66, hoodTop + hoodR * 0.80],
      [cx + hoodR * 0.66, hoodTop + hoodR * 0.80],
      [cx + hoodR * 0.78, shoulderY],
      [cx - hoodR * 0.78, shoulderY],
    ],
    P4.robeDark,
  );

  // ── 脸：**glow 通道** —— 帽内两点 2×2 幽光，无 hi0、无嘴线
  if (face) {
    const lx = Math.round(cx) - 3;
    const ey = Math.round(hoodCy - hoodR * 0.10);
    R(pb, lx, ey, 2, 2, P4.glow);
    R(pb, lx + 3, ey, 2, 2, P4.glow);
  }
  if (atk) {
    // 吸魂：爪心一团幽光（glow↔bone 13.1），不加高
    R(pb, Math.round(clX - h * 0.01), Math.round(clY - h * 0.02), Math.max(2, h * 0.05), Math.max(2, h * 0.05), P4.glow);
  }
}

/* ==========================================================================
 * 5. 入口
 * ========================================================================== */

/** 绘制精度：`full` = 战斗帧（64×56 / 52×44）；`card` = 兵牌（43×37，直接从零画）。 */
export type ArtDetail = 'full' | 'card';

export interface BodyPlanDrawOpts {
  detail?: ArtDetail;
  /**
   * 直接画到**成品高度**（px）。给了它，`u` 由 `fitHeight ÷ plan.h` 反解 ——
   * 画出来的剪影就是最终像素高，**后面不再缩一次**。兵牌走这条（见
   * `buildPortraitFrame`）；战斗帧不给，仍按画布高统一铺满再由 `normalizeTier` 归位。
   */
  fitHeight?: number;
  /** 脚底到画布底的像素数。默认 3（战斗帧留描边 + 1px 底隙）。 */
  bottomPad?: number;
}

/**
 * 把某个兵种画进 `pb`（**不含描边、不含归一化** —— 那两步在 `buildB0Frame`）。
 *
 * @param kind `map` 用同一套形状按更小的 `u` 画（地图图标只要认得出体形档）。
 * @returns 是否画了（false = 这个 id 不归本模块管，调用方继续走旧树）。
 */
export function drawBodyPlanUnit(
  pb: PixBuf,
  unit: string,
  kind: 'map' | 'idle' | 'atk',
  opts: BodyPlanDrawOpts = {},
): boolean {
  const baseUnit = baseUnitOf(unit);
  const elite = baseUnit !== unit;
  const plan = planOf(unit);
  if (!plan) return false;
  // `u` = 1 个 H_REF 单位的像素数。
  //   战斗帧：画布高 ÷ 1.54（天使触顶），再按「最高的那个兵也要留 2px 描边余量」压一次；
  //   兵牌：fitHeight ÷ plan.h ⇒ **每个兵一次性画到自己最终的像素高度**，不经过任何缩放。
  const u =
    opts.fitHeight !== undefined
      ? opts.fitHeight / plan.h
      : Math.min(pb.h / H_REF_HUGE, (pb.h - 4) / plan.h);
  const h = plan.h * u;
  const base = opts.bottomPad !== undefined ? pb.h - opts.bottomPad : pb.h - 3;
  const cx = pb.w / 2;
  const atk = kind === 'atk';
  const card = opts.detail === 'card';
  // 地图帧不画脸：那一步只负责**剪影**（§15.2 的分工），而 52×44 画布上归一化后
  // 只剩 20~24px 高，2×2 的眼块会占掉脑袋宽度的 2/3 —— 22px 下读成一条黑杠。
  // 兵牌（cu_* / cu_*_atk）必须画，`audit:expr` 认的就是它们。
  const face = kind !== 'map';
  switch (baseUnit) {
    case 'p1_child':
      drawChild(pb, cx, base, h, atk, face, card, elite);
      break;
    case 'p1_crossbow':
      drawCrossbow(pb, cx, base, h, atk, face, card, elite);
      break;
    case 'p1_eagle':
      drawEagle(pb, cx, base, h, atk, face, card, elite);
      break;
    case 'p1_knight':
      drawKnight(pb, cx, base, h, atk, face, card, elite);
      break;
    case 'p1_angel':
      drawAngel(pb, cx, base, h, atk, face, card, elite);
      break;
    case 'p2_matchman':
      drawMatchman(pb, cx, base, h, atk, face, card);
      break;
    case 'p2_bronze':
      drawBronze(pb, cx, base, h, atk, face, card);
      break;
    case 'p2_lavagiant':
      drawLavaGiant(pb, cx, base, h, atk, face, card);
      break;
    case 'p2_threewolf':
      drawThreeWolf(pb, cx, base, h, atk, face, card);
      break;
    case 'p2_devil':
      drawDevil(pb, cx, base, h, atk, face, card);
      break;
    case 'p3_dwarf':
      drawDwarf(pb, cx, base, h, atk, face, card);
      break;
    case 'p3_junglearcher':
      drawJungleArcher(pb, cx, base, h, atk, face, card);
      break;
    case 'p3_treant':
      drawTreant(pb, cx, base, h, atk, face, card);
      break;
    case 'p3_ape':
      drawApe(pb, cx, base, h, atk, face, card);
      break;
    case 'p3_greendragon':
      drawGreenDragon(pb, cx, base, h, atk, face, card);
      break;
    case 'p4_skeleton':
      drawSkeleton(pb, cx, base, h, atk, face, card);
      break;
    case 'p4_zombie':
      drawZombie(pb, cx, base, h, atk, face, card);
      break;
    case 'p4_vampire':
      drawVampire(pb, cx, base, h, atk, face, card);
      break;
    case 'p4_minotaur':
      drawMinotaur(pb, cx, base, h, atk, face, card);
      break;
    case 'p4_wraith':
      drawWraith(pb, cx, base, h, atk, face, card);
      break;
    default:
      return false;
  }
  return true;
}

/** 供门控/审计读：某兵种的**目标剪影高**（像素，含 1px 描边，口径 = 成品帧 bbox 高）。 */
export function bodyPlanTargetHeight(unit: string, canvasH: number): number | null {
  const plan = planOf(unit);
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
