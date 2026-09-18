(() => {
  const t = window.__tt;
  if (!t) return JSON.stringify({ error: '未安装 —— 先跑 08-touch-install.js' });

  const rs = t.results;
  const miss = rs.filter((r) => !r.命中).length;
  const devs = rs.map((r) => r.偏差px).sort((a, b) => a - b);
  const pct = (p) => (devs.length ? devs[Math.min(devs.length - 1, Math.floor(devs.length * p))] : null);

  const sizes = [...new Set(rs.map((r) => r.尺寸))];

  return JSON.stringify(
    {
      进度: t.idx + ' / ' + t.targets.length,
      已完成: t.done,
      有效样本: rs.length,
      误触次数: miss,
      误触率: rs.length ? (miss / rs.length * 100).toFixed(1) + '%' : null,
      偏差px: { p50: pct(0.5), p90: pct(0.9), max: rs.length ? Math.max(...devs) : null },
      被测按钮尺寸: sizes,
      明细: rs,
    },
    null,
    2
  );
})()
