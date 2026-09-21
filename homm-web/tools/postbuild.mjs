import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

/* 输出目录（`#164`/`#155` 的 per-instance outDir）：
 *   缺省 = `dist`（**逐字不变**）；`--out=<dir>` 或 env `OUT_DIR` 可指到**隔离构建目录**（如 `dist-ad`）
 *   ⇒ 测量不必覆盖共用 `dist/`（`dist/` 是冻结构建，重建须申报 / 单人一次）。
 * 与之配套的 tsc 步骤：`npx tsc --outDir <dir>`（`dist-` 前缀目录已在 .gitignore）。 */
const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const root = process.cwd();
const outRel = arg('out', process.env.OUT_DIR ?? 'dist');
const dist = path.resolve(root, outRel);
const pub = path.join(root, 'public');

await mkdir(dist, { recursive: true });

// 把 public 下的静态资源并进 dist
for (const entry of await readdir(pub, { withFileTypes: true })) {
  const from = path.join(pub, entry.name);
  const to = path.join(dist, entry.name);
  if (entry.isDirectory()) {
    await rm(to, { recursive: true, force: true });
    await cp(from, to, { recursive: true });
  } else {
    await cp(from, to);
  }
}

// 样式表从 src 复制过去
await cp(path.join(root, 'src', 'style.css'), path.join(dist, 'style.css'));

console.log(`postbuild: 静态资源已合并到 ${outRel}/`);
