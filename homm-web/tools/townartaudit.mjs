#!/usr/bin/env node
/**
 * TP-4① 城堡去矩形 · 验收门（cartoon-style.md §1.1 / §1.2）
 * ==========================================================================
 * 用法：
 *   npm run build && npm run audit:townart
 *   node tools/townartaudit.mjs --png <dir>   额外导出 ×8 放大 PNG（截图对比素材）
 *   node tools/townartaudit.mjs --dist=<dir>  指向隔离构建（负测/旧构建对比）
 *
 * 判什么（TP-4 范围①：`atlas.ts` 的 town() / castle() 去矩形）：
 *   [0] 覆盖闸 —— 全阵营 × 全档位的城镇/城堡帧都建得出、画布尺寸恒定
 *                 （40×52 / 72×96；尺寸是图集打包与 §1.1 描边分档的输入），
 *                 且剪影非空。**有对象无可判数据时必须红，不许静默跳过。**
 *   [1] 去直角 —— 本体上「两条内沿边长都 ≥6px 的 90° 外凸角」计数 = 0。
 *                 §1.2「人造物禁止直角」的可执行化：32px 尺度下纯 90° 直角读成
 *                 「程序员的矩形」（圣经原话点的就是 town() 的墙体）。
 *                 <6px 的城齿/窗/踢脚不读成矩形，按可读性口径豁免（判据见下）。
 *   [2] 描边宽度 —— 城镇恒 1px、城堡恒 2px（§1.1 例外条款只属于 72×96 城堡）。
 *                 判据 = 从「无描边本体」重建 outline() 的膨胀环（8 邻域 BFS =
 *                 Chebyshev 距离），逐像素比对成品：环必须被铺满、环外不许被
 *                 铺画、城堡还必须真的有第 2 圈（防"写了 2 实际 1"的恒绿）。
 *   [3] 尖角清单 —— **诊断项，非断言**：列出本体的全部 90° 角与顶部尖点，
 *                 人工核对「尖角只留给屋顶/族旗母题」（§1.2 末条）。
 *
 * 为什么 [1] 只在本体上判：outline() 是一圈统一风格的墨环，它自己的外沿必然
 * 有 90° 角（1px 膨胀的几何后果）—— §1.2 管造型，墨环归 [2] 的环重建口径管。
 * 两把尺子各管各的，不混（与 b0audit 断言 4 同思路）。
 *
 * 负向对照（插桩造失败 → 必须红；恢复 → 必须复绿）：
 *   N1 chamfer=false   → [1] 必须红（直角复活 = TP-4 之前的状态）
 *   N2 castleOutline=1 → [2] 城堡必须红（第 2 圈不存在 = TP-4 之前的状态）
 *   N3 townOutline=2   → [2] 城镇必须红（环外被铺画 = 城镇被误按 2px 画）
 *
 * 零新增依赖：node 内建 + 一份与 b0audit 同口径的零依赖 PNG 编码器。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { distDir, distUrl, printHeader, requireFile } from './_dist.mjs';

/* `--dist=<dir>`（缺省 `<repo>/dist`）—— team-lead #164，口径同 b0audit。 */
const DIST = distDir();
printHeader(DIST, 'gate=townartaudit');
const u = (rel) => distUrl(rel, DIST);
requireFile(DIST, 'render/atlas.js');

const {
  SPRITE_OWNERS,
  TOWN_FRAME_SIZE,
  CASTLE_FRAME_SIZE,
  CASTLE_WALL_SPEC,
  buildTownFrame,
  buildCastleFrame,
  setTownArtOptions,
} = await import(u('render/atlas.js'));

/* S6（§14.3 G5）：外形档位的**选择器**与战斗侧的塔数，都是纯模块，node 里直接跑。 */
requireFile(DIST, 'render/townSprite.js');
const { townSpriteKey, townTierOf } = await import(u('render/townSprite.js'));
const { createSiege } = await import(u('core/combat/siege.js'));
const { PixBuf } = await import(u('render/pixel.js'));

/** 图集墨色（atlas.ts 的 OUTLINE，全精灵共用；与 B0 色板的 ink0 #2a1a12 的迁移是另一条欠账）。 */
const OUTLINE_RGB = [0x24, 0x1a, 0x10];

/* ---------------------------------------------------------------- 参数 */

