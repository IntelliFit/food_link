from __future__ import annotations

from fastapi import FastAPI, HTTPException, Depends, File, UploadFile, Form, Cookie, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, RedirectResponse, JSONResponse
import hashlib
import secrets
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Tuple, Set
import os
if os.name == "nt":
    # 这台 Windows 环境下 _wmi.exec_query 可能卡死，进而导致 import httpx 阻塞。
    # 强制让 platform 走非 WMI 的回退路径，避免后端启动卡住。
    import platform as _platform

    if hasattr(_platform, "_wmi_query"):
        def _disabled_wmi_query(*_args, **_kwargs):
            raise OSError("WMI query disabled for backend startup")

        _platform._wmi_query = _disabled_wmi_query

import httpx
import json
import re
import time
import asyncio
import base64
import math
import mimetypes
import calendar
from datetime import timedelta, datetime, timezone, date
from decimal import Decimal, ROUND_HALF_UP
from dotenv import load_dotenv
from cos_storage import FOOD_IMAGES_BUCKET, resolve_reference_url
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from test_backend.utils import (
    calculate_deviation,
    calculate_item_weight_evaluation,
    calculate_item_weight_evaluation_with_deepseek,
    normalize_expected_items,
    parse_labels_file,
    is_valid_image_file,
)
from exercise_llm import ExerciseLlmError, estimate_exercise_calories_sync

# OfoxAI API（OpenAI 兼容格式，用于调用 Gemini 模型）
OFOXAI_BASE_URL = "https://api.ofox.ai/v1"
FOOD_ANALYSIS_DAILY_LIMIT_ENABLED = os.getenv("FOOD_ANALYSIS_DAILY_LIMIT_ENABLED", "1").strip().lower() in {"1", "true", "yes", "on"}
# 拍照/文字分析每日上限（限次开启时生效）
FOOD_ANALYSIS_DAILY_LIMIT_NON_PRO = 30
FOOD_ANALYSIS_DAILY_LIMIT_PRO = 100
from auth import create_access_token
from database import (
    get_user_by_openid,
    create_user,
    update_user,
    get_user_by_id,
    resolve_user_registration_datetime,
    insert_health_document,
    insert_food_record,
    update_food_record,
    create_analysis_task_sync,
    get_analysis_task_by_id_sync,
    get_analysis_tasks_by_ids,
    list_analysis_tasks_by_user_sync,
    create_precision_session_sync,
    get_precision_session_by_id_sync,
    update_precision_session_sync,
    create_precision_session_round_sync,
    list_precision_session_rounds_sync,
    create_precision_item_estimate_sync,
    list_precision_item_estimates_sync,
    list_food_records,
    list_food_records_by_range,
    get_streak_days,
    get_cached_insight,
    get_latest_cached_insight,
    upsert_insight_cache,
    list_user_weight_records,
    upsert_user_weight_record,
    list_user_water_logs,
    create_user_water_log,
    delete_user_water_logs_by_date,
    get_user_body_metric_settings,
    upsert_user_body_metric_settings,
    insert_critical_samples,
    upload_health_report_image,
    upload_food_analyze_image,
    upload_food_analyze_image_bytes,
    upload_user_avatar,
    search_users,
    is_friend,
    add_friend_pair,
    build_friend_invite_code,
    resolve_user_by_friend_invite_code,
    create_invite_referral_binding,
    send_friend_request,
    get_friend_requests_received,
    respond_friend_request,
    cancel_sent_friend_request,
    get_friends_with_profile,
    delete_friend_pair,
    get_friend_requests_overview,
    cleanup_duplicate_friends,
    list_friends_feed_records,
    get_friend_circle_week_checkin_leaderboard,
    list_public_feed_records,
    add_feed_like,
    remove_feed_like,
    get_feed_likes_for_records,
    add_feed_comment,
    get_feed_comment_by_id,
    get_feed_record_interaction_context,
    list_feed_comments,
    list_feed_interaction_notifications,
    count_unread_feed_interaction_notifications,
    mark_feed_interaction_notifications_read,
    create_feed_interaction_notification_sync,
    add_feed_comment_sync,
    add_public_food_library_comment_sync,
    add_public_food_library_feedback_sync,
    get_food_record_by_id_sync,
    get_feed_comment_by_id_sync,
    # 公共食物库
    create_public_food_library_item,
    list_public_food_library,
    get_public_food_library_item,
    list_my_public_food_library,
    add_public_food_library_like,
    remove_public_food_library_like,
    get_public_food_library_likes_for_items,
    add_public_food_library_collection,
    remove_public_food_library_collection,
    get_public_food_library_collections_for_items,
    list_collected_public_food_library,
    add_public_food_library_comment,
    list_public_food_library_comments,
    get_food_record_by_id,
    delete_food_record,
    hide_food_record_from_feed,
    create_food_expiry_item_v2,
    list_food_expiry_items_v2,
    get_food_expiry_item_v2,
    update_food_expiry_item_v2,
    delete_food_expiry_item_v2,
    upsert_food_expiry_notification_job,
    cancel_food_expiry_notification_jobs_by_item,
    list_food_expiry_notification_jobs_by_item,
    # 私人食谱
    create_user_recipe,
    list_user_recipes,
    get_user_recipe,
    update_user_recipe,
    delete_user_recipe,
    use_recipe_record,
    update_analysis_task_result_sync,
    update_analysis_task_result,
    # 评论任务
    create_comment_task_sync,
    list_comment_tasks_by_user_sync,
    insert_user_mode_switch_log_sync,
    list_active_membership_plans,
    get_membership_plan_by_code,
    get_user_pro_membership,
    save_user_pro_membership,
    create_pro_membership_payment_record,
    list_pro_membership_payment_records,
    get_pro_membership_payment_record_by_order_no,
    update_pro_membership_payment_record,
    get_first_membership_trial_batch_rank,
    get_daily_membership_bonus_breakdown,
    claim_share_poster_bonus,
    get_today_food_analysis_count,
    get_today_exercise_log_count,
    get_latest_user_weight_record,
    list_test_backend_datasets,
    get_test_backend_dataset,
    create_test_backend_dataset,
    insert_test_backend_dataset_items,
    list_test_backend_dataset_items,
    search_manual_food,
    log_unresolved_food,
    browse_manual_food_library,
    # 运动记录
    list_user_exercise_logs,
    create_user_exercise_log,
    delete_user_exercise_log,
    get_exercise_calories_by_date,
    exercise_fallback_task_type,
)
from middleware import get_current_user_info, get_current_user_id, get_current_openid, get_optional_user_info
from metabolic import calculate_bmr, calculate_tdee, get_age_from_birthday

# 从 .env 文件加载环境变量
BACKEND_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(BACKEND_ENV_PATH, override=True)
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-3-flash-preview")

# 中国时区（UTC+8），用于按本地自然日统计
CHINA_TZ = timezone(timedelta(hours=8))
VALID_EXECUTION_MODES = {"standard", "strict"}
DEFAULT_EXECUTION_MODE = "standard"
VALID_MODE_SET_BY = {"system", "user_manual", "coach_manual"}


def _get_china_today_str() -> str:
    """返回中国时区的今天日期字符串。"""
    return datetime.now(CHINA_TZ).strftime("%Y-%m-%d")


def _format_china_time_hhmm(value: Any) -> str:
    """将 ISO 时间戳格式化为中国时区 HH:mm。"""
    if not value:
        return "00:00"
    try:
        dt = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(CHINA_TZ).strftime("%H:%M")
    except Exception:
        return "00:00"


# 餐次枚举：以 6 餐次为主，兼容历史 snack
MEAL_TYPE_DESCRIPTION = (
    "餐次: breakfast / morning_snack / lunch / afternoon_snack / dinner / evening_snack"
    "（兼容 legacy: snack）"
)
MEAL_DISPLAY_ORDER = (
    "breakfast",
    "morning_snack",
    "lunch",
    "afternoon_snack",
    "dinner",
    "evening_snack",
)
MEAL_PLAN_WEIGHTS = {
    "breakfast": 3,
    "lunch": 4,
    "dinner": 3,
}
SNACK_MEAL_TARGET_REFERENCE = 150.0
SNACK_TARGET_TAG = "加餐参考，不计入总目标"
MEAL_NAMES = {
    "breakfast": "早餐",
    "morning_snack": "早加餐",
    "lunch": "午餐",
    "afternoon_snack": "午加餐",
    "dinner": "晚餐",
    "evening_snack": "晚加餐",
    # 兼容历史值：旧版本只有 snack
    "snack": "午加餐",
}
VALID_MEAL_TYPES = set(MEAL_DISPLAY_ORDER) | {"snack"}

EXPIRY_STORAGE_TYPES = {"room_temp", "refrigerated", "frozen"}
EXPIRY_STATUS_TYPES = {"active", "consumed", "discarded"}
EXPIRY_SOURCE_TYPES = {"manual", "ocr", "ai"}
EXPIRY_RECOGNITION_CATEGORY_OPTIONS = (
    "乳制品",
    "水果",
    "蔬菜",
    "肉类",
    "海鲜",
    "蛋类",
    "豆制品",
    "熟食",
    "剩菜",
    "主食",
    "面包",
    "零食",
    "饮料",
    "冷冻食品",
    "调味品",
    "其他",
)
EXPIRY_RECOGNITION_MISSING_FIELDS = {
    "food_name",
    "category",
    "storage_type",
    "quantity_note",
    "expire_date",
    "note",
}
EXPIRY_SUBSCRIBE_ACCEPT_STATUSES = {"accept", "acceptwithalert", "acceptwithaudio"}
EXPIRY_NOTIFICATION_TEMPLATE_ID = str(os.getenv("EXPIRY_SUBSCRIBE_TEMPLATE_ID") or "").strip()
EXPIRY_NOTIFICATION_PAGE = "/pages/expiry/index"
EXPIRY_NOTIFICATION_DEFAULT_HOUR = 9
EXPIRY_NOTIFICATION_MAX_RETRY = 3
BODY_METRIC_SOURCE_TYPES = {"manual", "imported", "ai"}
DEFAULT_WATER_GOAL_ML = 2000

EXPIRY_URGENCY_LABELS = {
    "expired": "已过期",
    "today": "今天到期",
    "soon": "即将到期",
    "fresh": "保鲜中",
}


def _build_dashboard_meal_targets(calorie_target: float) -> Dict[str, float]:
    """三餐按总目标动态分配；加餐仅给统一参考值，不计入总目标。"""
    total_weight = sum(MEAL_PLAN_WEIGHTS.values())
    targets: Dict[str, float] = {meal_type: 0.0 for meal_type in MEAL_DISPLAY_ORDER}

    if calorie_target > 0 and total_weight > 0:
        main_meals = list(MEAL_PLAN_WEIGHTS.keys())
        remaining = round(float(calorie_target), 1)
        for meal_type in main_meals[:-1]:
            weight = MEAL_PLAN_WEIGHTS[meal_type]
            portion = round(float(calorie_target) * weight / total_weight, 1)
            targets[meal_type] = portion
            remaining = round(remaining - portion, 1)
        targets[main_meals[-1]] = max(0.0, round(remaining, 1))

    for snack_meal_type in ("morning_snack", "afternoon_snack", "evening_snack"):
        targets[snack_meal_type] = SNACK_MEAL_TARGET_REFERENCE

    return targets


def _normalize_execution_mode(value: Optional[str], default: str = DEFAULT_EXECUTION_MODE) -> str:
    mode = (value or "").strip().lower()
    if mode in VALID_EXECUTION_MODES:
        return mode
    return default


def _parse_execution_mode_or_raise(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    mode = str(value).strip().lower()
    if not mode:
        return None
    if mode not in VALID_EXECUTION_MODES:
        raise HTTPException(status_code=400, detail="execution_mode 必须为 standard 或 strict")
    return mode


def _is_food_debug_queue_enabled() -> bool:
    return str(os.getenv("FOOD_DEBUG_TASK_QUEUE") or "").strip().lower() in {"1", "true", "yes", "on"}


def _is_food_analysis_debug_enabled() -> bool:
    return str(os.getenv("FOOD_ANALYSIS_DEBUG") or "").strip().lower() in {"1", "true", "yes", "on"}


def _debug_log_food_submit(stage: str, payload: Any) -> None:
    if not _is_food_analysis_debug_enabled():
        return
    try:
        if isinstance(payload, (dict, list)):
            body = json.dumps(payload, ensure_ascii=False, indent=2)
        else:
            body = str(payload)
    except Exception as exc:
        body = f"<serialize_failed: {exc}>"
    print(
        f"[food_debug_submit] stage={stage}_BEGIN\n"
        f"{body}\n"
        f"[food_debug_submit] stage={stage}_END",
        flush=True,
    )


def _get_food_task_type(base_task_type: str) -> str:
    """调试模式下使用专用任务队列，避免被其他环境 Worker 抢占。"""
    return f"{base_task_type}_debug" if _is_food_debug_queue_enabled() else base_task_type


def _should_use_exercise_debug_queue() -> bool:
    """本地联调时让运动任务也走隔离队列，避免被共享库里的旧 worker 抢走。"""
    return _is_food_debug_queue_enabled()


def _build_execution_mode_hint(execution_mode: str) -> str:
    """构建执行模式提示词约束。"""
    if execution_mode == "strict":
        return """
执行模式：精准模式（strict）
- 优先识别“单纯碳水”或“单纯瘦肉”，例如米饭/馒头/红薯/面包、去皮鸡鸭肉/鱼肉/瘦畜肉。
- 若为混合食物（盖浇饭、炒菜、油炸裹粉、肥瘦混合等）或无法判断肥瘦比例，请不要给确定克数。
- 遇到以上情况，请在 insight/context_advice 中明确提示用户：分开拍、拨开拍或重拍后再分析。
""".strip()
    return """
执行模式：标准模式（standard）
- 可以给出常规估算值；若不确定，请给保守估算并提示存在偏差风险。
""".strip()


PRECISION_SOURCE_TYPES = {"image", "text"}
PRECISION_SESSION_ACTIVE_STATUSES = {"collecting", "estimating", "needs_user_input", "needs_retake"}


def _serialize_reference_objects(
    reference_objects: Optional[List[PrecisionReferenceObjectInput]],
) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for ref in reference_objects or []:
        ref_name = str(ref.reference_name or "").strip()
        if not ref_name:
            continue
        dims = ref.dimensions_mm.dict() if ref.dimensions_mm else {}
        normalized_dims = {
            "length": float(dims["length"]) if dims.get("length") is not None else None,
            "width": float(dims["width"]) if dims.get("width") is not None else None,
            "height": float(dims["height"]) if dims.get("height") is not None else None,
        }
        result.append({
            "reference_type": str(ref.reference_type or "preset").strip() or "preset",
            "reference_name": ref_name,
            "dimensions_mm": normalized_dims,
            "placement_note": str(ref.placement_note or "").strip() or None,
            "applies_to_items": [str(item).strip() for item in (ref.applies_to_items or []) if str(item).strip()],
        })
    return result


def _build_precision_intermediate_response(
    *,
    session_id: str,
    round_index: int,
    planner_result: Dict[str, Any],
    redirect_task_id: Optional[str] = None,
) -> Dict[str, Any]:
    followup_questions = planner_result.get("followupQuestions")
    retake_instructions = planner_result.get("retakeInstructions")
    if not isinstance(followup_questions, list):
        followup_questions = []
    if not isinstance(retake_instructions, list):
        retake_instructions = []
    precision_status = str(planner_result.get("precisionStatus") or "needs_user_input")
    detected_items_summary = planner_result.get("detectedItemsSummary")
    if not isinstance(detected_items_summary, list):
        detected_items_summary = []
    pending_requirements = planner_result.get("pendingRequirements")
    if not isinstance(pending_requirements, list):
        pending_requirements = []
    reference_object_suggestions = planner_result.get("referenceObjectSuggestions")
    if not isinstance(reference_object_suggestions, list):
        reference_object_suggestions = []
    uncertainty_notes = planner_result.get("uncertaintyNotes")
    if not isinstance(uncertainty_notes, list):
        uncertainty_notes = []
    description = str(planner_result.get("description") or "")
    insight = str(planner_result.get("insight") or "")
    if not description:
        description = "需要继续补充信息" if precision_status == "needs_user_input" else "建议先重拍后继续"
    if not insight:
        insight = "精准模式会根据你补充的信息继续估计。"
    response = {
        "description": description,
        "insight": insight,
        "items": [],
        "pfc_ratio_comment": None,
        "absorption_notes": None,
        "context_advice": None,
        "recognitionOutcome": "soft_reject" if precision_status != "done" else "ok",
        "rejectionReason": str(planner_result.get("rejectionReason") or "").strip() or None,
        "retakeGuidance": retake_instructions or None,
        "allowedFoodCategory": str(planner_result.get("allowedFoodCategory") or "unknown"),
        "followupQuestions": followup_questions or None,
        "precisionSessionId": session_id,
        "precisionStatus": precision_status,
        "precisionRoundIndex": round_index,
        "pendingRequirements": pending_requirements or None,
        "retakeInstructions": retake_instructions or None,
        "referenceObjectNeeded": bool(planner_result.get("referenceObjectNeeded")),
        "referenceObjectSuggestions": reference_object_suggestions or None,
        "detectedItemsSummary": detected_items_summary or None,
        "splitStrategy": str(planner_result.get("splitStrategy") or ""),
        "uncertaintyNotes": uncertainty_notes or None,
    }
    if redirect_task_id:
        response["redirectTaskId"] = redirect_task_id
    return response


def _build_precision_continue_payload(
    *,
    source_type: str,
    meal_type: Optional[str],
    timezone_offset_minutes: Optional[int],
    province: Optional[str],
    city: Optional[str],
    district: Optional[str],
    diet_goal: Optional[str],
    activity_timing: Optional[str],
    user_goal: Optional[str],
    remaining_calories: Optional[float],
    additional_context: Optional[str],
    is_multi_view: Optional[bool],
    reference_objects: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    return {
        "source_type": source_type,
        "meal_type": meal_type,
        "timezone_offset_minutes": timezone_offset_minutes,
        "province": province,
        "city": city,
        "district": district,
        "diet_goal": diet_goal,
        "activity_timing": activity_timing,
        "user_goal": user_goal,
        "remaining_calories": remaining_calories,
        "additionalContext": additional_context,
        "is_multi_view": bool(is_multi_view),
        "reference_objects": reference_objects or [],
    }


def _create_precision_plan_task_payload(
    session_id: str,
    source_type: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    next_payload = dict(payload or {})
    next_payload["precision_session_id"] = session_id
    next_payload["source_type"] = source_type
    return next_payload


def _parse_china_datetime(value: Any) -> Optional[datetime]:
    """将记录时间统一解析为中国时区 datetime，失败返回 None。"""
    if not value:
        return None
    try:
        dt = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(CHINA_TZ)
    except Exception:
        return None


def _load_pem_value(value_or_path: Optional[str], env_name: str) -> str:
    """从环境变量值或文件路径加载 PEM 内容。"""
    raw = (value_or_path or "").strip()
    if not raw:
        raise HTTPException(status_code=500, detail=f"缺少环境变量：{env_name}")
    if "BEGIN " in raw:
        return raw
    if os.path.exists(raw):
        with open(raw, "r", encoding="utf-8") as fp:
            return fp.read()
    raise HTTPException(status_code=500, detail=f"{env_name} 配置无效，既不是 PEM 内容也不是可读文件路径")


def _get_wechat_pay_config() -> Dict[str, str]:
    """读取微信支付配置。"""
    appid = os.getenv("APPID", "").strip()
    mchid = os.getenv("WECHAT_PAY_MCHID", "").strip()
    notify_url = os.getenv("WECHAT_PAY_NOTIFY_URL", "").strip()
    serial_no = os.getenv("WECHAT_PAY_SERIAL_NO", "").strip()
    api_v3_key = os.getenv("WECHAT_PAY_API_V3_KEY", "").strip()
    private_key = _load_pem_value(
        os.getenv("WECHAT_PAY_PRIVATE_KEY") or os.getenv("WECHAT_PAY_PRIVATE_KEY_PATH"),
        "WECHAT_PAY_PRIVATE_KEY / WECHAT_PAY_PRIVATE_KEY_PATH",
    )
    public_key_raw = (os.getenv("WECHAT_PAY_PUBLIC_KEY") or os.getenv("WECHAT_PAY_PUBLIC_KEY_PATH") or "").strip()
    public_key = _load_pem_value(
        public_key_raw,
        "WECHAT_PAY_PUBLIC_KEY / WECHAT_PAY_PUBLIC_KEY_PATH",
    ) if public_key_raw else ""

    missing = []
    if not appid:
        missing.append("APPID")
    if not mchid:
        missing.append("WECHAT_PAY_MCHID")
    if not notify_url:
        missing.append("WECHAT_PAY_NOTIFY_URL")
    if not serial_no:
        missing.append("WECHAT_PAY_SERIAL_NO")
    if not api_v3_key:
        missing.append("WECHAT_PAY_API_V3_KEY")
    if missing:
        raise HTTPException(status_code=500, detail=f"缺少微信支付配置：{', '.join(missing)}")

    return {
        "appid": appid,
        "mchid": mchid,
        "notify_url": notify_url,
        "serial_no": serial_no,
        "api_v3_key": api_v3_key,
        "private_key": private_key,
        "public_key": public_key,
    }


def _to_decimal_amount(value: Any) -> Decimal:
    return Decimal(str(value or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _amount_to_fen(value: Any) -> int:
    return int((_to_decimal_amount(value) * 100).to_integral_value(rounding=ROUND_HALF_UP))


def _generate_membership_order_no() -> str:
    timestamp = datetime.now(CHINA_TZ).strftime("%Y%m%d%H%M%S")
    suffix = secrets.token_hex(4).upper()
    return f"PM{timestamp}{suffix}"


def _add_months(dt: datetime, months: int) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    total_month = dt.month - 1 + months
    year = dt.year + total_month // 12
    month = total_month % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    day = min(dt.day, last_day)
    return dt.replace(year=year, month=month, day=day)


def _parse_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _map_legacy_snack_to_slot(record_time: Any = None) -> str:
    """
    旧 snack 记录按时间段映射到新加餐：
    - 00:00-10:59 -> 早加餐
    - 11:00-16:59 -> 午加餐
    - 17:00-23:59 -> 晚加餐
    """
    dt = _parse_china_datetime(record_time)
    if not dt:
        return "afternoon_snack"
    h = dt.hour
    if h < 11:
        return "morning_snack"
    if h < 17:
        return "afternoon_snack"
    return "evening_snack"


def _normalize_meal_type(meal_type: Optional[str], record_time: Any = None, default: str = "afternoon_snack") -> str:
    """将 meal_type 归一化到 6 餐次，兼容 legacy snack。"""
    mt = (meal_type or "").strip()
    if mt in MEAL_DISPLAY_ORDER:
        return mt
    if mt == "snack":
        return _map_legacy_snack_to_slot(record_time)
    return default


def _meal_name(
    meal_type: Optional[str],
    record_time: Any = None,
    timezone_offset_minutes: Optional[int] = None,
) -> str:
    normalized = _normalize_meal_type(meal_type, record_time=record_time, default="afternoon_snack")
    # 兼容 legacy snack：未提供记录时间时按客户端时区（兜底东八区）仅区分午后/晚间。
    if (meal_type or "").strip() == "snack" and record_time is None:
        now_hour = datetime.now(CHINA_TZ).hour
        if timezone_offset_minutes is not None:
            try:
                offset = int(timezone_offset_minutes)
                if -840 <= offset <= 840:
                    # JS getTimezoneOffset 定义：UTC - local（分钟），因此 local = UTC - offset
                    now_hour = (datetime.now(timezone.utc) - timedelta(minutes=offset)).hour
            except Exception:
                pass
        normalized = "afternoon_snack" if 11 <= now_hour < 17 else "evening_snack"
    return MEAL_NAMES.get(normalized, normalized)


def _build_location_text(
    province: Optional[str],
    city: Optional[str],
    district: Optional[str],
) -> str:
    parts: List[str] = []
    for raw in (province, city, district):
        text = str(raw or "").strip()
        if text and text not in parts:
            parts.append(text)
    return " ".join(parts).strip()


def _build_by_meal_calories(records: List[Dict[str, Any]]) -> Dict[str, float]:
    """按 6 餐次聚合热量，并保留 snack 兼容字段。"""
    totals: Dict[str, float] = {k: 0.0 for k in MEAL_DISPLAY_ORDER}
    for r in records:
        mt = _normalize_meal_type(r.get("meal_type"), record_time=r.get("record_time"))
        totals[mt] = totals.get(mt, 0.0) + float(r.get("total_calories") or 0)
    out = {k: round(totals.get(k, 0.0), 1) for k in MEAL_DISPLAY_ORDER}
    # 兼容旧前端字段
    out["snack"] = out["afternoon_snack"]
    return out


def _build_json_datetime(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat()


def _parse_date_string(value: Optional[str], field_name: str) -> Optional[str]:
    """校验 YYYY-MM-DD 日期字符串，合法则原样返回。"""
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        datetime.strptime(raw, "%Y-%m-%d")
        return raw
    except Exception:
        raise HTTPException(status_code=400, detail=f"{field_name} 必须为 YYYY-MM-DD")


def _normalize_expiry_storage_type(value: Optional[str]) -> str:
    storage_type = (value or "").strip().lower() or "refrigerated"
    if storage_type not in EXPIRY_STORAGE_TYPES:
        raise HTTPException(status_code=400, detail="storage_type 必须为 room_temp / refrigerated / frozen")
    return storage_type


def _normalize_expiry_status(value: Optional[str], default: str = "active") -> str:
    status = (value or "").strip().lower() or default
    if status not in EXPIRY_STATUS_TYPES:
        raise HTTPException(status_code=400, detail="status 必须为 active / consumed / discarded")
    return status


def _normalize_expiry_source_type(value: Optional[str], default: str = "manual") -> str:
    source_type = (value or "").strip().lower() or default
    if source_type not in EXPIRY_SOURCE_TYPES:
        raise HTTPException(status_code=400, detail="source_type 必须为 manual / ocr / ai")
    return source_type


def _normalize_food_expiry_item(row: Dict[str, Any], today_local: Optional[datetime] = None) -> Dict[str, Any]:
    """补充保质期条目的派生字段，便于前端直接渲染。"""
    item = dict(row)
    today = (today_local or datetime.now(CHINA_TZ)).date()
    expire_date_raw = row.get("expire_date")

    days_until_expire: Optional[int] = None
    urgency = "fresh"
    if expire_date_raw:
        try:
            expire_date = datetime.strptime(str(expire_date_raw), "%Y-%m-%d").date()
            days_until_expire = (expire_date - today).days
            if days_until_expire < 0:
                urgency = "expired"
            elif days_until_expire == 0:
                urgency = "today"
            elif days_until_expire <= 2:
                urgency = "soon"
            else:
                urgency = "fresh"
        except Exception:
            days_until_expire = None

    status = (row.get("status") or "active").strip().lower()
    item["status"] = status if status in EXPIRY_STATUS_TYPES else "active"
    item["days_until_expire"] = days_until_expire
    item["urgency"] = urgency if item["status"] == "active" else "fresh"
    item["urgency_label"] = EXPIRY_URGENCY_LABELS.get(item["urgency"], "保鲜中")
    item["storage_type_label"] = {
        "room_temp": "常温",
        "refrigerated": "冷藏",
        "frozen": "冷冻",
    }.get(row.get("storage_type"), "冷藏")
    item["status_label"] = {
        "active": "保鲜中",
        "consumed": "已吃完",
        "discarded": "已丢弃",
    }.get(item["status"], "保鲜中")
    return item


def _normalize_food_expiry_recognition_missing_fields(value: Any) -> List[str]:
    fields = value if isinstance(value, list) else []
    normalized: List[str] = []
    for item in fields:
        field = str(item or "").strip()
        if not field or field not in EXPIRY_RECOGNITION_MISSING_FIELDS:
            continue
        if field not in normalized:
            normalized.append(field)
    return normalized


def _normalize_food_expiry_recognition_item(
    raw_item: Dict[str, Any],
    *,
    today_local: Optional[datetime] = None,
) -> Optional[Dict[str, Any]]:
    if not isinstance(raw_item, dict):
        return None

    today = (today_local or datetime.now(CHINA_TZ)).date()
    food_name = str(raw_item.get("food_name") or raw_item.get("name") or "").strip()
    if not food_name:
        return None

    category = str(raw_item.get("category") or "").strip() or "其他"
    if len(category) > 30:
        category = category[:30].strip() or "其他"

    storage_type = _normalize_expiry_storage_type(str(raw_item.get("storage_type") or "refrigerated"))
    quantity_note = str(raw_item.get("quantity_note") or "").strip() or None
    if quantity_note and len(quantity_note) > 40:
        quantity_note = quantity_note[:40].strip() or None

    suggested_days_raw = raw_item.get("suggested_days")
    try:
        suggested_days = int(suggested_days_raw) if suggested_days_raw is not None else None
    except Exception:
        suggested_days = None
    if suggested_days is None:
        suggested_days = 3
    suggested_days = max(0, min(suggested_days, 365))

    expire_date = _parse_date_string(str(raw_item.get("expire_date") or "").strip() or None, "expire_date")
    if not expire_date:
        expire_date = (today + timedelta(days=suggested_days)).strftime("%Y-%m-%d")

    note = str(raw_item.get("note") or "").strip() or None
    recognition_basis = str(raw_item.get("recognition_basis") or "").strip() or None
    if recognition_basis and len(recognition_basis) > 120:
        recognition_basis = recognition_basis[:120].strip() or None
    if note and len(note) > 200:
        note = note[:200].strip() or None
    if not note and recognition_basis:
        note = recognition_basis

    confidence_raw = raw_item.get("confidence")
    try:
        confidence = float(confidence_raw) if confidence_raw is not None else None
    except Exception:
        confidence = None
    if confidence is not None:
        confidence = max(0.0, min(confidence, 1.0))

    expire_date_is_estimated = bool(raw_item.get("expire_date_is_estimated"))
    missing_fields = _normalize_food_expiry_recognition_missing_fields(raw_item.get("missing_fields"))

    item = {
        "food_name": food_name[:60].strip(),
        "category": category,
        "storage_type": storage_type,
        "quantity_note": quantity_note,
        "expire_date": expire_date,
        "opened_date": None,
        "note": note,
        "source_type": "ai",
        "status": "active",
        "suggested_days": suggested_days,
        "expire_date_is_estimated": expire_date_is_estimated,
        "confidence": confidence,
        "recognition_basis": recognition_basis,
        "missing_fields": missing_fields,
    }
    return item


def _build_food_expiry_recognition_prompt(
    *,
    today_str: str,
    additional_context: str = "",
) -> str:
    context_block = additional_context.strip()
    if context_block:
        context_block = f"\n用户补充说明：{context_block}\n"
    return f"""
你是一个“食物保质期录入助手”。你的任务不是做营养分析，而是帮用户从图片里提取“适合录入保质期提醒”的结构化信息。

今天日期：{today_str}
{context_block}
请根据图片识别多个食物，并输出适合前端表单预填的 JSON。

要求：
1. 支持一张图里出现多个食物，也支持多张图是同一批食物的不同角度。
2. 如果多张图里是同一个食物的不同角度，只保留 1 条，不要重复输出。
3. 尽量识别并填写：
   - food_name：食物名
   - category：只能从这些分类中选择最接近的一项：{", ".join(EXPIRY_RECOGNITION_CATEGORY_OPTIONS)}
   - storage_type：只能为 room_temp / refrigerated / frozen
   - quantity_note：如 2盒 / 半袋 / 3个，无法判断可留空
   - expire_date：必须输出 YYYY-MM-DD
   - note：给用户看的短备注，可写“AI 根据冷藏剩菜常见保存期预估，请确认”
4. 如果包装上能清晰看到明确到期日/最佳赏味期，优先用图片中的明确日期，并将 expire_date_is_estimated 设为 false。
5. 如果看不到明确日期，但能根据食物类型、储存方式、常见经验给出建议，请自行补充 suggested_days，并把 expire_date 设为“今天 + suggested_days”，同时将 expire_date_is_estimated 设为 true。
6. 如果 quantity_note、日期、储存方式等识别不清，可以留空或保守猜测，但要在 missing_fields 中写出仍建议用户手动确认的字段。
7. 只输出你相对有把握的食物；不要把背景里的无关物体当成食物。
8. 最多输出 8 条食物。

返回 JSON，格式严格如下：
{{
  "items": [
    {{
      "food_name": "纯牛奶",
      "category": "乳制品",
      "storage_type": "refrigerated",
      "quantity_note": "2盒",
      "expire_date": "{today_str}",
      "expire_date_is_estimated": true,
      "suggested_days": 3,
      "note": "AI 根据常见冷藏乳制品保存期预估，请确认包装日期",
      "recognition_basis": "识别到牛奶包装，但未看清明确到期日",
      "confidence": 0.82,
      "missing_fields": ["quantity_note"]
    }}
  ]
}}

只返回 JSON，不要输出额外解释。
""".strip()


def _recognize_food_expiry_from_images_sync(
    image_urls: List[str],
    *,
    today_local: Optional[datetime] = None,
    additional_context: str = "",
) -> Dict[str, Any]:
    if not image_urls:
        raise RuntimeError("缺少图片")

    from worker import _run_json_completion_sync

    today = today_local or datetime.now(CHINA_TZ)
    prompt = _build_food_expiry_recognition_prompt(
        today_str=today.strftime("%Y-%m-%d"),
        additional_context=additional_context,
    )
    content_parts: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
    for url in image_urls:
        content_parts.append({"type": "image_url", "image_url": {"url": url}})

    parsed = _run_json_completion_sync(
        source_type="image",
        content=content_parts,
        timeout_seconds=75.0,
        temperature=0.2,
    )
    raw_items = parsed.get("items") if isinstance(parsed, dict) else None
    if not isinstance(raw_items, list):
        raw_items = []

    items: List[Dict[str, Any]] = []
    for raw_item in raw_items:
        normalized = _normalize_food_expiry_recognition_item(raw_item, today_local=today)
        if normalized:
            items.append(normalized)

    if not items:
        raise RuntimeError("未识别到可用于保质期录入的食物，请换个角度拍清楚包装或食物主体后再试")

    return {
        "items": items,
        "recognized_count": len(items),
    }


def _normalize_subscribe_status(value: Optional[str]) -> str:
    return str(value or "").strip()


def _build_food_expiry_notification_schedule(item: Dict[str, Any], now_local: Optional[datetime] = None) -> Optional[datetime]:
    expire_date_raw = item.get("expire_date")
    if not expire_date_raw:
        return None
    now_local = now_local or datetime.now(CHINA_TZ)
    try:
        expire_date = datetime.strptime(str(expire_date_raw), "%Y-%m-%d").date()
    except Exception:
        return None
    if expire_date < now_local.date():
        return None

    scheduled_local = datetime.combine(
        expire_date,
        datetime.min.time(),
        tzinfo=CHINA_TZ,
    ).replace(hour=EXPIRY_NOTIFICATION_DEFAULT_HOUR, minute=0, second=0, microsecond=0)

    if expire_date == now_local.date() and scheduled_local <= now_local:
        return now_local + timedelta(minutes=1)
    return scheduled_local


def _normalize_food_expiry_character_string(value: Any, fallback: str = "NA") -> str:
    raw = str(value or "").strip()
    if not raw:
        return fallback

    sanitized = re.sub(r"[^A-Za-z0-9\s\-_.,:/+#()xX]", "", raw)
    sanitized = re.sub(r"\s+", " ", sanitized).strip()
    return sanitized[:32] or fallback


def _build_food_expiry_notification_payload(item: Dict[str, Any]) -> Dict[str, Any]:
    location = str(item.get("storage_type_label") or "").strip() or "未填写"
    quantity = _normalize_food_expiry_character_string(item.get("quantity_note"))
    expire_date = str(item.get("expire_date") or "").strip()
    return {
        "thing1": {"value": str(item.get("food_name") or "").strip() or "未命名食物"},
        "time2": {"value": f"{expire_date} 09:00" if expire_date else "未填写"},
        "thing3": {"value": "今天到期，请优先处理"},
        "thing4": {"value": location},
        "character_string5": {"value": quantity},
    }


async def _reconcile_food_expiry_notification_job(
    user_id: str,
    openid: str,
    item: Dict[str, Any],
    subscribed: bool,
    allow_create: bool = False,
) -> Optional[Dict[str, Any]]:
    item_id = str(item.get("id") or "").strip()
    if not item_id:
        return None

    existing_jobs = await list_food_expiry_notification_jobs_by_item(item_id)
    has_notification_history = bool(existing_jobs)

    if (
        not subscribed
        or not EXPIRY_NOTIFICATION_TEMPLATE_ID
        or str(item.get("status") or "").strip().lower() != "active"
    ):
        await cancel_food_expiry_notification_jobs_by_item(item_id)
        return None

    if not allow_create and not has_notification_history:
        return None

    scheduled_local = _build_food_expiry_notification_schedule(item)
    if not scheduled_local:
        await cancel_food_expiry_notification_jobs_by_item(item_id)
        return None

    payload_snapshot = {
        "page": EXPIRY_NOTIFICATION_PAGE,
        "data": _build_food_expiry_notification_payload(item),
        "food_name": item.get("food_name"),
        "expire_date": item.get("expire_date"),
        "status": item.get("status"),
    }
    return await upsert_food_expiry_notification_job(
        user_id=user_id,
        expiry_item_id=item_id,
        template_id=EXPIRY_NOTIFICATION_TEMPLATE_ID,
        openid=openid,
        scheduled_at=scheduled_local.astimezone(timezone.utc).isoformat(),
        payload_snapshot=payload_snapshot,
        max_retry_count=EXPIRY_NOTIFICATION_MAX_RETRY,
    )


def _normalize_body_metric_source_type(value: Optional[str], default: str = "manual") -> str:
    source_type = (value or "").strip().lower() or default
    if source_type not in BODY_METRIC_SOURCE_TYPES:
        raise HTTPException(status_code=400, detail="source_type 必须为 manual / imported / ai")
    return source_type


def _build_legacy_weight_client_id(date_key: str, value: float) -> str:
    return f"legacy:{date_key}:{round(float(value), 1):.1f}"


def _resolve_stats_range_dates(range_type: str) -> Tuple[str, str, datetime]:
    now = datetime.now(CHINA_TZ)
    if range_type == "month":
        start_d = (now - timedelta(days=29)).date()
    else:
        start_d = (now - timedelta(days=6)).date()
    return start_d.isoformat(), now.date().isoformat(), now


def _today_china_date_for_body_metrics() -> date:
    """中国时区「今天」日期；单测可 patch 以冻结日期（datetime.now 在 Py3.12 上不便 patch）。"""
    return datetime.now(CHINA_TZ).date()


def _canonical_recorded_on_body_metric(row: Dict[str, Any]) -> str:
    """
    纠正错年：前端曾把真实 2026 记成 2025 同一月日。
    1) 若 recorded_on 与创建时间（中国时区自然日）月日一致但年份不同，以创建日为准。
    2) 若 UTC 导致 1) 无法匹配（如晚八点后写入跨中国日），则去年同月日整体平移到当前年（与错年展示位一致）。
    """
    raw = str(row.get("recorded_on") or "").strip()[:10]
    if not raw or len(raw) < 10:
        return raw
    try:
        raw_d = datetime.strptime(raw, "%Y-%m-%d").date()
    except Exception:
        return raw
    today = _today_china_date_for_body_metrics()
    created = row.get("created_at") or row.get("updated_at") or row.get("recorded_at")
    if created:
        try:
            dt = _parse_datetime(created)
            if dt:
                china = dt.astimezone(CHINA_TZ).date()
                if raw_d.month == china.month and raw_d.day == china.day and raw_d.year != china.year:
                    return china.isoformat()
        except Exception:
            pass
    if raw_d.year == today.year - 1:
        candidate = raw_d.replace(year=today.year)
        if candidate <= today and (today - candidate).days <= 400:
            return candidate.isoformat()
    return raw


def _normalize_weight_entry(row: Dict[str, Any]) -> Dict[str, Any]:
    recorded_at = row.get("created_at") or row.get("updated_at")
    date_key = _canonical_recorded_on_body_metric(row) or str(row.get("recorded_on") or "")
    return {
        "id": row.get("id"),
        "date": date_key,
        "value": round(float(row.get("weight_kg") or 0), 1),
        "client_id": row.get("client_record_id"),
        "recorded_at": _build_json_datetime(_parse_datetime(recorded_at)) if recorded_at else None,
    }


def _weight_entry_sort_key(entry: Dict[str, Any]) -> Tuple[str, str]:
    parsed = _parse_datetime(entry.get("recorded_at"))
    recorded_at = _build_json_datetime(parsed) if parsed else None
    return (
        str(entry.get("date") or ""),
        recorded_at or str(entry.get("date") or ""),
    )


def _aggregate_weight_daily(weight_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    daily_map: Dict[str, Dict[str, Any]] = {}
    for row in weight_rows:
        entry = _normalize_weight_entry(row)
        date_key = str(entry.get("date") or "")
        if not date_key:
            continue
        existing = daily_map.get(date_key)
        if existing is None or _weight_entry_sort_key(entry) >= _weight_entry_sort_key(existing):
            daily_map[date_key] = entry
    return [daily_map[date_key] for date_key in sorted(daily_map.keys())]


def _build_weight_locf_series(
    weight_rows: List[Dict[str, Any]],
    start_date: str,
    end_date: str,
) -> List[Dict[str, Any]]:
    """
    统计区间 [start_date, end_date] 内每日体重：无新记录时沿用最近一次有效体重（LOCF），趋势不断档。
    """
    aggregated = _aggregate_weight_daily(weight_rows)
    by_date: Dict[str, float] = {}
    for e in aggregated:
        dk = str(e.get("date") or "")
        if dk:
            by_date[dk] = float(e.get("value") or 0)
    cursor = datetime.strptime(start_date, "%Y-%m-%d").date()
    end_day = datetime.strptime(end_date, "%Y-%m-%d").date()
    last_val: Optional[float] = None
    for d_str in sorted(by_date.keys()):
        try:
            d = datetime.strptime(d_str, "%Y-%m-%d").date()
        except ValueError:
            continue
        if d < cursor:
            last_val = by_date[d_str]
        else:
            break
    out: List[Dict[str, Any]] = []
    while cursor <= end_day:
        date_key = cursor.isoformat()
        if date_key in by_date:
            last_val = by_date[date_key]
        if last_val is not None:
            out.append({"date": date_key, "value": round(last_val, 1)})
        cursor += timedelta(days=1)
    return out


def _aggregate_water_daily(
    water_logs: List[Dict[str, Any]],
    start_date: str,
    end_date: str,
) -> List[Dict[str, Any]]:
    daily_map: Dict[str, Dict[str, Any]] = {}
    for row in water_logs:
        date_key = _canonical_recorded_on_body_metric(row) or str(row.get("recorded_on") or "")
        if not date_key:
            continue
        amount = int(float(row.get("amount_ml") or 0))
        bucket = daily_map.setdefault(date_key, {"date": date_key, "total": 0, "logs": []})
        bucket["total"] += amount
        bucket["logs"].append(amount)

    daily_list: List[Dict[str, Any]] = []
    cursor = datetime.strptime(start_date, "%Y-%m-%d").date()
    end_day = datetime.strptime(end_date, "%Y-%m-%d").date()
    while cursor <= end_day:
        date_key = cursor.isoformat()
        item = daily_map.get(date_key)
        if item:
            daily_list.append({
                "date": date_key,
                "total": int(item["total"]),
                "logs": list(item["logs"]),
            })
        else:
            daily_list.append({"date": date_key, "total": 0, "logs": []})
        cursor += timedelta(days=1)
    return daily_list


async def _build_body_metrics_summary(
    user_id: str,
    start_date: str,
    end_date: str,
) -> Dict[str, Any]:
    # 体重和喝水：库内可能误存为「上一年」同一月日，仅用 365 天窗口会漏掉（如 2025-04-03 相对 2026-04-07）
    now = datetime.now(CHINA_TZ)
    extended_start = (now - timedelta(days=730)).date().isoformat()
    extended_end = now.date().isoformat()
    weight_rows = await list_user_weight_records(user_id=user_id, start_date=extended_start, end_date=extended_end)
    water_logs = await list_user_water_logs(user_id=user_id, start_date=extended_start, end_date=extended_end)
    settings = await get_user_body_metric_settings(user_id)

    weight_entries = _aggregate_weight_daily(weight_rows)
    latest_weight = weight_entries[-1] if weight_entries else None
    previous_weight = weight_entries[-2] if len(weight_entries) >= 2 else None
    weight_change = None
    if latest_weight and previous_weight:
        weight_change = round(float(latest_weight["value"]) - float(previous_weight["value"]), 1)

    weight_trend_daily = _build_weight_locf_series(weight_rows, start_date, end_date)

    water_daily = _aggregate_water_daily(water_logs, start_date, end_date)
    total_water_ml = sum(int(item["total"]) for item in water_daily)
    recorded_days = sum(1 for item in water_daily if int(item["total"]) > 0)
    avg_daily_water_ml = round(total_water_ml / recorded_days, 1) if recorded_days > 0 else 0.0
    water_goal_ml = int((settings or {}).get("water_goal_ml") or DEFAULT_WATER_GOAL_ML)
    today_key = datetime.now(CHINA_TZ).date().isoformat()
    today_water = next((item for item in water_daily if item["date"] == today_key), {"date": today_key, "total": 0, "logs": []})

    return {
        "weight_entries": weight_entries,
        "weight_trend_daily": weight_trend_daily,
        "latest_weight": latest_weight,
        "previous_weight": previous_weight,
        "weight_change": weight_change,
        "water_goal_ml": water_goal_ml,
        "today_water": today_water,
        "water_daily": water_daily,
        "total_water_ml": total_water_ml,
        "avg_daily_water_ml": avg_daily_water_ml,
        "water_recorded_days": recorded_days,
    }


def _empty_body_metrics_summary(start_date: str, end_date: str) -> Dict[str, Any]:
    today_key = datetime.now(CHINA_TZ).date().isoformat()
    water_daily = _aggregate_water_daily([], start_date, end_date)
    today_water = next((item for item in water_daily if item["date"] == today_key), {"date": today_key, "total": 0, "logs": []})
    return {
        "weight_entries": [],
        "weight_trend_daily": [],
        "latest_weight": None,
        "previous_weight": None,
        "weight_change": None,
        "water_goal_ml": DEFAULT_WATER_GOAL_ML,
        "today_water": today_water,
        "water_daily": water_daily,
        "total_water_ml": 0,
        "avg_daily_water_ml": 0.0,
        "water_recorded_days": 0,
    }


def _build_food_expiry_summary(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    active_items = [item for item in items if item.get("status") == "active"]
    urgency_rank = {"expired": 0, "today": 1, "soon": 2, "fresh": 3}
    active_items.sort(
        key=lambda item: (
            urgency_rank.get(item.get("urgency"), 9),
            item.get("days_until_expire") if item.get("days_until_expire") is not None else 9999,
            item.get("expire_date") or "9999-12-31",
        )
    )
    summary_items = []
    for item in active_items[:3]:
        summary_items.append({
            "id": item.get("id"),
            "user_id": item.get("user_id"),
            "food_name": item.get("food_name"),
            "quantity_text": item.get("quantity_note"),
            "storage_location": item.get("storage_type_label"),
            "note": item.get("note"),
            "days_left": item.get("days_until_expire"),
            "deadline_label": (str(item.get("expire_date") or "")[5:10] if item.get("expire_date") else None),
            "urgency_level": {
                "expired": "overdue",
                "today": "today",
                "soon": "soon",
                "fresh": "normal",
            }.get(item.get("urgency"), "normal"),
        })
    return {
        "pendingCount": len(active_items),
        "soonCount": sum(1 for item in active_items if item.get("urgency") in {"today", "soon"}),
        "overdueCount": sum(1 for item in active_items if item.get("urgency") == "expired"),
        "items": summary_items,
    }


def _format_membership_response(membership: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not membership:
        return {
            "is_pro": False,
            "status": "inactive",
            "current_plan_code": None,
            "first_activated_at": None,
            "current_period_start": None,
            "expires_at": None,
            "last_paid_at": None,
        }

    expires_at = _parse_datetime(membership.get("expires_at"))
    status = membership.get("status") or "inactive"
    if status == "active" and expires_at and expires_at <= datetime.now(timezone.utc):
        status = "expired"

    return {
        "is_pro": status == "active" and bool(expires_at and expires_at > datetime.now(timezone.utc)),
        "status": status,
        "current_plan_code": membership.get("current_plan_code"),
        "first_activated_at": membership.get("first_activated_at"),
        "current_period_start": membership.get("current_period_start"),
        "expires_at": membership.get("expires_at"),
        "last_paid_at": membership.get("last_paid_at"),
    }


def _get_food_analysis_daily_limit(is_pro: bool) -> Optional[int]:
    """临时关闭拍照分析日限；恢复时只需打开环境变量。"""
    if not FOOD_ANALYSIS_DAILY_LIMIT_ENABLED:
        return None
    return FOOD_ANALYSIS_DAILY_LIMIT_PRO if is_pro else FOOD_ANALYSIS_DAILY_LIMIT_NON_PRO


# ============================================================
# 食探会员 · 积分体系（2026-04-21 上线）
# ------------------------------------------------------------
# 积分消耗：
#   - 食物分析（拍照/文字/精准）：2 积分/次
#   - 运动记录：1 积分/次
# 积分发放：
#   - 付费套餐：每日按套餐 daily_credits 发放，当天清零
#   - 免费试用：
#       * 前 500 名注册用户：注册起 60 天内每日 8 积分
#       * 第 501-1000 名注册用户：注册起 30 天内每日 8 积分
#       * 其余新用户：注册起 3 天内每日 8 积分
# 邀请/分享奖励：
#   - 邀请好友：有效邀请生效后，双方连续 3 天每天 +5 积分
#   - 分享海报：记录拥有者生成海报后，每日 +1 积分
# ============================================================

CREDIT_COST_PER_FOOD_ANALYSIS = 2
CREDIT_COST_PER_EXERCISE_LOG = 1

TRIAL_DAILY_CREDITS = 8
EARLY_USER_TOP_500_LIMIT = 500
EARLY_USER_TRIAL_LIMIT = 1000
EARLY_USER_TOP_500_TRIAL_DAYS = 60
EARLY_USER_TRIAL_DAYS = 30
REGULAR_USER_TRIAL_DAYS = 3
EARLY_USER_PAID_CREDITS_MULTIPLIER = 2
INVITE_REWARD_CREDITS_PER_DAY = 5
INVITE_REWARD_DAYS = 3
INVITE_REWARD_MONTHLY_LIMIT = 10
SHARE_POSTER_REWARD_CREDITS = 1

LEGACY_PRECISION_ENABLED_PLAN_CODES = {"pro_monthly"}
LEGACY_MEMBERSHIP_PLAN_CODES = {"pro_monthly"}
def _credits_reset_time_iso() -> str:
    """返回当日中国时区 24:00（= 次日 00:00+08:00）ISO 字符串，供前端倒计时。"""
    now_cn = datetime.now(CHINA_TZ)
    tomorrow_cn = (now_cn + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return tomorrow_cn.isoformat()


def _is_membership_subscription_plan_code(plan_code: Optional[str]) -> bool:
    code = str(plan_code or "").strip().lower()
    if not code:
        return False
    if code in LEGACY_MEMBERSHIP_PLAN_CODES:
        return True
    return code.startswith("light_") or code.startswith("standard_") or code.startswith("advanced_")


async def _expire_pending_membership_orders_for_user(
    user_id: str,
    *,
    exclude_order_no: Optional[str] = None,
    reason: str,
) -> int:
    """把当前用户旧的 pending 会员订单收口成 expired，避免误伤积分充值等其他业务单。"""
    try:
        pending_rows = await list_pro_membership_payment_records(
            {"user_id": user_id, "status": "pending"}
        )
        updated_count = 0
        now_iso = datetime.now(timezone.utc).isoformat()
        for row in pending_rows:
            order_no = str(row.get("order_no") or "").strip()
            if not order_no:
                continue
            if exclude_order_no and order_no == exclude_order_no:
                continue
            if not _is_membership_subscription_plan_code(row.get("plan_code")):
                continue

            existing_extra = row.get("extra")
            merged_extra = dict(existing_extra) if isinstance(existing_extra, dict) else {}
            merged_extra["expire_reason"] = reason
            merged_extra["expired_at"] = now_iso
            if exclude_order_no:
                merged_extra["superseded_by_order_no"] = exclude_order_no

            await update_pro_membership_payment_record(
                order_no,
                {
                    "status": "expired",
                    "updated_at": now_iso,
                    "extra": merged_extra,
                }
            )
            updated_count += 1
        return updated_count
    except Exception as e:
        print(f"[_expire_pending_membership_orders_for_user] user={user_id} 错误: {e}")
        return 0


async def _resolve_user_trial_policy(
    user_id: str,
    user_row: Optional[Dict[str, Any]],
    early_user_meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """解析用户免费试用策略与当前状态。"""
    if not user_row:
        return {
            "trial_active": False,
            "trial_expires_at": None,
            "trial_days_total": 0,
            "trial_policy": None,
        }

    created_at = resolve_user_registration_datetime(user_row)
    if not created_at:
        return {
            "trial_active": False,
            "trial_expires_at": None,
            "trial_days_total": 0,
            "trial_policy": None,
        }

    meta = early_user_meta or await _resolve_early_user_membership_meta(user_id, user_row)
    rank = int(meta.get("early_user_rank") or 0)
    is_early_user = bool(meta.get("early_user_paid_bonus_eligible"))
    if rank and rank <= EARLY_USER_TOP_500_LIMIT:
        trial_days = EARLY_USER_TOP_500_TRIAL_DAYS
        trial_policy = "founding_top_500_bonus_month"
    elif is_early_user:
        trial_days = EARLY_USER_TRIAL_DAYS
        trial_policy = "early_first_1000"
    else:
        trial_days = REGULAR_USER_TRIAL_DAYS
        trial_policy = "regular_new_user"
    trial_end = created_at + timedelta(days=trial_days)
    return {
        "trial_active": datetime.now(timezone.utc) < trial_end,
        "trial_expires_at": trial_end,
        "trial_days_total": trial_days,
        "trial_policy": trial_policy,
    }


async def _resolve_early_user_membership_meta(
    user_id: str,
    user_row: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """解析首批 1000 用户的创始编号与会员翻倍权益。"""
    default_meta = {
        "early_user_rank": None,
        "early_user_limit": EARLY_USER_TRIAL_LIMIT,
        "early_user_paid_bonus_multiplier": 1,
        "early_user_paid_bonus_eligible": False,
        "early_user_paid_bonus_active": False,
    }
    if not user_row or not resolve_user_registration_datetime(user_row):
        return default_meta

    rank = await get_first_membership_trial_batch_rank(user_id, EARLY_USER_TRIAL_LIMIT)
    is_early_user = rank is not None
    return {
        "early_user_rank": rank,
        "early_user_limit": EARLY_USER_TRIAL_LIMIT,
        "early_user_paid_bonus_multiplier": EARLY_USER_PAID_CREDITS_MULTIPLIER if is_early_user else 1,
        "early_user_paid_bonus_eligible": is_early_user,
        "early_user_paid_bonus_active": False,
    }


async def _compute_daily_credits_status(
    user_id: str,
    is_pro: bool,
    membership: Optional[Dict[str, Any]],
    user_row: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """计算某用户今日积分概况。
    优先级：付费会员 > 免费试用 > 0。
    """
    # 1) 当日最大积分
    daily_max = 0
    trial_active = False
    trial_expires_at: Optional[datetime] = None
    trial_days_total = 0
    trial_policy: Optional[str] = None
    daily_credits_base = 0
    early_user_meta = await _resolve_early_user_membership_meta(user_id, user_row)
    early_multiplier = int(early_user_meta.get("early_user_paid_bonus_multiplier") or 1)
    if is_pro and membership:
        membership_daily_credits = int(membership.get("daily_credits") or 0)
        plan_daily_credits = 0
        plan_code = membership.get("current_plan_code")
        if plan_code:
            plan = await get_membership_plan_by_code(plan_code)
            if plan:
                plan_daily_credits = int(plan.get("daily_credits") or 0)

        daily_credits_base = membership_daily_credits or plan_daily_credits
        if bool(early_user_meta.get("early_user_paid_bonus_eligible")) and early_multiplier > 1 and daily_credits_base > 0:
            boosted_target = (plan_daily_credits * early_multiplier) if plan_daily_credits > 0 else (daily_credits_base * early_multiplier)
            daily_credits_base = max(daily_credits_base, boosted_target)
            early_user_meta["early_user_paid_bonus_active"] = True
        daily_max = daily_credits_base
    if daily_max <= 0 and not is_pro:
        trial_meta = await _resolve_user_trial_policy(user_id, user_row, early_user_meta=early_user_meta)
        trial_active = bool(trial_meta.get("trial_active"))
        trial_expires_at = trial_meta.get("trial_expires_at")
        trial_days_total = int(trial_meta.get("trial_days_total") or 0)
        trial_policy = str(trial_meta.get("trial_policy") or "").strip() or None
        if trial_active:
            daily_max = TRIAL_DAILY_CREDITS
            daily_credits_base = TRIAL_DAILY_CREDITS
    daily_credits_base = max(daily_credits_base or daily_max, 0)

    bonus_breakdown = await get_daily_membership_bonus_breakdown(
        user_id,
        datetime.now(CHINA_TZ).strftime("%Y-%m-%d"),
    )
    invite_bonus_credits = int(bonus_breakdown.get("invite_bonus_credits") or 0)
    share_bonus_credits = int(bonus_breakdown.get("share_bonus_credits") or 0)
    daily_bonus_credits = int(bonus_breakdown.get("daily_bonus_credits") or 0)
    daily_max += daily_bonus_credits

    # 2) 今日已消耗积分（基于行为计数）
    today_str = datetime.now(CHINA_TZ).strftime("%Y-%m-%d")
    food_count = await get_today_food_analysis_count(user_id, today_str)
    exercise_count = await get_today_exercise_log_count(user_id, today_str)
    used = food_count * CREDIT_COST_PER_FOOD_ANALYSIS + exercise_count * CREDIT_COST_PER_EXERCISE_LOG
    remaining = max(daily_max - used, 0)

    return {
        "daily_credits_max": daily_max,
        "daily_credits_used": min(used, daily_max) if daily_max > 0 else used,
        "daily_credits_remaining": remaining,
        "daily_credits_base": daily_credits_base,
        "daily_bonus_credits": daily_bonus_credits,
        "invite_bonus_credits": invite_bonus_credits,
        "share_bonus_credits": share_bonus_credits,
        "credits_reset_at": _credits_reset_time_iso(),
        "trial_active": trial_active,
        "trial_expires_at": _build_json_datetime(trial_expires_at) if trial_expires_at else None,
        "trial_days_total": trial_days_total,
        "trial_policy": trial_policy,
        "early_user_rank": early_user_meta.get("early_user_rank"),
        "early_user_limit": int(early_user_meta.get("early_user_limit") or EARLY_USER_TRIAL_LIMIT),
        "early_user_paid_bonus_multiplier": early_multiplier,
        "early_user_paid_bonus_eligible": bool(early_user_meta.get("early_user_paid_bonus_eligible")),
        "early_user_paid_bonus_active": bool(early_user_meta.get("early_user_paid_bonus_active")),
    }


def _get_membership_tier_from_plan_code(plan_code: Optional[str]) -> Optional[str]:
    code = str(plan_code or "").strip()
    if not code:
        return None
    if code.startswith("light_"):
        return "light"
    if code.startswith("standard_"):
        return "standard"
    if code.startswith("advanced_"):
        return "advanced"
    if code in LEGACY_PRECISION_ENABLED_PLAN_CODES:
        return "standard"
    return None


def _is_precision_supported_tier(tier: Optional[str]) -> bool:
    return tier in {"standard", "advanced"}


async def _resolve_membership_tier(membership: Optional[Dict[str, Any]]) -> Optional[str]:
    if not membership:
        return None
    plan_code = membership.get("current_plan_code")
    tier = _get_membership_tier_from_plan_code(plan_code)
    if tier:
        return tier
    if plan_code:
        plan = await get_membership_plan_by_code(str(plan_code))
        plan_tier = str((plan or {}).get("tier") or "").strip()
        return plan_tier or None
    return None


async def _can_use_precision_mode(
    membership: Optional[Dict[str, Any]],
    membership_resp: Optional[Dict[str, Any]] = None,
) -> bool:
    resolved_membership = membership or None
    resolved_resp = membership_resp or _format_membership_response(resolved_membership)
    if not resolved_resp.get("is_pro"):
        return False
    tier = await _resolve_membership_tier(resolved_membership)
    if tier is None and resolved_resp.get("is_pro"):
        # 老会员套餐无法识别档位时，默认按 legacy Pro 处理，避免误伤历史用户。
        return True
    return _is_precision_supported_tier(tier)


async def _raise_if_food_analysis_credits_insufficient(
    user_id: str,
    user_row: Optional[Dict[str, Any]] = None,
    membership: Optional[Dict[str, Any]] = None,
    membership_resp: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    resolved_membership = membership
    if resolved_membership is None:
        resolved_membership = await _get_effective_membership(user_id)
    resolved_resp = membership_resp or _format_membership_response(resolved_membership)
    resolved_user = user_row or await get_user_by_id(user_id)
    credits_info = await _compute_daily_credits_status(
        user_id=user_id,
        is_pro=bool(resolved_resp.get("is_pro")),
        membership=resolved_membership,
        user_row=resolved_user,
    )
    remaining = int(credits_info.get("daily_credits_remaining") or 0)
    daily_max = int(credits_info.get("daily_credits_max") or 0)
    used = int(credits_info.get("daily_credits_used") or 0)
    if remaining >= CREDIT_COST_PER_FOOD_ANALYSIS:
        return credits_info

    if resolved_resp.get("is_pro"):
        detail = (
            f"今日积分不足（已用 {min(used, daily_max)}/{daily_max}，剩余 {remaining}），"
            f"食物分析需 {CREDIT_COST_PER_FOOD_ANALYSIS} 积分/次。请明日再试，或升级更高套餐。"
        )
    elif credits_info.get("trial_active"):
        detail = (
            f"试用积分不足（已用 {min(used, daily_max)}/{daily_max}，剩余 {remaining}），"
            f"食物分析需 {CREDIT_COST_PER_FOOD_ANALYSIS} 积分/次。请明日再试，或开通会员继续。"
        )
    elif daily_max > 0:
        detail = (
            f"当前积分不足（已用 {min(used, daily_max)}/{daily_max}，剩余 {remaining}），"
            f"食物分析需 {CREDIT_COST_PER_FOOD_ANALYSIS} 积分/次。请明日再试，或开通会员继续。"
        )
    else:
        detail = f"当前暂无可用积分，食物分析需 {CREDIT_COST_PER_FOOD_ANALYSIS} 积分/次。请开通会员后继续。"

    raise HTTPException(status_code=402, detail=detail)


async def _raise_if_exercise_credits_insufficient(
    user_id: str,
    user_row: Optional[Dict[str, Any]] = None,
    membership: Optional[Dict[str, Any]] = None,
    membership_resp: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    resolved_membership = membership
    if resolved_membership is None:
        resolved_membership = await _get_effective_membership(user_id)
    resolved_resp = membership_resp or _format_membership_response(resolved_membership)
    resolved_user = user_row or await get_user_by_id(user_id)
    credits_info = await _compute_daily_credits_status(
        user_id=user_id,
        is_pro=bool(resolved_resp.get("is_pro")),
        membership=resolved_membership,
        user_row=resolved_user,
    )
    remaining = int(credits_info.get("daily_credits_remaining") or 0)
    daily_max = int(credits_info.get("daily_credits_max") or 0)
    used = int(credits_info.get("daily_credits_used") or 0)
    if remaining >= CREDIT_COST_PER_EXERCISE_LOG:
        return credits_info

    if resolved_resp.get("is_pro"):
        detail = (
            f"今日积分不足（已用 {min(used, daily_max)}/{daily_max}，剩余 {remaining}），"
            f"运动记录需 {CREDIT_COST_PER_EXERCISE_LOG} 积分/次。请明日再试，或升级更高套餐。"
        )
    elif credits_info.get("trial_active"):
        detail = (
            f"试用积分不足（已用 {min(used, daily_max)}/{daily_max}，剩余 {remaining}），"
            f"运动记录需 {CREDIT_COST_PER_EXERCISE_LOG} 积分/次。请明日再试，或开通会员继续。"
        )
    elif daily_max > 0:
        detail = (
            f"当前积分不足（已用 {min(used, daily_max)}/{daily_max}，剩余 {remaining}），"
            f"运动记录需 {CREDIT_COST_PER_EXERCISE_LOG} 积分/次。请明日再试，或开通会员继续。"
        )
    else:
        detail = f"当前暂无可用积分，运动记录需 {CREDIT_COST_PER_EXERCISE_LOG} 积分/次。请开通会员后继续。"

    raise HTTPException(status_code=402, detail=detail)


async def _validate_food_analysis_access(
    user_id: str,
    effective_mode: str,
    *,
    strict_requested: bool = False,
    user_row: Optional[Dict[str, Any]] = None,
    membership: Optional[Dict[str, Any]] = None,
    membership_resp: Optional[Dict[str, Any]] = None,
) -> tuple[Optional[Dict[str, Any]], Dict[str, Any], Optional[Dict[str, Any]], str]:
    resolved_user = user_row or await get_user_by_id(user_id)
    resolved_membership = membership
    if resolved_membership is None:
        resolved_membership = await _get_effective_membership(user_id)
    resolved_resp = membership_resp or _format_membership_response(resolved_membership)

    await _raise_if_food_analysis_credits_insufficient(
        user_id=user_id,
        user_row=resolved_user,
        membership=resolved_membership,
        membership_resp=resolved_resp,
    )

    resolved_mode = effective_mode
    if resolved_mode == "strict":
        can_use_precision = await _can_use_precision_mode(resolved_membership, resolved_resp)
        if strict_requested and not can_use_precision:
            tier = await _resolve_membership_tier(resolved_membership)
            if resolved_resp.get("is_pro") and tier == "light":
                raise HTTPException(status_code=402, detail="当前轻度版不含精准模式，请升级到标准版或进阶版后再试。")
            raise HTTPException(status_code=402, detail="精准模式仅对标准版和进阶版开放，请升级或开通后再试。")
        if not can_use_precision:
            resolved_mode = "standard"

    return resolved_user, resolved_resp, resolved_membership, resolved_mode


def _get_private_key(private_key_pem: str):
    return serialization.load_pem_private_key(private_key_pem.encode("utf-8"), password=None)


def _get_public_key(public_key_pem: str):
    return serialization.load_pem_public_key(public_key_pem.encode("utf-8"))


def _sign_with_rsa_sha256(message: str, private_key_pem: str) -> str:
    private_key = _get_private_key(private_key_pem)
    signature = private_key.sign(
        message.encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode("utf-8")


def _verify_with_rsa_sha256(message: str, signature_b64: str, public_key_pem: str) -> bool:
    try:
        public_key = _get_public_key(public_key_pem)
        public_key.verify(
            base64.b64decode(signature_b64),
            message.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return True
    except Exception:
        return False


def _build_wechatpay_authorization(
    mchid: str,
    serial_no: str,
    private_key_pem: str,
    method: str,
    canonical_url: str,
    body: str,
) -> str:
    timestamp = str(int(time.time()))
    nonce_str = secrets.token_hex(16)
    message = f"{method.upper()}\n{canonical_url}\n{timestamp}\n{nonce_str}\n{body}\n"
    signature = _sign_with_rsa_sha256(message, private_key_pem)
    return (
        'WECHATPAY2-SHA256-RSA2048 '
        f'mchid="{mchid}",'
        f'nonce_str="{nonce_str}",'
        f'signature="{signature}",'
        f'timestamp="{timestamp}",'
        f'serial_no="{serial_no}"'
    )


def _build_mini_program_pay_params(appid: str, prepay_id: str, private_key_pem: str) -> Dict[str, str]:
    time_stamp = str(int(time.time()))
    nonce_str = secrets.token_hex(16)
    package_value = f"prepay_id={prepay_id}"
    message = f"{appid}\n{time_stamp}\n{nonce_str}\n{package_value}\n"
    pay_sign = _sign_with_rsa_sha256(message, private_key_pem)
    return {
        "timeStamp": time_stamp,
        "nonceStr": nonce_str,
        "package": package_value,
        "signType": "RSA",
        "paySign": pay_sign,
    }


def _decrypt_wechatpay_resource(resource: Dict[str, Any], api_v3_key: str) -> Dict[str, Any]:
    ciphertext = resource.get("ciphertext")
    nonce = resource.get("nonce")
    associated_data = resource.get("associated_data", "")
    if not ciphertext or not nonce:
        raise HTTPException(status_code=400, detail="微信支付回调缺少加密资源字段")

    aesgcm = AESGCM(api_v3_key.encode("utf-8"))
    plaintext = aesgcm.decrypt(
        nonce.encode("utf-8"),
        base64.b64decode(ciphertext),
        associated_data.encode("utf-8") if associated_data else None,
    )
    return json.loads(plaintext.decode("utf-8"))

app = FastAPI(title="食物分析 API", description="基于 DashScope 的食物图片分析服务")

# 缓存 access_token（有效期为 2 小时）
_access_token_cache = {
    "token": None,
    "expires_at": 0
}

# 测试后台批量任务（仅进程内存）
_test_backend_batches: Dict[str, Dict[str, Any]] = {}

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应该限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Nutrients(BaseModel):
    calories: float = 0
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    fiber: float = 0
    sugar: float = 0


class FoodItemResponse(BaseModel):
    name: str
    estimatedWeightGrams: float
    originalWeightGrams: float
    nutrients: Nutrients


class PrecisionReferenceDimensions(BaseModel):
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None


class PrecisionReferenceObjectInput(BaseModel):
    reference_type: str = Field(default="preset", description="preset / custom")
    reference_name: str = Field(..., description="参考物名称")
    dimensions_mm: Optional[PrecisionReferenceDimensions] = Field(default=None, description="参考物尺寸（毫米）")
    placement_note: Optional[str] = Field(default=None, description="摆放说明")
    applies_to_items: Optional[List[str]] = Field(default=None, description="适用主体 item_key 列表")


VALID_PRECISION_REFERENCE_PRESET_KEYS = {
    "hand",
    "campus_card",
    "large_card",
    "chopsticks",
    "spoon",
    "bank_card",
    "custom",
}


class PrecisionReferencePresetConfig(BaseModel):
    reference_name: str = Field(..., description="默认参考物名称")
    dimensions_mm: Optional[PrecisionReferenceDimensions] = Field(default=None, description="默认参考物尺寸（毫米）")


class PrecisionReferenceDefaults(BaseModel):
    preferred_reference_key: Optional[str] = Field(default=None, description="默认参考物 key")
    presets: Optional[Dict[str, PrecisionReferencePresetConfig]] = Field(default=None, description="按 key 保存的默认参考物配置")


def _normalize_precision_reference_defaults(
    defaults: Optional[PrecisionReferenceDefaults],
) -> Optional[Dict[str, Any]]:
    if defaults is None:
        return None

    preferred_reference_key = str(defaults.preferred_reference_key or "").strip().lower()
    if preferred_reference_key and preferred_reference_key not in VALID_PRECISION_REFERENCE_PRESET_KEYS:
        preferred_reference_key = ""

    normalized_presets: Dict[str, Dict[str, Any]] = {}
    for raw_key, preset in (defaults.presets or {}).items():
        key = str(raw_key or "").strip().lower()
        if key not in VALID_PRECISION_REFERENCE_PRESET_KEYS or preset is None:
            continue
        reference_name = str(preset.reference_name or "").strip()
        if not reference_name:
            continue
        dims = preset.dimensions_mm.dict() if preset.dimensions_mm else {}
        normalized_dims = {
            axis: float(dims[axis])
            for axis in ("length", "width", "height")
            if dims.get(axis) is not None and float(dims[axis]) > 0
        }
        normalized_presets[key] = {
            "reference_name": reference_name,
            "dimensions_mm": normalized_dims or None,
        }

    if not preferred_reference_key and not normalized_presets:
        return None

    return {
        "preferred_reference_key": preferred_reference_key or None,
        "presets": normalized_presets or None,
    }


class AnalyzeRequest(BaseModel):
    base64Image: Optional[str] = Field(None, description="Base64 编码的图片数据（与 image_url 二选一）")
    base64Image: Optional[str] = Field(None, description="Base64 编码的图片数据（与 image_url 二选一）")
    image_url: Optional[str] = Field(None, description="Supabase 等公网图片 URL（与 base64Image 二选一，分析时用此 URL 获取图片）")
    image_urls: Optional[List[str]] = Field(None, description="多图 URL 列表（新版支持）")
    additionalContext: Optional[str] = Field(default="", description="用户补充的上下文信息")
    modelName: Optional[str] = Field(default="qwen-vl-max", description="使用的模型名称")
    user_goal: Optional[str] = Field(default=None, description="用户目标: muscle_gain / fat_loss / maintain，用于 PFC 评价")
    diet_goal: Optional[str] = Field(default=None, description="饮食目标: fat_loss(减脂期) / muscle_gain(增肌期) / maintain(维持体重) / none(无)")
    activity_timing: Optional[str] = Field(default=None, description="运动时机: post_workout(练后) / daily(日常) / before_sleep(睡前) / none(无)")
    remaining_calories: Optional[float] = Field(default=None, description="当日剩余热量预算 kcal，用于建议下一餐")
    meal_type: Optional[str] = Field(default=None, description=f"{MEAL_TYPE_DESCRIPTION}，用于结合餐次给出建议")
    timezone_offset_minutes: Optional[int] = Field(default=None, description="客户端时区偏移（JS getTimezoneOffset，单位分钟）")
    province: Optional[str] = Field(default=None, description="省份/直辖市")
    city: Optional[str] = Field(default=None, description="城市")
    district: Optional[str] = Field(default=None, description="区县")
    execution_mode: Optional[str] = Field(default=None, description="执行模式: standard(标准) / strict(精准)")


class AnalyzeResponse(BaseModel):
    description: str
    insight: str
    items: List[FoodItemResponse]
    pfc_ratio_comment: Optional[str] = Field(default=None, description="PFC 比例评价（蛋白质/脂肪/碳水占比）")
    absorption_notes: Optional[str] = Field(default=None, description="吸收率与生物利用度简要说明")
    context_advice: Optional[str] = Field(default=None, description="情境感知建议（结合用户状态）")
    recognitionOutcome: Optional[str] = Field(default=None, description="精准模式结构化识别结果: ok / soft_reject / hard_reject")
    rejectionReason: Optional[str] = Field(default=None, description="精准模式拒识或降级原因")
    retakeGuidance: Optional[List[str]] = Field(default=None, description="精准模式下的重拍/拆拍建议")
    allowedFoodCategory: Optional[str] = Field(default=None, description="精准模式允许识别的食物类别: carb / lean_protein / unknown")
    followupQuestions: Optional[List[str]] = Field(default=None, description="文字精准模式下还需补充的问题")
    precisionSessionId: Optional[str] = Field(default=None, description="精准模式会话 ID")
    precisionStatus: Optional[str] = Field(default=None, description="精准模式状态: needs_user_input / needs_retake / estimating / done")
    precisionRoundIndex: Optional[int] = Field(default=None, description="精准模式当前轮次")
    pendingRequirements: Optional[List[str]] = Field(default=None, description="待补充要求")
    retakeInstructions: Optional[List[str]] = Field(default=None, description="结构化重拍要求")
    referenceObjectNeeded: Optional[bool] = Field(default=None, description="是否需要参考物")
    referenceObjectSuggestions: Optional[List[str]] = Field(default=None, description="建议参考物列表")
    detectedItemsSummary: Optional[List[str]] = Field(default=None, description="识别到的主体摘要")
    splitStrategy: Optional[str] = Field(default=None, description="single_item / multi_item_parallel / retake_required / user_annotation_required")
    uncertaintyNotes: Optional[List[str]] = Field(default=None, description="不确定性说明")
    redirectTaskId: Optional[str] = Field(default=None, description="loading 页面需要继续跟踪的新 task_id")


# ---------- 双模型对比分析响应模型 ----------

class ModelAnalyzeResult(BaseModel):
    """单个模型的分析结果"""
    model_name: str = Field(..., description="模型名称")
    success: bool = Field(..., description="是否成功")
    error: Optional[str] = Field(default=None, description="错误信息（失败时）")
    description: Optional[str] = Field(default=None)
    insight: Optional[str] = Field(default=None)
    items: List[FoodItemResponse] = Field(default_factory=list)
    pfc_ratio_comment: Optional[str] = Field(default=None)
    absorption_notes: Optional[str] = Field(default=None)
    context_advice: Optional[str] = Field(default=None)
    recognitionOutcome: Optional[str] = Field(default=None)
    rejectionReason: Optional[str] = Field(default=None)
    retakeGuidance: Optional[List[str]] = Field(default=None)
    allowedFoodCategory: Optional[str] = Field(default=None)
    followupQuestions: Optional[List[str]] = Field(default=None)


class CompareAnalyzeResponse(BaseModel):
    """双模型对比分析响应"""
    qwen_result: ModelAnalyzeResult = Field(..., description="千问模型分析结果")
    gemini_result: ModelAnalyzeResult = Field(..., description="Gemini 模型分析结果")


# ---------- Gemini 分析函数 ----------

def _build_gemini_prompt(
    additional_context: str = "",
    goal_hint: str = "",
    state_hint: str = "",
    remain_hint: str = "",
    meal_hint: str = "",
    location_hint: str = "",
    profile_block: str = "",
    compact_tags: str = "",
    mode_hint: str = "",
    execution_mode: str = "standard",
) -> str:
    """构建 Gemini 分析的提示词（标准模式精简版，精准模式保留完整字段）。"""
    additional_line = (
        f'用户补充背景信息: "{additional_context}"。请根据此信息调整对隐形成分或烹饪方式的判断。'
        if additional_context else ""
    )
    if execution_mode != "strict":
        # ── 标准模式：精简 prompt，减少输出 token ──────────────────────────────
        return f"""
识别图片中的食物，估算重量和营养，仅返回 JSON。
{compact_tags}{additional_line}
估重时请优先看：占盘面积、厚度/高度、堆叠体积、容器大小、透视关系。
若画面里有筷子、勺子、手掌、包装、餐盒、碗盘等参照物，请利用参照物。
结合常识估算熟食密度、含水量、常见售卖分量，不要只看上表面面积。
输出要求：
- 简体中文
- description <= 16字
- insight 1-2句，<= 32字
- context_advice 1-2句，<= 32字，无需则空字符串
- 建议写得自然一点，但不要空泛和重复
- 只返回 JSON

JSON:
{{
  "items":[{{"name":"","estimatedWeightGrams":0,"nutrients":{{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0}}}}],
  "description":"",
  "insight":"",
  "context_advice":""
}}
""".strip()

    # ── 精准模式：保留完整字段 ─────────────────────────────────────────────────
    return f"""
请作为专业的营养师分析这张图片。

1. 识别图中所有不同的食物单品。
2. 估算每种食物的重量（克）和详细营养成分。
3. description: 提供这顿饭的简短中文描述。
4. insight: 基于该餐营养成分的一句话健康建议。{meal_hint}
5. pfc_ratio_comment: 本餐蛋白质(P)、脂肪(F)、碳水(C) 占比的简要评价（是否均衡、适合增肌/减脂/维持）。{goal_hint}
6. absorption_notes: 食物组合或烹饪方式对吸收率、生物利用度的简要说明（如维生素C促铁吸收、油脂助脂溶性维生素等，一两句话）。
7. context_advice: 结合用户状态、位置或剩余热量的情境建议（若无则可为空字符串）。{state_hint}{remain_hint}{location_hint}{profile_block}
8. 请遵守以下执行模式约束：{mode_hint}

{additional_line}

重要：请务必使用**简体中文**返回所有文本内容。
请严格按照以下 JSON 格式返回，不要包含任何其他文本：

{{
  "items": [
    {{
      "name": "食物名称（简体中文）",
      "estimatedWeightGrams": 重量（数字）,
      "nutrients": {{
        "calories": 热量,
        "protein": 蛋白质,
        "carbs": 碳水,
        "fat": 脂肪,
        "fiber": 纤维,
        "sugar": 糖分
      }}
    }}
  ],
  "description": "餐食描述（简体中文）",
  "insight": "健康建议（简体中文）",
  "pfc_ratio_comment": "PFC 比例评价（简体中文，一两句话）",
  "absorption_notes": "吸收率/生物利用度说明（简体中文，一两句话）",
  "context_advice": "情境建议（简体中文，若无则空字符串）"
}}
""".strip()



async def _analyze_with_gemini(
    image_url: str = None,
    image_urls: list = None,
    base64_image: str = None,
    image_mime_type: str = "image/jpeg",
    prompt: str = "",
    model_name: str = GEMINI_MODEL_NAME
) -> Dict[str, Any]:
    """
    使用 Gemini 模型分析食物图片（通过 OfoxAI OpenAI 兼容 API）。
    支持单图（image_url / base64_image）或多图（image_urls）。
    """
    api_key = os.getenv("OFOXAI_API_KEY") or os.getenv("ofox_ai_apikey")
    if not api_key or api_key == "your_ofoxai_api_key_here":
        raise Exception("请在 .env 中配置有效的 OFOXAI_API_KEY")

    content_parts = [{"type": "text", "text": prompt}]
    if image_urls and len(image_urls) > 0:
        for u in image_urls:
            content_parts.append({"type": "image_url", "image_url": {"url": u}})
    elif image_url:
        content_parts.append({"type": "image_url", "image_url": {"url": image_url}})
    elif base64_image:
        image_data = (
            base64_image
            if "," in base64_image
            else f"data:{image_mime_type};base64,{base64_image}"
        )
        content_parts.append({"type": "image_url", "image_url": {"url": image_data}})
    else:
        raise Exception("请提供 image_url、image_urls 或 base64_image")

    api_url = f"{OFOXAI_BASE_URL}/chat/completions"
    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            api_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model_name,
                "messages": [{"role": "user", "content": content_parts}],
                "response_format": {"type": "json_object"},
                "temperature": 0.7,
            }
        )
        
        if not response.is_success:
            error_data = response.json() if response.content else {}
            error_message = (
                error_data.get("error", {}).get("message")
                or f"OfoxAI API 错误: {response.status_code}"
            )
            raise Exception(error_message)
        
        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        
        if not content:
            raise Exception("Gemini (via OfoxAI) 返回了空响应")
        
        # 清理可能的 markdown 代码块标记
        json_str = re.sub(r"```json", "", content)
        json_str = re.sub(r"```", "", json_str).strip()
        
        try:
            parsed = json.loads(json_str)
        except json.JSONDecodeError:
            raise Exception("Gemini 返回的 JSON 格式解析失败")
        
        return parsed


async def _analyze_text_with_gemini(prompt: str, model_name: str = GEMINI_MODEL_NAME) -> Dict[str, Any]:
    """调用 OfoxAI Gemini 做纯文本分析（如文字描述食物），返回解析后的 JSON。"""
    api_key = os.getenv("OFOXAI_API_KEY") or os.getenv("ofox_ai_apikey")
    if not api_key or api_key == "your_ofoxai_api_key_here":
        raise Exception("请在 .env 中配置有效的 OFOXAI_API_KEY")
    api_url = f"{OFOXAI_BASE_URL}/chat/completions"
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            api_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model_name,
                "messages": [{"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"},
                "temperature": 0.5,
            },
        )
        if not response.is_success:
            error_data = response.json() if response.content else {}
            raise Exception(error_data.get("error", {}).get("message") or f"OfoxAI API 错误: {response.status_code}")
        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not content:
            raise Exception("Gemini 返回了空响应")
        json_str = re.sub(r"```json", "", content)
        json_str = re.sub(r"```", "", json_str).strip()
        return _normalize_analysis_response_payload(json.loads(json_str))


async def _analyze_with_qwen(
    request: "AnalyzeRequest",
    prompt: str,
    image_url_for_api: str,
    api_key: str,
    base_url: str
) -> Dict[str, Any]:
    """使用千问模型分析食物图片（复用现有逻辑）"""
    api_url = f"{base_url}/chat/completions"
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            api_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": request.modelName or "qwen-vl-max",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": image_url_for_api}}
                        ]
                    }
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.7,
            }
        )
        
        if not response.is_success:
            error_data = response.json() if response.content else {}
            error_message = (
                error_data.get("error", {}).get("message")
                or f"DashScope API 错误: {response.status_code}"
            )
            raise Exception(error_message)
        
        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        
        if not content:
            raise Exception("千问返回了空响应")
        
        json_str = re.sub(r"```json", "", content)
        json_str = re.sub(r"```", "", json_str).strip()

        return _normalize_analysis_response_payload(json.loads(json_str))


def _normalize_analysis_response_payload(parsed: Any) -> Dict[str, Any]:
    """将模型返回归一化为对象结构，避免偶发数组响应导致后续 .get 崩溃。"""
    if isinstance(parsed, dict):
        return parsed
    if isinstance(parsed, list):
        dict_items = [
            item for item in parsed
            if isinstance(item, dict) and any(
                key in item for key in ("name", "estimatedWeightGrams", "nutrients")
            )
        ]
        if dict_items:
            return {"items": dict_items}
    raise ValueError("识别结果格式异常，请重试")


def _parse_food_item_responses(parsed: Dict[str, Any]) -> List[FoodItemResponse]:
    valid_items: List[FoodItemResponse] = []
    raw_items = parsed.get("items")
    if not isinstance(raw_items, list):
        return valid_items

    for item in raw_items:
        if not isinstance(item, dict):
            continue
        raw_nutrients = item.get("nutrients")
        nutrients_dict = raw_nutrients if isinstance(raw_nutrients, dict) else {}
        nutrients = Nutrients(
            calories=float(nutrients_dict.get("calories", 0) or 0),
            protein=float(nutrients_dict.get("protein", 0) or 0),
            carbs=float(nutrients_dict.get("carbs", 0) or 0),
            fat=float(nutrients_dict.get("fat", 0) or 0),
            fiber=float(nutrients_dict.get("fiber", 0) or 0),
            sugar=float(nutrients_dict.get("sugar", 0) or 0),
        )
        weight = float(item.get("estimatedWeightGrams", 0) or 0)
        valid_items.append(
            FoodItemResponse(
                name=str(item.get("name", "未知食物")),
                estimatedWeightGrams=weight,
                originalWeightGrams=weight,
                nutrients=nutrients,
            )
        )
    return valid_items


def _parse_analyze_result(parsed: Dict[str, Any]) -> tuple:
    """解析分析结果，返回 (items, description, insight, pfc, absorption, context)"""
    parsed = _normalize_analysis_response_payload(parsed)
    valid_items = _parse_food_item_responses(parsed)
    
    def _opt_str(v):
        if v is None or v == "":
            return None
        s = str(v).strip()
        return s if s else None
    
    return (
        valid_items,
        str(parsed.get("description", "无法获取描述")),
        str(parsed.get("insight", "保持健康饮食！")),
        _opt_str(parsed.get("pfc_ratio_comment")),
        _opt_str(parsed.get("absorption_notes")),
        _opt_str(parsed.get("context_advice")),
    )


def _strip_standard_mode_extras(
    execution_mode: str,
    pfc_ratio_comment: Optional[str],
    absorption_notes: Optional[str],
) -> tuple[Optional[str], Optional[str]]:
    if execution_mode == "strict":
        return pfc_ratio_comment, absorption_notes
    return None, None


def _resolve_food_vision_model_config(model_name: Optional[str]) -> Dict[str, str]:
    raw = str(model_name or "").strip()
    normalized = raw.lower()
    if not raw or normalized in {"qwen", "qwen-vl", "qwen-vl-max"}:
        return {
            "provider": "qwen",
            "model": "qwen-vl-max",
        }
    if normalized in {"gemini", "gemini-flash", "gemini-vision"}:
        return {
            "provider": "gemini",
            "model": GEMINI_MODEL_NAME,
        }
    if normalized.startswith("gemini"):
        return {
            "provider": "gemini",
            "model": raw,
        }
    return {
        "provider": "qwen",
        "model": raw,
    }


class LoginRequest(BaseModel):
    code: str = Field(..., description="微信小程序登录凭证 code")
    phoneCode: Optional[str] = Field(default=None, description="获取手机号的 code（可选）")


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # token 过期时间（秒）
    user_id: str
    openid: str
    unionid: Optional[str] = None
    phoneNumber: Optional[str] = None
    purePhoneNumber: Optional[str] = None
    countryCode: Optional[str] = None
    diet_goal: Optional[str] = None


class MembershipPlanResponse(BaseModel):
    code: str
    name: str
    amount: float
    duration_months: int
    description: Optional[str] = None
    # 新定价体系字段（2026-04-21）
    tier: Optional[str] = None              # light | standard | advanced
    period: Optional[str] = None            # monthly | quarterly | yearly
    daily_credits: int = 0                  # 对应套餐每日积分
    original_amount: Optional[float] = None # 对照价（无则为 null）
    savings: Optional[float] = None         # = original_amount - amount，用于"立省 xx"
    sort_order: int = 0


class MembershipStatusResponse(BaseModel):
    is_pro: bool
    status: str
    current_plan_code: Optional[str] = None
    first_activated_at: Optional[str] = None
    current_period_start: Optional[str] = None
    expires_at: Optional[str] = None
    last_paid_at: Optional[str] = None
    # 兼容旧的拍照日限（当前关闭，保留字段避免前端崩）
    daily_limit: Optional[int] = None
    daily_used: Optional[int] = None
    daily_remaining: Optional[int] = None
    # 新积分体系字段（2026-04-21）
    daily_credits_max: int = 0              # 每日可用积分上限
    daily_credits_used: int = 0             # 今日已消耗积分
    daily_credits_remaining: int = 0        # 今日剩余积分
    daily_credits_base: int = 0             # 基础积分（套餐/试用）
    daily_bonus_credits: int = 0            # 今日额外奖励积分总和
    invite_bonus_credits: int = 0           # 今日邀请奖励积分
    share_bonus_credits: int = 0            # 今日海报奖励积分
    credits_reset_at: Optional[str] = None  # 次日 00:00+08:00
    trial_active: bool = False              # 是否在免费试用期
    trial_expires_at: Optional[str] = None  # 试用截止（UTC）
    trial_days_total: int = 0              # 当前试用总天数：60 / 30 / 3 / 0
    trial_policy: Optional[str] = None     # founding_top_500_bonus_month / early_first_1000 / regular_new_user
    early_user_rank: Optional[int] = None  # 若属于前 1000 名，则返回其注册名次（1-based）
    early_user_limit: int = 0              # 创始用户活动总名额
    early_user_paid_bonus_multiplier: int = 1  # 前 1000 名付费会员积分倍数
    early_user_paid_bonus_eligible: bool = False # 是否属于创始用户翻倍活动
    early_user_paid_bonus_active: bool = False   # 当前付费权益是否已按创始翻倍生效


class ClaimSharePosterRewardRequest(BaseModel):
    record_id: Optional[str] = Field(default=None, description="来源饮食记录 ID，仅允许给自己的记录领取")


class ClaimSharePosterRewardResponse(BaseModel):
    claimed: bool
    already_claimed: bool = False
    credits: int = 0
    daily_credits_max: Optional[int] = None
    daily_credits_remaining: Optional[int] = None
    message: str


class MembershipPlansListResponse(BaseModel):
    list: List[MembershipPlanResponse]


class CreateMembershipPaymentRequest(BaseModel):
    plan_code: str = Field(..., description="会员套餐编码，如 standard_monthly")


class PaymentParamsResponse(BaseModel):
    timeStamp: str
    nonceStr: str
    package: str
    signType: str
    paySign: str


class CreateMembershipPaymentResponse(BaseModel):
    order_no: str
    plan_code: str
    amount: float
    pay_params: PaymentParamsResponse


# 活动水平中文映射（用于健康档案摘要）
ACTIVITY_LEVEL_LABELS = {
    "sedentary": "久坐",
    "light": "轻度活动",
    "moderate": "中度活动",
    "active": "高度活动",
    "very_active": "极高活动",
}


def _format_health_profile_for_analysis(user: Dict[str, Any]) -> str:
    """
    将 weapp_user 健康档案格式化为供 AI 参考的简短摘要。
    用于在食物分析时结合体质、病史、过敏等给出更全面建议。
    """
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
    if medical:
        line3 = "· 既往病史：" + "、".join(medical) if isinstance(medical, list) else "· 既往病史：" + str(medical)
    else:
        line3 = ""
    diet = hc.get("diet_preference") or []
    if diet:
        line4 = "· 饮食偏好：" + "、".join(diet) if isinstance(diet, list) else "· 饮食偏好：" + str(diet)
    else:
        line4 = ""
    allergies = hc.get("allergies") or []
    if allergies:
        line5 = "· 过敏/忌口：" + "、".join(allergies) if isinstance(allergies, list) else "· 过敏/忌口：" + str(allergies)
    else:
        line5 = ""
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


def _safe_float_or_none(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None


async def _build_exercise_profile_snapshot(user_id: str) -> Dict[str, Any]:
    """构建运动热量估算所需的用户画像快照。"""
    snapshot: Dict[str, Any] = {}
    user = await get_user_by_id(user_id)
    latest_weight_row = None
    try:
        latest_weight_row = await get_latest_user_weight_record(user_id)
    except Exception as e:
        print(f"[_build_exercise_profile_snapshot] 获取最近体重失败: {e}")

    if user:
        height_cm = _safe_float_or_none(user.get("height"))
        if height_cm is not None:
            snapshot["height_cm"] = round(height_cm, 1)

        gender = str(user.get("gender") or "").strip().lower()
        if gender in {"male", "female"}:
            snapshot["gender"] = gender

        birthday = str(user.get("birthday") or "").strip()
        if birthday:
            snapshot["birthday"] = birthday
            age_years = get_age_from_birthday(birthday)
            if age_years is not None:
                snapshot["age_years"] = age_years

        activity_level = str(user.get("activity_level") or "").strip()
        if activity_level:
            snapshot["activity_level"] = activity_level

        bmr = _safe_float_or_none(user.get("bmr"))
        if bmr is not None:
            snapshot["bmr"] = round(bmr, 1)

        tdee = _safe_float_or_none(user.get("tdee"))
        if tdee is not None:
            snapshot["tdee"] = round(tdee, 1)

    if latest_weight_row and latest_weight_row.get("weight_kg") is not None:
        weight_kg = _safe_float_or_none(latest_weight_row.get("weight_kg"))
        if weight_kg is not None:
            snapshot["weight_kg"] = round(weight_kg, 1)
            snapshot["weight_source"] = "latest_weight_record"
            if latest_weight_row.get("recorded_on"):
                snapshot["weight_recorded_on"] = str(latest_weight_row.get("recorded_on"))
    elif user and user.get("weight") is not None:
        weight_kg = _safe_float_or_none(user.get("weight"))
        if weight_kg is not None:
            snapshot["weight_kg"] = round(weight_kg, 1)
            snapshot["weight_source"] = "user_profile"

    return snapshot


def _format_health_risk_summary_for_analysis(user: Dict[str, Any]) -> str:
    """标准模式只保留影响建议的最小风险摘要，避免长档案拉高 token。"""
    hc = user.get("health_condition") or {}
    if isinstance(hc, str):
        try:
            hc = json.loads(hc) if hc else {}
        except Exception:
            hc = {}

    tags: List[str] = []
    medical = hc.get("medical_history") or []
    if isinstance(medical, list):
        tags.extend(str(x).strip() for x in medical if str(x).strip())
    elif medical:
        tags.append(str(medical).strip())

    allergies = hc.get("allergies") or []
    if isinstance(allergies, list):
        tags.extend(f"忌口{str(x).strip()}" for x in allergies if str(x).strip())
    elif allergies:
        tags.append(f"忌口{str(allergies).strip()}")

    diet = hc.get("diet_preference") or []
    if isinstance(diet, list):
        tags.extend(str(x).strip() for x in diet if str(x).strip())
    elif diet:
        tags.append(str(diet).strip())

    uniq: List[str] = []
    seen = set()
    for tag in tags:
        if tag and tag not in seen:
            seen.add(tag)
            uniq.append(tag)
    if not uniq:
        return ""
    return "健康摘要:" + "、".join(uniq[:4])


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze_food(
    request: AnalyzeRequest,
    user_info: Optional[dict] = Depends(get_optional_user_info),
):
    """
    分析食物图片，返回营养成分和健康建议。使用 DashScope 千问 qwen-vl-max 模型。
    """
    try:
        model_config = _resolve_food_vision_model_config(request.modelName)
        dashscope_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
        if model_config["provider"] == "qwen" and not dashscope_key:
            raise HTTPException(status_code=500, detail="缺少 DASHSCOPE_API_KEY 环境变量")

        if not request.base64Image and not request.image_url and not request.image_urls:
            raise HTTPException(status_code=400, detail="请提供 base64Image 或 image_url 或 image_urls")
        if (request.base64Image and request.image_url) or (request.base64Image and request.image_urls):
            raise HTTPException(status_code=400, detail="base64Image 不能与 image_url/image_urls 同时传")

        goal_hint = ""
        if request.user_goal:
            goal_map = {"muscle_gain": "增肌", "fat_loss": "减脂", "maintain": "维持体重"}
            goal_hint = f"\n用户目标为「{goal_map.get(request.user_goal, request.user_goal)}」，请在 pfc_ratio_comment 中评价本餐 P/C/F 占比是否适合该目标。"
        state_hint = ""
        state_parts: List[str] = []
        if request.diet_goal or request.activity_timing:
            diet_map = {"fat_loss": "减脂期", "muscle_gain": "增肌期", "maintain": "维持体重", "none": "无特殊目标"}
            activity_map = {"post_workout": "练后", "daily": "日常", "before_sleep": "睡前", "none": "无特殊"}
            diet_text = diet_map.get(request.diet_goal, request.diet_goal) if request.diet_goal and request.diet_goal != "none" else ""
            activity_text = activity_map.get(request.activity_timing, request.activity_timing) if request.activity_timing and request.activity_timing != "none" else ""
            state_parts = [s for s in [diet_text, activity_text] if s]
            if state_parts:
                state_hint = f"\n用户当前状态: {' + '.join(state_parts)}，请在 context_advice 中给出针对性进食建议（如补剂、搭配）。"
        remain_hint = f"\n用户当日剩余热量预算约 {request.remaining_calories} kcal，可在 context_advice 中提示本餐占比或下一餐建议。" if request.remaining_calories is not None else ""
        meal_hint = ""
        meal_name = ""
        if request.meal_type:
            meal_name = _meal_name(request.meal_type, timezone_offset_minutes=request.timezone_offset_minutes)
            meal_hint = f"\n用户选择的是「{meal_name}」，请结合餐次特点在 insight 或 context_advice 中给出建议（如早餐适合碳水与蛋白搭配、晚餐宜清淡等）。"
        location_text = _build_location_text(request.province, request.city, request.district)
        location_hint = (
            f"\n用户当前所在地区约为「{location_text}」，可把它作为辅助线索，用于理解可能的地域菜名、口味和常见分量；若与图片内容冲突，始终以图片本身为准。"
            if location_text else ""
        )
        requested_mode = _parse_execution_mode_or_raise(request.execution_mode) if request.execution_mode is not None else None
        execution_mode = requested_mode
        profile_block = ""
        compact_tags_list: List[str] = []
        if request.meal_type:
            compact_tags_list.append(f"餐次:{meal_name}")
        if state_parts:
            compact_tags_list.append("状态:" + "/".join(state_parts))
        if request.remaining_calories is not None:
            compact_tags_list.append(f"剩余:{float(request.remaining_calories):g}kcal")
        if location_text:
            compact_tags_list.append(f"位置:{location_text}")
        user = None
        if user_info:
            user = await get_user_by_id(user_info["user_id"])
            execution_mode = requested_mode or _normalize_execution_mode((user or {}).get("execution_mode"))
            if user:
                if execution_mode == "strict":
                    profile_block = _format_health_profile_for_analysis(user)
                    if profile_block:
                        profile_block = "\n\n若以下存在「用户健康档案」，请结合档案在 insight、absorption_notes、context_advice 中给出更贴合该用户体质与健康状况的建议（如控糖、低嘌呤、过敏规避等）。\n\n" + profile_block
                else:
                    profile_summary = _format_health_risk_summary_for_analysis(user)
                    if profile_summary:
                        compact_tags_list.append(profile_summary)
        if execution_mode is None:
            execution_mode = _normalize_execution_mode(None)

        # 配额检查（已登录用户）
        if user_info:
            membership = await _get_effective_membership(user_info["user_id"])
            membership_resp = _format_membership_response(membership)
            _, _, _, execution_mode = await _validate_food_analysis_access(
                user_id=user_info["user_id"],
                effective_mode=execution_mode,
                strict_requested=(requested_mode == "strict"),
                user_row=user,
                membership=membership,
                membership_resp=membership_resp,
            )

        mode_hint = _build_execution_mode_hint(execution_mode)
        compact_tags = ("\n".join(compact_tags_list) + "\n") if compact_tags_list else ""

        prompt = _build_gemini_prompt(
            additional_context=request.additionalContext or "",
            goal_hint=goal_hint,
            state_hint=state_hint,
            remain_hint=remain_hint,
            meal_hint=meal_hint,
            location_hint=location_hint,
            profile_block=profile_block or "",
            compact_tags=compact_tags,
            mode_hint=mode_hint,
            execution_mode=execution_mode,
        )

        model_config = _resolve_food_vision_model_config(request.modelName)

        # 构建图片输入
        image_urls_for_api = []
        if request.image_urls:
            image_urls_for_api = request.image_urls
        elif request.image_url:
            image_urls_for_api = [request.image_url]
        base64_image_for_api = None
        if request.base64Image:
            image_data = request.base64Image.split(",")[1] if "," in request.base64Image else request.base64Image
            base64_image_for_api = image_data

        if model_config["provider"] == "gemini":
            parsed = await _analyze_with_gemini(
                image_url=request.image_url if request.image_url else None,
                image_urls=image_urls_for_api if request.image_urls else None,
                base64_image=base64_image_for_api,
                prompt=prompt,
                model_name=model_config["model"],
            )
            parsed = _normalize_analysis_response_payload(parsed)
        else:
            content_parts = [{"type": "text", "text": prompt}]
            for url in image_urls_for_api:
                content_parts.append({"type": "image_url", "image_url": {"url": url}})

            base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
            api_url = f"{base_url}/chat/completions"

            async with httpx.AsyncClient(timeout=90.0) as client:
                response = await client.post(
                    api_url,
                    headers={
                        "Authorization": f"Bearer {dashscope_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model_config["model"],
                        "messages": [{"role": "user", "content": content_parts}],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.7,
                    },
                )

                if not response.is_success:
                    error_data = response.json() if response.content else {}
                    error_message = (
                        error_data.get("error", {}).get("message")
                        or f"DashScope API 错误: {response.status_code}"
                    )
                    raise Exception(error_message)

                data = response.json()
                content_str = data.get("choices", [{}])[0].get("message", {}).get("content")
                if not content_str:
                    raise Exception("千问返回了空响应")

                json_str = re.sub(r"```json", "", content_str)
                json_str = re.sub(r"```", "", json_str).strip()
                parsed = _normalize_analysis_response_payload(json.loads(json_str))

        valid_items = _parse_food_item_responses(parsed)

        def _opt_str(v):
            if v is None or v == "":
                return None
            s = str(v).strip()
            return s if s else None

        pfc_ratio_comment, absorption_notes = _strip_standard_mode_extras(
            execution_mode,
            _opt_str(parsed.get("pfc_ratio_comment")),
            _opt_str(parsed.get("absorption_notes")),
        )

        return AnalyzeResponse(
            description=str(parsed.get("description", "无法获取描述")),
            insight=str(parsed.get("insight", "保持健康饮食！")),
            items=valid_items,
            pfc_ratio_comment=pfc_ratio_comment,
            absorption_notes=absorption_notes,
            context_advice=_opt_str(parsed.get("context_advice")),
            recognitionOutcome=_opt_str(parsed.get("recognitionOutcome")),
            rejectionReason=_opt_str(parsed.get("rejectionReason")),
            retakeGuidance=parsed.get("retakeGuidance") if isinstance(parsed.get("retakeGuidance"), list) else None,
            allowedFoodCategory=_opt_str(parsed.get("allowedFoodCategory")),
            followupQuestions=parsed.get("followupQuestions") if isinstance(parsed.get("followupQuestions"), list) else None,
        )
    except HTTPException:
        raise
    except httpx.TimeoutException:
        print("[api/analyze] error: DashScope 请求超时")
        raise HTTPException(status_code=500, detail="AI 服务超时，请稍后重试")
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=str(e) or "连接 AI 服务失败")
    except Exception as e:
        msg = str(e) or f"未知错误: {type(e).__name__}"
        print(f"[api/analyze] error: {msg}")
        raise HTTPException(status_code=500, detail=msg)

# ---------- 批量分析（多张不同食物分别识别，结果累加） ----------


class AnalyzeBatchRequest(BaseModel):
    """批量食物分析请求：每张图片单独识别，结果累加"""
    image_urls: List[str] = Field(..., description="多图 URL 列表（2-5 张，每张为不同食物）")
    meal_type: Optional[str] = Field(default=None, description=MEAL_TYPE_DESCRIPTION)
    timezone_offset_minutes: Optional[int] = Field(default=None, description="客户端时区偏移")
    diet_goal: Optional[str] = Field(default=None, description="饮食目标")
    activity_timing: Optional[str] = Field(default=None, description="运动时机")
    user_goal: Optional[str] = Field(default=None, description="用户目标")
    remaining_calories: Optional[float] = Field(default=None, description="当日剩余热量预算")
    additionalContext: Optional[str] = Field(default=None, description="用户补充上下文")
    modelName: Optional[str] = Field(default="qwen-vl-max", description="模型名称")
    execution_mode: Optional[str] = Field(default=None, description="执行模式")
    reference_objects: Optional[List[PrecisionReferenceObjectInput]] = Field(default=None, description="参考物列表")


class AnalyzeBatchResponse(BaseModel):
    """批量分析响应"""
    task_id: str
    image_count: int
    result: AnalyzeResponse


async def _analyze_single_image_for_batch(
    image_url: str,
    prompt: str,
    model_name: str,
    api_key: Optional[str],
    base_url: str,
) -> Dict[str, Any]:
    """为批量分析调用 AI 分析单张图片"""
    model_config = _resolve_food_vision_model_config(model_name)
    if model_config["provider"] == "gemini":
        last_error: Optional[Exception] = None
        for attempt in range(3):
            try:
                parsed = await _analyze_with_gemini(
                    image_url=image_url,
                    prompt=prompt,
                    model_name=model_config["model"],
                )
                return _normalize_analysis_response_payload(parsed)
            except Exception as exc:
                last_error = exc
                if attempt < 2:
                    await asyncio.sleep(0.6 * (attempt + 1))
                    continue
        raise RuntimeError(str(last_error) or "单张图片分析失败")

    api_url = f"{base_url}/chat/completions"
    last_error: Optional[Exception] = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    api_url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model_config["model"],
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": prompt},
                                    {"type": "image_url", "image_url": {"url": image_url}},
                                ],
                            }
                        ],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.7,
                    },
                )
            if not response.is_success:
                error_data = response.json() if response.content else {}
                error_message = (
                    error_data.get("error", {}).get("message")
                    or f"DashScope API 错误: {response.status_code}"
                )
                raise RuntimeError(error_message)

            data = response.json()
            content_str = data.get("choices", [{}])[0].get("message", {}).get("content")
            if not content_str:
                raise RuntimeError("千问返回了空响应")

            json_str = re.sub(r"```json", "", content_str)
            json_str = re.sub(r"```", "", json_str).strip()
            return _normalize_analysis_response_payload(json.loads(json_str))
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                await asyncio.sleep(0.6 * (attempt + 1))
                continue

    raise RuntimeError(str(last_error) or "单张图片分析失败")


def _merge_unique_text_lists(*values: Any) -> Optional[List[str]]:
    seen = set()
    merged: List[str] = []
    for value in values:
        if not isinstance(value, list):
            continue
        for item in value:
            text = str(item or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            merged.append(text)
    return merged or None


def _merge_batch_results(results: List[Dict[str, Any]], execution_mode: str) -> Dict[str, Any]:
    """将多个单图分析结果累加为一份汇总结果"""
    all_items: List[Dict[str, Any]] = []
    descriptions: List[str] = []
    insights: List[str] = []
    pfc_comments: List[str] = []
    absorption_list: List[str] = []
    context_list: List[str] = []
    recognition_outcomes: List[str] = []
    rejection_reasons: List[str] = []
    allowed_categories: List[str] = []
    retake_guidance_lists: List[List[str]] = []
    followup_question_lists: List[List[str]] = []

    for parsed in results:
        parsed = _normalize_analysis_response_payload(parsed)
        items = parsed.get("items")
        if isinstance(items, list):
            all_items.extend(items)

        desc = str(parsed.get("description", "")).strip()
        if desc and desc != "无法获取描述":
            descriptions.append(desc)

        insight = str(parsed.get("insight", "")).strip()
        if insight and insight != "保持健康饮食！":
            insights.append(insight)

        pfc = parsed.get("pfc_ratio_comment")
        if pfc:
            pfc_comments.append(str(pfc).strip())

        absorption = parsed.get("absorption_notes")
        if absorption:
            absorption_list.append(str(absorption).strip())

        context = parsed.get("context_advice")
        if context:
            context_list.append(str(context).strip())

        recognition = str(parsed.get("recognitionOutcome", "")).strip()
        if recognition:
            recognition_outcomes.append(recognition)

        rejection_reason = str(parsed.get("rejectionReason", "")).strip()
        if rejection_reason:
            rejection_reasons.append(rejection_reason)

        allowed = str(parsed.get("allowedFoodCategory", "")).strip()
        if allowed:
            allowed_categories.append(allowed)

        retake_guidance = parsed.get("retakeGuidance")
        if isinstance(retake_guidance, list):
            retake_guidance_lists.append(retake_guidance)

        followup_questions = parsed.get("followupQuestions")
        if isinstance(followup_questions, list):
            followup_question_lists.append(followup_questions)

    # 累加营养值
    total_calories = 0.0
    total_protein = 0.0
    total_carbs = 0.0
    total_fat = 0.0
    total_fiber = 0.0
    total_sugar = 0.0
    total_weight = 0.0

    for item in all_items:
        if not isinstance(item, dict):
            continue
        nutrients = item.get("nutrients") or {}
        w = float(item.get("estimatedWeightGrams", 0) or 0)
        total_calories += float(nutrients.get("calories", 0) or 0)
        total_protein += float(nutrients.get("protein", 0) or 0)
        total_carbs += float(nutrients.get("carbs", 0) or 0)
        total_fat += float(nutrients.get("fat", 0) or 0)
        total_fiber += float(nutrients.get("fiber", 0) or 0)
        total_sugar += float(nutrients.get("sugar", 0) or 0)
        total_weight += w

    # 重建归一化的 items
    merged_items = []
    for item in all_items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "未知食物")).strip() or "未知食物"
        weight = float(item.get("estimatedWeightGrams", 0) or 0)
        nutrients = item.get("nutrients") or {}
        merged_items.append(
            {
                "name": name,
                "estimatedWeightGrams": weight,
                "originalWeightGrams": weight,
                "nutrients": {
                    "calories": float(nutrients.get("calories", 0) or 0),
                    "protein": float(nutrients.get("protein", 0) or 0),
                    "carbs": float(nutrients.get("carbs", 0) or 0),
                    "fat": float(nutrients.get("fat", 0) or 0),
                    "fiber": float(nutrients.get("fiber", 0) or 0),
                    "sugar": float(nutrients.get("sugar", 0) or 0),
                },
            }
        )

    merged = {
        "description": f"本餐共识别 {len(results)} 张图片，包含 {len(merged_items)} 种食物。"
        + (f" {descriptions[0]}" if descriptions else ""),
        "insight": " ".join(insights) if insights else "保持健康饮食！",
        "items": merged_items,
        "pfc_ratio_comment": pfc_comments[0] if pfc_comments else None,
        "absorption_notes": absorption_list[0] if absorption_list else None,
        "context_advice": " ".join(context_list) if context_list else None,
        "recognitionOutcome": None,
        "rejectionReason": rejection_reasons[0] if rejection_reasons else None,
        "retakeGuidance": _merge_unique_text_lists(*retake_guidance_lists),
        "allowedFoodCategory": None,
        "followupQuestions": _merge_unique_text_lists(*followup_question_lists),
    }

    if recognition_outcomes:
        if "hard_reject" in recognition_outcomes:
            merged["recognitionOutcome"] = "hard_reject"
        elif "soft_reject" in recognition_outcomes:
            merged["recognitionOutcome"] = "soft_reject"
        else:
            merged["recognitionOutcome"] = recognition_outcomes[0]

    unique_categories = []
    for category in allowed_categories:
        if category not in unique_categories:
            unique_categories.append(category)
    if len(unique_categories) == 1:
        merged["allowedFoodCategory"] = unique_categories[0]
    elif len(unique_categories) > 1:
        merged["allowedFoodCategory"] = "unknown"

    if execution_mode != "strict":
        merged["pfc_ratio_comment"] = None
        merged["absorption_notes"] = None
        merged["recognitionOutcome"] = None
        merged["rejectionReason"] = None
        merged["retakeGuidance"] = None
        merged["allowedFoodCategory"] = None
        merged["followupQuestions"] = None

    return merged


@app.post("/api/analyze/batch", response_model=AnalyzeBatchResponse)
async def analyze_batch(
    request: AnalyzeBatchRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    批量分析多张食物图片（每张单独识别，结果累加）。
    最多支持 5 张图片，每张图片视为不同食物分别识别。
    返回汇总后的分析结果和任务 ID。
    """
    try:
        if not request.image_urls or len(request.image_urls) == 0:
            raise HTTPException(status_code=400, detail="image_urls 不能为空")
        if len(request.image_urls) > 5:
            raise HTTPException(status_code=400, detail="最多支持 5 张图片")

        model_config = _resolve_food_vision_model_config(request.modelName)
        dashscope_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
        if model_config["provider"] == "qwen" and not dashscope_key:
            raise HTTPException(status_code=500, detail="缺少 DASHSCOPE_API_KEY 环境变量")

        # 构建公共上下文（与单图分析一致）
        goal_hint = ""
        if request.user_goal:
            goal_map = {"muscle_gain": "增肌", "fat_loss": "减脂", "maintain": "维持体重"}
            goal_hint = f"\n用户目标为「{goal_map.get(request.user_goal, request.user_goal)}」，请在 pfc_ratio_comment 中评价本餐 P/C/F 占比是否适合该目标。"
        state_hint = ""
        state_parts: List[str] = []
        if request.diet_goal or request.activity_timing:
            diet_map = {"fat_loss": "减脂期", "muscle_gain": "增肌期", "maintain": "维持体重", "none": "无特殊目标"}
            activity_map = {"post_workout": "练后", "daily": "日常", "before_sleep": "睡前", "none": "无特殊"}
            diet_text = diet_map.get(request.diet_goal, request.diet_goal) if request.diet_goal and request.diet_goal != "none" else ""
            activity_text = activity_map.get(request.activity_timing, request.activity_timing) if request.activity_timing and request.activity_timing != "none" else ""
            state_parts = [s for s in [diet_text, activity_text] if s]
            if state_parts:
                state_hint = f"\n用户当前状态: {' + '.join(state_parts)}，请在 context_advice 中给出针对性进食建议（如补剂、搭配）。"
        remain_hint = f"\n用户当日剩余热量预算约 {request.remaining_calories} kcal，可在 context_advice 中提示本餐占比或下一餐建议。" if request.remaining_calories is not None else ""
        meal_hint = ""
        meal_name = ""
        if request.meal_type:
            meal_name = _meal_name(request.meal_type, timezone_offset_minutes=request.timezone_offset_minutes)
            meal_hint = f"\n用户选择的是「{meal_name}」，请结合餐次特点在 insight 或 context_advice 中给出建议（如早餐适合碳水与蛋白搭配、晚餐宜清淡等）。"
        requested_mode = _parse_execution_mode_or_raise(request.execution_mode) if request.execution_mode is not None else None
        execution_mode = requested_mode
        profile_block = ""
        compact_tags_list: List[str] = []
        if request.meal_type:
            compact_tags_list.append(f"餐次:{meal_name}")
        if state_parts:
            compact_tags_list.append("状态:" + "/".join(state_parts))
        if request.remaining_calories is not None:
            compact_tags_list.append(f"剩余:{float(request.remaining_calories):g}kcal")
        user = await get_user_by_id(user_info["user_id"])
        profile_mode = _normalize_execution_mode((user or {}).get("execution_mode"))
        execution_mode = requested_mode or profile_mode
        if user:
            if execution_mode == "strict":
                profile_block = _format_health_profile_for_analysis(user)
                if profile_block:
                    profile_block = "\n\n若以下存在「用户健康档案」，请结合档案在 insight、absorption_notes、context_advice 中给出更贴合该用户体质与健康状况的建议（如控糖、低嘌呤、过敏规避等）。\n\n" + profile_block
            else:
                profile_summary = _format_health_risk_summary_for_analysis(user)
                if profile_summary:
                    compact_tags_list.append(profile_summary)
        if execution_mode is None:
            execution_mode = _normalize_execution_mode(None)

        # 配额检查（已登录用户）
        membership = await _get_effective_membership(user_info["user_id"])
        membership_resp = _format_membership_response(membership)
        _, _, _, execution_mode = await _validate_food_analysis_access(
            user_id=user_info["user_id"],
            effective_mode=execution_mode,
            strict_requested=(requested_mode == "strict"),
            user_row=user,
            membership=membership,
            membership_resp=membership_resp,
        )

        mode_hint = _build_execution_mode_hint(execution_mode)
        compact_tags = ("\n".join(compact_tags_list) + "\n") if compact_tags_list else ""

        # 批量分析的 prompt
        base_prompt = _build_gemini_prompt(
            additional_context=request.additionalContext or "",
            goal_hint=goal_hint,
            state_hint=state_hint,
            remain_hint=remain_hint,
            meal_hint=meal_hint,
            profile_block=profile_block or "",
            compact_tags=compact_tags,
            mode_hint=mode_hint,
            execution_mode=execution_mode,
        )

        base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")

        # 控制并发，避免多图同时打满模型接口后整批失败
        semaphore = asyncio.Semaphore(min(3, max(1, len(request.image_urls))))

        async def _analyze_one(index: int, image_url: str) -> Dict[str, Any]:
            async with semaphore:
                index_hint = f"\n\n【批量分析第 {index + 1}/{len(request.image_urls)} 张】请仅识别当前这张图片中的食物，不要与其他图片混淆。"
                prompt = base_prompt + index_hint
                return await _analyze_single_image_for_batch(
                    image_url=image_url,
                    prompt=prompt,
                    model_name=model_config["model"],
                    api_key=dashscope_key,
                    base_url=base_url,
                )

        results = await asyncio.gather(
            *[_analyze_one(i, url) for i, url in enumerate(request.image_urls)],
            return_exceptions=True,
        )

        # 检查是否有失败
        failed_indices = []
        successful_results: List[Dict[str, Any]] = []
        for i, res in enumerate(results):
            if isinstance(res, Exception):
                failed_indices.append(i)
                print(f"[analyze/batch] 第 {i + 1} 张图片分析失败: {res}")
            else:
                successful_results.append(res)

        if not successful_results:
            raise HTTPException(status_code=500, detail="所有图片分析均失败，请稍后重试")

        # 累加结果
        merged_raw = _merge_batch_results(successful_results, execution_mode)

        # 解析为类型化的 items
        valid_items = _parse_food_item_responses(merged_raw)

        def _opt_str(v):
            if v is None or v == "":
                return None
            s = str(v).strip()
            return s if s else None

        pfc_ratio_comment, absorption_notes = _strip_standard_mode_extras(
            execution_mode,
            _opt_str(merged_raw.get("pfc_ratio_comment")),
            _opt_str(merged_raw.get("absorption_notes")),
        )

        result = AnalyzeResponse(
            description=str(merged_raw.get("description", "无法获取描述")),
            insight=str(merged_raw.get("insight", "保持健康饮食！")),
            items=valid_items,
            pfc_ratio_comment=pfc_ratio_comment,
            absorption_notes=absorption_notes,
            context_advice=_opt_str(merged_raw.get("context_advice")),
            recognitionOutcome=_opt_str(merged_raw.get("recognitionOutcome")),
            rejectionReason=_opt_str(merged_raw.get("rejectionReason")),
            retakeGuidance=merged_raw.get("retakeGuidance") if isinstance(merged_raw.get("retakeGuidance"), list) else None,
            allowedFoodCategory=_opt_str(merged_raw.get("allowedFoodCategory")),
            followupQuestions=merged_raw.get("followupQuestions") if isinstance(merged_raw.get("followupQuestions"), list) else None,
        )

        # 创建分析任务记录
        payload = {
            "meal_type": request.meal_type,
            "timezone_offset_minutes": request.timezone_offset_minutes,
            "diet_goal": request.diet_goal,
            "activity_timing": request.activity_timing,
            "user_goal": request.user_goal,
            "remaining_calories": request.remaining_calories,
            "additionalContext": request.additionalContext,
            "modelName": request.modelName,
            "execution_mode": execution_mode,
            "reference_objects": _serialize_reference_objects(request.reference_objects),
            "batch_image_count": len(request.image_urls),
            "failed_indices": failed_indices,
        }
        task = await asyncio.to_thread(
            create_analysis_task_sync,
            user_id=user_info["user_id"],
            task_type="food",
            image_url=request.image_urls[0] if request.image_urls else None,
            image_urls=request.image_urls,
            payload=payload,
        )

        # 将汇总结果直接写入任务
        await asyncio.to_thread(
            update_analysis_task_result_sync,
            task_id=task["id"],
            status="done",
            result=result.dict(),
        )

        return AnalyzeBatchResponse(
            task_id=task["id"],
            image_count=len(request.image_urls),
            result=result,
        )

    except HTTPException:
        raise
    except httpx.TimeoutException:
        print("[api/analyze/batch] error: DashScope 请求超时")
        raise HTTPException(status_code=500, detail="AI 服务超时，请稍后重试")
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=str(e) or "连接 AI 服务失败")
    except Exception as e:
        msg = str(e) or f"未知错误: {type(e).__name__}"
        print(f"[api/analyze/batch] error: {msg}")
        raise HTTPException(status_code=500, detail=msg)

class UploadAnalyzeImageRequest(BaseModel):
    """食物分析前上传图片，返回 Supabase 公网 URL"""
    base64Image: str = Field(..., description="Base64 编码的图片数据")


def _guess_upload_image_suffix(filename: Optional[str], content_type: Optional[str]) -> str:
    ext = os.path.splitext((filename or "").strip())[1].lower()
    if ext in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"}:
        return ext

    guessed = mimetypes.guess_extension((content_type or "").strip()) or ""
    guessed = guessed.lower()
    if guessed in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"}:
        return guessed
    return ".jpg"


@app.post("/api/upload-analyze-image")
async def upload_analyze_image(body: UploadAnalyzeImageRequest):
    """
    食物分析前先上传图片到 Supabase，返回公网 URL。
    前端拿到 URL 后传给 /api/analyze 的 image_url，分析及标记样本时均使用该 URL。
    """
    if not body.base64Image:
        raise HTTPException(status_code=400, detail="base64Image 不能为空")
    try:
        image_url = upload_food_analyze_image(body.base64Image)
        return {"imageUrl": image_url}
    except ValueError as e:
        # base64 解码失败等参数错误
        print(f"[upload_analyze_image] 参数错误: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except ConnectionError as e:
        # 网络连接错误（SSL、EOF 等）
        error_msg = str(e) or "网络连接失败"
        print(f"[upload_analyze_image] 网络错误: {error_msg}")
        raise HTTPException(
            status_code=500,
            detail="上传图片时网络连接失败，请检查网络后重试"
        )
    except Exception as e:
        error_msg = str(e) or f"未知错误: {type(e).__name__}"
        # 检查是否是 SSL 或网络相关错误（兜底检查）
        if "SSL" in error_msg or "EOF" in error_msg or "connection" in error_msg.lower():
            print(f"[upload_analyze_image] 网络错误: {error_msg}")
            raise HTTPException(
                status_code=500,
                detail="上传图片时网络连接失败，请检查网络后重试"
            )
        print(f"[upload_analyze_image] 错误: {error_msg}")
        raise HTTPException(status_code=500, detail=f"上传图片失败: {error_msg}")


@app.post("/api/upload-analyze-image-file")
async def upload_analyze_image_file(file: UploadFile = File(...)):
    """
    食物分析前上传单张图片文件，返回 Supabase 公网 URL。
    相比 base64 JSON 上传更省请求体，优先给小程序端使用。
    """
    if file is None:
        raise HTTPException(status_code=400, detail="图片文件不能为空")
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="仅支持图片文件上传")

    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="图片文件为空")

        image_url = upload_food_analyze_image_bytes(
            file_bytes=file_bytes,
            extension=_guess_upload_image_suffix(file.filename, file.content_type),
            content_type=file.content_type or "image/jpeg",
        )
        return {"imageUrl": image_url}
    except HTTPException:
        raise
    except ValueError as e:
        print(f"[upload_analyze_image_file] 参数错误: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except ConnectionError as e:
        error_msg = str(e) or "网络连接失败"
        print(f"[upload_analyze_image_file] 网络错误: {error_msg}")
        raise HTTPException(
            status_code=500,
            detail="上传图片时网络连接失败，请检查网络后重试"
        )
    except Exception as e:
        error_msg = str(e) or f"未知错误: {type(e).__name__}"
        if "SSL" in error_msg or "EOF" in error_msg or "connection" in error_msg.lower():
            print(f"[upload_analyze_image_file] 网络错误: {error_msg}")
            raise HTTPException(
                status_code=500,
                detail="上传图片时网络连接失败，请检查网络后重试"
            )
        print(f"[upload_analyze_image_file] 错误: {error_msg}")
        raise HTTPException(status_code=500, detail=f"上传图片失败: {error_msg}")
    finally:
        await file.close()


# ---------- 异步分析任务（提交后由 Worker 子进程处理） ----------

class AnalyzeSubmitRequest(BaseModel):
    """提交食物分析任务：立即返回 task_id，结果由 Worker 写回后可从 /api/analyze/tasks 查询"""
    image_url: Optional[str] = Field(None, description="Supabase 公网图片 URL（需先调 upload-analyze-image）")
    image_urls: Optional[List[str]] = Field(None, description="多图 URL 列表（新版支持）")
    meal_type: Optional[str] = Field(default=None, description=MEAL_TYPE_DESCRIPTION)
    timezone_offset_minutes: Optional[int] = Field(default=None, description="客户端时区偏移（JS getTimezoneOffset，单位分钟）")
    province: Optional[str] = Field(default=None, description="省份/直辖市")
    city: Optional[str] = Field(default=None, description="城市")
    district: Optional[str] = Field(default=None, description="区县")
    diet_goal: Optional[str] = Field(default=None, description="饮食目标: fat_loss / muscle_gain / maintain / none")
    activity_timing: Optional[str] = Field(default=None, description="运动时机: post_workout / daily / before_sleep / none")
    user_goal: Optional[str] = Field(default=None, description="用户目标: muscle_gain / fat_loss / maintain")
    remaining_calories: Optional[float] = Field(default=None, description="当日剩余热量预算 kcal")
    additionalContext: Optional[str] = Field(default=None, description="用户补充上下文")
    modelName: Optional[str] = Field(default="qwen-vl-max", description="模型名称")
    is_multi_view: Optional[bool] = Field(default=False, description="是否开启多视角辅助模式")
    execution_mode: Optional[str] = Field(default=None, description="执行模式: standard / strict")
    previousResult: Optional[Dict[str, Any]] = Field(default=None, description="上一轮分析结果")
    correctionItems: Optional[List[Dict[str, Any]]] = Field(default=None, description="本轮结构化纠错清单")
    precision_session_id: Optional[str] = Field(default=None, description="精准模式会话 ID（继续多轮交互时传入）")
    reference_objects: Optional[List[PrecisionReferenceObjectInput]] = Field(default=None, description="参考物列表")


@app.post("/api/analyze/submit")
async def analyze_submit(
    body: AnalyzeSubmitRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    提交食物分析任务（异步）。立即返回 task_id，Worker 子进程会在后台执行分析，
    完成后可通过 GET /api/analyze/tasks/{task_id} 或列表接口查看结果。
    """
    if (not body.image_url or not body.image_url.strip()) and (not body.image_urls or len(body.image_urls) == 0):
        raise HTTPException(status_code=400, detail="image_url 或 image_urls 不能为空")
    if body.image_urls and len(body.image_urls) > 1 and not body.is_multi_view:
        raise HTTPException(status_code=400, detail="上传多张图片前请先开启多视角模式")

    requested_mode = _parse_execution_mode_or_raise(body.execution_mode) if body.execution_mode is not None else None
    user = await get_user_by_id(user_info["user_id"])
    profile_mode = _normalize_execution_mode((user or {}).get("execution_mode"))
    effective_mode = requested_mode or profile_mode
    membership = await _get_effective_membership(user_info["user_id"])
    membership_resp = _format_membership_response(membership)
    _, _, _, effective_mode = await _validate_food_analysis_access(
        user_id=user_info["user_id"],
        effective_mode=effective_mode,
        strict_requested=(requested_mode == "strict" or bool(body.precision_session_id)),
        user_row=user,
        membership=membership,
        membership_resp=membership_resp,
    )

    payload = {
        "meal_type": body.meal_type,
        "timezone_offset_minutes": body.timezone_offset_minutes,
        "province": body.province,
        "city": body.city,
        "district": body.district,
        "diet_goal": body.diet_goal,
        "activity_timing": body.activity_timing,
        "user_goal": body.user_goal,
        "remaining_calories": body.remaining_calories,
        "additionalContext": body.additionalContext,
        "modelName": body.modelName,
        "is_multi_view": body.is_multi_view,
        "execution_mode": effective_mode,
        "previousResult": body.previousResult,
        "correctionItems": body.correctionItems,
        "reference_objects": _serialize_reference_objects(body.reference_objects),
    }

    if effective_mode == "strict" or body.precision_session_id:
        session = None
        source_type = "image"
        if body.precision_session_id:
            session = await asyncio.to_thread(get_precision_session_by_id_sync, body.precision_session_id)
            if not session:
                raise HTTPException(status_code=404, detail="精准模式会话不存在")
            if session.get("user_id") != user_info["user_id"]:
                raise HTTPException(status_code=403, detail="无权继续该精准模式会话")
            if session.get("source_type") != source_type:
                raise HTTPException(status_code=400, detail="精准模式会话类型与当前提交不一致")
            if session.get("status") not in PRECISION_SESSION_ACTIVE_STATUSES:
                raise HTTPException(status_code=400, detail="该精准模式会话已结束，无法继续")

        latest_inputs = {
            **_build_precision_continue_payload(
                source_type=source_type,
                meal_type=body.meal_type,
                timezone_offset_minutes=body.timezone_offset_minutes,
                province=body.province,
                city=body.city,
                district=body.district,
                diet_goal=body.diet_goal,
                activity_timing=body.activity_timing,
                user_goal=body.user_goal,
                remaining_calories=body.remaining_calories,
                additional_context=body.additionalContext,
                is_multi_view=body.is_multi_view,
                reference_objects=payload["reference_objects"],
            ),
            "image_url": body.image_url.strip() if body.image_url else None,
            "image_urls": body.image_urls or [],
        }

        if session:
            next_round_index = int(session.get("round_index") or 1) + 1
            await asyncio.to_thread(
                update_precision_session_sync,
                session["id"],
                {
                    "status": "collecting",
                    "round_index": next_round_index,
                    "latest_inputs": latest_inputs,
                    "reference_objects": payload["reference_objects"] or (session.get("reference_objects") or []),
                    "last_error": None,
                },
            )
            await asyncio.to_thread(
                create_precision_session_round_sync,
                session["id"],
                next_round_index,
                "user",
                latest_inputs,
                None,
            )
            current_session_id = session["id"]
            current_round_index = next_round_index
        else:
            session = await asyncio.to_thread(
                create_precision_session_sync,
                user_info["user_id"],
                source_type,
                "strict",
                latest_inputs,
                payload["reference_objects"],
            )
            await asyncio.to_thread(
                create_precision_session_round_sync,
                session["id"],
                int(session.get("round_index") or 1),
                "user",
                latest_inputs,
                None,
            )
            current_session_id = session["id"]
            current_round_index = int(session.get("round_index") or 1)

        precision_payload = _create_precision_plan_task_payload(
            current_session_id,
            source_type,
            {
                **payload,
                "round_index": current_round_index,
            },
        )
        precision_task = await asyncio.to_thread(
            create_analysis_task_sync,
            user_id=user_info["user_id"],
            task_type=_get_food_task_type("precision_plan"),
            image_url=body.image_url.strip() if body.image_url else None,
            image_urls=body.image_urls,
            payload=precision_payload,
        )
        await asyncio.to_thread(
            update_precision_session_sync,
            current_session_id,
            {
                "status": "collecting",
                "current_task_id": precision_task["id"],
            },
        )
        return {
            "task_id": precision_task["id"],
            "message": "精准模式任务已提交，系统将先判断是否需要补充信息或拆分估计",
        }

    _debug_log_food_submit(
        "image_submit_request",
        {
            "user_id": user_info["user_id"],
            "task_type": _get_food_task_type("food"),
            "image_url": body.image_url,
            "image_urls": body.image_urls,
            "payload": payload,
        },
    )
    try:
        task = await asyncio.to_thread(
            create_analysis_task_sync,
            user_id=user_info["user_id"],
            task_type=_get_food_task_type("food"),
            image_url=body.image_url.strip() if body.image_url else None,
            image_urls=body.image_urls,
            payload=payload,
        )
        _debug_log_food_submit(
            "image_submit_created",
            {
                "task_id": task["id"],
                "task_type": task.get("task_type"),
                "image_url": task.get("image_url"),
                "image_paths": task.get("image_paths"),
                "payload": task.get("payload"),
            },
        )
        print(
            f"[food_analysis] MODERATION_SKIPPED_CONFIRMED task_id={task['id']} submit_type=image",
            flush=True,
        )
        return {"task_id": task["id"], "message": "任务已提交，可稍后在识别历史中查看结果"}
    except Exception as e:
        print(f"[analyze/submit] 错误: {e}")
        raise HTTPException(status_code=500, detail="提交任务失败")


@app.get("/api/analyze/tasks")
async def list_analyze_tasks(
    task_type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    user_info: dict = Depends(get_current_user_info),
):
    """查询当前用户的识别任务列表，支持按 task_type, status 筛选。"""
    try:
        tasks = await asyncio.to_thread(
            list_analysis_tasks_by_user_sync,
            user_id=user_info["user_id"],
            task_type=task_type,
            status=status,
            limit=limit,
        )
        return {"tasks": tasks}
    except Exception as e:
        print(f"[analyze/tasks] 错误: {e}")
        raise HTTPException(status_code=500, detail="查询任务列表失败")


@app.get("/api/analyze/tasks/{task_id}")
async def get_analyze_task(
    task_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """查询单条任务详情（仅能查看本人任务）。"""
    task = await asyncio.to_thread(get_analysis_task_by_id_sync, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.get("user_id") != user_info["user_id"]:
        raise HTTPException(status_code=403, detail="无权查看该任务")
    return task


class UpdateAnalysisResultRequest(BaseModel):
    """更新分析结果请求（用于修正食物名称等）"""
    result: Dict[str, Any] = Field(..., description="新的分析结果 JSON（完整覆盖）")


@app.patch("/api/analyze/tasks/{task_id}/result")
async def update_task_result(
    task_id: str,
    body: UpdateAnalysisResultRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    更新指定分析任务的 result 字段。
    主要用于用户在结果页手动修改食物名称后，同步更新后端记录（task.result）。
    """
    try:
        # 先确认任务存在且属于当前用户
        task = await asyncio.to_thread(get_analysis_task_by_id_sync, task_id)
        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")
        if task["user_id"] != user_info["user_id"]:
            raise HTTPException(status_code=403, detail="无权操作此任务")

        updated = await update_analysis_task_result(task_id, body.result)
        return {
            "message": "更新成功",
            "task": {
                **updated,
                "created_at": updated["created_at"].replace("+00:00", "Z"),
                "updated_at": updated["updated_at"].replace("+00:00", "Z")
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[update_task_result] 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/analyze/tasks/{task_id}")
async def delete_analyze_task(
    task_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """
    删除指定的分析任务。
    支持删除任何状态的任务，包括进行中的任务(pending/processing)。
    对于进行中的任务，会先标记为 cancelled 状态，清理关联资源后删除。
    """
    from database import delete_analysis_task_sync
    try:
        result = await asyncio.to_thread(delete_analysis_task_sync, task_id, user_info["user_id"], cancel_processing=True)
        return {
            "message": result.get("message", "删除成功"),
            "deleted": result.get("deleted", True),
            "cancelled": result.get("cancelled", False),
            "images_deleted": result.get("images_deleted", 0)
        }
    except Exception as e:
        error_msg = str(e)
        if "任务不存在" in error_msg or "无权限" in error_msg:
            raise HTTPException(status_code=404, detail=error_msg)
        print(f"[delete_analyze_task] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"删除失败: {error_msg}")


@app.post("/api/analyze/tasks/cleanup-timeout")
async def cleanup_timed_out_tasks(
    admin_key: str = Query(..., description="管理密钥"),
    timeout_minutes: int = Query(default=5, ge=1, le=30, description="超时时间（分钟）"),
):
    """
    清理超时的分析任务（内部管理接口）。
    将由定时任务或外部调度器调用。
    """
    from database import mark_timed_out_tasks_sync
    expected_key = os.getenv("ADMIN_API_KEY", "")
    if not expected_key or admin_key != expected_key:
        raise HTTPException(status_code=403, detail="无权限")
    
    try:
        count = await asyncio.to_thread(mark_timed_out_tasks_sync, timeout_minutes)
        return {"message": f"已标记 {count} 个超时任务", "count": count}
    except Exception as e:
        print(f"[cleanup_timed_out_tasks] 错误: {e}")
        raise HTTPException(status_code=500, detail="清理失败")


# ---------- 双模型对比分析接口 ----------

@app.post("/api/analyze-compare", response_model=CompareAnalyzeResponse)
async def analyze_food_compare(
    request: AnalyzeRequest,
    user_info: Optional[dict] = Depends(get_optional_user_info),
):
    """
    双模型对比分析：同时使用千问和 Gemini 模型分析同一张食物图片，返回两个模型的结果供对比。
    
    - 千问模型 (qwen-vl-max): 通过 DashScope API 调用
    - Gemini 模型: 通过 OfoxAI 的 OpenAI 兼容接口调用
    
    前端可以展示两个结果，让用户选择保存哪个。
    """
    if not request.base64Image and not request.image_url:
        raise HTTPException(status_code=400, detail="请提供 base64Image 或 image_url 之一")
    requested_mode = _parse_execution_mode_or_raise(request.execution_mode) if request.execution_mode is not None else None
    
    # 获取 API Key
    dashscope_api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    ofoxai_api_key = os.getenv("OFOXAI_API_KEY") or os.getenv("ofox_ai_apikey")
    
    # 构建提示词参数
    goal_hint = ""
    if request.user_goal:
        goal_map = {"muscle_gain": "增肌", "fat_loss": "减脂", "maintain": "维持体重"}
        goal_hint = f"\n用户目标为「{goal_map.get(request.user_goal, request.user_goal)}」，请在 pfc_ratio_comment 中评价本餐 P/C/F 占比是否适合该目标。"
    
    state_hint = ""
    state_parts: List[str] = []
    if request.diet_goal or request.activity_timing:
        diet_map = {"fat_loss": "减脂期", "muscle_gain": "增肌期", "maintain": "维持体重", "none": "无特殊目标"}
        activity_map = {"post_workout": "练后", "daily": "日常", "before_sleep": "睡前", "none": "无特殊"}
        diet_text = diet_map.get(request.diet_goal, request.diet_goal) if request.diet_goal and request.diet_goal != "none" else ""
        activity_text = activity_map.get(request.activity_timing, request.activity_timing) if request.activity_timing and request.activity_timing != "none" else ""
        state_parts = [s for s in [diet_text, activity_text] if s]
        if state_parts:
            state_hint = f"\n用户当前状态: {' + '.join(state_parts)}，请在 context_advice 中给出针对性进食建议（如补剂、搭配）。"

    
    remain_hint = f"\n用户当日剩余热量预算约 {request.remaining_calories} kcal，可在 context_advice 中提示本餐占比或下一餐建议。" if request.remaining_calories is not None else ""
    
    meal_hint = ""
    meal_name = ""
    if request.meal_type:
        meal_name = _meal_name(request.meal_type, timezone_offset_minutes=request.timezone_offset_minutes)
        meal_hint = f"\n用户选择的是「{meal_name}」，请结合餐次特点在 insight 或 context_advice 中给出建议（如早餐适合碳水与蛋白搭配、晚餐宜清淡等）。"
    
    # 若已登录，拉取健康档案
    profile_block = ""
    compact_tags_list: List[str] = []
    if request.meal_type:
        compact_tags_list.append(f"餐次:{meal_name}")
    if state_parts:
        compact_tags_list.append("状态:" + "/".join(state_parts))
    if request.remaining_calories is not None:
        compact_tags_list.append(f"剩余:{float(request.remaining_calories):g}kcal")
    user = None
    execution_mode = requested_mode
    if user_info:
        user = await get_user_by_id(user_info["user_id"])
        execution_mode = requested_mode or _normalize_execution_mode((user or {}).get("execution_mode"))
        if user:
            if execution_mode == "strict":
                profile_block = _format_health_profile_for_analysis(user)
                if profile_block:
                    profile_block = (
                        "\n\n若以下存在「用户健康档案」，请结合档案在 insight、absorption_notes、context_advice 中给出更贴合该用户体质与健康状况的建议（如控糖、低嘌呤、过敏规避等）。\n\n"
                        + profile_block
                    )
            else:
                profile_summary = _format_health_risk_summary_for_analysis(user)
                if profile_summary:
                    compact_tags_list.append(profile_summary)
    if execution_mode is None:
        execution_mode = _normalize_execution_mode(None)
    mode_hint = _build_execution_mode_hint(execution_mode)
    compact_tags = ("\n".join(compact_tags_list) + "\n") if compact_tags_list else ""
    
    # 构建通用提示词
    prompt = _build_gemini_prompt(
        additional_context=request.additionalContext or "",
        goal_hint=goal_hint,
        state_hint=state_hint,
        remain_hint=remain_hint,
        meal_hint=meal_hint,
        profile_block=profile_block,
        compact_tags=compact_tags,
        mode_hint=mode_hint,
        execution_mode=execution_mode,
    )
    
    # 准备图片 URL
    if request.image_url:
        image_url_for_api = request.image_url
        base64_for_gemini = None
    else:
        image_data = (
            request.base64Image.split(",")[1]
            if "," in request.base64Image
            else request.base64Image
        )
        image_url_for_api = f"data:image/jpeg;base64,{image_data}"
        base64_for_gemini = request.base64Image
    
    # 并行调用两个模型
    qwen_result = ModelAnalyzeResult(model_name="qwen-vl-max", success=False)
    gemini_result = ModelAnalyzeResult(model_name=GEMINI_MODEL_NAME, success=False)
    
    async def call_qwen():
        nonlocal qwen_result
        try:
            if not dashscope_api_key:
                raise Exception("缺少 DASHSCOPE_API_KEY 环境变量")
            
            base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
            parsed = await _analyze_with_qwen(request, prompt, image_url_for_api, dashscope_api_key, base_url)
            items, desc, insight, pfc, absorption, context = _parse_analyze_result(parsed)
            
            pfc, absorption = _strip_standard_mode_extras(execution_mode, pfc, absorption)
            qwen_result = ModelAnalyzeResult(
                model_name="qwen-vl-max",
                success=True,
                description=desc,
                insight=insight,
                items=items,
                pfc_ratio_comment=pfc,
                absorption_notes=absorption,
                context_advice=context,
            )
        except Exception as e:
            print(f"[analyze-compare] 千问分析失败: {e}")
            qwen_result = ModelAnalyzeResult(
                model_name="qwen-vl-max",
                success=False,
                error=str(e),
            )
    
    async def call_gemini():
        nonlocal gemini_result
        try:
            if not ofoxai_api_key or ofoxai_api_key == "your_ofoxai_api_key_here":
                raise Exception("请在 .env 中配置有效的 OFOXAI_API_KEY")
            
            parsed = await _analyze_with_gemini(
                image_url=request.image_url,
                base64_image=base64_for_gemini,
                image_mime_type="image/jpeg",
                prompt=prompt,
                model_name=GEMINI_MODEL_NAME,
            )
            items, desc, insight, pfc, absorption, context = _parse_analyze_result(parsed)
            
            gemini_result = ModelAnalyzeResult(
                model_name=GEMINI_MODEL_NAME,
                success=True,
                description=desc,
                insight=insight,
                items=items,
                pfc_ratio_comment=pfc,
                absorption_notes=absorption,
                context_advice=context,
            )
        except Exception as e:
            print(f"[analyze-compare] Gemini (OfoxAI) 分析失败: {e}")
            gemini_result = ModelAnalyzeResult(
                model_name=GEMINI_MODEL_NAME,
                success=False,
                error=str(e),
            )
    
    # 并行执行两个模型的分析
    await asyncio.gather(call_qwen(), call_gemini())
    
    return CompareAnalyzeResponse(
        qwen_result=qwen_result,
        gemini_result=gemini_result,
    )


class AnalyzeTextRequest(BaseModel):
    """文字描述食物，请求营养成分分析"""
    text: str = Field(..., description="用户描述的食物内容，如：一碗米饭、一个苹果、200g 鸡胸肉")
    user_goal: Optional[str] = Field(default=None, description="用户目标: muscle_gain / fat_loss / maintain")
    remaining_calories: Optional[float] = Field(default=None, description="当日剩余热量预算 kcal")
    diet_goal: Optional[str] = Field(default=None, description="饮食目标: fat_loss / muscle_gain / maintain / none")
    activity_timing: Optional[str] = Field(default=None, description="运动时机: post_workout / daily / before_sleep / none")


@app.post("/api/analyze-text", response_model=AnalyzeResponse)
async def analyze_food_text(
    request: AnalyzeTextRequest,
    user_info: Optional[dict] = Depends(get_optional_user_info),
):
    """
    根据用户文字描述分析食物营养成分，使用 DashScope 千问 qwen-plus。返回与 /api/analyze 相同结构。
    """
    try:
        dashscope_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
        if not dashscope_key:
            raise HTTPException(status_code=500, detail="缺少 DASHSCOPE_API_KEY 环境变量")
        if not (request.text or request.text.strip()):
            raise HTTPException(status_code=400, detail="text 不能为空")

        goal_hint = ""
        if request.user_goal:
            goal_map = {"muscle_gain": "增肌", "fat_loss": "减脂", "maintain": "维持体重"}
            goal_hint = f" 用户目标为「{goal_map.get(request.user_goal, request.user_goal)}」，请在 pfc_ratio_comment 中评价 P/C/F 占比是否适合。"
        state_hint = ""
        if request.diet_goal or request.activity_timing:
            diet_map = {"fat_loss": "减脂期", "muscle_gain": "增肌期", "maintain": "维持体重", "none": "无特殊目标"}
            activity_map = {"post_workout": "练后", "daily": "日常", "before_sleep": "睡前", "none": "无特殊"}
            diet_text = diet_map.get(request.diet_goal, request.diet_goal) if request.diet_goal and request.diet_goal != "none" else ""
            activity_text = activity_map.get(request.activity_timing, request.activity_timing) if request.activity_timing and request.activity_timing != "none" else ""
            state_parts = [s for s in [diet_text, activity_text] if s]
            if state_parts:
                state_hint = f" 用户当前状态: {' + '.join(state_parts)}，请在 context_advice 中给出针对性建议。"
        remain_hint = f" 当日剩余热量预算约 {request.remaining_calories} kcal，可在 context_advice 中提示。" if request.remaining_calories is not None else ""
        profile_block = ""
        execution_mode = _normalize_execution_mode(None)
        if user_info:
            user = await get_user_by_id(user_info["user_id"])
            membership = await _get_effective_membership(user_info["user_id"])
            membership_resp = _format_membership_response(membership)
            execution_mode = _normalize_execution_mode((user or {}).get("execution_mode"))
            _, _, _, execution_mode = await _validate_food_analysis_access(
                user_id=user_info["user_id"],
                effective_mode=execution_mode,
                strict_requested=False,
                user_row=user,
                membership=membership,
                membership_resp=membership_resp,
            )
            if user:
                profile_block = _format_health_profile_for_analysis(user)
                if profile_block:
                    profile_fields = "insight、absorption_notes、context_advice" if execution_mode == "strict" else "insight、context_advice"
                    profile_block = f" 若以下存在「用户健康档案」，请结合档案在 {profile_fields} 中给出更贴合该用户体质与健康状况的建议。\n\n" + profile_block

        prompt = f"""
请作为专业营养师，根据用户对食物的**文字描述**，分析营养成分。
用户描述内容：
"{request.text.strip()}"

请完成：
1. 从描述中识别出所有食物单品（若有多项请分别列出）。
2. 估算每种食物的重量（克）和详细营养成分（热量、蛋白质、碳水、脂肪、纤维、糖分）。
3. description: 用一句简短中文概括这餐/这些食物。
4. insight: 用一句话给出健康建议。
5. pfc_ratio_comment: 本餐 P/F/C 占比的简要评价（是否均衡、适合增肌/减脂/维持）。{goal_hint}
6. absorption_notes: 食物组合或烹饪对吸收率、生物利用度的简要说明（一两句话）。
7. context_advice: 结合用户状态或剩余热量的情境建议（若无则空字符串）。{state_hint}{remain_hint}{profile_block}

重要：请务必使用**简体中文**返回所有文本。请**严格按照**以下 JSON 格式返回，不要包含任何其他文字：

{{"items": [{{"name": "食物名称（简体中文）", "estimatedWeightGrams": 重量数字, "nutrients": {{"calories", "protein", "carbs", "fat", "fiber", "sugar"}}], "description": "餐食描述", "insight": "健康建议", "pfc_ratio_comment": "PFC 比例评价", "absorption_notes": "吸收率说明", "context_advice": "情境建议"}}
""".strip()

        # 使用 DashScope 千问 qwen-plus 进行文本分析
        base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
        api_url = f"{base_url}/chat/completions"
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                api_url,
                headers={
                    "Authorization": f"Bearer {dashscope_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "qwen-plus",
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.5,
                },
            )
            if not response.is_success:
                error_data = response.json() if response.content else {}
                raise Exception(error_data.get("error", {}).get("message") or f"DashScope API 错误: {response.status_code}")
            data = response.json()
            content_str = data.get("choices", [{}])[0].get("message", {}).get("content")
            if not content_str:
                raise Exception("千问返回了空响应")
            json_str = re.sub(r"```json", "", content_str)
            json_str = re.sub(r"```", "", json_str).strip()
            parsed = json.loads(json_str)

        valid_items = []
        if isinstance(parsed.get("items"), list):
            for item in parsed["items"]:
                n = item.get("nutrients") or {}
                weight = float(item.get("estimatedWeightGrams", 0) or 0)
                valid_items.append(
                    FoodItemResponse(
                        name=str(item.get("name", "未知食物")),
                        estimatedWeightGrams=weight,
                        originalWeightGrams=weight,
                        nutrients=Nutrients(
                            calories=float(n.get("calories", 0) or 0),
                            protein=float(n.get("protein", 0) or 0),
                            carbs=float(n.get("carbs", 0) or 0),
                            fat=float(n.get("fat", 0) or 0),
                            fiber=float(n.get("fiber", 0) or 0),
                            sugar=float(n.get("sugar", 0) or 0),
                        ),
                    )
                )

        def _opt_str(v):
            if v is None or v == "":
                return None
            s = str(v).strip()
            return s if s else None

        pfc_ratio_comment, absorption_notes = _strip_standard_mode_extras(
            execution_mode,
            _opt_str(parsed.get("pfc_ratio_comment")),
            _opt_str(parsed.get("absorption_notes")),
        )

        return AnalyzeResponse(
            description=str(parsed.get("description", "无法获取描述")),
            insight=str(parsed.get("insight", "保持健康饮食！")),
            items=valid_items,
            pfc_ratio_comment=pfc_ratio_comment,
            absorption_notes=absorption_notes,
            context_advice=_opt_str(parsed.get("context_advice")),
            recognitionOutcome=_opt_str(parsed.get("recognitionOutcome")),
            rejectionReason=_opt_str(parsed.get("rejectionReason")),
            retakeGuidance=parsed.get("retakeGuidance") if isinstance(parsed.get("retakeGuidance"), list) else None,
            allowedFoodCategory=_opt_str(parsed.get("allowedFoodCategory")),
            followupQuestions=parsed.get("followupQuestions") if isinstance(parsed.get("followupQuestions"), list) else None,
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/analyze-text] error: {e}")
        raise HTTPException(status_code=500, detail=str(e) or "连接 AI 服务失败")


class AnalyzeTextSubmitRequest(BaseModel):
    """提交文字分析任务：立即返回 task_id，结果由 Worker 写回后可从 /api/analyze/tasks 查询"""
    text: str = Field(..., description="用户描述的食物内容")
    meal_type: Optional[str] = Field(default=None, description=MEAL_TYPE_DESCRIPTION)
    timezone_offset_minutes: Optional[int] = Field(default=None, description="客户端时区偏移（JS getTimezoneOffset，单位分钟）")
    province: Optional[str] = Field(default=None, description="省份/直辖市")
    city: Optional[str] = Field(default=None, description="城市")
    district: Optional[str] = Field(default=None, description="区县")
    diet_goal: Optional[str] = Field(default=None, description="饮食目标: fat_loss / muscle_gain / maintain / none")
    activity_timing: Optional[str] = Field(default=None, description="运动时机: post_workout / daily / before_sleep / none")
    user_goal: Optional[str] = Field(default=None, description="用户目标: muscle_gain / fat_loss / maintain")
    remaining_calories: Optional[float] = Field(default=None, description="当日剩余热量预算 kcal")
    additionalContext: Optional[str] = Field(default=None, description="用户补充上下文或纠错说明")
    execution_mode: Optional[str] = Field(default=None, description="执行模式: standard / strict")
    previousResult: Optional[Dict[str, Any]] = Field(default=None, description="上一轮分析结果")
    correctionItems: Optional[List[Dict[str, Any]]] = Field(default=None, description="本轮结构化纠错清单")
    precision_session_id: Optional[str] = Field(default=None, description="精准模式会话 ID（继续多轮交互时传入）")
    reference_objects: Optional[List[PrecisionReferenceObjectInput]] = Field(default=None, description="参考物列表")


class ContinuePrecisionSessionRequest(BaseModel):
    source_type: str = Field(..., description="image / text")
    image_url: Optional[str] = Field(None, description="新的主图 URL")
    image_urls: Optional[List[str]] = Field(None, description="新的图片 URL 列表")
    text: Optional[str] = Field(None, description="补充文字或新的文字记录")
    additionalContext: Optional[str] = Field(default=None, description="本轮补充说明")
    meal_type: Optional[str] = Field(default=None, description=MEAL_TYPE_DESCRIPTION)
    timezone_offset_minutes: Optional[int] = Field(default=None, description="客户端时区偏移（JS getTimezoneOffset，单位分钟）")
    province: Optional[str] = Field(default=None, description="省份/直辖市")
    city: Optional[str] = Field(default=None, description="城市")
    district: Optional[str] = Field(default=None, description="区县")
    diet_goal: Optional[str] = Field(default=None, description="饮食目标")
    activity_timing: Optional[str] = Field(default=None, description="运动时机")
    user_goal: Optional[str] = Field(default=None, description="用户目标")
    remaining_calories: Optional[float] = Field(default=None, description="当日剩余热量预算")
    is_multi_view: Optional[bool] = Field(default=False, description="是否多视角")
    reference_objects: Optional[List[PrecisionReferenceObjectInput]] = Field(default=None, description="参考物列表")


@app.post("/api/analyze-text/submit")
async def analyze_text_submit(
    body: AnalyzeTextSubmitRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    提交文字分析任务（异步）。立即返回 task_id，Worker 子进程会在后台执行分析，
    完成后可通过 GET /api/analyze/tasks/{task_id} 或列表接口查看结果。
    """
    if not body.text or not body.text.strip():
        raise HTTPException(status_code=400, detail="text 不能为空")

    requested_mode = _parse_execution_mode_or_raise(body.execution_mode) if body.execution_mode is not None else None
    user = await get_user_by_id(user_info["user_id"])
    profile_mode = _normalize_execution_mode((user or {}).get("execution_mode"))
    effective_mode = requested_mode or profile_mode
    membership = await _get_effective_membership(user_info["user_id"])
    membership_resp = _format_membership_response(membership)
    _, _, _, effective_mode = await _validate_food_analysis_access(
        user_id=user_info["user_id"],
        effective_mode=effective_mode,
        strict_requested=(requested_mode == "strict" or bool(body.precision_session_id)),
        user_row=user,
        membership=membership,
        membership_resp=membership_resp,
    )

    payload = {
        "meal_type": body.meal_type,
        "timezone_offset_minutes": body.timezone_offset_minutes,
        "province": body.province,
        "city": body.city,
        "district": body.district,
        "diet_goal": body.diet_goal,
        "activity_timing": body.activity_timing,
        "user_goal": body.user_goal,
        "remaining_calories": body.remaining_calories,
        "additionalContext": body.additionalContext,
        "execution_mode": effective_mode,
        "previousResult": body.previousResult,
        "correctionItems": body.correctionItems,
        "reference_objects": _serialize_reference_objects(body.reference_objects),
    }

    if effective_mode == "strict" or body.precision_session_id:
        session = None
        source_type = "text"
        if body.precision_session_id:
            session = await asyncio.to_thread(get_precision_session_by_id_sync, body.precision_session_id)
            if not session:
                raise HTTPException(status_code=404, detail="精准模式会话不存在")
            if session.get("user_id") != user_info["user_id"]:
                raise HTTPException(status_code=403, detail="无权继续该精准模式会话")
            if session.get("source_type") != source_type:
                raise HTTPException(status_code=400, detail="精准模式会话类型与当前提交不一致")
            if session.get("status") not in PRECISION_SESSION_ACTIVE_STATUSES:
                raise HTTPException(status_code=400, detail="该精准模式会话已结束，无法继续")

        latest_inputs = {
            **_build_precision_continue_payload(
                source_type=source_type,
                meal_type=body.meal_type,
                timezone_offset_minutes=body.timezone_offset_minutes,
                province=body.province,
                city=body.city,
                district=body.district,
                diet_goal=body.diet_goal,
                activity_timing=body.activity_timing,
                user_goal=body.user_goal,
                remaining_calories=body.remaining_calories,
                additional_context=body.additionalContext,
                is_multi_view=False,
                reference_objects=payload["reference_objects"],
            ),
            "text": body.text.strip(),
        }

        if session:
            next_round_index = int(session.get("round_index") or 1) + 1
            await asyncio.to_thread(
                update_precision_session_sync,
                session["id"],
                {
                    "status": "collecting",
                    "round_index": next_round_index,
                    "latest_inputs": latest_inputs,
                    "reference_objects": payload["reference_objects"] or (session.get("reference_objects") or []),
                    "last_error": None,
                },
            )
            await asyncio.to_thread(
                create_precision_session_round_sync,
                session["id"],
                next_round_index,
                "user",
                latest_inputs,
                None,
            )
            current_session_id = session["id"]
            current_round_index = next_round_index
        else:
            session = await asyncio.to_thread(
                create_precision_session_sync,
                user_info["user_id"],
                source_type,
                "strict",
                latest_inputs,
                payload["reference_objects"],
            )
            await asyncio.to_thread(
                create_precision_session_round_sync,
                session["id"],
                int(session.get("round_index") or 1),
                "user",
                latest_inputs,
                None,
            )
            current_session_id = session["id"]
            current_round_index = int(session.get("round_index") or 1)

        precision_payload = _create_precision_plan_task_payload(
            current_session_id,
            source_type,
            {
                **payload,
                "round_index": current_round_index,
            },
        )
        precision_task = await asyncio.to_thread(
            create_analysis_task_sync,
            user_id=user_info["user_id"],
            task_type=_get_food_task_type("precision_plan"),
            text_input=body.text.strip(),
            payload=precision_payload,
        )
        await asyncio.to_thread(
            update_precision_session_sync,
            current_session_id,
            {
                "status": "collecting",
                "current_task_id": precision_task["id"],
            },
        )
        return {
            "task_id": precision_task["id"],
            "message": "精准模式任务已提交，系统将先判断是否需要补充信息或拆分估计",
        }

    _debug_log_food_submit(
        "text_submit_request",
        {
            "user_id": user_info["user_id"],
            "task_type": _get_food_task_type("food_text"),
            "text": body.text,
            "payload": payload,
        },
    )

    try:
        task = await asyncio.to_thread(
            create_analysis_task_sync,
            user_id=user_info["user_id"],
            task_type=_get_food_task_type("food_text"),
            text_input=body.text.strip(),
            payload=payload,
        )
        _debug_log_food_submit(
            "text_submit_created",
            {
                "task_id": task["id"],
                "task_type": task.get("task_type"),
                "text_input": task.get("text_input"),
                "payload": task.get("payload"),
            },
        )
        print(
            f"[food_analysis] MODERATION_SKIPPED_CONFIRMED task_id={task['id']} submit_type=text",
            flush=True,
        )
        return {"task_id": task["id"], "message": "任务已提交，可稍后在识别历史中查看结果"}
    except Exception as e:
        print(f"[analyze-text/submit] 错误: {e}")
        raise HTTPException(status_code=500, detail="提交任务失败")


@app.post("/api/precision-sessions/{session_id}/continue")
async def continue_precision_session(
    session_id: str,
    body: ContinuePrecisionSessionRequest,
    user_info: dict = Depends(get_current_user_info),
):
    source_type = str(body.source_type or "").strip().lower()
    if source_type not in PRECISION_SOURCE_TYPES:
        raise HTTPException(status_code=400, detail="source_type 必须为 image 或 text")

    session = await asyncio.to_thread(get_precision_session_by_id_sync, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="精准模式会话不存在")
    if session.get("user_id") != user_info["user_id"]:
        raise HTTPException(status_code=403, detail="无权继续该精准模式会话")
    if session.get("source_type") != source_type:
        raise HTTPException(status_code=400, detail="精准模式会话类型与当前提交不一致")
    if session.get("status") not in PRECISION_SESSION_ACTIVE_STATUSES:
        raise HTTPException(status_code=400, detail="该精准模式会话已结束，无法继续")

    user = await get_user_by_id(user_info["user_id"])
    membership = await _get_effective_membership(user_info["user_id"])
    membership_resp = _format_membership_response(membership)
    await _validate_food_analysis_access(
        user_id=user_info["user_id"],
        effective_mode="strict",
        strict_requested=True,
        user_row=user,
        membership=membership,
        membership_resp=membership_resp,
    )

    reference_objects = _serialize_reference_objects(body.reference_objects)
    latest_inputs = {
        **_build_precision_continue_payload(
            source_type=source_type,
            meal_type=body.meal_type,
            timezone_offset_minutes=body.timezone_offset_minutes,
            province=body.province,
            city=body.city,
            district=body.district,
            diet_goal=body.diet_goal,
            activity_timing=body.activity_timing,
            user_goal=body.user_goal,
            remaining_calories=body.remaining_calories,
            additional_context=body.additionalContext,
            is_multi_view=body.is_multi_view,
            reference_objects=reference_objects,
        ),
    }
    task_kwargs: Dict[str, Any] = {
        "user_id": user_info["user_id"],
        "task_type": _get_food_task_type("precision_plan"),
        "payload": _create_precision_plan_task_payload(
            session_id,
            source_type,
            {
                "meal_type": body.meal_type,
                "timezone_offset_minutes": body.timezone_offset_minutes,
                "diet_goal": body.diet_goal,
                "activity_timing": body.activity_timing,
                "user_goal": body.user_goal,
                "remaining_calories": body.remaining_calories,
                "additionalContext": body.additionalContext,
                "execution_mode": "strict",
                "is_multi_view": body.is_multi_view,
                "reference_objects": reference_objects,
                "round_index": int(session.get("round_index") or 1) + 1,
            },
        ),
    }
    if source_type == "image":
        if body.image_urls and len(body.image_urls) > 1 and not body.is_multi_view:
            raise HTTPException(status_code=400, detail="上传多张图片前请先开启多视角模式")
        if body.image_url:
            task_kwargs["image_url"] = body.image_url.strip()
            latest_inputs["image_url"] = body.image_url.strip()
        if body.image_urls:
            task_kwargs["image_urls"] = body.image_urls
            latest_inputs["image_urls"] = body.image_urls
        if not latest_inputs.get("image_url") and not latest_inputs.get("image_urls") and not body.additionalContext and not reference_objects:
            raise HTTPException(status_code=400, detail="请至少补充说明、参考物或新的图片")
    else:
        text_value = str(body.text or "").strip()
        if text_value:
            latest_inputs["text"] = text_value
            task_kwargs["text_input"] = text_value
        elif not body.additionalContext and not reference_objects:
            raise HTTPException(status_code=400, detail="请至少补充说明、参考物或新的文字描述")

    next_round_index = int(session.get("round_index") or 1) + 1
    await asyncio.to_thread(
        update_precision_session_sync,
        session_id,
        {
            "status": "collecting",
            "round_index": next_round_index,
            "latest_inputs": latest_inputs,
            "reference_objects": reference_objects or (session.get("reference_objects") or []),
            "last_error": None,
        },
    )
    await asyncio.to_thread(
        create_precision_session_round_sync,
        session_id,
        next_round_index,
        "user",
        latest_inputs,
        None,
    )
    try:
        task = await asyncio.to_thread(create_analysis_task_sync, **task_kwargs)
        await asyncio.to_thread(
            update_precision_session_sync,
            session_id,
            {
                "status": "collecting",
                "current_task_id": task["id"],
            },
        )
        return {"task_id": task["id"], "message": "精准模式已继续，系统正在重新规划本轮估计"}
    except Exception as e:
        print(f"[precision/continue] 错误: {e}")
        raise HTTPException(status_code=500, detail="继续精准模式失败")


@app.get("/api")
async def root():
    """健康检查端点"""
    return {"message": "食物分析 API 服务运行中", "status": "ok"}


@app.get("/api/health")
async def health():
    """健康检查端点"""
    return {"status": "healthy"}


# ---------- 天地图地名搜索代理 ----------

class LocationSearchRequest(BaseModel):
    """天地图地名搜索请求"""
    keyWord: str = Field(..., description="搜索关键字")
    count: int = Field(default=10, description="返回结果数量")
    lon: Optional[float] = Field(None, description="中心点经度（可选，用于周边搜索）")
    lat: Optional[float] = Field(None, description="中心点纬度（可选，用于周边搜索）")
    radius_km: Optional[float] = Field(3.0, description="周边搜索半径（公里），仅在传 lon/lat 时生效")


@app.post("/api/location/search")
async def location_search(body: LocationSearchRequest):
    """
    代理天地图地名搜索 API（避免小程序直连域名限制）
    """
    tk = os.getenv("TIANDITU_TK", "")
    if not tk:
        raise HTTPException(status_code=500, detail="后端未配置天地图 API Key")

    # 若传入中心点，则构造一个近似矩形范围（mapBound）
    # 天地图 v2/search 使用经纬度边界字符串：minLon,minLat,maxLon,maxLat
    map_bound = "73.44696044921875,3.408477306060791,135.08583068847656,53.557926071870545"
    try:
        if body.lon is not None and body.lat is not None:
            r_km = float(body.radius_km or 3.0)
            r_km = max(0.2, min(r_km, 20.0))
            lat = float(body.lat)
            lon = float(body.lon)
            # 1°纬度约 111km；经度缩放与纬度相关
            d_lat = r_km / 111.0
            cos_lat = math.cos(math.radians(lat))
            d_lon = r_km / (111.0 * (cos_lat if abs(cos_lat) > 1e-6 else 1e-6))
            min_lon = max(-180.0, lon - d_lon)
            max_lon = min(180.0, lon + d_lon)
            min_lat = max(-90.0, lat - d_lat)
            max_lat = min(90.0, lat + d_lat)
            map_bound = f"{min_lon},{min_lat},{max_lon},{max_lat}"
    except Exception as e:
        print(f"[location_search] mapBound 计算失败，回退全国范围: {e}")

    post_str = json.dumps({
        "keyWord": body.keyWord,
        "level": 12,
        "mapBound": map_bound,
        "queryType": 1,
        "start": 0,
        "count": body.count
    })

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://api.tianditu.gov.cn/v2/search",
                params={"postStr": post_str, "type": "query", "tk": tk}
            )
            data = resp.json()
            return data
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="天地图 API 请求超时")
    except Exception as e:
        print(f"[location_search] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"位置搜索失败: {str(e)}")


class LocationReverseRequest(BaseModel):
    """逆地理编码请求（经纬度 -> 地址）"""
    lat: float = Field(..., description="纬度")
    lon: float = Field(..., description="经度")


@app.post("/api/location/reverse")
async def location_reverse(body: LocationReverseRequest):
    """代理天地图逆地理编码，将经纬度转为地址描述"""
    tk = os.getenv("TIANDITU_TK", "")
    if not tk:
        raise HTTPException(status_code=500, detail="后端未配置天地图 API Key")
    post_str = json.dumps({"lon": body.lon, "lat": body.lat})
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://api.tianditu.gov.cn/geocoder",
                params={"postStr": post_str, "type": "geocode", "tk": tk}
            )
            data = resp.json()
            # 返回格式与天地图一致，便于前端直接使用
            return data
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="逆地理请求超时")
    except Exception as e:
        print(f"[location_reverse] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"逆地理失败: {str(e)}")


# ---------- 地图选点页（天地图，供小程序 web-view 嵌入） ----------
MAP_PICKER_HTML = """<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
  <title>选择位置</title>
  <script src="https://api.tianditu.gov.cn/api?v=4.0&tk=__TIANDITU_TK__" type="text/javascript"></script>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    #mapDiv { width: 100%; height: 42vh; min-height: 200px; }
    .panel { padding: 12px; background: #fff; border-top: 1px solid #eee; }
    .search-row { display: flex; gap: 8px; margin-bottom: 10px; }
    .search-row input { flex: 1; height: 40px; padding: 0 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; }
    .search-row button { height: 40px; padding: 0 16px; background: #00bc7d; color: #fff; border: none; border-radius: 8px; font-size: 14px; }
    .selected-hint { font-size: 12px; color: #666; margin-bottom: 8px; min-height: 18px; }
    .result-list { max-height: 28vh; overflow-y: auto; }
    .result-item { padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
    .result-item:active { background: #f5f5f5; }
    .result-name { font-weight: 600; font-size: 14px; color: #111; }
    .result-address { font-size: 12px; color: #666; margin-top: 4px; }
    .btn-use { width: 100%; height: 44px; margin-top: 12px; background: #00bc7d; color: #fff; border: none; border-radius: 8px; font-size: 16px; }
  </style>
</head>
<body>
  <div id="mapDiv"></div>
  <div class="panel">
    <div class="search-row">
      <input type="text" id="keyword" placeholder="输入商家名/地名搜索" />
      <button type="button" id="btnSearch">搜索</button>
    </div>
    <div class="selected-hint" id="selectedHint">点击地图选点，或从搜索结果选择</div>
    <div class="result-list" id="resultList"></div>
    <button type="button" class="btn-use" id="btnUse">使用该位置</button>
  </div>
  <script>
    (function() {
      var tk = "__TIANDITU_TK__";
      var map = new T.Map("mapDiv");
      map.centerAndZoom(new T.LngLat(116.40769, 39.89945), 12);
      var marker = null;
      var selected = { name: "", address: "", longitude: null, latitude: null, lonlat: "", promptCity: "" };

      function removeMarker() {
        if (marker) { map.removeOverlay(marker); marker = null; }
      }
      function addMarker(lng, lat) {
        removeMarker();
        var pt = new T.LngLat(lng, lat);
        marker = new T.Marker(pt);
        map.addOverlay(marker);
      }
      function setSelected(obj) {
        selected = obj;
        var h = document.getElementById("selectedHint");
        if (selected.address || selected.name)
          h.textContent = (selected.name || "位置") + " " + (selected.address || "");
        else if (selected.longitude != null)
          h.textContent = "已选坐标: " + selected.latitude.toFixed(5) + ", " + selected.longitude.toFixed(5);
        else
          h.textContent = "点击地图选点，或从搜索结果选择";
      }
      function apiBase() {
        var u = window.location.origin;
        if (window.__API_BASE__) return window.__API_BASE__;
        return u;
      }
      map.addEventListener("click", function(e) {
        var lnglat = e.lnglat;
        var lng = lnglat.lng, lat = lnglat.lat;
        addMarker(lng, lat);
        selected = { name: "地图选点", address: "", longitude: lng, latitude: lat, lonlat: lng + "," + lat, promptCity: "" };
        var xhr = new XMLHttpRequest();
        xhr.open("POST", apiBase() + "/api/location/reverse");
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.onload = function() {
          if (xhr.status === 200) {
            try {
              var d = JSON.parse(xhr.responseText);
              var addr = (d.address || d.formatted_address || d.result || "").toString();
              if (addr) selected.address = addr;
            } catch (e) {}
          }
          setSelected(selected);
        };
        xhr.send(JSON.stringify({ lon: lng, lat: lat }));
        setSelected(selected);
      });

      document.getElementById("btnSearch").onclick = function() {
        var kw = (document.getElementById("keyword").value || "").trim();
        if (!kw) return;
        var center = map.getCenter();
        var lng = center ? center.lng : 116.4;
        var lat = center ? center.lat : 39.9;
        var xhr = new XMLHttpRequest();
        xhr.open("POST", apiBase() + "/api/location/search");
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.onload = function() {
          var listEl = document.getElementById("resultList");
          if (xhr.status !== 200) { listEl.innerHTML = "<div class=\"result-item\">搜索失败</div>"; return; }
          try {
            var data = JSON.parse(xhr.responseText);
            var pois = data.pois || [];
            var promptCity = (data.prompt && data.prompt[0] && data.prompt[0].admins && data.prompt[0].admins[0]) ? data.prompt[0].admins[0].adminName : "";
            listEl.innerHTML = "";
            pois.forEach(function(poi) {
              var name = poi.name || "";
              var address = poi.address || "";
              var lonlat = (poi.lonlat || "").split(",");
              var lng = lonlat.length >= 2 ? parseFloat(lonlat[0]) : 0;
              var lat = lonlat.length >= 2 ? parseFloat(lonlat[1]) : 0;
              var div = document.createElement("div");
              div.className = "result-item";
              div.innerHTML = "<div class=\"result-name\">" + (name || "未命名") + "</div><div class=\"result-address\">" + address + "</div>";
              div.onclick = function() {
                if (lng && lat) {
                  map.centerAndZoom(new T.LngLat(lng, lat), 16);
                  addMarker(lng, lat);
                }
                setSelected({ name: name, address: address, longitude: lng, latitude: lat, lonlat: poi.lonlat || (lng + "," + lat), promptCity: promptCity });
              };
              listEl.appendChild(div);
            });
            if (pois.length === 0) listEl.innerHTML = "<div class=\"result-item\">未找到相关位置</div>";
          } catch (e) {
            listEl.innerHTML = "<div class=\"result-item\">解析失败</div>";
          }
        };
        xhr.send(JSON.stringify({ keyWord: kw, count: 20, lon: lng, lat: lat, radius_km: 5 }));
      };

      document.getElementById("btnUse").onclick = function() {
        if (selected.longitude == null && selected.latitude == null) {
          alert("请先点击地图选点或从搜索结果选择位置");
          return;
        }
        var payload = {
          name: selected.name || "",
          address: selected.address || "",
          longitude: selected.longitude,
          latitude: selected.latitude,
          lonlat: selected.lonlat || (selected.longitude + "," + selected.latitude),
          promptCity: selected.promptCity || ""
        };
        if (typeof wx !== "undefined" && wx.miniProgram) {
          wx.miniProgram.postMessage({ data: payload });
          wx.miniProgram.navigateBack();
        } else {
          console.log("selected", payload);
          alert("仅在小程序内可回传位置");
        }
      };
    })();
  </script>
</body>
</html>
"""


@app.get("/map-picker", response_class=HTMLResponse)
async def map_picker():
    """返回天地图地图选点页面（供小程序 web-view 使用），进入即显示地图，可点击选点、模糊搜索后地图自动定位到结果"""
    tk = os.getenv("TIANDITU_TK", "")
    if not tk:
        raise HTTPException(status_code=503, detail="未配置天地图密钥，无法加载地图选点页")
    html = MAP_PICKER_HTML.replace("__TIANDITU_TK__", tk)
    return HTMLResponse(html)


class UpdateUserInfoRequest(BaseModel):
    nickname: Optional[str] = None
    avatar: Optional[str] = None
    telephone: Optional[str] = None
    searchable: Optional[bool] = None
    public_records: Optional[bool] = None


class BodyWeightUpsertRequest(BaseModel):
    value: float = Field(..., ge=20, le=300, description="体重 kg")
    date: Optional[str] = Field(default=None, description="记录日期 YYYY-MM-DD，默认今天")
    client_id: Optional[str] = Field(default=None, max_length=80, description="客户端幂等 ID")
    source_type: Optional[str] = Field(default="manual", description="manual / imported / ai")


class BodyWaterLogRequest(BaseModel):
    amount_ml: int = Field(..., ge=1, le=5000, description="饮水量 ml")
    date: Optional[str] = Field(default=None, description="记录日期 YYYY-MM-DD，默认今天")
    source_type: Optional[str] = Field(default="manual", description="manual / imported / ai")


class BodyWaterResetRequest(BaseModel):
    date: Optional[str] = Field(default=None, description="要清空的日期 YYYY-MM-DD，默认今天")


class BodyMetricsLocalWeightEntry(BaseModel):
    date: str = Field(..., description="日期 YYYY-MM-DD")
    value: float = Field(..., ge=20, le=300, description="体重 kg")
    client_id: Optional[str] = Field(default=None, max_length=80, description="客户端幂等 ID")
    recorded_at: Optional[str] = Field(default=None, description="记录时间 ISO 字符串")


class BodyMetricsLocalWaterDay(BaseModel):
    total: int = Field(default=0, ge=0, le=20000)
    logs: List[int] = Field(default_factory=list, description="当天分次喝水记录 ml")


class BodyMetricsSyncRequest(BaseModel):
    weight_entries: List[BodyMetricsLocalWeightEntry] = Field(default_factory=list)
    water_by_date: Dict[str, BodyMetricsLocalWaterDay] = Field(default_factory=dict)
    water_goal_ml: Optional[int] = Field(default=None, ge=500, le=10000)


class FoodExpiryItemUpsertRequest(BaseModel):
    food_name: str = Field(..., min_length=1, max_length=60, description="食物名称")
    category: Optional[str] = Field(default=None, max_length=30, description="食物分类")
    storage_type: Optional[str] = Field(default="refrigerated", description="储存方式: room_temp / refrigerated / frozen")
    quantity_note: Optional[str] = Field(default=None, max_length=40, description="数量说明")
    expire_date: str = Field(..., description="到期日期 YYYY-MM-DD")
    opened_date: Optional[str] = Field(default=None, description="开封日期 YYYY-MM-DD")
    note: Optional[str] = Field(default=None, max_length=200, description="补充备注")
    source_type: Optional[str] = Field(default="manual", description="来源: manual / ocr / ai")
    status: Optional[str] = Field(default="active", description="状态: active / consumed / discarded")


class FoodExpiryRecognitionRequest(BaseModel):
    image_urls: List[str] = Field(..., min_length=1, max_length=5, description="待识别的食物图片 URL 列表")
    additional_context: Optional[str] = Field(default=None, max_length=200, description="用户补充说明")


class FoodExpiryStatusUpdateRequest(BaseModel):
    status: str = Field(..., description="状态: active / consumed / discarded")


class FoodExpirySubscribeRequest(BaseModel):
    subscribe_status: str = Field(..., description="小程序订阅消息授权结果")
    err_msg: Optional[str] = Field(default=None, description="订阅接口返回信息")


# ---------- 健康档案 (Professional Onboarding) ----------


class DashboardTargetsUpdateRequest(BaseModel):
    """首页仪表盘目标热量与三大营养素（与 PUT /api/user/dashboard-targets 共用结构）"""
    calorie_target: float = Field(..., ge=500, le=6000, description="每日目标热量 kcal")
    protein_target: float = Field(..., ge=0, le=500, description="蛋白质目标 g")
    carbs_target: float = Field(..., ge=0, le=1000, description="碳水目标 g")
    fat_target: float = Field(..., ge=0, le=300, description="脂肪目标 g")


class HealthProfileUpdateRequest(BaseModel):
    """首次/更新健康档案问卷"""
    gender: Optional[str] = Field(None, description="性别: male / female")
    birthday: Optional[str] = Field(None, description="出生日期 YYYY-MM-DD")
    height: Optional[float] = Field(None, ge=50, le=250, description="身高 cm")
    weight: Optional[float] = Field(None, ge=20, le=300, description="体重 kg")
    activity_level: Optional[str] = Field(
        None,
        description="活动水平: sedentary / light / moderate / active / very_active"
    )
    medical_history: Optional[List[str]] = Field(
        default_factory=list,
        description="既往病史：如 diabetes, hypertension, gout 等"
    )
    diet_preference: Optional[List[str]] = Field(
        default_factory=list,
        description="饮食偏好：如 keto, vegetarian, vegan 等"
    )
    allergies: Optional[List[str]] = Field(
        default_factory=list,
        description="过敏原：如 peanuts, seafood 等"
    )
    report_extract: Optional[Dict[str, Any]] = Field(
        None,
        description="体检报告 OCR 识别结果JSON"
    )
    report_image_url: Optional[str] = Field(
        None,
        description="体检报告图片公网 URL"
    )
    diet_goal: Optional[str] = Field(
        None,
        description="目标：fat_loss, muscle_gain, maintain"
    )
    health_notes: Optional[str] = Field(
        None,
        description="特殊情况/补充"
    )
    dashboard_targets: Optional[DashboardTargetsUpdateRequest] = Field(
        None,
        description="首页摄入目标（写入 health_condition.dashboard_targets，兼容未部署独立接口的旧服务）",
    )
    precision_reference_defaults: Optional[PrecisionReferenceDefaults] = Field(
        None,
        description="精准模式默认参考物配置（写入 health_condition.precision_reference_defaults）",
    )
    execution_mode: Optional[str] = Field(
        None,
        description="执行模式: standard / strict"
    )
    mode_set_by: Optional[str] = Field(
        None,
        description="模式设置来源: system / user_manual / coach_manual"
    )
    mode_reason: Optional[str] = Field(
        None,
        description="模式设置原因编码"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "gender": "male",
                "birthday": "1990-01-01",
                "height": 175,
                "weight": 70,
                "activity_level": "moderate",
                "diet_goal": "fat_loss",
                "execution_mode": "strict"
            }
        }


@app.get("/api/user/profile")
async def get_user_profile(
    user_info: dict = Depends(get_current_user_info)
):
    """
    获取当前用户信息（需要认证）
    """
    user_id = user_info["user_id"]
    openid = user_info["openid"]
    
    # 从数据库获取完整用户信息
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    # 健康档案字段（若表已扩展则返回）
    health = {
        "height": user.get("height"),
        "weight": user.get("weight"),
        "birthday": user.get("birthday"),
        "gender": user.get("gender"),
        "activity_level": user.get("activity_level"),
        "health_condition": user.get("health_condition") or {},
        "bmr": float(user["bmr"]) if user.get("bmr") is not None else None,
        "tdee": float(user["tdee"]) if user.get("tdee") is not None else None,
        "onboarding_completed": bool(user.get("onboarding_completed")),
        "diet_goal": user.get("diet_goal"),
        "execution_mode": _normalize_execution_mode(user.get("execution_mode")),
        "mode_set_by": user.get("mode_set_by"),
        "mode_set_at": user.get("mode_set_at"),
        "mode_reason": user.get("mode_reason"),
        "mode_commitment_days": user.get("mode_commitment_days"),
        "mode_switch_count_30d": user.get("mode_switch_count_30d"),
        "searchable": user.get("searchable", True),
        "public_records": user.get("public_records", True),
    }
    return {
        "id": user["id"],
        "openid": user["openid"],
        "unionid": user.get("unionid"),
        "nickname": user.get("nickname", ""),
        "avatar": user.get("avatar", ""),
        "telephone": user.get("telephone"),
        "create_time": user.get("create_time"),
        "update_time": user.get("update_time"),
        **health,
    }


@app.get("/api/user/record-days")
async def get_user_record_days(
    user_info: dict = Depends(get_current_user_info)
):
    """
    获取用户记录天数（从第一条记录到现在有记录的天数）
    """
    user_id = user_info["user_id"]
    try:
        # 获取用户所有记录的日期（按中国时区自然日去重）
        records = await list_food_records(user_id)
        if not records:
            return {"record_days": 0}
        
        # 提取所有记录日期（北京时间 YYYY-MM-DD）
        record_dates = set()
        for record in records:
            rt = record.get("record_time")
            if rt:
                try:
                    dt_utc = datetime.fromisoformat(str(rt).replace("Z", "+00:00"))
                    dt_local = dt_utc.astimezone(CHINA_TZ)
                    date_str = dt_local.date().isoformat()
                    record_dates.add(date_str)
                except Exception as e:
                    print(f"[get_user_record_days] Date parse error for {rt}: {e}")
                    continue
        
        return {"record_days": len(record_dates)}
    except Exception as e:
        print(f"[get_user_record_days] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"获取记录天数失败: {str(e)}")


async def _get_effective_membership(user_id: str) -> Optional[Dict[str, Any]]:
    """获取并按当前时间修正用户会员状态。"""
    membership = await get_user_pro_membership(user_id)
    if not membership:
        return None

    expires_at = _parse_datetime(membership.get("expires_at"))
    status = membership.get("status")
    if status == "active" and expires_at and expires_at <= datetime.now(timezone.utc):
        membership = await save_user_pro_membership(
            user_id,
            {
                "status": "expired",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
    return membership


@app.get("/api/membership/plans", response_model=MembershipPlansListResponse)
async def get_membership_plans():
    """获取启用中的会员套餐（3 档 × 3 周期 矩阵）。"""
    try:
        plans = await list_active_membership_plans()
        result_list = []
        for plan in plans:
            amount = float(plan.get("amount") or 0)
            original_raw = plan.get("original_amount")
            original = float(original_raw) if original_raw is not None else None
            savings = round(original - amount, 2) if (original is not None and original > amount) else None
            result_list.append({
                "code": plan["code"],
                "name": plan["name"],
                "amount": amount,
                "duration_months": int(plan.get("duration_months") or 1),
                "description": plan.get("description"),
                "tier": plan.get("tier"),
                "period": plan.get("period"),
                "daily_credits": int(plan.get("daily_credits") or 0),
                "original_amount": original,
                "savings": savings,
                "sort_order": int(plan.get("sort_order") or 0),
            })
        return {"list": result_list}
    except Exception as e:
        print(f"[get_membership_plans] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"获取会员套餐失败: {str(e)}")


@app.get("/api/membership/me", response_model=MembershipStatusResponse)
async def get_my_membership(
    user_info: dict = Depends(get_current_user_info)
):
    """获取当前登录用户的 Pro 会员状态（含今日配额与积分）。"""
    try:
        user_id = user_info["user_id"]
        membership = await _get_effective_membership(user_id)
        user_row = await get_user_by_id(user_id)
        result = _format_membership_response(membership)
        is_pro = result["is_pro"]

        # --- 旧拍照日限兼容（当前关闭） ---
        daily_limit = _get_food_analysis_daily_limit(is_pro)
        today_str = datetime.now(CHINA_TZ).strftime("%Y-%m-%d")
        daily_used_count = await get_today_food_analysis_count(user_id, today_str)
        if daily_limit is None:
            result["daily_limit"] = None
            result["daily_used"] = daily_used_count
            result["daily_remaining"] = None
        else:
            daily_used = min(daily_used_count, daily_limit)
            result["daily_limit"] = daily_limit
            result["daily_used"] = daily_used
            result["daily_remaining"] = max(daily_limit - daily_used, 0)

        # --- 新积分体系 ---
        credits_info = await _compute_daily_credits_status(
            user_id=user_id,
            is_pro=is_pro,
            membership=membership,
            user_row=user_row,
        )
        result.update(credits_info)
        return result
    except Exception as e:
        print(f"[get_my_membership] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"获取会员状态失败: {str(e)}")


@app.post("/api/membership/rewards/share-poster/claim", response_model=ClaimSharePosterRewardResponse)
async def claim_membership_share_poster_reward(
    body: ClaimSharePosterRewardRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """领取“生成分享海报”奖励。当前口径：每天最多 1 次，仅允许给自己的记录领取。"""
    user_id = user_info["user_id"]
    try:
        record_id = str(body.record_id or "").strip()
        if record_id:
            record = await get_food_record_by_id(record_id)
            if not record:
                raise HTTPException(status_code=404, detail="记录不存在")
            if str(record.get("user_id") or "") != user_id:
                raise HTTPException(status_code=403, detail="只能为自己的记录领取海报奖励")

        today_str = datetime.now(CHINA_TZ).strftime("%Y-%m-%d")
        claim_result = await claim_share_poster_bonus(
            user_id=user_id,
            china_date_str=today_str,
            source_record_id=record_id or None,
        )
        membership = await _get_effective_membership(user_id)
        user_row = await get_user_by_id(user_id)
        credits_info = await _compute_daily_credits_status(
            user_id=user_id,
            is_pro=bool(_format_membership_response(membership).get("is_pro")),
            membership=membership,
            user_row=user_row,
        )

        claimed = bool(claim_result.get("claimed"))
        already_claimed = bool(claim_result.get("already_claimed"))
        credits = int(claim_result.get("credits") or 0)
        if claimed:
            message = "今日海报奖励已到账 +1 积分"
        elif already_claimed:
            message = "今日海报奖励已领取过"
        else:
            message = "海报已生成"
        return {
            "claimed": claimed,
            "already_claimed": already_claimed,
            "credits": credits,
            "daily_credits_max": int(credits_info.get("daily_credits_max") or 0),
            "daily_credits_remaining": int(credits_info.get("daily_credits_remaining") or 0),
            "message": message,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[claim_membership_share_poster_reward] 错误: {e}")
        raise HTTPException(status_code=500, detail="领取海报奖励失败")


@app.post("/api/membership/pay/create", response_model=CreateMembershipPaymentResponse)
async def create_membership_payment(
    body: CreateMembershipPaymentRequest,
    user_info: dict = Depends(get_current_user_info)
):
    """创建 Pro 会员支付订单，并返回小程序调起支付参数。"""
    try:
        config = _get_wechat_pay_config()
        plan = await get_membership_plan_by_code(body.plan_code)
        if not plan or not plan.get("is_active"):
            raise HTTPException(status_code=404, detail="会员套餐不存在或未启用")

        user = await get_user_by_id(user_info["user_id"])
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        openid = (user.get("openid") or "").strip()
        if not openid:
            raise HTTPException(status_code=400, detail="当前用户缺少 openid，无法发起微信支付")

        amount = _to_decimal_amount(plan.get("amount") or "0")
        duration_months = int(plan.get("duration_months") or 1)
        order_no = _generate_membership_order_no()
        canonical_url = "/v3/pay/transactions/jsapi"
        request_payload = {
            "appid": config["appid"],
            "mchid": config["mchid"],
            "description": plan.get("name") or "Pro 月度会员",
            "out_trade_no": order_no,
            "notify_url": config["notify_url"],
            "amount": {
                "total": _amount_to_fen(amount),
                "currency": "CNY",
            },
            "payer": {
                "openid": openid,
            },
        }
        request_body = json.dumps(request_payload, ensure_ascii=False, separators=(",", ":"))
        authorization = _build_wechatpay_authorization(
            mchid=config["mchid"],
            serial_no=config["serial_no"],
            private_key_pem=config["private_key"],
            method="POST",
            canonical_url=canonical_url,
            body=request_body,
        )

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"https://api.mch.weixin.qq.com{canonical_url}",
                content=request_body.encode("utf-8"),
                headers={
                    "Authorization": authorization,
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "User-Agent": "food-link/1.0",
                },
            )

        if response.status_code not in (200, 201):
            try:
                error_data = response.json()
                error_msg = error_data.get("message") or error_data.get("detail") or response.text
            except Exception:
                error_msg = response.text
            raise HTTPException(status_code=502, detail=f"微信下单失败: {error_msg}")

        response_data = response.json()
        prepay_id = (response_data.get("prepay_id") or "").strip()
        if not prepay_id:
            raise HTTPException(status_code=502, detail="微信下单失败：未返回 prepay_id")

        await _expire_pending_membership_orders_for_user(
            user_info["user_id"],
            reason="superseded_by_new_order",
        )

        await create_pro_membership_payment_record(
            {
                "user_id": user_info["user_id"],
                "plan_code": plan["code"],
                "order_no": order_no,
                "amount": float(amount),
                "currency": "CNY",
                "duration_months": duration_months,
                "pay_channel": "wechat_mini_program",
                "trade_type": "JSAPI",
                "status": "pending",
                "wx_openid": openid,
                "wx_prepay_id": prepay_id,
                "extra": {
                    "create_order_payload": request_payload,
                    "wechat_create_order_response": response_data,
                },
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )

        pay_params = _build_mini_program_pay_params(
            appid=config["appid"],
            prepay_id=prepay_id,
            private_key_pem=config["private_key"],
        )

        return {
            "order_no": order_no,
            "plan_code": plan["code"],
            "amount": float(amount),
            "pay_params": pay_params,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[create_membership_payment] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"创建会员支付失败: {str(e)}")


@app.post("/api/payment/wechat/notify/membership")
async def wechat_membership_notify(request: Request):
    """处理微信支付 Pro 会员支付回调。"""
    config = _get_wechat_pay_config()
    if not config.get("public_key"):
        raise HTTPException(status_code=500, detail="缺少微信支付公钥配置，无法处理支付回调")
    body_bytes = await request.body()
    body_text = body_bytes.decode("utf-8")

    signature = request.headers.get("Wechatpay-Signature", "")
    timestamp = request.headers.get("Wechatpay-Timestamp", "")
    nonce = request.headers.get("Wechatpay-Nonce", "")
    if not signature or not timestamp or not nonce:
        raise HTTPException(status_code=400, detail="微信支付回调缺少签名头")

    sign_message = f"{timestamp}\n{nonce}\n{body_text}\n"
    if not _verify_with_rsa_sha256(sign_message, signature, config["public_key"]):
        raise HTTPException(status_code=401, detail="微信支付回调验签失败")

    try:
        notify_data = json.loads(body_text or "{}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"微信支付回调报文解析失败: {e}")

    resource = notify_data.get("resource") or {}
    decrypted = _decrypt_wechatpay_resource(resource, config["api_v3_key"])
    order_no = (decrypted.get("out_trade_no") or "").strip()
    if not order_no:
        raise HTTPException(status_code=400, detail="微信支付回调缺少 out_trade_no")

    payment_record = await get_pro_membership_payment_record_by_order_no(order_no)
    if not payment_record:
        raise HTTPException(status_code=404, detail="未找到对应的会员支付记录")

    if payment_record.get("status") == "paid":
        return JSONResponse(content={"code": "SUCCESS", "message": "成功"})

    trade_state = (decrypted.get("trade_state") or "").upper()
    if trade_state != "SUCCESS":
        return JSONResponse(content={"code": "SUCCESS", "message": "已接收"})

    paid_total = int(((decrypted.get("amount") or {}).get("payer_total")) or ((decrypted.get("amount") or {}).get("total")) or 0)
    expected_total = _amount_to_fen(payment_record.get("amount") or 0)
    if paid_total != expected_total:
        raise HTTPException(status_code=400, detail="微信支付金额与订单金额不一致")

    paid_at = _parse_datetime(decrypted.get("success_time")) or datetime.now(timezone.utc)

    await update_pro_membership_payment_record(
        order_no,
        {
            "status": "paid",
            "wx_transaction_id": decrypted.get("transaction_id"),
            "wx_bank_type": decrypted.get("bank_type"),
            "paid_at": paid_at.isoformat(),
            "notify_payload": {
                "headers": {
                    "Wechatpay-Signature": signature,
                    "Wechatpay-Timestamp": timestamp,
                    "Wechatpay-Nonce": nonce,
                },
                "body": notify_data,
                "resource_decrypted": decrypted,
            },
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    )

    membership = await get_user_pro_membership(payment_record["user_id"])
    existing_expires_at = _parse_datetime(membership.get("expires_at")) if membership else None
    existing_first_activated_at = _parse_datetime(membership.get("first_activated_at")) if membership else None
    existing_period_start = _parse_datetime(membership.get("current_period_start")) if membership else None
    duration_months = int(payment_record.get("duration_months") or 1)

    if membership and membership.get("status") == "active" and existing_expires_at and existing_expires_at > paid_at:
        current_period_start = existing_period_start or paid_at
        expires_at = _add_months(existing_expires_at, duration_months)
        first_activated_at = existing_first_activated_at or paid_at
    else:
        current_period_start = paid_at
        expires_at = _add_months(paid_at, duration_months)
        first_activated_at = existing_first_activated_at or paid_at

    # 取新套餐的每日积分，作为 user_pro_memberships.daily_credits 快照
    plan_for_credits = await get_membership_plan_by_code(payment_record.get("plan_code") or "")
    plan_daily_credits = int((plan_for_credits or {}).get("daily_credits") or 0)
    paid_user_row = await get_user_by_id(payment_record["user_id"])
    early_user_meta = await _resolve_early_user_membership_meta(payment_record["user_id"], paid_user_row)
    if bool(early_user_meta.get("early_user_paid_bonus_eligible")) and plan_daily_credits > 0:
        plan_daily_credits *= int(early_user_meta.get("early_user_paid_bonus_multiplier") or 1)

    await save_user_pro_membership(
        payment_record["user_id"],
        {
            "current_plan_code": payment_record.get("plan_code"),
            "status": "active",
            "first_activated_at": _build_json_datetime(first_activated_at),
            "current_period_start": _build_json_datetime(current_period_start),
            "expires_at": _build_json_datetime(expires_at),
            "last_paid_at": paid_at.isoformat(),
            "auto_renew": False,
            "daily_credits": plan_daily_credits,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    )

    await _expire_pending_membership_orders_for_user(
        payment_record["user_id"],
        reason="superseded_by_paid_order",
    )

    return JSONResponse(content={"code": "SUCCESS", "message": "成功"})


@app.put("/api/user/profile")
async def update_user_profile(
    update_data: UpdateUserInfoRequest,
    user_info: dict = Depends(get_current_user_info)
):
    """
    更新当前用户信息（需要认证）
    """
    user_id = user_info["user_id"]
    
    # 构建更新数据（只包含非空字段）
    update_dict = {}
    if update_data.nickname is not None:
        update_dict["nickname"] = update_data.nickname
    if update_data.avatar is not None:
        update_dict["avatar"] = update_data.avatar
    if update_data.telephone is not None:
        update_dict["telephone"] = update_data.telephone
    if update_data.searchable is not None:
        update_dict["searchable"] = update_data.searchable
    if update_data.public_records is not None:
        update_dict["public_records"] = update_data.public_records
    
    if not update_dict:
        raise HTTPException(status_code=400, detail="没有要更新的字段")
    
    # 更新用户信息
    try:
        updated_user = await update_user(user_id, update_dict)
        return {
            "id": updated_user["id"],
            "openid": updated_user["openid"],
            "unionid": updated_user.get("unionid"),
            "nickname": updated_user.get("nickname", ""),
            "avatar": updated_user.get("avatar", ""),
            "telephone": updated_user.get("telephone"),
            "create_time": updated_user.get("create_time"),
            "update_time": updated_user.get("update_time"),
            "searchable": updated_user.get("searchable"),
            "public_records": updated_user.get("public_records")
        }
    except Exception as e:
        print(f"[update_user_profile] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"更新用户信息失败: {str(e)}")


class BindPhoneRequest(BaseModel):
    """绑定手机号请求（用微信 getPhoneNumber 返回的 code 换手机号并写入库）"""
    phoneCode: str = Field(..., description="微信 getPhoneNumber 返回的 code")


@app.post("/api/user/bind-phone")
async def bind_phone(
    body: BindPhoneRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    已登录用户用微信手机号 code 绑定手机号并写入 weapp_user.telephone。
    登录后若后端未返回手机号时可调用此接口补录。
    """
    user_id = user_info["user_id"]
    if not body.phoneCode or not body.phoneCode.strip():
        raise HTTPException(status_code=400, detail="phoneCode 不能为空")
    try:
        phone_info = await get_phone_number(body.phoneCode.strip())
        pure_phone_number = phone_info.get("purePhoneNumber")
        if not pure_phone_number:
            raise HTTPException(status_code=400, detail="未能获取到手机号")
        updated_user = await update_user(user_id, {"telephone": pure_phone_number})
        return {
            "telephone": updated_user.get("telephone"),
            "purePhoneNumber": pure_phone_number,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[bind_phone] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"绑定手机号失败: {str(e)}")


class UploadAvatarRequest(BaseModel):
    """上传用户头像请求"""
    base64Image: str = Field(..., description="Base64 编码的头像图片")


@app.post("/api/user/upload-avatar")
async def upload_avatar(
    body: UploadAvatarRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    上传用户头像到 Supabase Storage，返回公网 URL。
    小程序先调此接口拿 imageUrl，再调 PUT /api/user/profile 更新 avatar 字段。
    """
    user_id = user_info["user_id"]
    if not body.base64Image:
        raise HTTPException(status_code=400, detail="base64Image 不能为空")
    try:
        image_url = upload_user_avatar(user_id, body.base64Image)
        return {"imageUrl": image_url}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[upload_avatar] 错误: {e}")
        raise HTTPException(status_code=500, detail="上传失败，请检查 Supabase Storage 是否已创建 bucket「user-avatars」并设为 Public")


# ---------- 健康档案 API ----------
@app.get("/api/user/health-profile")
async def get_health_profile(user_info: dict = Depends(get_current_user_info)):
    """获取当前用户健康档案（需认证）"""
    user_id = user_info["user_id"]
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {
        "height": user.get("height"),
        "weight": user.get("weight"),
        "birthday": user.get("birthday"),
        "gender": user.get("gender"),
        "activity_level": user.get("activity_level"),
        "health_condition": user.get("health_condition") or {},
        "bmr": float(user["bmr"]) if user.get("bmr") is not None else None,
        "tdee": float(user["tdee"]) if user.get("tdee") is not None else None,
        "onboarding_completed": bool(user.get("onboarding_completed")),
        "diet_goal": user.get("diet_goal"),
        "execution_mode": _normalize_execution_mode(user.get("execution_mode")),
        "mode_set_by": user.get("mode_set_by"),
        "mode_set_at": user.get("mode_set_at"),
        "mode_reason": user.get("mode_reason"),
        "mode_commitment_days": user.get("mode_commitment_days"),
        "mode_switch_count_30d": user.get("mode_switch_count_30d"),
    }


@app.put("/api/user/health-profile")
async def update_health_profile(
    body: HealthProfileUpdateRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    提交/更新健康档案问卷。后端根据性别、体重、活动水平自动计算 BMR 与 TDEE。
    """
    user_id = user_info["user_id"]
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    update_dict = {}
    if body.gender is not None:
        update_dict["gender"] = body.gender
    if body.birthday is not None:
        update_dict["birthday"] = body.birthday
    if body.height is not None:
        update_dict["height"] = body.height
    if body.weight is not None:
        update_dict["weight"] = body.weight
    if body.activity_level is not None:
        update_dict["activity_level"] = body.activity_level
    if body.diet_goal is not None:
        update_dict["diet_goal"] = body.diet_goal

    current_mode = _normalize_execution_mode(user.get("execution_mode"))
    requested_mode = _parse_execution_mode_or_raise(body.execution_mode) if body.execution_mode is not None else None
    mode_changed = False
    mode_change_from = current_mode
    mode_change_to = current_mode
    mode_change_set_by = "user_manual"
    mode_change_reason = None
    if requested_mode is not None:
        update_dict["execution_mode"] = requested_mode
        mode_change_to = requested_mode
        mode_changed = requested_mode != current_mode
        if mode_changed:
            raw_set_by = (body.mode_set_by or "user_manual").strip().lower() if body.mode_set_by else "user_manual"
            if raw_set_by not in VALID_MODE_SET_BY:
                raise HTTPException(status_code=400, detail="mode_set_by 不合法")
            mode_change_set_by = raw_set_by
            mode_change_reason = (body.mode_reason or "").strip() or None
            update_dict["mode_set_by"] = mode_change_set_by
            update_dict["mode_set_at"] = datetime.now(timezone.utc).isoformat()
            update_dict["mode_reason"] = mode_change_reason
            prev_count = int(user.get("mode_switch_count_30d") or 0)
            update_dict["mode_switch_count_30d"] = prev_count + 1

    health_condition = dict(user.get("health_condition") or {})
    if body.medical_history is not None:
        health_condition["medical_history"] = body.medical_history
    if body.diet_preference is not None:
        health_condition["diet_preference"] = body.diet_preference
    if body.allergies is not None:
        health_condition["allergies"] = body.allergies
    if body.health_notes is not None:
        health_condition["health_notes"] = body.health_notes
    if body.dashboard_targets is not None:
        dt = body.dashboard_targets
        health_condition["dashboard_targets"] = {
            "calorie_target": round(float(dt.calorie_target), 1),
            "protein_target": round(float(dt.protein_target), 1),
            "carbs_target": round(float(dt.carbs_target), 1),
            "fat_target": round(float(dt.fat_target), 1),
        }
    if body.precision_reference_defaults is not None:
        normalized_precision_reference_defaults = _normalize_precision_reference_defaults(
            body.precision_reference_defaults
        )
        if normalized_precision_reference_defaults:
            health_condition["precision_reference_defaults"] = normalized_precision_reference_defaults
        else:
            health_condition.pop("precision_reference_defaults", None)
    # 若有体检报告 OCR 结果，一并写入 user_health_documents（含 image_url 与识别结果）
    if body.report_extract:
        try:
            await insert_health_document(
                user_id=user_id,
                document_type="report",
                image_url=body.report_image_url,
                extracted_content=body.report_extract,
            )
            health_condition["report_extract"] = body.report_extract
        except Exception as e:
            print(f"[update_health_profile] 写入体检报告失败: {e}")
    update_dict["health_condition"] = health_condition

    # 计算 BMR / TDEE（当前 BMR 使用毛德倩公式，只依赖性别、体重与活动水平）
    gender = update_dict.get("gender") or user.get("gender")
    weight = update_dict.get("weight") if "weight" in update_dict else user.get("weight")
    activity_level = update_dict.get("activity_level") or user.get("activity_level") or "sedentary"

    if gender and weight is not None:
        bmr = calculate_bmr(
            "male" if gender == "male" else "female",
            float(weight),
            0.0,
            0,
        )
        tdee = calculate_tdee(bmr, activity_level or "sedentary")
        update_dict["bmr"] = bmr
        update_dict["tdee"] = tdee

    update_dict["onboarding_completed"] = True

    if not update_dict:
        raise HTTPException(status_code=400, detail="没有要更新的字段")

    # 确保 health_condition 为可序列化 dict（Supabase jsonb）
    if "health_condition" in update_dict and isinstance(update_dict["health_condition"], dict):
        update_dict["health_condition"] = dict(update_dict["health_condition"])

    print(f"[update_health_profile] user_id={user_id}, update_dict keys={list(update_dict.keys())}")

    try:
        updated = await update_user(user_id, update_dict)
        if mode_changed:
            try:
                await asyncio.to_thread(
                    insert_user_mode_switch_log_sync,
                    user_id,
                    mode_change_from,
                    mode_change_to,
                    mode_change_set_by,
                    mode_change_reason,
                )
            except Exception as log_err:
                print(f"[update_health_profile] 写入模式切换日志失败: {log_err}")
        # 二次查询验证：从数据库重新读一次，确认是否真正持久化
        verify = await get_user_by_id(user_id)
        verify_height = verify.get("height") if verify else None
        verify_bmr = verify.get("bmr") if verify else None
        print(
            f"[update_health_profile] 返回行 height={updated.get('height')}, bmr={updated.get('bmr')} | "
            f"验证查询 height={verify_height}, bmr={verify_bmr} | "
            f"PostgreSQL={os.getenv('POSTGRESQL_HOST', '')}:{os.getenv('POSTGRESQL_PORT', '')}/{os.getenv('POSTGRESQL_DATABASE', '')}"
        )
        if verify and verify_height is None and updated.get("height") is not None:
            print("[update_health_profile] 警告: 更新返回有值但验证查询无值，可能未持久化或连接了不同数据库，请核对 POSTGRESQL_* 配置是否一致")
        return {
            "height": updated.get("height"),
            "weight": updated.get("weight"),
            "birthday": updated.get("birthday"),
            "gender": updated.get("gender"),
            "activity_level": updated.get("activity_level"),
            "health_condition": updated.get("health_condition") or {},
            "bmr": float(updated["bmr"]) if updated.get("bmr") is not None else None,
            "tdee": float(updated["tdee"]) if updated.get("tdee") is not None else None,
            "onboarding_completed": bool(updated.get("onboarding_completed")),
            "diet_goal": updated.get("diet_goal"),
            "execution_mode": _normalize_execution_mode(updated.get("execution_mode")),
            "mode_set_by": updated.get("mode_set_by"),
            "mode_set_at": updated.get("mode_set_at"),
            "mode_reason": updated.get("mode_reason"),
            "mode_commitment_days": updated.get("mode_commitment_days"),
            "mode_switch_count_30d": updated.get("mode_switch_count_30d"),
        }
    except Exception as e:
        err_msg = str(e).lower()
        print(f"[update_health_profile] 错误: {e}")
        if "column" in err_msg and ("does not exist" in err_msg or "不存在" in err_msg):
            raise HTTPException(
                status_code=500,
                detail="数据库表未扩展健康档案字段。请在 Supabase SQL Editor 中执行 backend/database/user_health_profile.sql 迁移脚本。"
            )
        raise HTTPException(status_code=500, detail=f"更新健康档案失败: {str(e)}")


def _ocr_report_prompt() -> str:
    """体检报告 OCR 提示词"""
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


async def _ocr_extract_report_image(base64_image: str) -> Dict[str, Any]:
    """体检报告 OCR：使用 base64 图片，仅返回提取的 JSON，不写库。"""
    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="缺少 DASHSCOPE_API_KEY 环境变量")
    image_data = base64_image.split(",")[1] if "," in base64_image else base64_image
    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_url = f"{base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            api_url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": os.getenv("ANALYZE_MODEL", "qwen-vl-max"),
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": _ocr_report_prompt()},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_data}"}},
                        ],
                    }
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.3,
            },
        )
    if not response.is_success:
        raise HTTPException(status_code=500, detail="OCR 识别服务请求失败")
    data = response.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content")
    if not content:
        raise HTTPException(status_code=500, detail="OCR 返回为空")
    json_str = re.sub(r"```json", "", content)
    json_str = re.sub(r"```", "", json_str).strip()
    return json.loads(json_str)


async def _ocr_extract_report_by_url(image_url: str) -> Dict[str, Any]:
    """体检报告 OCR：使用图片公网 URL 传给多模态模型，仅返回提取的 JSON，不写库。"""
    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="缺少 DASHSCOPE_API_KEY 环境变量")
    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_url = f"{base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            api_url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
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
        raise HTTPException(status_code=500, detail="OCR 识别服务请求失败")
    data = response.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content")
    if not content:
        raise HTTPException(status_code=500, detail="OCR 返回为空")
    json_str = re.sub(r"```json", "", content)
    json_str = re.sub(r"```", "", json_str).strip()
    return json.loads(json_str)


class UploadReportImageRequest(BaseModel):
    """上传体检报告图片到 Supabase Storage"""
    base64Image: str = Field(..., description="Base64 编码的体检报告或病例截图")


@app.post("/api/user/health-profile/upload-report-image")
async def upload_report_image(
    body: UploadReportImageRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    将体检报告图片上传到 Supabase Storage，返回公网 URL。
    小程序先调此接口拿 imageUrl，再调 ocr-extract 传 imageUrl 给多模态模型识别。
    """
    user_id = user_info["user_id"]
    if not body.base64Image:
        raise HTTPException(status_code=400, detail="base64Image 不能为空")
    try:
        image_url = upload_health_report_image(user_id, body.base64Image)
        return {"imageUrl": image_url}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[upload_report_image] 错误: {e}")
        raise HTTPException(status_code=500, detail="上传失败，请检查 Supabase Storage 是否已创建 bucket「health-reports」并设为 Public")


class SubmitReportExtractionTaskRequest(BaseModel):
    """提交病历信息提取任务（后台异步处理）"""
    imageUrl: str = Field(..., description="体检报告图片在 Supabase Storage 的公网 URL")


@app.post("/api/user/health-profile/submit-report-extraction-task")
async def submit_report_extraction_task(
    body: SubmitReportExtractionTaskRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    提交病历信息提取任务，由 Worker 子进程在后台处理。
    完成后自动写入 user_health_documents 并更新 weapp_user.health_condition.report_extract。
    用户无需等待，保存档案后即可退出。
    """
    user_id = user_info["user_id"]
    if not body.imageUrl or not body.imageUrl.strip():
        raise HTTPException(status_code=400, detail="imageUrl 不能为空")
    try:
        task = await asyncio.to_thread(
            create_analysis_task_sync,
            user_id=user_id,
            task_type="health_report",
            image_url=body.imageUrl.strip(),
            payload={},
        )
        return {"taskId": str(task["id"])}
    except Exception as e:
        print(f"[submit_report_extraction_task] 错误: {e}")
        raise HTTPException(status_code=500, detail="提交任务失败")


class HealthReportOcrRequest(BaseModel):
    """体检报告 OCR 请求：imageUrl 或 base64Image 二选一"""
    imageUrl: Optional[str] = Field(None, description="体检报告图片公网 URL")
    base64Image: Optional[str] = Field(None, description="Base64 编码的报告图片")


@app.post("/api/user/health-profile/ocr-extract")
async def health_report_ocr_extract(
    body: HealthReportOcrRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    仅识别体检报告/病例截图，返回提取的 JSON，不写入数据库。
    推荐先调 upload-report-image 拿到 imageUrl，再传 imageUrl 给本接口；也可直接传 base64Image。
    """
    if body.imageUrl:
        try:
            extracted = await _ocr_extract_report_by_url(body.imageUrl)
            return {"extracted": extracted}
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="OCR 返回格式解析失败")
        except HTTPException:
            raise
        except Exception as e:
            print(f"[health_report_ocr_extract] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    if body.base64Image:
        try:
            extracted = await _ocr_extract_report_image(body.base64Image)
            return {"extracted": extracted}
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="OCR 返回格式解析失败")
        except HTTPException:
            raise
        except Exception as e:
            print(f"[health_report_ocr_extract] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    raise HTTPException(status_code=400, detail="请传 imageUrl 或 base64Image")


@app.post("/api/user/health-profile/ocr")
async def health_report_ocr(
    body: HealthReportOcrRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    上传体检报告/病例截图，OCR 识别并写入 user_health_documents。
    """
    user_id = user_info["user_id"]
    if not body.base64Image:
        raise HTTPException(status_code=400, detail="base64Image 不能为空")
    try:
        extracted = await _ocr_extract_report_image(body.base64Image)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[health_report_ocr] 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    try:
        await insert_health_document(
            user_id=user_id,
            document_type="report",
            image_url=None,
            extracted_content=extracted,
        )
    except Exception as e:
        print(f"[health_report_ocr] 写入文档表失败: {e}")
    return {"extracted": extracted, "message": "识别完成，已保存到健康档案"}


# ---------- 饮食记录（拍照识别后确认记录） ----------


class FoodRecordItemNutrients(BaseModel):
    calories: float = 0
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    fiber: float = 0
    sugar: float = 0
    sodium_mg: float = 0


class FoodRecordItem(BaseModel):
    name: str = ""
    weight: float = 0  # 估算重量 g
    ratio: float = 100  # 摄入比例 %
    intake: float = 0  # 实际摄入 g
    nutrients: FoodRecordItemNutrients = Field(default_factory=FoodRecordItemNutrients)
    manual_source: Optional[str] = Field(default=None, description="手动记录来源: public_library / nutrition_library")
    manual_source_id: Optional[str] = Field(default=None, description="手动记录来源条目 ID")
    manual_source_title: Optional[str] = Field(default=None, description="手动记录来源原始标题")
    manual_portion_label: Optional[str] = Field(default=None, description="默认份量标签，如 1份 / 100g")


class CriticalSampleItem(BaseModel):
    """单条偏差样本（用户标记 AI 估算偏差大）"""
    image_path: Optional[str] = Field(default=None, description="图片路径或 URL（可选）")
    food_name: str = Field(..., description="食物名称")
    ai_weight: float = Field(..., description="AI 估算重量 g")
    user_weight: float = Field(..., description="用户修正后重量 g")
    deviation_percent: float = Field(..., description="偏差百分比，如 50 表示 +50%")


class SaveCriticalSamplesRequest(BaseModel):
    """标记样本请求：可一次提交多条"""
    items: List[CriticalSampleItem] = Field(default_factory=list, description="偏差样本列表")


@app.post("/api/critical-samples")
async def save_critical_samples(
    body: SaveCriticalSamplesRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    用户点击「认为 AI 估算偏差大，点击标记样本」时提交偏差样本，用于后续模型优化。
    要求：至少有一条样本且该条中 |user_weight - ai_weight| 有实际差异（建议 >1g）。
    """
    if not body.items:
        raise HTTPException(status_code=400, detail="请先修改上方的重量数值，以便我们记录偏差。")
    user_id = user_info["user_id"]
    rows = [
        {
            "image_path": item.image_path,
            "food_name": item.food_name,
            "ai_weight": item.ai_weight,
            "user_weight": item.user_weight,
            "deviation_percent": item.deviation_percent,
        }
        for item in body.items
    ]
    await insert_critical_samples(user_id, rows)
    return {"message": "已保存偏差样本", "count": len(rows)}


@app.get("/api/manual-food/search")
async def manual_food_search(
    q: str = "",
    limit: int = 20,
    user_info: Optional[dict] = Depends(get_optional_user_info),
):
    """
    手动记录搜索接口（无需登录）。
    搜索公共食物库 + 标准食物营养词典（含别名），返回统一格式。
    """
    q = (q or "").strip()
    if not q:
        return {"results": []}
    if limit < 1:
        limit = 1
    if limit > 50:
        limit = 50
    try:
        results = await search_manual_food(
            q,
            limit=limit,
            current_user_id=user_info["user_id"] if user_info else None,
        )
        if not results:
            asyncio.create_task(log_unresolved_food(q))
        return {"results": results}
    except Exception as e:
        print(f"[manual_food_search] 错误: {e}")
        raise HTTPException(status_code=500, detail="搜索失败")


@app.get("/api/manual-food/browse")
async def manual_food_browse(
    user_info: Optional[dict] = Depends(get_optional_user_info),
):
    """
    浏览食物数据库（无需登录）。
    返回公共食物库和标准营养词典的浏览分组与库规模信息，供前端展示。
    """
    try:
        data = await browse_manual_food_library(
            current_user_id=user_info["user_id"] if user_info else None,
        )
        return data
    except Exception as e:
        print(f"[manual_food_browse] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取食物库失败")


class SaveFoodRecordRequest(BaseModel):
    meal_type: str = Field(..., description=MEAL_TYPE_DESCRIPTION)
    image_path: Optional[str] = Field(default=None, description="图片路径或 URL（可选）")
    image_paths: Optional[List[str]] = Field(default=None, description="多图 URL 列表（可选）")
    description: Optional[str] = Field(default=None, description="AI 餐食描述")
    insight: Optional[str] = Field(default=None, description="AI 健康建议")
    items: List[FoodRecordItem] = Field(default_factory=list, description="食物项列表")
    total_calories: float = Field(0, description="总热量 kcal")
    total_protein: float = Field(0, description="总蛋白质 g")
    total_carbs: float = Field(0, description="总碳水 g")
    total_fat: float = Field(0, description="总脂肪 g")
    total_weight_grams: int = Field(0, description="总预估重量 g")
    diet_goal: Optional[str] = Field(default=None, description="饮食目标: fat_loss / muscle_gain / maintain / none")
    activity_timing: Optional[str] = Field(default=None, description="运动时机: post_workout / daily / before_sleep / none")
    pfc_ratio_comment: Optional[str] = Field(default=None, description="PFC 比例评价")
    absorption_notes: Optional[str] = Field(default=None, description="吸收率说明")
    context_advice: Optional[str] = Field(default=None, description="情境建议")
    source_task_id: Optional[str] = Field(default=None, description="来源识别任务 ID（从 analysis_tasks 保存而来时传入）")


@app.post("/api/food-record/save")
async def save_food_record(
    body: SaveFoodRecordRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    拍照识别完成后确认记录：支持早/午/晚三餐 + 早/午/晚加餐。
    """
    user_id = user_info["user_id"]
    if body.meal_type not in VALID_MEAL_TYPES:
        raise HTTPException(status_code=400, detail=f"meal_type 必须为 {MEAL_TYPE_DESCRIPTION}")
    normalized_meal_type = _normalize_meal_type(body.meal_type)
    items_payload = [
        {
            **{
                "name": item.name,
                "weight": item.weight,
                "ratio": item.ratio,
                "intake": item.intake,
                "nutrients": {
                    "calories": item.nutrients.calories,
                    "protein": item.nutrients.protein,
                    "carbs": item.nutrients.carbs,
                    "fat": item.nutrients.fat,
                    "fiber": item.nutrients.fiber,
                    "sugar": item.nutrients.sugar,
                },
            },
            **({
                "manual_source": item.manual_source,
                "manual_source_id": item.manual_source_id,
                "manual_source_title": item.manual_source_title,
                "manual_portion_label": item.manual_portion_label,
            } if item.manual_source or item.manual_source_id or item.manual_source_title or item.manual_portion_label else {}),
        }
        for item in body.items
    ]
    try:
        row = await insert_food_record(
            user_id=user_id,
            meal_type=normalized_meal_type,
            image_path=body.image_path,
            image_paths=body.image_paths,
            description=body.description or "",
            insight=body.insight or "",
            items=items_payload,
            total_calories=body.total_calories,
            total_protein=body.total_protein,
            total_carbs=body.total_carbs,
            total_fat=body.total_fat,
            total_weight_grams=body.total_weight_grams,
            diet_goal=body.diet_goal,
            activity_timing=body.activity_timing,
            pfc_ratio_comment=body.pfc_ratio_comment,
            absorption_notes=body.absorption_notes,
            context_advice=body.context_advice,
            source_task_id=body.source_task_id,
        )
        # 后台预刷新 AI 营养洞察（周/月），不阻塞本次保存
        try:
            asyncio.create_task(_refresh_stats_insight_for_user(user_id))
        except Exception as bg_err:
            print(f"[save_food_record] 启动后台刷新 AI 洞察失败: {bg_err}")

        return {"id": row.get("id"), "message": "记录成功"}
    except Exception as e:
        print(f"[save_food_record] 错误: {e}")
        raise HTTPException(status_code=500, detail="保存记录失败")


@app.get("/api/food-record/list")
async def get_food_record_list(
    date: Optional[str] = None,
    user_info: dict = Depends(get_current_user_info),
):
    """
    获取当前用户饮食记录列表。可选按日期筛选（date=YYYY-MM-DD），不传则返回最近记录。
    若记录有 source_task_id 且无 image_paths，则从 analysis_tasks 补全 image_paths 供多图展示。
    """
    user_id = user_info["user_id"]
    try:
        records = await list_food_records(user_id=user_id, date=date, limit=100)
        # 补全多图：有 source_task_id 且 record 无 image_paths 时从任务表拉取
        task_ids = [
            r["source_task_id"]
            for r in records
            if r.get("source_task_id")
            and (not r.get("image_paths") or (isinstance(r.get("image_paths"), list) and len(r.get("image_paths") or []) == 0))
        ]
        if task_ids:
            tasks_map = await get_analysis_tasks_by_ids(list(set(task_ids)))
            for r in records:
                tid = r.get("source_task_id")
                if not tid or (r.get("image_paths") and isinstance(r.get("image_paths"), list) and len(r["image_paths"]) > 0):
                    continue
                task = tasks_map.get(tid)
                if task:
                    paths = task.get("image_paths")
                    if paths and isinstance(paths, list) and len(paths) > 0:
                        r["image_paths"] = list(paths)
                    elif task.get("image_url"):
                        r["image_paths"] = [task["image_url"]]
                    elif r.get("image_path"):
                        r["image_paths"] = [r["image_path"]]
        for r in records:
            r["meal_type"] = _normalize_meal_type(r.get("meal_type"), record_time=r.get("record_time"))
            _normalize_food_record_image_urls(r)
        return {"records": records}
    except Exception as e:
        print(f"[get_food_record_list] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取记录失败")


async def _hydrate_food_record_image_paths(record: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """单条记录多图补全：优先保留已有 image_paths，缺失时从来源分析任务补回。"""
    if not record:
        return record

    paths = record.get("image_paths")
    if isinstance(paths, list) and len(paths) > 0:
        return record

    source_task_id = record.get("source_task_id")
    if source_task_id:
        try:
            tasks_map = await get_analysis_tasks_by_ids([source_task_id])
            task = tasks_map.get(source_task_id)
            if task:
                task_paths = task.get("image_paths")
                if isinstance(task_paths, list) and len(task_paths) > 0:
                    record["image_paths"] = list(task_paths)
                    return record
                if task.get("image_url"):
                    record["image_paths"] = [task["image_url"]]
                    return record
        except Exception as hydrate_err:
            print(f"[_hydrate_food_record_image_paths] 补全 image_paths 失败: {hydrate_err}")

    if record.get("image_path"):
        record["image_paths"] = [record["image_path"]]
    return record


def _normalize_food_record_image_urls(record: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """把记录中的 image_path/image_paths 统一归一化为可访问 URL。"""
    if not record:
        return record

    candidates: List[str] = []
    raw_paths = record.get("image_paths")
    if isinstance(raw_paths, list):
        candidates.extend([item.strip() for item in raw_paths if isinstance(item, str) and item.strip()])
    raw_single = record.get("image_path")
    if not candidates and isinstance(raw_single, str) and raw_single.strip():
        candidates.append(raw_single.strip())

    normalized: List[str] = []
    seen = set()
    for item in candidates:
        url = resolve_reference_url(FOOD_IMAGES_BUCKET, item)
        if not url or url in seen:
            continue
        seen.add(url)
        normalized.append(url)

    if normalized:
        record["image_paths"] = normalized
        record["image_path"] = normalized[0]
    return record


@app.get("/api/food-record/{record_id}")
async def get_food_record_detail(
    record_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """
    获取单条饮食记录详情。需验证记录属于当前用户。
    """
    user_id = user_info["user_id"]
    try:
        record = await get_food_record_by_id(record_id)
        if not record:
            raise HTTPException(status_code=404, detail="记录不存在")
        # 验证权限：记录必须属于当前用户
        if record.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权访问此记录")
        record = await _hydrate_food_record_image_paths(record)
        record = _normalize_food_record_image_urls(record)
        record["meal_type"] = _normalize_meal_type(record.get("meal_type"), record_time=record.get("record_time"))
        return {"record": record}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[get_food_record_detail] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取记录详情失败")


class UpdateFoodRecordRequest(BaseModel):
    meal_type: Optional[str] = Field(default=None, description="餐次")
    items: Optional[List[FoodRecordItem]] = Field(default=None, description="食物项列表")
    total_calories: Optional[float] = Field(default=None, description="总热量 kcal")
    total_protein: Optional[float] = Field(default=None, description="总蛋白质 g")
    total_carbs: Optional[float] = Field(default=None, description="总碳水 g")
    total_fat: Optional[float] = Field(default=None, description="总脂肪 g")
    total_weight_grams: Optional[int] = Field(default=None, description="总重量 g")


@app.put("/api/food-record/{record_id}")
async def update_food_record_endpoint(
    record_id: str,
    body: UpdateFoodRecordRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """更新当前用户自己的饮食记录（修改食物参数、餐次等）。"""
    user_id = user_info["user_id"]
    data: Dict[str, Any] = {}
    if body.meal_type is not None:
        if body.meal_type not in VALID_MEAL_TYPES:
            raise HTTPException(status_code=400, detail=f"meal_type 必须为 {MEAL_TYPE_DESCRIPTION}")
        data["meal_type"] = _normalize_meal_type(body.meal_type)
    if body.items is not None:
        data["items"] = [
            {
                "name": item.name,
                "weight": item.weight,
                "ratio": item.ratio,
                "intake": item.intake,
                "nutrients": {
                    "calories": item.nutrients.calories,
                    "protein": item.nutrients.protein,
                    "carbs": item.nutrients.carbs,
                    "fat": item.nutrients.fat,
                    "fiber": item.nutrients.fiber,
                    "sugar": item.nutrients.sugar,
                },
            }
            for item in body.items
        ]
    if body.total_calories is not None:
        data["total_calories"] = body.total_calories
    if body.total_protein is not None:
        data["total_protein"] = body.total_protein
    if body.total_carbs is not None:
        data["total_carbs"] = body.total_carbs
    if body.total_fat is not None:
        data["total_fat"] = body.total_fat
    if body.total_weight_grams is not None:
        data["total_weight_grams"] = body.total_weight_grams
    if not data:
        raise HTTPException(status_code=400, detail="没有需要更新的字段")
    try:
        updated = await update_food_record(user_id=user_id, record_id=record_id, data=data)
        if not updated:
            raise HTTPException(status_code=404, detail="记录不存在或无权修改")
        return {"message": "更新成功", "record": updated}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[update_food_record] 错误: {e}")
        raise HTTPException(status_code=500, detail="更新记录失败")


@app.delete("/api/food-record/{record_id}")
async def delete_food_record_endpoint(
    record_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """删除当前用户自己的饮食记录。"""
    user_id = user_info["user_id"]
    try:
        deleted = await delete_food_record(user_id=user_id, record_id=record_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="记录不存在或无权删除")
        return {"message": "已删除"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[delete_food_record] 错误: {e}")
        raise HTTPException(status_code=500, detail="删除失败")


@app.get("/api/body-metrics/summary")
async def get_body_metrics_summary(
    range: str = "month",
    user_info: dict = Depends(get_current_user_info),
):
    """获取体重/喝水云端摘要，供首页与统计页复用。"""
    stats_range = range if range in ("week", "month") else "month"
    user_id = user_info["user_id"]
    try:
        start_date, end_date, _ = _resolve_stats_range_dates(stats_range)
        try:
            summary = await _build_body_metrics_summary(user_id=user_id, start_date=start_date, end_date=end_date)
        except Exception as body_metrics_error:
            print(f"[get_body_metrics_summary] 降级为空摘要: {body_metrics_error}")
            summary = _empty_body_metrics_summary(start_date=start_date, end_date=end_date)
        return {
            "range": stats_range,
            "start_date": start_date,
            "end_date": end_date,
            **summary,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[get_body_metrics_summary] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取身体指标摘要失败")


@app.post("/api/body-metrics/weight")
async def save_body_weight_record(
    body: BodyWeightUpsertRequest,
    user_info: dict = Depends(get_current_user_info),
):
    user_id = user_info["user_id"]
    recorded_on = _parse_date_string(body.date, "date") or datetime.now(CHINA_TZ).date().isoformat()
    source_type = _normalize_body_metric_source_type(body.source_type)
    client_id = (body.client_id or "").strip() or None
    try:
        row = await upsert_user_weight_record(
            user_id=user_id,
            recorded_on=recorded_on,
            weight_kg=body.value,
            source_type=source_type,
            client_record_id=client_id,
        )
        return {"message": "体重已保存", "item": _normalize_weight_entry(row)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[save_body_weight_record] 错误: {e}")
        raise HTTPException(status_code=500, detail="保存体重失败")


@app.post("/api/body-metrics/water")
async def save_body_water_log(
    body: BodyWaterLogRequest,
    user_info: dict = Depends(get_current_user_info),
):
    user_id = user_info["user_id"]
    recorded_on = _parse_date_string(body.date, "date") or datetime.now(CHINA_TZ).date().isoformat()
    source_type = _normalize_body_metric_source_type(body.source_type)
    try:
        row = await create_user_water_log(
            user_id=user_id,
            amount_ml=body.amount_ml,
            recorded_on=recorded_on,
            source_type=source_type,
        )
        return {
            "message": "喝水已记录",
            "item": {
                "id": row.get("id"),
                "date": str(row.get("recorded_on") or recorded_on),
                "amount_ml": int(row.get("amount_ml") or body.amount_ml),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[save_body_water_log] 错误: {e}")
        raise HTTPException(status_code=500, detail="保存喝水记录失败")


@app.post("/api/body-metrics/water/reset")
async def reset_body_water_logs(
    body: BodyWaterResetRequest,
    user_info: dict = Depends(get_current_user_info),
):
    user_id = user_info["user_id"]
    recorded_on = _parse_date_string(body.date, "date") or datetime.now(CHINA_TZ).date().isoformat()
    try:
        deleted_count = await delete_user_water_logs_by_date(user_id=user_id, recorded_on=recorded_on)
        return {"message": "已清空当日喝水记录", "deleted_count": deleted_count, "date": recorded_on}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[reset_body_water_logs] 错误: {e}")
        raise HTTPException(status_code=500, detail="清空喝水记录失败")


@app.post("/api/body-metrics/sync-local")
async def sync_local_body_metrics(
    body: BodyMetricsSyncRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """将旧首页本地体重/喝水记录幂等迁移到云端。"""
    user_id = user_info["user_id"]
    imported_weight_count = 0
    imported_water_count = 0

    try:
        if body.water_goal_ml is not None:
            await upsert_user_body_metric_settings(user_id=user_id, water_goal_ml=body.water_goal_ml)

        if body.weight_entries:
            weight_dates = sorted({
                entry.date for entry in body.weight_entries
                if _parse_date_string(entry.date, "weight_entries.date")
            })
            existing_weight_client_ids: Set[str] = set()
            existing_weight_pairs: Set[Tuple[str, float]] = set()
            if weight_dates:
                existing_weight_rows = await list_user_weight_records(
                    user_id=user_id,
                    start_date=weight_dates[0],
                    end_date=weight_dates[-1],
                )
                for row in existing_weight_rows:
                    date_key = str(row.get("recorded_on") or "")
                    try:
                        weight_value = round(float(row.get("weight_kg") or 0), 1)
                    except Exception:
                        weight_value = 0.0
                    existing_weight_pairs.add((date_key, weight_value))
                    client_record_id = str(row.get("client_record_id") or "").strip()
                    if client_record_id:
                        existing_weight_client_ids.add(client_record_id)

            def _weight_sync_sort_key(entry: BodyMetricsLocalWeightEntry) -> Tuple[str, str]:
                parsed = _parse_datetime(entry.recorded_at)
                return (
                    entry.date,
                    _build_json_datetime(parsed) if parsed else entry.date,
                )

            for entry in sorted(body.weight_entries, key=_weight_sync_sort_key):
                recorded_on = _parse_date_string(entry.date, "weight_entries.date")
                if not recorded_on:
                    continue
                client_id = (entry.client_id or "").strip() or _build_legacy_weight_client_id(recorded_on, entry.value)
                weight_value = round(float(entry.value), 1)
                if client_id in existing_weight_client_ids or (recorded_on, weight_value) in existing_weight_pairs:
                    continue
                recorded_at = _build_json_datetime(_parse_datetime(entry.recorded_at))
                await upsert_user_weight_record(
                    user_id=user_id,
                    recorded_on=recorded_on,
                    weight_kg=entry.value,
                    source_type="imported",
                    client_record_id=client_id,
                    recorded_at=recorded_at,
                )
                existing_weight_client_ids.add(client_id)
                existing_weight_pairs.add((recorded_on, weight_value))
                imported_weight_count += 1

        if body.water_by_date:
            water_dates = sorted({
                date_key for date_key in body.water_by_date.keys()
                if _parse_date_string(date_key, "water_by_date.key")
            })
            if water_dates:
                existing_water_logs = await list_user_water_logs(
                    user_id=user_id,
                    start_date=water_dates[0],
                    end_date=water_dates[-1],
                )
                existing_water_dates = {str(item.get("recorded_on") or "") for item in existing_water_logs}
                for date_key, day in body.water_by_date.items():
                    recorded_on = _parse_date_string(date_key, "water_by_date.key")
                    if not recorded_on or recorded_on in existing_water_dates:
                        continue
                    logs = [int(amount) for amount in day.logs if int(amount) > 0]
                    if not logs and int(day.total) > 0:
                        logs = [int(day.total)]
                    for amount in logs:
                        await create_user_water_log(
                            user_id=user_id,
                            amount_ml=amount,
                            recorded_on=recorded_on,
                            source_type="imported",
                        )
                        imported_water_count += 1

        return {
            "message": "本地身体指标已同步",
            "imported_weight_count": imported_weight_count,
            "imported_water_count": imported_water_count,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[sync_local_body_metrics] 错误: {e}")
        raise HTTPException(status_code=500, detail="同步本地身体指标失败")


@app.get("/api/expiry/dashboard")
async def get_food_expiry_dashboard(
    user_info: dict = Depends(get_current_user_info),
):
    """我的页保质期提醒摘要。"""
    user_id = user_info["user_id"]
    try:
        raw_items = await list_food_expiry_items_v2(user_id=user_id)
        today_local = datetime.now(CHINA_TZ)
        items = [_normalize_food_expiry_item(row, today_local=today_local) for row in raw_items]
        active_items = [item for item in items if item["status"] == "active"]
        urgency_rank = {"expired": 0, "today": 1, "soon": 2, "fresh": 3}
        active_items.sort(
            key=lambda item: (
                urgency_rank.get(item.get("urgency"), 9),
                item.get("days_until_expire") if item.get("days_until_expire") is not None else 9999,
                item.get("expire_date") or "9999-12-31",
            )
        )
        expired_count = sum(1 for item in active_items if item.get("urgency") == "expired")
        today_count = sum(1 for item in active_items if item.get("urgency") == "today")
        soon_count = sum(1 for item in active_items if item.get("urgency") == "soon")
        processed_count = sum(1 for item in items if item["status"] != "active")
        return {
            "active_count": len(active_items),
            "expired_count": expired_count,
            "today_count": today_count,
            "soon_count": soon_count,
            "processed_count": processed_count,
            "preview_items": active_items[:3],
        }
    except Exception as e:
        print(f"[get_food_expiry_dashboard] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取保质期摘要失败")


@app.post("/api/expiry/recognize")
async def recognize_food_expiry_items(
    body: FoodExpiryRecognitionRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """根据图片识别适合录入保质期的多个食物，并返回表单预填建议。"""
    user_id = user_info["user_id"]
    image_urls: List[str] = []
    for raw_url in body.image_urls:
        url = str(raw_url or "").strip()
        if not url:
            continue
        if url not in image_urls:
            image_urls.append(url)
    if not image_urls:
        raise HTTPException(status_code=400, detail="请至少提供 1 张图片")

    additional_context = str(body.additional_context or "").strip()
    user_row = await get_user_by_id(user_id)
    membership = await _get_effective_membership(user_id)
    membership_resp = _format_membership_response(membership)
    await _raise_if_food_analysis_credits_insufficient(
        user_id=user_id,
        user_row=user_row,
        membership=membership,
        membership_resp=membership_resp,
    )

    task = None
    try:
        task = await asyncio.to_thread(
            create_analysis_task_sync,
            user_id=user_id,
            task_type=_get_food_task_type("food"),
            image_url=image_urls[0],
            image_urls=image_urls,
            payload={
                "expiry_recognition": True,
                "recognize_mode": "food_expiry",
                "additional_context": additional_context or None,
            },
        )
        await asyncio.to_thread(
            update_analysis_task_result_sync,
            task_id=task["id"],
            status="processing",
        )

        recognized = await asyncio.to_thread(
            _recognize_food_expiry_from_images_sync,
            image_urls,
            today_local=datetime.now(CHINA_TZ),
            additional_context=additional_context,
        )
        result_payload = {
            "recognize_mode": "food_expiry",
            "items": recognized["items"],
        }
        await asyncio.to_thread(
            update_analysis_task_result_sync,
            task_id=task["id"],
            status="done",
            result=result_payload,
        )
        return {
            "task_id": task["id"],
            "credits_cost": CREDIT_COST_PER_FOOD_ANALYSIS,
            "items": recognized["items"],
            "message": f"已识别 {len(recognized['items'])} 项食物，可继续补充后保存",
        }
    except HTTPException:
        raise
    except Exception as e:
        if task and task.get("id"):
            try:
                await asyncio.to_thread(
                    update_analysis_task_result_sync,
                    task_id=task["id"],
                    status="failed",
                    error_message=str(e)[:300],
                )
            except Exception:
                pass
        print(f"[recognize_food_expiry_items] 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e) or "保质期识别失败")


@app.get("/api/expiry/items")
async def get_food_expiry_items(
    status: Optional[str] = None,
    user_info: dict = Depends(get_current_user_info),
):
    """获取当前用户的保质期条目。"""
    user_id = user_info["user_id"]
    try:
        normalized_status = _normalize_expiry_status(status) if status else None
        rows = await list_food_expiry_items_v2(user_id=user_id, status=normalized_status)
        today_local = datetime.now(CHINA_TZ)
        items = [_normalize_food_expiry_item(row, today_local=today_local) for row in rows]
        active_items = [item for item in items if item["status"] == "active"]
        processed_items = [item for item in items if item["status"] != "active"]
        urgency_rank = {"expired": 0, "today": 1, "soon": 2, "fresh": 3}
        active_items.sort(
            key=lambda item: (
                urgency_rank.get(item.get("urgency"), 9),
                item.get("days_until_expire") if item.get("days_until_expire") is not None else 9999,
                item.get("expire_date") or "9999-12-31",
            )
        )
        processed_items.sort(
            key=lambda item: item.get("updated_at") or item.get("created_at") or "",
            reverse=True,
        )
        return {"items": active_items + processed_items}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[get_food_expiry_items] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取保质期列表失败")


@app.get("/api/expiry/items/{item_id}")
async def get_food_expiry_item_detail(
    item_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    user_id = user_info["user_id"]
    try:
        row = await get_food_expiry_item_v2(user_id=user_id, item_id=item_id)
        if not row:
            raise HTTPException(status_code=404, detail="条目不存在")
        return {"item": _normalize_food_expiry_item(row)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[get_food_expiry_item_detail] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取详情失败")


@app.post("/api/expiry/items")
async def create_food_expiry_item_endpoint(
    body: FoodExpiryItemUpsertRequest,
    user_info: dict = Depends(get_current_user_info),
):
    user_id = user_info["user_id"]
    food_name = body.food_name.strip()
    if not food_name:
        raise HTTPException(status_code=400, detail="food_name 不能为空")

    expire_date = _parse_date_string(body.expire_date, "expire_date")
    opened_date = _parse_date_string(body.opened_date, "opened_date")
    if opened_date and expire_date and opened_date > expire_date:
        raise HTTPException(status_code=400, detail="opened_date 不能晚于 expire_date")

    payload = {
        "food_name": food_name,
        "category": (body.category or "").strip() or None,
        "storage_type": _normalize_expiry_storage_type(body.storage_type),
        "quantity_note": (body.quantity_note or "").strip() or None,
        "expire_date": expire_date,
        "opened_date": opened_date,
        "note": (body.note or "").strip() or None,
        "source_type": _normalize_expiry_source_type(body.source_type),
        "status": _normalize_expiry_status(body.status),
    }
    try:
        row = await create_food_expiry_item_v2(user_id=user_id, data=payload)
        return {"message": "创建成功", "item": _normalize_food_expiry_item(row)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[create_food_expiry_item_endpoint] 错误: {e}")
        raise HTTPException(status_code=500, detail="创建保质期条目失败")


@app.put("/api/expiry/items/{item_id}")
async def update_food_expiry_item_endpoint(
    item_id: str,
    body: FoodExpiryItemUpsertRequest,
    user_info: dict = Depends(get_current_user_info),
):
    user_id = user_info["user_id"]
    food_name = body.food_name.strip()
    if not food_name:
        raise HTTPException(status_code=400, detail="food_name 不能为空")

    expire_date = _parse_date_string(body.expire_date, "expire_date")
    opened_date = _parse_date_string(body.opened_date, "opened_date")
    if opened_date and expire_date and opened_date > expire_date:
        raise HTTPException(status_code=400, detail="opened_date 不能晚于 expire_date")

    payload = {
        "food_name": food_name,
        "category": (body.category or "").strip() or None,
        "storage_type": _normalize_expiry_storage_type(body.storage_type),
        "quantity_note": (body.quantity_note or "").strip() or None,
        "expire_date": expire_date,
        "opened_date": opened_date,
        "note": (body.note or "").strip() or None,
        "source_type": _normalize_expiry_source_type(body.source_type),
        "status": _normalize_expiry_status(body.status),
    }
    try:
        row = await update_food_expiry_item_v2(user_id=user_id, item_id=item_id, data=payload)
        if not row:
            raise HTTPException(status_code=404, detail="条目不存在")
        await _reconcile_food_expiry_notification_job(
            user_id=user_id,
            openid=user_info["openid"],
            item=_normalize_food_expiry_item(row),
            subscribed=True,
            allow_create=False,
        )
        return {"message": "更新成功", "item": _normalize_food_expiry_item(row)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[update_food_expiry_item_endpoint] 错误: {e}")
        raise HTTPException(status_code=500, detail="更新保质期条目失败")


@app.post("/api/expiry/items/{item_id}/status")
async def update_food_expiry_item_status_endpoint(
    item_id: str,
    body: FoodExpiryStatusUpdateRequest,
    user_info: dict = Depends(get_current_user_info),
):
    user_id = user_info["user_id"]
    status = _normalize_expiry_status(body.status)
    try:
        row = await update_food_expiry_item_v2(user_id=user_id, item_id=item_id, data={"status": status})
        if not row:
            raise HTTPException(status_code=404, detail="条目不存在")
        await _reconcile_food_expiry_notification_job(
            user_id=user_id,
            openid=user_info["openid"],
            item=_normalize_food_expiry_item(row),
            subscribed=status == "active",
            allow_create=False,
        )
        return {"message": "状态已更新", "item": _normalize_food_expiry_item(row)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[update_food_expiry_item_status_endpoint] 错误: {e}")
        raise HTTPException(status_code=500, detail="更新状态失败")


@app.post("/api/expiry/items/{item_id}/subscribe")
async def subscribe_food_expiry_item_endpoint(
    item_id: str,
    body: FoodExpirySubscribeRequest,
    user_info: dict = Depends(get_current_user_info),
):
    user_id = user_info["user_id"]
    openid = str(user_info.get("openid") or "").strip()
    if not openid:
        raise HTTPException(status_code=400, detail="当前用户缺少 openid，无法登记提醒")

    subscribe_status = _normalize_subscribe_status(body.subscribe_status)
    normalized_status = subscribe_status.lower()
    print(
        f"[subscribe_food_expiry_item_endpoint] user_id={user_id} item_id={item_id} "
        f"subscribe_status={subscribe_status or 'empty'} err_msg={body.err_msg or ''}"
    )

    try:
        row = await get_food_expiry_item_v2(user_id=user_id, item_id=item_id)
        if not row:
            raise HTTPException(status_code=404, detail="条目不存在")

        item = _normalize_food_expiry_item(row)
        if item["status"] != "active":
            await cancel_food_expiry_notification_jobs_by_item(item_id)
            return {
                "subscribed": False,
                "schedule_created": False,
                "status": subscribe_status,
                "scheduled_at": None,
                "message": "当前条目不是保鲜中状态，未登记提醒",
            }

        if normalized_status not in EXPIRY_SUBSCRIBE_ACCEPT_STATUSES:
            return {
                "subscribed": False,
                "schedule_created": False,
                "status": subscribe_status,
                "scheduled_at": None,
                "message": "用户未接受订阅提醒",
            }

        if not EXPIRY_NOTIFICATION_TEMPLATE_ID:
            raise HTTPException(status_code=500, detail="后端未配置保质期提醒模板 ID")

        job = await _reconcile_food_expiry_notification_job(
            user_id=user_id,
            openid=openid,
            item=item,
            subscribed=True,
            allow_create=True,
        )
        return {
            "subscribed": True,
            "schedule_created": bool(job),
            "status": subscribe_status,
            "scheduled_at": job.get("scheduled_at") if job else None,
            "message": "提醒任务已登记" if job else "当前不满足提醒条件，未登记任务",
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[subscribe_food_expiry_item_endpoint] 错误: {e}")
        raise HTTPException(status_code=500, detail="登记保质期提醒失败")


@app.get("/api/food-record/share/{record_id}")
async def get_shared_food_record(record_id: str):
    """
    公开分享接口，无需登录。用于别人通过分享链接查看饮食记录。
    若记录所有者关闭了「公开饮食记录」隐私设置，则返回 403。
    """
    try:
        record = await get_food_record_by_id(record_id)
        if not record:
            raise HTTPException(status_code=404, detail="记录不存在")
        # 检查记录所有者的隐私设置（public_records 默认为 True）
        owner_id = record.get("user_id")
        if owner_id:
            try:
                owner = await get_user_by_id(owner_id)
                # public_records 为 False 时才拒绝，None / True 均允许
                if owner and owner.get("public_records") is False:
                    raise HTTPException(status_code=403, detail="该用户已关闭饮食记录公开，无法查看")
            except HTTPException:
                raise
            except Exception:
                pass  # 查询用户失败时降级允许访问，避免阻断正常分享
        record = await _hydrate_food_record_image_paths(record)
        record["meal_type"] = _normalize_meal_type(record.get("meal_type"), record_time=record.get("record_time"))
        return {"record": record}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[get_shared_food_record] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取记录详情失败")


# ---------- 首页仪表盘（今日摄入 + 今日餐食，不含运动） ----------

DASHBOARD_DEFAULT_MACRO_TARGETS = {"protein": 120.0, "carbs": 250.0, "fat": 65.0}


def _get_dashboard_targets(user: Dict[str, Any]) -> Dict[str, float]:
    """从用户健康档案 JSON 中读取首页目标值，缺失时回退到默认值。"""
    health_condition = user.get("health_condition") or {}
    dashboard_targets = health_condition.get("dashboard_targets") or {}

    calorie_target = dashboard_targets.get("calorie_target")
    if calorie_target is None:
        calorie_target = (user.get("tdee") and float(user["tdee"])) or 2000

    return {
        "calorie_target": round(float(calorie_target or 2000), 1),
        "protein_target": round(float(dashboard_targets.get("protein_target") or DASHBOARD_DEFAULT_MACRO_TARGETS["protein"]), 1),
        "carbs_target": round(float(dashboard_targets.get("carbs_target") or DASHBOARD_DEFAULT_MACRO_TARGETS["carbs"]), 1),
        "fat_target": round(float(dashboard_targets.get("fat_target") or DASHBOARD_DEFAULT_MACRO_TARGETS["fat"]), 1),
    }


@app.get("/api/user/dashboard-targets")
async def get_dashboard_targets(user_info: dict = Depends(get_current_user_info)):
    """获取当前用户首页仪表盘目标值。"""
    user_id = user_info["user_id"]
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return _get_dashboard_targets(user)


@app.put("/api/user/dashboard-targets")
async def update_dashboard_targets(
    body: DashboardTargetsUpdateRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """更新当前用户首页仪表盘目标值，持久化到 health_condition.dashboard_targets。"""
    user_id = user_info["user_id"]
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    health_condition = dict(user.get("health_condition") or {})
    health_condition["dashboard_targets"] = {
        "calorie_target": round(float(body.calorie_target), 1),
        "protein_target": round(float(body.protein_target), 1),
        "carbs_target": round(float(body.carbs_target), 1),
        "fat_target": round(float(body.fat_target), 1),
    }

    try:
        updated = await update_user(user_id, {"health_condition": health_condition})
        return _get_dashboard_targets(updated)
    except Exception as e:
        print(f"[update_dashboard_targets] 错误: {e}")
        raise HTTPException(status_code=500, detail="更新首页目标失败")


@app.get("/api/home/dashboard")
async def get_home_dashboard(
    date: Optional[str] = None,
    user_info: dict = Depends(get_current_user_info)
):
    """
    首页数据：指定日期摄入汇总 + 各餐次汇总 + 当日运动消耗（千卡）。目标热量优先用用户 TDEE，否则 2000。

    参数:
        date: 指定日期 (YYYY-MM-DD 格式)，不传则默认今天
    """
    user_id = user_info["user_id"]
    target_date = date if date else _get_china_today_str()
    
    # 调试日志
    print(f"[DEBUG /api/home/dashboard] user_id={user_id}, date={date}")
    
    try:
        user = await get_user_by_id(user_id)
        print(f"[DEBUG /api/home/dashboard] user={user.get('nickname') if user else 'None'}")
        targets = _get_dashboard_targets(user)
        calorie_target = float(targets["calorie_target"])
        records = await list_food_records(user_id=user_id, date=target_date, limit=100)
        print(f"[DEBUG /api/home/dashboard] records count={len(records)}")
        expiry_rows = await list_food_expiry_items_v2(user_id=user_id, status="active")
        today_local = datetime.now(CHINA_TZ)
        expiry_items = [_normalize_food_expiry_item(row, today_local=today_local) for row in expiry_rows]
    except Exception as e:
        print(f"[get_home_dashboard] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取首页数据失败")

    # 今日总摄入
    total_cal = sum(float(r.get("total_calories") or 0) for r in records)
    total_protein = sum(float(r.get("total_protein") or 0) for r in records)
    total_carbs = sum(float(r.get("total_carbs") or 0) for r in records)
    total_fat = sum(float(r.get("total_fat") or 0) for r in records)
    
    print(f"[DEBUG /api/home/dashboard] 计算结果: cal={total_cal}, protein={total_protein}, carbs={total_carbs}, fat={total_fat}")

    protein_target = targets["protein_target"]
    carbs_target = targets["carbs_target"]
    fat_target = targets["fat_target"]
    progress = (total_cal / calorie_target * 100) if calorie_target else 0
    progress = min(100.0, round(progress, 1))

    intake_data = {
        "current": round(total_cal, 1),
        "target": round(calorie_target, 1),
        "progress": progress,
        "macros": {
            "protein": {"current": round(total_protein, 1), "target": protein_target},
            "carbs": {"current": round(total_carbs, 1), "target": carbs_target},
            "fat": {"current": round(total_fat, 1), "target": fat_target},
        },
    }

    # 按餐次聚合今日记录
    by_meal: Dict[str, List[dict]] = {}
    for r in records:
        mt = _normalize_meal_type(r.get("meal_type"), record_time=r.get("record_time"))
        if mt not in by_meal:
            by_meal[mt] = []
        by_meal[mt].append(r)

    meal_targets = _build_dashboard_meal_targets(calorie_target)
    meals_out = []
    for meal_type in MEAL_DISPLAY_ORDER:
        if meal_type not in by_meal:
            continue
        items = by_meal[meal_type]
        meal_cal = sum(float(x.get("total_calories") or 0) for x in items)
        meal_protein = sum(float(x.get("total_protein") or 0) for x in items)
        meal_carbs = sum(float(x.get("total_carbs") or 0) for x in items)
        meal_fat = sum(float(x.get("total_fat") or 0) for x in items)
        meal_target = meal_targets.get(meal_type, 0.0)
        meal_progress = (meal_cal / meal_target * 100) if meal_target else 0
        meal_progress = round(meal_progress, 1)
        meal_image_urls: List[str] = []
        seen_image_urls = set()
        for record in items:
            record_image_urls = record.get("image_paths") or []
            if not isinstance(record_image_urls, list):
                record_image_urls = []
            if not record_image_urls and record.get("image_path"):
                record_image_urls = [record.get("image_path")]
            for image_url in record_image_urls:
                if not isinstance(image_url, str):
                    continue
                image_url = image_url.strip()
                if not image_url:
                    continue
                image_url = resolve_reference_url(FOOD_IMAGES_BUCKET, image_url)
                if not image_url or image_url in seen_image_urls:
                    continue
                seen_image_urls.add(image_url)
                meal_image_urls.append(image_url)
        # 取该餐次最早一条记录的时间作为展示时间
        times = [x.get("record_time") for x in items if x.get("record_time")]
        time_str = "00:00"
        if times:
            time_str = _format_china_time_hhmm(times[0])
        # list_food_records 按 record_time 倒序；按餐聚合时同餐次内首条即该餐最新一条，供首页跳转记录详情/生成海报
        primary_record_id = None
        if items:
            for rec in items:
                rid = rec.get("id")
                if rid is not None and str(rid).strip() != "":
                    primary_record_id = str(rid)
                    break
        meals_out.append({
            "type": meal_type,
            "name": MEAL_NAMES.get(meal_type, meal_type),
            "time": time_str,
            "calorie": round(meal_cal, 1),
            "protein": round(meal_protein, 1),
            "carbs": round(meal_carbs, 1),
            "fat": round(meal_fat, 1),
            "target": meal_target,
            "progress": meal_progress,
            "tags": [SNACK_TARGET_TAG] if "snack" in meal_type else [],
            "image_path": meal_image_urls[0] if meal_image_urls else None,
            "image_paths": meal_image_urls,
            "primary_record_id": primary_record_id,
        })

    exercise_burned = await get_exercise_calories_by_date(user_id, target_date)

    return {
        "intakeData": intake_data,
        "meals": meals_out,
        "expirySummary": _build_food_expiry_summary(expiry_items),
        "exerciseBurnedKcal": round(float(exercise_burned), 1),
    }


@app.get("/api/exercise-calories/daily")
async def get_exercise_calories_daily(
    date: Optional[str] = Query(None, description="YYYY-MM-DD，不传则默认中国时区当天"),
    user_info: dict = Depends(get_current_user_info),
):
    """
    单日运动消耗汇总（千卡），数据来自 `user_exercise_logs`（与 migrate_exercise_logs_and_task_type.sql）。
    与 GET /api/home/dashboard 的 `exerciseBurnedKcal` 同源，便于单独调试或客户端兜底拉取。
    """
    user_id = user_info["user_id"]
    target_date = _parse_date_string(date, "date") if date else None
    if not target_date:
        target_date = datetime.now(CHINA_TZ).date().isoformat()
    total = await get_exercise_calories_by_date(user_id, target_date)
    return {"date": target_date, "total_calories_burned": int(total)}


# ---------- 数据统计（周/月摄入、TDEE、连续天数、饮食结构 + AI 洞察） ----------


async def _generate_nutrition_insight(
    user: Dict[str, Any],
    range_type: str,
    start_date: str,
    end_date: str,
    tdee: float,
    streak_days: int,
    total_calories: float,
    avg_calories_per_day: float,
    cal_surplus_deficit: float,
    total_protein: float,
    total_carbs: float,
    total_fat: float,
    by_meal: Dict[str, float],
    daily_list: List[Dict[str, Any]],
    macro_percent: Dict[str, float],
) -> str:
    """
    调用大模型生成个性化营养洞察（200-300 字）。
    使用 DashScope 千问 qwen-plus。
    """
    range_label = "近一周" if range_type == "week" else "近一月"
    health_summary = _format_health_profile_for_analysis(user) if user else ""
    diet_goal = user.get("diet_goal") or "none"
    diet_goal_label = {"fat_loss": "减脂", "muscle_gain": "增肌", "maintain": "维持体重", "none": "无"}.get(diet_goal, diet_goal)

    stats_str = f"""
统计周期：{range_label}（{start_date} 至 {end_date}）
用户 TDEE：{tdee:.0f} kcal/天
饮食目标：{diet_goal_label}

本期数据：
- 总热量：{total_calories:.0f} kcal
- 日均摄入：{avg_calories_per_day:.0f} kcal
- 日均与 TDEE 差值：{cal_surplus_deficit:+.0f} kcal（正为盈余，负为亏损）
- 连续记录天数：{streak_days} 天
- 餐次分布：早餐 {by_meal.get('breakfast', 0):.0f} kcal、早加餐 {by_meal.get('morning_snack', 0):.0f} kcal、午餐 {by_meal.get('lunch', 0):.0f} kcal、午加餐 {by_meal.get('afternoon_snack', 0):.0f} kcal、晚餐 {by_meal.get('dinner', 0):.0f} kcal、晚加餐 {by_meal.get('evening_snack', 0):.0f} kcal
- 宏量营养素占比：蛋白质 {macro_percent.get('protein', 0):.1f}%、碳水 {macro_percent.get('carbs', 0):.1f}%、脂肪 {macro_percent.get('fat', 0):.1f}%
- 总摄入：蛋白质 {total_protein:.1f}g、碳水 {total_carbs:.1f}g、脂肪 {total_fat:.1f}g
"""
    if daily_list:
        daily_trend = "、".join([f"{d['date'][5:]}({d['calories']:.0f})" for d in daily_list[-5:]])
        stats_str += f"- 每日热量趋势（最近5天）：{daily_trend}\n"

    prompt = f"""你是一位专业的营养师。请根据以下用户健康档案和饮食统计数据，生成一段 200-300 字的个性化营养洞察。

{health_summary}

{stats_str}

要求：
1. 用温暖、鼓励的语气，结合用户体质和饮食目标
2. 分析本期热量摄入与 TDEE 的关系，给出建议
3. 简要评价宏量营养素比例是否合理
4. 若有连续打卡，给予肯定
5. 输出纯中文，不要 JSON 或代码块，直接输出正文
"""
    dashscope_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not dashscope_key:
        return "本期日均摄入与 TDEE 接近，热量控制良好。请继续保持。"

    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_url = f"{base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            api_url,
            headers={
                "Authorization": f"Bearer {dashscope_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "qwen-plus",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.6,
            },
        )
        if not response.is_success:
            error_data = response.json() if response.content else {}
            raise Exception(error_data.get("error", {}).get("message") or f"DashScope API 错误: {response.status_code}")
        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not content or not content.strip():
            raise Exception("千问返回了空响应")
        return content.strip()


@app.get("/api/stats/summary")
async def get_stats_summary(
    range: str = "week",
    user_info: dict = Depends(get_current_user_info),
):
    """
    数据统计：按周(week)或月(month)汇总摄入、与 TDEE 对比、连续记录天数、饮食结构（按餐次与宏量），并给出简单分析。
    """
    if range not in ("week", "month"):
        range = "week"
    user_id = user_info["user_id"]
    start_date, end_date, now = _resolve_stats_range_dates(range)
    start_d = datetime.strptime(start_date, "%Y-%m-%d").date()
    today = end_date
    print(f"[get_stats_summary] Range: {range}, Start: {start_date}, End: {end_date}, User: {user_id}")
    try:
        user = await get_user_by_id(user_id)
        tdee = (user.get("tdee") and float(user["tdee"])) or 2000
        records = await list_food_records_by_range(user_id=user_id, start_date=start_date, end_date=end_date)
        print(f"[get_stats_summary] Records found: {len(records)}")
        if records:
            print(f"[get_stats_summary] First record time: {records[0].get('record_time')} type: {type(records[0].get('record_time'))}")
        streak_days = await get_streak_days(user_id)
    except Exception as e:
        print(f"[get_stats_summary] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取统计失败")

    try:
        body_metrics_summary = await _build_body_metrics_summary(user_id=user_id, start_date=start_date, end_date=end_date)
        print(f"[get_stats_summary] body_metrics_summary: {body_metrics_summary}")
    except Exception as body_metrics_error:
        print(f"[get_stats_summary] 身体指标降级为空摘要: {body_metrics_error}")
        body_metrics_summary = _empty_body_metrics_summary(start_date=start_date, end_date=end_date)

    total_cal = sum(float(r.get("total_calories") or 0) for r in records)
    total_protein = sum(float(r.get("total_protein") or 0) for r in records)
    total_carbs = sum(float(r.get("total_carbs") or 0) for r in records)
    total_fat = sum(float(r.get("total_fat") or 0) for r in records)
    by_meal_out = _build_by_meal_calories(records)

    daily_cal: Dict[str, float] = {}
    for r in records:
        rt = r.get("record_time")
        if rt:
            try:
                # record_time 存的是 UTC 时间戳，这里转换为中国时区的自然日
                dt_utc = datetime.fromisoformat(str(rt).replace("Z", "+00:00"))
                dt_local = dt_utc.astimezone(CHINA_TZ)
                dt_str = dt_local.date().isoformat()
                daily_cal[dt_str] = daily_cal.get(dt_str, 0) + float(r.get("total_calories") or 0)
            except Exception as e:
                print(f"[get_stats_summary] Date parse error for {rt}: {e}")
                pass
    full_daily_list = []
    cursor = start_d
    end_day = now.date()
    while cursor <= end_day:
        date_key = cursor.isoformat()
        full_daily_list.append({"date": date_key, "calories": round(daily_cal.get(date_key, 0.0), 1)})
        cursor += timedelta(days=1)
    daily_list = full_daily_list
    print(f"[get_stats_summary] Daily list: {daily_list}")

    recorded_days = len(daily_cal)
    avg_cal_per_day = round(total_cal / recorded_days, 1) if recorded_days > 0 else 0
    cal_surplus_deficit = round(avg_cal_per_day - tdee, 1)

    total_macros = total_protein * 4 + total_carbs * 4 + total_fat * 9
    if total_macros <= 0:
        pct_p, pct_c, pct_f = 0, 0, 0
    else:
        pct_p = round(total_protein * 4 / total_macros * 100, 1)
        pct_c = round(total_carbs * 4 / total_macros * 100, 1)
        pct_f = round(total_fat * 9 / total_macros * 100, 1)

    # 只读缓存：不在该接口内调用大模型，避免统计接口超时
    data_fingerprint = f"{total_cal:.0f}_{avg_cal_per_day:.1f}_{recorded_days}_{pct_p}_{pct_c}_{pct_f}"
    cached = await get_cached_insight(user_id, range, today)
    if not cached:
        cached = await get_latest_cached_insight(user_id, range)

    analysis_summary = ""
    analysis_summary_generated_date = None
    analysis_summary_needs_refresh = False
    if cached:
        analysis_summary = cached.get("insight_text", "") or ""
        analysis_summary_generated_date = cached.get("generated_date")
        analysis_summary_needs_refresh = (
            cached.get("generated_date") != today
            or cached.get("data_fingerprint") != data_fingerprint
        )

    return {
        "range": range,
        "start_date": start_date,
        "end_date": end_date,
        "tdee": int(tdee),
        "streak_days": streak_days,
        "total_calories": round(total_cal, 1),
        "avg_calories_per_day": avg_cal_per_day,
        "cal_surplus_deficit": cal_surplus_deficit,
        "total_protein": round(total_protein, 1),
        "total_carbs": round(total_carbs, 1),
        "total_fat": round(total_fat, 1),
        "by_meal": by_meal_out,
        "daily_calories": daily_list,
        "macro_percent": {"protein": pct_p, "carbs": pct_c, "fat": pct_f},
        "analysis_summary": analysis_summary,
        "analysis_summary_generated_date": analysis_summary_generated_date,
        "analysis_summary_needs_refresh": analysis_summary_needs_refresh,
        "body_metrics": body_metrics_summary,
    }


class StatsInsightGenerateRequest(BaseModel):
    range: str = Field(default="week", description="统计范围: week 或 month")


class StatsInsightSaveRequest(BaseModel):
    range: str = Field(default="week", description="统计范围: week 或 month")
    analysis_summary: str = Field(..., description="完整的 AI 营养洞察文本")


@app.post("/api/stats/insight/generate")
async def generate_stats_insight(
    body: StatsInsightGenerateRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    生成当前周期的 AI 营养洞察（只调用大模型，不落库）。
    前端拿到完整文本后，本地打字展示，再调用 save 接口保存。
    """
    stats_range = body.range if body.range in ("week", "month") else "week"
    user_id = user_info["user_id"]
    now = datetime.now(CHINA_TZ)
    today = now.strftime("%Y-%m-%d")
    if stats_range == "week":
        start_d = (now - timedelta(days=6)).date()
    else:
        start_d = (now - timedelta(days=29)).date()
    start_date = start_d.strftime("%Y-%m-%d")
    end_date = today

    try:
        user = await get_user_by_id(user_id)
        tdee = (user.get("tdee") and float(user["tdee"])) or 2000
        records = await list_food_records_by_range(user_id=user_id, start_date=start_date, end_date=end_date)
        streak_days = await get_streak_days(user_id)
    except Exception as e:
        print(f"[generate_stats_insight] 准备数据失败: {e}")
        raise HTTPException(status_code=500, detail="生成 AI 洞察失败")

    total_cal = sum(float(r.get("total_calories") or 0) for r in records)
    total_protein = sum(float(r.get("total_protein") or 0) for r in records)
    total_carbs = sum(float(r.get("total_carbs") or 0) for r in records)
    total_fat = sum(float(r.get("total_fat") or 0) for r in records)

    by_meal_out = _build_by_meal_calories(records)

    daily_cal: Dict[str, float] = {}
    for r in records:
        rt = r.get("record_time")
        if rt:
            try:
                dt_utc = datetime.fromisoformat(str(rt).replace("Z", "+00:00"))
                dt_local = dt_utc.astimezone(CHINA_TZ)
                dt_str = dt_local.date().isoformat()
                daily_cal[dt_str] = daily_cal.get(dt_str, 0) + float(r.get("total_calories") or 0)
            except Exception as e:
                print(f"[generate_stats_insight] Date parse error for {rt}: {e}")
                pass
    daily_list = [{"date": d, "calories": round(c, 1)} for d, c in sorted(daily_cal.items())]

    recorded_days = len(daily_cal)
    avg_cal_per_day = round(total_cal / recorded_days, 1) if recorded_days > 0 else 0
    cal_surplus_deficit = round(avg_cal_per_day - tdee, 1)

    total_macros = total_protein * 4 + total_carbs * 4 + total_fat * 9
    if total_macros <= 0:
        pct_p, pct_c, pct_f = 0, 0, 0
    else:
        pct_p = round(total_protein * 4 / total_macros * 100, 1)
        pct_c = round(total_carbs * 4 / total_macros * 100, 1)
        pct_f = round(total_fat * 9 / total_macros * 100, 1)

    try:
        insight = await _generate_nutrition_insight(
            user=user,
            range_type=stats_range,
            start_date=start_date,
            end_date=end_date,
            tdee=tdee,
            streak_days=streak_days,
            total_calories=total_cal,
            avg_calories_per_day=avg_cal_per_day,
            cal_surplus_deficit=cal_surplus_deficit,
            total_protein=total_protein,
            total_carbs=total_carbs,
            total_fat=total_fat,
            by_meal=by_meal_out,
            daily_list=daily_list,
            macro_percent={"protein": pct_p, "carbs": pct_c, "fat": pct_f},
        )
        return {"analysis_summary": insight}
    except Exception as e:
        print(f"[generate_stats_insight] AI 生成失败: {e}")
        raise HTTPException(status_code=500, detail="AI 洞察生成失败，请稍后重试")


@app.post("/api/stats/insight/save")
async def save_stats_insight(
    body: StatsInsightSaveRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    保存前端完整的 AI 洞察文本到缓存表。
    会基于当前数据重新计算指纹，确保与统计数据一致。
    """
    stats_range = body.range if body.range in ("week", "month") else "week"
    text = (body.analysis_summary or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="analysis_summary 不能为空")

    user_id = user_info["user_id"]
    now = datetime.now(CHINA_TZ)
    today = now.strftime("%Y-%m-%d")
    if stats_range == "week":
        start_d = (now - timedelta(days=6)).date()
    else:
        start_d = (now - timedelta(days=29)).date()
    start_date = start_d.strftime("%Y-%m-%d")
    end_date = today

    try:
        records = await list_food_records_by_range(user_id=user_id, start_date=start_date, end_date=end_date)
    except Exception as e:
        print(f"[save_stats_insight] 获取记录失败: {e}")
        raise HTTPException(status_code=500, detail="保存失败")

    total_cal = sum(float(r.get("total_calories") or 0) for r in records)
    total_protein = sum(float(r.get("total_protein") or 0) for r in records)
    total_carbs = sum(float(r.get("total_carbs") or 0) for r in records)
    total_fat = sum(float(r.get("total_fat") or 0) for r in records)

    daily_cal: Dict[str, float] = {}
    for r in records:
        rt = r.get("record_time")
        if rt:
            try:
                dt_utc = datetime.fromisoformat(str(rt).replace("Z", "+00:00"))
                dt_local = dt_utc.astimezone(CHINA_TZ)
                dt_str = dt_local.date().isoformat()
                daily_cal[dt_str] = daily_cal.get(dt_str, 0) + float(r.get("total_calories") or 0)
            except Exception as e:
                print(f"[save_stats_insight] Date parse error for {rt}: {e}")
                pass

    recorded_days = len(daily_cal)
    avg_cal_per_day = round(total_cal / recorded_days, 1) if recorded_days > 0 else 0

    total_macros = total_protein * 4 + total_carbs * 4 + total_fat * 9
    if total_macros <= 0:
        pct_p, pct_c, pct_f = 0, 0, 0
    else:
        pct_p = round(total_protein * 4 / total_macros * 100, 1)
        pct_c = round(total_carbs * 4 / total_macros * 100, 1)
        pct_f = round(total_fat * 9 / total_macros * 100, 1)

    data_fingerprint = f"{total_cal:.0f}_{avg_cal_per_day:.1f}_{recorded_days}_{pct_p}_{pct_c}_{pct_f}"

    try:
        await upsert_insight_cache(user_id, stats_range, today, data_fingerprint, text)
        return {"message": "ok"}
    except Exception as e:
        print(f"[save_stats_insight] 缓存写入失败: {e}")
        raise HTTPException(status_code=500, detail="保存失败")


async def _refresh_stats_insight_for_user(user_id: str) -> None:
    """
    后台刷新指定用户的 AI 营养洞察缓存（周 + 月）。
    在保存记录成功后调用，将耗时从「看统计页」前移到「记完餐」之后。
    为控制成本：同一用户同一 range 每天最多生成一次（按 generated_date=today 判断）。
    """
    now = datetime.now(CHINA_TZ)
    today = now.strftime("%Y-%m-%d")
    try:
        user = await get_user_by_id(user_id)
        if not user:
            return
        tdee = (user.get("tdee") and float(user["tdee"])) or 2000
    except Exception as e:
        print(f"[_refresh_stats_insight_for_user] 获取用户信息失败: {e}")
        return

    for stats_range in ("week", "month"):
        try:
            # 如果今天已经为该范围生成过洞察，则跳过，避免一天多次调用模型
            existing = await get_cached_insight(user_id, stats_range, today)
            if existing:
                continue

            if stats_range == "week":
                start_d = (now - timedelta(days=6)).date()
            else:
                start_d = (now - timedelta(days=29)).date()
            start_date = start_d.strftime("%Y-%m-%d")
            end_date = today

            records = await list_food_records_by_range(
                user_id=user_id,
                start_date=start_date,
                end_date=end_date,
            )
            if not records:
                continue

            total_cal = sum(float(r.get("total_calories") or 0) for r in records)
            total_protein = sum(float(r.get("total_protein") or 0) for r in records)
            total_carbs = sum(float(r.get("total_carbs") or 0) for r in records)
            total_fat = sum(float(r.get("total_fat") or 0) for r in records)

            by_meal_out = _build_by_meal_calories(records)

            daily_cal: Dict[str, float] = {}
            for r in records:
                rt = r.get("record_time")
                if rt:
                    try:
                        dt_utc = datetime.fromisoformat(str(rt).replace("Z", "+00:00"))
                        dt_local = dt_utc.astimezone(CHINA_TZ)
                        dt_str = dt_local.date().isoformat()
                        daily_cal[dt_str] = daily_cal.get(dt_str, 0) + float(r.get("total_calories") or 0)
                    except Exception as e:
                        print(f"[_refresh_stats_insight_for_user] Date parse error for {rt}: {e}")
                        pass

            recorded_days = len(daily_cal)
            if recorded_days <= 0:
                continue

            avg_cal_per_day = round(total_cal / recorded_days, 1)
            cal_surplus_deficit = round(avg_cal_per_day - tdee, 1)

            total_macros = total_protein * 4 + total_carbs * 4 + total_fat * 9
            if total_macros <= 0:
                pct_p, pct_c, pct_f = 0, 0, 0
            else:
                pct_p = round(total_protein * 4 / total_macros * 100, 1)
                pct_c = round(total_carbs * 4 / total_macros * 100, 1)
                pct_f = round(total_fat * 9 / total_macros * 100, 1)

            # 若 fingerprint 与已有缓存相同，可跳过生成；此处已确认 today 无缓存，直接生成即可
            try:
                insight = await _generate_nutrition_insight(
                    user=user,
                    range_type=stats_range,
                    start_date=start_date,
                    end_date=end_date,
                    tdee=tdee,
                    streak_days=await get_streak_days(user_id),
                    total_calories=total_cal,
                    avg_calories_per_day=avg_cal_per_day,
                    cal_surplus_deficit=cal_surplus_deficit,
                    total_protein=total_protein,
                    total_carbs=total_carbs,
                    total_fat=total_fat,
                    by_meal=by_meal_out,
                    daily_list=[{"date": d, "calories": round(c, 1)} for d, c in sorted(daily_cal.items())],
                    macro_percent={"protein": pct_p, "carbs": pct_c, "fat": pct_f},
                )
                data_fingerprint = f"{total_cal:.0f}_{avg_cal_per_day:.1f}_{recorded_days}_{pct_p}_{pct_c}_{pct_f}"
                await upsert_insight_cache(user_id, stats_range, today, data_fingerprint, insight)
            except Exception as e:
                print(f"[_refresh_stats_insight_for_user] 生成 {stats_range} 洞察失败: {e}")
                continue
        except Exception as e:
            print(f"[_refresh_stats_insight_for_user] 处理 {stats_range} 失败: {e}")
            continue


@app.websocket("/ws/stats/insight")
async def ws_stats_insight(websocket: WebSocket):
    """
    WebSocket：实时推送 AI 营养洞察内容（按小段文本流式输出）。

    前端需在 query 参数中传入：
    - range: week | month
    - user_id: 当前用户 ID（前端从本地存储读取）
    """
    await websocket.accept()
    try:
        params = websocket.query_params
        stats_range = params.get("range", "week")
        if stats_range not in ("week", "month"):
            stats_range = "week"
        user_id = params.get("user_id")
        if not user_id:
            await websocket.close(code=1008)
            return

        now = datetime.now(CHINA_TZ)
        today = now.strftime("%Y-%m-%d")
        if stats_range == "week":
            start_d = (now - timedelta(days=6)).date()
        else:
            start_d = (now - timedelta(days=29)).date()
        start_date = start_d.strftime("%Y-%m-%d")
        end_date = today

        # 准备统计数据（与 generate_stats_insight 相同）
        user = await get_user_by_id(user_id)
        tdee = (user.get("tdee") and float(user["tdee"])) or 2000
        records = await list_food_records_by_range(user_id=user_id, start_date=start_date, end_date=end_date)
        streak_days = await get_streak_days(user_id)

        total_cal = sum(float(r.get("total_calories") or 0) for r in records)
        total_protein = sum(float(r.get("total_protein") or 0) for r in records)
        total_carbs = sum(float(r.get("total_carbs") or 0) for r in records)
        total_fat = sum(float(r.get("total_fat") or 0) for r in records)

        by_meal_out = _build_by_meal_calories(records)

        daily_cal: Dict[str, float] = {}
        for r in records:
            rt = r.get("record_time")
            if rt:
                try:
                    dt_utc = datetime.fromisoformat(str(rt).replace("Z", "+00:00"))
                    dt_local = dt_utc.astimezone(CHINA_TZ)
                    dt_str = dt_local.date().isoformat()
                    daily_cal[dt_str] = daily_cal.get(dt_str, 0) + float(r.get("total_calories") or 0)
                except Exception as e:
                    print(f"[ws_stats_insight] Date parse error for {rt}: {e}")
                    pass
        daily_list = [{"date": d, "calories": round(c, 1)} for d, c in sorted(daily_cal.items())]

        recorded_days = len(daily_cal)
        avg_cal_per_day = round(total_cal / recorded_days, 1) if recorded_days > 0 else 0
        cal_surplus_deficit = round(avg_cal_per_day - tdee, 1)

        total_macros = total_protein * 4 + total_carbs * 4 + total_fat * 9
        if total_macros <= 0:
            pct_p, pct_c, pct_f = 0, 0, 0
        else:
            pct_p = round(total_protein * 4 / total_macros * 100, 1)
            pct_c = round(total_carbs * 4 / total_macros * 100, 1)
            pct_f = round(total_fat * 9 / total_macros * 100, 1)

        # 调用大模型生成完整洞察文本
        insight = await _generate_nutrition_insight(
            user=user,
            range_type=stats_range,
            start_date=start_date,
            end_date=end_date,
            tdee=tdee,
            streak_days=streak_days,
            total_calories=total_cal,
            avg_calories_per_day=avg_cal_per_day,
            cal_surplus_deficit=cal_surplus_deficit,
            total_protein=total_protein,
            total_carbs=total_carbs,
            total_fat=total_fat,
            by_meal=by_meal_out,
            daily_list=daily_list,
            macro_percent={"protein": pct_p, "carbs": pct_c, "fat": pct_f},
        )

        # 以小块文本流式发给前端（前端负责汇总完整文本并保存）
        chunk_size = 8
        for i in range(0, len(insight), chunk_size):
            await websocket.send_text(insight[i:i + chunk_size])
            await asyncio.sleep(0.04)

        await websocket.close()
    except WebSocketDisconnect:
        print("[ws_stats_insight] 客户端断开连接")
    except Exception as e:
        print(f"[ws_stats_insight] 错误: {e}")
        try:
            await websocket.close(code=1011)
        except Exception:
            pass


# ---------- 好友与圈子 ----------

@app.get("/api/friend/search")
async def api_friend_search(
    nickname: Optional[str] = None,
    telephone: Optional[str] = None,
    user_info: dict = Depends(get_current_user_info),
):
    """搜索用户（昵称模糊 / 手机号精确），排除自己、已是好友、已发过待处理请求的。返回 id, nickname, avatar。"""
    if not nickname and not telephone:
        return {"list": []}
    try:
        users = await search_users(
            current_user_id=user_info["user_id"],
            nickname=nickname.strip() if nickname else None,
            telephone=telephone.strip() if telephone else None,
            limit=20,
        )
        return {"list": users}
    except Exception as e:
        print(f"[api/friend/search] 错误: {e}")
        raise HTTPException(status_code=500, detail="搜索失败")


@app.post("/api/friend/request")
async def api_friend_request(
    body: dict,
    user_info: dict = Depends(get_current_user_info),
):
    """发送好友请求。body: { "to_user_id": "uuid" }"""
    to_user_id = body.get("to_user_id")
    if not to_user_id:
        raise HTTPException(status_code=400, detail="缺少 to_user_id")
    try:
        await send_friend_request(user_info["user_id"], to_user_id)
        return {"message": "已发送好友请求"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[api/friend/request] 错误: {e}")
        raise HTTPException(status_code=500, detail="发送失败")


@app.get("/api/friend/requests")
async def api_friend_requests(user_info: dict = Depends(get_current_user_info)):
    """收到的待处理好友请求列表"""
    try:
        rows = await get_friend_requests_received(user_info["user_id"])
        return {"list": rows}
    except Exception as e:
        print(f"[api/friend/requests] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取失败")


@app.post("/api/friend/request/{request_id}/respond")
async def api_friend_respond(
    request_id: str,
    body: dict,
    user_info: dict = Depends(get_current_user_info),
):
    """处理好友请求。body: { "action": "accept" | "reject" }"""
    action = body.get("action")
    if action not in ("accept", "reject"):
        raise HTTPException(status_code=400, detail="action 须为 accept 或 reject")
    try:
        await respond_friend_request(request_id, user_info["user_id"], action == "accept")
        return {"message": "已接受" if action == "accept" else "已拒绝"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[api/friend/respond] 错误: {e}")
        raise HTTPException(status_code=500, detail="操作失败")


@app.delete("/api/friend/request/{request_id}")
async def api_friend_request_cancel(
    request_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """撤销本人发出的、对方尚未处理的待处理好友请求。"""
    try:
        await cancel_sent_friend_request(request_id, user_info["user_id"])
        return {"message": "已撤销好友请求"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[api/friend/request/cancel] 错误: {e}")
        raise HTTPException(status_code=500, detail="撤销失败")


@app.get("/api/friend/list")
async def api_friend_list(user_info: dict = Depends(get_current_user_info)):
    """好友列表"""
    try:
        friends = await get_friends_with_profile(user_info["user_id"])
        return {"list": friends}
    except Exception as e:
        print(f"[api/friend/list] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取失败")


@app.delete("/api/friend/{friend_id}")
async def api_friend_delete(
    friend_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """删除好友（双向删除）。"""
    try:
        current_user_id = user_info["user_id"]
        if friend_id == current_user_id:
            raise HTTPException(status_code=400, detail="不能删除自己")
        result = await delete_friend_pair(current_user_id, friend_id)
        if result.get("deleted", 0) <= 0:
            raise HTTPException(status_code=404, detail="好友关系不存在")
        return {"message": "已删除好友", **result}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/friend/delete] 错误: {e}")
        raise HTTPException(status_code=500, detail="删除好友失败")


@app.get("/api/friend/requests/all")
async def api_friend_requests_overview(user_info: dict = Depends(get_current_user_info)):
    """好友请求总览（收到 + 发出，含 pending/accepted/rejected）。"""
    try:
        return await get_friend_requests_overview(user_info["user_id"])
    except Exception as e:
        print(f"[api/friend/requests/all] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取失败")


@app.post("/api/friend/cleanup-duplicates")
async def api_friend_cleanup_duplicates(user_info: dict = Depends(get_current_user_info)):
    """清理当前用户的重复好友记录"""
    try:
        result = await cleanup_duplicate_friends(user_info["user_id"])
        return result
    except Exception as e:
        print(f"[api/friend/cleanup-duplicates] 错误: {e}")
        raise HTTPException(status_code=500, detail="清理失败")


@app.get("/api/friend/invite/profile/{user_id}")
async def api_friend_invite_profile(user_id: str):
    """公开获取邀请资料（昵称、头像、邀请码），用于分享页和海报展示。"""
    try:
        user = await get_user_by_id(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        return {
            "user_id": user["id"],
            "nickname": user.get("nickname") or "用户",
            "avatar": user.get("avatar") or "",
            "invite_code": build_friend_invite_code(user["id"]),
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/friend/invite/profile] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取邀请信息失败")


@app.get("/api/friend/invite/resolve")
async def api_friend_invite_resolve(
    code: str,
    user_info: dict = Depends(get_current_user_info),
):
    """登录后解析邀请码，返回邀请人资料与当前好友状态。"""
    try:
        inviter = await resolve_user_by_friend_invite_code(code)
        if not inviter:
            raise HTTPException(status_code=404, detail="邀请码无效")
        current_user_id = user_info["user_id"]
        inviter_id = inviter["id"]
        if inviter_id == current_user_id:
            return {
                "user_id": inviter_id,
                "nickname": inviter.get("nickname") or "用户",
                "avatar": inviter.get("avatar") or "",
                "already_friend": False,
                "is_self": True,
            }
        already_friend = await is_friend(current_user_id, inviter_id)
        return {
            "user_id": inviter_id,
            "nickname": inviter.get("nickname") or "用户",
            "avatar": inviter.get("avatar") or "",
            "already_friend": already_friend,
            "is_self": False,
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[api/friend/invite/resolve] 错误: {e}")
        raise HTTPException(status_code=500, detail="解析邀请码失败")


class FriendInviteAcceptRequest(BaseModel):
    code: str = Field(..., description="短邀请码（通常 8 位）")


@app.post("/api/friend/invite/accept")
async def api_friend_invite_accept(
    body: FriendInviteAcceptRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """通过邀请码发起好友申请（需对方同意后才会成为好友）。"""
    try:
        inviter = await resolve_user_by_friend_invite_code(body.code)
        if not inviter:
            raise HTTPException(status_code=404, detail="邀请码无效")
        current_user_id = user_info["user_id"]
        inviter_id = inviter["id"]
        if inviter_id == current_user_id:
            raise HTTPException(status_code=400, detail="不能添加自己为好友")

        if await is_friend(current_user_id, inviter_id):
            return {
                "status": "already_friend",
                "user_id": inviter_id,
                "nickname": inviter.get("nickname") or "用户",
                "avatar": inviter.get("avatar") or "",
            }

        # 仅发起申请，不直接建立好友关系，必须由分享者在请求列表中同意。
        request_row = await send_friend_request(current_user_id, inviter_id)
        try:
            await create_invite_referral_binding(
                inviter_user_id=inviter_id,
                invitee_user_id=current_user_id,
                invite_code=body.code,
                source_request_id=request_row.get("id") if isinstance(request_row, dict) else None,
            )
        except Exception as reward_err:
            print(f"[api/friend/invite/accept] 创建邀请奖励关系失败（已忽略）: {reward_err}")
        return {
            "status": "request_sent",
            "user_id": inviter_id,
            "nickname": inviter.get("nickname") or "用户",
            "avatar": inviter.get("avatar") or "",
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[api/friend/invite/accept] 错误: {e}")
        raise HTTPException(status_code=500, detail="添加好友失败")

class CommunityCommentCreateRequest(BaseModel):
    content: str = Field(..., description="评论内容")
    parent_comment_id: Optional[str] = Field(default=None, description="被回复的父评论 ID")
    reply_to_user_id: Optional[str] = Field(default=None, description="被回复用户 ID")


class MarkFeedNotificationsReadRequest(BaseModel):
    notification_ids: Optional[List[str]] = Field(default=None, description="可选，指定要标记已读的通知 ID 列表")


async def _ensure_feed_record_interactable(user_id: str, record_id: str) -> Dict[str, Any]:
    context = await get_feed_record_interaction_context(user_id, record_id)
    if not context.get("record"):
        raise HTTPException(status_code=404, detail="动态不存在")
    if not context.get("allowed"):
        raise HTTPException(status_code=403, detail="无权操作该动态")
    return context["record"]


@app.get("/api/community/public-feed")
async def api_community_public_feed(
    offset: int = 0,
    limit: int = 20,
    include_comments: bool = True,
    comments_limit: int = 5,
    meal_type: Optional[str] = None,
    diet_goal: Optional[str] = None,
    sort_by: str = "recommended",
):
    """
    公共 Feed：无需登录，返回 public_records=true 的用户的饮食记录。
    带点赞数和评论列表（不含 liked / is_mine）。
    """
    try:
        items = await list_public_feed_records(
            offset=offset,
            limit=limit,
            include_comments=include_comments,
            comments_limit=comments_limit,
            meal_type=meal_type,
            diet_goal=diet_goal,
            sort_by=sort_by,
        )

        out = []
        for item in items:
            rec = item["record"]
            feed_item: dict = {
                "record": rec,
                "author": item["author"],
                "like_count": item.get("like_count", 0),
                "liked": False,
                "is_mine": False,
                "recommend_reason": item.get("recommend_reason"),
            }
            if include_comments:
                comments = item.get("comments", [])
                feed_item["comments"] = comments
                feed_item["comment_count"] = item.get("comment_count", len(comments))
            else:
                feed_item["comment_count"] = item.get("comment_count", 0)
            out.append(feed_item)

        has_more = len(items) >= limit
        return {"list": out, "has_more": has_more}
    except Exception as e:
        print(f"[api/community/public-feed] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取动态失败")


@app.get("/api/community/feed")
async def api_community_feed(
    date: Optional[str] = None,
    offset: int = 0,
    limit: int = 20,
    include_comments: bool = True,
    comments_limit: int = 5,
    meal_type: Optional[str] = None,
    diet_goal: Optional[str] = None,
    sort_by: str = "recommended",
    priority_author_ids: Optional[str] = None,
    author_scope: str = "all",
    author_id: Optional[str] = None,
    user_info: dict = Depends(get_current_user_info),
):
    """
    圈子 Feed：好友 + 自己的饮食记录（支持分页），带点赞数、是否已点赞、评论列表。
    
    Args:
        date: 可选日期筛选（YYYY-MM-DD）
        offset: 分页偏移量
        limit: 每页记录数
        include_comments: 是否包含评论（默认 True）
        comments_limit: 每条记录返回的评论数（默认 5）
    
    Returns:
        { "list": [{ record, author, like_count, liked, is_mine, comments, comment_count }], "has_more": bool }
    """
    try:
        current_user_id = user_info["user_id"]
        items = await list_friends_feed_records(
            current_user_id, 
            date=date, 
            offset=offset, 
            limit=limit,
            include_comments=include_comments,
            comments_limit=comments_limit,
            meal_type=meal_type,
            diet_goal=diet_goal,
            sort_by=sort_by,
            priority_author_ids=[x.strip() for x in (priority_author_ids or "").split(",") if x.strip()],
            author_scope=author_scope,
            author_id=author_id,
        )
        
        out = []
        for item in items:
            rec = item["record"]
            
            feed_item = {
                "record": rec,
                "author": item["author"],
                "like_count": item.get("like_count", 0),
                "liked": item.get("liked", False),
                "is_mine": item.get("is_mine", rec.get("user_id") == current_user_id),
                "recommend_reason": item.get("recommend_reason"),
            }
            
            if include_comments:
                comments = item.get("comments", [])
                feed_item["comments"] = comments
                feed_item["comment_count"] = item.get("comment_count", len(comments))
            else:
                feed_item["comment_count"] = item.get("comment_count", 0)
            
            out.append(feed_item)
        
        # 返回是否还有更多数据
        has_more = len(items) >= limit
        return {"list": out, "has_more": has_more}
    except Exception as e:
        print(f"[api/community/feed] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取动态失败")


@app.get("/api/community/checkin-leaderboard")
async def api_community_checkin_leaderboard(
    user_info: dict = Depends(get_current_user_info),
):
    """本周打卡排行榜：自己 + 好友按饮食记录条数排名（北京时间自然周）。"""
    try:
        data = await get_friend_circle_week_checkin_leaderboard(user_info["user_id"])
        return data
    except Exception as e:
        print(f"[api/community/checkin-leaderboard] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取排行榜失败")


@app.post("/api/community/feed/{record_id}/like")
async def api_community_like(
    record_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """对某条动态点赞"""
    try:
        record = await _ensure_feed_record_interactable(user_info["user_id"], record_id)
        inserted = await add_feed_like(user_info["user_id"], record_id)
        record_owner_id = str(record.get("user_id") or "").strip()
        if inserted and record_owner_id and record_owner_id != user_info["user_id"]:
            content_preview = (str(record.get("description") or "").strip() or "赞了你的动态")[:120]
            try:
                await asyncio.to_thread(
                    create_feed_interaction_notification_sync,
                    recipient_user_id=record_owner_id,
                    actor_user_id=user_info["user_id"],
                    record_id=record_id,
                    notification_type="like_received",
                    content_preview=content_preview,
                )
            except Exception as notify_err:
                print(f"[api/community/feed/like] 创建点赞通知失败: {notify_err}")
        return {"message": "已点赞"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/community/feed/like] 错误: {e}")
        raise HTTPException(status_code=500, detail="点赞失败")


@app.delete("/api/community/feed/{record_id}/like")
async def api_community_unlike(
    record_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """取消点赞"""
    try:
        await _ensure_feed_record_interactable(user_info["user_id"], record_id)
        await remove_feed_like(user_info["user_id"], record_id)
        return {"message": "已取消"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/community/feed/unlike] 错误: {e}")
        raise HTTPException(status_code=500, detail="取消失败")


@app.post("/api/community/feed/{record_id}/hide")
async def api_community_hide_feed(
    record_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """将自己的动态从圈子中隐藏（不删除饮食记录本身）。"""
    user_id = user_info["user_id"]
    try:
        hidden = await hide_food_record_from_feed(user_id=user_id, record_id=record_id)
        if not hidden:
            raise HTTPException(status_code=404, detail="记录不存在或无权操作")
        return {"message": "已从圈子中移除"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/community/feed/hide] 错误: {e}")
        raise HTTPException(status_code=500, detail="操作失败")


@app.get("/api/community/feed/{record_id}/comments")
async def api_community_comments(
    record_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """某条动态的评论列表"""
    try:
        await _ensure_feed_record_interactable(user_info["user_id"], record_id)
        comments = await list_feed_comments(record_id, limit=50)
        return {"list": comments}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/community/feed/comments] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取评论失败")


@app.get("/api/community/feed/{record_id}/context")
async def api_community_feed_record_context(
    record_id: str,
    comments_limit: int = 5,
    user_info: dict = Depends(get_current_user_info),
):
    """按记录 ID 获取单条圈子动态的互动上下文，用于通知跳转定位。"""
    try:
        current_user_id = user_info["user_id"]
        record = await _ensure_feed_record_interactable(current_user_id, record_id)
        author = await get_user_by_id(record.get("user_id")) if record.get("user_id") else None
        likes_map = await get_feed_likes_for_records([record_id], current_user_id)
        preview_limit = max(0, min(comments_limit, 20))
        comments = await list_feed_comments(record_id, limit=preview_limit) if preview_limit > 0 else []
        like_info = likes_map.get(record_id, {"count": 0, "liked": False})

        item = {
            "record": record,
            "author": {
                "id": (author or {}).get("id"),
                "nickname": (author or {}).get("nickname") or "用户",
                "avatar": (author or {}).get("avatar") or "",
            },
            "like_count": like_info.get("count", 0),
            "liked": like_info.get("liked", False),
            "is_mine": record.get("user_id") == current_user_id,
            "comments": comments,
            "comment_count": len(comments),
        }
        return {"item": item}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/community/feed/context] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取动态上下文失败")


@app.post("/api/community/feed/{record_id}/comments")
async def api_community_comment_post(
    record_id: str,
    body: CommunityCommentCreateRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    发表评论（直接发布版本）。
    body: { "content": "评论内容" }
    """
    await _ensure_feed_record_interactable(user_info["user_id"], record_id)

    content = (body.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    if len(content) > 500:
        raise HTTPException(status_code=400, detail="评论内容不能超过 500 字")
    try:
        parent_comment_id = body.parent_comment_id
        reply_to_user_id = body.reply_to_user_id
        if reply_to_user_id and not parent_comment_id:
            raise HTTPException(status_code=400, detail="回复评论时必须提供 parent_comment_id")

        if parent_comment_id:
            parent_comment = await get_feed_comment_by_id(parent_comment_id)
            if not parent_comment or parent_comment.get("record_id") != record_id:
                raise HTTPException(status_code=400, detail="被回复评论不存在或不属于当前动态")
            if not reply_to_user_id:
                reply_to_user_id = parent_comment.get("user_id")

        profile = await get_user_by_id(user_info["user_id"])
        nickname = (
            user_info.get("nickname")
            or (profile or {}).get("nickname")
            or "用户"
        )
        avatar = (
            user_info.get("avatar")
            or (profile or {}).get("avatar")
            or ""
        )
        comment = add_feed_comment_sync(
            user_id=user_info["user_id"],
            record_id=record_id,
            content=content,
            parent_comment_id=parent_comment_id,
            reply_to_user_id=reply_to_user_id,
        )
        is_deduped = bool(comment.get("_deduped"))

        try:
            record = get_food_record_by_id_sync(record_id)
            record_owner_id = (record or {}).get("user_id")
            if (not is_deduped) and record_owner_id and record_owner_id != user_info["user_id"]:
                create_feed_interaction_notification_sync(
                    recipient_user_id=record_owner_id,
                    actor_user_id=user_info["user_id"],
                    record_id=record_id,
                    comment_id=comment.get("id"),
                    parent_comment_id=parent_comment_id,
                    notification_type="comment_received",
                    content_preview=(content or "")[:120],
                )

            if (not is_deduped) and reply_to_user_id and reply_to_user_id != user_info["user_id"]:
                create_feed_interaction_notification_sync(
                    recipient_user_id=reply_to_user_id,
                    actor_user_id=user_info["user_id"],
                    record_id=record_id,
                    comment_id=comment.get("id"),
                    parent_comment_id=parent_comment_id,
                    notification_type="reply_received",
                    content_preview=(content or "")[:120],
                )
            elif (not is_deduped) and parent_comment_id:
                parent_comment_sync = get_feed_comment_by_id_sync(parent_comment_id)
                parent_owner_id = (parent_comment_sync or {}).get("user_id")
                if parent_owner_id and parent_owner_id != user_info["user_id"]:
                    create_feed_interaction_notification_sync(
                        recipient_user_id=parent_owner_id,
                        actor_user_id=user_info["user_id"],
                        record_id=record_id,
                        comment_id=comment.get("id"),
                        parent_comment_id=parent_comment_id,
                        notification_type="reply_received",
                        content_preview=(content or "")[:120],
                    )
        except Exception as notify_err:
            print(f"[api/community/feed/comment] 创建圈子互动通知失败: {notify_err}")

        return {
            "comment": {
                "id": comment["id"],
                "user_id": user_info["user_id"],
                "record_id": record_id,
                "parent_comment_id": parent_comment_id,
                "reply_to_user_id": reply_to_user_id,
                "reply_to_nickname": "",
                "content": content,
                "created_at": comment["created_at"],
                "nickname": nickname,
                "avatar": avatar,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/community/feed/comment] 错误: {e}")
        raise HTTPException(status_code=500, detail="发表失败")


@app.get("/api/community/comment-tasks")
async def api_community_comment_tasks(
    limit: int = 50,
    user_info: dict = Depends(get_current_user_info),
):
    """查询当前用户最近的圈子评论审核任务状态。"""
    try:
        tasks = list_comment_tasks_by_user_sync(
            user_info["user_id"],
            comment_type="feed",
            limit=max(1, min(limit, 100)),
        )
        out = []
        for task in tasks:
            extra = task.get("extra") or {}
            out.append({
                "id": task.get("id"),
                "target_id": task.get("target_id"),
                "content": task.get("content") or "",
                "status": task.get("status"),
                "created_at": task.get("created_at"),
                "updated_at": task.get("updated_at"),
                "violation_reason": task.get("violation_reason"),
                "error_message": task.get("error_message"),
                "result": task.get("result"),
                "extra": {
                    "parent_comment_id": extra.get("parent_comment_id"),
                    "reply_to_user_id": extra.get("reply_to_user_id"),
                }
            })
        return {"list": out}
    except Exception as e:
        print(f"[api/community/comment-tasks] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取评论状态失败")


@app.get("/api/community/notifications")
async def api_community_notifications(
    limit: int = 50,
    user_info: dict = Depends(get_current_user_info),
):
    """查询圈子互动通知。"""
    try:
        size = max(1, min(limit, 100))
        items = await list_feed_interaction_notifications(user_info["user_id"], limit=size)
        unread_count = await count_unread_feed_interaction_notifications(user_info["user_id"])
        return {"list": items, "unread_count": unread_count}
    except Exception as e:
        print(f"[api/community/notifications] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取互动消息失败")


@app.post("/api/community/notifications/read")
async def api_community_notifications_read(
    body: MarkFeedNotificationsReadRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """标记圈子互动通知为已读。"""
    try:
        updated = await mark_feed_interaction_notifications_read(
            user_info["user_id"],
            notification_ids=body.notification_ids,
        )
        unread_count = await count_unread_feed_interaction_notifications(user_info["user_id"])
        return {"updated": updated, "unread_count": unread_count}
    except Exception as e:
        print(f"[api/community/notifications/read] 错误: {e}")
        raise HTTPException(status_code=500, detail="更新互动消息失败")


# ---------- 公共食物库 ----------

class PublicFoodLibraryCreateRequest(BaseModel):
    """创建公共食物库条目请求"""
    image_path: Optional[str] = Field(default=None, description="单图 URL（兼容）")
    image_paths: Optional[List[str]] = Field(default=None, description="多图 URL 列表，优先于 image_path")
    source_record_id: Optional[str] = Field(default=None, description="若从个人记录分享，传来源记录 ID")
    # AI 标签（若从记录分享可自动带入，否则需前端先识别）
    total_calories: float = Field(default=0)
    total_protein: float = Field(default=0)
    total_carbs: float = Field(default=0)
    total_fat: float = Field(default=0)
    items: List[Dict[str, Any]] = Field(default_factory=list)
    description: Optional[str] = Field(default=None)
    insight: Optional[str] = Field(default=None)
    # 用户标签
    food_name: Optional[str] = Field(default=None, description="食物名称")
    merchant_name: Optional[str] = Field(default=None, description="商家名称")
    merchant_address: Optional[str] = Field(default=None, description="商家地址")
    taste_rating: Optional[int] = Field(default=None, ge=1, le=5, description="口味评分 1-5")
    suitable_for_fat_loss: bool = Field(default=False, description="是否适合减脂")
    user_tags: List[str] = Field(default_factory=list, description="用户自定义标签")
    user_notes: Optional[str] = Field(default=None, description="用户备注")
    # 地理位置
    latitude: Optional[float] = Field(default=None)
    longitude: Optional[float] = Field(default=None)
    province: Optional[str] = Field(default=None, description="省份/直辖市")
    city: Optional[str] = Field(default=None)
    district: Optional[str] = Field(default=None)


@app.post("/api/public-food-library")
async def api_create_public_food_library(
    body: PublicFoodLibraryCreateRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    创建公共食物库条目。
    - 可直接上传（需先识别得到营养数据）
    - 可从个人饮食记录分享（传 source_record_id，后端自动拷贝营养数据）
    """
    user_id = user_info["user_id"]
    # 若从记录分享，拷贝来源记录的营养数据
    src_record = None
    if body.source_record_id:
        src_record = await get_food_record_by_id(body.source_record_id)
        if not src_record:
            raise HTTPException(status_code=404, detail="来源记录不存在")
        if src_record.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="无权分享他人记录")
    # 多图：优先 body.image_paths；从记录分享时取来源任务的 image_paths，否则用 [record.image_path]
    image_paths: Optional[List[str]] = body.image_paths if body.image_paths else None
    if image_paths is None and src_record and src_record.get("source_task_id"):
        task = await asyncio.to_thread(get_analysis_task_by_id_sync, src_record["source_task_id"])
        if task and task.get("image_paths") and isinstance(task["image_paths"], list) and len(task["image_paths"]) > 0:
            image_paths = list(task["image_paths"])
        elif src_record.get("image_path"):
            image_paths = [src_record["image_path"]]
    if image_paths is None and (body.image_path or (src_record.get("image_path") if src_record else None)):
        image_paths = [body.image_path or (src_record.get("image_path") if src_record else None)]
    try:
        item = await create_public_food_library_item(
            user_id=user_id,
            image_path=body.image_path or (src_record.get("image_path") if src_record else None),
            image_paths=image_paths,
            source_record_id=body.source_record_id,
            total_calories=body.total_calories or (float(src_record.get("total_calories") or 0) if src_record else 0),
            total_protein=body.total_protein or (float(src_record.get("total_protein") or 0) if src_record else 0),
            total_carbs=body.total_carbs or (float(src_record.get("total_carbs") or 0) if src_record else 0),
            total_fat=body.total_fat or (float(src_record.get("total_fat") or 0) if src_record else 0),
            items=body.items or (src_record.get("items") if src_record else []),
            description=body.description or (src_record.get("description") if src_record else None),
            insight=body.insight or (src_record.get("insight") if src_record else None),
            food_name=body.food_name,
            merchant_name=body.merchant_name,
            merchant_address=body.merchant_address,
            taste_rating=body.taste_rating,
            suitable_for_fat_loss=body.suitable_for_fat_loss,
            user_tags=body.user_tags,
            user_notes=body.user_notes,
            latitude=body.latitude,
            longitude=body.longitude,
            province=body.province,
            city=body.city,
            district=body.district,
        )
        # 将用户提交的文字部分拼接起来用于文本审核
        text_content = f"{body.food_name or ''} {body.merchant_name or ''} {body.merchant_address or ''} {body.description or ''} {body.insight or ''} {body.user_notes or ''}".strip()
        # 创建后台审核任务
        if text_content:
            await asyncio.to_thread(
                create_analysis_task_sync,
                user_id=user_id,
                task_type="public_food_library_text",
                text_input=text_content,
                payload={"item_id": item.get("id")},
            )
        else:
            # 如果没有文字内容，直接将状态置为发布
            from database import update_public_food_library_status_sync
            await asyncio.to_thread(update_public_food_library_status_sync, item.get("id"), "published")

        return {"id": item.get("id"), "message": "分享成功"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/public-food-library] 创建错误: {e}")
        raise HTTPException(status_code=500, detail="分享失败")


@app.get("/api/public-food-library")
async def api_list_public_food_library(
    city: Optional[str] = None,
    suitable_for_fat_loss: Optional[bool] = None,
    merchant_name: Optional[str] = None,
    min_calories: Optional[float] = None,
    max_calories: Optional[float] = None,
    sort_by: str = "latest",
    limit: int = 20,
    offset: int = 0,
    user_info: dict = Depends(get_current_user_info),
):
    """
    查询公共食物库列表。
    筛选：city、suitable_for_fat_loss、merchant_name（模糊）、热量区间。
    排序：latest / hot / rating。
    返回每条含 like_count、liked（当前用户是否已点赞）。
    """
    try:
        items = await list_public_food_library(
            city=city,
            suitable_for_fat_loss=suitable_for_fat_loss,
            merchant_name=merchant_name,
            min_calories=min_calories,
            max_calories=max_calories,
            sort_by=sort_by,
            limit=limit,
            offset=offset,
        )
        # 批量查询点赞状态
        item_ids = [it["id"] for it in items]
        likes_map = await get_public_food_library_likes_for_items(item_ids, user_info["user_id"]) if item_ids else {}
        # 批量查询收藏状态
        collections_map = await get_public_food_library_collections_for_items(item_ids, user_info["user_id"]) if item_ids else {}
        # 批量查询作者信息
        author_ids = list({it["user_id"] for it in items})
        from database import get_database_client
        db = get_database_client()
        authors_result = db.table("weapp_user").select("id, nickname, avatar").in_("id", author_ids).execute() if author_ids else None
        author_map = {a["id"]: a for a in (authors_result.data or [])} if authors_result else {}
        out = []
        for it in items:
            like_info = likes_map.get(it["id"], {"count": 0, "liked": False})
            collection_info = collections_map.get(it["id"], {"collected": False})
            author = author_map.get(it["user_id"], {})
            out.append({
                **it,
                "like_count": like_info["count"],
                "liked": like_info["liked"],
                "collection_count": it.get("collection_count", 0),
                "collected": collection_info["collected"],
                "author": {
                    "id": author.get("id"),
                    "nickname": author.get("nickname") or "用户",
                    "avatar": author.get("avatar") or "",
                },
            })
        return {"list": out}
    except Exception as e:
        print(f"[api/public-food-library] 列表错误: {e}")
        raise HTTPException(status_code=500, detail="获取列表失败")


@app.get("/api/public-food-library/mine")
async def api_my_public_food_library(
    user_info: dict = Depends(get_current_user_info),
):
    """获取当前用户上传/分享的公共食物库条目"""
    try:
        items = await list_my_public_food_library(user_info["user_id"])
        return {"list": items}
    except Exception as e:
        print(f"[api/public-food-library/mine] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取失败")


@app.get("/api/public-food-library/collections")
async def api_public_food_library_collections(
    user_info: dict = Depends(get_current_user_info),
):
    """获取当前用户收藏的公共食物库条目（与列表接口同结构：含 author、liked、collected）"""
    try:
        items = await list_collected_public_food_library(user_info["user_id"], limit=50)
        item_ids = [it["id"] for it in items]
        likes_map = await get_public_food_library_likes_for_items(item_ids, user_info["user_id"]) if item_ids else {}
        collections_map = await get_public_food_library_collections_for_items(item_ids, user_info["user_id"]) if item_ids else {}
        author_ids = list({it["user_id"] for it in items})
        from database import get_database_client
        db = get_database_client()
        authors_result = db.table("weapp_user").select("id, nickname, avatar").in_("id", author_ids).execute() if author_ids else None
        author_map = {a["id"]: a for a in (authors_result.data or [])} if authors_result else {}
        out = []
        for it in items:
            like_info = likes_map.get(it["id"], {"count": 0, "liked": False})
            collection_info = collections_map.get(it["id"], {"collected": False})
            author = author_map.get(it["user_id"], {})
            out.append({
                **it,
                "like_count": like_info["count"],
                "liked": like_info["liked"],
                "collection_count": it.get("collection_count", 0),
                "collected": collection_info["collected"],
                "author": {
                    "id": author.get("id"),
                    "nickname": author.get("nickname") or "用户",
                    "avatar": author.get("avatar") or "",
                },
            })
        return {"list": out}
    except Exception as e:
        print(f"[api/public-food-library/collections] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取收藏列表失败")


@app.get("/api/public-food-library/{item_id}")
async def api_get_public_food_library_item(
    item_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """获取单条公共食物库条目详情"""
    try:
        item = await get_public_food_library_item(item_id)
        if not item:
            raise HTTPException(status_code=404, detail="条目不存在")
        # 查询作者信息
        author = await get_user_by_id(item["user_id"])
        # 查询点赞状态
        likes_map = await get_public_food_library_likes_for_items([item_id], user_info["user_id"])
        like_info = likes_map.get(item_id, {"count": 0, "liked": False})
        # 查询收藏状态
        collections_map = await get_public_food_library_collections_for_items([item_id], user_info["user_id"])
        collection_info = collections_map.get(item_id, {"collected": False})

        return {
            **item,
            "like_count": like_info["count"],
            "liked": like_info["liked"],
            "collection_count": item.get("collection_count", 0),
            "collected": collection_info["collected"],
            "author": {
                "id": author.get("id") if author else None,
                "nickname": author.get("nickname") or "用户" if author else "用户",
                "avatar": author.get("avatar") or "" if author else "",
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/public-food-library/{item_id}] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取详情失败")


@app.post("/api/public-food-library/{item_id}/like")
async def api_public_food_library_like(
    item_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """点赞公共食物库条目"""
    try:
        await add_public_food_library_like(user_info["user_id"], item_id)
        return {"message": "已点赞"}
    except Exception as e:
        print(f"[api/public-food-library/{item_id}/like] 错误: {e}")
        raise HTTPException(status_code=500, detail="点赞失败")


@app.delete("/api/public-food-library/{item_id}/like")
async def api_public_food_library_unlike(
    item_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """取消点赞"""
    try:
        await remove_public_food_library_like(user_info["user_id"], item_id)
        return {"message": "已取消"}
    except Exception as e:
        print(f"[api/public-food-library/{item_id}/unlike] 错误: {e}")
        raise HTTPException(status_code=500, detail="取消失败")


@app.post("/api/public-food-library/{item_id}/collect")
async def api_public_food_library_collect(
    item_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """收藏公共食物库条目"""
    try:
        await add_public_food_library_collection(user_info["user_id"], item_id)
        return {"message": "已收藏"}
    except Exception as e:
        print(f"[api/public-food-library/{item_id}/collect] 错误: {e}")
        raise HTTPException(status_code=500, detail="收藏失败")


@app.delete("/api/public-food-library/{item_id}/collect")
async def api_public_food_library_uncollect(
    item_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """取消收藏"""
    try:
        await remove_public_food_library_collection(user_info["user_id"], item_id)
        return {"message": "已取消"}
    except Exception as e:
        print(f"[api/public-food-library/{item_id}/uncollect] 错误: {e}")
        raise HTTPException(status_code=500, detail="取消失败")


@app.get("/api/public-food-library/{item_id}/comments")
async def api_public_food_library_comments(
    item_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """获取公共食物库条目的评论列表"""
    try:
        comments = await list_public_food_library_comments(item_id, limit=50)
        return {"list": comments}
    except Exception as e:
        print(f"[api/public-food-library/{item_id}/comments] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取评论失败")


@app.post("/api/public-food-library/{item_id}/comments")
async def api_public_food_library_comment_post(
    item_id: str,
    body: dict,
    user_info: dict = Depends(get_current_user_info),
):
    """
    发表公共食物库评论（直接发布版本）。
    body: { "content": "评论内容", "rating": 5 }  # rating 可选 1-5
    """
    content = (body.get("content") or "").strip() if isinstance(body.get("content"), str) else ""
    if not content:
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    if len(content) > 500:
        raise HTTPException(status_code=400, detail="评论内容不能超过 500 字")
    rating = body.get("rating")
    if rating is not None:
        if not isinstance(rating, int) or rating < 1 or rating > 5:
            raise HTTPException(status_code=400, detail="评分须为 1-5 的整数")
    try:
        profile = await get_user_by_id(user_info["user_id"])
        nickname = (
            user_info.get("nickname")
            or (profile or {}).get("nickname")
            or "用户"
        )
        avatar = (
            user_info.get("avatar")
            or (profile or {}).get("avatar")
            or ""
        )
        comment = add_public_food_library_comment_sync(
            user_id=user_info["user_id"],
            item_id=item_id,
            content=content,
            rating=rating,
        )
        return {
            "comment": {
                "id": comment["id"],
                "user_id": user_info["user_id"],
                "library_item_id": item_id,
                "content": content,
                "rating": rating,
                "created_at": comment["created_at"],
                "nickname": nickname,
                "avatar": avatar,
            }
        }
    except Exception as e:
        print(f"[api/public-food-library/{item_id}/comments] 发表错误: {e}")
        raise HTTPException(status_code=500, detail="发表失败")


@app.post("/api/public-food-library/feedback")
async def api_public_food_library_feedback(
    body: dict,
    user_info: dict = Depends(get_current_user_info),
):
    """
    提交公共食物库用户反馈。
    body: { "content": "反馈内容", "library_item_id": "可选的食物条目ID" }
    """
    content = (body.get("content") or "").strip() if isinstance(body.get("content"), str) else ""
    if not content:
        raise HTTPException(status_code=400, detail="反馈内容不能为空")
    if len(content) > 1000:
        raise HTTPException(status_code=400, detail="反馈内容不能超过 1000 字")
    library_item_id = body.get("library_item_id")
    try:
        feedback = add_public_food_library_feedback_sync(
            user_id=user_info["user_id"],
            content=content,
            library_item_id=library_item_id,
        )
        return {"id": feedback["id"], "message": "反馈提交成功"}
    except Exception as e:
        print(f"[api/public-food-library/feedback] 错误: {e}")
        raise HTTPException(status_code=500, detail="反馈提交失败")


async def get_access_token() -> str:
    """
    获取微信小程序 access_token
    参考文档: https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-access-token/api_getaccesstoken.html
    """
    global _access_token_cache
    
    # 按照需求：第一次获取后缓存，如果过去一个半小时（1.5 * 3600 = 5400秒），重新获取
    current_time = int(time.time())
    
    # 确保 cache 字典拥有 fetched_at 字段
    if "fetched_at" not in _access_token_cache:
        _access_token_cache["fetched_at"] = 0

    # 如果 token 存在，且当前时间距离上次获取时间还未超过一个半小时（5400秒）
    if _access_token_cache["token"] and (current_time - _access_token_cache["fetched_at"] < 5400):
        print(f"[get_access_token] 使用缓存的 access_token: {_access_token_cache['token']}")
        print(f"[get_access_token] 距离上次获取已过: {current_time - _access_token_cache['fetched_at']} 秒 (缓存有效期: 5400秒)")
        return _access_token_cache["token"]
    
    appid = os.getenv("APPID")
    secret = os.getenv("SECRET")
    
    if not appid or not secret:
        raise HTTPException(
            status_code=500,
            detail="缺少 APPID 或 SECRET 环境变量"
        )
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        # 1) 优先使用微信推荐的 stable_token 接口，减少多实例并发导致 token 失效
        stable_url = "https://api.weixin.qq.com/cgi-bin/stable_token"
        stable_resp = await client.post(
            stable_url,
            json={
                "grant_type": "client_credential",
                "appid": appid,
                "secret": secret,
                "force_refresh": False,
            },
        )
        if stable_resp.is_success:
            data = stable_resp.json()
            if not data.get("errcode"):
                access_token = data.get("access_token")
                expires_in = data.get("expires_in", 7200)
                if access_token:
                    _access_token_cache["token"] = access_token
                    _access_token_cache["fetched_at"] = current_time
                    _access_token_cache["expires_at"] = current_time + expires_in
                    print(f"[get_access_token] 使用 stable_token，expires_in={expires_in}")
                    return access_token
            else:
                print(f"[get_access_token] stable_token 返回错误: {data}")

        # 2) 回退到老接口，兼容部分账号/环境
        token_url = "https://api.weixin.qq.com/cgi-bin/token"
        response = await client.get(
            token_url,
            params={
                "grant_type": "client_credential",
                "appid": appid,
                "secret": secret
            }
        )
        if not response.is_success:
            raise HTTPException(
                status_code=500,
                detail=f"获取 access_token 失败: {response.status_code}"
            )
        data = response.json()
        if "errcode" in data and data["errcode"] != 0:
            error_msg = data.get("errmsg", "未知错误")
            raise HTTPException(
                status_code=500,
                detail=f"获取 access_token 失败: {error_msg} (错误码: {data.get('errcode')})"
            )
        access_token = data.get("access_token")
        expires_in = data.get("expires_in", 7200)
        _access_token_cache["token"] = access_token
        _access_token_cache["fetched_at"] = current_time
        _access_token_cache["expires_at"] = current_time + expires_in
        print(f"[get_access_token] 回退 token 接口成功，expires_in={expires_in}")
        return access_token


class QRCodeRequest(BaseModel):
    """请求小程序二维码参数"""
    scene: str = Field(..., description="最大32个可见字符，只支持数字，大小写英文以及部分特殊字符")
    page: Optional[str] = Field(None, description="必须是已经发布的小程序存在的页面")
    width: Optional[int] = Field(430, description="二维码的宽度，单位 px，最小 280px，最大 1280px")
    check_path: Optional[bool] = Field(False, description="检查 page 是否存在")
    env_version: Optional[str] = Field("release", description="要打开的小程序版本")

@app.post("/api/qrcode")
async def get_unlimited_qrcode(request: QRCodeRequest):
    """
    获取小程序二维码并返回 Base64 编码的图片
    """
    import base64
    
    payload = {
        "scene": request.scene,
        "width": request.width,
        "check_path": request.check_path,
        "env_version": request.env_version
    }
    if request.page is not None:
        payload["page"] = request.page

    async with httpx.AsyncClient(timeout=15.0) as client:
        # 最多尝试两次：第一次走缓存 token；若提示 token 无效则清缓存并强制刷新后再试一次
        for attempt in range(2):
            access_token = await get_access_token()
            url = f"https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token={access_token}"
            response = await client.post(url, json=payload)

            if not response.is_success:
                raise HTTPException(status_code=500, detail="请求微信二维码接口失败")

            content_type = response.headers.get("Content-Type", "")
            if "application/json" in content_type:
                err_data = response.json()
                errcode = int(err_data.get("errcode") or 0)
                errmsg = err_data.get("errmsg", "未知错误")
                # 40001/42001: token 无效或过期，自动清缓存重试
                if attempt == 0 and errcode in (40001, 42001):
                    print(f"[api/qrcode] token 失效，清缓存后重试: {err_data}")
                    _access_token_cache["token"] = None
                    _access_token_cache["fetched_at"] = 0
                    _access_token_cache["expires_at"] = 0
                    continue
                raise HTTPException(status_code=500, detail=f"生成二维码失败: {errmsg}")

            image_bytes = response.content
            base64_str = base64.b64encode(image_bytes).decode("utf-8")
            data_uri = f"data:image/jpeg;base64,{base64_str}"
            return {"base64": data_uri}

    raise HTTPException(status_code=500, detail="生成二维码失败")


async def get_phone_number(phone_code: str) -> dict:
    """
    获取用户手机号
    参考文档: https://developers.weixin.qq.com/miniprogram/dev/server/API/user-info/phone-number/api_getphonenumber.html
    """
    access_token = await get_access_token()
    print(f"[get_phone_number] 使用 access_token 获取手机号，phone_code: {phone_code}")
    
    phone_url = "https://api.weixin.qq.com/wxa/business/getuserphonenumber"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            f"{phone_url}?access_token={access_token}",
            json={
                "code": phone_code
            }
        )
        
        if not response.is_success:
            raise HTTPException(
                status_code=500,
                detail=f"获取手机号失败: {response.status_code}"
            )
        
        data = response.json()
        
        # 检查错误
        if "errcode" in data and data["errcode"] != 0:
            error_msg = data.get("errmsg", "未知错误")
            raise HTTPException(
                status_code=400,
                detail=f"获取手机号失败: {error_msg} (错误码: {data.get('errcode')})"
            )
        
        phone_info = data.get("phone_info", {})
        phone_number = phone_info.get("phoneNumber")
        pure_phone_number = phone_info.get("purePhoneNumber")
        country_code = phone_info.get("countryCode")
        
        # 打印手机号信息
        print(f"[get_phone_number] 获取手机号成功:")
        print(f"  - phoneNumber (含区号): {phone_number}")
        print(f"  - purePhoneNumber (不含区号): {pure_phone_number}")
        print(f"  - countryCode (国家区号): {country_code}")
        if phone_info.get("watermark"):
            watermark = phone_info.get("watermark", {})
            print(f"  - watermark.timestamp: {watermark.get('timestamp')}")
            print(f"  - watermark.appid: {watermark.get('appid')}")
        
        return {
            "phoneNumber": phone_number,
            "purePhoneNumber": pure_phone_number,
            "countryCode": country_code
        }


@app.post("/api/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """
    微信小程序登录接口
    
    - **code**: 微信小程序通过 wx.login 获取的临时登录凭证
    - **phoneCode**: 获取手机号的 code（可选，需要用户授权）
    
    流程：
    1. 调用微信接口获取 openid/unionid
    2. 检查 weapp_user 表中是否存在该用户
    3. 如果不存在，创建新用户记录
    4. 如果存在，直接使用现有用户
    5. 生成 JWT token 返回给前端
    """
    try:
        # 1. 获取小程序配置
        appid = os.getenv("APPID")
        secret = os.getenv("SECRET")
        
        if not appid or not secret:
            raise HTTPException(
                status_code=500,
                detail="缺少 APPID 或 SECRET 环境变量"
            )
        
        if not request.code:
            raise HTTPException(
                status_code=400,
                detail="code 不能为空"
            )
        
        # 2. 调用微信 code2Session 接口获取 openid/unionid
        wechat_api_url = "https://api.weixin.qq.com/sns/jscode2session"
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                wechat_api_url,
                params={
                    "appid": appid,
                    "secret": secret,
                    "js_code": request.code,
                    "grant_type": "authorization_code"
                }
            )
            
            if not response.is_success:
                raise HTTPException(
                    status_code=500,
                    detail=f"微信接口调用失败: {response.status_code}"
                )
            
            data = response.json()
            
            # 检查微信接口返回的错误
            if "errcode" in data and data["errcode"] != 0:
                error_msg = data.get("errmsg", "未知错误")
                raise HTTPException(
                    status_code=400,
                    detail=f"微信登录失败: {error_msg} (错误码: {data.get('errcode')})"
                )
            
            openid = data.get("openid", "")
            unionid = data.get("unionid")
            session_key = data.get("session_key", "")  # 后端保存，不返回前端
            
            if not openid:
                raise HTTPException(
                    status_code=400,
                    detail="微信登录失败：未获取到 openid"
                )
        
        # 3. 获取手机号（如果提供了 phoneCode）
            phone_number = None
            pure_phone_number = None
            country_code = None
            
            if request.phoneCode:
                print(f"[api/login] 收到 phoneCode，开始获取手机号: {request.phoneCode}")
                try:
                    phone_info = await get_phone_number(request.phoneCode)
                    phone_number = phone_info.get("phoneNumber")
                    pure_phone_number = phone_info.get("purePhoneNumber")
                    country_code = phone_info.get("countryCode")
                    print(f"[api/login] 手机号获取成功:")
                    print(f"  - phoneNumber: {phone_number}")
                    print(f"  - purePhoneNumber: {pure_phone_number}")
                    print(f"  - countryCode: {country_code}")
                except Exception as phone_error:
                    print(f"[api/login] 获取手机号失败: {phone_error}")
                    import traceback
                    print(f"[api/login] 错误详情: {traceback.format_exc()}")
                    # 手机号获取失败不影响登录流程，继续返回其他信息
        
        # 4. 检查用户是否已存在
        user = await get_user_by_openid(openid)
        
        if user:
            # 用户已存在，更新信息（如果有新数据）
            user_id = user["id"]
            update_data = {}
            
            if unionid and not user.get("unionid"):
                update_data["unionid"] = unionid
            if pure_phone_number and not user.get("telephone"):
                update_data["telephone"] = pure_phone_number
            
            if update_data:
                print(f"[api/login] 更新用户信息: {update_data}")
                user = await update_user(user_id, update_data)
            
            print(f"[api/login] 用户已存在，user_id: {user_id}, openid: {openid}")
        else:
            # 新用户，创建记录
            print(f"[api/login] 创建新用户，openid: {openid}")
            user_data = {
                "openid": openid,
                "unionid": unionid,
                "avatar": "",
                "nickname": "",
                "telephone": pure_phone_number
            }
            
            user = await create_user(user_data)
            user_id = user["id"]
            print(f"[api/login] 新用户创建成功，user_id: {user_id}")
        
        # 5. 若未通过本次请求获取到手机号，但用户库中已有手机号，则从库中带回前端（免二次授权）
        if not pure_phone_number and user.get("telephone"):
            pure_phone_number = user.get("telephone")
            phone_number = user.get("telephone")

        # 6. 生成 JWT token
        token_data = {
            "user_id": user_id,
            "openid": openid,
            "unionid": unionid,
            "sub": user_id  # JWT 标准字段
        }
        
        # Access token（永不过期）
        access_token = create_access_token(
            data=token_data,
            expires_delta=timedelta(days=36525)
        )
        
        # Refresh token（永不过期）
        refresh_token = create_access_token(
            data={"user_id": user_id, "openid": openid, "type": "refresh"},
            expires_delta=timedelta(days=36525)
        )
        
        # 7. 返回登录结果
        return LoginResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            expires_in=36525 * 24 * 60 * 60,  # 约 100 年秒数
            user_id=user_id,
            openid=openid,
            unionid=unionid,
            phoneNumber=phone_number,
            purePhoneNumber=pure_phone_number,
            countryCode=country_code,
            diet_goal=user.get("diet_goal")
        )
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/login] error: {e}")
        import traceback
        print(f"[api/login] 错误详情: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500,
            detail=str(e) or "登录失败"
        )


# ---------- 用户私人食谱 API ----------

class CreateRecipeRequest(BaseModel):
    """创建食谱请求"""
    recipe_name: str = Field(..., description="食谱名称")
    description: Optional[str] = Field(None, description="食谱描述")
    image_path: Optional[str] = Field(None, description="封面图片路径")
    items: List[Dict[str, Any]] = Field(..., description="食物明细")
    total_calories: float = Field(0, description="总热量")
    total_protein: float = Field(0, description="总蛋白质")
    total_carbs: float = Field(0, description="总碳水")
    total_fat: float = Field(0, description="总脂肪")
    total_weight_grams: float = Field(0, description="总重量")
    tags: Optional[List[str]] = Field(None, description="标签")
    meal_type: Optional[str] = Field(None, description="餐次类型")
    is_favorite: Optional[bool] = Field(False, description="是否收藏")


class UpdateRecipeRequest(BaseModel):
    """更新食谱请求"""
    recipe_name: Optional[str] = None
    description: Optional[str] = None
    image_path: Optional[str] = None
    items: Optional[List[Dict[str, Any]]] = None
    total_calories: Optional[float] = None
    total_protein: Optional[float] = None
    total_carbs: Optional[float] = None
    total_fat: Optional[float] = None
    total_weight_grams: Optional[float] = None
    tags: Optional[List[str]] = None
    meal_type: Optional[str] = None
    is_favorite: Optional[bool] = None


@app.post("/api/recipes")
async def create_recipe(
    body: CreateRecipeRequest,
    user_info: dict = Depends(get_current_user_info)
):
    """创建私人食谱"""
    user_id = user_info["user_id"]
    try:
        recipe = await create_user_recipe(user_id, body.dict())
        return {"id": recipe["id"], "message": "食谱创建成功"}
    except Exception as e:
        print(f"[create_recipe] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"创建失败: {str(e)}")


@app.get("/api/recipes")
async def list_recipes(
    meal_type: Optional[str] = None,
    is_favorite: Optional[bool] = None,
    user_info: dict = Depends(get_current_user_info)
):
    """获取私人食谱列表"""
    user_id = user_info["user_id"]
    try:
        recipes = await list_user_recipes(user_id, meal_type, is_favorite)
        return {"recipes": recipes}
    except Exception as e:
        print(f"[list_recipes] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"获取列表失败: {str(e)}")


@app.get("/api/recipes/{recipe_id}")
async def get_recipe(
    recipe_id: str,
    user_info: dict = Depends(get_current_user_info)
):
    """获取食谱详情"""
    user_id = user_info["user_id"]
    try:
        recipe = await get_user_recipe(recipe_id, user_id)
        if not recipe:
            raise HTTPException(status_code=404, detail="食谱不存在")
        return recipe
    except HTTPException:
        raise
    except Exception as e:
        print(f"[get_recipe] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"获取失败: {str(e)}")


@app.put("/api/recipes/{recipe_id}")
async def update_recipe(
    recipe_id: str,
    body: UpdateRecipeRequest,
    user_info: dict = Depends(get_current_user_info)
):
    """更新食谱"""
    user_id = user_info["user_id"]
    try:
        # 只更新非空字段
        update_data = {k: v for k, v in body.dict().items() if v is not None}
        if not update_data:
            raise HTTPException(status_code=400, detail="没有要更新的字段")
        
        recipe = await update_user_recipe(recipe_id, user_id, update_data)
        return {"message": "更新成功", "recipe": recipe}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[update_recipe] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"更新失败: {str(e)}")


@app.delete("/api/recipes/{recipe_id}")
async def delete_recipe(
    recipe_id: str,
    user_info: dict = Depends(get_current_user_info)
):
    """删除食谱"""
    user_id = user_info["user_id"]
    try:
        await delete_user_recipe(recipe_id, user_id)
        return {"message": "删除成功"}
    except Exception as e:
        print(f"[delete_recipe] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")



class UseRecipeRequest(BaseModel):
    meal_type: Optional[str] = None

@app.post("/api/recipes/{recipe_id}/use")
async def use_recipe(
    recipe_id: str,
    body: UseRecipeRequest = None,
    user_info: dict = Depends(get_current_user_info)
):
    """使用食谱创建记录（一键记录）"""
    user_id = user_info["user_id"]
    try:
        # 获取食谱详情
        recipe = await get_user_recipe(recipe_id, user_id)
        if not recipe:
            raise HTTPException(status_code=404, detail="食谱不存在")
        
        # 创建饮食记录（优先使用传入的 meal_type，否则用食谱默认，最终归一化到 6 餐次）
        raw_meal_type = (body and body.meal_type) or recipe.get("meal_type") or "afternoon_snack"
        meal_type = _normalize_meal_type(raw_meal_type)

        record = await insert_food_record(
            user_id=user_id,
            meal_type=meal_type,
            image_path=recipe.get("image_path"),
            description=f"使用食谱：{recipe['recipe_name']}",
            items=recipe.get("items") or [],
            total_calories=float(recipe.get("total_calories", 0)),
            total_protein=float(recipe.get("total_protein", 0)),
            total_carbs=float(recipe.get("total_carbs", 0)),
            total_fat=float(recipe.get("total_fat", 0)),
            total_weight_grams=int(float(recipe.get("total_weight_grams", 0))),
        )
        
        # 更新食谱使用次数
        await use_recipe_record(recipe_id, user_id)
        
        return {
            "message": "记录成功",
            "record_id": record["id"]
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[use_recipe] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"使用失败: {str(e)}")


# ========== 测试后台 API ==========

from test_backend import BatchProcessor, SingleProcessor

# 测试后台登录凭证（简单认证）
TEST_BACKEND_USERNAME = "好人松松"
TEST_BACKEND_PASSWORD = "123456"

# 有效的会话 token 集合（内存存储，重启后失效）
_valid_session_tokens = set()
TEST_BACKEND_MODEL_FLASH = "gemini-3-flash-preview"
TEST_BACKEND_MODEL_FLASH_LITE = "gemini-3.1-flash-lite-preview"
TEST_BACKEND_SUPPORTED_MODELS = {
    TEST_BACKEND_MODEL_FLASH,
    TEST_BACKEND_MODEL_FLASH_LITE,
}


def _generate_session_token() -> str:
    """生成会话 token"""
    return secrets.token_urlsafe(32)


def _verify_test_backend_auth(test_backend_token: str = Cookie(None)) -> bool:
    """验证测试后台登录状态"""
    if not test_backend_token:
        return False
    return test_backend_token in _valid_session_tokens


async def require_test_backend_auth(test_backend_token: str = Cookie(None)):
    """依赖项：要求测试后台登录"""
    if not _verify_test_backend_auth(test_backend_token):
        raise HTTPException(status_code=401, detail="请先登录测试后台")


class TestBackendLoginRequest(BaseModel):
    username: str
    password: str


class TestBackendLocalDatasetImportRequest(BaseModel):
    name: str
    source_dir: str
    description: Optional[str] = ""


@app.post("/api/test-backend/login")
async def test_backend_login(data: TestBackendLoginRequest):
    """测试后台登录"""
    if data.username == TEST_BACKEND_USERNAME and data.password == TEST_BACKEND_PASSWORD:
        token = _generate_session_token()
        _valid_session_tokens.add(token)
        
        response = JSONResponse(content={"success": True, "message": "登录成功"})
        # 设置 cookie，有效期 24 小时
        response.set_cookie(
            key="test_backend_token",
            value=token,
            max_age=86400,
            httponly=True,
            samesite="lax"
        )
        return response
    else:
        return JSONResponse(
            status_code=401,
            content={"success": False, "message": "账号或密码错误"}
        )


@app.post("/api/test-backend/logout")
async def test_backend_logout(test_backend_token: str = Cookie(None)):
    """测试后台登出"""
    if test_backend_token and test_backend_token in _valid_session_tokens:
        _valid_session_tokens.discard(test_backend_token)
    
    response = JSONResponse(content={"success": True, "message": "已登出"})
    response.delete_cookie("test_backend_token")
    return response


def _get_test_processors():
    """获取测试处理器实例"""
    qwen_api_key = os.getenv("DASHSCOPE_API_KEY")
    qwen_base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    
    return BatchProcessor(
        analyze_with_qwen_func=_analyze_with_qwen,
        analyze_with_gemini_func=_analyze_with_gemini,
        build_prompt_func=_build_gemini_prompt,
        qwen_api_key=qwen_api_key,
        qwen_base_url=qwen_base_url,
        max_concurrent=2
    ), SingleProcessor(
        analyze_with_qwen_func=_analyze_with_qwen,
        analyze_with_gemini_func=_analyze_with_gemini,
        build_prompt_func=_build_gemini_prompt,
        qwen_api_key=qwen_api_key,
        qwen_base_url=qwen_base_url
    )


def _serialize_test_backend_dataset(dataset: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": dataset.get("id"),
        "name": dataset.get("name"),
        "description": dataset.get("description") or "",
        "sourceType": dataset.get("source_type") or "local_import",
        "sourceRef": dataset.get("source_ref") or "",
        "coverImageUrl": dataset.get("cover_image_url"),
        "itemCount": int(dataset.get("item_count") or 0),
        "labeledCount": int(dataset.get("labeled_count") or 0),
        "unlabeledCount": int(dataset.get("unlabeled_count") or 0),
        "metadata": dataset.get("metadata") or {},
        "createdAt": dataset.get("created_at"),
        "updatedAt": dataset.get("updated_at"),
    }


def _scan_test_backend_local_dataset_dir(source_dir: str) -> Dict[str, Any]:
    if not source_dir:
        raise HTTPException(status_code=400, detail="source_dir 不能为空")
    if not os.path.isdir(source_dir):
        raise HTTPException(status_code=400, detail="source_dir 不存在或不是目录")

    images: Dict[str, bytes] = {}
    labels: Dict[str, Dict[str, Any]] = {}
    label_path = os.path.join(source_dir, "labels.txt")
    if os.path.exists(label_path):
        try:
            with open(label_path, "r", encoding="utf-8") as f:
                labels = parse_labels_file(f.read())
        except UnicodeDecodeError:
            with open(label_path, "r", encoding="gbk") as f:
                labels = parse_labels_file(f.read())

    for entry in sorted(os.listdir(source_dir)):
        full_path = os.path.join(source_dir, entry)
        if not os.path.isfile(full_path):
            continue
        if entry.lower() == "labels.txt" or entry.lower().endswith(".txt"):
            continue
        if not is_valid_image_file(entry):
            continue
        with open(full_path, "rb") as f:
            images[entry] = f.read()

    items = []
    skipped = []
    for index, filename in enumerate(sorted(images.keys()), 1):
        label = labels.get(filename)
        if not label:
            skipped.append(filename)
            continue
        true_weight = float(label.get("trueWeight") or 0)
        expected_items = label.get("expectedItems") or []
        label_mode = label.get("labelMode") or _infer_test_backend_label_mode(expected_items) or "total"
        items.append({
            "filename": filename,
            "imageBytes": images[filename],
            "trueWeight": true_weight,
            "labelMode": label_mode,
            "expectedItems": expected_items,
            "sortOrder": index,
        })

    return {
        "sourceDir": source_dir,
        "imageCount": len(images),
        "labeledCount": len(items),
        "unlabeledCount": len(skipped),
        "items": items,
        "skipped": skipped,
    }


def _build_test_backend_batch_from_dataset(dataset: Dict[str, Any], dataset_items: List[Dict[str, Any]]) -> Dict[str, Any]:
    items = []
    for row in dataset_items:
        items.append({
            "filename": row.get("filename"),
            "trueWeight": float(row.get("true_weight") or 0),
            "labelMode": row.get("label_mode") or "total",
            "expectedItems": row.get("expected_items") or [],
            "imageUrl": row.get("image_url"),
            "status": "pending",
            "estimatedWeight": None,
            "deviation": None,
            "modelResults": [],
            "description": None,
            "insight": None,
            "pfc_ratio_comment": None,
            "absorption_notes": None,
            "context_advice": None,
            "items": None,
            "error": None,
        })

    batch_id = secrets.token_hex(12)
    return {
        "batch_id": batch_id,
        "status": "pending",
        "notes": "",
        "is_multi_view": False,
        "execution_mode": "standard",
        "prompt_id": None,
        "prompt_ids": [],
        "models": [TEST_BACKEND_MODEL_FLASH],
        "datasetId": dataset.get("id"),
        "datasetName": dataset.get("name"),
        "items": items,
        "summary": {
            "total": len(items),
            "pending": len(items),
            "skipped": (dataset.get("metadata") or {}).get("skipped") or [],
        },
    }


def _parse_test_backend_models(raw_models: Optional[str]) -> List[str]:
    """Parse comma-separated concrete model names for the test backend."""
    models = [
        item.strip().lower()
        for item in str(raw_models or "").split(",")
        if item.strip()
    ]
    if not models:
        current = (os.getenv("GEMINI_MODEL_NAME") or TEST_BACKEND_MODEL_FLASH).strip().lower()
        models = [current if current in TEST_BACKEND_SUPPORTED_MODELS else TEST_BACKEND_MODEL_FLASH]
    invalid = [item for item in models if item not in TEST_BACKEND_SUPPORTED_MODELS]
    if invalid:
        raise HTTPException(status_code=400, detail=f"不支持的模型: {', '.join(invalid)}")
    deduped: List[str] = []
    for model in models:
        if model not in deduped:
            deduped.append(model)
    return deduped


def _parse_test_backend_execution_mode(raw_mode: Optional[str]) -> str:
    mode = str(raw_mode or "").strip().lower()
    if mode == "custom":
        return "custom"
    return _parse_execution_mode_or_raise(mode) or "standard"


def _parse_test_backend_prompt_ids(
    raw_prompt_ids: Optional[str],
    raw_prompt_id: Optional[int] = None,
) -> List[int]:
    parsed_ids: List[int] = []
    for item in str(raw_prompt_ids or "").split(","):
        text = item.strip()
        if not text:
            continue
        try:
            prompt_id = int(text)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"非法 prompt_id: {text}")
        if prompt_id <= 0:
            raise HTTPException(status_code=400, detail=f"非法 prompt_id: {text}")
        if prompt_id not in parsed_ids:
            parsed_ids.append(prompt_id)
    if raw_prompt_id is not None:
        prompt_id = int(raw_prompt_id)
        if prompt_id <= 0:
            raise HTTPException(status_code=400, detail=f"非法 prompt_id: {prompt_id}")
        if prompt_id not in parsed_ids:
            parsed_ids.append(prompt_id)
    return parsed_ids


def _parse_expected_items_input(raw_value: Optional[str], reference_weight: Optional[float] = None) -> List[Dict[str, Any]]:
    """Parse single-image per-food labels from JSON or inline text."""
    text = (raw_value or "").strip()
    if not text:
        return normalize_expected_items(None, fallback_total=reference_weight)
    try:
        if text[0] in "[{":
            payload = json.loads(text)
            if isinstance(payload, dict):
                if isinstance(payload.get("items"), list):
                    return normalize_expected_items(payload.get("items"), fallback_total=reference_weight)
                return normalize_expected_items(payload, fallback_total=reference_weight)
            return normalize_expected_items(payload, fallback_total=reference_weight)
        from test_backend.utils import _parse_items_inline
        return normalize_expected_items(_parse_items_inline(text), fallback_total=reference_weight)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"标准标签格式错误: {e}")


def _infer_test_backend_label_mode(expected_items: Optional[List[Dict[str, Any]]]) -> Optional[str]:
    if not expected_items:
        return None
    return calculate_item_weight_evaluation([], expected_items).get("mode") or "items"


async def _upload_test_backend_images(images: List[UploadFile]) -> tuple[List[str], List[bytes], str]:
    valid_types = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
    image_urls: List[str] = []
    image_bytes_list: List[bytes] = []
    first_name = images[0].filename or "uploaded_image.jpg"

    for image in images:
        if image.content_type not in valid_types:
            raise HTTPException(status_code=400, detail="请上传有效的图片文件（jpg, png, gif, webp）")
        image_bytes = await image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="存在空图片文件，请重新上传")
        if len(image_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="单张图片大小超过限制（最大 10MB）")
        image_bytes_list.append(image_bytes)
        mime_type = mimetypes.guess_type(image.filename or first_name)[0] or image.content_type or "image/jpeg"
        image_base64 = base64.b64encode(image_bytes).decode("utf-8")
        data_uri = f"data:{mime_type};base64,{image_base64}"
        try:
            image_urls.append(await asyncio.to_thread(upload_food_analyze_image, data_uri))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"上传图片失败: {str(e)}")

    return image_urls, image_bytes_list, first_name


async def _run_test_backend_provider_analysis(
    image_urls: List[str],
    filename: str,
    provider: str,
    notes: str = "",
    is_multi_view: bool = False,
    execution_mode: str = "standard",
    prompt_id: Optional[int] = None,
    expected_items: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Run one selected Gemini model for the test backend."""
    provider = provider.strip().lower()
    if provider not in TEST_BACKEND_SUPPORTED_MODELS:
        raise RuntimeError(f"不支持的模型: {provider}")
    task = {
        "task_type": "food",
        "image_url": image_urls[0] if image_urls else None,
        "image_paths": image_urls,
        "payload": {
            "additionalContext": (notes or "").strip(),
            "is_multi_view": is_multi_view,
            "execution_mode": _normalize_execution_mode(execution_mode),
        },
    }

    try:
        from worker import (
            _build_food_prompt as worker_build_food_prompt,
            _derive_recognition_fields as worker_derive_recognition_fields,
            _normalize_analysis_response_payload as worker_normalize_analysis_response_payload,
            _parse_analysis_result_items as worker_parse_analysis_result_items,
            _strip_standard_mode_extra_fields as worker_strip_standard_mode_extra_fields,
            OFOX_BASE_URL as WORKER_OFOX_BASE_URL,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"加载主链路分析模块失败: {str(e)}")

    async def _resolve_test_backend_prompt(
        mode: str,
        selected_prompt_id: Optional[int] = None,
    ) -> Tuple[str, str, Optional[Dict[str, Any]]]:
        if mode != "custom":
            prompt_content = worker_build_food_prompt(task, "")
            return prompt_content, f"backend/worker.py::_build_food_prompt({mode})", None

        selected_prompt: Optional[Dict[str, Any]] = None
        if selected_prompt_id:
            selected_prompt = await get_prompt_by_id(selected_prompt_id)
            if not selected_prompt:
                raise HTTPException(status_code=404, detail="所选提示词不存在")
            if str(selected_prompt.get("model_type") or "").strip().lower() != "gemini":
                raise HTTPException(status_code=400, detail="测试后台当前只支持选择 Gemini 提示词")

        active_prompt = selected_prompt or await get_active_prompt("gemini")
        prompt_content = str((active_prompt or {}).get("prompt_content") or "").strip()
        if prompt_content:
            context_lines: List[str] = []
            if is_multi_view:
                context_lines.append("补充说明：提供的是同一份食物的不同视角，请综合所有图片判断，不要当成多份食物。")
            if (notes or "").strip():
                context_lines.append(f"补充说明：{(notes or '').strip()}")
            if context_lines:
                prompt_content = prompt_content + "\n\n" + "\n".join(context_lines)
            if selected_prompt:
                return prompt_content, f"model_prompts.id({selected_prompt.get('id')})", active_prompt
            return prompt_content, "model_prompts.active(gemini)", active_prompt

        prompt_content = worker_build_food_prompt(task, "")
        return prompt_content, "backend/worker.py::_build_food_prompt(custom-fallback)", None

    api_key = os.getenv("OFOXAI_API_KEY") or os.getenv("ofox_ai_apikey")
    if not api_key:
        raise RuntimeError("缺少 OFOXAI_API_KEY 环境变量")
    api_url = f"{WORKER_OFOX_BASE_URL}/chat/completions"
    model_name = provider

    normalized_mode = execution_mode if execution_mode == "custom" else _normalize_execution_mode(execution_mode)
    prompt, prompt_source, active_prompt = await _resolve_test_backend_prompt(normalized_mode, prompt_id)
    content_parts = [{"type": "text", "text": prompt}]
    for url in image_urls:
        content_parts.append({"type": "image_url", "image_url": {"url": url}})

    parsed = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                response = await client.post(
                    api_url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model_name,
                        "messages": [{"role": "user", "content": content_parts}],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.7,
                    },
                )
            if not response.is_success:
                err = response.json() if response.content else {}
                msg = err.get("error", {}).get("message") or f"API 错误: {response.status_code}"
                if attempt < 2:
                    await asyncio.sleep(1)
                    continue
                raise RuntimeError(msg)
            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content")
            if not content:
                if attempt < 2:
                    await asyncio.sleep(1)
                    continue
                raise RuntimeError("AI 返回了空响应")
            json_str = re.sub(r"```json", "", content)
            json_str = re.sub(r"```", "", json_str).strip()
            parsed = worker_normalize_analysis_response_payload(json.loads(json_str))
            break
        except Exception:
            if attempt >= 2:
                raise
            await asyncio.sleep(1)

    if parsed is None:
        raise RuntimeError("AI 返回解析失败")

    def _optional_text(value: Any) -> Optional[str]:
        text = str(value or "").strip()
        return text or None

    parsed_items = worker_parse_analysis_result_items(parsed)
    result = {
        "description": _optional_text(parsed.get("description")),
        "insight": _optional_text(parsed.get("insight")),
        "items": parsed_items,
        "pfc_ratio_comment": _optional_text(parsed.get("pfc_ratio_comment")),
        "absorption_notes": _optional_text(parsed.get("absorption_notes")),
        "context_advice": _optional_text(parsed.get("context_advice")),
    }
    if normalized_mode != "custom":
        result = worker_strip_standard_mode_extra_fields(result, _normalize_execution_mode(execution_mode))
    if normalized_mode == "strict":
        result.update(worker_derive_recognition_fields(parsed or {}, parsed_items, "strict"))

    evaluation = await calculate_item_weight_evaluation_with_deepseek(result.get("items") or [], expected_items or [])
    return {
        "success": True,
        "provider": "gemini",
        "model": model_name,
        "data": result,
        "meta": {
            "provider": "gemini",
            "model": model_name,
            "image_count": len(image_urls),
            "image_urls": image_urls,
            "is_multi_view": is_multi_view,
            "execution_mode": normalized_mode,
            "notes": (notes or "").strip(),
            "estimated_weight": evaluation.get("estimatedTotalWeight"),
            "reference_weight": evaluation.get("trueTotalWeight") or None,
            "deviation": evaluation.get("totalDeviation"),
            "prompt_source": prompt_source,
            "prompt_id": (active_prompt or {}).get("id"),
            "prompt_name": (active_prompt or {}).get("prompt_name"),
        },
        "evaluation": evaluation,
    }


async def _run_test_backend_multi_model_analysis(
    image_urls: List[str],
    filename: str,
    models: List[str],
    notes: str = "",
    is_multi_view: bool = False,
    execution_mode: str = "standard",
    prompt_id: Optional[int] = None,
    prompt_ids: Optional[List[int]] = None,
    expected_items: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    custom_prompt_ids = [int(item) for item in (prompt_ids or []) if int(item) > 0]
    if prompt_id and prompt_id not in custom_prompt_ids:
        custom_prompt_ids.append(int(prompt_id))
    run_prompt_ids: List[Optional[int]] = custom_prompt_ids if execution_mode == "custom" and custom_prompt_ids else [None]

    async def _resolve_failure_prompt_meta(selected_prompt_id: Optional[int]) -> Dict[str, Any]:
        if execution_mode != "custom":
            return {}
        if selected_prompt_id:
            prompt_row = await get_prompt_by_id(selected_prompt_id)
            return {
                "prompt_id": selected_prompt_id,
                "prompt_name": (prompt_row or {}).get("prompt_name"),
            }
        active_prompt = await get_active_prompt("gemini")
        return {
            "prompt_id": (active_prompt or {}).get("id"),
            "prompt_name": (active_prompt or {}).get("prompt_name"),
        }

    async def run_one(provider: str, selected_prompt_id: Optional[int]) -> Dict[str, Any]:
        started_at = time.perf_counter()
        try:
            result = await _run_test_backend_provider_analysis(
                image_urls=image_urls,
                filename=filename,
                provider=provider,
                notes=notes,
                is_multi_view=is_multi_view,
                execution_mode=execution_mode,
                prompt_id=selected_prompt_id,
                expected_items=expected_items,
            )
            duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
            result.setdefault("meta", {})["response_duration_ms"] = duration_ms
            return result
        except Exception as e:
            duration_ms = round((time.perf_counter() - started_at) * 1000, 1)
            prompt_meta = await _resolve_failure_prompt_meta(selected_prompt_id)
            return {
                "success": False,
                "provider": "gemini",
                "model": provider,
                "data": None,
                "meta": {
                    "provider": "gemini",
                    "model": provider,
                    "image_count": len(image_urls),
                    "is_multi_view": is_multi_view,
                    "execution_mode": execution_mode if execution_mode == "custom" else _normalize_execution_mode(execution_mode),
                    "notes": (notes or "").strip(),
                    "prompt_source": (
                        "model_prompts.active(gemini)"
                        if execution_mode == "custom"
                        else f"backend/worker.py::_build_food_prompt({_normalize_execution_mode(execution_mode)})"
                    ),
                    "response_duration_ms": duration_ms,
                    **prompt_meta,
                },
                "evaluation": calculate_item_weight_evaluation([], expected_items or []),
                "error": str(e),
            }

    return await asyncio.gather(*(run_one(model, selected_prompt_id) for selected_prompt_id in run_prompt_ids for model in models))


def _build_test_backend_batch_progress(batch: Dict[str, Any]) -> Dict[str, Any]:
    total = len(batch["items"])
    completed = sum(1 for item in batch["items"] if item["status"] == "done")
    failed = sum(1 for item in batch["items"] if item["status"] == "failed")
    processed = completed + failed
    current_item = next((item for item in batch["items"] if item["status"] == "processing"), None)
    percent = round((processed / total) * 100, 1) if total else 0.0
    return {
        "total": total,
        "processed": processed,
        "completed": completed,
        "failed": failed,
        "percent": percent,
        "current_file": current_item["filename"] if current_item else None,
    }


def _serialize_test_backend_batch(batch: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "success": True,
        "batch_id": batch["batch_id"],
        "status": batch["status"],
        "datasetId": batch.get("datasetId"),
        "datasetName": batch.get("datasetName"),
        "executionMode": batch.get("execution_mode", "standard"),
        "models": batch.get("models") or [],
        "promptId": batch.get("prompt_id"),
        "promptIds": batch.get("prompt_ids") or ([] if batch.get("prompt_id") is None else [batch.get("prompt_id")]),
        "promptNames": list(dict.fromkeys(
            str((meta.get("prompt_name") or "")).strip()
            for item in batch.get("items") or []
            for result in (item.get("modelResults") or [])
            for meta in [result.get("meta") or {}]
            if str((meta.get("prompt_name") or "")).strip()
        )),
        "summary": batch["summary"],
        "progress": _build_test_backend_batch_progress(batch),
        "items": [
            {
                "filename": item["filename"],
                "trueWeight": item["trueWeight"],
                "labelMode": item.get("labelMode") or _infer_test_backend_label_mode(item.get("expectedItems")),
                "expectedItems": item.get("expectedItems") or [],
                "status": item["status"],
                "estimatedWeight": item.get("estimatedWeight"),
                "deviation": item.get("deviation"),
                "modelResults": item.get("modelResults") or [],
                "description": item.get("description"),
                "insight": item.get("insight"),
                "pfc_ratio_comment": item.get("pfc_ratio_comment"),
                "absorption_notes": item.get("absorption_notes"),
                "context_advice": item.get("context_advice"),
                "items": item.get("items"),
                "error": item.get("error"),
            }
            for item in batch["items"]
        ],
    }


async def _process_test_backend_batch(batch_id: str) -> None:
    batch = _test_backend_batches.get(batch_id)
    if not batch:
        return

    batch["status"] = "running"
    for item in batch["items"]:
        item["status"] = "processing"
        try:
            image_url = item.get("imageUrl")
            if not image_url:
                image_bytes = base64.b64decode(item.pop("imageBytesB64"))
                mime_type = mimetypes.guess_type(item["filename"])[0] or "image/jpeg"
                data_uri = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('utf-8')}"
                image_url = await asyncio.to_thread(upload_food_analyze_image, data_uri)
            model_results = await _run_test_backend_multi_model_analysis(
                image_urls=[image_url],
                filename=item["filename"],
                models=batch.get("models") or ["qwen"],
                notes=batch.get("notes", ""),
                is_multi_view=batch.get("is_multi_view", False),
                execution_mode=batch.get("execution_mode", "standard"),
                prompt_id=batch.get("prompt_id"),
                prompt_ids=batch.get("prompt_ids") or [],
                expected_items=item.get("expectedItems") or [],
            )
            first_success = next((result for result in model_results if result.get("success")), None)
            result = (first_success or {}).get("data") or {}
            meta = (first_success or {}).get("meta") or {}
            item.update({
                "status": "done" if first_success else "failed",
                "estimatedWeight": meta.get("estimated_weight"),
                "deviation": meta.get("deviation"),
                "modelResults": model_results,
                "description": result.get("description"),
                "insight": result.get("insight"),
                "pfc_ratio_comment": result.get("pfc_ratio_comment"),
                "absorption_notes": result.get("absorption_notes"),
                "context_advice": result.get("context_advice"),
                "items": result.get("items"),
                "error": None if first_success else "所有模型均分析失败",
            })
        except Exception as e:
            error_message = e.detail if isinstance(e, HTTPException) else str(e)
            item.update({
                "status": "failed",
                "error": error_message,
            })

    batch["status"] = "completed" if all(item["status"] == "done" for item in batch["items"]) else "failed"


@app.post("/api/test-backend/analyze")
async def test_backend_analyze(
    images: List[UploadFile] = File(...),
    notes: Optional[str] = Form(default=""),
    reference_weight: Optional[float] = Form(default=None),
    expected_items_json: Optional[str] = Form(default=""),
    models: Optional[str] = Form(default=""),
    execution_mode: Optional[str] = Form(default="standard"),
    prompt_id: Optional[int] = Form(default=None),
    prompt_ids: Optional[str] = Form(default=""),
    is_multi_view: bool = Form(default=False),
    _auth: None = Depends(require_test_backend_auth),
):
    """
    测试后台专用食物分析接口。
    行为尽量与小程序拍照分析一致，但走独立接口，不复用小程序提交任务接口。
    """
    if not images:
        raise HTTPException(status_code=400, detail="请至少上传 1 张图片")
    if len(images) > 3:
        raise HTTPException(status_code=400, detail="最多上传 3 张图片")

    if len(images) > 1 and not is_multi_view:
        raise HTTPException(status_code=400, detail="多张图片分析请开启多视角辅助模式")

    selected_models = _parse_test_backend_models(models)
    mode = _parse_test_backend_execution_mode(execution_mode)
    selected_prompt_ids = _parse_test_backend_prompt_ids(prompt_ids, prompt_id)
    expected_items = _parse_expected_items_input(expected_items_json, reference_weight=reference_weight)
    image_urls, _image_bytes, first_name = await _upload_test_backend_images(images)

    try:
        model_results = await _run_test_backend_multi_model_analysis(
            image_urls=image_urls,
            filename=first_name,
            models=selected_models,
            notes=notes or "",
            is_multi_view=is_multi_view,
            execution_mode=mode,
            prompt_id=prompt_id,
            prompt_ids=selected_prompt_ids,
            expected_items=expected_items,
        )
        first_success = next((item for item in model_results if item.get("success")), None)
        return {
            "success": True,
            "data": (first_success or {}).get("data"),
            "meta": (first_success or {}).get("meta") or {
                "image_count": len(images),
                "execution_mode": mode,
                "prompt_source": "model_prompts.active(gemini)",
            },
            "models": model_results,
            "promptIds": selected_prompt_ids,
            "labelMode": _infer_test_backend_label_mode(expected_items),
            "expectedItems": expected_items,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[test-backend/analyze] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")


@app.get("/api/test-backend/datasets")
async def test_backend_list_datasets(
    _auth: None = Depends(require_test_backend_auth),
):
    """列出可复用测试集。"""
    try:
        rows = await list_test_backend_datasets()
        return {"success": True, "data": [_serialize_test_backend_dataset(row) for row in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取测试集失败: {str(e)}")


@app.post("/api/test-backend/datasets/import-local")
async def test_backend_import_local_dataset(
    body: TestBackendLocalDatasetImportRequest,
    _auth: None = Depends(require_test_backend_auth),
):
    """从服务器本机目录导入一个可复用测试集并持久化到云端。"""
    dataset_name = (body.name or "").strip()
    if not dataset_name:
        raise HTTPException(status_code=400, detail="测试集名称不能为空")

    scan_result = _scan_test_backend_local_dataset_dir((body.source_dir or "").strip())
    items = scan_result["items"]
    if not items:
        raise HTTPException(status_code=400, detail="该目录下没有可导入的已标注样本")

    uploaded_items = []
    for item in items:
        extension = os.path.splitext(item["filename"])[1] or ".jpg"
        mime_type = mimetypes.guess_type(item["filename"])[0] or "image/jpeg"
        image_url = await asyncio.to_thread(
            upload_food_analyze_image_bytes,
            item["imageBytes"],
            extension,
            mime_type,
        )
        uploaded_items.append({
            "filename": item["filename"],
            "imageUrl": image_url,
            "trueWeight": item["trueWeight"],
            "labelMode": item["labelMode"],
            "expectedItems": item["expectedItems"],
            "sortOrder": item["sortOrder"],
        })

    dataset = await create_test_backend_dataset({
        "name": dataset_name,
        "description": (body.description or "").strip(),
        "source_type": "local_import",
        "source_ref": scan_result["sourceDir"],
        "cover_image_url": uploaded_items[0]["imageUrl"] if uploaded_items else None,
        "item_count": scan_result["labeledCount"],
        "labeled_count": scan_result["labeledCount"],
        "unlabeled_count": 0,
        "metadata": {
            "skipped": scan_result["skipped"],
        },
    })

    await insert_test_backend_dataset_items([
        {
            "dataset_id": dataset["id"],
            "filename": item["filename"],
            "image_url": item["imageUrl"],
            "label_mode": item["labelMode"],
            "true_weight": item["trueWeight"],
            "expected_items": item["expectedItems"],
            "sort_order": item["sortOrder"],
        }
        for item in uploaded_items
    ])

    return {
        "success": True,
        "dataset": _serialize_test_backend_dataset(dataset),
        "summary": {
            "imported": len(uploaded_items),
            "skipped": scan_result["skipped"],
        },
    }


@app.post("/api/test-backend/datasets/{dataset_id}/prepare")
async def test_backend_prepare_dataset_batch(
    dataset_id: str,
    _auth: None = Depends(require_test_backend_auth),
):
    """从已保存测试集创建一个新的批次。"""
    dataset = await get_test_backend_dataset(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="测试集不存在")
    dataset_items = await list_test_backend_dataset_items(dataset_id)
    if not dataset_items:
        raise HTTPException(status_code=400, detail="测试集内没有可处理样本")

    batch = _build_test_backend_batch_from_dataset(dataset, dataset_items)
    _test_backend_batches[batch["batch_id"]] = batch
    return _serialize_test_backend_batch(batch)


@app.post("/api/test-backend/batch/prepare")
async def test_backend_batch_prepare(
    file: UploadFile = File(...),
    _auth: None = Depends(require_test_backend_auth),
):
    """准备测试后台批量任务：解析 ZIP 和 labels.txt，返回待处理清单。"""
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="请上传 ZIP 文件")

    zip_bytes = await file.read()
    if len(zip_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件大小超过限制（最大 50MB）")

    batch_processor, _ = _get_test_processors()
    try:
        images, labels = batch_processor._extract_zip(zip_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not images:
        raise HTTPException(status_code=400, detail="ZIP 文件中没有找到有效的图片文件")
    if not labels:
        raise HTTPException(status_code=400, detail="ZIP 文件中缺少 labels.txt 文件")

    items = []
    skipped = []
    for filename, label in labels.items():
        image_bytes = images.get(filename)
        if not image_bytes:
            skipped.append(filename)
            continue
        true_weight = float(label.get("trueWeight") or 0) if isinstance(label, dict) else float(label or 0)
        expected_items = label.get("expectedItems") if isinstance(label, dict) else normalize_expected_items(None, true_weight)
        label_mode = label.get("labelMode") if isinstance(label, dict) else _infer_test_backend_label_mode(expected_items)
        items.append({
            "filename": filename,
            "trueWeight": true_weight,
            "labelMode": label_mode,
            "expectedItems": expected_items,
            "status": "pending",
            "imageBytesB64": base64.b64encode(image_bytes).decode("utf-8"),
            "estimatedWeight": None,
            "deviation": None,
            "modelResults": [],
            "description": None,
            "insight": None,
            "pfc_ratio_comment": None,
            "absorption_notes": None,
            "context_advice": None,
            "items": None,
            "error": None,
        })

    unlabeled_images = [filename for filename in images.keys() if filename not in labels]
    skipped.extend(unlabeled_images)

    if not items:
        raise HTTPException(status_code=400, detail="没有找到可处理的图片和标签匹配项")

    batch_id = secrets.token_hex(12)
    batch = {
        "batch_id": batch_id,
        "status": "pending",
        "notes": "",
        "is_multi_view": False,
        "execution_mode": "standard",
        "prompt_id": None,
        "prompt_ids": [],
        "models": [TEST_BACKEND_MODEL_FLASH],
        "items": items,
        "summary": {
            "total": len(items),
            "pending": len(items),
            "skipped": skipped,
        },
    }
    _test_backend_batches[batch_id] = batch
    return _serialize_test_backend_batch(batch)


@app.post("/api/test-backend/batch/start")
async def test_backend_batch_start(
    batch_id: str = Form(...),
    notes: Optional[str] = Form(default=""),
    is_multi_view: bool = Form(default=False),
    models: Optional[str] = Form(default=""),
    execution_mode: Optional[str] = Form(default="standard"),
    prompt_id: Optional[int] = Form(default=None),
    prompt_ids: Optional[str] = Form(default=""),
    _auth: None = Depends(require_test_backend_auth),
):
    """启动测试后台批量任务。"""
    batch = _test_backend_batches.get(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="批量任务不存在")
    if batch["status"] == "running":
        return _serialize_test_backend_batch(batch)
    if batch["status"] in {"completed", "failed"}:
        return _serialize_test_backend_batch(batch)

    batch["notes"] = (notes or "").strip()
    batch["is_multi_view"] = is_multi_view
    batch["models"] = _parse_test_backend_models(models)
    batch["execution_mode"] = _parse_test_backend_execution_mode(execution_mode)
    batch["prompt_id"] = prompt_id
    batch["prompt_ids"] = _parse_test_backend_prompt_ids(prompt_ids, prompt_id)
    batch["status"] = "running"
    asyncio.create_task(_process_test_backend_batch(batch_id))
    return _serialize_test_backend_batch(batch)


@app.get("/api/test-backend/batch/{batch_id}")
async def test_backend_batch_status(
    batch_id: str,
    _auth: None = Depends(require_test_backend_auth),
):
    """获取测试后台批量任务状态。"""
    batch = _test_backend_batches.get(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="批量任务不存在")
    return _serialize_test_backend_batch(batch)


@app.post("/api/test/batch-upload")
async def test_batch_upload(
    file: UploadFile = File(...),
    _auth: None = Depends(require_test_backend_auth)
):
    """
    批量测试：上传 ZIP 文件进行食物分析对比（需要登录）
    
    ZIP 文件应包含：
    - 多张食物图片（jpg, jpeg, png）
    - labels.txt 标签文件，格式：文件名 重量g（每行一条）
    """
    # 验证文件类型
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="请上传 ZIP 文件")
    
    # 读取文件内容
    try:
        zip_bytes = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"文件读取失败: {str(e)}")
    
    # 文件大小限制（50MB）
    if len(zip_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件大小超过限制（最大 50MB）")
    
    # 处理批量分析
    batch_processor, _ = _get_test_processors()
    
    try:
        result = await batch_processor.process_zip(zip_bytes)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[test/batch-upload] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")


@app.post("/api/test/single-image")
async def test_single_image(
    image: UploadFile = File(...),
    trueWeight: float = Form(...),
    _auth: None = Depends(require_test_backend_auth)
):
    """
    单张图片测试：上传图片和真实重量进行食物分析对比（需要登录）
    """
    # 验证文件类型
    valid_types = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
    if image.content_type not in valid_types:
        raise HTTPException(status_code=400, detail="请上传有效的图片文件（jpg, png, gif, webp）")
    
    # 验证重量
    if trueWeight <= 0:
        raise HTTPException(status_code=400, detail="真实重量必须大于 0")
    
    # 读取图片内容
    try:
        image_bytes = await image.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"图片读取失败: {str(e)}")
    
    # 文件大小限制（10MB）
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片大小超过限制（最大 10MB）")
    
    # 处理单张图片分析
    _, single_processor = _get_test_processors()
    
    try:
        result = await single_processor.analyze_image(
            image_bytes=image_bytes,
            true_weight=trueWeight,
            filename=image.filename or "uploaded_image.jpg"
        )
        return {"success": True, "data": result}
    except Exception as e:
        print(f"[test/single-image] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")


# 测试后台页面路由
@app.get("/test-backend/login", response_class=HTMLResponse)
async def test_backend_login_page():
    """测试后台登录页面"""
    html_path = os.path.join(os.path.dirname(__file__), "static", "test_backend", "login.html")
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    raise HTTPException(status_code=404, detail="登录页面不存在")


@app.get("/test-backend", response_class=HTMLResponse)
async def test_backend_page(test_backend_token: str = Cookie(None)):
    """测试后台页面（需要登录）"""
    # 检查登录状态
    if not _verify_test_backend_auth(test_backend_token):
        return RedirectResponse(url="/test-backend/login", status_code=302)
    
    html_path = os.path.join(os.path.dirname(__file__), "static", "test_backend", "index.html")
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    raise HTTPException(status_code=404, detail="测试后台页面不存在")


# ========== 提示词管理 API ==========

from database import (
    get_active_prompt,
    list_prompts,
    get_prompt_by_id,
    create_prompt,
    update_prompt,
    set_active_prompt,
    delete_prompt,
    get_prompt_history,
)


class PromptCreate(BaseModel):
    model_type: str = Field(..., description="模型类型: qwen 或 gemini")
    prompt_name: str = Field(..., description="提示词名称")
    prompt_content: str = Field(..., description="提示词内容")
    description: str = Field("", description="描述")
    is_active: bool = Field(False, description="是否设为激活")


class PromptUpdate(BaseModel):
    prompt_name: Optional[str] = Field(None, description="提示词名称")
    prompt_content: Optional[str] = Field(None, description="提示词内容")
    description: Optional[str] = Field(None, description="描述")


@app.get("/api/prompts")
async def api_list_prompts(
    model_type: Optional[str] = None,
    _auth: None = Depends(require_test_backend_auth)
):
    """获取提示词列表（需要登录）"""
    try:
        prompts = await list_prompts(model_type)
        return {"success": True, "data": prompts}
    except Exception as e:
        print(f"[api/prompts] 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/prompts/active/{model_type}")
async def api_get_active_prompt(
    model_type: str,
    _auth: None = Depends(require_test_backend_auth)
):
    """获取指定模型的激活提示词（需要登录）"""
    if model_type not in ("qwen", "gemini"):
        raise HTTPException(status_code=400, detail="model_type 必须是 qwen 或 gemini")
    
    try:
        prompt = await get_active_prompt(model_type)
        return {"success": True, "data": prompt}
    except Exception as e:
        print(f"[api/prompts/active] 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/prompts/{prompt_id}")
async def api_get_prompt(
    prompt_id: int,
    _auth: None = Depends(require_test_backend_auth)
):
    """获取单个提示词详情（需要登录）"""
    try:
        prompt = await get_prompt_by_id(prompt_id)
        if not prompt:
            raise HTTPException(status_code=404, detail="提示词不存在")
        return {"success": True, "data": prompt}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/prompts/{prompt_id}] 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/prompts")
async def api_create_prompt(
    data: PromptCreate,
    _auth: None = Depends(require_test_backend_auth)
):
    """创建新提示词（需要登录）"""
    if data.model_type not in ("qwen", "gemini"):
        raise HTTPException(status_code=400, detail="model_type 必须是 qwen 或 gemini")
    
    try:
        prompt = await create_prompt(
            model_type=data.model_type,
            prompt_name=data.prompt_name,
            prompt_content=data.prompt_content,
            description=data.description,
            is_active=data.is_active
        )
        return {"success": True, "data": prompt}
    except Exception as e:
        print(f"[api/prompts create] 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/prompts/{prompt_id}")
async def api_update_prompt(
    prompt_id: int,
    data: PromptUpdate,
    _auth: None = Depends(require_test_backend_auth)
):
    """更新提示词（需要登录）"""
    try:
        prompt = await update_prompt(
            prompt_id=prompt_id,
            prompt_name=data.prompt_name,
            prompt_content=data.prompt_content,
            description=data.description
        )
        if not prompt:
            raise HTTPException(status_code=404, detail="提示词不存在")
        return {"success": True, "data": prompt}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/prompts update] 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/prompts/{prompt_id}/activate")
async def api_activate_prompt(
    prompt_id: int,
    _auth: None = Depends(require_test_backend_auth)
):
    """激活指定提示词（需要登录）"""
    try:
        success = await set_active_prompt(prompt_id)
        if not success:
            raise HTTPException(status_code=404, detail="提示词不存在")
        return {"success": True, "message": "已激活"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/prompts activate] 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===== 运动记录 API =====

async def _estimate_exercise_calories_llm(
    exercise_desc: str,
    profile_snapshot: Optional[Dict[str, Any]] = None,
) -> Tuple[int, Optional[str], str]:
    """将运动描述交给大模型估算千卡（与 Worker 共用 exercise_llm 实现）。"""
    try:
        return await asyncio.to_thread(estimate_exercise_calories_sync, exercise_desc, profile_snapshot)
    except ExerciseLlmError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


class ExerciseCaloriesEstimateRequest(BaseModel):
    exercise_desc: str = Field(..., min_length=1, max_length=200, description="运动描述，如'慢跑5公里'")


class ExerciseLogResponse(BaseModel):
    id: str
    exercise_desc: str
    calories_burned: int
    recorded_on: str
    recorded_at: str
    ai_reasoning: Optional[str] = None


@app.get("/api/exercise-logs")
async def get_exercise_logs(
    date: Optional[str] = Query(None, description="指定日期（ISO格式），默认为今天"),
    start_date: Optional[str] = Query(None, description="开始日期范围"),
    end_date: Optional[str] = Query(None, description="结束日期范围"),
    user_info: dict = Depends(get_current_user_info),
):
    """获取用户的运动记录列表"""
    user_id = user_info["user_id"]
    
    try:
        # 如果指定了具体日期
        if date:
            target_date = _parse_date_string(date, "date") or datetime.now(CHINA_TZ).date().isoformat()
            logs = await list_user_exercise_logs(user_id=user_id, start_date=target_date, end_date=target_date)
        # 如果指定了日期范围
        elif start_date or end_date:
            logs = await list_user_exercise_logs(
                user_id=user_id,
                start_date=start_date if start_date else None,
                end_date=end_date if end_date else None
            )
        # 默认获取今天
        else:
            today = datetime.now(CHINA_TZ).date().isoformat()
            logs = await list_user_exercise_logs(user_id=user_id, start_date=today, end_date=today)
        
        # 计算总消耗（PostgREST 可能将数值以字符串返回）
        total_calories = sum(int(log.get("calories_burned") or 0) for log in logs)
        
        return {
            "logs": logs,
            "total_calories": total_calories,
            "count": len(logs)
        }
    except Exception as e:
        print(f"[get_exercise_logs] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取运动记录失败")


@app.post("/api/exercise-logs")
async def create_exercise_log(
    exercise_desc: str = Form(..., description="运动描述原文"),
    date: Optional[str] = Form(None, description="记录日期 ISO，可选"),
    user_info: dict = Depends(get_current_user_info),
):
    """提交运动分析异步任务（与 `POST /api/analyze/submit` 同一套模式）。

    - 立即返回 `task_id`，在 `analysis_tasks` 中创建 `pending` 任务；
    - Worker 消费任务、调用大模型估算千卡、写入 `user_exercise_logs`；
    - 客户端通过 `GET /api/analyze/tasks/{task_id}` 轮询直至 `done`/`failed`。

    使用 `application/x-www-form-urlencoded` 表单提交。
    """
    user_id = user_info["user_id"]
    desc = (exercise_desc or "").strip()
    if not desc:
        raise HTTPException(status_code=422, detail="运动描述不能为空")
    if len(desc) > 200:
        raise HTTPException(status_code=422, detail="运动描述过长")

    recorded_on = _parse_date_string(date, "date") or datetime.now(CHINA_TZ).date().isoformat()
    user = await get_user_by_id(user_id)
    membership = await _get_effective_membership(user_id)
    membership_resp = _format_membership_response(membership)
    await _raise_if_exercise_credits_insufficient(
        user_id=user_id,
        user_row=user,
        membership=membership,
        membership_resp=membership_resp,
    )
    profile_snapshot = await _build_exercise_profile_snapshot(user_id)
    task_payload = {"recorded_on": recorded_on}
    if profile_snapshot:
        task_payload["profile_snapshot"] = profile_snapshot

    if _should_use_exercise_debug_queue():
        task = await asyncio.to_thread(
            create_analysis_task_sync,
            user_id=user_id,
            task_type=exercise_fallback_task_type(),
            text_input=desc,
            payload={**task_payload, "exercise": True},
        )
        return {
            "task_id": task["id"],
            "message": "运动分析任务已提交，请轮询任务状态直至完成",
        }

    try:
        task = await asyncio.to_thread(
            create_analysis_task_sync,
            user_id=user_id,
            task_type="exercise",
            text_input=desc,
            payload=task_payload,
        )
    except Exception as e:
        err_s = str(e)
        # 远端 DB 若尚未执行 migrate_exercise_logs_and_task_type.sql，task_type=exercise 会违反 CHECK
        if (
            "23514" in err_s
            or "analysis_tasks_task_type_check" in err_s
            or "violates check constraint" in err_s.lower()
        ):
            try:
                task = await asyncio.to_thread(
                    create_analysis_task_sync,
                    user_id=user_id,
                    task_type=exercise_fallback_task_type(),
                    text_input=desc,
                    payload={**task_payload, "exercise": True},
                )
            except Exception as e2:
                print(f"[create_exercise_log] 回退投递仍失败: {e2}")
                raise HTTPException(
                    status_code=500,
                    detail=f"提交运动分析任务失败: {e2}",
                )
        else:
            print(f"[create_exercise_log] 错误: {e}")
            raise HTTPException(status_code=500, detail=f"提交运动分析任务失败: {e}")

    return {
        "task_id": task["id"],
        "message": "运动分析任务已提交，请轮询任务状态直至完成",
    }


@app.delete("/api/exercise-logs/{log_id}")
async def delete_exercise_log(
    log_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """删除运动记录"""
    user_id = user_info["user_id"]
    
    try:
        success = await delete_user_exercise_log(user_id=user_id, log_id=log_id)
        if not success:
            raise HTTPException(status_code=404, detail="记录不存在")
        return {"message": "已删除"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[delete_exercise_log] 错误: {e}")
        raise HTTPException(status_code=500, detail="删除运动记录失败")


@app.post("/api/exercise-logs/estimate-calories")
async def estimate_exercise_calories(
    body: ExerciseCaloriesEstimateRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """仅调用大模型估算千卡（不落库），与 Worker 共用 exercise_llm。"""
    _ = user_info
    try:
        profile_snapshot = await _build_exercise_profile_snapshot(user_info["user_id"])
        calories, ai_raw, reasoning = await _estimate_exercise_calories_llm(
            body.exercise_desc,
            profile_snapshot,
        )
        return {
            "estimated_calories": calories,
            "exercise_desc": body.exercise_desc.strip(),
            "ai_response": ai_raw,
            "reasoning": reasoning,
            "profile_snapshot": profile_snapshot,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[estimate_exercise_calories] 错误: {e}")
        raise HTTPException(status_code=500, detail="估算卡路里失败")


@app.delete("/api/prompts/{prompt_id}")
async def api_delete_prompt(
    prompt_id: int,
    _auth: None = Depends(require_test_backend_auth)
):
    """删除提示词（需要登录）"""
    try:
        success = await delete_prompt(prompt_id)
        if not success:
            raise HTTPException(status_code=404, detail="提示词不存在")
        return {"success": True, "message": "已删除"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/prompts delete] 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/prompts/{prompt_id}/history")
async def api_get_prompt_history(
    prompt_id: int,
    _auth: None = Depends(require_test_backend_auth)
):
    """获取提示词修改历史（需要登录）"""
    try:
        history = await get_prompt_history(prompt_id)
        return {"success": True, "data": history}
    except Exception as e:
        print(f"[api/prompts history] 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# 挂载静态文件（放在最后，避免路由冲突）
static_path = os.path.join(os.path.dirname(__file__), "static", "test_backend")
if os.path.exists(static_path):
    app.mount("/static/test_backend", StaticFiles(directory=static_path), name="test_backend_static")
