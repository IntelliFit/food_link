from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
import os
import httpx
import json
import re
import time
from datetime import timedelta
from dotenv import load_dotenv
from auth import create_access_token
from database import get_user_by_openid, create_user, update_user, get_user_by_id
from middleware import get_current_user_info, get_current_user_id, get_current_openid

# 从 .env 文件加载环境变量
load_dotenv()

app = FastAPI(title="食物分析 API", description="基于 DashScope 的食物图片分析服务")

# 缓存 access_token（有效期为 2 小时）
_access_token_cache = {
    "token": None,
    "expires_at": 0
}

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应该限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Nutrients(BaseModel):
    calories: float = 0
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    fiber: float = 0
    sugar: float = 0


class FoodItemResponse(BaseModel):
    name: str
    estimatedWeightGrams: float
    originalWeightGrams: float
    nutrients: Nutrients


class AnalyzeRequest(BaseModel):
    base64Image: str = Field(..., description="Base64 编码的图片数据")
    additionalContext: Optional[str] = Field(default="", description="用户补充的上下文信息")
    modelName: Optional[str] = Field(default="qwen-vl-max", description="使用的模型名称")


class AnalyzeResponse(BaseModel):
    description: str
    insight: str
    items: List[FoodItemResponse]


class LoginRequest(BaseModel):
    code: str = Field(..., description="微信小程序登录凭证 code")
    phoneCode: Optional[str] = Field(default=None, description="获取手机号的 code（可选）")


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


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze_food(request: AnalyzeRequest):
    """
    分析食物图片，返回营养成分和健康建议
    
    - **base64Image**: Base64 编码的图片数据（必需）
    - **additionalContext**: 用户补充的上下文信息（可选）
    - **modelName**: 使用的模型名称（默认: qwen-vl-max）
    """
    try:
        # 获取 API Key
        api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=500,
                detail="缺少 DASHSCOPE_API_KEY（或 API_KEY）环境变量"
            )

        if not request.base64Image:
            raise HTTPException(
                status_code=400,
                detail="base64Image 不能为空"
            )

        # 构建 API URL
        base_url = os.getenv(
            "DASHSCOPE_BASE_URL",
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
        )
        api_url = f"{base_url}/chat/completions"

        # 构建提示词
        prompt = f"""
请作为专业的营养师分析这张食物图片。
1. 识别图中所有不同的食物单品。
2. 估算每种食物的重量（克）和详细营养成分。
3. description: 提供这顿饭的简短中文描述。
4. insight: 提供一个"洞察"建议：基于该餐营养成分的一句话健康建议（例如："蛋白质含量高，适合肌肉恢复"或"建议加点绿叶菜以平衡碳水"）。

{('用户补充背景信息: "' + request.additionalContext + '"。请根据此信息调整对隐形成分或烹饪方式的判断。') if request.additionalContext else ''}

重要：请务必使用**简体中文**返回所有文本内容（包括 name, description, insight）。
请严格按照以下 JSON 格式返回数据，不要包含任何其他文本：

{{
  "items": [
    {{
      "name": "食物名称（简体中文）",
      "estimatedWeightGrams": 重量（数字）,
      "nutrients": {{
        "calories": 热量,
        "protein": 蛋白质,
        "carbs": 碳水,
        "fat": 脂肪,
        "fiber": 纤维,
        "sugar": 糖分
      }}
    }}
  ],
  "description": "餐食描述（简体中文）",
  "insight": "健康建议（简体中文）"
}}
""".strip()

        # 处理 base64 图片数据
        image_data = (
            request.base64Image.split(",")[1]
            if "," in request.base64Image
            else request.base64Image
        )

        # 调用 DashScope API
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                api_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": request.modelName,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": prompt
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/jpeg;base64,{image_data}"
                                    }
                                }
                            ]
                        }
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.7,
                }
            )

            if not response.is_success:
                error_data = response.json() if response.content else {}
                error_message = (
                    error_data.get("error", {}).get("message")
                    or f"DashScope API 错误: {response.status_code}"
                )
                raise HTTPException(
                    status_code=500,
                    detail=error_message
                )

            data = response.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content")

            if not content:
                raise HTTPException(
                    status_code=500,
                    detail="AI 返回了空响应，请检查图片或稍后重试。"
                )

            # 清理可能的 markdown 代码块标记
            json_str = re.sub(r"```json", "", content)
            json_str = re.sub(r"```", "", json_str)
            json_str = json_str.strip()

            # 解析 JSON
            try:
                parsed = json.loads(json_str)
            except json.JSONDecodeError:
                raise HTTPException(
                    status_code=500,
                    detail="AI 数据解析失败，请重试。"
                )

            # 验证和转换 items
            valid_items = []
            if isinstance(parsed.get("items"), list):
                for item in parsed["items"]:
                    nutrients = Nutrients(
                        calories=float(item.get("nutrients", {}).get("calories", 0) or 0),
                        protein=float(item.get("nutrients", {}).get("protein", 0) or 0),
                        carbs=float(item.get("nutrients", {}).get("carbs", 0) or 0),
                        fat=float(item.get("nutrients", {}).get("fat", 0) or 0),
                        fiber=float(item.get("nutrients", {}).get("fiber", 0) or 0),
                        sugar=float(item.get("nutrients", {}).get("sugar", 0) or 0),
                    )
                    weight = float(item.get("estimatedWeightGrams", 0) or 0)
                    valid_items.append(
                        FoodItemResponse(
                            name=str(item.get("name", "未知食物")),
                            estimatedWeightGrams=weight,
                            originalWeightGrams=weight,
                            nutrients=nutrients,
                        )
                    )

            return AnalyzeResponse(
                description=str(parsed.get("description", "无法获取描述")),
                insight=str(parsed.get("insight", "保持健康饮食！")),
                items=valid_items,
            )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[api/analyze] error: {e}")
        raise HTTPException(
            status_code=500,
            detail=str(e) or "连接 AI 服务失败"
        )


