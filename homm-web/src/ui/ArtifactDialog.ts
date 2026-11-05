import type { ArtifactSlot, GameState, Hero } from '../core/types.js';
import { ARTIFACTS, ARTIFACT_SLOTS } from '../core/data/artifacts.js';
import { effectivePrimary } from '../core/game/hero.js';
import { backpackOf, equippedOf, equipArtifact, unequipArtifact } from '../core/game/equip.js';
import { getUnit } from '../core/data/units.js';
import { factionColor, factionName } from '../core/data/factions.js';
import { getAtlas } from '../render/atlas.js';
import { unitMapFrame, warnMissingFrame } from '../render/unitFrames.js';
import { showModal, closeModal } from './Dialogs.js';

/**
 * 装备页（§9.1，U2 · 760×352）。
 *
 * ## 空间账（为什么是 240 / 260 / 240 而不是 288 / 400）
 * 规格写的是「左 288 / 右 400」，但 760 − 288 − 400 = **72**，装不下 96px 的纸娃娃；
 * 那一版是把左右区的内边距算重了。实装按**能被 44px 槽整除**的宽度切：
 *   左 240（肖像 88 + 四维 2×2）· 中 260（纸娃娃 96 + 两侧 44 槽）· 右 240（背包 4×44 + 3×6）
 * 760 = 240 + 260 + 240 + 2×10（栏间距）。高度 352：头 32 + 身体 320。
 *
 * ## 交互（拇指：点选 → 点目标，不做拖拽）
 * - 点背包里的一件 = 选中；点**同类槽** = 换上（旧的自动回背包，不拒绝）；
 *   点**异类槽** = 该槽转红 + 无效（**零写入**，规则在 `core/game/equip.ts`）。
 * - 点已装备的槽 = 选中；**双击** = 卸下（回背包）。
 * - 长按 400ms = 物品浮层（名 + 效果 + 槽类）。
 * - 四维变化用 `+2 / -2` 浮字，不弹窗（§9.1）。
 *
 * ## 面板不算属性
 * `effectivePrimary()` 是唯一口径（它现在只累计**已装备**的宝物）。
 * 这里只在操作前后各取一次快照做差值 —— 面板自己加一遍必然与战斗侧对不上。
 */

const SLOT_POS: ArtifactSlot[] = ['helm', 'weapon', 'shield', 'armor', 'boots', 'ring'];

interface Tip {
  id: string;
  x: number;
  y: number;
}

export class ArtifactDialog {
  private state: GameState | null = null;
  private heroId = '';
  private sel: string | null = null;
  private msg = '';
  private reason = '';
  private tip: Tip | null = null;
  private onChange: (() => void) | null = null;
  private pressTimer: number | null = null;
  /** 双击判定用（不用原生 `dblclick`：第一次点击就会整块重渲染，原节点随即脱离文档）。 */
  private lastTap: { slot: string; t: number } | null = null;

  constructor(private host: HTMLElement) {}

  open(state: GameState, heroId: string, onChange?: () => void): void {
    if (!state.heroes[heroId]) return;
    this.state = state;
    this.heroId = heroId;
    this.sel = null;
    this.msg = '';
    this.reason = '';
    this.tip = null;
    this.lastTap = null;
    this.onChange = onChange ?? null;
    this.render();
  }

  isOpen(): boolean {
    return !!document.querySelector('.modal.arts');
  }

  /* ---------------- 渲染 ---------------- */

  private render(): void {
    const state = this.state;
    const hero = state?.heroes[this.heroId];
    if (!state || !hero) {
      closeModal();
      return;
    }
    const body = document.createElement('div');
    body.className = 'arts-body';
    body.dataset.hero = hero.id;
    body.dataset.reason = this.reason;
    body.dataset.msg = this.msg;
    body.dataset.sel = this.sel ?? '';
    body.append(this.leftEl(hero), this.dollEl(hero), this.rightEl(hero));
    if (this.tip) body.append(this.tipEl(this.tip));

    const title = this.msg ? `装备 · ${this.msg}` : `装备 · ${hero.name}`;
    showModal(this.host, {
      title,
      body: [body],
      actions: [],
      /* 出口放头部：底部 actions 再吃 46px，352 高的盒子会被压破（与会面面板同一理由）。 */
      headClose: true,
      className: 'arts',
    });
  }

