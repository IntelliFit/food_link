"""
异步分析任务 Worker：从 Supabase analysis_tasks 表抢占 pending 任务并执行。
支持 task_type=food（食物分析）、health_report（体检报告 OCR）。
启动方式：由 run_backend.py 启动多个子进程。
"""
import os
import sys
import json
import re
import time
from typing import Dict, Any, Optional

from dotenv import load_dotenv

# 确保 backend 目录在 path 中
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

import httpx
from database import (
    claim_next_pending_task_sync,
    update_analysis_task_result_sync,
    get_user_by_id_sync,
    insert_health_document_sync,
    update_user_sync,
    mark_task_violated_sync,
    create_violation_record_sync,
    claim_next_pending_comment_task_sync,
    update_comment_task_result_sync,
    mark_comment_task_violated_sync,
    add_feed_comment_sync,
    add_public_food_library_comment_sync,
)
from metabolic import get_age_from_birthday

ACTIVITY_LEVEL_LABELS = {
    "sedentary": "久坐",
    "light": "轻度活动",
    "moderate": "中度活动",
    "active": "高度活动",
    "very_active": "极高活动",
}


def _format_health_profile_sync(user: Dict[str, Any]) -> str:
    """将 weapp_user 健康档案格式化为供 AI 参考的简短摘要（与 main 中逻辑一致）。"""
    parts = []
    gender = user.get("gender")
    if gender:
        parts.append(f"性别：{'男' if gender == 'male' else '女'}")
    height = user.get("height")
    if height is not None:
        parts.append(f"身高 {float(height):.0f} cm")
    weight = user.get("weight")
    if weight is not None:
        parts.append(f"体重 {float(weight):.1f} kg")
    birthday = user.get("birthday")
    if birthday:
        age = get_age_from_birthday(str(birthday))
        if age is not None:
            parts.append(f"年龄 {age} 岁")
    if parts:
        parts[0] = "· " + parts[0]
        for i in range(1, len(parts)):
            parts[i] = "  " + parts[i]
        line1 = " ".join(parts)
    else:
        line1 = ""
    activity = user.get("activity_level")
    activity_str = ACTIVITY_LEVEL_LABELS.get(activity, activity or "未填")
    line2 = f"· 活动水平：{activity_str}"
    hc = user.get("health_condition") or {}
    if isinstance(hc, str):
        try:
            hc = json.loads(hc) if hc else {}
        except Exception:
            hc = {}
    medical = hc.get("medical_history") or []
    line3 = "· 既往病史：" + "、".join(medical) if isinstance(medical, list) and medical else ""
    diet = hc.get("diet_preference") or []
    line4 = "· 饮食偏好：" + "、".join(diet) if isinstance(diet, list) and diet else ""
    allergies = hc.get("allergies") or []
    line5 = "· 过敏/忌口：" + "、".join(allergies) if isinstance(allergies, list) and allergies else ""
    bmr = user.get("bmr")
    tdee = user.get("tdee")
    line6 = ""
    if bmr is not None or tdee is not None:
        bmr_s = f"{float(bmr):.0f} kcal/天" if bmr is not None else "未计算"
        tdee_s = f"{float(tdee):.0f} kcal/天" if tdee is not None else "未计算"
        line6 = f"· 基础代谢(BMR)：{bmr_s}；每日总消耗(TDEE)：{tdee_s}"
    report = hc.get("report_extract") or hc.get("ocr_notes") or ""
    if isinstance(report, dict):
        report = json.dumps(report, ensure_ascii=False)[:500]
    elif report:
        report = (report[:500] + "…") if len(str(report)) > 500 else str(report)
    line7 = "· 体检/病历摘要：" + report if report else ""
    lines = [line1, line2, line3, line4, line5, line6, line7]
    lines = [x for x in lines if x]
    if not lines:
        return ""
    return "用户健康档案（供营养建议参考）：\n" + "\n".join(lines)


