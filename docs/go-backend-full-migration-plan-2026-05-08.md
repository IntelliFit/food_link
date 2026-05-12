# Go 后端一次性完整迁移计划书

Date: `2026-05-08`

Current branch: `backend-refactor-sync-migrate-tencent`

Baseline:

- Current Go branch: `434d019`
- Python main/dev baseline: `fcc6b61`
- Gap report: `docs/go-backend-main-gap-analysis-2026-05-08.md`

## 目标

把当前 Go 后端补齐到可以完整替代原 Python 后端，做到：

1. 小程序主业务链路不再依赖 Python 后端。
2. Python 主分支已有且小程序使用的接口，在 Go 中都有真实实现，不再走 stub。
3. 分析任务、会员支付、积分额度、公共食物库、菜谱、保质期识别、统计洞察、测试后台等核心能力行为等价。
4. Go 后端具备可部署、可回归、可排障、可回滚的上线条件。

## 当前进度判断

按路由数量看，当前 Go 后端约完成 `75%-80%`。

按可替代 Python 线上行为看，当前约 `55%-65%`。

剩余部分不是普通 CRUD 为主，而是主链路硬逻辑：

- route stub
- worker runtime
- db_first 营养库匹配
- 会员支付和积分治理
- 小程序码
- stats insight
- 保质期识别和订阅提醒
- 测试后台批处理
- 运维脚本和 migration runner

## 总排期

推荐排期：`15-20` 个工作日。

如果只做到小程序核心链路能替换 Python，预计 `7-10` 个高强度工作日。

如果包含完整 E2E、灰度、回滚预案和线上验证，建议预留 `20-25` 个工作日。

## 执行原则

- 保持一个集中迁移分支推进，避免多分支反复合并。
- 每个业务域作为独立 checkpoint 完成、验证、记录，不做无检查的大爆炸提交。
- 旧 Python 行为以 `main@fcc6b61` 为事实基线；Go 实现需要逐路由对齐请求、响应、鉴权、数据库读写和错误语义。
- 先补会直接 501 或影响主链路闭环的能力，再补测试后台和运维增强。
- 新增 Go 代码继续遵守当前 DDD 分层：`domain -> repo -> service -> handler`。
- 数据库访问继续统一走 `GORM + PostgreSQL`，不要重新引入 Supabase SDK 作为运行时主数据源。

## Phase 0：迁移准备与冻结基线

预计：`0.5-1` 天

任务：

- 确认 Python 基线 commit：`fcc6b61`。
- 确认当前 Go 基线 commit：`434d019`。
- 冻结接口清单：以 `backend/docs/backend-api-prd/ROUTE_MAP.md` 和 gap report 为准。
- 建立迁移任务看板，按本文 Phase 拆 issue / todo。
- 清理或确认本地临时产物，例如 `backend/food-link.exe` 不纳入迁移提交。

验收：

- 计划、gap report、任务列表三者一致。
- 明确哪些脚本继续保留 Python，哪些迁成 Go CLI。

## Phase 1：补齐仍为 stub 的小程序路由

预计：`2-3` 天

范围：

- `POST /api/precision-sessions/{session_id}/continue`
- `/api/public-food-library*` 共 12 个路由
- `/api/recipes*` 共 7 个路由

任务：

- 新增/补齐 Go module：
  - `internal/publicfood`
  - `internal/recipe`
  - 精准模式 continue 补在 `internal/analyze` 或独立 precision service
- 对齐 Python 行为：
  - 列表筛选、排序、分页
  - 详情、创建、我的上传
  - 点赞、收藏、评论、反馈
  - 菜谱 CRUD 和 use 行为
  - precision session round 继续逻辑
- 删除这些路由对 stub fallback 的依赖。

验收：

- 20 个路由不再返回 `501 已注册但尚未迁移`。
- 每个 handler 有单元测试。
- 与 Python 响应字段基本兼容，小程序现有 `src/utils/api.ts` 不需要大改。

## Phase 2：恢复异步 worker runtime

预计：`3-4` 天

Status update `2026-05-08`:

- 已完成第一版 Go worker runtime。
- 已恢复真实 `cmd/worker`，不再是旧的空壳 worker。
- 已实现 pending task 原子领取、处理、成功/失败写回、并发配置、轮询配置。
- 已覆盖首批任务类型：`food`、`food_text`、`precision_plan`、`public_food_library_text`、`exercise`。
- `go build ./cmd/worker` 与 `go build ./cmd/server` 通过。

