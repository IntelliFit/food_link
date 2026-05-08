"""
Migrate the latest Supabase PostgreSQL schema and data into a self-hosted PostgreSQL database.

This script treats the source Supabase database as the source of truth and aims to make the
selected schemas in the target database match it exactly.

Default behavior:
1. Dump the selected source schemas with pg_dump into one plain SQL file.
2. Drop and recreate the same schemas in the target database.
3. Restore the dump into the target database.
4. Verify schema objects, runtime objects, sequence state, and row counts between source and target.

Typical usage:
  backend/.venv/Scripts/python.exe backend/scripts/migrate_supabase_db_to_postgres.py --dry-run
  backend/.venv/Scripts/python.exe backend/scripts/migrate_supabase_db_to_postgres.py --yes

Important:
- This is destructive for the selected target schemas.
- By default it migrates only the `public` schema, which is the app's business schema.
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
    parser.add_argument("--yes", action="store_true", help="Confirm destructive schema rebuild.")
    parser.add_argument("--pg-dump-path", default="", help="Explicit pg_dump executable path.")
    parser.add_argument("--psql-path", default="", help="Explicit psql executable path.")
    parser.add_argument(
        "--report-file",
        default="",
        help="Optional JSON report path for verification output.",
    )
    args = parser.parse_args()
    if args.dry_run and args.verify_only:
        raise SystemExit("--dry-run and --verify-only cannot be used together")
    return args


def parse_schemas(raw: str) -> List[str]:
    schemas = [item.strip() for item in raw.split(",") if item.strip()]
    if not schemas:
        raise RuntimeError("at least one schema is required")
    return schemas


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
    return RuntimeConfig(
        env_file=env_file,
        source_url=source_url,
        target_url=target_url,
        schemas=parse_schemas(args.schemas),
        dump_file=dump_file,
        keep_dump=bool(args.keep_dump),
        dry_run=bool(args.dry_run),
        verify_only=bool(args.verify_only),
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
    print("===== Database Migration Plan =====")
    print(f"Source: {redact_url(config.source_url)}")
    print(f"Target: {redact_url(config.target_url)}")
    print(f"Schemas: {', '.join(config.schemas)}")
    print(f"Mode: {'verify-only' if config.verify_only else 'migrate'}")
    print("This operation rebuilds the selected target schemas.")
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
    if not config.verify_only and not config.yes:
        print("refusing to run destructive sync without --yes", file=sys.stderr)
        return 2

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
