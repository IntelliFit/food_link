"""
运动热量估算：通过 Instructor + Pydantic 从 OfoxAI（OpenAI 兼容）获取结构化输出，
避免手写 JSON 解析在模型格式漂移时失败。
"""
import json
import os
import re
from typing import Any, Dict, Optional, Tuple

import instructor
from instructor import Mode
from instructor.core.exceptions import InstructorError
from openai import APIError as OpenAIAPIError
from openai import OpenAI
from pydantic import BaseModel, Field

OFOXAI_BASE_URL = os.getenv("OFOXAI_BASE_URL", "https://api.ofox.ai/v1")
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-3-flash-preview")
ACTIVITY_LEVEL_LABELS = {
    "sedentary": "久坐",
    "light": "轻度活动",
    "moderate": "中度活动",
    "active": "高度活动",
    "very_active": "极高活动",
}

EXERCISE_CALORIES_SYSTEM_PROMPT = (
    "你是运动热量估算助手。用户用自然语言描述自己完成的一次运动。\n"
    "你必须先用简体中文写清推理过程，再给出千卡估计。\n"
    "推理应体现：运动类型、时长、强度或配速/距离等；若缺少体重等信息，仅在 reasoning 中写明合理假设。\n"
    "不要输出 JSON 以外的多余说明；结构化字段由系统从回复中提取。"
)


class ExerciseCaloriesEstimate(BaseModel):
    """Instructor 结构化输出：与 Ofox 模型约定一致。"""

    reasoning: str = Field(
        ...,
        min_length=1,
        max_length=4000,
        description="简体中文，2～5 句，说明理解、假设与估算依据",
    )
    calories_kcal: int = Field(
        ...,
        ge=1,
        le=5000,
        description="本次运动消耗的总千卡（正整数）",
    )


class ExerciseLlmError(Exception):
    """可映射为 HTTP 状态的业务错误（Worker 内使用）。"""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


def _exercise_instructor_mode() -> Mode:
    """EXERCISE_CALORIES_INSTRUCTOR_MODE: json | md_json | tools（默认 md_json，兼容 ```json 包裹）。"""
    raw = (os.getenv("EXERCISE_CALORIES_INSTRUCTOR_MODE") or "md_json").strip().lower()
    if raw == "json":
        return Mode.JSON
    if raw == "tools":
        return Mode.TOOLS
    return Mode.MD_JSON


def _strip_markdown_fence(text: str) -> str:
    t = (text or "").strip()
    if not t.startswith("```"):
        return t
    lines = t.split("\n")
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _parse_json_object_loose(text: str) -> Dict[str, Any]:
    """从模型输出中解析 JSON 对象（单测与应急兜底，不保证上游格式）。"""
    raw = _strip_markdown_fence(text)
    if not raw:
        raise ExerciseLlmError("运动热量估算结果为空", 502)
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]*\}", raw)
    if m:
        try:
            data = json.loads(m.group(0))
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
    if raw.startswith('"') and '"calories_kcal"' in raw:
        try:
            data = json.loads("{" + raw.rstrip(", \n\r\t") + "}")
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
    reasoning_match = re.search(
        r'"reasoning"\s*:\s*"(?P<reasoning>[\s\S]*?)"\s*,\s*"(?P<cal_key>calories_kcal|calories|kcal)"\s*:\s*(?P<calories>\d+(?:\.\d+)?)',
        raw,
    )
    if reasoning_match:
        return {
            "reasoning": reasoning_match.group("reasoning").replace('\\"', '"').strip(),
            reasoning_match.group("cal_key"): reasoning_match.group("calories"),
        }
    raise ExerciseLlmError(f"运动热量 JSON 解析失败，原始片段: {raw[:200]}", 502)


def _coerce_calories_kcal(data: Dict[str, Any]) -> int:
    v = data.get("calories_kcal")
    if v is None:
        v = data.get("calories") or data.get("kcal")
    if v is None:
        raise ExerciseLlmError("JSON 缺少 calories_kcal（或兼容字段）", 502)
    try:
        c = int(float(v))
    except (TypeError, ValueError):
        raise ExerciseLlmError(f"calories_kcal 不是合法数字: {v!r}", 502)
    c = max(0, min(5000, c))
    if c <= 0:
        raise ExerciseLlmError(f"calories_kcal 必须为正整数，得到: {c}", 502)
    return c


def _coerce_reasoning(data: Dict[str, Any]) -> str:
    r = data.get("reasoning")
    if r is None:
        r = data.get("think") or data.get("analysis")
    if r is None:
        raise ExerciseLlmError("JSON 缺少 reasoning（思考过程）", 502)
    s = str(r).strip()
    if not s:
        raise ExerciseLlmError("reasoning 不能为空", 502)
    if len(s) > 4000:
        s = s[:4000] + "…"
    return s


