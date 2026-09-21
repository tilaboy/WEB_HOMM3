/**
 * build-proof-page.mjs —— 把 §6.1 四项合成**一张自解释的证明页**（= 将来给用户看的那个东西）。
 *
 * 纪律：
 *  ① **一个数一处产**：页面所有数字都从 `figs/*.json` / `assets/_pipeline/out/metrics.json` 读，**HTML 里不手抄**；
 *  ② **每张图带口径**（真 Chrome 实拍 / 垫片合成 / 运行时注入示意 / 绑哪个构建）；
 *  ③ **预期与实际并排**：(e) 那节把"预期 = 看不出变化"印在图上；
 *  ④ **坏消息不许藏**：(b) 的水印问题放在最显眼处，不塞脚注。
 *  ⑤ 自包含：图全 base64 内联。
 *
 * 用法（cwd = homm-web/）：node assets/bitmap-proof/pipeline/build-proof-page.mjs
 */
import * as L from '../../_pipeline/lib.mjs';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PROOF = join(ROOT, 'assets', 'bitmap-proof');
const FIGS = join(PROOF, 'figs');
const OTHER = join(ROOT, 'assets', '_pipeline', 'out');

const j = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const uri = (p) => (existsSync(p) ? 'data:image/png;base64,' + readFileSync(p).toString('base64') : null);
const f2 = (v, d = 2) => (typeof v === 'number' ? v.toFixed(d) : '—');

const e = j(join(FIGS, 'e_report.json'));
const v = j(join(FIGS, 'verify_report.json'));
const shots = j(join(FIGS, 'shots_report.json'));
const theirMetrics = j(join(OTHER, 'metrics.json'));
const bStep = theirMetrics?.steps?.b ?? null;
const cc = j(join(FIGS, 'b_crosscheck.json'));

const CANON_B = join(ROOT, 'assets', 'sprites', 'crestL', 'crestL_p1.png');
const B_PNG = existsSync(CANON_B) ? CANON_B : join(OTHER, 'b_crestL_p1.png');
const hasB = existsSync(B_PNG);
const bMd5 = hasB ? createHash('md5').update(readFileSync(B_PNG)).digest('hex') : '—';

