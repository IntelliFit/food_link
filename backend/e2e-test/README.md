# 后端 API E2E 契约测试

本文档说明 `food_link` 后端 API 端到端契约测试系统。它面向人类维护者和 AI 编码代理，目标是让新增 API 测试尽量只需要改 YAML 用例文件。

## 目标

E2E 契约测试在 HTTP 边界验证后端 API 行为：

- 请求方法、路径、query、headers、认证和请求体
- 响应状态码
- 响应头
- 响应 JSON body
- 所有已注册 Gin 路由的基础可达性
- 创建、更新等写接口的后续读取和数据库副作用

这些测试不是线上 smoke test，也不是压测。默认不会请求线上后端。测试会在进程内构建真实 Go Gin app，创建一个全新的本地 PostgreSQL 临时数据库，写入固定 fixture 数据，请求真实路由，然后删除临时数据库。

## 快速开始

在仓库根目录运行：

```bash
npm run test:backend:api-contract
```

在 `backend/` 目录运行：

```bash
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

## 目录结构

所有 E2E 相关资产都放在一个目录下：

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

Go 源码也放在同一个 E2E 板块中：

```text
backend/e2e-test/cmd/api-contract-test/   CLI 入口
backend/e2e-test/runner/                  runner、临时数据库、fixtures、断言
```

本文档是唯一的本地说明入口：

```text
backend/e2e-test/README.md
```

## Runner 如何工作

默认执行流程：

1. 加载 `backend/e2e-test/suite.yaml`。
2. 加载 `backend/config.yaml`。
3. 连接配置里的 PostgreSQL server。
4. 使用 `temp_db.admin_database` 作为维护数据库。
5. 创建形如 `food_link_e2e_<timestamp>_<nanosecond>` 的临时数据库。
6. 执行现有 Go 后端 AutoMigrate。
7. 执行 `backend/e2e-test/fixtures/` 下的 SQL fixture。
8. 通过 `internal/app.New(cfg)` 构建真实 app。
9. 关闭 OTel 和后台 worker，减少测试不确定性。
10. 通过 `httpexpect.NewBinder` 直接向进程内 Gin router 发送请求。
11. 断言状态码、响应头、JSON body 和 body 文本。
12. 除非指定 `--keep-db`，否则删除临时数据库。

配置中的 PostgreSQL 用户必须有 `CREATE DATABASE` 和 `DROP DATABASE` 权限。

## Suite 文件

主配置文件：

```text
backend/e2e-test/suite.yaml
```

重要顶层字段：

```yaml
id: food-link-api-contract
name: "后端 API 契约测试"
desc: "使用临时 PostgreSQL 数据库和真实 Gin 路由验证后端 API 的请求、认证、响应头和响应体。"
config_dir: "."

temp_db:
  enabled: true
  admin_database: "postgres"
  name_prefix: "food_link_e2e"
  keep: false

auth:
  users:
    user1:
      id: "00000000-0000-0000-0000-000000000001"
      openid: "e2e-openid-user1"
      unionid: "e2e-unionid-user1"
  test_backend_cookie: "api-contract-test"

seed_sql:
  - "fixtures/base.sql"

case_files:
  - "cases/*/*.yaml"
