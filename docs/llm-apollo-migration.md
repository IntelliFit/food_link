# 大模型 Apollo 迁移清单

本项目的服务端模型调用由 Apollo `app-config.yaml` namespace 的 `external` 节管理。API key 仅保存在 Apollo 或部署密钥管理中，不要写入仓库、日志或小程序端。

## 新平台 OpenAI-compatible 配置

新平台文档给出的根地址是 `https://maas-openapi.wanjiedata.com/api`，但本项目客户端会自行追加 `/chat/completions` 或 `/responses`。因此 Apollo 中的 `*_base_url` 必须填写带版本号的前缀：

```yaml
https://maas-openapi.wanjiedata.com/api/v1
```

例如，代码会将该值拼成 `https://maas-openapi.wanjiedata.com/api/v1/chat/completions`。

以下是运行时模型接入的完整配置清单。先在开发 namespace 灰度验证，再复制到生产 namespace；所有实际 key 用各自的安全值替换。

```yaml
external:
  # 主图片识别路由：doubao / gemini / qwen 等，保持当前线上选择即可。
  llm_provider: ""

  # 豆包兼容链路：图片识别、OCR、运动估算，以及可选 Responses 联网搜索。
  doubao_api_key: "<新平台 OpenAI key>"
  doubao_base_url: "https://maas-openapi.wanjiedata.com/api/v1"
  # 仅启用原生 Responses 联网搜索时才需要；通常可先与 doubao_api_key 使用同一 key。
  doubao_web_search_api_key: "<新平台 OpenAI key>"

  # Ofox/Gemini 兼容链路：标准/精准图片识别和部分保质期识别。
  ofoxai_api_key: "<新平台 OpenAI key>"
  ofoxai_base_url: "https://maas-openapi.wanjiedata.com/api/v1"

  # 万界 Gemini 3.5：精准模式的第一备用链路，也供营养标签等既有功能使用。
  gemini35_api_key: "<新平台 OpenAI key>"
  gemini35_base_url: "https://maas-openapi.wanjiedata.com/api/v1"
  gemini35_model: "gemini-3.5-flash"

  # OpenLux：精准模式固定使用 gemini-3.6-flash；普通模式作为 Gemini 第二上游。
  openlux_api_key: "<OpenLux key>"
  openlux_base_url: "https://api.openlux.ai/v1"
  # 仅控制普通模式命中 Gemini 后的上游比例。
  openlux_ordinary_gemini_traffic_percent: 50

  # Qwen/DashScope 兼容链路。
  dashscope_api_key: "<新平台 OpenAI key>"
  dashscope_base_url: "https://maas-openapi.wanjiedata.com/api/v1"
  # 普通模式同一图片稳定命中同一模型；0=全 Gemini，100=全 Qwen。
  qwen38_ordinary_traffic_percent: 50

  # DeepSeek 文本链路：文字记餐、营养补全、统计洞察、宠物对话、
  # 自定义关注卡、今天吃什么推荐与可食比例判断。
  deepseek_api_key: "<新平台 OpenAI key>"
  deepseek_base_url: "https://maas-openapi.wanjiedata.com/api/v1"
```

`ai_usage_pricing` 不属于本次迁移配置，不要添加到 Apollo。它是项目内部积分计费的默认参数，与 API key、请求地址和模型接入无关。

## 模型名和协议边界

- `gemini35_model` 保留给万界 Gemini 3.5 备用链路和既有标签功能。精准食物图片主模型由代码固定为 OpenLux `gemini-3.6-flash`；快速模式固定为 `qwen3.8-flash`。
- 切换前必须在新平台模型列表中逐个确认这些模型名可用；新平台不支持的模型不能只换 key，需要再调整对应模型路由或默认模型配置。
- 当前服务端调用的是 OpenAI-compatible 格式；不要把 Anthropic 地址 `https://maas-openapi.wanjiedata.com/api/anthropic` 填入任何 `*_base_url`。项目目前没有 Anthropic `/v1/messages` 客户端，接 Claude 的 Anthropic 协议需要单独开发。
- `doubao_web_search_api_key` 对应 `/responses` 的原生联网搜索能力。新平台是否支持同样的工具参数需要先验证；不支持时先留空或关闭该能力，普通 `/chat/completions` 不受影响。

## Qwen3.8 思考参数

项目通过 HTTP 直接调用 OpenAI-compatible `chat/completions`，所以思考参数与 `model`、`messages` 同级放在请求体顶层，不需要 Python SDK 示例中的 `extra_body`：

```json
{
  "model": "qwen3.8-flash",
  "messages": [{"role": "user", "content": "..."}],
  "enable_thinking": true,
  "reasoning_effort": "medium",
  "preserve_thinking": false
}
```

- `reasoning_effort` 原生档位为 `low`、`medium`、`xhigh`；Qwen3.8 默认 `xhigh`。`high`/`max` 会映射为 `xhigh`，`minimal` 映射为 `low`，`none` 等价于关闭思考。
- 不思考时传 `enable_thinking: false`，并且不要同时传一个非 `none` 的 `reasoning_effort`。
- `reasoning_effort` 与 `thinking_budget` 二选一，Qwen3.8 同时传入会报错。
- 当前业务策略：普通质量型Qwen单轮调用和用户开启深度思考的宠物问答使用`medium`；快速图片识别、Gemini故障回退、联网搜索、校园工具调用和离线批处理关闭思考；健康报告OCR使用`low`。精准图片主链路使用OpenLux Gemini 3.6，不再抽样进入Qwen深度思考规划。
- 当前服务没有保存并回传 `reasoning_content`，因此显式传 `preserve_thinking: false`，避免 Qwen3.8 默认开启历史思考保留后引入额外上下文成本。
- 模型路由：快速模式始终使用Qwen3.8 Flash并关闭思考；普通模式默认50% Qwen3.8/50% Gemini 3 Flash，仍使用稳定哈希；精准模式固定使用OpenLux Gemini 3.6 Flash，不再按比例抽中Qwen。
- 精准首选OpenLux Gemini 3.6遇到临时错误、超时或JSON解析失败时，先回退万界Gemini 3.5；仍失败才关闭思考回退Qwen3.8。万界实时模型目录没有`gemini-3.6-flash`，因此备用链路不能伪装成同模型双上游。
- 历史配置`qwen38_precision_traffic_percent`和`openlux_precision_gemini_traffic_percent`继续允许存在于旧Apollo namespace以兼容回滚，但当前精准路由不再读取它们。

## 验证顺序

1. 在 Apollo 开发 namespace 写入新 key 和上述 `base_url`，不要修改生产。
2. 重启开发后端，使启动时读取新的 Apollo 配置。
3. 依次验证文字记餐、普通图片识别、精准识别、统计洞察、宠物对话、今天吃什么和保质期识别。
4. 查看结构化日志中的 `provider`、`model`、上游错误状态，确认没有请求残留到旧域名。
5. 通过后再复制到生产 namespace，并以同样顺序灰度验证。

## 离线脚本

`backend/scripts/` 下的个别批处理脚本不经过服务端 Apollo 配置，而是读取当前 shell 的环境变量。需要运行这些脚本时，按脚本使用的 provider 设置对应变量，例如 `DEEPSEEK_API_KEY` + `DEEPSEEK_BASE_URL`、`DOUBAO_API_KEY` + `DOUBAO_BASE_URL`、`OFOXAI_API_KEY` + `OFOXAI_BASE_URL`、`DASHSCOPE_API_KEY` + `DASHSCOPE_BASE_URL`；同样使用 `https://maas-openapi.wanjiedata.com/api/v1` 作为 OpenAI-compatible 前缀。
