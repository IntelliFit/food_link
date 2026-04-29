"""
将当前 Supabase/Postgres 数据库迁移到自部署 PostgreSQL。

默认行为：
1) 通过 `pg_dump --schema-only` + `psql` 导出/导入 schema，尽量完整保留表、索引、约束、
   序列、函数、触发器（hooks）以及对象注释。
2) 再用 psycopg2 分批复制表数据。
3) 支持 `--dry-run` 模拟运行，支持 `--skip-existing` 在主键/唯一键存在时按行跳过。

环境变量（建议写在 backend/.env）：
- SUPABASE_DB_URL        源 Supabase/Postgres 连接串（优先）
- DATABASE_URL           源库连接串兜底
- POSTGRESQL_HOST        目标 PostgreSQL 主机
- POSTGRESQL_PORT        目标 PostgreSQL 端口
- POSTGRESQL_USER        目标 PostgreSQL 用户
- POSTGRESQL_PASSWORD    目标 PostgreSQL 密码
- POSTGRESQL_DATABASE    目标 PostgreSQL 数据库名

可选环境变量：
- POSTGRESQL_SSLMODE     目标库 sslmode（默认不传）
- PG_DUMP_PATH           显式指定 pg_dump 路径
- PSQL_PATH              显式指定 psql 路径

说明：
- 之所以要求 `pg_dump` / `psql`，是因为这条链路最稳妥，能把函数、触发器、注释等 schema
  对象一起迁过去，而不仅仅是数据行。
- 若开启 `--skip-existing`，脚本优先使用主键；若没有主键则退回到第一个非部分唯一索引。
  如果某张表既没有主键也没有可用唯一键，则无法安全做“按行跳过”：
  - 目标表为空：继续普通插入
  - 目标表非空：为了避免重复，整张表跳过并给出告警
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote

import psycopg2
from psycopg2 import sql
from psycopg2.extras import Json, execute_values
from dotenv import load_dotenv


BACKEND = Path(__file__).resolve().parent.parent
DEFAULT_ENV_FILE = BACKEND / ".env"


@dataclass
class RuntimeConfig:
    env_file: Path
    source_url: str
    target_url: str
    schema: str
    selected_tables: List[str]
    batch_size: int
    skip_existing: bool
    dry_run: bool
    schema_only: bool
    data_only: bool
    keep_schema_dump: bool
    pg_dump_path: str
    psql_path: str
    skip_missing_target_tables: bool


@dataclass
class TableResult:
    table: str
    source_rows: int = 0
    inserted_rows: int = 0
    skipped_rows: int = 0
    failed: bool = False
    note: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="将 Supabase/Postgres 全量迁移到自部署 PostgreSQL")
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_ENV_FILE),
        help="环境变量文件路径，默认 backend/.env",
    )
    parser.add_argument("--schema", default="public", help="迁移的 schema，默认 public")
    parser.add_argument("--tables", default="", help="仅迁移指定表，逗号分隔")
    parser.add_argument("--batch-size", type=int, default=1000, help="数据迁移批大小，默认 1000")
    parser.add_argument("--skip-existing", action="store_true", help="目标表已存在的行按主键/唯一键跳过")
    parser.add_argument("--dry-run", action="store_true", help="仅打印迁移计划，不实际执行")
    parser.add_argument("--schema-only", action="store_true", help="仅迁移 schema（不迁数据）")
    parser.add_argument("--data-only", action="store_true", help="仅迁移数据（不导入 schema）")
    parser.add_argument("--keep-schema-dump", action="store_true", help="保留中间 schema dump 文件便于排查")
    parser.add_argument("--pg-dump-path", default="", help="显式指定 pg_dump 可执行文件路径")
    parser.add_argument("--psql-path", default="", help="显式指定 psql 可执行文件路径")
    parser.add_argument(
        "--fail-on-missing-target-table",
        action="store_true",
        help="目标缺表时直接失败（默认跳过缺失表并继续）",
    )
    args = parser.parse_args()

    if args.schema_only and args.data_only:
        raise SystemExit("--schema-only 与 --data-only 不能同时使用")
    if args.batch_size <= 0:
        raise SystemExit("--batch-size 必须大于 0")
    return args


def parse_table_list(raw: str) -> List[str]:
    if not raw.strip():
        return []
    tables: List[str] = []
    for chunk in raw.split(","):
        table = chunk.strip()
        if not table:
            continue
        if "." in table:
            _, table = table.split(".", 1)
        tables.append(table)
    return tables


def build_postgresql_url(*, host: str, port: str, user: str, password: str, database: str, sslmode: str) -> str:
    encoded_user = quote(user, safe="")
    encoded_password = quote(password, safe="")
    encoded_database = quote(database, safe="")
    url = f"postgresql://{encoded_user}:{encoded_password}@{host}:{port}/{encoded_database}"
    if sslmode:
        url += f"?sslmode={quote(sslmode, safe='')}"
    return url


def resolve_executable(name: str, explicit_path: str) -> str:
    if explicit_path:
        if Path(explicit_path).exists():
            return explicit_path
        raise RuntimeError(f"指定的 {name} 路径不存在: {explicit_path}")

    from_path = shutil.which(name)
    if from_path:
        return from_path

    windows_roots = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")),
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")),
    ]
    candidate_dirs: List[Path] = []
    for root in windows_roots:
        candidate_dirs.extend(sorted(root.glob(r"PostgreSQL/*/bin"), reverse=True))
    for bin_dir in candidate_dirs:
        candidate = bin_dir / name
        if candidate.exists():
            return str(candidate)

    raise RuntimeError(
        f"未找到 {name}。请安装 PostgreSQL Client Tools，或通过 --{name.replace('.', '-').replace('_', '-')} "
        f"（或环境变量）显式指定路径。"
    )


def try_resolve_executable(name: str, explicit_path: str) -> str:
    try:
        return resolve_executable(name, explicit_path)
    except Exception:  # noqa: BLE001
        return explicit_path or name


def load_runtime_config(args: argparse.Namespace) -> RuntimeConfig:
    env_file = Path(args.env_file)
    load_dotenv(env_file)

    source_url = (os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL") or "").strip()
    target_host = (os.getenv("POSTGRESQL_HOST") or "").strip()
    target_port = (os.getenv("POSTGRESQL_PORT") or "5432").strip()
    target_user = (os.getenv("POSTGRESQL_USER") or "").strip()
    target_password = (os.getenv("POSTGRESQL_PASSWORD") or "").strip()
    target_database = (os.getenv("POSTGRESQL_DATABASE") or "").strip()
    target_sslmode = (os.getenv("POSTGRESQL_SSLMODE") or "").strip()

    missing = [
        name
        for name, value in [
            ("SUPABASE_DB_URL / DATABASE_URL", source_url),
            ("POSTGRESQL_HOST", target_host),
            ("POSTGRESQL_PORT", target_port),
            ("POSTGRESQL_USER", target_user),
            ("POSTGRESQL_PASSWORD", target_password),
            ("POSTGRESQL_DATABASE", target_database),
        ]
        if not value
    ]
    if missing:
        raise RuntimeError(f"缺少必需环境变量: {', '.join(missing)}")

    target_url = build_postgresql_url(
        host=target_host,
        port=target_port,
        user=target_user,
        password=target_password,
        database=target_database,
        sslmode=target_sslmode,
    )

    return RuntimeConfig(
        env_file=env_file,
        source_url=source_url,
        target_url=target_url,
        schema=args.schema,
        selected_tables=parse_table_list(args.tables),
        batch_size=args.batch_size,
        skip_existing=args.skip_existing,
        dry_run=args.dry_run,
        schema_only=args.schema_only,
        data_only=args.data_only,
        keep_schema_dump=args.keep_schema_dump,
        pg_dump_path=args.pg_dump_path.strip(),
        psql_path=args.psql_path.strip(),
        skip_missing_target_tables=not args.fail_on_missing_target_table,
    )


def redact_url(url: str) -> str:
    if "@" not in url or "://" not in url:
        return url
    prefix, rest = url.split("://", 1)
    credentials, suffix = rest.split("@", 1)
    if ":" in credentials:
        user, _ = credentials.split(":", 1)
        return f"{prefix}://{user}:***@{suffix}"
    return f"{prefix}://***@{suffix}"


def connect_db(url: str) -> psycopg2.extensions.connection:
    conn = psycopg2.connect(url, connect_timeout=10)
    conn.autocommit = False
    return conn


def list_tables(conn: psycopg2.extensions.connection, schema: str, selected_tables: Sequence[str]) -> List[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = %s
              AND c.relkind IN ('r', 'p')
            ORDER BY c.relname
            """,
            (schema,),
        )
        existing = [row[0] for row in cur.fetchall()]

    if not selected_tables:
        return existing

    existing_set = set(existing)
    missing = [table for table in selected_tables if table not in existing_set]
    if missing:
        raise RuntimeError(f"源库中未找到这些表: {', '.join(missing)}")
    return [table for table in existing if table in set(selected_tables)]


