        ---
        route_path: "/api/community/feed/{record_id}/comments"
        methods: ["GET", "POST"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:9631", "backend/main.py:9685"]
        request_models: ["CommunityCommentCreateRequest"]
        response_models: []
        db_dependencies: ["add_feed_comment_sync", "create_feed_interaction_notification_sync", "get_feed_comment_by_id", "get_feed_comment_by_id_sync", "get_food_record_by_id_sync", "get_user_by_id", "list_feed_comments"]
        worker_dependencies: []
        external_dependencies: ["Supabase"]
        source_refs: ["backend/main.py:9631", "backend/main.py:9685"]
        ---

        # Record_Id Comments

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `GET` | `/api/community/feed/{record_id}/comments` | `api_community_comments` | `jwt_required` | `implicit` | `backend/main.py:9631` |
| `POST` | `/api/community/feed/{record_id}/comments` | `api_community_comment_post` | `jwt_required` | `implicit` | `backend/main.py:9685` |

        ## Request Contract

        - `GET /api/community/feed/{record_id}/comments`: None
- `POST /api/community/feed/{record_id}/comments`: `CommunityCommentCreateRequest` (content, parent_comment_id, reply_to_user_id)

        ## Response Contract

        - `GET /api/community/feed/{record_id}/comments`: Implicit JSON/dict response
- `POST /api/community/feed/{record_id}/comments`: Implicit JSON/dict response

        ## Main Flow

        - `GET /api/community/feed/{record_id}/comments`: reads/writes via `list_feed_comments`; local helper chain includes `_ensure_feed_record_interactable`
- `POST /api/community/feed/{record_id}/comments`: reads/writes via `add_feed_comment_sync, create_feed_interaction_notification_sync, get_feed_comment_by_id, get_feed_comment_by_id_sync, get_food_record_by_id_sync, get_user_by_id`; local helper chain includes `_ensure_feed_record_interactable`

        ## Dependencies & Side Effects

        - Database dependencies: add_feed_comment_sync, create_feed_interaction_notification_sync, get_feed_comment_by_id, get_feed_comment_by_id_sync, get_food_record_by_id_sync, get_user_by_id, list_feed_comments
        - Worker dependencies: None
        - External dependencies: Supabase
        - Local helper chain: _ensure_feed_record_interactable

        ## Data Reads/Writes

        - This document touches database helpers: add_feed_comment_sync, create_feed_interaction_notification_sync, get_feed_comment_by_id, get_feed_comment_by_id_sync, get_food_record_by_id_sync, get_user_by_id, list_feed_comments
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `GET /api/community/feed/{record_id}/comments`: 500
- `POST /api/community/feed/{record_id}/comments`: 400, 500

        ## Frontend Usage

        - `GET /api/community/feed/{record_id}/comments`: `miniapp-used`; callers: src/utils/api.ts:communityGetComments
- `POST /api/community/feed/{record_id}/comments`: `miniapp-used`; callers: src/utils/api.ts:communityPostComment

        ## Migration Notes

        - `GET /api/community/feed/{record_id}/comments`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `POST /api/community/feed/{record_id}/comments`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
