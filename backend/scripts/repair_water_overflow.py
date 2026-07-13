"""Audit and repair item water values that exceed the item's own weight.

The default mode is read-only.  ``--apply`` requires an exact database token,
writes complete JSON backups, and updates all affected rows in one transaction.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

import psycopg2
from psycopg2.extras import Json
import yaml
from dotenv import load_dotenv


def backend_dir() -> Path:
    return Path(__file__).resolve().parent.parent


def load_config(path: Path) -> Dict[str, Any]:
    load_dotenv(backend_dir() / ".env", override=False)
    load_dotenv(backend_dir() / ".env.local", override=False)
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def cfg(config: Dict[str, Any], keys: Sequence[str], default: Any = "") -> Any:
    value: Any = config
    for key in keys:
        if not isinstance(value, dict):
            return default
        value = value.get(key)
    return default if value is None else value


def database_settings(config: Dict[str, Any]) -> Tuple[str, str]:
    host = str(os.getenv("POSTGRESQL_HOST") or cfg(config, ["database", "host"])).strip()
    port = os.getenv("POSTGRESQL_PORT") or cfg(config, ["database", "port"], 5432)
    name = str(os.getenv("POSTGRESQL_DATABASE") or cfg(config, ["database", "name"])).strip()
    user = os.getenv("POSTGRESQL_USER") or cfg(config, ["database", "user"])
    password = os.getenv("POSTGRESQL_PASSWORD") or cfg(config, ["database", "password"])
    sslmode = os.getenv("POSTGRESQL_SSLMODE") or cfg(config, ["database", "sslmode"], "disable")
    schema = str(os.getenv("POSTGRESQL_SCHEMA") or cfg(config, ["database", "schema"], "public")).strip() or "public"
    dsn = f"host={host} port={port} dbname={name} user={user} password={password} sslmode={sslmode}"
    return dsn, f"{host}/{name}/{schema}"


def number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def first_positive(item: Dict[str, Any], keys: Sequence[str]) -> float:
    for key in keys:
        value = number(item.get(key))
        if value > 0:
            return value
    return 0.0


def cap_items(items: Any, row_id: str, table: str) -> Tuple[bool, List[Dict[str, Any]]]:
    if not isinstance(items, list):
        return False, []
    changed = False
    changes: List[Dict[str, Any]] = []
    for index, raw in enumerate(items):
        if not isinstance(raw, dict):
            continue
        weight = first_positive(raw, ["estimatedWeightGrams", "estimated_weight_g", "weight", "originalWeightGrams", "original_weight_g"])
        if weight <= 0:
            continue
        locations: List[Tuple[Dict[str, Any], str]] = []
        for key in ("waterMl", "water_ml"):
            if key in raw:
                locations.append((raw, key))
        nutrients = raw.get("nutrients")
        if isinstance(nutrients, dict):
            for key in ("waterMl", "water_ml"):
                if key in nutrients:
                    locations.append((nutrients, key))
        for container, key in locations:
            before = number(container.get(key))
            if before <= weight:
                continue
            container[key] = round(weight, 2)
            changed = True
            changes.append({
                "table": table,
                "row_id": row_id,
                "item_index": index,
                "item_name": str(raw.get("name") or ""),
                "field": key,
                "weight_g": weight,
                "before_water_ml": before,
                "after_water_ml": round(weight, 2),
            })
    return changed, changes


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(backend_dir() / "config.yaml"))
    parser.add_argument("--out-dir", default="")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-db", default="")
    args = parser.parse_args()

    config = load_config(Path(args.config))
    dsn, token = database_settings(config)
    if args.apply and args.confirm_db != token:
        raise RuntimeError(f"refusing apply: rerun with --confirm-db {token}")
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(args.out_dir) if args.out_dir else Path("D:/files/downloads") / f"foodlink_water_repair_{stamp}"
    out_dir.mkdir(parents=True, exist_ok=True)

    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    changes: List[Dict[str, Any]] = []
    backups: Dict[str, List[Dict[str, Any]]] = {"analysis_tasks": [], "user_food_records": []}
    updates: Dict[str, List[Tuple[Any, str]]] = {"analysis_tasks": [], "user_food_records": []}
    scanned = {"analysis_tasks": 0, "user_food_records": 0}
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id::text, result FROM public.analysis_tasks WHERE result IS NOT NULL")
            for row_id, result in cur.fetchall():
                scanned["analysis_tasks"] += 1
                if not isinstance(result, dict):
                    continue
                original = json.loads(json.dumps(result, ensure_ascii=False))
                changed, row_changes = cap_items(result.get("items"), row_id, "analysis_tasks")
                if changed:
                    backups["analysis_tasks"].append({"id": row_id, "result": original})
                    updates["analysis_tasks"].append((result, row_id))
                    changes.extend(row_changes)

            cur.execute("SELECT id::text, items FROM public.user_food_records WHERE items IS NOT NULL")
            for row_id, items in cur.fetchall():
                scanned["user_food_records"] += 1
                original = json.loads(json.dumps(items, ensure_ascii=False))
                changed, row_changes = cap_items(items, row_id, "user_food_records")
                if changed:
                    backups["user_food_records"].append({"id": row_id, "items": original})
                    updates["user_food_records"].append((items, row_id))
                    changes.extend(row_changes)

        write_json(out_dir / "changes.json", changes)
        write_json(out_dir / "analysis_tasks_backup.json", backups["analysis_tasks"])
        write_json(out_dir / "user_food_records_backup.json", backups["user_food_records"])

        updated = {"analysis_tasks": 0, "user_food_records": 0}
        if args.apply:
            with conn.cursor() as cur:
                for result, row_id in updates["analysis_tasks"]:
                    cur.execute("UPDATE public.analysis_tasks SET result = %s WHERE id::text = %s", (Json(result), row_id))
                    updated["analysis_tasks"] += cur.rowcount
                for items, row_id in updates["user_food_records"]:
                    cur.execute("UPDATE public.user_food_records SET items = %s WHERE id::text = %s", (Json(items), row_id))
                    updated["user_food_records"] += cur.rowcount
            conn.commit()
        else:
            conn.rollback()

        summary = {
            "generated_at": datetime.now().isoformat(),
            "database": token,
            "apply": args.apply,
            "rows_scanned": scanned,
            "rows_with_overflow": {key: len(value) for key, value in updates.items()},
            "overflow_fields": len(changes),
            "rows_updated": updated,
            "report_dir": str(out_dir),
        }
        write_json(out_dir / "summary.json", summary)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
