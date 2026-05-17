# Go 后端上线前万无一失清单

日期：2026-05-08
分支：`backend-refactor-sync-migrate-tencent`
目标版本：Go 后端 `v2` 镜像，替代原 Python 后端核心能力
上线原则：任何 P0/P1 项未完成或结果不确定，都不发布生产流量。

## 0. 使用方式

- 每一项必须填写：`负责人 / 执行时间 / 结果 / 证据链接或截图 / 备注`。
- `P0` 是上线阻断项，未完成不得上线。
- `P1` 是强建议项，如未完成必须明确风险接受人。
- `P2` 是上线后 24-72 小时内继续收口项。
- 所有敏感配置只核对“存在、格式、来源、指向环境”，不要写入文档或仓库。

## 1. Go/No-Go 总门槛

| 优先级 | 检查项 | 通过标准 | 状态 |
|---|---|---|---|
| P0 | 当前发布 commit 确认 | 生产镜像来源 commit 与预期分支/commit 完全一致 | TODO |
| P0 | Server 能启动 | Go server 在生产同类环境启动成功，无 fatal/panic | TODO |
| P0 | Worker 能启动 | `worker.count > 0` 时 server 内嵌 worker 能随 server 启动；`task_queue.driver=memory` 下分析任务由同一 server 进程内 worker 消费 | TODO |
| P0 | 数据库 schema 完整 | 所有 Go 代码依赖表/字段/索引在生产库存在 | TODO |
| P0 | 核心小程序链路闭环 | 登录、分析、记录、会员、支付、统计、保质期主链路通过 smoke test | TODO |
| P0 | 支付回调可用 | 微信支付创建订单、签名、回调验签解密、会员激活闭环通过 | TODO |
| P0 | 回滚路径可执行 | 能在 10 分钟内切回上一稳定后端镜像或旧 Python 服务 | TODO |
| P1 | 线上监控可观测 | 日志、错误率、任务堆积、支付失败、外部 API 错误可观察 | TODO |
| P1 | 全量路由对账 | `miniapp-used` 路由无 501/stub，剩余 stub 均为明确非上线阻断 | TODO |
| P1 | 测试体系收口 | 目标包测试、server build、脚本语法检查通过 | TODO |

## 2. 代码与构建冻结

| 优先级 | 检查项 | 命令/动作 | 通过标准 | 状态 |
|---|---|---|---|---|
| P0 | 工作区干净 | `git status --short --branch` | 除允许的本地二进制外无未提交改动 | TODO |
| P0 | 分支最新 | `git fetch origin` 后核对 `HEAD` | 本地与远端目标分支一致 | TODO |
| P0 | 提交号记录 | `git rev-parse --short HEAD` | 记录发布 commit | TODO |
| P0 | server 编译 | `go build -o %TEMP%\food-link-server-prelaunch.exe ./cmd/server` | 成功 | TODO |
| P0 | 后台消费者编译 | `go build -o %TEMP%\food-link-server-prelaunch.exe ./cmd/server` | 成功；内嵌 worker 随 server 编译 | TODO |
| P1 | Docker 构建 | `npm run push-docker-ccr` 或先本地 `docker buildx build` | 镜像构建平台为 `linux/amd64`，含 server/static；worker 为 server 内嵌能力 | TODO |
| P1 | 静态页语法 | `node --check backend/static/test_backend/app.js` | 成功 | TODO |
| P1 | Python 运维脚本语法 | `python -m py_compile backend/scripts/*.py` | 成功，无遗留 `__pycache__` | TODO |

## 3. 数据库与数据一致性

