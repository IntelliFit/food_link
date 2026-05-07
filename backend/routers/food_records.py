from __future__ import annotations

import asyncio
from typing import Any, Callable, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import (
    delete_food_record,
    get_analysis_task_by_id_sync,
    get_analysis_tasks_by_ids,
    get_food_record_by_id,
    get_user_by_id,
    insert_critical_samples,
    insert_food_record,
    list_food_records,
    update_food_record,
)
from middleware import get_current_user_info

MEAL_TYPE_DESCRIPTION = (
    "餐次: breakfast / morning_snack / lunch / afternoon_snack / dinner / evening_snack"
    "（兼容 legacy: snack）"
)


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
    weight: float = 0
    ratio: float = 100
    intake: float = 0
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
    date: Optional[str] = Field(default=None, description="记录日期 YYYY-MM-DD，仅支持近 3 天内补录")


class UpdateFoodRecordRequest(BaseModel):
    meal_type: Optional[str] = Field(default=None, description="餐次")
    items: Optional[List[FoodRecordItem]] = Field(default=None, description="食物项列表")
    total_calories: Optional[float] = Field(default=None, description="总热量 kcal")
    total_protein: Optional[float] = Field(default=None, description="总蛋白质 g")
    total_carbs: Optional[float] = Field(default=None, description="总碳水 g")
    total_fat: Optional[float] = Field(default=None, description="总脂肪 g")
    total_weight_grams: Optional[int] = Field(default=None, description="总重量 g")


