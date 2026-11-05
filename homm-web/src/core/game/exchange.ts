import type { ArtifactSlot, GameState, Hero } from '../types.js';
import { ARTIFACTS } from '../data/artifacts.js';
import { MAX_STACKS, getUnit } from '../data/units.js';
import { pushLog } from './log.js';

/**
 * 会面交换（§9.2）—— H3 的「主英雄打、副英雄运兵」这条物流循环。
 *
 * 为什么它是一个独立的 core 模块而不是写在面板里：
 *   ① 面板只是**一个调用方**，AI 与探针要走同一套规则（否则"玩家能做的 AI 不能做"
 *      会在中后期变成隐形难度差）；
 *   ② 三条交换规则（合并 / 移入 / 互换）与"满编拒绝"是**不能各写一遍**的状态机 ——
 *      写两遍必然出现"面板说能换、核心说不能"；
 *   ③ 每条拒绝都必须**零写入**（先全部校验、再一次性落库），这样面板可以安全地
 *      把"点一下试试"当成查询用。
 *
 * 不花移动力、每回合不限次 —— 交换本身不改 `movePoints`，也不消耗任何资源。
 */

/**
 * 兵种名。**未知 id 不抛错** —— `getUnit()` 对未登记 id 是 `throw`，而交换面板是
 * 读**存档里的部队**：一个坏档 / 一条 B1 之前的旧 id 就足以让整个面板白屏。
 * 名字取不到就显示 id 本身（可见的降级 > 不可用的面板）。
 */
function unitNameOf(id: string): string {
  try {
    return getUnit(id).name;
  } catch {
    return id;
  }
}

/* ---------------- 会面前置 ---------------- */

export type MeetReason = 'ok' | 'missing-hero' | 'same-hero' | 'not-allied' | 'not-same-tile';

export interface MeetCheck {
  ok: boolean;
  reason: MeetReason;
  message: string;
}

/**
 * 能不能开面板。**必须同阵营且同格**。
 *
 * `not-allied` 与 `not-same-tile` 是两条独立分支：敌方英雄同格要走的是开战流程
 * （`startHeroEncounter`），不是"距离不对"—— 合并成一条会让 UI 的提示误导人。
 */
export function canMeet(state: GameState, aId: string, bId: string): MeetCheck {
  const a = state.heroes[aId];
  const b = state.heroes[bId];
  if (!a || !b) return { ok: false, reason: 'missing-hero', message: '找不到这位英雄' };
  if (a.id === b.id) return { ok: false, reason: 'same-hero', message: '不能和自己交换' };
  if (a.owner !== b.owner) return { ok: false, reason: 'not-allied', message: '只能和友军交换' };
  if (a.pos.x !== b.pos.x || a.pos.y !== b.pos.y) {
    return { ok: false, reason: 'not-same-tile', message: '两位英雄不在同一格' };
  }
  return { ok: true, reason: 'ok', message: '' };
}

/** 站在该英雄脚下（同格）的友军，没有则 null。用于「移动结束」触发。 */
export function friendlyHeroAt(state: GameState, hero: Hero): Hero | null {
  for (const id of state.heroOrder) {
    const h = state.heroes[id];
    if (!h || h.id === hero.id) continue;
    if (h.owner !== hero.owner) continue;
    if (h.pos.x === hero.pos.x && h.pos.y === hero.pos.y) return h;
  }
  return null;
}

/* ---------------- 部队交换 ---------------- */

export type ExchangeReason =
  | 'ok'
  | 'not-met'
  | 'bad-index'
  | 'empty-source'
  | 'bad-amount'
  | 'swap-partial'
  | 'target-full';

export interface ExchangeResult {
  ok: boolean;
  reason: ExchangeReason;
  /** 给玩家看的一句话；成功时也写（用于 toast / 日志回读）。 */
  message: string;
  /** 实际搬动的数量（成功时）。 */
  moved?: number;
}

/** 「全部 / 一半 / 1」三键的取值口径。`half` 向上取整：5 只的"一半"是 3，不是 2。 */
export type AmountChoice = number | 'all' | 'half';

