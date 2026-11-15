from __future__ import annotations

import argparse
import csv
import math
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import Json, execute_values
from nutrition_import_validation import validate_per100g_values


SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
ROOT_DIR = BACKEND_DIR.parent

DEFAULT_CSV = ROOT_DIR / "tmp" / "snacks_filtered.csv"
DEFAULT_SOURCE = "中国疾控营养成分平台零食筛选导入"


def load_env() -> None:
    load_dotenv(BACKEND_DIR / ".env", override=False)
    load_dotenv(BACKEND_DIR / ".env.local", override=False)


def db_config() -> dict[str, str]:
    return {
        "host": os.getenv("POSTGRESQL_HOST", "154.8.205.78"),
        "port": os.getenv("POSTGRESQL_PORT", "5432"),
        "dbname": os.getenv("POSTGRESQL_DATABASE", "food-link"),
        "user": os.getenv("POSTGRESQL_USER", "app_user"),
        "password": os.environ["POSTGRESQL_PASSWORD"],
        "sslmode": os.getenv("POSTGRESQL_SSLMODE", "disable"),
    }


def connect():
    return psycopg2.connect(**db_config())


def normalize_food_name(raw: str) -> str:
    return "".join(ch for ch in (raw or "").strip().lower() if ch.isalnum())


def parse_number(raw: str) -> float:
    text = (raw or "").strip()
    if text in {"", "—", "–", "-", "Tr", "tr", "un"}:
        return 0.0
    # A numeric substring is not a quantity: 66% must never become 66 grams.
    match = re.fullmatch(r"([+-]?\d+(?:\.\d+)?)\s*(g|mg|μg|µg|ug|kJ|kcal)?", text, re.IGNORECASE)
    if not match:
        raise ValueError(f"无法识别数值或单位：{text}")
    value = float(match.group(1))
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"营养数值必须有限且非负：{text}")
    return value


def parse_quantity(raw: str, unit: str, *, required: bool = False) -> float:
    text = (raw or "").strip()
    if text in {"", "—", "–", "-", "Tr", "tr", "un"}:
        if required:
            raise ValueError(f"缺少必需营养值（{unit}）")
        return 0.0  # Missingness is retained in quality_evidence, not inferred as a measured zero.
    value = parse_number(text)
    found = re.search(r"[a-zμµ]+$", text, re.IGNORECASE)
    actual = found.group().lower().replace("μ", "u").replace("µ", "u") if found else ""
    if not actual and value != 0:
        raise ValueError(f"缺少营养素单位：{text}，不能默认当作{unit}")
    if actual and actual != unit.lower():
        mass = {"g": 1.0, "mg": .001, "ug": .000001}
        if actual not in mass or unit not in mass:
            raise ValueError(f"单位不匹配：{text}，目标为{unit}")
        value *= mass[actual] / mass[unit]
    return value


def kj_to_kcal(raw: str) -> float:
    if (raw or "").strip().lower().endswith("kcal"):
        return parse_quantity(raw, "kcal", required=True)
    value = parse_quantity(raw, "kj", required=True)
    if value <= 0:
        return 0.0
    return round(value / 4.184, 4)


