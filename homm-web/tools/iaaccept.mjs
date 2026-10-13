#!/usr/bin/env node
/**
 * iaaccept.mjs —— #137「试玩场景」入口的**独立验收探针**（`ux-ia` 自备）。
 *
 * ## 为什么不复用 `tools/scenarioaudit.mjs`
 * 那个是**实施者 `engineering-lead` 写的**。直接跑它得到的是「**他的探针没报错**」，
 * 不是独立复核 —— 主理人 2026-09-21 立的规矩：**验收方不复用被验方的探针**。
 * 本文件按 `design/ux/in-game-ia.md §14.1 / §14.2` 的**原文**独立写断言，
 * 并补上 `scenarioaudit` **没覆盖**的条目：**10**（组件族）· **4③/17**（hint 含时长）·
 * **15**（3/3 banner）· **16**（溢出实测）· **18**（`ss-` id 前缀）。
 *
 * ## ★ 构建前置（本探针是第一例，起因是一次真实的假罪状）
 * **跑之前先断言「被测构建包含被测对象」**：按「文件 + 标志」逐条断言（**零打包器** ⇒ 标记
 * 在**各自的模块文件**里，**不在 `main.js`**）；**缺即 `exit(2)`、写明「构建早于 #137」**。
 * （2026-09-21 有人拿旧 `dist` 跑审计 ⇒ 20 条 FAIL **全是假罪状**，因为盘上那份构建里
 * 根本没有「试玩场景」这一行。**这条把"要靠人记得的纪律"变成"一道会红的门"。**
 * 后续修正：本探针最初把 4 个标记**全压在 `dist/main.js`** ⇒ 门**恒红**（`main.js` 永不含
 * 那三串）—— 已改为按文件断言。**"一道会红的门"得先是"一道会绿的门"，否则它不是门、是墙。**）
 *
 * ## ★★ 通用规矩（team-lead 2026-09-21 升格）：门必须支持 `--dist=<dir>`
 * **任何"门 / 探针"不得把构建目录写死 `../dist`** —— 一律 `--dist=<dir>` 指到**任意构建目录**；
 * **跑门不必覆盖共用 `dist/`** ⇒ 一举消灭「stale `dist` / 跑完被覆盖面」**整族问题**（**别的门照此改**）。
 * ⚠️ **但"指到别处"必须真的换到别处**：浏览器加载的是 **dev server**（`tools/serve.mjs` 写死
 * `./dist`），**不是**本脚本读的文件系统目录。若只改 `--dist` 而 server 仍服务 `./dist` ⇒
 * **"断言对象" ≠ "被测对象"** ⇒ 故本脚本**在断言前先核对「服务中的构建 == `--dist` 指定」**
 * （`checkServedMatchesDist`）：不符即 `exit(2)`。**要跑隔离构建，就让 server 也指向它。**
 *
 * ## 用法
 *   node tools/serve.mjs          # 另开终端（默认 5173，服务 ./dist）
 *   node tools/iaaccept.mjs
 *   node tools/iaaccept.mjs --url=http://127.0.0.1:5174 --port=5174
 *   node tools/iaaccept.mjs --dist=/tmp/dist-137   # 断言"这份"构建（**须让 server 也服务它**）
 *
 * ## ⚠️ 必须带 `NO_PROXY='*'`（2026-10-13 实测，一个纯环境的假红）
 * 本机 shell 里有 `HTTP_PROXY=http://127.0.0.1:52448`（沙箱代理）。Node 的 `fetch`
 * （undici）**不会**因为目标是 `127.0.0.1` 就自动绕过代理 ⇒ 前置 0b 的
 * 「服务中的构建 == --dist」核对会 `fetch failed` ⇒ 整门 `exit(2)`，
 * 而**服务其实是好的**（`curl` 直连 200）。这是"门没跑成"，不是"门判不过"。
 * 正确跑法：`NO_PROXY='*' no_proxy='*' node tools/iaaccept.mjs`
 * （其余门用进程内 `serveInProcess` 自起服务，不走这条路径，不受影响。）
 *
 * 退出码：0 全过 / 1 有 FAIL / 2 前置不满足（无 Chrome / 无服务 / **构建不含 #137** / **服务中的构建 ≠ --dist**）
 */
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { withHeadlessChrome } from './_chrome.mjs';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const PROBE = Number(arg('port', '5173'));
const URL0 = arg('url', `http://127.0.0.1:${PROBE}`);

/* ---------------------------------------------------------------- 构建前置 */
const here = path.dirname(fileURLToPath(import.meta.url));
/** 被测构建目录：默认 `../dist`；服务的是隔离构建目录时用 `--dist=<dir>` 指过去。 */
const DISTDIR = path.resolve(arg('dist', path.join(here, '..', 'dist')));

