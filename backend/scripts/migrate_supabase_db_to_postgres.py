"""
Migrate the latest Supabase PostgreSQL schema and data into a self-hosted PostgreSQL database.

By default this script treats the existing target database as canonical and only inserts
missing rows from Supabase. Destructive schema rebuild is still available, but it must be
requested explicitly.

Default behavior:
1. Read rows from the selected Supabase source schemas.
2. Insert source rows that are missing from the target database.
3. Keep existing target rows, target-only rows, and the target schema unchanged.
4. Refresh target sequences.

Typical usage:
  backend/.venv/Scripts/python.exe backend/scripts/migrate_supabase_db_to_postgres.py --dry-run
  backend/.venv/Scripts/python.exe backend/scripts/migrate_supabase_db_to_postgres.py
  backend/.venv/Scripts/python.exe backend/scripts/migrate_supabase_db_to_postgres.py --data-only
  backend/.venv/Scripts/python.exe backend/scripts/migrate_supabase_db_to_postgres.py --destructive-rebuild --yes

Important:
- The default mode is non-destructive data-only insert-missing sync.
- Destructive schema rebuild requires --destructive-rebuild --yes.
- By default it syncs only the `public` schema, which is the app's business schema.
- If you need a stronger guarantee, keep the default verification enabled.
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
import time
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Sequence, Tuple
from urllib.parse import quote

import psycopg2
from psycopg2 import sql
from psycopg2 import errorcodes
from psycopg2.extras import Json, execute_values
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
DEFAULT_ENV_FILE = BACKEND / ".env"
DEFAULT_SCHEMAS = ["public"]


@dataclass
class RuntimeConfig:
    env_file: Path
    source_url: str
    target_url: str
    schemas: List[str]
    dump_file: Path | None
    keep_dump: bool
    dry_run: bool
    verify_only: bool
    data_only: bool
    tables: List[str]
    update_existing: bool
    batch_size: int
    yes: bool
    pg_dump_path: str
    psql_path: str
    report_file: Path | None


def log(message: str) -> None:
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] {message}", flush=True)


def normalize_default_expression(value: str) -> str:
    normalized = " ".join(value.strip().split())
    normalized = normalized.replace("extensions.uuid_generate_v4()", "uuid_generate_v4()")
    normalized = normalized.replace("public.uuid_generate_v4()", "uuid_generate_v4()")
    return normalized


def normalize_constraint_definition(value: str) -> str:
    normalized = " ".join(value.strip().split())
    normalized = re.sub(r"'([^']*)'::text", r"'\1'", normalized)
    normalized = re.sub(r"::character varying::text", "::text", normalized)
    normalized = re.sub(r"::character varying\b", "", normalized)
    normalized = normalized.replace("::text[]", "[]")
    normalized = normalized.replace("::text", "")
    normalized = re.sub(r"\[\]::text\[\]", "[]", normalized)
    normalized = re.sub(r"ARRAY\[(.*?)\]\[\]", r"ARRAY[\1]", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def normalize_index_definition(value: str) -> str:
    return " ".join(value.strip().split())


def normalize_sql_definition(value: str) -> str:
    return "\n".join(line.rstrip() for line in value.strip().splitlines()).strip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate Supabase PostgreSQL schema and data into self-hosted PostgreSQL."
    )
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE), help="Path to env file.")
    parser.add_argument("--source-url", default="", help="Override source database URL.")
    parser.add_argument("--target-url", default="", help="Override target database URL.")
    parser.add_argument(
        "--schemas",
        default="public",
        help="Comma-separated schema list to migrate. Default: public",
    )
    parser.add_argument("--dump-file", default="", help="Optional custom dump file path.")
    parser.add_argument("--keep-dump", action="store_true", help="Keep generated dump file.")
    parser.add_argument("--dry-run", action="store_true", help="Print the plan only.")
    parser.add_argument("--verify-only", action="store_true", help="Only run verification.")
    parser.add_argument(
        "--tables",
        default="",
        help=(
            "Comma-separated table list for --data-only, e.g. public.user_exercise_logs. "
            "Unqualified names use the first selected schema."
        ),
    )
    parser.add_argument(
        "--data-only",
        action="store_true",
        help=(
            "Non-destructive data sync into the existing target schema. This is the default mode. "
            "By default this inserts missing source rows only and keeps existing target rows unchanged."
        ),
    )
    parser.add_argument(
        "--destructive-rebuild",
        action="store_true",
        help="Rebuild selected target schemas from the source schema and data. Requires --yes.",
    )
    parser.add_argument(
        "--update-existing",
        action="store_true",
        help="With --data-only, also update rows that already exist in the target. Default: insert missing rows only.",
    )
    parser.add_argument("--batch-size", type=int, default=1000, help="Rows per batch for --data-only. Default: 1000.")
    parser.add_argument("--yes", action="store_true", help="Confirm --destructive-rebuild.")
    parser.add_argument("--pg-dump-path", default="", help="Explicit pg_dump executable path.")
    parser.add_argument("--psql-path", default="", help="Explicit psql executable path.")
    parser.add_argument(
        "--report-file",
        default="",
        help="Optional JSON report path for verification output.",
    )
    args = parser.parse_args()
    modes = [bool(args.verify_only), bool(args.data_only), bool(args.destructive_rebuild)]
    if sum(modes) > 1:
        raise SystemExit("--verify-only, --data-only, and --destructive-rebuild cannot be used together")
    if args.dry_run and args.verify_only:
        raise SystemExit("--dry-run and --verify-only cannot be used together")
    if not args.verify_only and not args.destructive_rebuild:
        args.data_only = True
    if args.tables and not args.data_only:
        raise SystemExit("--tables can only be used with --data-only")
    if args.update_existing and not args.data_only:
        raise SystemExit("--update-existing can only be used with --data-only")
    if args.batch_size < 1:
        raise SystemExit("--batch-size must be greater than 0")
    return args


def parse_schemas(raw: str) -> List[str]:
    schemas = [item.strip() for item in raw.split(",") if item.strip()]
    if not schemas:
        raise RuntimeError("at least one schema is required")
    return schemas


def parse_tables(raw: str, schemas: Sequence[str]) -> List[str]:
    tables: List[str] = []
    default_schema = schemas[0] if schemas else "public"
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        if "." in item:
            schema, table = item.split(".", 1)
        else:
            schema, table = default_schema, item
        schema = schema.strip()
        table = table.strip()
        if not schema or not table:
            raise RuntimeError(f"invalid --tables entry: {item}")
        tables.append(f"{schema}.{table}")
    return tables


def build_postgresql_url(*, host: str, port: str, user: str, password: str, database: str, sslmode: str) -> str:
    encoded_user = quote(user, safe="")
    encoded_password = quote(password, safe="")
    encoded_database = quote(database, safe="")
    url = f"postgresql://{encoded_user}:{encoded_password}@{host}:{port}/{encoded_database}"
    if sslmode:
        url += f"?sslmode={quote(sslmode, safe='')}"
    return url


def load_runtime_config(args: argparse.Namespace) -> RuntimeConfig:
    env_file = Path(args.env_file)
    load_dotenv(env_file)

    source_url = (
        args.source_url
        or os.getenv("SUPABASE_DIRECT_DB_URL")
        or os.getenv("SUPABASE_DB_DIRECT_URL")
        or os.getenv("SUPABASE_DB_URL")
        or os.getenv("DATABASE_URL")
        or ""
    ).strip()
    target_url = (args.target_url or os.getenv("TARGET_DATABASE_URL") or "").strip()

    if not target_url:
        host = (os.getenv("POSTGRESQL_HOST") or "").strip()
        port = (os.getenv("POSTGRESQL_PORT") or "5432").strip()
        user = (os.getenv("POSTGRESQL_USER") or "").strip()
        password = (os.getenv("POSTGRESQL_PASSWORD") or "").strip()
        database = (os.getenv("POSTGRESQL_DATABASE") or "").strip()
        sslmode = (os.getenv("POSTGRESQL_SSLMODE") or "").strip()
        if all([host, port, user, password, database]):
            target_url = build_postgresql_url(
                host=host,
                port=port,
                user=user,
                password=password,
                database=database,
                sslmode=sslmode,
            )

    missing = []
    if not source_url:
        missing.append("SUPABASE_DB_URL or --source-url")
    if not target_url:
        missing.append("TARGET_DATABASE_URL / POSTGRESQL_* or --target-url")
    if missing:
        raise RuntimeError(f"missing required database configuration: {', '.join(missing)}")

    dump_file = Path(args.dump_file).resolve() if args.dump_file else None
    report_file = Path(args.report_file).resolve() if args.report_file else None
    schemas = parse_schemas(args.schemas)
    return RuntimeConfig(
        env_file=env_file,
        source_url=source_url,
        target_url=target_url,
        schemas=schemas,
        dump_file=dump_file,
        keep_dump=bool(args.keep_dump),
        dry_run=bool(args.dry_run),
        verify_only=bool(args.verify_only),
        data_only=bool(args.data_only),
        tables=parse_tables(args.tables, schemas),
        update_existing=bool(args.update_existing),
        batch_size=int(args.batch_size),
        yes=bool(args.yes),
        pg_dump_path=args.pg_dump_path.strip(),
        psql_path=args.psql_path.strip(),
        report_file=report_file,
    )


def redact_url(url: str) -> str:
    if "://" not in url or "@" not in url:
        return url
    prefix, rest = url.split("://", 1)
    creds, suffix = rest.split("@", 1)
    if ":" in creds:
        user, _ = creds.split(":", 1)
        return f"{prefix}://{user}:***@{suffix}"
    return f"{prefix}://***@{suffix}"


def resolve_executable(name: str, explicit_path: str) -> str:
    if explicit_path:
        candidate = Path(explicit_path)
        if candidate.exists():
            return str(candidate)
        raise RuntimeError(f"{name} not found at explicit path: {explicit_path}")

    from_path = shutil.which(name)
    if from_path:
        return from_path

    windows_roots = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")),
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")),
        Path(r"D:\Development"),
    ]
    patterns = [rf"PostgreSQL*\**\bin\{name}", rf"Postgresql*\**\bin\{name}"]
    for root in windows_roots:
        for pattern in patterns:
            for candidate in sorted(root.glob(pattern), reverse=True):
                if candidate.exists():
                    return str(candidate)

    raise RuntimeError(f"unable to find executable: {name}")


def run_command(command: Sequence[str], *, env: Dict[str, str] | None = None) -> None:
    log(f"running: {' '.join(command)}")
    process = subprocess.Popen(
        command,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
    )
    output_lines: List[str] = []
    assert process.stdout is not None
    for line in process.stdout:
        line = line.rstrip()
        if line:
            output_lines.append(line)
            print(f"    {line}", flush=True)
    return_code = process.wait()
    if return_code != 0:
        detail = "\n".join(output_lines[-50:]).strip()
        raise RuntimeError(f"command failed: {' '.join(command)}\n{detail}")
    log("command finished")


def connect_db(url: str):
    last_error: Exception | None = None
    for attempt in range(1, 6):
        try:
            conn = psycopg2.connect(url, connect_timeout=30)
            conn.autocommit = False
            return conn
        except Exception as err:  # noqa: BLE001
            last_error = err
            if attempt < 5:
                log(f"database connect attempt {attempt} failed; retrying...")
                time.sleep(2 ** (attempt - 1))
                continue
            raise
    raise RuntimeError(f"unable to connect: {last_error}")


def dump_schema_sql(config: RuntimeConfig, output_path: Path) -> None:
    pg_dump_name = "pg_dump.exe" if os.name == "nt" else "pg_dump"
    pg_dump = resolve_executable(pg_dump_name, config.pg_dump_path)
    cmd = [
        pg_dump,
        "--schema-only",
        "--no-owner",
        "--no-privileges",
        "--verbose",
        "--file",
        str(output_path),
    ]
    for schema in config.schemas:
        cmd.extend(["--schema", schema])
    cmd.append(config.source_url)
    run_command(cmd)


def dump_data_sql(config: RuntimeConfig, output_path: Path) -> None:
    pg_dump_name = "pg_dump.exe" if os.name == "nt" else "pg_dump"
    pg_dump = resolve_executable(pg_dump_name, config.pg_dump_path)
    cmd = [
        pg_dump,
        "--data-only",
        "--no-owner",
        "--no-privileges",
        "--disable-triggers",
        "--verbose",
        "--file",
        str(output_path),
    ]
    for schema in config.schemas:
        cmd.extend(["--schema", schema])
    cmd.append(config.source_url)
    run_command(cmd)


def dump_full_sql(config: RuntimeConfig, output_path: Path) -> None:
    pg_dump_name = "pg_dump.exe" if os.name == "nt" else "pg_dump"
    pg_dump = resolve_executable(pg_dump_name, config.pg_dump_path)
    cmd = [
        pg_dump,
        "--no-owner",
        "--no-privileges",
        "--verbose",
        "--file",
        str(output_path),
    ]
    for schema in config.schemas:
        cmd.extend(["--schema", schema])
    cmd.append(config.source_url)
    run_command(cmd)


def normalize_schema_dump(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    text = text.replace("CREATE SCHEMA public;", "CREATE SCHEMA IF NOT EXISTS public;")
    path.write_text(text, encoding="utf-8")


def build_reset_sql(schemas: Sequence[str]) -> str:
    lines = ["SET client_min_messages TO WARNING;"]
    for schema in schemas:
        lines.append(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE;')
        lines.append(f'CREATE SCHEMA "{schema}";')
    lines.extend(
        [
            'CREATE EXTENSION IF NOT EXISTS "pgcrypto";',
            'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
            'GRANT ALL ON SCHEMA public TO PUBLIC;',
            "GRANT ALL ON SCHEMA public TO CURRENT_USER;",
        ]
    )
    return "\n".join(lines) + "\n"


def reset_target_schemas(config: RuntimeConfig) -> None:
    psql_name = "psql.exe" if os.name == "nt" else "psql"
    psql = resolve_executable(psql_name, config.psql_path)
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as handle:
        sql_path = Path(handle.name)
        handle.write(build_reset_sql(config.schemas))
    try:
        cmd = [psql, config.target_url, "-v", "ON_ERROR_STOP=1", "-f", str(sql_path)]
        run_command(cmd)
    finally:
        sql_path.unlink(missing_ok=True)


def run_sql_file(config: RuntimeConfig, sql_path: Path) -> None:
    psql_name = "psql.exe" if os.name == "nt" else "psql"
    psql = resolve_executable(psql_name, config.psql_path)
    cmd = [psql, config.target_url, "-v", "ON_ERROR_STOP=1", "-f", str(sql_path)]
    run_command(cmd)


def fetch_table_names(conn, schemas: Sequence[str]) -> List[Tuple[str, str]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT schemaname, tablename
            FROM pg_tables
            WHERE schemaname = ANY(%s)
            ORDER BY schemaname, tablename
            """,
            (list(schemas),),
        )
        return [(row[0], row[1]) for row in cur.fetchall()]


