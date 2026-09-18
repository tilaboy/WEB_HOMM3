#!/usr/bin/env bash
#
# phone-tunnel.sh —— 把「真机 WebView 调试通道」一键恢复可用。
#
# 为什么需要它：App 一旦退回后台，WebView 的 devtools 端点就不再响应
# （而且 `fetch` 会静默挂住，不报错）。每次要探真机都得重复
# 「唤醒 → 拉起 App → 找 socket → 重建转发」这四步，故固化成脚本。
#
# 用法：
#   tools/phone-tunnel.sh            # 默认端口 9222
#   tools/phone-tunnel.sh 9223
#
# 之后：
#   node tools/devprobe.mjs --port 9222 --file tools/probes/01-viewport.js
#
set -euo pipefail

PORT="${1:-9222}"
SDK="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$PATH:$SDK/platform-tools"

PKG=com.a2studio.thecodeofchivalry

S="$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
if [ -z "${S:-}" ]; then
  echo "✗ 没有已授权设备（adb devices 为空或全是 unauthorized）"
  adb devices -l
  exit 1
fi

adb -s "$S" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
adb -s "$S" shell wm dismiss-keyguard      >/dev/null 2>&1 || true
adb -s "$S" shell am start -n "$PKG/$PKG.MainActivity" >/dev/null 2>&1 || true

SOCK=""
for _ in $(seq 1 20); do
  SOCK="$(adb -s "$S" shell cat /proc/net/unix 2>/dev/null \
          | grep -o 'webview_devtools_remote_[0-9]*' | head -1 | tr -d '\r')"
  [ -n "$SOCK" ] && break
  sleep 1
done

if [ -z "$SOCK" ]; then
  echo "✗ 未找到 webview_devtools_remote_* —— App 是否带调试开关构建（CAP_WEBVIEW_DEBUG=1）？"
  exit 1
fi

adb -s "$S" forward --remove-all >/dev/null 2>&1 || true
adb -s "$S" forward "tcp:$PORT" "localabstract:$SOCK" >/dev/null

# 端点真的活着才算成功（socket 存在 ≠ 端点响应）
if curl -s --max-time 5 "http://127.0.0.1:$PORT/json/version" | grep -q Browser; then
  echo "✓ 通道就绪  device=$S  tcp:$PORT → $SOCK"
else
  echo "⚠︎ 转发已建立但端点未响应（App 可能仍不在前台；再跑一次通常可解决）"
  exit 1
fi
