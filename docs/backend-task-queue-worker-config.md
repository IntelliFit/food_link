# 后端 worker 与 task_queue 配置说明

本文说明 `backend/config.yaml` 中 `worker` 和 `task_queue` 的含义，以及它们在当前 Go 后端里的真实行为。

## 当前架构

当前分析任务不是在 HTTP 请求里同步跑模型。

1. 接口创建 `analysis_tasks` 记录，状态为 `pending`。
2. 创建成功后，服务端发布 `{task_id, task_type}` 到 `task_queue`。
3. server 进程内嵌 worker 从 `task_queue` 收到消息后，按 `task_id` claim 这条任务，把状态从 `pending` 改为 `processing`。
4. worker 调用模型、营养库、OCR 或其它业务逻辑。
5. worker 把任务写回 `done` / `failed`，前端继续通过 `/api/analyze/tasks/:task_id` 轮询读取状态和结果。

`analysis_tasks` 仍然是任务状态、结果、错误信息和前端轮询的持久化表，但不再作为“靠扫描 pending 任务来分发工作”的 DB 队列。

## worker 配置

示例：

```yaml
worker:
  count: 1
  poll_interval_seconds: 2
  task_types:
    - "food"
    - "food_text"
    - "precision_plan"
    - "precision_item_estimate"
    - "precision_aggregate"
    - "public_food_library_text"
    - "exercise"
    - "health_report"
    - "expiry_recognize"
    - "expiry_notification"
```

### count

`count` 控制 server 内嵌 worker loop 的数量。

- `count: 0`：不启动 worker。此时异步分析任务会停在 `pending`，前端会一直轮询不到结果。
- `count: 1`：默认推荐值，本地和当前单实例服务足够。
- `count > 1`：同一 server 进程里启动多个并发消费者，可以提高吞吐，但会增加模型 API 并发、成本和限流风险。

当前代码要求 `config.yaml` 必须显式配置 `worker.count`；缺失会启动报错。不要再用 `WORKER_ENABLED` 这类环境变量控制 worker。

### poll_interval_seconds

`poll_interval_seconds` 是 worker loop 的定时 tick 间隔，当前主要影响两件事：

- 如果 `task_types` 包含 `expiry_notification`，每个 tick 会尝试处理一条到期的 `food_expiry_notification_jobs` 通知 job。
- worker 空闲日志按 tick 计数输出，目前每 30 个 tick 打一次 `worker idle`。

它不是前端轮询 `/api/analyze/tasks/:task_id` 的间隔，也不是普通分析任务从 `task_queue` 收消息的等待时间。当前 `task_queue.driver=memory` 时，普通分析任务通过进程内 channel 直接投递，消息到达后 worker 会立即处理。

建议本地和线上先保持 `2` 秒。调小它通常不会让食物识别更快，只会让保质期通知检查更频繁、日志更密。

### task_types

`task_types` 是这个 worker 愿意消费和处理的任务类型白名单。

它同时影响：

- `task_queue` 订阅过滤：不在列表里的队列消息会被跳过。
- DB claim 条件：worker 收到消息后，只会 claim `task_type` 在白名单里的 pending task。
- 具体处理分支：worker 根据 `task_type` 进入不同业务处理函数。

不要随意删任务类型。删掉某个类型后，对应任务可能一直停在 `pending`，或者队列消息被跳过。

当前各类型含义：

| task_type | 含义 |
| --- | --- |
| `food` | 普通图片食物分析任务。通常来自 `/api/analyze/submit` 的标准模式。 |
| `food_text` | 普通文字食物分析任务。通常来自 `/api/analyze-text/submit` 的标准模式。 |
| `precision_plan` | 精准模式规划任务，负责拆分子任务和决定后续估算步骤。 |
| `precision_item_estimate` | 精准模式单个食物/单个子项估算任务。 |
| `precision_aggregate` | 精准模式汇总任务，把多个子项结果聚合成最终结果。 |
| `public_food_library_text` | 公共食物库发布前的文本审核任务。 |
| `exercise` | 运动热量异步估算任务，完成后写入运动记录。 |
| `health_report` | 健康报告 OCR/结构化提取任务。 |
| `expiry_recognize` | 保质期拍照识别的异步任务处理分支；当前 `/api/expiry/recognize` 仍是同步识别并写完成任务，保留该类型用于兼容或后续异步化。 |
| `expiry_notification` | 保质期订阅通知发送开关。它不是 `analysis_tasks` 队列消息，而是让 worker 定时扫描并发送 `food_expiry_notification_jobs`。 |

