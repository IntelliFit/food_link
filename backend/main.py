from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import os
import httpx
import json
import re
import time
from datetime import timedelta, datetime, timezone
from dotenv import load_dotenv
from auth import create_access_token
from database import (
    get_user_by_openid,
    create_user,
    update_user,
    get_user_by_id,
    insert_health_document,
    insert_food_record,
    list_food_records,
    list_food_records_by_range,
    get_streak_days,
    insert_critical_samples,
    upload_health_report_image,
    upload_food_analyze_image,
    search_users,
    send_friend_request,
    get_friend_requests_received,
    respond_friend_request,
    get_friends_with_profile,
    list_friends_today_records,
    add_feed_like,
    remove_feed_like,
    get_feed_likes_for_records,
    add_feed_comment,
    list_feed_comments,
)
from middleware import get_current_user_info, get_current_user_id, get_current_openid, get_optional_user_info
from metabolic import calculate_bmr, calculate_tdee, get_age_from_birthday

# 从 .env 文件加载环境变量
load_dotenv()

app = FastAPI(title="食物分析 API", description="基于 DashScope 的食物图片分析服务")

# 缓存 access_token（有效期为 2 小时）
_access_token_cache = {
    "token": None,
    "expires_at": 0
}

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应该限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Nutrients(BaseModel):
    calories: float = 0
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    fiber: float = 0
    sugar: float = 0


class FoodItemResponse(BaseModel):
    name: str
    estimatedWeightGrams: float
    originalWeightGrams: float
    nutrients: Nutrients


class AnalyzeRequest(BaseModel):
    base64Image: Optional[str] = Field(None, description="Base64 编码的图片数据（与 image_url 二选一）")
    image_url: Optional[str] = Field(None, description="Supabase 等公网图片 URL（与 base64Image 二选一，分析时用此 URL 获取图片）")
    additionalContext: Optional[str] = Field(default="", description="用户补充的上下文信息")
    modelName: Optional[str] = Field(default="qwen-vl-max", description="使用的模型名称")
    user_goal: Optional[str] = Field(default=None, description="用户目标: muscle_gain / fat_loss / maintain，用于 PFC 评价")
    context_state: Optional[str] = Field(default=None, description="用户当前状态，用于情境建议")
    remaining_calories: Optional[float] = Field(default=None, description="当日剩余热量预算 kcal，用于建议下一餐")
    meal_type: Optional[str] = Field(default=None, description="餐次: breakfast / lunch / dinner / snack，用于结合餐次给出建议")


class AnalyzeResponse(BaseModel):
    description: str
    insight: str
    items: List[FoodItemResponse]
    pfc_ratio_comment: Optional[str] = Field(default=None, description="PFC 比例评价（蛋白质/脂肪/碳水占比）")
    absorption_notes: Optional[str] = Field(default=None, description="吸收率与生物利用度简要说明")
    context_advice: Optional[str] = Field(default=None, description="情境感知建议（结合用户状态）")


class LoginRequest(BaseModel):
    code: str = Field(..., description="微信小程序登录凭证 code")
    phoneCode: Optional[str] = Field(default=None, description="获取手机号的 code（可选）")


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # token 过期时间（秒）
    user_id: str
    openid: str
    unionid: Optional[str] = None
    phoneNumber: Optional[str] = None
    purePhoneNumber: Optional[str] = None
    countryCode: Optional[str] = None


# 活动水平中文映射（用于健康档案摘要）
ACTIVITY_LEVEL_LABELS = {
    "sedentary": "久坐",
    "light": "轻度活动",
    "moderate": "中度活动",
    "active": "高度活动",
    "very_active": "极高活动",
}


