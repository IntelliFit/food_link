"""
数据库操作模块
使用 Supabase 进行数据操作
"""
from supabase import create_client
import os
import base64
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List

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
        meal_type: 餐次 breakfast / lunch / dinner / snack
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
    查询用户饮食记录列表。可选按日期筛选（UTC 日）。

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
            start_ts = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
            end_d = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)
            end_ts = end_d.isoformat().replace("+00:00", "Z")
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
    start_date/end_date: YYYY-MM-DD，含首含尾（end_date 当天 24:00 前）。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        start_ts = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        end_d = datetime.strptime(end_date, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)
        end_ts = end_d.isoformat().replace("+00:00", "Z")
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
        today = datetime.now(timezone.utc).date()
        streak = 0
        d = today
        while True:
            day_str = d.strftime("%Y-%m-%d")
            start_ts = datetime.combine(d, datetime.min.time().replace(tzinfo=timezone.utc)).isoformat().replace("+00:00", "Z")
            end_ts = datetime.combine(d + timedelta(days=1), datetime.min.time().replace(tzinfo=timezone.utc)).isoformat().replace("+00:00", "Z")
            r = supabase.table("user_food_records").select("id").eq("user_id", user_id).gte("record_time", start_ts).lt("record_time", end_ts).limit(1).execute()
            if not r.data or len(r.data) == 0:
                break
            streak += 1
            d -= timedelta(days=1)
        return streak
    except Exception as e:
        print(f"[get_streak_days] 错误: {e}")
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


def upload_food_analyze_image(base64_image: str) -> str:
    """
    将食物分析图片上传到 Supabase Storage，返回公网可访问的 URL。
    路径：food-images/{uuid}.jpg
    需先在 Supabase Dashboard → Storage 创建 bucket「food-images」并设为 Public。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    raw = base64_image.split(",")[1] if "," in base64_image else base64_image
    try:
        file_bytes = base64.b64decode(raw)
    except Exception as e:
        raise ValueError(f"base64 解码失败: {e}")
    
    path = f"{uuid.uuid4().hex}.jpg"
    try:
        # 上传文件到 Supabase Storage
        supabase.storage.from_(FOOD_ANALYZE_BUCKET).upload(
            path,
            file_bytes,
            {"content-type": "image/jpeg", "upsert": "true"},
        )
    except Exception as e:
        error_msg = str(e) or f"上传失败: {type(e).__name__}"
        # 检查是否是网络或 SSL 相关错误
        if "SSL" in error_msg or "EOF" in error_msg or "connection" in error_msg.lower() or "timeout" in error_msg.lower():
            raise ConnectionError(f"连接 Supabase Storage 失败: {error_msg}")
        raise Exception(f"上传图片到 Supabase Storage 失败: {error_msg}")
    
    try:
        # 获取公网 URL
        result = supabase.storage.from_(FOOD_ANALYZE_BUCKET).get_public_url(path)
        if isinstance(result, dict):
            url = result.get("publicUrl") or result.get("public_url") or ""
            if not url:
                raise ValueError("无法获取图片公网 URL")
            return url
        if hasattr(result, "public_url"):
            url = getattr(result, "public_url", "")
            if not url:
                raise ValueError("无法获取图片公网 URL")
            return url
        if hasattr(result, "publicUrl"):
            url = getattr(result, "publicUrl", "")
            if not url:
                raise ValueError("无法获取图片公网 URL")
            return url
        url = str(result)
        if not url:
            raise ValueError("无法获取图片公网 URL")
        return url
    except Exception as e:
        error_msg = str(e) or f"获取 URL 失败: {type(e).__name__}"
        if "SSL" in error_msg or "EOF" in error_msg or "connection" in error_msg.lower():
            raise ConnectionError(f"连接 Supabase Storage 失败: {error_msg}")
        raise Exception(f"获取图片公网 URL 失败: {error_msg}")


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


# ---------- 好友系统 ----------

async def get_friend_ids(user_id: str) -> List[str]:
    """获取用户的好友 ID 列表"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("user_friends").select("friend_id").eq("user_id", user_id).execute()
        return [r["friend_id"] for r in (result.data or [])]
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


# ---------- 圈子动态（好友今日饮食 + 点赞评论）----------


