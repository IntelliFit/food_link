"""
JWT 认证模块单元测试
测试 token 生成、验证和解析功能
"""
import pytest
from datetime import timedelta

# 必须在导入 auth 前设置环境变量
import os
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-testing-only-min-32-chars")

from auth import (
    create_access_token,
    verify_token,
    get_user_id_from_token,
    extract_openid_from_token,
    extract_user_info_from_token,
)


class TestJWTToken:
    """JWT Token 相关测试"""
    
    def test_create_access_token_success(self, test_token_payload):
        """测试成功创建 access token"""
        token = create_access_token(test_token_payload)
        
        assert token is not None
        assert isinstance(token, str)
        assert len(token) > 0
        # JWT token 由三部分组成，用 . 分隔
        parts = token.split(".")
        assert len(parts) == 3
    
    def test_create_access_token_with_custom_expiry(self, test_token_payload):
        """测试创建带自定义过期时间的 token"""
        expires = timedelta(hours=1)
        token = create_access_token(test_token_payload, expires_delta=expires)
        
        assert token is not None
        # 验证 token 可以被解码
        payload = verify_token(token)
        assert payload is not None
        assert payload["user_id"] == test_token_payload["user_id"]
    
    def test_verify_valid_token(self, test_token_payload):
        """测试验证有效的 token"""
        token = create_access_token(test_token_payload)
        payload = verify_token(token)
        
        assert payload is not None
        assert payload["user_id"] == test_token_payload["user_id"]
        assert payload["openid"] == test_token_payload["openid"]
        assert payload["unionid"] == test_token_payload["unionid"]
        assert "exp" in payload  # 过期时间
        assert "iat" in payload  # 签发时间
    
    def test_verify_invalid_token(self):
        """测试验证无效的 token"""
        invalid_token = "invalid.token.here"
        payload = verify_token(invalid_token)
        
        assert payload is None
    
    def test_verify_empty_token(self):
        """测试验证空 token"""
        payload = verify_token("")
        
        assert payload is None
    
    def test_verify_malformed_token(self):
        """测试验证格式错误的 token"""
        malformed_tokens = [
            "not.a.valid.jwt.token",  # 部分过多
            "only.two.parts",  # 部分不足
            "single",  # 只有一部分
            "",  # 空字符串
        ]
        
        for token in malformed_tokens:
            payload = verify_token(token)
            assert payload is None, f"Token '{token}' 应该验证失败"


class TestTokenExtraction:
    """Token 信息提取测试"""
    
    def test_get_user_id_from_valid_token(self, test_token_payload):
        """测试从有效 token 提取 user_id"""
        token = create_access_token(test_token_payload)
        user_id = get_user_id_from_token(token)
        
        assert user_id == test_token_payload["user_id"]
    
    def test_get_user_id_from_invalid_token(self):
        """测试从无效 token 提取 user_id"""
        user_id = get_user_id_from_token("invalid.token")
        
        assert user_id is None
    
    def test_extract_openid_from_valid_token(self, test_token_payload):
        """测试从有效 token 提取 openid"""
        token = create_access_token(test_token_payload)
        openid = extract_openid_from_token(token)
        
        assert openid == test_token_payload["openid"]
    
    def test_extract_openid_from_invalid_token(self):
        """测试从无效 token 提取 openid"""
        openid = extract_openid_from_token("invalid.token")
        
        assert openid is None
    
    def test_extract_user_info_from_valid_token(self, test_token_payload):
        """测试从有效 token 提取完整用户信息"""
        token = create_access_token(test_token_payload)
        user_info = extract_user_info_from_token(token)
        
        assert user_info is not None
        assert user_info["user_id"] == test_token_payload["user_id"]
        assert user_info["openid"] == test_token_payload["openid"]
        assert user_info["unionid"] == test_token_payload["unionid"]
    
    def test_extract_user_info_from_invalid_token(self):
        """测试从无效 token 提取用户信息"""
        user_info = extract_user_info_from_token("invalid.token")
        
        assert user_info is None


class TestTokenPayloadVariations:
    """Token payload 变体测试"""
    
    def test_token_with_minimal_payload(self):
        """测试最小 payload 的 token"""
        minimal_payload = {"user_id": "minimal-user"}
        token = create_access_token(minimal_payload)
        payload = verify_token(token)
        
        assert payload is not None
        assert payload["user_id"] == "minimal-user"
    
    def test_token_with_extra_fields(self):
        """测试包含额外字段的 token"""
        extended_payload = {
            "user_id": "extended-user",
            "openid": "openid-123",
            "unionid": "unionid-123",
            "extra_field": "extra_value",
            "nested": {"key": "value"},
        }
        token = create_access_token(extended_payload)
        payload = verify_token(token)
        
        assert payload is not None
        assert payload["user_id"] == "extended-user"
        assert payload["extra_field"] == "extra_value"
        assert payload["nested"] == {"key": "value"}
    
    def test_token_with_unicode_payload(self):
        """测试包含 Unicode 字符的 payload"""
        unicode_payload = {
            "user_id": "用户-123",
            "openid": "openid-测试",
        }
        token = create_access_token(unicode_payload)
        payload = verify_token(token)
        
        assert payload is not None
        assert payload["user_id"] == "用户-123"
        assert payload["openid"] == "openid-测试"
