"""
异步分析任务 Worker：从 Supabase analysis_tasks 表抢占 pending 任务并执行。
支持 task_type=food（食物分析）、health_report（体检报告 OCR）。
启动方式：由 run_backend.py 启动多个子进程。
"""
import os
import sys
import json
import re
import time
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

# 确保 backend 目录在 path 中
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
BACKEND_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(BACKEND_ENV_PATH, override=True)

import httpx
from database import (
    claim_next_pending_task_sync,
    update_analysis_task_result_sync,
    get_user_by_id_sync,
    insert_health_document_sync,
    update_user_sync,
    mark_task_violated_sync,
    create_violation_record_sync,
    claim_next_pending_comment_task_sync,
    update_comment_task_result_sync,
    mark_comment_task_violated_sync,
    add_feed_comment_sync,
    add_public_food_library_comment_sync,
    update_public_food_library_status_sync,
)
from metabolic import get_age_from_birthday

ACTIVITY_LEVEL_LABELS = {
    "sedentary": "久坐",
    "light": "轻度活动",
    "moderate": "中度活动",
    "active": "高度活动",
    "very_active": "极高活动",
}

MEAL_NAMES = {
    "breakfast": "早餐",
    "morning_snack": "早加餐",
    "lunch": "午餐",
    "afternoon_snack": "午加餐",
    "dinner": "晚餐",
    "evening_snack": "晚加餐",
    # 兼容历史值（具体映射由 _meal_name_for_hint 决定）
    "snack": "加餐",
}

CHINA_TZ = timezone(timedelta(hours=8))

VALID_RECOGNITION_OUTCOMES = {"ok", "soft_reject", "hard_reject"}
VALID_ALLOWED_FOOD_CATEGORIES = {"carb", "lean_protein", "unknown"}
STRICT_HARD_REJECT_TAGS = {
    "mixed_food",
    "multiple_items",
    "fatty_or_unclear_meat",
    "heavy_sauce_or_fried",
    "unsupported_food",
    "unclear_main_subject",
}
STRICT_SOFT_REJECT_TAGS = {
    "portion_unclear",
    "view_insufficient",
    "needs_reference",
    "cook_method_unclear",
    "weight_uncertain",
}
STRICT_REASON_BY_TAG = {
    "mixed_food": "当前画面是混合食物，不适合精准模式直接估算。",
    "multiple_items": "当前画面包含多个主体食物，精准模式下一次只建议拍一个主体。",
    "fatty_or_unclear_meat": "当前肉类肥瘦比例不明，无法稳定按精准模式估算。",
    "heavy_sauce_or_fried": "当前食物烹饪方式偏重油、裹粉或酱汁遮挡，无法稳定按精准模式估算。",
    "unsupported_food": "当前食物不属于精准模式首期支持的单纯碳水或单纯瘦肉。",
    "unclear_main_subject": "当前主体食物不够清晰，无法进行精准模式判断。",
    "portion_unclear": "当前主体基本可识别，但分量边界不够清楚，结果不建议直接用于精准执行。",
    "view_insufficient": "当前拍摄视角不足，重量估算可信度有限。",
    "needs_reference": "当前缺少参照物，重量估算可信度有限。",
    "cook_method_unclear": "当前烹饪方式不够明确，营养估算可信度有限。",
    "weight_uncertain": "当前重量仍存在不确定性，结果不建议直接用于精准执行。",
}
STRICT_HARD_GUIDANCE_DEFAULT = [
    "请只保留一个主体食物，分开单独拍摄。",
    "请把食物拨开，避免酱汁、配菜或其他食物遮挡主体。",
    "旁边放手掌、筷子或常见餐具作为参照物。",
]
STRICT_SOFT_GUIDANCE_DEFAULT = [
    "建议补拍更清晰的正面和侧面，尽量完整展示主体。",
    "建议旁边放手掌、筷子或餐具作为参照物。",
]


def _meal_name_for_hint(meal_type: Optional[str], timezone_offset_minutes: Optional[Any] = None) -> str:
    """将餐次转换为提示词展示名，兼容 legacy snack 按客户端时区（兜底东八区）映射。"""
    mt = (meal_type or "").strip()
    if mt != "snack":
        return MEAL_NAMES.get(mt, mt)
    hour = datetime.now(CHINA_TZ).hour
    if timezone_offset_minutes is not None:
        try:
            offset = int(timezone_offset_minutes)
            if -840 <= offset <= 840:
                # JS getTimezoneOffset 定义：UTC - local（分钟），因此 local = UTC - offset
                hour = (datetime.now(timezone.utc) - timedelta(minutes=offset)).hour
        except Exception:
            pass
    return "午加餐" if 11 <= hour < 17 else "晚加餐"


