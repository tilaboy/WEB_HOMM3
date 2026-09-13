import type { Army, GameState, GridPos, GuardReward, MapObject, MinePayload } from './core/types.js';
import { HERO_SIGHT, createGame } from './core/map/generator.js';
import { buildPath, computePaths, stepCost } from './core/map/pathfinding.js';
import type { PathField } from './core/map/pathfinding.js';
import { revealAround, isRevealed } from './core/map/fog.js';
import { idx, inBounds } from './core/map/grid.js';
import { TERRAIN } from './core/data/terrains.js';
import { getUnit } from './core/data/units.js';
import {
  applyInteraction,
  battleSetup,
  describeArmy,
  describeGuard,
  pendingObjectAt,
  previewInteraction,
} from './core/game/interaction.js';
import { openBattleScreen, isBattleOpen } from './ui/BattleScreen.js';
import type { BattleOutcome } from './core/combat/battle.js';
import { endDay } from './core/game/turn.js';
import { Camera } from './render/camera.js';
import { MapRenderer } from './render/MapRenderer.js';
import { HUD } from './ui/HUD.js';
import { HeroPanel } from './ui/HeroPanel.js';
import { openTownDialog } from './ui/TownDialog.js';
import { closeModal, hideInfoPopup, isModalOpen, lossTable, showInfoPopup, showModal } from './ui/Dialogs.js';
import { clearSave, loadGame, saveGame } from './save/persistence.js';

/* ---------------- shell ---------------- */

const app = document.getElementById('app') as HTMLElement;

const topbar = document.createElement('div');
topbar.id = 'topbar';
app.appendChild(topbar);

const stage = document.createElement('div');
stage.id = 'stage';
app.appendChild(stage);

const canvas = document.createElement('canvas');
canvas.id = 'map';
stage.appendChild(canvas);

const logbox = document.createElement('div');
logbox.id = 'logbox';
stage.appendChild(logbox);

const side = document.createElement('aside');
side.id = 'side';
stage.appendChild(side);

const toggle = document.createElement('button');
toggle.id = 'panel-toggle';
toggle.className = 'btn';
toggle.textContent = '收起面板';
toggle.addEventListener('click', () => {
  side.classList.toggle('collapsed');
  toggle.textContent = side.classList.contains('collapsed') ? '展开面板' : '收起面板';
});
side.appendChild(toggle);

const sideBody = document.createElement('div');
side.appendChild(sideBody);

const hintEl = document.createElement('div');
hintEl.id = 'hint';
hintEl.textContent = '点击地图移动英雄，右键（或长按）查看信息';
stage.appendChild(hintEl);

/* ---------------- state ---------------- */

let state: GameState = loadGame() ?? createGame();
let selected: string | null = state.heroOrder[0] ?? null;
let fieldFull: PathField | null = null;
let fieldTurn: PathField | null = null;
let previewPath: GridPos[] | null = null;
let hover: GridPos | null = null;
let anim: { heroId: string; path: GridPos[]; i: number; t: number } | null = null;
/** 英雄踏入当前格之前所在的格子，野怪战撤退时要退回这里 */
let lastStepFrom: GridPos | null = null;
const heroRender: Record<string, { x: number; y: number }> = {};

const camera = new Camera();
camera.mapW = state.map.width;
camera.mapH = state.map.height;
const renderer = new MapRenderer(canvas, camera);

/** 打开城镇面板：城里有英雄就带上他，没有就远程管理（只能补驻军）。 */
function openTownById(townId: string): void {
  const town = state.towns[townId];
  if (!town) return;
  const heroId: string | null =
    state.heroOrder.find((id) => {
      const h = state.heroes[id];
      return h && h.pos.x === town.pos.x && h.pos.y === town.pos.y;
    }) ?? null;
  openTownDialog(stage, {
    state,
    townId,
    heroId,
    onChange: () => {
      recomputeField();
      refresh();
      renderLog();
      saveGame(state);
    },
    onHire: (newHeroId) => {
      const nh = state.heroes[newHeroId];
      if (nh) revealAround(state, nh.owner, nh.pos, HERO_SIGHT);
      selected = newHeroId;
      recomputeField();
      refresh();
    },
  });
}