def _image_moderation_prompt() -> str:
    """图片内容审核提示词。"""
    return """
你是一个内容安全审核系统。请分析这张/这些图片，判断是否存在以下违规情况：
1. 图片与食物完全无关（如自拍、风景、截图、文档等非食物图片）
2. 图片包含色情、裸露内容
3. 图片包含暴力、血腥、恐怖内容
4. 图片包含违法犯罪相关内容
5. 图片包含政治敏感内容

注意：只要图片中包含食物（即使同时有其他物品），就不算违规。
只有图片完全与食物无关，或包含上述 2-5 类违规内容时，才判定为违规。

请严格按以下 JSON 格式返回，不要包含任何其他文本：
如果不违规：{"is_violation": false}
如果违规：{"is_violation": true, "category": "分类值", "reason": "简要中文原因"}

category 可选值：irrelevant_image, pornography, violence, crime, politics, other
""".strip()


def _text_moderation_prompt(text_input: str) -> str:
    """文本内容审核提示词。"""
    return f"""
你是一个内容安全审核系统。请分析以下用户输入的文本，判断是否存在违规情况：

用户输入文本："{text_input}"

判断标准：
1. 文本与食物描述完全无关（如随机文字、无意义内容等）
2. 文本包含色情、低俗内容
3. 文本包含暴力、恐怖相关描述
4. 文本包含违法犯罪相关内容
5. 文本包含政治敏感言论

注意：只要文本是在描述食物、饮料、餐食（即使描述不准确或简短），就不算违规。
只有文本完全与食物无关，或包含上述 2-5 类违规内容时，才判定为违规。

请严格按以下 JSON 格式返回，不要包含任何其他文本：
如果不违规：{{"is_violation": false}}
如果违规：{{"is_violation": true, "category": "分类值", "reason": "简要中文原因"}}

category 可选值：irrelevant_image, inappropriate_text, pornography, violence, crime, politics, other
""".strip()


