        ---
        route_path: "/api/test-backend/login, /api/test-backend/logout"
        methods: ["POST"]
        auth_type: ["public"]
        frontend_usage: ["internal-only"]
        handler_refs: ["backend/main.py:10897", "backend/main.py:10921"]
        request_models: ["TestBackendLoginRequest"]
        response_models: []
        db_dependencies: []
        worker_dependencies: []
        external_dependencies: []
        source_refs: ["backend/main.py:10897", "backend/main.py:10921"]
        ---

        # Auth

        ## Purpose

        Covers internal test-backend routes used by the backend-only evaluation console.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `POST` | `/api/test-backend/login` | `test_backend_login` | `public` | `implicit` | `backend/main.py:10897` |
| `POST` | `/api/test-backend/logout` | `test_backend_logout` | `public` | `implicit` | `backend/main.py:10921` |

        ## Request Contract

        - `POST /api/test-backend/login`: `TestBackendLoginRequest` (username, password)
- `POST /api/test-backend/logout`: None

        ## Response Contract

        - `POST /api/test-backend/login`: Implicit JSON/dict response
- `POST /api/test-backend/logout`: Implicit JSON/dict response

        ## Main Flow

        - `POST /api/test-backend/login`: local helper chain includes `_generate_session_token`
- `POST /api/test-backend/logout`: mostly self-contained in the handler body

        ## Dependencies & Side Effects

        - Database dependencies: None
        - Worker dependencies: None
        - External dependencies: None
        - Local helper chain: _generate_session_token

        ## Data Reads/Writes

        - This document touches database helpers: None
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `POST /api/test-backend/login`: No static `HTTPException(...)` status found; inspect handler branches manually.
- `POST /api/test-backend/logout`: No static `HTTPException(...)` status found; inspect handler branches manually.

        ## Frontend Usage

        - `POST /api/test-backend/login`: `internal-only`; callers: No mini program caller found in current scan.
- `POST /api/test-backend/logout`: `internal-only`; callers: No mini program caller found in current scan.

        ## Migration Notes

        - `POST /api/test-backend/login`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `POST /api/test-backend/logout`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - Internal/test-backend routes should likely remain isolated from the public business API surface in the rewrite.