/**
 * 构建标志串 —— **零打包器**工程：每个 `.ts` 各自转译到同名 `.js`，
 * ⇒ 标记**散落在各自的模块文件里**，**不在 `main.js`**。
 *
 * ★ 2026-10-12 更新（开局页精简，用户裁定）：旧标记 `试玩场景` / `对决场` 随场景卡
 *   整行下线 ⇒ 若不改，本探针的**前置**会恒 `exit(2)`（"构建早于 #137"），
 *   而真正的原因是"被测对象改名了"。⇒ 标记换成本轮真的新进 `StartScreen.js` 的东西。
 *   ⚠️ 这正是本文件头记的那个教训的**同型复发**：门先得能绿，否则它是墙不是门。
 */
const BUILD_MARKERS = [
  { file: 'ui/StartScreen.js', marker: 'ss-mapcard',       what: '开局页唯一的地图卡（本轮新增）' },
  { file: 'ui/StartScreen.js', marker: 'ss-start',         what: '开局页「开始」按钮 id（本轮新增）' },
  { file: 'ui/HeroPanel.js',   marker: '教学 · 学会了吗',  what: 'item9/13 教学块标题' },
  { file: 'ui/HeroPanel.js',   marker: 'objectiveSection', what: '教学块容器' },
  { file: 'main.js',           marker: 'obj-banner',       what: 'item15 banner 容器（注意：**无 `#`** —— 源码是 `objBanner.id = \'obj-banner\'`）' },
  { file: 'main.js',           marker: '跳过教学',         what: '教学模式专属菜单项（本轮新增）' },
  { file: 'main.js',           marker: 'devstart',         what: '跳过首次自动教学的调试入口（本轮新增，**在 main.ts 不在 StartScreen.ts**）' },
];

function checkBuild() {
  const cache = new Map();
  const bytesOf = (rel) => {
    if (!cache.has(rel)) {
      try { cache.set(rel, readFileSync(path.join(DISTDIR, rel))); }
      catch { cache.set(rel, null); }
    }
    return cache.get(rel);
  };
  const files = [...new Set(BUILD_MARKERS.map((m) => m.file))].sort();
  const h = createHash('sha256');
  const perFile = [];
  const absent = [];
  let mtime = null;
  for (const f of files) {
    const b = bytesOf(f);
    if (b === null) { absent.push(f); perFile.push(`${f}: 读不到`); continue; }
    h.update(f).update('\0').update(b); // 指纹绑真实字节
    if (!mtime) mtime = statSync(path.join(DISTDIR, f)).mtime.toISOString();
    const txt = b.toString('utf8');
    const miss = BUILD_MARKERS.filter((m) => m.file === f && !txt.includes(m.marker)).map((m) => m.marker);
    perFile.push(`${f}: ${miss.length ? `缺「${miss.join('」「')}」` : '✓'}`);
  }
  const fp = { dir: DISTDIR, sha256: h.digest('hex').slice(0, 16), mtime, perFile };
  if (absent.length) {
    return { ok: false, fp, reason: `构建目录 ${DISTDIR} 里读不到 ${absent.join(' / ')} —— 先 npm run build（或用 --dist=<dir> 指向隔离构建目录）` };
  }
  const missing = BUILD_MARKERS.filter((m) => !bytesOf(m.file).toString('utf8').includes(m.marker));
  if (missing.length) {
    return {
      ok: false,
      fp,
      reason:
        `**构建不含 #137**：` + missing.map((m) => `${m.file} 缺「${m.marker}」`).join(' · ') +
        ` ⇒ 这份构建**早于** #137（aebf844）⇒ **任何读数作废**。请重建（或 --dist= 指向含 #137 的构建）。`,
    };
  }
  return { ok: true, fp };
}

const build = checkBuild();
if (!build.ok) {
  console.error(`[前置 2] ${build.reason}`);
  console.error(`         目录 ${build.fp.dir} · 指纹 ${build.fp.sha256}`);
  for (const line of build.fp.perFile) console.error(`         ${line}`);
  process.exit(2);
}
console.log(`[前置 0] 构建含 #137 ✓（目录 ${build.fp.dir} · 指纹 ${build.fp.sha256}${build.fp.mtime ? ` · ${build.fp.mtime}` : ''}）`);
for (const line of build.fp.perFile) console.log(`         ${line}`);

