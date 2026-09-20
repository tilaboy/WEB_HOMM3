# iOS 迁移计划（Capacitor 包壳 · 差距分析 · 分阶段）

- **状态**：计划（待用户批准）
- **日期**：本轮
- **作者**：程基岩（技术方向 / 引擎）
- **相关**：`adr-mobile-first.md`（ADR-001，决策源）、`mobile-platform.md`（移动端规格）、`android-build-runbook.md`（Android 已落地方案）
- **性质**：**纯规划文档，不动任何 `src/` 业务代码**；本轮**未执行** `cap add ios`（那会往仓库塞一整个原生工程，需用户点头）。

---

## 0. 结论摘要（先看这段）

**判断：有条件建议 —— 现在就做"不阻塞的准备工作"，把真正的 iOS 投入推迟到"可玩性过关"之后。**

**为什么可以推迟，而不必现在就补 iOS：**

- iOS **早就在架构决策里**（`adr-mobile-first.md:46`：Capacitor → iOS/Android 双端）。本轮不是"要不要支持 iOS"的重新决策，只是**补齐 iOS 那一半的实现**。
- **代码侧已经对 iOS 友好**：`src/` **零平台分支** —— 本轮核实：`getPlatform` / `isNativePlatform` **命中 0 处**，且**没有任何 `import '@capacitor/*'`**；唯一的两处原生触点（`lifecycle.ts:54`、`persistence.ts` 读注入的全局 `globalThis.Capacitor`）本身就是**同一份代码在 iOS/Android 上走同一路径**（`window.Capacitor` 不存在时自动退回 Web 行为，`lifecycle.ts:51`）。安全区、横屏、存档、生命周期四条**全部写成平台无关形式**。⇒ iOS 的边际成本**几乎全在"工具链 + 原生工程配置"**，而这些**只有 Mac 能做、且完全不阻塞 Android/Web 线**。
- **真正的未知量是"可玩性/性能是否过关"**：`adr-mobile-first.md §6` 明写——帧率与内存**全部是几何推算、未真机测过**。在可玩性未定稿前投 iOS，等于**为一个可能被推翻的前提付不可逆成本**（$99/年 + 审核不确定性）。

**一句话：把 iOS 的"不阻塞钉子"现在钉死，把"要花 Mac / 花钱 / 过审核"的部分整体后置。**

---

## 1. 差距清单（gap list）—— 命令级

> 目标：把"当前仓库"推到"能产出一个可装进 iPhone 的包"。
> 现状基线（本轮核实）：`package.json` 只有 `@capacitor/{android,core,app,haptics,preferences}`；`homm-web/ios/` **不存在**。

### 1.1 依赖缺口

| 缺 | 现状 | 补什么（命令级） | 何时 |
|---|---|---|---|
| `@capacitor/ios` | 未装 | `npm i @capacitor/ios@^8`（与 core 8.5.2 同大版本对齐） | Phase 1（需 Mac 才能继续） |
| `@capacitor/screen-orientation` | 未装 | `npm i @capacitor/screen-orientation@^8` | Phase 1（**可选**，见 §1.6） |
| `@capacitor/status-bar` | 未装 | **不装** | —（见 §1.6，ADR 该条已过时） |
| `@capacitor/assets` | ✅ 已装（`node_modules/@capacitor/assets`） | 无需补 | — |
| `@capacitor/{app,haptics,preferences}` | ✅ 已装 | 三者在 iOS 均有对应实现 | — |

### 1.2 原生工程缺口

| 缺 | 补什么（命令级） | 何时 |
|---|---|---|
| `ios/` 目录（整个 Xcode 工程） | `npx cap add ios` → 生成 `ios/App/{App.xcodeproj, App/Info.plist, Podfile}` | Phase 1（需 Mac + Xcode） |
| 把 `dist/` 与插件同步进原生工程 | `npm run build && npx cap sync ios`（会跑 `pod install`） | Phase 1 |
| Xcode 15+ / CocoaPods | `xcode-select --install`；`brew install cocoapods` | Phase 1（**必须在 macOS**） |

### 1.3 `Info.plist` 配置缺口（**手改项，`cap sync` 可能覆盖 —— 必须集中记录**）

