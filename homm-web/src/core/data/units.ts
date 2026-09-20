import type { FactionId, UnitType } from '../types.js';
import { FACTIONS } from './factions.js';

/**
 * 兵种表。
 *
 * **id 采用 canonical 形式 `p{n}_{shortname}`**（`design/gdd/races.md §6.4` / 主理人裁决 D-63）。
 * 帧名由 id 直接拼出、不设映射表：`u_{id}_map` / `cu_{id}` / `cu_{id}_atk`
 * ⇒ 数据 id 与精灵帧名共用同一套词，不可能再分家。
 *
 * 数值来源：`races.md` 的逐族兵种表（§2.2 晨曦 / §3.2 赤焰 / §4.2 翠林 / §5.2 紫晶），
 * 横向总表见 §6.1。**表中没有的三个量**（`expValue` / `body` / `accent`）见下面两条注释 ——
 * 它们是显式占位，不是编出来的数。
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
 * 只保证「高阶兵给的经验更多」这个手感不破，具体数值待设计线补。
 */
const EXP_BY_TIER = [4, 12, 20, 45, 120];

export const UNITS: Record<string, UnitType> = {
  /* ================= p1 晨曦军团 —— 「准时打卡的正义」 ================= */

  p1_lampbearer: {
    id: 'p1_lampbearer', name: '提灯侍从', tier: 1,
    attack: 1, defense: 2, damageMin: 1, damageMax: 2, hp: 4, speed: 3,
    expValue: EXP_BY_TIER[0], growthPerWeek: 11, cost: { gold: 25 },
    ...theme('p1'),
  },
  p1_hornxbow: {
    id: 'p1_hornxbow', name: '号角弩手', tier: 2,
    attack: 4, defense: 2, damageMin: 2, damageMax: 4, hp: 10, speed: 4, shots: 14,
    expValue: EXP_BY_TIER[1], growthPerWeek: 5, cost: { gold: 110 },
    ...theme('p1'),
  },
  p1_oathpike: {
    id: 'p1_oathpike', name: '铁誓枪兵', tier: 3,
    attack: 4, defense: 7, damageMin: 3, damageMax: 5, hp: 20, speed: 4,
    expValue: EXP_BY_TIER[2], growthPerWeek: 4, cost: { gold: 220, wood: 2 },
    anim: 'thrust',
    ...theme('p1'),
  },
  p1_templar: {
    id: 'p1_templar', name: '圣殿骑士', tier: 4,
    attack: 7, defense: 8, damageMin: 7, damageMax: 9, hp: 36, speed: 6,
    expValue: EXP_BY_TIER[3], growthPerWeek: 3, cost: { gold: 520, ore: 3 },
    ...theme('p1'),
  },
  p1_overangel: {
    id: 'p1_overangel', name: '加班天使', tier: 5,
    attack: 9, defense: 9, damageMin: 11, damageMax: 15, hp: 60, speed: 8,
    expValue: EXP_BY_TIER[4], growthPerWeek: 2, cost: { gold: 1300, ore: 5, wood: 5 },
    ...theme('p1'),
  },

  /* ================= p2 赤焰部落 —— 「莽就完事了」 ================= */

  p2_scavenger: {
    id: 'p2_scavenger', name: '捡破烂小鬼', tier: 1,
    attack: 2, defense: 1, damageMin: 1, damageMax: 3, hp: 3, speed: 4,
    expValue: EXP_BY_TIER[0], growthPerWeek: 12, cost: { gold: 18 },
    ...theme('p2'),
  },
  p2_axethrower: {
    id: 'p2_axethrower', name: '投斧蛮子', tier: 2,
    attack: 4, defense: 1, damageMin: 3, damageMax: 4, hp: 9, speed: 4, shots: 10,
    expValue: EXP_BY_TIER[1], growthPerWeek: 5, cost: { gold: 105 },
    ...theme('p2'),
  },
  p2_wolfrider: {
    id: 'p2_wolfrider', name: '暴走狼骑', tier: 3,
    attack: 7, defense: 3, damageMin: 4, damageMax: 6, hp: 16, speed: 7,
    expValue: EXP_BY_TIER[2], growthPerWeek: 4, cost: { gold: 200, ore: 2 },
    anim: 'thrust',
    ...theme('p2'),
  },
  p2_firebrand: {
    id: 'p2_firebrand', name: '火油狂徒', tier: 4,
    attack: 9, defense: 5, damageMin: 6, damageMax: 9, hp: 30, speed: 6,
    expValue: EXP_BY_TIER[3], growthPerWeek: 3, cost: { gold: 480, ore: 3 },
    ...theme('p2'),
  },
  p2_lavatroll: {
    id: 'p2_lavatroll', name: '熔岩巨魔', tier: 5,
    attack: 11, defense: 7, damageMin: 12, damageMax: 16, hp: 55, speed: 5,
    expValue: EXP_BY_TIER[4], growthPerWeek: 2, cost: { gold: 1200, ore: 5, wood: 5 },
    anim: 'smash',
    ...theme('p2'),
  },

  /* ================= p3 翠林守望 —— 「以静制动的花园保安」 ================= */

  p3_dwarf: {
    id: 'p3_dwarf', name: '浇水矮人', tier: 1,
    attack: 1, defense: 3, damageMin: 1, damageMax: 2, hp: 5, speed: 3,
    expValue: EXP_BY_TIER[0], growthPerWeek: 10, cost: { gold: 25 },
    ...theme('p3'),
  },
  p3_thornarcher: {
    id: 'p3_thornarcher', name: '荆棘射手', tier: 2,
    attack: 4, defense: 3, damageMin: 2, damageMax: 3, hp: 11, speed: 4, shots: 16,
    expValue: EXP_BY_TIER[1], growthPerWeek: 5, cost: { gold: 115 },
    ...theme('p3'),
  },
  p3_vineguard: {
    id: 'p3_vineguard', name: '藤蔓卫士', tier: 3,
    attack: 4, defense: 8, damageMin: 3, damageMax: 5, hp: 22, speed: 3,
    expValue: EXP_BY_TIER[2], growthPerWeek: 4, cost: { gold: 240, wood: 2 },
    ...theme('p3'),
  },
  p3_treant: {
    id: 'p3_treant', name: '树人大叔', tier: 4,
    attack: 6, defense: 10, damageMin: 6, damageMax: 9, hp: 42, speed: 3,
    expValue: EXP_BY_TIER[3], growthPerWeek: 3, cost: { gold: 560, wood: 6, ore: 2 },
    anim: 'smash',
    ...theme('p3'),
  },
  p3_unicorn: {
    id: 'p3_unicorn', name: '独角兽园丁', tier: 5,
    attack: 8, defense: 11, damageMin: 10, damageMax: 14, hp: 65, speed: 6,
    expValue: EXP_BY_TIER[4], growthPerWeek: 2, cost: { gold: 1250, gem: 2, wood: 5 },
    anim: 'thrust',
    ...theme('p3'),
  },

  /* ================= p4 紫晶密会 —— 「魔法实验室事故」 ================= */

  p4_stoneimp: {
    id: 'p4_stoneimp', name: '石雕小怪', tier: 1,
    attack: 1, defense: 4, damageMin: 2, damageMax: 3, hp: 4, speed: 2,
    expValue: EXP_BY_TIER[0], growthPerWeek: 9, cost: { gold: 30 },
    ...theme('p4'),
  },
  p4_fireapprentice: {
    id: 'p4_fireapprentice', name: '喷火学徒', tier: 2,
    attack: 5, defense: 1, damageMin: 3, damageMax: 5, hp: 8, speed: 4, shots: 8,
    expValue: EXP_BY_TIER[1], growthPerWeek: 5, cost: { gold: 120 },
    ...theme('p4'),
  },
  p4_hopgolem: {
    id: 'p4_hopgolem', name: '蹦跳魔偶', tier: 3,
    attack: 6, defense: 4, damageMin: 4, damageMax: 6, hp: 15, speed: 6,
    expValue: EXP_BY_TIER[2], growthPerWeek: 4, cost: { gold: 230, ore: 2 },
    anim: 'smash',
    ...theme('p4'),
  },
  p4_librarian: {
    id: 'p4_librarian', name: '亡灵图书管理员', tier: 4,
    attack: 8, defense: 4, damageMin: 8, damageMax: 11, hp: 28, speed: 5, shots: 8,
    expValue: EXP_BY_TIER[3], growthPerWeek: 3, cost: { gold: 520, crystal: 2 },
    ...theme('p4'),
  },
  p4_colossus: {
    id: 'p4_colossus', name: '失控大魔像', tier: 5,
    attack: 10, defense: 8, damageMin: 12, damageMax: 16, hp: 58, speed: 7,
    expValue: EXP_BY_TIER[4], growthPerWeek: 2, cost: { gold: 1250, crystal: 4, ore: 3 },
    anim: 'smash',
    ...theme('p4'),
  },

  /* ============ 旧通用 5 级树（**段 2 删除**） ============ */
  /* 段 1 保留它们只为「零行为变化」：此刻仍有 8 个文件按旧 id 取用
     （buildings / heroes / mines / generator / main / BattleScreen / combatAtlas）。
     段 2 把那些取用点全部改成 canonical id 之后再删这 5 条。
     旧档兼容**不靠**留着它们，而是 `LEGACY_UNIT_IDS` + `normalizeLegacyUnitIds()`。 */

  peasant: {
    id: 'peasant', name: '农民', tier: 1,
    attack: 1, defense: 1, damageMin: 1, damageMax: 2, hp: 3, speed: 3,
    expValue: 4, growthPerWeek: 10, cost: { gold: 20 },
    body: '#9c8a63', accent: '#5b4c33',
  },
  archer: {
    id: 'archer', name: '弓手', tier: 2,
    attack: 4, defense: 2, damageMin: 2, damageMax: 3, hp: 10, speed: 4, shots: 12,
    expValue: 12, growthPerWeek: 5, cost: { gold: 100 },
    body: '#8a6a3a', accent: '#e8d9a8',
  },
  pikeman: {
    id: 'pikeman', name: '枪兵', tier: 3,
    attack: 5, defense: 5, damageMin: 3, damageMax: 5, hp: 18, speed: 4,
    expValue: 20, growthPerWeek: 4, cost: { gold: 200, wood: 2 },
    anim: 'thrust', // 保留旧 meleeStyle() 的行为（段 2 删键前零行为变化）
    body: '#7a8a99', accent: '#c9d3db',
  },
  knight: {
    id: 'knight', name: '骑士', tier: 4,
    attack: 7, defense: 7, damageMin: 6, damageMax: 9, hp: 35, speed: 6,
    expValue: 45, growthPerWeek: 3, cost: { gold: 500, ore: 3 },
    body: '#b8b8c4', accent: '#4f7fbf',
  },
  angel: {
    id: 'angel', name: '天使', tier: 5,
    attack: 10, defense: 10, damageMin: 12, damageMax: 16, hp: 60, speed: 8,
    expValue: 120, growthPerWeek: 2, cost: { gold: 1200, ore: 5, wood: 5 },
    body: '#f4f4f7', accent: '#e3b869',
  },

  /* ============ 中立野怪（**不迁**，D-58 §6.4.4） ============ */
  /* 不与阵营绑定、本身已是唯一词 —— 改名只有风险没有收益。 */

  wolf: {
    id: 'wolf', name: '野狼', tier: 1,
    attack: 3, defense: 1, damageMin: 2, damageMax: 3, hp: 8, speed: 6,
    expValue: 8, growthPerWeek: 0, cost: {},
    body: '#8a8a92', accent: '#3a3a42',
  },
  boar: {
    id: 'boar', name: '野猪', tier: 3,
    attack: 5, defense: 4, damageMin: 3, damageMax: 5, hp: 24, speed: 4,
    expValue: 18, growthPerWeek: 0, cost: {},
    anim: 'smash', // 保留旧 meleeStyle()（boar 原判 smash）
    body: '#6b4a2f', accent: '#241a10',
  },
  ogre: {
    id: 'ogre', name: '食人魔', tier: 4,
    attack: 8, defense: 5, damageMin: 6, damageMax: 10, hp: 30, speed: 3,
    expValue: 40, growthPerWeek: 0, cost: {},
    anim: 'smash', // 保留旧 meleeStyle()（ogre 原判 smash）
    body: '#4f6b3a', accent: '#1e2a15',
  },
};

