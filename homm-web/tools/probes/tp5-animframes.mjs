/**
 * tp5-animframes.mjs —— TP-5 动画接线的量化 + 肉眼验收探针（零依赖 CDP，非门控）。
 *
 * 背景（TP-1 的教训）：断言能证明"画得合法"，证明不了"动起来了像那么回事"。
 * 能量化的量化，量化不了的存图给人眼看。
 *
 * 场景一律 `?devbattle=t5`（四族 T5：加班天使/独角兽园丁 vs 熔岩巨魔/失控大魔像）。
 * ⚠️ 为什么不是 `?devbattle=1`（archer/pikeman/knight/wolf/boar/ogre）：
 *   那是旧通用兵种，**图集里没有 cu_* 帧**（UNIT_FRAMES 只覆盖 20 个族属单位，
 *   前提清单见 tools/probes/tp5-atkframes.mjs）⇒ BattleRenderer.drawUnit 缺帧即
 *   return，只画队伍色底盘圈；而 lunge 位移只加在精灵 blit 上、**不加在底盘圈上**
 *   ⇒ 攻击表现在那个场景里根本不可见，TP-5 接线无从验证。踩过，别再改回去。
 *
 * 三段（全部读**渲染器离屏画布**：1px = 1 场单位，无缩放无 DPR；比整页截图快
 *   三个数量级——本机截图每张 2.5~15s，会系统性漏掉 520ms 的攻击演出）：
 *   A. idle 浮动（圣经 H5① = 0/-1/-2px 三帧循环 600ms）：
 *      `?devbattle=t5&devprobe=1`（无 auto，纯待机）两张间隔 FRAME_GAP_MS(250ms)。
 *      判据：差异像素 > 0，且 ≥55% 的差异像素能被 |dy|≤2（dx=0）的垂直位移解释
 *      ——即"整屏单位在上下浮动，且幅度就是规定的 0/-1/-2px"。
 *   B. 攻击表现（TP-5① atk 帧 + H5② squash&stretch）：四道硬闸，缺一不可。
 *      `?devbattle=t5&devauto=1&devprobe=1`，用 devprobe 暴露的 `__battleLunge`
 *      （lunge 非空 ⇔ 该单位在画 atk 帧 + 缩放，BattleRenderer.drawUnit 的选帧与
 *      缩放唯一依据）**精确抓帧**：边扫边抓（~33fps），lunge null→非空开一段
 *      episode、回落收尾，每段带"前帧（idle）/ 进行帧 / 后帧"。帧对还要过两道
 *      污染闸：**场景安静**（除受检单位外任何单位/高亮/行动格都不许变）+ **排除区**
 *      （飘字会升、火花半径动画、`chi_sel` 光圈 alpha 脉冲）。硬闸只判**守方
 *      （side 1）episode**：反击时光圈在攻方格上、飘字火花在目标格上，守方自己的
 *      框里只有"换帧 + 缩放 + 位移"，没有第二个变量。
 *      B1 换帧实证：进行帧的 `frame.name`（BattleRenderer.lastFrame，渲染器实际
 *         blit 的图集帧）必须是 `cu_<id>_atk`，前帧必须是 `cu_<id>`。"帧烘焙了但
 *         渲染器从不 blit"就是这个项目 TP-5 之前的真实状态——光看画面像素分不清
 *         "换了帧"和"位移更大"，必须读选帧结果。
 *      B2 squash 实证：进行帧落笔矩形与图集帧自然尺寸（64×56）之差 = 缩放系数
 *         （满打 1.15/0.85 ⇒ +9/-8；k 插值中段也是同号缩放，判据放宽到 |Δ|≥2 同号——
 *         任何非零同号偏差都是真实缩放，取整与浮动相位最多贡献 1px）。差 0 = 缩放
 *         没生效。lunge.sx/sy 由 BattleScreen.meleeAnim 按 k 写入（±0.15×k）。
 *      B2b 锚点实证：缩放必须"中心/底边"锚（drawUnit 的 (f.w-sw)/2 与 (f.h-sh)
 *         补偿项）——blit 中心 - fx - dx - jerked 两帧不变（±1），blit 底边 - fy - dy
 *         两帧不变（±3：idle 浮动相位差 ≤2 + 取整 ≤1）。锚点错的缩放会让单位在
 *         拉伸时"飘"，而矩形尺寸看着是对的——只有锚点守恒能抓住。
 *      B3 画面变化：最强帧对框内 ≥POSE_MIN_DIFF_PCT(6)% 像素变化（像素真的在变）。
 *      B4 屏幕=图集实证（零容差）：imageSmoothingEnabled=false ⇒ 最近邻缩放是
 *         精确拷贝。拿 lastFrame 的矩形去图集裁出当帧那一帧，与离屏画布同位置
 *         逐像素比（内部不透明像素、RGB 容 1/255）：匹配率 ≥95% ⇒ "屏幕上这一块
 *         就是图集里这一帧"；同时前帧与进行帧的图集内容差 ≥8% ⇒ 两帧是不同的图
 *         （换帧真的换出了不同的画面，不是把 idle 帧又 blit 了一遍）。
 *         ⚠️ dest≠src 时 dest 像素对应哪个 src 像素**不推公式**：Chrome/Skia 的
 *         NN 重采样在分数目标尺寸下，floor(X·S/D) 与 floor((X+0.5)·S/D) 两种常见
 *         约定都不成立（2026-10-18 实测 16→74：真实跳变点 5,10,15,20,24,28…）。
 *         用页面内 `__battleNN(sw,sh,dw,dh)` 实测映射表（同一批参数画唯一色图读
 *         出来）。旧版用 ±1 邻域容差 + floor 公式，把"源是半透明边缘"的屏幕像素
 *         （必然是与地板的混色）误判成 mismatch，B4 恒定在 84~88% —— 页面内同帧
 *         getImageData 直接比其实是 100%，雷全在探针侧（2026-10-18）。
 *      ⚠️ 旧版 B 闸 = "最优平移残余 ≥6%"，**负向对照 2026-10-17 实测恒绿**：
 *         插桩构建（恒 idle 帧 + 关缩放）下残余仍有 9~28% > 6%。根因：精灵边缘
 *         是抗锯齿的，在**有纹理的六边形地面**上平移 1px，边缘像素的混合结果永远
 *         对不上（背景色随位置变）——这是度量的不可约底噪，不是实现问题。⇒ 残余
 *         已降级为旁证（照印），硬闸换成四个精确量（帧名 / 整数矩形差 / 锚点守恒 /
 *         像素相等计数）。
 *      ⚠️ 阴性对照下各闸的预期（2026-10-18 用同一插桩实测，逐条对得上）：
 *         B1 ❌ 帧名恒为 cu_<id>（没有 atk）· B2/B2b ❌ Δw/Δh 恒 0 · B4 ❌ 没有
 *         idle→atk 帧对可判（内容差 0%）· **B3 仍可能 ✅** —— 插桩只关"换帧+缩放"，
 *         lunge 位移/浮动/抖动照样在动，框内像素照样变。所以 B3 从设计上就分不清
 *         "换了帧"和"位移更大"，它只是"画面在动"的旁证；把 B3 当攻击表现硬闸 = 恒绿。
 *         （期望全部归零的是 B1/B2/B2b/B4；若它们在插桩下还绿，才是闸坏了。）
 *   C. 受击位移（H5③ = +2px 右移）：软报告。精确条件 = 同一单位冲击特效 p 跨过
 *      0.3（BattleRenderer.ts 的 jerked 定义域）且场景安静 ⇒ 框内差异 ≥85%
 *      由 dx=+2 解释即实证；采样没跨上不判失败，只标注。
 *
 * 框位口径：精灵 64×56 场坐标、锚 (-32,-48)（unitArt.ts / asset-spec §3.2）；
 * 离屏绘制位置 = (fx + PAD, fy + PAD)。单位框取该部队两帧的**实际落笔矩形之并**
 * （钩子里的 bx/by/bw/bh，BattleRenderer.lastBlit）——lunge 位移、squash 缩放、
 * idle 浮动、受击 +2px 全在里面，不用建模（建模必漏项，TP-5 踩过两次）。
 *
 * 阴性对照纪律（改这段门之后必须重做）：
 *   临时把 BattleRenderer.drawUnit 改成 `const name = idleName; void atkName;` +
 *   `const sx = 1; const sy = 1;`（ markers: NEGCTRL-TP5），npm run build，确认
 *   桩编译进 dist/render/BattleRenderer.js，跑本探针 ⇒ **B1/B2/B2b 必须 ❌**
 *   （B3 在插桩下仍可能 ✓——单位还在位移，那是纯位移的签名，正好说明 B3 单独
 *   不够、必须配 B1/B2；B4 也可能 ✓——插桩构建老老实实画 idle 帧，屏幕=图集
 *   仍然成立）。对照完还原、重建、再跑一遍全绿。只跑正向不跑对照 = 恒绿闸。
 *
 * 用法：node tools/probes/tp5-animframes.mjs [outDir]（自起 serve.mjs，无需外部终端）
 *   环境变量：SCAN_MS（26000）POSE_MIN_DIFF_PCT（6）
 *             CAND_RANGE（20）FRAME_GAP_MS（250，仅 A 段第二张间隔）CAP_MS（30，抓帧间隔）
 * 退出码：0 = A+B 全过；1 = 有硬断言失败；2 = 用法/环境错。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';

const OUT_DIR = path.resolve(process.argv[2] ?? '/tmp/tp5-frames');
const FRAME_GAP_MS = Number(process.env.FRAME_GAP_MS ?? 250);
const SCAN_MS = Number(process.env.SCAN_MS ?? 26000);
const POSE_MIN_DIFF_PCT = Number(process.env.POSE_MIN_DIFF_PCT ?? 6);
// ⚠️ POSE_MIN_RESID_PCT（最优平移残余下限）已废止：负向对照 2026-10-17 实测，
//    插桩构建（恒 idle + 关缩放）下残余仍有 9~28% > 6% —— 抗锯齿精灵边缘在纹理
//    地面上平移永远解释不掉，是度量的不可约底噪 ⇒ 拿它当硬门 = 恒绿闸。残余值
//    仍逐片段打印（旁证），硬闸改为 B1/B2/B4 三个精确量。
const CAND_RANGE = Number(process.env.CAND_RANGE ?? 20);
const CAP_MS = Number(process.env.CAP_MS ?? 30); // 抓帧间隔（离屏 toDataURL 很快，30ms ≈ 33fps）
const DIST = new URL('../../dist/', import.meta.url).pathname;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) { console.error('找不到 Chrome'); process.exit(2); }
mkdirSync(OUT_DIR, { recursive: true });

const { hexCenter } = await import(DIST + 'core/combat/hex.js');
const PAD = 6; // BattleRenderer.ts:16（同源常量；改那里要同步这里）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const bad = (m) => { console.log('  ❌ ' + m); fail++; };
const ok = (m) => console.log('  ✅ ' + m);
const warn = (m) => console.log('  ⚠️ ' + m);

/* ---------------- PNG 解码（8-bit 非隔行 RGB/RGBA；同 imagecmp.mjs 口径） ---------------- */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`只支持 8-bit，收到 ${bitDepth}-bit`);
  if (interlace !== 0) throw new Error('不支持隔行 PNG');
  if (colorType !== 2 && colorType !== 6) throw new Error(`只支持 colorType 2/6，收到 ${colorType}`);
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: throw new Error(`未知 filter ${filter}（行 ${y}）`);
      }
      cur[x] = v;
    }
  }
  return { width, height, ch, data: out };
}

