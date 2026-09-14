import type { GameState } from '../core/types.js';
import { RESOURCE_META } from '../core/data/terrains.js';
import { factionColor, factionName } from '../core/data/factions.js';
import { dayOfWeek, weekOf } from '../core/game/turn.js';
import { getAtlas } from '../render/atlas.js';

const SHOWN: (keyof typeof RESOURCE_META)[] = ['gold', 'wood', 'ore'];

export class HUD {
  private resEls = new Map<string, HTMLElement>();
  private dateEl: HTMLElement;
  private endBtn: HTMLButtonElement;
  private playerEl: HTMLElement;
  private dotEl: HTMLElement;

  constructor(
    private el: HTMLElement,
    private onEndDay: () => void,
    private onSave: () => void,
    private onRestart: () => void,
  ) {
    this.el.innerHTML = '';
    const atlas = getAtlas();
    for (const k of SHOWN) {
      const wrap = document.createElement('div');
      wrap.className = 'res';
      wrap.title = RESOURCE_META[k].name;
      const icon = document.createElement('img');
      icon.src = atlas.url(`ic_${k}`);
      icon.alt = RESOURCE_META[k].name;
      icon.draggable = false;
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = '0';
      wrap.appendChild(icon);
      wrap.appendChild(val);
      this.el.appendChild(wrap);
      this.resEls.set(k, val);
    }

    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    this.el.appendChild(spacer);

    this.dateEl = document.createElement('div');
    this.dateEl.className = 'date';
    this.el.appendChild(this.dateEl);

    // 阵营徽记：多阵营对局里，玩家得随时知道自己是谁、以及自己军团的颜色
    const who = document.createElement('div');
    who.className = 'who';
    this.dotEl = document.createElement('i');
    this.playerEl = document.createElement('span');
    who.append(this.dotEl, this.playerEl);
    this.el.appendChild(who);

    this.endBtn = document.createElement('button');
    this.endBtn.className = 'btn primary';
    this.endBtn.textContent = '结束一天';
    this.endBtn.addEventListener('click', () => this.onEndDay());
    this.el.appendChild(this.endBtn);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn';
    saveBtn.textContent = '存档';
    saveBtn.addEventListener('click', () => this.onSave());
    this.el.appendChild(saveBtn);

    const restartBtn = document.createElement('button');
    restartBtn.className = 'btn danger';
    restartBtn.textContent = '新游戏';
    restartBtn.addEventListener('click', () => this.onRestart());
    this.el.appendChild(restartBtn);
  }

  update(state: GameState): void {
    const res = state.players.p1?.resources ?? {};
    for (const [k, el] of this.resEls) {
      const v = (res as Record<string, number | undefined>)[k] ?? 0;
      el.textContent = String(v);
    }
    this.dateEl.textContent = `第 ${weekOf(state.day)} 周 第 ${dayOfWeek(state.day)} 天（总第 ${state.day} 天）`;

    const me = state.players.p1;
    this.dotEl.style.background = factionColor('p1');
    this.playerEl.textContent = me ? `${me.name} · ${factionName('p1')}` : '';
    this.playerEl.title = me?.isHuman === false ? '电脑对手' : '你的军团';

    const over = state.status !== 'playing';
    this.endBtn.disabled = over || !state.heroOrder.some((id) => state.heroes[id]?.owner === 'p1');
    this.endBtn.textContent = over ? '对局已结束' : '结束一天';
  }
}
