---
route_path: "/ws/stats/insight"
methods: ["WEBSOCKET"]
auth_type: ["public"]
frontend_usage: ["backend-only"]
handler_refs: ["backend/main.py:9016"]
request_models: []
response_models: []
db_dependencies: ["get_streak_days", "get_user_by_id", "list_food_records_by_range"]
worker_dependencies: []
external_dependencies: ["LLM Provider", "Supabase"]
source_refs: ["backend/main.py:9016"]
---

# Websocket Insight

## Purpose

Documents the backend-exposed WebSocket surface and its server-side generation flow.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `WEBSOCKET` | `/ws/stats/insight` | `ws_stats_insight` | `public` | `implicit` | `backend/main.py:9016` |

## Request Contract

- `WEBSOCKET /ws/stats/insight`: None

## Response Contract

- `WEBSOCKET /ws/stats/insight`: Implicit JSON/dict response

## Main Flow

- `WEBSOCKET /ws/stats/insight`: reads/writes via `get_streak_days, get_user_by_id, list_food_records_by_range`; local helper chain includes `_build_body_metrics_summary, _build_by_meal_calories, _generate_nutrition_insight`

## Dependencies & Side Effects

- Database dependencies: get_streak_days, get_user_by_id, list_food_records_by_range
- Worker dependencies: None
- External dependencies: LLM Provider, Supabase
- Local helper chain: _build_body_metrics_summary, _build_by_meal_calories, _generate_nutrition_insight

## Data Reads/Writes

- This document touches database helpers: get_streak_days, get_user_by_id, list_food_records_by_range
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `WEBSOCKET /ws/stats/insight`: No static `HTTPException(...)` status found; inspect handler branches manually.

## Frontend Usage

- `WEBSOCKET /ws/stats/insight`: `backend-only`; callers: No mini program caller found in current scan.

## Migration Notes

- `WEBSOCKET /ws/stats/insight`: current implementation uses query params instead of the shared JWT dependency

## Open Questions / Drift

- Current scan found no mini program caller for at least one route in this document; verify real operator/test caller before rewrite.
