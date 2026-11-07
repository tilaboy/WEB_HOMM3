#!/usr/bin/env node
/**
 * card.mjs —— 战斗兵牌（S2 · 立绘 43×37 / 行高 48 / 牌上无文字）的机检（`npm run probe:card`）。
 *
 * ## 它守什么（§16.9④ 决策 27 + 2026-11-01 主理人两次裁定）
 *   ① 立绘盒 **43×37**、牌高 **48**、**牌上不写名字也不写数量**（两者都只在
 *      `title` / `aria-label` / 详情卡里）、血条 **3px 通栏贴底**；
 *   ② **保持体型**：立绘的宽高比不许偏离战斗帧 —— 但**两种立绘用两把尺子**
 *      （2026-11-06 起分家，理由见下）：
 *        · 直画的族（`BODY_PLAN` 收录）漂移 ≤ **35%**：直画时 2px 的眼/腿、1px 的描边
 *          都是不可再分的整数，12px 高的矮兵天生胖一圈（+15~32%）。次序不翻转的
 *          那条在 `audit:bodyplan` [3] 里量（那边有族内全表）；
 *        · 缩图的族（S3c 后只剩 p4 与中立怪）仍 ≤ **15%**：等比缩必然保持宽高比，
 *          任何偏差都只能是拉伸。
 *      （拉伸填满盒子会让每个兵都变成同一个比例 —— 这条判据就是为了抓那件事）；
 *   ③ 牌面**唯一的**文字是按需出现的预估行（`.fc`），它必须 ≥12px 且墨迹 ≥7.5px；
 *   ④ 详情卡唯一：连点两支不同部队，可见的属性牌**始终 ≤1**（旧的被替换，不是叠加）；
 *   ⑤ 5 栈装不下时**看得出来还能拨**：`.more` + 底部箭头都在（矮机标题被隐藏，
 *      箭头是那里唯一活着的提示）。
 *
 * ## 为什么 ① 要放进机检
 * 48px 这条被 `flex-shrink` 悄悄压成 42.8 过一次（`.bt-side-list` 是 flex 列，
 * 余高装不下 3×48）—— 屏幕上"看起来还行"，只有量 rect 才发现
 * 立绘上下贴边、血条被挤。尺寸判据必须量 **getBoundingClientRect**，不能量 CSS 声明。
 *
 * ## ② 为什么从像素反推
 * 让 `buildPortraitFrame` 自报"我保持了比例"是在让被判者写判据。这里重新
 * 量**源帧**与**成品**各自的剪影 bbox —— 两者都由像素算出，脚本里没有
 * 任何一个 43/37 以外的期望值参与这一条。
 *
 * ## 负向对照（每次都跑）
 * 把"按盒子比例拉伸"当成一个假想实现，算它的宽高比误差：**必须 ≥15%**。
 * 若某天它掉到 15% 以下，说明这批兵的剪影本来就接近盒子比例 ⇒ 这条判据
 * 对"拉伸"失去分辨力，应当换判据而不是继续报绿。
 *
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足
 */
import { distDir, distUrl, printHeader, requireFile, freePort, serveInProcess } from '../_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from '../_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=card');
requireFile(DIST, 'main.js');

const { UNIT_FRAMES, buildB0Frame, buildPortraitFrame, PORTRAIT_W, PORTRAIT_H } = await import(
  distUrl('render/unitArt.js', DIST)
);
const { FRAME_ALIAS, unitPortraitFrame, portraitOfCombatFrame } = await import(
  distUrl('render/unitFrames.js', DIST)
);
const { hasBodyPlan } = await import(distUrl('render/unitBodyPlan.js', DIST));

