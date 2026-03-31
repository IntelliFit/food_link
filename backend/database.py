"""
数据库操作模块
使用 Supabase 进行数据操作
"""
from supabase import create_client
import os
import base64
import uuid
import re
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List
from collections import Counter

# 中国时区（UTC+8），用于按本地自然日统计
CHINA_TZ = timezone(timedelta(hours=8))

# 体检报告图片存储桶名，需在 Supabase Dashboard → Storage 中创建并设为 Public
HEALTH_REPORTS_BUCKET = "health-reports"

# 食物分析图片存储桶名，需在 Supabase Dashboard → Storage 中创建并设为 Public
FOOD_ANALYZE_BUCKET = "food-images"

# 用户头像存储桶名，需在 Supabase Dashboard → Storage 中创建并设为 Public
USER_AVATARS_BUCKET = "user-avatars"

# 延迟初始化 Supabase 客户端
_supabase_client = None


def get_supabase_client():
    """
    获取 Supabase 客户端（延迟初始化）
    确保在 load_dotenv() 之后才初始化
    """
    global _supabase_client
    
    if _supabase_client is None:
        SUPABASE_URL = os.getenv("SUPABASE_URL")
        SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        
        if SUPABASE_URL and SUPABASE_SERVICE_KEY:
            _supabase_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        else:
            raise Exception("Supabase 未配置，请设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 环境变量")
    
    return _supabase_client


def check_supabase_configured():
    """检查 Supabase 是否已配置"""
    try:
        get_supabase_client()
    except Exception as e:
        raise Exception("Supabase 未配置，请设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 环境变量")


async def get_user_by_openid(openid: str) -> Optional[Dict[str, Any]]:
    """
    通过 openid 查询用户
    
    Args:
        openid: 微信 openid
    
    Returns:
        用户信息字典，如果不存在则返回 None
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    
    try:
        result = supabase.table("weapp_user")\
            .select("*")\
            .eq("openid", openid)\
            .execute()
        
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_user_by_openid] 错误: {e}")
        raise


async def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    """
    通过 user_id 查询用户
    
    Args:
        user_id: 用户 ID (UUID)
    
    Returns:
        用户信息字典，如果不存在则返回 None
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    
    try:
        result = supabase.table("weapp_user")\
            .select("*")\
            .eq("id", user_id)\
            .execute()
        
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_user_by_id] 错误: {e}")
        raise


def get_user_by_id_sync(user_id: str) -> Optional[Dict[str, Any]]:
    """同步版：通过 user_id 查询用户，供 Worker 子进程使用。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("weapp_user").select("*").eq("id", user_id).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_user_by_id_sync] 错误: {e}")
        raise


async def create_user(user_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    创建新用户
    
    Args:
        user_data: 用户数据字典，包含 openid, unionid, avatar, nickname, telephone
    
    Returns:
        创建的用户信息字典
    
    Raises:
        Exception: 如果创建失败
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    
    try:
        result = supabase.table("weapp_user")\
            .insert(user_data)\
            .execute()
        
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("创建用户失败：返回数据为空")
    except Exception as e:
        print(f"[create_user] 错误: {e}")
        # 如果是唯一约束冲突，尝试查询已存在的用户
        if "duplicate" in str(e).lower() or "unique" in str(e).lower():
            if "openid" in user_data:
                existing_user = await get_user_by_openid(user_data["openid"])
                if existing_user:
                    return existing_user
        raise


async def update_user(user_id: str, update_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    更新用户信息

    Args:
        user_id: 用户 ID (UUID)
        update_data: 要更新的数据字典（可含健康档案字段：height, weight, birthday, gender, activity_level, health_condition, bmr, tdee, onboarding_completed）

    Returns:
        更新后的用户信息字典

    Raises:
        Exception: 如果更新失败
    """
    check_supabase_configured()
    supabase = get_supabase_client()

    try:
        result = supabase.table("weapp_user")\
            .update(update_data)\
            .eq("id", user_id)\
            .execute()

        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("更新用户失败：返回数据为空")
    except Exception as e:
        print(f"[update_user] 错误: {e}")
        print(f"[update_user] 尝试更新的键: {list(update_data.keys())}")
        raise


def update_user_sync(user_id: str, update_data: Dict[str, Any]) -> Dict[str, Any]:
    """同步版：更新用户信息，供 Worker 子进程使用。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("weapp_user").update(update_data).eq("id", user_id).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("更新用户失败：返回数据为空")
    except Exception as e:
        print(f"[update_user_sync] 错误: {e}")
        raise


def insert_user_mode_switch_log_sync(
    user_id: str,
    from_mode: str,
    to_mode: str,
    changed_by: str = "user_manual",
    reason_code: Optional[str] = None,
) -> Dict[str, Any]:
    """
    写入用户执行模式切换日志（同步版，供 API 通过 asyncio.to_thread 调用）。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    row = {
        "user_id": user_id,
        "from_mode": from_mode,
        "to_mode": to_mode,
        "changed_by": changed_by,
        "reason_code": reason_code,
    }
    try:
        result = supabase.table("user_mode_switch_logs").insert(row).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("插入模式切换日志失败：返回数据为空")
    except Exception as e:
        print(f"[insert_user_mode_switch_log_sync] 错误: {e}")
        raise


async def insert_health_document(
    user_id: str,
    document_type: str = "report",
    image_url: Optional[str] = None,
    extracted_content: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    插入用户健康报告/体检报告记录（OCR 导入用）。

    Args:
        user_id: 用户 ID (UUID)
        document_type: report / record / other
        image_url: 图片存储 URL（可选）
        extracted_content: OCR 解析出的 JSON 内容

    Returns:
        插入的记录字典
    """
    check_supabase_configured()
    supabase = get_supabase_client()

    row = {
        "user_id": user_id,
        "document_type": document_type,
        "image_url": image_url,
        "extracted_content": extracted_content or {},
    }
    try:
        result = supabase.table("user_health_documents").insert(row).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("插入健康报告记录失败：返回数据为空")
    except Exception as e:
        print(f"[insert_health_document] 错误: {e}")
        raise


def insert_health_document_sync(
    user_id: str,
    document_type: str = "report",
    image_url: Optional[str] = None,
    extracted_content: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """同步版：插入健康报告记录，供 Worker 子进程使用。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    row = {
        "user_id": user_id,
        "document_type": document_type,
        "image_url": image_url,
        "extracted_content": extracted_content or {},
    }
    try:
        result = supabase.table("user_health_documents").insert(row).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("插入健康报告记录失败：返回数据为空")
    except Exception as e:
        print(f"[insert_health_document_sync] 错误: {e}")
        raise


async def insert_food_record(
    user_id: str,
    meal_type: str,
    image_path: Optional[str] = None,
    image_paths: Optional[List[str]] = None,
    description: Optional[str] = None,
    insight: Optional[str] = None,
    items: Optional[List[Dict[str, Any]]] = None,
    total_calories: float = 0,
    total_protein: float = 0,
    total_carbs: float = 0,
    total_fat: float = 0,
    total_weight_grams: int = 0,
    diet_goal: Optional[str] = None,
    activity_timing: Optional[str] = None,
    pfc_ratio_comment: Optional[str] = None,
    absorption_notes: Optional[str] = None,
    context_advice: Optional[str] = None,
    source_task_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    插入用户饮食记录（拍照识别后确认记录）。

    Args:
        user_id: 用户 ID (UUID)
        meal_type: 餐次 breakfast / morning_snack / lunch / afternoon_snack / dinner / evening_snack（兼容 legacy: snack）
        image_path: 图片本地路径或 URL（可选）
        description: AI 餐食描述（可选）
        insight: AI 健康建议（可选）
        items: 食物项列表，每项含 name, weight, ratio, intake, nutrients 等
        total_calories, total_protein, total_carbs, total_fat: 总营养
        total_weight_grams: 总预估重量（克）
        diet_goal: 饮食目标
        activity_timing: 运动时机
        pfc_ratio_comment: PFC 比例评价
        absorption_notes: 吸收率说明
        context_advice: 情境建议

    Returns:
        插入的记录字典
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    row = {
        "user_id": user_id,
        "meal_type": meal_type,
        "image_path": image_path,
        "description": description or "",
        "insight": insight or "",
        "items": items or [],
        "total_calories": total_calories,
        "total_protein": total_protein,
        "total_carbs": total_carbs,
        "total_fat": total_fat,
        "total_weight_grams": total_weight_grams,
    }
    if image_paths:
        row["image_paths"] = image_paths
    if diet_goal is not None:
        row["diet_goal"] = diet_goal

    if activity_timing is not None:
        row["activity_timing"] = activity_timing
    if pfc_ratio_comment is not None:
        row["pfc_ratio_comment"] = pfc_ratio_comment
    if absorption_notes is not None:
        row["absorption_notes"] = absorption_notes
    if context_advice is not None:
        row["context_advice"] = context_advice
    if source_task_id is not None:
        row["source_task_id"] = source_task_id
    try:
        result = supabase.table("user_food_records").insert(row).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("插入饮食记录失败：返回数据为空")
    except Exception as e:
        print(f"[insert_food_record] 错误: {e}")
        raise


async def list_food_records(
    user_id: str,
    date: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """
    查询用户饮食记录列表。可选按日期筛选（中国时区自然日）。

    Args:
        user_id: 用户 ID (UUID)
        date: 日期 YYYY-MM-DD，不传则返回最近记录
        limit: 最多返回条数

    Returns:
        记录列表，按 record_time 倒序（最新的记录排在前面）
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        q = supabase.table("user_food_records").select("*").eq("user_id", user_id)
        if date:
            start_local = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=CHINA_TZ)
            end_local = (datetime.strptime(date, "%Y-%m-%d") + timedelta(days=1)).replace(tzinfo=CHINA_TZ)
            start_ts = start_local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            end_ts = end_local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            q = q.gte("record_time", start_ts).lt("record_time", end_ts)
        q = q.order("record_time", desc=True).limit(limit)
        result = q.execute()
        return list(result.data or [])
    except Exception as e:
        print(f"[list_food_records] 错误: {e}")
        raise


async def list_food_records_by_range(
    user_id: str,
    start_date: str,
    end_date: str,
) -> List[Dict[str, Any]]:
    """
    查询用户在日期范围内的饮食记录（用于数据统计）。
    start_date/end_date: YYYY-MM-DD（按中国时区自然日，含首含尾）。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        # 将中国区自然日转换为 UTC 时间范围
        start_local = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=CHINA_TZ)
        end_local = (datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)).replace(tzinfo=CHINA_TZ)
        start_ts = start_local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        end_ts = end_local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        q = supabase.table("user_food_records").select("*").eq("user_id", user_id).gte("record_time", start_ts).lt("record_time", end_ts).order("record_time", desc=False)
        result = q.execute()
        return list(result.data or [])
    except Exception as e:
        print(f"[list_food_records_by_range] 错误: {e}")
        raise


async def get_streak_days(user_id: str) -> int:
    """
    计算连续记录天数（从今天起往前，有记录的连续天数）。
    某天至少有 1 条饮食记录即算「有记录」。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        # 使用中国时区的自然日计算连续天数
        today = datetime.now(CHINA_TZ).date()
        streak = 0
        d = today
        while True:
            day_str = d.strftime("%Y-%m-%d")
            start_local = datetime.combine(d, datetime.min.time()).replace(tzinfo=CHINA_TZ)
            end_local = datetime.combine(d + timedelta(days=1), datetime.min.time()).replace(tzinfo=CHINA_TZ)
            start_ts = start_local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            end_ts = end_local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            r = supabase.table("user_food_records").select("id").eq("user_id", user_id).gte("record_time", start_ts).lt("record_time", end_ts).limit(1).execute()
            if not r.data or len(r.data) == 0:
                break
            streak += 1
            d -= timedelta(days=1)
        return streak
    except Exception as e:
        print(f"[get_streak_days] 错误: {e}")
        raise


async def get_cached_insight(user_id: str, range_type: str, generated_date: str) -> Optional[Dict[str, Any]]:
    """
    查询 AI 营养洞察缓存。
    generated_date: YYYY-MM-DD
    返回 { data_fingerprint, insight_text } 或 None
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = (
            supabase.table("ai_stats_insights")
            .select("generated_date, data_fingerprint, insight_text")
            .eq("user_id", user_id)
            .eq("range_type", range_type)
            .eq("generated_date", generated_date)
            .limit(1)
            .execute()
        )
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_cached_insight] 错误: {e}")
        return None


