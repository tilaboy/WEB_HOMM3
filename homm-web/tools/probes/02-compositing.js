(async () => {
  const dpr = window.devicePixelRatio;
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;

  /**
   * ⚠️ 关键：canvas 的 **backing store** 必须是 DPR 缩放后的尺寸，
   * 否则量到的是 1/9 的像素量（DPR 3 时），结论会被严重低估。
   * 所以这里同时测两档，用来说明"量错分辨率会差多少"。
   */
  function makePair(bw, bh) {
    const dst = document.createElement('canvas');
    dst.width = bw; dst.height = bh;
    const g = dst.getContext('2d');
    const src = document.createElement('canvas');
    src.width = bw; src.height = bh;
    const sg = src.getContext('2d');
    const grad = sg.createLinearGradient(0, 0, bw, bh);
    grad.addColorStop(0, 'rgba(255,214,150,0.55)');
    grad.addColorStop(1, 'rgba(40,30,70,0.55)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, bw, bh);
    return { g, src };
  }

  function bench(bw, bh, op, iters) {
    const { g, src } = makePair(bw, bh);
    for (let i = 0; i < 10; i++) {
      g.globalCompositeOperation = op;
      g.drawImage(src, 0, 0);
    }
    g.globalCompositeOperation = 'source-over';
    g.drawImage(src, 0, 0);

    const t0 = performance.now();
    for (let i = 0; i < iters; i++) {
      g.globalCompositeOperation = 'source-over';
      g.drawImage(src, 0, 0);
      g.globalCompositeOperation = op;
      g.drawImage(src, 0, 0);
    }
    // 循环外只刷一次，把排队的 GPU 工作强制落地（否则异步批处理会掩盖真实耗时）
    g.getImageData(0, 0, 1, 1);
    const t1 = performance.now();
    return (t1 - t0) / (iters * 2);
  }

  const N = 100;
  const ops = ['source-over', 'multiply', 'overlay', 'lighter'];
  const out = {
    devicePixelRatio: dpr,
    cssViewport: cssW + '×' + cssH,
    backingStore: Math.round(cssW * dpr) + '×' + Math.round(cssH * dpr),
  };

  // 档 A：正确 —— DPR 缩放后的 backing store（游戏实际用的）
  const real = {}; for (const op of ops) real[op] = +bench(Math.round(cssW * dpr), Math.round(cssH * dpr), op, N).toFixed(3);
  // 档 B：错误 —— 只用 CSS 尺寸（用来暴露"量错分辨率"的偏差）
  const css = {}; for (const op of ops) css[op] = +bench(cssW, cssH, op, N).toFixed(3);

  out['A_真实DPR画布_每帧全屏drawImage_ms'] = real;
  out['B_仅CSS尺寸_每帧全屏drawImage_ms'] = css;
  out['低估倍数'] = +(real['source-over'] / css['source-over']).toFixed(2);

  const base = real['source-over'];
  const ratio = {}; for (const op of ops) ratio[op] = +(real[op] / base).toFixed(2);
  out['相对source_over倍数_真实画布'] = ratio;

  // 本作光照是"三遍全屏混合"，按真实画布折算
  out['光照三遍全屏_估算ms'] = +(real['multiply'] * 3).toFixed(2);
  out['占60fps帧预算'] = (real['multiply'] * 3 / 16.67 * 100).toFixed(1) + '%';

  out['判定_是否掉快路径'] =
    ratio['multiply'] > 8
      ? '⚠️ multiply 疑似掉出 GPU 快路径（慢 ' + ratio['multiply'] + ' 倍）'
      : '✅ multiply 与 source-over 同量级 → 未掉出快路径';

  return JSON.stringify(out, null, 2);
})()
