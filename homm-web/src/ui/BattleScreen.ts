/**
 * M3 战斗界面。
 *
 * 结构：core 出"事件流"，这里负责把事件翻译成动画，再把玩家点击翻译成指令。
 * core 那边已经在事件产生的瞬间就把状态改完了，所以这里播动画时可以非常省心：
 * 血条/数量会立刻更新，浮字和位移只是"补上那 0.5 秒的表演"。
 */
import type { GameState } from '../core/types.js';
import { getUnit } from '../core/data/units.js';
import { effectivePrimary } from '../core/game/hero.js';
import {
  actDefend,
  actFlee,
  actMelee,
  actMove,
  actShoot,
  actWait,
  aiAct,
  aliveOf,
  canShoot,
  createBattle,
  currentUnit,
  describeEvent,
  endActivation,
  estimateDamage,
  meleeTargets,
  poolOf,
  reachable,
  shootTargets,
  toOutcome,
  unitAt,
  unitById,
  type BattleEvent,
  type BattleOutcome,
  type BattleSide,
  type BattleState,
  type BattleUnit,
} from '../core/combat/battle.js';
import { hexCenter, hexKey, inField, isAdjacent, pickHex, type Hex } from '../core/combat/hex.js';
import { BattleRenderer, BASE_H, BASE_W, PAD } from '../render/BattleRenderer.js';
import type { FloatText } from '../render/BattleRenderer.js';

export interface BattleOptions {
  state: GameState;
  heroId: string;
  title: string;
  attacker: BattleSide;
  defender: BattleSide;
  seed: number;
  /** 调试/演示用：进场后立刻交给 AI 自动打完。 */
  autoStart?: boolean;
  /** 调试用：跳过全部动画，直接结算（配合无头截图）。 */
  instant?: boolean;
  onDone: (outcome: BattleOutcome) => void;
}

interface Anim {
  t: number;
  dur: number;
  step(p: number): void;
  end?(): void;
}

let openRef: { close: () => void } | null = null;

export function isBattleOpen(): boolean {
  return openRef !== null;
}

export function closeBattleScreen(): void {
  openRef?.close();
}

