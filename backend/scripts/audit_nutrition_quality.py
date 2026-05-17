"""
Audit food_nutrition_library data quality.

Usage:
    python backend/scripts/audit_nutrition_quality.py

Steps:
1. Connect to Supabase PostgreSQL (reads backend/.env)
2. Count total rows in food_nutrition_library
3. Random sample N rows
4. Export sample JSON for manual / automated review
5. (Optional) Fetch USDA reference data and compute deviation report

Environment variables (from backend/.env):
    POSTGRESQL_HOST, POSTGRESQL_PORT, POSTGRESQL_DATABASE,
    POSTGRESQL_USER, POSTGRESQL_PASSWORD
    OR
    SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY via Supabase client
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from dotenv import load_dotenv


def _load_env() -> None:
    backend_dir = Path(__file__).resolve().parent.parent
    load_dotenv(backend_dir / ".env", override=False)
    load_dotenv(backend_dir / ".env.local", override=False)


def _get_postgres_dsn() -> str:
    host = os.getenv("POSTGRESQL_HOST", "")
    port = os.getenv("POSTGRESQL_PORT", "5432")
    db = os.getenv("POSTGRESQL_DATABASE", "")
    user = os.getenv("POSTGRESQL_USER", "")
    password = os.getenv("POSTGRESQL_PASSWORD", "")
    if not all([host, db, user]):
        raise RuntimeError(
            "Missing PostgreSQL env vars. "
            "Need: POSTGRESQL_HOST, POSTGRESQL_DATABASE, POSTGRESQL_USER, POSTGRESQL_PASSWORD"
        )
    return f"host={host} port={port} dbname={db} user={user} password={password} sslmode=require"


def _connect() -> Any:
    import psycopg2
    dsn = _get_postgres_dsn()
    return psycopg2.connect(dsn)


def count_total(conn: Any) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM public.food_nutrition_library")
        return cur.fetchone()[0]


def count_active(conn: Any) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM public.food_nutrition_library WHERE is_active = true")
        return cur.fetchone()[0]


def get_stats(conn: Any) -> Dict[str, Any]:
    stats = {}
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                COUNT(*) FILTER (WHERE kcal_per_100g = 0) as zero_kcal,
                COUNT(*) FILTER (WHERE protein_per_100g = 0) as zero_protein,
                COUNT(*) FILTER (WHERE carbs_per_100g = 0) as zero_carbs,
                COUNT(*) FILTER (WHERE fat_per_100g = 0) as zero_fat,
                COUNT(*) FILTER (WHERE source IS NULL OR source = '') as no_source
            FROM public.food_nutrition_library
            WHERE is_active = true
        """)
        row = cur.fetchone()
        stats["zero_kcal"] = row[0]
        stats["zero_protein"] = row[1]
        stats["zero_carbs"] = row[2]
        stats["zero_fat"] = row[3]
        stats["no_source"] = row[4]
    return stats


