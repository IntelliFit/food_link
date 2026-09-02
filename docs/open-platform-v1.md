# FoodLink Open Platform v1 使用与运维说明

## 定位

开放平台 HTTP API 是唯一能力源。WorkBuddy、Codex、其他 Agent、后端服务和未来硬件网关都调用同一套 `/open/v1` 契约；MCP 只作为适配层，不复制计费和业务逻辑。官网入口为 `https://healthymax.cn/developer/`，开发者控制台为 `https://healthymax.cn/developer/console/`。

正式环境为 `https://api.healthymax.cn/open/v1`；`https://dev.api.healthymax.cn/open/v1` 只用于内部 Preview 和发布前回归。对外交付材料默认使用正式环境。

OpenAPI 3.1 文件：[`docs/openapi/foodlink-openapi-v1.yaml`](./openapi/foodlink-openapi-v1.yaml)。

## 封闭测试计费

API 点数与小程序会员、个人积分完全分开。当前点数只是成本权重，不代表人民币价格：

| 能力 | 当前点数 |
| --- | ---: |
| 文字食物分析 | 2 点/次 |
| 普通图片分析 | 5 点/张 |
| 精准图片分析 | 15 点/张 |
| 营养库搜索 | Beta 期免费，受 Scope 约束 |

官网开发者账号仅在第一次创建的第一个应用赠送 100 点；管理员通过 `openapi-admin` 签发的验收应用可显式指定初始点数，不受该网页赠送规则影响。推荐商业形态为：

1. 免费试用点数，有有效期；
2. 个人开发者预充值点数包；
3. 硬件/企业客户采用月度保底额度，超额按点数结算；
4. 失败、超时、取消或违规终态退回本次预留点数；
5. 充值与退款全部写入不可变账本，支付回调使用唯一 reference 防止重复到账。

当前实现已增加每分钟自动对账器：通过 PostgreSQL advisory lock 在多 Pod 中选出唯一执行实例，自动扫描失败终态和超过 10 分钟仍未提交成功的预留请求并幂等退点。因此调用方停止轮询也不会永久占用点数。

公开 `/open/v1` 使用 Redis 多实例共享固定窗口限流：每个凭证 120 次/分钟、每个应用 300 次/分钟，分析提交与图片上传各 60 次/分钟。响应包含 `X-RateLimit-Limit`、`X-RateLimit-Remaining`、`X-RateLimit-Reset`；超限返回 429 和 `Retry-After`。生产环境没有 Redis 时按失败关闭策略返回 503，不会无保护运行。

余额不足返回 HTTP `402 Payment Required`。API 和 MCP 都不会自动弹出微信支付或替用户付款；调用方应展示开发者控制台，由用户主动选择套餐并扫码。

## 开发者控制台与支付

- 使用现有食探手机号短信验证码登录，首次登录自动创建账号。
- 每个开发者最多 5 个应用，每个应用最多 5 个有效 API Key。
- 每个开发者账号仅在首次创建的第一个应用赠送 100 个 Beta 测试点；继续创建应用不重复赠送，且应用余额彼此独立。完整 API Key 只显示一次，数据库仅保存 SHA-256 摘要。
- PC 官网使用微信 Native 支付二维码。服务端验签、解密并核对订单金额后，才在事务中把订单置为 paid 并增加点数。
- 支付订单号和账本 reference 均有唯一约束，重复微信回调不会重复加点。
- 控制台轮询会主动调用微信商户查单；即使支付回调暂时丢失，查到 SUCCESS 且金额一致后也会幂等入账。
- 套餐必须由管理员显式配置并启用；未启用时控制台不会展示虚构价格。

微信回调地址配置：

```text
WECHAT_PAY_OPEN_API_NOTIFY_URL=https://api.healthymax.cn/api/developer/payment/wechat/notify
```

套餐配置示例（运行迁移后、确认目标数据库后执行）：

```powershell
go run ./cmd/openapi-admin -config-dir . -action upsert-package `
  -confirm-db "<host>/<database>/<schema>" `
  -package-code starter -package-name "入门包" `
  -units 1000 -amount-fen 2900 -description "Beta 入门点数包" -active