function locateTown(townId: string): void {
  const town = state.towns[townId];
  if (!town) return;
  camera.centerOn(town.pos.x, town.pos.y);
  hint(`${town.name} · (${town.pos.x}, ${town.pos.y})`);
}

const panel = new HeroPanel(
  sideBody,
  (id) => {
    if (isModalOpen() || anim) return;
    selected = id;
    const h = state.heroes[id];
    if (h) camera.centerOn(h.pos.x, h.pos.y);
    recomputeField();
    refresh();
  },
  { onLocate: locateTown, onOpen: openTownById },
);

const hud = new HUD(
  topbar,
  () => doEndDay(),
  () => {
    saveGame(state);
    hint('已存档');
  },
  () => doRestart(),
);

const STEP_MS = 165;

function hint(text: string): void {
  hintEl.textContent = text;
}

function recomputeField(): void {
  const hero = selected ? state.heroes[selected] : null;
  if (!hero) {
    fieldFull = null;
    fieldTurn = null;
    previewPath = null;
    return;
  }
  fieldFull = computePaths(state, hero.pos, Infinity);
  fieldTurn = computePaths(state, hero.pos, hero.movePoints);
  for (const id of state.heroOrder) {
    const h = state.heroes[id];
    if (h && !anim) heroRender[id] = { x: h.pos.x, y: h.pos.y };
  }
}

function refresh(): void {
  hud.update(state);
  panel.update(state, selected);
}

function renderLog(): void {
  logbox.innerHTML = '';
  for (const e of state.log.slice(-5)) {
    const d = document.createElement('div');
    d.textContent = `D${e.day} · ${e.text}`;
    logbox.appendChild(d);
  }
}

/* ---------------- movement ---------------- */

function tryMove(target: GridPos): void {
  const hero = selected ? state.heroes[selected] : null;
  if (!hero || anim || isModalOpen()) return;
  if (hero.movePoints <= 0) {
    hint('移动力已耗尽，点击右上角「结束一天」');
    return;
  }
  const f = computePaths(state, hero.pos, Infinity);
  const p = buildPath(state, f, hero.pos, target);
  if (!p.length) {
    hint('那里去不了');
    return;
  }
  anim = { heroId: selected as string, path: p, i: 0, t: 0 };
  previewPath = null;
}

function tickAnim(dt: number): void {
  if (!anim) return;
  const hero = state.heroes[anim.heroId];
  if (!hero) {
    anim = null;
    return;
  }
  anim.t += dt;
  while (anim.i < anim.path.length && anim.t >= STEP_MS) {
    anim.t -= STEP_MS;
    const to = anim.path[anim.i];
    const cost = stepCost(state, hero.pos, to);
    if (cost > hero.movePoints) {
      anim = null;
      hint('移动力不足，剩余行程明日再走');
      recomputeField();
      refresh();
      return;
    }
    lastStepFrom = { x: hero.pos.x, y: hero.pos.y };
    hero.pos = to;
    hero.movePoints -= cost;
    anim.i += 1;
    revealAround(state, hero.owner, hero.pos, HERO_SIGHT);
    const obj = pendingObjectAt(state, anim.heroId);
    if (obj) {
      const heroId = anim.heroId;
      anim = null;
      recomputeField();
      refresh();
      onArrive(heroId, obj);
      return;
    }
  }
  if (anim && anim.i >= anim.path.length) {
    anim = null;
    recomputeField();
    refresh();
    saveGame(state);
  }
}

