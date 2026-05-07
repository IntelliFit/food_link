from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import (
    add_public_food_library_collection,
    add_public_food_library_comment_sync,
    add_public_food_library_feedback_sync,
    add_public_food_library_like,
    create_analysis_task_sync,
    create_public_food_library_item,
    get_analysis_task_by_id_sync,
    get_food_record_by_id,
    get_public_food_library_collections_for_items,
    get_public_food_library_item,
    get_public_food_library_likes_for_items,
    get_supabase_client,
    get_user_by_id,
    list_collected_public_food_library,
    list_my_public_food_library,
    list_public_food_library,
    list_public_food_library_comments,
    remove_public_food_library_collection,
    remove_public_food_library_like,
    update_public_food_library_status_sync,
)
from middleware import get_current_user_info

router = APIRouter()


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


@router.post("/api/public-food-library")
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
            await asyncio.to_thread(update_public_food_library_status_sync, item.get("id"), "published")

        return {"id": item.get("id"), "message": "分享成功"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/public-food-library] 创建错误: {e}")
        raise HTTPException(status_code=500, detail="分享失败")


@router.get("/api/public-food-library")
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
        supabase = get_supabase_client()
        authors_result = supabase.table("weapp_user").select("id, nickname, avatar").in_("id", author_ids).execute() if author_ids else None
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


@router.get("/api/public-food-library/mine")
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


@router.get("/api/public-food-library/collections")
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
        supabase = get_supabase_client()
        authors_result = supabase.table("weapp_user").select("id, nickname, avatar").in_("id", author_ids).execute() if author_ids else None
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


@router.get("/api/public-food-library/{item_id}")
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


@router.post("/api/public-food-library/{item_id}/like")
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


@router.delete("/api/public-food-library/{item_id}/like")
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


@router.post("/api/public-food-library/{item_id}/collect")
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


@router.delete("/api/public-food-library/{item_id}/collect")
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


@router.get("/api/public-food-library/{item_id}/comments")
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


@router.post("/api/public-food-library/{item_id}/comments")
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


@router.post("/api/public-food-library/feedback")
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


