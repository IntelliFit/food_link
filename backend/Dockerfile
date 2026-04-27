# food_link 后端（FastAPI + run_backend 多进程 Worker）
#
# 构建（推荐在仓库根目录，构建上下文仅为 backend/）：
#   docker build -f backend/Dockerfile -t food-link-backend ./backend
#
# 运行（通过环境变量或挂载 env 文件注入密钥，勿把 .env 打进镜像）：
#   docker run --rm -p 3010:3010 --env-file path/to/.env food-link-backend

FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=3010 \
    HOST=0.0.0.0

WORKDIR /app

# Pillow 等常见二进制依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg62-turbo \
    zlib1g \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . .

EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD python -c "import os,urllib.request as u; u.urlopen('http://127.0.0.1:'+os.environ.get('PORT','3010')+'/api/health', timeout=4)"

CMD ["python", "run_backend.py"]
