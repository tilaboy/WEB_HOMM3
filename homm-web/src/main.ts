import type { Army, GameConfig, GameState, GridPos, GuardReward, Hero, MapObject, MapSize, MinePayload } from './core/types.js';
import { MAP_SIZES } from './core/types.js';
import { HERO_SIGHT, createGame } from './core/map/generator.js';
import { buildPath, computePaths, stepCost } from './core/map/pathfinding.js';
import type { PathField } from './core/map/pathfinding.js';
import { revealAround, isRevealed } from './core/map/fog.js';
import { idx, inBounds } from './core/map/grid.js';
import { TERRAIN } from './core/data/terrains.js';
import { DEFAULT_CONFIG, factionName, viewerOf } from './core/data/factions.js';
import {
  applyHeroBattle,
  applyInteraction,
  battleSetup,
  describeArmy,
  describeGuard,
  enemyHeroAt,
  heroBattleSetup,
  pendingObjectAt,
  previewInteraction,
} from './core/game/interaction.js';
import { openBattleScreen, isBattleOpen } from './ui/BattleScreen.js';
import { castAdventure, canAdventureCast, type AdventureTarget } from './core/game/spells.js';
import { getSpell } from './core/data/spells.js';
import { manaMaxOf, maxMovePoints } from './core/game/hero.js';
import type { BattleOutcome } from './core/combat/battle.js';
import { LAYOUTS } from './core/data/layouts.js';
import type { ScenarioObjective } from './core/data/scenarios.js';
import { SCENARIO_BY_ID, scenarioGenOptions } from './core/data/scenarios.js';
import { ownedMines } from './core/game/town.js';
import { removeHero } from './core/game/interaction.js';
import { endDay } from './core/game/turn.js';
import { aiEvents } from './core/game/aiReport.js';
import type { AiEvent, AiEventKind } from './core/game/aiReport.js';
import { evaluateOutcome, outcomeSummary } from './core/game/victory.js';
import { Camera } from './render/camera.js';
import { MapRenderer } from './render/MapRenderer.js';
import type { ViewModel } from './render/MapRenderer.js';
import { lightingOn, setLightingOn, setLightPhaseOverride } from './render/lightLayer.js';
import { getAtlas } from './render/atlas.js';
import {
  quality,
  initQuality,
  onTierChange,
  clampMapSize,
  hoverCapable,
  setMode,
  readMode,
  clearCachedTier,
  TIER_LABEL,
} from './render/quality.js';
import type { QualityMode } from './render/quality.js';
import { shouldEdgeScroll, shouldHover, isDoubleTap, normalizePointerType } from './render/pointerIntent.js';
import type { PointerKind, TapRecord } from './render/pointerIntent.js';
import { HUD } from './ui/HUD.js';
import { HeroPanel } from './ui/HeroPanel.js';
import { openStartScreen } from './ui/StartScreen.js';
import { openTownDialog } from './ui/TownDialog.js';
import { closeModal, hideInfoPopup, isModalOpen, showInfoPopup, showModal } from './ui/Dialogs.js';
import { isMuted, setMuted, sfx } from './ui/sfx.js';
import { play as playMusic } from './audio/music.js';
import { isMusicOn, setMusicOn } from './audio/bus.js';
import { clearSave, hasSave, hydratePersistence, loadConfig, loadGame, saveConfig, saveGame } from './save/persistence.js';
import { installLifecycle } from './app/lifecycle.js';
import { installIcons, labelIcon, setLabel } from './ui/icons.js';
import type { IconId } from './ui/icons.js';

/* ---------------- shell ---------------- */

// 图标 sprite 必须先挂：下面拇指带 4 个按钮建的时候就要 `<use href>`。
// 它不占图集（战斗 cu_* 只剩 4px），所以这里不受 `audit:atlas` 约束。
installIcons();

const app = document.getElementById('app') as HTMLElement;
const bootParams = new URLSearchParams(location.search);

const topbar = document.createElement('div');
topbar.id = 'topbar';
app.appendChild(topbar);

const stage = document.createElement('div');
stage.id = 'stage';
app.appendChild(stage);

const canvas = document.createElement('canvas');
canvas.id = 'map';
stage.appendChild(canvas);

const side = document.createElement('aside');
side.id = 'side';
/**
 * 右侧英雄栏。**收起态整条不渲染**（2026-10-22 主理人：「右面那条竖条修掉吧」）。
 *
 * 旧形态：收起 = 48px 竖条，条内留一枚 `#panel-toggle`「英雄」按钮。但拇指带圆盘里
 * 已经有同一枚「英雄」开关 ⇒ 那 48px 既重复又永久吃掉地图右缘，还逼得顶栏 `.showcase`
 * 让出 56px。现在收起 = `display:none`（见 `#side.collapsed`），入口/出口都只剩拇指带一处，
 * 地图拿回完整右缘。元素仍在 DOM（`classList` 的开关语义不变），只是不参与布局。
 */
side.classList.add('collapsed');
stage.appendChild(side);

/**
 * 英雄栏开着时，顶栏与拇指盘要给右缘让位（2026-10-27 主理人报「点英雄时半圆盘把英雄遮一半、
 * 上面也看不清」）。
 *
 * 两处遮挡，两个不同的原因：
 *   ① `#topbar` 是 `z-index:30` + `backdrop-filter:blur(3px)` 且**横跨整屏** ⇒ 面板顶部
 *      （头像 / 名字 / 等级）被它盖住并**糊掉** —— 这不是"看不清"，是被毛玻璃滤了一遍；
 *   ② `#thumb`（240×124 半圆盘）也 `z-index:30` 且贴右下 ⇒ 正好压住面板的标签行与内容区。
 * 修法：面板展开时把两者的右边界一起收到 200px（面板宽）。**不用 `:has()`** —— Android
 * WebView 版本不齐，JS 打一个 `body.side-open` 更稳。
 */
function syncSideChrome(): void {
  document.body.classList.toggle('side-open', !side.classList.contains('collapsed'));
}
syncSideChrome();

const sideBody = document.createElement('div');
// `#156`（b）：面板内容容器需要类名才能进「列 flex + 段内滚动」的样式链（见 `.side-body`）。
sideBody.className = 'side-body';
side.appendChild(sideBody);

const hintEl = document.createElement('div');
hintEl.id = 'hint';
stage.appendChild(hintEl);

/* ---------------- 底部拇指带（UX IA §4.2 / R5） ---------------- */

/**
 * 全部高频交互集中在下缘一条 48px 带内，且**位置固定**（肌肉记忆）。
 * 4 件：菜单 / 英雄 / 城 / 结束一天 —— 全为**纯文字标签**、
 * ≤2 字、**零图标**（D-40 / Q10：文字天然是语义载体，44px 放得下一两个汉字，省 4 份绘制）。
 * 「城」= 经营主面的一等常驻入口（D-32 / R9：探索与经营并列，城不得从属于英雄面板）。
 * 顶栏整条只读（R7），故"顶栏矮"与"按钮大"不再冲突。
 *
 * F-3.6（用户原话："移动力也没必要一直显示在下面…能减少别的显示框就减少"）已撤两件：
 * ① **移动力细条** → 数值改由**地图染色**呈现（`MapRenderer` 可达范围两色）+ 英雄面板按需；
 * ② **日志入口** → 移入**菜单一级项「事件日志」**（低频回顾归菜单），未读角标与读屏播报随迁到
 *    「菜单」按钮（IA §3.2 #23 ①②③ —— 信息只搬家、不丢失）。
 */
const thumb = document.createElement('div');
thumb.id = 'thumb';
app.appendChild(thumb);

/* ---------------- §14.2 教学 3/3 非阻断 banner ---------------- */

/**
 * 教学清单 3/3「完成那一刻」的**非阻断**提示（贴拇指带上方，高 ≤48px；§14.2）。
 * **不是真 modal** —— §4.2 规定只有 城镇 / 魔法书 / 设置 三类走 modal；它按需叠加、
 * **不常驻、不改地图可见率**（C1 / C5）。触发 = `HeroPanel` 在"由未全达成 → 全达成"
 * 的那一次回调（会话内一次性；载入即 3/3 不弹）。文案/按钮为 §14.2 的逐字句。
 */
const objBanner = document.createElement('div');
objBanner.id = 'obj-banner';
objBanner.hidden = true;
objBanner.setAttribute('role', 'status'); // 非阻断：读屏按状态播报，不夺焦
app.insertBefore(objBanner, thumb);

const objBannerText = document.createElement('span');
objBannerText.className = 'ob-text';
objBannerText.textContent = '你学会了。下一张图有人会来打你。';
objBanner.appendChild(objBannerText);

const objBannerGo = document.createElement('button');
objBannerGo.className = 'btn tb-btn primary';
objBannerGo.textContent = '去破碎罗盘';
objBannerGo.addEventListener('click', () => {
  hideObjBanner();
  goShowcase(); // 内部已有"覆盖当前存档"的确认弹窗（§14.2）
});
objBanner.appendChild(objBannerGo);

const objBannerClose = document.createElement('button');
objBannerClose.className = 'btn tb-btn';
objBannerClose.textContent = '关闭';
objBannerClose.setAttribute('aria-label', '关闭提示');
objBannerClose.addEventListener('click', () => hideObjBanner());
objBanner.appendChild(objBannerClose);

/** 显示 3/3 完成 banner（由 `HeroPanel` 的 3/3 转移回调触发）。 */
function showObjBanner(): void {
  objBanner.hidden = false;
}
/** 关闭 banner / 切换世界时隐藏。 */
function hideObjBanner(): void {
  objBanner.hidden = true;
}

/* ---------------- §F-3.6 展示图目标清单：顶部**只剩这一条** ---------------- */

/**
 * 展示图（`grims-showcase`）顶部**唯一**的一条信息条（F-3.2 / F-3.5 / F-3.6）：
 * 顶栏的资源 / 日期与底部常驻条在**本场景**下让位给这 3 条目标 ⇒ 打开就知道"现在该干什么"。
 *
 * ★ **红线**：只在 `state.config.scenario === 'grims-showcase'` 时创建 / 显示；
 *   自由对局 / `tutorial` / `duel` 不做任何分支（DOM 里连这个元素都不存在）。
 *
 * ★ **不新造任务系统**：数据优先取 `ScenarioDef.objectives`（`scenarios.ts` 的既有机制，
 *   `ScenarioObjective` 接口），取不到才用下面这份兜底；判定是**只读 `GameState`** 的
 *   一句布尔表达式，与 `HeroPanel.objectiveSection`（§14.2）同一套「达成即锁存」形态。
 */
const SHOWCASE_ID = 'grims-showcase';

/** 开局实测（seed 2175 / 40×40=1600 格）：已揭 83 格 = 5.2% ⇒ 阈值必须显著高于开局值。 */
const SHOWCASE_OBJECTIVES: ScenarioObjective[] = [
  { id: 'explore', text: '探索 20%', check: '已揭开格数 ≥ 全图 20%（开局 5.2%，走 3~4 天可达）' },
  { id: 'mines', text: '占 2 座矿', check: 'ownedMines(p1).length ≥ 2（开局 0，图上 20 座矿）' },
  { id: 'foe', text: '击败 1 名敌将', check: '敌方英雄数 < 本局峰值（开局 3 名）' },
];

/** 敌方英雄数（只读 `GameState`）。 */
function foeHeroCount(s: GameState): number {
  let n = 0;
  for (const id of s.heroOrder) if (s.heroes[id] && s.heroes[id].owner !== 'p1') n += 1;
  return n;
}

/**
 * 逐条判定。**全部只读 `GameState`**，零新系统。
 * `foe` 用"敌方英雄数跌破本局峰值" ⇒ 不需要给 `GameState` 加任何"击败过谁"的字段。
 */
const SHOWCASE_CHECK: Record<string, (s: GameState, foePeak: number) => boolean> = {
  explore: (s) => revealedCells(s) * 100 >= 20 * s.map.width * s.map.height,
  mines: (s) => ownedMines(s, 'p1').length >= 2,
  foe: (s, foePeak) => foeHeroCount(s) < foePeak,
};

/**
 * 三条目标的**进度分母**（2026-10-27：主理人报「全做完了没反应」——截图里三个勾全是空的，
 * 但面板不给任何"还差多少"，玩家无从判断是没达成还是没刷新）。
 *
 * 勾选只是结果；玩家真正需要的是过程量，所以每条再报一个 `当前/目标`：
 *   explore 7%/20%（开局 5.2%）· mines 1/2 · foe 0/1。
 * 只放**数字**不放句子 —— 顶栏一行放不下第三次"还差…"。
 */
const SHOWCASE_TARGET: Record<
  string,
  { cur: (s: GameState, peak: number) => number; target: number; fmt: (have: number, target: number) => string }
> = {
  /* 百分比只写当前值：文案里已经有「20%」（目标），再写一遍 "5%/20%" 就是同屏两个 20%。 */
  explore: {
    cur: (s) => Math.floor((revealedCells(s) * 100) / (s.map.width * s.map.height)),
    target: 20,
    fmt: (have) => `${have}%`,
  },
  /* 计数写 `当前/目标`：单写一个 0 看不出分母，"0/2" 才读得出"还差两座"。 */
  mines: {
    cur: (s) => ownedMines(s, 'p1').length,
    target: 2,
    fmt: (have, target) => `${have}/${target}`,
  },
  foe: {
    cur: (_s, peak) => Math.max(0, peak - foeHeroCount(_s)),
    target: 1,
    fmt: (have, target) => `${have}/${target}`,
  },
};

/** `?devobjprog=0` 关掉进度数字（只给 `probe:objectives` 的负向对照用）。 */
const OBJ_PROG = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devobjprog') !== '0';
  } catch {
    return true;
  }
})();
/** `?devobjdone=0` 关掉"全部达成"的一次性提示（同上，负向对照）。 */
const OBJ_DONE_HINT = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devobjdone') !== '0';
  } catch {
    return true;
  }
})();

/** 已揭开的格数：`revealed` 是定长 0/1 掩码 ⇒ 必须数 1，**不能**取 `.length`。 */
function revealedCells(s: GameState): number {
  const r = s.players.p1?.revealed ?? [];
  let n = 0;
  for (const v of r) if (v === 1) n += 1;
  return n;
}

