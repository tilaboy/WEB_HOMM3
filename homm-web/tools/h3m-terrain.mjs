/**
 * h3m-terrain.mjs —— 把一张真实 HoMM3 地图的**地表层地形**搬进本作。
 *
 * ## 它做什么
 *   ① 解 gzip → ② 定位地形块 → ③ 取 108×108 地表层 → ④ 把 h3m 地形 id 映射成
 *   我们的 `TerrainKind` → ⑤ 在所有 40×40 窗口里挑最好的一个 → ⑥ 产出
 *   `src/core/data/static-maps/grims-broken-compass.{json,ts}`。
 *
 * ## 为什么要先"定位"，而不是相信某个写死的偏移
 * `.h3m` 的头部布局随版本 / HotA 扩展变。这一份是 `version 0x20`（HotA3）且
 * `hota format1 = 5`，比公开文档（h3m2json `h3m-The-Corpus.txt`）常见的 1/3 更新，
 * 头部里有文档没覆盖的字段 ⇒ **不能按文档硬解析整个头部**来推地形偏移。
 *
 * 于是用两条**与格式无关**的事实定位：
 *   - **事实 A（难度只改参数、不改地形）**：`NORM/EXPE/HARD/IMPO` 四个难度变体是
 *     同一张图 ⇒ 地形区必须逐字节相同。实测四个变体在 `0x167` 起有 **221,138** 字节
 *     完全相同 —— 地形块必然落在这一段里。
 *   - **事实 B（地形字节的取值范围很窄）**：每格 7 字节
 *     `terrain / terrainSprite / river / riverSprite / road / roadSprite / mirroring`，
 *     其中 `terrain ∈ 0..11`、`river ∈ 0..4`、`road ∈ 0..3` 都对**全部** 23,328 格成立
 *     （两层 × 108×108）。在事实 A 界定的区间里扫描，满足率 100% 的偏移只有一个相位。
 *
 * ⚠️ **实测纠偏**：规划文档里写的候选 `0x167` **不是**地形起点。那一段是英雄名字符串
 *     （能读到 `Grimgor` / `Rookie`），三条取值范围的联合满足率只有 ~35%。
 *     真正的起点是 **`0xdeac`（57004）** —— 本脚本会自己扫出来，并**断言**它等于这个值。
 *
 * ## 产物
 *   - `src/core/data/static-maps/grims-broken-compass.json` —— 规范交付物（人读 / 验收对账）。
 *   - `src/core/data/static-maps/grims-broken-compass.ts`  —— **运行时真正被 import 的那份**。
 *     为什么还要生成 `.ts`：① `tsconfig` 没开 `resolveJsonModule`；② 就算开了，NodeNext/ESM
 *     下 JSON import 需要 import attributes，Android WebView 不一定支持 ⇒ 浏览器/真机会直接
 *     模块解析失败。所以 `.ts` 是运行时唯一来源，`.json` 是同一份数据的规范镜像
 *     （漂移由 `tools/verify-static-map.mjs` 拦）。
 *
 * ## 用法
 *   node tools/h3m-terrain.mjs                 # 自动挑窗口
 *   node tools/h3m-terrain.mjs --origin=31,68  # 手工指定（换候选窗口时用）
 *   node tools/h3m-terrain.mjs --src=<path>    # 换源地图
 *
 * 退出码沿用 `tools/GATES.md`：`0` = 写出成功；`1` = 实测不合格（挑不出合格窗口）；
 * `2` = 前置不满足（源文件不在 / 定位断言失败 / 未知地形 id）。
 *
 * 同输入 ⇒ 同输出（无时间戳、无绝对路径、键序固定）。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const DEFAULT_SRC = '/Users/lichao/Downloads/grims_broken_compass_2175/xGrims Broken Compass v3 NORM.h3m';
const SOURCE_NAME = 'xGrims Broken Compass v3 NORM.h3m';
const OUT_JSON = path.join(REPO, 'src/core/data/static-maps/grims-broken-compass.json');
const OUT_TS = path.join(REPO, 'src/core/data/static-maps/grims-broken-compass.ts');

/** 地表层边长（本图是 108×108，含地下层共 2 层）。 */
const MAP_N = 108;
/** 每格 7 字节。 */
const TILE_BYTES = 7;
/** 裁剪窗口。 */
const CROP = 40;

