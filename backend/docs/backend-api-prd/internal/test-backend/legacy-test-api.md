        ---
        route_path: "/api/test/batch-upload, /api/test/single-image"
        methods: ["POST"]
        auth_type: ["test_backend_cookie"]
        frontend_usage: ["internal-only"]
        handler_refs: ["backend/main.py:11946", "backend/main.py:11985"]
        request_models: []
        response_models: []
        db_dependencies: []
        worker_dependencies: []
        external_dependencies: []
        source_refs: ["backend/main.py:11946", "backend/main.py:11985"]
        ---

        # Legacy Test Api

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `POST` | `/api/test/batch-upload` | `test_batch_upload` | `test_backend_cookie` | `implicit` | `backend/main.py:11946` |
| `POST` | `/api/test/single-image` | `test_single_image` | `test_backend_cookie` | `implicit` | `backend/main.py:11985` |

        ## Request Contract

        - `POST /api/test/batch-upload`: None
- `POST /api/test/single-image`: None

        ## Response Contract

        - `POST /api/test/batch-upload`: Implicit JSON/dict response
- `POST /api/test/single-image`: Implicit JSON/dict response

        ## Main Flow

        - `POST /api/test/batch-upload`: local helper chain includes `_get_test_processors`
- `POST /api/test/single-image`: local helper chain includes `_get_test_processors`

        ## Dependencies & Side Effects

        - Database dependencies: None
        - Worker dependencies: None
        - External dependencies: None
        - Local helper chain: _get_test_processors

        ## Data Reads/Writes

        - This document touches database helpers: None
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `POST /api/test/batch-upload`: 400, 500
- `POST /api/test/single-image`: 400, 500

        ## Frontend Usage

        - `POST /api/test/batch-upload`: `internal-only`; callers: No mini program caller found in current scan.
- `POST /api/test/single-image`: `internal-only`; callers: No mini program caller found in current scan.

        ## Migration Notes

        - `POST /api/test/batch-upload`: cookie-based test backend auth should not be merged into JWT auth by accident
- `POST /api/test/single-image`: cookie-based test backend auth should not be merged into JWT auth by accident

        ## Open Questions / Drift

        - Internal/test-backend routes should likely remain isolated from the public business API surface in the rewrite.
