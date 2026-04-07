#!/usr/bin/env python3
"""
在本地通过直连 Postgres 执行 migrate_exercise_logs_and_task_type.sql。
需要环境变量 SUPABASE_DB_URL 或 DATABASE_URL（Supabase 控制台 → Database → Connection string → URI）。
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


def main() -> int:
    url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
    if not url:
        print(
            "未设置 SUPABASE_DB_URL。请在 backend/.env 中添加数据库连接串（仅用于迁移，勿提交到仓库）。",
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
