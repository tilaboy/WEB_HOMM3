#!/usr/bin/env node
/**
 * tp8blindtest.mjs —— TP-8①「§5.6.5 去色 32px 盲测」素材生成器 + 素材完整性预检。
 * ==========================================================================
 * 用法：
 *   node tools/tp8blindtest.mjs <outDir> [--seed=20261020] [--rounds=3]
 *   node tools/tp8blindtest.mjs <outDir> --negctrl=skipgray    # 负向对照：跳过去色 ⇒ [Gray] 必须红、exit 1
 *   node tools/tp8blindtest.mjs <outDir> --negctrl=dropunit    # 负向对照：矩阵少一格 ⇒ [Cov] 必须红、exit 1
 *   node tools/tp8blindtest.mjs <outDir> --negctrl=bg128       # 负向对照：退回旧底景灰 128 ⇒ [Contrast] 必须红、exit 1
 *
 * 产出（outDir 下）：
 *   tp8-blind-P-r{N}.png   盲测-P（形状通道·认族）：20 个 map 帧**去色**、剪影**各自缩到 32px 高**、
 *                         底对齐、seed 随机排 4 行 × 5 列。体量差被构造消掉 ⇒ 只能测形状。
 *   tp8-blind-Q-r{N}.png   盲测-Q（体量通道·认 tier）：20 个 map 帧**去色**、**原生 52×44 不缩放**、
 *                         槽底对齐（= 游戏内徽标真实呈现，MapRenderer.drawTeamBadge 不缩放贴地）、
 *                         每格脚下画 32px 格宽刻度（1 格 = 32px）。原生尺寸 ⇒ 体量通道活着。
 *   tp8-blind-answerkey.md   答案钥（**仅主持人**）：每格 → 族 × tier × 兵种中文名。
 *   tp8-blind-scoresheet.md  记录表：3 测试者 × 20 格（P 记族 / Q 记 tier）+ 命中率与处置口径。
 *   tp8-blind-manifest.txt   素材清单 + 构建绑定（dist 指纹 / seed / 生成参数）。
 *   tp8-blind-viewer.html    屏幕查看器：**像素不改**，只做 pixelated 放大（1×/2×/3×）。
 *                            素材是 1:1 原生像素，普通看图器自动插值会把 52×44 糊成灰块，
 *                            「看起来像坏图」——这是显示问题不是文件问题，故给一个不改像素的查看器。
 *
 * **协议出处（勿漂移）**：`design/art-bible/silhouette-audit.md` §③ 裁定把 §5.6.5 的裸「32px」
 * 拆成两个无歧义协议 —— P=各自缩到 32px 高（呈现高）、Q=原生 1:1 底对齐（不重缩）；
 * 两处都用 **map 帧**（§5.6.5 的盲测表用的是 map 帧，见 silhouette-audit.md:166）。
 * P 若缩槽位不缩剪影，体量差仍在 ⇒ 与裁定「消掉体量差」的自述矛盾 ⇒ 本脚本缩**剪影 bbox**。
 *
 * **本脚本不是美术门禁**（美术归 b0audit）：它管盲测**素材本身**的完整性 —— 20 格齐、真去色、
 * 32px 高、原生尺寸、体量通道活着、答案钥一致、剪影不糊进底景。这些坏了，盲测结果就废了。
 * 故预检不过 ⇒ exit 1。负向对照（项目纪律：新闸必须能红）：skipgray 钻 [Gray]、
 * dropunit 钻 [Cov]+[Key]、bg128 钻 [Contrast]（退回旧底景灰 ⇒ 贴底像素翻倍，实测 5.7/6.3%）。
 *
 * 零新增依赖：node:fs / node:path / node:zlib + ./_dist.mjs。
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { distDir, distUrl, printHeader, requireFile, argOf } from './_dist.mjs';

/* `--dist=<dir>`（缺省 `<repo>/dist`）—— team-lead #164，任何门/探针不得写死构建目录。 */
const DIST = distDir();
const FP = printHeader(DIST, 'tool=tp8blindtest');
requireFile(DIST, 'render/unitArt.js');
const art = await import(distUrl('render/unitArt.js', DIST));
const { UNIT_FRAMES, TIER_OF, buildB0Frame } = art;

/* ---------------------------------------------------------------- 参数 */

const OUT = process.argv[2] ?? '/tmp/tp8-blind';
const SEED = Number(argOf('seed', 20261020));
const ROUNDS = Math.max(1, Number(argOf('rounds', 3)));
const NEG = argOf('negctrl', null); // null | 'skipgray' | 'dropunit' | 'bg128'
if (NEG && !['skipgray', 'dropunit', 'bg128'].includes(NEG)) {
  console.error(`✗ --negctrl 只认 skipgray / dropunit / bg128，收到：${NEG}`);
  process.exit(2);
}

