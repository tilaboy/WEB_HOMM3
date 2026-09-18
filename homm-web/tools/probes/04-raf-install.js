(() => {
  // 幂等：装过就不重复包（避免多层包裹把开销叠上去）
  if (window.__frameRec && window.__frameRec.v === 1) return '已安装（无副作用）';

  const rec = { v: 1, interval: [], work: [], frames: 0, t0: performance.now() };
  const orig = window.requestAnimationFrame.bind(window);
  let lastTs = 0;

  window.requestAnimationFrame = function (cb) {
    return orig(function (ts) {
      const m0 = performance.now();
      // 帧间隔用浏览器给的 ts（对齐 vsync），比 performance.now() 更准
      if (lastTs) {
        rec.interval.push(ts - lastTs);
        if (rec.interval.length > 4000) rec.interval.splice(0, 2000); // 环形缓冲，防长跑吃内存
      }
      lastTs = ts;

      let r;
      try {
        r = cb(ts);
      } finally {
        rec.work.push(performance.now() - m0);
        if (rec.work.length > 4000) rec.work.splice(0, 2000);
        rec.frames++;
      }
      return r;
    });
  };

  window.__frameRec = rec;
  window.__frameRecReset = () => {
    rec.interval.length = 0;
    rec.work.length = 0;
    rec.frames = 0;
    rec.t0 = performance.now();
  };
  return '已安装 rAF 帧探针 v1';
})()
