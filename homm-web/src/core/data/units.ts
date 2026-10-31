import type { FactionId, UnitType } from '../types.js';
import { FACTIONS } from './factions.js';
import { powerRef } from '../combat/damage.js';

/**
 * 兵种表（阵容 v3，2026-10-31 B1 落地）。
 *
 * **id 采用 canonical 形式 `p{n}_{shortname}`**（`design/gdd/races.md §6.4` / 主理人裁决 D-63），
 * 阵容与对照表见 `spec-implementation.md §16.1 / §16.6`。
 *
 * ⚠️ **帧名不再由 id 直拼**：图集里装的仍是旧 id 的帧，`src/render/unitFrames.ts` 的
 * `FRAME_ALIAS` 负责把新 id 映到旧帧名（S0）。想在别处拼 `u_*_map` / `cu_*` 会被
 * `probe:frames` 判红 —— 那条规矩就是为了防止"改名一次、全表缺帧"。
 *
 * 数值来源：§16.2（B 口径尺子下的定稿表）；`aiValue` 由 `powerRef()` 生成（§25.3），
 * 远程 ×1.25，**浮点、不与 `cost` 联动**。`expValue` 仍是档位基线（设计缺口见下）。
 */

/**
 * `body` / `accent` 暂取**阵营主题色**作占位（`FACTIONS[f].color` / `.dark`）。
 * 这两个字段目前唯一消费者是 `HeroPanel` 的兵种圆点（`dot.style.background = u.body`），
 * 不参与任何战斗计算；等美术给出逐兵种色板（`art-bible §3.3` 口径）再替换。
 */
const theme = (f: FactionId): { body: string; accent: string } => ({
  body: FACTIONS[f].color,
  accent: FACTIONS[f].dark,
});

/**
 * ⚠️ **`expValue` 是设计缺口**：`races.md` 全文没有规定经验值（`expValue` / `经验` 零命中），
 * 所以这里沿用现有 5 级树的**档位基线**（T1 4 / T2 12 / T3 20 / T4 45 / T5 120），
 * 只保证「高阶兵给的经验更多」这个手感不破，具体数值待 H3 批（换 H3 表 × k）。
 */
const EXP_BY_TIER = [4, 12, 20, 45, 120];

/**
 * `aiValue` 的**唯一口径**：`powerRef()`（B 口径战力）× 远程 1.25。
 *
 * 为什么不在这里手写表：§25.3 明说"B1 落地时由 `powerRef()` 重新生成，容差 ±2%"，
 * 而 `balance-p2.mjs` 会把代码值与 §25.3 逐行对差。手写一张表就等于造第二个真值源。
 *
 * 为什么**只有远程**折：飞行 / 吸血 / 免反击已经被 `quickBattle` 真打覆盖，
 * 再折一次是双重计价（决策 48）。远程不进真打（AI 的攻城判断与守家需求只读标量），
 * 而同血同伤时远程实际输出更高 ⇒ 只补这一项。
 */
const aiValueOf = (u: Pick<UnitType, 'attack' | 'defense' | 'damageMin' | 'damageMax' | 'hp'>, remote = false): number => {
  // 直接调生产公式（`damage.ts` 的 `powerRef`），**不在这里抄一遍**：
  // 抄一遍就是第二个真值源，改尺子时会有一半的兵留在旧口径上。
  const base = powerRef(u);
  // 保留 2 位：字段是浮点（决策 63），但多余精度只会让存档与读数变脏
  return Math.round(base * (remote ? 1.25 : 1) * 100) / 100;
};

