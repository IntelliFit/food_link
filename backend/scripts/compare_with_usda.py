"""
Compare sampled food_nutrition_library rows against USDA FoodData Central reference.

Usage:
    # Step 1: Run audit to get sample JSON
    python backend/scripts/audit_nutrition_quality.py --sample-size 30

    # Step 2: Compare against USDA (needs USDA_API_KEY env var)
    python backend/scripts/compare_with_usda.py \
        --audit-json backend/scripts/output/nutrition_audit_YYYYMMDD_HHMMSS.json \
        --out-dir backend/scripts/output

Environment:
    USDA_API_KEY - Get free key from https://fdc.nal.usda.gov/api-key-signup.html
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx


API_BASE_URL = "https://api.nal.usda.gov/fdc/v1"
DEFAULT_RATE_SLEEP = 0.25

# Nutrient ID mappings for USDA
ENERGY_IDS = {1008, 2047, 2048}
PROTEIN_IDS = {1003}
CARBS_IDS = {1005}
FAT_IDS = {1004}
FIBER_IDS = {1079}
SUGAR_IDS = {2000}
SATURATED_FAT_IDS = {1258}
CHOLESTEROL_IDS = {1253}
SODIUM_IDS = {1093}
POTASSIUM_IDS = {1092}
CALCIUM_IDS = {1087}
IRON_IDS = {1089}
MAGNESIUM_IDS = {1090}
ZINC_IDS = {1095}
VITAMIN_A_IDS = {1104, 1106}
VITAMIN_C_IDS = {1162}
VITAMIN_D_IDS = {1110, 1111, 1112, 1113, 1114}
VITAMIN_E_IDS = {1109, 1124}
VITAMIN_K_IDS = {1183, 1184, 1185}
THIAMIN_IDS = {1165}
RIBOFLAVIN_IDS = {1166}
NIACIN_IDS = {1167}
VITAMIN_B6_IDS = {1175}
FOLATE_IDS = {1178, 1190}
VITAMIN_B12_IDS = {1178, 1179, 1181, 1182}  # 1179 is B12

NUTRIENT_KEYS = [
    "calories", "protein", "carbs", "fat", "fiber", "sugar",
    "saturatedFat", "cholesterolMg", "sodiumMg", "potassiumMg",
    "calciumMg", "ironMg", "magnesiumMg", "zincMg",
    "vitaminARaeMcg", "vitaminCMg", "vitaminDMcg",
    "vitaminEMg", "vitaminKMcg", "thiaminMg",
    "riboflavinMg", "niacinMg", "vitaminB6Mg",
    "folateMcg", "vitaminB12Mcg",
]


@dataclass
class ComparisonRow:
    food_id: str
    canonical_name: str
    db_source: Optional[str]
    db_values: Dict[str, float]
    usda_fdc_id: Optional[int]
    usda_description: Optional[str]
    usda_values: Dict[str, float]
    deviations: Dict[str, Optional[float]]
    verdict: str  # "ok", "warning", "critical", "no_match"


def _safe_float(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except Exception:
        return None


def _extract_nutrient_value(nutrient: Dict[str, Any]) -> Optional[float]:
    for key in ("amount", "value"):
        v = _safe_float(nutrient.get(key))
        if v is not None:
            return v
    return None


def _pick_macros(food: Dict[str, Any]) -> Dict[str, Optional[float]]:
    nutrients = food.get("foodNutrients") or []
    if not isinstance(nutrients, list):
        nutrients = []

    energy_candidates: List[Tuple[int, float]] = []
    out: Dict[str, Optional[float]] = {k: None for k in NUTRIENT_KEYS}

    for nutrient in nutrients:
        if not isinstance(nutrient, dict):
            continue
        nutrient_id = nutrient.get("nutrientId")
        if nutrient_id is None and isinstance(nutrient.get("nutrient"), dict):
            nutrient_id = nutrient["nutrient"].get("id")
        try:
            nutrient_id = int(nutrient_id) if nutrient_id is not None else None
        except Exception:
            nutrient_id = None

        name = str(
            nutrient.get("name")
            or nutrient.get("nutrientName")
            or (nutrient.get("nutrient") or {}).get("name")
            or ""
        ).strip().lower()
        value = _extract_nutrient_value(nutrient)
        if value is None:
            continue

        if nutrient_id in ENERGY_IDS or ("energy" == name or "metabolizable energy" in name):
            priority = 0
            if nutrient_id == 2048 or "specific factor" in name:
                priority = 3
            elif nutrient_id == 2047 or "general factor" in name:
                priority = 2
            elif nutrient_id == 1008:
                priority = 1
            energy_candidates.append((priority, value))
            continue

        if nutrient_id in PROTEIN_IDS or name == "protein":
            out["protein"] = value
        elif nutrient_id in CARBS_IDS or "carbohydrate, by difference" in name or "total carbohydrate" in name:
            out["carbs"] = value
        elif nutrient_id in FAT_IDS or "total lipid (fat)" in name or "total fat" in name:
            out["fat"] = value
        elif nutrient_id in FIBER_IDS or "fiber, total dietary" in name:
            out["fiber"] = value
        elif nutrient_id in SUGAR_IDS or "sugars, total including nlea" in name or name == "sugars":
            out["sugar"] = value
        elif nutrient_id in SATURATED_FAT_IDS or "fatty acids, total saturated" in name:
            out["saturatedFat"] = value
        elif nutrient_id in CHOLESTEROL_IDS or name == "cholesterol":
            out["cholesterolMg"] = value
        elif nutrient_id in SODIUM_IDS or name == "sodium, na":
            out["sodiumMg"] = value
        elif nutrient_id in POTASSIUM_IDS or name == "potassium, k":
            out["potassiumMg"] = value
        elif nutrient_id in CALCIUM_IDS or name == "calcium, ca":
            out["calciumMg"] = value
        elif nutrient_id in IRON_IDS or name == "iron, fe":
            out["ironMg"] = value
        elif nutrient_id in MAGNESIUM_IDS or name == "magnesium, mg":
            out["magnesiumMg"] = value
        elif nutrient_id in ZINC_IDS or name == "zinc, zn":
            out["zincMg"] = value
        elif nutrient_id in VITAMIN_A_IDS or "vitamin a, rae" in name:
            out["vitaminARaeMcg"] = value
        elif nutrient_id in VITAMIN_C_IDS or "vitamin c, total ascorbic acid" in name:
            out["vitaminCMg"] = value
        elif nutrient_id in VITAMIN_D_IDS or "vitamin d" in name:
            out["vitaminDMcg"] = value
        elif nutrient_id in VITAMIN_E_IDS or "vitamin e (alpha-tocopherol)" in name:
            out["vitaminEMg"] = value
        elif nutrient_id in VITAMIN_K_IDS or "vitamin k (phylloquinone)" in name:
            out["vitaminKMcg"] = value
        elif nutrient_id in THIAMIN_IDS or name == "thiamin":
            out["thiaminMg"] = value
        elif nutrient_id in RIBOFLAVIN_IDS or name == "riboflavin":
            out["riboflavinMg"] = value
        elif nutrient_id in NIACIN_IDS or name == "niacin":
            out["niacinMg"] = value
        elif nutrient_id in VITAMIN_B6_IDS or "vitamin b-6" in name:
            out["vitaminB6Mg"] = value
        elif nutrient_id in FOLATE_IDS or "folate, total" in name or "folate, dfe" in name:
            out["folateMcg"] = value
        elif nutrient_id in VITAMIN_B12_IDS or "vitamin b-12" in name:
            out["vitaminB12Mcg"] = value

    energy_candidates.sort(key=lambda x: x[0], reverse=True)
    out["calories"] = energy_candidates[0][1] if energy_candidates else None
    return out


def _search_usda(query: str, api_key: str, client: httpx.Client, data_types: Sequence[str] = None) -> List[Dict[str, Any]]:
    payload = {
        "query": query,
        "pageSize": 5,
        "pageNumber": 1,
    }
    if data_types:
        payload["dataType"] = list(data_types)
    try:
        resp = client.post(
            f"{API_BASE_URL}/foods/search",
            params={"api_key": api_key},
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        foods = data.get("foods") or []
        return foods
    except httpx.HTTPStatusError as e:
        print(f"  USDA HTTP error for '{query}': {e.response.status_code}")
        return []
    except Exception as e:
        print(f"  USDA error for '{query}': {e}")
        return []


def _compute_deviation(db_val: Optional[float], ref_val: Optional[float]) -> Optional[float]:
    """Return relative deviation (db - ref) / ref, or None if can't compute."""
    if db_val is None or ref_val is None or ref_val == 0:
        return None
    return round((db_val - ref_val) / ref_val, 4)


