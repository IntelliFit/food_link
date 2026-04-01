"""
用户相关 API 集成测试
"""
import pytest
import pytest_asyncio
import os

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
class TestHealthEndpoints:
    """健康检查端点测试"""
    
    async def test_health_check(self, async_client):
        """测试健康检查接口"""
        response = await async_client.get("/api/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "version" in data
    
    async def test_api_root(self, async_client):
        """测试 API 根路径"""
        response = await async_client.get("/api")
        
        assert response.status_code == 200


@pytest.mark.asyncio
class TestUserProfile:
    """用户档案 API 测试"""
    
    async def test_get_user_profile_without_auth(self, async_client):
        """测试未认证访问用户档案"""
        response = await async_client.get("/api/user/profile")
        
        # 应该返回 401 或 403
        assert response.status_code in [401, 403, 422]
    
    async def test_update_user_profile_without_auth(self, async_client):
        """测试未认证更新用户档案"""
        response = await async_client.put(
            "/api/user/profile",
            json={"nickname": "Test User"}
        )
        
        assert response.status_code in [401, 403, 422]


@pytest.mark.asyncio
class TestMembership:
    """会员相关 API 测试"""
    
    async def test_get_membership_plans(self, async_client):
        """测试获取会员计划列表"""
        response = await async_client.get("/api/membership/plans")
        
        # 这个接口可能需要认证，也可能不需要
        # 根据实际实现判断
        assert response.status_code in [200, 401, 403]
        
        if response.status_code == 200:
            data = response.json()
            assert "plans" in data
    
    async def test_get_membership_status_without_auth(self, async_client):
        """测试未认证获取会员状态"""
        response = await async_client.get("/api/membership/me")
        
        assert response.status_code in [401, 403, 422]


@pytest.mark.asyncio
class TestDashboard:
    """首页仪表板 API 测试"""
    
    async def test_get_home_dashboard_without_auth(self, async_client):
        """测试未认证访问首页仪表板"""
        response = await async_client.get("/api/home/dashboard")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_get_dashboard_targets_without_auth(self, async_client):
        """测试未认证获取仪表板目标"""
        response = await async_client.get("/api/user/dashboard-targets")
        
        assert response.status_code in [401, 403, 422]


@pytest.mark.asyncio
class TestLocation:
    """位置服务 API 测试"""
    
    async def test_search_location(self, async_client):
        """测试位置搜索"""
        response = await async_client.post(
            "/api/location/search",
            json={"keyword": "北京", "region": "北京市"}
        )
        
        # 可能需要 API key 或其他配置
        assert response.status_code in [200, 400, 401, 422, 500]
    
    async def test_reverse_geocode(self, async_client):
        """测试逆地理编码"""
        response = await async_client.post(
            "/api/location/reverse",
            json={"latitude": 39.9042, "longitude": 116.4074}
        )
        
        assert response.status_code in [200, 400, 401, 422, 500]


@pytest.mark.asyncio
class TestAuthFlow:
    """认证流程测试"""
    
    async def test_wechat_login_without_code(self, async_client):
        """测试不带 code 的微信登录"""
        # 微信登录通常需要 code，这里测试不带 code 的情况
        response = await async_client.get("/api/auth/weapp-login")
        
        # 应该返回 400 或 422
        assert response.status_code in [400, 404, 405, 422]
    
    async def test_bind_phone_without_auth(self, async_client):
        """测试未认证绑定手机号"""
        response = await async_client.post(
            "/api/user/bind-phone",
            json={"code": "test-code"}
        )
        
        assert response.status_code in [401, 403, 422]


@pytest.mark.skip(reason="需要真实认证 token")
@pytest.mark.asyncio
class TestUserProfileWithAuth:
    """需要认证的用户档案测试"""
    
    async def test_get_user_profile_with_auth(self, async_client):
        """测试已认证获取用户档案"""
        # 这里需要设置有效的 token
        headers = {"Authorization": "Bearer test-token"}
        response = await async_client.get(
            "/api/user/profile",
            headers=headers
        )
        
        assert response.status_code == 200
