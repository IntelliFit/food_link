"""
轻量 PostgreSQL 查询兼容层。

目标：
1. 替代旧查询客户端的 `.table(...).select().eq()...execute()` 常用调用风格
2. 仅覆盖本项目当前使用到的能力，避免大规模手改 `database.py`
3. 底层统一使用 psycopg2 + 连接池 + 参数化 SQL
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from threading import Lock
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import psycopg2
from psycopg2 import sql
from psycopg2.extras import Json, RealDictCursor, execute_values
from psycopg2.pool import ThreadedConnectionPool


@dataclass
class QueryResult:
    data: Any


class _SelectAll:
    pass


SELECT_ALL = _SelectAll()


def _split_csv(raw: str) -> List[str]:
    return [part.strip() for part in str(raw or "").split(",") if part.strip()]


def _build_database_url() -> str:
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
        raise RuntimeError(f"缺少 PostgreSQL 配置: {', '.join(missing)}")

    parts = [f"host={host}", f"port={port}", f"user={user}", f"password={password}", f"dbname={database}"]
    if sslmode:
        parts.append(f"sslmode={sslmode}")
    return " ".join(parts)


class PostgresClient:
    def __init__(self) -> None:
        self._schema = (os.getenv("POSTGRESQL_SCHEMA") or "public").strip() or "public"
        maxconn = int((os.getenv("POSTGRESQL_POOL_MAXCONN") or "10").strip() or "10")
        self._pool = ThreadedConnectionPool(1, maxconn, dsn=_build_database_url())
        self._columns_cache: Dict[str, Dict[str, str]] = {}
        self._columns_lock = Lock()

    @property
    def schema(self) -> str:
        return self._schema

    def table(self, name: str) -> "TableQuery":
        return TableQuery(self, name)

    def get_connection(self):
        return self._pool.getconn()

    def release_connection(self, conn) -> None:
        self._pool.putconn(conn)

    def get_column_types(self, table: str) -> Dict[str, str]:
        with self._columns_lock:
            cached = self._columns_cache.get(table)
            if cached is not None:
                return cached
        conn = self.get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT column_name, data_type
                    FROM information_schema.columns
                    WHERE table_schema = %s AND table_name = %s
                    ORDER BY ordinal_position
                    """,
                    (self.schema, table),
                )
                data = {str(row["column_name"]): str(row["data_type"]) for row in cur.fetchall()}
            with self._columns_lock:
                self._columns_cache[table] = data
            return data
        finally:
            self.release_connection(conn)

    def adapt_value(self, table: str, column: str, value: Any) -> Any:
        column_type = self.get_column_types(table).get(column, "")
        if column_type in {"json", "jsonb"}:
            return Json(value)
        return value


_db_client: Optional[PostgresClient] = None


def get_db_client() -> PostgresClient:
    global _db_client
    if _db_client is None:
        _db_client = PostgresClient()
    return _db_client


def check_database_configured() -> None:
    get_db_client()