def _verdict(deviations: Dict[str, Optional[float]], thresholds: Dict[str, float]) -> str:
    critical_count = 0
    warning_count = 0
    for key, dev in deviations.items():
        if dev is None:
            continue
        abs_dev = abs(dev)
        thresh = thresholds.get(key, 0.30)
        if abs_dev > 0.50:
            critical_count += 1
        elif abs_dev > thresh:
            warning_count += 1
    if critical_count > 0:
        return "critical"
    if warning_count > 0:
        return "warning"
    return "ok"


def _map_db_to_usda_keys(db_row: Dict[str, Any]) -> Dict[str, float]:
    """Map DB column names to our unified keys."""
    mapping = {
        "kcal_per_100g": "calories",
        "protein_per_100g": "protein",
        "carbs_per_100g": "carbs",
        "fat_per_100g": "fat",
        "fiber_per_100g": "fiber",
        "sugar_per_100g": "sugar",
        "saturated_fat_per_100g": "saturatedFat",
        "cholesterol_mg_per_100g": "cholesterolMg",
        "sodium_mg_per_100g": "sodiumMg",
        "potassium_mg_per_100g": "potassiumMg",
        "calcium_mg_per_100g": "calciumMg",
        "iron_mg_per_100g": "ironMg",
        "magnesium_mg_per_100g": "magnesiumMg",
        "zinc_mg_per_100g": "zincMg",
        "vitamin_a_rae_mcg_per_100g": "vitaminARaeMcg",
        "vitamin_c_mg_per_100g": "vitaminCMg",
        "vitamin_d_mcg_per_100g": "vitaminDMcg",
        "vitamin_e_mg_per_100g": "vitaminEMg",
        "vitamin_k_mcg_per_100g": "vitaminKMcg",
        "thiamin_mg_per_100g": "thiaminMg",
        "riboflavin_mg_per_100g": "riboflavinMg",
        "niacin_mg_per_100g": "niacinMg",
        "vitamin_b6_mg_per_100g": "vitaminB6Mg",
        "folate_mcg_per_100g": "folateMcg",
        "vitamin_b12_mcg_per_100g": "vitaminB12Mcg",
    }
    out = {}
    for db_key, unified_key in mapping.items():
        v = _safe_float(db_row.get(db_key))
        if v is not None:
            out[unified_key] = v
    return out


