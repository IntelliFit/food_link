"""Deactivate active nutrition rows that violate hard per-100g constraints.

Dry-run is the default. The repair never invents replacement nutrition values;
it only deactivates rows that are physically impossible and writes a backup.
"""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from audit_nutrition_quality_deepseek import _connect, _load_local_env, _read_yaml_config


AUDIT_SQL = """
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
    source,
    updated_at
FROM public.food_nutrition_library
WHERE is_active = TRUE
  AND (
      COALESCE(kcal_per_100g, 0) < 0
      OR COALESCE(protein_per_100g, 0) < 0
      OR COALESCE(carbs_per_100g, 0) < 0
      OR COALESCE(fat_per_100g, 0) < 0
      OR COALESCE(fiber_per_100g, 0) < 0
      OR COALESCE(sugar_per_100g, 0) < 0
      OR COALESCE(kcal_per_100g, 0) > 950
      OR COALESCE(protein_per_100g, 0) > 100.5
      OR COALESCE(carbs_per_100g, 0) > 100.5
      OR COALESCE(fat_per_100g, 0) > 100.5
      OR COALESCE(fiber_per_100g, 0) > 100.5
      OR COALESCE(sugar_per_100g, 0) > 100.5
      OR COALESCE(protein_per_100g, 0)
         + COALESCE(carbs_per_100g, 0)
         + COALESCE(fat_per_100g, 0) > 105
  )
ORDER BY canonical_name, id
"""


def fetch_candidates(conn: Any) -> List[Dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(AUDIT_SQL)
        columns = [desc[0] for desc in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def write_reports(out_dir: Path, rows: List[Dict[str, Any]]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "backup.json").open("w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2, default=str)
    columns = list(rows[0].keys()) if rows else ["id", "canonical_name", "source"]
    with (out_dir / "backup.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def apply_repairs(conn: Any, rows: List[Dict[str, Any]]) -> int:
    updated = 0
    with conn.cursor() as cur:
        for row in rows:
            cur.execute(
                """
                UPDATE public.food_nutrition_library
                SET is_active = FALSE, updated_at = now()
                WHERE id = %s AND is_active = TRUE
                """,
                (row["id"],),
            )
            updated += cur.rowcount
    return updated


def main() -> int:
    parser = argparse.ArgumentParser(description="Deactivate physically impossible nutrition rows.")
    parser.add_argument("--config", default=str(Path(__file__).resolve().parent.parent / "config.yaml"))
    parser.add_argument("--out-dir", default="")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    _load_local_env()
    config = _read_yaml_config(Path(args.config))
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(args.out_dir) if args.out_dir else Path("tmp") / f"nutrition-hard-invalid-{timestamp}"

    conn = _connect(config)
    try:
        conn.set_session(readonly=not args.apply, autocommit=False)
        rows = fetch_candidates(conn)
        write_reports(out_dir, rows)
        print(json.dumps({"candidates": len(rows), "out_dir": str(out_dir), "apply": args.apply}, ensure_ascii=False))
        if not args.apply:
            conn.rollback()
            return 0

        updated = apply_repairs(conn, rows)
        remaining = fetch_candidates(conn)
        if remaining:
            conn.rollback()
            raise RuntimeError(f"postcheck failed: {len(remaining)} hard-invalid rows remain")
        conn.commit()
        print(json.dumps({"updated": updated, "remaining": 0}, ensure_ascii=False))
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
