# Android 内测 APK 构建 Runbook

> 目标：在**用户本机**上，从当前仓库产出一个可安装的 Android 内测 APK。
> 作者：程基岩（技术方向 / 打包） | 配套规格：`docs/architecture/mobile-platform.md` §2、ADR：`adr-mobile-first.md`
>
> **本机（AI 工作环境）无法产出 APK**：无 Java 运行时、无 `gradle`、`ANDROID_HOME` / `ANDROID_SDK_ROOT` 为空、
> 无 `~/Library/Android/sdk`、无 Xcode。因此本文**明确区分「本机已验证」与「需在用户机器执行且未验证」**，
> 不要把下文当成"已经打出包了"。

---

## 0. 已验证 / 未验证 一览（先看这张表）

| 步骤 | 本机是否验证 | 证据 / 说明 |
|---|---|---|
| 安装 Capacitor 依赖（core/cli/android/app/haptics/preferences/assets） | ✅ 已验证 | `npm install` 成功，224 包；`npm ls --depth=0` 见 §1 |
| `capacitor.config.ts` 生效（webDir=dist、appId、SystemBars） | ✅ 已验证 | `npx cap add android` 生成的 `assets/capacitor.config.json` 含全部字段 |
| `npx cap add android` 生成原生工程 | ✅ 已验证 | `android/` 落地，见 §2 |
| `npx cap sync android` 拷贝 dist + 注册插件 | ✅ 已验证 | 日志 "Found 3 Capacitor plugins"；`dist` 已进 `android/.../assets/public/` |
| M-08 横屏锁（`sensorLandscape`）写入 manifest | ✅ 已验证 | `android/app/src/main/AndroidManifest.xml:16` |
| 图标 / 启动页生成（74 个资产） | ✅ 已验证 | `resources/` 与 `android/.../res/`，见 §4 |
| 前端 `npm run build` / `typecheck` / `smoke` | ✅ 已验证 | smoke **550 PASS / 0 FAIL** |
| **`./gradlew assembleDebug`（真正编译 APK）** | ❌ **未验证** | 本机无 JDK / 无 Android SDK，命令根本跑不起来 |
| **`adb install` 装到真机** | ❌ **未验证** | 本机无 `adb`、无设备 |
| **签名 Release / AAB 上架** | ❌ **未验证** | 需 keystore（尚未生成，见 §6） |

---

## 1. 前置：装工具链（用户机器）

### 1.1 JDK —— **需要 JDK 21**（不是 17）

> ⚠️ 规格 `mobile-platform.md` §2.2 写的是「JDK 17」，那是 **Capacitor 6** 时代的说法。
> 本工程实际装的是 **Capacitor 8.5.2**，生成的 `android/app/capacitor.build.gradle` 明确写：
> `sourceCompatibility JavaVersion.VERSION_21`。**必须用 JDK 21**，用 17 会在编译期报 release 版本错误。

```bash
# macOS（推荐 Homebrew）
brew install --cask temurin@21      # Eclipse Temurin 21
java -version                        # 应显示 21.x
```

Android Studio 自带的 JDK 也可用（`Android Studio ▸ Settings ▸ Build Tools ▸ Gradle ▸ Gradle JDK` 选 21）。

### 1.2 Android SDK

二选一：

