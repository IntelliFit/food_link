# Food Link Admin

Food Link 统一管理后台，独立于 Go 后端部署。当前覆盖总览、意见反馈、包装食品库、质量审计、测试后台与行为统计入口。

## 技术栈

- React 19 + Vite
- shadcn/ui（Radix + Lucide 图标）
- Tailwind CSS v4
- Sonner（Toast 提示）

## 本地开发

```bash
npm install
npm run dev
```

本地开发默认让 `VITE_ADMIN_API_BASE_URL` 留空，由 `vite.config.ts` 将 `/api/*` 代理到 `http://127.0.0.1:3010`。不要在本地 `.env.development` 写死 `http://127.0.0.1:3010`，否则浏览器会从 `5173` 跨域直连 `3010`，登录接口会被 CORS 拦截。

## 构建

```bash
npm run build
```

构建产物在 `dist/`，可部署到任意静态站点服务。

## 环境变量

复制 `admin/.env.example` 为 `.env.development`（本地）或在 Cloudflare Pages 配置同名变量。**域名不在代码中写死。**

| 部署环境 | `VITE_ADMIN_API_BASE_URL` |
|----------|---------------------------|
| 本地开发 | 留空 |
| Preview / 联调 dev API | `https://dev.api.healthymax.cn` |
| Production（main） | `https://api.healthymax.cn` |
| 反代同源 | 留空 |

完整说明见根目录 [`docs/api-url-configuration.md`](../docs/api-url-configuration.md)。

- 管理员在登录页输入账号和密码，后端校验后写入 HttpOnly Cookie；账号只能通过后端命令行创建。

## 页面结构

- 登录页：管理员账号密码登录，后端写入 HttpOnly Cookie。
- 总览：统一后台入口，展示已接入模块与保留入口。
- 意见反馈：查看用户反馈、联系方式、客户端信息、trace 与最近请求。
- 包装食品库：整合旧 `/snack-admin` 的零食 SKU 搜索、筛选、图片预览和快速编辑。
- 质量审计：保留 0 营养、识别质量、包装召回、标准库召回等命令入口。
- 测试后台：保留旧 `/test-backend` 入口与常用测试命令入口。
- 行为统计：预留上传、识别、保存、纠错、分享、反馈等漏斗入口。

## 创建管理员账号

管理员账号不支持网页或 API 注册，只能在后端通过命令创建：

```bash
cd backend
go run ./cmd/create-admin -username admin -display-name 管理员 -config-dir .
```

如需重置已有账号密码：

```bash
go run ./cmd/create-admin -username admin -reset -config-dir .
```

该命令会读取与后端一致的配置并写入 `admin_accounts` 表。

如果只是重置管理员账号，且当前数据库已有历史数据导致 AutoMigrate 被无关约束阻塞，可跳过迁移：

```bash
go run ./cmd/create-admin -username admin -reset -skip-migration -config-dir .
```

## 跨域

如果 Admin 站点和 Go 后端不是同源，需要在后端配置：

```bash
ADMIN_CORS_ALLOWED_ORIGINS=https://admin.example.com
```

多个来源用英文逗号分隔。若用反代将 `/api/admin/*` 转发到后端，则不需要跨域配置。
