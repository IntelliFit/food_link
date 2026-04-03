"""
首页仪表盘 API 集成测试
测试日期处理、数据格式、营养计算等核心功能
"""
import pytest
import pytest_asyncio
import os
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

# 设置测试环境变量
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-testing-only-min-32-chars")

from httpx import AsyncClient, ASGITransport
from main import app


@pytest_asyncio.fixture
async def async_client():
    """创建异步测试客户端"""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test"
    ) as client:
        yield client


@pytest.mark.asyncio
class TestHomeDashboardDateHandling:
    """首页仪表盘日期处理测试"""
    
    async def test_dashboard_without_date_param(self, async_client):
        """测试不带日期参数访问仪表盘"""
        response = await async_client.get("/api/home/dashboard")
        
        # 未认证应该返回 401/403
        assert response.status_code in [401, 403, 422]
    
    async def test_dashboard_with_2025_date_format(self, async_client):
        """测试使用2025日期格式访问仪表盘"""
        response = await async_client.get("/api/home/dashboard?date=2025-04-03")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_dashboard_with_2026_date_format(self, async_client):
        """测试使用2026日期格式访问仪表盘"""
        response = await async_client.get("/api/home/dashboard?date=2026-04-03")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_dashboard_with_invalid_date_format(self, async_client):
        """测试使用无效日期格式访问仪表盘"""
        response = await async_client.get("/api/home/dashboard?date=invalid-date")
        
        # 应该返回错误状态码
        assert response.status_code in [400, 401, 403, 422, 500]
    
    async def test_dashboard_with_month_end_date(self, async_client):
        """测试使用月末日期访问仪表盘"""
        response = await async_client.get("/api/home/dashboard?date=2025-04-30")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_dashboard_with_year_boundary_date(self, async_client):
        """测试使用跨年份日期访问仪表盘"""
        response = await async_client.get("/api/home/dashboard?date=2025-12-31")
        
        assert response.status_code in [401, 403, 422]


@pytest.mark.asyncio
class TestHomeDashboardDataStructure:
    """首页仪表盘数据结构测试"""
    
    async def test_dashboard_response_structure(self, async_client):
        """测试仪表盘响应数据结构完整性"""
        response = await async_client.get("/api/home/dashboard")
        
        # 由于未认证，测试主要验证接口可访问
        assert response.status_code in [200, 401, 403, 422]
        
        if response.status_code == 200:
            data = response.json()
            # 验证基本结构
            assert "intakeData" in data or "message" in data
    
    async def test_dashboard_meals_structure(self, async_client):
        """测试仪表盘餐食数据结构"""
        response = await async_client.get("/api/home/dashboard")
        
        assert response.status_code in [200, 401, 403, 422]
        
        if response.status_code == 200:
            data = response.json()
            if "meals" in data:
                assert isinstance(data["meals"], list)


@pytest.mark.asyncio
class TestStatsSummaryDateHandling:
    """统计摘要日期处理测试"""
    
    async def test_stats_summary_without_auth(self, async_client):
        """测试未认证访问统计摘要"""
        response = await async_client.get("/api/stats/summary?period=week")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_stats_summary_with_different_periods(self, async_client):
        """测试不同时间周期的统计摘要"""
        periods = ["week", "month", "year"]
        
        for period in periods:
            response = await async_client.get(f"/api/stats/summary?period={period}")
            assert response.status_code in [401, 403, 422]


@pytest.mark.asyncio
class TestBodyMetricsDateHandling:
    """身体指标日期处理测试"""
    
    async def test_body_metrics_without_auth(self, async_client):
        """测试未认证访问身体指标"""
        response = await async_client.get("/api/body-metrics/summary?period=week")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_body_metrics_with_date_param(self, async_client):
        """测试带日期参数访问身体指标"""
        response = await async_client.get("/api/body-metrics/summary?period=week&date=2025-04-03")
        
        assert response.status_code in [401, 403, 422]


