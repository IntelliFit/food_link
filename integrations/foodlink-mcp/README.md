# FoodLink MCP 使用指南

食探开放平台的本地 stdio MCP 适配器。它把 Codex、WorkBuddy 和其他 Agent 的工具调用转发到稳定 HTTP API，不保存点数，不替用户付款。

正式地址：

- 开放平台：<https://healthymax.cn/developer/>
- 完整 API 文档：<https://healthymax.cn/developer/docs>
- 给 AI 的接入说明：<https://healthymax.cn/developer/ai-guide.md>
- 开发者控制台：<https://healthymax.cn/developer/console/>
- HTTP API：`https://api.healthymax.cn/open/v1`
- OpenAPI 3.1：<https://healthymax.cn/openapi/foodlink-openapi-v1.yaml>

## 准备工作

1. 安装 Node.js 20 或更高版本，运行 `node --version` 确认。
2. 在开发者控制台短信登录，创建应用和 API Key。
3. 立即保存完整 Key；页面只展示一次，服务端只保存哈希。
4. 把本目录复制到需要使用的电脑，例如 `C:/foodlink-mcp`。

每个开发者账号仅第一个应用赠送 100 点；继续创建应用不会重复获得赠送点数，各应用余额独立。

推荐把 Key 单独保存为只读文件，而不是写进 JSON、TOML 或聊天记录：

```powershell
$keyDir = Join-Path $env:USERPROFILE ".foodlink"
New-Item -ItemType Directory -Force $keyDir | Out-Null
Set-Content -NoNewline -Path (Join-Path $keyDir "api-key") -Value "flk_beta_请替换"
```

## Codex 安装

Codex CLI、Codex IDE 扩展和 ChatGPT 桌面端的同一 Codex host 共用 `~/.codex/config.toml`。配置格式参考 [OpenAI 官方 Codex MCP 文档](https://developers.openai.com/codex/mcp)。最简单的方式是运行：

```powershell
codex mcp add foodlink `
  --env FOODLINK_API_KEY_FILE="$env:USERPROFILE/.foodlink/api-key" `
  --env FOODLINK_API_BASE_URL="https://api.healthymax.cn/open/v1" `
  --env FOODLINK_DEVELOPER_URL="https://healthymax.cn/developer/console/" `
  -- node C:/foodlink-mcp/src/server.mjs

codex mcp list
```

也可以把 [`examples/codex-config.toml`](./examples/codex-config.toml) 合并进 `~/.codex/config.toml`。保存后重启 Codex；在支持命令菜单的客户端中可用 `/mcp` 查看连接状态。

## WorkBuddy 或通用 MCP 客户端

把 [`examples/mcp-config.json`](./examples/mcp-config.json) 中的两个 Windows 路径替换为目标电脑的实际路径，再合并进客户端的 MCP 配置。不同客户端的配置文件位置不同，但 stdio 启动参数保持一致：

```json
{
  "mcpServers": {
    "foodlink": {
      "command": "node",
      "args": ["C:/foodlink-mcp/src/server.mjs"],
      "env": {
        "FOODLINK_API_KEY_FILE": "C:/Users/YOUR_NAME/.foodlink/api-key",
        "FOODLINK_API_BASE_URL": "https://api.healthymax.cn/open/v1",
        "FOODLINK_DEVELOPER_URL": "https://healthymax.cn/developer/console/"
      }
    }
  }
}
```

## 独立验证

不安装 Agent 也可以先验证 API。以下命令默认只查询账户与营养库，不扣分析点数：

```powershell
powershell -ExecutionPolicy Bypass -File C:/foodlink-mcp/examples/test-api.ps1 `
  -ApiKeyFile "$env:USERPROFILE/.foodlink/api-key"
```

增加 `-Text "一碗牛肉面"` 会提交一次文字分析并轮询结果，当前消耗 2 点：

```powershell
powershell -ExecutionPolicy Bypass -File C:/foodlink-mcp/examples/test-api.ps1 `
  -ApiKeyFile "$env:USERPROFILE/.foodlink/api-key" `
  -Text "一碗牛肉面"
```

如果安装了 `mcporter`，还可以直接检查 MCP 工具：

```powershell
$env:FOODLINK_API_KEY_FILE = "$env:USERPROFILE/.foodlink/api-key"
$env:FOODLINK_API_BASE_URL = "https://api.healthymax.cn/open/v1"
mcporter list --stdio "node C:/foodlink-mcp/src/server.mjs" --schema
mcporter call --stdio "node C:/foodlink-mcp/src/server.mjs" foodlink_get_account
```

## 提供的工具

| 工具 | 用途 | 是否可能扣点 |
| --- | --- | --- |
| `foodlink_get_account` | 查询应用、Scope 和点数余额 | 否 |
| `foodlink_search_food` | 搜索可信营养数据库 | Beta 期免费 |
| `foodlink_analyze_text` | 提交文字餐食分析 | 是 |
| `foodlink_upload_image` | 上传本机食物图片 | 提交分析前置步骤 |
| `foodlink_analyze_images` | 分析已上传图片 | 是 |
| `foodlink_get_analysis` | 查询异步任务状态和结果 | 否 |
| `foodlink_get_recharge_url` | 返回用户可主动打开的充值页 | 否，不会付款 |

建议直接对 Agent 说：

- “用食探搜索 100 克牛肉的营养信息。”
- “用食探分析这张餐食照片，等结果完成后告诉我热量和蛋白质。”
- “检查食探 API 余额；如果不足，只告诉我充值地址，不要替我付款。”

图片流程必须是 `foodlink_upload_image` → `foodlink_analyze_images` → `foodlink_get_analysis`。文字和图片分析都是异步任务；状态为 `queued` 或 `processing` 时继续轮询，直到 `completed` 或 `failed`。

## 计费与错误处理

- 文字分析 2 点，普通图片 5 点，精准图片 15 点。
- 同一业务请求重试时必须复用 `idempotency_key`，否则会被视为新请求并再次扣点。
- HTTP 402 表示余额不足。MCP 只返回充值地址，用户确认后自行打开网页支付。
- HTTP 429 表示限流，应根据 `Retry-After` 稍后重试。
- HTTP 401 表示 Key 缺失、错误、过期或已吊销。
- 失败、取消和超时任务由后台对账器幂等退回预留点数。

## 安全要求

- 不要把 API Key 发到群聊、提交到 Git、写进截图或打印到日志。
- 每位开发者、每套服务和每个硬件合作方使用独立应用与 Key，便于单独吊销和审计。
- 服务器、容器和硬件网关优先使用 `FOODLINK_API_KEY_FILE` 只读挂载。
- 不要把长期开发者 Key 烧进可提取的设备固件；量产硬件应由厂商服务端代理调用，或后续使用每设备独立身份。
- 若同时设置 `FOODLINK_API_KEY` 与 `FOODLINK_API_KEY_FILE`，环境变量中的 `FOODLINK_API_KEY` 优先。
