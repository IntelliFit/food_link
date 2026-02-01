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


async def insert_food_record(
    user_id: str,
    meal_type: str,
    image_path: Optional[str] = None,
    description: Optional[str] = None,
    insight: Optional[str] = None,
    items: Optional[List[Dict[str, Any]]] = None,
    total_calories: float = 0,
    total_protein: float = 0,
    total_carbs: float = 0,
    total_fat: float = 0,
    total_weight_grams: int = 0,
    context_state: Optional[str] = None,
    pfc_ratio_comment: Optional[str] = None,
    absorption_notes: Optional[str] = None,
    context_advice: Optional[str] = None,
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
        context_state: 用户当前状态（提交时选择）
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
    if context_state is not None:
        row["context_state"] = context_state
    if pfc_ratio_comment is not None:
        row["pfc_ratio_comment"] = pfc_ratio_comment
    if absorption_notes is not None:
        row["absorption_notes"] = absorption_notes
    if context_advice is not None:
        row["context_advice"] = context_advice
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
        记录列表，按 record_time 升序（同一天内按时间正序）
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
        q = q.order("record_time", desc=False).limit(limit)
        result = q.execute()
        return list(result.data or [])
    except Exception as e:
        print(f"[list_food_records] 错误: {e}")
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
    路径：food-analyze/{uuid}.jpg
    需先在 Supabase Dashboard → Storage 创建 bucket「food-analyze」并设为 Public。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    raw = base64_image.split(",")[1] if "," in base64_image else base64_image
    try:
        file_bytes = base64.b64decode(raw)
    except Exception as e:
        raise ValueError(f"base64 解码失败: {e}")
    path = f"{uuid.uuid4().hex}.jpg"
    supabase.storage.from_(FOOD_ANALYZE_BUCKET).upload(
        path,
        file_bytes,
        {"content-type": "image/jpeg", "upsert": "true"},
    )
    result = supabase.storage.from_(FOOD_ANALYZE_BUCKET).get_public_url(path)
    if isinstance(result, dict):
        return result.get("publicUrl") or result.get("public_url") or ""
    if hasattr(result, "public_url"):
        return getattr(result, "public_url", "")
    if hasattr(result, "publicUrl"):
        return getattr(result, "publicUrl", "")
    return str(result)

