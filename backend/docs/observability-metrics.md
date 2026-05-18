# OTel 指标清单

后端指标统一走 OpenTelemetry，不再由业务服务直接暴露 Prometheus `/metrics`。

链路：

```text
food_link Go backend
  ├─ traces  -> OTLP gRPC -> OpenTelemetry Collector -> Jaeger
  └─ metrics -> OTLP gRPC -> OpenTelemetry Collector -> Prometheus exporter /metrics
                                                -> Prometheus scrape -> Grafana
```

## 后端配置

后端只需要能访问 OTel Collector 的 OTLP gRPC 端口，通常是 `4317`：

```yaml
app:
  # OTel service.name，用于 Grafana 区分 main 部署。
  name: "food_link-backend-main"
  # 运行模式。服务器上的 main/dev 都应该使用 production。
  env: "production"

otel:
  enabled: true
  traces_enabled: true
  metrics_enabled: true
  collector_endpoint: "127.0.0.1:4317"
  insecure: true
  metric_export_interval_seconds: 15
```

服务器 dev 部署示例：

```yaml
app:
  # OTel service.name，用于 Grafana 区分 dev 部署。
  name: "food_link-backend-dev"
  # 服务器 dev 仍然使用 production 运行模式。
  env: "production"

otel:
  enabled: true
  traces_enabled: true
  metrics_enabled: true
  collector_endpoint: "127.0.0.1:4317"
  insecure: true
  metric_export_interval_seconds: 15
```

`otel.enabled=false` 时 trace 和 metric 都不会导出，业务埋点调用保持 no-op，不影响本地测试。

Resource 映射固定为：
- `app.name` -> `service.name`，建议服务器上用 `food_link-backend-main` / `food_link-backend-dev` 区分部署。
- `app.env` -> `deployment.environment`，这是运行模式，通常只有 `production` / `development`。
- 系统 hostname -> `host.name` 和 `service.instance.id`

后端不再提供实例名覆盖配置；实例维度只从系统 hostname 自动读取。

## Collector 要点

Prometheus 应该 scrape OTel Collector，而不是 scrape 业务服务。Collector 侧需要至少包含：

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

processors:
  batch:
  transform/prom_labels:
    metric_statements:
      - context: datapoint
        statements:
          - set(attributes["env"], resource.attributes["deployment.environment"])
          - set(attributes["service_name"], resource.attributes["service.name"])
          - set(attributes["instance"], resource.attributes["host.name"])

exporters:
  prometheus:
    endpoint: 0.0.0.0:9464
    resource_to_telemetry_conversion:
      enabled: true

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [transform/prom_labels, batch]
      exporters: [prometheus]
```

如果现有 Collector 已经把 resource attributes 转成 Prometheus labels，只需要确认最终指标上能看到 `service_name=food_link-backend-main/dev`、`env=production/development` 或同等标签。

Prometheus scrape Collector：

```yaml
scrape_configs:
  - job_name: otel_collector
    static_configs:
      - targets: ["127.0.0.1:9464"]
