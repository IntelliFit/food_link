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

# 释放 3010：仅 pkill 父进程时，偶发子进程/旧 uvicorn 仍占端口，会导致新进程 bind 失败（见 backend-dev.log: address already in use）
PORT_FREE_TRIES=0
while lsof -iTCP:3010 -sTCP:LISTEN >/dev/null 2>&1; do
  PIDS=$(lsof -tiTCP:3010 -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "${PIDS}" ]; then
    echo "[restart-dev] port 3010 still in use, killing PIDs: ${PIDS}"
    kill -9 ${PIDS} 2>/dev/null || true
  fi
  PORT_FREE_TRIES=$((PORT_FREE_TRIES + 1))
  if [ "${PORT_FREE_TRIES}" -ge 15 ]; then
    echo "[restart-dev] warning: 3010 may still be busy after retries; backend start may fail"
    break
  fi
  sleep 0.3
done

echo "[restart-dev] starting npm run dev:backend -> backend-dev.log"
nohup npm run dev:backend >"$ROOT/backend-dev.log" 2>&1 &
echo "[restart-dev] starting npm run dev:weapp -> weapp-dev.log"
nohup npm run dev:weapp >"$ROOT/weapp-dev.log" 2>&1 &
echo "[restart-dev] done. tail -f backend-dev.log weapp-dev.log"