let bad = 0;
const PASS = (c, m) => {
  if (!c) bad++;
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`);
};

/* ==========================================================================
 * A. 像素侧（纯 Node，不需要浏览器）
 * ========================================================================== */

/** 剪影 bbox（含 alpha>8）。返回宽高（像素数）。 */
function bbox(pb) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < pb.h; y++) {
    for (let x = 0; x < pb.w; x++) {
      if (pb.alphaAt(x, y) <= 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < x0 ? { w: 0, h: 0 } : { w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const IDLE = UNIT_FRAMES.filter((f) => f.kind === 'idle');
const ROSTER = Object.keys(FRAME_ALIAS); // 20 个新 id
console.log(`\n── A. 立绘帧（${IDLE.length} 个战斗单位 = 20 正编 + 3 中立野怪）──`);

PASS(PORTRAIT_W === 43 && PORTRAIT_H === 37, `① 盒子常量就是 43×37（${PORTRAIT_W}×${PORTRAIT_H}）`);

const boxes = IDLE.map((spec) => {
  const pb = buildPortraitFrame(spec.name);
  return { name: spec.name, w: pb.w, h: pb.h };
});
const wrongBox = boxes.filter((b) => b.w !== PORTRAIT_W || b.h !== PORTRAIT_H);
PASS(
  wrongBox.length === 0,
  `② ${boxes.length} 帧全部 43×37`,
  wrongBox.map((b) => `${b.name}=${b.w}×${b.h}`).join(','),
);

/* 覆盖率：20 个正编 id 都要能解析到一个真的画出来的帧名 */
const frames = new Set(IDLE.map((s) => portraitOfCombatFrame(s.name)));
const missId = ROSTER.filter((id) => !frames.has(unitPortraitFrame(id)));
PASS(missId.length === 0, `③ 20 个正编 id 全部有立绘帧`, missId.join(','));

/* 宽高比：源帧（带描边，与战场同口径）vs 立绘（带描边）。
 * 容差按**立绘的画法**分两档 —— 直画的族吃像素下限，缩图的族不吃（见文件头 ②）。 */
const TOL_DIRECT = 0.35;
const TOL_SCALED = 0.15;
const rows = IDLE.map((spec) => {
  const src = buildB0Frame(spec.name);
  const pt = buildPortraitFrame(spec.name);
  const a = bbox(src);
  const b = bbox(pt);
  const arSrc = a.w / a.h;
  const arPt = b.w / b.h;
  const direct = hasBodyPlan(spec.unit);
  const tol = direct ? TOL_DIRECT : TOL_SCALED;
  return { name: spec.name, arSrc, arPt, err: Math.abs(arPt / arSrc - 1), tol, direct, src: a, pt: b };
});
const worst = rows.slice().sort((x, y) => y.err - x.err)[0];
const overTol = rows.filter((r) => r.err > r.tol);
const nDirect = rows.filter((r) => r.direct).length;
PASS(
  overTol.length === 0,
  `④ ${rows.length} 帧的剪影宽高比误差在档内（直画 ${nDirect} 帧 ≤${TOL_DIRECT * 100}% / 缩图 ${rows.length - nDirect} 帧 ≤${TOL_SCALED * 100}%；最大 ${(worst.err * 100).toFixed(1)}% · ${worst.name} ${worst.src.w}×${worst.src.h}→${worst.pt.w}×${worst.pt.h}）`,
  overTol.map((r) => `${r.name} ${(r.err * 100).toFixed(1)}% > ${r.tol * 100}%`).join(','),
);

/* 剪影不出盒（含 1px 描边后仍要留白 0~1px，不许被裁） */
const clipped = rows.filter((r) => r.pt.w > PORTRAIT_W || r.pt.h > PORTRAIT_H);
PASS(clipped.length === 0, `⑤ 立绘剪影没有溢出盒子`, clipped.map((r) => r.name).join(','));

/* 负向对照：按盒子比例拉伸的假想实现 */
const stretched = rows.map((r) => Math.abs((PORTRAIT_W - 2) / (PORTRAIT_H - 2) / r.arSrc - 1));
const stretchMax = Math.max(...stretched);
// 拉伸必须连**最宽的那把尺子**（直画 35%）都过不去，否则这条判据对拉伸就瞎了
PASS(
  stretchMax > TOL_DIRECT,
  `⑥ 负向对照：按盒子比例拉伸时误差 ${(stretchMax * 100).toFixed(1)}% > ${TOL_DIRECT * 100}%（这条判据抓得住拉伸）`,
);

/* 描边：最外一圈必须是 ink0（#2a1a12），且正下方/右方一像素内不再是"纯透明" */
const INK = '#2a1a12';
const hexAt = (pb, x, y) => {
  const p = pb.px(x, y);
  return p[3] > 8 ? `#${((1 << 24) | (p[0] << 16) | (p[1] << 8) | p[2]).toString(16).slice(1)}` : '';
};
let ringBad = 0;
const ringDetail = [];
for (const spec of IDLE) {
  const pb = buildPortraitFrame(spec.name);
  const b = bbox(pb);
  if (!b.w) continue;
  // 取剪影最左列的中点行：那一列必须整列是描边色（1px 单线的外缘）
  const y = Math.round((pb.h - 1) / 2);
  let left = -1;
  for (let x = 0; x < pb.w; x++) if (pb.alphaAt(x, y) > 8) { left = x; break; }
  if (left >= 0 && hexAt(pb, left, y) !== INK) {
    ringBad++;
    if (ringDetail.length < 4) ringDetail.push(`${spec.name}@(${left},${y})=${hexAt(pb, left, y)}`);
  }
}
// 只有"中线行确实经过剪影"的帧才参与；提灯/长枪那类中线上可能是武器本体而非外缘，
// 所以这条只作**提示级**：数量 ≤2 视为正常，>2 才 FAIL（避免把美术差异判成 bug）。
PASS(ringBad <= 2, `⑦ 立绘外缘是 1px 描边（中线行取样不合格 ${ringBad}/${IDLE.length}）`, ringDetail.join(','));

