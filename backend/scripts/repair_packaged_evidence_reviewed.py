"""Apply manually image-reviewed packaged-food corrections.

This script is intentionally allow-listed: every mutation has an expected old
value and visible source-image evidence reviewed on 2026-07-14. Dry-run is the
default; --apply performs one transaction and writes a complete backup first.
"""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from audit_nutrition_quality_deepseek import _connect, _load_local_env, _read_yaml_config


SERVING_CORRECTIONS = {
    "8f46b6ba-93e5-4ed9-aa3b-49085ab1d43d": {
        "expected_serving": 25.0,
        "serving": 50.0,
        "reason": "原图只显示净含量50g，没有25g每份或单位拆分；默认整包",
    },
    "a1a5db2d-89bc-45a7-ad92-5508a157d670": {
        "expected_serving": 30.0,
        "serving": 10.0,
        "unit_count": 20.0,
        "unit_content_value": 10.0,
        "unit_content_unit": "g",
        "spec_text": "200克（10克×20）",
        "reason": "原图侧面明确显示200克（10克×20）",
    },
}

QUARANTINE = {
    "7d5c026f-925d-4adf-a1cd-990405e18de5": "数据库70g，原图正面净含量45g",
    "2e60ceac-92c8-4d18-8af2-58f582dbf7a7": "数据库丝滑牛奶巧克力，原图为榛仁巧克力",
    "67c85acb-a9d6-40b1-a3ff-c631d83c0629": "数据库40g，原图宣传图显示1千克装",
    "318e95bf-500f-4179-ae1c-177b95e83769": "数据库750g每日坚果，原图为458g混合全坚果",
    "5dc73b8e-927c-4877-a7a7-6394e8108ca9": "数据库80g，原图正面净含量50g",
}


def fetch_rows(conn: Any) -> List[Dict[str, Any]]:
    ids = list(SERVING_CORRECTIONS) + list(QUARANTINE)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT *
            FROM public.packaged_food_library
            WHERE id = ANY(%s::uuid[])
            ORDER BY id
            """,
            (ids,),
        )
        columns = [desc[0] for desc in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def write_backup(out_dir: Path, rows: List[Dict[str, Any]]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "backup.json").open("w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2, default=str)
    summary = []
    for row in rows:
        summary.append(
            {
                "id": row["id"],
                "display_name": row.get("display_name"),
                "serving_weight_g": row.get("serving_weight_g"),
                "net_weight_g": row.get("net_weight_g"),
                "review_status": row.get("review_status"),
                "action": "correct_serving" if row["id"] in SERVING_CORRECTIONS else "quarantine_source_mismatch",
            }
        )
    with (out_dir / "actions.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(summary[0].keys()) if summary else ["id", "action"])
        writer.writeheader()
        writer.writerows(summary)


def apply(conn: Any) -> Dict[str, int]:
    corrected = 0
    quarantined = 0
    with conn.cursor() as cur:
        for food_id, correction in SERVING_CORRECTIONS.items():
            evidence = json.dumps(
                {
                    "decision": "manual_source_image_review",
                    "reviewed_at": "2026-07-14",
                    "reason": correction["reason"],
                },
                ensure_ascii=False,
            )
            cur.execute(
                """
                UPDATE public.packaged_food_library
                SET serving_weight_g = %s,
                    unit_count = COALESCE(%s, unit_count),
                    unit_content_value = COALESCE(%s, unit_content_value),
                    unit_content_unit = COALESCE(%s, unit_content_unit),
                    spec_text = COALESCE(%s, spec_text),
                    raw_label_payload = COALESCE(raw_label_payload, '{}'::jsonb)
                        || jsonb_build_object('serving_evidence_review', %s::jsonb),
                    updated_at = now()
                WHERE id = %s
                  AND serving_weight_g = %s
                """,
                (
                    correction["serving"],
                    correction.get("unit_count"),
                    correction.get("unit_content_value"),
                    correction.get("unit_content_unit"),
                    correction.get("spec_text"),
                    evidence,
                    food_id,
                    correction["expected_serving"],
                ),
            )
            if cur.rowcount != 1:
                raise RuntimeError(f"serving correction precondition failed for {food_id}")
            corrected += 1

        for food_id, reason in QUARANTINE.items():
            evidence = json.dumps(
                {
                    "decision": "manual_source_image_mismatch",
                    "reviewed_at": "2026-07-14",
                    "reason": reason,
                },
                ensure_ascii=False,
            )
            cur.execute(
                """
                UPDATE public.packaged_food_library
                SET review_status = 'needs_review',
                    raw_label_payload = COALESCE(raw_label_payload, '{}'::jsonb)
                        || jsonb_build_object('source_image_review', %s::jsonb),
                    updated_at = now()
                WHERE id = %s
                  AND COALESCE(NULLIF(review_status, ''), 'active') = 'active'
                """,
                (evidence, food_id),
            )
            if cur.rowcount != 1:
                raise RuntimeError(f"quarantine precondition failed for {food_id}")
            quarantined += 1
    return {"corrected": corrected, "quarantined": quarantined}


def postcheck(conn: Any) -> None:
    with conn.cursor() as cur:
        for food_id, correction in SERVING_CORRECTIONS.items():
            cur.execute("SELECT serving_weight_g FROM public.packaged_food_library WHERE id = %s", (food_id,))
            row = cur.fetchone()
            if not row or abs(float(row[0]) - correction["serving"]) > 0.01:
                raise RuntimeError(f"serving postcheck failed for {food_id}")
        cur.execute(
            "SELECT count(*) FROM public.packaged_food_library WHERE id = ANY(%s::uuid[]) AND review_status = 'needs_review'",
            (list(QUARANTINE),),
        )
        if cur.fetchone()[0] != len(QUARANTINE):
            raise RuntimeError("quarantine postcheck failed")


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply manually reviewed packaged-food evidence corrections.")
    parser.add_argument("--config", default=str(Path(__file__).resolve().parent.parent / "config.yaml"))
    parser.add_argument("--out-dir", default="")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    _load_local_env()
    out_dir = Path(args.out_dir) if args.out_dir else Path("tmp") / f"packaged-evidence-reviewed-{datetime.now():%Y%m%d_%H%M%S}"
    conn = _connect(_read_yaml_config(Path(args.config)))
    try:
        conn.set_session(readonly=not args.apply, autocommit=False)
        rows = fetch_rows(conn)
        if len(rows) != len(SERVING_CORRECTIONS) + len(QUARANTINE):
            raise RuntimeError(f"expected 7 rows, found {len(rows)}")
        write_backup(out_dir, rows)
        print(json.dumps({"rows": len(rows), "apply": args.apply, "out_dir": str(out_dir)}, ensure_ascii=False))
        if not args.apply:
            conn.rollback()
            return 0
        counts = apply(conn)
        postcheck(conn)
        conn.commit()
        print(json.dumps({**counts, "postcheck": "passed"}, ensure_ascii=False))
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
