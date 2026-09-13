import type { ArtifactDef } from '../types.js';

export const ARTIFACTS: Record<string, ArtifactDef> = {
  blade_of_fury: {
    id: 'blade_of_fury', name: '狂怒之刃', slot: 'weapon',
    desc: '近战与射击都更致命。攻击 +2', mods: { attack: 2 },
  },
  aegis: {
    id: 'aegis', name: '守护之盾', slot: 'shield',
    desc: '全军更难被击穿。防御 +2', mods: { defense: 2 },
  },
  helm_of_command: {
    id: 'helm_of_command', name: '统御头盔', slot: 'helm',
    desc: '号令更有威信。防御 +1', mods: { defense: 1 },
  },
  dragon_scale: {
    id: 'dragon_scale', name: '龙鳞护甲', slot: 'armor',
    desc: '厚重的龙鳞。防御 +3', mods: { defense: 3 },
  },
  ring_of_prosperity: {
    id: 'ring_of_prosperity', name: '丰饶指环', slot: 'ring',
    desc: '每日自动入库 500 金币', dailyGold: 500,
  },
  boots_of_speed: {
    id: 'boots_of_speed', name: '疾行之靴', slot: 'boots',
    desc: '每日移动力上限 +150', moveBonus: 150,
  },
};

export const ARTIFACT_SLOTS: { slot: ArtifactDef['slot']; label: string }[] = [
  { slot: 'weapon', label: '武器' },
  { slot: 'shield', label: '盾牌' },
  { slot: 'helm', label: '头盔' },
  { slot: 'armor', label: '护甲' },
  { slot: 'ring', label: '指环' },
  { slot: 'boots', label: '靴子' },
];
