# Go 后端与主分支 Python 后端迁移缺口对账

Date: `2026-05-08`

Compared branches:

- Current: `backend-refactor-sync-migrate-tencent` at `434d019`
- Main/dev baseline: `main` and `dev` both at `fcc6b61`

## 结论

当前 Go 后端并不是“全部迁完”。它已经把主分支 Python 后端的大部分 API surface 注册进来了，但仍有两类缺口：

1. **硬缺口**：20 个主分支已有、且小程序使用的路由当前只通过 `ROUTE_MAP.md` 兜底注册，实际返回 `501 已注册但尚未迁移`。
2. **逻辑缩水缺口**：不少路由虽然有 Go handler，但实现仍是 mock / stub / simplified 版本，和主分支 Python 的真实业务逻辑不等价。

## 硬缺口：仍由 stub handler 兜底的路由

Update `2026-05-08`: Phase 1 已补齐这些路由的 Go handler 并注册到 `internal/app/app.go`。静态 route-map 对账已从 `stub_from_route_map=20` 降到 `0`。下面清单保留为本次缺口来源记录。

这些路由在主分支 Python 中存在，在当前 Go 分支也通过 route map 暴露，但不是手写 Go handler；请求会进入 `backend/internal/stub/handler.go`。

| Method | Path | Python handler |
| --- | --- | --- |
| `POST` | `/api/precision-sessions/{session_id}/continue` | `continue_precision_session` |
| `GET` | `/api/public-food-library` | `api_list_public_food_library` |
| `POST` | `/api/public-food-library` | `api_create_public_food_library` |
| `GET` | `/api/public-food-library/mine` | `api_my_public_food_library` |
| `GET` | `/api/public-food-library/collections` | `api_public_food_library_collections` |
| `GET` | `/api/public-food-library/{item_id}` | `api_get_public_food_library_item` |
| `POST` | `/api/public-food-library/{item_id}/like` | `api_public_food_library_like` |
| `DELETE` | `/api/public-food-library/{item_id}/like` | `api_public_food_library_unlike` |
| `POST` | `/api/public-food-library/{item_id}/collect` | `api_public_food_library_collect` |
| `DELETE` | `/api/public-food-library/{item_id}/collect` | `api_public_food_library_uncollect` |
| `GET` | `/api/public-food-library/{item_id}/comments` | `api_public_food_library_comments` |
| `POST` | `/api/public-food-library/{item_id}/comments` | `api_public_food_library_comment_post` |
| `POST` | `/api/public-food-library/feedback` | `api_public_food_library_feedback` |
| `POST` | `/api/recipes` | `create_recipe` |
| `GET` | `/api/recipes` | `list_recipes` |
| `GET` | `/api/recipes/count` | `get_recipes_count` |
| `GET` | `/api/recipes/{recipe_id}` | `get_recipe` |
| `PUT` | `/api/recipes/{recipe_id}` | `update_recipe` |
| `DELETE` | `/api/recipes/{recipe_id}` | `delete_recipe` |
| `POST` | `/api/recipes/{recipe_id}/use` | `use_recipe` |

## 也还是占位的非普通 HTTP 能力

- `GET /ws/stats/insight` 当前是 `websocketStub()`，建立连接后直接返回 `code=10004` 和 `websocket route registered but not migrated yet`。

## 已有 handler 但明显未等价迁移的核心功能

### 1. 异步分析 worker 缺失

Update `2026-05-08`: 已新增真实 Go worker 第一版：

- `backend/cmd/worker/main.go`
- `backend/internal/worker/worker.go`
- `analysis_tasks` 支持原子领取 `pending -> processing`，并写回 `done / failed`。
- 首批接入 `food`、`food_text`、`precision_plan`、`public_food_library_text`、`exercise`。
- `backend/Dockerfile` 已同时构建 `/app/food-link` 和 `/app/food-link-worker`，部署时可用同镜像不同 command 启动 worker。

剩余缺口：精准模式仍是直接估计版，尚未完全恢复 Python 的 planner -> item estimate -> aggregate 并行子任务；健康报告 OCR、保质期识别、订阅通知调度仍待后续 Phase 补齐。

当前 Go 的 `SubmitAnalyzeTask` / `SubmitTextTask` / 精准模式 submit 只会创建 `analysis_tasks` 且状态为 `pending`。此前占位 `cmd/worker` 已删除，当前 Go 分支没有等价的 worker runtime 来消费这些任务并写回结果。

影响范围：

- `/api/analyze/submit`
- `/api/analyze-text/submit`
- `/api/precision-sessions/*`
- `/api/expiry/recognize`
- 旧 Python `worker.py` 中的食物分析、文字分析、精准模式、OCR / 保质期识别、运动估算等异步链路

