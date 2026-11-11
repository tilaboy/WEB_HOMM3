/**
 * 高级兵自带魔法（spec §10.3，S4 · 2026-11-11）。
 *
 * **为什么只有 6 条、为什么是这 6 个兵**
 *   天使（复活）与摄魂怪（威压）已经有招牌能力，再挂一条会变成"规则堆叠"；
 *   三头狼 / 吸血鬼那两族的位置也被族动词与吸血占着。所以**不是每兵一个法术，是 6 条**，
 *   只给"没有招牌能力的 T4/T5"。分配是定稿：**只许调数值，不许换兵** ——
 *   换兵会让 §16.2 的战力读数失去解释。
 *
 * **四条边界（全部是硬约束，改之前先读）**
 *   ① 不耗蓝、不占按钮、不占行动 —— 触发即结算。战斗右下角只有 1 个「施法」键。
 *   ② 一律自动（被动 / 光环 / 每战一次的条件触发），玩家不需要"想起来用"。
 *   ③ **必须有上限**：每场 1~3 次 或 每回合 1 次。
 *      ⚠️ 豁免：光环与被动（`oath` / `lavaArmor` / `dragonFear`）**不受次数约束**，
 *      但它们各自有**数值上限**（−1 伤害 / 25% 且不致死 / −1 攻 且只作用邻格）。
 *      把「熔岩护甲」硬套成"每场 2 次"会让一个被动变成稀缺资源 —— 那不是上限，是断供。
 *   ④ 不与族动词（冲锋 / 加班 / 缠根 / 事故）、也不与招牌能力（飞行 / 自复活 / 吸血 /
 *      威压 / 免反击）重叠。
 *
 * **强度口径**：T4 的自带 ≈ 一个 L1 法术的 50%；T5 的 1 次性效果 ≈ 一个 L3 法术的 60%。
 * 超了**先砍次数，不砍数值** —— 次数是玩家能预期的，数值会让人觉得"随机"。
 */
import type { InnateId } from '../types.js';

export type InnateKind = 'aura' | 'passive' | 'trigger';

export interface InnateDef {
  id: InnateId;
  name: string;
  /** 拥有它的兵（用于探针反查与文档；战斗里读 `UnitType.innate`，**不读这张表反查**）。 */
  unitId: string;
  kind: InnateKind;
  /** 触发条件，一句话。UI 的悬停提示与战报都用这一句。 */
  trigger: string;
  /** 效果，一句话（含上限）。 */
  detail: string;
  /**
   * 每场可用次数；**0 = 无限**（光环 / 被动）。
   * 只有 `trigger` 类才有非零值 —— 这也是"上限"那条边界的唯一落点。
   */
  perBattle: number;
}

export const INNATES: Record<InnateId, InnateDef> = {
  oath: {
    id: 'oath',
    name: '誓约',
    unitId: 'p1_knight',
    kind: 'aura',
    trigger: '邻格友军受近战攻击',
    detail: '该次伤害 −1（每回合每格 1 次）',
    perBattle: 0,
  },
  lavaArmor: {
    id: 'lavaArmor',
    name: '熔岩护甲',
    unitId: 'p2_lavagiant',
    kind: 'passive',
    trigger: '被近战攻击',
    detail: '反弹 25% 伤害（不致死）',
    perBattle: 0,
  },
  flameBody: {
    id: 'flameBody',
    name: '烈焰缠身',
    unitId: 'p2_devil',
    kind: 'trigger',
    trigger: '被近战命中',
    detail: '攻击者受 6 点火焰伤害',
    perBattle: 2,
  },
  stoneSuppress: {
    id: 'stoneSuppress',
    name: '投石压制',
    unitId: 'p3_ape',
    kind: 'trigger',
    trigger: '远程命中',
    detail: '目标速度 −2（到它下次行动）',
    perBattle: 3,
  },
  dragonFear: {
    id: 'dragonFear',
    name: '龙威',
    unitId: 'p3_greendragon',
    kind: 'aura',
    trigger: '每回合开始',
    detail: '邻格敌军攻击 −1',
    perBattle: 0,
  },
  stun: {
    id: 'stun',
    name: '震慑',
    unitId: 'p4_minotaur',
    kind: 'trigger',
    trigger: '近战命中',
    detail: '目标防御 −2（到战斗结束）',
    perBattle: 2,
  },
};

/** 反查：哪个兵带哪条（探针与文档用；战斗里不要反向查，读 `UnitType.innate`）。 */
export const INNATE_BY_UNIT: Record<string, InnateId> = Object.fromEntries(
  Object.values(INNATES).map((d) => [d.unitId, d.id]),
);

/**
 * 一句话提示（悬停 / 战报首行）。`null` = 这个兵没有自带魔法。
 *
 * 条件与效果之间**主动换行**（`\n`）而不是交给 240px 的浮框去折：
 * 6 条里有 4 条整行超过 240px，自动折行的断点会落在词中间
 * （×1 实测：「⇒ 邻格敌军攻」/「击 −1」，把"攻击"劈成两半）。
 * 断在 `⇒` 后面是语法的自然分界，也统一了六条的排版。
 */
export function innateHint(id: InnateId | undefined): string | null {
  if (!id) return null;
  const d = INNATES[id];
  return `${d.name}：${d.trigger}\n⇒ ${d.detail}`;
}

/**
 * 部队浮框要印的**招牌能力 + 自带魔法**文案（0~2 行）。
 *
 * 为什么放在 core 而不是 `BattleScreen.unitTipText` 里就地拼：
 * 这十条**不占按钮、不耗蓝、没有施法动作**，界面上唯一的存在就是这几行字。
 * 就地拼等于"只有写代码的人知道"，而且探针（`probe:innate`）断言不到 ——
 * 族动词（`chargeHint` 等）当初就是因为同一个理由搬到 core 的。
 *
 * 顺序固定：招牌能力（身份）在前，自带魔法（附加）在后（§16.3 → §10.3）。
 * 速度类（飞行）不印"速度 +N"之类的推算值：飞行没有数值，只有通行规则。
 */
export function unitAbilityHints(def: {
  canFly?: boolean;
  drain?: number;
  selfRevive?: number;
  dread?: boolean;
  innate?: { id: InnateId };
}): string[] {
  const out: string[] = [];
  if (def.canFly) out.push('飞行：可越过城墙与护城河');
  // 这两行按 240px 的浮框宽度收过（`BattleScreen.unitTipText` 的 `.bt-tip`）。
  // 「不屈」那行**主动换行**：不换的话会断在"（1 次/"后面 —— 括号被劈开，
  // 看起来像排版事故（×1 截图实测），而 `\n` 断出来的是一个整齐的两行块。
  if (def.drain) out.push(`吸血：近战伤害后回补 ${Math.round(def.drain * 100)}% 人数`);
  if (def.selfRevive)
    out.push(`不屈：歼灭后重返战场\n（1 次/场，${Math.round(def.selfRevive * 100)}% 兵力）`);
  if (def.dread) out.push('威压：命中让目标速度 −2');
  const inn = innateHint(def.innate?.id);
  if (inn) out.push(inn);
  return out;
}
