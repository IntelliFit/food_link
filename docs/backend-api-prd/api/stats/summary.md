---
route_path: "/api/stats/summary"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:8621"]
request_models: []
response_models: []
db_dependencies: ["get_cached_insight", "get_latest_cached_insight", "get_streak_days", "get_user_by_id", "list_food_records_by_range"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:8621"]
---

# Summary

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/stats/summary` | `get_stats_summary` | `jwt_required` | `implicit` | `backend/main.py:8621` |

## Request Contract

- `GET /api/stats/summary`: None

## Response Contract

- `GET /api/stats/summary`: Implicit JSON/dict response

## Main Flow

- `GET /api/stats/summary`: reads/writes via `get_cached_insight, get_latest_cached_insight, get_streak_days, get_user_by_id, list_food_records_by_range`; local helper chain includes `_build_body_metrics_summary, _build_by_meal_calories, _empty_body_metrics_summary, _resolve_stats_range_dates`

## Dependencies & Side Effects

- Database dependencies: get_cached_insight, get_latest_cached_insight, get_streak_days, get_user_by_id, list_food_records_by_range
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _build_body_metrics_summary, _build_by_meal_calories, _empty_body_metrics_summary, _resolve_stats_range_dates

## Data Reads/Writes

- This document touches database helpers: get_cached_insight, get_latest_cached_insight, get_streak_days, get_user_by_id, list_food_records_by_range
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/stats/summary`: 500

## Frontend Usage

- `GET /api/stats/summary`: `miniapp-used`; callers: src/utils/api.ts:getStatsSummary

## Migration Notes

- `GET /api/stats/summary`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
