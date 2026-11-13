import type { GameState, Hero, HeroSkill } from '../types.js';
import { deriveSeed, mulberry32 } from '../rng.js';
import {
  FIRST_AID_RATIO,
  SKILL_MAX_LEVEL,
  SKILL_ORDER,
  SKILL_PICK_LEVELS,
  SKILL_SLOTS,
  SKILLS,
  curveAt,
  type SkillId,
} from '../data/skills.js';
import { SPECIALTY_OF_CLASS, type SpecialtyId } from '../data/specialties.js';
import { classIdOf } from '../data/heroes.js';

/** 字符串 → 32 位种子（与 `interaction.ts:hashId` 同款；那个是局部函数，这里不去改它）。 */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 玩家的技能表（容错版）。
 *
 * 旧档没有 `skills` ⇒ 空表；存档里可能有已删除 / 未来版本的 id ⇒ 这里直接滤掉
 * （宁可少一条，也不要让面板/战斗读到 `undefined.level`）。等级夹回 1~3。
 */
export function heroSkills(hero: Hero): HeroSkill[] {
  const raw = hero.skills;
  if (!Array.isArray(raw)) return [];
  const out: HeroSkill[] = [];
  for (const s of raw) {
    if (!s || typeof s.id !== 'string') continue;
    if (!(s.id in SKILLS)) continue;
    if (out.some((x) => x.id === s.id)) continue; // 同 id 只留第一条，防止存档被写重
    /* ⚠️ `level <= 0` 的条目**直接丢掉**，不能夹成 1。
     * 夹成 1 等于"存档里写 0 就白送一级" —— 改档/旧版本写坏的数据会静默变成已学，
     * 而面板上看起来完全正常。这条是 `probe:heroskills` 的 S4 抓出来的。 */
    const lv = Math.round(Number(s.level));
    if (!Number.isFinite(lv) || lv < 1) continue;
    out.push({ id: s.id, level: Math.min(SKILL_MAX_LEVEL, lv) });
  }
  return out.slice(0, SKILL_SLOTS);
}

/** 某条技能的等级；0 = 没学。战斗/移动/结算全都走这一个入口。 */
export function skillLevel(hero: Hero, id: SkillId): number {
  return heroSkills(hero).find((s) => s.id === id)?.level ?? 0;
}

/** 打包成 `BattleSide.skills` 的形状（只带已学的，未学的不占键）。 */
export function skillLevelMap(hero: Hero): Partial<Record<SkillId, number>> {
  const out: Partial<Record<SkillId, number>> = {};
  for (const s of heroSkills(hero)) out[s.id as SkillId] = s.level;
  return out;
}

/** 已投入的点数 = 所有技能等级之和（也是「下一次 offer 的序号」）。 */
export function learnedPoints(hero: Hero): number {
  return heroSkills(hero).reduce((n, s) => n + s.level, 0);
}

/** 还没花的点。**以 `skillPicks` 为准，不信"等级 − 已点数"**（后者会把读档/改档算歪）。 */
export function pendingPicks(hero: Hero): number {
  return Math.max(0, Math.floor(hero.skillPicks ?? 0));
}

/**
 * 这一次二选一给哪两条。
 *
 * 取样池的规则（两条都必要）：
 *   ① 已学满 3 级的**不能再出现**（§21.9「选中即升一级，上限 3」）；
 *   ② 槽位已满 3 条时，**只从已学的里出** —— 否则会出现"第 4 条技能"，
 *      而面板只有 3 个位置，玩家会以为点完没生效。
 *
 * 确定性：种子 = (局种子, 英雄 id, 已投入点数)。**不存"当前报价"**，
 * 所以重绘面板不会重掷；只有真的学了东西（投入点数变了）才会换一批。
 * 这是"同一个弹窗关掉再打开必须还是这两条"的唯一实现方式。
 */