def _normalize_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _normalize_string_list(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    seen = set()
    result: List[str] = []
    for item in value:
        text = _normalize_text(item)
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def _normalize_scene_tags(value: Any) -> List[str]:
    raw_tags = _normalize_string_list(value)
    normalized: List[str] = []
    seen = set()
    for tag in raw_tags:
        key = tag.strip().lower().replace("-", "_").replace(" ", "_")
        if not key or key in seen:
            continue
        seen.add(key)
        normalized.append(key)
    return normalized


def _normalize_allowed_food_category(value: Any) -> str:
    category = (_normalize_text(value) or "unknown").lower()
    if category not in VALID_ALLOWED_FOOD_CATEGORIES:
        return "unknown"
    return category


def _normalize_recognition_outcome(value: Any) -> Optional[str]:
    outcome = (_normalize_text(value) or "").lower()
    if outcome in VALID_RECOGNITION_OUTCOMES:
        return outcome
    return None


def _merge_guidance(primary: List[str], fallback: List[str]) -> List[str]:
    merged: List[str] = []
    seen = set()
    for item in [*primary, *fallback]:
        text = _normalize_text(item)
        if not text or text in seen:
            continue
        seen.add(text)
        merged.append(text)
    return merged


def _derive_recognition_fields(parsed: Dict[str, Any], items: List[Dict[str, Any]], execution_mode: str) -> Dict[str, Any]:
    allowed_food_category = _normalize_allowed_food_category(parsed.get("allowedFoodCategory"))
    recognition_outcome = _normalize_recognition_outcome(parsed.get("recognitionOutcome"))
    scene_tags = _normalize_scene_tags(parsed.get("sceneTags"))
    guidance = _normalize_string_list(parsed.get("retakeGuidance"))
    model_reason = _normalize_text(parsed.get("rejectionReason"))

    if execution_mode != "strict":
        return {
            "recognitionOutcome": recognition_outcome or "ok",
            "rejectionReason": model_reason if recognition_outcome in {"soft_reject", "hard_reject"} else None,
            "retakeGuidance": guidance or None,
            "allowedFoodCategory": allowed_food_category,
        }

    hard_reasons: List[str] = []
    soft_reasons: List[str] = []

    if not items:
        hard_reasons.append("当前未识别出可用于精准执行的主体食物。")
    if len(items) > 1:
        hard_reasons.append("精准模式下一次只建议拍一个主体食物，当前画面包含多个食物。")
    if allowed_food_category == "unknown":
        hard_reasons.append("当前食物不属于精准模式首期支持的单纯碳水或单纯瘦肉。")

    for tag in scene_tags:
        reason = STRICT_REASON_BY_TAG.get(tag)
        if not reason:
            continue
        if tag in STRICT_HARD_REJECT_TAGS:
            hard_reasons.append(reason)
        elif tag in STRICT_SOFT_REJECT_TAGS:
            soft_reasons.append(reason)

    if recognition_outcome == "hard_reject" and model_reason:
        hard_reasons.append(model_reason)
    elif recognition_outcome == "soft_reject" and model_reason:
        soft_reasons.append(model_reason)

    if hard_reasons:
        return {
            "recognitionOutcome": "hard_reject",
            "rejectionReason": hard_reasons[0],
            "retakeGuidance": _merge_guidance(guidance, STRICT_HARD_GUIDANCE_DEFAULT),
            "allowedFoodCategory": allowed_food_category,
        }
    if soft_reasons:
        return {
            "recognitionOutcome": "soft_reject",
            "rejectionReason": soft_reasons[0],
            "retakeGuidance": _merge_guidance(guidance, STRICT_SOFT_GUIDANCE_DEFAULT),
            "allowedFoodCategory": allowed_food_category,
        }
    return {
        "recognitionOutcome": "ok",
        "rejectionReason": None,
        "retakeGuidance": guidance or None,
        "allowedFoodCategory": allowed_food_category,
    }


def _format_health_profile_sync(user: Dict[str, Any]) -> str:
    """将 weapp_user 健康档案格式化为供 AI 参考的简短摘要（与 main 中逻辑一致）。"""
    parts = []
    gender = user.get("gender")
    if gender:
        parts.append(f"性别：{'男' if gender == 'male' else '女'}")
    height = user.get("height")
    if height is not None:
        parts.append(f"身高 {float(height):.0f} cm")
    weight = user.get("weight")
    if weight is not None:
        parts.append(f"体重 {float(weight):.1f} kg")
    birthday = user.get("birthday")
    if birthday:
        age = get_age_from_birthday(str(birthday))
        if age is not None:
            parts.append(f"年龄 {age} 岁")
    if parts:
        parts[0] = "· " + parts[0]
        for i in range(1, len(parts)):
            parts[i] = "  " + parts[i]
        line1 = " ".join(parts)
    else:
        line1 = ""
    activity = user.get("activity_level")
    activity_str = ACTIVITY_LEVEL_LABELS.get(activity, activity or "未填")
    line2 = f"· 活动水平：{activity_str}"
    hc = user.get("health_condition") or {}
    if isinstance(hc, str):
        try:
            hc = json.loads(hc) if hc else {}
        except Exception:
            hc = {}
    medical = hc.get("medical_history") or []
    line3 = "· 既往病史：" + "、".join(medical) if isinstance(medical, list) and medical else ""
    diet = hc.get("diet_preference") or []
    line4 = "· 饮食偏好：" + "、".join(diet) if isinstance(diet, list) and diet else ""
    allergies = hc.get("allergies") or []
    line5 = "· 过敏/忌口：" + "、".join(allergies) if isinstance(allergies, list) and allergies else ""
    bmr = user.get("bmr")
    tdee = user.get("tdee")
    line6 = ""
    if bmr is not None or tdee is not None:
        bmr_s = f"{float(bmr):.0f} kcal/天" if bmr is not None else "未计算"
        tdee_s = f"{float(tdee):.0f} kcal/天" if tdee is not None else "未计算"
        line6 = f"· 基础代谢(BMR)：{bmr_s}；每日总消耗(TDEE)：{tdee_s}"
    report = hc.get("report_extract") or hc.get("ocr_notes") or ""
    if isinstance(report, dict):
        report = json.dumps(report, ensure_ascii=False)[:500]
    elif report:
        report = (report[:500] + "…") if len(str(report)) > 500 else str(report)
    line7 = "· 体检/病历摘要：" + report if report else ""
    lines = [line1, line2, line3, line4, line5, line6, line7]
    lines = [x for x in lines if x]
    if not lines:
        return ""
    return "用户健康档案（供营养建议参考）：\n" + "\n".join(lines)


def _image_moderation_prompt() -> str:
    """图片内容审核提示词。"""
    return """
你是一个内容安全审核系统。请分析这张/这些图片，判断是否存在以下违规情况：
1. 图片与食物完全无关（如自拍、风景、截图、文档等非食物图片）
2. 图片包含色情、裸露内容
3. 图片包含暴力、血腥、恐怖内容
4. 图片包含违法犯罪相关内容
5. 图片包含政治敏感内容

注意：只要图片中包含食物（即使同时有其他物品），就不算违规。
只有图片完全与食物无关，或包含上述 2-5 类违规内容时，才判定为违规。

请严格按以下 JSON 格式返回，不要包含任何其他文本：
如果不违规：{"is_violation": false}
如果违规：{"is_violation": true, "category": "分类值", "reason": "简要中文原因"}

category 可选值：irrelevant_image, pornography, violence, crime, politics, other
""".strip()


def _text_moderation_prompt(text_input: str) -> str:
    """文本内容审核提示词。"""
    return f"""
你是一个内容安全审核系统。请分析以下用户输入的文本，判断是否存在违规情况：

用户输入文本："{text_input}"

判断标准：
1. 文本与食物描述完全无关（如随机文字、无意义内容等）
2. 文本包含色情、低俗内容
3. 文本包含暴力、恐怖相关描述
4. 文本包含违法犯罪相关内容
5. 文本包含政治敏感言论

注意：只要文本是在描述食物、饮料、餐食（即使描述不准确或简短），就不算违规。
只有文本完全与食物无关，或包含上述 2-5 类违规内容时，才判定为违规。

请严格按以下 JSON 格式返回，不要包含任何其他文本：
如果不违规：{{"is_violation": false}}
如果违规：{{"is_violation": true, "category": "分类值", "reason": "简要中文原因"}}

category 可选值：irrelevant_image, inappropriate_text, pornography, violence, crime, politics, other
""".strip()


def run_content_moderation_sync(task: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    对分析任务的内容（图片或文本）进行 AI 审核。
    返回审核结果 dict：
      - {"is_violation": False} 表示通过
      - {"is_violation": True, "category": "...", "reason": "..."} 表示违规
    审核失败时返回 None（不阻塞正常分析流程）。
    """
    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        print("[moderation] 缺少 API_KEY，跳过审核")
        return None

    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_url = f"{base_url}/chat/completions"
    task_type = task.get("task_type", "")

    try:
        if task_type in ("food", "health_report"):
            # 图片审核：使用视觉模型
            image_urls = []
            image_paths = task.get("image_paths")
            if image_paths and isinstance(image_paths, list) and len(image_paths) > 0:
                image_urls = image_paths
            elif task.get("image_url"):
                image_urls = [task["image_url"]]
            if not image_urls:
                return None  # 没有图片，跳过审核

            content = [
                {"type": "text", "text": _image_moderation_prompt()},
                *[{"type": "image_url", "image_url": {"url": url}} for url in image_urls],
            ]
            model = "qwen-vl-max"

            with httpx.Client(timeout=30.0) as client:
                response = client.post(
                    api_url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": content}],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.1,
                    },
                )

        elif task_type in ("food_text", "public_food_library_text"):
            # 文本审核：使用文本模型
            text_input = task.get("text_input") or ""
            if not text_input.strip():
                return None  # 没有文本，跳过审核

            model = "qwen-plus"

            with httpx.Client(timeout=30.0) as client:
                response = client.post(
                    api_url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": _text_moderation_prompt(text_input)}],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.1,
                    },
                )
        else:
            return None  # 未知任务类型，跳过审核

        if not response.is_success:
            print(f"[moderation] API 请求失败: {response.status_code}")
            return None

        data = response.json()
        raw = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not raw:
            print("[moderation] AI 返回空响应")
            return None

        json_str = re.sub(r"```json", "", raw)
        json_str = re.sub(r"```", "", json_str).strip()
        result = json.loads(json_str)
        print(f"[moderation] 审核结果: {result}")
        return result

    except Exception as e:
        # 审核出错不应阻塞正常分析流程，仅打印日志
        print(f"[moderation] 审核异常（不阻塞分析）: {e}")
        return None


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _normalize_food_name(name: Any) -> str:
    raw = str(name or "").strip().lower()
    if not raw:
        return ""
    compact = re.sub(r"\s+", "", raw)
    compact = re.sub(r"[()（）\[\]【】,，。./\\\-_:：;；·]", "", compact)
    return compact


def _find_match_index(items: list, target_name: str, used_indexes: set) -> Optional[int]:
    target_norm = _normalize_food_name(target_name)
    if not target_norm:
        return None
    fuzzy_index = None
    for idx, item in enumerate(items):
        if idx in used_indexes:
            continue
        item_norm = _normalize_food_name(item.get("name"))
        if not item_norm:
            continue
        if item_norm == target_norm:
            return idx
        if (target_norm in item_norm) or (item_norm in target_norm):
            if fuzzy_index is None:
                fuzzy_index = idx
    return fuzzy_index


def _scale_nutrients(nutrients: Dict[str, Any], ratio: float) -> Dict[str, float]:
    keys = ("calories", "protein", "carbs", "fat", "fiber", "sugar")
    return {k: _safe_float((nutrients or {}).get(k), 0.0) * ratio for k in keys}


def _build_item_from_fallback(
    target_name: str,
    target_weight: float,
    fallback_item: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    nutrients = {"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0, "fiber": 0.0, "sugar": 0.0}
    if fallback_item:
        fallback_weight = _safe_float(
            fallback_item.get("estimatedWeightGrams") or fallback_item.get("originalWeightGrams"),
            0.0,
        )
        if fallback_weight > 0:
            ratio = target_weight / fallback_weight
            nutrients = _scale_nutrients(fallback_item.get("nutrients") or {}, ratio)
    return {
        "name": target_name,
        "estimatedWeightGrams": target_weight,
        "originalWeightGrams": target_weight,
        "nutrients": nutrients,
    }


def _apply_image_correction_items(result_items: list, payload: Dict[str, Any]) -> list:
    """
    图片模式二次纠错的强约束兜底：
    - correctionItems 给出的食物与克重作为本轮锚点
    - 若模型返回和锚点不一致，按锚点回写并按比例缩放营养
    """
    correction_items_raw = payload.get("correctionItems") or []
    correction_items = []
    for raw in correction_items_raw:
        name = str((raw or {}).get("name") or "").strip()
        weight = _safe_float((raw or {}).get("weight"), 0.0)
        if name and weight > 0:
            correction_items.append({"name": name, "weight": weight})

    if not correction_items:
        return result_items

    previous_items = ((payload.get("previousResult") or {}).get("items") or [])
    used_result_indexes = set()
    used_previous_indexes = set()
    correction_name_norms = {_normalize_food_name(item["name"]) for item in correction_items}

    corrected_items = []
    for corr in correction_items:
        target_name = corr["name"]
        target_weight = corr["weight"]

        result_idx = _find_match_index(result_items, target_name, used_result_indexes)
        if result_idx is not None:
            used_result_indexes.add(result_idx)
            matched = result_items[result_idx]
            matched_weight = _safe_float(matched.get("estimatedWeightGrams"), 0.0)
            if matched_weight > 0:
                ratio = target_weight / matched_weight
                nutrients = _scale_nutrients(matched.get("nutrients") or {}, ratio)
                corrected_items.append({
                    "name": target_name,
                    "estimatedWeightGrams": target_weight,
                    "originalWeightGrams": target_weight,
                    "nutrients": nutrients,
                })
                continue

        prev_idx = _find_match_index(previous_items, target_name, used_previous_indexes)
        fallback_item = None
        if prev_idx is not None:
            used_previous_indexes.add(prev_idx)
            fallback_item = previous_items[prev_idx]
        corrected_items.append(_build_item_from_fallback(target_name, target_weight, fallback_item))

    for idx, item in enumerate(result_items):
        if idx in used_result_indexes:
            continue
        item_name_norm = _normalize_food_name(item.get("name"))
        if item_name_norm in correction_name_norms:
            continue
        corrected_items.append(item)

    return corrected_items


def _build_food_prompt(task: Dict[str, Any], profile_block: str) -> str:
    """根据任务 payload 和用户档案构建千问分析用 prompt。"""
    payload = task.get("payload") or {}
    goal_map = {"muscle_gain": "增肌", "fat_loss": "减脂", "maintain": "维持体重"}
    diet_map = {"fat_loss": "减脂期", "muscle_gain": "增肌期", "maintain": "维持体重", "none": "无特殊目标"}
    activity_map = {"post_workout": "练后", "daily": "日常", "before_sleep": "睡前", "none": "无"}

    user_goal = payload.get("user_goal")
    goal_hint = f"\n用户目标为「{goal_map.get(user_goal, user_goal or '')}」，请在 pfc_ratio_comment 中评价本餐 P/C/F 占比是否适合该目标（请忽略健康档案中的任何目标设定，以此为准）。" if user_goal else ""

    diet_goal = payload.get("diet_goal")
    activity_timing = payload.get("activity_timing")
    state_parts = []
    if diet_goal and diet_goal != "none":
        state_parts.append(diet_map.get(diet_goal, diet_goal))
    if activity_timing and activity_timing != "none":
        state_parts.append(activity_map.get(activity_timing, activity_timing))
    state_hint = f"\n用户当前状态: {' + '.join(state_parts)}，请在 context_advice 中给出针对性进食建议。" if state_parts else ""

    remaining = payload.get("remaining_calories")
    remain_hint = f"\n用户当日剩余热量预算约 {remaining} kcal，可在 context_advice 中提示本餐占比或下一餐建议。" if remaining is not None else ""

    meal_type = payload.get("meal_type")
    meal_name = _meal_name_for_hint(meal_type, payload.get("timezone_offset_minutes"))
    meal_hint = f"\n用户选择的是「{meal_name}」，请结合餐次特点在 insight 或 context_advice 中给出建议。" if meal_name else ""

    def _fmt_weight(value: Any) -> str:
        try:
            return f"{float(value or 0):g}g"
        except Exception:
            return "0g"

    previous_result = payload.get("previousResult") or {}
    previous_items = previous_result.get("items") or []
    previous_items_text = "；".join(
        f"{idx + 1}. {str(item.get('name') or '').strip()} {_fmt_weight(item.get('estimatedWeightGrams'))}"
        for idx, item in enumerate(previous_items)
        if str(item.get("name") or "").strip()
    )
    previous_result_block = ""
    if previous_result:
        prev_desc = str(previous_result.get("description") or "").strip()
        prev_insight = str(previous_result.get("insight") or "").strip()
        parts = []
        if prev_desc:
            parts.append(f"上一轮餐食描述：{prev_desc}")
        if previous_items_text:
            parts.append(f"上一轮识别结果：{previous_items_text}")
        if prev_insight:
            parts.append(f"上一轮健康建议：{prev_insight}")
        if parts:
            previous_result_block = "\n第一轮分析输出（供本轮重算参考）：\n- " + "\n- ".join(parts)

    correction_items = payload.get("correctionItems") or []
    correction_items_text = "\n".join(
        f"{idx + 1}. {str(item.get('name') or '').strip()} {_fmt_weight(item.get('weight'))}"
        for idx, item in enumerate(correction_items)
        if str(item.get("name") or "").strip()
    )
    correction_block = (
        "\n第二轮结构化纠错清单（用户在纠错弹窗中提交）：\n" + correction_items_text
    ) if correction_items_text else ""

    additional = (payload.get("additionalContext") or "").strip()
    additional_line = (
        f'\n用户本轮补充/纠错说明: "{additional}"。'
        '\n若与第一轮结果或原图观感冲突，可用此说明修正；但若结构化纠错清单给了明确克重，则以纠错清单为锚点。'
    ) if additional else ""

    is_multi_view = payload.get("is_multi_view")
    multi_view_hint = "\n注意：提供的图片是**同一份食物**的不同视角拍摄（用于辅助展示侧面或厚度）。请综合所有图片来估算这份食物的体积和重量，**不要**将它们视为多份不同的食物。" if is_multi_view else ""
    execution_mode = str(payload.get("execution_mode") or "standard").strip().lower()
    if execution_mode not in {"standard", "strict"}:
        execution_mode = "standard"
    mode_hint = (
        "\n执行模式：精准模式（strict）"
        "\n- 优先识别单纯碳水或单纯瘦肉。"
        "\n- 混合食物、重油烹饪、肥瘦不明时，不要给确定克数。"
        "\n- 请在 insight/context_advice 明确提示“分开拍、拨开拍或重拍”。"
    ) if execution_mode == "strict" else (
        "\n执行模式：标准模式（standard）"
        "\n- 可给出常规估算值，不确定时需提醒偏差风险。"
    )

    return f"""
{multi_view_hint}
请作为专业的营养师分析这些食物图片。
这是一轮基于“原始图片 + 第一轮结果 + 第二轮反馈”的重新生成。
{previous_result_block}
{correction_block}
{additional_line}

信息优先级（高到低）：
1. 第二轮结构化纠错清单（图片模式的主输入）
2. 本轮用户补充/纠错说明
3. 第一轮分析输出
4. 原始图片视觉信息

如果高优先级信息与低优先级冲突，必须以前者为准。
如果结构化纠错清单给出了明确食物与克重，本轮结果中对应食物的 estimatedWeightGrams 必须与清单一致。

1. 识别图中所有不同的食物单品。
2. 重新估算每种食物的重量（克）和详细营养成分；当第二轮反馈给出了更明确重量时，请体现到本轮结果中。
3. description: 提供这顿饭的简短中文描述。
4. insight: 基于该餐营养成分的一句话健康建议。{meal_hint}
5. pfc_ratio_comment: 本餐蛋白质(P)、脂肪(F)、碳水(C) 占比的简要评价（是否均衡、适合增肌/减脂/维持）。{goal_hint}
6. absorption_notes: 食物组合或烹饪方式对吸收率、生物利用度的简要说明（一两句话）。
7. context_advice: 结合用户状态或剩余热量的情境建议（若无则可为空字符串）。{state_hint}{remain_hint}{profile_block}
8. 请遵守以下执行模式约束：{mode_hint}
9. 除了常规营养结果外，请额外做“精准模式判定”：
   - recognitionOutcome: 只能是 ok / soft_reject / hard_reject
   - allowedFoodCategory: 只能是 carb / lean_protein / unknown
   - rejectionReason: 若为 soft_reject 或 hard_reject，给出简短中文原因；否则返回空字符串
   - retakeGuidance: 若需用户重拍/拆拍，给 1-3 条简短中文建议；否则返回空数组
   - sceneTags: 仅从以下枚举中选择 0 个或多个：
     single_carb, single_lean_protein, mixed_food, multiple_items, fatty_or_unclear_meat, heavy_sauce_or_fried, unsupported_food, unclear_main_subject, portion_unclear, view_insufficient, needs_reference, cook_method_unclear, weight_uncertain
10. 在精准模式下：
   - 如果画面不是单纯碳水或单纯瘦肉，请倾向 hard_reject
   - 如果主体对了，但视角、参照物、分量边界不够理想，请倾向 soft_reject
   - 只有当主体清晰、食物性质明确、可稳定估重时，才返回 ok

重要：请务必使用**简体中文**返回所有文本内容。
请严格按照以下 JSON 格式返回，不要包含任何其他文本：

{{
  "items": [
    {{
      "name": "食物名称（简体中文）",
      "estimatedWeightGrams": 重量（数字）,
      "nutrients": {{ "calories", "protein", "carbs", "fat", "fiber", "sugar" }}
    }}
  ],
  "description": "餐食描述（简体中文）",
  "insight": "健康建议（简体中文）",
  "pfc_ratio_comment": "PFC 比例评价（简体中文，一两句话）",
  "absorption_notes": "吸收率/生物利用度说明（简体中文，一两句话）",
  "context_advice": "情境建议（简体中文，若无则空字符串）",
  "recognitionOutcome": "ok / soft_reject / hard_reject",
  "rejectionReason": "若需拒识或降级，说明原因；否则空字符串",
  "retakeGuidance": ["重拍建议1", "重拍建议2"],
  "allowedFoodCategory": "carb / lean_protein / unknown",
  "sceneTags": ["mixed_food", "needs_reference"]
}}
""".strip()


DASHSCOPE_BASE_URL = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
QWEN_VL_MODEL = "qwen-vl-max"
QWEN_TEXT_MODEL = "qwen-plus"


def run_food_analysis_sync(task: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    同步执行食物分析：使用配置的模型，解析 JSON，返回与 /api/analyze 一致结构的 result。
    失败时抛出异常，由调用方捕获并写 failed。
    """
    llm_provider = os.getenv("LLM_PROVIDER", "qwen").lower()
    if llm_provider == "gemini":
        api_key = os.getenv("OFOXAI_API_KEY") or os.getenv("ofox_ai_apikey")
        if not api_key:
            raise RuntimeError("缺少 OFOXAI_API_KEY 环境变量")
        api_url = "https://api.ofox.ai/v1/chat/completions"
        model = "gemini-3-flash-preview"
    else:
        api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
        if not api_key:
            raise RuntimeError("缺少 DASHSCOPE_API_KEY 环境变量")
        api_url = f"{DASHSCOPE_BASE_URL}/chat/completions"
        model = QWEN_VL_MODEL

    image_url = task.get("image_url")
    image_paths = task.get("image_paths")
    target_image_urls = []
    if image_paths and isinstance(image_paths, list) and len(image_paths) > 0:
        target_image_urls = image_paths
    elif image_url:
        target_image_urls = [image_url]
    if not target_image_urls:
        raise ValueError("任务缺少图片")
    payload = task.get("payload") or {}
    execution_mode = str(payload.get("execution_mode") or "standard").strip().lower()
    if execution_mode not in {"standard", "strict"}:
        execution_mode = "standard"

    user_id = task.get("user_id")
    user = get_user_by_id_sync(user_id) if user_id else None
    profile_block = ""
    if user:
        profile_block = _format_health_profile_sync(user)
        if profile_block:
            profile_block = (
                "\n\n若以下存在「用户健康档案」，请结合档案在 insight、absorption_notes、context_advice 中给出更贴合该用户体质与健康状况的建议。\n\n"
                + profile_block
            )

    prompt = _build_food_prompt(task, profile_block)
    content_parts = [{"type": "text", "text": prompt}]
    for url in target_image_urls:
        content_parts.append({"type": "image_url", "image_url": {"url": url}})

    max_retries = 3
    parsed = None
    
    for attempt in range(max_retries):
        try:
            with httpx.Client(timeout=90.0) as client:
                response = client.post(
                    api_url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": content_parts}],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.7,
                    },
                )

                if not response.is_success:
                    err = response.json() if response.content else {}
                    msg = err.get("error", {}).get("message") or f"API 错误: {response.status_code}"
                    print(f"[worker] Food analysis attempt {attempt + 1} failed: {msg}")
                    if attempt < max_retries - 1:
                        time.sleep(1)
                        continue
                    raise RuntimeError("API 请求失败")

                data = response.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content")
                if not content:
                    print(f"[worker] Food analysis attempt {attempt + 1} empty response")
                    if attempt < max_retries - 1:
                        time.sleep(1)
                        continue
                    raise RuntimeError("AI 返回了空响应")

                json_str = re.sub(r"```json", "", content)
                json_str = re.sub(r"```", "", json_str).strip()
                parsed = json.loads(json_str)
                break  # 成功，跳出重试循环

        except Exception as e:
            print(f"[worker] Food analysis attempt {attempt + 1} exception: {e}")
            if attempt < max_retries - 1:
                time.sleep(1)
            else:
                # hide internal model details
                raise RuntimeError("系统繁忙，请稍后重试")

    # 转为与 API 一致的 result 结构（供前端与保存记录使用）
    items = []
    for item in (parsed.get("items") or []):
        n = item.get("nutrients") or {}
        w = float(item.get("estimatedWeightGrams") or 0)
        items.append({
            "name": str(item.get("name", "未知食物")),
            "estimatedWeightGrams": w,
            "originalWeightGrams": w,
            "nutrients": {
                "calories": float(n.get("calories") or 0),
                "protein": float(n.get("protein") or 0),
                "carbs": float(n.get("carbs") or 0),
                "fat": float(n.get("fat") or 0),
                "fiber": float(n.get("fiber") or 0),
                "sugar": float(n.get("sugar") or 0),
            },
        })

    # 图片模式下：二次纠错清单作为强约束兜底，防止模型忽略用户已确认克重
    items = _apply_image_correction_items(items, payload)

    recognition_fields = _derive_recognition_fields(parsed or {}, items, execution_mode)

    return {
        "description": str(parsed.get("description", "无法获取描述")),
        "insight": str(parsed.get("insight", "保持健康饮食！")),
        "items": items,
        "pfc_ratio_comment": (parsed.get("pfc_ratio_comment") or "").strip() or None,
        "absorption_notes": (parsed.get("absorption_notes") or "").strip() or None,
        "context_advice": (parsed.get("context_advice") or "").strip() or None,
        **recognition_fields,
    }


def process_one_food_task(task: Dict[str, Any]) -> None:
    """处理单条食物分析任务：先审核内容，通过后执行分析并写回 done/failed。"""
    task_id = task["id"]
    try:
        # 第一步：内容审核
        moderation = run_content_moderation_sync(task)
        if moderation and moderation.get("is_violation"):
            reason = moderation.get("reason", "内容违规")
            print(f"[worker] 任务 {task_id} 内容违规: {reason}")
            mark_task_violated_sync(task_id, reason)
            create_violation_record_sync(task, moderation, violation_type="food_analysis")
            return
        # 第二步：正常食物分析
        result = run_food_analysis_sync(task)
        update_analysis_task_result_sync(task_id, status="done", result=result)
    except Exception as e:
        err_msg = str(e) or type(e).__name__
        update_analysis_task_result_sync(task_id, status="failed", error_message=err_msg)


def _build_text_food_prompt(task: Dict[str, Any], profile_block: str) -> str:
    """根据任务 payload 和用户档案构建文字分析用 prompt。"""
    text_input = task.get("text_input") or ""
    payload = task.get("payload") or {}
    
    goal_map = {"muscle_gain": "增肌", "fat_loss": "减脂", "maintain": "维持体重"}
    diet_map = {"fat_loss": "减脂期", "muscle_gain": "增肌期", "maintain": "维持体重", "none": "无特殊目标"}
    activity_map = {"post_workout": "练后", "daily": "日常", "before_sleep": "睡前", "none": "无"}

    user_goal = payload.get("user_goal")
    goal_hint = f" 用户目标为「{goal_map.get(user_goal, user_goal or '')}」，请在 pfc_ratio_comment 中评价本餐 P/C/F 占比是否适合该目标（请忽略健康档案中的任何目标设定，以此为准）。" if user_goal else ""

    diet_goal = payload.get("diet_goal")
    activity_timing = payload.get("activity_timing")
    state_parts = []
    if diet_goal and diet_goal != "none":
        state_parts.append(diet_map.get(diet_goal, diet_goal))
    if activity_timing and activity_timing != "none":
        state_parts.append(activity_map.get(activity_timing, activity_timing))
    state_hint = f" 用户当前状态: {' + '.join(state_parts)}，请在 context_advice 中给出针对性进食建议。" if state_parts else ""

    remaining = payload.get("remaining_calories")
    remain_hint = f" 用户当日剩余热量预算约 {remaining} kcal，可在 context_advice 中提示本餐占比或下一餐建议。" if remaining is not None else ""

    meal_type = payload.get("meal_type")
    meal_name = _meal_name_for_hint(meal_type, payload.get("timezone_offset_minutes"))
    meal_hint = f" 用户选择的是「{meal_name}」，请结合餐次特点在 insight 或 context_advice 中给出建议。" if meal_name else ""

    previous_result = payload.get("previousResult") or {}
    previous_items = previous_result.get("items") or []
    previous_items_text = "；".join(
        f"{idx + 1}. {str(item.get('name') or '').strip()} {float(item.get('estimatedWeightGrams') or 0):g}g"
        for idx, item in enumerate(previous_items)
        if str(item.get("name") or "").strip()
    )
    previous_result_block = ""
    if previous_result:
        prev_desc = str(previous_result.get("description") or "").strip()
        prev_insight = str(previous_result.get("insight") or "").strip()
        parts = []
        if prev_desc:
            parts.append(f"上一轮餐食描述：{prev_desc}")
        if previous_items_text:
            parts.append(f"上一轮识别结果：{previous_items_text}")
        if prev_insight:
            parts.append(f"上一轮健康建议：{prev_insight}")
        if parts:
            previous_result_block = "\n上一轮分析输出 / 当前结果页基线（其中可能已包含用户在结果页直接手动修改后的名称与重量，请优先参考这里，再结合本轮文字说明继续修正）：\n- " + "\n- ".join(parts)

    correction_items = payload.get("correctionItems") or []
    correction_items_text = "\n".join(
        f"{idx + 1}. {str(item.get('name') or '').strip()} {float(item.get('weight') or 0):g}g"
        for idx, item in enumerate(correction_items)
        if str(item.get("name") or "").strip()
    )
    correction_block = (
        "\n第二轮结构化纠错清单（文字模式下仅作参考摘要，不是主输入）：\n" + correction_items_text
    ) if correction_items_text else ""

    additional = (payload.get("additionalContext") or "").strip()
    additional_line = (
        f'\n用户补充/纠错信息："{additional}"。'
        '\n如果这段补充/纠错信息与原始描述或上一轮输出冲突，请优先采用这段补充/纠错信息。'
    ) if additional else ""

    execution_mode = str(payload.get("execution_mode") or "standard").strip().lower()
    if execution_mode not in {"standard", "strict"}:
        execution_mode = "standard"
    mode_hint = (
        "\n执行模式：精准模式（strict）"
        "\n- 优先识别单纯碳水或单纯瘦肉。"
        "\n- 混合描述、重量不明、烹饪方式不明时，不要过度自信。"
        "\n- 如描述仍有歧义，请在 insight/context_advice 中明确指出不确定点。"
    ) if execution_mode == "strict" else (
        "\n执行模式：标准模式（standard）"
        "\n- 可给出常规估算值，不确定时需提醒偏差风险。"
    )

    profile_hint = f"\n\n若以下存在「用户健康档案」，请结合档案在 insight、absorption_notes、context_advice 中给出更贴合该用户体质与健康状况的建议。\n\n{profile_block}" if profile_block else ""

    return f"""
请作为专业的营养师分析用户描述的食物。
这不是第一次分析，而是一次“基于上一轮结果的二次纠错分析”。

用户描述：{text_input}
{previous_result_block}
{correction_block}
{additional_line}

信息优先级（高到低）：
1. 本轮用户补充/纠错信息
2. 上一轮分析输出 / 当前结果页基线
3. 本轮结构化纠错清单
4. 原始用户描述

如果高优先级信息和低优先级信息冲突，必须以前者为准。
不要机械复用上一轮结果；你需要根据本轮文字说明重新得出更新后的食物、重量与营养。

任务：
1. 识别描述中的所有食物单品。
2. 估算每种食物的合理重量（克）和详细营养成分；如果本轮补充说明中给出更晚的重量说明，按本轮补充说明确定。若没有更新重量说明，再参考当前结果页基线与结构化纠错清单。
3. description: 提供这顿饭的简短中文描述。
4. insight: 基于该餐营养成分的一句话健康建议。{meal_hint}
5. pfc_ratio_comment: 本餐蛋白质(P)、脂肪(F)、碳水(C) 占比的简要评价（是否均衡、适合增肌/减脂/维持）。{goal_hint}
6. absorption_notes: 食物组合或烹饪方式对吸收率、生物利用度的简要说明（一两句话）。
7. context_advice: 结合用户状态或剩余热量的情境建议（若无则可为空字符串）。{state_hint}{remain_hint}{profile_hint}
8. 请遵守以下执行模式约束：{mode_hint}
9. 除了常规营养结果外，请额外做“精准模式判定”：
   - recognitionOutcome: 只能是 ok / soft_reject / hard_reject
   - allowedFoodCategory: 只能是 carb / lean_protein / unknown
   - rejectionReason: 若为 soft_reject 或 hard_reject，给出简短中文原因；否则返回空字符串
   - retakeGuidance: 若需用户补充说明或重拍，给 1-3 条简短中文建议；否则返回空数组
   - sceneTags: 仅从以下枚举中选择 0 个或多个：
     single_carb, single_lean_protein, mixed_food, multiple_items, fatty_or_unclear_meat, unsupported_food, portion_unclear, cook_method_unclear, weight_uncertain
10. 在精准模式下：
   - 如果描述不是单纯碳水或单纯瘦肉，请倾向 hard_reject
   - 如果主体类型基本对，但分量、烹饪方式或重量仍不够确定，请倾向 soft_reject
   - 只有当主体明确且可稳定估重时，才返回 ok

重要：请务必使用**简体中文**返回所有文本内容。
请严格按照以下 JSON 格式返回，不要包含任何其他文本：

{{
  "items": [
    {{
      "name": "食物名称（简体中文）",
      "estimatedWeightGrams": 重量（数字）,
      "nutrients": {{ "calories", "protein", "carbs", "fat", "fiber", "sugar" }}
    }}
  ],
  "description": "餐食描述（简体中文）",
  "insight": "健康建议（简体中文）",
  "pfc_ratio_comment": "PFC 比例评价（简体中文，一两句话）",
  "absorption_notes": "吸收率/生物利用度说明（简体中文，一两句话）",
  "context_advice": "情境建议（简体中文，若无则空字符串）",
  "recognitionOutcome": "ok / soft_reject / hard_reject",
  "rejectionReason": "若需拒识或降级，说明原因；否则空字符串",
  "retakeGuidance": ["建议1", "建议2"],
  "allowedFoodCategory": "carb / lean_protein / unknown",
  "sceneTags": ["mixed_food", "weight_uncertain"]
}}
""".strip()


def run_text_food_analysis_sync(task: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    同步执行文字食物分析：使用配置的模型，解析 JSON，返回与 /api/analyze 一致结构的 result。
    失败时抛出异常，由调用方捕获并写 failed。
    """
    llm_provider = os.getenv("LLM_PROVIDER", "qwen").lower()
    if llm_provider == "gemini":
        api_key = os.getenv("OFOXAI_API_KEY") or os.getenv("ofox_ai_apikey")
        if not api_key:
            raise RuntimeError("缺少 OFOXAI_API_KEY 环境变量")
        api_url = "https://api.ofox.ai/v1/chat/completions"
        model = "gemini-3-flash-preview"
    else:
        api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
        if not api_key:
            raise RuntimeError("缺少 DASHSCOPE_API_KEY 环境变量")
        api_url = f"{DASHSCOPE_BASE_URL}/chat/completions"
        model = QWEN_TEXT_MODEL
    text_input = task.get("text_input") or ""
    if not text_input:
        raise ValueError("任务缺少 text_input")
    payload = task.get("payload") or {}
    execution_mode = str(payload.get("execution_mode") or "standard").strip().lower()
    if execution_mode not in {"standard", "strict"}:
        execution_mode = "standard"

    user_id = task.get("user_id")
    user = get_user_by_id_sync(user_id) if user_id else None
    profile_block = ""
    if user:
        profile_block = _format_health_profile_sync(user)

    prompt = _build_text_food_prompt(task, profile_block)

    max_retries = 3
    parsed = None

    for attempt in range(max_retries):
        try:
            with httpx.Client(timeout=60.0) as client:
                response = client.post(
                    api_url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.5,
                    },
                )

                if not response.is_success:
                    err = response.json() if response.content else {}
                    msg = err.get("error", {}).get("message") or f"API 错误: {response.status_code}"
                    print(f"[worker] Text food analysis attempt {attempt + 1} failed: {msg}")
                    if attempt < max_retries - 1:
                        time.sleep(1)
                        continue
                    raise RuntimeError("API 请求失败")

                data = response.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content")
                if not content:
                    print(f"[worker] Text food analysis attempt {attempt + 1} empty response")
                    if attempt < max_retries - 1:
                        time.sleep(1)
                        continue
                    raise RuntimeError("AI 返回了空响应")

                json_str = re.sub(r"```json", "", content)
                json_str = re.sub(r"```", "", json_str).strip()
                parsed = json.loads(json_str)
                break # 成功，跳出重试循环

        except Exception as e:
            print(f"[worker] Text food analysis attempt {attempt + 1} exception: {e}")
            if attempt < max_retries - 1:
                time.sleep(1)
            else:
                # hide internal model details
                raise RuntimeError("系统繁忙，请稍后重试")

    # 转为与 API 一致的 result 结构
    items = []
    for item in (parsed.get("items") or []):
        n = item.get("nutrients") or {}
        w = float(item.get("estimatedWeightGrams") or 0)
        items.append({
            "name": str(item.get("name", "未知食物")),
            "estimatedWeightGrams": w,
            "originalWeightGrams": w,
            "nutrients": {
                "calories": float(n.get("calories") or 0),
                "protein": float(n.get("protein") or 0),
                "carbs": float(n.get("carbs") or 0),
                "fat": float(n.get("fat") or 0),
                "fiber": float(n.get("fiber") or 0),
                "sugar": float(n.get("sugar") or 0),
            },
        })

    recognition_fields = _derive_recognition_fields(parsed or {}, items, execution_mode)

    return {
        "description": str(parsed.get("description", "无法获取描述")),
        "insight": str(parsed.get("insight", "保持健康饮食！")),
        "items": items,
        "pfc_ratio_comment": (parsed.get("pfc_ratio_comment") or "").strip() or None,
        "absorption_notes": (parsed.get("absorption_notes") or "").strip() or None,
        "context_advice": (parsed.get("context_advice") or "").strip() or None,
        **recognition_fields,
    }


def process_one_text_food_task(task: Dict[str, Any]) -> None:
    """处理单条文字食物分析任务：先审核内容，通过后执行分析并写回 done/failed。"""
    task_id = task["id"]
    try:
        # 第一步：内容审核
        moderation = run_content_moderation_sync(task)
        if moderation and moderation.get("is_violation"):
            reason = moderation.get("reason", "内容违规")
            print(f"[worker] 任务 {task_id} 文本违规: {reason}")
            mark_task_violated_sync(task_id, reason)
            create_violation_record_sync(task, moderation, violation_type="food_analysis")
            return
        # 第二步：正常文字食物分析
        result = run_text_food_analysis_sync(task)
        update_analysis_task_result_sync(task_id, status="done", result=result)
    except Exception as e:
        err_msg = str(e) or type(e).__name__
        update_analysis_task_result_sync(task_id, status="failed", error_message=err_msg)


def process_one_public_library_moderation_task(task: Dict[str, Any]) -> None:
    """处理公共食物库文本审核任务。若违规，则标记失败且更新 library_item 状态为 rejected；若通过则更新为 published。"""
    task_id = task["id"]
    payload = task.get("payload") or {}
    item_id = payload.get("item_id")
    try:
        if not item_id:
            raise ValueError("任务 payload 中缺少 item_id")
        
        moderation = run_content_moderation_sync(task)
        if moderation and moderation.get("is_violation"):
            reason = moderation.get("reason", "内容违规")
            print(f"[worker] 任务 {task_id} 文本违规: {reason}")
            mark_task_violated_sync(task_id, reason)
            create_violation_record_sync(task, moderation, violation_type="public_food_library")
            update_public_food_library_status_sync(item_id, "rejected")
        else:
            update_public_food_library_status_sync(item_id, "published")
            update_analysis_task_result_sync(task_id, status="done", result={"status": "approved"})
    except Exception as e:
        err_msg = str(e) or type(e).__name__
        update_analysis_task_result_sync(task_id, status="failed", error_message=err_msg)


def _ocr_report_prompt() -> str:
    """体检报告 OCR 提示词（与 main.py 一致）"""
    return """
你是一个专业的 OCR 文字识别助手。请识别这张体检报告或病例截图中的所有文字内容。
任务要求：
1. **仅提取**图片中实际存在的文字，**严禁**进行总结、概括、分析或生成医疗建议。
2. 如果图片中包含指标数据，请精确提取数值和单位。
3. 如果图片中包含诊断结论，请按原文提取。

请严格按以下 JSON 格式返回（若某项图片中不存在则填空数组或空字符串）：
{
  "indicators": [{"name": "项目名称", "value": "测定值", "unit": "单位", "flag": "异常标记(如↑/↓)"}],
  "conclusions": ["诊断结论1(原文)", "诊断结论2(原文)"],
  "suggestions": ["医学建议(仅提取报告原文中的建议，不要自己生成)"],
  "medical_notes": "其他主要文字内容的原文提取"
}
只返回上述 JSON，不要其他说明。
""".strip()


def run_health_report_ocr_sync(task: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    同步执行体检报告 OCR：调 DashScope 多模态模型，返回 extracted_content。
    完成后写入 user_health_documents，并更新 weapp_user.health_condition.report_extract。
    失败时抛出异常。
    """
    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        raise RuntimeError("缺少 DASHSCOPE_API_KEY（或 API_KEY）环境变量")

    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_url = f"{base_url}/chat/completions"
    image_url = task.get("image_url") or ""
    if not image_url:
        raise ValueError("任务缺少 image_url")

    user_id = task.get("user_id")
    if not user_id:
        raise ValueError("任务缺少 user_id")

    with httpx.Client(timeout=60.0) as client:
        response = client.post(
            api_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": os.getenv("ANALYZE_MODEL", "qwen-vl-max"),
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": _ocr_report_prompt()},
                            {"type": "image_url", "image_url": {"url": image_url}},
                        ],
                    }
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.3,
            },
        )

        if not response.is_success:
            err = response.json() if response.content else {}
            msg = err.get("error", {}).get("message") or f"DashScope API 错误: {response.status_code}"
            raise RuntimeError(msg)

        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not content:
            raise RuntimeError("OCR 返回为空")

        json_str = re.sub(r"```json", "", content)
        json_str = re.sub(r"```", "", json_str).strip()
        extracted = json.loads(json_str)

    # 写入 user_health_documents
    insert_health_document_sync(
        user_id=user_id,
        document_type="report",
        image_url=image_url,
        extracted_content=extracted,
    )

    # 更新 weapp_user.health_condition.report_extract
    user = get_user_by_id_sync(user_id)
    if user:
        hc = dict(user.get("health_condition") or {})
        hc["report_extract"] = extracted
        update_user_sync(user_id, {"health_condition": hc})

    return extracted