def _format_health_profile_for_analysis(user: Dict[str, Any]) -> str:
    """
    将 weapp_user 健康档案格式化为供 AI 参考的简短摘要。
    用于在食物分析时结合体质、病史、过敏等给出更全面建议。
    """
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
    if medical:
        line3 = "· 既往病史：" + "、".join(medical) if isinstance(medical, list) else "· 既往病史：" + str(medical)
    else:
        line3 = ""
    diet = hc.get("diet_preference") or []
    if diet:
        line4 = "· 饮食偏好：" + "、".join(diet) if isinstance(diet, list) else "· 饮食偏好：" + str(diet)
    else:
        line4 = ""
    allergies = hc.get("allergies") or []
    if allergies:
        line5 = "· 过敏/忌口：" + "、".join(allergies) if isinstance(allergies, list) else "· 过敏/忌口：" + str(allergies)
    else:
        line5 = ""
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


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze_food(
    request: AnalyzeRequest,
    user_info: Optional[dict] = Depends(get_optional_user_info),
):
    """
    分析食物图片，返回营养成分和健康建议

    - **base64Image**: Base64 编码的图片数据（必需）
    - **additionalContext**: 用户补充的上下文信息（可选）
    - **modelName**: 使用的模型名称（默认: qwen-vl-max）
    - 若请求头带有效 Authorization，将结合该用户的健康档案给出更贴合体质与健康状况的建议。
    """
    try:
        # 获取 API Key
        api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=500,
                detail="缺少 DASHSCOPE_API_KEY（或 API_KEY）环境变量"
            )

        if not request.base64Image and not request.image_url:
            raise HTTPException(
                status_code=400,
                detail="请提供 base64Image 或 image_url 之一"
            )
        if request.base64Image and request.image_url:
            raise HTTPException(
                status_code=400,
                detail="base64Image 与 image_url 只能传其一"
            )

        # 构建 API URL
        base_url = os.getenv(
            "DASHSCOPE_BASE_URL",
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
        )
        api_url = f"{base_url}/chat/completions"

        goal_hint = ""
        if request.user_goal:
            goal_map = {"muscle_gain": "增肌", "fat_loss": "减脂", "maintain": "维持体重"}
            goal_hint = f"\n用户目标为「{goal_map.get(request.user_goal, request.user_goal)}」，请在 pfc_ratio_comment 中评价本餐 P/C/F 占比是否适合该目标。"
        state_hint = f"\n用户当前状态: {request.context_state}，请在 context_advice 中给出针对性进食建议（如补剂、搭配）。" if request.context_state else ""
        remain_hint = f"\n用户当日剩余热量预算约 {request.remaining_calories} kcal，可在 context_advice 中提示本餐占比或下一餐建议。" if request.remaining_calories is not None else ""
        meal_hint = ""
        if request.meal_type:
            meal_map = {"breakfast": "早餐", "lunch": "午餐", "dinner": "晚餐", "snack": "加餐"}
            meal_name = meal_map.get(request.meal_type, request.meal_type)
            meal_hint = f"\n用户选择的是「{meal_name}」，请结合餐次特点在 insight 或 context_advice 中给出建议（如早餐适合碳水与蛋白搭配、晚餐宜清淡等）。"

        # 若已登录，拉取健康档案并注入 prompt
        profile_block = ""
        if user_info:
            user = await get_user_by_id(user_info["user_id"])
            if user:
                profile_block = _format_health_profile_for_analysis(user)
                if profile_block:
                    profile_block = (
                        "\n\n若以下存在「用户健康档案」，请结合档案在 insight、absorption_notes、context_advice 中给出更贴合该用户体质与健康状况的建议（如控糖、低嘌呤、过敏规避等）。\n\n"
                        + profile_block
                    )

        # 构建提示词
        prompt = f"""
请作为专业的营养师分析这张食物图片。
1. 识别图中所有不同的食物单品。
2. 估算每种食物的重量（克）和详细营养成分。
3. description: 提供这顿饭的简短中文描述。
4. insight: 基于该餐营养成分的一句话健康建议。{meal_hint}
5. pfc_ratio_comment: 本餐蛋白质(P)、脂肪(F)、碳水(C) 占比的简要评价（是否均衡、适合增肌/减脂/维持）。{goal_hint}
6. absorption_notes: 食物组合或烹饪方式对吸收率、生物利用度的简要说明（如维生素C促铁吸收、油脂助脂溶性维生素等，一两句话）。
7. context_advice: 结合用户状态或剩余热量的情境建议（若无则可为空字符串）。{state_hint}{remain_hint}{profile_block}

{('用户补充背景信息: "' + request.additionalContext + '"。请根据此信息调整对隐形成分或烹饪方式的判断。') if request.additionalContext else ''}

重要：请务必使用**简体中文**返回所有文本内容。
请严格按照以下 JSON 格式返回，不要包含任何其他文本：

{{
  "items": [
    {{
      "name": "食物名称（简体中文）",
      "estimatedWeightGrams": 重量（数字）,
      "nutrients": {{
        "calories": 热量,
        "protein": 蛋白质,
        "carbs": 碳水,
        "fat": 脂肪,
        "fiber": 纤维,
        "sugar": 糖分
      }}
    }}
  ],
  "description": "餐食描述（简体中文）",
  "insight": "健康建议（简体中文）",
  "pfc_ratio_comment": "PFC 比例评价（简体中文，一两句话）",
  "absorption_notes": "吸收率/生物利用度说明（简体中文，一两句话）",
  "context_advice": "情境建议（简体中文，若无则空字符串）"
}}
""".strip()

        # 图片入参：优先使用 image_url（Supabase 公网 URL），否则使用 base64
        if request.image_url:
            image_url_for_api = request.image_url
        else:
            image_data = (
                request.base64Image.split(",")[1]
                if "," in request.base64Image
                else request.base64Image
            )
            image_url_for_api = f"data:image/jpeg;base64,{image_data}"

        # 调用 DashScope API
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                api_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": request.modelName,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": prompt
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": image_url_for_api
                                    }
                                }
                            ]
                        }
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.7,
                }
            )

            if not response.is_success:
                error_data = response.json() if response.content else {}
                error_message = (
                    error_data.get("error", {}).get("message")
                    or f"DashScope API 错误: {response.status_code}"
                )
                raise HTTPException(
                    status_code=500,
                    detail=error_message
                )

            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content")

            if not content:
                raise HTTPException(
                    status_code=500,
                    detail="AI 返回了空响应，请检查图片或稍后重试。"
                )

            # 清理可能的 markdown 代码块标记
            json_str = re.sub(r"```json", "", content)
            json_str = re.sub(r"```", "", json_str)
            json_str = json_str.strip()

            # 解析 JSON
            try:
                parsed = json.loads(json_str)
            except json.JSONDecodeError:
                raise HTTPException(
                    status_code=500,
                    detail="AI 数据解析失败，请重试。"
                )

            # 验证和转换 items
            valid_items = []
            if isinstance(parsed.get("items"), list):
                for item in parsed["items"]:
                    nutrients = Nutrients(
                        calories=float(item.get("nutrients", {}).get("calories", 0) or 0),
                        protein=float(item.get("nutrients", {}).get("protein", 0) or 0),
                        carbs=float(item.get("nutrients", {}).get("carbs", 0) or 0),
                        fat=float(item.get("nutrients", {}).get("fat", 0) or 0),
                        fiber=float(item.get("nutrients", {}).get("fiber", 0) or 0),
                        sugar=float(item.get("nutrients", {}).get("sugar", 0) or 0),
                    )
                    weight = float(item.get("estimatedWeightGrams", 0) or 0)
                    valid_items.append(
                        FoodItemResponse(
                            name=str(item.get("name", "未知食物")),
                            estimatedWeightGrams=weight,
                            originalWeightGrams=weight,
                            nutrients=nutrients,
                        )
                    )

            def _opt_str(v):
                if v is None or v == "":
                    return None
                s = str(v).strip()
                return s if s else None

            return AnalyzeResponse(
                description=str(parsed.get("description", "无法获取描述")),
                insight=str(parsed.get("insight", "保持健康饮食！")),
                items=valid_items,
                pfc_ratio_comment=_opt_str(parsed.get("pfc_ratio_comment")),
                absorption_notes=_opt_str(parsed.get("absorption_notes")),
                context_advice=_opt_str(parsed.get("context_advice")),
            )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/analyze] error: {e}")
        raise HTTPException(
            status_code=500,
            detail=str(e) or "连接 AI 服务失败"
        )


class UploadAnalyzeImageRequest(BaseModel):
    """食物分析前上传图片，返回 Supabase 公网 URL"""
    base64Image: str = Field(..., description="Base64 编码的图片数据")


