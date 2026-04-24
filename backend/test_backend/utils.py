"""
测试后台工具函数
"""
import re
from typing import Dict, List, Tuple, Any, Optional


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

    if len(expected) == 1 and _is_total_label_item(expected[0]):
        return {
            "mode": TOTAL_LABEL_MODE,
            "trueTotalWeight": true_total,
            "estimatedTotalWeight": estimated_total,
            "totalDeviation": total_deviation,
            "expectedItems": expected,
            "itemMatches": [],
            "extraItems": [],
            "matchedCount": 0,
            "missingCount": 0,
            "extraCount": 0,
            "avgItemDeviation": None,
        }

    used_prediction_indexes = set()
    matches = []
    for expected_item in expected:
        expected_name = normalize_food_name(expected_item.get("name"))
        best_index = None
        best_score = 0.0
        for index, predicted_item in enumerate(predicted):
            if index in used_prediction_indexes:
                continue
            predicted_name = normalize_food_name(predicted_item.get("name"))
            if not predicted_name or not expected_name:
                continue
            if predicted_name == expected_name:
                score = 1.0
            elif expected_name in predicted_name or predicted_name in expected_name:
                score = 0.82
            else:
                expected_chars = set(expected_name)
                predicted_chars = set(predicted_name)
                score = len(expected_chars & predicted_chars) / max(len(expected_chars | predicted_chars), 1)
            if score > best_score:
                best_score = score
                best_index = index

        predicted_item = predicted[best_index] if best_index is not None and best_score >= 0.35 else None
        if predicted_item is not None and best_index is not None:
            used_prediction_indexes.add(best_index)
            predicted_weight = float(predicted_item.get("estimatedWeightGrams") or 0)
            deviation = calculate_deviation(predicted_weight, float(expected_item.get("trueWeightGrams") or 0))
        else:
            predicted_weight = None
            deviation = None

        matches.append({
            "expectedName": expected_item.get("name"),
            "trueWeightGrams": expected_item.get("trueWeightGrams"),
            "predictedName": predicted_item.get("name") if predicted_item else None,
            "estimatedWeightGrams": round(predicted_weight, 1) if predicted_weight is not None else None,
            "deviation": deviation,
            "matchScore": round(best_score, 2) if predicted_item else 0,
            "status": "matched" if predicted_item else "missing",
        })

    extras = [
        {
            "name": item.get("name", "未知食物"),
            "estimatedWeightGrams": float(item.get("estimatedWeightGrams") or 0),
        }
        for index, item in enumerate(predicted)
        if index not in used_prediction_indexes
    ]

    item_deviations = [item["deviation"] for item in matches if item.get("deviation") is not None]
    return {
        "mode": ITEMS_LABEL_MODE,
        "trueTotalWeight": true_total,
        "estimatedTotalWeight": estimated_total,
        "totalDeviation": total_deviation,
        "expectedItems": expected,
        "itemMatches": matches,
        "extraItems": extras,
        "matchedCount": sum(1 for item in matches if item["status"] == "matched"),
        "missingCount": sum(1 for item in matches if item["status"] == "missing"),
        "extraCount": len(extras),
        "avgItemDeviation": round(sum(item_deviations) / len(item_deviations), 2) if item_deviations else None,
    }


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