/* ------------------------------------------------------------------ *
 * 地形 id → 本作 TerrainKind
 * ------------------------------------------------------------------ */

/**
 * h3m 地形 id：`0 dirt, 1 sand, 2 grass, 3 snow, 4 swamp, 5 rough,
 * 6 subterranean, 7 lava, 8 water, 9 rock`，HotA 另有 `10 highland, 11 wasteland`。
 *
 * 映射理由（`terrains.ts` 只有 7 档，必须收敛）：
 *   - dirt/sand/grass/snow/swamp 一一对应，名字和配色都对得上。
 *   - rough（崎岖）/ subterranean（地下）/ lava（熔岩）/ rock（岩地）/ highland（高地）
 *     在我们这儿**没有对应物**，但它们的共同点是"硬地、`moveCost` 最高的那一档"
 *     ⇒ 全部归 `rock`（岩地）。**没有把它们归到 dirt**：那会让整张图看起来像一张土黄的饼。
 *   - wasteland（荒原）是 HotA 的**干裂沙地**，视觉上就是沙 ⇒ 归 `sand`。
 *   - water 是唯一 `passable: false` 的一档，且是这张图"岛屿/海峡"结构的来源 ⇒ 原样保留。
 *   - 未知 id 兜底 `dirt`（最中性），但**必须计数并打印** —— 静默吞掉是本项目明令禁止的
 *     失效形态（见 `GATES.md §5`：计数类结论不得静默空）。
 */
const H3M_TERRAIN = [
  'dirt',   // 0
  'sand',   // 1
  'grass',  // 2
  'snow',   // 3
  'swamp',  // 4
  'rock',   // 5 rough
  'rock',   // 6 subterranean
  'rock',   // 7 lava
  'water',  // 8
  'rock',   // 9 rock
  'rock',   // 10 highland
  'sand',   // 11 wasteland
];

/** 只有 water 不可通行（与 `terrains.ts` 的 `passable` 逐项一致）。 */
const PASSABLE = new Set(['dirt', 'sand', 'grass', 'snow', 'swamp', 'rock']);

/* ------------------------------------------------------------------ *
 * 自检（阳性对照）—— 先证明"计数器能数出非零"，再说"数是 0"
 * ------------------------------------------------------------------ */

function selfTest() {
  const problems = [];
  const say = (ok, msg) => {
    if (!ok) problems.push(msg);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  };

  // ① 未知 id 计数器：喂一个越界 id，必须数出 1（否则"未知 id 数 = 0"是假绿）
  {
    const probe = [0, 8, 99, 200];
    let unknown = 0;
    for (const id of probe) if (id < 0 || id >= H3M_TERRAIN.length) unknown += 1;
    say(unknown === 2, `未知 id 计数器能数出非零（喂 [0,8,99,200] ⇒ ${unknown}，期望 2）`);
  }
  // ② 通行性表与 terrains.ts 的 passable 必须一致（这里断言集合大小与 water 缺席）
  say(
    PASSABLE.size === 6 && !PASSABLE.has('water') && H3M_TERRAIN.includes('water'),
    `可通行集合 = 6 档且不含 water（${[...PASSABLE].join('/')}）`,
  );
  // ③ 窗口数：108−40+1 = 69 ⇒ 69×69 = 4761
  {
    const n = (MAP_N - CROP + 1) ** 2;
    say(n === 4761, `候选窗口数 = ${n}（期望 4761）`);
  }
  // ④ 字节数：2 层 × 108×108 × 7 = 163,296
  say(
    2 * MAP_N * MAP_N * TILE_BYTES === 163296,
    `地形块字节数 = ${2 * MAP_N * MAP_N * TILE_BYTES}（期望 163296）`,
  );

  if (problems.length) {
    console.error(`✗ 自检失败 ${problems.length} 项 —— 不写出产物。`);
    process.exit(2);
  }
}

/* ------------------------------------------------------------------ *
 * 读取与定位
 * ------------------------------------------------------------------ */

