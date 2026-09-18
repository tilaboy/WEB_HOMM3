(() => {
  const r = window.__frameRec;
  if (!r) return JSON.stringify({ error: '未安装探针 —— 先跑 04-raf-install.js' });

  const pct = (arr, p) => {
    if (!arr.length) return null;
    const a = [...arr].sort((x, y) => x - y);
    return +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(2);
  };
  const stat = (arr) => ({
    n: arr.length,
    avg: arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null,
    p50: pct(arr, 0.5),
    p95: pct(arr, 0.95),
    p99: pct(arr, 0.99),
    max: arr.length ? +Math.max(...arr).toFixed(2) : null,
  });

  const iv = stat(r.interval);
  const wk = stat(r.work);

  // 渲染倍率（画质分档 DPR 钳制的直接证据）
  const mapC = document.getElementById('map');
  const scale = mapC && mapC.getBoundingClientRect().width
    ? +(mapC.width / mapC.getBoundingClientRect().width).toFixed(2)
    : null;

  const ss = document.querySelector('#start-screen');
  const ssShown = ss ? getComputedStyle(ss).display !== 'none' : false;

  return JSON.stringify(
    {
      采样: { 帧数: r.frames, 时长秒: +((performance.now() - r.t0) / 1000).toFixed(1) },
      帧间隔_ms: iv,
      实测FPS: iv.avg ? +(1000 / iv.avg).toFixed(1) : null,
      帧工作耗时_ms: wk,
      占60fps预算: wk.p95 != null ? (wk.p95 / 16.67 * 100).toFixed(0) + '% (按 p95)' : null,
      掉帧: {
        间隔大于20ms_即低于50fps: r.interval.filter((x) => x > 20).length,
        间隔大于33ms_即低于30fps: r.interval.filter((x) => x > 33).length,
      },
      环境: {
        屏幕DPR: window.devicePixelRatio,
        map画布渲染倍率: scale,
        map画布backing: mapC ? mapC.width + '×' + mapC.height : null,
        开局页仍显示: ssShown,
      },
    },
    null,
    2
  );
})()
