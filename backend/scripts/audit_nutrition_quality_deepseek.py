"""
Whole-library nutrition quality audit with optional DeepSeek review.

Default mode is read-only. It scans all active food_nutrition_library rows,
exports rule-based suspicious rows, then optionally asks DeepSeek to review
the highest-risk candidates.

Usage:
    python backend/scripts/audit_nutrition_quality_deepseek.py --llm --limit 200

DeepSeek environment variables:
    DEEPSEEK_API_KEY   required when --llm is used
    DEEPSEEK_BASE_URL  optional, default https://api.deepseek.com
    DEEPSEEK_MODEL     optional, default deepseek-chat
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import httpx
import psycopg2
import yaml
from dotenv import load_dotenv


MACRO_COLUMNS = [
    "kcal_per_100g",
    "protein_per_100g",
    "carbs_per_100g",
    "fat_per_100g",
    "fiber_per_100g",
    "sugar_per_100g",
]

LOW_TRUST_SOURCE_PATTERNS = [
    "ai",
    "deepseek",
    "估算",
    "历史识别",
    "用户",
    "manual",
]

ZERO_REASONABLE_KEYWORDS = [
    "水",
    "矿泉水",
    "纯净水",
    "苏打水",
    "气泡水",
    "茶",
    "绿茶",
    "红茶",
    "乌龙茶",
    "黑咖啡",
    "美式咖啡",
    "无糖",
    "零卡",
    "zero",
    "water",
    "coffee",
    "tea",
]

SAUCE_OR_STAPLE_KEYWORDS = [
    "酱",
    "红烧",
    "糖醋",
    "蜜汁",
    "咖喱",
    "烧汁",
    "卤",
    "面",
    "饭",
    "粉",
    "粥",
    "饼",
    "包",
    "糕",
    "薯",
    "土豆",
    "芋",
    "玉米",
]

MEAT_KEYWORDS = [
    "牛肉",
    "猪肉",
    "鸡肉",
    "羊肉",
    "鸭肉",
    "鱼",
    "虾",
    "肉",
    "火腿",
    "培根",
    "牛排",
]

DRY_OR_CONCENTRATED_KEYWORDS = [
    "干",
    "肉干",
    "牛肉干",
    "猪肉脯",
    "蛋白粉",
    "粉",
    "奶酪",
    "芝士",
    "坚果",
    "籽",
    "花生",
    "瓜子",
    "dry",
    "dried",
    "dehydrated",
    "powder",
    "flour",
    "meal",
    "bran",
    "seed",
    "seeds",
    "nuts",
    "nut",
    "raw",
    "roasted",
    "defatted",
    "cocoa",
    "yeast",
    "soybean",
    "soybeans",
]

OIL_OR_FAT_KEYWORDS = [
    "油",
    "黄油",
    "猪油",
    "牛油",
    "奶油",
    "酥油",
    "肥肉",
    "五花肉",
    "坚果",
    "花生",
    "瓜子",
    "芝麻",
    "oil",
    "butter",
    "nuts",
    "nut",
    "seeds",
    "seed",
    "almond",
    "macadamia",
    "pecan",
    "coconut",
    "flaxseed",
    "sesame",
    "peanut",
]

ALCOHOL_KEYWORDS = ["酒", "啤酒", "葡萄酒", "白酒", "威士忌", "vodka", "wine", "beer"]
FIBER_SPECIAL_KEYWORDS = ["膳食纤维", "纤维粉", "魔芋", "可可粉", "菊粉", "代糖", "赤藓糖醇"]


@dataclass
class FoodRow:
    id: str
    canonical_name: str
    normalized_name: str
    kcal_per_100g: float
    protein_per_100g: float
    carbs_per_100g: float
    fat_per_100g: float
    fiber_per_100g: float
    sugar_per_100g: float
    source: str
    created_at: Any
    updated_at: Any


@dataclass
class AuditFinding:
    id: str
    canonical_name: str
    normalized_name: str
    kcal_per_100g: float
    protein_per_100g: float
    carbs_per_100g: float
    fat_per_100g: float
    fiber_per_100g: float
    sugar_per_100g: float
    source: str
    severity: int
    macro_energy_kcal: float
    kcal_energy_ratio: Optional[float]
    macro_sum_g: float
    flags: List[str]


def _backend_dir() -> Path:
    return Path(__file__).resolve().parent.parent


def _load_local_env() -> None:
    backend = _backend_dir()
    load_dotenv(backend / ".env", override=False)
    load_dotenv(backend / ".env.local", override=False)


def _read_yaml_config(config_path: Path) -> Dict[str, Any]:
    if not config_path.exists():
        return {}
    with config_path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _config_value(config: Dict[str, Any], path: Sequence[str], default: Any = "") -> Any:
    cur: Any = config
    for key in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
    return default if cur is None else cur


def _postgres_dsn(config: Dict[str, Any]) -> str:
    host = os.getenv("POSTGRESQL_HOST") or _config_value(config, ["database", "host"])
    port = os.getenv("POSTGRESQL_PORT") or str(_config_value(config, ["database", "port"], 5432))
    db = os.getenv("POSTGRESQL_DATABASE") or _config_value(config, ["database", "name"])
    user = os.getenv("POSTGRESQL_USER") or _config_value(config, ["database", "user"])
    password = os.getenv("POSTGRESQL_PASSWORD") or _config_value(config, ["database", "password"])
    sslmode = os.getenv("POSTGRESQL_SSLMODE") or _config_value(config, ["database", "sslmode"], "disable")
    if not all([host, port, db, user]):
        raise RuntimeError("missing PostgreSQL connection settings")
    return f"host={host} port={port} dbname={db} user={user} password={password} sslmode={sslmode}"


def _deepseek_settings(config: Dict[str, Any]) -> Dict[str, str]:
    # Intentionally require the key from the caller's environment. Do not fall
    # back to config.yaml, so local/private audit keys do not need to be shared.
    api_key = os.getenv("DEEPSEEK_API_KEY")
    base_url = os.getenv("DEEPSEEK_BASE_URL") or _config_value(
        config, ["external", "deepseek_base_url"], "https://api.deepseek.com"
    )
    model = os.getenv("DEEPSEEK_MODEL") or _config_value(
        config, ["external", "deepseek_model"], "deepseek-chat"
    )
    return {"api_key": str(api_key or ""), "base_url": str(base_url).rstrip("/"), "model": str(model)}


def _connect(config: Dict[str, Any]) -> Any:
    return psycopg2.connect(_postgres_dsn(config))


def _f(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except Exception:
        return 0.0


def _contains(name: str, keywords: Iterable[str]) -> bool:
    lower = name.lower()
    return any(k.lower() in lower for k in keywords)


def _low_trust_source(source: str) -> bool:
    return _contains(source or "", LOW_TRUST_SOURCE_PATTERNS)


def _macro_energy(row: FoodRow) -> float:
    return row.protein_per_100g * 4 + row.carbs_per_100g * 4 + row.fat_per_100g * 9


def _macro_sum(row: FoodRow) -> float:
    # In most food labels total carbohydrate already includes dietary fiber.
    # Adding fiber again would double-count USDA-style rows.
    return row.protein_per_100g + row.carbs_per_100g + row.fat_per_100g


def fetch_food_rows(conn: Any) -> List[FoodRow]:
    query = """
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
            COALESCE(source, '') AS source,
            created_at,
            updated_at
        FROM public.food_nutrition_library
        WHERE is_active = true
        ORDER BY canonical_name
    """
    with conn.cursor() as cur:
        cur.execute(query)
        rows = []
        for r in cur.fetchall():
            rows.append(
                FoodRow(
                    id=str(r[0]),
                    canonical_name=str(r[1] or ""),
                    normalized_name=str(r[2] or ""),
                    kcal_per_100g=_f(r[3]),
                    protein_per_100g=_f(r[4]),
                    carbs_per_100g=_f(r[5]),
                    fat_per_100g=_f(r[6]),
                    fiber_per_100g=_f(r[7]),
                    sugar_per_100g=_f(r[8]),
                    source=str(r[9] or ""),
                    created_at=r[10],
                    updated_at=r[11],
                )
            )
    return rows


def audit_row(row: FoodRow) -> Optional[AuditFinding]:
    flags: List[str] = []
    severity = 0
    name = row.canonical_name
    macro_energy = _macro_energy(row)
    macro_sum = _macro_sum(row)
    ratio: Optional[float] = None
    low_trust = _low_trust_source(row.source)

    values = [
        row.kcal_per_100g,
        row.protein_per_100g,
        row.carbs_per_100g,
        row.fat_per_100g,
        row.fiber_per_100g,
        row.sugar_per_100g,
    ]

    if any(v < -0.01 for v in values):
        flags.append("negative_macro_value")
        severity += 5

    if row.kcal_per_100g > 950 or any(v > 100.5 for v in values[1:]):
        flags.append("physically_impossible_per_100g")
        severity += 5

    if row.kcal_per_100g == 0 and sum(values[1:4]) == 0:
        if not _contains(name, ZERO_REASONABLE_KEYWORDS):
            flags.append("all_zero_not_whitelisted")
            severity += 4

    if macro_sum > 105:
        flags.append("macro_sum_over_105g")
        severity += 5
    elif macro_sum > 100:
        flags.append("macro_sum_over_100g")
        severity += 3

    if macro_energy > 0 and row.kcal_per_100g > 0:
        ratio = row.kcal_per_100g / macro_energy
        if not _contains(name, ALCOHOL_KEYWORDS + FIBER_SPECIAL_KEYWORDS):
            if ratio < 0.55:
                flags.append("kcal_much_lower_than_macro_energy")
                severity += 4
            elif ratio < 0.72:
                flags.append("kcal_lower_than_macro_energy")
                severity += 2
            if ratio > 1.85:
                flags.append("kcal_much_higher_than_macro_energy")
                severity += 4
            elif ratio > 1.45:
                flags.append("kcal_higher_than_macro_energy")
                severity += 2

    if row.carbs_per_100g == 0 and _contains(name, SAUCE_OR_STAPLE_KEYWORDS):
        if not _contains(name, ZERO_REASONABLE_KEYWORDS):
            flags.append("zero_carbs_for_sauced_or_staple_food")
            severity += 3

    if row.protein_per_100g > 35 and not _contains(name, DRY_OR_CONCENTRATED_KEYWORDS):
        flags.append("very_high_protein_without_dry_hint")
        severity += 4
    elif row.protein_per_100g > 30 and _contains(name, MEAT_KEYWORDS) and low_trust:
        flags.append("high_protein_meat_low_trust_review")
        severity += 2

    if row.fat_per_100g > 70 and not _contains(name, OIL_OR_FAT_KEYWORDS):
        flags.append("very_high_fat_without_oil_hint")
        severity += 4
    elif row.fat_per_100g > 45 and not _contains(name, OIL_OR_FAT_KEYWORDS):
        flags.append("high_fat_review")
        severity += 2

    if row.carbs_per_100g > 90 and not _contains(name, ["糖", "蜂蜜", "糖浆", "粉", "淀粉", "米", "面", "干"]):
        flags.append("very_high_carbs_without_sugar_or_dry_hint")
        severity += 3

    if row.sugar_per_100g > row.carbs_per_100g + 0.5 and row.carbs_per_100g > 0:
        flags.append("sugar_greater_than_carbs")
        severity += 3

    if flags and low_trust:
        severity += 1
        flags.append("low_trust_source")

    if not flags:
        return None

    return AuditFinding(
        id=row.id,
        canonical_name=row.canonical_name,
        normalized_name=row.normalized_name,
        kcal_per_100g=round(row.kcal_per_100g, 4),
        protein_per_100g=round(row.protein_per_100g, 4),
        carbs_per_100g=round(row.carbs_per_100g, 4),
        fat_per_100g=round(row.fat_per_100g, 4),
        fiber_per_100g=round(row.fiber_per_100g, 4),
        sugar_per_100g=round(row.sugar_per_100g, 4),
        source=row.source,
        severity=severity,
        macro_energy_kcal=round(macro_energy, 4),
        kcal_energy_ratio=round(ratio, 4) if ratio is not None and math.isfinite(ratio) else None,
        macro_sum_g=round(macro_sum, 4),
        flags=flags,
    )


def _csv_value(value: Any) -> Any:
    if isinstance(value, list):
        return "|".join(value)
    return value


def write_findings_csv(path: Path, findings: Sequence[AuditFinding]) -> None:
    fieldnames = list(asdict(findings[0]).keys()) if findings else [
        "id",
        "canonical_name",
        "severity",
        "flags",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for finding in findings:
            writer.writerow({k: _csv_value(v) for k, v in asdict(finding).items()})


def _llm_prompt(batch: Sequence[AuditFinding]) -> str:
    items = []
    for finding in batch:
        items.append(
            {
                "id": finding.id,
                "name": finding.canonical_name,
                "per_100g": {
                    "kcal": finding.kcal_per_100g,
                    "protein": finding.protein_per_100g,
                    "carbs": finding.carbs_per_100g,
                    "fat": finding.fat_per_100g,
                    "fiber": finding.fiber_per_100g,
                    "sugar": finding.sugar_per_100g,
                },
                "source": finding.source,
                "rule_flags": finding.flags,
            }
        )
    return (
        "你是食品营养数据库质检员。请审核下面每个食物的每100g营养是否明显错误。"
        "要求：保守判断，不要把可能合理的烹调差异当成错误；熟肉、脱水、腌制、酱卤肉蛋白质可能偏高，"
        "只有在明显违背每100g物理约束、宏量与热量严重不一致、或名称与营养显著不符时才建议修正。"
        "每个 reason 不超过 30 个汉字，risk_tags 每项不超过 20 个英文字符。"
        "返回严格 JSON，不要 markdown。格式："
        '{"items":[{"id":"...","decision":"keep|fix|deactivate|review","confidence":0.0,'
        '"suggested":{"kcal":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0},'
        '"reason":"简短中文原因","risk_tags":["..."]}]}。'
        "decision 含义：keep=现值可接受；review=需要人工复核但不建议自动改；"
        "fix=高置信建议替换为 suggested；deactivate=明显非食物或脏词条。"
        f"\n待审核数据：{json.dumps(items, ensure_ascii=False)}"
    )


def _extract_json_object(text: str) -> Dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).strip()
        text = re.sub(r"```$", "", text).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.S)
        if not match:
            raise
        return json.loads(match.group(0))


def review_with_deepseek(
    findings: Sequence[AuditFinding],
    settings: Dict[str, str],
    batch_size: int,
    sleep_seconds: float,
    out_dir: Path,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    if not settings["api_key"]:
        raise RuntimeError(
            "DEEPSEEK_API_KEY is missing. Set it in your current shell before using --llm."
        )

    url = f"{settings['base_url']}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings['api_key']}",
        "Content-Type": "application/json",
    }
    results: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    raw_dir = out_dir / "deepseek_raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    def fallback_review(batch: Sequence[AuditFinding], reason: str, raw_path: str = "") -> List[Dict[str, Any]]:
        out = []
        for finding in batch:
            item = {
                "id": finding.id,
                "decision": "review",
                "confidence": 0,
                "suggested": {
                    "kcal": finding.kcal_per_100g,
                    "protein": finding.protein_per_100g,
                    "carbs": finding.carbs_per_100g,
                    "fat": finding.fat_per_100g,
                    "fiber": finding.fiber_per_100g,
                    "sugar": finding.sugar_per_100g,
                },
                "reason": reason,
                "risk_tags": ["llm_failed"],
            }
            out.append(item)
            errors.append(
                {
                    "id": finding.id,
                    "canonical_name": finding.canonical_name,
                    "reason": reason,
                    "raw_path": raw_path,
                }
            )
        return out

    def save_raw(label: str, batch: Sequence[AuditFinding], content: str, error: str) -> str:
        safe_label = re.sub(r"[^A-Za-z0-9_.-]+", "_", label)
        path = raw_dir / f"{safe_label}.json"
        write_json(
            path,
            {
                "error": error,
                "batch": [
                    {
                        "id": finding.id,
                        "canonical_name": finding.canonical_name,
                        "severity": finding.severity,
                        "flags": finding.flags,
                    }
                    for finding in batch
                ],
                "content": content,
            },
        )
        return str(path)

    def call_batch(client: httpx.Client, batch: Sequence[AuditFinding], label: str) -> List[Dict[str, Any]]:
        payload = {
            "model": settings["model"],
            "messages": [
                {
                    "role": "system",
                    "content": "你只输出可以被 json.loads 解析的 JSON 对象，不能省略、截断或添加注释。",
                },
                {"role": "user", "content": _llm_prompt(batch)},
            ],
            "temperature": 0,
            "max_tokens": 8192,
            "response_format": {"type": "json_object"},
        }
        content = ""
        try:
            response = client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            parsed = _extract_json_object(content)
            items = parsed.get("items") or []
            if not isinstance(items, list):
                raise RuntimeError("DeepSeek response missing items list")
            return items
        except (json.JSONDecodeError, RuntimeError) as exc:
            raw_path = save_raw(label, batch, content, str(exc))
            if len(batch) == 1:
                print(f"  invalid JSON for single row, marked review: {batch[0].canonical_name}")
                return fallback_review(batch, "DeepSeek返回非法JSON，需人工复核", raw_path)
            mid = max(1, len(batch) // 2)
            print(f"  invalid JSON, split {len(batch)} rows -> {mid}+{len(batch)-mid}")
            return call_batch(client, batch[:mid], f"{label}_a") + call_batch(
                client, batch[mid:], f"{label}_b"
            )
        except httpx.HTTPError as exc:
            raw_path = save_raw(label, batch, content, str(exc))
            if len(batch) > 1:
                mid = max(1, len(batch) // 2)
                print(f"  HTTP error, split {len(batch)} rows -> {mid}+{len(batch)-mid}: {exc}")
                return call_batch(client, batch[:mid], f"{label}_a") + call_batch(
                    client, batch[mid:], f"{label}_b"
                )
            print(f"  HTTP error for single row, marked review: {exc}")
            return fallback_review(batch, "DeepSeek请求失败，需人工复核", raw_path)

    with httpx.Client(timeout=90.0) as client:
        batches = [findings[i : i + batch_size] for i in range(0, len(findings), batch_size)]
        for idx, batch in enumerate(batches, 1):
            print(f"DeepSeek review batch {idx}/{len(batches)} ({len(batch)} rows)...")
            results.extend(call_batch(client, batch, f"batch_{idx:03d}"))
            if sleep_seconds > 0 and idx < len(batches):
                time.sleep(sleep_seconds)
    return results, errors


def write_json(path: Path, data: Any) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)


def write_llm_csv(path: Path, rows: Sequence[Dict[str, Any]], finding_by_id: Dict[str, AuditFinding]) -> None:
    fieldnames = [
        "id",
        "canonical_name",
        "decision",
        "confidence",
        "reason",
        "risk_tags",
        "current_kcal",
        "current_protein",
        "current_carbs",
        "current_fat",
        "suggested_kcal",
        "suggested_protein",
        "suggested_carbs",
        "suggested_fat",
        "flags",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            finding = finding_by_id.get(str(row.get("id", "")))
            suggested = row.get("suggested") or {}
            writer.writerow(
                {
                    "id": row.get("id"),
                    "canonical_name": finding.canonical_name if finding else "",
                    "decision": row.get("decision"),
                    "confidence": row.get("confidence"),
                    "reason": row.get("reason"),
                    "risk_tags": "|".join(row.get("risk_tags") or []),
                    "current_kcal": finding.kcal_per_100g if finding else "",
                    "current_protein": finding.protein_per_100g if finding else "",
                    "current_carbs": finding.carbs_per_100g if finding else "",
                    "current_fat": finding.fat_per_100g if finding else "",
                    "suggested_kcal": suggested.get("kcal"),
                    "suggested_protein": suggested.get("protein"),
                    "suggested_carbs": suggested.get("carbs"),
                    "suggested_fat": suggested.get("fat"),
                    "flags": "|".join(finding.flags) if finding else "",
                }
            )


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit nutrition quality and optionally ask DeepSeek to review.")
    parser.add_argument("--config", default=str(_backend_dir() / "config.yaml"))
    parser.add_argument("--out-dir", default="")
    parser.add_argument("--llm", action="store_true", help="Ask DeepSeek to review high-risk findings.")
    parser.add_argument("--limit", type=int, default=200, help="Max findings sent to DeepSeek.")
    parser.add_argument("--batch-size", type=int, default=20)
    parser.add_argument("--sleep", type=float, default=0.3)
    args = parser.parse_args()

    _load_local_env()
    config = _read_yaml_config(Path(args.config))
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(args.out_dir) if args.out_dir else Path("D:/files/downloads") / f"foodlink_nutrition_quality_{timestamp}"
    out_dir.mkdir(parents=True, exist_ok=True)

    print("Connecting to database...")
    conn = _connect(config)
    try:
        rows = fetch_food_rows(conn)
    finally:
        conn.close()

    findings = [finding for row in rows if (finding := audit_row(row)) is not None]
    findings.sort(key=lambda x: (-x.severity, x.canonical_name))

    flags_summary: Dict[str, int] = {}
    for finding in findings:
        for flag in finding.flags:
            flags_summary[flag] = flags_summary.get(flag, 0) + 1

    summary = {
        "generated_at": datetime.now().isoformat(),
        "active_food_rows": len(rows),
        "rule_findings": len(findings),
        "severity_ge_5": sum(1 for f in findings if f.severity >= 5),
        "severity_ge_8": sum(1 for f in findings if f.severity >= 8),
        "flags_summary": dict(sorted(flags_summary.items(), key=lambda kv: (-kv[1], kv[0]))),
    }

    write_json(out_dir / "summary.json", summary)
    write_json(out_dir / "rule_findings.json", [asdict(f) for f in findings])
    write_findings_csv(out_dir / "rule_findings.csv", findings)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"Rule report: {out_dir / 'rule_findings.csv'}")

    if args.llm:
        high_risk = findings[: max(0, args.limit)]
        settings = _deepseek_settings(config)
        llm_rows, llm_errors = review_with_deepseek(high_risk, settings, args.batch_size, args.sleep, out_dir)
        finding_by_id = {f.id: f for f in findings}
        write_json(out_dir / "deepseek_review.json", llm_rows)
        write_llm_csv(out_dir / "deepseek_review.csv", llm_rows, finding_by_id)
        write_json(out_dir / "deepseek_errors.json", llm_errors)
        llm_summary: Dict[str, int] = {}
        for row in llm_rows:
            decision = str(row.get("decision") or "unknown")
            llm_summary[decision] = llm_summary.get(decision, 0) + 1
        if llm_errors:
            llm_summary["llm_error_rows"] = len(llm_errors)
        write_json(out_dir / "deepseek_summary.json", llm_summary)
        print("DeepSeek summary:")
        print(json.dumps(llm_summary, ensure_ascii=False, indent=2))
        print(f"DeepSeek report: {out_dir / 'deepseek_review.csv'}")
        if llm_errors:
            print(f"DeepSeek errors: {out_dir / 'deepseek_errors.json'}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
