# FoodLink AI Integration Guide

> 这份文件专门写给 AI Agent、AI 编程助手和自动化开发工具。人类开发文档：<https://healthymax.cn/developer/docs/>；严格接口定义：<https://healthymax.cn/openapi/foodlink-openapi-v1.yaml>。

## 你的任务

帮助用户把食探（FoodLink）食物分析能力接入 Codex、WorkBuddy、MCP 客户端、应用后端或硬件网关。优先复用官方 MCP；需要自定义语言、服务端或硬件网关时，再直接调用 HTTP API。

不要自行发明接口、字段、点数价格或模型参数。不要让用户把完整 API Key 粘贴进聊天记录、源码、网页前端或设备固件。

## 官方入口

- 正式 API：`https://api.healthymax.cn/open/v1`
- 开发者控制台：<https://healthymax.cn/developer/console/>
- 人类开发文档：<https://healthymax.cn/developer/docs/>
- OpenAPI 3.1：<https://healthymax.cn/openapi/foodlink-openapi-v1.yaml>
- MCP 使用说明：<https://healthymax.cn/developer/mcp-readme.md>
- AI 入口索引：<https://healthymax.cn/llms.txt>

除非用户明确要求内部 Preview，否则使用正式 API。不要把 `dev.api.healthymax.cn` 写进正式集成。

## 开始前必须做的事

1. 询问用户要接入的目标：Codex、WorkBuddy、其他 MCP 客户端、后端服务，还是硬件网关。
2. 询问 API Key 的**文件路径**，或指导用户设置 `FOODLINK_API_KEY_FILE`。不要要求用户在聊天里粘贴完整 Key。
3. 先调用不扣分析点数的 `GET /account`，确认 Key、scope 和余额。
4. 再按用户输入类型选择图片、文字或营养搜索流程。
5. 在产生点数消耗前告诉用户预计点数；不得自动充值或自动付款。

## 鉴权

推荐通过只读文件注入：

```text
FOODLINK_API_KEY_FILE=C:/Users/YOU/.foodlink/api-key
FOODLINK_API_BASE_URL=https://api.healthymax.cn/open/v1
```

HTTP 请求支持任意一种请求头：

```http
Authorization: Bearer flk_beta_...
```

或：

```http
X-API-Key: flk_beta_...
```

可用 scope：

- `food:analyze`：上传图片、提交分析、读取分析结果。
- `food:search`：搜索可信营养库。

## 决策规则

按以下规则自动选择工具，但不要替用户扩大任务范围：

1. 用户要查某种标准食物的营养信息：调用营养搜索，不提交 AI 分析。
2. 用户提供本机餐食图片：先上传图片，再提交图片分析，最后轮询结果。
3. 用户只提供文字描述：提交文字分析，再轮询结果。
4. 默认使用 `standard`；只有用户明确需要更精细估重、复杂混合餐拆分或高精度时才使用 `precision`。
5. 用户说“没喝汤”“只吃了一半”“两人分食”等信息时，放入 `additional_context`。
6. 用户给出餐次或日期时，映射到 `meal_type` 和 `date`。
7. 同一业务请求重试时必须复用原 `Idempotency-Key` / `idempotency_key`。
8. 收到 HTTP 402 时停止分析，只返回充值页并等待用户主动处理，不得自动支付。

## 点数

| 操作 | 点数 |
| --- | ---: |
| 营养库搜索 | Beta 期免费 |
| 文字分析 | 2 点/次 |
| 普通图片分析 | 5 点/张 |
| 精准图片分析 | 15 点/张 |

多图按图片数量计费。失败、取消、超时或违规终态由服务端幂等退款。

## HTTP API 流程

### 1. 检查账户

```bash
curl "https://api.healthymax.cn/open/v1/account" \
  -H "Authorization: Bearer $FOODLINK_API_KEY"
```

读取 `data.app_id`、`data.balance_units` 和 `data.scopes`。如果缺少所需 scope，停止并告诉用户创建或更换 Key。

### 2A. 图片分析

先上传 JPEG、PNG 或 WebP。单张最大 8MB：

```bash
curl -X POST "https://api.healthymax.cn/open/v1/uploads" \
  -H "Authorization: Bearer $FOODLINK_API_KEY" \
  -F "file=@meal.jpg"
```

保存响应中的 `data.image_url`。只允许使用当前应用上传返回的 URL；不要提交任意外部图片 URL。

然后提交分析：

```bash
curl -X POST "https://api.healthymax.cn/open/v1/food-analyses" \
  -H "Authorization: Bearer $FOODLINK_API_KEY" \
  -H "Idempotency-Key: lunch-photo-20260903-001" \
  -H "Content-Type: application/json" \
  -d '{
    "image_urls": ["上传接口返回的 image_url"],
    "mode": "precision",
    "meal_type": "lunch",
    "date": "2026-09-03",
    "additional_context": "米饭只吃了一半，没有喝汤"
  }'
```

一次最多提交 5 张图片。`text` 与 `image_urls` 不能同时出现。

### 2B. 文字分析

