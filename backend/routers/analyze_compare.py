import asyncio
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException


def create_analyze_compare_router(ctx):
    router = APIRouter()

    AnalyzeRequest = ctx["AnalyzeRequest"]
    CompareAnalyzeResponse = ctx["CompareAnalyzeResponse"]
    CompareAnalyzeEnginesResponse = ctx["CompareAnalyzeEnginesResponse"]
    CompareAnalyzeEnginesModelGroup = ctx["CompareAnalyzeEnginesModelGroup"]
    ModelAnalyzeResult = ctx["ModelAnalyzeResult"]
    GEMINI_MODEL_NAME = ctx["GEMINI_MODEL_NAME"]
    get_optional_user_info = ctx["get_optional_user_info"]
    get_user_by_id = ctx["get_user_by_id"]
    _parse_execution_mode_or_raise = ctx["_parse_execution_mode_or_raise"]
    _normalize_execution_mode = ctx["_normalize_execution_mode"]
    _meal_name = ctx["_meal_name"]
    _format_health_profile_for_analysis = ctx["_format_health_profile_for_analysis"]
    _format_health_risk_summary_for_analysis = ctx["_format_health_risk_summary_for_analysis"]
    _build_execution_mode_hint = ctx["_build_execution_mode_hint"]
    _build_gemini_prompt = ctx["_build_gemini_prompt"]
    _analyze_with_qwen = ctx["_analyze_with_qwen"]
    _analyze_with_gemini = ctx["_analyze_with_gemini"]
    _parse_analyze_result = ctx["_parse_analyze_result"]
    _strip_standard_mode_extras = ctx["_strip_standard_mode_extras"]
    _run_engine_compare_once = ctx["_run_engine_compare_once"]
    _resolve_food_vision_model_config = ctx["_resolve_food_vision_model_config"]

    @router.post("/api/analyze-compare", response_model=CompareAnalyzeResponse)
    async def analyze_food_compare(
        request: AnalyzeRequest,
        user_info: Optional[dict] = Depends(get_optional_user_info),
    ):
        """
        双模型对比分析：同时使用千问和 Gemini 模型分析同一张食物图片，返回两个模型的结果供对比。
    
        - 千问模型 (qwen-vl-max): 通过 DashScope API 调用
        - Gemini 模型: 通过 OfoxAI 的 OpenAI 兼容接口调用
    
        前端可以展示两个结果，让用户选择保存哪个。
        """
        if not request.base64Image and not request.image_url:
            raise HTTPException(status_code=400, detail="请提供 base64Image 或 image_url 之一")
        requested_mode = _parse_execution_mode_or_raise(request.execution_mode) if request.execution_mode is not None else None
    
        # 获取 API Key
        dashscope_api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
        ofoxai_api_key = os.getenv("OFOXAI_API_KEY") or os.getenv("ofox_ai_apikey")
    
        # 构建提示词参数
        goal_hint = ""
        if request.user_goal:
            goal_map = {"muscle_gain": "增肌", "fat_loss": "减脂", "maintain": "维持体重"}
            goal_hint = f"\n用户目标为「{goal_map.get(request.user_goal, request.user_goal)}」，请在 pfc_ratio_comment 中评价本餐 P/C/F 占比是否适合该目标。"
    
        state_hint = ""
        state_parts: List[str] = []
        if request.diet_goal or request.activity_timing:
            diet_map = {"fat_loss": "减脂期", "muscle_gain": "增肌期", "maintain": "维持体重", "none": "无特殊目标"}
            activity_map = {"post_workout": "练后", "daily": "日常", "before_sleep": "睡前", "none": "无特殊"}
            diet_text = diet_map.get(request.diet_goal, request.diet_goal) if request.diet_goal and request.diet_goal != "none" else ""
            activity_text = activity_map.get(request.activity_timing, request.activity_timing) if request.activity_timing and request.activity_timing != "none" else ""
            state_parts = [s for s in [diet_text, activity_text] if s]
            if state_parts:
                state_hint = f"\n用户当前状态: {' + '.join(state_parts)}，请在 context_advice 中给出针对性进食建议（如补剂、搭配）。"

    
        remain_hint = f"\n用户当日剩余热量预算约 {request.remaining_calories} kcal，可在 context_advice 中提示本餐占比或下一餐建议。" if request.remaining_calories is not None else ""
    
        meal_hint = ""
        meal_name = ""
        if request.meal_type:
            meal_name = _meal_name(request.meal_type, timezone_offset_minutes=request.timezone_offset_minutes)
            meal_hint = f"\n用户选择的是「{meal_name}」，请结合餐次特点在 insight 或 context_advice 中给出建议（如早餐适合碳水与蛋白搭配、晚餐宜清淡等）。"
    
        # 若已登录，拉取健康档案
        profile_block = ""
        compact_tags_list: List[str] = []
        if request.meal_type:
            compact_tags_list.append(f"餐次:{meal_name}")
        if state_parts:
            compact_tags_list.append("状态:" + "/".join(state_parts))
        if request.remaining_calories is not None:
            compact_tags_list.append(f"剩余:{float(request.remaining_calories):g}kcal")
        user = None
        execution_mode = requested_mode
        if user_info:
            user = await get_user_by_id(user_info["user_id"])
            execution_mode = requested_mode or _normalize_execution_mode((user or {}).get("execution_mode"))
            if user:
                if execution_mode == "strict":
                    profile_block = _format_health_profile_for_analysis(user)
                    if profile_block:
                        profile_block = (
                            "\n\n若以下存在「用户健康档案」，请结合档案在 insight、absorption_notes、context_advice 中给出更贴合该用户体质与健康状况的建议（如控糖、低嘌呤、过敏规避等）。\n\n"
                            + profile_block
                        )
                else:
                    profile_summary = _format_health_risk_summary_for_analysis(user)
                    if profile_summary:
                        compact_tags_list.append(profile_summary)
        if execution_mode is None:
            execution_mode = _normalize_execution_mode(None)
        mode_hint = _build_execution_mode_hint(execution_mode)
        compact_tags = ("\n".join(compact_tags_list) + "\n") if compact_tags_list else ""
    
        # 构建通用提示词
        prompt = _build_gemini_prompt(
            additional_context=request.additionalContext or "",
            goal_hint=goal_hint,
            state_hint=state_hint,
            remain_hint=remain_hint,
            meal_hint=meal_hint,
            profile_block=profile_block,
            compact_tags=compact_tags,
            mode_hint=mode_hint,
            execution_mode=execution_mode,
        )
    
        # 准备图片 URL
        if request.image_url:
            image_url_for_api = request.image_url
            base64_for_gemini = None
        else:
            image_data = (
                request.base64Image.split(",")[1]
                if "," in request.base64Image
                else request.base64Image
            )
            image_url_for_api = f"data:image/jpeg;base64,{image_data}"
            base64_for_gemini = request.base64Image
    
        # 并行调用两个模型
        qwen_result = ModelAnalyzeResult(model_name="qwen-vl-max", success=False)
        gemini_result = ModelAnalyzeResult(model_name=GEMINI_MODEL_NAME, success=False)
    
        async def call_qwen():
            nonlocal qwen_result
            try:
                if not dashscope_api_key:
                    raise Exception("缺少 DASHSCOPE_API_KEY 环境变量")
            
                base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
                parsed = await _analyze_with_qwen(request, prompt, image_url_for_api, dashscope_api_key, base_url)
                items, desc, insight, pfc, absorption, context = _parse_analyze_result(parsed)
            
                pfc, absorption = _strip_standard_mode_extras(execution_mode, pfc, absorption)
                qwen_result = ModelAnalyzeResult(
                    model_name="qwen-vl-max",
                    success=True,
                    description=desc,
                    insight=insight,
                    items=items,
                    pfc_ratio_comment=pfc,
                    absorption_notes=absorption,
                    context_advice=context,
                )
            except Exception as e:
                print(f"[analyze-compare] 千问分析失败: {e}")
                qwen_result = ModelAnalyzeResult(
                    model_name="qwen-vl-max",
                    success=False,
                    error=str(e),
                )
    
        async def call_gemini():
            nonlocal gemini_result
            try:
                if not ofoxai_api_key or ofoxai_api_key == "your_ofoxai_api_key_here":
                    raise Exception("请在 .env 中配置有效的 OFOXAI_API_KEY")
            
                parsed = await _analyze_with_gemini(
                    image_url=request.image_url,
                    base64_image=base64_for_gemini,
                    image_mime_type="image/jpeg",
                    prompt=prompt,
                    model_name=GEMINI_MODEL_NAME,
                )
                items, desc, insight, pfc, absorption, context = _parse_analyze_result(parsed)
            
                gemini_result = ModelAnalyzeResult(
                    model_name=GEMINI_MODEL_NAME,
                    success=True,
                    description=desc,
                    insight=insight,
                    items=items,
                    pfc_ratio_comment=pfc,
                    absorption_notes=absorption,
                    context_advice=context,
                )
            except Exception as e:
                print(f"[analyze-compare] Gemini (OfoxAI) 分析失败: {e}")
                gemini_result = ModelAnalyzeResult(
                    model_name=GEMINI_MODEL_NAME,
                    success=False,
                    error=str(e),
                )
    
        # 并行执行两个模型的分析
        await asyncio.gather(call_qwen(), call_gemini())
    
        return CompareAnalyzeResponse(
            qwen_result=qwen_result,
            gemini_result=gemini_result,
        )


    @router.post("/api/analyze-compare-engines", response_model=CompareAnalyzeEnginesResponse)
    async def analyze_food_compare_engines(
        request: AnalyzeRequest,
        user_info: Optional[dict] = Depends(get_optional_user_info),
    ):
        """
        同一张食物图片在同一视觉模型下分别使用旧算法与新算法分析。

        - legacy_direct: 模型直接输出重量与营养
        - db_first: 模型输出名称与重量，营养由食物库解析/查表
        """
        if not request.base64Image and not request.image_url:
            raise HTTPException(status_code=400, detail="请提供 base64Image 或 image_url 之一")
        if request.image_urls and len(request.image_urls) > 0:
            raise HTTPException(status_code=400, detail="算法对比当前仅支持单张图片，请传 image_url 或 base64Image")

        requested_mode = _parse_execution_mode_or_raise(request.execution_mode) if request.execution_mode is not None else None
        execution_mode = requested_mode or _normalize_execution_mode(None)
        if execution_mode != "standard":
            raise HTTPException(status_code=400, detail="算法对比当前仅支持 standard 模式")

        goal_hint = ""
        if request.user_goal:
            goal_map = {"muscle_gain": "增肌", "fat_loss": "减脂", "maintain": "维持体重"}
            goal_hint = f"\n用户目标为「{goal_map.get(request.user_goal, request.user_goal)}」，请在 pfc_ratio_comment 中评价本餐 P/C/F 占比是否适合该目标。"

        state_parts: List[str] = []
        if request.diet_goal or request.activity_timing:
            diet_map = {"fat_loss": "减脂期", "muscle_gain": "增肌期", "maintain": "维持体重", "none": "无特殊目标"}
            activity_map = {"post_workout": "练后", "daily": "日常", "before_sleep": "睡前", "none": "无特殊"}
            diet_text = diet_map.get(request.diet_goal, request.diet_goal) if request.diet_goal and request.diet_goal != "none" else ""
            activity_text = activity_map.get(request.activity_timing, request.activity_timing) if request.activity_timing and request.activity_timing != "none" else ""
            state_parts = [s for s in [diet_text, activity_text] if s]

        meal_name = _meal_name(request.meal_type, timezone_offset_minutes=request.timezone_offset_minutes) if request.meal_type else ""
        compact_tags_list: List[str] = []
        if request.meal_type:
            compact_tags_list.append(f"餐次:{meal_name}")
        if state_parts:
            compact_tags_list.append("状态:" + "/".join(state_parts))
        if request.remaining_calories is not None:
            compact_tags_list.append(f"剩余:{float(request.remaining_calories):g}kcal")

        profile_block = ""
        if user_info:
            user = await get_user_by_id(user_info["user_id"])
            if user:
                profile_summary = _format_health_risk_summary_for_analysis(user)
                if profile_summary:
                    compact_tags_list.append(profile_summary)

        compact_tags = ("\n".join(compact_tags_list) + "\n") if compact_tags_list else ""
        raw_model_names = request.modelNames or ([request.modelName] if request.modelName else None) or [GEMINI_MODEL_NAME]
        requested_model_names: List[str] = []
        seen_model_names: set[str] = set()
        for raw_name in raw_model_names:
            name = str(raw_name or "").strip()
            if not name:
                continue
            normalized = name.lower()
            if normalized in seen_model_names:
                continue
            seen_model_names.add(normalized)
            requested_model_names.append(name)
        if not requested_model_names:
            requested_model_names = [GEMINI_MODEL_NAME]
        if len(requested_model_names) > 4:
            raise HTTPException(status_code=400, detail="算法对比当前最多支持 4 个模型")

        base_task_payload = {
            "additionalContext": request.additionalContext or "",
            "user_goal": request.user_goal,
            "diet_goal": request.diet_goal,
            "activity_timing": request.activity_timing,
            "remaining_calories": request.remaining_calories,
            "meal_type": request.meal_type,
            "timezone_offset_minutes": request.timezone_offset_minutes,
            "province": request.province,
            "city": request.city,
            "district": request.district,
            "image_urls": request.image_urls,
            "is_multi_view": bool(request.image_urls and len(request.image_urls) > 1),
            "compact_tags": compact_tags,
            "goal_hint": goal_hint,
        }

        if request.image_url:
            image_url_for_api = request.image_url
            base64_for_gemini = None
        else:
            image_data = request.base64Image.split(",")[1] if "," in request.base64Image else request.base64Image
            image_url_for_api = f"data:image/jpeg;base64,{image_data}"
            base64_for_gemini = request.base64Image

        async def run_compare_for_model(model_name: str) -> CompareAnalyzeEnginesModelGroup:
            model_request = request.copy(update={"modelName": model_name, "modelNames": None})
            task_payload = {
                **base_task_payload,
                "modelName": model_name,
            }
            legacy_result, db_first_result = await asyncio.gather(
                _run_engine_compare_once(
                    request=model_request,
                    task_payload=task_payload,
                    profile_block=profile_block,
                    execution_mode=execution_mode,
                    analysis_engine="legacy_direct",
                    image_url_for_api=image_url_for_api,
                    base64_for_gemini=base64_for_gemini,
                ),
                _run_engine_compare_once(
                    request=model_request,
                    task_payload=task_payload,
                    profile_block=profile_block,
                    execution_mode=execution_mode,
                    analysis_engine="db_first",
                    image_url_for_api=image_url_for_api,
                    base64_for_gemini=base64_for_gemini,
                ),
            )
            model_config = _resolve_food_vision_model_config(model_name)
            return CompareAnalyzeEnginesModelGroup(
                model_name=model_config["model"],
                legacy_result=legacy_result,
                db_first_result=db_first_result,
            )

        grouped_results = await asyncio.gather(*[
            run_compare_for_model(model_name) for model_name in requested_model_names
        ])

        response = CompareAnalyzeEnginesResponse(
            requested_model_names=[group.model_name for group in grouped_results],
            results=grouped_results,
        )
        if len(grouped_results) == 1:
            response.model_name = grouped_results[0].model_name
            response.legacy_result = grouped_results[0].legacy_result
            response.db_first_result = grouped_results[0].db_first_result
        return response


    return router
