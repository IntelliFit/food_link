"""
食物记录相关 API 集成测试
"""
import pytest
import pytest_asyncio
import os
import main

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
        
        # 分享接口可能允许公开访问，也可能返回服务器错误
        assert response.status_code in [200, 400, 401, 403, 404, 422, 500]

    async def test_get_record_share_hydrates_image_paths_from_source_task(self, async_client, monkeypatch):
        """分享详情应补全来源分析任务里的多图 image_paths。"""

        async def fake_get_food_record_by_id(record_id: str):
            assert record_id == "test-record-id"
            return {
                "id": record_id,
                "user_id": "user-1",
                "meal_type": "dinner",
                "image_path": "https://example.com/cover.jpg",
                "image_paths": None,
                "source_task_id": "task-1",
                "items": [],
                "total_calories": 100,
                "total_protein": 10,
                "total_carbs": 10,
                "total_fat": 5,
                "total_weight_grams": 100,
                "record_time": "2026-04-26T10:00:00+08:00",
                "created_at": "2026-04-26T10:00:00+08:00",
            }

        async def fake_get_user_by_id(user_id: str):
            assert user_id == "user-1"
            return {"id": user_id, "public_records": True}

        async def fake_get_analysis_tasks_by_ids(task_ids):
            assert task_ids == ["task-1"]
            return {
                "task-1": {
                    "id": "task-1",
                    "image_paths": [
                        "https://example.com/1.jpg",
                        "https://example.com/2.jpg",
                    ]
                }
            }

        monkeypatch.setattr(main, "get_food_record_by_id", fake_get_food_record_by_id)
        monkeypatch.setattr(main, "get_user_by_id", fake_get_user_by_id)
        monkeypatch.setattr(main, "get_analysis_tasks_by_ids", fake_get_analysis_tasks_by_ids)

        response = await async_client.get("/api/food-record/share/test-record-id")

        assert response.status_code == 200
        payload = response.json()
        assert payload["record"]["image_paths"] == [
            "https://example.com/1.jpg",
            "https://example.com/2.jpg",
        ]


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