文件：`ios/App/App/Info.plist`（由 `cap add ios` 生成）。

| 键 | 值 | 为什么 |
|---|---|---|
| `UISupportedInterfaceOrientations` | `[UIInterfaceOrientationLandscapeLeft, UIInterfaceOrientationLandscapeRight]` | iPhone 锁横屏。对应 Android 的 `AndroidManifest.xml:16` `sensorLandscape`（规格 §2.5-2 / §5.2） |
| `UISupportedInterfaceOrientations~ipad` | 四项全留 | iPad 横竖都可玩（规格 §5.2 平板策略：`~ipad` 保留四方向） |
| `UIStatusBarHidden` | `true` | 全屏 edge-to-edge（规格 §2.5-3） |
| `UIViewControllerBasedStatusBarAppearance` | `false` | 同上 |
| `ITSAppUsesNonExemptEncryption` | `false` | 免去每次提审的出口合规问卷（本作不使用加密） |
| `CFBundleIdentifier` | `com.a2studio.thecodeofchivalry` | = `capacitor.config.ts:18` 的 `appId`（D-16 已定，**上架后不可改**） |

> ⚠️ **一致性要求**：`cap sync` 会重写 plist 中 Capacitor 自己管理的键，但**上述手改键默认可保留**（Capacitor 只在首次生成时写入）。真正的风险点是**重跑 `cap add ios`**（会覆盖）或升级 Capacitor。缓解：把这些键记录在**一处**（本表 + §2 的 Phase 1-5），并在 `mobile-platform.md §2.5` 与本文之间只保留**一个权威副本**（本文）。

### 1.4 资产缺口

| 缺 | 现状（本轮核实尺寸） | 补什么 | 何时 |
|---|---|---|---|
| iOS 图标（1024×1024 **无 alpha** PNG） | `resources/icon-background.png` 已是 1024² **无 alpha**；但 `icon-only.png` / `icon-foreground.png` **有 alpha**；**无 `resources/icon.png`** | 见下方 knowledge-gap | Phase 0（**可现在就做**） |
| iOS 启动页 | `resources/splash.png` 2732²（**有 alpha**） | 由 `capacitor-assets generate --ios` 消费 | Phase 1 |
| 生成命令 | `assets:mobile` 脚本当前只带 `--android` | 加 `--ios`：`npx capacitor-assets generate --ios --assetPath resources` | Phase 1 |

> **knowledge-gap（需在 Mac 上核实）**：`@capacitor/assets` 对 iOS 的图标输入约定，是接受 `icon-background.png + icon-foreground.png + icon-only.png` 三件套、还是要求单一 `resources/icon.png`（无 alpha）。App Store **硬性要求 1024×1024 无透明通道**。`tools/mobile-assets.mjs:11` 的注释已预告"iOS 日后要 1024×1024 无 alpha"，但**产出物里没有这个文件**。
> **Phase 0 的最小动作**：补一个 `resources/icon.png`（1024² 无 alpha，由现有 emblem 合成）——无论 `capacitor-assets` 走哪条约定都能用。

### 1.5 签名 / 账号缺口（**上架前才需要**）

| 缺 | 说明 | 何时 |
|---|---|---|
| Apple Developer Program | **$99/年**（个人 / 公司） | Phase 2 |
| App Store Connect app 记录 | bundle id = `com.a2studio.thecodeofchivalry` | Phase 2 |
| 签名证书 + Provisioning Profile | 由 Xcode 自动管理（免费 Apple ID 可上真机，7 天有效） | Phase 1（真机）/ Phase 2（分发） |
| Privacy Manifest（`PrivacyInfo.xcprivacy`） | iOS 17 起的隐私清单要求 | Phase 2 |

### 1.6 与 ADR 计划的偏差（**必须更正，否则照抄会多装一个包**）

`adr-mobile-first.md:49` 列的插件清单是 `app / preferences / haptics / status-bar / screen-orientation`。**Android 的落地经验已证明这条清单要修正两处**：

