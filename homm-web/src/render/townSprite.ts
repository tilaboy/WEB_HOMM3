/**
 * 地图塔楼外形 → 精灵名。**纯函数，不碰 DOM**（`audit:townart` 直接在 node 里跑它）。
 *
 * 这两行的来历（§14.3 G5，2026-11-06）：原先是
 *
 *     tier = min(3, floor(兵营个数 / 1.5))
 *     `castle_${owner}_${tier}`
 *
 * ——档位按**兵营**选，跟城墙毫无关系，于是"木栅"和"堡垒"长得一模一样。
 * 现在档位 = `wallLevelOf(town)`（`wall1/2/3` 建到几级就是几级），
 * 四档的美术语义见 `CASTLE_WALL_SPEC`（0 无墙 / 1 木栅 / 2 石墙+1 塔 / 3 堡垒+3 塔）。
 *
 * 单独拆成模块的理由：`MapRenderer` 一 import 就要 DOM（画布、相机），
 * 验收门想直接断言"某个城 → 哪张帧"就会被拖进浏览器。这两个函数是纯的，
 * 所以闸门能离线逐档对账，而不是靠读一行源码。
 */
import type { Town } from '../core/types.js';
import { wallLevelOf } from '../core/combat/siege.js';

/** 地图外形档位：0/1/2/3 = 城防无/木栅/石墙/堡垒。 */
export function townTierOf(town: Town | undefined): number {
  return town ? wallLevelOf(town) : 0;
}

/** `castle_p1_3` / `town_neutral_0`。2×2 用 `castle_*`，1×1 用 `town_*`。 */
export function townSpriteKey(town: Town | undefined, owner: string, isCastle: boolean): string {
  const kind = isCastle ? 'castle' : 'town';
  return `${kind}_${owner}_${townTierOf(town)}`;
}