def list_fk_dependencies(
    conn: psycopg2.extensions.connection,
    schema: str,
    selected_tables: Sequence[str],
) -> List[Tuple[str, str]]:
    selected = set(selected_tables)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT
                tc.table_name AS child_table,
                ccu.table_name AS parent_table
            FROM information_schema.table_constraints tc
            JOIN information_schema.constraint_column_usage ccu
              ON tc.constraint_name = ccu.constraint_name
             AND tc.constraint_schema = ccu.constraint_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = %s
              AND ccu.table_schema = %s
            ORDER BY child_table, parent_table
            """,
            (schema, schema),
        )
        rows = [(row[0], row[1]) for row in cur.fetchall()]
    return [(child, parent) for child, parent in rows if child in selected and parent in selected]


def topological_sort_tables(tables: Sequence[str], dependencies: Sequence[Tuple[str, str]]) -> Tuple[List[str], List[str]]:
    graph: Dict[str, set[str]] = defaultdict(set)
    indegree: Dict[str, int] = {table: 0 for table in tables}

    for child, parent in dependencies:
        if child == parent:
            continue
        if child not in indegree or parent not in indegree:
            continue
        if child in graph[parent]:
            continue
        graph[parent].add(child)
        indegree[child] += 1

    queue = deque(sorted(table for table, degree in indegree.items() if degree == 0))
    ordered: List[str] = []
    while queue:
        table = queue.popleft()
        ordered.append(table)
        for child in sorted(graph.get(table, ())):
            indegree[child] -= 1
            if indegree[child] == 0:
                queue.append(child)

    remaining = sorted(table for table in tables if table not in ordered)
    return ordered + remaining, remaining


def count_table_rows(conn: psycopg2.extensions.connection, schema: str, table: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL("SELECT COUNT(*) FROM {}.{}").format(sql.Identifier(schema), sql.Identifier(table))
        )
        return int(cur.fetchone()[0])


def count_table_rows_if_exists(conn: psycopg2.extensions.connection, schema: str, table: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = %s
                  AND table_name = %s
            )
            """,
            (schema, table),
        )
        exists = bool(cur.fetchone()[0])
    if not exists:
        return 0
    return count_table_rows(conn, schema, table)


