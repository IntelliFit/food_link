import asyncio
import json
import os
import re
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field


def create_analyze_text_router(ctx):
    router = APIRouter()

    AnalyzeResponse = ctx["AnalyzeResponse"]
    FoodItemResponse = ctx["FoodItemResponse"]
    PrecisionReferenceObjectInput = ctx["PrecisionReferenceObjectInput"]
    MEAL_TYPE_DESCRIPTION = ctx["MEAL_TYPE_DESCRIPTION"]
    DEFAULT_ANALYSIS_ENGINE = ctx["DEFAULT_ANALYSIS_ENGINE"]
    PRECISION_SESSION_ACTIVE_STATUSES = ctx["PRECISION_SESSION_ACTIVE_STATUSES"]
    get_optional_user_info = ctx["get_optional_user_info"]
    get_current_user_info = ctx["get_current_user_info"]
    get_user_by_id = ctx["get_user_by_id"]
    get_precision_session_by_id_sync = ctx["get_precision_session_by_id_sync"]
    create_precision_session_sync = ctx["create_precision_session_sync"]
    update_precision_session_sync = ctx["update_precision_session_sync"]
    create_precision_session_round_sync = ctx["create_precision_session_round_sync"]
    create_analysis_task_sync = ctx["create_analysis_task_sync"]
    _get_effective_membership = ctx["_get_effective_membership"]
    _format_membership_response = ctx["_format_membership_response"]
    _normalize_execution_mode = ctx["_normalize_execution_mode"]
    _validate_food_analysis_access = ctx["_validate_food_analysis_access"]
    _parse_analysis_engine_or_raise = ctx["_parse_analysis_engine_or_raise"]
    _parse_execution_mode_or_raise = ctx["_parse_execution_mode_or_raise"]
    _format_health_profile_for_analysis = ctx["_format_health_profile_for_analysis"]
    _strip_standard_mode_extras = ctx["_strip_standard_mode_extras"]
    _resolve_recorded_on_date = ctx["_resolve_recorded_on_date"]
    _serialize_reference_objects = ctx["_serialize_reference_objects"]
    _build_precision_continue_payload = ctx["_build_precision_continue_payload"]
    _raise_precision_schema_not_ready = ctx["_raise_precision_schema_not_ready"]
    _create_precision_plan_task_payload = ctx["_create_precision_plan_task_payload"]
    _get_food_task_type = ctx["_get_food_task_type"]
    _raise_analysis_related_schema_not_ready = ctx["_raise_analysis_related_schema_not_ready"]
    _consume_earned_credits_after_success = ctx["_consume_earned_credits_after_success"]
    _get_food_analysis_credit_cost = ctx["_get_food_analysis_credit_cost"]
    _debug_log_food_submit = ctx["_debug_log_food_submit"]

    class AnalyzeTextRequest(BaseModel):
        """文字描述食物，请求营养成分分析"""
        text: str = Field(..., description="用户描述的食物内容，如：一碗米饭、一个苹果、200g 鸡胸肉")
        user_goal: Optional[str] = Field(default=None, description="用户目标: muscle_gain / fat_loss / maintain")
        remaining_calories: Optional[float] = Field(default=None, description="当日剩余热量预算 kcal")
        diet_goal: Optional[str] = Field(default=None, description="饮食目标: fat_loss / muscle_gain / maintain / none")
        activity_timing: Optional[str] = Field(default=None, description="运动时机: post_workout / daily / before_sleep / none")
        analysis_engine: Optional[str] = Field(default=None, description="分析引擎: legacy_direct / db_first")


    @router.post("/api/analyze-text", response_model=AnalyzeResponse)
    async def analyze_food_text(
        request: AnalyzeTextRequest,
        user_info: Optional[dict] = Depends(get_optional_user_info),
    ):
        """
        根据用户文字描述分析食物营养成分，使用 DashScope 千问 qwen-plus。返回与 /api/analyze 相同结构。
        """
        try:
            dashscope_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
            if not dashscope_key:
                raise HTTPException(status_code=500, detail="缺少 DASHSCOPE_API_KEY 环境变量")
            if not (request.text or request.text.strip()):
                raise HTTPException(status_code=400, detail="text 不能为空")

            goal_hint = ""
            if request.user_goal:
                goal_map = {"muscle_gain": "增肌", "fat_loss": "减脂", "maintain": "维持体重"}
                goal_hint = f" 用户目标为「{goal_map.get(request.user_goal, request.user_goal)}」，请在 pfc_ratio_comment 中评价 P/C/F 占比是否适合。"
            state_hint = ""
            if request.diet_goal or request.activity_timing:
                diet_map = {"fat_loss": "减脂期", "muscle_gain": "增肌期", "maintain": "维持体重", "none": "无特殊目标"}
                activity_map = {"post_workout": "练后", "daily": "日常", "before_sleep": "睡前", "none": "无特殊"}
                diet_text = diet_map.get(request.diet_goal, request.diet_goal) if request.diet_goal and request.diet_goal != "none" else ""
                activity_text = activity_map.get(request.activity_timing, request.activity_timing) if request.activity_timing and request.activity_timing != "none" else ""
                state_parts = [s for s in [diet_text, activity_text] if s]
                if state_parts:
                    state_hint = f" 用户当前状态: {' + '.join(state_parts)}，请在 context_advice 中给出针对性建议。"
            remain_hint = f" 当日剩余热量预算约 {request.remaining_calories} kcal，可在 context_advice 中提示。" if request.remaining_calories is not None else ""
            profile_block = ""
            execution_mode = _normalize_execution_mode(None)
            requested_analysis_engine = _parse_analysis_engine_or_raise(request.analysis_engine) if request.analysis_engine is not None else None
            if user_info:
                user = await get_user_by_id(user_info["user_id"])
                membership = await _get_effective_membership(user_info["user_id"])
                membership_resp = _format_membership_response(membership)
                execution_mode = _normalize_execution_mode((user or {}).get("execution_mode"))
                _, _, _, execution_mode, _ = await _validate_food_analysis_access(
                    user_id=user_info["user_id"],
                    effective_mode=execution_mode,
                    strict_requested=False,
                    user_row=user,
                    membership=membership,
                    membership_resp=membership_resp,
                )
                if user:
                    profile_block = _format_health_profile_for_analysis(user)
                    if profile_block:
                        profile_fields = "insight、absorption_notes、context_advice" if execution_mode == "strict" else "insight、context_advice"
                        profile_block = f" 若以下存在「用户健康档案」，请结合档案在 {profile_fields} 中给出更贴合该用户体质与健康状况的建议。\n\n" + profile_block

            analysis_engine = (requested_analysis_engine or "db_first") if execution_mode == "standard" else (requested_analysis_engine or DEFAULT_ANALYSIS_ENGINE)
            try:
                from worker import (
                    _build_result_items_with_lookup as worker_build_result_items_with_lookup,
                    _build_text_food_prompt as worker_build_text_food_prompt,
                    _build_text_food_prompt_db_first as worker_build_text_food_prompt_db_first,
                    _normalize_analysis_response_payload as worker_normalize_analysis_response_payload,
                    _parse_analysis_result_items as worker_parse_analysis_result_items,
                    _summarize_db_first_items as worker_summarize_db_first_items,
                )
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"加载文字分析模块失败: {e}")

            task_payload = {
                "user_goal": request.user_goal,
                "remaining_calories": request.remaining_calories,
                "diet_goal": request.diet_goal,
                "activity_timing": request.activity_timing,
                "execution_mode": execution_mode,
                "analysis_engine": analysis_engine,
            }
            task = {
                "task_type": "food_text",
                "text_input": request.text.strip(),
                "payload": task_payload,
                "user_id": user_info["user_id"] if user_info else None,
            }
            prompt_builder = (
                worker_build_text_food_prompt_db_first
                if execution_mode == "standard" and analysis_engine == "db_first"
                else worker_build_text_food_prompt
            )
            prompt = prompt_builder(task, profile_block)

            # 使用 DashScope 千问 qwen-plus 进行文本分析
            base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
            api_url = f"{base_url}/chat/completions"
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    api_url,
                    headers={
                        "Authorization": f"Bearer {dashscope_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "qwen-plus",
                        "messages": [{"role": "user", "content": prompt}],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.5,
                    },
                )
                if not response.is_success:
                    error_data = response.json() if response.content else {}
                    raise Exception(error_data.get("error", {}).get("message") or f"DashScope API 错误: {response.status_code}")
                data = response.json()
                content_str = data.get("choices", [{}])[0].get("message", {}).get("content")
                if not content_str:
                    raise Exception("千问返回了空响应")
                json_str = re.sub(r"```json", "", content_str)
                json_str = re.sub(r"```", "", json_str).strip()
                parsed = worker_normalize_analysis_response_payload(json.loads(json_str))

            if execution_mode == "standard" and analysis_engine == "db_first":
                items_raw = worker_build_result_items_with_lookup(task, parsed.get("items") or [])
                resolved_summary = worker_summarize_db_first_items(items_raw)
            else:
                items_raw = worker_parse_analysis_result_items(parsed)
                resolved_summary = {}
            valid_items = [FoodItemResponse(**item) for item in items_raw]

            def _opt_str(v):
                if v is None or v == "":
                    return None
                s = str(v).strip()
                return s if s else None

            pfc_ratio_comment, absorption_notes = _strip_standard_mode_extras(
                execution_mode,
                _opt_str(parsed.get("pfc_ratio_comment")),
                _opt_str(parsed.get("absorption_notes")),
            )

            return AnalyzeResponse(
                description=str(parsed.get("description", "无法获取描述")),
                insight=str(parsed.get("insight", "保持健康饮食！")),
                items=valid_items,
                pfc_ratio_comment=pfc_ratio_comment,
                absorption_notes=absorption_notes,
                context_advice=_opt_str(parsed.get("context_advice")),
                analysis_engine=analysis_engine,
                resolved_count=resolved_summary.get("resolved_count"),
                unresolved_count=resolved_summary.get("unresolved_count"),
                recognitionOutcome=_opt_str(parsed.get("recognitionOutcome")),
                rejectionReason=_opt_str(parsed.get("rejectionReason")),
                retakeGuidance=parsed.get("retakeGuidance") if isinstance(parsed.get("retakeGuidance"), list) else None,
                allowedFoodCategory=_opt_str(parsed.get("allowedFoodCategory")),
                followupQuestions=parsed.get("followupQuestions") if isinstance(parsed.get("followupQuestions"), list) else None,
            )
        except HTTPException:
            raise
        except Exception as e:
            print(f"[api/analyze-text] error: {e}")
            raise HTTPException(status_code=500, detail=str(e) or "连接 AI 服务失败")


    class AnalyzeTextSubmitRequest(BaseModel):
        """提交文字分析任务：立即返回 task_id，结果由 Worker 写回后可从 /api/analyze/tasks 查询"""
        text: str = Field(..., description="用户描述的食物内容")
        meal_type: Optional[str] = Field(default=None, description=MEAL_TYPE_DESCRIPTION)
        timezone_offset_minutes: Optional[int] = Field(default=None, description="客户端时区偏移（JS getTimezoneOffset，单位分钟）")
        province: Optional[str] = Field(default=None, description="省份/直辖市")
        city: Optional[str] = Field(default=None, description="城市")
        district: Optional[str] = Field(default=None, description="区县")
        diet_goal: Optional[str] = Field(default=None, description="饮食目标: fat_loss / muscle_gain / maintain / none")
        activity_timing: Optional[str] = Field(default=None, description="运动时机: post_workout / daily / before_sleep / none")
        user_goal: Optional[str] = Field(default=None, description="用户目标: muscle_gain / fat_loss / maintain")
        remaining_calories: Optional[float] = Field(default=None, description="当日剩余热量预算 kcal")
        additionalContext: Optional[str] = Field(default=None, description="用户补充上下文或纠错说明")
        execution_mode: Optional[str] = Field(default=None, description="执行模式: standard / strict")
        analysis_engine: Optional[str] = Field(default=None, description="分析引擎: legacy_direct / db_first")
        date: Optional[str] = Field(default=None, description="记录日期 YYYY-MM-DD，仅支持近 3 天内补录")
        previousResult: Optional[Dict[str, Any]] = Field(default=None, description="上一轮分析结果")
        correctionItems: Optional[List[Dict[str, Any]]] = Field(default=None, description="本轮结构化纠错清单")
        precision_session_id: Optional[str] = Field(default=None, description="精准模式会话 ID（继续多轮交互时传入）")
        reference_objects: Optional[List[PrecisionReferenceObjectInput]] = Field(default=None, description="参考物列表")
        subscribe_status: Optional[str] = Field(default=None, description="用户对分析完成订阅消息的授权状态")




    @router.post("/api/analyze-text/submit")
    async def analyze_text_submit(
        body: AnalyzeTextSubmitRequest,
        user_info: dict = Depends(get_current_user_info),
    ):
        """
        提交文字分析任务（异步）。立即返回 task_id，Worker 子进程会在后台执行分析，
        完成后可通过 GET /api/analyze/tasks/{task_id} 或列表接口查看结果。
        """
        if not body.text or not body.text.strip():
            raise HTTPException(status_code=400, detail="text 不能为空")

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
            "execution_mode": effective_mode,
            "analysis_engine": (requested_analysis_engine or "db_first") if effective_mode == "standard" else (requested_analysis_engine or DEFAULT_ANALYSIS_ENGINE),
            "recorded_on": recorded_on,
            "credit_usage": dict((credits_info.get("credit_spend_plan") or {})),
            "previousResult": body.previousResult,
            "correctionItems": body.correctionItems,
            "reference_objects": _serialize_reference_objects(body.reference_objects),
            "subscribe_status": body.subscribe_status,
        }

        if effective_mode == "strict" or body.precision_session_id:
            session = None
            source_type = "text"
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
                    is_multi_view=False,
                    reference_objects=payload["reference_objects"],
                ),
                "text": body.text.strip(),
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
                    text_input=body.text.strip(),
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
            return {
                "task_id": precision_task["id"],
                "message": "精准模式任务已提交，系统将先判断是否需要补充信息或拆分估计",
            }

        _debug_log_food_submit(
            "text_submit_request",
            {
                "user_id": user_info["user_id"],
                "task_type": _get_food_task_type("food_text"),
                "text": body.text,
                "payload": payload,
            },
        )

        try:
            task = await asyncio.to_thread(
                create_analysis_task_sync,
                user_id=user_info["user_id"],
                task_type=_get_food_task_type("food_text"),
                text_input=body.text.strip(),
                payload=payload,
            )
            _debug_log_food_submit(
                "text_submit_created",
                {
                    "task_id": task["id"],
                    "task_type": task.get("task_type"),
                    "text_input": task.get("text_input"),
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
            print(
                f"[food_analysis] MODERATION_SKIPPED_CONFIRMED task_id={task['id']} submit_type=text",
                flush=True,
            )
            return {"task_id": task["id"], "message": "任务已提交，可稍后在识别历史中查看结果"}
        except Exception as e:
            _raise_analysis_related_schema_not_ready(e)
            print(f"[analyze-text/submit] 错误: {e}")
            raise HTTPException(status_code=500, detail="提交任务失败")




    return router
