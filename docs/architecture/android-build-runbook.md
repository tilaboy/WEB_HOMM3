# Android 内测 APK 构建 Runbook

> 目标：在**用户本机**上，从当前仓库产出一个可安装的 Android 内测 APK。
> **状态更新（2026-09-18 17:04）：APK 已成功产出。**
> 用户机器已装齐工具链（Temurin JDK 21.0.12.1 + brew cask `android-commandlinetools`，
> SDK 根目录 `/opt/homebrew/share/android-commandlinetools`），`./gradlew assembleDebug`
> **BUILD SUCCESSFUL**。产物见 §3 的「实测产物」。
> 下文「本机（AI 工作环境）无工具链」的描述是**撰写时**的事实，现已不适用 —— 保留作历史说明。
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
| **`./gradlew assembleDebug`（真正编译 APK）** | ✅ **已验证（2026-09-18，用户机）** | BUILD SUCCESSFUL；产物 `app-debug.apk` **4.8 MB**（582 项 / 未压缩 11.3 MB），详见 §3 |
| **`adb install` 装到真机** | ⏳ **待做** | `adb` 已就位（1.0.41 / 37.0.1）；`adb devices` 当前**无设备** —— 需插真机或起模拟器 |
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

  > brew cask 的目录布局是 `cmdline-tools/bin`（**没有** `latest` 层），部分版本的 `sdkmanager`
  > 会因此定位不到 SDK 根、报警告或把包装错位置。若遇到，显式指定根目录：
  > `sdkmanager --sdk_root="$ANDROID_HOME" --install ...`（`ANDROID_HOME` 见 §1.3，先配好再跑）。

### 1.3 环境变量（**关键**）

> ⚠️ **先确定 SDK 根目录在哪 —— 本节最容易卡住的就是这里。**
> - **Android Studio 路线** → 根目录是 `$HOME/Library/Android/sdk`
> - **`brew install --cask android-commandlinetools` 路线** → 根目录是
>   **`$(brew --prefix)/share/android-commandlinetools`**（Apple Silicon 通常是
>   `/opt/homebrew/share/android-commandlinetools`）——**不是** `~/Library/Android/sdk`。
>
> brew 的 cask **不会**把 SDK 放进 `~/Library`。若照搬默认值，会出现「`sdkmanager` 往 A 目录装包、
> `adb` 去 B 目录找不到」的错配，而且**报错位置会把人引去查 PATH**，实际是根目录写错了。
> 若别的工具链（如 Flutter）要求 `~/Library/Android/sdk`，用软链统一即可：
> ```bash
> ln -sfn "$(brew --prefix)/share/android-commandlinetools" "$HOME/Library/Android/sdk"
> ```

```bash
# 追加到 ~/.zshrc 或 ~/.zprofile
export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"   # Android Studio 用户改回 "$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"

source ~/.zshrc
```

**验证（按顺序来：先「不依赖 Java」的，再「依赖 Java」的，便于定位问题出在哪一层）**

```bash
which adb && adb version               # ① 证明 platform-tools 已落地 + PATH 的 platform-tools 半边通了（不需要 Java）
echo "$ANDROID_HOME"                   # ② 变量非空；再 ls 一眼确认目录真实存在
ls "$ANDROID_HOME/platform-tools"      # ③ 应看到 adb
which sdkmanager                       # ④ 证明 PATH 的 cmdline-tools/latest/bin 半边也通了
sdkmanager --version                   # ⑤ 到这一步才需要 Java —— 它同时验证 PATH + JDK
java -version                          # ⑥ 必须是 21.x（用 17 会在编译期报 release 版本错误）
ls "$ANDROID_HOME/platforms"           # ⑦ 应看到 android-36
ls "$ANDROID_HOME/build-tools"         # ⑧ 应看到 36.0.0 —— 缺了会一直潜伏到 Gradle 构建时才炸
```

