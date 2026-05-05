---
route_path: "/api/home/dashboard"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:8310"]
request_models: []
response_models: []
db_dependencies: ["get_exercise_calories_by_date", "get_user_by_id", "list_food_expiry_items_v2", "list_food_records"]
worker_dependencies: []
external_dependencies: ["Supabase", "Supabase Storage"]
source_refs: ["backend/main.py:8310"]
---

# Dashboard

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/home/dashboard` | `get_home_dashboard` | `jwt_required` | `implicit` | `backend/main.py:8310` |

## Request Contract

- `GET /api/home/dashboard`: None

## Response Contract

- `GET /api/home/dashboard`: Implicit JSON/dict response

## Main Flow

- `GET /api/home/dashboard`: reads/writes via `get_exercise_calories_by_date, get_user_by_id, list_food_expiry_items_v2, list_food_records`; local helper chain includes `_build_dashboard_meal_targets, _build_food_expiry_summary, _format_china_time_hhmm, _get_china_today_str, _get_dashboard_targets, _normalize_food_expiry_item, _normalize_meal_type`

## Dependencies & Side Effects

- Database dependencies: get_exercise_calories_by_date, get_user_by_id, list_food_expiry_items_v2, list_food_records
- Worker dependencies: None
- External dependencies: Supabase, Supabase Storage
- Local helper chain: _build_dashboard_meal_targets, _build_food_expiry_summary, _format_china_time_hhmm, _get_china_today_str, _get_dashboard_targets, _normalize_food_expiry_item, _normalize_meal_type

## Data Reads/Writes

- This document touches database helpers: get_exercise_calories_by_date, get_user_by_id, list_food_expiry_items_v2, list_food_records
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/home/dashboard`: 500

## Frontend Usage

- `GET /api/home/dashboard`: `miniapp-used`; callers: src/utils/api.ts:getHomeDashboard

## Migration Notes

- `GET /api/home/dashboard`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
