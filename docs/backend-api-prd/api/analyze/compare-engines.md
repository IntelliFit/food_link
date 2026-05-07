---
route_path: "/api/analyze-compare-engines"
methods: ["POST"]
auth_type: ["jwt_optional"]
frontend_usage: ["backend-only"]
handler_refs: ["backend/main.py:4967"]
request_models: ["AnalyzeRequest"]
response_models: ["CompareAnalyzeEnginesResponse"]
db_dependencies: ["get_user_by_id"]
worker_dependencies: []
external_dependencies: ["Supabase", "Supabase Storage"]
source_refs: ["backend/main.py:4967"]
---

# Compare Engines

## Purpose

Covers food analysis submission, task lookup, and result mutation behavior used by the mini program and worker pipeline.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/analyze-compare-engines` | `analyze_food_compare_engines` | `jwt_optional` | `CompareAnalyzeEnginesResponse` | `backend/main.py:4967` |

## Request Contract

- `POST /api/analyze-compare-engines`: `AnalyzeRequest` (base64Image, base64Image, image_url, image_urls, additionalContext, modelName, modelNames, user_goal, diet_goal, activity_timing, remaining_calories, meal_type)

## Response Contract

- `POST /api/analyze-compare-engines`: CompareAnalyzeEnginesResponse

## Main Flow

- `POST /api/analyze-compare-engines`: reads/writes via `get_user_by_id`; local helper chain includes `CompareAnalyzeEnginesModelGroup, CompareAnalyzeEnginesResponse, _format_health_risk_summary_for_analysis, _meal_name, _normalize_execution_mode, _parse_execution_mode_or_raise, _resolve_food_vision_model_config, _run_engine_compare_once`

## Dependencies & Side Effects

- Database dependencies: get_user_by_id
- Worker dependencies: None
- External dependencies: Supabase, Supabase Storage
- Local helper chain: CompareAnalyzeEnginesModelGroup, CompareAnalyzeEnginesResponse, _format_health_risk_summary_for_analysis, _meal_name, _normalize_execution_mode, _parse_execution_mode_or_raise, _resolve_food_vision_model_config, _run_engine_compare_once

## Data Reads/Writes

- This document touches database helpers: get_user_by_id
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/analyze-compare-engines`: 400

## Frontend Usage

- `POST /api/analyze-compare-engines`: `backend-only`; callers: No mini program caller found in current scan.

## Migration Notes

- `POST /api/analyze-compare-engines`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- Current scan found no mini program caller for at least one route in this document; verify real operator/test caller before rewrite.