def fetch_columns(conn, schemas: Sequence[str]) -> Dict[str, List[Tuple[str, str, str, str, str]]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                table_schema,
                table_name,
                column_name,
                COALESCE(data_type, ''),
                COALESCE(udt_name, ''),
                COALESCE(is_nullable, ''),
                COALESCE(column_default, '')
            FROM information_schema.columns
            WHERE table_schema = ANY(%s)
            ORDER BY table_schema, table_name, ordinal_position
            """,
            (list(schemas),),
        )
        result: Dict[str, List[Tuple[str, str, str, str, str]]] = {}
        for schema, table, name, data_type, udt_name, nullable, default in cur.fetchall():
            result.setdefault(f"{schema}.{table}", []).append(
                (name, data_type, udt_name, nullable, normalize_default_expression(default))
            )
        return result


def fetch_constraints(conn, schemas: Sequence[str]) -> Dict[str, List[Tuple[str, str]]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                n.nspname AS schema_name,
                c.relname AS table_name,
                con.conname AS constraint_name,
                pg_get_constraintdef(con.oid, true) AS definition
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ANY(%s)
            ORDER BY n.nspname, c.relname, con.conname
            """,
            (list(schemas),),
        )
        result: Dict[str, List[Tuple[str, str]]] = {}
        for schema, table, name, definition in cur.fetchall():
            result.setdefault(f"{schema}.{table}", []).append((name, normalize_constraint_definition(definition)))
        return result


