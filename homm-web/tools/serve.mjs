import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fingerprint } from './_dist.mjs';

/* 被测构建目录（team-lead #164）：
 *   缺省 = `<cwd>/dist`（**逐字不变**，旧行为）；`DIST_DIR=<dir>` 指到任意构建目录
 *   ⇒ 跑门不必覆盖共用 `dist/`（`dist/` 是测量对象，重建须申报 / 单人一次）。 */
const root = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(process.cwd(), 'dist');
const port = Number(process.env.PORT ?? 5173);

/* ★ 首行打印「我服务的目录 + cwd + 指纹」（team-lead #164 要求③）：
 * 把"到底服务的是哪份 dist"从**靠人记得**变成**印在脸上**。 */
const _fp = fingerprint(root);
console.log(
  `[serve] dir=${root} · cwd=${process.cwd()} · fp=${_fp.sha256 ?? '(n/a)'}` +
    `${_fp.mtime ? ` · main.js.mtime=${_fp.mtime}` : ''}`,
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = path.join(root, 'index.html');
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(file).pipe(res);
});

/* ★ 后台跑时（agent 的 background task / 日志管道被宿主接管）stdout 随时可能 EPIPE。
 * Node 对 stream 的 'error' 是**未捕获即退出**，于是 dev server 会被"日志管道关了"
 * 这种跟服务无关的理由杀掉 —— 探针随后全部报"dev server 没在 5199 上跑"。
 * 服务本身与 stdout 无关，所以显式吞掉 EPIPE（其余错误照旧抛）。 */
for (const s of [process.stdout, process.stderr]) {
  s.on?.('error', (e) => {
    if (e && e.code === 'EPIPE') return;
    throw e;
  });
}

server.listen(port, '127.0.0.1', () => {
  console.log(`英雄之歌 → http://localhost:${port}`);
});