def table_exists(conn: psycopg2.extensions.connection, schema: str, table: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = %s
                  AND table_name = %s
            )
            """,
            (schema, table),
        )
        return bool(cur.fetchone()[0])


def get_column_specs(
    conn: psycopg2.extensions.connection,
    schema: str,
    table: str,
) -> List[Tuple[str, str, str]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name, data_type, udt_name
            FROM information_schema.columns
            WHERE table_schema = %s
              AND table_name = %s
              AND COALESCE(is_generated, 'NEVER') = 'NEVER'
            ORDER BY ordinal_position
            """,
            (schema, table),
        )
        return [(row[0], row[1], row[2]) for row in cur.fetchall()]


def get_copyable_columns(conn: psycopg2.extensions.connection, schema: str, table: str) -> List[str]:
    return [name for name, _, _ in get_column_specs(conn, schema, table)]


def get_conflict_candidates(
    conn: psycopg2.extensions.connection,
    schema: str,
    table: str,
) -> List[List[str]]:
    """
    返回可用于 ON CONFLICT(...) 的候选唯一键（只保留 indimmediate=true，排除 deferrable 约束）。
    排序策略：先非主键唯一索引，再主键；便于优先命中业务唯一键去重。
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT i.indexrelid, i.indisprimary, a.attname, cols.ord
            FROM pg_index i
            JOIN pg_class t ON t.oid = i.indrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord) ON TRUE
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = cols.attnum
            WHERE n.nspname = %s
              AND t.relname = %s
              AND i.indisunique
              AND i.indpred IS NULL
              AND i.indexprs IS NULL
              AND i.indimmediate
            ORDER BY i.indisprimary ASC, i.indexrelid, cols.ord
            """,
            (schema, table),
        )
        rows = cur.fetchall()
    if not rows:
        return []

    grouped: Dict[int, List[str]] = {}
    order: List[int] = []
    for index_id, _, attname, _ in rows:
        if index_id not in grouped:
            grouped[index_id] = []
            order.append(index_id)
        grouped[index_id].append(attname)
    return [grouped[index_id] for index_id in order]