| 插件 | ADR 说 | 实际结论 | 依据 |
|---|---|---|---|
| `@capacitor/status-bar` | 要装 | **不装** | Android 15+ 强制 edge-to-edge，旧 status-bar 的 `overlaysWebView/backgroundColor` 在 API 35+ 已失效；改用**内置于 core 的 `SystemBars`**（`capacitor.config.ts:54-57`）。iOS 侧状态栏走 `Info.plist`（§1.3），也不需要该插件。 |
| `@capacitor/screen-orientation` | 要装 | **可选**（Phase 1 再定） | 方向锁主路径是**原生配置**（Android manifest / iOS `Info.plist`）；运行时 `lock('landscape')` 只是"万一被系统强制旋转"的兜底（规格 §5.2）。当前 `capacitor.config.ts:43-46` 的 `ScreenOrientation` 块**是死的**（插件没装），其注释已写明"保留以便后续补装时零改动生效"。 |

> **净结论**：iOS 真正要补的依赖只有 **`@capacitor/ios`**（+ 可选的 `screen-orientation`）；ADR 里的 `status-bar` 是历史遗留，别装。
>
> **另注（好消息）**：`capacitor.config.ts:34-40` 的 `ios:` 块**已经写好了**（`contentInset:'never'`、`preferredContentMode:'mobile'`、`backgroundColor`）——**配置侧已 iOS-ready**，只差原生工程。`preferredContentMode:'mobile'` 尤其关键：iOS 默认可能按桌面宽度渲染，会让 `max-width` 断点全部失效、直接显示桌面三栏布局（规格 §2.3）。

---

## 2. 分阶段计划 + 每阶段验收

### Phase 0 —— 现在做（不阻塞、零风险、Web/Android 也受益）

| # | 动作 | 产出 | 验收 |
|---|---|---|---|
| P0-1 | 固化 iOS 手改项清单到**单一事实源**（本文件 §1.3 / §2 Phase 1） | 本文档 | 文档存在；`mobile-platform.md §2.5` 指向本文 |
| P0-2 | 补 `resources/icon.png`（1024² 无 alpha，由 `mobile-assets.mjs` 的 emblem 合成） | 新源资产 | `sips -g hasAlpha resources/icon.png` = no；1024×1024 |
| P0-3 | 写入约定：**"新代码不得引入 `getPlatform()` / `isNativePlatform()` 分支"**（现状已满足，只是没人写下来） | 一行约定（挂本文 / `CLAUDE.md`） | `grep -rnE 'getPlatform\|isNativePlatform' src/` = 0；且无 `import '@capacitor/*'` |
| P0-4 | 确认 `appId` 已定稿（D-16） | — | `capacitor.config.ts:18` = `com.a2studio.thecodeofchivalry` |

> Phase 0 **不需要 Mac、不需要花钱、不碰 `src/`**。四件事做完，iOS 的"可逆准备"就满了。

### Phase 1 —— iOS 能装到 iPhone（需 Mac + Xcode，一次性 ≈ 半天）

```bash
# P1-1 工具链（macOS）
xcode-select --install                 # 或装 Xcode 15+
brew install cocoapods

# P1-2 依赖（在 homm-web/）
npm i @capacitor/ios@^8
# 可选：npm i @capacitor/screen-orientation@^8

# P1-3 生成原生工程（⚠️ 会往仓库塞 ios/，需用户点头后执行）
npx cap add ios

# P1-4 同步 dist + 插件（会跑 pod install）
npm run build && npx cap sync ios

# P1-5 改 ios/App/App/Info.plist（见 §1.3 六项）
# P1-6 生成图标 / 启动页
npx capacitor-assets generate --ios --assetPath resources

# P1-7 跑真机
npx cap open ios    # Xcode → 选 Signing Team → Run 到 iPhone
```

**Phase 1 验收（全部在 **真机 iPhone** 上做）：**

1. 冷启动进游戏、**横屏**，旋转设备被锁在横屏（左右翻转允许）；
2. **安全区**：刘海 / 灵动岛侧、Home 指示条侧 HUD 不被遮挡（`env(safe-area-inset-*)` 在 WKWebView **返回非零**）；
3. **音效**：点击有音效；**拨硬件静音键**后行为符合预期（见 §3 风险 1）；
4. **存档**：玩一局 → 杀进程 → 重开，进度还在（Preferences 双写生效）；
5. **后台**：切后台 / 锁屏 → 回前台，不闪退、不跳帧、进度在（`lifecycle.ts` 生效）；
6. **性能**：冒险地图 + 战斗各跑 1 分钟，用 Safari Web Inspector 记帧时间与内存。

