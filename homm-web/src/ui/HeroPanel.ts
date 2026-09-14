import type { GameState, GridPos, Hero } from '../core/types.js';
import { ARTIFACTS, ARTIFACT_SLOTS } from '../core/data/artifacts.js';
import { getUnit } from '../core/data/units.js';
import { isRevealed } from '../core/map/fog.js';
import { effectivePrimary, expToNext, manaMaxOf, maxMovePoints } from '../core/game/hero.js';
import { dayOfWeek, weekOf } from '../core/game/turn.js';

export interface TownHooks {
  /** 把镜头移到该据点 */
  onLocate: (townId: string) => void;
  /** 打开城镇管理面板（己方城镇可远程管理） */
  onOpen: (townId: string) => void;
}

/**
 * 右侧查看器（HOMM3 布局）。
 *
 * 顺序刻意按"每回合要看几眼"排：
 *   肖像 → 移动力/法力 → 四维 → 部队 → 城池
 * 信息压缩在一屏内，不滚动；宝物收进肖像区按需展开。
 */
export class HeroPanel {
  /** 宝物格默认收起，避免占掉一屏里最贵的空间。 */
  private showArtifacts = false;
  /** 记住上一次的入参，折叠宝物时才能就地重画而不惊动镜头。 */
  private lastState: GameState | null = null;
  private lastHero: string | null = null;

  constructor(
    private el: HTMLElement,
    private onSelect?: (heroId: string) => void,
    private onTown?: TownHooks,
    private onSpellBook?: (heroId: string) => void,
  ) {
    // 调试：?devarts=1 直接展开宝物格（与 devbattle 同一套调试约定）
    this.showArtifacts = new URLSearchParams(location.search).has('devarts');
  }

  update(state: GameState, heroId: string | null): void {
    this.lastState = state;
    this.lastHero = heroId;
    this.el.innerHTML = '';

    const hero = heroId ? state.heroes[heroId] : null;
    if (!hero) {
      this.el.appendChild(this.townSection(state, null));
      const px = div('sec dim', '暂无可用英雄');
      this.el.appendChild(px);
      return;
    }

    this.el.appendChild(this.headSection(state, hero));
    if (this.showArtifacts) this.el.appendChild(this.artifactSection(hero));
    this.el.appendChild(this.barSection(hero));
    this.el.appendChild(this.statSection(hero));
    this.el.appendChild(this.armySection(hero));
    this.el.appendChild(this.townSection(state, hero.id));
  }

  /* ---------------- 肖像 + 英雄切换 + 宝物开关 ---------------- */

  private headSection(state: GameState, hero: Hero): HTMLElement {
    const wrap = div('hp-head');

    const idx = state.heroOrder.indexOf(hero.id);
    const multi = state.heroOrder.length > 1;

    const face = div('hp-face');
    face.textContent = hero.name.slice(0, 1);
    face.title = `${hero.name} · ${hero.heroClass}`;
    wrap.appendChild(face);

    const meta = div('hp-meta');
    const line1 = div('hp-name');
    line1.append(
      span('', hero.name),
      span('hp-lv', `Lv.${hero.level}`),
    );
    const line2 = div('hp-sub', `${hero.heroClass} · 第 ${weekOf(state.day)} 周 ${dayOfWeek(state.day)} 天`);
    meta.append(line1, line2);
    wrap.appendChild(meta);

    const nav = div('hp-nav');
    if (multi) {
      const prev = miniBtn('‹', () => this.cycle(state, idx, -1), '上一位英雄');
      const next = miniBtn('›', () => this.cycle(state, idx, 1), '下一位英雄');
      nav.append(prev, next);
    }
    const artBtn = miniBtn(
      this.showArtifacts ? '宝物▴' : '宝物▾',
      () => {
        this.showArtifacts = !this.showArtifacts;
        if (this.lastState) this.update(this.lastState, this.lastHero);
      },
      '展开/收起宝物格',
    );
    artBtn.classList.toggle('on', this.showArtifacts);
    nav.appendChild(artBtn);
    wrap.appendChild(nav);

    return wrap;
  }

  private cycle(state: GameState, idx: number, delta: number): void {
    const n = state.heroOrder.length;
    if (n < 2) return;
    const next = state.heroOrder[(idx + delta + n) % n];
    if (next) this.onSelect?.(next);
  }

  /* ---------------- 移动力 / 法力 ---------------- */

  private barSection(hero: Hero): HTMLElement {
    const wrap = div('sec hp-bars');

    const maxMp = maxMovePoints(hero);
    wrap.appendChild(
      barRow('移动力', Math.floor(hero.movePoints), maxMp, hero.movePoints, ''),
    );

    const maxMana = manaMaxOf(hero);
    const manaRow = barRow('法力', hero.mana, maxMana, hero.mana, 'mana');
    wrap.appendChild(manaRow);

    const btn = document.createElement('button');
    btn.className = 'btn tiny';
    btn.textContent = '魔法书';
    btn.style.marginTop = '6px';
    btn.disabled = !hero.spells.length;
    btn.title = hero.spells.length ? '查看并施放已学会的法术' : '还没学会任何法术（建魔法行会）';
    btn.addEventListener('click', () => this.onSpellBook?.(hero.id));
    wrap.appendChild(btn);

    return wrap;
  }

  /* ---------------- 四维 ---------------- */

