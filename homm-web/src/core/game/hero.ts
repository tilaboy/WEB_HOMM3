import type { Army, GameState, Hero, HeroPrimary, PlayerId, ResourceBag } from '../types.js';
import { ARTIFACTS } from '../data/artifacts.js';
import { getUnit } from '../data/units.js';
import { BASE_MOVE_POINTS } from '../map/generator.js';
import { DIFFICULTIES } from '../data/factions.js';
import { EXP_CURVE_K, h3ExpStep } from '../data/balance.js';
import { CLASS_GROWTH, classIdOf } from '../data/heroes.js';
import { deriveSeed, mulberry32 } from '../rng.js';
import { equippedOf } from './equip.js';
import { grantSkillPicks, skillLevel, specialtyOf } from './skills.js';
import { WOODLAND_GRASS_MUL } from '../data/specialties.js';
import { LOGISTICS_MOVE, curveAt } from '../data/skills.js';

/** 身上真正**穿着**的宝物（U2）：背包里的不加属性，否则"卸下"没有意义。 */
function wornArtifacts(hero: Hero): string[] {
  const eq = equippedOf(hero);
  return Object.values(eq).filter((id): id is string => !!id);
}

export function effectivePrimary(hero: Hero): HeroPrimary {
  const p: HeroPrimary = { ...hero.primary };
  for (const id of wornArtifacts(hero)) {
    const m = ARTIFACTS[id]?.mods;
    if (!m) continue;
    p.attack += m.attack ?? 0;
    p.defense += m.defense ?? 0;
    p.spellPower += m.spellPower ?? 0;
    p.knowledge += m.knowledge ?? 0;
  }
  return p;
}

/**
 * 英雄每日移动力上限（含宝物加成）。
 *
 * 传入 `state` 时，若英雄属于玩家（p1）则再乘难度的 `playerMoveMul`，
 * 这样困难档玩家被罚移动力，且**无论新招还是老英雄、无论开局还是每日刷新都走同一处**，
 * 不会被"反复招新英雄"绕过（见 town.ts 的 hireHero 与 turn.ts 的每日刷新）。
 * 缺省 `state` 时不缩放（UI 预览等无需状态的场景安全退化）。
 */
export function maxMovePoints(hero: Hero, state?: GameState): number {
  let m = BASE_MOVE_POINTS;
  for (const id of wornArtifacts(hero)) m += ARTIFACTS[id]?.moveBonus ?? 0;
  /* 副技能「后勤」（H5 · §21.9）：移动力 +10 / 20 / 30%。
   * 放在宝物与难度**之间**：先加装备的绝对值，再按百分比放大，最后吃难度惩罚 ——
   * 这样困难档的 `playerMoveMul` 仍然作用在"最终值"上，不会被后勤抵消
   * （"被罚移动力"是难度定义，不该被一条副技能买回去）。 */
  const logi = skillLevel(hero, 'logistics');
  if (logi > 0) m = Math.round(m * (1 + curveAt(LOGISTICS_MOVE, logi)));
  if (state && hero.owner === 'p1') {
    const diff = DIFFICULTIES[state.config?.difficulty ?? 'normal'];
    m = Math.round(m * (diff.playerMoveMul ?? 1));
  }
  return m;
}

/**
 * H6「林地」（p3 艾莉亚）：草地移动消耗乘数（1 = 无减免）。
 *
 * 放在英雄这一侧而不是寻路里，是因为寻路只该知道"一个乘数"，
 * 而"谁有这个特长"是英雄的属性（`specialtyOf` 跟职业走）。
 */
export function grassMoveMul(hero: Hero): number {
  return specialtyOf(hero) === 'woodland' ? WOODLAND_GRASS_MUL : 1;
}

/** 法力上限 = 有效知识 × 10（含宝物加成）。 */
export function manaMaxOf(hero: Hero): number {
  return effectivePrimary(hero).knowledge * 10;
}

export function dailyGoldBonus(hero: Hero): number {
  let g = 0;
  for (const id of wornArtifacts(hero)) g += ARTIFACTS[id]?.dailyGold ?? 0;
  return g;
}

/**
 * 升到下一级所需经验（**本级到下一级之间的跨度**，不是累计阈值）。
 *
 * §21.6：旧 `100 × level^1.8` 的形状是反的（2 级只要 100，L2→L10 涨 195×），
 * 前期暴富后期停滞。改成 H3 的 20 行累计表差分 × `EXP_CURVE_K`（默认 0.5）。
 * 表与 k 都在 `data/balance.ts`，这里是唯一消费点。
 */
export function expToNext(level: number): number {
  return Math.max(1, Math.round(h3ExpStep(level) * EXP_CURVE_K));
}

