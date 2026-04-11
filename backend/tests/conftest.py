"""
Pytest 配置文件 - 共享 fixtures 和配置

默认单测超时由 pytest-timeout 提供，见 backend/pytest.ini 中 timeout / timeout_func_only。
单条用例需更长时可使用：@pytest.mark.timeout(300)
"""
import pytest
import os
import sys
from typing import AsyncGenerator, Generator
from datetime import datetime, timedelta

# 确保 backend 目录在 path 中
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 设置测试环境变量
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-testing-only-min-32-chars")
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-key")

# 与 pytest.ini [pytest] timeout 一致；单条用例需更长时使用 @pytest.mark.timeout(N)
DEFAULT_TEST_TIMEOUT_SECONDS = 120


def pytest_collection_modifyitems(config, items) -> None:
    """
    为未显式声明 timeout 的用例打上默认标记，使每个样例在收集结果中均带超时约束（pytest-timeout）。
    """
    if not config.pluginmanager.has_plugin("timeout"):
        return
    for item in items:
        if item.get_closest_marker("timeout") is not None:
            continue
        item.add_marker(pytest.mark.timeout(DEFAULT_TEST_TIMEOUT_SECONDS))


@pytest.fixture
def test_jwt_secret() -> str:
    """测试 JWT 密钥"""
    return "test-secret-key-for-testing-only-min-32-chars"


@pytest.fixture
def test_user_data() -> dict:
    """测试用户数据模板"""
    return {
        "user_id": "test-user-001",
        "openid": "test-openid-001",
        "unionid": "test-unionid-001",
    }


@pytest.fixture
def test_token_payload() -> dict:
    """测试 token payload"""
    return {
        "user_id": "test-user-001",
        "openid": "test-openid-001",
        "unionid": "test-unionid-001",
    }


@pytest.fixture
def sample_user_profile() -> dict:
    """示例用户健康档案数据"""
    return {
        "gender": "male",
        "birthday": "1990-01-01",
        "height": 175,
        "weight": 70,
        "activity_level": "moderate"
    }


@pytest.fixture
def mock_bmr_params() -> dict:
    """BMR 计算测试参数"""
    return {
        "male": {"gender": "male", "weight_kg": 70, "height_cm": 175, "age_years": 30},
        "female": {"gender": "female", "weight_kg": 55, "height_cm": 160, "age_years": 25},
    }


@pytest.fixture
def test_food_record() -> dict:
    """测试食物记录数据"""
    return {
        "id": "test-record-001",
        "user_id": "test-user-001",
        "meal_type": "lunch",
        "food_name": "测试食物",
        "calories": 500,
        "protein": 20,
        "carbs": 60,
        "fat": 15,
        "created_at": datetime.now().isoformat(),
    }


@pytest.fixture(scope="session")
def event_loop():
    """
    创建事件循环的 fixture
    用于异步测试
    """
    import asyncio
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def cleanup_test_data():
    """
    测试数据清理 fixture
    记录需要清理的数据，测试结束后自动清理
    """
    created_records = []
    
    def register(record_id: str, record_type: str = "generic"):
        """注册需要清理的记录"""
        created_records.append({"id": record_id, "type": record_type})
    
    yield register
    
    # 测试结束后清理
    for record in created_records:
        try:
            # 这里可以添加实际的清理逻辑
            # 例如调用数据库删除接口
            pass
        except Exception as e:
            print(f"清理测试数据失败: {record}, 错误: {e}")