Remaining:

- 精准模式还需继续恢复 Python 的 planner / item estimate / aggregate 多阶段并行模型。
- 健康报告 OCR、保质期识别、通知调度仍未接入 worker。

范围：

- `analysis_tasks` 消费闭环
- food image / food text / precision / expiry recognition / exercise task 等任务类型

任务：

- 重新设计 Go worker，而不是恢复空壳 `cmd/worker`。
- 建议新增：
  - `backend/cmd/worker/main.go`
  - `internal/worker`
  - 各业务 task processor
- 支持：
  - pending -> processing -> done / failed / timed_out / cancelled
  - 并发控制
  - 超时回收
  - 任务 payload 兼容旧字段
  - 失败 reason 写回
  - worker 日志和 trace
- 明确部署方式：
  - 单独 worker 镜像入口，或同镜像不同 command
  - Dockerfile 重新支持 server / worker 构建或运行时 command 区分

验收：

- `/api/analyze/submit` 创建任务后可被 Go worker 消费并写回结果。
- `/api/analyze-text/submit` 可闭环。
- precision task 可生成下一轮状态或最终结果。
- expiry recognition task 可至少进入可验证的处理链路。

## Phase 3：迁移 db_first 营养库算法

预计：`3-4` 天

Status update `2026-05-08`:

- 已完成第一版 Go `db_first` 后处理链路。
- 结果会查 `food_nutrition_aliases` / `food_nutrition_library`，命中后按估重回算营养。
- 未命中项写入 `food_unresolved_logs` 并返回 unresolved 元数据。
- `/api/analyze-compare-engines` 不再只是两个 tag，现在能体现库命中与未命中的差异。

Remaining:

- 继续迁移 unknown food 的 DeepSeek per-100g fallback 和自动补库。
- 将 db_first prompt 进一步收敛为只输出食物名、重量、描述和建议，减少无用营养 token。

范围：

- 图片分析结果后处理
- 文字分析结构化解析
- 标准营养库匹配
- aliases 召回
- unknown food fallback
- unresolved logs

任务：

- 在 Go 中实现 nutrition matching service：
  - `food_nutrition_library`
  - `food_nutrition_aliases`
  - `food_unresolved_logs`
- 对齐 Python 的 `db_first` 策略：
  - LLM 只负责识别食物和估重
  - 营养值优先从标准库按重量回算
  - 未匹配食物才 fallback
  - 记录 unresolved，便于后续补词典
- 修复当前 Go 中 `AnalyzeCompareEngines` 只打 tag 的临时实现。

验收：

- `legacy_direct` 和 `db_first` 产生真实差异。
- `resolved_count / unresolved_count` 真实可信。
- 手动记录和分析结果使用同一套标准食物库口径。

## Phase 4：会员、支付、积分和权益治理

预计：`3-4` 天

范围：

- `/api/membership/plans`
- `/api/membership/me`
- `/api/membership/pay/create`
- `/api/payment/wechat/notify/membership`
- `/api/membership/rewards/share-poster/claim`
- 分析额度校验

任务：

- 将 Go `MembershipService.CreatePayment` 从 mock 改为真实微信支付：
  - prepay 下单
  - RSA 签名
  - notify_url
  - 商户号、serial、appid、API v3 key 配置
- 将 notify 改为真实验签/解密/幂等处理。
- 迁移会员 reconciliation：
  - 真实 paid order 优先
  - 手动升级白名单
  - stale pending 处理
  - 过期会员修复
- 迁移积分系统：
  - system credits
  - earned credits
  - 每日刷新
  - 消耗顺序
  - invite/share reward
  - `ValidateQuota` 不再是 stub

验收：

- 支付参数不再出现 `mock_*`。
- notify 可用真实微信回调样例验证。
- 会员状态与主分支 Python 对同一用户返回一致。
- 分析任务提交会正确扣额度或拒绝。

## Phase 5：补齐外部能力与体验链路

预计：`2-3` 天

范围：

- `/api/qrcode`
- `/api/stats/insight/generate`
- `/api/stats/insight/save`
- `/ws/stats/insight`
- `/api/expiry/recognize`
- `/api/expiry/items/{item_id}/subscribe`
- 健康档案 OCR 细节

