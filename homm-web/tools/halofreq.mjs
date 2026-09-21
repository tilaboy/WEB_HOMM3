#!/usr/bin/env node
/**
 * halofreq.mjs —— 「边界带压到单位」的**频率**（`#168` 终判的前置输入）。
 * 新增者 = `art-director`（team-lead 批准自启动 · 2026-09-21）。**读 `dist` 只读、不重建、不写任何文件。**
 *
 * ## 它回答一句什么问题
 * `#168` 的合成对照证明了「带会压到单位、最坏覆盖 `13.5%`（`treant`，不透明）」，
 * 但**没说这种配置在真玩中有多常见** —— 罕见 ⇒ 观感可接受；常见 ⇒ 必须谈第三方案。
 * 本工具就量这个**频率**。
 *
 * ## ★ 口径（我读码定的；与 `MapRenderer.ts:636/663/668-690` 逐句对齐）
 * `MapRenderer` 的边界带画在**「非可达格」朝「可达格」那一侧**，其可达性谓词是
 *   `inRegion(x,y) = inBounds && isRevealed(state,'p1',x,y) && isFinite(field.cost[idx])`
 * 而 `field` = `vm.reachable` = **`computePaths(state, selectedHero.pos, selectedHero.movePoints)`**
 *   ⇒ ★ `MapRenderer.ts:636` + `main.ts:620/1572`：**这是"本回合剩余移动力"的可达圈，不是"全图可达"**。
 *   ⇒ ★ `main.ts:613`：**没有选中英雄时 `fieldTurn = null` ⇒ 带层整层不画**。
 *   ⇒ ★ 所以「不可达」**不等于"障碍地形"**：**"超出本回合移动力"的平地也是"不可达"**
 *     ⇒ 带会围着**移动力圈**走。这条是本工具存在的理由（`#168` 的"三邻不可走"读窄了）。
 *
 * 对站在 `T` 的单位，两种压法分开数（**单位别混**）：
 *   · **`ownBands`（带画在单位自己格内 = 直接压精灵）**：`T` 本身落进带分支、且某条边朝 `inRegion` 邻居。
 *   · **`nbrBands`（带画在隔壁格、朝本格那一侧 = 压到精灵的"伸格"部分）**：`inRegion(T)` 且邻居落进带分支。
 *   ⇒ `MapRenderer.ts:678-681` 的 `top/bot/lft/rgt = inRegion(...)` 就是这个计数。
 *
 * ## ★ population（写全 —— 报数必须连它一起给）
 *   · 地图：`SCENARIO_BY_ID.tutorial` / `.duel`（两张试玩图，`#137`）
 *   · 种子：`8` 个（与 `contactaudit.mjs` 同一组，便于对表）
 *   · 天：`1..10`（`endDay` 推进）
 *   · 单位实例 = **全部英雄（任意 owner）+ 全部 `wanderingMonster`**（`state.map.objects`）
 *   · "选中英雄" = **逐个 p1 英雄各当一次**（真玩里玩家可选任一己方英雄）
 *   · 移动力采样点 = **满 / 半 / 一格 / 零**（`movePoints` 的 `1 / 0.5 / ≈1格 / 0`）
 *   · 每个单位实例在**同时点、同移动力**下计一次 ⇒ `n = 地图 × 种子 × 天 × 选中英雄 × 单位 × 采样点`
 *
 * ## ⚠️ 诚实边界（不得越过它引用本表）
 *   ① 我**没有模拟玩家的移动轨迹** ⇒ 采的是"回合开始、移动力为 X"的**静态时点**，
 *      **不是"真玩中所有时刻"**。真玩里移动力是**连续递减**的，而递减过程中的中间值由
 *      `1/0.5/1格/0` 四点**夹逼** ⇒ 读法 = **"这四点上的频率"**，不是"轨迹上的频率"。
 *   ② `endDay` 只推进**天**，**不跑 AI 的整回合决策**（`hero.movePoints` 停在"天开始"的值）
 *      ⇒ "满"那一点 = **回合开始**，不是"玩家选了英雄那一刻"。
 *   ③ `fogClose`（`#155`）**两种都算**（`off` = 现行默认 / `on` = 修法默认化后），**分列报告** —— 不得合并。
 *   ④ 本工具**只数几何配置**（有没有带压到），**不判可读性** ⇒ 观感判定仍在 `#168`/`#158`（`art-director`）。
 *   ⑤ 阈值 `T` **不由本工具设**（team-lead 裁：先看数再定 `T`）⇒ 本工具只出**分布**。
 *
 * 用法：node tools/halofreq.mjs            （缺省读 `<repo>/dist`）
 *       node tools/halofreq.mjs --dist=dist-hf
 * 退出码：0 = 出了数；2 = 环境没准备好（`dist` 缺构建产物）。
 */