async def get_latest_cached_insight(user_id: str, range_type: str) -> Optional[Dict[str, Any]]:
    """
    查询某个统计范围最近一次生成的 AI 营养洞察缓存。
    返回 { generated_date, data_fingerprint, insight_text } 或 None
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = (
            supabase.table("ai_stats_insights")
            .select("generated_date, data_fingerprint, insight_text")
            .eq("user_id", user_id)
            .eq("range_type", range_type)
            .order("generated_date", desc=True)
            .limit(1)
            .execute()
        )
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_latest_cached_insight] 错误: {e}")
        return None


async def upsert_insight_cache(
    user_id: str,
    range_type: str,
    generated_date: str,
    data_fingerprint: str,
    insight_text: str,
) -> None:
    """
    写入或更新 AI 营养洞察缓存。
    利用 (user_id, range_type, generated_date) 唯一约束做 upsert。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        row = {
            "user_id": user_id,
            "range_type": range_type,
            "generated_date": generated_date,
            "data_fingerprint": data_fingerprint,
            "insight_text": insight_text,
        }
        # 确保所有字段可 JSON 序列化，防止意外传入非基本类型
        try:
            import json as _json  # 局部导入，避免循环依赖

            safe_row = _json.loads(_json.dumps(row, ensure_ascii=False, default=str))
        except Exception:
            safe_row = row

        supabase.table("ai_stats_insights").upsert(
            safe_row,
            on_conflict="user_id,range_type,generated_date",
        ).execute()
    except Exception as e:
        print(f"[upsert_insight_cache] 错误: {e}")
        raise


async def insert_critical_samples(
    user_id: str,
    items: List[Dict[str, Any]],
) -> None:
    """
    批量插入偏差样本（用户标记「AI 估算偏差大」的样本）。

    Args:
        user_id: 用户 ID (UUID)
        items: 样本列表，每项含 image_path(可选), food_name, ai_weight, user_weight, deviation_percent
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    if not items:
        return
    rows = []
    for it in items:
        row = {
            "user_id": user_id,
            "food_name": str(it.get("food_name", "未知")),
            "ai_weight": float(it.get("ai_weight", 0)),
            "user_weight": float(it.get("user_weight", 0)),
            "deviation_percent": float(it.get("deviation_percent", 0)),
        }
        # 写入图片路径（表需含 image_path 列，否则执行 critical_samples_add_image_path.sql）
        path_val = it.get("image_path")
        row["image_path"] = path_val if path_val is not None and str(path_val).strip() else None
        rows.append(row)
    try:
        supabase.table("critical_samples_weapp").insert(rows).execute()
    except Exception as e:
        print(f"[insert_critical_samples] 错误: {e}")
        raise


# ---------- 异步分析任务（analysis_tasks）：Worker 子进程消费 ----------

def create_analysis_task_sync(
    user_id: str,
    task_type: str,
    image_url: Optional[str] = None,
    image_urls: Optional[List[str]] = None,
    text_input: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    创建一条分析任务（pending），返回任务记录。供 API 调用。
    - image_url: 图片分析时必填（兼容旧版）
    - image_urls: 多图分析时传入（新版）
    - text_input: 文字分析时必填
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    
    # 兼容逻辑：若传了 image_urls 但没传 image_url，取第一个作为 image_url
    if image_urls and len(image_urls) > 0 and not image_url:
        image_url = image_urls[0]
        
    row = {
        "user_id": user_id,
        "task_type": task_type,
        "status": "pending",
        "payload": payload or {},
    }
    # 根据任务类型添加对应字段
    if image_url:
        row["image_url"] = image_url
    if image_urls:
         row["image_paths"] = image_urls  # 复用 image_paths 字段存 urls JSON
    if text_input:
        row["text_input"] = text_input
    
    try:
        result = supabase.table("analysis_tasks").insert(row).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("创建分析任务失败：返回数据为空")
    except Exception as e:
        print(f"[create_analysis_task_sync] 错误: {e}")
        raise


def claim_next_pending_task_sync(task_type: str) -> Optional[Dict[str, Any]]:
    """
    原子抢占一条 pending 任务，将其置为 processing 并返回。
    供 Worker 子进程调用，多进程下通过「先查后更新 where status=pending」避免重复处理。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        # 取一条 pending
        r = (
            supabase.table("analysis_tasks")
            .select("*")
            .eq("status", "pending")
            .eq("task_type", task_type)
            .order("created_at")
            .limit(1)
            .execute()
        )
        rows = list(r.data or [])
        if not rows:
            return None
        task_id = rows[0]["id"]
        # 仅当仍为 pending 时更新为 processing，避免多 Worker 重复抢
        up = (
            supabase.table("analysis_tasks")
            .update({"status": "processing", "updated_at": datetime.now(timezone.utc).isoformat()})
            .eq("id", task_id)
            .eq("status", "pending")
            .execute()
        )
        if up.data and len(up.data) > 0:
            return up.data[0]
        return None
    except Exception as e:
        print(f"[claim_next_pending_task_sync] 错误: {e}")
        raise