/** 目标清单元素（**仅在展示图存在**；其余场景不进 DOM ⇒ 既有路径 DOM 逐字节不变）。 */
let objStripEl: HTMLElement | null = null;
/** 达成即保持（英雄阵亡 / 失城都不倒退，与 §14.2 同一形态）。 */
let objDone: Record<string, boolean> = {};
/** 本局敌方英雄数峰值（`foe` 条的基线）。 */
let objFoePeak = 0;
/** 锁存属于哪一局：`state` 对象身份变了 ⇒ 重播种。 */
let objOwner: GameState | null = null;
/** 「全部达成」只提示一次（换局重播）。 */
let objAllAnnounced = false;

function updateObjectives(): void {
  const on = state.config.scenario === SHOWCASE_ID;
  if (!on) {
    // 非展示图：元素整个摘掉 + 撤掉顶栏的 `showcase` 类 ⇒ 顶栏恢复既有形态。
    if (objStripEl) {
      objStripEl.remove();
      objStripEl = null;
    }
    topbar.classList.remove('showcase');
    return;
  }
  topbar.classList.add('showcase');
  if (state !== objOwner) {
    objOwner = state;
    objDone = {};
    objFoePeak = 0;
    objAllAnnounced = false;
  }
  const objs = SCENARIO_BY_ID[SHOWCASE_ID]?.objectives ?? SHOWCASE_OBJECTIVES;
  // 峰值**先**刷新再判定：`foe` 比较的是"当前值 vs 峰值"。
  objFoePeak = Math.max(objFoePeak, foeHeroCount(state));
  for (const o of objs) if (SHOWCASE_CHECK[o.id]?.(state, objFoePeak)) objDone[o.id] = true;

  if (!objStripEl) {
    objStripEl = document.createElement('div');
    objStripEl.id = 'objectives';
    objStripEl.setAttribute('role', 'list');
    topbar.appendChild(objStripEl);
  }
  const strip = objStripEl;
  strip.textContent = '';
  let allDone = objs.length > 0;
  for (const o of objs) {
    const got = objDone[o.id] === true;
    if (!got) allDone = false;
    const row = document.createElement('span');
    row.className = 'obj-row' + (got ? ' done' : '');
    row.setAttribute('role', 'listitem');
    row.setAttribute('data-obj-row', '1');
    row.setAttribute('data-obj-done', got ? '1' : '0');
    // 勾选标记是**纯 CSS 方块**（9px 描边 / 达成则填金），不引字形 ⇒ 不碰 G-17 的图标口径。
    const mark = document.createElement('i');
    mark.className = 'obj-mark';
    mark.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'obj-text';
    label.textContent = o.text;
    row.append(mark, label);
    /* 未达成的才显示「当前/目标」：达成之后数字只是噪音（勾就是答案）。
       读屏用整句，视觉上只用数字（顶栏一行放不下第三次"还差…"）。 */
    const t = SHOWCASE_TARGET[o.id];
    if (OBJ_PROG && t && !got) {
      const have = t.cur(state, objFoePeak);
      const prog = document.createElement('b');
      prog.className = 'obj-prog';
      prog.textContent = t.fmt(Math.min(have, t.target), t.target);
      row.appendChild(prog);
      row.setAttribute('aria-label', `未达成：${o.text}（当前 ${have}，目标 ${t.target}）`);
    } else {
      row.setAttribute('aria-label', `${got ? '已达成' : '未达成'}：${o.text}`);
    }
    strip.appendChild(row);
  }
  strip.setAttribute('data-obj-all', allDone ? '1' : '0');
  strip.classList.toggle('all', allDone);
  /* 三条全勾之后原来**什么都不发生**（主理人说"完全没有反应"）——
     清单不是胜利条件，但达成该有一次明确反馈。只提示一次，不弹窗打断。 */
  if (allDone && !objAllAnnounced) {
    objAllAnnounced = true;
    if (OBJ_DONE_HINT) hint('三条目标全部达成');
  }
}

function tbButton(ic: IconId, label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `btn tb-btn ${cls}`.trim();
  // 图标 + 文字**并排留在 DOM**（不是纯图标 + aria-label）：多道门按 textContent 找按钮。
  labelIcon(b, ic, label);
  b.addEventListener('click', onClick);
  thumb.appendChild(b);
  return b;
}

// 「菜单」= 全部低频项的唯一入口（§7 R6）。日志入口搬进菜单后曾把未读条数做成按钮角标，
// 2026-10-27 主理人裁定「去掉拇指带上的数字角标」：拇指带 4 个按钮只承担"去哪儿"，
// 一个没有文案的红数字在 44px 里既说不清是什么，又会被读成天数/资源。
// 条数改挂菜单里的「事件日志」那一行（含义自明、点进去即清零）—— 见 openMenu()。
const menuBtn = tbButton('menu', '菜单', '', () => openMenu());

tbButton('hero', '英雄', '', () => toggleHeroPanel());
tbButton('castle', '城', '', () => openHomeTown());

const endDayBtn = tbButton('endday', '结束一天', 'primary tb-end', () => doEndDay());

/** 日志未读游标：打开日志面板即清零（IA §3.2 #23：未读指示常驻，明细按需）。 */
let seenLog = 0;

/** 刷新拇指带（移动力细条 / 结束一天可用性 / 日志未读角标）。 */
function updateThumb(): void {
  const over = state.status !== 'playing';
  // P0 软锁修复：出局判定是「无英雄 **且** 无城」（victory.ts isEliminated）。
  // 原守卫 `over || !hasHero` 在「英雄全死、但还有城」时会灰掉按钮 ——
  // 此时玩家并未出局，却既不能行动（没英雄）也不能结束一天 ⇒ 死锁。
  // 禁用只看 `over`；`doEndDay` 本身已全程无英雄安全（recomputeField/refresh 都空守卫）。
  endDayBtn.disabled = over;
  // 只换文字、不碰图标：直接写 textContent 会把 `<svg>` 一起抹掉。
  setLabel(endDayBtn, over ? '对局结束' : '结束一天');

  // F-3.6：移动力不再常驻拇指带（数值改由地图染色 + 英雄面板按需呈现）。
  // 未读条数也不在这儿了（见 menuBtn 上方的注释）——拇指带只回答"去哪儿"。
  menuBtn.setAttribute('aria-label', '菜单');
}

/**
 * 「英雄」= **开关**右侧英雄栏（探索侧信息面）。
 * 入口/出口同一处（R2）：拇指带「英雄」是唯一开关 —— 面板内那枚 `#panel-toggle` 已随
 * 48px 竖条一起撤掉（2026-10-22），开与关都走同一个按钮，肌肉记忆只有一条。
 */
function toggleHeroPanel(): void {
  if (isModalOpen() || isBattleOpen()) return;
  const collapsed = side.classList.contains('collapsed');
  side.classList.toggle('collapsed');
  if (collapsed) side.scrollTop = 0;
  syncSideChrome();
}

/** 「城」= 经营主面直达（D-32 一等入口）：开最近/选中英雄所在的己方城镇。 */
function openHomeTown(): void {
  if (isModalOpen() || anim || isBattleOpen()) return;
  const hero = selected ? state.heroes[selected] : null;
  let town = hero
    ? Object.values(state.towns).find((t) => t.owner === 'p1' && t.pos.x === hero.pos.x && t.pos.y === hero.pos.y)
    : undefined;
  if (!town) town = Object.values(state.towns).find((t) => t.owner === 'p1');
  if (!town) {
    hint('你还没有属于你的城镇');
    return;
  }
  openTownById(town.id);
}

/** 「日志 N」= 从右侧滑出的日志面板（IA §3.2 #23 / §9 F2）。 */
function openLogPanel(): void {
  if (isModalOpen() || isBattleOpen()) return;
  if (document.getElementById('logpanel')) return;
  const root = document.createElement('div');
  root.id = 'logpanel';
  root.className = 'logpanel';

  const panel = document.createElement('div');
  panel.className = 'lp-panel';
  const head = document.createElement('div');
  head.className = 'lp-head';
  const h = document.createElement('h3');
  h.textContent = '事件日志';
  const close = document.createElement('button');
  close.className = 'btn tb-btn';
  close.textContent = '关闭';
  close.addEventListener('click', () => root.remove());
  head.append(h, close);
  const body = document.createElement('div');
  body.className = 'lp-body';
  const entries = state.log.slice(-60).reverse();
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'lp-empty';
    empty.textContent = '暂无事件';
    body.appendChild(empty);
  } else {
    for (const e of entries) {
      const d = document.createElement('div');
      d.textContent = `D${e.day} · ${e.text}`;
      body.appendChild(d);
    }
  }
  panel.append(head, body);
  root.appendChild(panel);
  root.addEventListener('click', (ev) => {
    if (ev.target === root) root.remove();
  });
  stage.appendChild(root);

  seenLog = state.log.length;
  updateThumb();
}

/**
 * 菜单（IA §7 / R6）：全部低频项的唯一入口，危险项入底并二次确认。
 *
 * 一级 = **6 项**（继续 / 存档·读档 / 事件日志 / 设置 / 回到开始页 / 新游戏），
 * 恰为 §7「一级 ≤ 6 项」的上限。为把「事件日志」（F-3.6 从拇指带搬来）纳入上限内，
 * 按 **§7 既有的菜单树**把原先分开的「立即存档 / 读取最近存档」收成**一项「存档 / 读档」+ 二级**
 * （§7 树：`存档 / 读档 ├─ 立即存档 └─ 读取最近存档`；二级 ≤4 项，本处 3 项）。
 * —— 这不是新设计，是把代码里"一直分开的 2 项"对齐到 §7 既有树；不合并一级就会到 7 项、破 §7。
 */
function openMenu(): void {
  if (isModalOpen() || isBattleOpen()) return;
  const root = document.createElement('div');
  root.id = 'menu';
  root.className = 'menu';
  const panel = document.createElement('div');
  panel.className = 'menu-panel';
  root.appendChild(panel);
  root.addEventListener('click', (ev) => {
    if (ev.target === root) root.remove();
  });

  const closer = (): void => root.remove();
  const button = (cls: string, label: string, act: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = `btn menu-item${cls ? ' ' + cls : ''}`;
    b.textContent = label;
    b.addEventListener('click', act);
    panel.appendChild(b);
    return b;
  };
  const heading = (title: string): void => {
    const h = document.createElement('h3');
    h.textContent = title;
    panel.appendChild(h);
  };

  /** 二级：存档 / 读档（§7 树；二级 ≤4 项，本处 3 项）。 */
  function renderSaveLoad(): void {
    panel.replaceChildren();
    heading('存档 / 读档');
    button('', '立即存档', () => { saveGame(state); closer(); hint('已存档'); });
    button('', '读取最近存档', () => { closer(); loadLatest(); });
    button('', '返回', () => renderMain());
  }

  /** 一级：6 项，危险项永远在最底（§7）。 */
  function renderMain(): void {
    panel.replaceChildren();
    heading('菜单');
    button('', '继续', () => closer());
    button('', '存档 / 读档', () => renderSaveLoad());
    // 日志入口：F-3.6 从拇指带搬来（复用 openLogPanel，函数不变；IA §3.2 #23 ①）
    // 未读条数挂在这一行（2026-10-27）：点开即清零 ⇒ 数字与"要不要点"在同一处。
    /* 条数做成**行内右侧的小胶囊**，不拼进文字。
     *
     * 拼文字试过两版都被折行打败：菜单是 2 列网格（`§7` 一级一屏放下），格内宽约 138px，
     * 「事件日志 · 13 条未读」= 153px。改成「· 13 未读」后一位数刚好、**两位数又折**
     * （日志上限 60 ⇒ 两位数才是常态）。折行会把格高撑到 66px，面板跟着顶出安全区。
     * 胶囊只吃 20px、永远不挤，文字保持「事件日志」四个字。
     */
    const unread = Math.max(0, state.log.length - seenLog);
    const logBtn = button('', '事件日志', () => { closer(); openLogPanel(); });
    if (unread > 0) {
      const c = document.createElement('span');
      c.className = 'mi-count';
      c.textContent = String(unread);
      logBtn.appendChild(c);
      // 完整句子给读屏（数字不是唯一语义载体，a11y 基线 §4.3）
      logBtn.setAttribute('aria-label', `事件日志，${unread} 条未读`);
    }
    button('', '设置', () => { closer(); openSetup(); });
    /* 教学模式专属项：只在教学局里出现（2026-10-12 用户裁定「除非选择跳过」）。
     * 不进 §7 一级 6 项的常态计数 —— 它像「事件日志」一样是**情境项**，
     * 只在教学模式这一局存在，且放在「回到开始页」之前 = 更靠近"退出这条路"。 */
    if (inTutorial() && !tutorialDone()) {
      button('', '跳过教学', () => { closer(); skipTutorial(); });
    }
    button('', '回到开始页', () => { closer(); openStart(); });
    button('danger', '新游戏', () => { closer(); confirmNewGame(); });
  }

  renderMain();
  app.appendChild(root);
}

/** 读档：把最近存档灌回 state 并重建全部派生状态（R1：回到地图，镜头与选中英雄复位到存档值）。 */
function loadLatest(): void {
  const g = loadGame();
  if (!g) {
    hint('没有找到存档');
    return;
  }
  state = g;
  selected = state.heroOrder.find((id) => state.heroes[id]?.owner === 'p1') ?? null;
  camera.mapW = state.map.width;
  camera.mapH = state.map.height;
  anim = null;
  pickSpell = null;
  pendingDest = null;
  hover = null;
  previewPath = null;
  lastStepFrom = null;
  centered = false;
  const hero = selected ? state.heroes[selected] : null;
  if (hero) {
    camera.centerOn(hero.pos.x, hero.pos.y);
    centered = true;
  }
  renderer.resize();
  camera.clamp();
  closeModal();
  // TP-3：地图场景 ⇒ map 曲（audio-direction.md §10.1 接线②）。两处"进图"路径
  // （读最近存档 / 开新局，含 startScenario 的教程与破碎罗盘）共用同一转入点，
  // 从 menu 交叉淡入 700ms（§3.1-3）。
  playMusic('map');
  recomputeField();
  refresh();
  renderLog();
  seenLog = state.log.length;
  hideObjBanner(); // 换世界 ⇒ 3/3 banner 归零（新局里由 HeroPanel 重新判断）
  hint('已读取最近存档');
}

