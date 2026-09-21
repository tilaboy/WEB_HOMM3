#!/usr/bin/env node
/**
 * 图集容量审计（#24）
 * ==========================================================================
 * 用法：
 *   npm run build && npm run audit:atlas
 *   node tools/atlasaudit.mjs --rows        额外逐行打印落点（人工复核排布）
 *
 * 为什么需要它：
 *   两张图集都是**行式打包**（放不下就换行，行高取本行最高帧，行间 2px），
 *   而 `Packer.place` / `Shelf.place` 只管画，**从不检查纵向溢出** ——
 *   一旦帧数超过画布高度，`drawImage` 会静默画到画布外面：不报错、不白屏，
 *   只是那些精灵凭空消失（战斗里表现为"某些兵种不显示"）。
 *   加帧（B1 的 24 个地图帧 + 18 个 cu_* 战斗帧）越多越接近这个悬崖，
 *   所以它必须变成**能失败的自动断言**，而不是靠人记着算。
 *
 * 尺子一致：
 *   换行规则只有一份实现 `shelfAdvance`（src/render/atlas.ts），运行时与这里
 *   的复算共用；审计不会和运行时跑偏。
 *
 * 分辨力自检（每次运行都做）：
 *   把同一批帧丢进 256×256 的迷你画布复算，**必须报越界**。
 *   如果不报，说明断言已经失去分辨力 —— 直接 FAIL，避免"永远绿"的假守卫。
 *
 * 零新增依赖：只用到 node 内建 + 一份最小 canvas/DOM 垫片。
 */

import { distDir, distUrl, printHeader } from './_dist.mjs';

/* `--dist=<dir>`（缺省 `<repo>/dist` = 旧 `../dist`，**逐字不变**）—— team-lead #164。 */
const DIST = distDir();
printHeader(DIST, 'gate=atlasaudit');
const u = (rel) => distUrl(rel, DIST);

/* ---------------- 最小 DOM 垫片 ---------------- */
/* 图集只为打包几何而建：ctx 的绘制操作全是空实现，落点才是我们要量的东西。 */

class StubCtx {
  constructor(canvas) {
    this.canvas = canvas;
    this.imageSmoothingEnabled = true;
  }
  drawImage() {}
  putImageData() {}
  getImageData(x, y, w, h) {
    return new globalThis.ImageData(new Uint8ClampedArray(w * h * 4), w, h);
  }
  fillRect() {}
  clearRect() {}
  save() {}
  restore() {}
  translate() {}
  scale() {}
}

class StubCanvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.style = {};
    this._ctx = new StubCtx(this);
  }
  getContext() {
    return this._ctx;
  }
  toDataURL() {
    return '';
  }
}

globalThis.ImageData = class ImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
};
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error(`图集探针只垫了 canvas，遇到 <${tag}>`);
    return new StubCanvas();
  },
};

/* ---------------- 载入被测对象 ---------------- */

let Atlas;
let CombatAtlas;
let shelfPack;
try {
  ({ Atlas } = await import(u('render/atlas.js')));
  ({ CombatAtlas } = await import(u('render/combatAtlas.js')));
  ({ shelfPack } = await import(u('render/atlas.js')));
} catch (e) {
  console.error('载入 dist/ 失败 —— 先跑 `npm run build`（dist/ 不入库）。');
  console.error(String(e && e.message));
  process.exit(2);
}

/* ---------------- 断言框架 ---------------- */

let bad = 0;
const T = (ok) => (ok ? 'PASS' : 'FAIL');
function assert(ok, label, detail = '') {
  if (!ok) bad++;
  console.log(`[${T(ok)}] ${label}${detail ? `（${detail}）` : ''}`);
  return ok;
}

const pct = (a, b) => `${((a / b) * 100).toFixed(1)}%`;

/** 还能往里塞多少个 w×h 的帧（按当前行式打包规则推）。 */
function headroom(m, fw, fh) {
  const perRow = Math.floor((m.w + 2) / (fw + 2));
  const rowsLeft = Math.floor((m.h - m.usedH - 2 - fh) / (fh + 2)) + 1;
  return Math.max(0, perRow * Math.max(0, rowsLeft));
}

