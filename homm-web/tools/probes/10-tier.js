(() => {
  const out = { localStorage: {}, 可疑全局: [], canvasScale: null };

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out.localStorage[k] = (localStorage.getItem(k) || '').slice(0, 60);
    }
  } catch (e) {
    out.localStorage = '(读取失败: ' + e.message + ')';
  }

  out.可疑全局 = Object.keys(window)
    .filter((k) => /tier|quality|dpr|cap/i.test(k))
    .map((k) => ({ k, v: String(window[k]).slice(0, 40) }));

  const c = document.getElementById('map');
  if (c) {
    const r = c.getBoundingClientRect();
    out.canvasScale = {
      css: Math.round(r.width) + '×' + Math.round(r.height),
      backing: c.width + '×' + c.height,
      倍率: r.width ? +(c.width / r.width).toFixed(3) : null,
    };
  }
  return JSON.stringify(out, null, 2);
})()
