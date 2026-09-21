#!/usr/bin/env node
/**
 * scenarioaudit.mjs —— 两张试玩地图入口（#137）的**端到端门控**。
 *
 * ## 为什么用"真 UI + 真存档"而不是单测
 * `scenarioGenOptions()` / `objectives` 的正确性**不在数据层**，而在**接线**：
 * 卡片点了没有、5 行锁没锁、快照回没回、`cfg.scenario` 有没有真的落到生成配置里。
 * 这些只有走一遍真页面才验得到。所以本工具：真 Chrome → **点真卡片** → 读回
 * `localStorage['homm-save-v1']`（`saveGame` 写的**真存档**）与真 DOM 来断言。
 *
 * ## 四条底线（规范权威 = `design/ux/in-game-ia.md §14.1 / §14.2`）
 *   ① 教学场：`scenario='tutorial'` · `opponents=0` · 野怪 ≤5 · **无中立城 · 无宝库**
 *   ② 对决场：`scenario='duel'` · `opponents=1` · **中线有 `midGuard`**（`tier==='mid'` 且带 `guard`）
 *   ③ 自由对局：`config` **没有 `scenario` 键**（不是 `'free'`）
 *   ④ **快照回滚**：自定义 → 进场景 → 切回自由 ⇒ 5 行**原样恢复**（A1「自由对局逐字节一致」底线）
 * 另附：字段顺序（试玩场景在地图尺寸**之上**）、3 卡文案、`radiogroup/aria-checked`、
 * G-2（种子行 `input` **与** `reroll` 都真 disabled）、G-4（`aria-describedby`→`scenarioHint`）、
 * 教学清单只在教学场渲染（`教学 · 学会了吗 N/3` + 每行有文字「已学会/未学会」）。
 *
 * ## 用法
 *   npm run build
 *   node tools/serve.mjs                       # 另开一个终端（默认 5173）
 *   node tools/scenarioaudit.mjs
 *   node tools/scenarioaudit.mjs --url=http://127.0.0.1:5174 --port=5174
 *
 * 退出码：0 全过 / 1 有 FAIL / 2 前置不满足（无 Chrome 或 dev server 没起）
 *
 * ⚠️ 前置：本工具**不改**任何文件、只读页面；它读的是 `dist/`（`serve.mjs` 的根）。
 *    换构建请先改 `dist/`，别在测量窗口里跑错构建。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHeadlessChrome } from './_chrome.mjs';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const PROBE = Number(arg('port', '5173'));
const URL0 = arg('url', `http://127.0.0.1:${PROBE}`);

/* 「被测构建必须自证包含被测对象」（team-lead 新规矩，全仓适用）：
 * 本工具验的是 `#137`（「试玩场景」）⇒ 跑之前先断言 `dist/main.js` **含该标记**。
 * 缺 ⇒ **读数作废**、exit(2)，而不是把 stale-dist 的 FAIL 记到 `#137` 头上
 * （2026-09-21 实战：dist 早 `#137` 20 分钟 ⇒ 曾产出 20 条假 FAIL）。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* `--dist=<dir>`：被测构建目录（默认 `dist`）。用临时隔离构建（如 `dist-137ck`）时指定它，
 * 免得为了跑门控去覆盖真正的 `dist`（`dist` 是测量对象，重建须申报 / 单人一次）。 */
const DIST = path.join(ROOT, arg('dist', 'dist'));
/* ⚠️ 标记所在产物已核准：「试玩场景」（`#137` 的核心标记）编译进 **`ui/StartScreen.js`**，
 *  **不在 `main.js`**（roadmap 那句"main.js 命中 0"说的是旧 `dist` 的事实，但据此写守卫会误判 —— 
 *  本条按**实测**取 `ui/StartScreen.js`）。 */
const START_JS = path.join(DIST, 'ui', 'StartScreen.js');
if (!existsSync(START_JS)) {
  console.error(`✗ 前置不满足：找不到 ${START_JS}（先 npm run build）`);
  process.exit(2);
}
if (!readFileSync(START_JS, 'utf8').includes('试玩场景')) {
  console.error(`✗ 前置不满足：${arg('dist', 'dist')}/ui/StartScreen.js 不含「试玩场景」⇒ 该构建早于 #137（读数作废）。请先重建。`);
  process.exit(2);
}

