---
route_path: "/api/food-record/{record_id}/poster-calorie-compare"
methods: ["GET"]
auth_type: ["unknown-from-frontend", "likely-jwt_required"]
frontend_usage: ["frontend-missing-backend"]
handler_refs: []
request_models: []
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: []
source_refs: ["src/utils/api.ts:2107"]
---

# Poster Calorie Compare Gap

## Purpose

Records the current drift where the mini program calls a poster calorie compare endpoint, but no matching FastAPI route was found in `backend/main.py`.

## Route Matrix

| Method | Path | Backend Exists | Frontend Caller |
| --- | --- | --- | --- |
| `GET` | `/api/food-record/{record_id}/poster-calorie-compare` | no | `src/utils/api.ts:getPosterCalorieCompare` |

## Request Contract

- Frontend builds the path dynamically from `recordId`.
- Frontend includes Bearer auth when a token exists.

## Response Contract

- Frontend expects either a structured compare payload or `null` on non-200.
- Exact backend contract is currently missing from the live codebase.

## Main Flow

- Current state is a route drift rather than an implemented flow.

## Dependencies & Side Effects

- Expected to depend on record data plus dashboard target logic.

## Data Reads/Writes

- No current backend implementation found to confirm read/write behavior.

## Error Cases

- Current practical failure mode is “route missing / unmatched implementation”.

## Frontend Usage

- Caller: `src/utils/api.ts:getPosterCalorieCompare`
- Status: `frontend-missing-backend`

## Migration Notes

- Decide during rewrite whether to implement this endpoint or remove the frontend feature path.

## Open Questions / Drift

- Was this endpoint removed from the backend and left in the client, or is it expected but never implemented?