export const UNITS: Record<string, UnitType> = {
  /* ================= p1 人类 —— 「准时打卡的正义」 ================= */

  p1_child: {
    id: 'p1_child', name: '小孩', tier: 1,
    attack: 1, defense: 1, damageMin: 1, damageMax: 2, hp: 3, speed: 2,
    expValue: EXP_BY_TIER[0], growthPerWeek: 16, cost: { gold: 20 },
    aiValue: aiValueOf({ attack: 1, defense: 1, damageMin: 1, damageMax: 2, hp: 3 }),
    ...theme('p1'),
  },
  p1_crossbow: {
    id: 'p1_crossbow', name: '弩手', tier: 2,
    attack: 4, defense: 2, damageMin: 2, damageMax: 4, hp: 10, speed: 4, shots: 14,
    expValue: EXP_BY_TIER[1], growthPerWeek: 5, cost: { gold: 110 },
    aiValue: aiValueOf({ attack: 4, defense: 2, damageMin: 2, damageMax: 4, hp: 10 }, true),
    ...theme('p1'),
  },
  p1_eagle: {
    id: 'p1_eagle', name: '鹰', tier: 3,
    attack: 6, defense: 3, damageMin: 4, damageMax: 6, hp: 14, speed: 9,
    expValue: EXP_BY_TIER[2], growthPerWeek: 4, cost: { gold: 240 },
    anim: 'thrust',
    aiValue: aiValueOf({ attack: 6, defense: 3, damageMin: 4, damageMax: 6, hp: 14 }),
    ...theme('p1'),
  },
  p1_knight: {
    id: 'p1_knight', name: '骑士', tier: 4,
    attack: 7, defense: 8, damageMin: 7, damageMax: 9, hp: 36, speed: 7,
    expValue: EXP_BY_TIER[3], growthPerWeek: 3, cost: { gold: 520, ore: 3 },
    anim: 'thrust',
    aiValue: aiValueOf({ attack: 7, defense: 8, damageMin: 7, damageMax: 9, hp: 36 }),
    ...theme('p1'),
  },
  p1_angel: {
    id: 'p1_angel', name: '天使', tier: 5,
    attack: 10, defense: 10, damageMin: 13, damageMax: 17, hp: 65, speed: 8,
    expValue: EXP_BY_TIER[4], growthPerWeek: 2, cost: { gold: 1500, ore: 5, wood: 5 },
    aiValue: aiValueOf({ attack: 10, defense: 10, damageMin: 13, damageMax: 17, hp: 65 }),
    ...theme('p1'),
  },

  /* ================= p2 妖兽 —— 「莽就完事了」 ================= */

  p2_matchman: {
    id: 'p2_matchman', name: '火柴人', tier: 1,
    attack: 2, defense: 1, damageMin: 1, damageMax: 3, hp: 3, speed: 4, shots: 8,
    expValue: EXP_BY_TIER[0], growthPerWeek: 12, cost: { gold: 30 },
    aiValue: aiValueOf({ attack: 2, defense: 1, damageMin: 1, damageMax: 3, hp: 3 }, true),
    ...theme('p2'),
  },
  p2_bronze: {
    id: 'p2_bronze', name: '铜人', tier: 2,
    attack: 3, defense: 9, damageMin: 2, damageMax: 3, hp: 15, speed: 2,
    expValue: EXP_BY_TIER[1], growthPerWeek: 5, cost: { gold: 120, wood: 2 },
    anim: 'smash',
    aiValue: aiValueOf({ attack: 3, defense: 9, damageMin: 2, damageMax: 3, hp: 15 }),
    ...theme('p2'),
  },
  p2_threewolf: {
    id: 'p2_threewolf', name: '三头狼', tier: 3,
    attack: 7, defense: 3, damageMin: 3, damageMax: 8, hp: 13, speed: 7,
    expValue: EXP_BY_TIER[2], growthPerWeek: 4, cost: { gold: 230 },
    anim: 'slash',
    // 「三口齐咬」：**扑过去**咬一口，守方这一下够不着回手（HOMM3 吸血伯爵同款）。
    // 两个前提来自旧 `p4_hopgolem`（蹦跳魔偶）的实测，别当成可选项：
    //   ① 必须移动 ≥1 格（站着原地咬不叫"扑"）——顺带避免"贴脸开打先手必赢"的退化；
    //   ② 每队每场一次 —— 无限次会把同速镜像推到 95%（结构性必赢），见 §11.7。
    noRetaliate: true,
    aiValue: aiValueOf({ attack: 7, defense: 3, damageMin: 3, damageMax: 8, hp: 13 }),
    ...theme('p2'),
  },
  p2_lavagiant: {
    id: 'p2_lavagiant', name: '熔岩巨人', tier: 4,
    attack: 9, defense: 7, damageMin: 6, damageMax: 9, hp: 34, speed: 4,
    expValue: EXP_BY_TIER[3], growthPerWeek: 3, cost: { gold: 520, ore: 4 },
    anim: 'smash',
    aiValue: aiValueOf({ attack: 9, defense: 7, damageMin: 6, damageMax: 9, hp: 34 }),
    ...theme('p2'),
  },
  p2_devil: {
    id: 'p2_devil', name: '恶魔', tier: 5,
    attack: 12, defense: 7, damageMin: 14, damageMax: 18, hp: 55, speed: 9,
    expValue: EXP_BY_TIER[4], growthPerWeek: 2, cost: { gold: 1250, ore: 5 },
    anim: 'smash',
    aiValue: aiValueOf({ attack: 12, defense: 7, damageMin: 14, damageMax: 18, hp: 55 }),
    ...theme('p2'),
  },

  /* ================= p3 精灵 —— 「以静制动的花园保安」 ================= */

  p3_dwarf: {
    id: 'p3_dwarf', name: '矮人', tier: 1,
    attack: 2, defense: 3, damageMin: 1, damageMax: 2, hp: 5, speed: 3,
    expValue: EXP_BY_TIER[0], growthPerWeek: 10, cost: { gold: 25 },
    anim: 'smash',
    aiValue: aiValueOf({ attack: 2, defense: 3, damageMin: 1, damageMax: 2, hp: 5 }),
    ...theme('p3'),
  },
  p3_junglearcher: {
    id: 'p3_junglearcher', name: '丛林射手', tier: 2,
    attack: 4, defense: 3, damageMin: 2, damageMax: 3, hp: 11, speed: 4, shots: 16,
    expValue: EXP_BY_TIER[1], growthPerWeek: 5, cost: { gold: 115 },
    aiValue: aiValueOf({ attack: 4, defense: 3, damageMin: 2, damageMax: 3, hp: 11 }, true),
    ...theme('p3'),
  },
  p3_treant: {
    id: 'p3_treant', name: '树人', tier: 3,
    attack: 4, defense: 10, damageMin: 3, damageMax: 5, hp: 20, speed: 2,
    expValue: EXP_BY_TIER[2], growthPerWeek: 4, cost: { gold: 260, wood: 3 },
    anim: 'smash',
    aiValue: aiValueOf({ attack: 4, defense: 10, damageMin: 3, damageMax: 5, hp: 20 }),
    ...theme('p3'),
  },
  p3_ape: {
    id: 'p3_ape', name: '猿人', tier: 4,
    attack: 8, defense: 4, damageMin: 7, damageMax: 10, hp: 30, speed: 5, shots: 10,
    expValue: EXP_BY_TIER[3], growthPerWeek: 4, cost: { gold: 540, wood: 2 },
    anim: 'thrust',
    aiValue: aiValueOf({ attack: 8, defense: 4, damageMin: 7, damageMax: 10, hp: 30 }, true),
    ...theme('p3'),
  },
  p3_greendragon: {
    id: 'p3_greendragon', name: '绿龙', tier: 5,
    attack: 11, defense: 9, damageMin: 11, damageMax: 15, hp: 62, speed: 7,
    expValue: EXP_BY_TIER[4], growthPerWeek: 2, cost: { gold: 1100, gem: 2, wood: 5 },
    anim: 'slash',
    aiValue: aiValueOf({ attack: 11, defense: 9, damageMin: 11, damageMax: 15, hp: 62 }),
    ...theme('p3'),
  },

  /* ================= p4 亡灵 —— 「魔法实验室事故」 ================= */

  p4_skeleton: {
    id: 'p4_skeleton', name: '骷髅', tier: 1,
    attack: 2, defense: 1, damageMin: 1, damageMax: 3, hp: 4, speed: 4,
    expValue: EXP_BY_TIER[0], growthPerWeek: 9, cost: { gold: 25 },
    aiValue: aiValueOf({ attack: 2, defense: 1, damageMin: 1, damageMax: 3, hp: 4 }),
    ...theme('p4'),
  },
  p4_zombie: {
    id: 'p4_zombie', name: '僵尸', tier: 2,
    attack: 2, defense: 8, damageMin: 2, damageMax: 3, hp: 15, speed: 2,
    expValue: EXP_BY_TIER[1], growthPerWeek: 5, cost: { gold: 115 },
    anim: 'smash',
    aiValue: aiValueOf({ attack: 2, defense: 8, damageMin: 2, damageMax: 3, hp: 15 }),
    ...theme('p4'),
  },
  p4_vampire: {
    id: 'p4_vampire', name: '吸血鬼', tier: 3,
    attack: 7, defense: 4, damageMin: 3, damageMax: 6, hp: 15, speed: 8,
    expValue: EXP_BY_TIER[2], growthPerWeek: 5, cost: { gold: 250, crystal: 1 },
    aiValue: aiValueOf({ attack: 7, defense: 4, damageMin: 3, damageMax: 6, hp: 15 }),
    ...theme('p4'),
  },
  p4_minotaur: {
    id: 'p4_minotaur', name: '牛头怪', tier: 4,
    attack: 9, defense: 6, damageMin: 7, damageMax: 10, hp: 30, speed: 6, shots: 10,
    expValue: EXP_BY_TIER[3], growthPerWeek: 5, cost: { gold: 540, ore: 3 },
    anim: 'thrust',
    aiValue: aiValueOf({ attack: 9, defense: 6, damageMin: 7, damageMax: 10, hp: 30 }, true),
    ...theme('p4'),
  },
  p4_wraith: {
    id: 'p4_wraith', name: '摄魂怪', tier: 5,
    attack: 10, defense: 8, damageMin: 10, damageMax: 13, hp: 60, speed: 9,
    expValue: EXP_BY_TIER[4], growthPerWeek: 2, cost: { gold: 800, crystal: 4 },
    aiValue: aiValueOf({ attack: 10, defense: 8, damageMin: 10, damageMax: 13, hp: 60 }),
    ...theme('p4'),
  },

  /* ============ 中立野怪（**不迁**，D-58 §6.4.4） ============ */
  /* 不与阵营绑定、本身已是唯一词 —— 改名只有风险没有收益。
     `aiValue` 同样按 `powerRef()` 算（无远程）⇒ 与族内兵共用一把尺。 */

  wolf: {
    id: 'wolf', name: '野狼', tier: 1,
    attack: 3, defense: 1, damageMin: 2, damageMax: 3, hp: 8, speed: 6,
    expValue: 8, growthPerWeek: 0, cost: {},
    aiValue: aiValueOf({ attack: 3, defense: 1, damageMin: 2, damageMax: 3, hp: 8 }),
    body: '#8a8a92', accent: '#3a3a42',
  },
  boar: {
    id: 'boar', name: '野猪', tier: 3,
    attack: 5, defense: 4, damageMin: 3, damageMax: 5, hp: 24, speed: 4,
    expValue: 18, growthPerWeek: 0, cost: {},
    anim: 'smash',
    aiValue: aiValueOf({ attack: 5, defense: 4, damageMin: 3, damageMax: 5, hp: 24 }),
    body: '#6b4a2f', accent: '#241a10',
  },
  ogre: {
    id: 'ogre', name: '食人魔', tier: 4,
    attack: 8, defense: 5, damageMin: 6, damageMax: 10, hp: 30, speed: 3,
    expValue: 40, growthPerWeek: 0, cost: {},
    anim: 'smash',
    aiValue: aiValueOf({ attack: 8, defense: 5, damageMin: 6, damageMax: 10, hp: 30 }),
    body: '#4f6b3a', accent: '#1e2a15',
  },
};