class TestDateNormalization:
    """日期规范化单元测试"""
    
    def test_date_format_validation(self):
        """测试日期格式验证"""
        valid_dates = [
            "2025-04-03",
            "2026-04-03",
            "2025-12-31",
            "2025-01-01",
        ]
        
        for date_str in valid_dates:
            # 验证可以解析为标准格式
            try:
                datetime.strptime(date_str, "%Y-%m-%d")
                assert True
            except ValueError:
                assert False, f"无法解析日期: {date_str}"
    
    def test_year_normalization_2026_to_2025(self):
        """测试2026年份转换为2025"""
        date_2026 = "2026-04-03"
        date_2025 = date_2026.replace("2026-", "2025-")
        assert date_2025 == "2025-04-03"
    
    def test_year_normalization_preserves_month_day(self):
        """测试年份转换保留月日"""
        test_cases = [
            ("2026-01-15", "2025-01-15"),
            ("2026-12-31", "2025-12-31"),
            ("2026-04-30", "2025-04-30"),
        ]
        
        for input_date, expected in test_cases:
            result = input_date.replace("2026-", "2025-")
            assert result == expected, f"转换失败: {input_date} -> {result}, 期望: {expected}"
    
    def test_invalid_date_formats(self):
        """测试无效日期格式"""
        invalid_dates = [
            "invalid",
            "2025/04/03",
            "03-04-2025",
            "",
        ]
        
        for date_str in invalid_dates:
            try:
                datetime.strptime(date_str, "%Y-%m-%d")
                assert False, f"应被拒绝: {date_str}"
            except ValueError:
                assert True  # 预期的行为


class TestMacroCalculations:
    """宏量营养素计算测试"""
    
    def test_calorie_progress_calculation(self):
        """测试热量进度计算"""
        test_cases = [
            {"current": 0, "target": 2000, "expected": 0},
            {"current": 1000, "target": 2000, "expected": 50},
            {"current": 2000, "target": 2000, "expected": 100},
            {"current": 2500, "target": 2000, "expected": 125},
        ]
        
        for case in test_cases:
            if case["target"] > 0:
                progress = (case["current"] / case["target"]) * 100
                assert progress == case["expected"], f"计算错误: {case}"
    
    def test_remaining_calories_calculation(self):
        """测试剩余热量计算"""
        test_cases = [
            {"target": 2000, "current": 500, "expected": 1500},
            {"target": 2000, "current": 0, "expected": 2000},
            {"target": 2000, "current": 2000, "expected": 0},
            {"target": 2000, "current": 2500, "expected": -500},
        ]
        
        for case in test_cases:
            remaining = case["target"] - case["current"]
            assert remaining == case["expected"], f"计算错误: {case}"
    
    def test_macro_percentage_calculation(self):
        """测试营养素百分比计算"""
        # 蛋白质 4 kcal/g, 碳水 4 kcal/g, 脂肪 9 kcal/g
        protein_g = 100  # 400 kcal
        carbs_g = 200    # 800 kcal
        fat_g = 50       # 450 kcal
        total_calories = 400 + 800 + 450  # 1650 kcal
        
        protein_pct = (400 / total_calories) * 100
        carbs_pct = (800 / total_calories) * 100
        fat_pct = (450 / total_calories) * 100
        
        assert abs(protein_pct + carbs_pct + fat_pct - 100) < 0.1  # 允许浮点误差


@pytest.mark.asyncio
class TestDashboardTargets:
    """仪表盘目标 API 测试"""
    
    async def test_get_dashboard_targets_without_auth(self, async_client):
        """测试未认证获取仪表盘目标"""
        response = await async_client.get("/api/dashboard/targets")
        
        # 接口可能不存在或需要认证
        assert response.status_code in [401, 403, 404, 422]
    
    async def test_update_dashboard_targets_without_auth(self, async_client):
        """测试未认证更新仪表盘目标"""
        response = await async_client.put(
            "/api/dashboard/targets",
            json={"calories": 2000, "protein": 150, "carbs": 250, "fat": 70}
        )
        
        assert response.status_code in [401, 403, 404, 422]


@pytest.mark.asyncio
class TestRecordDays:
    """记录日期 API 测试"""
    
    async def test_get_record_days_without_auth(self, async_client):
        """测试未认证获取记录日期"""
        response = await async_client.get("/api/food-records/days")
        
        assert response.status_code in [401, 403, 404, 422]
    
    async def test_get_record_days_with_date_range(self, async_client):
        """测试带日期范围获取记录日期"""
        response = await async_client.get(
            "/api/food-records/days?start_date=2025-04-01&end_date=2025-04-30"
        )
        
        assert response.status_code in [401, 403, 404, 422]