def fetch_indexes(conn, schemas: Sequence[str]) -> Dict[str, List[Tuple[str, str]]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT schemaname, tablename, indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = ANY(%s)
            ORDER BY schemaname, tablename, indexname
            """,
            (list(schemas),),
        )
        result: Dict[str, List[Tuple[str, str]]] = {}
        for schema, table, name, definition in cur.fetchall():
            result.setdefault(f"{schema}.{table}", []).append((name, normalize_index_definition(definition)))
        return result


def fetch_views(conn, schemas: Sequence[str]) -> Dict[str, List[Tuple[str, str]]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                n.nspname AS schema_name,
                c.relname AS view_name,
                c.relkind,
                pg_get_viewdef(c.oid, true) AS definition
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ANY(%s)
              AND c.relkind IN ('v', 'm')
            ORDER BY n.nspname, c.relname
            """,
            (list(schemas),),
        )
        result: Dict[str, List[Tuple[str, str]]] = {}
        for schema, name, relkind, definition in cur.fetchall():
            result.setdefault(schema, []).append((name, relkind, normalize_sql_definition(definition or "")))
        return result


def fetch_sequences(conn, schemas: Sequence[str]) -> Dict[str, Tuple[str, int, int, int, int, bool, int, int | None]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                schemaname,
                sequencename,
                data_type,
                start_value,
                min_value,
                max_value,
                increment_by,
                cycle,
                cache_size,
                last_value
            FROM pg_sequences
            WHERE schemaname = ANY(%s)
            ORDER BY schemaname, sequencename
            """,
            (list(schemas),),
        )
        return {
            f"{schema}.{name}": (
                data_type,
                int(start_value),
                int(min_value),
                int(max_value),
                int(increment_by),
                bool(cycle),
                int(cache_size),
                None if last_value is None else int(last_value),
            )
            for schema, name, data_type, start_value, min_value, max_value, increment_by, cycle, cache_size, last_value
            in cur.fetchall()
        }


def fetch_triggers(conn, schemas: Sequence[str]) -> Dict[str, List[Tuple[str, str]]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                n.nspname AS schema_name,
                c.relname AS table_name,
                t.tgname AS trigger_name,
                pg_get_triggerdef(t.oid, true) AS definition
            FROM pg_trigger t
            JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ANY(%s)
              AND NOT t.tgisinternal
            ORDER BY n.nspname, c.relname, t.tgname
            """,
            (list(schemas),),
        )
        result: Dict[str, List[Tuple[str, str]]] = {}
        for schema, table, name, definition in cur.fetchall():
            result.setdefault(f"{schema}.{table}", []).append((name, normalize_sql_definition(definition or "")))
        return result


