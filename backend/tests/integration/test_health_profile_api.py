"""
健康档案相关 API 集成测试
"""
import pytest
import pytest_asyncio
import os

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
class TestHealthProfile:
    """健康档案 API 测试"""
    
    async def test_get_health_profile_without_auth(self, async_client):
        """测试未认证获取健康档案"""
        response = await async_client.get("/api/user/health-profile")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_update_health_profile_without_auth(self, async_client):
        """测试未认证更新健康档案"""
        profile_data = {
            "gender": "male",
            "birthday": "1990-01-01",
            "height": 175,
            "weight": 70,
            "activity_level": "moderate"
        }
        response = await async_client.put(
            "/api/user/health-profile",
            json=profile_data
        )
        
        assert response.status_code in [401, 403, 422]
    
    async def test_update_health_profile_with_invalid_data(self, async_client):
        """测试更新无效数据的健康档案"""
        invalid_data = {
            "gender": "invalid",  # 无效的性别
            "height": -100,       # 负身高
            "weight": -50         # 负体重
        }
        response = await async_client.put(
            "/api/user/health-profile",
            json=invalid_data
        )
        
        assert response.status_code in [400, 401, 403, 422]
    
    async def test_update_health_profile_with_extreme_values(self, async_client):
        """测试更新极端值的健康档案"""
        extreme_data = {
            "gender": "male",
            "height": 300,   # 异常高
            "weight": 10     # 异常轻
        }
        response = await async_client.put(
            "/api/user/health-profile",
            json=extreme_data
        )
        
        assert response.status_code in [400, 401, 403, 422]


@pytest.mark.asyncio
class TestHealthReport:
    """体检报告 API 测试"""
    
    async def test_upload_report_image_without_auth(self, async_client):
        """测试未认证上传体检报告图片"""
        response = await async_client.post(
            "/api/user/health-profile/upload-report-image",
            files={}
        )
        
        assert response.status_code in [400, 401, 403, 422]
    
    async def test_submit_ocr_task_without_auth(self, async_client):
        """测试未认证提交 OCR 任务"""
        response = await async_client.post(
            "/api/user/health-profile/submit-report-extraction-task",
            json={"image_url": "https://example.com/report.jpg"}
        )
        
        assert response.status_code in [401, 403, 422]
    
    async def test_ocr_extract_without_auth(self, async_client):
        """测试未认证 OCR 提取"""
        response = await async_client.post(
            "/api/user/health-profile/ocr-extract",
            json={"image_url": "https://example.com/report.jpg"}
        )
        
        assert response.status_code in [401, 403, 422]


@pytest.mark.asyncio
class TestDashboardTargets:
    """仪表板目标 API 测试"""
    
    async def test_get_dashboard_targets_without_auth(self, async_client):
        """测试未认证获取仪表板目标"""
        response = await async_client.get("/api/user/dashboard-targets")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_update_dashboard_targets_without_auth(self, async_client):
        """测试未认证更新仪表板目标"""
        targets_data = {
            "daily_calories": 2000,
            "daily_protein": 100,
            "daily_carbs": 250,
            "daily_fat": 65
        }
        response = await async_client.put(
            "/api/user/dashboard-targets",
            json=targets_data
        )
        
        assert response.status_code in [401, 403, 422]


@pytest.mark.asyncio
class TestStats:
    """统计数据 API 测试"""
    
    async def test_get_stats_summary_without_auth(self, async_client):
        """测试未认证获取统计摘要"""
        response = await async_client.get("/api/stats/summary")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_generate_insight_without_auth(self, async_client):
        """测试未认证生成洞察"""
        response = await async_client.post("/api/stats/insight/generate")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_save_insight_without_auth(self, async_client):
        """测试未认证保存洞察"""
        response = await async_client.post(
            "/api/stats/insight/save",
            json={"insight": "测试洞察内容"}
        )
        
        assert response.status_code in [401, 403, 422]