export function resolveAmount(choice: AmountChoice | undefined, count: number): number {
  if (count <= 0) return 0;
  if (choice === undefined || choice === 'all') return count;
  if (choice === 'half') return Math.max(1, Math.ceil(count / 2));
  const n = Math.floor(choice);
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(n, count);
}

/**
 * 把 `from.army[fromIdx]` 的部分或全部搬到 `to.army[toIdx]`。
 *
 * | 目标格 | 数量 | 结果 |
 * |---|---|---|
 * | 空槽 | 任意（≤ 源） | 移入；源减；源归零则**整格删除**（数组保持紧凑） |
 * | 同兵种 | 任意（≤ 源） | 合并；同上 |
 * | 异兵种 | 必须整栈 | 两栈**互换**（各回各的格） |
 * | 异兵种 | 部分 | 拒绝 `swap-partial` —— 半栈互换没有语义 |
 * | 满编（5 栈、无同兵种、无空槽） | — | 拒绝 `target-full` |
 *
 * `toIdx` 允许等于 `to.army.length`（= 点最后那个空格）或更大；越界到 `MAX_STACKS`
 * 以外才算 `bad-index`。
 */
export function exchangeArmy(
  state: GameState,
  fromId: string,
  fromIdx: number,
  toId: string,
  toIdx: number,
  choice: AmountChoice = 'all',
): ExchangeResult {
  const meet = canMeet(state, fromId, toId);
  if (!meet.ok) return { ok: false, reason: 'not-met', message: meet.message };

  const from = state.heroes[fromId]!;
  const to = state.heroes[toId]!;

  if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx >= from.army.length) {
    return { ok: false, reason: 'bad-index', message: '源格没有部队' };
  }
  const src = from.army[fromIdx]!;
  if (src.count <= 0) return { ok: false, reason: 'empty-source', message: '这一格是空的' };

  const amount = resolveAmount(choice, src.count);
  if (amount <= 0) return { ok: false, reason: 'bad-amount', message: '数量不对' };

  if (!Number.isInteger(toIdx) || toIdx < 0 || toIdx > MAX_STACKS) {
    return { ok: false, reason: 'bad-index', message: '目标格不存在' };
  }
  const dst = toIdx < to.army.length ? to.army[toIdx]! : null;
  const unitName = unitNameOf(src.unitTypeId);

  /* 目标满编：只有"能合并进同兵种那格"才放行 —— 那一格不会新增栈。 */
  if (dst && dst.unitTypeId !== src.unitTypeId) {
    if (amount !== src.count) {
      /* 两种拒绝要分开报：满编时真正的原因是"没地方放这半队"（目标满），
         而没满编时才是"半队互换没有语义"。合成一条会让玩家照着提示做错动作。 */
      return to.army.length >= MAX_STACKS
        ? { ok: false, reason: 'target-full', message: `${to.name} 部队已满，只能整队互换` }
        : { ok: false, reason: 'swap-partial', message: '不同兵种只能整队互换' };
    }
    // 互换：两边数量都不变，只换兵种
    const aType = src.unitTypeId;
    const aCount = src.count;
    src.unitTypeId = dst.unitTypeId;
    src.count = dst.count;
    dst.unitTypeId = aType;
    dst.count = aCount;
    const other = unitNameOf(src.unitTypeId);
    pushLog(state, `${from.name} → ${to.name}：${unitName} 与 ${other} 互换`);
    return { ok: true, reason: 'ok', message: `互换：${unitName} ↔ ${other}`, moved: 0 };
  }

  if (!dst) {
    // 点到的位置是空槽：只有"没满编"才接得住；点哪一格都等价于追加到末尾
    // （数组保持紧凑，不留洞 —— 留洞会让 `army[i]` 的语义在存档重载后变化）。
    if (to.army.length >= MAX_STACKS) {
      return { ok: false, reason: 'target-full', message: `${to.name} 部队已满` };
    }
    to.army.push({ unitTypeId: src.unitTypeId, count: amount });
    src.count -= amount;
    if (src.count <= 0) from.army.splice(fromIdx, 1);
    pushLog(state, `${from.name} → ${to.name}：${unitName} ×${amount}`);
    return { ok: true, reason: 'ok', message: `移入 ${unitName} ×${amount}`, moved: amount };
  }

  // 同兵种合并
  dst.count += amount;
  src.count -= amount;
  if (src.count <= 0) from.army.splice(fromIdx, 1);
  pushLog(state, `${from.name} → ${to.name}：${unitName} ×${amount}`);
  return { ok: true, reason: 'ok', message: `合并 ${unitName} ×${amount}`, moved: amount };
}