/* ==========================================================================
 * B. DOM 侧（792×320 @DPR3，真机视口）
 * ========================================================================== */

if (!chromeAvailable()) {
  console.error('✗ 前置不满足：找不到 Chrome（可用 env CHROME 覆盖）。');
  process.exit(2);
}
const PORT = await freePort();
if (!(await serveInProcess(DIST, PORT))) {
  console.error(`✗ 前置不满足：自起 dev server 未就绪（port ${PORT}）。`);
  process.exit(2);
}
const BASE = `http://127.0.0.1:${PORT}/?quick=0`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MEASURE = `(() => {
  const rows = [...document.querySelectorAll('.bt-side-row')];
  const cards = rows.map((r) => {
    const b = r.getBoundingClientRect();
    const pt = r.querySelector('.pt');
    const fc = r.querySelector('.fc');
    const bar = r.querySelector('.bt-side-bar');
    const n = r.querySelector('.n');
    const q = r.querySelector('.q');
    const pb = pt ? pt.getBoundingClientRect() : null;
    const fb = fc ? fc.getBoundingClientRect() : null;
    const bb = bar ? bar.getBoundingClientRect() : null;
    return {
      h: +b.height.toFixed(2), right: b.right, bottom: b.bottom,
      hasFc: r.classList.contains('has-fc'),
      ptW: pb ? +pb.width.toFixed(2) : 0, ptH: pb ? +pb.height.toFixed(2) : 0,
      ptBg: pt ? getComputedStyle(pt).backgroundSize : '',
      ptImg: pt ? getComputedStyle(pt).imageRendering : '',
      nExists: !!n,
      qExists: !!q,
      aria: r.getAttribute('aria-label') || '',
      txt: (r.textContent || '').trim(),
      cardW: +b.width.toFixed(2),
      fcTxt: fc ? fc.textContent : '',
      fcSize: fc ? parseFloat(getComputedStyle(fc).fontSize) : 0,
      fcW: fb ? +fb.width.toFixed(2) : 0,
      fcBottom: fb ? fb.bottom : 0,
      barH: bb ? +bb.height.toFixed(2) : 0,
      barTop: bb ? bb.top : 0,
      barBottom: bb ? bb.bottom : 0,
      barLeft: bb ? bb.left : 0,
      barRight: bb ? bb.right : 0,
      cardLeft: b.left,
      cardRight: b.right,
    };
  });
  const col = document.querySelector('.bt-side');
  const list = col && col.querySelector('.bt-side-list');
  const arrow = col && col.querySelector('.bt-side-more');
  return {
    cards,
    more: col ? col.classList.contains('more') : null,
    listTop: list ? list.getBoundingClientRect().top : 0,
    listH: list ? list.clientHeight : 0,
    scrollH: list ? list.scrollHeight : 0,
    arrowOp: arrow ? parseFloat(getComputedStyle(arrow).opacity) : 0,
    arrowH: arrow ? arrow.getBoundingClientRect().height : 0,
    tips: [...document.querySelectorAll('.bt-tip')].filter((e) => getComputedStyle(e).display !== 'none').length,
  };
})()`;

/** 用页面自己的字体量预估行（`.fc`）的字形高（actualBoundingBox 是墨迹框，不是 line-height）。 */
const GLYPH = `(() => {
  const fc = document.querySelector('.bt-side-row .fc');
  if (!fc) return null;
  const cs = getComputedStyle(fc);
  // ⚠️ 不能读 cs.font（getComputedStyle().font 在这个 Chrome 上返回空串），
  // 要自己拼 —— 拼错了量到的是 canvas 默认的 10px sans-serif（实测 7.2px，假红）。
  const font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = font;
  const m = ctx.measureText(fc.textContent || '伤12');
  const d = ctx.measureText('0');
  return {
    font,
    inkH: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
    digitH: d.actualBoundingBoxAscent + d.actualBoundingBoxDescent,
  };
})()`;

