"""
保质期与活动类查询接口：未认证时的行为及查询参数可解析性（与 main 路由一致）。
"""
import os

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-testing-only-min-32-chars")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app


@pytest_asyncio.fixture
async def async_client():
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client


@pytest.mark.asyncio
class TestExpiryQueriesUnauthenticated:
    """快到期 / 保质期相关列表与仪表盘"""

    async def test_expiry_dashboard_requires_auth(self, async_client: AsyncClient) -> None:
        response = await async_client.get("/api/expiry/dashboard")
        assert response.status_code in (401, 403, 422)

    async def test_expiry_items_requires_auth(self, async_client: AsyncClient) -> None:
        response = await async_client.get("/api/expiry/items")
        assert response.status_code in (401, 403, 422)

    async def test_expiry_items_with_status_param(self, async_client: AsyncClient) -> None:
        response = await async_client.get("/api/expiry/items?status=active")
        assert response.status_code in (401, 403, 422)


@pytest.mark.asyncio
class TestBodyMetricsExerciseRangeQueriesUnauthenticated:
    """一段时间内喝水、体重摘要与运动记录（需登录；此处仅验证路由与参数）"""

    async def test_body_metrics_summary_week_and_month(self, async_client: AsyncClient) -> None:
        for rng in ("week", "month"):
            response = await async_client.get(f"/api/body-metrics/summary?range={rng}")
            assert response.status_code in (401, 403, 422)

    async def test_exercise_logs_with_date_range(self, async_client: AsyncClient) -> None:
        response = await async_client.get(
            "/api/exercise-logs?start_date=2026-01-01&end_date=2026-04-07"
        )
        assert response.status_code in (401, 403, 422)

    async def test_exercise_logs_with_single_date(self, async_client: AsyncClient) -> None:
        response = await async_client.get("/api/exercise-logs?date=2026-04-01")
        assert response.status_code in (401, 403, 422)
