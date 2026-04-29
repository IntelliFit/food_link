"""
一键执行 Supabase -> PostgreSQL/COS 迁移。

默认行为：
1) 执行数据库迁移（支持 --skip-existing）
2) 自动补齐测试集/会员奖励相关表 SQL
3) 执行对象存储迁移（支持 --skip-existing）

示例：
  python backend/scripts/migrate_one_click.py --env-file backend/.env
  python backend/scripts/migrate_one_click.py --env-file backend/.env --dry-run
  python backend/scripts/migrate_one_click.py --env-file backend/.env --db-only
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
SCRIPTS = BACKEND / "scripts"
DEFAULT_ENV = BACKEND / ".env"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="一键执行数据库+对象存储迁移")
    parser.add_argument("--env-file", default=str(DEFAULT_ENV), help="环境变量文件路径，默认 backend/.env")
    parser.add_argument("--dry-run", action="store_true", help="仅模拟迁移，不执行写入")
    parser.add_argument("--skip-existing", action="store_true", default=True, help="迁移时跳过已存在数据（默认开启）")
    parser.add_argument("--no-skip-existing", dest="skip_existing", action="store_false", help="关闭跳过已存在数据")
    parser.add_argument("--db-only", action="store_true", help="仅执行数据库迁移")
    parser.add_argument("--storage-only", action="store_true", help="仅执行对象存储迁移")
    parser.add_argument(
        "--fail-on-missing-target-table",
        action="store_true",
        help="数据库迁移时目标缺表直接失败（默认跳过缺表）",
    )
    parser.add_argument(
        "--skip-reward-sql",
        action="store_true",
        help="跳过自动执行 backend/sql/add_membership_reward_system.sql",
    )
    parser.add_argument(
        "--skip-test-dataset-sql",
        action="store_true",
        help="跳过自动执行 backend/sql/add_test_backend_datasets.sql",
    )
    args = parser.parse_args()
    if args.db_only and args.storage_only:
        raise SystemExit("--db-only 与 --storage-only 不能同时使用")
    return args


def run_command(cmd: list[str], cwd: Path) -> int:
    print(f"[RUN] {' '.join(cmd)}")
    return subprocess.call(cmd, cwd=str(cwd))


def run_bootstrap_sql(env_file: Path, sql_path: Path, label: str) -> int:
    load_dotenv(env_file)
    host = (os.getenv("POSTGRESQL_HOST") or "").strip()
    port = (os.getenv("POSTGRESQL_PORT") or "5432").strip()
    user = (os.getenv("POSTGRESQL_USER") or "").strip()
    password = (os.getenv("POSTGRESQL_PASSWORD") or "").strip()
    database = (os.getenv("POSTGRESQL_DATABASE") or "").strip()
    missing = [k for k, v in [
        ("POSTGRESQL_HOST", host),
        ("POSTGRESQL_PORT", port),
        ("POSTGRESQL_USER", user),
        ("POSTGRESQL_PASSWORD", password),
        ("POSTGRESQL_DATABASE", database),
    ] if not v]
    if missing:
        print(f"[WARN] 跳过{label} SQL：缺少环境变量 {', '.join(missing)}")
        return 0

    if not sql_path.exists():
        print(f"[WARN] 跳过{label} SQL：文件不存在 {sql_path}")
        return 0

    dsn = f"host={host} port={port} user={user} password={password} dbname={database}"
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = False
        with conn.cursor() as cur:
            cur.execute(sql_path.read_text(encoding="utf-8"))
        conn.commit()
        conn.close()
        print(f"[OK] 已执行{label} SQL: {sql_path}")
        return 0
    except Exception as err:  # noqa: BLE001
        print(f"[FAIL] {label} SQL 执行失败: {err}")
        return 1


def main() -> int:
    args = parse_args()
    env_file = Path(args.env_file)
    py = sys.executable

    db_script = SCRIPTS / "migrate_supabase_postgres_to_postgresql.py"
    storage_script = SCRIPTS / "migrate_supabase_storage_to_cos.py"

    if not db_script.exists():
        print(f"[FAIL] 数据库迁移脚本不存在: {db_script}")
        return 2
    if not storage_script.exists():
        print(f"[FAIL] 对象存储迁移脚本不存在: {storage_script}")
        return 2

    if not args.storage_only:
        if not args.dry_run and not args.skip_test_dataset_sql:
            dataset_sql_code = run_bootstrap_sql(
                env_file,
                BACKEND / "sql" / "add_test_backend_datasets.sql",
                "测试集表结构",
            )
            if dataset_sql_code != 0:
                return dataset_sql_code

        if not args.dry_run and not args.skip_reward_sql:
            reward_sql_code = run_bootstrap_sql(
                env_file,
                BACKEND / "sql" / "add_membership_reward_system.sql",
                "会员奖励",
            )
            if reward_sql_code != 0:
                return reward_sql_code

        db_cmd = [py, str(db_script), "--env-file", str(env_file)]
        if args.skip_existing:
            db_cmd.append("--skip-existing")
        if args.dry_run:
            db_cmd.append("--dry-run")
        if args.fail_on_missing_target_table:
            db_cmd.append("--fail-on-missing-target-table")
        db_code = run_command(db_cmd, ROOT)
        if db_code != 0:
            print(f"[FAIL] 数据库迁移失败，退出码: {db_code}")
            return db_code

    if not args.db_only:
        storage_cmd = [py, str(storage_script), "--env-file", str(env_file)]
        if args.skip_existing:
            storage_cmd.append("--skip-existing")
        if args.dry_run:
            storage_cmd.append("--dry-run")
        storage_code = run_command(storage_cmd, ROOT)
        if storage_code != 0:
            print(f"[FAIL] 对象存储迁移失败，退出码: {storage_code}")
            return storage_code

    print("[OK] 一键迁移执行完成")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