@app.get("/")
async def root():
    """健康检查端点"""
    return {"message": "食物分析 API 服务运行中", "status": "ok"}


@app.get("/health")
async def health():
    """健康检查端点"""
    return {"status": "healthy"}


class UpdateUserInfoRequest(BaseModel):
    nickname: Optional[str] = None
    avatar: Optional[str] = None
    telephone: Optional[str] = None


@app.get("/api/user/profile")
async def get_user_profile(
    user_info: dict = Depends(get_current_user_info)
):
    """
    获取当前用户信息（需要认证）
    """
    user_id = user_info["user_id"]
    openid = user_info["openid"]
    
    # 从数据库获取完整用户信息
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    return {
        "id": user["id"],
        "openid": user["openid"],
        "unionid": user.get("unionid"),
        "nickname": user.get("nickname", ""),
        "avatar": user.get("avatar", ""),
        "telephone": user.get("telephone"),
        "create_time": user.get("create_time"),
        "update_time": user.get("update_time")
    }


@app.put("/api/user/profile")
async def update_user_profile(
    update_data: UpdateUserInfoRequest,
    user_info: dict = Depends(get_current_user_info)
):
    """
    更新当前用户信息（需要认证）
    """
    user_id = user_info["user_id"]
    
    # 构建更新数据（只包含非空字段）
    update_dict = {}
    if update_data.nickname is not None:
        update_dict["nickname"] = update_data.nickname
    if update_data.avatar is not None:
        update_dict["avatar"] = update_data.avatar
    if update_data.telephone is not None:
        update_dict["telephone"] = update_data.telephone
    
    if not update_dict:
        raise HTTPException(status_code=400, detail="没有要更新的字段")
    
    # 更新用户信息
    try:
        updated_user = await update_user(user_id, update_dict)
        return {
            "id": updated_user["id"],
            "openid": updated_user["openid"],
            "unionid": updated_user.get("unionid"),
            "nickname": updated_user.get("nickname", ""),
            "avatar": updated_user.get("avatar", ""),
            "telephone": updated_user.get("telephone"),
            "create_time": updated_user.get("create_time"),
            "update_time": updated_user.get("update_time")
        }
    except Exception as e:
        print(f"[update_user_profile] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"更新用户信息失败: {str(e)}")


async def get_access_token() -> str:
    """
    获取微信小程序 access_token
    参考文档: https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-access-token/api_getaccesstoken.html
    """
    global _access_token_cache
    
    # 检查缓存是否有效（提前 5 分钟刷新）
    current_time = int(time.time())
    if _access_token_cache["token"] and _access_token_cache["expires_at"] > current_time + 300:
        print(f"[get_access_token] 使用缓存的 access_token: {_access_token_cache['token']}")
        print(f"[get_access_token] 缓存过期时间: {_access_token_cache['expires_at']} (时间戳)")
        return _access_token_cache["token"]
    
    appid = os.getenv("APPID")
    secret = os.getenv("SECRET")
    
    if not appid or not secret:
        raise HTTPException(
            status_code=500,
            detail="缺少 APPID 或 SECRET 环境变量"
        )
    
    # 调用微信接口获取 access_token
    token_url = "https://api.weixin.qq.com/cgi-bin/token"
    
    async with httpx.AsyncClient(timeout=10.0) as client:
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
        
        # 检查错误
        if "errcode" in data and data["errcode"] != 0:
            error_msg = data.get("errmsg", "未知错误")
            raise HTTPException(
                status_code=500,
                detail=f"获取 access_token 失败: {error_msg} (错误码: {data.get('errcode')})"
            )
        
        access_token = data.get("access_token")
        expires_in = data.get("expires_in", 7200)  # 默认 2 小时
        
        # 打印 access_token
        print(f"[get_access_token] access_token: {access_token}")
        print(f"[get_access_token] expires_in: {expires_in} 秒")
        print(f"[get_access_token] 过期时间: {current_time + expires_in} (时间戳)")
        
        # 更新缓存
        _access_token_cache["token"] = access_token
        _access_token_cache["expires_at"] = current_time + expires_in
        
        return access_token


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


@app.post("/api/login", response_model=LoginResponse)
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
            
            user = await create_user(user_data)
            user_id = user["id"]
            print(f"[api/login] 新用户创建成功，user_id: {user_id}")
        
        # 5. 生成 JWT token
        token_data = {
            "user_id": user_id,
            "openid": openid,
            "unionid": unionid,
            "sub": user_id  # JWT 标准字段
        }
        
        # Access token（7 天有效期）
        access_token = create_access_token(
            data=token_data,
            expires_delta=timedelta(days=7)
        )
        
        # Refresh token（30 天有效期）
        refresh_token = create_access_token(
            data={"user_id": user_id, "openid": openid, "type": "refresh"},
            expires_delta=timedelta(days=30)
        )
        
        # 6. 返回登录结果
        return LoginResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            expires_in=7 * 24 * 60 * 60,  # 7 天的秒数
            user_id=user_id,
            openid=openid,
            unionid=unionid,
            phoneNumber=phone_number,
            purePhoneNumber=pure_phone_number,
            countryCode=country_code
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

