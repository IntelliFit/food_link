#!/usr/bin/env python3
"""
Fill missing zero nutrient fields in public.food_nutrition_library.

This is a broader successor to scripts/enrich_vitamins.py:
- selects active foods where any tracked nutrient column is 0 or NULL;
- sends only currently-zero columns to the AI;
- preserves every non-zero database value;
- writes back only AI values greater than 0;
- records successfully processed food ids in a local JSON state file so rows
  whose true value is 0 are not sent to the AI again on the next run.

Configuration matches enrich_vitamins.py:
- database: backend/config.yaml, then DATABASE_URL or SUPABASE_DB_URL
- AI: backend/develop-config.yaml llm_api_url/llm_api_key/llm_model,
  then AI_API_URL/AI_API_KEY/AI_MODEL

Examples:
    python scripts/enrich_missing_nutrients.py --dry-run --limit 20
    python scripts/enrich_missing_nutrients.py --limit 50
    python scripts/enrich_missing_nutrients.py --no-skip-processed --limit 10
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import requests
from dotenv import load_dotenv

psycopg2 = None
RealDictCursor = None
yaml = None


ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT_DIR / "backend"
DEFAULT_STATE_FILE = ROOT_DIR / "scripts" / "enrich_missing_nutrients.state.json"


NUTRIENT_COLUMNS = [
    "kcal_per_100g",
    "protein_per_100g",
    "carbs_per_100g",
    "fat_per_100g",
    "fiber_per_100g",
    "sugar_per_100g",
    "saturated_fat_per_100g",
    "cholesterol_mg_per_100g",
    "sodium_mg_per_100g",
    "potassium_mg_per_100g",
    "calcium_mg_per_100g",
    "iron_mg_per_100g",
    "magnesium_mg_per_100g",
    "zinc_mg_per_100g",
    "vitamin_a_rae_mcg_per_100g",
    "vitamin_c_mg_per_100g",
    "vitamin_d_mcg_per_100g",
    "vitamin_e_mg_per_100g",
    "vitamin_k_mcg_per_100g",
    "thiamin_mg_per_100g",
    "riboflavin_mg_per_100g",
    "niacin_mg_per_100g",
    "vitamin_b6_mg_per_100g",
    "folate_mcg_per_100g",
    "vitamin_b12_mcg_per_100g",
]

COLUMN_LABELS = {
    "kcal_per_100g": "calories, kcal",
    "protein_per_100g": "protein, g",
    "carbs_per_100g": "carbohydrate, g",
    "fat_per_100g": "fat, g",
    "fiber_per_100g": "fiber, g",
    "sugar_per_100g": "sugar, g",
    "saturated_fat_per_100g": "saturated fat, g",
    "cholesterol_mg_per_100g": "cholesterol, mg",
    "sodium_mg_per_100g": "sodium, mg",
    "potassium_mg_per_100g": "potassium, mg",
    "calcium_mg_per_100g": "calcium, mg",
    "iron_mg_per_100g": "iron, mg",
    "magnesium_mg_per_100g": "magnesium, mg",
    "zinc_mg_per_100g": "zinc, mg",
    "vitamin_a_rae_mcg_per_100g": "vitamin A RAE, mcg",
    "vitamin_c_mg_per_100g": "vitamin C, mg",
    "vitamin_d_mcg_per_100g": "vitamin D, mcg",
    "vitamin_e_mg_per_100g": "vitamin E, mg",
    "vitamin_k_mcg_per_100g": "vitamin K, mcg",
    "thiamin_mg_per_100g": "vitamin B1/thiamin, mg",
    "riboflavin_mg_per_100g": "vitamin B2/riboflavin, mg",
    "niacin_mg_per_100g": "niacin, mg",
    "vitamin_b6_mg_per_100g": "vitamin B6, mg",
    "folate_mcg_per_100g": "folate, mcg",
    "vitamin_b12_mcg_per_100g": "vitamin B12, mcg",
}

MAX_VALUES = {
    "kcal_per_100g": 950,
    "protein_per_100g": 100,
    "carbs_per_100g": 100,
    "fat_per_100g": 100,
    "fiber_per_100g": 100,
    "sugar_per_100g": 100,
    "saturated_fat_per_100g": 100,
    "cholesterol_mg_per_100g": 5000,
    "sodium_mg_per_100g": 50000,
    "potassium_mg_per_100g": 15000,
    "calcium_mg_per_100g": 5000,
    "iron_mg_per_100g": 200,
    "magnesium_mg_per_100g": 2000,
    "zinc_mg_per_100g": 200,
    "vitamin_a_rae_mcg_per_100g": 50000,
    "vitamin_c_mg_per_100g": 3000,
    "vitamin_d_mcg_per_100g": 500,
    "vitamin_e_mg_per_100g": 2000,
    "vitamin_k_mcg_per_100g": 10000,
    "thiamin_mg_per_100g": 200,
    "riboflavin_mg_per_100g": 200,
    "niacin_mg_per_100g": 1000,
    "vitamin_b6_mg_per_100g": 200,
    "folate_mcg_per_100g": 10000,
    "vitamin_b12_mcg_per_100g": 5000,
}

SYSTEM_PROMPT = (
    "You are a senior food scientist and registered dietitian. "
    "Estimate nutrition values per 100g edible portion for a food database. "
    "You must preserve all existing non-zero values and only answer fields requested as missing. "
    "If a requested nutrient is truly zero or only trace/negligible for this food, return 0 for that field. "
    "Return pure JSON only, with no markdown and no explanation."
)

USER_PROMPT_TEMPLATE = """Food name: {canonical_name}

