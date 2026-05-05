---
route_path: "/api/analyze-compare"
methods: ["POST"]
auth_type: ["jwt_optional"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:4788"]
request_models: ["AnalyzeRequest"]
response_models: ["CompareAnalyzeResponse"]
db_dependencies: ["get_user_by_id"]
worker_dependencies: []
external_dependencies: ["LLM Provider", "Supabase", "Supabase Storage"]
source_refs: ["backend/main.py:4788"]
---

# Compare

## Purpose

Covers food analysis submission, task lookup, and result mutation behavior used by the mini program and worker pipeline.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/analyze-compare` | `analyze_food_compare` | `jwt_optional` | `CompareAnalyzeResponse` | `backend/main.py:4788` |

## Request Contract

- `POST /api/analyze-compare`: `AnalyzeRequest` (base64Image, base64Image, image_url, image_urls, additionalContext, modelName, modelNames, user_goal, diet_goal, activity_timing, remaining_calories, meal_type)

## Response Contract

- `POST /api/analyze-compare`: CompareAnalyzeResponse

## Main Flow

- `POST /api/analyze-compare`: reads/writes via `get_user_by_id`; local helper chain includes `CompareAnalyzeResponse, ModelAnalyzeResult, _analyze_with_gemini, _analyze_with_qwen, _build_execution_mode_hint, _build_gemini_prompt, _format_health_profile_for_analysis, _format_health_risk_summary_for_analysis`

## Dependencies & Side Effects

- Database dependencies: get_user_by_id
- Worker dependencies: None
- External dependencies: LLM Provider, Supabase, Supabase Storage
- Local helper chain: CompareAnalyzeResponse, ModelAnalyzeResult, _analyze_with_gemini, _analyze_with_qwen, _build_execution_mode_hint, _build_gemini_prompt, _format_health_profile_for_analysis, _format_health_risk_summary_for_analysis, _meal_name, _normalize_execution_mode, _parse_analyze_result, _parse_execution_mode_or_raise, _strip_standard_mode_extras

## Data Reads/Writes

- This document touches database helpers: get_user_by_id
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/analyze-compare`: 400

## Frontend Usage

- `POST /api/analyze-compare`: `miniapp-used`; callers: src/utils/api.ts:analyzeFoodImageCompare

## Migration Notes

- `POST /api/analyze-compare`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
