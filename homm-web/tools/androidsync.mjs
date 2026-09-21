#!/usr/bin/env node
/**
 * androidsync.mjs —— 把 `dist/` 同步进安卓壳的 assets，**并断言同步真的成立**。
 *
 * ## 为什么需要（team-lead 新规矩）
 * 「**"落库"必须覆盖所有会被服务的副本**」。本仓库现在有**四层**：
 *   `src` → `dist`（不受 git 管）→ **`android/app/src/main/assets/public`（不受 git 管，
 *   且是这个 App 真正跑的东西）** → 真机安装包。
 * 2026-09-21 的实战教训：用户玩的是 **07:20 的旧包** —— 里面 `core/data/scenarios.js`
 * 根本不存在、「试玩场景」命中 0 ⇒「试玩下来对手智力没提升」的最直接解释就是**包是旧的**。
 * ⇒ 光"同步"不够，**同步必须带断言**：产物里的标记命中数须与 `dist` 相等，不等即 FAIL。
 *
 * ## 做什么
 *   1. `npx cap sync android`（= copy + update；把 `webDir: 'dist'` 并进 assets）；
 *   2. **逐文件 md5 比对**：`dist/` 里每个文件都必须在 assets 里、且内容一致；
 *   3. 另打印一组**标记命中数**（#137 入口 / banner / ④ halo），便于人读与归档。
 *   任一条不成立 ⇒ 非零退出，并**逐条列出**缺哪些、差在哪。
 *
 * ## 用法
 *   npm run build            # 先产出 dist/
 *   node tools/androidsync.mjs
 *   然后：cd android && ./gradlew assembleDebug   # 出包
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ASSETS = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public');

/** 归档用：一组能代表"最近几轮工作"的标记（命中数应与 dist 相等）。 */
const MARKERS = [
  ['ui/StartScreen.js', '试玩场景'], //        #137 入口（编译进 ui/StartScreen.js，**不在 main.js**）
  ['ui/HeroPanel.js', 'objectiveSection'], //  #137/#52 教学块
  ['main.js', 'obj-banner'], //                 3/3 非阻断 banner
  ['render/MapRenderer.js', 'NOGO_EDGE_INK'], //  ④(ii) 暗边墨
  ['render/MapRenderer.js', 'NOGO_EDGE_GLOW'], // ④(ii) 亮芯
  ['core/data/scenarios.js', 'tutorial'], //    试玩场景载体存在
];

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 12);

function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p));
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error(`✗ 前置不满足：找不到 ${DIST}（先 npm run build）`);
  process.exit(2);
}

// 1) 同步
console.log('▶ npx cap sync android');
try {
  execFileSync('npx', ['cap', 'sync', 'android'], { cwd: ROOT, stdio: 'inherit' });
} catch {
  console.error('✗ cap sync 失败');
  process.exit(1);
}

// 2) 逐文件 md5 比对（强断言）
if (!existsSync(ASSETS)) {
  console.error(`✗ 同步后仍找不到 assets 目录：${ASSETS}`);
  process.exit(1);
}
const files = walk(DIST);
const missing = [];
const diff = [];
for (const rel of files) {
  const a = path.join(DIST, rel);
  const b = path.join(ASSETS, rel);
  if (!existsSync(b)) {
    missing.push(rel);
    continue;
  }
  if (sha1(readFileSync(a)) !== sha1(readFileSync(b))) diff.push(rel);
}

// 3) 标记命中数（归档 / 人读）
console.log('\n标记命中数（dist / assets，应相等）：');
let markBad = 0;
for (const [rel, token] of MARKERS) {
  const read = (base) => {
    const p = path.join(base, rel);
    if (!existsSync(p)) return null;
    return readFileSync(p, 'utf8').split(token).length - 1;
  };
  const d = read(DIST);
  const s = read(ASSETS);
  const ok = d !== null && d === s;
  if (!ok) markBad++;
  console.log(`  ${ok ? '✓' : '✗'} ${rel} · 「${token}」= dist ${d} / assets ${s}`);
}

// 结论
const okAll = missing.length === 0 && diff.length === 0 && markBad === 0;
console.log(
  `\n对比 ${files.length} 个文件：缺失 ${missing.length} · 内容不一致 ${diff.length} · 标记不符 ${markBad}`,
);
if (!okAll) {
  if (missing.length) console.error(`✗ assets 缺文件：\n   ${missing.join('\n   ')}`);
  if (diff.length) console.error(`✗ 内容不一致：\n   ${diff.join('\n   ')}`);
  console.error('\n⇒ 安卓 assets ≠ dist（**"落库"未覆盖会被服务的副本**）。别出包。');
  process.exit(1);
}
console.log('\n✓ 安卓 assets ≡ dist（逐文件 md5 一致 + 标记命中数相等）。可以出包。');