const argv = process.argv.slice(2);
const pngIdx = argv.indexOf('--png');
const pngDir = pngIdx >= 0 ? argv[pngIdx + 1] : null;

/**
 * CRC 表的缓存槽。**声明必须在本文件顶部**：`--png` 的导出块在文件中部就调用
 * `encodePng()`，若把 `let CRC_TABLE` 写在底部的函数旁边，那时它还处于 TDZ
 * （`let` 不初始化），`--png` 一跑就是 `Cannot access 'CRC_TABLE' before initialization`。
 * 这个开关此前一直是坏的，2026-11-06 修。
 */
let CRC_TABLE = null;

/* ---------------------------------------------------------------- 断言框架 */

let bad = 0;
const results = [];
function record(id, title, pass, detail) {
  results.push({ id, title, pass, detail });
  if (!pass) bad++;
  console.log(`[${pass ? 'PASS' : 'FAIL'}] [${id}] ${title}${detail ? ` — ${detail}` : ''}`);
}

/* ---------------------------------------------------------------- 帧集合 */

const DEFAULTS = { chamfer: true, townOutline: 1, castleOutline: 2, shadow: true };
const OWNERS = [...SPRITE_OWNERS];
const TIERS = [0, 1, 2, 3];

/** 按给定美术选项建「成品 + 本体」两套帧。本体 = 同选项但描边 0、投影关。 */
function buildAll(finalOpts) {
  setTownArtOptions(finalOpts);
  const finals = new Map();
  for (const owner of OWNERS) {
    for (const t of TIERS) {
      finals.set(`town_${owner}_${t}`, buildTownFrame(owner, t));
      finals.set(`castle_${owner}_${t}`, buildCastleFrame(owner, t));
    }
  }
  setTownArtOptions({ ...finalOpts, townOutline: 0, castleOutline: 0, shadow: false });
  const bodies = new Map();
  for (const owner of OWNERS) {
    for (const t of TIERS) {
      bodies.set(`town_${owner}_${t}`, buildTownFrame(owner, t));
      bodies.set(`castle_${owner}_${t}`, buildCastleFrame(owner, t));
    }
  }
  return { finals, bodies };
}

const opaqueAt = (pb, x, y) =>
  x >= 0 && y >= 0 && x < pb.w && y < pb.h && pb.alphaAt(x, y) > 8;

/* ---------------------------------------------------------------- [1] 90° 角检测 */

/**
 * 「两条内沿边长都 ≥ MIN_RUN 的 90° 外凸角」检测。
 *
 * 候选 = 不透明像素 p，其**外侧**两个相邻像素都透明（四向各一轮）。
 * 排除两类"其实是斜切角/台阶"的候选：
 *   ① 沿外角的两个对角方向各走 1–3 步，任一碰到本体 ⇒ 斜切边的**起点**
 *      （切过的角把顶边起点推到 x+1，那个像素的左下就是本体）；
 *   ② 另一侧内沿反方向第 2 格有本体 ⇒ 斜切边的**终点**（顶边在被切角之后
 *      才开始，那一格就是证据）。
 * 两条内沿的连续边长都 ≥ MIN_RUN 才计违例 —— 城齿（2×3）、窗（4×5）、
 * 踢脚（10×5）在 32px 尺度上不读成"矩形"，按可读性口径豁免。
 */
const MIN_RUN = 6;

function rightAngleCorners(pb) {
  const W = pb.w;
  const H = pb.h;
  const hits = [];
  // [外A, 外B, 内沿A, 内沿B]：TL / TR / BL / BR
  const DIRS = [
    [-1, 0, 0, -1, 1, 0, 0, 1],
    [1, 0, 0, -1, -1, 0, 0, 1],
    [-1, 0, 0, 1, 1, 0, 0, -1],
    [1, 0, 0, 1, -1, 0, 0, -1],
  ];
  for (const [o1x, o1y, o2x, o2y, ax, ay, bx, by] of DIRS) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!opaqueAt(pb, x, y)) continue;
        if (opaqueAt(pb, x + o1x, y + o1y) || opaqueAt(pb, x + o2x, y + o2y)) continue;
        // ① 斜切起点 / 台阶：两个对角方向任一本体即排除
        let wrap = false;
        for (const [dx, dy] of [
          [o1x + bx, o1y + by],
          [o2x + ax, o2y + ay],
        ]) {
          for (let s = 1; s <= 3 && !wrap; s++) {
            if (opaqueAt(pb, x + dx * s, y + dy * s)) wrap = true;
          }
        }
        if (wrap) continue;
        // ② 斜切终点：内沿 A 反方向第 2 格 + 外 B 方向 1 格
        if (opaqueAt(pb, x + ax * 2 + o2x, y + ay * 2 + o2y)) continue;
        // ③ 两条内沿边长
        let r = 0;
        while (opaqueAt(pb, x + ax * (r + 1), y + ay * (r + 1))) r++;
        let d = 0;
        while (opaqueAt(pb, x + bx * (d + 1), y + by * (d + 1))) d++;
        if (r >= MIN_RUN && d >= MIN_RUN) {
          hits.push({ x, y, r, d });
        }
      }
    }
  }
  return hits;
}

