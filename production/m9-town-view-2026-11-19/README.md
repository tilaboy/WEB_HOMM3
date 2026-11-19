# M9 · 城内一览（HOMM3 观感，2026-11-19）

## 结论

城镇面板新增「城内一览」入口（不是第 6 个标签页，R4 ≤5 页不变）。点开后是一层全屏城景：**中央城堡 + 16 座全尺寸建筑 + 四族程序化背景**，建筑可点、点开出详情与建造/升级按钮；升级真的换大图（Lv.2/3 体量逐级变大）。

## 为什么不是把 44px 卡片塞大

- 560×300 的城镇面板里，88px 建筑只能摆两行且要滚动，看不到"一览"。
- 所以城景是 `position:fixed` 的独立覆盖层（z-index 210，高于 `#modal-root` 的 100），返回即回原面板。
- 88px 大图不是 `drawImage` 插值：新增 `Scale2PixBuf` 把原 44px 绘制的**坐标与笔宽一起 ×2**，门窗/旗/齿轮仍是 2px 实心块；行会另有 2px 描边档。

## 改动

| 文件 | 改动 |
|---|---|
| `src/render/townViewArt.ts`（新） | `buildTownBuilding()` 88×88、`townBuildingFrameName()`、`buildTownSceneBg(owner,w,h)` 程序化山丘城景 |
| `src/ui/TownDialog.ts` | `openTownView()`；`?devtownview=0` 负向开关；「城内一览」按钮；大图 data URL 缓存 |
| `src/style.css` | `.townview` / `.tv-head` / `.tv-stage` / `.tv-grid` / `.tv-slot` / `.tv-detail` + 矮横屏适配 |
| `tools/probes/townview.mjs`（新） | 美术层 + 真 Chrome 接线层；登记 `probe:townview` |

## 关键取舍

1. **槽位**：城堡占第一排中央两列，16 座建筑分两排各 8 座（8 列网格）。844×390 横屏实测建筑渲染宽 96px；模糊/越界 0。未建建筑以 42% 灰像显示，玩家能预览"这里会长出什么"。
2. **一套规则**：城景里的建造/升级直接调 `buildStatus()` / `build()`，与建筑卡同一入口；不会出现两套价格/状态。
3. **背景**：程序化四段天空 + 远山 + 中央台地 + 土路 + 林带 + 石阶。四族换配色与太阳位置，不贴概念图位图。
4. **手机**：矮横屏（≤400px 高）收起提示行、详情条 60px；画布按舞台实际像素（实测 832×275）重画，不拉伸固定图。

## 读数

`node tools/probes/townview.mjs --gate` → **rc=0**，原始输出见 `probe.txt`。

- 美术：64 帧 88×88；四族结构差 0、材质色距全部 ≥6；兵营 L1→L3 面积 4032→5724、IoU 0.704；背景抽样色数 19×4。
- 接线：17 槽（16+1）、built 6 / unbuilt 10、8 列、源图 88px、渲染 96px、`devtier=3` 五座 `_u3` 上屏、点选详情与建造按钮齐全。
- 负向：`sameShape` ⇒ 大图 IoU 1.000；`devtownview=0` ⇒ 入口与城景都消失。

## 目检（铁律 1）

- `preview/tavern-x2.png` / `preview/dwell3_u3-x2.png` / `preview/guild3-x2.png`：×2 单张看硬边与识别件；`preview/bg-p1.png`：760×300 背景。
- `shots/townview-844x390.png`：真机尺寸实拍。城堡居中、两排建筑清楚、未建灰像可辨；详情条文字与按钮不重叠。
- 大图放大后读起来仍是原建筑的形状，没有出现 1px 细线飘在 88px 画布上；这是用像素代理而不是缩放的原因。

## 回归

同批已过：`audit:touch`（触摸目标/面板结构）、`audit:panelgate`、`probe:uip0`、`tools/probes/tp6-townpanel.mjs`（5/0）。

## 仍欠

- 目前是"全景 + 点击详情"，不是 HOMM3 那种可拖动的连续城镇地图；槽位是固定网格。
- 背景是程序化色块，不是概念图级别的细节；四族只换配色与太阳位置。
- 未做逐建筑 3D/多层升级重画（沿用 44px 原画放大），这是 B 版的真正"每座重画"范围。