function updateHeroRender(): void {
  for (const id of state.heroOrder) {
    const h = state.heroes[id];
    if (!h) continue;
    if (anim && anim.heroId === id) {
      const from = anim.i > 0 ? anim.path[anim.i - 1] : h.pos;
      const to = anim.i < anim.path.length ? anim.path[anim.i] : h.pos;
      const k = Math.min(1, anim.t / STEP_MS);
      heroRender[id] = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    } else {
      heroRender[id] = { x: h.pos.x, y: h.pos.y };
    }
  }
}

/* ---------------- interaction ---------------- */

function onArrive(heroId: string, obj: MapObject): void {
  const pending = previewInteraction(state, heroId, obj.id);
  if (!pending) return;

  if (pending.kind === 'info') {
    showModal(stage, {
      title: pending.title,
      body: [pending.message],
      actions: [{ label: '知道了', primary: true, onClick: (c) => c() }],
    });
    return;
  }

  if (pending.kind === 'town' && pending.townId) {
    openTownById(pending.townId);
    return;
  }

  if (pending.kind === 'siege' && pending.townId) {
    const town = state.towns[pending.townId];
    const garrison = town ? town.garrison.filter((s) => s.count > 0) : [];
    if (!garrison.length) {
      resolve(heroId, obj, true);
      return;
    }
    const est = pending.estimate!;
    const hero = state.heroes[heroId];
    const rows: [string, string][] = [
      ['我方兵力', describeArmy(hero.army)],
      ['守军', describeArmy(garrison)],
    ];
    for (const l of est.losses) {
      rows.push([getUnit(l.unitTypeId).name, `${l.before} → ${l.after}`]);
    }
    showModal(stage, {
      title: pending.title,
      body: [pending.message, `${pending.lossText ?? ''}（预估，实战结果取决于走位）`, lossTable(rows)],
      actions: [
        { label: '撤退', danger: true, onClick: (c) => { c(); resolve(heroId, obj, false); } },
        { label: '进入战场', primary: true, onClick: (c) => { c(); startBattle(heroId, obj, pending.title); } },
      ],
    });
    return;
  }

  if (pending.kind === 'battle' && pending.estimate) {
    const est = pending.estimate;
    const hero = state.heroes[heroId];
    const monster = obj.payload as { army: Army; guard?: GuardReward };
    const rows: [string, string][] = [
      ['我方兵力', describeArmy(hero.army)],
      ['敌方兵力', describeArmy(monster.army)],
    ];
    if (monster.guard) rows.push(['它们看守着', describeGuard(monster.guard)]);
    for (const l of est.losses) {
      rows.push([`${getUnit(l.unitTypeId).name}`, `${l.before} → ${l.after}`]);
    }
    showModal(stage, {
      title: pending.title,
      body: [pending.message, pending.lossText ?? '', lossTable(rows)],
      actions: [
        { label: '撤退（退回原地）', danger: true, onClick: (c) => { c(); resolve(heroId, obj, false); } },
        { label: '开战', primary: true, onClick: (c) => { c(); resolve(heroId, obj, true); } },
      ],
    });
    return;
  }

  resolve(heroId, obj, true);
}

/** 打开 M3 战术战斗；战斗结束后用真实战果推进世界状态。 */
function startBattle(heroId: string, obj: MapObject, title: string): void {
  const setup = battleSetup(state, heroId, obj);
  if (!setup) {
    resolve(heroId, obj, true);
    return;
  }
  openBattleScreen(stage, {
    state,
    heroId,
    title,
    attacker: setup.attacker,
    defender: setup.defender,
    seed: setup.seed,
    onDone: (outcome: BattleOutcome) => resolve(heroId, obj, true, outcome),
  });
}