def run_content_moderation_sync(task: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    对分析任务的内容（图片或文本）进行 AI 审核。
    返回审核结果 dict：
      - {"is_violation": False} 表示通过
      - {"is_violation": True, "category": "...", "reason": "..."} 表示违规
    审核失败时返回 None（不阻塞正常分析流程）。
    """
    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        print("[moderation] 缺少 API_KEY，跳过审核")
        return None

    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_url = f"{base_url}/chat/completions"
    task_type = task.get("task_type", "")

    try:
        if task_type in ("food", "health_report"):
            # 图片审核：使用视觉模型
            image_urls = []
            image_paths = task.get("image_paths")
            if image_paths and isinstance(image_paths, list) and len(image_paths) > 0:
                image_urls = image_paths
            elif task.get("image_url"):
                image_urls = [task["image_url"]]
            if not image_urls:
                return None  # 没有图片，跳过审核

            content = [
                {"type": "text", "text": _image_moderation_prompt()},
                *[{"type": "image_url", "image_url": {"url": url}} for url in image_urls],
            ]
            model = "qwen-vl-max"

            with httpx.Client(timeout=30.0) as client:
                response = client.post(
                    api_url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": content}],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.1,
                    },
                )

        elif task_type == "food_text":
            # 文本审核：使用文本模型
            text_input = task.get("text_input") or ""
            if not text_input.strip():
                return None  # 没有文本，跳过审核

            model = "qwen-plus"

            with httpx.Client(timeout=30.0) as client:
                response = client.post(
                    api_url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": _text_moderation_prompt(text_input)}],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.1,
                    },
                )
        else:
            return None  # 未知任务类型，跳过审核

        if not response.is_success:
            print(f"[moderation] API 请求失败: {response.status_code}")
            return None

        data = response.json()
        raw = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not raw:
            print("[moderation] AI 返回空响应")
            return None

        json_str = re.sub(r"```json", "", raw)
        json_str = re.sub(r"```", "", json_str).strip()
        result = json.loads(json_str)
        print(f"[moderation] 审核结果: {result}")
        return result

    except Exception as e:
        # 审核出错不应阻塞正常分析流程，仅打印日志
        print(f"[moderation] 审核异常（不阻塞分析）: {e}")
        return None


def _build_food_prompt(task: Dict[str, Any], profile_block: str) -> str:
    """根据任务 payload 和用户档案构建千问分析用 prompt。"""
    payload = task.get("payload") or {}
    goal_map = {"muscle_gain": "增肌", "fat_loss": "减脂", "maintain": "维持体重"}
    diet_map = {"fat_loss": "减脂期", "muscle_gain": "增肌期", "maintain": "维持体重", "none": "无特殊目标"}
    activity_map = {"post_workout": "练后", "daily": "日常", "before_sleep": "睡前", "none": "无"}

    user_goal = payload.get("user_goal")
    goal_hint = f"\n用户目标为「{goal_map.get(user_goal, user_goal or '')}」，请在 pfc_ratio_comment 中评价本餐 P/C/F 占比是否适合该目标。" if user_goal else ""

    diet_goal = payload.get("diet_goal")
    activity_timing = payload.get("activity_timing")
    state_parts = []
    if diet_goal and diet_goal != "none":
        state_parts.append(diet_map.get(diet_goal, diet_goal))
    if activity_timing and activity_timing != "none":
        state_parts.append(activity_map.get(activity_timing, activity_timing))
    state_hint = f"\n用户当前状态: {' + '.join(state_parts)}，请在 context_advice 中给出针对性进食建议。" if state_parts else ""

    remaining = payload.get("remaining_calories")
    remain_hint = f"\n用户当日剩余热量预算约 {remaining} kcal，可在 context_advice 中提示本餐占比或下一餐建议。" if remaining is not None else ""

    meal_type = payload.get("meal_type")
    meal_map = {"breakfast": "早餐", "lunch": "午餐", "dinner": "晚餐", "snack": "加餐"}
    meal_name = meal_map.get(meal_type, meal_type or "")
    meal_hint = f"\n用户选择的是「{meal_name}」，请结合餐次特点在 insight 或 context_advice 中给出建议。" if meal_name else ""

    additional = (payload.get("additionalContext") or "").strip()
    additional_line = f'\n用户补充背景信息: "{additional}"。请根据此信息调整对隐形成分或烹饪方式的判断。' if additional else ""

    return f"""
请作为专业的营养师分析这些食物图片。
1. 识别图中所有不同的食物单品。
2. 估算每种食物的重量（克）和详细营养成分。
3. description: 提供这顿饭的简短中文描述。
4. insight: 基于该餐营养成分的一句话健康建议。{meal_hint}
5. pfc_ratio_comment: 本餐蛋白质(P)、脂肪(F)、碳水(C) 占比的简要评价（是否均衡、适合增肌/减脂/维持）。{goal_hint}
6. absorption_notes: 食物组合或烹饪方式对吸收率、生物利用度的简要说明（一两句话）。
7. context_advice: 结合用户状态或剩余热量的情境建议（若无则可为空字符串）。{state_hint}{remain_hint}{profile_block}
{additional_line}

重要：请务必使用**简体中文**返回所有文本内容。
请严格按照以下 JSON 格式返回，不要包含任何其他文本：

{{
  "items": [
    {{
      "name": "食物名称（简体中文）",
      "estimatedWeightGrams": 重量（数字）,
      "nutrients": {{ "calories", "protein", "carbs", "fat", "fiber", "sugar" }}
    }}
  ],
  "description": "餐食描述（简体中文）",
  "insight": "健康建议（简体中文）",
  "pfc_ratio_comment": "PFC 比例评价（简体中文，一两句话）",
  "absorption_notes": "吸收率/生物利用度说明（简体中文，一两句话）",
  "context_advice": "情境建议（简体中文，若无则空字符串）"
}}
""".strip()


def run_food_analysis_sync(task: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    同步执行食物分析：调 DashScope，解析 JSON，返回与 /api/analyze 一致结构的 result。
    失败时抛出异常，由调用方捕获并写 failed。
    """
    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        raise RuntimeError("缺少 DASHSCOPE_API_KEY（或 API_KEY）环境变量")

    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_url = f"{base_url}/chat/completions"
    api_url = f"{base_url}/chat/completions"
    
    # 获取图片列表：优先使用 image_paths (多图)，兼容 image_url (单图)
    image_url = task.get("image_url")
    image_paths = task.get("image_paths") # 在 create_analysis_task_sync 中我们把 urls 存到了 image_paths 字段
    
    target_image_urls = []
    if image_paths and isinstance(image_paths, list) and len(image_paths) > 0:
        target_image_urls = image_paths
    elif image_url:
        target_image_urls = [image_url]
        
    if not target_image_urls:
        raise ValueError("任务缺少图片")

    user_id = task.get("user_id")
    user = get_user_by_id_sync(user_id) if user_id else None
    profile_block = ""
    if user:
        profile_block = _format_health_profile_sync(user)
        if profile_block:
            profile_block = (
                "\n\n若以下存在「用户健康档案」，请结合档案在 insight、absorption_notes、context_advice 中给出更贴合该用户体质与健康状况的建议。\n\n"
                + profile_block
            )

    prompt = _build_food_prompt(task, profile_block)
    model = (task.get("payload") or {}).get("modelName") or "qwen-vl-max"

    with httpx.Client(timeout=60.0) as client:
        response = client.post(
            api_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            *[
                                {"type": "image_url", "image_url": {"url": url}}
                                for url in target_image_urls
                            ]
                        ],
                    }
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.7,
            },
        )

        if not response.is_success:
            err = response.json() if response.content else {}
            msg = err.get("error", {}).get("message") or f"DashScope API 错误: {response.status_code}"
            raise RuntimeError(msg)

        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not content:
            raise RuntimeError("AI 返回了空响应")

        json_str = re.sub(r"```json", "", content)
        json_str = re.sub(r"```", "", json_str).strip()
        parsed = json.loads(json_str)

    # 转为与 API 一致的 result 结构（供前端与保存记录使用）
    items = []
    for item in (parsed.get("items") or []):
        n = item.get("nutrients") or {}
        w = float(item.get("estimatedWeightGrams") or 0)
        items.append({
            "name": str(item.get("name", "未知食物")),
            "estimatedWeightGrams": w,
            "originalWeightGrams": w,
            "nutrients": {
                "calories": float(n.get("calories") or 0),
                "protein": float(n.get("protein") or 0),
                "carbs": float(n.get("carbs") or 0),
                "fat": float(n.get("fat") or 0),
                "fiber": float(n.get("fiber") or 0),
                "sugar": float(n.get("sugar") or 0),
            },
        })

    return {
        "description": str(parsed.get("description", "无法获取描述")),
        "insight": str(parsed.get("insight", "保持健康饮食！")),
        "items": items,
        "pfc_ratio_comment": (parsed.get("pfc_ratio_comment") or "").strip() or None,
        "absorption_notes": (parsed.get("absorption_notes") or "").strip() or None,
        "context_advice": (parsed.get("context_advice") or "").strip() or None,
    }


