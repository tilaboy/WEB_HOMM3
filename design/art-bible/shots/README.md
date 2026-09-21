# 地图层画面提升 · 对照证据

本目录是「画面主线」那一轮的改前/改后证据。**每对只差一个变量**，便于归因。

## 三对隔离对照（`tools/artshot.mjs`，headless **垫片**合成）

| 文件 | 变量 | 说明 |
|---|---|---|
| `a_shade_off.png` / `a_shade_on.png` | 只差 `macroShade` | 地形「地貌层」—— 关＝逐格同型砖重复（壁纸感）；开＝地图尺度方向光＋低频起伏＋亮暖暗冷 |
| `b_dress_off.png` / `b_dress_on.png` | 只差 `setDressing` | 喜剧布景层 A 组地面涂鸦 |
| `c_night_before.png` / `c_night_after.png` | 只差光照相位 | 夜光 L1/L2 |

**客观量（同一张全草地图，只差地貌层）**：逐格平均 L\* 极差 **2.4 → 31.8**；相邻格平均 \|ΔL\*\| **0.49 → 2.22**。
> 前一列是「有没有变」，后一列才是「**看不看得见**」—— 判「画面有没有变化」要量**局部对比**，不能只量整图极差。

## ⚠️ 这批图的性质（必读，别当"真机截图"引用）

`a_*` / `b_*` / `c_*` 是**运行期真实渲染代码**（`TerrainLayer.bake()` / `SetDressingLayer.bake()` / 图集）
在 node 里的 headless 合成，用**自建 Canvas2D 垫片**（零依赖），**不是浏览器渲染、也不是真机截图**。
它证明「地形烘焙的输出差在哪」；**未答**「垫片合成语义 vs 真实 Chrome Canvas2D 是否逐像素一致」。

## 真 Chrome 对照（`tools/chromeshot.mjs`）

| 文件 | 说明 |
|---|---|
| `d_chrome_noon.png` | **真实 headless Chrome** 打开真实游戏（`?devlight=0.22` 正午＝无叠色） |
| `d_chrome_night.png` | 同上，`?devlight=0.68` 深夜 |

用法：`npm run build && node tools/serve.mjs`（另开终端）`&& node tools/chromeshot.mjs <out.png> <url>`。

**它验证了什么（可复算）**：正午→深夜的游戏区平均 RGB **66.3/82.7/66.8 → 46.4/59.1/53.8**。
multiply 理论值 = 原色 × tint/255，tint = `rgb(178,182,205)`：
`66.3×178/255=46.3` · `82.7×182/255=59.0` · `66.8×205/255=53.7` ⇒ **实测 46.4 / 59.1 / 53.8，逐通道吻合**。
⇒ **夜光 L1/L2 的 tint 在真 Chrome 里确实按该值生效**（不是只在规格里）。

**仍未验证**：垫片 vs 真实 Chrome 的**逐像素**一致性（本轮没做；本目录的 A/B 隔离对照依赖垫片）。
