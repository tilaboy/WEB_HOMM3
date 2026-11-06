#!/usr/bin/env node
/**
 * blindkit.mjs —— 生成**可以直接发给别人做**的盲测套件（§8.4 · S3a/S3b 人工项）
 * ==========================================================================
 * 为什么不用 `bodyplanaudit --png` 出的 `blind-22x30-*.png`：
 *   那条是**按 sheet 的顺序**排的（小孩→弩手→鹰→骑士→天使），看过一次对照表的人
 *   就能靠"第几张"答对，等于把答案印在题面上。而且它只有一张，五个人做同一张
 *   ⇒ 第一个人做完，后面四个人已经听过答案。
 *   本工具解决三件事：**每人一份独立乱序**、**题面零信息**、**答案钥单独落盘**。
 *
 * 产出（默认 `production/s3b/blind/`）：
 *   study-p1.png / study-p2.png         教材页：5 张 64×56 大图 + 编号（被测者看 60 秒）
 *   quiz-p1-t1..t5.png                  **计分页**：43×37（兵牌真实尺寸），每人独立乱序
 *   quiz22-p1-t1..t5.png                余量页：22×30（比兵牌还小 4 倍面积）
 *   diag-p1-t1..t5.png                  **诊断页**：22×30 ×8，只给主理人回查看，不参与计分
 *   pairs-cross.png                     跨族题：同档位的 p1/p2 成对并排，问"是同一个兵吗"
 *   KEY.md                              答案钥 + 教材页编号表（**别给被测者看**）
 *   key.json                            机读版，计分脚本用
 *
 * 用法：
 *   npm run build
 *   node tools/blindkit.mjs                       # 默认两族 × 5 人
 *   node tools/blindkit.mjs --out=<dir> --testers=5 --seed=20261106
 *   node tools/blindkit.mjs --fam=p2              # 只出 p2
 *
 * 设计取舍（都写在这里，免得下一个人重新猜）：
 *   1. **底色 #2b2f35**（iron 浮层近似值），不是中灰。测的是"兵牌上认不认得出"，
 *      就要用兵牌的底色；换中灰会变成另一个条件（有些兵恰好和 UI 同调）。
 *   2. **不做字形**（和 unitsheet 同规矩）：只画 5×7 的数字，中文名写在 KEY.md 里，
 *      由主理人念给被测者听。这样题面里一个汉字都没有，也就没有语义泄漏。
 *   3. **数字在格子下方、贴着底边**，不在上方 —— 上方会被当成"名字/标签"，
 *      而且人眼自上而下扫，编号在上会先入眼、干扰对剪影的第一印象。
 *   4. 每格**不画边框**：边框会把所有格子的"视觉重量"拉平，而体形档靠的正是重量差。
 *   5. **所有页一律 ×2，不做 ×8 计分**（本节是 2026-11-06 自查纠出来的错）：
 *      上一版的 `blind-22x30-*.png` 是 ×8 —— 22px 的图放大到 176px 高，
 *      面积变成 **64 倍**。`npm run audit:bodyplan --png` 出的那条同理。
 *      拿它做"22px 可辨"的判据，测的根本不是 22px。×2 是 **2× DPR 手机上的
 *      实际可视尺寸**（22 CSS px ⇒ 44 设备像素），所以 ×2 页 = 真机所见。
 *      ×8 只保留为 `diag-*`，用途是"某人答错之后回查为什么错"，不许用来辩护。
 *   6. **页面固定 1440×900，内容居中**：小图会被看图器自动放大到适合窗口，
 *      放大多少取决于对方窗口 ⇒ 测试条件失控。放进大页里，fit-to-window 落在
 *      100%，呈现尺寸才等于像素尺寸；窗口更小时只会缩小（更严，不会更松）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { distDir, distUrl, printHeader, requireFile } from './_dist.mjs';

const DIST = distDir();
printHeader(DIST, 'gate=blindkit');
requireFile(DIST, 'render/unitArt.js');
requireFile(DIST, 'render/unitFrames.js');

const { buildB0Frame, buildPortraitFrame } = await import(distUrl('render/unitArt.js', DIST));
const { unitCombatFrame } = await import(distUrl('render/unitFrames.js', DIST));

/* ---------------------------------------------------------------- 参数 */

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const OUT = argOf('--out', '../production/s3b/blind');
const TESTERS = Number(argOf('--testers', '5'));
const SEED = Number(argOf('--seed', '20261106'));
const FAM_ARG = argOf('--fam', '');

