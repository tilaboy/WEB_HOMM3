(() => {
  // 真机误触测试：用红框依次高亮 10 个「最危险的小按钮」，真人照着点，
  // 每次 pointerdown 记录落点、是否命中、离中心多远、以及实际点到了谁。
  // 与无头浏览器 audit:touch 的区别：**这是真人手指 + 真实机器**。
  if (window.__tt) return '已安装（幂等）';

  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 &&
      r.left >= -2 && r.top >= -2 &&
      r.right <= window.innerWidth + 2 && r.bottom <= window.innerHeight + 2;
  };

  // 按面积升序 → 最小的、最容易误触的排前面
  const targets = [...document.querySelectorAll('.btn, button')]
    .filter(vis)
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height)
    .slice(0, 10)
    .map((x) => x.el);

  const t = {
    targets,
    idx: 0,
    results: [],
    started: Date.now(),
    done: false,
    paint() {
      document.querySelectorAll('.__ttMark').forEach((n) => n.remove());
      document.querySelectorAll('.__ttTip').forEach((n) => n.remove());
      if (this.idx >= this.targets.length) { this.done = true; return; }
      const r = this.targets[this.idx].getBoundingClientRect();
      const d = document.createElement('div');
      d.className = '__ttMark';
      d.style.cssText =
        'position:fixed;left:' + (r.left - 3) + 'px;top:' + (r.top - 3) +
        'px;width:' + (r.width + 6) + 'px;height:' + (r.height + 6) +
        'px;border:3px solid #ff3b30;box-shadow:0 0 0 3px rgba(255,59,48,.35);' +
        'pointer-events:none;z-index:99998;border-radius:4px;';
      const tip = document.createElement('div');
      tip.className = '__ttTip';
      tip.textContent = (this.idx + 1) + '/' + this.targets.length;
      tip.style.cssText =
        'position:fixed;left:' + r.left + 'px;top:' + Math.max(4, r.top - 26) +
        'px;background:#ff3b30;color:#fff;font:600 14px/1 sans-serif;padding:4px 8px;' +
        'border-radius:6px;pointer-events:none;z-index:99999;';
      document.body.appendChild(d);
      document.body.appendChild(tip);
    },
    onDown(e) {
      if (this.done || this.idx >= this.targets.length) return;
      const el = this.targets[this.idx];
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const inside = e.clientX >= r.left && e.clientX <= r.right &&
                     e.clientY >= r.top && e.clientY <= r.bottom;
      const actual = document.elementFromPoint(e.clientX, e.clientY);
      this.results.push({
        n: this.idx + 1,
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 10),
        尺寸: Math.round(r.width) + '×' + Math.round(r.height),
        目标中心: [Math.round(cx), Math.round(cy)],
        落点: [Math.round(e.clientX), Math.round(e.clientY)],
        命中: inside,
        偏差px: Math.round(Math.hypot(e.clientX - cx, e.clientY - cy)),
        实点: actual ? (actual.textContent || actual.tagName).trim().replace(/\s+/g, ' ').slice(0, 10) : null,
      });
      this.idx++;
      this.paint();
    },
    reset() { this.idx = 0; this.results = []; this.done = false; this.paint(); },
  };

  document.addEventListener('pointerdown', t.onDown.bind(t), true);
  window.__tt = t;
  t.paint();
  return '已安装：共 ' + targets.length + ' 个目标，请点红框（进度 ' + t.idx + '/' + targets.length + '）';
})()