- **图形化**：装 [Android Studio](https://developer.android.com/studio)，首次启动按向导装 "Android SDK Platform 36" + "Android SDK Build-Tools" + "Platform-Tools"。
- **命令行**（更省）：
  ```bash
  brew install --cask android-commandlinetools
  sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0"
  ```
  然后接受许可：`sdkmanager --licenses`

### 1.3 环境变量（**关键**）

```bash
# 追加到 ~/.zshrc 或 ~/.zprofile
export ANDROID_HOME="$HOME/Library/Android/sdk"    # cmdline-tools 用户按其实际路径
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"

source ~/.zshrc
adb version            # 验证
```

验证三件事都就位：
```bash
java -version                 # 21.x
echo $ANDROID_HOME            # 非空且目录存在
ls "$ANDROID_HOME/platforms"  # 应能看到 android-36
```

---

## 2. 生成前端产物并同步到原生工程

在 `homm-web/` 目录下：

```bash
npm ci                 # 或 npm install
npm run build          # tsc → dist/（webDir 指向的就是它）
npx cap sync android   # 把 dist/ 拷进原生工程 + 按 package.json 更新原生插件
```

> 本机已把这四步里的 `npm install` / `npm run build` / `cap add` / `cap sync` 都跑通（见 §0）。
> `npm ci` 需要 `package-lock.json`（已生成并会随本次提交入库）。

`cap sync` 正常输出应包含：

```
[info] Found 3 Capacitor plugins for android:
       @capacitor/app@8.1.1
       @capacitor/haptics@8.0.2
       @capacitor/preferences@8.0.1
✔ Sync finished
```

> 说明：`android/` 工程已由本机 `npx cap add android` 生成并入库，**你不需要再 `cap add`**，只需 `cap sync`。

---

## 3. 编译内测 APK（**这一步本机跑不了**）

```bash
cd android
./gradlew assembleDebug
```

- 首次运行 Gradle 会**联网下载 Gradle 发行版与依赖**，耗时数分钟，正常。
- 产物路径：
  ```
  android/app/build/outputs/apk/debug/app-debug.apk
  ```

> 若报 `SDK location not found`，在 `android/local.properties` 写一行（此文件已被 gitignore，**不要提交**）：
> ```
> sdk.dir=/Users/<你>/Library/Android/sdk
> ```

### 3.1 让 WebView 可调试（内测强烈建议）

内测阶段要抓 Canvas2D / GPU 性能（规格 §7 风险①：移动 WebView 上 `multiply/overlay` 可能掉出 GPU 快路径），
需要在**打包时**打开 WebView 远程调试：

```bash
cd homm-web
CAP_WEBVIEW_DEBUG=1 npm run build
CAP_WEBVIEW_DEBUG=1 npx cap sync android
cd android && ./gradlew assembleDebug
```

装到设备后，Chrome 打开 `chrome://inspect` 即可挂到游戏 WebView 上抓 Performance / Memory。
（`capacitor.config.ts` 里该开关默认为关——**发布版必须保持关闭**，别把调试端口带上线。）

---

## 4. 图标 / 启动页（已生成，如需改再跑）

源资产在 `homm-web/resources/`：
- `icon-only.png` / `icon-foreground.png` / `icon-background.png`（均 1024×1024）
- `splash.png` / `splash-dark.png`（2732×2732）

它们由 `tools/mobile-assets.mjs` 从 `public/icon.svg` 栅格化而来（复用像素城堡/旗帜纹样，不做拟物图标）。
要改图标：改 `public/icon.svg`，然后：

```bash
cd homm-web
npm run assets:mobile
```

该命令 = `node tools/mobile-assets.mjs`（生成 `resources/`）+ `capacitor-assets generate --android`（生成各密度资源）。
本机已跑通，产出 **74 个 Android 资产、725 KB**，落在 `android/app/src/main/res/`。

配色：图标底 `#3a2a14`（深金），启动页底 `#1b1f24`（与 CSS `--stone-3` / `theme-color` 一致，避免启动白闪）。

> 小瑕疵（不影响运行）：`capacitor-assets` 会把 `res/values/ic_launcher_background.xml` 的 `color` 写成默认 `#FFFFFF`。
> 自适应图标实际引用的是 `@mipmap/ic_launcher_background`（金色 PNG），这个 color 资源**未被引用**。
> 若在意可手动改成 `#3a2a14`，但**下次重跑 `assets:mobile` 会被重置**。

> 规格 §2.6 提到的「`--android` 只生成 xhdpi/xxhdpi/xxxhdpi 三档省体积」：**当前 `@capacitor/assets@3.0.5` 不支持该粒度开关**，
> 只能全密度生成后手动删 `res/drawable-*dpi/` 与 `mipmap-*dpi/` 里的低密度档。本轮未做（725 KB 可接受）。

---

## 5. 装到真机

**方式 A：adb（已连 USB 调试的机器）**
```bash
adb devices                 # 确认设备出现
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

**方式 B：手动传 APK**
把 `app-debug.apk` 通过 AirDrop / 网盘 / 数据线拷到手机，点击安装，允许"未知来源"。

> debug APK 用 Android 默认调试签名，无需你自己的 keystore，但不能上架，也不要长期分发。
> 装好后应看到：应用名 **英雄之歌**、图标为深金底立方体+旗帜、启动即**横屏**。

---

## 6. 之后：签名 Release 版（上架用，本轮**未做**）

### 6.1 生成 keystore（**一次性，务必备份！**）

```bash
keytool -genkeypair -v \
  -keystore ~/keys/heroesong-release.jks \
  -alias heroesong \
  -keyalg RSA -keysize 2048 -validity 10000
```

⚠️ **keystore 丢失 = 该 appId 永远无法再更新已上架的 App**。请：
1. **不要**放进仓库（`.gitignore` 已挡 `*.jks` / `*.keystore` / `key.properties`，但请自己再确认）；
2. 备份到密码管理器 / 加密云盘 / 离线介质，至少两份；
3. 记下 **alias、store 口令、key 口令** —— 三者缺一不可。

> 本机**未生成任何 keystore**（没有 `keytool`，也没有 JDK）。这一项完全留给用户：**谁持有 keystore，谁就是发布者**。

### 6.2 配置签名

新建 `android/key.properties`（**已被 gitignore，勿提交**）：
```properties
storeFile=/Users/<你>/keys/heroesong-release.jks
storePassword=****
keyAlias=heroesong
keyPassword=****
```
在 `android/app/build.gradle` 的 `android { }` 里加 `signingConfigs` 并在 `buildTypes.release` 引用（Capacitor/Android 官方文档有标准写法）。

### 6.3 出 AAB（Play 上架格式）

```bash
cd android
./gradlew bundleRelease
# 产物：android/app/build/outputs/bundle/release/app-release.aab
```
上 Google Play 需 **一次性 $25** 开发者账号；首次审核通常 1–3 天。
本作**不申请任何运行时权限**（不联网、不读存储、不定位），审核摩擦最小——`AndroidManifest.xml` 里除 Capacitor 自带的 `INTERNET` 外没有多余权限。

---

## 7. 需要用户拍板的决定

| # | 决定项 | 现状 | 为什么必须确认 |
|---|---|---|---|
| 1 | **appId / 包名** | `com.lichao.heroesong`（占位） | 一旦随包发布即为**不可更改**的包身份（Android `applicationId`、日后 iOS bundle id）。改了要重发。请确认或替换。 |
| 2 | **keystore 归属与保管** | 未生成 | 丢失即永久失去更新权。必须指定保管人（见 §6.1）。 |
| 3 | **上架范围** | 先 Android 内测 | Apple 开发者 $99/年 + Guideline 4.2（纯套壳会被拒）风险，见 ADR §4.2。 |

---

## 8. 附：本工程实际生成的 SDK / 工具版本（与规格有出入，以实际为准）

| 项 | 规格 §2.4 写的 | **实际生成（Capacitor 8）** | 说明 |
|---|---|---|---|
| minSdk | 23 | **24** | Capacitor 8 默认上移 |
| compileSdk | 34 | **36** | 已装 Android SDK Platform 36 |
| targetSdk | 34 | **36** | Google Play 新应用的 targetSdk 下限已逐年上移，36 更保险 |
| Gradle JDK | 17 | **21** | `capacitor.build.gradle` → `VERSION_21` |
| 方向锁 | `sensorLandscape` | `sensorLandscape` ✅ | 一致（M-08 已落） |

---

## 9. 给 Web 侧的衔接提醒（不属本 runbook 执行范围，但会影响移动端观感）

- **安全区**：Capacitor 8 的 `SystemBars`（内置于 core）已在 `capacitor.config.ts` 配 `insetsHandling:'css'`，
  会向 WebView 注入 `--safe-area-inset-*` 变量。**Web 层 CSS 应写
  `var(--safe-area-inset-top, env(safe-area-inset-top, 0px))`** 这种"先变量后 env 兜底"的形式，
  才能同时覆盖 Android 老 WebView 的 `env()` 缺陷。`viewport-fit=cover` 仍需 Web 侧补（`public/index.html`，非本人负责）。
- **Android 15+ 已是强制 edge-to-edge**（targetSdk 36），旧的 `@capacitor/status-bar` 的
  `overlaysWebView` / `backgroundColor` 在 API 35+ 已失效——所以**没有**安装该插件，也没有走老路。
