#!/usr/bin/env python3
"""
清洗自部署 PostgreSQL 中的历史存储字段，将完整 URL 收口为对象 key。

设计目标：
1. 只连接 POSTGRESQL_* 指向的目标 PostgreSQL，不读取或修改旧源库数据。
2. 默认 dry-run，仅打印计划；只有显式传入 --apply 才真正更新。
3. 支持重复运行：已经是 key 的值会自动跳过，不会重复修改。
4. 只处理当前项目已知的存储字段；若表或列不存在则安全跳过。

示例：
    python backend/scripts/normalize_storage_keys_in_postgresql.py
    python backend/scripts/normalize_storage_keys_in_postgresql.py --apply
    python backend/scripts/normalize_storage_keys_in_postgresql.py --tables weapp_user,analysis_tasks --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote, urlparse

try:
    import psycopg2
    from psycopg2 import sql
    from psycopg2.extras import Json
except ImportError:
    print("请先安装 psycopg2-binary", file=sys.stderr)
    raise

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parent.parent
DEFAULT_ENV_FILE = BACKEND / ".env"

sys.path.insert(0, str(BACKEND))

from cos_storage import (  # noqa: E402
    FOOD_IMAGES_BUCKET,
    HEALTH_REPORTS_BUCKET,
    USER_AVATARS_BUCKET,
    resolve_object_key,
)


@dataclass(frozen=True)
class ColumnSpec:
    table: str
    column: str
    kind: str  # scalar | list
    bucket_resolver: Callable[[Dict[str, Any]], str]
    required_columns: Tuple[str, ...] = ()


@dataclass
class ColumnSummary:
    table: str
    column: str
    scanned_rows: int = 0
    updated_rows: int = 0
    updated_values: int = 0
    unresolved_urls: int = 0
    skipped_missing: bool = False
    samples: List[str] = field(default_factory=list)


def _food_bucket(_: Dict[str, Any]) -> str:
    return FOOD_IMAGES_BUCKET


def _avatar_bucket(_: Dict[str, Any]) -> str:
    return USER_AVATARS_BUCKET


def _health_bucket(_: Dict[str, Any]) -> str:
    return HEALTH_REPORTS_BUCKET


def _analysis_task_bucket(row: Dict[str, Any]) -> str:
    task_type = str(row.get("task_type") or "").strip().lower()
    return HEALTH_REPORTS_BUCKET if task_type == "health_report" else FOOD_IMAGES_BUCKET


COLUMN_SPECS: Tuple[ColumnSpec, ...] = (
    ColumnSpec("weapp_user", "avatar", "scalar", _avatar_bucket),
    ColumnSpec("user_food_records", "image_path", "scalar", _food_bucket),
    ColumnSpec("user_food_records", "image_paths", "list", _food_bucket),
    ColumnSpec("analysis_tasks", "image_url", "scalar", _analysis_task_bucket, ("task_type",)),
    ColumnSpec("analysis_tasks", "image_paths", "list", _analysis_task_bucket, ("task_type",)),
    ColumnSpec("user_health_documents", "image_url", "scalar", _health_bucket),
    ColumnSpec("public_food_library", "image_path", "scalar", _food_bucket),
    ColumnSpec("public_food_library", "image_paths", "list", _food_bucket),
    ColumnSpec("user_recipes", "image_path", "scalar", _food_bucket),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="将目标 PostgreSQL 中的历史存储 URL 清洗为 key")
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_ENV_FILE),
        help="环境变量文件路径，默认 backend/.env",
    )
    parser.add_argument("--schema", default="public", help="目标 schema，默认 public")
    parser.add_argument("--tables", default="", help="仅处理指定表，逗号分隔")
    parser.add_argument("--apply", action="store_true", help="真正执行更新；默认仅 dry-run")
    parser.add_argument("--sample-limit", type=int, default=5, help="每列最多打印多少个样例，默认 5")
    args = parser.parse_args()
    if args.sample_limit < 0:
        raise SystemExit("--sample-limit 不能小于 0")
    return args


def parse_table_list(raw: str) -> List[str]:
    if not raw.strip():
        return []
    output: List[str] = []
    for chunk in raw.split(","):
        table = chunk.strip()
        if not table:
            continue
        if "." in table:
            _, table = table.split(".", 1)
        output.append(table)
    return output


def build_postgresql_url(*, host: str, port: str, user: str, password: str, database: str, sslmode: str) -> str:
    encoded_user = quote(user, safe="")
    encoded_password = quote(password, safe="")
    encoded_database = quote(database, safe="")
    url = f"postgresql://{encoded_user}:{encoded_password}@{host}:{port}/{encoded_database}"
    if sslmode:
        url += f"?sslmode={quote(sslmode, safe='')}"
    return url


def redact_url(url: str) -> str:
    if "://" not in url or "@" not in url:
        return url
    prefix, rest = url.split("://", 1)
    creds, suffix = rest.split("@", 1)
    if ":" in creds:
        user, _ = creds.split(":", 1)
        return f"{prefix}://{user}:***@{suffix}"
    return f"{prefix}://***@{suffix}"


def target_runtime_from_env(env_file: Path) -> Dict[str, str]:
    load_dotenv(env_file)
    host = (os.getenv("POSTGRESQL_HOST") or "").strip()
    port = (os.getenv("POSTGRESQL_PORT") or "5432").strip()
    user = (os.getenv("POSTGRESQL_USER") or "").strip()
    password = (os.getenv("POSTGRESQL_PASSWORD") or "").strip()
    database = (os.getenv("POSTGRESQL_DATABASE") or "").strip()
    sslmode = (os.getenv("POSTGRESQL_SSLMODE") or "").strip()
    missing = [
        name
        for name, value in [
            ("POSTGRESQL_HOST", host),
            ("POSTGRESQL_PORT", port),
            ("POSTGRESQL_USER", user),
            ("POSTGRESQL_PASSWORD", password),
            ("POSTGRESQL_DATABASE", database),
        ]
        if not value
    ]
    if missing:
        raise RuntimeError(f"缺少目标库环境变量: {', '.join(missing)}")
    return {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "database": database,
        "sslmode": sslmode,
        "url": build_postgresql_url(
            host=host,
            port=port,
            user=user,
            password=password,
            database=database,
            sslmode=sslmode,
        ),
    }


def assert_target_is_not_legacy_host(target_url: str) -> None:
    target_host = (urlparse(target_url).hostname or "").strip().lower()
    legacy_markers = ("old-managed", "legacy-managed")
    if any(marker in target_host for marker in legacy_markers):
        raise RuntimeError("检测到目标库仍指向旧托管库域名，脚本已拒绝执行。请确认使用的是当前 PostgreSQL。")


def connect_db(url: str) -> psycopg2.extensions.connection:
    conn = psycopg2.connect(url, connect_timeout=10)
    conn.autocommit = False
    return conn


def get_table_columns(
    conn: psycopg2.extensions.connection,
    schema: str,
    tables: Iterable[str],
) -> Dict[str, Dict[str, Dict[str, str]]]:
    table_list = list(set(tables))
    if not table_list:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT table_name, column_name, data_type, udt_name
            FROM information_schema.columns
            WHERE table_schema = %s
              AND table_name = ANY(%s)
            ORDER BY table_name, ordinal_position
            """,
            (schema, table_list),
        )
        output: Dict[str, Dict[str, Dict[str, str]]] = defaultdict(dict)
        for table_name, column_name, data_type, udt_name in cur.fetchall():
            output[str(table_name)][str(column_name)] = {
                "data_type": str(data_type or ""),
                "udt_name": str(udt_name or ""),
            }
        return output


