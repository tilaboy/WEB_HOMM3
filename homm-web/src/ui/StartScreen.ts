import type { Difficulty, GameConfig, MapLayout, MapSize } from '../core/types.js';
import { MAP_SIZES } from '../core/types.js';
import {
  DEFAULT_CONFIG,
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  FACTIONS,
  FACTION_ORDER,
  SIZE_ORDER,
  factionColor,
} from '../core/data/factions.js';
import { TERRAIN } from '../core/data/terrains.js';
import { LAYOUTS, LAYOUT_ORDER } from '../core/data/layouts.js';
import { SCENARIOS, SCENARIO_BY_ID, scenarioGenOptions } from '../core/data/scenarios.js';
import { createGame } from '../core/map/generator.js';
import { idx } from '../core/map/grid.js';
import { quality, clampMapSize, allowedMapSizes } from '../render/quality.js';

/**
 * 开局设置页。
 *
 * 三件事必须成立：
 *   ① 同一套设置 + 同一个种子 = 同一张地图（所以种子默认填死，可手改）；
 *   ② 预览图用的就是把要开的这一局，看到什么就玩到什么；
 *   ③ 「继续上次存档」和「开始新游戏」在一条视线上，不会误点覆盖存档。
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

export function openStartScreen(host: HTMLElement, opts: StartScreenOptions): StartHandle {
  const cfg: GameConfig = {
    size: opts.initial?.size ?? DEFAULT_CONFIG.size,
    seed: opts.initial?.seed ?? randomSeed(),
    layout: LAYOUTS[opts.initial?.layout ?? DEFAULT_CONFIG.layout]
      ? (opts.initial?.layout ?? DEFAULT_CONFIG.layout)
      : DEFAULT_CONFIG.layout,
    opponents: opts.initial?.opponents ?? DEFAULT_CONFIG.opponents,
    difficulty: opts.initial?.difficulty ?? DEFAULT_CONFIG.difficulty,
    playerName: opts.initial?.playerName ?? DEFAULT_CONFIG.playerName,
  };

  const root = document.createElement('div');
  root.id = 'start-screen';

  /* ---------------- 左侧：标题 + 设置 ---------------- */

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

  /* 领主名字 */
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 12;
  nameInput.value = cfg.playerName;
  nameInput.placeholder = '给自己起个名字';
  nameInput.addEventListener('input', () => {
    // 改名字不需要重画地图，省掉一次整图生成
    cfg.playerName = nameInput.value.trim() || DEFAULT_CONFIG.playerName;
  });
  form.appendChild(field('领主名字', nameInput, '会同时作为你第一位英雄的名字'));

  /* 地图尺寸：按当前画质上限过滤（低端只到中型）——上限来自 quality.maxMapSize */
  const allowedSizes = allowedMapSizes(quality.maxMapSize);
  cfg.size = clampMapSize(cfg.size, quality.maxMapSize);
  const sizeSeg = segment<MapSize>(
    SIZE_ORDER.filter((id) => allowedSizes.includes(id)).map((id) => {
      const s = MAP_SIZES[id];
      return {
        value: id,
        title: s.name,
        sub: `${s.width}×${s.height}`,
        hint:
          s.name === '小型'
            ? '节奏快，一场 20~30 天'
            : s.name === '中型'
              ? '标准地图，探索与攻城都有余地'
              : s.name === '大型'
                ? '大地图，四家混战才铺得开'
                : '四家各占一大片，矿业与宝库都管够；一局要打很久',
      };
    }),
    cfg.size,
    (v) => {
      cfg.size = v;
      sync();
    },
  );
  // 先落在文档流里，稍后把「试玩场景」行插在它**之上**（§14.1：领主名字之后、尺寸之前）。
  const sizeField = form.appendChild(field('地图尺寸', sizeSeg.el));

  /* 地图布局：结构靠模板，纹理靠种子——右侧预览会跟着重画 */
  const layoutHint = document.createElement('div');
  layoutHint.className = 'ss-hint';
  layoutHint.textContent = LAYOUTS[cfg.layout].desc;
  const layoutSeg = segment<MapLayout>(
    LAYOUT_ORDER.map((id) => ({
      value: id,
      title: LAYOUTS[id].name,
      sub: LAYOUTS[id].sub,
      hint: LAYOUTS[id].desc,
    })),
    cfg.layout,
    (v) => {
      cfg.layout = v;
      layoutHint.textContent = LAYOUTS[v].desc;
      sync();
    },
  );
  form.appendChild(field('地图布局', layoutSeg.el, layoutHint));

  /* 难度提示：本方案难度**同时影响玩家**——起始资源、野怪强度、移动力、电脑对手
   * 都会随难度变化。无对手时玩家侧杠杆（起始资源 / 野怪）依然生效，文案要切到对应表述。
   * 必须在 opponents 段之前定义，因为切换对手数量时要实时刷新这段提示。 */
  const diffHint = document.createElement('div');
  diffHint.className = 'ss-hint';
  const syncDiffHint = (): void => {
    diffHint.textContent =
      cfg.opponents === 0
        ? '无对手时，难度通过你的起始资源与野怪强度生效'
        : '同时影响你的起始资源、野怪强度与电脑对手';
  };
  syncDiffHint();

  /* 电脑对手 */
  const oppSeg = segment<number>(
    [0, 1, 2, 3].map((n) => ({
      value: n,
      title: n === 0 ? '无' : `${n} 家`,
      sub: n === 0 ? '单人探索' : FACTION_ORDER.slice(1, 1 + n).map((f) => FACTIONS[f].name).join(' / '),
      hint:
        n === 0
          ? '只有野怪与中立据点，专心发育'
          : n === 3
            ? '四方混战，难度最高'
            : '电脑对手会自行建设、征兵并向外扩张',
    })),
    cfg.opponents,
    (v) => {
      cfg.opponents = v;
      syncDiffHint();
      sync();
    },
  );
  form.appendChild(field('电脑对手', oppSeg.el));

  /* 难度 */
  const diffSeg = segment<Difficulty>(
    DIFFICULTY_ORDER.map((id) => ({
      value: id,
      title: DIFFICULTIES[id].name,
      hint: DIFFICULTIES[id].desc,
    })),
    cfg.difficulty,
    (v) => {
      cfg.difficulty = v;
      sync();
    },
  );
  form.appendChild(field('难度', diffSeg.el, diffHint));

  /* 种子 */
  const seedInput = document.createElement('input');
  seedInput.type = 'text';
  seedInput.inputMode = 'numeric';
  seedInput.className = 'ss-seed';
  seedInput.value = String(cfg.seed);
  seedInput.addEventListener('change', () => {
    const n = Number.parseInt(seedInput.value.replace(/[^0-9]/g, ''), 10);
    cfg.seed = Number.isFinite(n) ? n >>> 0 : randomSeed();
    seedInput.value = String(cfg.seed);
    sync();
  });
  const reroll = document.createElement('button');
  reroll.className = 'btn';
  reroll.textContent = '换一个';
  reroll.addEventListener('click', () => {
    cfg.seed = randomSeed();
    seedInput.value = String(cfg.seed);
    sync();
  });
  const seedWrap = document.createElement('div');
  seedWrap.className = 'ss-seedin';
  seedWrap.append(seedInput, reroll);
  form.appendChild(field('地图种子', seedWrap, '同一种子必然生成同一张地图，可以把种子发给朋友'));

  /* ---------------- 试玩场景（§14.1）---------------- *
   * 位置：插在「地图尺寸」**之上**（领主名字之后、尺寸之前）。
   * 默认「自由对局」⇒ `cfg.scenario` 缺省（**不是** `'free'`）。
   * 选场景：5 行设为该场景固定值 + **真 disabled**；切回自由对局：**恢复快照**（不是重置默认）。 */
  const scenarioHint = document.createElement('div');
  scenarioHint.id = SCENARIO_HINT_ID;
  scenarioHint.className = 'ss-hint';
  scenarioHint.textContent = FREE_HINT;
  const scenarioSeg = segment<string | null>(
    [
      ...SCENARIOS.map((s): SegItem<string | null> => {
        // 边缘情况 1：场景尺寸 > 本机画质档上限 ⇒ 该卡禁用并附理由。
        // 因为 startNewGame 的 clampMapSize 会**静默**改小尺寸 ⇒ 场景就"不固定"了。
        const ok = allowedMapSizes(quality.maxMapSize).includes(s.config.size);
        return {
          value: s.id,
          title: s.name,
          sub: SCENARIO_SUB[s.id] ?? s.sub,
          hint: SCENARIO_HINT[s.id] ?? s.sub,
          disabled: !ok,
          disabledReason: '本机画质档不支持该尺寸',
        };
      }),
      { value: null, title: '自由对局', sub: '自定义', hint: FREE_HINT },
    ],
    cfg.scenario ?? null,
    (v) => applyScenario(v),
  );
  scenarioSeg.el.setAttribute('aria-label', '试玩场景');
  form.insertBefore(field('试玩场景', scenarioSeg.el, scenarioHint), sizeField);

  /** 进入场景前的那一份自由对局设置（只存这 5 个字段）。 */
  let freeSnapshot: {
    size: MapSize;
    layout: MapLayout;
    opponents: number;
    difficulty: Difficulty;
    seed: number;
  } | null = null;

  /** 锁定 / 解锁被场景接管的 5 行（G-2：种子行是 input+reroll，须**两个都**禁）。 */
  function setRowsLocked(locked: boolean): void {
    sizeSeg.setDisabled(locked);
    layoutSeg.setDisabled(locked);
    oppSeg.setDisabled(locked);
    diffSeg.setDisabled(locked);
    seedInput.disabled = locked;
    reroll.disabled = locked;
    const setDesc = (el: Element): void => {
      if (locked) el.setAttribute('aria-describedby', SCENARIO_HINT_ID);
      else el.removeAttribute('aria-describedby');
    };
    // G-4：5 行都挂 `aria-describedby` 指到 scenarioHint。**行容器 + 行内每个可点项**都挂
    //（禁用项不可聚焦时，读屏按"组"播报容器上的描述；可聚焦时逐项也能读到）。
    for (const row of [sizeSeg.el, layoutSeg.el, oppSeg.el, diffSeg.el]) {
      setDesc(row);
      for (const b of row.querySelectorAll('.ss-seg-item')) setDesc(b);
    }
    for (const el of [seedInput, reroll]) setDesc(el);
  }

  function applyScenario(v: string | null): void {
    if (v === null) {
      // 自由对局：恢复「进入场景前」那一份 cfg（**不是**重置 DEFAULT_CONFIG）——
      // 这是 playtest-scenarios.md §4 A1 的「自由对局逐字节一致」回滚底线。
      if (freeSnapshot) {
        cfg.size = freeSnapshot.size;
        cfg.layout = freeSnapshot.layout;
        cfg.opponents = freeSnapshot.opponents;
        cfg.difficulty = freeSnapshot.difficulty;
        cfg.seed = freeSnapshot.seed;
        sizeSeg.setValue(cfg.size);
        layoutSeg.setValue(cfg.layout);
        oppSeg.setValue(cfg.opponents);
        diffSeg.setValue(cfg.difficulty);
        seedInput.value = String(cfg.seed);
        layoutHint.textContent = LAYOUTS[cfg.layout].desc;
      }
      delete cfg.scenario;
      setRowsLocked(false);
      scenarioHint.textContent = FREE_HINT;
    } else {
      const def = SCENARIO_BY_ID[v];
      if (!def) return;
      // 只在「当前是自由对局」时拍快照 ⇒ 自由→场景→场景 不会把场景值当成"自由配置"存下来。
      if (!cfg.scenario) {
        freeSnapshot = {
          size: cfg.size,
          layout: cfg.layout,
          opponents: cfg.opponents,
          difficulty: cfg.difficulty,
          seed: cfg.seed,
        };
      }
      const o = scenarioGenOptions(def);
      cfg.size = o.size ?? cfg.size;
      cfg.layout = o.layout ?? cfg.layout;
      cfg.opponents = o.opponents ?? cfg.opponents;
      cfg.difficulty = o.difficulty ?? cfg.difficulty;
      cfg.seed = o.seed ?? cfg.seed;
      cfg.scenario = def.id;
      sizeSeg.setValue(cfg.size);
      layoutSeg.setValue(cfg.layout);
      oppSeg.setValue(cfg.opponents);
      diffSeg.setValue(cfg.difficulty);
      seedInput.value = String(cfg.seed);
      layoutHint.textContent = LAYOUTS[cfg.layout].desc;
      setRowsLocked(true);
      scenarioHint.textContent = SCENARIO_HINT[def.id] ?? def.sub;
    }
    syncDiffHint();
    sync();
  }

  /* ---------------- 右侧：预览 ---------------- */

  const preview = document.createElement('div');
  preview.className = 'ss-preview';

  const canvas = document.createElement('canvas');
  canvas.id = 'ss-map';
  preview.appendChild(canvas);

  const legend = document.createElement('div');
  legend.className = 'ss-legend';
  preview.appendChild(legend);

  const summary = document.createElement('div');
  summary.className = 'ss-summary';
  preview.appendChild(summary);

  /* ---------------- 底部按钮 ---------------- */

  const actions = document.createElement('div');
  actions.className = 'ss-actions';

  const startBtn = document.createElement('button');
  startBtn.className = 'btn primary big';
  startBtn.textContent = '开始新游戏';
  startBtn.addEventListener('click', () => {
    close();
    opts.onStart({ ...cfg });
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
  note.textContent = opts.hasSave ? '开始新游戏会覆盖当前存档' : '进度会自动保存在本机浏览器里';
  actions.appendChild(note);

  preview.appendChild(actions);

  root.append(panel, preview);
  host.appendChild(root);

  /* ---------------- 预览渲染 ---------------- */

  let timer = 0;
  function sync(): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(drawPreview, 120);
  }

  function drawPreview(): void {
    let state;
    try {
      state = createGame({ ...cfg });
    } catch {
      summary.textContent = '这组设置生成失败，换一个种子试试。';
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

    const factions = FACTION_ORDER.slice(0, 1 + cfg.opponents);
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
      line('地图', `${MAP_SIZES[cfg.size].name} · ${LAYOUTS[cfg.layout].name} · ${m.width}×${m.height}`),
      line('据点', `共 ${townCount} 座（${townCount - factions.length} 座中立）`),
      line('起始英雄', `${heroCount} 位`),
      line('宝物 / 野怪', `${countKind(state, 'artifact')} / ${countKind(state, 'wanderingMonster')}`),
    );
  }

  function close(): void {
    window.clearTimeout(timer);
    root.remove();
  }

  sync();
  return { close };
}

