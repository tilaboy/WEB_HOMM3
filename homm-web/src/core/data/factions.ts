import type {
  Difficulty,
  DifficultyDef,
  FactionDef,
  FactionId,
  MapLayout,
  MapSize,
  PlayerId,
} from '../types.js';
import { MAP_SIZES } from '../types.js';

/**
 * 四个阵营只做配色与命名的区分，兵种/建筑表是共用的。
 * 颜色刻意选得互相离得远（蓝/红/绿/紫），在小地图和灰度下也能分辨。
 */
export const FACTIONS: Record<FactionId, FactionDef> = {
  p1: { id: 'p1', name: '晨曦军团', lord: '指挥官', home: '曙光城', color: '#3f6fd0', dark: '#27467f' },
  p2: { id: 'p2', name: '赤焰部落', lord: '赤焰领主', home: '焚风堡', color: '#c0392b', dark: '#7d2119' },
  p3: { id: 'p3', name: '翠林守望', lord: '翠林守誓者', home: '碧叶城', color: '#2e9e5b', dark: '#1c6438' },
  p4: { id: 'p4', name: '紫晶密会', lord: '紫晶秘法师', home: '紫晶塔', color: '#8a4fc9', dark: '#57317f' },
};

export const FACTION_ORDER: FactionId[] = ['p1', 'p2', 'p3', 'p4'];

/** 中立（无主）旗色，城镇与英雄贴图共用。 */
export const NEUTRAL_COLOR = '#8a6a55';
export const NEUTRAL_DARK = '#5b4636';

export function factionOf(player: PlayerId): FactionDef | null {
  return player === 'neutral' ? null : FACTIONS[player];
}

export function factionColor(player: PlayerId): string {
  return factionOf(player)?.color ?? NEUTRAL_COLOR;
}

export function factionName(player: PlayerId): string {
  return factionOf(player)?.name ?? '无主之地';
}

/** 当前对局里实际存在的阵营（按 p1、p2… 的顺序），用于每日结算与胜负判定。 */
export function factionIds(state: { players: Record<string, unknown> }): FactionId[] {
  return FACTION_ORDER.filter((id) => !!state.players[id]);
}

/**
 * 难度只作用于电脑对手：起始资源、每周增长、出兵阈值。
 * 「困难」不给 AI 作弊视野，只给经济与更低的出击门槛，玩家仍能靠操作赢。
 */
export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  easy: {
    id: 'easy',
    name: '轻松',
    desc: '电脑对手发育迟缓、兵力不足时不会主动出击。',
    startMul: 0.75,
    growthBonus: 0,
    aggression: 1.35,
  },
  normal: {
    id: 'normal',
    name: '普通',
    desc: '电脑对手正常发育，攒够兵力后会向外扩张。',
    startMul: 1,
    growthBonus: 0.1,
    aggression: 1,
  },
  hard: {
    id: 'hard',
    name: '困难',
    desc: '电脑对手起始资源更多、周增长更快，且更早发动进攻。',
    startMul: 1.4,
    growthBonus: 0.3,
    aggression: 0.75,
  },
};

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];
export const SIZE_ORDER: MapSize[] = ['small', 'medium', 'large'];

export function sizeLabel(size: MapSize): string {
  const s = MAP_SIZES[size];
  return `${s.name} ${s.width}×${s.height}`;
}

/** 开局默认设置：与 M4 之前的手感一致（32×32、无对手、普通）。 */
export const DEFAULT_CONFIG = {
  size: 'medium' as MapSize,
  /** 默认走"旷野"：地形全交给噪声，和 M7 之前的每一局手感一致 */
  layout: 'wild' as MapLayout,
  opponents: 0,
  difficulty: 'normal' as Difficulty,
  playerName: '指挥官',
};
