/**
 * 战斗场景渲染器。
 *
 * 做法：先在"基准分辨率"的离屏画布上按 1:1 画完（所有像素都落在整数上），
 * 再整体按整数倍放大到屏幕画布。这样放大后是硬边像素，而不是糊成一团的插值。
 */
import type { BattleState, BattleUnit } from '../core/combat/battle.js';
import { getUnit } from '../core/data/units.js';
import { FIELD_H, FIELD_W, hexCenter, hexKey, type Hex } from '../core/combat/hex.js';
import { MOAT_COL } from '../core/combat/siege.js';
import { hash2 } from './pixel.js';
import { getCombatAtlas } from './combatAtlas.js';
import type { CombatAtlas } from './combatAtlas.js';

const PAD = 6;
export { PAD };
export const BASE_W = 591 + PAD * 2;
export const BASE_H = 376 + PAD * 2;

export interface FloatText {
  text: string;
  x: number;
  y: number;
  life: number;
  color: string;
}

export interface BattleDraw {
  battle: BattleState;
  activeId: string | null;
  reachable: Set<string> | null;
  attackable: Set<string> | null;
  hover: Hex | null;
  posOverride: Record<string, { x: number; y: number }>;
  lunge: { unitId: string; dx: number; dy: number } | null;
  arrow: { x: number; y: number; tx: number; ty: number } | null;
  floats: FloatText[];
  /** 施法目标格高亮（选了法术后点目标时用）。 */
  spellTargets?: Set<string> | null;
  /** 施法特效：格子 + 剩余生命（1 → 0），画一圈扩散的光环。 */
  spellFx?: { hex: Hex; life: number; color: string; splash?: boolean }[];
  time: number;
}

