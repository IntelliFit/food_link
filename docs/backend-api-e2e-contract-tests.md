# Backend API E2E Contract Tests

本文档说明 `food_link` Go 后端的 API 端到端契约测试框架。目标是让人类开发者和 AI 代理都能用同一套规则新增、运行和维护后端 API 测试。

## 目标

这套测试用于验证后端 API 的请求、认证、响应状态码、响应头和响应体是否符合预期。

它不是线上冒烟测试，也不是压测。默认不会请求线上服务，而是在本机进程内启动真实 Gin router，并使用一个全新的临时 PostgreSQL 数据库执行测试。每次运行都会创建、迁移、填充、测试、删除临时库。

## 快速运行

在项目根目录运行：

```bash
npm run test:backend:api-contract
```

在 `backend/` 目录运行：

```bash
go run ./cmd/api-contract-test --timeout 5m
```

常用命令：

```bash
go run ./cmd/api-contract-test --list
go run ./cmd/api-contract-test --case user.profile.success
go run ./cmd/api-contract-test --group health
go run ./cmd/api-contract-test --keep-db
```

`--keep-db` 会保留本次临时数据库，方便失败后手动排查。正常提交前不要依赖保留库。

## 文件位置

核心文件：

- `backend/cmd/api-contract-test/main.go`：命令行入口。
- `backend/internal/e2e/`：测试 runner、临时 DB、fixture、断言逻辑。
- `backend/testdata/api-contract/suite.yaml`：测试套件配置。新增 API 用例优先改这里。
- `backend/testdata/api-contract/fixtures/base.sql`：基础种子数据。
- `backend/docs/api-contract-tests.md`：后端目录内的短说明。

根目录脚本：

- `package.json` 的 `test:backend:api-contract`。

## 运行机制

默认执行流程：

1. 读取 `backend/testdata/api-contract/suite.yaml`。
2. 读取 `backend/config.yaml`。
3. 连接配置中的 PostgreSQL server。
4. 用 `temp_db.admin_database` 作为维护库，创建 `food_link_e2e_<timestamp>_<nanosecond>` 临时库。
5. 调用现有 Go 后端 `AutoMigrate` 创建 schema。
6. 执行 `seed_sql` 中的 SQL fixture。
7. 调用 `internal/app.New(cfg)` 构建真实应用。
8. 关闭后台 worker 和 OTel，避免测试期间跑异步任务或外部链路。
9. 使用 `httpexpect.NewBinder` 对进程内 Gin router 发请求。
10. 按 YAML 断言状态码、响应头、JSON body、字符串包含等。
11. 默认删除临时数据库。

数据库用户必须有 `CREATE DATABASE` 和 `DROP DATABASE` 权限。

## YAML 套件结构

主配置文件是：

```text
backend/testdata/api-contract/suite.yaml
```

主要字段：

```yaml
name: food-link-api-contract
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

cases:
  - name: user.profile.success
    group: user
    method: GET
    path: /api/user/profile
    auth: user1
    expect:
      status: 200
      json:
        code: 0
```

## 新增一个 API 用例

优先只编辑 `backend/testdata/api-contract/suite.yaml`。

示例：

```yaml
- name: health.water.create.success
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

命名建议：

- `name` 用稳定、可搜索的层级名，例如 `user.profile.success`、`food-record.detail.not-found`。
- `group` 用模块名，例如 `user`、`health`、`food-record`、`membership`。
- 成功用例用 `.success`，认证失败用 `.requires-auth`，参数错误用 `.bad-request`。

## 认证规则

不需要登录：

```yaml
auth: none
```

或省略 `auth`。

普通登录用户：

```yaml
auth: user1
```

`user1` 必须在 `auth.users` 中定义。Runner 会用当前配置中的 JWT secret 签发 access token，并设置：

```http
Authorization: Bearer <token>
```

内部测试后台 cookie：

```yaml
auth: test_backend_cookie
```

这会设置：

```http
Cookie: test_backend_token=<configured value>
```

如果 YAML 写了不存在的 auth 名称，该用例会失败。不要让错误 auth 静默退化成匿名请求。

## Fixture 数据

基础 fixture 位于：

```text
backend/testdata/api-contract/fixtures/base.sql
```

它负责创建常见测试数据，例如：

- `weapp_user`
- 会员信息
- 饮食记录
- 喝水记录
- 体重记录
- 运动记录
- 保质期条目
- 手动食物库条目
- 菜谱

SQL 支持变量替换：

```sql
'{{auth.user1.id}}'
'{{record.lunch.id}}'
```

变量来源包括：

- `suite.yaml` 的 `default_vars`
- `suite.yaml` 的 `auth.users`

新增 fixture 时保持幂等思路，但不需要兼容线上数据，因为每次都是新临时库。

## 断言能力

状态码：

```yaml
expect:
  status: 200
