import type { HeroPrimary, Stack } from '../types.js';

export const HERO_TEMPLATES: {
  id: string;
  name: string;
  className: string;
  portrait: string;
  primary: HeroPrimary;
  startArmy: Stack[];
}[] = [
  {
    id: 'knight',
    name: '阿尔文',
    className: '骑士',
    portrait: '#4a7fb5',
    primary: { attack: 1, defense: 2, spellPower: 1, knowledge: 1 },
    startArmy: [{ unitTypeId: 'archer', count: 20 }],
  },
  {
    id: 'ranger',
    name: '艾莉亚',
    className: '游侠',
    portrait: '#3f8f5a',
    primary: { attack: 2, defense: 1, spellPower: 1, knowledge: 1 },
    startArmy: [{ unitTypeId: 'archer', count: 8 }],
  },
  {
    id: 'cleric',
    name: '塞拉菲',
    className: '牧师',
    portrait: '#8a6fbf',
    primary: { attack: 1, defense: 1, spellPower: 2, knowledge: 2 },
    startArmy: [{ unitTypeId: 'archer', count: 8 }],
  },
  {
    id: 'barbarian',
    name: '格罗姆',
    className: '野蛮人',
    portrait: '#b06a3a',
    primary: { attack: 2, defense: 2, spellPower: 1, knowledge: 1 },
    startArmy: [{ unitTypeId: 'archer', count: 8 }],
  },
];

/**
 * 开局双方兵力必须一致，否则多阵营对局从第一天就不公平：
 * 起手 20 弓手是 M3 实测出来的基准（能白嫖野怪 3~4 轮），所以统一发这一套，
 * 英雄模板只决定名字、头像与四维，不决定带兵量。
 */
export const START_ARMY: Stack[] = [{ unitTypeId: 'archer', count: 20 }];