export function openBattleScreen(parent: HTMLElement, opts: BattleOptions): void {
  const battle = createBattle(opts.attacker, opts.defender, opts.seed);
  const hero = opts.state.heroes[opts.heroId];

  /* ---------------- DOM ---------------- */

  const root = document.createElement('div');
  root.className = 'battle';

  const head = document.createElement('div');
  head.className = 'bt-head';
  const title = document.createElement('div');
  title.className = 'bt-title';
  title.textContent = opts.title;
  const roundEl = document.createElement('div');
  roundEl.className = 'bt-round';
  const statsEl = document.createElement('div');
  statsEl.className = 'bt-stats';
  if (hero) {
    const p = effectivePrimary(hero);
    statsEl.textContent = `${hero.name} · 攻 ${p.attack} 防 ${p.defense}`;
  }
  const headActions = document.createElement('div');
  headActions.className = 'bt-head-actions';
  head.append(title, roundEl, statsEl, headActions);
  root.appendChild(head);

  const body = document.createElement('div');
  body.className = 'bt-body';

  const leftCards = document.createElement('div');
  leftCards.className = 'bt-army left';
  const fieldWrap = document.createElement('div');
  fieldWrap.className = 'bt-field';
  const canvas = document.createElement('canvas');
  canvas.className = 'bt-canvas';
  fieldWrap.appendChild(canvas);
  const rightCards = document.createElement('div');
  rightCards.className = 'bt-army right';
  body.append(leftCards, fieldWrap, rightCards);
  root.appendChild(body);

  const foot = document.createElement('div');
  foot.className = 'bt-foot';
  const hintEl = document.createElement('div');
  hintEl.className = 'bt-hint';
  const actionBar = document.createElement('div');
  actionBar.className = 'bt-actions';
  const logEl = document.createElement('div');
  logEl.className = 'bt-log';
  foot.append(hintEl, actionBar, logEl);
  root.appendChild(foot);

  parent.appendChild(root);

  const renderer = new BattleRenderer(canvas);

  /* ---------------- runtime state ---------------- */

  let queue: BattleEvent[] = [];
  let anim: Anim | null = null;
  let think = 0;
  let auto = false;
  let finished = false;
  let hover: Hex | null = null;
  let lunge: { unitId: string; dx: number; dy: number } | null = null;
  let arrow: { x: number; y: number; tx: number; ty: number } | null = null;
  const floats: FloatText[] = [];
  const posOverride: Record<string, { x: number; y: number }> = {};
  const logs: string[] = [];
  let reachableSet: Set<string> | null = null;
  let attackableSet: Set<string> | null = null;
  let lastActive = '';
  let dirty = false;

  const alive = (u: BattleUnit) => u.count > 0;

  function fit(): void {
    const w = fieldWrap.clientWidth;
    const h = fieldWrap.clientHeight;
    renderer.fit(w || BASE_W, h || BASE_H);
  }

  function refreshCards(): void {
    const build = (side: 0 | 1, host: HTMLElement): void => {
      host.innerHTML = '';
      const cap = document.createElement('div');
      cap.className = 'bt-army-cap';
      cap.textContent = side === 0 ? '我方' : '敌方';
      host.appendChild(cap);
      for (const u of battle.units.filter((x) => x.side === side)) {
        const def = getUnit(u.unitTypeId);
        const card = document.createElement('div');
        card.className = 'bt-card' + (alive(u) ? '' : ' dead') + (currentUnit(battle)?.id === u.id ? ' active' : '');
        const top = document.createElement('div');
        top.className = 'bt-card-top';
        const nm = document.createElement('span');
        nm.textContent = def.name;
        const ct = document.createElement('b');
        ct.textContent = alive(u) ? `×${u.count}` : '全灭';
        top.append(nm, ct);
        const sub = document.createElement('div');
        sub.className = 'bt-card-sub';
        sub.textContent = `攻${def.attack} 防${def.defense} 速${def.speed}` + (def.shots ? ` 弹${u.shots}` : '');
        card.append(top, sub);
        host.appendChild(card);
      }
    };
    build(0, leftCards);
    build(1, rightCards);
  }

  function pushLog(text: string): void {
    if (!text) return;
    logs.push(text);
    if (logs.length > 40) logs.shift();
    logEl.innerHTML = '';
    for (const l of logs.slice(-4)) {
      const d = document.createElement('div');
      d.textContent = l;
      logEl.appendChild(d);
    }
  }

  function hint(text: string): void {
    hintEl.textContent = text;
  }

  function addFloat(text: string, h: Hex, color: string): void {
    const c = hexCenter(h);
    floats.push({ text, x: c.x, y: c.y - 18, life: 1, color });
  }

  /* ---------------- player option computation ---------------- */

  function recomputeOptions(): void {
    const u = currentUnit(battle);
    if (!u || u.side !== 0 || battle.over) {
      reachableSet = null;
      attackableSet = null;
      lastActive = '';
      return;
    }
    reachableSet = u.moved ? null : new Set([...reachable(battle, u).keys()]);
    const set = new Set<string>();
    for (const e of meleeTargets(battle, u)) set.add(hexKey(e.hex));
    if (canShoot(battle, u)) for (const e of shootTargets(battle, u)) set.add(hexKey(e.hex));
    attackableSet = set;
    lastActive = u.id;
  }

  /* ---------------- actions ---------------- */

  function playerMove(h: Hex): boolean {
    const u = currentUnit(battle);
    if (!u || u.side !== 0 || u.moved) return false;
    const paths = reachable(battle, u);
    const path = paths.get(hexKey(h));
    if (!path || !path.length) return false;
    emit(actMove(battle, u, h));
    // 移动后仍可攻击：不结束行动，只是不能再走
    recomputeOptions();
    refreshCards();
    return true;
  }

  function playerAttack(target: BattleUnit): boolean {
    const u = currentUnit(battle);
    if (!u || u.side !== 0) return false;
    if (isAdjacent(u.hex, target.hex)) {
      emit(actMelee(battle, u, target));
    } else if (canShoot(battle, u)) {
      emit(actShoot(battle, u, target));
    } else {
      hint('够不着，先移动过去');
      return false;
    }
    emit(endActivation(battle));
    return true;
  }

  function doWait(): void {
    const u = currentUnit(battle);
    if (!u || u.side !== 0) return;
    emit(actWait(battle, u));
    emit(endActivation(battle));
  }

  function doDefend(): void {
    const u = currentUnit(battle);
    if (!u || u.side !== 0) return;
    emit(actDefend(u));
    emit(endActivation(battle));
  }

  function doFlee(): void {
    if (battle.over) return;
    emit(actFlee(battle));
  }

  function doAuto(): void {
    if (battle.over) return;
    auto = true;
    hint('自动战斗中…');
  }

  /* ---------------- event → animation ---------------- */

  function emit(events: BattleEvent[]): void {
    for (const e of events) queue.push(e);
    if (events.length) dirty = true;
    pushLogFor(events);
  }

  function pushLogFor(events: BattleEvent[]): void {
    for (const e of events) pushLog(describeEvent(battle, e));
  }

  function startEvent(e: BattleEvent): void {
    // 无头/调试模式：不做任何表演，直接把事件消费掉
    if (opts.instant) {
      if (e.t === 'end') finish();
      return;
    }
    switch (e.t) {
      case 'round': {
        anim = { t: 0, dur: 420, step: () => undefined };
        break;
      }
      case 'move': {
        const pts = [hexCenter(e.from), ...e.path.map((h) => hexCenter(h))];
        const n = pts.length - 1;
        anim = {
          t: 0,
          dur: Math.max(150, 130 * n),
          step: (p) => {
            const f = Math.min(0.9999, p) * n;
            const i = Math.floor(f);
            const k = f - i;
            const a = pts[i];
            const b = pts[Math.min(n, i + 1)];
            posOverride[e.unitId] = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
          },
          end: () => {
            delete posOverride[e.unitId];
          },
        };
        break;
      }
      case 'melee': {
        anim = lungeAnim(e.unitId, e.from, hexOf(e.targetId), `-${e.damage}`, e.killed, '#ff6b52');
        break;
      }
      case 'retaliate': {
        anim = lungeAnim(e.unitId, hexOf(e.unitId), hexOf(e.targetId), `-${e.damage}`, e.killed, '#ffb347');
        break;
      }
      case 'shoot': {
        const a = hexCenter(e.from ?? hexOf(e.unitId));
        const b = hexCenter(hexOf(e.targetId));
        let hit = false;
        anim = {
          t: 0,
          dur: 640,
          step: (p) => {
            if (p < 0.45) {
              const k = p / 0.45;
              arrow = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * 12, tx: b.x, ty: b.y };
            } else {
              if (!hit) {
                hit = true;
                addFloat(`-${e.damage}`, hexOf(e.targetId), e.blocked ? '#ffb347' : '#ffe07a');
                if (e.killed) addFloat(`-${e.killed}`, hexOf(e.targetId), '#ffdcd2');
              }
              arrow = null;
            }
          },
          end: () => {
            arrow = null;
          },
        };
        break;
      }
      case 'die': {
        anim = { t: 0, dur: 320, step: () => undefined };
        break;
      }
      case 'wait':
      case 'defend': {
        anim = { t: 0, dur: 240, step: () => undefined };
        break;
      }
      case 'end': {
        anim = {
          t: 0,
          dur: 520,
          step: () => undefined,
          end: () => finish(),
        };
        break;
      }
      default:
        anim = null;
    }
  }

  function hexOf(unitId: string): Hex {
    const u = unitById(battle, unitId);
    return u ? u.hex : { col: 0, row: 0 };
  }

  /** 近战/反击共用的一段"前冲 + 收招"表演。 */
  function lungeAnim(
    unitId: string,
    from: Hex,
    to: Hex,
    text: string,
    killed: number,
    color: string,
  ): Anim {
    const a = hexCenter(from);
    const b = hexCenter(to);
    const dx = Math.sign(b.x - a.x) * 6;
    const dy = Math.sign(b.y - a.y) * 4;
    addFloat(text, to, color);
    if (killed) addFloat(`-${killed}`, to, '#ffdcd2');
    return {
      t: 0,
      dur: 520,
      step: (p) => {
        const k = p < 0.35 ? p / 0.35 : Math.max(0, 1 - (p - 0.35) / 0.65);
        lunge = { unitId, dx: dx * k, dy: dy * k };
      },
      end: () => {
        lunge = null;
      },
    };
  }

  /* ---------------- turn pump ---------------- */

  function pump(): void {
    if (finished || battle.over) return;
    if (anim || queue.length) return;
    if (think > 0) return;

    const u = currentUnit(battle);
    if (!u) {
      emit(endActivation(battle));
      return;
    }
    if (u.side === 1 || auto) {
      const ev = aiAct(battle, u);
      emit(ev);
      emit(endActivation(battle));
      if (!opts.instant) think = 220; // 让敌人每动一次留一拍，不然快得看不清
    }
  }

  function finish(): void {
    if (finished) return;
    finished = true;
    const outcome = toOutcome(battle);
    renderResult(outcome);
  }

  function renderResult(outcome: BattleOutcome): void {
    const box = document.createElement('div');
    box.className = 'bt-result';
    const h = document.createElement('h3');
    h.textContent = outcome.fled ? '撤退' : outcome.win ? '战斗胜利' : '战斗失败';
    h.className = outcome.win && !outcome.fled ? 'win' : 'loss';
    box.appendChild(h);

    const p = document.createElement('p');
    if (outcome.fled) p.textContent = '你收拢残部退出了战场，部队在撤退中折损了四成。';
    else if (outcome.win) p.textContent = `敌军被全歼，获得 ${outcome.expGained} 点经验，历时 ${outcome.rounds} 回合。`;
    else p.textContent = '你的部队被击溃了。';
    box.appendChild(p);

    const table = document.createElement('table');
    table.className = 'est';
    const row = (k: string, v: string): void => {
      const tr = document.createElement('tr');
      const a = document.createElement('td');
      a.textContent = k;
      const b = document.createElement('td');
      b.textContent = v;
      tr.append(a, b);
      table.appendChild(tr);
    };
    for (const l of outcome.losses) row(getUnit(l.unitTypeId).name, `${l.before} → ${l.after}`);
    box.appendChild(table);

    const btn = document.createElement('button');
    btn.className = 'btn primary';
    btn.textContent = '继续';
    btn.addEventListener('click', () => {
      close();
      opts.onDone(outcome);
    });
    box.appendChild(btn);
    root.appendChild(box);
  }

  /* ---------------- input ---------------- */

  function localBase(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    // 用实际显示尺寸反推，避免 devicePixelRatio / 小数缩放造成偏移
    const kx = BASE_W / r.width;
    const ky = BASE_H / r.height;
    return { x: (e.clientX - r.left) * kx - PAD, y: (e.clientY - r.top) * ky - PAD };
  }

  function hexFromEvent(e: { clientX: number; clientY: number }): Hex | null {
    const p = localBase(e);
    const h = pickHex(p.x, p.y);
    return inField(h) ? h : null;
  }

  function busy(): boolean {
    return finished || battle.over || !!anim || queue.length > 0 || think > 0;
  }

  canvas.addEventListener('pointermove', (e) => {
    const h = hexFromEvent(e);
    hover = h;
    if (!h) {
      hint('');
      return;
    }
    const u = currentUnit(battle);
    const target = unitAt(battle, h);
    if (target && u && u.side === 0 && target.side !== u.side) {
      const ranged = canShoot(battle, u) && !isAdjacent(u.hex, target.hex);
      const dmg = estimateDamage(battle, u, target, ranged);
      const kills = Math.floor((poolOf(target) - 0.0001) / Math.max(1, dmg));
      hint(
        `${getUnit(target.unitTypeId).name} ×${target.count}　预计伤害 ${dmg}` +
          (ranged ? '（远程）' : '') +
          (kills > 0 ? `，约可击杀 ${Math.min(target.count, Math.floor(poolOf(target) / Math.max(1, dmg)))}` : ''),
      );
    } else if (u && u.side === 0 && !u.moved && reachableSet?.has(hexKey(h))) {
      hint('移动到这里');
    } else {
      hint('');
    }
  });

  canvas.addEventListener('pointerleave', () => {
    hover = null;
  });

  canvas.addEventListener('click', (e) => {
    if (busy()) return;
    const u = currentUnit(battle);
    if (!u || u.side !== 0) return;
    const h = hexFromEvent(e);
    if (!h) return;
    const target = unitAt(battle, h);
    if (target && target.side !== u.side) {
      if (attackableSet?.has(hexKey(h))) playerAttack(target);
      else hint('够不着，先移动过去');
      return;
    }
    if (target) {
      hint('这是自己的部队');
      return;
    }
    if (playerMove(h)) return;
  });

  window.addEventListener('keydown', onKey);
  function onKey(e: KeyboardEvent): void {
    if (openRef === null) return;
    if (e.key === 'Escape') {
      // 战斗中禁止用 Esc 逃走，避免误触丢掉一场仗
      e.stopPropagation();
    } else if (e.key === ' ' && !busy()) {
      e.preventDefault();
      doWait();
    } else if ((e.key === 'd' || e.key === 'D') && !busy()) {
      doDefend();
    }
  }

  const ro = new ResizeObserver(() => fit());
  ro.observe(fieldWrap);

  /* ---------------- buttons ---------------- */

  const btnAuto = document.createElement('button');
  btnAuto.className = 'btn';
  btnAuto.textContent = '自动战斗';
  btnAuto.addEventListener('click', doAuto);

  const btnFlee = document.createElement('button');
  btnFlee.className = 'btn danger';
  btnFlee.textContent = '撤退';
  btnFlee.addEventListener('click', doFlee);
  headActions.append(btnAuto, btnFlee);

  const btnDefend = document.createElement('button');
  btnDefend.className = 'btn';
  btnDefend.textContent = '防御 (D)';
  btnDefend.addEventListener('click', doDefend);

  const btnWait = document.createElement('button');
  btnWait.className = 'btn';
  btnWait.textContent = '等待 (空格)';
  btnWait.addEventListener('click', doWait);

  actionBar.append(btnDefend, btnWait);

  /* ---------------- loop ---------------- */

  let last = performance.now();
  let raf = 0;
  function frame(now: number): void {
    const dt = Math.min(60, now - last);
    last = now;

    if (think > 0) {
      think -= dt;
      if (think <= 0) think = 0;
    }

    if (!anim && queue.length) {
      const e = queue.shift()!;
      startEvent(e);
    }
    if (anim) {
      anim.t += dt;
      const p = Math.min(1, anim.t / anim.dur);
      anim.step(p);
      if (p >= 1) {
        anim.end?.();
        anim = null;
      }
    }
    if (!anim && !queue.length) pump();

    if (dirty) {
      dirty = false;
      refreshCards();
    }

    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.life -= dt / 900;
      f.y -= dt / 42;
      if (f.life <= 0) floats.splice(i, 1);
    }

    const u = currentUnit(battle);
    if (u && u.side === 0 && (u.id !== lastActive || lastActive === '')) recomputeOptions();
    if (!u || u.side !== 0) {
      if (reachableSet || attackableSet) {
        reachableSet = null;
        attackableSet = null;
      }
    }

    roundEl.textContent = `第 ${battle.round} 回合`;
    btnAuto.disabled = auto || battle.over;
    btnFlee.disabled = battle.over;
    btnDefend.disabled = busy() || !u || u.side !== 0;
    btnWait.disabled = busy() || !u || u.side !== 0 || !!u?.waited;

    renderer.draw({
      battle,
      activeId: u && u.side === 0 ? u.id : null,
      reachable: reachableSet,
      attackable: attackableSet,
      hover,
      posOverride,
      lunge,
      arrow,
      floats,
      time: now,
    });
    raf = requestAnimationFrame(frame);
  }

  /* ---------------- lifecycle ---------------- */

  function close(): void {
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('keydown', onKey);
    if (root.parentElement) root.parentElement.removeChild(root);
    openRef = null;
  }

  openRef = { close };

  fit();
  recomputeOptions();
  refreshCards();
  pushLog('战斗开始');
  raf = requestAnimationFrame(frame);
  if (opts.autoStart) window.setTimeout(doAuto, 500);
}

/** 供 UI 直接展示的一行兵力描述（也用于结算弹窗）。 */
export function describeBattleArmy(side: BattleState, who: 0 | 1): string {
  const list = aliveOf(side, who);
  if (!list.length) return '（全灭）';
  return list.map((u) => `${getUnit(u.unitTypeId).name} ×${u.count}`).join('，');
}
