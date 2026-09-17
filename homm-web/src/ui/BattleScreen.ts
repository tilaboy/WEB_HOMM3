/**
 * M3 战斗界面。
 *
 * 结构：core 出"事件流"，这里负责把事件翻译成动画，再把玩家点击翻译成指令。
 * core 那边已经在事件产生的瞬间就把状态改完了，所以这里播动画时可以非常省心：
 * 血条/数量会立刻更新，浮字和位移只是"补上那 0.5 秒的表演"。
 */
import type { GameState } from '../core/types.js';
import { getUnit } from '../core/data/units.js';
import { sfx } from './sfx.js';
import { WAR_MACHINES } from '../core/data/warmachines.js';
import { effectivePrimary } from '../core/game/hero.js';
import {
  actDefend,
  actFlee,
  actMelee,
  actMove,
  actShoot,
  actSiege,
  actWait,
  aiAct,
  aliveOf,
  canCast,
  castSpell,
  canShoot,
  createBattle,
  currentUnit,
  describeEvent,
  endActivation,
  estimateDamage,
  estimateSiegeDamage,
  meleeTargets,
  poolOf,
  reachable,
  shootTargets,
  siegeTargets,
  toOutcome,
  unitAt,
  unitById,
  type BattleEvent,
  type BattleOutcome,
  type BattleSide,
  type BattleState,
  type BattleUnit,
} from '../core/combat/battle.js';
import { hexCenter, hexEq, hexKey, inField, isAdjacent, pickHex, FIELD_H, FIELD_W, type Hex } from '../core/combat/hex.js';
import { STRUCTURE_NAME, structureAt, structureById, type SiegeStructure } from '../core/combat/siege.js';
import { getSpell } from '../core/data/spells.js';
import { BattleRenderer, BASE_H, BASE_W, PAD } from '../render/BattleRenderer.js';
import type { FloatText } from '../render/BattleRenderer.js';

export interface BattleOptions {
  state: GameState;
  heroId: string;
  title: string;
  attacker: BattleSide;
  defender: BattleSide;
  seed: number;
  /** 攻城战：守方城墙等级 1/2/3（0 或省略 = 野战）。 */
  siegeLevel?: number;
  /** 调试/演示用：进场后立刻交给 AI 自动打完。 */
  autoStart?: boolean;
  /** 调试用：跳过全部动画，直接结算（配合无头截图）。 */
  instant?: boolean;
  /**
   * 调试用：把每帧真正画出的悬停格写到 window.__battleHover。
   * 悬停残留是纯视觉 bug，截图看不出来，自动化只能靠这个断言（tools/hoveraudit.mjs）。
   */
  debugProbe?: boolean;
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
  const battle = createBattle(opts.attacker, opts.defender, opts.seed, opts.siegeLevel ?? 0);
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
  const manaEl = document.createElement('div');
  manaEl.className = 'bt-mana';
  // 攻城器械：攻方带了才显示，提醒玩家"这几样东西每回合都会自动开火"
  const machineEl = document.createElement('div');
  machineEl.className = 'bt-machines';
  const carriedMachines = opts.attacker.warMachines ?? [];
  if (carriedMachines.length) {
    machineEl.textContent = `攻城器械：${carriedMachines.map((m) => WAR_MACHINES[m].name).join('、')}`;
  } else {
    machineEl.style.display = 'none';
  }
  const headActions = document.createElement('div');
  headActions.className = 'bt-head-actions';
  head.append(title, roundEl, statsEl, manaEl, machineEl, headActions);
  root.appendChild(head);

  const body = document.createElement('div');
  body.className = 'bt-body';

  const fieldWrap = document.createElement('div');
  fieldWrap.className = 'bt-field';
  const canvas = document.createElement('canvas');
  canvas.className = 'bt-canvas';
  fieldWrap.appendChild(canvas);
  const spellPanel = document.createElement('div');
  spellPanel.className = 'bt-spells';
  spellPanel.style.display = 'none';
  fieldWrap.appendChild(spellPanel);
  // 两侧不再摆"我方 / 敌方"列表：场上每支部队都自带数量牌，当前行动的那支脚下有金色光圈，
  // 想看属性就把鼠标停在它身上（1 秒）或右键点一下。列表纯占地方还挡视野。
  body.append(fieldWrap);
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
  // 战斗期间隐藏主界面顶栏（资源 / 结束一天 / 存档 / 新游戏）：它们跟战斗无关，
  // 还会误点——打到一半"结束一天"是谁都不想要的意外
  document.body.classList.add('in-battle');

