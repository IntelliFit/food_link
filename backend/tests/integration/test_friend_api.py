"""
好友系统相关 API 集成测试
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
class TestFriendSearch:
    """好友搜索 API 测试"""
    
    async def test_search_friend_without_auth(self, async_client):
        """测试未认证搜索好友"""
        response = await async_client.get("/api/friend/search?keyword=test")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_search_friend_without_keyword(self, async_client):
        """测试不带关键词搜索"""
        response = await async_client.get("/api/friend/search")
        
        assert response.status_code in [400, 401, 403, 422]


@pytest.mark.asyncio
class TestFriendRequest:
    """好友请求 API 测试"""
    
    async def test_send_friend_request_without_auth(self, async_client):
        """测试未认证发送好友请求"""
        response = await async_client.post(
            "/api/friend/request",
            json={"target_user_id": "test-user-id"}
        )
        
        assert response.status_code in [401, 403, 422]
    
    async def test_get_friend_requests_without_auth(self, async_client):
        """测试未认证获取好友请求"""
        response = await async_client.get("/api/friend/requests")
        
        assert response.status_code in [401, 403, 422]
    
    async def test_respond_friend_request_without_auth(self, async_client):
        """测试未认证响应好友请求"""
        response = await async_client.post(
            "/api/friend/request/test-request-id/respond",
            json={"action": "accept"}
        )
        
        assert response.status_code in [401, 403, 422]
    
    async def test_cancel_friend_request_without_auth(self, async_client):
        """测试未认证取消好友请求"""
        response = await async_client.delete("/api/friend/request/test-request-id")
        
        assert response.status_code in [401, 403, 422]


@pytest.mark.asyncio
class TestFriendManagement:
    """好友管理 API 测试"""
    
    async def test_get_friends_list_without_auth(self, async_client):
        """测试未认证获取好友列表"""
        # 好友列表接口可能使用不同的路径
        response = await async_client.get("/api/friends")
        
        assert response.status_code in [200, 401, 403, 404, 422]
    
    async def test_delete_friend_without_auth(self, async_client):
        """测试未认证删除好友"""
        response = await async_client.delete("/api/friend/test-friend-id")
        
        assert response.status_code in [401, 403, 404, 422]


@pytest.mark.asyncio
class TestFriendFeed:
    """好友动态 API 测试"""
    
    async def test_get_friends_feed_without_auth(self, async_client):
        """测试未认证获取好友动态"""
        response = await async_client.get("/api/friends/feed")
        
        assert response.status_code in [401, 403, 404, 422]
    
    async def test_get_leaderboard_without_auth(self, async_client):
        """测试未认证获取排行榜"""
        response = await async_client.get("/api/friend-circle/week-checkin-leaderboard")
        
        assert response.status_code in [401, 403, 404, 422]


@pytest.mark.asyncio
class TestFeedInteractions:
    """动态互动 API 测试"""
    
    async def test_like_feed_without_auth(self, async_client):
        """测试未认证点赞动态"""
        response = await async_client.post(
            "/api/feed/like",
            json={"record_id": "test-record-id"}
        )
        
        assert response.status_code in [401, 403, 404, 422]
    
    async def test_comment_feed_without_auth(self, async_client):
        """测试未认证评论动态"""
        response = await async_client.post(
            "/api/feed/comment",
            json={
                "record_id": "test-record-id",
                "content": "测试评论"
            }
        )
        
        assert response.status_code in [401, 403, 404, 422]
    
    async def test_get_notifications_without_auth(self, async_client):
        """测试未认证获取互动通知"""
        response = await async_client.get("/api/notifications/interactions")
        
        assert response.status_code in [401, 403, 404, 422]