/** 新游戏：会话级操作，绝不能在日常 UI 里误触 → 二次确认（IA §3.1 #16 / §9 E）。 */
function confirmNewGame(): void {
  showModal(app, {
    title: '开新对局？',
    body: ['当前进度会被自动存档覆盖，确定要开始新的一局吗？'],
    actions: [
      { label: '取消', onClick: (c) => c() },
      {
        label: '新游戏',
        danger: true,
        onClick: (c) => {
          c();
          openStart();
        },
      },
    ],
  });
}

/**
 * 设置面板（IA §7 二级 / a11y 基线 §4.2）。
 * 音效 / 光照是**开关**，必须 `aria-label` + `role="switch" aria-checked`：
 * 只给图标的话读屏要么念错、要么直接跳过（基线 §4.2）。
 * 图标用图集精灵 `ic_sound_on/off`、`ic_light_on/off`，替掉原顶栏的 4 个 emoji（G-17）。
 */
function setupToggle(
  label: string,
  frameOn: string,
  frameOff: string,
  getOn: () => boolean,
  onToggle: () => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'setup-row';
  const k = document.createElement('span');
  k.className = 'setup-k';
  k.textContent = label;
  const sw = document.createElement('button');
  sw.className = 'setup-sw';
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-label', label);
  const img = document.createElement('img');
  img.draggable = false;
  const st = document.createElement('span');
  st.className = 'setup-state';
  sw.append(img, st);
  const sync = (): void => {
    const on = getOn();
    img.src = getAtlas().url(on ? frameOn : frameOff);
    st.textContent = on ? '开' : '关';
    sw.setAttribute('aria-checked', String(on));
    sw.classList.toggle('on', on);
  };
  sw.addEventListener('click', () => {
    onToggle();
    sync();
  });
  sync();
  row.append(k, sw);
  return row;
}

function openSetup(): void {
  if (isModalOpen()) return;
  const wrap = document.createElement('div');
  wrap.className = 'setup';

  wrap.appendChild(
    setupToggle(
      '音效',
      'ic_sound_on',
      'ic_sound_off',
      () => !isMuted(),
      () => {
        setMuted(!isMuted());
        if (!isMuted()) sfx.click();
      },
    ),
  );
  // TP-3 / Q3：音乐**独立于音效**的开关（homm.music，默认开）。
  // homm.mute 保持总开关语义不变；关音乐不关音效是移动端最常见组合（§11-Q3）。
  wrap.appendChild(
    setupToggle(
      '音乐',
      'ic_music_on',
      'ic_music_off',
      () => isMusicOn(),
      () => {
        setMusicOn(!isMusicOn());
        if (isMusicOn()) sfx.click(); // 给一个即时反馈：开了就听见一下
      },
    ),
  );
  wrap.appendChild(
    setupToggle(
      '昼夜光照',
      'ic_light_on',
      'ic_light_off',
      () => lightingOn(),
      () => setLightingOn(!lightingOn()),
    ),
  );

  // 画质：自动 / 低 / 中 / 高（Q-10）。当前模式高亮为 primary。
  const qrow = document.createElement('div');
  qrow.className = 'setup-row setup-row-col';
  const qk = document.createElement('span');
  qk.className = 'setup-k';
  qk.textContent = '画质';
  const seg = document.createElement('div');
  seg.className = 'setup-seg';
  const mode = readMode();
  const modeLabel: Record<QualityMode, string> = { auto: '自动', low: '低', mid: '中', high: '高' };
  for (const m of ['auto', 'low', 'mid', 'high'] as QualityMode[]) {
    const b = document.createElement('button');
    b.className = 'btn tiny' + (mode === m ? ' on' : '');
    b.textContent = modeLabel[m];
    b.setAttribute('aria-pressed', String(mode === m));
    b.addEventListener('click', () => {
      if (m === 'auto') void reProbe();
      else setMode(m);
      closeModal();
      openSetup();
    });
    seg.appendChild(b);
  }
  qrow.append(qk, seg);
  wrap.appendChild(qrow);

  const note = document.createElement('p');
  note.className = 'setup-note';
  note.textContent = `当前档位：${TIER_LABEL[quality.tier]} · 模式：${modeLabel[mode]}`;
  wrap.appendChild(note);

  showModal(app, {
    title: '设置',
    body: [wrap],
    actions: [{ label: '关闭', onClick: (c) => c() }],
  });
}

/* ---------------- state ---------------- */

/**
 * 原生壳里（iOS WKWebView）系统会回收 localStorage 导致丢档，所以权威存档在
 * Capacitor Preferences 里。这里必须**先**把 Preferences 灌回 localStorage，
 * 否则紧接着的 `loadGame()` 会读到空 localStorage 并误判"无存档"。
 * 用顶层 await 保证它先于任何存档读取完成（tsconfig 为 ES2022 + NodeNext，支持 TLA）。
 */
await hydratePersistence();

/** 先把存档读出来：有存档就先进游戏（设置页盖在上面提供"继续/新开"两条路）。 */
const savedGame = loadGame();
const lastConfig = loadConfig();

let state: GameState = savedGame ?? createGame({ ...DEFAULT_CONFIG, ...(lastConfig ?? {}) });
let selected: string | null = state.heroOrder[0] ?? null;
let fieldFull: PathField | null = null;
let fieldTurn: PathField | null = null;
let previewPath: GridPos[] | null = null;
/**
 * 预览路径的两个补充量（与 `previewPath` 同生同灭）：
 *   · `previewFrom` = 英雄所在格。`buildPath()` 只返回步子、不含起点，渲染器拿它当折线起点；
 *   · `previewDay`  = 沿这条路径**今天**能走完的步数（``previewPath.length`` 或更大 ⇒ 全程今天）。
 * 没有它们，跨天行程在图上就是"一条实线"，玩家看不出今天到底能走到哪。
 */
let previewFrom: GridPos | null = null;
let previewDay = 0;
/** 每天走完的步数表（`dayStops` 的输出）；末尾恒 = `previewPath.length`。 */
let previewStops: number[] = [];
let hover: GridPos | null = null;
let anim: { heroId: string; path: GridPos[]; i: number; t: number } | null = null;
/** 英雄踏入当前格之前所在的格子，野怪战撤退时要退回这里 */
let lastStepFrom: GridPos | null = null;
/**
 * 跨天行程：目的地一天走不完时记下来，次日按 M 继续走。
 * 走完全程 / 被战斗或物件交互打断 / 改点别处时清空。
 */
let pendingDest: { heroId: string; dest: GridPos } | null = null;
const heroRender: Record<string, { x: number; y: number }> = {};

const camera = new Camera();
camera.mapW = state.map.width;
camera.mapH = state.map.height;
const renderer = new MapRenderer(canvas, camera);
// 调试：?devbadge=1 重新打开地图队伍徽标（默认已撤，见用户试玩裁决）。
// 与 ?devquick / ?devtown 同一套惯例 —— 查询参数驱动；无人传即不影响生产路径。
if (bootParams.has('devbadge')) renderer.badgesVisible = true;
// 调试：?devshade=0 关闭地形「地貌层」（terrainShade）—— 只做「同视角、只差地貌层」的
// 改前/改后对照（tools/deviceshot.mjs 真 Chrome / tools/artshot.mjs 垫片）。
// 与 ?devbadge / ?devlight 同一套惯例 —— 查询参数驱动；不传即恒开（默认不影响生产路径）。
const devShade = bootParams.get('devshade');
if (devShade !== null) renderer.setMacroShade(devShade !== '0'); // '0' ⇒ 关；其余 ⇒ 开

/** 打开城镇面板：城里有英雄就带上他，没有就远程管理（只能补驻军）。 */
function openTownById(townId: string): void {
  const town = state.towns[townId];
  if (!town) return;
  const heroId: string | null =
    state.heroOrder.find((id) => {
      const h = state.heroes[id];
      return h && h.pos.x === town.pos.x && h.pos.y === town.pos.y;
    }) ?? null;
  openTownDialog(stage, {
    state,
    townId,
    heroId,
    onChange: () => {
      recomputeField();
      refresh();
      renderLog();
      saveGame(state);
    },
    onHire: (newHeroId) => {
      const nh = state.heroes[newHeroId];
      if (nh) revealAround(state, nh.owner, nh.pos, HERO_SIGHT);
      selected = newHeroId;
      recomputeField();
      refresh();
    },
  });
}

function locateTown(townId: string): void {
  const town = state.towns[townId];
  if (!town) return;
  camera.centerOn(town.pos.x, town.pos.y);
  hint(`${town.name} · (${town.pos.x}, ${town.pos.y})`);
}

const panel = new HeroPanel(
  sideBody,
  (id) => {
    if (isModalOpen() || anim) return;
    selected = id;
    const h = state.heroes[id];
    if (h) camera.centerOn(h.pos.x, h.pos.y);
    recomputeField();
    refresh();
  },
  { onLocate: locateTown, onOpen: openTownById },
  (id) => openSpellBook(id),
  () => goShowcase(),
  () => showObjBanner(),
);

const hud = new HUD(topbar);

const STEP_MS = 165;

/**
 * 底部提示条改成**瞬时 toast**（IA §3.2 #22 / §9 F2）：原形态是常驻文本、与地图争底角，
 * 且每次 hover/点击都改写它 → 闪烁噪音。现在 2s 自动淡出，位置移到拇指带正上方。
 */
let hintTimer = 0;
function hint(text: string): void {
  hintEl.textContent = text;
  hintEl.classList.add('show');
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => hintEl.classList.remove('show'), 2000);
}

function recomputeField(): void {
  const hero = selected ? state.heroes[selected] : null;
  if (!hero) {
    fieldFull = null;
    fieldTurn = null;
    previewPath = null;
    return;
  }
  fieldFull = computePaths(state, hero.pos, Infinity);
  fieldTurn = computePaths(state, hero.pos, hero.movePoints);
  for (const id of state.heroOrder) {
    const h = state.heroes[id];
    if (h && !anim) heroRender[id] = { x: h.pos.x, y: h.pos.y };
  }
}

function refresh(): void {
  hud.update(state);
  panel.update(state, selected);
  updateThumb();
  updateObjectives();
}

/**
 * 日志不再常驻在地图上（IA §9 F2：那是地图左上最贵的位置）。
 * 收起态 = 拇指带「日志 N」的未读角标；展开态 = 点开后的右侧滑出面板（见 openLogPanel）。
 * 所以这里只需刷新角标。
 */
function renderLog(): void {
  updateThumb();
}

/* ---------------- movement ---------------- */

/**
 * 沿 `path` 从英雄脚下累加 `stepCost`，返回**每一天走完的步数表**（递增，末尾 = `path.length`）。
 *
 * `[len]` 表示今天走完；`[6, len]` 表示走两天；`[6, 24, len]` 表示走三天。
 *
 * 为什么不用"剩余移动力 ÷ 平均代价"估：地形代价差 1~3 倍（道路 100 / 草地 100 / 沼泽 175，
 * 斜向 ×1.4），估出来的分界会落在**今天其实走不到**的格子上 —— 而那正是这条信息要防的错。
 * 这里逐格累加，与 `tickAnim` 里"走一步扣一次"用的是**同一个** `stepCost`；
 * 两者若不一致，玩家看到的线与英雄实际停下的位置就会错开一格。
 *
 * **次日预算 = 已花 + 一整天**（`maxMovePoints`）：`turn.ts` 换日时直接把
 * `movePoints` 重置成上限、**不结转剩余**，所以"第一天剩下的 300"不会滚进第二天。
 * 按结转算的话，第三天那道刻痕会画晚一格 —— 玩家以为第三天到得了，实际要第四天。
 */
function dayStops(hero: Hero, path: GridPos[]): number[] {
  const per = maxMovePoints(hero, state);
  const out: number[] = [];
  let budget = hero.movePoints;
  let spent = 0;
  for (let i = 0; i < path.length; i++) {
    const from = i === 0 ? hero.pos : path[i - 1];
    const c = stepCost(state, from, path[i]);
    if (!Number.isFinite(c)) {
      // `buildPath` 保证可达；真出现就走不了了，把已算出的天表封口。
      out.push(path.length);
      return out;
    }
    if (spent + c > budget) {
      out.push(i); // 第 i 步走不完 ⇒ 当天止步于此
      budget = spent + per; // 次日：从"当前已花"起算一整天（剩余不结转）
      /* 极端兜底：单步代价超过一整天（现实地形上限 245 ≪ 1800，走不到这条分支，
         但若改了地形表，这里不能让天表退化成"每天 0 步"的死循环）。 */
      if (spent + c > budget) budget = spent + c + per;
    }
    spent += c;
  }
  out.push(path.length);
  return out;
}

/** 设预览路径的唯一入口 —— 三个量必须同时写，漏一个就会出现"线从别处开始"或"分界错位"。 */
function setPreview(hero: Hero | null, g: GridPos | null): void {
  if (!hero || !g || !fieldFull) {
    previewPath = null;
    previewFrom = null;
    previewDay = 0;
    previewStops = [];
    return;
  }
  const path = buildPath(state, fieldFull, hero.pos, g);
  previewPath = path.length ? path : null;
  previewFrom = previewPath ? { x: hero.pos.x, y: hero.pos.y } : null;
  /* `dayStops` 恒返回非空数组（末尾是 `path.length`）⇒ 单天行程 = `[len]`，
     渲染器据此得 0 道刻痕；跨两天 = `[cut, len]` ⇒ 1 道。 */
  previewStops = previewPath ? dayStops(hero, previewPath) : [];
  previewDay = previewStops[0] ?? 0;
}


function tryMove(target: GridPos): void {
  const hero = selected ? state.heroes[selected] : null;
  if (!hero || anim || isModalOpen()) return;
  if (hero.movePoints <= 0) {
    hint('移动力已耗尽，点击右上角「结束一天」');
    return;
  }
  const f = computePaths(state, hero.pos, Infinity);
  const p = buildPath(state, f, hero.pos, target);
  if (!p.length) {
    if (pendingDest?.heroId === selected) pendingDest = null;
    hint('那里去不了');
    return;
  }
  // 全程费用超过今日剩余移动力 → 记为跨天行程，地图上插目的地小旗
  const total = f.cost[idx(state.map, target.x, target.y)];
  pendingDest = total > hero.movePoints ? { heroId: selected as string, dest: target } : null;
  anim = { heroId: selected as string, path: p, i: 0, t: 0 };
  previewPath = null;
}

