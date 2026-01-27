# 环境变量配置指南

## 📋 概述

这个项目需要配置多个第三方服务的 API Key 和密钥。**这些配置不会包含在 Git 仓库中**（出于安全考虑），需要你自己申请和配置。

## ✅ 需要配置的服务

### 1. 阿里云 DashScope（AI 图片分析）

**用途**：用于食物图片识别和营养成分分析

**申请步骤**：
1. 访问 [阿里云 DashScope](https://dashscope.aliyun.com/)
2. 注册/登录阿里云账号
3. 开通 DashScope 服务
4. 在控制台 -> API-KEY 管理中创建 API Key
5. 复制 API Key 到 `backend/.env` 文件

**费用**：按量付费，有免费额度

**文档**：https://help.aliyun.com/zh/dashscope/

---

### 2. Supabase（数据库）

**用途**：存储用户信息等数据

**申请步骤**：
1. 访问 [Supabase](https://supabase.com/)
2. 注册/登录账号（可用 GitHub 账号登录）
3. 点击 "New Project" 创建新项目
4. 等待项目初始化完成（约 2 分钟）
5. 在项目设置 -> API 中找到：
   - **Project URL** → 复制到 `SUPABASE_URL`
   - **service_role key** → 复制到 `SUPABASE_SERVICE_ROLE_KEY`
   - ⚠️ 注意：要使用 `service_role` key，不是 `anon` key

**初始化数据库**：
在 Supabase SQL Editor 中执行以下 SQL 创建用户表：

```sql
CREATE TABLE weapp_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  openid VARCHAR(255) NOT NULL UNIQUE,
  unionid VARCHAR(255) UNIQUE,
  avatar TEXT DEFAULT '',
  nickname VARCHAR(255) DEFAULT '',
  telephone VARCHAR(20),
  create_time TIMESTAMP DEFAULT NOW(),
  update_time TIMESTAMP DEFAULT NOW()
);
```

**费用**：免费版有 500MB 数据库空间，足够开发使用

**文档**：https://supabase.com/docs

---

### 3. 微信小程序（登录功能）

**用途**：实现微信登录和用户认证

**申请步骤**：
1. 访问 [微信公众平台](https://mp.weixin.qq.com/)
2. 注册小程序账号（需要邮箱和手机号）
3. 完成账号认证（个人开发者也可以）
4. 在开发 -> 开发管理 -> 开发设置中找到：
   - **AppID** → 复制到 `APPID`
   - **AppSecret** → 点击"生成"或"重置"后复制到 `SECRET`
   - ⚠️ AppSecret 只显示一次，请妥善保存

**配置服务器域名**（开发阶段可跳过）：
- 在开发 -> 开发管理 -> 开发设置 -> 服务器域名中
- 添加你的后端 API 域名（开发时可在微信开发者工具中勾选"不校验合法域名"）

**费用**：免费

**文档**：https://developers.weixin.qq.com/miniprogram/dev/framework/

---

### 4. JWT Secret Key（认证密钥）

**用途**：用于生成和验证 JWT token

**生成方式**（任选一种）：

**方式 1：在线工具**
- 访问 https://www.random.org/strings/
- 生成 32 位以上的随机字符串

**方式 2：命令行**
```bash
# Linux/Mac
openssl rand -hex 32

# Windows PowerShell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
```

**方式 3：Python**
```python
import secrets
print(secrets.token_urlsafe(32))
```

**要求**：至少 32 字符，建议使用强随机字符串

---

## 📝 配置步骤

### 1. 创建后端环境变量文件

```bash
cd backend
# 复制示例文件
cp .env.example .env
# 或手动创建
touch .env
```

### 2. 编辑 `backend/.env` 文件

填入你申请到的所有配置：

```env
# DashScope API 配置
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxx

# Supabase 配置
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# JWT 配置
JWT_SECRET_KEY=your-random-secret-key-at-least-32-chars

# 微信小程序配置
APPID=wx1234567890abcdef
SECRET=abcdef1234567890abcdef1234567890
```

### 3. 验证配置

启动后端服务测试：

```bash
cd backend
uvicorn main:app --reload --port 8888
```

访问 http://localhost:8888/docs 查看 API 文档，如果能看到文档说明配置成功。

---

## ⚠️ 注意事项

1. **不要提交 `.env` 文件到 Git**
   - `.env` 文件已在 `.gitignore` 中，不要手动添加到版本控制

2. **生产环境使用不同的密钥**
   - 开发和生产环境应该使用不同的 API Key 和密钥
   - 生产环境的 JWT_SECRET_KEY 必须使用强随机字符串

3. **保护敏感信息**
   - 不要将 `.env` 文件分享给他人
   - 不要在代码中硬编码这些密钥
   - 如果密钥泄露，立即重新生成

4. **费用控制**
   - DashScope 按量付费，注意控制调用次数
   - Supabase 免费版有配额限制，注意监控使用量

---

## 🆘 遇到问题？

### 后端启动报错 "缺少 XXX 环境变量"
- 检查 `backend/.env` 文件是否存在
- 检查环境变量名称是否正确（区分大小写）
- 检查是否有拼写错误

### Supabase 连接失败
- 检查 `SUPABASE_URL` 格式是否正确（应该以 `https://` 开头，以 `.supabase.co` 结尾）
- 检查 `SUPABASE_SERVICE_ROLE_KEY` 是否使用了 `service_role` key（不是 `anon` key）
- 检查网络连接是否正常

### 微信登录失败
- 检查 `APPID` 和 `SECRET` 是否正确
- 检查小程序是否已发布（开发阶段可使用测试号）
- 查看后端日志获取详细错误信息

### DashScope API 调用失败
- 检查 API Key 是否有效
- 检查账户余额是否充足
- 检查 API 调用频率是否超限

---

## 📚 相关文档

- [项目运行指南](README.md)
- [后端 API 文档](backend/README.md)
- [认证说明](backend/AUTH_README.md)
