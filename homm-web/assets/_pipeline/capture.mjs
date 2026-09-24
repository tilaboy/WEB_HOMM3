/**
 * capture.mjs —— 抓「改前」= 项目**真实**的开局第一屏（headless Chrome，借仓里的 CDP 胶水）。
 *
 * 只读：不动 `dist/`、不改 `src/`；产出落 `assets/_pipeline/out/`（自己的写域）。
 * 两个视口都抓：
 *   - `b_before_phone.png` 792×320@DPR2 —— 用户真机那个**横屏**视口（同一屏只有设置栏）
 *   - `b_before_raw.png`   1440×810@DPR1 —— 桌面宽视口（左设置栏 + 右预览都进画面），供 mockup 摆图
 */
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHeadlessChrome, checkDevServer } from '../../tools/_chrome.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'out');
const PORT = Number(process.env.PORT ?? 5288);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let srv = null;
async function ensureServer() {
  if ((await checkDevServer(PORT)).ok) return;
  srv = spawn('node', [path.join(WEB, 'tools', 'serve.mjs')], {
    stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT) },
  });
  for (let i = 0; i < 80; i++) {
    if ((await checkDevServer(PORT)).ok) return;
    await sleep(120);
  }
  throw new Error('serve 起不来');
}

const VIEWS = [
  { name: 'b_before_phone.png', w: 792, h: 320, dpr: 2, mobile: true },
  { name: 'b_before_raw.png', w: 1440, h: 810, dpr: 1, mobile: false },
];

try {
  await ensureServer();
  for (const v of VIEWS) {
    const res = await withHeadlessChrome(
      async ({ send, evaluate }) => {
        await send('Emulation.setDeviceMetricsOverride', {
          width: v.w, height: v.h, deviceScaleFactor: v.dpr, mobile: v.mobile,
        });
        await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
        for (let i = 0; i < 140; i++) {
          try {
            if (await evaluate(`!!document.getElementById('start-screen')`)) break;
          } catch { /* 导航中 */ }
          await sleep(120);
        }
        await sleep(1200);
        const geo = await evaluate(`(() => {
          const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect();
            return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
          return { root: r('#start-screen'), panel: r('.ss-panel'), preview: r('.ss-preview') };
        })()`);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        return { geo, data: shot.data };
      },
      { devServerPort: PORT, profilePrefix: 'caps-' },
    );
    writeFileSync(path.join(OUT, v.name), Buffer.from(res.data, 'base64'));
    console.log(`${v.name}  ${v.w}x${v.h}@DPR${v.dpr}  geo=${JSON.stringify(res.geo)}`);
  }
} catch (e) {
  console.error('[fail]', e.message);
  process.exitCode = 1;
} finally {
  if (srv && !srv.killed) srv.kill('SIGKILL');
}
