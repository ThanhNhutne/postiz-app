#!/usr/bin/env bash
set -euo pipefail

PROFILE="${FACEBOOK_LOGIN_PROFILE:-default}"
export DISPLAY="${DISPLAY:-:99}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/facebook-worker-runtime}"

mkdir -p "$XDG_RUNTIME_DIR" /data/browser-profiles /data/screenshots
chmod 700 "$XDG_RUNTIME_DIR"

cleanup() {
  kill "${NOVNC_PID:-}" "${VNC_PID:-}" "${OPENBOX_PID:-}" "${XVFB_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

Xvfb "$DISPLAY" -screen 0 1440x1000x24 -ac -nolisten tcp &
XVFB_PID=$!
sleep 1

openbox >/tmp/openbox.log 2>&1 &
OPENBOX_PID=$!

x11vnc \
  -display "$DISPLAY" \
  -forever \
  -shared \
  -nopw \
  -rfbport 5900 \
  -listen 127.0.0.1 \
  >/tmp/x11vnc.log 2>&1 &
VNC_PID=$!

websockify \
  --web=/usr/share/novnc/ \
  0.0.0.0:6080 \
  127.0.0.1:5900 \
  >/tmp/novnc.log 2>&1 &
NOVNC_PID=$!

echo "NOVNC_READY http://127.0.0.1:6080/vnc.html"
echo "Complete Facebook login manually. This session never reads your password or 2FA secret."

node src/cli/login.mjs --profile "$PROFILE"
