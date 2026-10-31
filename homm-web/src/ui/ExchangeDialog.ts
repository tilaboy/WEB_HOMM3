import type { ArtifactSlot, GameState, Hero } from '../core/types.js';
import { ARTIFACTS, ARTIFACT_SLOTS } from '../core/data/artifacts.js';
import { MAX_STACKS, getUnit } from '../core/data/units.js';
import { factionColor } from '../core/data/factions.js';
import { effectivePrimary } from '../core/game/hero.js';
import {
  backpackOf,
  canMeet,
  equippedOf,
  exchangeArmy,
  exchangeArtifact,
  resolveAmount,
  type AmountChoice,
} from '../core/game/exchange.js';
import { showModal, closeModal } from './Dialogs.js';
import { getAtlas } from '../render/atlas.js';
import { unitMapFrame, warnMissingFrame } from '../render/unitFrames.js';

/**
 * 会面交换面板（§9.2，760×352，左 340 / 中 40 / 右 340）。
 *
 * ## 为什么是 40px「紧凑行」，不复用战斗兵牌
 * 5 行 × 48 = 240 + 装备行 36 + 头部 56 = **332 > 320**（矮机可用高）⇒ 直接溢出。
 * 40px 行：200 + 36 + 56 = 292 ✓。矮机（≤340px）再降一档：32px 行 / 26px 槽，
 * 由 CSS 变量切换，**同一份 DOM**（两套 DOM 必然会有一边没人测）。
 *
 * ## 交互（拇指：点选 → 点目标，不做拖拽）
 * - 点自己某栈 = 选中；**再点一次同一栈** = 在装备行位置弹出「全部 / 一半 / 1」
 *   （不放到行下方：那会盖住下一行，矮机上等于点不到下一行）。
 * - 点对面：同兵种 = 合并 / 空槽 = 移入 / 异兵种 = **整队互换**（半队互换无意义，拒绝）。
 * - 满编（5 栈、无同兵种）：对面所有行红描边 + 头部「目标已满」，点击**无效**（不弹 toast）。
 * - 宝物：点自己的宝物 → 点对面同槽空位 = 装备；点对面「背包」= 转进背包。
 *
 * ## 面板自己不做规则
 * 三条交换规则与"零写入拒绝"都在 `core/game/exchange.ts`。这里只负责"点了谁"、
 * "把哪几个参数传下去"。面板与核心各写一遍规则，必然出现"面板说能换、核心说不能"。
 */

type Side = 'a' | 'b';
type Kind = 'army' | 'art' | 'bag';

interface Selection {
  side: Side;
  kind: Kind;
  /** army: 行下标；art: 槽；bag 不用 */
  idx: number;
  artifactId?: string;
}

export class ExchangeDialog {
  private state: GameState | null = null;
  private aId = '';
  private bId = '';
  private sel: Selection | null = null;
  private splitOpen = false;
  private amount: AmountChoice = 'all';
  private msg = '';
  /** 上一次操作的结果码，探针读它（`data-reason`）。 */
  private reason = '';
  private onChange: (() => void) | null = null;

  constructor(private host: HTMLElement) {}

  open(state: GameState, aId: string, bId: string, onChange?: () => void): void {
    const meet = canMeet(state, aId, bId);
    if (!meet.ok) return;
    this.state = state;
    this.aId = aId;
    this.bId = bId;
    this.sel = null;
    this.splitOpen = false;
    this.amount = 'all';
    this.msg = '';
    this.reason = '';
    this.onChange = onChange ?? null;
    this.render();
  }

  /** 当前是否开着（main.ts 用来避免重复打开）。 */
  isOpen(): boolean {
    return !!document.querySelector('.modal.exchange');
  }

  /* ---------------- 渲染 ---------------- */

  private render(): void {
    const state = this.state;
    const a = state?.heroes[this.aId];
    const b = state?.heroes[this.bId];
    if (!state || !a || !b) {
      closeModal();
      return;
    }

    const body = document.createElement('div');
    body.className = 'ex';
    body.dataset.a = a.id;
    body.dataset.b = b.id;
    body.dataset.reason = this.reason;
    body.dataset.msg = this.msg;
    body.append(this.sideEl(state, a, 'a'), this.midEl(a, b), this.sideEl(state, b, 'b'));

    showModal(this.host, {
      title: this.titleOf(a, b),
      body: [body],
      /* 出口放在**头部**（`headClose`）：底部 `.actions` 要再吃 46px，
         而 352 高的盒子里每一行都已经算过了 —— 矮机直接溢出。
         头部那条 33px 本来就要画标题，按钮是**零额外高度**。 */
      actions: [],
      headClose: true,
      className: 'exchange',
    });
  }

