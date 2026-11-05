import type { ArtifactSlot, Hero } from '../types.js';
import { ARTIFACTS } from '../data/artifacts.js';

/**
 * 装备页的核心规则（§9.1，U2）。
 *
 * ## 为什么单独一个模块
 * 「哪件穿在身上、哪件在背包」是**状态规则**，不是面板的私事：
 * 属性计算（`hero.ts`）、会面交换（`exchange.ts`）与探针都要读同一份答案。
 * 面板里再写一遍"每个槽取第一个匹配"，就会出现"面板显示已装备、属性却没加"。
 *
 * ## 数据口径（零迁移，§9.1）
 * `Hero.artifacts: string[]` 仍是**唯一真值**（物品清单），`equipped` 只记录
 * "哪个槽指向哪一件"。物品**永远不搬离数组** —— 搬数组会让下标失效、
 * 也会让会面交换的"件数守恒"断言变成两套账。
 *
 * `equipped` 缺省（旧档）时按「每个槽取数组里第一个匹配」回填，与旧面板
 * 的显示完全一致；第二次落到同一槽的宝物本来就该进背包。
 */

/** 英雄当前的穿戴表。**不写回**——它是旧档的读时兜底。 */
export function equippedOf(hero: Hero): Partial<Record<ArtifactSlot, string>> {
  if (hero.equipped) return hero.equipped;
  const out: Partial<Record<ArtifactSlot, string>> = {};
  for (const id of hero.artifacts) {
    const def = ARTIFACTS[id];
    if (!def) continue;
    if (!out[def.slot]) out[def.slot] = id;
  }
  return out;
}

/** 未穿戴的宝物（背包），按获得顺序。 */
export function backpackOf(hero: Hero): string[] {
  const eq = equippedOf(hero);
  const worn = new Set(Object.values(eq));
  return hero.artifacts.filter((id) => !worn.has(id));
}

export interface EquipResult {
  ok: boolean;
  reason: 'ok' | 'not-owned' | 'bad-index' | 'already' | 'empty';
  message: string;
  /** 成功时落到的槽。 */
  slot?: ArtifactSlot;
  /** 被替换下来的那件（仍留在 `artifacts` 里 ⇒ 自动出现在背包）。 */
  replaced?: string;
}

/**
 * 把一件**已在英雄身上**的宝物穿到它对应的槽。
 *
 * - 槽里已有别的 ⇒ **替换**（旧的自动回背包），不是拒绝 —— 装备页的
 *   "点选 → 点目标"如果在这里拒绝，玩家会以为槽坏了；
 * - 已经穿着同一件 ⇒ `already`，**零写入**（重复点击不制造状态变化）。
 */
export function equipArtifact(hero: Hero, artifactId: string): EquipResult {
  const def = ARTIFACTS[artifactId];
  if (!def) return { ok: false, reason: 'bad-index', message: '没有这件宝物' };
  if (!hero.artifacts.includes(artifactId)) {
    return { ok: false, reason: 'not-owned', message: '这件宝物不在这位英雄身上' };
  }
  const eq = { ...equippedOf(hero) };
  if (eq[def.slot] === artifactId) {
    return { ok: false, reason: 'already', message: `${def.name}已经装备`, slot: def.slot };
  }
  const replaced = eq[def.slot];
  eq[def.slot] = artifactId;
  hero.equipped = eq;
  return {
    ok: true,
    reason: 'ok',
    message: replaced ? `换上${def.name}（${ARTIFACTS[replaced]?.name ?? replaced}回背包）` : `装上${def.name}`,
    slot: def.slot,
    replaced,
  };
}

/** 卸下某个槽：物品留在 `artifacts` 里 ⇒ 自动出现在背包。`empty` 时零写入。 */
export function unequipArtifact(hero: Hero, slot: ArtifactSlot): EquipResult {
  const eq = { ...equippedOf(hero) };
  const id = eq[slot];
  if (!id) return { ok: false, reason: 'empty', message: '这个槽是空的', slot };
  delete eq[slot];
  hero.equipped = eq;
  return { ok: true, reason: 'ok', message: `卸下${ARTIFACTS[id]?.name ?? id}`, slot };
}