def run_subprocess(command: List[str], *, env: Optional[Dict[str, str]] = None) -> None:
    result = subprocess.run(command, text=True, capture_output=True, env=env)
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        stdout = (result.stdout or "").strip()
        detail = stderr or stdout or "未知错误"
        raise RuntimeError(f"命令失败: {' '.join(command)}\n{detail}")


def adapt_value(value: object, *, data_type: str, udt_name: str) -> object:
    if value is None:
        return None
    if data_type in {"json", "jsonb"} and isinstance(value, (dict, list)):
        return Json(value, dumps=lambda v: json.dumps(v, ensure_ascii=False))
    return value


def adapt_row_values(
    rows: Sequence[Tuple[object, ...]],
    column_specs: Sequence[Tuple[str, str, str]],
) -> List[Tuple[object, ...]]:
    adapted_rows: List[Tuple[object, ...]] = []
    for row in rows:
        adapted_rows.append(
            tuple(
                adapt_value(value, data_type=data_type, udt_name=udt_name)
                for value, (_, data_type, udt_name) in zip(row, column_specs)
            )
        )
    return adapted_rows


def normalize_schema_dump(dump_path: Path) -> None:
    text = dump_path.read_text(encoding="utf-8")

    # 新建数据库默认已包含 public schema，pg_dump 的 CREATE SCHEMA public 会导致导入被中断。
    text = re.sub(
        r"^CREATE SCHEMA ([^\s;]+);$",
        r"CREATE SCHEMA IF NOT EXISTS \1;",
        text,
        flags=re.MULTILINE,
    )

    dump_path.write_text(text, encoding="utf-8")


def ensure_supabase_compat_objects(target_url: str) -> None:
    conn = connect_db(target_url)
    try:
        with conn.cursor() as cur:
            cur.execute("CREATE SCHEMA IF NOT EXISTS auth")
            cur.execute("CREATE SCHEMA IF NOT EXISTS extensions")
            cur.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions')
            cur.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions")
            cur.execute(
                """
                CREATE OR REPLACE FUNCTION auth.uid()
                RETURNS uuid
                LANGUAGE sql
                STABLE
                AS $$
                    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
                $$;
                """
            )
            cur.execute(
                """
                COMMENT ON FUNCTION auth.uid() IS
                'Supabase compatibility helper for migrated schema defaults';
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS auth.users (
                    id uuid PRIMARY KEY
                )
                """
            )
            cur.execute(
                """
                COMMENT ON TABLE auth.users IS
                'Minimal Supabase auth.users stub for migrated public foreign keys';
                """
            )
        conn.commit()
    finally:
        conn.close()


