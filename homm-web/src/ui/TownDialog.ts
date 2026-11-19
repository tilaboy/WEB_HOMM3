import type { GameState, Hero, ResourceBag, ResourceKind } from '../core/types.js';
import { BUILDINGS, HERO_HIRE_COST } from '../core/data/buildings.js';
import { WAR_MACHINES, WAR_MACHINE_IDS } from '../core/data/warmachines.js';
import { getUnit, upgradedUnitIdOf } from '../core/data/units.js';
import { viewerOf } from '../core/data/factions.js';

/**
 * 造价行是否用「图标 + 数字」（默认开）。`?devtowncost=0` 回退成旧的纯文字
 * （`4500 金 · 4 水晶`+`还差：…`）—— **只**给 `probe:uip0` 的 `towncost` 当负向对照：
 * 没有它，那条"造价行不许出现汉字"的判据只能证明"能读到东西"，证明不了它测的是图标化。
 */
const COST_CHIPS = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devtowncost') !== '0';
  } catch {
    return true;
  }
})();

/**
 * 城内一览开关（默认开；`?devtownview=0` 是闸门用的负向对照臂 ——
 * 没有它，"能看到城景"这条判据证明不了自己测的是新视图而不是旧建筑卡）。
 */
const TOWN_VIEW_ENABLED = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devtownview') !== '0';
  } catch {
    return true;
  }
})();

/**
 * 存量转换入口是否显示（默认开；`?devnoconvert=1` 是闸门负向对照臂 ——
 * 没有它，"驻军页有转换按钮"证明不了自己测的是新入口）。
 */
const CONVERT_ENABLED = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devnoconvert') !== '1';
  } catch {
    return true;
  }
})();

/**
 * 英雄招募入口所在页（默认「招募」）。`?devhiretab=market` 是闸门负向对照臂 ——
 * 把入口退回 2026-11-19 之前的「市场·工坊」页；没有它，"招募英雄在招募页"
 * 这条判据证明不了自己测的是新位置，而不是"面板上恰好有这段字"。
 */
const HIRE_IN_RECRUIT = ((): boolean => {
  try {
    return new URLSearchParams(location.search).get('devhiretab') !== 'market';
  } catch {
    return true;
  }
})();

/** 造价/库存里图标的固定顺序（金→木→矿→宝石→水晶→硫磺→水银）。 */
const RES_ORDER: ResourceKind[] = ['gold', 'wood', 'ore', 'gem', 'crystal', 'sulfur', 'mercury'];
/** 全名只进 `title`/`aria-label`：卡面上**不写汉字**，只留图标 + 数字。 */
const RES_FULL: Record<ResourceKind, string> = {
  gold: '金币', wood: '木材', ore: '矿石',
  gem: '宝石', crystal: '水晶', sulfur: '硫磺', mercury: '水银',
};

/** 市场按钮上的短名（"木材"太长，挤不进小按钮）。 */
const RESOURCE_LABEL: Partial<Record<ResourceKind, string>> = {
  gold: '金', wood: '木', ore: '矿',
  gem: '宝石', crystal: '水晶', sulfur: '硫磺', mercury: '水银',
};
import {
  MARKET_RATES,
  build,
  buildStatus,
  canConvertStack,
  canHireHero,
  convertStack,
  costText,
  garrisonToHero,
  heroToGarrison,
  hireHero,
  marketBuy,
  marketSell,
  assembleWarMachine,
  canAssemble,
  heroWarMachines,
  recruitRows,
  buildingDesc,
  recruitToGarrison,
  recruitToHero,
  townDailyIncome,
  townDefenseBonus,
  townGrowthMultiplier,
} from '../core/game/town.js';
import type { BuildStatus } from '../core/game/town.js';
import { showModal } from './Dialogs.js';
import { installResIcons, resIcon, type ResId } from './resicons.js';
import { PixBuf } from '../render/pixel.js';
import { getAtlas, buildCastleFrame, type SpriteOwner } from '../render/atlas.js';
import { guildArtName, guildArtTierOf } from '../render/guildArt.js';
import { buildingArtName } from '../render/buildingArt.js';
import {
  CASTLE_PLOT,
  SCENE_BUILDING_SIZE,
  TOWN_BUILDING_IDS,
  TOWN_PLOTS,
  buildSceneBuilding,
  buildTownBase,
  sceneBuildingFrameName,
  type TownPlot,
} from '../render/townSceneArt.js';
import { wallLevelOf } from '../core/combat/siege.js';
import { sfx } from './sfx.js';
// TP-3：城镇场景曲（audio-direction.md §10.1 接线④）。开窗立即播；
// 关窗回 map 由 main.ts 的场景巡更补（showModal 没有 onClose，见那边注释）。
import { play as playMusic } from '../audio/music.js';

export interface TownDialogOptions {
  state: GameState;
  townId: string;
  /** 站在城里的英雄（可能为 null） */
  heroId: string | null;
  /** 任意状态变化后刷新外部 UI */
  onChange: () => void;
  /** 招募到新英雄时通知外部（用于选中 + 开视野） */
  onHire: (heroId: string) => void;
}

/* ---------------- 城内一览（会生长的城市 · HOMM3 观感） ---------------- */

/** 大图 data URL 缓存：同一帧每次开城景都重画 80×80 是白花钱。 */
const tvArtUrls = new Map<string, string>();
function tvArtUrl(name: string, make: () => { toCanvas: () => HTMLCanvasElement }): string {
  let url = tvArtUrls.get(name);
  if (!url) {
    url = make().toCanvas().toDataURL('image/png');
    tvArtUrls.set(name, url);
  }
  return url;
}

/**
 * 全屏城景：四族底子 + **只画已建建筑**，按地块 y 做画家排序。
 *
 * 与 M9 固定 17 格网格的区别：未建的地块只剩一圈浅地基，点它就是建造 ——
 * 每建一座，城里真的多一座，这才是 HOMM3 的城镇观感。建造/升级仍复用
 * `buildStatus()` / `build()`，所以城景与建筑卡没有两套规则。
 *
 * 为什么不是塞进 560×300 的城镇面板：16 座建筑在那一屏看不完，也就不是"一览"。
 */
