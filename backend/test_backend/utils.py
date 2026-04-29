"""
测试后台工具函数
"""
import asyncio
from difflib import SequenceMatcher
from functools import lru_cache
import json
import os
import re
from typing import Dict, List, Tuple, Any, Optional

import httpx


def calculate_deviation(estimated_weight: float, true_weight: float) -> float:
    """
    计算偏差百分比
    
    Args:
        estimated_weight: 模型估算的重量（克）
        true_weight: 真实重量（克）
    
    Returns:
        偏差百分比（0-100之间的浮点数，保留2位小数）
    """
    if true_weight == 0:
        return 0.0 if estimated_weight == 0 else 100.0
    deviation = abs(estimated_weight - true_weight) / true_weight * 100
    return round(deviation, 2)


def normalize_food_name(name: Any) -> str:
    """Normalize a food name for loose label/result matching."""
    return re.sub(r"\s+", "", str(name or "")).strip().lower()


TOTAL_LABEL_MODE = "total"
ITEMS_LABEL_MODE = "items"
TOTAL_LABEL_NAMES = {
    "总重量",
    "总重",
    "整餐总重量",
    "整张总重量",
    "合计",
    "total",
    "totalweight",
    "total_weight",
    "sum",
}


def _normalize_label_name(name: Any) -> str:
    return re.sub(r"[\s_\-]+", "", str(name or "")).strip().lower()


def _is_total_label_item(item: Dict[str, Any]) -> bool:
    return _normalize_label_name(item.get("name")) in {
        _normalize_label_name(name)
        for name in TOTAL_LABEL_NAMES
    }


def _infer_label_mode(items: List[Dict[str, Any]], label_mode: Optional[str] = None) -> str:
    raw_mode = str(label_mode or "").strip().lower()
    if raw_mode in {TOTAL_LABEL_MODE, "summary", "overall", "total_only"}:
        return TOTAL_LABEL_MODE
    if raw_mode in {ITEMS_LABEL_MODE, "item", "itemized", "per_item"}:
        return ITEMS_LABEL_MODE
    if len(items) == 1 and _is_total_label_item(items[0]):
        return TOTAL_LABEL_MODE
    return ITEMS_LABEL_MODE


