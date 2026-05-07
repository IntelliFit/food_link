        ---
        route_path: "/api/exercise-logs"
        methods: ["GET", "POST"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:12221", "backend/main.py:12261"]
        request_models: []
        response_models: []
        db_dependencies: ["exercise_fallback_task_type", "get_user_by_id", "list_user_exercise_logs"]
        worker_dependencies: []
        external_dependencies: ["Supabase"]
        source_refs: ["backend/main.py:12221", "backend/main.py:12261"]
        ---

        # Index

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `GET` | `/api/exercise-logs` | `get_exercise_logs` | `jwt_required` | `implicit` | `backend/main.py:12221` |
| `POST` | `/api/exercise-logs` | `create_exercise_log` | `jwt_required` | `implicit` | `backend/main.py:12261` |

        ## Request Contract

        - `GET /api/exercise-logs`: None
- `POST /api/exercise-logs`: None

        ## Response Contract

        - `GET /api/exercise-logs`: Implicit JSON/dict response
- `POST /api/exercise-logs`: Implicit JSON/dict response

        ## Main Flow

        - `GET /api/exercise-logs`: reads/writes via `list_user_exercise_logs`; local helper chain includes `_parse_date_string`
- `POST /api/exercise-logs`: reads/writes via `exercise_fallback_task_type, get_user_by_id`; worker or async pipeline touchpoint: `analysis_tasks / worker queue`; local helper chain includes `_build_exercise_profile_snapshot, _consume_earned_credits_after_success, _format_membership_response, _get_effective_membership, _raise_if_exercise_credits_insufficient, _resolve_recorded_on_date, _should_use_exercise_debug_queue`

        ## Dependencies & Side Effects

        - Database dependencies: exercise_fallback_task_type, get_user_by_id, list_user_exercise_logs
        - Worker dependencies: None
        - External dependencies: Supabase
        - Local helper chain: _build_exercise_profile_snapshot, _consume_earned_credits_after_success, _format_membership_response, _get_effective_membership, _parse_date_string, _raise_if_exercise_credits_insufficient, _resolve_recorded_on_date, _should_use_exercise_debug_queue

        ## Data Reads/Writes

        - This document touches database helpers: exercise_fallback_task_type, get_user_by_id, list_user_exercise_logs
        - Async / worker-sensitive flow: Yes

        ## Error Cases

        - `GET /api/exercise-logs`: 500
- `POST /api/exercise-logs`: 422, 500

        ## Frontend Usage

        - `GET /api/exercise-logs`: `miniapp-used`; callers: src/utils/api.ts:getExerciseLogs
- `POST /api/exercise-logs`: `miniapp-used`; callers: src/utils/api.ts:createExerciseLog

        ## Migration Notes

        - `GET /api/exercise-logs`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `POST /api/exercise-logs`: preserve async task semantics and queue contract

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
