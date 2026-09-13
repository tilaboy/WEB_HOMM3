import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
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

console.log('postbuild: 静态资源已合并到 dist/');
