#!/usr/bin/env node
/**
 * 兵种**体形档**验收门（§15.2 R1/R2/R5 · S3a/S3b/S3c）
 * ==========================================================================
 * 用法：
 *   npm run build && npm run audit:bodyplan
 *   node tools/bodyplanaudit.mjs --png <dir>   额外导出 ×8 放大 PNG（肉眼复核用）
 *   node tools/bodyplanaudit.mjs --dist=<dir>  指向隔离构建
 *
 * 为什么要有这道门（而不是继续用 `b0audit` 的 H1/H2/S1）：
 *   那三条量的是 asset-spec §5.6.2 的 **T1→T5 体量阶梯**（62/70/78/88/100%），
 *   它假设「T3 一定比 T4 高」。§15.2 的新体形档**明确推翻**了这条：
 *   p1 的 T3 鹰（h=1.22）必须比 T4 骑士（h=1.04）高，因为骑士占的是**宽体**
 *   档（宽度换高度）。两套尺子量同一批帧只会互相判红，所以分 regime：
 *     · `BODY_PLAN` 收录的兵 ⇒ 本门（R1/R2/R5）；
 *     · 未收录的兵 ⇒ `b0audit` 的 H1/H2/S1 原样不动。
 *   `b0audit` 有一条覆盖断言，保证两套 regime **恰好**覆盖全部兵种、不重不漏。
 *
 * 判什么：
 *   [0] 覆盖 —— 已重画的族 × 5 个兵，`cu_*` / `cu_*_atk` / `u_*_map` 三帧都建得出、
 *               非空、尺寸符合槽位；且 `FRAME_ALIAS` 里**没有**该族残留别名
 *               （别名还在就说明「看的还是旧图」，本轮等于没做）。
 *   [1] R1 五档独占 —— 同族 5 个兵（成品 cu 帧的剪影）落在 5 个**不同**档，
 *               且与 `BODY_PLAN` 声明的档一致。量的是成品帧，不是声明。
 *   [2] R2 两两 ≥18% —— 同族 10 对，外接框**至少一维**相对差 ≥18%。
 *   [3] R5 兵牌 —— 43×37 立绘**不歪曲体型**：族内宽窄次序不翻转、单兵漂移 ≤35%。
 *        （2026-11-06 立绘改成直画后换的尺子，理由写在 [3] 上方。）
 *   [4] 22×30 可辨 —— 盲测尺寸下两两剪影 XOR ≥15%（相对较小的一方面积）。
 *               这是「5 秒指认」里**能机检的那一半**；五人盲测仍是人工项。
 *   [5] 鹰不展翼 —— 鹰必须是高档（h ≥1.18）且 w/h <1.35（不许落进宽体/巨物）。
 *               §16.1：平展双翼会让鹰与天使同档，§8.4 的档位独占当场红。
 *
 * 负向对照（判据必须有分辨力，否则绿是假的）：
 *   N1 `classify()` 喂 5 组合成比例 ⇒ 必须原样读回 5 个档；喂档与档之间的空隙 ⇒ 必须 null。
 *   N2 [4] 的度量：同一个兵自比必须 0%，且换一个兵必须 > 门槛（否则是尺子瞎了）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { distDir, distUrl, printHeader, requireFile } from './_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=bodyplanaudit');
const u = (rel) => distUrl(rel, DIST);
requireFile(DIST, 'render/unitBodyPlan.js');
requireFile(DIST, 'render/unitArt.js');

const {
  BODY_PLAN,
  BODY_PLAN_FAMILIES,
  BODY_CLASS_LABEL,
  H_REF_HUGE,
  classify,
} = await import(u('render/unitBodyPlan.js'));
const { UNIT_FRAMES, buildB0Frame, buildPortraitFrame, setTierNormalizeEnabled, isTierNormalizeEnabled } = await import(u('render/unitArt.js'));
const { PixBuf } = await import(u('render/pixel.js'));
const { FRAME_ALIAS, unitCombatFrame, unitMapFrame } = await import(u('render/unitFrames.js'));
const { FACTION_UNITS } = await import(u('core/data/units.js'));
/** [r,g,b,a] → `#rrggbb`（拼盲测条时把每格贴到一张大图上用）。 */
const rgbHexOf = (p) => '#' + [p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join('');

/* PNG 编码器的缓存表：`--png` 段在本文件**前面**执行，而编码函数声明在末尾
 * （函数声明会提升，`let` 不会）⇒ 声明必须放在使用点之前，否则 TDZ。 */
let CRC_TABLE = null;

const argv = process.argv.slice(2);
const pngIdx = argv.indexOf('--png');
const pngDir = pngIdx >= 0 ? argv[pngIdx + 1] : null;
/**
 * `--fam=p2` 只导出这一族的图（落盘用；**判词永远覆盖全族**）。
 * 每落一族就 `--png production/s3b --fam=p2`，否则 p1 的 15 张会被重复
 * 复制进新族目录（两个目录各一份，改一次要同步两处）。
 */
const famArg = argv.find((a) => a.startsWith('--fam='))?.slice('--fam='.length) ?? null;

/* ---------------------------------------------------------------- 账本 */

const results = [];
let bad = 0;
function record(id, title, pass, detail) {
  results.push({ id, title, pass, detail });
  if (!pass) bad++;
  console.log(`${pass ? '[PASS]' : '[FAIL]'} [${id}] ${title} — ${detail}`);
}

/* ---------------------------------------------------------------- 工具 */

/** 剪影外接框（alpha > 8）。 */
function bbox(pb) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < pb.h; y++) {
    for (let x = 0; x < pb.w; x++) {
      if (pb.px(x, y)[3] <= 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < x0 ? null : { w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 剪影掩码（按 [4] 的口径：只判「有没有墨」，不判颜色）。 */
function mask(pb) {
  const m = new Uint8Array(pb.w * pb.h);
  let ink = 0;
  for (let y = 0; y < pb.h; y++) {
    for (let x = 0; x < pb.w; x++) {
      if (pb.px(x, y)[3] <= 8) continue;
      m[y * pb.w + x] = 1;
      ink++;
    }
  }
  return { m, w: pb.w, h: pb.h, ink };
}

/** 两张同尺寸掩码的「不相交比例」= XOR ÷ 较小一方面积。 */
function maskDiff(a, b) {
  if (a.w !== b.w || a.h !== b.h) return 1;
  let xor = 0;
  for (let i = 0; i < a.m.length; i++) if (a.m[i] !== b.m[i]) xor++;
  return xor / Math.max(1, Math.min(a.ink, b.ink));
}

/* ---------------------------------------------------------------- 装配 */

/** 已重画的族 → 该族 5 个兵（顺序 = tier 1..5，从 FACTION_UNITS 取，不许手写）。 */
const fams = [...BODY_PLAN_FAMILIES].map((fam) => ({ fam, ids: [...new Set(FACTION_UNITS[fam] ?? [])] }));
// `canFly` 是单位数据里的字段，不是剪影的属性 —— 从 units 表读（见 classify 的注释）。
const { UNITS } = await import(u('core/data/units.js'));
const canFlyOf = (id) => !!(UNITS?.[id]?.canFly ?? UNITS?.[id]?.type?.canFly);

/* ---------------------------------------------------------------- [0] 覆盖 */

{
  const problems = [];
  let n = 0;
  const specs = new Map(UNIT_FRAMES.map((s) => [s.name, s]));
  for (const { fam, ids } of fams) {
    if (ids.length !== 5) problems.push(`${fam} 只有 ${ids.length} 个兵（应 5）`);
    for (const id of ids) {
      const plan = BODY_PLAN[id];
      if (!plan) {
        problems.push(`${id} 没有体形档声明`);
        continue;
      }
      if (FRAME_ALIAS[id]) problems.push(`${id} 还挂着别名 → ${FRAME_ALIAS[id]}（看的是旧图）`);
      // 三张**注册帧**：cu 待机 / cu 攻击 / map。兵牌 `pt_*` 不是注册帧 ——
      // 它是烘焙期从 `cu_*` 缩出来的派生帧（`buildPortraitFrame`），所以不能拿
      // UNIT_FRAMES 查它，只能现建一张、查尺寸与非空。
      const combat = unitCombatFrame(id);
      for (const name of [combat, `${combat}_atk`, unitMapFrame(id)]) {
        const spec = specs.get(name);
        if (!spec) {
          problems.push(`${fam}/${id} 缺帧 ${name}`);
          continue;
        }
        const pb = buildB0Frame(name);
        if (!bbox(pb)) problems.push(`${fam}/${id} 帧 ${name} 是空的`);
        else n++;
      }
      const pt = buildPortraitFrame(combat);
      if (pt.w !== 43 || pt.h !== 37) problems.push(`${fam}/${id} 兵牌尺寸 ${pt.w}×${pt.h} ≠ 43×37`);
      if (!bbox(pt)) problems.push(`${fam}/${id} 兵牌是空的`);
    }
  }
  record(
    '0',
    '覆盖：已重画族的 5 兵 × 3 注册帧 + 兵牌都建得出、非空、别名已撤',
    problems.length === 0 && n > 0,
    problems.length ? problems.join(' · ') : `${fams.length} 族 · ${n} 帧有墨 · 兵牌 43×37`,
  );
}

/* ------------------------------------------------ [0b] 两套 regime 不重不漏 */

{
  // 这是 `b0audit` 的 H1/H2/S1 把 `BODY_PLAN` 兵种排除之后的**另一半**：
  // 那道门只管「除了体形档以外的兵还守不守 tier 阶梯」，它无法判断
  // 「有没有哪个兵被两边同时漏掉」。覆盖关系在这里闭合：
  //   · `BODY_PLAN` 里每个 id 都必须属于某族的兵种表（不能是幽灵 id）；
  //   · 它所在的那一族必须登记在 `BODY_PLAN_FAMILIES`；
  //   · 该族**全部 5 个兵**都必须在 `BODY_PLAN` 里（不许半族切换）；
  //   · 反过来，未登记的族一个兵也不许混进 `BODY_PLAN`。
  const problems = [];
  const famOf = new Map();
  for (const [fam, ids] of Object.entries(FACTION_UNITS)) {
    for (const id of ids) famOf.set(id, fam);
  }
  for (const id of Object.keys(BODY_PLAN)) {
    const fam = famOf.get(id);
    if (!fam) {
      problems.push(`${id} 不在任何族的兵种表里`);
      continue;
    }
    if (!BODY_PLAN_FAMILIES.has(fam)) problems.push(`${id} 属于未登记的族 ${fam}`);
  }
  for (const fam of BODY_PLAN_FAMILIES) {
    const ids = [...new Set(FACTION_UNITS[fam] ?? [])];
    const missing = ids.filter((id) => !BODY_PLAN[id]);
    if (missing.length) problems.push(`${fam} 只切换了 ${ids.length - missing.length}/${ids.length}：缺 ${missing.join(', ')}`);
  }
  for (const [fam, ids] of Object.entries(FACTION_UNITS)) {
    if (BODY_PLAN_FAMILIES.has(fam)) continue;
    const stray = [...new Set(ids)].filter((id) => BODY_PLAN[id]);
    if (stray.length) problems.push(`${fam} 未登记却混进了体形档：${stray.join(', ')}`);
  }
  record(
    '0b',
    '两套体量 regime 不重不漏（体形档 ⊆ 已登记族，且族内 5/5 全切）',
    problems.length === 0,
    problems.length ? problems.join(' · ') : `体形档 ${Object.keys(BODY_PLAN).length} 个兵 · 族 ${[...BODY_PLAN_FAMILIES].join(',')}`,
  );
}

/* ---------------------------------------------------------------- [1] R1 */

const measured = new Map(); // id → { w, h, cls, id }
{
  const problems = [];
  const tables = [];
  for (const { fam, ids } of fams) {
    const rows = [];
    const seen = new Map();
    for (const id of ids) {
      const pb = buildB0Frame(unitCombatFrame(id));
      const bb = bbox(pb);
      if (!bb) {
        problems.push(`${id} 空帧`);
        continue;
      }
      const href = pb.h / H_REF_HUGE;
      const wPerH = +(bb.w / href).toFixed(2);
      const hPerH = +(bb.h / href).toFixed(2);
      const cls = classify(wPerH, hPerH, canFlyOf(id));
      const want = BODY_PLAN[id].cls;
      measured.set(id, { w: bb.w, h: bb.h, wPerH, hPerH, cls });
      if (cls === null) {
        problems.push(`${id} 落进档位空隙（w/h=${wPerH}, h=${hPerH}）`);
        continue;
      }
      if (cls !== want) problems.push(`${id} 实测 ${BODY_CLASS_LABEL[cls]} ≠ 声明 ${BODY_CLASS_LABEL[want]}`);
      if (seen.has(cls)) problems.push(`${id} 与 ${seen.get(cls)} 同档（${BODY_CLASS_LABEL[cls]}）`);
      seen.set(cls, id);
      rows.push(`${id.replace(`${fam}_`, '')} ${bb.w}×${bb.h} w/h=${wPerH} h=${hPerH} → ${BODY_CLASS_LABEL[cls]}`);
    }
    if (seen.size !== ids.length) problems.push(`${fam} 只占了 ${seen.size}/5 档`);
    tables.push(`${fam}: ${rows.join(' · ')}`);
  }
  record(
    '1',
    'R1 同族五兵落在五个不同体形档（量成品帧，不读声明）',
    problems.length === 0 && measured.size > 0,
    problems.length ? problems.join(' · ') : tables.join('\n      '),
  );
}

/* ---------------------------------------------------------------- [2] R2 */

{
  const problems = [];
  const details = [];
  for (const { fam, ids } of fams) {
    let worst = { d: 2, a: '', b: '' };
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = measured.get(ids[i]);
        const b = measured.get(ids[j]);
        if (!a || !b) continue;
        const dw = Math.abs(a.wPerH - b.wPerH) / Math.max(a.wPerH, b.wPerH);
        const dh = Math.abs(a.hPerH - b.hPerH) / Math.max(a.hPerH, b.hPerH);
        const d = Math.max(dw, dh);
        if (d < worst.d) worst = { d, a: ids[i], b: ids[j] };
        if (d < 0.18) problems.push(`${ids[i]}/${ids[j]} 仅差 ${(d * 100).toFixed(0)}%`);
      }
    }
    details.push(`${fam} 最差一对 ${worst.a?.replace(`${fam}_`, '')}/${worst.b?.replace(`${fam}_`, '')} = ${(worst.d * 100).toFixed(0)}%`);
  }
  record('2', 'R2 同族两两外接框至少一维差 ≥18%', problems.length === 0 && details.length > 0, details.join(' · '));
}

/* ------------------------------------------------- [3] R5 立绘：不歪曲体型 */

/**
 * 立绘判据在 2026-11-06 **换了一次尺子**，理由必须写清楚，否则下一个人会以为是放宽：
 *
 *   旧判据：「立绘 w/h 与 cu w/h 相差 ≤15%」。那在**缩图**时代是对的 ——
 *   立绘由 cu 等比缩出来，宽高比必然相同，任何偏差都只可能是"拉伸填满"。
 *
 *   2026-11-06 主理人拍板立绘**在 43×37 上直接画**（不从 cu 缩），这条前提消失了：
 *   直画时 12px 高的矮兵身上，2×2 的眼、2px 的腿、1px 的描边都是**不可再分的整数**，
 *   它们占身高的比例天然是 cu 的 2~3 倍 ⇒ 矮兵必然胖一点（实测 +15%~+32%）。
 *   这时再量 15%，等于要求"直画但必须长得像缩图"，自相矛盾。
 *
 *   真正要守的是**没有把体型画反**：
 *     (a) 族内宽窄**次序**不翻转（宽体不许变窄、瘦高不许变宽）；只对 cu 自己
 *         分得开（相差 ≥10%）的两只要求 —— 孩童/鹰在 cu 上只差 2%，不该逼卡上分开；
 *     (b) 单兵漂移 ≤35%（超过就是真画歪了，不是像素下限）。
 *
 *   [N3] 是这条尺子的双向对照：把五张卡横向拉 2 倍必须报红，原样必须不报红。
 */
const CARD_DRIFT_MAX = 0.35;
const CARD_ORDER_MARGIN = 0.1;

/** 一条判据、两处调用（[3] 与 [N3]）—— 不复制逻辑，否则 N3 证明的不是同一把尺子。 */
function cardShapeProblems(rows) {
  const problems = [];
  for (const r of rows) {
    const err = Math.abs(r.card - r.cu) / r.cu;
    if (err > CARD_DRIFT_MAX) problems.push(`${r.id} 漂移 ${(err * 100).toFixed(0)}%`);
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const A = rows[i];
      const B = rows[j];
      const gap = Math.abs(A.cu - B.cu) / Math.max(A.cu, B.cu);
      if (gap < CARD_ORDER_MARGIN) continue;
      if ((A.cu - B.cu) * (A.card - B.card) < 0) problems.push(`${A.id}/${B.id} 宽窄次序翻转`);
    }
  }
  return problems;
}

/** 族内逐兵的 (cu w/h, card w/h)，[N3] 复用同一份读数。 */
const shapeRows = new Map();
for (const { fam, ids } of fams) {
  shapeRows.set(
    fam,
    ids.map((id) => {
      const src = bbox(buildB0Frame(unitCombatFrame(id), false));
      const pt = bbox(buildPortraitFrame(unitCombatFrame(id)));
      return { id, cu: src ? src.w / src.h : 0, card: pt ? pt.w / pt.h : 0 };
    }),
  );
}

{
  const problems = [];
  const details = [];
  for (const [fam, rows] of shapeRows) {
    if (rows.some((r) => !r.cu || !r.card)) {
      problems.push(`${fam} 立绘/源帧为空`);
      continue;
    }
    problems.push(...cardShapeProblems(rows));
    details.push(
      `${fam} ` +
        rows
          .map((r) => `${r.id.replace(`${fam}_`, '')} ${r.cu.toFixed(2)}→${r.card.toFixed(2)}(${(((r.card - r.cu) / r.cu) * 100).toFixed(0)}%)`)
          .join(' / '),
    );
  }
  record(
    '3',
    'R5 兵牌不歪曲体型：宽窄次序不翻转 + 单兵漂移 ≤35%（直画口径，见上）',
    problems.length === 0 && details.length > 0,
    problems.length ? problems.join(' · ') : details.join(' · '),
  );
}

/* ---------------------------------------------------------------- [4] 22×30 可辨 */

const small = new Map();
{
  for (const { ids } of fams) {
    for (const id of ids) small.set(id, mask(buildPortraitFrame(unitCombatFrame(id), 22, 30)));
  }
  const problems = [];
  const details = [];
  let minPair = { d: 2, a: '', b: '' };
  for (const { fam, ids } of fams) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const d = maskDiff(small.get(ids[i]), small.get(ids[j]));
        if (d < minPair.d) minPair = { d, a: ids[i], b: ids[j] };
        if (d < 0.15) problems.push(`${ids[i]}/${ids[j]} 只差 ${(d * 100).toFixed(0)}%`);
      }
    }
    details.push(`${fam} 最接近一对 ${(minPair.d * 100).toFixed(0)}%`);
  }
  record(
    '4',
    '22×30 盲测尺寸下同族两两剪影差 ≥15%',
    problems.length === 0 && small.size > 0,
    problems.length ? problems.join(' · ') : `${details.join(' · ')}（门槛 15%）`,
  );
}