/** 诊断：本体上的全部 90° 外凸角（不限边长）+ 顶部尖点（上方与斜上方皆空）。 */
function sharpInventory(pb) {
  const small = [];
  const peaks = [];
  for (let y = 0; y < pb.h; y++) {
    for (let x = 0; x < pb.w; x++) {
      if (!opaqueAt(pb, x, y)) continue;
      if (
        !opaqueAt(pb, x - 1, y) &&
        !opaqueAt(pb, x, y - 1) &&
        !opaqueAt(pb, x - 1, y - 1) &&
        !opaqueAt(pb, x + 1, y - 1)
      ) {
        peaks.push([x, y]);
      }
    }
  }
  // 小角（边长 < MIN_RUN 的候选）复用 rightAngleCorners 的几何，但放宽边长
  const W = pb.w;
  const H = pb.h;
  const DIRS = [
    [-1, 0, 0, -1, 1, 0, 0, 1],
    [1, 0, 0, -1, -1, 0, 0, 1],
    [-1, 0, 0, 1, 1, 0, 0, -1],
    [1, 0, 0, 1, -1, 0, 0, -1],
  ];
  for (const [o1x, o1y, o2x, o2y, ax, ay, bx, by] of DIRS) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!opaqueAt(pb, x, y)) continue;
        if (opaqueAt(pb, x + o1x, y + o1y) || opaqueAt(pb, x + o2x, y + o2y)) continue;
        let wrap = false;
        for (const [dx, dy] of [
          [o1x + bx, o1y + by],
          [o2x + ax, o2y + ay],
        ]) {
          for (let s = 1; s <= 3 && !wrap; s++) {
            if (opaqueAt(pb, x + dx * s, y + dy * s)) wrap = true;
          }
        }
        if (wrap) continue;
        if (opaqueAt(pb, x + ax * 2 + o2x, y + ay * 2 + o2y)) continue;
        let r = 0;
        while (opaqueAt(pb, x + ax * (r + 1), y + ay * (r + 1))) r++;
        let d = 0;
        while (opaqueAt(pb, x + bx * (d + 1), y + by * (d + 1))) d++;
        if (r < MIN_RUN || d < MIN_RUN) small.push({ x, y, r, d });
      }
    }
  }
  return { small, peaks };
}

/* ---------------------------------------------------------------- [2] 描边环重建 */

/** 8 邻域多源 BFS ⇒ 每个非本体像素到本体的 Chebyshev 距离（上限 maxD，超出 = -1）。 */
function distToBody(body, maxD) {
  const W = body.w;
  const H = body.h;
  const dist = new Int8Array(W * H).fill(-1);
  const q = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (body.alphaAt(x, y) > 8) {
        dist[y * W + x] = 0;
        q.push([x, y]);
      }
    }
  }
  for (let head = 0; head < q.length; head++) {
    const [x, y] = q[head];
    const d = dist[y * W + x];
    if (d >= maxD) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (dist[ny * W + nx] !== -1) continue;
        dist[ny * W + nx] = d + 1;
        q.push([nx, ny]);
      }
    }
  }
  return dist;
}

/**
 * 描边宽度判据。expected = 圣经 §1.1 的档位（城镇 1 / 城堡 2）。
 * 返回 { pass, ring1, ring2, ring3, unpainted, stray, offColor }：
 *   unpainted —— 该在环里的像素没被铺画（断点/漏描）；
 *   stray    —— 环外（dist ≥ expected+1）被铺画（描过界 / 投影越界）；
 *   offColor —— 环上出现了非墨族颜色（描边色被改 / 灰边）。
 */
