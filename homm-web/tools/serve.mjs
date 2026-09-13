import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.join(process.cwd(), 'dist');
const port = Number(process.env.PORT ?? 5173);

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

server.listen(port, '127.0.0.1', () => {
  console.log(`英雄之歌 → http://localhost:${port}`);
});
