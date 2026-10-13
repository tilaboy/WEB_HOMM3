#!/usr/bin/env node
/**
 * scenarioaudit.mjs —— **开局页 + 教学模式**的端到端门。
 *
 * ## 为什么用"真 UI + 真存档"而不是单测
 * 「开始页长什么样」「点了之后开出来的到底是什么局」这些正确性**不在数据层**，
 * 而在**接线**：只有走一遍真页面、读回 `localStorage['homm-save-v1']`（`saveGame`
 * 写的**真存档**）才验得到。
 *
 * ## ★ 2026-10-12 整篇重写（用户裁定，不是修 bug）
 * 旧版验的是「试玩场景」那一行 4 张卡（教学场 / 对决场 / 破碎罗盘 / 自由对局）
 * + 5 行设置 + 种子行 + 快照回滚。用户裁定：
 *   > 「开局页面还是显得有点繁琐……地图种子就不用要了，试玩场景也不用要吧」
 *   > 「现阶段我更倾向于删除随机地图的选项，只保留教学模式和破碎罗盘」
 *   > 「第一次进入直接进入教学场景，除非选择跳过，后面不用再有教学场选项」
 * ⇒ **被测对象整个变了**。旧断言不是"红"，是"尺子量错了东西"。
 *    所以整篇重写：旧的场景行 / 种子行 / 快照回滚断言全部删除，
 *    换成新结构的断言（见下）。旧版的历史读数留在 git 里，不在这里留坟。
 *
 * ## 新结构的四条底线
 *   ① 开始页**只剩**：一张地图卡（破碎罗盘）+ 一个难度 + 「开始」（+ 有存档时的「继续」）。
 *      不该有的：种子行、场景行、尺寸 / 布局 / 对手行、领主名字。
 *   ② 教学模式（`scenario='tutorial'`）仍是那条**设计好的减法路径**：无中立城 / 无宝库 /
 *      ≤5 只野怪，且英雄面板渲染教学清单（「教学 · 学会了吗 0/3」+ 每行有文字）。
 *   ③ §14.2 的 3/3 非阻断 banner 与「由假变真」转移逻辑**不变**（本轮没碰它们）。
 *   ④ 教学模式与展示图**互不串味**：教学局没有目标清单、顶栏不带 `showcase` 类。
 *
 * ## 用法（`#164`：`--dist=<dir>` + **空闲端口自起**）
 *   npm run build
 *   node tools/scenarioaudit.mjs                        # 正向（自起服务，量 <repo>/dist）
 *   node tools/scenarioaudit.mjs --dist=/tmp/dist-137   # 量**任意构建目录**
 *   node tools/scenarioaudit.mjs --port=5174            # 连既有服务（另核「服务中 == --dist」）
 *   NEG=1 node tools/scenarioaudit.mjs                  # **可证伪负测**：只跑「故意弄坏」的三组
 *
 * 退出码：0 全过 / 1 有 FAIL / 2 前置不满足（无 Chrome / 构建不含开始页 / 服务没起）
 *
 * ⚠️ 前置：本工具**不改**任何文件、只读页面；**首行**打印「所量目录 + `cwd` + 指纹」。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHeadlessChrome } from './_chrome.mjs';
import { distDir, printHeader, freePort, serveInProcess } from './_dist.mjs';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};

/* 「被测构建必须自证包含被测对象」（team-lead 新规矩，全仓适用）：
 * 本工具验的是开局页的新形态 ⇒ 跑之前先断言**被测构建**里含本轮新加的标记。
 * 缺 ⇒ **读数作废**、exit(2)，而不是把 stale-dist 的 FAIL 记到本轮头上。
 * 2026-10-12：标记从「试玩场景」换成 `ss-mapcard`（开局页唯一那张地图卡的 class）。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = distDir({ base: ROOT });
printHeader(DIST, 'gate=scenarioaudit');

const START_JS = path.join(DIST, 'ui', 'StartScreen.js');
if (!existsSync(START_JS)) {
  console.error(`✗ 前置不满足：找不到 ${START_JS}（先 npm run build，或用 --dist=<dir> 指向隔离构建）`);
  process.exit(2);
}
if (!readFileSync(START_JS, 'utf8').includes('ss-mapcard')) {
  console.error(`✗ 前置不满足：${DIST}/ui/StartScreen.js 不含 \`ss-mapcard\` ⇒ 该构建早于 2026-10-12 开局页精简（读数作废）。请先重建。`);
  process.exit(2);
}

/* ── `#164` 要求②：解析「连谁 / 自起」── */
const URL_ARG = arg('url', null);
const PORT_ARG = arg('port', null);
let URL0;
let APP_PORT = null;
if (URL_ARG) {
  URL0 = URL_ARG;
} else if (PORT_ARG != null) {
  APP_PORT = Number(PORT_ARG);
  URL0 = `http://127.0.0.1:${APP_PORT}`;
} else {
  APP_PORT = await freePort();
  URL0 = `http://127.0.0.1:${APP_PORT}`;
  if (!(await serveInProcess(DIST, APP_PORT))) {
    console.error(`✗ 前置不满足：进程内自起 dev server 失败（dir=${DIST} :${APP_PORT}）`);
    process.exit(2);
  }
}
if (URL_ARG || PORT_ARG != null) {
  const rel = 'ui/StartScreen.js';
  try {
    const res = await fetch(`${URL0}/${rel}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const served = Buffer.from(await res.arrayBuffer());
    const local = readFileSync(path.join(DIST, rel));
    const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);
    if (sha(served) !== sha(local)) {
      console.error(`✗ 前置不满足：服务中的 ${rel}(${sha(served)}) ≠ --dist 指定的(${sha(local)}) ⇒ 断言对象 ≠ 被测对象，读数作废。`);
      process.exit(2);
    }
  } catch (e) {
    console.error(`✗ 前置不满足：取不到 ${URL0}/${rel}（${e.message}）—— dev server 起了吗？`);
    process.exit(2);
  }
}

let bad = 0;
const PASS = (c, m) => { if (!c) bad++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── `NEG=1` 可证伪负测（见文件头注「门必须双向可证」）── */
const NEG = process.env.NEG === '1';
let negBad = 0;
const NEGPASS = (c, m) => { if (!c) negBad++; console.log(`[${c ? 'NEG-PASS' : 'NEG-FAIL'}] ${m}`); };

/**
 * 负测 A：给一个**不含** `ss-mapcard` 标记的 dist 目录 ⇒ 前置必须 `exit 2`。
 * 这正是"该红要红"：前置写错文件 / 构建太旧时它必须挡下读数，
 * 而不是把 stale-dist 的 FAIL 记到本轮头上。
 */
function negPrecondition() {
  const tmp = mkdtempSync(path.join(tmpdir(), 'neg-dist-'));
  try {
    mkdirSync(path.join(tmp, 'ui'), { recursive: true });
    /* ⚠️ fixture **绝不能**写出那个标记串 —— 否则 `includes('ss-mapcard')` 命中、
     * 前置根本不触发，负测绿在别处。 */
    writeFileSync(path.join(tmp, 'ui', 'StartScreen.js'), '/* fixture: 该构建早于开局页精简 */\n');
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--dist=${tmp}`], {
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, NEG: '0' },
    });
    return { status: r.status, ok: r.status === 2 };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