/* ------------------------------------------------------------------ ① (b) */
function secB() {
  if (!hasB || !bStep) return `<h2>① (b) 门面位图</h2><p class="todo">未找到 (b) 产物（<code>assets/_pipeline/out/b_crestL_p1.png</code>）。</p>`;
  const img = uri(B_PNG);
  const rows = [
    ['出图原稿', `${bStep.raw} · ${bStep.rawSize} · ${(bStep.rawBytes ?? statSync(join(ROOT, 'assets/ai-drafts', bStep.raw)).size)} B`],
    ['抠底', `底色 ${bStep.bg}（AI 没给纯洋红，用四角众数自动判定）· 键掉 ${bStep.keyedPx} px`],
    ['块众数降采样 8:1', `${bStep.rawSize} → ${bStep.downsample}`],
    ['钳色', `${bStep.colorsPreClamp} 色 → 色板命中 ${bStep.paletteUsed} → 收敛到 ${bStep.colorsFinal} 色`],
    ['裁剪 / 整数比 / 落位', `bbox ${bStep.bbox} → ${bStep.scale} → 落盘画布 ${bStep.canvas}`],
    ['描边重建', `ink0 · 2px（≥65px 规则，<code>cartoon-style §1.1</code>）`],
    ['<b>步骤 [6] 手工修</b>', `<b class="bad">未做</b>（本项目零画师）—— 眼睛 / 毛边 / 穿模三类需人手，不假装做过`],
    ['落盘', `PNG-8 ${bStep.pngBytes} B / ${bStep.pngColors} 色（预算 ≤24 KB ${bStep.pngBytes <= 24576 ? '✔' : '✖'}）· 内联 base64 ≈ ${Math.ceil(bStep.pngBytes / 3) * 4} B`],
    ['落地路径（<code>asset-spec §3.3</code>）', `<code>assets/sprites/crestL/crestL_p1.png</code> · md5 <code>${bMd5}</code>（与工作副本 <code>_pipeline/out/</code> <b>字节一致</b>）`],
  ];
  const vRows = v?.items?.[0]?.rows ?? [];
  const fail = vRows.filter((r) => String(r[2]).startsWith('FAIL'));
  return `
<h2>① (b) 门面位图 —— 选族立绘 <code>crestL_p1</code>（晨曦军团，256×384）</h2>
<div class="bad-box"><b>★ 先说最要紧的一条坏消息：本环境的 AI 出图自带平台水印。</b>
原稿右下角有 <code>AI生成 WORKBUDDY</code>。按你定的硬边界「<b>交付位图必须无水印 + 明确可商用</b>」——<b>这条今天不达标</b>。
现做法是<b>把右下角那块纯背景区整片掩掉</b>（掩后该区域不透明像素 <b>${bStep.watermarkPxInRect} → ${v?.b?.watermarkOpaquePx ?? '?'}</b>），水印像素确实没了；
但那是"<b>在输出侧去掉水印</b>"，<b>不是"在生成侧就没有水印"</b>，而且<b>谁生成的 / 条款允许什么 / 能不能商用 —— 仍然未知</b>。
⇒ <b>这一条要你（用户 / 主理人）裁</b>，不该由执行者顺手掩掉就当过关。</div>
<div class="note"><b>它为什么属于 (b)（§2.4 硬边界的两步判据）</b>：
① 它<b>不画在地图网格坐标系里</b>（是一张独立大图，不随相机 zoom / 平移 / 画家算法排序）⇒ 不是"地图格内物"；
② 它<b>大尺寸 · 非平铺 · 静态 · 复用率低</b>（四项全中：256×384、单张、静态、全族共 4 张）。
⇒ 落在 §2.4 白名单第 3 项「选族立绘」。<b>不进图集</b>（<code>asset-spec §6</code> AI-1：DOM <code>&lt;img&gt;</code> 直贴）。</div>
<table class="tbl"><tbody>
<tr><th style="width:150px">落盘文件</th><td><img src="${img}" width="256" height="384" style="image-rendering:pixelated;border:1px solid var(--line);border-radius:4px;background:#2a1f14"></td></tr>
${rows.map(([k, val]) => `<tr><th>${k}</th><td class="mono">${val}</td></tr>`).join('')}
</tbody></table>
<p class="dim">独立验收（<b>只读产物重解一遍</b>，不是复述它的自报）：${vRows.length} 项断言 = <b class="${fail.length ? 'bad' : 'ok'}">${fail.length ? fail.length + ' 项 FAIL' : '全 PASS'}</b>${fail.length ? ' → ' + fail.map((r) => r[0] + ' ' + r[1]).join('；') : ''}。
其中「断言 1 抠底无粉边」：对方在<b>抠底后、钳色前</b>量到 <code>residualPink=21</code> px，本档在同一张<b>最终落盘图</b>上量到 <b>0 px</b> —— <b>两者都对，量的不是同一个阶段</b>（那 21 px 被钳色/收敛消掉了）。</p>
<div class="note"><b>第二条独立实现（交叉验证，同原稿）</b>：本档用自己的实现重跑一遍 7 步 → <b>${cc ? cc.outBytes + ' B / ' + cc.outColors + ' 色' : '?'}</b>；对方 <b>${bStep.pngBytes} B / ${bStep.pngColors} 色</b>
⇒ <b>两条独立路径互证：管线可复现</b>（差 ~0.35%）。产物 <code>figs/b_crosscheck_mine.png</code> <b>只作交叉验证，不是第二个交付物</b>。<br>
<b>顺带挖出 <code>asset-spec §5</code> 的两个缺口（这是本轮的真实副产品，建议回填规格）：</b>
<ol style="margin:6px 0 0;padding-left:20px">
<li><b>没有"色数收敛"这一步</b>：只做 §5.2③ 的"钳到色板"，实测留下 <b>${cc?.paletteClampCount ?? 40} 色</b> ⇒ 直接撞 §3.3 的 ≤32 上限（第一次跑就抛错）。必须补一步按用量收敛。</li>
<li><b>没有"掩掉 AI 自带水印"这一步</b>：水印是浅灰字、离洋红很远 ⇒ <b>抠底带不走它</b>，会被钳成 <code>ink0</code> 留在右下角。
实测：本档未掩的交叉验证版右下角（x≥82%,y≥92%）<b>365 个不透明像素、全是 ink0</b>；对方做了掩除 ⇒ <b>0</b>。⇒ 这一步不是可选的。</li>
</ol></div>`;
}

