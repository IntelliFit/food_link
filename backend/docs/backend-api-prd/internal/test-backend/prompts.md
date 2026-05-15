        ---
        route_path: "/api/prompts, /api/prompts/active/{model_type}, /api/prompts/{prompt_id}, /api/prompts/{prompt_id}/activate, /api/prompts/{prompt_id}/history"
        methods: ["DELETE", "GET", "POST", "PUT"]
        auth_type: ["test_backend_cookie"]
        frontend_usage: ["internal-only"]
        handler_refs: ["backend/main.py:12081", "backend/main.py:12130", "backend/main.py:12095", "backend/main.py:12425", "backend/main.py:12112", "backend/main.py:12153", "backend/main.py:12177", "backend/main.py:12445"]
        request_models: ["PromptCreate", "PromptUpdate"]
        response_models: []
        db_dependencies: ["create_prompt", "delete_prompt", "get_active_prompt", "get_prompt_by_id", "get_prompt_history", "list_prompts", "set_active_prompt", "update_prompt"]
        worker_dependencies: []
        external_dependencies: ["Supabase"]
        source_refs: ["backend/main.py:12081", "backend/main.py:12095", "backend/main.py:12112", "backend/main.py:12130", "backend/main.py:12153", "backend/main.py:12177", "backend/main.py:12425", "backend/main.py:12445"]
        ---

        # Prompts

        ## Purpose

        Covers internal prompt management routes used by the test backend and prompt experiments.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `GET` | `/api/prompts` | `api_list_prompts` | `test_backend_cookie` | `implicit` | `backend/main.py:12081` |
| `POST` | `/api/prompts` | `api_create_prompt` | `test_backend_cookie` | `implicit` | `backend/main.py:12130` |
| `GET` | `/api/prompts/active/{model_type}` | `api_get_active_prompt` | `test_backend_cookie` | `implicit` | `backend/main.py:12095` |
| `DELETE` | `/api/prompts/{prompt_id}` | `api_delete_prompt` | `test_backend_cookie` | `implicit` | `backend/main.py:12425` |
| `GET` | `/api/prompts/{prompt_id}` | `api_get_prompt` | `test_backend_cookie` | `implicit` | `backend/main.py:12112` |
| `PUT` | `/api/prompts/{prompt_id}` | `api_update_prompt` | `test_backend_cookie` | `implicit` | `backend/main.py:12153` |
| `POST` | `/api/prompts/{prompt_id}/activate` | `api_activate_prompt` | `test_backend_cookie` | `implicit` | `backend/main.py:12177` |
| `GET` | `/api/prompts/{prompt_id}/history` | `api_get_prompt_history` | `test_backend_cookie` | `implicit` | `backend/main.py:12445` |

        ## Request Contract

        - `GET /api/prompts`: None
- `POST /api/prompts`: `PromptCreate` (model_type, prompt_name, prompt_content, description, is_active)
- `GET /api/prompts/active/{model_type}`: None
- `DELETE /api/prompts/{prompt_id}`: None
- `GET /api/prompts/{prompt_id}`: None
- `PUT /api/prompts/{prompt_id}`: `PromptUpdate` (prompt_name, prompt_content, description)
- `POST /api/prompts/{prompt_id}/activate`: None
- `GET /api/prompts/{prompt_id}/history`: None

        ## Response Contract

        - `GET /api/prompts`: Implicit JSON/dict response
- `POST /api/prompts`: Implicit JSON/dict response
- `GET /api/prompts/active/{model_type}`: Implicit JSON/dict response
- `DELETE /api/prompts/{prompt_id}`: Implicit JSON/dict response
- `GET /api/prompts/{prompt_id}`: Implicit JSON/dict response
- `PUT /api/prompts/{prompt_id}`: Implicit JSON/dict response
- `POST /api/prompts/{prompt_id}/activate`: Implicit JSON/dict response
- `GET /api/prompts/{prompt_id}/history`: Implicit JSON/dict response

        ## Main Flow

        - `GET /api/prompts`: reads/writes via `list_prompts`
- `POST /api/prompts`: reads/writes via `create_prompt`
- `GET /api/prompts/active/{model_type}`: reads/writes via `get_active_prompt`
- `DELETE /api/prompts/{prompt_id}`: reads/writes via `delete_prompt`
- `GET /api/prompts/{prompt_id}`: reads/writes via `get_prompt_by_id`
- `PUT /api/prompts/{prompt_id}`: reads/writes via `update_prompt`
- `POST /api/prompts/{prompt_id}/activate`: reads/writes via `set_active_prompt`
- `GET /api/prompts/{prompt_id}/history`: reads/writes via `get_prompt_history`

        ## Dependencies & Side Effects

        - Database dependencies: create_prompt, delete_prompt, get_active_prompt, get_prompt_by_id, get_prompt_history, list_prompts, set_active_prompt, update_prompt
        - Worker dependencies: None
        - External dependencies: Supabase
        - Local helper chain: None

        ## Data Reads/Writes

        - This document touches database helpers: create_prompt, delete_prompt, get_active_prompt, get_prompt_by_id, get_prompt_history, list_prompts, set_active_prompt, update_prompt
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `GET /api/prompts`: 500
- `POST /api/prompts`: 400, 500
- `GET /api/prompts/active/{model_type}`: 400, 500
- `DELETE /api/prompts/{prompt_id}`: 400, 404, 500
- `GET /api/prompts/{prompt_id}`: 404, 500
- `PUT /api/prompts/{prompt_id}`: 404, 500
- `POST /api/prompts/{prompt_id}/activate`: 404, 500
- `GET /api/prompts/{prompt_id}/history`: 500

        ## Frontend Usage

        - `GET /api/prompts`: `internal-only`; callers: No mini program caller found in current scan.
- `POST /api/prompts`: `internal-only`; callers: No mini program caller found in current scan.
- `GET /api/prompts/active/{model_type}`: `internal-only`; callers: No mini program caller found in current scan.
- `DELETE /api/prompts/{prompt_id}`: `internal-only`; callers: No mini program caller found in current scan.
- `GET /api/prompts/{prompt_id}`: `internal-only`; callers: No mini program caller found in current scan.
- `PUT /api/prompts/{prompt_id}`: `internal-only`; callers: No mini program caller found in current scan.
- `POST /api/prompts/{prompt_id}/activate`: `internal-only`; callers: No mini program caller found in current scan.
- `GET /api/prompts/{prompt_id}/history`: `internal-only`; callers: No mini program caller found in current scan.

        ## Migration Notes

        - `GET /api/prompts`: cookie-based test backend auth should not be merged into JWT auth by accident
- `POST /api/prompts`: cookie-based test backend auth should not be merged into JWT auth by accident
- `GET /api/prompts/active/{model_type}`: cookie-based test backend auth should not be merged into JWT auth by accident
- `DELETE /api/prompts/{prompt_id}`: cookie-based test backend auth should not be merged into JWT auth by accident
- `GET /api/prompts/{prompt_id}`: cookie-based test backend auth should not be merged into JWT auth by accident
- `PUT /api/prompts/{prompt_id}`: cookie-based test backend auth should not be merged into JWT auth by accident
- `POST /api/prompts/{prompt_id}/activate`: cookie-based test backend auth should not be merged into JWT auth by accident
- `GET /api/prompts/{prompt_id}/history`: cookie-based test backend auth should not be merged into JWT auth by accident

        ## Open Questions / Drift

        - Internal/test-backend routes should likely remain isolated from the public business API surface in the rewrite.
