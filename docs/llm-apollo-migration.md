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

  # Gemini 3.5 精准识别和运动长文本备用链路。
  gemini35_api_key: "<新平台 OpenAI key>"
  gemini35_base_url: "https://maas-openapi.wanjiedata.com/api/v1"
  gemini35_model: "gemini-3.5-flash"

  # Qwen/DashScope 兼容链路。
  dashscope_api_key: "<新平台 OpenAI key>"
  dashscope_base_url: "https://maas-openapi.wanjiedata.com/api/v1"

  # DeepSeek 文本链路：文字记餐、营养补全、统计洞察、宠物对话、
  # 自定义关注卡、今天吃什么推荐与可食比例判断。
  deepseek_api_key: "<新平台 OpenAI key>"
  deepseek_base_url: "https://maas-openapi.wanjiedata.com/api/v1"
```

`ai_usage_pricing` 不属于本次迁移配置，不要添加到 Apollo。它是项目内部积分计费的默认参数，与 API key、请求地址和模型接入无关。

## 模型名和协议边界

- `gemini35_model` 已可在 Apollo 中调整。其他运行时默认模型由当前业务路由决定，例如 `deepseek-v4-pro`、`deepseek-v4-flash`、`gemini-3-flash-preview`、`qwen3.6-flash` 和 `doubao-seed-2-0-lite-260428`。
- 切换前必须在新平台模型列表中逐个确认这些模型名可用；新平台不支持的模型不能只换 key，需要再调整对应模型路由或默认模型配置。
- 当前服务端调用的是 OpenAI-compatible 格式；不要把 Anthropic 地址 `https://maas-openapi.wanjiedata.com/api/anthropic` 填入任何 `*_base_url`。项目目前没有 Anthropic `/v1/messages` 客户端，接 Claude 的 Anthropic 协议需要单独开发。
- `doubao_web_search_api_key` 对应 `/responses` 的原生联网搜索能力。新平台是否支持同样的工具参数需要先验证；不支持时先留空或关闭该能力，普通 `/chat/completions` 不受影响。

## 验证顺序

1. 在 Apollo 开发 namespace 写入新 key 和上述 `base_url`，不要修改生产。
2. 重启开发后端，使启动时读取新的 Apollo 配置。
3. 依次验证文字记餐、普通图片识别、精准识别、统计洞察、宠物对话、今天吃什么和保质期识别。
4. 查看结构化日志中的 `provider`、`model`、上游错误状态，确认没有请求残留到旧域名。
5. 通过后再复制到生产 namespace，并以同样顺序灰度验证。

## 离线脚本

`backend/scripts/` 下的个别批处理脚本不经过服务端 Apollo 配置，而是读取当前 shell 的环境变量。需要运行这些脚本时，按脚本使用的 provider 设置对应变量，例如 `DEEPSEEK_API_KEY` + `DEEPSEEK_BASE_URL`、`DOUBAO_API_KEY` + `DOUBAO_BASE_URL`、`OFOXAI_API_KEY` + `OFOXAI_BASE_URL`、`DASHSCOPE_API_KEY` + `DASHSCOPE_BASE_URL`；同样使用 `https://maas-openapi.wanjiedata.com/api/v1` 作为 OpenAI-compatible 前缀。
