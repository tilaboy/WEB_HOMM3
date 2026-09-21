#!/usr/bin/env node
/**
 * menushot.mjs —— 真 Chrome 打开本项目的真实 app、**点开底部「菜单」**、截图。
 *
 * 为什么单列一个：`chromeshot.mjs` 只"导航 + 截图"，**不注入交互**；而「菜单」得**点一下**
 * 才出现（`openMenu()` 是点击后 `createElement`）。team-lead 要 ④ 的「用户会看到什么不同」证据，
 * 菜单里「存档 / 读档」这一项只在点开后可见 ⇒ 必须能点。
 *
 * 走仓里唯一那套 CDP 胶水 `tools/_chrome.mjs`（真 Chrome + `--headless=new`），
 * 不自抄一份 Chrome 路径/端口/WebSocket（见 `_chrome.mjs` 头注）。
 *
 * 用法：
 *   npm run build
 *   node tools/menushot.mjs <输出.png>          # dev server 没跑会自起、结束关掉
 *
 * 退出码：0 成功 / 2 前置不满足 / 1 其他失败
 */
import { existsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { withHeadlessChrome, checkDevServer } from './_chrome.mjs';

const outFile = process.argv[2];
if (!outFile) {
  console.error('用法：node tools/menushot.mjs <输出.png>');
  process.exit(2);
}
const root = process.cwd();
if (!existsSync(path.join(root, 'dist', 'main.js'))) {
  console.error('dist/main.js 不存在，请先 npm run build');
  process.exit(2);
}

const PORT = Number(process.env.PORT ?? 5173);
const MOBILE = { w: 792, h: 320, dpr: 3 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** dev server 没在跑就自起（结束在 finally 关掉），跑着就借用、不动它。 */
let srv = null;
async function ensureServer() {
  if ((await checkDevServer(PORT)).ok) return;
  srv = spawn('node', [path.join(root, 'tools', 'serve.mjs')], {
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, PORT: String(PORT) },
  });
  for (let i = 0; i < 80; i++) {
    if ((await checkDevServer(PORT)).ok) return;
    await sleep(120);
  }
  throw new Error(`dev server 起不来（:${PORT}）`);
}

try {
  await ensureServer();
  const items = await withHeadlessChrome(
    async ({ send, evaluate }) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width: MOBILE.w,
        height: MOBILE.h,
        deviceScaleFactor: MOBILE.dpr,
        mobile: true,
      });
      await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?devquick=1` });
      for (let i = 0; i < 140; i++) {
        try {
          if (await evaluate(`!!document.querySelector('#thumb') && !!document.querySelector('#topbar')`)) break;
        } catch {
          /* 导航中上下文未就绪，继续等 */
        }
        await sleep(120);
      }
      await sleep(450); // 等首帧 + refresh() 写拇指带

      const opened = await evaluate(`(() => {
        const b = [...document.querySelectorAll('#thumb .btn')].find((x) => (x.textContent || '').includes('菜单'));
        if (!b) return false;
        b.click();
        return !!document.getElementById('menu');
      })()`);
      await sleep(300);

      const labels = await evaluate(
        `[...document.querySelectorAll('#menu .menu-item')].map((b) => b.textContent.trim())`,
      );
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      return { opened, labels: labels ?? [], data: shot.data };
    },
    { devServerPort: PORT, profilePrefix: 'menushot-' },
  );

  if (!items.opened) throw new Error('点了「菜单」却没出现 #menu');
  writeFileSync(outFile, Buffer.from(items.data, 'base64'));
  console.log(`菜单一级项 ${items.labels.length} 项：${items.labels.join(' / ')}`);
  console.log(`写出 ${outFile}`);
} catch (e) {
  console.error(e.prerequisite ? `[前置不满足] ${e.message}` : `[失败] ${e.message}`);
  process.exitCode = e.prerequisite ? 2 : 1;
} finally {
  if (srv && !srv.killed) srv.kill('SIGKILL');
}