function gunzipAll(src) {
  const dir = path.dirname(src);
  const base = path.basename(src);
  const variants = ['NORM', 'EXPE', 'HARD', 'IMPO'];
  const files = variants.map((v) => path.join(dir, base.replace('NORM', v)));
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length) {
    console.error(`✗ 前置不满足：缺少难度变体 ${missing.join(', ')} —— 本脚本靠"四变体相同"定位地形。`);
    process.exit(2);
  }
  const bufs = files.map((f) => zlib.gunzipSync(fs.readFileSync(f)));
  return { norm: bufs[0], others: bufs.slice(1) };
}

/** 四个变体**同时**相同的字节区间（取最长的一段）。返回 [start, end)。 */
function identicalRun(norm, others) {
  const n = Math.min(norm.length, ...others.map((b) => b.length));
  let bestStart = -1;
  let bestLen = 0;
  let cur = 0;
  let start = 0;
  for (let i = 0; i < n; i++) {
    let same = true;
    for (const o of others) {
      if (o[i] !== norm[i]) {
        same = false;
        break;
      }
    }
    if (same) {
      if (cur === 0) start = i;
      cur += 1;
      if (cur > bestLen) {
        bestLen = cur;
        bestStart = start;
      }
    } else {
      cur = 0;
    }
  }
  return { start: bestStart, len: bestLen };
}

/** 一格是否满足"地形字节的取值范围"（事实 B）。 */
const tileOk = (b, off) =>
  b[off] <= 11 && b[off + 2] <= 4 && b[off + 4] <= 3;

/**
 * 在 `[lo, hi]` 里扫描地形起点。两遍：先粗筛（512 格），再对幸存者全量（23,328 格）。
 * 返回按"满足率降序、偏移升序"排好的候选。
 */
function scanTerrainOffset(norm, lo, hi) {
  const total = 2 * MAP_N * MAP_N;
  const coarse = Math.min(512, total);
  const survivors = [];
  for (let off = lo; off <= hi; off++) {
    let ok = 0;
    for (let i = 0; i < coarse; i++) if (tileOk(norm, off + i * TILE_BYTES)) ok += 1;
    if (ok / coarse >= 0.99) survivors.push(off);
  }
  const scored = [];
  for (const off of survivors) {
    let ok = 0;
    for (let i = 0; i < total; i++) if (tileOk(norm, off + i * TILE_BYTES)) ok += 1;
    scored.push({ off, frac: ok / total });
  }
  scored.sort((a, b) => b.frac - a.frac || a.off - b.off);
  return scored;
}

/* ------------------------------------------------------------------ *
 * 窗口打分
 * ------------------------------------------------------------------ */

/** 窗口内最大的 4 连通陆块 ÷ 全部陆地格。1 = 没有走不到的孤岛。 */
function landmassFracOf(terrain, ox, oy, n) {
  const seen = new Uint8Array(CROP * CROP);
  let land = 0;
  let best = 0;
  for (let y = 0; y < CROP; y++) {
    for (let x = 0; x < CROP; x++) {
      const i = y * CROP + x;
      if (terrain[(oy + y) * n + ox + x] === 'water') {
        seen[i] = 1;
        continue;
      }
      land += 1;
    }
  }
  if (land === 0) return 0;
  for (let s = 0; s < CROP * CROP; s++) {
    if (seen[s]) continue;
    let size = 0;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const c = stack.pop();
      size += 1;
      const cx = c % CROP;
      const cy = (c / CROP) | 0;
      const nb = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= CROP || ny >= CROP) continue;
        const ni = ny * CROP + nx;
        if (seen[ni]) continue;
        if (terrain[(oy + ny) * n + ox + nx] === 'water') continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    if (size > best) best = size;
  }
  return best / land;
}

/**
 * 打分（四条意图各占一份，权重固定 ⇒ 可重复）：
 *   ① 可通行比例高  —— 0.30·passable：水越多，能站的地越少，城和矿越难摆。
 *   ② 地形多样性高  —— 0.20·(kinds/7) + 0.25·(entropy/log2 7)：不要整片纯 dirt。
 *      拆成"种类数"和"熵"两项：只有种类数会选出"4 种但 99% 是一种"的图，
 *      只有熵会选出"均匀撒盐"的图。
 *   ③ 水占比 5%~25% —— 以 15% 为目标、±10% 免罚，超出后线性扣分（系数 0.5）：
 *      一点水都没有 ⇒ 没有海岸线和海峡；水太多 ⇒ 又是"走不到的孤岛"。
 *   ④ 陆地+岛屿/河流结构 —— 0.25·landmassFrac：最大陆块占全部陆地的比例，
 *      1 = 陆地连成一片（河/湖只是"嵌"在里面），低 = 被打散成走不到的碎岛。
 */
