"""
Safely replace food_nutrition_library rows from a corrected CSV.

Usage:
    # Preview changes (dry-run)
    python backend/scripts/safe_replace_library.py \
        --new-csv path/to/corrected.csv \
        --dry-run

    # Apply changes
    python backend/scripts/safe_replace_library.py \
        --new-csv path/to/corrected.csv

Features:
- Uses a transaction: all changes roll back on error
- Compares old vs new and shows a preview
- Handles UPDATE, INSERT, and optional DELETE
- Warns if DELETE would cascade to food_nutrition_aliases
- Never drops the table (preserves indexes, constraints, triggers)

Environment:
    Reads POSTGRESQL_HOST, POSTGRESQL_PORT, POSTGRESQL_DATABASE,
    POSTGRESQL_USER, POSTGRESQL_PASSWORD from backend/.env
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import execute_values


def _load_env() -> None:
    backend_dir = Path(__file__).resolve().parent.parent
    load_dotenv(backend_dir / ".env", override=False)
    load_dotenv(backend_dir / ".env.local", override=False)


def _get_conn() -> Any:
    host = os.getenv("POSTGRESQL_HOST", "")
    port = os.getenv("POSTGRESQL_PORT", "5432")
    db = os.getenv("POSTGRESQL_DATABASE", "")
    user = os.getenv("POSTGRESQL_USER", "")
    password = os.getenv("POSTGRESQL_PASSWORD", "")
    if not all([host, db, user]):
        raise RuntimeError("Missing PostgreSQL env vars")
    dsn = f"host={host} port={port} dbname={db} user={user} password={password} sslmode=require"
    return psycopg2.connect(dsn)


# CSV -> DB column mapping (must match your CSV header)
CSV_COLUMNS = [
    "id", "canonical_name", "normalized_name",
    "kcal_per_100g", "protein_per_100g", "carbs_per_100g", "fat_per_100g",
    "is_active", "source", "created_at", "updated_at",
    "fiber_per_100g", "sugar_per_100g", "saturated_fat_per_100g",
    "cholesterol_mg_per_100g", "sodium_mg_per_100g", "potassium_mg_per_100g",
    "calcium_mg_per_100g", "iron_mg_per_100g", "magnesium_mg_per_100g", "zinc_mg_per_100g",
    "vitamin_a_rae_mcg_per_100g", "vitamin_c_mg_per_100g", "vitamin_d_mcg_per_100g",
    "vitamin_e_mg_per_100g", "vitamin_k_mcg_per_100g", "thiamin_mg_per_100g",
    "riboflavin_mg_per_100g", "niacin_mg_per_100g", "vitamin_b6_mg_per_100g",
    "folate_mcg_per_100g", "vitamin_b12_mcg_per_100g",
]

NUMERIC_COLUMNS = [
    "kcal_per_100g", "protein_per_100g", "carbs_per_100g", "fat_per_100g",
    "fiber_per_100g", "sugar_per_100g", "saturated_fat_per_100g",
    "cholesterol_mg_per_100g", "sodium_mg_per_100g", "potassium_mg_per_100g",
    "calcium_mg_per_100g", "iron_mg_per_100g", "magnesium_mg_per_100g", "zinc_mg_per_100g",
    "vitamin_a_rae_mcg_per_100g", "vitamin_c_mg_per_100g", "vitamin_d_mcg_per_100g",
    "vitamin_e_mg_per_100g", "vitamin_k_mcg_per_100g", "thiamin_mg_per_100g",
    "riboflavin_mg_per_100g", "niacin_mg_per_100g", "vitamin_b6_mg_per_100g",
    "folate_mcg_per_100g", "vitamin_b12_mcg_per_100g",
]


def parse_csv(path: Path) -> List[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = []
        for r in reader:
            row = {}
            for col in CSV_COLUMNS:
                val = r.get(col, "")
                if col in NUMERIC_COLUMNS:
                    row[col] = float(val) if val != "" else 0.0
                elif col == "is_active":
                    row[col] = val.lower() in ("true", "t", "1", "yes")
                else:
                    row[col] = val
            rows.append(row)
        return rows


def build_comparison(conn: Any, new_rows: List[Dict[str, Any]]) -> Tuple[
    List[Dict[str, Any]],  # updates
    List[Dict[str, Any]],  # inserts
    List[Dict[str, Any]],  # deletes (old rows not in new)
    int,  # unchanged count
]:
    new_by_id = {r["id"]: r for r in new_rows}
    old_by_id: Dict[str, Dict[str, Any]] = {}

    with conn.cursor() as cur:
        cur.execute("SELECT " + ",".join(CSV_COLUMNS) + " FROM public.food_nutrition_library")
        for row in cur.fetchall():
            old = dict(zip(CSV_COLUMNS, row))
            for col in NUMERIC_COLUMNS:
                old[col] = float(old[col]) if old[col] is not None else 0.0
            old["is_active"] = bool(old["is_active"])
            old_by_id[old["id"]] = old

    updates = []
    inserts = []
    deletes = []
    unchanged = 0

    for nid, new in new_by_id.items():
        old = old_by_id.get(nid)
        if old is None:
            inserts.append(new)
            continue
        changed = False
        for col in CSV_COLUMNS:
            if col == "id":
                continue
            if new.get(col) != old.get(col):
                changed = True
                break
        if changed:
            updates.append({"new": new, "old": old})
        else:
            unchanged += 1

    for oid, old in old_by_id.items():
        if oid not in new_by_id:
            deletes.append(old)

    return updates, inserts, deletes, unchanged


def get_alias_counts(conn: Any, ids: Sequence[str]) -> Dict[str, int]:
    if not ids:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            "SELECT food_id, COUNT(*) FROM public.food_nutrition_aliases "
            "WHERE food_id = ANY(%s) GROUP BY food_id",
            (list(ids),)
        )
        return {str(fid): cnt for fid, cnt in cur.fetchall()}


def apply_changes(conn: Any, new_rows: List[Dict[str, Any]], allow_delete: bool) -> None:
    updates, inserts, deletes, unchanged = build_comparison(conn, new_rows)

    print(f"Changes to apply:")
    print(f"  UPDATE: {len(updates)}")
    print(f"  INSERT: {len(inserts)}")
    print(f"  DELETE: {len(deletes)} {'(skipped, use --allow-delete)' if deletes and not allow_delete else ''}")
    print(f"  UNCHANGED: {unchanged}")

    if not updates and not inserts and (not deletes or not allow_delete):
        print("Nothing to do.")
        return

    # Check aliases for deleted rows
    if deletes and allow_delete:
        delete_ids = [d["id"] for d in deletes]
        alias_counts = get_alias_counts(conn, delete_ids)
        total_aliases_to_delete = sum(alias_counts.values())
        if total_aliases_to_delete > 0:
            print(f"\nWARNING: DELETE will cascade to {total_aliases_to_delete} alias records.")
            print("Affected foods with aliases:")
            for fid in delete_ids:
                if fid in alias_counts:
                    print(f"  {fid}: {alias_counts[fid]} aliases")

    # Build UPDATE statement
    update_cols = [c for c in CSV_COLUMNS if c != "id"]
    set_clause = ", ".join(f"{c} = %({c})s" for c in update_cols)

    with conn.cursor() as cur:
        for item in updates:
            new = item["new"]
            params = {c: new[c] for c in update_cols}
            params["id"] = new["id"]
            cur.execute(
                f"UPDATE public.food_nutrition_library SET {set_clause} WHERE id = %(id)s",
                params,
            )

        # INSERT new rows
        if inserts:
            cols = ",".join(CSV_COLUMNS)
            vals = ",".join(f"%({c})s" for c in CSV_COLUMNS)
            for row in inserts:
                cur.execute(
                    f"INSERT INTO public.food_nutrition_library ({cols}) VALUES ({vals})",
                    row,
                )

        # DELETE old rows not in new CSV
        if deletes and allow_delete:
            delete_ids = [d["id"] for d in deletes]
            # Batch delete for efficiency
            for chunk in [delete_ids[i:i+500] for i in range(0, len(delete_ids), 500)]:
                cur.execute(
                    "DELETE FROM public.food_nutrition_library WHERE id = ANY(%s)",
                    (chunk,)
                )

    print("Changes applied successfully.")


def preview_changes(conn: Any, new_rows: List[Dict[str, Any]]) -> None:
    updates, inserts, deletes, unchanged = build_comparison(conn, new_rows)

    print("=" * 60)
    print("DRY-RUN PREVIEW")
    print("=" * 60)
    print(f"UPDATE: {len(updates)} rows")
    print(f"INSERT: {len(inserts)} rows")
    print(f"DELETE: {len(deletes)} rows (will cascade to aliases)")
    print(f"UNCHANGED: {unchanged} rows")
    print()

    if inserts:
        print("--- INSERT preview (first 5) ---")
        for r in inserts[:5]:
            print(f"  + {r['canonical_name']} (id={r['id'][:8]}...)")
        print()

    if updates:
        print("--- UPDATE preview (first 5) ---")
        for item in updates[:5]:
            new = item["new"]
            old = item["old"]
            diffs = []
            for col in NUMERIC_COLUMNS:
                if new.get(col) != old.get(col):
                    diffs.append(f"{col}: {old.get(col)} -> {new.get(col)}")
            print(f"  ~ {new['canonical_name']} (id={new['id'][:8]}...)")
            for d in diffs[:3]:
                print(f"      {d}")
        print()

    if deletes:
        delete_ids = [d["id"] for d in deletes]
        alias_counts = get_alias_counts(conn, delete_ids)
        total_aliases = sum(alias_counts.values())
        print(f"--- DELETE preview (first 5, {total_aliases} aliases will be lost) ---")
        for d in deletes[:5]:
            aliases = alias_counts.get(d["id"], 0)
            print(f"  - {d['canonical_name']} (id={d['id'][:8]}..., aliases={aliases})")
        print()


def main() -> int:
    parser = argparse.ArgumentParser(description="Safely replace food_nutrition_library from corrected CSV")
    parser.add_argument("--new-csv", required=True, help="Path to corrected CSV file")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without applying")
    parser.add_argument("--allow-delete", action="store_true",
                        help="Allow deleting rows not present in new CSV (cascades to aliases)")
    args = parser.parse_args()

    _load_env()

    new_csv = Path(args.new_csv)
    if not new_csv.exists():
        print(f"File not found: {new_csv}")
        return 1

    print(f"Reading new CSV: {new_csv}")
    new_rows = parse_csv(new_csv)
    print(f"Loaded {len(new_rows)} rows from CSV")

    print("Connecting to database...")
    conn = _get_conn()
    conn.autocommit = False

    try:
        preview_changes(conn, new_rows)

        if args.dry_run:
            print("Dry run complete. No changes applied.")
            conn.rollback()
            return 0

        confirm = input("\nApply changes? Type 'yes' to proceed: ")
        if confirm.strip().lower() != "yes":
            print("Aborted.")
            conn.rollback()
            return 0

        apply_changes(conn, new_rows, args.allow_delete)
        conn.commit()
        print("Committed.")

    except Exception as e:
        print(f"ERROR: {e}")
        conn.rollback()
        print("Rolled back.")
        return 1
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
