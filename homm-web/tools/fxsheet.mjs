#!/usr/bin/env node
/**
 * fxsheet.mjs —— 能力演出（`BattleFx`）的**目检图纸**，不是门。
 *
 * 为什么单独做一张图纸：7 种 `BattleFxKind` 全是 canvas 图元，没有图集帧可查，
 * 断言只能证明"事件发了"，证不了"玩家看得出这是吸血、那是威压"。
 * 本项目铁律：新美术批必须 ×N 单独目检，别看拼图缩略图下结论。
 *
 * **为什么调的是真函数**：这里 `proto.drawSpellFx.call({}, ctx, fx)` 直接调
 * `BattleRenderer.prototype` 上的真实现（`drawSpellFx` 不读 `this`，所以不需要
 * 图集、不需要战场状态）。脚本里**不许**抄一份形状 —— 抄一份就是第二真值来源，
 * 改了实现图纸不会变，等于拿旧世界做目检。
 *
 * 用法：
 *   node tools/fxsheet.mjs /tmp/fx.png        # dev server 需已在 5199
 *   node tools/fxsheet.mjs /tmp/fx.png --port=5201
 *
 * 退出码：0 出图成功 · 2 前置不满足（Chrome / dev server / 缺产物）。
 */
import { writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHeadlessChrome, chromeAvailable } from './_chrome.mjs';

const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith('--')) ?? '/tmp/fx-sheet.png';
const opt = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const PORT = Number(opt('port', 5199));

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '..', 'dist');
if (!existsSync(resolve(DIST, 'render/BattleRenderer.js'))) {
  console.error('✗ 前置不满足：dist/render/BattleRenderer.js 不存在（先 npm run -s build）');
  process.exit(2);
}
if (!chromeAvailable()) {
  console.error('✗ 前置不满足：找不到 Chrome');
  process.exit(2);
}

/**
 * 图纸页。**临时写进 dist/**（dist 被 .gitignore 忽略），出图后删掉。
 * 用 `image-rendering: pixelated` + 3 倍内部缩放：形状是矢量的，放大不掉细节。
 */
const ALL_KINDS = [
  // §11.2 六类施法模板（法术形状的唯一来源）
  ['proj', '① 投射', '#f4e27a'],
  ['burst', '② 爆发', '#ff8b3d'],
  ['chain', '③ 链', '#f0f0ff'],
  ['buff', '④ 增益', '#ffe9a8'],
  ['debuff', '⑤ 减益', '#a86ad8'],
  ['revive', '⑥ 复活', '#ffd76a'],
  // 能力演出（S4e）
  ['ring', '圆环（缠绕/缺省）', '#cfe0ff'],
  ['drain', '吸血（血珠回流）', '#b8324a'],
  ['dread', '威压（暗环下沉）', '#6b4a7a'],
  ['lava', '熔岩护甲（火星）', '#e0662c'],
  ['flame', '烈焰缠身（火舌）', '#ff9a3c'],
  ['oath', '誓约（护罩弧）', '#cfe3ff'],
  ['fly', '飞行起落（尘环）', '#cfd8e2'],
];
/* `--from=0 --to=6`：只出一段（14 列并排时每格 140px，×3 目检仍然偏小）。
   第一段 = 六类施法模板，第二段 = S4e 能力演出。 */
const FROM = Math.max(0, Number(opt('from', 0)) || 0);
const TO = Math.min(ALL_KINDS.length, Number(opt('to', ALL_KINDS.length)) || ALL_KINDS.length);
const KINDS = ALL_KINDS.slice(FROM, TO);
const LIVES = [0.92, 0.62, 0.34, 0.1];