function tickAnim(dt: number): void {
  if (!anim) return;
  const hero = state.heroes[anim.heroId];
  if (!hero) {
    anim = null;
    return;
  }
  anim.t += dt;
  while (anim.i < anim.path.length && anim.t >= STEP_MS) {
    anim.t -= STEP_MS;
    const to = anim.path[anim.i];
    const cost = stepCost(state, hero.pos, to);
    if (cost > hero.movePoints) {
      anim = null;
      hint(pendingDest ? '移动力耗尽，明天按 M 继续行程' : '移动力不足，剩余行程明日再走');
      recomputeField();
      refresh();
      return;
    }
    // 敌方英雄挡在路上：不踩上去，改成发起遭遇战
    const foe = enemyHeroAt(state, to.x, to.y, hero.owner);
    if (foe) {
      const heroId = anim.heroId;
      const foeId = foe.id;
      anim = null;
      pendingDest = null;
      recomputeField();
      refresh();
      startHeroEncounter(heroId, foeId);
      return;
    }
    lastStepFrom = { x: hero.pos.x, y: hero.pos.y };
    hero.pos = to;
    hero.movePoints -= cost;
    anim.i += 1;
    sfx.step();
    revealAround(state, hero.owner, hero.pos, HERO_SIGHT);
    const obj = pendingObjectAt(state, anim.heroId);
    if (obj) {
      const heroId = anim.heroId;
      anim = null;
      pendingDest = null;
      recomputeField();
      refresh();
      onArrive(heroId, obj);
      return;
    }
  }
  if (anim && anim.i >= anim.path.length) {
    anim = null;
    pendingDest = null;
    recomputeField();
    refresh();
    saveGame(state);
  }
}

function updateHeroRender(): void {
  for (const id of state.heroOrder) {
    const h = state.heroes[id];
    if (!h) continue;
    if (anim && anim.heroId === id) {
      const from = anim.i > 0 ? anim.path[anim.i - 1] : h.pos;
      const to = anim.i < anim.path.length ? anim.path[anim.i] : h.pos;
      const k = Math.min(1, anim.t / STEP_MS);
      heroRender[id] = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    } else {
      heroRender[id] = { x: h.pos.x, y: h.pos.y };
    }
  }
}

/* ---------------- interaction ---------------- */

function onArrive(heroId: string, obj: MapObject): void {
  const pending = previewInteraction(state, heroId, obj.id);
  if (!pending) return;

  if (pending.kind === 'info') {
    showModal(stage, {
      title: pending.title,
      body: [pending.message],
      actions: [{ label: '知道了', primary: true, onClick: (c) => c() }],
    });
    return;
  }

  if (pending.kind === 'town' && pending.townId) {
    openTownById(pending.townId);
    return;
  }

  if (pending.kind === 'siege' && pending.townId) {
    const town = state.towns[pending.townId];
    const garrison = town ? town.garrison.filter((s) => s.count > 0) : [];
    if (!garrison.length) {
      resolve(heroId, obj, true);
      return;
    }
    // TP-6③ / F-3.5：城防等级出图集图标（`ic_wall_1/2`），不再写 '★' 文本符号。
    // 图标是**第二语义载体**：消息文本已写「带器械/未带器械/无城墙」，a11y 不依赖图标。
    const body: (Node | string)[] = [pending.message];
    if (pending.fortIcon) {
      const ic = document.createElement('img');
      ic.className = 'fort-ic';
      ic.draggable = false;
      ic.src = getAtlas().url(pending.fortIcon);
      ic.setAttribute('aria-hidden', 'true');
      body.push(ic);
    }
    showModal(stage, {
      title: pending.title,
      body,
      actions: [
        { label: '撤退', danger: true, onClick: (c) => { c(); resolve(heroId, obj, false); } },
        { label: '进入战场', primary: true, onClick: (c) => { c(); startBattle(heroId, obj, pending.title); } },
      ],
    });
    return;
  }

  if (pending.kind === 'battle' && pending.estimate) {
    showModal(stage, {
      title: pending.title,
      body: [pending.message],
      actions: [
        { label: '撤退（退回原地）', danger: true, onClick: (c) => { c(); resolve(heroId, obj, false); } },
        { label: '进入战场', primary: true, onClick: (c) => { c(); startBattle(heroId, obj, pending.title); } },
      ],
    });
    return;
  }

  resolve(heroId, obj, true);
}

/** 打开 M3 战术战斗；战斗结束后用真实战果推进世界状态。 */
function startBattle(heroId: string, obj: MapObject, title: string): void {
  const setup = battleSetup(state, heroId, obj);
  if (!setup) {
    resolve(heroId, obj, true);
    return;
  }
  openBattleScreen(stage, {
    state,
    heroId,
    title,
    attacker: setup.attacker,
    defender: setup.defender,
    seed: setup.seed,
    siegeLevel: setup.siegeLevel ?? 0,
    onDone: (outcome: BattleOutcome) => resolve(heroId, obj, true, outcome),
  });
}

function resolve(heroId: string, obj: MapObject, accept: boolean, outcome?: BattleOutcome): void {
  const res = applyInteraction(state, heroId, obj.id, accept, { retreatTo: lastStepFrom, outcome });
  recomputeField();
  refresh();
  renderLog();
  saveGame(state);
  if (res.heroDefeated) {
    if (!afterWorldChange()) showGameOver();
    return;
  }
  if (!res.title) return;

  // 拾取类交互给个亮响；占领矿场用锤音
  if (accept) {
    if (obj.kind === 'resourcePile' || obj.kind === 'treasureChest' || obj.kind === 'artifact' || obj.kind === 'fountain') {
      sfx.pickup();
    } else if (obj.kind === 'mine') {
      sfx.build();
    }
  }

  // 攻下城镇后直接进城管理
  if (obj.kind === 'town') {
    const townId = (obj.payload as { townId: string }).townId;
    const town = state.towns[townId];
    if (town && town.owner === 'p1') {
      const lines: (Node | string)[] = [res.message];
      if (res.levelUps.length) lines.push(`升级！${res.levelUps.join('、')}`);
      showModal(stage, {
        title: res.title,
        body: lines,
        actions: [
          { label: '关闭', onClick: (c) => c() },
          {
            label: '进城管理',
            primary: true,
            onClick: (c) => {
              c();
              openTownById(townId);
            },
          },
        ],
      });
      return;
    }
  }

  const body: (Node | string)[] = [res.message];
  if (res.levelUps.length) body.push(`升级！${res.levelUps.join('、')}`);
  showModal(stage, {
    title: res.title,
    body,
    actions: [{ label: '继续', primary: true, onClick: (c) => c() }],
  });
}

/* ---------------- 魔法书（M4） ---------------- */

/** 需要玩家在地图上点目标时，记录"正在施放哪个法术"。 */
let pickSpell: { heroId: string; spellId: string } | null = null;

function openSpellBook(heroId: string): void {
  if (isModalOpen() || anim) return;
  const hero = state.heroes[heroId];
  if (!hero) return;
  if (!hero.spells.length) {
    hint('还没学会任何法术：在城镇里建「魔法行会」');
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'spellbook';
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `法力 ${hero.mana}／${manaMaxOf(hero)}　·　战斗法术在战场上施放`;
  wrap.appendChild(sub);

  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const t of ['法术', '等级', '消耗', '']) {
    const th = document.createElement('th');
    th.textContent = t;
    head.appendChild(th);
  }
  table.appendChild(head);

  for (const id of hero.spells) {
    const sp = getSpell(id);
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = sp.name;
    td1.title = sp.desc;
    const td2 = document.createElement('td');
    td2.className = 'lv';
    td2.textContent = sp.combat ? `战斗 ${sp.level}` : `冒险 ${sp.level}`;
    const td3 = document.createElement('td');
    td3.className = 'cost';
    td3.textContent = String(sp.manaCost);
    const td4 = document.createElement('td');
    const btn = document.createElement('button');
    // M-09：法术书行距仅 ~9px，走 .spellbook .btn.tiny 的真实 44px（不加 .tap，避免命中区重叠）。
    btn.className = 'btn tiny';
    if (!sp.combat) {
      const chk = canAdventureCast(state, hero, id);
      btn.textContent = chk.ok ? '施放' : (chk.reason ?? '不可施放');
      btn.disabled = !chk.ok;
      btn.addEventListener('click', () => {
        closeModal();
        castAdventureUI(heroId, id);
      });
    } else {
      btn.textContent = '战斗中';
      btn.disabled = true;
    }
    td4.appendChild(btn);
    tr.append(td1, td2, td3, td4);
    table.appendChild(tr);
  }
  wrap.appendChild(table);

  showModal(stage, {
    title: `${hero.name} 的魔法书`,
    body: [wrap],
    actions: [{ label: '关闭', onClick: (c) => c() }],
  });
}

/** 施放冒险魔法：需要目标的进入点选模式，否则立即生效。 */
function castAdventureUI(heroId: string, spellId: string, target?: AdventureTarget): void {
  const res = castAdventure(state, heroId, spellId, target);
  if (!res.ok && res.needsTarget) {
    if (res.needsTarget === 'town') {
      const wrap = document.createElement('div');
      wrap.className = 'spellbook';
      const p = document.createElement('p');
      p.textContent = '选择要回到哪座城镇：';
      wrap.appendChild(p);
      for (const t of res.towns ?? []) {
        const b = document.createElement('button');
        b.className = 'btn';
        b.style.display = 'block';
        b.style.margin = '4px 0';
        b.textContent = t.name;
        b.addEventListener('click', () => {
          closeModal();
          castAdventureUI(heroId, spellId, { townId: t.id });
        });
        wrap.appendChild(b);
      }
      showModal(stage, {
        title: getSpell(spellId).name,
        body: [wrap],
        actions: [{ label: '取消', onClick: (c) => c() }],
      });
      return;
    }
    pickSpell = { heroId, spellId };
    hint(
      res.needsTarget === 'monster'
        ? '点击 5 格内的一支野怪（Esc 取消）'
        : '点击 8 格内的一个格子（Esc 取消）',
    );
    return;
  }
  afterCast(heroId, res);
}

function afterCast(heroId: string, res: { ok: boolean; message?: string; report?: string[] }): void {
  if (!res.ok) {
    hint(res.message ?? '施法失败');
    return;
  }
  const body: (Node | string)[] = [res.message ?? '施法完成'];
  if (res.report?.length) {
    for (const line of res.report) body.push(line);
  }
  const hero = state.heroes[heroId];
  if (hero) camera.centerOn(hero.pos.x, hero.pos.y);
  recomputeField();
  refresh();
  renderLog();
  saveGame(state);
  showModal(stage, {
    title: '施法成功',
    body,
    actions: [{ label: '继续', primary: true, onClick: (c) => c() }],
  });
}

/* ---------------- 英雄遭遇战 / 终局 / 开局 ---------------- */

/** 打开战术战场打一场英雄遭遇战。 */
function startHeroEncounter(attackerId: string, defenderId: string): void {
  const defender = state.heroes[defenderId];
  const setup = heroBattleSetup(state, attackerId, defenderId);
  if (!defender || !setup) return;
  openBattleScreen(stage, {
    state,
    heroId: attackerId,
    title: `遭遇 ${defender.name}（${factionName(defender.owner)}）`,
    attacker: setup.attacker,
    defender: setup.defender,
    seed: setup.seed,
    onDone: (outcome: BattleOutcome) => {
      const res = applyHeroBattle(state, attackerId, defenderId, outcome);
      afterWorldChange();
      recomputeField();
      refresh();
      renderLog();
      saveGame(state);
      if (state.status !== 'playing') return; // 终局面板会顶上
      const body: (Node | string)[] = [res.message];
      if (res.levelUps.length) body.push(`升级！${res.levelUps.join('、')}`);
      showModal(stage, {
        title: res.title,
        body,
        actions: [{ label: '继续', primary: true, onClick: (c) => c() }],
      });
    },
  });
}

/**
 * 世界状态变化后的统一收尾：重新判定胜负，赢了/输了就弹终局面板。
 * 返回 true 表示已经接管了界面（调用方不要再弹自己的弹窗）。
 */
function afterWorldChange(): boolean {
  if (evaluateOutcome(state) === 'playing') return false;
  showOutcome();
  return true;
}

function showOutcome(): void {
  const { title, lines } = outcomeSummary(state);
  const won = state.status === 'won';
  selected = null;
  recomputeField();
  refresh();
  renderLog();
  saveGame(state);
  hideObjBanner(); // 终局 ⇒ 3/3 banner 归零
  showModal(stage, {
    title,
    body: [
      won ? '所有的敌对旗帜都倒下了。' : '这片土地上再没有属于你的城与将。',
      ...lines,
    ],
    actions: [
      {
        label: '再来一局',
        primary: true,
        onClick: (c) => {
          c();
          openStart();
        },
      },
      { label: '留在这里看看', onClick: (c) => c() },
    ],
  });
}

/** 打开开局页；有存档时它会额外提供"继续上次存档"。 */
function openStart(): void {
  /* 2026-10-12：开局页只剩「破碎罗盘 + 难度」，所以这里只需要把**难度**透传下去
   * （存档里的 `config.difficulty`，即玩家上一局在开始页选的那一档）。
   * 尺寸 / 布局 / 种子 / 对手 / 名字那些调试入口全部作废 —— 它们对应的行已经不在 UI 里，
   * 留着只会让人以为还能选。随机地图仍可靠 `?devquick=` 进（见 boot 段）。 */
  const initial: Partial<GameConfig> = {
    difficulty: state.config.difficulty,
    playerName: state.config.playerName,
  };

  // TP-3：开始屏 = 主菜单场景 ⇒ menu 曲（audio-direction.md §10.1 接线①）。
  // ctx 懒创建：此刻通常还没有用户手势 ⇒ 调度器排不上音符，首次点击时才真响
  // （§7「首屏不出声」纪律，R1 守卫保证挂起期间零排程）。
  playMusic('menu');

  openStartScreen(app, {
    initial,
    hasSave: hasSave(),
    onStart: (config) => startNewGame(config),
    onContinue: () => {
      hint('继续当前对局');
    },
  });
}

/**
 * 场景若带**静态地形**（`ScenarioDef.staticMap`），它的尺寸是场景自带的、不可钳制
 * ⇒ 返回场景自己的 `size`；否则返回 `null`（= 照旧参与 `clampMapSize`）。
 *
 * 为什么单独抽一个函数：钳制点的判据必须**一处权威** —— 开始页的「试这张图」按钮和
 * 场景卡也各自需要"这个场景会不会被夹小"（否则 low 档上卡片会被错误地置灰），
 * 三处各写一遍 `?? staticMap` 就是同值多址。
 */
