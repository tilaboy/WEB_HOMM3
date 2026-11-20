/**
 * 满城建制设计稿探针（2026-11-20）。
 *
 * 用户问的是「每种族建满了是什么样」，不是「中期 6/16 座是什么样」。
 * 旧的 `town-factions` 四张实拍只建了开局几座（右侧还留着空地基），
 * 不能回答这个问题。这里用 `?devtownfull=1` 把 16 块地全部建成、
 * 五座兵营拉到 Lv.3、wall1/2/3 全建（远景城堡取 Lv.3），
 * 再配 `?devtownowner=pX` 出四族各一张 844×390 真机尺寸实拍。
 *
 * 这不是新玩法：`devtownfull` 只改这一局运行时状态，不进存档、不改建造规则。
 * 闸门要证的是三件容易假绿的事：
 *   [F1] 真的 16/16 建成（不是把默认 6/16 换个标题）；
 *   [F2] 五座兵营真的 Lv.3、城墙真的 Lv.3（"满级"不是只把空地填平）；
 *   [F3] 负向臂不传 devtownfull 时必须有空地基 —— 否则这个门恒绿。
 *
 * 用法：node tools/probes/townfull.mjs [--gate] [--shot=<dir>]
 * 退出码：不给 --gate 只报读数；给 --gate 时 0=全过 / 1=FAIL / 2=前置不满足。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { argOf, distDir, printHeader, requireFile } from '../_dist.mjs';
import { withHeadlessChrome, cdpPort } from '../_chrome.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DIST = distDir();
printHeader(DIST, 'gate=townfull');
requireFile(DIST, 'render/townSceneArt.js');
requireFile(DIST, 'ui/TownDialog.js');
requireFile(DIST, 'main.js');

const GATE = process.argv.includes('--gate');
const SHOT_DIR = argOf('shot') ?? path.join(ROOT, '../production/town-factions-2026-11-19/full');
mkdirSync(SHOT_DIR, { recursive: true });

const OWNERS = ['p1', 'p2', 'p3', 'p4'];
const APP_PORT = 5200 + (process.pid % 300);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
let prereqFailed = false;
function record(id, title, ok, detail = '') {
  if (!ok) fails++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] [${id}] ${title}${detail ? ` — ${detail}` : ''}`);
}

const server = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT: String(APP_PORT) }, stdio: ['ignore', 'ignore', 'pipe'],
});
let serverLog = '';
server.stderr.on('data', (d) => { serverLog += d.toString(); });

const VIEW_EXPR = `(() => {
  const slots = [...document.querySelectorAll('.tv-world .tv-plot')];
  const built = slots.filter((s) => s.dataset.plot !== '__castle' && s.classList.contains('built'));
  const unbuilt = slots.filter((s) => s.classList.contains('unbuilt'));
  const frames = built.map((s) => s.dataset.frame ?? '');
  const owner = (frames.find((f) => f.startsWith('scene_')) ?? '').split('_')[1] ?? '';
  return {
    slots: slots.length,
    built: built.length,
    unbuilt: unbuilt.length,
    u3: frames.filter((f) => f.includes('_u3')).length,
    owner,
    castle: document.querySelector('.tv-castle-hot')?.dataset.frame ?? '',
    outside: slots.filter((s) => {
      const r = s.getBoundingClientRect();
      return r.left < -1 || r.right > window.innerWidth + 1 ||
        r.top < -1 || r.bottom > window.innerHeight + 1;
    }).length,
    /* 真出图边界：plot 的按钮框没越窗不代表 80px 建筑图没被 stage 切掉。 */
    imgClip: (() => {
      const p = document.querySelector('.tv-stage').getBoundingClientRect();
      return [...document.querySelectorAll('.tv-plot.built img')].filter((i) => {
        const r = i.getBoundingClientRect();
        return r.left < p.left - 1 || r.right > p.right + 1 ||
          r.top < p.top - 1 || r.bottom > p.bottom + 1;
      }).length;
    })(),
  };
})()`;

async function openScene(send, evaluate, full, owner = 'p1') {
  await send('Page.navigate', {
    url: `${BASE_URL}/?devquick=1&devtown=1${full ? '&devtownfull=1' : ''}&devtownowner=${owner}&devtownanim=0`,
  });
  for (let i = 0; i < 120; i++) {
    try { if (await evaluate(`!!document.querySelector('.town-view-toggle')`)) break; } catch { /* 导航中 */ }
    await sleep(100);
  }
  const toggle = await evaluate(`!!document.querySelector('.town-view-toggle')`);
  if (!toggle) return { toggle: false, scene: false };
  await evaluate(`document.querySelector('.town-view-toggle').click()`);
  for (let i = 0; i < 80; i++) {
    try { if (await evaluate(`!!document.querySelector('.townview')`)) break; } catch { /* 重绘中 */ }
    await sleep(100);
  }
  await sleep(350);
  return { toggle: true, scene: await evaluate(`!!document.querySelector('.townview')`) };
}

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE_URL)).ok) break; } catch { /* 服务还没起 */ }
    await sleep(100);
  }
  const result = await withHeadlessChrome(async ({ send, evaluate }) => {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); } catch {}` });
    await send('Emulation.setDeviceMetricsOverride', {
      width: 844, height: 390, deviceScaleFactor: 1, mobile: true,
    });
    const out = {};
    for (const owner of OWNERS) {
      const opened = await openScene(send, evaluate, true, owner);
      if (!opened.scene) return { err: `${owner} 城景没打开`, opened };
      out[owner] = await evaluate(VIEW_EXPR);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(path.join(SHOT_DIR, `full-${owner}-844x390.png`), Buffer.from(shot.data, 'base64'));
      const rect = await evaluate(`(() => {
        const r = document.querySelector('.tv-stage').getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height), scale: 1 };
      })()`);
      const stage = await send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: false, clip: rect,
      });
      writeFileSync(path.join(SHOT_DIR, `fullstage-${owner}.png`), Buffer.from(stage.data, 'base64'));
    }
    out.negative = await openScene(send, evaluate, false, 'p1');
    if (out.negative.scene) out.negative.view = await evaluate(VIEW_EXPR);
    return out;
  }, { port: cdpPort(9850, 150), devServerPort: APP_PORT });

  if (result.err) {
    record('F0', 'Chrome / 城景前置', false, `${result.err}（${JSON.stringify(result.opened)}）`);
  } else {
    for (const owner of OWNERS) {
      const v = result[owner];
      record(`${owner}-1`, '16/16 建成、零空地基、零越界/切边',
        v.slots === 16 && v.built === 16 && v.unbuilt === 0 && v.outside === 0 && v.imgClip === 0,
        `地块 ${v.slots} · built ${v.built} · unbuilt ${v.unbuilt} · 越窗 ${v.outside} · 切边 ${v.imgClip}`);
      record(`${owner}-2`, '五座兵营 Lv.3、城墙 Lv.3（满级而不只是填满）',
        v.u3 === 5 && v.castle === `tv_${owner}_castle_lv3`,
        `u3 ${v.u3}/5 · 城堡 ${v.castle}`);
      record(`${owner}-3`, '建筑帧确实用了指定族的美术骨架',
        v.owner === owner, `帧族 ${v.owner}`);
    }
    const neg = result.negative;
    record('NEG', '不传 devtownfull 必须有空地基（门不能恒绿）',
      neg.toggle && neg.scene && neg.view.built < 16 && neg.view.unbuilt > 0,
      `built ${neg.view?.built} · unbuilt ${neg.view?.unbuilt}`);
    const shots = OWNERS.flatMap((o) => [
      path.join(SHOT_DIR, `full-${o}-844x390.png`),
      path.join(SHOT_DIR, `fullstage-${o}.png`),
    ]);
    record('SHOT', '四族满建实拍与舞台裁图全部落盘',
      shots.every((f) => { try { return statSync(f).size > 10000; } catch { return false; } }),
      `${shots.length} 张 → ${SHOT_DIR}`);
  }
} catch (e) {
  record('F0', '服务 / Chrome 前置', false, `${e.message}${serverLog ? ` · ${serverLog.slice(-200)}` : ''}`);
  prereqFailed = true;
} finally {
  server.kill('SIGKILL');
}

console.log(`\n合计：${fails === 0 ? '全过' : `${fails} 条 FAIL`}`);
if (GATE) process.exitCode = prereqFailed ? 2 : (fails > 0 ? 1 : 0);
