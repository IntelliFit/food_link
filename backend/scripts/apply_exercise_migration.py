#!/usr/bin/env python3
"""
在本地通过直连 Postgres 执行 migrate_exercise_logs_and_task_type.sql。
需要环境变量 `DATABASE_URL`，或 `POSTGRESQL_*` 连接配置。
用法：cd backend && . .venv/bin/activate && python scripts/apply_exercise_migration.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import psycopg2
except ImportError:
    print("请先安装: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND / ".env")


def build_database_url_from_env() -> str:
    host = (os.getenv("POSTGRESQL_HOST") or "").strip()
    port = (os.getenv("POSTGRESQL_PORT") or "5432").strip()
    user = (os.getenv("POSTGRESQL_USER") or "").strip()
    password = (os.getenv("POSTGRESQL_PASSWORD") or "").strip()
    database = (os.getenv("POSTGRESQL_DATABASE") or "").strip()
    sslmode = (os.getenv("POSTGRESQL_SSLMODE") or "").strip()
    if not all([host, port, user, password, database]):
        return ""
    parts = [f"host={host}", f"port={port}", f"user={user}", f"password={password}", f"dbname={database}"]
    if sslmode:
        parts.append(f"sslmode={sslmode}")
    return " ".join(parts)


def main() -> int:
    url = (os.getenv("DATABASE_URL") or "").strip() or build_database_url_from_env()
    if not url:
        print(
            "未设置 DATABASE_URL，且 POSTGRESQL_* 连接配置不完整。请在 backend/.env 中补齐数据库连接信息。",
            file=sys.stderr,
        )
        return 1
    sql_path = BACKEND / "sql" / "migrate_exercise_logs_and_task_type.sql"
    sql = sql_path.read_text(encoding="utf-8")
    conn = psycopg2.connect(url)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
    finally:
        conn.close()
    print("迁移已执行:", sql_path.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
