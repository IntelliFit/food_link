#!/bin/bash
set -e

PROJECT_DIR="$1"
BRANCH="$2"
SERVICE_NAME="$3"

# 调试信息（部署日志中可见）
echo "[deploy] 当前用户: $(whoami) (UID=$(id -u))"
echo "[deploy] HOME: $HOME"

# 修复 git safe.directory 权限问题（非 root 用户需要）
if [ "$(id -u)" != "0" ]; then
    export HOME="${HOME:-/home/$(whoami)}"
    mkdir -p "$HOME"
    git config --global --add safe.directory "$PROJECT_DIR" 2>/dev/null || true
fi

BACKEND_DIR="$PROJECT_DIR/backend"
VENV_PYTHON="$BACKEND_DIR/venv/bin/python"

cd "$PROJECT_DIR"

echo "[deploy] 部署分支: $BRANCH"
echo "[deploy] 项目目录: $PROJECT_DIR"
echo "[deploy] 服务名: $SERVICE_NAME"

# 拉取最新代码
echo "[deploy] 拉取最新代码..."
git fetch origin
git reset --hard "origin/$BRANCH"

# 安装依赖
cd "$BACKEND_DIR"
if [ -f "requirements.txt" ]; then
    echo "[deploy] 安装/更新 Python 依赖..."
    $VENV_PYTHON -m pip install -q -r requirements.txt
fi

# 重启服务（root 直接执行，非 root 用 sudo）
echo "[deploy] 重启服务: $SERVICE_NAME"
if [ "$(id -u)" = "0" ]; then
    systemctl restart "${SERVICE_NAME}.service"
else
    sudo systemctl restart "${SERVICE_NAME}.service"
fi

echo "[deploy] ✅ 部署完成"