/* ---------------------------------------------------------------- [5] 鹰不展翼 */

{
  const problems = [];
  const details = [];
  for (const { ids } of fams) {
    const eagle = ids.find((id) => /eagle/.test(id));
    if (!eagle) continue;
    const m = measured.get(eagle);
    if (!m) {
      problems.push(`${eagle} 无读数`);
      continue;
    }
    const wh = m.wPerH / m.hPerH;
    if (m.cls !== 'tall') problems.push(`${eagle} 档位=${m.cls}（应 tall）`);
    if (wh >= 1.35) problems.push(`${eagle} w/h=${wh.toFixed(2)} ≥1.35（展翼了）`);
    details.push(`${eagle} ${m.wPerH}×${m.hPerH} → w/h=${wh.toFixed(2)}，档=${BODY_CLASS_LABEL[m.cls]}`);
  }
  record('5', '鹰不展翼：必须是高档且 w/h <1.35（§16.1 的硬约束）', problems.length === 0 && details.length > 0, problems.length ? problems.join(' · ') : details.join(' · '));
}

/* ------------------------------------------------- [6] S4 升级形态（elite） */

/**
 * 升级形态（`*_u`）的判据。**不是**复用 [1] R1：
 *   R1 量「同族五兵各占一档」—— 升级版**本来就该和基础版同档**，
 *   把它塞进 R1 会直接判「两个兵同档」。
 *
 * ── 为什么**不**用「外接框凸起 ≥4px」当判据（原计划写的是这一条）──
 *
 * 实测三件事，说明这条在现有管线里量的是个假对象：
 *   ① `normalizeTier` 按**高度**等比缩放，再**按帧中心**居中。单侧伸出的东西
 *      会被对半分到左右：孩子王的旗让自然宽度 +50%（14→21px），落地只有左右各 3px；
 *   ② 骑士与天使**四边顶满画布**（骑士 58/64 宽、天使 56×56 全高），
 *      没有任何一侧还有 4px 余量 —— 凸起在物理上不存在；
 *   ③ 更糟的是反向：骑士第一版把枪旗往上挑 0.12h，自然身高 +3px ⇒ 归一化把整只
 *      压小 7% ⇒ **升级版比基础版还窄**（凸起 −2px）。越"加东西"越缩小。
 * 所以凸起只作为**读数**打印（含"该兵是否已顶满画布"），不参与判词。
 * 想让它成为判据，得先改归一化的居中/缩放口径 —— 那是另一把尺子，不在 S4 里动。
 *
 * ── 真正守的三条 ──
 *   (a) **自然身高不变**（归一化**前**，|Δh| ≤1px）。守「不许靠画大再让归一化压回来」
 *       与「往上加东西逼归一化砍自己」两个坑 —— 它就是上面 ③ 的回归闸。
 *   (b) **兵牌上看得出是另一件东西**：43×37（玩家真正读的尺寸）**像素差 ≥8%**
 *       （颜色或剪影任一变都算）。cu 上不能量：归一化的重采样会让"只改了一小块颜色"
 *       也算出 45% 的 XOR，尺子被噪声撑满。
 *   (c) **同档**：升级版不许自带 `BODY_PLAN` 条目（它必须读基础版那条）。
 *
 * 两条覆盖断言（与 [0b] 同一条思路，防"只做了一半"）：
 *   · `ELITE_ART_FAMILIES` 里的族，五个升级形态的 3 张帧 + 兵牌**全都要在**；
 *   · 不在 `ELITE_ART_FAMILIES` 里的族，**一张 `_u` 帧也不许登记** ——
 *     登记了却不让招募 = 占着图集骗人，放开了却缺帧 = 一招募就抛异常。
 */