def process_one_food_task(task: Dict[str, Any]) -> None:
    """处理单条食物分析任务：先审核内容，通过后执行分析并写回 done/failed。"""
    task_id = task["id"]
    try:
        # 第一步：内容审核
        moderation = run_content_moderation_sync(task)
        if moderation and moderation.get("is_violation"):
            reason = moderation.get("reason", "内容违规")
            print(f"[worker] 任务 {task_id} 内容违规: {reason}")
            mark_task_violated_sync(task_id, reason)
            create_violation_record_sync(task, moderation, violation_type="food_analysis")
            return
        # 第二步：正常食物分析
        result = run_food_analysis_sync(task)
        update_analysis_task_result_sync(task_id, status="done", result=result)
    except Exception as e:
        err_msg = str(e) or type(e).__name__
        update_analysis_task_result_sync(task_id, status="failed", error_message=err_msg)


def _build_text_food_prompt(task: Dict[str, Any], profile_block: str) -> str:
    """根据任务 payload 和用户档案构建文字分析用 prompt。"""
    text_input = task.get("text_input") or ""
    payload = task.get("payload") or {}
    
    goal_map = {"muscle_gain": "增肌", "fat_loss": "减脂", "maintain": "维持体重"}
    diet_map = {"fat_loss": "减脂期", "muscle_gain": "增肌期", "maintain": "维持体重", "none": "无特殊目标"}
    activity_map = {"post_workout": "练后", "daily": "日常", "before_sleep": "睡前", "none": "无"}

    user_goal = payload.get("user_goal")
    goal_hint = f" 用户目标为「{goal_map.get(user_goal, user_goal or '')}」，请在 pfc_ratio_comment 中评价本餐 P/C/F 占比是否适合该目标。" if user_goal else ""

    diet_goal = payload.get("diet_goal")
    activity_timing = payload.get("activity_timing")
    state_parts = []
    if diet_goal and diet_goal != "none":
        state_parts.append(diet_map.get(diet_goal, diet_goal))
    if activity_timing and activity_timing != "none":
        state_parts.append(activity_map.get(activity_timing, activity_timing))
    state_hint = f" 用户当前状态: {' + '.join(state_parts)}，请在 context_advice 中给出针对性进食建议。" if state_parts else ""

    remaining = payload.get("remaining_calories")
    remain_hint = f" 用户当日剩余热量预算约 {remaining} kcal，可在 context_advice 中提示本餐占比或下一餐建议。" if remaining is not None else ""

    meal_type = payload.get("meal_type")
    meal_map = {"breakfast": "早餐", "lunch": "午餐", "dinner": "晚餐", "snack": "加餐"}
    meal_name = meal_map.get(meal_type, meal_type or "")
    meal_hint = f" 用户选择的是「{meal_name}」，请结合餐次特点在 insight 或 context_advice 中给出建议。" if meal_name else ""

    profile_hint = f"\n\n若以下存在「用户健康档案」，请结合档案在 insight、absorption_notes、context_advice 中给出更贴合该用户体质与健康状况的建议。\n\n{profile_block}" if profile_block else ""

    return f"""
请作为专业的营养师分析用户描述的食物。

用户描述：{text_input}

任务：
1. 识别描述中的所有食物单品。
2. 估算每种食物的合理重量（克）和详细营养成分。
3. description: 提供这顿饭的简短中文描述。
4. insight: 基于该餐营养成分的一句话健康建议。{meal_hint}
5. pfc_ratio_comment: 本餐蛋白质(P)、脂肪(F)、碳水(C) 占比的简要评价（是否均衡、适合增肌/减脂/维持）。{goal_hint}
6. absorption_notes: 食物组合或烹饪方式对吸收率、生物利用度的简要说明（一两句话）。
7. context_advice: 结合用户状态或剩余热量的情境建议（若无则可为空字符串）。{state_hint}{remain_hint}{profile_hint}

重要：请务必使用**简体中文**返回所有文本内容。
请严格按照以下 JSON 格式返回，不要包含任何其他文本：

{{
  "items": [
    {{
      "name": "食物名称（简体中文）",
      "estimatedWeightGrams": 重量（数字）,
      "nutrients": {{ "calories", "protein", "carbs", "fat", "fiber", "sugar" }}
    }}
  ],
  "description": "餐食描述（简体中文）",
  "insight": "健康建议（简体中文）",
  "pfc_ratio_comment": "PFC 比例评价（简体中文，一两句话）",
  "absorption_notes": "吸收率/生物利用度说明（简体中文，一两句话）",
  "context_advice": "情境建议（简体中文，若无则空字符串）"
}}
""".strip()


