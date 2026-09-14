/**
 * M4 冒险魔法（大地图魔法）。
 *
 * 战斗魔法在 core/combat/battle.ts 里，这里的都是"在地图上按一下就生效"的：
 *   visions        侦察一支野怪的精确兵力
 *   viewAir        全图揭雾
 *   viewEarth      汇总全图野怪情报，并标记它们的位置
 *   townPortal     传送到己方城镇
 *   dimensionDoor  瞬移到附近任意可通行格
 * （Summon Boat 按设计文档预案跳过：本项目没有船只系统）
 *
 * 需要玩家指定目标的法术，第一次调用会返回 needsTarget，
 * UI 进入"点地图"模式后再带 target 调一次。
 */
import type { GameState, GridPos, Hero } from '../types.js';
import { getSpell } from '../data/spells.js';
import { getUnit } from '../data/units.js';
import { idx, isPassable, objectAt } from '../map/grid.js';
import { revealAround } from '../map/fog.js';
import { isRevealed } from '../map/fog.js';
import { ownedTowns } from './town.js';
import { pushLog } from './log.js';

export interface AdventureTarget {
  pos?: GridPos;
  townId?: string;
}

export interface AdventureCastResult {
  ok: boolean;
  /** 需要玩家先指定目标（UI 进入点选模式）。 */
  needsTarget?: 'tile' | 'monster' | 'town';
  /** 选择城镇用的候选列表（回城术）。 */
  towns?: { id: string; name: string }[];
  message?: string;
  /** 额外情报行（观地术、异视术）。 */
  report?: string[];
}

export function adventureSpells(hero: Hero): string[] {
  return hero.spells.filter((id) => !getSpell(id).combat);
}

function armyText(_state: GameState, army: { unitTypeId: string; count: number }[]): string {
  return army.map((s) => `${getUnit(s.unitTypeId).name} ×${s.count}`).join('、') || '（空）';
}

/** 能不能施放这个冒险魔法（不给理由就只是不能）。 */
export function canAdventureCast(state: GameState, hero: Hero, spellId: string): { ok: boolean; reason?: string } {
  const sp = getSpell(spellId);
  if (!hero.spells.includes(spellId) || sp.combat) return { ok: false, reason: '未学会' };
  if (hero.mana < sp.manaCost) return { ok: false, reason: `法力不足（需 ${sp.manaCost}）` };
  if (spellId === 'townPortal' && !ownedTowns(state, hero.owner).length) {
    return { ok: false, reason: '还没有己方城镇' };
  }
  if (spellId === 'dimensionDoor' && hero.movePoints <= 0) {
    return { ok: false, reason: '今日移动力已耗尽' };
  }
  return { ok: true };
}

