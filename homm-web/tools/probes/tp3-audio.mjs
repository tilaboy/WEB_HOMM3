/**
 * tp3-audio.mjs —— TP-3 音频的运行时实证探针（零依赖 CDP，非门控）。
 *
 * 回答的问题：**"真的有声音吗"** —— 不是"节点建了"（那只是代码跑了），而是
 * AudioContext 在跑、调度器在排音符、AnalyserNode 读到非零 RMS。
 *
 * 规格：design/audio-direction.md（R1 / §5.1 / §8.1 / Q3）。
 * 曲目不变量在 tools/tp3-scorecheck.mjs（纯 node，跑 dist 数据）——本探针只测运行时。
 *
 * 调试表面（?devprobe=1 才挂，零音质影响）：
 *   __audioDebug() → { ctx, masterRms, musicRms, voices, muted, musicOn, ambOn }
 *   __audioCtl     → { suspend, resume, setMuted, setMusicOn }
 *   __musicDebug() → { ctx, players[], notes, late, rest, suspendedTicks, ticks, voices, musicOn }
 *   __musicCtl     → { play, stop, sting }
 *
 * 四段：
 *   A. 真在有声：boot → __musicCtl.play('menu') → 等 ≥1.2s（调度器 lookahead 120ms +
 *      交叉淡入 0.7s 的尾巴）→ musicRms>0 且 masterRms>0 且 notes>0。
 *      ⚠️ headless Chrome 默认**没有音频输出设备**，ctx 会是 'suspended' 或
 *      'running' 取决于平台； RMS 读数是软件渲染的渲染量子（Chrome 即使无设备也
 *      会跑图），无设备时判 'running' 或 'suspended' 都接受，但**必须不是 'closed'**。
 *   B. R1 恢复守卫（硬）：__audioCtl.suspend() → 等 1.5s（这期间 tick 必须整段
 *      跳过：suspendedTicks 必须 >0，且 ctx.state==='suspended'）→ resume() →
 *      等 1.5s → suspendedTicks 停止增长、notes 继续增长（调度恢复）。
 *      R1 失效的症状是"恢复后几十个音符瞬间排成一片"（late 暴涨）或"再也不排"。
 *   C. 开关与闪避：setMusicOn(false) → musicRms 必须掉到 0（独立开关真的断了总线）；
 *      setMusicOn(true) 恢复。setMuted(true) → masterRms 必须掉到 0。
 *   D. 无缝循环（软）：循环 26s 内 players[0].pass 必须从 1 涨到 ≥2（menu 循环体
 *      ~92s ⇒ 26s 内应跨过曲尾进第 2 遍…… 见下面注释）。
 *      ⚠️ menu 整曲 96s（4 小节 intro + 40s 体），26s 内跨不了循环点 ⇒ 本段改成
 *      读调度器计数器的**稳态增长**（每秒排音符数 >0），证明"调度器活着"而不是
 *      "排了一波就死"。
 *
 * 用法：node tools/probes/tp3-audio.mjs [outDir]
 * 退出码：0 = A/B/C 全过（D 软项不判）；1 = 有硬断言失败；2 = 用法/环境错。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = process.argv[2] ?? '/tmp/tp3-audio';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0,
  fail = 0;
const ok = (m) => {
  pass++;
  console.log(`  ✅ ${m}`);
};
const bad = (m) => {
  fail++;
  console.log(`  ❌ ${m}`);
};
const warn = (m) => console.log(`  ⚠️ ${m}`);

/* ---------------- 自起 dev server ---------------- */
const APP_PORT = 39700 + (process.pid % 200);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const server = spawn('node', [path.join(ROOT, 'tools', 'serve.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT: String(APP_PORT) }, stdio: ['ignore', 'ignore', 'pipe'],
});
let serverLog = '';
server.stderr.on('data', (d) => { serverLog += d.toString(); });

/* ---------------- Chrome + CDP ---------------- */
const profile = mkdtempSync(path.join(tmpdir(), 'tp3audio-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=1', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${9700 + (process.pid % 100)}`, '--remote-allow-origins=*',
  '--window-size=1280,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'], detached: true });

let cleanedUp = false;
async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  for (const p of [chrome, server]) {
    try {
      if (chrome === p && p.pid) process.kill(-p.pid, 'SIGKILL');
    } catch { /* 组已不存在 */ }
    try { if (!p.killed) p.kill('SIGKILL'); } catch { /* 已退出 */ }
    await new Promise((resolve) => {
      if (p.exitCode !== null || p.signalCode !== null) return resolve();
      p.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
  }
  for (let i = 0; i < 5; i++) {
    try { rmSync(profile, { recursive: true, force: true }); return; } catch { await sleep(200); }
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { cleanup().finally(() => process.exit(130)); });
}

async function waitServer() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${BASE_URL}/`); if (r.ok) return true; } catch { /* 还没起 */ }
    await sleep(100);
  }
  return false;
}

