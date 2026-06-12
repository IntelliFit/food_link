# 食物分析日志与排查指南

用于排查：**识别不准**、**任务 failed/timed_out**、**莫名 500**。

## 一条请求的完整链路

```text
小程序 POST /api/analyze/submit
  → analyze_handler（分析接口 submit_image_task）
  → task_service（分析任务已提交 / 已入队）
  → task_queue（memory/kafka）
  → worker Runner（任务已认领 → 任务处理开始 → 食物任务分析开始）
  → AnalyzeService.Analyze（food image analyze llm start → 视觉模型识别结果已返回 → 营养库优先回算…）
  → worker（食物任务分析结果已生成 → 食物任务已完成）
  → 小程序轮询 GET /api/analyze/tasks/:task_id
```

同步识别（`/api/analyze`）跳过 worker，但 **AnalyzeService 内日志相同**。

## 关键日志消息（按时间顺序）

| 阶段 | 日志 msg（中文/英文） | 关键字段 |
| --- | --- | --- |
| HTTP | `请求完成` / `请求失败` | `url.path`, `http.status_code`, `trace_id` |
| 提交 | `分析接口` action=`submit_image_task` | `user_id`, `image_count`, `execution_mode` |
| 任务创建 | `分析任务已提交` | `task_id`, `task_type`, `model_name`, `execution_mode` |
| 入队 | `分析任务已入队` | `task_id`, queue driver |
| Worker | `任务已认领` / `任务处理开始` | `worker_id`, `task_id`, `task_type` |
| 分析开始 | `食物任务分析开始` | `model_name`, `execution_mode`, `image_count` |
| LLM | `food image analyze llm start` | `provider`, `model` |
| LLM 结果 | `视觉模型识别结果已返回` | **`items`**（名称/重量/热量摘要） |
| LLM 重试 | `llm call failed; retrying same task` | `retry_reason`, `provider` |
| LLM 失败 | `LLM 调用最终失败` / `food image analyze llm failed` | `error` |
| 营养库 | `营养库优先回算开始/完成` | `items`, `resolve_status`, `matched_food_name` |
| Worker 结果 | `食物任务分析结果已生成` | **`items`** 摘要 |
| 完成 | `食物任务已完成` | `item_count`, `duration` |
| 失败 | `任务处理结束但返回错误` | `error`, `task_id` |
| 查询失败任务 | `查询到终态分析任务` / `get_task_terminal` | `status`, `error_message` |

## 在 Jaeger / 日志平台怎么查

1. 从小程序或响应头拿到 **`X-Trace-Id`**（或 `request_id`）。
2. 在日志系统搜：`trace_id:"<id>"` 或 `analysis.task_id:"<uuid>"`。
3. 打开 Jaeger 同 trace，看 span：
   - `analysis.task.process`
   - `analysis.task.food`
   - `analysis.food_text` / HTTP span
4. Span Events 含 `视觉模型识别结果已返回`、`食物任务分析结果已生成` 等。

## 识别不准时看什么

1. **`视觉模型识别结果已返回` 的 `items`**：模型原始名称、估重、是否已有 nutrients。
2. **`营养库优先回算完成`**：每个 item 的 `resolve_status`、`nutrition_source`、`matched_food_name`。
3. **`package_match_status` / `package_weight_*`**（包装实验模式）：规格是否命中。
4. **`gemini 3.5 grouped estimate applied`** 等：精准/分组估重分支。
5. **`standard image hybrid review applied`**：标准模式二次校准。

若 LLM 名称合理但营养离谱 → 查营养库 / DeepSeek 补全日志（`DeepSeek 营养补全完成`）。

## 莫名报错时看什么

| 现象 | 优先日志 |
| --- | --- |
| 提交即失败 | `分析接口失败`, `分析任务入队失败` |
| 一直 processing | `任务租约心跳失败`, worker 是否 `内嵌 worker 已启用` |
| failed + error_message | `get_task_terminal`, `查询到终态分析任务` |
| 500 无 task_id | `未处理错误`, `请求失败` + `trace_id` |
| JSON 解析失败 | `llm call failed; retrying`, `LLM 调用最终失败` |
| 积分/会员 | task_service 内 credit 相关（结合 `error_message`） |

## 日志字段约定

- 业务代码统一使用 **`logger.Info/Warn/Error(ctx, ...)`**（或 handler 层 `handlerlog.Log`），禁止 `logger.L()` / 无 ctx 的 `r.log.*`。
- Handler 业务日志：`api.module` + `api.action` 字段（见 `handlerlog` 包）。
- **`items`**：最多 12 条摘要，超出有 `more_count`；不含图片 URL / prompt 全文。
- **`llm_response_preview`**：LLM 原始 JSON 截断（运动/部分场景）。
- **`error_message`**：任务失败原因，截断 300 字符。
- 所有业务日志应带 **`trace_id`**（传 `context.Context` 时自动注入）。

## 配置

```yaml
log:
  level: info    # 排查时可改为 debug
  format: json
otel:
  enabled: true  # 启用 trace + OTel 日志关联
```

本地改 `backend/config.yaml` 后需重启 `npm run dev:backend`。