  private titleOf(a: Hero, b: Hero): string {
    if (this.msg) return `会面交换 · ${this.msg}`;
    if (!this.sel) return `会面交换 · ${a.name} ⇄ ${b.name}`;
    const hero = this.sel.side === 'a' ? a : b;
    if (this.sel.kind === 'army') {
      const st = hero.army[this.sel.idx];
      if (!st) return '会面交换';
      const n = `已选 ${safeUnit(st.unitTypeId)?.name ?? st.unitTypeId} ×${st.count}`;
      return this.splitOpen ? `${n} · 选数量，再点对面` : `${n} · 再点自己可分批`;
    }
    if (this.sel.kind === 'art') {
      return `已选 ${ARTIFACTS[this.sel.artifactId ?? '']?.name ?? '宝物'} · 点对面同槽或背包`;
    }
    return '会面交换';
  }

  private sideEl(state: GameState, hero: Hero, side: Side): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'ex-side';
    wrap.dataset.side = side;

    /* 头部：肖像 + 名 + 职业/等级（高度由 CSS 变量控，矮机 40px） */
    const head = document.createElement('div');
    head.className = 'ex-head';
    const face = document.createElement('div');
    face.className = 'ex-face';
    face.textContent = hero.name.slice(0, 1);
    face.style.borderColor = factionColor(hero.owner);
    const meta = document.createElement('div');
    meta.className = 'ex-meta';
    const nm = document.createElement('div');
    nm.className = 'ex-name';
    nm.textContent = hero.name;
    const sub = document.createElement('div');
    sub.className = 'ex-sub';
    const p = effectivePrimary(hero);
    sub.textContent = `${hero.heroClass} · Lv.${hero.level} · 攻${p.attack} 防${p.defense}`;
    meta.append(nm, sub);
    head.append(face, meta);
    /* 满编标记：只在"对面选中了东西、且这边塞不进去"时出现（不常驻，避免噪音） */
    if (!this.canReceive(state, hero, side)) {
      const full = document.createElement('div');
      full.className = 'ex-full';
      full.textContent = '目标已满';
      head.append(full);
    }
    wrap.append(head);

    /* 部队 5 行（空槽也画，否则玩家不知道还能放几个） */
    const army = document.createElement('div');
    army.className = 'ex-army';
    for (let i = 0; i < 5; i++) {
      army.append(this.rowEl(hero, side, i));
    }
    wrap.append(army);

