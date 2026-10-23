/**
 * 过天「对手动向」文案闸 —— **玩家定位不了的信息不许出现在日志与字幕里**。
 *
 * 起因（主理人 2026-10-23）：
 *   「每次按下结束回合，屏幕会显示字幕：紫色城主从哪个位置移到哪个位置。
 *     这个信息对用户并没有什么帮助……它从哪个坐标移到哪个坐标，我认为并没有什么帮助。」
 *
 * 改法是：敌方行军**只在"从雾里走进你的视野"时报一次**，且不写坐标
 * （见 `core/game/ai.ts` 的 `reportMoveIfSeen`）。本闸就验这件事，
 * 而不是验"代码里有没有那句模板串" —— 后者改个变量名就绿了。
 *
 * 三条判据：
 *   ① 日志里不得出现 `从 (x,y) 移动到 (x,y)` 这类坐标行军行；
 *   ② 每条「…… 出现在你的视野内」必须**属实**：该英雄当天确实落在人类玩家
 *      任一英雄的 `HERO_SIGHT` 半径内（真值源与迷雾渲染同一个常数）；
 *   ③ 上面两条的**检查器本身**要能报警 —— `--selftest` 往真日志里塞假数据，
 *      检查器必须各抓到一条，否则就是"永远绿的空闸"。
 *
 * 用法：
 *   node tools/aidayprobe.mjs                 # 默认 30 天 / seed 4242
 *   node tools/aidayprobe.mjs --days=60 --seed=7
 *   node tools/aidayprobe.mjs --selftest      # 只跑检查器的负向对照
 * 退出码：0 达标 / 1 不达标 / 2 环境没准备好
 */
import { distDir, distUrl, printHeader, requireFile, argOf } from './_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=aiday');
const dimp = (rel) => distUrl(rel, DIST);
requireFile(DIST, 'core/game/turn.js');

const { createGame, HERO_SIGHT } = await import(dimp('core/map/generator.js'));
const { endDay } = await import(dimp('core/game/turn.js'));
const { viewerOf } = await import(dimp('core/data/factions.js'));

const DAYS = Number(argOf('days', '30'));
/** 扫几个 seed：单局很可能 30 天里 AI 一次都没靠近玩家 —— 那判据②就没被真正考验。 */
const SEEDS = argOf('seed', '4242,7,2026,91')
  .split(',')
  .map(Number)
  .filter((n) => Number.isFinite(n));
const SELFTEST = process.argv.includes('--selftest');

/** 「从 (12,5) 移动到 (14,7)」—— 有坐标的行军行。 */
const COORD_MOVE = /从\s*\(\s*\d+\s*,\s*\d+\s*\)\s*移动到\s*\(\s*\d+\s*,\s*\d+\s*\)/;
/** 「紫晶密会 · 紫晶秘法师 出现在你的视野内」 */
const SEEN_LINE = /·\s*(.+?)\s*出现在你的视野内\s*$/;

/**
 * 判一批日志行。
 * @returns {{coord: string[], phantom: string[], seen: number, gone: number}}
 */
function inspect(lines, state) {
  const coord = [];
  const phantom = [];
  let seen = 0;
  let gone = 0;
  const viewer = viewerOf(state);
  const watchers = state.heroOrder
    .map((id) => state.heroes[id])
    .filter((h) => h && h.owner === viewer);

  for (const line of lines) {
    const text = typeof line === 'string' ? line : line.text;
    if (COORD_MOVE.test(text)) {
      coord.push(text);
      continue;
    }
    const m = SEEN_LINE.exec(text);
    if (!m) continue;
    seen++;
    const who = m[1].trim();
    const hero = Object.values(state.heroes).find((h) => h && h.name === who);
    // 当天就阵亡/撤走的英雄不判（拿不到位置，不是"说谎"）
    if (!hero) {
      gone++;
      continue;
    }
    const inSight = watchers.some((w) => {
      const dx = w.pos.x - hero.pos.x;
      const dy = w.pos.y - hero.pos.y;
      return dx * dx + dy * dy <= HERO_SIGHT * HERO_SIGHT;
    });
    if (!inSight) phantom.push(`${who} 距最近的我方英雄 > ${HERO_SIGHT} 格，却报"进入视野"`);
  }
  return { coord, phantom, seen, gone };
}

