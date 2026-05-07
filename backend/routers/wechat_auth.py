from __future__ import annotations

import base64
import os
import time
import traceback
from datetime import timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from auth import create_access_token
from database import get_user_by_openid, update_user
from user_points import create_new_user_with_points

router = APIRouter()

# ?? access_token????? 2 ???
_access_token_cache = {
    "token": None,
    "expires_at": 0,
}


class LoginRequest(BaseModel):
    code: str = Field(..., description="微信小程序登录凭证 code")
    phoneCode: Optional[str] = Field(default=None, description="获取手机号的 code（可选）")
    inviteCode: Optional[str] = Field(default=None, description="注册邀请码（可选，新用户首次注册时有效）")
    testOpenid: Optional[str] = Field(default=None, description="开发环境测试用：模拟新用户的 openid（仅本地开发有效）")


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # token 过期时间（秒）
    user_id: str
    openid: str
    unionid: Optional[str] = None
    phoneNumber: Optional[str] = None
    purePhoneNumber: Optional[str] = None
    countryCode: Optional[str] = None
    diet_goal: Optional[str] = None


async def get_access_token() -> str:
    """
    获取微信小程序 access_token
    参考文档: https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-access-token/api_getaccesstoken.html
    """
    global _access_token_cache
    
    # 按照需求：第一次获取后缓存，如果过去一个半小时（1.5 * 3600 = 5400秒），重新获取
    current_time = int(time.time())
    
    # 确保 cache 字典拥有 fetched_at 字段
    if "fetched_at" not in _access_token_cache:
        _access_token_cache["fetched_at"] = 0

    # 如果 token 存在，且当前时间距离上次获取时间还未超过一个半小时（5400秒）
    if _access_token_cache["token"] and (current_time - _access_token_cache["fetched_at"] < 5400):
        print(f"[get_access_token] 使用缓存的 access_token: {_access_token_cache['token']}")
        print(f"[get_access_token] 距离上次获取已过: {current_time - _access_token_cache['fetched_at']} 秒 (缓存有效期: 5400秒)")
        return _access_token_cache["token"]
    
    appid = os.getenv("APPID")
    secret = os.getenv("SECRET")
    
    if not appid or not secret:
        raise HTTPException(
            status_code=500,
            detail="缺少 APPID 或 SECRET 环境变量"
        )
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        # 1) 优先使用微信推荐的 stable_token 接口，减少多实例并发导致 token 失效
        stable_url = "https://api.weixin.qq.com/cgi-bin/stable_token"
        stable_resp = await client.post(
            stable_url,
            json={
                "grant_type": "client_credential",
                "appid": appid,
                "secret": secret,
                "force_refresh": False,
            },
        )
        if stable_resp.is_success:
            data = stable_resp.json()
            if not data.get("errcode"):
                access_token = data.get("access_token")
                expires_in = data.get("expires_in", 7200)
                if access_token:
                    _access_token_cache["token"] = access_token
                    _access_token_cache["fetched_at"] = current_time
                    _access_token_cache["expires_at"] = current_time + expires_in
                    print(f"[get_access_token] 使用 stable_token，expires_in={expires_in}")
                    return access_token
            else:
                print(f"[get_access_token] stable_token 返回错误: {data}")

        # 2) 回退到老接口，兼容部分账号/环境
        token_url = "https://api.weixin.qq.com/cgi-bin/token"
        response = await client.get(
            token_url,
            params={
                "grant_type": "client_credential",
                "appid": appid,
                "secret": secret
            }
        )
        if not response.is_success:
            raise HTTPException(
                status_code=500,
                detail=f"获取 access_token 失败: {response.status_code}"
            )
        data = response.json()
        if "errcode" in data and data["errcode"] != 0:
            error_msg = data.get("errmsg", "未知错误")
            raise HTTPException(
                status_code=500,
                detail=f"获取 access_token 失败: {error_msg} (错误码: {data.get('errcode')})"
            )
        access_token = data.get("access_token")
        expires_in = data.get("expires_in", 7200)
        _access_token_cache["token"] = access_token
        _access_token_cache["fetched_at"] = current_time
        _access_token_cache["expires_at"] = current_time + expires_in
        print(f"[get_access_token] 回退 token 接口成功，expires_in={expires_in}")
        return access_token


class QRCodeRequest(BaseModel):
    """请求小程序二维码参数"""
    scene: str = Field(..., description="最大32个可见字符，只支持数字，大小写英文以及部分特殊字符")
    page: Optional[str] = Field(None, description="必须是已经发布的小程序存在的页面")
    width: Optional[int] = Field(430, description="二维码的宽度，单位 px，最小 280px，最大 1280px")
    check_path: Optional[bool] = Field(False, description="检查 page 是否存在")
    env_version: Optional[str] = Field("release", description="要打开的小程序版本")

