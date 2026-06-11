# API 地址配置说明

后端 API 域名约定：

| 用途 | 域名 |
|------|------|
| 正式 API | `https://api.healthymax.cn` |
| 开发 / 体验 API | `https://dev.api.healthymax.cn` |
| Admin 站点 | `https://admin.healthymax.cn`（Cloudflare Pages） |

**所有 URL 均通过环境变量配置，不在业务代码中写死域名。**

---

## 微信小程序

### 机制

上传**同一份** `dist` 即可：小程序在**运行时**读取 `Taro.getAccountInfoSync().miniProgram.envVersion`，自动选择 API：

| `envVersion` | 场景 | 环境变量 |
|--------------|------|----------|
| `develop` | 开发者工具 / 开发版 | `TARO_APP_API_BASE_URL_DEVELOP` |
| `trial` | 体验版 | `TARO_APP_API_BASE_URL_TRIAL` |
| `release` | 正式版 | `TARO_APP_API_BASE_URL_RELEASE` |

无需为体验版 / 正式版分别 build；体验版提审发布为正式版后，同一包会自动切到正式 API。

### 本地配置

1. 复制根目录 `.env.example` 为 `.env.development` 与 `.env.production`（二者均被 gitignore）。
2. 按环境填写三个 URL（通常两份文件内容相同）。

```bash
TARO_APP_API_BASE_URL_RELEASE=https://api.healthymax.cn
TARO_APP_API_BASE_URL_TRIAL=https://dev.api.healthymax.cn
TARO_APP_API_BASE_URL_DEVELOP=http://127.0.0.1:3010
```

### 可选覆盖

强制所有 `envVersion` 使用同一 API（e2e、真机联调局域网 IP）：

```bash
TARO_APP_API_BASE_URL_OVERRIDE=http://192.168.x.x:3010
```

旧变量 `TARO_APP_API_BASE_URL` 等价于 `TARO_APP_API_BASE_URL_OVERRIDE`。

### 构建命令

| 命令 | 说明 |
|------|------|
| `npm run dev:weapp` | 本地 watch；`develop` 走 `DEVELOP` URL |
| `npm run build:weapp` | 上传用生产构建；体验版 / 正式版由运行时 `envVersion` 区分 |

### 微信后台

`request` / `uploadFile` / `downloadFile` 合法域名需同时配置：

- `https://api.healthymax.cn`
- `https://dev.api.healthymax.cn`

### 实现位置

- 构建注入：`config/index.ts`
- 运行时解析：`src/utils/api-base-url.ts`
- 对外导出：`src/utils/api.ts` 的 `API_BASE_URL`

---

## Admin 管理后台

Admin 为独立 Vite 站点（`admin.healthymax.cn`），**按部署环境**配置 API，与小程序机制不同。

### 本地开发

```bash
cd admin
cp .env.example .env.development
npm run dev
```

`admin/vite.config.ts` 在 dev 模式下将 `/api` 代理到 `http://127.0.0.1:3010`；若设置了 `VITE_ADMIN_API_BASE_URL` 则直连该地址。

### Cloudflare Pages

`VITE_*` 变量必须在 **构建时** 注入（Vite 会写进 JS 产物）。在 **Settings → Variables** 分别为 **Production** 与 **Preview** 各配一套（不能只配 Production）：

| Cloudflare 环境 | 部署示例 | `VITE_ADMIN_API_BASE_URL` |
|-----------------|----------|---------------------------|
| **Production** | `admin.healthymax.cn`（main） | `https://api.healthymax.cn` |
| **Preview** | `dev.food-link-admin.pages.dev`（dev 等） | `https://dev.api.healthymax.cn` |

**常见故障**：访问 `dev.*.pages.dev` 时登录请求打到 `https://dev.food-link-admin.pages.dev/api/admin/login` 并返回 **405**，说明 Preview 构建时变量为空，前端走了「同源」。登录页左下角若显示 `API: 同源` 即是此情况。处理：在 **Preview** 环境添加变量后 **重新部署 dev 分支**。

若通过反代使 Admin 与 API 同源，可留空该变量。

### 后端跨域

Admin 与 API 不同源时，Go 后端需配置：

```bash
ADMIN_CORS_ALLOWED_ORIGINS=https://admin.healthymax.cn,https://dev.food-link-admin.pages.dev
```

Preview 域名也要加入，否则变量配对后仍可能被 CORS 拦截。

### 实现位置

- 读取配置：`admin/src/config.ts`
- 环境变量模板：`admin/.env.example`

---

## 迁移说明（旧配置）

若 `.env.production` 仍只有单行 `TARO_APP_API_BASE_URL=https://api.healthymax.cn`，请改为三行：

```bash
TARO_APP_API_BASE_URL_RELEASE=https://api.healthymax.cn
TARO_APP_API_BASE_URL_TRIAL=https://dev.api.healthymax.cn
TARO_APP_API_BASE_URL_DEVELOP=http://127.0.0.1:3010
```

旧变量可删除，或保留为 `OVERRIDE` 仅用于特殊联调。
