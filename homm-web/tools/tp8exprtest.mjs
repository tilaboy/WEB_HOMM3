#!/usr/bin/env node
/**
 * tp8exprtest.mjs —— TP-8②「手机上表情可读」素材生成器 + 可读性预检。
 * ==========================================================================
 * 用法：
 *   node tools/tp8exprtest.mjs <outDir> [--seed=20261020] [--rounds=3] [--verbose]
 *
 * 产出（outDir 下）：
 *   tp8-expr-E-r{N}.png      盲测素材（**设备像素**）：20 个战斗 idle 帧的**脸窗**，
 *                            按战场真实呈现倍率 k = s × dpr 做**最近邻**重采样后拼 4×5。
 *                            k 不是拍脑袋：s 由 `BattleRenderer.fit()` 的同一套公式在
 *                            792×320@dpr3 上算出（= 0.825），dpr 取旗舰档上限 3。
 *   tp8-expr-Ecss-r{N}.png   参照图（**CSS 像素**）：同一批脸窗按 s=0.825 降采样。
 *                            两张图必须一起看 —— 设备像素够大 ≠ 布局上给的尺寸够大。
 *   tp8-expr-answerkey.md    答案钥（**仅主持人**）：格 → 族/兵种/帧名 + 实测眼嘴几何 + ΔL。
 *   tp8-expr-scoresheet.md   记录表：3 名测试者 × 20 格，判「眼睛和嘴看不看得出来」。
 *   tp8-expr-manifest.txt    素材清单 + 构建绑定（dist 指纹 / seed / k / s）。
 *   tp8-expr-viewer.html     不改像素的查看器（pixelated 1×/2×/3×）。
 *
 * ## 这个探针量什么（以及**不**量什么）
 * 量：20 个 cu_ idle 帧的**表情通道**在帧像素里成不成立，以及经过手机那条
 *     「s=0.825 × dpr3 ⇒ k=2.474 设备像素/美术像素」的最近邻之后还剩几行几列。
 * 不量：表情**语义**（笑/凶/呆）。`face()` 只有 `teeth` 一个变体（平嘴 / 露齿），
 *     所以"看得出在笑还是在凶"这件事**本批无法测**——素材里记成欠账，不假装测过。
 *
 * ## 为什么要用像素检出、而不是读源码里的坐标
 * `face(pb, lx, rx, ey, mouthY, mouthW, teeth)` 的调用点有 30+ 处，坐标是各画师手填的。
 * 读源码坐标 ⇒ 断言只证明"代码里写了 2"，不证明"画出来是 2"。这里直接认像素签名。
 * 这条纪律已经兑付过一次：`cu_p1_oathpike` 的源码写的是 `mouthY=33`，但同一个函数下一行
 * `bigShield(14,33,…)` 从 y33 起画盾面，把 3px 嘴线**整条盖掉** —— 读源码永远看不见这件事，
 * 认像素第一眼就红了。
 *
 * ## 三条表情通道（**声明式**例外）
 *   h3      人形（默认，13 帧）：2×2 ink0 眼 + **右上角** 1px hi0 + 1px ink 嘴线。
 *   glow    构装/火人/亡灵（6 帧）：2×2 **同色 emissive** 眼，无 hi0（§1.4「唯一高光」不适用），
 *           嘴线可有可无（实测只有熔岩巨魔有，且是 stone0 而非 ink0）。
 *   profile 侧脸（1 帧，独角兽）：只画**一只**眼。
 * 例外必须在 `FACE_LAW` 里逐条写明理由，并断言三档帧数（13/6/1）。没声明的帧一律按 h3 判
 * ⇒ 新兵种画歪会立刻红，而不是被悄悄当成"例外"放过。这条也是为了堵「把尺子改成能过」：
 * 想让一帧走 glow/profile，必须在这里落一行字，review 时看得见。
 *
 * ## 负向对照（项目纪律：新闸必须能红）
 *   ① `face()` 的 hi0 从右上角挪到左上（`lx+1` → `lx`）⇒ 全部 h3 帧认不出眼 ⇒ [Law] 红。
 *   ② 把 `cu_p1_oathpike` 的 `face(...,30,32,...)` 改回 `33`（重组 bug）⇒ [Mouth] 红。
 *   ③ 把 `FACE_LAW` 里一行 `glow` 删掉（冒充默认 h3）⇒ [Law] 红。
 * 三条都实测过，见 manifest 的 `negctrl` 段与 `production/tp9/tp8/README.md`。
 *
 * 零新增依赖：node:zlib + ./_dist.mjs。
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { distDir, distUrl, printHeader, requireFile, argOf } from './_dist.mjs';

const DIST = distDir();
const FP = printHeader(DIST, 'tool=tp8exprtest');
requireFile(DIST, 'render/unitArt.js');
const art = await import(distUrl('render/unitArt.js', DIST));
const { UNIT_FRAMES, buildB0Frame, B0_PALETTE } = art;

/* ---------------------------------------------------------------- 参数 */

const OUT = process.argv[2] ?? '/tmp/tp8-expr';
const SEED = Number(argOf('seed', 20261020));
const ROUNDS = Math.max(1, Number(argOf('rounds', 3)));
const VERBOSE = process.argv.includes('--verbose');
const TRACE = argOf('trace', '');

/**
 * 手机口径（**逐字复刻**两处源码，改一处就要回来改这里）：
 *   `BattleRenderer.ts:18-19`  BASE_W = 591 + PAD*2、BASE_H = 376 + PAD*2（PAD=6）⇒ 603 × 388
 *   `BattleRenderer.ts:114-120` s = clamp(min(availW/BASE_W, availH/BASE_H), 0.6, 4)，整数倍优先
 *   `quality.ts` 旗舰档 dprCap = 3
 * 取 792×320 CSS（项目既有"真机口径"）⇒ raw = min(1.313, 0.825) = 0.825。
 * 注意 s < 1：**战场在手机上是被缩小的**，不是放大的 —— 这正是"表情可读"值得单独量一次的原因。
 */
const VIEW = { w: 792, h: 320, dpr: 3, baseW: 603, baseH: 388 };

