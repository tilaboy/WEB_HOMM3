import type { GameState, GridPos } from '../core/types.js';
import { ARTIFACTS, ARTIFACT_SLOTS } from '../core/data/artifacts.js';
import { getUnit } from '../core/data/units.js';
import { isRevealed } from '../core/map/fog.js';
import { effectivePrimary, expToNext, maxMovePoints } from '../core/game/hero.js';

export interface TownHooks {
  /** 把镜头移到该据点 */
  onLocate: (townId: string) => void;
  /** 打开城镇管理面板（己方城镇可远程管理） */
  onOpen: (townId: string) => void;
}

export class HeroPanel {
  constructor(
    private el: HTMLElement,
    private onSelect?: (heroId: string) => void,
    private onTown?: TownHooks,
  ) {}

  update(state: GameState, heroId: string | null): void {
    this.el.innerHTML = '';

    if (state.heroOrder.length > 1) {
      const wrap = document.createElement('div');
      wrap.className = 'sec';
      const h = document.createElement('h3');
      h.textContent = `英雄（${state.heroOrder.length}）`;
      wrap.appendChild(h);
      const row = document.createElement('div');
      row.className = 'hero-switch';
      for (const id of state.heroOrder) {
        const hero = state.heroes[id];
        if (!hero) continue;
        const b = document.createElement('button');
        b.className = 'btn tiny' + (id === heroId ? ' primary' : '');
        b.textContent = hero.name;
        b.title = `移动力 ${Math.floor(hero.movePoints)}`;
        b.addEventListener('click', () => this.onSelect?.(id));
        row.appendChild(b);
      }
      wrap.appendChild(row);
      this.el.appendChild(wrap);
    }

    // 据点总览：不用英雄站在城里也能管理，顺便提示还有几处没被发现
    this.el.appendChild(this.townSection(state, heroId));

    const hero = heroId ? state.heroes[heroId] : null;
    if (!hero) {
      const px = document.createElement('div');
      px.className = 'sec';
      px.textContent = '暂无可用英雄';
      this.el.appendChild(px);
      return;
    }

    const p = effectivePrimary(hero);
    const maxMp = maxMovePoints(hero);

    this.el.appendChild(
      section('英雄', [
        kv('名字', `${hero.name} · ${hero.heroClass}`),
        kv('等级', `Lv.${hero.level}  (${hero.exp}/${expToNext(hero.level)})`),
        kv('攻击', String(p.attack)),
        kv('防御', String(p.defense)),
        kv('魔力 / 知识', `${p.spellPower} / ${p.knowledge}`),
      ]),
    );

    const moveWrap = document.createElement('div');
    moveWrap.className = 'sec';
    moveWrap.appendChild(kv('移动力', `${Math.floor(hero.movePoints)} / ${maxMp}`));
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(0, Math.min(100, (hero.movePoints / maxMp) * 100))}%`;
    bar.appendChild(fill);
    moveWrap.appendChild(bar);
    this.el.appendChild(moveWrap);

    const army = document.createElement('div');
    army.className = 'sec';
    const ah = document.createElement('h3');
    ah.textContent = '部队';
    army.appendChild(ah);
    if (!hero.army.length) {
      const empty = document.createElement('div');
      empty.textContent = '（无）';
      army.appendChild(empty);
    }
    for (const s of hero.army) {
      const u = getUnit(s.unitTypeId);
      const row = document.createElement('div');
      row.className = 'army-row';
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.background = u.body;
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = u.name;
      const ct = document.createElement('span');
      ct.className = 'ct';
      ct.textContent = `×${s.count}`;
      row.appendChild(chip);
      row.appendChild(nm);
      row.appendChild(ct);
      army.appendChild(row);
    }
    this.el.appendChild(army);

    const art = document.createElement('div');
    art.className = 'sec';
    const bh = document.createElement('h3');
    bh.textContent = '宝物';
    art.appendChild(bh);
    const grid = document.createElement('div');
    grid.className = 'slot-row';
    for (const slot of ARTIFACT_SLOTS) {
      const owned = hero.artifacts.map((id) => ARTIFACTS[id]).find((a) => a && a.slot === slot.slot);
      const cell = document.createElement('div');
      cell.className = 'slot' + (owned ? ' filled' : '');
      cell.textContent = owned ? owned.name : slot.label;
      if (owned) cell.title = owned.desc;
      grid.appendChild(cell);
    }
    art.appendChild(grid);
    this.el.appendChild(art);
  }

  /** 已发现的据点列表。未发现的只报个数，保留探索感。 */
  private townSection(state: GameState, heroId: string | null): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sec';
    const h = document.createElement('h3');
    h.textContent = '据点';
    wrap.appendChild(h);

    const hero = heroId ? state.heroes[heroId] : null;
    const known: typeof state.towns[string][] = [];
    let hidden = 0;
    for (const t of Object.values(state.towns)) {
      if (isRevealed(state, 'p1', t.pos.x, t.pos.y)) known.push(t);
      else hidden += 1;
    }

    if (!known.length) {
      const e = document.createElement('div');
      e.className = 'kv';
      e.textContent = hidden ? `尚未发现任何据点（还有 ${hidden} 处未知）` : '地图上没有任何据点';
      wrap.appendChild(e);
      return wrap;
    }

    known.sort((a, b) => (a.owner === 'p1' ? -1 : 1) - (b.owner === 'p1' ? -1 : 1));
    for (const t of known) {
      const row = document.createElement('div');
      row.className = 'trow';

      const nm = document.createElement('span');
      nm.className = 'tn' + (t.owner === 'p1' ? ' mine' : '');
      nm.textContent = t.owner === 'p1' ? `${t.name}（我方）` : `${t.name}（中立）`;
      row.appendChild(nm);

      const meta = document.createElement('span');
      meta.className = 'tm';
      const troops = t.garrison.reduce((s, st) => s + st.count, 0);
      const dist = hero ? manhattan(hero.pos, t.pos) : null;
      meta.textContent = [troops ? `驻军 ${troops}` : '无驻军', dist !== null ? `${dist} 格` : '']
        .filter(Boolean)
        .join(' · ');
      row.appendChild(meta);

      const btns = document.createElement('span');
      btns.className = 'tb';
      btns.appendChild(
        miniBtn('定位', () => this.onTown?.onLocate(t.id)),
      );
      if (t.owner === 'p1') {
        btns.appendChild(miniBtn('管理', () => this.onTown?.onOpen(t.id)));
      }
      row.appendChild(btns);
      wrap.appendChild(row);
    }

    if (hidden) {
      const e = document.createElement('div');
      e.className = 'kv dim';
      e.textContent = `还有 ${hidden} 处据点未被发现，继续探索`;
      wrap.appendChild(e);
    }
    return wrap;
  }
}

function manhattan(a: GridPos, b: GridPos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function miniBtn(label: string, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.className = 'btn tiny';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function section(title: string, rows: HTMLElement[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'sec';
  const h = document.createElement('h3');
  h.textContent = title;
  wrap.appendChild(h);
  for (const r of rows) wrap.appendChild(r);
  return wrap;
}

function kv(k: string, v: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kv';
  const ke = document.createElement('span');
  ke.className = 'k';
  ke.textContent = k;
  const ve = document.createElement('span');
  ve.className = 'v';
  ve.textContent = v;
  row.appendChild(ke);
  row.appendChild(ve);
  return row;
}
