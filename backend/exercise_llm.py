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
EXERCISE_MODEL_NAME = "google/gemini-3.1-flash-lite-preview"
ACTIVITY_LEVEL_LABELS = {
    "sedentary": "久坐",
    "light": "轻度活动",
    "moderate": "中度活动",
    "active": "高度活动",
    "very_active": "极高活动",
}

RULE_BASED_METS = [
    (("跳绳",), 11.0, "跳绳"),
    (("跑步", "慢跑", "晨跑"), 8.3, "跑步"),
    (("冲刺",), 11.5, "冲刺跑"),
    (("骑车", "骑行", "单车"), 6.8, "骑行"),
    (("游泳",), 8.0, "游泳"),
    (("俯卧撑", "引体", "臂屈伸"), 8.0, "徒手力量训练"),
    (("深蹲", "硬拉", "卧推"), 6.0, "力量训练"),
    (("瑜伽",), 3.0, "瑜伽"),
    (("拉伸", "放松"), 2.3, "拉伸"),
    (("步行", "走路", "快走"), 3.8, "步行"),
]

EXERCISE_CALORIES_SYSTEM_PROMPT = (
    "你是运动热量估算助手。用户用自然语言描述自己完成的一次运动。\n"
    "你必须先用简体中文给出非常简短的估算依据，再给出千卡估计。\n"
    "reasoning 只允许 1-2 句，总长度尽量控制在 80 个汉字以内；不要展开长篇推导。\n"
    "推理应只覆盖：运动类型、时长、强度或配速/距离等；若缺少体重等信息，仅在 reasoning 中一句话写明合理假设。\n"
    "不要输出 JSON 以外的多余说明；结构化字段由系统从回复中提取。"
)

EXERCISE_CALORIES_FALLBACK_SYSTEM_PROMPT = (
    "你是运动热量估算助手。\n"
    "只输出一个 JSON 对象，不要 markdown，不要代码块，不要额外解释。\n"
    '格式固定为：{"reasoning":"一句简短中文，不超过60字","calories_kcal":123}\n'
    "reasoning 只保留结论，不要展开推导。"
)

EXERCISE_CALORIES_NUMERIC_SYSTEM_PROMPT = (
    "你是运动热量估算助手。\n"
    "根据用户运动描述和画像信息估算本次运动消耗。\n"
    "只输出一个正整数，表示总消耗千卡；不要单位、不要解释、不要任何其他字符。"
)


class ExerciseCaloriesEstimate(BaseModel):
    """Instructor 结构化输出：与 Ofox 模型约定一致。"""

    reasoning: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="简体中文，1～2句，总长度尽量不超过80字，只写简短估算依据",
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


def _compact_exercise_desc(desc: str) -> str:
    """把多段运动描述压缩成更短的摘要，尽量保留时长/配速/组数/负重等关键信息。"""
    raw = (desc or "").strip()
    if not raw:
        return ""
    parts = [p.strip(" ;,.，。") for p in re.split(r"[\r\n;；。]+", raw) if p.strip()]
    compact_parts = []
    for part in parts[:8]:
        part = re.sub(r"\s+", "", part)
        part = part.replace("：", ":").replace("，", ",")
        if len(part) > 60:
            m = re.match(r"^(.{0,60}?)(?:,|，|以|主要|为主)", part)
            if m and m.group(1):
                part = m.group(1)
            else:
                part = part[:60]
        compact_parts.append(part)
    return "；".join(compact_parts)


def _should_prefer_plain_json(desc: str) -> bool:
    text = (desc or "").strip()
    if not text:
        return False
    separators = text.count("\n") + text.count("；") + text.count(";") + text.count("。")
    colon_count = text.count("：") + text.count(":")
    return len(text) >= 110 or separators >= 2 or colon_count >= 2


def _split_exercise_segments(desc: str) -> list[str]:
    raw = (desc or "").strip()
    if not raw:
        return []
    segments = []
    for part in re.split(r"[\r\n;；。]+", raw):
        cleaned = re.sub(r"\s+", " ", part).strip(" ;,.，。")
        if len(cleaned) >= 4:
            segments.append(cleaned)
    return segments[:8]


def _should_estimate_by_segments(desc: str, segments: list[str]) -> bool:
    if len(segments) < 2:
        return False
    if len(desc or "") >= 80:
        return True
    return any((":" in s or "：" in s) for s in segments)


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


