#!/usr/bin/env node
/**
 * tutorialgate.mjs —— 「首次启动直接进教学模式」这条**新生产路径**的门。
 *
 * ## 为什么必须有这把尺
 *
 * 2026-10-12 用户裁定：开局页砍到「一张地图卡 + 一个难度」，并「第一次进入直接进入
 * 教学场景，除非选择跳过，后面不用再有教学场选项」。
 *
 * 这条路径有**三个**必须同时成立的环节，少任何一个用户就卡死或被骗：
 *   ① 全新 profile（= 真用户第一次打开）打开 `/` ⇒ **直接进教学局**，看不到开始页；
 *   ② 教学局里**有出路**：菜单里有「跳过教学」，点了回到开始页（只剩破碎罗盘 + 难度）；
 *   ③ 跳过之后**不再回来**：同一个 profile 再开 `/` ⇒ 这次看到的是开始页，不是教学。
 *
 * ①②③ 里 ③ 最容易被漏掉 —— 它靠的是 `localStorage['homm-tutorial-done']`，
 * 而这个 key 写在 `main.ts` 里、不随存档走，任何"清理存档"的改动都可能顺手打断它。
 *
 * ## 用法
 *   npm run build
 *   node tools/tutorialgate.mjs
 *   NEG=1 node tools/tutorialgate.mjs      # 可证伪负测：判据必须都能红
 *
 * 退出码：0 全过 / 1 有 FAIL / 2 前置不满足
 *
 * ⚠️ 本工具**必须**跑在全新 Chrome profile 上才有意义（`_chrome.mjs` 每次
 *    `mkdtempSync` 一个临时目录 ⇒ 天然满足）。若改成复用 profile，① 的读数会假绿。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { distDir, printHeader, requireFile, freePort, serveInProcess } from './_dist.mjs';
import { withHeadlessChrome } from './_chrome.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=tutorialgate');
const NEG = process.env.NEG === '1';

/* 前置不满足一律 `2`（GATES.md §四.1）：构建缺开始页 ⇒ 读数作废，不要让它崩在 1。
 * 标记取本轮新进的 `ss-mapcard`（开局页唯一那张地图卡的 class）——
 * ⚠️ 别用 `devstart`：那个在 `main.ts`、编译进 `main.js`，**不在** `ui/StartScreen.js`
 *    （第一版放错文件 ⇒ 阳性对照失败 ⇒ 恒红；`androidsync` 已踩过同型）。 */
requireFile(DIST, 'ui/StartScreen.js');
if (!readFileSync(path.join(DIST, 'ui', 'StartScreen.js'), 'utf8').includes('ss-mapcard')) {
  console.error('✗ 前置不满足：构建的 ui/StartScreen.js 不含 `ss-mapcard` ⇒ 不含本轮精简后的开局页，读数无意义。');
  process.exit(2);
}

