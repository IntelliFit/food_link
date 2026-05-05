---
route_path: "/api/precision-sessions/{session_id}/continue"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:5536"]
request_models: ["ContinuePrecisionSessionRequest"]
response_models: []
db_dependencies: ["get_user_by_id"]
worker_dependencies: []
external_dependencies: ["Supabase", "Supabase Storage"]
source_refs: ["backend/main.py:5536"]
---

# Continue

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/precision-sessions/{session_id}/continue` | `continue_precision_session` | `jwt_required` | `implicit` | `backend/main.py:5536` |

## Request Contract

- `POST /api/precision-sessions/{session_id}/continue`: `ContinuePrecisionSessionRequest` (source_type, image_url, image_urls, text, date, additionalContext, meal_type, timezone_offset_minutes, province, city, district, diet_goal)

## Response Contract

- `POST /api/precision-sessions/{session_id}/continue`: Implicit JSON/dict response

## Main Flow

- `POST /api/precision-sessions/{session_id}/continue`: reads/writes via `get_user_by_id`; worker or async pipeline touchpoint: `analysis_tasks / worker queue`; local helper chain includes `_build_precision_continue_payload, _consume_earned_credits_after_success, _create_precision_plan_task_payload, _format_membership_response, _get_effective_membership, _get_food_task_type, _raise_analysis_related_schema_not_ready, _raise_precision_schema_not_ready`

## Dependencies & Side Effects

- Database dependencies: get_user_by_id
- Worker dependencies: None
- External dependencies: Supabase, Supabase Storage
- Local helper chain: _build_precision_continue_payload, _consume_earned_credits_after_success, _create_precision_plan_task_payload, _format_membership_response, _get_effective_membership, _get_food_task_type, _raise_analysis_related_schema_not_ready, _raise_precision_schema_not_ready, _resolve_recorded_on_date, _serialize_reference_objects, _validate_food_analysis_access

## Data Reads/Writes

- This document touches database helpers: get_user_by_id
- Async / worker-sensitive flow: Yes

## Error Cases

- `POST /api/precision-sessions/{session_id}/continue`: 400, 403, 404, 500

## Frontend Usage

- `POST /api/precision-sessions/{session_id}/continue`: `miniapp-used`; callers: src/utils/api.ts:continuePrecisionSession

## Migration Notes

- `POST /api/precision-sessions/{session_id}/continue`: preserve async task semantics and queue contract

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