/**
 * 阵营 × tier → canonical id（按 T1→T5）。**tier 解析的唯一入口**
 * （`races.md §6.4.2` 规则 3）。
 *
 * 段 2 会把 `dwell1~5` 的 `growth.unitTypeId` 换成 `tier`、由这张表解析 ——
 * 否则同一座 `dwell3` 在四族里长出的都是同一种兵（`core/game/town.ts` 的
 * `applyWeeklyGrowth` / `recruitRows` / `build` 三处都直接取 `g.unitTypeId`）。
 */
export const FACTION_UNITS: Record<FactionId, readonly [string, string, string, string, string]> = {
  p1: ['p1_lampbearer', 'p1_hornxbow', 'p1_oathpike', 'p1_templar', 'p1_overangel'],
  p2: ['p2_scavenger', 'p2_axethrower', 'p2_wolfrider', 'p2_firebrand', 'p2_lavatroll'],
  p3: ['p3_dwarf', 'p3_thornarcher', 'p3_vineguard', 'p3_treant', 'p3_unicorn'],
  p4: ['p4_stoneimp', 'p4_fireapprentice', 'p4_hopgolem', 'p4_librarian', 'p4_colossus'],
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
 * 旧通用 id → canonical id（`races.md §6.4.4`）：旧兵种整体归给 **p1 晨曦**
 * （历史默认玩家阵营）。
 *
 * ⚠️ **这张表只在读取旧档时用一次**，写档一律写新 id，否则旧词会通过
 * 「读 → 改 → 存」重新渗回存档。⇒ 因此**不要**把别名接进 `getUnit()`：
 * 写档走的是调用方传进来的字符串，`getUnit()` 兜底救不了写档，
 * 只会在 `loadGame()` 之外又开一条隐式通道。
 */
export const LEGACY_UNIT_IDS: Record<string, string> = {
  peasant: 'p1_lampbearer',
  archer: 'p1_hornxbow',
  pikeman: 'p1_oathpike',
  knight: 'p1_templar',
  angel: 'p1_overangel',
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
    const next = LEGACY_UNIT_IDS[st.unitTypeId];
    if (next) {
      st.unitTypeId = next;
      n++;
    }
  }
  return n;
}

