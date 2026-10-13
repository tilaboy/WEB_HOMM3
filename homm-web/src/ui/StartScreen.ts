import type { Difficulty, GameConfig } from '../core/types.js';
import {
  DEFAULT_CONFIG,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  FACTIONS,
  FACTION_ORDER,
  factionColor,
} from '../core/data/factions.js';
import { TERRAIN } from '../core/data/terrains.js';
import { SCENARIO_BY_ID, scenarioGenOptions } from '../core/data/scenarios.js';
import { createGame } from '../core/map/generator.js';
import { idx } from '../core/map/grid.js';
import { quality } from '../render/quality.js';

/**
 * 开局页 —— **只有一张地图 + 一个难度**。
 *
 * ## 为什么变成这样（2026-10-12 用户裁定）
 * 原来这一页有 7 行（领主名字 / 试玩场景 / 地图尺寸 / 地图布局 / 电脑对手 / 难度 /
 * 地图种子）+ 一颗「试这张图」按钮。用户的结论是「开局页面还是显得有点繁琐」，
 * 并进一步裁定：**现阶段删掉随机地图整条线，只保留教学模式和破碎罗盘，后续再增加更多地图**。
 *
 * 所以现在：
 *   - 随机地图生成器（尺寸 / 布局 / 对手 / 种子 / 名字）**从 UI 下线** —— 代码仍在，
 *     只能靠 `?devquick=1` 之类的调试参数进入（见 `main.ts`）。
 *   - 「试玩场景」那一行 4 张卡也没了：教学模式改为**首次启动直接进**（`main.ts` 的
 *     `maybeAutoTutorial`），进来之后不再有入口；破碎罗盘就是本页唯一的一张卡。
 *   - 难度是唯一还活着的设置项 —— `grims-showcase` 有 `difficultyEditable: true`。
 *
 * ## 仍然成立的三件事
 *   ① 预览图画的就是要开的那一局（看到什么就玩到什么）；
 *   ② 「继续上次存档」和「开始」在一条视线上，不会误点覆盖存档；
 *   ③ 只有难度会变，而难度**不影响地形与物件摆放** ⇒ 预览只在打开时生成一次。
 */
export interface StartScreenOptions {
  initial?: Partial<GameConfig>;
  /** 本地是否已有存档 */
  hasSave: boolean;
  onStart: (config: GameConfig) => void;
  onContinue: () => void;
}

export interface StartHandle {
  close: () => void;
}

/** 本页唯一的一张地图。 */
const SHOWCASE_ID = 'grims-showcase';

