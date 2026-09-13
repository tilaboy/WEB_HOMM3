import type {
  Army,
  GameState,
  GridPos,
  GuardReward,
  MapObject,
  MinePayload,
} from '../types.js';
import { ARTIFACTS } from '../data/artifacts.js';
import { getUnit } from '../data/units.js';
import { idx, isPassable, objectAt } from '../map/grid.js';
import { simulateBattle, lossGrade, lossRatio } from '../combat/solver.js';
import type { BattleOutcome } from '../combat/solver.js';
import { deriveSeed } from '../rng.js';
import { addResources, effectivePrimary, gainExp, maxMovePoints } from './hero.js';
import { townDefenseBonus, captureTown } from './town.js';
import { pushLog } from './turn.js';

export interface PendingInteraction {
  objId: string;
  kind: 'battle' | 'pickup' | 'info' | 'town' | 'siege';
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  estimate?: BattleOutcome;
  lossText?: string;
  townId?: string;
}

export interface InteractionResult {
  title: string;
  message: string;
  levelUps: string[];
  heroDefeated: boolean;
}

const RESOURCE_NAME: Record<string, string> = {
  gold: '金币', wood: '木材', ore: '矿石',
  gem: '宝石', crystal: '水晶', sulfur: '硫磺', mercury: '水银',
};

/** 把守卫奖励翻译成一句人话。 */
export function describeGuard(guard: GuardReward | undefined): string {
  if (!guard) return '';
  switch (guard.kind) {
    case 'gold':
      return `${guard.amount} 金币`;
    case 'resource':
      return `${RESOURCE_NAME[guard.resource] ?? guard.resource} ×${guard.amount}`;
    case 'artifact':
      return `宝物「${ARTIFACTS[guard.artifactId]?.name ?? '未知'}」`;
    case 'mine':
      return `${RESOURCE_NAME[guard.resource] ?? guard.resource}矿（占领后每日 +${guard.perDay}）`;
    default:
      return '';
  }
}

export function describeArmy(army: Army): string {
  if (!army.length) return '（空）';
  return army.map((s) => `${getUnit(s.unitTypeId).name} ×${s.count}`).join('，');
}

function removeObject(state: GameState, obj: MapObject): void {
  const t = state.map.tiles[idx(state.map, obj.pos.x, obj.pos.y)];
  if (t.objectId === obj.id) t.objectId = null;
  delete state.map.objects[obj.id];
}

function battleSeed(state: GameState, obj: MapObject): number {
  return deriveSeed(state.seed, obj.pos.x * 131 + obj.pos.y * 17, state.day);
}

function sides(state: GameState, heroId: string, obj: MapObject) {
  const hero = state.heroes[heroId];
  const p = effectivePrimary(hero);
  const monster = obj.payload as { army: Army };
  return {
    attacker: { army: hero.army, attack: p.attack, defense: p.defense },
    defender: { army: monster.army, attack: 0, defense: 0 },
  };
}

