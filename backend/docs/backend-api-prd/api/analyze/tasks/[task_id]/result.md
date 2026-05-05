---
route_path: "/api/analyze/tasks/{task_id}/result"
methods: ["PATCH"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:4703"]
request_models: ["UpdateAnalysisResultRequest"]
response_models: []
db_dependencies: ["update_analysis_task_result"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:4703"]
---

# Result

## Purpose

Covers food analysis submission, task lookup, and result mutation behavior used by the mini program and worker pipeline.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `PATCH` | `/api/analyze/tasks/{task_id}/result` | `update_task_result` | `jwt_required` | `implicit` | `backend/main.py:4703` |

## Request Contract

- `PATCH /api/analyze/tasks/{task_id}/result`: `UpdateAnalysisResultRequest` (result)

## Response Contract

- `PATCH /api/analyze/tasks/{task_id}/result`: Implicit JSON/dict response

## Main Flow

- `PATCH /api/analyze/tasks/{task_id}/result`: reads/writes via `update_analysis_task_result`

## Dependencies & Side Effects

- Database dependencies: update_analysis_task_result
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: update_analysis_task_result
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `PATCH /api/analyze/tasks/{task_id}/result`: 403, 404, 500

## Frontend Usage

- `PATCH /api/analyze/tasks/{task_id}/result`: `miniapp-used`; callers: src/utils/api.ts:updateAnalysisTaskResult

## Migration Notes

- `PATCH /api/analyze/tasks/{task_id}/result`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
