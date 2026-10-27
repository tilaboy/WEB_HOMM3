/**
 * 资源图标（2026-10-27）：7 种资源各一枚**实心**剪影，供城镇建造卡与库存条使用。
 *
 * 为什么单独一个 sprite，而不是塞进 `icons.ts`：
 *   ① 那边是 24×24 **描边**动作图标（`stroke:currentColor; fill:none`），资源在 12~14px
 *      下必须靠**实心剪影**才分得清 —— 描边缩到 12px 会糊成一团灰；
 *   ② 那边有门在数 symbol 数量（10 个主动作必须都有图标，且 `<use>` 不得断引用），
 *      混进 7 个资源会把这把尺的语义搅浑。
 *
 * 同样不进图集：`audit:atlas` 的红线只剩 4~6px，加一帧就爆。
 */
export type ResId = 'gold' | 'wood' | 'ore' | 'gem' | 'crystal' | 'sulfur' | 'mercury';

/**
 * 每条 = 若干 `<path d>`（全部 `fill:currentColor`，可以画洞：`fill-rule:evenodd`）。
 *
 * 形状取向按"缩到 12px 还认得出"来选：
 *   金 = 有孔圆片 / 木 = 横放的圆木（带年轮孔）/ 矿 = 带棱的块 /
 *   宝石 = 正方钻 / 水晶 = 长六棱柱 / 硫磺 = 圆顶堆 / 水银 = 水滴。
 */
const SHAPES: Record<ResId, string[]> = {
  // 圆环：外圆 + 内圆（evenodd 抠成片）
  gold: ['M12 2.4a9.6 9.6 0 100 19.2 9.6 9.6 0 000-19.2zm0 4.6a5 5 0 110 10 5 5 0 010-10z'],
  /**
   * 木 = **针叶树剪影**（两层三角 + 树干）。
   *
   * 试过三版"木料"：① 三根横板（14px 下读作汉堡菜单 ≡）；② 两根圆木带年轮（读作电池）；
   * ③ 斜切木板堆（读作斜线）。只有树的剪影在小尺寸下**没有第二种读法** ——
   * 而资源图标只需要回答"这是哪一样"，不需要画得像美术设定。
   * 判别方式是把它和另外 6 枚一起缩到 14px 看（`production/res-icons-14px.png`）。
   */
  wood: [
    'M12 1.8l6.3 8.6H5.7z',
    'M12 8.2l8.2 10.8H3.8z',
    'M10.7 18.6h2.6v3.6h-2.6z',
  ],
  /**
   * 矿 = 带棱的**岩块**。
   * 首版那枚只占盒子 46%（`7.2..18.2 × 6.5..19.2` 且上窄），14px 下缩成一粒灰点，
   * 和"没画"几乎分不开。改成占满 70% 的粗块 + 一条棱线，轮廓才立得住。
   */
  ore: ['M4.8 13.4l4.4-7 6.4-.8 3.8 5.6-1.4 6.6-7.6 1.2z', 'M9.2 6.4l1.6 7.2-5.6 5.4'],
  // 正方钻（上窄下尖）
  gem: ['M12 2.6l7.6 6.6L12 21.4 4.4 9.2z'],
  // 长六棱柱
  crystal: ['M12 1.8l3.9 6.6-3.9 13.8-3.9-13.8z'],
  // 圆顶堆（硫磺）
  sulfur: ['M3.6 20.4c0-6.4 3.7-11.2 8.4-11.2s8.4 4.8 8.4 11.2z', 'M8.2 14.4l3.8 3.4 3.8-3.4'],
  // 水滴
  mercury: ['M12 2.2c3.7 5.2 6.2 8.5 6.2 11.9a6.2 6.2 0 11-12.4 0c0-3.4 2.5-6.7 6.2-11.9z'],
};

const SPRITE_ID = 'res-sprite';
const NS = 'http://www.w3.org/2000/svg';

/** 挂 sprite（幂等）。`openTownDialog` 进来先调一次即可，不必在每个模块入口都调。 */
export function installResIcons(): void {
  if (document.getElementById(SPRITE_ID)) return;
  const svg = document.createElementNS(NS, 'svg');
  svg.id = SPRITE_ID;
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  for (const [id, paths] of Object.entries(SHAPES)) {
    const sym = document.createElementNS(NS, 'symbol');
    sym.id = `r-${id}`;
    sym.setAttribute('viewBox', '0 0 24 24');
    for (const d of paths) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      // 实心 + evenodd：年轮/内圈靠"洞"表达，不额外加描边
      p.setAttribute('fill', 'currentColor');
      p.setAttribute('fill-rule', 'evenodd');
      sym.appendChild(p);
    }
    svg.appendChild(sym);
  }
  document.body.appendChild(svg);
}

/** 造一枚资源图标。颜色由 CSS 的 `.ri-<kind>` 给（卡片底色是深棕，7 色都验过）。 */
export function resIcon(kind: ResId, cls = 'ri'): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', `${cls} ri-${kind}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#r-${kind}`);
  svg.appendChild(use);
  return svg;
}
