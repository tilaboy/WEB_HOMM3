(() => {
  const docCS = getComputedStyle(document.documentElement);
  const readVar = (n) => {
    const v = docCS.getPropertyValue(n).trim();
    return v === '' ? '(空 / 未注入)' : v;
  };
  const px = (v) => (v && v !== 'normal' ? parseFloat(v) : null);

  const ss = document.querySelector('#start-screen');
  const ssCS = ss ? getComputedStyle(ss) : null;
  const cols = ssCS ? ssCS.gridTemplateColumns.trim() : null;

  const out = {
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    visualViewport: window.visualViewport
      ? {
          width: Math.round(window.visualViewport.width),
          height: Math.round(window.visualViewport.height),
          scale: window.visualViewport.scale,
        }
      : null,
    orientation:
      (window.screen.orientation && window.screen.orientation.type) ||
      (matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'),

    // 断点命中情况 —— 直接判定"在断点的哪一侧"
    mediaQueries: {
      'max-width:900px': matchMedia('(max-width: 900px)').matches,
      'portrait+max-width:900px': matchMedia('(orientation: portrait) and (max-width: 900px)').matches,
      'max-height:720px': matchMedia('(max-height: 720px)').matches,
    },

    // M-07：Capacitor SystemBars 是否真把变量注入了 WebView
    safeAreaVars: {
      top: readVar('--safe-area-inset-top'),
      right: readVar('--safe-area-inset-right'),
      bottom: readVar('--safe-area-inset-bottom'),
      left: readVar('--safe-area-inset-left'),
    },

    // G-13：开局页到底多高、几栏
    documentScrollHeight: document.documentElement.scrollHeight,
    bodyScrollHeight: document.body.scrollHeight,
    startScreen: ssCS
      ? {
          display: ssCS.display,
          gridTemplateColumns: cols,
          columnCount: cols ? cols.split(/\s+/).length : null,
          scrollHeight: ss.scrollHeight,
          clientHeight: ss.clientHeight,
          overflowY: ssCS.overflowY,
          paddingTop: ssCS.paddingTop,
          paddingRight: ssCS.paddingRight,
          paddingBottom: ssCS.paddingBottom,
          paddingLeft: ssCS.paddingLeft,
          // 内容比视口高多少（>0 即需要滚动）
          overflowPx: ss.scrollHeight - ss.clientHeight,
        }
      : null,
  };

  // 顺带给出一句人话结论
  const ssr = out.startScreen;
  out.verdict = {
    栏数: ssr ? `${ssr.columnCount} 栏` : '(开局页未挂载)',
    需要滚动: ssr ? (ssr.overflowPx > 0 ? `是，多出 ${ssr.overflowPx}px（约 ${(ssr.overflowPx / ssr.clientHeight * 100).toFixed(0)}% 屏高）` : '否，刚好放下') : null,
    安全区变量: Object.values(out.safeAreaVars).every((v) => v.startsWith('(空')) ? '❌ 全部未注入' : '✅ 已注入',
  };

  return JSON.stringify(out, null, 2);
})()