Existing non-zero nutrition values per 100g edible portion.
Do not change these values:
{known_nutrients}

The database currently has 0 for the following fields.
Estimate only these missing fields. If a field is genuinely 0 for this food,
return 0 so the script can mark this row as processed and skip it next time:
{missing_fields}

Return a JSON object using exactly these snake_case keys.
Example:
{{"fiber_per_100g": 2.5, "vitamin_c_mg_per_100g": 0}}
"""


def load_yaml(path: Path) -> Optional[Dict[str, Any]]:
    global yaml
    if yaml is None:
        try:
            import yaml as yaml_module

            yaml = yaml_module
        except ImportError:
            raise SystemExit("Please install dependency: pip install pyyaml")
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f)
            return loaded if isinstance(loaded, dict) else None
    except Exception:
        return None


def get_db_url() -> str:
    cfg = load_yaml(BACKEND_DIR / "config.yaml")
    db_cfg = cfg.get("database") if cfg else None
    if db_cfg:
        user = db_cfg.get("user", "")
        password = db_cfg.get("password", "")
        host = db_cfg.get("host", "")
        port = db_cfg.get("port", 5432)
        name = db_cfg.get("name", "")
        sslmode = db_cfg.get("sslmode", "disable")
        return f"postgresql://{user}:{password}@{host}:{port}/{name}?sslmode={sslmode}"

    url = os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit(
            "Database config not found. Provide backend/config.yaml or set DATABASE_URL/SUPABASE_DB_URL."
        )
    return url


def get_ai_config() -> tuple[str, str, str]:
    dev_cfg = load_yaml(BACKEND_DIR / "develop-config.yaml")
    if dev_cfg:
        url = dev_cfg.get("llm_api_url")
        key = dev_cfg.get("llm_api_key")
        model = dev_cfg.get("llm_model")
        if url and key and model:
            return str(url), str(key), str(model)

    url = os.getenv("AI_API_URL")
    key = os.getenv("AI_API_KEY")
    model = os.getenv("AI_MODEL")
    if not url or not key or not model:
        raise SystemExit(
            "AI config not found. Provide backend/develop-config.yaml or set AI_API_URL/AI_API_KEY/AI_MODEL."
        )
    return url, key, model


def load_env_files() -> None:
    for env_path in (BACKEND_DIR / ".env", ROOT_DIR / ".env"):
        if env_path.exists():
            load_dotenv(env_path)
            break


def normalize_api_url(url: str) -> str:
    url = url.rstrip("/")
    if not url.endswith("/chat/completions"):
        return f"{url}/v1/chat/completions"
    return url


def numeric_value(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def missing_columns(row: Dict[str, Any]) -> List[str]:
    return [column for column in NUTRIENT_COLUMNS if numeric_value(row.get(column)) == 0]


def known_columns(row: Dict[str, Any]) -> List[str]:
    return [column for column in NUTRIENT_COLUMNS if numeric_value(row.get(column)) != 0]


def build_user_prompt(row: Dict[str, Any], missing: Sequence[str]) -> str:
    known_lines = []
    for column in known_columns(row):
        known_lines.append(f"- {column} ({COLUMN_LABELS[column]}): {row.get(column)}")
    if not known_lines:
        known_lines.append("- none")

    missing_lines = [f"- {column} ({COLUMN_LABELS[column]})" for column in missing]
    return USER_PROMPT_TEMPLATE.format(
        canonical_name=row["canonical_name"],
        known_nutrients="\n".join(known_lines),
        missing_fields="\n".join(missing_lines),
    )


def call_ai(
    api_url: str,
    api_key: str,
    model: str,
    user_prompt: str,
    timeout: int,
) -> Dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
    }
    resp = requests.post(normalize_api_url(api_url), headers=headers, json=payload, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    content = data["choices"][0]["message"]["content"].strip()
    if content.startswith("```"):
        content = content.strip("`").strip()
        if content.lower().startswith("json"):
            content = content[4:].strip()
    parsed = json.loads(content)
    if not isinstance(parsed, dict):
        raise ValueError("AI response is not a JSON object")
    return parsed


def call_ai_with_retry(
    api_url: str,
    api_key: str,
    model: str,
    user_prompt: str,
    timeout: int,
    max_retries: int,
) -> Dict[str, Any]:
    for attempt in range(max_retries + 1):
        try:
            return call_ai(api_url, api_key, model, user_prompt, timeout)
        except Exception:
            if attempt == max_retries:
                raise
            wait_seconds = 2 ** attempt
            time.sleep(wait_seconds)
    raise RuntimeError("unreachable retry state")


def parse_missing_values(raw: Dict[str, Any], requested_columns: Sequence[str]) -> Dict[str, float]:
    values: Dict[str, float] = {}
    requested = set(requested_columns)
    for column in requested_columns:
        if column not in raw:
            continue
        try:
            value = float(raw[column])
        except (TypeError, ValueError):
            continue
        if not math.isfinite(value) or value < 0:
            continue
        max_value = MAX_VALUES.get(column)
        if max_value is not None and value > max_value:
            continue
        values[column] = value

    unexpected = sorted(set(raw.keys()) - requested)
    if unexpected:
        print(f"  ignored unexpected AI fields: {', '.join(unexpected[:8])}")
    return values


def load_state(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {"version": 1, "processed": {}}
    try:
        with path.open("r", encoding="utf-8") as f:
            state = json.load(f)
    except Exception:
        raise SystemExit(f"Failed to read state file: {path}")
    if not isinstance(state, dict):
        raise SystemExit(f"Invalid state file: {path}")
    processed = state.get("processed")
    if not isinstance(processed, dict):
        state["processed"] = {}
    state.setdefault("version", 1)
    return state


def save_state(path: Path, state: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    tmp.replace(path)


def fetch_targets(conn) -> List[Dict[str, Any]]:
    if RealDictCursor is None:
        raise RuntimeError("psycopg2 is not initialized")
    zero_checks = " OR ".join(f"COALESCE({column}, 0) = 0" for column in NUTRIENT_COLUMNS)
    sql = f"""
        SELECT id, canonical_name, source, {', '.join(NUTRIENT_COLUMNS)}
        FROM public.food_nutrition_library
        WHERE is_active = true
          AND ({zero_checks})
        ORDER BY canonical_name
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql)
        return [dict(row) for row in cur.fetchall()]


