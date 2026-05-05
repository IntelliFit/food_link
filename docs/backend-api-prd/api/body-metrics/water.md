---
route_path: "/api/body-metrics/water"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:7703"]
request_models: ["BodyWaterLogRequest"]
response_models: []
db_dependencies: ["create_user_water_log"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:7703"]
---

# Water

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/body-metrics/water` | `save_body_water_log` | `jwt_required` | `implicit` | `backend/main.py:7703` |

## Request Contract

- `POST /api/body-metrics/water`: `BodyWaterLogRequest` (amount_ml, date, source_type)

## Response Contract

- `POST /api/body-metrics/water`: Implicit JSON/dict response

## Main Flow

- `POST /api/body-metrics/water`: reads/writes via `create_user_water_log`; local helper chain includes `_normalize_body_metric_source_type, _parse_date_string`

## Dependencies & Side Effects

- Database dependencies: create_user_water_log
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _normalize_body_metric_source_type, _parse_date_string

## Data Reads/Writes

- This document touches database helpers: create_user_water_log
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/body-metrics/water`: 500

## Frontend Usage

- `POST /api/body-metrics/water`: `miniapp-used`; callers: src/utils/api.ts:addBodyWaterLog

## Migration Notes

- `POST /api/body-metrics/water`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