let bad = 0;
const PASS = (c, m) => { if (!c) bad++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await withHeadlessChrome(
    async ({ send, evaluate }) => {
      await send('Emulation.setDeviceMetricsOverride', { width: 792, height: 320, deviceScaleFactor: 3, mobile: true });

      const boot = async () => { await send('Page.navigate', { url: URL0 + '/' }); await sleep(1800); };
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

      /* 0) 开始页结构 */
      await boot();
      const order = await evaluate(`[...document.querySelectorAll('#start-screen .ss-field > label')].map(l => l.textContent).join(' | ')`);
      console.log(`  字段顺序: ${order}`);
      PASS(/试玩场景/.test(order), '开始页有「试玩场景」字段');
      const iScen = order.indexOf('试玩场景');
      const iSize = order.indexOf('地图尺寸');
      PASS(iScen >= 0 && iSize >= 0 && iScen < iSize, `「试玩场景」在「地图尺寸」之上（index ${iScen} < ${iSize}）`);
      const cards = await evaluate(`[...document.querySelectorAll('#start-screen .ss-seg-item')].slice(0, 3).map(b => b.querySelector('.t').textContent).join('/')`);
      PASS(cards === '教学场/对决场/自由对局', `3 张卡 = 教学场/对决场/自由对局（实为 ${cards}）`);
      const a11y = await evaluate(`(() => {
        const row = document.querySelector('#start-screen .ss-seg[role="radiogroup"]');
        if (!row) return 'NO_RADIOGROUP';
        const rs = [...row.querySelectorAll('[role="radio"]')];
        return rs.length + ':' + rs.every(r => r.hasAttribute('aria-checked'));
      })()`);
      PASS(/^3:true$/.test(a11y), `3 卡 = 一个 radiogroup（role=radio + aria-checked）→ ${a11y}`);

      /* 1) 自由对局（默认）：config 不得有 scenario 键 */
      await clickText('#start-screen button', '开始新游戏');
      await sleep(1200);
      const free = await readSave();
      PASS(!!free, '自由对局：能读回真存档');
      PASS(!!free && !Object.prototype.hasOwnProperty.call(free.config, 'scenario'), '自由对局：config **没有** scenario 键（不是 \'free\'）');

      /* 2) 教学场 */
      await boot();
      PASS((await clickText('#start-screen .ss-seg-item', '教学场')) === 'OK', '能点中「教学场」卡');
      await sleep(300);
      const lock = JSON.parse(await evaluate(`(() => {
        const segs = [...document.querySelectorAll('#start-screen .ss-seg')];
        return JSON.stringify({
          disabledItems: segs.reduce((n, s) => n + [...s.querySelectorAll('.ss-seg-item')].filter(b => b.disabled).length, 0),
          seedDisabled: !!document.querySelector('#start-screen .ss-seed')?.disabled,
          rerollDisabled: !!([...document.querySelectorAll('#start-screen button')].find(b => b.textContent.includes('换一个'))?.disabled),
          described: document.querySelectorAll('[aria-describedby="ss-scenario-hint"]').length,
          hint: document.querySelector('#ss-scenario-hint')?.textContent,
        });
      })()`));
      console.log(`  锁定态: ${JSON.stringify(lock)}`);
      PASS(lock.seedDisabled && lock.rerollDisabled, 'G-2：种子行 input 与 reroll **都**真 disabled');
      PASS(lock.disabledItems >= 4, `被接管的行真 disabled（${lock.disabledItems} 个可点项）`);
      PASS(lock.described >= 8, `G-4：${lock.described} 个元素 aria-describedby→scenarioHint`);
      PASS(typeof lock.hint === 'string' && lock.hint.length > 0, `scenarioHint 有文案：${lock.hint}`);
      // ③（team-lead 裁定）：hint 行 = 说明 + **预期时长**；`sub` 的时长仍在卡片上（两列）。
      PASS(/分钟/.test(lock.hint ?? ''), `③ hint 行含「预期时长」：${lock.hint}`);
      await clickText('#start-screen button', '开始新游戏');
      await sleep(1200);
      const t = await readSave();
      const tObjs = Object.values(t.map.objects);
      PASS(t.config.scenario === 'tutorial', `教学场：scenario=${t.config.scenario}`);
      PASS(t.config.opponents === 0, `教学场：opponents=${t.config.opponents}（应 0）`);
      PASS(t.config.size === 'small' && t.config.seed === 247944, `教学场：size/seed = ${t.config.size}/${t.config.seed}`);
      PASS(tObjs.filter((o) => o.kind === 'wanderingMonster').length <= 5, `教学场：野怪 ${tObjs.filter((o) => o.kind === 'wanderingMonster').length} ≤ 5`);
      PASS(Object.values(t.towns).filter((x) => x.owner === 'neutral').length === 0, '教学场：无中立城');
      PASS(tObjs.filter((o) => o.kind === 'vault').length === 0, '教学场：无宝库');
      const teach = await panelText();
      PASS(!!teach && /教学 · 学会了吗 0\/3/.test(teach), '教学场：面板渲染「教学 · 学会了吗 0/3」');
      PASS(!!teach && /未学会/.test(teach), '教学场：每行同时给文字（☐ 非唯一语义载体）');

      /* ② 溢出兜底：**先实测**（内容高 vs 可用高）；溢出才折，不溢出就不折（team-lead 裁定）。
       * 展开英雄栏后才量得到真实布局（收起态 `#side.collapsed > div{display:none}`）。 */
      await clickText('#thumb button', '英雄');
      await sleep(250);
      const ov = await evaluate(`(() => {
        const side = document.querySelector('#side');
        const body = document.querySelector('#side > div');
        const teach = document.querySelector('.hp-teach');
        return {
          avail: side ? side.clientHeight : null,
          content: body ? body.scrollHeight : null,
          overflow: side ? side.scrollHeight - side.clientHeight : null,
          teachH: teach ? teach.offsetHeight : null,
        };
      })()`);
      console.log(`  教学场面板竖向实测（792×320 视口）: ${JSON.stringify(ov)}`);

      /* 3) 对决场 */
      await boot();
      PASS((await clickText('#start-screen .ss-seg-item', '对决场')) === 'OK', '能点中「对决场」卡');
      await sleep(300);
      const duelHint = await evaluate(`document.querySelector('#ss-scenario-hint') ? document.querySelector('#ss-scenario-hint').textContent : null`);
      PASS(/20[–-]30 分钟/.test(duelHint ?? ''), `③ 对决场 hint 行含预期时长：${duelHint}`);
      await clickText('#start-screen button', '开始新游戏');
      await sleep(1500);
      const d = await readSave();
      const midGuard = Object.values(d.map.objects).filter((o) => o.kind === 'wanderingMonster' && o.payload && o.payload.tier === 'mid' && o.payload.guard).length;
      PASS(d.config.scenario === 'duel', `对决场：scenario=${d.config.scenario}`);
      PASS(d.config.opponents === 1, `对决场：opponents=${d.config.opponents}（应 1）`);
      PASS(d.config.size === 'medium' && d.config.seed === 170774, `对决场：size/seed = ${d.config.size}/${d.config.seed}`);
      PASS(midGuard >= 1, `对决场：中线门控 midGuard 存在（${midGuard} 只 tier=mid 且带 guard）`);
      PASS((await panelText()) === null, '对决场：面板**不**渲染教学清单');

      /* 4) 快照回滚 */
      await boot();
      PASS((await clickText('#start-screen .ss-seg-item', '困难')) === 'OK', '能把难度改成「困难」');
      PASS((await clickText('#start-screen .ss-seg-item', '3 家')) === 'OK', '能把对手改成「3 家」');
      await sleep(250);
      const before = await readOns();
      await clickText('#start-screen .ss-seg-item', '教学场');
      await sleep(250);
      await clickText('#start-screen .ss-seg-item', '自由对局');
      await sleep(250);
      const after = await readOns();
      console.log(`  自定义: ${before}\n  切回后: ${after}`);
      PASS(after === before, '切回自由对局后 5 行**原样恢复**（不是重置默认）');
      await clickText('#start-screen button', '开始新游戏');
      await sleep(1500);
      const rs = await readSave();
      PASS(rs.config.difficulty === 'hard' && rs.config.opponents === 3, `恢复值真进配置（difficulty=${rs.config.difficulty} opponents=${rs.config.opponents}）`);
      PASS(!Object.prototype.hasOwnProperty.call(rs.config, 'scenario'), '恢复后打的是自由对局（无 scenario 键）');

      /* 5) §14.2 教学 3/3 非阻断 banner —— ① 补做（team-lead 裁定） */
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
      PASS((banner.btns || []).indexOf('去对决场') >= 0 && (banner.btns || []).indexOf('关闭') >= 0, `banner 两个动作（去对决场 / 关闭）：${JSON.stringify(banner.btns)}`);
      PASS(banner.h === 48, `banner 高 ≤48px（实为 ${banner.h}）`);
      PASS(banner.gap === 0 && banner.aboveThumb === true, 'banner 紧贴拇指带上方');

      /* 6) 3/3 **转移**触发（组件级：驱动真 `HeroPanel` 的"由假变真"，会话内一次性） */
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
    { devServerPort: PROBE },
  );
} catch (e) {
  console.error(e.message ?? e);
  process.exit(e && e.prerequisite ? 2 : 1);
}
process.exit(bad ? 1 : 0);