async function findTarget() {
  const port = 9700 + (process.pid % 100);
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const t = list.find((x) => x.type === 'page' && (x.url.includes('127.0.0.1') || x.url === 'about:blank'));
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch { /* 端口还没开 */ }
    await sleep(100);
  }
  throw new Error('等不到 CDP target');
}

let ws, seq = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? '页面内异常');
  return r.result?.value;
}

try {
  if (!(await waitServer())) {
    console.error(serverLog.slice(0, 500));
    throw new Error(`dev server 起不来（${BASE_URL}）—— dist/ 构建了吗？`);
  }
  const wsUrl = await findTarget();
  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连不上')), { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');

  /* ============ A. 真在有声 ============ */
  console.log('\n=== A. 真在有声（AnalyserNode RMS；不是"节点建了"）===');
  // `?devstart=1` = 跳过首次自动教学，直接落到开始页（main.ts boot 段：门控专用入口）。
  // 开始页的 #ss-start 点击 = 用户手势 ⇒ AudioContext 合法解锁（§7 首屏不出声纪律）。
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.removeItem('homm-save-v1'); } catch {}`,
  });
  await send('Page.navigate', { url: `${BASE_URL}/?devstart=1&devprobe=1` });
  let clicked = false;
  for (let i = 0; i < 80; i++) {
    let st = null;
    try {
      st = await evaluate(
        `(() => { const b = document.querySelector('#ss-start'); return b ? 'start' : (document.querySelector('canvas') ? 'canvas' : 'boot'); })()`,
      );
    } catch { /* 导航中 */ }
    if (st === 'start') {
      const box = await evaluate(`(() => { const b = document.querySelector('#ss-start').getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2 }; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      clicked = true;
      break;
    }
    if (st === 'canvas') break; // 没开始页也有画布（不应发生；防御）
    await sleep(150);
  }
  if (!clicked) throw new Error('等不到 #ss-start（?devstart=1 没生效？）—— 无用户手势则 ctx 永不 running，A 段无从验');

  // headless Chrome 无音频设备 ⇒ 合成点击不一定能把 ctx 推成 running。
  // A 段真正要证的是"链路通"：调一次 resume 之后（无手势也行，headless 允许），
  // 调度器必须排上音符、总线必须有 RMS。若仍 suspended ⇒ 记 ⚠️ 并继续往下走
  // （B 段显式 resume 后会把 running 拿到手，A 的硬判挪到 B 之后重取一次）。
  await evaluate(`window.__audioCtl && window.__audioCtl.resume()`);
  await sleep(400);

  const dbg0 = await evaluate(`window.__audioDebug ? window.__audioDebug() : null`);
  if (!dbg0) throw new Error('__audioDebug 没暴露 —— devprobe 参数没生效还是 bus.ts 的调试表面被裁了？');
  console.log(`  点击+resume 后音频状态：ctx=${dbg0.ctx}`);

  // __musicCtl 显式播 menu：不依赖场景接线顺序（boot 已由 openStart 播过 menu，
  // 这里显式再调一次也幂等 —— play() 同一首在播就返回）。
  await evaluate(`window.__musicCtl && window.__musicCtl.play('menu')`);
  await sleep(1400); // lookahead 120ms + 淡入 700ms 的尾巴
  const d1 = await evaluate(`window.__audioDebug ? window.__audioDebug() : null`);
  const m1 = await evaluate(`window.__musicDebug ? window.__musicDebug() : null`);
  if (!d1 || !m1) throw new Error('播放中丢了调试表面');
  console.log(`  ctx=${d1.ctx} · masterRms=${d1.masterRms.toFixed(5)} · musicRms=${d1.musicRms.toFixed(5)} · 音符已排=${m1.notes} · voices=${d1.voices} · players=${m1.players.length}`);

  if (d1.ctx === 'closed') bad(`AudioContext 被关闭（ctx=closed）—— 图被系统回收了？`);
  else ok(`AudioContext 活着（ctx=${d1.ctx}）`);
  if (m1.notes > 0) ok(`调度器排了 ${m1.notes} 个音符（lookahead 真的在跑）`);
  else bad('一个音符都没排 —— 调度器没起来（音乐引擎挂了？ctx 仍挂起？__musicCtl.play 被吃掉？）');
  if (d1.musicRms > 0.0001) ok(`busMusic RMS = ${d1.musicRms.toFixed(5)} > 0 —— 真的有模拟音频在流`);
  else bad(`busMusic RMS = ${d1.musicRms.toFixed(5)} —— 音符排了但总线没声（开关断了？总线接错？）`);
  if (d1.masterRms > 0.0001) ok(`master RMS = ${d1.masterRms.toFixed(5)} > 0 —— 信号通到总线末端`);
  else bad(`master RMS = ${d1.masterRms.toFixed(5)} —— 音乐有、总线上没有（master/compressor 接反了？静音开着？）`);
  if (d1.voices > 0 && d1.voices <= 16) ok(`voice 池 ${d1.voices}/16（§8.1 上限内）`);
  else if (d1.voices > 16) bad(`voice 池 ${d1.voices} > 16 —— 抢占最旧没生效`);
  else warn(`voice 池 ${d1.voices}（音符在排但瞬时 voice 为 0？看 late=${m1.late}）`);

  /* ============ B. R1 恢复守卫 ============ */
  console.log('\n=== B. R1 恢复守卫（suspend 期间不许排音符；恢复后不雪崩）===');
  await evaluate(`window.__audioCtl && window.__audioCtl.suspend()`);
  await sleep(1500);
  const d2 = await evaluate(`window.__audioDebug ? window.__audioDebug() : null`);
  const m2 = await evaluate(`window.__musicDebug ? window.__musicDebug() : null`);
  console.log(`  suspend 1.5s 后：ctx=${d2.ctx} · suspendedTicks=${m2.suspendedTicks} · notes=${m2.notes}（+${m2.notes - m1.notes}）`);
  if (m2.suspendedTicks > m1.suspendedTicks) ok(`suspend 期间调度器跳过了 ${m2.suspendedTicks - m1.suspendedTicks} 个 tick（R1 第一道：非 running 直接返回）`);
  else bad('suspend 期间 tick 没有跳过 —— 调度器不看 ctx.state，会把音符排到"过去"（R1 破了）');
  const notesDuringSuspend = m2.notes - m1.notes;
  if (notesDuringSuspend === 0) ok('suspend 期间零新音符');
  else bad(`suspend 期间还排了 ${notesDuringSuspend} 个音符 —— 恢复瞬间会一起炸（R1 第二道也破了）`);

  await evaluate(`window.__audioCtl && window.__audioCtl.resume()`);
  await sleep(1500);
  const d3 = await evaluate(`window.__audioDebug ? window.__audioDebug() : null`);
  const m3 = await evaluate(`window.__musicDebug ? window.__musicDebug() : null`);
  const notesAfter = m3.notes - m2.notes;
  console.log(`  resume 1.5s 后：ctx=${d3.ctx} · suspendedTicks=${m3.suspendedTicks} · notes=${m3.notes}（+${notesAfter}）· late=${m3.late}`);
  if (notesAfter > 0) ok(`恢复后排了 ${notesAfter} 个音符（调度器活着）`);
  else bad('恢复后一个音符都不排 —— rebaseAll 把播放器基到未来/过去卡死了');
  // 恢复瞬间若把 suspend 期间攒下的量一次性排出来，notes 增量会是正常速率的数倍
  // （正常 ~0.4-1.5 个/100ms tick；雪崩时 >20）。
  if (notesAfter > 40) bad(`恢复 1.5s 排了 ${notesAfter} 个音符 —— 像雪崩（rebaseAll 没把时间基续上）`);
  else ok(`恢复节奏正常（1.5s / ${notesAfter} 个，无积压爆发）`);
  if (m3.late === 0) ok('零迟到跳过（late=0）');
  else warn(`late=${m3.late}（迟到跳过；resume 首帧有 <1 个属正常）`);

  /* ============ C. 独立开关 ============ */
  console.log('\n=== C. 独立开关（homm.music / homm.mute，Q3）===');
  await evaluate(`window.__audioCtl && window.__audioCtl.setMusicOn(false)`);
  await sleep(900);
  const d4 = await evaluate(`window.__audioDebug ? window.__audioDebug() : null`);
  console.log(`  音乐关：musicOn=${d4.musicOn} · musicRms=${d4.musicRms.toFixed(5)} · masterRms=${d4.masterRms.toFixed(5)}`);
  if (d4.musicRms <= 0.00001) ok('homm.music=off ⇒ busMusic RMS 归零（总线真的断了，不是只拧了播放器 gain）');
  else bad(`音乐关了但 musicRms=${d4.musicRms.toFixed(5)} —— 开关没作用到总线（拧错层了？）`);

  await evaluate(`window.__audioCtl && window.__audioCtl.setMusicOn(true)`);
  await sleep(900);
  const d5 = await evaluate(`window.__audioDebug ? window.__audioDebug() : null`);
  console.log(`  音乐开：musicRms=${d5.musicRms.toFixed(5)}`);
  if (d5.musicRms > 0.0001) ok('重新打开音乐恢复出声');
  else bad('重开音乐后 musicRms 仍为 0 —— 开关不可逆（busMusic.gain 被写成 0 后没恢复）');

  await evaluate(`window.__audioCtl && window.__audioCtl.setMuted(true)`);
  await sleep(600);
  const d6 = await evaluate(`window.__audioDebug ? window.__audioDebug() : null`);
  console.log(`  总静音：muted=${d6.muted} · masterRms=${d6.masterRms.toFixed(5)}`);
  if (d6.masterRms <= 0.00001) ok('homm.mute=1 ⇒ master RMS 归零');
  else bad(`总静音后 masterRms=${d6.masterRms.toFixed(5)} —— 静音没作用到 master`);
  await evaluate(`window.__audioCtl && window.__audioCtl.setMuted(false)`);
  await sleep(600);
  const d7 = await evaluate(`window.__audioDebug ? window.__audioDebug() : null`);
  if (d7.masterRms > 0.0001) ok('解除静音恢复出声');
  else warn(`解除静音后 masterRms=${d7.masterRms.toFixed(5)}（淡入尾巴没跟上？给调度器 1s 再看）`);

  /* ============ D. 调度器稳态（软） ============ */
  console.log('\n=== D. 调度器稳态增长（软项：证明不是"排一波就死"）===');
  const s1 = await evaluate(`window.__musicDebug ? window.__musicDebug().notes : -1`);
  await sleep(3000);
  const s2 = await evaluate(`window.__musicDebug ? window.__musicDebug().notes : -1`);
  const rate = (s2 - s1) / 3;
  console.log(`  3s 内 notes ${s1} → ${s2}（${rate.toFixed(2)} 个/秒）`);
  if (rate > 0.2) ok(`调度器稳态 ${rate.toFixed(2)} 音符/秒（menu 84bpm 多轨，量级合理）`);
  else warn(`稳态速率 ${rate.toFixed(2)}/s 偏低（软项不判失败；可能正撞上 rest 段）`);

  await cleanup();
  console.log(`\n${fail === 0 ? '✅' : '❌'} TP-3 音频运行时实证：${pass} 过 / ${fail} 不过`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error('\n💥 探针异常：', e.message);
  await cleanup();
  process.exit(2);
}