/** 施放冒险魔法。返回值交给 UI 决定要不要再要一个目标。 */
export function castAdventure(
  state: GameState,
  heroId: string,
  spellId: string,
  target?: AdventureTarget,
): AdventureCastResult {
  const hero = state.heroes[heroId];
  if (!hero) return { ok: false, message: '英雄不存在' };
  const sp = getSpell(spellId);
  const chk = canAdventureCast(state, hero, spellId);
  if (!chk.ok) return { ok: false, message: chk.reason ?? '无法施放' };

  if (spellId === 'visions') {
    if (!target?.pos) return { ok: false, needsTarget: 'monster' };
    const obj = objectAt(state.map, target.pos.x, target.pos.y);
    if (!obj || obj.kind !== 'wanderingMonster') {
      return { ok: false, message: '那里没有野怪可侦察' };
    }
    const d = Math.abs(obj.pos.x - hero.pos.x) + Math.abs(obj.pos.y - hero.pos.y);
    if (d > 5) return { ok: false, message: '太远了，异视术只能侦察 5 格内的野怪' };
    hero.mana -= sp.manaCost;
    const payload = obj.payload as { army: { unitTypeId: string; count: number }[]; tier: string };
    const tierName = { weak: '零星散兵', mid: '成群野兽', strong: '强悍守卫' }[payload.tier] ?? '未知';
    const lines = [`规模：${tierName}`, `兵力：${armyText(state, payload.army)}`];
    if ((payload as { guard?: { kind: string } }).guard) lines.push('它们看守着什么：打赢才能拿');
    pushLog(state, `${hero.name} 施展异视术，窥见 ${tierName}`);
    return { ok: true, message: `异视术：${tierName}`, report: lines };
  }

  if (spellId === 'viewAir') {
    hero.mana -= sp.manaCost;
    state.players[hero.owner].revealed = new Array(state.map.width * state.map.height).fill(1);
    pushLog(state, `${hero.name} 施展观空术，全图迷雾散去`);
    return { ok: true, message: '观空术：全图已揭开' };
  }

  if (spellId === 'viewEarth') {
    hero.mana -= sp.manaCost;
    const lines: string[] = [];
    for (const obj of Object.values(state.map.objects)) {
      if (obj.kind !== 'wanderingMonster') continue;
      const payload = obj.payload as { army: { unitTypeId: string; count: number }[]; tier: string };
      const tierName = { weak: '零星', mid: '成群', strong: '强悍' }[payload.tier] ?? '未知';
      lines.push(
        `(${obj.pos.x},${obj.pos.y}) ${tierName}：${armyText(state, payload.army)}`,
      );
      // 顺手把位置标到地图上，省得玩家自己数格子
      state.players[hero.owner].revealed[idx(state.map, obj.pos.x, obj.pos.y)] = 1;
    }
    pushLog(state, `${hero.name} 施展观地术，摸清了全图野怪`);
    return { ok: true, message: '观地术：野怪情报', report: lines.length ? lines : ['地图上已经没有野怪了'] };
  }

  if (spellId === 'townPortal') {
    const towns = ownedTowns(state, hero.owner);
    if (!target?.townId) {
      return { ok: false, needsTarget: 'town', towns: towns.map((t) => ({ id: t.id, name: t.name })) };
    }
    const town = state.towns[target.townId];
    if (!town || town.owner !== hero.owner) return { ok: false, message: '那不是己方城镇' };
    const p = freeSpotNear(state, town.pos);
    if (!p) return { ok: false, message: '城镇周围没有落脚点' };
    hero.mana -= sp.manaCost;
    hero.pos = { ...p };
    revealAround(state, hero.owner, hero.pos, 5);
    pushLog(state, `${hero.name} 开启回城术，回到 ${town.name}`);
    return { ok: true, message: `已传送回 ${town.name}` };
  }

  if (spellId === 'dimensionDoor') {
    if (!target?.pos) return { ok: false, needsTarget: 'tile' };
    const p = target.pos;
    if (!isPassable(state.map, p.x, p.y)) return { ok: false, message: '那里过不去' };
    if (Math.max(Math.abs(p.x - hero.pos.x), Math.abs(p.y - hero.pos.y)) > 8) {
      return { ok: false, message: '次元门最多跨越 8 格' };
    }
    if (!isRevealed(state, 'p1', p.x, p.y)) return { ok: false, message: '不能传送到没探索过的地方' };
    hero.mana -= sp.manaCost;
    hero.pos = { ...p };
    hero.movePoints = Math.floor(hero.movePoints * 2 / 3); // 瞬移也要付出代价
    revealAround(state, hero.owner, hero.pos, 5);
    pushLog(state, `${hero.name} 穿越次元门`);
    return { ok: true, message: `已瞬移到 (${p.x},${p.y})` };
  }

  return { ok: false, message: '这个法术还没实装' };
}

/** 在城镇附近找一个能站人的格子。 */
function freeSpotNear(state: GameState, pos: GridPos): GridPos | null {
  for (let r = 0; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = pos.x + dx;
        const y = pos.y + dy;
        if (!isPassable(state.map, x, y)) continue;
        if (state.heroOrder.some((id) => {
          const h = state.heroes[id];
          return h && h.pos.x === x && h.pos.y === y;
        })) continue;
        return { x, y };
      }
    }
  }
  return null;
}
