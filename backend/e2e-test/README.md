# 后端 API E2E 测试与自动化测试基础设施

本文档说明 `food_link` 后端 API 测试与自动化测试基础设施。它包含两套系统，共享同一套「临时数据库 + fixtures」核心能力：

1. **API 契约测试** — 进程内直接调用 Go Gin router，验证 HTTP 边界行为
2. **微信小程序端到端测试** — 启动真实 HTTP server，通过 `miniprogram-automator` 操作微信开发者工具中的小程序

两套系统面向人类维护者和 AI 编码代理，目标是让新增测试尽量只需要改 YAML 用例文件。

---

## 目录

- [系统概览](#系统概览)
- [临时数据库机制](#临时数据库机制)
- [API 契约测试](#api-契约测试)
- [微信小程序端到端测试](#微信小程序端到端测试)
- [ Fixtures](#fixtures)
- [AI 维护规则](#ai-维护规则)
- [排错](#排错)

---

## 系统概览

```
backend/e2e-test/
  suite.yaml              ← 全局配置（临时数据库、auth 用户、seed_sql）
  cases/                  ← API 契约测试用例
  fixtures/               ← 种子数据 SQL
  runner/                 ← 共享核心（临时数据库、fixtures、断言）
  cmd/
    api-contract-test/    ← 契约测试 CLI 入口
    api-test-server/      ← 端到端测试 HTTP 服务器入口

e2e-weapp/
  src/
    runner.ts             ← 端到端测试编排引擎
    mrc.ts                ← miniprogram-remote-control 封装
    backend-client.ts     ← 与 api-test-server 交互
  scenarios/              ← 小程序场景用例
```

| 维度 | API 契约测试 | 微信小程序端到端测试 |
|------|-------------|-------------------|
| 入口 | `cmd/api-contract-test` | `e2e-weapp/src/runner.ts` |
| 调用方式 | 进程内 `httpexpect.NewBinder` | 真实 HTTP + mrc 操作开发者工具 |
| 前端参与 | 无 | 微信小程序在开发者工具模拟器中运行 |
| 数据库初始化 | `runner.PrepareDatabase` + `ApplySeedSQL` | 相同 |
| 断言能力 | status/headers/JSON/db_assert | mrc 元素检查 + evaluate + db_assert |

---

## 临时数据库机制

两套系统共享同一个临时数据库引擎：`backend/e2e-test/runner/db.go`。

### 创建流程

`PrepareDatabase(ctx, suite, cfg)` 的执行步骤：

1. 读取 `suite.temp_db` 配置，确认临时库已启用（默认 `enabled: true`）
2. 用 `admin_database`（默认 `postgres`）连接 PostgreSQL server
3. 生成唯一数据库名：`food_link_e2e_<timestamp>_<nanosecond>`
4. 执行 `CREATE DATABASE <name>`
5. 连接新数据库，执行 Go 后端 `AutoMigrate`（创建全部表结构）
6. 返回 `*TempDatabase`，包含 admin 连接（用于销毁）和 app 连接（用于业务）

```go
tempDB, err := e2e.PrepareDatabase(ctx, suite, cfg)
cfg.Database = tempDB.Config   // 让后端 app 指向临时库
```

### 注入 Fixtures

`ApplySeedSQL(ctx, suite, db, vars)` 的执行步骤：

1. 按 `suite.seed_sql` 列表顺序读取 SQL 文件（如 `fixtures/base.sql`）
2. 执行变量替换：`{{auth.user1.id}}`、`{{record.lunch.id}}` 等
3. 通过 GORM `Exec` 注入到临时数据库

### 销毁流程

`TempDatabase.Close()` 的执行步骤：

1. 关闭 app 连接
2. 若 `keep: false`：
   - `pg_terminate_backend(pid)` 杀掉其他连接
   - `DROP DATABASE IF EXISTS <name>`
3. 关闭 admin 连接

### 权限要求

配置中的 PostgreSQL 用户必须有 `CREATE DATABASE` 和 `DROP DATABASE` 权限。

---

## API 契约测试

在 HTTP 边界验证后端 API 行为：请求方法、路径、query、headers、认证、请求体、响应状态码、响应头、响应 JSON body、所有已注册 Gin 路由的基础可达性、写接口的数据库副作用。

这些测试不是线上 smoke test，也不是压测。默认不会请求线上后端。

### 快速开始

```bash
# 仓库根目录
npm run test:backend:api-contract

# backend/ 目录
go run ./e2e-test/cmd/api-contract-test --timeout 5m
```

常用命令：

```bash
go run ./e2e-test/cmd/api-contract-test --list
go run ./e2e-test/cmd/api-contract-test --case user.profile.success
go run ./e2e-test/cmd/api-contract-test --group health
go run ./e2e-test/cmd/api-contract-test --keep-db
```

`--keep-db` 只用于调试。它会保留本次临时数据库，方便手动检查数据。

### 目录结构

```text
backend/e2e-test/
  suite.yaml
  cases/
    body-metrics/
      summary.yaml
      water.yaml
    expiry/
      dashboard.yaml
      items.yaml
    user/
      profile.yaml
  fixtures/
    base.sql
```

### Runner 执行流程

1. 加载 `backend/e2e-test/suite.yaml`
2. 加载 `backend/config.yaml`
3. `PrepareDatabase` 创建临时数据库
4. `ApplySeedSQL` 注入 fixtures
5. `internal/app.New(cfg)` 构建真实 Gin app
6. 关闭 OTel 和后台 worker
7. `httpexpect.NewBinder` 直接向进程内 router 发送请求
8. 断言 status/headers/JSON/body
9. 删除临时数据库

### 用例文件

根 `suite.yaml` 只放全局配置。具体路由测试放在：

```text
backend/e2e-test/cases/<route-or-module>/*.yaml
```

用例结构：

```yaml
cases:
  - id: health.water.create.success
    name: "新增饮水记录"
    desc: "验证登录用户可以为指定日期新增饮水记录"
    group: health
    method: POST
    path: /api/body-metrics/water
    auth: user1
    body:
      amount_ml: 120
      date: "2026-05-14"
    expect:
      status: 200
      headers:
        X-Trace-Id: not_empty
      json:
        code: 0
        data.item.date: "2026-05-14"
        data.item.amount_ml: 120
```

支持的断言类型：精确值、`exists`、`not_empty`、`type:string/number/boolean/object/array/null`、`regex:<pattern>`。

JSON path 使用 `gjson` 语法。

### 流程型测试

- `capture`：从响应 JSON 中保存值到运行时变量
- `{{variable.name}}`：在后续用例中复用
- `db_assert`：查询临时数据库验证副作用

---

## 微信小程序端到端测试

通过 `miniprogram-automator`（`mrc` CLI）操作微信开发者工具中的小程序，验证完整的「前端渲染 → API 调用 → 数据库读写」链路。

### 原理

**数据库层**：和契约测试完全共用 `PrepareDatabase` + `ApplySeedSQL`。

**后端层**：启动 `api-test-server`（`cmd/api-test-server/main.go`），这是一个真实的 HTTP 服务器，监听随机空闲端口，携带临时数据库运行。

**前端层**：
1. `runner.ts` 自动寻找空闲端口（如 3020）
2. 在该端口启动 `api-test-server`
3. 编译小程序，通过环境变量 `TARO_APP_API_BASE_URL_OVERRIDE=http://127.0.0.1:<port>` 覆盖 API 地址
4. 小程序在运行时解析 API 根地址；设置 OVERRIDE 后所有 `wx.request` 都会指向临时服务器
5. 自动启动/复用微信开发者工具，等待 mrc 连接就绪
6. 通过 `mrc` 命令执行页面导航、元素点击、脚本执行等操作
7. 测试结束后关闭服务器，临时数据库自动销毁

```
小程序 wx.request
    ↓
TARO_APP_API_BASE_URL_OVERRIDE = "http://127.0.0.1:3020"  （编译时注入，运行时强制覆盖）
    ↓
api-test-server @ 3020
    ↓
Gin Router → Handler → Service → Repo → GORM
    ↓
临时数据库 food_link_e2e_...
```

### 目录结构

```text
e2e-weapp/
  src/
    runner.ts         ← 编排引擎
    mrc.ts            ← mrc 命令封装
    backend-client.ts ← 与 api-test-server 交互
    types.ts          ← 类型定义
  scenarios/
    smoke.yaml        ← 冒烟测试样例
    home-dashboard.yaml
```

### 快速开始

```bash
# 端到端冒烟测试（完整链路）
npm run test:e2e-weapp:smoke

# 原有契约测试
npm run test:backend:api-contract
```

`test:e2e-weapp:smoke` 的完整流程：

```
1. 找空闲端口
2. 启动 api-test-server（创建临时数据库 + 注入 fixtures）
3. 等待后端就绪
4. 编译小程序（API URL 指向临时端口）
5. 启动/复用微信开发者工具，等待 mrc 就绪
6. 获取测试 token
7. 执行场景步骤（relaunch → wait → evaluate）
8. 关闭开发者工具（若由我们启动）
9. 关闭后端（自动 DROP DATABASE）
```

### 场景文件

场景放在 `e2e-weapp/scenarios/*.yaml`：

```yaml
id: e2e-smoke
name: "端到端流程冒烟"
desc: "验证临时数据库 → 小程序构建 → 开发者工具自动化 → 数据库清理 整条链路可跑通"
setup:
  backend:
    suite: "backend/e2e-test/suite.yaml"
  miniprogram:
    build_mode: "development"
    devtools_port: 9420
steps:
  - action: "relaunch"
    name: "进入首页"
    url: "/pages/index/index"
  - action: "wait"
    name: "等待页面渲染"
    ms: 2000
  - action: "evaluate"
    name: "验证页面已加载"
    script: "getCurrentPages().length > 0"
```

支持的动作：

| 动作 | 说明 |
|------|------|
| `relaunch` | 重启到指定页面 |
| `switchTab` | 切换 Tab 页面 |
| `back` | 返回上一页 |
| `tap` / `click` | 点击元素 |
| `wait` | 等待 N 毫秒 |
| `screenshot` | 截图（若环境支持） |
| `evaluate` | 执行小程序 JS 脚本 |
| `assert_element` | 断言元素存在/不存在 |
| `assert_evaluate` | 断言脚本返回值 |
| `db_assert` | 查询临时数据库断言 |
| `clearMocks` | 清除所有 Mock |

变量替换支持 `{{backend.token.user1}}`、`{{backend.auth.user1.id}}`、`{{capture.xxx}}`。

### 开发者工具自动化

`runner.ts` 会自动处理开发者工具生命周期：

- **检测**：运行前检查 `lsof -i :<port>`，若已监听则复用现有实例
- **启动**：未运行时自动执行 `cli auto --project <PROJECT_ROOT> --auto-port <port>`
- **等待**：轮询 `mrc where` 直至连接成功（超时 60s）
- **关闭**：测试结束后，仅关闭由 `runner.ts` 自己启动的实例，不关闭用户手动打开的工具

前置条件：开发者工具 CLI 路径（macOS 默认 `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`）。

### 构建脚本

```json
"build:weapp:e2e": "cross-env NODE_ENV=development taro build --type weapp --no-check"
```

这个脚本**不硬编码** `TARO_APP_API_BASE_URL`，允许 `runner.ts` 在运行时通过环境变量注入临时服务器地址。避免使用 `build:weapp`（它硬编码了 `https://dev.healthymax.cn`）。

### 测试专用路由

`api-test-server` 提供以下辅助路由：

| 路由 | 说明 |
|------|------|
| `GET /api/test/health` | 健康检查 |
| `GET /api/test/auth/token?user=user1` | 签发测试用户 JWT |
| `POST /api/test/db/query` | 只读 SQL 查询 |
| `POST /api/test/db/reset` | 重置数据库到 fixture 状态 |
| `GET /api/test/suite/vars` | 获取 suite 变量表 |

---

## Fixtures

基础 fixture 文件：

```text
backend/e2e-test/fixtures/base.sql
```

当前 fixture 预置数据：

- `weapp_user`：2 个测试用户（user1 / user2）
- `membership_plan_config`：轻享月卡、标准月卡
- `user_pro_memberships`：user1 的有效会员
- `user_body_metric_settings`：饮水目标 2000ml
- `user_water_logs`、`user_weight_records`、`user_exercise_logs`
- `user_food_records`：午餐记录
- `food_expiry_items`：牛奶
- `manual_food_library`：米饭
- `user_recipes`：米饭套餐

SQL 支持变量替换：`{{auth.user1.id}}`、`{{record.lunch.id}}` 等。

由于每次运行都会创建全新的临时数据库，fixture 不需要保护线上数据，但仍应保持简单、确定、容易阅读。

---

## AI 维护规则

1. **优先只修改用例文件**：契约测试改 `cases/`，端到端测试改 `scenarios/`。
2. **只有缺少种子数据阻塞用例时**，才修改 `fixtures/base.sql`。
3. **只有 YAML 无法表达需要的断言或行为时**，才修改 `runner/` 或 `e2e-weapp/src/`。
4. **不要把测试指向生产数据库、生产用户或生产对象存储。**
5. **认证用例使用** `auth.users` 中的命名用户。
6. **写接口只能写入临时数据库和 fixture 用户。**
7. **依赖外部服务的 API**，在 MVP 阶段优先测试认证、校验和响应结构；除非用户明确要求，不要强制真实外部调用。
8. **修改后至少运行**：

```bash
# 契约测试
go test ./e2e-test/runner ./e2e-test/cmd/api-contract-test -run TestDoesNotExist -count=1
npm run test:backend:api-contract -- --timeout 5m

# 端到端冒烟测试
npm run test:e2e-weapp:smoke

git diff --check
```

---

## 排错

### CREATE DATABASE 失败

通常是 PostgreSQL 用户没有创建数据库权限。授予 `CREATE DATABASE` 和 `DROP DATABASE` 权限，不要使用生产库。

### 保留失败现场数据库

```bash
# 契约测试
go run ./e2e-test/cmd/api-contract-test --case <case-id> --keep-db

# 端到端测试
cd e2e-weapp && npx ts-node src/runner.ts --scenario scenarios/<name>.yaml --keep-db
```

输出会打印临时数据库名。检查完后手动删除。

### 用例意外返回 401

- 用例是否漏了 `auth: user1`
- `auth.users` 中是否定义了该认证名
- fixture 是否创建了匹配的 `weapp_user` 行

### JSON path 找不到

- 字段是在 `data.xxx` 下，还是顶层字段
- 数组下标是否正确，例如 `data.items.0.name`
- 字段名是否和 JSON tag 一致

### 出现 unresolved variable(s)

- 依赖的前置 `capture` 用例被删除或没有执行
- 只运行了后续用例但没有先运行创建用例
- 变量名拼错

### 路由冒烟输出大量 400 或 401 日志

这是预期行为。路由冒烟会用通用 query/body 请求所有路由。需要认证或必填字段的路由经常返回 400 或 401。重点看最后 summary，`Failed: 0` 表示冒烟通过。

### 端到端测试：mrc screenshot 超时

`mrc screenshot` 命令在某些环境下（macOS 屏幕录制权限不足、模拟器窗口被遮挡等）会连接成功但截图操作卡住。可将场景中的 `screenshot` 步骤替换为 `evaluate` 或 `assert_element` 作为绕过。

### 端到端测试：开发者工具已打开但 mrc 连接失败

- 确认开发者工具是通过 CLI `cli auto --project ... --auto-port 9420` 启动的，而不是 GUI 手动打开
- 检查端口是否被占用：`lsof -i :9420`
- 若复用了手动打开的实例，可能缺少自动化 WebSocket 服务，建议关闭后由 `runner.ts` 自动启动

---

## 当前基线

API 契约测试：

```text
Total: 163, Passed: 163, Failed: 0
```