def fetch_rls(conn, schemas: Sequence[str]) -> Dict[str, Tuple[bool, bool]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                n.nspname AS schema_name,
                c.relname AS table_name,
                c.relrowsecurity,
                c.relforcerowsecurity
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ANY(%s)
              AND c.relkind IN ('r', 'p')
            ORDER BY n.nspname, c.relname
            """,
            (list(schemas),),
        )
        return {
            f"{schema}.{table}": (bool(row_security), bool(force_row_security))
            for schema, table, row_security, force_row_security in cur.fetchall()
        }


def fetch_policies(conn, schemas: Sequence[str]) -> Dict[str, List[Tuple[str, str, str, str, str, str]]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                schemaname,
                tablename,
                policyname,
                permissive,
                roles::text,
                cmd,
                COALESCE(qual, ''),
                COALESCE(with_check, '')
            FROM pg_policies
            WHERE schemaname = ANY(%s)
            ORDER BY schemaname, tablename, policyname
            """,
            (list(schemas),),
        )
        result: Dict[str, List[Tuple[str, str, str, str, str, str]]] = {}
        for schema, table, name, permissive, roles, cmd, qual, with_check in cur.fetchall():
            result.setdefault(f"{schema}.{table}", []).append(
                (
                    name,
                    permissive,
                    roles,
                    cmd,
                    normalize_constraint_definition(qual),
                    normalize_constraint_definition(with_check),
                )
            )
        return result


def fetch_functions(conn, schemas: Sequence[str]) -> Dict[str, str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                n.nspname AS schema_name,
                p.proname AS function_name,
                pg_get_function_identity_arguments(p.oid) AS arguments,
                pg_get_functiondef(p.oid) AS definition
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = ANY(%s)
            ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
            """,
            (list(schemas),),
        )
        return {
            f"{schema}.{name}({arguments})": normalize_sql_definition(definition or "")
            for schema, name, arguments, definition in cur.fetchall()
        }


def fetch_enum_types(conn, schemas: Sequence[str]) -> Dict[str, List[Tuple[str, float]]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                n.nspname AS schema_name,
                t.typname AS type_name,
                e.enumlabel,
                e.enumsortorder
            FROM pg_type t
            JOIN pg_enum e ON e.enumtypid = t.oid
            JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = ANY(%s)
            ORDER BY n.nspname, t.typname, e.enumsortorder
            """,
            (list(schemas),),
        )
        result: Dict[str, List[Tuple[str, float]]] = {}
        for schema, type_name, label, sort_order in cur.fetchall():
            result.setdefault(f"{schema}.{type_name}", []).append((label, float(sort_order)))
        return result


def fetch_row_counts(conn, tables: Sequence[Tuple[str, str]]) -> Dict[str, int]:
    result: Dict[str, int] = {}
    with conn.cursor() as cur:
        for schema, table in tables:
            cur.execute(f'SELECT COUNT(*) FROM "{schema}"."{table}"')
            result[f"{schema}.{table}"] = int(cur.fetchone()[0])
    return result


def table_key(schema: str, table: str) -> str:
    return f"{schema}.{table}"


def split_table_key(key: str) -> Tuple[str, str]:
    schema, table = key.split(".", 1)
    return schema, table


def fetch_column_meta(conn, schemas: Sequence[str]) -> Dict[str, List[Dict[str, str]]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                table_schema,
                table_name,
                column_name,
                COALESCE(udt_name, ''),
                COALESCE(is_nullable, ''),
                COALESCE(column_default, ''),
                COALESCE(identity_generation, ''),
                COALESCE(is_generated, '')
            FROM information_schema.columns
            WHERE table_schema = ANY(%s)
            ORDER BY table_schema, table_name, ordinal_position
            """,
            (list(schemas),),
        )
        result: Dict[str, List[Dict[str, str]]] = {}
        for schema, table, name, udt_name, nullable, default, identity, generated in cur.fetchall():
            result.setdefault(table_key(schema, table), []).append(
                {
                    "name": name,
                    "udt_name": udt_name,
                    "is_nullable": nullable,
                    "column_default": default,
                    "identity_generation": identity,
                    "is_generated": generated,
                }
            )
        return result


def fetch_primary_keys(conn, schemas: Sequence[str]) -> Dict[str, List[str]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                n.nspname AS schema_name,
                c.relname AS table_name,
                a.attname AS column_name,
                ord.ordinality
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN unnest(con.conkey) WITH ORDINALITY AS ord(attnum, ordinality) ON true
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ord.attnum
            WHERE con.contype = 'p'
              AND n.nspname = ANY(%s)
            ORDER BY n.nspname, c.relname, ord.ordinality
            """,
            (list(schemas),),
        )
        result: Dict[str, List[str]] = {}
        for schema, table, column, _ordinality in cur.fetchall():
            result.setdefault(table_key(schema, table), []).append(column)
        return result


