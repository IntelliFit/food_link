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
    """建立双向好友关系（插入两条记录）"""
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        supabase.table("user_friends").insert([
            {"user_id": user_id, "friend_id": friend_id},
            {"user_id": friend_id, "friend_id": user_id},
        ]).execute()
    except Exception as e:
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
    搜索用户：按昵称模糊或手机号精确。排除自己、已是好友、已发过待处理请求的。
    返回 id, nickname, avatar（不返回 telephone）。
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
            if uid in friend_ids or uid in pending:
                continue
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
    """获取好友列表，含 nickname、avatar、id"""
    friend_ids = await get_friend_ids(user_id)
    if not friend_ids:
        return []
    check_supabase_configured()
    supabase = get_supabase_client()
    result = supabase.table("weapp_user").select("id, nickname, avatar").in_("id", friend_ids).execute()
    return list(result.data or [])


# ---------- 圈子动态（好友今日饮食 + 点赞评论）----------

async def list_friends_today_records(user_id: str, date: Optional[str] = None) -> List[Dict[str, Any]]:
    """获取好友 + 自己在指定日期（默认今天）的饮食记录，用于圈子 Feed"""
    friend_ids = await get_friend_ids(user_id)
    # 包含自己：圈子 Feed 同时展示自己的今日食物
    author_ids = list(set(friend_ids) | {user_id})
    if not author_ids:
        author_ids = [user_id]
    day = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    start_ts = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    end_d = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)
    end_ts = end_d.isoformat().replace("+00:00", "Z")
    check_supabase_configured()
    supabase = get_supabase_client()
    try:
        records = supabase.table("user_food_records").select("*").in_("user_id", author_ids).gte("record_time", start_ts).lt("record_time", end_ts).order("record_time", desc=True).execute()
        rec_list = list(records.data or [])
        if not rec_list:
            return []
        authors = supabase.table("weapp_user").select("id, nickname, avatar").in_("id", author_ids).execute()
        author_map = {a["id"]: a for a in (authors.data or [])}
        out = []
        for r in rec_list:
            author = author_map.get(r["user_id"], {})
            out.append({
                "record": r,
                "author": {
                    "id": author.get("id"),
                    "nickname": author.get("nickname") or "用户",
                    "avatar": author.get("avatar") or "",
                },
            })
        return out
    except Exception as e:
        print(f"[list_friends_today_records] 错误: {e}")
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
    source_record_id: Optional[str] = None,
    total_calories: float = 0,
    total_protein: float = 0,
    total_carbs: float = 0,
    total_fat: float = 0,
    items: Optional[List[Dict[str, Any]]] = None,
    description: Optional[str] = None,
    insight: Optional[str] = None,
    merchant_name: Optional[str] = None,
    merchant_address: Optional[str] = None,
    taste_rating: Optional[int] = None,
    suitable_for_fat_loss: bool = False,
    user_tags: Optional[List[str]] = None,
    user_notes: Optional[str] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    city: Optional[str] = None,
    district: Optional[str] = None,
) -> Dict[str, Any]:
    """
    创建公共食物库条目（上传/分享）。
    """
    check_supabase_configured()
    supabase = get_supabase_client()
    row = {
        "user_id": user_id,
        "image_path": image_path,
        "source_record_id": source_record_id,
        "total_calories": total_calories,
        "total_protein": total_protein,
        "total_carbs": total_carbs,
        "total_fat": total_fat,
        "items": items or [],
        "description": description or "",
        "insight": insight or "",
        "merchant_name": merchant_name or "",
        "merchant_address": merchant_address or "",
        "taste_rating": taste_rating,
        "suitable_for_fat_loss": suitable_for_fat_loss,
        "user_tags": user_tags or [],
        "user_notes": user_notes or "",
        "latitude": latitude,
        "longitude": longitude,
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