function staticSized(config: GameConfig): MapSize | null {
  const def = config.scenario ? SCENARIO_BY_ID[config.scenario] : null;
  if (!def?.staticMap) return null;
  return def.config.size;
}

/* ---------------- 教学模式（2026-10-12：首次自动进入，之后不再有入口）---------------- */

/**
 * 「这个人还教不教」的标记。**故意不放进 `persistence.ts`**：它不是对局数据、
 * 不该随存档读写迁移，只是一个本地布尔。隐私模式下写不进去 ⇒ 每次启动都进教学，
 * 这比"悄悄永不再教"可接受。
 */
const TUTORIAL_KEY = 'homm-tutorial-done';

function tutorialDone(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
}

function markTutorialDone(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    /* 见上：写不进去就每次都教 */
  }
}

/** 当前这一局是不是教学模式。菜单里的「跳过教学」只在这一局出现。 */
function inTutorial(): boolean {
  return state.config.scenario === 'tutorial';
}

/** 跳过教学：记标记 + 回开始页（那里现在只剩破碎罗盘 + 难度）。 */
function skipTutorial(): void {
  markTutorialDone();
  openStart();
}

/**
 * 直接开一个场景、跳过开始页。
 *
 * 三个调用方共用它，所以"展开 config"的逻辑只有一份：
 *   ① 教学模式首次自动进入（`boot` 段：无存档且未教过 ⇒ 进教学）；
 *   ② `?devscenario=<id>`（调试/回归；`duel` 从 UI 下线后就靠它进）；
 *   ③ `?devshowcase=1`（截图/回归直开展示图）。
 */
function startScenario(id: string): void {
  const def = SCENARIO_BY_ID[id];
  if (!def) {
    openStart();
    return;
  }
  const o = scenarioGenOptions(def);
  if (
    o.size === undefined ||
    o.layout === undefined ||
    o.seed === undefined ||
    o.opponents === undefined ||
    o.difficulty === undefined
  ) {
    return;
  }
  startNewGame({
    size: o.size,
    layout: o.layout,
    seed: o.seed,
    opponents: o.opponents,
    difficulty: o.difficulty,
    playerName: state.config.playerName,
    scenario: o.scenario,
  });
}

function startNewGame(config: GameConfig): void {
  clearSave();
  saveConfig(config);
  /* §M-02：地图尺寸按当前画质上限夹紧（低端 32 / 中端 40 / 高端 48），
   * 从源头掐掉超预算的地形烘焙面。原始偏好照常保存，切到高档后即可恢复。
   *
   * ★ 例外：**带静态地形的场景不参与钳制**（`grims-showcase`，导入地表 40×40）。
   *   为什么不能钳：静态地形的尺寸是**场景自带的**，不是玩家选的 —— 把它夹小只会让
   *   `applyStaticTerrain` 抛「静态地形尺寸不匹配：地图 32×32，导入 40×40」（low 档
   *   `maxMapSize = 32` ⇒ `clampMapSize('large', 32)` 得 `'medium'`），**点开即崩**。
   *   这不是"绕过画质档"，而是"这个尺寸不是可选项"：图三的乐趣本来就在"同一张图、
   *   每次都长得一样、可以认路"，缩一半就把这张图毁了。
   *   （代价：low 档机器上会跑 40×40。渲染开销由画质档其余开关承担，不在本函数内处理。）
   *
   * ★ 红线：只有 `staticMap` 存在的场景走这条分支；自由对局 / tutorial / duel
   *   （都没有 `staticMap` ⇒ `staticSized()` 返回 null）仍走原钳制，逐字节不变。 */
  state = createGame({ ...config, size: staticSized(config) ?? clampMapSize(config.size, quality.maxMapSize) });
  selected = state.heroOrder[0] ?? null;
  camera.mapW = state.map.width;
  camera.mapH = state.map.height;
  anim = null;
  pickSpell = null;
  hover = null;
  previewPath = null;
  lastStepFrom = null;
  centered = false;
  const hero = selected ? state.heroes[selected] : null;
  if (hero) {
    camera.centerOn(hero.pos.x, hero.pos.y);
    centered = true;
  }
  renderer.resize();
  camera.clamp();
  closeModal();
  // TP-3：地图场景 ⇒ map 曲（audio-direction.md §10.1 接线②）。两处"进图"路径
  // （读最近存档 / 开新局，含 startScenario 的教程与破碎罗盘）共用同一转入点，
  // 从 menu 交叉淡入 700ms（§3.1-3）。
  playMusic('map');
  recomputeField();
  refresh();
  renderLog();
  saveGame(state);
  hideObjBanner(); // 新局 ⇒ 3/3 banner 归零
  /* 教学模式：首句提示要告诉玩家"怎么出去"—— 它是自动进来的，没有人点过任何按钮，
   * 不说清楚"菜单 → 跳过教学"的话，玩家会以为这一局没有退出路径。 */
  if (inTutorial()) {
    hint('教学模式：跟着目标清单走，想跳过就在「菜单 → 跳过教学」');
  } else {
    hint(`${state.config.playerName} 的征程开始了`);
  }
}

/**
 * §14.2：教学 3/3 后「去破碎罗盘」= 开新局（`scenario='grims-showcase'`）。
 * 会**覆盖当前存档** ⇒ 触发前先用既有确认弹窗确认（两个入口、同一动作）。
 *
 * 2026-10-12 起这里是**教程之后唯一的目的地**：开局页已砍掉随机地图与试玩场景行，
 * 只剩教学模式（首次自动进入）+ 破碎罗盘。对决场（`duel`）随之从 UI 下线，
 * 定义仍留在 `scenarios.ts`（`?devscenario=duel` 可进，见 boot 段）。
 */
function goShowcase(): void {
  if (isModalOpen() || isBattleOpen()) return;
  const def = SCENARIO_BY_ID[SHOWCASE_ID];
  if (!def) return;
  showModal(stage, {
    title: '去破碎罗盘',
    body: ['会开一局新的破碎罗盘，当前进度（含本机存档）会被覆盖。'],
    actions: [
      { label: '取消', onClick: (c) => c() },
      {
        label: '开始',
        primary: true,
        onClick: (c) => {
          c();
          // `scenarioGenOptions` 是 `Partial<GameConfig>`（且 `DEFAULT_CONFIG` 不含 seed）
          // ⇒ 显式取出 5 个固定值 + 断言其存在，避免 spread 把必填字段变可选。
          const o = scenarioGenOptions(def);
          if (o.size === undefined || o.layout === undefined || o.seed === undefined || o.opponents === undefined || o.difficulty === undefined) return;
          startNewGame({
            size: o.size,
            layout: o.layout,
            seed: o.seed,
            opponents: o.opponents,
            difficulty: o.difficulty,
            playerName: state.config.playerName,
            scenario: o.scenario,
          });
        },
      },
    ],
  });
}

function showGameOver(): void {
  if (afterWorldChange()) return;
  selected = null;
  recomputeField();
  refresh();
  showModal(stage, {
    title: '英雄陨落',
    body: ['最后一位英雄倒在了荒野上。'],
    actions: [
      {
        label: '重新开始',
        primary: true,
        onClick: (c) => {
          c();
          openStart();
        },
      },
    ],
  });
}

function doEndDay(): void {
  if (isModalOpen() || anim || isBattleOpen()) return;
  if (state.status !== 'playing') return;
  endDay(state);
  sfx.day();
  lastStepFrom = null;
  recomputeField();
  refresh();
  renderLog();
  saveGame(state);
  if (afterWorldChange()) return;
  showAiDayReport();
}

/**
 * 过天摘要：**只有打到玩家头上时才弹**（2026-10-27 起；此前是每天必弹）。
 *
 * 数据源是 AI 行动时记的结构化事件（`aiReport.ts`），不解析日志文本。
 * `vsPlayer`（你的英雄被击败 / 你的城易主 / AI 打你的部队）才弹；
 * 其余（AI 之间清野怪、招兵、在自家城里挪动）只进日志，不占一屏。
 * 弹窗时把原收尾 hint 交给关闭回调 —— 否则 toast 会在模态背后 2 秒蒸发。
 */
function showAiDayReport(): void {
  const finish = (): void => {
    if (pendingDest && state.heroes[pendingDest.heroId]) {
      hint('按 M 继续昨日的行程（小旗处）');
      return;
    }
    /**
     * 不再回放"最后一条日志"（2026-10-23 主理人）。
     *
     * AI 永远在玩家之后行动 ⇒ 那条几乎总是电脑的家务事
     * （「焚风堡 驻军增加了 投斧蛮子 ×2」「紫晶秘法师 从 (19,27) 移动到 (17,23)」），
     * 玩家既定位不了、也用不上，还会被当成"这回合发生了什么"的字幕。
     * 真正与玩家有关的（交战 / 失守 / 英雄阵亡）已经在上面的「对手动向」里了，
     * 所以这里只报一句"现在是第几天"。
     */
    hint(`第 ${state.day} 天`);
  };

  /**
   * 只弹**打到玩家头上**的事件（2026-10-27 主理人：「每天结束一天的对手动向，没有必要」）。
   *
   * 原来的弹窗是"今天全世界发生了什么"：AI 之间互相清野怪、AI 招兵、AI 在自家城里挪来挪去，
   * 每天必弹一屏。这类信息玩家既定位不了也用不上，真正的动静（交战 / 失守 / 英雄阵亡）
   * 在日志里也有。所以：**平时不弹**，只有 `vsPlayer` 的事件（你的英雄被打、你的资产易主）
   * 才弹 —— 那是"你必须知道"的一类，不能因为去掉噪音而一起丢掉。
   */
  /* `?devreport=1`：把"全部事件"都弹出来 —— 只给探针用。
     `probe:uip0` 拿这扇普通弹窗量羊皮纸层级与文字对比度，判它"有没有弹出来"；
     若跟着产品规则只弹 vsPlayer，那条判据就会随机红（取决于当天 AI 干了什么）。 */
  const devAll = (() => {
    try {
      return new URLSearchParams(location.search).get('devreport') === '1';
    } catch {
      return false;
    }
  })();
  const evs = devAll ? aiEvents() : aiEvents().filter((e) => e.vsPlayer);
  if (!evs.length) {
    finish();
    return;
  }

  // 分组：按阵营；含"打到玩家头上"事件的阵营排最前（玩家的损失优先可见）。
  const groups = new Map<string, AiEvent[]>();
  for (const e of evs) {
    const arr = groups.get(e.player);
    if (arr) arr.push(e);
    else groups.set(e.player, [e]);
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    const pa = a[1].some((e) => e.vsPlayer) ? 0 : 1;
    const pb = b[1].some((e) => e.vsPlayer) ? 0 : 1;
    return pa - pb;
  });

  const body: (Node | string)[] = [];
  for (const [player, list] of ordered) {
    const head = document.createElement('p');
    head.className = 'ai-head';
    head.textContent = `${factionName(player as Parameters<typeof factionName>[0])}${state.players[player]?.isHuman ? '（你）' : ''}`;
    body.push(head);
    /**
     * 同一天里同一句话**只写一次**，重复次数用 `（×n）` 收在行尾。
     *
     * 原因很具体：AI 英雄一天会连着清掉好几队野怪，事件流就变成
     * 「赤焰领主 清掉了挡路的野怪」×3 —— 三行完全一样的字，玩家读不出
     * "到底是打了三场还是一件事报了三遍"（2026-10-23 主理人：字幕里没用的信息）。
     * 合并键带上色彩：好消息（绿）和坏消息（红）永远不合并。
     */
    const merged = new Map<string, { line: string; cls: string; n: number }>();
    for (const e of sortGroup(list)) {
      // 着色只回答一个问题："这条对玩家是好消息还是坏消息"。
      // vsPlayer 的交战且 AI 失手 = 好消息（绿）；其余打到玩家头上的（你的英雄阵亡 /
      // 你的资产易主 / 你的英雄被击败）都是坏消息（红）。
      const cls = 'ai-line' + (!e.vsPlayer ? '' : e.kind === 'battle' && e.win === false ? ' win' : ' loss');
      const text = aiEventLine(e);
      const key = `${cls}|${text}`;
      const hit = merged.get(key);
      if (hit) hit.n++;
      else merged.set(key, { line: text, cls, n: 1 });
    }
    for (const { line, cls, n } of merged.values()) {
      const p = document.createElement('p');
      p.className = cls;
      p.textContent = n > 1 ? `${line}（×${n}）` : line;
      body.push(p);
    }
  }

  showModal(stage, {
    title: `第 ${state.day} 天 · 对手动向`,
    body,
    actions: [{ label: '知道了', primary: true, onClick: (c) => { c(); finish(); } }],
  });
}

/** 组内排序：事件严重度优先（退出 > 阵亡 > 交战 > 占领 > 招募 > 移动），同级的玩家相关在前。 */
function sortGroup(list: AiEvent[]): AiEvent[] {
  const rank: Record<AiEventKind, number> = {
    out: 0, death: 1, battle: 2, capture: 3, hire: 4, move: 5,
  };
  return [...list].sort((a, b) => rank[a.kind] - rank[b.kind] || (a.vsPlayer ? 0 : 1) - (b.vsPlayer ? 0 : 1));
}

/** 一条事件的一句话。文案以"主体 + 发生了什么"组织，不搞标记前缀。 */
function aiEventLine(e: AiEvent): string {
  switch (e.kind) {
    case 'move':
      return `${e.what} ${e.detail}`;
    case 'battle':
      return `${e.what} ${e.detail}`;
    case 'capture':
      // 城镇：what 已含动词（"攻陷了曙光城"）；矿场：what 是标题、detail 是产出（"占领金矿（每日 +400）"）
      // hero 前缀不可省：否则"占领金矿"不知道是谁干的，玩家判断不出是哪员敌将在往哪儿去。
      return `${e.hero ? `${e.hero} ` : ''}${e.what}${e.detail ? `（${e.detail}）` : ''}`;
    case 'hire':
      return `${e.what} ${e.detail}`;
    case 'death':
      return e.vsPlayer ? `你的英雄 ${e.what} 阵亡` : `${e.what} ${e.detail}`;
    case 'out':
      return `${e.what} ${e.detail}`;
  }
}

