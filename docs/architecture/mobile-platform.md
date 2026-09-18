# 移动端平台规格（手机优先 · Capacitor）

> ## 实现状态（2026-09-18 更新（第二轮）· 程基岩）——先读这段，勿把「设计」当「现状」
>
> 本文档**混合「已交付代码」与「仍是设计」两部分**。这正是 `production/roadmap.md` 中 G-10 记录的同类风险（把目标状态写成了现状），所以逐条标注：
>
> - **已实现并提交（性能 / 渲染基础）**：§4.4 全部降级开关、§4.2/§4.3 分档与启动探测、第 6 节 **M-01 / M-02 / M-03 / M-04**（commit `9aba485`）。代码里真实生效的档位值见 **§4.5**（authoritative）。
> - **已实现并提交（Capacitor 打包 + 生命周期 + 存档）**：§2 的 **Android 内测打包**，以及第 6 节 **M-05 生命周期 / M-06 音频挂起 / M-13 Preferences 双写**——模块由 eng-package（`49c2678`）落地，随后由 team-lead（`be7d9c9`）**接线进 `main.ts`**。⚠️ **接线才是生效前提**：`installLifecycle()` 未接入 `main.ts` 前，`src/app/lifecycle.ts` 是**死代码**；`hydratePersistence()` 未接入前，M-13 的 Preferences 水合**永不运行**。
> - **已实现并提交（触屏体验 + 安全区）**：第 6 节 **M-07 安全区 / M-08 横屏 / M-09 触控热区 / M-11 双击居中**，以及 **M-10 的 web 侧**（`a668e63`；M-09 分级残余 `17e1b29`）。
> - **✅ M-07 已于 2026-09-18 在真机验证通过**（OPPO PMA110 / Android 16 / API 36 / DPR 3.0 / WebView 151）：截图**白带 0 行**、窗口 full-bleed `[0,0][2376,1080]`、状态栏浅色图标画在深色上清晰可读、底部手势条压在深色背景上。**CSS 与 `viewport-fit=cover` 均无需改动。**
> - **⚠️ 但要记住这次的教训**：同一份 APK 在**模拟器**上曾出现明显白带（顶 74px / 底 63px / 左 136px），真机**完全不复现** —— 那是模拟器的假阳性。**系统栏 / 安全区 / edge-to-edge 的判定一律以真机为准**，模拟器截图不可用于此项。**帧时间与 GPU 行为同理**。
> - **部分实现**：**M-10 长按**——web 侧（位移阈值 4→8px + CSS 长按菜单抑制）已交付，但**原生触觉 `@capacitor/haptics` 尚未接线**（插件已装，`impact('light')` 未接 → 长按暂无原生触觉反馈）。
> - **仍是设计、未写一行代码**：§3.5 手势状态机（**M-12**）、第 6 节 **M-14 图集瘦身**；§2 的 **iOS 侧**（`Info.plist` 方向锁定 / 状态栏 / 图标资产，本轮到 Android 内测为止）。
> - 第 6 节每条已加 **「实现状态」** 列；原稿中被实测证伪的两处前提（M-02 的 `Path2D`、M-07/M-09 的「截图基线」）已更正。
> - **本文档不再维护「打包 / 构建环境」的事实**（Capacitor 版本、SDK 级别、JDK、无打包器约束等）——那部分已迁到 **`docs/architecture/android-build-runbook.md`**，本文档 §2 中相关段落只作历史标注（见 §2 顶部提示）。
> - **行号提示**：M-01~M-04 改动 `main.ts` / `MapRenderer.ts` / `BattleRenderer.ts` / `terrainLayer.ts`；随后 M-05~M-11 又多次改动 `main.ts`、`style.css`、`HUD.ts`、`HeroPanel.ts`、`TownDialog.ts`、`persistence.ts`、`sfx.ts`。§1、§3.6 里引用的旧行号**已大幅位移**——**以实现时的代码为准**（关键位移已在 §3.6、第 6 节标注）。

> 状态：定稿待批 | 作者：程基岩（技术方向） | 任务：E1
> 目标平台：**iOS + Android，手机优先，横屏锁定**（本轮到 Android 内测打包为止）
> 首稿只出方案，**未改动任何 `src/` 代码**；后续轮次已按第 6 节把 **M-01~M-11 与 M-13 落地**（其中 **M-10 仅 web 侧**；**M-12 / M-14 仍是设计**），见上方「实现状态」、§4.5 与第 6 节「实现状态」列。
> 所有"现状核实"基于对仓库的实际阅读；性能数字凡属估算均标注依据，未实测的一律标 **未验证**。

---

## 0. 结论摘要（先看这一段）

| 问题 | 结论 |
|---|---|
| 交付形态 | **Capacitor 包壳**（`@capacitor/core` + ios/android），Web 版继续作为开发与测试主目标；Tauri 桌面方案**作废** |
| 包体 | 磁盘资源 **≈ 0.52 MB**（自研 JS 493 KB + CSS 24 KB，gzip 后 145 KB），**零图片零音频**。安装包 iOS **≈ 8–13 MB**、Android **≈ 4–7 MB**（数字见 §2.7） |
| 边缘滚屏 | **废弃于触屏，仅在检测到真实鼠标时启用**。不换虚拟摇杆，改用**双击居中**。见 §3.2 |
| 触屏镜头 | 单指拖拽平移 + 双指捏合缩放（已有代码，保留）；双击居中（新增）；长按/边缘滚屏重定义 |
| 长按阈值 | **420 ms / 位移 < 8 px**（沿用代码现值的时长，收紧位移阈值），触发时给触觉反馈 |
| 最小触控热区 | **44×44 CSS px**（主要操作 48×48）；当前 HUD 按钮 min-height 只有 **30–32 px，不达标，必须改** |
| 性能分档 | 低端 30fps / 中端 60fps / 高端 60fps（ProMotion 允许 120）；判定用**启动期 30 帧微基准 + localStorage 缓存**，见 §4.3 |
| 返工清单 | **14 条**，其中 P0 四条：边缘滚屏 gate、地形烘焙内存、光照分档、DPR 钳制。见 §6 |
| Top3 风险 | ~~① Canvas2D `multiply/overlay` 在移动 WebView 掉出 GPU 快路径~~ **✅ 已消除（2026-09-18 真机实测）** ② WebView 进程被内存告警杀掉 ③ iOS localStorage 被系统回收导致丢档。见 §7 |
| 需用户拍板 | 3 条开放问题，见 §8 |

---

## 1. 现状核实（team-lead 给我的 4 条，逐条验证）

| # | 我的原判断 | 核实结果 | 证据 |
|---|---|---|---|
| 1 | `main.ts:1065` 边缘滚屏条件不安全 | **条件属实**：`if (mouseIn && pointers.size === 0 && !isModalOpen() && !isBattleOpen()) camera.edgeScroll(...)`。`mouseIn` 被**任何** `pointermove` 置 true（第 819 行），触屏拖动同样走这条路。`pointerleave`（第 865 行）会置 false，但它在 pointer capture（第 790 行 `setPointerCapture`）下的真机触发时机**未验证** | `src/main.ts:765–880`、`1065` |
| 1b | 概念问题 | **比条件问题更根本**：触屏没有"悬停"，"指针贴边"无意义。所以修法不依赖事件顺序——直接按指针类型 gate | — |
| 2 | 地形整图烘焙，巨型图 1536×1536 ≈ 9 MB | **正确**：`canvas = width*TILE × height*TILE`，`TILE=32`。巨型 48×48 → 1536×1536 ≈ **9.0 MiB**。但**默认地图是中型 32×32 → 1024×1024 ≈ 4.0 MiB**，风险只在"大型/巨型"档 | `src/render/terrainLayer.ts:62–69`、`src/core/types.ts:52–59`、`src/render/atlas.ts:11` |
| 3 | `lightLayer` 每帧全屏 multiply + overlay + 径向暗角 | **正确**：三遍全屏填充，且 `createLinearGradient` / `createRadialGradient` **每帧新建**（GC 压力） | `src/render/MapRenderer.ts:371–417` |
| 4 | 缺安全区/横屏/DPI 分档/后台暂停 | **全部属实，并补充两点**：<br>· `main.ts` 里**完全没有** `visibilitychange` / `pagehide` / `blur` 处理（只有 `BattleScreen.ts:963`，且它只清了瞄准框，没停 rAF / 没 suspend 音频）<br>· `viewport` meta 缺 `viewport-fit=cover`，全仓**无 `env(safe-area-inset-*)`**，媒体查询只有 `max-width: 860/900/720` 三个桌面向断点 | `src/main.ts`（无匹配）、`src/ui/BattleScreen.ts:960–963`、`public/index.html`、`src/style.css` |

### 1.1 需要更正的两处

- **图集不是 1024×1024，是 2048×2048**：`atlas.ts:751` 是 `new Packer(2048, 2048)` → **16 MiB**（不是 4 MiB）。战斗图集 `combatAtlas.ts:91` 是 `Shelf(1024, 512)` → **2 MiB**。这是我要修正的**最重要的内存事实**。
- **HUD 按钮触控热区不达标**：`style.css` 里按钮 `min-height` 为 30–32 px（第 120、470 行），低于 44 px 移动端下限。DESIGN.md §七 写的 44×44 是**规格，不是现状**。