if (NEG) {
  const a = negPrecondition();
  NEGPASS(a.ok, `A 前置可红：不含 \`ss-mapcard\` 的 dist ⇒ 期待 exit 2，实得 ${a.status}`);
}

try {
  await withHeadlessChrome(
    async ({ send, evaluate }) => {
      await send('Emulation.setDeviceMetricsOverride', { width: 792, height: 320, deviceScaleFactor: 3, mobile: true });

      const clickText = (sel, text) =>
        evaluate(`(() => {
          const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(b => (b.textContent || '').includes(${JSON.stringify(text)}));
          if (!el) return 'NOT_FOUND';
          el.click();
          return 'OK';
        })()`);
      const readSave = () => evaluate(`(() => { const raw = localStorage.getItem('homm-save-v1'); return raw ? JSON.parse(raw) : null; })()`);
      const panelText = () => evaluate(`(() => { const e = document.querySelector('.hp-teach'); return e ? e.textContent : null; })()`);
      const readOns = () =>
        evaluate(`(() => [...document.querySelectorAll('#start-screen .ss-seg')]
          .map(s => { const on = s.querySelector('.ss-seg-item.on'); return on ? on.querySelector('.t').textContent : '(none)'; }).join(' | '))()`);

      /* ★ 必须带 `?devstart=1`：门跑在全新 Chrome profile ⇒ localStorage 为空 ⇒
       *   生产路径会"首次启动直接进教学模式"，开始页根本不出现（下面全部断言假红）。
       *   这个口子专为测试路径开，不影响生产（见 `main.ts` 启动段注释）。 */
      const boot = async () => {
        await send('Page.navigate', { url: URL0 + '?devstart=1' });
        for (let i = 0; i < 80; i++) {
          await sleep(150);
          try {
            if (await evaluate(`document.readyState === 'complete' && !!document.querySelector('#start-screen')`)) return true;
          } catch { /* 导航中 */ }
        }
        throw new Error('开始页未在 12s 内就绪');
      };

      /* ── `NEG=1`：只跑「故意弄坏」的结构/数据两类，断言都变红，然后收工 ── */
      if (NEG) {
        // B 结构判据（DOM）：把 `#obj-banner` 摘掉 ⇒ 存在性判据必须 true→false
        await boot();
        const bProbe = () => evaluate(`(() => { const b = document.querySelector('#obj-banner'); return !!b && b.hidden === true && b.getAttribute('role') === 'status'; })()`);
        const bBefore = await bProbe();
        await evaluate(`(() => { const b = document.querySelector('#obj-banner'); if (b) b.remove(); })()`);
        const bAfter = await bProbe();
        NEGPASS(bBefore === true && bAfter === false, `B 结构判据可红：#obj-banner 在/默认隐藏时判据=true，remove() 后=false（before=${bBefore} after=${bAfter}）`);
        // C 数据判据（真存档）：把展示图真存档的 `config.scenario` 删掉 ⇒ 判据必须 true→false
        await boot();
        await clickText('#start-screen button', '开始');
        await sleep(2500);
        const cProbe = () => evaluate(`(() => { let s = null; try { s = JSON.parse(localStorage.getItem('homm-save-v1')); } catch { s = null; } return !!s && s.config.scenario === 'grims-showcase'; })()`);
        const cBefore = await cProbe();
        await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('homm-save-v1')); delete s.config.scenario; localStorage.setItem('homm-save-v1', JSON.stringify(s)); })()`);
        const cAfter = await cProbe();
        NEGPASS(cBefore === true && cAfter === false, `C 数据判据可红：展示图存档 scenario=grims-showcase=true，删键后=false（before=${cBefore} after=${cAfter}）`);
        console.log(`\n${negBad ? `★ ${negBad} 项 NEG-FAIL —— 判据可能**恒绿**（门坏了，必须修）` : '负测全部通过：A/B/C 三类判据**都能红**（门不是恒绿）'}`);
        return;
      }

      /* ① 开始页只剩「一张地图卡 + 一个难度」 */
      await boot();
      const fields = await evaluate(`[...document.querySelectorAll('#start-screen .ss-field > label')].map(l => l.textContent)`);
      console.log(`  开始页字段: ${JSON.stringify(fields)}`);
      PASS(fields.length === 1 && fields[0] === '难度', `开始页只剩一个设置行「难度」（实测 ${fields.length} 行：${fields.join('/')}）`);
      PASS(await evaluate(`!!document.querySelector('#start-screen .ss-mapcard')`), '开始页有那张地图卡（`.ss-mapcard`）');
      PASS(await evaluate(`/破碎罗盘/.test((document.querySelector('#start-screen .ss-mapcard-name') || {}).textContent || '')`), '地图卡就是「破碎罗盘」');
      PASS(await evaluate(`!document.querySelector('#start-screen .ss-seed') && ![...document.querySelectorAll('#start-screen button')].some(b => (b.textContent||'').includes('换一个'))`), '种子行与「换一个」都已不在');
      for (const gone of ['试玩场景', '地图尺寸', '地图布局', '电脑对手', '领主名字']) {
        PASS(!fields.includes(gone), `「${gone}」行已下线`);
      }
      const a11y = await evaluate(`(() => {
        const row = document.querySelector('#start-screen .ss-seg[role="radiogroup"]');
        if (!row) return 'NO_RADIOGROUP';
        const rs = [...row.querySelectorAll('[role="radio"]')];
        return rs.length + ':' + rs.every(r => r.hasAttribute('aria-checked'));
      })()`);
      PASS(/^3:true$/.test(a11y), `难度行 = 一个 radiogroup（role=radio + aria-checked）→ ${a11y}`);
      PASS(await clickText('#start-screen button', '开始') === 'OK', '有「开始」按钮且可点');
      await sleep(2500);
      const g = await readSave();
      PASS(!!g && g.config.scenario === 'grims-showcase', `点「开始」开出来的就是破碎罗盘（scenario=${g ? g.config.scenario : '?'}）`);
      PASS(!!g && g.map.width === 40 && g.map.height === 40, `地图是静态导入的 40×40（${g ? g.map.width + '×' + g.map.height : '?'}）`);

      /* ② 教学模式仍是那条设计好的减法路径（靠 `?devscenario=` 进门，UI 已不给选） */
      await send('Page.navigate', { url: URL0 + '?devscenario=tutorial' });
      for (let i = 0; i < 80; i++) {
        await sleep(150);
        try {
          if (await evaluate(`document.readyState === 'complete' && !document.querySelector('#start-screen') && !!document.querySelector('#map')`)) break;
        } catch { /* 导航中 */ }
      }
      await sleep(600);
      const t = await readSave();
      PASS(!!t && t.config.scenario === 'tutorial', `教学模式能开起来（scenario=${t ? t.config.scenario : '?'}）`);
      const tObjs = t ? Object.values(t.map.objects) : [];
      PASS(tObjs.filter((o) => o.kind === 'wanderingMonster').length <= 5, `教学图野怪 ≤5（实测 ${tObjs.filter((o) => o.kind === 'wanderingMonster').length}）`);
      PASS(Object.values(t.towns).filter((x) => x.owner === 'neutral').length === 0, '教学图无中立城');
      PASS(tObjs.filter((o) => o.kind === 'vault').length === 0, '教学图无宝库');
      // 教学清单在英雄面板的**「属性」段**（`HeroPanel.ts:156`：`seg==='attr'` 才 `appendChild(teach)`；
      // `seg` 默认 `'army'` ⇒ 直接找 `.hp-teach` 必然 null —— 这正是旧版这两条恒 FAIL 的原因，
      // 是**门的 bug**，不是产品不渲染）。所以必须先展开面板、再切到「属性」段。
      await clickText('#thumb button', '英雄');
      await sleep(400);
      await clickText('.hp-tab', '属性');
      await sleep(300);
      const teach = await panelText();
      PASS(!!teach && /教学 · 学会了吗 0\/3/.test(teach), '教学局：面板渲染「教学 · 学会了吗 0/3」');
      PASS(!!teach && /未学会/.test(teach), '教学局：每行同时给文字（☐ 非唯一语义载体）');
      // ④ 教学局不吃展示图的减法
      const tObj = await evaluate(`(() => { const e = document.querySelector('#objectives'); return !!e && !e.hidden && e.getClientRects().length > 0; })()`);
      const tCls = await evaluate(`document.querySelector('#topbar').classList.contains('showcase')`);
      PASS(!tObj && !tCls, '④ 教学局：无目标清单、顶栏不带 showcase 类（互不串味）');

      /* ③ §14.2 教学 3/3 非阻断 banner（本轮没碰它，红线继续证） */
      await boot();
      const banner = await evaluate(`(() => {
        const b = document.querySelector('#obj-banner');
        if (!b) return { found: false };
        const thumb = document.querySelector('#thumb');
        const aboveThumb = !!(b.compareDocumentPosition(thumb) & Node.DOCUMENT_POSITION_FOLLOWING);
        const wasHidden = b.hidden;
        const role = b.getAttribute('role');
        const tEl = b.querySelector('.ob-text');
        const text = tEl ? tEl.textContent : null;
        const btns = [...b.querySelectorAll('button')].map((x) => x.textContent);
        b.hidden = false; // 量测时临时显示（量完恢复）
        const r = b.getBoundingClientRect();
        const h = Math.round(r.height);
        const gap = Math.round(thumb.getBoundingClientRect().top - r.bottom);
        b.hidden = wasHidden;
        return { found: true, hidden: wasHidden, role: role, text: text, btns: btns, h: h, gap: gap, aboveThumb: aboveThumb };
      })()`);
      console.log(`  banner: ${JSON.stringify(banner)}`);
      PASS(banner.found, '#obj-banner 存在');
      PASS(banner.hidden === true, '默认隐藏（非 3/3 不打扰）');
      PASS(banner.role === 'status', 'role="status"（非阻断 / 不夺焦）');
      PASS(banner.text === '你学会了。下一张图有人会来打你。', `banner 文案为 §14.2 逐字句：${banner.text}`);
      PASS((banner.btns || []).indexOf('去破碎罗盘') >= 0 && (banner.btns || []).indexOf('关闭') >= 0, `banner 两个动作（去破碎罗盘 / 关闭）：${JSON.stringify(banner.btns)}`);
      PASS(banner.h === 48, `banner 高 ≤48px（实为 ${banner.h}）`);
      PASS(banner.gap === 0 && banner.aboveThumb === true, 'banner 紧贴拇指带上方');

      /* ③ 3/3 **转移**触发（组件级：驱动真 `HeroPanel` 的"由假变真"，会话内一次性） */
      const objtest = await evaluate(`(async () => {
        const HeroPanel = (await import('/ui/HeroPanel.js')).HeroPanel;
        const rev = new Array(576).fill(0);
        const state = {
          config: { scenario: 'tutorial' },
          players: { p1: { name: 'P1', revealed: rev } },
          heroOrder: [], heroes: {}, towns: {},
          map: { width: 24, height: 24, objects: {} },
        };
        let fired = 0;
        const p = new HeroPanel(document.createElement('div'), undefined, undefined, undefined, undefined, () => { fired++; });
        for (let i = 0; i < 145; i++) rev[i] = 1; // ① 走路达成
        state.map.objects = { m1: { kind: 'mine', payload: { owner: 'p1' } }, m2: { kind: 'mine', payload: { owner: 'p1' } } }; // ③ 矿达成
        state.heroes.hero1 = { exp: 0 }; // ② 未达成
        p.update(state, null); const a = fired; // 载入 2/3
        state.heroes.hero1.exp = 7; // ② 达成
        p.update(state, null); const b = fired; // 2/3 → 3/3
        p.update(state, null); const c = fired; // 再刷新
        let fired2 = 0;
        const p2 = new HeroPanel(document.createElement('div'), undefined, undefined, undefined, undefined, () => { fired2++; });
        p2.update(state, null); p2.update(state, null); const d = fired2; // 载入即 3/3
        return { a: a, b: b, c: c, d: d };
      })()`);
      console.log(`  3/3 转移: ${JSON.stringify(objtest)}`);
      PASS(objtest.a === 0, '载入 2/3 时**不**触发 banner');
      PASS(objtest.b === 1, '2/3 → 3/3 触发**一次**');
      PASS(objtest.c === 1, '随后刷新**不**重复触发（会话内一次性）');
      PASS(objtest.d === 0, '载入即 3/3 **不**触发（只认"由假变真"）');

      console.log(`\n${bad ? `★ ${bad} 项 FAIL` : '全部通过'}`);
    },
    { devServerPort: APP_PORT ?? undefined },
  );
} catch (e) {
  console.error(e.message ?? e);
  process.exit(e && e.prerequisite ? 2 : 1);
}
process.exit(NEG ? (negBad ? 1 : 0) : bad ? 1 : 0);
