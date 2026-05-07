import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from database import (
    browse_manual_food_library,
    get_food_unresolved_top_sync,
    log_unresolved_food,
    search_food_nutrition_candidates_sync,
    search_manual_food,
)
from middleware import get_current_user_info, get_optional_user_info

router = APIRouter()


@router.get("/api/food-nutrition/unresolved/top")
async def get_food_unresolved_top(
    limit: int = 50,
    user_info: dict = Depends(get_current_user_info),
):
    """查询未收录食物高频列表（用于补库运营）。"""
    try:
        rows = await asyncio.to_thread(get_food_unresolved_top_sync, limit)
        return {"items": rows}
    except Exception as e:
        print(f"[food-nutrition/unresolved/top] 错误: {e}")
        raise HTTPException(status_code=500, detail="查询未收录食物失败")


@router.get("/api/food-nutrition/search")
async def search_food_nutrition(
    query: str,
    limit: int = 5,
    user_info: dict = Depends(get_current_user_info),
):
    """按食物名称搜索标准食物库候选。"""
    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="query 不能为空")
    try:
        items = await asyncio.to_thread(search_food_nutrition_candidates_sync, query, limit)
        return {"items": items}
    except Exception as e:
        print(f"[food-nutrition/search] 错误: {e}")
        raise HTTPException(status_code=500, detail="查询食物候选失败")


@router.get("/api/manual-food/search")
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


@router.get("/api/manual-food/browse")
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