const TOL = 8;
const inB = (img, x, y) => x >= 0 && y >= 0 && x < img.width && y < img.height;
const px = (img, x, y, k) => img.data[(y * img.width + x) * img.ch + k];
/** 两像素四通道全部 |Δ|≤TOL 视为同色；任一出界即不同。
 *  ⚠️ 非整数坐标一律判不同：`data[小数索引]` = undefined，`Math.abs(undefined-x)` = NaN，
 *    而 `NaN > TOL` 是 false ⇒ 小数坐标会**永远匹配**（TP-5 真踩过：lunge.dx 是
 *    k 插值的小数，直接进候选集后负向对照残余被 NaN 假匹配打成 0%，门恒绿）。 */
const samePx = (a, b, ax, ay, bx, by) => {
  if (!inB(a, ax, ay) || !inB(b, bx, by)) return false;
  if (!Number.isInteger(ax) || !Number.isInteger(ay) || !Number.isInteger(bx) || !Number.isInteger(by)) return false;
  for (let k = 0; k < a.ch; k++) if (Math.abs(px(a, ax, ay, k) - px(b, bx, by, k)) > TOL) return false;
  return true;
};

/* -------- B4 专用：图集裁帧 + "屏幕=图集"零容差比对 --------
   前提（都查过码）：drawUnit 里精灵是 `drawImage(atlas, f.x,f.y,f.w,f.h, sbx,sby,sw,sh)`
   且 offCtx.imageSmoothingEnabled=false ⇒ 最近邻缩放 = 源像素的精确拷贝（不重采样）；
   精灵本身不染色不加 alpha（染色/alpha 只发生在 floast/冲击/光圈上，且都画在单位
   **之后**，走 exclOf 排除）。⇒ 内部不透明像素在屏幕上必须与图集**逐字节相等**。 */
let atlasImg = null; // 页面里 __battleAtlas.toDataURL 解出来的图（RGBA，一次性）
const cropCache = new Map();
const atlasAlphaAt = (x, y) => {
  if (!atlasImg) return 0;
  if (x < 0 || y < 0 || x >= atlasImg.width || y >= atlasImg.height) return 0;
  return atlasImg.ch === 4 ? atlasImg.data[(y * atlasImg.width + x) * 4 + 3] : 255;
};
/** 裁一个图集帧：rgb(w*h*3) + 内部不透明掩码（alpha=255 且 3×3 邻域全 255 ——
 *  掩码外的抗锯齿边缘像素会和背景混合，屏幕上对不上图集，必须排除，否则 B4 恒红）。 */
function cropFrame(rect) {
  const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
  const hit = cropCache.get(key);
  if (hit) return hit;
  const { w, h } = rect;
  const rgb = Buffer.alloc(w * h * 3);
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const si = ((rect.y + v) * atlasImg.width + rect.x + u) * atlasImg.ch;
      rgb.set(atlasImg.data.subarray(si, si + 3), (v * w + u) * 3);
    }
  }
  const mask = new Uint8Array(w * h);
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      if (atlasAlphaAt(rect.x + u, rect.y + v) !== 255) continue;
      let interior = true;
      for (let dv = -1; dv <= 1 && interior; dv++) {
        for (let du = -1; du <= 1; du++) {
          if (atlasAlphaAt(rect.x + u + du, rect.y + v + dv) !== 255) { interior = false; break; }
        }
      }
      mask[v * w + u] = interior ? 1 : 0;
    }
  }
  const out = { w, h, rgb, mask };
  cropCache.set(key, out);
  return out;
}
/** 取（或页面内实测）某缩放尺寸的 dest→src 最近邻映射表，按尺寸缓存。
 *  ⚠️ 不推公式：两种常见 NN 约定在分数目标尺寸下都不成立（2026-10-18 实测，
 *    见 BattleScreen 的 nnMapCache 注释）。1:1 尺寸返回 null（调用方走恒等映射）。 */
const nnCache = new Map();
async function nnTable(sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return null; // 1:1 ⇒ 恒等，无需表
  const key = `${sw}x${sh}>${dw}x${dh}`;
  if (nnCache.has(key)) return nnCache.get(key);
  const t = await evaluate(`window.__battleNN ? window.__battleNN(${sw},${sh},${dw},${dh}) : null`);
  nnCache.set(key, t);
  return t;
}
/** 屏幕区域 vs 图集帧：落笔矩形内每个像素，按**实测** dest→src 映射找源像素
 *  （1:1 时恒等；缩放时用 __battleNN 实测表——Chrome 的 NN 约定猜不出，见上），
 *  源像素是内部不透明则要求 RGB 相等（容 1/255 吸收 8 位尾差）。
 *  ⚠️ 只认**精确源像素**：旧版用 ±1 邻域容差，结果把"源是半透明边缘"的屏幕像素
 *    （屏幕上必然是与地板的混色）误判成可判像素、判它 mismatch —— B4 恒在
 *    84~88% 徘徊，差点被当成渲染 bug（2026-10-18：页面内 getImageData 同帧
 *    直接比是 100%，雷在探针侧）。
 *  ⚠️ 缩放帧拿不到实测表时返回 null（不猜、不降级成 ±1）。
 *  TP5_B4_DEBUG=1 时打印不匹配像素的明细（排障用）。 */
const B4_DEBUG = process.env.TP5_B4_DEBUG === '1';
function screenVsAtlas(img, blit, fr, crop, excl, table, tag = '') {
  const ident = blit.w === fr.w && blit.h === fr.h;
  if (!ident && !table) return null;
  const classifiable = { n: 0, m: 0 };
  const bad = [];
  for (let Y = blit.y; Y < blit.y + blit.h; Y++) {
    if (Y < 0 || Y >= img.height) continue;
    for (let X = blit.x; X < blit.x + blit.w; X++) {
      if (X < 0 || X >= img.width) continue;
      if (excl.some((r) => X >= r.x0 && X < r.x1 && Y >= r.y0 && Y < r.y1)) continue;
      const src = ident
        ? (Y - blit.y) * fr.w + (X - blit.x)
        : table[(Y - blit.y) * blit.w + (X - blit.x)];
      if (src < 0 || src >= fr.w * fr.h) continue;
      if (!crop.mask[src]) continue; // 源像素不是内部不透明 ⇒ 屏幕上是混色，天然对不上，不可判
      const ci = src * 3;
      const pi = (Y * img.width + X) * img.ch;
      const okv =
        Math.abs(crop.rgb[ci] - img.data[pi]) <= 1 &&
        Math.abs(crop.rgb[ci + 1] - img.data[pi + 1]) <= 1 &&
        Math.abs(crop.rgb[ci + 2] - img.data[pi + 2]) <= 1;
      if (!okv && B4_DEBUG && bad.length < 60) {
        bad.push(
          `  (${X},${Y}) 屏=${img.data[pi]},${img.data[pi + 1]},${img.data[pi + 2]} ` +
            `源(u=${src % fr.w},v=${Math.floor(src / fr.w)})=${crop.rgb[ci]},${crop.rgb[ci + 1]},${crop.rgb[ci + 2]}`,
        );
      }
      classifiable.n++;
      if (okv) classifiable.m++;
    }
  }
  if (B4_DEBUG && bad.length) {
    console.log(`  [B4 debug ${tag}] 不匹配 ${classifiable.n - classifiable.m}/${classifiable.n}（前 ${bad.length} 个）：`);
    for (const l of bad) console.log(l);
  }
  return { n: classifiable.n, m: classifiable.m, pct: classifiable.n ? (classifiable.m / classifiable.n) * 100 : 0 };
}
/** 两个图集帧的内容差（任一帧内部不透明的像素才算）：idle vs atk 若几乎无差 ⇒
 *  "换了帧"换了个寂寞（atk 帧烘焙成 idle 副本的回归闸）。 */