  private statSection(hero: Hero): HTMLElement {
    const p = effectivePrimary(hero);
    const wrap = div('sec hp-stats');
    wrap.append(
      stat('攻', p.attack),
      stat('防', p.defense),
      stat('魔', p.spellPower),
      stat('知', p.knowledge),
    );
    const exp = div('hp-exp', `经验 ${hero.exp} / ${expToNext(hero.level)}`);
    wrap.appendChild(exp);
    return wrap;
  }

  /* ---------------- 部队格 ---------------- */

  private armySection(hero: Hero): HTMLElement {
    const wrap = div('sec hp-army');
    const h = document.createElement('h3');
    h.textContent = '部队';
    wrap.appendChild(h);

    const grid = div('hp-slots');
    if (!hero.army.length) {
      grid.appendChild(div('hp-slot empty', '（无）'));
    }
    for (const s of hero.army) {
      const u = getUnit(s.unitTypeId);
      const cell = div('hp-slot');
      cell.title = `${u.name}：攻 ${u.attack} 防 ${u.defense} 伤 ${u.damageMin}-${u.damageMax} 血 ${u.hp} 速 ${u.speed}`;
      const dot = div('hp-dot');
      dot.style.background = u.body;
      const nm = div('hp-uname', u.name);
      const ct = div('hp-ucount', String(s.count));
      cell.append(dot, nm, ct);
      grid.appendChild(cell);
    }
    // 补足一行 4 格，视觉上才像 HOMM3 的兵种栏
    const filler = (4 - (hero.army.length % 4)) % 4;
    for (let i = 0; i < filler; i++) grid.appendChild(div('hp-slot blank'));

    wrap.appendChild(grid);
    return wrap;
  }

  /* ---------------- 宝物（可折叠） ---------------- */

  private artifactSection(hero: Hero): HTMLElement {
    const wrap = div('sec hp-arts');
    const grid = div('slot-row');
    for (const slot of ARTIFACT_SLOTS) {
      const owned = hero.artifacts.map((id) => ARTIFACTS[id]).find((a) => a && a.slot === slot.slot);
      const cell = div('slot' + (owned ? ' filled' : ''));
      cell.textContent = owned ? owned.name : slot.label;
      if (owned) cell.title = owned.desc;
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  /* ---------------- 城池（占据 HOMM3 小地图的位置） ---------------- */

  private townSection(state: GameState, heroId: string | null): HTMLElement {
    const wrap = div('sec hp-towns');
    const hero = heroId ? state.heroes[heroId] : null;

    const known: (typeof state.towns)[string][] = [];
    let hidden = 0;
    for (const t of Object.values(state.towns)) {
      if (isRevealed(state, 'p1', t.pos.x, t.pos.y)) known.push(t);
      else hidden += 1;
    }

    const h = document.createElement('h3');
    h.textContent = hidden ? `城池 ${known.length} · 未发现 ${hidden}` : `城池 ${known.length}`;
    wrap.appendChild(h);

    if (!known.length) {
      wrap.appendChild(
        div('kv dim', hidden ? `继续探索，还有 ${hidden} 处未知的据点` : '地图上没有任何据点'),
      );
      return wrap;
    }

    const list = div('hp-tlist');
    known.sort((a, b) => (a.owner === 'p1' ? -1 : 1) - (b.owner === 'p1' ? -1 : 1));
    for (const t of known) {
      const mine = t.owner === 'p1';
      const row = div('hp-trow');

      const dot = div('hp-tdot' + (mine ? ' mine' : ''));
      row.appendChild(dot);

      const nm = div('hp-tname', t.name);
      row.appendChild(nm);

      const troops = t.garrison.reduce((s, st) => s + st.count, 0);
      const dist = hero ? manhattan(hero.pos, t.pos) : null;
      const meta = div('hp-tmeta');
      meta.textContent = [troops ? `驻军 ${troops}` : '空城', dist !== null ? `${dist} 格` : '']
        .filter(Boolean)
        .join(' · ');
      row.appendChild(meta);

      const btns = div('hp-tbtns');
      if (mine) btns.appendChild(miniBtn('管理', () => this.onTown?.onOpen(t.id)));
      btns.appendChild(miniBtn('定位', () => this.onTown?.onLocate(t.id)));
      row.appendChild(btns);

      list.appendChild(row);
    }
    wrap.appendChild(list);
    return wrap;
  }
}

/* ---------------- 小工具 ---------------- */

function manhattan(a: GridPos, b: GridPos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function div(cls: string, text?: string): HTMLElement {
  const e = document.createElement('div');
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function span(cls: string, text: string): HTMLElement {
  const e = document.createElement('span');
  e.className = cls;
  e.textContent = text;
  return e;
}

function miniBtn(label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'btn tiny';
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function stat(label: string, value: number): HTMLElement {
  const e = div('hp-stat');
  e.append(div('hp-stat-k', label), div('hp-stat-v', String(value)));
  return e;
}

function barRow(label: string, cur: number, max: number, raw: number, kind: string): HTMLElement {
  const row = div('hp-bar-row');
  const top = div('hp-bar-top');
  top.append(span('hp-bar-k', label), span('hp-bar-v', `${cur} / ${max}`));
  const bar = div('bar' + (kind ? ` ${kind}` : ''));
  const fill = document.createElement('i');
  fill.style.width = `${Math.max(0, Math.min(100, (raw / Math.max(1, max)) * 100))}%`;
  bar.appendChild(fill);
  row.append(top, bar);
  return row;
}