```

多个允许状态码：

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

支持的断言值：

- 精确值：`code: 0`、`status: ok`
- `exists`
- `not_empty`
- `type:string`
- `type:number`
- `type:boolean`
- `type:object`
- `type:array`
- `type:null`
- `regex:<pattern>`

JSON path 使用 `gjson` 语法，例如：

```yaml
data.items.0.name: "米饭"
data.water_daily.2026-05-14.total: type:number
```

响应体字符串包含：

```yaml
expect:
  body_contains:
    - "food_link"
```

## Route Smoke

`route_smoke.enabled: true` 会自动遍历 Gin 已注册路由，生成基础 smoke 用例。

它只检查：

- 路由不会 panic。
- 状态码在允许列表中。
- 响应包含 `X-Trace-Id`。

Route smoke 不是完整契约测试。真正的 API 行为仍应写成显式 `cases`。

适合 route smoke 的场景：

- 确认新路由已注册。
- 防止中间件或路由参数导致 panic。
- 快速覆盖全量 API 基础可达性。

不适合 route smoke 的场景：

- 校验业务字段。
- 校验权限边界。
- 校验数据库写入结果。
- 校验复杂错误码。

这些都应该写显式用例。

## AI 代理维护规则

AI 后续新增或修改 API contract 测试时，按以下规则执行：

1. 优先只修改 `backend/testdata/api-contract/suite.yaml`。
2. 只有缺少数据时，才修改 `backend/testdata/api-contract/fixtures/base.sql`。
3. 只有 YAML 表达不了断言时，才修改 `backend/internal/e2e/`。
4. 不要让测试依赖线上数据库、线上用户或线上对象存储。
5. 新增认证用例时，使用 `auth.users` 中的固定测试用户。
6. 新增写入型用例时，优先写入临时库里的 fixture 用户数据。
7. 对外部服务相关 API，MVP 阶段优先测试参数校验、认证、基础返回结构，不强行调用真实外部服务。
8. 每次改完至少运行：

```bash
go test ./internal/e2e ./cmd/api-contract-test -run TestDoesNotExist -count=1
npm run test:backend:api-contract -- --timeout 5m
git diff --check
```

## 常见问题

### 没有权限创建临时库

错误通常出现在 `CREATE DATABASE`。解决方式：

- 给 `backend/config.yaml` 中的数据库用户授予创建库权限。
- 或使用有权限的本地 PostgreSQL 用户运行。
- 不建议把测试指向生产数据库。

### 想保留失败现场

运行：

```bash
go run ./cmd/api-contract-test --case <case-name> --keep-db
```

命令输出会显示临时库名。排查完后手动删除该库。

### 新增 case 后 401

检查：

- 是否忘记写 `auth: user1`。
- `auth` 名称是否在 `auth.users` 中定义。
- fixture 中是否有对应 `weapp_user`。

### JSON path 断言找不到字段

检查：

- API 返回结构是否是 `data.xxx` 还是顶层字段。
- 数组路径是否使用了正确下标，例如 `data.items.0.name`。
- 字段名是否和 JSON tag 一致。

### Route smoke 日志很多 400/401

这是预期行为。Route smoke 使用通用 query/body 测试所有路由，很多需要登录或必填参数的 API 会返回 400/401。只要状态码在允许列表中，并且最终汇总 `Failed: 0`，就表示 smoke 通过。

## 当前基线

当前 MVP 基线包含显式业务用例和自动 route smoke。最近一次验证结果：

```text
Total: 161, Passed: 161, Failed: 0
```