function resolve(heroId: string, obj: MapObject, accept: boolean, outcome?: BattleOutcome): void {
  const res = applyInteraction(state, heroId, obj.id, accept, { retreatTo: lastStepFrom, outcome });
  recomputeField();
  refresh();
  renderLog();
  saveGame(state);
  if (res.heroDefeated) {
    showGameOver();
    return;
  }
  if (!res.title) return;

  // 攻下城镇后直接进城管理
  if (obj.kind === 'town') {
    const townId = (obj.payload as { townId: string }).townId;
    const town = state.towns[townId];
    if (town && town.owner === 'p1') {
      const lines: (Node | string)[] = [res.message];
      if (res.levelUps.length) lines.push(`升级！${res.levelUps.join('、')}`);
      showModal(stage, {
        title: res.title,
        body: lines,
        actions: [
          { label: '关闭', onClick: (c) => c() },
          {
            label: '进城管理',
            primary: true,
            onClick: (c) => {
              c();
              openTownById(townId);
            },
          },
        ],
      });
      return;
    }
  }

  const body: (Node | string)[] = [res.message];
  if (res.levelUps.length) body.push(`升级！${res.levelUps.join('、')}`);
  showModal(stage, {
    title: res.title,
    body,
    actions: [{ label: '继续', primary: true, onClick: (c) => c() }],
  });
}

function showGameOver(): void {
  selected = null;
  recomputeField();
  refresh();
  showModal(stage, {
    title: '英雄陨落',
    body: ['最后一位英雄倒在了荒野上。'],
    actions: [
      {
        label: '重新开始',
        primary: true,
        onClick: (c) => {
          c();
          doRestart();
        },
      },
    ],
  });
}

function doRestart(): void {
  clearSave();
  state = createGame();
  selected = state.heroOrder[0] ?? null;
  camera.mapW = state.map.width;
  camera.mapH = state.map.height;
  anim = null;
  hover = null;
  const hero = selected ? state.heroes[selected] : null;
  if (hero) camera.centerOn(hero.pos.x, hero.pos.y);
  closeModal();
  recomputeField();
  refresh();
  renderLog();
  hint('新的一局开始了');
}

function doEndDay(): void {
  if (isModalOpen() || anim || isBattleOpen()) return;
  endDay(state);
  lastStepFrom = null;
  recomputeField();
  refresh();
  renderLog();
  saveGame(state);
  hint('新的一天');
}

/* ---------------- input ---------------- */

const pointers = new Map<number, { x: number; y: number }>();
let dragged = false;
let lastPan: { x: number; y: number } | null = null;
let pinchDist = 0;
let longPress = 0;

function twoPointerDist(): number {
  const pts = [...pointers.values()];
  if (pts.length < 2) return 0;
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

function localPos(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  hideInfoPopup();
  if (pointers.size === 1) {
    dragged = false;
    lastPan = { x: e.clientX, y: e.clientY };
    window.clearTimeout(longPress);
    longPress = window.setTimeout(() => {
      if (!dragged && pointers.size === 1) {
        const p = localPos(e);
        showTileInfo(p.x, p.y);
        dragged = true;
      }
    }, 420);
  } else if (pointers.size === 2) {
    pinchDist = twoPointerDist();
    dragged = true;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (prev) {
    prev.x = e.clientX;
    prev.y = e.clientY;
  }
  if (pointers.size === 1 && lastPan) {
    const dx = e.clientX - lastPan.x;
    const dy = e.clientY - lastPan.y;
    if (!dragged && Math.abs(dx) + Math.abs(dy) > 4) {
      dragged = true;
      window.clearTimeout(longPress);
    }
    if (dragged) {
      camera.pan(dx, dy);
      lastPan = { x: e.clientX, y: e.clientY };
      hideInfoPopup();
    }
  } else if (pointers.size === 2) {
    const d = twoPointerDist();
    if (pinchDist && d) {
      const pts = [...pointers.values()];
      const r = canvas.getBoundingClientRect();
      const mx = (pts[0].x + pts[1].x) / 2 - r.left;
      const my = (pts[0].y + pts[1].y) / 2 - r.top;
      camera.zoomAt(mx, my, d / pinchDist);
    }
    pinchDist = d;
  }
  if (!dragged) updateHover(e);
});

function endPointer(e: PointerEvent): void {
  window.clearTimeout(longPress);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (pointers.size === 0) {
    if (!dragged) handleClick(e);
    lastPan = null;
  }
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = localPos(e);
  camera.zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const p = localPos(e);
  showTileInfo(p.x, p.y);
});