function fitScale(vw, vh) {
  const raw = Math.min(vw / VIEW.baseW, vh / VIEW.baseH);
  let s = Math.min(4, Math.max(0.6, raw));
  const fl = Math.floor(s);
  if (fl >= 1 && s / fl <= 1.12) s = fl;
  return s;
}
const S = fitScale(VIEW.w, VIEW.h);
const DPR = VIEW.dpr;
const K = S * DPR; // 每个美术像素占多少**设备像素**

/* ---------------------------------------------------------------- 常量 */

const FACTION_CN = { p1: '晨曦', p2: '赤焰', p3: '翠林', p4: '紫晶' };
const UNIT_CN = {
  p1_lampbearer: '提灯侍从', p2_scavenger: '捡破烂小鬼', p3_dwarf: '浇水矮人', p4_stoneimp: '石雕小怪',
  p1_hornxbow: '号角弩手', p2_axethrower: '投斧蛮子', p3_thornarcher: '荆棘射手', p4_fireapprentice: '喷火学徒',
  p1_oathpike: '铁誓枪兵', p2_wolfrider: '暴走狼骑', p3_vineguard: '藤蔓卫士', p4_hopgolem: '蹦跳魔偶',
  p1_templar: '圣殿骑士', p2_firebrand: '火油狂徒', p3_treant: '树人大叔', p4_librarian: '亡灵图书管理员',
  p1_overangel: '加班天使', p2_lavatroll: '熔岩巨魔', p3_unicorn: '独角兽园丁', p4_colossus: '失控大魔像',
};
/** 中立怪不是"人类单位"，H3 对兽类的要求是 2px 眼白 + 1px 瞳孔，本批**不进人类闸**。 */
const NEUTRAL = new Set(['cu_wolf', 'cu_boar', 'cu_ogre']);

/**
 * 声明式例外表（键 = cu_ 帧名）。没在表里的帧一律按 h3 判。
 * 值 = [通道, 理由]。理由必须写清"为什么它的脸不是 h3 那张脸"，否则以后没人敢动这张表。
 */
const FACE_LAW = {
  cu_p4_stoneimp: ['glow', '构装：glowEye 画 2×2 p4emissive（§1.4「唯一高光」不适用），石像兽无嘴'],
  cu_p4_fireapprentice: ['glow', '火人：面就是火，2×2 p4emissive 眼，无嘴'],
  cu_p4_hopgolem: ['glow', '魔偶：2×2 p4emissive 眼，无嘴'],
  cu_p4_librarian: ['glow', '亡灵：眼窝是发光点（无 hi0），无嘴'],
  cu_p4_colossus: ['glow', '大魔像：2×2 p4emissive 眼，无嘴'],
  cu_p2_lavatroll: ['glow', '熔岩巨魔：2×2 p2emissive 眼 + 1px×9 stone0 嘴线（大地精体量，嘴在眼下 6 行）'],
  cu_p3_unicorn: ['profile', '侧脸母题（§5.6.4 兽形）：只画一只眼，无独立嘴线'],
};
/** 三档帧数（写死 ⇒ 谁想偷偷把一个单位挪进例外，得同时改这三个数并在 review 里解释）。 */
const CH_COUNT = { h3: 13, glow: 6, profile: 1 };

const BG = [208, 208, 208, 255]; // 与 ① 同底景（L=208），便于两批素材并排看
const CELL_W = 52;
const CELL_H = 42;
const GAP = 8;
const COLS = 5;
const ROWS = 4;

/** H3 口径（cartoon-style.md §4 / §1.4）：眼 ≥2px、嘴线 1px。 */
const EYE_MIN = 2;
const MOUTH_MIN_W = 3;
const MOUTH_MAX_W = 12; // 嘴是"短横线"；长横线是甲片/衣褶，不是嘴
const MOUTH_MAX_DY = 8; // 眼下多少行内算嘴：人形实测 2~4，T5 巨人 7（熔岩巨魔）
/** 声明"有嘴"的 glow 帧。h3 恒有嘴、profile 恒无嘴；glow 里只有熔岩巨魔画了嘴线。 */
const GLOW_MOUTH = new Set(['cu_p2_lavatroll']);
const GAP_MAX = 8; // 两眼间距上限（归一化放大后 firebrand 实测 7）
/**
 * ΔE76 门槛。为什么是 20：
 *   b0audit 断言 8 的 ΔL≥12 是**相邻材质**地板（大面积、只需"不是同一块布"）；
 *   这里要认的是 1px 高的小特征，在 k=2.474 下只剩 2~3 设备像素，需要更硬的色差。
 *   实测分布（见 [Contr] 输出）：眼 45.8~114.4、嘴 21.4~76.9。20 落在"真实特征最低值"
 *   与"同材质特征"（ΔE 通常 <10）之间的空档里 ⇒ 它只在"特征和底色是同一块材料"时红，
 *   不会因为"刚好压线"天天响。这是本项目第一次给 1px 小特征定阈值，写在这里免得被当魔法数。
 *   用 ΔE 不用 ΔL 的理由见 labOf 注释（发光眼是黄色压灰石，ΔL 只有 19.4）。
 */
const CONTRAST_MIN = 20;

/* ------------------------------------------------------- 零依赖 PNG 编码 */
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

/* ---------------------------------------------------------------- 色彩 */

