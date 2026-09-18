import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 打包配置 —— 移动端规格 `docs/architecture/mobile-platform.md` §2.3。
 *
 * 交付形态：把 `npm run build` 产出的 `dist/`（纯 Web 资源，≈0.5 MB）包进原生壳。
 * 原生工程零业务逻辑，业务代码不因打包而分叉（见 `adr-mobile-first.md`）。
 *
 * 版本提示：本配置按 Capacitor 8 编写（装的是 8.5.2）。规格 §2.4 里写的
 * `compileSdk/targetSdk 34`、`minSdk 23` 是 Capacitor 6 的默认值，**8.x 已上移**，
 * 以 `android/variables.gradle` 实际生成的值为准。
 */
const config: CapacitorConfig = {
  // 包身份（用户 2026-09-18 拍板）：a2studio = 工作室名；thecodeofchivalry = 游戏名
  // 《骑士信条》/ The Code of Chivalry。
  // ⚠️ 一旦随包上架即成为**不可更改**的包身份（Android applicationId / iOS bundle id），
  // 改名需重发。原占位值 `com.lichao.heroesong` 已废弃（旧名《英雄之歌》与多款在运营手游撞名）。
  appId: 'com.a2studio.thecodeofchivalry',
  appName: '骑士信条',
  webDir: 'dist',

  // 与 manifest theme_color / CSS --stone-3 一致，避免启动瞬间白闪
  backgroundColor: '#1b1f24',

  android: {
    // 默认值即 https://localhost —— 保证 origin 稳定（localStorage 分区、location.protocol 判断）
    androidScheme: 'https',
    allowMixedContent: false,
    // 生产安全默认关闭；内测 APK 需要 Chrome DevTools 远程调试 Canvas2D 性能（规格 §7 风险①）时，
    // 用环境变量开启：CAP_WEBVIEW_DEBUG=1 npm run build && CAP_WEBVIEW_DEBUG=1 npx cap sync android
    webContentsDebuggingEnabled: process.env.CAP_WEBVIEW_DEBUG === '1',
  },

  ios: {
    // 安全区自己用 env(safe-area-inset-*) 管，不让 WebView 二次内缩
    contentInset: 'never',
    backgroundColor: '#1b1f24',
    // 关键：默认可能按桌面宽度渲染，会让 style.css 的 max-width 断点全部失效 → 手机上看到桌面三栏布局
    preferredContentMode: 'mobile',
  },

  plugins: {
    // 运行时方向锁兜底。⚠️ 需安装 `@capacitor/screen-orientation` 才生效——本轮未装；
    // 方向锁目前完全走原生侧 AndroidManifest 的 sensorLandscape（M-08，见 android-build-runbook）。
    // 保留此块以便后续补装插件时零改动即生效。
    ScreenOrientation: { lock: 'landscape' },

    // 系统栏（状态栏/导航栏）——内置于 @capacitor/core，无需额外安装。
    // Android 15+（本工程 targetSdk 36）由系统强制 edge-to-edge，旧的
    // @capacitor/status-bar 的 overlaysWebView/backgroundColor 在 API 35+ 已失效，
    // 因此 inset 只能走这条官方路径：insetsHandling:'css' 会向 WebView 注入
    // `--safe-area-inset-*` 变量（Web 层应写 `var(--safe-area-inset-top, env(safe-area-inset-top, 0px))`）。
    // style:'DARK' = 深色背景配浅色系统栏图标（本作背景 #1b1f24 为深色）。
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
    },
  },
};

export default config;