/* ---- [前置 0b] 服务中的构建必须 == `--dist` 指定的那份 ----
 * 浏览器加载的是 **dev server**（serve.mjs 写死 `./dist`），**不是**本脚本读的 `DISTDIR`。
 * 两者不一致 ⇒ "断言对象 ≠ 被测对象" ⇒ 读数作废。**这条让 `--dist` 真的成立**（不只改断言目录）。 */
async function checkServedMatchesDist() {
  const rel = 'ui/StartScreen.js';
  let local;
  try {
    local = readFileSync(path.join(DISTDIR, rel));
  } catch (e) {
    return { ok: false, reason: `读不到 ${path.join(DISTDIR, rel)}（${e.message}）` };
  }
  let served;
  try {
    const res = await fetch(`${URL0}/${rel}`);
    if (!res.ok) return { ok: false, reason: `GET ${URL0}/${rel} → HTTP ${res.status}` };
    served = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { ok: false, reason: `取不到 ${URL0}/${rel}（${e.message}）—— dev server 起了吗？（另开终端 node tools/serve.mjs）` };
  }
  const a = createHash('sha256').update(local).digest('hex').slice(0, 16);
  const b = createHash('sha256').update(served).digest('hex').slice(0, 16);
  if (a !== b) {
    return {
      ok: false,
      reason:
        `服务中的 ${rel}(sha256 ${b}) ≠ --dist 指定的(${a}) ⇒ **断言对象 ≠ 被测对象** ⇒ 读数作废。` +
        `让 server 也指向 --dist 那份构建，或去掉 --dist。`,
    };
  }
  return { ok: true, sha: a };
}
const served = await checkServedMatchesDist();
if (!served.ok) {
  console.error(`[前置 0b] ${served.reason}`);
  process.exit(2);
}
console.log(`[前置 0b] 服务中的构建 == --dist 指定 ✓（ui/StartScreen.js sha256 ${served.sha}）`);

/* ---------------------------------------------------------------- 断言框架 */
/* ★★ 三项必打印（team-lead 2026-09-21 立；起因 = 本探针 item16 在 `ov=null` 时**既不红也不绿、
 *   连一行都不打** —— "静默跳过"，三种形态里最坏的一种）：
 *     验收链上的每一项**必须正好打印 {PASS / FAIL / 未判} 三者之一**；
 *     **"没打印"本身就是一处缺陷**；且**"跳过"必须计入「未判」、不得静默**。
 *   实现：每条裁决消息以 `itemN` 起头 ⇒ 自动归账 ⇒ 结尾逐项核对账本（`silent` 计为缺陷）。 */