def _is_incomplete_output_error(error: Exception) -> bool:
    text = str(error or "").lower()
    return (
        "max_tokens length limit" in text
        or "output is incomplete" in text
        or "incompleteoutputexception" in text
    )


def _estimate_exercise_calories_plain_json_fallback(
    openai_client: OpenAI,
    model_name: str,
    user_prompt: str,
) -> Tuple[int, str, str]:
    """主链路被截断时，降级到更短的纯 JSON 输出，避免 reasoning 过长再次炸掉。"""
    resp = openai_client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": EXERCISE_CALORIES_FALLBACK_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2,
        max_tokens=int(os.getenv("EXERCISE_CALORIES_FALLBACK_MAX_TOKENS", "220")),
    )
    raw = ""
    if getattr(resp, "choices", None):
        try:
            raw = (resp.choices[0].message.content or "").strip()
        except (IndexError, AttributeError):
            raw = ""
    if not raw:
        raise ExerciseLlmError("运动热量估算结果为空", 502)

    data = _parse_json_object_loose(raw)
    reasoning = _coerce_reasoning(data)
    calories = _coerce_calories_kcal(data)
    return calories, raw, reasoning


def _parse_first_positive_int(text: str) -> int:
    m = re.search(r"(\d{1,4})", text or "")
    if not m:
        raise ExerciseLlmError(f"未找到有效热量数字，原始片段: {(text or '')[:120]}", 502)
    value = int(m.group(1))
    if value <= 0:
        raise ExerciseLlmError(f"热量数字必须为正整数，得到: {value}", 502)
    return min(value, 5000)


def _estimate_exercise_calories_numeric_fallback(
    openai_client: OpenAI,
    model_name: str,
    user_prompt: str,
) -> Tuple[int, str]:
    resp = openai_client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": EXERCISE_CALORIES_NUMERIC_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.1,
        max_tokens=int(os.getenv("EXERCISE_CALORIES_NUMERIC_MAX_TOKENS", "32")),
    )
    raw = ""
    if getattr(resp, "choices", None):
        try:
            raw = (resp.choices[0].message.content or "").strip()
        except (IndexError, AttributeError):
            raw = ""
    if not raw:
        raise ExerciseLlmError("运动热量估算结果为空", 502)
    return _parse_first_positive_int(raw), raw


def _extract_duration_minutes(desc: str) -> Optional[float]:
    text = desc or ""
    total = 0.0
    matched = False
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*(小时|h|hour)", text, flags=re.IGNORECASE):
        total += float(m.group(1)) * 60.0
        matched = True
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*(分钟|min)", text, flags=re.IGNORECASE):
        total += float(m.group(1))
        matched = True
    return total if matched and total > 0 else None


def _pick_rule_based_met(desc: str) -> Tuple[float, str]:
    text = desc or ""
    for keywords, met, label in RULE_BASED_METS:
        if any(k in text for k in keywords):
            return met, label
    return 5.0, "一般运动"


def _estimate_exercise_calories_rule_fallback(
    exercise_desc: str,
    profile_snapshot: Optional[Dict[str, Any]] = None,
) -> Tuple[int, str]:
    minutes = _extract_duration_minutes(exercise_desc)
    if not minutes:
        raise ExerciseLlmError("规则估算缺少时长信息", 502)
    met, label = _pick_rule_based_met(exercise_desc)
    weight = 70.0
    if isinstance(profile_snapshot, dict):
        try:
            raw_weight = profile_snapshot.get("weight_kg")
            if raw_weight:
                weight = float(raw_weight)
        except (TypeError, ValueError):
            pass
    calories = int(round(met * 3.5 * weight / 200.0 * minutes))
    calories = max(1, min(calories, 5000))
    reasoning = f"规则估算：{label}约{int(round(minutes))}分钟"
    return calories, reasoning


