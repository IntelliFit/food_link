        ---
        route_path: "/api/user/profile"
        methods: ["GET", "PUT"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:6110", "backend/main.py:6698"]
        request_models: ["UpdateUserInfoRequest"]
        response_models: []
        db_dependencies: ["get_user_by_id", "update_user"]
        worker_dependencies: []
        external_dependencies: ["Supabase"]
        source_refs: ["backend/main.py:6110", "backend/main.py:6698"]
        ---

        # Profile

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `GET` | `/api/user/profile` | `get_user_profile` | `jwt_required` | `implicit` | `backend/main.py:6110` |
| `PUT` | `/api/user/profile` | `update_user_profile` | `jwt_required` | `implicit` | `backend/main.py:6698` |

        ## Request Contract

        - `GET /api/user/profile`: None
- `PUT /api/user/profile`: `UpdateUserInfoRequest` (nickname, avatar, telephone, searchable, public_records)

        ## Response Contract

        - `GET /api/user/profile`: Implicit JSON/dict response
- `PUT /api/user/profile`: Implicit JSON/dict response

        ## Main Flow

        - `GET /api/user/profile`: reads/writes via `get_user_by_id`; local helper chain includes `_normalize_execution_mode`
- `PUT /api/user/profile`: reads/writes via `update_user`

        ## Dependencies & Side Effects

        - Database dependencies: get_user_by_id, update_user
        - Worker dependencies: None
        - External dependencies: Supabase
        - Local helper chain: _normalize_execution_mode

        ## Data Reads/Writes

        - This document touches database helpers: get_user_by_id, update_user
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `GET /api/user/profile`: 404
- `PUT /api/user/profile`: 400, 500

        ## Frontend Usage

        - `GET /api/user/profile`: `miniapp-used`; callers: src/utils/api.ts:getUserProfile
- `PUT /api/user/profile`: `miniapp-used`; callers: src/packageExtra/pages/privacy-settings/index.tsx:updateSetting, src/utils/api.ts:updateUserInfo

        ## Migration Notes

        - `GET /api/user/profile`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `PUT /api/user/profile`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