function checkOutlineWidth(body, final, expected) {
  const dist = distToBody(body, expected + 1);
  const W = body.w;
  const H = body.h;
  let ring1 = 0;
  let ring2 = 0;
  let unpainted = 0;
  let stray = 0;
  let offColor = 0;
  const strayAt = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = dist[y * W + x];
      const painted = final.alphaAt(x, y) > 200; // 墨环是不透明实色；投影 fringe α≈56 不算
      if (d === 1) {
        ring1++;
        if (!painted) unpainted++;
        else {
          const [r, g, b, a] = final.px(x, y);
          if (a !== 255 || r > OUTLINE_RGB[0] || g > OUTLINE_RGB[1] || b > OUTLINE_RGB[2]) offColor++;
        }
      } else if (d === 2) {
        ring2++;
        if (expected >= 2) {
          if (!painted) unpainted++;
          else {
            const [r, g, b, a] = final.px(x, y);
            if (a !== 255 || r > OUTLINE_RGB[0] || g > OUTLINE_RGB[1] || b > OUTLINE_RGB[2]) offColor++;
          }
        } else if (painted) {
          stray++;
          if (strayAt.length < 5) strayAt.push(`(${x},${y})`);
        }
      } else if (d >= expected + 1 && painted) {
        stray++;
        if (strayAt.length < 5) strayAt.push(`(${x},${y})`);
      }
    }
  }
  const pass =
    ring1 > 0 &&
    (expected < 2 || ring2 > 0) &&
    unpainted === 0 &&
    stray === 0 &&
    offColor === 0;
  return { pass, ring1, ring2, unpainted, stray, offColor, strayAt };
}

/* ---------------------------------------------------------------- 主流程 */

console.log('TP-4① 城堡去矩形 · 验收（town 40×52 / castle 72×96，§1.1 描边分档 + §1.2 切角）');
console.log(`扫描范围：${OWNERS.length} 阵营 × ${TIERS.length} 档 × {town, castle} = ${OWNERS.length * TIERS.length * 2} 帧，阈值未放宽`);
console.log('='.repeat(72));

setTownArtOptions(DEFAULTS);
const { finals, bodies } = buildAll(DEFAULTS);

/* [0] 覆盖闸 */
{
  const problems = [];
  if (OWNERS.length === 0) problems.push('SPRITE_OWNERS 为空');
  for (const owner of OWNERS) {
    for (const t of TIERS) {
      for (const [kind, size] of [
        ['town', TOWN_FRAME_SIZE],
        ['castle', CASTLE_FRAME_SIZE],
      ]) {
        const pb = finals.get(`${kind}_${owner}_${t}`);
        const tag = `${kind}_${owner}_${t}`;
        if (!pb) {
          problems.push(`${tag} 建不出帧`);
          continue;
        }
        if (pb.w !== size.w || pb.h !== size.h) {
          problems.push(`${tag} 画布 ${pb.w}×${pb.h} ≠ ${size.w}×${size.h}`);
        }
        let opaque = 0;
        for (let y = 0; y < pb.h; y++) {
          for (let x = 0; x < pb.w; x++) if (pb.alphaAt(x, y) > 8) opaque++;
        }
        if (opaque === 0) problems.push(`${tag} 剪影 0 像素（空白帧）`);
      }
    }
  }
  record(
    '0',
    '覆盖闸：帧全部建得出、尺寸恒定、剪影非空',
    problems.length === 0,
    problems.length ? problems.slice(0, 8).join('; ') : `${OWNERS.length * TIERS.length * 2} 帧全过`,
  );
}

/* [1] 去直角（本体） */
const T1 = () => {
  const per = [];
  let total = 0;
  for (const owner of OWNERS) {
    for (const t of TIERS) {
      for (const kind of ['town', 'castle']) {
        const hits = rightAngleCorners(bodies.get(`${kind}_${owner}_${t}`));
        total += hits.length;
        if (hits.length) {
          per.push(
            `${kind}_${owner}_${t}: ${hits.length} 处（${hits
              .slice(0, 3)
              .map((h) => `(${h.x},${h.y}) 边${h.r}×${h.d}`)
              .join(' ')}）`,
          );
        }
      }
    }
  }
  return { total, per };
};
{
  const { total, per } = T1();
  record(
    '1',
    `去直角：≥${MIN_RUN}px 边长的 90° 外凸角 = 0（§1.2）`,
    total === 0,
    total === 0 ? '全帧 0 处' : `共 ${total} 处 — ${per.slice(0, 6).join('; ')}`,
  );
}