import { distDir, distUrl, printHeader, requireFile } from './_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'measure=halofreq');
const u = (rel) => distUrl(rel, DIST);

requireFile(DIST, 'core/map/generator.js'); // 缺 ⇒ exit 2（前置不满足）

const { createGame } = await import(u('core/map/generator.js'));
const { computePaths } = await import(u('core/map/pathfinding.js'));
const { isRevealed } = await import(u('core/map/fog.js'));
const { endDay } = await import(u('core/game/turn.js'));
const { SCENARIO_BY_ID } = await import(u('core/data/scenarios.js'));

const idx = (m, x, y) => y * m.width + x;
const SEEDS = [1000, 8717, 16434, 24151, 31868, 39585, 47302, 55019];
const DAYS = Number(process.env.HF_DAYS || 10);
const SCEN_IDS = (process.env.HF_SCEN || 'tutorial,duel').split(',').map((s) => s.trim()).filter(Boolean);
/** 移动力采样点：满 / 半 / 一格 / 零。（"一格"用 1 点 = 最便宜的一步 ⇒ 移动力圈的**最紧**情形。） */
const MP_POINTS = [
  { id: 'full', f: (mp) => mp },
  { id: 'half', f: (mp) => Math.floor(mp / 2) },
  { id: 'one-step', f: () => 1 },
  { id: 'zero', f: () => 0 },
];

/** 落在"带分支"的格（= 该格自身会画带）判据 —— 与 `MapRenderer.ts:668-676` 逐句对齐。 */
function drawsBand(state, player, field, fogClose, m, x, y) {
  if (x < 0 || y < 0 || x >= m.width || y >= m.height) return false;
  const rev = isRevealed(state, player, x, y);
  const c = field.cost[idx(m, x, y)];
  if (rev && Number.isFinite(c)) return false; // c>0 填蓝、c===0 是英雄格 ⇒ 都 `continue`，不画带
  if (!rev && !fogClose) return false; // 未探索：默认 `continue`
  return true;
}

function inRegion(state, player, field, m, x, y) {
  if (x < 0 || y < 0 || x >= m.width || y >= m.height) return false;
  if (!isRevealed(state, player, x, y)) return false;
  return Number.isFinite(field.cost[idx(m, x, y)]);
}

/** 对单位所在格 `T`，数「带压到它」的两种方式。 */
function overlapAt(state, player, field, fogClose, m, T) {
  const x = T.x;
  const y = T.y;
  const N = [
    [x, y - 1],
    [x, y + 1],
    [x - 1, y],
    [x + 1, y],
  ];
  const self = drawsBand(state, player, field, fogClose, m, x, y)
    ? N.filter(([nx, ny]) => inRegion(state, player, field, m, nx, ny)).length
    : 0;
  const selfIn = inRegion(state, player, field, m, x, y);
  const nbr = selfIn
    ? N.filter(([nx, ny]) => drawsBand(state, player, field, fogClose, m, nx, ny)).length
    : 0;
  return { self, nbr, selfIn };
}

/** 直方图 + 计数。 */
function mkHist() {
  return { n: 0, self: [0, 0, 0, 0, 0], nbr: [0, 0, 0, 0, 0], nbrGe3: 0, selfAny: 0, selfGe3: 0 };
}
function add(h, o) {
  h.n++;
  h.self[o.self]++;
  h.nbr[o.nbr]++;
  if (o.nbr >= 3) h.nbrGe3++;
  if (o.self >= 1) h.selfAny++;
  if (o.self >= 3) h.selfGe3++;
}
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
const line = (id, h) =>
  `  ${id.padEnd(9)} n=${String(h.n).padStart(7)} | ownBands 0/1/2/3/4 = ${h.self.map((v) => String(v).padStart(6)).join(' / ')}`
  + ` | ≥1 ${pct(h.selfAny, h.n).padStart(6)} ≥3 ${pct(h.selfGe3, h.n).padStart(6)}`
  + ` || nbrBands 0/1/2/3/4 = ${h.nbr.map((v) => String(v).padStart(6)).join(' / ')}`
  + ` | ≥3 ${pct(h.nbrGe3, h.n).padStart(6)}`;

const MP_LABEL = { full: '满', half: '半', 'one-step': '一格', zero: '零' };

