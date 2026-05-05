"""
Backfill top missing foods from historical records into the nutrition library.

Workflow:
1. Read top missing foods from user_food_records.items
2. Skip foods already covered by the current library / aliases
3. Query one or more providers (currently NLC via search-engine discovery)
4. Insert matched foods into food_nutrition_library
5. Insert the unresolved raw name into food_nutrition_aliases

This script is designed for incremental runs:
- already covered foods are skipped before translation / fetch
- duplicate aliases are ignored
- existing canonical foods can be reused, with only a new alias inserted
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from html import unescape
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote_plus, unquote

import httpx
from dotenv import load_dotenv


SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _load_env() -> None:
    load_dotenv(BACKEND_DIR / ".env", override=False)
    load_dotenv(BACKEND_DIR / ".env.local", override=False)


def _get_supabase_client():
    from database import get_supabase_client

    return get_supabase_client()


def _normalize_food_name(name: str) -> str:
    from database import normalize_food_name

    return normalize_food_name(name)


def _search_food_candidates(query: str, limit: int = 5) -> List[Dict[str, Any]]:
    from database import search_food_nutrition_candidates_sync

    return search_food_nutrition_candidates_sync(query, limit=limit)


def _chunked(items: Sequence[Any], size: int) -> Iterable[Sequence[Any]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _to_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None


def _normalize_source_label(source: str) -> str:
    value = _clean_text(source)
    if not value:
        return "未知来源"
    if value in {"项目内置初始营养数据", "project_seed_nutrition_v1", "seed_v1"}:
        return "项目内置初始营养数据"
    if value.startswith("usda_foundation_"):
        return "美国农业部食物数据中心（Foundation）"
    if value.startswith("usda_sr_legacy_"):
        return "美国农业部食物数据中心（SR Legacy）"
    if value.startswith("usda_survey_fndds_"):
        return "美国农业部食物数据中心（Survey/FNDDS）"
    if value.startswith("usda_experimental_"):
        return "美国农业部食物数据中心（Experimental）"
    if value.startswith("usda_branded_") or value.startswith("usda_branded_foods_"):
        return "美国农业部食物数据中心（Branded Foods）"
    if value.startswith("usda_"):
        return "美国农业部食物数据中心"
    if value.startswith("nlc_chinanutri_") or value == "中国营养学会/中国疾控中心食物营养成分查询平台":
        return "中国营养学会/中国疾控中心食物营养成分查询平台"
    return value


def _source_display(source: str) -> str:
    return _normalize_source_label(source)



def _contains_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text or ""))


def _sleep(seconds: float, reason: str) -> None:
    if seconds <= 0:
        return
    print(f"[enrich_top_missing_foods] sleep={seconds:.2f}s reason={reason}")
    time.sleep(seconds)


def _execute_supabase_request(
    request: Any,
    *,
    action: str,
    max_retries: int,
    retry_sleep_seconds: float,
) -> Any:
    attempt = 0
    while True:
        attempt += 1
        try:
            return request.execute()
        except Exception as exc:
            if attempt > max_retries:
                raise RuntimeError(
                    f"Supabase request failed after {attempt} attempts during {action}: {exc}"
                ) from exc
            sleep_seconds = retry_sleep_seconds * attempt
            print(
                f"[enrich_top_missing_foods] supabase_retry action={action} "
                f"attempt={attempt} sleep={sleep_seconds:.2f}s error={exc}"
            )
            _sleep(sleep_seconds, f"retry {action}")


@dataclass
class UnresolvedFood:
    raw_name: str
    normalized_name: str
    hit_count: int
    last_seen_at: str
    sample_payload: Dict[str, Any]


_COMPOSITE_SEPARATORS = ["，", ",", "、", ";", "；", "+", "／", "/", "|"]
_QUANTITY_TOKENS = [
    "个",
    "片",
    "块",
    "碗",
    "勺",
    "包",
    "条",
    "瓶",
    "根",
    "颗",
    "只",
    "份",
    "ml",
    "g",
    "kg",
    "克",
    "千克",
]

_STOP_PHRASES = ["一些", "一个", "少许"]
_NUMBER_PATTERN = r"[0-9０-９一二三四五六七八九十两半]+"

def _is_likely_single_food_name(name: str) -> bool:
    text = _clean_text(name)
    if not text:
        return False
    if len(text) > 24:
        return False
    if any(sep in text for sep in _COMPOSITE_SEPARATORS):
        return False
    if re.search(r"\d", text):
        return False
    if re.search(r"[锛?].+[锛?]", text):
        inner = re.search(r"[锛?]([^锛?]+)[锛?]", text)
        if inner and any(token in inner.group(1) for token in _QUANTITY_TOKENS):
            return False
    if any(token in text for token in _QUANTITY_TOKENS):
        return False
    if any(text.endswith(token) for token in _STOP_PHRASES):
        return False
    return True


def _strip_quantity_suffix(text: str) -> str:
    value = _clean_text(text)
    value = re.sub(r"[锛?][^锛?]*[锛?]", "", value)
    value = re.sub(rf"{_NUMBER_PATTERN}\s*({'|'.join(map(re.escape, _QUANTITY_TOKENS))})", "", value)
    value = re.sub(rf"({'|'.join(map(re.escape, _QUANTITY_TOKENS))})\s*{_NUMBER_PATTERN}", "", value)
    value = re.sub(rf"{_NUMBER_PATTERN}", "", value)
    value = re.sub(r"\s+", "", value)
    return value.strip("锛?銆侊紱;:+锛?| ")


def _split_unresolved_food_name(raw_name: str) -> List[str]:
    text = _clean_text(raw_name)
    if not text:
        return []
    normalized = text
    for sep in _COMPOSITE_SEPARATORS:
        normalized = normalized.replace(sep, "|")
    parts = [part.strip() for part in normalized.split("|") if part.strip()]
    if not parts:
        parts = [text]

    candidates: List[str] = []
    for part in parts:
        stripped = _strip_quantity_suffix(part)
        if not stripped:
            continue
        candidates.append(stripped)
    if not candidates:
        fallback = _strip_quantity_suffix(text)
        if fallback:
            candidates.append(fallback)
    deduped: List[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        normalized_candidate = _normalize_food_name(candidate)
        if not normalized_candidate or normalized_candidate in seen:
            continue
        seen.add(normalized_candidate)
        deduped.append(candidate)
    return deduped


@dataclass
class ProviderResult:
    provider: str
    canonical_name: str
    normalized_name: str
    source: str
    confidence: float
    reference_url: str
    kcal_per_100g: Optional[float] = None
    protein_per_100g: Optional[float] = None
    carbs_per_100g: Optional[float] = None
    fat_per_100g: Optional[float] = None
    fiber_per_100g: Optional[float] = None
    sugar_per_100g: Optional[float] = None
    saturated_fat_per_100g: Optional[float] = None
    cholesterol_mg_per_100g: Optional[float] = None
    sodium_mg_per_100g: Optional[float] = None
    potassium_mg_per_100g: Optional[float] = None
    calcium_mg_per_100g: Optional[float] = None
    iron_mg_per_100g: Optional[float] = None
    magnesium_mg_per_100g: Optional[float] = None
    zinc_mg_per_100g: Optional[float] = None
    vitamin_a_rae_mcg_per_100g: Optional[float] = None
    vitamin_c_mg_per_100g: Optional[float] = None
    vitamin_d_mcg_per_100g: Optional[float] = None
    vitamin_e_mg_per_100g: Optional[float] = None
    vitamin_k_mcg_per_100g: Optional[float] = None
    thiamin_mg_per_100g: Optional[float] = None
    riboflavin_mg_per_100g: Optional[float] = None
    niacin_mg_per_100g: Optional[float] = None
    vitamin_b6_mg_per_100g: Optional[float] = None
    folate_mcg_per_100g: Optional[float] = None
    vitamin_b12_mcg_per_100g: Optional[float] = None


@dataclass
class HistoricalNutritionAggregate:
    sample_count: int
    total_weight_g: float
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


_RULE_PREFIXES = ["清炒", "炒", "煮", "水煮", "蒸", "卤", "白灼", "红烧", "烧", "即食", "全脂纯", "全脂"]
_RULE_QUERY_REPLACEMENTS = {
    "黑咖啡": "咖啡",
    "茶叶蛋": "鸡蛋",
    "卤蛋": "鸡蛋",
    "煮鸡蛋": "鸡蛋",
    "炒鸡蛋": "鸡蛋",
    "全脂纯牛奶": "牛奶",
    "全脂牛奶": "牛奶",
    "熟米饭": "米饭",
    "酸奶": "无糖酸奶",
}
_RULE_REQUIRED_KEYWORDS = {
    "黑咖啡": ["咖啡"],
    "茶叶蛋": ["鸡蛋", "全蛋"],
    "卤蛋": ["鸡蛋", "全蛋"],
    "煮鸡蛋": ["鸡蛋", "全蛋"],
    "炒鸡蛋": ["鸡蛋", "全蛋"],
    "全脂纯牛奶": ["牛奶", "奶"],
    "全脂牛奶": ["牛奶", "奶"],
    "熟米饭": ["米饭", "饭"],
    "清汤": ["汤"],
    "酸奶": ["酸奶", "yogurt"],
}
_RULE_BLOCKED_KEYWORDS = {
    "卤蛋": ["蛋清", "蛋白"],
    "煮鸡蛋": ["蛋清", "蛋白"],
    "炒鸡蛋": ["蛋清", "蛋白"],
    "茶叶蛋": ["蛋清", "蛋白"],
    "黑米饭": ["白米饭"],
    "紫米饭": ["白米饭"],
    "清汤": ["蛋清", "蛋白"],
    "酵母蛋白粉": ["egg", "蛋清", "蛋白"],
    "酸奶": ["cream, sour", "sour cream", "奶油"],
    "荞麦面": ["flour"],
    "炒青菜": ["小白菜", "生菜", "上海青", "油麦菜"],
}
_RULE_FORCE_NOT_FOUND = {"荞麦面", "炒青菜", "清炒油菜", "清炒青菜", "清炒绿叶菜"}



class HeuristicAliasProvider:
    def resolve(self, raw_name: str, normalized_name: str) -> Optional[ProviderResult]:
        if raw_name in _RULE_FORCE_NOT_FOUND:
            return None
        candidate_queries = self._candidate_queries(raw_name)
        for index, query in enumerate(candidate_queries):
            candidates = _search_food_candidates(query, limit=5)
            if not candidates:
                continue
            best = candidates[0]
            best_score = float(best.get("score") or 0)
            canonical_name = _clean_text(best.get("canonical_name"))
            canonical_normalized_name = _normalize_food_name(canonical_name)
            if not canonical_name or not canonical_normalized_name:
                continue
            if not self._is_candidate_acceptable(
                raw_name=raw_name,
                query=query,
                query_index=index,
                best=best,
                canonical_name=canonical_name,
                canonical_normalized_name=canonical_normalized_name,
                best_score=best_score,
            ):
                continue
            nutrients = best.get("unit_nutrition_per_100g") or {}
            return ProviderResult(
                provider="heuristic_alias",
                canonical_name=canonical_name,
                normalized_name=canonical_normalized_name,
                source=_normalize_source_label(_clean_text(best.get("source")) or "unknown_existing_source"),
                confidence=round(best_score, 4),
                reference_url=f"local://search_food_nutrition_candidates_sync?q={quote_plus(query)}",
                kcal_per_100g=_to_float(nutrients.get("calories")),
                protein_per_100g=_to_float(nutrients.get("protein")),
                carbs_per_100g=_to_float(nutrients.get("carbs")),
                fat_per_100g=_to_float(nutrients.get("fat")),
                fiber_per_100g=_to_float(nutrients.get("fiber")),
                sugar_per_100g=_to_float(nutrients.get("sugar")),
                saturated_fat_per_100g=_to_float(nutrients.get("saturatedFat")),
                cholesterol_mg_per_100g=_to_float(nutrients.get("cholesterolMg")),
                sodium_mg_per_100g=_to_float(nutrients.get("sodiumMg")),
                potassium_mg_per_100g=_to_float(nutrients.get("potassiumMg")),
                calcium_mg_per_100g=_to_float(nutrients.get("calciumMg")),
                iron_mg_per_100g=_to_float(nutrients.get("ironMg")),
                magnesium_mg_per_100g=_to_float(nutrients.get("magnesiumMg")),
                zinc_mg_per_100g=_to_float(nutrients.get("zincMg")),
                vitamin_a_rae_mcg_per_100g=_to_float(nutrients.get("vitaminARaeMcg")),
                vitamin_c_mg_per_100g=_to_float(nutrients.get("vitaminCMg")),
                thiamin_mg_per_100g=_to_float(nutrients.get("thiaminMg")),
                riboflavin_mg_per_100g=_to_float(nutrients.get("riboflavinMg")),
                niacin_mg_per_100g=_to_float(nutrients.get("niacinMg")),
            )
        return None

    def close(self) -> None:
        return None

    def _candidate_queries(self, raw_name: str) -> List[str]:
        text = _clean_text(raw_name)
        out = [text]
        replaced = _RULE_QUERY_REPLACEMENTS.get(text)
        if replaced:
            out.append(replaced)
        stripped = text
        for prefix in _RULE_PREFIXES:
            if stripped.startswith(prefix) and len(stripped) > len(prefix) + 1:
                stripped = stripped[len(prefix):]
                out.append(stripped)
        split_parts = _split_unresolved_food_name(text)
        out.extend(split_parts)
        deduped: List[str] = []
        seen: set[str] = set()
        for candidate in out:
            cleaned = _clean_text(candidate)
            normalized = _normalize_food_name(cleaned)
            if not cleaned or not normalized or normalized in seen:
                continue
            seen.add(normalized)
            deduped.append(cleaned)
        return deduped

    def _is_candidate_acceptable(
        self,
        *,
        raw_name: str,
        query: str,
        query_index: int,
        best: Dict[str, Any],
        canonical_name: str,
        canonical_normalized_name: str,
        best_score: float,
    ) -> bool:
        raw_normalized = _normalize_food_name(raw_name)
        query_normalized = _normalize_food_name(query)
        source = _normalize_source_label(_clean_text(best.get("source")))
        blocked_keywords = _RULE_BLOCKED_KEYWORDS.get(raw_name, [])
        lowered_canonical = canonical_name.lower()
        for blocked in blocked_keywords:
            if blocked.lower() in lowered_canonical:
                return False

        required_keywords = _RULE_REQUIRED_KEYWORDS.get(raw_name, [])
        if required_keywords and not any(keyword.lower() in lowered_canonical for keyword in required_keywords):
            return False

        if query_index == 0:
            if best_score >= 0.9:
                return True
            if query_normalized and query_normalized in canonical_normalized_name and best_score >= 0.72:
                return True
            return False

        if raw_name in _RULE_QUERY_REPLACEMENTS:
            if best_score >= 0.82:
                return True
            if query_normalized and query_normalized in canonical_normalized_name and best_score >= 0.58:
                return True
            return False

        if query != raw_name:
            if best_score >= 0.92:
                return True
            if query_normalized and query_normalized in canonical_normalized_name and best_score >= 0.75:
                return True
            return False

        if "美国农业部" in source and _contains_chinese(raw_name) and best_score < 0.95:
            return False
        return best_score >= 0.9 or (raw_normalized and raw_normalized in canonical_normalized_name and best_score >= 0.78)


def _effective_item_weight(item: Dict[str, Any]) -> float:
    weight = max(0.0, float(item.get("weight") or 0))
    intake = max(0.0, float(item.get("intake") or 0))
    ratio = float(item.get("ratio") or 0)
    if intake > 0:
        return intake
    if weight > 0 and ratio > 0:
        return weight * ratio / 100.0
    return weight


_HISTORY_NUTRIENT_FIELD_MAP: List[Tuple[str, str]] = [
    ("calories", "kcal_per_100g"),
    ("protein", "protein_per_100g"),
    ("carbs", "carbs_per_100g"),
    ("fat", "fat_per_100g"),
    ("fiber", "fiber_per_100g"),
    ("sugar", "sugar_per_100g"),
    ("saturatedFat", "saturated_fat_per_100g"),
    ("cholesterolMg", "cholesterol_mg_per_100g"),
    ("sodiumMg", "sodium_mg_per_100g"),
    ("potassiumMg", "potassium_mg_per_100g"),
    ("calciumMg", "calcium_mg_per_100g"),
    ("ironMg", "iron_mg_per_100g"),
    ("magnesiumMg", "magnesium_mg_per_100g"),
    ("zincMg", "zinc_mg_per_100g"),
    ("vitaminARaeMcg", "vitamin_a_rae_mcg_per_100g"),
    ("vitaminCMg", "vitamin_c_mg_per_100g"),
    ("vitaminDMcg", "vitamin_d_mcg_per_100g"),
    ("vitaminEMg", "vitamin_e_mg_per_100g"),
    ("vitaminKMcg", "vitamin_k_mcg_per_100g"),
    ("thiaminMg", "thiamin_mg_per_100g"),
    ("riboflavinMg", "riboflavin_mg_per_100g"),
    ("niacinMg", "niacin_mg_per_100g"),
    ("vitaminB6Mg", "vitamin_b6_mg_per_100g"),
    ("folateMcg", "folate_mcg_per_100g"),
    ("vitaminB12Mcg", "vitamin_b12_mcg_per_100g"),
]


def _build_historical_nutrition_stats(
    *,
    lookback_days: int,
    fetch_page_size: int,
    min_samples: int,
    min_total_weight_g: float,
    supabase_retries: int,
    supabase_retry_sleep_seconds: float,
) -> Dict[str, HistoricalNutritionAggregate]:
    supabase = _get_supabase_client()
    since_iso = (datetime.now(timezone.utc) - timedelta(days=max(1, lookback_days))).isoformat()
    aggregated: Dict[str, Dict[str, Any]] = {}
    offset = 0
    page_size = max(100, int(fetch_page_size))

    while True:
        query = (
            supabase.table("user_food_records")
            .select("record_time, items")
            .gte("record_time", since_iso)
            .order("record_time", desc=True)
            .range(offset, offset + page_size - 1)
        )
        rows = list(
            _execute_supabase_request(
                query,
                action=f"history_nutrition_page_{offset // page_size + 1}",
                max_retries=supabase_retries,
                retry_sleep_seconds=supabase_retry_sleep_seconds,
            ).data
            or []
        )
        if not rows:
            break

        for row in rows:
            items = row.get("items") or []
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                raw_name = _clean_text(item.get("name"))
                normalized_name = _normalize_food_name(raw_name)
                if not raw_name or not normalized_name:
                    continue
                effective_weight = _effective_item_weight(item)
                if effective_weight < 5:
                    continue
                nutrients = item.get("nutrients") or {}
                if not isinstance(nutrients, dict):
                    continue

                bucket = aggregated.setdefault(
                    normalized_name,
                    {
                        "sample_count": 0,
                        "total_weight_g": 0.0,
                        "nutrient_sums": {target: 0.0 for _, target in _HISTORY_NUTRIENT_FIELD_MAP},
                    },
                )
                bucket["sample_count"] += 1
                bucket["total_weight_g"] += effective_weight
                for source_field, target_field in _HISTORY_NUTRIENT_FIELD_MAP:
                    bucket["nutrient_sums"][target_field] += max(0.0, float(nutrients.get(source_field) or 0))

        if len(rows) < page_size:
            break
        offset += page_size

    results: Dict[str, HistoricalNutritionAggregate] = {}
    for normalized_name, bucket in aggregated.items():
        sample_count = int(bucket["sample_count"] or 0)
        total_weight_g = float(bucket["total_weight_g"] or 0)
        if sample_count < max(1, min_samples) or total_weight_g < max(1.0, min_total_weight_g):
            continue
        factor = 100.0 / total_weight_g
        nutrient_values = {
            target_field: round(float(bucket["nutrient_sums"][target_field]) * factor, 4)
            for _, target_field in _HISTORY_NUTRIENT_FIELD_MAP
        }
        results[normalized_name] = HistoricalNutritionAggregate(
            sample_count=sample_count,
            total_weight_g=round(total_weight_g, 2),
            **nutrient_values,
        )
    return results


class HistoricalAverageProvider:
    def __init__(self, stats_by_name: Dict[str, HistoricalNutritionAggregate]) -> None:
        self.stats_by_name = stats_by_name

    def close(self) -> None:
        return None

    def resolve(self, raw_name: str, normalized_name: str) -> Optional[ProviderResult]:
        stat = self.stats_by_name.get(normalized_name)
        if not stat:
            return None
        return ProviderResult(
            provider="history_average",
            canonical_name=raw_name,
            normalized_name=normalized_name,
            source="历史识别记录营养均值",
            confidence=min(0.98, round(0.55 + min(stat.sample_count, 20) * 0.02, 4)),
            reference_url=f"local://historical_average?name={quote_plus(raw_name)}&samples={stat.sample_count}",
            kcal_per_100g=stat.kcal_per_100g,
            protein_per_100g=stat.protein_per_100g,
            carbs_per_100g=stat.carbs_per_100g,
            fat_per_100g=stat.fat_per_100g,
            fiber_per_100g=stat.fiber_per_100g,
            sugar_per_100g=stat.sugar_per_100g,
            saturated_fat_per_100g=stat.saturated_fat_per_100g,
            cholesterol_mg_per_100g=stat.cholesterol_mg_per_100g,
            sodium_mg_per_100g=stat.sodium_mg_per_100g,
            potassium_mg_per_100g=stat.potassium_mg_per_100g,
            calcium_mg_per_100g=stat.calcium_mg_per_100g,
            iron_mg_per_100g=stat.iron_mg_per_100g,
            magnesium_mg_per_100g=stat.magnesium_mg_per_100g,
            zinc_mg_per_100g=stat.zinc_mg_per_100g,
            vitamin_a_rae_mcg_per_100g=stat.vitamin_a_rae_mcg_per_100g,
            vitamin_c_mg_per_100g=stat.vitamin_c_mg_per_100g,
            vitamin_d_mcg_per_100g=stat.vitamin_d_mcg_per_100g,
            vitamin_e_mg_per_100g=stat.vitamin_e_mg_per_100g,
            vitamin_k_mcg_per_100g=stat.vitamin_k_mcg_per_100g,
            thiamin_mg_per_100g=stat.thiamin_mg_per_100g,
            riboflavin_mg_per_100g=stat.riboflavin_mg_per_100g,
            niacin_mg_per_100g=stat.niacin_mg_per_100g,
            vitamin_b6_mg_per_100g=stat.vitamin_b6_mg_per_100g,
            folate_mcg_per_100g=stat.folate_mcg_per_100g,
            vitamin_b12_mcg_per_100g=stat.vitamin_b12_mcg_per_100g,
        )


class NlcSearchProvider:
    def __init__(self, timeout_seconds: float, search_sleep_seconds: float) -> None:
        self.client = httpx.Client(
            timeout=timeout_seconds,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
                )
            },
            follow_redirects=True,
        )
        self.search_sleep_seconds = search_sleep_seconds

    def close(self) -> None:
        self.client.close()

    def resolve(self, raw_name: str, normalized_name: str) -> Optional[ProviderResult]:
        candidate_urls = self._search_candidate_urls(raw_name)
        if not candidate_urls:
            return None

        best: Optional[ProviderResult] = None
        best_score = -1.0
        for url in candidate_urls[:5]:
            parsed = self._fetch_and_parse_food_page(url)
            if not parsed:
                continue
            title = parsed["canonical_name"]
            score = self._score_candidate(raw_name, normalized_name, title)
            if score < 0.45:
                continue
            result = ProviderResult(
                provider="nlc_search",
                canonical_name=title,
                normalized_name=_normalize_food_name(title),
                source="中国营养学会/中国疾控中心食物营养成分查询平台",
                confidence=round(score, 4),
                reference_url=url,
                kcal_per_100g=parsed.get("kcal_per_100g"),
                protein_per_100g=parsed.get("protein_per_100g"),
                carbs_per_100g=parsed.get("carbs_per_100g"),
                fat_per_100g=parsed.get("fat_per_100g"),
                fiber_per_100g=parsed.get("fiber_per_100g"),
                cholesterol_mg_per_100g=parsed.get("cholesterol_mg_per_100g"),
                sodium_mg_per_100g=parsed.get("sodium_mg_per_100g"),
                potassium_mg_per_100g=parsed.get("potassium_mg_per_100g"),
                calcium_mg_per_100g=parsed.get("calcium_mg_per_100g"),
                iron_mg_per_100g=parsed.get("iron_mg_per_100g"),
                magnesium_mg_per_100g=parsed.get("magnesium_mg_per_100g"),
                zinc_mg_per_100g=parsed.get("zinc_mg_per_100g"),
                vitamin_a_rae_mcg_per_100g=parsed.get("vitamin_a_rae_mcg_per_100g"),
                vitamin_c_mg_per_100g=parsed.get("vitamin_c_mg_per_100g"),
                thiamin_mg_per_100g=parsed.get("thiamin_mg_per_100g"),
                riboflavin_mg_per_100g=parsed.get("riboflavin_mg_per_100g"),
                niacin_mg_per_100g=parsed.get("niacin_mg_per_100g"),
            )
            if score > best_score:
                best = result
                best_score = score
        return best

    def _search_candidate_urls(self, query: str) -> List[str]:
        search_queries = [
            f'site:nlc.chinanutri.cn/fq/foodinfo/ "{query}"',
            f"site:nlc.chinanutri.cn/fq/foodinfo/ {query}",
        ]
        urls: List[str] = []
        for search_query in search_queries:
            for provider_name, url in [
                ("duckduckgo", f"https://html.duckduckgo.com/html/?q={quote_plus(search_query)}"),
                ("bing", f"https://www.bing.com/search?q={quote_plus(search_query)}"),
            ]:
                try:
                    response = self.client.get(url)
                    response.raise_for_status()
                    urls.extend(self._extract_foodinfo_urls(response.text))
                    if urls:
                        return list(dict.fromkeys(urls))
                except Exception as exc:
                    print(
                        f"[enrich_top_missing_foods] search_provider_error={provider_name} "
                        f"query={query} error={exc}"
                    )
                finally:
                    _sleep(self.search_sleep_seconds, f"after {provider_name} search")
        return list(dict.fromkeys(urls))

    def _extract_foodinfo_urls(self, html: str) -> List[str]:
        decoded = unquote(html)
        patterns = [
            r"https://nlc\.chinanutri\.cn/fq/foodinfo/\d+\.html",
            r"http://nlc\.chinanutri\.cn/fq/foodinfo/\d+\.html",
        ]
        found: List[str] = []
        for pattern in patterns:
            found.extend(re.findall(pattern, decoded, flags=re.IGNORECASE))
        return list(dict.fromkeys(url.replace("http://", "https://") for url in found))

    def _fetch_and_parse_food_page(self, url: str) -> Optional[Dict[str, Any]]:
        response = self.client.get(url)
        response.raise_for_status()
        html = response.text
        match_id = re.search(r"/foodinfo/(\d+)\.html", url)
        food_id = match_id.group(1) if match_id else "unknown"
        title_match = re.search(r"<h1[^>]*>\s*([^<]+?)\s*</h1>", html, flags=re.IGNORECASE | re.DOTALL)
        canonical_name = _clean_text(unescape(title_match.group(1))) if title_match else ""
        if not canonical_name:
            return None

        text = self._html_to_text(html)
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        metrics = self._parse_metrics(lines)
        if metrics.get("kcal_per_100g") is None:
            return None
        metrics["canonical_name"] = canonical_name
        metrics["food_id"] = food_id
        return metrics

    def _html_to_text(self, html: str) -> str:
        cleaned = re.sub(r"<script.*?</script>", " ", html, flags=re.IGNORECASE | re.DOTALL)
        cleaned = re.sub(r"<style.*?</style>", " ", cleaned, flags=re.IGNORECASE | re.DOTALL)
        cleaned = re.sub(r"<[^>]+>", "\n", cleaned)
        return unescape(cleaned)

    def _parse_metrics(self, lines: Sequence[str]) -> Dict[str, Optional[float]]:
        metrics: Dict[str, Optional[float]] = {
            "kcal_per_100g": None,
            "protein_per_100g": None,
            "carbs_per_100g": None,
            "fat_per_100g": None,
            "fiber_per_100g": None,
            "cholesterol_mg_per_100g": None,
            "sodium_mg_per_100g": None,
            "potassium_mg_per_100g": None,
            "calcium_mg_per_100g": None,
            "iron_mg_per_100g": None,
            "magnesium_mg_per_100g": None,
            "zinc_mg_per_100g": None,
            "vitamin_a_rae_mcg_per_100g": None,
            "vitamin_c_mg_per_100g": None,
            "thiamin_mg_per_100g": None,
            "riboflavin_mg_per_100g": None,
            "niacin_mg_per_100g": None,
        }
        mapping = {
            "鑳介噺(Energy)": ("kcal_per_100g", "kJ"),
            "铔嬬櫧璐?Protein)": ("protein_per_100g", "g"),
            "鑴傝偑(Fat)": ("fat_per_100g", "g"),
            "纰虫按鍖栧悎鐗?CHO)": ("carbs_per_100g", "g"),
            "鎬昏喅椋熺氦缁?Dietary fiber)": ("fiber_per_100g", "g"),
            "鑳嗗浐閱?Cholesterol)": ("cholesterol_mg_per_100g", "mg"),
            "閽?Ca)": ("calcium_mg_per_100g", "mg"),
            "閽?K)": ("potassium_mg_per_100g", "mg"),
            "閽?Na)": ("sodium_mg_per_100g", "mg"),
            "闀?Mg)": ("magnesium_mg_per_100g", "mg"),
            "閾?Fe)": ("iron_mg_per_100g", "mg"),
            "閿?Zn)": ("zinc_mg_per_100g", "mg"),
            "纭兒绱?Thiamin)": ("thiamin_mg_per_100g", "mg"),
            "鏍搁粍绱?Riboflavin)": ("riboflavin_mg_per_100g", "mg"),
            "鐑熼吀(Niacin)": ("niacin_mg_per_100g", "mg"),
            "缁寸敓绱燙(Vitamin C)": ("vitamin_c_mg_per_100g", "mg"),
        }
        for line in lines:
            for label, (field_name, unit) in mapping.items():
                if not line.startswith(label):
                    continue
                raw_value = self._extract_measurement(line)
                if raw_value is None:
                    continue
                if field_name == "kcal_per_100g" and unit == "kJ":
                    metrics[field_name] = round(raw_value / 4.184, 2)
                else:
                    metrics[field_name] = raw_value
        for line in lines:
            if line.startswith("缁寸敓绱燗("):
                raw_value = self._extract_measurement(line)
                if raw_value is not None and ("渭g" in line or "ug" in line or "mcg" in line):
                    metrics["vitamin_a_rae_mcg_per_100g"] = raw_value
        return metrics

    def _extract_measurement(self, line: str) -> Optional[float]:
        if "--" in line or "Tr" in line:
            return None
        match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*(kJ|mg|g|渭g|ug|mcg|%)", line)
        if not match:
            return None
        return round(float(match.group(1)), 4)

    def _score_candidate(self, raw_name: str, normalized_name: str, title: str) -> float:
        title_normalized = _normalize_food_name(title)
        if not title_normalized:
            return 0.0
        score = SequenceMatcher(None, normalized_name, title_normalized).ratio()
        if normalized_name in title_normalized or title_normalized in normalized_name:
            score = min(1.0, score + 0.2)
        if raw_name == title:
            score = 1.0
        return round(score, 4)


class AiEstimateProvider:
    def __init__(self, *, model: str, provider: str, timeout_seconds: float) -> None:
        self.model = model
        self.provider = provider.strip().lower()
        self.client = httpx.Client(timeout=timeout_seconds, trust_env=False)

    def close(self) -> None:
        self.client.close()

    def _request_openai_compatible(self, prompt: str, api_key_envs: Sequence[str], default_base_url: str) -> Dict[str, Any]:
        api_key = ""
        for env_name in api_key_envs:
            api_key = os.getenv(env_name, "").strip()
            if api_key:
                break
        if not api_key:
            raise RuntimeError(f"Missing API key, checked: {', '.join(api_key_envs)}")
        try:
            payload = json.dumps(
                {
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                    "stream": False,
                    "temperature": 0.2,
                },
                ensure_ascii=True,
            ).encode("ascii")
        except Exception as exc:
            raise RuntimeError(f"serialize_request_failed: {exc!r}") from exc
        try:
            response = self.client.post(
                f"{default_base_url.rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                content=payload,
            )
        except Exception as exc:
            raise RuntimeError(f"http_request_failed: {exc!r}") from exc
        try:
            response.raise_for_status()
        except Exception as exc:
            body = ""
            try:
                body = response.text[:500]
            except Exception:
                body = "<unavailable>"
            raise RuntimeError(f"http_status_failed: {exc!r}; body={body}") from exc
        try:
            data = response.json()
        except Exception as exc:
            preview = response.text[:500] if response is not None else "<no-response>"
            raise RuntimeError(f"json_decode_failed: {exc!r}; body={preview}") from exc
        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not content:
            raise RuntimeError("AI estimate provider returned empty content")
        content = re.sub(r"```json", "", content)
        content = re.sub(r"```", "", content).strip()
        try:
            return json.loads(content)
        except Exception as exc:
            raise RuntimeError(f"content_json_failed: {exc!r}; content={content[:500]}") from exc

    def _request(self, prompt: str) -> Dict[str, Any]:
        if self.provider == "deepseek":
            return self._request_openai_compatible(
                prompt,
                ["DEEPSEEK_API_KEY"],
                os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
            )
        if self.provider == "dashscope":
            return self._request_openai_compatible(
                prompt,
                ["DASHSCOPE_API_KEY", "API_KEY"],
                os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
            )
        return self._request_openai_compatible(
            prompt,
            ["OFOXAI_API_KEY", "ofox_ai_apikey"],
            os.getenv("OFOXAI_BASE_URL", "https://api.ofoxai.com/v1"),
        )

    def _provider_source_label(self) -> str:
        if self.provider == "deepseek":
            return "AI估算（DeepSeek）"
        if self.provider == "dashscope":
            return "AI估算（通义千问）"
        return "AI估算（OFOX）"

    def resolve(self, raw_name: str, normalized_name: str) -> Optional[ProviderResult]:
        prompt = f"""