def fetch_dependency_order(conn, schemas: Sequence[str], table_keys: Sequence[str]) -> List[str]:
    table_set = set(table_keys)
    dependencies: Dict[str, set[str]] = {key: set() for key in table_set}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                child_ns.nspname AS child_schema,
                child.relname AS child_table,
                parent_ns.nspname AS parent_schema,
                parent.relname AS parent_table
            FROM pg_constraint con
            JOIN pg_class child ON child.oid = con.conrelid
            JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
            JOIN pg_class parent ON parent.oid = con.confrelid
            JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
            WHERE con.contype = 'f'
              AND child_ns.nspname = ANY(%s)
              AND parent_ns.nspname = ANY(%s)
            ORDER BY child_ns.nspname, child.relname, parent_ns.nspname, parent.relname
            """,
            (list(schemas), list(schemas)),
        )
        for child_schema, child_table, parent_schema, parent_table in cur.fetchall():
            child_key = table_key(child_schema, child_table)
            parent_key = table_key(parent_schema, parent_table)
            if child_key in table_set and parent_key in table_set and child_key != parent_key:
                dependencies[child_key].add(parent_key)

    ordered: List[str] = []
    ready = sorted(key for key, deps in dependencies.items() if not deps)
    while ready:
        current = ready.pop(0)
        ordered.append(current)
        for key in sorted(dependencies):
            if current in dependencies[key]:
                dependencies[key].remove(current)
                if not dependencies[key] and key not in ordered and key not in ready:
                    ready.append(key)
        ready.sort()

    remaining = sorted(key for key in table_set if key not in ordered)
    return ordered + remaining


def is_required_without_default(column: Dict[str, str]) -> bool:
    return (
        column["is_nullable"] == "NO"
        and not column["column_default"]
        and not column["identity_generation"]
        and column["is_generated"] in {"", "NEVER"}
    )


def adapt_value(value: object, udt_name: str) -> object:
    if value is not None and udt_name in {"json", "jsonb"} and isinstance(value, (dict, list)):
        return Json(value)
    return value


def fetch_table_row_count(conn, schema: str, table: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL("SELECT COUNT(*) FROM {}.{}").format(sql.Identifier(schema), sql.Identifier(table))
        )
        return int(cur.fetchone()[0])


def fetch_target_primary_key_set(conn, schema: str, table: str, primary_key: Sequence[str]) -> set[Tuple[object, ...]]:
    with conn.cursor() as cur:
        cur.execute(
            sql.SQL("SELECT {} FROM {}.{}").format(
                sql.SQL(", ").join(sql.Identifier(column) for column in primary_key),
                sql.Identifier(schema),
                sql.Identifier(table),
            )
        )
        return {tuple(row) for row in cur.fetchall()}


def fetch_source_missing_simple_pks(
    conn,
    schema: str,
    table: str,
    primary_key: str,
    existing_pk_set: set[Tuple[object, ...]],
    batch_size: int,
) -> Tuple[int, List[object]]:
    processed_rows = 0
    missing: List[object] = []
    query = sql.SQL("SELECT {} FROM {}.{}").format(
        sql.Identifier(primary_key),
        sql.Identifier(schema),
        sql.Identifier(table),
    )
    with conn.cursor(name=f"pk_sync_{schema}_{table}") as cur:
        cur.itersize = batch_size
        cur.execute(query)
        while True:
            rows = cur.fetchmany(batch_size)
            if not rows:
                break
            processed_rows += len(rows)
            for row in rows:
                value = row[0]
                if (value,) not in existing_pk_set:
                    missing.append(value)
    return processed_rows, missing


def chunks(values: Sequence[object], size: int) -> Sequence[Sequence[object]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def is_skip_conflict_error(err: psycopg2.Error) -> bool:
    return err.pgcode in {
        errorcodes.UNIQUE_VIOLATION,
        errorcodes.EXCLUSION_VIOLATION,
    }


def sync_data_table(
    *,
    source_conn,
    target_conn,
    table: str,
    source_columns: List[Dict[str, str]],
    target_columns: List[Dict[str, str]],
    primary_key: List[str],
    update_existing: bool,
    batch_size: int,
) -> Dict[str, object]:
    schema, table_name = split_table_key(table)
    source_by_name = {column["name"]: column for column in source_columns}
    target_by_name = {column["name"]: column for column in target_columns}
    common_columns = [column["name"] for column in source_columns if column["name"] in target_by_name]
    source_only_columns = [column["name"] for column in source_columns if column["name"] not in target_by_name]
    target_only_columns = [column["name"] for column in target_columns if column["name"] not in source_by_name]
    required_target_only = [
        column["name"]
        for column in target_columns
        if column["name"] not in source_by_name and is_required_without_default(column)
    ]

    report: Dict[str, object] = {
        "table": table,
        "mode": "update-existing" if update_existing else "insert-missing",
        "source_rows": 0,
        "processed_rows": 0,
        "insert_candidate_rows": 0,
        "filtered_existing_rows": 0,
        "target_existing_pk_rows": 0,
        "conflict_rows": 0,
        "fallback_row_by_row": False,
        "common_columns": common_columns,
        "source_only_columns": source_only_columns,
        "target_only_columns": target_only_columns,
        "required_target_only_columns": required_target_only,
        "skipped": False,
        "skip_reason": "",
    }

    if not primary_key:
        report["skipped"] = True
        report["skip_reason"] = "missing target primary key"
        return report
    missing_pk_columns = [column for column in primary_key if column not in common_columns]
    if missing_pk_columns:
        report["skipped"] = True
        report["skip_reason"] = f"primary key columns are not present in source and target: {', '.join(missing_pk_columns)}"
        return report
    if required_target_only:
        report["skipped"] = True
        report["skip_reason"] = (
            "target has required columns not present in source: " + ", ".join(required_target_only)
        )
        return report
    if not common_columns:
        report["skipped"] = True
        report["skip_reason"] = "no common columns"
        return report

    source_row_count = fetch_table_row_count(source_conn, schema, table_name)
    report["source_rows"] = source_row_count
    if source_row_count == 0:
        return report

    select_query = sql.SQL("SELECT {} FROM {}.{}").format(
        sql.SQL(", ").join(sql.Identifier(column) for column in common_columns),
        sql.Identifier(schema),
        sql.Identifier(table_name),
    )
    update_columns = [column for column in common_columns if column not in primary_key]
    if update_existing and update_columns:
        insert_query_sql = sql.SQL("INSERT INTO {}.{} ({}) VALUES %s ON CONFLICT ({}) DO UPDATE SET {}").format(
            sql.Identifier(schema),
            sql.Identifier(table_name),
            sql.SQL(", ").join(sql.Identifier(column) for column in common_columns),
            sql.SQL(", ").join(sql.Identifier(column) for column in primary_key),
            sql.SQL(", ").join(
                sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(column), sql.Identifier(column))
                for column in update_columns
            ),
        )
    else:
        insert_query_sql = sql.SQL("INSERT INTO {}.{} ({}) VALUES %s ON CONFLICT DO NOTHING").format(
            sql.Identifier(schema),
            sql.Identifier(table_name),
            sql.SQL(", ").join(sql.Identifier(column) for column in common_columns),
        )
    insert_query = insert_query_sql.as_string(target_conn)
    insert_one_query = sql.SQL("INSERT INTO {}.{} ({}) VALUES ({})").format(
        sql.Identifier(schema),
        sql.Identifier(table_name),
        sql.SQL(", ").join(sql.Identifier(column) for column in common_columns),
        sql.SQL(", ").join(sql.Placeholder() for _ in common_columns),
    ).as_string(target_conn)

    source_types = [source_by_name[column]["udt_name"] for column in common_columns]
    existing_pk_set: set[Tuple[object, ...]] | None = None
    if not update_existing:
        existing_pk_set = fetch_target_primary_key_set(target_conn, schema, table_name, primary_key)
        report["target_existing_pk_rows"] = len(existing_pk_set)

    use_row_by_row = False

    def insert_adapted_rows(target_cur, adapted_rows: List[Tuple[object, ...]]) -> None:
        nonlocal use_row_by_row
        if update_existing:
            execute_values(target_cur, insert_query, adapted_rows, page_size=batch_size)
            return
        if not use_row_by_row:
            target_cur.execute("SAVEPOINT data_only_batch")
            try:
                execute_values(target_cur, insert_query, adapted_rows, page_size=batch_size)
                target_cur.execute("RELEASE SAVEPOINT data_only_batch")
            except psycopg2.errors.ObjectNotInPrerequisiteState as err:
                if "ON CONFLICT does not support deferrable" not in str(err):
                    raise
                target_cur.execute("ROLLBACK TO SAVEPOINT data_only_batch")
                target_cur.execute("RELEASE SAVEPOINT data_only_batch")
                use_row_by_row = True
                report["fallback_row_by_row"] = True
        if use_row_by_row:
            target_cur.execute("SET CONSTRAINTS ALL IMMEDIATE")
            for row in adapted_rows:
                target_cur.execute("SAVEPOINT data_only_row")
                try:
                    target_cur.execute(insert_one_query, row)
                    target_cur.execute("RELEASE SAVEPOINT data_only_row")
                except psycopg2.Error as row_err:
                    target_cur.execute("ROLLBACK TO SAVEPOINT data_only_row")
                    target_cur.execute("RELEASE SAVEPOINT data_only_row")
                    if is_skip_conflict_error(row_err):
                        report["conflict_rows"] = int(report["conflict_rows"]) + 1
                        continue
                    raise

    if existing_pk_set is not None and len(primary_key) == 1:
        processed_rows, missing_pk_values = fetch_source_missing_simple_pks(
            source_conn,
            schema,
            table_name,
            primary_key[0],
            existing_pk_set,
            batch_size,
        )
        report["processed_rows"] = processed_rows
        report["filtered_existing_rows"] = processed_rows - len(missing_pk_values)
        report["insert_candidate_rows"] = len(missing_pk_values)
        if not missing_pk_values:
            return report

        with source_conn.cursor() as source_cur, target_conn.cursor() as target_cur:
            for pk_batch in chunks(missing_pk_values, batch_size):
                placeholders = sql.SQL(", ").join(sql.Placeholder() for _ in pk_batch)
                missing_select_query = sql.SQL("SELECT {} FROM {}.{} WHERE {} IN ({})").format(
                    sql.SQL(", ").join(sql.Identifier(column) for column in common_columns),
                    sql.Identifier(schema),
                    sql.Identifier(table_name),
                    sql.Identifier(primary_key[0]),
                    placeholders,
                )
                source_cur.execute(missing_select_query, list(pk_batch))
                rows = source_cur.fetchall()
                if not rows:
                    continue
                adapted_rows = [
                    tuple(adapt_value(value, source_types[index]) for index, value in enumerate(row))
                    for row in rows
                ]
                insert_adapted_rows(target_cur, adapted_rows)
        return report

    pk_indexes = [common_columns.index(column) for column in primary_key]
    processed_rows = 0
    insert_candidate_rows = 0
    with source_conn.cursor(name=f"sync_{schema}_{table_name}") as source_cur:
        source_cur.itersize = batch_size
        source_cur.execute(select_query)
        with target_conn.cursor() as target_cur:
            while True:
                rows = source_cur.fetchmany(batch_size)
                if not rows:
                    break
                processed_rows += len(rows)
                if existing_pk_set is not None:
                    filtered_rows = []
                    for row in rows:
                        pk_value = tuple(row[index] for index in pk_indexes)
                        if pk_value in existing_pk_set:
                            report["filtered_existing_rows"] = int(report["filtered_existing_rows"]) + 1
                            continue
                        filtered_rows.append(row)
                    rows = filtered_rows
                    if not rows:
                        report["processed_rows"] = processed_rows
                        continue
                adapted_rows = [
                    tuple(adapt_value(value, source_types[index]) for index, value in enumerate(row))
                    for row in rows
                ]
                insert_candidate_rows += len(adapted_rows)
                report["insert_candidate_rows"] = insert_candidate_rows
                if update_existing:
                    execute_values(target_cur, insert_query, adapted_rows, page_size=batch_size)
                else:
                    if not use_row_by_row:
                        target_cur.execute("SAVEPOINT data_only_batch")
                        try:
                            execute_values(target_cur, insert_query, adapted_rows, page_size=batch_size)
                            target_cur.execute("RELEASE SAVEPOINT data_only_batch")
                        except psycopg2.errors.ObjectNotInPrerequisiteState as err:
                            if "ON CONFLICT does not support deferrable" not in str(err):
                                raise
                            target_cur.execute("ROLLBACK TO SAVEPOINT data_only_batch")
                            target_cur.execute("RELEASE SAVEPOINT data_only_batch")
                            use_row_by_row = True
                            report["fallback_row_by_row"] = True
                    if use_row_by_row:
                        target_cur.execute("SET CONSTRAINTS ALL IMMEDIATE")
                        for row in adapted_rows:
                            target_cur.execute("SAVEPOINT data_only_row")
                            try:
                                target_cur.execute(insert_one_query, row)
                                target_cur.execute("RELEASE SAVEPOINT data_only_row")
                            except psycopg2.Error as row_err:
                                target_cur.execute("ROLLBACK TO SAVEPOINT data_only_row")
                                target_cur.execute("RELEASE SAVEPOINT data_only_row")
                                if is_skip_conflict_error(row_err):
                                    report["conflict_rows"] = int(report["conflict_rows"]) + 1
                                    continue
                                raise
                if existing_pk_set is not None:
                    existing_pk_set.update(tuple(row[index] for index in pk_indexes) for row in rows)
                report["processed_rows"] = processed_rows
    return report


def refresh_target_sequences(conn, schemas: Sequence[str]) -> List[Dict[str, object]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT table_schema, table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = ANY(%s)
              AND (
                column_default LIKE 'nextval%%'
                OR COALESCE(identity_generation, '') <> ''
              )
            ORDER BY table_schema, table_name, ordinal_position
            """,
            (list(schemas),),
        )
        sequence_columns = [(row[0], row[1], row[2]) for row in cur.fetchall()]

    report: List[Dict[str, object]] = []
    with conn.cursor() as cur:
        for schema, table, column in sequence_columns:
            cur.execute("SELECT pg_get_serial_sequence(%s, %s)", (f'"{schema}"."{table}"', column))
            sequence_name = cur.fetchone()[0]
            if not sequence_name:
                continue
            cur.execute(
                sql.SQL("SELECT MAX({}) FROM {}.{}").format(
                    sql.Identifier(column),
                    sql.Identifier(schema),
                    sql.Identifier(table),
                )
            )
            max_value = cur.fetchone()[0]
            if max_value is None:
                cur.execute("SELECT setval(%s::regclass, 1, false)", (sequence_name,))
                set_value = 1
                is_called = False
            else:
                cur.execute("SELECT setval(%s::regclass, %s, true)", (sequence_name, max_value))
                set_value = int(max_value)
                is_called = True
            report.append(
                {
                    "table": table_key(schema, table),
                    "column": column,
                    "sequence": sequence_name,
                    "set_value": set_value,
                    "is_called": is_called,
                }
            )
    return report