### 1.2 已核实的资产体积（包体优势的量化来源）

`dist/` 全量实测：

| 项 | 原始 | gzip |
|---|---|---|
| JS 合计（core 584K + render 348K + ui 236K + main 44K） | **493,496 B** | **139,677 B** |
| CSS | 24 KB | **5,612 B** |
| 图片 / 音频 / 字体 | **0 B** | 0 |
| icon.svg | 512 B | — |

**磁盘资源总计 ≈ 0.52 MB 原始 / 145 KB 压缩。** 运行时图集（16 MiB）与地形烘焙（最多 9 MiB）都是**代码在内存里现画的，不占安装包一个字节**——这就是本项目相对商业手游（100 MB–2 GB）的核心优势。

---

## 2. Capacitor 打包方案

> **⚠️ 本节写于 Capacitor 6 时代，不是落地现状（2026-09-18 标注）。** 实际落地用的是 **Capacitor 8.5.2**，本节各处的版本数字——§2.2 的 **JDK 17**、§2.4 的 **`compileSdk/targetSdk 34` / `minSdk 23`**、§2.5 的 **iOS 部署目标 ≥ 13**、§2.7 的 **运行时体积**——都属**写作时前提**，与真参数不符。**打包 / 构建环境的权威事实见 `docs/architecture/android-build-runbook.md`**（Capacitor 8 vs 6 的差异：JDK **21**、compileSdk/targetSdk **36**、minSdk **24**、**零打包器 ⇒ 必须走原生注入的 `window.Capacitor` 全局**、Android 15+ edge-to-edge ⇒ `SystemBars`）。本节仅作方案论证保留，不再逐条改写（§2.2 / §2.4 已就地标注）。

### 2.1 为什么"改代码量≈0"就能包

`core/` 是零 DOM 的纯 TS；`render/`+`ui/` 只依赖标准 DOM/Canvas2D/WebAudio。Capacitor 壳子本质上是一个指向 `dist/` 的 WebView，**不需要为了"能跑"改任何业务代码**。需要动的只是：入口 HTML 的 meta、CSS 的 insets、以及 §3/§4/§5 的触屏与性能专项。

### 2.2 具体步骤与命令

```bash
cd homm-web

# 1) 业务构建（已有）
npm ci && npm run build          # tsc → dist/

# 2) 装壳（注意：这会打破 package.json「零运行时依赖」的纯度，见 ADR）
npm i @capacitor/core @capacitor/app @capacitor/preferences @capacitor/haptics \
      @capacitor/status-bar @capacitor/screen-orientation
npm i -D @capacitor/cli

# 3) 初始化（webDir 必须指向 dist）
#    ⚠️ 下面这行是**首稿阶段的示意值**（`com.yourorg.herosong` 当时尚不存在）。
#    实际已拍板并落地的是：appId `com.a2studio.thecodeofchivalry`、appName `骑士信条`（D-16）。
npx cap init "骑士信条" com.a2studio.thecodeofchivalry --web-dir=dist

# 4) 加平台
npx cap add ios
npx cap add android

# 5) 每次改完前端
npm run build && npx cap sync        # 只同步 dist/ 与插件原生定义

# 6) 打开原生工程
npx cap open ios        # 需要 Xcode 15+
npx cap open android    # 需要 Android Studio + JDK 21（⚠️ 原稿写 17；Capacitor 8 实为 21，见 runbook）
```

`npx cap sync` 只做两件事：把 `dist/` 拷进原生工程、按 `package.json` 里的 Capacitor 插件更新原生依赖——**不会重编 Web 代码**，所以迭代节奏仍是"改 → `npm run build` → `cap sync` → 真机跑"。

### 2.3 `capacitor.config.ts`（关键字段与理由）

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.a2studio.thecodeofchivalry',  // D-16 拍板值（首稿示意值 com.yourorg.herosong 已作废；旧名撞名多款在运营手游）
  appName: '骑士信条',
  webDir: 'dist',
  backgroundColor: '#1b1f24',       // 与 manifest theme_color 一致，避免启动白闪
  android: {
    androidScheme: 'https',         // 默认值，保持 https://localhost —— localStorage/SW 的 origin 才稳定
    allowMixedContent: false,
    webContentsDebuggingEnabled: false, // 只在 debug 构建打开
  },
  ios: {
    contentInset: 'never',          // 自己用 env(safe-area-*) 管 insets，不让 WebView 二次内缩
    backgroundColor: '#1b1f24',
    preferredContentMode: 'mobile', // 关键：不要 'desktop'，否则媒体查询按 iPad 宽度命中
  },
  plugins: {
    ScreenOrientation: { lock: 'landscape' },
  },
};

export default config;
```

要点解释：
- `androidScheme: 'https'`（默认）配 `ios` 的 `capacitor://localhost` —— 保证 `location.protocol` 判断与 localStorage 分区稳定。**`main.ts:1114` 的 `location.protocol === 'https:'` 判断在 iOS 壳里为 false，Service Worker 不会注册**——这正是我们想要的（原生壳里资源来自包内，不需要 SW）。
- `preferredContentMode: 'mobile'`：iOS 默认可能用桌面宽度渲染 WebView，会让 `max-width: 900px` 的媒体查询全部失效、直接显示桌面三栏布局。**必须显式设 `mobile`**，否则手机上会看到桌面 UI。
- `webContentsDebuggingEnabled` 只在 debug 打开，Release 关（安全 + 性能）。

### 2.4 Android 注意事项

1. **最低 / 目标 SDK**：`compileSdk 36`、`targetSdk 36`、`minSdk 24`（**Capacitor 8 实际值**；⚠️ 原稿写 `34 / 34 / 23`，属 Capacitor 6 时代）。targetSdk 是 Google Play 逐年抬高的硬要求——落地值以 `docs/architecture/android-build-runbook.md` 为准。
2. **方向锁定**：`android/app/src/main/AndroidManifest.xml` 的 `<activity>` 上加
   `android:screenOrientation="sensorLandscape"`（sensor 前缀允许左右翻转，用户体验更好；纯 `landscape` 会锁死一个方向）。
3. **WebView 版本**：Android 4.4 之后的 WebView 可独立升级，Canvas2D 走 GPU 的前提是 WebView ≥ 74（`multiply`/`overlay` 合成）。minSdk 23 的机器可能带老 WebView。**加一个运行时探测**（见 §4.3）兜底。
4. **回退键（Back）**：默认行为是退出 App。必须用 `@capacitor/app` 的 `backButton` 事件接管 → 映射为"关闭弹窗 / 取消施法 / 再按退出"，否则玩家一按返回就直接退出游戏。
5. **签名与上架**：Play 上架需 AAB + keystore（一次性 $25）。本游戏无需任何运行时权限（不联网、不读存储、不定位）——**`AndroidManifest.xml` 里不要加多余权限**，少权限能显著降低商店审核摩擦。
6. **`android:hardwareAccelerated="true"`** 是默认值，别关。

### 2.5 iOS 注意事项

1. **Xcode 15+ / iOS 部署目标 ≥ 13**（Capacitor 6 要求）。
2. **方向锁定**：`ios/App/App/Info.plist` 的 `UISupportedInterfaceOrientations` **只保留** `UIInterfaceOrientationLandscapeLeft` 与 `LandscapeRight`；iPad 的 `UISupportedInterfaceOrientations~ipad` 保留四方向（平板横竖都可玩，见 §5.2）。
3. **状态栏**：`UIStatusBarHidden = true` + `UIViewControllerBasedStatusBarAppearance = false`，全屏 edge-to-edge，insets 交给 CSS `env()`。
4. **App Store 审核的红线（必须提前知道）**：Guideline **4.2 Minimum Functionality** —— 纯粹"网站套壳"会被拒。本项目靠三点站得住：**完全离线可玩**、**运行时原生能力**（触觉反馈、方向锁定、安全区适配）、**非网页内容形态**（程序化像素游戏，不是内容站）。若日后加内购/Game Center，这条彻底不成问题。**这是本方案最需要主动经营的风险**。
5. **签名**：需 Apple Developer（$99/年）。TestFlight 内测 → App Store 审核（首次通常 1–3 天）。
6. **WKWebView 的 localStorage 可能被系统回收**（存储压力 / 系统升级）——存档必须迁移，见 §2.8。
7. `WKWebViewConfiguration.allowsInlineMediaPlayback` 无需改（我们不用 `<video>`）。

### 2.6 图标与启动页

现状：只有 `public/icon.svg`（512 B），**没有任何 PNG**。而 iOS App Store 强制要求 **1024×1024 无透明通道 PNG**，Android 需要各密度 mipmap + splash。

