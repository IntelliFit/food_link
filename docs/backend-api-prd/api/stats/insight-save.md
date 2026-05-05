---
route_path: "/api/stats/insight/save"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:8837"]
request_models: ["StatsInsightSaveRequest"]
response_models: []
db_dependencies: ["list_food_records_by_range", "upsert_insight_cache"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:8837"]
---

# Insight Save

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/stats/insight/save` | `save_stats_insight` | `jwt_required` | `implicit` | `backend/main.py:8837` |

## Request Contract

- `POST /api/stats/insight/save`: `StatsInsightSaveRequest` (range, analysis_summary)

## Response Contract

- `POST /api/stats/insight/save`: Implicit JSON/dict response

## Main Flow

- `POST /api/stats/insight/save`: reads/writes via `list_food_records_by_range, upsert_insight_cache`

## Dependencies & Side Effects

- Database dependencies: list_food_records_by_range, upsert_insight_cache
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: list_food_records_by_range, upsert_insight_cache
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/stats/insight/save`: 400, 500

## Frontend Usage

- `POST /api/stats/insight/save`: `miniapp-used`; callers: src/utils/api.ts:saveStatsInsight

## Migration Notes

- `POST /api/stats/insight/save`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