def run_data_only_sync(config: RuntimeConfig) -> Dict[str, object]:
    metadata_source_conn = connect_db(config.source_url)
    metadata_target_conn = connect_db(config.target_url)
    try:
        source_tables = {
            table_key(schema, table) for schema, table in fetch_table_names(metadata_source_conn, config.schemas)
        }
        target_tables = {
            table_key(schema, table) for schema, table in fetch_table_names(metadata_target_conn, config.schemas)
        }
        common_tables = sorted(source_tables & target_tables)
        if config.tables:
            requested_tables = set(config.tables)
            missing_requested = sorted(requested_tables - set(common_tables))
            if missing_requested:
                raise RuntimeError(
                    "requested tables are not present in both source and target: "
                    + ", ".join(missing_requested)
                )
            common_tables = [table for table in common_tables if table in requested_tables]
        ordered_tables = fetch_dependency_order(metadata_target_conn, config.schemas, common_tables)
        source_columns = fetch_column_meta(metadata_source_conn, config.schemas)
        target_columns = fetch_column_meta(metadata_target_conn, config.schemas)
        primary_keys = fetch_primary_keys(metadata_target_conn, config.schemas)
    finally:
        metadata_source_conn.close()
        metadata_target_conn.close()

    retry_limit = 5
    report: Dict[str, object] = {
        "source": redact_url(config.source_url),
        "target": redact_url(config.target_url),
        "schemas": config.schemas,
        "mode": "data-only-update-existing" if config.update_existing else "data-only-insert-missing",
        "batch_size": config.batch_size,
        "requested_tables": config.tables,
        "source_only_tables": sorted(source_tables - target_tables),
        "target_only_tables": sorted(target_tables - source_tables),
        "tables": [],
        "commit_scope": "per-table",
        "table_retry_limit": retry_limit,
    }

    for index, table in enumerate(ordered_tables, 1):
        print(f"[data-only] Syncing table {index}/{len(ordered_tables)}: {table}")
        table_report: Dict[str, object] | None = None
        for attempt in range(1, retry_limit + 1):
            source_conn = None
            target_conn = None
            try:
                source_conn = connect_db(config.source_url)
                target_conn = connect_db(config.target_url)
                table_report = sync_data_table(
                    source_conn=source_conn,
                    target_conn=target_conn,
                    table=table,
                    source_columns=source_columns.get(table, []),
                    target_columns=target_columns.get(table, []),
                    primary_key=primary_keys.get(table, []),
                    update_existing=config.update_existing,
                    batch_size=config.batch_size,
                )
                if target_conn is not None:
                    target_conn.commit()
                break
            except (psycopg2.OperationalError, psycopg2.InterfaceError) as err:
                if target_conn is not None:
                    target_conn.rollback()
                if attempt >= retry_limit:
                    raise
                log(
                    f"table {table} connection failed on attempt {attempt}/{retry_limit}; "
                    "reconnecting and retrying current table..."
                )
                time.sleep(2 ** (attempt - 1))
                continue
            except Exception:
                if target_conn is not None:
                    target_conn.rollback()
                raise
            finally:
                if source_conn is not None:
                    source_conn.close()
                if target_conn is not None:
                    target_conn.close()

        assert table_report is not None
        report["tables"].append(table_report)  # type: ignore[index]
        if table_report["skipped"]:
            print(f"  skipped: {table_report['skip_reason']}")
        else:
            print(
                f"  processed={table_report['processed_rows']} "
                f"source_rows={table_report['source_rows']} "
                f"insert_candidates={table_report['insert_candidate_rows']} "
                f"filtered_existing={table_report['filtered_existing_rows']} "
                f"conflicts={table_report['conflict_rows']} "
                f"fallback_row_by_row={table_report['fallback_row_by_row']} "
                f"mode={table_report['mode']}"
            )

    print("[data-only] Refreshing target sequences...")
    target_conn = connect_db(config.target_url)
    try:
        report["sequences"] = refresh_target_sequences(target_conn, config.schemas)
        target_conn.commit()
    except Exception:
        target_conn.rollback()
        raise
    finally:
        target_conn.close()
    return report


