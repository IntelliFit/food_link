---
route_path: "/api/exercise-logs/estimate-calories"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:12398"]
request_models: ["ExerciseCaloriesEstimateRequest"]
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: ["LLM Provider"]
source_refs: ["backend/main.py:12398"]
---

# Estimate Calories

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/exercise-logs/estimate-calories` | `estimate_exercise_calories` | `jwt_required` | `implicit` | `backend/main.py:12398` |

## Request Contract

- `POST /api/exercise-logs/estimate-calories`: `ExerciseCaloriesEstimateRequest` (exercise_desc)

## Response Contract

- `POST /api/exercise-logs/estimate-calories`: Implicit JSON/dict response

## Main Flow

- `POST /api/exercise-logs/estimate-calories`: local helper chain includes `_build_exercise_profile_snapshot, _estimate_exercise_calories_llm`

## Dependencies & Side Effects

- Database dependencies: None
- Worker dependencies: None
- External dependencies: LLM Provider
- Local helper chain: _build_exercise_profile_snapshot, _estimate_exercise_calories_llm

## Data Reads/Writes

- This document touches database helpers: None
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/exercise-logs/estimate-calories`: 500

## Frontend Usage

- `POST /api/exercise-logs/estimate-calories`: `miniapp-used`; callers: src/utils/api.ts:estimateExerciseCalories

## Migration Notes

- `POST /api/exercise-logs/estimate-calories`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