/**
 * 阵营 × tier → canonical id（按 T1→T5）。**tier 解析的唯一入口**
 * （`races.md §6.4.2` 规则 3）。
 *
 * `dwell1~5` 只写 `tier`，由这张表解析 —— 否则同一座 `dwell3` 在四族里长出的都是同一种兵
 * （`core/game/town.ts` 的 `applyWeeklyGrowth` / `recruitRows` / `build` 三处都直接取 `g.unitTypeId`）。
 */
export const FACTION_UNITS: Record<FactionId, readonly [string, string, string, string, string]> = {
  p1: ['p1_child', 'p1_crossbow', 'p1_eagle', 'p1_knight', 'p1_angel'],
  p2: ['p2_matchman', 'p2_bronze', 'p2_threewolf', 'p2_lavagiant', 'p2_devil'],
  p3: ['p3_dwarf', 'p3_junglearcher', 'p3_treant', 'p3_ape', 'p3_greendragon'],
  p4: ['p4_skeleton', 'p4_zombie', 'p4_vampire', 'p4_minotaur', 'p4_wraith'],
};

/**
 * `owner + tier` → canonical id。
 *
 * **中立方返回 `null`，不 fallback 到 p1**（`races.md §6.4.2` 规则 5）：
 * 静默 fallback 会把「中立城被当成晨曦」这类 bug 藏起来。调用方拿到 `null` 应跳过并记日志。
 * 这条路径当前实际不可达（中立城 `buildings: []`，`applyWeeklyGrowth` 只遍历 `ownedTowns`，
 * 且全项目没有任何一处把 `owner` 改回 `'neutral'`），所以显式失败是安全的。
 */
