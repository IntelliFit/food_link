---
route_path: "/api/stats/insight/generate"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:8744"]
request_models: ["StatsInsightGenerateRequest"]
response_models: []
db_dependencies: ["get_streak_days", "get_user_by_id", "list_food_records_by_range"]
worker_dependencies: []
external_dependencies: ["LLM Provider", "Supabase"]
source_refs: ["backend/main.py:8744"]
---

# Insight Generate

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/stats/insight/generate` | `generate_stats_insight` | `jwt_required` | `implicit` | `backend/main.py:8744` |

## Request Contract

- `POST /api/stats/insight/generate`: `StatsInsightGenerateRequest` (range)

## Response Contract

- `POST /api/stats/insight/generate`: Implicit JSON/dict response

## Main Flow

- `POST /api/stats/insight/generate`: reads/writes via `get_streak_days, get_user_by_id, list_food_records_by_range`; local helper chain includes `_build_body_metrics_summary, _build_by_meal_calories, _generate_nutrition_insight`

## Dependencies & Side Effects

- Database dependencies: get_streak_days, get_user_by_id, list_food_records_by_range
- Worker dependencies: None
- External dependencies: LLM Provider, Supabase
- Local helper chain: _build_body_metrics_summary, _build_by_meal_calories, _generate_nutrition_insight

## Data Reads/Writes

- This document touches database helpers: get_streak_days, get_user_by_id, list_food_records_by_range
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/stats/insight/generate`: 500

## Frontend Usage

- `POST /api/stats/insight/generate`: `miniapp-used`; callers: src/utils/api.ts:generateStatsInsight

## Migration Notes

- `POST /api/stats/insight/generate`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
