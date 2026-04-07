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

if os.name == "nt":
    # 这台 Windows 环境下 _wmi.exec_query 可能卡死，进而导致 import httpx 阻塞。
    # 强制让 platform 走非 WMI 的回退路径，避免 worker 启动卡住。
    import platform as _platform

    if hasattr(_platform, "_wmi_query"):
        def _disabled_wmi_query(*_args, **_kwargs):
            raise OSError("WMI query disabled for worker startup")

        _platform._wmi_query = _disabled_wmi_query

import httpx
from database import (
    claim_next_pending_task_sync,
    update_analysis_task_result_sync,
    get_user_by_id_sync,
    get_food_record_by_id_sync,
    get_feed_comment_by_id_sync,
    insert_health_document_sync,
    update_user_sync,
    mark_task_violated_sync,
    create_violation_record_sync,
    claim_next_pending_comment_task_sync,
    update_comment_task_result_sync,
    mark_comment_task_violated_sync,
    add_feed_comment_sync,
    add_public_food_library_comment_sync,
    create_feed_interaction_notification_sync,
    update_public_food_library_status_sync,
    claim_next_pending_food_expiry_notification_job_sync,
    update_food_expiry_notification_job_sync,
    get_food_expiry_item_v2_sync,
)
from metabolic import get_age_from_birthday
from image_compressor import compress_task_images

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
EXPIRY_NOTIFICATION_PAGE = "/pages/expiry/index"
EXPIRY_NOTIFICATION_DEFAULT_HOUR = 9
EXPIRY_NOTIFICATION_RETRY_DELAYS_MINUTES = [5, 30, 120]
_wechat_access_token_cache: Dict[str, Any] = {
    "token": None,
    "fetched_at": 0,
}

