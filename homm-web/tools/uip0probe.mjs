#!/usr/bin/env node
/**
 * uip0probe.mjs —— P0「界面语法层」的**机检门**（2026-10-22）
 *
 * 起因：P0 的五条全是"看起来变了"的改动，而本仓铁律 §1 是**断言证不了"像"**。
 * 所以这里只锁能被数出来的那一半，另一半（是否真好看）留给肉眼对截图。
 *
 * 锁什么（每条都可数）：
 *   ① type     计算后的 font-size 只允许 12/15/20/28（display 有 *0.7 / *0.75 两个派生）
 *              且同屏档数 ≤ 5 —— 改前是 5 档 + 最低 9px
 *   ② press    可点元素在 `:active` 下 `transform !== 'none'` —— 改前 :active 全站 1 条
 *   ③ material 三个代表面（木质/羊皮纸/铁牌）的底色亮度 + alpha + 模糊 两两可区分
 *   ④ touch    难度档 ≥ 44×44 —— 改前 28×27
 *   ⑤ hpbar    `.hp-bar-top` 内容不溢出（改前四位数移动力压到隔壁"法力"上）
 *
 * 负向对照（铁律 §2，新闸必配）：
 *   `--inject=press|type|material|touch|hpbar` 各注入一条 !important 覆盖，
 *   对应检查**必须变红**；闸自检跑 `--selfcheck`（逐条注入并断言 exit=1）。
 *
 * 用法：
 *   node tools/uip0probe.mjs                 # 跑门（dev server 需已在 5199/5173 上跑）
 *   node tools/uip0probe.mjs --selfcheck     # 负向对照自检
 *   node tools/uip0probe.mjs --json          # 机器可读
 *
 * 退出码：0 全绿 · 1 有判据红 · 2 前置不满足（无 Chrome / 无 dev server）
 */
import { checkDevServer, withHeadlessChrome, chromeAvailable, CHROME_PATH } from './_chrome.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (k, d = null) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};