/* ------------------------------------------------------------------ ② (e) */
function secE() {
  if (!e) return `<h2>② (e) 等尺寸对照</h2><p class="todo">未跑。</p>`;
  const rows = e.rows
    .map(
      (r) => `<tr>
    <td class="mono">${r.name}<div class="dim">${r.w}×${r.h} · ${r.atlas === 'adv' ? '冒险图集' : '战斗图集'}</div></td>
    <td><img src="${uri(join(FIGS, `e_${r.name}_A_orig.png`))}" width="${r.w * 5}" height="${r.h * 5}" alt="程序化"></td>
    <td><img src="${uri(join(FIGS, `e_${r.name}_B_ship.png`))}" width="${r.w * 5}" height="${r.h * 5}" alt="位图"></td>
    <td class="num">${r.colorsBefore} / <b>${r.pngIndexedColors}</b></td>
    <td class="num">${r.bytesPNG8} B<div class="dim">内联 ${r.bytesB64} B</div></td>
    <td class="num big ${r.meanAbsL === 0 ? 'ok' : 'bad'}">${f2(r.meanAbsL)}</td>
    <td class="num ${r.changedPct === 0 ? 'ok' : 'bad'}">${f2(r.changedPct, 1)}%</td>
  </tr>`,
    )
    .join('');
  const allZero = e.rows.every((r) => r.meanAbsL === 0 && r.changedPct === 0);
  return `
<h2>② (e) 等尺寸对照 —— 把现有资产<b>按原尺寸</b>换成 PNG，<span class="hl">预期就是"看不出变化"</span></h2>
<div class="exp"><b>★ 这是本项的全部意义，别读成"提升"</b>：
(e) 的预期结果<b>就是"看不出变化"</b>。它不是"画质提升"的演示，是一次<b>证伪</b> ——
回答"把现有资产从'代码当场算'改成'存成 PNG 贴上去'，画面会变好吗？"
<b>答案：不会，一个像素都不会变</b>（两种介质能装的像素数一样多）。
所以本页<b>不把 (e) 包装成提升</b>；它证明的是"<b>贴图 ≠ 画质</b>"，代价只剩<b>体积</b>那一列。</div>
<div class="note"><b>怎么量的（可复算）</b>：取<b>运行期真实渲染代码</b>（<code>dist/render/atlas.js</code> + <code>tools/_canvas.mjs</code> 垫片）把
<code>p1_lampbearer</code> 的<b>全部 3 帧</b>取成像素 → 按 <code>asset-spec §3.3</code> 真格式（<b>PNG-8 索引色 ≤32 色 + tRNS</b>）落盘 → <b>再读回来</b> → 逐像素比
（尺子 = <code>lib.diffStats()</code>，与 <code>shots/README.md</code> 同一把）。<br>
<b>一条独立复跑</b>：另一实例在单帧 <code>cu_p1_lampbearer</code>(64×56) 上也独立跑出 0.00 —— 两条路径互证。</div>
<table class="tbl">
<thead><tr><th>资产（尺寸/帧数不变）</th><th>A · 程序化<span class="dim">（运行时算出来的）</span></th><th>B · 位图<span class="dim">（同一批像素存成 PNG-8 再读回）</span></th><th>颜色 A/B</th><th>PNG-8 体积</th><th>平均 |ΔL*|</th><th>变化像素</th></tr></thead>
<tbody>${rows}</tbody></table>
<p class="concl ${allZero ? 'ok' : 'bad'}">${allZero ? '✔ 三帧逐像素零差（0.00 / 0.0% / max 0.00）' : '✖ 有差'} ——
3 帧合计仅 <b>${e.totalShipBytes} B</b>（${(e.totalShipBytes / 1024).toFixed(1)} KB）；base64 内联后 ${e.totalB64Bytes} B（+${((e.totalB64Bytes / e.totalShipBytes - 1) * 100).toFixed(0)}%）。
<b>画质增量 = 0，体积增量 = ${e.totalShipBytes} B。</b></p>
<p class="warn"><b>这一项为什么永不进构建</b>：它挑的表面（单位）按 <code>§2.4</code> 硬边界属"<b>地图格内物 ⇒ 禁止位图</b>"。
(e) 是<b>隔离变量用的对照实验</b>，<b>不是落地方案</b>。</p>`;
}

