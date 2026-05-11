# 后端 worker 与 task_queue 配置说明

本文说明 `backend/config.yaml` 里的 `worker` 与 `task_queue`，以及当前 Go 后端的任务可靠性设计。

## 当前架构

分析类任务不是在 HTTP 请求里同步跑模型：

1. 接口先创建 `analysis_tasks`，状态为 `pending`。
2. 创建成功后发布 `{task_id, task_type}` 到 `task_queue`。
3. worker 收到队列消息后，按 `task_id` claim 这一条任务。
4. claim 成功时写入 `status=processing`、`worker_id`、`attempt_id`、`attempt_count`、`processing_started_at`、`lease_until`。
5. worker 执行业务逻辑，成功或失败后先把 DB 写成 `done` 或 `failed`。
6. DB 终态写入成功后，队列消息才会 ack；Kafka 模式下就是这时才 commit offset。

`analysis_tasks` 仍然是前端轮询状态、结果和错误信息的持久化来源，但不再靠“扫描所有 pending”来分发新任务。

## 数据库字段

可靠消费依赖 `analysis_tasks` 的以下字段：

- `worker_id`：当前领取任务的 worker 标识。
- `attempt_id`：本次处理 attempt 的唯一 ID。
- `attempt_count`：任务被领取处理的次数。
- `processing_started_at`：当前 attempt 开始时间。
- `lease_until`：当前 attempt 的租约过期时间。

部署到新环境或旧库升级时，需要运行后端 migration：

```bash
go run ./cmd/migration -config-dir .
```

## worker 配置

```yaml
worker:
  count: 1
  poll_interval_seconds: 2
```

### count

`count` 控制 server 进程内 worker loop 的数量。

- `count: 0`：不启动 worker，异步分析任务会停在 `pending`。
- `count: 1`：本地和当前单实例服务的推荐值。
- `count > 1`：同一 server 进程内启动多个消费者。Kafka 模式下会创建多个同 group consumer，由 Kafka 按 partition 分配；并发越高，模型 API 成本和限流风险也越高。

`worker.count` 必须写在 `config.yaml` 里，不能用 `WORKER_ENABLED` 之类环境变量控制。

### poll_interval_seconds

它是 worker 定时 tick 的间隔，主要用于：

- 检查并发送到期的 `food_expiry_notification_jobs`。
- 输出空闲日志。
- 触发过期提醒 job 的 stale recovery。

它不是前端轮询 `/api/analyze/tasks/:task_id` 的间隔，也不是普通分析任务的队列延迟。普通分析任务靠 `task_queue` 投递，消息到达后立即处理。

## worker 支持的任务类型

任务类型不再放在 `config.yaml` 里配置。worker 支持哪些任务由代码里的 `worker.SupportedTaskTypes()` 固定维护；新增、删除或禁用某类任务应改代码和测试，而不是改部署配置。

| task_type | 含义 |
| --- | --- |
| `food` | 普通图片食物分析任务。 |
| `food_text` | 普通文字食物分析任务。 |
| `precision_plan` | 精准模式规划任务，负责拆分子任务。 |
| `precision_item_estimate` | 精准模式单项估算任务。 |
| `precision_aggregate` | 精准模式汇总任务。 |
| `public_food_library_text` | 公共食物库发布前的文本审核任务。 |
| `exercise` | 运动热量异步估算任务。 |
| `health_report` | 健康报告 OCR/结构化提取任务。 |
| `expiry_recognize` | 保质期拍照识别异步任务类型。 |
| `expiry_notification` | 保质期订阅通知发送开关；它不是 `analysis_tasks` 队列消息，而是让 worker 定时检查 `food_expiry_notification_jobs`。 |

## task_queue 配置

```yaml
task_queue:
  driver: "memory"
  buffer_size: 1024
  topic: "food-link-analysis-tasks"
  brokers: []
  consumer_group: "food-link-workers"
```

### driver

- `memory`：进程内 channel，本地开发默认使用。它不持久化，但 worker 会定时从 DB 找 `pending` 和 lease 过期的 `processing` 任务重新发布到内存队列，避免 server 重启后老任务永远沉没。
- `kafka`：真实 Kafka 队列。需要配置 `brokers`、`topic`、`consumer_group`。worker 使用 `FetchMessage` 读取，任务写入 `done/failed` 后才 `CommitMessages`。

### buffer_size

只对 `memory` 生效，是进程内 channel 容量。必须大于 `0`。

### topic

Kafka topic 名称。建议稳定使用：

```yaml
topic: "food-link-analysis-tasks"
```

### brokers