const ELITE_NAT_HEIGHT_TOL = 1; // 归一化前的像素
const ELITE_CARD_DIFF_MIN = 0.08; // 43×37 上的像素差

/** 带原点的外接框（`bbox` 只给宽高）。 */
function bboxOf(pb) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < pb.h; y++) {
    for (let x = 0; x < pb.w; x++) {
      if (pb.px(x, y)[3] <= 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < x0 ? null : { x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 两张同尺寸立绘的像素差（透明对透明不算；任一不透明且 RGB 明差 >24 或 α 不同 = 差）。 */
function cardPixelDiff(a, b) {
  let diff = 0;
  let union = 0;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const p = a.px(x, y);
      const q = b.px(x, y);
      const po = p[3] > 8;
      const qo = q[3] > 8;
      if (!po && !qo) continue;
      union++;
      if (po !== qo || Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) > 24) diff++;
    }
  }
  return union ? diff / union : 0;
}

// `UNITS` 在上面（`canFlyOf` 那段）已经取过一次，这里只补两个新的。
const { ELITE_ART_FAMILIES, upgradedUnitIdOf } = await import(u('core/data/units.js'));
// `setTierNormalizeEnabled` / `isTierNormalizeEnabled` 已在文件头的解构里取过。

{
  const problems = [];
  const readings = [];
  const withUpFrames = new Set(
    UNIT_FRAMES.filter((sp) => sp.unit.endsWith('_u')).map((sp) => sp.unit.slice(0, 2)),
  );
  for (const fam of ELITE_ART_FAMILIES) {
    const ids = [...new Set(FACTION_UNITS[fam] ?? [])];
    if (ids.length !== 5) problems.push(`${fam} 只有 ${ids.length} 个兵（应 5）`);
    for (const id of ids) {
      const upId = upgradedUnitIdOf(id);
      if (!upId || !UNITS[upId]) {
        problems.push(`${fam}/${id} 没有升级形态`);
        continue;
      }
      if (UNITS[upId].upgradeOf !== id) problems.push(`${upId}.upgradeOf 不等于 ${id}`);
      if (BODY_PLAN[upId]) problems.push(`${upId} 自己声明了体形档（应读基础版那条）`);
      const combat = unitCombatFrame(upId);
      for (const name of [combat, `${combat}_atk`, unitMapFrame(upId)]) {
        if (!UNIT_FRAMES.some((sp) => sp.name === name)) {
          problems.push(`${fam}/${upId} 缺帧 ${name}`);
          continue;
        }
        if (!bbox(buildB0Frame(name))) problems.push(`${fam}/${upId} 帧 ${name} 是空的`);
      }

      // (a) 归一化**前**的自然身高
      const wasOn = isTierNormalizeEnabled();
      setTierNormalizeEnabled(false);
      const rawBase = buildB0Frame(unitCombatFrame(id));
      const rawUp = buildB0Frame(combat);
      setTierNormalizeEnabled(wasOn);
      const rb = bboxOf(rawBase);
      const ru = bboxOf(rawUp);
      if (!rb || !ru) {
        problems.push(`${upId} 归一化前是空帧`);
        continue;
      }
      const dh = Math.abs(ru.h - rb.h);
      if (dh > ELITE_NAT_HEIGHT_TOL) problems.push(`${upId} 自然身高差 ${dh}px（上限 ${ELITE_NAT_HEIGHT_TOL}）`);

      // (b) 43×37 兵牌上的像素差
      const ptBase = buildPortraitFrame(unitCombatFrame(id));
      const ptUp = buildPortraitFrame(combat);
      if (ptUp.w !== 43 || ptUp.h !== 37) problems.push(`${upId} 兵牌尺寸 ${ptUp.w}×${ptUp.h} ≠ 43×37`);
      const dPct = cardPixelDiff(ptBase, ptUp);
      if (dPct < ELITE_CARD_DIFF_MIN) {
        problems.push(`${upId} 兵牌像素差 ${(dPct * 100).toFixed(1)}% < ${ELITE_CARD_DIFF_MIN * 100}%`);
      }

      // 读数（不判）：归一化后的剪影凸起 + 是否还有画布余量
      const fin = bboxOf(buildB0Frame(combat));
      const fb = bboxOf(buildB0Frame(unitCombatFrame(id)));
      const protrusion = Math.max(fb.x0 - fin.x0, fin.x1 - fb.x1, fb.y0 - fin.y0, fin.y1 - fb.y1);
      const room = Math.min(fb.x0, fb.y0, rawBase.w, rawBase.h);
      readings.push(
        `${upId.replace(`${fam}_`, '')} 兵牌差${(dPct * 100).toFixed(1)}% · 自然高${diffSign(ru.h - rb.h)} · 凸起${protrusion}px${room < 12 ? '(顶满)' : ''}`,
      );
    }
  }
  for (const [fam, ids] of Object.entries(FACTION_UNITS)) {
    if (ELITE_ART_FAMILIES.has(fam)) continue;
    const stray = [...new Set(ids)].filter((id) => UNIT_FRAMES.some((sp) => sp.unit === `${id}_u`));
    if (stray.length) problems.push(`${fam} 未开放升级却有 ${stray.length} 个 _u 帧`);
  }
  record(
    '6',
    `S4 升级形态：五兵齐全、自然身高不变(±${ELITE_NAT_HEIGHT_TOL}px)、兵牌像素差 ≥${ELITE_CARD_DIFF_MIN * 100}%`,
    problems.length === 0 && readings.length > 0,
    problems.length ? problems.join(' · ') : readings.join(' · '),
  );
}

function diffSign(v) {
  return v > 0 ? `+${v}` : `${v}`;
}

/* ---------------------------------------------------------------- 负向对照 *//* ---------------------------------------------------------------- 负向对照 */

{
  // N1：阶判据本身有分辨力 —— 五组合成比例必须原样读回五个档
  const cases = [
    [[0.4, 0.6], 'short'],
    [[0.7, 0.9], 'mid'],
    [[0.6, 1.2], 'tall'],
    [[1.4, 1.05], 'wide'],
    [[1.0, 1.5], 'huge'],
  ];
  const got = cases.map(([[w, h], want]) => {
    const c = classify(w, h, false);
    return c === want ? want : `✗${c}(want ${want})`;
  });
  const gap = classify(0.9, 1.1, false); // 1.00~1.18 的空隙 + 不够宽 ⇒ 必须 null
  record(
    'N1',
    '档位判据有分辨力：5 组合成比例读回 5 档、空隙读回 null',
    got.every((g) => !String(g).startsWith('✗')) && gap === null,
    `${got.join(' / ')}；空隙 → ${gap === null ? 'null' : gap}`,
  );
}

{
  // N2：[4] 的度量必须能分开「同一个兵」与「不同兵」
  const some = [...small.keys()];
  const same = maskDiff(small.get(some[0]), small.get(some[0]));
  let cross = 0;
  for (const [a, b] of some.map((id) => [id, some[(some.indexOf(id) + 1) % some.length]])) {
    if (a !== b) cross = Math.max(cross, maskDiff(small.get(a), small.get(b)));
  }
  record(
    'N2',
    '[4] 的度量有分辨力：自比 0%，跨兵 >15%',
    same === 0 && cross > 0.15,
    `自比 ${(same * 100).toFixed(1)}% · 跨兵最大 ${(cross * 100).toFixed(0)}%`,
  );
}

{
  // N3：[3] 的尺子双向都有分辨力 —— 原样不报红、横向拉 2 倍必须报红。
  //
  // ⚠️ **必须逐族算**，不能把四族拍平成一个池子：`cardShapeProblems` 的第二段是
  //    「族内宽窄次序不翻转」，拍平之后 `zombie` 会和 `knight` 比宽窄 —— 跨族本来
  //    就不该有次序约束（体形档不同族各自独占，宽窄没有可比性）。S3d 加进 p4 后
  //    这条正好翻红 1 条（原样 1 条），暴露的是**尺子的作用域错了**，不是画错了。
  let okCount = 0;
  let badCount = 0;
  for (const rows of shapeRows.values()) {
    okCount += cardShapeProblems(rows).length;
    badCount += cardShapeProblems(rows.map((r) => ({ ...r, card: r.card * 2 }))).length;
  }
  record(
    'N3',
    '[3] 有分辨力：原样 0 条、横向拉 2 倍必须报红（逐族算，不跨族比宽窄）',
    okCount === 0 && badCount > 0,
    `原样 ${okCount} 条 · 拉宽 ${badCount} 条`,
  );
}

{
  // N4：[6] 的尺子（43×37 像素差）必须有分辨力。
  //   · 自比 0%；
  //   · 只改 1 个像素的"假升级"必须**低于**门槛（否则一个点就能冒充升级版）；
  //   · 真升级必须过门槛；
  //   · 换成另一个兵必须远高于门槛（说明这把尺子量的是"差异"，不是恒真的常数）。
  const a = buildPortraitFrame(unitCombatFrame('p1_child'));
  const real = buildPortraitFrame(unitCombatFrame('p1_child_u'));
  const fake = new PixBuf(a.w, a.h);
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const p = a.px(x, y);
    if (p[3] > 8) fake.set(x, y, rgbHexOf(p));
  }
  fake.set(20, 20, '#ff00ff'); // 一处像素（不合色板，仅作对照；不进图集）
  const selfD = cardPixelDiff(a, a);
  const fakeD = cardPixelDiff(a, fake);
  const realD = cardPixelDiff(a, real);
  const crossD = cardPixelDiff(a, buildPortraitFrame(unitCombatFrame('p1_crossbow')));
  record(
    'N4',
    '[6] 的尺子有分辨力：自比 0%、改 1 像素不过门槛、真升级过门槛、跨兵远高于门槛',
    selfD === 0 && fakeD < ELITE_CARD_DIFF_MIN && realD >= ELITE_CARD_DIFF_MIN && crossD > 0.3,
    `自比 ${(selfD * 100).toFixed(1)}% · 改1像素 ${(fakeD * 100).toFixed(1)}% · 真升级 ${(realD * 100).toFixed(1)}% · 跨兵 ${(crossD * 100).toFixed(1)}%`,
  );
}