def compare_sample(
    sample: List[Dict[str, Any]],
    api_key: str,
    data_types: Sequence[str] = None,
    rate_sleep: float = DEFAULT_RATE_SLEEP,
) -> List[ComparisonRow]:
    client = httpx.Client(timeout=30.0)
    results: List[ComparisonRow] = []

    # Default thresholds for deviation warnings
    thresholds = {
        "calories": 0.20,
        "protein": 0.25,
        "carbs": 0.25,
        "fat": 0.25,
        "fiber": 0.30,
        "sugar": 0.30,
        "saturatedFat": 0.30,
        "cholesterolMg": 0.30,
        "sodiumMg": 0.30,
        "potassiumMg": 0.30,
        "calciumMg": 0.30,
        "ironMg": 0.30,
        "magnesiumMg": 0.30,
        "zincMg": 0.30,
        "vitaminARaeMcg": 0.35,
        "vitaminCMg": 0.35,
        "vitaminDMcg": 0.35,
        "vitaminEMg": 0.35,
        "vitaminKMcg": 0.35,
        "thiaminMg": 0.35,
        "riboflavinMg": 0.35,
        "niacinMg": 0.35,
        "vitaminB6Mg": 0.35,
        "folateMcg": 0.35,
        "vitaminB12Mcg": 0.35,
    }

    for idx, db_row in enumerate(sample, 1):
        name = db_row.get("canonical_name", "")
        print(f"[{idx}/{len(sample)}] Comparing: {name}")

        db_values = _map_db_to_usda_keys(db_row)
        if not db_values:
            results.append(ComparisonRow(
                food_id=db_row.get("id", ""),
                canonical_name=name,
                db_source=db_row.get("source"),
                db_values={},
                usda_fdc_id=None,
                usda_description=None,
                usda_values={},
                deviations={},
                verdict="no_match",
            ))
            continue

        usda_foods = _search_usda(name, api_key, client, data_types)
        time.sleep(rate_sleep)

        if not usda_foods:
            results.append(ComparisonRow(
                food_id=db_row.get("id", ""),
                canonical_name=name,
                db_source=db_row.get("source"),
                db_values=db_values,
                usda_fdc_id=None,
                usda_description=None,
                usda_values={},
                deviations={},
                verdict="no_match",
            ))
            continue

        # Pick top match
        match = usda_foods[0]
        usda_id = match.get("fdcId")
        usda_desc = match.get("description", "")
        usda_values = _pick_macros(match)

        deviations: Dict[str, Optional[float]] = {}
        for key in NUTRIENT_KEYS:
            db_v = db_values.get(key)
            ref_v = usda_values.get(key)
            deviations[key] = _compute_deviation(db_v, ref_v)

        verdict = _verdict(deviations, thresholds)

        results.append(ComparisonRow(
            food_id=db_row.get("id", ""),
            canonical_name=name,
            db_source=db_row.get("source"),
            db_values=db_values,
            usda_fdc_id=usda_id,
            usda_description=usda_desc,
            usda_values={k: v for k, v in usda_values.items() if v is not None},
            deviations={k: v for k, v in deviations.items() if v is not None},
            verdict=verdict,
        ))

    client.close()
    return results


