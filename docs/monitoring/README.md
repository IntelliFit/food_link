# FoodLink 算法监测候选

2026-10-17准备，未导入线上、未修改共享采集器或通知设置。算法审计见 [全链路报告](../recognition-algorithm-audit-2026-10-17.md)。

## 文件与启用顺序

- `recognition-algorithm-dashboard.json`：Grafana导入文件，导入时选择现有Prometheus数据源。使用本次只读实查的 `otel_` 指标前缀和 `exported_job` 环境标签。
- `recognition-algorithm-alerts.yml`：Prometheus告警规则候选；只加载规则不会自行建立通知送达。阈值需要依据实际流量校准。
- 先发布对应后端埋点，再确认Prometheus出现 `otel_food_link_algorithm_gates_total` 和 `otel_food_link_algorithm_result_items_total`，最后导入/启用候选。生产发布、共享配置变更需要对应授权。

## 验收口径

1. 分别选main/dev验证现有指标、时间窗口和采样延迟；无数据保持无数据，不转成零问题。
2. 用固定样例产生一次成功纠错和一次无变化/歧义拒绝，沿任务ID核对trace、最终状态和摘要，再核对对应门禁序列增量。指标自身不使用任务ID或菜名标签。
3. 精准分项以 `task_type` 区分单项、规划、汇总；一次用户餐可能产生多个内部任务。不能把所有任务数当餐数，也不能把模型重试次数当提交次数。
4. 通用LLM封装指标不含balanced主图片调用；视觉渠道面板单独覆盖该路径。旧hedge可能同时记两套指标，禁止简单相加推导模型总调用量。
5. 新摘要在本attempt终态写入后发出；失败且无已落库结果时，实际变化数为0。条目变化数是身份/名称/重量/营养快照差异，仍不能证明语义纠错全部正确。
6. 告警应用前用 `promtool check rules` 检查目标版本兼容性，并用固定样例验证触发、恢复、环境和通知去向。禁止为测试触发对真实用户批量制造失败。

## 尚未覆盖的观测

- Collector当前logs仅输出debug，未建立长期可检索业务日志库；本配置没有补齐日志存储、保留期、访问控制或脱敏回放。
- 仍需每任务提示词/Schema/生效配置指纹、完整性拒绝原因、退款待补偿与恢复任务年龄等观测。现有trace/span不能被描述为每条业务约束都有独立指标。
- 运行成功、JSON合法、营养门禁通过、库命中都不是准确率；准确率需有身份、称重和营养真值的数据集。

本轮的本地结构/PromQL检查回执位于 `D:/cache/agent-tests/beef-correction-20261017/monitoring-validation.json`。新增序列的真实增量、Grafana渲染与告警送达须在获准启用后验收。
