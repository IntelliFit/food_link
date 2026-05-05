        ---
        route_path: "/api/test-backend/batch/prepare, /api/test-backend/batch/start, /api/test-backend/batch/{batch_id}"
        methods: ["GET", "POST"]
        auth_type: ["test_backend_cookie"]
        frontend_usage: ["internal-only"]
        handler_refs: ["backend/main.py:11817", "backend/main.py:11897", "backend/main.py:11934"]
        request_models: []
        response_models: []
        db_dependencies: []
        worker_dependencies: []
        external_dependencies: []
        source_refs: ["backend/main.py:11817", "backend/main.py:11897", "backend/main.py:11934"]
        ---

        # Batches

        ## Purpose

        Covers internal test-backend routes used by the backend-only evaluation console.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `POST` | `/api/test-backend/batch/prepare` | `test_backend_batch_prepare` | `test_backend_cookie` | `implicit` | `backend/main.py:11817` |
| `POST` | `/api/test-backend/batch/start` | `test_backend_batch_start` | `test_backend_cookie` | `implicit` | `backend/main.py:11897` |
| `GET` | `/api/test-backend/batch/{batch_id}` | `test_backend_batch_status` | `test_backend_cookie` | `implicit` | `backend/main.py:11934` |

        ## Request Contract

        - `POST /api/test-backend/batch/prepare`: None
- `POST /api/test-backend/batch/start`: None
- `GET /api/test-backend/batch/{batch_id}`: None

        ## Response Contract

        - `POST /api/test-backend/batch/prepare`: Implicit JSON/dict response
- `POST /api/test-backend/batch/start`: Implicit JSON/dict response
- `GET /api/test-backend/batch/{batch_id}`: Implicit JSON/dict response

        ## Main Flow

        - `POST /api/test-backend/batch/prepare`: local helper chain includes `_get_test_processors, _infer_test_backend_label_mode, _serialize_test_backend_batch`
- `POST /api/test-backend/batch/start`: local helper chain includes `_parse_test_backend_models, _parse_test_backend_prompt_ids, _process_test_backend_batch, _resolve_test_backend_analysis_modes, _serialize_test_backend_batch`
- `GET /api/test-backend/batch/{batch_id}`: local helper chain includes `_serialize_test_backend_batch`

        ## Dependencies & Side Effects

        - Database dependencies: None
        - Worker dependencies: None
        - External dependencies: None
        - Local helper chain: _get_test_processors, _infer_test_backend_label_mode, _parse_test_backend_models, _parse_test_backend_prompt_ids, _process_test_backend_batch, _resolve_test_backend_analysis_modes, _serialize_test_backend_batch

        ## Data Reads/Writes

        - This document touches database helpers: None
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `POST /api/test-backend/batch/prepare`: 400
- `POST /api/test-backend/batch/start`: 404
- `GET /api/test-backend/batch/{batch_id}`: 404

        ## Frontend Usage

        - `POST /api/test-backend/batch/prepare`: `internal-only`; callers: No mini program caller found in current scan.
- `POST /api/test-backend/batch/start`: `internal-only`; callers: No mini program caller found in current scan.
- `GET /api/test-backend/batch/{batch_id}`: `internal-only`; callers: No mini program caller found in current scan.

        ## Migration Notes

        - `POST /api/test-backend/batch/prepare`: cookie-based test backend auth should not be merged into JWT auth by accident
- `POST /api/test-backend/batch/start`: cookie-based test backend auth should not be merged into JWT auth by accident
- `GET /api/test-backend/batch/{batch_id}`: cookie-based test backend auth should not be merged into JWT auth by accident

        ## Open Questions / Drift

        - Internal/test-backend routes should likely remain isolated from the public business API surface in the rewrite.
