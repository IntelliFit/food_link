---
route_path: "/api/test-backend/analyze"
methods: ["POST"]
auth_type: ["test_backend_cookie"]
frontend_usage: ["internal-only"]
handler_refs: ["backend/main.py:11645"]
request_models: []
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: ["Supabase Storage"]
source_refs: ["backend/main.py:11645"]
---

# Analyze

## Purpose

Covers internal test-backend routes used by the backend-only evaluation console.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/test-backend/analyze` | `test_backend_analyze` | `test_backend_cookie` | `implicit` | `backend/main.py:11645` |

## Request Contract

- `POST /api/test-backend/analyze`: None

## Response Contract

- `POST /api/test-backend/analyze`: Implicit JSON/dict response

## Main Flow

- `POST /api/test-backend/analyze`: local helper chain includes `_infer_test_backend_label_mode, _parse_expected_items_input, _parse_test_backend_models, _parse_test_backend_prompt_ids, _resolve_test_backend_analysis_modes, _run_test_backend_multi_model_analysis, _upload_test_backend_images`

## Dependencies & Side Effects

- Database dependencies: None
- Worker dependencies: None
- External dependencies: Supabase Storage
- Local helper chain: _infer_test_backend_label_mode, _parse_expected_items_input, _parse_test_backend_models, _parse_test_backend_prompt_ids, _resolve_test_backend_analysis_modes, _run_test_backend_multi_model_analysis, _upload_test_backend_images

## Data Reads/Writes

- This document touches database helpers: None
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/test-backend/analyze`: 400, 500

## Frontend Usage

- `POST /api/test-backend/analyze`: `internal-only`; callers: No mini program caller found in current scan.

## Migration Notes

- `POST /api/test-backend/analyze`: cookie-based test backend auth should not be merged into JWT auth by accident

## Open Questions / Drift

- Internal/test-backend routes should likely remain isolated from the public business API surface in the rewrite.