### 2. db_first 食物营养库匹配没有真正迁过来

Update `2026-05-08`: 已补入 Go 版 `db_first` 第一版：

- `AnalyzeService` 可注入 `FoodNutritionRepo`。
- 识别结果会按食物名查询 `food_nutrition_aliases` 和 `food_nutrition_library`。
- 命中后按 `estimatedWeightGrams / 100` 重算 calories/protein/carbs/fat/fiber/sugar/sodium。
- 未命中项写入 `food_unresolved_logs`，并在结果中标记 `is_unresolved / resolve_status / nutrition_source`。
- `AnalyzeCompareEngines` 现在能展示真实 `legacy_direct` 与 `db_first` 差异。

剩余缺口：尚未迁移 Python 的 DeepSeek unknown-food per-100g fallback 自动补库，也还没把 prompt 完全收口成“LLM 只识别名称和重量”的轻量 schema。

Go `AnalyzeCompareEngines` 注释明确写着迁移阶段两套 engine 使用同一次 LLM 调用，只是打不同 tag；`resolved_count` 直接等于 items 数量，`unresolved_count` 固定为 0。

这缺少主分支 Python 里的关键能力：

- `food_nutrition_library` / `food_nutrition_aliases` 匹配
- unknown food fallback
- unresolved logs
- 按标准库回算营养
- `legacy_direct` 和 `db_first` 的真实差异

### 3. 会员支付仍是 mock

Go `CreatePayment` 返回：

- `mock_prepay_*`
- `wx_mock_appid`
- `mock_nonce_str`
- `mock_pay_sign`

Go `WechatNotify` 也不是主分支 Python 的微信支付回调验签 / 解密 / 商户订单处理链路，而是按 `payment_id` 查库后直接置为 paid。

同时，当前 Go 分支有 `pkg/wechatpay` 基础工具，但没有完整接入 membership service。

### 4. 会员积分 / 额度 / 权益治理未完整迁移

`ValidateQuota` 当前还是 stub，直接返回 nil。主分支已形成的系统积分、earned credits、每日刷新、邀请奖励、会员订单 reconciliation、手动升级白名单等治理逻辑没有在 Go 中等价闭环。

### 5. 小程序码接口仍是假的 base64 PNG

`/api/qrcode` 的 Go service 只返回 8 字节 PNG 头拼出来的 mock base64，没有调用微信 `getwxacodeunlimit`。

### 6. 统计洞察生成缩水

`/api/stats/insight/generate` 当前用 `stubGenerateInsight()` 拼一段静态统计文案，不是主分支 Python 的真实 AI insight 生成；`needsRefresh` 也简化为固定 true，没有按 fingerprint 判断。

### 7. 保质期识别和订阅提醒未闭环

`/api/expiry/recognize` 当前只创建任务；没有等价 OCR / LLM 识别 worker。`/api/expiry/items/{item_id}/subscribe` 只返回“订阅成功”，没有看到通知 job / 微信订阅消息调度的完整迁移。

### 8. 测试后台批处理能力缩水

测试后台 Go 版 batch start 只把状态改为 `running`；legacy batch / single image API 返回 stub 文案。主分支 Python 的 `test_backend` 目录、批处理器、静态测试后台资源和数据集处理能力没有完整迁过来。

## 运维 / 数据脚本缺口

当前 Go 分支只保留了 `backend/scripts/push-docker-ccr.mjs`。主分支这些 Python 运维脚本没有迁到 Go，也没有作为 Python 脚本保留在当前 `backend/scripts/`：

- `backend/scripts/reconcile_membership_truth.py`
- `backend/scripts/wechat_pay_show_cert_serial.py`
- `backend/scripts/enrich_top_missing_foods.py`
- `backend/scripts/import_usda_fooddata.py`
- `backend/scripts/translate_usda_aliases.py`
- `backend/scripts/apply_exercise_migration.py`

SQL 文件大多已归档到 `backend/migrations/archive/`，但当前还不是可执行、有顺序、有状态表的正式 Go migration runner。

## 建议补迁优先级

1. 先补 **公共食物库** 和 **菜谱** 20 个 stub 路由，因为这些是小程序使用路由，当前会直接 501。
2. 再补 **异步 worker runtime**，否则 submit 类任务只会 pending，分析链路无法闭环。
3. 补 **db_first 营养库匹配**，这是产品核心算法，不能长期用纯 LLM 结果冒充。
4. 补 **会员支付 + 积分额度治理**，避免上线后支付和权益失真。
5. 补 **二维码、统计洞察、保质期识别/订阅、测试后台批处理**。
6. 最后整理运维脚本和 migration runner，决定哪些继续保留 Python，哪些迁 Go CLI。

