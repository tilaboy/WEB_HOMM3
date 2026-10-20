import type { FactionId, HeroPrimary, Stack } from '../types.js';
import { unitIdForTier } from './units.js';

export const HERO_TEMPLATES: {
  id: string;
  name: string;
  className: string;
  portrait: string;
  primary: HeroPrimary;
  /**
   * 酒馆招募时带的兵**数量** —— 兵种**不写死在这里**：
   * 四个模板带的都是同一批兵，只有数量不同（20 / 8 / 8 / 8），
   * 兵种一律由 `startArmyFor(owner, count)` 按阵营解析（段 2）。
   */
  startArmyCount: number;
}[] = [
  {
    id: 'knight',
    name: '阿尔文',
    className: '骑士',
    portrait: '#4a7fb5',
    primary: { attack: 1, defense: 2, spellPower: 1, knowledge: 1 },
    startArmyCount: 20,
  },
  {
    id: 'ranger',
    name: '艾莉亚',
    className: '游侠',
    portrait: '#3f8f5a',
    primary: { attack: 2, defense: 1, spellPower: 1, knowledge: 1 },
    startArmyCount: 8,
  },
  {
    id: 'cleric',
    name: '塞拉菲',
    className: '牧师',
    portrait: '#8a6fbf',
    primary: { attack: 1, defense: 1, spellPower: 2, knowledge: 2 },
    startArmyCount: 8,
  },
  {
    id: 'barbarian',
    name: '格罗姆',
    className: '野蛮人',
    portrait: '#b06a3a',
    primary: { attack: 2, defense: 2, spellPower: 1, knowledge: 1 },
    startArmyCount: 8,
  },
];

/**
 * 族 → 招牌英雄模板（**身份映射，不是下标**）。
 *
 * 2026-10-20 前 `generator.ts` 用 `HERO_TEMPLATES[i]`（i = 阵营在 factions 数组里的下标）
 * 取模板，于是：p1→骑士、p2→游侠、**p3 翠林（花园保安）→牧师**、
 * **p4 紫晶（魔法实验室）→野蛮人** —— 后两个身份正好错位，
 * 玩家开局第一眼看到的职业与种族气质相反。
 *
 * 现在按语义显式对应：晨曦=骑士（秩序/守序）、赤焰=野蛮人（莽）、
 * 翠林=游侠（林地）、紫晶=牧师（学识/法术）。
 */
const SIGNATURE_TEMPLATE: Record<FactionId, string> = {
  p1: 'knight',
  p2: 'barbarian',
  p3: 'ranger',
  p4: 'cleric',
};

/**
 * 取某阵营的英雄模板。
 *
 * - `ordinal === 0`（开局英雄 / 酒馆第一位）：该族的**招牌职业**；
 * - `ordinal >= 1`：在其余三个模板里轮换 —— 副英雄可以有别的职业，
 *   但**第一位永远对得上种族**，这样"p3 开局是牧师"这种错位不会再出现。
 *
 * 未知阵营（含 `neutral`）退化为第一个模板（而不是随机），保证可复现。
 */
export function heroTemplateFor(owner: string, ordinal = 0) {
  const sigId = SIGNATURE_TEMPLATE[owner as FactionId];
  if (!sigId) return HERO_TEMPLATES[0]!;
  const sig = HERO_TEMPLATES.find((t) => t.id === sigId) ?? HERO_TEMPLATES[0]!;
  if (ordinal <= 0) return sig;
  const rest = HERO_TEMPLATES.filter((t) => t.id !== sig.id);
  return rest[(ordinal - 1) % rest.length]!;
}

/**
 * 起始部队的 tier = **2**。
 *
 * 旧 `START_ARMY` 是「20 弓手」，而弓手在 canonical 表里是 **T2**
 * （`archer → p1_hornxbow`）。所以对齐 T2 才是**零平衡改动**的换法；
 * 换成 T1 会把开局战力从「角弓」降到「灯侍」，那是实打实的削弱 ——
 * `design/difficulty-spec.md` 明写「不动 START_ARMY（20 弓手）」，
 * 本函数改的只是**哪个阵营的** T2，不是 tier、也不是总量。
 */
export const START_ARMY_TIER = 2;
/** 起始部队总量（沿用旧 20 弓手的基准）。 */
export const START_ARMY_COUNT = 20;

/**
 * 起始部队（段 2）：**按 owner 解析**到本族 canonical 兵种。
 *
 * 四族开局各带各的兵 —— 写死 `archer` 会让赤焰/翠林/紫晶的英雄一出场就扛着
 * 晨曦的角弓，这正是「四族兵种都一样」抱怨的一部分。
 *
 * ⚠️ **中立 / 未知 owner：返回空数组并记日志，绝不 fallback 到 p1**
 * （`units.ts:255-258` 规则 5）。合同写在注释里、由 smoke 断言守住：
 * 调用方拿到的是「0 兵」而不是「错阵营的兵」。当前实际不可达
 * （只有有主城镇能招英雄，中立城 `buildings: []` 没有酒馆）。
 */
export function startArmyFor(owner: string, count: number = START_ARMY_COUNT): Stack[] {
  if (count <= 0) return [];
  const id = unitIdForTier(owner, START_ARMY_TIER);
  if (!id) {
    console.warn(
      `[heroes] startArmyFor: owner=${owner} 解析不出 T${START_ARMY_TIER} 的兵种，返回空部队（按规则 5 不 fallback 到 p1）`,
    );
    return [];
  }
  return [{ unitTypeId: id, count }];
}
