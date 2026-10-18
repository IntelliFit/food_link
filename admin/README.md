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

## 页面结构与路由

本项目已启用前端路由（`react-router-dom` + `BrowserRouter`）。当前路由如下：

| 路由 | 页面 |
|------|------|
| `/` | 重定向到 `/feedback` |
| `/feedback` | 意见反馈 |
| `/benchmark` | 数据集评测 |
| `/feed-reports` | 举报管理列表 |
| `/feed-reports/:reportId` | 举报管理详情（可直接从飞书通知链接进入） |

- 登录页：管理员账号密码登录，后端写入 HttpOnly Cookie。
- 总览：统一后台入口，展示已接入模块与保留入口。
- 意见反馈：查看用户反馈、联系方式、客户端信息、trace 与最近请求。
- 包装食品库：整合旧 `/snack-admin` 的零食 SKU 搜索、筛选、图片预览和快速编辑。
- 质量审计：保留 0 营养、识别质量、包装召回、标准库召回等命令入口。
- 测试后台：保留旧 `/test-backend` 入口与常用测试命令入口。
- 行为统计：预留上传、识别、保存、纠错、分享、反馈等漏斗入口。
- 举报管理：查看用户举报，点击列表行会更新为 `/feed-reports/:reportId` 路由；飞书举报通知中的「去处理」按钮会直接跳转到该详情路由。

### Cloudflare Pages SPA 回退

由于使用 `BrowserRouter`，直接访问 `https://admin.healthymax.cn/feed-reports/xxx` 时，服务器需要返回 `index.html`。`admin/public/_redirects` 已配置：

```
/*    /index.html   200
```

构建后该文件会被复制到 `dist/_redirects`，Cloudflare Pages 会自动识别。

## 创建管理员账号

### 运营数据看板与只读账号

`/analytics` 展示日活、滚动 30 天月活、期间/累计净付费人数、当前有效付费会员，以及 7/30/90 天趋势和每日明细。统一北京时间。采集首日及此前历史 DAU 不完整，显示未采集；MAU 在完整覆盖 30 天前也显示未采集。今日数据为暂计。

活跃只通过独立后端中间件旁路观察成功的已认证页面读取（首页、个人资料、圈子、饮食列表、过期食品与补剂概览），不改 App/小程序页面、认证或业务服务。写入独立统计表，异步、有界队列，每个用户每日去重；排除已登记支付测试账号。它是前台使用的接口代理指标，不能覆盖离线使用。

付费口径为人民币会员正金额成功订单，排除测试账号/套餐、免费/赠送权益。期间、累计数按用户去重并扣除截至统计时点已全额退款的订单；每日趋势保留退款发生前的历史支付事实。当前有效付费会员要求状态 active、权益未到期、当前会员周期内存在有效真实支付。其他付费产品不纳入此版本。

后端按筛选范围缓存 5 分钟，跨北京时间零点失效。页面可见时每 5 分钟自动获取数据，切回页面也获取；切换筛选会取消旧请求。历史数据启动时补齐最近 90 天，此后每天北京时间 01:00 后的小时巡检结算，并滚动重算最近 7 天；访问可补齐缺失日。各副本任务幂等 upsert，HTTP 服务不执行迁移。统计错误有中文结构化日志，页面接口失败显示错误而不伪造零值。

角色 `admin` 允许现有管理接口；`analytics_viewer` 仅能访问 GET `/api/admin/analytics` 及登录/会话/退出。权限每次由数据库账号读取，未知角色默认拒绝。前端隐藏管理菜单、禁止进入管理路由，后端仍独立校验，不能靠直接调用 API 绕过。已有账号经迁移保留 admin 权限。

部署先确认目标库，再运行限定迁移（仅管理员角色和独立统计表，不修改业务表或业务数据）：

```bash
cd backend
go run ./cmd/migration -config-dir . -only-analytics
go run ./cmd/create-admin -config-dir . -username data-viewer -display-name 数据观察员 -role analytics_viewer
```

密码默认交互输入；自动化时可通过 `ADMIN_ACCOUNT_PASSWORD` 环境变量提供，勿在命令行或日志写明文。已有账号的角色不能通过密码重置隐式修改。部署顺序为迁移、后端、Admin 前端，并验证真实只读账号的看板 200/管理接口 403、匿名请求 401。

`FOOD_LINK_DISABLE_BACKGROUND_MAINTENANCE=1` 的测试环境不会启动统计采集/汇总 worker，不应用于线上。

管理员账号不支持网页或 API 注册，只能在后端通过命令创建。需先确保目标库已手动迁移（见下），再执行 create-admin：

```bash
cd backend
go run ./cmd/migration -config-dir .
go run ./cmd/create-admin -username admin -display-name 管理员 -config-dir .
```

如需重置已有账号密码：

```bash
go run ./cmd/create-admin -username admin -reset -config-dir .
```

该命令会读取与后端一致的配置并写入 `admin_accounts` 表；不会自动执行数据库迁移。

## 跨域

如果 Admin 站点和 Go 后端不是同源，需要在后端配置：

```bash
ADMIN_CORS_ALLOWED_ORIGINS=https://admin.example.com
```

多个来源用英文逗号分隔。若用反代将 `/api/admin/*` 转发到后端，则不需要跨域配置。
