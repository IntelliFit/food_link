---
route_path: "/api/user/record-days"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:6159"]
request_models: []
response_models: []
db_dependencies: ["list_food_records"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:6159"]
---

# Record Days

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/user/record-days` | `get_user_record_days` | `jwt_required` | `implicit` | `backend/main.py:6159` |

## Request Contract

- `GET /api/user/record-days`: None

## Response Contract

- `GET /api/user/record-days`: Implicit JSON/dict response

## Main Flow

- `GET /api/user/record-days`: reads/writes via `list_food_records`

## Dependencies & Side Effects

- Database dependencies: list_food_records
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: list_food_records
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/user/record-days`: 500

## Frontend Usage

- `GET /api/user/record-days`: `miniapp-used`; callers: src/utils/api.ts:getUserRecordDays

## Migration Notes

- `GET /api/user/record-days`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
