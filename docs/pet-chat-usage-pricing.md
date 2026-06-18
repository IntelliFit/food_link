# 宠物对话式饮食分析用量计费方案

## 结论

- 用户侧积分换算：`1 元 = 25 积分`。
- 成本侧模型：第一版按 `deepseek-v4-pro` 文本模型计算。
- 目标毛利：按模型真实成本乘以 `3x` 成本倍率，对应约 `66.7%` 毛利率。
- 最低扣费：每次有效模型回答最低 `1` 积分。
- 单次上限：第一版默认最高 `20` 积分，防止异常长输出或供应商 usage 异常造成用户无感高额扣费。
- 计费依据：正式版按模型返回的 `input_tokens` 和 `output_tokens` 实际 usage 扣费；发起前必须先调用后端估价接口，不能只信前端本地估算。

## 为什么是 1 元 = 25 积分

当前套餐口径：

- 月卡价格：`9.9 元/月`
- 每日积分：`8 积分/天`
- 每月积分：`8 * 30 = 240 积分`

换算：

```text
每积分人民币价值 = 9.9 / 240 = 0.04125 元
每 1 元可买到的积分 = 240 / 9.9 = 24.24 积分
```

产品上取整为：

```text
1 元 = 25 积分
1 积分 = 0.04 元
```

## 正式扣费公式

```text
模型真实成本 CNY =
  input_tokens / 1,000,000 * input_price_usd_per_1m * usd_cny
  + output_tokens / 1,000,000 * output_price_usd_per_1m * usd_cny

应收金额 CNY = 模型真实成本 CNY * 3

扣除积分 = max(1, ceil(应收金额 CNY * 25))
最终扣除积分 = min(扣除积分, maximum_credits_per_request)
```

第一版参数：

```text
credits_per_cny = 25
usd_cny = 7.25
cost_multiplier = 3
input_price_usd_per_1m = 0.435
output_price_usd_per_1m = 0.87
min_credits = 1
maximum_credits_per_request = 20
```

## 参考成本示例

| 场景 | input tokens | output tokens | 约扣积分 |
|---|---:|---:|---:|
| 轻量追问 | 2,000 | 600 | 1 |
| 最近 7 天常规分析 | 5,000 | 1,000 | 2 |
| 最近 7 天较详细分析 | 8,000 | 1,200 | 3 |
| 最近 30 天常规分析 | 14,000 | 1,300 | 4 |
| 最近 30 天记录很多 | 24,000 | 1,800 | 7 |

这些不是固定价格，只是基于 token usage 的示例。实际扣费以后端拿到模型 usage 后计算为准。

## 用户提示文案

发起前：

```text
小食探将读取你已保存的饮食文本和营养数据，不读取图片。
本次按模型输入/输出用量折算积分，预计约 2-4 积分。
```

完成后：

```text
本次分析消耗 3 积分。
```

失败时：

```text
小食探这次没有成功完成分析，未扣除积分。
```

## 已落地接口

宠物对话使用专用接口，不继续复用统计页洞察接口：

```text
POST /api/pet/chat/estimate
POST /api/pet/chat
```

`estimate` 返回：

```json
{
  "question": "我最近训练状态下滑了，帮我看饮食原因",
  "range": "week",
  "range_label": "最近 7 天",
  "recorded_days": 5,
  "estimated_usage": {
    "input_tokens": 5200,
    "output_tokens": 1050,
    "total_tokens": 6250
  },
  "pricing": {
    "model": "deepseek-v4-pro",
    "input_tokens": 5200,
    "output_tokens": 1050,
    "total_tokens": 6250,
    "provider_cost_cny": 0.026098,
    "charged_cny": 0.078294,
    "credits_charged": 2,
    "credits_per_cny": 25,
    "cost_multiplier": 3,
    "gross_margin_rate": 0.6667,
    "minimum_credits": 1,
    "pricing_source": "default:pet-chat-2026-06"
  }
}
```

`chat` 返回：