def run_text_food_analysis_sync(task: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    同步执行文字食物分析：调 DashScope，解析 JSON，返回与 /api/analyze 一致结构的 result。
    失败时抛出异常，由调用方捕获并写 failed。
    """
    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        raise RuntimeError("缺少 DASHSCOPE_API_KEY（或 API_KEY）环境变量")

    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_url = f"{base_url}/chat/completions"
    text_input = task.get("text_input") or ""
    if not text_input:
        raise ValueError("任务缺少 text_input")

    user_id = task.get("user_id")
    user = get_user_by_id_sync(user_id) if user_id else None
    profile_block = ""
    if user:
        profile_block = _format_health_profile_sync(user)

    prompt = _build_text_food_prompt(task, profile_block)
    model = (task.get("payload") or {}).get("modelName") or "qwen-plus"

    with httpx.Client(timeout=60.0) as client:
        response = client.post(
            api_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.7,
            },
        )

        if not response.is_success:
            err = response.json() if response.content else {}
            msg = err.get("error", {}).get("message") or f"DashScope API 错误: {response.status_code}"
            raise RuntimeError(msg)

        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not content:
            raise RuntimeError("AI 返回了空响应")

        json_str = re.sub(r"```json", "", content)
        json_str = re.sub(r"```", "", json_str).strip()
        parsed = json.loads(json_str)

    # 转为与 API 一致的 result 结构
    items = []
    for item in (parsed.get("items") or []):
        n = item.get("nutrients") or {}
        w = float(item.get("estimatedWeightGrams") or 0)
        items.append({
            "name": str(item.get("name", "未知食物")),
            "estimatedWeightGrams": w,
            "originalWeightGrams": w,
            "nutrients": {
                "calories": float(n.get("calories") or 0),
                "protein": float(n.get("protein") or 0),
                "carbs": float(n.get("carbs") or 0),
                "fat": float(n.get("fat") or 0),
                "fiber": float(n.get("fiber") or 0),
                "sugar": float(n.get("sugar") or 0),
            },
        })

    return {
        "description": str(parsed.get("description", "无法获取描述")),
        "insight": str(parsed.get("insight", "保持健康饮食！")),
        "items": items,
        "pfc_ratio_comment": (parsed.get("pfc_ratio_comment") or "").strip() or None,
        "absorption_notes": (parsed.get("absorption_notes") or "").strip() or None,
        "context_advice": (parsed.get("context_advice") or "").strip() or None,
    }


def process_one_text_food_task(task: Dict[str, Any]) -> None:
    """处理单条文字食物分析任务：先审核内容，通过后执行分析并写回 done/failed。"""
    task_id = task["id"]
    try:
        # 第一步：内容审核
        moderation = run_content_moderation_sync(task)
        if moderation and moderation.get("is_violation"):
            reason = moderation.get("reason", "内容违规")
            print(f"[worker] 任务 {task_id} 文本违规: {reason}")
            mark_task_violated_sync(task_id, reason)
            create_violation_record_sync(task, moderation, violation_type="food_analysis")
            return
        # 第二步：正常文字食物分析
        result = run_text_food_analysis_sync(task)
        update_analysis_task_result_sync(task_id, status="done", result=result)
    except Exception as e:
        err_msg = str(e) or type(e).__name__
        update_analysis_task_result_sync(task_id, status="failed", error_message=err_msg)


def _ocr_report_prompt() -> str:
    """体检报告 OCR 提示词（与 main.py 一致）"""
    return """
请识别这张体检报告或病例截图中的健康相关信息。
请用简体中文，按以下 JSON 格式返回（若某项无法识别则填空数组或空字符串）：
{
  "indicators": [{"name": "指标名称", "value": "数值", "unit": "单位"}],
  "conclusions": ["结论1", "结论2"],
  "suggestions": ["建议1"],
  "medical_notes": "其他与病史、过敏、饮食禁忌相关的文字摘要"
}
只返回上述 JSON，不要其他说明。
""".strip()


def run_health_report_ocr_sync(task: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    同步执行体检报告 OCR：调 DashScope 多模态模型，返回 extracted_content。
    完成后写入 user_health_documents，并更新 weapp_user.health_condition.report_extract。
    失败时抛出异常。
    """
    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        raise RuntimeError("缺少 DASHSCOPE_API_KEY（或 API_KEY）环境变量")

    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_url = f"{base_url}/chat/completions"
    image_url = task.get("image_url") or ""
    if not image_url:
        raise ValueError("任务缺少 image_url")

    user_id = task.get("user_id")
    if not user_id:
        raise ValueError("任务缺少 user_id")

    with httpx.Client(timeout=60.0) as client:
        response = client.post(
            api_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": os.getenv("ANALYZE_MODEL", "qwen-vl-max"),
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": _ocr_report_prompt()},
                            {"type": "image_url", "image_url": {"url": image_url}},
                        ],
                    }
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.3,
            },
        )

        if not response.is_success:
            err = response.json() if response.content else {}
            msg = err.get("error", {}).get("message") or f"DashScope API 错误: {response.status_code}"
            raise RuntimeError(msg)

        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not content:
            raise RuntimeError("OCR 返回为空")

        json_str = re.sub(r"```json", "", content)
        json_str = re.sub(r"```", "", json_str).strip()
        extracted = json.loads(json_str)

    # 写入 user_health_documents
    insert_health_document_sync(
        user_id=user_id,
        document_type="report",
        image_url=image_url,
        extracted_content=extracted,
    )

    # 更新 weapp_user.health_condition.report_extract
    user = get_user_by_id_sync(user_id)
    if user:
        hc = dict(user.get("health_condition") or {})
        hc["report_extract"] = extracted
        update_user_sync(user_id, {"health_condition": hc})

    return extracted


