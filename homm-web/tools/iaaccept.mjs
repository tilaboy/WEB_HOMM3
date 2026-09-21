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
 * **跑之前先断言「被测构建包含被测对象」**：`dist/main.js` 必须含 #137 的标志串；
 * **缺即 `exit(2)`、写明「dist 早于 #137」**。
 * （2026-09-21 有人拿旧 `dist` 跑审计 ⇒ 20 条 FAIL **全是假罪状**，因为盘上那份构建里
 * 根本没有「试玩场景」这一行。**这条把"要靠人记得的纪律"变成"一道会红的门"。**）
 *
 * ## 用法
 *   node tools/serve.mjs          # 另开终端（默认 5173）
 *   node tools/iaaccept.mjs
 *   node tools/iaaccept.mjs --url=http://127.0.0.1:5174 --port=5174
 *
 * 退出码：0 全过 / 1 有 FAIL / 2 前置不满足（无 Chrome / 无服务 / **dist 不含 #137**）
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
const DIST = path.join(here, '..', 'dist', 'main.js');

/** #137 必须在 `dist/main.js` 里留下的标志串（任一缺失即判定"这份构建不含 #137"）。 */
const MARKERS = ['试玩场景', '教学 · 学会了吗', 'scenario-hint', '对决场'];

function checkBuild() {
  let code;
  try {
    code = readFileSync(DIST, 'utf8');
  } catch (e) {
    return { ok: false, reason: `读不到 ${DIST}（${e.message}）—— 先 npm run build` };
  }
  const st = statSync(DIST);
  const fp = {
    sha256: createHash('sha256').update(code).digest('hex').slice(0, 16),
    mtime: st.mtime.toISOString(),
    bytes: st.size,
  };
  const missing = MARKERS.filter((m) => !code.includes(m));
  if (missing.length) {
    return {
      ok: false,
      fp,
      reason:
        `**dist 不含 #137**：dist/main.js 里缺 ${missing.map((m) => `「${m}」`).join(' / ')}` +
        ` ⇒ 这份构建**早于** #137（aebf844）⇒ **任何读数作废**。请先重建 dist。`,
    };
  }
  return { ok: true, fp };
}

const build = checkBuild();
if (!build.ok) {
  console.error(`[前置 2] ${build.reason}`);
  if (build.fp) console.error(`         dist/main.js: sha256 ${build.fp.sha256} · ${build.fp.mtime} · ${build.fp.bytes}B`);
  process.exit(2);
}
console.log(`[前置 0] dist 含 #137 ✓（sha256 ${build.fp.sha256} · ${build.fp.mtime}）`);