export function unitIdForTier(owner: string, tier: number): string | null {
  const row = FACTION_UNITS[owner as FactionId];
  if (!row) return null;
  return row[tier - 1] ?? null;
}

/**
 * 旧 id → canonical id。**这是存档迁移的唯一对照表**，两代输入都在里面：
 *
 * | 代 | 例子 | 来源 |
 * |---|---|---|
 * | 旧通用 5 键（H3 别名） | `peasant` / `archer` / `pikeman` / `knight` / `angel` | D-58 §6.4.4 |
 * | v7 canonical（旧阵容） | `p1_lampbearer` … `p4_colossus` | §16.6 对照表 |
 *
 * ⚠️ **只在 `loadGame()` 的 v7→v8 迁移里用一次**（`persistence.ts`）。写档一律写新 id，
 * 否则旧词会通过「读 → 改 → 存」重新渗回存档。这也就是**不能**把它接进 `getUnit()` 的原因：
 * `getUnit()` 兜底救不了写档，只会在 `loadGame()` 之外又开一条隐式通道。
 *
 * ⚠️ **`p3_treant` 这一行是单行道**：旧 `p3_treant`（旧 T4 树人）→ 新 `p3_ape`；
 * 而新 `p3_treant` 是 T3 树人。**同一串字符在两代里指两个兵** ⇒ 这张表只能对 v7 档跑，
 * 对 v8 档再跑一次就会把新树人变成猿人。版本闸（`SAVE_VERSION`）不是可选装饰。
 *
 * `p3_dwarf` 不改名，故意不列（自我映射会让"迁移了多少条"的读数虚高）。
 */
