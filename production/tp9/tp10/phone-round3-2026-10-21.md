# 真机第三轮 · 三项界面改造（2026-10-21 18:4x）

> 承接 `design-session-2026-10-21.md` §5。主理人拍板：**边界 D · 缩放 1.2 · 战斗 C+A**，
> 追加两条：「战斗上栏全是竖着的字，没必要都写上栏」「Explore 不要上下 status bar，
> 改一个半透明半圆弧、上半能按的浮动窗口」。
> 设备：OPPO PMA110 · 792×360 CSS @DPR3 · 内容区 752×304（安全区 上 40 / 左 40 / 下 16）。

## 1. 改了什么（对着你的原话）

| 你的原话 | 改法 | 证据 |
|---|---|---|
| 「白框显得不自然」（上一轮已改 `soft`，仍嫌） | `BAND_MODE` 新增 **`shade` 并设默认**：**一条线都不画**；只把「已揭开 + 地形能走 + 本回合走不到」的格压暗 16%，树/水/山/城完全不碰 | `phone-10`（探索）、`band-shade-vs-full/`（同构建 A/B） |
| 「开始缩放不要那么大，城堡占横屏 1/3」 | `camera.zoom/targetZoom` 2 → **1.2** | 城堡 13.7% 宽 / **32% 高**，一格 38.4px，横向 ~20 格 |
| 「战斗上下栏都很大…所有的字都是竖着的」 | 顶栏 → **左上浮动胶囊**（`第 N 回合 · 法力`，点一下展开战况卡：标题 + 英雄攻防）；事故/器械各一枚独立小胶囊 | `phone-11`；旧顶栏 44px 全宽 + 6 段可收缩文字 |
| 「防御/等待/施法…用一个 floating window」 | 底栏 → **右下浮动操作簇**（三个 44px 按钮，背景半透明） | 同上 |
| 「Explore 不要上下 status bar，半圆弧上面能按」 | `#topbar` → 左上浮动只读胶囊（30px）；`#thumb` → **右下 240×124 半透明半圆盘**，4 个按钮（菜单/英雄/城/结束一天）两排摆 | `phone-10`；地图可视高 272 → **304px** |

## 2. 真机上才暴露的三个坑

1. **绝对定位不吃 `#app` 的 padding**
   `env(safe-area-inset-top)=40px / bottom=16px`（实测），而 `#topbar/#thumb` 改成 `position:absolute`
   后包含块是视口 ⇒ 首版胶囊压在系统状态栏下面、圆盘压进手势条（按「结束一天」会被上滑抢走）。
   现在两处都写 `calc(env(safe-area-inset-*) + N)`。**注释里"安全区由 #app 承担"是错的，已删。**
2. **"竖排字"不是字号问题**
   旧顶栏 `flex` 通栏 + 可收缩文字，752px 塞 6 段 ⇒ 每段被压到一个汉字宽 ⇒ CJK 逐字换行。
   新结构每条 `white-space:nowrap`，竖排从结构上不可能出现。
3. **WebView 里 `Page.captureScreenshot` 返回旧帧**
   DOM 是新的、canvas 层是上一次合成的 ⇒ 看起来像"地图没画"。真机证据一律 `adb exec-out screencap`。

## 3. 浮动盘咬手（本轮的第四个坑）

半圆里 4 个按钮是**手算坐标**，首版沿弧线一字排开 ⇒ **菜单∩英雄 20×6px、城∩结束一天 24×8px**。
重叠区落到谁身上由 DOM 顺序决定：**想点「菜单」会打开英雄栏**。`audit:touch` 抓不到
（它量中心距 vs 尺寸，叠一角时中心距仍够）。

⇒ 新增 `npm run probe:dockoverlap`：4 条几何判据（结构 4 个 / 命中高 ≥44 / **两两重叠面积 0** / 不出盘）。
现位：上排 y=28..72、下排 y=74..122（48px 主操作也在内），横向间隙 ≥12px。

## 4. 门禁与负向对照（都跑过，不是"应该会红"）

