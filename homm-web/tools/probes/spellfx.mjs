#!/usr/bin/env node
/**
 * spellfx.mjs —— §11.2 六类施法模板的机检（`npm run probe:spellfx`）。
 *
 * ## 它守什么
 * §11.2 要把 12 个战斗法术收成 6 类**形状**。这条要求最容易被"糊弄过去"：
 * 只要每个法术都放出一个圆环，也能说"每个法术都有演出"。所以这里守四件事：
 *
 *   [A] **映射覆盖**（纯函数）：`SPELLS` 里每个 `combat: true` 的法术都必须在
 *       `SPELL_FX_TEMPLATE` 里有模板。落到缺省 `ring` 就是漏了一个 —— 门会红。
 *       覆盖闸按**表**算，不写死"12 个"：将来加第 13 个法术，忘了配模板当场红。
 *   [B] **真画出来了**（无头 Chrome，调**真** `drawSpellFx`）：
 *       六个模板各渲染三个相位，读像素掩膜。断言不是"有没有墨"，
 *       而是**方向 / 尺度 / 形状**这些只有形状对了才成立的性质：
 *       增益重心**上移**、减益重心**下沉**、爆发半径**变大**、链在上方成柱、
 *       复活成窄柱、投射拖尾朝着 `to`（施法方）。
 *   [C] **两两不同**：六个模板同一相位的掩膜 IoU 必须 < 0.5，
 *       否则"六类"实际是"六种颜色"。
 *   [D] **负向对照**：拿缺省 `ring` 去跑 [B] 的"增益上移"判据，**必须不通过**。
 *       没有这一条，谁也不知道 [B] 的判据有没有分辨力（恒真的判据不是门）。
 *
 * ## 负向对照（复跑手册，已实测）
 * 改 `dist/`（不想动 src 就先 `npm run -s build`，改完再 build 回来）：
 * · 把 `SPELL_FX_TEMPLATE` 里 `magicArrow: 'proj'` 删掉 ⇒ **[A1] 红**（缺 magicArrow）、
 *   **[A2] 红**（proj 只剩 1 个）；这条证明覆盖闸按表算、不靠写死数量。
 * · 把 `drawSpellFx` 的 `kind === 'buff'` 改名（让 buff 落到缺省圆环）⇒
 *   **[B2] 红**（重心 69.4 → 69.6，上移 −0.2px）、**[D2] 红**。
 *
 * ## 与 `tools/fxsheet.mjs` 的分工
 * 这里是**门**（读数 + 断言）；fxsheet 是**目检图纸**（人看形状像不像）。
 * 图纸必须调同一个 `drawSpellFx`：抄一份形状就是第二真值来源，改实现图纸不会变。
 *
 * ## 为什么在页内算、只把读数带回 node
 * 掩膜是 140×140 的布尔场；六个模板 × 三个相位 × 两两 IoU，数据量远大于读数。
 * 形状的唯一来源是 `drawSpellFx`（dist 里的真实现），探针里**不抄任何形状**。
 *
 * 退出码：0 全过 · 1 有断言不过 · 2 前置不满足
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { distDir, distUrl, printHeader, requireFile, freePort } from '../_dist.mjs';
import { withHeadlessChrome, chromeAvailable } from '../_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=spellfx');
requireFile(DIST, 'main.js');

const SP = await import(distUrl('core/data/spells.js', DIST));

let bad = 0;
const PASS = (c, m) => {
  if (!c) bad++;
  console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`);
};

const SIX = ['proj', 'burst', 'chain', 'buff', 'debuff', 'revive'];
const combat = Object.entries(SP.SPELLS)
  .filter(([, s]) => s.combat)
  .map(([id]) => id);

/* ---------------- A 段：纯函数（映射覆盖） ---------------- */

const missing = combat.filter((id) => !SP.SPELL_FX_TEMPLATE[id]);
PASS(
  missing.length === 0,
  `[A1] ${combat.length} 个战斗法术全部配了模板（按表算，不写死数量）· 缺: ${missing.join(' / ') || '无'}`,
);