/** 族的五个兵（顺序 = 教材页的"原始顺序"，仅用于起名，题面一律乱序）。 */
const FAMS = {
  p1: [
    { id: 'p1_child', cn: '小孩', cls: '矮' },
    { id: 'p1_crossbow', cn: '弩手', cls: '中' },
    { id: 'p1_eagle', cn: '鹰', cls: '高' },
    { id: 'p1_knight', cn: '骑士', cls: '宽体' },
    { id: 'p1_angel', cn: '天使', cls: '巨物·飞行' },
  ],
  p2: [
    { id: 'p2_matchman', cn: '火柴人', cls: '矮' },
    { id: 'p2_bronze', cn: '铜人', cls: '中' },
    { id: 'p2_lavagiant', cn: '熔岩巨人', cls: '高' },
    { id: 'p2_threewolf', cn: '三头狼', cls: '宽体' },
    { id: 'p2_devil', cn: '恶魔', cls: '巨物·飞行' },
  ],
};
const FAM_KEYS = FAM_ARG ? FAM_ARG.split(',').map((s) => s.trim()) : Object.keys(FAMS);
for (const f of FAM_KEYS) {
  if (!FAMS[f]) {
    console.error(`族名不认识：${f}（可选 ${Object.keys(FAMS).join(' / ')}）`);
    process.exit(2);
  }
}
if (!Number.isInteger(TESTERS) || TESTERS < 1) {
  console.error(`--testers 必须是正整数，收到 ${TESTERS}`);
  process.exit(2);
}

/* ---------------------------------------------------------------- 零依赖 PNG */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
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

/* ---------------------------------------------------------------- 数字字形（5×7） */

const GLYPH = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};
const GLYPH_W = 5;
const GLYPH_H = 7;
const GLYPH_GAP = 1;

function textWidth(str, scale) {
  const n = str.length;
  return (n * GLYPH_W + (n - 1) * GLYPH_GAP) * scale;
}

/* ---------------------------------------------------------------- 画布 */

const BG = [0x2b, 0x2f, 0x35, 255]; // iron 浮层近似色（见文件头取舍 1）
const NUM_FG = [0xd8, 0xd2, 0xc4, 255]; // 暖白：和 UI 的字色同族，不和任何一族主色撞

function newPage(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = BG[0];
    data[i * 4 + 1] = BG[1];
    data[i * 4 + 2] = BG[2];
    data[i * 4 + 3] = 255;
  }
  return { w, h, data };
}

function blitScaled(page, pb, dx, dy, k) {
  for (let y = 0; y < pb.h * k; y++) {
    for (let x = 0; x < pb.w * k; x++) {
      const s = pb.px(Math.floor(x / k), Math.floor(y / k));
      if (s[3] === 0) continue;
      const px = dx + x;
      const py = dy + y;
      if (px < 0 || py < 0 || px >= page.w || py >= page.h) continue;
      const o = (py * page.w + px) * 4;
      const a = s[3] / 255;
      page.data[o] = Math.round(s[0] * a + page.data[o] * (1 - a));
      page.data[o + 1] = Math.round(s[1] * a + page.data[o + 1] * (1 - a));
      page.data[o + 2] = Math.round(s[2] * a + page.data[o + 2] * (1 - a));
      page.data[o + 3] = 255;
    }
  }
}

function drawNumber(page, str, cx, top, scale) {
  const w = textWidth(str, scale);
  let x0 = Math.round(cx - w / 2);
  for (const ch of str) {
    const g = GLYPH[ch];
    if (!g) throw new Error(`没有字形：${ch}`);
    for (let r = 0; r < GLYPH_H; r++) {
      for (let c = 0; c < GLYPH_W; c++) {
        if (g[r][c] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = x0 + c * scale + sx;
            const py = top + r * scale + sy;
            if (px < 0 || py < 0 || px >= page.w || py >= page.h) continue;
            const o = (py * page.w + px) * 4;
            page.data[o] = NUM_FG[0];
            page.data[o + 1] = NUM_FG[1];
            page.data[o + 2] = NUM_FG[2];
            page.data[o + 3] = 255;
          }
        }
      }
    }
    x0 += (GLYPH_W + GLYPH_GAP) * scale;
  }
}