> **免费 Apple ID** 即可做 P1-7（真机 7 天有效）；**不必**等到花钱才验证。

### Phase 2 —— iOS 可上架（需 $99 账号 + 审核，数天）

| # | 动作 | 验收 |
|---|---|---|
| P2-1 | 注册 Apple Developer；App Store Connect 建 app（bundle id = appId） | app 记录存在 |
| P2-2 | 补 `PrivacyInfo.xcprivacy` + App 隐私标签 | 提审前无隐私阻塞 |
| P2-3 | 截图 / 元数据 / 年龄分级 / 上架文案 | 素材齐 |
| P2-4 | **主动写 4.2 论证**（离线可玩 + 原生能力 + 非内容站，见 §3 风险 12） | 提审说明含该段 |
| P2-5 | TestFlight 内测 → 提交审核 | TestFlight 可装；拿到"通过"或**具体**驳回理由 |

### Phase 3 —— CI（可选，最后）

见 §4。**建议现在不上。**

---

## 3. iOS 风险表

> 每条：**风险 → 代码触点（文件:行）→ 真机验证方法 → 缓解**。
> ⚠️ 本表所有"真机验证"均在 **iPhone**（**非模拟器**）上做 —— 依据是 M-07 的教训：**系统栏 / 安全区类问题模拟器会假阳性，一律以真机为准**（`mobile-platform.md §8.1`）。

