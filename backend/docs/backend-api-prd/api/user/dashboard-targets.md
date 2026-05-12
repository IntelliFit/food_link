        ---
        route_path: "/api/user/dashboard-targets"
        methods: ["GET", "PUT"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:8273", "backend/main.py:8283"]
        request_models: ["DashboardTargetsUpdateRequest"]
        response_models: []
        db_dependencies: ["get_user_by_id", "update_user"]
        worker_dependencies: []
        external_dependencies: ["Supabase"]
        source_refs: ["backend/main.py:8273", "backend/main.py:8283"]
        ---

        # Dashboard Targets

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `GET` | `/api/user/dashboard-targets` | `get_dashboard_targets` | `jwt_required` | `implicit` | `backend/main.py:8273` |
| `PUT` | `/api/user/dashboard-targets` | `update_dashboard_targets` | `jwt_required` | `implicit` | `backend/main.py:8283` |

        ## Request Contract

        - `GET /api/user/dashboard-targets`: None
- `PUT /api/user/dashboard-targets`: `DashboardTargetsUpdateRequest` (calorie_target, protein_target, carbs_target, fat_target)

        ## Response Contract

        - `GET /api/user/dashboard-targets`: Implicit JSON/dict response
- `PUT /api/user/dashboard-targets`: Implicit JSON/dict response

        ## Main Flow

        - `GET /api/user/dashboard-targets`: reads/writes via `get_user_by_id`; local helper chain includes `_get_dashboard_targets`
- `PUT /api/user/dashboard-targets`: reads/writes via `get_user_by_id, update_user`; local helper chain includes `_get_dashboard_targets`

        ## Dependencies & Side Effects

        - Database dependencies: get_user_by_id, update_user
        - Worker dependencies: None
        - External dependencies: Supabase
        - Local helper chain: _get_dashboard_targets

        ## Data Reads/Writes

        - This document touches database helpers: get_user_by_id, update_user
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `GET /api/user/dashboard-targets`: 404
- `PUT /api/user/dashboard-targets`: 404, 500

        ## Frontend Usage

        - `GET /api/user/dashboard-targets`: `miniapp-used`; callers: src/utils/api.ts:getDashboardTargets
- `PUT /api/user/dashboard-targets`: `miniapp-used`; callers: src/utils/api.ts:updateDashboardTargets

        ## Migration Notes

        - `GET /api/user/dashboard-targets`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `PUT /api/user/dashboard-targets`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
