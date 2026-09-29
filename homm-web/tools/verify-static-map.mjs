/**
 * verify-static-map.mjs —— **静态地形场景 `grims-showcase` 的门**（不是报表）。
 *
 * ## 它判什么
 * 拿**构建产物**（`dist/`）真开一局 `grims-showcase`，断言：
 *   ① 地图 40×40；
 *   ② 地形逐格 == 源 h3m crop 区域（`src/core/data/static-maps/*.json`），且直方图一致；
 *   ③ 4 家城堡（2×2 四格）+ 4 位英雄出生格 + 全部矿场都在**可通行**格上；
 *   ④ 从每家城堡出发能走到**地图中心区域**（连通性）；
 *   ⑤ 开了 `rush` 的 AI 至少能算出（并且真的走出）一条朝玩家推进的路径。
 *
 * ## 为什么还需要"阳性对照"那一节（`GATES.md §5`）
 * 只会绿的门 = 假门。本门每一条断言都配了一个"故意改坏"的反向输入，证明它**能红**：
 *   · 城堡一格改水 ⇒ ③ 必须报冲突；
 *   · 矿一格改水   ⇒ ③ 必须报冲突；
 *   · 城堡被水围死 ⇒ ④ 必须判不连通；
 *   · JSON 改一格  ⇒ ② 必须判不一致（否则"逐格比对"其实是空跑）；
 *   · 拿 32×32 比  ⇒ ① 必须判尺寸不符。
 * 反向输入一律作用在**克隆**出来的数据上，**绝不改**被测的那一局。
 *
 * ## 退出码（`tools/GATES.md` 四码约定）
 *   `0` 全过 / `1` 量到了、结论"不过" / `2` 前置不满足（没构建 / 缺 JSON）。
 *   ★ 阳性对照失败也算 `1`：那说明这道门本身已经假了，不能算"通过"。
 *
 * 用法：node tools/verify-static-map.mjs [--dist=<dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, distDir, distUrl, printHeader, requireFile } from './_dist.mjs';

/* `--dist=<dir>`（缺省 `<repo>/dist`，逐字不变）—— team-lead #164。 */
const DIST = distDir();
printHeader(DIST, 'gate=verify-static-map');
const dimp = (rel) => distUrl(rel, DIST);

const SCENARIO_ID = 'grims-showcase';
const CROP = 40;
const JSON_REL = 'src/core/data/static-maps/grims-broken-compass.json';

/* ---------------- 前置（`2`） ---------------- */
requireFile(DIST, 'core/map/generator.js');
requireFile(DIST, 'core/data/scenarios.js');
requireFile(DIST, 'core/data/static-maps/grims-broken-compass.js');
const jsonPath = path.join(REPO_ROOT, JSON_REL);
if (!fs.existsSync(jsonPath)) {
  console.error(`✗ 前置不满足：${JSON_REL} 不存在 —— 先跑 node tools/h3m-terrain.mjs。`);
  process.exit(2);
}

/* ---------------- 被测对象 ---------------- */
const { createGame, staticTerrainConflicts } = await import(dimp('core/map/generator.js'));
const { SCENARIO_BY_ID, scenarioGenOptions } = await import(dimp('core/data/scenarios.js'));
const { TERRAIN } = await import(dimp('core/data/terrains.js'));
const { castleCells, idx } = await import(dimp('core/map/grid.js'));
const { computePaths, buildPath } = await import(dimp('core/map/pathfinding.js'));
const { runAiTurn } = await import(dimp('core/game/ai.js'));
const { GRIMS_BROKEN_COMPASS: MODULE_DATA } = await import(
  dimp('core/data/static-maps/grims-broken-compass.js')
);
const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

const def = SCENARIO_BY_ID[SCENARIO_ID];
if (!def) {
  console.error(`✗ 前置不满足：dist 里没有场景 ${SCENARIO_ID} —— 先 npm run build。`);
  process.exit(2);
}