def random_sample(conn: Any, n: int = 30) -> List[Dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
                id,
                canonical_name,
                normalized_name,
                kcal_per_100g,
                protein_per_100g,
                carbs_per_100g,
                fat_per_100g,
                fiber_per_100g,
                sugar_per_100g,
                saturated_fat_per_100g,
                cholesterol_mg_per_100g,
                sodium_mg_per_100g,
                potassium_mg_per_100g,
                calcium_mg_per_100g,
                iron_mg_per_100g,
                magnesium_mg_per_100g,
                zinc_mg_per_100g,
                vitamin_a_rae_mcg_per_100g,
                vitamin_c_mg_per_100g,
                vitamin_d_mcg_per_100g,
                vitamin_e_mg_per_100g,
                vitamin_k_mcg_per_100g,
                thiamin_mg_per_100g,
                riboflavin_mg_per_100g,
                niacin_mg_per_100g,
                vitamin_b6_mg_per_100g,
                folate_mcg_per_100g,
                vitamin_b12_mcg_per_100g,
                is_active,
                source,
                created_at,
                updated_at
            FROM public.food_nutrition_library
            ORDER BY RANDOM()
            LIMIT %s
        """, (n,))
        columns = [desc[0] for desc in cur.description]
        rows = cur.fetchall()
        return [dict(zip(columns, row)) for row in rows]


def sample_by_source_distribution(conn: Any, n: int = 30) -> List[Dict[str, Any]]:
    """Stratified sample: pick proportional rows from each source bucket."""
    with conn.cursor() as cur:
        cur.execute("""
            WITH buckets AS (
                SELECT
                    COALESCE(source, 'unknown') AS src,
                    COUNT(*) AS cnt,
                    ROUND(COUNT(*) * 1.0 / SUM(COUNT(*)) OVER () * %s) AS pick
                FROM public.food_nutrition_library
                WHERE is_active = true
                GROUP BY source
            )
            SELECT src, pick FROM buckets WHERE pick > 0
        """, (n,))
        buckets = cur.fetchall()

    samples = []
    for src, pick in buckets:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    id, canonical_name, normalized_name,
                    kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
                    fiber_per_100g, sugar_per_100g, saturated_fat_per_100g,
                    cholesterol_mg_per_100g, sodium_mg_per_100g,
                    potassium_mg_per_100g, calcium_mg_per_100g,
                    iron_mg_per_100g, magnesium_mg_per_100g, zinc_mg_per_100g,
                    vitamin_a_rae_mcg_per_100g, vitamin_c_mg_per_100g,
                    vitamin_d_mcg_per_100g, vitamin_e_mg_per_100g,
                    vitamin_k_mcg_per_100g, thiamin_mg_per_100g,
                    riboflavin_mg_per_100g, niacin_mg_per_100g,
                    vitamin_b6_mg_per_100g, folate_mcg_per_100g,
                    vitamin_b12_mcg_per_100g,
                    is_active, source, created_at, updated_at
                FROM public.food_nutrition_library
                WHERE is_active = true AND (source = %s OR (source IS NULL AND %s = 'unknown'))
                ORDER BY RANDOM()
                LIMIT %s
            """, (src if src != 'unknown' else None, src, int(pick)))
            columns = [desc[0] for desc in cur.description]
            rows = cur.fetchall()
            samples.extend([dict(zip(columns, row)) for row in rows])
    return samples


def save_report(out_dir: Path, total: int, active: int, stats: Dict[str, Any],
                sample: List[Dict[str, Any]], stratified: List[Dict[str, Any]]) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = out_dir / f"nutrition_audit_{timestamp}.json"

    report = {
        "generated_at": datetime.now().isoformat(),
        "summary": {
            "total_rows": total,
            "active_rows": active,
            "inactive_rows": total - active,
        },
        "nullish_stats": stats,
        "random_sample": sample,
        "stratified_sample": stratified,
    }

    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, default=str)

    return report_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit food_nutrition_library quality")
    parser.add_argument("--sample-size", type=int, default=30, help="Random sample size")
    parser.add_argument("--out-dir", type=str, default="backend/scripts/output",
                        help="Output directory for reports")
    args = parser.parse_args()

    _load_env()

    print("Connecting to database...")
    conn = _connect()

    print("Counting total rows...")
    total = count_total(conn)
    active = count_active(conn)
    stats = get_stats(conn)

    print(f"Total rows: {total}")
    print(f"Active rows: {active}")
    print(f"Inactive rows: {total - active}")
    print(f"Active rows with zero kcal: {stats['zero_kcal']}")
    print(f"Active rows with zero protein: {stats['zero_protein']}")
    print(f"Active rows with zero carbs: {stats['zero_carbs']}")
    print(f"Active rows with zero fat: {stats['zero_fat']}")
    print(f"Active rows with no source: {stats['no_source']}")

    print(f"\nSampling {args.sample_size} random rows...")
    sample = random_sample(conn, args.sample_size)

    print("Sampling stratified by source...")
    stratified = sample_by_source_distribution(conn, args.sample_size)

    out_dir = Path(args.out_dir)
    report_path = save_report(out_dir, total, active, stats, sample, stratified)
    print(f"\nReport saved to: {report_path}")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
