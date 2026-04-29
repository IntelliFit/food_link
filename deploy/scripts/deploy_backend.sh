#!/bin/bash
set -e

PROJECT_DIR="$1"
BRANCH="$2"
SERVICE_NAME="$3"

# 调试信息（部署日志中可见）
echo "[deploy] 当前用户: $(whoami) (UID=$(id -u))"
echo "[deploy] HOME: $HOME"
echo "[deploy] 部署分支: $BRANCH"
echo "[deploy] 项目目录: $PROJECT_DIR"
echo "[deploy] 服务名: $SERVICE_NAME"

# 修复 git safe.directory 权限问题（非 root 用户需要）
if [ "$(id -u)" != "0" ]; then
    export HOME="${HOME:-/home/$(whoami)}"
    mkdir -p "$HOME"
    git config --global --add safe.directory "$PROJECT_DIR" 2>/dev/null || true
fi

cd "$PROJECT_DIR"

# 查找 git 仓库根目录（支持 DEPLOY_PATH 是子目录的情况）
GIT_DIR=""
if [ -d "$PROJECT_DIR/.git" ]; then
  GIT_DIR="$PROJECT_DIR"
elif git rev-parse --show-toplevel >/dev/null 2>&1; then
  GIT_DIR="$(git rev-parse --show-toplevel)"
  echo "[deploy] git 仓库根目录: $GIT_DIR"
fi

# 拉取最新代码
if [ -n "$GIT_DIR" ]; then
  echo "[deploy] 拉取最新代码..."
  cd "$GIT_DIR"
  git fetch origin
  git reset --hard "origin/$BRANCH"
else
  echo "[deploy] ⚠️ 未找到 git 仓库，跳过代码拉取"
fi

# 确定 backend 目录：优先使用 PROJECT_DIR/backend，否则使用 PROJECT_DIR 本身
if [ -d "$PROJECT_DIR/backend" ]; then
  BACKEND_DIR="$PROJECT_DIR/backend"
  echo "[deploy] backend 目录: $BACKEND_DIR"
else
  BACKEND_DIR="$PROJECT_DIR"
  echo "[deploy] backend 目录（使用项目根）: $BACKEND_DIR"
fi

VENV_PYTHON="$BACKEND_DIR/venv/bin/python"

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