let state;
try {
  state = createGame(scenarioGenOptions(def));
} catch (e) {
  // 生成期就抛（静态地形尺寸不符 / 校验不过）⇒ 这是**量到了**的不合格，不是环境坏
  console.error(`✗ 生成 ${SCENARIO_ID} 时抛错：${e.message}`);
  process.exit(1);
}
const map = state.map;

/* ---------------- 记分 ---------------- */
let fails = 0;
const record = (name, pass, detail = '') => {
  if (!pass) fails += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` —— ${detail}` : ''}`);
};

/** 只看地形、不看物件阻挡的 4 邻域 BFS（连通性量的是"地形走不走得到"）。 */
function terrainReach(m, from) {
  const seen = new Uint8Array(m.width * m.height);
  const start = idx(m, from.x, from.y);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const c = stack.pop();
    const cx = c % m.width;
    const cy = (c / m.width) | 0;
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
      if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
      const ni = ny * m.width + nx;
      if (seen[ni]) continue;
      if (!TERRAIN[m.tiles[ni].terrain].passable) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return seen;
}

/** 中心 6×6（40×40 ⇒ 17..22）里至少一格可达。 */
function reachesCentre(m, from) {
  const seen = terrainReach(m, from);
  const lo = Math.floor(m.width / 2) - 3;
  const hi = lo + 5;
  let hit = 0;
  for (let y = lo; y <= hi; y++) {
    for (let x = lo; x <= hi; x++) if (seen[idx(m, x, y)]) hit += 1;
  }
  return hit;
}

/** 直方图（计数对象，键序固定）。 */
function histogramOf(tiles) {
  const h = {};
  for (const t of tiles) h[t.terrain] = (h[t.terrain] ?? 0) + 1;
  return Object.fromEntries(Object.keys(h).sort().map((k) => [k, h[k]]));
}

console.log(`\n场景 ${SCENARIO_ID}：seed ${state.seed} · ${map.width}×${map.height} · origin (${MODULE_DATA.origin.x},${MODULE_DATA.origin.y})`);

/* ================= ① 尺寸 ================= */
record(
  '① 地图尺寸 40×40',
  map.width === CROP && map.height === CROP,
  `实测 ${map.width}×${map.height}`,
);

/* ================= ② 地形与源 crop 一致 ================= */
{
  let diff = 0;
  let firstDiff = '';
  for (let y = 0; y < CROP; y++) {
    for (let x = 0; x < CROP; x++) {
      const got = map.tiles[idx(map, x, y)].terrain;
      const want = json.tiles[y][x];
      if (got !== want) {
        diff += 1;
        if (!firstDiff) firstDiff = `首处 (${x},${y}) 期望 ${want} 实测 ${got}`;
      }
    }
  }
  record(
    `② 地形逐格 == 源 crop（${CROP * CROP} 格）`,
    diff === 0 && CROP * CROP === 1600,
    diff === 0 ? '1600/1600 全等' : `${diff} 格不一致，${firstDiff}`,
  );

  const got = histogramOf(map.tiles);
  const want = {};
  for (const row of json.tiles) for (const t of row) want[t] = (want[t] ?? 0) + 1;
  const wantSorted = Object.fromEntries(Object.keys(want).sort().map((k) => [k, want[k]]));
  const same = JSON.stringify(got) === JSON.stringify(wantSorted);
  record(
    '② 地形直方图 == 源 crop',
    same && Object.keys(got).length > 0,
    same ? JSON.stringify(got) : `实测 ${JSON.stringify(got)} vs 期望 ${JSON.stringify(wantSorted)}`,
  );
}

/* ================= ②b .ts 与 .json 无漂移 ================= */
{
  let diff = 0;
  for (let y = 0; y < CROP; y++) {
    for (let x = 0; x < CROP; x++) if (MODULE_DATA.tiles[y][x] !== json.tiles[y][x]) diff += 1;
  }
  const sameMeta =
    MODULE_DATA.origin.x === json.origin.x &&
    MODULE_DATA.origin.y === json.origin.y &&
    MODULE_DATA.width === json.width &&
    MODULE_DATA.height === json.height;
  record(
    '②b 运行时模块与 .json 无漂移',
    diff === 0 && sameMeta,
    diff === 0 && sameMeta ? '1600 格 + origin/尺寸一致' : `${diff} 格漂移 或 元信息不一致`,
  );
}

/* ================= ③ 城堡 / 英雄 / 矿 都在可通行格 ================= */
const homeGates = ['p1', 'p2', 'p3', 'p4']
  .map((f) => state.towns[f === 'p1' ? 'town_home' : `town_${f}`])
  .filter(Boolean)
  .map((t) => t.pos);
const mines = Object.values(map.objects).filter((o) => o.kind === 'mine');
const heroes = Object.values(state.heroes);

{
  const conflicts = staticTerrainConflicts(map, homeGates, heroes.map((h) => h.pos));
  // ★ `conflicts.length === 0` 这类"零"必须带非空守卫：城/英雄/矿一个都没查到时它恒为 0。
  const nonEmpty = homeGates.length === 4 && heroes.length === 4 && mines.length > 0;
  record(
    `③ 城堡 2×2 / 英雄 / 矿场全在可通行格（4 城 + ${heroes.length} 英雄 + ${mines.length} 矿）`,
    conflicts.length === 0 && nonEmpty,
    conflicts.length === 0
      ? `0 处冲突（非空：城 ${homeGates.length}、英雄 ${heroes.length}、矿 ${mines.length}）`
      : `${conflicts.length} 处：${conflicts.slice(0, 5).join(' / ')}`,
  );

  // 逐类拆开报，便于一眼看出是哪一类坏了
  let castleBad = 0;
  for (const g of homeGates) {
    for (const c of castleCells(g)) {
      if (!TERRAIN[map.tiles[idx(map, c.x, c.y)].terrain].passable) castleBad += 1;
    }
  }
  record(
    `③ 4 家城堡 2×2 共 ${homeGates.length * 4} 格全部可通行`,
    castleBad === 0 && homeGates.length === 4,
    `${castleBad} 格落在水上`,
  );
  const heroBad = heroes.filter((h) => !TERRAIN[map.tiles[idx(map, h.pos.x, h.pos.y)].terrain].passable).length;
  record(`③ ${heroes.length} 位英雄出生格可通行`, heroBad === 0 && heroes.length === 4, `${heroBad} 位落水`);
  const mineBad = mines.filter((o) => !TERRAIN[map.tiles[idx(map, o.pos.x, o.pos.y)].terrain].passable).length;
  record(`③ ${mines.length} 座矿场可通行`, mineBad === 0 && mines.length > 0, `${mineBad} 座落水`);
}

/* ================= ④ 连通性：每家城堡 → 地图中心 ================= */
for (const g of homeGates) {
  const hit = reachesCentre(map, g);
  record(`④ 城堡 (${g.x},${g.y}) 能走到地图中心区域`, hit > 0, `中心 6×6 命中 ${hit}/36 格`);
}

/* ================= ⑤ rush AI 的推进路径 ================= */
{
  record(
    `⑤ ${SCENARIO_ID} 的 aiIntent = rush`,
    def.aiIntent === 'rush',
    `实测 ${def.aiIntent}`,
  );

  const foeHome = state.towns['town_home'];
  for (const f of ['p2', 'p3', 'p4']) {
    const hero = state.heroes[`hero_${f}`];
    if (!hero) continue;
    const field = computePaths(state, hero.pos, Infinity);
    const target = { x: foeHome.pos.x, y: foeHome.pos.y };
    const cost = field.cost[idx(map, target.x, target.y)];
    const p = buildPath(state, field, hero.pos, target);
    record(
      `⑤ ${f} 能算出朝玩家主城的推进路径`,
      isFinite(cost) && cost > 0 && p.length > 0,
      `cost=${isFinite(cost) ? cost : '∞'} · 路径 ${p.length} 步`,
    );
  }

  // 真跑一天，看 AI 是不是**实际**朝玩家挪（不是只"算得出"）
  for (const f of ['p2', 'p3', 'p4']) {
    const hero = state.heroes[`hero_${f}`];
    if (!hero) continue;
    const before = Math.abs(hero.pos.x - foeHome.pos.x) + Math.abs(hero.pos.y - foeHome.pos.y);
    const pos0 = { x: hero.pos.x, y: hero.pos.y };
    runAiTurn(state, f);
    const after = Math.abs(hero.pos.x - foeHome.pos.x) + Math.abs(hero.pos.y - foeHome.pos.y);
    record(
      `⑤ ${f} 跑一天后确实朝玩家推进`,
      after < before,
      `(${pos0.x},${pos0.y})→(${hero.pos.x},${hero.pos.y})，曼哈顿 ${before}→${after}`,
    );
  }
}

/* ================= 阳性对照：证明上面每一条**能红** ================= */
console.log('\n--- 阳性对照（故意改坏，断言必须判不合格；全部作用在克隆数据上）---');
{
  const cloneMap = () => structuredClone(map);

  // PC1 城堡一格改水 ⇒ ③ 必须报冲突
  {
    const m = cloneMap();
    const g = homeGates[0];
    const c = castleCells(g)[0];
    m.tiles[idx(m, c.x, c.y)].terrain = 'water';
    const conflicts = staticTerrainConflicts(m, homeGates, heroes.map((h) => h.pos));
    record(
      'PC1 城堡一格改水 ⇒ 校验必须报冲突',
      conflicts.length > 0,
      `报出 ${conflicts.length} 处${conflicts.length ? `：${conflicts[0]}` : ''}`,
    );
  }
  // PC2 矿一格改水 ⇒ ③ 必须报冲突
  {
    const m = cloneMap();
    const mine = mines[0];
    m.tiles[idx(m, mine.pos.x, mine.pos.y)].terrain = 'water';
    const conflicts = staticTerrainConflicts(m, homeGates, heroes.map((h) => h.pos));
    record('PC2 矿场一格改水 ⇒ 校验必须报冲突', conflicts.length > 0, `报出 ${conflicts.length} 处`);
  }
  // PC3 城堡被水围死 ⇒ ④ 必须判不连通
  {
    const m = cloneMap();
    const g = homeGates[0];
    for (let i = 0; i < m.tiles.length; i++) m.tiles[i].terrain = 'water';
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        m.tiles[idx(m, g.x + dx, g.y + dy)].terrain = 'swamp';
      }
    }
    const hit = reachesCentre(m, g);
    record('PC3 城堡被水围死 ⇒ 连通性必须判不连通', hit === 0, `中心命中 ${hit}/36（期望 0）`);
  }
  // PC4 JSON 改一格 ⇒ ② 的逐格比对必须判不一致
  {
    const j = structuredClone(json);
    j.tiles[0][0] = j.tiles[0][0] === 'water' ? 'swamp' : 'water';
    let diff = 0;
    for (let y = 0; y < CROP; y++) {
      for (let x = 0; x < CROP; x++) if (map.tiles[idx(map, x, y)].terrain !== j.tiles[y][x]) diff += 1;
    }
    record('PC4 JSON 改一格 ⇒ 逐格比对必须判不一致', diff > 0, `报出 ${diff} 格不一致`);
  }
  // PC5 尺寸：拿 32×32 的图来比 ⇒ ① 必须判不符
  {
    const small = createGame({ size: 'medium', layout: 'wild', seed: 1, opponents: 0, difficulty: 'normal' });
    const bad = !(small.map.width === CROP && small.map.height === CROP);
    record('PC5 32×32 的图 ⇒ 尺寸断言必须判不符', bad, `实测 ${small.map.width}×${small.map.height}`);
  }
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
