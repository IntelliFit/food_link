"""Audit and repair packaged-food serving weights that exceed net content.

Dry-run is the default. Use --apply only after reviewing the generated backup.
The repair is deterministic and idempotent: an impossible serving weight is
replaced with the package's declared net weight.
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
WITH candidates AS (
    SELECT
        id,
        product_name,
        display_name,
        net_weight_g,
        net_content_value,
        net_content_unit,
        serving_weight_g,
        CASE
            WHEN COALESCE(net_weight_g, 0) > 0 THEN net_weight_g
            WHEN COALESCE(net_content_value, 0) > 0
                 AND LOWER(COALESCE(net_content_unit, '')) IN ('g', '克')
                THEN net_content_value
            ELSE 0
        END AS container_weight_g,
        updated_at
    FROM public.packaged_food_library
    WHERE is_active = TRUE
)
SELECT *
FROM candidates
WHERE container_weight_g > 0
  AND serving_weight_g > container_weight_g * 1.05
ORDER BY product_name, id
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
    columns = list(rows[0].keys()) if rows else ["id", "product_name", "serving_weight_g", "container_weight_g"]
    with (out_dir / "backup.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def apply_repairs(conn: Any, rows: List[Dict[str, Any]]) -> int:
    updated = 0
    with conn.cursor() as cur:
        for row in rows:
            cur.execute(
                """
                UPDATE public.packaged_food_library
                SET serving_weight_g = %s, updated_at = now()
                WHERE id = %s
                  AND serving_weight_g > %s * 1.05
                """,
                (row["container_weight_g"], row["id"], row["container_weight_g"]),
            )
            updated += cur.rowcount
    return updated


def main() -> int:
    parser = argparse.ArgumentParser(description="Repair packaged serving weights above package net weight.")
    parser.add_argument("--config", default=str(Path(__file__).resolve().parent.parent / "config.yaml"))
    parser.add_argument("--out-dir", default="")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    _load_local_env()
    config = _read_yaml_config(Path(args.config))
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(args.out_dir) if args.out_dir else Path("tmp") / f"packaged-serving-overflow-{timestamp}"

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
            raise RuntimeError(f"postcheck failed: {len(remaining)} serving-weight overflows remain")
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