function handleClick(e: PointerEvent): void {
  if (isModalOpen()) {
    closeModal();
    return;
  }
  hideInfoPopup();
  const p = localPos(e);
  const g = camera.pick(p.x, p.y);
  if (!inBounds(state.map, g.x, g.y)) return;

  for (const id of state.heroOrder) {
    const h = state.heroes[id];
    if (h && h.pos.x === g.x && h.pos.y === g.y) {
      selected = id;
      recomputeField();
      refresh();
      // 站在物件上时点击自己 = 重新打开交互（此时没有「上一格」可退）
      const obj = pendingObjectAt(state, id);
      if (obj) {
        lastStepFrom = null;
        onArrive(id, obj);
        return;
      }
      hint(`已选中 ${h.name}`);
      return;
    }
  }
  if (selected) tryMove(g);
}

function updateHover(e: PointerEvent): void {
  const p = localPos(e);
  const g = camera.pick(p.x, p.y);
  if (!inBounds(state.map, g.x, g.y)) {
    hover = null;
    previewPath = null;
    return;
  }
  hover = g;
  const i = idx(state.map, g.x, g.y);
  if (!isRevealed(state, 'p1', g.x, g.y)) {
    hint('未探索的区域');
    previewPath = null;
    return;
  }
  const t = state.map.tiles[i];
  const terrain = TERRAIN[t.terrain];
  let text = terrain.passable ? `${terrain.name} · 移动消耗 ${terrain.moveCost}` : `${terrain.name} · 不可通行`;
  const cost = fieldFull ? fieldFull.cost[i] : Infinity;
  if (isFinite(cost) && cost > 0) text += ` · 抵达需 ${Math.round(cost)} 移动力`;
  const hero = selected ? state.heroes[selected] : null;
  if (hero && fieldFull && isFinite(cost) && cost > 0) {
    const path = buildPath(state, fieldFull, hero.pos, g);
    previewPath = path.length ? path : null;
    if (cost > hero.movePoints) text += '（今日移动力不足）';
  } else {
    previewPath = null;
  }
  if (t.objectId) {
    const obj = state.map.objects[t.objectId];
    if (obj) text += ` · ${objectLabel(obj)}`;
  }
  hint(text);
}

function objectLabel(obj: MapObject): string {
  switch (obj.kind) {
    case 'wanderingMonster': {
      const p = obj.payload as { army: Army; guard?: GuardReward };
      const g = p.guard ? `（看守 ${describeGuard(p.guard)}）` : '';
      return `野怪：${describeArmy(p.army)}${g}`;
    }
    case 'treasureChest':
      return '宝箱';
    case 'resourcePile':
      return `资源堆 ×${(obj.payload as { amount: number }).amount}`;
    case 'fountain':
      return '清泉';
    case 'artifact':
      return '地面宝物';
    case 'mine': {
      const p = obj.payload as MinePayload;
      return `${RESOURCE_TEXT[p.resource] ?? p.resource}矿 · 每日 +${p.perDay}`;
    }
    case 'town':
      return state.towns[(obj.payload as { townId: string }).townId]?.name ?? '城镇';
    default:
      return '障碍';
  }
}

const RESOURCE_TEXT: Record<string, string> = {
  gold: '金币', wood: '木材', ore: '矿石',
};

function showTileInfo(sx: number, sy: number): void {
  const g = camera.pick(sx, sy);
  if (!inBounds(state.map, g.x, g.y) || !isRevealed(state, 'p1', g.x, g.y)) return;
  const t = state.map.tiles[idx(state.map, g.x, g.y)];
  const terrain = TERRAIN[t.terrain];
  const obj = t.objectId ? state.map.objects[t.objectId] : null;
  const title = obj ? objectLabel(obj) : terrain.name;
  const desc = obj
    ? `${describeObject(obj)}\n${terrain.name} · 移动消耗 ${terrain.moveCost}`
    : `移动消耗 ${terrain.moveCost}`;
  showInfoPopup(stage, sx, sy, title, desc);
}