def process_one_health_report_task(task: Dict[str, Any]) -> None:
    """处理单条病历提取任务：执行 OCR、写库、更新用户档案。"""
    task_id = task["id"]
    try:
        extracted = run_health_report_ocr_sync(task)
        update_analysis_task_result_sync(task_id, status="done", result={"extracted_content": extracted})
    except Exception as e:
        err_msg = str(e) or type(e).__name__
        update_analysis_task_result_sync(task_id, status="failed", error_message=err_msg)


def _comment_moderation_prompt(content: str) -> str:
    """评论内容审核提示词。"""
    return f"""
你是一个内容安全审核系统。请分析以下用户评论内容，判断是否存在违规情况：

评论内容："{content}"

判断标准：
1. 包含色情、低俗、露骨内容
2. 包含暴力、恐怖、血腥描述
3. 包含违法犯罪相关内容
4. 包含政治敏感言论、地域歧视
5. 包含人身攻击、侮辱谩骂
6. 包含广告、营销、垃圾信息
7. 包含恶意灌水、无意义内容

注意：正常的食物评价（如"好吃"、"推荐"、"味道不错"）不算违规。
只有明确违反上述规则的内容才判定为违规。

请严格按以下 JSON 格式返回，不要包含任何其他文本：
如果不违规：{{"is_violation": false}}
如果违规：{{"is_violation": true, "category": "分类值", "reason": "简要中文原因"}}

category 可选值：pornography, violence, crime, politics, harassment, spam, inappropriate_text, other
""".strip()


