# 微信小程序登录和鉴权实现说明

## 功能概述

已实现完整的微信小程序登录流程和 JWT token 鉴权机制：

1. **登录接口** (`/api/login`): 处理微信登录，检查/创建用户，生成 JWT token
2. **鉴权中间件**: 自动验证请求中的 token 并提取用户信息
3. **用户信息接口** (`/api/user/profile`): 演示如何使用鉴权中间件

## 环境变量配置

在 `.env` 文件中添加以下配置：

```env
# JWT 配置
JWT_SECRET_KEY=your-very-secret-key-change-this-in-production-min-32-chars

# Supabase 配置
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# 微信小程序配置
APPID=your-wechat-appid
SECRET=your-wechat-secret
```

## 安装依赖

```bash
pip install -r requirements.txt
```

## 登录流程

### 1. 前端调用登录接口

```typescript
// 小程序端代码
const loginRes = await Taro.login()
const response = await Taro.request({
  url: 'http://your-backend/api/login',
  method: 'POST',
  data: {
    code: loginRes.code,
    phoneCode: phoneCode  // 可选，获取手机号
  }
})

// 保存 token 到本地
Taro.setStorageSync('access_token', response.data.access_token)
Taro.setStorageSync('refresh_token', response.data.refresh_token)
Taro.setStorageSync('user_id', response.data.user_id)
```

### 2. 后端处理流程

1. 接收微信 `code`
2. 调用微信接口获取 `openid` 和 `unionid`
3. 查询 `weapp_user` 表检查用户是否存在
4. 如果不存在，创建新用户记录
5. 如果存在，直接使用现有用户（可选：更新 unionid 或手机号）
6. 生成 JWT token（包含 user_id, openid, unionid）
7. 返回 token 给前端

### 3. 登录响应格式

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 604800,
  "user_id": "123e4567-e89b-12d3-a456-426614174000",
  "openid": "wx_openid_123",
  "unionid": "wx_unionid_123",
  "phoneNumber": "+86 13800138000",
  "purePhoneNumber": "13800138000",
  "countryCode": "86"
}
```

## 使用鉴权中间件

### 方式 1: 获取完整用户信息

```python
from middleware import get_current_user_info

@app.get("/api/some-endpoint")
async def some_endpoint(
    user_info: dict = Depends(get_current_user_info)
):
    user_id = user_info["user_id"]
    openid = user_info["openid"]
    unionid = user_info.get("unionid")
    
    # 使用用户信息进行业务逻辑
    return {"user_id": user_id, "openid": openid}
```

### 方式 2: 只获取 user_id

```python
from middleware import get_current_user_id

@app.post("/api/save-data")
async def save_data(
    data: dict,
    user_id: str = Depends(get_current_user_id)
):
    # 使用 user_id 保存数据
    return {"status": "success", "user_id": user_id}
```

### 方式 3: 只获取 openid

```python
from middleware import get_current_openid

@app.get("/api/data")
async def get_data(
    openid: str = Depends(get_current_openid)
):
    # 使用 openid 查询数据
    return {"data": "..."}
```

## 前端请求示例

### 带认证的请求

```typescript
// 获取存储的 token
const token = Taro.getStorageSync('access_token')

// 发送请求
const response = await Taro.request({
  url: 'http://your-backend/api/user/profile',
  method: 'GET',
  header: {
    'Authorization': `Bearer ${token}`
  }
})
```

## Token 说明

- **access_token**: 访问令牌，有效期 7 天
- **refresh_token**: 刷新令牌，有效期 30 天（可选，用于刷新 access_token）

## 错误处理

### 401 Unauthorized
- Token 缺失或格式错误
- Token 无效或已过期

### 404 Not Found
- 用户不存在

### 500 Internal Server Error
- 数据库连接失败
- 微信接口调用失败

## 文件结构

```
backend/
├── main.py          # 主应用文件，包含登录接口
├── auth.py          # JWT token 生成和验证
├── database.py      # 数据库操作（Supabase）
├── middleware.py    # 鉴权中间件
└── requirements.txt # 依赖包
```

## 注意事项

1. **JWT_SECRET_KEY**: 生产环境必须使用强密钥（至少 32 字符）
2. **Supabase Service Role Key**: 不要暴露给前端，仅在后端使用
3. **Token 存储**: 前端应安全存储 token（小程序会自动加密）
4. **HTTPS**: 生产环境必须使用 HTTPS

## 测试

1. 启动后端服务：
```bash
uvicorn main:app --reload --port 8888
```

2. 测试登录接口：
```bash
curl -X POST http://localhost:8888/api/login \
  -H "Content-Type: application/json" \
  -d '{"code": "your_wechat_code"}'
```

3. 测试鉴权接口：
```bash
curl -X GET http://localhost:8888/api/user/profile \
  -H "Authorization: Bearer your_access_token"
```