def update_analysis_task_result_sync(
    task_id: str,
    status: str,
    result: Optional[Dict[str, Any]] = None,
    error_message: Optional[str] = None,
) -> None:
    """更新任务结果（done / failed）。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    row = {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if result is not None:
        row["result"] = result
    if error_message is not None:
        row["error_message"] = error_message
    try:
        supabase.table("analysis_tasks").update(row).eq("id", task_id).execute()
    except Exception as e:
        print(f"[update_analysis_task_result_sync] 错误: {e}")
        raise


def mark_task_violated_sync(task_id: str, violation_reason: str) -> None:
    """将分析任务标记为违规：status='violated', is_violated=True, 记录违规原因。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    row = {
        "status": "violated",
        "is_violated": True,
        "violation_reason": violation_reason,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        supabase.table("analysis_tasks").update(row).eq("id", task_id).execute()
    except Exception as e:
        print(f"[mark_task_violated_sync] 错误: {e}")
        raise


def get_user_openid_by_id_sync(user_id: str) -> Optional[str]:
    """通过 user_id 查询用户 openid，用于违规记录关联。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("weapp_user").select("openid").eq("id", user_id).limit(1).execute()
        if result.data and len(result.data) > 0:
            return result.data[0].get("openid")
        return None
    except Exception as e:
        print(f"[get_user_openid_by_id_sync] 错误: {e}")
        raise


def create_violation_record_sync(
    task: Dict[str, Any],
    moderation_result: Dict[str, Any],
    violation_type: str = "food_analysis",
) -> None:
    """
    创建一条违规记录，写入 content_violations 表。
    task: 原始分析任务数据
    moderation_result: AI 审核返回结果，包含 category 和 reason
    violation_type: 违规来源类型，默认 'food_analysis'
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    user_id = task.get("user_id", "")
    # 获取用户 openid
    user_openid = get_user_openid_by_id_sync(user_id) or ""
    # 获取违规图片 URL（多图取第一张，或单图）
    image_url = None
    image_paths = task.get("image_paths")
    if image_paths and isinstance(image_paths, list) and len(image_paths) > 0:
        image_url = image_paths[0]
    elif task.get("image_url"):
        image_url = task["image_url"]
    row = {
        "user_openid": user_openid,
        "user_id": user_id,
        "violation_type": violation_type,
        "violation_category": moderation_result.get("category", "other"),
        "violation_reason": moderation_result.get("reason", "未知违规原因"),
        "reference_id": task.get("id"),
        "image_url": image_url,
        "text_content": task.get("text_input"),
    }
    try:
        supabase.table("content_violations").insert(row).execute()
    except Exception as e:
        print(f"[create_violation_record_sync] 错误: {e}")
        raise


async def update_analysis_task_result(
    task_id: str,
    result: Dict[str, Any]
) -> Dict[str, Any]:
    """
    更新分析任务结果（异步）。
    用于用户手动修正分析结果（如修改食物名称）后回写数据库。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        data = {
            "result": result,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        res = supabase.table("analysis_tasks").update(data).eq("id", task_id).execute()
        if res.data and len(res.data) > 0:
            return res.data[0]
        # 如果更新失败（如 ID 不存在），这里可能需要抛错或返回 None
        # Supabase update 如果没匹配到行，data 为空列表
        raise Exception("更新任务失败：任务不存在或无权限")
    except Exception as e:
        print(f"[update_analysis_task_result] 错误: {e}")
        raise


def get_analysis_task_by_id_sync(task_id: str) -> Optional[Dict[str, Any]]:
    """按 ID 查询单条任务。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        print(f"[get_analysis_task_by_id_sync] Querying task_id: {task_id}")
        r = supabase.table("analysis_tasks").select("*").eq("id", task_id).limit(1).execute()
        if r.data and len(r.data) > 0:
            return r.data[0]
        return None
    except Exception as e:
        print(f"[get_analysis_task_by_id_sync] 错误: {e}")
        raise


async def get_analysis_tasks_by_ids(task_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """按 ID 列表批量查询分析任务，返回 task_id -> task 字典。用于给记录列表补全 image_paths。"""
    if not task_ids:
        return {}
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        r = supabase.table("analysis_tasks").select("id, image_paths, image_url").in_("id", task_ids).execute()
        out = {}
        for row in (r.data or []):
            tid = row.get("id")
            if tid:
                out[tid] = row
        return out
    except Exception as e:
        print(f"[get_analysis_tasks_by_ids] 错误: {e}")
        return {}


def list_analysis_tasks_by_user_sync(
    user_id: str,
    task_type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """按用户查询任务列表，支持按 task_type、status 筛选。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        q = supabase.table("analysis_tasks").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(limit)
        if task_type:
            q = q.eq("task_type", task_type)
        if status:
            q = q.eq("status", status)
        r = q.execute()
        return list(r.data or [])
    except Exception as e:
        print(f"[list_analysis_tasks_by_user_sync] 错误: {e}")
        raise


# ==================== 评论任务相关函数 ====================

def create_comment_task_sync(
    user_id: str,
    comment_type: str,
    target_id: str,
    content: str,
    rating: Optional[int] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    创建一条评论审核任务（pending），返回任务记录。
    comment_type: 'feed' 或 'public_food_library'
    target_id: record_id 或 library_item_id
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    row = {
        "user_id": user_id,
        "comment_type": comment_type,
        "target_id": target_id,
        "content": content.strip(),
        "status": "pending",
    }
    if rating is not None:
        row["rating"] = rating
    if extra:
        row["extra"] = extra
    try:
        result = supabase.table("comment_tasks").insert(row).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("创建评论任务失败")
    except Exception as e:
        print(f"[create_comment_task_sync] 错误: {e}")
        raise


def claim_next_pending_comment_task_sync(comment_type: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    原子抢占一条 pending 评论任务，将其置为 processing 并返回。
    comment_type: 可选，筛选特定类型的任务
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        # 取一条 pending 任务
        q = (
            supabase.table("comment_tasks")
            .select("*")
            .eq("status", "pending")
            .order("created_at")
            .limit(1)
        )
        if comment_type:
            q = q.eq("comment_type", comment_type)
        r = q.execute()
        rows = list(r.data or [])
        if not rows:
            return None
        task_id = rows[0]["id"]
        # 仅当仍为 pending 时更新为 processing，避免多 Worker 重复抢
        up = (
            supabase.table("comment_tasks")
            .update({"status": "processing", "updated_at": datetime.now(timezone.utc).isoformat()})
            .eq("id", task_id)
            .eq("status", "pending")
            .execute()
        )
        if up.data and len(up.data) > 0:
            return up.data[0]
        return None
    except Exception as e:
        print(f"[claim_next_pending_comment_task_sync] 错误: {e}")
        raise


def update_comment_task_result_sync(
    task_id: str,
    status: str,
    result: Optional[Dict[str, Any]] = None,
    error_message: Optional[str] = None,
) -> None:
    """更新评论任务结果（done / failed）。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    row = {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if result is not None:
        row["result"] = result
    if error_message is not None:
        row["error_message"] = error_message
    try:
        supabase.table("comment_tasks").update(row).eq("id", task_id).execute()
    except Exception as e:
        print(f"[update_comment_task_result_sync] 错误: {e}")
        raise


def mark_comment_task_violated_sync(task_id: str, violation_reason: str) -> None:
    """将评论任务标记为违规：status='violated', is_violated=True, 记录违规原因。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    row = {
        "status": "violated",
        "is_violated": True,
        "violation_reason": violation_reason,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        supabase.table("comment_tasks").update(row).eq("id", task_id).execute()
    except Exception as e:
        print(f"[mark_comment_task_violated_sync] 错误: {e}")
        raise


def list_comment_tasks_by_user_sync(
    user_id: str,
    comment_type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """按用户查询评论任务列表，支持按 comment_type、status 筛选。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        q = supabase.table("comment_tasks").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(limit)
        if comment_type:
            q = q.eq("comment_type", comment_type)
        if status:
            q = q.eq("status", status)
        r = q.execute()
        return list(r.data or [])
    except Exception as e:
        print(f"[list_comment_tasks_by_user_sync] 错误: {e}")
        raise


def upload_health_report_image(user_id: str, base64_image: str) -> str:
    """
    将体检报告图片上传到 Supabase Storage，返回公网可访问的 URL。
    路径：health-reports/{user_id}/{uuid}.jpg
    需先在 Supabase Dashboard → Storage 创建 bucket「health-reports」并设为 Public。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    raw = base64_image.split(",")[1] if "," in base64_image else base64_image
    try:
        file_bytes = base64.b64decode(raw)
    except Exception as e:
        raise ValueError(f"base64 解码失败: {e}")
    path = f"{user_id}/{uuid.uuid4().hex}.jpg"
    supabase.storage.from_(HEALTH_REPORTS_BUCKET).upload(
        path,
        file_bytes,
        {"content-type": "image/jpeg", "upsert": "true"},
    )
    # 公网 URL：https://xxx.supabase.co/storage/v1/object/public/health-reports/...
    result = supabase.storage.from_(HEALTH_REPORTS_BUCKET).get_public_url(path)
    if isinstance(result, dict):
        return result.get("publicUrl") or result.get("public_url") or ""
    if hasattr(result, "public_url"):
        return getattr(result, "public_url", "")
    if hasattr(result, "publicUrl"):
        return getattr(result, "publicUrl", "")
    return str(result)


def _resolve_public_storage_url(result: Any) -> str:
    if isinstance(result, dict):
        return (result.get("publicUrl") or result.get("public_url") or "").strip()
    if hasattr(result, "public_url"):
        return str(getattr(result, "public_url", "") or "").strip()
    if hasattr(result, "publicUrl"):
        return str(getattr(result, "publicUrl", "") or "").strip()
    return str(result or "").strip()


def upload_food_analyze_image_bytes(
    file_bytes: bytes,
    extension: str = ".jpg",
    content_type: str = "image/jpeg",
) -> str:
    """
    将食物分析图片字节上传到 Supabase Storage，返回公网可访问的 URL。
    路径：food-images/{uuid}.{ext}
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    if not file_bytes:
        raise ValueError("图片文件为空")

    safe_ext = (extension or ".jpg").strip().lower()
    if not safe_ext.startswith("."):
        safe_ext = f".{safe_ext}"
    if not re.fullmatch(r"\.[a-z0-9]{1,8}", safe_ext):
        safe_ext = ".jpg"

    path = f"{uuid.uuid4().hex}{safe_ext}"
    safe_content_type = (content_type or "image/jpeg").strip() or "image/jpeg"

    try:
        supabase.storage.from_(FOOD_ANALYZE_BUCKET).upload(
            path,
            file_bytes,
            {"content-type": safe_content_type, "upsert": "true"},
        )
    except Exception as e:
        error_msg = str(e) or f"上传失败: {type(e).__name__}"
        if "SSL" in error_msg or "EOF" in error_msg or "connection" in error_msg.lower() or "timeout" in error_msg.lower():
            raise ConnectionError(f"连接 Supabase Storage 失败: {error_msg}")
        raise Exception(f"上传图片到 Supabase Storage 失败: {error_msg}")

    try:
        result = supabase.storage.from_(FOOD_ANALYZE_BUCKET).get_public_url(path)
        url = _resolve_public_storage_url(result)
        if not url:
            raise ValueError("无法获取图片公网 URL")
        return url
    except Exception as e:
        error_msg = str(e) or f"获取 URL 失败: {type(e).__name__}"
        if "SSL" in error_msg or "EOF" in error_msg or "connection" in error_msg.lower():
            raise ConnectionError(f"连接 Supabase Storage 失败: {error_msg}")
        raise Exception(f"获取图片公网 URL 失败: {error_msg}")


def upload_food_analyze_image(base64_image: str) -> str:
    """
    将食物分析图片上传到 Supabase Storage，返回公网可访问的 URL。
    路径：food-images/{uuid}.jpg
    需先在 Supabase Dashboard → Storage 创建 bucket「food-images」并设为 Public。
    """
    raw = base64_image.split(",")[1] if "," in base64_image else base64_image
    try:
        file_bytes = base64.b64decode(raw)
    except Exception as e:
        raise ValueError(f"base64 解码失败: {e}")
    return upload_food_analyze_image_bytes(file_bytes)


def upload_user_avatar(user_id: str, base64_image: str) -> str:
    """
    将用户头像上传到 Supabase Storage，返回公网可访问的 URL。
    路径：user-avatars/{user_id}/{uuid}.jpg
    需先在 Supabase Dashboard → Storage 创建 bucket「user-avatars」并设为 Public。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    raw = base64_image.split(",")[1] if "," in base64_image else base64_image
    try:
        file_bytes = base64.b64decode(raw)
    except Exception as e:
        raise ValueError(f"base64 解码失败: {e}")
    path = f"{user_id}/{uuid.uuid4().hex}.jpg"
    supabase.storage.from_(USER_AVATARS_BUCKET).upload(
        path,
        file_bytes,
        {"content-type": "image/jpeg", "upsert": "true"},
    )
    result = supabase.storage.from_(USER_AVATARS_BUCKET).get_public_url(path)
    if isinstance(result, dict):
        return result.get("publicUrl") or result.get("public_url") or ""
    if hasattr(result, "public_url"):
        return getattr(result, "public_url", "")
    if hasattr(result, "publicUrl"):
        return getattr(result, "publicUrl", "")
    return str(result)

def delete_image_from_storage(image_url: str, bucket_name: str = FOOD_ANALYZE_BUCKET) -> None:
    """
    根据图片公网 URL 从 Supabase Storage 中删除指定图片。
    如果 URL 含有类似 '/storage/v1/object/public/bucket_name/XXX.jpg'，则提取 XXX.jpg 作为 path 删除。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        # 提取 path，例如 "https://..../food-images/1234.jpg" 提取出 "1234.jpg"
        # 简单粗暴的方式：由于 bucket 为 bucket_name，可以找这个字符串之后的部分
        if bucket_name in image_url:
            parts = image_url.split(f"{bucket_name}/")
            if len(parts) == 2:
                path = parts[1].split("?")[0]  # 忽略 query string
                supabase.storage.from_(bucket_name).remove([path])
                print(f"[delete_image_from_storage] 删除成功: {path}")
            else:
                print(f"[delete_image_from_storage] URL 对应路径解析失败: {image_url}")
        else:
             print(f"[delete_image_from_storage] URL 中未找到 bucket_name: {image_url}")
    except Exception as e:
        print(f"[delete_image_from_storage] 删除失败: {e}")

# ---------- 好友系统 ----------

async def get_friend_ids(user_id: str) -> List[str]:
    """获取用户的好友 ID 列表（双向：我→对方 与 对方→我，兼容仅存在单向历史数据的情况）"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        out = set()
        r1 = supabase.table("user_friends").select("friend_id").eq("user_id", user_id).execute()
        for row in r1.data or []:
            fid = row.get("friend_id")
            if fid:
                out.add(fid)
        r2 = supabase.table("user_friends").select("user_id").eq("friend_id", user_id).execute()
        for row in r2.data or []:
            uid = row.get("user_id")
            if uid:
                out.add(uid)
        return list(out)
    except Exception as e:
        print(f"[get_friend_ids] 错误: {e}")
        raise


async def is_friend(user_id: str, friend_id: str) -> bool:
    """判断两人是否为好友"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        r1 = supabase.table("user_friends").select("id").eq("user_id", user_id).eq("friend_id", friend_id).limit(1).execute()
        if r1.data and len(r1.data) > 0:
            return True
        r2 = supabase.table("user_friends").select("id").eq("user_id", friend_id).eq("friend_id", user_id).limit(1).execute()
        return bool(r2.data and len(r2.data) > 0)
    except Exception as e:
        print(f"[is_friend] 错误: {e}")
        raise


async def add_friend_pair(user_id: str, friend_id: str) -> None:
    """建立双向好友关系（插入两条记录），如果已存在则跳过"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        # 先检查是否已存在好友关系，避免重复插入
        existing1 = supabase.table("user_friends").select("id").eq("user_id", user_id).eq("friend_id", friend_id).execute()
        existing2 = supabase.table("user_friends").select("id").eq("user_id", friend_id).eq("friend_id", user_id).execute()
        
        records_to_insert = []
        if not existing1.data or len(existing1.data) == 0:
            records_to_insert.append({"user_id": user_id, "friend_id": friend_id})
        if not existing2.data or len(existing2.data) == 0:
            records_to_insert.append({"user_id": friend_id, "friend_id": user_id})
        
        if records_to_insert:
            supabase.table("user_friends").insert(records_to_insert).execute()
    except Exception as e:
        # 忽略唯一约束冲突错误
        if "unique" in str(e).lower() or "duplicate" in str(e).lower():
            return
        print(f"[add_friend_pair] 错误: {e}")
        raise


async def remove_friend_pair(user_id: str, friend_id: str) -> None:
    """移除双向好友关系（删除两条 user_friends 记录）。"""
    if user_id == friend_id:
        raise ValueError("不能移除自己")
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        if not await is_friend(user_id, friend_id):
            raise ValueError("你们还不是好友")

        # 删除双向好友关系（兼容历史单向/重复数据）
        supabase.table("user_friends").delete().eq("user_id", user_id).eq("friend_id", friend_id).execute()
        supabase.table("user_friends").delete().eq("user_id", friend_id).eq("friend_id", user_id).execute()

        # 清理双方之间可能残留的 pending 请求
        supabase.table("friend_requests").delete().eq("from_user_id", user_id).eq("to_user_id", friend_id).eq("status", "pending").execute()
        supabase.table("friend_requests").delete().eq("from_user_id", friend_id).eq("to_user_id", user_id).eq("status", "pending").execute()
    except ValueError:
        raise
    except Exception as e:
        print(f"[remove_friend_pair] 错误: {e}")
        raise


async def get_pending_request_to_user_ids(from_user_id: str) -> List[str]:
    """获取 from_user_id 已发出的、状态为 pending 的 to_user_id 列表"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("friend_requests").select("to_user_id").eq("from_user_id", from_user_id).eq("status", "pending").execute()
        return [r["to_user_id"] for r in (result.data or [])]
    except Exception as e:
        print(f"[get_pending_request_to_user_ids] 错误: {e}")
        raise


async def search_users(
    current_user_id: str,
    nickname: Optional[str] = None,
    telephone: Optional[str] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """
    搜索用户：按昵称模糊或手机号精确。排除自己。
    返回 id, nickname, avatar, is_friend, is_pending（不返回 telephone）。
    - is_friend: 是否已是好友
    - is_pending: 是否已发送待处理请求
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        if telephone:
            q = supabase.table("weapp_user").select("id, nickname, avatar").eq("telephone", telephone.strip()).neq("id", current_user_id).limit(1)
            result = q.execute()
        elif nickname and nickname.strip():
            q = supabase.table("weapp_user").select("id, nickname, avatar").ilike("nickname", f"%{nickname.strip()}%").neq("id", current_user_id).limit(limit)
            result = q.execute()
        else:
            return []
        users = list(result.data or [])
        if not users:
            return []
        friend_ids = await get_friend_ids(current_user_id)
        pending = await get_pending_request_to_user_ids(current_user_id)
        out = []
        for u in users:
            uid = u.get("id")
            u["is_friend"] = uid in friend_ids
            u["is_pending"] = uid in pending
            out.append(u)
        return out
    except Exception as e:
        print(f"[search_users] 错误: {e}")
        raise


async def send_friend_request(from_user_id: str, to_user_id: str) -> Dict[str, Any]:
    """发送好友请求"""
    if from_user_id == to_user_id:
        raise ValueError("不能添加自己为好友")
    if await is_friend(from_user_id, to_user_id):
        raise ValueError("你们已是好友")
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        existing = supabase.table("friend_requests").select("*").eq("from_user_id", from_user_id).eq("to_user_id", to_user_id).execute()
        if existing.data and len(existing.data) > 0:
            row = existing.data[0]
            if row.get("status") == "pending":
                return row
            supabase.table("friend_requests").update({"status": "pending", "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", row["id"]).execute()
            return {**row, "status": "pending"}
        result = supabase.table("friend_requests").insert({
            "from_user_id": from_user_id,
            "to_user_id": to_user_id,
            "status": "pending",
        }).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("发送好友请求失败")
    except ValueError:
        raise
    except Exception as e:
        print(f"[send_friend_request] 错误: {e}")
        raise


async def get_friend_requests_received(to_user_id: str) -> List[Dict[str, Any]]:
    """获取收到的待处理好友请求列表"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("friend_requests").select("id, from_user_id, to_user_id, status, created_at").eq("to_user_id", to_user_id).eq("status", "pending").order("created_at", desc=True).execute()
        rows = list(result.data or [])
        if not rows:
            return []
        from_ids = [r["from_user_id"] for r in rows]
        users_result = supabase.table("weapp_user").select("id, nickname, avatar").in_("id", from_ids).execute()
        users_map = {u["id"]: u for u in (users_result.data or [])}
        out = []
        for r in rows:
            u = users_map.get(r["from_user_id"], {})
            out.append({
                "id": r["id"],
                "from_user_id": r["from_user_id"],
                "to_user_id": r["to_user_id"],
                "status": r["status"],
                "created_at": r["created_at"],
                "from_nickname": u.get("nickname") or "用户",
                "from_avatar": u.get("avatar") or "",
            })
        return out
    except Exception as e:
        print(f"[get_friend_requests_received] 错误: {e}")
        raise


async def respond_friend_request(request_id: str, to_user_id: str, accept: bool) -> None:
    """处理好友请求：接受则建立双向好友关系"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        req = supabase.table("friend_requests").select("*").eq("id", request_id).eq("to_user_id", to_user_id).single().execute()
        if not req.data:
            raise ValueError("请求不存在或无权操作")
        row = req.data
        if row.get("status") != "pending":
            raise ValueError("该请求已处理")
        status = "accepted" if accept else "rejected"
        supabase.table("friend_requests").update({"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", request_id).execute()
        if accept:
            await add_friend_pair(row["to_user_id"], row["from_user_id"])
    except ValueError:
        raise
    except Exception as e:
        print(f"[respond_friend_request] 错误: {e}")
        raise


async def cancel_sent_friend_request(request_id: str, from_user_id: str) -> None:
    """撤销当前用户发出的、仍为 pending 的好友请求（删除该条记录）。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        req = (
            supabase.table("friend_requests")
            .select("*")
            .eq("id", request_id)
            .eq("from_user_id", from_user_id)
            .single()
            .execute()
        )
        if not req.data:
            raise ValueError("请求不存在或无权撤销")
        row = req.data
        if row.get("status") != "pending":
            raise ValueError("只能撤销待对方处理的请求")
        supabase.table("friend_requests").delete().eq("id", request_id).execute()
    except ValueError:
        raise
    except Exception as e:
        print(f"[cancel_sent_friend_request] 错误: {e}")
        raise


async def get_friends_with_profile(user_id: str) -> List[Dict[str, Any]]:
    """获取好友列表，含 nickname、avatar、id（去重）"""
    friend_ids = await get_friend_ids(user_id)
    if not friend_ids:
        return []
    # 去重 friend_ids
    unique_friend_ids = list(set(friend_ids))
    check_supabase_configured()
    supabase = get_supabase_client()
    result = supabase.table("weapp_user").select("id, nickname, avatar").in_("id", unique_friend_ids).execute()
    return list(result.data or [])


async def delete_friend_pair(user_id: str, friend_id: str) -> Dict[str, int]:
    """删除双向好友关系，返回删除条数。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        deleted = 0
        r1 = supabase.table("user_friends").delete().eq("user_id", user_id).eq("friend_id", friend_id).execute()
        deleted += len(r1.data or [])
        r2 = supabase.table("user_friends").delete().eq("user_id", friend_id).eq("friend_id", user_id).execute()
        deleted += len(r2.data or [])
        return {"deleted": deleted}
    except Exception as e:
        print(f"[delete_friend_pair] 错误: {e}")
        raise


async def get_friend_requests_overview(user_id: str) -> Dict[str, List[Dict[str, Any]]]:
    """
    获取好友请求总览：
    - received: 我收到的请求（pending/accepted/rejected）
    - sent: 我发出的请求（pending/accepted/rejected）
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        received_result = (
            supabase.table("friend_requests")
            .select("id, from_user_id, to_user_id, status, created_at, updated_at")
            .eq("to_user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        sent_result = (
            supabase.table("friend_requests")
            .select("id, from_user_id, to_user_id, status, created_at, updated_at")
            .eq("from_user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        received_rows = list(received_result.data or [])
        sent_rows = list(sent_result.data or [])

        counterpart_ids = set()
        for row in received_rows:
            cid = row.get("from_user_id")
            if cid:
                counterpart_ids.add(cid)
        for row in sent_rows:
            cid = row.get("to_user_id")
            if cid:
                counterpart_ids.add(cid)

        users_map: Dict[str, Dict[str, Any]] = {}
        if counterpart_ids:
            users_result = (
                supabase.table("weapp_user")
                .select("id, nickname, avatar")
                .in_("id", list(counterpart_ids))
                .execute()
            )
            users_map = {u["id"]: u for u in (users_result.data or [])}

        received = []
        for row in received_rows:
            from_user_id = row.get("from_user_id")
            user = users_map.get(from_user_id or "", {})
            received.append({
                "id": row.get("id"),
                "from_user_id": from_user_id,
                "to_user_id": row.get("to_user_id"),
                "status": row.get("status"),
                "created_at": row.get("created_at"),
                "updated_at": row.get("updated_at"),
                "counterpart_user_id": from_user_id,
                "counterpart_nickname": user.get("nickname") or "用户",
                "counterpart_avatar": user.get("avatar") or "",
            })

        sent = []
        for row in sent_rows:
            to_user_id = row.get("to_user_id")
            user = users_map.get(to_user_id or "", {})
            sent.append({
                "id": row.get("id"),
                "from_user_id": row.get("from_user_id"),
                "to_user_id": to_user_id,
                "status": row.get("status"),
                "created_at": row.get("created_at"),
                "updated_at": row.get("updated_at"),
                "counterpart_user_id": to_user_id,
                "counterpart_nickname": user.get("nickname") or "用户",
                "counterpart_avatar": user.get("avatar") or "",
            })

        return {"received": received, "sent": sent}
    except Exception as e:
        print(f"[get_friend_requests_overview] 错误: {e}")
        raise


async def cleanup_duplicate_friends(user_id: str) -> Dict[str, Any]:
    """清理用户的重复好友记录，只保留每个好友的第一条记录"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        # 获取该用户的所有好友记录
        result = supabase.table("user_friends").select("id, friend_id").eq("user_id", user_id).execute()
        records = result.data or []
        
        # 统计每个 friend_id 的记录
        friend_records: Dict[str, List[str]] = {}
        for r in records:
            fid = r["friend_id"]
            if fid not in friend_records:
                friend_records[fid] = []
            friend_records[fid].append(r["id"])
        
        # 找出重复的并删除多余的
        deleted_count = 0
        for fid, record_ids in friend_records.items():
            if len(record_ids) > 1:
                # 保留第一条，删除其他
                to_delete = record_ids[1:]
                for rid in to_delete:
                    supabase.table("user_friends").delete().eq("id", rid).execute()
                    deleted_count += 1
        
        return {"cleaned": deleted_count, "user_id": user_id}
    except Exception as e:
        print(f"[cleanup_duplicate_friends] 错误: {e}")
        raise


def build_friend_invite_code(user_id: str) -> str:
    """基于用户 ID 生成短邀请码（默认 8 位十六进制字符）。"""
    raw = (user_id or "").replace("-", "").lower()
    if len(raw) < 8:
        raise ValueError("用户 ID 无法生成邀请码")
    return raw[:8]


async def resolve_user_by_friend_invite_code(invite_code: str) -> Optional[Dict[str, Any]]:
    """根据短邀请码解析用户（匹配 user_id 前缀），返回公开资料。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    code = (invite_code or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{6,12}", code):
        return None
    try:
        # 避免对 UUID 字段使用 like 导致部分 Supabase/Cloudflare 环境异常，
        # 改为分页拉取公开字段后在本地做前缀匹配。
        rows: List[Dict[str, Any]] = []
        page_size = 500
        offset = 0
        while True:
            batch = (
                supabase
                .table("weapp_user")
                .select("id, nickname, avatar")
                .range(offset, offset + page_size - 1)
                .execute()
            )
            data = list(batch.data or [])
            if not data:
                break
            for item in data:
                raw = (item.get("id") or "").replace("-", "").lower()
                if raw.startswith(code):
                    rows.append(item)
                    if len(rows) > 1:
                        break
            if len(rows) > 1 or len(data) < page_size:
                break
            offset += page_size
        if not rows:
            return None
        if len(rows) > 1:
            raise ValueError("邀请码存在歧义，请使用更长邀请码")
        return rows[0]
    except ValueError:
        raise
    except Exception as e:
        print(f"[resolve_user_by_friend_invite_code] 错误: {e}")
        raise


# ---------- 圈子动态（好友今日饮食 + 点赞评论）----------


def _normalize_feed_comment_row(
    row: Dict[str, Any],
    user_map: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    author = user_map.get(row.get("user_id"), {})
    reply_user = user_map.get(row.get("reply_to_user_id"), {})
    return {
        "id": row.get("id"),
        "user_id": row.get("user_id"),
        "record_id": row.get("record_id"),
        "parent_comment_id": row.get("parent_comment_id"),
        "reply_to_user_id": row.get("reply_to_user_id"),
        "reply_to_nickname": reply_user.get("nickname") or "",
        "content": row.get("content") or "",
        "created_at": row.get("created_at"),
        "nickname": author.get("nickname") or "用户",
        "avatar": author.get("avatar") or "",
    }


def _slice_feed_comment_preview(comments: List[Dict[str, Any]], comments_limit: int) -> List[Dict[str, Any]]:
    if comments_limit <= 0:
        return []
    if len(comments) <= comments_limit:
        return comments
    return comments[-comments_limit:]


def _build_feed_comment_bundle(
    all_comments: List[Dict[str, Any]],
    user_map: Dict[str, Dict[str, Any]],
    comments_limit: int,
) -> Dict[str, Any]:
    comments_map: Dict[str, List[Dict[str, Any]]] = {}
    comment_count_map: Dict[str, int] = {}
    for comment in all_comments:
        rid = comment.get("record_id")
        if not rid:
            continue
        comment_count_map[rid] = comment_count_map.get(rid, 0) + 1
        comments_map.setdefault(rid, []).append(_normalize_feed_comment_row(comment, user_map))
    for rid, comments in list(comments_map.items()):
        comments_map[rid] = _slice_feed_comment_preview(comments, comments_limit)
    return {"comments_map": comments_map, "comment_count_map": comment_count_map}


def _query_feed_comments_bundle_sync(
    supabase,
    record_ids: List[str],
    comments_limit: int,
) -> Dict[str, Any]:
    if not record_ids:
        return {"comments_map": {}, "comment_count_map": {}}

    comments_result = (
        supabase.table("feed_comments")
        .select("id, user_id, record_id, parent_comment_id, reply_to_user_id, content, created_at")
        .in_("record_id", record_ids)
        .order("created_at", desc=False)
        .execute()
    )
    all_comments = list(comments_result.data or [])
    if not all_comments:
        return {"comments_map": {}, "comment_count_map": {}}

    user_ids = {
        uid
        for uid in ([c.get("user_id") for c in all_comments] + [c.get("reply_to_user_id") for c in all_comments])
        if uid
    }
    user_map: Dict[str, Dict[str, Any]] = {}
    if user_ids:
        users = (
            supabase.table("weapp_user")
            .select("id, nickname, avatar")
            .in_("id", list(user_ids))
            .execute()
        )
        user_map = {u["id"]: u for u in (users.data or [])}

    return _build_feed_comment_bundle(all_comments, user_map, comments_limit)


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        text = str(value).strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _compute_macro_balance_score(
    total_protein: Any,
    total_carbs: Any,
    total_fat: Any,
) -> float:
    try:
        protein = max(float(total_protein or 0), 0.0)
        carbs = max(float(total_carbs or 0), 0.0)
        fat = max(float(total_fat or 0), 0.0)
    except Exception:
        return 0.0

    protein_kcal = protein * 4.0
    carbs_kcal = carbs * 4.0
    fat_kcal = fat * 9.0
    total_kcal = protein_kcal + carbs_kcal + fat_kcal
    if total_kcal <= 0:
        return 0.0

    protein_ratio = protein_kcal / total_kcal
    carbs_ratio = carbs_kcal / total_kcal
    fat_ratio = fat_kcal / total_kcal
    penalty = (
        abs(protein_ratio - 0.30)
        + abs(carbs_ratio - 0.40)
        + abs(fat_ratio - 0.30)
    )
    score = max(0.0, 1.0 - penalty / 0.9)
    return round(score * 100.0, 2)


def _compute_feed_hot_score(like_count: int, comment_count: int) -> float:
    raw = float(max(like_count, 0) * 2 + max(comment_count, 0) * 3)
    return min(raw / 30.0, 1.0)


def _compute_freshness_score(record_time: Any, window_hours: float = 72.0) -> float:
    dt = _parse_iso_datetime(record_time)
    if not dt:
        return 0.0
    delta_hours = max((datetime.now(timezone.utc) - dt).total_seconds() / 3600.0, 0.0)
    if window_hours <= 0:
        return 0.0
    return max(0.0, 1.0 - min(delta_hours, window_hours) / window_hours)


def _build_feed_recommend_reason(
    record: Dict[str, Any],
    sort_by: str,
    meal_type: Optional[str],
    diet_goal: Optional[str],
    priority_author_ids: Optional[List[str]] = None,
    like_count: int = 0,
    comment_count: int = 0,
) -> str:
    author_id = str(record.get("user_id") or "")
    if priority_author_ids and author_id and author_id in priority_author_ids:
        return "特别关注的人"
    if meal_type and record.get("meal_type") == meal_type:
        return "餐次匹配"
    if diet_goal and record.get("diet_goal") == diet_goal:
        return "同目标饮食"
    if sort_by == "hot" and (like_count > 0 or comment_count > 0):
        return "圈子高热度"
    if sort_by == "balanced":
        return "营养更均衡"
    if _compute_macro_balance_score(
        record.get("total_protein"),
        record.get("total_carbs"),
        record.get("total_fat"),
    ) >= 72:
        return "营养较均衡"
    if like_count >= 3:
        return "点赞较高"
    return "为你推荐"


def _score_feed_record(
    record: Dict[str, Any],
    *,
    sort_by: str,
    like_count: int,
    comment_count: int,
    meal_type: Optional[str],
    diet_goal: Optional[str],
    priority_author_ids: Optional[List[str]] = None,
) -> float:
    balance_score = _compute_macro_balance_score(
        record.get("total_protein"),
        record.get("total_carbs"),
        record.get("total_fat"),
    ) / 100.0
    hot_score = _compute_feed_hot_score(like_count, comment_count)
    fresh_score = _compute_freshness_score(record.get("record_time"))
    meal_match = 1.0 if meal_type and record.get("meal_type") == meal_type else 0.0
    goal_match = 1.0 if diet_goal and record.get("diet_goal") == diet_goal else 0.0
    priority_match = 1.0 if priority_author_ids and str(record.get("user_id") or "") in priority_author_ids else 0.0

    if sort_by == "hot":
        return hot_score * 100.0 + fresh_score * 10.0 + balance_score * 8.0
    if sort_by == "balanced":
        return balance_score * 100.0 + hot_score * 12.0 + fresh_score * 6.0

    return (
        priority_match * 120.0
        + meal_match * 45.0
        + goal_match * 36.0
        + balance_score * 20.0
        + hot_score * 18.0
        + fresh_score * 12.0
    )


async def get_feed_record_interaction_context(user_id: Optional[str], record_id: str) -> Dict[str, Any]:
    """
    判断用户是否可对某条圈子动态进行查看/评论/点赞。
    允许范围：本人、好友、或作者开启 public_records。
    """
    record = await get_food_record_by_id(record_id)
    if not record:
        return {"allowed": False, "reason": "not_found", "record": None}

    owner_id = record.get("user_id")
    if user_id and owner_id == user_id:
        return {"allowed": True, "reason": "owner", "record": record}

    owner = await get_user_by_id(owner_id) if owner_id else None
    if owner and owner.get("public_records"):
        return {"allowed": True, "reason": "public", "record": record}

    if user_id and owner_id and await is_friend(user_id, owner_id):
        return {"allowed": True, "reason": "friend", "record": record}

    return {"allowed": False, "reason": "forbidden", "record": record}


async def list_friends_feed_records(
    user_id: str,
    date: Optional[str] = None,
    offset: int = 0,
    limit: int = 20,
    include_comments: bool = True,
    comments_limit: int = 5,
    meal_type: Optional[str] = None,
    diet_goal: Optional[str] = None,
    sort_by: str = "latest",
    priority_author_ids: Optional[List[str]] = None,
    author_scope: str = "all",
) -> List[Dict[str, Any]]:
    """
    获取好友 + 自己的饮食记录（支持分页），用于圈子 Feed。
    
    Args:
        user_id: 当前用户 ID
        date: 可选日期筛选
        offset: 分页偏移
        limit: 每页记录数
        include_comments: 是否包含评论（默认 True）
        comments_limit: 每条记录返回的评论数（默认 5）
        
    Returns:
        列表，每项包含 record、author、comments（可选）
    """
    friend_ids = await get_friend_ids(user_id)
    author_ids = list(set(friend_ids) | {user_id})
    if not author_ids:
        author_ids = [user_id]

    normalized_priority_ids = [
        aid for aid in list(dict.fromkeys([str(x).strip() for x in (priority_author_ids or []) if str(x).strip()]))
        if aid in author_ids
    ]
    if author_scope == "priority":
        author_ids = normalized_priority_ids
        if not author_ids:
            return []
    
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        q = supabase.table("user_food_records").select("*").in_("user_id", author_ids)
        q = q.neq("hidden_from_feed", True)
        
        if date:
            start_ts = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
            end_d = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)
            end_ts = end_d.isoformat().replace("+00:00", "Z")
            q = q.gte("record_time", start_ts).lt("record_time", end_ts)

        if meal_type:
            q = q.eq("meal_type", meal_type)
        if diet_goal:
            q = q.eq("diet_goal", diet_goal)

        custom_rank = sort_by in {"recommended", "hot", "balanced"}
        candidate_limit = max(offset + limit + 40, limit * 3, 60) if custom_rank else limit
        range_start = 0 if custom_rank else offset
        range_end = candidate_limit - 1 if custom_rank else offset + limit - 1

        q = q.order("record_time", desc=True).range(range_start, range_end)
        records = q.execute()
        
        rec_list = list(records.data or [])
        if not rec_list:
            return []

        likes_map: Dict[str, Dict[str, Any]] = {}
        comment_count_map: Dict[str, int] = {}
        if custom_rank:
            record_ids = [r["id"] for r in rec_list]
            likes_map = await get_feed_likes_for_records(record_ids, user_id) if record_ids else {}
            comment_bundle = _query_feed_comments_bundle_sync(supabase, record_ids, 0) if record_ids else {"comment_count_map": {}}
            comment_count_map = comment_bundle["comment_count_map"]

            rec_list.sort(
                key=lambda r: (
                    (_parse_iso_datetime(r.get("record_time")) or datetime.fromtimestamp(0, tz=timezone.utc)).timestamp(),
                    _score_feed_record(
                        r,
                        sort_by=sort_by,
                        like_count=likes_map.get(r["id"], {}).get("count", 0),
                        comment_count=comment_count_map.get(r["id"], 0),
                        meal_type=meal_type,
                        diet_goal=diet_goal,
                        priority_author_ids=normalized_priority_ids,
                    ),
                ),
                reverse=True,
            )
            rec_list = rec_list[offset: offset + limit]
            if not rec_list:
                return []
            
        # 获取作者信息（仅查询结果中涉及的用户）
        involved_user_ids = list(set(r["user_id"] for r in rec_list))
        authors = supabase.table("weapp_user").select("id, nickname, avatar").in_("id", involved_user_ids).execute()
        author_map = {a["id"]: a for a in (authors.data or [])}
        
        # 批量获取评论（如果需要）
        comments_map: Dict[str, List[Dict[str, Any]]] = {}
        if include_comments:
            record_ids = [r["id"] for r in rec_list]
            bundle = _query_feed_comments_bundle_sync(supabase, record_ids, comments_limit)
            comments_map = bundle["comments_map"]
            comment_count_map = bundle["comment_count_map"]
        elif not comment_count_map:
            record_ids = [r["id"] for r in rec_list]
            if record_ids:
                comment_count_map = _query_feed_comments_bundle_sync(supabase, record_ids, 0)["comment_count_map"]

        if not likes_map:
            record_ids = [r["id"] for r in rec_list]
            likes_map = await get_feed_likes_for_records(record_ids, user_id) if record_ids else {}
        
        out = []
        for r in rec_list:
            author = author_map.get(r["user_id"], {})
            like_info = likes_map.get(r["id"], {"count": 0, "liked": False})
            item = {
                "record": r,
                "author": {
                    "id": author.get("id"),
                    "nickname": author.get("nickname") or "用户",
                    "avatar": author.get("avatar") or "",
                },
                "like_count": like_info.get("count", 0),
                "liked": like_info.get("liked", False),
                "is_mine": r.get("user_id") == user_id,
                "recommend_reason": _build_feed_recommend_reason(
                    r,
                    sort_by=sort_by,
                    meal_type=meal_type,
                    diet_goal=diet_goal,
                    priority_author_ids=normalized_priority_ids,
                    like_count=like_info.get("count", 0),
                    comment_count=comment_count_map.get(r["id"], 0),
                ),
            }
            if include_comments:
                item["comments"] = comments_map.get(r["id"], [])
                item["comment_count"] = comment_count_map.get(r["id"], 0)
            else:
                item["comment_count"] = comment_count_map.get(r["id"], 0)
            out.append(item)
        return out
    except Exception as e:
        print(f"[list_friends_feed_records] 错误: {e}")
        raise


async def get_friend_circle_week_checkin_leaderboard(viewer_user_id: str) -> Dict[str, Any]:
    """
    本周打卡排行榜：统计「自己 + 好友」在 user_food_records 中的记录条数。
    自然周按北京时间：周一 00:00 至下周一 00:00（不含）。
    """
    friend_ids = await get_friend_ids(viewer_user_id)
    author_ids = list(set(friend_ids) | {viewer_user_id})
    if not author_ids:
        author_ids = [viewer_user_id]

    now_cn = datetime.now(CHINA_TZ)
    weekday = now_cn.weekday()  # Monday = 0
    week_start_cn = (now_cn - timedelta(days=weekday)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    week_end_cn = week_start_cn + timedelta(days=7)

    start_ts = week_start_cn.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    end_ts = week_end_cn.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    counts: Counter = Counter()
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        page_size = 1000
        offset = 0
        while True:
            q = (
                supabase.table("user_food_records")
                .select("user_id")
                .in_("user_id", author_ids)
                .gte("record_time", start_ts)
                .lt("record_time", end_ts)
                .range(offset, offset + page_size - 1)
            )
            batch = q.execute()
            rows = list(batch.data or [])
            for r in rows:
                uid = r.get("user_id")
                if uid:
                    counts[uid] += 1
            if len(rows) < page_size:
                break
            offset += page_size

        users_result = (
            supabase.table("weapp_user")
            .select("id, nickname, avatar")
            .in_("id", author_ids)
            .execute()
        )
        profile_map = {u["id"]: u for u in (users_result.data or [])}

        items = []
        for uid in author_ids:
            p = profile_map.get(uid, {})
            items.append(
                {
                    "user_id": uid,
                    "nickname": (p.get("nickname") or "用户") if p else "用户",
                    "avatar": (p.get("avatar") or "") if p else "",
                    "checkin_count": int(counts.get(uid, 0)),
                    "is_me": uid == viewer_user_id,
                }
            )

        items.sort(
            key=lambda x: (-x["checkin_count"], x["nickname"] or ""),
        )
        for i, row in enumerate(items, start=1):
            row["rank"] = i

        week_start_str = week_start_cn.strftime("%Y-%m-%d")
        week_end_inclusive = (week_start_cn + timedelta(days=6)).strftime("%Y-%m-%d")

        return {
            "week_start": week_start_str,
            "week_end": week_end_inclusive,
            "list": items,
        }
    except Exception as e:
        print(f"[get_friend_circle_week_checkin_leaderboard] 错误: {e}")
        raise


async def list_public_feed_records(
    offset: int = 0,
    limit: int = 20,
    include_comments: bool = True,
    comments_limit: int = 5,
    meal_type: Optional[str] = None,
    diet_goal: Optional[str] = None,
    sort_by: str = "latest",
) -> List[Dict[str, Any]]:
    """
    获取公共饮食记录（来自 public_records=true 的用户），无需登录。
    用于未登录用户浏览圈子。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        # 找出 public_records=true 的用户
        public_users = supabase.table("weapp_user").select("id").eq("public_records", True).execute()
        public_user_ids = [u["id"] for u in (public_users.data or [])]
        if not public_user_ids:
            return []

        q = supabase.table("user_food_records").select("*").in_("user_id", public_user_ids)
        q = q.neq("hidden_from_feed", True)
        if meal_type:
            q = q.eq("meal_type", meal_type)
        if diet_goal:
            q = q.eq("diet_goal", diet_goal)

        custom_rank = sort_by in {"recommended", "hot", "balanced"}
        candidate_limit = max(offset + limit + 40, limit * 3, 60) if custom_rank else limit
        range_start = 0 if custom_rank else offset
        range_end = candidate_limit - 1 if custom_rank else offset + limit - 1
        q = q.order("record_time", desc=True).range(range_start, range_end)
        records = q.execute()
        rec_list = list(records.data or [])
        if not rec_list:
            return []

        likes_map: Dict[str, Dict[str, Any]] = {}
        comment_count_map: Dict[str, int] = {}
        if custom_rank:
            record_ids = [r["id"] for r in rec_list]
            likes_map = await get_feed_likes_for_records(record_ids, None) if record_ids else {}
            comment_bundle = _query_feed_comments_bundle_sync(supabase, record_ids, 0) if record_ids else {"comment_count_map": {}}
            comment_count_map = comment_bundle["comment_count_map"]

            rec_list.sort(
                key=lambda r: (
                    (_parse_iso_datetime(r.get("record_time")) or datetime.fromtimestamp(0, tz=timezone.utc)).timestamp(),
                    _score_feed_record(
                        r,
                        sort_by=sort_by,
                        like_count=likes_map.get(r["id"], {}).get("count", 0),
                        comment_count=comment_count_map.get(r["id"], 0),
                        meal_type=meal_type,
                        diet_goal=diet_goal,
                        priority_author_ids=None,
                    ),
                ),
                reverse=True,
            )
            rec_list = rec_list[offset: offset + limit]
            if not rec_list:
                return []

        involved_user_ids = list(set(r["user_id"] for r in rec_list))
        authors = supabase.table("weapp_user").select("id, nickname, avatar").in_("id", involved_user_ids).execute()
        author_map = {a["id"]: a for a in (authors.data or [])}

        comments_map: Dict[str, List[Dict[str, Any]]] = {}
        if include_comments:
            record_ids = [r["id"] for r in rec_list]
            bundle = _query_feed_comments_bundle_sync(supabase, record_ids, comments_limit)
            comments_map = bundle["comments_map"]
            comment_count_map = bundle["comment_count_map"]
        elif not comment_count_map:
            record_ids = [r["id"] for r in rec_list]
            if record_ids:
                comment_count_map = _query_feed_comments_bundle_sync(supabase, record_ids, 0)["comment_count_map"]

        if not likes_map:
            record_ids = [r["id"] for r in rec_list]
            likes_map = await get_feed_likes_for_records(record_ids, None) if record_ids else {}

        out = []
        for r in rec_list:
            author = author_map.get(r["user_id"], {})
            like_info = likes_map.get(r["id"], {"count": 0, "liked": False})
            item: Dict[str, Any] = {
                "record": r,
                "author": {
                    "id": author.get("id"),
                    "nickname": author.get("nickname") or "用户",
                    "avatar": author.get("avatar") or "",
                },
                "like_count": like_info.get("count", 0),
                "liked": False,
                "is_mine": False,
                "recommend_reason": _build_feed_recommend_reason(
                    r,
                    sort_by=sort_by,
                    meal_type=meal_type,
                    diet_goal=diet_goal,
                    priority_author_ids=None,
                    like_count=like_info.get("count", 0),
                    comment_count=comment_count_map.get(r["id"], 0),
                ),
            }
            if include_comments:
                item["comments"] = comments_map.get(r["id"], [])
                item["comment_count"] = comment_count_map.get(r["id"], 0)
            else:
                item["comment_count"] = comment_count_map.get(r["id"], 0)
            out.append(item)
        return out
    except Exception as e:
        print(f"[list_public_feed_records] 错误: {e}")
        raise


async def add_feed_like(user_id: str, record_id: str) -> bool:
    """对某条饮食记录点赞；返回是否新增了一条点赞。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        supabase.table("feed_likes").insert({"user_id": user_id, "record_id": record_id}).execute()
        return True
    except Exception as e:
        if "unique" in str(e).lower() or "duplicate" in str(e).lower():
            return False
        print(f"[add_feed_like] 错误: {e}")
        raise


async def remove_feed_like(user_id: str, record_id: str) -> None:
    """取消点赞"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        supabase.table("feed_likes").delete().eq("user_id", user_id).eq("record_id", record_id).execute()
    except Exception as e:
        print(f"[remove_feed_like] 错误: {e}")
        raise


async def get_feed_likes_for_records(record_ids: List[str], current_user_id: Optional[str]) -> Dict[str, Any]:
    """批量查询点赞数及当前用户是否已点赞。返回 { record_id: { count, liked } }"""
    if not record_ids:
        return {}
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        r = supabase.table("feed_likes").select("record_id").in_("record_id", record_ids).execute()
        rows = r.data or []
        count_map: Dict[str, int] = {}
        for row in rows:
            rid = row["record_id"]
            count_map[rid] = count_map.get(rid, 0) + 1
        my_set: set = set()
        if current_user_id:
            my = supabase.table("feed_likes").select("record_id").eq("user_id", current_user_id).in_("record_id", record_ids).execute()
            my_set = {m["record_id"] for m in (my.data or [])}
        return {rid: {"count": count_map.get(rid, 0), "liked": rid in my_set} for rid in record_ids}
    except Exception as e:
        print(f"[get_feed_likes_for_records] 错误: {e}")
        raise


async def add_feed_comment(
    user_id: str,
    record_id: str,
    content: str,
    parent_comment_id: Optional[str] = None,
    reply_to_user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """发表评论"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        row = {
            "user_id": user_id,
            "record_id": record_id,
            "content": content.strip(),
            "parent_comment_id": parent_comment_id,
            "reply_to_user_id": reply_to_user_id,
        }
        result = supabase.table("feed_comments").insert(row).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("发表评论失败")
    except Exception as e:
        print(f"[add_feed_comment] 错误: {e}")
        raise


def add_feed_comment_sync(
    user_id: str,
    record_id: str,
    content: str,
    parent_comment_id: Optional[str] = None,
    reply_to_user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """发表评论（同步版本，供 Worker 使用）"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        row = {
            "user_id": user_id,
            "record_id": record_id,
            "content": content.strip(),
            "parent_comment_id": parent_comment_id,
            "reply_to_user_id": reply_to_user_id,
        }
        result = supabase.table("feed_comments").insert(row).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("发表评论失败")
    except Exception as e:
        print(f"[add_feed_comment_sync] 错误: {e}")
        raise


async def list_feed_comments(record_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """某条动态的评论列表，含评论者 nickname、avatar"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = (
            supabase.table("feed_comments")
            .select("id, user_id, record_id, parent_comment_id, reply_to_user_id, content, created_at")
            .eq("record_id", record_id)
            .order("created_at", desc=False)
            .execute()
        )
        rows = list(result.data or [])
        if not rows:
            return []
        if limit > 0 and len(rows) > limit:
            rows = rows[-limit:]
        user_ids = {
            uid
            for uid in ([r.get("user_id") for r in rows] + [r.get("reply_to_user_id") for r in rows])
            if uid
        }
        users = supabase.table("weapp_user").select("id, nickname, avatar").in_("id", list(user_ids)).execute()
        user_map = {u["id"]: u for u in (users.data or [])}
        return [_normalize_feed_comment_row(r, user_map) for r in rows]
    except Exception as e:
        print(f"[list_feed_comments] 错误: {e}")
        raise


# ---------- 公共食物库 ----------

async def create_public_food_library_item(
    user_id: str,
    image_path: Optional[str] = None,
    image_paths: Optional[List[str]] = None,
    source_record_id: Optional[str] = None,
    total_calories: float = 0,
    total_protein: float = 0,
    total_carbs: float = 0,
    total_fat: float = 0,
    items: Optional[List[Dict[str, Any]]] = None,
    description: Optional[str] = None,
    insight: Optional[str] = None,
    food_name: Optional[str] = None,
    merchant_name: Optional[str] = None,
    merchant_address: Optional[str] = None,
    taste_rating: Optional[int] = None,
    suitable_for_fat_loss: bool = False,
    user_tags: Optional[List[str]] = None,
    user_notes: Optional[str] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    province: Optional[str] = None,
    city: Optional[str] = None,
    district: Optional[str] = None,
) -> Dict[str, Any]:
    """
    创建公共食物库条目（上传/分享）。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    paths = image_paths if image_paths else ([image_path] if image_path else [])
    first_path = paths[0] if paths else image_path
    row = {
        "user_id": user_id,
        "image_path": first_path,
        "image_paths": paths,
        "source_record_id": source_record_id,
        "total_calories": total_calories,
        "total_protein": total_protein,
        "total_carbs": total_carbs,
        "total_fat": total_fat,
        "items": items or [],
        "description": description or "",
        "insight": insight or "",
        "food_name": food_name or "",
        "merchant_name": merchant_name or "",
        "merchant_address": merchant_address or "",
        "taste_rating": taste_rating,
        "suitable_for_fat_loss": suitable_for_fat_loss,
        "user_tags": user_tags or [],
        "user_notes": user_notes or "",
        "latitude": latitude,
        "longitude": longitude,
        "province": province or "",
        "city": city or "",
        "district": district or "",
        "status": "pending",  # 初始状态设为 pending
        "published_at": None, # 审核通过后再更新发帖时间
    }
    try:
        result = supabase.table("public_food_library").insert(row).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("创建公共食物库条目失败：返回数据为空")
    except Exception as e:
        print(f"[create_public_food_library_item] 错误: {e}")
        raise

def update_public_food_library_status_sync(item_id: str, status: str) -> None:
    """
    更新公共食物库条目的状态。如果是 published，同时更新 published_at。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    row = {
        "status": status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if status == "published":
        row["published_at"] = datetime.now(timezone.utc).isoformat()
    try:
        supabase.table("public_food_library").update(row).eq("id", item_id).execute()
    except Exception as e:
        print(f"[update_public_food_library_status_sync] 错误: {e}")
        raise


def _score_public_food_library_item(item: Dict[str, Any], sort_by: str) -> float:
    total_calories = max(float(item.get("total_calories") or 0), 0.0)
    total_protein = max(float(item.get("total_protein") or 0), 0.0)
    like_count = max(int(item.get("like_count") or 0), 0)
    collection_count = max(int(item.get("collection_count") or 0), 0)
    comment_count = max(int(item.get("comment_count") or 0), 0)
    rating_score = max(min(float(item.get("avg_rating") or 0) / 5.0, 1.0), 0.0)
    hot_score = min((like_count * 2 + collection_count * 2 + comment_count * 3) / 40.0, 1.0)
    balance_score = _compute_macro_balance_score(
        item.get("total_protein"),
        item.get("total_carbs"),
        item.get("total_fat"),
    ) / 100.0
    protein_density = min((total_protein / max(total_calories, 1.0)) * 250.0, 1.0) if total_calories > 0 else 0.0
    low_calorie_score = max(0.0, 1.0 - min(total_calories, 900.0) / 900.0)
    fat_loss_bonus = 1.0 if item.get("suitable_for_fat_loss") else 0.0

    if sort_by == "balanced":
        return balance_score * 100.0 + hot_score * 12.0 + rating_score * 10.0
    if sort_by == "high_protein":
        return protein_density * 100.0 + balance_score * 15.0 + hot_score * 10.0
    if sort_by == "low_calorie":
        return low_calorie_score * 100.0 + balance_score * 10.0 + hot_score * 8.0

    return (
        fat_loss_bonus * 25.0
        + balance_score * 22.0
        + protein_density * 18.0
        + low_calorie_score * 16.0
        + hot_score * 12.0
        + rating_score * 10.0
    )


def _build_public_food_library_recommend_reason(item: Dict[str, Any], sort_by: str) -> str:
    if sort_by == "balanced":
        return "营养更均衡"
    if sort_by == "high_protein":
        return "高蛋白优先"
    if sort_by == "low_calorie":
        return "低热量优先"
    if item.get("suitable_for_fat_loss"):
        return "更适合减脂"
    if _compute_macro_balance_score(
        item.get("total_protein"),
        item.get("total_carbs"),
        item.get("total_fat"),
    ) >= 72:
        return "营养较均衡"
    if int(item.get("like_count") or 0) >= 5:
        return "大家更爱收藏点赞"
    return "值得参考"


async def list_public_food_library(
    city: Optional[str] = None,
    suitable_for_fat_loss: Optional[bool] = None,
    merchant_name: Optional[str] = None,
    min_calories: Optional[float] = None,
    max_calories: Optional[float] = None,
    sort_by: str = "latest",  # latest / hot / rating / balanced / high_protein / low_calorie / recommended
    limit: int = 20,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """
    查询公共食物库列表（仅返回 published 状态）。
    可按城市、适合减脂、商家名模糊、热量区间筛选。
    排序：latest（最新）/ hot（点赞最多）/ rating（评分最高）
         / balanced（营养更均衡）/ high_protein（高蛋白）/ low_calorie（低热量）/ recommended（综合推荐）。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        q = supabase.table("public_food_library").select("*").eq("status", "published")
        if city:
            q = q.eq("city", city)
        if suitable_for_fat_loss is not None:
            q = q.eq("suitable_for_fat_loss", suitable_for_fat_loss)
        if merchant_name:
            q = q.ilike("merchant_name", f"%{merchant_name}%")
        if min_calories is not None:
            q = q.gte("total_calories", min_calories)
        if max_calories is not None:
            q = q.lte("total_calories", max_calories)
        custom_rank = sort_by in {"balanced", "high_protein", "low_calorie", "recommended"}
        candidate_limit = max(offset + limit + 80, limit * 3, 100) if custom_rank else limit

        if sort_by == "hot":
            q = q.order("like_count", desc=True)
        elif sort_by == "rating":
            q = q.order("avg_rating", desc=True)
        else:
            q = q.order("published_at", desc=True)

        if custom_rank:
            q = q.range(0, candidate_limit - 1)
        else:
            q = q.range(offset, offset + limit - 1)
        result = q.execute()
        items = list(result.data or [])

        if custom_rank:
            items.sort(
                key=lambda item: (
                    -_score_public_food_library_item(item, sort_by),
                    -(_parse_iso_datetime(item.get("published_at") or item.get("created_at")) or datetime.fromtimestamp(0, tz=timezone.utc)).timestamp(),
                )
            )
            items = items[offset: offset + limit]

        for item in items:
            item["recommend_reason"] = _build_public_food_library_recommend_reason(item, sort_by)
        return items
    except Exception as e:
        print(f"[list_public_food_library] 错误: {e}")
        raise


async def get_public_food_library_item(item_id: str) -> Optional[Dict[str, Any]]:
    """获取单条公共食物库条目详情"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("public_food_library").select("*").eq("id", item_id).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_public_food_library_item] 错误: {e}")
        raise


async def list_my_public_food_library(user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """获取当前用户上传/分享的公共食物库条目"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("public_food_library").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(limit).execute()
        return list(result.data or [])
    except Exception as e:
        print(f"[list_my_public_food_library] 错误: {e}")
        raise


async def add_public_food_library_like(user_id: str, item_id: str) -> None:
    """对公共食物库条目点赞"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        supabase.table("public_food_library_likes").insert({"user_id": user_id, "library_item_id": item_id}).execute()
    except Exception as e:
        if "unique" in str(e).lower() or "duplicate" in str(e).lower():
            return
        print(f"[add_public_food_library_like] 错误: {e}")
        raise


async def remove_public_food_library_like(user_id: str, item_id: str) -> None:
    """取消点赞"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        supabase.table("public_food_library_likes").delete().eq("user_id", user_id).eq("library_item_id", item_id).execute()
    except Exception as e:
        print(f"[remove_public_food_library_like] 错误: {e}")
        raise


async def get_public_food_library_likes_for_items(item_ids: List[str], current_user_id: str) -> Dict[str, Any]:
    """批量查询公共食物库点赞数及当前用户是否已点赞。返回 { item_id: { count, liked } }"""
    if not item_ids:
        return {}
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        r = supabase.table("public_food_library_likes").select("library_item_id").in_("library_item_id", item_ids).execute()
        rows = r.data or []
        count_map: Dict[str, int] = {}
        for row in rows:
            iid = row["library_item_id"]
            count_map[iid] = count_map.get(iid, 0) + 1
        my = supabase.table("public_food_library_likes").select("library_item_id").eq("user_id", current_user_id).in_("library_item_id", item_ids).execute()
        my_set = {m["library_item_id"] for m in (my.data or [])}
        return {iid: {"count": count_map.get(iid, 0), "liked": iid in my_set} for iid in item_ids}
    except Exception as e:
        print(f"[get_public_food_library_likes_for_items] 错误: {e}")
        raise


async def add_public_food_library_collection(user_id: str, item_id: str) -> None:
    """收藏公共食物库条目"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        supabase.table("public_food_library_collections").insert({"user_id": user_id, "library_item_id": item_id}).execute()
    except Exception as e:
        if "unique" in str(e).lower() or "duplicate" in str(e).lower():
            return
        print(f"[add_public_food_library_collection] 错误: {e}")
        raise


async def remove_public_food_library_collection(user_id: str, item_id: str) -> None:
    """取消收藏"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        supabase.table("public_food_library_collections").delete().eq("user_id", user_id).eq("library_item_id", item_id).execute()
    except Exception as e:
        print(f"[remove_public_food_library_collection] 错误: {e}")
        raise


async def get_public_food_library_collections_for_items(item_ids: List[str], current_user_id: str) -> Dict[str, Any]:
    """批量查询公共食物库收藏数及当前用户是否已收藏。返回 { item_id: { count, collected } }"""
    if not item_ids:
        return {}
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        # collection_count 已在主表中维护，这里主要查当前用户是否收藏
        my = supabase.table("public_food_library_collections").select("library_item_id").eq("user_id", current_user_id).in_("library_item_id", item_ids).execute()
        my_set = {m["library_item_id"] for m in (my.data or [])}
        return {iid: {"collected": iid in my_set} for iid in item_ids}
    except Exception as e:
        print(f"[get_public_food_library_collections_for_items] 错误: {e}")
        raise


async def list_collected_public_food_library(user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """获取当前用户收藏的公共食物库条目（按收藏时间倒序）。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        rows = (
            supabase.table("public_food_library_collections")
            .select("library_item_id, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        data = list(rows.data or [])
        if not data:
            return []
        item_ids_ordered = [r["library_item_id"] for r in data]
        # 只查已发布的
        result = (
            supabase.table("public_food_library")
            .select("*")
            .in_("id", item_ids_ordered)
            .eq("status", "published")
            .execute()
        )
        items_by_id = {it["id"]: it for it in (result.data or [])}
        # 按收藏顺序返回，已删除或未发布的条目跳过
        out = []
        for iid in item_ids_ordered:
            if iid in items_by_id:
                out.append(items_by_id[iid])
        return out
    except Exception as e:
        print(f"[list_collected_public_food_library] 错误: {e}")
        raise


async def add_public_food_library_comment(
    user_id: str,
    item_id: str,
    content: str,
    rating: Optional[int] = None,
) -> Dict[str, Any]:
    """发表公共食物库评论（可选评分）"""
    check_supabase_configured()
    supabase = get_supabase_client()
    row = {
        "user_id": user_id,
        "library_item_id": item_id,
        "content": content.strip(),
    }
    if rating is not None:
        row["rating"] = rating
    try:
        result = supabase.table("public_food_library_comments").insert(row).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("发表评论失败")
    except Exception as e:
        print(f"[add_public_food_library_comment] 错误: {e}")
        raise


def add_public_food_library_comment_sync(
    user_id: str,
    item_id: str,
    content: str,
    rating: Optional[int] = None,
) -> Dict[str, Any]:
    """发表公共食物库评论（同步版本，供 Worker 使用）"""
    check_supabase_configured()
    supabase = get_supabase_client()
    row = {
        "user_id": user_id,
        "library_item_id": item_id,
        "content": content.strip(),
    }
    if rating is not None:
        row["rating"] = rating
    try:
        result = supabase.table("public_food_library_comments").insert(row).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("发表评论失败")
    except Exception as e:
        print(f"[add_public_food_library_comment_sync] 错误: {e}")
        raise


async def list_public_food_library_comments(item_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """公共食物库条目的评论列表，含评论者 nickname、avatar"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("public_food_library_comments").select("id, user_id, library_item_id, content, rating, created_at").eq("library_item_id", item_id).order("created_at", desc=False).limit(limit).execute()
        rows = list(result.data or [])
        if not rows:
            return []
        user_ids = list({r["user_id"] for r in rows})
        users = supabase.table("weapp_user").select("id, nickname, avatar").in_("id", user_ids).execute()
        user_map = {u["id"]: u for u in (users.data or [])}
        out = []
        for r in rows:
            u = user_map.get(r["user_id"], {})
            out.append({
                "id": r["id"],
                "user_id": r["user_id"],
                "library_item_id": r["library_item_id"],
                "content": r["content"],
                "rating": r.get("rating"),
                "created_at": r["created_at"],
                "nickname": u.get("nickname") or "用户",
                "avatar": u.get("avatar") or "",
            })
        return out
    except Exception as e:
        print(f"[list_public_food_library_comments] 错误: {e}")
        raise


async def get_food_record_by_id(record_id: str) -> Optional[Dict[str, Any]]:
    """通过 ID 获取单条饮食记录（用于分享到公共库时读取来源记录）"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("user_food_records").select("*").eq("id", record_id).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_food_record_by_id] 错误: {e}")
        raise


def get_food_record_by_id_sync(record_id: str) -> Optional[Dict[str, Any]]:
    """同步版：通过 ID 获取单条饮食记录，供 Worker 使用。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("user_food_records").select("*").eq("id", record_id).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_food_record_by_id_sync] 错误: {e}")
        raise


def get_feed_comment_by_id_sync(comment_id: str) -> Optional[Dict[str, Any]]:
    """同步版：按 ID 获取圈子评论。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("feed_comments").select("*").eq("id", comment_id).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_feed_comment_by_id_sync] 错误: {e}")
        raise


async def get_feed_comment_by_id(comment_id: str) -> Optional[Dict[str, Any]]:
    """按 ID 获取圈子评论。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("feed_comments").select("*").eq("id", comment_id).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_feed_comment_by_id] 错误: {e}")
        raise


def create_feed_interaction_notification_sync(
    recipient_user_id: str,
    notification_type: str,
    actor_user_id: Optional[str] = None,
    record_id: Optional[str] = None,
    comment_id: Optional[str] = None,
    parent_comment_id: Optional[str] = None,
    content_preview: Optional[str] = None,
) -> Dict[str, Any]:
    """创建一条圈子互动通知。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    row: Dict[str, Any] = {
        "recipient_user_id": recipient_user_id,
        "notification_type": notification_type,
        "actor_user_id": actor_user_id,
        "record_id": record_id,
        "comment_id": comment_id,
        "parent_comment_id": parent_comment_id,
        "content_preview": content_preview,
    }
    try:
        result = supabase.table("feed_interaction_notifications").insert(row).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("创建互动通知失败")
    except Exception as e:
        print(f"[create_feed_interaction_notification_sync] 错误: {e}")
        raise


async def list_feed_interaction_notifications(user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """查询用户收到的圈子互动通知列表。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = (
            supabase.table("feed_interaction_notifications")
            .select("*")
            .eq("recipient_user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        rows = list(result.data or [])
        if not rows:
            return []
        actor_ids = list({row.get("actor_user_id") for row in rows if row.get("actor_user_id")})
        actor_map: Dict[str, Dict[str, Any]] = {}
        if actor_ids:
            users = supabase.table("weapp_user").select("id, nickname, avatar").in_("id", actor_ids).execute()
            actor_map = {u["id"]: u for u in (users.data or [])}
        out = []
        for row in rows:
            actor = actor_map.get(row.get("actor_user_id"), {})
            out.append({
                "id": row.get("id"),
                "notification_type": row.get("notification_type"),
                "record_id": row.get("record_id"),
                "comment_id": row.get("comment_id"),
                "parent_comment_id": row.get("parent_comment_id"),
                "content_preview": row.get("content_preview") or "",
                "is_read": bool(row.get("is_read")),
                "created_at": row.get("created_at"),
                "actor": {
                    "id": actor.get("id"),
                    "nickname": actor.get("nickname") or "系统",
                    "avatar": actor.get("avatar") or "",
                },
            })
        return out
    except Exception as e:
        print(f"[list_feed_interaction_notifications] 错误: {e}")
        raise


async def count_unread_feed_interaction_notifications(user_id: str) -> int:
    """统计未读圈子互动通知数。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = (
            supabase.table("feed_interaction_notifications")
            .select("id")
            .eq("recipient_user_id", user_id)
            .eq("is_read", False)
            .execute()
        )
        return len(result.data or [])
    except Exception as e:
        print(f"[count_unread_feed_interaction_notifications] 错误: {e}")
        raise


async def mark_feed_interaction_notifications_read(
    user_id: str,
    notification_ids: Optional[List[str]] = None,
) -> int:
    """标记圈子互动通知为已读；未传 notification_ids 时标记全部已读。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        q = (
            supabase.table("feed_interaction_notifications")
            .update({"is_read": True, "read_at": datetime.now(timezone.utc).isoformat()})
            .eq("recipient_user_id", user_id)
            .eq("is_read", False)
        )
        if notification_ids:
            q = q.in_("id", notification_ids)
        result = q.execute()
        return len(result.data or [])
    except Exception as e:
        print(f"[mark_feed_interaction_notifications_read] 错误: {e}")
        raise


async def update_food_record(user_id: str, record_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """更新用户自己的饮食记录，仅当记录属于该用户时更新。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = (
            supabase.table("user_food_records")
            .update(data)
            .eq("id", record_id)
            .eq("user_id", user_id)
            .execute()
        )
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[update_food_record] 错误: {e}")
        raise


async def delete_food_record(user_id: str, record_id: str) -> bool:
    """删除用户自己的饮食记录，仅当记录属于该用户时删除。返回是否删除了记录。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("user_food_records").delete().eq("id", record_id).eq("user_id", user_id).execute()
        return result.data is not None and len(result.data) > 0
    except Exception as e:
        print(f"[delete_food_record] 错误: {e}")
        raise


async def hide_food_record_from_feed(user_id: str, record_id: str) -> bool:
    """将自己的饮食记录从圈子 Feed 中隐藏（不删除记录本身）。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = (
            supabase.table("user_food_records")
            .update({"hidden_from_feed": True})
            .eq("id", record_id)
            .eq("user_id", user_id)
            .execute()
        )
        return result.data is not None and len(result.data) > 0
    except Exception as e:
        print(f"[hide_food_record_from_feed] 错误: {e}")
        raise


# ---------- 用户私人食谱 ----------

async def create_user_recipe(user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """创建私人食谱"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        recipe_data = {
            "user_id": user_id,
            "recipe_name": data.get("recipe_name"),
            "description": data.get("description"),
            "image_path": data.get("image_path"),
            "items": data.get("items", []),
            "total_calories": data.get("total_calories", 0),
            "total_protein": data.get("total_protein", 0),
            "total_carbs": data.get("total_carbs", 0),
            "total_fat": data.get("total_fat", 0),
            "total_weight_grams": data.get("total_weight_grams", 0),
            "tags": data.get("tags", []),
            "meal_type": data.get("meal_type"),
            "is_favorite": data.get("is_favorite", False),
        }
        result = supabase.table("user_recipes").insert(recipe_data).execute()
        return result.data[0] if result.data else {}
    except Exception as e:
        print(f"[create_user_recipe] 错误: {e}")
        raise


async def list_user_recipes(user_id: str, meal_type: Optional[str] = None, is_favorite: Optional[bool] = None) -> List[Dict[str, Any]]:
    """获取用户的私人食谱列表"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        query = supabase.table("user_recipes").select("*").eq("user_id", user_id)
        if meal_type:
            query = query.eq("meal_type", meal_type)
        if is_favorite is not None:
            query = query.eq("is_favorite", is_favorite)
        result = query.order("created_at", desc=True).execute()
        return result.data or []
    except Exception as e:
        print(f"[list_user_recipes] 错误: {e}")
        raise


async def get_user_recipe(recipe_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """获取单个食谱详情"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("user_recipes").select("*").eq("id", recipe_id).eq("user_id", user_id).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_user_recipe] 错误: {e}")
        raise


async def update_user_recipe(recipe_id: str, user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """更新食谱"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("user_recipes").update(data).eq("id", recipe_id).eq("user_id", user_id).execute()
        return result.data[0] if result.data else {}
    except Exception as e:
        print(f"[update_user_recipe] 错误: {e}")
        raise


async def delete_user_recipe(recipe_id: str, user_id: str) -> bool:
    """删除食谱"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        supabase.table("user_recipes").delete().eq("id", recipe_id).eq("user_id", user_id).execute()
        return True
    except Exception as e:
        print(f"[delete_user_recipe] 错误: {e}")
        raise


async def use_recipe_record(recipe_id: str, user_id: str) -> bool:
    """使用食谱时更新使用次数和最后使用时间"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        # 先获取当前使用次数
        recipe = await get_user_recipe(recipe_id, user_id)
        if not recipe:
            return False
        
        # 更新使用次数和时间
        supabase.table("user_recipes").update({
            "use_count": (recipe.get("use_count", 0) + 1),
            "last_used_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", recipe_id).eq("user_id", user_id).execute()
        return True
    except Exception as e:
        print(f"[use_recipe_record] 错误: {e}")
        raise


# ========== 模型提示词管理 ==========

async def get_active_prompt(model_type: str) -> Optional[Dict[str, Any]]:
    """
    获取指定模型的当前激活提示词
    
    Args:
        model_type: 模型类型 ('qwen' 或 'gemini')
    
    Returns:
        提示词信息字典，如果不存在则返回 None
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("model_prompts")\
            .select("*")\
            .eq("model_type", model_type)\
            .eq("is_active", True)\
            .execute()
        
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_active_prompt] 错误: {e}")
        return None


async def list_prompts(model_type: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    获取所有提示词列表
    
    Args:
        model_type: 可选，过滤指定模型类型
    
    Returns:
        提示词列表
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        query = supabase.table("model_prompts").select("*")
        if model_type:
            query = query.eq("model_type", model_type)
        result = query.order("created_at", desc=True).execute()
        return result.data or []
    except Exception as e:
        print(f"[list_prompts] 错误: {e}")
        raise


async def get_prompt_by_id(prompt_id: int) -> Optional[Dict[str, Any]]:
    """通过 ID 获取提示词"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("model_prompts")\
            .select("*")\
            .eq("id", prompt_id)\
            .execute()
        
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_prompt_by_id] 错误: {e}")
        raise


async def create_prompt(
    model_type: str,
    prompt_name: str,
    prompt_content: str,
    description: str = "",
    is_active: bool = False
) -> Dict[str, Any]:
    """
    创建新的提示词
    
    Args:
        model_type: 模型类型 ('qwen' 或 'gemini')
        prompt_name: 提示词名称
        prompt_content: 提示词内容
        description: 描述
        is_active: 是否设为当前激活
    
    Returns:
        创建的提示词信息
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        # 如果设为激活，先将该模型的其他提示词设为非激活
        if is_active:
            supabase.table("model_prompts")\
                .update({"is_active": False})\
                .eq("model_type", model_type)\
                .execute()
        
        result = supabase.table("model_prompts").insert({
            "model_type": model_type,
            "prompt_name": prompt_name,
            "prompt_content": prompt_content,
            "description": description,
            "is_active": is_active
        }).execute()
        
        return result.data[0] if result.data else {}
    except Exception as e:
        print(f"[create_prompt] 错误: {e}")
        raise


async def update_prompt(
    prompt_id: int,
    prompt_name: Optional[str] = None,
    prompt_content: Optional[str] = None,
    description: Optional[str] = None
) -> Dict[str, Any]:
    """
    更新提示词
    
    Args:
        prompt_id: 提示词 ID
        prompt_name: 新名称（可选）
        prompt_content: 新内容（可选）
        description: 新描述（可选）
    
    Returns:
        更新后的提示词信息
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        # 先获取原提示词，用于记录历史
        old_prompt = await get_prompt_by_id(prompt_id)
        if old_prompt:
            # 记录修改历史
            supabase.table("model_prompts_history").insert({
                "prompt_id": prompt_id,
                "model_type": old_prompt["model_type"],
                "prompt_name": old_prompt["prompt_name"],
                "prompt_content": old_prompt["prompt_content"],
                "change_reason": "内容更新"
            }).execute()
        
        # 构建更新数据
        update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if prompt_name is not None:
            update_data["prompt_name"] = prompt_name
        if prompt_content is not None:
            update_data["prompt_content"] = prompt_content
        if description is not None:
            update_data["description"] = description
        
        result = supabase.table("model_prompts")\
            .update(update_data)\
            .eq("id", prompt_id)\
            .execute()
        
        return result.data[0] if result.data else {}
    except Exception as e:
        print(f"[update_prompt] 错误: {e}")
        raise


async def set_active_prompt(prompt_id: int) -> bool:
    """
    设置指定提示词为激活状态
    
    Args:
        prompt_id: 提示词 ID
    
    Returns:
        是否设置成功
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        # 获取提示词信息
        prompt = await get_prompt_by_id(prompt_id)
        if not prompt:
            return False
        
        model_type = prompt["model_type"]
        
        # 先将该模型的所有提示词设为非激活
        supabase.table("model_prompts")\
            .update({"is_active": False})\
            .eq("model_type", model_type)\
            .execute()
        
        # 设置指定提示词为激活
        supabase.table("model_prompts")\
            .update({"is_active": True})\
            .eq("id", prompt_id)\
            .execute()
        
        return True
    except Exception as e:
        print(f"[set_active_prompt] 错误: {e}")
        raise


async def delete_prompt(prompt_id: int) -> bool:
    """
    删除提示词（不能删除激活状态的提示词）
    
    Args:
        prompt_id: 提示词 ID
    
    Returns:
        是否删除成功
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        # 检查是否为激活状态
        prompt = await get_prompt_by_id(prompt_id)
        if not prompt:
            return False
        
        if prompt.get("is_active"):
            raise ValueError("不能删除当前激活的提示词")
        
        supabase.table("model_prompts")\
            .delete()\
            .eq("id", prompt_id)\
            .execute()
        
        return True
    except Exception as e:
        print(f"[delete_prompt] 错误: {e}")
        raise


async def get_prompt_history(prompt_id: int) -> List[Dict[str, Any]]:
    """获取提示词的修改历史"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("model_prompts_history")\
            .select("*")\
            .eq("prompt_id", prompt_id)\
            .order("changed_at", desc=True)\
            .execute()
        return result.data or []
    except Exception as e:
        print(f"[get_prompt_history] 错误: {e}")
        raise


async def get_today_food_analysis_count(user_id: str, china_date_str: str) -> int:
    """统计用户今日（中国时区）的食物拍照分析次数（task_type 为 food 或 food_text）。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        # china_date_str 格式 "YYYY-MM-DD"，转换为 UTC 范围（UTC+8 = UTC-8h）
        day_start_utc = f"{china_date_str}T00:00:00+08:00"
        day_end_utc = f"{china_date_str}T23:59:59+08:00"
        result = supabase.table("analysis_tasks")\
            .select("id", count="exact")\
            .eq("user_id", user_id)\
            .in_("task_type", ["food", "food_text"])\
            .gte("created_at", day_start_utc)\
            .lte("created_at", day_end_utc)\
            .execute()
        return result.count or 0
    except Exception as e:
        print(f"[get_today_food_analysis_count] 错误: {e}")
        return 0


async def list_active_membership_plans() -> List[Dict[str, Any]]:
    """获取所有启用中的会员套餐配置。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("membership_plan_config")\
            .select("*")\
            .eq("is_active", True)\
            .order("created_at", desc=False)\
            .execute()
        return result.data or []
    except Exception as e:
        print(f"[list_active_membership_plans] 错误: {e}")
        raise


async def get_membership_plan_by_code(code: str) -> Optional[Dict[str, Any]]:
    """按套餐编码获取会员套餐配置。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("membership_plan_config")\
            .select("*")\
            .eq("code", code)\
            .limit(1)\
            .execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_membership_plan_by_code] 错误: {e}")
        raise


async def get_user_pro_membership(user_id: str) -> Optional[Dict[str, Any]]:
    """获取用户当前 Pro 会员状态。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("user_pro_memberships")\
            .select("*")\
            .eq("user_id", user_id)\
            .limit(1)\
            .execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_user_pro_membership] 错误: {e}")
        raise


async def create_user_pro_membership(data: Dict[str, Any]) -> Dict[str, Any]:
    """创建用户 Pro 会员状态记录。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("user_pro_memberships")\
            .insert(data)\
            .execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("创建用户会员状态失败：返回数据为空")
    except Exception as e:
        print(f"[create_user_pro_membership] 错误: {e}")
        raise


async def update_user_pro_membership(user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """更新用户 Pro 会员状态记录。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("user_pro_memberships")\
            .update(data)\
            .eq("user_id", user_id)\
            .execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("更新用户会员状态失败：返回数据为空")
    except Exception as e:
        print(f"[update_user_pro_membership] 错误: {e}")
        raise


async def save_user_pro_membership(user_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """按 user_id 保存用户 Pro 会员状态，不存在则创建。"""
    existing = await get_user_pro_membership(user_id)
    if existing:
        return await update_user_pro_membership(user_id, data)
    row = data.copy()
    row["user_id"] = user_id
    return await create_user_pro_membership(row)


async def create_pro_membership_payment_record(data: Dict[str, Any]) -> Dict[str, Any]:
    """创建 Pro 会员支付记录。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("pro_membership_payment_records")\
            .insert(data)\
            .execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("创建会员支付记录失败：返回数据为空")
    except Exception as e:
        print(f"[create_pro_membership_payment_record] 错误: {e}")
        raise


async def get_pro_membership_payment_record_by_order_no(order_no: str) -> Optional[Dict[str, Any]]:
    """按平台订单号获取 Pro 会员支付记录。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("pro_membership_payment_records")\
            .select("*")\
            .eq("order_no", order_no)\
            .limit(1)\
            .execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        return None
    except Exception as e:
        print(f"[get_pro_membership_payment_record_by_order_no] 错误: {e}")
        raise


async def update_pro_membership_payment_record(order_no: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """按平台订单号更新 Pro 会员支付记录。"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("pro_membership_payment_records")\
            .update(data)\
            .eq("order_no", order_no)\
            .execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("更新会员支付记录失败：返回数据为空")
    except Exception as e:
        print(f"[update_pro_membership_payment_record] 错误: {e}")
        raise
