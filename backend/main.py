from __future__ import annotations

from fastapi import FastAPI, HTTPException, Depends, File, UploadFile, Form, Cookie, Request, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
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
import mimetypes
import calendar
import logging
import socket
from urllib.parse import urlparse
from datetime import timedelta, datetime, timezone, date
from decimal import Decimal, ROUND_HALF_UP
from dotenv import load_dotenv
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
# OfoxAI API（OpenAI 兼容格式，用于调用 Gemini 模型）
OFOXAI_BASE_URL = "https://api.ofox.ai/v1"
FOOD_ANALYSIS_DAILY_LIMIT_ENABLED = os.getenv("FOOD_ANALYSIS_DAILY_LIMIT_ENABLED", "1").strip().lower() in {"1", "true", "yes", "on"}
# 拍照/文字分析每日上限（限次开启时生效）
FOOD_ANALYSIS_DAILY_LIMIT_NON_PRO = 30
FOOD_ANALYSIS_DAILY_LIMIT_PRO = 100
from auth import create_access_token
from user_points import create_new_user_with_points
from database import (
    get_user_by_openid,
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
    count_analysis_tasks_by_user_sync,
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
    get_food_record_by_id,
    delete_food_record,
    hide_food_record_from_feed,
    list_food_expiry_items_v2,
    upsert_food_expiry_notification_job,
    cancel_food_expiry_notification_jobs_by_item,
    list_food_expiry_notification_jobs_by_item,
    update_analysis_task_result_sync,
    update_analysis_task_result,
    # 评论任务
    create_comment_task_sync,
    insert_user_mode_switch_log_sync,
    list_active_membership_plans,
    get_membership_plan_by_code,
    get_user_pro_membership,
    save_user_pro_membership,
    create_pro_membership_payment_record,
    list_pro_membership_payment_records,
    get_latest_paid_membership_payment_record,
    get_pro_membership_payment_record_by_order_no,
    update_pro_membership_payment_record,
    get_first_membership_trial_batch_rank,
    get_first_paid_membership_user_rank,
    get_daily_membership_bonus_breakdown,
    get_user_earned_credits_balance,
    deduct_user_earned_credits,
    materialize_daily_share_poster_reward_credits,
    claim_share_poster_bonus,
    SHARE_POSTER_DAILY_MAX_EVENTS,
    get_today_food_analysis_count,
    get_today_exercise_log_count,
    get_daily_system_credit_usage,
    get_latest_user_weight_record,
    list_test_backend_datasets,
    get_test_backend_dataset,
    create_test_backend_dataset,
    insert_test_backend_dataset_items,
    list_test_backend_dataset_items,
    get_active_prompt,
    get_prompt_by_id,
    get_exercise_calories_by_date,
)
from middleware import get_current_user_info, get_current_user_id, get_current_openid, get_optional_user_info
from metabolic import calculate_bmr, calculate_tdee, get_age_from_birthday
from otel_compat import (
    OTEL_AVAILABLE,
    BatchLogRecordProcessor,
    BatchSpanProcessor,
    FastAPIInstrumentor,
    HTTPXClientInstrumentor,
    LoggerProvider,
    LoggingHandler,
    LoggingInstrumentor,
    OTLPLogExporter,
    OTLPSpanExporter,
    Resource,
    SERVICE_NAME,
    Status,
    StatusCode,
    TracerProvider,
    format_span_id,
    format_trace_id,
    trace,
)

# 从 .env 文件加载环境变量
BACKEND_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(BACKEND_ENV_PATH, override=True)
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-3-flash-preview")
OTEL_ENABLED = os.getenv("OTEL_ENABLED", "0").strip().lower() in {"1", "true", "yes", "on"}
OTEL_LOGS_ENABLED = os.getenv("OTEL_LOGS_ENABLED", "1").strip().lower() in {"1", "true", "yes", "on"}
OTEL_SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", "food-link-backend").strip() or "food-link-backend"
INSTANCE_HEADER_ENABLED = os.getenv("INSTANCE_HEADER_ENABLED", "1").strip().lower() in {"1", "true", "yes", "on"}
INSTANCE_HEADER_NAME = os.getenv("INSTANCE_HEADER_NAME", "x-instance-id").strip() or "x-instance-id"
INSTANCE_ID = (
    os.getenv("POD_NAME", "").strip()
    or os.getenv("HOSTNAME", "").strip()
    or os.getenv("COMPUTERNAME", "").strip()
    or "unknown-instance"
)
_biz_tracer = trace.get_tracer("food_link.backend.main")


def _normalize_otlp_http_endpoint(value: Optional[str], signal_path: str) -> str:
    endpoint = (value or "").strip()
    if not endpoint:
        endpoint = "http://otel-collector.observability.svc.cluster.local:4318"
    if endpoint.endswith(signal_path):
        return endpoint
    return endpoint.rstrip("/") + signal_path


def _is_local_otlp_endpoint_reachable(endpoint: str) -> bool:
    parsed = urlparse(endpoint)
    host = (parsed.hostname or "").strip().lower()
    if host not in {"localhost", "127.0.0.1", "::1"}:
        return True
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=0.2):
            return True
    except OSError:
        return False


def _build_traceparent(trace_id_hex: str, span_id_hex: str, sampled: bool) -> str:
    return f"00-{trace_id_hex}-{span_id_hex}-{'01' if sampled else '00'}"


def _trace_add_event(name: str, attrs: Optional[Dict[str, Any]] = None) -> None:
    span = trace.get_current_span()
    span_context = span.get_span_context() if span else None
    if not span_context or not span_context.is_valid:
        return
    safe_attrs = {k: v for k, v in (attrs or {}).items() if v is not None}
    span.add_event(name, safe_attrs)


def _trace_record_error(stage: str, err: Exception, **attrs: Any) -> None:
    span = trace.get_current_span()
    span_context = span.get_span_context() if span else None
    err_type = type(err).__name__
    err_msg = str(err)[:300]
    _trace_add_event(
        "biz.error",
        {
            "biz.stage": stage,
            "error.type": err_type,
            "error.message": err_msg,
            **attrs,
        },
    )
    if span_context and span_context.is_valid:
        span.record_exception(err)
        span.set_status(Status(StatusCode.ERROR, f"{stage}:{err_type}"))


def _setup_otel_observability(target_app: FastAPI) -> None:
    if not OTEL_ENABLED:
        return
    if not OTEL_AVAILABLE:
        logging.getLogger(__name__).warning(
            "OpenTelemetry packages are not installed in the current environment; observability is disabled."
        )
        return

    otlp_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
    traces_endpoint = _normalize_otlp_http_endpoint(
        os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", otlp_endpoint),
        "/v1/traces",
    )
    logs_endpoint = _normalize_otlp_http_endpoint(
        os.getenv("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT", otlp_endpoint),
        "/v1/logs",
    )
    if os.getenv("NODE_ENV", "").strip().lower() == "development":
        local_endpoint = otlp_endpoint or traces_endpoint or logs_endpoint
        if local_endpoint and not _is_local_otlp_endpoint_reachable(local_endpoint):
            logging.getLogger(__name__).warning(
                "OpenTelemetry local collector is not reachable; observability is disabled for this dev run."
            )
            return

    resource = Resource.create({SERVICE_NAME: OTEL_SERVICE_NAME})
    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=traces_endpoint)))
    trace.set_tracer_provider(tracer_provider)

    FastAPIInstrumentor.instrument_app(
        target_app,
        tracer_provider=tracer_provider,
    )
    HTTPXClientInstrumentor().instrument(tracer_provider=tracer_provider)

    if OTEL_LOGS_ENABLED:
        logger_provider = LoggerProvider(resource=resource)
        logger_provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter(endpoint=logs_endpoint)))
        LoggingInstrumentor().instrument(set_logging_format=True)
        root_logger = logging.getLogger()
        root_logger.addHandler(LoggingHandler(level=logging.NOTSET, logger_provider=logger_provider))
        root_logger.info(
            "OpenTelemetry logs exporter enabled, endpoint=%s, service=%s",
            logs_endpoint,
            OTEL_SERVICE_NAME,
        )

