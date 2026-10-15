# 契约与小程序端到端验证

按任务风险选用，不作为文档修改或每次提交的全量门禁。运行前确认目标为隔离测试数据库；测试子进程的TEMP/TMP/TMPDIR/GOTMPDIR/FOODLINK_TEST_TMPDIR放D:/cache/agent-tests下本任务目录，复用已有依赖和Go缓存。

先选单条/分组。默认不使用 --keep-db，不自动下载PostgreSQL或模型；依赖不存在先说明，不退回生产库。测试完成或失败都停止自己的临时PG并清理自身数据，保留现有服务。下面是搬入的入口与配置说明，不代表本轮执行结果；用例数量以实际目录为准。

## 端到端测试 / 自动化测试

详细文档见 `backend/e2e-test/README.md`，以下是快速参考。

本项目有两套自动化测试系统，**共用同一套临时数据库初始化机制**，但运行时完全独立：

### 1. 纯后端 API 契约测试

**定义**：进程内直接调用 Go Gin router，验证 HTTP 边界行为（请求方法、路径、认证、响应状态码、响应头、JSON body）。不涉及前端/小程序。

**入口**：`backend/e2e-test/cmd/api-contract-test/main.go`

**命令**：
```bash
# 运行全部用例（含路由冒烟 + cases/*/*.yaml）
npm run test:backend:api-contract

# 常用参数（需在 backend/ 目录用 go run 执行）
go run ./e2e-test/cmd/api-contract-test --list                # 列出所有用例
go run ./e2e-test/cmd/api-contract-test --case user.profile.success  # 单条用例
go run ./e2e-test/cmd/api-contract-test --group health        # 按分组运行
go run ./e2e-test/cmd/api-contract-test --keep-db             # 保留临时数据库（调试用）
```

**用例位置**：`backend/e2e-test/cases/*/*.yaml`（按模块分组，当前 16 个 YAML 文件）

### 2. 微信小程序端到端测试（全量 / Trace）

**定义**：启动真实 HTTP server，通过 `miniprogram-automator`（`mrc` CLI）操作微信开发者工具中的小程序，验证完整链路「前端渲染 → API 调用 → 数据库读写」。

**入口**：
- `e2e-weapp/src/runner.ts` — 单场景执行
- `e2e-weapp/src/trace-runner.ts` — 多 Trace 聚合执行

**命令**：
```bash
# 单场景（home-dashboard）
npm run test:e2e-weapp

# 冒烟测试（验证整条链路可跑通）
npm run test:e2e-weapp:smoke

# Trace 聚合测试（如食物识别流程）
npm run test:e2e-weapp:traces
```

**用例位置**：
- `e2e-weapp/scenarios/*.yaml` — 场景级用例
- `e2e-weapp/traces/*.yaml` — 用户旅程级用例

### 3. 冒烟测试

后端 API 契约测试会自动生成「路由冒烟」用例（suite.yaml 中 `route_smoke.enabled: true`），用通用参数请求所有已注册路由，验证不会 panic 且状态码在允许列表内。

小程序端到端也有独立的 smoke 用例：`e2e-weapp/scenarios/smoke.yaml`

### 4. 公用临时数据库初始化

两套测试系统共用以下配置和 fixtures：

| 文件 | 作用 |
|-----|------|
| `backend/e2e-test/suite.yaml` | 全局配置：临时数据库参数、认证用户定义、seed_sql 文件列表、case_files 路径、路由冒烟配置 |
| `backend/e2e-test/fixtures/base.sql` | 种子数据 SQL，每次运行创建全新临时数据库后注入。预置 2 个测试用户、会员配置、饮食记录、体重、运动、过期食品、手动食物库、菜谱等数据 |
| `backend/e2e-test/runner/db.go` | 临时数据库引擎：创建数据库 → AutoMigrate 建表 → 返回连接 |
| `backend/e2e-test/runner/fixtures.go` | 读取 `seed_sql` 列表，执行变量替换（如 `{{auth.user1.id}}`）后注入 |

SQL 支持变量替换，可用变量见 `suite.yaml` 的 `auth.users` 和 `default_vars`。