```

## 标签约束

指标标签刻意不包含 `user_id`、`task_id`、图片 URL、prompt 原文、SQL 原文等高基数或隐私数据。

环境和实例维度通过 OTel resource 统一提供：

| Resource attribute | 推荐 Prometheus label | 备注 |
| --- | --- | --- |
| `service.name` | `service_name` | 来自 `app.name`。建议用 `food_link-backend-main` / `food_link-backend-dev` 区分部署。 |
| `deployment.environment` | `env` | 来自 `app.env`，表示运行模式，服务器 dev/main 通常都是 `production`。 |
| `host.name` | `instance` | 实例名。由系统 hostname 自动提供，不提供配置覆盖。 |

## HTTP 服务

| Prometheus 指标 | OTel instrument | 类型 | 关键标签 | 备注 |
| --- | --- | --- | --- | --- |
| `food_link_http_requests_total` | `food_link_http_requests` | counter | `method`,`route`,`status` | HTTP 请求总数；`route` 使用 Gin 路由模板，未知路由为 `unmatched`。 |
| `food_link_http_request_duration_seconds` | 同名 | histogram | `method`,`route`,`status` | HTTP 请求耗时。 |
| `food_link_http_request_size_bytes` | 同名 | histogram | `method`,`route` | 请求体大小，依赖 `Content-Length`。 |
| `food_link_http_response_size_bytes` | 同名 | histogram | `method`,`route`,`status` | 响应体大小，依赖 Gin writer 统计。 |
| `food_link_http_in_flight_requests` | 同名 | gauge | `method` | 当前正在处理的 HTTP 请求数。 |

PromQL：

```promql
histogram_quantile(0.95, sum(rate(food_link_http_request_duration_seconds_bucket{service_name=~"$service_name"}[5m])) by (le, route))
sum(rate(food_link_http_requests_total{service_name=~"$service_name",status=~"5.."}[5m])) by (route)
```

## 数据库

| Prometheus 指标 | OTel instrument | 类型 | 关键标签 | 备注 |
| --- | --- | --- | --- | --- |
| `food_link_db_up` | 同名 | gauge | `database` | Collector collection 时对 `sql.DB` 做 500ms ping，1 表示成功。 |
| `food_link_db_open_connections` | 同名 | gauge | `database` | 当前打开连接数。 |
| `food_link_db_in_use_connections` | 同名 | gauge | `database` | 当前使用中的连接数。 |
| `food_link_db_idle_connections` | 同名 | gauge | `database` | 当前空闲连接数。 |
| `food_link_db_max_open_connections` | 同名 | gauge | `database` | 当前最大连接数配置。 |
| `food_link_db_wait_count_total` | `food_link_db_wait_count` | counter | `database` | 等待 DB 连接的累计次数。 |
| `food_link_db_wait_duration_seconds_total` | `food_link_db_wait_duration_seconds` | counter | `database` | 等待 DB 连接的累计耗时。 |
| `food_link_db_ping_total` | `food_link_db_ping` | counter | `driver`,`status` | 后端启动/显式健康检查里执行 DB ping 的次数。 |
| `food_link_db_ping_duration_seconds` | 同名 | histogram | `driver`,`status` | 后端启动/显式健康检查里执行 DB ping 的耗时。 |
| `food_link_db_operations_total` | `food_link_db_operations` | counter | `operation`,`table`,`status` | GORM 操作总数；`status` 为 `success`、`not_found` 或 `error`。 |
| `food_link_db_operation_duration_seconds` | 同名 | histogram | `operation`,`table`,`status` | GORM 操作耗时，不暴露 SQL 原文。 |

PromQL：

```promql
food_link_db_up{service_name=~"$service_name"}
histogram_quantile(0.95, sum(rate(food_link_db_operation_duration_seconds_bucket{service_name=~"$service_name"}[5m])) by (le, table, operation))
sum(rate(food_link_db_operations_total{service_name=~"$service_name",status="error"}[5m])) by (table, operation)
```

## 任务队列和 Worker

| Prometheus 指标 | OTel instrument | 类型 | 关键标签 | 备注 |
| --- | --- | --- | --- | --- |
| `food_link_task_queue_info` | 同名 | gauge | `driver`,`topic`,`consumer_group` | 当前队列配置，值恒为 1。 |
| `food_link_task_queue_component_up` | 同名 | gauge | `driver`,`component` | 队列发布/消费组件最后一次观测状态。 |
| `food_link_task_queue_publish_total` | `food_link_task_queue_publish` | counter | `driver`,`task_type`,`status` | 发布任务到 memory/Kafka 的次数。 |
| `food_link_task_queue_publish_duration_seconds` | 同名 | histogram | `driver`,`task_type`,`status` | 任务发布耗时。 |
| `food_link_task_queue_deliveries_total` | `food_link_task_queue_deliveries` | counter | `driver`,`task_type` | worker 收到的队列消息数。 |
| `food_link_task_queue_delivery_age_seconds` | 同名 | histogram | `driver`,`task_type` | 消息从创建到被 worker 收到的延迟。 |
| `food_link_task_queue_settled_total` | `food_link_task_queue_settled` | counter | `driver`,`task_type`,`outcome` | ack/nack/skip/decode_error 等结果。 |
| `food_link_task_queue_depth` | 同名 | gauge | `driver`,`queue` | 仅 memory 队列有实时深度；Kafka backlog 建议接 Kafka exporter。 |
| `food_link_worker_configured` | 同名 | gauge | `queue_driver` | 配置的 embedded worker 并发数。 |
| `food_link_worker_loops_active` | 同名 | gauge | `queue_driver` | 当前运行中的 worker 消费循环数。 |
| `food_link_worker_task_claims_total` | `food_link_worker_task_claims` | counter | `task_type`,`outcome` | DB attempt lease claim 结果。 |
| `food_link_worker_tasks_active` | 同名 | gauge | `task_type` | 当前处理中任务数。 |
| `food_link_worker_task_duration_seconds` | 同名 | histogram | `task_type`,`status` | worker 任务端到端处理耗时。 |
| `food_link_worker_lease_heartbeats_total` | `food_link_worker_lease_heartbeats` | counter | `task_type`,`status` | lease 续租成功、失败或丢失次数。 |
| `food_link_worker_recovered_tasks_total` | `food_link_worker_recovered_tasks` | counter | `task_type`,`status` | recovery loop 候选、发布成功、发布失败数量。 |

PromQL：

```promql
histogram_quantile(0.95, sum(rate(food_link_task_queue_delivery_age_seconds_bucket{service_name=~"$service_name"}[5m])) by (le, task_type))
sum(rate(food_link_worker_task_duration_seconds_count{service_name=~"$service_name",status="failed"}[5m])) by (task_type)
sum(rate(food_link_worker_recovered_tasks_total{service_name=~"$service_name",status="published"}[5m])) by (task_type)
```

## 外部 AI/LLM

| Prometheus 指标 | OTel instrument | 类型 | 关键标签 | 备注 |
| --- | --- | --- | --- | --- |
| `food_link_llm_calls_total` | `food_link_llm_calls` | counter | `stage`,`provider`,`model`,`status` | Doubao/Gemini/DeepSeek 等调用次数。 |
| `food_link_llm_call_duration_seconds` | 同名 | histogram | `stage`,`provider`,`model`,`status` | 外部 LLM 调用耗时。 |
| `food_link_llm_retries_total` | `food_link_llm_retries` | counter | `stage`,`provider`,`model`,`reason` | 同一任务内 JSON 解析或临时错误重试次数。 |

PromQL：

```promql
histogram_quantile(0.95, sum(rate(food_link_llm_call_duration_seconds_bucket{service_name=~"$service_name"}[5m])) by (le, provider, model, stage))
sum(rate(food_link_llm_calls_total{service_name=~"$service_name",status!="success"}[5m])) by (provider, model, stage, status)
```

## 业务指标

| Prometheus 指标 | OTel instrument | 类型 | 关键标签 | 备注 |
| --- | --- | --- | --- | --- |
| `food_link_food_analysis_total` | `food_link_food_analysis` | counter | `source`,`provider`,`model`,`status` | 食物识别尝试次数；`source` 包含 `image`、`text`。 |
| `food_link_food_analysis_duration_seconds` | 同名 | histogram | `source`,`provider`,`model`,`status` | 食物识别业务总耗时。 |
| `food_link_food_analysis_items` | 同名 | histogram | `source`,`provider`,`model` | 单次识别返回的食物 item 数量。 |
| `food_link_nutrition_resolve_items_total` | `food_link_nutrition_resolve_items` | counter | `engine`,`status` | DB-first 营养库命中、未命中、Gemini 生成和落库结果。 |
| `food_link_nutrition_resolve_duration_seconds` | 同名 | histogram | `engine`,`status` | 营养库回填/解析总耗时。 |
| `food_link_exercise_analysis_total` | `food_link_exercise_analysis` | counter | `stage`,`source`,`status` | 运动分析业务尝试次数。 |
| `food_link_exercise_analysis_duration_seconds` | 同名 | histogram | `stage`,`source`,`status` | 运动分析耗时；`stage=llm` 或 `task`。 |

PromQL：

```promql
histogram_quantile(0.95, sum(rate(food_link_food_analysis_duration_seconds_bucket{service_name=~"$service_name"}[10m])) by (le, source, provider, model))
sum(rate(food_link_nutrition_resolve_items_total{service_name=~"$service_name",status="resolved"}[10m]))
/
sum(rate(food_link_nutrition_resolve_items_total{service_name=~"$service_name",status=~"resolved|unresolved"}[10m]))
histogram_quantile(0.95, sum(rate(food_link_exercise_analysis_duration_seconds_bucket{service_name=~"$service_name"}[10m])) by (le, stage, source))
```

## Go 运行时指标

启用 `otel.metrics_enabled=true` 后，后端也会通过 OTel runtime instrumentation 导出 Go 运行时指标，例如：

- `go_memory_used`
- `go_memory_allocated`
- `go_goroutine_count`
- `go_processor_limit`
- `go_config_gogc`

实际 Prometheus 名称取决于 Collector 的 Prometheus exporter 命名转换。

## Grafana 面板建议

建议使用一个 dashboard，通过 `service_name` 变量切换部署：

- `service_name`: `label_values(food_link_http_requests_total, service_name)`
- `route`: `label_values(food_link_http_requests_total{service_name=~"$service_name"}, route)`
- `task_type`: `label_values(food_link_worker_task_duration_seconds_count{service_name=~"$service_name"}, task_type)`
- `provider`: `label_values(food_link_llm_calls_total{service_name=~"$service_name"}, provider)`

面板分组：

- HTTP 总览：RPS、5xx rate、p95/p99 latency、慢接口排行。
- DB 总览：`db_up`、连接池 in-use/open、等待连接速率、慢表/慢操作 p95。
- Kafka/队列：publish error rate、delivery age p95、ack/nack 比例、recovery published 数。
- Worker：active tasks、claim outcome、任务处理耗时、failed task rate、lease lost。
- 食物分析：image/text 分析耗时、LLM provider 错误率、解析重试次数、识别 item 数、营养库命中率。
- 运动分析：LLM 调用耗时、task 总耗时、失败状态分布。
