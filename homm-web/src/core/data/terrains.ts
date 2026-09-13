import type { TerrainDef, TerrainKind } from '../types.js';

export const TERRAIN: Record<TerrainKind, TerrainDef> = {
  grass: { id: 'grass', name: '草地', top: '#8ec06c', left: '#6ba04d', right: '#4d7a36', moveCost: 100, passable: true },
  dirt: { id: 'dirt', name: '土路', top: '#c2a074', left: '#a3804f', right: '#7a5c37', moveCost: 125, passable: true },
  sand: { id: 'sand', name: '沙地', top: '#e8d6a3', left: '#cbb478', right: '#a89155', moveCost: 150, passable: true },
  snow: { id: 'snow', name: '雪原', top: '#eef3f7', left: '#cdd8e2', right: '#a8b6c4', moveCost: 150, passable: true },
  swamp: { id: 'swamp', name: '沼泽', top: '#7d8a63', left: '#5f6b48', right: '#424c31', moveCost: 175, passable: true },
  rock: { id: 'rock', name: '岩地', top: '#a3a09a', left: '#847f78', right: '#5f5b55', moveCost: 200, passable: true },
  water: { id: 'water', name: '水域', top: '#4f9ad4', left: '#3b7bad', right: '#2a5a80', moveCost: Infinity, passable: false },
};

export const RESOURCE_META: Record<string, { name: string; color: string }> = {
  gold: { name: '金币', color: '#f0c94a' },
  wood: { name: '木材', color: '#b07a3c' },
  ore: { name: '矿石', color: '#9aa0a6' },
  gem: { name: '宝石', color: '#d05fa0' },
  crystal: { name: '水晶', color: '#7ec8e3' },
  sulfur: { name: '硫磺', color: '#e0d24a' },
  mercury: { name: '水银', color: '#b8b8c4' },
};