```bash
# 从现有 SVG 栅格化出 1024×1024，再一键生成全平台资产
npm i -D @capacitor/assets
# 准备：
#   resources/icon.png        1024×1024（无 alpha）
#   resources/splash.png      2732×2732（居中构图，四周留 20% 安全边）
npx capacitor-assets generate --iconBackgroundColor '#3a2a14' \
                             --splashBackgroundColor '#1b1f24'
```

省钱办法（**推荐**）：`--android` 只生成 `xhdpi/xxhdpi/xxxhdpi` 三档（跳过 ldpi/mdpi/hdpi），能砍掉约 40% 的资产体积；低密度设备由系统缩放，像素风图标缩放损失可接受。

**图标保持程序化观感**：把 `icon.svg` 里的像素城堡/旗帜纹样直接复用，别去做玻璃拟物图标——它和游戏内的像素美学必须一致。

### 2.7 包体预估（量化）

**依据**：`dist/` 实测 493 KB JS + 24 KB CSS；Capacitor 6 各平台运行时体积为公开量级（标注 **未验证**：未在本机实打包，数字为公开经验值）。

| 组成 | iOS (IPA) | Android (AAB 下载) |
|---|---|---|
| Web 资源（JS+CSS+HTML） | 0.52 MB | 0.52 MB |
| Capacitor JS bridge（tree-shaken 后） | ~0.03 MB | ~0.03 MB |
| 平台运行时（Capacitor + androidx/Swift 基线） | ~2.0 MB | ~1.5 MB |
| 图标 + 启动页 PNG（3 密度档） | ~1.5 MB | ~1.5 MB |
| 音频 / 图片资源 | **0** | **0** |
| **合计（未压缩）** | **≈ 4.0 MB** | **≈ 3.6 MB** |
| **应用商店实际下载** | **≈ 8–13 MB**（含签名/资源分档，**未验证**） | **≈ 4–7 MB**（**未验证**） |

结论要点：
- 上架后商店页显示的下载量级在 **< 15 MB**，对比同类商业手游（100 MB–2 GB）小两个数量级。**代价几乎全部来自原生壳与图标，业务代码只占 0.5 MB。**
- 16 MiB 图集 + 最多 9 MiB 地形烘焙**不占包体**，只占运行时内存——所以包体不是问题，**内存才是**（§4、§7）。
- 若要进一步压：把启动页从 2732² 降到 2048²、只出 xxhdpi 一档，可再省 ~1 MB。

### 2.8 原生壳改变了什么（三条行为差异，必须写进实现）

1. **Service Worker 不再生效**（iOS `capacitor://` 不支持；Android 虽支持但无必要）。离线能力改由**原生包内资源**提供，比 SW 更可靠。SW 代码保留给 Web 版，不可删。
2. **localStorage 不可靠**：iOS WKWebView 在存储压力 / 系统升级 / 长时间未使用后会回收 localStorage。存档（3–8 KB JSON）必须迁移到 **`@capacitor/preferences`**（底层是 `NSUserDefaults` / `SharedPreferences`，随 App 一起被备份）。策略：**写入时双写**（Preferences 权威 + localStorage 兜底），读取时 Preferences 优先。`src/save/persistence.ts` 已经把所有存储操作收口在 5 个函数里（`saveGame/loadGame/hasSave/clearSave/saveConfig/loadConfig`），**改造成本是替换这 6 个函数的实现，不动调用点**。
3. **AudioContext 生命周期**：Web 版靠 `visibilitychange` 的话现在没有；原生壳切后台时 WebView 会被挂起，AudioContext 可能被系统中断（iOS 会发 interruption）。`src/ui/sfx.ts` 目前只在 `state==='suspended'` 时 `resume()`（第 41 行），需要**导出 `suspendAudio()/resumeAudio()`** 由 App 生命周期钩子显式调用。

---

## 3. 触屏交互规格

> **⚠️ 本节是规格原稿（写作时的「要改成什么样」）。** 落地现状以**第 6 节「实现状态」列**为准：§3.1 指针模型、§3.2 双击居中、§3.3 长按（8px）与双击、§3.6 对接点**均已实现**（`a668e63`）；**唯一仍是设计**的是 **§3.5 手势状态机**（M-12）。§3.3 / §3.4 表里的「现状」列是**写作时**的现状，勿再当今日现状读。

### 3.1 指针模型统一（保留 `pointers` Map，只加字段）

现有模型是好的：`pointers: Map<pointerId, {x,y}>` + PointerEvent + `setPointerCapture`。PointerEvent 已经统一了鼠标/触摸/笔，**不要引入 TouchEvent，不要两套代码**。要补的是：

```
pointers: Map<number, { x: number; y: number; type: PointerType }>
lastPointerType: 'mouse' | 'touch' | 'pen' | null   // 新增，用于 gate 边缘滚屏 / hover
```

- `e.pointerType` 直接给出 `'mouse' | 'pen' | 'touch'`，零成本。
- **hover 语义只在 `lastPointerType === 'mouse' | 'pen'` 时启用**（`updateHover`、`pointerleave` 清 hover）。
- **边缘滚屏只在 `lastPointerType === 'mouse'` 时启用**。
- 触屏时 `mouseX/mouseY` 不再参与任何逻辑，`mouseIn` 变量改名为 `hoverActive` 以免误导。

### 3.2 镜头控制 —— 明确结论

| 方案 | 结论 | 理由 |
|---|---|---|
| 单指拖拽平移 | **保留** ✅ | 已有实现（`main.ts:822–836`），带惯性，手感好，全平台通用 |
| 双指捏合缩放 | **保留** ✅ | 已有实现（`main.ts:837–847`），锚点正确（中点为锚），保留 |
| 边缘滚屏 | **触屏废弃，仅鼠标保留** ❌→✅ | 触屏无悬停，"贴边"概念不成立；且当前条件在手机上不安全（§1）。实现上**不删 `Camera.edgeScroll`**（smoke 有 3 个测试打它），只在 `main.ts:1065` 的**调用点**加 `lastPointerType === 'mouse'` 守卫 |
| 双指拖拽平移 | **不做** ❌ | 与捏合在双指按下瞬间无法区分，会抢手势；收益低 |
| 虚拟摇杆 | **本轮不做** ❌ | 占用屏幕、破坏 HoMM 的全屏地图观感；单指拖已足够 |
| 双击居中 | **新增** ✅ | 这是边缘滚屏的**替代品**：手机上"远距离移动镜头"的正确解法是点位直达而非推边。双击任意已探索格 → 镜头平滑居中到该格 |

**结论一句话**：手机镜头 = **单指拖 + 双指捏合 + 双击居中**；鼠标 = 原有四件套（拖拽/滚轮/边缘滚屏/双击居中）。不再有第五种。

### 3.3 点击 / 长按 / 右键 / 双击 语义映射

| 手势 | 判定 | 语义 | 桌面等价 | 现状 |
|---|---|---|---|---|
| 轻点 tap | 按下→抬起 < 250 ms 且位移 < 10 px | 左键：选中英雄 / 移动 / 确认 / 关遮罩 | 左键 | 已有（`handleClick`），无需改 |
| 拖拽 drag | 位移 ≥ 10 px | 平移镜头 | 拖拽 | 已有 |
| 长按 long press | 持续 ≥ **420 ms** 且位移 < **8 px** | 右键：弹出信息框 + **触觉反馈** | 右键 | 时长已有（`main.ts:805` 是 420 ms），**位移阈值要从 4 px 放宽到 8 px**（手指抖动比鼠标大），并补 Haptics |
| 双击 double tap | 两次轻点间隔 < 300 ms 且落点间距 < 12 px | **镜头居中到该格** | 无（新增） | **新增** |
| 双指捏合 | 两指距离变化 | 缩放 | 滚轮 | 已有 |
| 双指轻点 | 两指同时起落 | 取消施法 / 关闭弹窗（= Esc） | Esc | **新增，P2** |
| 右键 / hover | — | 触屏不存在 | 右键 / 悬停 | 已有，按 `lastPointerType` gate |

长按 420 ms 的选择依据：低于 iOS 系统长按（≈500 ms）更跟手，高于误触阈值。DESIGN.md §七 写的 400 ms 与代码的 420 ms 不一致——**统一取 420 ms**，改文档而不是改代码（少动已测代码）。

补充约束（触屏特有，必须加）：
- `-webkit-touch-callout: none`（禁 iOS 长按弹出的链接预览/选择菜单）
- `user-select: none` + `-webkit-user-select: none`（禁长按选中文本）
- `overscroll-behavior: none`（禁橡皮筋回弹）
- `contextmenu` 已有 `preventDefault`（`main.ts:875`）——保留，鼠标右键仍需它

### 3.4 触控热区（具体 px）

| 目标类型 | 最小尺寸 | 现状 | 动作 |
|---|---|---|---|
| 主要操作按钮（结束一天 / 关闭 / 确认） | **48×48** | `min-height: 30–32 px` ❌ | **改** |
| 次要按钮 / 图标按钮 | **44×44** | 30–32 px ❌ | **改** |
| 相邻热区最小间距 | **8 px** | 未定义 | 改 |
| 顶部英雄头像条单项 | **48 宽 × 46 高** | 需核 | 改 |
| 地图格子 | 视觉 32 px，但**拾取以屏幕坐标反算，不做热区限制**（缩放后格子物理尺寸随机变化） | — | 无需改 |

