# Go 后端 API 路由清单

> 来源：`backend/internal/app/app.go`（Go 后端，非旧 Python `ROUTE_MAP.md`）。  
> 统计约 **170+** 条 HTTP 路由 + 1 条 WebSocket。

## 日志覆盖说明

| 层级 | 实现 | 覆盖范围 |
| --- | --- | --- |
| HTTP 访问 | `logger.RequestLogger()` | 全部路由：method、path、status、duration、`trace_id` |
| API 错误 | `response.Error()` | 全部经统一响应的错误：AppError / 参数 / 500 |
| 业务埋点 | handler / service / worker | **分析、任务、LLM、Worker** 为重点；普通 CRUD 读接口通常仅 HTTP 层 |

排查食物识别问题时，优先用响应头 **`X-Trace-Id`** 或 JSON 日志里的 **`trace_id`** + **`analysis.task_id`** 串联链路。

---

## 模块索引

| 模块 | 前缀 / 路径 | 路由数（约） | 业务日志 |
| --- | --- | ---: | --- |
| 系统 | `/api`, `/api/health`, 静态页 | 6 | 无 |
| 登录 | `/api/login` | 1 | 无 |
| 用户 | `/api/user/*` | 22 | 部分（注销等） |
| 首页 | `/api/home/*` | 2 | 无 |
| **食物分析** | `/api/analyze*`, `/api/precision-sessions/*` | 16 | **完整** |
| **饮食记录** | `/api/food-record/*`, `/api/upload-analyze-image*` | 14 | 错误层 |
| 包装食品 | `/api/packaged-food/*` | 4 | Worker |
| 营养库 | `/api/food-nutrition/*` | 2 | analyze 内嵌 |
| 社区 | `/api/community/*` | 18 | 无 |
| 好友 / 关注 / 私信 | `/api/friend/*`, follow, messages | 22 | 无 |
| 健康 / 统计 | `/api/body-metrics/*`, `/api/stats/*`, `/api/exercise-*` | 16 | **运动 LLM** |
| 会员 / 支付 | `/api/membership/*`, `/api/payment/*` | 7 | 部分 |
| 公共食物库 | `/api/public-food-library/*` | 16 | Worker 审核 |
| 菜谱 | `/api/recipes/*` | 7 | 无 |
| 保质期 | `/api/expiry/*` | 8 | **识别 LLM** |
| 工具 | `/api/location/*`, `/api/qrcode`, manual-food, schools | 12 | 无 |
| 宠物 | `/api/pet/*` | 4 | 无 |
| 反馈 | `/api/feedback/*` | 2 | 有 |
| Admin | `/api/admin/*` | 若干 | 部分 |
| TestBackend | `/api/test-backend/*`, `/api/prompts/*` | 若干 | 内部 |
| WebSocket | `/ws/stats/insight` | 1 | stats |

---

## 食物分析 API（排查重点）

| Method | Path | Handler | 业务日志要点 |
| --- | --- | --- | --- |
| POST | `/api/analyze/submit` | SubmitAnalyzeTask | 提交参数、task_id |
| POST | `/api/analyze-text/submit` | SubmitTextTask | 同上 |
| POST | `/api/analyze/batch` | AnalyzeBatch | 同步 batch + 建 task |
| POST | `/api/analyze` | Analyze | 同步识别（analyze_service 全链路） |
| POST | `/api/analyze-text` | AnalyzeText | 同步文字识别 |
| GET | `/api/analyze/tasks/:task_id` | GetTask | failed/timed_out 时打 error_message |
| POST | `/api/analyze/tasks/retry` | RetryTask | 重试 |
| PATCH | `/api/analyze/tasks/:task_id/result` | UpdateTaskResult | 用户改结果 |
| POST | `/api/precision-sessions/:session_id/continue` | ContinuePrecisionSession | 精准模式续跑 |

异步任务处理在 **embedded worker**（`internal/worker`），不在 HTTP 请求线程内。

---

## 完整路由（按注册顺序）

<details>
<summary>展开查看 app.go 中全部 engine 注册</summary>

### 系统 & 登录
- `POST /api/login`
- `GET /api`, `/api/health`, `/map-picker`, `/test-backend`, `/test-backend/login`, `/snack-admin`
- `GET /ws/stats/insight`

### 用户 & 反馈
- `GET/PUT /api/user/profile`, `POST bind-phone`, `upload-avatar`, `upload-cover`
- `GET/PUT /api/user/dashboard-targets`, `health-profile`, `health-focuses`
- `POST health-profile/ocr`, `ocr-extract`, `submit-report-extraction-task`, `upload-report-image`
- `GET record-days`, `POST last-seen-analyze-history`, `acknowledge-health-disclaimer`
- `DELETE /api/user/account`, `GET /api/user/:user_id/public-profile`
- `POST /api/feedback`, `/api/feedback/upload-image`

### 首页 & 分析 & 饮食
- `GET /api/home/dashboard`, `/api/food-record/:record_id/poster-calorie-compare`
- 分析 16 条（见上表）
- 饮食记录、上传、营养搜索、包装食品、critical-samples

### 社交
- follow / messages / friend / community（含 feed-targets）

### 健康 & 会员 & 其他
- body-metrics, stats, exercise-logs, diet/recommendations
- membership, pet, public-food-library, recipes, expiry
- location, qrcode, manual-food, schools, test-backend, admin

</details>

---

## 相关文档

- 食物分析日志点位与排查步骤：[food-analysis-logging.md](./food-analysis-logging.md)
- OTel / Jaeger / 指标：[observability-metrics.md](./observability-metrics.md)
- 旧 Python 路由对照（可能过时）：[backend-api-prd/ROUTE_MAP.md](./backend-api-prd/ROUTE_MAP.md)