```bash
curl -X POST "https://api.healthymax.cn/open/v1/food-analyses" \
  -H "Authorization: Bearer $FOODLINK_API_KEY" \
  -H "Idempotency-Key: dinner-text-20260903-001" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "番茄炒蛋一份、米饭约 150 克",
    "mode": "standard",
    "meal_type": "dinner",
    "date": "2026-09-03",
    "additional_context": "番茄炒蛋两人分食，我吃了一半"
  }'
```

### 3. 轮询任务

提交成功返回 HTTP 202 和 `data.task_id`：

```bash
curl "https://api.healthymax.cn/open/v1/food-analyses/{task_id}" \
  -H "Authorization: Bearer $FOODLINK_API_KEY"
```

状态处理：

- `queued` / `processing`：等待 2–3 秒后继续查询；使用指数退避，不要高频轮询。
- `completed`：读取结果并向用户总结。
- `requires_action`：把服务端问题或补拍要求原样告诉用户，不要编造答案。
- `failed`：告诉用户失败原因和退款状态；不要无条件用新幂等键重复扣点。

### 4. 营养搜索

```bash
curl "https://api.healthymax.cn/open/v1/foods/search?query=鸡胸肉&limit=5" \
  -H "Authorization: Bearer $FOODLINK_API_KEY"
```

`query` 必填；`limit` 为 1–20，默认 5。

## 分析参数

| 参数 | 类型 | 规则 |
| --- | --- | --- |
| `text` | string | 与 `image_urls` 二选一 |
| `image_urls` | string[] | 与 `text` 二选一；最多 5 张 |
| `mode` | `standard` / `precision` | 默认 `standard` |
| `meal_type` | enum | `breakfast`、`morning_snack`、`lunch`、`afternoon_snack`、`dinner`、`evening_snack` |
| `additional_context` | string | 用户补充的份量、剩余、汤汁、多人分食等上下文 |
| `date` | `YYYY-MM-DD` | 餐食日期 |

不要向外部用户提供底层模型、供应商、prompt、reasoning 或内部执行参数。

## 结果读取

公共响应通常为：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

完成任务后重点读取：

- `data.result.items[]`：食物明细。
- `items[].name`：食物名称。
- `items[].estimatedWeightGrams`：估算重量。
- `items[].nutrients`：热量、蛋白质、脂肪、碳水、膳食纤维及可用微量营养素。
- `data.result.description`：餐食摘要。
- `data.result.insight`：营养洞察。
- `data.result.context_advice`：建议。
- `data.result.uncertaintyNotes`：不确定性说明。
- `data.cost_units`：本次消耗。
- `data.balance_units` / `data.refunded`：退款终态下的余额信息。

不要把估算值描述成医学诊断或绝对精确测量。向用户展示关键假设和不确定性。

## MCP 优先接入

目标客户端支持 stdio MCP 时，优先使用官方 MCP 包。Node.js 需 20 或更高版本。

```json
{
  "mcpServers": {
    "foodlink": {
      "command": "node",
      "args": ["C:/foodlink-mcp/src/server.mjs"],
      "env": {
        "FOODLINK_API_KEY_FILE": "C:/Users/YOU/.foodlink/api-key",
        "FOODLINK_API_BASE_URL": "https://api.healthymax.cn/open/v1",
        "FOODLINK_DEVELOPER_URL": "https://healthymax.cn/developer/console/"
      }
    }
  }
}
```

官方 MCP 工具：

- `foodlink_get_account`
- `foodlink_search_food`
- `foodlink_upload_image`
- `foodlink_analyze_images`
- `foodlink_analyze_text`
- `foodlink_get_analysis`
- `foodlink_get_recharge_url`

工具调用顺序与 HTTP 流程相同。图片必须先 `foodlink_upload_image`；分析提交后必须 `foodlink_get_analysis` 轮询。

## 错误处理

| HTTP | 处理方式 |
| ---: | --- |
| 400 | 修正参数；检查 text/image_urls 二选一、图片格式和字段枚举 |
| 401 | Key 缺失、错误、过期或吊销；让用户检查 Key 文件 |
| 402 | 余额不足；返回控制台地址并停止，不自动付款 |
| 403 | Key 缺少所需 scope |
| 409 | 幂等键冲突或原请求尚未完成；检查是否复用了错误业务键 |
| 429 | 读取 `Retry-After` 后退避重试 |
| 503 | 关键依赖暂不可用；退避后重试，不高频轰炸 |

## 安全红线

- 不输出、记录、提交或回显完整 API Key。
- 不把开发者 Key 写入网页前端、公开 App 包或可提取的硬件固件。
- 不自动付款，不模拟用户确认，不伪造登录。
- 不使用未文档化的 `/api/*` 内部接口。
- 不允许调用方指定底层模型或供应商。
- 不把食物估算结果当作医疗诊断。
- 硬件量产时由厂商服务端代理调用，或等待每设备独立身份方案。

## 完成接入后的自检

1. `GET /account` 成功，且没有在日志打印 Key。
2. 营养搜索成功。
3. 图片上传返回当前应用专属 `image_url`。
4. 分析请求使用稳定幂等键。
5. 能轮询到终态并正确处理 `requires_action`、失败和退款。
6. 能识别 402 并只提示用户充值。
7. 用户能看到点数消耗、关键假设和不确定性。

如果接口字段与本文冲突，以 OpenAPI 3.1 文件为结构化契约，并向用户指出差异，不要自行猜测。
