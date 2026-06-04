"""
Audit image coverage for the manual food record section.

Usage:
    python backend/scripts/audit_manual_food_image_coverage.py

The script is read-only. It reads database credentials from backend/.env or
backend/.env.local, using the same POSTGRESQL_* variables as other scripts.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Iterable

import psycopg2
from dotenv import load_dotenv


def _load_env() -> None:
    backend_dir = Path(__file__).resolve().parent.parent
    load_dotenv(backend_dir / ".env", override=False)
    load_dotenv(backend_dir / ".env.local", override=False)


def _get_conn() -> Any:
    database_url = (
        os.getenv("SUPABASE_DB_URL")
        or os.getenv("DATABASE_URL")
        or os.getenv("SUPABASE_DIRECT_DB_URL")
        or os.getenv("SUPABASE_DB_DIRECT_URL")
        or ""
    ).strip()
    if database_url:
        return psycopg2.connect(database_url)

    host = os.getenv("POSTGRESQL_HOST", "").strip()
    port = os.getenv("POSTGRESQL_PORT", "5432").strip()
    db = os.getenv("POSTGRESQL_DATABASE", "").strip()
    user = os.getenv("POSTGRESQL_USER", "").strip()
    password = os.getenv("POSTGRESQL_PASSWORD", "")
    sslmode = os.getenv("POSTGRESQL_SSLMODE", "require").strip() or "require"
    if not all([host, db, user]):
        raise RuntimeError(
            "Missing PostgreSQL env vars. Need POSTGRESQL_HOST, "
            "POSTGRESQL_DATABASE, POSTGRESQL_USER, POSTGRESQL_PASSWORD."
        )
    dsn = (
        f"host={host} port={port} dbname={db} user={user} "
        f"password={password} sslmode={sslmode}"
    )
    return psycopg2.connect(dsn)


def _fetch_dicts(conn: Any, sql: str) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql)
        columns = [desc[0] for desc in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def _fetch_one_dict(conn: Any, sql: str) -> dict[str, Any]:
    rows = _fetch_dicts(conn, sql)
    return rows[0] if rows else {}


def _pct(part: int, total: int) -> str:
    if total <= 0:
        return "0.00%"
    return f"{part / total * 100:.2f}%"


def _print_rows(title: str, rows: Iterable[dict[str, Any]]) -> None:
    print(f"\n## {title}")
    for row in rows:
        print(json.dumps(row, ensure_ascii=False, default=str))


PUBLIC_LIBRARY_SQL = """
WITH scoped AS (
    SELECT
        id,
        status,
        COALESCE(total_calories, 0) AS total_calories,
        NULLIF(trim(COALESCE(image_path, '')), '') AS clean_image_path,
        EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(image_paths, '[]'::jsonb)) AS image_url
            WHERE NULLIF(trim(image_url), '') IS NOT NULL
        ) AS has_image_paths
    FROM public.public_food_library
    WHERE status = 'published'
)
SELECT
    'public_library' AS source,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE clean_image_path IS NOT NULL OR has_image_paths)::int AS with_image,
    COUNT(*) FILTER (WHERE clean_image_path IS NULL AND NOT has_image_paths)::int AS empty_image,
    COUNT(*) FILTER (WHERE total_calories > 0 AND total_calories <= 900)::int AS browse_eligible_total,
    COUNT(*) FILTER (
        WHERE total_calories > 0
          AND total_calories <= 900
          AND (clean_image_path IS NOT NULL OR has_image_paths)
    )::int AS browse_eligible_with_image,
    COUNT(*) FILTER (
        WHERE total_calories > 0
          AND total_calories <= 900
          AND clean_image_path IS NULL
          AND NOT has_image_paths
    )::int AS browse_eligible_empty_image
FROM scoped;
"""


PACKAGED_FOOD_SQL = """
WITH scoped AS (
    SELECT
        id,
        COALESCE(kcal_per_100g, 0) AS kcal_per_100g,
        EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(source_image_urls, '[]'::jsonb)) AS image_url
            WHERE NULLIF(trim(image_url), '') IS NOT NULL
        ) AS has_image
    FROM public.packaged_food_library
    WHERE is_active = TRUE
      AND COALESCE(kcal_per_100g, 0) > 0
)
SELECT
    'packaged_food' AS source,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE has_image)::int AS with_image,
    COUNT(*) FILTER (WHERE NOT has_image)::int AS empty_image
FROM scoped;
"""


NUTRITION_LIBRARY_SQL = """
WITH scoped AS (
    SELECT
        id,
        NULLIF(trim(COALESCE(image_path, '')), '') AS clean_image_path,
        EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(image_paths, '[]'::jsonb)) AS image_url
            WHERE NULLIF(trim(image_url), '') IS NOT NULL
        ) AS has_image_paths
    FROM public.food_nutrition_library
    WHERE is_active = TRUE
      AND COALESCE(kcal_per_100g, 0) > 0
)
SELECT
    'nutrition_library' AS source,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE clean_image_path IS NOT NULL OR has_image_paths)::int AS with_image,
    COUNT(*) FILTER (WHERE clean_image_path IS NULL AND NOT has_image_paths)::int AS empty_image