def process_one_health_report_task(task: Dict[str, Any]) -> None:
    """处理单条病历提取任务：执行 OCR、写库、更新用户档案。"""
    task_id = task["id"]
    try:
        extracted = run_health_report_ocr_sync(task)
        update_analysis_task_result_sync(task_id, status="done", result={"extracted_content": extracted})
    except Exception as e:
        err_msg = str(e) or type(e).__name__
        update_analysis_task_result_sync(task_id, status="failed", error_message=err_msg)


def _comment_moderation_prompt(content: str) -> str:
    """评论内容审核提示词。"""
    return f"""
你是一个内容安全审核系统。请分析以下用户评论内容，判断是否存在违规情况：

评论内容："{content}"

判断标准：
1. 包含色情、低俗、露骨内容
2. 包含暴力、恐怖、血腥描述
3. 包含违法犯罪相关内容
4. 包含政治敏感言论、地域歧视
5. 包含人身攻击、侮辱谩骂
6. 包含广告、营销、垃圾信息
7. 包含恶意灌水、无意义内容

注意：正常的食物评价（如"好吃"、"推荐"、"味道不错"）不算违规。
只有明确违反上述规则的内容才判定为违规。

请严格按以下 JSON 格式返回，不要包含任何其他文本：
如果不违规：{{"is_violation": false}}
如果违规：{{"is_violation": true, "category": "分类值", "reason": "简要中文原因"}}

category 可选值：pornography, violence, crime, politics, harassment, spam, inappropriate_text, other
""".strip()