```

示例价格只用于验证技术链路，正式启用前需按真实成本和商业策略确认。

## MCP

本地 stdio MCP 位于 [`integrations/foodlink-mcp`](../integrations/foodlink-mcp)，提供余额、文字分析、图片上传、图片分析、结果查询、营养搜索和充值地址 7 个工具。完整的 Codex TOML、WorkBuddy/通用 JSON、PowerShell 验收脚本和安全说明见该目录 README 与 `examples/`。

## 食物分析完整参数

`POST /open/v1/food-analyses` 同时服务文字和图片分析。`text` 与 `image_urls` 必须二选一，不能同时提交。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `text` | string | 与 `image_urls` 二选一 | 自然语言餐食描述；文字分析固定 2 点/次 |
| `image_urls` | string[] | 与 `text` 二选一 | 必须来自当前应用的上传接口；最多 5 张 |
| `mode` | `standard` / `precision` | 否 | 默认 `standard`；普通图片 5 点/张，精准图片 15 点/张 |
| `meal_type` | enum | 否 | `breakfast`、`morning_snack`、`lunch`、`afternoon_snack`、`dinner`、`evening_snack` |
| `additional_context` | string | 否 | 补充“没有喝汤”“只吃一半”等图片无法确定的信息 |
| `date` | `YYYY-MM-DD` | 否 | 餐食发生日期 |

图片完整调用顺序为：`POST /uploads` → `POST /food-analyses` → `GET /food-analyses/{task_id}`。提交分析时必须发送 `Idempotency-Key`；网络重试必须复用原值。

## 部署前准备

本功能新增数据库结构，必须先确认 `backend/config.yaml` 指向的目标库，再从 `backend/` 执行项目迁移。禁止在未确认数据库时运行：

```powershell
go run ./cmd/migration -config-dir .
```

迁移完成后，创建一个封闭测试应用。命令带数据库目标确认保护，目标格式为 `host/database/schema`：

```powershell
go run ./cmd/openapi-admin `
  --config-dir . `
  --action create-app `
  --name "workbuddy-beta" `
  --initial-units 1000 `
  --confirm-db "HOST/DATABASE/public"
```

命令只显示一次完整 `api_key`。数据库只保存 SHA-256 摘要和可识别前缀，完整密钥应放入密码管理器或密钥系统。

人工充值示例：

```powershell
go run ./cmd/openapi-admin `
  --config-dir . `
  --action top-up `
  --app-id "APP_UUID" `
  --units 1000 `
  --reference "manual:20260901:developer-name:001" `
  --confirm-db "HOST/DATABASE/public"
```

相同 `reference` 重复执行不会重复到账。

## 另一台电脑调用

只需要正式环境地址和 API Key，不需要后端仓库源码。若使用 MCP，再复制 `integrations/foodlink-mcp` 目录到目标电脑。

### 1. 检查凭证与余额

```powershell
$foodlinkApi = "https://api.healthymax.cn"
$foodlinkKey = "flk_beta_请替换"
Invoke-RestMethod `
  -Method Get `
  -Uri "$foodlinkApi/open/v1/account" `
  -Headers @{ "X-API-Key" = $foodlinkKey }
```

### 2. 提交文字分析

```powershell
$idempotencyKey = [guid]::NewGuid().ToString()
$body = @{
  text = "一碗米饭、一个鸡蛋和一杯无糖豆浆"
  mode = "standard"
  meal_type = "breakfast"
} | ConvertTo-Json

$submitted = Invoke-RestMethod `
  -Method Post `
  -Uri "$foodlinkApi/open/v1/food-analyses" `
  -Headers @{
    "X-API-Key" = $foodlinkKey
    "Idempotency-Key" = $idempotencyKey
  } `
  -ContentType "application/json" `
  -Body $body

$taskId = $submitted.data.task_id
```

网络重试必须复用同一个 `Idempotency-Key`；服务只创建一次任务、扣一次点数。

### 3. 轮询结果

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "$foodlinkApi/open/v1/food-analyses/$taskId" `
  -Headers @{ "X-API-Key" = $foodlinkKey }
```

状态包括 `queued`、`processing`、`requires_action`、`completed` 和 `failed`。

### 4. 图片分析

```powershell
$upload = Invoke-RestMethod `
  -Method Post `
  -Uri "$foodlinkApi/open/v1/uploads" `
  -Headers @{ "X-API-Key" = $foodlinkKey } `
  -Form @{ file = Get-Item "C:\path\meal.jpg" }

$body = @{
  image_urls = @($upload.data.image_url)
  mode = "standard"
  meal_type = "lunch"
} | ConvertTo-Json
```

图片分析的提交方式与文字分析一致。`image_urls` 只接受当前应用通过上传接口获得的地址，不读取任意外部 URL。

## 安全边界

- 只通过 HTTPS 传输密钥；不要把密钥提交到 Git、日志或前端公开包。
- 每个开发者/硬件合作方使用独立应用和密钥，可单独吊销。
- Scope 当前为 `food:analyze` 与 `food:search`。
- 当前采用正式域名封闭开放，只向可信开发者发放独立密钥；Redis 多实例限流和后台退款对账已启用。
- 外部调用方不能指定底层供应商或模型，只能选择 `standard`/`precision` 服务等级。
- 个人饮食记录、健康档案和可穿戴数据尚未开放；后续必须通过独立的用户 OAuth 授权。
- 硬件不得烧录共享开发者密钥；后续设备版使用每台设备独立身份和扫码绑定。