@dataclass
class FoodRow:
    canonical_name: str
    normalized_name: str
    kcal_per_100g: float
    protein_per_100g: float
    carbs_per_100g: float
    fat_per_100g: float
    fiber_per_100g: float
    sugar_per_100g: float
    saturated_fat_per_100g: float
    cholesterol_mg_per_100g: float
    sodium_mg_per_100g: float
    potassium_mg_per_100g: float
    calcium_mg_per_100g: float
    iron_mg_per_100g: float
    magnesium_mg_per_100g: float
    zinc_mg_per_100g: float
    vitamin_a_rae_mcg_per_100g: float
    vitamin_c_mg_per_100g: float
    vitamin_d_mcg_per_100g: float
    vitamin_e_mg_per_100g: float
    vitamin_k_mcg_per_100g: float
    thiamin_mg_per_100g: float
    riboflavin_mg_per_100g: float
    niacin_mg_per_100g: float
    vitamin_b6_mg_per_100g: float
    folate_mcg_per_100g: float
    vitamin_b12_mcg_per_100g: float
    is_active: bool
    source: str
    alias_name: str
    normalized_alias: str
    quality_evidence: dict

    def db_tuple(self) -> tuple:
        return (
            self.canonical_name,
            self.normalized_name,
            self.kcal_per_100g,
            self.protein_per_100g,
            self.carbs_per_100g,
            self.fat_per_100g,
            self.fiber_per_100g,
            self.sugar_per_100g,
            self.saturated_fat_per_100g,
            self.cholesterol_mg_per_100g,
            self.sodium_mg_per_100g,
            self.potassium_mg_per_100g,
            self.calcium_mg_per_100g,
            self.iron_mg_per_100g,
            self.magnesium_mg_per_100g,
            self.zinc_mg_per_100g,
            self.vitamin_a_rae_mcg_per_100g,
            self.vitamin_c_mg_per_100g,
            self.vitamin_d_mcg_per_100g,
            self.vitamin_e_mg_per_100g,
            self.vitamin_k_mcg_per_100g,
            self.thiamin_mg_per_100g,
            self.riboflavin_mg_per_100g,
            self.niacin_mg_per_100g,
            self.vitamin_b6_mg_per_100g,
            self.folate_mcg_per_100g,
            self.vitamin_b12_mcg_per_100g,
            self.is_active,
            self.source,
            "unreviewed",
            Json(self.quality_evidence),
        )


def build_row(raw: dict[str, str], source: str) -> FoodRow | None:
    canonical_name = (raw.get("食物名称") or "").strip()
    normalized_name = normalize_food_name(canonical_name)
    if not canonical_name or not normalized_name:
        return None

    alias_name = (raw.get("别名或俗名") or "").strip()
    normalized_alias = normalize_food_name(alias_name)

    if raw.get("计量基准", "").strip() != "每100克可食部":
        raise ValueError("标准库导入必须明确为每100克可食部；毫升、个、份不可直接当克")
    # Percentages require a separately reviewed denominator and conversion; never guess here.
    if any("%" in raw.get(key, "") or "％" in raw.get(key, "") for key in ("蛋白质", "碳水化合物", "脂肪", "饱和脂肪酸")):
        raise ValueError("营养含量含百分比，必须核实分母并转换为明确质量单位后再导入")

    row = FoodRow(
        canonical_name=canonical_name,
        normalized_name=normalized_name,
        kcal_per_100g=kj_to_kcal(raw.get("能量", "")),
        protein_per_100g=parse_quantity(raw.get("蛋白质", ""), "g", required=True),
        carbs_per_100g=parse_quantity(raw.get("碳水化合物", ""), "g", required=True),
        fat_per_100g=parse_quantity(raw.get("脂肪", ""), "g", required=True),
        fiber_per_100g=parse_quantity(raw.get("总膳食纤维", ""), "g"),
        sugar_per_100g=0.0,
        saturated_fat_per_100g=parse_quantity(raw.get("饱和脂肪酸", ""), "g"),
        cholesterol_mg_per_100g=parse_quantity(raw.get("胆固醇", ""), "mg"),
        sodium_mg_per_100g=parse_quantity(raw.get("钠", ""), "mg"),
        potassium_mg_per_100g=parse_quantity(raw.get("钾", ""), "mg"),
        calcium_mg_per_100g=parse_quantity(raw.get("钙", ""), "mg"),
        iron_mg_per_100g=parse_quantity(raw.get("铁", ""), "mg"),
        magnesium_mg_per_100g=parse_quantity(raw.get("镁", ""), "mg"),
        zinc_mg_per_100g=parse_quantity(raw.get("锌", ""), "mg"),
        vitamin_a_rae_mcg_per_100g=parse_quantity(raw.get("维生素A", ""), "ug"),
        vitamin_c_mg_per_100g=parse_quantity(raw.get("维生素C", ""), "mg"),
        vitamin_d_mcg_per_100g=0.0,
        vitamin_e_mg_per_100g=parse_quantity(raw.get("α-TE", ""), "mg"),
        vitamin_k_mcg_per_100g=0.0,
        thiamin_mg_per_100g=parse_quantity(raw.get("硫胺素", ""), "mg"),
        riboflavin_mg_per_100g=parse_quantity(raw.get("核黄素", ""), "mg"),
        niacin_mg_per_100g=parse_quantity(raw.get("烟酸", ""), "mg"),
        vitamin_b6_mg_per_100g=0.0,
        folate_mcg_per_100g=0.0,
        vitamin_b12_mcg_per_100g=0.0,
        is_active=True,
        source=source,
        alias_name=alias_name,
        normalized_alias=normalized_alias,
        quality_evidence={"source_record_id": raw.get("食物ID"), "basis": "100g_edible", "raw_values": dict(raw), "missing_or_not_detected": [key for key, value in raw.items() if value.strip() in {"", "—", "Tr", "un"}], "import_validation": "units_and_nutrient_bounds_v1"},
    )
    validate_row(row)
    return row