| 优先级 | 检查项 | 重点表/字段 | 通过标准 | 状态 |
|---|---|---|---|---|
| P0 | 数据库连接 | `POSTGRESQL_*` / DSN 来源 | Go server 及其内嵌 worker 均连同一个生产 PostgreSQL | TODO |
| P0 | `analysis_tasks` schema | `task_type/status/payload/result/error_message` | DB 存任务状态/结果；队列消息携带 `task_id/task_type`；worker 按 task id claim/complete/fail 正常 | TODO |
| P0 | 精准模式 schema | `precision_sessions`、`precision_session_rounds`、`precision_item_estimates` | plan/item/aggregate 写入正常 | TODO |
| P0 | 食物营养库 schema | `food_nutrition_library`、`food_nutrition_aliases`、`food_unresolved_logs` | db_first 命中/未命中/DeepSeek fallback 可写 | TODO |
| P0 | 会员生产 schema | `membership_plan_config`、`user_pro_memberships`、`pro_membership_payment_records` | plans/me/pay/notify 全链路正常 | TODO |
| P0 | 积分 schema | `user_credit_bonus_events`、`user_earned_credit_ledger`、`weapp_user.earned_credits_balance` | 校验和扣 earned credits 正常 | TODO |
| P0 | 运动 schema | `user_exercise_logs.ai_reasoning`、`user_weight_records` | 估算结果和 reasoning 可落库 | TODO |
| P0 | 统计洞察 schema | `ai_stats_insights` | generate/save/summary 指纹缓存正常 | TODO |
| P0 | 保质期通知 schema | `food_expiry_notification_jobs` | subscribe 创建 job，worker claim/send/update 正常 | TODO |
| P1 | 测试后台 schema | `test_prompts`、`test_prompt_history`、`test_batches`、`test_datasets` | 后台页面 CRUD/batch 可用 | TODO |
| P1 | 订单 reconciliation | 最新 paid order 与 `user_pro_memberships` 对齐 | 手动白名单不被误覆盖，普通用户以 paid order 为准 | TODO |
| P1 | Supabase 源数据状态 | 旧 Supabase 是否仍有新数据 | 若有，先执行迁移/同步，不让 Go 生产读旧源 | TODO |

## 4. 生产配置核对

| 优先级 | 配置域 | 必查项 | 通过标准 | 状态 |
|---|---|---|---|---|
| P0 | 数据库 | `POSTGRESQL_HOST/PORT/USER/PASSWORD/DATABASE` | 指向腾讯云 PostgreSQL 生产库，server 与内嵌 worker 一致 | TODO |
| P0 | 对象存储 | COS bucket、region、secret、CDN base URL | 上传/读取图片成功，旧 Supabase URL 可兼容解析 | TODO |
| P0 | JWT/登录 | JWT secret、微信 appid/secret | 登录、token 校验、openid 绑定正常 | TODO |
| P0 | 微信支付 | mchid、appid、serial、private key、API v3 key、notify URL | 下单和回调验签解密通过 | TODO |
| P0 | 小程序码 | stable token appid/secret、env_version、page | `/api/qrcode` 返回真实 PNG | TODO |
| P0 | LLM/OCR | Doubao、OfoxAI、DeepSeek key/base/model | 食物、精准、健康报告、stats insight fallback 策略可用 | TODO |
| P0 | 订阅消息 | 保质期模板 ID、access token 获取 | 发送模板字段合法，失败重试可见 | TODO |
| P1 | Worker | `config.yaml` 的 `worker.count`、`worker.poll_interval_seconds` | worker 支持的任务类型由代码固定启用，不再通过配置裁剪；`worker.count=0` 表示关闭内嵌 worker | TODO |
| P1 | Task queue | `config.yaml` 的 `task_queue.driver`、`task_queue.buffer_size`、`topic/brokers/consumer_group` | 当前支持进程内 `memory` 与 Kafka；Kafka 模式在 DB 写入 `done/failed` 后才 commit offset | TODO |
| P1 | 测试后台 | `TEST_BACKEND_PASSWORD` | 生产后台登录密码非默认值 | TODO |
| P1 | 环境来源 | K8s/服务器 ConfigMap/env | 敏感配置由运行时注入，不进入镜像 | TODO |

## 5. 后端自动化验证