const PORT = Number(opt('port', 5199));
// 负向对照要逐条切换注入 ⇒ 必须是 let，不能在模块加载时冻结
let INJECT = opt('inject');
const SELFCHECK = has('--selfcheck');
const AS_JSON = has('--json');
const VIEW = { width: 844, height: 390, dpr: 2 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ 判据表 */

/* 四档：12 标签 / 15 正文 / 20 小标题 / 28 大标题。
 * 19.6 与 21 **不是第五、第六档**，是 `calc(var(--t-display) * 0.7|0.75)` 在横屏媒体查询里
 * 对 28 的等比缩放（见 style.css 的 `.ss-brand h1`）；仍算在 28 这一档里。 */
const ALLOWED_SIZES = [12, 15, 20, 28, 19.6, 21];

const rows = [];
function check(id, label, ok, detail) {
  rows.push({ id, label, ok: !!ok, detail });
  return ok;
}

/* ------------------------------------------------------------------ 页面内取数 */

/** 同屏**实际用到的**字号：只统计"直接含文本"的元素，避免把 icon 容器也算进来。 */
const COLLECT_SIZES = `(() => {
  const out = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const txt = (n.textContent || '').trim();
    if (!txt) continue;
    const el = n.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const px = Math.round(parseFloat(cs.fontSize) * 10) / 10;
    out.set(px, (out.get(px) || 0) + 1);
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([px, count]) => ({ px, count }));
})()`;

/** 给可点元素打标，供 forcePseudoState 逐只按压。 */
const TAG_CLICKABLE = `(() => {
  const pick = 'button, .btn, .ss-seg-item, .bcard .bn, .hp-face, .bt-chip';
  const all = [...document.querySelectorAll(pick)].filter((e) => {
    if (e.disabled) return false;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  });
  all.slice(0, 40).forEach((e, i) => e.setAttribute('data-p0', String(i)));
  return all.slice(0, 40).length;
})()`;

const readTransform = (i) =>
  `(() => { const e = document.querySelector('[data-p0="${i}"]'); if (!e) return 'MISSING'; return getComputedStyle(e).transform; })()`;

/** 材质签名：底色亮度 + alpha + 是否有 backdrop 模糊。 */
const MATERIAL = `(() => {
  const put = (sel, must) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const cs = getComputedStyle(e);
    const m = cs.backgroundColor.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    const [r, g, b] = p;
    const a = p.length > 3 ? p[3] : 1;
    const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return { sel, L: Math.round(L * 100) / 100, alpha: a, blur: /blur/.test(cs.backdropFilter || cs.webkitBackdropFilter || '') };
  };
  // 羊皮纸：临时挂一个**只有 class、无 .wide** 的 .modal，验证的是级联（选择器命中）
  let host = document.getElementById('modal-root');
  let made = false;
  if (!host) { host = document.createElement('div'); host.id = 'modal-root'; host.style.cssText='position:absolute;inset:0;pointer-events:none'; document.body.appendChild(host); made = true; }
  const probe = document.createElement('div');
  probe.className = 'modal';
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:200px;height:60px';
  host.appendChild(probe);
  const parch = put('.modal:not(.wide)', true);
  probe.remove();
  if (made) host.remove();
  return { oak: put('.modal.wide') || put('.menu-panel'), parch, iron: put('#hint') };
})()`;

const HPBAR = `(() => {
  const tops = [...document.querySelectorAll('.hp-bar-top')].map((e) => ({
    sw: e.scrollWidth, cw: e.clientWidth,
    kR: e.querySelector('.hp-bar-k')?.getBoundingClientRect().right ?? 0,
    vL: e.querySelector('.hp-bar-v')?.getBoundingClientRect().left ?? 0,
  }));
  return tops;
})()`;

const TOUCH = `(() => {
  const e = document.querySelector('.ss-diff .ss-seg-item') || document.querySelector('.ss-seg-item');
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), cls: e.className, parent: e.parentElement?.className ?? '' };
})()`;

/**
 * 羊皮纸层的**文字对比度**：WCAG 2.1 相对亮度比。
 * 只判 `.modal:not(.wide)` 里的叶子文本 —— 深底浅字换浅底深字，最容易在这里掉到 3:1 以下。
 * 背景要沿祖先链找到第一个 alpha>0.5 的 backgroundColor（弹窗是 background-color + 渐变图，
 * 所以.backgroundColor 是实色，能直接算）。15px 常规字要求 ≥4.5:1（AA）。
 */
const CONTRAST = `(() => {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => { const m = (s.match(/[0-9.]+/g) || []); return { c: m.slice(0, 3).map(Number), a: m.length > 3 ? Number(m[3]) : 1 }; };
  const effBg = (e) => { let n = e; while (n) { const p = parse(getComputedStyle(n).backgroundColor); if (p.a > 0.5) return p.c; n = n.parentElement; } return [0, 0, 0]; };
  const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
  const out = [];
  document.querySelectorAll('.modal:not(.wide), .modal:not(.wide) *').forEach((e) => {
    if (!e.textContent || e.children.length > 0) return;
    const txt = e.textContent.trim();
    if (!txt) return;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const fs = parseFloat(cs.fontSize);
    // 小于 15px 的只有角标/货币这类装饰字，不参与 AA 判据（12px 要求本来就是"别用"）
    if (fs < 15) return;
    out.push({ t: txt.slice(0, 14), cls: e.className || e.tagName, fs, r: Math.round(ratio(parse(cs.color).c, effBg(e)) * 100) / 100 });
  });
  if (!out.length) return null;
  return { n: out.length, min: Math.min(...out.map((x) => x.r)), worst: out.slice().sort((a, b) => a.r - b.r).slice(0, 2) };
})()`;

/**
 * 城镇内容窗：**pane 自己不溢出**才算数。
 * 只看 `.modal` 的 scrollHeight 会被 `overflow:hidden` 吃掉 —— 改前 pane 溢出 122px，
 * 而 modal 的 scrollHeight 恰好等于 clientHeight，于是老闸全绿（铁律 §16 的同款陷阱）。
 */
/**
 * 造价行"去文字化"（2026-10-27 主理人："各个建筑的资源显示太长，给人感觉还是一堆 text"）。
 *
 * 判据只锁**可数**的那一半：
 *   · 造价行里**不许有汉字**（全名已移进 title / aria-label）；
 *   · 每枚 chip 必须真的挂着一个可用的 `<use>`（图标没画出来 = 只剩数字，等于没改）；
 *   · 行不许被裁（`scrollWidth > clientWidth`）——单行不折是这批的硬约束；
 *   · 底部库存条同样改成 7 枚图标 chip；
 *   · `towncost-bad`：`?devpoor=1`（资源压到买不起）时缺项走 `.rc.bad` 红色（图标同步变红）。
 * 是否"好看"仍然只能靠截图，见 §26。
 */
const TOWNCOST = `(() => {
  const rows = [...document.querySelectorAll('.bcard .bs')];
  const costs = rows.filter((r) => r.classList.contains('costs'));
  const cjkOf = (list) => list.filter((r) => /[\\u4e00-\\u9fa5]/.test(r.textContent || '')).length;
  const cjk = cjkOf(costs);
  /* 全部状态行里的汉字数：对照臂（旧文字造价）靠它证"确实回到文字版"。 */
  const cjkAll = cjkOf(rows);
  const chips = costs.map((r) => r.querySelectorAll('.rc').length);
  const iconless = costs
    .flatMap((r) => [...r.querySelectorAll('.rc')])
    .filter((c) => !c.querySelector('svg use')).length;
  const over = rows.filter((r) => r.scrollWidth > r.clientWidth + 1).length;
  return {
    rows: rows.length,
    costs: costs.length,
    cjk,
    cjkAll,
    chipMin: chips.length ? Math.min(...chips) : 0,
    iconless,
    over,
    bad: document.querySelectorAll('.bcard .bs.costs .rc.bad').length,
    badIconOk: [...document.querySelectorAll('.bcard .bs.costs .rc.bad')].every((c) => !!c.querySelector('svg use')),
    budget: document.querySelectorAll('.town-budget .rc').length,
  };
})()`;

/**
 * 英雄栏展开时的**遮挡**（2026-10-27 主理人报「点英雄时半圆盘把英雄遮一半、上面也看不清」）。
 * 量三块矩形：`#side`（面板）、`#topbar`（z30 + backdrop blur）、`#thumb`（240×124 圆盘）。
 * 判据：面板展开时，另两块**都不与它相交**。
 */
const SIDECLEAR = `(() => {
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const side = document.getElementById('side');
  const tb = document.getElementById('topbar');
  const th = document.getElementById('thumb');
  const inter = (a, b) => !!a && !!b && !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  const s = R(side), t = R(tb), d = R(th);
  return {
    open: !!side && !side.classList.contains('collapsed'),
    side: s, topbar: t, thumb: d,
    overlapTop: inter(s, t),
    overlapThumb: inter(s, d),
    bodyCls: document.body.className,
  };
})()`;

const TOWNPANE = `(() => {
  const p = document.querySelector('.modal.wide .town-pane');
  if (!p) return null;
  const cards = [...document.querySelectorAll('.bcard')];
  return {
    sh: p.scrollHeight, ch: p.clientHeight,
    cards: cards.length,
    rows: new Set(cards.map((c) => c.offsetTop)).size,
    full: cards.filter((c) => {
      const r = c.getBoundingClientRect(), pr = p.getBoundingClientRect();
      return r.top >= pr.top - 0.5 && r.bottom <= pr.bottom + 0.5;
    }).length,
  };
})()`;

/**
 * 战斗部队带：撤掉整块底板之后，"两栏"应该只剩**随内容长的卡**。
 *   · 底板不许回来：background alpha ≤ 0.05 且无边框（改前是 .22 + 1px）；
 *   · 每张卡 28~44px（改前是 30px 的纯文字行，撑不开也压不小）；
 *   · 涂色高度 ≤ 行数×44+26 ⇒ 卡是"内容驱动"的，不是把 374px 撑满。
 */
const SIDES = `(() => {
  const cols = [...document.querySelectorAll('.bt-side')].map((c) => {
    const cs = getComputedStyle(c);
    const m = cs.backgroundColor.match(/rgba?\\(([^)]+)\\)/);
    const parts = m ? m[1].split(',').map(Number) : [0, 0, 0, 1];
    const rows = [...c.querySelectorAll('.bt-side-row')];
    const hd = c.querySelector('.bt-side-h');
    const painted =
      (hd ? hd.getBoundingClientRect().height + 3 : 0) +
      rows.reduce((a, r) => a + r.getBoundingClientRect().height, 0) +
      Math.max(0, rows.length - 1) * 4;
    return {
      w: Math.round(c.getBoundingClientRect().width),
      alpha: parts.length > 3 ? parts[3] : 1,
      border: parseFloat(cs.borderTopWidth) || 0,
      rows: rows.length,
      rowH: rows.map((r) => Math.round(r.getBoundingClientRect().height)),
      painted: Math.round(painted),
    };
  });
  return cols.length ? cols : null;
})()`;

/**
 * 动作图标覆盖：10 个主动作（拇指盘 4 + 战斗动作 3 + 战斗顶栏 3）是否都**真的**有图标。
 *
 * 只数"有 `<svg>`"不够 —— `<use href="#i-x">` 指向一个不存在的 symbol 时，
 * 屏幕上什么都不画，但 DOM 看起来完全正常。所以每个 `<use>` 的 href 都要能在
 * sprite 里找到对应 symbol，否则记一条 badRef。
 */

/**
 * 战斗 HUD 四角：两组动作簇必须**贴屏幕下角**，且不压棋盘、不压部队卡。
 *
 * 改前右上「速度/自动战斗/撤退」517×52，横跨 517..836 —— 棋盘右边界 ≈682，
 * 也就是这组按钮把自己盖在棋盘右上角上（主理人："这些可能会遮挡"）。
 * 这条判据盯的就是那件事：簇与 canvas 相交 = 遮挡。
 */
const HUD = `(() => {
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }; };
  const hit = (a, b) => !!a && !!b && a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;
  const canvas = box(document.querySelector('.bt-canvas'));
  const stacks = [box(document.querySelector('.bt-head-actions')), box(document.querySelector('.bt-foot'))].filter(Boolean);
  const rows = [...document.querySelectorAll('.bt-side-row')].map(box);
  const btns = [...document.querySelectorAll('.bt-head-actions .btn, .bt-foot .btn')];
  return {
    n: stacks.length,
    vsCanvas: stacks.filter((s) => hit(s, canvas)).length,
    vsRows: stacks.map((s) => rows.filter((r) => hit(s, r)).length),
    inView: stacks.every((s) => s.x >= -0.5 && s.r <= innerWidth + 1 && s.b <= innerHeight + 1),
    bottom: stacks.map((s) => Math.round(innerHeight - s.b)),
    minH: btns.length ? Math.min(...btns.map((b) => b.getBoundingClientRect().height)) : 0,
    count: btns.length,
  };
})()`;

const ICONS = `(() => {
  // 只数**看得见的**动作按钮：战斗里 #thumb 是 display:none，城镇/开局页 #thumb 可能被面板盖住，
  // 把这些算进来会让"10 个主动作"变成一笔糊涂账（隐藏的图标宽度恒为 0，还会假报不可见）。
  const btns = [...document.querySelectorAll('#thumb .tb-btn, .bt-actions .btn, .bt-head-actions .btn')]
    .filter((b) => b.getBoundingClientRect().width >= 6);
  const ids = new Set([...document.querySelectorAll('#svg-sprite symbol')].map((s) => s.id));
  const missing = [];
  const badRef = [];
  const invisible = [];
  let withIcon = 0;
  for (const b of btns) {
    const svg = b.querySelector('svg.ti');
    if (!svg) {
      missing.push((b.textContent || '').trim() || '(无字)');
      continue;
    }
    // 尺寸为 0 的图标 = 被 CSS 藏了：DOM 还在，屏幕上没有（负向对照就靠这条抓）
    if (svg.getBoundingClientRect().width < 6) invisible.push((b.textContent || '').trim() || '(无字)');
    withIcon++;
    const use = svg.querySelector('use');
    const href = use ? (use.getAttribute('href') || use.getAttribute('xlink:href') || '') : '';
    const id = href.replace(/^#/, '');
    if (!id || !ids.has(id)) badRef.push(id || '(空 href)');
  }
  return { total: btns.length, withIcon, missing, badRef, invisible, symbols: ids.size };
})()`;

/**
 * 预估伤害：**手机上没有 hover**，所以这条必须在"没有鼠标"的前提下验证。
 * 做法是像玩家那样点「等待」把回合让给下一支部队，直到出现可攻击目标（≤4 次），
 * 然后校验：只在敌方卡上、文案格式对、**真的可见**（display:none 的 `.fc` 高度为 0）。
 */
const FORECAST = `(() => {
  const rows = [...document.querySelectorAll('.bt-side-row.has-fc')];
  const fcs = [...document.querySelectorAll('.fc')];
  const onOurs = [...document.querySelectorAll('.bt-side-row.ours .fc')].length;
  const badText = fcs.filter((e) => !/^伤\\d+( · (反|杀)\\d+)?$/.test((e.textContent || '').trim())).map((e) => e.textContent);
  const invisible = fcs.filter((e) => e.getBoundingClientRect().height < 6).length;
  return { rows: rows.length, fcs: fcs.length, onOurs, badText, invisible };
})()`;

/** 让下一支部队行动：点一次「等待」（没有这个按钮就返回 false）。 */
const CLICK_WAIT = `(() => {
  const b = [...document.querySelectorAll('.bt-actions .btn')].find((x) => /等待/.test(x.textContent || ''));
  if (!b || b.disabled) return false;
  b.click();
  return true;
})()`;

/**
 * 行动队列（回合胶囊第二行）。
 *
 * 三件事一起看：**可见**（display:none 会宽度 0）、**没被截断**（名字被切一半等于没报）、
 * **没压到棋盘**（胶囊右边界要停在 canvas 左边界之前 —— 这就是这两轮一直在修的那类遮挡）。
 * "是不是活的"由调用方比对两次读数（点「等待」前后）来判，静态字符串过不了。
 */
const QUEUE = `(() => {
  const el = document.querySelector('.bt-next');
  const chip = document.querySelector('.bt-chip');
  const canvas = document.querySelector('.bt-canvas');
  if (!el || !chip || !canvas) return null;
  const r = el.getBoundingClientRect();
  return {
    text: (el.textContent || '').trim(),
    visible: r.width > 6 && r.height > 0,
    clipped: el.scrollWidth > el.clientWidth + 1,
    chipRight: Math.round(chip.getBoundingClientRect().right),
    canvasLeft: Math.round(canvas.getBoundingClientRect().left),
  };
})()`;

/* ------------------------------------------------------------------ 注入（负向对照 / 压测） */

const INJECT_CSS = {
  press: `*:active { transform: none !important; }`,
  type: `.btn, body, .res { font-size: 9px !important; }`,
  material: `.modal:not(.wide) { background-color: #241806 !important; background-image: none !important; }`,
  touch: `.ss-seg-item, .ss-diff .ss-seg-item { min-height: 20px !important; min-width: 20px !important; }`,
  // 把弹窗里的一行说明字调回浅棕（改前 #7d5416 = 4.28:1）⇒ 对比度判据必须变红
  contrast: `.modal:not(.wide) .ai-head, .modal:not(.wide) p, .modal:not(.wide) .ai-line { color: #8f7440 !important; }`,
  // 回退到改前的宽面板 + 2 列 ⇒ pane 溢出必须复现
  townfit: `.modal.wide { width: 560px !important; height: 300px !important; max-height: 300px !important; }
            .bgrid { grid-template-columns: repeat(2, 1fr) !important; }`,
  // 回退到改前的整块底板 ⇒ 部队带判据必须变红
  sides: `.bt-side { background: rgba(0, 0, 0, 0.22) !important; border: 1px solid #8a6a34 !important;
           border-radius: 10px !important; }`,
  // 图标"在 DOM 里但画不出来"—— 正是 `<use>` 断引用的症状
  icons: `.ti { display: none !important; }`,
  // 回退到改前的**右上横排** ⇒ 这簇必然与棋盘相交，正是主理人说的"遮挡"
  hud: `.bt-head-actions { left: auto !important; right: 8px !important; top: 8px !important; bottom: auto !important;
         flex-direction: row !important; width: auto !important; }`,
  // 队列被藏掉（等于退回"只有一行回合"的老胶囊）
  queue: `.bt-next { display: none !important; }`,
  // 预估被藏掉（等于回到 hover-only 的可见性）
  forecast: `.fc { display: none !important; }`,
  // 回退**整组**（不是只关 overflow）：修法是"标签一行、数值一行"（flex-direction:column），
  // 所以必须把方向也退回 row + space-between，否则两行永远不溢出 ⇒ 负向对照假绿。
  hpbar: `.hp-bar-top { flex-direction: row !important; justify-content: space-between !important;
            gap: 4px !important; flex-wrap: nowrap !important; overflow: visible !important; min-width: auto !important; }
          .hp-bar-v { min-width: auto !important; flex: 0 0 auto !important; margin-left: 0 !important; }`,
};

async function applyInject(send, which) {
  const css = INJECT_CSS[which];
  if (!css) return;
  await send('Runtime.evaluate', {
    expression: `(() => { const s=document.createElement('style'); s.id='p0-inject'; s.textContent=${JSON.stringify(css)}; document.head.appendChild(s); return 1; })()`,
    returnByValue: true,
  });
}

/* ------------------------------------------------------------------ 单屏测量 */

async function measure(send, evaluate, url, { needStart = false, needHero = false, needModal = false } = {}) {
  await send('Page.navigate', { url });
  // 等应用挂载：#thumb（地图）或 #start-screen
  for (let i = 0; i < 200; i++) {
    try {
      const ok = await evaluate(
        `!!(document.querySelector('#thumb') || document.querySelector('#start-screen') || document.querySelector('.battle'))`,
      );
      if (ok) break;
    } catch {
      /* 导航中 */
    }
    await sleep(100);
  }
  await sleep(1400);

  if (needModal) {
    // 羊皮纸层只在"非 wide 弹窗"上出现（事件 / 战报 / AI 动向 / 法术书）。
    // 2026-10-27 起「对手动向」默认只在**打到玩家头上**时弹（主理人：每天弹没必要），
    // 所以这一屏改用 `?devreport=1` 强制把当天全部 AI 事件弹出来 —— 否则这扇普通弹窗
    // 会不会出现取决于 AI 当天干了什么，判据会随机红。
    //
    // ★ 2026-10-24：这一次点击**曾经偶发落空**（全量回归里 `contrast` 变红，单独复跑又绿）。
    //   落空有两种成因，都必须处理：① 按钮还没进 DOM/还是 disabled（上一段过天演出没结束）；
    //   ② 点击发生但弹窗晚于一帧。所以改成「等到按钮可点 → 点 → 等弹窗」最多两轮，
    //   而不是"点一次 + 死等 6s"。**偶发红的门比没有门更糟**：它会把真实失败淹掉。
    const clickEndDay = async () => {
      for (let i = 0; i < 60; i++) {
        const st = await evaluate(`(() => {
          const b = [...document.querySelectorAll('#thumb button, button')].find((x) => /结束一天/.test(x.textContent || ''));
          if (!b) return 'missing';
          if (b.disabled) return 'disabled';
          b.click();
          return 'clicked';
        })()`);
        if (st === 'clicked') return true;
        await sleep(150);
      }
      return false;
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      await clickEndDay();
      let up = false;
      for (let i = 0; i < 30; i++) {
        if (await evaluate(`!!document.querySelector('.modal:not(.wide)')`)) {
          up = true;
          break;
        }
        await sleep(150);
      }
      if (up) break;
    }
    await sleep(400);
  }

  if (needStart) {
    // 开局页若还在教学层，点「跳过」进设置页
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /跳过|略过|开始/.test(x.textContent || ''));
      if (b && !document.querySelector('.ss-diff')) b.click();
      return 1;
    })()`);
    await sleep(700);
  }
  if (needHero) {
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('#thumb button, button')].find((x) => /英雄/.test(x.textContent || ''));
      if (b) b.click();
      return 1;
    })()`);
    await sleep(700);
  }

  if (INJECT) await applyInject(send, INJECT);

  const sizes = await evaluate(COLLECT_SIZES);
  const material = await evaluate(MATERIAL);
  const hp = await evaluate(HPBAR);
  // 难度档只在开局页存在；别的屏上 `.ss-seg-item` 是英雄栏 tab（按 §5.2 密集区就是 40px，
  // 不该拿来判 44）⇒ 只在 needStart 屏上量。
  const touch = needStart ? await evaluate(TOUCH) : null;
  const contrast = needModal ? await evaluate(CONTRAST) : null;
  const townpane = url.includes('devtown') ? await evaluate(TOWNPANE) : null;
  /* 造价行是否已经"去文字化"（图标 + 数字）：只在城镇屏上量。 */
  const towncost = url.includes('devtown') ? await evaluate(TOWNCOST) : null;
  const sides = url.includes('devbattle') ? await evaluate(SIDES) : null;
  const hud = url.includes('devbattle') ? await evaluate(HUD) : null;
  const icons = await evaluate(ICONS);

  // 按压：打标 → 逐个 force :active → 读 transform
  await send('DOM.enable');
  await send('CSS.enable');
  const n = await evaluate(TAG_CLICKABLE);
  const { root } = await send('DOM.getDocument', { depth: 1 });
  let pressed = 0;
  const stuck = [];
  for (let i = 0; i < n; i++) {
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-p0="${i}"]` });
    if (!nodeId) continue;
    await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['active'] });
    const t = await evaluate(readTransform(i));
    await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    pressed++;
    if (!t || t === 'none' || t === 'MISSING') stuck.push({ i, transform: t });
  }

  // 预估伤害：只可能在战斗屏上。按玩家方式点「等待」把回合让出去，直到出现目标。
  let forecast = null;
  let queue0 = null;
  let queue1 = null;
  let waits = 0;
  if (sides) {
    queue0 = await evaluate(QUEUE);
    for (let i = 0; i < 4; i++) {
      forecast = await evaluate(FORECAST);
      if (forecast.fcs > 0) break;
      if (!(await evaluate(CLICK_WAIT))) break;
      waits++;
      await sleep(1800);
    }
    queue1 = await evaluate(QUEUE);
  }

  return {
    url, sizes, material, hp, touch, contrast, townpane, towncost, sides, hud, icons, forecast,
    queue: { before: queue0, after: queue1, waits },
    pressed, stuck,
  };
}

/* ------------------------------------------------------------------ 判据 */

function judge(all) {
  rows.length = 0;

  // ① 字阶
  const seen = new Map();
  let offScale = [];
  for (const s of all) {
    for (const { px, count } of s.sizes) {
      seen.set(px, (seen.get(px) || 0) + count);
      if (!ALLOWED_SIZES.includes(px)) offScale.push(`${s.tag}:${px}px`);
    }
  }
  const tiers = [...seen.keys()].sort((a, b) => a - b);
  check(
    'type',
    '字阶 ≤5 档且全在 12/15/20/28 上',
    offScale.length === 0 && tiers.length <= 5 && tiers[0] >= 12,
    `档位 ${tiers.map((t) => (t === 19.6 || t === 21 ? `${t}(28×缩放)` : t)).join('/')}；越界 ${offScale.length ? [...new Set(offScale)].join(',') : '无'}`,
  );

  // ② 按压
  const totalPressed = all.reduce((a, s) => a + s.pressed, 0);
  const totalStuck = all.reduce((a, s) => a + s.stuck.length, 0);
  check(
    'press',
    '每个可点元素按下都有位移',
    totalPressed > 0 && totalStuck === 0,
    `${totalPressed - totalStuck}/${totalPressed} 有 transform`,
  );

  // ③ 材质（三个面分散在不同屏：城镇面板 = 木质、普通弹窗 = 羊皮纸、地图提示条 = 铁牌）
  const pick = (k) => all.map((s) => s.material?.[k]).find((x) => x);
  const oak = pick('oak');
  const parch = pick('parch');
  const iron = pick('iron');
  if (oak && parch && iron) {
    const dL = Math.abs(parch.L - oak.L);
    const distinct = dL > 0.3 && (iron.alpha < 1 && iron.blur) !== (oak.alpha < 1 && oak.blur);
    check(
      'material',
      '木质/羊皮纸/铁牌 两两可区分',
      distinct,
      `L 木${oak.L} 纸${parch.L} 铁${iron.L}（ΔL=${dL.toFixed(2)}）；铁 alpha=${iron.alpha} blur=${iron.blur}`,
    );
  } else {
    const miss = [oak ? '' : 'oak', parch ? '' : 'parch', iron ? '' : 'iron'].filter(Boolean).join(',');
    check('material', '木质/羊皮纸/铁牌 两两可区分', false, `取不到：${miss}`);
  }

  // ④ 触摸目标
  const t = all.map((s) => s.touch).find(Boolean);
  check(
    'touch',
    '难度档 ≥ 44×44',
    !!t && t.w >= 44 && t.h >= 44,
    t ? `${t.w}×${t.h}（.${t.parent.split(' ').join('.')} > .${t.cls.split(' ').join('.')}）` : '未找到 .ss-seg-item（开局页没进到？）',
  );

  // ⑤ 英雄栏压字
  const bars = all.flatMap((s) => s.hp).filter(Boolean);
  const bad = bars.filter((b) => b.sw > b.cw + 1);
  check(
    'hpbar',
    '英雄栏 .hp-bar-top 不溢出',
    bars.length > 0 && bad.length === 0,
    bars.length ? `${bars.length} 格，溢出 ${bad.length}（${bars.map((b) => `${b.sw}/${b.cw}`).join(' ')}）` : '英雄栏没打开',
  );

  // ⑥ 羊皮纸层对比度（AA 4.5:1，量的是"换底色之后字还读不读得清"）
  const ct = all.map((s) => s.contrast).find(Boolean);
  if (ct) {
    check(
      'contrast',
      '羊皮纸弹窗文字 ≥ 4.5:1（WCAG AA）',
      ct.min >= 4.5,
      `${ct.n} 条，最低 ${ct.min}:1（${ct.worst.map((w) => `${w.cls}「${w.t}」${w.r}`).join(' · ')}）`,
    );
  } else {
    // 铁律 §3：有对象无可判数据必须红，不能"没测到就算过"
    check('contrast', '羊皮纸弹窗文字 ≥ 4.5:1（WCAG AA）', false, '没取到普通弹窗（点「结束一天」没弹出？）');
  }

  // ⑦ 城镇内容窗不溢出（改前 161/283 = 溢出 122px）
  const tp = all.map((s) => s.townpane).find(Boolean);
  check(
    'townfit',
    '城镇 .town-pane 不溢出（含末两张卡完整可见）',
    !!tp && tp.ch > 0 && tp.sh <= tp.ch + 1 && tp.full === tp.cards,
    tp
      ? `pane ${tp.ch}/${tp.ch}（scroll ${tp.sh}）· ${tp.rows} 行 ${tp.full}/${tp.cards} 张完整可见`
      : '没打开城镇面板（?devtown=1 没进对局？）',
  );

  // ⑦b 造价行去文字化（图标 + 数字；2026-10-27）
  const tc = all.map((s) => s.towncost).find(Boolean);
  check(
    'towncost',
    '城镇造价行只剩「图标 + 数字」（无汉字 · 每枚都挂着可用 <use> · 不裁切 · 库存条 7 枚）',
    !!tc &&
      tc.costs > 0 &&
      tc.cjk === 0 &&
      tc.chipMin >= 1 &&
      tc.iconless === 0 &&
      tc.over === 0 &&
      tc.budget === 7,
    tc
      ? `造价行 ${tc.costs} 条（含汉字 ${tc.cjk}）· 每条最少 ${tc.chipMin} 枚 chip · 无图标 ${tc.iconless} · 裁切 ${tc.over} 行 · 库存 ${tc.budget} 枚`
      : '没量到城镇面板',
  );

  // ⑧ 战斗部队带：没有整块底板 + 卡片随内容长
  const sd = all.map((s) => s.sides).find(Boolean);
  const slab = sd ? sd.filter((c) => c.alpha > 0.05 || c.border > 0) : [];
  const badH = sd ? sd.flatMap((c) => c.rowH.filter((h) => h < 28 || h > 56)) : [];
  const tooTall = sd ? sd.filter((c) => c.painted > c.rows * 56 + 26) : [];
  check(
    'sides',
    '部队带：无整块底板 · 每卡 28~56px · 涂色不撑满整列',
    !!sd && slab.length === 0 && badH.length === 0 && tooTall.length === 0,
    sd
      ? `${sd.length} 列 · 宽 ${sd.map((c) => c.w).join('/')}px · 卡高 ${sd[0].rowH.join(',') || '—'} · 涂色 ${sd.map((c) => c.painted).join('/')}px` +
        (slab.length ? ` · ❌ 仍有底板（alpha ${slab.map((c) => c.alpha).join(',')}）` : '') +
        (badH.length ? ` · ❌ 卡高越界 ${badH.join(',')}` : '') +
        (tooTall.length ? ' · ❌ 撑满整列' : '')
      : '没进战斗（?devbattle=1 没起？）',
  );

  // ⑧ 动作图标：10 个主动作全都得有图标，且 `<use>` 指向真实存在的 symbol
  //    ⚠️ 必须**按屏幕分别判**：如果把各屏加总，"拇指盘有 4 个"会把"战斗 6 个全缺"
  //    掩盖过去（16 ≥ 10 直接绿）。地图屏 ≥4、战斗屏 ≥6，两边分别成立才算。
  const ico = (tag) => all.find((s) => s.tag === tag)?.icons ?? null;
  const im = ico('map');
  const ib = ico('battle');
  const iok = (x, n) =>
    !!x && x.total >= n && x.withIcon >= n && x.missing.length === 0 && x.badRef.length === 0 && x.invisible.length === 0;
  const isym = im?.symbols ?? ib?.symbols ?? 0;
  check(
    'icons',
    '10 个主动作都有可用图标（地图 4 + 战斗 6，无缺/断引用/隐藏）',
    iok(im, 4) && iok(ib, 6) && isym >= 10,
    `地图 ${im ? `${im.withIcon}/${im.total}` : '—'} · 战斗 ${ib ? `${ib.withIcon}/${ib.total}` : '—'} · ${isym} 个 symbol` +
      [im, ib]
        .filter(Boolean)
        .flatMap((x) => [
          ...(x.missing.length ? [`缺：${x.missing.join('、')}`] : []),
          ...(x.badRef.length ? [`断引用：${x.badRef.join('、')}`] : []),
          ...(x.invisible.length ? [`不可见：${x.invisible.slice(0, 3).join('、')}`] : []),
        ])
        .map((t) => ` · ❌ ${t}`)
        .join(''),
  );

  // ⑩ 四角动作簇：贴下角、不压棋盘、不压部队卡（改前右上那组 517×52 正压在棋盘上）
  const hd = all.map((s) => s.hud).find(Boolean);
  check(
    'hudcorners',
    '两组动作簇贴屏幕下角 · 不压棋盘 · 不压部队卡 · 每个仍是 44px 靶',
    !!hd &&
      hd.n === 2 &&
      hd.vsCanvas === 0 &&
      hd.vsRows.every((n) => n === 0) &&
      hd.inView &&
      hd.bottom.every((b) => b >= 0 && b <= 12) &&
      hd.minH >= 44,
    hd
      ? `两簇 底距 ${hd.bottom.join('/')}px · ${hd.count} 个按钮最矮 ${Math.round(hd.minH)}px` +
        (hd.vsCanvas ? ` · ❌ ${hd.vsCanvas} 簇压在棋盘上` : '') +
        (hd.vsRows.some((n) => n > 0) ? ` · ❌ 压住部队卡（${hd.vsRows.join('/')}）` : '') +
        (!hd.inView ? ' · ❌ 出界' : '') +
        (hd.bottom.some((b) => b > 12) ? ' · ❌ 没贴下角' : '') +
        (hd.minH < 44 ? ' · ❌ 有按钮矮于 44px' : '')
      : '没进战斗（?devbattle=1 没起？）',
  );

  // ⑨ 预估伤害：手机上要能看到（hover-only 等于没有）
  const f = all.map((s) => s.forecast).find(Boolean);
  if (!f) {
    check('forecast', '预估伤害在触屏可见且格式正确', false, '没进战斗（?devbattle=1 没起？）');
  } else if (f.fcs === 0) {
    check('forecast', '预估伤害在触屏可见且格式正确', false, '戳了 4 次「等待」仍无可攻击目标 —— 取不到数据');
  } else {
    check(
      'forecast',
      '预估伤害在触屏可见且格式正确',
      f.onOurs === 0 && f.badText.length === 0 && f.invisible === 0,
      `${f.fcs} 张敌军卡有预估（如「伤55 · 杀3」）` +
        (f.onOurs ? ` · ❌ ${f.onOurs} 条挂在我方卡上` : '') +
        (f.badText.length ? ` · ❌ 格式错：${f.badText.slice(0, 2).join('、')}` : '') +
        (f.invisible ? ` · ❌ ${f.invisible} 条不可见（被 display:none 掉了）` : ''),
    );
  }

  // ⑫ 行动队列：胶囊第二行必须**看得见、不被截断、不上棋盘**，且**随出手变化**
  const q = all.map((s) => s.queue).find((x) => x && x.before);
  const qb = q?.before;
  const qa = q?.after;
  const live = q && q.waits > 0 ? !!qa && qa.text !== qb.text : true;
  check(
    'queue',
    '行动队列：看得见 · 名字没被截断 · 不压棋盘 · 随出手变化',
    !!qb &&
      qb.visible &&
      !!qa &&
      qa.visible &&
      !qb.clipped &&
      !qa.clipped &&
      qb.chipRight <= qb.canvasLeft + 24 &&
      qa.chipRight <= qa.canvasLeft + 24 &&
      live,
    qb
      ? `「${qb.text}」→（让 ${q?.waits ?? 0} 次）「${qa?.text ?? '—'}」 · 胶囊右 ${qb.chipRight}/${qb.canvasLeft}(canvas)` +
        (!qb.visible || !qa?.visible ? ' · ❌ 不可见' : '') +
        (qb.clipped || qa?.clipped ? ' · ❌ 名字被截断' : '') +
        (qb.chipRight > qb.canvasLeft + 24 ? ' · ❌ 压到棋盘' : '') +
        (!live ? ' · ❌ 点「等待」后没变化（静态文案）' : '')
      : '没进战斗（?devbattle=1 没起？）',
  );

  return rows.every((r) => r.ok);
}

/* ------------------------------------------------------------------ 主流程 */

async function run() {
  if (!chromeAvailable()) {
    console.error(`找不到 Chrome：${CHROME_PATH}（可用 env CHROME 覆盖）`);
    process.exit(2);
  }
  const probe = await checkDevServer(PORT);
  if (!probe.ok) {
    console.error(probe.reason);
    process.exit(2);
  }

  const base = `http://127.0.0.1:${PORT}/index.html`;
  return withHeadlessChrome(
    async ({ send, evaluate }) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width: VIEW.width,
        height: VIEW.height,
        deviceScaleFactor: VIEW.dpr,
        mobile: true,
      });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

      const all = [];
      const screens = [
        { tag: 'map', url: `${base}?devquick=1&devreveal=1`, needHero: true },
        // 城镇面板 = 木质（.modal.wide）。要单独一屏，否则材质三面凑不齐。
        { tag: 'town', url: `${base}?devquick=1&devtown=1` },
        { tag: 'battle', url: `${base}?devbattle=1` },
        // 羊皮纸（普通弹窗）单独一屏：要真的把弹窗点出来才量得到字色
        { tag: 'modal', url: `${base}?devquick=1&devreveal=1&devreport=1`, needModal: true },
        { tag: 'start', url: `${base}?devstart=1`, needStart: true },
      ];
      for (const s of screens) {
        const m = await measure(send, evaluate, s.url, s);
        all.push({ tag: s.tag, ...m });
      }

      const green = judge(all);
      /* 负向对照（常驻）：`?devtowncost=0` 退回旧的纯文字造价行 ⇒ `towncost` 必须变红。
         没有这一臂，那条判据只能证明"读到了东西"，证明不了它测的是"图标化"。 */
      await send('Page.navigate', { url: `${base}?devquick=1&devtown=1&devtowncost=0` });
      for (let i = 0; i < 120; i++) {
        try {
          if (await evaluate(`!!document.querySelector('.bcard')`)) break;
        } catch {
          /* 导航中 */
        }
        await sleep(100);
      }
      await sleep(1400);
      const tcOld = await evaluate(TOWNCOST);
      const tcOldCards = await evaluate(`document.querySelectorAll('.bcard').length`);
      check(
        'towncost-ctl',
        'devtowncost=0（旧文字表现）下同一判据变红（证它测的是"图标化"）',
        !!tcOld && tcOld.costs === 0 && tcOld.cjkAll > 0,
        tcOld ? `造价行 ${tcOld.costs} 条（应 0）· 状态行含汉字 ${tcOld.cjkAll}（应 >0）· 卡片 ${tcOldCards}` : '没量到',
      );

      /* 第二臂：`?devpoor=1` 把资源压到"买不起" ⇒ 缺项必须走 `.rc.bad`（红）。
         没有这一臂，红色分支永远没人走到 —— 判据只见过"全绿"的造价行。 */
      await send('Page.navigate', { url: `${base}?devquick=1&devtown=1&devpoor=1` });
      for (let i = 0; i < 120; i++) {
        try {
          if (await evaluate(`!!document.querySelector('.bcard')`)) break;
        } catch {
          /* 导航中 */
        }
        await sleep(100);
      }
      await sleep(1200);
      const tcPoor = await evaluate(TOWNCOST);
      check(
        'towncost-bad',
        '买不起时缺项变红（`.rc.bad` · 图标也红）且卡面仍无汉字',
        !!tcPoor && tcPoor.bad > 0 && tcPoor.badIconOk === true && tcPoor.cjk === 0 && tcPoor.over === 0,
        tcPoor
          ? `缺项 ${tcPoor.bad} 枚（图标齐全=${tcPoor.badIconOk}）· 汉字 ${tcPoor.cjk} · 裁切 ${tcPoor.over}`
          : '没量到',
      );


      /* 英雄栏遮挡（2026-10-27）：展开后顶栏与圆盘都不得压在面板上；
         再手动摘掉 body.side-open ⇒ 同一判据必须翻红（证它量的是让位规则，不是"面板没开"）。 */
      await send('Page.navigate', { url: `${base}?devshowcase=1&devprobe=1&devreveal=1` });
      for (let i = 0; i < 120; i++) {
        try {
          if (await evaluate(`!!document.querySelector('#thumb .tb-btn')`)) break;
        } catch {
          /* 导航中 */
        }
        await sleep(100);
      }
      await sleep(1500);
      await evaluate(`(() => { const b=[...document.querySelectorAll('#thumb .tb-btn')].find(x=>/英雄/.test(x.textContent||'')); if(b) b.click(); return 1; })()`);
      await sleep(600);
      const sideA = await evaluate(SIDECLEAR);
      check(
        'sideclear',
        '英雄栏展开时 · 顶栏与拇指盘都不压在面板上（顶栏的毛玻璃会把面板头糊掉）',
        !!sideA && sideA.open === true && sideA.overlapTop === false && sideA.overlapThumb === false,
        sideA
          ? `面板 x${sideA.side.x}..${sideA.side.x + sideA.side.w} · 顶栏右 ${sideA.topbar.x + sideA.topbar.w} · 圆盘右 ${sideA.thumb.x + sideA.thumb.w} · 相交 顶栏=${sideA.overlapTop} 圆盘=${sideA.overlapThumb}`
          : '没量到',
      );
      await evaluate(`document.body.classList.remove('side-open')`);
      await sleep(300);
      const sideB = await evaluate(SIDECLEAR);
      check(
        'sideclear-ctl',
        '摘掉 body.side-open ⇒ 同一判据翻红（证它量的是让位规则，不是"面板没开"）',
        !!sideB && sideB.open === true && (sideB.overlapTop === true || sideB.overlapThumb === true),
        sideB ? `相交 顶栏=${sideB.overlapTop} 圆盘=${sideB.overlapThumb}` : '没量到',
      );

      /* ⚠️ 必须放在 `judge()` **之后**：judge 第一行是 `rows.length = 0`，
         之前加进去的对照行会被清掉（本轮就这么丢过一次，日志里少了一条还以为没跑）。 */
      if (AS_JSON) {
        console.log(JSON.stringify({ green, rows, screens: all.map(({ tag, sizes, material, touch, hp, contrast, townpane, sides, hud, icons, forecast, pressed }) => ({ tag, sizes, material, touch, hp, contrast, townpane, sides, hud, pressed })) }, null, 2));
      } else {
        for (const r of rows) {
          console.log(`${r.ok ? '✅' : '❌'} [${r.id}] ${r.label} — ${r.detail}`);
        }
        for (const s of all) {
          console.log(`   · ${s.tag}: 字号 ${s.sizes.map((x) => `${x.px}px×${x.count}`).join(' ')} · 按压 ${s.pressed - s.stuck.length}/${s.pressed}`);
        }
      }
      return green;
    },
    { devServerPort: PORT, profilePrefix: 'uip0-' },
  );
}

(async () => {
  if (SELFCHECK) {
    // 负向对照：每次注入一条，闸必须变红
    let bad = 0;
    for (const which of ['press', 'type', 'material', 'touch', 'hpbar', 'contrast', 'townfit', 'sides', 'icons', 'forecast', 'hud', 'queue']) {
      INJECT = which;
      const green = await run();
      const ok = green === false;
      console.log(`${ok ? '✅' : '❌'} 负向对照 --inject=${which} → 闸${green === false ? '变红' : '仍绿（闸失效）'}`);
      if (!ok) bad++;
    }
    process.exit(bad ? 1 : 0);
  }
  const green = await run();
  process.exit(green ? 0 : 1);
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(e.prerequisite ? 2 : 1);
});
