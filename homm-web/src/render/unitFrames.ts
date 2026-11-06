import { getAtlas } from './atlas.js';

/**
 * 单位**帧名**的唯一入口（S0 的别名层）。
 *
 * 为什么要有这一层：图集里的帧名是 `u_<canonical id>_map`，由 id **直接拼**出来。
 * B1 会把 20 个兵种 id 全换掉（`p1_lampbearer → p1_child`），一旦改名而美术还没重画，
 * **所有** `u_*_map` / `cu_*` 都会取不到 ⇒ 地图上部队、会面面板、战斗单位同时空白。
 * 别名层让"改数据"（B1）与"重画美术"（S3）能分开做、各自可回退。
 *
 * 规矩（§29.4 S0）：
 *   ① 只有这里能拼帧名，别处不许再写 `` `u_${id}_map` ``（`probe:frames` 静态扫这一条）；
 *   ② 表里没有的 id **原样透传**（旧 id 在新阵容落地后仍然是合法输入）；
 *   ③ 取不到帧由调用方兜底（色块 + 只警告一次），这里**不抛错**。
 *
 * 当前状态（2026-10-31）：**20 条已全部填好**，B1 改名落地即生效；美术重画后逐条删掉
 * （删到最后表为空 = 帧名与 id 重新一一对应，这一层就可以退休）。
 */
export const FRAME_ALIAS: Readonly<Record<string, string>> = {
  /* 新 id（B1 之后）→ 图集里现存的帧基名。19 条改名 + 1 条同 id（p3_dwarf）。
   *
   * ⚠️ **这张表不是 §16.6 的存档迁移表**，两者方向相反、p3 那两行还不一样：
   *   · 存档表（旧→新）按**语义**：旧 T3 藤蔓卫士 → 新 T3 树人。
   *   · 帧表（新→旧）按**像不像**：新树人直接借旧树人的帧（`p3_treant`），
   *     新猿人借旧藤蔓卫士。若照抄存档表，会在中期最常见的 T3 树人身上
   *     贴一张藤蔓卫士，反而把最常看到的那个兵画错。
   *   · 两张表都是 1:1 双射，只是那两行对调 —— 改动时**必须一起看**。 */
  /* S3a（2026-11-06）：p1 五条已删除 —— `cu_p1_child` / `cu_p1_crossbow` / `cu_p1_eagle`
   * / `cu_p1_knight` / `cu_p1_angel` 现在是**真帧**（`unitBodyPlan.ts` 按新体形档画的），
   * 不再借旧 id 的图。这张表剩下 p3–p4 的 9 条 + 2 条同 id。
   *
   * S3b（2026-11-06）：p2 五条也已删除 —— `cu_p2_matchman` / `cu_p2_bronze` /
   * `cu_p2_threewolf` / `cu_p2_lavagiant` / `cu_p2_devil` 同样是真帧。
   * 删到这一层只剩 p3/p4 时，"别名层可以退休"的那一天还没到（S3c 才清完）。 */

  p3_dwarf: 'p3_dwarf', // 同 id：留着这一行是为了「20 个兵一个不少」能数得出来
  p3_junglearcher: 'p3_thornarcher',
  p3_treant: 'p3_treant', // 见上面的 ⚠️：借旧树人的帧，不借藤蔓卫士
  p3_ape: 'p3_vineguard',
  p3_greendragon: 'p3_unicorn',

  p4_skeleton: 'p4_stoneimp',
  p4_zombie: 'p4_fireapprentice',
  p4_vampire: 'p4_hopgolem',
  p4_minotaur: 'p4_librarian',
  p4_wraith: 'p4_colossus',
};

/** 新 id → 图集里的旧帧名。未知 id 原样返回。 */
export function unitFrameAlias(id: string): string {
  return FRAME_ALIAS[id] ?? id;
}

/** 地图侧立绘帧名（52×44 那套）。 */
export function unitMapFrame(id: string): string {
  return `u_${unitFrameAlias(id)}_map`;
}

/** 战斗侧立绘帧名（`combatAtlas` 的 `cu_*`）。 */
export function unitCombatFrame(id: string): string {
  return `cu_${unitFrameAlias(id)}`;
}

/**
 * 兵牌立绘帧名（`atlas` 的 `pt_*`，22×30 全身缩略，S2）。
 *
 * 从**战斗帧名**推而不是从 id 推：烘焙侧手里只有 `cu_<base>`，消费侧只有 id，
 * 两边必须落在同一个帧名上。`pt_` 取 `cu_` 后面那段，因此这张表也自动继承
 * 别名层 —— M5 重画美术时逐条删别名，帧名跟着走，两边不会各改一半。
 */
export function portraitOfCombatFrame(combatFrame: string): string {
  return `pt_${combatFrame.replace(/^cu_/, '')}`;
}

/** 兵种 id → 兵牌立绘帧名（消费侧唯一入口）。 */
export function unitPortraitFrame(id: string): string {
  return portraitOfCombatFrame(unitCombatFrame(id));
}

const warned = new Set<string>();

/**
 * 缺帧只警告一次（每个 id 一条）。**不抛错**——抛错等于白屏，而缺一张立绘
 * 应该退化成"这一格没有图"，不是"整个面板打不开"。
 */
export function warnMissingFrame(name: string, where: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  // eslint-disable-next-line no-console
  console.warn(`[frame] ${where} 缺少帧 ${name}，已退化为色块`);
}

/** 探针用：清空"已警告"集合，便于重复验证"只警告一次"。 */
export function resetFrameWarnings(): void {
  warned.clear();
}

/** 探针用：已经警告过几个**不同**的帧名（重复同一个名不涨）。 */
export function frameWarnCount(): number {
  return warned.size;
}

/** 探针用：这条帧到底在不在图集里。 */
export function hasFrame(name: string): boolean {
  return getAtlas().has(name);
}
