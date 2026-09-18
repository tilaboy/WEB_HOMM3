(() => {
  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };

  const buttons = [...document.querySelectorAll('button, .btn, a.btn, [role="button"]')].map((b) => {
    const r = b.getBoundingClientRect();
    return {
      text: (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24),
      cls: typeof b.className === 'string' ? b.className : '',
      id: b.id || '',
      visible: isVisible(b),
      rect: isVisible(b) ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null,
    };
  });

  const canvases = [...document.querySelectorAll('canvas')].map((c) => ({
    id: c.id || '',
    cls: typeof c.className === 'string' ? c.className : '',
    backing: c.width + '×' + c.height,
    css: Math.round(c.getBoundingClientRect().width) + '×' + Math.round(c.getBoundingClientRect().height),
    visible: isVisible(c),
  }));

  // 找可能的游戏全局对象（app 是否把 state 挂到 window）
  const globals = Object.keys(window).filter((k) => /^(game|state|h3|homm|app|__)/i.test(k)).slice(0, 25);

  return JSON.stringify(
    {
      可见按钮: buttons.filter((b) => b.visible),
      全部按钮数: buttons.length,
      canvas: canvases,
      可疑全局: globals,
      raf已装探针: !!window.__frameRec,
    },
    null,
    2
  );
})()