class TableQuery:
    def __init__(self, client: PostgresClient, table_name: str) -> None:
        self.client = client
        self.table_name = table_name
        self._operation = "select"
        self._select_columns: Any = SELECT_ALL
        self._filters: List[Tuple[str, str, Any]] = []
        self._or_groups: List[List[Tuple[str, str, Any]]] = []
        self._orders: List[Tuple[str, bool]] = []
        self._limit: Optional[int] = None
        self._offset: Optional[int] = None
        self._single = False
        self._payload: Any = None
        self._on_conflict: List[str] = []

    def select(self, columns: str = "*") -> "TableQuery":
        self._operation = "select"
        self._select_columns = SELECT_ALL if columns.strip() == "*" else _split_csv(columns)
        return self

    def insert(self, payload: Any) -> "TableQuery":
        self._operation = "insert"
        self._payload = payload
        return self

    def update(self, payload: Dict[str, Any]) -> "TableQuery":
        self._operation = "update"
        self._payload = payload
        return self

    def delete(self) -> "TableQuery":
        self._operation = "delete"
        return self

    def upsert(self, payload: Any, on_conflict: str = "") -> "TableQuery":
        self._operation = "upsert"
        self._payload = payload
        self._on_conflict = _split_csv(on_conflict)
        return self

    def eq(self, column: str, value: Any) -> "TableQuery":
        self._filters.append((column, "eq", value))
        return self

    def neq(self, column: str, value: Any) -> "TableQuery":
        self._filters.append((column, "neq", value))
        return self

    def gt(self, column: str, value: Any) -> "TableQuery":
        self._filters.append((column, "gt", value))
        return self

    def gte(self, column: str, value: Any) -> "TableQuery":
        self._filters.append((column, "gte", value))
        return self

    def lt(self, column: str, value: Any) -> "TableQuery":
        self._filters.append((column, "lt", value))
        return self

    def lte(self, column: str, value: Any) -> "TableQuery":
        self._filters.append((column, "lte", value))
        return self

    def ilike(self, column: str, value: Any) -> "TableQuery":
        self._filters.append((column, "ilike", value))
        return self

    def in_(self, column: str, values: Iterable[Any]) -> "TableQuery":
        self._filters.append((column, "in", list(values)))
        return self

    def or_(self, expression: str) -> "TableQuery":
        items: List[Tuple[str, str, Any]] = []
        for raw_part in str(expression or "").split(","):
            part = raw_part.strip()
            if not part:
                continue
            column, op, value = part.split(".", 2)
            items.append((column.strip(), op.strip(), value))
        if items:
            self._or_groups.append(items)
        return self

    def order(self, column: str, desc: bool = False) -> "TableQuery":
        self._orders.append((column, bool(desc)))
        return self

    def limit(self, value: int) -> "TableQuery":
        self._limit = int(value)
        return self

    def range(self, start: int, end: int) -> "TableQuery":
        self._offset = int(start)
        self._limit = max(int(end) - int(start) + 1, 0)
        return self

    def single(self) -> "TableQuery":
        self._single = True
        self._limit = 1 if self._limit is None else self._limit
        return self

    def execute(self) -> QueryResult:
        conn = self.client.get_connection()
        try:
            result = self._execute_with_connection(conn)
            if self._operation in {"insert", "update", "delete", "upsert"}:
                conn.commit()
            else:
                conn.rollback()
            return result
        except Exception:
            conn.rollback()
            raise
        finally:
            self.client.release_connection(conn)

    def _execute_with_connection(self, conn) -> QueryResult:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if self._operation == "select":
                return self._execute_select(cur)
            if self._operation == "insert":
                return self._execute_insert(cur)
            if self._operation == "update":
                return self._execute_update(cur)
            if self._operation == "delete":
                return self._execute_delete(cur)
            if self._operation == "upsert":
                return self._execute_upsert(cur)
            raise RuntimeError(f"不支持的操作: {self._operation}")

    def _build_where_clause(self) -> Tuple[sql.SQL, List[Any]]:
        clauses: List[sql.SQL] = []
        params: List[Any] = []

        for column, op, value in self._filters:
            clause, clause_params = self._build_condition(column, op, value)
            clauses.append(clause)
            params.extend(clause_params)

        for group in self._or_groups:
            group_clauses: List[sql.SQL] = []
            group_params: List[Any] = []
            for column, op, value in group:
                clause, clause_params = self._build_condition(column, op, value)
                group_clauses.append(clause)
                group_params.extend(clause_params)
            if group_clauses:
                clauses.append(sql.SQL("(") + sql.SQL(" OR ").join(group_clauses) + sql.SQL(")"))
                params.extend(group_params)

        if not clauses:
            return sql.SQL(""), []
        return sql.SQL(" WHERE ") + sql.SQL(" AND ").join(clauses), params

    def _build_condition(self, column: str, op: str, value: Any) -> Tuple[sql.SQL, List[Any]]:
        col = sql.Identifier(column)
        if op == "eq":
            return sql.SQL("{} = %s").format(col), [value]
        if op == "neq":
            return sql.SQL("{} <> %s").format(col), [value]
        if op == "gt":
            return sql.SQL("{} > %s").format(col), [value]
        if op == "gte":
            return sql.SQL("{} >= %s").format(col), [value]
        if op == "lt":
            return sql.SQL("{} < %s").format(col), [value]
        if op == "lte":
            return sql.SQL("{} <= %s").format(col), [value]
        if op == "ilike":
            return sql.SQL("{} ILIKE %s").format(col), [value]
        if op == "in":
            values = list(value or [])
            if not values:
                return sql.SQL("FALSE"), []
            placeholders = sql.SQL(", ").join(sql.Placeholder() for _ in values)
            return sql.SQL("{} IN ({})").format(col, placeholders), values
        raise RuntimeError(f"不支持的过滤操作: {op}")

    def _build_order_clause(self) -> sql.SQL:
        if not self._orders:
            return sql.SQL("")
        parts = [
            sql.SQL("{} {}").format(sql.Identifier(column), sql.SQL("DESC" if desc else "ASC"))
            for column, desc in self._orders
        ]
        return sql.SQL(" ORDER BY ") + sql.SQL(", ").join(parts)

    def _build_limit_offset_clause(self) -> Tuple[sql.SQL, List[Any]]:
        parts: List[sql.SQL] = []
        params: List[Any] = []
        if self._limit is not None:
            parts.append(sql.SQL("LIMIT %s"))
            params.append(self._limit)
        if self._offset is not None:
            parts.append(sql.SQL("OFFSET %s"))
            params.append(self._offset)
        if not parts:
            return sql.SQL(""), []
        return sql.SQL(" ") + sql.SQL(" ").join(parts), params

    def _execute_select(self, cur) -> QueryResult:
        columns_sql = (
            sql.SQL("*")
            if self._select_columns is SELECT_ALL
            else sql.SQL(", ").join(sql.Identifier(column) for column in self._select_columns)
        )
        where_sql, where_params = self._build_where_clause()
        order_sql = self._build_order_clause()
        limit_sql, limit_params = self._build_limit_offset_clause()
        query = sql.SQL("SELECT {} FROM {}.{}{}{}{}").format(
            columns_sql,
            sql.Identifier(self.client.schema),
            sql.Identifier(self.table_name),
            where_sql,
            order_sql,
            limit_sql,
        )
        cur.execute(query, where_params + limit_params)
        rows = [dict(row) for row in (cur.fetchall() or [])]
        if self._single:
            return QueryResult(rows[0] if rows else None)
        return QueryResult(rows)

    def _normalize_rows(self) -> List[Dict[str, Any]]:
        payload = self._payload
        if payload is None:
            return []
        if isinstance(payload, dict):
            return [payload]
        if isinstance(payload, list):
            return payload
        raise RuntimeError("payload 必须是 dict 或 list[dict]")

    def _collect_columns(self, rows: Sequence[Dict[str, Any]]) -> List[str]:
        columns: List[str] = []
        for row in rows:
            for key in row.keys():
                if key not in columns:
                    columns.append(key)
        return columns

    def _build_row_values(self, rows: Sequence[Dict[str, Any]], columns: Sequence[str]) -> List[Tuple[Any, ...]]:
        values: List[Tuple[Any, ...]] = []
        for row in rows:
            values.append(
                tuple(
                    self.client.adapt_value(self.table_name, column, row.get(column))
                    for column in columns
                )
            )
        return values

    def _execute_insert(self, cur) -> QueryResult:
        rows = self._normalize_rows()
        if not rows:
            return QueryResult([])
        columns = self._collect_columns(rows)
        values = self._build_row_values(rows, columns)
        query = sql.SQL("INSERT INTO {}.{} ({}) VALUES %s RETURNING *").format(
            sql.Identifier(self.client.schema),
            sql.Identifier(self.table_name),
            sql.SQL(", ").join(sql.Identifier(column) for column in columns),
        )
        data = execute_values(cur, query.as_string(cur), values, fetch=True)
        return QueryResult([dict(row) for row in (data or [])])

    def _execute_update(self, cur) -> QueryResult:
        payload = dict(self._payload or {})
        if not payload:
            return QueryResult([])
        set_columns = list(payload.keys())
        set_sql = sql.SQL(", ").join(
            sql.SQL("{} = %s").format(sql.Identifier(column)) for column in set_columns
        )
        set_params = [self.client.adapt_value(self.table_name, column, payload[column]) for column in set_columns]
        where_sql, where_params = self._build_where_clause()
        query = sql.SQL("UPDATE {}.{} SET {}{} RETURNING *").format(
            sql.Identifier(self.client.schema),
            sql.Identifier(self.table_name),
            set_sql,
            where_sql,
        )
        cur.execute(query, set_params + where_params)
        return QueryResult([dict(row) for row in (cur.fetchall() or [])])

    def _execute_delete(self, cur) -> QueryResult:
        where_sql, where_params = self._build_where_clause()
        query = sql.SQL("DELETE FROM {}.{}{} RETURNING *").format(
            sql.Identifier(self.client.schema),
            sql.Identifier(self.table_name),
            where_sql,
        )
        cur.execute(query, where_params)
        return QueryResult([dict(row) for row in (cur.fetchall() or [])])

    def _execute_upsert(self, cur) -> QueryResult:
        rows = self._normalize_rows()
        if not rows:
            return QueryResult([])
        columns = self._collect_columns(rows)
        values = self._build_row_values(rows, columns)
        conflict_columns = self._on_conflict or []
        if not conflict_columns:
            return self._execute_insert(cur)

        update_columns = [column for column in columns if column not in conflict_columns]
        if update_columns:
            conflict_action = sql.SQL("DO UPDATE SET ") + sql.SQL(", ").join(
                sql.SQL("{col} = EXCLUDED.{col}").format(col=sql.Identifier(column))
                for column in update_columns
            )
        else:
            conflict_action = sql.SQL("DO NOTHING")

        query = sql.SQL(
            "INSERT INTO {}.{} ({}) VALUES %s ON CONFLICT ({}) {} RETURNING *"
        ).format(
            sql.Identifier(self.client.schema),
            sql.Identifier(self.table_name),
            sql.SQL(", ").join(sql.Identifier(column) for column in columns),
            sql.SQL(", ").join(sql.Identifier(column) for column in conflict_columns),
            conflict_action,
        )
        data = execute_values(cur, query.as_string(cur), values, fetch=True)
        return QueryResult([dict(row) for row in (data or [])])