/** CIE L*（与 b0audit / tp8blindtest 同口径）。 */
function lstar(r, g, b) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const y = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}
const hexOf = (e) => e.hex ?? e;
const PAL = new Map(B0_PALETTE.map((e) => [hexOf(e).toLowerCase(), e.family]));
const INK0 = hexOf(B0_PALETTE.find((e) => e.family === 'ink0')).toLowerCase();
const HI0 = hexOf(B0_PALETTE.find((e) => e.family === 'hi0')).toLowerCase();
const EMISSIVE = new Set(B0_PALETTE.filter((e) => /emissive/.test(e.family)).map((e) => hexOf(e).toLowerCase()));
const rgbOfHex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const hexOfPx = (p) => '#' + [p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
const famOf = (h) => PAL.get(h.toLowerCase()) ?? '??';
const LofHex = (h) => {
  const [r, g, b] = rgbOfHex(h);
  return lstar(r, g, b);
};
const dL = (a, b) => Math.abs(LofHex(a) - LofHex(b));

/**
 * sRGB → CIE Lab(D65)。为什么这里用 **ΔE** 而不是 ΔL：
 * 紫晶/赤焰的发光眼是"亮黄压在灰石上"（#ffd06a ↔ #a9a093），ΔL 只有 19.4，
 * 但色相/彩度差极大 —— 单看明度会把它误判成"看不见"，而人眼一眼就能认出那两颗黄点。
 * 材质闸（b0audit 断言 2/8）用 ΔL 是因为相邻材质通常同色相；表情特征不能套用同一把尺。
 */
function labOf(h) {
  const [r, g, b] = rgbOfHex(h);
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = f(r);
  const G = f(g);
  const B = f(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const g2 = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27) * t / 116 + 16 / 116);
  const fx = g2(X);
  const fy = g2(Y);
  const fz = g2(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** CIE76 ΔE（够用：本项目只判"分不分得开"，不做色差匹配）。 */
const dE = (a, b) => {
  const [l1, a1, b1] = labOf(a);
  const [l2, a2, b2] = labOf(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

/* ---------------------------------------------------------------- 检出 */

/**
 * 眼块候选。两种签名，都是 2×2：
 *   ink   : (x,y) ink0 ∧ (x+1,y) hi0 ∧ 下排两像素 ink0 ⇒ `face()` 的产物
 *   glow  : 四像素**同色** ∧ 该色属于 emissive 家族 ⇒ `glowEye()` / 手绘发光眼
 * ink 签名同时守住「高光只此一处、只在眼的右上角」（§1.4）。
 *
 * 重叠去重：发光眼常是 3×3 / 4×2（glowEye 会叠两层），一个眼块能扫出好几个 2×2 窗口。
 * 不去重的话"同一行有 2~3 对眼"会把好帧判成歧义（实测 librarian / colossus）。
 * 合并规则：同一行内 x 相距 ≤2 的候选视为同一只眼，只留最左那个窗口。
 */
function eyeBlocks(pb, kind) {
  const raw = [];
  for (let y = 0; y < pb.h - 1; y++) {
    for (let x = 0; x < pb.w - 1; x++) {
      const a = pb.px(x, y);
      const b = pb.px(x + 1, y);
      const c = pb.px(x, y + 1);
      const d = pb.px(x + 1, y + 1);
      const ha = hexOfPx(a);
      const hb = hexOfPx(b);
      if (kind === 'ink') {
        if (ha === INK0 && hb === HI0 && hexOfPx(c) === INK0 && hexOfPx(d) === INK0) raw.push({ x, y, color: INK0 });
      } else {
        const hc = hexOfPx(c);
        const hd = hexOfPx(d);
        if (EMISSIVE.has(ha) && hb === ha && hc === ha && hd === ha) raw.push({ x, y, color: ha });
      }
    }
  }
  const out = [];
  for (const b of raw) {
    const dup = out.some((o) => o.y === b.y && o.color === b.color && Math.abs(o.x - b.x) <= 2);
    if (!dup) out.push(b);
  }
  return out;
}

/** 配成一对：同一行、间距 1..GAP_MAX、颜色一致；取最上面那一行，且该行只能有一对。 */
function pairEyes(eyes, kind) {
  const pairs = [];
  for (let i = 0; i < eyes.length; i++) {
    for (let j = i + 1; j < eyes.length; j++) {
      const A = eyes[i];
      const B = eyes[j];
      if (A.y !== B.y) continue;
      if (kind === 'glow' && A.color !== B.color) continue;
      const gap = B.x - (A.x + EYE_MIN);
      if (gap < 1 || gap > GAP_MAX) continue;
      pairs.push({ l: A, r: B, gap });
    }
  }
  if (pairs.length === 0) return { ok: false, reason: `眼对数 = 0（候选 ${eyes.length} 块）` };
  // **取最上面那一对**：`face(..., teeth=true)` 会在嘴线上也画两个 hi0，牙齿常凑出
  // 一个"像眼睛"的 2×2。脸的结构是"眼在上、嘴在下"，所以 y 最小的那对才是眼睛；
  // 若最小 y 上有多对（同一行两对眼），说明构图有歧义 ⇒ 判失败，不猜。
  const minY = Math.min(...pairs.map((p) => p.l.y));
  const top = pairs.filter((p) => p.l.y === minY);
  if (top.length !== 1) return { ok: false, reason: `最上一行有 ${top.length} 对眼（歧义）` };
  return { ok: true, ...top[0] };
}

/** 眼块正下方的局部"皮肤色"：2×2 外圈 8 邻里最常见的、既非眼也非高光的颜色。 */
function skinNear(pb, eye, exclude) {
  const hist = new Map();
  for (let dy = -1; dy <= EYE_MIN; dy++) {
    for (let dx = -1; dx <= EYE_MIN; dx++) {
      const inner = dx >= 0 && dx < EYE_MIN && dy >= 0 && dy < EYE_MIN;
      if (inner) continue;
      const x = eye.x + dx;
      const y = eye.y + dy;
      if (!pb.inBounds(x, y)) continue;
      const p = pb.px(x, y);
      if (p[3] !== 255) continue;
      const h = hexOfPx(p);
      if (h === exclude || h === HI0 || EMISSIVE.has(h)) continue;
      hist.set(h, (hist.get(h) ?? 0) + 1);
    }
  }
  let best = null;
  for (const [k, n] of hist) if (!best || n > best.n) best = { hex: k, n };
  return best?.hex ?? null;
}

/**
 * 嘴线：眼下 1..MOUTH_MAX_DY 行里的一条 **1px 高横线**。
 * 两条通道两种认法，因为两种画法本来就不同：
 *   ink 通道（h3/profile）：数 ink0 横线。**不能要求"连续单色"** —— `face(..., teeth=true)`
 *       的牙是夹在嘴里的 1px 高光，会把 ink 切成两段（实测 scavenger / axethrower）。
 *       所以判据 = 窗口内 ink 像素 ≥3、跨度 3..14、起点落在左眼附近、上下行都没这么宽。
 *   glow 通道（构装/巨人）：这类单位本来可以没有嘴；有的话是**同材质深色短横线**
 *       （熔岩巨魔 = stone0 压在 stone 身上），所以判据换成"有界单色短横线且不等于脸的颜色"。
 * `mouthY` 由画师手填，本函数不信它 —— 只信像素。
 */
function findMouth(pb, eyeTopY, l, r, eyeColor, faceColor, label) {
  const inkish = (h) => h === INK0 || h === HI0;
  const xa = Math.max(0, l.x - 3);
  const xb = Math.min(pb.w - 1, (r ? r.x : l.x + EYE_MIN) + 5);
  for (let y = eyeTopY + EYE_MIN; y <= eyeTopY + MOUTH_MAX_DY; y++) {
    if (y >= pb.h) break;

    if (eyeColor === INK0) {
      // ink 通道：找**有界**的 ink 段（露齿时牙是 hi0，仍在段内），且起点必须落在左眼正下方。
      // "起点落在左眼附近" 是排除"头部轮廓底线"的关键 —— 轮廓行从头的左边缘起画，
      // 宽度也可能 ≤14，但它的起点离左眼很远（实测 dwarf：轮廓 x23 起，左眼 x33）。
      const runs = [];
      let x = xa;
      while (x <= xb) {
        if (!inkish(hexOfPx(pb.px(x, y)))) {
          x++;
          continue;
        }
        let e = x;
        while (e + 1 <= xb && inkish(hexOfPx(pb.px(e + 1, y)))) e++;
        runs.push({ x, e, w: e - x + 1 });
        x = e + 1;
      }
      for (const r of runs) {
        const boundedL = r.x - 1 >= 0 && !inkish(hexOfPx(pb.px(r.x - 1, y)));
        const boundedR = r.e + 1 < pb.w && !inkish(hexOfPx(pb.px(r.e + 1, y)));
        const nearEye = r.x >= l.x - 1 && r.x <= l.x + 2;
        const tr = (m) =>
          TRACE &&
          (TRACE === label || TRACE === CUR || TRACE === '*') &&
          console.log(`      [trace] y=${y} run ${r.x}..${r.e} w=${r.w} l.x=${l.x} → ${m}`);
        if (!(boundedL && boundedR)) {
          tr('拒：左右不是非 ink（连到轮廓）');
          continue;
        }
        if (!nearEye) {
          tr('拒：起点离左眼太远');
          continue;
        }
        if (r.w < MOUTH_MIN_W || r.w > MOUTH_MAX_W + 2) {
          tr(`拒：宽 ${r.w} 不在 ${MOUTH_MIN_W}..${MOUTH_MAX_W + 2}`);
          continue;
        }
        // 厚度：在嘴中点上下各看 1px。**允许到 2**，因为归一化对"需要放大"的精灵是
        // 最近邻复制 ⇒ 原本 1px 的嘴线会变成 2px（实测 vineguard，源码里确实只画 1px）。
        // 3px 及以上才判"这是甲沿/衣褶，不是嘴"。
        const mx = r.x + (r.w >> 1);
        const upInk = y > 0 && inkish(hexOfPx(pb.px(mx, y - 1)));
        const dnInk = y + 1 < pb.h && inkish(hexOfPx(pb.px(mx, y + 1)));
        const thick = 1 + (upInk ? 1 : 0) + (dnInk ? 1 : 0);
        if (thick > 2) {
          tr(`拒：厚度 ${thick}px（>2 是甲沿/衣褶）`);
          continue;
        }
        tr(`收 w=${r.w} h=${thick} dy=${y - eyeTopY}`);
        return {
          x: r.x,
          y,
          w: r.w,
          h: thick,
          color: INK0,
          skin: boundedL ? hexOfPx(pb.px(r.x - 1, y)) : hexOfPx(pb.px(r.e + 1, y)),
          skinR: boundedR ? hexOfPx(pb.px(r.e + 1, y)) : null,
          dy: y - eyeTopY,
        };
      }
      continue;
    }

    // glow 通道：有界单色短横线，且不是脸的颜色
    let x = xa;
    while (x <= xb) {
      const c = hexOfPx(pb.px(x, y));
      let e = x;
      while (e + 1 <= xb && hexOfPx(pb.px(e + 1, y)) === c) e++;
      const w = e - x + 1;
      // 邻居必须**不透明**：alpha=0 的像素会被读成 #000000，被当成"另一种颜色"，
      // 而它其实是画布外的空气（实测 librarian 的假嘴就是围着一块透明区）。
      const at = (xx, yy) => (pb.inBounds(xx, yy) && pb.px(xx, yy)[3] === 255 ? hexOfPx(pb.px(xx, yy)) : null);
      const left = at(x - 1, y);
      const right = at(e + 1, y);
      const mx = x + (w >> 1);
      const up = at(mx, y - 1);
      const dn = at(mx, y + 1);
      const ok =
        w >= MOUTH_MIN_W &&
        w <= MOUTH_MAX_W &&
        left !== null &&
        right !== null &&
        left !== c &&
        right !== c &&
        c !== eyeColor &&
        c !== HI0 &&
        c !== faceColor &&
        up !== c &&
        dn !== c &&
        x <= l.x + 2;
      if (TRACE && (TRACE === label || TRACE === CUR || TRACE === '*')) {
        console.log(
          `      [trace] y=${y} run ${x}..${e} w=${w} c=${c} L=${left} R=${right} face=${faceColor}` +
            ` up=${up} dn=${dn} → ${ok ? '收' : '拒'}`,
        );
      }
      if (ok) return { x, y, w, h: 1, color: c, skin: left, skinR: right, dy: y - eyeTopY };
      x = e + 1;
    }
  }
  return null;
}

/** 整帧认脸：按声明通道选眼签名，再配眼、找嘴。 */
function findFace(pb, kind) {
  // 通道 → 眼签名：h3 与 profile 都认 ink 眼（profile 只是少一只）；只有 glow 换发光签名。
  const eyeKind = kind === 'glow' ? 'glow' : 'ink';
  const eyes = eyeBlocks(pb, eyeKind);
  const faceColorOf = (e) => skinNear(pb, e, e.color);
  if (kind === 'profile') {
    if (eyes.length !== 1) return { ok: false, reason: `侧脸应恰有 1 只眼，实得 ${eyes.length}`, eyes };
    const e = eyes[0];
    const mouth = findMouth(pb, e.y, e, e, INK0, faceColorOf(e), kind);
    return { ok: true, kind, single: e, l: e, r: null, gap: null, mouth, eyes };
  }
  const p = pairEyes(eyes, eyeKind);
  if (!p.ok) return { ok: false, reason: p.reason, eyes };
  const mouth = findMouth(pb, p.l.y, p.l, p.r, p.l.color, faceColorOf(p.l), kind);
  return { ok: true, kind, l: p.l, r: p.r, gap: p.gap, mouth, eyes };
}

/** 脸窗（美术像素），把嘴也算进去并留 1 圈余量。 */
function faceBox(f, w, h) {
  const left = f.l.x;
  const right = f.r ? f.r.x : f.l.x + EYE_MIN;
  const x0 = Math.max(0, left - 5);
  const y0 = Math.max(0, f.l.y - 4);
  const x1 = Math.min(w, Math.max(right + 6, f.mouth ? f.mouth.x + f.mouth.w + 2 : right + 6));
  const y1 = Math.min(h, (f.mouth ? f.mouth.y : f.l.y + EYE_MIN) + 4);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 最近邻重采样（`imageSmoothingEnabled = false` 的等价实现）。k = 设备像素/美术像素。 */
function resampleNN(pb, box, k) {
  const dw = Math.max(1, Math.round(box.w * k));
  const dh = Math.max(1, Math.round(box.h * k));
  const rgba = new Uint8ClampedArray(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) {
    const sy = box.y + Math.min(box.h - 1, Math.floor(dy / k));
    for (let dx = 0; dx < dw; dx++) {
      const sx = box.x + Math.min(box.w - 1, Math.floor(dx / k));
      const s = pb.px(sx, sy);
      const o = (dy * dw + dx) * 4;
      rgba[o] = s[0];
      rgba[o + 1] = s[1];
      rgba[o + 2] = s[2];
      rgba[o + 3] = s[3];
    }
  }
  return { w: dw, h: dh, rgba };
}

/** 眼块经过 k 倍最近邻之后，在设备像素里还剩几行几列仍是"眼"的颜色。 */
function eyeSurvival(pb, eye, k, kind) {
  const x0 = Math.floor(eye.x * k);
  const x1 = Math.ceil((eye.x + EYE_MIN) * k);
  const y0 = Math.floor(eye.y * k);
  const y1 = Math.ceil((eye.y + EYE_MIN) * k);
  const rows = new Set();
  const cols = new Set();
  for (let dy = y0; dy < y1; dy++) {
    for (let dx = x0; dx < x1; dx++) {
      const sx = Math.min(pb.w - 1, Math.floor(dx / k));
      const sy = Math.min(pb.h - 1, Math.floor(dy / k));
      const p = pb.px(sx, sy);
      const h = p[3] === 255 ? hexOfPx(p) : null;
      const ok = kind === 'ink' ? h === INK0 || h === HI0 : h === eye.color;
      if (ok) {
        rows.add(dy);
        cols.add(dx);
      }
    }
  }
  return { rows: rows.size, cols: cols.size, w: x1 - x0, h: y1 - y0 };
}

/* ---------------------------------------------------------------- 采集 */

const frames = UNIT_FRAMES.map((f) => f.name).filter((n) => n.startsWith('cu_') && !n.endsWith('_atk') && !NEUTRAL.has(n));
const rows = [];
const bad = [];
const say = (id, title, pass, detail) => {
  rows.push({ id, title, pass, detail });
  console.log(`  ${pass ? '✅' : '❌'} ${title}${detail ? ` — ${detail}` : ''}`);
  if (!pass) bad.push(id);
};

console.log(`\n口径：792×320 CSS @ dpr${DPR} ⇒ s=${S.toFixed(3)}、k=${K.toFixed(3)} 设备像素/美术像素`);
console.log(`      （s<1：战场在手机上是**缩小**呈现的；这就是本项要单独量一次的原因）`);

/* [Law] 声明表自洽 + 逐帧认脸 */
console.log('\n[Law] 表情通道（默认 h3；例外必须声明）');
const lawBad = [];
for (const k of Object.keys(FACE_LAW)) {
  if (!frames.includes(k)) lawBad.push(`${k} 不是 cu_ idle 帧（表里写错名字了？）`);
}
const declaredCount = { h3: frames.length - Object.keys(FACE_LAW).length, glow: 0, profile: 0 };
for (const v of Object.values(FACE_LAW)) declaredCount[v[0]] = (declaredCount[v[0]] ?? 0) + 1;
const countOk = Object.entries(CH_COUNT).every(([k, n]) => declaredCount[k] === n);
say(
  'Law:table',
  `声明表自洽：h3/glow/profile = ${declaredCount.h3}/${declaredCount.glow}/${declaredCount.profile}` +
    `（应为 ${CH_COUNT.h3}/${CH_COUNT.glow}/${CH_COUNT.profile}）`,
  lawBad.length === 0 && countOk,
  lawBad.join('；'),
);
if (lawBad.length) for (const m of lawBad) say(`Law:key:${m}`, m, false, '');

const faces = [];
let CUR = '';
for (const name of frames) {
  CUR = name;
  const kind = FACE_LAW[name]?.[0] ?? 'h3';
  const pb = buildB0Frame(name);
  const f = findFace(pb, kind);
  const box = f.ok ? faceBox(f, pb.w, pb.h) : null;
  faces.push({ name, pb, f, box, kind });
  if (!f.ok) say(`Law:${name}`, `${name} 认不出脸（${kind} 通道：${f.reason}）`, false, '');
}
const okFaces = faces.filter((r) => r.f.ok);
say('Law', `${frames.length} 个 cu_ idle 帧都认出 1 张脸`, okFaces.length === frames.length, `${okFaces.length}/${frames.length}`);

/* [Eye] 眼块几何 */
console.log('\n[Eye] 眼块几何');
let eyeBad = 0;
for (const r of okFaces) {
  const e = eyeSurvival(r.pb, r.f.l, 1, r.kind);
  const pairOk = r.kind === 'profile' ? true : r.f.gap >= 1;
  const ok = e.cols === EYE_MIN && e.rows === EYE_MIN && pairOk;
  if (!ok) {
    eyeBad++;
    say(`Eye:${r.name}`, `${r.name} 眼块不合 H3`, false, `${e.cols}×${e.rows} gap=${r.f.gap}`);
  }
}
say('Eye', '每只眼都是 2×2（间距 ≥1，不粘成一条）', eyeBad === 0, `${okFaces.length - eyeBad}/${okFaces.length}`);

/* [Mouth] 嘴线 */
console.log('\n[Mouth] 嘴线');
let mouthBad = 0;
for (const r of okFaces) {
  const m = r.f.mouth;
  const required = r.kind === 'h3' || GLOW_MOUTH.has(r.name); // profile 恒无嘴；glow 只有声明的那帧要有
  // h ≤ 2：源码里 mouth 恒为 1px（`face()` 只有一条 `rect(...,1,...)`），
  // 但"需要放大"的精灵在归一化里被最近邻复制，最终帧上会看到 2px —— 那是放大痕迹，不是画错。
  const shapeOk = m ? m.h <= 2 && m.w >= MOUTH_MIN_W && m.dy >= 1 && m.dy <= MOUTH_MAX_DY : false;
  if (required && !shapeOk) {
    mouthBad++;
    say(`Mouth:${r.name}`, `${r.name} 嘴线不合 H3`, false, m ? `w=${m.w} h=${m.h} dy=${m.dy}` : '缺嘴');
  } else if (!required && m && !shapeOk) {
    mouthBad++;
    say(`Mouth:${r.name}`, `${r.name} 有嘴但形状不合（有就必须合）`, false, `w=${m.w} h=${m.h} dy=${m.dy}`);
  }
}
const h3n = okFaces.filter((r) => r.kind === 'h3').length;
say(
  'Mouth',
  `嘴线：1~2 行高、${MOUTH_MIN_W}~${MOUTH_MAX_W + 2} 宽、在眼下 1~${MOUTH_MAX_DY} 行（h3 恒有 / glow 仅声明帧 / profile 无）`,
  mouthBad === 0,
  `${h3n} 个 h3 帧 · ${mouthBad} 红`,
);

/* [Contr] 局部对比 */
console.log('\n[Contr] 眼/嘴 vs 紧邻颜色（ΔE76）');
let contrBad = 0;
for (const r of okFaces) {
  const f = r.f;
  r.eyeSkin = skinNear(r.pb, f.l, f.l.color);
  r.eyeDL = r.eyeSkin ? dE(f.l.color, r.eyeSkin) : 0;
  // 嘴的对比取**左右两侧较差的那一边**：只有一侧分得开不算分得开。
  r.mouthDL = f.mouth?.skin
    ? Math.min(dE(f.mouth.color, f.mouth.skin), f.mouth.skinR ? dE(f.mouth.color, f.mouth.skinR) : Infinity)
    : null;
  const min = Math.min(r.eyeDL, r.mouthDL ?? Infinity);
  r.dL = min;
  if (!(min >= CONTRAST_MIN)) {
    contrBad++;
    say(
      `Contr:${r.name}`,
      `${r.name} 特征与紧邻颜色分不开`,
      false,
      `眼 ΔE=${r.eyeDL.toFixed(1)}（${f.l.color}↔${r.eyeSkin ?? '无'}）` +
        (r.mouthDL !== null ? ` · 嘴 ΔE=${r.mouthDL.toFixed(1)}（${f.mouth.color}↔${f.mouth.skin}）` : ''),
    );
  } else if (VERBOSE || r.mouthDL !== null) {
    console.log(
      `     ${r.name.padEnd(22)} 眼 ${r.eyeDL.toFixed(1)}` +
        (r.mouthDL !== null ? ` · 嘴 ${r.mouthDL.toFixed(1)}（${famOf(f.mouth.color)}）` : ' · 无嘴'),
    );
  }
}
const sorted = okFaces.map((r) => r.dL).sort((a, b) => a - b);
say(
  'Contr',
  `最小 ΔE76 ≥ ${CONTRAST_MIN}`,
  contrBad === 0,
  `最低 ${sorted[0].toFixed(1)} · 次低 ${sorted[1].toFixed(1)} · 中位 ${sorted[sorted.length >> 1].toFixed(1)}`,
);

/* [Phone] 设备像素里还剩几行几列 */
console.log('\n[Phone] 手机呈现（最近邻，k=' + K.toFixed(3) + '）');
let phoneBad = 0;
for (const r of okFaces) {
  const a = eyeSurvival(r.pb, r.f.l, K, r.kind);
  const b = r.f.r ? eyeSurvival(r.pb, r.f.r, K, r.kind) : a;
  r.dev = { l: a, r: b };
  const ok = Math.min(a.rows, b.rows) >= 2 && Math.min(a.cols, b.cols) >= 2;
  if (!ok) {
    phoneBad++;
    say(`Phone:${r.name}`, `${r.name} 眼块在设备像素里塌了`, false, `${a.cols}×${a.rows}`);
  }
}
const devSizes = okFaces.flatMap((r) => [r.dev.l, r.dev.r]);
say(
  'Phone',
  '眼块在设备像素里仍 ≥2×2（没被采样掉一行/一列）',
  phoneBad === 0,
  `最小 ${Math.min(...devSizes.map((d) => d.cols))}×${Math.min(...devSizes.map((d) => d.rows))} 设备px` +
    `（≈${(EYE_MIN * S).toFixed(2)} CSS px）`,
);

/* ---------------------------------------------------------------- 素材 */

// 盲测顺序：每轮独立洗牌（同一个 seed 家族，可复现）
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
const shuffle = (arr, rand) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function compose(cells, k) {
  const W = COLS * CELL_W + (COLS + 1) * GAP;
  const H = ROWS * CELL_H + (ROWS + 1) * GAP;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) rgba.set(BG, i * 4);
  cells.forEach((c, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const ox = GAP + col * (CELL_W + GAP);
    const oy = GAP + row * (CELL_H + GAP);
    const img = resampleNN(c.pb, c.box, k);
    const dx = ox + Math.floor((CELL_W - img.w) / 2);
    const dy = oy + Math.floor((CELL_H - img.h) / 2);
    for (let y = 0; y < img.h; y++) {
      for (let x = 0; x < img.w; x++) {
        const s = (y * img.w + x) * 4;
        if (img.rgba[s + 3] === 0) continue;
        const t = ((dy + y) * W + (dx + x)) * 4;
        rgba[t] = img.rgba[s];
        rgba[t + 1] = img.rgba[s + 1];
        rgba[t + 2] = img.rgba[s + 2];
        rgba[t + 3] = 255;
      }
    }
  });
  return { W, H, rgba, png: encodePng(W, H, rgba) };
}

mkdirSync(OUT, { recursive: true });
const files = [];
const answerRows = [];
const roundMeta = [];
for (let r = 1; r <= ROUNDS; r++) {
  const order = shuffle(okFaces, rng(SEED + r * 7919));
  const dev = compose(order.map((f) => ({ pb: f.pb, box: f.box })), K);
  const css = compose(order.map((f) => ({ pb: f.pb, box: f.box })), S);
  const devName = `tp8-expr-E-r${r}.png`;
  const cssName = `tp8-expr-Ecss-r${r}.png`;
  writeFileSync(join(OUT, devName), dev.png);
  writeFileSync(join(OUT, cssName), css.png);
  files.push(devName, cssName);
  roundMeta.push({ r, order: order.map((f) => f.name) });
  if (r === 1) {
    order.forEach((f, idx) => {
      answerRows.push({
        cell: `${Math.floor(idx / COLS) + 1}-${(idx % COLS) + 1}`,
        name: f.name,
        unit: UNIT_CN[f.name.replace(/^cu_/, '')] ?? f.name,
        faction: FACTION_CN[f.name.split('_')[1]] ?? '?',
        kind: f.kind,
        eye: `${f.f.l.x},${f.f.l.y}`,
        gap: f.f.gap ?? '—',
        mouth: f.f.mouth ? `${f.f.mouth.color} w=${f.f.mouth.w} dy=${f.f.mouth.dy}` : '—',
        eyeDL: f.eyeDL.toFixed(1),
        mouthDL: f.mouthDL === null ? '—' : f.mouthDL.toFixed(1),
        dev: `${f.dev.l.cols}×${f.dev.l.rows}`,
      });
    });
  }
}
say('Mat', `${ROUNDS} 轮素材都生成了（设备像素 + CSS 像素两版）`, files.length === ROUNDS * 2, files.join(' / '));

/* ---------------------------------------------------------------- 文档 */

const answer = `# TP-8② 手机表情可读 · 答案钥（**仅主持人**）

- 口径：792×320 CSS @ dpr${DPR} ⇒ 战场缩放 **s=${S.toFixed(3)}**、设备像素/美术像素 **k=${K.toFixed(3)}**
- 素材：\`tp8-expr-E-r{N}.png\`（**设备像素**，手机上的物理像素）· \`tp8-expr-Ecss-r{N}.png\`（**CSS 像素**，布局给的尺寸）
- 判据（H3）：眼睛 ≥2px、嘴线 1px；眼块为 2×2、右上角 1px 高光；两眼间距 ≥1
- 通道：\`h3\` 人形 · \`glow\` 构装/火人/亡灵（2×2 同色 emissive，无高光）· \`profile\` 侧脸（单眼）
- ⚠️ 本批**不测"笑/凶"语义**：\`face()\` 只有 \`teeth\` 一个变体，语义区分度不足（记欠账）

## Round 1（其余轮次的排列见 manifest）

| 格 | 帧 | 通道 | 族 | 兵种 | 左眼(x,y) | 眼距 | 嘴 | 眼 ΔL* | 嘴 ΔL* | 设备像素眼块 |
|---|---|---|---|---|---|---|---|---|---|---|
${answerRows
  .map(
    (a) =>
      `| ${a.cell} | \`${a.name}\` | ${a.kind} | ${a.faction} | ${a.unit} | ${a.eye} | ${a.gap} | ${a.mouth} | ${a.eyeDL} | ${a.mouthDL} | ${a.dev} |`,
  )
  .join('\n')}

## 机器预检（本文件生成时实测）

| 闸 | 判据 | 结果 |
|---|---|---|
${rows
  .filter((r) => !r.id.includes(':'))
  .map((r) => `| ${r.id} | ${r.title} | ${r.pass ? '✅' : '❌'} ${r.detail} |`)
  .join('\n')}

> 这些是**素材/形状**的预检，不是"玩家看得见"的证明。看得见与否由 3 名测试者 × 20 格的记录表决定。
`;

const sheet = `# TP-8② 手机表情可读 · 盲测记录表

- 日期：____-__-__ · 主持人：______ · 材料版本：\`${JSON.stringify(FP)}\`
- 素材：\`tp8-expr-E-r{N}.png\`（**设备像素**，= 手机上真实占的物理像素）
- ⚠️ **必须在手机上按 1:1 看**（或桌面用 \`tp8-expr-viewer.html\` 的 1× 档，pixelated）。
  普通看图器会插值糊化，等于把题目改简单了。
- 判法：每格只答一句 —— **「眼睛和嘴看得出来吗？」**（能 / 不能 / 只有眼没有嘴）。
- 单人 20 格、单轮；三名测试者用同一轮素材（顺序已固定，不互换）。

## 测试者 A（姓名/背景：____________，确认未看过设计文档：☐）

| 行\\列 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |
| 4 |  |  |  |  |  |

能看清：____ / 20 = ____%

## 测试者 B（姓名/背景：____________，确认未看过设计文档：☐）

| 行\\列 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |
| 4 |  |  |  |  |  |

能看清：____ / 20 = ____%

## 测试者 C（姓名/背景：____________，确认未看过设计文档：☐）

| 行\\列 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |
| 4 |  |  |  |  |  |

能看清：____ / 20 = ____%

## 判定口径

- **≥90% 且三人一致** ⇒ "手机表情可读"成立（与 ① 同门槛）。
- **70–90%** ⇒ 不成立，但可修：先看是"整族都糊"还是"个别兵种"（答案钥逐格可比）。
- **<70%** ⇒ 不成立：说明 s=0.825 这档战场缩放把脸压没了 ⇒ 转 TP-1/4 的体量或 H3 加粗。
- 三人之间差 >20pp ⇒ 记"主观分歧"，不算通过。
- **glow 通道（6 帧）本来就没有嘴** —— 那 6 格只判"眼睛看不看得出来"，答案钥里已标通道，
  主持人统分时把它们单列，别让"没有嘴"拉低人形那 13 格的分数。
`;

const viewer = `<!doctype html><meta charset="utf-8"><title>TP-8② 表情可读 · 查看器</title>
<style>
  body{margin:0;background:#111;color:#ddd;font:13px/1.5 system-ui,sans-serif;padding:16px}
  h1{font-size:15px;margin:0 0 4px} p{margin:0 0 12px;color:#9a9a9a}
  .bar{position:sticky;top:0;background:#111;padding:8px 0;z-index:2}
  button{background:#222;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 10px;margin-right:6px;cursor:pointer}
  button.on{background:#3b6;color:#000;border-color:#3b6}
  img{image-rendering:pixelated;display:block;background:#d0d0d0;margin-top:8px}
</style>
<h1>TP-8② 手机表情可读 · 1:1 设备像素</h1>
<p>默认 <b>1×</b>：这就是手机上这块画面的物理像素。放大档只用于看清"它到底画了什么"，<b>不要用放大档打分</b>。</p>
<div class="bar"><span id="tag"></span></div>
<div class="bar">
  <button data-k="1" class="on">1×（评分用）</button>
  <button data-k="2">2×</button>
  <button data-k="3">3×</button>
  <button id="round">下一轮</button>
</div>
<img id="v" src="tp8-expr-E-r1.png">
<script>
  let k = 1, r = 1, R = ${ROUNDS};
  const img = document.getElementById('v');
  const tag = document.getElementById('tag');
  const draw = () => {
    img.style.width = img.naturalWidth * k + 'px';
    tag.textContent = 'Round ' + r + '/' + R + ' · ' + k + '×';
  };
  document.querySelectorAll('button[data-k]').forEach((b) => b.onclick = () => {
    k = +b.dataset.k;
    document.querySelectorAll('button[data-k]').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  });
  document.getElementById('round').onclick = () => { r = r % R + 1; img.src = 'tp8-expr-E-r' + r + '.png'; img.onload = draw; };
  img.onload = draw;
</script>
`;

const manifest = `# TP-8② 手机表情可读 · 素材清单
dist: ${DIST}
指纹: ${JSON.stringify(FP)}
seed: ${SEED}   rounds: ${ROUNDS}
口径: 792×320 CSS @ dpr${DPR} · 战场 BASE ${VIEW.baseW}×${VIEW.baseH}（BattleRenderer.ts:18-19）
      s = ${S.toFixed(4)}（缩放）· k = ${K.toFixed(4)} 设备像素/美术像素
底景: L=208（与 ① 同）· 格 ${CELL_W}×${CELL_H} · 间距 ${GAP}
帧数: ${frames.length} 个 cu_ idle（中立怪 wolf/boar/ogre 不进人类闸，H3 对兽类是另一条）
通道: h3 ${declaredCount.h3} · glow ${declaredCount.glow} · profile ${declaredCount.profile}
查看: tp8-expr-viewer.html（pixelated；1× 档 = 评分口径）
files:
${files.map((f) => `  ${f}`).join('\n')}
轮次排列（Round 1 即答案钥）:
${roundMeta.map((m) => `  R${m.r}: ${m.order.join(' ')}`).join('\n')}

声明式例外（FACE_LAW）:
${Object.entries(FACE_LAW).map(([k, v]) => `  ${k} → ${v[0]}：${v[1]}`).join('\n')}

机器预检（本次）:
${rows.map((r) => `  [${r.pass ? 'PASS' : 'FAIL'}] ${r.id} ${r.title} ${r.detail}`).join('\n')}

协议口径:
  E   = 设备像素：按 k=${K.toFixed(3)} 最近邻放大 ⇒ 与手机上看到的物理像素一一对应（评分用这张）。
  Ecss= CSS 像素：按 s=${S.toFixed(3)} 降采样 ⇒ 布局实际给的尺寸（**只作参照**，用来解释
        "为什么设备像素够大、但玩家还是可能看不清"——两者差 dpr 倍）。
  脸窗 = 左眼左上 (-5,-4) 到 右眼/嘴 右侧 (+6/+2)、下 (+4)，裁自 cu_* idle 帧，不含全身。
`;

writeFileSync(join(OUT, 'tp8-expr-answerkey.md'), answer, 'utf8');
writeFileSync(join(OUT, 'tp8-expr-scoresheet.md'), sheet, 'utf8');
writeFileSync(join(OUT, 'tp8-expr-viewer.html'), viewer, 'utf8');
writeFileSync(join(OUT, 'tp8-expr-manifest.txt'), manifest, 'utf8');
files.push('tp8-expr-answerkey.md', 'tp8-expr-scoresheet.md', 'tp8-expr-viewer.html', 'tp8-expr-manifest.txt');

/* ---------------------------------------------------------------- 汇总 */

const pass = rows.filter((r) => r.pass).length;
console.log(`\n产出：${OUT}`);
console.log(`  ${files.length} 个文件（${ROUNDS} 轮 × 2 版素材 + 答案钥 + 记录表 + 查看器 + 清单）`);
console.log(`  设备像素眼块 ≈ ${(EYE_MIN * K).toFixed(1)}px；CSS 上 ≈ ${(EYE_MIN * S).toFixed(2)}px`);
console.log(`\n${bad.length === 0 ? '✅' : '❌'} 共 ${rows.length} 条预检：${pass} 过 / ${bad.length} 红`);
process.exit(bad.length === 0 ? 0 : 1);
