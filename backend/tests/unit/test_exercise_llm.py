"""
运动热量估算：Pydantic / 宽松 JSON 解析单元测试（不调用外网）。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from instructor.core.exceptions import InstructorError
from pydantic import ValidationError

# 确保以 backend 为根导入
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from exercise_llm import (  # noqa: E402
    ExerciseCaloriesEstimate,
    ExerciseLlmError,
    _estimate_exercise_calories_numeric_fallback,
    _estimate_exercise_calories_plain_json_fallback,
    _estimate_exercise_calories_rule_fallback,
    _parse_first_positive_int,
    _split_exercise_segments,
    _should_prefer_plain_json,
    _coerce_calories_kcal,
    _coerce_reasoning,
    _parse_json_object_loose,
    estimate_exercise_calories_sync,
)


class TestExerciseCaloriesEstimate:
    """Instructor 使用的 Pydantic 模型校验。"""

    def test_valid(self) -> None:
        m = ExerciseCaloriesEstimate(reasoning="跑步30分钟。", calories_kcal=200)
        assert m.calories_kcal == 200

    def test_calories_out_of_range(self) -> None:
        with pytest.raises(ValidationError):
            ExerciseCaloriesEstimate(reasoning="x", calories_kcal=0)
        with pytest.raises(ValidationError):
            ExerciseCaloriesEstimate(reasoning="x", calories_kcal=6000)

    def test_reasoning_empty(self) -> None:
        with pytest.raises(ValidationError):
            ExerciseCaloriesEstimate(reasoning="", calories_kcal=100)


class TestParseJsonObjectLoose:
    """历史宽松解析：兼容 markdown 围栏与残缺片段。"""

    def test_plain_json(self) -> None:
        raw = '{"reasoning":"慢跑","calories_kcal":150}'
        d = _parse_json_object_loose(raw)
        assert _coerce_reasoning(d) == "慢跑"
        assert _coerce_calories_kcal(d) == 150

    def test_markdown_fence(self) -> None:
        raw = '```json\n{"reasoning":"骑行","calories_kcal":220}\n```'
        d = _parse_json_object_loose(raw)
        assert _coerce_calories_kcal(d) == 220

    def test_embedded_object(self) -> None:
        raw = '前缀文字 {"reasoning":"游泳","calories_kcal":300} 后缀'
        d = _parse_json_object_loose(raw)
        assert _coerce_calories_kcal(d) == 300


class TestEstimateExerciseCaloriesSyncMocked:
    """Mock OpenAI + Instructor，验证主链路返回。"""

    def test_returns_structured_fields(self) -> None:
        fake_estimate = ExerciseCaloriesEstimate(
            reasoning="假设体重65kg，慢跑30分钟中等强度。",
            calories_kcal=280,
        )
        fake_raw = MagicMock()
        fake_raw.choices = [MagicMock()]
        fake_raw.choices[0].message.content = json.dumps(
            {"reasoning": fake_estimate.reasoning, "calories_kcal": 280},
            ensure_ascii=False,
        )
        fake_estimate._raw_response = fake_raw  # type: ignore[attr-defined]

        with patch.dict(
            "os.environ",
            {"OFOXAI_API_KEY": "test-key"},
            clear=False,
        ):
            with patch("exercise_llm.instructor.from_openai") as from_openai:
                inst = MagicMock()
                inst.chat.completions.create.return_value = fake_estimate
                from_openai.return_value = inst

                cal, raw, reasoning = estimate_exercise_calories_sync(
                    "慢跑30分钟",
                    {"weight_kg": 65.0},
                )

        assert cal == 280
        assert "慢跑" in reasoning or "30" in reasoning
        assert raw  # 有原始或序列化文本

    def test_missing_api_key(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            with pytest.raises(ExerciseLlmError) as ei:
                estimate_exercise_calories_sync("走路")
        assert "未配置" in str(ei.value)

    def test_incomplete_output_falls_back_to_plain_json(self) -> None:
        fake_openai = MagicMock()
        fake_instructor_client = MagicMock()
        fake_instructor_client.chat.completions.create.side_effect = InstructorError(
            "The output is incomplete due to a max_tokens length limit."
        )

        with patch.dict(
            "os.environ",
            {"OFOXAI_API_KEY": "test-key"},
            clear=False,
        ):
            with patch("exercise_llm.OpenAI", return_value=fake_openai):
                with patch(
                    "exercise_llm.instructor.from_openai",
                    return_value=fake_instructor_client,
                ):
                    with patch(
                        "exercise_llm._estimate_exercise_calories_plain_json_fallback",
                        return_value=(185, '{"reasoning":"高强度力量训练","calories_kcal":185}', "高强度力量训练"),
                    ) as fallback:
                        cal, raw, reasoning = estimate_exercise_calories_sync(
                            "负重引体",
                            {"weight_kg": 70.2},
                        )

        assert fallback.called
        assert cal == 185
        assert "185" in raw
        assert reasoning == "高强度力量训练"


class TestExerciseFallbackJson:
    def test_plain_json_fallback_parses_response(self) -> None:
        fake_openai = MagicMock()
        fake_resp = MagicMock()
        fake_resp.choices = [MagicMock()]
        fake_resp.choices[0].message.content = (
            '{"reasoning":"按高强度力量训练估算","calories_kcal":188}'
        )
        fake_openai.chat.completions.create.return_value = fake_resp

        cal, raw, reasoning = _estimate_exercise_calories_plain_json_fallback(
            fake_openai,
            "test-model",
            "用户运动描述：负重引体",
        )

        assert cal == 188
        assert '"calories_kcal":188' in raw
        assert reasoning == "按高强度力量训练估算"

    def test_long_multi_segment_desc_prefers_plain_json(self) -> None:
        desc = (
            "晨跑20分钟：配速6'30\"-7'00\"/公里。\n"
            "跳绳15分钟：中等节奏，3组。\n"
            "俯卧撑10分钟：3组，每组12-15个。"
        )
        assert _should_prefer_plain_json(desc) is True

    def test_split_segments(self) -> None:
        desc = "晨跑20分钟：轻松慢跑。\n跳绳15分钟：中等节奏。\n拉伸10分钟。"
        assert _split_exercise_segments(desc) == [
            "晨跑20分钟：轻松慢跑",
            "跳绳15分钟：中等节奏",
            "拉伸10分钟",
        ]

    def test_parse_first_positive_int(self) -> None:
        assert _parse_first_positive_int("约 245 kcal") == 245

    def test_numeric_fallback_parses_integer(self) -> None:
        fake_openai = MagicMock()
        fake_resp = MagicMock()
        fake_resp.choices = [MagicMock()]
        fake_resp.choices[0].message.content = "245"
        fake_openai.chat.completions.create.return_value = fake_resp

        cal, raw = _estimate_exercise_calories_numeric_fallback(
            fake_openai,
            "test-model",
            "用户运动描述：跳绳15分钟",
        )

        assert cal == 245
        assert raw == "245"

    def test_rule_fallback_uses_duration_and_weight(self) -> None:
        cal, reasoning = _estimate_exercise_calories_rule_fallback(
            "跳绳15分钟，中等节奏",
            {"weight_kg": 70.0},
        )
        assert cal > 0
        assert "跳绳" in reasoning