/* ---------------- 小工具 ---------------- */

function randomSeed(): number {
  return Math.floor(Math.random() * 1e9);
}

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
  /** 卡片在本机不可用（如场景尺寸超出当前画质档上限）⇒ 真 disabled。 */
  disabled?: boolean;
  /** 不可用时的理由（写进 `title`，读屏也能读到）。 */
  disabledReason?: string;
}

/** `segment()` 的句柄（G-1）：行本身 + 锁定 / 回填两件事，外露给场景行用。 */
interface SegmentHandle<T> {
  el: HTMLElement;
  setDisabled(disabled: boolean): void;
  setValue(value: T): void;
}

/* §14.1 表的「逐字」文案（权威 = design/ux/in-game-ia.md §14.1）。
 * 不直接复用 `scenarios.ts` 的 `sub`：那写的是设计者的意图，这里的 `sub` 是给玩家的**一行速览**。 */
const SCENARIO_SUB: Record<string, string> = {
  tutorial: '无对手 · ≤10 分钟',
  duel: '1 对手 · 20–30 分钟',
};
/** §14.1：`scenarioHint` = 该场景的 `hint` **+ 预期时长**（team-lead 裁定）。
 *  ⚠️ 卡片 `sub` 的时长**仍保留** —— 规格本就是 `sub`（速览）/ `hint`（选中说明）**两列**，
 *  "并进 hint"不等于"从 sub 移走"。教学场的规格 `hint` 原文**已内含**「10 分钟」；
 *  对决场原文不含 ⇒ 按规格补上预期时长（故这里不再统一追加，避免教学场出现两遍"10 分钟"）。 */
