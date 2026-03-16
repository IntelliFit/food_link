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

#### 1.3 启动后端服务

在项目根目录下运行：

```bash
python run_backend.py
```

**验证后端是否运行：**
- 访问 `http://localhost:3010/docs` 查看 Swagger API 文档
- 访问 `http://localhost:3010/health` 检查健康状态

### 2. 前端设置

#### 2.1 安装依赖

```bash
# 在项目根目录
npm install
```

#### 2.2 配置 API 地址

编辑 `src/utils/api.ts`，确保 `API_BASE_URL` 指向正确的后端地址：

```typescript
const API_BASE_URL = 'http://localhost:3010'  // 开发环境
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

默认后端运行在 `3010` 端口（可在启动命令中修改）。

### 前端 API 配置

前端 API 地址在 `src/utils/api.ts` 中配置：

```typescript
const API_BASE_URL = 'http://localhost:3010'
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

#### 手动部署后端（服务器上直接运行）

如需在服务器上**手动部署/临时运行后端**，可以按以下步骤操作（假设代码已在服务器某目录如 `/var/www/food_link` 下）：

```bash
# 1. SSH 登录到服务器
ssh your_user@your_server_ip

# 2. 进入项目目录
cd /var/www/food_link

# 3. （推荐）创建并激活虚拟环境
python3 -m venv venv
source venv/bin/activate

# 4. 安装后端依赖
pip install -r backend/requirements.txt

# 5. 确保已在 backend 目录下配置好 .env 生产环境变量
#    backend/.env

# 6. 从项目根目录启动后端
python backend/run_backend.py
```

> 上述命令在**项目根目录**执行，通过 `python backend/run_backend.py` 启动服务（内部会使用生产端口和配置）；若使用 `systemd`/`supervisor` 等进程管理器，可将这条启动命令写入对应配置。

#### 自动化部署（GitHub Actions）

- 当前项目已配置 **GitHub Actions + 服务器自动部署脚本**
- **只要将后端代码推送到 GitHub 的 `main` 分支**：
  - GitHub Actions 会自动触发部署流程
  - 通过 SSH 连接到服务器
  - 在服务器上拉取最新代码并执行 `deploy_backend.sh`，完成后端更新与重启

> 因此，本地只需要正常开发并将代码合并/推送到 `main` 分支，无需手动登录服务器执行部署命令。

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