def run_comment_moderation_sync(content: str) -> Optional[Dict[str, Any]]:
    """
    对评论内容进行 AI 审核。
    返回审核结果 dict：
      - {"is_violation": False} 表示通过
      - {"is_violation": True, "category": "...", "reason": "..."} 表示违规
    审核失败时返回 None（不阻塞评论流程）。
    """
    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        print("[comment_moderation] 缺少 API_KEY，跳过审核")
        return None

    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_url = f"{base_url}/chat/completions"

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.post(
                api_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "qwen-plus",
                    "messages": [{"role": "user", "content": _comment_moderation_prompt(content)}],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.1,
                },
            )

        if not response.is_success:
            print(f"[comment_moderation] API 请求失败: {response.status_code}")
            return None

        data = response.json()
        raw = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not raw:
            print("[comment_moderation] AI 返回空响应")
            return None

        json_str = re.sub(r"```json", "", raw)
        json_str = re.sub(r"```", "", json_str).strip()
        result = json.loads(json_str)
        print(f"[comment_moderation] 审核结果: {result}")
        return result

    except Exception as e:
        # 审核出错不应阻塞评论流程，仅打印日志
        print(f"[comment_moderation] 审核异常（不阻塞评论）: {e}")
        return None


def process_one_comment_task(task: Dict[str, Any]) -> None:
    """处理单条评论审核任务：先审核，通过后写入评论表。"""
    task_id = task["id"]
    user_id = task["user_id"]
    comment_type = task["comment_type"]
    target_id = task["target_id"]
    content = task["content"]
    rating = task.get("rating")
    
    try:
        # 第一步：内容审核
        moderation = run_comment_moderation_sync(content)
        if moderation and moderation.get("is_violation"):
            reason = moderation.get("reason", "评论内容违规")
            print(f"[comment_worker] 任务 {task_id} 评论违规: {reason}")
            mark_comment_task_violated_sync(task_id, reason)
            # 记录违规日志
            create_violation_record_sync(
                {
                    "id": task_id,
                    "user_id": user_id,
                    "text_input": content,
                },
                moderation,
                violation_type="comment"
            )
            return
        
        # 第二步：审核通过，写入评论表
        if comment_type == "feed":
            comment = add_feed_comment_sync(user_id, target_id, content)
        elif comment_type == "public_food_library":
            comment = add_public_food_library_comment_sync(user_id, target_id, content, rating)
        else:
            raise ValueError(f"未知的评论类型: {comment_type}")
        
        # 第三步：更新任务状态为完成
        update_comment_task_result_sync(task_id, status="done", result={"comment_id": comment["id"]})
        print(f"[comment_worker] 任务 {task_id} 完成，评论 ID: {comment['id']}")
        
    except Exception as e:
        err_msg = str(e) or type(e).__name__
        print(f"[comment_worker] 任务 {task_id} 失败: {err_msg}")
        update_comment_task_result_sync(task_id, status="failed", error_message=err_msg)


