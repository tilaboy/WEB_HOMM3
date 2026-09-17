import type { MapLayout } from '../types.js';

/**
 * 地图布局模板（M8）。
 *
 * 设计原则：**结构由模板决定，纹理仍由种子决定**。
 * 同一档布局在任何种子上都保持同一个"骨架"（几片陆、几条水道、主城在哪一带），
 * 玩家在设置页看一眼预览就知道这局要打什么仗；但每局的湖岸线、矿点、宝物
 * 仍然随种子变化，不会两张图长得一模一样。
 */
export interface LayoutDef {
  id: MapLayout;
  name: string;
  /** 设置页按钮上的小字 */
  sub: string;
  /** 悬停提示：这一档想让玩家做什么决策 */
  desc: string;
}

export const LAYOUTS: Record<MapLayout, LayoutDef> = {
  wild: {
    id: 'wild',
    name: '旷野',
    sub: '自然地形',
    desc: '随机湖泊与丘陵，四家环绕地图中心起步；最均衡，也最像"标准图"',
  },
  ring: {
    id: 'ring',
    name: '同心环',
    sub: '三层环带',
    desc: '两道护城河把地图分成三层：外环是四家的起手区，内环是金矿，中心高地藏着最肥的宝库——想拿就得先过河',
  },
  islands: {
    id: 'islands',
    name: '双子岛',
    sub: '海峡分隔',
    desc: '一条蜿蜒海峡把大地一分为二，只有两三座桥相通；前中期各占一岛发育，决战靠抢桥',
  },
  lanes: {
    id: 'lanes',
    name: '三路走廊',
    sub: '横向三路',
    desc: '三条横向走廊，两道河脊只留几个缺口；缺口是必经之路，谁先卡住谁说了算',
  },
};

export const LAYOUT_ORDER: MapLayout[] = ['wild', 'ring', 'islands', 'lanes'];

export function layoutName(id: MapLayout): string {
  return LAYOUTS[id]?.name ?? LAYOUTS.wild.name;
}
