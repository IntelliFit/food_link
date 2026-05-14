# API Contract Test MVP

This project has a YAML-driven backend API contract runner.

Full human/AI-readable guide: `../../docs/backend-api-e2e-contract-tests.md`.

## Run

From `backend/`:

```bash
go run ./cmd/api-contract-test --suite testdata/api-contract/suite.yaml --all
```

Or from the repository root:

```bash
npm run test:backend:api-contract
```

The command accepts:

```bash
go run ./cmd/api-contract-test --list
go run ./cmd/api-contract-test --case user.profile.success
go run ./cmd/api-contract-test --group health
go run ./cmd/api-contract-test --keep-db
```

`--keep-db` leaves the temporary database behind for debugging.

## Database Isolation

By default the runner:

1. loads `config.yaml`;
2. connects to the configured PostgreSQL server, using `temp_db.admin_database` as the maintenance database;
3. creates a new database named `food_link_e2e_<timestamp>`;
4. runs the existing Go AutoMigrate;
5. applies SQL fixtures from `seed_sql`;
6. builds the real Gin app with worker and OTel disabled;
7. executes cases through `httpexpect` against the in-process router;
8. drops the temp database.

The configured PostgreSQL user must have permission to `CREATE DATABASE` and `DROP DATABASE`.

## Adding Cases

Edit `backend/testdata/api-contract/suite.yaml`.

Example:

```yaml
- name: user.profile.success
  group: user
  method: GET
  path: /api/user/profile
  auth: user1
  expect:
    status: 200
    headers:
      X-Trace-Id: not_empty
    json:
      code: 0
      data.nickname: "E2E User"
      data.avatar: type:string
```

`auth: user1` signs a JWT from the named user under `auth.users`. Unknown auth names fail the case so typos are not silently treated as anonymous requests.

Supported expectation values:

- exact scalar: `code: 0`
- `exists`
- `not_empty`
- `type:string`, `type:number`, `type:boolean`, `type:object`, `type:array`, `type:null`
- `regex:<pattern>`

JSON paths use `gjson` syntax, for example `data.items.0.name` or `data.water_daily.2026-05-14.total`.

## Route Smoke

`route_smoke.enabled: true` automatically creates a basic smoke case for every registered Gin route. It checks that each route is reachable without panicking and that `X-Trace-Id` is present. Detailed behavior contracts should still be added as explicit cases.