  const renderer = new BattleRenderer(canvas);

  /* ---------------- runtime state ---------------- */

  let queue: BattleEvent[] = [];
  let anim: Anim | null = null;
  let think = 0;
  let auto = false;
  let finished = false;
  /**
   * 演出速度倍率（1/2/3）：统一乘在每帧 dt 上，动画、AI 思考间隔、
   * 飘字、打击特效全部同步加速。偏好存 localStorage，下一场沿用。
   */
  let speed = (() => {
    const v = Number(localStorage.getItem('homm.battleSpeed') ?? '1');
    return v === 2 || v === 3 ? v : 1;
  })();
  let hover: Hex | null = null;
  let lunge: { unitId: string; dx: number; dy: number } | null = null;
  let arrow: { x: number; y: number; tx: number; ty: number; color?: string } | null = null;
  const floats: FloatText[] = [];
  const posOverride: Record<string, { x: number; y: number }> = {};
  const logs: string[] = [];
  let reachableSet: Set<string> | null = null;
  let attackableSet: Set<string> | null = null;
  let lastActive = '';
  /** 已选中待指定目标的法术（点面板 → 点目标）。 */
  let pendingSpell: string | null = null;
  let spellTargets: Set<string> | null = null;
  const spellFx: { hex: Hex; life: number; color: string; splash?: boolean }[] = [];
  /** 近战打击特效与闪电（纯表演，p 走到头就移除）。 */
  const impacts: { x: number; y: number; kind: 'thrust' | 'slash' | 'smash'; p: number; dur: number }[] = [];
  let bolt: { x: number; y: number; p: number } | null = null;

  function fit(): void {
    const w = fieldWrap.clientWidth;
    const h = fieldWrap.clientHeight;
    renderer.fit(w || BASE_W, h || BASE_H);
  }

  /* ---------------- 部队信息浮框（场上悬停 1 秒 / 右键立即） ---------------- */

  const tip = document.createElement('div');
  tip.className = 'bt-tip';
  tip.style.display = 'none';
  root.appendChild(tip);
  let tipTimer = 0;

  function unitTipText(u: BattleUnit, isActive: boolean): string {
    const def = getUnit(u.unitTypeId);
    const lines = [
      `${def.name} ×${u.count}${isActive ? '　▶ 正在行动' : ''}`,
      `攻 ${def.attack}　防 ${def.defense}　速 ${def.speed}`,
      `总生命 ${Math.round(poolOf(u))}${def.shots ? `　弹药 ${u.shots}` : ''}`,
    ];
    for (const e of u.effects) lines.push(`${getSpell(e.spellId).name} · 剩 ${e.rounds} 回合`);
    if (u.defending) lines.push('防御中');
    if (u.waited) lines.push('已等待');
    return lines.join('\n');
  }

  function showTip(text: string, cx: number, cy: number): void {
    tip.textContent = text;
    tip.style.display = 'block';
    // 量完尺寸再定位，贴着鼠标右下方，超出视口就往回扳
    const r = tip.getBoundingClientRect();
    const x = Math.min(cx + 14, window.innerWidth - r.width - 8);
    const y = Math.min(cy + 16, window.innerHeight - r.height - 8);
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }

  /**
   * 光标停在某支部队上就准备弹属性框：immediate=true（右键）立刻弹，
   * 否则等 1 秒——快速划过战场时不该被弹窗糊一脸。
   */
  function tipForHex(h: Hex | null, e: { clientX: number; clientY: number }, immediate = false): void {
    clearTimeout(tipTimer);
    tipTimer = 0;
    const u = h ? unitAt(battle, h) : null;
    if (!u || u.count <= 0) {
      tip.style.display = 'none';
      return;
    }
    const text = unitTipText(u, currentUnit(battle)?.id === u.id);
    // 已经弹着就跟着鼠标更新内容，不用再等一秒
    if (immediate || tip.style.display !== 'none') {
      showTip(text, e.clientX, e.clientY);
      return;
    }
    tipTimer = window.setTimeout(() => {
      tipTimer = 0;
      showTip(text, e.clientX, e.clientY);
    }, 1000);
  }