VALID_RECOGNITION_OUTCOMES = {"ok", "soft_reject", "hard_reject"}
VALID_ALLOWED_FOOD_CATEGORIES = {"carb", "lean_protein", "unknown"}
FOOD_ANALYSIS_DEBUG = os.getenv("FOOD_ANALYSIS_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
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
TEXT_STRICT_SOFT_GUIDANCE_DEFAULT = [
    "请补充每种主体食物的名称、重量和烹饪方式。",
    "如果一餐包含多种食物，请分别写清每种食物，不要只写整餐总量。",
]
TEXT_AMBIGUOUS_QUANTITY_PATTERN = re.compile(
    r"(适量|少许|一点|一些|少量|若干|大概|大约|差不多|左右|一个?多|几个?|半碗|一碗|一勺|几勺|一点点)"
)


def _get_wechat_access_token_sync() -> str:
    current_time = int(time.time())
    if (
        _wechat_access_token_cache["token"]
        and current_time - int(_wechat_access_token_cache.get("fetched_at") or 0) < 5400
    ):
        return str(_wechat_access_token_cache["token"])

    appid = os.getenv("APPID", "").strip()
    secret = os.getenv("SECRET", "").strip()
    if not appid or not secret:
        raise RuntimeError("缺少 APPID 或 SECRET 环境变量")

    with httpx.Client(timeout=10.0) as client:
        stable_resp = client.post(
            "https://api.weixin.qq.com/cgi-bin/stable_token",
            json={
                "grant_type": "client_credential",
                "appid": appid,
                "secret": secret,
                "force_refresh": False,
            },
        )
        if stable_resp.is_success:
            stable_data = stable_resp.json()
            if not stable_data.get("errcode") and stable_data.get("access_token"):
                _wechat_access_token_cache["token"] = stable_data["access_token"]
                _wechat_access_token_cache["fetched_at"] = current_time
                return str(stable_data["access_token"])

        fallback_resp = client.get(
            "https://api.weixin.qq.com/cgi-bin/token",
            params={
                "grant_type": "client_credential",
                "appid": appid,
                "secret": secret,
            },
        )
        if not fallback_resp.is_success:
            raise RuntimeError(f"获取 access_token 失败: HTTP {fallback_resp.status_code}")
        data = fallback_resp.json()
        if data.get("errcode"):
            raise RuntimeError(f"获取 access_token 失败: {data.get('errmsg') or data.get('errcode')}")
        token = data.get("access_token")
        if not token:
            raise RuntimeError("获取 access_token 失败: access_token 为空")
        _wechat_access_token_cache["token"] = token
        _wechat_access_token_cache["fetched_at"] = current_time
        return str(token)


def _normalize_expiry_item_for_notification(item: Dict[str, Any]) -> Dict[str, Any]:
    item = dict(item)
    expire_date_raw = str(item.get("expire_date") or "").strip()
    days_until_expire: Optional[int] = None
    urgency = "fresh"
    if expire_date_raw:
        try:
            expire_date = datetime.strptime(expire_date_raw, "%Y-%m-%d").date()
            days_until_expire = (expire_date - datetime.now(CHINA_TZ).date()).days
            if days_until_expire < 0:
                urgency = "expired"
            elif days_until_expire == 0:
                urgency = "today"
            elif days_until_expire <= 2:
                urgency = "soon"
        except Exception:
            days_until_expire = None
    item["days_until_expire"] = days_until_expire
    item["urgency"] = urgency
    item["storage_type_label"] = {
        "room_temp": "常温",
        "refrigerated": "冷藏",
        "frozen": "冷冻",
    }.get(str(item.get("storage_type") or "").strip(), "未填写")
    return item


def _build_food_expiry_job_schedule_sync(item: Dict[str, Any]) -> Optional[datetime]:
    expire_date_raw = str(item.get("expire_date") or "").strip()
    if not expire_date_raw:
        return None
    try:
        expire_date = datetime.strptime(expire_date_raw, "%Y-%m-%d").date()
    except Exception:
        return None
    now_local = datetime.now(CHINA_TZ)
    if expire_date < now_local.date():
        return None
    scheduled_local = datetime.combine(
        expire_date,
        datetime.min.time(),
        tzinfo=CHINA_TZ,
    ).replace(hour=EXPIRY_NOTIFICATION_DEFAULT_HOUR, minute=0, second=0, microsecond=0)
    if expire_date == now_local.date() and scheduled_local <= now_local:
        return now_local
    return scheduled_local


def _normalize_food_expiry_character_string(value: Any, fallback: str = "NA") -> str:
    raw = str(value or "").strip()
    if not raw:
        return fallback

    sanitized = re.sub(r"[^A-Za-z0-9\s\-_.,:/+#()xX]", "", raw)
    sanitized = re.sub(r"\s+", " ", sanitized).strip()
    return sanitized[:32] or fallback


def _build_food_expiry_template_payload(item: Dict[str, Any]) -> Dict[str, Any]:
    normalized_item = _normalize_expiry_item_for_notification(item)
    expire_date = str(normalized_item.get("expire_date") or "").strip()
    quantity = _normalize_food_expiry_character_string(normalized_item.get("quantity_note"))
    return {
        "thing1": {"value": str(normalized_item.get("food_name") or "").strip() or "未命名食物"},
        "time2": {"value": f"{expire_date} 09:00" if expire_date else "未填写"},
        "thing3": {"value": "今天到期，请优先处理"},
        "thing4": {"value": str(normalized_item.get("storage_type_label") or "").strip() or "未填写"},
        "character_string5": {"value": quantity},
    }


def _sanitize_food_expiry_template_payload(data: Any, item: Dict[str, Any]) -> Dict[str, Any]:
    fallback = _build_food_expiry_template_payload(item)
    if not isinstance(data, dict):
        return fallback

    sanitized = dict(data)
    character_field = sanitized.get("character_string5")
    raw_value = character_field.get("value") if isinstance(character_field, dict) else None
    sanitized["character_string5"] = {
        "value": _normalize_food_expiry_character_string(raw_value or item.get("quantity_note"))
    }
    return sanitized


def _send_food_expiry_subscribe_message(job: Dict[str, Any], item: Dict[str, Any]) -> Dict[str, Any]:
    access_token = _get_wechat_access_token_sync()
    payload_snapshot = job.get("payload_snapshot") if isinstance(job.get("payload_snapshot"), dict) else {}
    data = _sanitize_food_expiry_template_payload(payload_snapshot.get("data"), item)
    page = str(payload_snapshot.get("page") or EXPIRY_NOTIFICATION_PAGE)

    request_payload = {
        "touser": job.get("openid"),
        "template_id": job.get("template_id"),
        "page": page,
        "data": data,
        "miniprogram_state": "formal",
        "lang": "zh_CN",
    }

    with httpx.Client(timeout=10.0) as client:
        response = client.post(
            f"https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token={access_token}",
            json=request_payload,
        )
    if not response.is_success:
        raise RuntimeError(f"微信通知发送失败: HTTP {response.status_code}")

    result = response.json()
    if result.get("errcode") not in (None, 0):
        raise RuntimeError(f"微信通知发送失败: {result.get('errmsg') or result.get('errcode')}")
    return result


def process_one_food_expiry_notification_job(job: Dict[str, Any]) -> None:
    item_id = str(job.get("expiry_item_id") or "").strip()
    item = get_food_expiry_item_v2_sync(item_id) if item_id else None
    if not item:
        update_food_expiry_notification_job_sync(
            job["id"],
            {"status": "cancelled", "last_error": "关联保质期条目不存在"},
        )
        return

    normalized_item = _normalize_expiry_item_for_notification(item)
    if str(normalized_item.get("status") or "").strip().lower() != "active":
        update_food_expiry_notification_job_sync(
            job["id"],
            {"status": "cancelled", "last_error": "条目已不处于保鲜中"},
        )
        return

    scheduled_local = _build_food_expiry_job_schedule_sync(normalized_item)
    if not scheduled_local:
        update_food_expiry_notification_job_sync(
            job["id"],
            {"status": "cancelled", "last_error": "条目已过期或截止日期无效"},
        )
        return

    scheduled_at = str(job.get("scheduled_at") or "")
    expected_schedule_utc = scheduled_local.astimezone(timezone.utc).isoformat()
    if scheduled_at and expected_schedule_utc > scheduled_at and scheduled_local > datetime.now(CHINA_TZ):
        update_food_expiry_notification_job_sync(
            job["id"],
            {
                "status": "cancelled",
                "last_error": "条目提醒时间已变化，旧任务作废",
            },
        )
        return

    try:
        result = _send_food_expiry_subscribe_message(job, normalized_item)
        update_food_expiry_notification_job_sync(
            job["id"],
            {
                "status": "sent",
                "sent_at": datetime.now(timezone.utc).isoformat(),
                "last_error": None,
                "payload_snapshot": {
                    **(job.get("payload_snapshot") if isinstance(job.get("payload_snapshot"), dict) else {}),
                    "wx_result": result,
                },
            },
        )
    except Exception as exc:
        retry_count = int(job.get("retry_count") or 0) + 1
        max_retry_count = int(job.get("max_retry_count") or len(EXPIRY_NOTIFICATION_RETRY_DELAYS_MINUTES))
        if retry_count >= max_retry_count:
            update_food_expiry_notification_job_sync(
                job["id"],
                {
                    "status": "failed",
                    "retry_count": retry_count,
                    "last_error": str(exc)[:500],
                },
            )
            raise

        delay_index = min(retry_count - 1, len(EXPIRY_NOTIFICATION_RETRY_DELAYS_MINUTES) - 1)
        next_time = datetime.now(timezone.utc) + timedelta(minutes=EXPIRY_NOTIFICATION_RETRY_DELAYS_MINUTES[delay_index])
        update_food_expiry_notification_job_sync(
            job["id"],
            {
                "status": "pending",
                "retry_count": retry_count,
                "scheduled_at": next_time.isoformat(),
                "last_error": str(exc)[:500],
            },
        )
        raise
FOOD_CONTEXT_TERMS = {
    "面包", "吐司", "欧包", "贝果", "汉堡", "三明治", "蛋糕", "饼干", "曲奇", "甜甜圈",
    "蛋挞", "月饼", "包子", "馒头", "饺子", "烧麦", "米饭", "炒饭", "盖饭", "饭团",
    "面条", "拉面", "拌面", "意面", "米线", "米粉", "粥", "汤", "火锅", "麻辣烫",
    "披萨", "薯条", "沙拉", "鸡蛋", "牛奶", "酸奶", "奶茶", "咖啡", "豆浆", "果汁",
    "可乐", "雪碧", "茶", "啤酒", "牛肉", "鸡肉", "猪肉", "鱼肉", "虾", "蛋", "糕点",
    "零食", "饮料", "餐", "食品", "食物",
}
FOOD_BRAND_SLANG_ALLOWLIST = {
    "牛马", "打工人", "摸鱼", "发疯", "躺平", "早八", "社畜", "卷王", "摆烂",
}
EXPLICIT_POLITICS_PATTERN = re.compile(
    r"(习近平|共产党|中共|政府|国家主席|总书记|人大|政协|两会|法轮功|六四|天安门|台独|港独|藏独|疆独|反共|民主运动)"
)
COMMENT_REVIEW_ALLOWLIST = {
    "好吃", "不好吃", "难吃", "一般", "一般般", "推荐", "不推荐", "踩雷", "避雷", "无语",
    "离谱", "太咸", "太甜", "太油", "太辣", "笑死", "哈哈", "呜呜", "哭了", "不错",
}
COMMENT_EXPLICIT_ABUSE_PATTERN = re.compile(
    r"(操你妈|草泥马|傻[逼屄比币]|煞笔|死全家|去死|杀了你|弄死你|强奸|轮奸|约炮|卖淫|嫖娼)",
    re.IGNORECASE,
)
COMMENT_SPAM_PATTERN = re.compile(
    r"(加微|加v|vx|vx|微信|v信|私聊|私信我|联系我|代理|返现|刷单|兼职赚钱|点击链接|二维码|http://|https://|www\.)",
    re.IGNORECASE,
)


def _debug_log_analysis(task: Dict[str, Any], execution_mode: str, stage: str, payload: Any) -> None:
    """在需要时把分析输入/输出直接打印到终端，便于排查 token 与字段膨胀。"""
    if not FOOD_ANALYSIS_DEBUG:
        return
    task_id = str(task.get("id") or "-")
    try:
        if isinstance(payload, (dict, list)):
            body = json.dumps(payload, ensure_ascii=False, indent=2)
        else:
            body = str(payload)
    except Exception as exc:
        body = f"<serialize_failed: {exc}>"
    print(
        f"[food_debug] task_id={task_id} mode={execution_mode} stage={stage}_BEGIN\n"
        f"{body}\n"
        f"[food_debug] task_id={task_id} mode={execution_mode} stage={stage}_END",
        flush=True,
    )


def _strip_standard_mode_extra_fields(result: Dict[str, Any], execution_mode: str) -> Dict[str, Any]:
    """标准模式不允许把模型顺手多吐出的长文本字段继续透传给前端。"""
    if execution_mode == "strict":
        return result
    result["pfc_ratio_comment"] = None
    result["absorption_notes"] = None
    return result


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


def _is_food_context_text(text: str) -> bool:
    normalized = (text or "").strip().lower()
    if not normalized:
        return False
    return any(term in normalized for term in FOOD_CONTEXT_TERMS)


def _should_relax_food_context_moderation(
    text: str,
    category: Optional[str],
    reason: Optional[str] = None,
) -> bool:
    normalized = (text or "").strip().lower()
    category_norm = (category or "").strip().lower()
    reason_norm = (reason or "").strip().lower()
    if category_norm not in {"politics", "inappropriate_text", "other"}:
        return False
    if not _is_food_context_text(normalized):
        return False
    if EXPLICIT_POLITICS_PATTERN.search(normalized) or EXPLICIT_POLITICS_PATTERN.search(reason_norm):
        return False
    if any(token in normalized for token in FOOD_BRAND_SLANG_ALLOWLIST):
        return True
    return True


def _relax_moderation_result_if_needed(
    result: Dict[str, Any],
    *,
    text_context: str = "",
    allow_comment_lenient: bool = False,
) -> Dict[str, Any]:
    if not isinstance(result, dict) or not result.get("is_violation"):
        return result
    category = _normalize_text(result.get("category")) or ""
    reason = _normalize_text(result.get("reason")) or ""
    if _should_relax_food_context_moderation(text_context, category, reason):
        relaxed = dict(result)
        relaxed["is_violation"] = False
        relaxed["category"] = "food_context_allowed"
        relaxed["reason"] = ""
        relaxed["relaxed_by_backend"] = True
        return relaxed
    if allow_comment_lenient and _should_relax_comment_moderation(text_context, category, reason):
        relaxed = dict(result)
        relaxed["is_violation"] = False
        relaxed["category"] = "lenient_comment_allowed"
        relaxed["reason"] = ""
        relaxed["relaxed_by_backend"] = True
        return relaxed
    return result


def _should_relax_comment_moderation(
    text: str,
    category: Optional[str],
    reason: Optional[str] = None,
) -> bool:
    normalized = (text or "").strip().lower()
    if not normalized:
        return False

    category_norm = (category or "").strip().lower()
    reason_norm = (reason or "").strip().lower()
    if category_norm not in {"harassment", "spam", "inappropriate_text", "other", "politics"}:
        return False
    if EXPLICIT_POLITICS_PATTERN.search(normalized) or EXPLICIT_POLITICS_PATTERN.search(reason_norm):
        return False
    if COMMENT_EXPLICIT_ABUSE_PATTERN.search(normalized) or COMMENT_EXPLICIT_ABUSE_PATTERN.search(reason_norm):
        return False
    if COMMENT_SPAM_PATTERN.search(normalized) or COMMENT_SPAM_PATTERN.search(reason_norm):
        return False

    if _is_food_context_text(normalized):
        return True
    if any(term in normalized for term in COMMENT_REVIEW_ALLOWLIST):
        return True
    return len(normalized) <= 30


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


def _normalize_analysis_response_payload(parsed: Any) -> Dict[str, Any]:
    """
    将模型返回归一化为对象结构。
    有些模型偶发会直接返回 items 数组，而不是约定的 JSON 对象。
    """
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


def _parse_analysis_result_items(parsed: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_items = parsed.get("items")
    if not isinstance(raw_items, list):
        return []

    items: List[Dict[str, Any]] = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue
        nutrients = raw_item.get("nutrients")
        if not isinstance(nutrients, dict):
            nutrients = {}
        weight = float(raw_item.get("estimatedWeightGrams") or 0)
        items.append({
            "name": str(raw_item.get("name", "未知食物")),
            "estimatedWeightGrams": weight,
            "originalWeightGrams": weight,
            "nutrients": {
                "calories": float(nutrients.get("calories") or 0),
                "protein": float(nutrients.get("protein") or 0),
                "carbs": float(nutrients.get("carbs") or 0),
                "fat": float(nutrients.get("fat") or 0),
                "fiber": float(nutrients.get("fiber") or 0),
                "sugar": float(nutrients.get("sugar") or 0),
            },
        })
    return items


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


def _append_unique(target: List[str], value: Optional[str]) -> None:
    text = _normalize_text(value)
    if text and text not in target:
        target.append(text)


def _derive_text_followup_questions(
    parsed: Dict[str, Any],
    text_input: str,
    items: List[Dict[str, Any]],
    allowed_food_category: str,
    scene_tags: List[str],
) -> List[str]:
    questions = _normalize_string_list(parsed.get("followupQuestions"))
    raw_text = f"{text_input} {_normalize_text(parsed.get('description')) or ''}"

    if not items:
        _append_unique(questions, "请重新描述这顿饭的主体食物，并分别写出每种食物的大致重量。")
    if len(items) > 1 or "mixed_food" in scene_tags or "multiple_items" in scene_tags:
        _append_unique(questions, "如果这顿饭包含多种食物，请分别写出每种食物名称和重量，不要只写整餐总量。")
    if allowed_food_category == "unknown" or "unsupported_food" in scene_tags:
        _append_unique(questions, "如果你想按精准模式执行，请明确哪些是单纯碳水、哪些是单纯瘦肉，并分别描述。")
    if (
        "portion_unclear" in scene_tags
        or "weight_uncertain" in scene_tags
        or TEXT_AMBIGUOUS_QUANTITY_PATTERN.search(raw_text)
    ):
        _append_unique(questions, "请补充每种食物的大致克数或更具体的份量，例如米饭 180g、鸡胸肉 150g。")
    if "cook_method_unclear" in scene_tags or "heavy_sauce_or_fried" in scene_tags:
        _append_unique(questions, "请补充主要烹饪方式，例如水煮、清炒、煎炸、带酱汁等。")
    if "fatty_or_unclear_meat" in scene_tags:
        _append_unique(questions, "请说明肉类是否为去皮鸡胸、瘦牛肉、鱼肉等单纯瘦肉。")

    return questions


def _derive_text_recognition_fields(
    parsed: Dict[str, Any],
    items: List[Dict[str, Any]],
    execution_mode: str,
    text_input: str,
) -> Dict[str, Any]:
    allowed_food_category = _normalize_allowed_food_category(parsed.get("allowedFoodCategory"))
    recognition_outcome = _normalize_recognition_outcome(parsed.get("recognitionOutcome"))
    scene_tags = _normalize_scene_tags(parsed.get("sceneTags"))
    guidance = _normalize_string_list(parsed.get("retakeGuidance"))
    model_reason = _normalize_text(parsed.get("rejectionReason"))
    followup_questions = _derive_text_followup_questions(
        parsed,
        text_input=text_input,
        items=items,
        allowed_food_category=allowed_food_category,
        scene_tags=scene_tags,
    )

    if execution_mode != "strict":
        return {
            "recognitionOutcome": recognition_outcome or "ok",
            "rejectionReason": model_reason if recognition_outcome in {"soft_reject", "hard_reject"} else None,
            "retakeGuidance": guidance or None,
            "allowedFoodCategory": allowed_food_category,
            "followupQuestions": followup_questions or None,
        }

    soft_reasons: List[str] = []
    if not items:
        soft_reasons.append("当前描述还不足以稳定识别主体食物，建议补充更明确的食物名称和重量。")
    if allowed_food_category == "unknown":
        soft_reasons.append("当前描述还不能确认是精准模式支持的单纯碳水或单纯瘦肉。")

    for tag in scene_tags:
        reason = STRICT_REASON_BY_TAG.get(tag)
        if reason and reason not in soft_reasons:
            soft_reasons.append(reason)

    if model_reason:
        _append_unique(soft_reasons, model_reason)
    if followup_questions and not soft_reasons:
        soft_reasons.append("当前记录还缺少几个关键信息，补充后会更适合精准模式。")

    return {
        "recognitionOutcome": "soft_reject" if soft_reasons or followup_questions else "ok",
        "rejectionReason": soft_reasons[0] if soft_reasons else None,
        "retakeGuidance": _merge_guidance(guidance, TEXT_STRICT_SOFT_GUIDANCE_DEFAULT) if (soft_reasons or followup_questions) else (guidance or None),
        "allowedFoodCategory": allowed_food_category,
        "followupQuestions": followup_questions or None,
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


def _format_health_risk_summary_sync(user: Dict[str, Any]) -> str:
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
注意：食品包装、菜单、商品标签、品牌名、玩梗文案里出现的“牛马”“打工人”“摸鱼”等词，如果语境明显是在描述食物商品本身，不算政治敏感。
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
注意：食品名称、菜单名、品牌名、包装文案中的玩梗词或谐音词（例如“牛马面包”）只要明显是在描述食物本身，就不算政治敏感。
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
        text_context = ""
        if task_type in ("food_text", "public_food_library_text"):
            text_context = text_input
        else:
            payload = task.get("payload") or {}
            text_context = str(payload.get("additionalContext") or "")
        result = _relax_moderation_result_if_needed(result, text_context=text_context)
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


def _safe_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    try:
        if value is None or value == "":
            return default
        return int(value)
    except Exception:
        return default


def _normalize_food_name(name: Any) -> str:
    raw = str(name or "").strip().lower()
    if not raw:
        return ""
    compact = re.sub(r"\s+", "", raw)
    compact = re.sub(r"[()（）\[\]【】,，。./\\\-_:：;；·]", "", compact)
    return compact


def _find_match_index_by_item_id(items: list, target_item_id: Optional[int], used_indexes: set) -> Optional[int]:
    if target_item_id is None:
        return None
    for idx, item in enumerate(items):
        if idx in used_indexes:
            continue
        item_id = _safe_int((item or {}).get("itemId"))
        if item_id == target_item_id:
            return idx
    return None


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

    additional = (payload.get("additionalContext") or "").strip()
    additional_line = (
        f'\n用户本轮纠错说明: "{additional}"。请严格按照此说明修正结果。'
    ) if additional else ""

    is_multi_view = payload.get("is_multi_view")
    multi_view_hint = "\n注意：提供的图片是**同一份食物**的不同视角拍摄（用于辅助展示侧面或厚度）。请综合所有图片来估算这份食物的体积和重量，**不要**将它们视为多份不同的食物。" if is_multi_view else ""
    execution_mode = str(payload.get("execution_mode") or "standard").strip().lower()
    if execution_mode not in {"standard", "strict"}:
        execution_mode = "standard"
    if execution_mode == "standard":
        standard_context_parts = []
        if additional:
            standard_context_parts.append(
                "用户纠错说明：\n" + additional
            )
        if previous_result_block:
            standard_context_parts.append(previous_result_block.strip())
        standard_context_block = (
            "\n\n" + "\n\n".join(standard_context_parts)
        ) if standard_context_parts else ""
        compact_tags = []
        if meal_name:
            compact_tags.append(f"餐次:{meal_name}")
        if state_parts:
            compact_tags.append("状态:" + "/".join(state_parts))
        if remaining is not None:
            try:
                compact_tags.append(f"剩余:{float(remaining):g}kcal")
            except Exception:
                compact_tags.append(f"剩余:{remaining}kcal")
        if profile_block:
            compact_tags.append(profile_block)
        compact_tag_block = ("\n".join(compact_tags) + "\n") if compact_tags else ""

        return f"""
{multi_view_hint}
识别图片中的食物，估算重量和营养，仅返回 JSON。{standard_context_block}
备注：包装文案中的“牛马/打工人/摸鱼”若明显是商品名，不要误判。
{compact_tag_block}估重时请优先看：占盘面积、厚度/高度、堆叠体积、容器大小、透视关系。
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
  "items": [
    {{
      "name": "食物名称",
      "estimatedWeightGrams": 重量（数字）,
      "nutrients": {{ "calories": 数字, "protein": 数字, "carbs": 数字, "fat": 数字, "fiber": 数字, "sugar": 数字 }}
    }}
  ],
  "description": "餐食描述",
  "insight": "一句话建议",
  "context_advice": ""
}}
""".strip()

    mode_hint = (
        "\n执行模式：精准模式（strict）"
        "\n- 优先识别单纯碳水或单纯瘦肉。"
        "\n- 混合食物、重油烹饪、肥瘦不明时，不要给确定克数。"
        "\n- 请在 insight/context_advice 明确提示“分开拍、拨开拍或重拍”。"
    )

    return f"""
{multi_view_hint}
请作为专业的营养师分析这些食物图片。
这是一轮基于"原始图片 + 第一轮结果 + 用户纠错说明"的重新生成。
{previous_result_block}
{additional_line}

信息优先级（高到低）：
1. 本轮用户纠错说明
2. 第一轮分析输出
3. 原始图片视觉信息

如果用户纠错说明与之前结果冲突，必须以用户说明为准。
如果图片主体是食品、饮料、食品包装或菜单，且画面中的"牛马""打工人""摸鱼"等词只是商品名、品牌名或包装文案，不要因此判定为政治敏感或违规。

1. 识别图中所有不同的食物单品。
2. 重新估算每种食物的重量（克）和详细营养成分；当用户纠错说明给出了更明确重量时，请体现到本轮结果中。
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
OFOX_BASE_URL = os.getenv("OFOXAI_BASE_URL", "https://api.ofox.ai/v1")
OFOX_MODEL_NAME = os.getenv("OFOX_MODEL_NAME", os.getenv("GEMINI_MODEL_NAME", "gemini-3-flash-preview"))
OFOX_VISION_MODEL_NAME = os.getenv("OFOX_VISION_MODEL_NAME", OFOX_MODEL_NAME)
OFOX_TEXT_MODEL_NAME = os.getenv("OFOX_TEXT_MODEL_NAME", OFOX_MODEL_NAME)
COMMENT_MODERATION_MODEL = os.getenv("COMMENT_MODERATION_MODEL", "openai/gpt-5.4-nano")
COMMENT_MODERATION_TIMEOUT_SECONDS = float(os.getenv("COMMENT_MODERATION_TIMEOUT_SECONDS", "8"))


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
        model = OFOX_VISION_MODEL_NAME
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
    _debug_log_analysis(
        task,
        execution_mode,
        "task_input",
        {
            "task_type": task.get("task_type"),
            "image_url": image_url,
            "image_paths": image_paths,
            "payload": payload,
        },
    )

    user_id = task.get("user_id")
    user = get_user_by_id_sync(user_id) if user_id else None
    profile_block = ""
    if user:
        profile_block = _format_health_profile_sync(user) if execution_mode == "strict" else _format_health_risk_summary_sync(user)
        if profile_block and execution_mode == "strict":
            profile_fields = "insight、absorption_notes、context_advice" if execution_mode == "strict" else "insight、context_advice"
            profile_block = (
                f"\n\n若以下存在「用户健康档案」，请结合档案在 {profile_fields} 中给出更贴合该用户体质与健康状况的建议。\n\n"
                + profile_block
            )

    prompt = _build_food_prompt(task, profile_block)
    _debug_log_analysis(
        task,
        execution_mode,
        "prompt",
        {
            "provider": llm_provider,
            "model": model,
            "image_count": len(target_image_urls),
            "prompt": prompt,
        },
    )
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
                _debug_log_analysis(task, execution_mode, "response_usage", data.get("usage") or {})
                _debug_log_analysis(task, execution_mode, "raw_model_output", content or "")
                if not content:
                    print(f"[worker] Food analysis attempt {attempt + 1} empty response")
                    if attempt < max_retries - 1:
                        time.sleep(1)
                        continue
                    raise RuntimeError("AI 返回了空响应")

                json_str = re.sub(r"```json", "", content)
                json_str = re.sub(r"```", "", json_str).strip()
                parsed = _normalize_analysis_response_payload(json.loads(json_str))
                break  # 成功，跳出重试循环

        except Exception as e:
            print(f"[worker] Food analysis attempt {attempt + 1} exception: {e}")
            if attempt < max_retries - 1:
                time.sleep(1)
            else:
                # hide internal model details
                raise RuntimeError("系统繁忙，请稍后重试")

    # 转为与 API 一致的 result 结构（供前端与保存记录使用）
    items = _parse_analysis_result_items(parsed)

    # 二次纠错完全信任模型输出，不做后处理覆盖

    result = {
        "description": str(parsed.get("description", "无法获取描述")),
        "insight": str(parsed.get("insight", "保持健康饮食！")),
        "items": items,
        "pfc_ratio_comment": (parsed.get("pfc_ratio_comment") or "").strip() or None,
        "absorption_notes": (parsed.get("absorption_notes") or "").strip() or None,
        "context_advice": (parsed.get("context_advice") or "").strip() or None,
    }
    result = _strip_standard_mode_extra_fields(result, execution_mode)
    if execution_mode == "strict":
        result.update(_derive_recognition_fields(parsed or {}, items, execution_mode))
    _debug_log_analysis(task, execution_mode, "final_result", result)
    return result


def _get_task_image_urls(task: Dict[str, Any]) -> List[str]:
    """Extract all image URLs from a task."""
    paths = task.get("image_paths")
    if paths and isinstance(paths, list) and len(paths) > 0:
        return paths
    url = task.get("image_url")
    return [url] if url else []


def process_one_food_task(task: Dict[str, Any]) -> None:
    """处理单条食物分析任务：直接执行分析并写回 done/failed。"""
    task_id = task["id"]
    try:
        print(f"[food_analysis] MODERATION_SKIPPED task_id={task_id} type=image", flush=True)
        result = run_food_analysis_sync(task)
        
        # 更新结果，如果被取消则跳过
        updated = update_analysis_task_result_sync(task_id, status="done", result=result)
        if not updated:
            print(f"[food_analysis] 任务 {task_id} 已被取消，放弃结果写入", flush=True)
            return

        try:
            compress_task_images(_get_task_image_urls(task))
        except Exception:
            pass
    except Exception as e:
        err_msg = str(e) or type(e).__name__
        updated = update_analysis_task_result_sync(task_id, status="failed", error_message=err_msg)
        if not updated:
            print(f"[food_analysis] 任务 {task_id} 已被取消，放弃错误写入", flush=True)


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

    additional = (payload.get("additionalContext") or "").strip()
    additional_line = (
        f'\n用户本轮纠错说明: "{additional}"。请严格按照此说明修正结果。'
    ) if additional else ""


    execution_mode = str(payload.get("execution_mode") or "standard").strip().lower()
    if execution_mode not in {"standard", "strict"}:
        execution_mode = "standard"
    standard_profile_fields = "insight、context_advice" if execution_mode == "standard" else "insight、absorption_notes、context_advice"
    profile_hint = f"\n\n若以下存在「用户健康档案」，请结合档案在 {standard_profile_fields} 中给出更贴合该用户体质与健康状况的建议。\n\n{profile_block}" if profile_block else ""

    if execution_mode == "standard":
        standard_context_parts = []
        if additional:
            standard_context_parts.append(
                "用户纠错说明：\n" + additional
            )
        if previous_result_block:
            standard_context_parts.append(previous_result_block.strip())
        standard_context_block = (
            "\n\n" + "\n\n".join(standard_context_parts)
        ) if standard_context_parts else ""
        compact_tags = []
        if meal_name:
            compact_tags.append(f"餐次:{meal_name}")
        if state_parts:
            compact_tags.append("状态:" + "/".join(state_parts))
        if remaining is not None:
            try:
                compact_tags.append(f"剩余:{float(remaining):g}kcal")
            except Exception:
                compact_tags.append(f"剩余:{remaining}kcal")
        if profile_block:
            compact_tags.append(profile_block)
        compact_tag_block = ("\n".join(compact_tags) + "\n") if compact_tags else ""

        return f"""
识别用户描述的食物，估算重量和营养，仅返回 JSON。
用户描述:{text_input}{standard_context_block}
{compact_tag_block}输出要求：
- 简体中文
- description <= 16字
- insight 1-2句，<= 32字
- context_advice 1-2句，<= 32字，无需则空字符串
- 建议写得自然一点，但不要空泛和重复
- 若用户纠错说明给出明确名称/重量，必须优先采用
- 只返回 JSON

{{
  "items": [
    {{
      "name": "食物名称",
      "estimatedWeightGrams": 重量（数字）,
      "nutrients": {{ "calories": 数字, "protein": 数字, "carbs": 数字, "fat": 数字, "fiber": 数字, "sugar": 数字 }}
    }}
  ],
  "description": "餐食描述",
  "insight": "一句话建议",
  "context_advice": ""
}}
""".strip()

    mode_hint = (
        "\n执行模式：精准模式（strict）"
        "\n- 优先识别单纯碳水或单纯瘦肉。"
        "\n- 混合描述、重量不明、烹饪方式不明时，不要过度自信。"
        "\n- 如描述仍有歧义，请给出初步结果，并列出还需要用户补充的问题，不要直接把记录链路堵死。"
    )

    return f"""
请作为专业的营养师分析用户描述的食物。
这不是第一次分析，而是一次“基于上一轮结果的二次纠错分析”。

用户描述：{text_input}
{previous_result_block}
{additional_line}

信息优先级（高到低）：
1. 本轮用户主要纠错说明
2. 上一轮分析输出 / 当前结果页基线
3. 原始用户描述


如果高优先级信息和低优先级信息冲突，必须以前者为准。
不要机械复用上一轮结果；你需要根据本轮文字说明重新得出更新后的食物、重量与营养。

任务：
1. 识别描述中的所有食物单品。
2. 估算每种食物的合理重量（克）和详细营养成分；如果用户纠错说明给出了明确的重量，按用户说明确定。
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
   - followupQuestions: 若当前描述仍缺少精准模式关键细节，请返回 1-3 条要追问用户的具体问题；否则返回空数组
   - sceneTags: 仅从以下枚举中选择 0 个或多个：
     single_carb, single_lean_protein, mixed_food, multiple_items, fatty_or_unclear_meat, unsupported_food, portion_unclear, cook_method_unclear, weight_uncertain, heavy_sauce_or_fried
10. 在精准模式下：
   - 如果描述不是单纯碳水或单纯瘦肉，优先返回 soft_reject，并通过 followupQuestions 引导用户拆开补充
   - 如果主体类型基本对，但分量、烹饪方式或重量仍不够确定，请返回 soft_reject，并明确追问缺失信息
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
  "followupQuestions": ["请补充问题1", "请补充问题2"],
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
        model = OFOX_TEXT_MODEL_NAME
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
    _debug_log_analysis(
        task,
        execution_mode,
        "task_input",
        {
            "task_type": task.get("task_type"),
            "text_input": text_input,
            "payload": payload,
        },
    )

    user_id = task.get("user_id")
    user = get_user_by_id_sync(user_id) if user_id else None
    profile_block = ""
    if user:
        profile_block = _format_health_profile_sync(user) if execution_mode == "strict" else _format_health_risk_summary_sync(user)

    prompt = _build_text_food_prompt(task, profile_block)
    _debug_log_analysis(
        task,
        execution_mode,
        "prompt",
        {
            "provider": llm_provider,
            "model": model,
            "text_input": text_input,
            "prompt": prompt,
        },
    )

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
                _debug_log_analysis(task, execution_mode, "response_usage", data.get("usage") or {})
                _debug_log_analysis(task, execution_mode, "raw_model_output", content or "")
                if not content:
                    print(f"[worker] Text food analysis attempt {attempt + 1} empty response")
                    if attempt < max_retries - 1:
                        time.sleep(1)
                        continue
                    raise RuntimeError("AI 返回了空响应")

                json_str = re.sub(r"```json", "", content)
                json_str = re.sub(r"```", "", json_str).strip()
                parsed = _normalize_analysis_response_payload(json.loads(json_str))
                break # 成功，跳出重试循环

        except Exception as e:
            print(f"[worker] Text food analysis attempt {attempt + 1} exception: {e}")
            if attempt < max_retries - 1:
                time.sleep(1)
            else:
                # hide internal model details
                raise RuntimeError("系统繁忙，请稍后重试")

    # 转为与 API 一致的 result 结构
    items = _parse_analysis_result_items(parsed)
    # 二次纠错完全信任模型输出，不做后处理覆盖

    result = {
        "description": str(parsed.get("description", "无法获取描述")),
        "insight": str(parsed.get("insight", "保持健康饮食！")),
        "items": items,
        "pfc_ratio_comment": (parsed.get("pfc_ratio_comment") or "").strip() or None,
        "absorption_notes": (parsed.get("absorption_notes") or "").strip() or None,
        "context_advice": (parsed.get("context_advice") or "").strip() or None,
    }
    result = _strip_standard_mode_extra_fields(result, execution_mode)
    if execution_mode == "strict":
        result.update(_derive_text_recognition_fields(parsed or {}, items, execution_mode, text_input))
    _debug_log_analysis(task, execution_mode, "final_result", result)
    return result


def process_one_text_food_task(task: Dict[str, Any]) -> None:
    """处理单条文字食物分析任务：直接执行分析并写回 done/failed。"""
    task_id = task["id"]
    try:
        print(f"[food_analysis] MODERATION_SKIPPED task_id={task_id} type=text", flush=True)
        result = run_text_food_analysis_sync(task)
        updated = update_analysis_task_result_sync(task_id, status="done", result=result)
        if not updated:
            print(f"[food_analysis] 任务 {task_id} 已被取消，放弃结果写入", flush=True)
    except Exception as e:
        err_msg = str(e) or type(e).__name__
        updated = update_analysis_task_result_sync(task_id, status="failed", error_message=err_msg)
        if not updated:
            print(f"[food_analysis] 任务 {task_id} 已被取消，放弃错误写入", flush=True)


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
            updated = update_analysis_task_result_sync(task_id, status="done", result={"status": "approved"})
            if not updated:
                print(f"[worker] 任务 {task_id} 已被取消，放弃结果写入", flush=True)
    except Exception as e:
        err_msg = str(e) or type(e).__name__
        updated = update_analysis_task_result_sync(task_id, status="failed", error_message=err_msg)
        if not updated:
            print(f"[worker] 任务 {task_id} 已被取消，放弃错误写入", flush=True)


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
        updated = update_analysis_task_result_sync(task_id, status="done", result={"extracted_content": extracted})
        if not updated:
            print(f"[health_report] 任务 {task_id} 已被取消，放弃结果写入", flush=True)
    except Exception as e:
        err_msg = str(e) or type(e).__name__
        updated = update_analysis_task_result_sync(task_id, status="failed", error_message=err_msg)
        if not updated:
            print(f"[health_report] 任务 {task_id} 已被取消，放弃错误写入", flush=True)


def _comment_moderation_prompt(content: str) -> str:
    """评论内容审核提示词。"""
    return f"""
你是一个“宽松优先”的评论审核系统。请分析以下用户评论内容，判断是否存在明确违规情况：

评论内容："{content}"

判断标准：
1. 明确色情、低俗、露骨招嫖内容
2. 明确暴力威胁、血腥恐怖、教唆伤害内容
3. 明确违法犯罪、毒品、诈骗、引流拉群、联系方式广告
4. 明确政治敏感、煽动、地域歧视、仇恨攻击
5. 明确且强烈的人身攻击、辱骂、诅咒、骚扰

放宽原则：
- 默认放行。只有“明确违规且把握很高”时才判定违规。
- 普通吐槽、轻微负面评价、情绪化口语、重复字、语气词、表情、简短回复，不算违规。
- 正常的食物评价（如“好吃”“一般”“不推荐”“踩雷”“味道怪怪的”）不算违规。
- 食品名、套餐名、门店活动文案、玩梗菜名中的“牛马”“打工人”等词，只要明显在讨论食物或商品，不按政治敏感处理。
- 如果只是态度不好、但没有明确辱骂/威胁/歧视/广告，请放行。
- 如果拿不准，请返回不违规。

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
    api_key = os.getenv("OFOXAI_API_KEY") or os.getenv("ofox_ai_apikey")
    if not api_key or api_key == "your_ofoxai_api_key_here":
        print("[comment_moderation] 缺少 OFOXAI_API_KEY，跳过审核")
        return None

    api_url = f"{OFOX_BASE_URL}/chat/completions"

    try:
        with httpx.Client(timeout=COMMENT_MODERATION_TIMEOUT_SECONDS) as client:
            response = client.post(
                api_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": COMMENT_MODERATION_MODEL,
                    "messages": [{"role": "user", "content": _comment_moderation_prompt(content)}],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.0,
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
        result = _relax_moderation_result_if_needed(
            result,
            text_context=content,
            allow_comment_lenient=True,
        )
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
    extra = task.get("extra") or {}
    
    try:
        # 第一步：内容审核
        moderation = run_comment_moderation_sync(content)
        if moderation and moderation.get("is_violation"):
            reason = moderation.get("reason", "评论内容违规")
            print(f"[comment_worker] 任务 {task_id} 评论违规: {reason}")
            mark_comment_task_violated_sync(task_id, reason)
            try:
                create_feed_interaction_notification_sync(
                    recipient_user_id=user_id,
                    notification_type="comment_rejected",
                    content_preview=reason[:120],
                )
            except Exception as notify_err:
                print(f"[comment_worker] 创建评论拒绝通知失败: {notify_err}")
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
            parent_comment_id = extra.get("parent_comment_id")
            reply_to_user_id = extra.get("reply_to_user_id")
            comment = add_feed_comment_sync(
                user_id,
                target_id,
                content,
                parent_comment_id=parent_comment_id,
                reply_to_user_id=reply_to_user_id,
            )
        elif comment_type == "public_food_library":
            comment = add_public_food_library_comment_sync(user_id, target_id, content, rating)
        else:
            raise ValueError(f"未知的评论类型: {comment_type}")
        
        if comment_type == "feed":
            try:
                record = get_food_record_by_id_sync(target_id)
                record_owner_id = (record or {}).get("user_id")
                if record_owner_id and record_owner_id != user_id:
                    create_feed_interaction_notification_sync(
                        recipient_user_id=record_owner_id,
                        actor_user_id=user_id,
                        record_id=target_id,
                        comment_id=comment.get("id"),
                        parent_comment_id=extra.get("parent_comment_id"),
                        notification_type="comment_received",
                        content_preview=(content or "")[:120],
                    )

                reply_to_user_id = extra.get("reply_to_user_id")
                parent_comment_id = extra.get("parent_comment_id")
                if reply_to_user_id and reply_to_user_id != user_id:
                    create_feed_interaction_notification_sync(
                        recipient_user_id=reply_to_user_id,
                        actor_user_id=user_id,
                        record_id=target_id,
                        comment_id=comment.get("id"),
                        parent_comment_id=parent_comment_id,
                        notification_type="reply_received",
                        content_preview=(content or "")[:120],
                    )
                elif parent_comment_id:
                    parent_comment = get_feed_comment_by_id_sync(parent_comment_id)
                    parent_owner_id = (parent_comment or {}).get("user_id")
                    if parent_owner_id and parent_owner_id != user_id:
                        create_feed_interaction_notification_sync(
                            recipient_user_id=parent_owner_id,
                            actor_user_id=user_id,
                            record_id=target_id,
                            comment_id=comment.get("id"),
                            parent_comment_id=parent_comment_id,
                            notification_type="reply_received",
                            content_preview=(content or "")[:120],
                        )
            except Exception as notify_err:
                print(f"[comment_worker] 创建圈子互动通知失败: {notify_err}")

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
    
    # 指数退避计数器
    backoff_count = 0
    max_backoff = 30  # 最大退避 30 秒
    
    while True:
        try:
            task = claim_next_pending_comment_task_sync()
            if task:
                print(f"[comment-worker-{worker_id}] 处理任务 {task['id']}", flush=True)
                process_one_comment_task(task)
                print(f"[comment-worker-{worker_id}] 任务 {task['id']} 完成", flush=True)
                backoff_count = 0  # 成功处理任务后重置退避
            else:
                backoff_count = 0  # 正常无任务也重置
                time.sleep(poll_interval)
        except KeyboardInterrupt:
            print(f"[comment-worker-{worker_id}] 退出", flush=True)
            break
        except Exception as e:
            # 使用指数退避，避免网络故障时频繁重试
            backoff_count = min(backoff_count + 1, max_backoff)
            sleep_time = min(poll_interval + backoff_count, max_backoff)
            error_msg = str(e)[:100]
            print(f"[comment-worker-{worker_id}] 错误: {error_msg}，{sleep_time}s 后重试", flush=True)
            time.sleep(sleep_time)


def run_food_expiry_notification_worker(worker_id: int, poll_interval: float = 2.0) -> None:
    """保质期提醒 Worker 进程入口。"""
    print(f"[expiry-notify-worker-{worker_id}] 启动，处理保质期通知任务", flush=True)
    backoff_count = 0
    max_backoff = 30

    while True:
        try:
            job = claim_next_pending_food_expiry_notification_job_sync()
            if job:
                print(f"[expiry-notify-worker-{worker_id}] 处理任务 {job['id']}", flush=True)
                process_one_food_expiry_notification_job(job)
                print(f"[expiry-notify-worker-{worker_id}] 任务 {job['id']} 完成", flush=True)
                backoff_count = 0
            else:
                backoff_count = 0
                time.sleep(poll_interval)
        except KeyboardInterrupt:
            print(f"[expiry-notify-worker-{worker_id}] 退出", flush=True)
            break
        except Exception as e:
            backoff_count = min(backoff_count + 1, max_backoff)
            sleep_time = min(poll_interval + backoff_count, max_backoff)
            error_msg = str(e)[:100]
            print(f"[expiry-notify-worker-{worker_id}] 错误: {error_msg}，{sleep_time}s 后重试", flush=True)
            time.sleep(sleep_time)


def run_worker(worker_id: int, task_type: str = "food", poll_interval: float = 2.0) -> None:
    """
    单 Worker 进程入口：循环抢占 pending 任务并处理。
    task_type: food | food_text | health_report
    """
    print(f"[worker-{worker_id}] 启动，任务类型: {task_type}", flush=True)
    
    # 根据任务类型选择处理函数
    processor_map = {
        "food": process_one_food_task,
        "food_debug": process_one_food_task,
        "food_text": process_one_text_food_task,
        "food_text_debug": process_one_text_food_task,
        "health_report": process_one_health_report_task,
        "public_food_library_text": process_one_public_library_moderation_task,
    }
    processor = processor_map.get(task_type)
    if not processor:
        raise ValueError(f"不支持的任务类型: {task_type}")
    
    # 指数退避计数器
    backoff_count = 0
    max_backoff = 30  # 最大退避 30 秒
    
    while True:
        try:
            task = claim_next_pending_task_sync(task_type)
            if task:
                print(f"[worker-{worker_id}] 处理任务 {task['id']}", flush=True)
                processor(task)
                print(f"[worker-{worker_id}] 任务 {task['id']} 完成", flush=True)
                backoff_count = 0  # 成功处理任务后重置退避
            else:
                backoff_count = 0  # 正常无任务也重置
                time.sleep(poll_interval)
        except KeyboardInterrupt:
            print(f"[worker-{worker_id}] 退出", flush=True)
            break
        except Exception as e:
            # 使用指数退避，避免网络故障时频繁重试
            backoff_count = min(backoff_count + 1, max_backoff)
            sleep_time = min(poll_interval + backoff_count, max_backoff)
            error_msg = str(e)[:100]
            print(f"[worker-{worker_id}] 错误: {error_msg}，{sleep_time}s 后重试", flush=True)
            time.sleep(sleep_time)


if __name__ == "__main__":
    # 单独运行本文件时：单进程 Worker（用于调试）
    run_worker(worker_id=0, task_type="food")