function cropDiff(a, b) {
  let cmp = 0, diff = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    if (!a.mask[i] && !b.mask[i]) continue;
    cmp++;
    const o = i * 3;
    if (
      Math.abs(a.rgb[o] - b.rgb[o]) > 8 ||
      Math.abs(a.rgb[o + 1] - b.rgb[o + 1]) > 8 ||
      Math.abs(a.rgb[o + 2] - b.rgb[o + 2]) > 8
    ) diff++;
  }
  return { cmp, diff, pct: cmp ? (diff / cmp) * 100 : 0 };
}

/** 全图差异像素集合 + 每个差异像素"被某个候选平移解释"的统计（候选少，够快）。 */
function diffStats(a, b, cands) {
  let diff = 0, explained = 0;
  const usedDy = new Map();
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (samePx(a, b, x, y, x, y)) continue;
      diff++;
      for (const [dx, dy] of cands) {
        if (samePx(a, b, x, y, x + dx, y + dy)) {
          explained++;
          const key = `${dx},${dy}`;
          usedDy.set(key, (usedDy.get(key) ?? 0) + 1);
          break;
        }
      }
    }
  }
  return { diff, explained, usedDy };
}

/** 区域内差异（rect = {x0,y0,x1,y1} 截图像素坐标；候选少，够快）。 */
function boxDiff(a, b, r, cands) {
  let diff = 0, explained = 0, area = 0;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      area++;
      if (x < 0 || y < 0 || x >= a.width || y >= a.height) continue;
      if (samePx(a, b, x, y, x, y)) continue;
      diff++;
      for (const [dx, dy] of cands) {
        if (samePx(a, b, x, y, x + dx, y + dy)) { explained++; break; }
      }
    }
  }
  return { diff, explained, area };
}

/* -------- B 段专用：同色索引版平移可解释性（±20px 候选 = 1681 个，朴素逐个试太慢） -------- */
const colorKey = (img, x, y) => {
  let k = 0;
  for (let c = 0; c < img.ch; c++) k = (k << 8) | img.data[(y * img.width + x) * img.ch + c];
  return k;
};
/** 在 r 区域内建"颜色 → 位置打包数组"索引。语义 = 同色即被该偏移解释（比 TOL 更严，
 *  纯位移在负向对照里仍是精确同色 ⇒ 照样 100% 可解释，不影响对照有效性）。 */
function colorIndex(img, r) {
  const m = new Map();
  for (let y = Math.max(0, r.y0); y < Math.min(img.height, r.y1); y++) {
    for (let x = Math.max(0, r.x0); x < Math.min(img.width, r.x1); x++) {
      const k = colorKey(img, x, y);
      const arr = m.get(k);
      if (arr) arr.push((y << 16) | x); else m.set(k, [(y << 16) | x]);
    }
  }
  return m;
}
/**
 * 区域内差异 + 同色偏移投票表：
 *  - `diff` / `area`：框内（排除区外）差异像素与面积；
 *  - `loose`：被 ±range 内任意同色偏移解释的差异像素数（参考项——它会把纯位移和
 *    姿态变化一起算成"可解释"，第一版探针的"98% 可解释"一半是这个假象）；
 *  - `votes`：每个差异像素把它在 ±range 内找到的**第一个**同色偏移记一票
 *    （用于给 boxResidual 生成候选偏移集；纯位移下真实位移会拿到绝大部分票）。
 */
function boxDiffIdx(a, b, r, range, idx, excl) {
  let diff = 0, loose = 0, area = 0;
  const votes = new Map();
  const inExcl = (x, y) => excl.some((e) => x >= e.x0 && x < e.x1 && y >= e.y0 && y < e.y1);
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      if (inExcl(x, y)) continue; // 排除区不计面积不计差异（见 sceneQuiet/exclOf）
      area++;
      if (x < 0 || y < 0 || x >= a.width || y >= a.height) continue;
      if (samePx(a, b, x, y, x, y)) continue;
      diff++;
      const arr = idx.get(colorKey(a, x, y));
      if (arr) {
        for (const p of arr) {
          const dx = (p & 0xffff) - x, dy = (p >> 16) - y;
          if (dx < -range || dx > range || dy < -range || dy > range) continue;
          loose++;
          const k = `${dx},${dy}`;
          votes.set(k, (votes.get(k) ?? 0) + 1);
          break; // 一像素一票（第一个命中即停）；纯位移下第一个命中通常就是真实位移附近
        }
      }
    }
  }
  return { diff, loose, area, votes };
}
/**
 * 最优平移残余（**门控判据**）：在候选偏移里挑一个让**差异像素**匹配最多的 D，
 * 残余 = 连这个最优平移都解释不了的差异像素占比。
 * - 为什么只数差异像素：整框平移匹配会被静态内容坑死——数量牌/底盘圈不跟着
 *   lunge 动（drawUnit 里它们用 cx/cy，不含 ox/oy）， hex 地面也有纹理，
 *   任何非零 D 下它们全变成"不匹配"，负向对照下残余会高达 20%+ ⇒ 恒绿。
 *   只数差异像素后：纯平移下旧墨像素与新墨像素**都**能在 D 上对齐
 *   （A(p)=墨→B(p+D)=墨；A(p+D)=底→B(p+2D)=底）⇒ 残余 ≈ 0（只剩取整/抗锯齿边缘）。
 * - 换了帧/做了缩放：新姿态的墨在任何单一平移上都对不齐 ⇒ 残余 = 姿态变化量。
 * ⚠️ 候选集必须含真实 D：首选 = 两帧**落笔矩形差**（钩子 bx/by，精确到像素，
 *   lunge 位移 + squash 锚点补偿 + idle 浮动 + 受击 +2 全含在里面），再用差异
 *   像素的同色投票（colorIndex）头部兜底（防我漏看某个绘制期量）。
 */
function boxResidual(a, b, r, excl, cands) {
  const dps = [];
  const inExcl = (x, y) => excl.some((e) => x >= e.x0 && x < e.x1 && y >= e.y0 && y < e.y1);
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      if (inExcl(x, y)) continue;
      if (samePx(a, b, x, y, x, y)) continue;
      dps.push(x, y);
    }
  }
  const n = dps.length / 2;
  let bestD = [0, 0], bestM = -1;
  const seen = new Set();
  for (const [dx, dy] of cands) {
    const k = dx * 1000 + dy;
    if (seen.has(k)) continue;
    seen.add(k);
    let m = 0;
    for (let i = 0; i < dps.length; i += 2) {
      const nx = dps[i] + dx, ny = dps[i + 1] + dy;
      if (inB(b, nx, ny) && samePx(a, b, dps[i], dps[i + 1], nx, ny)) m++;
    }
    if (m > bestM) { bestM = m; bestD = [dx, dy]; }
  }
  return { diff: n, matched: bestM, bestD, residualPct: n > 0 ? ((n - bestM) / n) * 100 : 0 };
}

/* ---------------- 自起 dev server（不依赖外部终端；serve.mjs 端 cwd/dist） ---------------- */
const APP_PORT = 39500 + (process.pid % 2000);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const server = spawn('node', [path.join(ROOT, 'tools', 'serve.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT: String(APP_PORT) }, stdio: ['ignore', 'ignore', 'pipe'],
});
let serverLog = '';
server.stderr.on('data', (d) => { serverLog += d.toString(); });

/* ---------------- Chrome + CDP 基本件（零依赖） ---------------- */
const profile = mkdtempSync(path.join(tmpdir(), 'tp5shot-'));
// detached：chrome 自建进程组，清理时整组 SIGKILL —— 只杀父进程留下 Helper Renderer
// 是这个环境反复资源枯竭的成因（2026-10-18：5 个残留 chrome 把 rAF 饿死，探针全红）。
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=1', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${9800 + (process.pid % 100)}`, '--remote-allow-origins=*',
  '--window-size=1280,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'], detached: true });

let cleanedUp = false;
async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  for (const p of [chrome, server]) {
    try {
      if (chrome === p && p.pid) process.kill(-p.pid, 'SIGKILL'); // 整组（含 Helper）
    } catch { /* 组已不存在 */ }
    try { if (!p.killed) p.kill('SIGKILL'); } catch { /* 已退出 */ }
    await new Promise((resolve) => {
      if (p.exitCode !== null || p.signalCode !== null) return resolve();
      p.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
  }
  for (let i = 0; i < 5; i++) {
    try { rmSync(profile, { recursive: true, force: true }); return; } catch { await sleep(200); }
  }
}
// 中断（Ctrl-C / 工具打断）也必须清：finally 只在正常 unwind 时跑，
// 被 SIGINT/SIGTERM 打掉时 node 直接退出，残留 chrome 会饿死后续所有跑次。
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { cleanup().finally(() => process.exit(130)); });
}