手机横屏时顶部 46 px 的资源栏 + 底部状态条会被手指遮挡——建议横屏下把资源栏压到 **40 px**、底部条压到 **36 px**，把省下的高度给地图。

### 3.5 手势状态机（替代现有 `dragged` 布尔）

现有代码用 `dragged` / `lastPan` / `pinchDist` / `longPress` 四个散变量拼状态，触屏手势变多后会互相打架。建议收敛成显式状态机：

```
IDLE ──pointerdown──> PRESS(t=0, p0)
  PRESS ──move>10px──> DRAG          (pan + trackFling)
  PRESS ──t>420ms & <8px──> LONGSHOT (info + haptic, 吞掉后续 click)
  PRESS ──2nd pointerdown──> PINCH    (捏合，退出 PRESS)
  PRESS/DRAG ──pointerup──> IDLE
  IDLE  ──2nd tap <300ms──> DOUBLE_TAP (镜头居中)
```

收益：长按与拖拽、双击与单击、捏合与平移的互斥关系变成**状态转移**，不再靠时序判断散落各处。同时把「上次手势是否已被消费」显式化，避免长按之后又触发一次 `handleClick`（现有代码靠把 `dragged=true` 来"吞掉"点击，可读性差且脆）。

### 3.6 与现有代码的对接点（逐行）

| 文件:行 | 改动 |
|---|---|
| `main.ts:767` | `pointers` 值类型加 `type` 字段 |
| `main.ts:774` | `mouseIn` → `hoverActive`，另加 `lastPointerType` |
| `main.ts:789–810` | `pointerdown`：记录 `e.pointerType`；`pointers.size===1` 时启动 PRESS 状态与长按定时器（阈值改 8 px） |
| `main.ts:812–849` | `pointermove`：按状态机分派；`updateHover` 仅 mouse/pen |
| `main.ts:851–861` | `endPointer`：加双击判定（记录 `lastTapT/lastTapPos`） |
| `main.ts:1065` | **加 `lastPointerType === 'mouse'` 守卫**（P0） |
| `main.ts:1031–1050` | 键盘处理保留（蓝牙键盘/桌面壳仍可用），不动 |

> **行号与状态提示（2026-09-18 · 第二轮）**：本表原为设计稿，行号基于写作时源码，**已大幅位移，以实现代码为准**。已落地：`lastPointerType`（`main.ts:807` 声明、`:824`/`:849` 记录、`:1164` 处 gate 边缘滚屏；`Camera.edgeScroll` 保留未删）；**长按阈值 4→8 px**（`main.ts:864`）；**双击居中**（`endPointer`，`main.ts:891-920`，`isDoubleTap`）；**`updateHover` 的 mouse/pen gate**（`main.ts:888`，`shouldHover`）；**`orientationchange` 重排**（`main.ts:1118`）。**唯一仍是设计的**是 §3.5 的**手势状态机**（`dragged`/`lastPan`/`pinchDist`/`longPress` 散变量仍未收敛，**M-12**）——`pointers` 的 `type` 字段亦随 M-01 一并落地。

---

## 4. 性能预算与分档

### 4.1 单帧开销来源（基于代码事实的分解）

以 iPhone 14（390×844 CSS，DPR 3）为例，主画布 backing = **1170×2532 ≈ 2.96 Mpx**：

| 开销项 | 来源 | 每帧量级 | 备注 |
|---|---|---|---|
| 主画布清屏 | `MapRenderer:163` | 2.96 Mpx | 单色 fill |
| 地形层 drawImage | `MapRenderer:178` | 1 次整图 blit（2.96 Mpx 输出） | 烘焙后很便宜 |
| 光照三连 | `MapRenderer:380–417` | **3 × 2.96 ≈ 8.9 Mpx 混合填充** | multiply + overlay + radial；**最大单项**，且每帧 `createLinearGradient`/`createRadialGradient` 各一次（GC） |
| 水面逐格 + 高光 | `MapRenderer:185–205` | 可见水格 × 4 drawImage + 3 次 `sin()` | 视图上水量 |
| 迷雾/可达/暗格 | `MapRenderer:209–254` | 可见格 × 1–3 次 fillRect | O(可见格) |
| 物件/英雄 y 排序 | `MapRenderer:290–315` | 排序 + blit | 可见物件数级 |
| 夜晚城镇光晕 | `MapRenderer:321–333` | **每城镇 1 次 `createRadialGradient` + 全半径 fillRect** | 深夜才开 |
| 战斗场 | `BattleRenderer` | 631 行，独立画布 | 按需 |

**结论**：冒险地图的每帧成本大头是**光照三连**（≈8.9 Mpx 混合）和**整屏分辨率**（DPR 决定）。两者都随 DPR 平方增长——iPhone 14 的 2.96 Mpx 相比同机型 1× 渲染（0.33 Mpx）是 **9 倍**。

> **估算依据与未验证声明**：以上像素量为几何推算（CSS 尺寸 × DPR²），非实测。真实帧时间**未在真机测量**。要拿实测数字，用 §4.3 的微基准，或在原生壳里接 Chrome DevTools / Safari Web Inspector 采样。

### 4.2 分档表（具体数字）

> **⚠️ 本表是「设计意图」，不是落地值。** 已交付的档位映射以 **§4.5** 为准（由 `settingsForTier(tier)` 产出，`commit 9aba485`）。下表保留作论证与偏差对照；§4.5 明列了有意为之的偏差。

| 档位 | 典型设备 | 目标帧率 | 帧预算 | DPR 上限 | 光照 | 水面高光 | 城镇灯火 | 地图尺寸上限 | 其它 |
|---|---|---|---|---|---|---|---|---|---|
| **低端** | iPhone SE 2 / Snapdragon 4xx / 2GB RAM | **30 fps** | 33 ms | **1.5** | **只留 multiply 单次**，关 overlay 与暗角 | 关（水面静态帧） | 关 | **32×32** | 关网格线；英雄选中脉冲降到 2 Hz |
| **中端** | iPhone 11–13 / Snapdragon 6xx–7xx / 4GB | **60 fps** | 16.6 ms | **2** | multiply + 暗角，**关 overlay 暖光** | 开 | 开（半径 ×0.7） | **40×40** | 全效果 |
| **高端** | iPhone 14+ / M 系 iPad / 旗舰安卓 | **60 fps**（ProMotion 允许 120） | 16.6 / 8.3 ms | **3（原生）** | 全开 | 开 | 开 | **48×48** | 全效果 |

所有"关/降"项都必须是**运行时开关**，不是编译期分支——同一份包要能跑三档。

### 4.3 设备能力探测方法（可执行）

**静态线索**（快，但 iOS Safari/WKWebView 下 `deviceMemory` 为 `undefined`）：

```ts
const ua = navigator.userAgent;
const mem = (navigator as any).deviceMemory as number | undefined; // iOS 恒 undefined
const cores = navigator.hardwareConcurrency ?? 2;
const dpr = window.devicePixelRatio || 1;
const ios = /iPhone|iPad|iPod/.test(ua);
```

仅靠静态线索不可靠（iOS 拿不到内存），所以**主判据是启动期微基准**：

```ts
// 在真正的 MapRenderer.draw 上采样，避免测的是空转
async function probeTier(drawFn: () => void): Promise<'low' | 'mid' | 'high'> {
  const t: number[] = [];
  for (let i = 0; i < 30; i++) {
    const a = performance.now();
    drawFn();
    // 读回一个像素，强制 GPU 同步，否则测的是"提交时间"不是"渲染时间"
    drawFn.ctx.getImageData(0, 0, 1, 1);
    t.push(performance.now() - a);
  }
  t.sort((x, y) => x - y);
  const p95 = t[Math.floor(t.length * 0.95)];
  if (p95 > 20) return 'low';
  if (p95 > 12) return 'mid';
  return dpr >= 2 ? 'high' : 'mid';
}
```

- 采样 30 帧，取 **p95**（尾部延迟比均值更能反映卡顿体感）。
- **结果缓存进 localStorage**（key `homm.tier`），后续启动直接读，避免每次启动都白跑 30 帧；设置页给"重新检测"入口。
- **必须有用户手动覆盖**：设置页放「画质：自动 / 低 / 中 / 高」，默认自动。
- 探测期间（≈0.5 s）先按"中端"渲染，探测完再切换，避免先丑后美。

### 4.4 降级开关清单（实现成 `QualitySettings` 对象，渲染层只读）

```
lighting: 'off' | 'multiply' | 'full'
vignette: boolean
warmOverlay: boolean
waterGlint: boolean
townGlow: boolean
gridLines: boolean
dprCap: 1 | 1.5 | 2 | 3
maxMapSize: 32 | 40 | 48
hoverEffects: boolean        // 触屏恒 false
selectionPulseHz: 4 | 2
```

### 4.5 已实现的档位（authoritative · `src/render/quality.ts`）