| # | 风险 | 代码触点（文件:行） | 真机验证方法 | 缓解 |
|---|---|---|---|---|
| 1 | **硬件静音键让整局无声**。iOS 上 WebAudio 默认走 "ambient" 音频类别，**随硬件静音键静音**；Android 无此语义 | `src/ui/sfx.ts:12,47-63`（`ac()` 懒创建 `AudioContext`） | 真机拨静音键 → 点按钮 | 二选一：(a) **接受**"随静音键"（多数玩家能理解）；(b) 想"忽略静音键"，需把 audio session category 设为 `.playback` —— Capacitor 默认**可能不暴露**，或需一个小原生插件。**建议先按 (a) 上线**，除非用户明确要 (b) |
| 2 | **音频中断后不自动恢复**。iOS 来电 / 闹钟会 `interrupt` AudioContext，state 长期停在 suspended，且**不会**自动 resume | `sfx.ts:34-45`（`suspend/resumeAudio`）、`ac()` 的 `unlocked` 只推一次（`sfx.ts:58-61`）；`src/app/lifecycle.ts`（调用方） | 真机：播放中来电 → 挂断回前台 → 听是否有声 | 已有 lifecycle 显式 `resumeAudio()`（M-06，`sfx.ts:43`）。**可能还需**在 `sfx.ts` 加 `ctx.onstatechange` → 若 `suspended` 且已解锁则重试 `resume()`（低成本，**建议 Phase 1 加**） |
| 3 | **旧 iOS 无无前缀 `AudioContext`** | `sfx.ts:48` `if (typeof AudioContext === 'undefined') return null;` | —（可静态判断） | 现代 iOS（Safari 14.1+）已支持无前缀。若要兜底极旧 iOS：加 `window.webkitAudioContext` 兜底（1 行，低风险，可选） |
| 4 | **横屏锁在 iOS 未实现**（ADR §4.2 已列，当前只装了 Android 一半） | `AndroidManifest.xml:16`（Android 侧已做）/ `capacitor.config.ts:43-46`（**死的**）/ `main.ts:1465`（`orientationchange`→resize 已做） | 真机旋转设备 | Phase 1-5 改 `Info.plist`（§1.3）。运行时兜底 `lock('landscape')` 需装 `screen-orientation`（可选） |
| 5 | **安全区在 iOS 横屏的分布不同**。iPhone 横屏时刘海在**左右**，`top/bottom` 可能为 0；业务代码用 `var(--safe-area-inset-*, env(...))`，**iOS 上无注入变量 → 落到 `env()`** | `src/style.css:78-90`（`#app` 四边）、`:746-749`、`:1178`、`:1781-1785`；`public/index.html:6-8`（`viewport-fit=cover` 已具备） | 真机 iPhone 横屏：HUD 不被刘海 / Home 条遮挡；`getComputedStyle` 读 `env()` 是否非零 | 写法已正确（四边 + `var→env` 兜底）。**唯一要验**：WKWebView 在 `viewport-fit=cover` 下 `env()` 返回非零（若返回 0，退回注入变量路径） |
| 6 | **Canvas2D 合成路径不同**。Android 实测的 `multiply/overlay` GPU 快路径（`mobile-platform.md §8.1`：0.78 ms/帧）**不保证**在 WKWebView 复现 | `render/MapRenderer` 光照段 / `render/quality.ts`（分档） | 真机 Safari Web Inspector 采样光照帧时间 | 已有分档降级（M-03 / 规格 §4.4）+ 光照总开关；若超标 → 规格 §7 风险①的两条后备（把 tint 烘进地形层 / 用 DOM `mix-blend-mode` 层） |
| 7 | **内存 jetsam**。WKWebView ≈ 200–300 MB 杀页面；症状是"突然白屏重载" | 图集 / 地形烘焙 / 主画布（`mobile-platform.md §7 风险②`） | 真机跑 48×48 图 + 多城镇夜晚光照 5 分钟，记 Memory 时间线 | 已有 M-02（地图尺寸夹紧）+ M-04（DPR 钳制）；M-14（图集瘦身）已降优先。**hidden 即时存档**（M-05）保证被杀不丢档 |
| 8 | **localStorage 被回收 → 丢档** | `src/save/persistence.ts:12`（双写桥注释段）；`main.ts:55`（import）+ `main.ts:456`（`await hydratePersistence()`） | 真机：写入 → 杀进程 → 重开能否读到 | 已实现 M-13（Preferences 权威 + localStorage 兜底，走原生注入的 `window.Capacitor`）。**唯一要验**：`hydratePersistence()` 确实**先于** `loadGame()` 跑（否则原生存档被误判为空） |
| 9 | **触觉反馈未接线**。`@capacitor/haptics` 已装但 `impact('light')` 未接（M-10 仅 web 侧完成） | **无触点**（未接）；接线点应在**长按回调**（`main.ts` 长按分支）与按钮点击 | 接线后真机长按 | Phase 1 顺手接 `impact('light')`。iOS 注意：**Taptic Engine 仅部分机型**，无 Taptic 的设备静默降级（不报错） |
| 10 | **Preferences 存储上限 / 清理** | `persistence.ts`（双写实现） | — | 存档 3–8 KB JSON；`NSUserDefaults` 无小尺寸硬限，**无风险**，记录备查 |
| 11 | **切后台可能直接 terminate（而非 background）** | `src/app/lifecycle.ts:8-16`（四路信号源）、`:25-30`（onPause/onResume） | 真机：切后台 / 锁屏 / 切到别的 app → 回来 | 已有 `visibilitychange` / `pagehide` / `freeze` + 原生 `appStateChange` 四路信号；`pagehide` 就是为 iOS 偶发不触发而备（`lifecycle.ts:13`）。**hidden 即时存档**是关键防线 |
| 12 | **App Store 4.2「纯套壳」被拒**（**非技术**，但最需要经营） | — | 只能提交后知道 | 提审说明主动论证三点：**完全离线可玩** + **运行时原生能力**（触觉 / 方向锁 / 安全区）+ **非网页内容形态**（程序化像素游戏）。依据 `adr-mobile-first.md §4.2-2` / `mobile-platform.md §2.5-4` |

---

## 4. CI / 构建成本：是否值得现在就上？

| 项 | 事实 | 取舍 |
|---|---|---|
| macOS runner | iOS 构建**只能**在 macOS 上做（Xcode）；GitHub Actions `macos-*` runner 分钟单价约为 Linux 的 **10×**，且 macOS 分钟有免费额度上限 | 成本可控但**非零** |
| 代码签名 | CI 出分发包的真正难点是**证书 / Provisioning Profile 的托管**（标准解：`fastlane match` + 加密仓库）、证书轮换、年费续期 | **这是主要复杂度来源**，不是编译本身 |
| 构建频率 | "可玩性未定稿"阶段的 iOS 构建频率**极低**（甚至为 0）；热修走 Web 灰度（ADR §4.2-7） | 现上 CI = **为低频操作养一套高维护基础设施** |

