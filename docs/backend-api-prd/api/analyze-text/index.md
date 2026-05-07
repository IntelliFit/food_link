---
route_path: "/api/analyze-text"
methods: ["POST"]
auth_type: ["jwt_optional"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:5119"]
request_models: ["AnalyzeTextRequest"]
response_models: ["AnalyzeResponse"]
db_dependencies: ["get_user_by_id"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:5119"]
---

# Index

## Purpose

Covers food analysis submission, task lookup, and result mutation behavior used by the mini program and worker pipeline.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/analyze-text` | `analyze_food_text` | `jwt_optional` | `AnalyzeResponse` | `backend/main.py:5119` |

## Request Contract

- `POST /api/analyze-text`: `AnalyzeTextRequest` (text, user_goal, remaining_calories, diet_goal, activity_timing, analysis_engine)

## Response Contract

- `POST /api/analyze-text`: AnalyzeResponse

## Main Flow

- `POST /api/analyze-text`: reads/writes via `get_user_by_id`; local helper chain includes `AnalyzeResponse, FoodItemResponse, _format_health_profile_for_analysis, _format_membership_response, _get_effective_membership, _normalize_execution_mode, _parse_analysis_engine_or_raise, _strip_standard_mode_extras`

## Dependencies & Side Effects

- Database dependencies: get_user_by_id
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: AnalyzeResponse, FoodItemResponse, _format_health_profile_for_analysis, _format_membership_response, _get_effective_membership, _normalize_execution_mode, _parse_analysis_engine_or_raise, _strip_standard_mode_extras, _validate_food_analysis_access

## Data Reads/Writes

- This document touches database helpers: get_user_by_id
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/analyze-text`: 400, 500

## Frontend Usage

- `POST /api/analyze-text`: `miniapp-used`; callers: src/utils/api.ts:analyzeFoodText

## Migration Notes

- `POST /api/analyze-text`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
