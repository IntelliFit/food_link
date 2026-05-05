        ---
        route_path: "/test-backend, /test-backend/login"
        methods: ["GET"]
        auth_type: ["public"]
        frontend_usage: ["backend-only"]
        handler_refs: ["backend/main.py:12039", "backend/main.py:12029"]
        request_models: []
        response_models: []
        db_dependencies: []
        worker_dependencies: []
        external_dependencies: []
        source_refs: ["backend/main.py:12029", "backend/main.py:12039"]
        ---

        # Html Pages

        ## Purpose

        Documents non-API pages served directly by the backend process.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `GET` | `/test-backend` | `test_backend_page` | `public` | `implicit` | `backend/main.py:12039` |
| `GET` | `/test-backend/login` | `test_backend_login_page` | `public` | `implicit` | `backend/main.py:12029` |

        ## Request Contract

        - `GET /test-backend`: None
- `GET /test-backend/login`: None

        ## Response Contract

        - `GET /test-backend`: Implicit JSON/dict response
- `GET /test-backend/login`: Implicit JSON/dict response

        ## Main Flow

        - `GET /test-backend`: local helper chain includes `_verify_test_backend_auth`
- `GET /test-backend/login`: mostly self-contained in the handler body

        ## Dependencies & Side Effects

        - Database dependencies: None
        - Worker dependencies: None
        - External dependencies: None
        - Local helper chain: _verify_test_backend_auth

        ## Data Reads/Writes

        - This document touches database helpers: None
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `GET /test-backend`: 404
- `GET /test-backend/login`: 404

        ## Frontend Usage

        - `GET /test-backend`: `backend-only`; callers: No mini program caller found in current scan.
- `GET /test-backend/login`: `backend-only`; callers: No mini program caller found in current scan.

        ## Migration Notes

        - `GET /test-backend`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `GET /test-backend/login`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - Current scan found no mini program caller for at least one route in this document; verify real operator/test caller before rewrite.