  private leftEl(hero: Hero): HTMLElement {
    const left = document.createElement('div');
    left.className = 'arts-left';

    const face = document.createElement('div');
    face.className = 'arts-face';
    const url = this.faceUrl(hero);
    if (url) face.style.backgroundImage = `url("${url}")`;
    face.style.borderColor = factionColor(hero.owner);
    left.append(face);

    left.append(row('arts-name', hero.name));
    left.append(row('arts-class', `${factionName(hero.owner)} · 英雄`));

    const p = effectivePrimary(hero);
    const stats = document.createElement('div');
    stats.className = 'arts-stats';
    const cells: [string, string, number][] = [
      ['attack', '攻击', p.attack],
      ['defense', '防御', p.defense],
      ['spellPower', '魔力', p.spellPower],
      ['knowledge', '知识', p.knowledge],
    ];
    for (const [key, label, v] of cells) {
      const c = document.createElement('div');
      c.className = 'stat';
      c.dataset.stat = key;
      const l = document.createElement('i');
      l.textContent = label;
      const n = document.createElement('b');
      n.textContent = String(v);
      c.append(l, n);
      stats.appendChild(c);
    }
    left.append(stats);
    return left;
  }

  private dollEl(hero: Hero): HTMLElement {
    const mid = document.createElement('div');
    mid.className = 'arts-mid';
    const doll = document.createElement('div');
    doll.className = 'arts-doll';

    const sil = document.createElement('div');
    sil.className = 'doll-sil';
    doll.append(sil);

    const eq = equippedOf(hero);
    for (const slot of SLOT_POS) {
      const def = ARTIFACT_SLOTS.find((s) => s.slot === slot);
      const id = eq[slot];
      const cell = document.createElement('button');
      cell.className = `art-slot s-${slot}` + (id ? ' filled' : '');
      cell.dataset.slot = slot;
      cell.dataset.filled = id ? '1' : '0';
      cell.setAttribute('aria-label', `${def?.label ?? slot}${id ? `：${ARTIFACTS[id]?.name ?? id}` : '：空'}`);
      cell.title = id ? `${ARTIFACTS[id]?.name ?? id} — ${ARTIFACTS[id]?.desc ?? ''}` : def?.label ?? slot;
      if (id) {
        const art = ARTIFACTS[id];
        cell.textContent = (art?.name ?? id).slice(0, 2);
        cell.style.borderColor = 'rgba(217,178,74,0.8)';
      } else {
        cell.textContent = (def?.label ?? slot).slice(0, 1);
      }
      this.bindItem(cell, id ?? '', () => this.clickSlot(slot, id));
      doll.appendChild(cell);
    }

    mid.append(doll);
    const hint = document.createElement('div');
    hint.className = 'arts-hint';
    hint.textContent = this.sel
      ? `已选 ${ARTIFACTS[this.sel]?.name ?? this.sel} · 点同类槽装上`
      : '点背包选一件 · 双击已装备可卸下';
    mid.append(hint);
    return mid;
  }

  private rightEl(hero: Hero): HTMLElement {
    const right = document.createElement('div');
    right.className = 'arts-right';

    const bagH = document.createElement('div');
    bagH.className = 'arts-bag-h';
    bagH.textContent = '背包';
    right.append(bagH);

    const bag = document.createElement('div');
    bag.className = 'arts-bag';
    const items = backpackOf(hero);
    const cells = Math.max(12, Math.ceil(items.length / 4) * 4);
    for (let i = 0; i < cells; i++) {
      const id = items[i];
      const cell = document.createElement('button');
      cell.className = 'bag-cell' + (id ? ' filled' : '') + (id && this.sel === id ? ' sel' : '');
      cell.dataset.idx = String(i);
      if (id) {
        cell.dataset.art = id;
        const art = ARTIFACTS[id];
        cell.textContent = (art?.name ?? id).slice(0, 2);
        cell.setAttribute('aria-label', art?.name ?? id);
        this.bindItem(cell, id, () => this.clickBag(id));
      } else {
        cell.setAttribute('aria-label', '空');
      }
      bag.appendChild(cell);
    }
    right.append(bag);

    const armyH = document.createElement('div');
    armyH.className = 'arts-army-h';
    armyH.textContent = '部队';
    right.append(armyH);

    const army = document.createElement('div');
    army.className = 'arts-army';
    for (let i = 0; i < 5; i++) {
      const st = hero.army[i];
      const r = document.createElement('div');
      r.className = 'arts-row' + (st ? '' : ' empty');
      if (st) {
        r.appendChild(this.unitArtEl(st.unitTypeId));
        const nm = document.createElement('span');
        nm.className = 'n';
        nm.textContent = safeUnitName(st.unitTypeId);
        const ct = document.createElement('b');
        ct.className = 'q';
        ct.textContent = `×${st.count}`;
        r.append(nm, ct);
      } else {
        r.textContent = '空';
      }
      army.appendChild(r);
    }
    right.append(army);
    return right;
  }