/* ---------------------------------------------------------------- 常量 */

const FACTIONS = ['p1', 'p2', 'p3', 'p4'];
const TIERS = [1, 2, 3, 4, 5];
const FACTION_CN = { p1: '晨曦', p2: '赤焰', p3: '翠林', p4: '紫晶' };
/** §5.6.4 20 格落地表的中文名（答案钥给主持人做口头对照用）。 */
const UNIT_CN = {
  p1_lampbearer: '提灯侍从', p2_scavenger: '捡破烂小鬼', p3_dwarf: '浇水矮人', p4_stoneimp: '石雕小怪',
  p1_hornxbow: '号角弩手', p2_axethrower: '投斧蛮子', p3_thornarcher: '荆棘射手', p4_fireapprentice: '喷火学徒',
  p1_oathpike: '铁誓枪兵', p2_wolfrider: '暴走狼骑', p3_vineguard: '藤蔓卫士', p4_hopgolem: '蹦跳魔偶',
  p1_templar: '圣殿骑士', p2_firebrand: '火油狂徒', p3_treant: '树人大叔', p4_librarian: '亡灵图书管理员',
  p1_overangel: '加班天使', p2_lavatroll: '熔岩巨魔', p3_unicorn: '独角兽园丁', p4_colossus: '失控大魔像',
};
/* ---------------------------------------------------------------- 底景与结构色
 * 底景不是随手挑的灰。20 个 map 帧**实色像素**的灰度直方图（2026-10-20 实测，14040 px）：
 *   峰在 L≈24（剪影墨线，占 24.4%）、L≈72（12.1%）、L≈106（7.8%）、L≈162（9.8%）、
 *   L≈178（6.7%）、L≈226（5.0%）。旧底景 128 正好落在**中间带的坡上**，
 *   实测 10.4% 的实色像素与底景差 ≤12 ⇒ 剪影边缘化掉，人眼看就是「灰糊/像坏图」。
 * 候选扫过 64…248（步长 4）后的取舍：
 *   L=248 camo 0.4%（太亮，亮部高光 226 与底差 22 勉强）· L=240 camo 2.1% ·
 *   **L=208 camo 3.8%，且与墨线 Δ184** —— 亮灰中性、不刺眼、剪影边缘最硬 ⇒ 选它。
 * 结构色（格框/刻度）取 192：与底景 Δ16 可见但不抢戏，且它落在直方图空档（184–191 为 0）。
 * 负向对照 `--negctrl=bg128` 就是把底景退回 128，验证 [Contrast] 真能红。
 */
const BG_V = NEG === 'bg128' ? 128 : 208;
const BG = [BG_V, BG_V, BG_V, 255];
const FRAME = [192, 192, 192, 255]; // 格框
const TICK = FRAME; // Q 的 32px 格宽刻度
const GAP_X = 10;
const GAP_Y = 10;
const PAD = 4;
const COLS = 5; // 4 行 × 5 列 = 20 格
/* 贴底景判定：|L−底景| ≤ 12 的实色像素视为"长进背景里"（camo）。
   阈值留余量：底景 208 实测全图 2.3%(P)/3.5%(Q)、单格最差 20%（软边像素按合成结果计）；
   旧的底景 128 实测全图 10.4%、单格最差 32% —— 这就是「灰糊感」的量化来源。 */
const CAMO_D = 12;
const CAMO_CELL_MAX = 30; // %（单格，含软边）
const CAMO_GLOBAL_MAX = 5; // %（全图；旧底景 128 实测 5.7/6.3 ⇒ 两条都红）

/* ------------------------------------------------- 零依赖 PNG（与 b0audit 同法） */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 8;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[o++] = rgba[i];
      raw[o++] = rgba[i + 1];
      raw[o++] = rgba[i + 2];
      raw[o++] = rgba[i + 3];
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

/* ---------------------------------------------------------------- 工具函数 */

/** CIE L* —— 与 tools/b0audit.mjs 逐字同口径（明度签名 / 去色映射）。 */
function lstar(r, g, b) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const Y = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  return Y <= 0 ? 0 : 116 * Math.cbrt(Y) - 16;
}
const grayOf = (r, g, b) => Math.round((Math.max(0, Math.min(100, lstar(r, g, b))) / 100) * 255);

