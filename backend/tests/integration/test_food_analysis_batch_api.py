"""
批量食物分析 API 测试
"""
import os

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-testing-only-min-32-chars")

import main as main_module
from auth import create_access_token
from main import app


TEST_USER_ID = "11111111-2222-3333-4444-555555555555"
TEST_OPENID = "test-openid-batch-api"


def _build_auth_headers() -> dict:
    token = create_access_token(
        {
            "user_id": TEST_USER_ID,
            "openid": TEST_OPENID,
            "unionid": "test-unionid-batch-api",
        }
    )
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def async_client():
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers=_build_auth_headers(),
    ) as client:
        yield client


def _mock_user() -> dict:
    return {
        "id": TEST_USER_ID,
        "openid": TEST_OPENID,
        "unionid": "test-unionid-batch-api",
        "nickname": "测试用户",
        "avatar": "",
        "execution_mode": "standard",
    }


@pytest.mark.asyncio
async def test_analyze_batch_returns_single_image_compatible_result(async_client, monkeypatch):
    captured = {}

    async def mock_get_user_by_id(user_id: str):
        assert user_id == TEST_USER_ID
        return _mock_user()

    async def mock_get_effective_membership(user_id: str):
        return {"user_id": user_id}

    def mock_format_membership_response(membership):
        return membership

    async def mock_validate_food_analysis_access(**kwargs):
        return None, None, None, kwargs.get("effective_mode") or "standard"

    async def mock_analyze_single_image_for_batch(image_url: str, **kwargs):
        if image_url.endswith("1.jpg"):
            return {
                "description": "鸡胸肉沙拉",
                "insight": "蛋白质不错",
                "items": [
                    {
                        "name": "鸡胸肉",
                        "estimatedWeightGrams": 150,
                        "nutrients": {
                            "calories": 248,
                            "protein": 46,
                            "carbs": 0,
                            "fat": 5,
                            "fiber": 0,
                            "sugar": 0,
                        },
                    }
                ],
                "context_advice": "午餐蛋白质够了",
            }
        return {
            "description": "米饭",
            "insight": "主食适中",
            "items": [
                {
                    "name": "米饭",
                    "estimatedWeightGrams": 180,
                    "nutrients": {
                        "calories": 210,
                        "protein": 4,
                        "carbs": 46,
                        "fat": 0.5,
                        "fiber": 0.6,
                        "sugar": 0.1,
                    },
                }
            ],
            "context_advice": "碳水补充合适",
        }

    def mock_create_analysis_task_sync(**kwargs):
        captured["payload"] = kwargs.get("payload")
        captured["image_urls"] = kwargs.get("image_urls")
        return {"id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}

    def mock_update_analysis_task_result_sync(task_id: str, status: str, result: dict):
        captured["task_id"] = task_id
        captured["status"] = status
        captured["result"] = result
        return True

    monkeypatch.setattr(main_module, "get_user_by_id", mock_get_user_by_id)
    monkeypatch.setattr(main_module, "_get_effective_membership", mock_get_effective_membership)
    monkeypatch.setattr(main_module, "_format_membership_response", mock_format_membership_response)
    monkeypatch.setattr(main_module, "_validate_food_analysis_access", mock_validate_food_analysis_access)
    monkeypatch.setattr(main_module, "_analyze_single_image_for_batch", mock_analyze_single_image_for_batch)
    monkeypatch.setattr(main_module, "create_analysis_task_sync", mock_create_analysis_task_sync)
    monkeypatch.setattr(main_module, "update_analysis_task_result_sync", mock_update_analysis_task_result_sync)

    response = await async_client.post(
        "/api/analyze/batch",
        json={
            "image_urls": [
                "https://example.com/food1.jpg",
                "https://example.com/food2.jpg",
            ],
            "meal_type": "lunch",
            "execution_mode": "standard",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["task_id"] == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    assert data["image_count"] == 2

    result = data["result"]
    assert result["description"].startswith("本餐共识别 2 张图片")
    assert len(result["items"]) == 2
    assert result["items"][0]["name"] == "鸡胸肉"
    assert result["items"][1]["name"] == "米饭"
    assert result["pfc_ratio_comment"] is None
    assert result["absorption_notes"] is None
    assert result["context_advice"] == "午餐蛋白质够了 碳水补充合适"
    assert result["recognitionOutcome"] is None
    assert result["followupQuestions"] is None

    assert captured["payload"]["batch_image_count"] == 2
    assert captured["payload"]["failed_indices"] == []
    assert captured["status"] == "done"
    assert len(captured["result"]["items"]) == 2


@pytest.mark.asyncio
async def test_analyze_batch_allows_partial_success(async_client, monkeypatch):
    captured = {}

    async def mock_get_user_by_id(user_id: str):
        return _mock_user()

    async def mock_get_effective_membership(user_id: str):
        return {"user_id": user_id}

    def mock_format_membership_response(membership):
        return membership

    async def mock_validate_food_analysis_access(**kwargs):
        return None, None, None, kwargs.get("effective_mode") or "standard"

    async def mock_analyze_single_image_for_batch(image_url: str, **kwargs):
        if image_url.endswith("2.jpg"):
            raise RuntimeError("rate limited")
        return {
            "description": "水煮蛋",
            "insight": "补充优质蛋白",
            "items": [
                {
                    "name": "鸡蛋",
                    "estimatedWeightGrams": 55,
                    "nutrients": {
                        "calories": 78,
                        "protein": 6.8,
                        "carbs": 0.6,
                        "fat": 5.3,
                        "fiber": 0,
                        "sugar": 0.5,
                    },
                }
            ],
            "context_advice": "适合作为加餐",
        }

    def mock_create_analysis_task_sync(**kwargs):
        captured["payload"] = kwargs.get("payload")
        return {"id": "ffffffff-1111-2222-3333-444444444444"}

    def mock_update_analysis_task_result_sync(task_id: str, status: str, result: dict):
        captured["result"] = result
        return True

    monkeypatch.setattr(main_module, "get_user_by_id", mock_get_user_by_id)
    monkeypatch.setattr(main_module, "_get_effective_membership", mock_get_effective_membership)
    monkeypatch.setattr(main_module, "_format_membership_response", mock_format_membership_response)
    monkeypatch.setattr(main_module, "_validate_food_analysis_access", mock_validate_food_analysis_access)
    monkeypatch.setattr(main_module, "_analyze_single_image_for_batch", mock_analyze_single_image_for_batch)
    monkeypatch.setattr(main_module, "create_analysis_task_sync", mock_create_analysis_task_sync)
    monkeypatch.setattr(main_module, "update_analysis_task_result_sync", mock_update_analysis_task_result_sync)

    response = await async_client.post(
        "/api/analyze/batch",
        json={
            "image_urls": [
                "https://example.com/food1.jpg",
                "https://example.com/food2.jpg",
            ],
            "execution_mode": "standard",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["image_count"] == 2
    assert len(data["result"]["items"]) == 1
    assert captured["payload"]["failed_indices"] == [1]
    assert captured["result"]["items"][0]["name"] == "鸡蛋"


@pytest.mark.asyncio
async def test_analyze_batch_returns_500_when_all_images_fail(async_client, monkeypatch):
    async def mock_get_user_by_id(user_id: str):
        return _mock_user()

    async def mock_get_effective_membership(user_id: str):
        return {"user_id": user_id}

    def mock_format_membership_response(membership):
        return membership

    async def mock_validate_food_analysis_access(**kwargs):
        return None, None, None, kwargs.get("effective_mode") or "standard"

    async def mock_analyze_single_image_for_batch(image_url: str, **kwargs):
        raise RuntimeError("upstream unavailable")

    monkeypatch.setattr(main_module, "get_user_by_id", mock_get_user_by_id)
    monkeypatch.setattr(main_module, "_get_effective_membership", mock_get_effective_membership)
    monkeypatch.setattr(main_module, "_format_membership_response", mock_format_membership_response)
    monkeypatch.setattr(main_module, "_validate_food_analysis_access", mock_validate_food_analysis_access)
    monkeypatch.setattr(main_module, "_analyze_single_image_for_batch", mock_analyze_single_image_for_batch)

    response = await async_client.post(
        "/api/analyze/batch",
        json={
            "image_urls": [
                "https://example.com/food1.jpg",
                "https://example.com/food2.jpg",
            ]
        },
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "所有图片分析均失败，请稍后重试"


@pytest.mark.asyncio
async def test_analyze_batch_gemini_alias_uses_gemini_provider(async_client, monkeypatch):
    async def mock_get_user_by_id(user_id: str):
        return _mock_user()

    async def mock_get_effective_membership(user_id: str):
        return {"user_id": user_id}

    def mock_format_membership_response(membership):
        return membership

    async def mock_validate_food_analysis_access(**kwargs):
        return None, None, None, kwargs.get("effective_mode") or "standard"

    async def mock_analyze_with_gemini(**kwargs):
        assert kwargs["model_name"]
        assert kwargs["image_url"] == "https://example.com/food1.jpg"
        return {
            "description": "水果拼盘",
            "insight": "加餐清爽",
            "items": [
                {
                    "name": "苹果",
                    "estimatedWeightGrams": 120,
                    "nutrients": {
                        "calories": 63,
                        "protein": 0.3,
                        "carbs": 16.8,
                        "fat": 0.2,
                        "fiber": 2.4,
                        "sugar": 12.6,
                    },
                }
            ],
            "context_advice": "晚加餐控制一份即可",
        }

    def mock_create_analysis_task_sync(**kwargs):
        return {"id": "12121212-3434-5656-7878-909090909090"}

    def mock_update_analysis_task_result_sync(task_id: str, status: str, result: dict):
        return True

    monkeypatch.setattr(main_module, "get_user_by_id", mock_get_user_by_id)
    monkeypatch.setattr(main_module, "_get_effective_membership", mock_get_effective_membership)
    monkeypatch.setattr(main_module, "_format_membership_response", mock_format_membership_response)
    monkeypatch.setattr(main_module, "_validate_food_analysis_access", mock_validate_food_analysis_access)
    monkeypatch.setattr(main_module, "_analyze_with_gemini", mock_analyze_with_gemini)
    monkeypatch.setattr(main_module, "create_analysis_task_sync", mock_create_analysis_task_sync)
    monkeypatch.setattr(main_module, "update_analysis_task_result_sync", mock_update_analysis_task_result_sync)

    response = await async_client.post(
        "/api/analyze/batch",
        json={
            "image_urls": ["https://example.com/food1.jpg"],
            "modelName": "gemini",
            "execution_mode": "standard",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["result"]["items"][0]["name"] == "苹果"
