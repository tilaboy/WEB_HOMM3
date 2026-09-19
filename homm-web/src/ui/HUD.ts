import type { GameState } from '../core/types.js';
import { RESOURCE_META } from '../core/data/terrains.js';
import { factionColor } from '../core/data/factions.js';
import { dayOfWeek, weekOf } from '../core/game/turn.js';
import { getAtlas } from '../render/atlas.js';

/**
 * 顶部状态条（UX IA §3.1 / §4.2 决议 R7）。
 *
 * **只读**：金 / 木 / 矿 + 稀有资源**聚合槽**（`ic_rare`）+ 短日期 + 阵营色点。
 * 整条 `pointer-events:none`、**零可点目标** —— 这是解掉"顶栏要矮（≤32px）"与
 * "按钮要够大（≥44px）"这对结构矛盾的关键：**交互全部下移到拇指带**。
 *
 * 稀有资源 4 项（宝石/水晶/硫磺/水银）聚合为一个 `ic_rare` 槽 + 合计数字：
 * 它们开局为 0、低频，7 个并列正是用户"大的大、小的小"的元凶之一。
 * 明细在**经营主面内**逐项可见（城镇造价行"还差" / 市场页「我的资源」），信息不丢。
 */
const CORE: (keyof typeof RESOURCE_META)[] = ['gold', 'wood', 'ore'];
const RARE: (keyof typeof RESOURCE_META)[] = ['gem', 'crystal', 'sulfur', 'mercury'];

export class HUD {
  private resEls = new Map<string, HTMLElement>();
  private resWrapEls = new Map<string, HTMLElement>();
  private rareValEl: HTMLElement;
  private rareWrapEl: HTMLElement;
  private dateEl: HTMLElement;
  private dotEl: HTMLElement;

  constructor(private el: HTMLElement) {
    this.el.innerHTML = '';
    const atlas = getAtlas();

    for (const k of CORE) {
      const wrap = document.createElement('div');
      wrap.className = 'res';
      // 「图标 + 数字」：读屏只念数字会失去语义 → 整项给一个可访问名（a11y 基线 §4.3）。
      // role="img" 让 aria-label 稳定生效（裸 div 上的 aria-label 各读屏实现不一致）。
      wrap.setAttribute('role', 'img');
      const icon = document.createElement('img');
      icon.src = atlas.url(`ic_${k}`);
      icon.alt = '';
      icon.draggable = false;
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = '0';
      wrap.append(icon, val);
      this.el.appendChild(wrap);
      this.resEls.set(k, val);
      this.resWrapEls.set(k, wrap);
    }

    // 稀有聚合槽：一个 24px 图标槽换掉 4 个并列格（IA §3.1 #4–7 / Q8）。
    const rare = document.createElement('div');
    rare.className = 'res rare';
    rare.setAttribute('role', 'img');
    const rIcon = document.createElement('img');
    rIcon.src = atlas.url('ic_rare');
    rIcon.alt = '';
    rIcon.draggable = false;
    this.rareValEl = document.createElement('span');
    this.rareValEl.className = 'val';
    this.rareValEl.textContent = '0';
    rare.append(rIcon, this.rareValEl);
    this.el.appendChild(rare);
    this.rareWrapEl = rare;

    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    this.el.appendChild(spacer);

    this.dateEl = document.createElement('div');
    this.dateEl.className = 'date';
    this.el.appendChild(this.dateEl);

    // 阵营徽记：降级为 9px 色点（IA §3.1 #10）。单人对局里"我是谁"开局即知，
    // 常驻文字零信息增量却占宽。
    this.dotEl = document.createElement('i');
    this.dotEl.className = 'who-dot';
    this.dotEl.title = '你的军团';
    this.el.appendChild(this.dotEl);
  }

  update(state: GameState): void {
    const res = state.players.p1?.resources ?? {};
    for (const [k, el] of this.resEls) {
      const v = (res as Record<string, number | undefined>)[k] ?? 0;
      el.textContent = String(v);
      this.resWrapEls.get(k)?.setAttribute('aria-label', `${RESOURCE_META[k as keyof typeof RESOURCE_META].name} ${v}`);
    }
    let rare = 0;
    for (const k of RARE) rare += (res as Record<string, number | undefined>)[k] ?? 0;
    this.rareValEl.textContent = String(rare);
    this.rareWrapEl.setAttribute('aria-label', `稀有资源合计 ${rare}`);

    // 短日期 `3周2日`（无空格 / 无「第」），字形由美术定（Q6）。
    // 数字抖动靠 CSS `font-variant-numeric: tabular-nums` + 定宽槽压制（B.14）——
    // 本工程字体栈是比例数字，不处理的话每过一天整条顶栏会左右抖。
    const wk = weekOf(state.day);
    const dy = dayOfWeek(state.day);
    this.dateEl.textContent = `${wk}周${dy}日`;
    this.dateEl.title = `第 ${wk} 周 第 ${dy} 日（总第 ${state.day} 天）`;

    this.dotEl.style.background = factionColor('p1');
  }
}