export function openStartScreen(host: HTMLElement, opts: StartScreenOptions): StartHandle {
  const def = SCENARIO_BY_ID[SHOWCASE_ID];
  const cfg: GameConfig = {
    size: 'large',
    seed: 2175,
    layout: 'wild',
    opponents: 3,
    difficulty: opts.initial?.difficulty ?? DEFAULT_CONFIG.difficulty,
    playerName: opts.initial?.playerName ?? DEFAULT_CONFIG.playerName,
  };

  const root = document.createElement('div');
  root.id = 'start-screen';

  /* ---------------- 左侧：标题 + 地图卡 + 难度 ---------------- */

  const panel = document.createElement('div');
  panel.className = 'ss-panel';

  const brand = document.createElement('div');
  brand.className = 'ss-brand';
  const h1 = document.createElement('h1');
  h1.textContent = '骑士信条';
  const sub = document.createElement('p');
  sub.textContent = '在四方的土地上建立城镇、招募军队、击败所有对手。';
  brand.append(h1, sub);
  panel.appendChild(brand);

  const form = document.createElement('div');
  form.className = 'ss-form';
  panel.appendChild(form);

  /* 地图名 + 一句副标：**不再是带边框的"卡片"**。
   * 2026-10-13 用户反馈「一个大的破碎罗盘在一个文本框里边，然后难度上小文本框，
   * 可能不需要这么多文本框」。原先这里是一只描边盒子，加上难度的 3 只小盒、
   * 摘要的上下两条线、开始按钮一只盒、地图一只框 ⇒ 一页五层框。
   * 现在只留**地图本身那只框**（那是画框，该有）和**开始按钮**（那是个动作，该突出），
   * 其余全部退回纯文字层级。 */
  const mapName = document.createElement('div');
  mapName.className = 'ss-mapcard-name';
  mapName.textContent = def?.name ?? '破碎罗盘';
  const mapSub = document.createElement('div');
  mapSub.className = 'ss-mapcard-sub';
  mapSub.textContent = def?.sub ?? '';
  const mapHint = document.createElement('div');
  mapHint.className = 'ss-hint';
  mapHint.textContent =
    '地形导入自 HoMM3《破碎罗盘》—— 同一张图每一局都一模一样，可以认路、可以背「那条海峡在哪」。';
  /* 用 `.ss-mapcard` 包一层**只为**让门控的既有断言（`#start-screen .ss-mapcard` 存在）
   * 继续成立 —— 它现在是个无边框、无背景的透明容器，视觉上不存在。 */
  const mapCard = document.createElement('div');
  mapCard.className = 'ss-mapcard';
  mapCard.append(mapName, mapSub, mapHint);
  form.appendChild(mapCard);

  /* 难度：本页唯一可改的东西。破碎罗盘固定 3 家对手，所以只用最普通的那句，
   * 不要为不存在的分支写文案。
   * ★ `ss-diff` 是给开始页这一行加的**修饰类**：把它从"三只描边小盒"改成
   *   "三个文字档位 + 当前档一条下划线"（见 style.css）。`.ss-seg-item` 的样式是
   *   与英雄面板 `.hp-tabs` 共用的，不能直接改基类。 */
  const diffSeg = segment<Difficulty>(
    DIFFICULTY_ORDER.map((id) => ({
      value: id,
      title: DIFFICULTIES[id].name,
      hint: DIFFICULTIES[id].desc,
    })),
    cfg.difficulty,
    (v) => {
      cfg.difficulty = v;
    },
  );
  diffSeg.el.classList.add('ss-diff');
  form.appendChild(field('难度', diffSeg.el, '同时影响你的起始资源、野怪强度与电脑对手'));

  /* ---------------- 右侧：预览（**只有地图**） ---------------- */

  const preview = document.createElement('div');
  preview.className = 'ss-preview';

  const canvas = document.createElement('canvas');
  canvas.id = 'ss-map';
  preview.appendChild(canvas);

  /* ---------------- 左栏续：图例 + 摘要（2026-10-13 从右栏搬来） ----------------
   * 为什么要搬：实测（DUMP 探针）右栏 357px 宽，而地图被**垂直**顶死在 196px
   * （上方 35 + 图例 16 + 摘要 66 + 间隙 ≈ 129）⇒ 两侧各空 80px，地图永远是邮票。
   * 把图例和摘要搬到左栏后，右栏整块归地图 ⇒ 地图放大到 ~300px，
   * 且"这是什么图 / 上面有什么"这类文字信息与地图卡、难度同在一条阅读动线上。 */
  const legend = document.createElement('div');
  legend.className = 'ss-legend';
  panel.appendChild(legend);

  const summary = document.createElement('div');
  summary.className = 'ss-summary';
  panel.appendChild(summary);

  /* ---------------- 底部按钮 ---------------- */

  const actions = document.createElement('div');
  actions.className = 'ss-actions';

  const startBtn = document.createElement('button');
  startBtn.className = 'btn primary big';
  startBtn.id = 'ss-start';
  startBtn.textContent = '开始';
  startBtn.addEventListener('click', () => {
    close();
    /* ★ 必须走 `scenarioGenOptions(...)` 取全 5 个固定值 —— `createGame({ scenario: id })`
     *   会因缺省 size（32×32）与静态地形 40×40 不符而**抛**（见 `scenarios.ts` 注释）。
     *   难度是唯一留给玩家的东西，所以只覆盖它。 */
    const o = def ? scenarioGenOptions(def) : null;
    opts.onStart({
      size: o?.size ?? cfg.size,
      layout: o?.layout ?? cfg.layout,
      seed: o?.seed ?? cfg.seed,
      opponents: o?.opponents ?? cfg.opponents,
      difficulty: cfg.difficulty,
      playerName: cfg.playerName,
      scenario: o?.scenario,
    });
  });
  actions.appendChild(startBtn);

  if (opts.hasSave) {
    const contBtn = document.createElement('button');
    contBtn.className = 'btn big';
    contBtn.textContent = '继续上次存档';
    contBtn.addEventListener('click', () => {
      close();
      opts.onContinue();
    });
    actions.appendChild(contBtn);
  }

  const note = document.createElement('div');
  note.className = 'ss-note';
  note.textContent = opts.hasSave ? '开始会覆盖当前存档' : '进度会自动保存在本机浏览器里';
  actions.appendChild(note);

  /* ★ 按钮区挂**左栏**（`panel`），不挂右栏预览。
   * 2026-10-13 版式重整的理由：开局页精简后左栏只剩「地图卡 + 难度」两件，
   * 按七行时代的版式排 ⇒ 左栏**下面一大片空棕色**；而右栏的地图预览又被
   * `max-height:128px` 压成邮票、白剩一倍空间。
   * 把「开始」移到左栏底部后：左栏读下来是 标题→地图卡→难度→开始（一条完整动线），
   * 右栏整块归地图 ⇒ 两栏都满，且按钮离"刚设好的难度"更近。 */
  panel.appendChild(actions);

  root.append(panel, preview);
  host.appendChild(root);

  /* ---------------- 预览渲染 ----------------
   * 只画一次：难度不影响地形与物件，没有"改设置就重画"的场景了。
   * 40×40 的静态图生成要几百毫秒 ⇒ 让出一帧再算，别把首屏卡住。 */
  function drawPreview(): void {
    if (!def) {
      summary.textContent = '找不到地图数据。';
      return;
    }
    let state;
    try {
      state = createGame(scenarioGenOptions(def));
    } catch {
      summary.textContent = '这张地图生成失败。';
      return;
    }
    const m = state.map;
    const scale = Math.max(2, Math.floor(520 / Math.max(m.width, m.height)));
    canvas.width = m.width * scale;
    canvas.height = m.height * scale;
    canvas.style.width = `${Math.min(520, canvas.width)}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const t = m.tiles[idx(m, x, y)];
        ctx.fillStyle = TERRAIN[t.terrain].top;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    // 主城用阵营色标出来，中立城画成空心方块
    for (const town of Object.values(state.towns)) {
      const p = town.pos;
      if (town.owner === 'neutral') {
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x * scale + 0.5, p.y * scale + 0.5, scale * 2 - 1, scale * 2 - 1);
        continue;
      }
      ctx.fillStyle = factionColor(town.owner);
      ctx.fillRect(p.x * scale - 1, p.y * scale - 1, scale + 2, scale + 2);
    }

    const factions = FACTION_ORDER.slice(0, 1 + def.config.opponents);
    legend.innerHTML = '';
    for (const id of factions) {
      const chip = document.createElement('span');
      chip.className = 'ss-chip';
      const dot = document.createElement('i');
      dot.style.background = factionColor(id);
      chip.append(dot, document.createTextNode(FACTIONS[id].name));
      legend.appendChild(chip);
    }
    const neutralChip = document.createElement('span');
    neutralChip.className = 'ss-chip';
    const nDot = document.createElement('i');
    nDot.className = 'hollow';
    neutralChip.append(nDot, document.createTextNode('中立据点'));
    legend.appendChild(neutralChip);

    const townCount = Object.keys(state.towns).length;
    const heroCount = Object.keys(state.heroes).length;
    summary.innerHTML = '';
    summary.append(
      line('地图', `${m.width}×${m.height} · 导入地形`),
      line('据点', `共 ${townCount} 座（${townCount - factions.length} 座中立）`),
      line('起始英雄', `${heroCount} 位`),
      line('宝物 / 野怪', `${countKind(state, 'artifact')} / ${countKind(state, 'wanderingMonster')}`),
    );
  }
  window.setTimeout(drawPreview, 0);

  function close(): void {
    root.remove();
  }

  /* 画质档只在这一页还有一处用处：预览画布别超过上限（渲染本身在游戏内由档位管）。 */
  void quality;

  return { close };
}

/* ---------------- 小工具 ---------------- */

function countKind(state: ReturnType<typeof createGame>, kind: string): number {
  return Object.values(state.map.objects).filter((o) => o.kind === kind).length;
}

function line(k: string, v: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ss-line';
  const kk = document.createElement('span');
  kk.className = 'k';
  kk.textContent = k;
  const vv = document.createElement('span');
  vv.className = 'v';
  vv.textContent = v;
  row.append(kk, vv);
  return row;
}

function field(label: string, control: HTMLElement, hint?: string | HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'ss-field';
  const lb = document.createElement('label');
  lb.textContent = label;
  wrap.appendChild(lb);
  wrap.appendChild(control);
  if (hint) {
    const h = typeof hint === 'string' ? document.createElement('div') : hint;
    h.classList.add('ss-hint');
    if (typeof hint === 'string') h.textContent = hint;
    wrap.appendChild(h);
  }
  return wrap;
}

interface SegItem<T> {
  value: T;
  title: string;
  sub?: string;
  hint?: string;
}

/** `segment()` 的句柄（G-1）：行本身 + 回填。 */
interface SegmentHandle<T> {
  el: HTMLElement;
  setValue(value: T): void;
}

function segment<T>(items: SegItem<T>[], current: T, onPick: (v: T) => void): SegmentHandle<T> {
  const row = document.createElement('div');
  row.className = 'ss-seg';
  row.setAttribute('role', 'radiogroup');
  const buttons: HTMLButtonElement[] = [];
  const byValue = new Map<T, HTMLButtonElement>();

  function setValue(v: T): void {
    for (const b of buttons) {
      const on = byValue.get(v) === b;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
  }

  for (const item of items) {
    const b = document.createElement('button');
    b.className = 'ss-seg-item';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(item.value === current));
    b.title = item.hint ?? item.title;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = item.title;
    b.appendChild(t);
    if (item.sub) {
      const s = document.createElement('span');
      s.className = 's';
      s.textContent = item.sub;
      b.appendChild(s);
    }
    b.classList.toggle('on', item.value === current);
    b.addEventListener('click', () => {
      setValue(item.value);
      onPick(item.value);
    });
    buttons.push(b);
    byValue.set(item.value, b);
    row.appendChild(b);
  }

  return { el: row, setValue };
}
