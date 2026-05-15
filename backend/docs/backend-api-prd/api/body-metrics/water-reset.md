---
route_path: "/api/body-metrics/water/reset"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:7733"]
request_models: ["BodyWaterResetRequest"]
response_models: []
db_dependencies: ["delete_user_water_logs_by_date"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:7733"]
---

# Water Reset

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/body-metrics/water/reset` | `reset_body_water_logs` | `jwt_required` | `implicit` | `backend/main.py:7733` |

## Request Contract

- `POST /api/body-metrics/water/reset`: `BodyWaterResetRequest` (date)

## Response Contract

- `POST /api/body-metrics/water/reset`: Implicit JSON/dict response

## Main Flow

- `POST /api/body-metrics/water/reset`: reads/writes via `delete_user_water_logs_by_date`; local helper chain includes `_parse_date_string`

## Dependencies & Side Effects

- Database dependencies: delete_user_water_logs_by_date
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _parse_date_string

## Data Reads/Writes

- This document touches database helpers: delete_user_water_logs_by_date
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/body-metrics/water/reset`: 500

## Frontend Usage

- `POST /api/body-metrics/water/reset`: `miniapp-used`; callers: src/utils/api.ts:resetBodyWaterLogs

## Migration Notes

- `POST /api/body-metrics/water/reset`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
