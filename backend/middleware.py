"""
认证中间件
用于验证 JWT token 并提取用户信息
"""
from fastapi import HTTPException, Depends, Header
from typing import Optional, Dict
from auth import verify_token, extract_user_info_from_token


async def get_current_user_info(
    authorization: Optional[str] = Header(None)
) -> Dict[str, str]:
    """
    从请求头提取并验证 token，返回用户信息（包含 user_id 和 openid）
    
    Args:
        authorization: Authorization 请求头（格式：Bearer {token}）
    
    Returns:
        dict: 包含 user_id, openid, unionid 等信息的字典
    
    Raises:
        HTTPException: 如果 token 无效或缺失
    """
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="缺少认证信息",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # 提取 token
    try:
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            raise ValueError()
    except ValueError:
        raise HTTPException(
            status_code=401,
            detail="认证格式错误，应为: Bearer {token}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # 验证 token
    payload = verify_token(token)
    if payload is None:
        raise HTTPException(
            status_code=401,
            detail="Token 无效或已过期",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_id = payload.get("user_id")
    openid = payload.get("openid")
    
    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Token 中缺少用户信息",
        )
    
    if not openid:
        raise HTTPException(
            status_code=401,
            detail="Token 中缺少 openid",
        )
    
    return {
        "user_id": user_id,
        "openid": openid,
        "unionid": payload.get("unionid")
    }


async def get_current_user_id(
    authorization: Optional[str] = Header(None)
) -> str:
    """
    从请求头提取并验证 token，返回 user_id
    
    Args:
        authorization: Authorization 请求头（格式：Bearer {token}）
    
    Returns:
        user_id: 用户 ID 字符串
    
    Raises:
        HTTPException: 如果 token 无效或缺失
    """
    user_info = await get_current_user_info(authorization)
    return user_info["user_id"]


async def get_current_openid(
    authorization: Optional[str] = Header(None)
) -> str:
    """
    从请求头提取并验证 token，返回 openid
    
    Args:
        authorization: Authorization 请求头（格式：Bearer {token}）
    
    Returns:
        openid: 微信 openid 字符串
    
    Raises:
        HTTPException: 如果 token 无效或缺失
    """
    user_info = await get_current_user_info(authorization)
    return user_info["openid"]

