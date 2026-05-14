# Backend API E2E Contract Tests

This document describes the backend API end-to-end contract test system for `food_link`. It is written to be readable by both human maintainers and AI coding agents.

## Purpose

The E2E contract tests verify backend API behavior at the HTTP boundary:

- request method, path, query, headers, auth, and body
- response status code
- response headers
- response JSON body
- basic route reachability for all registered Gin routes

These tests are not production smoke tests and not load tests. By default they do not call the online backend. They build the real Go Gin app in-process, create a fresh local PostgreSQL database, seed known fixture data, run requests against the router, and then delete the temporary database.

## Quick Start

From the repository root:

```bash
npm run test:backend:api-contract
```

From `backend/`:

```bash
go run ./e2e-test/cmd/api-contract-test --timeout 5m
```

Useful commands:

```bash
go run ./e2e-test/cmd/api-contract-test --list
go run ./e2e-test/cmd/api-contract-test --case user.profile.success
go run ./e2e-test/cmd/api-contract-test --group health
go run ./e2e-test/cmd/api-contract-test --keep-db
```

Use `--keep-db` only for debugging. It leaves the temporary database behind so you can inspect it manually.

## Directory Layout

All test assets live under one folder:

```text
backend/e2e-test/
  suite.yaml
  cases/
    body-metrics/
      summary.yaml
      water.yaml
    user/
      profile.yaml
  fixtures/
    base.sql
```

Go source code remains in normal Go package locations:

```text
backend/e2e-test/cmd/api-contract-test/   CLI entry point
backend/e2e-test/runner/                  runner, temp DB, fixtures, assertions
```

Related docs:

```text
backend/e2e-test/README.md              full guide and local entry
```

## How The Runner Works

Default lifecycle:

1. Load `backend/e2e-test/suite.yaml`.
2. Load `backend/config.yaml`.
3. Connect to the configured PostgreSQL server.
4. Use `temp_db.admin_database` as the maintenance database.
5. Create a temporary database named `food_link_e2e_<timestamp>_<nanosecond>`.
6. Run the existing Go backend AutoMigrate.
7. Apply SQL fixtures from `backend/e2e-test/fixtures/`.
8. Build the real app through `internal/app.New(cfg)`.
9. Disable OTel and background workers for test determinism.
10. Send requests to the in-process Gin router through `httpexpect.NewBinder`.
11. Assert status, headers, JSON body, and body text.
12. Drop the temporary database unless `--keep-db` is set.

The configured PostgreSQL user must be able to `CREATE DATABASE` and `DROP DATABASE`.

## Suite File

Main file:

```text
backend/e2e-test/suite.yaml
```

Important top-level fields:

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

## Add A New API Case

Keep the root `suite.yaml` for global settings only. Put route-specific tests under:

```text
backend/e2e-test/cases/<route-or-module>/*.yaml
```

For example, `/api/body-metrics/water` tests belong in:

```text
backend/e2e-test/cases/body-metrics/water.yaml
```

Each case file has this shape:

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

Case metadata:

- `id`: stable machine-readable identifier, used by `--case` and failure output.
- `name`: short human-readable Chinese name shown in test output.
- `desc`: longer human-readable description of the expected behavior.
- Use module names for `group`, such as `user`, `health`, `food-record`, `membership`.
- For `id`, use stable values like `user.profile.success` or `food-record.detail.not-found`.

## Auth Rules

Anonymous request:

```yaml
auth: none
```

You may also omit `auth`.

Logged-in user:

```yaml
auth: user1
```

`user1` must exist under `auth.users` in `suite.yaml`. The runner signs a JWT using the configured backend JWT secret and sends:

```http
Authorization: Bearer <token>
```

Internal test-backend cookie:

```yaml
auth: test_backend_cookie
```

This sends:

```http
Cookie: test_backend_token=<configured value>
```

Unknown auth names fail the case. They are not silently treated as anonymous requests.

## Fixtures