def _food_record_items_payload(items: List[FoodRecordItem], include_manual_fields: bool = True) -> List[Dict[str, Any]]:
    payload = []
    for item in items:
        row = {
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
        if include_manual_fields and (
            item.manual_source or item.manual_source_id or item.manual_source_title or item.manual_portion_label
        ):
            row.update({
                "manual_source": item.manual_source,
                "manual_source_id": item.manual_source_id,
                "manual_source_title": item.manual_source_title,
                "manual_portion_label": item.manual_portion_label,
            })
        payload.append(row)
    return payload


def create_food_records_router(
    *,
    valid_meal_types: Set[str],
    normalize_meal_type: Callable[..., str],
    parse_date_string: Callable[[Optional[str], str], Optional[str]],
    resolve_recorded_on_date: Callable[[Optional[str], str], str],
    build_record_time_for_recorded_on: Callable[[str], str],
    refresh_stats_insight_for_user: Callable[[str], Any],
    biz_tracer: Any,
    trace_add_event: Callable[[str, Dict[str, Any]], None],
    trace_record_error: Callable[..., None],
) -> APIRouter:
    router = APIRouter()

    async def hydrate_food_record_image_paths(record: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
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

    @router.post("/api/critical-samples")
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

    @router.post("/api/food-record/save")
    async def save_food_record(
        body: SaveFoodRecordRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        """拍照识别完成后确认记录：支持早/午/晚三餐 + 早/午/晚加餐。"""
        user_id = user_info["user_id"]
        if body.meal_type not in valid_meal_types:
            raise HTTPException(status_code=400, detail=f"meal_type 必须为 {MEAL_TYPE_DESCRIPTION}")
        normalized_meal_type = normalize_meal_type(body.meal_type)
        recorded_on = parse_date_string(body.date, "date")
        if not recorded_on and body.source_task_id:
            source_task = await asyncio.to_thread(get_analysis_task_by_id_sync, body.source_task_id)
            source_payload = (source_task or {}).get("payload")
            if isinstance(source_payload, dict):
                recorded_on = parse_date_string(source_payload.get("recorded_on"), "date")
        recorded_on = resolve_recorded_on_date(recorded_on, "date")
        items_payload = _food_record_items_payload(body.items)

        with biz_tracer.start_as_current_span("biz.save_food_record"):
            trace_add_event(
                "biz.food_record.save.requested",
                {"biz.user_id": user_id, "biz.meal_type": normalized_meal_type, "biz.items.count": len(body.items or [])},
            )
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
                    record_time=build_record_time_for_recorded_on(recorded_on),
                )
                try:
                    asyncio.create_task(refresh_stats_insight_for_user(user_id))
                except Exception as bg_err:
                    trace_record_error("save_food_record.refresh_insight", bg_err, **{"biz.user_id": user_id})
                    print(f"[save_food_record] 启动后台刷新 AI 洞察失败: {bg_err}")

                trace_add_event("biz.food_record.save.success", {"biz.record_id": row.get("id")})
                return {"id": row.get("id"), "message": "记录成功"}
            except Exception as e:
                trace_record_error("save_food_record", e, **{"biz.user_id": user_id, "biz.meal_type": normalized_meal_type})
                print(f"[save_food_record] 错误: {e}")
                raise HTTPException(status_code=500, detail="保存记录失败")

    @router.get("/api/food-record/list")
    async def get_food_record_list(
        date: Optional[str] = None,
        user_info: dict = Depends(get_current_user_info),
    ):
        """
        获取当前用户饮食记录列表。可选按日期筛选（date=YYYY-MM-DD），不传则返回最近记录。
        若记录有 source_task_id 且无 image_paths，则从 analysis_tasks 补全 image_paths 供多图展示。
        """
        user_id = user_info["user_id"]
        with biz_tracer.start_as_current_span("biz.get_food_record_list"):
            trace_add_event("biz.food_record.list.requested", {"biz.user_id": user_id, "biz.date": date or ""})
            try:
                records = await list_food_records(user_id=user_id, date=date, limit=100)
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
                    r["meal_type"] = normalize_meal_type(r.get("meal_type"), record_time=r.get("record_time"))
                trace_add_event("biz.food_record.list.success", {"biz.records.count": len(records)})
                return {"records": records}
            except Exception as e:
                trace_record_error("get_food_record_list", e, **{"biz.user_id": user_id, "biz.date": date or ""})
                print(f"[get_food_record_list] 错误: {e}")
                raise HTTPException(status_code=500, detail="获取记录失败")

    @router.get("/api/food-record/{record_id}")
    async def get_food_record_detail(
        record_id: str,
        user_info: dict = Depends(get_current_user_info),
    ):
        """获取单条饮食记录详情。需验证记录属于当前用户。"""
        user_id = user_info["user_id"]
        with biz_tracer.start_as_current_span("biz.get_food_record_detail"):
            trace_add_event("biz.food_record.detail.requested", {"biz.user_id": user_id, "biz.record_id": record_id})
            try:
                record = await get_food_record_by_id(record_id)
                if not record:
                    trace_add_event("biz.food_record.detail.not_found", {"biz.record_id": record_id})
                    raise HTTPException(status_code=404, detail="记录不存在")
                if record.get("user_id") != user_id:
                    trace_add_event("biz.food_record.detail.forbidden", {"biz.record_id": record_id})
                    raise HTTPException(status_code=403, detail="无权访问此记录")
                record = await hydrate_food_record_image_paths(record)
                record["meal_type"] = normalize_meal_type(record.get("meal_type"), record_time=record.get("record_time"))
                trace_add_event("biz.food_record.detail.success", {"biz.record_id": record_id})
                return {"record": record}
            except HTTPException:
                raise
            except Exception as e:
                trace_record_error("get_food_record_detail", e, **{"biz.record_id": record_id, "biz.user_id": user_id})
                print(f"[get_food_record_detail] 错误: {e}")
                raise HTTPException(status_code=500, detail="获取记录详情失败")

    @router.put("/api/food-record/{record_id}")
    async def update_food_record_endpoint(
        record_id: str,
        body: UpdateFoodRecordRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        """更新当前用户自己的饮食记录（修改食物参数、餐次等）。"""
        user_id = user_info["user_id"]
        data: Dict[str, Any] = {}
        if body.meal_type is not None:
            if body.meal_type not in valid_meal_types:
                raise HTTPException(status_code=400, detail=f"meal_type 必须为 {MEAL_TYPE_DESCRIPTION}")
            data["meal_type"] = normalize_meal_type(body.meal_type)
        if body.items is not None:
            data["items"] = _food_record_items_payload(body.items, include_manual_fields=False)
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

    @router.delete("/api/food-record/{record_id}")
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

    @router.get("/api/food-record/share/{record_id}")
    async def get_shared_food_record(record_id: str):
        """
        公开分享接口，无需登录。用于别人通过分享链接查看饮食记录。
        若记录所有者关闭了「公开饮食记录」隐私设置，则返回 403。
        """
        try:
            record = await get_food_record_by_id(record_id)
            if not record:
                raise HTTPException(status_code=404, detail="记录不存在")
            owner_id = record.get("user_id")
            if owner_id:
                try:
                    owner = await get_user_by_id(owner_id)
                    if owner and owner.get("public_records") is False:
                        raise HTTPException(status_code=403, detail="该用户已关闭饮食记录公开，无法查看")
                except HTTPException:
                    raise
                except Exception:
                    pass
            record = await hydrate_food_record_image_paths(record)
            record["meal_type"] = normalize_meal_type(record.get("meal_type"), record_time=record.get("record_time"))
            return {"record": record}
        except HTTPException:
            raise
        except Exception as e:
            print(f"[get_shared_food_record] 错误: {e}")
            raise HTTPException(status_code=500, detail="获取记录详情失败")

    return router
