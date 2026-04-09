"""
身体指标：recorded_on 错年纠正与体重 LOCF 趋势（回归 2026-04 前后端错年写入问题）
"""
import pytest
from datetime import date
from unittest.mock import patch

from main import (
    _canonical_recorded_on_body_metric,
    _build_weight_locf_series,
    _aggregate_weight_daily,
)


def _freeze_today_2026_04_07():
    """固定「中国时区今天」为 2026-04-07（Py3.12 不可 patch datetime.datetime.now，改 patch 业务函数）。"""

    return patch("main._today_china_date_for_body_metrics", return_value=date(2026, 4, 7))


@pytest.mark.unit
class TestCanonicalRecordedOnBodyMetric:
    """_canonical_recorded_on_body_metric：与创建时间中国日一致则优先；否则去年同月日平移到当前年。"""

    def test_prefers_china_calendar_when_month_day_match_different_year(self) -> None:
        row = {
            "recorded_on": "2025-04-07",
            "created_at": "2026-04-07T08:30:20.693247+00:00",
        }
        assert _canonical_recorded_on_body_metric(row) == "2026-04-07"

    def test_shifts_previous_year_to_current_when_within_window(self) -> None:
        """UTC 导致创建日中国日与 recorded_on 差一天时，用平移规则对齐到 2026-04-03。"""
        row = {
            "recorded_on": "2025-04-03",
            "created_at": "2026-04-03T17:23:24.108592+00:00",
        }
        with _freeze_today_2026_04_07():
            result = _canonical_recorded_on_body_metric(row)
        assert result == "2026-04-03"

    def test_keeps_raw_when_year_already_matches(self) -> None:
        row = {
            "recorded_on": "2026-04-07",
            "created_at": "2026-04-07T10:00:00+00:00",
        }
        assert _canonical_recorded_on_body_metric(row) == "2026-04-07"


@pytest.mark.unit
class TestAggregateWeightDaily:
    def test_one_entry_per_day_latest_wins(self) -> None:
        rows = [
            {
                "recorded_on": "2026-04-04",
                "weight_kg": 65,
                "created_at": "2026-04-04T10:00:00+00:00",
            },
            {
                "recorded_on": "2026-04-04",
                "weight_kg": 65,
                "created_at": "2026-04-04T18:12:13+00:00",
            },
        ]
        agg = _aggregate_weight_daily(rows)
        assert len(agg) == 1
        assert agg[0]["date"] == "2026-04-04"
        assert agg[0]["value"] == 65.0


@pytest.mark.unit
class TestWeightLocfSeries:
    """区间内无新记录时沿用上次体重。"""

    def test_locf_fills_between_record_days(self) -> None:
        rows = [
            {
                "recorded_on": "2026-04-03",
                "weight_kg": 65,
                "created_at": "2026-04-03T12:00:00+00:00",
            },
            {
                "recorded_on": "2026-04-07",
                "weight_kg": 67,
                "created_at": "2026-04-07T12:00:00+00:00",
            },
        ]
        series = _build_weight_locf_series(rows, "2026-04-01", "2026-04-07")
        by_date = {item["date"]: item["value"] for item in series}
        assert "2026-04-01" not in by_date and "2026-04-02" not in by_date
        assert by_date["2026-04-03"] == 65.0
        assert by_date["2026-04-04"] == 65.0
        assert by_date["2026-04-05"] == 65.0
        assert by_date["2026-04-06"] == 65.0
        assert by_date["2026-04-07"] == 67.0

    def test_locf_with_canonical_wrong_year_rows(self) -> None:
        """错年行经聚合日期纠正后，LOCF 与稀疏日一致。"""
        rows = [
            {
                "recorded_on": "2025-04-03",
                "weight_kg": 65,
                "created_at": "2026-04-03T17:23:24.108592+00:00",
            },
            {
                "recorded_on": "2025-04-07",
                "weight_kg": 67,
                "created_at": "2026-04-07T08:30:20.693247+00:00",
            },
        ]
        with _freeze_today_2026_04_07():
            series = _build_weight_locf_series(rows, "2026-04-01", "2026-04-07")
        by_date = {item["date"]: item["value"] for item in series}
        assert by_date.get("2026-04-03") == 65.0
        assert by_date.get("2026-04-07") == 67.0
