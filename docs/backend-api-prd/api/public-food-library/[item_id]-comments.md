        ---
        route_path: "/api/public-food-library/{item_id}/comments"
        methods: ["GET", "POST"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:10184", "backend/main.py:10198"]
        request_models: []
        response_models: []
        db_dependencies: ["add_public_food_library_comment_sync", "get_user_by_id", "list_public_food_library_comments"]
        worker_dependencies: []
        external_dependencies: ["Supabase"]
        source_refs: ["backend/main.py:10184", "backend/main.py:10198"]
        ---

        # Item_Id Comments

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `GET` | `/api/public-food-library/{item_id}/comments` | `api_public_food_library_comments` | `jwt_required` | `implicit` | `backend/main.py:10184` |
| `POST` | `/api/public-food-library/{item_id}/comments` | `api_public_food_library_comment_post` | `jwt_required` | `implicit` | `backend/main.py:10198` |

        ## Request Contract

        - `GET /api/public-food-library/{item_id}/comments`: None
- `POST /api/public-food-library/{item_id}/comments`: None

        ## Response Contract

        - `GET /api/public-food-library/{item_id}/comments`: Implicit JSON/dict response
- `POST /api/public-food-library/{item_id}/comments`: Implicit JSON/dict response

        ## Main Flow

        - `GET /api/public-food-library/{item_id}/comments`: reads/writes via `list_public_food_library_comments`
- `POST /api/public-food-library/{item_id}/comments`: reads/writes via `add_public_food_library_comment_sync, get_user_by_id`

        ## Dependencies & Side Effects

        - Database dependencies: add_public_food_library_comment_sync, get_user_by_id, list_public_food_library_comments
        - Worker dependencies: None
        - External dependencies: Supabase
        - Local helper chain: None

        ## Data Reads/Writes

        - This document touches database helpers: add_public_food_library_comment_sync, get_user_by_id, list_public_food_library_comments
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `GET /api/public-food-library/{item_id}/comments`: 500
- `POST /api/public-food-library/{item_id}/comments`: 400, 500

        ## Frontend Usage

        - `GET /api/public-food-library/{item_id}/comments`: `miniapp-used`; callers: src/utils/api.ts:getPublicFoodLibraryComments
- `POST /api/public-food-library/{item_id}/comments`: `miniapp-used`; callers: src/utils/api.ts:postPublicFoodLibraryComment

        ## Migration Notes

        - `GET /api/public-food-library/{item_id}/comments`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `POST /api/public-food-library/{item_id}/comments`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
