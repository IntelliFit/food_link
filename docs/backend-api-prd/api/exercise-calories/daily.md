---
route_path: "/api/exercise-calories/daily"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:8484"]
request_models: []
response_models: []
db_dependencies: ["get_exercise_calories_by_date"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:8484"]
---

# Daily

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/exercise-calories/daily` | `get_exercise_calories_daily` | `jwt_required` | `implicit` | `backend/main.py:8484` |

## Request Contract

- `GET /api/exercise-calories/daily`: None

## Response Contract

- `GET /api/exercise-calories/daily`: Implicit JSON/dict response

## Main Flow

- `GET /api/exercise-calories/daily`: reads/writes via `get_exercise_calories_by_date`; local helper chain includes `_parse_date_string`

## Dependencies & Side Effects

- Database dependencies: get_exercise_calories_by_date
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _parse_date_string

## Data Reads/Writes

- This document touches database helpers: get_exercise_calories_by_date
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/exercise-calories/daily`: No static `HTTPException(...)` status found; inspect handler branches manually.

## Frontend Usage

- `GET /api/exercise-calories/daily`: `miniapp-used`; callers: src/utils/api.ts:getExerciseDailyCalories

## Migration Notes

- `GET /api/exercise-calories/daily`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