Kafka broker 地址。`memory` 模式可以为空；`kafka` 模式必须非空。

```yaml
brokers:
  - "kafka-1:9092"
  - "kafka-2:9092"
```

### consumer_group

Kafka consumer group。多个 server/worker 使用同一个 group 时，同一个 topic partition 只会分配给 group 内一个 consumer。不同 group 会各自收到一份消息。

## Kafka 处理过程

Kafka 模式下单条消息的处理流程是：

1. Kafka reader `FetchMessage` 取到消息，但不自动提交 offset。
2. worker 根据 `task_id` 锁定 DB 记录。
3. 如果任务是 `pending`，或者 `processing` 但 `lease_until` 已过期，则生成新的 `attempt_id` 并开始处理。
4. 如果任务已经是 `done/failed/cancelled/timed_out/violated`，说明这是重复投递，直接 commit offset。
5. 如果任务仍处于未过期的 `processing`，说明另一个 attempt 正在处理，当前重复消息会被确认；如果原 attempt 后续挂掉，DB recovery 会在 lease 过期后重新发布任务。
6. 当前 attempt 完成后，只允许 `WHERE id=? AND attempt_id=? AND status='processing'` 的更新写入 `done/failed`。
7. DB 终态写入成功后才 commit offset。

这个设计保证：

- 任务不会因为 worker 进程挂掉而永久停在 `processing`。
- Kafka 消息未 commit 时，consumer group rebalance 后可以重新投递。
- 即使重复投递，旧 attempt 也不能覆盖新 attempt 的结果。
- server 内部 worker goroutine panic 会被恢复并重新订阅；整个 server 进程挂掉时，仍依赖 systemd/Docker/K8s 等进程管理器拉起服务。

严格意义上的“外部副作用 exactly once”无法只靠 Kafka 和 DB 保证。例如模型调用完成后、写 DB 前进程崩溃，恢复后可能会再次调用模型。但 DB 终态写入是 attempt 幂等的，用户侧不会看到旧 attempt 覆盖新结果。

## 推荐配置

本地开发：

```yaml
worker:
  count: 1
  poll_interval_seconds: 2

task_queue:
  driver: "memory"
  buffer_size: 1024
  topic: "food-link-analysis-tasks"
  brokers: []
  consumer_group: "food-link-workers"
```

Kafka 环境：

```yaml
worker:
  count: 2
  poll_interval_seconds: 2

task_queue:
  driver: "kafka"
  buffer_size: 1024
  topic: "food-link-analysis-tasks"
  brokers:
    - "kafka-1:9092"
    - "kafka-2:9092"
  consumer_group: "food-link-workers"
```

## 本地 Kafka 快速启动

仓库里提供了一个单节点 Kafka 配置，只用于本地开发验证：

```powershell
docker compose -f backend/docker-compose.kafka.yml up -d
```

首次启动后可以显式创建 topic。当前 compose 已启用自动创建 topic，所以这一步不是必须的，但手动创建能更早暴露 broker 连接问题：

```powershell
docker exec food-link-kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server 127.0.0.1:9092 --create --if-not-exists --topic food-link-analysis-tasks --partitions 3 --replication-factor 1
```

本地 `backend/config.yaml` 可以临时改成：

```yaml
worker:
  count: 1
  poll_interval_seconds: 2

task_queue:
  driver: "kafka"
  buffer_size: 1024
  topic: "food-link-analysis-tasks"
  brokers:
    - "127.0.0.1:9092"
  consumer_group: "food-link-local-workers"
```

然后按项目本地流程重启 Go server。现在独立 worker 入口已经删除，server 启动后会按 `worker.count` 启动内嵌 worker。

验证 Kafka 是否可用：

```powershell
docker exec food-link-kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server 127.0.0.1:9092 --list
```

不用时关闭本地 Kafka：

```powershell
docker compose -f backend/docker-compose.kafka.yml down
```

## 排查要点

如果前端一直轮询 200 但没有结果，优先看：

1. `worker.count` 是否大于 `0`。
2. server 日志里是否有 `embedded worker enabled`。
3. submit 后是否有 `analysis task enqueued`。
4. worker 侧是否有 `task queue delivery received`、`task claimed`、`task processed` 或 `task failed`。
5. DB 里该任务的 `status`、`worker_id`、`attempt_id`、`attempt_count`、`lease_until`。
6. Jaeger 里是否能看到 submit 后续串到 queue delivery、claim、process、LLM、complete/fail。

普通 zap 日志不会自动出现在 Jaeger；需要在 Jaeger 里看的关键节点应写入 OpenTelemetry span event / attribute / error。