def seed_auth_users_stub(
    source_conn: psycopg2.extensions.connection,
    target_conn: psycopg2.extensions.connection,
) -> int:
    with source_conn.cursor() as source_cur:
        source_cur.execute(
            """
            SELECT DISTINCT user_id
            FROM (
                SELECT user_id FROM public.critical_samples
                UNION ALL
                SELECT user_id FROM public.meals
                UNION ALL
                SELECT user_id FROM public.staple_meals
            ) AS refs
            WHERE user_id IS NOT NULL
            ORDER BY user_id
            """
        )
        user_ids = [row[0] for row in source_cur.fetchall()]

    if not user_ids:
        return 0

    insert_sql = """
        INSERT INTO auth.users (id)
        VALUES %s
        ON CONFLICT (id) DO NOTHING
        RETURNING 1
    """
    with target_conn.cursor() as target_cur:
        inserted = execute_values(
            target_cur,
            insert_sql,
            [(user_id,) for user_id in user_ids],
            page_size=min(1000, len(user_ids)),
            fetch=True,
        )
    target_conn.commit()
    return len(inserted)


def target_schema_has_business_objects(target_url: str, schema: str) -> bool:
    conn = connect_db(target_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = %s
                      AND table_type = 'BASE TABLE'
                )
                """,
                (schema,),
            )
            return bool(cur.fetchone()[0])
    finally:
        conn.close()


def migrate_schema(config: RuntimeConfig) -> None:
    if config.data_only:
        return

    pg_dump_name = "pg_dump.exe" if os.name == "nt" else "pg_dump"
    psql_name = "psql.exe" if os.name == "nt" else "psql"

    if config.dry_run:
        pg_dump_path = try_resolve_executable(pg_dump_name, config.pg_dump_path)
        psql_path = try_resolve_executable(psql_name, config.psql_path)
    else:
        pg_dump_path = resolve_executable(pg_dump_name, config.pg_dump_path)
        psql_path = resolve_executable(psql_name, config.psql_path)

    table_args: List[str] = []
    for table in config.selected_tables:
        table_args.extend(["--table", f"{config.schema}.{table}"])

    dump_file = tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".sql",
        delete=False,
        encoding="utf-8",
    )
    dump_path = Path(dump_file.name)
    dump_file.close()

    try:
        pg_dump_cmd = [
            pg_dump_path,
            "--schema-only",
            "--no-owner",
            "--no-privileges",
            "--schema",
            config.schema,
            "--file",
            str(dump_path),
            *table_args,
            config.source_url,
        ]
        psql_cmd = [
            psql_path,
            config.target_url,
            "-v",
            "ON_ERROR_STOP=1",
            "-f",
            str(dump_path),
        ]

        if config.dry_run:
            print("[PLAN] 将通过 pg_dump + psql 迁移 schema（包含函数/触发器/注释）")
            print(f"[PLAN] pg_dump: {pg_dump_path}")
            print(f"[PLAN] psql:    {psql_path}")
            if config.selected_tables:
                print(f"[PLAN] 指定表: {', '.join(config.selected_tables)}")
            return

        if config.skip_existing and target_schema_has_business_objects(config.target_url, config.schema):
            ensure_supabase_compat_objects(config.target_url)
            print("[INFO] 目标库已存在业务表，且开启了 --skip-existing；跳过 schema 导入，直接继续数据补跑")
            return

        print("[INFO] 导出源库 schema（表/索引/约束/函数/触发器/注释）...")
        run_subprocess(pg_dump_cmd)
        normalize_schema_dump(dump_path)
        ensure_supabase_compat_objects(config.target_url)
        print("[INFO] 导入目标库 schema ...")
        run_subprocess(psql_cmd)
        print("[OK]   schema 迁移完成")
    finally:
        if config.keep_schema_dump:
            print(f"[INFO] 保留 schema dump 文件: {dump_path}")
        else:
            dump_path.unlink(missing_ok=True)


def set_user_triggers_enabled(
    conn: psycopg2.extensions.connection,
    schema: str,
    table: str,
    *,
    enabled: bool,
) -> None:
    action = "ENABLE" if enabled else "DISABLE"
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL("ALTER TABLE {}.{} {} TRIGGER USER").format(
                sql.Identifier(schema),
                sql.Identifier(table),
                sql.SQL(action),
            )
        )


def migrate_table_data(
    source_conn: psycopg2.extensions.connection,
    target_conn: psycopg2.extensions.connection,
    *,
    schema: str,
    table: str,
    batch_size: int,
    skip_existing: bool,
    dry_run: bool,
    skip_missing_target_tables: bool,
) -> TableResult:
    result = TableResult(table=table)
    result.source_rows = count_table_rows(source_conn, schema, table)
    target_exists = table_exists(target_conn, schema, table)
    if not target_exists:
        if skip_missing_target_tables:
            result.skipped_rows = result.source_rows
            result.note = "目标库缺少该表，已自动跳过（可先迁 schema 后再补跑）"
            return result
        result.failed = True
        result.note = f"目标库缺少表: {schema}.{table}"
        return result

    column_specs = get_column_specs(source_conn, schema, table)
    copyable_columns = [name for name, _, _ in column_specs]
    if not copyable_columns:
        result.note = "没有可写列，跳过"
        return result

    conflict_candidates = get_conflict_candidates(source_conn, schema, table) if skip_existing else []
    conflict_columns = conflict_candidates[0] if conflict_candidates else []
    target_rows_before = count_table_rows_if_exists(target_conn, schema, table) if skip_existing else 0

    if skip_existing and not conflict_columns and target_rows_before > 0:
        result.skipped_rows = result.source_rows
        result.note = "缺少主键/唯一键且目标表非空，为避免重复整表跳过"
        return result

    if dry_run:
        note = []
        if skip_existing:
            if conflict_columns:
                note.append(
                    f"冲突键: {', '.join(conflict_columns)}"
                    + (f"（共 {len(conflict_candidates)} 组候选）" if len(conflict_candidates) > 1 else "")
                )
            elif target_rows_before == 0:
                note.append("目标表为空，无主键/唯一键时仍可首次导入")
            else:
                note.append("目标非空且无可用冲突键，将整表跳过")
        result.note = "；".join(note)
        return result

    source_cursor_name = f"migrate_{table}"[:55]
    column_identifiers = sql.SQL(", ").join(sql.Identifier(col) for col in copyable_columns)
    select_query = sql.SQL("SELECT {} FROM {}.{}").format(
        column_identifiers,
        sql.Identifier(schema),
        sql.Identifier(table),
    )
    base_insert = sql.SQL("INSERT INTO {}.{} ({}) VALUES %s").format(
        sql.Identifier(schema),
        sql.Identifier(table),
        column_identifiers,
    )

    if skip_existing and conflict_columns:
        conflict_sql = sql.SQL(", ").join(sql.Identifier(col) for col in conflict_columns)
        insert_query = (
            base_insert
            + sql.SQL(" ON CONFLICT ({}) DO NOTHING RETURNING 1").format(conflict_sql)
        ).as_string(target_conn)
    else:
        insert_query = base_insert.as_string(target_conn)

    triggers_disabled = False
    source_cur = source_conn.cursor(name=source_cursor_name)
    source_cur.itersize = batch_size

    try:
        source_cur.execute(select_query)
        try:
            set_user_triggers_enabled(target_conn, schema, table, enabled=False)
            triggers_disabled = True
        except Exception as err:  # noqa: BLE001
            target_conn.rollback()
            print(f"[WARN] {table}: 禁用用户触发器失败，将继续迁移 | {err}")

        with target_conn.cursor() as target_cur:
            while True:
                rows = source_cur.fetchmany(batch_size)
                if not rows:
                    break
                adapted_rows = adapt_row_values(rows, column_specs)

                if skip_existing and conflict_columns:
                    inserted_rows = len(
                        execute_values(
                            target_cur,
                            insert_query,
                            adapted_rows,
                            page_size=len(adapted_rows),
                            fetch=True,
                        )
                    )
                    result.inserted_rows += inserted_rows
                    result.skipped_rows += len(adapted_rows) - inserted_rows
                else:
                    execute_values(target_cur, insert_query, adapted_rows, page_size=len(adapted_rows))
                    result.inserted_rows += len(adapted_rows)

        target_conn.commit()
        source_conn.commit()
        return result
    except Exception as err:  # noqa: BLE001
        target_conn.rollback()
        source_conn.rollback()
        result.failed = True
        result.note = str(err)
        return result
    finally:
        try:
            source_cur.close()
        except Exception:  # noqa: BLE001
            pass
        if triggers_disabled:
            try:
                with target_conn.cursor() as cur:
                    cur.execute(
                        sql.SQL("ALTER TABLE {}.{} ENABLE TRIGGER USER").format(
                            sql.Identifier(schema),
                            sql.Identifier(table),
                        )
                    )
                target_conn.commit()
            except Exception as err:  # noqa: BLE001
                target_conn.rollback()
                print(f"[WARN] {table}: 恢复用户触发器失败，请手动检查 | {err}")


def sync_sequences(
    conn: psycopg2.extensions.connection,
    *,
    schema: str,
    selected_tables: Sequence[str],
    dry_run: bool,
) -> None:
    selected = set(selected_tables)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                seq_ns.nspname AS sequence_schema,
                seq.relname AS sequence_name,
                tbl.relname AS table_name,
                att.attname AS column_name
            FROM pg_class seq
            JOIN pg_namespace seq_ns ON seq_ns.oid = seq.relnamespace
            JOIN pg_depend dep ON dep.objid = seq.oid
            JOIN pg_class tbl ON tbl.oid = dep.refobjid
            JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
            JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = dep.refobjsubid
            WHERE seq.relkind = 'S'
              AND dep.deptype IN ('a', 'i')
              AND tbl_ns.nspname = %s
            ORDER BY tbl.relname, seq.relname
            """,
            (schema,),
        )
        rows = cur.fetchall()

    for sequence_schema, sequence_name, table_name, column_name in rows:
        if table_name not in selected:
            continue
        if dry_run:
            print(f"[PLAN] 将校准序列: {sequence_schema}.{sequence_name} <- {table_name}.{column_name}")
            continue

        with conn.cursor() as cur:
            cur.execute(
                sql.SQL("SELECT COALESCE(MAX({}), 0) FROM {}.{}").format(
                    sql.Identifier(column_name),
                    sql.Identifier(schema),
                    sql.Identifier(table_name),
                )
            )
            max_value = int(cur.fetchone()[0] or 0)
            cur.execute(
                sql.SQL("SELECT setval(%s, %s, %s)"),
                (f"{sequence_schema}.{sequence_name}", max_value if max_value > 0 else 1, max_value > 0),
            )
        conn.commit()


