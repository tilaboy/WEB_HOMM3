/**
 * splash-downscale.mjs —— `#162` 把**母图**派生成 android res 现在的 **26 个 splash 变体**。
 *
 * 定位（team-lead 2026-09-21）：**本脚本只写 `homm-web/assets/`**，
 *   产出到 `assets/splash-variants/<与 res 同构的相对路径>`；
 *   **写进 `android/app/src/main/res/**` 由 `engineering-lead` 做**（那是它的域 + 出包链）。
 *
 * 规则（与 splash_spec.md 同一口径，可复算）：
 *   cover 缩放（k = max(tw/mw, th/mh)）+ **居中裁切**；
 *   重采样 = **面积平均（box / area-averaged）**，不是最近邻 ——
 *   理由：母图是整数倍放大过的像素画（每个"艺术像素"= k×k 屏像素），
 *   目标尺寸是**任意比例**（如 1920→800 = 0.4167）。最近邻在非整数比下会出现
 *   **像素宽窄不均**的抖动；面积平均 = Android/浏览器缩放同一算子，
 *   是"它在机器上会长什么样"的最忠实近似（代价：引入中间色 ⇒ 调色板变多，已实测并记录）。
 *
 * 用法：node splash-downscale.mjs
 * 产出：../splash-variants/**.png（26）+ ../splash-variants/_manifest.json
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'out');
const STAGE = path.join(WEB, 'assets/splash-variants');
const RES = path.join(WEB, 'android/app/src/main/res');

const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex');

/* ---- 目标清单：从现存 res 里**自己量**（不抄文档） ---- */
function variantTargets() {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/^splash.*\.png$/.test(e.name)) continue;
      const b = readFileSync(p);
      out.push({ rel: path.relative(RES, p), w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
    }
  };
  walk(RES);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/* ---- 面积平均重采样（cover + 居中裁切） ---- */
function resampleCover(src, sw, sh, tw, th) {
  const k = Math.max(tw / sw, th / sh);                  // cover
  const offX = (sw * k - tw) / 2, offY = (sh * k - th) / 2;
  const out = new Uint8ClampedArray(tw * th * 4);
  const cl = (v, hi) => Math.min(hi, Math.max(0, v));
  for (let y = 0; y < th; y++) {
    const sy0 = (y + offY) / k, sy1 = (y + 1 + offY) / k;
    const iy0 = Math.floor(sy0), iy1 = Math.ceil(sy1);
    for (let x = 0; x < tw; x++) {
      const sx0 = (x + offX) / k, sx1 = (x + 1 + offX) / k;
      const ix0 = Math.floor(sx0), ix1 = Math.ceil(sx1);
      let r = 0, g = 0, b = 0, a = 0, w = 0;
      for (let iy = iy0; iy < iy1; iy++) {
        const cy = Math.min(iy + 1, sy1) - Math.max(iy, sy0);
        if (cy <= 0) continue;
        for (let ix = ix0; ix < ix1; ix++) {
          const cx = Math.min(ix + 1, sx1) - Math.max(ix, sx0);
          if (cx <= 0) continue;
          const cw = cx * cy;
          const si = (cl(iy, sh - 1) * sw + cl(ix, sw - 1)) * 4;
          r += src[si] * cw; g += src[si + 1] * cw; b += src[si + 2] * cw; a += src[si + 3] * cw; w += cw;
        }
      }
      const o = (y * tw + x) * 4;
      out[o] = Math.round(r / w); out[o + 1] = Math.round(g / w); out[o + 2] = Math.round(b / w); out[o + 3] = Math.round(a / w);
    }
  }
  return out;
}

/** 解 PNG 回 RGBA（用本仓 lib 解，随母图回读） */
function decode(p) {
  const d = L.decodePng(readFileSync(p));
  return { w: d.width, h: d.height, rgba: d.rgba };
}

/* ---- 主流程 ---- */
const MASTERS = {
  land: path.join(OUT, 'splash_land_1920x1280.png'),
  landNight: path.join(OUT, 'splash_land_1920x1280_night.png'),
  port: path.join(OUT, 'splash_port_1280x1920.png'),
  portNight: path.join(OUT, 'splash_port_1280x1920_night.png'),
};
for (const [k, p] of Object.entries(MASTERS)) {
  if (!existsSync(p)) throw new Error(`缺母图 ${k}: ${p} —— 先跑 node splash.mjs`);
}

if (existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

const cache = {};
const getMaster = (k) => (cache[k] ||= decode(MASTERS[k]));

const isPortRel = (rel, w, h) => /^drawable-port/.test(rel) || h > w;
const manifest = { generatedAt: new Date().toISOString(), stageDir: 'homm-web/assets/splash-variants', masters: Object.fromEntries(Object.entries(MASTERS).map(([k, p]) => [k, md5(p)])), files: [] };

for (const v of variantTargets()) {
  const isPort = isPortRel(v.rel, v.w, v.h);
  const isNight = /night/.test(v.rel);
  const key = (isPort ? 'port' : 'land') + (isNight ? 'Night' : '');
  const m = getMaster(key);
  const px = resampleCover(m.rgba, m.w, m.h, v.w, v.h);
  const { buf, colors } = L.encodePngIndexed(v.w, v.h, px, 256);
  const dst = path.join(STAGE, v.rel);
  mkdirSync(path.dirname(dst), { recursive: true });
  writeFileSync(dst, buf);
  manifest.files.push({ rel: v.rel, size: `${v.w}x${v.h}`, master: key, bytes: buf.length, colors, md5: md5(dst) });
}

/* ---- 自检：尺寸/数量必须与现存 res **逐一相符** ---- */
const resList = variantTargets();
const stageList = manifest.files;
const dimOk = resList.length === stageList.length && resList.every((r, i) => r.rel === stageList[i].rel && `${r.w}x${r.h}` === stageList[i].size);
manifest.checks = {
  countMatches: resList.length === stageList.length,
  count: { res: resList.length, staged: stageList.length },
  relAndSizeMatchResExactly: dimOk,
  allDecodable: stageList.every((f) => {
    const d = decode(path.join(STAGE, f.rel));
    const [w, h] = f.size.split('x').map(Number);
    return d.w === w && d.h === h;
  }),
  maxColors: Math.max(...stageList.map((f) => f.colors)),
  totalBytes: stageList.reduce((s, f) => s + f.bytes, 0),
};

writeFileSync(path.join(STAGE, '_manifest.json'), JSON.stringify(manifest, null, 2));

/* ---- 对照：现存 res 里那 26 个占位图的总字节（说明"换掉省多少"） ---- */
let resBytes = 0;
for (const v of resList) resBytes += readFileSync(path.join(RES, v.rel)).length;

console.log(JSON.stringify({
  checks: manifest.checks,
  resPlaceholderTotalBytes: resBytes,
  stagedTotalBytes: manifest.checks.totalBytes,
  delta: `${(manifest.checks.totalBytes - resBytes).toLocaleString()} B（${(((manifest.checks.totalBytes - resBytes) / resBytes) * 100).toFixed(1)}%）`,
  sample: manifest.files.slice(0, 3),
}, null, 2));
