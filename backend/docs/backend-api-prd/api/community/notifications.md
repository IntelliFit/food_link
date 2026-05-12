        ---
        route_path: "/api/community/notifications, /api/community/notifications/read"
        methods: ["GET", "POST"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:9832", "backend/main.py:9848"]
        request_models: ["MarkFeedNotificationsReadRequest"]
        response_models: []
        db_dependencies: ["count_unread_feed_interaction_notifications", "list_feed_interaction_notifications", "mark_feed_interaction_notifications_read"]
        worker_dependencies: []
        external_dependencies: ["Supabase"]
        source_refs: ["backend/main.py:9832", "backend/main.py:9848"]
        ---

        # Notifications

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `GET` | `/api/community/notifications` | `api_community_notifications` | `jwt_required` | `implicit` | `backend/main.py:9832` |
| `POST` | `/api/community/notifications/read` | `api_community_notifications_read` | `jwt_required` | `implicit` | `backend/main.py:9848` |

        ## Request Contract

        - `GET /api/community/notifications`: None
- `POST /api/community/notifications/read`: `MarkFeedNotificationsReadRequest` (notification_ids)

        ## Response Contract

        - `GET /api/community/notifications`: Implicit JSON/dict response
- `POST /api/community/notifications/read`: Implicit JSON/dict response

        ## Main Flow

        - `GET /api/community/notifications`: reads/writes via `count_unread_feed_interaction_notifications, list_feed_interaction_notifications`
- `POST /api/community/notifications/read`: reads/writes via `count_unread_feed_interaction_notifications, mark_feed_interaction_notifications_read`

        ## Dependencies & Side Effects

        - Database dependencies: count_unread_feed_interaction_notifications, list_feed_interaction_notifications, mark_feed_interaction_notifications_read
        - Worker dependencies: None
        - External dependencies: Supabase
        - Local helper chain: None

        ## Data Reads/Writes

        - This document touches database helpers: count_unread_feed_interaction_notifications, list_feed_interaction_notifications, mark_feed_interaction_notifications_read
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `GET /api/community/notifications`: 500
- `POST /api/community/notifications/read`: 500

        ## Frontend Usage

        - `GET /api/community/notifications`: `miniapp-used`; callers: src/utils/api.ts:communityGetNotifications
- `POST /api/community/notifications/read`: `miniapp-used`; callers: src/utils/api.ts:communityMarkNotificationsRead

        ## Migration Notes

        - `GET /api/community/notifications`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `POST /api/community/notifications/read`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