const PORT = await freePort();
await serveInProcess(DIST, PORT);
const URL0 = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let bad = 0;
const PASS = (c, m) => { if (!c) bad++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`); };
let negBad = 0;
const NEGPASS = (c, m) => { if (!c) negBad++; console.log(`[${c ? 'NEG-PASS' : 'NEG-FAIL'}] ${m}`); };

/** 等教学局起来（`#map` 在场、开始页已撤）。 */
const waitInGame = async (evaluate, tries = 90) => {
  for (let i = 0; i < tries; i++) {
    await sleep(150);
    try {
      if (await evaluate(`document.readyState === 'complete' && !document.querySelector('#start-screen') && !!document.querySelector('#map')`)) return i * 150;
    } catch { /* 导航中 */ }
  }
  return null;
};

/** 等开始页起来。 */
const waitStart = async (evaluate, tries = 90) => {
  for (let i = 0; i < tries; i++) {
    await sleep(150);
    try {
      if (await evaluate(`document.readyState === 'complete' && !!document.querySelector('#start-screen')`)) return true;
    } catch { /* 导航中 */ }
  }
  return false;
};

/** 打开菜单、点「跳过教学」（不存在就如实报 NOT_FOUND）。
 *  ⚠️ 菜单按钮的 `textContent` 是「菜单0」—— 未读角标 `menuBadge` 的数字也在里面
 *    （`main.ts:286-290`）。所以**不能**用 `=== '菜单'` 精确匹配，会永远 NOT_FOUND。 */
const skipViaMenu = (evaluate) => evaluate(`(() => {
  const mb = [...document.querySelectorAll('#thumb button')].find(b => (b.textContent || '').trim().startsWith('菜单'));
  if (!mb) return 'NO_MENU_BTN';
  mb.click();
  const items = [...document.querySelectorAll('#menu .menu-item')];
  const skip = items.find(b => (b.textContent || '').trim() === '跳过教学');
  if (!skip) return 'NO_SKIP_ITEM';
  skip.click();
  return 'OK';
})()`);

try {
  await withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Emulation.setDeviceMetricsOverride', { width: 792, height: 360, deviceScaleFactor: 3, mobile: true });

    if (NEG) {
      /* N1：判据①可红 —— 用 `?devstart=1`（跳过自动教学）进 ⇒ **不该**看到教学局。
       *    若它仍然红不了（两种路径都进教学），说明①的判据写错了 / 恒绿。 */
      await send('Page.navigate', { url: URL0 + '?devstart=1' });
      const t = await waitInGame(evaluate);
      NEGPASS(t === null, `N1 自动教学判据可红：带 ?devstart=1 ⇒ 不该进教学局（实测 ${t === null ? '确实没进' : t + 'ms 后进了'}）`);
      return;
    }

    /* ① 全新 profile 打开 `/` ⇒ 直接进教学局，看不到开始页 */
    await send('Page.navigate', { url: URL0 });
    const t1 = await waitInGame(evaluate);
    const ssGone = await evaluate(`!document.querySelector('#start-screen')`);
    const tut = await evaluate(`(() => { try { return JSON.parse(localStorage.getItem('homm-save-v1')).config.scenario; } catch { return null; } })()`);
    console.log(`[读数] 首次启动：进图=${t1 === null ? '超时' : t1 + 'ms'} · 开始页已撤=${ssGone} · scenario=${tut}`);
    PASS(t1 !== null, '① 首次启动直接进入对局（没有停在开始页）');
    PASS(tut === 'tutorial', `① 进的确实是教学模式（scenario=${tut}）`);

    /* ② 菜单里有「跳过教学」，点了回开始页 */
    const skipped = await skipViaMenu(evaluate);
    await sleep(400);
    const back = await waitStart(evaluate);
    console.log(`[读数] 菜单跳过 = ${skipped} · 回到开始页 = ${back}`);
    PASS(skipped === 'OK', `② 教学局菜单里有「跳过教学」且可点（实测 ${skipped}）`);
    PASS(back, '② 点完回到开始页');

    /* ③ 跳过之后不再回来：同一 profile 再开 `/` ⇒ 看到的是开始页 */
    await send('Page.navigate', { url: URL0 });
    const t2 = await waitInGame(evaluate);
    const back2 = await waitStart(evaluate);
    console.log(`[读数] 再次启动：进图=${t2 === null ? '没进（正确）' : t2 + 'ms'} · 开始页=${back2}`);
    PASS(t2 === null && back2, '③ 跳过之后不再自动进教学（看到开始页）');
    PASS(back2 && await evaluate(`!!document.querySelector('#start-screen .ss-mapcard')`), '③ 开始页上就是那张地图卡（本轮精简后的形态）');
  });
} catch (e) {
  console.error(`✗ 运行失败：${e && e.message ? e.message : e}`);
  process.exit(e && e.prerequisite ? 2 : 1);
}

console.log('---------------------------------------------');
console.log(bad === 0 ? '[总结] 教学模式首次进入门全过' : `[总结] FAIL ${bad} 条`);
process.exit(NEG ? (negBad ? 1 : 0) : bad ? 1 : 0);