```json
{
  "question": "我最近训练状态下滑了，帮我看饮食原因",
  "range": "week",
  "range_label": "最近 7 天",
  "answer": "...",
  "recorded_days": 5,
  "credits_charged": 2,
  "billing_status": "actual_usage_charged",
  "ai_usage_pricing": {
    "model": "deepseek-v4-pro",
    "input_tokens": 6100,
    "output_tokens": 980,
    "total_tokens": 7080,
    "provider_cost_cny": 0.027687,
    "charged_cny": 0.083061,
    "credits_charged": 3
  },
  "estimated_pricing": {
    "credits_charged": 2
  }
}
```

## 扣费与审计

当前第一版不新增单独对话表，避免为了 demo 引入数据库迁移；审计信息写入积分流水 `user_earned_credit_ledger.meta`。

注意：宠物对话不是 `analysis_tasks` 异步任务，不能依赖任务 payload 统计每日系统积分。因此成功生成后会额外写一条 `delta=0` 的系统积分使用 ledger，`meta.credit_usage.system_by_date` 记录本次消耗的系统积分；如果还需要消耗奖励积分，则再按原有负数 `delta` 记录扣减奖励积分余额。

系统积分使用 ledger 与奖励积分扣减 ledger 必须在同一个数据库事务中写入。当前通过 `ChangeCreditsWithSystemUsage` 完成，保证同一次同步 AI 消费的系统积分占用和奖励积分扣减同成同败；两条 ledger 通过 `credit_charge_source_key` 关联。

生成流程：

1. 前端点击深度分析时，先调用 `/api/pet/chat/estimate`。
2. 后端按当前饮食上下文 prompt 估算 token，并通过 `ValidateUsageCredits` 校验预计积分。
3. 用户确认后，前端调用 `/api/pet/chat`。
4. 后端调用模型，解析真实 usage。
5. 后端按真实 usage 重新计算积分，再次通过 `ValidateUsageCredits` 校验。
6. 成功生成后调用 `ConsumeEarnedCreditsAfterSuccess` 扣除实际积分。
7. 模型失败、返回空内容或被安全规则拒绝时，不扣积分。

积分流水 meta 字段：

- `range`
- `question`
- `recorded_days`
- `billing_strategy=actual_usage`
- `credit_usage.system_by_date`
- `system_units`
- `ledger_role=system_credit_usage`（每日系统积分统计只认该角色的 `delta=0` ledger）
- `ai_usage_pricing.model`
- `ai_usage_pricing.input_tokens`
- `ai_usage_pricing.output_tokens`
- `ai_usage_pricing.total_tokens`
- `ai_usage_pricing.provider_cost_cny`
- `ai_usage_pricing.charged_cny`
- `ai_usage_pricing.credits_charged`
- `ai_usage_pricing.uncapped_credits_charged`
- `ai_usage_pricing.credits_per_cny`
- `ai_usage_pricing.cost_multiplier`
- `estimated_pricing`

## 追问策略

第一版小程序前端用会话内 `lastAnalysis` 做保护：

- 首轮深度分析走 `/api/pet/chat/estimate` + `/api/pet/chat`，按真实 usage 扣费。
- 同一轮后续追问沿用上次分析线索，本地延展，不重新调用模型，不重复扣积分。
- 页面明确显示“本轮追问沿用刚才线索，不重复扣积分”。
- 宠物回复也会说明“这一轮追问我不会重新调用模型，也不会重复扣积分”。

后续服务端增强方向：

- 增加 `conversation_id` 和上下文摘要缓存。
- 同一上下文内追问按增量 usage 低价计费，或在一定次数内免费。
- 缓存命中时记录 `cache_hit=true`，并把缓存命中价格单独配置。

## 注意

- `7 天` 和 `30 天`只是上下文范围，不是固定价格档位。
- 更长范围通常 token 更多，所以自然更贵。
- 同一上下文内追问应复用摘要，第一版前端会话内不重复扣积分。
- 模型返回无有效答案时不扣费。
- 真正进入生成前必须以后端估价为准；后端估价失败时前端不得继续调用生成接口。