@router.post("/api/qrcode")
async def get_unlimited_qrcode(request: QRCodeRequest):
    """
    获取小程序二维码并返回 Base64 编码的图片
    """
    payload = {
        "scene": request.scene,
        "width": request.width,
        "check_path": request.check_path,
        "env_version": request.env_version
    }
    if request.page is not None:
        payload["page"] = request.page

    async with httpx.AsyncClient(timeout=15.0) as client:
        # 最多尝试两次：第一次走缓存 token；若提示 token 无效则清缓存并强制刷新后再试一次
        for attempt in range(2):
            access_token = await get_access_token()
            url = f"https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token={access_token}"
            response = await client.post(url, json=payload)

            if not response.is_success:
                raise HTTPException(status_code=500, detail="请求微信二维码接口失败")

            content_type = response.headers.get("Content-Type", "")
            if "application/json" in content_type:
                err_data = response.json()
                errcode = int(err_data.get("errcode") or 0)
                errmsg = err_data.get("errmsg", "未知错误")
                # 40001/42001: token 无效或过期，自动清缓存重试
                if attempt == 0 and errcode in (40001, 42001):
                    print(f"[api/qrcode] token 失效，清缓存后重试: {err_data}")
                    _access_token_cache["token"] = None
                    _access_token_cache["fetched_at"] = 0
                    _access_token_cache["expires_at"] = 0
                    continue
                raise HTTPException(status_code=500, detail=f"生成二维码失败: {errmsg}")

            image_bytes = response.content
            base64_str = base64.b64encode(image_bytes).decode("utf-8")
            data_uri = f"data:image/jpeg;base64,{base64_str}"
            return {"base64": data_uri}

    raise HTTPException(status_code=500, detail="生成二维码失败")


async def get_phone_number(phone_code: str) -> dict:
    """
    获取用户手机号
    参考文档: https://developers.weixin.qq.com/miniprogram/dev/server/API/user-info/phone-number/api_getphonenumber.html
    """
    access_token = await get_access_token()
    print(f"[get_phone_number] 使用 access_token 获取手机号，phone_code: {phone_code}")
    
    phone_url = "https://api.weixin.qq.com/wxa/business/getuserphonenumber"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            f"{phone_url}?access_token={access_token}",
            json={
                "code": phone_code
            }
        )
        
        if not response.is_success:
            raise HTTPException(
                status_code=500,
                detail=f"获取手机号失败: {response.status_code}"
            )
        
        data = response.json()
        
        # 检查错误
        if "errcode" in data and data["errcode"] != 0:
            error_msg = data.get("errmsg", "未知错误")
            raise HTTPException(
                status_code=400,
                detail=f"获取手机号失败: {error_msg} (错误码: {data.get('errcode')})"
            )
        
        phone_info = data.get("phone_info", {})
        phone_number = phone_info.get("phoneNumber")
        pure_phone_number = phone_info.get("purePhoneNumber")
        country_code = phone_info.get("countryCode")
        
        # 打印手机号信息
        print(f"[get_phone_number] 获取手机号成功:")
        print(f"  - phoneNumber (含区号): {phone_number}")
        print(f"  - purePhoneNumber (不含区号): {pure_phone_number}")
        print(f"  - countryCode (国家区号): {country_code}")
        if phone_info.get("watermark"):
            watermark = phone_info.get("watermark", {})
            print(f"  - watermark.timestamp: {watermark.get('timestamp')}")
            print(f"  - watermark.appid: {watermark.get('appid')}")
        
        return {
            "phoneNumber": phone_number,
            "purePhoneNumber": pure_phone_number,
            "countryCode": country_code
        }


