---
route_path: "/api/food-record/share/{record_id}"
methods: ["GET"]
auth_type: ["public"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:8219"]
request_models: []
response_models: []
db_dependencies: ["get_food_record_by_id", "get_user_by_id"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:8219"]
---

# Record_Id

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/food-record/share/{record_id}` | `get_shared_food_record` | `public` | `implicit` | `backend/main.py:8219` |

## Request Contract

- `GET /api/food-record/share/{record_id}`: None

## Response Contract

- `GET /api/food-record/share/{record_id}`: Implicit JSON/dict response

## Main Flow

- `GET /api/food-record/share/{record_id}`: reads/writes via `get_food_record_by_id, get_user_by_id`; local helper chain includes `_hydrate_food_record_image_paths, _normalize_meal_type`

## Dependencies & Side Effects

- Database dependencies: get_food_record_by_id, get_user_by_id
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _hydrate_food_record_image_paths, _normalize_meal_type

## Data Reads/Writes

- This document touches database helpers: get_food_record_by_id, get_user_by_id
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/food-record/share/{record_id}`: 403, 404, 500

## Frontend Usage

- `GET /api/food-record/share/{record_id}`: `miniapp-used`; callers: src/utils/api.ts:getSharedFoodRecord

## Migration Notes

- `GET /api/food-record/share/{record_id}`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