/** 继续跨天行程：朝 pendingDest 的目的地重新寻路出发。 */
function continueJourney(): void {
  if (!pendingDest || anim || isModalOpen() || isBattleOpen()) return;
  const hero = state.heroes[pendingDest.heroId];
  if (!hero) {
    pendingDest = null;
    return;
  }
  if (hero.movePoints <= 0) {
    hint('移动力已耗尽，点击右上角「结束一天」');
    return;
  }
  if (selected !== pendingDest.heroId) {
    selected = pendingDest.heroId;
    recomputeField();
    refresh();
  }
  camera.centerOn(hero.pos.x, hero.pos.y);
  tryMove(pendingDest.dest);
}

/* ---------------- input ---------------- */

const pointers = new Map<number, { x: number; y: number }>();
let dragged = false;
let lastPan: { x: number; y: number } | null = null;
let lastPanT = 0;
let pinchDist = 0;
let longPress = 0;
/** 边缘滚屏用：鼠标在画布内的最近位置与是否在画布内。 */
let mouseIn = false;
let mouseX = 0;
let mouseY = 0;
/** 最近一次指针事件的类型：边缘滚屏只在真实鼠标下生效（M-01）。 */
let lastPointerType: PointerKind | null = null;
/** 上一次"落点"记录，用于识别双击（M-11：双击同一格居中）。 */
let lastTap: TapRecord | null = null;