/** 英雄站上物件所在格时调用，返回需要展示给玩家的内容（战斗需要二次确认）。 */
export function previewInteraction(state: GameState, heroId: string, objId: string): PendingInteraction | null {
  const hero = state.heroes[heroId];
  const obj = state.map.objects[objId];
  if (!hero || !obj) return null;
  const p = effectivePrimary(hero);

  switch (obj.kind) {
    case 'wanderingMonster': {
      const payload = obj.payload as { army: Army; tier: string; guard?: GuardReward };
      const { attacker, defender } = sides(state, heroId, obj);
      const outcome = simulateBattle(attacker, defender, battleSeed(state, obj));
      const ratio = lossRatio(outcome);
      const grade = lossGrade(ratio);
      const tierName = { weak: '零星散兵', mid: '成群野兽', strong: '强悍守卫' }[payload.tier] ?? '未知';
      const guardText = describeGuard(payload.guard);
      return {
        objId,
        kind: 'battle',
        title: `遭遇${tierName}`,
        message:
          `对方兵力：${describeArmy(payload.army)}。` +
          (guardText ? `\n它们看守着：${guardText}，只有取胜才能拿到。` : '') +
          `\n预估战果：${outcome.win ? '可以取胜' : '难以攻克'}。`,
        confirmLabel: '开战',
        cancelLabel: '撤退',
        estimate: outcome,
        lossText: `${grade.text}（约损失 ${Math.round(ratio * 100)}% 兵力）`,
      };
    }
    case 'treasureChest': {
      const p = obj.payload as { gold: number; artifactId?: string };
      return {
        objId, kind: 'pickup', title: '宝箱',
        message: p.artifactId
          ? `打开宝箱，获得 ${p.gold} 金币与宝物「${ARTIFACTS[p.artifactId]?.name ?? '未知'}」。`
          : `打开宝箱，获得 ${p.gold} 金币。`,
      };
    }
    case 'resourcePile': {
      const p = obj.payload as { resource: string; amount: number };
      return {
        objId, kind: 'pickup', title: '资源堆',
        message: `拾取 ${RESOURCE_NAME[p.resource] ?? p.resource} ×${p.amount}。`,
      };
    }
    case 'artifact': {
      const p = obj.payload as { artifactId: string };
      const def = ARTIFACTS[p.artifactId];
      return {
        objId, kind: 'pickup', title: '宝物',
        message: def ? `发现宝物「${def.name}」：${def.desc}` : '发现一件不知名的宝物。',
      };
    }
    case 'fountain': {
      return {
        objId, kind: 'pickup', title: '清泉',
        message: '饮下清冽的泉水，今日移动力恢复一半。',
      };
    }
    case 'mine': {
      const p = obj.payload as MinePayload;
      const res = RESOURCE_NAME[p.resource] ?? p.resource;
      return {
        objId, kind: 'info', title: `${res}矿`,
        message: p.owner === hero.owner
          ? `我方矿场，每日产出 ${res} +${p.perDay}。`
          : '敌方矿场，占领后才能产出。',
      };
    }
    case 'town': {
      const townId = (obj.payload as { townId: string }).townId;
      const town = state.towns[townId];
      if (!town) return null;
      if (town.owner === hero.owner) {
        return { objId, kind: 'town', townId, title: town.name, message: '我方据点。' };
      }
      // 敌方 / 中立城镇：攻城战
      const garrison = town.garrison.filter((s) => s.count > 0);
      if (!garrison.length) {
        return {
          objId, kind: 'siege', townId, title: `占领 ${town.name}`,
          message: '城中无人防守，可以直接接管。',
          confirmLabel: '接管', cancelLabel: '离开',
        };
      }
      const outcome = simulateBattle(
        { army: hero.army, attack: p.attack, defense: p.defense },
        { army: garrison, attack: 0, defense: townDefenseBonus(town) },
        battleSeed(state, obj),
      );
      const ratio = lossRatio(outcome);
      return {
        objId, kind: 'siege', townId,
        title: `进攻 ${town.name}`,
        message: `守军：${describeArmy(garrison)}。预估战果：${outcome.win ? '可以攻下' : '难以攻克'}。`,
        confirmLabel: '攻城',
        cancelLabel: '撤退',
        estimate: outcome,
        lossText: `${lossGrade(ratio).text}（约损失 ${Math.round(ratio * 100)}% 兵力）`,
      };
    }
    default:
      return null;
  }
}

/** 执行交互的可选项。retreatTo 用于野怪战撤退时把英雄推回上一格（打不赢就不能通过）。 */
export interface InteractionOptions {
  retreatTo?: GridPos | null;
}

