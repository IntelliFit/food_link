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
- 管理员密钥在页面中输入并保存到浏览器本地存储，请确保部署域名只给管理员使用。

## 跨域

如果 Admin 站点和 Go 后端不是同源，需要在后端配置：

```bash
ADMIN_CORS_ALLOWED_ORIGINS=https://admin.example.com
```

多个来源用英文逗号分隔。若用反代将 `/api/admin/*` 转发到后端，则不需要跨域配置。