def collect_snapshot(conn, schemas: Sequence[str]) -> Dict[str, object]:
    tables = fetch_table_names(conn, schemas)
    return {
        "tables": [f"{schema}.{table}" for schema, table in tables],
        "columns": fetch_columns(conn, schemas),
        "constraints": fetch_constraints(conn, schemas),
        "indexes": fetch_indexes(conn, schemas),
        "views": fetch_views(conn, schemas),
        "sequences": fetch_sequences(conn, schemas),
        "triggers": fetch_triggers(conn, schemas),
        "rls": fetch_rls(conn, schemas),
        "policies": fetch_policies(conn, schemas),
        "functions": fetch_functions(conn, schemas),
        "enum_types": fetch_enum_types(conn, schemas),
        "row_counts": fetch_row_counts(conn, tables),
    }


def compare_snapshots(source: Dict[str, object], target: Dict[str, object]) -> Tuple[List[str], Dict[str, object]]:
    diffs: List[str] = []
    notes: Dict[str, object] = {}
    keys = [
        "tables",
        "columns",
        "constraints",
        "indexes",
        "views",
        "sequences",
        "triggers",
        "rls",
        "policies",
        "functions",
        "enum_types",
        "row_counts",
    ]
    for key in keys:
        if source.get(key) != target.get(key):
            diffs.append(key)
            notes[key] = {
                "source_count": len(source.get(key, {})) if isinstance(source.get(key), dict) else len(source.get(key, [])),
                "target_count": len(target.get(key, {})) if isinstance(target.get(key), dict) else len(target.get(key, [])),
            }
    return diffs, notes