> 下表是**代码里真实生效**的映射（由 `settingsForTier(tier)` 产出，`commit 9aba485`）。§4.2 的表格是设计意图；二者若有出入，**以本表为准**。渲染层只读 `quality` 单例，改档只能走 `applyTier` / `initQuality`。

| 字段 | 低端 low | 中端 mid | 高端 high |
|---|---|---|---|
| `lighting` | `'multiply'` | `'multiply'` | `'full'` |
| `vignette` | 关 | 开 | 开 |
| `warmOverlay` | 关 | 关 | 开 |
| `waterGlint` | 关 | 开 | 开 |
| `townGlow` | 关 | 开（半径 ×0.7） | 开 |
| `gridLines` | 关 | 开 | 开 |
| `dprCap` | **1.5** | **2** | **3** |
| `maxMapSize` | **32** | **40** | **48** |
| `selectionPulseHz` | 2 | 4 | 4 |
| `hoverEffects` | 关 | 关 | 关（由设备能力 `hoverCapable()` 决定，触屏恒关） |

**与 §4.2 的偏差（均为有意，需记录在案）**：

- **暖光强度改走 `globalAlpha`**：梯度固定按 `warm = 1` 建，实际强度用 `ctx.globalAlpha = tint.warm` 施加。观感与旧实现等价（`stopAlpha × warm` 与旧 `warm × stopAlpha` 数学相同），但梯度对象得以按视口尺寸**复用**，从而消除每帧 `createLinearGradient`——这是 M-03 去 GC 的手段。
- **中端城镇灯火半径 ×0.7**：照 §4.2 表实现，但这是**对现状（改动前）的一处可见变化**——改动前所有档位半径都取满值。**不是 no-op**，需美术/设计知悉。
- **低端 `selectionPulseHz: 2` 映射为「更慢的脉冲」**（脉冲正弦的周期除数 260 → 500 ms），而非字面「2 Hz」。字面 2 Hz 会变成高频闪烁，判断不是设计本意；若确需 2 Hz 请在设计上明示。
- **`lighting: 'off'` 态不被任何档位直接使用**：三态里的 `'off'` 与既有总开关 `lightingOn()`（`homm.lighting`，`src/render/lightLayer.ts`）叠加——总开关关掉即等效 `'off'`，两者都保留。
- **`maxMapSize` 是唯一能压住地形烘焙面的杠杆**：`TILE` 固定 32，**不能降采样**（会让烘焙面与格子网格错位），所以上限只能落在**地图尺寸**上，在开局处夹紧（`main.ts` 的 `startNewGame` + `ui/StartScreen.ts` 的尺寸选项过滤）。低端 32×32 的烘焙面恰好 `32×32×32²×4 = 4 MiB`。

**探测与持久化（对应 §4.3）**：`probeTier` 在**真实 `MapRenderer.draw`**（含光照）上采样 30 帧取 p95（`>20 ms → low`，`>12 ms → mid`，否则 `dpr ≥ 2 ? high : mid`），结果写入 `localStorage['homm.tier']`；`setMode('auto'|'low'|'mid'|'high')` 提供手动覆盖（key `homm.tierMode`）。**无 `getImageData`/无头环境一律 fail-safe 退回 `mid`、绝不抛**。探测期间默认按 `mid` 渲染，探测完成经 `onTierChange` 触发 `resize()`。

**已补的 smoke 单测（+48 项，全量 519 PASS / 0 FAIL）**：`settingsForTier` 三档映射、`classifyProbe` 边界、`probeTier` 的 fail-safe（sync/draw 抛错、时钟 NaN）、`clampMapSize`/`allowedMapSizes`、`shouldEdgeScroll` 真值表、`bakeBytes` 预算。

---

## 5. 安全区 / 横屏 / DPI / 后台暂停

### 5.1 安全区（刘海 / 灵动岛 / 挖孔 / 手势条）

> **⚠️ 已实现，但落地写法与本节的 `env()` 示例不同（2026-09-18）。** 代码里三处安全区都用
> **`var(--safe-area-inset-*, env(safe-area-inset-*, 0px))`**（`style.css` 的 `#app:63-66`、
> `#rotate-hint:775`、`#start-screen:1381-1384`）。原因：Capacitor 8 的 `SystemBars`
> （`insetsHandling:'css'`）会把 inset **注入成 CSS 变量**；本工程 targetSdk 36 = Android 15+，
> 裸 `env()` 在该 WebView 上会**静默取 0**。`env()` 仅作浏览器 / iOS 的兜底。下面 §5.1.2 的
> `env()` 片段是**原设计写法**，已被上述 `var()` 覆盖，勿照抄。

一套做法同时覆盖 iOS 与 Android（**这是最省事的方案**）：

1. `public/index.html` 的 viewport 改为：
   ```html
   <meta name="viewport"
         content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
   ```
   `viewport-fit=cover` 是 `env(safe-area-inset-*)` 返回非零值的**前提**。
2. `style.css` 的 `#app` 加四边内缩：
   ```css
   #app { padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
                  env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
   ```
   四边都要——横屏时刘海在左右，只处理上下是不够的。
3. 顶部资源栏 / 底部状态条高度改为 `calc(46px + env(safe-area-inset-top, 0px))` 形式，让背景铺满到屏幕边缘（视觉 edge-to-edge），但内容内缩。
4. `index.html` 的 `theme-color` 与 `capacitor.config` 的 `backgroundColor` 都与 `--stone-3` 一致，避免 inset 区域露出异色。

**未验证**：Android WebView 对 `env()` 的支持随 WebView 版本而异（Chrome ≥ 69 支持，需 `viewport-fit=cover`）。若目标机包含极老 WebView，退回方案是用 `@capacitor/status-bar` 的 `getInfo()` 拿到 inset 高度，注入 CSS 变量 `--sat/--sab/--sal/--sar` 覆盖 `env()`。

### 5.2 横屏方向锁定

| 设备 | 策略 | 理由 |
|---|---|---|
| 手机 | **锁横屏（sensorLandscape）** | 地图 + 264 px 右侧栏 + 战斗场 603×388 全是横向构图；390 px 竖屏放不下右侧英雄面板，且战斗场会被压成邮票 |
| 平板 | **两方向都允许** | 768×1024 竖屏仍能容纳；平板用户常竖持阅读 HUD |

实现：
- Android：`AndroidManifest.xml` 加 `android:screenOrientation="sensorLandscape"`。
- iOS：`Info.plist` 的 `UISupportedInterfaceOrientations` 只留 Landscape 两项；`~ipad` 变体留四项。
- 运行时兜底：`@capacitor/screen-orientation` 的 `lock('landscape')`，并在 `orientationchange` 时调 `renderer.resize()` + `camera.clamp()`（现有 `ResizeObserver`（`main.ts:1097`）已能覆盖大部分情况，但要确认旋转时 `clientWidth/Height` 更新后它会触发）。
- **竖屏兜底**：万一设备/系统强制竖屏（分屏、无障碍设置），给一条 CSS 提示"请横屏游玩"，而不是硬渲染一个压扁的界面。

### 5.3 DPI 分档

现状问题：`MapRenderer:95` 是 `Math.max(1, Math.round(devicePixelRatio))` —— **有下限无上限**，且 `Math.round` 会把 1.5 变成 2、2.75 变成 3，**无法实现 §4.2 的 DPR=1.5 档**。

改法：
```ts
// 保留小数 DPR，只做上限钳制；backing 尺寸取整，transform 用原值
const raw = window.devicePixelRatio || 1;
const dpr = Math.min(raw, quality.dprCap);          // 1 | 1.5 | 2 | 3
canvas.width  = Math.round(w * dpr);
canvas.height = Math.round(h * dpr);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);             // 用小数，不是取整后的
```
`camera.viewW/viewH` 继续存 CSS px（逻辑坐标），不变——所以**相机与拾取逻辑完全不需要改**，只是绘制分辨率变化。`BattleRenderer:76` 同理（它已支持小数倍缩放，只需套上 `dprCap`）。
`ResizeObserver`（`main.ts:1097`）与 `resize` 监听（`main.ts:1052`）都要在质档切换后重跑 `renderer.resize()`。

### 5.4 后台暂停（切后台 / 来电 / 锁屏）

需要新增一个 `Lifecycle` 模块，统一处理：

| 事件 | 动作 |
|---|---|
| `document.visibilitychange` → hidden | ① `paused = true`；② `cancelAnimationFrame(raf)`（**不是**让 rAF 空转）；③ `suspendAudio()`；④ **立即自动存档**（防 jetsam 杀进程丢进度） |
| 恢复 → visible | ① `last = performance.now()`（**先重置时间戳**，否则 `now-last` 是后台时长的巨大值；现有 `Math.min(60, …)`（`main.ts:1061`）虽能兜住 60 ms 上限，但会白白推进一帧逻辑，还是显式清零正确）；② `resumeAudio()`；③ 重新 `requestAnimationFrame(frame)` |
| `pagehide` / `freeze` | 同 hidden（iOS WKWebView 上 `visibilitychange` 偶有不触发，用 `pagehide` 兜底） |
| `@capacitor/app` 的 `appStateChange` | 原生壳里的权威信号（比 Web 事件可靠），`isActive=false` → 同 hidden |