  /* ---------------- 交互 ---------------- */

  private clickBag(id: string): void {
    this.sel = this.sel === id ? null : id;
    this.reason = this.sel ? 'picked' : 'cancel';
    this.msg = '';
    this.render();
  }

  private clickSlot(slot: ArtifactSlot, worn: string | undefined): void {
    const hero = this.state?.heroes[this.heroId];
    if (!hero) return;

    /* 双击 = 卸下。**不能挂原生 `dblclick`**：第一次点击就会 `render()` 整块重建，
     * 那个节点随即脱离文档，第二次点击落在新节点上 —— 原生 dblclick 是否还能送到
     * 监听器取决于浏览器对"脱离目标"的处理，实测在两档尺寸下不一致。
     * 这里自己数连击（400ms 内同槽两次），与是否重渲染无关。
     * ⚠️ 判定必须放在 `this.sel` 分支**之前**：第一次点击已经把 sel 设成这件，
     *    否则第二次会走进"装备同一件" ⇒ 只得到 `already`，永远卸不下来。 */
    const now = performance.now();
    const twice = !!this.lastTap && this.lastTap.slot === slot && now - this.lastTap.t < 400;
    this.lastTap = { slot, t: now };
    if (worn && twice) {
      this.dblSlot(slot, worn);
      return;
    }

    if (!this.sel) {
      /* 没选东西时点已装备的槽 = 选中它（再点一次 / 双击 = 卸下），点空槽无动作。 */
      if (worn) {
        this.sel = worn;
        this.reason = 'picked-worn';
        this.msg = '';
      }
      this.render();
      return;
    }

    const def = ARTIFACTS[this.sel];
    if (!def) {
      this.reason = 'bad-index';
      this.msg = '没有这件宝物';
      this.render();
      return;
    }
    if (def.slot !== slot) {
      /* 类型不符：该槽转红 400ms，**不写状态**（§9.1）。 */
      this.reason = 'slot-mismatch';
      this.msg = `${def.name}不能放进「${slotLabel(slot)}」`;
      this.render();
      const el = document.querySelector(`.art-slot[data-slot="${slot}"]`);
      el?.classList.add('bad');
      window.setTimeout(() => el?.classList.remove('bad'), 400);
      return;
    }

    const before = effectivePrimary(hero);
    const r = equipArtifact(hero, this.sel);
    const after = effectivePrimary(hero);
    this.reason = r.reason;
    this.msg = r.message;
    if (r.ok) {
      this.sel = null;
      this.onChange?.();
    }
    this.render();
    if (r.ok) this.flashDelta(before, after);
  }

  /** 双击已装备的槽 = 卸下（§9.1）。 */
  private dblSlot(slot: ArtifactSlot, worn: string | undefined): void {
    const hero = this.state?.heroes[this.heroId];
    if (!hero || !worn) return;
    const before = effectivePrimary(hero);
    const r = unequipArtifact(hero, slot);
    const after = effectivePrimary(hero);
    this.reason = r.reason;
    this.msg = r.message;
    if (r.ok) {
      this.sel = null;
      this.onChange?.();
    }
    this.render();
    if (r.ok) this.flashDelta(before, after);
  }