/* ---------------------------------------------------------------- 断言框架 */
let bad = 0;
let undone = 0;
const PASS = (c, m) => { if (!c) bad++; console.log(`[${c ? 'PASS' : 'FAIL'}] ${m}`); };
/** 明确标"未判"的条目：**不凑 PASS、也不算 FAIL**，单独计数并在结尾列出。 */
const UNDECIDED = (m) => { undone++; console.log(`[未判] ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* §14.1 表：卡文案（**逐字**，与规格原文对齐 —— 不复用 src 的常量，独立写死） */
const CARD_SUB = { 教学场: '无对手 · ≤10 分钟', 对决场: '1 对手 · 20–30 分钟', 自由对局: '自定义' };
const HINT_NEED = { 教学场: '10 分钟', 对决场: '有人会来找你' }; // hint 必须**含时长/关键句**（item 4③ / 17）

try {
  await withHeadlessChrome(
    async ({ send, evaluate }) => {
      await send('Emulation.setDeviceMetricsOverride', { width: 792, height: 320, deviceScaleFactor: 3, mobile: true });

      const boot = async () => { await send('Page.navigate', { url: URL0 + '/' }); await sleep(1800); };
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

      /* ---- item 1：字段顺序（规格 = 领主名字 → 试玩场景 → 地图尺寸 → …） ---- */
      await boot();
      const order = await evaluate(`[...document.querySelectorAll('#start-screen .ss-field > label')].map(l => l.textContent).join(' | ')`);
      console.log(`  字段顺序: ${order}`);
      const iScen = order.split(' | ').indexOf('试玩场景');
      const iSize = order.split(' | ').indexOf('地图尺寸');
      PASS(iScen >= 0 && iSize >= 0 && iScen < iSize, `item1 场景行在「地图尺寸」之上（index ${iScen} < ${iSize}）`);

      /* ---- item 2：3 卡 + 标题顺序 + sub 逐字 ---- */
      const cards = await evaluate(`[...document.querySelectorAll('#start-screen .ss-seg')]
        .flatMap(s => [...s.querySelectorAll('.ss-seg-item')])
        .map(b => (b.querySelector('.t')?.textContent || '') + '␟' + (b.querySelector('.s')?.textContent || ''))`);
      const titleList = cards.map((c) => c.split('␟')[0]);
      const subList = Object.fromEntries(cards.map((c) => c.split('␟')));
      PASS(titleList.join('/') === '教学场/对决场/自由对局', `item2 三卡顺序 = 教学场/对决场/自由对局（实为 ${titleList.join('/')}）`);
      for (const [t, want] of Object.entries(CARD_SUB)) {
        PASS(subList[t] === want, `item2 「${t}」sub 逐字 = 「${want}」（实为「${subList[t] ?? '(无)'}」）`);
      }

      /* ---- item 3：默认自由 ⇒ **实测** cfg 无 scenario 键（不是 'free'） ---- */
      await clickText('#start-screen button', '开始新游戏');
      await sleep(1200);
      const free = await readSave();
      PASS(!!free, 'item3 自由对局：读回真存档');
      PASS(!!free && !('scenario' in free.config), `item3 自由对局：config **无** scenario 键（不是 'free'）`);

      /* ---- items 4 / 7 / 8 / 17：选教学场后的锁定态 + hint ---- */
      await boot();
      PASS((await clickText('#start-screen .ss-seg-item', '教学场')) === 'OK', 'item4 能点中「教学场」');
      await sleep(300);
      const lock = await evaluate(`(() => {
        const segs = [...document.querySelectorAll('#start-screen .ss-seg')];
        const fields = [...document.querySelectorAll('#start-screen .ss-field')];
        const labelOf = (row) => (row.querySelector('label')?.textContent || '').trim();
        const segRows = fields.filter(f => f.querySelector('.ss-seg')).map(f => ({
          label: labelOf(f),
          on: f.querySelector('.ss-seg-item.on')?.querySelector('.t')?.textContent || '',
          allDisabled: [...f.querySelectorAll('.ss-seg-item')].every(b => b.disabled),
        }));
        const seedRow = fields.find(f => f.querySelector('.ss-seed'));
        return {
          segRows,
          seedDisabled: !!document.querySelector('#start-screen .ss-seed')?.disabled,
          rerollDisabled: !!([...document.querySelectorAll('#start-screen button')].find(b => (b.textContent || '').includes('换一个'))?.disabled),
          described: document.querySelectorAll('[aria-describedby="scenario-hint"]').length,
          hintId: document.querySelector('#scenario-hint')?.id ?? null,
          hintText: document.querySelector('#scenario-hint')?.textContent ?? null,
          seedRowLabel: seedRow ? labelOf(seedRow) : null,
        };
      })()`);
      console.log(`  锁定态: ${JSON.stringify({ rows: lock.segRows.map((r) => `${r.label}=${r.on}${r.allDisabled ? '(锁)' : ''}`), seedDisabled: lock.seedDisabled, rerollDisabled: lock.rerollDisabled, described: lock.described, hintId: lock.hintId })}`);
      /* item 4②：被场景接管的 **4 个 seg 行全部**真 disabled（不是"≥4 个可点项"这种松断言） */
      const segOk = lock.segRows.length === 4 && lock.segRows.every((r) => r.allDisabled);
      PASS(lock.segRows.length === 4 && segOk, `item4② 4 个 seg 行**整行**真 disabled（${lock.segRows.filter((r) => r.allDisabled).length}/4）`);
      PASS(lock.seedDisabled && lock.rerollDisabled, `item7 G-2：种子行 input(${lock.seedDisabled}) 与 reroll(${lock.rerollDisabled}) **都**真 disabled`);
      PASS(lock.described >= 5, `item8 G-4：${lock.described} 个元素 aria-describedby→scenario-hint（≥5：4 行容器 + 种子相关）`);
      /* item 4③ / 17：hint **含时长**（scenarioaudit 只断言 length>0 —— 这里补上） */
      PASS(typeof lock.hintText === 'string' && lock.hintText.includes(HINT_NEED['教学场']),
        `item4③/17 教学场 hint 含时长「${HINT_NEED['教学场']}」：${lock.hintText}`);
      /* item 18：新加元素的 id 前缀（规格约定 ss-） */
      PASS(String(lock.hintId).startsWith('ss-'), `item18 场景 hint 的 id 带 \`ss-\` 前缀（实为「${lock.hintId}」）`);

      /* ---- item 13（★假守卫）+ item 9 + item 16（溢出实测）：开教学场进游戏 ---- */
      await clickText('#start-screen button', '开始新游戏');
      await sleep(1400);
      const t = await readSave();
      const objs = Object.values(t.map.objects);
      PASS(t.config.scenario === 'tutorial', `item14 教学场：scenario=${t.config.scenario}`);
      PASS(t.config.opponents === 0, `item14 教学场：opponents=${t.config.opponents}（应 0）`);
      PASS(objs.filter((o) => o.kind === 'wanderingMonster').length <= 5, `item14 教学场：野怪 ${objs.filter((o) => o.kind === 'wanderingMonster').length} ≤ 5`);
      PASS(Object.values(t.towns).filter((x) => x.owner === 'neutral').length === 0, 'item14 教学场：无中立城');
      PASS(objs.filter((o) => o.kind === 'vault').length === 0, 'item14 教学场：无宝库');

      /* 打开英雄面板（拇指带「英雄」）→ 读教学块 */
      const opened = await clickText('#thumb button', '英雄');
      await sleep(600);
      const teach = await teachText();
      console.log(`  教学块: ${JSON.stringify(teach)} / 点开英雄=${opened}`);
      /* item 13 ★假守卫：开局三条必须全 false ⇒ 面板必须显示 0/3（**不是** 3/3） */
      PASS(!!teach && /教学 · 学会了吗 0\/3/.test(teach), `item13 ★假守卫：开局 = 0/3（实为 ${teach ? teach.slice(0, 22) : 'null'}）`);
      PASS(!!teach && !/3\/3/.test(teach), 'item13 ★假守卫：开局**不是** 3/3（防"恒真/预置"）');
      UNDECIDED('item13 的更强形式（改动 GameState 后由 0→3）—— 需驱动一次"走够 140 格 / 打赢 / 占 2 矿"，本探针不做');
      /* item 9：教学块存在（tutorial）；free/duel 不渲染见下两次导航 */
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
      /* item 15：3/3 banner。规格要的是"**由假变真时一次性**、载入即 3/3 不重弹"——
         那是**两阶段**行为，单次快照测不了 ⇒ 出现后也只能记「未判（机制已见、一次/重弹未测）」。 */
      const hasBanner = await evaluate(`/你学会了/.test(document.body.textContent || '')`);
      if (!hasBanner) UNDECIDED('item15 3/3 非阻断 banner —— DOM 里无「你学会了」⇒ 尚未落地（工程侧在加）');
      else UNDECIDED('item15 banner 文案已出现；「一次性 / 载入即3/3不重弹」需两阶段测（本探针未实现）');

      /* ---- item 9（反面）：对决场 / 自由对局都**不**渲染教学块 ---- */
      await boot();
      await clickText('#start-screen .ss-seg-item', '对决场');
      await sleep(300);
      await clickText('#start-screen button', '开始新游戏');
      await sleep(1500);
      const d = await readSave();
      PASS(d.config.scenario === 'duel', `item14 对决场：scenario=${d.config.scenario}`);
      const midGuard = Object.values(d.map.objects).filter((o) => o.kind === 'wanderingMonster' && o.payload && o.payload.tier === 'mid' && o.payload.guard).length;
      PASS(midGuard >= 1, `item14 对决场：中线 midGuard 存在（${midGuard}）`);
      await clickText('#thumb button', '英雄');
      await sleep(600);
      PASS((await teachText()) === null, 'item9 对决场：教学块**不**渲染');

      await boot();
      await clickText('#start-screen button', '开始新游戏');
      await sleep(1400);
      await clickText('#thumb button', '英雄');
      await sleep(600);
      PASS((await teachText()) === null, 'item9 自由对局：教学块**不**渲染');

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