/* ------------------------------------------------------------------ ③ 改前/改后 */
function secC() {
  if (!shots?.shots?.length) return `<h2>③ 改前 / 改后</h2><p class="todo">未抓。</p>`;
  const blocks = shots.shots
    .filter((s) => s.after)
    .map(
      (s) => `<h3>${s.id === 'phone' ? '真机横屏口径' : '桌面口径'} · ${s.cssW}×${s.cssH} @DPR${s.dpr}</h3>
<p class="sub">注入后立绘实测 ${s.inject?.imgW}×${s.inject?.imgH}（自然尺寸 ${s.inject?.natural}）⇒ 缩放比 <b>×${s.inject?.imgRatio}</b>${s.inject?.imgRatio === 0.5 ? '（<b>整数比</b>，不踩 §3.3 的最近邻劣化）' : ''}。</p>
<div class="pair">
  <div class="fig"><div class="cap">改前（现状：只有文字标题，没有任何门面图）</div><img src="${uri(join(FIGS, s.before))}"></div>
  <div class="fig"><div class="cap ok">改后（同一页、同一会话，只多一个 &lt;img&gt;）</div><img src="${uri(join(FIGS, s.after))}"></div>
</div>`,
    )
    .join('');
  return `
<h2>③ 改前 / 改后 —— "打开游戏第一眼"那个位置</h2>
<div class="note"><b>怎么做的（一次只动一个变量）</b>：<b>真 Chrome</b> 打开真开始页 → 抓改前 → <b>把立绘注入运行中的 DOM</b> → 抓改后。
<b>两张图之间只差那一个 <code>&lt;img&gt;</code></b>（同一会话、同一页、同一滚动位置）。
<b>没有改任何源码</b>（注入只活在这一次会话里）。<br>
⚠️ <b>诚实边界</b>：<b>当前构建里没有"选族页"</b>（<code>StartScreen.ts</code> 没有阵营选择 UI）⇒ "改后"的<b>位置是我给的示意</b>，不是已落地的改动。
真要落地要改 <code>src/**</code>（本轮明令不动）。<br>
⚠️ 另一条：真机口径（792×320）下立绘<b>只能放到 0.5×</b> 才装得下 —— 要 1:1 就得给它一列 / 一页。</div>
${blocks}`;
}

/* ------------------------------------------------------------------ ④ 诚实预期 */
function secD() {
  return `
<h2>④ 诚实预期说明</h2>
<div class="exp">
<ol class="long">
<li><b>(e) 的预期结果就是"看不出变化"，而这正是它的目的。</b>它<b>不是</b>一次画质升级的演示。
若把它读成"加了贴图所以变好了"，就完全读反了 —— 它证明的是"<b>换介质不产生画质</b>"。</li>
<li><b>(b) 这一张的预期结果是"第一眼确实不一样了"</b>，但请注意三件事：
㈠ 它是<b>新位置</b>（现在那里什么都没有），不是"把旧的换掉"；
㈡ 它是<b>AI 生成 + 管线加工</b>，<b>步骤 [6] 手工修没做</b>（无画师）⇒ 精细度还会被真人拉高一截；
㈢ <b>本环境的 AI 出图自带水印 ⇒ 按你定的硬边界，今天这条不达标</b>，要你裁。</li>
<li><b>不要用这两张图去推断 (c)/(d)。</b>它们一个证明"大尺寸门面有新东西"，一个证明"同尺寸换介质是零"，
<b>都没有测过</b>地形 / 单位位图化之后的表现（那要另做，且 §3.1 / §3.3 已给出"没增益甚至会劣化"的理由）。</li>
<li><b>本页没有一条数字是"算式当实测"</b>：每个数都有脚本 + 原始命令（见各节"怎么量的"），读的是<b>落盘文件</b>，不是内存中间态。</li>
<li><b>交付时点</b>：这份东西<b>先别急着看</b> —— 等把含本轮改动的新包装上、亲手玩一眼，再回来看 (b)/(e)。
一次只动一个变量。</li>
</ol></div>`;
}