def run_comment_worker(worker_id: int, poll_interval: float = 2.0) -> None:
    """
    评论审核 Worker 进程入口：循环抢占 pending 评论任务并处理。
    """
    print(f"[comment-worker-{worker_id}] 启动，处理评论审核任务", flush=True)
    
    while True:
        try:
            task = claim_next_pending_comment_task_sync()
            if task:
                print(f"[comment-worker-{worker_id}] 处理任务 {task['id']}", flush=True)
                process_one_comment_task(task)
                print(f"[comment-worker-{worker_id}] 任务 {task['id']} 完成", flush=True)
            else:
                time.sleep(poll_interval)
        except KeyboardInterrupt:
            print(f"[comment-worker-{worker_id}] 退出", flush=True)
            break
        except Exception as e:
            print(f"[comment-worker-{worker_id}] 错误: {e}", flush=True)
            time.sleep(poll_interval)


def run_worker(worker_id: int, task_type: str = "food", poll_interval: float = 2.0) -> None:
    """
    单 Worker 进程入口：循环抢占 pending 任务并处理。
    task_type: food | food_text | health_report
    """
    print(f"[worker-{worker_id}] 启动，任务类型: {task_type}", flush=True)
    
    # 根据任务类型选择处理函数
    processor_map = {
        "food": process_one_food_task,
        "food_text": process_one_text_food_task,
        "health_report": process_one_health_report_task,
    }
    processor = processor_map.get(task_type)
    if not processor:
        raise ValueError(f"不支持的任务类型: {task_type}")
    
    while True:
        try:
            task = claim_next_pending_task_sync(task_type)
            if task:
                print(f"[worker-{worker_id}] 处理任务 {task['id']}", flush=True)
                processor(task)
                print(f"[worker-{worker_id}] 任务 {task['id']} 完成", flush=True)
            else:
                time.sleep(poll_interval)
        except KeyboardInterrupt:
            print(f"[worker-{worker_id}] 退出", flush=True)
            break
        except Exception as e:
            print(f"[worker-{worker_id}] 错误: {e}", flush=True)
            time.sleep(poll_interval)


if __name__ == "__main__":
    # 单独运行本文件时：单进程 Worker（用于调试）
    run_worker(worker_id=0, task_type="food")
