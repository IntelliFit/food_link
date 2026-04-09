#!/usr/bin/env bash
# 结束本机可能残留的 dev 进程后，用 nohup 在后台重启后端与小程序 watch。
# 日志：项目根目录 backend-dev.log、weapp-dev.log（*.log 已 gitignore）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[restart-dev] stopping run_backend.py / taro weapp watch..."
pkill -f "run_backend.py" 2>/dev/null || true
pkill -f "taro build --type weapp" 2>/dev/null || true
sleep 1

echo "[restart-dev] starting npm run dev:backend -> backend-dev.log"
nohup npm run dev:backend >"$ROOT/backend-dev.log" 2>&1 &
echo "[restart-dev] starting npm run dev:weapp -> weapp-dev.log"
nohup npm run dev:weapp >"$ROOT/weapp-dev.log" 2>&1 &
echo "[restart-dev] done. tail -f backend-dev.log weapp-dev.log"