def save_comparison_report(out_dir: Path, comparisons: List[ComparisonRow], audit_path: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = out_dir / f"usda_comparison_{timestamp}.json"

    report = {
        "generated_at": datetime.now().isoformat(),
        "source_audit": str(audit_path),
        "summary": {
            "total": len(comparisons),
            "ok": sum(1 for c in comparisons if c.verdict == "ok"),
            "warning": sum(1 for c in comparisons if c.verdict == "warning"),
            "critical": sum(1 for c in comparisons if c.verdict == "critical"),
            "no_match": sum(1 for c in comparisons if c.verdict == "no_match"),
        },
        "comparisons": [asdict(c) for c in comparisons],
    }

    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, default=str)

    return report_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare DB sample with USDA reference")
    parser.add_argument("--audit-json", required=True, help="Path to audit JSON from audit_nutrition_quality.py")
    parser.add_argument("--out-dir", type=str, default="backend/scripts/output")
    parser.add_argument("--usda-api-key", default=os.getenv("USDA_API_KEY", ""), help="USDA FoodData Central API key")
    parser.add_argument("--data-type", action="append", default=None, help="USDA data type filter (e.g. Foundation)")
    parser.add_argument("--rate-sleep", type=float, default=DEFAULT_RATE_SLEEP)
    args = parser.parse_args()

    if not args.usda_api_key:
        print("ERROR: USDA_API_KEY not set.")
        print("Get a free key at: https://fdc.nal.usda.gov/api-key-signup.html")
        return 1

    audit_path = Path(args.audit_json)
    if not audit_path.exists():
        print(f"Audit file not found: {audit_path}")
        return 1

    with open(audit_path, "r", encoding="utf-8") as f:
        audit = json.load(f)

    sample = audit.get("random_sample", [])
    if not sample:
        print("No random_sample found in audit JSON.")
        return 1

    print(f"Loaded {len(sample)} sample foods from audit.")
    print(f"USDA API key: {'*' * (len(args.usda_api_key) - 4)}{args.usda_api_key[-4:]}")
    print()

    comparisons = compare_sample(
        sample,
        api_key=args.usda_api_key,
        data_types=args.data_type,
        rate_sleep=args.rate_sleep,
    )

    out_dir = Path(args.out_dir)
    report_path = save_comparison_report(out_dir, comparisons, audit_path)

    print()
    print("=" * 50)
    print("COMPARISON SUMMARY")
    print("=" * 50)
    total = len(comparisons)
    ok = sum(1 for c in comparisons if c.verdict == "ok")
    warning = sum(1 for c in comparisons if c.verdict == "warning")
    critical = sum(1 for c in comparisons if c.verdict == "critical")
    no_match = sum(1 for c in comparisons if c.verdict == "no_match")
    print(f"Total compared: {total}")
    print(f"  OK:       {ok} ({ok/total*100:.1f}%)")
    print(f"  Warning:  {warning} ({warning/total*100:.1f}%)")
    print(f"  Critical: {critical} ({critical/total*100:.1f}%)")
    print(f"  No match: {no_match} ({no_match/total*100:.1f}%)")
    print()
    print(f"Report saved to: {report_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
