# Food Link Admin

意见反馈管理后台，独立于 Go 后端部署。

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建产物在 `dist/`，可部署到任意静态站点服务。

## 环境变量

- `VITE_ADMIN_API_BASE_URL`：后端 API 地址。独立域名部署时设置为后端域名，例如 `https://dev.healthymax.cn`；若通过反代做到同源，可留空。
- 管理员在登录页输入账号和密码，后端校验后写入 HttpOnly Cookie；账号只能通过后端命令行创建。

## 页面结构

- 登录页：校验管理员密钥并建立后台登录态。
- 后台壳：左侧菜单承载多个管理模块。
- 意见反馈：当前已接入的第一个管理页面。

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

## 跨域

如果 Admin 站点和 Go 后端不是同源，需要在后端配置：

```bash
ADMIN_CORS_ALLOWED_ORIGINS=https://admin.example.com
```

多个来源用英文逗号分隔。若用反代将 `/api/admin/*` 转发到后端，则不需要跨域配置。
