(async () => {
  const target = '定位';
  const btn = [...document.querySelectorAll('button, .btn, [role="button"]')].find(
    (b) => (b.textContent || '').trim() === target
  );
  if (!btn) return JSON.stringify({ ok: false, reason: '找不到「' + target + '」按钮' }, null, 2);

  const r = btn.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const base = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'touch', isPrimary: true };
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    btn.dispatchEvent(type === 'click' ? new MouseEvent(type, base) : new PointerEvent(type, base));
  }

  await new Promise((res) => setTimeout(res, 2500));
  const mapC = document.getElementById('map');
  return JSON.stringify(
    { ok: true, 点击: [Math.round(cx), Math.round(cy)], map画布: mapC ? mapC.width + '×' + mapC.height : null },
    null,
    2
  );
})()
