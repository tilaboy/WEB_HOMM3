# M9 · 七种矿各一个剪影（2026-11-19）

## 结论

七种矿场从「同一顶帐篷 + 右下角换颜色」改成**七张独立程序化像素画**：

| 资源 | 识别件 | bbox (x0,y0)-(x1,y1) | 面积 |
|---|---|---|---|
| gold | 矿车 + 两座冒尖的金锭堆 | (3,12)-(29,41) | 517 |
| wood | 两根剥皮原木做锯架 + 三根横木 | (3,7)-(29,41) | 676 |
| ore | 宽阶梯崖壁 + 洞口 + 出矿轨道 | (1,12)-(31,41) | 784 |
| gem | 矮洞 + 三根粉紫晶簇 | (3,5)-(29,41) | 776 |
| crystal | 五根彼此分离的细高蓝晶柱（无洞） | (1,4)-(30,41) | 783 |
| sulfur | 细颈喷口 + 三层黄烟云 | (6,3)-(26,41) | 568 |
| mercury | 宽浅银池 + 左右两只高罐 | (1,17)-(31,41) | 565 |

## 改动

- 新增 `homm-web/src/render/mineArt.ts`：32×42 帧、`MINE_KINDS` / `mineArtName()` / `buildMineArt()`，以及仅供闸门使用的 `setMineArtBreaks({sameShape:true})` 负向对照。
- `src/render/atlas.ts`：删除旧 `mine()` 与 `RES_COLOR`，改为逐型 `put(mineArtName(k), buildMineArt(k))`。地图渲染侧 `mine_<resource>` 的动态取名不变，零接线改动。
- 新增闸门 `tools/probes/mineart.mjs`，登记到 `package.json`（`probe:mineart`）与 `tools/GATES.md`：覆盖 / 两两 IoU / 识别件 / 图集注册 / 同款帐篷负向对照。

## 读数

`node tools/probes/mineart.mjs --gate --negctrl` → **rc=0**，原始输出见 `probe.txt`。

- 21 对剪影两两 IoU：max **0.741**（ore/crystal），min 0.305（sulfur/mercury），全部 ≤0.75。
- 负向对照：七型强制同款帐篷 ⇒ IoU **1.000**，闸门有分辨力。
- 图集七帧齐（[M4] 7/7），没有「画了没人用」。

## 目检（铁律 1）

`x8/` 下七张 ×8 单张图逐张看过：金矿读作矿车与金堆；木矿读作锯架堆木；石矿是宽崖壁与洞；宝石是洞口上三簇粉紫晶体；水晶是一排分离尖塔；硫磺是上方黄烟云与细颈；水银是两罐夹一池。七者在小尺寸下不会互相认错。

## 边界

这是**美术批次**：不改任何资源产出、地图布局、存档或随机数流；不改已有帧名，旧存档的矿对象 payload 完全不变。地砖上仍按原来的 `ax/ay` 贴地锚点绘制。