音频：`src/ui/sfx.ts` 新增导出
```ts
export function suspendAudio(): void { if (ctx?.state === 'running') void ctx.suspend(); }
export function resumeAudio(): void  { if (ctx?.state === 'suspended') void ctx.resume(); }
```
并在 `ac()`（第 28–42 行）里**去掉自动 `resume()`**，改由生命周期显式驱动——否则后台被系统中断后，下一次发声会立刻把上下文拉起来（有些设备上会导致爆音）。

---

## 6. P0.1 与 P1 返工清单（可直接当任务列表）

共 **14 条**。格式：`ID · 优先级 · 改什么 · 为什么`。**每条都在"测试影响"列标明对 smoke / CDP 审计的影响**（smoke 基线变化：本文档写作时 471 项 → M-01~M-04 落地后 519 项 → M-01~M-11 落地后全量 **550 PASS / 0 FAIL**）。**「实现状态」列标明该条是已交付代码还是仍是设计**——这是 G-10 的同类整改项：勿让「设计」冒充「现状」。

> **打包 / 构建环境不在本表范围。** Capacitor 版本、SDK 级别、JDK、零打包器约束等（决定 M-05/M-06/M-13 与 M-10 原生侧能否真机跑通）以 **`docs/architecture/android-build-runbook.md`** 为准。2026-09-18 落地状态：**M-01~M-09、M-11、M-13 已实现**（M-10 仅 web 侧）；**M-12 / M-14 仍是设计**。

| ID | 级别 | 改什么（文件:行） | 为什么 | 测试影响 | 实现状态 |
|---|---|---|---|---|---|
| **M-01** | **P0** | `main.ts:1100`（原 1065）边缘滚屏调用加 `lastPointerType === 'mouse'` 守卫；`main.ts:780`（原 774）引入 `lastPointerType`。**不删 `Camera.edgeScroll`** | 手机抬手后 `mouseIn` 可能仍为 true → 镜头自爬；且触屏无"贴边"概念 | 无（smoke 直接调 `Camera.edgeScroll`，方法保留 → 3 项仍绿）；已补 `shouldEdgeScroll` 纯谓词单测 | ✅ **已实现**（9aba485） |
| **M-02** | **P0** | 地形烘焙内存治理：烘焙面 = `W × H × TILE² × 4` 字节，低端把**地图尺寸**夹到 32（=4 MiB，`main.ts` 的 `startNewGame` + `StartScreen.ts`）；`terrainLayer.bakeFringes` 改为**按边分块提交** | **已核实——原稿前提有误**：9 MiB 来自**烘焙画布本身**（巨型 1536² ≈ 9.0 MiB），**不是** `Path2D`。`beginPath()` 在 DIRS 循环内（`terrainLayer.ts:186`），单条路径最多 `FRINGE_DEPTH × TILE = 192` 个 `rect()`，不存在"近百万 rect 攒入一条路径"。fringe 分块是**锦上添花**（峰值有界、免去每边 `Path2D` 分配），**真正压内存的是地图尺寸夹紧**；`TILE` 固定 32 不能降采样（会使烘焙面与网格错位） | 无（smoke 不触渲染）；`audit:layout` 是**纯生成器审计**，不受渲染改动影响 | ✅ **已实现**（9aba485） |
| **M-03** | **P0** | 光照分档：`MapRenderer` 光照段按 `quality.lighting` 三态渲染；`createLinearGradient`/`createRadialGradient` **按尺寸缓存**（暖光改由 `globalAlpha` 承载强度，见 §4.5）；低端只留 multiply | 三遍全屏混合 ≈ 8.9 Mpx/帧（iPhone 14），是最大单项；每帧新建 gradient 产生 GC | 无（`lightTintAt` 纯函数不动 → 8 个光照测试仍绿） | ✅ **已实现**（9aba485） |
| **M-04** | **P0** | DPR 钳制：`MapRenderer.resize`（原 `:95`）、`BattleRenderer.fit`（原 `:76`）改为 `Math.min(dpr, quality.dprCap)` 且**保留小数**；质档切换后重跑 `resize()` | 现状无上限且 `Math.round` 吞掉 1.5 档；1× → 3× 是 9 倍像素量 | 无 | ✅ **已实现**（9aba485） |
| **M-05** | P1 | 生命周期：新增 `Lifecycle` 模块，接 `visibilitychange` / `pagehide` / Capacitor `appStateChange` → 停 rAF + suspend 音频 + **自动存档**；恢复时重置 `last` | `main.ts` 目前**完全没有**后台处理，切后台 rAF 空转耗电、音频不释放、被系统杀进程丢进度 | 无；需新增 CDP 测试项（无法用 smoke 覆盖） | ✅ **已实现**（模块 `49c2678`；接线 `be7d9c9`）——`src/app/lifecycle.ts`（`installLifecycle`）接 `visibilitychange`/`pagehide`/`freeze` + 原生 `appStateChange`；`main.ts:1277` 传入 `onPause`（`cancelAnimationFrame` + `saveGame`）/ `onResume`（**先重置 `last`** 再重启 rAF）。**⚠️ 未接入 `main.ts` 前是死代码** |
| **M-06** | P1 | `sfx.ts` 导出 `suspendAudio/resumeAudio`，`ac()` 去掉自动 resume（第 41 行） | 见 §5.4：后台被中断后自动 resume 可能爆音 | 无（smoke 不测音频） | ✅ **已实现**（`49c2678`）——`sfx.ts:34/43` 已导出 `suspendAudio`/`resumeAudio`，由 `lifecycle.ts` 在 pause/resume 时调用（音频 suspend/resume 职责归 Lifecycle 模块） |
| **M-07** | P1 | 安全区：`public/index.html` 加 `viewport-fit=cover`；`style.css` `#app` 加四边 `env()` padding；顶/底栏高度改 `calc(...)` | 刘海/灵动岛/挖孔/手势条遮挡 HUD | 无；`audit:layout` 是**纯生成器审计，不产截图、不做图像比对**（已实测 640 局全过）——**不存在"截图基线"**（原稿此处判断有误，已更正） | ✅ **已实现，并于 2026-09-18 在真机验证通过**（`a668e63`）——`index.html:7` 加 `viewport-fit=cover`；`style.css` 三处改 **`var(--safe-area-inset-*, env(...))`**（`#app:63-66` / `#rotate-hint:775` / `#start-screen:1381-1384`，理由见 §5.1 提示）。**真机证据（OPPO PMA110 / Android 16 / API 36 / DPR 3.0 / WebView 151）**：窗口 full-bleed `[0,0][2376,1080]`；截图**亮色（≈白）行数 0/1080**、左右白边 0px、底部空白 0px；状态栏 insets 实测 `statusBars [0,0][2376,120]`（40dp）、`navigationBars [0,1032][2376,1080]`（16dp）、`mandatorySystemGestures [0,984][2376,1080]`（32dp）；目视确认状态栏「浅色图标画在深色上」清晰可读、底部手势条压在深色背景上。**CSS 与 `viewport-fit=cover` 均无需改动。**
**⚠️ 判定陷阱（务必记住）**：同一份 APK 在**模拟器**（AVD `h3land`，`-no-window` + `swiftshader_indirect`）上曾出现**明显白带**（顶 74px / 底 63px / 左 136px，白色 rgb 250,250,250），**真机完全不复现** —— 那是**模拟器假阳性**。**系统栏 / 安全区 / edge-to-edge 一律以真机判定，模拟器截图不可用于此项。** 证据：`.workbuddy/artifacts/emu-evidence-android36.txt`（含模拟器与真机的对照记录） |
| **M-08** | P1 | 横屏锁定：Android manifest `sensorLandscape`；iOS `Info.plist` 手机只留 Landscape、iPad 留四向；加 `orientationchange` → `resize()+clamp()`；加竖屏提示兜底 | 竖屏放不下右侧面板与战斗场 | 无 | ✅ **已实现（web + Android 原生）**——**web 侧**（`a668e63`）：`main.ts:1118` `orientationchange` → 120ms 后 `renderer.resize()` + `camera.clamp()`（延迟一拍等可视尺寸稳定）；`index.html:18` 加 `#rotate-hint` 竖屏提示。**原生侧**：`AndroidManifest.xml:16` `android:screenOrientation="sensorLandscape"`。**iOS `Info.plist` 方向锁定本轮未做**（Android 优先，属后续） |
| **M-09** | P1 | 触控热区：`style.css` 全部按钮 `min-height` 30–32 → **44/48 px**；相邻间距 ≥8 px；横屏压顶/底栏高度 | 现状 30–32 px 低于移动下限，误触率高 | 无；`audit:layout` **无截图基线**（见 M-07 更正），原稿"需重拍基线"有误 | ✅ **已实现（分级方案）**（`a668e63` + 残余 `17e1b29`）——`.btn` **≥44px**、`.btn.primary` **≥48px**；**密集区**（`.hp-nav` 3px 间距、`.hp-tbtns`）不能扩命中区（一扩就压到邻格），故把 **真实 `min-height` 抬到 32px**（`.btn.tiny`）；**宽松区**用 **`.btn.tiny.tap::after` 垂直扩张命中区**至 ~44px（`style.css:659`）；`.spellbook .btn.tiny` 真 44px（`:1068`）。**由 `tools/tinytargetaudit.mjs`（`npm run audit:touch`）实测守卫**——用 `elementFromPoint` 量真实热区，非 `getBoundingClientRect` |
| **M-10** | P1 | 长按：位移阈值 `main.ts:825` 由 4 px → **8 px**；触发时接 `@capacitor/haptics`（`impact('light')`）；CSS 加 `-webkit-touch-callout:none` / `user-select:none` / `overscroll-behavior:none` | 手指抖动大于鼠标，4 px 太紧会误判成拖拽；缺 iOS 长按菜单抑制 | 无 | ◐ **部分实现（仅 web 侧）**（`a668e63`）——位移阈值 **4→8px**（`main.ts:864`，`Math.abs(dx)+Math.abs(dy) > 8`）+ CSS `-webkit-touch-callout/user-select:none`、`body{overscroll-behavior:none}` 已上；**`@capacitor/haptics` 未接线**（插件已装、`impact('light')` 未接 → 长按暂无原生触觉反馈） |
| **M-11** | P1 | 双击居中：`endPointer`（`main.ts:851–861`）记录 `lastTapT/lastTapPos`，判定双击 → `camera.centerOn()` 平滑版 | 边缘滚屏在手机上废弃后，缺少"远距离移动镜头"手段 | 无；建议新增 smoke 单测（纯逻辑可测） | ✅ **已实现**（`a668e63`）——`endPointer`（`main.ts:891-920`）记录 `lastTap`，`isDoubleTap`（<300ms / 落点 <12px）→ `camera.centerOn(g.x,g.y)`。**首击仍照常执行 `handleClick`**（选中/移动照旧，不加 300ms 单击延迟——刻意的即时反馈取舍）；已补 smoke `isDoubleTap` 单测（8 项） |
| **M-12** | P2 | 手势状态机重构：把 `dragged/lastPan/pinchDist/longPress` 收敛为显式状态机（§3.5） | 手势种类变多后散变量互相打架；长按"吞点击"靠 `dragged=true` 很脆 | 需补手势单测（把状态机抽成纯函数即可进 smoke） | ⬜ 未实现（设计） |
| **M-13** | P2 | 存档迁移：`persistence.ts` 6 个函数改双写 Preferences + localStorage | iOS WKWebView 会回收 localStorage → 丢档（Top3 风险 ③） | 无（函数签名不变）；需补"Preferences 不可用时回落"的单测 | ✅ **已实现**（模块 `49c2678`；接线 `be7d9c9`）——`persistence.ts` 6 个函数保持同步签名不变、内部**双写** Preferences（权威）+ localStorage（兜底），新增 `hydratePersistence()`/`preferencesAvailable()`；走原生注入的 `window.Capacitor` 全局（零打包器约束），Web 下自动退回 localStorage。**⚠️ `hydratePersistence()` 在 `main.ts:109` 先于 `loadGame()` 执行——接线前水合永不运行**，存档会一直被误判为空 |
| **M-14** | P2 | 图集瘦身：实测 `atlas.ts:751` 2048² 的**实际占用面积**，缩到能容纳的最小 2 的幂（预计可到 1024² 或 2048×1024，省 8–12 MiB）；`combatAtlas.ts:91` 同样 | 16 MiB 常驻内存，是低端机内存压力的主要来源之一 | 无（帧坐标由 Packer 动态计算） | ⬜ **未实现（设计）· 优先级已下调**——`A1 v2` 拍板"每族 ×4"后，实测占用：**冒险图集 17.0%**（2048²）、**战斗图集 33.6%**（1024×512）。多数面积是空槽而非碎片，**瘦身能省的空间较原估大幅缩小**，故降为低优先（详见 `design/art-bible/asset-spec.md`） |