def update_missing_fields(conn, food_id: str, values: Dict[str, float]) -> List[str]:
    positive_values = {column: value for column, value in values.items() if value > 0}
    if not positive_values:
        return []

    assignments = []
    params: List[Any] = []
    for column, value in positive_values.items():
        assignments.append(f"{column} = CASE WHEN COALESCE({column}, 0) = 0 THEN %s ELSE {column} END")
        params.append(value)
    assignments.append("updated_at = now()")
    params.append(food_id)

    sql = f"""
        UPDATE public.food_nutrition_library
        SET {', '.join(assignments)}
        WHERE id = %s
    """
    with conn.cursor() as cur:
        cur.execute(sql, params)
    return list(positive_values.keys())


def process_one(
    row: Dict[str, Any],
    api_url: str,
    api_key: str,
    model: str,
    timeout: int,
    max_retries: int,
) -> Dict[str, Any]:
    food_id = str(row["id"])
    name = row["canonical_name"]
    missing = missing_columns(row)
    try:
        raw = call_ai_with_retry(
            api_url,
            api_key,
            model,
            build_user_prompt(row, missing),
            timeout,
            max_retries,
        )
        parsed = parse_missing_values(raw, missing)
        positive = {column: value for column, value in parsed.items() if value > 0}
        confirmed_zero = [column for column, value in parsed.items() if value == 0]
        unresolved = sorted(set(missing) - set(parsed.keys()))
        return {
            "food_id": food_id,
            "name": name,
            "status": "ok",
            "missing_columns": missing,
            "values": parsed,
            "positive_values": positive,
            "confirmed_zero_columns": confirmed_zero,
            "unresolved_columns": unresolved,
        }
    except Exception as exc:
        return {
            "food_id": food_id,
            "name": name,
            "status": "error",
            "missing_columns": missing,
            "error": str(exc),
        }


def mark_processed(
    state: Dict[str, Any],
    item: Dict[str, Any],
    updated_columns: Sequence[str],
    model: str,
) -> None:
    processed = state.setdefault("processed", {})
    processed[item["food_id"]] = {
        "name": item["name"],
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "model": model,
        "missing_columns": item.get("missing_columns", []),
        "updated_columns": list(updated_columns),
        "confirmed_zero_columns": item.get("confirmed_zero_columns", []),
        "unresolved_columns": item.get("unresolved_columns", []),
    }


