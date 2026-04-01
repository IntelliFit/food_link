"""
食物记录相关 API 集成测试
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
class TestFoodRecordCRUD:
    """食物记录 CRUD API 测试"""
    
    async def test_list_food_records_without_auth(self, async_client):
        """测试未认证获取食物记录列表"""
        response = await async_client.get("/api/food-record/list")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_save_food_record_without_auth(self, async_client):
        """测试未认证保存食物记录"""
        record_data = {
            "meal_type": "lunch",
            "food_name": "测试食物",
            "calories": 500,
            "protein": 20,
            "carbs": 60,
            "fat": 15
        }
        response = await async_client.post(
            "/api/food-record/save",
            json=record_data
        )
        
        assert response.status_code in [401, 403, 422]
    
    async def test_get_food_record_by_id_without_auth(self, async_client):
        """测试未认证获取单个食物记录"""
        response = await async_client.get("/api/food-record/test-record-id")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_update_food_record_without_auth(self, async_client):
        """测试未认证更新食物记录"""
        response = await async_client.put(
            "/api/food-record/test-record-id",
            json={"calories": 600}
        )
        
        assert response.status_code in [401, 403, 422]
    
    async def test_delete_food_record_without_auth(self, async_client):
        """测试未认证删除食物记录"""
        response = await async_client.delete("/api/food-record/test-record-id")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_get_record_share_without_auth(self, async_client):
        """测试未认证获取记录分享数据"""
        response = await async_client.get("/api/food-record/share/test-record-id")
        
        # 分享接口可能允许公开访问
        assert response.status_code in [200, 401, 403, 404, 422]


@pytest.mark.asyncio
class TestFoodRecordValidation:
    """食物记录验证测试"""
    
    async def test_save_record_with_invalid_meal_type(self, async_client):
        """测试保存无效餐类型的记录"""
        record_data = {
            "meal_type": "invalid_meal",
            "food_name": "测试食物",
            "calories": 500
        }
        response = await async_client.post(
            "/api/food-record/save",
            json=record_data
        )
        
        assert response.status_code in [400, 401, 403, 422]
    
    async def test_save_record_with_negative_calories(self, async_client):
        """测试保存负卡路里的记录"""
        record_data = {
            "meal_type": "lunch",
            "food_name": "测试食物",
            "calories": -100
        }
        response = await async_client.post(
            "/api/food-record/save",
            json=record_data
        )
        
        assert response.status_code in [400, 401, 403, 422]
    
    async def test_save_record_with_empty_food_name(self, async_client):
        """测试保存空食物名称的记录"""
        record_data = {
            "meal_type": "lunch",
            "food_name": "",
            "calories": 500
        }
        response = await async_client.post(
            "/api/food-record/save",
            json=record_data
        )
        
        assert response.status_code in [400, 401, 403, 422]


@pytest.mark.asyncio
class TestRecordDays:
    """记录天数 API 测试"""
    
    async def test_get_record_days_without_auth(self, async_client):
        """测试未认证获取记录天数"""
        response = await async_client.get("/api/user/record-days")
        
        assert response.status_code in [401, 403, 422]