def run_comment_moderation_sync(content: str) -> Optional[Dict[str, Any]]:
    """
    对评论内容进行 AI 审核。
    返回审核结果 dict：
      - {"is_violation": False} 表示通过
      - {"is_violation": True, "category": "...", "reason": "..."} 表示违规
    审核失败时返回 None（不阻塞评论流程）。
    """
    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        print("[comment_moderation] 缺少 API_KEY，跳过审核")
        return None

    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_url = f"{base_url}/chat/completions"

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.post(
                api_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "qwen-plus",
                    "messages": [{"role": "user", "content": _comment_moderation_prompt(content)}],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.1,
                },
            )

        if not response.is_success:
            print(f"[comment_moderation] API 请求失败: {response.status_code}")
            return None

        data = response.json()
        raw = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not raw:
            print("[comment_moderation] AI 返回空响应")
            return None

        json_str = re.sub(r"```json", "", raw)
        json_str = re.sub(r"```", "", json_str).strip()
        result = json.loads(json_str)
        print(f"[comment_moderation] 审核结果: {result}")
        return result

    except Exception as e:
        # 审核出错不应阻塞评论流程，仅打印日志
        print(f"[comment_moderation] 审核异常（不阻塞评论）: {e}")
        return None


def process_one_comment_task(task: Dict[str, Any]) -> None:
    """处理单条评论审核任务：先审核，通过后写入评论表。"""
    task_id = task["id"]
    user_id = task["user_id"]
    comment_type = task["comment_type"]
    target_id = task["target_id"]
    content = task["content"]
    rating = task.get("rating")
    
    try:
        # 第一步：内容审核
        moderation = run_comment_moderation_sync(content)
        if moderation and moderation.get("is_violation"):
            reason = moderation.get("reason", "评论内容违规")
            print(f"[comment_worker] 任务 {task_id} 评论违规: {reason}")
            mark_comment_task_violated_sync(task_id, reason)
            # 记录违规日志
            create_violation_record_sync(
                {
                    "id": task_id,
                    "user_id": user_id,
                    "text_input": content,
                },
                moderation,
                violation_type="comment"
            )
            return
        
        # 第二步：审核通过，写入评论表
        if comment_type == "feed":
            comment = add_feed_comment_sync(user_id, target_id, content)
        elif comment_type == "public_food_library":
            comment = add_public_food_library_comment_sync(user_id, target_id, content, rating)
        else:
            raise ValueError(f"未知的评论类型: {comment_type}")
        
        # 第三步：更新任务状态为完成
        update_comment_task_result_sync(task_id, status="done", result={"comment_id": comment["id"]})
        print(f"[comment_worker] 任务 {task_id} 完成，评论 ID: {comment['id']}")
        
    except Exception as e:
        err_msg = str(e) or type(e).__name__
        print(f"[comment_worker] 任务 {task_id} 失败: {err_msg}")
        update_comment_task_result_sync(task_id, status="failed", error_message=err_msg)


