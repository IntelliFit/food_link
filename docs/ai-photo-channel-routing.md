# 餐照三渠道路由与真实请求评估

## 当前实现与启用边界

模型档位沿用产品已有配置：普通 Gemini 3 Flash Preview；精准万界 3.5 Flash / OpenLux 3.6 Flash；快速 Qwen3.8。A6 不改变模式或模型，按当前请求的实际 Gemini 型号重放。快速模式、文字任务不参与此 Gemini 路由；精准既有 Qwen 回退边界不变，普通模式所有 Gemini 渠道失败后明确失败。

代码已支持 A6 影子评估和验收后三路调度。部署后配置 Key 才会发送 A6 请求；切流开关默认关闭，模型验收清单默认空。凭证只由用户写 Apollo，代理不改 Apollo，也不把测试 Token 写入源码。

## 第一阶段 Apollo 配置

在 `food-link` 的 dev/main `app-config.yaml` 现有 `external` 节合并以下字段，保留其它模型字段与首选比例。不要重复建立第二个 `external` 节。

```yaml
external:
  a6_api_key: "填入新的正式Key"
  a6_base_url: "https://api.a6api.com"
  vision_routing:
    a6_shadow_percent: 10
    shadow_max_concurrent: 2
    shadow_timeout_seconds: 35
    cost_routing_enabled: false
    a6_approved_models: []
    a6_independent_upstream: false
    hedge_min_seconds: 3
    hedge_max_seconds: 6
    third_hedge_seconds: 10
    overall_timeout_seconds: 35
    circuit_failures: 3
    circuit_cooldown_seconds: 60
    uncertain_review_enabled: false
```

- 第一阶段由既有万界/OpenLux 返回用户结果，慢请求启动第二路从固定10秒改为3–6秒范围内的滚动P75，冷启动取6秒。比例字段仍决定主渠道，现网配置0仍为万界主发。
- 影子复用完整 prompt、全部图片、实际型号、温度及8192输出token预算，显式 `stream:false`。生产调用和影子调用协议可不同（万界原生Gemini，A6/OpenLux OpenAI兼容），不宣称完全相同传输链路。
- 每个真实任务最多影子一个 Gemini 阶段，采样为确定性10%；内部基准、开放API任务不采样。精准仅规划任务采样，估重子任务不重复采样。
- 影子与主请求并行，脱离主请求取消，具有独立35秒截止，每Pod额外并发最多2；3个Pod最多6。影子不执行营养后处理、不写识别任务或饮食记录、不扣用户积分；API token仍产生费用。
- 影子只记录任务ID、图片数、prompt字节数、型号、状态、耗时、token和最多20项名称/重量/置信度，不记录图片URL、完整prompt或Key。
- `a6_shadow_percent: 0` 停止新影子请求；不影响其它两个渠道。

## 数据汇总

部署新后端后，汇总全部Pod的JSON日志，避免只看单个Pod样本。将JSONL传入只读工具（在backend目录）：

```powershell
go run ./cmd/vision-routing-report -input D:/logs/foodlink-routing.jsonl
```

也支持标准输入：`go run ./cmd/vision-routing-report`。不要将kubectl前缀、时间戳前缀加在JSON前；该工具只解析原始JSON行。

报告按模式、阶段、型号、渠道、是否影子汇总业务有效率、超时、坏JSON、取消、P50/P95和已报告token。名称一致/不一致只作人工抽样线索，不能当真实准确率；精准模式在主链路切换3.5/3.6后与影子型号不同的样本单独标为different_model，不算同型号一致率。未报告token的请求、包括已取消请求，仍可能收费；工具不估算未知账单。拿平台实际单价与输入/输出token相乘核算成本，结合账单校验。

评估A6主要使用独立影子样本。在线竞速会取消慢请求，完整成功耗时存在截尾偏差，不能直接拿获胜样本P95评价供应商整体速度。影子容量或熔断跳过也要计入观察记录，不能将有选择的样本当完全随机总体。

后处理新增 `processing_timings_ms`（识别及复核、可食比例、营养解析、微量营养、建议份量、总后处理）和阶段结构化日志/OTel指标；营养向量、语义判定、并行营养模型补全另有独立耗时。它们均是后台时间，上传和前端轮询仍需真机记录，不宣称“拍照到展示”已完成测量。

## 第二阶段：验收后降低成本

每个待批准型号至少累计500条真实同模式样本，并人工盲评至少50条困难餐照。建议门槛：业务有效>=99%，超时<=0.5%，模型完整响应P50<=8秒/P95<=15秒；质量不明显劣于当前链路。50条仅为初步质量筛查，不能用来证明1个百分点的非劣效，需要更多人工标注才能做精确统计结论。

A6固定商家且确认独立上游后，才设置 `a6_independent_upstream: true`。质量通过的型号才逐个加入列表，例如只批准普通模式：

```yaml
vision_routing:
  cost_routing_enabled: true
  a6_independent_upstream: true
  a6_approved_models:
    - gemini-3-flash-preview
```

通过的型号顺序为A6立即启动、3–6秒未返回有效结果再启动OpenLux、10秒仍无有效结果才启动万界。明确错误、限流、坏JSON或空结果会立即启动下一路。三路共享35秒模型截止；首个业务有效结果获胜并取消其它请求。已有精准路由切换3.5/3.6时，provider与model始终成对，不把A6的一个型号替换成另一型号。

未批准型号继续当前主渠道+OpenLux/万界二路，不进入A6用户结果。A6速度不达标时，可以由用户把原OpenLux首选比例改100，让中等成本OpenLux主发、万界兜底；不基于小样本自动修改比例。

## 正确率和故障处理

- 食物识别业务校验拒绝空食物、缺失名称、明显无效重量以及token截断；规划阶段沿用既有非空JSON校验。通过校验不等于食物身份正确。
- `uncertain_review_enabled: true` 只对置信度<0.65或有alternativeNames的结果启动独立另一渠道（或等正在执行的渠道）复核，最多额外4秒；未出现不确定信号时不增加请求。无法完成复核时保留身份待确认标记，结果冲突写uncertaintyNotes和channel_review，保留首次判断而不冒充复核已纠正。模型自报置信度并不可靠，仍需人工盲评。
- 健康状态按模式+型号+渠道分别维护；连续3次业务失败或至少20个5分钟样本中失败率>5%会熔断60秒，再仅放一个半开探测。获胜后取消的请求不计失败。状态是每Pod内存，重启会重置；长期报表通过日志/OTel汇总，不宣称500条验收样本存于此滚动窗口。
- 临时熔断可能拒绝所有渠道，以明确失败结束；精准模式既有Qwen回退仍适用。三家共用实际上游时不具备独立容灾，不能保证100%。

## 回滚与上线

仅关闭成本切流：`cost_routing_enabled: false`。停止影子：`a6_shadow_percent: 0`。关闭复核：`uncertain_review_enabled: false`。若需恢复旧10秒对冲，可把hedge_min_seconds和hedge_max_seconds均设10，并把third_hedge_seconds设12。

Apollo由用户发布；配置由启动时读取，按项目后端发布流程部署并重启/rollout后生效。无需数据库迁移、小程序构建或UI变更。未部署的新本地代码不会改善现有真机延迟。首版先收集真实分段数据，后续优化后处理与prompt需要重新验证质量。