def get_primary_key_columns(conn: psycopg2.extensions.connection, schema: str, table: str) -> List[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.attname
            FROM pg_index i
            JOIN pg_class c ON c.oid = i.indrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord) ON TRUE
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = cols.attnum
            WHERE n.nspname = %s
              AND c.relname = %s
              AND i.indisprimary
            ORDER BY cols.ord
            """,
            (schema, table),
        )
        return [str(row[0]) for row in cur.fetchall()]


def iter_table_rows(
    conn: psycopg2.extensions.connection,
    schema: str,
    table: str,
    select_columns: Sequence[str],
    chunk_size: int = 1000,
):
    cursor_name = f"scan_{table}"
    scan_cur = conn.cursor(name=cursor_name)
    try:
        query = sql.SQL("SELECT {} FROM {}.{}").format(
            sql.SQL(", ").join(sql.Identifier(col) for col in select_columns),
            sql.Identifier(schema),
            sql.Identifier(table),
        )
        scan_cur.itersize = chunk_size
        scan_cur.execute(query)
        while True:
            rows = scan_cur.fetchmany(chunk_size)
            if not rows:
                break
            for row in rows:
                yield dict(zip(select_columns, row))
    finally:
        scan_cur.close()


def coerce_list_value(value: Any) -> Tuple[Optional[List[Any]], str]:
    if value is None:
        return None, "none"
    if isinstance(value, list):
        return value, "list"
    if isinstance(value, tuple):
        return list(value), "tuple"
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None, "empty"
        try:
            loaded = json.loads(stripped)
        except Exception:
            return None, "raw-string"
        if isinstance(loaded, list):
            return loaded, "json-string"
        return None, "json-non-list"
    return None, type(value).__name__


def normalize_scalar_value(value: Any, bucket_alias: str) -> Tuple[Any, bool, bool]:
    if value is None:
        return value, False, False
    if not isinstance(value, str):
        return value, False, False
    raw = value.strip()
    if not raw:
        return value, False, False
    key = resolve_object_key(raw, bucket_alias)
    if not key:
        return value, False, "://" in raw
    return key, key != value, False


def normalize_list_value(value: Any, bucket_alias: str) -> Tuple[Any, bool, int]:
    items, _kind = coerce_list_value(value)
    if items is None:
        return value, False, 0

    changed = False
    unresolved = 0
    normalized_items: List[Any] = []
    for item in items:
        if item is None:
            normalized_items.append(item)
            continue
        if not isinstance(item, str):
            normalized_items.append(item)
            continue
        raw = item.strip()
        if not raw:
            normalized_items.append(item)
            continue
        key = resolve_object_key(raw, bucket_alias)
        if not key:
            if "://" in raw:
                unresolved += 1
            normalized_items.append(item)
            continue
        normalized_items.append(key)
        if key != item:
            changed = True

    return normalized_items if changed else value, changed, unresolved


def adapt_value_for_update(value: Any, column_meta: Dict[str, str]) -> Any:
    data_type = column_meta.get("data_type") or ""
    if data_type in {"json", "jsonb"}:
        return Json(value)
    return value


def build_update_statement(schema: str, table: str, update_columns: Sequence[str], pk_columns: Sequence[str]) -> sql.SQL:
    set_sql = sql.SQL(", ").join(
        sql.SQL("{} = %s").format(sql.Identifier(column)) for column in update_columns
    )
    where_sql = sql.SQL(" AND ").join(
        sql.SQL("{} = %s").format(sql.Identifier(column)) for column in pk_columns
    )
    return sql.SQL("UPDATE {}.{} SET {} WHERE {}").format(
        sql.Identifier(schema),
        sql.Identifier(table),
        set_sql,
        where_sql,
    )


def process_table(
    conn: psycopg2.extensions.connection,
    schema: str,
    table: str,
    specs: Sequence[ColumnSpec],
    column_meta: Dict[str, Dict[str, str]],
    apply: bool,
    sample_limit: int,
) -> List[ColumnSummary]:
    summaries = [ColumnSummary(table=table, column=spec.column) for spec in specs]
    summary_by_column = {summary.column: summary for summary in summaries}

    available_specs: List[ColumnSpec] = []
    for spec in specs:
        summary = summary_by_column[spec.column]
        if spec.column not in column_meta:
            summary.skipped_missing = True
            continue
        if any(required not in column_meta for required in spec.required_columns):
            summary.skipped_missing = True
            continue
        available_specs.append(spec)

    if not available_specs:
        return summaries

    pk_columns = get_primary_key_columns(conn, schema, table)
    if not pk_columns:
        raise RuntimeError(f"{schema}.{table} 缺少主键，无法安全做幂等更新")

    extra_columns = sorted({col for spec in available_specs for col in spec.required_columns})
    select_columns = list(pk_columns)
    select_columns.extend(col for col in extra_columns if col not in select_columns)
    select_columns.extend(spec.column for spec in available_specs if spec.column not in select_columns)

    update_cur = conn.cursor()
    try:
        for row in iter_table_rows(conn, schema, table, select_columns):
            updates: Dict[str, Any] = {}
            for spec in available_specs:
                summary = summary_by_column[spec.column]
                summary.scanned_rows += 1
                bucket_alias = spec.bucket_resolver(row)
                current_value = row.get(spec.column)

                if spec.kind == "scalar":
                    normalized_value, changed, unresolved = normalize_scalar_value(current_value, bucket_alias)
                    if unresolved:
                        summary.unresolved_urls += 1
                    if changed:
                        updates[spec.column] = adapt_value_for_update(normalized_value, column_meta[spec.column])
                        summary.updated_values += 1
                        if len(summary.samples) < sample_limit:
                            summary.samples.append(f"{current_value} -> {normalized_value}")
                else:
                    normalized_value, changed, unresolved_count = normalize_list_value(current_value, bucket_alias)
                    summary.unresolved_urls += unresolved_count
                    if changed:
                        updates[spec.column] = adapt_value_for_update(normalized_value, column_meta[spec.column])
                        if isinstance(current_value, list):
                            current_len = len(current_value)
                        else:
                            coerced, _ = coerce_list_value(current_value)
                            current_len = len(coerced or [])
                        summary.updated_values += current_len
                        if len(summary.samples) < sample_limit:
                            summary.samples.append(f"{current_value} -> {normalized_value}")

            if not updates:
                continue

            update_sql = build_update_statement(schema, table, list(updates.keys()), pk_columns)
            params = list(updates.values()) + [row[pk] for pk in pk_columns]
            if apply:
                update_cur.execute(update_sql, params)
            for column in updates:
                summary_by_column[column].updated_rows += 1
    finally:
        update_cur.close()

    return summaries


def print_plan(
    target_url: str,
    schema: str,
    selected_tables: Sequence[str],
    apply: bool,
) -> None:
    print("===== 清洗计划 =====")
    print(f"目标库: {redact_url(target_url)}")
    print(f"schema: {schema}")
    print(f"表范围: {', '.join(selected_tables) if selected_tables else '全部已知表'}")
    print(f"模式: {'APPLY' if apply else 'DRY-RUN'}")
    print("说明: 仅使用 POSTGRESQL_* 目标库连接；脚本不会写旧源库。")


def print_summary(summaries: Sequence[ColumnSummary], apply: bool) -> None:
    print("\n===== 清洗结果 =====")
    effective = [item for item in summaries if not item.skipped_missing]
    skipped = [item for item in summaries if item.skipped_missing]

    total_scanned = sum(item.scanned_rows for item in effective)
    total_updated_rows = sum(item.updated_rows for item in effective)
    total_updated_values = sum(item.updated_values for item in effective)
    total_unresolved = sum(item.unresolved_urls for item in effective)

    print(f"总扫描行数: {total_scanned}")
    print(f"{'总实际更新行数' if apply else '预计更新行数'}: {total_updated_rows}")
    print(f"{'总实际更新值数' if apply else '预计更新值数'}: {total_updated_values}")
    print(f"未识别外链数: {total_unresolved}")

    for item in summaries:
        status = "SKIP" if item.skipped_missing else ("UPDATE" if item.updated_rows else "PASS")
        print(
            f"- [{status}] {item.table}.{item.column}: "
            f"扫描 {item.scanned_rows} 行，"
            f"{'更新' if apply else '预计更新'} {item.updated_rows} 行，"
            f"{'更新' if apply else '预计更新'} {item.updated_values} 个值，"
            f"未识别外链 {item.unresolved_urls} 个"
        )
        for sample in item.samples:
            print(f"    sample: {sample}")

    if skipped:
        print("\n已跳过的缺失字段:")
        for item in skipped:
            print(f"- {item.table}.{item.column}")


def main() -> int:
    args = parse_args()
    env_file = Path(args.env_file)
    runtime = target_runtime_from_env(env_file)
    assert_target_is_not_legacy_host(runtime["url"])

    selected_tables = parse_table_list(args.tables)
    specs = [spec for spec in COLUMN_SPECS if not selected_tables or spec.table in selected_tables]
    if not specs:
        print("没有匹配到需要处理的表。", file=sys.stderr)
        return 1

    grouped_specs: Dict[str, List[ColumnSpec]] = defaultdict(list)
    for spec in specs:
        grouped_specs[spec.table].append(spec)

    print_plan(runtime["url"], args.schema, selected_tables, args.apply)

    conn = connect_db(runtime["url"])
    try:
        table_columns = get_table_columns(conn, args.schema, grouped_specs.keys())
        all_summaries: List[ColumnSummary] = []
        for table, table_specs in grouped_specs.items():
            column_meta = table_columns.get(table, {})
            all_summaries.extend(
                process_table(
                    conn=conn,
                    schema=args.schema,
                    table=table,
                    specs=table_specs,
                    column_meta=column_meta,
                    apply=args.apply,
                    sample_limit=args.sample_limit,
                )
            )

        if args.apply:
            conn.commit()
        else:
            conn.rollback()

        print_summary(all_summaries, apply=args.apply)
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