const counts = {};
for (const id of combat) {
  const t = SP.SPELL_FX_TEMPLATE[id];
  counts[t] = (counts[t] ?? 0) + 1;
}
const extra = Object.keys(counts).filter((k) => !SIX.includes(k));
PASS(
  SIX.every((k) => (counts[k] ?? 0) > 0) && extra.length === 0,
  `[A2] 六类模板都被用到，且没有第七类 · ${SIX.map((k) => `${k}=${counts[k] ?? 0}`).join(' ')}`,
);

PASS(
  SP.spellTemplate('__no_such_spell__') === null,
  '[A3] 未知法术返回 null（渲染器才退到 ring；不许在表里塞一个兜底模板掩盖漏配）',
);

/* ---------------- B/C/D 段：真渲染 ---------------- */

if (!chromeAvailable()) {
  console.error('✗ 前置不满足：找不到 Chrome');
  process.exit(2);
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>spellfx-probe</title>
<script type="module">
import { BattleRenderer, PAD } from '/render/BattleRenderer.js';
import { hexCenter } from '/core/combat/hex.js';

const draw = BattleRenderer.prototype.drawSpellFx;
const W = 140, H = 140, OX = W / 2, OY = H / 2;
const HEX = { col: 6, row: 6 };
const ORIGIN = { col: 2, row: 8 }; // 施法方：左下方（拖尾必须朝它）
const KINDS = ${JSON.stringify(SIX)};

/** 在 140×140 的透明画布上按真实现画一次，返回掩膜读数。 */
function render(kind, life, withTo) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const c = hexCenter(HEX);
  ctx.save();
  ctx.translate(OX - (c.x + PAD), OY - (c.y + PAD));
  const fx = { hex: HEX, life, color: '#ffe9a8', kind };
  if (withTo) fx.to = ORIGIN;
  draw.call({}, ctx, fx);
  ctx.restore();
  const d = ctx.getImageData(0, 0, W, H).data;
  const m = new Uint8Array(W * H);
  let n = 0, sx = 0, sy = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, col = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] <= 8) continue;
      m[y * W + x] = 1; n++; sx += x; sy += y;
      if (Math.abs(x - OX) <= 3) col++; // 落在中轴 ±3px 的墨量（复活靠它证"柱"）
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { n, col, cx: n ? sx / n : 0, cy: n ? sy / n : 0, minX, maxX, minY, maxY, m };
}

const LIVES = [0.9, 0.5, 0.2];
const out = { kinds: {}, iou: {}, projNoTo: null };
for (const kind of KINDS) {
  out.kinds[kind] = {};
  for (const life of LIVES) {
    const r = render(kind, life, true);
    out.kinds[kind][life] = { n: r.n, col: r.col, cx: r.cx, cy: r.cy, minX: r.minX, maxX: r.maxX, minY: r.minY, maxY: r.maxY };
  }
}

// 两两 IoU（同一相位）
for (let i = 0; i < KINDS.length; i++) {
  for (let j = i + 1; j < KINDS.length; j++) {
    for (const life of LIVES) {
      const a = render(KINDS[i], life, true).m;
      const b = render(KINDS[j], life, true).m;
      let inter = 0, uni = 0;
      for (let k = 0; k < a.length; k++) {
        if (a[k] || b[k]) uni++;
        if (a[k] && b[k]) inter++;
      }
      out.iou[KINDS[i] + '|' + KINDS[j] + '@' + life] = uni ? inter / uni : 1;
    }
  }
}

// 投射：没有 to 时**不许**有向左的拖尾（否则方向是编出来的）
const noTo = render('proj', 0.5, false);
out.projNoTo = { minX: noTo.minX, maxX: noTo.maxX, n: noTo.n };

// 负向对照：缺省圆环跑"增益上移"判据必须失败
out.ring = {};
for (const life of LIVES) {
  const r = render('ring', life, true);
  out.ring[life] = { cy: r.cy, minY: r.minY, maxY: r.maxY, n: r.n };
}
window.__spellfx = out;
document.title = 'spellfx-ready';
</script>`;

const PORT = await freePort();

/* 渲染页**不落盘**：内存路由 + 静态代发 dist。
 *
 * 为什么不写 `dist/__spellfx.html` 然后删掉（第一版就是这么写的）：
 * ① 页面里的 `import '/render/BattleRenderer.js'` 要求同源 http，`data:` 源解析不了；
 * ② 落盘就得删，而本机 node 带一个 safe-delete shim：**同一 turn 里第 50 次批量删除**
 *    会抛 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`。2026-11-12 全量顺序跑时，本门排在第 58 个，
 *    前面的门已经攒够 50 次 ⇒ `rmSync` 直接抛，整门 rc=1（前 13 条断言全绿也没用）。
 *    这不是"偶发抖动"，是**跑得越多越必炸**。内存路由从根上绕开删除。
 */