function describeObject(obj: MapObject): string {
  switch (obj.kind) {
    case 'wanderingMonster': {
      const p = obj.payload as { army: Army; guard?: GuardReward };
      const g = p.guard ? `\n看守着：${describeGuard(p.guard)}，只有取胜才能拿到` : '';
      return `守卫：${describeArmy(p.army)}${g}`;
    }
    case 'treasureChest':
      return '一只落满灰尘的箱子，也许装着金币。';
    case 'resourcePile':
      return '散落的资源，英雄经过时会自动拾取。';
    case 'fountain':
      return '清冽的泉水，饮下可恢复一半移动力。';
    case 'artifact':
      return '遗落的宝物，拾取后可装备。';
    case 'mine': {
      const p = obj.payload as MinePayload;
      return `一座${RESOURCE_TEXT[p.resource] ?? p.resource}矿，每日产出 +${p.perDay}。`;
    }
    case 'town':
      return '一处据点，占领后可以建设与征兵。';
    default:
      return '无法通行的地形。';
  }
}

window.addEventListener('keydown', (e) => {
  if (isBattleOpen()) return;
  if (e.key === 'Escape') {
    closeModal();
    hideInfoPopup();
  } else if (e.key === 'Enter' && !isModalOpen()) {
    doEndDay();
  } else if (e.key === ' ' && selected) {
    e.preventDefault();
    const h = state.heroes[selected];
    if (h) camera.centerOn(h.pos.x, h.pos.y);
  }
});

window.addEventListener('resize', () => {
  renderer.resize();
  camera.clamp();
});

/* ---------------- loop ---------------- */

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(60, now - last);
  last = now;
  if (anim) tickAnim(dt);
  updateHeroRender();
  renderer.draw({
    state,
    player: 'p1',
    sight: HERO_SIGHT,
    reachable: fieldTurn ? fieldTurn.cost : null,
    path: previewPath,
    hover,
    selectedHeroId: selected,
    heroRender,
  });
  requestAnimationFrame(frame);
}

/* ---------------- boot ---------------- */

const startHero = selected ? state.heroes[selected] : null;
let centered = false;

renderer.resize();
if (startHero) camera.centerOn(startHero.pos.x, startHero.pos.y);

// 布局尺寸变化（首帧、窗口缩放、面板收起）都要重建画布分辨率
const ro = new ResizeObserver(() => {
  renderer.resize();
  camera.clamp();
  if (!centered && startHero) {
    camera.centerOn(startHero.pos.x, startHero.pos.y);
    centered = true;
  }
});
ro.observe(stage);

recomputeField();
refresh();
renderLog();

requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

// 调试入口：?devbattle=1 直接开一场固定阵容的战斗，用于截图与验证，不影响正常流程
if (new URLSearchParams(location.search).has('devbattle') && selected && state.heroes[selected]) {
  openBattleScreen(stage, {
    state,
    heroId: selected,
    title: '调试战斗',
    attacker: {
      army: [
        { unitTypeId: 'archer', count: 20 },
        { unitTypeId: 'pikeman', count: 12 },
        { unitTypeId: 'knight', count: 6 },
      ],
      attack: 3,
      defense: 4,
    },
    defender: {
      army: [
        { unitTypeId: 'wolf', count: 26 },
        { unitTypeId: 'boar', count: 13 },
        { unitTypeId: 'ogre', count: 11 },
      ],
      attack: 0,
      defense: 0,
    },
    seed: 20260913,
    autoStart: new URLSearchParams(location.search).has('devauto'),
    instant: new URLSearchParams(location.search).has('devinstant'),
    onDone: () => hint('调试战斗结束'),
  });
}