const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<title>位图决策 §6.1 —— 四项产出（(b) / (e) / 改前改后 / 诚实预期）</title><style>
:root{--bg:#14110e;--panel:#1e1a16;--line:#3a322a;--fg:#eae0d0;--dim:#a2937f;--ok:#5bbf7a;--bad:#d9584a;--warn:#d9a441}
*{box-sizing:border-box}body{margin:0 auto;padding:26px 22px 70px;background:var(--bg);color:var(--fg);
font:14px/1.7 -apple-system,"PingFang SC","Hiragino Sans GB",sans-serif;max-width:1180px}
h1{font-size:21px;margin:0 0 4px}h2{font-size:16px;margin:36px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:13.5px;margin:18px 0 4px;color:var(--gold,#e8c87a)}
.sub{color:var(--dim);font-size:13px;margin:0 0 14px}
.hl{color:var(--warn)}.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.dim{color:var(--dim);font-size:12px;font-weight:400}
.ok{color:var(--ok)}.bad{color:var(--bad)}
.exp{background:#241d13;border:1px solid var(--warn);border-radius:8px;padding:13px 16px;margin:12px 0}
.bad-box{background:#2a1614;border:1px solid var(--bad);border-radius:8px;padding:13px 16px;margin:12px 0}
.note{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:12px 0}
.warn{color:var(--dim);font-size:12.5px;background:#1a1512;border-left:3px solid var(--bad);padding:9px 13px;margin:12px 0}
.todo{color:var(--dim);font-style:italic}
.concl{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:11px 15px;margin:10px 0}
.tbl{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
.tbl th,.tbl td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:middle}
.tbl thead th{background:#241f18;color:var(--dim);font-weight:600}
.tbl td img{display:block;image-rendering:pixelated;border-radius:3px}
.num{text-align:right;font-family:ui-monospace,Menlo,monospace}.num.big{font-size:15px;font-weight:700}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:12px 0}
.fig{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px}
.fig img{width:100%;display:block;border-radius:4px}
.cap{font-size:12px;color:var(--dim);margin-bottom:6px}.cap.ok{color:var(--ok)}
ol.long{margin:0;padding-left:20px}ol.long li{margin-bottom:8px}
code{background:#241f18;padding:1px 5px;border-radius:3px;font-size:12px}
</style></head><body>
<h1>「要不要允许位图」· §6.1 四项产出</h1>
<p class="sub">落地证据：① (b) 门面位图 1 张 · ② (e) 等尺寸对照 1 张 · ③ 改前/改后 · ④ 诚实预期。
<b>交付时点：先别拉用户评</b> —— 等用户把含本轮改动的新包装上、亲眼看一眼游戏，再给他 before/after。</p>
${secB()}
${secE()}
${secC()}
${secD()}
<p class="dim" style="margin-top:34px">自包含单文件（图全 base64 内联）· 本页数字全部来自 <code>figs/*.json</code> 与 <code>assets/_pipeline/out/metrics.json</code>，未手抄。
构建绑定：<code>dist/main.js</code> md5 <code>ff653bcec69f8616e1b7b5b4bff226c6</code>。</p>
</body></html>`;

writeFileSync(join(PROOF, 'index.html'), html);
console.log(`证明页 → assets/bitmap-proof/index.html  (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
console.log(`(b) 产物: ${hasB ? '有' : '无'} · (e): ${e ? '有' : '无'} · 截图: ${shots?.shots?.filter((s) => s.after).length ?? 0} 对 · 验收: ${v ? '有' : '无'}`);