function twoPointerDist(): number {
  const pts = [...pointers.values()];
  if (pts.length < 2) return 0;
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

function localPos(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

canvas.addEventListener('pointerdown', (e) => {
  const kind = normalizePointerType(e.pointerType);
  if (kind) lastPointerType = kind;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  hideInfoPopup();
  camera.stopFling();
  if (pointers.size === 1) {
    dragged = false;
    lastPan = { x: e.clientX, y: e.clientY };
    lastPanT = performance.now();
    window.clearTimeout(longPress);
    longPress = window.setTimeout(() => {
      if (!dragged && pointers.size === 1) {
        const p = localPos(e);
        showTileInfo(p.x, p.y);
        dragged = true;
      }
    }, 420);
  } else if (pointers.size === 2) {
    pinchDist = twoPointerDist();
    dragged = true;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const kind = normalizePointerType(e.pointerType);
  if (kind) lastPointerType = kind;
  const prev = pointers.get(e.pointerId);
  if (prev) {
    prev.x = e.clientX;
    prev.y = e.clientY;
  }
  const lp = localPos(e);
  mouseIn = true;
  mouseX = lp.x;
  mouseY = lp.y;
  if (pointers.size === 1 && lastPan) {
    const dx = e.clientX - lastPan.x;
    const dy = e.clientY - lastPan.y;
    // M-10：阈值 4→8px。触屏手指微抖常达 4~6px，4px 会把"点按"误判成拖拽，
    // 于是点按既选不中目标、又会顺带平移镜头。8px 是"明显是拖"的起点。
    if (!dragged && Math.abs(dx) + Math.abs(dy) > 8) {
      dragged = true;
      window.clearTimeout(longPress);
    }
    if (dragged) {
      camera.pan(dx, dy);
      const now = performance.now();
      camera.trackFling(dx, dy, now - lastPanT);
      lastPanT = now;
      lastPan = { x: e.clientX, y: e.clientY };
      hideInfoPopup();
    }
  } else if (pointers.size === 2) {
    const d = twoPointerDist();
    if (pinchDist && d) {
      const pts = [...pointers.values()];
      const r = canvas.getBoundingClientRect();
      const mx = (pts[0].x + pts[1].x) / 2 - r.left;
      const my = (pts[0].y + pts[1].y) / 2 - r.top;
      camera.zoomAt(mx, my, d / pinchDist);
    }
    pinchDist = d;
  }
  // Q-11：悬停仅对真实鼠标/触控笔生效（触屏没有 hover，跑了只会浪费并留下假高亮）。
  if (!dragged && shouldHover(lastPointerType)) updateHover(e);
});

function endPointer(e: PointerEvent): void {
  window.clearTimeout(longPress);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (pointers.size === 0) {
    if (!dragged) {
      // M-11：双击同一格 → 镜头平滑居中到该格。
      // 单击仍照常走 handleClick（选中/移动），并记录落点供下次判定。
      const p = localPos(e);
      const cur: TapRecord = { t: performance.now(), x: p.x, y: p.y };
      if (isDoubleTap(lastTap, cur)) {
        lastTap = null; // 用掉这一对，避免三连点里第 2、3 下再凑成一对
        const g = camera.pick(p.x, p.y);
        if (inBounds(state.map, g.x, g.y)) {
          camera.centerOn(g.x, g.y); // centerOn 内部已 stopFling + clamp
          hint('镜头已居中');
        }
      } else {
        lastTap = cur;
        handleClick(e);
      }
    } else {
      // 拖拽/捏合不是"点击"，且应打断双击链——否则"拖一下再点"会被误判为双击
      lastTap = null;
    }
    // 松手前最后一下移动离现在太久，说明是"停住再松手"，不该甩出惯性
    if (!dragged || performance.now() - lastPanT > 120) camera.stopFling();
    lastPan = null;
  }
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => {
  mouseIn = false;
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = localPos(e);
  camera.zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const p = localPos(e);
  showTileInfo(p.x, p.y);
});

function handleClick(e: PointerEvent): void {
  if (isModalOpen()) {
    closeModal();
    return;
  }
  hideInfoPopup();
  const p = localPos(e);
  const g = camera.pick(p.x, p.y);
  if (!inBounds(state.map, g.x, g.y)) return;

  // 正在施放需要指定目标的法术
  if (pickSpell) {
    const { heroId, spellId } = pickSpell;
    pickSpell = null;
    castAdventureUI(heroId, spellId, { pos: { x: g.x, y: g.y } });
    return;
  }

  for (const id of state.heroOrder) {
    const h = state.heroes[id];
    if (!h || h.pos.x !== g.x || h.pos.y !== g.y) continue;
    // 敌将不能选中：点他就是"打过去"（走过去的那一步会触发遭遇战）
    if (h.owner !== 'p1') {
      if (selected) tryMove(g);
      return;
    }
    selected = id;
    recomputeField();
    refresh();
    // 站在物件上时点击自己 = 重新打开交互（此时没有「上一格」可退）
    const obj = pendingObjectAt(state, id);
    if (obj) {
      lastStepFrom = null;
      onArrive(id, obj);
      return;
    }
    hint(`已选中 ${h.name}`);
    return;
  }
  if (selected) tryMove(g);
}

function updateHover(e: PointerEvent): void {
  const p = localPos(e);
  const g = camera.pick(p.x, p.y);
  if (!inBounds(state.map, g.x, g.y)) {
    hover = null;
    previewPath = null;
    return;
  }
  hover = g;
  const i = idx(state.map, g.x, g.y);
  if (!isRevealed(state, viewerOf(state), g.x, g.y)) {
    hint('未探索的区域');
    previewPath = null;
    return;
  }
  const t = state.map.tiles[i];
  const terrain = TERRAIN[t.terrain];
  let text = terrain.passable ? `${terrain.name} · 移动消耗 ${terrain.moveCost}` : `${terrain.name} · 不可通行`;
  const cost = fieldFull ? fieldFull.cost[i] : Infinity;
  if (isFinite(cost) && cost > 0) text += ` · 抵达需 ${Math.round(cost)} 移动力`;
  const hero = selected ? state.heroes[selected] : null;
  if (hero && fieldFull && isFinite(cost) && cost > 0) {
    setPreview(hero, g);
    if (cost > hero.movePoints) {
      /* 天数**直接取天表长度**，不再用 `ceil(剩余 / 每日上限)` 另算一遍 ——
         两处各算一次就会出现"文案说 3 天、图上却只有一道刻痕"（因为 ceil 把
         当天剩余也算成了一整天）。图上画几道刻痕、文案说几天，必须是同一个数。 */
      const days = Math.max(2, previewStops.length);
      text += `（今日不够，约需 ${days} 天）`;
    }
  } else {
    setPreview(null, null);
  }
  if (t.objectId) {
    const obj = state.map.objects[t.objectId];
    if (obj) text += ` · ${objectLabel(obj)}`;
  }
  hint(text);
}

function objectLabel(obj: MapObject): string {
  switch (obj.kind) {
    case 'wanderingMonster': {
      const p = obj.payload as { army: Army; guard?: GuardReward };
      const g = p.guard ? `（看守 ${describeGuard(p.guard)}）` : '';
      return `野怪：${describeArmy(p.army)}${g}`;
    }
    case 'treasureChest':
      return '宝箱';
    case 'resourcePile':
      return `资源堆 ×${(obj.payload as { amount: number }).amount}`;
    case 'fountain':
      return '清泉';
    case 'artifact':
      return '地面宝物';
    case 'mine': {
      const p = obj.payload as MinePayload;
      return `${RESOURCE_TEXT[p.resource] ?? p.resource}矿 · 每日 +${p.perDay}`;
    }
    case 'town':
      return state.towns[(obj.payload as { townId: string }).townId]?.name ?? '城镇';
    default:
      return '障碍';
  }
}

const RESOURCE_TEXT: Record<string, string> = {
  gold: '金币', wood: '木材', ore: '矿石',
};

function showTileInfo(sx: number, sy: number): void {
  const g = camera.pick(sx, sy);
  if (!inBounds(state.map, g.x, g.y) || !isRevealed(state, viewerOf(state), g.x, g.y)) return;
  const t = state.map.tiles[idx(state.map, g.x, g.y)];
  const terrain = TERRAIN[t.terrain];
  const obj = t.objectId ? state.map.objects[t.objectId] : null;
  const title = obj ? objectLabel(obj) : terrain.name;
  const desc = obj
    ? `${describeObject(obj)}\n${terrain.name} · 移动消耗 ${terrain.moveCost}`
    : `移动消耗 ${terrain.moveCost}`;
  showInfoPopup(stage, sx, sy, title, desc);
}

function describeObject(obj: MapObject): string {
  switch (obj.kind) {
    case 'wanderingMonster': {
      const p = obj.payload as { army: Army; guard?: GuardReward };
      const g = p.guard ? `\n看守着：${describeGuard(p.guard)}，只有取胜才能拿到` : '';
      return `守卫：${describeArmy(p.army)}${g}`;
    }
    case 'treasureChest':
      return '一只落满灰尘的箱子，也许装着金币。';
    case 'resourcePile':
      return '散落的资源，英雄经过时会自动拾取。';
    case 'fountain':
      return '清冽的泉水，饮下可恢复一半移动力。';
    case 'artifact':
      return '遗落的宝物，拾取后可装备。';
    case 'mine': {
      const p = obj.payload as MinePayload;
      return `一座${RESOURCE_TEXT[p.resource] ?? p.resource}矿，每日产出 +${p.perDay}。`;
    }
    case 'town':
      return '一处据点，占领后可以建设与征兵。';
    default:
      return '无法通行的地形。';
  }
}

window.addEventListener('keydown', (e) => {
  if (isBattleOpen()) return;
  if (e.key === 'Escape') {
    if (pickSpell) {
      pickSpell = null;
      hint('已取消施法');
      return;
    }
    closeModal();
    hideInfoPopup();
  } else if (e.key === 'Enter' && !isModalOpen()) {
    doEndDay();
  } else if ((e.key === 'm' || e.key === 'M') && !isModalOpen()) {
    continueJourney();
  } else if (e.key === ' ' && selected) {
    e.preventDefault();
    const h = state.heroes[selected];
    if (h) camera.centerOn(h.pos.x, h.pos.y);
  }
});

window.addEventListener('resize', () => {
  renderer.resize();
  camera.clamp();
});

// M-08：朝向切换（横/竖屏）时可视尺寸在随后的 1~2 帧才稳定。
// iOS Safari 有时不发 resize、或发得太早，故延迟一拍再重建分辨率并夹紧镜头。
window.addEventListener('orientationchange', () => {
  window.setTimeout(() => {
    renderer.resize();
    camera.clamp();
  }, 120);
});

/* ---------------- loop ---------------- */

let last = performance.now();

/**
 * rAF 句柄必须**每帧重绑**（见 frame() 末尾）。`frame()` 自己递归排下一帧，
 * 如果只在启动时存一次句柄，`cancelAnimationFrame(raf)` 拿到的永远是已经触发过的
 * 旧句柄 → 取消不掉 → 切到后台后循环继续空转，同时白白耗电。
 */
let raf = 0;

/** 组装当前视图模型（帧循环与启动探测共用，保证探测测的是真实渲染路径）。 */
function buildViewModel(): ViewModel {
  return {
    state,
    player: 'p1',
    sight: HERO_SIGHT,
    reachable: fieldTurn ? fieldTurn.cost : null,
    // 不限移动力的代价场：`shade` 默认靠它区分"走不到"与"压根不能走"（见 MapRenderer 注释）
    walkable: fieldFull ? fieldFull.cost : null,
    path: previewPath,
    pathFrom: previewFrom,
    pathDay: previewDay,
    pathDays: previewStops,
    /* 一整天能走多远（`turn.ts` 换日就重置到这个值）—— 虚线流动的速度按它缩放。 */
    pathMp: previewPath && selected && state.heroes[selected] ? maxMovePoints(state.heroes[selected], state) : undefined,
    hover,
    dest: pendingDest && state.heroes[pendingDest.heroId] ? pendingDest.dest : null,
    selectedHeroId: selected,
    heroRender,
  };
}

/** 画一帧冒险地图。 */
function drawScene(): void {
  renderer.draw(buildViewModel());
}

function frame(now: number): void {
  const dt = Math.min(60, now - last);
  last = now;
  camera.update(dt);
  // 边缘滚屏：仅真实鼠标贴边、且没在拖拽/捏合/弹窗/战斗时生效（M-01）。
  // 触屏无"悬停"，抬手后 mouseIn 可能残留，靠 lastPointerType 直接 gate 掉。
  if (
    shouldEdgeScroll({
      lastPointerType,
      hoverActive: mouseIn,
      activePointers: pointers.size,
      modalOpen: isModalOpen(),
      battleOpen: isBattleOpen(),
    })
  ) {
    camera.edgeScroll(mouseX, mouseY, dt);
  }
  if (anim) tickAnim(dt);
  updateHeroRender();
  drawScene();
  raf = requestAnimationFrame(frame);
}

/* ---------------- boot ---------------- */

let centered = false;

function currentHero() {
  return selected ? state.heroes[selected] ?? null : null;
}

renderer.resize();
const bootHero = currentHero();
if (bootHero) camera.centerOn(bootHero.pos.x, bootHero.pos.y);

// 布局尺寸变化（首帧、窗口缩放、面板收起）都要重建画布分辨率
const ro = new ResizeObserver(() => {
  renderer.resize();
  camera.clamp();
  const h = currentHero();
  if (!centered && h) {
    camera.centerOn(h.pos.x, h.pos.y);
    centered = true;
  }
});
ro.observe(stage);

// 画质档位变化（探测完成 / 用户手动切档）后 DPR 上限可能变 → 重建画布分辨率
onTierChange(() => {
  renderer.resize();
  camera.clamp();
});

// 启动期微基准（§4.3）：默认档已是 mid，先让首帧画出来，再异步探测、探测完切档。
// sync 用 getImageData 强制 GPU 同步，否则测到的是"提交时间"而非"渲染时间"；
// 无头环境不支持时 probeTier 内部 fail-safe 退回 mid，绝不抛。
const probeSync = (): void => {
  canvas.getContext('2d')?.getImageData(0, 0, 1, 1);
};
void initQuality({ draw: drawScene, sync: probeSync, hoverCapable: hoverCapable() }).catch(() => undefined);

/* ---------------- 画质设置（Q-10） ---------------- */

/**
 * 重跑一次自动探测：清缓存档（homm.tier）+ 把模式拉回 auto，再走 initQuality。
 * 说明：initQuality 只在 mode==='auto' 时才真的探测，所以"重新检测"必须顺带切回 auto，
 * 否则用户在手动档下点它只会"清了缓存但不重测"。
 */
async function reProbe(): Promise<void> {
  setMode('auto');
  clearCachedTier();
  hint('正在检测设备性能…');
  const tier = await initQuality({ draw: drawScene, sync: probeSync, hoverCapable: hoverCapable() });
  hint(`画质已设为「${TIER_LABEL[tier]}」`);
}

/** 画质设置已并入「设置」面板（IA §7 二级；原顶栏「画质」按钮已删除，Q7）。 */

recomputeField();
refresh();
renderLog();

raf = requestAnimationFrame(frame);

/**
 * 接后台生命周期（M-05）：切后台立刻停 rAF + 立即存档，回前台先重置时间戳再续帧。
 * 若不重置 `last`，恢复后的第一帧 `now - last` 等于整个后台时长，虽有 60ms 上限兜着，
 * 但会白白推进一帧逻辑。停 rAF 用 cancelAnimationFrame 而不是让 loop 空转。
 */
installLifecycle({
  onPause: () => {
    cancelAnimationFrame(raf);
    saveGame(state);
  },
  onResume: () => {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  },
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

/* ---------------- TP-3 场景音乐巡更 ---------------- */

/**
 * 城镇对话框的「关窗 ⇒ 回 map 曲」。
 *
 * 为什么用轮询而不是回调：TownDialog 走 `showModal`（Dialogs.ts），而模态系统
 * **没有 onClose 回调**；关闭可能发生在对话框自身的「返回」钮或任何外部
 * `closeModal()`。给共享的 Dialogs 加回调机制波及全部弹窗，不值当 —— 这里用
 * 250ms 轻轮询（一次 querySelector）补上这一跳。
 *
 * **开窗**不靠轮询：TownDialog 自己开馆时立即播 town（零滞后）。
 * 轮询只负责「关」这一刻，而 map 曲是 700ms 交叉淡入 ⇒ 250ms 侦测滞后听不出来。
 * `.town` 类是 TownDialog 独有的根类（全仓仅它一处创建），做开闭标记可靠。
 */
let townDialogOpen = false;
setInterval(() => {
  const now = document.querySelector('#modal-root .town') !== null;
  if (now === townDialogOpen) return;
  townDialogOpen = now;
  if (!now) playMusic('map'); // 关窗 ⇒ 回地图曲（与 battle 关闭同一处理）
}, 250);

/* ---------------- 启动 ---------------- */

/**
 * 调试：`?devstart=1` 强制打开开始页，**跳过首次教学的自动进入**。
 *
 * 为什么必须有它：门控跑在**每次全新的 Chrome profile** 里（`_chrome.mjs` 用
 * `mkdtempSync` 临时目录）⇒ localStorage 永远是空的 ⇒ `!hasSave() && !tutorialDone()`
 * 恒真 ⇒ 一进 `/` 就直接开教学局，**开始页永远不出现**，所有断言开始页的门会成片假红。
 * 这个参数把"自动进教学"这条生产路径和"我要看开始页"这条测试路径分开，
 * 且它**不影响生产**（无人传即走原逻辑）。
 */
const devStart = bootParams.has('devstart');

/**
 * 调试：`?devscenario=<id>` 直接开指定场景（跳过开始页）。
 * 与 `?devquick` 同一套惯例：无人传即不影响生产路径。
 *
 * 2026-10-12 起它的主要用途是**从 UI 下线的那几个场景**：开局页现在只有教学模式
 * （首次自动进入）和破碎罗盘，`duel` 这类"还在但不给玩家选"的图靠它进门做回归。
 */
const devScenario = bootParams.get('devscenario');
if (devScenario) {
  startScenario(devScenario);
}

/**
 * 调试：`?devshowcase=1` 直接开展示图 —— 与开始页「开始」那颗按钮**同一条路径**
 * （同样走 `scenarioGenOptions`，同样跳过设置页），只是起点换成查询参数，好让
 * 截图 / 回归脚本不必先点一下页才能进图。
 */
if (bootParams.has('devshowcase')) {
  startScenario(SHOWCASE_ID);
}

// 调试：?devquick=2 直接以 2 个电脑对手开局并跳过设置页（截图/回归用）
// `devshowcase=1` / `devscenario=` 已在上文直接开场景；三者都**跳过**开始页。
// ★ 随机地图整条线已从 UI 下线（用户 2026-10-12 裁定），本参数是它**唯一**的入口。
if (bootParams.has('devquick')) {
  const n = Number.parseInt(bootParams.get('devquick') ?? '1', 10);
  const sz = bootParams.get('devsize');
  const lyt = bootParams.get('devlayout');
  startNewGame({
    ...DEFAULT_CONFIG,
    ...(loadConfig() ?? {}),
    ...(sz && sz in MAP_SIZES ? { size: sz as GameConfig['size'] } : {}),
    ...(lyt && lyt in LAYOUTS ? { layout: lyt as GameConfig['layout'] } : {}),
    opponents: Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : 1,
    seed: Number.parseInt(bootParams.get('devseed') ?? '', 10) || loadConfig()?.seed || Math.floor(Math.random() * 1e9),
  });
} else if (!bootParams.has('devshowcase') && !devScenario) {
  /* ★ 首次启动**直接进教学模式**（用户 2026-10-12 裁定：「第一次进入直接进入教学场景，
   *   除非选择跳过，后面不用再有教学场选项」）。判据 = 没有存档 且 没跳过过教学。
   *   有存档 / 已教过 ⇒ 回开始页（那里现在只剩破碎罗盘 + 难度）。
   *   `?devstart=1` 跳过这条自动进入（门控专用，见上）。 */
  if (!devStart && !hasSave() && !tutorialDone()) {
    startScenario('tutorial');
  } else {
    openStart();
  }
}

// 调试：?devreveal=1 直接掀开全图（用于检查敌方英雄/城镇的配色与可见性）
if (bootParams.has('devreveal') && state.players.p1) {
  state.players.p1.revealed = new Array(state.map.width * state.map.height).fill(1);
}
// 调试：?devzoom=0.6 缩到整图，一眼看完四方势力（缩放后重新对到当前英雄，不然镜头还停在旧缩放的夹紧位置）
const devZoom = Number.parseFloat(bootParams.get('devzoom') ?? '');
if (Number.isFinite(devZoom) && devZoom > 0) {
  camera.setZoom(devZoom);
  const h = currentHero();
  if (h) camera.centerOn(h.pos.x, h.pos.y);
}
// 调试：?devlight=0.68 锁定光照相位（0=清晨 0.22=正午 0.5=黄昏 0.68=深夜，截图/调色用）
const devLight = Number.parseFloat(bootParams.get('devlight') ?? '');
if (Number.isFinite(devLight)) {
  setLightPhaseOverride(devLight);
}
// 调试：?devclear=1 清掉野怪/宝箱/矿场等可交互物件（端到端移动审计用，避免长途行程被交互打断；只留城镇与障碍）
if (bootParams.has('devclear')) {
  const CLEAR_KINDS = new Set([
    'wanderingMonster', 'treasureChest', 'resourcePile', 'artifact', 'fountain', 'vault', 'mine',
  ]);
  for (const [id, o] of Object.entries(state.map.objects)) {
    if (CLEAR_KINDS.has(o.kind)) delete state.map.objects[id];
  }
  for (const t of state.map.tiles) {
    if (t.objectId && !state.map.objects[t.objectId]) t.objectId = null;
  }
}
// 调试：?devprobe=1 暴露行程状态（tools/destaudit.mjs 端到端审计用）
if (bootParams.has('devprobe')) {
  const w = window as unknown as { __journey: () => unknown; __journeyGo: (tx: number, ty: number) => void; __mapTint: (on: boolean) => void; __mapShadow: (on: boolean) => void; __mapShadowProbe: () => unknown; __mapShadowOffset: (dy: number) => void; __mapFringe: (tone: string) => void; __mapReachProbe: () => unknown; __mapPathProbe: () => unknown; __mapPreviewTo: (tx: number, ty: number) => unknown; __mapPreviewDay: () => unknown };
  w.__journey = () => ({
    pendingDest,
    walking: !!anim,
    selected,
    heroPos: selected ? state.heroes[selected]?.pos ?? null : null,
    movePoints: selected ? state.heroes[selected]?.movePoints ?? null : null,
    maxMovePoints: selected && state.heroes[selected] ? maxMovePoints(state.heroes[selected], state) : null,
    cam: { x: camera.x, y: camera.y, zoom: camera.zoom },
    hint: hintEl.textContent,
  });
  // 直接对指定格子发移动指令：审计脚本用它做确定性的长途行程
  // （合成鼠标点击依赖相机换算，无头环境下屏幕边缘换算不可靠）
  w.__journeyGo = (tx, ty) => tryMove({ x: tx, y: ty });
  // 可达染色层开关（F-3.6④ / IA #18）：与 `?devtint=0` 同一条语义，但**会话内可切** ——
  // MapRenderer 注释设计的「同构建 / 同会话 / 同帧」因果 A/B 就靠它（探针 tp6-encounter D 段：
  // 同会话连读两帧像素，只差这一个布尔量；`?devtint=0` 只能在导航前定，跨会话比会掺入动画相位）。
  w.__mapTint = (on: boolean) => { renderer.tintEnabled = on; };
  // 接地影开关：同一套「同构建 / 同会话 / 同帧」因果 A/B（见 MapRenderer.shadowOn 注释）。
  w.__mapShadow = (on: boolean) => { renderer.shadowOn = on; };
  // 接地影的**同帧**取色（见 MapRenderer.probeShadow 注释）：只读当前缓冲，不改绘制。
  w.__mapShadowProbe = () => renderer.probeShadow();
  // 负向对照专用：把影推离脚下，验证判据量的是"脚边的影"而不是"任意变暗的像素"。
  w.__mapShadowOffset = (dy: number) => { renderer.shadowOffsetY = dy; };
  // 过渡带取色口径（同会话切换）：切成 'top' 就是改前行为，改完调 invalidate() 重烘。
  w.__mapFringe = (tone: string) => { renderer.setFringeTone(tone === 'top' ? 'top' : 'blend'); };
  // 可达格心点的同帧取色（见 MapRenderer.probeReach 注释）：只读缓冲，不改绘制。
  w.__mapReachProbe = () => renderer.probeReach();
  // 预览路径地标的同帧取色 + 「路径格上还剩几枚可达点」（`probe:pathdots` 用）。
  w.__mapPathProbe = () => renderer.probePath();
  /* 展示图三条目标的**当前判定输入**（2026-10-27：主理人报"全做完了没反应"，先得看清
     是"没判"还是"判错"）。只读，不改状态；`human` 用来抓"玩家不是 p1"这类假设失效。 */
  /* 测试专用：把 n 座无主矿判给 p1（不改别的状态）—— `probe:objectives` 要一个
     确定性的"占 2 座矿"，而靠走位凑两座矿不可复现。 */
  (w as unknown as { __devObjMines: (n?: number) => number }).__devObjMines = (n = 2) => {
    let k = 0;
    for (const o of Object.values(state.map.objects)) {
      const pay = o.payload as { owner?: string } | null;
      if (o.kind === 'mine' && pay && pay.owner !== 'p1' && k < n) {
        pay.owner = 'p1';
        k += 1;
      }
    }
    refresh();
    return k;
  };
  /* 测试专用：摘掉一名敌方英雄（= 击败一名敌将的最短路径）。 */
  (w as unknown as { __devObjFoe: () => string | null }).__devObjFoe = () => {
    const id = state.heroOrder.find((h) => state.heroes[h] && state.heroes[h].owner !== 'p1');
    if (!id) return null;
    removeHero(state, id);
    refresh();
    return id;
  };
  (w as unknown as { __objectives: () => unknown }).__objectives = () => {
    const w2 = state.map.width;
    const h2 = state.map.height;
    return {
      on: state.config.scenario === SHOWCASE_ID,
      done: { ...objDone },
      revealed: revealedCells(state),
      need: Math.ceil(0.2 * w2 * h2),
      total: w2 * h2,
      mines: ownedMines(state, 'p1').length,
      human: Object.keys(state.players).filter((id) => state.players[id]?.isHuman),
      foe: foeHeroCount(state),
      peak: objFoePeak,
      heroOwners: state.heroOrder.map((id) => state.heroes[id]?.owner),
      rows: [...document.querySelectorAll('#objectives .obj-row')].map((r) => ({
        t: (r.textContent || '').trim(),
        done: r.getAttribute('data-obj-done'),
      })),
    };
  };
  /* 摆一条**真实**的预览路径（走 `updateHover` 同一条 `buildPath` + `fieldFull`）。
   * 为什么不用合成 `pointermove`：探针要的是"这条路线"，而指针坐标要先过 `camera.pick`，
   * 那是另一套口径（镜头/DPR/缩放都在中间）—— 用格子坐标直接喂，量的就是玩家真会看到的那条。 */
  w.__mapPreviewTo = (tx: number, ty: number) => {
    const hero = selected ? state.heroes[selected] : null;
    if (!hero || !fieldFull) return { ok: false, reason: '没有选中英雄或代价场未算' };
    const g = { x: tx, y: ty };
    if (!inBounds(state.map, tx, ty)) return { ok: false, reason: '越界' };
    hover = g;
    setPreview(hero, g);
    /* 把**路径本身**也回传：探针要拿它跟渲染器自报的"每步方向"对账（两处独立算，才有意义）。
       另附 `day` / `mp` / `costs`：那三条是 `probe:pathday` 用来验"分界确实落在
       最后一格可负担的格子上"的**独立**数据（累加口径照抄 `dayReachSteps`，但用的是代价场）。 */
    const costs = previewPath ? previewPath.map((q) => fieldFull!.cost[idx(state.map, q.x, q.y)]) : [];
    return {
      ok: !!previewPath,
      n: previewPath ? previewPath.length : 0,
      path: previewPath ? previewPath.map((q) => ({ x: q.x, y: q.y })) : [],
      day: previewDay,
      stops: previewStops,
      mp: hero.movePoints,
      maxMp: maxMovePoints(hero, state),
      costs,
      from: { x: hero.pos.x, y: hero.pos.y },
    };
  };
  /**
   * 摆一条**今天走不完**的预览路径（`probe:pathday` 用）。
   *
   * 为什么需要一个专门的钩子：跨天分段只在"目标超出今日移动力"时出现，
   * 而 `__mapPreviewTo` 的常规用法（可达点边缘）恰好**永远**在今日范围内 ——
   * 用它测分段，测出来的永远是"没有分段"，一条永远绿的判据。
   *
   * 选点规则：在代价场里取"至少 1.6 倍今日移动力、且不超过 2.6 倍"的格子里最远的一枚，
   * 保证跨天一次（而不是跨三天 —— 那会让"今天/明天"两段各自都可能看不到）。
   *
   * `dir`：偏好方向。`horiz`（默认）让路径主要横着走，好让整条路落在 844 宽的屏幕里；
   * `vert` 反过来 —— 用来测**边缘指示符**：屏幕只有 390 高（半高 195px ≈ 5 格），
   * 竖直走十几步必然出画。真实对局里"交界在屏外"是常态，可测的那一档要能稳定复现它。
   *
   * `mpOverride`：临时把移动力设小（探针传 300 ⇒ 3 格出界）——
   * 满移动力 1800 对应的跨天目标在十几格之外，**整段明天都在屏幕外**，探针取不到像素。
   * 只在 `setPreview` 那一下生效，算完立刻还原（不动存档、不动别的状态）。
   */
  w.__mapPreviewDay = (
    mpOverride?: number,
    dir?: 'any' | 'vert' | 'horiz',
    minCost?: number,
  ) => {
    const hero = selected ? state.heroes[selected] : null;
    if (!hero || !fieldFull) return { ok: false, reason: '没有选中英雄或代价场未算' };
    const useOverride = typeof mpOverride === 'number' && mpOverride > 0;
    const mp = useOverride ? (mpOverride as number) : hero.movePoints;
    /* 下界 1.15 而不是 1.6：满移动力（1800）时 1.6 倍 ≈ 29 格，
       整张 48×48 图上未必存在那么远的可走格 ⇒ 钩子直接返回 ok:false，
       "测边缘指示"的那一臂就永远没有数据。1.15 只要求"确实跨天"，剩下的交给下面的兜底。 */
    /* `minCost`：指定"总代价至少这么大"，用来摆**跨三天**的路径（§21 的多刻痕判据）。
       窗口取 [minCost, minCost×1.12] 这么窄，是为了让结果稳定落在"第 2 天走完、
       第 3 天没走完"的区间里 —— 太宽会滑到四天，判据就变成数刻痕个数而不是验证顺序。 */
    const pinned = typeof minCost === 'number' && minCost > 0;
    const lo = pinned ? (minCost as number) : mp * 1.15;
    /* 上界 1.4 倍：窗口太窄（1.12）时"代价刚过 2100"的格子里可能一个横向的都没有，
       结果每次都挑到同一枚靠北的格子 ⇒ 第二道刻痕跑到屏幕上方之外，拍不到。
       1.4 倍仍然远低于第三天的预算（2000 + 1800），所以天数还是 3。 */
    const hi = pinned
      ? (minCost as number) * 1.4
      : Math.min(mp * 2.6, maxMovePoints(hero, state) * 3);
    let best: GridPos | null = null;
    let bestScore = -1;
    const m = state.map;
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const c = fieldFull.cost[idx(m, x, y)];
        if (!Number.isFinite(c) || c < lo || c > hi) continue;
        if (!isRevealed(state, viewerOf(state), x, y)) continue;
        /* 横向优先：屏幕是 844×390，**竖直方向只有 195px 半高** ——
           5 步竖直路径就会把"明天"整段顶出画布，探针取不到像素（实测出界 3/4）。
           所以先按"|dx| ≥ |dy|"筛，再在同类里取最远。 */
        const horiz = Math.abs(x - hero.pos.x) >= Math.abs(y - hero.pos.y);
        const prefer = dir === 'vert' ? !horiz : dir === 'horiz' ? horiz : true;
        const score = c + (prefer ? 10000 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    if (!best) {
      /* 兜底：窗口内没有（远图边缘 / 小地图），就取"走得动、但今天走不完"的最远一格。
         宁可跨界少一点，也不要返回空 —— 空的钩子只会让判据变成"没有数据"，看起来像通过。 */
      for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          const c = fieldFull.cost[idx(m, x, y)];
          if (!Number.isFinite(c) || c <= mp) continue;
          if (!isRevealed(state, viewerOf(state), x, y)) continue;
          const horiz = Math.abs(x - hero.pos.x) >= Math.abs(y - hero.pos.y);
          const prefer = dir === 'vert' ? !horiz : dir === 'horiz' ? horiz : true;
          const score = c + (prefer ? 10000 : 0);
          if (score > bestScore) {
            bestScore = score;
            best = { x, y };
          }
        }
      }
    }
    if (!best) return { ok: false, reason: '这一回合没有落在窗口内的目标格' };
    hover = best;
    const savedMp = hero.movePoints;
    if (useOverride) hero.movePoints = mp;
    setPreview(hero, best);
    hero.movePoints = savedMp;
    const costs = previewPath ? previewPath.map((q) => fieldFull!.cost[idx(state.map, q.x, q.y)]) : [];
    return {
      ok: !!previewPath,
      n: previewPath ? previewPath.length : 0,
      path: previewPath ? previewPath.map((q) => ({ x: q.x, y: q.y })) : [],
      day: previewDay,
      stops: previewStops,
      mp,
      maxMp: maxMovePoints(hero, state),
      costs,
      target: best,
      from: { x: hero.pos.x, y: hero.pos.y },
    };
  };
}

// 调试：?devdays=20 直接空过 N 天，用来观察电脑对手的推进与终局判定
const devDays = Number.parseInt(bootParams.get('devdays') ?? '', 10);
if (Number.isFinite(devDays) && devDays > 0) {
  for (let i = 0; i < devDays && state.status === 'playing'; i++) endDay(state);
  selected = state.heroOrder.find((id) => state.heroes[id]?.owner === 'p1') ?? null;
  recomputeField();
  refresh();
  renderLog();
  if (state.status !== 'playing') showOutcome();
}

// 调试入口：?devbattle=1 直接开一场固定阵容的战斗，用于截图与验证，不影响正常流程
// `?devbattle=t5`：阵容换成四族 T5（各侧两只），用于人工验收「T5 在战斗里真的画出来了」。
//   TP-1 背景：四族 T5 曾长期在图集里没有 `cu_*` 帧 ⇒ 战斗渲染静默跳过 ⇒ 只剩队伍色底盘圈，
//   而**任何断言都不响**（断言只查"已注册的帧画得对不对"）。这条入口是那把人工验收的输入。
//   ⚠️ `=1`（缺省）的阵容**逐字不变**，否则既有截图基线的可比性就没了。
if (bootParams.has('devbattle') && selected && state.heroes[selected]) {
  // D-2（2026-10-21 真机走查）：开局页是 `position:fixed; z-index:900`，`.battle` 只有 150
  // ⇒ 调试战斗开在底下，截出来是开局页（04-devbattle.png），而"战斗已开"只存在于 DOM 里。
  // 这条入口本来就是**整屏接管**（用于截图/验收），所以把开局页收起来；
  // 用 `display` 而不是 `remove()`：开局页的 handle 还持有这个节点。
  const startScreenEl = document.getElementById('start-screen');
  if (startScreenEl) startScreenEl.style.display = 'none';
  const t5 = bootParams.get('devbattle') === 't5';
  /* `?devbattle=full`：满编 7 队（每侧 7 支）。
     P1 遗留的"6~7 队侧列要滚"需要一个**可复现的**输入才能验证 —— 手动打十几回合
     凑出满编不现实，而这条判据（轮到的卡自己滚进视野）只在溢出时才有意义。 */
  const full = bootParams.get('devbattle') === 'full';
  openBattleScreen(stage, {
    state,
    heroId: selected,
    title: t5 ? '调试战斗 · T5 顶点兵' : full ? '调试战斗 · 满编 7 队' : '调试战斗',
    attacker: {
      army: t5
        ? [
            { unitTypeId: 'p1_overangel', count: 3 },
            { unitTypeId: 'p3_unicorn', count: 4 },
          ]
        : full
          ? [
              { unitTypeId: 'p1_lampbearer', count: 40 },
              { unitTypeId: 'p1_hornxbow', count: 28 },
              { unitTypeId: 'p1_oathpike', count: 24 },
              { unitTypeId: 'p1_templar', count: 12 },
              { unitTypeId: 'p1_overangel', count: 3 },
              { unitTypeId: 'p3_dwarf', count: 30 },
              { unitTypeId: 'p3_unicorn', count: 6 },
            ]
          : [
              { unitTypeId: 'archer', count: 20 },
              { unitTypeId: 'pikeman', count: 12 },
              { unitTypeId: 'knight', count: 6 },
            ],
      attack: 3,
      defense: 4,
      // 调试用：给一套完整法术，方便截图验证施法界面
      caster: {
        spells: ['magicArrow', 'bless', 'haste', 'shield', 'lightningBolt', 'slow', 'stoneSkin', 'bloodlust', 'iceBolt', 'fireball', 'resurrect', 'curse'],
        spellPower: 3,
        mana: 30,
      },
    },
    defender: {
      army: t5
        ? [
            { unitTypeId: 'p2_lavatroll', count: 2 },
            { unitTypeId: 'p4_colossus', count: 3 },
          ]
        : full
          ? [
              { unitTypeId: 'p2_scavenger', count: 45 },
              { unitTypeId: 'p2_axethrower', count: 26 },
              { unitTypeId: 'p2_wolfrider', count: 18 },
              { unitTypeId: 'p2_firebrand', count: 9 },
              { unitTypeId: 'p2_lavatroll', count: 4 },
              { unitTypeId: 'p4_stoneimp', count: 50 },
              { unitTypeId: 'p4_colossus', count: 5 },
            ]
          : [
              { unitTypeId: 'wolf', count: 26 },
              { unitTypeId: 'boar', count: 13 },
              { unitTypeId: 'ogre', count: 11 },
            ],
      attack: 0,
      defense: 0,
    },
    seed: 20260913,
    autoStart: bootParams.has('devauto'),
    instant: bootParams.has('devinstant'),
    debugProbe: bootParams.has('devprobe'),
    onDone: () => hint('调试战斗结束'),
  });
}

// 调试：?devsetup=1 给玩家发一笔资源并在首城补好前置建筑，
// 用来复现"金很多但缺稀有资源"的场景（截图/人工验证建造面板文案用）。
// 大法师塔(guild3) 造价 = 4500 金 + 4 水晶，所以这里水晶故意留 0。
if (bootParams.has('devsetup') && state.players.p1) {
  const p1 = state.players.p1;
  p1.resources = {
    ...p1.resources,
    gold: 12000, wood: 50, ore: 50,
    gem: 12, crystal: 0, sulfur: 8, mercury: 8,
  };
  const home = Object.values(state.towns).find((t) => t.owner === 'p1');
  if (home) {
    home.buildings = [...new Set([...home.buildings, 'tavern', 'guild1', 'guild2'])];
    // 前置建筑补好了，但"今天建过"要清掉，否则卡片只会说"明日再来"
    home.builtDay = -1;
  }
}

// 调试：`?devarmy=t5` 把当前英雄的部队换成四族 T5 各 1（截图 / 人工验收用）。
// 用途：T5 在地图侧的唯一表面是**队伍徽标**（`MapRenderer.drawTeamBadge`，帧名 `u_<cid>_map`），
// 而它默认关（`?devbadge=1` 才开）⇒ 没有这支部队就永远截不到地图侧的 T5。
// ⚠️ 只动"当前选中英雄"的 army，不碰生产路径；不传即零影响。
if (bootParams.get('devarmy') === 't5' && selected && state.heroes[selected]) {
  state.heroes[selected].army = [
    { unitTypeId: 'p1_overangel', count: 1 },
    { unitTypeId: 'p2_lavatroll', count: 1 },
    { unitTypeId: 'p3_unicorn', count: 1 },
    { unitTypeId: 'p4_colossus', count: 1 },
  ];
}

/* 调试：`?devpoor=1` 把玩家资源压到"买不起"，专门给 `probe:uip0` 的 `towncost`
   量**红色缺项**那一态（否则造价行永远全绿，红色分支没人走到过）。
   放在 `devtown` 之前：面板一打开就按这份资源算。 */
if (bootParams.has('devpoor')) {
  const p = state.players[viewerOf(state)];
  if (p) p.resources = { ...p.resources, gold: 120, wood: 2, ore: 1, gem: 0, crystal: 0, sulfur: 0, mercury: 0 };
}

// 调试：?devtown=1 直接打开我方首座城镇面板（需配合 ?devquick 才有城镇）
if (bootParams.has('devtown')) {
  const home = Object.values(state.towns).find((t) => t.owner === 'p1');
  if (home) openTownById(home.id);
}