def print_plan(
    *,
    config: RuntimeConfig,
    ordered_tables: Sequence[str],
    cyclic_tables: Sequence[str],
    source_conn: psycopg2.extensions.connection,
    target_conn: psycopg2.extensions.connection,
) -> None:
    print("===== 迁移计划 =====")
    print(f"源库: {redact_url(config.source_url)}")
    print(f"目标库: {redact_url(config.target_url)}")
    print(f"schema: {config.schema}")
    print(f"批大小: {config.batch_size}")
    print(f"skip-existing: {'开启' if config.skip_existing else '关闭'}")
    print(f"dry-run: {'开启' if config.dry_run else '关闭'}")
    print("")
    if cyclic_tables:
        print(f"[WARN] 发现循环依赖表，后续将按名称兜底排序: {', '.join(cyclic_tables)}")

    total_rows = 0
    for table in ordered_tables:
        source_rows = count_table_rows(source_conn, config.schema, table)
        total_rows += source_rows
        line = f"[PLAN] {table}: 源 {source_rows} 行"
        target_exists = table_exists(target_conn, config.schema, table)
        if not target_exists:
            line += " | 目标缺表"
            if config.skip_missing_target_tables:
                line += " | 将自动跳过"
            else:
                line += " | 将报错失败"
            print(line)
            continue
        if config.skip_existing:
            conflict_candidates = get_conflict_candidates(source_conn, config.schema, table)
            conflict_columns = conflict_candidates[0] if conflict_candidates else []
            target_rows = count_table_rows_if_exists(target_conn, config.schema, table)
            if conflict_columns:
                line += f" | 目标 {target_rows} 行 | 冲突键 {', '.join(conflict_columns)}"
                if len(conflict_candidates) > 1:
                    line += f"（候选 {len(conflict_candidates)} 组）"
            else:
                line += f" | 目标 {target_rows} 行 | 无可用主键/唯一键"
        print(line)
    print("")
    print(f"计划迁移表数: {len(ordered_tables)}")
    print(f"源总行数: {total_rows}")