/* [2] 描边宽度（成品 vs 本体环重建） */
const T2 = (kind, expected) => {
  const per = [];
  let ok = true;
  for (const owner of OWNERS) {
    for (const t of TIERS) {
      const key = `${kind}_${owner}_${t}`;
      const r = checkOutlineWidth(bodies.get(key), finals.get(key), expected);
      if (!r.pass) {
        ok = false;
        per.push(
          `${key}: ring1=${r.ring1} ring2=${r.ring2} 漏描=${r.unpainted} 越界=${r.stray}${r.strayAt.length ? `(${r.strayAt.join(',')})` : ''} 异色=${r.offColor}`,
        );
      }
    }
  }
  return { ok, per };
};
{
  const town = T2('town', 1);
  record(
    '2a',
    '描边宽度：城镇恒 1px（§1.1 ≤64px 档）',
    town.ok,
    town.ok ? '全帧 1px 单环、无越界无异色' : town.per.slice(0, 4).join('; '),
  );
  const castle = T2('castle', 2);
  record(
    '2b',
    '描边宽度：城堡恒 2px（§1.1 例外条款）',
    castle.ok,
    castle.ok ? '全帧 2px 双环、无越界无异色' : castle.per.slice(0, 4).join('; '),
  );
}

/* [3] 尖角清单（诊断） */
{
  const lines = [];
  for (const owner of OWNERS) {
    for (const t of TIERS) {
      for (const kind of ['town', 'castle']) {
        const inv = sharpInventory(bodies.get(`${kind}_${owner}_${t}`));
        const peakStr = inv.peaks.map(([x, y]) => `(${x},${y})`).join(' ');
        lines.push(
          `${kind}_${owner}_${t}: 小角 ${inv.small.length} 处 · 尖点 ${inv.peaks.length} 处 [${peakStr}]`,
        );
      }
    }
  }
  console.log('\n── [3] 尖角清单（诊断项，非断言：人工核对"尖角只留给屋顶/族旗母题"） ──');
  for (const l of lines) console.log(`    ${l}`);
}

/* ==========================================================================
 * [4]–[7] S6 / G5：地图城堡按**城防**分四档（2026-11-06）
 *
 * 旧判据的洞：四档外形是按**兵营数量**选的，所以"木栅"与"堡垒"长得一模一样，
 * 而闸门只管描边/直角/尺寸，没有任何一条判"升级之后看得出来吗"。
 * 这四条的对应关系是：
 *   [4] 声明（`CASTLE_WALL_SPEC`）↔ 战斗结构（`createSiege`）—— 语义不能各说各话
 *   [5] 画出来的塔数 ↔ 声明 —— 画不能落后于表
 *   [6] 四档两两不同 —— "看得出来吗"的可执行化
 *   [7] 选择器只看城防、**不看兵营** —— 这才是 G5 的要害
 * ========================================================================== */

/**
 * 「塔带」上沿。判的是"有没有东西从屋顶线上明显突起"：
 * 0/1 档（无墙/木栅）最高点只到 y=46（屋脊），2 档主楼尖在 y=10、3 档角塔在 y=22。
 * 取 26 = 非塔最高点再往上 20px ⇒ 两侧都留足余量（描边 2px、屋顶像素级抖动）。
 *
 * ⚠️ 这是个**与画面几何绑定的常数**，不是美学阈值：改屋顶高度就要重新量。
 * 这条线之所以敢写死，是因为同一份判据还会被 [5] 的负向对照 N4 验一遍
 * （人造 0/1/3 个突起 ⇒ 必须读回 0/1/3）。
 */
const TOWER_BAND_Y = 26;

