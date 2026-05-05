        ---
        route_path: "/api/community/feed/{record_id}/like"
        methods: ["DELETE", "POST"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:9595", "backend/main.py:9564"]
        request_models: []
        response_models: []
        db_dependencies: ["add_feed_like", "remove_feed_like"]
        worker_dependencies: []
        external_dependencies: ["Supabase"]
        source_refs: ["backend/main.py:9564", "backend/main.py:9595"]
        ---

        # Record_Id Like

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `DELETE` | `/api/community/feed/{record_id}/like` | `api_community_unlike` | `jwt_required` | `implicit` | `backend/main.py:9595` |
| `POST` | `/api/community/feed/{record_id}/like` | `api_community_like` | `jwt_required` | `implicit` | `backend/main.py:9564` |

        ## Request Contract

        - `DELETE /api/community/feed/{record_id}/like`: None
- `POST /api/community/feed/{record_id}/like`: None

        ## Response Contract

        - `DELETE /api/community/feed/{record_id}/like`: Implicit JSON/dict response
- `POST /api/community/feed/{record_id}/like`: Implicit JSON/dict response

        ## Main Flow

        - `DELETE /api/community/feed/{record_id}/like`: reads/writes via `remove_feed_like`; local helper chain includes `_ensure_feed_record_interactable`
- `POST /api/community/feed/{record_id}/like`: reads/writes via `add_feed_like`; local helper chain includes `_ensure_feed_record_interactable`

        ## Dependencies & Side Effects

        - Database dependencies: add_feed_like, remove_feed_like
        - Worker dependencies: None
        - External dependencies: Supabase
        - Local helper chain: _ensure_feed_record_interactable

        ## Data Reads/Writes

        - This document touches database helpers: add_feed_like, remove_feed_like
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `DELETE /api/community/feed/{record_id}/like`: 500
- `POST /api/community/feed/{record_id}/like`: 500

        ## Frontend Usage

        - `DELETE /api/community/feed/{record_id}/like`: `miniapp-used`; callers: src/utils/api.ts:communityUnlike
- `POST /api/community/feed/{record_id}/like`: `miniapp-used`; callers: src/utils/api.ts:communityLike

        ## Migration Notes

        - `DELETE /api/community/feed/{record_id}/like`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `POST /api/community/feed/{record_id}/like`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