@app.post("/api/upload-analyze-image")
async def upload_analyze_image(body: UploadAnalyzeImageRequest):
    """
    食物分析前先上传图片到 Supabase，返回公网 URL。
    前端拿到 URL 后传给 /api/analyze 的 image_url，分析及标记样本时均使用该 URL。
    """
    if not body.base64Image:
        raise HTTPException(status_code=400, detail="base64Image 不能为空")
    try:
        image_url = upload_food_analyze_image(body.base64Image)
        return {"imageUrl": image_url}
    except Exception as e:
        print(f"[upload_analyze_image] 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e) or "上传图片失败")


class AnalyzeTextRequest(BaseModel):
    """文字描述食物，请求营养成分分析"""
    text: str = Field(..., description="用户描述的食物内容，如：一碗米饭、一个苹果、200g 鸡胸肉")
    user_goal: Optional[str] = Field(default=None, description="用户目标: muscle_gain / fat_loss / maintain")
    context_state: Optional[str] = Field(default=None, description="用户当前状态")
    remaining_calories: Optional[float] = Field(default=None, description="当日剩余热量预算 kcal")


@app.post("/api/analyze-text", response_model=AnalyzeResponse)
async def analyze_food_text(
    request: AnalyzeTextRequest,
    user_info: Optional[dict] = Depends(get_optional_user_info),
):
    """
    根据用户文字描述分析食物营养成分，返回与 /api/analyze 相同结构（description, insight, items）。
    若请求头带有效 Authorization，将结合该用户的健康档案给出更贴合体质与健康状况的建议。
    """
    try:
        api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=500,
                detail="缺少 DASHSCOPE_API_KEY（或 API_KEY）环境变量"
            )
        if not (request.text or request.text.strip()):
            raise HTTPException(status_code=400, detail="text 不能为空")

        base_url = os.getenv(
            "DASHSCOPE_BASE_URL",
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
        )
        api_url = f"{base_url}/chat/completions"
        goal_hint = ""
        if request.user_goal:
            goal_map = {"muscle_gain": "增肌", "fat_loss": "减脂", "maintain": "维持体重"}
            goal_hint = f" 用户目标为「{goal_map.get(request.user_goal, request.user_goal)}」，请在 pfc_ratio_comment 中评价 P/C/F 占比是否适合。"
        state_hint = f" 用户当前状态: {request.context_state}，请在 context_advice 中给出针对性建议。" if request.context_state else ""
        remain_hint = f" 当日剩余热量预算约 {request.remaining_calories} kcal，可在 context_advice 中提示。" if request.remaining_calories is not None else ""

        # 若已登录，拉取健康档案并注入 prompt
        profile_block = ""
        if user_info:
            user = await get_user_by_id(user_info["user_id"])
            if user:
                profile_block = _format_health_profile_for_analysis(user)
                if profile_block:
                    profile_block = (
                        " 若以下存在「用户健康档案」，请结合档案在 insight、absorption_notes、context_advice 中给出更贴合该用户体质与健康状况的建议（如控糖、低嘌呤、过敏规避等）。\n\n"
                        + profile_block
                    )

        prompt = f"""
请作为专业营养师，根据用户对食物的**文字描述**，分析营养成分。
用户描述内容：
"""
        prompt += f'"{request.text.strip()}"\n\n'
        prompt += f"""请完成：
1. 从描述中识别出所有食物单品（若有多项请分别列出）。
2. 估算每种食物的重量（克）和详细营养成分（热量、蛋白质、碳水、脂肪、纤维、糖分）。
3. description: 用一句简短中文概括这餐/这些食物。
4. insight: 用一句话给出健康建议。
5. pfc_ratio_comment: 本餐 P/F/C 占比的简要评价（是否均衡、适合增肌/减脂/维持）。{goal_hint}
6. absorption_notes: 食物组合或烹饪对吸收率、生物利用度的简要说明（一两句话）。
7. context_advice: 结合用户状态或剩余热量的情境建议（若无则空字符串）。{state_hint}{remain_hint}{profile_block}

重要：请务必使用**简体中文**返回所有文本。
请**严格按照**以下 JSON 格式返回，不要包含任何其他文字：

{{
  "items": [
    {{
      "name": "食物名称（简体中文）",
      "estimatedWeightGrams": 重量数字,
      "nutrients": {{
        "calories": 热量数字,
        "protein": 蛋白质数字,
        "carbs": 碳水数字,
        "fat": 脂肪数字,
        "fiber": 纤维数字,
        "sugar": 糖分数字
      }}
    }}
  ],
  "description": "餐食描述（简体中文）",
  "insight": "健康建议（简体中文）",
  "pfc_ratio_comment": "PFC 比例评价（简体中文，一两句话）",
  "absorption_notes": "吸收率/生物利用度说明（简体中文，一两句话）",
  "context_advice": "情境建议（简体中文，若无则空字符串）"
}}
""".strip()

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                api_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "qwen-turbo",
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.5,
                },
            )
            if not response.is_success:
                error_data = response.json() if response.content else {}
                error_message = (
                    error_data.get("error", {}).get("message")
                    or f"API 错误: {response.status_code}"
                )
                raise HTTPException(status_code=500, detail=error_message)

            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content")
            if not content:
                raise HTTPException(
                    status_code=500,
                    detail="AI 返回了空响应，请稍后重试。"
                )

            json_str = re.sub(r"```json", "", content)
            json_str = re.sub(r"```", "", json_str)
            json_str = json_str.strip()
            try:
                parsed = json.loads(json_str)
            except json.JSONDecodeError:
                raise HTTPException(
                    status_code=500,
                    detail="AI 数据解析失败，请重试。"
                )

            valid_items = []
            if isinstance(parsed.get("items"), list):
                for item in parsed["items"]:
                    nutrients = Nutrients(
                        calories=float(item.get("nutrients", {}).get("calories", 0) or 0),
                        protein=float(item.get("nutrients", {}).get("protein", 0) or 0),
                        carbs=float(item.get("nutrients", {}).get("carbs", 0) or 0),
                        fat=float(item.get("nutrients", {}).get("fat", 0) or 0),
                        fiber=float(item.get("nutrients", {}).get("fiber", 0) or 0),
                        sugar=float(item.get("nutrients", {}).get("sugar", 0) or 0),
                    )
                    weight = float(item.get("estimatedWeightGrams", 0) or 0)
                    valid_items.append(
                        FoodItemResponse(
                            name=str(item.get("name", "未知食物")),
                            estimatedWeightGrams=weight,
                            originalWeightGrams=weight,
                            nutrients=nutrients,
                        )
                    )

            def _opt_str(v):
                if v is None or v == "":
                    return None
                s = str(v).strip()
                return s if s else None

            return AnalyzeResponse(
                description=str(parsed.get("description", "无法获取描述")),
                insight=str(parsed.get("insight", "保持健康饮食！")),
                items=valid_items,
                pfc_ratio_comment=_opt_str(parsed.get("pfc_ratio_comment")),
                absorption_notes=_opt_str(parsed.get("absorption_notes")),
                context_advice=_opt_str(parsed.get("context_advice")),
            )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/analyze-text] error: {e}")
        raise HTTPException(
            status_code=500,
            detail=str(e) or "连接 AI 服务失败"
        )


@app.get("/api")
async def root():
    """健康检查端点"""
    return {"message": "食物分析 API 服务运行中", "status": "ok"}


@app.get("/api/health")
async def health():
    """健康检查端点"""
    return {"status": "healthy"}


class UpdateUserInfoRequest(BaseModel):
    nickname: Optional[str] = None
    avatar: Optional[str] = None
    telephone: Optional[str] = None


# ---------- 健康档案 (Professional Onboarding) ----------
class HealthProfileUpdateRequest(BaseModel):
    """首次/更新健康档案问卷"""
    gender: Optional[str] = Field(None, description="性别: male / female")
    birthday: Optional[str] = Field(None, description="出生日期 YYYY-MM-DD")
    height: Optional[float] = Field(None, ge=50, le=250, description="身高 cm")
    weight: Optional[float] = Field(None, ge=20, le=300, description="体重 kg")
    activity_level: Optional[str] = Field(
        None,
        description="活动水平: sedentary / light / moderate / active / very_active"
    )
    medical_history: Optional[List[str]] = Field(
        default_factory=list,
        description="既往病史：如 diabetes, hypertension, gout 等"
    )
    diet_preference: Optional[List[str]] = Field(
        default_factory=list,
        description="特殊饮食：如 keto, vegetarian, vegan 等"
    )
    allergies: Optional[List[str]] = Field(default_factory=list, description="过敏源")
    report_extract: Optional[Dict[str, Any]] = Field(
        None,
        description="体检报告 OCR 识别结果（保存时一并写入 user_health_documents）"
    )
    report_image_url: Optional[str] = Field(
        None,
        description="体检报告图片在 Supabase Storage 的 URL（保存时写入 user_health_documents.image_url）"
    )


class HealthReportOcrRequest(BaseModel):
    """健康报告/体检报告 OCR 识别请求：传 imageUrl（推荐）或 base64Image"""
    base64Image: Optional[str] = Field(None, description="Base64 编码的体检报告或病例截图")
    imageUrl: Optional[str] = Field(None, description="已上传到 Supabase Storage 的图片公网 URL，供多模态模型识别")


