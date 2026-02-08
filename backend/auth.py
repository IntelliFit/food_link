"""
JWT Token 生成和验证工具
"""
from datetime import datetime, timedelta
from typing import Optional, Dict
from jose import JWTError, jwt
import os

# JWT 配置
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-this-in-production-min-32-chars")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 36525  # 约 100 年，等效永不过期
REFRESH_TOKEN_EXPIRE_DAYS = 36525  # 约 100 年，等效永不过期


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    创建 JWT token
    
    Args:
        data: 要编码到 token 中的数据（通常包含 user_id, openid 等）
        expires_delta: 过期时间增量，如果为 None 则使用默认值
    
    Returns:
        JWT token 字符串
    """
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    
    to_encode.update({
        "exp": expire,
        "iat": datetime.utcnow()
    })
    
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_token(token: str) -> Optional[dict]:
    """
    验证 JWT token
    
    Args:
        token: JWT token 字符串
    
    Returns:
        解码后的 token 数据，如果无效则返回 None
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def get_user_id_from_token(token: str) -> Optional[str]:
    """
    从 token 中提取 user_id
    
    Args:
        token: JWT token 字符串
    
    Returns:
        user_id，如果 token 无效则返回 None
    """
    payload = verify_token(token)
    if payload:
        return payload.get("user_id")
    return None


def extract_openid_from_token(token: str) -> Optional[str]:
    """
    从 token 中提取 openid
    
    Args:
        token: JWT token 字符串
    
    Returns:
        openid，如果 token 无效则返回 None
    """
    payload = verify_token(token)
    if payload:
        return payload.get("openid")
    return None


def extract_user_info_from_token(token: str) -> Optional[Dict]:
    """
    从 token 中提取完整的用户信息
    
    Args:
        token: JWT token 字符串
    
    Returns:
        包含 user_id, openid, unionid 的字典，如果 token 无效则返回 None
    """
    payload = verify_token(token)
    if payload:
        return {
            "user_id": payload.get("user_id"),
            "openid": payload.get("openid"),
            "unionid": payload.get("unionid")
        }
    return None

