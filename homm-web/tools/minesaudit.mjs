/**
 * 每城木石矿审计。
 *
 * 玩家反馈："每个城市的周围都要有木材和石头矿"。
 * 早期生成器只给 *玩家主城* 配了木/石矿，中立城（占了就能管的那几座）
 * 周围什么都没有——占了中立城等于占了个空壳，还得自己从主城运资源。
 *
 * 这个脚本对每张图、每座城（含中立城）量出最近的木矿与石矿距离，
 * 用数字回答"到底配了没有"，而不是靠肉眼看截图。
 *
 * **距离量尺必须和生成器一致**：生成器用曼哈顿距离
 * （HOME_MINE_RING 3~7 格），用切比雪夫去量会得出偏小的值，
 * 进而把"设计内"误报成"不合格"——审计尺子和被审对象要用同一把。
 *
 * 用法：SEEDS=3 node tools/minesaudit.mjs [size]
 *   不带参数则遍历 small/medium/large/huge 四档 × 全部布局。
 */
import { distDir, distUrl, printHeader } from './_dist.mjs';

/* `--dist=<dir>`（缺省 `<repo>/dist` = 旧 `../dist`，**逐字不变**）—— team-lead #164。 */
const DIST = distDir();
printHeader(DIST, 'gate=minesaudit');
const dimp = (rel) => distUrl(rel, DIST);

const { createGame } = await import(dimp('core/map/generator.js'));
const { HOME_MINE_RING } = await import(dimp('core/data/mines.js'));

const LAYOUTS = ['wild', 'ring', 'islands', 'lanes'];
const SIZES = ['small', 'medium', 'large', 'huge'];
/* ⚠️ 位置参数 = 可选尺寸；**必须跳过 `--k=v` 旗标**。
 * 起因（2026-09-21 复核实测）：`--dist=<dir>` 曾被 `process.argv[2]` 当成尺寸 ⇒
 * `size !== onlySize` 恒真 ⇒ **一局都不跑**、还打印「全部通过」⇒ 一道**假绿**的必跑门控
 * （`--dist` 一去就静默空跑；实测 PASS 行 `48 → 0`、exit 仍 0）。
 * 现在：非 `--` 的首个位置参数才是尺寸；给了未知尺寸 ⇒ **直接 exit 2**（不再静默空跑）。 */
const onlySize = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (onlySize && !SIZES.includes(onlySize)) {
  console.error(`✗ 未知尺寸「${onlySize}」—— 可选：${SIZES.join(' / ')}（旗标请写成 --k=v）`);
  process.exit(2);
}
const seeds = Number(process.env.SEEDS ?? 3);

let fails = 0;
let checked = 0;
let fallbackUsed = 0;
let worstWood = 0;
let worstOre = 0;
let rows = 0;

/** 地图上的木矿 / 石矿 */
function minesByResource(state) {
  const out = { wood: [], ore: [] };
  for (const o of Object.values(state.map.objects)) {
    if (o.kind !== 'mine') continue;
    const r = o.payload?.resource;
    if (r === 'wood' || r === 'ore') out[r].push(o);
  }
  return out;
}

const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

for (const size of SIZES) {
  if (onlySize && size !== onlySize) continue;
  for (const layout of LAYOUTS) {
    for (let s = 0; s < seeds; s++) {
      const seed = 7000 + s * 131;
      const state = createGame({ seed, layout, size, opponents: 3 });
      const mines = minesByResource(state);
      const towns = Object.values(state.towns);

      const perTown = [];
      for (const t of towns) {
        const nearest = (list) => {
          let best = Infinity;
          for (const o of list) best = Math.min(best, manhattan(o.pos, t.pos));
          return best;
        };
        const w = nearest(mines.wood);
        const o = nearest(mines.ore);
        perTown.push({ id: t.id, owner: t.owner, w, o });
        checked++;
        if (Number.isFinite(w)) worstWood = Math.max(worstWood, w);
        if (Number.isFinite(o)) worstOre = Math.max(worstOre, o);

        // 三档判定：
        //   3~7                      → 保底环带内（设计目标）
        //   8~12                     → 走了"外退一档"兜底，能接受但要记账
        //   <3 / >12 / 根本没有矿     → 不合格
        const band = [w, o].filter(
          (d) => d > HOME_MINE_RING.max && d <= HOME_MINE_RING.max + 5,
        ).length;
        fallbackUsed += band;
        const bad =
          !Number.isFinite(w) ||
          !Number.isFinite(o) ||
          w > HOME_MINE_RING.max + 5 ||
          o > HOME_MINE_RING.max + 5;
        if (bad) {
          fails++;
          console.log(
            `FAIL  ${size}/${layout} seed=${seed} ${t.id}(${t.owner}) 木=${fmt(w)} 石=${fmt(o)}`,
          );
        }
      }
      rows++;
      const neutral = perTown.filter((p) => p.owner === 'neutral').length;
      const wMax = Math.max(...perTown.map((p) => p.w));
      const oMax = Math.max(...perTown.map((p) => p.o));
      console.log(
        `PASS  ${pad(size, 6)}/${pad(layout, 8)} seed=${pad(seed, 5)} ` +
          `城 ${perTown.length}(中立 ${neutral})  最远木矿 ${wMax} 格 / 石矿 ${oMax} 格`,
      );
    }
  }
}

function fmt(v) {
  return Number.isFinite(v) ? String(v) : '∞';
}
function pad(s, n) {
  s = String(s);
  return s + ' '.repeat(Math.max(0, n - s.length));
}

console.log(
  `\n共 ${rows} 张图 / ${checked} 座城；全图最远木矿 ${worstWood} 格、石矿 ${worstOre} 格。`,
);
console.log(`保底环带 HOME_MINE_RING = ${HOME_MINE_RING.min}~${HOME_MINE_RING.max} 格（曼哈顿）`);
console.log(
  `其中 ${fallbackUsed} 处矿场落在环带之外（生成器"外退一档"兜底），仍在 ${HOME_MINE_RING.max + 5} 格内。`,
);
console.log(
  fails === 0
    ? `全部通过：每座城（含中立城）的木矿与石矿都在 ${HOME_MINE_RING.max} 格内`
    : `${fails} 座城的木/石矿超出 ${HOME_MINE_RING.max} 格`,
);
process.exit(fails === 0 ? 0 : 1);