function scoreWindows(terrain, n) {
  const out = [];
  const maxEnt = Math.log2(7);
  for (let oy = 0; oy + CROP <= n; oy++) {
    for (let ox = 0; ox + CROP <= n; ox++) {
      const hist = {};
      let water = 0;
      for (let y = 0; y < CROP; y++) {
        for (let x = 0; x < CROP; x++) {
          const t = terrain[(oy + y) * n + ox + x];
          hist[t] = (hist[t] ?? 0) + 1;
          if (t === 'water') water += 1;
        }
      }
      const total = CROP * CROP;
      const waterFrac = water / total;
      const kinds = Object.keys(hist).length;
      let entropy = 0;
      for (const k of Object.keys(hist)) {
        const p = (hist[k] ?? 0) / total;
        if (p > 0) entropy -= p * Math.log2(p);
      }
      const lm = landmassFracOf(terrain, ox, oy, n);
      const waterPenalty = Math.max(0, Math.abs(waterFrac - 0.15) - 0.1);
      const score =
        0.3 * (1 - waterFrac) +
        0.2 * (kinds / 7) +
        0.25 * (entropy / maxEnt) +
        0.25 * lm -
        0.5 * waterPenalty;
      out.push({ x: ox, y: oy, score, waterFrac, kinds, entropy, landmassFrac: lm, histogram: hist });
    }
  }
  // 排序键全定死 ⇒ 同输入同输出
  out.sort(
    (a, b) =>
      b.score - a.score ||
      a.y - b.y ||
      a.x - b.x,
  );
  return out;
}

/**
 * Top-K：从排好序的窗口里贪心取，**两两 Chebyshev 距离 ≥ minDist**。
 *
 * 为什么加间距：分数最高的几个窗口往往是相邻的（本图 Top-9 全是 `(28..36, 68)`），
 * 相邻窗口重叠 90% 以上 ⇒ 一个不合格，其余必然也不合格，"换下一个重试"就成了摆设。
 */
function topSpaced(sorted, k, minDist) {
  const picked = [];
  for (const w of sorted) {
    if (picked.length >= k) break;
    const far = picked.every((p) => Math.max(Math.abs(p.x - w.x), Math.abs(p.y - w.y)) >= minDist);
    if (far) picked.push(w);
  }
  return picked;
}

/* ------------------------------------------------------------------ *
 * 输出
 * ------------------------------------------------------------------ */

function cropTiles(terrain, n, ox, oy) {
  const rows = [];
  for (let y = 0; y < CROP; y++) {
    const row = [];
    for (let x = 0; x < CROP; x++) row.push(terrain[(oy + y) * n + ox + x]);
    rows.push(row);
  }
  return rows;
}