/* ---------------- 装备 ---------------- */

/* 「穿戴表 / 背包」的唯一实现在 `equip.ts`（U2 装备页与属性计算共用）。
 * 这里**重导出**而不是各写一份：会面面板一直从本模块取，改了路径会漏掉调用方。 */
export { equippedOf, backpackOf } from './equip.js';
import { equippedOf } from './equip.js';

export interface ArtifactResult extends ExchangeResult {
  /** 落地到哪个槽（成功且不是背包时）。 */
  slot?: ArtifactSlot;
  /** 是否进了背包。 */
  backpack?: boolean;
}

/**
 * 把 `artifactId` 从 from 交给 to。
 *
 * - `backpack: false`（默认）：若 to 的对应槽是空的 ⇒ **直接装备**；槽已被占 ⇒ 拒绝
 *   （不抢、不掉、不交换 —— 抢占会让"我明明放上去了"变成另一种结果）。
 * - `backpack: true`：物品进 to 的背包，槽不动。
 *
 * 两条路径都**不复制**物品：源数组里移除，目标数组里追加 ⇒ 全服件数守恒。
 */
export function exchangeArtifact(
  state: GameState,
  fromId: string,
  artifactId: string,
  toId: string,
  opts: { backpack?: boolean } = {},
): ArtifactResult {
  const meet = canMeet(state, fromId, toId);
  if (!meet.ok) return { ok: false, reason: 'not-met', message: meet.message };

  const from = state.heroes[fromId]!;
  const to = state.heroes[toId]!;
  const def = ARTIFACTS[artifactId];
  if (!def) return { ok: false, reason: 'bad-index', message: '没有这件宝物' };
  if (!from.artifacts.includes(artifactId)) {
    return { ok: false, reason: 'empty-source', message: '这件宝物不在这位英雄身上' };
  }

  const fromEq = { ...equippedOf(from) };
  const toEq = { ...equippedOf(to) };
  if (!opts.backpack) {
    const holder = toEq[def.slot];
    if (holder && holder !== artifactId) {
      return { ok: false, reason: 'target-full', message: `${to.name} 的${def.slot}槽已被占用` };
    }
  }

  from.artifacts = from.artifacts.filter((id) => id !== artifactId);
  if (fromEq[def.slot] === artifactId) delete fromEq[def.slot];
  from.equipped = fromEq;

  to.artifacts = [...to.artifacts, artifactId];
  if (!opts.backpack) toEq[def.slot] = artifactId;
  to.equipped = toEq;

  const how = opts.backpack ? '放进背包' : `装上${def.name}`;
  pushLog(state, `${from.name} → ${to.name}：${def.name}（${how}）`);
  return {
    ok: true,
    reason: 'ok',
    message: `${def.name} ${how}`,
    slot: opts.backpack ? undefined : def.slot,
    backpack: !!opts.backpack,
  };
}

/* ---------------- 探针用的只读快照 ---------------- */

/** Σcount —— 交换前后必须不变（§9.2 机检第一条）。 */
export function totalCount(hero: Hero): number {
  return hero.army.reduce((n, s) => n + s.count, 0);
}

/** 一份可 JSON 序列化的指纹，用于"非法操作零写入"的逐字节比对。 */
export function heroFingerprint(hero: Hero): string {
  return JSON.stringify({
    army: hero.army.map((s) => [s.unitTypeId, s.count]),
    artifacts: hero.artifacts.slice().sort(),
    equipped: equippedOf(hero),
  });
}