export const LEGACY_UNIT_IDS: Record<string, string> = {
  // 旧通用 5 键 → 新 canonical
  peasant: 'p1_child',
  archer: 'p1_crossbow',
  pikeman: 'p1_eagle',
  knight: 'p1_knight',
  angel: 'p1_angel',

  // v7 canonical → 新 canonical（§16.6，按**显式对照**，不许按 tier 推）
  p1_lampbearer: 'p1_child',
  p1_hornxbow: 'p1_crossbow',
  p1_oathpike: 'p1_eagle',
  p1_templar: 'p1_knight',
  p1_overangel: 'p1_angel',
  p2_scavenger: 'p2_matchman',
  p2_axethrower: 'p2_bronze',
  p2_wolfrider: 'p2_threewolf',
  p2_firebrand: 'p2_lavagiant',
  p2_lavatroll: 'p2_devil',
  p3_thornarcher: 'p3_junglearcher',
  p3_vineguard: 'p3_treant',
  p3_treant: 'p3_ape', // ⚠️ 旧 T4 树人 → 新 T4 猿人（新 `p3_treant` 是 T3，见上）
  p3_unicorn: 'p3_greendragon',
  p4_stoneimp: 'p4_skeleton',
  p4_fireapprentice: 'p4_zombie',
  p4_hopgolem: 'p4_vampire',
  p4_librarian: 'p4_minotaur',
  p4_colossus: 'p4_wraith',
};