const PRIMARY_KEYS = ['attack', 'defense', 'spellPower', 'knowledge'] as const;
const PRIMARY_TEXT: Record<(typeof PRIMARY_KEYS)[number], string> = {
  attack: '攻击',
  defense: '防御',
  spellPower: '魔力',
  knowledge: '知识',
};

/**
 * §21.5：按职业查概率表，2~9 级用身份表、10 级后趋同（防止早期偏科变永久）。
 *
 * ⚠️ `gainExp` 是**先 `level += 1` 再调本函数**，所以 `hero.level >= 10`
 * 恰好表示"这次升到 10 级或更高"，与规格的「10 级以上用趋同表」对齐。
 */
function levelUp(hero: Hero, seed: number): string {
  const growth = CLASS_GROWTH[classIdOf(hero.heroClass)];
  const w = hero.level >= 10 ? growth.late : growth.early;
  const r = mulberry32(seed)();
  let acc = 0;
  for (let i = 0; i < PRIMARY_KEYS.length; i++) {
    acc += w[i]! / 100;
    if (r < acc) {
      const key = PRIMARY_KEYS[i]!;
      hero.primary[key] += 1;
      return `${PRIMARY_TEXT[key]} +1`;
    }
  }
  // 权重合计恰好 100，只有浮点误差会让 r=1 落到这里；兜底给知识，绝不丢一次升级。
  hero.primary.knowledge += 1;
  return '知识 +1';
}

export function gainExp(state: GameState, hero: Hero, amount: number): string[] {
  /**
   * ⚠️ H3 换了曲线 ⇒ `hero.exp` 的余量整体变了，而升级 rng 的种子里含 `hero.exp`
   * （`deriveSeed(seed, level, exp, day)`）⇒ 同一场战斗的升级属性序列会重排。
   * 这是**读数该变**，不是回归：升级随机流本来就按每局的实时状态取种子，
   * 不是别人借来量平衡的那条流（铁律 7 指的是"别改别人的测量流"）。
   */
  hero.exp += amount;
  const notes: string[] = [];
  let guard = 0;
  while (hero.exp >= expToNext(hero.level) && guard++ < 50) {
    hero.exp -= expToNext(hero.level);
    hero.level += 1;
    notes.push(levelUp(hero, deriveSeed(state.seed, hero.level, hero.exp, state.day)));
    /* H5 · §21.9：2/4/6/8/10 级各发 1 点副技能点。
     * 发点放在**升级同一处**（而不是 UI 里）：AI 的英雄也升级，也得学技能，
     * 而 AI 没有弹窗 —— 由 `grantSkillPicks` 内部按 `isHuman` 分流。 */
    if (grantSkillPicks(state, hero, hero.level)) notes.push('可以选副技能');
  }
  return notes;
}

export function addResources(state: GameState, player: PlayerId, bag: ResourceBag): void {
  const p = state.players[player];
  if (!p) return;
  for (const [k, v] of Object.entries(bag) as [keyof ResourceBag, number][]) {
    if (!v) continue;
    p.resources[k] = (p.resources[k] ?? 0) + v;
  }
}

export function armySize(hero: Hero): number {
  return hero.army.reduce((s, st) => s + st.count, 0);
}

/**
 * 部队总血量。**不是战力**——只用于"还剩多少血"这类按血说话的场合
 * （战斗结算、探针读数、`armyHp` 的既有消费者）。
 *
 * ⚠️ 想量"这支部队有多强"请用 `armyValue()`。两者的区别不是系数，是**量纲**：
 * 20 个小孩（60 血、几乎打不动人）和 6 个骑士同血量级，但战力差 4 倍。
 */
export function armyHp(army: Army): number {
  return army.reduce((s, st) => s + (st.count > 0 ? st.count * getUnit(st.unitTypeId).hp : 0), 0);
}

/**
 * 部队总战力：`count × aiValue`（§25.4 ①②）。
 *
 * `aiValue` 是 `powerRef()`（B 口径战力）× 远程 1.25 —— 也就是**同一把尺子**，
 * 和 `balance-p2` 判平衡、`aiValue` 定征兵优先级用的是同一个数。
 * 在此之前 AI 到处用血量当战力：血量把"血厚但打不动"的兵算得过高
 * （僵尸 20 血、伤害 1~2，和弩手 10 血、伤害 2~4 同分），
 * 于是 AI 会为了堆血量去买最不划算的兵。**AI 与玩家之间的差距就从这里来。**
 */
export function armyValue(army: Army): number {
  return army.reduce((s, st) => s + (st.count > 0 ? st.count * getUnit(st.unitTypeId).aiValue : 0), 0);
}

/** 英雄的战斗力：**战力** × 四维加成（系数 0.03 不变）。只用于比较大小。 */
export function heroPower(hero: Hero): number {
  const p = effectivePrimary(hero);
  return armyValue(hero.army) * (1 + (p.attack + p.defense) * 0.03);
}