你正在帮助构建中文食物营养数据库。

请根据常见中式饮食语境，估计“{raw_name}”每100g可食部分的营养成分。
如果名称较泛，请按最常见、最通用的做法估计。
请只返回 JSON，不要返回任何额外说明：
{{
  "canonical_name": "标准食物名（简体中文）",
  "kcal_per_100g": 0,
  "protein_per_100g": 0,
  "carbs_per_100g": 0,
  "fat_per_100g": 0,
  "fiber_per_100g": 0,
  "sugar_per_100g": 0,
  "saturated_fat_per_100g": 0,
  "cholesterol_mg_per_100g": 0,
  "sodium_mg_per_100g": 0,
  "potassium_mg_per_100g": 0,
  "calcium_mg_per_100g": 0,
  "iron_mg_per_100g": 0,
  "magnesium_mg_per_100g": 0,
  "zinc_mg_per_100g": 0,
  "vitamin_a_rae_mcg_per_100g": 0,
  "vitamin_c_mg_per_100g": 0,
  "vitamin_d_mcg_per_100g": 0,
  "vitamin_e_mg_per_100g": 0,
  "vitamin_k_mcg_per_100g": 0,
  "thiamin_mg_per_100g": 0,
  "riboflavin_mg_per_100g": 0,
  "niacin_mg_per_100g": 0,
  "vitamin_b6_mg_per_100g": 0,
  "folate_mcg_per_100g": 0,
  "vitamin_b12_mcg_per_100g": 0,
  "confidence": 0.0
}}
""".strip()
        try:
            parsed = self._request(prompt)
        except Exception as exc:
            print(f"[enrich_top_missing_foods] ai_estimate_error name={raw_name} error={exc}")
            return None
        canonical_name = _clean_text(parsed.get("canonical_name")) or raw_name
        return ProviderResult(
            provider="ai_estimate",
            canonical_name=canonical_name,
            normalized_name=_normalize_food_name(canonical_name) or normalized_name,
            source=self._provider_source_label(),
            confidence=max(0.0, min(1.0, float(parsed.get("confidence") or 0.6))),
            reference_url=f"ai://estimate?provider={quote_plus(self.provider)}&name={quote_plus(raw_name)}",
            kcal_per_100g=_to_float(parsed.get("kcal_per_100g")),
            protein_per_100g=_to_float(parsed.get("protein_per_100g")),
            carbs_per_100g=_to_float(parsed.get("carbs_per_100g")),
            fat_per_100g=_to_float(parsed.get("fat_per_100g")),
            fiber_per_100g=_to_float(parsed.get("fiber_per_100g")),
            sugar_per_100g=_to_float(parsed.get("sugar_per_100g")),
            saturated_fat_per_100g=_to_float(parsed.get("saturated_fat_per_100g")),
            cholesterol_mg_per_100g=_to_float(parsed.get("cholesterol_mg_per_100g")),
            sodium_mg_per_100g=_to_float(parsed.get("sodium_mg_per_100g")),
            potassium_mg_per_100g=_to_float(parsed.get("potassium_mg_per_100g")),
            calcium_mg_per_100g=_to_float(parsed.get("calcium_mg_per_100g")),
            iron_mg_per_100g=_to_float(parsed.get("iron_mg_per_100g")),
            magnesium_mg_per_100g=_to_float(parsed.get("magnesium_mg_per_100g")),
            zinc_mg_per_100g=_to_float(parsed.get("zinc_mg_per_100g")),
            vitamin_a_rae_mcg_per_100g=_to_float(parsed.get("vitamin_a_rae_mcg_per_100g")),
            vitamin_c_mg_per_100g=_to_float(parsed.get("vitamin_c_mg_per_100g")),
            vitamin_d_mcg_per_100g=_to_float(parsed.get("vitamin_d_mcg_per_100g")),
            vitamin_e_mg_per_100g=_to_float(parsed.get("vitamin_e_mg_per_100g")),
            vitamin_k_mcg_per_100g=_to_float(parsed.get("vitamin_k_mcg_per_100g")),
            thiamin_mg_per_100g=_to_float(parsed.get("thiamin_mg_per_100g")),
            riboflavin_mg_per_100g=_to_float(parsed.get("riboflavin_mg_per_100g")),
            niacin_mg_per_100g=_to_float(parsed.get("niacin_mg_per_100g")),
            vitamin_b6_mg_per_100g=_to_float(parsed.get("vitamin_b6_mg_per_100g")),
            folate_mcg_per_100g=_to_float(parsed.get("folate_mcg_per_100g")),
            vitamin_b12_mcg_per_100g=_to_float(parsed.get("vitamin_b12_mcg_per_100g")),
        )


def _get_top_missing_foods_from_records(
    *,
    top_n: int,
    min_hit_count: int,
    lookback_days: int,
    fetch_page_size: int,
    supabase_retries: int,
    supabase_retry_sleep_seconds: float,
) -> List[UnresolvedFood]:
    supabase = _get_supabase_client()
    since_iso = (datetime.now(timezone.utc) - timedelta(days=max(1, lookback_days))).isoformat()
    aggregated: Dict[str, UnresolvedFood] = {}
    offset = 0
    page_size = max(100, int(fetch_page_size))

    while True:
        query = (
            supabase.table("user_food_records")
            .select("record_time, items")
            .gte("record_time", since_iso)
            .order("record_time", desc=True)
            .range(offset, offset + page_size - 1)
        )
        rows = list(
            _execute_supabase_request(
                query,
                action=f"get_user_food_records_page_{offset // page_size + 1}",
                max_retries=supabase_retries,
                retry_sleep_seconds=supabase_retry_sleep_seconds,
            ).data
            or []
        )
        if not rows:
            break

        for row in rows:
            record_time = str(row.get("record_time") or "")
            items = row.get("items") or []
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                raw_name = _clean_text(item.get("name"))
                normalized_name = _normalize_food_name(raw_name)
                if not raw_name or not normalized_name:
                    continue
                existing = aggregated.get(normalized_name)
                if existing is None:
                    aggregated[normalized_name] = UnresolvedFood(
                        raw_name=raw_name,
                        normalized_name=normalized_name,
                        hit_count=1,
                        last_seen_at=record_time,
                        sample_payload=item,
                    )
                    continue
                existing.hit_count += 1
                if len(raw_name) < len(existing.raw_name):
                    existing.raw_name = raw_name
                if record_time > existing.last_seen_at:
                    existing.last_seen_at = record_time
                    existing.sample_payload = item

        if len(rows) < page_size:
            break
        offset += page_size

    results = [row for row in aggregated.values() if row.hit_count >= max(1, min_hit_count)]
    results.sort(key=lambda item: (-item.hit_count, item.raw_name))
    return results


def _filter_still_missing_foods(
    foods: Sequence[UnresolvedFood],
    *,
    batch_size: int,
    supabase_retries: int,
    supabase_retry_sleep_seconds: float,
    supabase_chunk_sleep_seconds: float,
) -> List[UnresolvedFood]:
    if not foods:
        return []
    supabase = _get_supabase_client()
    normalized_names = sorted({food.normalized_name for food in foods if food.normalized_name})
    covered: set[str] = set()
    for index, chunk in enumerate(_chunked(normalized_names, batch_size), start=1):
        lib_resp = _execute_supabase_request(
            supabase.table("food_nutrition_library")
            .select("normalized_name")
            .in_("normalized_name", list(chunk))
            .eq("is_active", True),
            action=f"filter_still_missing_library_batch_{index}",
            max_retries=supabase_retries,
            retry_sleep_seconds=supabase_retry_sleep_seconds,
        )
        alias_resp = _execute_supabase_request(
            supabase.table("food_nutrition_aliases")
            .select("normalized_alias")
            .in_("normalized_alias", list(chunk)),
            action=f"filter_still_missing_alias_batch_{index}",
            max_retries=supabase_retries,
            retry_sleep_seconds=supabase_retry_sleep_seconds,
        )
        for row in list(lib_resp.data or []):
            value = _clean_text(row.get("normalized_name"))
            if value:
                covered.add(value)
        for row in list(alias_resp.data or []):
            value = _clean_text(row.get("normalized_alias"))
            if value:
                covered.add(value)
        _sleep(supabase_chunk_sleep_seconds, f"after still-missing batch {index}")
    filtered = [food for food in foods if food.normalized_name not in covered]
    skipped = len(foods) - len(filtered)
    if skipped:
        print(f"[enrich_top_missing_foods] skipped_already_covered_foods={skipped}")
    return filtered


def _filter_low_quality_unresolved_foods(foods: Sequence[UnresolvedFood]) -> List[UnresolvedFood]:
    filtered: List[UnresolvedFood] = []
    skipped = 0
    for food in foods:
        if not _is_likely_single_food_name(food.raw_name):
            skipped += 1
            continue
        filtered.append(food)
    if skipped:
        print(f"[enrich_top_missing_foods] skipped_low_quality_candidates={skipped}")
    return filtered


def _expand_and_aggregate_unresolved_foods(foods: Sequence[UnresolvedFood]) -> List[UnresolvedFood]:
    aggregated: Dict[str, UnresolvedFood] = {}
    expanded_count = 0
    for food in foods:
        parts = _split_unresolved_food_name(food.raw_name)
        if not parts:
            continue
        if len(parts) > 1 or parts[0] != food.raw_name:
            expanded_count += 1
        for part in parts:
            if not _is_likely_single_food_name(part):
                continue
            normalized_name = _normalize_food_name(part)
            if not normalized_name:
                continue
            existing = aggregated.get(normalized_name)
            if existing is None:
                aggregated[normalized_name] = UnresolvedFood(
                    raw_name=part,
                    normalized_name=normalized_name,
                    hit_count=food.hit_count,
                    last_seen_at=food.last_seen_at,
                    sample_payload=food.sample_payload,
                )
                continue
            existing.hit_count += food.hit_count
            if len(part) < len(existing.raw_name):
                existing.raw_name = part
            if food.last_seen_at > existing.last_seen_at:
                existing.last_seen_at = food.last_seen_at
                existing.sample_payload = food.sample_payload
    if expanded_count:
        print(f"[enrich_top_missing_foods] expanded_composite_candidates={expanded_count}")
    rows = list(aggregated.values())
    rows.sort(key=lambda item: (-item.hit_count, item.raw_name))
    return rows


def _find_library_food_by_normalized_name(
    normalized_name: str,
    *,
    supabase_retries: int,
    supabase_retry_sleep_seconds: float,
) -> Optional[Dict[str, Any]]:
    supabase = _get_supabase_client()
    resp = _execute_supabase_request(
        supabase.table("food_nutrition_library")
        .select("id, canonical_name, normalized_name")
        .eq("normalized_name", normalized_name)
        .eq("is_active", True)
        .limit(1),
        action=f"find_library_food_{normalized_name}",
        max_retries=supabase_retries,
        retry_sleep_seconds=supabase_retry_sleep_seconds,
    )
    rows = list(resp.data or [])
    return rows[0] if rows else None


def _insert_library_food(
    provider_result: ProviderResult,
    *,
    supabase_retries: int,
    supabase_retry_sleep_seconds: float,
) -> str:
    supabase = _get_supabase_client()
    payload = {
        "canonical_name": provider_result.canonical_name,
        "normalized_name": provider_result.normalized_name,
        "source": provider_result.source,
    }
    optional_fields = [
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
    for field_name in optional_fields:
        value = getattr(provider_result, field_name)
        if value is not None:
            payload[field_name] = value
    try:
        resp = _execute_supabase_request(
            supabase.table("food_nutrition_library").insert(payload),
            action=f"insert_library_food_{provider_result.normalized_name}",
            max_retries=supabase_retries,
            retry_sleep_seconds=supabase_retry_sleep_seconds,
        )
    except RuntimeError as exc:
        # A transient disconnect after a successful insert can surface as a retry,
        # then hit the unique constraint on normalized_name on the next attempt.
        if "duplicate key value violates unique constraint" in str(exc):
            existing = _find_library_food_by_normalized_name(
                provider_result.normalized_name,
                supabase_retries=supabase_retries,
                supabase_retry_sleep_seconds=supabase_retry_sleep_seconds,
            )
            if existing:
                return str(existing.get("id") or "")
        raise
    rows = list(resp.data or [])
    if not rows:
        existing = _find_library_food_by_normalized_name(
            provider_result.normalized_name,
            supabase_retries=supabase_retries,
            supabase_retry_sleep_seconds=supabase_retry_sleep_seconds,
        )
        if existing:
            return str(existing.get("id") or "")
        raise RuntimeError(f"Unable to insert library food: {provider_result.canonical_name}")
    return str(rows[0].get("id") or "")


def _upsert_alias(
    *,
    food_id: str,
    alias_name: str,
    supabase_retries: int,
    supabase_retry_sleep_seconds: float,
) -> None:
    normalized_alias = _normalize_food_name(alias_name)
    if not food_id or not alias_name or not normalized_alias:
        return
    supabase = _get_supabase_client()
    payload = {
        "food_id": food_id,
        "alias_name": alias_name,
        "normalized_alias": normalized_alias,
    }
    _execute_supabase_request(
        supabase.table("food_nutrition_aliases").upsert(
            payload,
            on_conflict="normalized_alias",
            ignore_duplicates=True,
        ),
        action=f"upsert_alias_{normalized_alias}",
        max_retries=supabase_retries,
        retry_sleep_seconds=supabase_retry_sleep_seconds,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill top missing foods from historical records")
    parser.add_argument("--top-n", type=int, default=10000, help="How many missing food names to process")
    parser.add_argument("--min-hit-count", type=int, default=1, help="Minimum historical hit count")
    parser.add_argument("--lookback-days", type=int, default=3650, help="Only consider unresolved foods seen in the last N days")
    parser.add_argument("--record-page-size", type=int, default=1000, help="How many user_food_records rows to fetch per page")
    parser.add_argument("--providers", nargs="+", default=["heuristic", "history", "ai"], help="Provider order, supports: heuristic, history, ai, nlc")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, do not write to Supabase")
    parser.add_argument("--json-output", default="", help="Optional preview JSON output path")
    parser.add_argument("--timeout-seconds", type=float, default=30.0, help="HTTP timeout for external requests")
    parser.add_argument("--search-sleep-seconds", type=float, default=0.5, help="Pause between search requests")
    parser.add_argument("--supabase-batch-size", type=int, default=50, help="Batch size for Supabase lookups")
    parser.add_argument("--supabase-retries", type=int, default=3, help="Retries for Supabase requests")
    parser.add_argument("--supabase-retry-sleep-seconds", type=float, default=1.0, help="Base retry sleep for Supabase requests")
    parser.add_argument("--supabase-chunk-sleep-seconds", type=float, default=0.3, help="Pause between Supabase read batches")
    parser.add_argument("--history-lookback-days", type=int, default=3650, help="Lookback days for historical nutrition averaging")
    parser.add_argument("--history-min-samples", type=int, default=1, help="Minimum historical samples before using historical average")
    parser.add_argument("--history-min-total-weight-g", type=float, default=100.0, help="Minimum total historical weight before using historical average")
    parser.add_argument("--ai-provider", choices=["deepseek", "dashscope", "ofox"], default=os.getenv("AI_ESTIMATE_PROVIDER", "deepseek"), help="AI provider for fallback estimation")
    parser.add_argument("--ai-model", default=os.getenv("AI_ESTIMATE_MODEL") or "deepseek-chat", help="AI model for fallback estimation")
    return parser.parse_args()


def main() -> int:
    _load_env()
    args = parse_args()

    unresolved = _get_top_missing_foods_from_records(
        top_n=max(1, int(args.top_n)),
        min_hit_count=max(1, int(args.min_hit_count)),
        lookback_days=max(1, int(args.lookback_days)),
        fetch_page_size=max(100, int(args.record_page_size)),
        supabase_retries=max(0, int(args.supabase_retries)),
        supabase_retry_sleep_seconds=max(0.0, float(args.supabase_retry_sleep_seconds)),
    )
    unresolved = _expand_and_aggregate_unresolved_foods(unresolved)
    unresolved = _filter_still_missing_foods(
        unresolved,
        batch_size=max(1, int(args.supabase_batch_size)),
        supabase_retries=max(0, int(args.supabase_retries)),
        supabase_retry_sleep_seconds=max(0.0, float(args.supabase_retry_sleep_seconds)),
        supabase_chunk_sleep_seconds=max(0.0, float(args.supabase_chunk_sleep_seconds)),
    )
    unresolved = _filter_low_quality_unresolved_foods(unresolved)
    unresolved.sort(key=lambda item: (-item.hit_count, item.raw_name))
    unresolved = unresolved[: max(1, int(args.top_n))]
    print(f"[enrich_top_missing_foods] unresolved_candidates={len(unresolved)}")
    if not unresolved:
        return 0

    history_stats: Optional[Dict[str, HistoricalNutritionAggregate]] = None
    providers: List[Any] = []
    for provider_name in args.providers:
        if provider_name == "heuristic":
            providers.append(HeuristicAliasProvider())
        elif provider_name == "history":
            if history_stats is None:
                history_stats = _build_historical_nutrition_stats(
                    lookback_days=max(1, int(args.history_lookback_days)),
                    fetch_page_size=max(100, int(args.record_page_size)),
                    min_samples=max(1, int(args.history_min_samples)),
                    min_total_weight_g=max(1.0, float(args.history_min_total_weight_g)),
                    supabase_retries=max(0, int(args.supabase_retries)),
                    supabase_retry_sleep_seconds=max(0.0, float(args.supabase_retry_sleep_seconds)),
                )
                print(f"[enrich_top_missing_foods] historical_nutrition_stats={len(history_stats)}")
            providers.append(HistoricalAverageProvider(history_stats))
        elif provider_name == "ai":
            providers.append(
                AiEstimateProvider(
                    model=str(args.ai_model),
                    provider=str(args.ai_provider),
                    timeout_seconds=max(5.0, float(args.timeout_seconds)),
                )
            )
        elif provider_name == "nlc":
            providers.append(
                NlcSearchProvider(
                    timeout_seconds=max(5.0, float(args.timeout_seconds)),
                    search_sleep_seconds=max(0.0, float(args.search_sleep_seconds)),
                )
            )
        else:
            raise ValueError(f"Unsupported provider: {provider_name}")

    enriched: List[Dict[str, Any]] = []
    inserted_foods = 0
    inserted_aliases = 0

    try:
        for index, item in enumerate(unresolved, start=1):
            print(
                f"[enrich_top_missing_foods] resolving {index}/{len(unresolved)} "
                f"name={item.raw_name} hits={item.hit_count}"
            )
            matched: Optional[ProviderResult] = None
            for provider in providers:
                matched = provider.resolve(item.raw_name, item.normalized_name)
                if matched:
                    break
            if not matched:
                enriched.append(
                    {
                        "raw_name": item.raw_name,
                        "normalized_name": item.normalized_name,
                        "hit_count": item.hit_count,
                        "status": "not_found",
                    }
                )
                continue

            canonical_existing = _find_library_food_by_normalized_name(
                matched.normalized_name,
                supabase_retries=max(0, int(args.supabase_retries)),
                supabase_retry_sleep_seconds=max(0.0, float(args.supabase_retry_sleep_seconds)),
            )
            food_id = str(canonical_existing.get("id") or "") if canonical_existing else ""
            action = "reuse_existing_food"
            if not food_id and not args.dry_run:
                food_id = _insert_library_food(
                    matched,
                    supabase_retries=max(0, int(args.supabase_retries)),
                    supabase_retry_sleep_seconds=max(0.0, float(args.supabase_retry_sleep_seconds)),
                )
                inserted_foods += 1
                action = "insert_library_food"

            if not args.dry_run and food_id:
                _upsert_alias(
                    food_id=food_id,
                    alias_name=item.raw_name,
                    supabase_retries=max(0, int(args.supabase_retries)),
                    supabase_retry_sleep_seconds=max(0.0, float(args.supabase_retry_sleep_seconds)),
                )
                inserted_aliases += 1
                if _normalize_food_name(matched.canonical_name) != item.normalized_name:
                    _upsert_alias(
                        food_id=food_id,
                        alias_name=matched.canonical_name,
                        supabase_retries=max(0, int(args.supabase_retries)),
                        supabase_retry_sleep_seconds=max(0.0, float(args.supabase_retry_sleep_seconds)),
                    )

            enriched.append(
                {
                    "raw_name": item.raw_name,
                    "normalized_name": item.normalized_name,
                    "hit_count": item.hit_count,
                    "status": action if not args.dry_run else "matched_preview",
                    "provider": matched.provider,
                    "confidence": matched.confidence,
                    "canonical_name": matched.canonical_name,
                    "reference_url": matched.reference_url,
                    "source": matched.source,
                    "source_display": _source_display(matched.source),
                    "food_id": food_id,
                    "nutrients": asdict(matched),
                }
            )
    finally:
        for provider in providers:
            if hasattr(provider, "close"):
                provider.close()

    matched_count = sum(1 for row in enriched if row["status"] != "not_found")
    print(
        f"[enrich_top_missing_foods] matched={matched_count} "
        f"inserted_foods={inserted_foods} inserted_aliases={inserted_aliases}"
    )

    if args.json_output:
        output_path = Path(args.json_output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(enriched, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[enrich_top_missing_foods] wrote_json={args.json_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
