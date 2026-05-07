import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field


def create_analyze_submit_router(ctx):
    router = APIRouter()

    MEAL_TYPE_DESCRIPTION = ctx["MEAL_TYPE_DESCRIPTION"]
    PrecisionReferenceObjectInput = ctx["PrecisionReferenceObjectInput"]
    DEFAULT_ANALYSIS_ENGINE = ctx["DEFAULT_ANALYSIS_ENGINE"]
    PRECISION_SESSION_ACTIVE_STATUSES = ctx["PRECISION_SESSION_ACTIVE_STATUSES"]
    get_current_user_info = ctx["get_current_user_info"]
    get_user_by_id = ctx["get_user_by_id"]
    get_precision_session_by_id_sync = ctx["get_precision_session_by_id_sync"]
    create_precision_session_sync = ctx["create_precision_session_sync"]
    update_precision_session_sync = ctx["update_precision_session_sync"]
    create_precision_session_round_sync = ctx["create_precision_session_round_sync"]
    create_analysis_task_sync = ctx["create_analysis_task_sync"]
    _biz_tracer = ctx["_biz_tracer"]
    _trace_add_event = ctx["_trace_add_event"]
    _trace_record_error = ctx["_trace_record_error"]
    _parse_execution_mode_or_raise = ctx["_parse_execution_mode_or_raise"]
    _parse_analysis_engine_or_raise = ctx["_parse_analysis_engine_or_raise"]
    _normalize_execution_mode = ctx["_normalize_execution_mode"]
    _get_effective_membership = ctx["_get_effective_membership"]
    _format_membership_response = ctx["_format_membership_response"]
    _resolve_recorded_on_date = ctx["_resolve_recorded_on_date"]
    _validate_food_analysis_access = ctx["_validate_food_analysis_access"]
    _serialize_reference_objects = ctx["_serialize_reference_objects"]
    _build_precision_continue_payload = ctx["_build_precision_continue_payload"]
    _raise_precision_schema_not_ready = ctx["_raise_precision_schema_not_ready"]
    _create_precision_plan_task_payload = ctx["_create_precision_plan_task_payload"]
    _get_food_task_type = ctx["_get_food_task_type"]
    _raise_analysis_related_schema_not_ready = ctx["_raise_analysis_related_schema_not_ready"]
    _consume_earned_credits_after_success = ctx["_consume_earned_credits_after_success"]
    _get_food_analysis_credit_cost = ctx["_get_food_analysis_credit_cost"]
    _debug_log_food_submit = ctx["_debug_log_food_submit"]

    # ---------- 异步分析任务（提交后由 Worker 子进程处理） ----------

    class AnalyzeSubmitRequest(BaseModel):
        """提交食物分析任务：立即返回 task_id，结果由 Worker 写回后可从 /api/analyze/tasks 查询"""
        image_url: Optional[str] = Field(None, description="Supabase 公网图片 URL（需先调 upload-analyze-image）")
        image_urls: Optional[List[str]] = Field(None, description="多图 URL 列表（新版支持）")
        meal_type: Optional[str] = Field(default=None, description=MEAL_TYPE_DESCRIPTION)
        timezone_offset_minutes: Optional[int] = Field(default=None, description="客户端时区偏移（JS getTimezoneOffset，单位分钟）")
        province: Optional[str] = Field(default=None, description="省份/直辖市")
        city: Optional[str] = Field(default=None, description="城市")
        district: Optional[str] = Field(default=None, description="区县")
        diet_goal: Optional[str] = Field(default=None, description="饮食目标: fat_loss / muscle_gain / maintain / none")
        activity_timing: Optional[str] = Field(default=None, description="运动时机: post_workout / daily / before_sleep / none")
        user_goal: Optional[str] = Field(default=None, description="用户目标: muscle_gain / fat_loss / maintain")
        remaining_calories: Optional[float] = Field(default=None, description="当日剩余热量预算 kcal")
        additionalContext: Optional[str] = Field(default=None, description="用户补充上下文")
        modelName: Optional[str] = Field(default="gemini-3-flash-preview", description="模型名称")
        is_multi_view: Optional[bool] = Field(default=False, description="是否开启多视角辅助模式")
        execution_mode: Optional[str] = Field(default=None, description="执行模式: standard / strict")
        date: Optional[str] = Field(default=None, description="记录日期 YYYY-MM-DD，仅支持近 3 天内补录")
        analysis_engine: Optional[str] = Field(default=None, description="分析引擎: legacy_direct / db_first")
        previousResult: Optional[Dict[str, Any]] = Field(default=None, description="上一轮分析结果")
        correctionItems: Optional[List[Dict[str, Any]]] = Field(default=None, description="本轮结构化纠错清单")
        precision_session_id: Optional[str] = Field(default=None, description="精准模式会话 ID（继续多轮交互时传入）")
        reference_objects: Optional[List[PrecisionReferenceObjectInput]] = Field(default=None, description="参考物列表")
        subscribe_status: Optional[str] = Field(default=None, description="用户对分析完成订阅消息的授权状态")


    @router.post("/api/analyze/submit")
    async def analyze_submit(
        body: AnalyzeSubmitRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        """
        提交食物分析任务（异步）。立即返回 task_id，Worker 子进程会在后台执行分析，
        完成后可通过 GET /api/analyze/tasks/{task_id} 或列表接口查看结果。
        """
        with _biz_tracer.start_as_current_span("biz.analyze_submit"):
            _trace_add_event(
                "biz.submit.received",
                {
                    "biz.user_id": user_info["user_id"],
                    "biz.has_image_url": bool(body.image_url and body.image_url.strip()),
                    "biz.image_urls.count": len(body.image_urls or []),
                    "biz.multi_view": bool(body.is_multi_view),
                    "biz.execution_mode.requested": body.execution_mode or "",
                    "biz.analysis_engine.requested": body.analysis_engine or "",
                    "biz.has_precision_session": bool(body.precision_session_id),
                },
            )
            if (not body.image_url or not body.image_url.strip()) and (not body.image_urls or len(body.image_urls) == 0):
                _trace_add_event("biz.submit.invalid_input", {"biz.reason": "missing_image_url"})
                raise HTTPException(status_code=400, detail="image_url 或 image_urls 不能为空")

        requested_mode = _parse_execution_mode_or_raise(body.execution_mode) if body.execution_mode is not None else None
        requested_analysis_engine = _parse_analysis_engine_or_raise(body.analysis_engine) if body.analysis_engine is not None else None
        user = await get_user_by_id(user_info["user_id"])
        profile_mode = _normalize_execution_mode((user or {}).get("execution_mode"))
        effective_mode = requested_mode or profile_mode
        membership = await _get_effective_membership(user_info["user_id"])
        membership_resp = _format_membership_response(membership)
        recorded_on = _resolve_recorded_on_date(body.date, "date")
        _, _, _, effective_mode, credits_info = await _validate_food_analysis_access(
            user_id=user_info["user_id"],
            effective_mode=effective_mode,
            strict_requested=(requested_mode == "strict" or bool(body.precision_session_id)),
            recorded_on=recorded_on,
            user_row=user,
            membership=membership,
            membership_resp=membership_resp,
        )

        payload = {
            "meal_type": body.meal_type,
            "timezone_offset_minutes": body.timezone_offset_minutes,
            "province": body.province,
            "city": body.city,
            "district": body.district,
            "diet_goal": body.diet_goal,
            "activity_timing": body.activity_timing,
            "user_goal": body.user_goal,
            "remaining_calories": body.remaining_calories,
            "additionalContext": body.additionalContext,
            "modelName": body.modelName,
            "is_multi_view": body.is_multi_view,
            "execution_mode": effective_mode,
            "recorded_on": recorded_on,
            "credit_usage": dict((credits_info.get("credit_spend_plan") or {})),
            "analysis_engine": "db_first" if effective_mode == "standard" else (requested_analysis_engine or DEFAULT_ANALYSIS_ENGINE),
            "previousResult": body.previousResult,
            "correctionItems": body.correctionItems,
            "reference_objects": _serialize_reference_objects(body.reference_objects),
            "subscribe_status": body.subscribe_status,
        }

        if effective_mode == "strict" or body.precision_session_id:
            _trace_add_event("biz.submit.strict_mode.enter", {"biz.execution_mode.effective": effective_mode})
            session = None
            source_type = "image"
            if body.precision_session_id:
                try:
                    session = await asyncio.to_thread(get_precision_session_by_id_sync, body.precision_session_id)
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
                    reference_objects=payload["reference_objects"],
                ),
                "image_url": body.image_url.strip() if body.image_url else None,
                "image_urls": body.image_urls or [],
            }

            try:
                if session:
                    next_round_index = int(session.get("round_index") or 1) + 1
                    await asyncio.to_thread(
                        update_precision_session_sync,
                        session["id"],
                        {
                            "status": "collecting",
                            "round_index": next_round_index,
                            "latest_inputs": latest_inputs,
                            "reference_objects": payload["reference_objects"] or (session.get("reference_objects") or []),
                            "last_error": None,
                        },
                    )
                    await asyncio.to_thread(
                        create_precision_session_round_sync,
                        session["id"],
                        next_round_index,
                        "user",
                        latest_inputs,
                        None,
                    )
                    current_session_id = session["id"]
                    current_round_index = next_round_index
                else:
                    session = await asyncio.to_thread(
                        create_precision_session_sync,
                        user_info["user_id"],
                        source_type,
                        "strict",
                        latest_inputs,
                        payload["reference_objects"],
                    )
                    await asyncio.to_thread(
                        create_precision_session_round_sync,
                        session["id"],
                        int(session.get("round_index") or 1),
                        "user",
                        latest_inputs,
                        None,
                    )
                    current_session_id = session["id"]
                    current_round_index = int(session.get("round_index") or 1)
            except Exception as e:
                _raise_precision_schema_not_ready(e)

            precision_payload = _create_precision_plan_task_payload(
                current_session_id,
                source_type,
                {
                    **payload,
                    "round_index": current_round_index,
                },
            )
            try:
                precision_task = await asyncio.to_thread(
                    create_analysis_task_sync,
                    user_id=user_info["user_id"],
                    task_type=_get_food_task_type("precision_plan"),
                    image_url=body.image_url.strip() if body.image_url else None,
                    image_urls=body.image_urls,
                    payload=precision_payload,
                )
            except Exception as e:
                _raise_analysis_related_schema_not_ready(e)
            await asyncio.to_thread(
                update_precision_session_sync,
                current_session_id,
                {
                    "status": "collecting",
                    "current_task_id": precision_task["id"],
                },
            )
            await _consume_earned_credits_after_success(
                user_info["user_id"],
                credits_info,
                cost=_get_food_analysis_credit_cost(effective_mode),
                reason="food_analysis_reward_spend",
                source_key=f"food_analysis:{precision_task['id']}",
                meta={"task_id": precision_task["id"], "task_type": precision_task.get("task_type")},
            )
            _trace_add_event(
                "biz.submit.strict_mode.task_created",
                {"biz.task_id": precision_task["id"], "biz.session_id": current_session_id},
            )
            return {
                "task_id": precision_task["id"],
                "message": "精准模式任务已提交，系统将先判断是否需要补充信息或拆分估计",
            }

        _debug_log_food_submit(
            "image_submit_request",
            {
                "user_id": user_info["user_id"],
                "task_type": _get_food_task_type("food"),
                "image_url": body.image_url,
                "image_urls": body.image_urls,
                "payload": payload,
            },
        )
        try:
            task = await asyncio.to_thread(
                create_analysis_task_sync,
                user_id=user_info["user_id"],
                task_type=_get_food_task_type("food"),
                image_url=body.image_url.strip() if body.image_url else None,
                image_urls=body.image_urls,
                payload=payload,
            )
            _debug_log_food_submit(
                "image_submit_created",
                {
                    "task_id": task["id"],
                    "task_type": task.get("task_type"),
                    "image_url": task.get("image_url"),
                    "image_paths": task.get("image_paths"),
                    "payload": task.get("payload"),
                },
            )
            await _consume_earned_credits_after_success(
                user_info["user_id"],
                credits_info,
                cost=_get_food_analysis_credit_cost(effective_mode),
                reason="food_analysis_reward_spend",
                source_key=f"food_analysis:{task['id']}",
                meta={"task_id": task["id"], "task_type": task.get("task_type")},
            )
            _trace_add_event("biz.submit.task_created", {"biz.task_id": task["id"], "biz.task_type": task.get("task_type")})
            print(
                f"[food_analysis] MODERATION_SKIPPED_CONFIRMED task_id={task['id']} submit_type=image",
                flush=True,
            )
            return {"task_id": task["id"], "message": "任务已提交，可稍后在识别历史中查看结果"}
        except Exception as e:
            _raise_analysis_related_schema_not_ready(e)
            _trace_record_error("analyze_submit", e, **{"biz.user_id": user_info["user_id"]})
            print(f"[analyze/submit] 错误: {e}")
            raise HTTPException(status_code=500, detail="提交任务失败")






    return router