| 优先级 | 验证项 | 命令 | 通过标准 | 状态 |
|---|---|---|---|---|
| P0 | 主链路目标测试 | `go test ./internal/worker ./internal/app ./internal/expiry/handler ./internal/health/service ./internal/health/handler ./internal/membership/domain ./internal/membership/handler ./internal/membership/service ./internal/analyze/handler ./internal/analyze/domain ./internal/testbackend/handler ./internal/testbackend/domain` | 全部通过 | TODO |
| P0 | server build | `go build -o %TEMP%\food-link-server-prelaunch.exe ./cmd/server` | 成功 | TODO |
| P0 | 内嵌 worker build | `go build -o %TEMP%\food-link-server-prelaunch.exe ./cmd/server` | 成功 | TODO |
| P1 | publicfood/recipe | `go test ./internal/publicfood/... ./internal/recipe/...` | 全部通过 | TODO |
| P1 | qrcode service | `go test ./internal/utility/service -run TestQRCodeService` | 通过 | TODO |
| P1 | 测试后台 handler | `go test ./internal/testbackend/handler ./internal/testbackend/domain` | 通过 | TODO |
| P1 | 静态页语法 | `node --check backend/static/test_backend/app.js` | 通过 | TODO |
| P1 | 脚本语法 | `python -m py_compile backend/scripts/*.py` | 通过 | TODO |
| P2 | 全量 Go 测试 | `go test ./...` | 当前若因 `CGO_ENABLED=0` + sqlite 阻塞，必须记录阻塞并单独处理 | TODO |

## 6. 真实环境 Smoke Test

| 优先级 | 用户链路 | 操作 | 通过标准 | 状态 |
|---|---|---|---|---|
| P0 | 登录 | 微信小程序登录/刷新 profile | 返回用户资料、openid、会员状态，无 401 循环 | TODO |
| P0 | 图片分析标准模式 | 上传一张普通餐食图 | task created，worker done，结果页展示，保存记录成功 | TODO |
| P0 | 文字分析标准模式 | 输入一段饮食描述 | db_first 营养计算正常，保存记录成功 | TODO |
| P0 | 精准模式 | 创建 session，继续补充信息 | planner -> item estimate -> aggregate 闭环，final result 可展示 | TODO |
| P0 | 食物记录 | 保存/查询/删除记录 | dashboard 和历史记录同步更新 | TODO |
| P0 | 会员页 | 获取 plans/me | 套餐、试用、早鸟/创始 meta、积分显示正确 | TODO |
| P0 | 会员支付 | 创建 JSAPI 订单，沙箱或小额真实支付 | 支付参数可调起，回调激活会员 | TODO |
| P0 | 积分扣减 | 用有 earned credits 的账号分析 | 成功后扣 earned credits；失败请求不扣 | TODO |
| P0 | 运动估算 | 提交多项运动文本 | task done，calories/reasoning 落库，统计可见 | TODO |
| P0 | 保质期识别 | 上传包装/食物图识别 | 返回预填 items，积分扣减正确 | TODO |
| P0 | 保质期订阅 | 新增 active 条目并同意订阅 | `food_expiry_notification_jobs` 创建，worker 可发送或可重试 | TODO |
| P0 | 统计页 | 打开 summary，手动生成 insight | 缓存指纹、generate、save、websocket 均正常 | TODO |
| P0 | 小程序码 | 调用 `/api/qrcode` | 返回真实小程序码 PNG，扫码可进入目标页 | TODO |
| P1 | 公共食物库 | 列表/详情/点赞/收藏/评论/上传 | 前端无 501，数据库写入正常 | TODO |
| P1 | 菜谱 | 增删改查/use | 前端无 501，结果符合旧 Python 行为 | TODO |
| P1 | 测试后台 | 登录、prompt 管理、单图分析、ZIP batch | 页面可用，无 400/500 契约错位 | TODO |

## 7. Worker 专项验收

