import type { Difficulty, GameConfig, MapSize } from '../core/types.js';
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
import { createGame } from '../core/map/generator.js';
import { idx } from '../core/map/grid.js';

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
  h1.textContent = '英雄之歌';
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

  /* 地图尺寸 */
  const sizeRow = segment<MapSize>(
    SIZE_ORDER.map((id) => {
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
              : '大地图，四家混战才铺得开',
      };
    }),
    cfg.size,
    (v) => {
      cfg.size = v;
      sync();
    },
  );
  form.appendChild(field('地图尺寸', sizeRow));

  /* 电脑对手 */
  const oppRow = segment<number>(
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
      sync();
    },
  );
  form.appendChild(field('电脑对手', oppRow));

  /* 难度 */
  const diffRow = segment<Difficulty>(
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
  form.appendChild(field('难度', diffRow, '只影响电脑对手，不削弱你的部队'));

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
      line('地图', `${MAP_SIZES[cfg.size].name} · ${m.width}×${m.height}`),
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

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'ss-field';
  const lb = document.createElement('label');
  lb.textContent = label;
  wrap.appendChild(lb);
  wrap.appendChild(control);
  if (hint) {
    const h = document.createElement('div');
    h.className = 'ss-hint';
    h.textContent = hint;
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

function segment<T>(items: SegItem<T>[], current: T, onPick: (v: T) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ss-seg';
  const buttons: HTMLButtonElement[] = [];

  for (const item of items) {
    const b = document.createElement('button');
    b.className = 'ss-seg-item';
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
      for (const other of buttons) other.classList.remove('on');
      b.classList.add('on');
      onPick(item.value);
    });
    buttons.push(b);
    row.appendChild(b);
  }
  return row;
}