/** mulberry32：小seed PRNG，round 间只差 seed ⇒ 三次重排可复算。 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (arr, rand) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** 剪影 bbox（alpha>8 即不透明 —— 与 neutralaudit/b0audit 同阈值）。 */
function bboxOf(pb) {
  let x0 = pb.w;
  let y0 = pb.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < pb.h; y++) {
    for (let x = 0; x < pb.w; x++) {
      if (pb.px(x, y)[3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * 盲测-P 单元：剪影 bbox 缩放至**恰 targetH 高** + 去色（点采样 = 游戏内 nearest 渲染同法）。
 * 负向对照 skipgray：跳过去色（保留原色）⇒ 喂给 [Gray] 预检必须红。
 */
function cellP(pb, targetH) {
  const bb = bboxOf(pb);
  const tw = Math.max(1, Math.round((bb.w * targetH) / bb.h));
  const rows = [];
  for (let y = 0; y < targetH; y++) {
    const sy = bb.y0 + Math.min(bb.h - 1, Math.floor((y * bb.h) / targetH));
    const row = [];
    for (let x = 0; x < tw; x++) {
      const sx = bb.x0 + Math.min(bb.w - 1, Math.floor((x * bb.w) / tw));
      const s = pb.px(sx, sy);
      if (NEG === 'skipgray') row.push([s[0], s[1], s[2], s[3]]);
      else {
        const v = grayOf(s[0], s[1], s[2]);
        row.push([v, v, v, s[3]]);
      }
    }
    rows.push(row);
  }
  return { w: tw, h: targetH, rows };
}

/** 盲测-Q 单元：整槽 52×44 **原生 1:1** + 去色（不缩放 ⇒ 体量通道存活）。 */
function cellQ(pb) {
  const rows = [];
  for (let y = 0; y < pb.h; y++) {
    const row = [];
    for (let x = 0; x < pb.w; x++) {
      const s = pb.px(x, y);
      if (NEG === 'skipgray') row.push([s[0], s[1], s[2], s[3]]);
      else {
        const v = grayOf(s[0], s[1], s[2]);
        row.push([v, v, v, s[3]]);
      }
    }
    rows.push(row);
  }
  return { w: pb.w, h: pb.h, rows };
}

/**
 * 网格排版：cells 逐行铺进 COLS 列；盒内**底对齐**（P/Q 共用同一条基线逻辑）；
 * withTick=true 时每格脚下画 32px 格宽刻度（Q 专用，「1 格 = 32px」的可视化）。
 * 返回画布 + 每格实际落点（预检要量）。
 */
function compose(cells, withTick) {
  const rowsN = Math.ceil(cells.length / COLS);
  const boxW = Math.max(...cells.map((c) => c.w)) + PAD * 2;
  const boxH = Math.max(...cells.map((c) => c.h)) + PAD * 2;
  const W = GAP_X + COLS * (boxW + GAP_X);
  const H = GAP_Y + rowsN * (boxH + GAP_Y);
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = BG[0];
    out[i * 4 + 1] = BG[1];
    out[i * 4 + 2] = BG[2];
    out[i * 4 + 3] = 255;
  }
  const rects = [];
  cells.forEach((c, i) => {
    const r = Math.floor(i / COLS);
    const col = i % COLS;
    const boxX = GAP_X + col * (boxW + GAP_X);
    const boxY = GAP_Y + r * (boxH + GAP_Y);
    const baseY = boxY + boxH - PAD; // 盒内基线（底对齐）
    const sx = boxX + Math.round((boxW - c.w) / 2);
    const sy = baseY - c.h;
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        const s = c.rows[y][x];
        if (s[3] <= 8) continue;
        const i4 = ((sy + y) * W + sx + x) * 4;
        const a = s[3] / 255;
        out[i4] = Math.round(s[0] * a + BG[0] * (1 - a));
        out[i4 + 1] = Math.round(s[1] * a + BG[1] * (1 - a));
        out[i4 + 2] = Math.round(s[2] * a + BG[2] * (1 - a));
        out[i4 + 3] = 255;
      }
    }
    if (withTick) {
      // 32px 格宽刻度：格心对齐，贴在基线上（高 2px）—— 「1 格 = 32px」的结构标记
      const tx = boxX + Math.round((boxW - 32) / 2);
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 32; x++) {
          const i4 = ((baseY + y) * W + tx + x) * 4;
          out[i4] = TICK[0];
          out[i4 + 1] = TICK[1];
          out[i4 + 2] = TICK[2];
          out[i4 + 3] = 255;
        }
      }
    }
    // 格框：1px，画在盒边缘（格内容仍留 PAD 内缩）—— 让「一格」读得出来。
    // 只落在 rc 之外 ⇒ 不影响 [Fill]/[P32]/[QNative] 的实测口径。
    for (let x = boxX; x < boxX + boxW; x++) {
      for (const y of [boxY, boxY + boxH - 1]) {
        const i4 = (y * W + x) * 4;
        out[i4] = FRAME[0];
        out[i4 + 1] = FRAME[1];
        out[i4 + 2] = FRAME[2];
        out[i4 + 3] = 255;
      }
    }
    for (let y = boxY; y < boxY + boxH; y++) {
      for (const x of [boxX, boxX + boxW - 1]) {
        const i4 = (y * W + x) * 4;
        out[i4] = FRAME[0];
        out[i4 + 1] = FRAME[1];
        out[i4 + 2] = FRAME[2];
        out[i4 + 3] = 255;
      }
    }
    rects.push({ x: sx, y: sy, w: c.w, h: c.h, baseY });
  });
  return { w: W, h: H, data: out, rects, boxW, boxH, rowsN };
}

