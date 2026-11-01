#!/usr/bin/env node
/**
 * cardsheet.mjs —— 兵牌目视证据（S2 · 22×30 立绘 / 48px 行高）。
 *
 * 出两张图，都是给眼睛看的，不判过否：
 *   ① `card-6x.png`：**真实 DOM** 里的一张卡，6× 裁切（描边是不是 1px 连续、血条是不是通栏、
 *      数量是不是真贴在右下角 —— 这些 rect 判据都量不出"像不像"）；
 *   ② `portraits-8x.png`：4 支代表兵的立绘帧，1× 原尺寸 + 8× nearest 并排
 *      （22×30 上"还认不认得出人"只能看这张）。
 *
 * 用法：`node tools/cardsheet.mjs <outdir>`（默认 /tmp/cardsheet）
 * 前置：`npm run build` + 一个 dev server（`PORT=5199 node tools/serve.mjs`）。
 *
 * ⚠️ 裁切坐标**从页面实测的 rect 取**，不写死。写死过一次：`.bt-side-list` 会
 *    `revealActive()` 自动滚到当前行动的那一支，第一张卡的 y 随战局变，
 *    写死 (15,20) 裁出来的是左上角那枚回合胶囊（"第1回合 法力30"）的大字。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withHeadlessChrome } from './_chrome.mjs';

const OUT = process.argv[2] ?? '/tmp/cardsheet';
const PORT = Number(process.env.PORT ?? 5199);
const BASE = `http://127.0.0.1:${PORT}/?devbattle=full&devseed=20260913`;
mkdirSync(OUT, { recursive: true });

await withHeadlessChrome(
  async ({ send, evaluate }) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 792,
      height: 320,
      deviceScaleFactor: 3,
      mobile: true,
    });
    await send('Page.navigate', { url: BASE });
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (await evaluate(`!!document.querySelector('.bt-side-row .pt')`)) break;
    }
    await new Promise((r) => setTimeout(r, 400));

    const rows = await evaluate(`(() => [...document.querySelectorAll('.bt-side-row')].map((r) => {
      const b = r.getBoundingClientRect();
      const label = r.getAttribute('aria-label') || (r.title || '');
      /* 名字从 aria-label 取（牌上已经没有 .n）；反斜杠要双写 ——
         这段是模板字符串，单写会被 Node 先吃掉，页面收到的是 /s*×d+$/。 */
      return { name: label.replace(/\\s*×\\d+$/, ''), x: b.x, y: b.y, w: b.width, h: b.height,
        url: getComputedStyle(r.querySelector('.pt')).backgroundImage };
    }))()`);

    /* ① 单卡 6×：挑第 2 张（第 1 张常被自动滚动切掉上沿），四周各留 3px 看卡边。 */
    const card = rows[1] ?? rows[0];
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: card.x - 3, y: card.y - 3, width: card.w + 6, height: card.h + 6, scale: 6 },
      captureBeyondViewport: false,
    });
    writeFileSync(join(OUT, 'card-6x.png'), Buffer.from(shot.data, 'base64'));
    console.log(`① card-6x.png  ${card.name} @ (${card.x},${card.y}) ${card.w}×${card.h}`);

    /* ② 立绘 1× / 8×：挑一支矮、一支宽体、一支飞行、一支巨物，四档都在。 */
    const pick = ['矮人', '三头狼', '鹰', '绿龙'];
    const items = rows
      .filter((r) => pick.includes(r.name))
      .map((r) => ({ name: r.name, url: /url\("?(data:image\/[^")]+)"?\)/.exec(r.url)?.[1] ?? '' }))
      .filter((r) => r.url);
    if (!items.length) {
      console.error('✗ 没取到立绘 data URL（页面结构变了？）');
      process.exit(2);
    }
    const cells = items
      .map(
        (it) => `<figure>
  <div class="pair"><img class="one" src="${it.url}"><img class="big" src="${it.url}"></div>
  <figcaption>${it.name} · 左 1× 原尺寸 · 右 8× nearest</figcaption>
</figure>`,
      )
      .join('\n');
    const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0c0803;color:#f0e0c0;font:13px/1.4 "Palatino","Songti SC",serif;
  padding:14px 16px;display:flex;flex-wrap:wrap;gap:16px}
figure{margin:0;background:rgba(12,8,3,.62);border-radius:5px;padding:8px 10px;
  box-shadow:inset 0 1px 0 rgba(255,232,170,.1)}
.pair{display:flex;align-items:center;gap:10px}
img{image-rendering:pixelated;image-rendering:crisp-edges}
.one{width:22px;height:30px}
.big{width:176px;height:240px}
figcaption{font-size:11px;opacity:.75;margin-top:4px}
</style>${cells}`;
    await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
    await new Promise((r) => setTimeout(r, 400));
    const sheet = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(OUT, 'portraits-8x.png'), Buffer.from(sheet.data, 'base64'));
    console.log(`② portraits-8x.png  ${items.map((i) => i.name).join(' / ')}`);
  },
  { devServerPort: PORT },
);