const MIME = { '.js': 'text/javascript; charset=utf-8', '.map': 'application/json', '.css': 'text/css; charset=utf-8' };
const server = createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/__spellfx.html') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(PAGE);
    return;
  }
  const p = resolve(DIST, `.${url === '/' ? '/index.html' : url}`);
  if (!p.startsWith(DIST)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  try {
    const body = await readFile(p);
    const ext = p.slice(p.lastIndexOf('.'));
    res.setHeader('content-type', MIME[ext] ?? 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
console.log(`[serve] 内存路由 @ http://127.0.0.1:${PORT}/__spellfx.html（dist 静态代发）`);

/* 页面就绪有没有可能"一次没读到"？有，但**不是**本门第一次 rc=1 的原因。
   第一次全量跑失败的真因是 `rmSync` 撞上 safe-delete 的 50 次配额（见上）；
   那次 4 秒退出、前 13 条断言全绿，被我误判成"Chrome 清理抖动"。
   这里仍保留**一次**就绪重试（页面模块多、冷启动慢时会读不到 `__spellfx`），
   但重试只写进日志、不吞失败：第二次仍失败照旧 rc=1。 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function renderAll() {
  return withHeadlessChrome(
    async ({ send, evaluate }) => {
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/__spellfx.html` });
      let ok = false;
      for (let i = 0; i < 40 && !ok; i++) {
        await sleep(250);
        ok = await evaluate('!!window.__spellfx').catch(() => false);
      }
      return ok ? await evaluate('window.__spellfx') : null;
    },
    { devServerPort: PORT },
  );
}

let shots = null;
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    shots = await renderAll();
  } catch (e) {
    if (attempt === 2) throw e;
    console.log(`[retry] 第一次渲染抛错，2s 后重试一次: ${String(e.message).split('\n')[0]}`);
  }
  if (shots) break;
  if (attempt === 1) {
    console.log('[retry] 第一次没读到渲染结果（页面未就绪），2s 后重试一次');
    await sleep(2000);
  }
}

if (!shots) {
  console.log('[FAIL] [B0] 渲染页没跑起来（读不到 window.__spellfx）');
  console.log('');
  console.log('✗ 1 条不过');
  process.exit(1);
}

const k = shots.kinds;
const near = (v, t, tol) => Math.abs(v - t) <= tol;

/* B1：六个模板都真的画出了墨（不是"事件发了但什么都不画"） */
const EMPTY = SIX.filter((s) => !(k[s][0.5] && k[s][0.5].n >= 40));
PASS(
  EMPTY.length === 0,
  `[B1] 六个模板在 life=0.5 都有实体像素 · ${SIX.map((s) => `${s}=${k[s][0.5]?.n ?? 0}`).join(' ')}`,
);

/* B2：方向语义。阈值取自 §11.2 的名义几何（上浮 22px / 下沉 ~10px / 半径 6→34），
   取一半作门槛 —— 判据来自规格，不是来自本次读数。 */
const buffRise = k.buff[0.9].cy - k.buff[0.2].cy;
PASS(buffRise >= 12, `[B2] 增益符文**上浮**（重心 y ${k.buff[0.9].cy.toFixed(1)} → ${k.buff[0.2].cy.toFixed(1)}，上移 ${buffRise.toFixed(1)}px ≥ 12）`);

const debuffSink = k.debuff[0.2].cy - k.debuff[0.9].cy;
PASS(debuffSink >= 4, `[B3] 减益暗环**下沉**（重心 y ${k.debuff[0.9].cy.toFixed(1)} → ${k.debuff[0.2].cy.toFixed(1)}，下沉 ${debuffSink.toFixed(1)}px ≥ 4）`);

const burstGrow = k.burst[0.2].maxX - k.burst[0.2].minX - (k.burst[0.9].maxX - k.burst[0.9].minX);
PASS(burstGrow >= 15, `[B4] 爆发**扩散**（宽 ${k.burst[0.9].maxX - k.burst[0.9].minX} → ${k.burst[0.2].maxX - k.burst[0.2].minX}px，增 ${burstGrow}px ≥ 15）`);

/* 链：主干 46px 在目标上方 ⇒ 上缘必须够高，且横向不能摊开（摊开就不是"一道"） */
const chainTop = 70 - k.chain[0.5].minY;
const chainW = k.chain[0.5].maxX - k.chain[0.5].minX;
PASS(
  chainTop >= 30 && chainW <= 26,
  `[B5] 链从上方劈下（上伸 ${chainTop}px ≥ 30，横向 ${chainW}px ≤ 26）`,
);

/* 复活：4px 金柱 + 上浮颗粒 ⇒ **墨集中在中轴**且够高。
   只量 bbox 宽会误判：颗粒本来就散在柱两侧（首版宽 16px，按 ≤14 判红过一次）。
   真正的形状性质是"中轴 ±3px 里占大头" —— 圆环/爆发在同样宽度下做不到这一点。 */
const revM = k.revive[0.5];
const revW = revM.maxX - revM.minX;
const revH = revM.maxY - revM.minY;
const revCol = revM.col / Math.max(1, revM.n);
PASS(
  revH >= 20 && revCol >= 0.35 && revW <= 24,
  `[B6] 复活是**柱**（高 ${revH} ≥ 20 · 中轴墨占比 ${(revCol * 100).toFixed(0)}% ≥ 35% · 宽 ${revW} ≤ 24）`,
);

/* 投射：拖尾朝 `to`（左下）。两面一起验：
   ① 有 to 时左伸必须明显；② 无 to 时**不许**比"弹体本身的环"更靠左 —— 方向不能是编的。 */
const projWith = 70 - k.proj[0.5].minX;
const projNo = 70 - shots.projNoTo.minX;
PASS(
  projWith >= 12 && projWith - projNo >= 6,
  `[B7] 投射拖尾朝施法方（有 to 左伸 ${projWith}px vs 无 to ${projNo}px，多出 ${projWith - projNo}px ≥ 6）`,
);

/* C：两两不同（IoU < 0.5）。0.5 是"重叠超过一半就算同一个形状"的经验界；
   真正的分辨力由 B2–B7 的方向/尺度判据承担，这一条只挡"六个都是圆环"。 */
const pairs = Object.entries(shots.iou).filter(([, v]) => v >= 0.5);
const worst = Object.entries(shots.iou).sort((a, b) => b[1] - a[1])[0];
PASS(
  pairs.length === 0,
  `[C1] 六个模板同一相位两两 IoU < 0.5（共 ${Object.keys(shots.iou).length} 对，最像 ${worst[0]}=${worst[1].toFixed(2)}）` +
    `${pairs.length ? ' · 超界: ' + pairs.map(([s, v]) => `${s}=${v.toFixed(2)}`).join(' ') : ''}`,
);

/* D：负向对照 —— 圆环跑"增益上移"必须失败 */
const ringRise = Math.abs(shots.ring[0.9].cy - shots.ring[0.2].cy);
PASS(ringRise < 3, `[D1] 负向对照：缺省圆环的重心几乎不动（Δ${ringRise.toFixed(1)}px < 3）⇒ [B2] 的判据有分辨力`);

/* 同一相位下，圆环与增益必须不是同一个读数（否则 B2 会被一个"会漂的环"骗过） */
const dRingBuff = Math.abs(shots.ring[0.5].cy - k.buff[0.5].cy);
PASS(dRingBuff >= 4, `[D2] 负向对照：圆环与增益在 life=0.5 的重心不同（Δ${dRingBuff.toFixed(1)}px ≥ 4）`);

console.log('');
server.close();
if (bad) {
  console.log(`✗ ${bad} 条不过`);
  process.exit(1);
}
console.log('✓ 全过');
process.exit(0);
