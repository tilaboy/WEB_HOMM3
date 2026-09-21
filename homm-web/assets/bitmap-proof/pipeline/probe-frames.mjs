/**
 * probe-frames.mjs —— 只读探针：用**运行期真实渲染代码**（`dist/render/atlas.js` + `tools/_canvas.mjs` 垫片）
 * 把 `p1_lampbearer` 的 3 帧取出来，报**画布尺寸 / 不透明像素数 / alpha 直方图 / 颜色数**。
 *
 * 为什么先探再写 (e)：`asset-spec §3.3` 要求落盘 PNG-8 **alpha 只能是 0/255**，
 * 但那条**只约束 AI 落盘资产**（§3.3 订正），**不约束程序化精灵**。
 * 所以先量：程序化帧到底有没有半透明像素 —— 有半透明的话，
 * "存成 PNG-8"这一步本身就会改像素，那 (e) 的"0 差"就不成立，必须如实报。
 *
 * 用法（cwd = homm-web/）：node assets/bitmap-proof/pipeline/probe-frames.mjs
 */
import { installShim } from '../../../tools/_canvas.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..'); // homm-web/

installShim();
const { getAtlas } = await import(join(ROOT, 'dist/render/atlas.js'));

const FRAMES = [
  ['u_p1_lampbearer_map', 52, 44],
  ['cu_p1_lampbearer', 64, 56],
  ['cu_p1_lampbearer_atk', 64, 56],
];

const atlas = getAtlas();
console.log(`图集 ${atlas.canvas.width}x${atlas.canvas.height}\n`);
console.log('frame                        槽位      不透明  半透明(1..254)  全透明   颜色数');
for (const [name, w, h] of FRAMES) {
  const f = atlas.get(name);
  if (!f) {
    console.log(`${name}  MISSING`);
    continue;
  }
  const cv = document.createElement('canvas');
  cv.width = f.w;
  cv.height = f.h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
  let opaque = 0;
  let semi = 0;
  let zero = 0;
  const colors = new Set();
  const hist = new Map();
  for (let i = 0; i < f.w * f.h; i++) {
    const a = cv.buf[i * 4 + 3];
    hist.set(a, (hist.get(a) ?? 0) + 1);
    if (a === 0) zero++;
    else if (a === 255) opaque++;
    else semi++;
    if (a >= 128) colors.add((cv.buf[i * 4] << 16) | (cv.buf[i * 4 + 1] << 8) | cv.buf[i * 4 + 2]);
  }
  const alphaVals = [...hist.keys()].filter((a) => a !== 0 && a !== 255).sort((a, b) => a - b);
  console.log(
    `${name.padEnd(28)} ${String(f.w + 'x' + f.h).padEnd(9)} ${String(opaque).padStart(6)}  ` +
      `${String(semi).padStart(6)}          ${String(zero).padStart(6)}  ${String(colors.size).padStart(4)}` +
      (semi ? `   ← 半透明 alpha 值: ${alphaVals.slice(0, 12).join(',')}${alphaVals.length > 12 ? '…' : ''}` : ''),
  );
  console.log(`  槽位声明 ${w}x${h}  实测 ${f.w}x${f.h}  ${f.w === w && f.h === h ? '✔ 一致' : '✖ 不一致'}   锚点 ax=${f.ax} ay=${f.ay}`);
}
console.log('\n注：`u_*_map` / `cu_*` 的 alpha 若含 1..254 ⇒ "PNG-8 硬 alpha(0/255)" 会改像素，');
console.log('    ⇒ (e) 的"0 差"必须在 **不强制硬 alpha** 的那一版上成立，并另行报硬 alpha 版的差。');