function openTownView(parent: HTMLElement, opts: TownDialogOptions): void {
  const town = opts.state.towns[opts.townId];
  if (!town) return;
  const owner = town.owner as SpriteOwner;
  const overlay = document.createElement('div');
  overlay.className = 'townview';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${town.name} · 城内一览`);

  const head = document.createElement('div');
  head.className = 'tv-head';
  const back = document.createElement('button');
  back.className = 'btn tiny';
  back.textContent = '返回城镇';
  back.addEventListener('click', () => overlay.remove());
  const title = document.createElement('h2');
  title.textContent = `${town.name} · 城内一览`;
  const hint = document.createElement('span');
  hint.className = 'tv-hint';
  hint.textContent = '点建筑看详情 · 点空地建造';
  head.append(back, title, hint);

  const stage = document.createElement('div');
  stage.className = 'tv-stage';
  const bg = document.createElement('canvas');
  bg.className = 'tv-bg';
  bg.setAttribute('aria-hidden', 'true');
  const world = document.createElement('div');
  world.className = 'tv-world';
  stage.append(bg, world);

  const detail = document.createElement('div');
  detail.className = 'tv-detail';
  overlay.append(head, stage, detail);
  parent.appendChild(overlay);

  let selected: string = TOWN_BUILDING_IDS[0];
  let note = '';
  let castleUrl = '';

  /** 一块地：已建画建筑，未建画浅地基；用 y 做 z-index，前面的盖住后面的。 */
  const place = (plot: TownPlot, built: boolean, frame: string, url: string, label: string): HTMLElement => {
    const slot = document.createElement('button');
    slot.className = 'tv-plot' + (built ? ' built' : ' unbuilt') + (selected === plot.id ? ' selected' : '');
    slot.style.left = `${plot.x * 100}%`;
    slot.style.top = `${plot.y * 100}%`;
    slot.style.zIndex = String(10 + Math.round(plot.y * 100));
    slot.setAttribute('aria-label', label);
    slot.title = label;
    slot.dataset.frame = frame;
    slot.dataset.plot = plot.id;
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    img.dataset.frame = frame;
    img.dataset.kind = plot.id === CASTLE_PLOT.id ? 'castle' : built ? 'building' : 'foundation';
    slot.appendChild(img);
    slot.addEventListener('click', () => { selected = plot.id; note = ''; paint(); });
    return slot;
  };

  const paint = (): void => {
    // 背景按舞台实际像素重画（不是把一张固定图拉伸），横屏/竖屏都不糊
    const w = Math.max(320, stage.clientWidth);
    const h = Math.max(180, stage.clientHeight);
    bg.width = w;
    bg.height = h;
    const ctx = bg.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(buildTownBase(owner, w, h).toCanvas(), 0, 0);
    }

    world.innerHTML = '';
    const castleLv = wallLevelOf(town);
    const castleFrame = `tv_${owner}_castle_lv${castleLv}`;
    if (!castleUrl) castleUrl = tvArtUrl(castleFrame, () => buildCastleFrame(owner, castleLv));
    world.appendChild(place(CASTLE_PLOT, true, castleFrame, castleUrl, `城墙 Lv.${castleLv}`));

    // 只有已建的地块放建筑；未建放浅地基（仍可点 → 详情里给建造按钮）
    for (const plot of TOWN_PLOTS) {
      const def = BUILDINGS[plot.id];
      if (!def) continue;
      const st = buildStatus(opts.state, town, plot.id);
      const frame = sceneBuildingFrameName(owner, plot.id, st.level);
      const url = st.built
        ? tvArtUrl(frame, () => buildSceneBuilding(owner, plot.id, st.level))
        : FOUNDATION_URL;
      world.appendChild(place(plot, st.built, frame, url, `${def.name}${st.built ? ` Lv.${st.level}` : '（空地 · 可建造）'}`));
    }

    detail.innerHTML = '';
    if (note) {
      const n = document.createElement('div');
      n.className = 'tv-note';
      n.textContent = note;
      detail.appendChild(n);
    }
    if (selected === '__castle') {
      const art = document.createElement('img');
      art.className = 'tv-detail-art';
      art.src = castleUrl;
      art.alt = '';
      const body = document.createElement('div');
      body.className = 'tv-detail-body';
      const nm = document.createElement('strong');
      nm.textContent = `城墙 · Lv.${castleLv}`;
      const tx = document.createElement('span');
      tx.textContent = castleLv === 0 ? '尚无城防：在「建筑」页建木栅。' : `现有城防 +${townDefenseBonus(town)}；升级在「建筑」页办理。`;
      body.append(nm, tx);
      detail.append(art, body);
      return;
    }
    const def = BUILDINGS[selected];
    if (!def) return;
    const st = buildStatus(opts.state, town, selected);
    const frame = sceneBuildingFrameName(owner, selected, st.level);
    const art = document.createElement('img');
    art.className = 'tv-detail-art';
    art.src = st.built
      ? tvArtUrl(frame, () => buildSceneBuilding(owner, selected, st.level))
      : FOUNDATION_URL;
    art.alt = '';
    art.dataset.frame = frame;
    const body = document.createElement('div');
    body.className = 'tv-detail-body';
    const nm = document.createElement('strong');
    nm.textContent = st.built && st.level > 1 ? `${def.name} Lv.${st.level}` : def.name;
    const tx = document.createElement('span');
    tx.textContent = st.built ? buildingDesc(town, selected) : (st.unlocked ? '空地：现在就能建造。' : st.reason);
    body.append(nm, tx, buildStateLine(st));
    detail.appendChild(art);
    detail.appendChild(body);
    if (st.unlocked && (!st.built || st.canUpgrade)) {
      const ready = st.affordable && !st.spentToday;
      detail.appendChild(
        actionBtn(st.built ? '升级' : '建造', ready, () => {
          if (!build(opts.state, town, selected)) {
            sfx.error();
            note = st.spentToday ? '今日已动工，明日再来' : '资源不足';
          } else {
            sfx.build();
            note = `${def.name} ${st.built ? `升到 Lv.${st.level + 1}` : '建成'}`;
            opts.onChange();
          }
          paint();
        }),
      );
    }
  };

  paint();
}

/**
 * 未建地块的浅地基：程序化画一次，四族共用（地基不是建筑，不承载族色）。
 * 画成 data URL 而不是每格重画：16 格 × 每次点选都重建会浪费一整帧。
 */
const FOUNDATION_URL: string = (() => {
  try {
    const pb = new PixBuf(SCENE_BUILDING_SIZE, SCENE_BUILDING_SIZE);
    const cx = SCENE_BUILDING_SIZE / 2;
    pb.ellipse(cx, SCENE_BUILDING_SIZE - 8, 22, 5, '#000000', 0.22);
    pb.rect(12, 64, 56, 8, '#9a8f78', 0.7);
    pb.hline(12, 67, 64, '#d8cca8', 0.7);
    for (let i = 16; i < 68; i += 12) pb.vline(i, 58, 64, '#b3a88c', 0.6);
    return pb.toCanvas().toDataURL('image/png');
  } catch {
    return '';
  }
})();

/** 城镇管理的 5 个标签页（§5.4：标签页 ≤5 个，每页纵向可点行 ≤5）。 */
type TownTab = 'build' | 'dwell' | 'recruit' | 'army' | 'market';

/**
 * 建筑拆成两页 —— 不是为了分类好看，而是为了满足 **R4/§5.4「每页纵向可点行 ≤5」**：
 * 16 张建筑卡放在一页，3 列网格也有 6 行 > 5，只能靠滚动，而滚动正是"拉到底"摩擦的来源。
 * 拆成 7 + 8 张（列分布各 3 行）后两页都不必滚动。⚠️ 卡片高不均（状态行文字行数
 * 不同）时视觉行数会到 4（tp6-townpanel 探针实测），仍 ≤5 —— 别按"恰好 3 行"写断言。
 */
/**
 * 建筑页签。两页各 8 格 = 面板的 4×2 网格（760×352）刚好一屏，不滚动。
 *
 * `banner` 放「建设」页而不是「兵营」页：兵营页已是 8 格满，且它是
 * **加成**不是"第 6 座兵营"（`requires: dwell3`，建成后不产生新的招募行）。
 * §2.2 的"任意空 plot 可建"尚未实装（现在没有 plot 坐标系，只有这张表），
 * 所以这里的槽位 = 表位置；将来做 plot 时按 §0.4 第 2 条补四族坐标。
 */
const BUILD_TABS: Record<'build' | 'dwell', readonly string[]> = {
  build: ['tavern', 'market', 'townhall', 'workshop', 'wall1', 'wall2', 'wall3', 'banner'],
  dwell: ['dwell1', 'dwell2', 'dwell3', 'dwell4', 'dwell5', 'guild1', 'guild2', 'guild3'],
};

/**
 * 经营主面（城镇管理）。
 *
 * 三个来自用户反馈 F4 的硬约束：
 * ① **出口不滚动**（R3）：关闭/返回固定在头部（`headClose`），不再躺在滚动流末端；
 * ② **内容分段**（R4）：5 个标签页，每页纵向可点行 ≤5；
 * ③ **决策处可见**：建筑页每张卡的造价行"还差"逐项列出；市场页补一行「我的资源」（#50）。
 */
export function openTownDialog(parent: HTMLElement, opts: TownDialogOptions): void {
  // 资源图标 sprite 幂等挂载：城镇是唯一用到它的地方，没必要在 boot 里也装一份。
  installResIcons();
  const heroHere = opts.heroId ? opts.state.heroes[opts.heroId] : null;
  let note = '';
  let tab: TownTab = 'build';

  const meta = document.createElement('div');
  meta.className = 'town-meta';
  const noteEl = document.createElement('div');
  noteEl.className = 'town-note';
  const tabs = document.createElement('div');
  tabs.className = 'town-tabs';
  const pane = document.createElement('div');
  pane.className = 'town-pane';
  // 底部库存条：顶栏被面板盖住（面板 352 高、顶栏在 y≈8..40），
  // 于是建筑页上"我买得起吗"本来要靠切到市场页才知道 —— 决策输入不在决策处。
  // 常驻一条 7 项库存，花完立刻变，不用离开当前页。
  const budget = document.createElement('div');
  budget.className = 'town-budget';

  const renderAll = (): void => {
    const { state, townId } = opts;
    const town = state.towns[townId];
    if (!town) return;
    // 当前玩家可能不是 p1（D-48 解锁选族后）⇒ 走 viewerOf，别写死阵营（项目铁律 10）。
    const res = state.players[viewerOf(state)]?.resources ?? {};

    // 常驻只读读数（IA §3.4 #36）：每日税收 / 城防 / 周增长 —— 顶栏没有，是经营的核心读数。
    // 建筑页顶部那排**堆叠式资源 chip 行已删除**（#35）：改由每张卡造价行承担（决策处可见），
    // 把经营首屏的行额度留给建筑卡本身。
    meta.innerHTML = '';
    meta.append(
      chip(`每日税收 ${townDailyIncome(town)}`),
      chip(`城防 +${townDefenseBonus(town)}`),
      chip(`周增长 ×${townGrowthMultiplier(town).toFixed(2)}`),
      chip(heroHere ? `${heroHere.name} 在城中` : '远程管理（只能补驻军）'),
    );

    noteEl.textContent = note;
    noteEl.hidden = !note;

    tabs.innerHTML = '';
    const defs: [TownTab, string][] = [
      ['build', '建筑'],
      ['dwell', '兵营·行会'],
      ['recruit', '招募'],
      ['army', '驻军'],
      ['market', '市场·工坊'],
    ];
    for (const [id, label] of defs) {
      const b = document.createElement('button');
      b.className = 'btn tiny' + (tab === id ? ' on' : '');
      b.textContent = label;
      b.setAttribute('aria-pressed', String(tab === id));
      b.addEventListener('click', () => {
        tab = id;
        renderAll();
      });
      tabs.appendChild(b);
    }
    // 城景是"视图"不是第 6 个标签页：R4/§5.4 的 ≤5 页不变，出口也仍在头部。
    if (TOWN_VIEW_ENABLED) {
      const vb = document.createElement('button');
      vb.className = 'btn tiny town-view-toggle';
      vb.textContent = '城内一览';
      vb.setAttribute('aria-label', '打开城内一览');
      vb.addEventListener('click', () => openTownView(parent, opts));
      tabs.appendChild(vb);
    }

    pane.innerHTML = '';
    const say: Say = (m) => {
      note = m;
      renderAll();
      opts.onChange();
    };
    paintPane(pane, opts, tab, res, say);

    /* 库存条同样只留「图标 + 数字」（2026-10-27）：原来 7 个「金 2500 / 木 10 / …」
       一字排开，读起来就是一串文本。图标固定顺序 + 等宽数字之后，扫一眼就能对齐比较。 */
    budget.innerHTML = '';
    const bk = document.createElement('span');
    bk.className = 'town-budget-k';
    bk.textContent = '库存';
    budget.appendChild(bk);
    for (const k of RES_ORDER) budget.appendChild(resChip(k, res[k] ?? 0));
  };

  renderAll();

  const wrap = document.createElement('div');
  wrap.className = 'town';
  wrap.append(meta, noteEl, tabs, pane, budget);

  showModal(parent, {
    title: opts.state.towns[opts.townId]?.name ?? '城镇',
    body: [wrap],
    wide: true,
    headClose: true,
    actions: [],
  });

  // TP-3：城镇对话框 = 经营场景 ⇒ town 曲（最暖的一首，含鸡啄喜剧点 §2.4）。
  playMusic('town');
}

type Say = (msg: string) => void;

function paintPane(
  root: HTMLElement,
  opts: TownDialogOptions,
  tab: TownTab,
  res: ResourceBag,
  say: Say,
): void {
  const { state, townId } = opts;
  const town = state.towns[townId];
  if (!town) return;
  const hero = opts.heroId ? state.heroes[opts.heroId] : null;
  const act = (fn: () => string | void): void => {
    const r = fn();
    say(typeof r === 'string' ? r : '');
  };

  if (tab === 'build' || tab === 'dwell') {
    paintBuildings(root, opts, BUILD_TABS[tab], act);
    return;
  }
  if (tab === 'recruit') {
    paintRecruit(root, opts, hero, act);
    return;
  }
  if (tab === 'army') {
    paintArmy(root, opts, hero, act);
    return;
  }
  paintMarket(root, opts, res, hero, act);
}

/* ---------------- 页 1 / 2：建筑 ---------------- */

function paintBuildings(
  root: HTMLElement,
  opts: TownDialogOptions,
  ids: readonly string[],
  act: (fn: () => string | void) => void,
): void {
  const { state, townId } = opts;
  const town = state.towns[townId];
  if (!town) return;

  // D-70：描述**不能只活在 `title` 里**（触屏没有 hover = 等于没写），而描述正是喜剧文案所在。
  // 机制 = **点击建筑名 → 覆盖式浮层**（不是手风琴）：浮层 absolute、不参与布局 ⇒
  //   · 折叠态卡高不变、建筑页 4 张不退；
  //   · 1 次点击即可看到该卡描述；
  //   · 建造按钮留在折叠行、不被多拦一步。
  // 浮层 `pointer-events:none`：不挡住下层按钮/卡片的点击。
  let descFor: HTMLElement | null = null;
  let descEl: HTMLElement | null = null;
  /**
   * S5（§2.4 第三条链）：魔法行会的三阶外形只出现在**这张描述浮层**里。
   *
   * 为什么不在卡片上：P1 把建筑页定成 4 列 × 179px，并写明"卡宽仍放得下建造按钮
   * 与最长状态行"。塞一张 44px 塔图要吃 52px ⇒ 实测「魔法…」被截断、"建造"折成两行。
   * 浮层是 absolute、不参与布局 —— 与 D-70 当初为了描述选同一个容器。
   */
  const revealDesc = (card: HTMLElement, desc: string, trigger: HTMLElement, art = '', frame = ''): void => {
    if (descFor === card) {
      descEl?.remove();
      descEl = null;
      descFor = null;
      trigger.setAttribute('aria-expanded', 'false');
      return;
    }
    if (!descEl) {
      descEl = document.createElement('div');
      descEl.className = 'bdesc';
      root.appendChild(descEl);
    }
    descFor = card;
    trigger.setAttribute('aria-expanded', 'true');
    descEl.innerHTML = '';
    if (art) {
      const fig = document.createElement('img');
      fig.className = 'bdesc-art';
      fig.src = art;
      fig.dataset.frame = frame;   // 与卡面同一帧名（两处共用一个 artUrl）
      fig.alt = '';
      fig.draggable = false;
      descEl.append(fig);
    }
    const txt = document.createElement('span');
    txt.className = 'bdesc-txt';
    txt.textContent = desc;
    descEl.append(txt);
    // 定位：紧贴该卡「首行（名 · 建造）」下方；再夹在 pane 可视区内（顶/底都别越界）。
    const pr = root.getBoundingClientRect();
    const brow = card.querySelector('.brow');
    const anchor = (brow ? brow.getBoundingClientRect().bottom : card.getBoundingClientRect().bottom) - pr.top + root.scrollTop;
    const paneBottom = root.scrollTop + root.clientHeight;
    const h = descEl.offsetHeight;
    let top = anchor + 2;
    if (top + h > paneBottom - 2) top = Math.max(root.scrollTop + 2, paneBottom - h - 2);
    descEl.style.top = `${top}px`;
  };

  const anySpent = ids.some((b) => buildStatus(state, town, b).spentToday);
  if (anySpent) root.appendChild(note2('今日已建造，明日可再建'));

  const grid = document.createElement('div');
  grid.className = 'bgrid';
  for (const id of ids) {
    const def = BUILDINGS[id];
    if (!def) continue;
    const st = buildStatus(state, town, id);
    const card = document.createElement('div');
    card.className =
      'bcard' + (st.built ? ' built' : '') + (st.unlocked && (!st.built || st.canUpgrade) ? ' open' : '');

    const nm = document.createElement('div');
    nm.className = 'bn';
    // 等级只在 >1 时写出来：Lv.1 是常态，写在每张卡上是噪音（spec §2.4「只显示差价与效果差」）
    nm.textContent = st.level > 1 ? `${def.name} Lv.${st.level}` : def.name;
    // Plan B'：两行紧凑卡 —— 首行 [建筑名 · 建造]、次行整宽「还差」状态（不截断）。
    // D-70：建筑名区域可点 —— 点开该卡描述浮层（见上 revealDesc）。描述不再只躺在 title。
    nm.setAttribute('role', 'button');
    nm.setAttribute('tabindex', '0');
    nm.setAttribute('aria-expanded', 'false');
    /* 建筑外观（M5 · B1 / B2）：16 座各有一张 44×44，兵营线五座还有 Lv.2/3 两张。
       卡片首行放 **28px** 缩略（`.bcard-art`），描述浮层放 **44px** 原图（`.bdesc-art`）。
       两处是同一个 URL：图集里只有一份 44×44。
       28 是**量出来的**：179px 卡宽下 16 张 0 截断、卡高仍 66px；
       DPR≥2 时 28 CSS = 56 设备像素（放大，最近邻，个别源像素重复一次，实拍清楚）；
       DPR=1 是缩小 44→28，农舍篱笆与射箭场靶会糊 ⇒ 已记成欠账（见批次文档 §2.1）。
       行会走 S5 的三阶塔（`bard_*`），兵营线走 `bld_*_u2/u3`（B2）—— 两套帧名别混。 */
    const artFrame =
      def.feature === 'guild'
        ? guildArtName(town.owner, guildArtTierOf(id))
        : buildingArtName(town.owner, id, st.level);
    const artUrl = getAtlas().url(artFrame);
    const onName = (): void => revealDesc(card, buildingDesc(town, id), nm, artUrl, artFrame);
    nm.addEventListener('click', onName);
    nm.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onName();
      }
    });
    const brow = document.createElement('div');
    brow.className = 'brow';
    const ico = document.createElement('img');
    ico.className = 'bcard-art';
    ico.src = artUrl;
    /* 用的是**哪一帧**写成 data 属性：图集 URL 是 data:，从 src 反查不到帧名。
       `probe` 与批证据用它证「等级真的换了帧」，而不是靠"看起来不一样"。 */
    ico.dataset.frame = artFrame;
    ico.alt = '';
    ico.draggable = false;
    ico.setAttribute('aria-hidden', 'true');
    brow.append(ico, nm);
    card.append(brow, buildStateLine(st));
    if (st.level === 0 && st.unlocked) {
      const ready = st.affordable && !st.spentToday;
      brow.appendChild(
        actionBtn('建造', ready, () => {
          act(() => {
            if (!build(state, town, id)) {
              sfx.error();
              return st.spentToday ? '今日已建造过建筑' : '资源不足';
            }
            sfx.build();
            return `${def.name} 建成`;
          });
        }),
      );
    } else if (st.canUpgrade) {
      /* S4：同一个入口，只是文案换成「升级」。升级价 = 0 金 + 木/矿半价（spec §2.4），
         所以玩家在金币吃紧时也能升 —— 这正是决策 60 要的：升级不跟"建墙/招将"抢金币。 */
      const ready = st.affordable && !st.spentToday;
      brow.appendChild(
        actionBtn('升级', ready, () => {
          act(() => {
            const before = st.level;
            if (!build(state, town, id)) {
              sfx.error();
              return st.spentToday ? '今日已动工，明日再来' : '资源不足';
            }
            sfx.build();
            return before + 1 >= 2 && def.growth ? `${def.name} Lv.${before + 1} · 之后产升级版` : `${def.name} Lv.${before + 1}`;
          });
        }),
      );
    }
    grid.appendChild(card);
  }
  root.appendChild(grid);
}

/* ---------------- 页 3：招募（含英雄招募） ---------------- */

/**
 * 酒馆招英雄这一行。原先只在「市场·工坊」页，2026-11-19 挪到「招募」页 ——
 * 英雄和兵一样是"招"来的，把入口埋在市场页是分类错了。
 * `HIRE_IN_RECRUIT=false`（负向对照臂）时它回到市场页，供闸门证判据敏感。
 */
function heroHireRow(opts: TownDialogOptions, act: (fn: () => string | void) => void): HTMLElement | null {
  const { state, townId } = opts;
  const town = state.towns[townId];
  if (!town || !town.buildings.includes('tavern')) return null;
  const hb = canHireHero(state, town);
  const wrap = document.createElement('div');
  wrap.className = 'ex-row hero-hire';
  const t = document.createElement('span');
  t.textContent = `酒馆 · 招募英雄（${HERO_HIRE_COST} 金，每周一位）`;
  wrap.appendChild(t);
  wrap.appendChild(
    actionBtn(
      '招募',
      hb.ok,
      () =>
        act(() => {
          const h = hireHero(state, town);
          if (!h) return '无法招募';
          opts.onHire(h.id);
          return `${h.name} 加入了你的麾下`;
        }),
      hb.ok ? '' : hb.reason,
    ),
  );
  return wrap;
}

function paintRecruit(
  root: HTMLElement,
  opts: TownDialogOptions,
  hero: Hero | null,
  act: (fn: () => string | void) => void,
): void {
  const { state, townId } = opts;
  const town = state.towns[townId];
  if (!town) return;

  const rows = recruitRows(state, town);
  const hire = HIRE_IN_RECRUIT ? heroHireRow(opts, act) : null;
  if (hire) {
    const box = document.createElement('div');
    box.className = 'town-extra';
    box.appendChild(hire);
    root.appendChild(box);
  }
  if (!rows.length) {
    if (!hire) root.appendChild(empty('尚未建成任何兵营'));
    return;
  }
  const list = document.createElement('div');
  list.className = 'rlist';
  for (const r of rows) {
    const u = getUnit(r.unitTypeId);
    const row = document.createElement('div');
    row.className = 'rrow';
    const nm = document.createElement('span');
    nm.className = 'un';
    nm.textContent = `${u.name} ×${r.available}`;
    const cs = document.createElement('span');
    cs.className = 'uc';
    cs.textContent = costText(r.cost);
    row.append(nm, cs);
    row.appendChild(actionBtn('招 1', r.affordable >= 1 && !!hero, () => act(() => doRecruit(opts, r.unitTypeId, 1, 'hero'))));
    row.appendChild(actionBtn('招 5', r.affordable >= 5 && !!hero, () => act(() => doRecruit(opts, r.unitTypeId, 5, 'hero'))));
    row.appendChild(actionBtn('全招', r.affordable >= 1 && !!hero, () => act(() => doRecruit(opts, r.unitTypeId, r.available, 'hero'))));
    row.appendChild(actionBtn('驻军', r.affordable >= 1, () => act(() => doRecruit(opts, r.unitTypeId, r.available, 'garrison'))));
    list.appendChild(row);
  }
  root.appendChild(list);
  if (!hero) root.appendChild(empty('城里没有英雄，「招募」只会进入驻军'));
}

/* ---------------- 页 4：驻军 / 部队调拨 ---------------- */

function paintArmy(
  root: HTMLElement,
  opts: TownDialogOptions,
  hero: Hero | null,
  act: (fn: () => string | void) => void,
): void {
  const { state, townId } = opts;
  const town = state.towns[townId];
  if (!town) return;

  const convertBtn = (army: { unitTypeId: string; count: number }[], uid: string): HTMLElement | null => {
    if (!CONVERT_ENABLED || !upgradedUnitIdOf(uid)) return null;
    const chk = canConvertStack(state, town, army, uid);
    const upName = getUnit(chk.to || `${uid}_u`)?.name ?? '升级版';
    // 造价必须写在脸上（决策处可见）：触屏没有 hover，只放 title 等于没写。
    // 禁用时把原因也放出来，别让玩家猜"为什么这格不能转"。
    const label = chk.ok ? `转${upName} ${costText(chk.cost)}` : `转${upName}`;
    const btn = actionBtn(
      label,
      chk.ok,
      () =>
        act(() => {
          const r = convertStack(state, town, army, uid);
          // act() → say() 已经 renderAll + opts.onChange，这里只返回提示词，别刷两次
          return r.converted
            ? `${getUnit(uid).name} ×${r.converted} 已转为 ${getUnit(r.to).name}`
            : r.reason;
        }),
      chk.ok ? `差价 ${costText(chk.cost)} · ${chk.count} 只一次转完` : chk.reason,
    );
    btn.classList.add('stack-convert');
    btn.setAttribute('data-unit', uid);
    if (!chk.ok) {
      const why = document.createElement('span');
      why.className = 'cv-why';
      why.textContent = chk.reason;
      const box = document.createElement('span');
      box.className = 'cv-wrap';
      box.append(btn, why);
      return box;
    }
    return btn;
  };

  root.appendChild(sectionTitle('驻军'));
  root.appendChild(
    armyList(
      town.garrison,
      hero
        ? (uid) => {
            act(() => {
              const h = opts.heroId ? state.heroes[opts.heroId] : null;
              if (!h) return '没有英雄';
              const n = garrisonToHero(h, town, uid, 9999);
              return n ? `${getUnit(uid).name} ×${n} 已编入队伍` : '英雄部队兵种已满';
            });
          }
        : null,
      '带走',
      (uid) => convertBtn(town.garrison, uid),
    ),
  );

  if (hero) {
    root.appendChild(sectionTitle(`${hero.name} 的部队`));
    root.appendChild(
      armyList(
        hero.army,
        (uid) => {
          act(() => {
            const h = opts.heroId ? state.heroes[opts.heroId] : null;
            if (!h) return '没有英雄';
            const n = heroToGarrison(h, town, uid, 9999);
            return n ? `${getUnit(uid).name} ×${n} 留守城中` : '驻军兵种已满';
          });
        },
        '留下',
        hero ? (uid) => convertBtn(hero.army, uid) : null,
      ),
    );
  }
}

/* ---------------- 页 5：市场 · 工坊（含 #50 我的资源行） ---------------- */

function paintMarket(
  root: HTMLElement,
  opts: TownDialogOptions,
  res: ResourceBag,
  hero: Hero | null,
  act: (fn: () => string | void) => void,
): void {
  const { state, townId } = opts;
  const town = state.towns[townId];
  if (!town) return;

  // ★ #50：市场页的**全部决策变量就是"我现在有什么"**。
  // 现状是"点了才知道"——`金币不足` / `水晶不足` 都是**操作后**文案，事先不可见；
  // 而困难档起始资源只有普通档的 70% ⇒ 试错成本高。故必须在**决策处可见**。
  // 与建筑页不同：市场页没有建筑卡列，不占 R4 的 ≤5 行额度。
  const mine = document.createElement('div');
  mine.className = 'my-res';
  const mk = document.createElement('span');
  mk.className = 'my-res-k';
  mk.textContent = '我的资源';
  mine.appendChild(mk);
  mine.appendChild(chip(`金 ${res.gold ?? 0}`));
  mine.appendChild(chip(`木 ${res.wood ?? 0}`));
  mine.appendChild(chip(`矿 ${res.ore ?? 0}`));
  for (const k of ['gem', 'crystal', 'sulfur', 'mercury'] as const) {
    mine.appendChild(chip(`${RESOURCE_LABEL[k]} ${res[k] ?? 0}`));
  }
  root.appendChild(mine);

  const extra = document.createElement('div');
  extra.className = 'town-extra';

  // 负向对照臂 devhiretab=market：入口退回旧页，供 probe:townview 的 N2 验证
  if (!HIRE_IN_RECRUIT) {
    const hire = heroHireRow(opts, act);
    if (hire) extra.appendChild(hire);
  }

  if (town.buildings.includes('market')) {
    const wrap = document.createElement('div');
    wrap.className = 'ex-row';
    const t = document.createElement('span');
    const bulk = MARKET_RATES.wood;
    t.textContent =
      `市场 · ${bulk.buyGold} 金买 ${bulk.buyAmount} 木/矿 · 卖 ${bulk.sellAmount} 木/矿得 ${bulk.sellGold} 金 · ` +
      `稀有资源 ${MARKET_RATES.gem.buyGold} 金买 1 / 卖 1 得 ${MARKET_RATES.gem.sellGold} 金`;
    wrap.appendChild(t);
    for (const r of ['wood', 'ore'] as const) {
      const rate = MARKET_RATES[r];
      wrap.appendChild(
        actionBtn(`买${RESOURCE_LABEL[r]}`, (res.gold ?? 0) >= rate.buyGold, () =>
          act(() => (marketBuy(state, r) ? `买入${RESOURCE_LABEL[r]}` : '金币不足'))),
      );
    }
    for (const r of ['wood', 'ore'] as const) {
      const rate = MARKET_RATES[r];
      wrap.appendChild(
        actionBtn(`卖${RESOURCE_LABEL[r]}`, (res[r] ?? 0) >= rate.sellAmount, () =>
          act(() => (marketSell(state, r) ? `卖出${RESOURCE_LABEL[r]}` : `${RESOURCE_LABEL[r]}不足`))),
      );
    }
    // 稀有资源：按个交易，卖出比买入便宜一半（市场是变现渠道，不是印钞机）
    for (const r of ['gem', 'crystal', 'sulfur', 'mercury'] as const) {
      const rate = MARKET_RATES[r];
      wrap.appendChild(
        actionBtn(
          `买${RESOURCE_LABEL[r]}(${rate.buyGold})`,
          (res.gold ?? 0) >= rate.buyGold,
          () => act(() => (marketBuy(state, r) ? `买入${RESOURCE_LABEL[r]}` : '金币不足')),
          `${rate.buyGold} 金买 1 个${RESOURCE_LABEL[r]}；魔法行会与宝库都用得上`,
        ),
      );
      wrap.appendChild(
        actionBtn(
          `卖${RESOURCE_LABEL[r]}(${rate.sellGold})`,
          (res[r] ?? 0) >= rate.sellAmount,
          () => act(() => (marketSell(state, r) ? `卖出${RESOURCE_LABEL[r]}` : `${RESOURCE_LABEL[r]}不足`)),
          `卖 1 个${RESOURCE_LABEL[r]}得 ${rate.sellGold} 金`,
        ),
      );
    }
    extra.appendChild(wrap);
  }

  // 工坊：攻城器械只有在英雄站在城里时才能装到他身上
  if (town.buildings.includes('workshop')) {
    const wrap = document.createElement('div');
    wrap.className = 'ex-row';
    const t = document.createElement('span');
    const carried = hero ? heroWarMachines(hero).map((m) => WAR_MACHINES[m].name).join('、') : '';
    t.textContent = hero
      ? `工坊 · 装配攻城器械（${hero.name} 已带：${carried || '无'}）`
      : '工坊 · 装配攻城器械（需要一位英雄站在城中）';
    wrap.appendChild(t);
    for (const id of WAR_MACHINE_IDS) {
      const def = WAR_MACHINES[id];
      const chk = canAssemble(state, town, hero, id);
      wrap.appendChild(
        actionBtn(
          `${def.name}（${costText(def.cost)}）`,
          chk.ok,
          () =>
            act(() => {
              const h = opts.heroId ? state.heroes[opts.heroId] : null;
              if (!h) return '需要一位英雄站在城中';
              const r = assembleWarMachine(state, town, h, id);
              return r.ok ? `工坊装配了「${def.name}」` : r.reason;
            }),
          chk.ok ? def.desc : chk.reason,
        ),
      );
    }
    extra.appendChild(wrap);
  }

  if (extra.childElementCount) root.appendChild(extra);
  else root.appendChild(empty('尚未建成 酒馆 / 市场 / 工坊'));
}

function doRecruit(opts: TownDialogOptions, unitTypeId: string, count: number, to: 'hero' | 'garrison'): string {
  const { state, townId } = opts;
  const town = state.towns[townId];
  const hero = opts.heroId ? state.heroes[opts.heroId] : null;
  const u = getUnit(unitTypeId);
  if (to === 'garrison') {
    const r = recruitToGarrison(state, town, unitTypeId, count);
    return r.taken ? `${u.name} ×${r.taken} 加入驻军` : r.reason;
  }
  const r = recruitToHero(state, town, hero, unitTypeId, count);
  return r.taken ? `${u.name} ×${r.taken} 加入队伍` : r.reason;
}

/* ---------------- dom helpers ---------------- */

function chip(text: string, extra = ''): HTMLElement {
  const e = document.createElement('span');
  e.className = 'chip-info' + (extra ? ` ${extra}` : '');
  e.textContent = text;
  return e;
}

/**
 * 建筑卡片的状态行。
 *
 * 关键点：**把"还差什么"写在脸上**。后端会给出 missing（现有/需要），
 * 这里逐项渲染成红字；否则玩家看到"资源不足（4500 金）"而自己有两万金，
 * 会以为是 bug——实际上是那 4 个水晶没露面。
 */
function buildStateLine(st: BuildStatus): HTMLElement {
  const el = document.createElement('div');
  if (st.built && !st.canUpgrade) {
    el.className = 'bs built';
    el.textContent = st.level > 1 ? `✓ Lv.${st.level}` : '✓ 已建成';
    return el;
  }
  /* 前置没满足：这句必须留文字（"需先建造：市场"没法图标化），它也就两个字多一点。 */
  if (!st.unlocked) {
    el.className = 'bs';
    el.textContent = st.reason;
    return el;
  }
  if (st.spentToday) {
    el.className = 'bs warn';
    el.textContent = '今日已动工 · 明日再来';
    return el;
  }
  /* 造价：**图标 + 数字**，一行、不折行。
   *
   * 2026-10-27（主理人："各个建筑的资源显示太长，给人感觉还是一堆 text"）：
   * 原来写 `4500 金 · 4 水晶`，买不起时再补一句 `还差：金 1000/4500、水晶 0/4` ——
   * 一行里塞两遍同样的信息。现在：
   *   · 数字 = 需要多少（不再重复"现有多少"，库存条就在屏幕底部，一直可见）；
   *   · **红 = 这一项不够**（哪项缺一眼可见，而不是读一长串"还差"）；
   *   · 全名只进 `title` / `aria-label`，卡面不写汉字。
   * 宽度实测：最多 3 项（9000 金 / 10 木 / 20 矿）≈ 132px < 卡内宽 160px。 */
  if (!COST_CHIPS) {
    /* 旧表现（负向对照臂）：一行文字，缺项用「现有/需要」。 */
    el.className = 'bs' + (st.missing.length ? ' short' : '');
    el.textContent =
      formatCost(st.cost) +
      (st.missing.length
        ? '　还差：' + st.missing.map((m) => `${RESOURCE_LABEL[m.resource] ?? m.resource} ${m.have}/${m.need}`).join('、')
        : '');
    return el;
  }
  el.className = 'bs costs';
  const lack = new Map(st.missing.map((m) => [m.resource, m.have]));
  for (const k of RES_ORDER) {
    const need = st.cost[k] ?? 0;
    if (!need) continue;
    el.appendChild(
      resChip(k, need, lack.has(k) ? { short: true, have: lack.get(k) ?? 0 } : undefined),
    );
  }
  if (!el.childElementCount) {
    el.className = 'bs';
    el.textContent = '免费';
  }
  return el;
}

/**
 * 一枚资源 chip：图标 + 数字。`short` = 这一项买不起（红色 + `现有/需要` 进 tooltip）。
 *
 * 语义不进颜色：`aria-label` 写全「金币：现有 1000，需要 4500」，读屏拿到的是完整句子；
 * 卡面上只剩图标与数字，是**视觉**上的减法。
 */
function resChip(
  kind: ResourceKind,
  amount: number,
  short?: { short: boolean; have: number },
): HTMLElement {
  const el = document.createElement('span');
  el.className = 'rc' + (short ? ' bad' : '');
  const full = RES_FULL[kind] ?? kind;
  const text = short ? `${full}：现有 ${short.have}，需要 ${amount}` : `${full} ${amount}`;
  el.title = text;
  el.setAttribute('aria-label', text);
  el.appendChild(resIcon(kind as ResId));
  const b = document.createElement('b');
  b.textContent = String(amount);
  el.appendChild(b);
  return el;
}

function sectionTitle(text: string): HTMLElement {
  const e = document.createElement('h3');
  e.className = 'th';
  e.textContent = text;
  return e;
}

function note2(text: string): HTMLElement {
  const e = document.createElement('div');
  e.className = 'town-note';
  e.textContent = text;
  return e;
}

function empty(text: string): HTMLElement {
  const e = document.createElement('div');
  e.className = 'empty';
  e.textContent = text;
  return e;
}

function actionBtn(label: string, enabled: boolean, onClick: () => void, title = ''): HTMLElement {
  const b = document.createElement('button');
  // M-09：actionBtn 的纵向最近邻至少隔 14px（.rrow 行距 4px + 行内边距 5×2、
  // .ex-row 6px + 6×2、.bgrid ≥8px），可安全用 .tap 把命中区纵向扩到 ~48px
  //（.btn.tiny 底 40px + 纵轴 ±4px）。
  b.className = 'btn tiny tap' + (enabled ? '' : ' off');
  b.textContent = label;
  b.disabled = !enabled;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function armyList(
  army: { unitTypeId: string; count: number }[],
  onMove: ((unitTypeId: string) => void) | null,
  moveLabel: string,
  onConvert?: ((unitTypeId: string) => HTMLElement | null) | null,
): HTMLElement {
  const list = document.createElement('div');
  list.className = 'rlist';
  if (!army.length) {
    list.appendChild(empty('（空）'));
    return list;
  }
  for (const s of army) {
    const u = getUnit(s.unitTypeId);
    const row = document.createElement('div');
    row.className = 'rrow';
    const nm = document.createElement('span');
    nm.className = 'un';
    nm.textContent = `${u.name} ×${s.count}`;
    const st = document.createElement('span');
    st.className = 'uc';
    st.textContent = `攻${u.attack} 防${u.defense} 伤${u.damageMin}-${u.damageMax} 血${u.hp}`;
    row.appendChild(nm);
    row.appendChild(st);
    if (onMove) row.appendChild(actionBtn(moveLabel, true, () => onMove(s.unitTypeId)));
    const cv = onConvert?.(s.unitTypeId);
    if (cv) {
      cv.setAttribute('data-unit', s.unitTypeId);
      // 禁用态 cv 是 .cv-wrap 外壳，按钮在里面；类已由 convertBtn 打在按钮上
      if (!cv.classList.contains('stack-convert')) cv.setAttribute('data-disabled', '1');
      row.appendChild(cv);
    }
    list.appendChild(row);
  }
  return list;
}

export function formatCost(cost: ResourceBag): string {
  return costText(cost);
}
