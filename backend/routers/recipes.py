from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import (
    count_user_recipes_sync,
    create_user_recipe,
    delete_user_recipe,
    get_user_recipe,
    insert_food_record,
    list_user_recipes,
    update_user_recipe,
    use_recipe_record,
)
from middleware import get_current_user_info


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


class UseRecipeRequest(BaseModel):
    meal_type: Optional[str] = None


def create_recipes_router(normalize_meal_type: Callable[[Optional[str]], str]) -> APIRouter:
    router = APIRouter()

    @router.post("/api/recipes")
    async def create_recipe(
        body: CreateRecipeRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        """创建私人食谱"""
        user_id = user_info["user_id"]
        try:
            recipe = await create_user_recipe(user_id, body.dict())
            return {"id": recipe["id"], "message": "食谱创建成功"}
        except Exception as e:
            print(f"[create_recipe] 错误: {e}")
            raise HTTPException(status_code=500, detail=f"创建失败: {str(e)}")

    @router.get("/api/recipes")
    async def list_recipes(
        meal_type: Optional[str] = None,
        is_favorite: Optional[bool] = None,
        user_info: dict = Depends(get_current_user_info),
    ):
        """获取私人食谱列表"""
        user_id = user_info["user_id"]
        try:
            recipes = await list_user_recipes(user_id, meal_type, is_favorite)
            return {"recipes": recipes}
        except Exception as e:
            print(f"[list_recipes] 错误: {e}")
            raise HTTPException(status_code=500, detail=f"获取列表失败: {str(e)}")

    @router.get("/api/recipes/count")
    async def get_recipes_count(
        is_favorite: Optional[bool] = None,
        user_info: dict = Depends(get_current_user_info),
    ):
        """获取私人食谱数量"""
        user_id = user_info["user_id"]
        try:
            count = await count_user_recipes_sync(user_id, is_favorite)
            return {"count": count}
        except Exception as e:
            print(f"[recipes/count] 错误: {e}")
            raise HTTPException(status_code=500, detail=f"获取数量失败: {str(e)}")

    @router.get("/api/recipes/{recipe_id}")
    async def get_recipe(
        recipe_id: str,
        user_info: dict = Depends(get_current_user_info),
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

    @router.put("/api/recipes/{recipe_id}")
    async def update_recipe(
        recipe_id: str,
        body: UpdateRecipeRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        """更新食谱"""
        user_id = user_info["user_id"]
        try:
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

    @router.delete("/api/recipes/{recipe_id}")
    async def delete_recipe(
        recipe_id: str,
        user_info: dict = Depends(get_current_user_info),
    ):
        """删除食谱"""
        user_id = user_info["user_id"]
        try:
            await delete_user_recipe(recipe_id, user_id)
            return {"message": "删除成功"}
        except Exception as e:
            print(f"[delete_recipe] 错误: {e}")
            raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")

    @router.post("/api/recipes/{recipe_id}/use")
    async def use_recipe(
        recipe_id: str,
        body: Optional[UseRecipeRequest] = None,
        user_info: dict = Depends(get_current_user_info),
    ):
        """使用食谱创建记录（一键记录）"""
        user_id = user_info["user_id"]
        try:
            recipe = await get_user_recipe(recipe_id, user_id)
            if not recipe:
                raise HTTPException(status_code=404, detail="食谱不存在")

            raw_meal_type = (body and body.meal_type) or recipe.get("meal_type") or "afternoon_snack"
            meal_type = normalize_meal_type(raw_meal_type)

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

            await use_recipe_record(recipe_id, user_id)

            return {
                "message": "记录成功",
                "record_id": record["id"],
            }
        except HTTPException:
            raise
        except Exception as e:
            print(f"[use_recipe] 错误: {e}")
            raise HTTPException(status_code=500, detail=f"使用失败: {str(e)}")

    return router