### 6.1 建议实施顺序（按"解锁价值 / 风险"排）

1. **M-01**（一行守卫，立刻消除手机镜头自爬）→ 2. **M-04**（DPR 钳制，为所有性能档位铺路）→ 3. **M-03 + M-02**（光照与地形，两个最大开销）→ 4. **M-05 + M-06**（生命周期，省电 + 防丢档）→ 5. **M-07 + M-08 + M-09 + M-10 + M-11**（触屏体验成套上）→ 6. M-12/M-13/M-14（打磨）。

**M-01～M-04 是"手机能不能玩"的分水岭**——已于 `9aba485` 全部完成。

> **进度（2026-09-18 · 第二轮）**：上述第 1~5 步**已全部完成**——**M-01 / M-04 / M-03 / M-02（`9aba485`）→ M-05 / M-06 / M-13（模块 `49c2678` + 接线 `be7d9c9`）→ M-07 / M-08 / M-09 / M-11 及 M-10 的 web 侧（`a668e63`；M-09 残余 `17e1b29`）**。仅剩第 6 步的打磨项 **M-12（手势状态机）与 M-14（图集瘦身，优先级已下调）仍是设计**；M-10 的原生触觉 `@capacitor/haptics` 待接线。

---

## 7. Top 3 风险

### 风险 ①：Canvas2D `multiply` / `overlay` 在移动 WebView 掉出 GPU 快路径

**为什么最危险**：光照是每帧最大的单项开销（≈8.9 Mpx 混合 @ iPhone 14），而 `globalCompositeOperation` 的非 `source-over` 值在部分移动 WebView 上**不是 GPU 合成**，会退化成 CPU 逐像素混合——单这一项就能吃光 16.6 ms 预算，且**这是设备/WebView 版本相关的，模拟器测不出来**。

**缓解**：
1. §4.3 的启动微基准必须**包含光照**（在 `MapRenderer.draw` 上采样，而非裸画布）。
2. 低端档只留 multiply 单次；若实测连单次 multiply 都超标 → **把 tint 直接烘进地形层**（8-bit 精度足够）：以 30 s 为间隔重烘一次带色地形层，平摊到多帧完成，换掉每帧全屏混合。
3. 备选：把光照改成**一个覆盖 canvas 的 DOM 层**，用 CSS `mix-blend-mode: multiply` + 静态 `background`——CSS 混合通常走合成器，比 canvas 的 composite op 更可能命中 GPU。
4. 兜底：设置里提供「关闭光照」（`lightLayer.ts:102` 的 `setLightingOn` 已存在，接上 UI 即可）。

### 风险 ②：WebView 进程被内存告警杀掉（jetsam / lowmemorykiller）

**为什么危险**：常驻内存堆叠——图集 16 MiB + 战斗图集 2 MiB + 地形烘焙最多 9 MiB + 主画布（iPhone 14 2.96 Mpx ≈ 11.8 MiB，iPad 12.9" 5.6 Mpx ≈ 22 MiB）+ JS 堆。**在 2 GB 内存机型上玩巨型地图，总量轻松过 50 MiB 的 GPU-backed 面**。iOS WKWebView 历史上在 ~200–300 MB 会杀页面，但低端安卓 WebView 的阈值低得多，症状是**游戏"突然白屏重载"**——玩家会以为是我们崩了。

**缓解**：
1. **M-14（图集瘦身）+ M-02（地形分档）+ M-04（DPR 钳制）三条合起来能把常驻面砍掉一半以上**，这是最直接的解法。
2. 低端档锁 `maxMapSize=32`，从源头掐掉 9 MiB 烘焙。
3. 加内存看门狗：`performance.memory?.usedJSHeapSize`（Chrome/安卓可用，iOS 无）超阈值时主动降档并提示。
4. **`visibilitychange → hidden` 时立即存档**（M-05），保证即使被杀也不丢档。
5. 真机验证方法：Safari Web Inspector / Chrome DevTools 挂到原生壳的 WebView 上抓 Memory 时间线，跑满 48×48 地图 + 多城镇夜晚光照 5 分钟。

### 风险 ③：iOS 上 localStorage 被回收 → 玩家丢档

**为什么危险**：`persistence.ts` 的存档全在 localStorage（上限 5 MB）。WKWebView 在**存储压力、系统升级、长期未使用**三种情况下会清除 localStorage；原生壳里没有浏览器"站点数据"提示，玩家毫无感知。丢档是**最伤信任**的一类 bug，而且是静默的。

**缓解**：
1. **M-13**：迁移到 `@capacitor/preferences`（`NSUserDefaults`/`SharedPreferences`，随 App 备份），localStorage 作兜底，读取时 Preferences 优先。
2. 存档保留**最近 2 个槽位**（写新档前把旧档挪到 `.bak`），任一可读即可恢复。
3. 设置页加「导出存档 / 导入存档」（一个 JSON 文本框 / 分享文件），给玩家最后的自保手段。
4. Web 版同样受益（浏览器清数据也会丢），这套双写不引入平台分叉。

