"""Audit food nutrition aliases and optionally remove high-confidence mismatches.

The command scans every active ``food_nutrition_aliases`` row with local rules.
Only broad semantic candidates are sent to an OpenAI-compatible text model.  An
alias is eligible for automatic removal only when both conditions hold:

1. the model returns ``remove`` with confidence >= ``--min-confidence``; and
2. a deterministic hard-block rule also detects a food-form mismatch.

The default mode is read-only.  ``--apply`` requires an explicit database token
and writes a complete JSON backup before deleting aliases in one transaction.
If the provider is unavailable, ``--allow-hard-rule-removal`` can explicitly
select only deterministic food-form mismatches without an LLM decision.
API keys are accepted only through ``ALIAS_AUDIT_API_KEY`` and are never stored.

Examples:
    python scripts/audit_nutrition_aliases_llm.py --llm
    python scripts/audit_nutrition_aliases_llm.py --llm --apply \
        --confirm-db 127.0.0.1/food-link/public
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence, Tuple

import httpx
import psycopg2
import yaml
from dotenv import load_dotenv


MIXED_DISH_CUES = [
    "面", "饭", "粥", "饺", "馄饨", "云吞", "包子", "披萨", "汉堡", "麻辣烫",
    "盖浇", "便当", "套餐", "咖喱", "沙拉", "炒粉", "汤粉", "米线", "河粉",
    "noodle", "noodles", "rice", "sandwich", "platter", "menu", "burger", "pizza",
    "cereal", "macaroni", "lasagna", "dumpling", "bagel", "entree", "croissant",
]
STAPLE_CUES = [
    "面", "饭", "粥", "饺", "馄饨", "云吞", "包子", "馒头", "面包", "披萨", "汉堡", "米线", "河粉",
    "noodle", "noodles", "rice", "sandwich", "burger", "pizza", "macaroni", "lasagna",
    "dumpling", "bagel", "cereal", "croissant",
]
INGREDIENT_CUES = [
    "牛肉", "猪肉", "鸡肉", "羊肉", "鸭肉", "鱼", "虾", "鸡蛋", "全蛋",
    "蛋黄", "蛋白", "豆腐", "蔬菜", "白菜", "西兰花", "玉米", "瘦肉",
    "beef", "pork", "chicken", "lamb", "duck", "fish", "shrimp", "egg",
]
DRY_FORM_CUES = ["粉", "干", "powder", "flour", "dried", "dry", "dehydrated"]
LIQUID_FOOD_CUES = ["豆浆", "牛奶", "奶", "茶", "咖啡", "果汁", "饮料", "汤"]


@dataclass
class AliasRow:
    id: str
    food_id: str
    alias_name: str
    normalized_alias: str
    canonical_name: str
    source: str
    kcal: float
    protein: float
    carbs: float
    fat: float
    created_at: Any
    rule_flags: List[str]
    hard_flags: List[str]


def _backend_dir() -> Path:
    return Path(__file__).resolve().parent.parent


def _load_env() -> None:
    backend = _backend_dir()
    load_dotenv(backend / ".env", override=False)
    load_dotenv(backend / ".env.local", override=False)


def _read_config(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _cfg(config: Dict[str, Any], keys: Sequence[str], default: Any = "") -> Any:
    value: Any = config
    for key in keys:
        if not isinstance(value, dict):
            return default
        value = value.get(key)
    return default if value is None else value


def _dsn(config: Dict[str, Any]) -> str:
    host = os.getenv("POSTGRESQL_HOST") or _cfg(config, ["database", "host"])
    port = os.getenv("POSTGRESQL_PORT") or _cfg(config, ["database", "port"], 5432)
    name = os.getenv("POSTGRESQL_DATABASE") or _cfg(config, ["database", "name"])
    user = os.getenv("POSTGRESQL_USER") or _cfg(config, ["database", "user"])
    password = os.getenv("POSTGRESQL_PASSWORD") or _cfg(config, ["database", "password"])
    sslmode = os.getenv("POSTGRESQL_SSLMODE") or _cfg(config, ["database", "sslmode"], "disable")
    if not all([host, port, name, user]):
        raise RuntimeError("missing PostgreSQL connection settings")
    return f"host={host} port={port} dbname={name} user={user} password={password} sslmode={sslmode}"


def _confirm_token(config: Dict[str, Any]) -> str:
    host = str(os.getenv("POSTGRESQL_HOST") or _cfg(config, ["database", "host"])).strip()
    name = str(os.getenv("POSTGRESQL_DATABASE") or _cfg(config, ["database", "name"])).strip()
    schema = str(os.getenv("POSTGRESQL_SCHEMA") or _cfg(config, ["database", "schema"], "public")).strip() or "public"
    return f"{host}/{name}/{schema}"


def _f(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _has(text: str, cues: Iterable[str]) -> bool:
    lower = (text or "").lower()
    return any(cue.lower() in lower for cue in cues)


def _looks_like_mixed_dish(name: str) -> bool:
    if _has(name, MIXED_DISH_CUES):
        return True
    if "粉" in name and _has(name, ["红烧", "炒", "汤", "酸辣", "螺蛳"]):
        return True
    return False


def _rule_flags(alias: str, canonical: str, carbs: float, kcal: float) -> Tuple[List[str], List[str]]:
    flags: List[str] = []
    hard: List[str] = []
    alias_lower = alias.lower().strip()
    canonical_lower = canonical.lower().strip()
    if alias_lower == canonical_lower:
        return flags, hard
    alias_mixed = _looks_like_mixed_dish(alias)
    canonical_mixed = _looks_like_mixed_dish(canonical)
    if alias_mixed:
        flags.append("mixed_alias_name")
    if alias_mixed and not canonical_mixed:
        flags.append("mixed_to_non_mixed")
    if _has(alias, STAPLE_CUES) and not _has(canonical, STAPLE_CUES):
        flags.append("staple_to_nonstaple_target")
        if carbs <= 8:
            flags.append("staple_to_low_carb_target")
            hard.append("staple_to_low_carb_nonstaple")
    if alias_mixed and not canonical_mixed and _has(canonical, INGREDIENT_CUES):
        flags.append("mixed_dish_to_ingredient_candidate")
        hard.append("mixed_dish_to_single_ingredient")
    alias_dry = _has(alias, DRY_FORM_CUES)
    canonical_dry = _has(canonical, DRY_FORM_CUES)
    if alias_dry and not canonical_dry:
        flags.append("dry_form_to_non_dry_target")
        if alias.endswith("粉") and _has(canonical, LIQUID_FOOD_CUES) and kcal < 150:
            hard.append("concentrated_powder_to_liquid")
    return sorted(set(flags)), sorted(set(hard))


def fetch_aliases(conn: Any) -> List[AliasRow]:
    sql = """
        SELECT a.id::text, a.food_id::text, a.alias_name, a.normalized_alias,
               f.canonical_name, COALESCE(f.source, ''),
               f.kcal_per_100g, f.protein_per_100g, f.carbs_per_100g,
               f.fat_per_100g, a.created_at
        FROM public.food_nutrition_aliases a
        JOIN public.food_nutrition_library f ON f.id = a.food_id
        WHERE f.is_active = true
        ORDER BY a.created_at, a.id
    """
    rows: List[AliasRow] = []
    with conn.cursor() as cur:
        cur.execute(sql)
        for raw in cur.fetchall():
            flags, hard = _rule_flags(str(raw[2] or ""), str(raw[4] or ""), _f(raw[8]), _f(raw[6]))
            rows.append(
                AliasRow(
                    id=str(raw[0]), food_id=str(raw[1]), alias_name=str(raw[2] or ""),
                    normalized_alias=str(raw[3] or ""), canonical_name=str(raw[4] or ""),
                    source=str(raw[5] or ""), kcal=_f(raw[6]), protein=_f(raw[7]),
                    carbs=_f(raw[8]), fat=_f(raw[9]), created_at=raw[10],
                    rule_flags=flags, hard_flags=hard,
                )
            )
    return rows


def _candidate(row: AliasRow) -> bool:
    return bool(row.rule_flags)


def _extract_json(text: str) -> Dict[str, Any]:
    text = (text or "").strip()
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


def _prompt(batch: Sequence[AliasRow]) -> str:
    data = [
        {
            "id": row.id,
            "alias": row.alias_name,
            "target": row.canonical_name,
            "target_per_100g": {"kcal": row.kcal, "protein": row.protein, "carbs": row.carbs, "fat": row.fat},
            "rule_flags": row.rule_flags,
        }
        for row in batch
    ]
    return (
        "审核食物营养库别名是否可以安全映射到目标食物。alias 是用户/AI识别名称，target 是实际取营养值的条目。"
        "只有同一种食物、同一加工形态、同一浓缩/冲调口径才是 keep。整道混合菜映射到其中单一原料必须 remove，"
        "例如牛肉面->瘦牛肉、牛肉饭->瘦牛肉、鸡蛋面->鸡蛋。粉剂映射到冲调后饮品也应 remove。"
        "合理的中英文翻译、俗称、烹饪方式轻微差异可 keep；无法确定时 review。"
        "必须为每个输入 id 返回一项，不得遗漏。confidence 是0到1。reason不超过30个汉字。"
        "只返回JSON对象：{\"items\":[{\"id\":\"...\",\"decision\":\"keep|remove|review\",\"confidence\":0.0,\"reason\":\"...\"}]}。"
        f"\n数据：{json.dumps(data, ensure_ascii=False, separators=(',', ':'))}"
    )


def review_aliases(rows: Sequence[AliasRow], out_dir: Path, batch_size: int, sleep_seconds: float) -> List[Dict[str, Any]]:
    api_key = os.getenv("ALIAS_AUDIT_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ALIAS_AUDIT_API_KEY is required for --llm")
    base = os.getenv("ALIAS_AUDIT_BASE_URL", "https://maas-openapi.wanjiedata.com/api").rstrip("/")
    model = os.getenv("ALIAS_AUDIT_MODEL", "gpt-5.4").strip()
    url = f"{base}/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    raw_dir = out_dir / "llm_raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    all_results: List[Dict[str, Any]] = []

    def call(client: httpx.Client, batch: Sequence[AliasRow], label: str, depth: int = 0) -> List[Dict[str, Any]]:
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": "你是严格的食品数据库质检API，只输出完整JSON，不输出Markdown和解释。"},
                {"role": "user", "content": _prompt(batch)},
            ],
            "stream": False,
            "temperature": 1,
        }
        last_error = ""
        content = ""
        for attempt in range(1, 3):
            try:
                response = client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
                content = str(data["choices"][0]["message"]["content"])
                items = _extract_json(content).get("items")
                if not isinstance(items, list):
                    raise RuntimeError("response missing items")
                by_id = {str(item.get("id")): item for item in items if isinstance(item, dict)}
                missing = [row.id for row in batch if row.id not in by_id]
                if missing:
                    raise RuntimeError(f"response missing {len(missing)} ids")
                return [by_id[row.id] for row in batch]
            except Exception as exc:  # noqa: BLE001 - preserve raw provider failures in report
                last_error = f"attempt={attempt}: {type(exc).__name__}: {exc}"
                if attempt < 2:
                    time.sleep(float(attempt))
        (raw_dir / f"{label}.json").write_text(
            json.dumps({"error": last_error, "content": content, "ids": [row.id for row in batch]}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        if len(batch) > 1 and depth < 6:
            mid = len(batch) // 2
            return call(client, batch[:mid], label + "_a", depth + 1) + call(client, batch[mid:], label + "_b", depth + 1)
        return [{"id": row.id, "decision": "review", "confidence": 0, "reason": "模型调用失败"} for row in batch]

    with httpx.Client(timeout=httpx.Timeout(60.0, connect=30.0)) as client:
        batches = [rows[i:i + batch_size] for i in range(0, len(rows), batch_size)]
        for index, batch in enumerate(batches, 1):
            print(f"LLM alias review {index}/{len(batches)} rows={len(batch)}", flush=True)
            all_results.extend(call(client, batch, f"batch_{index:03d}"))
            if sleep_seconds > 0 and index < len(batches):
                time.sleep(sleep_seconds)
    return all_results


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def apply_deletions(conn: Any, targets: Sequence[AliasRow], out_dir: Path) -> int:
    backup_path = out_dir / "deleted_aliases_backup.json"
    write_json(backup_path, [asdict(row) for row in targets])
    ids = [row.id for row in targets]
    if not ids:
        return 0
    with conn.cursor() as cur:
        cur.execute("DELETE FROM public.food_nutrition_aliases WHERE id::text = ANY(%s) RETURNING id::text", (ids,))
        deleted = [row[0] for row in cur.fetchall()]
    if len(deleted) != len(ids):
        raise RuntimeError(f"delete count mismatch expected={len(ids)} actual={len(deleted)}")
    return len(deleted)


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit food nutrition aliases with rules and an optional LLM review.")
    parser.add_argument("--config", default=str(_backend_dir() / "config.yaml"))
    parser.add_argument("--out-dir", default="")
    parser.add_argument("--llm", action="store_true")
    parser.add_argument("--batch-size", type=int, default=30)
    parser.add_argument("--sleep", type=float, default=0.2)
    parser.add_argument("--min-confidence", type=float, default=0.98)
    parser.add_argument("--allow-hard-rule-removal", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-db", default="")
    args = parser.parse_args()

    _load_env()
    config = _read_config(Path(args.config))
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(args.out_dir) if args.out_dir else Path("D:/files/downloads") / f"foodlink_alias_audit_{stamp}"
    out_dir.mkdir(parents=True, exist_ok=True)
    token = _confirm_token(config)
    if args.apply and args.confirm_db != token:
        raise RuntimeError(f"refusing apply: rerun with --confirm-db {token}")
    if args.apply and not (args.llm or args.allow_hard_rule_removal):
        raise RuntimeError("--apply requires --llm or --allow-hard-rule-removal")

    conn = psycopg2.connect(_dsn(config))
    conn.autocommit = False
    try:
        rows = fetch_aliases(conn)
        candidates = [row for row in rows if _candidate(row)]
        write_json(out_dir / "all_aliases.json", [asdict(row) for row in rows])
        write_json(out_dir / "rule_candidates.json", [asdict(row) for row in candidates])
        reviews: List[Dict[str, Any]] = []
        if args.llm:
            reviews = review_aliases(candidates, out_dir, max(1, args.batch_size), max(0, args.sleep))
        review_by_id = {str(row.get("id")): row for row in reviews}
        targets: List[AliasRow] = []
        for row in candidates:
            review = review_by_id.get(row.id, {})
            llm_approved = (
                review.get("decision") == "remove"
                and _f(review.get("confidence")) >= args.min_confidence
            )
            if row.hard_flags and (llm_approved or args.allow_hard_rule_removal):
                targets.append(row)
        write_json(out_dir / "llm_review.json", reviews)
        write_json(
            out_dir / "proposed_deletions.json",
            [{**asdict(row), "llm": review_by_id.get(row.id)} for row in targets],
        )
        deleted = 0
        if args.apply:
            deleted = apply_deletions(conn, targets, out_dir)
            conn.commit()
        else:
            conn.rollback()
        summary = {
            "generated_at": datetime.now().isoformat(),
            "database": token,
            "apply": args.apply,
            "active_aliases_scanned": len(rows),
            "rule_candidates": len(candidates),
            "llm_reviewed": len(reviews),
            "proposed_deletions": len(targets),
            "deleted": deleted,
            "min_confidence": args.min_confidence,
            "allow_hard_rule_removal": args.allow_hard_rule_removal,
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
    sys.exit(main())