const html = `<!doctype html>
<meta charset="utf-8">
<title>BattleFx sheet</title>
<style>
  html,body{margin:0;background:#141210}
  canvas{display:block;image-rendering:pixelated}
</style>
<canvas id="cv"></canvas>
<script type="module">
import { BattleRenderer } from '/render/BattleRenderer.js';
import { hexCenter, FIELD_W, FIELD_H } from '/core/combat/hex.js';

const KINDS = ${JSON.stringify(KINDS)};
const LIVES = ${JSON.stringify(LIVES)};
const CELL_W = 140, CELL_H = 132, HEAD = 34, ZOOM = 3;
const COL = ${KINDS.length}, ROW = LIVES.length;
const cv = document.getElementById('cv');
const W = COL * CELL_W, H = HEAD + ROW * CELL_H;
cv.width = W * ZOOM; cv.height = H * ZOOM;
cv.style.width = W + 'px'; cv.style.height = H + 'px';
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

// 底色 = 战场地面的近似亮度（0.68 光照后的土色），否则深色效果看不见
ctx.setTransform(ZOOM,0,0,ZOOM,0,0);
ctx.fillStyle = '#3b321f';
ctx.fillRect(0,0,W,H);
ctx.fillStyle = '#141210';
ctx.fillRect(0,0,W,HEAD);

// 画格线，方便确认每个形状确实在自己那一格、没有溢到邻居
ctx.strokeStyle = 'rgba(255,255,255,0.07)';
ctx.lineWidth = 1;
for (let i = 0; i <= COL; i++) { ctx.beginPath(); ctx.moveTo(i*CELL_W, HEAD); ctx.lineTo(i*CELL_W, H); ctx.stroke(); }
for (let j = 0; j <= ROW; j++) { ctx.beginPath(); ctx.moveTo(0, HEAD+j*CELL_H); ctx.lineTo(W, HEAD+j*CELL_H); ctx.stroke(); }

/** 真函数：drawSpellFx 只读 ctx 与 hexCenter，不读 this ⇒ 空对象当接收者即可。 */
const drawSpellFx = BattleRenderer.prototype.drawSpellFx;

for (let j = 0; j < ROW; j++) {
  for (let i = 0; i < COL; i++) {
    const [kind, , color] = KINDS[i];
    // 用 hex 坐标反推：把小格中心换算成某个 (col,row) 的落点
    // hexCenter(col,row) = (15.15 + col*30.31 + odd*15.155, 17.5 + row*26.25)
    // 这里不求整数解，直接取 hex 中心后做平移 —— 形状在格子中央即可。
    const hx = { col: Math.min(FIELD_W-1, i*2), row: Math.min(FIELD_H-1, j*2) };
    const c = hexCenter(hx);
    const targetX = i * CELL_W + CELL_W / 2;
    const targetY = HEAD + j * CELL_H + CELL_H / 2;
    // 先按 1x 平移到目标位置，再整体 ZOOM
    ctx.save();
    ctx.setTransform(ZOOM, 0, 0, ZOOM, (targetX - c.x) * ZOOM, (targetY - c.y) * ZOOM);
    drawSpellFx.call({}, ctx, {
      hex: hx,
      // drain 的终点在右边两格外（真战斗里就是攻方站的位置）
      to: { col: Math.min(FIELD_W-1, i*2 + 2), row: Math.min(FIELD_H-1, j*2) },
      life: LIVES[j],
      color,
      kind,
    });
    ctx.restore();
  }
}

// 表头
ctx.setTransform(ZOOM,0,0,ZOOM,0,0);
ctx.fillStyle = '#e8dcc0';
ctx.font = 'bold 12px system-ui, sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
for (let i = 0; i < COL; i++) {
  ctx.fillText(KINDS[i][1], i * CELL_W + CELL_W / 2, HEAD / 2);
}
ctx.textAlign = 'left';
ctx.fillStyle = '#9c8f74';
ctx.font = '11px system-ui, sans-serif';
for (let j = 0; j < ROW; j++) {
  ctx.fillText('life=' + LIVES[j], 4, HEAD + j * CELL_H + 12);
}
ctx.fillStyle = '#6f6553';
ctx.fillText('列 = 形状（kind），行 = 动画进度（life 1→0）', 4, HEAD + ROW * CELL_H - 8);

document.title = 'fx-ready';
</script>`;

const tmp = resolve(DIST, '__fxsheet.html');
writeFileSync(tmp, html);

let code = 0;
try {
  await withHeadlessChrome(
    async ({ send, evaluate }) => {
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/__fxsheet.html` });
      // 等模块执行完（document.title 是唯一的完成信号）
      for (let i = 0; i < 120; i++) {
        const t = await evaluate('document.title').catch(() => '');
        if (t === 'fx-ready') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const title = await evaluate('document.title');
      if (title !== 'fx-ready') throw new Error(`页面没跑完（title=${title}）`);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
      console.log(`✓ 图纸：${OUT}`);
    },
    { devServerPort: PORT },
  );
} catch (e) {
  console.error(`✗ ${e.message}`);
  code = e.prerequisite ? 2 : 1;
} finally {
  try {
    const { rmSync } = await import('node:fs');
    rmSync(tmp, { force: true });
  } catch {
    /* 删不掉也不影响 */
  }
}
process.exit(code);