## task_queue 配置

示例：

```yaml
task_queue:
  driver: "memory"
  buffer_size: 1024
  topic: "food-link-analysis-tasks"
  brokers: []
  consumer_group: "food-link-workers"
```

### driver

当前真正支持的是 `memory`。

- `memory`：进程内队列，适合当前 server 内嵌 worker。HTTP submit 和 worker 必须在同一个 server 进程里，消息才能被消费。
- `kafka`：配置和接口已预留，但 adapter 尚未实现；如果设置为 `kafka`，会启动失败，不会静默退回 DB 扫描。

`memory` 队列不持久化。server 重启时，内存中的未消费消息会丢失；已写入 DB 的旧 `pending` task 也不会自动 replay。后续要做生产级可靠性、多副本或独立消费者，应在 `internal/taskqueue` 后面接 Kafka、NATS、Redis Stream 等真实 broker，并设计 pending task replay / 死信 / 重试策略。

### buffer_size

`buffer_size` 是 `memory` 队列 channel 的容量。

- 必须大于 `0`，否则配置加载会报错。
- 队列满时，发布任务会阻塞，直到发布上下文超时或有 worker 消费。
- 当前发布任务通常使用 2 秒超时；如果队列长期满，提交接口会失败，而不是让任务无声卡住。

本地默认 `1024` 足够。它只是进程内内存容量，不代表持久化 backlog。

### topic

`topic` 是未来真实消息队列的主题名，当前 `memory` driver 不使用它。

保留它是为了以后接 Kafka/NATS/Redis Stream 时，不需要改配置结构。建议保持稳定值，例如 `food-link-analysis-tasks`。

### brokers

`brokers` 是未来真实消息队列的 broker 地址列表，当前 `memory` driver 不使用它。

`memory` 模式下可以为空数组：

```yaml
brokers: []
```

以后 Kafka 示例可能类似：

```yaml
brokers:
  - "kafka-1:9092"
  - "kafka-2:9092"
```

### consumer_group

`consumer_group` 是未来真实 broker 的消费者组名，当前 `memory` driver 不使用它。

如果以后接 Kafka，这个值会决定多个 worker 实例是否属于同一个消费组。同组消费者会分摊同一个 topic 的消息；不同组会各自收到一份消息。

## 推荐配置

本地开发：

```yaml
worker:
  count: 1
  poll_interval_seconds: 2
  task_types:
    - "food"
    - "food_text"
    - "precision_plan"
    - "precision_item_estimate"
    - "precision_aggregate"
    - "public_food_library_text"
    - "exercise"
    - "health_report"
    - "expiry_recognize"
    - "expiry_notification"

task_queue:
  driver: "memory"
  buffer_size: 1024
  topic: "food-link-analysis-tasks"
  brokers: []
  consumer_group: "food-link-workers"
```

临时只启动 API、不处理后台任务：

```yaml
worker:
  count: 0
```

这种模式下不要测试拍照分析、文字分析、运动异步估算、健康报告 OCR 这类依赖 worker 的功能；它们会创建任务但不会出结果。

## 排查要点

如果前端一直轮询 200 但没有结果，优先看：

1. `worker.count` 是否大于 `0`。
2. server 启动日志里是否有 `embedded worker enabled`。
3. `task_types` 是否包含对应任务类型，例如食物拍照必须包含 `food`。
4. submit 后是否有 `analysis task enqueued`，worker 侧是否有 `task queue delivery received` / `task claimed`。
5. Jaeger 中是否能看到 submit span 后续串到 queue delivery、claim、process、LLM、complete/fail。

普通 zap 日志不会自动出现在 Jaeger。需要在 Jaeger 里看的关键节点，应写入 OpenTelemetry span event / attribute / error；普通日志则用 `trace_id`、`span_id` 做关联。