const SCENARIO_HINT: Record<string, string> = {
  tutorial: '10 分钟，学会走路。 无对手，只有你能走的几条路。',
  duel: '有人会来找你。 你发育的时候，他也在发育。 预计 20–30 分钟。',
};
const FREE_HINT = '自己定尺寸 / 布局 / 对手 / 难度 / 种子 —— 和以前一样。';
/** §14.1 nit：id 加 `ss-` 前缀（与 `.ss-*` 命名族一致，team-lead 裁定）。 */
const SCENARIO_HINT_ID = 'ss-scenario-hint';

function segment<T>(items: SegItem<T>[], current: T, onPick: (v: T) => void): SegmentHandle<T> {
  const row = document.createElement('div');
  row.className = 'ss-seg';
  // G-4：一组单选卡 = 一个 radiogroup（role=radio + aria-checked），不是"一排按钮"。
  // ⚠️ 已知缺口（team-lead 裁定：保留语义、登记不阻塞）：严格 ARIA 单选组还需 **roving tabindex
  //    + 方向键**导航。本项目用原生 `<button>`（可 Tab 聚焦）保留语义，未实现 roving ——
  //    `STRICT=1 npm run audit:touch` 已过 ⇒ 不阻塞、不在本轮做。
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
    b.title = item.disabled ? (item.disabledReason ?? item.title) : (item.hint ?? item.title);
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
    if (item.disabled) {
      b.disabled = true;
      b.classList.add('off');
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

  function setDisabled(disabled: boolean): void {
    for (const b of buttons) {
      // 真 `disabled`（G-4：不是仅视觉置灰）；`aria-disabled` 供读屏。
      b.disabled = disabled;
      b.setAttribute('aria-disabled', String(disabled));
    }
  }

  return { el: row, setDisabled, setValue };
}
