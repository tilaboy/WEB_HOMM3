import type { Difficulty, MapLayout, MapSize } from '../types.js';
import type { GenOptions } from '../map/generator.js';

/**
 * 试玩场景（`design/maps/playtest-scenarios.md`）。
 *
 * 本作没有地图编辑器，`createGame(...)` 程序生成、**同种子必然同图**。所以"一张设计
 * 好的图"在这里的等价物是：**把一个 config 固定下来 + 开放少量"生成后盖章"的钩子**。
 * 规格里两张试玩图的全部设计意图都用下面这些覆盖项表达，**不引入新生成流程**。
 *
 * 分层（与规格 §1.2 一致）：
 *   - `config`  = 固定开局设置（进 `GameConfig`，随即存盘）；
 *   - `gen`     = **生成期**覆盖（在现有生成流程内改参数）；
 *   - `stamp`   = **生成后**盖章（唯一会"新增一次生成"的钩子 ⇒ 必须独立 rng）；
 *   - `aiIntent`= AI 初始倾向（图二 = `rush`）。
 *
 * **缺省（无 `scenario`）时本文件不参与任何分支** ⇒ 自由对局与今天逐字节一致。
 */

/** 生成期覆盖：在现有生成流程内改参数（不是新流程）。缺省项 = 不改。 */
export interface ScenarioGen {
  /** 覆盖中立城数量（`neutralCount`，现为 `max(2, ...)`）。图一 = 0。 */
  neutralTowns?: number;
  /** 覆盖宝库区数量（`vaultCount`）。图一 = 0。 */
  vaults?: number;
  /** 是否执行"隘口守卫"循环（把强档野怪摆在深处宝贝的必经路口）。图一 = `false`。 */
  chokepointGuards?: boolean;
  /** 覆盖野怪总数（现为 `max(6, round(18k))`）。图一 = 5。 */
  monsterCount?: number;
  /** 覆盖野怪分档的距离阈值（现为 `9k` / `18k`）。图一 = 全都算弱档。 */
  monsterTierBand?: { weakMax: number; midMax: number };
}

/** 生成后盖章。**必须用独立 rng 流**（见 §1.3 红线），否则同种子地形会整体错位。 */
export interface ScenarioStamp {
  /**
   * 中线门控（图二）：在两家主城连线的**中点附近**、按现有隘口评分取最优空格，
   * 放 1 只 `tier` 档野怪 + 一份金奖励。`mid`（非 `strong`）—— 强档双方前期都
   * 打不过 ⇒ 门控变墙、接触日无限延后（§3.2）。
   */
  midGuard?: { tier: 'mid' | 'strong'; reward: { kind: 'gold'; amount: [number, number] } };
}

/** AI 初始倾向：`normal` = 现状；`rush` = 仅"尚未见过任何玩家资产"前朝玩家方向推进。 */
export type AiIntent = 'normal' | 'rush';

/** 目标清单（图一）：只读 `GameState` 判定，零新系统。`check` 是给人看的说明。 */
export interface ScenarioObjective {
  id: string;
  text: string;
  check: string;
}

export interface ScenarioDef {
  id: string;
  name: string;
  sub: string;
  config: { size: MapSize; layout: MapLayout; seed: number; opponents: number; difficulty: Difficulty };
  gen?: ScenarioGen;
  stamp?: ScenarioStamp;
  aiIntent?: AiIntent;
  objectives?: ScenarioObjective[];
}

/* ------------------------------------------------------------------ *
 * 图一《教学场》—— 教操作：移动 / 拾取 / 打第一仗 / 建第一座建筑
 * 小型 24×24 · 旷野 · 0 对手 · 轻松 · seed 247944（规格 §2）
 * ------------------------------------------------------------------ */
const TUTORIAL: ScenarioDef = {
  id: 'tutorial',
  name: '教学场',
  sub: '小型 · 无对手 · 练操作',
  config: { size: 'small', layout: 'wild', seed: 247944, opponents: 0, difficulty: 'easy' },
  gen: {
    // 四处"减法"：教学图不要"抢城 / 打宝库 / 被强怪卡路"这些变量，只留弱怪。
    neutralTowns: 0,
    vaults: 0,
    chokepointGuards: false,
    monsterCount: 5,
    monsterTierBand: { weakMax: 1e9, midMax: 1e9 }, // 全图只有弱怪
  },
  objectives: [
    // ① 阈值 140 **不是 60**：`revealed` 长度恒等于全图格数，且开局两个视野圆并集
    //    就有 66~83 格（seed 247944 = 82）⇒ 阈值必须显著高于开局值、又能被 3~4 步达成。
    { id: 'walk', text: '你已经会走路了', check: '已揭开格数 ≥ 140' },
    // ② 英雄阵亡后 `heroes['hero1']` 会消失 ⇒ UI 侧必须**锁存**（达成即保持为真）。
    { id: 'firstwin', text: '你打赢了第一仗', check: 'hero1.exp > 0' },
    // ③ 复用 `town.ts` 的 `ownedMines`，别在 UI 里再写一遍 filter。开局 = 0。
    { id: 'mine', text: '你有自己的矿了', check: 'ownedMines(p1).length ≥ 2' },
  ],
};

/* ------------------------------------------------------------------ *
 * 图二《对决场》—— 教策略：发育 vs 进攻；英雄死活的后果
 * 中型 32×32 · 同心环 · 1 对手 · 普通 · seed 170774（规格 §3）
 * ------------------------------------------------------------------ */
const DUEL: ScenarioDef = {
  id: 'duel',
  name: '对决场',
  sub: '中型 · 一个会主动打你的对手',
  config: { size: 'medium', layout: 'ring', seed: 170774, opponents: 1, difficulty: 'normal' },
  // 实测：默认 AI 在中型图上 21 天里 8/8 种子从不接近玩家 ⇒ 本图必须靠 rush 才成立。
  aiIntent: 'rush',
  stamp: { midGuard: { tier: 'mid', reward: { kind: 'gold', amount: [1800, 3200] } } },
};

export const SCENARIOS: ScenarioDef[] = [TUTORIAL, DUEL];

export const SCENARIO_BY_ID: Record<string, ScenarioDef> = Object.fromEntries(
  SCENARIOS.map((s) => [s.id, s]),
);

/** 把场景的固定 config 展开成 `GameConfig` 的生成选项（UI 侧用；`scenario` 只放 id）。 */
export function scenarioGenOptions(s: ScenarioDef): GenOptions {
  return { ...s.config, scenario: s.id };
}