function remapCountMap(map: Record<string, number> | undefined): number {
  if (!map) return 0;
  let n = 0;
  for (const [oldId, value] of Object.entries(map)) {
    const next = LEGACY_UNIT_IDS[oldId];
    if (!next) continue;
    // 新键可能已存在（同一支部队既攒过旧 id 的产量又攒过新 id 的）→ 合并求和，别覆盖掉产量。
    map[next] = (map[next] ?? 0) + value;
    delete map[oldId];
    n++;
  }
  return n;
}

/**
 * 旧档一次性重映射（`races.md §6.4.4`）：**只在 `loadGame()` 里调一次**。
 *
 * 覆盖 4 个容器，按危险等级分（2026-09-20 由 design-strategist 复核更正）：
 *   - 🔴 `heroes[].army` / `towns[].garrison` / `towns[].growthPool` —— **不映射就崩**：
 *     `getUnit()` 对未知 id 直接抛；`growthPool` 更狠 —— `ai.ts` 会
 *     `Object.keys(town.growthPool)` 逐个喂给 `recruitToHero()` ⇒ **AI 回合挂掉**。
 *   - 🟡 `towns[].growthRemainder` —— 不映射**不会崩**（只按 key `?? 0` 读写、从不迭代），
 *     但会留下一个永远用不到的孤儿键、并丢掉已攒的小数余数 ⇒ 顺手在同一次遍历里做，成本≈0。
 *
 * 幂等：再跑一次不会有任何改动（旧键已不存在）。
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

export function getUnit(id: string): UnitType {
  const u = UNITS[id];
  if (!u) {
    // 旧 id 漏到这里，说明它没在 loadGame() 被 normalize 掉（或有新代码写死了旧词）。
    // ⚠️ 段 1 里旧 5 键仍在 UNITS 中，所以这条提示**段 2 删键后才会真正触发**。
    const hint = LEGACY_UNIT_IDS[id] ? `（旧 id，canonical 为 ${LEGACY_UNIT_IDS[id]}）` : '';
    throw new Error(`未知兵种: ${id}${hint}`);
  }
  return u;
}

/**
 * 近战表演风格（`races.md §6.4.2` 规则 4）：**数据驱动，读 `UnitType.anim`**。
 *
 * 为什么不做成 id 字面量判断：四族 T3 是枪兵 / 狼骑 / 藤卫 / 魔偶，**只有枪兵该突刺**；
 * 按 id 判就得给每个新 id 补一条 `if`，迁移后必然漏（旧 `BattleScreen.meleeStyle()` 的教训）。
 * 缺省 `'slash'`。用安全查表而非 `getUnit()`：调用点在战斗渲染里，未知 id 不该抛错打断整场战斗。
 */
export function meleeStyleOf(unitTypeId: string): 'thrust' | 'slash' | 'smash' {
  return UNITS[unitTypeId]?.anim ?? 'slash';
}

/** 玩家可招募的兵种（按兵营等级从低到高）。⚠️ 段 2 改为按阵营取 `FACTION_UNITS`。 */
export const PLAYER_UNIT_IDS = ['peasant', 'archer', 'pikeman', 'knight', 'angel'];

/** 中立野怪，不进兵营。 */
export const MONSTER_UNIT_IDS = ['wolf', 'boar', 'ogre'];

/** 英雄部队最多 5 个兵种槽位（HOMM 规则）。 */
export const MAX_STACKS = 5;