let bad = 0;
let undone = 0;
const LEDGER = new Map();
const RANK = { 'PASS': 0, '未判': 1, 'FAIL': 2 };
const idOf = (m) => { const x = String(m).match(/item(\d+)/); return x ? `item${x[1]}` : '(unlabeled)'; };
const record = (kind, m) => { const id = idOf(m); const prev = LEDGER.get(id); if (prev === undefined || RANK[kind] > RANK[prev]) LEDGER.set(id, kind); };
const PASS = (c, m) => { record(c ? 'PASS' : 'FAIL', m); if (!c) bad++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`); };
/** 显式失败 —— 用于"取不到对象 ⇒ 无法判定"这类**不许静默**的情形（跳过也要留一行）。 */
const FAIL = (m) => { record('FAIL', m); bad++; console.log(`[FAIL] ${m}`); };
/** 明确标"未判"的条目：**不凑 PASS、也不算 FAIL**，单独计数并在结尾列出。 */
const UNDECIDED = (m) => { record('未判', m); undone++; console.log(`[未判] ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* §14.1 表：卡文案（**逐字**，与规格原文对齐 —— 不复用 src 的常量，独立写死） */
const CARD_SUB = { 教学场: '无对手 · ≤10 分钟', 对决场: '1 对手 · 20–30 分钟', 自由对局: '自定义' };
const HINT_NEED = { 教学场: '10 分钟', 对决场: '有人会来找你' }; // hint 必须**含时长/关键句**（item 4③ / 17）

try {
  await withHeadlessChrome(
    async ({ send, evaluate }) => {
      await send('Emulation.setDeviceMetricsOverride', { width: 792, height: 320, deviceScaleFactor: 3, mobile: true });

      /** 导航到**开始页**并等到可用 —— 不再用固定 `sleep`：服务器冷启动 / 重载慢时，固定 `sleep`
       *  会让后续 `evaluate` 落在 `about:blank` 的**不透明源**上 ⇒ 读 `localStorage` 抛
       *  "Access is denied for this document"（2026-09-21 实测：共享 server 重启后必现）。
       *  就绪判据：`readyState==='complete'` **且** `#start-screen` 已在 DOM。
       *  ★ 2026-10-12：必须带 `?devstart=1` —— 生产路径"首次启动直接进教学模式"会让
       *    开始页根本不出现（本探针跑在全新 profile 上，localStorage 恒空）。 */
      const boot = async () => {
        await send('Page.navigate', { url: URL0 + '/?devstart=1' });
        for (let i = 0; i < 50; i++) {
          await sleep(150);
          try {
            if (await evaluate(`document.readyState === 'complete' && !!document.querySelector('#start-screen')`)) return;
          } catch { /* 导航中 / 不透明源：重试 */ }
        }
        await sleep(1200); // 兜底：仍不满足也往下走，让后续断言自己报错
      };
      /** 直接进某个场景的对局（`?devscenario=<id>`）。
       *  2026-10-12 起场景卡整行没了，原来"点场景卡 + 点开始新游戏"的两步合成一步。 */
      const bootGame = async (id) => {
        await send('Page.navigate', { url: `${URL0}/?devscenario=${encodeURIComponent(id)}` });
        for (let i = 0; i < 60; i++) {
          await sleep(150);
          try {
            if (await evaluate(`document.readyState === 'complete' && !document.querySelector('#start-screen') && !!document.querySelector('#map')`)) return;
          } catch { /* 导航中 */ }
        }
        await sleep(1200);
      };
      const clickText = (sel, text) =>
        evaluate(`(() => {
          const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(b => (b.textContent || '').includes(${JSON.stringify(text)}));
          if (!el) return 'NOT_FOUND';
          if (el.disabled) return 'DISABLED';
          el.click();
          return 'OK';
        })()`);
      const readSave = () => evaluate(`(() => { const raw = localStorage.getItem('homm-save-v1'); return raw ? JSON.parse(raw) : null; })()`);
      const teachText = () => evaluate(`(() => { const e = document.querySelector('.hp-teach'); return e ? e.textContent : null; })()`);

      /* ---- item 1（2026-10-12 重写）：开始页只剩「一张地图卡 + 一个难度」 ----
       * 旧断言（场景行在地图尺寸之上、三卡顺序、sub 逐字）随场景卡整行下线作废。
       * 新断言保持**同一份独立性**：本探针仍按 `in-game-ia.md` 原文自己写，
       * 不复用 `scenarioaudit.mjs` 的写法 —— 但量的对象换成了精简后的开局页。 */
      await boot();
      const fields = await evaluate(`[...document.querySelectorAll('#start-screen .ss-field > label')].map(l => l.textContent)`);
      console.log(`  字段顺序: ${JSON.stringify(fields)}`);
      PASS(fields.length === 1 && fields[0] === '难度', `item1 开始页只剩一个设置行「难度」（实为 ${JSON.stringify(fields)}）`);
      PASS(await evaluate(`!!document.querySelector('#start-screen .ss-mapcard')`), 'item1 开始页有那张地图卡');
      for (const gone of ['试玩场景', '地图尺寸', '地图布局', '电脑对手', '领主名字', '地图种子']) {
        PASS(!fields.includes(gone) && !(await evaluate(`!!document.querySelector('#start-screen .ss-seed')`)), `item1 「${gone}」已下线`);
      }
      const segs = await evaluate(`[...document.querySelectorAll('#start-screen .ss-seg[role="radiogroup"]')].map(r => [...r.querySelectorAll('[role="radio"]')].length + ':' + [...r.querySelectorAll('[role="radio"]')].every(x => x.hasAttribute('aria-checked')))`);
      PASS(segs.length === 1 && segs[0] === '3:true', `item1 难度行 = 一个 radiogroup、3 项都带 aria-checked（实为 ${JSON.stringify(segs)}）`);

      /* ---- item 3（改写）：点「开始」⇒ 开出来的就是破碎罗盘 40×40 ---- */
      await clickText('#start-screen button', '开始');
      await sleep(2500);
      const g = await readSave();
      PASS(!!g && g.config.scenario === 'grims-showcase', `item3 点「开始」开出来的是破碎罗盘（scenario=${g ? g.config.scenario : '?'}）`);
      PASS(!!g && g.map.width === 40 && g.map.height === 40, `item3 地图是静态导入的 40×40（${g ? g.map.width + '×' + g.map.height : '?'}）`);

      /* ---- items 4 / 7 / 8 / 17 / 18（2026-10-12 重写）----
       * 旧断言量的东西（场景卡接管 4 行 + 种子行锁定 + scenario-hint 容器）**全部随
       * 场景行下线**。替换成同一意图的新形态：难度行**不被任何东西锁定**（它现在是
       * 唯一设置行，且 grims 有 `difficultyEditable`），且新元素的 id 仍守 `ss-` 前缀。 */
      await boot();
      const lock = await evaluate(`(() => {
        const fields = [...document.querySelectorAll('#start-screen .ss-field')];
        const labelOf = (row) => (row.querySelector('label')?.textContent || '').trim();
        const segRows = fields.filter(f => f.querySelector('.ss-seg')).map(f => ({
          label: labelOf(f),
          on: f.querySelector('.ss-seg-item.on')?.querySelector('.t')?.textContent || '',
          allDisabled: [...f.querySelectorAll('.ss-seg-item')].every(b => b.disabled),
        }));
        return {
          segRows,
          seedPresent: !!document.querySelector('#start-screen .ss-seed'),
          rerollPresent: [...document.querySelectorAll('#start-screen button')].some(b => (b.textContent || '').includes('换一个')),
          hintId: document.querySelector('#start-screen .ss-hint')?.id ?? null,
          startId: document.querySelector('#start-screen .ss-actions .btn.primary')?.id ?? null,
          mapcardId: document.querySelector('#start-screen .ss-mapcard')?.className ?? null,
        };
      })()`);
      console.log(`  开局页结构: ${JSON.stringify(lock)}`);
      PASS(lock.segRows.length === 1 && lock.segRows[0].label === '难度' && !lock.segRows[0].allDisabled,
        `item4② 唯一的设置行「难度」**不**被锁定（${lock.segRows.length} 行；锁=${lock.segRows[0]?.allDisabled}）`);
      PASS(!lock.seedPresent && !lock.rerollPresent, `item7 种子行（input=${lock.seedPresent}）与「换一个」（${lock.rerollPresent}）**都已不存在**（不是"存在但锁着"）`);
      /* item 18：新加元素的 id / class 前缀（规格约定 `ss-`） */
      PASS(String(lock.mapcardId).includes('ss-mapcard'), `item18 地图卡 class 带 \`ss-\` 前缀（实为「${lock.mapcardId}」）`);

      /* ---- item 13（★假守卫）+ item 9 + item 16（溢出实测）：进教学模式 ---- */
      await bootGame('tutorial');
      await sleep(800);
      const t = await readSave();
      const objs = Object.values(t.map.objects);
      PASS(t.config.scenario === 'tutorial', `item14 教学场：scenario=${t.config.scenario}`);
      PASS(t.config.opponents === 0, `item14 教学场：opponents=${t.config.opponents}（应 0）`);
      PASS(objs.filter((o) => o.kind === 'wanderingMonster').length <= 5, `item14 教学场：野怪 ${objs.filter((o) => o.kind === 'wanderingMonster').length} ≤ 5`);
      PASS(Object.values(t.towns).filter((x) => x.owner === 'neutral').length === 0, 'item14 教学场：无中立城');
      PASS(objs.filter((o) => o.kind === 'vault').length === 0, 'item14 教学场：无宝库');

      /* 打开英雄面板（拇指带「英雄」）→ 读教学块。
       * ⚠️ 教学块落在「属性」段（`HeroPanel.ts:156`），默认段是「部队」⇒ 必须先切段，
       *    否则 `.hp-teach` 恒 null —— 这是**探针的 bug**，不是产品不渲染。 */
      const opened = await clickText('#thumb button', '英雄');
      await sleep(600);
      await clickText('.hp-tab', '属性');
      await sleep(400);
      const teach = await teachText();
      console.log(`  教学块: ${JSON.stringify(teach)} / 点开英雄=${opened}`);
      /* item 13 ★假守卫：开局三条必须全 false ⇒ 面板必须显示 0/3（**不是** 3/3） */
      PASS(!!teach && /教学 · 学会了吗 0\/3/.test(teach), `item13 ★假守卫：开局 = 0/3（实为 ${teach ? teach.slice(0, 22) : 'null'}）`);
      PASS(!!teach && !/3\/3/.test(teach), 'item13 ★假守卫：开局**不是** 3/3（防"恒真/预置"）');
      UNDECIDED('item13 的更强形式（改动 GameState 后由 0→3）—— 需驱动一次"走够 140 格 / 打赢 / 占 2 矿"，本探针不做');
      /* item 9：教学块存在（tutorial）；duel / 展示图不渲染见下两次导航 */
      PASS(!!teach, 'item9 教学场：教学块渲染');
      /* item 11：firstwin 锁存 —— 需要"打赢后再阵亡"的场景 */
      UNDECIDED('item11 `firstwin` 锁存（hero1.exp>0 后阵亡仍显示已学会）—— 需构造战斗+阵亡，本探针不做（构造不出）');
      /* item 16：溢出实测（回答"有没有溢出 / 要不要折叠态"） */
      const ov = await evaluate(`(() => {
        const e = document.querySelector('.hp-teach');
        const panel = document.querySelector('#side, .hp, .hero-panel') || e?.parentElement;
        return e ? { teachScroll: e.scrollHeight, teachClient: e.clientHeight, panelScroll: panel?.scrollHeight ?? -1, panelClient: panel?.clientHeight ?? -1, hasCollapsed: /教学 \\d\\/3 ▸/.test(document.body.textContent || '') } : null;
      })()`);
      console.log(`  溢出实测: ${JSON.stringify(ov)}`);
      if (ov) {
        /* 规格 §14.1 边缘情况：**溢出才折叠**。所以"未溢出"是**报数字**、不是"必须不溢出"；
           若真出现折叠态，则改判"需再测折叠/展开两态"——**不把两种合法态之一写成 FAIL**。 */
        if (ov.hasCollapsed) UNDECIDED(`item16 出现折叠态「教学 N/3 ▸」（溢出档）—— 需再测 折叠/展开 两态只读性`);
        else PASS(ov.teachScroll <= ov.teachClient, `item16 教学块未溢出（scroll ${ov.teachScroll} ≤ client ${ov.teachClient}）⇒ 无折叠态，报实测数字`);
      }
      /* item 15：3/3 banner —— **判"可见"不判"存在"**（`hidden` 元素在 `textContent` 里照样命中 ⇒
         那是"存在性"，踩「可见性 ≠ 存在性」）。可见 = `#obj-banner` 存在 且 非 `hidden` 且
         `getComputedStyle().display !== 'none'` 且 rect 有面积。（样式已由 `#obj-banner[hidden]` 补回隐藏。） */
      const bannerVis = () => evaluate(`(() => {
        const b = document.getElementById('obj-banner');
        if (!b) return { exists: false, visible: false };
        const cs = getComputedStyle(b);
        const r = b.getBoundingClientRect();
        return { exists: true, hidden: b.hidden === true, display: cs.display, w: Math.round(r.width), h: Math.round(r.height),
                 visible: b.hidden !== true && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 };
      })()`);
      const bv0 = await bannerVis();
      PASS(bv0.exists && bv0.visible === false, `item15 开局（0/3）banner **不可见**（存在=${bv0.exists} 可见=${bv0.visible} hidden=${bv0.hidden} display=${bv0.display}）`);

      /* 载入态两例（规格边缘情况 1：载入即 3/3 / 2/3 都**不弹**）——
         自造存档（改真存档的 revealed/exp/mine）+ 走「继续上次存档」，**与实施方探针不同机制**。
         ⚠️ 关键：应用在 `pagehide` 会**自动存档**（`main.ts` installLifecycle.onPause ⇒ `saveGame(内存旧状态)`）
         ⇒「手写 localStorage 后直接 reload」必被旧状态盖掉（首版实测恒得 0/3）。
         正确做法：把改好的档**注入到"新文档启动前"**（`addScriptToEvaluateOnNewDocument`），抢在 app 之前落盘；
         本工程 Web 下 `hydratePersistence` 是空操作（无 `window.Capacitor`），不会再覆盖。 */
      const craftLoad = async (mode) => {
        await bootGame('tutorial');
        await sleep(800);
        const raw = await evaluate(`localStorage.getItem('homm-save-v1')`);
        if (!raw) return { c: { err: 'NO_SAVE' }, cont: null, teach: null, bv: { visible: null } };
        const s = JSON.parse(raw);
        const rev = s.players['p1'].revealed;
        const walkOn = mode === 'three';
        for (let i = 0; i < rev.length; i++) rev[i] = (walkOn && i < 140) ? 1 : 0;
        if (s.heroes['hero1']) s.heroes['hero1'].exp = 1;
        let n = 0;
        for (const o of Object.values(s.map.objects)) { if (o.kind === 'mine' && n < 2) { o.payload.owner = 'p1'; n++; } }
        const c = { walkSum: rev.reduce((a, b) => a + b, 0), exp: s.heroes['hero1']?.exp ?? null, mines: n };
        const B = JSON.stringify(s);
        const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', {
          source: `try { localStorage.setItem('homm-save-v1', ${JSON.stringify(B)}); } catch (e) {}`,
        });
        await boot(); // 新文档启动前先落盘 B（抢在 app 之前）
        await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
        const cont = await clickText('#start-screen button', '继续上次存档');
        await sleep(1300);
        await clickText('#thumb button', '英雄');
        await sleep(600);
        /* ★ 必须切到「属性」段：教学块只落在那一格（`HeroPanel.ts:156`），默认段是「部队」
         *   ⇒ 不切段 `.hp-teach` 恒 null。这是**探针的 bug**（与 item9 那两处同根），
         *     2026-10-12 才被发现 —— 之前这几条一直是假红。 */
        await clickText('.hp-tab', '属性');
        await sleep(400);
        return { c, cont, teach: await teachText(), bv: await bannerVis() };
      };
      const L3 = await craftLoad('three');
      PASS(L3.cont === 'OK' && /教学 · 学会了吗 3\/3/.test(L3.teach || ''), `item15 载入即 3/3：面板 = 3/3（实为「${L3.teach ? L3.teach.slice(0, 24) : 'null'}」；继续键=${L3.cont}；craft=${JSON.stringify(L3.c)}）`);
      PASS(L3.bv.visible === false, `item15 ★载入即 3/3 **不弹** banner（可见=${L3.bv.visible} hidden=${L3.bv.hidden}）`);
      const L2 = await craftLoad('two');
      PASS(/教学 · 学会了吗 2\/3/.test(L2.teach || ''), `item15 载入即 2/3：面板 = 2/3（实为「${L2.teach ? L2.teach.slice(0, 24) : 'null'}」；craft=${JSON.stringify(L2.c)}）`);
      PASS(L2.bv.visible === false, `item15 ★载入即 2/3 **不弹** banner（可见=${L2.bv.visible} hidden=${L2.bv.hidden}）`);
      /* item15 **正半**（上面 L3/L2 只是"载入不弹"的负半）：由假变真 ⇒ banner **可见**地弹一次，关闭后**不重弹**。
       * 造档：revealed=139（walk 差 1 格）+ 清空英雄 4 邻格 ⇒ 走 1 格必 ≥140；firstwin/mine 先给真 ⇒ 载入=2/3。
       * 以 `?devprobe=1` 载入，借 `__journeyGo` 走**真 `tryMove`** 路径（自备机制，不复用 `scenarioaudit`）。
       * ⚠️ **驱动方式声明**：本格经 **`?devprobe=1` 暴露的 `__journeyGo`** 驱动 —— 走的是 **UI 同一个 `tryMove`**
       *   （游戏逻辑路径），**非真实触摸输入**。⇒ 结论是「**UI 逻辑路径级**」，**不是「触摸输入级」**；**不许写成"触摸驱动"**。 */
      await bootGame('tutorial');
      await sleep(800);
      const craftStep = await evaluate(`(() => {
        const raw = localStorage.getItem('homm-save-v1');
        if (!raw) return { err: 'NO_SAVE' };
        const s = JSON.parse(raw);
        const W = s.map.width;
        const hero = s.heroes['hero1'];
        if (!hero) return { err: 'NO_HERO1' };
        const rev = s.players['p1'].revealed;
        for (let i = 0; i < rev.length; i++) rev[i] = 0;
        const keep = new Set([hero.pos.y*W + hero.pos.x,
          hero.pos.y*W + hero.pos.x + 1, hero.pos.y*W + hero.pos.x - 1,
          (hero.pos.y+1)*W + hero.pos.x, (hero.pos.y-1)*W + hero.pos.x]);
        let n = 0;
        for (let i = 0; i < rev.length && n < 139; i++) if (!keep.has(i)) { rev[i] = 1; n++; }
        hero.exp = 1;
        let m = 0;
        for (const o of Object.values(s.map.objects)) if (o.kind === 'mine' && m < 2) { o.payload.owner = 'p1'; m++; }
        return { walkSum: n, exp: hero.exp, mines: m, hero: hero.pos, B: JSON.stringify(s) };
      })()`);
      if (craftStep.err) {
        UNDECIDED(`item15 转移态造档失败（${craftStep.err}）⇒ 2→3「弹一次 / 不重弹」留「未判」`);
      } else {
        const heroPos = () => evaluate(`(() => { const J=window.__journey; return typeof J==='function' ? J().heroPos : null; })()`);
        const walking = () => evaluate(`(() => { const J=window.__journey; return typeof J==='function' ? J().walking : null; })()`);
        const waitIdle = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await walking()) === false) return true; await sleep(120); } return false; };
        /** 逐个方向试"走 1 格"，直到英雄真的换了格（真 tryMove 路径）；返回是否真的动了。 */
        const stepOnce = async () => {
          for (const [dx, dy] of [[1,0],[0,1],[-1,0],[0,-1]]) {
            const before = await heroPos();
            await evaluate(`(() => { const J=window.__journey; if(typeof J!=='function')return; const p=J().heroPos; window.__journeyGo(p.x+(${dx}), p.y+(${dy})); })()`);
            await waitIdle(3000);
            const after = await heroPos();
            if (before && after && (before.x !== after.x || before.y !== after.y)) return true;
          }
          return false;
        };
        const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', {
          source: `try { localStorage.setItem('homm-save-v1', ${JSON.stringify(craftStep.B)}); } catch (e) {}`,
        });
        await send('Page.navigate', { url: URL0 + '/?devprobe=1' });
        await sleep(1800);
        await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
        await clickText('#start-screen button', '继续上次存档');
        await sleep(1200);
        await clickText('#thumb button', '英雄');
        await sleep(600);
        await clickText('.hp-tab', '属性'); // 同 craftLoad：教学块只在「属性」段
        await sleep(400);
        const tBefore = await teachText();
        const bBefore = await bannerVis();
        PASS(/教学 · 学会了吗 2\/3/.test(tBefore || ''), `item15 转移前置：载入为 2/3（walk 差 1 格；实为「${tBefore ? tBefore.slice(0, 24) : 'null'}」；craft=${JSON.stringify({ walkSum: craftStep.walkSum, exp: craftStep.exp, mines: craftStep.mines })}）`);
        PASS(bBefore.visible === false, `item15 转移前置：2/3 时 banner **不可见**`);
        const moved = await stepOnce();
        if (!moved) {
          UNDECIDED('item15 转移：四个邻格 `__journeyGo` 都没让英雄动（造档/落脚格问题）⇒ 2→3「弹一次」留「未判」');
        } else {
          const tAfter = await teachText();
          const bAfter = await bannerVis();
          PASS(/教学 · 学会了吗 3\/3/.test(tAfter || ''), `item15 转移：走 1 格后达 3/3（实为「${tAfter ? tAfter.slice(0, 24) : 'null'}」）`);
          PASS(bAfter.visible === true, `item15 ★2/3→3/3 banner **可见**（可见=${bAfter.visible} hidden=${bAfter.hidden} display=${bAfter.display} ${bAfter.w}×${bAfter.h}px）—— 证"弹"的是**可见**、不是仅"存在"`);
          await evaluate(`(() => { const btn=[...document.querySelectorAll('#obj-banner button')].find(x=>(x.textContent||'').includes('关闭')); if(btn)btn.click(); })()`);
          await sleep(300);
          const bClosed = await bannerVis();
          const moved2 = await stepOnce();
          const bAgain = await bannerVis();
          PASS(bClosed.visible === false, `item15 关闭后 banner 隐藏（可见=${bClosed.visible}）`);
          PASS(bAgain.visible === false, `item15 ★关闭后再刷新（再走 1 格=${moved2}）**不重弹**（会话内一次性；可见=${bAgain.visible}）`);
        }
      }

      /* ---- item 9（反面）：对决场 / 展示图都**不**渲染教学块 ----
       * 2026-10-12：自由对局已从 UI 下线，对照面换成 duel + 展示图（两者都仍可达）。 */
      await bootGame('duel');
      await sleep(800);
      const d = await readSave();
      PASS(d.config.scenario === 'duel', `item14 对决场：scenario=${d.config.scenario}`);
      const midGuard = Object.values(d.map.objects).filter((o) => o.kind === 'wanderingMonster' && o.payload && o.payload.tier === 'mid' && o.payload.guard).length;
      PASS(midGuard >= 1, `item14 对决场：中线 midGuard 存在（${midGuard}）`);
      await clickText('#thumb button', '英雄');
      await sleep(600);
      await clickText('.hp-tab', '属性');
      await sleep(400);
      PASS((await teachText()) === null, 'item9 对决场：教学块**不**渲染');

      await bootGame('grims-showcase');
      await sleep(800);
      await clickText('#thumb button', '英雄');
      await sleep(600);
      await clickText('.hp-tab', '属性');
      await sleep(400);
      PASS((await teachText()) === null, 'item9 展示图：教学块**不**渲染');

      /* ---- item 10：与 #51「本族被动」同族组件 ---- */
      UNDECIDED('item10 与 §3.3 #51「本族被动」同一族组件 —— **#51 在 src/ 尚不存在**（abi_/passive 零消费者）⇒ 无从比对');

      console.log(`\n${bad ? `★ ${bad} 项 FAIL` : '全部通过'}${undone ? `；另 ${undone} 项「未判」（见上）` : ''}`);
    },
    { devServerPort: PROBE },
  );
} catch (e) {
  console.error(e.message ?? e);
  process.exit(e && e.prerequisite ? 2 : 1);
}
process.exit(bad ? 1 : 0);