| 优先级 | 检查项 | 通过标准 | 状态 |
|---|---|---|---|
| P0 | worker 部署 | 生产路径为 server 内嵌 worker；当前不再提供独立 `/app/food-link-worker` 入口 | TODO |
| P0 | 任务领取 | submit 发布 `task_id/task_type` 到 `task_queue` 后，pending task 能被同进程 worker claim 为 processing/done/failed | TODO |
| P0 | 并发安全 | 重复队列消息不会重复处理；DB claim 按 task id 且要求 `status=pending`；本地 memory queue 避免共享 DB 时被其它开发者 worker 消费 | TODO |
| P0 | 失败可见 | failed task 有 `error_message`，不会无限 silent retry | TODO |
| P0 | 精准模式聚合 | item 子任务未完成前 aggregate 不提前结束 | TODO |
| P0 | 通知 job | `expiry_notification` job claim/update/retry 正常 | TODO |
| P1 | 队列堆积监控 | pending/processing 数量可查，异常堆积有告警或人工检查脚本 | TODO |
| P1 | worker 停机恢复 | `memory` queue 不持久化；历史 pending/processing 恢复需要后续 broker driver 或显式 replay 设计 | TODO |

## 8. 前端与小程序上线配套

| 优先级 | 检查项 | 通过标准 | 状态 |
|---|---|---|---|
| P0 | API 域名 | 体验版/正式版请求 `https://healthymax.cn`，不是本机 `127.0.0.1` | TODO |
| P0 | 小程序 request 合法域名 | 微信后台域名配置覆盖生产 API/CDN | TODO |
| P0 | 支付目录/回调 | 微信支付平台配置与 notify URL 一致 | TODO |
| P0 | 体验版全链路 | 使用生产 API 的体验版跑一遍 smoke test | TODO |
| P1 | 清缓存验证 | 「我的」->「清除缓存」后数据重新拉取正常 | TODO |
| P1 | 版本号 | 发布版本号与 `package.json` / 我的页展示一致 | TODO |
| P1 | 微信开发者工具验证 | 若涉及前端变更，必须用 `weapp-devtools` 截图/交互；本清单文档变更无需执行 | TODO |

## 9. 观测、告警与排障

| 优先级 | 检查项 | 通过标准 | 状态 |
|---|---|---|---|
| P0 | server 日志 | 每个请求错误有可读日志和 trace/context | TODO |
| P0 | worker 日志 | queue publish、task claim/start/done/fail 有日志 | TODO |
| P0 | 支付日志 | 下单、notify、验签、金额校验、激活结果可追踪 | TODO |
| P0 | 外部 API 错误 | LLM/OCR/微信/COS 错误不 panic，返回用户可读错误或 fallback | TODO |
| P1 | 指标面板 | 请求 5xx、P95、worker pending、支付失败率可查看 | TODO |
| P1 | 数据库慢查询 | 高频接口无明显慢查询或全表扫描 | TODO |
| P1 | 审计查询 | 能按 user_id/task_id/order_no 快速定位问题 | TODO |

## 10. 安全与权限

| 优先级 | 检查项 | 通过标准 | 状态 |
|---|---|---|---|
| P0 | 测试后台保护 | `/test-backend` 和 `/api/test-backend/*` 必须 cookie 鉴权 | TODO |
| P0 | 管理/清理接口 | admin key 或内部访问限制正确 | TODO |
| P0 | 支付回调幂等 | 重复 notify 不重复发权益/积分 | TODO |
| P0 | 用户隔离 | food record、membership、expiry、stats 只能读写本人数据 | TODO |
| P1 | 敏感日志 | 不打印密钥、支付私钥、数据库密码、完整 access token | TODO |
| P1 | CORS/Host | 生产对外策略符合预期，无多余调试入口暴露 | TODO |

## 11. 部署执行清单

