#!/usr/bin/env node
/**
 * devprobe.mjs —— 对**真机 / 模拟器上的 Capacitor WebView** 执行任意 JS 并取回结果。
 *
 * 为什么需要它：`webContentsDebuggingEnabled=false` 的正式包从外部进不去，
 * 而安全区取值、DPR、帧时间、合成算子是否走 GPU 快路径这类问题
 * **在浏览器里测不出真值**（浏览器不注入 --safe-area-inset-*、
 * 且合成后端与 Android WebView 不同）。所以必须能对真机 WebView 下指令。
 *
 * 前提：
 *   1) 带调试开关构建：
 *        CAP_WEBVIEW_DEBUG=1 npm run build && CAP_WEBVIEW_DEBUG=1 npx cap sync android
 *        cd android && ./gradlew assembleDebug
 *   2) adb 已连接设备（adb devices 显示 device 而非 unauthorized）
 *   3) 端口转发到 WebView 的 devtools socket —— 用 --auto-forward 自动做，
 *      或手工： adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>
 *
 * 用法：
 *   node tools/devprobe.mjs --list                      # 列出可调试的页面
 *   node tools/devprobe.mjs --expr "1+1"                # 执行表达式
 *   node tools/devprobe.mjs --file bench.js             # 执行脚本文件（内容须是单个表达式或 IIFE）
 *   node tools/devprobe.mjs --auto-forward --expr "..."  # 自动找 pid 并做转发
 *
 * 退出码：0 成功 / 1 失败
 *
 * 说明：只依赖 Node 18+ 的全局 fetch 与 Node 22+ 的全局 WebSocket，**零第三方依赖**。
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const getFlag = (name) => argv.includes(`--${name}`);
const getOpt = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};

const PORT = Number(getOpt('port', '9222'));
const TIMEOUT = Number(getOpt('timeout', '30000'));
const AUTO_FORWARD = getFlag('auto-forward');
const LIST_ONLY = getFlag('list');
const SERIAL = getOpt('serial', null);

const adb = (...args) => {
  const base = SERIAL ? ['-s', SERIAL] : [];
  return execFileSync('adb', [...base, ...args], { encoding: 'utf8' }).trim();
};

/** 找到 WebView 的 devtools socket 名（形如 webview_devtools_remote_12345） */
function findSocket() {
  const out = adb('shell', 'cat', '/proc/net/unix');
  const names = [...out.matchAll(/(webview_devtools_remote_\d+)/g)].map((m) => m[1]);
  if (!names.length) throw new Error('没找到 webview_devtools_remote_* —— App 是否已启动？是否带调试开关构建？');
  return names[0];
}

function ensureForward() {
  if (!AUTO_FORWARD) return;
  const sock = findSocket();
  console.error(`[devprobe] 转发 tcp:${PORT} → ${sock}`);
  adb('forward', `tcp:${PORT}`, `localabstract:${sock}`.replace(/^localabstract:/, 'localabstract:') );
}

async function listTargets() {
  // ⚠️ 必须带超时：devtools 端点没起来时（App 不在前台 / socket 失效）
  // fetch 会**一直挂着**，整个进程最终被外部 SIGTERM 掉，而且一行输出都没有。
  // 实测踩过这个坑，所以这里强制 5s 超时。
  const res = await fetch(`http://127.0.0.1:${PORT}/json`, {
    signal: AbortSignal.timeout(5000),
  });
  return res.json();
}

/** 挑一个「页面」型 target（跳过 service worker / iframe） */
function pickTarget(targets) {
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!pages.length) throw new Error(`没有可用的 page target（共 ${targets.length} 个）`);
  // 优先选 Capacitor 的 https://localhost
  return pages.find((t) => /localhost|capacitor/i.test(t.url || '')) || pages[0];
}

function evaluate(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`超时 ${TIMEOUT}ms —— 表达式可能是死循环，或页面未就绪`));
    }, TIMEOUT);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression,
          returnByValue: true,
          awaitPromise: true,
          allowUnsafeEvalBlockedByCSP: true,
        },
      }));
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== 1) return; // 忽略 event 通知
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (msg.error) return reject(new Error(`CDP 错误: ${JSON.stringify(msg.error)}`));
      const r = msg.result || {};
      if (r.exceptionDetails) {
        return reject(new Error(`页面内异常: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`));
      }
      resolve(r.result?.value);
    });

    ws.addEventListener('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket 失败: ${e.message || e.type}`));
    });
  });
}

(async () => {
  try {
    ensureForward();

    const targets = await listTargets();
    if (LIST_ONLY) {
      console.log(JSON.stringify(targets.map((t) => ({ type: t.type, title: t.title, url: t.url })), null, 2));
      return;
    }

    const file = getOpt('file');
    const expr = getOpt('expr') ?? (file ? readFileSync(file, 'utf8') : null);
    if (!expr) {
      console.error('用法: devprobe.mjs (--expr "<js>" | --file <path>) [--port 9222] [--auto-forward] [--list]');
      process.exit(1);
    }

    const t = pickTarget(targets);
    console.error(`[devprobe] 目标: ${t.title || '(无标题)'} — ${t.url}`);
    const value = await evaluate(t.webSocketDebuggerUrl, expr);
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  } catch (err) {
    console.error(`[devprobe] 失败: ${err.message}`);
    process.exit(1);
  }
})();