Base fixture file:

```text
backend/e2e-test/fixtures/base.sql
```

It seeds common data such as:

- `weapp_user`
- membership plans and active membership
- food records
- water logs
- weight records
- exercise logs
- expiry items
- manual food entries
- recipes

SQL supports variable substitution:

```sql
'{{auth.user1.id}}'
'{{record.lunch.id}}'
```

Variables come from:

- `default_vars` in `suite.yaml`
- `auth.users` in `suite.yaml`

Because every run uses a fresh temporary database, fixtures do not need to protect production data. They should still be simple, deterministic, and easy to read.

## Assertions

Status:

```yaml
expect:
  status: 200
```

Multiple allowed statuses:

```yaml
expect:
  status_any: [200, 201, 202]
```

Headers:

```yaml
expect:
  headers:
    X-Trace-Id: not_empty
```

JSON body:

```yaml
expect:
  json:
    code: 0
    data.id: "00000000-0000-0000-0000-000000000001"
    data.items: type:array
```

Supported expectation values:

- exact scalar, for example `code: 0`
- `exists`
- `not_empty`
- `type:string`
- `type:number`
- `type:boolean`
- `type:object`
- `type:array`
- `type:null`
- `regex:<pattern>`

JSON paths use `gjson` syntax:

```yaml
data.items.0.name: "rice"
data.water_daily.2026-05-14.total: type:number
```

Body contains:

```yaml
expect:
  body_contains:
    - "food_link"
```

## Route Smoke

`route_smoke.enabled: true` automatically generates one shallow smoke case for each registered Gin route.

Route smoke checks:

- the route does not panic
- the status code is in the configured allow-list
- `X-Trace-Id` is present

Route smoke does not prove business correctness. Add explicit `cases` for real API contracts.

Good use cases for route smoke:

- new route registration checks
- panic regression checks
- basic middleware coverage

Bad use cases for route smoke:

- business field validation
- permission boundary validation
- DB write verification
- detailed error code validation

## AI Agent Maintenance Rules

When an AI agent updates these tests:

1. Prefer changing only route-specific files under `backend/e2e-test/cases/`.
2. Change `backend/e2e-test/fixtures/base.sql` only when missing seed data blocks a case.
3. Change `backend/e2e-test/runner/` only when YAML cannot express the needed assertion or behavior.
4. Do not point tests at production databases, production users, or production object storage.
5. Use named users from `auth.users` for authenticated cases.
6. For write APIs, write only to the temporary database and seeded users.
7. For APIs that depend on external services, prefer testing auth, validation, and response shape in this MVP. Do not force real external calls unless the user explicitly asks.
8. After changes, run at least:

```bash
go test ./e2e-test/runner ./e2e-test/cmd/api-contract-test -run TestDoesNotExist -count=1
npm run test:backend:api-contract -- --timeout 5m
git diff --check
```

## Troubleshooting

### CREATE DATABASE fails

The configured PostgreSQL user likely lacks database creation permission. Use a local test DB user with `CREATE DATABASE` and `DROP DATABASE`. Do not use production.

### Keep a failed database

Run:

```bash
go run ./e2e-test/cmd/api-contract-test --case <case-id> --keep-db
```

The output prints the temp DB name. Delete it manually after inspection.

### A case unexpectedly returns 401

Check:

- Did the case omit `auth: user1`?
- Is the auth name defined under `auth.users`?
- Does the fixture create the matching `weapp_user` row?

### JSON path not found

Check:

- Is the response field under `data.xxx` or top-level?
- Is the array index correct, for example `data.items.0.name`?
- Does the field name match the JSON tag?

### Route smoke prints many 400 or 401 logs

This is expected. Route smoke sends generic query/body data to all routes. Routes that require auth or required fields often return 400 or 401. The important result is the final summary. `Failed: 0` means route smoke passed.

## Current Baseline

Current MVP baseline:

```text
Total: 161, Passed: 161, Failed: 0
```