async function waitServer() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${BASE_URL}/`); if (r.ok) return true; } catch { /* 还没起 */ }
    await sleep(100);
  }
  return false;
}

async function findTarget() {
  const port = 9800 + (process.pid % 100);
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const t = list.find((x) => x.type === 'page' && (x.url.includes('127.0.0.1') || x.url === 'about:blank'));
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch { /* 端口还没开 */ }
    await sleep(100);
  }
  throw new Error('等不到 CDP target');
}

let ws, seq = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? '页面内异常');
  return r.result?.value;
}
/** 抓一帧：rAF 回调里同时读钩子状态 + 离屏画布 toDataURL。
 *  ★ 为什么不用 Page.captureScreenshot：截图要走合成器，本机实测每张 2.5~15s，
 *    而一次攻击演出只有 520ms ⇒ 采样节奏**系统性漏掉所有 lunge**（探针第一版
 *    就这么假红过：26s 扫描零片段，不是动画没做）。离屏画布是纯 JS 读取，
 *    且 draw() 在钩子之后用同一批状态作画 ⇒ 状态与图像天然同帧对齐。
 *    坐标口径 = 离屏画布像素 = 场单位 + PAD（1px = 1 场单位，无缩放无 DPR）。 */
const CAPTURE_EXPR = `new Promise((res) => requestAnimationFrame(() => {
  const off = window.__battleOff;
  res(JSON.stringify({
    t: Date.now(),
    l: window.__battleLunge ?? null,
    scene: window.__battleScene ?? null,
    inBattle: document.body.classList.contains('in-battle'),
    png: off ? off.toDataURL('image/png') : null,
  }));
}))`;
async function captureFrame() {
  const s = JSON.parse(await evaluate(CAPTURE_EXPR));
  if (!s || !s.png) throw new Error('抓帧失败（__battleOff 没暴露？devprobe 没开？）');
  const png = s.png.includes(',') ? s.png.slice(s.png.indexOf(',') + 1) : s.png; // toDataURL 带 data: 前缀
  return { t: s.t, l: s.l, scene: s.scene, inBattle: s.inBattle, raw: Buffer.from(png, 'base64'), img: null };
}
/** 等一个页面条件成立；导航中 evaluate 可能抛（文档切换），吞掉重试。
 *  ⚠️ 条件里必须带** URL 特征**：只查 canvas 会在旧文档上命中（第二段导航竞态，
 *  拍到开始页还以为是战斗——TP-5 真踩过）。 */
async function waitFor(pred, label, tries = 400) {
  for (let i = 0; i < tries; i++) {
    let v = false;
    try { v = await evaluate(pred); } catch { /* 导航中，下一轮 */ }
    if (v) return true;
    await sleep(50);
  }
  throw new Error(label);
}

try {
  if (!(await waitServer())) {
    console.error(serverLog.slice(0, 500));
    throw new Error(`dev server 起不来（${BASE_URL}）—— dist/ 构建了吗？`);
  }
  const wsUrl = await findTarget();
  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连不上')), { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');

  /* ============ A. idle 浮动（无 auto 待机两张） ============ */
  console.log('\n=== A. idle 浮动（H5①：0/-1/-2px · 600ms 三帧循环）===');
  // devprobe 也开：A 段同样走离屏画布抓帧（__battleOff 钩子）
  await send('Page.navigate', { url: `${BASE_URL}/?devbattle=t5&devprobe=1` });
  await waitFor(
    `location.search.includes('devbattle') && document.body.classList.contains('in-battle')` +
      ` && !!document.querySelector('canvas.bt-canvas') && document.querySelector('canvas.bt-canvas').width > 0` +
      ` && !!window.__battleOff`,
    `页面没有加载出战斗画布 —— ${BASE_URL} 的服务起没起？dist 构建了吗？`,
  );
  await sleep(700);
  const fa1 = await captureFrame();
  const a1 = decodePng(fa1.raw);
  await sleep(FRAME_GAP_MS);
  const fa2 = await captureFrame();
  const a2 = decodePng(fa2.raw);
  const VERT = [[0, -2], [0, -1], [0, 1], [0, 2]];
  const sa = diffStats(a1, a2, VERT);
  const total = a1.width * a1.height;
  console.log(`  离屏画布 ${a1.width}×${a1.height}（1px = 1 场单位）`);
  console.log(`  差异像素 ${sa.diff} / ${total} (${((sa.diff / total) * 100).toFixed(3)}%) · 垂直可解释 ${sa.explained} (${sa.diff ? ((sa.explained / sa.diff) * 100).toFixed(1) : '0'}%)`);
  console.log('  解释用的位移分布: ' + [...sa.usedDy.entries()].map(([k, v]) => `${k}×${v}`).join(' '));
  if (sa.diff === 0) {
    bad(
      '两张待机截图零差异 —— 页面冻住了（rAF 饿死/开始页盖住/渲染循环没跑），不是 H5① 的问题。' +
        '先查残留 headless Chrome（pgrep -f tp5shot）再重跑；零差异在这里一律按环境故障报',
    );
  } else {
    ok('待机画面有差异（单位在动）');
    const pct = (sa.explained / sa.diff) * 100;
    if (pct < 55) bad(`垂直位移只解释了 ${pct.toFixed(1)}%（<55%）——差异不像 0/-1/-2px 浮动，可能是别的东西在动`);
    else ok(`${pct.toFixed(1)}% 的差异由 |dy|≤2 垂直位移解释 —— 浮动幅度符合圣经`);
    let small = 0;
    for (const [k, v] of sa.usedDy) if (Math.abs(Number(k.split(',')[1])) <= 2) small += v;
    if (sa.explained > 0 && small / sa.explained < 0.9) bad('解释位移里 |dy|>2 的占比过高 —— 浮动幅度超规格');
  }
  writeFileSync(path.join(OUT_DIR, 'tp5-idle-a.png'), fa1.raw);
  writeFileSync(path.join(OUT_DIR, 'tp5-idle-b.png'), fa2.raw);
  console.log('  💾 tp5-idle-a/b.png（= 上面分析用的那一对；肉眼复核：单位应上下微浮）');

  /* ============ B. 攻击表现（auto + lunge 触发抓帧） ============ */
  console.log('\n=== B. 攻击表现（atk 帧 + H5② squash&stretch；__battleLunge 触发抓帧）===');
  /* ★ 清档必须在**新文档的脚本之前**做，不能先在旧页面 clear 再 navigate：
     旧页面卸载时 installLifecycle 的 onPause 会 saveGame(state)（M-05 后台存档），
     把刚清掉的 homm-save-v1 又写回去 ⇒ 新文档 boot 时 hasSave()=真 ⇒ 走 openStart()
     ⇒ 开始页盖在战斗屏上（战斗照跑：钩子照更新、in-battle 不消失、截图却全是开始页
     —— TP-5 真踩过，症状极隐蔽）。用 addScriptToEvaluateOnNewDocument 在 main.js
     前删键（chromeshot --ls= 同款机制），boot 才走 startScenario('tutorial') 分支。 */
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.removeItem('homm-save-v1'); localStorage.removeItem('homm-tutorial-done'); } catch {}`,
  });
  await send('Page.navigate', { url: `${BASE_URL}/?devbattle=t5&devauto=1&devprobe=1` });
  await waitFor(
    `location.search.includes('devauto') && document.body.classList.contains('in-battle')` +
      ` && !!document.querySelector('canvas.bt-canvas') && document.querySelector('canvas.bt-canvas').width > 0`,
    'auto 战斗页面没有加载出战斗画布 —— serve.mjs / dist？',
  );
  const hooks = await evaluate(`({ lunge: typeof window.__battleLunge, scene: typeof window.__battleScene })`);
  if (hooks.lunge !== 'object' || hooks.scene !== 'object') {
    throw new Error(`devprobe 钩子没暴露（lunge=${hooks.lunge} scene=${hooks.scene}）—— BattleScreen 的 debugProbe 分支被改了？`);
  }
  /* 覆盖闸：开始页若盖在战斗屏上，钩子照更新、in-battle 不消失，但画面全是开始页
     （B 段曾因此全部"零差异"）。这里直接查 DOM，不让它静悄悄发生。 */
  const covered = await evaluate(`!!document.getElementById('start-screen')`);
  if (covered) throw new Error('开始页盖在战斗屏上（#start-screen 存在）—— boot 走了 openStart() 分支：存档清掉了吗？');
  /* 图集（一次性）：B4 的"屏幕=图集"零容差比对要从这里裁帧（BattleRenderer.atlasCanvas）。 */
  const atlasUrl = await evaluate(`window.__battleAtlas ? window.__battleAtlas.toDataURL('image/png') : null`);
  if (typeof atlasUrl !== 'string' || !atlasUrl.includes(',')) {
    throw new Error('__battleAtlas 没暴露 —— BattleRenderer.atlasCanvas getter / BattleScreen 钩子被改了？');
  }
  atlasImg = decodePng(Buffer.from(atlasUrl.slice(atlasUrl.indexOf(',') + 1), 'base64'));
  console.log(`  图集 ${atlasImg.width}×${atlasImg.height}（ch=${atlasImg.ch}）—— B4 逐像素比对的基准`);
  /* 几何全在**离屏画布像素**（= 场单位 + PAD，1px = 1 场单位）里算。
     单位框不再由 fx/fy 推算，而是取该部队两帧的**实际落笔矩形之并**（钩子里的
     bx/by/bw/bh，BattleRenderer.lastBlit）——lunge 位移、squash 缩放、idle 浮动、
     受击 +2px 全在里面，不用建模（建模必漏项：lunge.dx 是 k 插值小数 + 缩放锚点
     补偿，TP-5 踩过两次）。 */
  const blitOf = (fr, unitId) => {
    const u = fr?.scene?.units?.find((x) => x.id === unitId);
    if (!u || u.bx === null || u.by === null) return null;
    return { x: u.bx, y: u.by, w: u.bw, h: u.bh };
  };
  /** 数量牌/血条/弹药点的 UI 带：画在精灵**之后**，会盖住精灵下沿（label by=cy+8
   *  高 13、血条 by+14、弹药点 by-6，位置由 cx/cy 定死；idle 浮动 ±2 已放余量）。
   *  B4 逐像素比对必须排掉——被盖的像素本来就不是精灵内容，不排恒红。 */
  const uiBand = (fr, unitId) => {
    const u = fr?.scene?.units?.find((x) => x.id === unitId);
    if (!u) return null;
    const cx = Math.round(u.fx + PAD), cy = Math.round(u.fy + PAD);
    return { x0: cx - 20, y0: cy - 8, x1: cx + 20, y1: cy + 32 };
  };
  const boxForPair = (a, b, unitId) => {
    const ra = blitOf(a, unitId), rb = blitOf(b, unitId);
    if (!ra && !rb) return null;
    const r = ra ?? rb;
    const s = rb ?? ra;
    return {
      x0: Math.min(r.x, s.x) - 4,
      y0: Math.min(r.y, s.y) - 4,
      x1: Math.max(r.x + r.w, s.x + s.w) + 4,
      y1: Math.max(r.y + r.h, s.y + s.h) + 4,
    };
  };
  /** 场坐标矩形 → 离屏矩形（排除区用：飘字/冲击/光圈格；都画在场坐标 + PAD 上）。 */
  const fieldRect = (fx, fy, hw, hh) => ({
    x0: Math.round(fx + PAD - hw), y0: Math.round(fy + PAD - hh),
    x1: Math.round(fx + PAD + hw), y1: Math.round(fy + PAD + hh),
  });
  /** 场景安静：两帧之间除了受检单位自己，没有任何变化 —— 不安静的对不能用来算差异。
   *  防的污染（全部负向对照实测过）：
   *  ① 受检单位在移动演出中（posOverride 插值位置在变）—— 那时它根本不在框里；
   *  ② 别的单位在动 —— 关键是**绘制期**偏移（idle 浮动 ±2、受击 +2px）不在任何
   *     场景状态里，只查 fx/fy 查不出来 ⇒ 直接逐部队比**落笔矩形**（整数相等）；
   *  ③ 高亮集合 / 当前行动单位在变（chi_atk 出现消失、光圈换格）。 */
  function sceneQuiet(a, b, unitId) {
    if (!a.scene || !b.scene) return false;
    const ua = a.scene.units.find((u) => u.id === unitId);
    const ub = b.scene.units.find((u) => u.id === unitId);
    if (!ua || !ub) return false;
    if (ua.bx === null || ub.bx === null) return false; // 缺帧（没画本体）的帧不拿来做差
    if (Math.abs(ua.fx - ub.fx) > 0.5 || Math.abs(ua.fy - ub.fy) > 0.5) return false;
    for (const u of a.scene.units) {
      if (u.id === unitId) continue;
      const v = b.scene.units.find((x) => x.id === u.id);
      if (!v) return false;
      // 落笔矩形逐一相等 ⇒ 这支部队连一个像素都没动（浮动/抖动/移动全覆盖）
      if (u.bx !== v.bx || u.by !== v.by || u.bw !== v.bw || u.bh !== v.bh) return false;
    }
    const ka = a.scene.overlays.slice().sort().join(' ');
    const kb = b.scene.overlays.slice().sort().join(' ');
    if (ka !== kb) return false;
    const ha = a.scene.activeHex ? a.scene.activeHex.join(',') : '';
    const hb = b.scene.activeHex ? b.scene.activeHex.join(',') : '';
    return ha === hb;
  }
  /** 排除区（两帧取并集）：
   *   - 别的部队的**精灵矩形**（落笔矩形外扩 2px）：相邻单位的精灵会伸进受检单位
   *     的框里（ Hex 间距 ~44px < 精灵 64px 宽），而它们的 bob/受击抖动是绘制期
   *     量——场景安静闸能判"动没动"，但判不了"正在动的那支队"（比如受击软检里
   *     守方还在反击演出中）。直接排掉最干净。
   *   - 飘字（会升高）、冲击火花（半径动画）、当前行动光圈格（alpha 脉冲；
   *     chi_sel 帧 40×46 锚 (-20,-23)，故排除格 ±22×25）。
   *  impacts 元组 = [x, y, p, unitId]（BattleScreen 的 __battleScene 钩子）。 */
  function exclOf(a, b, unitId) {
    const out = [];
    for (const sc of [a.scene, b.scene]) {
      if (!sc) continue;
      for (const u of sc.units) {
        if (u.id === unitId || u.bx === null) continue;
        out.push({ x0: u.bx - 2, y0: u.by - 2, x1: u.bx + u.bw + 2, y1: u.by + u.bh + 2 });
      }
      for (const [fx, fy] of sc.floats) out.push(fieldRect(fx, fy, 26, 40));
      for (const [ix, iy] of sc.impacts) out.push(fieldRect(ix, iy, 24, 24));
      if (sc.activeHex) {
        const c = hexCenter({ col: sc.activeHex[0], row: sc.activeHex[1] });
        out.push(fieldRect(c.x, c.y, 22, 25));
      }
    }
    return out.filter(Boolean);
  }
  console.log('  单位框 = 各部队两帧落笔矩形之并（离屏画布像素，1px = 1 场单位）');

  /* ---- 扫描：抓帧节奏 ~45ms 一拍（离屏 toDataURL 是纯 JS，比整页截图快三个数量级）。
     lunge 非空即开一段 episode。全部帧留 all[]：episode 只覆盖 lunge 期间，而受击
     位移（H5③）的 jerk 窗口（冲击 p<0.3）在 lunge 结束**之后**——只看 episode 内
     帧对会系统性错过它。 ---- */
  const episodes = [];
  const all = [];
  let cur = null, prev = null;
  const t0 = Date.now();
  let stopWhy = '扫描超时';
  while (Date.now() - t0 < SCAN_MS) {
    let fr = null;
    try { fr = await captureFrame(); } catch { stopWhy = '抓帧失败'; break; }
    if (!fr.inBattle) { stopWhy = '战斗已结束'; break; }
    all.push(fr);
    const s = { l: fr.l, scene: fr.scene };
    const lid = fr.l && fr.l.unitId ? fr.l.unitId : null;
    if (lid) {
      if (!cur || cur.unitId !== lid) {
        if (cur) { cur.post = fr; episodes.push(cur); }
        const u = (s.scene?.units ?? []).find((x) => x.id === lid);
        cur = { unitId: lid, side: u ? u.side : null, unitTypeId: u ? u.unitTypeId : '?', pre: prev, frames: [], post: null };
      }
      cur.frames.push(fr);
    } else if (cur) {
      cur.post = fr; episodes.push(cur); cur = null;
    }
    prev = fr;
    if (CAP_MS > 0) await sleep(CAP_MS);
  }
  if (cur) episodes.push(cur);
  const nDef = episodes.filter((e) => e.side === 1).length;
  console.log(`  扫描 ${((Date.now() - t0) / 1000).toFixed(1)}s（${stopWhy}）· lunge 片段 ${episodes.length} 段（守方 ${nDef} / 攻方 ${episodes.length - nDef}）`);
  if (!episodes.length) bad('没有捕获到任何 lunge 片段 —— atk 帧/缩放验证无从做起（auto 没跑起来？钩子没暴露？）');

  const dec = (fr) => (fr.img ?? (fr.img = decodePng(fr.raw)));
  let poseHit = null;   // {ep, tag, diffPct, explPct, diff, a, b}
  let jerkHit = null;   // {ep, unit, diffPct}
  const rows = [];
  for (const ep of episodes) {
    const inFr = ep.frames.filter((f) => f.l && f.l.unitId === ep.unitId);
    const pre = ep.pre && (!ep.pre.l || ep.pre.l.unitId !== ep.unitId) ? ep.pre : null;
    const post = ep.post && (!ep.post.l || ep.post.l.unitId !== ep.unitId) ? ep.post : null;
    const pairs = [];
    if (pre) for (const f of inFr) pairs.push([pre, f, 'pre→in']);
    if (post) for (const f of inFr) pairs.push([f, post, 'in→post']);
    // 相邻进行帧（in→in）：不取首尾跨整段的那对——跨得越长，idle 浮动相位差和
    // 光圈脉冲越可能混进来（场景安静闸只管"别的单位动没动"，管不了脉冲相位）。
    for (let i = 1; i < inFr.length; i++) pairs.push([inFr[i - 1], inFr[i], 'in→in']);
    // pre→peak：失真最大的进行帧（|sx-1| 最大）—— squash&stretch 的极值帧。
    if (pre && inFr.length) {
      const peak = inFr.reduce((m, f) => (Math.abs((f.l.sx ?? 1) - 1) > Math.abs((m.l.sx ?? 1) - 1) ? f : m));
      pairs.push([pre, peak, 'pre→peak']);
    }
    let best = null;
    let quietPairs = 0;
    let lastBox = null;
    for (const [a, b, tag] of pairs) {
      // 场景安静闸：两帧之间除了受检单位自己，别的都不能变（否则差异来源不纯）。
      if (!sceneQuiet(a, b, ep.unitId)) continue;
      const box = boxForPair(a, b, ep.unitId);
      if (!box) continue;
      lastBox = box;
      quietPairs++;
      const A = dec(a), B = dec(b);
      const excl = exclOf(a, b, ep.unitId);
      const idx = colorIndex(B, { x0: box.x0 - CAND_RANGE, y0: box.y0 - CAND_RANGE, x1: box.x1 + CAND_RANGE, y1: box.y1 + CAND_RANGE });
      const st = boxDiffIdx(A, B, box, CAND_RANGE, idx, excl);
      if (st.diff < 400) continue;
      const diffPct = (st.diff / st.area) * 100;
      const loosePct = (st.loose / st.diff) * 100;
      // 门控判据 = 最优平移残余。首选候选 = **两帧落笔矩形差**（精确到像素：
      // lunge 位移 + squash 锚点补偿 + idle 浮动 + 受击 +2 全含在里面），±1 容差；
      // 再兜底差异像素的同色投票头部（防止矩形差因我漏看某个绘制期量而偏掉）。
      const ra = blitOf(a, ep.unitId), rb = blitOf(b, ep.unitId);
      const exact = [[rb.x - ra.x, rb.y - ra.y]];
      const voteCands = [...st.votes.entries()]
        .sort((p, q) => q[1] - p[1])
        .slice(0, 8)
        .map(([k]) => [Number(k.split(',')[0]), Number(k.split(',')[1])]);
      const res = boxResidual(A, B, box, excl, [...exact, ...voteCands]);
      if (!best || diffPct > best.diffPct) {
        best = { tag, diffPct, residualPct: res.residualPct, bestD: res.bestD, loosePct, diff: st.diff, a, b };
      }
    }
    if (!lastBox) { warn(`片段 ${ep.unitId}(${ep.unitTypeId}) 没有可用帧对/框位，跳过`); continue; }
    /* ---- B1/B2/B4：精确闸（负向对照 2026-10-17 实测旧"残余"闸恒绿后新增，见文件头）---- */
    const unitOf = (fr) => fr?.scene?.units?.find((x) => x.id === ep.unitId) ?? null;
    const idleNm = `cu_${ep.unitTypeId}`;
    const atkNm = `${idleNm}_atk`;
    // B1 换帧：前帧名 = idle，某个进行帧名 = atk（lastFrame = 渲染器实际 blit 的帧）
    const preName = pre && unitOf(pre)?.frame ? unitOf(pre).frame.name : null;
    const swapSeen = inFr.some((f) => unitOf(f)?.frame?.name === atkNm);
    // 实际观测到的进行帧帧名（可能多个：插桩下恒 idle；正常下 idle→atk 混现）
    const inNames = [...new Set(inFr.map((f) => unitOf(f)?.frame?.name).filter(Boolean))];
    // B2 squash：进行帧落笔矩形 vs 图集帧自然尺寸（差 0 = 缩放没生效）
    let maxDevW = 0, maxDevH = 0, squashSeen = false, anchorOk = true, anchorWhy = '';
    // B2b 锚点：squash 必须"中心/底边"锚（代码注释："否则拉伸时单位会飘"）。
    //   横：blit 中心 - fx - lunge.dx - jerked 在两帧间应不变（±1：中心锚 ⇒ 缩放不挪
    //       中心；左/右锚会把 1.15 squash 的单位整体挪 ±5px）。bob 只改 y，不碍事。
    //   竖：blit 底边 - fy - lunge.dy 应不变（±3：idle 浮动相位差 ≤2 + 取整 ≤1；
    //       顶边锚会把 0.85 squash 的单位整体抬高 8px）。
    //   jerked 从 impacts 现场算（BattleRenderer.ts:625 的定义域 p<0.3）。
    const jerkedOf = (fr) =>
      ((fr?.scene?.impacts ?? []).some(([, , p, uid]) => uid === ep.unitId && p < 0.3) ? 2 : 0);
    const uaPre = pre ? unitOf(pre) : null;
    let anchorBase = null;
    if (uaPre && uaPre.bx !== null && pre && (!pre.l || pre.l.unitId !== ep.unitId)) {
      anchorBase = {
        x: uaPre.bx + uaPre.bw / 2 - uaPre.fx - jerkedOf(pre),
        y: uaPre.by + uaPre.bh - uaPre.fy,
      };
    }
    for (const f of inFr) {
      const u = unitOf(f);
      if (!u || u.bx === null || !u.frame) continue;
      const dw = u.bw - u.frame.w, dh = u.bh - u.frame.h;
      if (Math.abs(dw) > Math.abs(maxDevW)) maxDevW = dw;
      if (Math.abs(dh) > Math.abs(maxDevH)) maxDevH = dh;
      // 1.15/0.85 ⇒ 74×48（宽扁）/ 54×64（窄高）；k 插值中段只有 ±2~3。
      // 阈值取 2 而不是 4：sw=round(f.w*sx)，sx=1 时 dw 恒 0 ⇒ 任何 |dw|≥2 都是
      // 真实缩放（无假阳性来源）；取 4 会漏掉"只采到中段帧"的片段（踩过：大魔像
      // Δw=+3/Δh=-2 被判 ✗）。取整噪声 ±0.5，容不进 2。
      if ((dw >= 2 && dh <= -2) || (dw <= -2 && dh >= 2)) squashSeen = true;
      if (anchorBase) {
        const dx = u.bx + u.bw / 2 - u.fx - (f.l?.dx ?? 0) - jerkedOf(f) - anchorBase.x;
        const dy = u.by + u.bh - u.fy - (f.l?.dy ?? 0) - anchorBase.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 3) {
          anchorOk = false;
          if (!anchorWhy) anchorWhy = `帧对锚点漂移 dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}（中心±1/底边±3 之外）`;
        }
      }
    }
    // B4 屏幕=图集：内容差最大的 pre→in 安静帧对（两帧都真的画了本体）
    let b4 = null;
    if (pre) {
      for (const f of inFr) {
        if (!sceneQuiet(pre, f, ep.unitId)) continue;
        const ua = unitOf(pre), ub = unitOf(f);
        if (!ua?.frame || !ub?.frame || ua.bx === null || ub.bx === null) continue;
        if (ua.frame.name !== idleNm || ub.frame.name !== atkNm) continue; // 只验"真的换了帧"的对
        const cropA = cropFrame(ua.frame), cropB = cropFrame(ub.frame);
        const cd = cropDiff(cropA, cropB);
        if (cd.cmp < 400) continue;
        // 缩放帧的 dest→src 映射表：页面内实测（猜公式实测过会错，见 nnTable 注释）
        const tA = await nnTable(ua.frame.w, ua.frame.h, ua.bw, ua.bh);
        const tB = await nnTable(ub.frame.w, ub.frame.h, ub.bw, ub.bh);
        const exclA = [...exclOf(pre, f, ep.unitId), uiBand(pre, ep.unitId)].filter(Boolean);
        const exclB = [...exclOf(pre, f, ep.unitId), uiBand(f, ep.unitId)].filter(Boolean);
        const ma = screenVsAtlas(dec(pre), { x: ua.bx, y: ua.by, w: ua.bw, h: ua.bh }, ua.frame, cropA, exclA, tA, `pre ${ep.unitTypeId}`);
        const mb = screenVsAtlas(dec(f), { x: ub.bx, y: ub.by, w: ub.bw, h: ub.bh }, ub.frame, cropB, exclB, tB, `in ${ep.unitTypeId}`);
        if (!ma || !mb) continue; // 拿不到实测映射表 ⇒ 不猜，换下一对
        if (!b4 || cd.pct > b4.cd.pct) b4 = { a: pre, b: f, cd, ma, mb };
      }
    }
    rows.push({ ep, nIn: inFr.length, best, hasPre: !!pre, hasPost: !!post, quietPairs, box: lastBox, b1: { preName, swapSeen, inNames }, b2: { maxDevW, maxDevH, squashSeen, anchorOk, anchorWhy }, b4 });
    const sideTag = ep.side === 1 ? '守' : ep.side === 0 ? '攻' : '?';
    console.log(
      `  片段 ${sideTag}${ep.unitTypeId}: 进行帧 ${inFr.length}（pre ${pre ? '✓' : '—'} / post ${post ? '✓' : '—'} · 安静帧对 ${quietPairs}/${pairs.length} · 框 ${lastBox.x0},${lastBox.y0}-${lastBox.x1},${lastBox.y1}）` +
        (best
          ? ` · 最强帧对 ${best.tag} 框内差 ${best.diffPct.toFixed(1)}% · 最优平移(${best.bestD[0]},${best.bestD[1]})后仍剩 ${best.residualPct.toFixed(0)}%` +
            `（±20 任意偏移可解释 ${best.loosePct.toFixed(0)}%）`
          : ' · 无显著差异') +
        ` · B1 换帧 ${swapSeen ? '✓' : '✗'}（前帧 ${preName ?? '—'} → 进行帧实测 ${inNames.join('/') || '—'}${swapSeen ? '' : `，期望含 ${atkNm}`}）` +
        ` · B2 缩放 Δw=${maxDevW >= 0 ? '+' : ''}${maxDevW}/Δh=${maxDevH >= 0 ? '+' : ''}${maxDevH} ${squashSeen ? '✓' : '✗'}` +
        ` · B2b 锚点 ${anchorOk ? '✓' : '✗'}${anchorWhy ? `（${anchorWhy}）` : ''}` +
        (b4
          ? ` · B4 图集内容差 ${b4.cd.pct.toFixed(1)}% · 屏幕匹配 前帧 ${b4.ma.pct.toFixed(1)}%(${b4.ma.n}px) / 进行帧 ${b4.mb.pct.toFixed(1)}%(${b4.mb.n}px)`
          : ' · B4 无可用帧对'),
    );
    // B3 画面变化：硬门只认守方片段（攻方框有 chi_sel 光圈 alpha 脉冲污染，见文件头）。
    // 判据只留"框内差异 ≥6%"——旧判据里的"最优平移残余 ≥6%"已降级为旁证：
    // 负向对照实测残余有 9~28% 的不可约底噪（抗锯齿精灵边缘在纹理地面上平移永远
    // 解释不掉），拿它当硬门就是恒绿闸（2026-10-17 实证，见文件头）。
    if (ep.side === 1 && best && best.diffPct >= POSE_MIN_DIFF_PCT) {
      if (!poseHit || best.diffPct > poseHit.best.diffPct) poseHit = { ep, best };
    }
  }

  /* ---- C 软检：受击位移 H5③ = 冲击特效新鲜期内整图 +2 画布 px 右移。
     精确条件（不是"猜一个时间窗"）：同一单位的冲击 p 跨过 0.3
     （BattleRenderer.ts `im.p < 0.3` 就是 jerked=2 的定义域）。p 只增不减，
     跨窗方向恒为"窗内 → 出窗"，jerked 由 2 归 0 ⇒ 受击单位**落笔矩形必须
     精确左移 2px**（Δx=-2、Δw/Δh=0、fx/fy 不变 —— drawUnit 里只有 jerked
     这一项能在不动 fx/fy、不缩放的情况下挪 x；bob 只挪 y 且 ≤2）。
     主证 = 这个整数签名（渲染器确实把精灵画在了 +2 的位置）；像素比对为辅证
     （攻击方正在 lunge，它的残影可能污染框内像素，故豁免它的矩形恒定性）。
     ⚠️ 不要求两帧在 all[] 里相邻：直接取"窗内最后一帧 → 出窗后第一帧"，
        摆脱抓帧节奏对跨窗采样的依赖（旧版依赖相邻帧跨边界，实测 5 次窗内
        采样 0 次跨上，2026-10-18）。 ---- */
  const JR = 2;
  const jerkPairs = [];
  const cWhy = { windows: 0, noExitFrame: 0, quietFx: 0, quietOther: 0, quietOverlay: 0, quietHex: 0, noBox: 0, sigBad: 0, diffSmall: 0, looseLow: 0, kept: 0 };
  const lunging = (fr, id) => !!fr?.l && fr.l.unitId === id;
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    if (!a.scene) continue;
    for (const [ix, iy, p, uid] of a.scene.impacts) {
      if (!uid || p >= 0.3) continue;
      // 出窗第一帧：同一 uid 的冲击消失或 p≥0.3
      let b = null;
      for (let k = i + 1; k < all.length; k++) {
        const q = (all[k].scene?.impacts ?? []).find((t) => t[3] === uid);
        if (!q || q[2] >= 0.3) { b = all[k]; break; }
      }
      cWhy.windows++;
      if (!b) { cWhy.noExitFrame++; continue; }
      const ua = a.scene.units.find((x) => x.id === uid);
      const ub = b.scene.units.find((x) => x.id === uid);
      if (!ua || !ub || ua.fx !== ub.fx || ua.fy !== ub.fy || ua.bx === null || ub.bx === null) { cWhy.quietFx++; continue; }
      // 其他单位：矩形整数一致，或正在 lunge（攻击方豁免——它的运动是已知演出）
      const othersQuiet = a.scene.units.every((x) => {
        if (x.id === uid || x.bx === null) return true;
        const y = b.scene.units.find((z) => z.id === x.id);
        if (!y || y.bx === null) return false;
        if (x.bx === y.bx && x.by === y.by && x.bw === y.bw && x.bh === y.bh) return true;
        return lunging(a, x.id) || lunging(b, x.id);
      });
      if (!othersQuiet) { cWhy.quietOther++; continue; }
      if (JSON.stringify(Object.keys(a.scene.overlays ?? {}).sort()) !== JSON.stringify(Object.keys(b.scene.overlays ?? {}).sort())) { cWhy.quietOverlay++; continue; }
      if (JSON.stringify(a.scene.activeHex ?? null) !== JSON.stringify(b.scene.activeHex ?? null)) { cWhy.quietHex++; continue; }
      const jbx = boxForPair(a, b, uid);
      if (!jbx) { cWhy.noBox++; continue; }
      const ra = blitOf(a, uid), rb = blitOf(b, uid);
      if (!ra || !rb) { cWhy.noBox++; continue; }
      // 整数签名：Δx=-2（jerked 2→0）、|Δy|≤2（bob 相位差）、尺寸不变
      if (rb.x - ra.x !== -JR || Math.abs(rb.y - ra.y) > 2 || rb.w !== ra.w || rb.h !== ra.h) { cWhy.sigBad++; continue; }
      const A = dec(a), B = dec(b);
      const idx = colorIndex(B, { x0: jbx.x0 - CAND_RANGE, y0: jbx.y0 - CAND_RANGE, x1: jbx.x1 + CAND_RANGE, y1: jbx.y1 + CAND_RANGE });
      const excl = exclOf(a, b, uid);
      const st = boxDiffIdx(A, B, jbx, CAND_RANGE, idx, excl);
      if (st.diff < 12 || st.area === 0) { cWhy.diffSmall++; continue; }
      // 辅证：框内差异应能被这个精确位移解释（攻击方残影污染时可能不过，仅记录不拦）
      const res = boxResidual(A, B, jbx, excl, [[rb.x - ra.x, rb.y - ra.y]]);
      cWhy.kept++;
      jerkPairs.push({
        unit: ua.unitTypeId,
        diffPct: (st.diff / st.area) * 100,
        explPct: (st.loose / st.diff) * 100,
        bestD: [rb.x - ra.x, rb.y - ra.y],
        residualPct: res.residualPct,
        a, b,
      });
    }
  }
  if (process.env.TP5_C_DEBUG === '1') {
    console.log(`  [C debug] 跨 0.3 候选的拒绝归因：${JSON.stringify(cWhy)}`);
  }
  if (jerkPairs.length) {
    const j = jerkPairs.reduce((m, x) => (x.diffPct > m.diffPct ? x : m));
    jerkHit = j;
    writeFileSync(path.join(OUT_DIR, 'tp5-jerk-a.png'), j.a.raw);
    writeFileSync(path.join(OUT_DIR, 'tp5-jerk-b.png'), j.b.raw);
    console.log(`  💾 tp5-jerk-a/b.png（受击单位 ${j.unit}，冲击 p 跨 0.3 前后）`);
  }

  /* ---- B 段硬闸汇总（B1 换帧 / B2 squash / B3 画面变化 / B4 屏幕=图集）---- */
  const defRows = rows.filter((r) => r.ep.side === 1);
  const nSwap = defRows.filter((r) => r.b1.swapSeen).length;
  if (nSwap > 0) {
    ok(
      `B1 换帧实证：${nSwap}/${defRows.length} 个守方片段的进行帧 blit 的是 cu_*_atk 帧（前帧 cu_*）` +
        ' —— atk 帧真的画出去了（"帧烘焙了但渲染器从不 blit"就是 TP-5 之前的状态，画面像素分不出它和"位移更大"）',
    );
  } else if (defRows.length > 0) {
    bad(
      `B1 换帧未实证：${defRows.length} 个守方片段没有一个的进行帧 name=cu_*_atk` +
        ' —— 渲染器没换帧（选帧逻辑回退了？lastFrame 钩子没暴露？）',
    );
  } else {
    // 覆盖闸：守方 lunge 段落存在却一个可判帧都没有 = 缺帧静默跳过（本项目治过的病），
    // 不许因为"没数据"就当过 —— B1 数的是可判帧，没数据时必须红。
    bad(
      nDef > 0
        ? `B1 换帧未实证：${nDef} 个守方 lunge 片段全部没有可用帧/框位（逐片的 warn 行）—— 缺帧静默跳过，换帧无从验证`
        : 'B1 换帧未实证：没有守方 lunge 片段（auto 只打了攻方？）—— 换帧无从验证',
    );
  }
  const squashRows = defRows.filter((r) => r.b2.squashSeen);
  const anchorBad = defRows.filter((r) => !r.b2.anchorOk);
  if (squashRows.length > 0 && anchorBad.length === 0) {
    const mw = squashRows.reduce((m, r) => (Math.abs(r.b2.maxDevW) > Math.abs(m) ? r.b2.maxDevW : m), 0);
    const mh = squashRows.reduce((m, r) => (Math.abs(r.b2.maxDevH) > Math.abs(m) ? r.b2.maxDevH : m), 0);
    ok(
      `B2 squash&stretch 实证：${squashRows.length}/${defRows.length} 个守方片段的进行帧落笔矩形偏离图集帧自然尺寸` +
        `（最大 Δw=${mw >= 0 ? '+' : ''}${mw} / Δh=${mh >= 0 ? '+' : ''}${mh}；1.15×/0.85× ⇒ 74×48 或 54×64），` +
        '且锚点守恒（中心不挪 ±1、底边不挪 ±3 ⇒ 不是"整个图漂移"式的假缩放）',
    );
  } else if (anchorBad.length > 0) {
    bad(
      `B2b 锚点漂移：${anchorBad.length}/${defRows.length} 个守方片段的缩放帧不满足中心/底边锚（${anchorBad[0].b2.anchorWhy}）` +
        ' —— 缩放生效了但锚点错了：拉伸时单位会"飘"（drawUnit 的 (f.w-sw)/2 与 (f.h-sh) 补偿项）',
    );
  } else if (defRows.length > 0) {
    bad(
      'B2 squash&stretch 未实证：所有守方进行帧的落笔矩形 = 图集帧自然尺寸（Δw/Δh 恒 0）' +
        ' —— lunge.sx/sy 没作用到 blit 上（BattleScreen.meleeAnim → drawUnit 的链条断了？）',
    );
  } else {
    // 覆盖闸：同 B1 —— 段落存在但无可判帧时必须红，不许静默跳过
    bad(
      nDef > 0
        ? `B2 squash 未实证：${nDef} 个守方 lunge 片段全部没有可用帧/框位（逐片的 warn 行）—— 缺帧静默跳过，缩放无从验证`
        : 'B2 squash 未实证：没有守方 lunge 片段（auto 只打了攻方？）—— 缩放无从验证',
    );
  }
  if (poseHit) {
    ok(
      `B3 画面变化实证：守方 ${poseHit.ep.unitTypeId} 片段帧对 ${poseHit.best.tag} 框内 ${poseHit.best.diffPct.toFixed(1)}% 像素变化` +
        `（最优平移(${poseHit.best.bestD[0]},${poseHit.best.bestD[1]}) 后仍剩 ${poseHit.best.residualPct.toFixed(0)}% —— 残余有 9~28% 抗锯齿底噪，仅旁证，见文件头）`,
    );
  } else if (nDef > 0) {
    bad(`B3 画面变化未实证：守方片段们没有框内 ≥${POSE_MIN_DIFF_PCT}% 变化的帧对 —— 攻击演出在画面上看不见`);
  } else {
    // 覆盖闸：无守方段落 = 没数据，同样不许静默当过
    bad('B3 画面变化未实证：没有守方 lunge 片段（auto 只打了攻方？）—— 攻击演出无从验证');
  }
  // B4 不限于守方：攻方帧同样过了同一套污染闸（飘字/火花/光圈都走排除区，
  // chi_sel 画在单位**下面**），实测攻方片段反而是样本最大的（守方片段常被相邻
  // 单位的精灵矩形挤到只剩几十像素——精灵 64 宽 > hex 间距 ~44，排除区必然重叠）。
  // 像素下限 60：再低就是"100% of 3 像素"的 Vacuous 通过；60 个 24bit 精确相等
  // 已经不可能靠巧合（错帧/错内容下每个像素 1/1670 万）。
  const b4Rows = rows.filter((r) => r.b4);
  const b4Pass = (r) => r.b4.cd.pct >= 8 && r.b4.ma.pct >= 95 && r.b4.mb.pct >= 95 && r.b4.ma.n >= 60 && r.b4.mb.n >= 60;
  const b4Hit = b4Rows.find(b4Pass) ?? null;
  if (b4Hit) {
    const b = b4Hit.b4;
    ok(
      `B4 屏幕=图集实证：${b4Hit.ep.side === 1 ? '守' : '攻'}方 ${b4Hit.ep.unitTypeId} pre→in 帧对 —— 屏幕上 ${b.ma.pct.toFixed(1)}% / ${b.mb.pct.toFixed(1)}%` +
        `（前帧 ${b.ma.n}px / 进行帧 ${b.mb.n}px 内部不透明像素）与图集逐字节相等，且两帧图集内容差 ${b.cd.pct.toFixed(1)}%` +
        ' ⇒ 屏幕上这一块就是 atk 帧本帧（不是 idle 帧、不是位移糊弄）',
    );
  } else if (b4Rows.length > 0) {
    const b = b4Rows.reduce((m, r) => (r.b4.cd.pct > m.b4.cd.pct ? r : m)).b4;
    bad(
      `B4 屏幕=图集未实证：最强 pre→in 对 —— 图集内容差 ${b.cd.pct.toFixed(1)}%（<8%）· 屏幕匹配 前帧 ${b.ma.pct.toFixed(1)}% /` +
        ` 进行帧 ${b.mb.pct.toFixed(1)}%（<95%）⇒ 屏幕上的不是图集里的 atk 帧，或 atk 帧与 idle 帧内容无差（烘焙回退？）`,
    );
  } else if (rows.length > 0) {
    bad(
      'B4 屏幕=图集未实证：没有可用的 pre→in 安静帧对 —— 两种因：① 场景安静闸全拦了（看逐片的"安静帧对 x/y"）' +
        ' ② 压根没有 idle→atk 换帧的帧对（看 B1 换帧行；阴性对照下就是这种）',
    );
  } else {
    // 覆盖闸：同 B1 —— 没数据也必须红
    bad(
      episodes.length > 0
        ? 'B4 屏幕=图集未实证：所有 lunge 片段都没有可用帧/框位（缺帧静默跳过？看 warn 行）'
        : 'B4 屏幕=图集未实证：没有 lunge 片段（auto 没打起来？钩子没暴露？）',
    );
  }
  if (jerkHit) ok(`受击位移实证（H5③）：${jerkHit.unit} 冲击 p 跨 0.3 时落笔矩形精确左移 2px（Δx=${jerkHit.bestD[0]}/Δy=${jerkHit.bestD[1]}、尺寸不变、fx/fy 不变）⇒ +2px 右抖确实画出来了（框内差 ${jerkHit.diffPct.toFixed(1)}%，精确位移可解释 ${jerkHit.explPct.toFixed(0)}%${jerkHit.residualPct > 30 ? '，残余高 = 攻击方 lunge 残影污染，签名仍精确' : ''}）`);
  else warn(`受击 +2px 右抖未命中（冲击 p 跨 0.3 的帧对 ${all.length > 1 ? '没采到' : '无帧'}；软项不判失败）—— 肉眼复核存图`);

  // 存图：差异最大的 2 个守方片段（各存 pre + 最强帧对前后）
  const top = rows.filter((r) => r.ep.side === 1 && r.best).sort((x, y) => y.best.diffPct - x.best.diffPct).slice(0, 2);
  for (const [n, r] of top.entries()) {
    if (r.ep.pre) writeFileSync(path.join(OUT_DIR, `tp5-atk-ep${n + 1}-pre.png`), r.ep.pre.raw);
    writeFileSync(path.join(OUT_DIR, `tp5-atk-ep${n + 1}-a.png`), r.best.a.raw);
    writeFileSync(path.join(OUT_DIR, `tp5-atk-ep${n + 1}-b.png`), r.best.b.raw);
    console.log(`  💾 tp5-atk-ep${n + 1}-{pre,a,b}.png（守方 ${r.ep.unitTypeId}，帧对 ${r.best.tag}，差 ${r.best.diffPct.toFixed(1)}%）`);
  }
  if (!top.length) warn('没有可存的守方面击片段');
  // B4 存图：屏幕=图集比对用的那一对（pre = idle 帧 / in = atk 帧）—— 肉眼复核时
  // 可以直接拿这两张和图集帧对照：单位应从"站姿"变成"攻击姿"。
  if (b4Rows.length) {
    const r = b4Rows.reduce((m, x) => (x.b4.cd.pct > m.b4.cd.pct ? x : m));
    writeFileSync(path.join(OUT_DIR, 'tp5-b4-pre.png'), r.b4.a.raw);
    writeFileSync(path.join(OUT_DIR, 'tp5-b4-in.png'), r.b4.b.raw);
    console.log(`  💾 tp5-b4-{pre,in}.png（守方 ${r.ep.unitTypeId}：图集内容差 ${r.b4.cd.pct.toFixed(1)}%，肉眼复核姿态变化）`);
  }

  console.log('\n' + (fail === 0 ? '✅ TP-5 量化验收全过（存图待肉眼复核）' : `❌ ${fail} 条硬断言失败`));
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error('失败：' + e.message);
  process.exitCode = 1;
} finally {
  await cleanup();
}
