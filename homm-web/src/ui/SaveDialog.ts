import type { GameState } from '../core/types.js';
import { dayOfWeek, weekOf } from '../core/game/calendar.js';
import {
  LOAD_ORDER,
  MANUAL_SLOTS,
  saveToSlot,
  slotInfo,
  type SaveSlot,
  type SlotInfo,
} from '../save/persistence.js';
import { showModal } from './Dialogs.js';

/**
 * 存档 / 读档面板（§30.6，U4）。
 *
 * ## 为什么自己渲染而不是用 `showModal` 的 actions
 * 覆盖确认与读档确认都必须是**面板内的一层**：`showModal()` 每次调用会
 * `host.innerHTML = ''`，借它再弹一个确认框会把列表（连着刚点的那一行）整个抹掉。
 * 所以确认做成 `.sd-ask` 覆盖层，`取消` 之后列表连同滚动位置都还在。
 *
 * ## 两个模式的行数不一样
 * 存档 = **8 行**（自动档不作为写入目标，H3 的存盘页也没有它）；
 * 读档 = **9 行**（自动 + 1–8）。空档在存档模式里是"可写目标"，在读档模式里置灰。
 *
 * ## 档名只有一个来源
 * `第 {weekOf(day)} 周第 {dayOfWeek(day)} 天` —— 调 `calendar.ts`，不在这里算，
 * 也不印 `state.day`（印裸天数玩家读不出"第几周"）。允许重名：同一天存两个档，
 * 两行都叫「第 2 周第 1 天」，靠左侧槽号与右侧时间区分。
 */

export type SaveMode = 'save' | 'load';

export interface SaveDialogOptions {
  /** 读档：把某一档灌回世界（main 负责复位镜头 / 重建派生状态）。 */
  onLoad: (slot: SaveSlot) => void;
  /** 写档成功（含覆盖）后的提示；面板自己先关掉。 */
  onSaved: (slot: SaveSlot) => void;
  /** 写档失败（配额满 / 存储不可用）：面板不关，让人看见。 */
  onError?: (message: string) => void;
}

interface Ask {
  kind: 'overwrite' | 'load';
  slot: SaveSlot;
  /** 覆盖时用来显示"覆盖哪一档"。 */
  info: SlotInfo;
}

const WEEK_LABEL = (day: number): string => `第 ${weekOf(day)} 周第 ${dayOfWeek(day)} 天`;

/** 槽号：自动档「自」，手动档 1–8。 */
export function slotLabel(slot: SaveSlot): string {
  if (slot === 'auto') return '自';
  if (slot === 'resume') return '续';
  return slot.slice(4);
}

/** 槽位的中文名（提示语用）：「自动档」/「档位 3」。 */
export function slotTitle(slot: SaveSlot): string {
  return slot === 'auto' ? '自动档' : `档位 ${slot.slice(4)}`;
}

