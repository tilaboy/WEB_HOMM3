/**
 * 内联图标集（2026-10-23 · P1 动作图标化）
 *
 * 为什么不进图集：`atlasaudit` 的红线是**加帧前后重测**，而战斗图集 `cu_*`
 * 1020/1024 只剩 4px、冒险 u_ 与 UI 图集 2042/2048 只剩 6px —— 加任何一帧都会越线。
 * 内联 SVG 的代价是 0 图集预算，且 `currentColor` 自动跟随主题（押金：不可用 emoji，
 * 各平台字形不同，且无法随字色变化）。
 *
 * 全部 24×24 描边、`stroke-width:1.7`、圆头 —— 同一套笔触，缩到 15px 也不会糊成一团。
 */

export type IconId =
  | 'menu'
  | 'hero'
  | 'castle'
  | 'endday'
  | 'shield'
  | 'hourglass'
  | 'spark'
  | 'speed'
  | 'auto'
  | 'flee';

/** 每条 = 一个 `<path d>`；多段用数组。 */
const PATHS: Record<IconId, string[]> = {
  // 三横：最短的一画在下，避免和"汉堡菜单"完全一样而显得廉价
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h11'],
  // 人头肩：动作栏里的"英雄"不是盾，别和"防御"撞车
  hero: ['M12 12.5a4 4 0 100-8 4 4 0 000 8z', 'M5 20.5c.7-3.6 3.6-6 7-6s6.3 2.4 7 6'],
  // 三垛口 + 门洞
  castle: ['M4 20V9h2.5V6h2v3h3V6h2v3h3V6h2v3H20v11z', 'M10.5 20v-3.6a1.5 1.5 0 013 0V20'],
  // 月牙 = 一天结束（用沙漏会和"等待"重复）
  endday: ['M20 14.2A8.2 8.2 0 019.8 4 8.5 8.5 0 1020 14.2z'],
  shield: ['M12 3.2l7 2.8v5.4c0 4.2-2.9 7.4-7 9.4-4.1-2-7-5.2-7-9.4V6z'],
  hourglass: [
    'M7 3.5h10',
    'M7 20.5h10',
    'M7.5 3.5c0 4 4.5 5.2 4.5 8.5s-4.5 4.5-4.5 8.5',
    'M16.5 3.5c0 4-4.5 5.2-4.5 8.5s4.5 4.5 4.5 8.5',
  ],
  spark: ['M12 3.5l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2z'],
  speed: ['M6 6.5l5.5 5.5L6 17.5', 'M13 6.5L18.5 12 13 17.5'],
  auto: ['M19.5 12a7.5 7.5 0 11-2.6-5.7', 'M19.5 4.5v5h-5'],
  flee: ['M6.5 20.5V4', 'M6.5 4.5h11l-2.2 4 2.2 4h-11'],
};

const SPRITE_ID = 'svg-sprite';

/**
 * 把 sprite 挂进文档（幂等）。`display:none` 的 svg 里 `<symbol>` 仍可被 `<use>` 引用。
 * 必须在**任何**图标创建之前调用一次；`main.ts` 启动时调。
 */
export function installIcons(): void {
  if (document.getElementById(SPRITE_ID)) return;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.id = SPRITE_ID;
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  for (const [id, paths] of Object.entries(PATHS)) {
    const sym = document.createElementNS(NS, 'symbol');
    sym.id = `i-${id}`;
    sym.setAttribute('viewBox', '0 0 24 24');
    for (const d of paths) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      sym.appendChild(p);
    }
    svg.appendChild(sym);
  }
  document.body.appendChild(svg);
}

/** 造一枚图标。`cls` 默认 `ti`（尺寸/描边由 CSS 给，不在 TS 里写死）。 */
export function icon(id: IconId, cls = 'ti'): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#i-${id}`);
  svg.appendChild(use);
  return svg;
}

/**
 * 给按钮装「图标 + 文字」：图标在前、文字进 `.tl`。
 *
 * ⚠️ **文字必须留在 DOM 里**（不改成 `aria-label` 了事）：本仓多道门
 * （`audit:touch` / `probe:dockoverlap` / `audit:panelgate`）是按 `textContent`
 * 找按钮的，纯图标会让它们全部找不到目标 —— 那不是"门过期"，是把被测对象改名了。
 * 图标一律 `aria-hidden`，可访问名仍来自文字。
 */
export function labelIcon(btn: HTMLElement, id: IconId, text: string): void {
  btn.textContent = '';
  const t = document.createElement('span');
  t.className = 'tl';
  t.textContent = text;
  btn.append(icon(id), t);
}

/** 只换文字、保留图标（`结束一天` → `对局结束` 这类动态文案走它）。 */
export function setLabel(btn: HTMLElement, text: string): void {
  const t = btn.querySelector('.tl');
  if (t) t.textContent = text;
  else btn.textContent = text;
}
