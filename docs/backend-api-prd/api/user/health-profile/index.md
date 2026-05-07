        ---
        route_path: "/api/user/health-profile"
        methods: ["GET", "PUT"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:6806", "backend/main.py:6833"]
        request_models: ["HealthProfileUpdateRequest"]
        response_models: []
        db_dependencies: ["get_user_by_id", "insert_health_document", "update_user"]
        worker_dependencies: []
        external_dependencies: ["Supabase", "Supabase Storage"]
        source_refs: ["backend/main.py:6806", "backend/main.py:6833"]
        ---

        # Index

        ## Purpose

        Covers health profile read/write and OCR-related subflows that enrich analysis and onboarding.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `GET` | `/api/user/health-profile` | `get_health_profile` | `jwt_required` | `implicit` | `backend/main.py:6806` |
| `PUT` | `/api/user/health-profile` | `update_health_profile` | `jwt_required` | `implicit` | `backend/main.py:6833` |

        ## Request Contract

        - `GET /api/user/health-profile`: None
- `PUT /api/user/health-profile`: `HealthProfileUpdateRequest` (gender, birthday, height, weight, activity_level, medical_history, diet_preference, allergies, report_extract, report_image_url, diet_goal, health_notes)

        ## Response Contract

        - `GET /api/user/health-profile`: Implicit JSON/dict response
- `PUT /api/user/health-profile`: Implicit JSON/dict response

        ## Main Flow

        - `GET /api/user/health-profile`: reads/writes via `get_user_by_id`; local helper chain includes `_normalize_execution_mode`
- `PUT /api/user/health-profile`: reads/writes via `get_user_by_id, insert_health_document, update_user`; local helper chain includes `_normalize_execution_mode, _normalize_precision_reference_defaults, _parse_execution_mode_or_raise`

        ## Dependencies & Side Effects

        - Database dependencies: get_user_by_id, insert_health_document, update_user
        - Worker dependencies: None
        - External dependencies: Supabase, Supabase Storage
        - Local helper chain: _normalize_execution_mode, _normalize_precision_reference_defaults, _parse_execution_mode_or_raise

        ## Data Reads/Writes

        - This document touches database helpers: get_user_by_id, insert_health_document, update_user
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `GET /api/user/health-profile`: 404
- `PUT /api/user/health-profile`: 400, 404, 500

        ## Frontend Usage

        - `GET /api/user/health-profile`: `miniapp-used`; callers: src/utils/api.ts:getHealthProfile
- `PUT /api/user/health-profile`: `miniapp-used`; callers: src/utils/api.ts:anonymous, src/utils/api.ts:updateDashboardTargets, src/utils/api.ts:updateHealthProfile

        ## Migration Notes

        - `GET /api/user/health-profile`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `PUT /api/user/health-profile`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
