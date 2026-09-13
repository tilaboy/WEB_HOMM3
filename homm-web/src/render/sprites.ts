import type { GuardReward, Hero, MapObject, TerrainDef } from '../core/types.js';
import { RESOURCE_META } from '../core/data/terrains.js';
import { getUnit } from '../core/data/units.js';
import { TILE_H, TILE_W, diamondPoints, tracePolygon } from './iso.js';

const THICK = 8;

function shadow(ctx: CanvasRenderingContext2D, wx: number, wy: number, r = 14): void {
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(wx, wy + 3, r, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ---------------- terrain ---------------- */

export function drawTile(ctx: CanvasRenderingContext2D, wx: number, wy: number, t: TerrainDef): void {
  const top = diamondPoints(wx, wy);
  // 左侧面
  tracePolygon(ctx, [
    [wx - TILE_W / 2, wy],
    [wx, wy + TILE_H / 2],
    [wx, wy + TILE_H / 2 + THICK],
    [wx - TILE_W / 2, wy + THICK],
  ]);
  ctx.fillStyle = t.left;
  ctx.fill();
  // 右侧面
  tracePolygon(ctx, [
    [wx, wy + TILE_H / 2],
    [wx + TILE_W / 2, wy],
    [wx + TILE_W / 2, wy + THICK],
    [wx, wy + TILE_H / 2 + THICK],
  ]);
  ctx.fillStyle = t.right;
  ctx.fill();
  // 顶面
  tracePolygon(ctx, top);
  ctx.fillStyle = t.top;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
}

/* ---------------- objects ---------------- */

export interface TownVisual {
  owner: string;
  /** 已建成的兵营数量，决定塔楼数量 */
  level: number;
}

export function drawObject(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  obj: MapObject,
  townVisual?: TownVisual,
): void {
  switch (obj.kind) {
    case 'obstacle': {
      const v = (obj.payload as { variant: string }).variant;
      if (v === 'tree') drawTree(ctx, wx, wy);
      else if (v === 'mountain') drawMountain(ctx, wx, wy);
      else drawRock(ctx, wx, wy);
      break;
    }
    case 'resourcePile': {
      const p = obj.payload as { resource: string; amount: number };
      drawPile(ctx, wx, wy, p.resource, p.amount);
      break;
    }
    case 'treasureChest':
      drawChest(ctx, wx, wy);
      break;
    case 'artifact':
      drawGroundArtifact(ctx, wx, wy);
      break;
    case 'fountain':
      drawFountain(ctx, wx, wy);
      break;
    case 'wanderingMonster': {
      const p = obj.payload as {
        army: { unitTypeId: string; count: number }[];
        tier: string;
        guard?: GuardReward;
      };
      const main = p.army[0];
      if (main) drawMonster(ctx, wx, wy, main.unitTypeId, p.tier === 'strong' ? 1.35 : p.tier === 'mid' ? 1.1 : 0.9);
      // 有战利品的野怪脚下画一堆金币，提示"这里有东西"
      if (p.guard) drawLootMark(ctx, wx, wy, p.guard.kind);
      break;
    }
    case 'mine': {
      const p = obj.payload as { resource: string; owner: string };
      drawMine(ctx, wx, wy, p.resource, p.owner === 'p1');
      break;
    }
    case 'town': {
      const p = obj.payload as { townId: string };
      drawTown(ctx, wx, wy, townVisual ?? { owner: p.townId === 'town_home' ? 'p1' : 'neutral', level: 1 });
      break;
    }
  }
}

/** 野怪脚下的战利品标记：金币堆 / 木石堆 / 宝箱 / 矿镐。 */
function drawLootMark(ctx: CanvasRenderingContext2D, wx: number, wy: number, kind: GuardReward['kind']): void {
  const bx = wx + 15;
  const by = wy + 6;
  if (kind === 'gold') {
    ctx.fillStyle = '#e8bf52';
    for (const [dx, dy] of [[-6, 0], [-2, -3], [2, 0], [6, -2]]) {
      ctx.beginPath();
      ctx.ellipse(bx + dx, by + dy, 3.4, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(90,60,10,0.55)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    return;
  }
  if (kind === 'resource') {
    ctx.fillStyle = '#8a6b45';
    ctx.fillRect(bx - 7, by - 1, 6, 4);
    ctx.fillRect(bx - 1, by - 4, 6, 4);
    ctx.fillStyle = '#9aa0a6';
    ctx.fillRect(bx - 4, by - 7, 6, 4);
    return;
  }
  if (kind === 'artifact') {
    ctx.fillStyle = '#8a5ad0';
    ctx.fillRect(bx - 5, by - 5, 10, 8);
    ctx.fillStyle = '#e8bf52';
    ctx.fillRect(bx - 5, by - 5, 10, 2);
    return;
  }
  // mine
  ctx.strokeStyle = '#5a4a33';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx - 5, by + 2);
  ctx.lineTo(bx + 3, by - 6);
  ctx.stroke();
  ctx.fillStyle = '#9aa0a6';
  ctx.beginPath();
  ctx.moveTo(bx + 1, by - 8);
  ctx.lineTo(bx + 8, by - 3);
  ctx.lineTo(bx + 4, by - 1);
  ctx.closePath();
  ctx.fill();
}

/** 矿场：一个坑口 + 旗帜，己方为蓝色，未占领为灰色。 */
function drawMine(ctx: CanvasRenderingContext2D, wx: number, wy: number, res: string, owned: boolean): void {
  shadow(ctx, wx, wy, 15);
  ctx.fillStyle = '#4a4239';
  ctx.beginPath();
  ctx.ellipse(wx, wy + 2, 16, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2f2a24';
  ctx.beginPath();
  ctx.ellipse(wx, wy + 2, 10, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // 支架
  ctx.strokeStyle = '#6b4a2a';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(wx - 12, wy + 1);
  ctx.lineTo(wx - 6, wy - 16);
  ctx.moveTo(wx + 12, wy + 1);
  ctx.lineTo(wx + 6, wy - 16);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(wx - 8, wy - 14);
  ctx.lineTo(wx + 8, wy - 14);
  ctx.stroke();
  // 矿石颜色
  const ore = res === 'gold' ? '#e8bf52' : res === 'ore' ? '#9aa0a6' : '#8a6b45';
  ctx.fillStyle = ore;
  ctx.beginPath();
  ctx.arc(wx, wy + 3, 4, 0, Math.PI * 2);
  ctx.fill();
  // 旗
  ctx.strokeStyle = '#3a3a33';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(wx + 6, wy - 16);
  ctx.lineTo(wx + 6, wy - 28);
  ctx.stroke();
  ctx.fillStyle = owned ? '#4f8ad4' : '#8a8378';
  ctx.beginPath();
  ctx.moveTo(wx + 6, wy - 28);
  ctx.lineTo(wx + 18, wy - 25);
  ctx.lineTo(wx + 6, wy - 22);
  ctx.closePath();
  ctx.fill();
}

function drawTree(ctx: CanvasRenderingContext2D, wx: number, wy: number): void {
  shadow(ctx, wx, wy, 10);
  ctx.fillStyle = '#6b4a2a';
  ctx.fillRect(wx - 2, wy - 12, 4, 14);
  ctx.fillStyle = '#3f7a35';
  ctx.beginPath();
  ctx.moveTo(wx, wy - 34);
  ctx.lineTo(wx + 14, wy - 8);
  ctx.lineTo(wx - 14, wy - 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#59a044';
  ctx.beginPath();
  ctx.moveTo(wx, wy - 30);
  ctx.lineTo(wx + 11, wy - 10);
  ctx.lineTo(wx - 11, wy - 10);
  ctx.closePath();
  ctx.fill();
}

function drawRock(ctx: CanvasRenderingContext2D, wx: number, wy: number): void {
  shadow(ctx, wx, wy, 11);
  ctx.fillStyle = '#8d8a84';
  tracePolygon(ctx, [
    [wx - 13, wy + 2], [wx - 7, wy - 12], [wx + 5, wy - 15],
    [wx + 13, wy - 4], [wx + 8, wy + 4],
  ]);
  ctx.fill();
  ctx.fillStyle = '#6e6b66';
  tracePolygon(ctx, [[wx + 5, wy - 15], [wx + 13, wy - 4], [wx + 8, wy + 4], [wx + 2, wy - 6]]);
  ctx.fill();
}

function drawMountain(ctx: CanvasRenderingContext2D, wx: number, wy: number): void {
  shadow(ctx, wx, wy, 16);
  ctx.fillStyle = '#7c7a75';
  ctx.beginPath();
  ctx.moveTo(wx - 22, wy + 4);
  ctx.lineTo(wx - 4, wy - 30);
  ctx.lineTo(wx + 14, wy + 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#5d5b57';
  ctx.beginPath();
  ctx.moveTo(wx - 4, wy - 30);
  ctx.lineTo(wx + 14, wy + 4);
  ctx.lineTo(wx + 2, wy + 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e9eef2';
  ctx.beginPath();
  ctx.moveTo(wx - 4, wy - 30);
  ctx.lineTo(wx + 6, wy - 16);
  ctx.lineTo(wx - 1, wy - 15);
  ctx.lineTo(wx - 8, wy - 20);
  ctx.closePath();
  ctx.fill();
}

function drawPile(ctx: CanvasRenderingContext2D, wx: number, wy: number, res: string, amount: number): void {
  shadow(ctx, wx, wy, 11);
  const color = RESOURCE_META[res]?.color ?? '#ccc';
  const n = res === 'gold' ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const ox = (i - (n - 1) / 2) * 9;
    ctx.fillStyle = color;
    if (res === 'wood') {
      ctx.fillRect(wx + ox - 7, wy - 6 - (i % 2) * 5, 14, 5);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(wx + ox - 7, wy - 3 - (i % 2) * 5, 14, 2);
    } else if (res === 'ore') {
      tracePolygon(ctx, [
        [wx + ox - 7, wy + 1], [wx + ox - 4, wy - 7], [wx + ox + 5, wy - 6], [wx + ox + 7, wy + 1],
      ]);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.ellipse(wx + ox, wy - 4 - (i % 2) * 4, 6, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(wx + ox, wy - 7 - (i % 2) * 4, 6, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (amount) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(amount), wx, wy + 12);
  }
}

function drawChest(ctx: CanvasRenderingContext2D, wx: number, wy: number): void {
  shadow(ctx, wx, wy, 12);
  ctx.fillStyle = '#8a5f2e';
  ctx.fillRect(wx - 13, wy - 14, 26, 15);
  ctx.fillStyle = '#6d4922';
  ctx.fillRect(wx - 13, wy - 14, 26, 4);
  ctx.fillStyle = '#e3b869';
  ctx.fillRect(wx - 3, wy - 11, 6, 7);
  ctx.strokeStyle = '#3a2712';
  ctx.lineWidth = 1;
  ctx.strokeRect(wx - 13, wy - 14, 26, 15);
}

function drawGroundArtifact(ctx: CanvasRenderingContext2D, wx: number, wy: number): void {
  shadow(ctx, wx, wy, 8);
  ctx.fillStyle = '#6b6b63';
  ctx.fillRect(wx - 8, wy - 5, 16, 6);
  ctx.fillStyle = '#e3b869';
  tracePolygon(ctx, [[wx, wy - 22], [wx + 8, wy - 13], [wx, wy - 4], [wx - 8, wy - 13]]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

function drawFountain(ctx: CanvasRenderingContext2D, wx: number, wy: number): void {
  shadow(ctx, wx, wy, 12);
  ctx.fillStyle = '#9a9a92';
  ctx.beginPath();
  ctx.ellipse(wx, wy - 2, 15, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4f9ad4';
  ctx.beginPath();
  ctx.ellipse(wx, wy - 4, 11, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(wx, wy - 20);
  ctx.quadraticCurveTo(wx + 8, wy - 12, wx + 4, wy - 6);
  ctx.stroke();
}

function drawTown(ctx: CanvasRenderingContext2D, wx: number, wy: number, vis: TownVisual): void {
  const friendly = vis.owner === 'p1';
  shadow(ctx, wx, wy, 20);
  const wall = friendly ? '#c8c3b4' : '#8a8378';
  const roof = friendly ? '#3f6fa8' : '#7a4a4a';
  // 主体
  ctx.fillStyle = wall;
  ctx.fillRect(wx - 18, wy - 20, 36, 22);
  // 主体屋顶
  ctx.fillStyle = roof;
  for (const dx of [-18, -4, 12]) {
    ctx.beginPath();
    ctx.moveTo(wx + dx, wy - 20);
    ctx.lineTo(wx + dx + 6, wy - 32);
    ctx.lineTo(wx + dx + 12, wy - 20);
    ctx.closePath();
    ctx.fill();
  }
  // 已建成兵营 → 侧面加塔楼
  const towers = Math.max(0, Math.min(5, vis.level));
  for (let i = 0; i < towers; i++) {
    const tx = wx - 24 + i * 12;
    if (i === 2) continue; // 中间留出旗杆位置
    ctx.fillStyle = wall;
    ctx.fillRect(tx, wy - 14, 8, 16);
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(tx - 1, wy - 14);
    ctx.lineTo(tx + 4, wy - 24);
    ctx.lineTo(tx + 9, wy - 14);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#5a4a33';
  ctx.fillRect(wx - 5, wy - 10, 10, 12);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(wx - 18, wy - 20, 36, 22);
  // 旗
  ctx.strokeStyle = '#3a3a33';
  ctx.beginPath();
  ctx.moveTo(wx, wy - 32);
  ctx.lineTo(wx, wy - 46);
  ctx.stroke();
  ctx.fillStyle = friendly ? '#4f8ad4' : '#b04a4a';
  ctx.beginPath();
  ctx.moveTo(wx, wy - 46);
  ctx.lineTo(wx + 13, wy - 43);
  ctx.lineTo(wx, wy - 40);
  ctx.closePath();
  ctx.fill();
}

function drawMonster(ctx: CanvasRenderingContext2D, wx: number, wy: number, unitId: string, scale: number): void {
  const u = getUnit(unitId);
  shadow(ctx, wx, wy, 13 * scale);
  const s = scale;
  ctx.save();
  ctx.scale(s, s);
  const bx = wx / s;
  const by = wy / s;
  // 身体
  ctx.fillStyle = u.body;
  ctx.beginPath();
  ctx.ellipse(bx, by - 10, 11, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  // 头
  ctx.fillStyle = u.accent;
  ctx.beginPath();
  ctx.arc(bx + (u.id === 'wolf' ? -9 : 8), by - 18, 6, 0, Math.PI * 2);
  ctx.fill();
  // 腿
  ctx.fillStyle = u.accent;
  ctx.fillRect(bx - 7, by - 3, 4, 6);
  ctx.fillRect(bx + 3, by - 3, 4, 6);
  ctx.restore();
}

/* ---------------- hero ---------------- */

export function drawHero(ctx: CanvasRenderingContext2D, wx: number, wy: number, hero: Hero, pulse: number): void {
  shadow(ctx, wx, wy, 14);
  // 底座光环
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.2 * Math.sin(pulse / 320);
  ctx.strokeStyle = '#e3b869';
  ctx.lineWidth = 2;
  tracePolygon(ctx, diamondPoints(wx, wy));
  ctx.stroke();
  ctx.restore();

  // 披风 + 身体
  ctx.fillStyle = hero.portrait;
  ctx.beginPath();
  ctx.moveTo(wx - 9, wy - 2);
  ctx.lineTo(wx, wy - 26);
  ctx.lineTo(wx + 9, wy - 2);
  ctx.closePath();
  ctx.fill();
  // 头
  ctx.fillStyle = '#f0d9b5';
  ctx.beginPath();
  ctx.arc(wx, wy - 30, 6, 0, Math.PI * 2);
  ctx.fill();
  // 头盔
  ctx.fillStyle = '#c9c9c2';
  ctx.beginPath();
  ctx.arc(wx, wy - 31, 6, Math.PI, 0);
  ctx.fill();
  // 旗
  ctx.strokeStyle = '#4a3a24';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(wx + 10, wy - 4);
  ctx.lineTo(wx + 10, wy - 34);
  ctx.stroke();
  ctx.fillStyle = '#d9b45a';
  ctx.beginPath();
  ctx.moveTo(wx + 10, wy - 34);
  ctx.lineTo(wx + 22, wy - 30);
  ctx.lineTo(wx + 10, wy - 26);
  ctx.closePath();
  ctx.fill();
}
