# 环境变量清单 - 需要从原项目创建者获取

## 📋 需要获取的环境变量

请向原项目创建者（你的同事）获取以下环境变量配置，这些配置应该放在 `backend/.env` 文件中。

---

## ✅ 必需的环境变量（7个）

### 1. DashScope API Key
```env
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxx
```
- **用途**：阿里云 DashScope AI 服务，用于食物图片识别和分析
- **位置**：`backend/main.py` 第 94 行
- **备选**：如果没有 `DASHSCOPE_API_KEY`，也可以使用 `API_KEY`

### 2. DashScope Base URL（可选）
```env
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```
- **用途**：DashScope API 的基础 URL
- **位置**：`backend/main.py` 第 108-111 行
- **说明**：如果不提供，会使用默认值

### 3. Supabase URL
```env
SUPABASE_URL=https://xxxxx.supabase.co
```
- **用途**：Supabase 数据库项目的 URL
- **位置**：`backend/database.py` 第 21 行
- **格式**：应该是 `https://项目ID.supabase.co` 的格式

### 4. Supabase Service Role Key
```env
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
- **用途**：Supabase 的 Service Role Key，用于后端直接访问数据库
- **位置**：`backend/database.py` 第 22 行
- **⚠️ 重要**：必须是 `service_role` key，不是 `anon` key

### 5. JWT Secret Key
```env
JWT_SECRET_KEY=your-very-secret-key-change-this-in-production-min-32-chars
```
- **用途**：JWT token 的签名密钥，用于用户认证
- **位置**：`backend/auth.py` 第 10 行
- **要求**：至少 32 字符

### 6. 微信小程序 AppID
```env
APPID=wx1234567890abcdef
```
- **用途**：微信小程序的 AppID，用于微信登录
- **位置**：`backend/main.py` 第 357、483 行
- **格式**：通常以 `wx` 开头

### 7. 微信小程序 AppSecret
```env
SECRET=abcdef1234567890abcdef1234567890
```
- **用途**：微信小程序的 AppSecret，用于微信登录
- **位置**：`backend/main.py` 第 358、484 行
- **⚠️ 重要**：这是敏感信息，需要妥善保管

---

## 📝 完整的 `.env` 文件模板

从同事那里获取到所有值后，创建 `backend/.env` 文件，格式如下：

```env
# DashScope API 配置
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxx
# DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1  # 可选

# Supabase 配置
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# JWT 配置
JWT_SECRET_KEY=your-very-secret-key-change-this-in-production-min-32-chars

# 微信小程序配置
APPID=wx1234567890abcdef
SECRET=abcdef1234567890abcdef1234567890
```

---

## 🔍 验证清单

获取到环境变量后，请确认：

- [ ] `DASHSCOPE_API_KEY` 或 `API_KEY` 已配置
- [ ] `SUPABASE_URL` 格式正确（以 `https://` 开头，以 `.supabase.co` 结尾）
- [ ] `SUPABASE_SERVICE_ROLE_KEY` 是 service_role key（不是 anon key）
- [ ] `JWT_SECRET_KEY` 至少 32 字符
- [ ] `APPID` 格式正确（通常以 `wx` 开头）
- [ ] `SECRET` 已配置（这是敏感信息）

---

## 🚀 配置完成后

1. 创建 `backend/.env` 文件并填入所有配置
2. 启动后端服务测试：
   ```bash
   cd backend
   uvicorn main:app --reload --port 8888
   ```
3. 访问 http://localhost:8888/docs 验证是否正常
4. 访问 http://localhost:8888/health 检查健康状态

---

## 📧 询问同事时的模板

可以这样询问你的同事：

> 你好，我需要获取项目的环境变量配置来运行后端服务。请提供以下配置：
> 
> 1. DashScope API Key (`DASHSCOPE_API_KEY`)
> 2. Supabase URL (`SUPABASE_URL`)
> 3. Supabase Service Role Key (`SUPABASE_SERVICE_ROLE_KEY`)
> 4. JWT Secret Key (`JWT_SECRET_KEY`)
> 5. 微信小程序 AppID (`APPID`)
> 6. 微信小程序 AppSecret (`SECRET`)
> 
> 这些配置应该在你的 `backend/.env` 文件中。请通过安全的方式分享给我（比如公司内部密码管理工具或加密消息）。