def write_report(path: Path, report: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def print_plan(config: RuntimeConfig) -> None:
    if config.verify_only:
        mode = "verify-only"
        operation = "This operation only compares source and target."
    elif config.data_only:
        mode = "data-only update-existing" if config.update_existing else "data-only insert-missing"
        operation = (
            "This operation keeps the target schema and target-only rows. "
            "Existing target rows are not updated unless --update-existing is passed."
        )
    else:
        mode = "destructive migrate"
        operation = "This operation rebuilds the selected target schemas."
    print("===== Database Migration Plan =====")
    print(f"Source: {redact_url(config.source_url)}")
    print(f"Target: {redact_url(config.target_url)}")
    print(f"Schemas: {', '.join(config.schemas)}")
    if config.tables:
        print(f"Tables: {', '.join(config.tables)}")
    print(f"Mode: {mode}")
    print(operation)
    if "pooler.supabase.com" in config.source_url:
        print("Warning: pooled Supabase URLs often fail with pg_dump; prefer SUPABASE_DIRECT_DB_URL.")


def main() -> int:
    try:
        config = load_runtime_config(parse_args())
    except Exception as err:  # noqa: BLE001
        print(f"configuration error: {err}", file=sys.stderr)
        return 2

    print_plan(config)
    if config.dry_run:
        return 0
    if not config.verify_only and not config.data_only and not config.yes:
        print("refusing to run destructive sync without --yes", file=sys.stderr)
        return 2

    if config.data_only:
        try:
            report = run_data_only_sync(config)
            if config.report_file:
                write_report(config.report_file, report)
                print(f"Data-only sync report written to: {config.report_file}")
            skipped_tables = [table for table in report["tables"] if table.get("skipped")]  # type: ignore[index]
            if skipped_tables:
                print(
                    f"data-only sync completed with skipped tables: {len(skipped_tables)}; "
                    "check the report for details.",
                    file=sys.stderr,
                )
                return 1
            print("data-only sync completed.")
            return 0
        except Exception as err:  # noqa: BLE001
            print(f"data-only sync failed: {err}", file=sys.stderr)
            traceback.print_exc()
            return 1

    temp_dir: Path | None = None
    dump_path: Path | None = None
    source_conn = None
    target_conn = None
    if not config.verify_only:
        if config.dump_file:
            dump_path = config.dump_file
        else:
            temp_dir = Path(tempfile.mkdtemp(prefix="supabase-db-migrate-"))
            dump_path = temp_dir / "full.sql"

    try:
        if not config.verify_only:
            assert dump_path is not None
            print("[1/4] Dumping source schema and data...")
            dump_full_sql(config, dump_path)
            normalize_schema_dump(dump_path)
            print("[2/4] Rebuilding target schemas...")
            reset_target_schemas(config)
            print("[3/4] Restoring dump into target database...")
            run_sql_file(config, dump_path)
            print("[4/4] Restore finished.")

        print("[verify] Comparing source and target...")
        try:
            source_conn = connect_db(config.source_url)
            target_conn = connect_db(config.target_url)
        except Exception as err:  # noqa: BLE001
            print(f"database connection failed: {err}", file=sys.stderr)
            return 2
        source_snapshot = collect_snapshot(source_conn, config.schemas)
        target_snapshot = collect_snapshot(target_conn, config.schemas)
        diff_keys, comparison_notes = compare_snapshots(source_snapshot, target_snapshot)
        report = {
            "source": redact_url(config.source_url),
            "target": redact_url(config.target_url),
            "schemas": config.schemas,
            "diff_keys": diff_keys,
            "comparison_notes": comparison_notes,
            "source_snapshot": source_snapshot,
            "target_snapshot": target_snapshot,
        }
        if config.report_file:
            write_report(config.report_file, report)
            print(f"Verification report written to: {config.report_file}")
        if diff_keys:
            print("verification failed; differences found in:", ", ".join(diff_keys), file=sys.stderr)
            return 1
        print("verification passed; selected schemas match exactly.")
        return 0
    except Exception as err:  # noqa: BLE001
        print(f"migration failed: {err}", file=sys.stderr)
        traceback.print_exc()
        return 1
    finally:
        if source_conn is not None:
            source_conn.close()
        if target_conn is not None:
            target_conn.close()
        if not config.keep_dump:
            if dump_path and not config.dump_file:
                dump_path.unlink(missing_ok=True)
            if temp_dir and temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
