"""
测试后台 benchmark 评测逻辑单元测试。
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

# 确保以 backend 为根导入
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from test_backend.utils import (  # noqa: E402
    BENCHMARK_VERSION,
    ITEMS_LABEL_MODE,
    TOTAL_LABEL_MODE,
    _serialize_items_for_evaluator,
    calculate_item_weight_evaluation,
    calculate_item_weight_evaluation_with_deepseek,
)


def test_total_label_mode_only_scores_total_weight() -> None:
    evaluation = calculate_item_weight_evaluation(
        predicted_items=[
            {"name": "米饭", "estimatedWeightGrams": 180},
            {"name": "鸡肉", "estimatedWeightGrams": 50},
        ],
        expected_items=[{"name": "总重量", "trueWeightGrams": 250}],
    )

    assert evaluation["benchmarkVersion"] == BENCHMARK_VERSION
    assert evaluation["mode"] == TOTAL_LABEL_MODE
    assert evaluation["estimatedTotalWeight"] == 230.0
    assert evaluation["totalDeviation"] == 8.0
    assert evaluation["foodF1"] is None
    assert evaluation["matchedWeightMaeGrams"] is None
    assert evaluation["finalCompositeScore"] is None


def test_items_mode_returns_food_f1_and_composite_score() -> None:
    evaluation = calculate_item_weight_evaluation(
        predicted_items=[
            {"name": "白米饭", "estimatedWeightGrams": 130},
            {"name": "鸡蛋", "estimatedWeightGrams": 45},
            {"name": "青菜", "estimatedWeightGrams": 50},
        ],
        expected_items=[
            {"name": "米饭", "trueWeightGrams": 120},
            {"name": "鸡蛋", "trueWeightGrams": 50},
            {"name": "西兰花", "trueWeightGrams": 60},
        ],
    )

    assert evaluation["mode"] == ITEMS_LABEL_MODE
    assert evaluation["matchedCount"] == 2
    assert evaluation["missingCount"] == 1
    assert evaluation["extraCount"] == 1
    assert evaluation["foodPrecision"] == pytest.approx(0.6667, abs=1e-4)
    assert evaluation["foodRecall"] == pytest.approx(0.6667, abs=1e-4)
    assert evaluation["foodF1"] == pytest.approx(0.6667, abs=1e-4)
    assert evaluation["matchedWeightMaeGrams"] == pytest.approx(7.5, abs=1e-6)
    assert evaluation["matchedWeightRelativeError"] == pytest.approx(0.0917, abs=1e-4)
    assert evaluation["matchedWeightScore"] == pytest.approx(0.9083, abs=1e-4)
    assert evaluation["finalCompositeScore"] == pytest.approx(0.6055, abs=1e-4)
    assert evaluation["weightedFoodRecall"] == pytest.approx(170 / 230, abs=1e-4)


def test_relative_error_uses_50g_floor_for_small_foods() -> None:
    evaluation = calculate_item_weight_evaluation(
        predicted_items=[
            {"name": "冬瓜", "estimatedWeightGrams": 55},
        ],
        expected_items=[
            {"name": "炖冬瓜（含虾米少量）", "trueWeightGrams": 30},
        ],
    )

    match = evaluation["itemMatches"][0]
    assert match["status"] == "matched"
    assert match["matchType"] in {"contain", "close_equivalent", "exact"}
    assert match["absoluteErrorGrams"] == pytest.approx(25.0, abs=1e-6)
    assert match["relativeError"] == pytest.approx(25 / 30, abs=1e-4)
    assert match["normalizedRelativeError"] == pytest.approx(25 / 50, abs=1e-4)
    assert match["clippedRelativeError"] == pytest.approx(0.5, abs=1e-6)
    assert evaluation["matchedWeightRelativeError"] == pytest.approx(0.5, abs=1e-6)


def test_deepseek_matcher_is_used_when_available(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_matcher(_expected_payload_json: str, _predicted_payload_json: str) -> dict:
        return {
            "assignments": [
                {
                    "expected_index": 0,
                    "predicted_index": 0,
                    "accepted": True,
                    "match_type": "synonym",
                    "confidence": 0.97,
                    "reason": "白米饭可视为米饭同义表达",
                }
            ]
        }

    monkeypatch.setattr(
        "test_backend.utils._match_food_items_with_deepseek_cached",
        fake_matcher,
    )

    evaluation = asyncio.run(
        calculate_item_weight_evaluation_with_deepseek(
            predicted_items=[{"name": "白米饭", "estimatedWeightGrams": 130}],
            expected_items=[{"name": "米饭", "trueWeightGrams": 120}],
        )
    )

    assert evaluation["mode"] == ITEMS_LABEL_MODE
    assert evaluation["evaluatorSource"] == "deepseek"
    assert evaluation["itemMatches"][0]["matchType"] == "synonym"
    assert evaluation["itemMatches"][0]["matchReason"] == "白米饭可视为米饭同义表达"


def test_unmatched_item_keeps_candidate_when_deepseek_omits_rejected_hint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_matcher(_expected_payload_json: str, _predicted_payload_json: str) -> dict:
        return {
            "assignments": [
                {
                    "expected_index": 0,
                    "predicted_index": 0,
                    "accepted": True,
                    "match_type": "close_equivalent",
                    "confidence": 0.9,
                    "reason": "鸡丁和炒鸡肉主体一致",
                },
                {
                    "expected_index": 2,
                    "predicted_index": 2,
                    "accepted": True,
                    "match_type": "synonym",
                    "confidence": 0.97,
                    "reason": "米饭与白米饭同义",
                },
            ]
        }

    monkeypatch.setattr(
        "test_backend.utils._match_food_items_with_deepseek_cached",
        fake_matcher,
    )

    evaluation = asyncio.run(
        calculate_item_weight_evaluation_with_deepseek(
            predicted_items=[
                {"name": "炒鸡肉", "estimatedWeightGrams": 80},
                {"name": "清炒冬瓜", "estimatedWeightGrams": 100},
                {"name": "白米饭", "estimatedWeightGrams": 200},
            ],
            expected_items=[
                {"name": "鸡丁", "trueWeightGrams": 69.7},
                {"name": "炖冬瓜（含虾米少量）", "trueWeightGrams": 130.9},
                {"name": "饭", "trueWeightGrams": 308.1},
            ],
        )
    )

    winter_melon_match = evaluation["itemMatches"][1]
    assert winter_melon_match["status"] == "missing"
    assert winter_melon_match["predictedName"] == "清炒冬瓜"
    assert winter_melon_match["estimatedWeightGrams"] == pytest.approx(100.0, abs=1e-6)
    assert winter_melon_match["matchType"] == "wrong_food"


def test_serialize_items_for_evaluator_includes_mixed_dish_count_and_confidence() -> None:
    payload = _serialize_items_for_evaluator(
        [
            {
                "name": "牛油拌饭",
                "estimatedWeightGrams": 204,
                "isMixedDish": True,
                "count": 1,
                "confidence": 0.83,
            },
            {
                "name": "黑咖啡",
                "estimatedWeightGrams": 245,
            },
        ],
        "estimatedWeightGrams",
    )

    assert payload[0]["is_mixed_dish"] is True
    assert payload[0]["count"] == 1
    assert payload[0]["confidence"] == pytest.approx(0.83, abs=1e-6)
    assert payload[1]["is_mixed_dish"] is False
    assert payload[1]["count"] is None
    assert payload[1]["confidence"] is None


def test_expected_item_mixed_dish_is_inferred_from_label_name() -> None:
    payload = _serialize_items_for_evaluator(
        [
            {
                "name": "清蒸百叶包（含猪肉）",
                "trueWeightGrams": 102.6,
            },
            {
                "name": "咸鸭蛋",
                "trueWeightGrams": 73,
            },
        ],
        "trueWeightGrams",
    )

    assert payload[0]["is_mixed_dish"] is True
    assert payload[1]["is_mixed_dish"] is False
