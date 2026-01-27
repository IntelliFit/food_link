# Food Link - 运行指南

这是一个基于 AI 的食物分析与饮食分享社区小程序项目。

## 项目结构

- **前端**: Taro + React + TypeScript (微信小程序)
- **后端**: FastAPI + Python
- **数据库**: Supabase (PostgreSQL)
- **AI服务**: 阿里云 DashScope (通义千问视觉模型)

## 前置要求

### 后端
- Python 3.8+
- pip

### 前端
- Node.js 16+
- npm 或 yarn
- 微信开发者工具（用于小程序开发）

## 快速开始

### 1. 后端设置

#### 1.1 安装依赖

```bash
cd backend
pip install -r requirements.txt
```

#### 1.2 配置环境变量

在 `backend` 目录下创建 `.env` 文件：

```env
# DashScope API 配置（必需）
DASHSCOPE_API_KEY=your_dashscope_api_key_here

# Supabase 配置（必需）
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# JWT 配置（必需）
JWT_SECRET_KEY=your-very-secret-key-change-this-in-production-min-32-chars

# 微信小程序配置（必需）
APPID=your-wechat-appid
SECRET=your-wechat-secret
```

**环境变量说明：**
- `DASHSCOPE_API_KEY`: 阿里云 DashScope API Key，用于食物图片分析
- `SUPABASE_URL`: Supabase 项目 URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase Service Role Key（用于后端直接访问数据库）
- `JWT_SECRET_KEY`: JWT 签名密钥（至少 32 字符，生产环境请使用强密钥）
- `APPID`: 微信小程序 AppID
- `SECRET`: 微信小程序 AppSecret

#### 1.3 初始化数据库

确保 Supabase 中已创建 `weapp_user` 表，表结构参考 `登录设计文档.md`：

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

#### 1.4 启动后端服务

**方式 1: 使用 run.sh 脚本（Linux/Mac）**
```bash
cd backend
chmod +x run.sh
./run.sh
```

**方式 2: 直接使用 uvicorn**
```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8888
```

后端服务将在 `http://localhost:8888` 启动。

**验证后端是否运行：**
- 访问 `http://localhost:8888/docs` 查看 Swagger API 文档
- 访问 `http://localhost:8888/health` 检查健康状态

### 2. 前端设置

#### 2.1 安装依赖

```bash
# 在项目根目录
npm install
```

#### 2.2 配置 API 地址

编辑 `src/utils/api.ts`，确保 `API_BASE_URL` 指向正确的后端地址：

```typescript
const API_BASE_URL = 'http://localhost:8888'  // 开发环境
// 或
const API_BASE_URL = 'https://your-production-api.com'  // 生产环境
```

#### 2.3 配置小程序 AppID（可选）

编辑 `.env.development` 或 `.env.production`：

```env
TARO_APP_ID=your-wechat-appid
```

#### 2.4 启动开发服务器

**微信小程序开发：**
```bash
npm run dev:weapp
```

然后在微信开发者工具中打开项目目录下的 `dist` 文件夹。

**其他平台：**
```bash
npm run dev:h5        # H5 开发
npm run dev:alipay    # 支付宝小程序
npm run dev:swan      # 百度小程序
npm run dev:tt        # 字节跳动小程序
npm run dev:qq        # QQ 小程序
```

## 开发流程

### 典型使用流程

1. **启动后端服务**
   ```bash
   cd backend
   uvicorn main:app --reload --port 8888
   ```

2. **启动前端开发服务器**
   ```bash
   npm run dev:weapp
   ```

3. **在微信开发者工具中打开项目**
   - 打开微信开发者工具
   - 选择"导入项目"
   - 项目目录选择项目根目录
   - AppID 使用配置的 AppID 或测试号

4. **测试功能**
   - 登录：使用微信登录功能
   - 拍照识别：在首页点击"拍照识别"，选择图片进行分析
   - 查看结果：分析完成后查看营养成分和健康建议

## 项目配置说明

### 后端端口

默认后端运行在 `8888` 端口（可在 `run.sh` 或启动命令中修改）。

### 前端 API 配置

前端 API 地址在 `src/utils/api.ts` 中配置：

```typescript
const API_BASE_URL = 'http://localhost:8888'
```

### 环境变量文件

- `.env.development`: 开发环境配置
- `.env.production`: 生产环境配置
- `backend/.env`: 后端环境变量（需要手动创建）

## 常见问题

### 1. 后端启动失败

**问题**: `缺少 DASHSCOPE_API_KEY 环境变量`
- **解决**: 确保在 `backend/.env` 文件中配置了所有必需的环境变量

**问题**: `Supabase 未配置`
- **解决**: 检查 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 是否正确配置

### 2. 前端无法连接后端

**问题**: 网络请求失败
- **解决**: 
  1. 确认后端服务已启动
  2. 检查 `src/utils/api.ts` 中的 `API_BASE_URL` 是否正确
  3. 如果是小程序，需要在微信开发者工具中设置"不校验合法域名"

### 3. 微信登录失败

**问题**: 登录接口返回错误
- **解决**: 
  1. 检查 `APPID` 和 `SECRET` 是否正确
  2. 确认微信小程序已配置服务器域名
  3. 检查后端日志查看具体错误信息

### 4. 图片分析失败

**问题**: AI 分析返回错误
- **解决**: 
  1. 检查 `DASHSCOPE_API_KEY` 是否有效
  2. 确认 DashScope 账户有足够余额
  3. 检查图片格式和大小是否符合要求

## 生产环境部署

### 后端部署

1. 使用生产环境的环境变量
2. 使用进程管理器（如 PM2、supervisor）管理服务
3. 配置反向代理（如 Nginx）
4. 启用 HTTPS

### 前端部署

1. 构建生产版本：
   ```bash
   npm run build:weapp
   ```

2. 在微信公众平台提交审核和发布

3. 更新生产环境的 API 地址

## 项目文档

- [后端 API 文档](backend/README.md)
- [认证说明](backend/AUTH_README.md)
- [登录设计文档](登录设计文档.md)

## 技术栈

- **前端框架**: Taro 4.1.10
- **UI 框架**: React 18
- **后端框架**: FastAPI 0.109.0
- **数据库**: Supabase (PostgreSQL)
- **AI 服务**: 阿里云 DashScope (通义千问视觉模型)
- **认证**: JWT (python-jose)

## 许可证

[根据项目实际情况填写]
