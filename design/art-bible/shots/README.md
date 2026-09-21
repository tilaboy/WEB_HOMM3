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

---

## G-18 已闭：`0.49 → 2.22` 现在有脚本了（2026-09-21）

`cartoon-style.md §3.1.1` 并列称"客观量"的两个数，此前**只有一个有脚本**（极差 2.4→31.8 来自 `artshot.mjs`），
`相邻格平均 |ΔL*| 0.49→2.22` **全仓找不到量测脚本**（挂账 G-18，`art-director-3` 报、主理人复核成立）。现已补齐：

```bash
cd homm-web
node tools/artshot.mjs       # 除打印极差外，另落盘 g_uniform_off.png / g_uniform_on.png（1:1，1 格 = 32px）
CMP_TILE=32 node tools/imagecmp.mjs ../design/art-bible/shots/g_uniform_off.png ../design/art-bible/shots/g_uniform_on.png
#   → 极差 2.37 → 31.79 ；相邻格平均 |ΔL*| 0.49 → 2.22
```

`g_uniform_*.png` 是**全草地图、无物件**的烘焙输出 —— 这个前提**不可省**（见下）。
`imagecmp.mjs` 是通用 PNG 对照工具（自带 PNG 解码，零依赖；`CMP_TILE`＝逐格 / 相邻格指标，`CMP_CROP`＝只比某个行区间）。

### ⚠️ 口径：同一个量、两张图、两个数（都对，但量的不是同一件事）

| 图 | 是什么 | 逐格 L\* 极差 | 相邻格平均 \|ΔL\*\| |
|---|---|---|---|
| `g_uniform_*.png` | 全草、无物件（＝ §3.1.1 引用的口径） | 2.37 → 31.79 | **0.49 → 2.22** |
| `a_shade_*.png` | 全地形 + 全物件（＝ 对照页里那对） | 58.60 → 63.54 | 2.71 → 3.13 |

混地形 / 带物件时，极差被"雪原 vs 沼泽"的固有色差、以及树 / 城镇 / 英雄主导。
⇒ **引用 §3.1.1 的数必须带"全草地图"这个前提。**

## 真机视口 × 真实 Chrome（`tools/deviceshot.mjs`）

`d_chrome_*.png` 是**桌面视口 1280×900** 下抓的。要问"**玩家那台手机上差多少**"，得换成真机视口：

```bash
node tools/deviceshot.mjs out.png '<游戏URL>&devshade=0' mid   # 地貌层：关

node tools/deviceshot.mjs out.png '<游戏URL>'            mid   # 地貌层：开（其余全同）
node tools/deviceshot.mjs out.png '<游戏URL>'            low   # 只差档位
node tools/deviceshot.mjs out.png '<游戏URL>'            high
```

它用 `Emulation.setDeviceMetricsOverride` 锁 **792×320 @DPR3**（＝ OPPO PMA110 实测值），
并能在**页面加载前**写 `homm.tierMode`（`Page.addScriptToEvaluateOnNewDocument`）⇒ 可以出「只差档位」的对照。

**实测（同视口、只差一个变量；正午 `?devlight=0.22`）**：

| 对照 | 平均 \|ΔRGB\| | 变化像素占比 | 平均 \|ΔL\*\| | p95 \|ΔL\*\| |
|---|---|---|---|---|
| 地貌层 关 → 开（同 mid 档） | 2.15 | 13.4% | **0.75** | 4.46 |
| 档位 low → high | 4.94 | 30.6% | **2.14** | 7.39 |

> ★ **本轮最有用的一句**：**档位差（2.14）是地貌层（0.75）的三倍** —— 而用户真机自动探测正落在 **low**（G-15）。
> ⇒ 「先修档位探测，比再加一层美术更有效」这条推论**现在有量了**。
>
> ⚠️ **诚实边界**：档位对照**混了两个变量**（氛围层开关 ＋ `dprCap` 渲染倍率），所以它**不是"纯氛围层"的测度**：
> 同一块 792×240 的 CSS 画布，low 按 1.5×、high 按 3× 上屏，**清晰度差也在里面**（实测 low 平均 RGB 97.0/110.6/90.2 vs high 94.2/106.7/87.0 —— low 反而偏亮，是 2× 上采样把 1px 描边糊开所致）。
> 另：`warmOverlay`（L4）在**正午与深夜恒为 0**，故正午的档位对照**看不到 L4**，须用 `?devlight=0.5`（黄昏）才量得准。

## 本轮没做（留给下一单）

- **垫片 vs 真实 Chrome 的逐像素一致性**：`a_*` / `b_*` / `c_*` 仍是垫片合成。本轮只补了**真机视口**这一维，没做同图的双渲染比对。
- **`index.html` 对照页未并入本节的 `e_*` / `f_*` / `g_*`**：那页由 `artshot.mjs` 生成，只吃垫片那三对。