| 顺序 | 优先级 | 动作 | 命令/证据 | 状态 |
|---|---|---|---|---|
| 1 | P0 | 冻结发布 commit | 记录 `git rev-parse HEAD` | TODO |
| 2 | P0 | 确认生产配置 | 核对 ConfigMap/env，不泄露值 | TODO |
| 3 | P0 | 构建并推送镜像 | `npm run push-docker-ccr` | TODO |
| 4 | P0 | 等自动更新或手动滚动 | 确认 server 新 Pod/进程 commit/镜像 | TODO |
| 5 | P0 | 确认内嵌 worker | 确认 server 使用同镜像同 commit，且 `worker.count > 0` 时内嵌 worker 已启动 | TODO |
| 6 | P0 | 健康检查 | `/health` 或等价接口正常 | TODO |
| 7 | P0 | 跑 P0 smoke test | 第 6 节 P0 全部通过 | TODO |
| 8 | P0 | 观察 30-60 分钟 | 5xx、worker 堆积、支付失败、外部 API 错误无异常 | TODO |
| 9 | P1 | 发布体验版/正式版配套 | 小程序端指向生产 API | TODO |
| 10 | P1 | 记录上线结论 | commit、镜像、时间、验证人、异常项 | TODO |

## 12. 回滚预案

| 优先级 | 回滚项 | 操作 | 通过标准 | 状态 |
|---|---|---|---|---|
| P0 | 镜像回滚 | 将 server deployment 切回上一稳定镜像 | 10 分钟内恢复核心接口 | TODO |
| P0 | worker 回滚 | 将 `worker.count` 临时调为 `0` 或回滚 server 镜像 | 不继续处理错误任务 | TODO |
| P0 | 任务保护 | 对可疑 processing/pending task 做人工标记或暂停 worker | 避免重复扣积分/重复写记录 | TODO |
| P0 | 支付保护 | 若 notify 异常，临时关闭创建新订单或切回旧服务 | 不产生无法激活的 paid order | TODO |
| P0 | 数据库备份 | 上线前确认最近备份与恢复方式 | 可恢复关键表 | TODO |
| P1 | 用户告知 | 若出现用户可感知异常，准备客服/群公告口径 | 用户知道如何重试或联系客服 | TODO |

## 13. 上线后 24 小时巡检

| 时间窗 | 检查项 | 通过标准 | 状态 |
|---|---|---|---|
| T+15min | server 5xx / panic | 无异常尖峰 | TODO |
| T+15min | worker pending/failed | 无持续堆积，失败原因可解释 | TODO |
| T+30min | 登录/分析/记录抽检 | 新用户和老用户均正常 | TODO |
| T+30min | 支付订单 | paid/order/membership 状态一致 | TODO |
| T+1h | 外部 API 调用 | LLM/OCR/微信/COS 错误率正常 | TODO |
| T+3h | 积分账本 | earned credits 扣减和系统积分统计无异常 | TODO |
| T+12h | 保质期通知 job | 待发送/已发送/失败比例正常 | TODO |
| T+24h | 数据一致性复盘 | 无严重 drift；记录问题清单和修复负责人 | TODO |

## 14. 当前已知非阻断但必须跟踪

| 优先级 | 问题 | 当前状态 | 后续动作 |
|---|---|---|---|
| P1 | `CGO_ENABLED=0` 导致 sqlite/go-sqlite3 测试不可全量运行 | 已知环境阻塞 | 决定开启 CGO 或切换纯 Go sqlite 测试 driver |
| P1 | 测试后台 batch 当前是同步处理 | 可用但大批量可能慢 | 如要高强度 benchmark，改为 goroutine/队列异步 |
| P1 | route-map fallback 仍存在 | 用于非已迁移接口兜底 | 上线前再导出剩余 stub 清单，确认无 `miniapp-used` 阻断项 |
| P2 | 精准模式 planner prompt 可继续贴近 Python | 当前链路已闭环 | 后续按真实样本调优 prompt |
| P2 | stats insight prompt 可继续细化 | 当前已有缓存/LLM/fallback | 上线后根据用户反馈优化文案和指标 |

## 15. 最终签字

| 角色 | 姓名 | 结论 | 时间 |
|---|---|---|---|
| 技术负责人 |  | GO / NO-GO |  |
| 后端验证 |  | GO / NO-GO |  |
| 小程序验证 |  | GO / NO-GO |  |
| 运维/部署 |  | GO / NO-GO |  |
| 业务确认 |  | GO / NO-GO |  |

最终结论：

- [ ] GO：允许发布 Go 后端 `v2`
- [ ] NO-GO：暂缓发布，原因：