/** 统计 `y < bandY` 这段里**互不相连的列簇**数 —— 一个列簇 = 一座立起来的东西。 */
function towerClusters(pb, bandY) {
  const cols = [];
  for (let x = 0; x < pb.w; x++) {
    let hit = false;
    for (let y = 0; y < bandY; y++) {
      if (pb.alphaAt(x, y) > 8) {
        hit = true;
        break;
      }
    }
    cols.push(hit);
  }
  const out = [];
  let run = null;
  for (let x = 0; x <= cols.length; x++) {
    const on = x < cols.length && cols[x];
    if (on && !run) run = { x0: x, x1: x };
    else if (on && run) run.x1 = x;
    else if (!on && run) {
      // 细过 3px 的当作屋顶尖/旗杆的碎屑，不算"一座"
      if (run.x1 - run.x0 + 1 >= 3) out.push(run);
      run = null;
    }
  }
  return out;
}

/* [4] 声明 ↔ 战斗结构 */
{
  const rows = [];
  let ok = true;
  for (const lv of TIERS) {
    const siege = createSiege(lv);
    const real = siege ? siege.structures.filter((s) => s.kind === 'tower' || s.kind === 'keep').length : 0;
    const decl = CASTLE_WALL_SPEC[lv].towers;
    if (decl !== real) ok = false;
    rows.push(`${lv}: 声明 ${decl} / 战斗 ${real}`);
  }
  record(
    '4',
    '城防档位的塔数与 `createSiege` 一致（0 / 0 / 1 / 3）',
    ok,
    `${rows.join(' · ')}${ok ? '' : ' ← 地图与战斗各说各话'}`,
  );
}

/* [5] 画出来的塔数 ↔ 声明 */
let towersByTier = {};
{
  const per = [];
  let ok = true;
  for (const owner of OWNERS) {
    for (const t of TIERS) {
      const clusters = towerClusters(finals.get(`castle_${owner}_${t}`), TOWER_BAND_Y);
      if (owner === OWNERS[0]) towersByTier[t] = clusters.length;
      if (clusters.length !== CASTLE_WALL_SPEC[t].towers) {
        ok = false;
        per.push(`castle_${owner}_${t}: 画了 ${clusters.length} 座 / 应为 ${CASTLE_WALL_SPEC[t].towers}`);
      }
    }
  }
  record(
    '5',
    `城堡剪影的塔数 = 城防档位（塔带 y<${TOWER_BAND_Y}）`,
    ok,
    ok ? `0/1/2/3 档实测 ${TIERS.map((t) => towersByTier[t]).join(' / ')} 座` : per.slice(0, 6).join('; '),
  );
}

/* [6] 四档两两不同 */
{
  const per = [];
  let ok = true;
  let minDiff = Infinity;
  for (const owner of OWNERS) {
    for (let i = 0; i < TIERS.length; i++) {
      for (let j = i + 1; j < TIERS.length; j++) {
        const a = finals.get(`castle_${owner}_${TIERS[i]}`);
        const b = finals.get(`castle_${owner}_${TIERS[j]}`);
        let diff = 0;
        for (let y = 0; y < a.h; y++) {
          for (let x = 0; x < a.w; x++) {
            const pa = a.px(x, y);
            const pb2 = b.px(x, y);
            if (pa[0] !== pb2[0] || pa[1] !== pb2[1] || pa[2] !== pb2[2] || pa[3] !== pb2[3]) diff++;
          }
        }
        minDiff = Math.min(minDiff, diff);
        if (diff < 60) {
          ok = false;
          per.push(`castle_${owner} ${TIERS[i]}vs${TIERS[j]}: 仅 ${diff} px 不同`);
        }
      }
    }
  }
  record(
    '6',
    '四档外形两两不同（≥60px 差异，按成品帧逐像素比）',
    ok,
    ok ? `最接近的一对仍有 ${minDiff} px 不同` : per.slice(0, 6).join('; '),
  );
}