/**
 * 一行式题面：每格一个精灵 + 下方编号，整体**居中**在一张固定尺寸的大页上。
 *
 * 为什么页要固定 1440×900、内容只占中间一小块：
 *   任何一个看图器打开 272×96 的小图时都会"缩放到适合窗口"，等于替你放大了 ——
 *   而放大多少取决于对方的窗口，**测试条件就失控了**。把内容放进一张足够大的页里，
 *   fit-to-window 的结果落在 100%（页面本来就装得下），呈现尺寸才是**它自己的像素尺寸**。
 *   窗口比 1440 小时会**缩小**，那只会让测试更严，不会变松。
 *
 * @param items [{ pb, label }]
 * @param zoom  放大倍数。×2 = 2× DPR 手机上的真实可视尺寸（见文件头取舍 5）
 */
function strip(items, zoom, { gap = 12, numBand = 26, numScale = 2, W = 1440, H = 900 } = {}) {
  const cw = Math.max(...items.map((it) => it.pb.w)) * zoom;
  const ch = Math.max(...items.map((it) => it.pb.h)) * zoom;
  const contentW = items.length * cw + (items.length - 1) * gap;
  const contentH = ch + numBand;
  if (contentW > W || contentH > H) throw new Error(`题面 ${contentW}×${contentH} 装不进 ${W}×${H}`);
  const page = newPage(W, H);
  let x = Math.round((W - contentW) / 2);
  const top = Math.round((H - contentH) / 2);
  for (const it of items) {
    // 底对齐：所有格子共用同一条基线，体量差才不会被"居中"吃掉
    const dy = top + (ch - it.pb.h * zoom);
    blitScaled(page, it.pb, x, dy, zoom);
    drawNumber(page, it.label, x + cw / 2, top + ch + 8, numScale);
    x += cw + gap;
  }
  return page;
}

/* ---------------------------------------------------------------- 乱序 */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(arr, r) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 每个被测者一份**独立**顺序，且**不许是原始顺序**（原始顺序 = 教材页顺序 ⇒ 白送答案）。
 * 五个元素只有 120 种排列，撞上原序的概率 1/120 —— 但撞上了就是一次无效测试，
 * 所以这里显式重摇，而不是"概率很小、算了"。
 */
function orderFor(seed, n, identity) {
  const r = rng(seed);
  for (let attempt = 0; attempt < 50; attempt++) {
    const p = shuffled(identity, r);
    if (p.join(',') !== identity.join(',')) return p;
  }
  throw new Error('乱序 50 次都撞上原序 —— 随机源坏了');
}

/* ---------------------------------------------------------------- 主流程 */

mkdirSync(OUT, { recursive: true });

const key = { seed: SEED, testers: TESTERS, generatedFor: '§8.4 同族 5 张并排 / 每人独立乱序', fams: {} };
let wrote = 0;

const write = (name, page) => {
  writeFileSync(join(OUT, name), encodePng(page.w, page.h, page.data));
  wrote += 1;
  return name;
};

const files = [];