/* ---------------- 检查器自检（负向对照） ---------------- */

if (SELFTEST) {
  // 造一个最小场景：人类 p1 的 hero1 与一名远处的 AI 英雄
  const state = createGame({ seed: 1, layout: 'ring', size: 'small', opponents: 1, difficulty: 'normal', playerName: '指挥官' });
  const viewer = viewerOf(state);
  const mine = state.heroOrder.map((id) => state.heroes[id]).find((h) => h && h.owner === viewer);
  const foe = Object.values(state.heroes).find((h) => h && h.owner !== viewer);
  if (!mine || !foe) {
    console.error('❌ 自检取不到人类/AI 英雄，环境不对');
    process.exit(2);
  }
  let bad = 0;

  const c = inspect(['紫晶密会 · 某人 从 (1,2) 移动到 (3,4)'], state);
  const okC = c.coord.length === 1;
  console.log(`${okC ? '✅' : '❌'} 负向对照① 坐标行军行 → ${okC ? '被抓到' : '漏掉了（闸失效）'}`);
  if (!okC) bad++;

  // 把 AI 英雄挪到离我方英雄很远的地方，再报一条"进入视野"
  const far = { x: 0, y: 0 };
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      if ((x - mine.pos.x) ** 2 + (y - mine.pos.y) ** 2 > (HERO_SIGHT + 3) ** 2) {
        far.x = x;
        far.y = y;
      }
    }
  }
  foe.pos = { ...far };
  const p = inspect([`某阵营 · ${foe.name} 出现在你的视野内`], state);
  const okP = p.phantom.length === 1;
  console.log(`${okP ? '✅' : '❌'} 负向对照② 谎报"进入视野" → ${okP ? '被抓到' : '漏掉了（闸失效）'}`);
  if (!okP) bad++;

  process.exit(bad ? 1 : 0);
}

/* ---------------- 真跑 ---------------- */

const allCoord = [];
const allPhantom = [];
let totalSeen = 0;
let totalGone = 0;
let days = 0;

for (const seed of SEEDS) {
  const state = createGame({
    seed,
    layout: 'ring',
    size: 'small',
    opponents: 3,
    difficulty: 'normal',
    playerName: '指挥官',
  });
  for (let d = 0; d < DAYS; d++) {
    if (state.status !== 'playing') break;
    const from = state.log.length;
    endDay(state);
    days++;
    const r = inspect(state.log.slice(from).map((l) => l.text), state);
    totalSeen += r.seen;
    totalGone += r.gone;
    allCoord.push(...r.coord);
    allPhantom.push(...r.phantom);
  }
}

const okCoord = allCoord.length === 0;
console.log(
  `${okCoord ? '✅' : '❌'} [aiday:coord] 日志里没有坐标行军行 — ${days} 天 / ${allCoord.length} 条` +
    (allCoord.length ? `\n     例：${allCoord[0]}` : ''),
);
const okSeen = allPhantom.length === 0;
console.log(
  `${okSeen ? '✅' : '❌'} [aiday:seen]「进入视野」全部属实 — ${totalSeen} 条（其中 ${totalGone} 条对象当天已不在场，跳过）` +
    (allPhantom.length ? `\n     例：${allPhantom[0]}` : ''),
);
if (totalSeen === 0) {
  console.log(`   ❌ ${SEEDS.length} 个 seed / ${days} 天里 AI 一次都没进过玩家视野 —— 判据②没被真正考验，不算通过。`);
  process.exit(1);
}

process.exit(okCoord && okSeen ? 0 : 1);