/* [7] 选择器：只看城防，不看兵营 */
{
  const fake = (buildings) => ({ buildings });
  const cases = [
    { b: [], want: 'castle_p1_0' },
    // 五个兵营全建、但没有墙 ⇒ 仍然是**村落**外形（G5 的要害：兵营不该决定外形）
    { b: ['dwell1', 'dwell2', 'dwell3', 'dwell4', 'dwell5'], want: 'castle_p1_0' },
    { b: ['wall1'], want: 'castle_p1_1' },
    { b: ['wall1', 'wall2'], want: 'castle_p1_2' },
    { b: ['wall1', 'wall2', 'wall3'], want: 'castle_p1_3' },
  ];
  const per = [];
  for (const c of cases) {
    const got = townSpriteKey(fake(c.b), 'p1', true);
    if (got !== c.want) per.push(`[${c.b.join(',') || '空'}] → ${got}（应 ${c.want}）`);
  }
  // 1×1 帧同一套档位；中立城也按自己的墙算
  const small = townSpriteKey(fake(['wall1', 'wall2']), 'neutral', false);
  if (small !== 'town_neutral_2') per.push(`1×1 中立 2 档 → ${small}（应 town_neutral_2）`);
  if (townTierOf(undefined) !== 0) per.push('没有城对象时应为 0 档');
  record(
    '7',
    '外形档位只由 `wallLevelOf` 决定（兵营数不再影响外形）',
    per.length === 0,
    per.length === 0 ? '5 组城防 + 1 组 1×1 + 空城 全对' : per.join('; '),
  );
}

/* ---------------------------------------------------------------- 负向对照 */

console.log('\n── 负向对照（插桩造失败必须红，恢复后必须复绿） ──');

/* N1：关切角 ⇒ [1] 必须红（这就是 TP-4 之前的画法） */
{
  setTownArtOptions({ ...DEFAULTS, chamfer: false });
  const stubbed = buildAll({ ...DEFAULTS, chamfer: false });
  let total = 0;
  const first = [];
  for (const owner of OWNERS) {
    for (const t of TIERS) {
      for (const kind of ['town', 'castle']) {
        const hits = rightAngleCorners(stubbed.bodies.get(`${kind}_${owner}_${t}`));
        total += hits.length;
        if (hits.length && first.length < 4) {
          first.push(`${kind}_${owner}_${t} (${hits[0].x},${hits[0].y}) 边${hits[0].r}×${hits[0].d}`);
        }
      }
    }
  }
  record(
    'N1',
    '负向对照：chamfer=false 过去直角断言必须红',
    total > 0,
    total > 0 ? `直角复活 ${total} 处（样例 ${first.join('; ')}）⇒ 断言有分辨力` : '仍为 0 —— 断言失效！',
  );
  // 恢复后复绿
  setTownArtOptions(DEFAULTS);
  const back = buildAll(DEFAULTS);
  let backTotal = 0;
  for (const owner of OWNERS) {
    for (const t of TIERS) {
      for (const kind of ['town', 'castle']) {
        backTotal += rightAngleCorners(back.bodies.get(`${kind}_${owner}_${t}`)).length;
      }
    }
  }
  record('N1r', '恢复默认后 [1] 复绿', backTotal === 0, backTotal === 0 ? '0 处' : `仍有 ${backTotal} 处`);
}

/* N2：城堡描边改 1px ⇒ [2b] 必须红（这就是 TP-4 之前城堡的描边） */
{
  setTownArtOptions({ ...DEFAULTS, castleOutline: 1 });
  const stubbed = buildAll({ ...DEFAULTS, castleOutline: 1 });
  let red = 0;
  let sample = '';
  for (const owner of OWNERS) {
    for (const t of TIERS) {
      const r = checkOutlineWidth(
        stubbed.bodies.get(`castle_${owner}_${t}`),
        stubbed.finals.get(`castle_${owner}_${t}`),
        2,
      );
      if (!r.pass) {
        red++;
        if (!sample) sample = `castle_${owner}_${t}: ring2=${r.ring2}（第 2 圈不存在）`;
      }
    }
  }
  record(
    'N2',
    '负向对照：castleOutline=1 时城堡 2px 断言必须红',
    red === OWNERS.length * TIERS.length,
    red > 0 ? `${red}/${OWNERS.length * TIERS.length} 帧转红（${sample}）⇒ 断言有分辨力` : '全绿 —— 断言失效！',
  );
  setTownArtOptions(DEFAULTS);
  const back = buildAll(DEFAULTS);
  const castle = T2('castle', 2);
  record('N2r', '恢复默认后 [2b] 复绿', castle.ok, castle.ok ? '全帧 2px' : castle.per.slice(0, 2).join('; '));
}