for (const fam of FAM_KEYS) {
  const units = FAMS[fam];
  const identity = units.map((_, i) => i);

  /* 教材页：大图（64×56）×2，编号 = 1..5，顺序固定（它就是要被记住的那张表） */
  const study = units.map((u, i) => ({
    pb: buildB0Frame(unitCombatFrame(u.id)),
    label: String(i + 1),
  }));
  files.push(write(`study-${fam}.png`, strip(study, 2, { gap: 20, numBand: 30 })));

  key.fams[fam] = { study: {}, quizzes: {}, quizzes22: {} };
  units.forEach((u, i) => {
    key.fams[fam].study[String(i + 1)] = { id: u.id, cn: u.cn, cls: u.cls };
  });

  for (let t = 1; t <= TESTERS; t++) {
    const perm = orderFor(SEED + t * 7919 + fam.charCodeAt(1) * 104729, units.length, identity);
    // 余量页**必须换一个顺序**：同一个人的两张卷子若同序，做完第一张就等于练过第二张，
    // 22×30 的读数会虚高。换序之后两张卷子可以给同一个人做，互不污染。
    const perm22 = orderFor(SEED + t * 104729 + fam.charCodeAt(1) * 31 + 977, units.length, identity);

    /* 计分页：43×37 ×2 = 兵牌在 2× DPR 手机上的真实可视尺寸（86×74） */
    const q43 = perm.map((idx, cell) => ({
      pb: buildPortraitFrame(unitCombatFrame(units[idx].id), 43, 37),
      label: String(cell + 1),
    }));
    files.push(write(`quiz-${fam}-t${t}.png`, strip(q43, 2, { gap: 10, numBand: 26 })));

    /* 余量页：22×30 ×2（比真实兵牌还小 4 倍面积，看还剩多少余量） */
    const q22 = perm22.map((idx, cell) => ({
      pb: buildPortraitFrame(unitCombatFrame(units[idx].id), 22, 30),
      label: String(cell + 1),
    }));
    files.push(write(`quiz22-${fam}-t${t}.png`, strip(q22, 2, { gap: 14, numBand: 24 })));

    /* 诊断页：×8，**只给主理人**在看懂谁答错之后回查用，不参与计分。
       它跟计分页同序 —— 诊断的对象是"这张卷子上哪一格错了"。 */
    const diag = perm.map((idx, cell) => ({
      pb: buildPortraitFrame(unitCombatFrame(units[idx].id), 22, 30),
      label: String(cell + 1),
    }));
    files.push(write(`diag-${fam}-t${t}.png`, strip(diag, 8, { gap: 24, numBand: 34, numScale: 3 })));

    key.fams[fam].quizzes[`t${t}`] = q43.map((c, i) => ({
      cell: c.label,
      id: units[perm[i]].id,
      cn: units[perm[i]].cn,
      cls: units[perm[i]].cls,
    }));
    key.fams[fam].quizzes22[`t${t}`] = q22.map((c, i) => ({
      cell: c.label,
      id: units[perm22[i]].id,
      cn: units[perm22[i]].cn,
      cls: units[perm22[i]].cls,
    }));
  }
}

/* 跨族题：**同一体形档、不同族的两个兵**成对并排，问"这两个是同一个兵吗"。
 *
 * 题面口径来自 §8 的原文（H3 对照行）：
 *   「同一体形档、不同族的两个兵，在 22×30 下能不能说出『不是同一个』」
 * 所以它不是"把这十张分成两族"（那是聚类题，比它难，也不是规格要问的），
 * 而是五道**判同一性**的题 —— 正确答案永远是"不是"。
 * 答"是"= 两个不同族的兵在剪影上串味了，这才是战场上真会出的事
 * （p1 骑士旁边站着 p4 骷髅）。
 */
if (FAM_KEYS.length === 2) {
  const [fa, fb] = FAM_KEYS;
  const byCls = (fam) => Object.fromEntries(FAMS[fam].map((u) => [u.cls, u]));
  const A = byCls(fa);
  const B = byCls(fb);
  const pairs = FAMS[fa].map((u) => ({ cls: u.cls, a: A[u.cls], b: B[u.cls] }));
  key.pairs = pairs.map((p, i) => ({ pair: String(i + 1), cls: p.cls, a: p.a.id, b: p.b.id, aCn: p.a.cn, bCn: p.b.cn }));

  const Z = 2;
  const sw = 43 * Z;
  const sh = 37 * Z;
  const inner = 6; // 同一对里两个兵之间
  const outer = 46; // 对与对之间
  const W = 1440;
  const H = 900;
  const page = newPage(W, H);
  const contentW = pairs.length * (sw * 2 + inner) + (pairs.length - 1) * outer;
  const contentH = sh + 26;
  let x = Math.round((W - contentW) / 2);
  const top = Math.round((H - contentH) / 2);
  pairs.forEach((p, i) => {
    blitScaled(page, buildPortraitFrame(unitCombatFrame(p.a.id), 43, 37), x, top, Z);
    blitScaled(page, buildPortraitFrame(unitCombatFrame(p.b.id), 43, 37), x + sw + inner, top, Z);
    drawNumber(page, String(i + 1), x + sw + inner / 2, top + sh + 8, 2);
    x += sw * 2 + inner + outer;
  });
  files.push(write('pairs-cross.png', page));
}