def apply_limit(rows: List[Dict[str, Any]], limit: Optional[int]) -> List[Dict[str, Any]]:
    if limit is None:
        return rows
    if limit <= 0:
        return []
    return rows[:limit]


def main() -> int:
    parser = argparse.ArgumentParser(description="Fill zero nutrient fields in food_nutrition_library")
    parser.add_argument("--dry-run", action="store_true", help="Call AI and print results without writing DB/state")
    parser.add_argument("--limit", type=int, default=None, help="Maximum rows to process after state-file filtering")
    parser.add_argument("--batch", type=int, default=10, help="Rows to commit before each transaction commit")
    parser.add_argument("--state-file", type=Path, default=DEFAULT_STATE_FILE, help="Processed id state JSON path")
    parser.add_argument(
        "--no-skip-processed",
        action="store_true",
        help="Ignore the state file and process rows that were previously marked done",
    )
    args = parser.parse_args()

    global psycopg2, RealDictCursor
    if psycopg2 is None or RealDictCursor is None:
        try:
            import psycopg2 as psycopg2_module
            from psycopg2.extras import RealDictCursor as real_dict_cursor_class

            psycopg2 = psycopg2_module
            RealDictCursor = real_dict_cursor_class
        except ImportError:
            raise SystemExit("Please install dependency: pip install psycopg2-binary")

    load_env_files()
    db_url = get_db_url()
    api_url, api_key, model = get_ai_config()
    max_concurrent = int(os.getenv("AI_MAX_CONCURRENT", "5"))
    timeout = int(os.getenv("AI_TIMEOUT", "60"))
    max_retries = int(os.getenv("AI_MAX_RETRIES", "2"))

    state = load_state(args.state_file)
    processed_ids = set(state.get("processed", {}).keys())
    skip_processed = not args.no_skip_processed

    print(f"AI config: {api_url} | model={model} | concurrent={max_concurrent} | timeout={timeout}s")
    print(f"mode={'DRY-RUN' if args.dry_run else 'WRITE'} | skip_processed={skip_processed}")
    print(f"state_file={args.state_file}")

    conn = psycopg2.connect(db_url)
    conn.autocommit = False

    try:
        rows = fetch_targets(conn)
        before_skip = len(rows)
        if skip_processed:
            rows = [row for row in rows if str(row["id"]) not in processed_ids]
        skipped_by_state = before_skip - len(rows)
        rows = apply_limit(rows, args.limit)

        print(
            f"targets_with_any_zero={before_skip} skipped_by_state={skipped_by_state} selected={len(rows)}"
        )
        if not rows:
            return 0
        if args.dry_run:
            print("DRY-RUN: AI will be called, but DB and state file will not be changed.")

        success = 0
        failed = 0
        updated_rows = 0
        updated_fields = 0
        processed_since_commit = 0

        with ThreadPoolExecutor(max_workers=max_concurrent) as executor:
            futures = {
                executor.submit(
                    process_one,
                    row,
                    api_url,
                    api_key,
                    model,
                    timeout,
                    max_retries,
                ): row
                for row in rows
            }

            for future in as_completed(futures):
                result = future.result()
                name = result["name"]
                if result["status"] != "ok":
                    failed += 1
                    print(f"ERROR {name}: {result.get('error', 'unknown')}")
                    continue

                values = result.get("values", {})
                positive = result.get("positive_values", {})
                confirmed_zero = result.get("confirmed_zero_columns", [])
                unresolved = result.get("unresolved_columns", [])

                success += 1
                if args.dry_run:
                    print(f"\nDRY-RUN {name}")
                    for column in result.get("missing_columns", []):
                        if column in values:
                            print(f"  {column} = {values[column]}")
                        else:
                            print(f"  {column} = <not returned>")
                    continue

                updated_columns = update_missing_fields(conn, result["food_id"], positive)
                if not unresolved:
                    mark_processed(state, result, updated_columns, model)
                processed_since_commit += 1
                if updated_columns:
                    updated_rows += 1
                    updated_fields += len(updated_columns)

                print(
                    f"OK {name}: updated={len(updated_columns)} true_zero={len(confirmed_zero)} "
                    f"unresolved={len(unresolved)}"
                )

                if processed_since_commit >= args.batch:
                    conn.commit()
                    save_state(args.state_file, state)
                    processed_since_commit = 0

            if not args.dry_run:
                conn.commit()
                save_state(args.state_file, state)

        print(
            f"done total={len(rows)} success={success} failed={failed} "
            f"updated_rows={updated_rows} updated_fields={updated_fields}"
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