**判断：现在不上 CI。**

- 理由：iOS 构建在早期是**一次性 / 偶发**的，手动 `npx cap open ios` + Xcode **直接覆盖需求**；TestFlight 上传也在 Xcode 内一键完成。CI 的价值在"高频、可复现、可审计"，而**签名密钥托管的负债**在"还没决定要不要发 iOS"之前纯属净增。
- **何时上**：当满足 ①能稳定产出 Release build、②提审 / 发版频率 **> 每周一次**、③至少一台非作者机器需要出包 —— 三条里中两条时，再上 CI（届时引入 `fastlane match`）。

---

## 5. 明确建议：现在做多少、什么时候做

用户原话是"如果可玩性还可以，也希望能在 iOS 上发布" —— 这句话天然给出了**分界线**：

### ✅ 现在做（不阻塞、不花钱、不碰 `src/`）

1. **Phase 0 四件**：手改清单固化 / 补 `resources/icon.png`（1024² 无 alpha）/ 写死"零平台分支"约定 / 确认 appId。
2. **把本文档作为 iOS 的单一事实源**，并在 roadmap 上挂一条"iOS 迁移（未启动）"，避免它又变成"没人记得为什么"的历史记录。
3. **继续在 Web / Android 上验证可玩性**（这才是当前唯一真正的未知量）。

### ⏸ 可玩性过关后再做（触发条件明确）

**触发条件（"可玩性过关"的可判定定义）**：真机 Android 内测的**帧率 / 手感 / 内存**达标 —— 即 `adr-mobile-first.md §5` 的 revisit trigger **不触发**（中端安卓冒险地图稳定 ≥45 fps，且降级手段未全用尽）。

触发后 → 执行 **Phase 1（半天）→ Phase 2（数天）**。

### 🚫 上架前才需要

$99 账号、Privacy Manifest、截图 / 元数据、4.2 论证、TestFlight / 提审（Phase 2）。

> **一个反直觉但重要的点**：iOS 的**最大不确定项不是技术，是审核（4.2）**。技术侧我们已经有约 80%（零平台分支 + 四条平台无关能力）；审核侧**只有提交才知道**。所以 iOS 的"风险敞口"集中在**最后一跳** —— 这进一步支持"把投入后置到可玩性确认之后"，而不是现在就把 $99 和审核时间投进去。

---

## 6. 诚实声明（知识缺口 / 未验证项）

- **本文件所有 iOS 命令均未实测**：本机无 macOS、未装 `@capacitor/ios`、`ios/` 不存在。§1 / §2 的命令是按 Capacitor 通用流程写的，**未在 Xcode 上跑通**。
- **Capacitor 8 的 iOS 侧具体行为未核实**：`@capacitor/ios@^8` 的确切发布版本号、与 core 8.5.2 的兼容性、`SystemBars` 的 `insetsHandling:'css'` 在 iOS 上是否注入变量 —— **均需在 Mac 上核实**（知识缺口）。本文只承诺"依赖需与 core 同大版本对齐"这一通用原则。
- **iOS 音频语义按公开经验判断**：硬件静音键是否静音 WebAudio、WKWebView 默认 audio session 类别、interruption 后的恢复时序 —— **需真机验证**（风险 1/2/3）。
- **`env(safe-area-inset-*)` 在 WKWebView 的返回值未实测**（风险 5）：Android 侧已真机验证，**iOS 侧未**。
- **`@capacitor/assets` 的 iOS 图标输入约定未核实**（§1.4）：是"三件套"还是"单 `icon.png`"，需在 Mac 上确认。Phase 0 的"补 `resources/icon.png`"是对两种约定都安全的做法。
- **Guideline 4.2 是否适用**：只能提交后知道。
- **性能 / 内存**：与 Android 一样，仍是**几何推算**，需真机实测（同 `adr-mobile-first.md §6`）。