/* 旧版 `mixed-10.png`（十张混排、问"哪五个是一族"）**撤掉**：
 * 它考的是聚类，而 §8 的 H3 对照行问的是"两个不同族的兵能不能分开"。
 * 题面比规格难，测出来低了不知道是美术问题还是题出难了 —— 这类题不能进验收。 */

/* ---------------------------------------------------------------- 答案钥 */

const md = [];
md.push(`# 盲测答案钥（**不要给被测者看**）`);
md.push('');
md.push(`- 生成：\`node tools/blindkit.mjs --out=... --testers=${TESTERS} --seed=${SEED}\``);
md.push(`- 种子 \`${SEED}\`：同一种子重跑出同一批题面；换种子 ⇒ 换顺序，**已发出去的卷子就作废**。`);
md.push(`- 每人的顺序**互不相同**，且都**不是**教材页顺序（工具里显式重摇）。`);
md.push('');
for (const fam of FAM_KEYS) {
  const f = key.fams[fam];
  md.push(`## ${fam} 教材页（study-${fam}.png）`);
  md.push('');
  md.push(`| 编号 | 兵 | 体型档 |`);
  md.push(`|---|---|---|`);
  for (const [n, u] of Object.entries(f.study)) md.push(`| ${n} | ${u.cn} | ${u.cls} |`);
  md.push('');
  const emitTable = (title, note, quizzes) => {
    md.push(`### ${title}`);
    md.push('');
    if (note) {
      md.push(`> ${note}`);
      md.push('');
    }
    const ts = Object.keys(quizzes);
    md.push(`| 格子 | ${ts.join(' | ')} |`);
    md.push(`|---|` + ts.map(() => `---`).join(`|`) + `|`);
    for (let cell = 0; cell < 5; cell++) {
      const row = ts.map((t) => {
        const c = quizzes[t][cell];
        return `${c.cn}（${c.cls}）`;
      });
      md.push(`| ${cell + 1} | ${row.join(' | ')} |`);
    }
    md.push('');
  };

  emitTable(
    `计分页答案（quiz-${fam}-tN.png，43×37 = 兵牌真实尺寸）`,
    `\`diag-${fam}-tN.png\` 与本表**同序**（×8 只用于回查这一格为什么错，不计分）。`,
    f.quizzes,
  );
  emitTable(
    `余量页答案（quiz22-${fam}-tN.png，22×30）`,
    `**与本表上方的计分页不是同一个顺序** —— 同一个人可以两张都做，不会因为练过而虚高。`,
    f.quizzes22,
  );
}
if (key.pairs) {
  md.push(`## 跨族题（pairs-cross.png）`);
  md.push('');
  md.push(`五道「这两个是同一个兵吗」，**正确答案永远是"不是"**。`);
  md.push('');
  md.push(`| 对 | 体型档 | 左 | 右 |`);
  md.push(`|---|---|---|---|`);
  for (const p of key.pairs) md.push(`| ${p.pair} | ${p.cls} | ${p.aCn}（${p.a}） | ${p.bCn}（${p.b}） |`);
  md.push('');
}
writeFileSync(join(OUT, 'KEY.md'), md.join('\n'), 'utf8');
writeFileSync(join(OUT, 'key.json'), JSON.stringify(key, null, 2), 'utf8');

console.log(`\n盲测套件 → ${OUT}`);
console.log(`  ${wrote} 张题面/教材 + KEY.md + key.json`);
console.log(`  族：${FAM_KEYS.join(' + ')} · 每人一份独立乱序 · 被测者 ${TESTERS} 人`);
console.log(`  计分页 quiz-* 43×37 ×2（= 2× DPR 真机尺寸）· 余量页 quiz22-* 22×30 ×2`);
console.log(`  诊断页 diag-* 22×30 ×8（**不计分**）· 教材页 study-* 64×56 ×2`);
console.log(`  底色 #2b2f35（iron 浮层近似）· 题面零文字，只有编号 · 页 1440×900 居中`);