def validate_row(row: FoodRow) -> None:
    validate_per100g_values(vars(row))


def read_rows(csv_path: Path, source: str) -> list[FoodRow]:
    rows_by_normalized: dict[str, FoodRow] = {}
    rejected = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for raw in reader:
            try:
                row = build_row(raw, source)
            except ValueError as error:
                rejected.append(f"{reader.line_num}:{raw.get('食物名称', '')}:{error}")
                continue
            if row is None:
                continue
            rows_by_normalized[row.normalized_name] = row
    if rejected:
        raise ValueError(f"导入已阻止：{len(rejected)}条未通过校验。示例：" + "; ".join(rejected[:5]))
    return list(rows_by_normalized.values())


def chunked(items: list[FoodRow], size: int) -> Iterable[list[FoodRow]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def preview(conn, rows: list[FoodRow]) -> dict[str, int]:
    normalized_names = [row.normalized_name for row in rows]
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT normalized_name, canonical_name, source
            FROM public.food_nutrition_library
            WHERE normalized_name = ANY(%s)
            """,
            (normalized_names,),
        )
        existing = {name: (canonical, source) for name, canonical, source in cur.fetchall()}

    inserts = [row for row in rows if row.normalized_name not in existing]
    updates = [row for row in rows if row.normalized_name in existing]

    print(f"CSV rows: {len(rows)}")
    print(f"Will insert: {len(inserts)}")
    print(f"Will update: {len(updates)}")
    if updates:
        print("Sample updates:")
        for row in updates[:10]:
            canonical, source = existing[row.normalized_name]
            print(f"  ~ {row.canonical_name} <= existing {canonical} ({source})")
    if inserts:
        print("Sample inserts:")
        for row in inserts[:10]:
            print(f"  + {row.canonical_name}")

    return {"insert": len(inserts), "update": len(updates)}


def import_rows(conn, rows: list[FoodRow], batch_size: int) -> tuple[int, int]:
    for row in rows:
        validate_row(row)
    inserted = 0
    updated = 0
    sql = """
        INSERT INTO public.food_nutrition_library (
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
            quality_tier,
            quality_evidence
        ) VALUES %s
        ON CONFLICT (normalized_name) DO UPDATE SET
            canonical_name = EXCLUDED.canonical_name,
            kcal_per_100g = EXCLUDED.kcal_per_100g,
            protein_per_100g = EXCLUDED.protein_per_100g,
            carbs_per_100g = EXCLUDED.carbs_per_100g,
            fat_per_100g = EXCLUDED.fat_per_100g,
            fiber_per_100g = EXCLUDED.fiber_per_100g,
            sugar_per_100g = EXCLUDED.sugar_per_100g,
            saturated_fat_per_100g = EXCLUDED.saturated_fat_per_100g,
            cholesterol_mg_per_100g = EXCLUDED.cholesterol_mg_per_100g,
            sodium_mg_per_100g = EXCLUDED.sodium_mg_per_100g,
            potassium_mg_per_100g = EXCLUDED.potassium_mg_per_100g,
            calcium_mg_per_100g = EXCLUDED.calcium_mg_per_100g,
            iron_mg_per_100g = EXCLUDED.iron_mg_per_100g,
            magnesium_mg_per_100g = EXCLUDED.magnesium_mg_per_100g,
            zinc_mg_per_100g = EXCLUDED.zinc_mg_per_100g,
            vitamin_a_rae_mcg_per_100g = EXCLUDED.vitamin_a_rae_mcg_per_100g,
            vitamin_c_mg_per_100g = EXCLUDED.vitamin_c_mg_per_100g,
            vitamin_d_mcg_per_100g = EXCLUDED.vitamin_d_mcg_per_100g,
            vitamin_e_mg_per_100g = EXCLUDED.vitamin_e_mg_per_100g,
            vitamin_k_mcg_per_100g = EXCLUDED.vitamin_k_mcg_per_100g,
            thiamin_mg_per_100g = EXCLUDED.thiamin_mg_per_100g,
            riboflavin_mg_per_100g = EXCLUDED.riboflavin_mg_per_100g,
            niacin_mg_per_100g = EXCLUDED.niacin_mg_per_100g,
            vitamin_b6_mg_per_100g = EXCLUDED.vitamin_b6_mg_per_100g,
            folate_mcg_per_100g = EXCLUDED.folate_mcg_per_100g,
            vitamin_b12_mcg_per_100g = EXCLUDED.vitamin_b12_mcg_per_100g,
            is_active = EXCLUDED.is_active,
            source = EXCLUDED.source,
            quality_evidence = COALESCE(food_nutrition_library.quality_evidence, '{}'::jsonb) || EXCLUDED.quality_evidence,
            updated_at = now()
        WHERE food_nutrition_library.is_active = TRUE
          AND food_nutrition_library.source = EXCLUDED.source
          AND NOT (COALESCE(food_nutrition_library.quality_evidence, '{}'::jsonb) ? 'data_cleanup')
        RETURNING (xmax = 0) AS inserted
    """

    alias_sql = """
        INSERT INTO public.food_nutrition_aliases (food_id, alias_name, normalized_alias)
        SELECT id, %s, %s
        FROM public.food_nutrition_library
            WHERE normalized_name = %s AND is_active = TRUE
        ON CONFLICT (normalized_alias) DO NOTHING
    """

    with conn.cursor() as cur:
        for batch in chunked(rows, batch_size):
            execute_values(cur, sql, [row.db_tuple() for row in batch], page_size=batch_size)
            for (was_inserted,) in cur.fetchall():
                if was_inserted:
                    inserted += 1
                else:
                    updated += 1

            for row in batch:
                if row.alias_name and row.normalized_alias:
                    cur.execute(alias_sql, (row.alias_name, row.normalized_alias, row.normalized_name))

    return inserted, updated


def main() -> int:
    parser = argparse.ArgumentParser(description="Import tmp/snacks_filtered.csv into food_nutrition_library")
    parser.add_argument("--csv", default=str(DEFAULT_CSV), help="Path to snacks_filtered.csv")
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="Source label written into food_nutrition_library.source")
    parser.add_argument("--batch-size", type=int, default=200, help="Batch size for insert/update")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, do not write")
    args = parser.parse_args()

    load_env()
    csv_path = Path(args.csv)
    if not csv_path.exists():
        raise SystemExit(f"CSV not found: {csv_path}")

    rows = read_rows(csv_path, args.source)
    if not rows:
        raise SystemExit("No valid rows parsed from CSV")

    conn = connect()
    conn.autocommit = False
    try:
        preview(conn, rows)
        if args.dry_run:
            conn.rollback()
            print("Dry run only. Rolled back.")
            return 0

        inserted, updated = import_rows(conn, rows, args.batch_size)
        conn.commit()
        print(f"Imported successfully at {datetime.now(timezone.utc).isoformat()}")
        print(f"Inserted: {inserted}")
        print(f"Updated: {updated}")
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