def _estimate_exercise_calories_short_path(
    openai_client: OpenAI,
    model_name: str,
    user_prompt: str,
    original_desc: str,
    profile_snapshot: Optional[Dict[str, Any]] = None,
) -> Tuple[int, str, str]:
    try:
        return _estimate_exercise_calories_plain_json_fallback(
            openai_client,
            model_name,
            user_prompt,
        )
    except Exception as e:
        print(f"[estimate_exercise_calories_sync] short json 失败，尝试 numeric fallback: {e}", flush=True)
    try:
        calories, raw = _estimate_exercise_calories_numeric_fallback(
            openai_client,
            model_name,
            user_prompt,
        )
        reasoning = "按简化分项估算"
        return calories, raw, reasoning
    except Exception as e:
        print(f"[estimate_exercise_calories_sync] numeric fallback 失败，尝试规则估算: {e}", flush=True)
    calories, reasoning = _estimate_exercise_calories_rule_fallback(
        original_desc,
        profile_snapshot,
    )
    raw = json.dumps(
        {
            "reasoning": reasoning,
            "calories_kcal": calories,
            "source": "rule_fallback",
        },
        ensure_ascii=False,
    )
    return calories, raw, reasoning


def estimate_exercise_calories_sync(
    exercise_desc: str,
    profile_snapshot: Optional[Dict[str, Any]] = None,
    allow_segmented_fallback: bool = True,
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

    model_name = EXERCISE_MODEL_NAME
    compact_desc = _compact_exercise_desc(desc)
    prompt_desc = compact_desc or desc
    user_prompt = f"用户运动描述：{prompt_desc}"
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

    segments = _split_exercise_segments(desc)
    if allow_segmented_fallback and _should_estimate_by_segments(desc, segments):
        print(
            f"[estimate_exercise_calories_sync] 多项目描述，拆分估算 segments={len(segments)}",
            flush=True,
        )
        segment_rows = []
        total = 0
        for segment in segments:
            segment_prompt = f"用户运动描述：{_compact_exercise_desc(segment) or segment}"
            if profile_text:
                segment_prompt += (
                    "\n\n"
                    + profile_text
                    + "\n\n请仅基于这一项运动估算。"
                )
            cal, _, seg_reasoning = _estimate_exercise_calories_short_path(
                openai_client,
                model_name,
                segment_prompt,
                segment,
                profile_snapshot,
            )
            total += cal
            segment_rows.append(
                {
                    "segment": segment,
                    "calories_kcal": cal,
                    "reasoning": seg_reasoning,
                }
            )
        reasoning = "分项估算：" + "；".join(
            f"{row['segment'][:16]}≈{row['calories_kcal']}kcal" for row in segment_rows[:6]
        )
        if len(reasoning) > 200:
            reasoning = reasoning[:200] + "…"
        raw = json.dumps(
            {
                "segments": segment_rows,
                "reasoning": reasoning,
                "calories_kcal": total,
            },
            ensure_ascii=False,
        )
        print(
            f"[estimate_exercise_calories_sync] segmented success desc_len={len(desc)} total={total}",
            flush=True,
        )
        return total, raw, reasoning

    client = instructor.from_openai(openai_client, mode=mode)
    max_retries = int(os.getenv("EXERCISE_CALORIES_INSTRUCTOR_MAX_RETRIES", "3"))

    if _should_prefer_plain_json(desc):
        print(
            f"[estimate_exercise_calories_sync] 多段/长描述，优先走短 JSON 路线 desc_len={len(desc)} compact_len={len(prompt_desc)}",
            flush=True,
        )
        try:
            calories, raw, reasoning = _estimate_exercise_calories_short_path(
                openai_client,
                model_name,
                user_prompt,
                desc,
                profile_snapshot,
            )
            print(
                f"[estimate_exercise_calories_sync] plain-json preferred success desc={desc!r} "
                f"calories={calories} reasoning_len={len(reasoning)}",
                flush=True,
            )
            return calories, raw, reasoning
        except Exception as e:
            print(
                f"[estimate_exercise_calories_sync] plain-json preferred 失败，回退 Instructor: {e}",
                flush=True,
            )

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
        if _is_incomplete_output_error(e):
            print(
                "[estimate_exercise_calories_sync] 主链路输出被截断，尝试短 JSON fallback",
                flush=True,
            )
            try:
                calories, raw, reasoning = _estimate_exercise_calories_short_path(
                    openai_client,
                    model_name,
                    user_prompt,
                    desc,
                    profile_snapshot,
                )
                print(
                    f"[estimate_exercise_calories_sync] fallback success desc={desc!r} "
                    f"calories={calories} reasoning_len={len(reasoning)}",
                    flush=True,
                )
                return calories, raw, reasoning
            except Exception as fallback_error:
                print(
                    "[estimate_exercise_calories_sync] fallback 失败: "
                    f"{fallback_error}",
                    flush=True,
                )
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