---

## 8. 未验证项与原开放问题（现均已拍板）

### 8.1 明确标注"未验证"

| 项 | 说明 |
|---|---|
| 真机帧时间 | 全文所有性能数字都是**几何推算**（像素量 × DPR²），**未在真机上测过一帧**。必须按 §4.3 建基准后再校准分档阈值 |
| `pointerleave` 在 pointer capture 下的真机触发时机 | 影响 M-01 的"是否真会自爬"，但**不影响修法**（按指针类型 gate 与事件顺序无关） |
| Podfile / Gradle 体积 | §2.7 的平台运行时体积是公开经验值，未在本机实打包 |
| `env(safe-area-inset-*)` 在老 Android WebView 可用性 | 若目标机含极老 WebView，需走 §5.1 的 CSS 变量兜底 |
| Capacitor 版本与插件兼容矩阵 | **已解决**：钉定 **Capacitor 8.5.2**（非 6），插件兼容矩阵见 `docs/architecture/android-build-runbook.md`（本文档 §2 的 Capacitor 6 描述已就地标注为过时） |
| App Store 4.2 审核尺度 | 是否会被判定为"网站套壳"只能提交后知道；缓解手段见 §2.5-4 |

**M-01~M-04 已落地，但以下子项仍只能真机验证（2026-09-18 补）**：

| 项 | 说明 |
|---|---|
| **探测真机行为与 20/12 ms 阈值** | `probeTier` 按 §4.3 采样 30 帧取 p95（`>20 → low`、`>12 → mid`），**阈值未在任何真机校准**；探测本身约耗时 0.5 s。真机上 p95 的实际分布未知 |
| **M-01~M-04 的真实帧时间收益** | 全部为几何推算 / 代码推理，**未在真机测量一帧**。需上 Capacitor 壳后用 Safari Web Inspector / Chrome DevTools 采样后校准分档阈值 |
| **风险 ①（`multiply`/`overlay` 是否掉出 GPU 快路径）** | ~~未验证~~ → **✅ 2026-09-18 真机实测：未掉出快路径。** 设备 OPPO PMA110 / Chrome 151。方法：在**真机 WebView 内**（CDP，`tools/devprobe.mjs`）对**按 DPR 缩放的真实画布 2376×1080** 跑全屏 `drawImage` 微基准。结果：`source-over` 0.309ms、**`multiply` 0.259ms（0.84×）**、`overlay` 0.241ms（0.78×）—— 三者**同量级**，若掉 CPU 光栅化应慢 1~2 个数量级。按本作"光照三遍全屏"折算 ≈ **0.78ms/帧 = 60fps 帧预算的 4.7%**。→ §7 的两条缓解（"把 tint 烘进地形层"、"改用 DOM `mix-blend-mode` 层"）**不必再做**；低端"只留 multiply 单次" + `lightingOn()` 总开关保留即可。⚠️ **测量陷阱（已踩）**：若 canvas 只开 CSS 尺寸（792×360）不乘 DPR，会**低估 5.83 倍**（同脚本只量到 0.053ms）；**顺带**：真机 WebView 报 `getImageData` 应设 `willReadFrequently`（仅影响读回路径，与合成无关） |
| **低端水面仍逐帧 blit 水格** | 低端只冻结了水面高光与 4 帧动画（`waterFrame = 0`），水面格仍每帧 `drawImage`；把水面烘进地形层**未做**，收益未量化 |
| **`BattleRenderer` 不响应"战斗中途切档"** | 每场战斗新建渲染器，只在 `fit()` 时读 `dprCap`；档位中途变化要等下一次 `resize()` 才生效（未订阅 `onTierChange`）。战斗内切档概率极低，暂不处理 |
| **加载"已在档的巨型存档"不受夹紧** | `maxMapSize` 只在 `startNewGame` 夹新开局；直接读一个巨型存档时烘焙面仍可能超预算，只打一条一次性 `console.warn`（`terrainLayer.ts`） |

**M-05~M-11、M-13 已落地，但以下子项仍只能真机验证（2026-09-18 第二轮补）**：

| 项 | 说明 |
|---|---|
| **M-07 安卓安全区注入路径** | ~~须真机验证~~ → **2026-09-18 已在真机（OPPO PMA110 / Android 16 / API 36）验证通过 ✅**。窗口 full-bleed `[0,0][2376,1080]`，截图白带 **0 行**，状态栏浅色图标画在深色上清晰可读，底部手势条压在深色背景上。**无需改动。** ⚠️ **但本项曾被模拟器误判**：同一 APK 在 AVD 上出现明显白带（顶 74 / 底 63 / 左 136 px），真机不复现 → **系统栏类问题一律以真机为准** |
| **M-05 `appStateChange` 真机行为** | `lifecycle.ts` 走原生注入的 `window.Capacitor` 全局（零打包器约束，无法 `import '@capacitor/app'`）。`@capacitor/app` 是否在真机上注册并派发 `appStateChange`、pause/resume 时序是否正确，**未在真机验证**；Web 侧 `visibilitychange`/`pagehide` 已按标准事件实现 |
| **M-13 Preferences 双写真机行为** | Web 下自动退回 localStorage（功能不变）；**原生 Preferences 的读写、`hydratePersistence()` 的回灌时序未真机验证**（原因已不是"无工具链"——该卡点随 **G-11 闭环**解除，APK 已产出；现在唯一缺口是**无真机 / 无设备**，见 **G-12**） |
| **M-10 原生触觉** | **未接线**可言验证——`@capacitor/haptics` 已装但 `impact('light')` 尚未接入长按回调 |
| **M-09 真机热区** | 由 `npm run audit:touch` 用无头 Chrome 的 `elementFromPoint` 量真实热区（非模拟）；**触屏真机的手指命中感未验证**（无头鼠标指针 ≠ 手指） |
| **双击 / 长按阈值** | `DOUBLE_TAP_MAX_MS=300` / `DOUBLE_TAP_MAX_DIST=12`、长按 `>8px` 位移阈值**均为代码推定值，未在真机手感校准**（登记为 device-tunable 参数） |

### 8.2 原 3 个开放问题 —— **已全部拍板**

本节的三个问题在 2026-09-18 均已闭环，**不再是开放项**：

| # | 问题 | 结论 |
|---|---|---|
| 1 | **上架范围**：只做 Android，还是 iOS + Android 同时上？ | ✅ **已拍板 D-15：先 Android 内测 APK**。理由保留：本方案最大未知量是移动 WebView 性能，先用门槛最低的渠道验证；iOS 侧另有 $99/年 + Guideline 4.2（纯套壳被拒）风险，见 `adr-mobile-first.md` §4.2 |
| 2 | **应用标识与签名归属**：`appId`、Apple 账号、Android keystore 归谁？ | ◐ **appId 已拍板 D-16**：~~`com.yourorg.herosong`（首稿示意值）、`com.lichao.heroesong`（占位）~~ → **`com.a2studio.thecodeofchivalry`**，显示名 **《骑士信条》**。**keystore 仍未生成**——须用户自行生成并**离线备份**，丢失即**永久失去更新权**（步骤见 `android-build-runbook.md` §6.1）。`appId` 一旦上架即为不可更改的包身份，故必须在**首次发布前**落定 |
| 3 | **是否接受"包壳"带来的依赖**？ | ✅ **已接受（D-12/D-15）**：Capacitor 全家桶打破"零运行时依赖"纯度，成本与理由见 `adr-mobile-first.md` §代价 |

---

## 附：本轮核实过的关键数字一览

| 事实 | 值 | 来源 |
|---|---|---|
| 单格尺寸 | TILE = 32 px | `render/atlas.ts:11` |
| 地图尺寸档 | 24/32/40/48，**默认 32×32** | `core/types.ts:52–59`、`data/factions.ts:86` |
| 地形烘焙面 | W×H×32² ×4 B：中型 4.0 MiB / 巨型 **9.0 MiB** | `terrainLayer.ts:62–69` |
| 冒险图集 | **2048×2048 ≈ 16 MiB**（team-lead 给的 1024 有误） | `atlas.ts:751` |
| 战斗图集 | 1024×512 ≈ 2 MiB | `combatAtlas.ts:91` |
| 主画布（iPhone 14 横屏 844×390 @DPR3） | 2532×1170 ≈ **11.8 MiB** | `MapRenderer.ts:94–104` |
| dist 体积 | JS 493,496 B（gzip 139,677）/ CSS gzip 5,612 / 图片音频 **0** | 实测 `du`+`gzip` |
| smoke 测试 | **471 PASS / 0 FAIL**（实测跑过一次） | `npm run smoke` |
| 长按阈值 | 代码 420 ms / DESIGN 写 400 ms（不一致，统一 420） | `main.ts:805`、`DESIGN.md:451` |
| 隐藏的测试断点 | `max-width: 860 / 900 / 720`，无 `env()` 无 `dvh` | `style.css` |
| 后台处理 | `main.ts` 无 `visibilitychange/pagehide/blur` | grep 无匹配 |