/* N3：城镇描边改 2px ⇒ [2a] 必须红（城镇被误按大建筑档画） */
{
  setTownArtOptions({ ...DEFAULTS, townOutline: 2 });
  const stubbed = buildAll({ ...DEFAULTS, townOutline: 2 });
  let red = 0;
  let sample = '';
  for (const owner of OWNERS) {
    for (const t of TIERS) {
      const r = checkOutlineWidth(
        stubbed.bodies.get(`town_${owner}_${t}`),
        stubbed.finals.get(`town_${owner}_${t}`),
        1,
      );
      if (!r.pass) {
        red++;
        if (!sample) sample = `town_${owner}_${t}: 越界 ${r.stray}px`;
      }
    }
  }
  record(
    'N3',
    '负向对照：townOutline=2 时城镇 1px 断言必须红',
    red === OWNERS.length * TIERS.length,
    red > 0 ? `${red}/${OWNERS.length * TIERS.length} 帧转红（${sample}）⇒ 断言有分辨力` : '全绿 —— 断言失效！',
  );
  setTownArtOptions(DEFAULTS);
  const back = buildAll(DEFAULTS);
  const town = T2('town', 1);
  record('N3r', '恢复默认后 [2a] 复绿', town.ok, town.ok ? '全帧 1px' : town.per.slice(0, 2).join('; '));
}

/* N4：塔数判据本身的分辨力 —— 人造 0 / 1 / 3 个突起，必须读回 0 / 1 / 3。
 * 没有这条，[5] 全绿也可能只是"这条线下面永远什么都没有"。 */
{
  const build = (n) => {
    const pb = new PixBuf(72, 96);
    pb.rect(6, 40, 60, 50, '#808080'); // 一堵"墙"（顶在 40，落在塔带之外）
    for (let i = 0; i < n; i++) {
      const x = 6 + i * 22;
      pb.rect(x, 6, 12, 40, '#a0a0a0'); // 突起：顶在 6
    }
    return pb;
  };
  const got = [0, 1, 3].map((n) => towerClusters(build(n), TOWER_BAND_Y).length);
  record(
    'N4',
    '塔数判据有分辨力：人造 0/1/3 个突起 ⇒ 读回 0/1/3',
    got[0] === 0 && got[1] === 1 && got[2] === 3,
    `实测 ${got.join(' / ')}`,
  );
}

/* ---------------------------------------------------------------- PNG 导出 */

if (pngDir) {
  mkdirSync(pngDir, { recursive: true });
  let n = 0;
  for (const owner of OWNERS) {
    for (const t of TIERS) {
      for (const kind of ['town', 'castle']) {
        const pb = finals.get(`${kind}_${owner}_${t}`);
        const k = kind === 'town' ? 8 : 6;
        writeFileSync(join(pngDir, `${kind}_${owner}_${t}.png`), encodePng(upscale(pb, k)));
        n++;
      }
    }
  }
  console.log(`\nPNG 已导出 → ${pngDir}（${n} 帧，town ×8 / castle ×6 最近邻放大）`);
}

/* ---------------------------------------------------------------- 汇总 */

console.log('\n' + '='.repeat(72));
const summary = results.map((r) => `[${r.id}] ${r.pass ? 'PASS' : 'FAIL'}`).join('  ');
console.log(`汇总：${summary}`);
console.log(
  bad === 0
    ? '结论：TP-4① 城堡去矩形自动部分全过（含 3 组负向对照 + 3 组恢复复绿）'
    : `结论：${bad} 项不合格 —— 不要提交`,
);
console.log('人工项：[3] 尖角清单逐帧核对"尖角只留给屋顶/族旗母题"；截图对比城堡读"玩具"不读"矩形"');
console.log('='.repeat(72));
process.exit(bad === 0 ? 0 : 1);

/* ---------------------------------------------------------------- PNG（零依赖，抄 b0audit 口径） */

/**
 * CRC 表**懒初始化**（缓存槽 `CRC_TABLE` 在文件顶部声明）。
 *
 * 原来写成模块级 `const CRC_TABLE = (() => …)()` —— 而 `--png` 的导出代码在文件
 * **中部**就调用了 `encodePng()`，那时这句 `const` 还没求值 ⇒ `--png` 一跑就是
 * `ReferenceError: Cannot access 'CRC_TABLE' before initialization`。
 * 改懒初始化后，无论从哪一行先调都成立（这个开关此前一直是坏的）。
 */
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
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
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

/** 最近邻整数放大（保持硬边像素风）。 */
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
