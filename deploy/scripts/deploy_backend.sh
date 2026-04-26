#!/bin/bash
set -e

PROJECT_DIR="/www/wwwroot/food/food_link/backend"
VENV_PYTHON="$PROJECT_DIR/venv/bin/python"

cd "$PROJECT_DIR"

# 拉取最新代码
git fetch origin
git reset --hard origin/main

# 安装依赖（可选：如果依赖经常变）
if [ -f "requirements.txt" ]; then
  $VENV_PYTHON -m pip install -r requirements.txt
fi

# 如有数据库迁移，在这里调用（举例）
# $VENV_PYTHON run_migration.py

# 重启 systemd 服务（下面第 5 步会创建）
systemctl restart food-backend.service