  /**
   * 把"瞄准类"的临时提示一次清干净：战场上的悬停格、部队属性浮框。
   * 下达指令、开始演出、指针离开战场时都要调 —— 否则那圈白色六边形会停在
   * 你刚才点过的格子上，看着像施法留下的印记，怎么都不消失。
   */
  function clearAim(): void {
    hover = null;
    clearTimeout(tipTimer);
    tipTimer = 0;
    tip.style.display = 'none';
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
    // 攻城：够得着的城墙/城门/箭塔也算可攻击目标
    for (const st of siegeTargets(battle, u, canShoot(battle, u))) set.add(hexKey(st.hex));
    attackableSet = set;
    // 用「回合 + 单位」做指纹：同一支部队下回合再行动时也要重算高亮
    lastActive = `${battle.round}:${u.id}`;
  }

  /* ---------------- actions ---------------- */

  function playerMove(h: Hex): boolean {
    const u = currentUnit(battle);
    if (!u || u.side !== 0 || u.moved) return false;
    clearAim();
    const paths = reachable(battle, u);
    const path = paths.get(hexKey(h));
    if (!path || !path.length) return false;
    emit(actMove(battle, u, h));
    // 移动后仍可攻击：不结束行动，只是不能再走
    recomputeOptions();
    return true;
  }