| 门 | 结果 |
|---|---|
| `tsc --noEmit` | exit 0 |
| `npm run audit:bandflip` | **15 PASS / 0 FAIL / exit 0**；`shade=147` 格；default≡shade **0 块差**；vs `full` 4866/8940；vs `off` 4258 |
| `npm run probe:dockoverlap` | **4 PASS / 0 FAIL / exit 0** |
| `npm run audit:touch` | exit 1 —— **既有 2 条 `[间距]`**（与 HEAD 同，非本轮引入） |
| `node tools/androidsync.mjs --no-cap` | 157 文件 · 缺失 0 · 不一致 0 · 标记不符 0 |

**bandflip 的 4 条负向对照**（每次改回都用 md5 核对：`MapRenderer.ts 3828975a…` / `main.ts 28d069b1…`）：

| # | 插桩 | 预期 | 实测 |
|---|---|---|---|
| 1 | 三元回落串 `'shade'` → `'soft'` | ① 红 | **5 红**（①④⑤a⑤b⑤c，`mode=soft`）|
| 2 | shade 分支改成空壳（不落笔不计数） | ③⑤c 红 | **③⑤c 红**（③ `0 ≥ 24`、⑤c `shade=0`；其余 13 条仍绿）|
| 3 | `main.ts` 的 `walkable` 传 `null` | ③⑤c 红 | **③⑤c 红** |
| 4 | 去掉 shade 分支的 `continue`（把线加回默认） | ⑤b 红 | **仅 ⑤b 红**（`rects=189`）|

**dockoverlap 的负向对照**：四组 `left/top` 改回一字排开 ⇒ **仅 ③ 红**，报
`菜单0∩英雄 20×6px、城∩结束一天 24×8px`（与预测逐像素同），改回现位 ⇒ 4 PASS。

## 5. 未做 / 下一轮

- 「英雄」两处入口并存（收起态 `#panel-toggle` 标签 + 盘里的「英雄」）⇒ 现用 `#topbar.showcase`
  右侧让 56px 避开，**没有合并**。要合并得先决定收起态那 48px 竖条留不留。
- 顶栏胶囊点开战况卡只做了"标题 + 英雄攻防"，**没有**把攻城器械/事故塞回去（它们在独立小胶囊里）。
- 战斗 15×11 铺不满 752×304 是几何事实；要 100% 得改 19×8 = 一次战斗重平衡（`design-session` §3 B）。
- 存档 `v7→v8` 迁移（资源 7→5）仍排在 alpha 之后。

## 5.5 收尾：两侧名单左右写反（10-22 真机截图抓到）

`phone-11` 里左列标题是「敌方」，列的却是场地**右侧**那批敌人；而战场约定
`side 0`（玩家）**永远画在左侧**（`hexCenter(side===0 ? col 0 : col W-1)`）
⇒ 蓝披风的弓手站在「敌方」标题下面。每列内部自洽（标题配自己那批人），
两边条数也相等（3 打 3），所以"看标题/数条数"的弱判据全绿。

修法与守门：

| 项 | 内容 |
|---|---|
| 代码 | `body.append(ourSide, field, foeSide)` + `cols = [[ourSide,0],[foeSide,1]]`（两处必须同时改） |
| 探针数据 | `__battleScene.units[]` 增 `name`（否则只能比条数，写反也相等） |
| 新断言 | ① 左列=我方/右列=敌方 ② 左列名单 = side 0 **名字多重集** ③ 几何自证 `max fx(side0) < min fx(side1)` |
| 负向对照 | 两处同时退回写反版 ⇒ **恰好 3 条红**（几何那条仍绿，符合预期）；复原 md5 `a679e7c8…` 逐字节同 |
| 结果 | `probe:touchtap` **19 PASS / 0 FAIL / exit 0**；`phone-12-battle-sides.png` 肉眼对齐 |

## 6. 复现
```bash
cd homm-web
npm run build
rsync -a dist/ android/app/src/main/assets/public/ && node tools/androidsync.mjs --no-cap
cd android && ./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk
# 证据截图（真机必须用 screencap，不能用 CDP）
adb exec-out screencap -p > ../production/tp9/tp10/phone-10-explore-dock.png
```