/* ---------------------------------------------------------------- PNG */

if (pngDir) {
  mkdirSync(pngDir, { recursive: true });
  let n = 0;
  // `--fam=` 只裁**落盘**范围，不影响上面任何判词（判词始终覆盖 `BODY_PLAN_FAMILIES`）。
  const pngFams = famArg ? fams.filter((f) => f.fam === famArg) : fams;
  if (famArg && !pngFams.length) {
    console.error(`--fam=${famArg} 不在 BODY_PLAN_FAMILIES 里（${[...BODY_PLAN_FAMILIES].join(',')}）`);
    process.exit(2);
  }
  for (const { ids } of pngFams) {
    for (const id of ids) {
      const pb = buildB0Frame(unitCombatFrame(id));
      writeFileSync(join(pngDir, `cu_${id}.png`), encodePng(upscale(pb, 8)));
      const pt = buildPortraitFrame(unitCombatFrame(id));
      writeFileSync(join(pngDir, `pt_${id}.png`), encodePng(upscale(pt, 8)));
      // 22×30 = 兵牌上真正的显示尺寸（§7.1 盲测口径）。单独导出 ×8，
      // 因为「22px 下指认哪张更强」只能在**这个尺寸**上做 —— 拿 cu 或 43×37 做盲测是另一种题。
      const s22 = buildPortraitFrame(unitCombatFrame(id), 22, 30);
      writeFileSync(join(pngDir, `s22_${id}.png`), encodePng(upscale(s22, 8)));
      n += 3;
    }
  }
  // ⚠️ 盲测条**已从本工具移除**（2026-11-06）。原来这里用 ×8 放大 + 固定顺序出
  // `blind-22x30-*.png`，两个毛病都是致命的：
  //   · ×8 把 22px 的图铺到 176px 高，**面积 64 倍** —— 拿它当"22px 可辨"的判据，
  //     测的根本不是 22px（连"分得出来"这个结论都不可信）；
  //   · 顺序就是对照表的顺序 ⇒ 看过表的人靠"第几张"就能答对。
  // 现在盲测材料统一由 `tools/blindkit.mjs` 生成（每人独立乱序 / ×2 真机尺寸 /
  // 答案钥单独落盘 / 附执行手册）。本工具的 `--png` 只负责**看细节**的放大图。
  console.log(`\nPNG 已导出 → ${pngDir}（${n} 张：cu ×8 / pt ×8 / 22×30 ×8）`);
  console.log(`盲测材料请用：node tools/blindkit.mjs --out=<dir> --fam=${famArg ?? 'p1'}（手册 PROTOCOL.md）`);
}