async def list_friends_feed_records(
    user_id: str,
    date: Optional[str] = None,
    offset: int = 0,
    limit: int = 20,
    include_comments: bool = True,
    comments_limit: int = 5
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
    # 包含自己：圈子 Feed 同时展示自己的今日食物
    author_ids = list(set(friend_ids) | {user_id})
    if not author_ids:
        author_ids = [user_id]
    
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        q = supabase.table("user_food_records").select("*").in_("user_id", author_ids)
        
        if date:
            start_ts = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
            end_d = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)
            end_ts = end_d.isoformat().replace("+00:00", "Z")
            q = q.gte("record_time", start_ts).lt("record_time", end_ts)
            
        q = q.order("record_time", desc=True).range(offset, offset + limit - 1)
        records = q.execute()
        
        rec_list = list(records.data or [])
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
            # 批量查询所有记录的评论
            comments_result = supabase.table("feed_comments").select("id, user_id, record_id, content, created_at").in_("record_id", record_ids).order("created_at", desc=False).execute()
            all_comments = list(comments_result.data or [])
            
            # 获取评论者信息
            if all_comments:
                commenter_ids = list(set(c["user_id"] for c in all_comments))
                commenters = supabase.table("weapp_user").select("id, nickname, avatar").in_("id", commenter_ids).execute()
                commenter_map = {u["id"]: u for u in (commenters.data or [])}
                
                # 按 record_id 分组评论
                for comment in all_comments:
                    rid = comment["record_id"]
                    if rid not in comments_map:
                        comments_map[rid] = []
                    
                    u = commenter_map.get(comment["user_id"], {})
                    comments_map[rid].append({
                        "id": comment["id"],
                        "user_id": comment["user_id"],
                        "record_id": comment["record_id"],
                        "content": comment["content"],
                        "created_at": comment["created_at"],
                        "nickname": u.get("nickname") or "用户",
                        "avatar": u.get("avatar") or "",
                    })
                
                # 每个记录只保留前 N 条评论
                for rid in comments_map:
                    comments_map[rid] = comments_map[rid][:comments_limit]
        
        out = []
        for r in rec_list:
            author = author_map.get(r["user_id"], {})
            item = {
                "record": r,
                "author": {
                    "id": author.get("id"),
                    "nickname": author.get("nickname") or "用户",
                    "avatar": author.get("avatar") or "",
                },
            }
            if include_comments:
                item["comments"] = comments_map.get(r["id"], [])
            out.append(item)
        return out
    except Exception as e:
        print(f"[list_friends_feed_records] 错误: {e}")
        raise


async def add_feed_like(user_id: str, record_id: str) -> None:
    """对某条饮食记录点赞"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        supabase.table("feed_likes").insert({"user_id": user_id, "record_id": record_id}).execute()
    except Exception as e:
        if "unique" in str(e).lower() or "duplicate" in str(e).lower():
            return
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


async def get_feed_likes_for_records(record_ids: List[str], current_user_id: str) -> Dict[str, Any]:
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
        my = supabase.table("feed_likes").select("record_id").eq("user_id", current_user_id).in_("record_id", record_ids).execute()
        my_set = {m["record_id"] for m in (my.data or [])}
        return {rid: {"count": count_map.get(rid, 0), "liked": rid in my_set} for rid in record_ids}
    except Exception as e:
        print(f"[get_feed_likes_for_records] 错误: {e}")
        raise


async def add_feed_comment(user_id: str, record_id: str, content: str) -> Dict[str, Any]:
    """发表评论"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("feed_comments").insert({"user_id": user_id, "record_id": record_id, "content": content.strip()}).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("发表评论失败")
    except Exception as e:
        print(f"[add_feed_comment] 错误: {e}")
        raise


def add_feed_comment_sync(user_id: str, record_id: str, content: str) -> Dict[str, Any]:
    """发表评论（同步版本，供 Worker 使用）"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        result = supabase.table("feed_comments").insert({"user_id": user_id, "record_id": record_id, "content": content.strip()}).execute()
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
        result = supabase.table("feed_comments").select("id, user_id, record_id, content, created_at").eq("record_id", record_id).order("created_at", desc=False).limit(limit).execute()
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
                "record_id": r["record_id"],
                "content": r["content"],
                "created_at": r["created_at"],
                "nickname": u.get("nickname") or "用户",
                "avatar": u.get("avatar") or "",
            })
        return out
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
        "status": "published",  # 暂时直接发布，后续可改为 pending_review
        "published_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        result = supabase.table("public_food_library").insert(row).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]
        raise Exception("创建公共食物库条目失败：返回数据为空")
    except Exception as e:
        print(f"[create_public_food_library_item] 错误: {e}")
        raise


async def list_public_food_library(
    city: Optional[str] = None,
    suitable_for_fat_loss: Optional[bool] = None,
    merchant_name: Optional[str] = None,
    min_calories: Optional[float] = None,
    max_calories: Optional[float] = None,
    sort_by: str = "latest",  # latest / hot / rating
    limit: int = 20,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """
    查询公共食物库列表（仅返回 published 状态）。
    可按城市、适合减脂、商家名模糊、热量区间筛选。
    排序：latest（最新）/ hot（点赞最多）/ rating（评分最高）。
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
        # 排序
        if sort_by == "hot":
            q = q.order("like_count", desc=True)
        elif sort_by == "rating":
            q = q.order("avg_rating", desc=True)
        else:
            q = q.order("published_at", desc=True)
        q = q.range(offset, offset + limit - 1)
        result = q.execute()
        return list(result.data or [])
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
