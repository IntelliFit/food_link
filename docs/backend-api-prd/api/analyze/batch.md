---
route_path: "/api/analyze/batch"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:3983"]
request_models: ["AnalyzeBatchRequest"]
response_models: ["AnalyzeBatchResponse"]
db_dependencies: ["get_user_by_id"]
worker_dependencies: []
external_dependencies: ["Supabase", "Supabase Storage"]
source_refs: ["backend/main.py:3983"]
---

# Batch

## Purpose

Covers food analysis submission, task lookup, and result mutation behavior used by the mini program and worker pipeline.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/analyze/batch` | `analyze_batch` | `jwt_required` | `AnalyzeBatchResponse` | `backend/main.py:3983` |

## Request Contract

- `POST /api/analyze/batch`: `AnalyzeBatchRequest` (image_urls, meal_type, timezone_offset_minutes, diet_goal, activity_timing, user_goal, remaining_calories, additionalContext, modelName, execution_mode, reference_objects)

## Response Contract

- `POST /api/analyze/batch`: AnalyzeBatchResponse

## Main Flow

- `POST /api/analyze/batch`: reads/writes via `get_user_by_id`; worker or async pipeline touchpoint: `analysis_tasks / worker queue`; local helper chain includes `AnalyzeBatchResponse, AnalyzeResponse, _analyze_single_image_for_batch, _build_execution_mode_hint, _build_gemini_prompt, _format_health_profile_for_analysis, _format_health_risk_summary_for_analysis, _format_membership_response`

## Dependencies & Side Effects

- Database dependencies: get_user_by_id
- Worker dependencies: None
- External dependencies: Supabase, Supabase Storage
- Local helper chain: AnalyzeBatchResponse, AnalyzeResponse, _analyze_single_image_for_batch, _build_execution_mode_hint, _build_gemini_prompt, _format_health_profile_for_analysis, _format_health_risk_summary_for_analysis, _format_membership_response, _get_effective_membership, _meal_name, _merge_batch_results, _normalize_execution_mode, _parse_execution_mode_or_raise, _parse_food_item_responses, _resolve_food_vision_model_config, _serialize_reference_objects, _strip_standard_mode_extras, _validate_food_analysis_access

## Data Reads/Writes

- This document touches database helpers: get_user_by_id
- Async / worker-sensitive flow: Yes

## Error Cases

- `POST /api/analyze/batch`: 400, 500

## Frontend Usage

- `POST /api/analyze/batch`: `miniapp-used`; callers: src/utils/api.ts:submitAnalyzeBatch

## Migration Notes

- `POST /api/analyze/batch`: preserve async task semantics and queue contract

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