/* ---------------------------------------------------------------- 汇总 */

/* 结论里的族名**从 `BODY_PLAN_FAMILIES` 现算**，不写死 —— 否则每落一族
 * 这句就会像 S3c 之前那样停在上一轮（S3c 时代码已经覆盖 p3，判词还写
 * 「S3a p1 + S3b p2」，读者无法从输出判断 p3 到底有没有被量）。 */
const STAGE_OF = { p1: 'S3a', p2: 'S3b', p3: 'S3c', p4: 'S3d' };
const famNames = fams.map((f) => f.fam);
// S4 的升级形态是**另一条轴**（不是第五个族），单独追加，不混进 BODY_PLAN_FAMILIES 的族名里。
const famText =
  famNames.map((f) => `${STAGE_OF[f] ?? f} ${f}`).join(' + ') +
  (ELITE_ART_FAMILIES.size ? ` + S4 升级形态 ${[...ELITE_ART_FAMILIES].join(',')}` : '');
const lastFam = famNames[famNames.length - 1];
const lastStage = (STAGE_OF[lastFam] ?? '').toLowerCase();
console.log('\n' + '='.repeat(72));
console.log(`汇总：${results.map((r) => `[${r.id}] ${r.pass ? 'PASS' : 'FAIL'}`).join('  ')}`);
console.log(bad === 0 ? `结论：体形档自动部分全过（${famText}）` : `结论：${bad} 项不合格 —— 不要提交`);
console.log('人工项：五人盲测（§8.4：同族 5 张并排、每人每张 3 秒、指认正确率 ≥80%）');
console.log(
  `        材料与计分表：node tools/blindkit.mjs --out=<dir> --fam=${lastFam}（手册 production/${lastStage}/blind/PROTOCOL.md）`,
);
console.log('='.repeat(72));
process.exit(bad === 0 ? 0 : 1);

/* ---------------------------------------------------------------- PNG 编码 */

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  CRC_TABLE = t;
  return t;
}
function crc32(buf) {
  const T = crcTable();
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, c]);
}
function encodePng({ w, h, data }) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[o++] = data[i];
      raw[o++] = data[i + 1];
      raw[o++] = data[i + 2];
      raw[o++] = data[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function upscale(pb, k) {
  const w = pb.w * k;
  const h = pb.h * k;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = pb.px(Math.floor(x / k), Math.floor(y / k));
      const i = (y * w + x) * 4;
      data[i] = s[0];
      data[i + 1] = s[1];
      data[i + 2] = s[2];
      data[i + 3] = s[3];
    }
  }
  return { w, h, data };
}