> **为什么①偏偏用 `adb`，而不是直接 `sdkmanager`？**
> `sdkmanager` 是个 **Java 启动的脚本**：它一失败，你分不清到底是**PATH 没配好**还是**JDK 有问题**。
> `adb` 是自带的**原生二进制、完全不依赖 Java**，所以它能干净地把「PATH / SDK 接线」这一层先排除掉，
> 剩下的失败才归因到 JDK。**这个顺序本身就是为缩小排查面而设计的。**
>
> ⚠️ 但要清楚：**`adb` 不是构建 APK 的必需品。** 构建靠的是 JDK 21 + `platforms;android-36` +
> `build-tools;36.0.0`；`adb` 的用途是**装到真机**（`adb install`，见 §5）与 logcat 调试。
> 它出现在这里，纯粹是因为它是最快、且不依赖 Java 的「接线是否生效」探针。

> **真正决定构建成败的是 ⑤⑥⑦⑧。** 尤其 **⑧ `build-tools`**：本工程 `variables.gradle` **没有**固定
> `buildToolsVersion`，由 Gradle 按 AGP 8.13 的默认值取。若当初 `sdkmanager --install "build-tools;36.0.0"`
> 静默失败（**许可未接受是常见原因**，`sdkmanager --licenses` 必须跑完），则 ①~⑦ 全绿，
> **一路潜伏到十几分钟后 Gradle 构建失败才暴露**。

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

#### 实测产物（2026-09-18 17:04，用户机）

| 项 | 值 |
|---|---|
| 路径 | `homm-web/android/app/build/outputs/apk/debug/app-debug.apk` |
| 大小 | **4.8 MB**（582 项 / 未压缩 11.3 MB）——落在 §2.7 预估的 4–7 MB 区间内 |
| SHA-256 | `ce461689677b98ac7e72d3cf3766b12b9372e21e41079c9642523c561d1c2ee4` |
| 包名 | `com.lichao.heroesong`（**占位，待用户拍板**，见 §7） |
| versionCode / versionName | `1` / `1.0` |
| minSdk / targetSdk / compileSdk | **24 / 36 / 36** |
| application-label | `英雄之歌` |
| 启动 Activity | `com.lichao.heroesong.MainActivity` |
| 方向锁 | `screenOrientation=6`（`sensorLandscape`）✅ |
| 签名 | `CN=Android Debug`（debug key，可直接侧载）|
| 权限 | `INTERNET`、`VIBRATE`（后者来自 `@capacitor/haptics`）|
| 图标密度 | 7 档（120→640 dpi）|

**已验证打包进 APK 的 web 资源**：119 个文件在 `assets/public/`；
APK 内 `capacitor.config.json` 的 `webContentsDebuggingEnabled` = **`false`** ✅
（未设 `CAP_WEBVIEW_DEBUG`，生产安全默认值保持住了）。

**两条构建卫生提示（不阻塞内测，发布前应收）**：
- **54 个 `.map` 源映射共 589 KB** 被打进 APK —— 比自研 JS 本体（≈493 KB）还大。
  内测留着反而便于 `chrome://inspect` 调试；**发布版必须剥离**。
- 4 个开发用测试页（`_battle/_hoverprobe/_map/_siege.html`，共 ≈5.6 KB）同样在包内，发布前剔除。

> 若报 `SDK location not found`，在 `android/local.properties` 写一行（此文件已被 gitignore，**不要提交**）：
> ```
> # 值必须与 §1.3 的 $ANDROID_HOME 一致（两者不一致 ⇒ 这里也会报 SDK location not found）
> sdk.dir=/opt/homebrew/share/android-commandlinetools            # brew cask（Apple Silicon）
> # sdk.dir=/usr/local/share/android-commandlinetools             # brew cask（Intel Mac）
> # sdk.dir=/Users/<你>/Library/Android/sdk                       # Android Studio 路线
> ```
> 不确定该填哪个就直接用变量代入：`echo "sdk.dir=$ANDROID_HOME" > android/local.properties`
> （`ANDROID_HOME` 为空说明 §1.3 还没配好，先回去配）。

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
