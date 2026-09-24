/**
 * compose.mjs —— 把 `run.mjs` 的像素产物拼成**给人看的带标注对照图**。
 *
 * 为什么用 HTML + Chrome 而不是自己画字：图上要写**中文标注**，node 里没有中文字形。
 * 走仓里唯一的 CDP 胶水（`tools/_chrome.mjs`），把 HTML（图走 data: URI，零外部依赖）
 * 用真 Chrome 渲成 PNG。**只读 `dist/`，不动 `src/` / `tools/` / `shots/`。**
 *
 * 产出（`homm-web/assets/bitmap-proof/`）：
 *   `b_crestL_p1.png`     —— ① (b) 门面位图本体（256×384，7 步管线产物）
 *   `b_before_after.png`  —— ③ 改前 / 改后（含标注 + 「你应该注意到什么」）
 *   `e_control.png`       —— ② (e) 等尺寸对照（含 Δ 读数 + 诚实预期）
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHeadlessChrome } from '../../tools/_chrome.mjs';
import * as L from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'out');
const PUB = path.join(HERE, 'deliver');
mkdirSync(PUB, { recursive: true });

const uri = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const M = JSON.parse(readFileSync(path.join(OUT, 'metrics.json'), 'utf8'));

/* ------------------------------------------------ 先落 (b) 本体 + 预先合成「改后」 */
const crest = readFileSync(path.join(OUT, 'b_crestL_p1.png'));
writeFileSync(path.join(PUB, 'b_crestL_p1.png'), crest);

const beforePhone = L.decodePng(readFileSync(path.join(OUT, 'b_before_phone.png')));
const crestImg = L.decodePng(crest);
const PX = beforePhone.width - crestImg.width - 60;
const PY = beforePhone.height - crestImg.height - 40;
const afterPhone = L.pasteRGBA(
  beforePhone.rgba, beforePhone.width, beforePhone.height,
  crestImg.rgba, crestImg.width, crestImg.height, PX, PY,
);
const afterPath = path.join(OUT, 'b_after_phone.png');
writeFileSync(afterPath, L.encodePngRGBA(beforePhone.width, beforePhone.height, afterPhone));
console.log(`合成「改后」：立绘 1:1 贴到 (${PX},${PY})（device px，零缩放）`);

const beforeUri = uri(path.join(OUT, 'b_before_phone.png'));
const afterUri = uri(afterPath);
const procUri = uri(path.join(OUT, 'e_proc_direct.png'));
const backUri = uri(path.join(OUT, 'e_bitmap_back.preview.png'));
const aiSrcUri = uri(path.join(OUT, 'e_ai_source.preview.png'));

const CSS = `
:root{ --bg:#15181d; --panel:#1e232b; --panel2:#242a34; --ink:#e8e2d6; --dim:#a99f8c;
       --gold:#e0b45c; --ok:#6fc24a; --line:#3a4150; }
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);
     font:14px/1.65 "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;padding:26px 30px}
h1{font-size:22px;letter-spacing:.5px}
h1 .tag{font-size:12px;color:#15181d;background:var(--gold);border-radius:4px;padding:2px 8px;margin-right:9px;vertical-align:3px}
.sub{color:var(--dim);font-size:13px;margin-top:5px}
.row{display:flex;gap:16px;align-items:flex-start;margin-top:18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.card h2{font-size:13px;color:var(--gold);font-weight:600;margin-bottom:8px}
.card .cap{color:var(--dim);font-size:12px;margin-top:8px}
.pix{image-rendering:pixelated;display:block}
.shot{display:block;border-radius:6px}
.big{background:var(--panel2);border:1px solid var(--gold);border-radius:10px;padding:14px 16px;margin-top:18px}
.big .v{font-size:25px;color:var(--gold);font-weight:700;letter-spacing:.5px}
.big .l{font-size:12px;color:var(--dim);margin-top:5px}
.star{margin-top:14px;padding:12px 14px;border-left:3px solid var(--ok);background:#1b2419;border-radius:0 8px 8px 0}
.hr{height:1px;background:var(--line);margin:22px 0 4px}
.small{font-size:12px;color:var(--dim);line-height:1.75}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink)}
.eq{font-size:30px;color:var(--dim);align-self:center;padding-top:70px}
`;

