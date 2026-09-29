import type { TerrainKind } from '../../types.js';

/**
 * 一张**从外部导入的固定地形**（HoMM3 `.h3m` 地表层 crop，见本目录）。
 *
 * 与程序生成相对：地形**不是**由种子算出来的，而是逐格写死 ⇒ 同一张图每一局
 * 长得一模一样，玩家可以认路（这正是"在他熟悉的那张图上看到改进"的前提）。
 * 物件（城 / 矿 / 野怪）仍然由现有生成器摆放 —— 导入的只是画布。
 *
 * 为什么类型**单独放一个文件**、不放进 `core/types.ts`：
 *   ① 它只被静态图这条链路用（生成器 + 场景 + 生成脚本），放进 `types.ts`
 *      等于让一条新功能去动一个**所有人都在改**的公共文件，提交时会把别人的
 *      在途改动一起卷进来。
 *   ② 生成脚本（`tools/h3m-terrain.mjs`）和运行时模块都要引用它 ⇒ 放在本目录，
 *      「数据 + 它的类型」是一份东西，不会漂。
 *
 * `tiles[y][x]`，值必须是 `TerrainKind`（`core/data/terrains.ts` 的 7 档）。
 * 挂在 `ScenarioDef.staticMap` 上；**自由对局不带 scenario ⇒ 取不到它 ⇒
 * 生成结果与引入前逐字节一致**。
 */
export interface StaticMapData {
  /** 源地图文件名（只用于人读与验收对账）。 */
  source: string;
  /** crop 窗口在源地图地表层里的左上角坐标（换窗口时用它定位）。 */
  origin: { x: number; y: number };
  width: number;
  height: number;
  tiles: TerrainKind[][];
}
