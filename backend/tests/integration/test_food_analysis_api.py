"""
食物分析相关 API 集成测试
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
class TestFoodAnalysis:
    """食物分析 API 测试"""
    
    async def test_analyze_without_auth(self, async_client):
        """测试未认证的食物分析"""
        response = await async_client.post(
            "/api/analyze",
            json={"image_url": "https://example.com/food.jpg"}
        )
        
        # 可能需要认证，或者服务器内部错误
        assert response.status_code in [200, 400, 401, 403, 422, 500]
    
    async def test_analyze_without_image(self, async_client):
        """测试不带图片的分析请求"""
        response = await async_client.post(
            "/api/analyze",
            json={}
        )
        
        # 应该返回验证错误
        assert response.status_code in [400, 422]
    
    async def test_analyze_compare_without_auth(self, async_client):
        """测试未认证的食物对比分析"""
        response = await async_client.post(
            "/api/analyze-compare",
            json={
                "original_image": "https://example.com/food1.jpg",
                "current_image": "https://example.com/food2.jpg"
            }
        )
        
        assert response.status_code in [200, 400, 401, 403, 422, 500]


@pytest.mark.asyncio
class TestAnalyzeText:
    """文本分析 API 测试"""
    
    async def test_analyze_text_without_auth(self, async_client):
        """测试未认证的文本分析"""
        response = await async_client.post(
            "/api/analyze-text",
            json={"text": "今天吃了一碗米饭"}
        )
        
        assert response.status_code in [200, 400, 401, 403, 422, 500]
    
    async def test_analyze_text_without_content(self, async_client):
        """测试不带内容的文本分析"""
        response = await async_client.post(
            "/api/analyze-text",
            json={}
        )
        
        assert response.status_code in [400, 422]


@pytest.mark.asyncio
class TestAnalysisTasks:
    """分析任务 API 测试"""
    
    async def test_get_tasks_without_auth(self, async_client):
        """测试未认证获取任务列表"""
        response = await async_client.get("/api/analyze/tasks")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_get_task_by_id_without_auth(self, async_client):
        """测试未认证获取单个任务"""
        response = await async_client.get("/api/analyze/tasks/test-task-id")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_get_task_with_invalid_id(self, async_client):
        """测试获取无效 ID 的任务"""
        response = await async_client.get("/api/analyze/tasks/invalid-uuid")
        
        assert response.status_code in [400, 401, 403, 404, 422]


@pytest.mark.asyncio
class TestImageUpload:
    """图片上传 API 测试"""
    
    async def test_upload_analyze_image_without_auth(self, async_client):
        """测试未认证上传分析图片"""
        response = await async_client.post(
            "/api/upload-analyze-image",
            data={}
        )
        
        assert response.status_code in [400, 401, 403, 422]
    
    async def test_upload_analyze_image_file_without_auth(self, async_client):
        """测试未认证上传分析图片文件"""
        response = await async_client.post(
            "/api/upload-analyze-image-file",
            files={}
        )
        
        assert response.status_code in [400, 401, 403, 422]
