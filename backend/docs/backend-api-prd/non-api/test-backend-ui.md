        ---
        route_path: "non-api-summary"
        methods: ["GET"]
        auth_type: ["mixed"]
        frontend_usage: ["backend-only", "internal-only"]
        handler_refs: []
        request_models: []
        response_models: []
        db_dependencies: []
        worker_dependencies: []
        external_dependencies: []
        source_refs: ["backend/main.py", "backend/run_backend.py"]
        ---

        # Non API Summary

        ## Purpose

        Summarizes backend-served pages and health-style non-business endpoints outside the main `/api/*` business tree.

        ## Route Matrix

        | Method | Path | Handler | Frontend Usage |
        | --- | --- | --- | --- |
        | `GET` | `/api` | `root` | `backend-only` |
| `GET` | `/api/health` | `health` | `backend-only` |
| `GET` | `/map-picker` | `map_picker` | `backend-only` |
| `GET` | `/test-backend` | `test_backend_page` | `backend-only` |
| `GET` | `/test-backend/login` | `test_backend_login_page` | `backend-only` |

        ## Frontend Usage

        - `/map-picker` is intended for web-view embedding.
        - `/test-backend*` belongs to the internal test console.
        - `/api` and `/api/health` are backend-only operational surfaces.