/* =============================================================== ② (e) 对照图 */
const d = M.panes.e.deltaSameDesign;
const d32 = M.panes.e.deltaIf32Cap;
const eHtml = `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
<h1><span class="tag">(e)</span>等尺寸位图替换 · 对照实验</h1>
<div class="sub">同一张画、同一个尺寸（<b>64×56</b>）：只把「<b>程序化直出</b>」换成「<b>存成 PNG-8 位图文件、再读回</b>」。
不改分辨率、不改帧数、不动网格。</div>

<div class="row">
  <div class="card"><h2>① 程序化直出（现状）</h2>
    <img class="pix" src="${procUri}" width="320" height="280">
    <div class="cap">运行期当场算出来的像素（对照图放大 5×）</div></div>
  <div class="eq">＝</div>
  <div class="card"><h2>② 位图（PNG-8 复存后读回）</h2>
    <img class="pix" src="${backUri}" width="320" height="280">
    <div class="cap">同一张图另存为文件再读回：${M.panes.e.png8Bytes} B、${M.panes.e.png8Colors} 色（放大 5×）</div></div>
</div>

<div class="big">
  <div class="v">平均 |ΔL*| ${d.meanAbsL.toFixed(3)} ／ 最大 ΔL* ${d.maxL.toFixed(1)} ／ 变化像素 ${d.changedPct.toFixed(1)}%</div>
  <div class="l">逐像素比对（L* = CIE 明度）。<b>0.000 = 逐像素完全一样。</b>${d32 ? `另：若按 §3.3 收紧到 ≤32 色需量化，则该帧变成 平均 |ΔL*| ${d32.meanAbsL.toFixed(3)}、变化像素 ${d32.changedPct.toFixed(1)}%。` : ''}</div>
</div>

<div class="star">
  <b>★ 这就是 (e) 的预期结果：看不出变化 —— 不是失败，正是它的用途。</b><br>
  分辨率没变 ⇒ 能装的像素数没变 ⇒ <b>「画质提升」按定义 ≈ 0</b>。所以 (e) 买到的<b>不是画质，是一个答案</b>：
  「把像素存成文件」本身不会让画面变好。要变好，得改<b>尺寸 / 内容量 / 构图</b>这一层。
</div>

<div class="hr"></div>
<div class="small"><b>附注 · 那「换一个来源」呢？（同样剪到 64×56）</b></div>
<div class="row">
  <div class="card"><h2>我们的程序化兵种</h2>
    <img class="pix" src="${procUri}" width="192" height="168">
    <div class="cap">提灯侍从 · 17 色 · 轮廓干净、一眼读得出是什么</div></div>
  <div class="card"><h2>AI 位图兵种</h2>
    <img class="pix" src="${aiSrcUri}" width="192" height="168">
    <div class="cap">已排除的草稿（§3.5）剪到同一尺寸：${M.panes.eAi.colors} 色，<b>观感并不更好</b>；右下角还留着<b>平台水印残余</b></div></div>
  <div class="card" style="max-width:420px"><h2>这张图说明两件事</h2>
    <div class="small">① <b>同尺寸下位图买不到画质</b>：AI 最擅长的"细节"在这一步被降采样销毁（§4.2 R3：1024→64 ≈ 16 倍信息损失）。<br>
    ② 它是<b>已被排除</b>的素材，带平台水印 ⇒ 按硬边界「交付位图必须无水印 + 明确可商用」<b>不达标</b>。<b>只当反例，不是可交付素材。</b><br>
    <span class="mono">（两张是不同的画 ⇒ 不给"谁更差"的 Δ 数，那没有意义；请看观感。）</span></div></div>
</div>
`;

