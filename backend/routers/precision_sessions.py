import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field


def create_precision_sessions_router(ctx):
    router = APIRouter()

    MEAL_TYPE_DESCRIPTION = ctx["MEAL_TYPE_DESCRIPTION"]
    PrecisionReferenceObjectInput = ctx["PrecisionReferenceObjectInput"]
    PRECISION_SOURCE_TYPES = ctx["PRECISION_SOURCE_TYPES"]
    PRECISION_SESSION_ACTIVE_STATUSES = ctx["PRECISION_SESSION_ACTIVE_STATUSES"]
    CREDIT_COST_PER_PRECISION_FOOD_ANALYSIS = ctx["CREDIT_COST_PER_PRECISION_FOOD_ANALYSIS"]
    get_current_user_info = ctx["get_current_user_info"]
    get_precision_session_by_id_sync = ctx["get_precision_session_by_id_sync"]
    get_user_by_id = ctx["get_user_by_id"]
    create_analysis_task_sync = ctx["create_analysis_task_sync"]
    update_precision_session_sync = ctx["update_precision_session_sync"]
    create_precision_session_round_sync = ctx["create_precision_session_round_sync"]
    _raise_precision_schema_not_ready = ctx["_raise_precision_schema_not_ready"]
    _get_effective_membership = ctx["_get_effective_membership"]
    _format_membership_response = ctx["_format_membership_response"]
    _resolve_recorded_on_date = ctx["_resolve_recorded_on_date"]
    _validate_food_analysis_access = ctx["_validate_food_analysis_access"]
    _serialize_reference_objects = ctx["_serialize_reference_objects"]
    _build_precision_continue_payload = ctx["_build_precision_continue_payload"]
    _get_food_task_type = ctx["_get_food_task_type"]
    _create_precision_plan_task_payload = ctx["_create_precision_plan_task_payload"]
    _consume_earned_credits_after_success = ctx["_consume_earned_credits_after_success"]
    _raise_analysis_related_schema_not_ready = ctx["_raise_analysis_related_schema_not_ready"]

    class ContinuePrecisionSessionRequest(BaseModel):
        source_type: str = Field(..., description="image / text")
        image_url: Optional[str] = Field(None, description="新的主图 URL")
        image_urls: Optional[List[str]] = Field(None, description="新的图片 URL 列表")
        text: Optional[str] = Field(None, description="补充文字或新的文字记录")
        date: Optional[str] = Field(default=None, description="记录日期 YYYY-MM-DD，仅支持近 3 天内补录")
        additionalContext: Optional[str] = Field(default=None, description="本轮补充说明")
        meal_type: Optional[str] = Field(default=None, description=MEAL_TYPE_DESCRIPTION)
        timezone_offset_minutes: Optional[int] = Field(default=None, description="客户端时区偏移（JS getTimezoneOffset，单位分钟）")
        province: Optional[str] = Field(default=None, description="省份/直辖市")
        city: Optional[str] = Field(default=None, description="城市")
        district: Optional[str] = Field(default=None, description="区县")
        diet_goal: Optional[str] = Field(default=None, description="饮食目标")
        activity_timing: Optional[str] = Field(default=None, description="运动时机")
        user_goal: Optional[str] = Field(default=None, description="用户目标")
        remaining_calories: Optional[float] = Field(default=None, description="当日剩余热量预算")
        is_multi_view: Optional[bool] = Field(default=False, description="是否多视角")
        reference_objects: Optional[List[PrecisionReferenceObjectInput]] = Field(default=None, description="参考物列表")


    @router.post("/api/precision-sessions/{session_id}/continue")
    async def continue_precision_session(
        session_id: str,
        body: ContinuePrecisionSessionRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        source_type = str(body.source_type or "").strip().lower()
        if source_type not in PRECISION_SOURCE_TYPES:
            raise HTTPException(status_code=400, detail="source_type 必须为 image 或 text")

        try:
            session = await asyncio.to_thread(get_precision_session_by_id_sync, session_id)
        except Exception as e:
            _raise_precision_schema_not_ready(e)
        if not session:
            raise HTTPException(status_code=404, detail="精准模式会话不存在")
        if session.get("user_id") != user_info["user_id"]:
            raise HTTPException(status_code=403, detail="无权继续该精准模式会话")
        if session.get("source_type") != source_type:
            raise HTTPException(status_code=400, detail="精准模式会话类型与当前提交不一致")
        if session.get("status") not in PRECISION_SESSION_ACTIVE_STATUSES:
            raise HTTPException(status_code=400, detail="该精准模式会话已结束，无法继续")

        user = await get_user_by_id(user_info["user_id"])
        membership = await _get_effective_membership(user_info["user_id"])
        membership_resp = _format_membership_response(membership)
        recorded_on = _resolve_recorded_on_date(body.date, "date")
        _, _, _, _, credits_info = await _validate_food_analysis_access(
            user_id=user_info["user_id"],
            effective_mode="strict",
            strict_requested=True,
            recorded_on=recorded_on,
            user_row=user,
            membership=membership,
            membership_resp=membership_resp,
        )

        reference_objects = _serialize_reference_objects(body.reference_objects)
        latest_inputs = {
            **_build_precision_continue_payload(
                source_type=source_type,
                meal_type=body.meal_type,
                timezone_offset_minutes=body.timezone_offset_minutes,
                province=body.province,
                city=body.city,
                district=body.district,
                diet_goal=body.diet_goal,
                activity_timing=body.activity_timing,
                user_goal=body.user_goal,
                remaining_calories=body.remaining_calories,
                additional_context=body.additionalContext,
                is_multi_view=body.is_multi_view,
                reference_objects=reference_objects,
            ),
            "recorded_on": recorded_on,
        }
        task_kwargs: Dict[str, Any] = {
            "user_id": user_info["user_id"],
            "task_type": _get_food_task_type("precision_plan"),
            "payload": _create_precision_plan_task_payload(
                session_id,
                source_type,
                {
                    "meal_type": body.meal_type,
                    "timezone_offset_minutes": body.timezone_offset_minutes,
                    "diet_goal": body.diet_goal,
                    "activity_timing": body.activity_timing,
                    "user_goal": body.user_goal,
                    "remaining_calories": body.remaining_calories,
                    "additionalContext": body.additionalContext,
                    "execution_mode": "strict",
                    "recorded_on": recorded_on,
                    "credit_usage": dict((credits_info.get("credit_spend_plan") or {})),
                    "is_multi_view": body.is_multi_view,
                    "reference_objects": reference_objects,
                    "round_index": int(session.get("round_index") or 1) + 1,
                },
            ),
        }
        if source_type == "image":
            if body.image_url:
                task_kwargs["image_url"] = body.image_url.strip()
                latest_inputs["image_url"] = body.image_url.strip()
            if body.image_urls:
                task_kwargs["image_urls"] = body.image_urls
                latest_inputs["image_urls"] = body.image_urls
            if not latest_inputs.get("image_url") and not latest_inputs.get("image_urls") and not body.additionalContext and not reference_objects:
                raise HTTPException(status_code=400, detail="请至少补充说明、参考物或新的图片")
        else:
            text_value = str(body.text or "").strip()
            if text_value:
                latest_inputs["text"] = text_value
                task_kwargs["text_input"] = text_value
            elif not body.additionalContext and not reference_objects:
                raise HTTPException(status_code=400, detail="请至少补充说明、参考物或新的文字描述")

        next_round_index = int(session.get("round_index") or 1) + 1
        try:
            await asyncio.to_thread(
                update_precision_session_sync,
                session_id,
                {
                    "status": "collecting",
                    "round_index": next_round_index,
                    "latest_inputs": latest_inputs,
                    "reference_objects": reference_objects or (session.get("reference_objects") or []),
                    "last_error": None,
                },
            )
            await asyncio.to_thread(
                create_precision_session_round_sync,
                session_id,
                next_round_index,
                "user",
                latest_inputs,
                None,
            )
        except Exception as e:
            _raise_precision_schema_not_ready(e)
        try:
            task = await asyncio.to_thread(create_analysis_task_sync, **task_kwargs)
            await asyncio.to_thread(
                update_precision_session_sync,
                session_id,
                {
                    "status": "collecting",
                    "current_task_id": task["id"],
                },
            )
            await _consume_earned_credits_after_success(
                user_info["user_id"],
                credits_info,
                cost=CREDIT_COST_PER_PRECISION_FOOD_ANALYSIS,
                reason="food_analysis_reward_spend",
                source_key=f"food_analysis:{task['id']}",
                meta={"task_id": task["id"], "task_type": task.get("task_type")},
            )
            return {"task_id": task["id"], "message": "精准模式已继续，系统正在重新规划本轮估计"}
        except Exception as e:
            _raise_analysis_related_schema_not_ready(e)
            print(f"[precision/continue] 错误: {e}")
            raise HTTPException(status_code=500, detail="继续精准模式失败")


    return router
