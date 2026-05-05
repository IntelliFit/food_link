        ---
        route_path: "/api/public-food-library/{item_id}/like"
        methods: ["DELETE", "POST"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:10142", "backend/main.py:10128"]
        request_models: []
        response_models: []
        db_dependencies: ["add_public_food_library_like", "remove_public_food_library_like"]
        worker_dependencies: []
        external_dependencies: ["Supabase"]
        source_refs: ["backend/main.py:10128", "backend/main.py:10142"]
        ---

        # Item_Id Like

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `DELETE` | `/api/public-food-library/{item_id}/like` | `api_public_food_library_unlike` | `jwt_required` | `implicit` | `backend/main.py:10142` |
| `POST` | `/api/public-food-library/{item_id}/like` | `api_public_food_library_like` | `jwt_required` | `implicit` | `backend/main.py:10128` |

        ## Request Contract

        - `DELETE /api/public-food-library/{item_id}/like`: None
- `POST /api/public-food-library/{item_id}/like`: None

        ## Response Contract

        - `DELETE /api/public-food-library/{item_id}/like`: Implicit JSON/dict response
- `POST /api/public-food-library/{item_id}/like`: Implicit JSON/dict response

        ## Main Flow

        - `DELETE /api/public-food-library/{item_id}/like`: reads/writes via `remove_public_food_library_like`
- `POST /api/public-food-library/{item_id}/like`: reads/writes via `add_public_food_library_like`

        ## Dependencies & Side Effects

        - Database dependencies: add_public_food_library_like, remove_public_food_library_like
        - Worker dependencies: None
        - External dependencies: Supabase
        - Local helper chain: None

        ## Data Reads/Writes

        - This document touches database helpers: add_public_food_library_like, remove_public_food_library_like
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `DELETE /api/public-food-library/{item_id}/like`: 500
- `POST /api/public-food-library/{item_id}/like`: 500

        ## Frontend Usage

        - `DELETE /api/public-food-library/{item_id}/like`: `miniapp-used`; callers: src/utils/api.ts:unlikePublicFoodLibraryItem
- `POST /api/public-food-library/{item_id}/like`: `miniapp-used`; callers: src/utils/api.ts:likePublicFoodLibraryItem

        ## Migration Notes

        - `DELETE /api/public-food-library/{item_id}/like`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `POST /api/public-food-library/{item_id}/like`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
