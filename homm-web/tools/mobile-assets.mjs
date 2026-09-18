// 生成移动端图标 / 启动页的**源资产**（resources/），供 @capacitor/assets 消费。
//
//   node tools/mobile-assets.mjs
//   npx capacitor-assets generate --android \
//       --iconBackgroundColor '#3a2a14' --splashBackgroundColor '#1b1f24'
//
// 说明（规格 §2.6）：
// - 纹样直接复用 public/icon.svg 里的立方体 + 旗帜，保持像素/程序化观感，不做拟物。
// - 本机没有 rsvg-convert / ImageMagick，栅格化用 @capacitor/assets 自带的 sharp（含 librsvg）。
// - 背景色：图标 #3a2a14（深金，取自旗帜），启动页 #1b1f24（与 CSS --stone-3 / theme-color 一致）。
// - 输出为 PNG（iOS 日后要 1024×1024 无 alpha；Android 自适应图标用 foreground/background 分层）。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const resources = path.join(root, 'resources');

const ICON_BG = '#3a2a14';
const SPLASH_BG = '#1b1f24';
const DENSITY = 384; // 96 * 4 —— 先 4× 渲染再降采样，边缘更干净

const iconSvg = await readFile(path.join(root, 'public', 'icon.svg'), 'utf8');
// 去掉背景 <rect .../>，只留纹样，得到透明底 emblem
const emblemSvg = iconSvg.replace(/\s*<rect[^>]*\/>/, '');

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** 把 emblem 以 transparent 底、按 size×scale 居中渲染到 size×size。 */
async function emblemLayer(size, scale) {
  const inner = Math.round(size * scale);
  const rendered = await sharp(Buffer.from(emblemSvg), { density: DENSITY })
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: TRANSPARENT } })
    .composite([{ input: rendered, gravity: 'center' }])
    .png()
    .toBuffer();
}

/** emblem 居中叠在纯色底上。 */
async function emblemOn(size, scale, background) {
  const layer = await emblemLayer(size, scale);
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: layer, gravity: 'center' }])
    .png()
    .toBuffer();
}

await mkdir(resources, { recursive: true });

// Android 自适应图标：前景（透明，58% 留在安全区内）/ 背景（纯色）
await writeFile(path.join(resources, 'icon-foreground.png'), await emblemLayer(1024, 0.58));
await writeFile(
  path.join(resources, 'icon-background.png'),
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: ICON_BG } }).png().toBuffer(),
);
// 传统图标（非自适应上下文 / 回落）
await writeFile(path.join(resources, 'icon-only.png'), await emblemOn(1024, 0.66, ICON_BG));
// 启动页：2732×2732，居中构图，四周留 ≈32% 安全边（规格 §2.6 要求 ≥20%）
await writeFile(path.join(resources, 'splash.png'), await emblemOn(2732, 0.36, SPLASH_BG));
await writeFile(path.join(resources, 'splash-dark.png'), await emblemOn(2732, 0.36, SPLASH_BG));

console.log('mobile-assets: 已生成 resources/icon-*.png + splash*.png');
