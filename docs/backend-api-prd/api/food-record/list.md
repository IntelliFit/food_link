---
route_path: "/api/food-record/list"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:7448"]
request_models: []
response_models: []
db_dependencies: ["get_analysis_tasks_by_ids", "list_food_records"]
worker_dependencies: []
external_dependencies: ["Supabase", "Supabase Storage"]
source_refs: ["backend/main.py:7448"]
---

# List

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/food-record/list` | `get_food_record_list` | `jwt_required` | `implicit` | `backend/main.py:7448` |

## Request Contract

- `GET /api/food-record/list`: None

## Response Contract

- `GET /api/food-record/list`: Implicit JSON/dict response

## Main Flow

- `GET /api/food-record/list`: reads/writes via `get_analysis_tasks_by_ids, list_food_records`; worker or async pipeline touchpoint: `analysis_tasks / worker queue`; local helper chain includes `_normalize_meal_type, _trace_add_event, _trace_record_error`

## Dependencies & Side Effects

- Database dependencies: get_analysis_tasks_by_ids, list_food_records
- Worker dependencies: None
- External dependencies: Supabase, Supabase Storage
- Local helper chain: _normalize_meal_type, _trace_add_event, _trace_record_error

## Data Reads/Writes

- This document touches database helpers: get_analysis_tasks_by_ids, list_food_records
- Async / worker-sensitive flow: Yes

## Error Cases

- `GET /api/food-record/list`: 500

## Frontend Usage

- `GET /api/food-record/list`: `miniapp-used`; callers: src/utils/api.ts:getFoodRecordList

## Migration Notes

- `GET /api/food-record/list`: preserve async task semantics and queue contract

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
