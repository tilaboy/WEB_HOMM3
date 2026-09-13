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

  const h = document.createElement('h2');
  h.textContent = opts.title;
  box.appendChild(h);

  for (const node of opts.body) {
    if (typeof node === 'string') {
      const p = document.createElement('p');
      p.textContent = node;
      box.appendChild(p);
    } else {
      box.appendChild(node);
    }
  }

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
