"""
运动热量估算：调用 OfoxAI 大模型（与 main 中逻辑一致，供 Worker 同步调用）。
"""
import os
import re
from typing import Optional, Tuple

import httpx

OFOXAI_BASE_URL = os.getenv("OFOXAI_BASE_URL", "https://api.ofox.ai/v1")
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-3-flash-preview")

EXERCISE_CALORIES_SYSTEM_PROMPT = (
    "你是运动热量估算助手。用户用自然语言描述自己完成的一次运动。"
    "请根据描述估算本次运动大约消耗多少千卡（kcal）。"
    "只回复一个整数，范围 0～5000，不要任何其它文字、标点或解释。"
)


class ExerciseLlmError(Exception):
    """可映射为 HTTP 状态的业务错误（Worker 内使用）。"""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


def estimate_exercise_calories_sync(exercise_desc: str) -> Tuple[int, Optional[str]]:
    """
    同步调用大模型估算千卡。返回 (calories, raw_ai_text)。
    失败抛出 ExerciseLlmError。
    """
    desc = (exercise_desc or "").strip()
    if not desc:
        raise ExerciseLlmError("运动描述不能为空", 400)

    api_key = os.getenv("OFOXAI_API_KEY") or os.getenv("ofox_ai_apikey")
    if not api_key:
        raise ExerciseLlmError("AI 服务未配置", 503)

    model_name = os.getenv("EXERCISE_CALORIES_MODEL_NAME", GEMINI_MODEL_NAME)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": EXERCISE_CALORIES_SYSTEM_PROMPT},
            {"role": "user", "content": desc},
        ],
        "temperature": 0.2,
        "max_tokens": 32,
    }

    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                f"{OFOXAI_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            result = response.json()
    except httpx.HTTPStatusError as e:
        print(f"[estimate_exercise_calories_sync] AI API 错误: {e}")
        raise ExerciseLlmError("AI 服务暂时不可用", 502)

    ai_content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    raw = ai_content.strip() if ai_content else None

    calories = 0
    if raw:
        try:
            calories = int(float(raw.strip()))
        except ValueError:
            numbers = re.findall(r"\d+", raw)
            if numbers:
                calories = int(numbers[0])

    calories = max(0, min(5000, calories))
    return calories, raw
