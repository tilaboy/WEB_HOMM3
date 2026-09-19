export interface ModalAction {
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick: (close: () => void) => void;
}

export interface ModalOptions {
  title: string;
  body: (Node | string)[];
  actions: ModalAction[];
  /** 宽版面板（城镇管理用） */
  wide?: boolean;
  /**
   * 出口固定在左上角（R3「出口不滚动」）。
   * 提供时标题行变成**不随内容滚动**的头部，含一个「返回」按钮；内容区自行滚动。
   * 起因：城镇面板的「关闭」原本在底部 `.actions` 里，而 `.modal{overflow-y:auto}`
   * ⇒ 出口随内容滚走，长内容要滚到底才能关（用户反馈 F4）。
   */
  headClose?: boolean;
}

let root: HTMLElement | null = null;

function ensureRoot(parent: HTMLElement): HTMLElement {
  if (!root) {
    root = document.createElement('div');
    root.id = 'modal-root';
  }
  if (root.parentElement !== parent) parent.appendChild(root);
  return root;
}

export function showModal(parent: HTMLElement, opts: ModalOptions): void {
  const host = ensureRoot(parent);
  host.innerHTML = '';

  const box = document.createElement('div');
  box.className = 'modal' + (opts.wide ? ' wide' : '');

  if (opts.headClose) {
    const bar = document.createElement('div');
    bar.className = 'modal-head';
    const back = document.createElement('button');
    back.className = 'btn tiny';
    back.textContent = '返回';
    back.setAttribute('aria-label', '关闭面板');
    back.addEventListener('click', () => closeModal());
    const title = document.createElement('h2');
    title.textContent = opts.title;
    bar.append(back, title);
    box.appendChild(bar);
  } else {
    const h = document.createElement('h2');
    h.textContent = opts.title;
    box.appendChild(h);
  }

  for (const node of opts.body) {
    if (typeof node === 'string') {
      const p = document.createElement('p');
      p.textContent = node;
      box.appendChild(p);
    } else {
      box.appendChild(node);
    }
  }

  // 只有在真的给了底部动作时才建 `.actions`（headClose 形态下出口在头部，底部留空）。
  if (opts.actions.length) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    const close = () => closeModal();
    for (const a of opts.actions) {
      const b = document.createElement('button');
      b.className = 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '');
      b.textContent = a.label;
      b.addEventListener('click', () => a.onClick(close));
      actions.appendChild(b);
    }
    box.appendChild(actions);
  }

  host.appendChild(box);
}

export function closeModal(): void {
  if (root && root.parentElement) root.parentElement.removeChild(root);
}

export function isModalOpen(): boolean {
  return !!root && !!root.parentElement;
}

/* ---------------- info popup ---------------- */

let popup: HTMLElement | null = null;

export function showInfoPopup(parent: HTMLElement, sx: number, sy: number, title: string, desc: string): void {
  hideInfoPopup();
  popup = document.createElement('div');
  popup.id = 'popup';
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = title;
  const d = document.createElement('div');
  d.className = 'd';
  d.textContent = desc;
  popup.appendChild(t);
  popup.appendChild(d);
  parent.appendChild(popup);
  const w = 200;
  const h = popup.offsetHeight || 60;
  const maxX = parent.clientWidth - w - 8;
  const maxY = parent.clientHeight - h - 8;
  popup.style.left = `${Math.max(8, Math.min(sx + 12, maxX))}px`;
  popup.style.top = `${Math.max(8, Math.min(sy + 12, maxY))}px`;
}

export function hideInfoPopup(): void {
  if (popup && popup.parentElement) popup.parentElement.removeChild(popup);
  popup = null;
}

/** 构造一张「损失预估」小表格。 */
export function lossTable(rows: [string, string][]): HTMLElement {
  const table = document.createElement('table');
  table.className = 'est';
  for (const [k, v] of rows) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = k;
    const td2 = document.createElement('td');
    td2.textContent = v;
    tr.appendChild(td1);
    tr.appendChild(td2);
    table.appendChild(tr);
  }
  return table;
}
