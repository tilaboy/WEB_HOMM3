import type {
  Army,
  GameState,
  GridPos,
  GuardReward,
  Hero,
  MapObject,
  MinePayload,
  PlayerId,
  ResourceBag,
  VaultPayload,
} from '../types.js';
import { ARTIFACTS } from '../data/artifacts.js';
import { MINE_NAME } from '../data/mines.js';
import { getUnit } from '../data/units.js';
import { factionName } from '../data/factions.js';
import { idx, isPassable, objectAt } from '../map/grid.js';
import { lossGrade, lossRatio, quickBattle } from '../combat/battle.js';
import type { BattleOutcome, BattleSide } from '../combat/battle.js';
import { wallLevelOf } from '../combat/siege.js';
import { WAR_MACHINES } from '../data/warmachines.js';
import { deriveSeed } from '../rng.js';
import { addResources, effectivePrimary, gainExp, maxMovePoints } from './hero.js';
import { townDefenseBonus, captureTown } from './town.js';
import { pushLog } from './log.js';

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
  /** 攻城战才有：守方城墙等级 1/2/3，决定战场上有几座箭塔、城墙多厚。 */
  siegeLevel?: number;
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
/** 把宝库里的财物写成一句人话。 */
function describeVaultReward(reward: VaultPayload['reward']): string {
  const parts: string[] = [`${reward.gold} 金币`];
  for (const [k, v] of Object.entries(reward.resources) as [keyof ResourceBag, number][]) {
    parts.push(`${RESOURCE_NAME[k] ?? k} ×${v}`);
  }
  if (reward.artifactId) parts.push(`宝物「${ARTIFACTS[reward.artifactId]?.name ?? '未知'}」`);
  return parts.join('、');
}


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
    attacker: {
      army: hero.army,
      attack: p.attack,
      defense: p.defense,
      caster: { spells: hero.spells, spellPower: p.spellPower, mana: hero.mana },
      warMachines: hero.warMachines,
    },
    defender: { army: monster.army, attack: 0, defense: 0 },
  };
}

