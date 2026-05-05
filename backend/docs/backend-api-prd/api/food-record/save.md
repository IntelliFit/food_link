---
route_path: "/api/food-record/save"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:7362"]
request_models: ["SaveFoodRecordRequest"]
response_models: []
db_dependencies: ["insert_food_record"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:7362"]
---

# Save

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/food-record/save` | `save_food_record` | `jwt_required` | `implicit` | `backend/main.py:7362` |

## Request Contract

- `POST /api/food-record/save`: `SaveFoodRecordRequest` (meal_type, image_path, image_paths, description, insight, items, total_calories, total_protein, total_carbs, total_fat, total_weight_grams, diet_goal)

## Response Contract

- `POST /api/food-record/save`: Implicit JSON/dict response

## Main Flow

- `POST /api/food-record/save`: reads/writes via `insert_food_record`; local helper chain includes `_build_record_time_for_recorded_on, _normalize_meal_type, _parse_date_string, _refresh_stats_insight_for_user, _resolve_recorded_on_date, _trace_add_event, _trace_record_error`

## Dependencies & Side Effects

- Database dependencies: insert_food_record
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _build_record_time_for_recorded_on, _normalize_meal_type, _parse_date_string, _refresh_stats_insight_for_user, _resolve_recorded_on_date, _trace_add_event, _trace_record_error

## Data Reads/Writes

- This document touches database helpers: insert_food_record
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/food-record/save`: 400, 500

## Frontend Usage

- `POST /api/food-record/save`: `miniapp-used`; callers: src/utils/api.ts:saveFoodRecord

## Migration Notes

- `POST /api/food-record/save`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