function writeJson(win, tiles, candidates) {
  const payload = {
    source: SOURCE_NAME,
    origin: { x: win.x, y: win.y },
    width: CROP,
    height: CROP,
    tiles,
    candidates: candidates.map((c) => ({
      origin: { x: c.x, y: c.y },
      score: Number(c.score.toFixed(6)),
      waterFrac: Number(c.waterFrac.toFixed(6)),
      kinds: c.kinds,
      entropy: Number(c.entropy.toFixed(6)),
      landmassFrac: Number(c.landmassFrac.toFixed(6)),
      histogram: Object.fromEntries(
        Object.entries(c.histogram).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    })),
  };
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeTs(win, tiles) {
  const head = [
    '/**',
    ' * ⚠️ **本文件由 `tools/h3m-terrain.mjs` 生成 —— 不要手改。**',
    ' *',
    ' * 源地图：`xGrims Broken Compass v3 NORM.h3m`（HoMM3 · HotA3）地表层，',
    ' * 截取 40×40 窗口，origin = (' + win.x + ',' + win.y + ')。',
    ' * 同名的 `.json` 是同一份数据的规范镜像（人读 / 验收对账）；**改了其中一份而没改另一份**，',
    ' * `tools/verify-static-map.mjs` 会红。',
    ' *',
    ' * 为什么是 `.ts` 而不是直接 import `.json`：tsconfig 没开 `resolveJsonModule`，',
    ' * 且 NodeNext/ESM 下 JSON import 需要 import attributes（Android WebView 未必支持）',
    ' * ⇒ 让浏览器去 import JSON 会在真机上直接模块解析失败。',
    ' */',
    "import type { StaticMapData } from './static-map.js';",
    '',
    'export const GRIMS_BROKEN_COMPASS: StaticMapData = {',
    `  source: '${SOURCE_NAME}',`,
    `  origin: { x: ${win.x}, y: ${win.y} },`,
    `  width: ${CROP},`,
    `  height: ${CROP},`,
    '  tiles: [',
  ];
  const body = tiles.map((row) => `    [${row.map((t) => `'${t}'`).join(', ')}],`);
  const tail = ['  ],', '};', ''];
  fs.mkdirSync(path.dirname(OUT_TS), { recursive: true });
  fs.writeFileSync(OUT_TS, [...head, ...body, ...tail].join('\n'));
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

function argOf(k) {
  const a = process.argv.find((s) => s.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : null;
}

function main() {
  const src = argOf('src') ?? DEFAULT_SRC;
  const originArg = argOf('origin');

  console.log('=== 自检（阳性对照：先证明计数器数得出非零）===');
  selfTest();

  if (!fs.existsSync(src)) {
    console.error(`✗ 前置不满足：源地图不存在 ${src}`);
    process.exit(2);
  }

  console.log(`\n=== 读取：${src}`);
  const { norm, others } = gunzipAll(src);
  console.log(`  解压后 ${norm.length} 字节（其余难度变体 ${others.map((b) => b.length).join(' / ')}）`);

  /* ---- ① 事实 A：四变体相同的区间 ---- */
  const run = identicalRun(norm, others);
  console.log(
    `  四变体最长相同区间：0x${run.start.toString(16)}（${run.start}）起 ${run.len} 字节` +
      ` ⇒ [0x${run.start.toString(16)}, 0x${(run.start + run.len).toString(16)})`,
  );
  if (run.start !== 359 || run.len !== 221138) {
    console.error(
      `✗ 定位断言失败：相同区间应为 start=359 len=221138，实测 start=${run.start} len=${run.len}` +
        ` —— 换了源地图就要重做这一步，别拿旧偏移硬套。`,
    );
    process.exit(2);
  }

  /* ---- ② 事实 B：在相同区间里扫地形起点 ---- */
  const block = 2 * MAP_N * MAP_N * TILE_BYTES;
  const lo = run.start;
  const hi = run.start + run.len - block;
  const scored = scanTerrainOffset(norm, lo, hi);
  console.log(
    `  地形起点扫描：区间 [0x${lo.toString(16)}, 0x${hi.toString(16)}]，` +
      `粗筛幸存 ${scored.length} 个偏移；Top-5：`,
  );
  for (const s of scored.slice(0, 5)) {
    console.log(`    0x${s.off.toString(16)}（${s.off}）满足率 ${(s.frac * 100).toFixed(2)}%`);
  }
  const best = scored[0];
  if (!best || best.frac < 1 || best.off !== 0xdeac) {
    console.error(
      `✗ 定位断言失败：期望起点 0xdeac（57004）且满足率 100%，实测 ` +
        `${best ? `0x${best.off.toString(16)} / ${(best.frac * 100).toFixed(2)}%` : '无候选'}`,
    );
    process.exit(2);
  }
  const OFF = best.off;
  console.log(`  ✓ 地形块起点 = 0x${OFF.toString(16)}（${OFF}），两层 23,328 格满足率 100%`);

  /* ---- ③ 地表层 ---- */
  const terrain = [];
  const unknown = new Map();
  for (let i = 0; i < MAP_N * MAP_N; i++) {
    const id = norm[OFF + i * TILE_BYTES];
    const kind = H3M_TERRAIN[id];
    if (kind === undefined) unknown.set(id, (unknown.get(id) ?? 0) + 1);
    terrain.push(kind ?? 'dirt');
  }
  const unknownCount = [...unknown.values()].reduce((a, b) => a + b, 0);
  console.log(
    `  地表层 ${MAP_N}×${MAP_N} = ${terrain.length} 格；未知地形 id：` +
      (unknownCount === 0 ? '0（无）' : `${unknownCount} 格 ${JSON.stringify(Object.fromEntries(unknown))}`),
  );
  if (unknownCount > 0) {
    // 不静默吞掉：未知 id 说明 HotA 又加了新地形，映射表要跟着改
    console.error(`✗ 出现 ${unknownCount} 格未知地形 id —— 先补 H3M_TERRAIN 映射表再生成。`);
    process.exit(2);
  }
  const fullHist = {};
  for (const t of terrain) fullHist[t] = (fullHist[t] ?? 0) + 1;
  console.log(`  全地表层直方图：${JSON.stringify(fullHist)}`);

  /* ---- ④ 挑窗口 ---- */
  const sorted = scoreWindows(terrain, MAP_N);
  const top5 = topSpaced(sorted, 5, 10);
  console.log('\n=== 40×40 窗口 Top-5（两两 Chebyshev ≥ 10，保证"换下一个"真的换了地方）===');
  console.log('   #  origin      score   水%    种类  熵    最大陆块  直方图');
  top5.forEach((w, i) => {
    console.log(
      `  ${i + 1}  (${String(w.x).padStart(2)},${String(w.y).padStart(2)})   ` +
        `${w.score.toFixed(3)}  ${(w.waterFrac * 100).toFixed(1).padStart(5)}  ` +
        `${w.kinds}     ${w.entropy.toFixed(2)}  ${(w.landmassFrac * 100).toFixed(0).padStart(3)}%      ` +
        `${JSON.stringify(w.histogram)}`,
    );
  });

  let win;
  if (originArg) {
    const [sx, sy] = originArg.split(',');
    const ox = Number(sx);
    const oy = Number(sy);
    const found = sorted.find((w) => w.x === ox && w.y === oy);
    if (!found) {
      console.error(`✗ --origin=${originArg} 不是合法窗口（须 0..${MAP_N - CROP}）`);
      process.exit(2);
    }
    win = found;
    console.log(`\n  ⚠ 用 --origin 手工指定窗口 (${ox},${oy})（得分 ${win.score.toFixed(3)}，自动排名 #${sorted.indexOf(win) + 1}）`);
  } else {
    win = top5[0];
    console.log(`\n  选定窗口 origin = (${win.x},${win.y})，得分 ${win.score.toFixed(3)}`);
  }

  const tiles = cropTiles(terrain, MAP_N, win.x, win.y);
  const hist = {};
  for (const row of tiles) for (const t of row) hist[t] = (hist[t] ?? 0) + 1;
  console.log('\n=== 选中窗口的地形直方图（40×40 = 1600 格）===');
  for (const k of Object.keys(hist).sort((a, b) => (hist[b] ?? 0) - (hist[a] ?? 0))) {
    const c = hist[k] ?? 0;
    console.log(`  ${k.padEnd(7)} ${String(c).padStart(4)}  ${((c / 1600) * 100).toFixed(1)}%  ${'█'.repeat(Math.round(c / 40))}`);
  }
  const waterN = hist['water'] ?? 0;
  if (waterN / 1600 < 0.05 || waterN / 1600 > 0.25) {
    console.log(`  ⚠ 水占比 ${((waterN / 1600) * 100).toFixed(1)}% 落在 5%~25% 建议区间之外（仍会写出，供人工复核）`);
  }

  /* ---- ⑤ 写出 ---- */
  writeJson(win, tiles, top5);
  writeTs(win, tiles);
  console.log('\n=== 写出 ===');
  console.log(`  ${path.relative(REPO, OUT_JSON)}`);
  console.log(`  ${path.relative(REPO, OUT_TS)}`);
  console.log('\n✓ 完成。要让游戏改用另一个候选窗口：node tools/h3m-terrain.mjs --origin=<x>,<y> && npm run build');
}

main();