console.log('── 「边界带压到单位」的频率（几何配置计数；按是否压到，不判可读性） ──');
console.log(`  population：地图 ${SCEN_IDS.join('+')} × 种子 ${SEEDS.length} × 天 1..${DAYS} × 选中英雄(逐个 p1) × 单位(英雄+野怪) × 移动力点 ${MP_POINTS.length}`);
console.log('  ⚠️ 诚实边界：① 未模拟玩家移动轨迹 ⇒ 采的是"回合开始、移动力= X"的静态时点（由 满/半/一格/零 夹逼），不是"真玩所有时刻"；');
console.log('                ② endDay 只推天、不跑 AI 整回合；③ fogClose off/on 分列、不得合并；④ 只出分布、不设阈值 T。');

/** mp → { fogOff, fogOn } 两份直方图（全单位 / 仅选中英雄） */
const acc = new Map();
const bump = (mpId, which, key, o) => {
  const k = `${mpId}|${which}|${key}`;
  if (!acc.has(k)) acc.set(k, mkHist());
  add(acc.get(k), o);
};

let unitInstances = 0;
let heroInstances = 0;

for (const sid of SCEN_IDS) {
  const sc = SCENARIO_BY_ID[sid];
  if (!sc) {
    console.error(`SCENARIO_BY_ID.${sid} 不存在 ⇒ 场景没接上`);
    process.exit(2);
  }
  for (const seed of SEEDS) {
    const state = createGame({ ...sc.config, seed, scenario: sc.id });
    for (let day = 1; day <= DAYS && state.status === 'playing'; day++) {
      const m = state.map;
      // ↓ 本日测量（同一 `state`，测完再 `endDay` 推进 —— 单循环，别写两次天循环）
      const objUnits = Object.values(m.objects).filter((o) => o.kind === 'wanderingMonster');
      const p1Heroes = state.heroOrder.map((id) => state.heroes[id]).filter((h) => h && h.owner === 'p1');
      for (const hero of p1Heroes) {
        const mpFull = hero.movePoints;
        if (!(mpFull > 0)) continue; // 天开始应当 > 0；为 0 则没有"满/半"可采
        for (const mp of MP_POINTS) {
          const limit = mp.f(mpFull);
          const field = computePaths(state, hero.pos, limit);
          for (const fc of [false, true]) {
            const tag = fc ? 'on' : 'off';
            // ① 全部单位（英雄 + 野怪），**含**当前选中英雄自己
            for (const h of state.heroOrder.map((id) => state.heroes[id]).filter(Boolean)) {
              const o = overlapAt(state, 'p1', field, fc, m, h.pos);
              bump(mp.id, tag, 'all-units', o);
              unitInstances++;
              if (h === hero) {
                bump(mp.id, tag, 'sel-hero', o);
                heroInstances++;
              }
            }
            for (const mo of objUnits) {
              const o = overlapAt(state, 'p1', field, fc, m, mo.pos);
              bump(mp.id, tag, 'all-units', o);
              unitInstances++;
            }
          }
        }
      }
      endDay(state); // 推进一天（注意：`endDay` 会重算 `movePoints` ⇒ 下一天的"满"是新的一天的满）
    }
  }
}

for (const mp of MP_POINTS) {
  for (const tag of ['off', 'on']) {
    console.log(`\n【移动力 = ${MP_LABEL[mp.id]} · fogClose=${tag}${tag === 'off' ? '（现行默认）' : '（#155 默认化后）'}】`);
    console.log(line('全单位', acc.get(`${mp.id}|${tag}|all-units`) || mkHist()));
    console.log(line('选中英雄', acc.get(`${mp.id}|${tag}|sel-hero`) || mkHist()));
  }
}

console.log('\n【合计 · 四个移动力点等权相加 —— ⚠️ 等权是**人为**的，不是真玩的时间权重】');
for (const tag of ['off', 'on']) {
  for (const which of ['all-units', 'sel-hero']) {
    const h = mkHist();
    for (const mp of MP_POINTS) {
      const s = acc.get(`${mp.id}|${tag}|${which}`);
      if (!s) continue;
      h.n += s.n;
      for (let i = 0; i < 5; i++) {
        h.self[i] += s.self[i];
        h.nbr[i] += s.nbr[i];
      }
      h.nbrGe3 += s.nbrGe3;
      h.selfAny += s.selfAny;
      h.selfGe3 += s.selfGe3;
    }
    console.log(line(`${which === 'all-units' ? '全单位' : '选中英雄'}/fog${tag}`, h));
  }
}

console.log('\n【合计】');
console.log(`  全单位实例计数（含两遍 fogClose ⇒ 除以 2 才是单位·时点实例）= ${unitInstances}`);
console.log(`  ⇒ 单位·时点实例 = ${unitInstances / 2}；其中"选中英雄自己" = ${heroInstances / 2}`);
console.log('  阈值 T 不由本工具设（team-lead 裁：先看数再定）。');