function report(label, m, growW, growH, growName) {
  console.log(`\n── ${label} ──`);
  console.log(`   画布 ${m.w}×${m.h} · ${m.items.length} 帧 · ${m.rows} 行`);
  console.log(
    `   最宽行 ${m.maxRowW}/${m.w} = ${pct(m.maxRowW, m.w)} · ` +
      `纵向占用 ${m.usedH}/${m.h} = ${pct(m.usedH, m.h)} · ` +
      `面积占用 ${pct(m.usedPx, m.w * m.h)}`,
  );
  const slot = headroom(m, growW, growH);
  console.log(`   余量：纵向还剩 ${m.h - m.usedH}px；按 ${growW}×${growH} 计还能塞约 ${slot} 个${growName}`);
  const tight = m.usedH / m.h > 0.8 || slot < 8;
  if (tight) console.log(`   [WARN] 余量已不足 —— 下次加帧前先重跑本审计`);
  assert(m.overflow.length === 0, `${label} 无越界帧`, `越界 ${m.overflow.length}`);
  assert(m.usedH <= m.h, `${label} 纵向装得下`, `${m.usedH} ≤ ${m.h}`);
  assert(m.maxRowW <= m.w, `${label} 横向装得下`, `${m.maxRowW} ≤ ${m.w}`);
  // 尺子一致性：运行时逐帧画的落点，必须和纯函数复算出的落点逐个相同。
  // 有人绕过 shelfAdvance 直接改 Packer/Shelf 的换行，这里立刻变红。
  const re = shelfPack(
    m.items.map((i) => ({ name: i.name, w: i.w, h: i.h })),
    m.w,
    m.h,
  );
  let diff = 0;
  for (let k = 0; k < m.items.length; k++) {
    const a = m.items[k];
    const b = re.items[k];
    if (!b || a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h) diff++;
  }
  assert(diff === 0, `${label} 落点与纯函数复算一致（尺子同源）`, `偏差 ${diff} 帧`);
  if (m.overflow.length) {
    for (const it of m.overflow.slice(0, 5)) {
      console.log(`          ↳ ${it.name} @(${it.x},${it.y}) ${it.w}×${it.h}`);
    }
  }
}

/* ---------------- 主流程 ---------------- */

const adv = Atlas.build().metrics;
const bat = CombatAtlas.build().metrics;

console.log('图集容量审计（#24）—— 冒险 Packer(2048,2048) / 战斗 Shelf(1024,512)');

report('冒险图集', adv, 52, 44, '地图兵种帧(52×44)');
report('战斗图集', bat, 64, 56, '战斗兵种帧(64×56)');

/* ---- 分辨力自检：把同一批帧塞进 256×256，必须报越界 ---- */
console.log('\n── 分辨力自检（断言必须还能变红）──');
for (const [label, m] of [
  ['冒险图集', adv],
  ['战斗图集', bat],
]) {
  const tiny = shelfPack(
    m.items.map((i) => ({ name: i.name, w: i.w, h: i.h })),
    256,
    256,
  );
  assert(tiny.overflow.length > 0, `${label} 缩到 256×256 时越界断言会响`, `报 ${tiny.overflow.length} 帧越界`);
}

/* ---- 信息：B1 批加进来的帧到底在不在图集里 ---- */
const advB1 = adv.items.filter((i) => i.name.endsWith('_map')).length;
const batB1 = bat.items.filter((i) => i.name.startsWith('cu_')).length;
console.log(`\n[信息] 冒险图集 u_*_map 帧 ${advB1} 个 · 战斗图集 cu_* 帧 ${batB1} 个`);

const argv = process.argv.slice(2);
if (argv.includes('--rows')) {
  for (const [label, m] of [
    ['冒险', adv],
    ['战斗', bat],
  ]) {
    console.log(`\n${label} 图集逐行：`);
    const byRow = new Map();
    for (const it of m.items) {
      if (!byRow.has(it.y)) byRow.set(it.y, []);
      byRow.get(it.y).push(it);
    }
    for (const [y, row] of byRow) {
      const end = Math.max(...row.map((i) => i.x + i.w));
      console.log(`  y=${String(y).padStart(4)} 宽 ${String(end).padStart(4)}  ${row.length} 帧  首个 ${row[0].name}`);
    }
  }
}

console.log(
  bad === 0
    ? '\n全部通过：两张图集都装得下，且容量断言具备分辨力'
    : `\n${bad} 项不合格 —— 图集尺寸是设计常量，装不下请报主理人裁定，别就地改大`,
);
process.exit(bad === 0 ? 0 : 1);