  function playerAttack(target: BattleUnit): boolean {
    const u = currentUnit(battle);
    if (!u || u.side !== 0) return false;
    clearAim();
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

  /** 砸城防：近战贴脸砸，远程隔着射。城防不会反击。 */
  function playerSiege(st: SiegeStructure): boolean {
    const u = currentUnit(battle);
    if (!u || u.side !== 0 || st.hp <= 0) return false;
    clearAim();
    const ev = actSiege(battle, u, st);
    if (!ev.length) {
      hint('够不着这段城防');
      return false;
    }
    emit(ev);
    emit(endActivation(battle));
    return true;
  }

  function doWait(): void {
    const u = currentUnit(battle);
    if (!u || u.side !== 0) return;
    clearAim();
    emit(actWait(battle, u));
    emit(endActivation(battle));
  }

  function doDefend(): void {
    const u = currentUnit(battle);
    if (!u || u.side !== 0) return;
    clearAim();
    emit(actDefend(u));
    emit(endActivation(battle));
  }

  function doFlee(): void {
    if (battle.over) return;
    emit(actFlee(battle));
  }

  function doAuto(): void {
    if (battle.over) return;
    clearAim();
    auto = true;
    hint('自动战斗中…');
  }

  /* ---------------- 施法（M4） ---------------- */

  const SPELL_FX_COLOR: Record<string, string> = {
    magicArrow: '#f4e27a',
    iceBolt: '#7fd8f5',
    lightningBolt: '#f0f0ff',
    fireball: '#ff8b3d',
    bless: '#ffe9a8',
    curse: '#a86ad8',
    haste: '#8ef0c8',
    slow: '#8fb0c8',
    shield: '#9fb8f0',
    stoneSkin: '#c8b48c',
    bloodlust: '#e05a4a',
    resurrect: '#fff3d8',
  };

  /** 这一侧能用的战斗法术。 */
  function combatSpells(): string[] {
    return battle.casters[0]?.spells.filter((id) => getSpell(id).combat) ?? [];
  }

  function manaText(): string {
    const c = battle.casters[0];
    if (!c) return '';
    return `法力 ${c.mana}`;
  }

  /** 选中/取消一个待施放的法术，进入或退出"点目标"模式。 */
  function selectSpell(id: string | null): void {
    pendingSpell = id;
    spellTargets = null;
    clearAim();
    if (!id) {
      hint('');
      renderSpellBook();
      return;
    }
    const sp = getSpell(id);
    const set = new Set<string>();
    if (sp.target === 'enemy') for (const e of aliveOf(battle, 1)) set.add(hexKey(e.hex));
    else if (sp.target === 'ally') for (const e of battle.units.filter((u) => u.side === 0)) set.add(hexKey(e.hex));
    else if (sp.target === 'point') for (let r = 0; r < FIELD_H; r++) for (let c2 = 0; c2 < FIELD_W; c2++) set.add(hexKey({ col: c2, row: r }));
    spellTargets = set;
    hint(`施放「${sp.name}」：点击${sp.target === 'enemy' ? '敌方部队' : sp.target === 'ally' ? '我方部队' : '格子'}，Esc 取消`);
    renderSpellBook();
  }

  /** 底部法术条：点一下选中，再点战场上的目标即可施放。 */
  function renderSpellBook(): void {
    const spells = combatSpells();
    if (!spells.length) {
      spellPanel.style.display = 'none';
      return;
    }
    spellPanel.innerHTML = '';
    for (const id of spells) {
      const sp = getSpell(id);
      const b = document.createElement('button');
      b.className = 'btn spell' + (pendingSpell === id ? ' on' : '');
      const usable = canCast(battle, 0, id);
      b.disabled = !usable;
      b.textContent = `${sp.name} ${sp.manaCost}`;
      b.title = sp.desc;
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (pendingSpell === id) selectSpell(null);
        else if (usable) selectSpell(id);
      });
      spellPanel.appendChild(b);
    }
    spellPanel.style.display = 'flex';
  }

  function doCast(spellId: string, target: BattleUnit | Hex | undefined): void {
    clearAim();
    const ev = castSpell(battle, 0, spellId, target);
    if (!ev.length) {
      hint('这个法术现在放不出来');
      selectSpell(null);
      return;
    }
    selectSpell(null);
    // 施法完毕就收起法术书：它叠在底部操作条上方，开着会挡住防御/等待/施法
    spellPanel.style.display = 'none';
    emit(ev);
  }

  /* ---------------- event → animation ---------------- */

  function emit(events: BattleEvent[]): void {
    for (const e of events) queue.push(e);
    // 引擎在伤害结算里就地翻 over（castSpell/actShoot/melee 的 checkOver），
    // 但 end 事件不一定是它返回的 —— 这里兜底补发，保证战斗一定能收尾
    if (battle.over && !finished && !queue.some((e) => e.t === 'end')) {
      queue.push({ t: 'end', winner: battle.winner ?? null, fled: battle.fled });
    }
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
            // 行军小颠簸：每跨一格轻轻一跳，不然像在冰面上滑行
            const bob = Math.abs(Math.sin(f * Math.PI)) * 2.5;
            posOverride[e.unitId] = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k - bob };
          },
          end: () => {
            delete posOverride[e.unitId];
          },
        };
        break;
      }
      case 'melee': {
        anim = meleeAnim(e.unitId, e.from, hexOf(e.targetId), e.damage, e.killed);
        break;
      }
      case 'siege': {
        anim = lungeAnim(e.unitId, e.from, e.to, `-${e.damage}`, 0, '#ffd08a');
        if (e.destroyed) addFloat(`${STRUCTURE_NAME[e.kind]}崩塌`, e.to, '#ff9a6b');
        break;
      }
      case 'tower': {
        const st = structureById(battle.siege, e.structureId);
        const a = hexCenter(st ? st.hex : hexOf(e.targetId));
        const b = hexCenter(hexOf(e.targetId));
        let hit = false;
        anim = {
          t: 0,
          dur: 560,
          step: (p) => {
            if (p < 0.45) {
              const k = p / 0.45;
              arrow = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * 12, tx: b.x, ty: b.y };
            } else {
              if (!hit) {
                hit = true;
                addFloat(`-${e.damage}`, hexOf(e.targetId), '#ffb347');
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
      case 'machine': {
        // 器械摆在部署区最外一列（见 BattleRenderer.drawWarMachines），
        // 动画就从那个位置发出：投石车走大抛物线，弩车走平直的直射
        const list = battle.machines?.[e.side] ?? [];
        const i = Math.max(0, list.indexOf(e.machine));
        const row = i === 0 ? 0 : FIELD_H - 1;
        const a = hexCenter(e.side === 0 ? { col: 0, row } : { col: FIELD_W - 1, row });
        const targetHex = e.structureId
          ? structureById(battle.siege, e.structureId)?.hex ?? hexOf(e.targetId ?? '')
          : hexOf(e.targetId ?? '');
        const b = hexCenter(targetHex);
        const isCat = e.machine === 'catapult';
        let hit = false;
        anim = {
          t: 0,
          dur: isCat ? 760 : 580,
          step: (p) => {
            if (p < 0.55) {
              const k = p / 0.55;
              arrow = {
                x: a.x + (b.x - a.x) * k,
                y: a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * (isCat ? 52 : 10),
                tx: b.x,
                ty: b.y,
              };
            } else {
              if (!hit) {
                hit = true;
                addFloat(`-${e.damage}`, targetHex, '#ffd08a');
                if (e.destroyed) {
                  const kind = structureById(battle.siege, e.structureId ?? '')?.kind ?? 'wall';
                  addFloat(`${STRUCTURE_NAME[kind]}崩塌`, targetHex, '#ff9a6b');
                }
                if (e.killed) addFloat(`-${e.killed}`, targetHex, '#ffdcd2');
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
      case 'retaliate': {
        anim = meleeAnim(e.unitId, hexOf(e.unitId), hexOf(e.targetId), e.damage, e.killed);
        break;
      }
      case 'shoot': {
        sfx.shoot();
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
                impacts.push({ x: b.x, y: b.y, kind: 'thrust', p: 0, dur: 280 });
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
      case 'cast': {
        const hex = e.hex ?? hexOf(e.targetId ?? '');
        const color = SPELL_FX_COLOR[e.spellId] ?? '#f0e0b0';
        const b = hexCenter(hex);
        const hitFx = (): void => {
          sfx.spell();
          if (e.damage) addFloat(`-${e.damage}`, hex, color);
          if (e.killed) addFloat(`-${e.killed}`, hex, '#ffdcd2');
          spellFx.push({ hex, life: 1, color, splash: e.splash });
        };
        if (e.spellId === 'lightningBolt') {
          // 闪电：从目标头顶劈下，命中瞬间闪白 + 伤害浮字
          bolt = { x: b.x, y: b.y, p: 1 };
          let hit = false;
          anim = {
            t: 0,
            dur: 520,
            step: (p) => {
              if (!hit && p >= 0.3) {
                hit = true;
                hitFx();
              }
            },
          };
        } else if (e.spellId === 'magicArrow' || e.spellId === 'iceBolt' || e.spellId === 'fireball') {
          // 飞行道具：从施法方第一支部队飞向目标（英雄本尊不在战场上）
          const originUnit = aliveOf(battle, e.side)[0];
          const o = originUnit ? hexCenter(originUnit.hex) : { x: e.side === 0 ? 10 : BASE_W - 30, y: BASE_H / 2 };
          let hit = false;
          anim = {
            t: 0,
            dur: 460,
            step: (p) => {
              if (p < 0.6) {
                const k = p / 0.6;
                arrow = {
                  x: o.x + (b.x - o.x) * k,
                  y: o.y + (b.y - o.y) * k - Math.sin(k * Math.PI) * 10,
                  tx: b.x,
                  ty: b.y,
                  color,
                };
              } else {
                arrow = null;
                if (!hit) {
                  hit = true;
                  hitFx();
                }
              }
            },
            end: () => {
              arrow = null;
            },
          };
        } else {
          // 增益/减益/复活：目标格光环立即亮起
          spellFx.push({ hex, life: 1, color });
          if (e.revived) addFloat(`+${e.revived}`, hex, '#9ef0a8');
          if (!e.damage && !e.revived) addFloat(getSpell(e.spellId).name, hex, color);
          anim = { t: 0, dur: 420, step: () => undefined };
        }
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

  /** 按兵种定近战表演：长杆突刺 / 重型抡砸 / 其余挥砍。 */
  function meleeStyle(unitTypeId: string): 'thrust' | 'slash' | 'smash' {
    if (unitTypeId === 'pikeman' || unitTypeId === 'spearman') return 'thrust';
    if (unitTypeId === 'ogre' || unitTypeId === 'boar') return 'smash';
    return 'slash';
  }

  /** 命中瞬间：打击特效 + 伤害浮字（浮字跟着命中走，不再提前出现）。 */
  function onMeleeHit(style: 'thrust' | 'slash' | 'smash', to: Hex, damage: number, killed: number): void {
    const c = hexCenter(to);
    impacts.push({ x: c.x, y: c.y, kind: style, p: 0, dur: style === 'smash' ? 420 : 300 });
    sfx.hit();
    addFloat(`-${damage}`, to, '#ff6b52');
    if (killed) addFloat(`-${killed}`, to, '#ffdcd2');
  }

  /**
   * 近战表演，按武器分三段：
   *   突刺 = 快进快出（0.3 命中）；挥砍 = 前冲收招（0.35）；抡砸 = 先仰后砸（0.55）。
   */
  function meleeAnim(unitId: string, from: Hex, to: Hex, damage: number, killed: number): Anim {
    const a = hexCenter(from);
    const b = hexCenter(to);
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    const style = meleeStyle(unitById(battle, unitId)?.unitTypeId ?? '');
    let hit = false;
    const push = (k: number): void => {
      lunge = { unitId, dx: dx * 7 * k, dy: dy * 5 * k };
    };
    const tryHit = (p: number, at: number): void => {
      if (!hit && p >= at) {
        hit = true;
        onMeleeHit(style, to, damage, killed);
      }
    };
    if (style === 'thrust') {
      return {
        t: 0,
        dur: 400,
        step: (p) => {
          push(p < 0.3 ? p / 0.3 : Math.max(0, 1 - (p - 0.3) / 0.7));
          tryHit(p, 0.3);
        },
        end: () => {
          lunge = null;
        },
      };
    }
    if (style === 'smash') {
      return {
        t: 0,
        dur: 660,
        step: (p) => {
          // 先往后仰（举武器），再砸下去，最后收招
          if (p < 0.25) push(-(p / 0.25) * 0.45);
          else if (p < 0.55) push(((p - 0.25) / 0.3) * 1);
          else push(Math.max(0, 1 - (p - 0.55) / 0.45));
          tryHit(p, 0.55);
        },
        end: () => {
          lunge = null;
        },
      };
    }
    return {
      t: 0,
      dur: 480,
      step: (p) => {
        push(p < 0.35 ? p / 0.35 : Math.max(0, 1 - (p - 0.35) / 0.65));
        tryHit(p, 0.35);
      },
      end: () => {
        lunge = null;
      },
    };
  }

  /** 砸城防共用的一段"前冲 + 收招"表演（无反击对象，浮字立即出）。 */
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
      // 敌方行动时收起法术书，别让它挡着玩家的视野和操作条
      if (spellPanel.style.display !== 'none') spellPanel.style.display = 'none';
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
    if (outcome.win && !outcome.fled) sfx.win();
    else sfx.lose();
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
    tipForHex(h, e);
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
    } else if (u && u.side === 0 && structureAt(battle.siege, h)) {
      const st = structureAt(battle.siege, h)!;
      const ranged = canShoot(battle, u) && !isAdjacent(u.hex, st.hex);
      const dmg = estimateSiegeDamage(battle, u, st, ranged);
      const can = siegeTargets(battle, u, ranged).some((x) => hexEq(x.hex, st.hex));
      hint(
        `${STRUCTURE_NAME[st.kind]} ${st.hp}/${st.maxHp}` +
          (can ? `　预计伤害 ${dmg}${ranged ? '（远程）' : ''}` : '　（够不着）'),
      );
    } else if (u && u.side === 0 && !u.moved && reachableSet?.has(hexKey(h))) {
      hint('移动到这里');
    } else {
      hint('');
    }
  });

  canvas.addEventListener('pointerleave', clearAim);
  // 指针滑到法术书/操作条上、或者切出去看别的东西，都不该在战场上留一圈白框
  fieldWrap.addEventListener('pointerleave', clearAim);
  window.addEventListener('blur', clearAim);
  const onHidden = (): void => {
    if (document.hidden) clearAim();
  };
  document.addEventListener('visibilitychange', onHidden);

  // 右键：立刻看这支部队的属性（左键是下命令，右键只查询）
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    tipForHex(hexFromEvent(e), e, true);
  });

  canvas.addEventListener('click', (e) => {
    if (busy()) return;
    const u = currentUnit(battle);
    if (!u || u.side !== 0) return;
    const h = hexFromEvent(e);
    if (!h) return;
    const target = unitAt(battle, h);

    // 施法模式：先取目标，再交给引擎判定合法性
    if (pendingSpell) {
      const sp = getSpell(pendingSpell);
      const t = sp.target === 'point' ? h : target ?? undefined;
      if (sp.target === 'enemy' && (!target || target.side === 0)) {
        hint('要选敌方部队');
        return;
      }
      if (sp.target === 'ally' && (!target || target.side !== 0)) {
        hint('要选我方部队');
        return;
      }
      doCast(pendingSpell, t);
      return;
    }

    if (target && target.side !== u.side) {
      if (attackableSet?.has(hexKey(h))) playerAttack(target);
      else hint('够不着，先移动过去');
      return;
    }
    // 攻城：点城墙/城门/箭塔就是砸它
    const st = structureAt(battle.siege, h);
    if (st) {
      if (attackableSet?.has(hexKey(h))) playerSiege(st);
      else hint('够不着这段城防，先靠近');
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
      // 战斗中禁止用 Esc 逃走，避免误触丢掉一场仗；只用来取消选中的法术
      if (pendingSpell) selectSpell(null);
      e.stopPropagation();
    } else if ((e.key === 'c' || e.key === 'C') && !busy()) {
      e.preventDefault();
      // 同 btnCast：开面板前先清掉悬停格
      clearAim();
      renderSpellBook();
      spellPanel.style.display = spellPanel.style.display === 'none' ? 'flex' : 'none';
    } else if (e.key === ' ' && !busy()) {
      e.preventDefault();
      doWait();
    } else if (e.key === 'd' || e.key === 'D') {
      if (!busy()) doDefend();
    } else if (e.key === '1' || e.key === '2' || e.key === '3') {
      setSpeed(Number(e.key));
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

  // 速度档位：1×→2×→3× 循环，键盘 1/2/3 直选
  const btnSpeed = document.createElement('button');
  btnSpeed.className = 'btn';
  const syncSpeed = (): void => {
    btnSpeed.textContent = `速度 ${speed}×`;
    btnSpeed.title = '演出速度（键盘 1/2/3 直选）';
  };
  const setSpeed = (v: number): void => {
    speed = v === 1 || v === 2 || v === 3 ? v : 1;
    localStorage.setItem('homm.battleSpeed', String(speed));
    syncSpeed();
  };
  btnSpeed.addEventListener('click', () => setSpeed(speed % 3 + 1));
  syncSpeed();
  headActions.append(btnSpeed, btnAuto, btnFlee);

  const btnDefend = document.createElement('button');
  btnDefend.className = 'btn';
  btnDefend.textContent = '防御 (D)';
  btnDefend.addEventListener('click', doDefend);

  const btnWait = document.createElement('button');
  btnWait.className = 'btn';
  btnWait.textContent = '等待 (空格)';
  btnWait.addEventListener('click', doWait);

  const btnCast = document.createElement('button');
  btnCast.className = 'btn';
  btnCast.textContent = '施法 (C)';
  btnCast.addEventListener('click', () => {
    if (!combatSpells().length) {
      hint('这位英雄还没学会战斗魔法（去城建魔法行会）');
      return;
    }
    const panelOpen = spellPanel.style.display !== 'none';
    spellPanel.style.display = panelOpen ? 'none' : 'flex';
    if (!panelOpen) {
      // 展开法术书也算"换了个状态"：先把上一拍的悬停格收掉，
      // 否则那圈白框会停在开面板前的位置，看着像施法留下的印记
      clearAim();
      renderSpellBook();
    } else selectSpell(null);
  });

  actionBar.append(btnDefend, btnWait, btnCast);

  /* ---------------- loop ---------------- */

  let last = performance.now();
  let raf = 0;
  function frame(now: number): void {
    // dt 统一乘速度倍率：动画、AI 间隔、飘字、打击特效一起加速
    const dt = Math.min(60, now - last) * speed;
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

    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.life -= dt / 900;
      f.y -= dt / 42;
      if (f.life <= 0) floats.splice(i, 1);
    }
    for (let i = spellFx.length - 1; i >= 0; i--) {
      spellFx[i].life -= dt / 520;
      if (spellFx[i].life <= 0) spellFx.splice(i, 1);
    }
    // 打击特效也要走生命周期 —— 之前漏了这段，p 永远停在 0，
    // 每次近战的刀光就以满透明度永远留在战场上（和悬停印记是同一类病）
    for (let i = impacts.length - 1; i >= 0; i--) {
      const im = impacts[i];
      im.p += dt / im.dur;
      if (im.p >= 1) impacts.splice(i, 1);
    }
    // 闪电同理：bolt.p 赋 1 之后没人衰减，一道雷永远钉在战场上 ——
    // 玩家报的"施法后印记一直留在战场上"，本尊就是它
    if (bolt) {
      bolt.p -= dt / 360;
      if (bolt.p <= 0) bolt = null;
    }

    const u = currentUnit(battle);
    if (u && u.side === 0 && `${battle.round}:${u.id}` !== lastActive) recomputeOptions();
    if (!u || u.side !== 0) {
      if (reachableSet || attackableSet) {
        reachableSet = null;
        attackableSet = null;
      }
    }

    roundEl.textContent = `第 ${battle.round} 回合`;
    manaEl.textContent = manaText();
    btnAuto.disabled = auto || battle.over;
    btnFlee.disabled = battle.over;
    btnDefend.disabled = busy() || !u || u.side !== 0;
    btnWait.disabled = busy() || !u || u.side !== 0 || !!u?.waited;
    btnCast.disabled = busy() || !combatSpells().length;

    // 演出中（移动/打击/敌方回合）不画悬停格：那会儿鼠标下面那圈白框
    // 既没有意义，又会被误认成"施法的印记"一直挂着
    const effHover = !busy() && u && u.side === 0 ? hover : null;
    // 调试探针：把"这一帧真正画出去的悬停格"暴露给自动化（tools/hoveraudit.mjs）。
    // 悬停残留是个纯视觉 bug，截图看不出来，只能这样断言。
    if (opts.debugProbe) {
      (window as unknown as Record<string, unknown>)['__battleHover'] = effHover
        ? [effHover.col, effHover.row]
        : null;
    }

    renderer.draw({
      battle,
      activeId: u && u.side === 0 ? u.id : null,
      reachable: reachableSet,
      attackable: attackableSet,
      hover: effHover,
      posOverride,
      lunge,
      arrow,
      floats,
      spellTargets,
      spellFx,
      bolt,
      impacts,
      time: now,
    });
    raf = requestAnimationFrame(frame);
  }

  /* ---------------- lifecycle ---------------- */

  function close(): void {
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('blur', clearAim);
    document.removeEventListener('visibilitychange', onHidden);
    if (root.parentElement) root.parentElement.removeChild(root);
    document.body.classList.remove('in-battle');
    openRef = null;
  }

  openRef = { close };

  fit();
  recomputeOptions();
  pushLog('战斗开始');
  hint('鼠标停在部队上（或右键点击）查看它的属性');
  // 调试：?devspell=1 进场就展开法术面板（截图验证用）
  if (new URLSearchParams(location.search).has('devspell')) renderSpellBook();
  raf = requestAnimationFrame(frame);
  if (opts.autoStart) window.setTimeout(doAuto, 500);
}

/** 供 UI 直接展示的一行兵力描述（也用于结算弹窗）。 */
export function describeBattleArmy(side: BattleState, who: 0 | 1): string {
  const list = aliveOf(side, who);
  if (!list.length) return '（全灭）';
  return list.map((u) => `${getUnit(u.unitTypeId).name} ×${u.count}`).join('，');
}