def main() -> int:
    args = parse_args()
    try:
        config = load_runtime_config(args)
    except Exception as err:  # noqa: BLE001
        print(f"配置错误: {err}", file=sys.stderr)
        return 2

    try:
        source_conn = connect_db(config.source_url)
        target_conn = connect_db(config.target_url)
    except Exception as err:  # noqa: BLE001
        print(f"数据库连接失败: {err}", file=sys.stderr)
        return 2

    try:
        tables = list_tables(source_conn, config.schema, config.selected_tables)
        if not tables:
            print("未发现可迁移的表。")
            return 0

        dependencies = list_fk_dependencies(source_conn, config.schema, tables)
        ordered_tables, cyclic_tables = topological_sort_tables(tables, dependencies)

        print_plan(
            config=config,
            ordered_tables=ordered_tables,
            cyclic_tables=cyclic_tables,
            source_conn=source_conn,
            target_conn=target_conn,
        )

        migrate_schema(config)
        if config.schema_only:
            print("\n===== 迁移完成 =====")
            print("已完成 schema 迁移。")
            return 0

        if not config.dry_run:
            seeded_auth_users = seed_auth_users_stub(source_conn, target_conn)
            print(f"[INFO] 预填充 auth.users 占位行: {seeded_auth_users}")

        total_source_rows = 0
        total_inserted = 0
        total_skipped = 0
        failed_tables: List[TableResult] = []

        for table in ordered_tables:
            result = migrate_table_data(
                source_conn,
                target_conn,
                schema=config.schema,
                table=table,
                batch_size=config.batch_size,
                skip_existing=config.skip_existing,
                dry_run=config.dry_run,
                skip_missing_target_tables=config.skip_missing_target_tables,
            )
            total_source_rows += result.source_rows
            total_inserted += result.inserted_rows
            total_skipped += result.skipped_rows

            if result.failed:
                failed_tables.append(result)
                print(f"[FAIL] {table} | {result.note}")
                continue

            if config.dry_run:
                suffix = f" | {result.note}" if result.note else ""
                print(f"[PLAN] {table}: 源 {result.source_rows} 行{suffix}")
            elif result.note:
                print(
                    f"[SKIP] {table}: 源 {result.source_rows} 行，插入 {result.inserted_rows} 行，"
                    f"跳过 {result.skipped_rows} 行 | {result.note}"
                )
            else:
                print(
                    f"[OK]   {table}: 源 {result.source_rows} 行，插入 {result.inserted_rows} 行，"
                    f"跳过 {result.skipped_rows} 行"
                )

        sync_sequences(
            target_conn,
            schema=config.schema,
            selected_tables=ordered_tables,
            dry_run=config.dry_run,
        )

        print("\n===== 迁移完成 =====")
        print(f"表数量: {len(ordered_tables)}")
        print(f"源总行数: {total_source_rows}")
        print(f"成功插入: {total_inserted}")
        print(f"跳过行数: {total_skipped}")
        print(f"失败表数: {len(failed_tables)}")
        if failed_tables:
            for item in failed_tables:
                print(f"  - {item.table}: {item.note}")
        return 0 if not failed_tables else 1
    finally:
        source_conn.close()
        target_conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