FROM scoped;
"""


RECENT_REFERENCE_SQL = """
WITH refs AS (
    SELECT DISTINCT
        item->>'manual_source' AS source,
        item->>'manual_source_id' AS source_id
    FROM public.user_food_records
    CROSS JOIN LATERAL jsonb_array_elements(items) AS item
    WHERE item->>'manual_source' IN ('public_library', 'packaged_food', 'nutrition_library')
      AND COALESCE(item->>'manual_source_id', '') <> ''
),
resolved AS (
    SELECT
        refs.source,
        refs.source_id,
        CASE
            WHEN refs.source = 'public_library' THEN EXISTS (
                SELECT 1
                FROM public.public_food_library p
                WHERE p.id::text = refs.source_id
                  AND (
                      NULLIF(trim(COALESCE(p.image_path, '')), '') IS NOT NULL
                      OR EXISTS (
                          SELECT 1
                          FROM jsonb_array_elements_text(COALESCE(p.image_paths, '[]'::jsonb)) AS image_url
                          WHERE NULLIF(trim(image_url), '') IS NOT NULL
                      )
                  )
            )
            WHEN refs.source = 'packaged_food' THEN EXISTS (
                SELECT 1
                FROM public.packaged_food_library f
                WHERE f.id::text = refs.source_id
                  AND EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements_text(COALESCE(f.source_image_urls, '[]'::jsonb)) AS image_url
                      WHERE NULLIF(trim(image_url), '') IS NOT NULL
                  )
            )
            WHEN refs.source = 'nutrition_library' THEN EXISTS (
                SELECT 1
                FROM public.food_nutrition_library n
                WHERE n.id::text = refs.source_id
                  AND (
                      NULLIF(trim(COALESCE(n.image_path, '')), '') IS NOT NULL
                      OR EXISTS (
                          SELECT 1
                          FROM jsonb_array_elements_text(COALESCE(n.image_paths, '[]'::jsonb)) AS image_url
                          WHERE NULLIF(trim(image_url), '') IS NOT NULL
                      )
                  )
            )
            ELSE FALSE
        END AS has_image
    FROM refs
)
SELECT
    source,
    COUNT(*)::int AS unique_referenced_items,
    COUNT(*) FILTER (WHERE has_image)::int AS with_image,
    COUNT(*) FILTER (WHERE NOT has_image)::int AS empty_image
FROM resolved
GROUP BY source
ORDER BY source;
"""


FREQUENT_CATALOG_SQL = """
WITH record_items AS (
    SELECT
        trim(COALESCE(NULLIF(item->>'manual_source_title', ''), NULLIF(item->>'name', ''))) AS name,
        item
    FROM public.user_food_records
    CROSS JOIN LATERAL jsonb_array_elements(items) item
    WHERE trim(COALESCE(NULLIF(item->>'manual_source_title', ''), NULLIF(item->>'name', ''))) <> ''
      AND COALESCE(item->'nutrients'->>'calories', item->>'calories') ~ '^[0-9]+([.][0-9]+){0,1}$'
),
catalog AS (
    SELECT name
    FROM record_items
    GROUP BY name
    HAVING COUNT(*) >= 3
)
SELECT
    'frequent_record_catalog' AS source,
    COUNT(*)::int AS total,
    0::int AS with_image,
    COUNT(*)::int AS empty_image,
    'derived from user_food_records; manual_food_repo does not attach images' AS note
FROM catalog;
"""


def main() -> None:
    _load_env()
    with _get_conn() as conn:
        public_row = _fetch_one_dict(conn, PUBLIC_LIBRARY_SQL)
        packaged_row = _fetch_one_dict(conn, PACKAGED_FOOD_SQL)
        nutrition_row = _fetch_one_dict(conn, NUTRITION_LIBRARY_SQL)
        frequent_row = _fetch_one_dict(conn, FREQUENT_CATALOG_SQL)
        recent_rows = _fetch_dicts(conn, RECENT_REFERENCE_SQL)

    image_sources = [public_row, packaged_row]
    image_total = sum(int(row["total"]) for row in image_sources)
    image_with = sum(int(row["with_image"]) for row in image_sources)
    image_empty = sum(int(row["empty_image"]) for row in image_sources)

    all_sources = [public_row, packaged_row, nutrition_row, frequent_row]
    all_total = sum(int(row["total"]) for row in all_sources)
    all_with = sum(int(row["with_image"]) for row in all_sources)
    all_empty = sum(int(row["empty_image"]) for row in all_sources)

    print("# Manual food image coverage")
    print("Only public_library and packaged_food have real image fields.")
    print(
        json.dumps(
            {
                "image_capable_sources": {
                    "total": image_total,
                    "with_image": image_with,
                    "empty_image": image_empty,
                    "with_image_rate": _pct(image_with, image_total),
                    "empty_image_rate": _pct(image_empty, image_total),
                },
                "all_manual_food_sources_including_no_image_sources": {
                    "total": all_total,
                    "with_image": all_with,
                    "empty_image_or_no_image_field": all_empty,
                    "with_image_rate": _pct(all_with, all_total),
                    "empty_image_rate": _pct(all_empty, all_total),
                },
            },
            ensure_ascii=False,
        )
    )
    _print_rows("Source breakdown", all_sources)
    _print_rows("Unique recent manual references", recent_rows)


if __name__ == "__main__":
    main()