@router.post("/api/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """
    微信小程序登录接口
    
    - **code**: 微信小程序通过 wx.login 获取的临时登录凭证
    - **phoneCode**: 获取手机号的 code（可选，需要用户授权）
    
    流程：
    1. 调用微信接口获取 openid/unionid
    2. 检查 weapp_user 表中是否存在该用户
    3. 如果不存在，创建新用户记录
    4. 如果存在，直接使用现有用户
    5. 生成 JWT token 返回给前端
    """
    try:
        # 1. 获取小程序配置
        appid = os.getenv("APPID")
        secret = os.getenv("SECRET")
        
        if not appid or not secret:
            raise HTTPException(
                status_code=500,
                detail="缺少 APPID 或 SECRET 环境变量"
            )
        
        if not request.code:
            raise HTTPException(
                status_code=400,
                detail="code 不能为空"
            )
        
        # 2. 调用微信 code2Session 接口获取 openid/unionid
        wechat_api_url = "https://api.weixin.qq.com/sns/jscode2session"
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                wechat_api_url,
                params={
                    "appid": appid,
                    "secret": secret,
                    "js_code": request.code,
                    "grant_type": "authorization_code"
                }
            )
            
            if not response.is_success:
                raise HTTPException(
                    status_code=500,
                    detail=f"微信接口调用失败: {response.status_code}"
                )
            
            data = response.json()
            
            # 检查微信接口返回的错误
            if "errcode" in data and data["errcode"] != 0:
                error_msg = data.get("errmsg", "未知错误")
                raise HTTPException(
                    status_code=400,
                    detail=f"微信登录失败: {error_msg} (错误码: {data.get('errcode')})"
                )
            
            openid = data.get("openid", "")
            unionid = data.get("unionid")
            session_key = data.get("session_key", "")  # 后端保存，不返回前端
            
            # 开发环境测试：支持 testOpenid 模拟新用户
            test_openid = (request.testOpenid or "").strip()
            if test_openid and os.getenv("NODE_ENV") == "development":
                openid = test_openid
                print(f"[api/login] 开发环境使用 testOpenid: {openid}")
            
            if not openid:
                raise HTTPException(
                    status_code=400,
                    detail="微信登录失败：未获取到 openid"
                )
        
        # 3. 获取手机号（如果提供了 phoneCode）
            phone_number = None
            pure_phone_number = None
            country_code = None
            
            if request.phoneCode:
                print(f"[api/login] 收到 phoneCode，开始获取手机号: {request.phoneCode}")
                try:
                    phone_info = await get_phone_number(request.phoneCode)
                    phone_number = phone_info.get("phoneNumber")
                    pure_phone_number = phone_info.get("purePhoneNumber")
                    country_code = phone_info.get("countryCode")
                    print(f"[api/login] 手机号获取成功:")
                    print(f"  - phoneNumber: {phone_number}")
                    print(f"  - purePhoneNumber: {pure_phone_number}")
                    print(f"  - countryCode: {country_code}")
                except Exception as phone_error:
                    print(f"[api/login] 获取手机号失败: {phone_error}")
                    import traceback
                    print(f"[api/login] 错误详情: {traceback.format_exc()}")
                    # 手机号获取失败不影响登录流程，继续返回其他信息
        
        # 4. 检查用户是否已存在
        user = await get_user_by_openid(openid)
        
        if user:
            # 用户已存在，更新信息（如果有新数据）
            user_id = user["id"]
            update_data = {}
            
            if unionid and not user.get("unionid"):
                update_data["unionid"] = unionid
            if pure_phone_number and not user.get("telephone"):
                update_data["telephone"] = pure_phone_number
            
            if update_data:
                print(f"[api/login] 更新用户信息: {update_data}")
                user = await update_user(user_id, update_data)
            
            print(f"[api/login] 用户已存在，user_id: {user_id}, openid: {openid}")
        else:
            # 新用户，创建记录
            print(f"[api/login] 创建新用户，openid: {openid}")
            user_data = {
                "openid": openid,
                "unionid": unionid,
                "avatar": "",
                "nickname": "",
                "telephone": pure_phone_number
            }
            
            # 新用户：使用 create_new_user_with_points 以支持邀请码绑定
            invite_code_for_new_user = (request.inviteCode or "").strip().upper() or None
            user = await create_new_user_with_points(user_data, invite_code_from_client=invite_code_for_new_user)
            user_id = user["id"]
            print(f"[api/login] 新用户创建成功，user_id: {user_id}, invite_code: {invite_code_for_new_user or '无'}")
        
        # 5. 若未通过本次请求获取到手机号，但用户库中已有手机号，则从库中带回前端（免二次授权）
        if not pure_phone_number and user.get("telephone"):
            pure_phone_number = user.get("telephone")
            phone_number = user.get("telephone")

        # 6. 生成 JWT token
        token_data = {
            "user_id": user_id,
            "openid": openid,
            "unionid": unionid,
            "sub": user_id  # JWT 标准字段
        }
        
        # Access token（永不过期）
        access_token = create_access_token(
            data=token_data,
            expires_delta=timedelta(days=36525)
        )
        
        # Refresh token（永不过期）
        refresh_token = create_access_token(
            data={"user_id": user_id, "openid": openid, "type": "refresh"},
            expires_delta=timedelta(days=36525)
        )
        
        # 7. 返回登录结果
        return LoginResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            expires_in=36525 * 24 * 60 * 60,  # 约 100 年秒数
            user_id=user_id,
            openid=openid,
            unionid=unionid,
            phoneNumber=phone_number,
            purePhoneNumber=pure_phone_number,
            countryCode=country_code,
            diet_goal=user.get("diet_goal")
        )
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/login] error: {e}")
        import traceback
        print(f"[api/login] 错误详情: {traceback.format_exc()}")
        raise HTTPException(
            status_code=500,
            detail=str(e) or "登录失败"
        )