/** 旧档里可能装着旧 id 的 4 个容器（只取 GameState 的最小子集，避免 core → save 互相 import）。 */
export interface LegacyUnitIdCarrier {
  heroes?: Record<string, { army?: { unitTypeId: string }[] }>;
  towns?: Record<
    string,
    {
      garrison?: { unitTypeId: string }[];
      growthPool?: Record<string, number>;
      growthRemainder?: Record<string, number>;
    }
  >;
}

export interface LegacyRemapReport {
  /** 被改写的部队条目数（`army` + `garrison`）。 */
  stacks: number;
  /** 被改写的计数字典键数（`growthPool` + `growthRemainder`）。 */
  keys: number;
}

function remapStacks(list: { unitTypeId: string }[] | undefined): number {
  if (!list) return 0;
  let n = 0;
  for (const st of list) {
    // 每一条**只读一次**：`p3_vineguard → p3_treant` 与 `p3_treant → p3_ape` 落在不同条目上，
    // 不会在同一条目里连跳两格（连跳会把藤蔓卫士直接变成猿人）。
    const next = LEGACY_UNIT_IDS[st.unitTypeId];
    if (next) {
      st.unitTypeId = next;
      n++;
    }
  }
  return n;
}

/**
 * 计数字典的迁移：**先建新表、再整体换回**（快照式），不是"就地改名"。
 *
 * 为什么不能就地改：`p3_vineguard → p3_treant` 与 `p3_treant → p3_ape` 是一对**链式**改名。
 * 就地改时，先处理 `p3_vineguard` 会把产量并进 `p3_treant`，紧接着处理原来那条
 * `p3_treant` 又会把刚并进来的数一起搬去 `p3_ape`（或者被 `delete` 掉）——
 * 结果取决于遍历顺序，且**两种顺序都错**。快照式一次性算完再赋值，与顺序无关。
 */
function remapCountMap(map: Record<string, number> | undefined): number {
  if (!map) return 0;
  const out: Record<string, number> = {};
  let n = 0;
  for (const [oldId, value] of Object.entries(map)) {
    const next = LEGACY_UNIT_IDS[oldId];
    if (next) n++;
    const key = next ?? oldId;
    // 新旧键撞车时求和，别覆盖掉已经攒下的产量。
    out[key] = (out[key] ?? 0) + value;
  }
  for (const k of Object.keys(map)) delete map[k];
  Object.assign(map, out);
  return n;
}

/**
 * v7 档一次性重映射（`races.md §6.4.4` + §16.6）：**只在 `loadGame()` 的版本迁移里调一次**。
 *
 * 覆盖 4 个容器，按危险等级分：
 *   - 🔴 `heroes[].army` / `towns[].garrison` / `towns[].growthPool` —— **不映射就崩**：
 *     `getUnit()` 对未知 id 直接抛；`growthPool` 更狠 —— `ai.ts` 会
 *     `Object.keys(town.growthPool)` 逐个喂给 `recruitToHero()` ⇒ **AI 回合挂掉**。
 *   - 🟡 `towns[].growthRemainder` —— 不映射**不会崩**（只按 key `?? 0` 读写、从不迭代），
 *     但会留下一个永远用不到的孤儿键、并丢掉已攒的小数余数 ⇒ 顺手在同一次遍历里做，成本≈0。
 *
 * **不是幂等的**：跑第二遍会把新 `p3_treant` 变成 `p3_ape`。调用方必须用版本号把它锁在
 * "只对旧档跑一次"（`persistence.ts`）。
 */