  /** 长按 400ms 出物品浮层；移动 / 抬起即取消。 */
  private bindItem(el: HTMLElement, id: string, click: () => void): void {
    el.addEventListener('click', () => {
      if (this.pressTimer !== null) {
        window.clearTimeout(this.pressTimer);
        this.pressTimer = null;
        return; // 长按已经消费了这次交互
      }
      click();
    });
    if (!id) return;
    /* ⚠️ 这里**不挂** `dblclick`：背包格也走 bindItem，而"双击卸下"只对**已装备的槽**成立。
     * 早先版本在背包格上挂过 —— 双击背包里的一件盾会把**身上那件盾**卸掉（槽位相同、
     * 但根本不是同一件），属于"点了 A 改了 B"。双击改由 `clickSlot` 的连击计数处理。 */
    el.addEventListener('pointerdown', (ev) => {
      const box = el.getBoundingClientRect();
      this.pressTimer = window.setTimeout(() => {
        this.pressTimer = null;
        this.tip = { id, x: box.left + box.width / 2, y: box.top };
        this.render();
        const clear = () => {
          window.removeEventListener('pointerup', clear);
          this.tip = null;
          this.render();
        };
        window.addEventListener('pointerup', clear, { once: true });
      }, 400);
      void ev;
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) {
      el.addEventListener(ev, () => {
        if (this.pressTimer !== null) {
          window.clearTimeout(this.pressTimer);
          this.pressTimer = null;
        }
      });
    }
  }

  /** 四维变化浮字（0.8s 消退，不弹窗）。 */
  private flashDelta(before: ReturnType<typeof effectivePrimary>, after: ReturnType<typeof effectivePrimary>): void {
    const map: [keyof typeof before, string][] = [
      ['attack', 'attack'],
      ['defense', 'defense'],
      ['spellPower', 'spellPower'],
      ['knowledge', 'knowledge'],
    ];
    for (const [k] of map) {
      const d = after[k] - before[k];
      if (!d) continue;
      const cell = document.querySelector(`.arts-stats .stat[data-stat="${k}"]`);
      if (!cell) continue;
      const tag = document.createElement('span');
      tag.className = 'stat-delta' + (d > 0 ? ' up' : ' down');
      tag.textContent = (d > 0 ? '+' : '') + d;
      cell.appendChild(tag);
      window.setTimeout(() => tag.remove(), 800);
    }
  }

  /* ---------------- 小件 ---------------- */

  private tipEl(tip: Tip): HTMLElement {
    const art = ARTIFACTS[tip.id];
    const el = document.createElement('div');
    el.className = 'arts-tip';
    el.style.left = `${Math.round(tip.x)}px`;
    el.style.top = `${Math.round(tip.y)}px`;
    const t = document.createElement('b');
    t.textContent = art?.name ?? tip.id;
    const d = document.createElement('span');
    d.textContent = `${slotLabel(art?.slot)} · ${art?.desc ?? ''}`;
    el.append(t, d);
    return el;
  }

  private faceUrl(hero: Hero): string {
    const atlas = getAtlas();
    const name = `hero_${hero.owner}`;
    return atlas.has(name) ? atlas.url(name) : '';
  }

  private unitArtEl(id: string): HTMLElement {
    const name = unitMapFrame(id);
    const atlas = getAtlas();
    if (!atlas.has(name)) {
      warnMissingFrame(name, '装备页');
      const chip = document.createElement('i');
      chip.className = 'arts-art chip';
      chip.style.background = safeUnit(id)?.body ?? '#7a6a4a';
      return chip;
    }
    const img = document.createElement('img');
    img.className = 'arts-art';
    img.src = atlas.url(name);
    img.alt = '';
    img.draggable = false;
    return img;
  }
}

function row(cls: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  return el;
}

function slotLabel(slot?: ArtifactSlot): string {
  if (!slot) return '';
  return ARTIFACT_SLOTS.find((s) => s.slot === slot)?.label ?? slot;
}

function safeUnit(id: string) {
  try {
    return getUnit(id);
  } catch {
    return null;
  }
}

function safeUnitName(id: string): string {
  try {
    return getUnit(id).name;
  } catch {
    return id;
  }
}