function fmtTime(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export class SaveDialog {
  private state: GameState | null = null;
  private mode: SaveMode = 'save';
  private ask: Ask | null = null;
  private msg = '';

  constructor(private host: HTMLElement, private opts: SaveDialogOptions) {}

  open(mode: SaveMode, state: GameState): void {
    this.mode = mode;
    this.state = state;
    this.ask = null;
    this.msg = '';
    this.render();
  }

  isOpen(): boolean {
    return !!document.querySelector('.modal.saves');
  }

  /* ---------------- 渲染 ---------------- */

  private render(): void {
    if (!this.state) return;
    const slots = this.mode === 'save' ? MANUAL_SLOTS : LOAD_ORDER;
    const infos = slots.map((slot) => slotInfo(slot));
    const stale = infos.filter((i) => i.status === 'stale').length;

    const body = document.createElement('div');
    body.className = 'sd-body';
    body.dataset.mode = this.mode;
    body.dataset.ask = this.ask ? this.ask.kind : '';
    body.dataset.askSlot = this.ask ? this.ask.slot : '';
    body.dataset.msg = this.msg;

    const list = document.createElement('div');
    list.className = 'sd-list';
    for (const info of infos) list.append(this.rowEl(info));
    body.append(list);

    if (stale && this.mode === 'load') {
      const note = document.createElement('div');
      note.className = 'sd-note';
      note.textContent = `旧存档已随版本更新失效（${stale} 档）`;
      body.append(note);
    }
    if (this.msg) {
      const msg = document.createElement('div');
      msg.className = 'sd-msg';
      msg.dataset.reason = 'quota';
      msg.textContent = this.msg;
      body.append(msg);
    }
    if (this.ask) body.append(this.askEl(this.ask));

    showModal(this.host, {
      title: this.mode === 'save' ? '存档' : '读档',
      body: [body],
      actions: [],
      headClose: true,
      className: 'saves',
    });
  }

  private rowEl(info: SlotInfo): HTMLElement {
    const row = document.createElement('button');
    row.className = 'slot-row';
    row.dataset.slot = info.slot;
    row.dataset.status = info.status;
    row.dataset.day = String(info.day);

    const n = document.createElement('span');
    n.className = 'sd-n';
    n.textContent = slotLabel(info.slot);

    const main = document.createElement('span');
    main.className = 'sd-main';
    const title = document.createElement('b');
    const sub = document.createElement('i');

    const time = document.createElement('span');
    time.className = 'sd-time';

    if (info.status === 'ok') {
      title.textContent = WEEK_LABEL(info.day);
      sub.textContent = [info.heroName, info.difficultyName].filter(Boolean).join(' · ');
      time.textContent = fmtTime(info.savedAt);
    } else if (info.status === 'stale') {
      /* 只失效这一档（§30.5）：其余 8 行照常可读，不许一个坏档拖死列表。 */
      title.textContent = '旧版本存档';
      title.classList.add('dim');
      sub.textContent = '已随版本更新失效';
      time.textContent = fmtTime(info.savedAt);
      row.disabled = true;
    } else if (info.status === 'broken') {
      title.textContent = '存档已损坏';
      title.classList.add('dim');
      sub.textContent = '无法读取';
      row.disabled = true;
    } else {
      title.textContent = this.mode === 'save' ? '空档位' : '空';
      title.classList.add('dim');
    }

    main.append(title, sub);
    row.append(n, main, time);

    /* 读档模式里空档不可点；存档模式里空档正是"选一个新位置"，保持可点。 */
    if (this.mode === 'load' && info.status === 'empty') row.disabled = true;

    row.addEventListener('click', () => this.clickRow(info));
    return row;
  }

  private askEl(ask: Ask): HTMLElement {
    const box = document.createElement('div');
    box.className = 'sd-ask';

    const q = document.createElement('p');
    q.textContent =
      ask.kind === 'overwrite'
        ? `覆盖「${slotTitle(ask.slot)} · ${WEEK_LABEL(ask.info.day)}」？`
        : '当前进度将丢弃，继续？';
    box.append(q);

    const btns = document.createElement('div');
    btns.className = 'sd-ask-btns';
    const cancel = document.createElement('button');
    cancel.className = 'btn tiny';
    cancel.dataset.askCancel = '1';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => {
      this.ask = null;
      this.render();
    });
    const ok = document.createElement('button');
    ok.className = 'btn tiny primary';
    ok.dataset.askOk = '1';
    ok.textContent = ask.kind === 'overwrite' ? '覆盖' : '载入';
    ok.addEventListener('click', () => this.confirm(ask));
    btns.append(cancel, ok);
    box.append(btns);
    return box;
  }

  /* ---------------- 交互 ---------------- */

  private clickRow(info: SlotInfo): void {
    if (info.status === 'stale' || info.status === 'broken') return;

    if (this.mode === 'load') {
      if (info.status !== 'ok') return;
      this.ask = { kind: 'load', slot: info.slot, info };
      this.msg = '';
      this.render();
      return;
    }

    /* 存档模式：已占用先问，空档直接写。 */
    if (info.status === 'ok') {
      this.ask = { kind: 'overwrite', slot: info.slot, info };
      this.msg = '';
      this.render();
      return;
    }
    this.write(info.slot);
  }

  private confirm(ask: Ask): void {
    this.ask = null;
    if (ask.kind === 'load') {
      const slot = ask.slot;
      this.closeHost();
      this.opts.onLoad(slot);
      return;
    }
    this.write(ask.slot);
  }

  private write(slot: SaveSlot): void {
    if (!this.state) return;
    const r = saveToSlot(slot, this.state);
    if (!r.ok) {
      /* 配额满必须可见（§30.5）：面板不关，错误留在列表下方。 */
      this.msg = r.message ?? '存档失败';
      this.render();
      this.opts.onError?.(this.msg);
      return;
    }
    this.msg = '';
    this.closeHost();
    this.opts.onSaved(slot);
  }

  /** 关掉 `#modal-root`（`showModal` 的唯一宿主），不额外建第二套弹层。 */
  private closeHost(): void {
    const root = this.host.querySelector('#modal-root');
    if (root && root.parentElement) root.parentElement.removeChild(root);
  }
}