export function normalizeLegacyUnitIds(state: LegacyUnitIdCarrier): LegacyRemapReport {
  const report: LegacyRemapReport = { stacks: 0, keys: 0 };
  for (const hero of Object.values(state.heroes ?? {})) {
    report.stacks += remapStacks(hero.army);
  }
  for (const town of Object.values(state.towns ?? {})) {
    report.stacks += remapStacks(town.garrison);
    report.keys += remapCountMap(town.growthPool);
    report.keys += remapCountMap(town.growthRemainder);
  }
  return report;
}

export interface UnknownUnitReport {
  /** 被丢弃的部队条目数。 */
  stacks: number;
  /** 被丢弃的计数字典键数。 */
  keys: number;
  /** 去重后的未知 id（日志里只念一遍）。 */
  ids: string[];
}

/**
 * 读档兜底：**丢弃**未知 id 的部队与产量键，并留一条可归因的日志。
 *
 * 为什么不是 `getUnit()` 兜底：`getUnit()` 在战斗/生成器/UI 里被调几百次，
 * 返回一个假单位会让"这一栈不存在"变成"这一栈数值很奇怪"——错得更远。
 * 正确的位置是**入口**（读档），把坏数据丢掉，之后所有路径都能假定 id 合法。
 */
export function dropUnknownUnits(state: LegacyUnitIdCarrier): UnknownUnitReport {
  const ids = new Set<string>();
  let stacks = 0;
  let keys = 0;
  const filter = (list: { unitTypeId: string }[] | undefined): void => {
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const id = list[i]!.unitTypeId;
      if (UNITS[id]) continue;
      ids.add(id);
      list.splice(i, 1);
      stacks++;
    }
  };
  for (const hero of Object.values(state.heroes ?? {})) filter(hero.army);
  for (const town of Object.values(state.towns ?? {})) {
    filter(town.garrison);
    for (const map of [town.growthPool, town.growthRemainder]) {
      if (!map) continue;
      for (const k of Object.keys(map)) {
        if (UNITS[k]) continue;
        ids.add(k);
        delete map[k];
        keys++;
      }
    }
  }
  return { stacks, keys, ids: [...ids] };
}

export function getUnit(id: string): UnitType {
  const u = UNITS[id];
  if (!u) {
    // 走到这里说明调用方绕过了读档清洗（或有新代码写死了旧词）。
    // ⚠️ 只报 id，不在这里做"猜一个近似的"——那会把 bug 藏起来。
    const hint = LEGACY_UNIT_IDS[id] ? `（旧 id，canonical 为 ${LEGACY_UNIT_IDS[id]}）` : '';
    throw new Error(`未知兵种: ${id}${hint}`);
  }
  return u;
}

/**
 * 近战表演风格（`races.md §6.4.2` 规则 4）：**数据驱动，读 `UnitType.anim`**。
 *
 * 为什么不做成 id 字面量判断：20 个兵里近战形状各异，按 id 判就得给每个新 id 补一条 `if`，
 * 迁移后必然漏（旧 `BattleScreen.meleeStyle()` 的教训）。缺省 `'slash'`。
 * 用安全查表而非 `getUnit()`：调用点在战斗渲染里，未知 id 不该抛错打断整场战斗。
 */
export function meleeStyleOf(unitTypeId: string): 'thrust' | 'slash' | 'smash' {
  return UNITS[unitTypeId]?.anim ?? 'slash';
}

/** 中立野怪，不进兵营。 */
export const MONSTER_UNIT_IDS = ['wolf', 'boar', 'ogre'];

/** 英雄部队最多 5 个兵种槽位（HOMM 规则）。 */
export const MAX_STACKS = 5;