def run_comment_worker(worker_id: int, poll_interval: float = 2.0) -> None:
    """
    评论审核 Worker 进程入口：循环抢占 pending 评论任务并处理。
    """
    print(f"[comment-worker-{worker_id}] 启动，处理评论审核任务", flush=True)
    
    while True:
        try:
            task = claim_next_pending_comment_task_sync()
            if task:
                print(f"[comment-worker-{worker_id}] 处理任务 {task['id']}", flush=True)
                process_one_comment_task(task)
                print(f"[comment-worker-{worker_id}] 任务 {task['id']} 完成", flush=True)
            else:
                time.sleep(poll_interval)
        except KeyboardInterrupt:
            print(f"[comment-worker-{worker_id}] 退出", flush=True)
            break
        except Exception as e:
            print(f"[comment-worker-{worker_id}] 错误: {e}", flush=True)
            time.sleep(poll_interval)


def run_worker(worker_id: int, task_type: str = "food", poll_interval: float = 2.0) -> None:
    """
    单 Worker 进程入口：循环抢占 pending 任务并处理。
    task_type: food | food_text | health_report
    """
    print(f"[worker-{worker_id}] 启动，任务类型: {task_type}", flush=True)
    
    # 根据任务类型选择处理函数
    processor_map = {
        "food": process_one_food_task,
        "food_text": process_one_text_food_task,
        "health_report": process_one_health_report_task,
        "public_food_library_text": process_one_public_library_moderation_task,
    }
    processor = processor_map.get(task_type)
    if not processor:
        raise ValueError(f"不支持的任务类型: {task_type}")
    
    while True:
        try:
            task = claim_next_pending_task_sync(task_type)
            if task:
                print(f"[worker-{worker_id}] 处理任务 {task['id']}", flush=True)
                processor(task)
                print(f"[worker-{worker_id}] 任务 {task['id']} 完成", flush=True)
            else:
                time.sleep(poll_interval)
        except KeyboardInterrupt:
            print(f"[worker-{worker_id}] 退出", flush=True)
            break
        except Exception as e:
            print(f"[worker-{worker_id}] 错误: {e}", flush=True)
            time.sleep(poll_interval)


if __name__ == "__main__":
    # 单独运行本文件时：单进程 Worker（用于调试）
    run_worker(worker_id=0, task_type="food")