/** 执行交互。战斗的 accept=false 表示撤退。 */
export function applyInteraction(
  state: GameState,
  heroId: string,
  objId: string,
  accept: boolean,
  opts: InteractionOptions = {},
): InteractionResult {
  const hero = state.heroes[heroId];
  const obj = state.map.objects[objId];
  const empty: InteractionResult = { title: '', message: '', levelUps: [], heroDefeated: false };
  if (!hero || !obj) return empty;

  if (obj.kind === 'wanderingMonster') {
    const payload = obj.payload as { army: Army; guard?: GuardReward };
    if (!accept) {
      hero.army = hero.army
        .map((s) => ({ ...s, count: Math.floor(s.count * 0.6) }))
        .filter((s) => s.count > 0);
      hero.movePoints = 0;
      // 打不赢就别想过去：退回踏入前的那一格
      const back = opts.retreatTo;
      let pushed = false;
      if (back && (back.x !== hero.pos.x || back.y !== hero.pos.y) && isPassable(state.map, back.x, back.y)) {
        hero.pos = { x: back.x, y: back.y };
        pushed = true;
      }
      pushLog(state, `${hero.name} 选择撤退，损失四成兵力`);
      return {
        title: '撤退',
        message: pushed
          ? '部队在撤退中折损了四成，被挡回原地，今日行动结束。'
          : '部队在撤退中折损了四成，今日行动结束。',
        levelUps: [],
        heroDefeated: false,
      };
    }

    const { attacker, defender } = sides(state, heroId, obj);
    const outcome = simulateBattle(attacker, defender, battleSeed(state, obj));
    hero.army = outcome.survivors;

    if (outcome.win) {
      removeObject(state, obj);
      const notes = gainExp(state, hero, outcome.expGained);
      const loot = grantGuard(state, heroId, obj.pos, payload.guard);
      pushLog(state, `${hero.name} 击败了 ${describeArmy(payload.army)}${loot ? `，${loot}` : ''}`);
      return {
        title: '战斗胜利',
        message:
          `敌军被全歼，获得 ${outcome.expGained} 点经验。` +
          (loot ? `\n缴获：${loot}。` : '') +
          `\n剩余兵力：${describeArmy(hero.army)}。`,
        levelUps: notes,
        heroDefeated: false,
      };
    }

    delete state.heroes[heroId];
    state.heroOrder = state.heroOrder.filter((id) => id !== heroId);
    pushLog(state, `${hero.name} 全军覆没`);
    return {
      title: '全军覆没',
      message: `${hero.name} 的部队被 ${describeArmy(payload.army)} 击溃。`,
      levelUps: [],
      heroDefeated: true,
    };
  }

  if (obj.kind === 'town') {
    const town = state.towns[(obj.payload as { townId: string }).townId];
    if (!town) return empty;
    // 我方城镇由 UI 打开管理面板，这里不做事
    if (town.owner === hero.owner) return empty;

    if (!accept) {
      hero.movePoints = 0;
      pushLog(state, `${hero.name} 在 ${town.name} 城下撤军`);
      return { title: '撤军', message: '你收拢了部队，今日不再行动。', levelUps: [], heroDefeated: false };
    }

    const garrison = town.garrison.filter((s) => s.count > 0);
    if (!garrison.length) {
      captureTown(state, town, hero.owner);
      return {
        title: '兵不血刃',
        message: `${town.name} 已挂上你的旗帜。`,
        levelUps: [], heroDefeated: false,
      };
    }

    const outcome = simulateBattle(
      { army: hero.army, attack: effectivePrimary(hero).attack, defense: effectivePrimary(hero).defense },
      { army: garrison, attack: 0, defense: townDefenseBonus(town) },
      battleSeed(state, obj),
    );
    hero.army = outcome.survivors;

    if (outcome.win) {
      captureTown(state, town, hero.owner);
      const notes = gainExp(state, hero, outcome.expGained);
      pushLog(state, `${hero.name} 攻陷了 ${town.name}`);
      return {
        title: '攻陷城镇',
        message: `守军被击溃，${town.name} 归我方所有。获得 ${outcome.expGained} 点经验，剩余兵力：${describeArmy(hero.army)}。`,
        levelUps: notes,
        heroDefeated: false,
      };
    }

    delete state.heroes[heroId];
    state.heroOrder = state.heroOrder.filter((id) => id !== heroId);
    pushLog(state, `${hero.name} 在 ${town.name} 城下全军覆没`);
    return {
      title: '全军覆没',
      message: `${hero.name} 的部队被 ${town.name} 的守军击溃。`,
      levelUps: [],
      heroDefeated: true,
    };
  }

  switch (obj.kind) {
    case 'treasureChest': {
      const p = obj.payload as { gold: number; artifactId?: string };
      addResources(state, hero.owner, { gold: p.gold });
      let extra = '';
      if (p.artifactId) extra = equipArtifact(state, heroId, p.artifactId);
      removeObject(state, obj);
      pushLog(state, `获得 ${p.gold} 金币${extra}`);
      return { title: '宝箱', message: `获得 ${p.gold} 金币。${extra}`, levelUps: [], heroDefeated: false };
    }
    case 'resourcePile': {
      const p = obj.payload as { resource: keyof typeof RESOURCE_NAME; amount: number };
      addResources(state, hero.owner, { [p.resource]: p.amount } as never);
      removeObject(state, obj);
      pushLog(state, `拾取 ${RESOURCE_NAME[p.resource]} ×${p.amount}`);
      return { title: '资源堆', message: `${RESOURCE_NAME[p.resource]} +${p.amount}。`, levelUps: [], heroDefeated: false };
    }
    case 'artifact': {
      const p = obj.payload as { artifactId: string };
      const note = equipArtifact(state, heroId, p.artifactId);
      removeObject(state, obj);
      pushLog(state, note);
      return { title: '宝物', message: note, levelUps: [], heroDefeated: false };
    }
    case 'fountain': {
      if (obj.visitedBy.includes(hero.owner)) {
        return { title: '清泉', message: '这眼泉水已经喝干了。', levelUps: [], heroDefeated: false };
      }
      obj.visitedBy.push(hero.owner);
      const gain = Math.round(maxMovePoints(hero) * 0.5);
      hero.movePoints += gain;
      pushLog(state, `饮下泉水，移动力 +${gain}`);
      return { title: '清泉', message: `移动力 +${gain}。`, levelUps: [], heroDefeated: false };
    }
    default:
      return empty;
  }
}

