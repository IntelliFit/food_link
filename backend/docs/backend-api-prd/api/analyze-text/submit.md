---
route_path: "/api/analyze-text/submit"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:5318"]
request_models: ["AnalyzeTextSubmitRequest"]
response_models: []
db_dependencies: ["get_user_by_id"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:5318"]
---

# Submit

## Purpose

Covers food analysis submission, task lookup, and result mutation behavior used by the mini program and worker pipeline.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/analyze-text/submit` | `analyze_text_submit` | `jwt_required` | `implicit` | `backend/main.py:5318` |

## Request Contract

- `POST /api/analyze-text/submit`: `AnalyzeTextSubmitRequest` (text, meal_type, timezone_offset_minutes, province, city, district, diet_goal, activity_timing, user_goal, remaining_calories, additionalContext, execution_mode)

## Response Contract

- `POST /api/analyze-text/submit`: Implicit JSON/dict response

## Main Flow

- `POST /api/analyze-text/submit`: reads/writes via `get_user_by_id`; worker or async pipeline touchpoint: `analysis_tasks / worker queue`; local helper chain includes `_build_precision_continue_payload, _consume_earned_credits_after_success, _create_precision_plan_task_payload, _debug_log_food_submit, _format_membership_response, _get_effective_membership, _get_food_analysis_credit_cost, _get_food_task_type`

## Dependencies & Side Effects

- Database dependencies: get_user_by_id
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _build_precision_continue_payload, _consume_earned_credits_after_success, _create_precision_plan_task_payload, _debug_log_food_submit, _format_membership_response, _get_effective_membership, _get_food_analysis_credit_cost, _get_food_task_type, _normalize_execution_mode, _parse_analysis_engine_or_raise, _parse_execution_mode_or_raise, _raise_analysis_related_schema_not_ready, _raise_precision_schema_not_ready, _resolve_recorded_on_date, _serialize_reference_objects, _validate_food_analysis_access

## Data Reads/Writes

- This document touches database helpers: get_user_by_id
- Async / worker-sensitive flow: Yes

## Error Cases

- `POST /api/analyze-text/submit`: 400, 403, 404, 500

## Frontend Usage

- `POST /api/analyze-text/submit`: `miniapp-used`; callers: src/utils/api.ts:submitTextAnalyzeTask

## Migration Notes

- `POST /api/analyze-text/submit`: preserve async task semantics and queue contract

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