# 中国时区（UTC+8），用于按本地自然日统计
CHINA_TZ = timezone(timedelta(hours=8))
VALID_EXECUTION_MODES = {"standard", "strict"}
DEFAULT_EXECUTION_MODE = "standard"
VALID_ANALYSIS_ENGINES = {"legacy_direct", "db_first"}
DEFAULT_ANALYSIS_ENGINE = "db_first"
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
ANALYSIS_SUBSCRIBE_ACCEPT_STATUSES = {"accept", "acceptwithalert", "acceptwithaudio"}
EXPIRY_NOTIFICATION_TEMPLATE_ID = str(os.getenv("EXPIRY_SUBSCRIBE_TEMPLATE_ID") or "").strip()
ANALYSIS_SUBSCRIBE_TEMPLATE_ID = str(os.getenv("ANALYSIS_SUBSCRIBE_TEMPLATE_ID") or "").strip()
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


def _parse_analysis_engine_or_raise(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    engine = str(value).strip().lower()
    if not engine:
        return None
    if engine not in VALID_ANALYSIS_ENGINES:
        raise HTTPException(status_code=400, detail="analysis_engine 必须为 legacy_direct 或 db_first")
    return engine


def _is_food_debug_queue_enabled() -> bool:
    return str(os.getenv("FOOD_DEBUG_TASK_QUEUE") or "").strip().lower() in {"1", "true", "yes", "on"}


def _food_debug_queue_suffix() -> str:
    raw = str(os.getenv("FOOD_DEBUG_TASK_QUEUE_SUFFIX") or "").strip().lower()
    return re.sub(r"[^a-z0-9_]+", "_", raw).strip("_")


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
    if not _is_food_debug_queue_enabled():
        return base_task_type
    suffix = _food_debug_queue_suffix()
    return f"{base_task_type}_debug_{suffix}" if suffix else f"{base_task_type}_debug"


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


def _is_precision_schema_missing_error(exc: Exception) -> bool:
    message = str(exc or "")
    if not message:
        return False
    precision_tables = ("precision_sessions", "precision_session_rounds", "precision_item_estimates")
    return any(table in message for table in precision_tables) and (
        "PGRST205" in message or "schema cache" in message
    )


def _raise_precision_schema_not_ready(exc: Exception) -> None:
    if _is_precision_schema_missing_error(exc):
        raise HTTPException(
            status_code=503,
            detail="精准模式数据库未初始化，请先执行 backend/database/precision_sessions.sql",
        ) from exc
    raise exc


def _is_analysis_tasks_schema_mismatch_error(exc: Exception) -> bool:
    message = str(exc or "")
    lowered = message.lower()
    if not message:
        return False
    if "analysis_tasks_task_type_check" in message:
        return True
    return (
        "analysis_tasks" in lowered
        and "23514" in message
        and ("task_type" in lowered or "check constraint" in lowered)
    )


def _raise_analysis_tasks_schema_not_ready(exc: Exception) -> None:
    if _is_analysis_tasks_schema_mismatch_error(exc):
        raise HTTPException(
            status_code=503,
            detail="analysis_tasks 表约束未升级，请先执行 backend/database/migrate_analysis_tasks_for_precision_and_debug.sql",
        ) from exc
    raise exc


def _raise_analysis_related_schema_not_ready(exc: Exception) -> None:
    if _is_precision_schema_missing_error(exc):
        _raise_precision_schema_not_ready(exc)
    if _is_analysis_tasks_schema_mismatch_error(exc):
        _raise_analysis_tasks_schema_not_ready(exc)
    raise exc


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


async def _sync_profile_weight_from_latest(user_id: str) -> None:
    """
    用户记录新体重后调用：
    1. 将最新体重同步到健康档案（无阈值，有变化就更新）
    2. 根据近 28 天运动记录自动推算活动水平
    3. 用最新体重 + 活动水平重算 BMR / TDEE
    """
    try:
        now = datetime.now(CHINA_TZ)
        extended_start = (now - timedelta(days=730)).date().isoformat()
        extended_end = now.date().isoformat()
        weight_rows = await list_user_weight_records(
            user_id=user_id, start_date=extended_start, end_date=extended_end
        )
        if not weight_rows:
            return
        entries = _aggregate_weight_daily(weight_rows)
        if not entries:
            return
        latest_entry = entries[-1]
        latest_weight = float(latest_entry["value"])

        user = await get_user_by_id(user_id)
        if not user:
            return
        profile_weight = user.get("weight")
        gender = user.get("gender") or "male"

        # 根据运动记录推算活动水平（同步 DB 查询，放入线程池避免阻塞事件循环）
        from database import _sync_activity_level_from_logs_sync
        try:
            await asyncio.to_thread(_sync_activity_level_from_logs_sync, user_id)
        except Exception as e:
            print(f"[_sync_profile_weight_from_latest] 活动水平同步失败（忽略）: {e}")

        # 重新查用户以拿到最新的 activity_level
        user = await get_user_by_id(user_id)
        if not user:
            return
        activity_level = user.get("activity_level") or "sedentary"

        bmr = calculate_bmr(
            "male" if gender == "male" else "female",
            latest_weight,
            0.0,
            0,
        )
        tdee = calculate_tdee(bmr, activity_level)
        await update_user(user_id, {
            "weight": latest_weight,
            "bmr": bmr,
            "tdee": tdee,
        })
        print(
            f"[_sync_profile_weight_from_latest] user={user_id} "
            f"weight {profile_weight} → {latest_weight}, "
            f"activity={activity_level}, BMR={bmr}, TDEE={tdee}"
        )
    except Exception as e:
        print(f"[_sync_profile_weight_from_latest] 同步失败: {e}")


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
#   - 标准食物分析（拍照/文字）：2 积分/次
#   - 精准食物分析：4 积分/次
#   - 运动记录：1 积分/次
# 积分发放：
#   - 付费套餐：每日按套餐 daily_credits 发放，当天清零
#   - 免费试用：
#       * 前 500 名注册用户：注册起 60 天内每日 8 积分
#       * 第 501-1000 名注册用户：注册起 30 天内每日 8 积分
#       * 其余新用户：注册起 3 天内每日 8 积分
# 邀请/分享奖励：
#   - 邀请好友：7 天内完成 2 个自然日有效使用后，双方各得 15 积分
#   - 分享海报：记录拥有者按记录生成海报后，每条记录每日 +1 积分，每人每日最多 3 条记录（共 3 分）
# ============================================================

CREDIT_COST_PER_STANDARD_FOOD_ANALYSIS = 2
CREDIT_COST_PER_PRECISION_FOOD_ANALYSIS = 4
CREDIT_COST_PER_FOOD_ANALYSIS = CREDIT_COST_PER_STANDARD_FOOD_ANALYSIS
CREDIT_COST_PER_EXERCISE_LOG = 1

TRIAL_DAILY_CREDITS = 8
EARLY_USER_TOP_500_LIMIT = 500
EARLY_USER_TRIAL_LIMIT = 1000
EARLY_PAID_USER_LIMIT = 100
EARLY_USER_TOP_500_TRIAL_DAYS = 60
EARLY_USER_TRIAL_DAYS = 30
REGULAR_USER_TRIAL_DAYS = 3
EARLY_USER_PAID_CREDITS_MULTIPLIER = 2
INVITE_REWARD_REQUIRED_DAYS = 2
INVITE_REWARD_WINDOW_DAYS = 7
INVITE_REWARD_CREDITS_ON_QUALIFY = 15
INVITE_REWARD_MONTHLY_LIMIT = 10
SHARE_POSTER_REWARD_CREDITS = 1

LEGACY_PRECISION_ENABLED_PLAN_CODES = {"pro_monthly"}
LEGACY_MEMBERSHIP_PLAN_CODES = {"pro_monthly"}
MANUAL_MEMBERSHIP_UPGRADE_USER_IDS = {
    "cafa4614-9453-4eb0-bf60-51f442ce0f4a",  # 倒数第二位用户：人工升级到标准版 + 200/日
}


def _get_food_analysis_credit_cost(execution_mode: Optional[str]) -> int:
    return CREDIT_COST_PER_PRECISION_FOOD_ANALYSIS if _normalize_execution_mode(execution_mode) == "strict" else CREDIT_COST_PER_STANDARD_FOOD_ANALYSIS


def _credits_reset_time_iso() -> str:
    """返回当日中国时区 24:00（= 次日 00:00+08:00）ISO 字符串，供前端倒计时。"""
    now_cn = datetime.now(CHINA_TZ)
    tomorrow_cn = (now_cn + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return tomorrow_cn.isoformat()


BACKFILL_RECORD_WINDOW_DAYS = 3


def _resolve_recorded_on_date(value: Optional[str], field_name: str = "date") -> str:
    parsed = _parse_date_string(value, field_name) or _get_china_today_str()
    target_date = datetime.strptime(parsed, "%Y-%m-%d").date()
    today = datetime.now(CHINA_TZ).date()
    earliest = today - timedelta(days=BACKFILL_RECORD_WINDOW_DAYS - 1)
    if target_date > today:
        raise HTTPException(status_code=400, detail="不能补录未来日期")
    if target_date < earliest:
        raise HTTPException(status_code=400, detail=f"只能补录近 {BACKFILL_RECORD_WINDOW_DAYS} 天内的记录")
    return parsed


def _build_record_time_for_recorded_on(recorded_on: str) -> str:
    target_date = datetime.strptime(recorded_on, "%Y-%m-%d").date()
    now_cn = datetime.now(CHINA_TZ)
    target_dt = now_cn.replace(
        year=target_date.year,
        month=target_date.month,
        day=target_date.day,
        microsecond=0,
    )
    return target_dt.astimezone(timezone.utc).isoformat()


def _is_membership_active_for_target_date(membership: Optional[Dict[str, Any]], target_date: date) -> bool:
    if not membership:
        return False
    status = str(membership.get("status") or "").strip().lower()
    if status and status not in {"active", "trialing"}:
        return False
    start_raw = membership.get("current_period_start") or membership.get("first_activated_at")
    expires_raw = membership.get("expires_at")
    start_dt = _parse_datetime(start_raw) if start_raw else None
    expires_dt = _parse_datetime(expires_raw) if expires_raw else None
    if start_dt and target_date < start_dt.astimezone(CHINA_TZ).date():
        return False
    if expires_dt and target_date > expires_dt.astimezone(CHINA_TZ).date():
        return False
    return True


async def _resolve_daily_system_credit_cap_for_date(
    user_id: str,
    target_date: date,
    membership: Optional[Dict[str, Any]],
    user_row: Optional[Dict[str, Any]],
) -> int:
    early_user_meta = await _resolve_early_user_membership_meta(user_id, user_row)
    early_multiplier = int(early_user_meta.get("early_user_paid_bonus_multiplier") or 1)

    if _is_membership_active_for_target_date(membership, target_date):
        membership_daily_credits = int((membership or {}).get("daily_credits") or 0)
        plan_daily_credits = 0
        plan_code = (membership or {}).get("current_plan_code")
        if plan_code:
            plan = await get_membership_plan_by_code(str(plan_code))
            if plan:
                plan_daily_credits = int(plan.get("daily_credits") or 0)
        daily_credits_base = membership_daily_credits or plan_daily_credits
        if bool(early_user_meta.get("early_user_paid_bonus_eligible")) and early_multiplier > 1 and daily_credits_base > 0:
            boosted_target = (plan_daily_credits * early_multiplier) if plan_daily_credits > 0 else (daily_credits_base * early_multiplier)
            daily_credits_base = max(daily_credits_base, boosted_target)
        return max(int(daily_credits_base), 0)

    trial_meta = await _resolve_user_trial_policy(user_id, user_row, early_user_meta=early_user_meta)
    trial_expires_at = trial_meta.get("trial_expires_at")
    created_at = resolve_user_registration_datetime(user_row) if user_row else None
    if not created_at or not trial_expires_at:
        return 0
    created_cn_date = created_at.astimezone(CHINA_TZ).date()
    trial_end_cn_date = trial_expires_at.astimezone(CHINA_TZ).date()
    if created_cn_date <= target_date <= trial_end_cn_date:
        return TRIAL_DAILY_CREDITS
    return 0


async def _get_day_system_credits_remaining(
    user_id: str,
    target_date_str: str,
    membership: Optional[Dict[str, Any]],
    user_row: Optional[Dict[str, Any]],
) -> int:
    target_date = datetime.strptime(target_date_str, "%Y-%m-%d").date()
    daily_cap = await _resolve_daily_system_credit_cap_for_date(
        user_id=user_id,
        target_date=target_date,
        membership=membership,
        user_row=user_row,
    )
    if daily_cap <= 0:
        return 0
    used_units = await get_daily_system_credit_usage(user_id, target_date_str)
    return max(daily_cap - used_units, 0)


async def _build_credit_spend_plan(
    user_id: str,
    *,
    cost: int,
    recorded_on: str,
    membership: Optional[Dict[str, Any]],
    user_row: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    today_str = _get_china_today_str()
    target_remaining = await _get_day_system_credits_remaining(
        user_id=user_id,
        target_date_str=recorded_on,
        membership=membership,
        user_row=user_row,
    )
    today_remaining = target_remaining if recorded_on == today_str else await _get_day_system_credits_remaining(
        user_id=user_id,
        target_date_str=today_str,
        membership=membership,
        user_row=user_row,
    )
    earned_balance = await get_user_earned_credits_balance(user_id)

    remaining_cost = max(int(cost), 0)
    system_by_date: Dict[str, int] = {}

    use_target = min(remaining_cost, target_remaining)
    if use_target > 0:
        system_by_date[recorded_on] = use_target
        remaining_cost -= use_target

    if remaining_cost > 0 and recorded_on != today_str:
        use_today = min(remaining_cost, today_remaining)
        if use_today > 0:
            system_by_date[today_str] = use_today
            remaining_cost -= use_today

    earned_units = max(remaining_cost, 0)
    total_system_available = target_remaining if recorded_on == today_str else (target_remaining + today_remaining)

    return {
        "recorded_on": recorded_on,
        "cost": max(int(cost), 0),
        "system_by_date": system_by_date,
        "system_units_total": sum(system_by_date.values()),
        "earned_units": earned_units,
        "target_day_system_remaining": target_remaining,
        "today_system_remaining": today_remaining,
        "earned_credits_balance": earned_balance,
        "total_system_available": total_system_available,
        "total_available": total_system_available + earned_balance,
    }


def _get_system_credits_remaining(credits_info: Optional[Dict[str, Any]]) -> int:
    spend_plan = (credits_info or {}).get("credit_spend_plan")
    if isinstance(spend_plan, dict):
        return max(int(spend_plan.get("system_units_total") or 0), 0)
    return max(int((credits_info or {}).get("system_credits_remaining") or 0), 0)


def _get_earned_credits_to_consume(credits_info: Optional[Dict[str, Any]], cost: int) -> int:
    spend_plan = (credits_info or {}).get("credit_spend_plan")
    if isinstance(spend_plan, dict):
        return max(int(spend_plan.get("earned_units") or 0), 0)
    return max(int(cost) - _get_system_credits_remaining(credits_info), 0)


async def _consume_earned_credits_after_success(
    user_id: str,
    credits_info: Optional[Dict[str, Any]],
    *,
    cost: int,
    reason: str,
    source_key: str,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    earned_to_consume = _get_earned_credits_to_consume(credits_info, cost)
    if earned_to_consume <= 0:
        return
    spend_plan = (credits_info or {}).get("credit_spend_plan")
    related_date = datetime.now(CHINA_TZ).strftime("%Y-%m-%d")
    if isinstance(spend_plan, dict):
        related_date = str(spend_plan.get("recorded_on") or related_date)
    try:
        await deduct_user_earned_credits(
            user_id,
            earned_to_consume,
            reason,
            source_key=source_key,
            related_date=related_date,
            meta=meta,
        )
    except Exception as e:
        print(f"[_consume_earned_credits_after_success] user={user_id} source={source_key} 错误: {e}")


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
    if rank and rank <= EARLY_USER_TOP_500_LIMIT:
        trial_days = EARLY_USER_TOP_500_TRIAL_DAYS
        trial_policy = "founding_top_500_bonus_month"
    elif rank and rank <= EARLY_USER_TRIAL_LIMIT:
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
    """解析创始资格：前 1000 注册用户或前 100 付费用户可享会员积分翻倍。"""
    default_meta = {
        "early_user_rank": None,
        "early_user_limit": EARLY_USER_TRIAL_LIMIT,
        "early_paid_user_rank": None,
        "early_paid_user_limit": EARLY_PAID_USER_LIMIT,
        "early_user_paid_bonus_multiplier": 1,
        "early_user_paid_bonus_eligible": False,
        "early_user_paid_bonus_source": None,
        "early_user_paid_bonus_active": False,
    }
    registration_rank: Optional[int] = None
    if user_row and resolve_user_registration_datetime(user_row):
        registration_rank = await get_first_membership_trial_batch_rank(user_id, EARLY_USER_TRIAL_LIMIT)
    paid_rank = await get_first_paid_membership_user_rank(user_id, EARLY_PAID_USER_LIMIT)
    is_registration_eligible = registration_rank is not None
    is_paid_eligible = paid_rank is not None

    bonus_source: Optional[str] = None
    if is_registration_eligible and is_paid_eligible:
        bonus_source = "both"
    elif is_registration_eligible:
        bonus_source = "registration_top_1000"
    elif is_paid_eligible:
        bonus_source = "paid_top_100"

    is_eligible = is_registration_eligible or is_paid_eligible
    return {
        "early_user_rank": registration_rank,
        "early_user_limit": EARLY_USER_TRIAL_LIMIT,
        "early_paid_user_rank": paid_rank,
        "early_paid_user_limit": EARLY_PAID_USER_LIMIT,
        "early_user_paid_bonus_multiplier": EARLY_USER_PAID_CREDITS_MULTIPLIER if is_eligible else 1,
        "early_user_paid_bonus_eligible": is_eligible,
        "early_user_paid_bonus_source": bonus_source,
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
        print(f"[_compute_daily_credits] user={user_id} membership_daily={membership_daily_credits} plan_daily={plan_daily_credits} early_multiplier={early_multiplier} eligible={early_user_meta.get('early_user_paid_bonus_eligible')} daily_credits_base_before_boost={daily_credits_base}")
        if bool(early_user_meta.get("early_user_paid_bonus_eligible")) and early_multiplier > 1 and daily_credits_base > 0:
            boosted_target = (plan_daily_credits * early_multiplier) if plan_daily_credits > 0 else (daily_credits_base * early_multiplier)
            daily_credits_base = max(daily_credits_base, boosted_target)
            early_user_meta["early_user_paid_bonus_active"] = True
        daily_max = daily_credits_base
        print(f"[_compute_daily_credits] user={user_id} daily_max={daily_max}")
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
    earned_credits_balance = await get_user_earned_credits_balance(user_id)

    # 2) 今日已消耗积分（基于行为计数）
    today_str = datetime.now(CHINA_TZ).strftime("%Y-%m-%d")
    used = await get_daily_system_credit_usage(user_id, today_str)
    system_remaining = max(daily_credits_base - used, 0)
    earned_consumed_today = max(used - daily_credits_base, 0)
    total_available = max(system_remaining + earned_credits_balance, 0)

    return {
        "daily_credits_max": daily_credits_base,
        "daily_credits_used": min(used, daily_credits_base) if daily_credits_base > 0 else 0,
        "daily_credits_remaining": total_available,
        "daily_credits_base": daily_credits_base,
        "daily_bonus_credits": daily_bonus_credits,
        "invite_bonus_credits": invite_bonus_credits,
        "share_bonus_credits": share_bonus_credits,
        "system_credits_remaining": system_remaining,
        "earned_credits_balance": earned_credits_balance,
        "earned_credits_consumed_today": earned_consumed_today,
        "total_credits_available": total_available,
        "credits_reset_at": _credits_reset_time_iso(),
        "trial_active": trial_active,
        "trial_expires_at": _build_json_datetime(trial_expires_at) if trial_expires_at else None,
        "trial_days_total": trial_days_total,
        "trial_policy": trial_policy,
        "early_user_rank": early_user_meta.get("early_user_rank"),
        "early_user_limit": int(early_user_meta.get("early_user_limit") or EARLY_USER_TRIAL_LIMIT),
        "early_paid_user_rank": early_user_meta.get("early_paid_user_rank"),
        "early_paid_user_limit": int(early_user_meta.get("early_paid_user_limit") or EARLY_PAID_USER_LIMIT),
        "early_user_paid_bonus_multiplier": early_multiplier,
        "early_user_paid_bonus_eligible": bool(early_user_meta.get("early_user_paid_bonus_eligible")),
        "early_user_paid_bonus_source": early_user_meta.get("early_user_paid_bonus_source"),
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


def _get_membership_tier_order(tier: Optional[str]) -> int:
    return {
        "light": 1,
        "standard": 2,
        "advanced": 3,
    }.get(str(tier or "").strip(), 0)


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
    execution_mode: str = DEFAULT_EXECUTION_MODE,
    user_row: Optional[Dict[str, Any]] = None,
    membership: Optional[Dict[str, Any]] = None,
    membership_resp: Optional[Dict[str, Any]] = None,
    recorded_on: Optional[str] = None,
) -> Dict[str, Any]:
    resolved_membership = membership
    if resolved_membership is None:
        resolved_membership = await _get_effective_membership(user_id)
    resolved_resp = membership_resp or _format_membership_response(resolved_membership)
    resolved_user = user_row or await get_user_by_id(user_id)
    target_date = _resolve_recorded_on_date(recorded_on, "date")
    credits_info = await _compute_daily_credits_status(
        user_id=user_id,
        is_pro=bool(resolved_resp.get("is_pro")),
        membership=resolved_membership,
        user_row=resolved_user,
    )
    credit_cost = _get_food_analysis_credit_cost(execution_mode)
    analysis_label = "精准分析" if _normalize_execution_mode(execution_mode) == "strict" else "食物分析"
    spend_plan = await _build_credit_spend_plan(
        user_id=user_id,
        cost=credit_cost,
        recorded_on=target_date,
        membership=resolved_membership,
        user_row=resolved_user,
    )
    credits_info["credit_spend_plan"] = spend_plan
    remaining = int(spend_plan.get("total_available") or 0)
    if remaining >= credit_cost:
        return credits_info
    detail = (
        f"{target_date} 可用于补录的积分不足。系统会先用该日剩余积分，再用今日积分，最后才用长期奖励积分；"
        f"当前仍不足以支付 {credit_cost} 积分。"
        if target_date != _get_china_today_str()
        else f"当前可用积分不足，{analysis_label}需要 {credit_cost} 积分/次。"
    )
    raise HTTPException(status_code=402, detail=detail)


async def _raise_if_exercise_credits_insufficient(
    user_id: str,
    user_row: Optional[Dict[str, Any]] = None,
    membership: Optional[Dict[str, Any]] = None,
    membership_resp: Optional[Dict[str, Any]] = None,
    recorded_on: Optional[str] = None,
) -> Dict[str, Any]:
    resolved_membership = membership
    if resolved_membership is None:
        resolved_membership = await _get_effective_membership(user_id)
    resolved_resp = membership_resp or _format_membership_response(resolved_membership)
    resolved_user = user_row or await get_user_by_id(user_id)
    target_date = _resolve_recorded_on_date(recorded_on, "date")
    credits_info = await _compute_daily_credits_status(
        user_id=user_id,
        is_pro=bool(resolved_resp.get("is_pro")),
        membership=resolved_membership,
        user_row=resolved_user,
    )
    spend_plan = await _build_credit_spend_plan(
        user_id=user_id,
        cost=CREDIT_COST_PER_EXERCISE_LOG,
        recorded_on=target_date,
        membership=resolved_membership,
        user_row=resolved_user,
    )
    credits_info["credit_spend_plan"] = spend_plan
    remaining = int(spend_plan.get("total_available") or 0)
    if remaining >= CREDIT_COST_PER_EXERCISE_LOG:
        return credits_info
    detail = (
        f"{target_date} 可用于补录的积分不足。系统会先用该日剩余积分，再用今日积分，最后才用长期奖励积分；"
        f"当前仍不足以支付 {CREDIT_COST_PER_EXERCISE_LOG} 积分。"
        if target_date != _get_china_today_str()
        else f"当前可用积分不足，运动记录需要 {CREDIT_COST_PER_EXERCISE_LOG} 积分/次。"
    )
    raise HTTPException(status_code=402, detail=detail)

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
    recorded_on: Optional[str] = None,
    user_row: Optional[Dict[str, Any]] = None,
    membership: Optional[Dict[str, Any]] = None,
    membership_resp: Optional[Dict[str, Any]] = None,
) -> tuple[Optional[Dict[str, Any]], Dict[str, Any], Optional[Dict[str, Any]], str, Dict[str, Any]]:
    resolved_user = user_row or await get_user_by_id(user_id)
    resolved_membership = membership
    if resolved_membership is None:
        resolved_membership = await _get_effective_membership(user_id)
    resolved_resp = membership_resp or _format_membership_response(resolved_membership)

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

    credits_info = await _raise_if_food_analysis_credits_insufficient(
        user_id=user_id,
        execution_mode=resolved_mode,
        user_row=resolved_user,
        membership=resolved_membership,
        membership_resp=resolved_resp,
        recorded_on=recorded_on,
    )

    return resolved_user, resolved_resp, resolved_membership, resolved_mode, credits_info


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

@app.middleware("http")
async def attach_trace_headers(request: Request, call_next):
    response = await call_next(request)
    span = trace.get_current_span()
    span_context = span.get_span_context() if span else None
    if INSTANCE_HEADER_ENABLED:
        response.headers[INSTANCE_HEADER_NAME] = INSTANCE_ID
    if span_context and span_context.is_valid:
        trace_id_hex = format_trace_id(span_context.trace_id)
        span_id_hex = format_span_id(span_context.span_id)
        response.headers["x-trace-id"] = trace_id_hex
        response.headers["traceparent"] = _build_traceparent(
            trace_id_hex,
            span_id_hex,
            span_context.trace_flags.sampled,
        )
    return response


_setup_otel_observability(app)


class Nutrients(BaseModel):
    calories: float = 0
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    fiber: float = 0
    sugar: float = 0
    saturatedFat: float = 0
    cholesterolMg: float = 0
    sodiumMg: float = 0
    potassiumMg: float = 0
    calciumMg: float = 0
    ironMg: float = 0
    magnesiumMg: float = 0
    zincMg: float = 0
    vitaminARaeMcg: float = 0
    vitaminCMg: float = 0
    vitaminDMcg: float = 0
    vitaminEMg: float = 0
    vitaminKMcg: float = 0
    thiaminMg: float = 0
    riboflavinMg: float = 0
    niacinMg: float = 0
    vitaminB6Mg: float = 0
    folateMcg: float = 0
    vitaminB12Mcg: float = 0


class UnitNutritionPer100g(BaseModel):
    calories: float = 0
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    fiber: float = 0
    sugar: float = 0
    saturatedFat: float = 0
    cholesterolMg: float = 0
    sodiumMg: float = 0
    potassiumMg: float = 0
    calciumMg: float = 0
    ironMg: float = 0
    magnesiumMg: float = 0
    zincMg: float = 0
    vitaminARaeMcg: float = 0
    vitaminCMg: float = 0
    vitaminDMcg: float = 0
    vitaminEMg: float = 0
    vitaminKMcg: float = 0
    thiaminMg: float = 0
    riboflavinMg: float = 0
    niacinMg: float = 0
    vitaminB6Mg: float = 0
    folateMcg: float = 0
    vitaminB12Mcg: float = 0


class FoodItemResponse(BaseModel):
    name: str
    estimatedWeightGrams: float
    originalWeightGrams: float
    nutrients: Nutrients
    unit_nutrition_per_100g: Optional[UnitNutritionPer100g] = None
    matched_food_name: Optional[str] = None
    is_unresolved: Optional[bool] = None
    resolve_status: Optional[str] = None
    resolve_score: Optional[float] = None
    nutrition_source: Optional[str] = None


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
    modelName: Optional[str] = Field(default="gemini-3-flash-preview", description="使用的模型名称")
    modelNames: Optional[List[str]] = Field(default=None, description="批量对比时使用的模型名称列表")
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
    analysis_engine: Optional[str] = Field(default=None, description="分析引擎: legacy_direct / db_first")
    analysis_duration_ms: Optional[float] = Field(default=None, description="Worker 实际分析耗时（毫秒）")
    resolved_count: Optional[int] = Field(default=None, description="db_first 成功命中的食物项数量")
    unresolved_count: Optional[int] = Field(default=None, description="db_first 未命中的食物项数量")
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
    analysis_engine: Optional[str] = Field(default=None, description="分析引擎: legacy_direct / db_first")
    duration_ms: Optional[float] = Field(default=None, description="单次分析耗时（毫秒）")
    resolved_count: Optional[int] = Field(default=None, description="命中的食物项数量（db_first）")
    unresolved_count: Optional[int] = Field(default=None, description="未命中的食物项数量（db_first）")
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


class CompareAnalyzeEnginesModelGroup(BaseModel):
    """单个视觉模型下的新旧算法对比结果"""
    model_name: str = Field(..., description="本组使用的视觉模型名称")
    legacy_result: ModelAnalyzeResult = Field(..., description="旧算法结果（模型直接输出营养）")
    db_first_result: ModelAnalyzeResult = Field(..., description="新算法结果（数据库优先）")


class CompareAnalyzeEnginesResponse(BaseModel):
    """同一模型下的新旧算法对比响应"""
    model_name: Optional[str] = Field(default=None, description="兼容字段：当仅对比单个模型时返回该模型名")
    legacy_result: Optional[ModelAnalyzeResult] = Field(default=None, description="兼容字段：单模型时的旧算法结果")
    db_first_result: Optional[ModelAnalyzeResult] = Field(default=None, description="兼容字段：单模型时的新算法结果")
    requested_model_names: List[str] = Field(default_factory=list, description="本次请求的模型列表")
    results: List[CompareAnalyzeEnginesModelGroup] = Field(default_factory=list, description="按模型分组的算法对比结果")


async def _run_engine_compare_once(
    *,
    request: AnalyzeRequest,
    task_payload: Dict[str, Any],
    profile_block: str,
    execution_mode: str,
    analysis_engine: str,
    image_url_for_api: str,
    base64_for_gemini: Optional[str],
) -> ModelAnalyzeResult:
    try:
        from worker import (
            _build_food_prompt as worker_build_food_prompt,
            _build_food_prompt_db_first as worker_build_food_prompt_db_first,
            _build_result_items_with_lookup as worker_build_result_items_with_lookup,
            _derive_recognition_fields as worker_derive_recognition_fields,
            _normalize_analysis_response_payload as worker_normalize_analysis_response_payload,
            _parse_analysis_result_items as worker_parse_analysis_result_items,
            _strip_standard_mode_extra_fields as worker_strip_standard_mode_extra_fields,
            _summarize_db_first_items as worker_summarize_db_first_items,
        )
    except Exception as e:
        return ModelAnalyzeResult(
            model_name=str(request.modelName or "gemini-3-flash-preview"),
            analysis_engine=analysis_engine,
            success=False,
            error=f"加载 worker 分析模块失败: {str(e)}",
        )

    task = {
        "task_type": "food",
        "image_url": request.image_url or image_url_for_api,
        "image_paths": request.image_urls or ([request.image_url] if request.image_url else None),
        "payload": {
            **task_payload,
            "analysis_engine": analysis_engine,
            "execution_mode": execution_mode,
        },
    }
    prompt_builder = worker_build_food_prompt_db_first if analysis_engine == "db_first" else worker_build_food_prompt
    prompt = prompt_builder(task, profile_block)
    model_config = _resolve_food_vision_model_config(request.modelName)
    started_at = time.perf_counter()

    try:
        if model_config["provider"] == "gemini":
            parsed = await _analyze_with_gemini(
                image_url=request.image_url,
                base64_image=base64_for_gemini,
                image_mime_type="image/jpeg",
                prompt=prompt,
                model_name=model_config["model"],
            )
        else:
            api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
            if not api_key:
                raise RuntimeError("缺少 DASHSCOPE_API_KEY 环境变量")
            base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
            parsed = await _analyze_with_qwen(request, prompt, image_url_for_api, api_key, base_url)

        parsed = worker_normalize_analysis_response_payload(parsed)
        if analysis_engine == "db_first":
            items_raw = worker_build_result_items_with_lookup(task, parsed.get("items") or [])
            items = [FoodItemResponse(**item) for item in items_raw]
            resolved_summary = worker_summarize_db_first_items(items_raw)
        else:
            items_raw = worker_parse_analysis_result_items(parsed)
            items = [FoodItemResponse(**item) for item in items_raw]
            resolved_summary = {}

        result_dict = {
            "description": str(parsed.get("description", "无法获取描述")),
            "insight": str(parsed.get("insight", "保持健康饮食！")),
            "items": [item.dict() for item in items],
            "pfc_ratio_comment": (parsed.get("pfc_ratio_comment") or "").strip() or None,
            "absorption_notes": (parsed.get("absorption_notes") or "").strip() or None,
            "context_advice": (parsed.get("context_advice") or "").strip() or None,
        }
        result_dict = worker_strip_standard_mode_extra_fields(result_dict, execution_mode)
        if execution_mode == "strict":
            result_dict.update(worker_derive_recognition_fields(parsed or {}, items_raw, execution_mode))

        duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
        return ModelAnalyzeResult(
            model_name=model_config["model"],
            analysis_engine=analysis_engine,
            duration_ms=duration_ms,
            resolved_count=resolved_summary.get("resolved_count"),
            unresolved_count=resolved_summary.get("unresolved_count"),
            success=True,
            description=result_dict.get("description"),
            insight=result_dict.get("insight"),
            items=[FoodItemResponse(**item) if isinstance(item, dict) else item for item in result_dict.get("items", [])],
            pfc_ratio_comment=result_dict.get("pfc_ratio_comment"),
            absorption_notes=result_dict.get("absorption_notes"),
            context_advice=result_dict.get("context_advice"),
            recognitionOutcome=result_dict.get("recognitionOutcome"),
            rejectionReason=result_dict.get("rejectionReason"),
            retakeGuidance=result_dict.get("retakeGuidance"),
            allowedFoodCategory=result_dict.get("allowedFoodCategory"),
            followupQuestions=result_dict.get("followupQuestions"),
        )
    except Exception as e:
        return ModelAnalyzeResult(
            model_name=model_config["model"],
            analysis_engine=analysis_engine,
            duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
            success=False,
            error=str(e),
        )


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
                "model": request.modelName or "gemini-3-flash-preview",
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


ACTIVITY_LEVEL_LABELS = {
    "sedentary": "久坐",
    "light": "轻度活动",
    "moderate": "中度活动",
    "active": "高度活动",
    "very_active": "极高活动",
}


def _format_health_profile_for_analysis(user: Dict[str, Any], latest_weight: Optional[Dict[str, Any]] = None) -> str:
    """
    将 weapp_user 健康档案格式化为供 AI 参考的简短摘要。
    用于在食物分析时结合体质、病史、过敏等给出更全面建议。
    若传入 latest_weight（身体指标最新记录），优先使用其体重值。
    """
    parts = []
    gender = user.get("gender")
    if gender:
        parts.append(f"性别：{'男' if gender == 'male' else '女'}")
    height = user.get("height")
    if height is not None:
        parts.append(f"身高 {float(height):.0f} cm")
    # 优先用身体指标最新体重，fallback 到健康档案体重
    weight = None
    if latest_weight is not None:
        weight = latest_weight.get("value") if isinstance(latest_weight, dict) else latest_weight
    if weight is None:
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
    分析食物图片，返回营养成分和健康建议。默认使用 Gemini 模型。
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
            _, _, _, execution_mode, _ = await _validate_food_analysis_access(
                user_id=user_info["user_id"],
                effective_mode=execution_mode,
                strict_requested=(requested_mode == "strict"),
                user_row=user,
                membership=membership,
                membership_resp=membership_resp,
            )

        mode_hint = _build_execution_mode_hint(execution_mode)
        compact_tags = ("\n".join(compact_tags_list) + "\n") if compact_tags_list else ""

        # 普通模式：使用 worker.py 的 db_first 算法
        if execution_mode != "strict":
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

            task = {
                "id": f"api-{uuid.uuid4()}",
                "user_id": user_info["user_id"] if user_info else None,
                "task_type": "food",
                "image_url": request.image_url,
                "image_paths": request.image_urls,
                "base64_image": base64_image_for_api,
                "payload": {
                    "meal_type": request.meal_type,
                    "timezone_offset_minutes": request.timezone_offset_minutes,
                    "province": request.province,
                    "city": request.city,
                    "district": request.district,
                    "diet_goal": request.diet_goal,
                    "activity_timing": request.activity_timing,
                    "user_goal": request.user_goal,
                    "remaining_calories": request.remaining_calories,
                    "additionalContext": request.additionalContext,
                    "is_multi_view": request.is_multi_view,
                    "modelName": request.modelName,
                    "execution_mode": "standard",
                },
            }

            from worker import run_food_analysis_sync
            result = await asyncio.to_thread(run_food_analysis_sync, task)

            def _opt_str(v):
                if v is None or v == "":
                    return None
                s = str(v).strip()
                return s if s else None

            return AnalyzeResponse(
                description=result["description"],
                insight=result["insight"],
                items=[FoodItemResponse(**item) for item in result["items"]],
                pfc_ratio_comment=_opt_str(result.get("pfc_ratio_comment")),
                absorption_notes=_opt_str(result.get("absorption_notes")),
                context_advice=_opt_str(result.get("context_advice")),
                recognitionOutcome=_opt_str(result.get("recognitionOutcome")),
                rejectionReason=_opt_str(result.get("rejectionReason")),
                retakeGuidance=result.get("retakeGuidance") if isinstance(result.get("retakeGuidance"), list) else None,
                allowedFoodCategory=_opt_str(result.get("allowedFoodCategory")),
                followupQuestions=result.get("followupQuestions") if isinstance(result.get("followupQuestions"), list) else None,
            )

        # 精准模式：保留原有内联逻辑（后续将改为异步任务队列）
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
    modelName: Optional[str] = Field(default="gemini-3-flash-preview", description="模型名称")
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
        _, _, _, execution_mode, _ = await _validate_food_analysis_access(
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


def _datetimes_match(left: Optional[datetime], right: Optional[datetime]) -> bool:
    if left is None or right is None:
        return left is right
    return abs((left - right).total_seconds()) < 1


async def _reconcile_membership_from_latest_paid_order(
    user_id: str,
    membership: Optional[Dict[str, Any]],
    user_row: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """当会员状态表与最近一次真实 paid 会员订单不一致时，按支付真相自动回写。"""
    latest_paid = await get_latest_paid_membership_payment_record(user_id)
    if not latest_paid:
        return membership

    paid_at = _parse_datetime(latest_paid.get("paid_at"))
    if not paid_at:
        return membership

    duration_months = max(int(latest_paid.get("duration_months") or 1), 1)
    expected_expires_at = _add_months(paid_at, duration_months)
    expected_status = "active" if expected_expires_at > datetime.now(timezone.utc) else "expired"
    existing_first_activated_at = _parse_datetime((membership or {}).get("first_activated_at"))

    paid_plan_code = str(latest_paid.get("plan_code") or "")
    existing_plan_code = str((membership or {}).get("current_plan_code") or "")
    manual_upgrade_allowed = user_id in MANUAL_MEMBERSHIP_UPGRADE_USER_IDS
    paid_tier_order = _get_membership_tier_order(_get_membership_tier_from_plan_code(paid_plan_code))
    existing_tier_order = _get_membership_tier_order(_get_membership_tier_from_plan_code(existing_plan_code))
    effective_plan_code = (
        existing_plan_code
        if manual_upgrade_allowed and existing_tier_order > paid_tier_order
        else paid_plan_code
    )

    plan_daily_credits = 0
    plan = await get_membership_plan_by_code(paid_plan_code)
    if plan:
        plan_daily_credits = int(plan.get("daily_credits") or 0)
    early_user_meta = await _resolve_early_user_membership_meta(user_id, user_row)
    if bool(early_user_meta.get("early_user_paid_bonus_eligible")) and plan_daily_credits > 0:
        plan_daily_credits *= int(early_user_meta.get("early_user_paid_bonus_multiplier") or 1)

    effective_plan_daily_credits = plan_daily_credits
    if manual_upgrade_allowed and effective_plan_code and effective_plan_code != paid_plan_code:
        effective_plan = await get_membership_plan_by_code(effective_plan_code)
        effective_plan_daily_credits = int((effective_plan or {}).get("daily_credits") or 0)
        if bool(early_user_meta.get("early_user_paid_bonus_eligible")) and effective_plan_daily_credits > 0:
            effective_plan_daily_credits *= int(early_user_meta.get("early_user_paid_bonus_multiplier") or 1)

    existing_daily_credits = int((membership or {}).get("daily_credits") or 0)
    if manual_upgrade_allowed:
        effective_daily_credits = max(
            existing_daily_credits,
            int(plan_daily_credits or 0),
            int(effective_plan_daily_credits or 0),
        )
    else:
        effective_daily_credits = int(plan_daily_credits or 0)

    expected_membership = {
        "current_plan_code": effective_plan_code,
        "status": expected_status,
        "first_activated_at": _build_json_datetime(existing_first_activated_at or paid_at),
        "current_period_start": _build_json_datetime(paid_at),
        "expires_at": _build_json_datetime(expected_expires_at),
        "last_paid_at": paid_at.isoformat(),
        "auto_renew": False,
        "daily_credits": effective_daily_credits,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    if not membership:
        return await save_user_pro_membership(user_id, expected_membership)

    membership_period_start = _parse_datetime(membership.get("current_period_start"))
    membership_expires_at = _parse_datetime(membership.get("expires_at"))
    membership_last_paid_at = _parse_datetime(membership.get("last_paid_at"))
    needs_repair = any((
        str(membership.get("current_plan_code") or "") != str(expected_membership["current_plan_code"] or ""),
        str(membership.get("status") or "") != expected_status,
        not _datetimes_match(membership_period_start, paid_at),
        not _datetimes_match(membership_expires_at, expected_expires_at),
        not _datetimes_match(membership_last_paid_at, paid_at),
        int(membership.get("daily_credits") or 0) != int(effective_daily_credits or 0),
    ))
    if not needs_repair:
        return membership

    print(
        "[membership] repair from latest paid order:",
        user_id,
        membership.get("current_plan_code"),
        "->",
        expected_membership["current_plan_code"],
    )
    return await save_user_pro_membership(user_id, expected_membership)


async def _get_effective_membership(user_id: str) -> Optional[Dict[str, Any]]:
    """获取并按当前时间修正用户会员状态。"""
    membership = await get_user_pro_membership(user_id)
    user_row = await get_user_by_id(user_id)
    membership = await _reconcile_membership_from_latest_paid_order(user_id, membership, user_row)
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


from routers.analysis_tasks import create_analysis_tasks_router
from routers.analyze_compare import create_analyze_compare_router
from routers.analyze_submit import create_analyze_submit_router
from routers.analyze_text import create_analyze_text_router
from routers.body_metrics import create_body_metrics_router
from routers.dashboard import create_dashboard_router
from routers.exercise import create_exercise_router
from routers.expiry import create_expiry_router
from routers.food_records import create_food_records_router
from routers.health_profile import router as health_profile_router
from routers.location import router as location_router
from routers.manual_food import router as manual_food_router
from routers.membership import create_membership_router
from routers.precision_sessions import create_precision_sessions_router
from routers.prompts import create_prompts_router
from routers.public_food_library import router as public_food_library_router
from routers.recipes import create_recipes_router
from routers.social import router as social_router
from routers.stats import create_stats_router, refresh_stats_insight_for_user
from routers.system import router as system_router
from routers.test_backend import create_test_backend_router, require_test_backend_auth
from routers.user_profile import create_user_profile_router
from routers.uploads import router as uploads_router
from routers.wechat_auth import get_phone_number, router as wechat_auth_router

app.include_router(create_analysis_tasks_router(
    biz_tracer=_biz_tracer,
    trace_add_event=_trace_add_event,
    trace_record_error=_trace_record_error,
))
app.include_router(create_analyze_compare_router(globals()))
app.include_router(create_analyze_submit_router(globals()))
app.include_router(create_analyze_text_router(globals()))
app.include_router(create_precision_sessions_router(globals()))
app.include_router(system_router)
app.include_router(health_profile_router)
app.include_router(uploads_router)
app.include_router(wechat_auth_router)
app.include_router(create_user_profile_router(
    china_tz=CHINA_TZ,
    normalize_execution_mode=_normalize_execution_mode,
    get_phone_number=get_phone_number,
))
app.include_router(create_dashboard_router(
    china_tz=CHINA_TZ,
    meal_display_order=MEAL_DISPLAY_ORDER,
    meal_names=MEAL_NAMES,
    get_china_today_str=_get_china_today_str,
    normalize_meal_type=_normalize_meal_type,
    build_dashboard_meal_targets=_build_dashboard_meal_targets,
    format_china_time_hhmm=_format_china_time_hhmm,
    normalize_food_expiry_item=_normalize_food_expiry_item,
    build_food_expiry_summary=_build_food_expiry_summary,
    parse_date_string=_parse_date_string,
))
app.include_router(create_body_metrics_router(
    china_tz=CHINA_TZ,
    resolve_stats_range_dates=_resolve_stats_range_dates,
    build_body_metrics_summary=_build_body_metrics_summary,
    empty_body_metrics_summary=_empty_body_metrics_summary,
    parse_date_string=_parse_date_string,
    normalize_body_metric_source_type=_normalize_body_metric_source_type,
    sync_profile_weight_from_latest=_sync_profile_weight_from_latest,
    normalize_weight_entry=_normalize_weight_entry,
    parse_datetime=_parse_datetime,
    build_json_datetime=_build_json_datetime,
    build_legacy_weight_client_id=_build_legacy_weight_client_id,
))
app.include_router(location_router)
app.include_router(create_membership_router(
    china_tz=CHINA_TZ,
    share_poster_daily_max_events=SHARE_POSTER_DAILY_MAX_EVENTS,
    get_effective_membership=_get_effective_membership,
    format_membership_response=_format_membership_response,
    get_food_analysis_daily_limit=_get_food_analysis_daily_limit,
    compute_daily_credits_status=_compute_daily_credits_status,
    get_wechat_pay_config=_get_wechat_pay_config,
    to_decimal_amount=_to_decimal_amount,
    generate_membership_order_no=_generate_membership_order_no,
    amount_to_fen=_amount_to_fen,
    build_wechatpay_authorization=_build_wechatpay_authorization,
    expire_pending_membership_orders_for_user=_expire_pending_membership_orders_for_user,
    build_mini_program_pay_params=_build_mini_program_pay_params,
    verify_with_rsa_sha256=_verify_with_rsa_sha256,
    decrypt_wechatpay_resource=_decrypt_wechatpay_resource,
    parse_datetime=_parse_datetime,
    add_months=_add_months,
    build_json_datetime=_build_json_datetime,
    resolve_early_user_membership_meta=_resolve_early_user_membership_meta,
))
app.include_router(create_stats_router(
    china_tz=CHINA_TZ,
    resolve_stats_range_dates=_resolve_stats_range_dates,
    build_body_metrics_summary=_build_body_metrics_summary,
    empty_body_metrics_summary=_empty_body_metrics_summary,
    build_by_meal_calories=_build_by_meal_calories,
    format_health_profile_for_analysis=_format_health_profile_for_analysis,
))
app.include_router(create_food_records_router(
    valid_meal_types=VALID_MEAL_TYPES,
    normalize_meal_type=_normalize_meal_type,
    parse_date_string=_parse_date_string,
    resolve_recorded_on_date=_resolve_recorded_on_date,
    build_record_time_for_recorded_on=_build_record_time_for_recorded_on,
    refresh_stats_insight_for_user=refresh_stats_insight_for_user,
    biz_tracer=_biz_tracer,
    trace_add_event=_trace_add_event,
    trace_record_error=_trace_record_error,
))
app.include_router(manual_food_router)
app.include_router(create_expiry_router(
    china_tz=CHINA_TZ,
    normalize_food_expiry_item=_normalize_food_expiry_item,
    normalize_expiry_status=_normalize_expiry_status,
    normalize_expiry_storage_type=_normalize_expiry_storage_type,
    normalize_expiry_source_type=_normalize_expiry_source_type,
    normalize_subscribe_status=_normalize_subscribe_status,
    parse_date_string=_parse_date_string,
    get_effective_membership=_get_effective_membership,
    format_membership_response=_format_membership_response,
    raise_if_food_analysis_credits_insufficient=_raise_if_food_analysis_credits_insufficient,
    get_food_task_type=_get_food_task_type,
    recognize_food_expiry_from_images_sync=_recognize_food_expiry_from_images_sync,
    reconcile_food_expiry_notification_job=_reconcile_food_expiry_notification_job,
    consume_earned_credits_after_success=_consume_earned_credits_after_success,
    credit_cost_per_food_analysis=CREDIT_COST_PER_FOOD_ANALYSIS,
    expiry_subscribe_accept_statuses=EXPIRY_SUBSCRIBE_ACCEPT_STATUSES,
    expiry_notification_template_id=EXPIRY_NOTIFICATION_TEMPLATE_ID,
))
app.include_router(public_food_library_router)
app.include_router(social_router)
app.include_router(create_recipes_router(_normalize_meal_type))
app.include_router(create_exercise_router(
    china_tz=CHINA_TZ,
    parse_date_string=_parse_date_string,
    resolve_recorded_on_date=_resolve_recorded_on_date,
    get_effective_membership=_get_effective_membership,
    format_membership_response=_format_membership_response,
    raise_if_exercise_credits_insufficient=_raise_if_exercise_credits_insufficient,
    build_exercise_profile_snapshot=_build_exercise_profile_snapshot,
    should_use_exercise_debug_queue=_should_use_exercise_debug_queue,
    consume_earned_credits_after_success=_consume_earned_credits_after_success,
    credit_cost_per_exercise_log=CREDIT_COST_PER_EXERCISE_LOG,
))
app.include_router(create_test_backend_router(
    analyze_with_qwen=_analyze_with_qwen,
    analyze_with_gemini=_analyze_with_gemini,
    build_gemini_prompt=_build_gemini_prompt,
    parse_execution_mode_or_raise=_parse_execution_mode_or_raise,
    parse_analysis_engine_or_raise=_parse_analysis_engine_or_raise,
))
app.include_router(create_prompts_router(require_test_backend_auth))


# 挂载静态文件（放在最后，避免路由冲突）
static_path = os.path.join(os.path.dirname(__file__), "static", "test_backend")
if os.path.exists(static_path):
    app.mount("/static/test_backend", StaticFiles(directory=static_path), name="test_backend_static")
