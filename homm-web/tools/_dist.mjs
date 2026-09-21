/**
 * _dist.mjs —— 「**被测构建目录**」的**单一解析点**（team-lead #164）。
 *
 * ## 为什么有本文件（起因：把 `--dist` 补成通用能力）
 * `ux-ia` 先给 `iaaccept.mjs` 加了 `--dist=<dir>` ⇒ **跑门不必覆盖共用 `dist/`**
 * ⇒ 一举消灭「stale `dist` / 跑完被覆盖面」**整族问题**。team-lead 2026-09-21 把它升格为
 * 通用规矩：**任何"门 / 探针"不得把构建目录写死 `../dist`**。本文件即那次升格的落地点 ——
 * 所有门控共用**同一套**解析 / 指纹 / 端口 / 自起服务胶水，避免"同值多址"再长一遍。
 *
 * ## 三条不变量（与 #164 五条要求对齐）
 *   ① **缺省逐字不变**：`--dist` 与 `DIST_DIR` 都缺省时，解析结果 = 旧的 `../dist`
 *      （即 `<repo>/dist`）。**默认行为逐字不变** —— 谁不传 `--dist`，跑出来的和以前一样。
 *   ② **cwd 也影响指哪**（`serve.mjs` 用 `cwd/dist`）：故 `printHeader` 把 `cwd` **一并打印**，
 *      与解析出的 `dir` 并排，读的人一眼能看出"到底服务的是哪份"。
 *   ③ **指纹随行**：头行打印被测目录的 `sha256`（短）+ `main.js` 的 mtime ⇒ 读数可**绑构建**，
 *      不再出现"这份数是从哪份 dist 量出来的"说不清的情况。
 *
 * ## 用法（门控照抄）
 * ```js
 * import { distDir, distUrl, printHeader, freePort, serveInProcess } from './_dist.mjs';
 * const DIST = distDir();
 * printHeader(DIST, 'gate=smoke');            // 必须是**首行输出**
 * const u = (rel) => distUrl(rel, DIST);
 * const { createGame } = await import(u('core/map/generator.js'));
 * ```
 */
import net from 'node:net';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 本仓库根（`tools/` 的上一级）。 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 取 `--k=v` 形式的命令行参数（缺省 `d`）。 */
export function argOf(k, d = null, argv = process.argv) {
  const a = argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
}

/**
 * 被测构建目录。
 * 优先级：`--dist=<dir>` > env `DIST_DIR` > `<base>/dist`（= 旧的 `../dist`，**逐字不变**）。
 * 相对路径按 `base` 解（`path.resolve`）；绝对路径原样用（负测要传 `tmpdir` 绝对路径）。
 */
export function distDir({ base = REPO_ROOT, argv = process.argv, env = process.env } = {}) {
  const raw = argOf('dist', null, argv) ?? env.DIST_DIR ?? 'dist';
  return path.resolve(base, raw);
}

/** 把 `dist` 目录下的相对模块路径转成可 `await import()` 的 URL。 */
export function distUrl(rel, dir) {
  return new URL(rel, pathToFileURL(dir + path.sep).href).href;
}

/**
 * 被测目录指纹：对 **存在** 的 `main.js` / `style.css` / `index.html` 求 `sha256`（短）。
 * 缺 `main.js`（构建不完整 / 指错目录）⇒ `sha256 = null`，便于**双击可证**（见 `printHeader`）。
 */
export function fingerprint(dir, files = ['main.js', 'style.css', 'index.html']) {
  const present = files.filter((f) => existsSync(path.join(dir, f)));
  const h = createHash('sha256');
  let mtime = null;
  for (const f of [...present].sort()) {
    const p = path.join(dir, f);
    h.update(f).update('\0').update(readFileSync(p));
    if (f === 'main.js') mtime = statSync(p).mtime.toISOString();
  }
  return { dir, sha256: present.length ? h.digest('hex').slice(0, 16) : null, mtime, files: present };
}

/**
 * **首行输出**：`dir`（我服务的目录）+ `cwd`（也影响指哪）+ 指纹。
 * ⚠️ 调用点必须在任何其它 `console.log` **之前**。返回指纹对象供后续复用。
 */
export function printHeader(dir, extra = '') {
  const fp = fingerprint(dir);
  console.log(
    `[dist] dir=${fp.dir} · cwd=${process.cwd()} · fp=${fp.sha256 ?? '(n/a)'}` +
      `${fp.mtime ? ` · main.js.mtime=${fp.mtime}` : ''}${extra ? ` · ${extra}` : ''}`,
  );
  return fp;
}

/** 断言 `dir` 下存在 `rel`；缺 ⇒ 按本仓约定以 **exit 2** 报「前置不满足」（不吐模块解析栈）。 */
export function requireFile(dir, rel) {
  const p = path.join(dir, rel);
  if (!existsSync(p)) {
    console.error(`✗ 前置不满足：${p} 不存在 —— 先 npm run build（或 --dist=<dir> 指向隔离构建）。`);
    process.exit(2);
  }
  return p;
}

/** 取一个**空闲**端口（team-lead #164 要求②：自起服务不许复用已在跑的 5173）。 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

/** 等自起的 dev server 真的应答（`GET /` → 2xx）。返回 `true/false`，不抛。 */
export async function waitForServer(port, { tries = 80, intervalMs = 150 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch {
      /* 端口还没开，继续等 */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * **进程内**起 `serve.mjs` 指向 `dir`、监听 `port`（不 spawn 子进程 —— spawn 会被信号组连坐杀掉，
 * 退出码 137；`tintab.mjs` 已实测过）。返回是否就绪。
 * 用 `DIST_DIR`/`PORT` 两个 env 传参 ⇒ `serve.mjs` 的缺省分支**保持不变**。
 */
export async function serveInProcess(dir, port) {
  process.env.DIST_DIR = dir;
  process.env.PORT = String(port);
  await import('./serve.mjs');
  return await waitForServer(port);
}