    /* 装备行：6 槽 + 背包 */
    const arts = document.createElement('div');
    arts.className = 'ex-arts';
    if (this.splitOpen && this.sel?.side === side && this.sel.kind === 'army') {
      arts.classList.add('ex-split');
      for (const [label, val] of [
        ['全部', 'all'],
        ['一半', 'half'],
        ['1', '1'],
      ] as [string, AmountChoice][]) {
        const btn = document.createElement('button');
        btn.className = 'ex-amt' + (this.amount === val ? ' on' : '');
        btn.dataset.amt = String(val);
        btn.textContent = label;
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.amount = val;
          this.splitOpen = false;
          this.msg = `数量：${label} · 点对面落位`;
          this.reason = 'amount';
          this.render();
        });
        arts.append(btn);
      }
    } else {
      const eq = equippedOf(hero);
      for (const slot of ARTIFACT_SLOTS) {
        arts.append(this.slotEl(side, slot.slot, eq[slot.slot]));
      }
      const bag = document.createElement('button');
      bag.className = 'ex-bag';
      bag.dataset.side = side;
      bag.dataset.kind = 'bag';
      bag.textContent = `背包 ${backpackOf(hero).length}`;
      bag.title = '把选中的宝物放进这位英雄的背包（不占用槽）';
      bag.addEventListener('click', () => this.onBag(side));
      arts.append(bag);
    }
    wrap.append(arts);

    return wrap;
  }

  private rowEl(hero: Hero, side: Side, i: number): HTMLElement {
    const st = hero.army[i];
    const row = document.createElement('button');
    row.className = 'ex-row';
    row.dataset.side = side;
    row.dataset.kind = 'army';
    row.dataset.idx = String(i);
    if (!st) {
      row.classList.add('empty');
      /* 空槽默认不可点（避免误触"选了个空"）；只有对面已选中一栈时才成为落点。 */
      const crossSel = !!this.sel && this.sel.side !== side && this.sel.kind === 'army';
      row.disabled = !crossSel;
      if (crossSel) row.classList.add('drop');
      const t = document.createElement('span');
      t.className = 'ex-empty-t';
      t.textContent = '空';
      row.append(t);
      row.addEventListener('click', () => this.onArmy(side, i));
      return row;
    }

    row.dataset.type = st.unitTypeId;
    row.dataset.count = String(st.count);

    const art = this.unitArtEl(st.unitTypeId);
    const nm = document.createElement('span');
    nm.className = 'ex-uname';
    nm.textContent = safeUnit(st.unitTypeId)?.name ?? st.unitTypeId;
    const ct = document.createElement('span');
    ct.className = 'ex-count';
    ct.textContent = `×${st.count}`;
    row.append(art, nm, ct);

    if (this.isSelected(side, 'army', i)) row.classList.add('on');
    /* 满编时"点不动"的视觉：对面每行红描边（§9.2「该行红描边 + 目标已满」） */
    if (this.sel && this.sel.side !== side && !this.canReceive(this.state!, hero, side)) {
      row.classList.add('blocked');
    }
    row.addEventListener('click', () => this.onArmy(side, i));
    return row;
  }

  private slotEl(side: Side, slot: ArtifactSlot, id: string | undefined): HTMLElement {
    const b = document.createElement('button');
    b.className = 'ex-slot';
    b.dataset.side = side;
    b.dataset.kind = 'art';
    b.dataset.slot = slot;
    const def = id ? ARTIFACTS[id] : null;
    if (def) {
      b.dataset.artifact = def.id;
      b.classList.add('filled');
      b.textContent = def.name.slice(0, 1);
      b.title = `${def.name}：${def.desc}`;
    } else {
      const label = ARTIFACT_SLOTS.find((s) => s.slot === slot)?.label ?? '';
      b.classList.add('empty');
      b.textContent = label.slice(0, 1);
      b.title = `${label}（空）`;
    }
    if (this.sel?.kind === 'art' && this.sel.side === side && this.sel.idx === ARTIFACT_SLOTS.findIndex((s) => s.slot === slot)) {
      b.classList.add('on');
    }
    b.addEventListener('click', () => this.onArt(side, slot, def?.id));
    return b;
  }

  private midEl(a: Hero, b: Hero): HTMLElement {
    const mid = document.createElement('div');
    mid.className = 'ex-mid';
    const sw = document.createElement('div');
    sw.className = 'ex-swap';
    sw.textContent = '⇄';
    sw.title = '点选一侧，再点另一侧落位';
    mid.append(sw);
    const mv = document.createElement('div');
    mv.className = 'ex-mp';
    mv.textContent = `${Math.floor(a.movePoints)}/${Math.floor(b.movePoints)}`;
    mv.title = '两位英雄的剩余移动力（会面本身不消耗）';
    mid.append(mv);
    return mid;
  }

  /* ---------------- 交互 ---------------- */

  private onArmy(side: Side, i: number): void {
    const state = this.state!;
    const hero = state.heroes[side === 'a' ? this.aId : this.bId]!;
    const toId = side === 'a' ? this.aId : this.bId;

    /* 空槽：只有在"另一边已经选中一栈"时才是落点；否则这一格什么都不做。 */
    if (!hero.army[i]) {
      if (this.sel && this.sel.side !== side && this.sel.kind === 'army') {
        const fromId = this.sel.side === 'a' ? this.aId : this.bId;
        const r = exchangeArmy(state, fromId, this.sel.idx, toId, i, this.amount);
        this.after(r.ok, r.reason, r.message);
      }
      return;
    }

    // 首次点 = 选中；再点同一行 = 打开分兵三键（§9.2）
    if (this.isSelected(side, 'army', i)) {
      this.splitOpen = !this.splitOpen;
      this.amount = 'all';
      this.reason = 'select';
      this.render();
      return;
    }
    if (this.sel && this.sel.side !== side) {
      const fromId = this.sel.side === 'a' ? this.aId : this.bId;
      const r = exchangeArmy(state, fromId, this.sel.idx, side === 'a' ? this.aId : this.bId, i, this.amount);
      this.after(r.ok, r.reason, r.message);
      return;
    }
    this.sel = { side, kind: 'army', idx: i };
    this.splitOpen = false;
    this.amount = 'all';
    this.msg = '';
    this.reason = 'select';
    this.splitOpen = false;
    this.render();
  }

  private onArt(side: Side, slot: ArtifactSlot, id?: string): void {
    const state = this.state!;
    if (this.sel && this.sel.kind === 'art' && this.sel.side !== side && this.sel.artifactId) {
      // 目标槽必须同类且空 —— 面板不猜"要不要挤掉别人"
      if (id) {
        this.after(false, 'target-full', '那个槽已被占用');
        return;
      }
      const fromId = this.sel.side === 'a' ? this.aId : this.bId;
      const r = exchangeArtifact(state, fromId, this.sel.artifactId, side === 'a' ? this.aId : this.bId);
      this.after(r.ok, r.reason, r.message);
      return;
    }
    if (!id) {
      this.msg = '这个槽是空的';
      this.reason = 'select';
      this.render();
      return;
    }
    const idx = ARTIFACT_SLOTS.findIndex((s) => s.slot === slot);
    this.sel = { side, kind: 'art', idx, artifactId: id };
    this.splitOpen = false;
    this.msg = '';
    this.reason = 'select';
    this.render();
  }

  private onBag(side: Side): void {
    const state = this.state!;
    if (!this.sel || this.sel.kind !== 'art' || this.sel.side === side || !this.sel.artifactId) {
      this.msg = '先选一件自己的宝物';
      this.reason = 'select';
      this.render();
      return;
    }
    const fromId = this.sel.side === 'a' ? this.aId : this.bId;
    const r = exchangeArtifact(state, fromId, this.sel.artifactId, side === 'a' ? this.aId : this.bId, {
      backpack: true,
    });
    this.after(r.ok, r.reason, r.message);
  }

  /**
   * 对面这个英雄还能不能接。
   *
   * ⚠️ 判的是**这一次要做的事**，不是"满没满"：满编 5 栈**整队互换照样合法**
   * （H3 同款）。只有"想塞进半队、又没有同兵种可合并"才是真的接不住。
   * 旧写法一律按"满编就红"判，结果面板画红而核心照换 —— 判据自己撒谎。
   */
  private canReceive(state: GameState, hero: Hero, _side: Side): boolean {
    if (!this.sel) return true;
    if (this.sel.kind === 'art') return true;
    if (this.sel.side === _side) return true;
    const from = state.heroes[this.sel.side === 'a' ? this.aId : this.bId];
    const src = from?.army[this.sel.idx];
    if (!src) return true;
    if (hero.army.length < MAX_STACKS) return true; // 有空槽 = 整栈移入
    if (resolveAmount(this.amount, src.count) === src.count) return true; // 整队互换
    return hero.army.some((s) => s.unitTypeId === src.unitTypeId); // 只能合并
  }

  private isSelected(side: Side, kind: Kind, idx: number): boolean {
    return !!this.sel && this.sel.side === side && this.sel.kind === kind && this.sel.idx === idx;
  }

  private after(ok: boolean, reason: string, msg: string): void {
    this.reason = reason;
    this.msg = msg;
    if (ok) {
      this.sel = null;
      this.splitOpen = false;
      this.amount = 'all';
      this.onChange?.();
    }
    this.render();
  }

  /* ---------------- 小件 ---------------- */

  private unitArtEl(id: string): HTMLElement {
    const name = unitMapFrame(id);
    const url = getAtlas().has(name) ? getAtlas().url(name) : '';
    if (!url) {
      warnMissingFrame(name, '会面面板');
      const chip = document.createElement('i');
      chip.className = 'ex-art chip';
      chip.style.background = safeUnit(id)?.body ?? '#7a6a4a';
      return chip;
    }
    const img = document.createElement('img');
    img.className = 'ex-art';
    img.src = url;
    img.alt = '';
    img.draggable = false;
    return img;
  }
}

function safeUnit(id: string) {
  try {
    return getUnit(id);
  } catch {
    return null;
  }
}