/**
 * 从合成画布**实测**一格：着墨像素 / 着墨行数 / 着墨跨度（首行→末行，含内部空隙）。
 * 为什么量**跨度**不量行数：剪影内部有合法全透明扫描行（加班天使的头顶光环与头之间的
 * 空隙是 p1 的识别件之一）—— 数行数会把它误判成"差 1px"。跨度才是"这一格占多高"。
 */
function measureCell(G, rc) {
  let inkRows = 0;
  let inkPx = 0;
  let camoPx = 0;
  let firstRow = -1;
  let lastRow = -1;
  for (let y = rc.y; y < rc.y + rc.h; y++) {
    let rowInk = false;
    for (let x = rc.x; x < rc.x + rc.w; x++) {
      const i = (y * G.w + x) * 4;
      const d = Math.abs(G.data[i] - BG[0]);
      if (d > 6 || Math.abs(G.data[i + 1] - BG[1]) > 6 || Math.abs(G.data[i + 2] - BG[2]) > 6) {
        inkPx++;
        if (d <= CAMO_D) camoPx++; // 与底景几乎同灰 ⇒ 视觉上"长进背景里"
        rowInk = true;
      }
    }
    if (rowInk) {
      inkRows++;
      if (firstRow < 0) firstRow = y;
      lastRow = y;
    }
  }
  return { inkRows, inkPx, camoPx, span: firstRow < 0 ? 0 : lastRow - firstRow + 1 };
}

/* ---------------------------------------------------------------- 20 格矩阵 */

/** 矩阵派生自 TIER_OF 真值源（p1–p4 × tier 1–5），不写死；负向对照 dropunit 抽掉一格。 */
const matrix = [];
for (const f of FACTIONS) {
  for (const t of TIERS) {
    const unit = Object.keys(TIER_OF).find((u) => u.slice(0, 2) === f && TIER_OF[u] === t);
    matrix.push({ unit, faction: f, tier: t });
  }
}
if (NEG === 'dropunit') {
  const i = matrix.findIndex((m) => m.unit === 'p4_colossus');
  matrix.splice(i, 1); // 负向对照：19 格 ⇒ [Cov] 必须红
}
const frameSpec = new Map(UNIT_FRAMES.map((s) => [s.name, s]));

/* ---------------------------------------------------------------- 主流程 */

