(async () => {
  const find = (text) =>
    [...document.querySelectorAll('button, .btn, [role="button"]')].find(
      (b) => (b.textContent || '').trim() === text
    );

  const btn = find('开始新游戏');
  if (!btn) {
    const ss = document.querySelector('#start-screen');
    return JSON.stringify(
      { ok: false, reason: '找不到「开始新游戏」按钮', 开局页display: ss ? getComputedStyle(ss).display : null },
      null,
      2
    );
  }

  // 用真实 pointer 事件序列点击，避免 .click() 不触发（有些实现只监听 pointerdown）
  const r = btn.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const base = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'touch', isPrimary: true };
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    btn.dispatchEvent(type === 'click' ? new MouseEvent(type, base) : new PointerEvent(type, base));
  }

  await new Promise((res) => setTimeout(res, 4000));

  const ss = document.querySelector('#start-screen');
  const mapC = document.getElementById('map');
  return JSON.stringify(
    {
      ok: true,
      点击坐标: [Math.round(cx), Math.round(cy)],
      开局页display: ss ? getComputedStyle(ss).display : '(无此元素)',
      map画布backing: mapC ? mapC.width + '×' + mapC.height : null,
      可见HUD按钮数: [...document.querySelectorAll('.btn')].filter((b) => {
        const rr = b.getBoundingClientRect();
        return rr.width > 0 && rr.top >= 0 && rr.bottom <= window.innerHeight;
      }).length,
    },
    null,
    2
  );
})()