```

## 新增 API 用例

根 `suite.yaml` 只放全局配置。具体路由或模块的测试放在：

```text
backend/e2e-test/cases/<route-or-module>/*.yaml
```

例如 `/api/body-metrics/water` 的测试放在：

```text
backend/e2e-test/cases/body-metrics/water.yaml
```

每个 case 文件结构如下：

```yaml
cases:
  - id: health.water.create.success
    name: "新增饮水记录"
    desc: "验证登录用户可以为指定日期新增饮水记录，且响应中的日期和饮水量符合请求。"
    group: health
    method: POST
    path: /api/body-metrics/water
    auth: user1
    body:
      amount_ml: 120
      date: "2026-05-14"
      recorded_on: "2026-05-14"
    expect:
      status: 200
      headers:
        X-Trace-Id: not_empty
      json:
        code: 0
        data.item.date: "2026-05-14"
        data.item.amount_ml: 120
```

用例元信息：

- `id`：稳定的机器可读标识，用于 `--case` 选择和失败输出。
- `name`：短中文名，展示在测试输出中。
- `desc`：较详细的人类可读说明，描述这个用例验证什么行为。
- `group`：模块名，例如 `user`、`health`、`food-record`、`membership`。
- `id` 推荐使用稳定格式，例如 `user.profile.success` 或 `food-record.detail.not-found`。

## 认证规则

匿名请求：

```yaml
auth: none
```

也可以省略 `auth`。

登录用户：

```yaml
auth: user1
```

`user1` 必须存在于 `suite.yaml` 的 `auth.users` 下。runner 会使用后端 JWT secret 签发 JWT，并发送：

```http
Authorization: Bearer <token>
```

内部 test-backend cookie：

```yaml
auth: test_backend_cookie
```

会发送：

```http
Cookie: test_backend_token=<configured value>
```

未知认证名会让用例失败，不会静默降级成匿名请求。

## Fixtures

基础 fixture 文件：

```text
backend/e2e-test/fixtures/base.sql
```

它写入常见测试数据，例如：

- `weapp_user`
- 会员套餐和有效会员
- 饮食记录
- 饮水日志
- 体重记录
- 运动日志
- 保质期条目
- 手动食物库条目
- 菜谱

SQL 支持变量替换：

```sql
'{{auth.user1.id}}'
'{{record.lunch.id}}'
```

变量来源：

- `suite.yaml` 的 `default_vars`
- `suite.yaml` 的 `auth.users`

由于每次运行都会创建全新的临时数据库，fixture 不需要保护线上数据。但它仍然应该保持简单、确定、容易阅读。

## 断言

状态码：

```yaml
expect:
  status: 200
```

允许多个状态码：

```yaml
expect:
  status_any: [200, 201, 202]
```

响应头：

```yaml
expect:
  headers:
    X-Trace-Id: not_empty
```

JSON body：

```yaml
expect:
  json:
    code: 0
    data.id: "00000000-0000-0000-0000-000000000001"
    data.items: type:array
```

支持的期望值：

- 精确标量值，例如 `code: 0`
- `exists`
- `not_empty`
- `type:string`
- `type:number`
- `type:boolean`
- `type:object`
- `type:array`
- `type:null`
- `regex:<pattern>`

JSON path 使用 `gjson` 语法：

```yaml
data.items.0.name: "rice"
data.water_daily.2026-05-14.total: type:number
```

body 包含文本：

```yaml
expect:
  body_contains:
    - "food_link"
```

## 流程型测试

有些行为不能只靠一个孤立请求证明。例如创建一个条目后，通常还需要确认返回的 id 能被详情接口读取，或者确认数据确实写入了临时数据库。

runner 支持三种能力：

- `capture`：从当前响应 JSON 中保存值到运行时变量。
- `{{variable.name}}`：在后续 path、query、headers、body、expect 和 DB 断言中复用变量。
- `db_assert`：查询临时数据库，并比较第一行第一列。

示例：

```yaml
cases:
  - id: expiry.item.create.workflow
    name: "创建保质期条目"
    desc: "创建一条保质期记录，捕获响应里的 item id，并确认记录已经落库。"
    group: expiry
    method: POST
    path: /api/expiry/items
    auth: user1
    body:
      food_name: "E2E Workflow Milk"
      quantity_note: "1 bottle"
      storage_type: "refrigerated"
      source_type: "manual"
      expire_date: "2026-05-20"
    expect:
      status: 200
      json:
        code: 0
        data.item.id: not_empty
        data.item.food_name: "E2E Workflow Milk"
    capture:
      expiry.workflow_item_id: data.item.id
    db_assert:
      - query: "select count(*) from food_expiry_items where id = ? and user_id = ?"
        args:
          - "{{expiry.workflow_item_id}}"
          - "{{auth.user1.id}}"
        equals: 1

  - id: expiry.item.detail.after-create
    name: "查询刚创建的保质期条目"
    desc: "使用上一个用例捕获的 item id 查询详情，确认创建结果可被读取。"
    group: expiry
    method: GET
    path: /api/expiry/items/{{expiry.workflow_item_id}}
    auth: user1
    expect:
      status: 200
      json:
        code: 0
        data.item.id: "{{expiry.workflow_item_id}}"
        data.item.food_name: "E2E Workflow Milk"
```

### Capture

`capture` 的 key 是变量名，value 是响应 JSON path，使用 `gjson` 语法：

```yaml
capture:
  expiry.workflow_item_id: data.item.id
```

如果 JSON path 不存在或结果为空，用例会失败。捕获到的变量可以被同一次运行中的后续用例使用。用例执行顺序是 case file 加载顺序加文件内部顺序，所以有依赖关系的流程步骤应放在同一个文件中，并按依赖顺序排列。

如果删除了前置创建用例，后续用例里的 `{{expiry.workflow_item_id}}` 这类变量就不会有来源。runner 会在发请求前失败，并提示 `unresolved variable(s)`，不会把未解析变量发给后端。

### 变量替换

变量使用 `{{name}}` 语法：

```yaml
path: /api/expiry/items/{{expiry.workflow_item_id}}
headers:
  X-Debug-User: "{{auth.user1.id}}"
body:
  user_id: "{{auth.user1.id}}"
expect:
  json:
    data.item.id: "{{expiry.workflow_item_id}}"
```

内置变量包括：

- `suite.yaml` 中的 `default_vars`
- 认证用户字段，例如 `{{auth.user1.id}}`、`{{auth.user1.openid}}`、`{{auth.user1.unionid}}`
- 前面用例通过 `capture` 创建的变量

### DB 断言

`db_assert` 在 HTTP 响应断言和 `capture` 之后执行，所以可以使用 API 返回的值：

```yaml
db_assert:
  - query: "select count(*) from food_expiry_items where id = ? and user_id = ?"
    args:
      - "{{expiry.workflow_item_id}}"
      - "{{auth.user1.id}}"
    equals: 1
```

规则：

- 查询运行在 app 使用的同一个临时数据库上。
- SQL 使用 `?` 占位符，runner 通过 GORM 执行。
- 只比较第一行第一列。
- `equals` 支持和 JSON 断言相同的标量期望风格，包括精确值、`exists`、`not_empty`、`type:number` 和 `regex:<pattern>`。
- DB 断言只应该用于验证通过 API 响应很难证明的副作用。

## 路由冒烟

`route_smoke.enabled: true` 会为每个已注册 Gin 路由自动生成一个浅层冒烟用例。

路由冒烟检查：

- 路由不会 panic
- 状态码在允许列表内
- 响应包含 `X-Trace-Id`

路由冒烟不证明业务正确性。真正的业务契约应该写显式 `cases`。

适合路由冒烟的场景：

- 新路由注册检查
- panic 回归检查
- 基础 middleware 覆盖

不适合路由冒烟的场景：

- 业务字段校验
- 权限边界校验
- DB 写入验证
- 详细错误码校验

## AI 维护规则

AI 代理维护这些测试时遵守：

1. 优先只修改 `backend/e2e-test/cases/` 下的路由用例文件。
2. 只有缺少种子数据阻塞用例时，才修改 `backend/e2e-test/fixtures/base.sql`。
3. 只有 YAML 无法表达需要的断言或行为时，才修改 `backend/e2e-test/runner/`。
4. 不要把测试指向生产数据库、生产用户或生产对象存储。
5. 认证用例使用 `auth.users` 中的命名用户。
6. 写接口只能写入临时数据库和 fixture 用户。
7. 依赖外部服务的 API，在 MVP 阶段优先测试认证、校验和响应结构；除非用户明确要求，不要强制真实外部调用。
8. 修改后至少运行：

```bash
go test ./e2e-test/runner ./e2e-test/cmd/api-contract-test -run TestDoesNotExist -count=1
npm run test:backend:api-contract -- --timeout 5m
git diff --check
```

## 排错

### CREATE DATABASE 失败

通常是配置中的 PostgreSQL 用户没有创建数据库权限。使用本地测试 DB 用户，并授予 `CREATE DATABASE` 和 `DROP DATABASE` 权限。不要使用生产库。

### 保留失败现场数据库

运行：

```bash
go run ./e2e-test/cmd/api-contract-test --case <case-id> --keep-db
```

输出会打印临时数据库名。检查完后手动删除。

### 用例意外返回 401

检查：

- 用例是否漏了 `auth: user1`
- `auth.users` 中是否定义了该认证名
- fixture 是否创建了匹配的 `weapp_user` 行

### JSON path 找不到

检查：

- 字段是在 `data.xxx` 下，还是顶层字段
- 数组下标是否正确，例如 `data.items.0.name`
- 字段名是否和 JSON tag 一致

### 出现 unresolved variable(s)

说明用例里存在未解析的 `{{变量名}}`。常见原因：

- 依赖的前置 `capture` 用例被删除或没有执行。
- 只运行了后续用例，例如 `--case expiry.item.detail.after-create`，但没有先运行创建用例。
- 变量名拼错。

如果你想测试“数据不存在”的 404，不要使用依赖 `capture` 的变量。改用一个合法但不存在的固定 UUID：

```yaml
path: /api/expiry/items/00000000-0000-0000-0000-00000000ffff
expect:
  status: 404
  json:
    code: 10001
```

### 路由冒烟输出大量 400 或 401 日志

这是预期行为。路由冒烟会用通用 query/body 请求所有路由。需要认证或必填字段的路由经常返回 400 或 401。重点看最后 summary，`Failed: 0` 表示冒烟通过。

## 当前基线

当前 MVP 基线：

```text
Total: 163, Passed: 163, Failed: 0
```