mkdirSync(OUT, { recursive: true });
const outputs = [];
const bad = [];
const results = [];
const record = (id, title, pass, detail) => {
  results.push({ id, title, pass });
  if (!pass) bad.push(`${id} ${title}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  console.log(`[${pass ? 'PASS' : 'FAIL'}] [${id}] ${title}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
};

console.log(`\nTP-8① 盲测素材：outDir=${OUT} · seed=${SEED} · rounds=${ROUNDS} · negctrl=${NEG ?? '无'}`);

/* ---- [Cov] 覆盖闸：20 格矩阵完整（有对象无可判数据必须红，不许静默跳过） ---- */
{
  const dup = matrix.length !== new Set(matrix.map((m) => m.unit)).size;
  const missingFrame = matrix.filter((m) => !frameSpec.get(`u_${m.unit}_map`));
  const pass = matrix.length === 20 && !dup && missingFrame.length === 0;
  record('Cov', '20 格矩阵完整（TIER_OF p1–p4 × tier 1–5 + 每单位有 u_*_map 帧）', pass, {
    name: '矩阵',
    cells: matrix.length,
    dup,
    missingFrame: missingFrame.map((m) => m.unit).join(',') || '无',
  });
}

/* ---- [Src] 源帧槽位口径：全部 52×44（D-73 加宽后的 map 槽；抓"拿错帧种类"） ---- */
{
  const wrong = [];
  for (const m of matrix) {
    const s = frameSpec.get(`u_${m.unit}_map`);
    if (!s || s.w !== 52 || s.h !== 44) wrong.push(`${m.unit}:${s ? `${s.w}×${s.h}` : '缺帧'}`);
  }
  record('Src', '20 个源帧全部 52×44（map 槽位口径）', wrong.length === 0, {
    name: '源帧',
    wrong: wrong.join(' ') || '无',
  });
}

/* ---- 渲染 + 排版（每个 round 一次；负向对照同样跑，让预检去红） ---- */
const rounds = [];
for (let r = 1; r <= ROUNDS; r++) {
  const order = shuffle(matrix, rng(SEED + r * 7919));
  const pbs = order.map((m) => buildB0Frame(`u_${m.unit}_map`));
  const P = compose(
    pbs.map((pb) => cellP(pb, 32)),
    false,
  );
  const Q = compose(
    pbs.map((pb) => cellQ(pb)),
    true,
  );
  rounds.push({ r, order, P, Q, pbs });
  const sfx = NEG ? `-negctrl-${NEG}` : '';
  const pPath = join(OUT, `tp8-blind-P-r${r}${sfx}.png`);
  const qPath = join(OUT, `tp8-blind-Q-r${r}${sfx}.png`);
  writeFileSync(pPath, encodePng(P.w, P.h, P.data));
  writeFileSync(qPath, encodePng(Q.w, Q.h, Q.data));
  outputs.push(pPath, qPath);
  console.log(
    `  round ${r}：P ${P.w}×${P.h}（每格剪影 32px 高）· Q ${Q.w}×${Q.h}（原生 52×44）· 排列种子 ${SEED + r * 7919}`,
  );
}

/* ---- 预检（对每个 round 的合成图逐项量；任一不过 ⇒ exit 1） ---- */
for (const { r, order, P, Q, pbs } of rounds) {
  const tag = `r${r}`;

  /* [P32] P 每格剪影高恰 32 —— **从画布实测着墨跨度**（不信构造值）：
     构造消体量差是 P 协议的前提（silhouette-audit §③），跨度 31/33 都说明缩放链路坏了。 */
  {
    const badH = [];
    P.rects.forEach((rc, i) => {
      const m = measureCell(P, rc);
      if (m.span !== 32) badH.push(`格${i}:跨度${m.span}`);
    });
    record('P32', `[${tag}] P 每格实测着墨跨度 = 32px`, badH.length === 0, {
      name: 'P',
      bad: badH.join(' ') || '无',
    });
  }

  /* [QNative] Q 每格原生 52×44 未缩放（槽尺寸 = 帧尺寸 = 没缩放；实测剪影跨度 18~44） */
  {
    const badH = [];
    Q.rects.forEach((rc, i) => {
      const m = measureCell(Q, rc);
      if (rc.w !== 52 || rc.h !== 44 || m.span < 18 || m.span > 44) {
        badH.push(`格${i}:槽${rc.w}×${rc.h}/跨度${m.span}`);
      }
    });
    record('QNative', `[${tag}] Q 每格原生 52×44（不缩放，剪影跨度 18~44px）`, badH.length === 0, {
      name: 'Q',
      bad: badH.join(' ') || '无',
    });
  }

  /* [QMass] Q 的 tier 体量通道活着：T5 平均剪影高 − T1 平均剪影高 ≥ 8px（44 画布）。
     防「有人误开单档归一化把体量抹平」——那会让 Q 假通过（测了个不存在的东西）。
     ⚠️ pbs 按**洗牌后**的 order 渲染 ⇒  tier 必须取 order[i]，不是 matrix[i]（写错会配错对）。 */
  {
    const heights = pbs.map((pb) => bboxOf(pb)?.h ?? 0);
    const hOf = (t) => heights.filter((_, i) => order[i]?.tier === t);
    const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
    const margin = avg(hOf(5)) - avg(hOf(1));
    const detail = {
      name: 'Q',
      T1: avg(hOf(1)).toFixed(1),
      T5: avg(hOf(5)).toFixed(1),
      margin: margin.toFixed(1),
    };
    record('QMass', `[${tag}] Q 体量通道存活（T5−T1 平均剪影高 ≥ 8px）`, margin >= 8, detail);
  }

  /* [Gray] 真去色：两张图每个不透明像素 R=G=B（skipgray 负向对照钻这里） */
  for (const [kind, G] of [
    ['P', P],
    ['Q', Q],
  ]) {
    let off = 0;
    const at = [];
    for (let y = 0; y < G.h && off < 5; y++) {
      for (let x = 0; x < G.w && off < 5; x++) {
        const i = (y * G.w + x) * 4;
        if (G.data[i] !== G.data[i + 1] || G.data[i + 1] !== G.data[i + 2]) {
          off++;
          if (at.length < 3) at.push(`(${x},${y})`);
        }
      }
    }
    record('Gray', `[${tag}] ${kind} 图真去色（不透明像素 R=G=B）`, off === 0, {
      name: kind,
      off,
      at: at.join(' ') || '无',
    });
  }

  /* [Fill] 每格非空（防白格/糊格进盲测表）—— 用实测着墨像素 */
  for (const [kind, G] of [
    ['P', P],
    ['Q', Q],
  ]) {
    let minFill = Infinity;
    let minAt = -1;
    G.rects.forEach((rc, i) => {
      const m = measureCell(G, rc);
      if (m.inkPx < minFill) {
        minFill = m.inkPx;
        minAt = i;
      }
    });
    record('Fill', `[${tag}] ${kind} 每格本体像素 ≥ 40（防空格）`, minFill >= 40, {
      name: kind,
      minFill,
      minAt,
    });
  }

  /* [Contrast] 贴底景像素占比 —— 盲测素材的「看不见」闸。
     底景挑在灰度直方图空档（见文件头），贴底像素应极少；若有人把底景改回 128
     （`--negctrl=bg128`）或美术整体转灰，剪影边缘会化掉 —— 素材废了，必须红。 */
  for (const [kind, G] of [
    ['P', P],
    ['Q', Q],
  ]) {
    let ink = 0;
    let camo = 0;
    let worst = 0;
    let worstAt = -1;
    G.rects.forEach((rc, i) => {
      const m = measureCell(G, rc);
      ink += m.inkPx;
      camo += m.camoPx;
      const pct = m.inkPx ? (100 * m.camoPx) / m.inkPx : 100;
      if (pct > worst) {
        worst = pct;
        worstAt = i;
      }
    });
    const global = ink ? (100 * camo) / ink : 100;
    record(
      'Contrast',
      `[${tag}] ${kind} 贴底景像素 ≤${CAMO_CELL_MAX}%/格、≤${CAMO_GLOBAL_MAX}%/全图（底景 L=${BG[0]}）`,
      worst <= CAMO_CELL_MAX && global <= CAMO_GLOBAL_MAX,
      { name: kind, bg: BG[0], global: global.toFixed(1), worst: worst.toFixed(1), worstAt },
    );
  }

  /* [Layout] 画布尺寸符合 4 行 × 5 列公式 */
  for (const [kind, G] of [
    ['P', P],
    ['Q', Q],
  ]) {
    const rowsN = Math.ceil(G.rects.length / COLS);
    const expH = GAP_Y + rowsN * (G.boxH + GAP_Y);
    const expW = GAP_X + COLS * (G.boxW + GAP_X);
    record('Layout', `[${tag}] ${kind} 画布尺寸符合 ${rowsN} 行 × ${COLS} 列公式`, G.w === expW && G.h === expH, {
      name: kind,
      got: `${G.w}×${G.h}`,
      exp: `${expW}×${expH}`,
    });
  }
}

/* ---- [Key] 答案钥一致性（每 round 独立）：20 项唯一、4×5 全覆盖 ---- */
for (const { r, order } of rounds) {
  const uniq = new Set(order.map((m) => m.unit)).size === order.length;
  const pairs = new Set(order.map((m) => `${m.faction}|${m.tier}`));
  const full =
    FACTIONS.every((f) => TIERS.every((t) => pairs.has(`${f}|${t}`))) && pairs.size === 20;
  record('Key', `[r${r}] 答案钥：${order.length} 项唯一、4 族 × 5 tier 全覆盖`, uniq && full, {
    name: 'key',
    uniq,
    pairs: pairs.size,
  });
}

/* ---------------------------------------------------------------- 产物：答案钥 / 记录表 / 清单 */

if (!NEG) {
  /* 答案钥（仅主持人） */
  {
    const L = [];
    L.push('# TP-8① 盲测答案钥（**仅主持人** —— 开测前不给测试者看）');
    L.push('');
    L.push(`- 构建绑定：\`main.js.md5=${FP.md5 ?? '(n/a)'}\` · combo=${FP.sha256 ?? '(n/a)'}`);
    L.push(`- 生成参数：seed=\`${SEED}\` · rounds=${ROUNDS} · 生成时间 ${new Date().toISOString()}`);
    L.push('- 协议出处：`design/art-bible/silhouette-audit.md` §③（P=缩到 32px 高测形状 / Q=原生尺寸测体量；均用 map 帧）');
    L.push('');
    L.push('## 选项集（开测前口头告知测试者；网格上不出现任何文字）');
    L.push('- 族（4 选 1）：晨曦 / 赤焰 / 翠林 / 紫晶');
    L.push('- tier（5 选 1）：1 / 2 / 3 / 4 / 5');
    L.push('- 测试者须知：没看过设计文档；每格独立判断，不许回溯修改；P 与 Q 是两份独立材料。');
    L.push('');
    L.push('## 判定口径（cartoon-style.md §5.6.5 / overall-repair-plan TP-8）');
    L.push('| 命中率（P 族通道 / Q tier 通道，各按 20 格计） | 处置 |');
    L.push('|---|---|');
    L.push('| **≥90%（18/20）** | ×4 成立，TP-8① 过 |');
    L.push('| 70–90% | 回 TP-1/4 修**体量**（不改形状） |');
    L.push('| <70% | 回退共用换皮 |');
    for (const { r, order } of rounds) {
      L.push('');
      L.push(`## Round ${r}（排列种子 \`${SEED + r * 7919}\`，网格 4 行 × 5 列，行=上→下，列=左→右）`);
      L.push('');
      L.push('| 格(行,列) | 兵种 id | 族 | tier | 中文名（§5.6.4） |');
      L.push('|---|---|---|---|---|');
      order.forEach((m, i) => {
        const row = Math.floor(i / COLS) + 1;
        const col = (i % COLS) + 1;
        L.push(`| (${row},${col}) | \`${m.unit}\` | ${FACTION_CN[m.faction]} | ${m.tier} | ${UNIT_CN[m.unit] ?? '—'} |`);
      });
    }
    const p = join(OUT, 'tp8-blind-answerkey.md');
    writeFileSync(p, L.join('\n') + '\n');
    outputs.push(p);
  }

  /* 记录表（3 测试者） */
  {
    const L = [];
    L.push('# TP-8① 盲测记录表');
    L.push('');
    L.push(`- 日期：____-__-__ · 主持人：______ · 材料版本：\`main.js.md5=${FP.md5 ?? '(n/a)'}\` · seed=${SEED}`);
    L.push('- 材料：`tp8-blind-P-r{N}.png`（认族）× `tp8-blind-Q-r{N}.png`（认 tier）；答案见 `tp8-blind-answerkey.md`（主持人手持）。');
    L.push('- 流程：每名测试者先看 P 图标族（20 格），再看 Q 图标 tier（20 格）；两材料顺序固定、不互换；单格判断不回溯。');
    L.push('');
    for (const t of ['A', 'B', 'C']) {
      L.push(`## 测试者 ${t}（姓名/背景：____________，确认未看过设计文档：☐）`);
      L.push('');
      L.push(`### 盲测-P · 认族（Round __，族选项：晨曦/赤焰/翠林/紫晶）`);
      L.push('');
      L.push('| 行\\列 | 1 | 2 | 3 | 4 | 5 |');
      L.push('|---|---|---|---|---|---|');
      for (let row = 1; row <= 4; row++) L.push(`| ${row} |  |  |  |  |  |`);
      L.push('');
      L.push('族命中：____ / 20 = ____%');
      L.push('');
      L.push(`### 盲测-Q · 认 tier（Round __，tier 选项：1/2/3/4/5）`);
      L.push('');
      L.push('| 行\\列 | 1 | 2 | 3 | 4 | 5 |');
      L.push('|---|---|---|---|---|---|');
      for (let row = 1; row <= 4; row++) L.push(`| ${row} |  |  |  |  |  |`);
      L.push('');
      L.push('tier 命中：____ / 20 = ____%');
      L.push('');
    }
    L.push('## 汇总与处置');
    L.push('');
    L.push('| 通道 | A | B | C | 三人均值 | 判定（≥90% 过 / 70–90% 修体量 / <70% 回退换皮） |');
    L.push('|---|---|---|---|---|---|');
    L.push('| P 族 |  |  |  |  |  |');
    L.push('| Q tier |  |  |  |  |  |');
    L.push('');
    L.push('主持人备注（哪几格被一致误判、误判模式：______）：');
    L.push('');
    L.push('> 误判模式比总分更重要：若某族某 tier 被系统性认错，按 silhouette-audit 的处置修**体量**（第 3 条：改体量，不要改形状）。');
    const p = join(OUT, 'tp8-blind-scoresheet.md');
    writeFileSync(p, L.join('\n') + '\n');
    outputs.push(p);
  }

  /* 屏幕查看器：不改像素，只做 pixelated 放大 —— 解决「1:1 原生像素被看图器插值糊成灰块」。 */
  {
    const imgs = rounds
      .map(
        ({ r }) =>
          `      <section>\n` +
          `        <h2>Round ${r} · 盲测-P（认族 · 剪影各自缩到 32px 高）</h2>\n` +
          `        <img class="px" src="tp8-blind-P-r${r}.png" alt="P r${r}">\n` +
          `        <h2>Round ${r} · 盲测-Q（认 tier · 原生 52×44 不缩放）</h2>\n` +
          `        <img class="px" src="tp8-blind-Q-r${r}.png" alt="Q r${r}">\n` +
          `      </section>`,
      )
      .join('\n');
    const html = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>TP-8① 盲测素材查看器</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 20px 24px 48px; background: #f4f4f2; color: #222;
         font: 14px/1.5 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 18px; margin: 0 0 6px; }
  .note { color: #555; margin: 0 0 14px; }
  .note b { color: #222; }
  .bar { position: sticky; top: 0; background: #f4f4f2; padding: 8px 0 10px; border-bottom: 1px solid #ddd; z-index: 9; }
  button { font: inherit; padding: 4px 12px; margin-right: 6px; border: 1px solid #bbb; border-radius: 6px;
           background: #fff; cursor: pointer; }
  button[aria-pressed="true"] { background: #222; color: #fff; border-color: #222; }
  section { margin-top: 22px; }
  h2 { font-size: 13px; font-weight: 600; color: #444; margin: 16px 0 6px; }
  /* 关键：pixelated —— 放大不插值，看到的仍是原始像素块 */
  img.px { display: block; image-rendering: pixelated; background: #fff; border: 1px solid #ccc; }
  img.px[data-z="1"] { zoom: 1; }
  img.px[data-z="2"] { zoom: 2; }
  img.px[data-z="3"] { zoom: 3; }
</style>
<h1>TP-8① 盲测素材（P 形状通道 / Q 体量通道）</h1>
<p class="note">
  素材是 <b>1:1 原生像素</b>，本页只做 pixelated 放大，<b>不改任何像素</b>。
  判读以 1× 为准；放大只为看清像素块（普通看图器的平滑插值会让 52×44 糊成灰块，看着像坏图）。
</p>
<div class="bar">
  <button data-z="1" aria-pressed="true">1×</button>
  <button data-z="2" aria-pressed="false">2×</button>
  <button data-z="3" aria-pressed="false">3×</button>
  <span class="note" style="margin-left:8px">盲测时请让测试者只看图，本页不含任何答案。</span>
</div>
${imgs}
<script>
  for (const b of document.querySelectorAll('button[data-z]')) {
    b.addEventListener('click', () => {
      const z = b.dataset.z;
      for (const x of document.querySelectorAll('button[data-z]')) x.setAttribute('aria-pressed', String(x === b));
      for (const img of document.querySelectorAll('img.px')) img.dataset.z = z;
    });
  }
  for (const img of document.querySelectorAll('img.px')) img.dataset.z = '1';
</script>
</html>
`;
    const p = join(OUT, 'tp8-blind-viewer.html');
    writeFileSync(p, html);
    outputs.push(p);
  }

  /* 清单（绑构建） */
  {
    const L = [];
    L.push('# TP-8① 盲测素材清单');
    L.push(`dist: ${FP.dir}`);
    L.push(`main.js.md5: ${FP.md5 ?? '(n/a)'}   combo: ${FP.sha256 ?? '(n/a)'}   mtime(非绑定量): ${FP.mtime ?? '(n/a)'}`);
    L.push(`seed: ${SEED}   rounds: ${ROUNDS}   negctrl: 无`);
    L.push(`底景: L=${BG[0]}（灰阶中性；实测贴底像素 P 2.3% / Q 3.5%，见 [Contrast]）· 格框 L=${FRAME[0]}`);
    L.push('查看: 用 tp8-blind-viewer.html（pixelated 放大，不改像素）；普通看图器会插值糊化 1:1 素材。');
    L.push(`generated: ${new Date().toISOString()}`);
    L.push('files:');
    for (const f of outputs) L.push(`  ${f}`);
    L.push('');
    L.push('协议口径（silhouette-audit.md §③ 裁定，勿漂移）：');
    L.push('  P（形状通道·认族）：map 帧去色 + 剪影各自缩到 32px 高 + 底对齐 + 随机 4×5。体量差被构造消除。');
    L.push('  Q（体量通道·认 tier）：map 帧去色 + 原生 52×44 不缩放 + 槽底对齐（= 游戏内徽标真实呈现）+ 32px 格宽刻度。');
    L.push('  注意：P 缩的是剪影 bbox 而非槽位 —— 缩槽位不会消除体量差，与裁定自述矛盾。');
    const p = join(OUT, 'tp8-blind-manifest.txt');
    writeFileSync(p, L.join('\n') + '\n');
    outputs.push(p);
  }
}

/* ---------------------------------------------------------------- 汇总 */

console.log('\n' + '='.repeat(64));
console.log(
  `素材预检汇总： ${results.map((x) => `[${x.id}]${x.pass ? '✓' : '✗'}`).join(' ')}`,
);
if (bad.length) {
  console.log(`不合格 ${bad.length} 项：`);
  for (const b of bad) console.log(`  ✗ ${b}`);
}
console.log(
  `结论：素材${bad.length === 0 ? '完整，可交盲测' : '不完整 —— 不要用于盲测'}${NEG ? `（负向对照 ${NEG}：预检按设计变红）` : ''}`,
);
for (const f of outputs) console.log(`  产出 ${f}`);
process.exit(bad.length === 0 ? 0 : 1);