let browserOk = false;
try {
  await withHeadlessChrome(
    async ({ send, evaluate }) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width: 792,
        height: 320,
        deviceScaleFactor: 3,
        mobile: true,
      });
      /**
       * 触屏臂：`setTouchEmulationEnabled` 会让 `matchMedia('(hover: none)')` 变 true
       * ⇒ `HOVERLESS` 分支生效。**必须开**：桌面分支点一下不弹牌（弹牌挂在 hover 1s
       * 或右键上），不开就量不到"点开详情卡"这条 —— 首版就是这么量出 0/0 的假红。
       */
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

      async function open(qs) {
        await send('Page.navigate', { url: BASE + qs });
        for (let i = 0; i < 60; i++) {
          await sleep(200);
          try {
            if (await evaluate(`!!document.querySelector('.bt-side-row .pt')`)) return true;
          } catch {
            /* 导航中 */
          }
        }
        return false;
      }

      const ready = await open('&devbattle=full&devprobe=1&devseed=20260913');
      if (!ready) {
        console.error('✗ 前置不满足：战斗屏没起来（?devbattle=full）');
        return;
      }
      await sleep(400);
      browserOk = true;

      /**
       * 先把预估行（`.fc`）召出来，再量尺寸。
       *
       * `.fc` 只在"玩家回合 + 这支部队够得着敌人"时出现，而开局第一支（seed 20260913
       * 下是鹰）周围没有目标 ⇒ 直接量会量到 0 张，⑭ᶜ/⑭ᵈ/⑰ 全部变成假绿。
       * 办法与 `uip0probe` 同一套：按玩家方式点「等待」把行动权让给下一支，直到有目标。
       */
      const CLICK_WAIT = `(() => {
        const b = [...document.querySelectorAll('.bt-actions .btn, .bt-head-actions .btn')].find((x) => /等待/.test(x.textContent || ''));
        if (!b || b.disabled) return false;
        b.click();
        return true;
      })()`;
      let fcWaits = 0;
      for (let i = 0; i < 10; i++) {
        const has = await evaluate(`!!document.querySelector('.bt-side-row.has-fc')`);
        if (has) break;
        if (!(await evaluate(CLICK_WAIT))) break;
        fcWaits++;
        await sleep(1800);
      }
      if (fcWaits) console.log(`（点了 ${fcWaits} 次「等待」把预估行召出来）`);

      const m = await evaluate(MEASURE);
      const base = m.cards.filter((c) => !c.hasFc);
      const fc = m.cards.filter((c) => c.hasFc);
      console.log(
        `\n── B. 兵牌 DOM（${m.cards.length} 张 · 列 ${m.listH}px / 内容 ${m.scrollH}px · more=${m.more}）──`,
      );

      const badH = base.filter((c) => Math.abs(c.h - 48) > 0.5);
      PASS(badH.length === 0, `⑧ 行高 48px（${base.length} 张常驻卡）`, badH.map((c) => c.h).join(','));
      const badFc = fc.filter((c) => c.h < 48 || c.h > 68);
      PASS(badFc.length === 0, `⑨ 带预估行的卡 48~68px（${fc.length} 张）`, badFc.map((c) => c.h).join(','));

      const badPt = m.cards.filter((c) => c.ptW !== 43 || c.ptH !== 37);
      PASS(badPt.length === 0, `⑩ 立绘盒 43×37（量 rect）`, badPt.slice(0, 4).map((c) => `${c.ptW}×${c.ptH}`).join(','));
      const badBg = m.cards.filter((c) => c.ptBg !== '43px 37px');
      PASS(badBg.length === 0, `⑪ 立绘按 1:1 铺满盒子（background-size 43px 37px）`, badBg.slice(0, 3).map((c) => c.ptBg).join(','));
      const badImg = m.cards.filter((c) => !/pixelated|crisp-edges/.test(c.ptImg));
      PASS(badImg.length === 0, `⑫ 立绘不做小数插值（image-rendering=${m.cards[0]?.ptImg}）`, badImg.length ? `${badImg.length} 张不是 pixelated` : '');

      /* ⑬ 牌面上**不写名字也不写数量**（2026-11-01 主理人两次裁定）：
       *   · 名字在 22×30 时代是"认人"的唯一依靠，立绘放到 43×37 后它只剩确认作用；
       *   · 数量在战场单位脚下已经有读数，兵牌再写一遍就是第二个需要同步的数字。
       * 这条同时挡住三种退化：把名字/数量加回来（会把 43px 立绘挤回 22px）、
       * 立绘缺帧只剩文字牌、以及"牌面空白但 DOM 里藏着 .n/.q 没人看得见"。 */
      const withName = m.cards.filter((c) => c.nExists);
      PASS(withName.length === 0, `⑬ 牌面无名字元素（${m.cards.length} 张）`, withName.length ? `${withName.length} 张还挂着 .n` : '');
      const withQ = m.cards.filter((c) => c.qExists);
      PASS(withQ.length === 0, `⑬ᵇ 牌面无数量元素（不重复战场脚下的读数）`, withQ.length ? `${withQ.length} 张还挂着 .q` : '');

      /* ⑭ 牌面唯一允许的常驻文字是**按需出现**的预估行 `.fc`。
       * 没有 `.fc` 的卡必须一个字符都没有（textContent 为空）。 */
      const plain = m.cards.filter((c) => !c.hasFc);
      const dirty = plain.filter((c) => c.txt !== '');
      PASS(
        dirty.length === 0,
        `⑭ 无预估行的牌面零文字（${plain.length} 张）`,
        dirty.slice(0, 3).map((c) => `「${c.txt}」`).join(','),
      );
      /* ⑭ᵇ 名字不能真丢：hover / 读屏仍要拿到（`title` + `aria-label`）。 */
      const noName = m.cards.filter((c) => !/^.+ ×\d+$/.test(c.aria));
      PASS(noName.length === 0, `⑭ᵇ 名字挂在 aria-label 上（如「${m.cards[0]?.aria}」）`, noName.slice(0, 3).map((c) => `「${c.aria}」`).join(','));
      /* ⑭ᶜ 预估行是牌上唯一的字，所以它的字号就是"牌面字号"：
       * 必须 ≥12px（四档字阶的地板）且不超出卡宽。 */
      const fcCards = m.cards.filter((c) => c.hasFc);
      const badFcSize = fcCards.filter((c) => c.fcSize < 12);
      PASS(
        badFcSize.length === 0,
        `⑭ᶜ 预估行 ≥12px（${fcCards.length} 张 · ${fcCards[0]?.fcSize ?? '—'}px）`,
        badFcSize.map((c) => c.fcSize).join(','),
      );
      const wideFc = fcCards.filter((c) => c.fcW > c.cardW - 8);
      PASS(wideFc.length === 0, `⑭ᵈ 预估行不超出卡宽（最宽 ${Math.max(0, ...fcCards.map((c) => c.fcW))}px / 卡 ${m.cards[0]?.cardW}px）`, wideFc.map((c) => c.fcW).join(','));

      /* 血条**贴卡底**。3px 的满血条紧贴名字会被读成"标题下划线"（6× 目视里就是
       * 一条实线），贴到卡底边才只剩"这张卡的基线"这一种读法，和 H3 的兵牌一致。 */
      const offBottom = m.cards.filter((c) => Math.abs(c.bottom - c.barBottom) > 0.6);
      PASS(
        offBottom.length === 0,
        `⑮ 血条贴在卡底边（离底 ${(m.cards[0]?.bottom - m.cards[0]?.barBottom).toFixed(2)}px）`,
        offBottom.slice(0, 3).map((c) => (c.bottom - c.barBottom).toFixed(2)).join(','),
      );

      const badBar = m.cards.filter((c) => c.barH !== 3);
      PASS(badBar.length === 0, `⑯ 血条 3px`, badBar.map((c) => c.barH).join(','));

      /* 「通栏」= 条的两端要顶到卡边。abspos 子元素在 grid 卡里按**内容盒**定位，
       * 差一点就成"悬在中间的一根短条"（实测左右各短 7/6px）—— 只量高度量不出来。 */
      const narrow = m.cards.filter(
        (c) => Math.abs(c.barLeft - c.cardLeft) > 0.6 || Math.abs(c.cardRight - c.barRight) > 0.6,
      );
      PASS(
        narrow.length === 0,
        `⑯ᵇ 血条**通栏**（左右误差 ${(m.cards[0]?.barLeft - m.cards[0]?.cardLeft).toFixed(2)} / ${(m.cards[0]?.cardRight - m.cards[0]?.barRight).toFixed(2)}px）`,
        narrow.slice(0, 3).map((c) => `${(c.barLeft - c.cardLeft).toFixed(1)}/${(c.cardRight - c.barRight).toFixed(1)}`).join(','),
      );

      const g = await evaluate(GLYPH);
      PASS(
        !!g && g.digitH >= 7.5,
        `⑰ 预估行数字墨迹 ≥7.5px（实测 ${g ? g.digitH.toFixed(1) : '—'}px · 整串 ${g ? g.inkH.toFixed(1) : '—'}px）`,
      );

      PASS(
        m.more === true && m.arrowOp > 0.5 && m.arrowH > 0,
        `⑱ 装不下时必须看得出来（more=${m.more} · 箭头 opacity=${m.arrowOp}）`,
        m.more && m.arrowOp <= 0.5 ? '溢出却没有箭头' : '',
      );

      /* 详情卡唯一：连点两支**不同**的我方部队 ——
       *   · 每一次都只能看到 1 张牌（可见 .bt-tip 计数）；
       *   · 第二张牌的内容必须换成第二支（旧牌被替换，而不是两张叠着）；
       *   · 两次都必须真的弹出来（否则"≤1"会被"一张都没有"满足 —— 假绿）。 */
      const scene = await evaluate(`(() => {
        const s = window.__battleScene || {};
        const cv = document.querySelector('.bt-canvas').getBoundingClientRect();
        return {
          baseW: s.baseW, baseH: s.baseH, pad: s.pad,
          box: { l: cv.left, t: cv.top, w: cv.width, h: cv.height },
          units: (s.units || []).filter((u) => u.side === 0).slice(0, 2).map((u) => ({ id: u.id, fx: u.fx, fy: u.fy, name: u.name })),
        };
      })()`);
      if (!scene || !scene.baseW || scene.units.length < 2) {
        PASS(false, `⑲ 详情卡唯一：__battleScene 没给出两支我方部队（构建过期？）`);
      } else {
        const tap = async (u) => {
          const x = scene.box.l + (u.fx + scene.pad) * (scene.box.w / scene.baseW);
          const y = scene.box.t + (u.fy + scene.pad) * (scene.box.h / scene.baseH);
          await evaluate(`(() => { document.querySelector('.bt-canvas')
            .dispatchEvent(new MouseEvent('click', { clientX: ${x}, clientY: ${y}, bubbles: true })); return true; })()`);
          await sleep(180);
          return evaluate(`(() => {
            const vis = [...document.querySelectorAll('.bt-tip')].filter((e) => getComputedStyle(e).display !== 'none');
            return { n: vis.length, head: vis.length ? (vis[0].textContent || '').split('\\n')[0] : '' };
          })()`);
        };
        const a = await tap(scene.units[0]);
        const b = await tap(scene.units[1]);
        PASS(
          a.n === 1 && b.n === 1 && !!a.head && !!b.head && a.head !== b.head,
          `⑲ 详情卡唯一：连点两支后始终 1 张，且换成了后者（${a.n}/${b.n} · 「${a.head}」→「${b.head}」）`,
          `两支部队：${scene.units.map((u) => u.name).join('、')}`,
        );
      }

      /* 第二臂：3 栈的小队（devbattle=1）—— 同一套尺寸判据不能只在满编时成立 */
      const ok2 = await open('&devbattle=1&devseed=20260913');
      if (ok2) {
        await sleep(300);
        const m2 = await evaluate(MEASURE);
        const b2 = m2.cards.filter((c) => !c.hasFc);
        const bad2 = b2.filter((c) => Math.abs(c.h - 48) > 0.5 || c.ptW !== 43 || c.ptH !== 37);
        PASS(
          bad2.length === 0,
          `⑳ 3 栈时同样 48 / 43×37（${b2.length} 张）`,
          bad2.map((c) => `${c.h}/${c.ptW}×${c.ptH}`).join(','),
        );
      } else {
        PASS(false, '⑳ 3 栈臂没起来（?devbattle=1）');
      }
    },
    { devServerPort: PORT },
  );
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message}`);
  process.exit(2);
}

if (!browserOk) process.exit(2);

console.log('---------------------------------------------');
console.log(bad === 0 ? '[总结] 全过' : `[总结] FAIL ${bad} 条`);
process.exit(bad === 0 ? 0 : 1);