任务：

- 小程序码调用微信 `getwxacodeunlimit`，不再返回 mock PNG。
- stats insight 恢复 AI 生成、缓存和 fingerprint 判断。
- WebSocket insight 若仍需要保留，则迁成真实流式或明确降级为 HTTP。
- 保质期识别接入 worker / OCR / LLM 预填。
- 订阅提醒写入 notification jobs，并支持微信订阅消息发送约束。

验收：

- 小程序码可被微信识别。
- stats insight 不是固定模板文案。
- expiry recognize 能产出待确认食品列表。
- subscribe 不只是返回成功，而有可追踪的提醒 job。

## Phase 6：测试后台与运维脚本

预计：`2-3` 天

范围：

- `test_backend` 批处理
- legacy test API
- 静态测试后台资源
- 运维脚本
- SQL migration runner

任务：

- 补齐测试后台 batch prepare/start/status 的真实处理。
- 决定静态测试后台是否继续由 Go server 托管。
- 迁移或保留以下脚本，并写明运行方式：
  - `reconcile_membership_truth.py`
  - `wechat_pay_show_cert_serial.py`
  - `enrich_top_missing_foods.py`
  - `import_usda_fooddata.py`
  - `translate_usda_aliases.py`
  - `apply_exercise_migration.py`
- 将归档 SQL 整理成可执行 migration：
  - 顺序
  - 幂等
  - 已执行记录

验收：

- 测试后台核心批处理可用。
- 运维脚本不再“丢失在主分支 Python 里”。
- 新环境可按文档初始化数据库。

## Phase 7：全量回归与上线准备

预计：`2-4` 天

任务：

- Go 单元测试：
  - `go test ./...`
- Go build：
  - `go build ./cmd/server`
  - worker 若恢复，也要 `go build ./cmd/worker`
- 接口回归：
  - 登录
  - 首页 dashboard
  - 图片分析 submit -> worker -> result
  - 文字分析 submit -> worker -> result
  - 手动记录 / 标准库搜索
  - 公共食物库
  - 菜谱
  - 圈子 feed / 评论 / 点赞
  - 会员状态 / 支付下单 / notify
  - 保质期
  - stats summary / insight
- 数据库真实环境冒烟：
  - 腾讯云 PostgreSQL
  - COS/CDN 图片访问
  - 微信接口配置
- 部署准备：
  - Docker build
  - CCR push
  - worker 部署
  - 环境变量 / ConfigMap 清单
- 回滚预案：
  - 保留 Python 后端镜像或旧服务入口
  - 支付和积分回滚策略
  - worker 重复消费/幂等保护

验收：

- 所有 miniapp-used API 不返回 stub。
- 核心链路能在真实数据库完成。
- 支付、积分、worker 有幂等保护。
- 有明确上线和回滚步骤。

## 每日推进节奏

建议每天固定产出：

- 当天完成的路由/模块清单
- 新增测试清单
- 与 Python 不一致但主动接受的差异
- 未解决阻塞
- 第二天的 checkpoint

状态同步位置：

- `CURRENT_TASK.md`
- `DECISIONS.md`
- `memory/YYYY-MM-DD.md`
- 必要时更新本计划书

## 风险清单

### 高风险

- Worker 任务消费和 Python 行为不一致，导致分析结果不回写或重复扣积分。
- 微信支付 notify 验签/解密/幂等不完整，导致会员不到账或重复到账。
- db_first 算法没对齐，导致营养值大面积漂移。
- SQL migration 没有顺序或幂等保护，导致线上库不可逆损坏。

### 中风险

- 公共食物库、菜谱字段不兼容，前端出现空字段或渲染异常。
- 图片 URL 从 Supabase 历史路径迁到 COS/CDN 时兼容不完整。
- 测试后台迁移不完整，影响后续模型评测。

### 低风险

- 非核心运维脚本晚一点迁移，只要明确保留路径和手动流程即可。
- WebSocket stats insight 可降级为 HTTP，只要前端没有强依赖流式。

## 建议第一批提交范围

第一批不要碰支付和 worker，先解决确定的硬缺口：

1. `internal/publicfood`
2. `internal/recipe`
3. precision continue route
4. 删除这些路由的 stub fallback
5. 单元测试和 route coverage 测试

这样第一批结束后，Go 后端至少不会在小程序公共食物库和菜谱页面直接 501。