def _parse_weight_value(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    match = re.match(r"^(\d+(?:\.\d+)?)\s*(?:g|克|G)?$", text)
    if not match:
        return None
    return float(match.group(1))


def normalize_expected_items(items: Any, fallback_total: Optional[float] = None) -> List[Dict[str, Any]]:
    """Normalize label items into [{name, trueWeightGrams}]."""
    normalized: List[Dict[str, Any]] = []
    if isinstance(items, dict):
        items = [
            {"name": name, "weight": weight}
            for name, weight in items.items()
        ]
    if isinstance(items, list):
        for index, item in enumerate(items):
            if isinstance(item, dict):
                name = str(item.get("name") or item.get("food") or item.get("title") or "").strip()
                weight = _parse_weight_value(
                    item.get("trueWeightGrams")
                    or item.get("weight")
                    or item.get("weightGrams")
                    or item.get("grams")
                )
            else:
                name = ""
                weight = None
            if weight is None:
                continue
            normalized.append({
                "name": name or f"食物{index + 1}",
                "trueWeightGrams": round(weight, 1),
            })
    if not normalized and fallback_total is not None:
        normalized.append({"name": "总重量", "trueWeightGrams": round(float(fallback_total), 1)})
    return normalized


def _label_from_items(filename: str, items: List[Dict[str, Any]], label_mode: Optional[str] = None) -> Dict[str, Any]:
    total = round(sum(float(item.get("trueWeightGrams") or 0) for item in items), 1)
    mode = _infer_label_mode(items, label_mode)
    if mode == TOTAL_LABEL_MODE:
        items = [{"name": "总重量", "trueWeightGrams": total}]
    return {
        "filename": filename,
        "labelMode": mode,
        "trueWeight": total,
        "expectedItems": items,
    }


def _parse_items_inline(items_text: str) -> List[Dict[str, Any]]:
    items = []
    parts = [part.strip() for part in re.split(r"[;；]", items_text or "") if part.strip()]
    for index, part in enumerate(parts):
        match = re.match(r"^(.+?)[=:：]\s*(\d+(?:\.\d+)?)\s*(?:g|克|G)?$", part)
        if not match:
            raise ValueError(f"食物标签格式错误：'{part}'，应为 '食物名=重量g'")
        items.append({
            "name": match.group(1).strip() or f"食物{index + 1}",
            "trueWeightGrams": round(float(match.group(2)), 1),
        })
    return items


def parse_labels_file(content: str) -> Dict[str, Dict[str, Any]]:
    """
    解析标签文件内容
    
    标签文件格式（推荐）：
        bento.jpg | 米饭=120g; 鸡胸肉=80g; 西兰花=60g

    兼容旧格式：
        apple.jpg 50g

    也支持 JSON：
        {"samples":[{"filename":"bento.jpg","items":[{"name":"米饭","weight":120}]}]}
    
    Args:
        content: 标签文件的文本内容
    
    Returns:
        字典，键为图片文件名，值为标准标签对象
    
    Raises:
        ValueError: 当标签格式无效时
    """
    labels: Dict[str, Dict[str, Any]] = {}
    raw_content = (content or "").strip()
    if not raw_content:
        return labels

    if raw_content[0] in "[{":
        import json

        try:
            payload = json.loads(raw_content)
        except json.JSONDecodeError as exc:
            raise ValueError(f"labels JSON 格式错误：{exc}") from exc
        if isinstance(payload, dict):
            samples = payload.get("samples")
            if not isinstance(samples, list):
                samples = [
                    {"filename": filename, "items": items}
                    for filename, items in payload.items()
                    if filename != "samples"
                ]
        elif isinstance(payload, list):
            samples = payload
        else:
            raise ValueError("labels JSON 必须是对象或数组")
        for index, sample in enumerate(samples, 1):
            if not isinstance(sample, dict):
                raise ValueError(f"第 {index} 个 JSON 样本格式错误")
            filename = str(sample.get("filename") or sample.get("image") or sample.get("name") or "").strip()
            if not filename:
                raise ValueError(f"第 {index} 个 JSON 样本缺少 filename")
            total = _parse_weight_value(
                sample.get("trueWeight")
                or sample.get("totalWeight")
                or sample.get("totalWeightGrams")
                or sample.get("weight")
            )
            items = normalize_expected_items(sample.get("items"), fallback_total=total)
            if not items:
                raise ValueError(f"{filename} 缺少有效食物克重标签")
            labels[filename] = _label_from_items(
                filename,
                items,
                label_mode=sample.get("labelMode") or sample.get("mode"),
            )
        return labels

    lines = raw_content.split('\n')
    
    for line_num, line in enumerate(lines, 1):
        line = line.strip().lstrip("\ufeff")
        if not line:
            continue
        
        if "|" in line:
            filename, items_text = [part.strip() for part in line.split("|", 1)]
            if not filename or not items_text:
                raise ValueError(f"第 {line_num} 行格式错误：'{line}'")
            items = _parse_items_inline(items_text)
            labels[filename] = _label_from_items(filename, items)
            continue

        # 旧格式：支持多种分隔符：空格、制表符
        parts = re.split(r'\s+', line)
        
        if len(parts) < 2:
            raise ValueError(f"第 {line_num} 行格式错误：'{line}'，应为 '文件名 重量g'")
        
        # 从最后一个部分取重量（处理文件名包含空格的情况）
        weight_str = parts[-1]
        # 文件名是除最后一个部分外的所有部分重新拼接
        filename = ' '.join(parts[:-1])
        
        weight = _parse_weight_value(weight_str)
        if weight is None:
            raise ValueError(f"第 {line_num} 行重量格式错误：'{weight_str}'，应为数字或数字g")

        labels[filename] = _label_from_items(
            filename,
            normalize_expected_items(None, fallback_total=weight),
            label_mode=TOTAL_LABEL_MODE,
        )
    
    return labels


def extract_total_weight(items: List[Dict[str, Any]]) -> float:
    """
    从模型分析结果中提取总重量
    
    Args:
        items: 模型返回的食物列表
    
    Returns:
        所有食物的总重量（克）
    """
    total = 0.0
    if isinstance(items, list):
        for item in items:
            weight = item.get("estimatedWeightGrams", 0) or 0
            total += float(weight)
    return round(total, 1)


BENCHMARK_VERSION = "food_weight_v2"
MIN_FOOD_MATCH_SCORE = 0.5
RELATIVE_ERROR_FLOOR_GRAMS = 50.0
RELATIVE_ERROR_CLIP_RATIO = 1.0
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_EVAL_MODEL", "deepseek-v4-flash")
DEEPSEEK_TIMEOUT_SECONDS = float(os.getenv("DEEPSEEK_EVAL_TIMEOUT_SECONDS", "45"))
DEEPSEEK_REASONING_EFFORT = os.getenv("DEEPSEEK_EVAL_REASONING_EFFORT", "medium").strip() or "medium"
COMMON_COOKING_PREFIXES = (
    "清炒",
    "小炒",
    "爆炒",
    "酱爆",
    "红烧",
    "清蒸",
    "白灼",
    "凉拌",
    "干煸",
    "炖",
    "焖",
    "煮",
    "蒸",
    "炒",
    "煎",
    "炸",
    "烤",
    "卤",
    "焗",
    "煲",
    "拌",
    "烧",
)
MIXED_DISH_HINT_TOKENS = (
    "含",
    "配",
    "拼盘",
    "套餐",
    "盖饭",
    "炒饭",
    "拌饭",
    "焗饭",
    "便当",
    "沙拉",
    "汤面",
    "炒面",
    "焖面",
    "意面",
    "披萨",
    "汉堡",
    "三明治",
)


def _round_ratio(value: Optional[float], digits: int = 4) -> Optional[float]:
    if value is None:
        return None
    return round(float(value), digits)


def _ratio_to_percent(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    return round(float(value) * 100, 2)


def _strip_parenthetical(text: str) -> str:
    return re.sub(r"[（(][^()（）]*[)）]", "", text or "")


def _normalize_food_variant(text: str) -> str:
    text = str(text or "").strip().lower()
    text = re.sub(r"[^\w\u4e00-\u9fff]+", "", text)
    return text


def _strip_common_cooking_prefix(text: str) -> str:
    normalized = _normalize_food_variant(text)
    if not normalized:
        return ""

    changed = True
    while changed:
        changed = False
        for prefix in COMMON_COOKING_PREFIXES:
            if normalized.startswith(prefix) and len(normalized) - len(prefix) >= 2:
                normalized = normalized[len(prefix):]
                changed = True
                break
    return normalized


def _build_food_name_variants(name: Any) -> List[str]:
    raw = str(name or "").strip()
    if not raw:
        return []

    candidates = {
        raw,
        _strip_parenthetical(raw),
    }
    variants = set()
    for candidate in candidates:
        normalized = _normalize_food_variant(candidate)
        if normalized:
            variants.add(normalized)
        if "含" in candidate:
            head = _normalize_food_variant(candidate.split("含", 1)[0])
            if len(head) >= 2:
                variants.add(head)
    return sorted(variants, key=len, reverse=True)


def _build_food_name_hint_variants(name: Any) -> List[str]:
    variants = set(_build_food_name_variants(name))
    extra_variants = set()
    for variant in variants:
        stripped = _strip_common_cooking_prefix(variant)
        if len(stripped) >= 2:
            extra_variants.add(stripped)
    variants.update(extra_variants)
    return sorted(variants, key=len, reverse=True)


def _coerce_bool_or_none(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in {"true", "1", "yes"}:
        return True
    if text in {"false", "0", "no"}:
        return False
    return None


def _coerce_int_or_none(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _coerce_confidence_or_none(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0:
        parsed = 0.0
    if parsed > 1:
        parsed = 1.0
    return round(parsed, 4)


def _infer_item_is_mixed_dish(name: Any) -> bool:
    raw = str(name or "").strip()
    if not raw:
        return False
    normalized = _normalize_food_variant(raw)
    if not normalized:
        return False
    if any(token in raw for token in {"（", "(", "含", "+", "/", "、"}):
        return True
    return any(token in normalized for token in MIXED_DISH_HINT_TOKENS)


def _score_food_name_match(expected_name: Any, predicted_name: Any) -> Dict[str, Any]:
    expected_variants = _build_food_name_variants(expected_name)
    predicted_variants = _build_food_name_variants(predicted_name)
    best = {
        "score": 0.0,
        "matchType": "none",
        "expectedVariant": None,
        "predictedVariant": None,
    }
    if not expected_variants or not predicted_variants:
        return best

    for expected_variant in expected_variants:
        for predicted_variant in predicted_variants:
            if expected_variant == predicted_variant:
                candidate = {
                    "score": 1.0,
                    "matchType": "exact",
                    "expectedVariant": expected_variant,
                    "predictedVariant": predicted_variant,
                }
            elif expected_variant in predicted_variant or predicted_variant in expected_variant:
                candidate = {
                    "score": 0.92,
                    "matchType": "contain",
                    "expectedVariant": expected_variant,
                    "predictedVariant": predicted_variant,
                }
            else:
                char_union = set(expected_variant) | set(predicted_variant)
                char_overlap = (
                    len(set(expected_variant) & set(predicted_variant)) / max(len(char_union), 1)
                )
                sequence_ratio = SequenceMatcher(None, expected_variant, predicted_variant).ratio()
                overlap = max(char_overlap, sequence_ratio)
                if overlap >= 0.82:
                    candidate = {
                        "score": 0.82,
                        "matchType": "close_equivalent",
                        "expectedVariant": expected_variant,
                        "predictedVariant": predicted_variant,
                    }
                elif overlap >= 0.65:
                    candidate = {
                        "score": 0.68,
                        "matchType": "fuzzy",
                        "expectedVariant": expected_variant,
                        "predictedVariant": predicted_variant,
                    }
                else:
                    continue

            current_key = (candidate["score"], len(candidate["expectedVariant"] or ""), len(candidate["predictedVariant"] or ""))
            best_key = (best["score"], len(best["expectedVariant"] or ""), len(best["predictedVariant"] or ""))
            if current_key > best_key:
                best = candidate

    return best


def _score_food_name_candidate_hint(expected_name: Any, predicted_name: Any) -> Dict[str, Any]:
    expected_variants = _build_food_name_hint_variants(expected_name)
    predicted_variants = _build_food_name_hint_variants(predicted_name)
    best = {
        "score": 0.0,
        "matchType": "none",
        "expectedVariant": None,
        "predictedVariant": None,
    }
    if not expected_variants or not predicted_variants:
        return best

    for expected_variant in expected_variants:
        for predicted_variant in predicted_variants:
            if expected_variant == predicted_variant:
                candidate = {
                    "score": 0.78,
                    "matchType": "wrong_food",
                    "expectedVariant": expected_variant,
                    "predictedVariant": predicted_variant,
                }
            elif expected_variant in predicted_variant or predicted_variant in expected_variant:
                candidate = {
                    "score": 0.72,
                    "matchType": "wrong_food",
                    "expectedVariant": expected_variant,
                    "predictedVariant": predicted_variant,
                }
            else:
                char_union = set(expected_variant) | set(predicted_variant)
                char_overlap = (
                    len(set(expected_variant) & set(predicted_variant)) / max(len(char_union), 1)
                )
                sequence_ratio = SequenceMatcher(None, expected_variant, predicted_variant).ratio()
                overlap = max(char_overlap, sequence_ratio)
                if overlap >= 0.58:
                    candidate = {
                        "score": round(overlap, 4),
                        "matchType": "wrong_food",
                        "expectedVariant": expected_variant,
                        "predictedVariant": predicted_variant,
                    }
                else:
                    continue

            current_key = (
                candidate["score"],
                len(candidate["expectedVariant"] or ""),
                len(candidate["predictedVariant"] or ""),
            )
            best_key = (
                best["score"],
                len(best["expectedVariant"] or ""),
                len(best["predictedVariant"] or ""),
            )
            if current_key > best_key:
                best = candidate

    return best


def _calculate_weight_error_metrics(
    true_weight: float,
    predicted_weight: Optional[float],
) -> Dict[str, Optional[float]]:
    if predicted_weight is None:
        return {
            "absoluteErrorGrams": None,
            "relativeError": None,
            "relativeErrorPercent": None,
            "normalizedRelativeError": None,
            "normalizedRelativeErrorPercent": None,
            "clippedRelativeError": None,
            "clippedRelativeErrorPercent": None,
            "deviation": None,
        }

    absolute_error = abs(float(predicted_weight) - float(true_weight))
    if true_weight > 0:
        relative_error = absolute_error / true_weight
    else:
        relative_error = 0.0 if absolute_error == 0 else 1.0
    normalized_relative_error = absolute_error / max(float(true_weight), RELATIVE_ERROR_FLOOR_GRAMS)
    clipped_relative_error = min(normalized_relative_error, RELATIVE_ERROR_CLIP_RATIO)
    deviation = calculate_deviation(float(predicted_weight), float(true_weight))
    return {
        "absoluteErrorGrams": round(absolute_error, 2),
        "relativeError": _round_ratio(relative_error),
        "relativeErrorPercent": _ratio_to_percent(relative_error),
        "normalizedRelativeError": _round_ratio(normalized_relative_error),
        "normalizedRelativeErrorPercent": _ratio_to_percent(normalized_relative_error),
        "clippedRelativeError": _round_ratio(clipped_relative_error),
        "clippedRelativeErrorPercent": _ratio_to_percent(clipped_relative_error),
        "deviation": deviation,
    }


def _build_food_match_candidates(
    expected: List[Dict[str, Any]],
    predicted: List[Dict[str, Any]],
) -> List[List[Dict[str, Any]]]:
    candidates: List[List[Dict[str, Any]]] = []
    for expected_item in expected:
        expected_weight = float(expected_item.get("trueWeightGrams") or 0)
        row: List[Dict[str, Any]] = []
        for predicted_index, predicted_item in enumerate(predicted):
            match_info = _score_food_name_match(
                expected_item.get("name"),
                predicted_item.get("name"),
            )
            predicted_weight = float(predicted_item.get("estimatedWeightGrams") or 0)
            weight_metrics = _calculate_weight_error_metrics(expected_weight, predicted_weight)
            row.append({
                "predictedIndex": predicted_index,
                "score": match_info["score"],
                "matchType": match_info["matchType"],
                "expectedVariant": match_info["expectedVariant"],
                "predictedVariant": match_info["predictedVariant"],
                "weightBonus": 1.0 - float(weight_metrics["clippedRelativeError"] or 0.0),
            })
        candidates.append(row)
    return candidates


def _solve_food_matching(
    expected: List[Dict[str, Any]],
    predicted: List[Dict[str, Any]],
) -> List[Optional[Dict[str, Any]]]:
    if not expected or not predicted:
        return [None for _ in expected]

    candidates = _build_food_match_candidates(expected, predicted)
    predicted_count = len(predicted)

    if predicted_count <= 15:
        @lru_cache(maxsize=None)
        def dp(expected_index: int, used_mask: int) -> tuple[int, float, float, tuple[Optional[int], ...]]:
            if expected_index >= len(expected):
                return (0, 0.0, 0.0, tuple())

            skipped = dp(expected_index + 1, used_mask)
            best = (skipped[0], skipped[1], skipped[2], (None,) + skipped[3])

            for candidate in candidates[expected_index]:
                predicted_index = candidate["predictedIndex"]
                if candidate["score"] < MIN_FOOD_MATCH_SCORE:
                    continue
                if used_mask & (1 << predicted_index):
                    continue
                matched = dp(expected_index + 1, used_mask | (1 << predicted_index))
                proposal = (
                    matched[0] + 1,
                    matched[1] + float(candidate["score"]),
                    matched[2] + float(candidate["weightBonus"]),
                    (predicted_index,) + matched[3],
                )
                if proposal[:3] > best[:3]:
                    best = proposal

            return best

        assignment_indexes = dp(0, 0)[3]
        return [
            None if predicted_index is None else candidates[expected_index][predicted_index]
            for expected_index, predicted_index in enumerate(assignment_indexes)
        ]

    assignments: List[Optional[Dict[str, Any]]] = [None for _ in expected]
    used_prediction_indexes = set()
    for expected_index, row in enumerate(candidates):
        ranked = sorted(
            row,
            key=lambda candidate: (candidate["score"], candidate["weightBonus"]),
            reverse=True,
        )
        for candidate in ranked:
            predicted_index = candidate["predictedIndex"]
            if candidate["score"] < MIN_FOOD_MATCH_SCORE or predicted_index in used_prediction_indexes:
                continue
            used_prediction_indexes.add(predicted_index)
            assignments[expected_index] = candidate
            break
    return assignments


def _extract_json_object_loose(raw_text: str) -> Dict[str, Any]:
    text = str(raw_text or "").strip()
    if not text:
        raise ValueError("DeepSeek evaluator 返回为空")
    fenced_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.S)
    if fenced_match:
        text = fenced_match.group(1).strip()
    else:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start:end + 1]
    return json.loads(text)


def _serialize_items_for_evaluator(items: List[Dict[str, Any]], weight_key: str) -> List[Dict[str, Any]]:
    serialized = []
    for index, item in enumerate(items):
        explicit_mixed = _coerce_bool_or_none(item.get("isMixedDish"))
        serialized.append({
            "index": index,
            "name": str(item.get("name") or "").strip(),
            "weight_grams": round(float(item.get(weight_key) or 0), 1),
            "is_mixed_dish": explicit_mixed if explicit_mixed is not None else _infer_item_is_mixed_dish(item.get("name")),
            "count": _coerce_int_or_none(item.get("count")),
            "confidence": _coerce_confidence_or_none(item.get("confidence")),
        })
    return serialized


def _build_local_match_assignments(
    expected: List[Dict[str, Any]],
    predicted: List[Dict[str, Any]],
) -> List[Optional[Dict[str, Any]]]:
    raw_assignments = _solve_food_matching(expected, predicted)
    normalized: List[Optional[Dict[str, Any]]] = []
    for assignment in raw_assignments:
        if assignment is None:
            normalized.append(None)
            continue
        normalized.append({
            "predictedIndex": assignment["predictedIndex"],
            "score": assignment["score"],
            "matchType": assignment["matchType"],
            "confidence": assignment["score"],
            "reason": "local_rule_matcher",
        })
    return normalized


def _build_items_mode_evaluation(
    expected: List[Dict[str, Any]],
    predicted: List[Dict[str, Any]],
    assignments: List[Optional[Dict[str, Any]]],
    evaluator_source: str,
    evaluator_error: Optional[str] = None,
    unmatched_candidates: Optional[List[Optional[Dict[str, Any]]]] = None,
) -> Dict[str, Any]:
    true_total = round(sum(float(item.get("trueWeightGrams") or 0) for item in expected), 1)
    estimated_total = extract_total_weight(predicted)
    total_deviation = calculate_deviation(estimated_total, true_total) if true_total > 0 else None
    total_weight_relative_error = None if total_deviation is None else round(total_deviation / 100, 4)

    used_prediction_indexes = {
        assignment["predictedIndex"]
        for assignment in assignments
        if assignment is not None
    }

    matches = []
    matched_true_weight_total = 0.0
    matched_absolute_errors: List[float] = []
    matched_clipped_relative_errors: List[float] = []
    raw_item_deviations: List[float] = []

    for index, (expected_item, assignment) in enumerate(zip(expected, assignments)):
        expected_weight = float(expected_item.get("trueWeightGrams") or 0)
        predicted_item = None
        predicted_weight = None
        weight_metrics = _calculate_weight_error_metrics(expected_weight, None)
        match_score = 0.0
        match_type = "none"
        match_confidence = None
        match_reason = None
        candidate_hint = (
            unmatched_candidates[index]
            if unmatched_candidates and index < len(unmatched_candidates)
            else None
        )

        if assignment is not None:
            predicted_index = assignment["predictedIndex"]
            predicted_item = predicted[predicted_index]
            predicted_weight = float(predicted_item.get("estimatedWeightGrams") or 0)
            weight_metrics = _calculate_weight_error_metrics(expected_weight, predicted_weight)
            match_score = round(float(assignment.get("score") or 0.0), 2)
            match_type = str(assignment.get("matchType") or "none")
            match_confidence = assignment.get("confidence")
            match_reason = assignment.get("reason")
            matched_true_weight_total += expected_weight
            if weight_metrics["absoluteErrorGrams"] is not None:
                matched_absolute_errors.append(float(weight_metrics["absoluteErrorGrams"]))
            if weight_metrics["clippedRelativeError"] is not None:
                matched_clipped_relative_errors.append(float(weight_metrics["clippedRelativeError"]))
            if weight_metrics["deviation"] is not None:
                raw_item_deviations.append(float(weight_metrics["deviation"]))
        elif candidate_hint is not None:
            predicted_index = candidate_hint.get("predictedIndex")
            if isinstance(predicted_index, int) and 0 <= predicted_index < len(predicted):
                predicted_item = predicted[predicted_index]
                predicted_weight = float(predicted_item.get("estimatedWeightGrams") or 0)
            match_type = str(candidate_hint.get("matchType") or "none")
            match_confidence = candidate_hint.get("confidence")
            match_reason = candidate_hint.get("reason")

        matches.append({
            "expectedName": expected_item.get("name"),
            "trueWeightGrams": expected_item.get("trueWeightGrams"),
            "predictedName": predicted_item.get("name") if predicted_item else None,
            "estimatedWeightGrams": round(predicted_weight, 1) if predicted_weight is not None else None,
            "deviation": weight_metrics["deviation"],
            "absoluteErrorGrams": weight_metrics["absoluteErrorGrams"],
            "relativeError": weight_metrics["relativeError"],
            "relativeErrorPercent": weight_metrics["relativeErrorPercent"],
            "normalizedRelativeError": weight_metrics["normalizedRelativeError"],
            "normalizedRelativeErrorPercent": weight_metrics["normalizedRelativeErrorPercent"],
            "clippedRelativeError": weight_metrics["clippedRelativeError"],
            "clippedRelativeErrorPercent": weight_metrics["clippedRelativeErrorPercent"],
            "matchScore": match_score,
            "matchType": match_type,
            "matchConfidence": _round_ratio(match_confidence) if match_confidence is not None else None,
            "matchReason": match_reason,
            "status": "matched" if assignment is not None else "missing",
        })

    extras = [
        {
            "name": item.get("name", "未知食物"),
            "estimatedWeightGrams": float(item.get("estimatedWeightGrams") or 0),
        }
        for index, item in enumerate(predicted)
        if index not in used_prediction_indexes
    ]

    true_positive_count = sum(1 for item in matches if item["status"] == "matched")
    false_negative_count = sum(1 for item in matches if item["status"] == "missing")
    false_positive_count = len(extras)
    predicted_count = true_positive_count + false_positive_count
    expected_count = len(expected)

    food_precision = (true_positive_count / predicted_count) if predicted_count else 0.0
    food_recall = (true_positive_count / expected_count) if expected_count else 0.0
    food_f1 = (
        0.0
        if (food_precision + food_recall) == 0
        else (2 * food_precision * food_recall) / (food_precision + food_recall)
    )
    weighted_food_recall = matched_true_weight_total / true_total if true_total > 0 else None
    matched_weight_mae = (
        round(sum(matched_absolute_errors) / len(matched_absolute_errors), 2)
        if matched_absolute_errors else None
    )
    matched_weight_relative_error = (
        _round_ratio(sum(matched_clipped_relative_errors) / len(matched_clipped_relative_errors))
        if matched_clipped_relative_errors else None
    )
    matched_weight_score = (
        _round_ratio(1.0 - float(matched_weight_relative_error))
        if matched_weight_relative_error is not None
        else 0.0
    )
    final_composite_score = _round_ratio(float(food_f1) * float(matched_weight_score))

    return {
        "benchmarkVersion": BENCHMARK_VERSION,
        "mode": ITEMS_LABEL_MODE,
        "evaluatorSource": evaluator_source,
        "evaluatorError": evaluator_error,
        "trueTotalWeight": true_total,
        "estimatedTotalWeight": estimated_total,
        "totalDeviation": total_deviation,
        "totalWeightRelativeError": total_weight_relative_error,
        "totalWeightRelativeErrorPercent": total_deviation,
        "expectedItems": expected,
        "predictedCount": len(predicted),
        "itemMatches": matches,
        "extraItems": extras,
        "truePositiveCount": true_positive_count,
        "falsePositiveCount": false_positive_count,
        "falseNegativeCount": false_negative_count,
        "matchedCount": true_positive_count,
        "missingCount": false_negative_count,
        "extraCount": len(extras),
        "avgItemDeviation": round(sum(raw_item_deviations) / len(raw_item_deviations), 2) if raw_item_deviations else None,
        "foodPrecision": _round_ratio(food_precision),
        "foodPrecisionPercent": _ratio_to_percent(food_precision),
        "foodRecall": _round_ratio(food_recall),
        "foodRecallPercent": _ratio_to_percent(food_recall),
        "foodF1": _round_ratio(food_f1),
        "foodF1Percent": _ratio_to_percent(food_f1),
        "weightedFoodRecall": _round_ratio(weighted_food_recall),
        "weightedFoodRecallPercent": _ratio_to_percent(weighted_food_recall),
        "matchedWeightMaeGrams": matched_weight_mae,
        "matchedWeightRelativeError": matched_weight_relative_error,
        "matchedWeightRelativeErrorPercent": _ratio_to_percent(matched_weight_relative_error),
        "matchedWeightScore": matched_weight_score,
        "matchedWeightScorePercent": _ratio_to_percent(matched_weight_score),
        "finalCompositeScore": final_composite_score,
        "finalCompositeScorePercent": _ratio_to_percent(final_composite_score),
    }


def _build_deepseek_match_prompt(
    expected_payload: List[Dict[str, Any]],
    predicted_payload: List[Dict[str, Any]],
) -> str:
    expected_total_weight = round(sum(float(item.get("weight_grams") or 0) for item in expected_payload), 1)
    predicted_total_weight = round(sum(float(item.get("weight_grams") or 0) for item in predicted_payload), 1)
    return (
        "你是食物识别 benchmark 的评估器，只负责判断食物名称匹配，不负责最终算分。\n"
        "要求：\n"
        "1. 只做一对一匹配，每个 predicted 最多匹配一个 expected。\n"
        "2. generic / 太宽泛的名字不要匹配具体菜名，例如“青菜”通常不能直接匹配“西兰花”。\n"
        "3. 同义词、常见简称、去掉做法但主体明显一致的情况可以匹配，例如“白米饭”≈“米饭”。\n"
        "4. mixed dish（混合菜）要谨慎匹配：\n"
        "   - 若 predicted.is_mixed_dish=true，优先匹配标签中同样明显是混合菜、或名称中自带辅料/配料说明的项。\n"
        "   - 单一食物不要轻易匹配成明显混合菜；混合菜也不要轻易匹配成过于单一的食物。\n"
        "   - 如果标签是一道混合菜，而预测拆成多个子项，默认不要自动把多个子项合并成一个命中。\n"
        "5. 如果不确定，宁可不匹配，也不要乱匹配。\n"
        "6. 重量、count、confidence 只用于辅助 disambiguation，不能盖过食物语义本身。\n"
        "7. total_weight_grams 只作为整体 sanity check 参考，不能单独决定匹配。\n"
        "8. 对每一个 expected_item，都必须返回一条 assignment 记录。\n"
        "9. 如果某个 expected_item 没有可接受匹配，也要返回它最像的 predicted_item 作为 best candidate；若确实完全没有候选，再把 predicted_index 设为 null。\n"
        "10. accepted=false 时，match_type 应使用 too_generic / wrong_food / missing 之一，帮助下游报告区分“识别错了什么”与“完全没识别到”。\n"
        "11. 若 expected 与 predicted 的主体食材相同，但做法、切法、少量辅料不同，至少应把该 predicted 作为 best candidate 返回；只有在主食材明显不同或根本没有候选时，才返回 missing。\n"
        "12. expected_items 与 predicted_items 都带有结构化字段：\n"
        "   - is_mixed_dish: 这项是否是无法可靠拆分的混合菜\n"
        "   - count: 可数食物数量；null 代表不可数或未知\n"
        "   - confidence: 预测项自带的模型置信度，仅供参考，不可压过语义判断\n"
        "请只返回 JSON，不要加解释文字，格式必须是：\n"
        "{\n"
        '  "assignments": [\n'
        '    {"expected_index":0,"predicted_index":1,"accepted":true,"match_type":"exact|synonym|close_equivalent|too_generic|wrong_food|missing","confidence":0.96,"reason":"简短原因"}\n'
        "  ]\n"
        "}\n\n"
        f"expected_total_weight_grams = {expected_total_weight}\n"
        f"predicted_total_weight_grams = {predicted_total_weight}\n"
        f"expected_items = {json.dumps(expected_payload, ensure_ascii=False)}\n"
        f"predicted_items = {json.dumps(predicted_payload, ensure_ascii=False)}"
    )


@lru_cache(maxsize=512)
def _match_food_items_with_deepseek_cached(
    expected_payload_json: str,
    predicted_payload_json: str,
) -> Dict[str, Any]:
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("缺少 DEEPSEEK_API_KEY 环境变量")

    expected_payload = json.loads(expected_payload_json)
    predicted_payload = json.loads(predicted_payload_json)
    prompt = _build_deepseek_match_prompt(expected_payload, predicted_payload)
    api_url = f"{DEEPSEEK_BASE_URL}/chat/completions"

    with httpx.Client(timeout=DEEPSEEK_TIMEOUT_SECONDS) as client:
        response = client.post(
            api_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": DEEPSEEK_MODEL,
                "messages": [
                    {"role": "system", "content": "You are a strict food benchmark matcher. Return JSON only."},
                    {"role": "user", "content": prompt},
                ],
                "reasoning_effort": DEEPSEEK_REASONING_EFFORT,
                "stream": False,
            },
        )
        response.raise_for_status()
        payload = response.json()

    raw_content = (((payload.get("choices") or [{}])[0]).get("message") or {}).get("content") or ""
    parsed = _extract_json_object_loose(raw_content)
    if not isinstance(parsed, dict):
        raise ValueError("DeepSeek evaluator 返回格式错误")
    return parsed


def _build_deepseek_assignments(
    expected: List[Dict[str, Any]],
    predicted: List[Dict[str, Any]],
    deepseek_result: Dict[str, Any],
) -> Tuple[List[Optional[Dict[str, Any]]], List[Optional[Dict[str, Any]]]]:
    raw_assignments = deepseek_result.get("assignments")
    if not isinstance(raw_assignments, list):
        raise ValueError("DeepSeek evaluator 缺少 assignments")

    accepted_types = {"exact": 1.0, "synonym": 0.96, "close_equivalent": 0.85}
    assignments: List[Optional[Dict[str, Any]]] = [None for _ in expected]
    rejected_hints: List[Optional[Dict[str, Any]]] = [None for _ in expected]
    used_predicted_indexes = set()

    for record in raw_assignments:
        if not isinstance(record, dict):
            continue
        expected_index = record.get("expected_index")
        predicted_index = record.get("predicted_index")
        accepted = bool(record.get("accepted"))
        match_type = str(record.get("match_type") or "").strip().lower() or "missing"
        confidence = float(record.get("confidence") or 0.0)
        reason = str(record.get("reason") or "").strip() or None

        if not isinstance(expected_index, int) or not (0 <= expected_index < len(expected)):
            continue
        if not accepted or match_type not in accepted_types:
            if (
                isinstance(predicted_index, int)
                and 0 <= predicted_index < len(predicted)
                and rejected_hints[expected_index] is None
            ):
                rejected_hints[expected_index] = {
                    "predictedIndex": predicted_index,
                    "matchType": match_type or "missing",
                    "confidence": confidence,
                    "reason": reason,
                }
            continue
        if not isinstance(predicted_index, int) or not (0 <= predicted_index < len(predicted)):
            continue
        if predicted_index in used_predicted_indexes:
            continue

        used_predicted_indexes.add(predicted_index)
        assignments[expected_index] = {
            "predictedIndex": predicted_index,
            "score": min(max(accepted_types[match_type], confidence), 1.0),
            "matchType": match_type,
            "confidence": confidence,
            "reason": reason,
        }

    return assignments, rejected_hints


def _fill_missing_unmatched_candidate_hints(
    expected: List[Dict[str, Any]],
    predicted: List[Dict[str, Any]],
    assignments: List[Optional[Dict[str, Any]]],
    rejected_hints: List[Optional[Dict[str, Any]]],
) -> List[Optional[Dict[str, Any]]]:
    if not expected or not predicted:
        return rejected_hints

    hints: List[Optional[Dict[str, Any]]] = list(rejected_hints or [None for _ in expected])
    used_predicted_indexes = {
        assignment["predictedIndex"]
        for assignment in assignments
        if assignment is not None
    }
    used_hint_indexes = {
        hint["predictedIndex"]
        for hint in hints
        if hint is not None and isinstance(hint.get("predictedIndex"), int)
    }

    for expected_index, assignment in enumerate(assignments):
        if assignment is not None or hints[expected_index] is not None:
            continue
        ranked = []
        expected_item = expected[expected_index]
        expected_weight = float(expected_item.get("trueWeightGrams") or 0)
        for predicted_index, predicted_item in enumerate(predicted):
            if predicted_index in used_predicted_indexes or predicted_index in used_hint_indexes:
                continue
            hint_info = _score_food_name_candidate_hint(
                expected_item.get("name"),
                predicted_item.get("name"),
            )
            if hint_info["score"] <= 0:
                continue
            predicted_weight = float(predicted_item.get("estimatedWeightGrams") or 0)
            weight_metrics = _calculate_weight_error_metrics(expected_weight, predicted_weight)
            ranked.append({
                "predictedIndex": predicted_index,
                "score": hint_info["score"],
                "matchType": hint_info["matchType"],
                "weightBonus": 1.0 - float(weight_metrics["clippedRelativeError"] or 0.0),
            })

        ranked.sort(
            key=lambda candidate: (candidate["score"], candidate["weightBonus"]),
            reverse=True,
        )
        for candidate in ranked:
            predicted_index = candidate["predictedIndex"]
            hints[expected_index] = {
                "predictedIndex": predicted_index,
                "matchType": candidate.get("matchType") or "wrong_food",
                "confidence": candidate["score"],
                "reason": "local_best_unmatched_candidate",
            }
            used_hint_indexes.add(predicted_index)
            break

    return hints


async def calculate_item_weight_evaluation_with_deepseek(
    predicted_items: List[Dict[str, Any]],
    expected_items: List[Dict[str, Any]],
) -> Dict[str, Any]:
    local_evaluation = calculate_item_weight_evaluation(predicted_items, expected_items)
    if local_evaluation.get("mode") != ITEMS_LABEL_MODE:
        return {
            **local_evaluation,
            "evaluatorSource": "local_total_only",
            "evaluatorError": None,
        }

    expected = normalize_expected_items(expected_items)
    predicted = [
        item for item in (predicted_items or [])
        if isinstance(item, dict)
    ]
    if not expected or not predicted:
        return {
            **local_evaluation,
            "evaluatorSource": "local_empty_side",
            "evaluatorError": None,
        }

    expected_payload_json = json.dumps(
        _serialize_items_for_evaluator(expected, "trueWeightGrams"),
        ensure_ascii=False,
        sort_keys=True,
    )
    predicted_payload_json = json.dumps(
        _serialize_items_for_evaluator(predicted, "estimatedWeightGrams"),
        ensure_ascii=False,
        sort_keys=True,
    )

    try:
        deepseek_result = await asyncio.to_thread(
            _match_food_items_with_deepseek_cached,
            expected_payload_json,
            predicted_payload_json,
        )
        assignments, rejected_hints = _build_deepseek_assignments(expected, predicted, deepseek_result)
        rejected_hints = _fill_missing_unmatched_candidate_hints(
            expected,
            predicted,
            assignments,
            rejected_hints,
        )
        return _build_items_mode_evaluation(
            expected,
            predicted,
            assignments,
            evaluator_source="deepseek",
            evaluator_error=None,
            unmatched_candidates=rejected_hints,
        )
    except Exception as exc:
        fallback_assignments = _build_local_match_assignments(expected, predicted)
        return _build_items_mode_evaluation(
            expected,
            predicted,
            fallback_assignments,
            evaluator_source="fallback_local",
            evaluator_error=str(exc),
        )


def calculate_item_weight_evaluation(
    predicted_items: List[Dict[str, Any]],
    expected_items: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Compare model item weights against per-food labels."""
    expected = normalize_expected_items(expected_items)
    predicted = [
        item for item in (predicted_items or [])
        if isinstance(item, dict)
    ]
    true_total = round(sum(float(item.get("trueWeightGrams") or 0) for item in expected), 1)
    estimated_total = extract_total_weight(predicted)
    total_deviation = calculate_deviation(estimated_total, true_total) if true_total > 0 else None
    total_weight_relative_error = None if total_deviation is None else round(total_deviation / 100, 4)

    if len(expected) == 1 and _is_total_label_item(expected[0]):
        return {
            "benchmarkVersion": BENCHMARK_VERSION,
            "mode": TOTAL_LABEL_MODE,
            "evaluatorSource": "local_total_only",
            "evaluatorError": None,
            "trueTotalWeight": true_total,
            "estimatedTotalWeight": estimated_total,
            "totalDeviation": total_deviation,
            "totalWeightRelativeError": total_weight_relative_error,
            "totalWeightRelativeErrorPercent": total_deviation,
            "expectedItems": expected,
            "predictedCount": len(predicted),
            "itemMatches": [],
            "extraItems": [],
            "truePositiveCount": 0,
            "falsePositiveCount": len(predicted),
            "falseNegativeCount": 0,
            "matchedCount": 0,
            "missingCount": 0,
            "extraCount": len(predicted),
            "avgItemDeviation": None,
            "foodPrecision": None,
            "foodPrecisionPercent": None,
            "foodRecall": None,
            "foodRecallPercent": None,
            "foodF1": None,
            "foodF1Percent": None,
            "weightedFoodRecall": None,
            "weightedFoodRecallPercent": None,
            "matchedWeightMaeGrams": None,
            "matchedWeightRelativeError": None,
            "matchedWeightRelativeErrorPercent": None,
            "matchedWeightScore": None,
            "matchedWeightScorePercent": None,
            "finalCompositeScore": None,
            "finalCompositeScorePercent": None,
        }
    assignments = _build_local_match_assignments(expected, predicted)
    return _build_items_mode_evaluation(
        expected,
        predicted,
        assignments,
        evaluator_source="local_rule",
        evaluator_error=None,
    )


def format_model_result(parsed: Dict[str, Any], true_weight: float) -> Dict[str, Any]:
    """
    格式化模型分析结果
    
    Args:
        parsed: 模型返回的原始解析结果
        true_weight: 真实重量
    
    Returns:
        格式化后的结果字典
    """
    items = parsed.get("items", [])
    estimated_weight = extract_total_weight(items)
    deviation = calculate_deviation(estimated_weight, true_weight)
    
    # 格式化 items，提取关键信息
    formatted_items = []
    for item in items:
        formatted_items.append({
            "name": item.get("name", "未知食物"),
            "estimatedWeightGrams": float(item.get("estimatedWeightGrams", 0) or 0),
            "isMixedDish": item.get("isMixedDish"),
            "count": item.get("count"),
            "confidence": item.get("confidence"),
            "nutrients": item.get("nutrients", {})
        })
    
    return {
        "estimatedWeight": estimated_weight,
        "deviation": deviation,
        "items": formatted_items,
        "description": parsed.get("description", ""),
        "insight": parsed.get("insight", ""),
        "pfc_ratio_comment": parsed.get("pfc_ratio_comment", ""),
        "absorption_notes": parsed.get("absorption_notes", ""),
        "context_advice": parsed.get("context_advice", "")
    }


def is_valid_image_file(filename: str) -> bool:
    """
    检查文件是否为有效的图片文件
    
    Args:
        filename: 文件名
    
    Returns:
        是否为有效图片文件
    """
    valid_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
    ext = filename.lower().split('.')[-1] if '.' in filename else ''
    return f'.{ext}' in valid_extensions