export class BattleRenderer {
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private atlas: CombatAtlas;
  scale = 2;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建战斗画布');
    this.ctx = ctx;
    this.off = document.createElement('canvas');
    this.off.width = BASE_W;
    this.off.height = BASE_H;
    const o = this.off.getContext('2d');
    if (!o) throw new Error('无法创建战斗离屏画布');
    this.offCtx = o;
    this.atlas = getCombatAtlas();
  }

  /**
   * 按容器可用空间决定放大倍数。
   * 优先取整数倍（像素最整齐）；差一点放不下整数倍时才退回小数倍，
   * 否则 600px 宽的战场在大屏幕上会小得可怜。
   * 同时乘上 devicePixelRatio，让逻辑像素对齐物理像素。
   */
  fit(availW: number, availH: number): void {
    const dpr = window.devicePixelRatio || 1;
    const raw = Math.min(availW / BASE_W, availH / BASE_H);
    let s = Math.min(4, Math.max(0.6, raw));
    const fl = Math.floor(s);
    if (fl >= 1 && s / fl <= 1.12) s = fl;
    this.scale = s;
    this.canvas.width = Math.round(BASE_W * s * dpr);
    this.canvas.height = Math.round(BASE_H * s * dpr);
    this.canvas.style.width = `${Math.round(BASE_W * s)}px`;
    this.canvas.style.height = `${Math.round(BASE_H * s)}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  draw(d: BattleDraw): void {
    const g = this.offCtx;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, BASE_W, BASE_H);

    // 背景：战场外的深色土地
    g.fillStyle = '#2a2417';
    g.fillRect(0, 0, BASE_W, BASE_H);
    g.fillStyle = '#3b321f';
    g.fillRect(PAD - 3, PAD - 3, BASE_W - (PAD - 3) * 2, BASE_H - (PAD - 3) * 2);

    this.drawFloor(g);
    this.drawSiege(g, d);
    this.drawHighlights(g, d);
    this.drawUnits(g, d);

    if (d.arrow) {
      g.fillStyle = '#f4e7c0';
      const a = d.arrow;
      for (let i = 0; i < 4; i++) {
        g.fillRect(Math.round(a.x - (a.tx - a.x) * 0.02 * i), Math.round(a.y - (a.ty - a.y) * 0.02 * i), 2, 2);
      }
    }

    for (const f of d.floats) this.drawFloat(g, f);
    for (const fx of d.spellFx ?? []) this.drawSpellFx(g, fx);

    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.off, 0, 0, BASE_W, BASE_H, 0, 0, this.canvas.width, this.canvas.height);
  }

  private drawFloor(g: CanvasRenderingContext2D): void {
    for (let row = 0; row < FIELD_H; row++) {
      for (let col = 0; col < FIELD_W; col++) {
        const v = Math.floor(hash2(col, row, 4242) * 4);
        this.blit(g, `cf_${v}`, col, row);
      }
    }
  }

  /* ---------------- 攻城：城墙 / 城门 / 箭塔 ---------------- */

  private drawSiege(g: CanvasRenderingContext2D, d: BattleDraw): void {
    const siege = d.battle.siege;
    if (!siege) return;
    this.drawMoat(g);
    // 先画墙，再画塔：塔在墙后，压住墙根一点更像是"长在墙上"
    const list = siege.structures
      .filter((st) => st.hp > 0)
      .sort((a, b) => (a.kind === 'tower' ? 1 : 0) - (b.kind === 'tower' ? 1 : 0) || a.hex.row - b.hex.row);
    for (const st of list) {
      const c = hexCenter(st.hex);
      const x = Math.round(c.x + PAD);
      const y = Math.round(c.y + PAD);
      if (st.kind === 'wall') this.drawWallSeg(g, x, y, st.hp / st.maxHp);
      else if (st.kind === 'gate') this.drawGateSeg(g, x, y, st.hp / st.maxHp);
      else this.drawTowerSeg(g, x, y, st.hp / st.maxHp);
      this.drawStructureHp(g, x, y, st.hp / st.maxHp);
    }
  }

  /** 护城河：贴着城墙外侧的那条窄水。站进去的攻方防御 -2，画面上得让人看得见。 */
  private drawMoat(g: CanvasRenderingContext2D): void {
    g.fillStyle = 'rgba(38,86,124,0.55)';
    for (let row = 0; row < FIELD_H; row++) {
      const c = hexCenter({ col: MOAT_COL, row });
      const cx = c.x + PAD;
      const cy = c.y + PAD;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 180 * (60 * i - 30);
        const px = cx + Math.cos(a) * 19;
        const py = cy + Math.sin(a) * 19;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
    }
  }

  /** 一段城墙：竖向的石带，砖缝 + 攻方一侧的垛口。 */
  private drawWallSeg(g: CanvasRenderingContext2D, x: number, y: number, ratio: number): void {
    const w = 34;
    const h = 48;
    const l = x - w / 2;
    const t = y - h / 2;
    // 残破度：血越少，缺口越明显（画在顶部的碎石）
    const ruin = 1 - ratio;
    g.fillStyle = '#4a463d';
    g.fillRect(l - 1, t - 1, w + 2, h + 2);
    g.fillStyle = '#7b766a';
    g.fillRect(l, t, w, h);
    g.fillStyle = '#918c7e';
    g.fillRect(l + 3, t + 3, w - 6, h - 6);
    // 砖缝
    g.fillStyle = '#6a6559';
    for (let r = t + 8; r < t + h - 2; r += 8) g.fillRect(l + 2, r, w - 4, 1);
    for (let c = l + 9; c < l + w - 2; c += 11) g.fillRect(c, t + 4, 1, h - 8);
    // 左侧（攻方）垛口，做成锯齿
    g.fillStyle = '#5d594e';
    for (let i = 0; i < 5; i++) g.fillRect(l - 3, t + 2 + i * 9, 4, 5);
    // 顶部受创：石块崩掉
    if (ruin > 0.25) {
      g.fillStyle = '#3f3b33';
      g.fillRect(l + 4, t + 2, w - 8, Math.min(10, Math.round(ruin * 16)));
    }
  }

  /** 城门：包铁的双扇木门 + 拱顶。 */
  private drawGateSeg(g: CanvasRenderingContext2D, x: number, y: number, ratio: number): void {
    const w = 34;
    const h = 48;
    const l = x - w / 2;
    const t = y - h / 2;
    g.fillStyle = '#4a463d';
    g.fillRect(l - 1, t - 1, w + 2, h + 2);
    // 门框石
    g.fillStyle = '#6f6a5e';
    g.fillRect(l, t, w, h);
    g.fillRect(l + 4, t + 6, w - 8, 4);
    // 门洞
    g.fillStyle = '#241a10';
    g.fillRect(l + 7, t + 10, w - 14, h - 14);
    // 两扇木门（血量越低越破：门板往下缩）
    const doorH = Math.max(4, Math.round((h - 14) * ratio));
    g.fillStyle = '#6b4a2f';
    g.fillRect(l + 8, t + 10 + (h - 14 - doorH), (w - 16) / 2 - 1, doorH);
    g.fillRect(l + 8 + (w - 16) / 2 + 1, t + 10 + (h - 14 - doorH), (w - 16) / 2 - 1, doorH);
    // 铁包条
    g.fillStyle = '#3d3a33';
    for (let i = 1; i < 3; i++) g.fillRect(l + 8, t + 10 + (h - 14 - doorH) + i * 8, (w - 16) / 2 - 1, 1);
    for (let i = 1; i < 3; i++) g.fillRect(l + 8 + (w - 16) / 2 + 1, t + 10 + (h - 14 - doorH) + i * 8, (w - 16) / 2 - 1, 1);
  }

  /** 箭塔：比城墙更宽更高，塔身带箭孔，顶上一面旗。 */
  private drawTowerSeg(g: CanvasRenderingContext2D, x: number, y: number, ratio: number): void {
    const w = 30;
    const h = 40;
    const l = x - w / 2;
    const t = y - h / 2 - 6;
    g.fillStyle = '#3f3b33';
    g.fillRect(l - 2, t - 2, w + 4, h + 8);
    g.fillStyle = '#8a8578';
    g.fillRect(l, t, w, h);
    g.fillStyle = '#a09a8a';
    g.fillRect(l + 2, t + 2, w - 10, h - 4);
    g.fillStyle = '#6a6559';
    g.fillRect(l + w - 8, t + 2, 6, h - 4);
    // 石缝
    g.fillStyle = '#736e62';
    for (let r = t + 7; r < t + h - 2; r += 7) g.fillRect(l + 2, r, w - 4, 1);
    // 箭孔（朝攻方，即左侧）
    g.fillStyle = '#22190f';
    g.fillRect(l - 1, t + 12, 5, 8);
    g.fillRect(l - 1, t + 26, 5, 8);
    // 垛口
    g.fillStyle = '#5d594e';
    for (let i = 0; i < 4; i++) g.fillRect(l + 2 + i * 7, t - 5, 5, 5);
    // 旗：血少了旗就耷拉下来
    g.fillStyle = '#5a4326';
    g.fillRect(x + 8, t - 18, 1, 14);
    g.fillStyle = ratio > 0.5 ? '#c0392b' : '#6b4238';
    if (ratio > 0.5) {
      g.beginPath();
      g.moveTo(x + 9, t - 18);
      g.lineTo(x + 21, t - 14);
      g.lineTo(x + 9, t - 10);
      g.closePath();
      g.fill();
    } else {
      g.fillRect(x + 9, t - 12, 10, 2);
    }
  }

  /** 结构血条：画在格子底部，一眼看出还剩多少。 */
  private drawStructureHp(g: CanvasRenderingContext2D, x: number, y: number, ratio: number): void {
    const w = 26;
    const bx = Math.round(x - w / 2);
    const by = Math.round(y + 16);
    g.fillStyle = 'rgba(16,12,8,0.8)';
    g.fillRect(bx - 1, by - 1, w + 2, 5);
    g.fillStyle = ratio > 0.5 ? '#9ad06a' : ratio > 0.22 ? '#e8c35a' : '#e0664a';
    g.fillRect(bx, by, Math.max(1, Math.round(w * ratio)), 3);
  }

  private drawHighlights(g: CanvasRenderingContext2D, d: BattleDraw): void {
    if (d.reachable) {
      for (const k of d.reachable) {
        const [c, r] = k.split(',').map(Number);
        this.blit(g, 'chi_move', c, r);
      }
    }
    if (d.attackable) {
      for (const k of d.attackable) {
        const [c, r] = k.split(',').map(Number);
        this.blit(g, 'chi_atk', c, r);
      }
    }
    if (d.hover) this.blit(g, 'chi_hover', d.hover.col, d.hover.row);
    if (d.spellTargets) {
      for (const k of d.spellTargets) {
        const [c, r] = k.split(',').map(Number);
        this.blit(g, 'chi_spell', c, r);
      }
    }

    const active = d.activeId ? d.battle.units.find((u) => u.id === d.activeId) : null;
    if (active && active.count > 0) {
      const pulse = 0.55 + 0.45 * Math.sin(d.time / 260);
      g.globalAlpha = 0.45 + 0.35 * pulse;
      this.blit(g, 'chi_sel', active.hex.col, active.hex.row);
      g.globalAlpha = 1;
    }
  }

  private drawUnits(g: CanvasRenderingContext2D, d: BattleDraw): void {
    const list = d.battle.units
      .filter((u) => u.count > 0)
      .slice()
      .sort((a, b) => a.hex.row - b.hex.row || a.hex.col - b.hex.col);

    for (const u of list) this.drawUnit(g, d, u);
  }

  private drawUnit(g: CanvasRenderingContext2D, d: BattleDraw, u: BattleUnit): void {
    const c = hexCenter(u.hex);
    const ov = d.posOverride[u.id];
    const cx = (ov ? ov.x : c.x) + PAD;
    const cy = (ov ? ov.y : c.y) + PAD;
    if (d.lunge && d.lunge.unitId === u.id) {
      // 近战/射击时的"前冲"位移，纯表演
    }

    const team = this.atlas.need(`cbase_${u.side}`);
    g.drawImage(
      this.atlas.canvas,
      team.x, team.y, team.w, team.h,
      Math.round(cx + team.ax), Math.round(cy + team.ay), team.w, team.h,
    );

    const name = `cu_${u.unitTypeId}`;
    if (!this.atlas.has(name)) return;
    const f = this.atlas.need(name);
    const ox = d.lunge && d.lunge.unitId === u.id ? d.lunge.dx : 0;
    const oy = d.lunge && d.lunge.unitId === u.id ? d.lunge.dy : 0;
    g.drawImage(
      this.atlas.canvas,
      f.x, f.y, f.w, f.h,
      Math.round(cx + f.ax + ox), Math.round(cy + f.ay + oy), f.w, f.h,
    );

    // 数量牌
    const def = getUnit(u.unitTypeId);
    const label = String(u.count);
    g.font = 'bold 11px "Palatino", Georgia, serif';
    const w = Math.max(14, g.measureText(label).width + 8);
    const bx = Math.round(cx - w / 2);
    const by = Math.round(cy + 8);
    g.fillStyle = 'rgba(20,14,8,0.78)';
    g.fillRect(bx, by, w, 13);
    g.fillStyle = u.side === 0 ? '#ffd98a' : '#ff9c8c';
    g.fillRect(bx, by, w, 1);
    g.fillStyle = u.side === 0 ? '#ffeec2' : '#ffd6cf';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, bx + w / 2, by + 7);

    // 队首残血条
    if (u.hpTop < def.hp) {
      const bw = 22;
      const pct = Math.max(0, u.hpTop / def.hp);
      g.fillStyle = 'rgba(10,8,4,0.8)';
      g.fillRect(Math.round(cx - bw / 2) - 1, by + 14, bw + 2, 4);
      g.fillStyle = pct > 0.5 ? '#7ab55a' : pct > 0.25 ? '#d9a13a' : '#d0553f';
      g.fillRect(Math.round(cx - bw / 2), by + 15, Math.round(bw * pct), 2);
    }

    // 远程单位剩余弹药
    if (def.shots !== undefined) {
      g.fillStyle = u.shots > 0 ? '#cfe4ff' : '#8a7f6a';
      for (let i = 0; i < Math.min(6, def.shots ?? 0); i++) {
        if (i >= u.shots) break;
        g.fillRect(Math.round(cx - 12 + i * 4), by - 6, 2, 4);
      }
    }
  }

  private drawFloat(g: CanvasRenderingContext2D, f: FloatText): void {
    const a = Math.max(0, Math.min(1, f.life));
    g.globalAlpha = a;
    g.font = 'bold 13px "Palatino", Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#120c06';
    g.fillText(f.text, f.x + PAD + 1, f.y + PAD + 1);
    g.fillStyle = f.color;
    g.fillText(f.text, f.x + PAD, f.y + PAD);
    g.globalAlpha = 1;
  }

  /** 施法特效：一圈向外扩散的彩色光环，life 从 1 衰减到 0。 */
  private drawSpellFx(g: CanvasRenderingContext2D, fx: { hex: Hex; life: number; color: string; splash?: boolean }): void {
    const c = hexCenter(fx.hex);
    const p = 1 - Math.max(0, Math.min(1, fx.life)); // 0 → 1 进度
    const r = (fx.splash ? 8 : 5) + p * (fx.splash ? 26 : 14);
    const a = Math.max(0, 1 - p) * 0.9;
    g.globalAlpha = a;
    g.strokeStyle = fx.color;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(c.x + PAD, c.y + PAD, r, 0, Math.PI * 2);
    g.stroke();
    if (p < 0.35) {
      g.globalAlpha = a * 0.35;
      g.fillStyle = fx.color;
      g.beginPath();
      g.arc(c.x + PAD, c.y + PAD, (fx.splash ? 16 : 9) * (1 - p), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  private blit(g: CanvasRenderingContext2D, name: string, col: number, row: number): void {
    const f = this.atlas.need(name);
    const c = hexCenter({ col, row });
    g.drawImage(
      this.atlas.canvas,
      f.x, f.y, f.w, f.h,
      Math.round(c.x + f.ax) + PAD, Math.round(c.y + f.ay) + PAD, f.w, f.h,
    );
  }
}

export { hexKey, hexCenter };