def _format_exercise_profile_snapshot(profile_snapshot: Dict[str, Any]) -> str:
    if not isinstance(profile_snapshot, dict) or not profile_snapshot:
        return ""
    lines = []
    weight_kg = profile_snapshot.get("weight_kg")
    if weight_kg is not None:
        source = str(profile_snapshot.get("weight_source") or "").strip()
        source_hint = "（来自最近体重记录）" if source == "latest_weight_record" else ""
        lines.append(f"- 体重：{float(weight_kg):.1f} kg{source_hint}")
    height_cm = profile_snapshot.get("height_cm")
    if height_cm is not None:
        lines.append(f"- 身高：{float(height_cm):.1f} cm")
    gender = str(profile_snapshot.get("gender") or "").strip().lower()
    if gender in {"male", "female"}:
        lines.append(f"- 性别：{'男' if gender == 'male' else '女'}")
    age_years = profile_snapshot.get("age_years")
    if age_years is not None:
        lines.append(f"- 年龄：{int(age_years)} 岁")
    activity_level = str(profile_snapshot.get("activity_level") or "").strip()
    if activity_level:
        lines.append(f"- 日常活动水平：{ACTIVITY_LEVEL_LABELS.get(activity_level, activity_level)}")
    bmr = profile_snapshot.get("bmr")
    if bmr is not None:
        lines.append(f"- BMR：{float(bmr):.1f} kcal/天")
    tdee = profile_snapshot.get("tdee")
    if tdee is not None:
        lines.append(f"- TDEE：{float(tdee):.1f} kcal/天")
    if not lines:
        return ""
    return "已知用户真实档案（请优先使用，不要随意假设这些字段）：\n" + "\n".join(lines)


def _raw_text_from_instructor_result(estimate: ExerciseCaloriesEstimate) -> str:
    """尽量返回模型原始文本，否则序列化结构化结果。"""
    raw_resp = getattr(estimate, "_raw_response", None)
    if raw_resp is not None and getattr(raw_resp, "choices", None):
        try:
            msg = raw_resp.choices[0].message
            content = (msg.content or "").strip() if msg else ""
            if content:
                return content
        except (IndexError, AttributeError):
            pass
    return estimate.model_dump_json(ensure_ascii=False)


def estimate_exercise_calories_sync(
    exercise_desc: str,
    profile_snapshot: Optional[Dict[str, Any]] = None,
) -> Tuple[int, str, str]:
    """
    同步调用大模型估算千卡。
    返回 (calories, raw_ai_text, reasoning)；raw 为模型原始输出或结构化序列化。
    失败抛出 ExerciseLlmError。
    """
    desc = (exercise_desc or "").strip()
    if not desc:
        raise ExerciseLlmError("运动描述不能为空", 400)

    api_key = os.getenv("OFOXAI_API_KEY") or os.getenv("ofox_ai_apikey")
    if not api_key:
        raise ExerciseLlmError("AI 服务未配置", 503)

    model_name = os.getenv("EXERCISE_CALORIES_MODEL_NAME", GEMINI_MODEL_NAME)
    user_prompt = f"用户运动描述：{desc}"
    profile_text = _format_exercise_profile_snapshot(profile_snapshot or {})
    if profile_text:
        user_prompt += (
            "\n\n"
            + profile_text
            + "\n\n请结合这些真实信息再做推理；只有缺失字段才允许自行做合理假设，并在 reasoning 中明确写出。"
        )

    mode = _exercise_instructor_mode()
    openai_client = OpenAI(
        base_url=OFOXAI_BASE_URL.rstrip("/"),
        api_key=api_key,
        timeout=60.0,
    )
    client = instructor.from_openai(openai_client, mode=mode)
    max_retries = int(os.getenv("EXERCISE_CALORIES_INSTRUCTOR_MAX_RETRIES", "3"))

    try:
        estimate = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": EXERCISE_CALORIES_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_model=ExerciseCaloriesEstimate,
            temperature=0.35,
            max_tokens=900,
            max_retries=max_retries,
        )
    except (InstructorError, OpenAIAPIError) as e:
        print(f"[estimate_exercise_calories_sync] Instructor/OpenAI 错误: {e}", flush=True)
        raise ExerciseLlmError("运动热量估算失败，请稍后重试", 502) from e
    except Exception as e:
        print(f"[estimate_exercise_calories_sync] 未预期错误: {e}", flush=True)
        raise ExerciseLlmError("运动热量估算失败", 502) from e

    reasoning = estimate.reasoning.strip()
    if not reasoning:
        raise ExerciseLlmError("reasoning 为空", 502)
    calories = int(estimate.calories_kcal)

    raw = _raw_text_from_instructor_result(estimate)

    print(
        f"[estimate_exercise_calories_sync] desc={desc!r} calories={calories} reasoning_len={len(reasoning)}",
        flush=True,
    )
    return calories, raw, reasoning
