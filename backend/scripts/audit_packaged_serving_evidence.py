"""Audit serving-weight provenance for every active packaged food.

The script is read-only.  It distinguishes an explicit package serving from a
model/default value by requiring corroboration in the stored label evidence:
nutrition basis, OCR text, package specification, or unit-count fields.

Examples:
    python backend/scripts/audit_packaged_serving_evidence.py
    python backend/scripts/audit_packaged_serving_evidence.py --out-dir tmp/packaged-serving-quality
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from collections import Counter
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Sequence, Tuple

from audit_nutrition_quality_deepseek import _connect, _load_local_env, _read_yaml_config


ACTIVE_PACKAGED_SQL = """
SELECT
    id,
    brand,
    product_name,
    display_name,
    spec_text,
    source_image_urls,
    ocr_raw_text,
    nutrition_basis_unit,
    raw_label_payload,
    field_confidence,
    ingest_method,
    net_content_value,
    net_content_unit,
    unit_count,
    unit_content_value,
    unit_content_unit,
    review_status,
    net_weight_g,
    serving_weight_g,
    kcal_per_100g,
    source,
    source_url,
    created_at,
    updated_at
FROM public.packaged_food_library
WHERE is_active = TRUE
ORDER BY display_name, id
"""


MASS_UNITS = {"g", "克", "gram", "grams"}
VOLUME_UNITS = {"ml", "毫升", "milliliter", "milliliters"}
SERVING_WORDS = (
    "每份",
    "每一份",
    "单份",
    "一份",
    "每包",
    "每袋",
    "每条",
    "每支",
    "每个",
    "每颗",
    "每粒",
    "每枚",
    "serving size",
    "per serving",
)


def _number(value: Any) -> float:
    if isinstance(value, bool) or value is None:
        return 0.0
    if isinstance(value, (int, float, Decimal)):
        return float(value)
    match = re.search(r"[-+]?[0-9]+(?:\.[0-9]+)?", str(value))
    return float(match.group(0)) if match else 0.0


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _unit(value: Any) -> str:
    return _text(value).lower().replace(" ", "")


def _is_weight_unit(value: Any) -> bool:
    unit = _unit(value)
    return unit in MASS_UNITS or unit in VOLUME_UNITS


def _close(left: float, right: float, tolerance: float = 0.05) -> bool:
    if left <= 0 or right <= 0:
        return False
    return abs(left - right) <= max(0.5, max(left, right) * tolerance)


def _container_weight(row: Mapping[str, Any]) -> Tuple[float, str]:
    net_weight = _number(row.get("net_weight_g"))
    if net_weight > 0:
        return net_weight, "net_weight_g"
    net_content = _number(row.get("net_content_value"))
    if net_content > 0 and _is_weight_unit(row.get("net_content_unit")):
        return net_content, "net_content"
    return 0.0, ""


def _walk_dicts(value: Any) -> Iterable[Mapping[str, Any]]:
    if isinstance(value, Mapping):
        yield value
        for nested in value.values():
            yield from _walk_dicts(nested)
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for nested in value:
            yield from _walk_dicts(nested)


def _flatten_strings(value: Any) -> str:
    parts: List[str] = []

    def visit(item: Any) -> None:
        if isinstance(item, Mapping):
            for key, nested in item.items():
                parts.append(str(key))
                visit(nested)
        elif isinstance(item, Sequence) and not isinstance(item, (str, bytes, bytearray)):
            for nested in item:
                visit(nested)
        elif item is not None:
            parts.append(str(item))

    visit(value)
    return " ".join(parts)


def _candidate_token(weight: float) -> str:
    if math.isclose(weight, round(weight), abs_tol=1e-9):
        return str(int(round(weight)))
    return (f"{weight:.4f}").rstrip("0").rstrip(".")


def _text_supports_serving(text: str, serving: float, container: float) -> bool:
    text = _text(text).lower().replace("×", "x").replace("＊", "*")
    if not text or serving <= 0:
        return False
    token = re.escape(_candidate_token(serving))
    unit = r"(?:g|克|ml|毫升)"
    serving_words = "|".join(re.escape(word) for word in SERVING_WORDS)
    contextual = (
        rf"(?:{serving_words}).{{0,40}}?{token}\s*{unit}",
        rf"{token}\s*{unit}.{{0,24}}?(?:{serving_words})",
    )
    if any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in contextual):
        return True

    count_then_weight = re.search(
        rf"([0-9]+(?:\.[0-9]+)?)\s*(?:条|包|袋|支|个|颗|粒|枚|杯|份)?\s*[x*]\s*{token}\s*{unit}",
        text,
        flags=re.IGNORECASE,
    )
    weight_then_count = re.search(
        rf"{token}\s*{unit}\s*[x*]\s*([0-9]+(?:\.[0-9]+)?)",
        text,
        flags=re.IGNORECASE,
    )
    count = _number(count_then_weight.group(1)) if count_then_weight else 0.0
    if weight_then_count:
        count = _number(weight_then_count.group(1))
    return count > 1 and (container <= 0 or _close(count * serving, container, 0.08))


def _payload_supports_serving(payload: Any, serving: float) -> bool:
    for item in _walk_dicts(payload):
        basis_type = _text(item.get("type") or item.get("basis_type") or item.get("basis")).lower()
        if not any(word in basis_type for word in ("每份", "serving", "单份")):
            continue
        value = _number(item.get("value") or item.get("weight") or item.get("serving_weight_g"))
        unit = item.get("unit") or item.get("weight_unit")
        if _close(value, serving) and _is_weight_unit(unit):
            return True
    return False


def classify_row(row: Mapping[str, Any]) -> Dict[str, Any]:
    serving = _number(row.get("serving_weight_g"))
    container, container_source = _container_weight(row)
    evidence: List[str] = []
    issues: List[str] = []

    net_weight = _number(row.get("net_weight_g"))
    net_content = _number(row.get("net_content_value"))
    if net_weight > 0 and net_content > 0 and _is_weight_unit(row.get("net_content_unit")) and not _close(net_weight, net_content):
        issues.append("net_weight_conflicts_with_net_content")

    unit_count = _number(row.get("unit_count"))
    unit_content = _number(row.get("unit_content_value"))
    if unit_count > 0 and unit_content > 0 and _is_weight_unit(row.get("unit_content_unit")):
        if _close(unit_content, serving):
            evidence.append("unit_content")

    spec = _text(row.get("spec_text"))
    ocr = _text(row.get("ocr_raw_text"))
    payload = row.get("raw_label_payload") or {}
    if _text_supports_serving(spec, serving, container):
        evidence.append("spec_text")
    if _text_supports_serving(ocr, serving, container):
        evidence.append("ocr_raw_text")
    if _payload_supports_serving(payload, serving):
        evidence.append("raw_nutrition_basis")
    if _text_supports_serving(_flatten_strings(payload), serving, container):
        evidence.append("raw_label_payload_text")

    basis = _text(row.get("nutrition_basis_unit"))
    if basis and not re.search(r"(?:^|[^0-9])100\s*(?:g|克|ml|毫升)", basis, flags=re.IGNORECASE):
        if _text_supports_serving("每份 " + basis, serving, container):
            evidence.append("nutrition_basis_unit")

    if not row.get("source_image_urls"):
        issues.append("missing_source_image")
    if not ocr and not payload and not row.get("field_confidence") and not row.get("ingest_method"):
        issues.append("missing_provenance")

    evidence = sorted(set(evidence))
    if serving <= 0:
        quality_class = "missing_serving"
    elif container > 0 and serving > container * 1.05:
        quality_class = "serving_over_container"
    elif container > 0 and _close(serving, container):
        quality_class = "supported_whole_container"
        evidence.append(container_source)
    elif evidence:
        quality_class = "supported_explicit_serving"
    else:
        quality_class = "needs_source_review"
        issues.append("smaller_serving_without_evidence")

    default_weight = serving if quality_class in {"supported_whole_container", "supported_explicit_serving"} else container
    kcal_per_100g = _number(row.get("kcal_per_100g"))
    result = dict(row)
    result.update(
        {
            "container_weight_g": container,
            "container_source": container_source,
            "quality_class": quality_class,
            "evidence": evidence,
            "issues": sorted(set(issues)),
            "evidence_backed_default_weight_g": default_weight,
            "evidence_backed_default_kcal": kcal_per_100g * default_weight / 100 if default_weight > 0 else 0,
        }
    )
    return result


def fetch_rows(conn: Any) -> List[Dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(ACTIVE_PACKAGED_SQL)
        columns = [desc[0] for desc in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, Mapping):
        return {str(key): _jsonable(nested) for key, nested in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_jsonable(nested) for nested in value]
    return value


def write_reports(out_dir: Path, rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    class_counts = Counter(row["quality_class"] for row in rows)
    issue_counts = Counter(issue for row in rows for issue in row["issues"])
    review_counts = Counter(_text(row.get("review_status")) or "active" for row in rows)
    summary = {
        "active_rows": len(rows),
        "online_searchable_rows": sum(1 for row in rows if (_text(row.get("review_status")) or "active") == "active"),
        "quality_class_counts": dict(sorted(class_counts.items())),
        "issue_counts": dict(sorted(issue_counts.items())),
        "review_status_counts": dict(sorted(review_counts.items())),
        "generated_at": datetime.now().astimezone().isoformat(),
    }
    with (out_dir / "summary.json").open("w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    with (out_dir / "all_rows.json").open("w", encoding="utf-8") as f:
        json.dump(_jsonable(rows), f, ensure_ascii=False, indent=2, default=str)

    columns = [
        "id",
        "display_name",
        "container_weight_g",
        "serving_weight_g",
        "quality_class",
        "evidence",
        "issues",
        "evidence_backed_default_weight_g",
        "kcal_per_100g",
        "evidence_backed_default_kcal",
        "spec_text",
        "ocr_raw_text",
        "nutrition_basis_unit",
        "unit_count",
        "unit_content_value",
        "unit_content_unit",
        "ingest_method",
        "source",
        "source_url",
        "source_image_urls",
    ]
    with (out_dir / "serving_evidence_audit.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for raw in rows:
            row = _jsonable(raw)
            row["evidence"] = "|".join(raw["evidence"])
            row["issues"] = "|".join(raw["issues"])
            row["source_image_urls"] = "|".join(raw.get("source_image_urls") or [])
            writer.writerow(row)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit packaged-food serving evidence (read-only).")
    parser.add_argument("--config", default=str(Path(__file__).resolve().parent.parent / "config.yaml"))
    parser.add_argument("--out-dir", default="")
    args = parser.parse_args()

    _load_local_env()
    config = _read_yaml_config(Path(args.config))
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(args.out_dir) if args.out_dir else Path("tmp") / f"packaged-serving-quality-{timestamp}"
    conn = _connect(config)
    try:
        conn.set_session(readonly=True, autocommit=False)
        rows = [classify_row(row) for row in fetch_rows(conn)]
        summary = write_reports(out_dir, rows)
        conn.rollback()
    finally:
        conn.close()
    print(json.dumps({**summary, "out_dir": str(out_dir)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