/** 把战斗中消耗的魔力写回世界层（施法过的那场才有 casterMana）。 */
function syncMana(hero: Hero, outcome: BattleOutcome): void {
  if (outcome.casterMana !== undefined) hero.mana = Math.max(0, outcome.casterMana);
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
      const outcome = quickBattle(attacker, defender, battleSeed(state, obj));
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
    case 'vault': {
      const payload = obj.payload as { army: Army; tier: string; reward: VaultPayload['reward'] };
      const { attacker, defender } = sides(state, heroId, obj);
      const outcome = quickBattle(attacker, defender, battleSeed(state, obj));
      const ratio = lossRatio(outcome);
      const grade = lossGrade(ratio);
      return {
        objId,
        kind: 'battle',
        title: payload.tier === 'strong' ? '重兵把守的宝库' : '宝库',
        message:
          `守库兵力：${describeArmy(payload.army)}。\n` +
          `库中财物：${describeVaultReward(payload.reward)}，只有取胜才能拿到。` +
          `\n预估战果：${outcome.win ? '可以攻下' : '难以攻克'}。`,
        confirmLabel: '强攻',
        cancelLabel: '撤退',
        estimate: outcome,
        lossText: `${grade.text}（约损失 ${Math.round(ratio * 100)}% 兵力）`,
      };
    }
    case 'mine': {
      const p = obj.payload as MinePayload;
      const name = MINE_NAME[p.resource] ?? RESOURCE_NAME[p.resource] ?? p.resource;
      // 自家矿场在 pendingObjectAt 就被挡掉了，能走到这里的都是中立或敌方的矿。
      // 用 'pickup'：HOMM 的传统是踩上去就插旗，不需要再点一次确认。
      return {
        objId,
        kind: 'pickup',
        title: p.owner === 'neutral' ? `占领${name}` : `夺取${name}`,
        message:
          p.owner === 'neutral'
            ? `插上你的旗帜，${name}每日产出 ${RESOURCE_NAME[p.resource] ?? p.resource} +${p.perDay}。`
            : `这是${factionName(p.owner)}的${name}，插上你的旗帜，产出归你（每日 +${p.perDay}）。`,
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
      const wall = wallLevelOf(town);
      const machines = hero.warMachines ?? [];
      // 预估必须和真正打起来时用的是同一套输入，否则 AI 会"预估打不下来、实际按野战打赢"去送死
      const outcome = quickBattle(
        { army: hero.army, attack: p.attack, defense: p.defense, warMachines: machines },
        { army: garrison, attack: 0, defense: townDefenseBonus(town) },
        battleSeed(state, obj),
        wall,
      );
      const ratio = lossRatio(outcome);
      const fort =
        wall > 0
          ? `城防 ${'★'.repeat(wall)}：城墙挡住步兵和视线，攻方必须先砸开口子；主楼与角塔每轮自动射击，墙前的护城河还会削弱站在里面的部队。` +
            (machines.length
              ? `\n随军器械：${machines.map((m) => WAR_MACHINES[m].name).join('、')}。`
              : '\n（未带攻城器械：部队砸墙伤害减半，缺口会开得很慢）')
          : '此城没有城墙，将是一场野战。';
      return {
        objId, kind: 'siege', townId, siegeLevel: wall,
        title: `进攻 ${town.name}`,
        message: `守军：${describeArmy(garrison)}。\n${fort}\n预估战果：${outcome.win ? '可以攻下' : '难以攻克'}。`,
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

/** 执行交互的可选项。retreatTo 用于野怪战撤退时把英雄推回上一格（打不赢就不能通过）。
 *  outcome 由 M3 战术战斗传入：用它替代 headless 解算，保证"打出来的结果"就是真实结果。 */
export interface InteractionOptions {
  retreatTo?: GridPos | null;
  outcome?: BattleOutcome;
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

  // 野怪与宝库区：同一套战斗流程，差别只在于打赢之后发什么
  if (obj.kind === 'wanderingMonster' || obj.kind === 'vault') {
    const payload = obj.payload as { army: Army; guard?: GuardReward; reward?: VaultPayload['reward'] };
    // 撤退有两种来源：战前直接点"撤退"，或进了战场又主动逃跑
    if (!accept || opts.outcome?.fled) {
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
    const outcome = opts.outcome ?? quickBattle(attacker, defender, battleSeed(state, obj));
    syncMana(hero, outcome);
    hero.army = outcome.survivors;

    if (outcome.win) {
      removeObject(state, obj);
      const notes = gainExp(state, hero, outcome.expGained);
      const loot =
        obj.kind === 'vault' && payload.reward
          ? grantVault(state, heroId, payload.reward)
          : grantGuard(state, heroId, obj.pos, payload.guard);
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

    if (!accept || opts.outcome?.fled) {
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

    const outcome =
      opts.outcome ??
      quickBattle(
        {
          army: hero.army,
          attack: effectivePrimary(hero).attack,
          defense: effectivePrimary(hero).defense,
          caster: { spells: hero.spells, spellPower: effectivePrimary(hero).spellPower, mana: hero.mana },
          // 攻城器械同样要带进来：AI 结算走过的就是这条兜底路径
          warMachines: hero.warMachines,
        },
        { army: garrison, attack: 0, defense: townDefenseBonus(town) },
        battleSeed(state, obj),
        // 这里是 AI 攻城真正结算的地方（AI 不开战术界面），必须带上城墙等级，
        // 否则预估说"打不下来"、实际却按野战打 —— AI 会去送死。
        wallLevelOf(town),
      );
    syncMana(hero, outcome);
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
    case 'mine': {
      const p = obj.payload as MinePayload;
      const name = MINE_NAME[p.resource] ?? RESOURCE_NAME[p.resource] ?? p.resource;
      const from = p.owner;
      if (from === hero.owner) return empty;
      p.owner = hero.owner;
      const verb = from === 'neutral' ? '占领了' : `从${factionName(from)}手中夺取了`;
      pushLog(state, `${hero.name} ${verb}${name}（每日 +${p.perDay}）`);
      return {
        title: from === 'neutral' ? `占领${name}` : `夺取${name}`,
        message:
          from === 'neutral'
            ? `旗帜已插上，${name}每日产出 ${RESOURCE_NAME[p.resource] ?? p.resource} +${p.perDay}。`
            : `${factionName(from)}的守军被驱散，${name}从此每日为你产出 ${RESOURCE_NAME[p.resource] ?? p.resource} +${p.perDay}。` +
              `\n（它随时可能被别人再抢回去——矿场是要派兵守的。）`,
        levelUps: [],
        heroDefeated: false,
      };
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

/** 打开宝库：金币 + 稀有资源 + 可能的宝物，一次给清。 */
function grantVault(state: GameState, heroId: string, reward: VaultPayload['reward']): string {
  const hero = state.heroes[heroId];
  if (!hero) return '';
  addResources(state, hero.owner, { gold: reward.gold, ...reward.resources });
  const parts: string[] = [`${reward.gold} 金币`];
  for (const [k, v] of Object.entries(reward.resources) as [keyof ResourceBag, number][]) {
    parts.push(`${RESOURCE_NAME[k] ?? k} ×${v}`);
  }
  if (reward.artifactId) {
    const note = equipArtifact(state, heroId, reward.artifactId);
    if (note) parts.push(note);
  }
  return parts.join('、');
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

/**
 * 供 UI 启动战术战斗：一次性给出双方参数 + 随机种子。
 * 种子和 headless 解算用的是同一个，所以"预估"和"实战"至少在同一个随机流上。
 */
export function battleSetup(
  state: GameState,
  heroId: string,
  obj: MapObject,
): { attacker: BattleSide; defender: BattleSide; seed: number; siegeLevel?: number } | null {
  const hero = state.heroes[heroId];
  if (!hero || !obj) return null;
  const p = effectivePrimary(hero);
  const attacker: BattleSide = {
    army: hero.army,
    attack: p.attack,
    defense: p.defense,
    // 英雄带进战场：法术表 + 魔力 + 剩余法力
    caster: { spells: hero.spells, spellPower: p.spellPower, mana: hero.mana },
    // 工坊装配的攻城器械（M6）：只有攻方用得上，守方的城防是建筑自带的
    warMachines: hero.warMachines,
  };

  // 宝库区的守卫和野怪走同一套战斗规则，只是不掉"看守物"、改成开库拿钱
  if (obj.kind === 'wanderingMonster' || obj.kind === 'vault') {
    const payload = obj.payload as { army: Army };
    return { attacker, defender: { army: payload.army, attack: 0, defense: 0 }, seed: battleSeed(state, obj) };
  }
  if (obj.kind === 'town') {
    const town = state.towns[(obj.payload as { townId: string }).townId];
    if (!town) return null;
    const garrison = town.garrison.filter((s) => s.count > 0);
    return {
      attacker,
      defender: { army: garrison, attack: 0, defense: townDefenseBonus(town) },
      seed: battleSeed(state, obj),
      siegeLevel: wallLevelOf(town),
    };
  }
  return null;
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

/* ---------------- 英雄遭遇战（多阵营） ---------------- */

function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 站在 (x,y) 上的、不属于 except 阵营的英雄。 */
export function enemyHeroAt(state: GameState, x: number, y: number, except: PlayerId): Hero | null {
  for (const id of state.heroOrder) {
    const h = state.heroes[id];
    if (!h || h.owner === except) continue;
    if (h.pos.x === x && h.pos.y === y) return h;
  }
  return null;
}

function sideOf(hero: Hero): BattleSide {
  const p = effectivePrimary(hero);
  return {
    army: hero.army,
    attack: p.attack,
    defense: p.defense,
    caster: { spells: hero.spells, spellPower: p.spellPower, mana: hero.mana },
  };
}

/** 遭遇战的双方参数；种子由双方 id 与天数派生，同一天同一对英雄结果一致。 */
export function heroBattleSetup(
  state: GameState,
  attackerId: string,
  defenderId: string,
): { attacker: BattleSide; defender: BattleSide; seed: number } | null {
  const a = state.heroes[attackerId];
  const d = state.heroes[defenderId];
  if (!a || !d || a.owner === d.owner) return null;
  return {
    attacker: sideOf(a),
    defender: sideOf(d),
    seed: deriveSeed(state.seed, hashId(attackerId), hashId(defenderId), state.day),
  };
}

/** 把遭遇战结果写回世界：败者的英雄从地图上消失，胜者接管他的位置。 */
export function applyHeroBattle(
  state: GameState,
  attackerId: string,
  defenderId: string,
  outcome: BattleOutcome,
): InteractionResult {
  const a = state.heroes[attackerId];
  const d = state.heroes[defenderId];
  const empty: InteractionResult = { title: '', message: '', levelUps: [], heroDefeated: false };
  if (!a || !d) return empty;

  const spot = { x: d.pos.x, y: d.pos.y };
  syncMana(a, outcome);

  if (outcome.win) {
    a.army = outcome.survivors;
    a.pos = spot;
    const notes = gainExp(state, a, outcome.expGained);
    removeHero(state, defenderId);
    pushLog(state, `${a.name} 击败了 ${d.name}`);
    return {
      title: '遭遇战胜利',
      message:
        `${d.name} 的部队被击溃，我方接管了他的位置。获得 ${outcome.expGained} 点经验。` +
        `\n剩余兵力：${describeArmy(a.army)}。`,
      levelUps: notes,
      heroDefeated: false,
    };
  }

  // 攻方战败：进攻方会死，防守方留下残兵
  d.army = outcome.enemySurvivors;
  removeHero(state, attackerId);
  pushLog(state, `${a.name} 在遭遇战中败给 ${d.name}`);
  return {
    title: '遭遇战失利',
    message: `${a.name} 被 ${d.name} 击溃。\n对方剩余兵力：${describeArmy(d.army)}。`,
    levelUps: [],
    heroDefeated: attackerId === 'hero1',
  };
}

function removeHero(state: GameState, heroId: string): void {
  delete state.heroes[heroId];
  state.heroOrder = state.heroOrder.filter((id) => id !== heroId);
}