/* =============================================================== ③ 改前 / 改后 */
const bHtml = `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
<h1><span class="tag">(b)</span>门面位图 · 改前 / 改后
  <span style="font-size:13px;color:var(--dim);font-weight:400">（改后为<b>示意</b>，未接线）</span></h1>
<div class="sub">位置 = 用户说的「<b>打开游戏第一眼</b>」= 开局第一屏。真机视口 792×320（横屏），截图来自真实构建的 headless Chrome。</div>

<div class="card" style="margin-top:18px"><h2>改前 · 现状（真截图）</h2>
  <img class="shot" src="${beforeUri}" width="792" height="320">
  <div class="cap">整屏只有文字与设置项。<b>全项目 0 个图片文件</b>（核验命令见 README 附录）。</div></div>

<div class="card" style="margin-top:14px;border-color:var(--ok)"><h2 style="color:var(--ok)">改后 · 加上一张位图立绘（示意）</h2>
  <img class="shot" src="${afterUri}" width="792" height="320">
  <div class="cap">同一张截图 + 立绘<b>1:1 贴</b>在右侧空白（零缩放）。<b>这是示意图：没改代码，游戏里暂时还看不到它。</b></div></div>

<div class="big">
  <div class="v">左侧：空的 &nbsp;→&nbsp; 右侧：一张 256×384 的立绘</div>
  <div class="l">同一张 7 步管线产物：<b>${M.steps.b.pngBytes} B、${M.steps.b.pngColors} 色</b>（PNG-8）。它落在 §2.4 白名单的「选族立绘」上 ——
  <b>不在地图网格里</b>，不随相机 zoom，所以不踩 §3.3 的非整数缩放劣化。</div>
</div>

<div class="star">
  <b>★ 你应该注意到什么：</b>这一格从「<b>什么都没有</b>」变成「<b>一张能讲故事的画</b>」——
  这正是程序化今天<b>做不到</b>的位置（大尺寸 · 非平铺 · 静态 · 复用低）。<br>
  <b>但也请注意：</b>它<b>不会</b>让地图、单位、战场变好一点 —— 那些在 §2.4 里被<b>明确禁止</b>用位图。
</div>

<div class="hr"></div>
<div class="small">
  <b>⚠️ 两个必须一起看的边界</b>（详见 <span class="mono">assets/bitmap-proof/README.md</span>）：<br>
  ① 这张位图的<b>图源</b>（本环境的 AI 出图）<b>自带平台水印</b> ⇒ 按硬边界「必须无水印 + 明确可商用」它<b>不达标</b> ⇒
  <b>它是方向证据，不是可交付素材</b>。<br>
  ② 它只走完管线 <b>[1]–[5] + [7]</b>；<b>步骤 [6]「手工修」未做</b>（无画师）—— §5.5 的眼睛 / 毛边 / 遮挡穿模三类没人修。
</div>
`;

/* ---------------------------------------------------------------- 渲染入口 */
async function render(html, w, outPath) {
  const tmp = path.join(OUT, '_sheet.html');
  writeFileSync(tmp, html);
  const data = await withHeadlessChrome(
    async ({ send, evaluate }) => {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 300, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: `file://${tmp}` });
      await new Promise((r) => setTimeout(r, 800));
      const h = await evaluate('document.documentElement.scrollHeight');
      const shot = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: w, height: Math.ceil(h), scale: 1 },
      });
      return shot.data;
    },
    { profilePrefix: 'sheet-' },
  );
  writeFileSync(outPath, Buffer.from(data, 'base64'));
  console.log(`写出 ${path.relative(WEB, outPath)}`);
}

await render(eHtml, 1180, path.join(PUB, 'e_control.png'));
await render(bHtml, 900, path.join(PUB, 'b_before_after.png'));
console.log('done.');