@app.get("/api/user/profile")
async def get_user_profile(
    user_info: dict = Depends(get_current_user_info)
):
    """
    获取当前用户信息（需要认证）
    """
    user_id = user_info["user_id"]
    openid = user_info["openid"]
    
    # 从数据库获取完整用户信息
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    # 健康档案字段（若表已扩展则返回）
    health = {
        "height": user.get("height"),
        "weight": user.get("weight"),
        "birthday": user.get("birthday"),
        "gender": user.get("gender"),
        "activity_level": user.get("activity_level"),
        "health_condition": user.get("health_condition") or {},
        "bmr": float(user["bmr"]) if user.get("bmr") is not None else None,
        "tdee": float(user["tdee"]) if user.get("tdee") is not None else None,
        "onboarding_completed": bool(user.get("onboarding_completed")),
    }
    return {
        "id": user["id"],
        "openid": user["openid"],
        "unionid": user.get("unionid"),
        "nickname": user.get("nickname", ""),
        "avatar": user.get("avatar", ""),
        "telephone": user.get("telephone"),
        "create_time": user.get("create_time"),
        "update_time": user.get("update_time"),
        **health,
    }


@app.put("/api/user/profile")
async def update_user_profile(
    update_data: UpdateUserInfoRequest,
    user_info: dict = Depends(get_current_user_info)
):
    """
    更新当前用户信息（需要认证）
    """
    user_id = user_info["user_id"]
    
    # 构建更新数据（只包含非空字段）
    update_dict = {}
    if update_data.nickname is not None:
        update_dict["nickname"] = update_data.nickname
    if update_data.avatar is not None:
        update_dict["avatar"] = update_data.avatar
    if update_data.telephone is not None:
        update_dict["telephone"] = update_data.telephone
    
    if not update_dict:
        raise HTTPException(status_code=400, detail="没有要更新的字段")
    
    # 更新用户信息
    try:
        updated_user = await update_user(user_id, update_dict)
        return {
            "id": updated_user["id"],
            "openid": updated_user["openid"],
            "unionid": updated_user.get("unionid"),
            "nickname": updated_user.get("nickname", ""),
            "avatar": updated_user.get("avatar", ""),
            "telephone": updated_user.get("telephone"),
            "create_time": updated_user.get("create_time"),
            "update_time": updated_user.get("update_time")
        }
    except Exception as e:
        print(f"[update_user_profile] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"更新用户信息失败: {str(e)}")


# ---------- 健康档案 API ----------
@app.get("/api/user/health-profile")
async def get_health_profile(user_info: dict = Depends(get_current_user_info)):
    """获取当前用户健康档案（需认证）"""
    user_id = user_info["user_id"]
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {
        "height": user.get("height"),
        "weight": user.get("weight"),
        "birthday": user.get("birthday"),
        "gender": user.get("gender"),
        "activity_level": user.get("activity_level"),
        "health_condition": user.get("health_condition") or {},
        "bmr": float(user["bmr"]) if user.get("bmr") is not None else None,
        "tdee": float(user["tdee"]) if user.get("tdee") is not None else None,
        "onboarding_completed": bool(user.get("onboarding_completed")),
    }


@app.put("/api/user/health-profile")
async def update_health_profile(
    body: HealthProfileUpdateRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    提交/更新健康档案问卷。后端根据性别、年龄、身高、体重、活动水平自动计算 BMR 与 TDEE。
    """
    user_id = user_info["user_id"]
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    update_dict = {}
    if body.gender is not None:
        update_dict["gender"] = body.gender
    if body.birthday is not None:
        update_dict["birthday"] = body.birthday
    if body.height is not None:
        update_dict["height"] = body.height
    if body.weight is not None:
        update_dict["weight"] = body.weight
    if body.activity_level is not None:
        update_dict["activity_level"] = body.activity_level

    health_condition = dict(user.get("health_condition") or {})
    if body.medical_history is not None:
        health_condition["medical_history"] = body.medical_history
    if body.diet_preference is not None:
        health_condition["diet_preference"] = body.diet_preference
    if body.allergies is not None:
        health_condition["allergies"] = body.allergies
    # 若有体检报告 OCR 结果，一并写入 user_health_documents（含 image_url 与识别结果）
    if body.report_extract:
        try:
            await insert_health_document(
                user_id=user_id,
                document_type="report",
                image_url=body.report_image_url,
                extracted_content=body.report_extract,
            )
            health_condition["report_extract"] = body.report_extract
        except Exception as e:
            print(f"[update_health_profile] 写入体检报告失败: {e}")
    update_dict["health_condition"] = health_condition

    # 计算 BMR / TDEE（需具备性别、身高、体重、年龄、活动水平）
    gender = update_dict.get("gender") or user.get("gender")
    height = update_dict.get("height") if "height" in update_dict else user.get("height")
    weight = update_dict.get("weight") if "weight" in update_dict else user.get("weight")
    birthday = update_dict.get("birthday") if "birthday" in update_dict else user.get("birthday")
    activity_level = update_dict.get("activity_level") or user.get("activity_level") or "sedentary"

    age = get_age_from_birthday(birthday) if birthday else None
    if gender and height is not None and weight is not None and age is not None:
        bmr = calculate_bmr(
            "male" if gender == "male" else "female",
            float(weight),
            float(height),
            age,
        )
        tdee = calculate_tdee(bmr, activity_level or "sedentary")
        update_dict["bmr"] = bmr
        update_dict["tdee"] = tdee

    update_dict["onboarding_completed"] = True

    if not update_dict:
        raise HTTPException(status_code=400, detail="没有要更新的字段")

    # 确保 health_condition 为可序列化 dict（Supabase jsonb）
    if "health_condition" in update_dict and isinstance(update_dict["health_condition"], dict):
        update_dict["health_condition"] = dict(update_dict["health_condition"])

    print(f"[update_health_profile] user_id={user_id}, update_dict keys={list(update_dict.keys())}")

    try:
        updated = await update_user(user_id, update_dict)
        # 二次查询验证：从数据库重新读一次，确认是否真正持久化
        verify = await get_user_by_id(user_id)
        verify_height = verify.get("height") if verify else None
        verify_bmr = verify.get("bmr") if verify else None
        print(
            f"[update_health_profile] 返回行 height={updated.get('height')}, bmr={updated.get('bmr')} | "
            f"验证查询 height={verify_height}, bmr={verify_bmr} | "
            f"Supabase={os.getenv('SUPABASE_URL', '')[:50]}..."
        )
        if verify and verify_height is None and updated.get("height") is not None:
            print("[update_health_profile] 警告: 更新返回有值但验证查询无值，可能未持久化或连接了不同项目，请核对 SUPABASE_URL 与 Dashboard 是否一致")
        return {
            "height": updated.get("height"),
            "weight": updated.get("weight"),
            "birthday": updated.get("birthday"),
            "gender": updated.get("gender"),
            "activity_level": updated.get("activity_level"),
            "health_condition": updated.get("health_condition") or {},
            "bmr": float(updated["bmr"]) if updated.get("bmr") is not None else None,
            "tdee": float(updated["tdee"]) if updated.get("tdee") is not None else None,
            "onboarding_completed": bool(updated.get("onboarding_completed")),
        }
    except Exception as e:
        err_msg = str(e).lower()
        print(f"[update_health_profile] 错误: {e}")
        if "column" in err_msg and ("does not exist" in err_msg or "不存在" in err_msg):
            raise HTTPException(
                status_code=500,
                detail="数据库表未扩展健康档案字段。请在 Supabase SQL Editor 中执行 backend/database/user_health_profile.sql 迁移脚本。"
            )
        raise HTTPException(status_code=500, detail=f"更新健康档案失败: {str(e)}")


def _ocr_report_prompt() -> str:
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


async def _ocr_extract_report_image(base64_image: str) -> Dict[str, Any]:
    """体检报告 OCR：使用 base64 图片，仅返回提取的 JSON，不写库。"""
    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="缺少 DASHSCOPE_API_KEY 环境变量")
    image_data = base64_image.split(",")[1] if "," in base64_image else base64_image
    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_url = f"{base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            api_url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": os.getenv("ANALYZE_MODEL", "qwen-vl-max"),
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": _ocr_report_prompt()},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_data}"}},
                        ],
                    }
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.3,
            },
        )
    if not response.is_success:
        raise HTTPException(status_code=500, detail="OCR 识别服务请求失败")
    data = response.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content")
    if not content:
        raise HTTPException(status_code=500, detail="OCR 返回为空")
    json_str = re.sub(r"```json", "", content)
    json_str = re.sub(r"```", "", json_str).strip()
    return json.loads(json_str)


async def _ocr_extract_report_by_url(image_url: str) -> Dict[str, Any]:
    """体检报告 OCR：使用图片公网 URL 传给多模态模型，仅返回提取的 JSON，不写库。"""
    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="缺少 DASHSCOPE_API_KEY 环境变量")
    base_url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    api_url = f"{base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            api_url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
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
        raise HTTPException(status_code=500, detail="OCR 识别服务请求失败")
    data = response.json()
    content = data.get("choices", [{}])[0].get("message", {}).get("content")
    if not content:
        raise HTTPException(status_code=500, detail="OCR 返回为空")
    json_str = re.sub(r"```json", "", content)
    json_str = re.sub(r"```", "", json_str).strip()
    return json.loads(json_str)


class UploadReportImageRequest(BaseModel):
    """上传体检报告图片到 Supabase Storage"""
    base64Image: str = Field(..., description="Base64 编码的体检报告或病例截图")


@app.post("/api/user/health-profile/upload-report-image")
async def upload_report_image(
    body: UploadReportImageRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    将体检报告图片上传到 Supabase Storage，返回公网 URL。
    小程序先调此接口拿 imageUrl，再调 ocr-extract 传 imageUrl 给多模态模型识别。
    """
    user_id = user_info["user_id"]
    if not body.base64Image:
        raise HTTPException(status_code=400, detail="base64Image 不能为空")
    try:
        image_url = upload_health_report_image(user_id, body.base64Image)
        return {"imageUrl": image_url}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[upload_report_image] 错误: {e}")
        raise HTTPException(status_code=500, detail="上传失败，请检查 Supabase Storage 是否已创建 bucket「health-reports」并设为 Public")


@app.post("/api/user/health-profile/ocr-extract")
async def health_report_ocr_extract(
    body: HealthReportOcrRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    仅识别体检报告/病例截图，返回提取的 JSON，不写入数据库。
    推荐先调 upload-report-image 拿到 imageUrl，再传 imageUrl 给本接口；也可直接传 base64Image。
    """
    if body.imageUrl:
        try:
            extracted = await _ocr_extract_report_by_url(body.imageUrl)
            return {"extracted": extracted}
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="OCR 返回格式解析失败")
        except HTTPException:
            raise
        except Exception as e:
            print(f"[health_report_ocr_extract] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    if body.base64Image:
        try:
            extracted = await _ocr_extract_report_image(body.base64Image)
            return {"extracted": extracted}
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="OCR 返回格式解析失败")
        except HTTPException:
            raise
        except Exception as e:
            print(f"[health_report_ocr_extract] 错误: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    raise HTTPException(status_code=400, detail="请传 imageUrl 或 base64Image")


@app.post("/api/user/health-profile/ocr")
async def health_report_ocr(
    body: HealthReportOcrRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    上传体检报告/病例截图，OCR 识别并写入 user_health_documents。
    """
    user_id = user_info["user_id"]
    if not body.base64Image:
        raise HTTPException(status_code=400, detail="base64Image 不能为空")
    try:
        extracted = await _ocr_extract_report_image(body.base64Image)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[health_report_ocr] 错误: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    try:
        await insert_health_document(
            user_id=user_id,
            document_type="report",
            image_url=None,
            extracted_content=extracted,
        )
    except Exception as e:
        print(f"[health_report_ocr] 写入文档表失败: {e}")
    return {"extracted": extracted, "message": "识别完成，已保存到健康档案"}


# ---------- 饮食记录（拍照识别后确认记录） ----------


class FoodRecordItemNutrients(BaseModel):
    calories: float = 0
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    fiber: float = 0
    sugar: float = 0


class FoodRecordItem(BaseModel):
    name: str = ""
    weight: float = 0  # 估算重量 g
    ratio: float = 100  # 摄入比例 %
    intake: float = 0  # 实际摄入 g
    nutrients: FoodRecordItemNutrients = Field(default_factory=FoodRecordItemNutrients)


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


@app.post("/api/critical-samples")
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


class SaveFoodRecordRequest(BaseModel):
    meal_type: str = Field(..., description="餐次: breakfast / lunch / dinner / snack")
    image_path: Optional[str] = Field(default=None, description="图片路径或 URL（可选）")
    description: Optional[str] = Field(default=None, description="AI 餐食描述")
    insight: Optional[str] = Field(default=None, description="AI 健康建议")
    items: List[FoodRecordItem] = Field(default_factory=list, description="食物项列表")
    total_calories: float = Field(0, description="总热量 kcal")
    total_protein: float = Field(0, description="总蛋白质 g")
    total_carbs: float = Field(0, description="总碳水 g")
    total_fat: float = Field(0, description="总脂肪 g")
    total_weight_grams: int = Field(0, description="总预估重量 g")
    context_state: Optional[str] = Field(default=None, description="用户当前状态（提交时选择）")
    pfc_ratio_comment: Optional[str] = Field(default=None, description="PFC 比例评价")
    absorption_notes: Optional[str] = Field(default=None, description="吸收率说明")
    context_advice: Optional[str] = Field(default=None, description="情境建议")


@app.post("/api/food-record/save")
async def save_food_record(
    body: SaveFoodRecordRequest,
    user_info: dict = Depends(get_current_user_info),
):
    """
    拍照识别完成后确认记录：选择餐次（早餐/午餐/晚餐/加餐）后保存到 user_food_records。
    """
    user_id = user_info["user_id"]
    if body.meal_type not in ("breakfast", "lunch", "dinner", "snack"):
        raise HTTPException(status_code=400, detail="meal_type 必须为 breakfast / lunch / dinner / snack")
    items_payload = [
        {
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
        for item in body.items
    ]
    try:
        row = await insert_food_record(
            user_id=user_id,
            meal_type=body.meal_type,
            image_path=body.image_path,
            description=body.description or "",
            insight=body.insight or "",
            items=items_payload,
            total_calories=body.total_calories,
            total_protein=body.total_protein,
            total_carbs=body.total_carbs,
            total_fat=body.total_fat,
            total_weight_grams=body.total_weight_grams,
            context_state=body.context_state,
            pfc_ratio_comment=body.pfc_ratio_comment,
            absorption_notes=body.absorption_notes,
            context_advice=body.context_advice,
        )
        return {"id": row.get("id"), "message": "记录成功"}
    except Exception as e:
        print(f"[save_food_record] 错误: {e}")
        raise HTTPException(status_code=500, detail="保存记录失败")


@app.get("/api/food-record/list")
async def get_food_record_list(
    date: Optional[str] = None,
    user_info: dict = Depends(get_current_user_info),
):
    """
    获取当前用户饮食记录列表。可选按日期筛选（date=YYYY-MM-DD），不传则返回最近记录。
    """
    user_id = user_info["user_id"]
    try:
        records = await list_food_records(user_id=user_id, date=date, limit=100)
        return {"records": records}
    except Exception as e:
        print(f"[get_food_record_list] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取记录失败")


# ---------- 首页仪表盘（今日摄入 + 今日餐食，不含运动） ----------

# 各餐次默认目标热量（kcal），可与 TDEE 联动
MEAL_TARGETS = {"breakfast": 500, "lunch": 800, "dinner": 700, "snack": 200}
MEAL_NAMES = {"breakfast": "早餐", "lunch": "午餐", "dinner": "晚餐", "snack": "加餐"}


@app.get("/api/home/dashboard")
async def get_home_dashboard(user_info: dict = Depends(get_current_user_info)):
    """
    首页数据：今日摄入汇总 + 今日各餐次汇总。目标热量优先用用户 TDEE，否则 2000。
    运动数据不返回，由前端静态展示或后续接口提供。
    """
    user_id = user_info["user_id"]
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        user = await get_user_by_id(user_id)
        tdee = (user.get("tdee") and float(user["tdee"])) or 2000
        records = await list_food_records(user_id=user_id, date=today, limit=100)
    except Exception as e:
        print(f"[get_home_dashboard] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取首页数据失败")

    # 今日总摄入
    total_cal = sum(float(r.get("total_calories") or 0) for r in records)
    total_protein = sum(float(r.get("total_protein") or 0) for r in records)
    total_carbs = sum(float(r.get("total_carbs") or 0) for r in records)
    total_fat = sum(float(r.get("total_fat") or 0) for r in records)

    # 宏量目标（可后续按 TDEE 比例算，此处用常用默认）
    protein_target = 120
    carbs_target = 250
    fat_target = 65
    progress = (total_cal / tdee * 100) if tdee else 0
    progress = min(100.0, round(progress, 1))

    intake_data = {
        "current": round(total_cal, 1),
        "target": int(tdee),
        "progress": progress,
        "macros": {
            "protein": {"current": round(total_protein, 1), "target": protein_target},
            "carbs": {"current": round(total_carbs, 1), "target": carbs_target},
            "fat": {"current": round(total_fat, 1), "target": fat_target},
        },
    }

    # 按餐次聚合今日记录
    by_meal: Dict[str, List[dict]] = {}
    for r in records:
        mt = r.get("meal_type") or "snack"
        if mt not in by_meal:
            by_meal[mt] = []
        by_meal[mt].append(r)

    meals_out = []
    for meal_type in ("breakfast", "lunch", "dinner", "snack"):
        if meal_type not in by_meal:
            continue
        items = by_meal[meal_type]
        meal_cal = sum(float(x.get("total_calories") or 0) for x in items)
        meal_target = MEAL_TARGETS.get(meal_type, 200)
        meal_progress = (meal_cal / meal_target * 100) if meal_target else 0
        meal_progress = min(100.0, round(meal_progress, 1))
        # 取该餐次最早一条记录的时间作为展示时间
        times = [x.get("record_time") for x in items if x.get("record_time")]
        time_str = "00:00"
        if times:
            try:
                dt = times[0] if isinstance(times[0], str) else str(times[0])
                time_str = dt[:16].replace("T", " ").split(" ")[-1][:5]
            except Exception:
                pass
        meals_out.append({
            "type": meal_type,
            "name": MEAL_NAMES.get(meal_type, meal_type),
            "time": time_str,
            "calorie": round(meal_cal, 1),
            "target": meal_target,
            "progress": meal_progress,
            "tags": [],
        })

    return {"intakeData": intake_data, "meals": meals_out}


# ---------- 数据统计（周/月摄入、TDEE、连续天数、饮食结构） ----------

@app.get("/api/stats/summary")
async def get_stats_summary(
    range: str = "week",
    user_info: dict = Depends(get_current_user_info),
):
    """
    数据统计：按周(week)或月(month)汇总摄入、与 TDEE 对比、连续记录天数、饮食结构（按餐次与宏量），并给出简单分析。
    """
    if range not in ("week", "month"):
        range = "week"
    user_id = user_info["user_id"]
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    if range == "week":
        start_d = (now - timedelta(days=6)).date()
    else:
        start_d = (now - timedelta(days=29)).date()
    start_date = start_d.strftime("%Y-%m-%d")
    end_date = today
    try:
        user = await get_user_by_id(user_id)
        tdee = (user.get("tdee") and float(user["tdee"])) or 2000
        records = await list_food_records_by_range(user_id=user_id, start_date=start_date, end_date=end_date)
        streak_days = await get_streak_days(user_id)
    except Exception as e:
        print(f"[get_stats_summary] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取统计失败")

    total_cal = sum(float(r.get("total_calories") or 0) for r in records)
    total_protein = sum(float(r.get("total_protein") or 0) for r in records)
    total_carbs = sum(float(r.get("total_carbs") or 0) for r in records)
    total_fat = sum(float(r.get("total_fat") or 0) for r in records)
    days_in_range = 7 if range == "week" else 30
    avg_cal_per_day = round(total_cal / days_in_range, 1) if days_in_range else 0
    cal_surplus_deficit = round(avg_cal_per_day - tdee, 1)

    by_meal: Dict[str, float] = {}
    for r in records:
        mt = r.get("meal_type") or "snack"
        by_meal[mt] = by_meal.get(mt, 0) + float(r.get("total_calories") or 0)
    by_meal_out = {
        "breakfast": round(by_meal.get("breakfast", 0), 1),
        "lunch": round(by_meal.get("lunch", 0), 1),
        "dinner": round(by_meal.get("dinner", 0), 1),
        "snack": round(by_meal.get("snack", 0), 1),
    }

    daily_cal: Dict[str, float] = {}
    for r in records:
        rt = r.get("record_time")
        if rt:
            try:
                dt_str = rt[:10] if isinstance(rt, str) else str(rt)[:10]
                daily_cal[dt_str] = daily_cal.get(dt_str, 0) + float(r.get("total_calories") or 0)
            except Exception:
                pass
    daily_list = [{"date": d, "calories": round(c, 1)} for d, c in sorted(daily_cal.items())]

    total_macros = total_protein * 4 + total_carbs * 4 + total_fat * 9
    if total_macros <= 0:
        pct_p, pct_c, pct_f = 0, 0, 0
    else:
        pct_p = round(total_protein * 4 / total_macros * 100, 1)
        pct_c = round(total_carbs * 4 / total_macros * 100, 1)
        pct_f = round(total_fat * 9 / total_macros * 100, 1)

    analysis_parts = []
    if cal_surplus_deficit > 100:
        analysis_parts.append(f"本期日均摄入比 TDEE 高约 {cal_surplus_deficit:.0f} kcal，注意控制总热量。")
    elif cal_surplus_deficit < -100:
        analysis_parts.append(f"本期日均摄入比 TDEE 低约 {-cal_surplus_deficit:.0f} kcal，减重期可接受，长期请保证营养。")
    else:
        analysis_parts.append("本期日均摄入与 TDEE 接近，热量控制良好。")
    if streak_days > 0:
        analysis_parts.append(f"已连续记录 {streak_days} 天，继续保持。")
    if pct_p > 0:
        analysis_parts.append(f"蛋白质占比约 {pct_p}%、碳水 {pct_c}%、脂肪 {pct_f}%，可根据目标微调比例。")

    return {
        "range": range,
        "start_date": start_date,
        "end_date": end_date,
        "tdee": int(tdee),
        "streak_days": streak_days,
        "total_calories": round(total_cal, 1),
        "avg_calories_per_day": avg_cal_per_day,
        "cal_surplus_deficit": cal_surplus_deficit,
        "total_protein": round(total_protein, 1),
        "total_carbs": round(total_carbs, 1),
        "total_fat": round(total_fat, 1),
        "by_meal": by_meal_out,
        "daily_calories": daily_list,
        "macro_percent": {"protein": pct_p, "carbs": pct_c, "fat": pct_f},
        "analysis_summary": " ".join(analysis_parts),
    }


# ---------- 好友与圈子 ----------

@app.get("/api/friend/search")
async def api_friend_search(
    nickname: Optional[str] = None,
    telephone: Optional[str] = None,
    user_info: dict = Depends(get_current_user_info),
):
    """搜索用户（昵称模糊 / 手机号精确），排除自己、已是好友、已发过待处理请求的。返回 id, nickname, avatar。"""
    if not nickname and not telephone:
        return {"list": []}
    try:
        users = await search_users(
            current_user_id=user_info["user_id"],
            nickname=nickname.strip() if nickname else None,
            telephone=telephone.strip() if telephone else None,
            limit=20,
        )
        return {"list": users}
    except Exception as e:
        print(f"[api/friend/search] 错误: {e}")
        raise HTTPException(status_code=500, detail="搜索失败")


@app.post("/api/friend/request")
async def api_friend_request(
    body: dict,
    user_info: dict = Depends(get_current_user_info),
):
    """发送好友请求。body: { "to_user_id": "uuid" }"""
    to_user_id = body.get("to_user_id")
    if not to_user_id:
        raise HTTPException(status_code=400, detail="缺少 to_user_id")
    try:
        await send_friend_request(user_info["user_id"], to_user_id)
        return {"message": "已发送好友请求"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[api/friend/request] 错误: {e}")
        raise HTTPException(status_code=500, detail="发送失败")


@app.get("/api/friend/requests")
async def api_friend_requests(user_info: dict = Depends(get_current_user_info)):
    """收到的待处理好友请求列表"""
    try:
        rows = await get_friend_requests_received(user_info["user_id"])
        return {"list": rows}
    except Exception as e:
        print(f"[api/friend/requests] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取失败")


@app.post("/api/friend/request/{request_id}/respond")
async def api_friend_respond(
    request_id: str,
    body: dict,
    user_info: dict = Depends(get_current_user_info),
):
    """处理好友请求。body: { "action": "accept" | "reject" }"""
    action = body.get("action")
    if action not in ("accept", "reject"):
        raise HTTPException(status_code=400, detail="action 须为 accept 或 reject")
    try:
        await respond_friend_request(request_id, user_info["user_id"], action == "accept")
        return {"message": "已接受" if action == "accept" else "已拒绝"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[api/friend/respond] 错误: {e}")
        raise HTTPException(status_code=500, detail="操作失败")


@app.get("/api/friend/list")
async def api_friend_list(user_info: dict = Depends(get_current_user_info)):
    """好友列表"""
    try:
        friends = await get_friends_with_profile(user_info["user_id"])
        return {"list": friends}
    except Exception as e:
        print(f"[api/friend/list] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取失败")


@app.get("/api/community/feed")
async def api_community_feed(
    date: Optional[str] = None,
    user_info: dict = Depends(get_current_user_info),
):
    """圈子 Feed：好友 + 自己在指定日期（默认今天）的饮食记录，带点赞数与当前用户是否已点赞。"""
    try:
        current_user_id = user_info["user_id"]
        items = await list_friends_today_records(current_user_id, date=date)
        record_ids = [item["record"]["id"] for item in items]
        likes_map = await get_feed_likes_for_records(record_ids, current_user_id) if record_ids else {}
        out = []
        for item in items:
            rec = item["record"]
            rid = rec["id"]
            like_info = likes_map.get(rid, {"count": 0, "liked": False})
            is_mine = rec.get("user_id") == current_user_id
            out.append({
                "record": rec,
                "author": item["author"],
                "like_count": like_info["count"],
                "liked": like_info["liked"],
                "is_mine": is_mine,
            })
        return {"list": out}
    except Exception as e:
        print(f"[api/community/feed] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取动态失败")


@app.post("/api/community/feed/{record_id}/like")
async def api_community_like(
    record_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """对某条动态点赞"""
    try:
        await add_feed_like(user_info["user_id"], record_id)
        return {"message": "已点赞"}
    except Exception as e:
        print(f"[api/community/feed/like] 错误: {e}")
        raise HTTPException(status_code=500, detail="点赞失败")


@app.delete("/api/community/feed/{record_id}/like")
async def api_community_unlike(
    record_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """取消点赞"""
    try:
        await remove_feed_like(user_info["user_id"], record_id)
        return {"message": "已取消"}
    except Exception as e:
        print(f"[api/community/feed/unlike] 错误: {e}")
        raise HTTPException(status_code=500, detail="取消失败")


@app.get("/api/community/feed/{record_id}/comments")
async def api_community_comments(
    record_id: str,
    user_info: dict = Depends(get_current_user_info),
):
    """某条动态的评论列表"""
    try:
        comments = await list_feed_comments(record_id, limit=50)
        return {"list": comments}
    except Exception as e:
        print(f"[api/community/feed/comments] 错误: {e}")
        raise HTTPException(status_code=500, detail="获取评论失败")


@app.post("/api/community/feed/{record_id}/comments")
async def api_community_comment_post(
    record_id: str,
    body: dict,
    user_info: dict = Depends(get_current_user_info),
):
    """发表评论。body: { "content": "评论内容" }"""
    content = (body.get("content") or "").strip() if isinstance(body.get("content"), str) else ""
    if not content:
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    try:
        comment = await add_feed_comment(user_info["user_id"], record_id, content.strip())
        return {"comment": comment}
    except Exception as e:
        print(f"[api/community/feed/comment] 错误: {e}")
        raise HTTPException(status_code=500, detail="发表失败")


async def get_access_token() -> str:
    """
    获取微信小程序 access_token
    参考文档: https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-access-token/api_getaccesstoken.html
    """
    global _access_token_cache
    
    # 检查缓存是否有效（提前 5 分钟刷新）
    current_time = int(time.time())
    if _access_token_cache["token"] and _access_token_cache["expires_at"] > current_time + 300:
        print(f"[get_access_token] 使用缓存的 access_token: {_access_token_cache['token']}")
        print(f"[get_access_token] 缓存过期时间: {_access_token_cache['expires_at']} (时间戳)")
        return _access_token_cache["token"]
    
    appid = os.getenv("APPID")
    secret = os.getenv("SECRET")
    
    if not appid or not secret:
        raise HTTPException(
            status_code=500,
            detail="缺少 APPID 或 SECRET 环境变量"
        )
    
    # 调用微信接口获取 access_token
    token_url = "https://api.weixin.qq.com/cgi-bin/token"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            token_url,
            params={
                "grant_type": "client_credential",
                "appid": appid,
                "secret": secret
            }
        )
        
        if not response.is_success:
            raise HTTPException(
                status_code=500,
                detail=f"获取 access_token 失败: {response.status_code}"
            )
        
        data = response.json()
        
        # 检查错误
        if "errcode" in data and data["errcode"] != 0:
            error_msg = data.get("errmsg", "未知错误")
            raise HTTPException(
                status_code=500,
                detail=f"获取 access_token 失败: {error_msg} (错误码: {data.get('errcode')})"
            )
        
        access_token = data.get("access_token")
        expires_in = data.get("expires_in", 7200)  # 默认 2 小时
        
        # 打印 access_token
        print(f"[get_access_token] access_token: {access_token}")
        print(f"[get_access_token] expires_in: {expires_in} 秒")
        print(f"[get_access_token] 过期时间: {current_time + expires_in} (时间戳)")
        
        # 更新缓存
        _access_token_cache["token"] = access_token
        _access_token_cache["expires_at"] = current_time + expires_in
        
        return access_token


async def get_phone_number(phone_code: str) -> dict:
    """
    获取用户手机号
    参考文档: https://developers.weixin.qq.com/miniprogram/dev/server/API/user-info/phone-number/api_getphonenumber.html
    """
    access_token = await get_access_token()
    print(f"[get_phone_number] 使用 access_token 获取手机号，phone_code: {phone_code}")
    
    phone_url = "https://api.weixin.qq.com/wxa/business/getuserphonenumber"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            f"{phone_url}?access_token={access_token}",
            json={
                "code": phone_code
            }
        )
        
        if not response.is_success:
            raise HTTPException(
                status_code=500,
                detail=f"获取手机号失败: {response.status_code}"
            )
        
        data = response.json()
        
        # 检查错误
        if "errcode" in data and data["errcode"] != 0:
            error_msg = data.get("errmsg", "未知错误")
            raise HTTPException(
                status_code=400,
                detail=f"获取手机号失败: {error_msg} (错误码: {data.get('errcode')})"
            )
        
        phone_info = data.get("phone_info", {})
        phone_number = phone_info.get("phoneNumber")
        pure_phone_number = phone_info.get("purePhoneNumber")
        country_code = phone_info.get("countryCode")
        
        # 打印手机号信息
        print(f"[get_phone_number] 获取手机号成功:")
        print(f"  - phoneNumber (含区号): {phone_number}")
        print(f"  - purePhoneNumber (不含区号): {pure_phone_number}")
        print(f"  - countryCode (国家区号): {country_code}")
        if phone_info.get("watermark"):
            watermark = phone_info.get("watermark", {})
            print(f"  - watermark.timestamp: {watermark.get('timestamp')}")
            print(f"  - watermark.appid: {watermark.get('appid')}")
        
        return {
            "phoneNumber": phone_number,
            "purePhoneNumber": pure_phone_number,
            "countryCode": country_code
        }


@app.post("/api/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """
    微信小程序登录接口
    
    - **code**: 微信小程序通过 wx.login 获取的临时登录凭证
    - **phoneCode**: 获取手机号的 code（可选，需要用户授权）
    
    流程：
    1. 调用微信接口获取 openid/unionid
    2. 检查 weapp_user 表中是否存在该用户
    3. 如果不存在，创建新用户记录
    4. 如果存在，直接使用现有用户
    5. 生成 JWT token 返回给前端
    """
    try:
        # 1. 获取小程序配置
        appid = os.getenv("APPID")
        secret = os.getenv("SECRET")
        
        if not appid or not secret:
            raise HTTPException(
                status_code=500,
                detail="缺少 APPID 或 SECRET 环境变量"
            )
        
        if not request.code:
            raise HTTPException(
                status_code=400,
                detail="code 不能为空"
            )
        
        # 2. 调用微信 code2Session 接口获取 openid/unionid
        wechat_api_url = "https://api.weixin.qq.com/sns/jscode2session"
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                wechat_api_url,
                params={
                    "appid": appid,
                    "secret": secret,
                    "js_code": request.code,
                    "grant_type": "authorization_code"
                }
            )
            
            if not response.is_success:
                raise HTTPException(
                    status_code=500,
                    detail=f"微信接口调用失败: {response.status_code}"
                )
            
            data = response.json()
            
            # 检查微信接口返回的错误
            if "errcode" in data and data["errcode"] != 0:
                error_msg = data.get("errmsg", "未知错误")
                raise HTTPException(
                    status_code=400,
                    detail=f"微信登录失败: {error_msg} (错误码: {data.get('errcode')})"
                )
            
            openid = data.get("openid", "")
            unionid = data.get("unionid")
            session_key = data.get("session_key", "")  # 后端保存，不返回前端
            
            if not openid:
                raise HTTPException(
                    status_code=400,
                    detail="微信登录失败：未获取到 openid"
                )
        
        # 3. 获取手机号（如果提供了 phoneCode）
            phone_number = None
            pure_phone_number = None
            country_code = None
            
            if request.phoneCode:
                print(f"[api/login] 收到 phoneCode，开始获取手机号: {request.phoneCode}")
                try:
                    phone_info = await get_phone_number(request.phoneCode)
                    phone_number = phone_info.get("phoneNumber")
                    pure_phone_number = phone_info.get("purePhoneNumber")
                    country_code = phone_info.get("countryCode")
                    print(f"[api/login] 手机号获取成功:")
                    print(f"  - phoneNumber: {phone_number}")
                    print(f"  - purePhoneNumber: {pure_phone_number}")
                    print(f"  - countryCode: {country_code}")
                except Exception as phone_error:
                    print(f"[api/login] 获取手机号失败: {phone_error}")
                    import traceback
                    print(f"[api/login] 错误详情: {traceback.format_exc()}")
                    # 手机号获取失败不影响登录流程，继续返回其他信息
        
        # 4. 检查用户是否已存在
        user = await get_user_by_openid(openid)
        
        if user:
            # 用户已存在，更新信息（如果有新数据）
            user_id = user["id"]
            update_data = {}
            
            if unionid and not user.get("unionid"):
                update_data["unionid"] = unionid
            if pure_phone_number and not user.get("telephone"):
                update_data["telephone"] = pure_phone_number
            
            if update_data:
                print(f"[api/login] 更新用户信息: {update_data}")
                user = await update_user(user_id, update_data)
            
            print(f"[api/login] 用户已存在，user_id: {user_id}, openid: {openid}")
        else:
            # 新用户，创建记录
            print(f"[api/login] 创建新用户，openid: {openid}")
            user_data = {
                "openid": openid,
                "unionid": unionid,
                "avatar": "",
                "nickname": "",
                "telephone": pure_phone_number
            }
            
            user = await create_user(user_data)
            user_id = user["id"]
            print(f"[api/login] 新用户创建成功，user_id: {user_id}")
        
        # 5. 生成 JWT token
        token_data = {
            "user_id": user_id,
            "openid": openid,
            "unionid": unionid,
            "sub": user_id  # JWT 标准字段
        }
        
        # Access token（7 天有效期）
        access_token = create_access_token(
            data=token_data,
            expires_delta=timedelta(days=7)
        )
        
        # Refresh token（30 天有效期）
        refresh_token = create_access_token(
            data={"user_id": user_id, "openid": openid, "type": "refresh"},
            expires_delta=timedelta(days=30)
        )
        
        # 6. 返回登录结果
        return LoginResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            expires_in=7 * 24 * 60 * 60,  # 7 天的秒数
            user_id=user_id,
            openid=openid,
            unionid=unionid,
            phoneNumber=phone_number,
            purePhoneNumber=pure_phone_number,
            countryCode=country_code
        )
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/login] error: {e}")
        import traceback
        print(f"[api/login] 错误详情: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500,
            detail=str(e) or "登录失败"
        )