export function skillOffers(state: GameState, hero: Hero): SkillId[] {
  const learned = heroSkills(hero);
  const full = learned.length >= SKILL_SLOTS;
  const pool = SKILL_ORDER.filter((id) => {
    const lv = learned.find((s) => s.id === id)?.level ?? 0;
    if (lv >= SKILL_MAX_LEVEL) return false;
    return full ? lv > 0 : true;
  });
  if (pool.length <= 1) return pool;

  const rng = mulberry32(deriveSeed(state.seed, hashStr(hero.id), learnedPoints(hero), 0x736b696c));
  // 洗牌取前两个（Fisher-Yates，只洗到第 2 位就够）
  const arr = [...pool];
  for (let i = 0; i < 2; i++) {
    const j = i + Math.floor(rng() * (arr.length - i));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr.slice(0, 2);
}

/**
 * 花 1 点学 / 升一条技能。返回给玩家看的一句话；不合法返回 `null`（调用方不要吞掉原因）。
 */
export function learnSkill(hero: Hero, id: SkillId): string | null {
  if (pendingPicks(hero) <= 0) return null;
  const list = heroSkills(hero);
  const cur = list.find((s) => s.id === id);
  if (cur) {
    if (cur.level >= SKILL_MAX_LEVEL) return null;
    cur.level += 1;
    hero.skills = list;
    hero.skillPicks = pendingPicks(hero) - 1;
    return `${SKILLS[id].name} 升到 ${['基础', '高级', '专家'][cur.level - 1]}`;
  }
  if (list.length >= SKILL_SLOTS) return null;
  list.push({ id, level: 1 });
  hero.skills = list;
  hero.skillPicks = pendingPicks(hero) - 1;
  return `学会 ${SKILLS[id].name}（基础）`;
}

/**
 * AI 的选点：**按职业权重贪心**，不掷骰。
 *
 * AI 没有 UI，攒着等于永远不学（`skillPicks` 只增不减）。这里用固定优先级
 * 从当前 offer 里挑一条，保证"同种子同结果"，不会给平衡探针引入新的随机流。
 */
const AI_PREF: Record<string, SkillId[]> = {
  knight: ['defense', 'offense', 'logistics', 'firstAid', 'archery', 'sorcery'],
  barbarian: ['offense', 'logistics', 'archery', 'defense', 'firstAid', 'sorcery'],
  ranger: ['archery', 'logistics', 'defense', 'offense', 'firstAid', 'sorcery'],
  cleric: ['sorcery', 'firstAid', 'defense', 'logistics', 'archery', 'offense'],
};

function autoPick(state: GameState, hero: Hero): void {
  let guard = 0;
  while (pendingPicks(hero) > 0 && guard++ < 8) {
    const offers = skillOffers(state, hero);
    if (!offers.length) {
      // 没有可选项（6 条全满 3 级）⇒ 把点丢掉，否则会卡在"永远有未花点数"的死状态
      hero.skillPicks = 0;
      break;
    }
    const pref = AI_PREF[classIdOf(hero.heroClass)] ?? SKILL_ORDER;
    const pick = pref.find((id) => offers.includes(id)) ?? offers[0]!;
    if (!learnSkill(hero, pick)) {
      hero.skillPicks = 0;
      break;
    }
  }
}

/**
 * 升级后的技能点发放（由 `hero.ts:gainExp` 调用 —— 只有那里知道"刚升到几级"）。
 *
 * 人类玩家：只发点，等弹窗；AI：当场花掉。
 *
 * ⚠️ 判定用 `state.players[owner].isHuman` 而**不是** `owner === 'p1'`：
 * 解锁选族之后玩家可能不是 p1（见 `factions.ts:viewerOf` 的同一条理由）。
 *
 * ⚠️ **只有能证明是 AI 才自动花**（`=== false`），不是"不是人类就花"。
 * 探针 / 单测会传只有 `heroes` 的简化 state（`players` 为空）⇒ 用 `!isHuman`
 * 会在那里抛 `Cannot read properties of undefined`，整道门崩掉。
 * 宁可"没花"（玩家看得见点数、能补点）也不要"猜错了替他花掉"。
 */
export function grantSkillPicks(state: GameState, hero: Hero, newLevel: number): boolean {
  if (!SKILL_PICK_LEVELS.includes(newLevel)) return false;
  hero.skillPicks = pendingPicks(hero) + 1;
  if (state.players?.[hero.owner]?.isHuman === false) autoPick(state, hero);
  return true;
}

/** 英雄特长（跟职业走，不跟 id 走 —— 副英雄用别的模板时也成立）。 */
export function specialtyOf(hero: Hero): SpecialtyId {
  return SPECIALTY_OF_CLASS[classIdOf(hero.heroClass)];
}

/**
 * 「急救」：战后复活**本场阵亡**的一定比例（向上取整，每场一次）。
 *
 * 入参是战斗结算的伤亡表（`BattleOutcome.losses`：战前 / 战后人数），
 * 返回"该补回哪些兵、各几个" —— **只算账，不写世界**。
 * 三条战后路径（野怪 / 攻城 / 遭遇战）各自把结果并回 `hero.army`，
 * 因为它们的部队写法不一样（有的整队替换、有的只发收益）。
 *
 * 两处边界：
 *  ① 只复活"这一场死掉的"，不会补满，也不会超过战前人数；
 *  ② **全灭的兵种也要能回来**（`after = 0` ⇒ 阵亡 = before），
 *     否则"急救"在"死光了一队"这种最需要它的时刻恰好失效。
 */
export function fieldHospital(
  hero: Hero,
  losses: { unitTypeId: string; before: number; after: number }[],
): { unitTypeId: string; count: number }[] {
  const lv = skillLevel(hero, 'firstAid');
  if (lv <= 0) return [];
  // 比例只从表里读：写死 0.05/0.1/0.15 就等于把 §21.9 抄了第二遍，改表不会生效。
  const ratio = curveAt(FIRST_AID_RATIO, lv);
  const out: { unitTypeId: string; count: number }[] = [];
  for (const l of losses) {
    const lost = Math.max(0, l.before - l.after);
    if (lost <= 0) continue;
    const back = Math.min(lost, Math.max(1, Math.ceil(lost * ratio)));
    if (back > 0) out.push({ unitTypeId: l.unitTypeId, count: back });
  }
  return out;
}