/** 打赢后发放守卫奖励。矿场会就地生成一座已占领的矿。 */
function grantGuard(state: GameState, heroId: string, pos: GridPos, guard?: GuardReward): string {
  const hero = state.heroes[heroId];
  if (!hero || !guard) return '';
  switch (guard.kind) {
    case 'gold':
      addResources(state, hero.owner, { gold: guard.amount });
      return `${guard.amount} 金币`;
    case 'resource':
      addResources(state, hero.owner, { [guard.resource]: guard.amount } as never);
      return `${RESOURCE_NAME[guard.resource] ?? guard.resource} ×${guard.amount}`;
    case 'artifact':
      return equipArtifact(state, heroId, guard.artifactId);
    case 'mine': {
      const id = `o${state.nextObjectId++}`;
      const res = guard.resource;
      const obj: MapObject = {
        id,
        kind: 'mine',
        pos: { x: pos.x, y: pos.y },
        payload: { resource: res, perDay: guard.perDay, owner: hero.owner } as MinePayload,
        once: false,
        blocking: false,
        visitedBy: [],
      };
      state.map.objects[id] = obj;
      state.map.tiles[idx(state.map, pos.x, pos.y)].objectId = id;
      return `占领了一处${RESOURCE_NAME[res] ?? res}矿（每日 +${guard.perDay}）`;
    }
    default:
      return '';
  }
}

function equipArtifact(state: GameState, heroId: string, artifactId: string): string {
  const hero = state.heroes[heroId];
  const def = ARTIFACTS[artifactId];
  if (!hero || !def) return '';
  const conflict = hero.artifacts.some((id) => ARTIFACTS[id]?.slot === def.slot);
  if (conflict) {
    addResources(state, hero.owner, { gold: 1000 });
    return `「${def.name}」与已有宝物槽位冲突，折算为 1000 金币。`;
  }
  hero.artifacts.push(artifactId);
  return `装备「${def.name}」：${def.desc}。`;
}

/** 英雄脚下是否有待处理的可交互物件。 */
export function pendingObjectAt(state: GameState, heroId: string): MapObject | null {
  const hero = state.heroes[heroId];
  if (!hero) return null;
  const obj = objectAt(state.map, hero.pos.x, hero.pos.y);
  if (!obj) return null;
  if (obj.blocking) return null;
  if (obj.kind === 'fountain' && obj.visitedBy.includes(hero.owner)) return null;
  // 自家矿场只是地标，不必每次路过都弹窗
  if (obj.kind === 'mine' && (obj.payload as MinePayload).owner === hero.owner) return null;
  return obj;
}
