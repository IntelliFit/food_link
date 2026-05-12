        ---
        route_path: "/api/public-food-library/{item_id}/collect"
        methods: ["DELETE", "POST"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:10170", "backend/main.py:10156"]
        request_models: []
        response_models: []
        db_dependencies: ["add_public_food_library_collection", "remove_public_food_library_collection"]
        worker_dependencies: []
        external_dependencies: ["Supabase"]
        source_refs: ["backend/main.py:10156", "backend/main.py:10170"]
        ---

        # Item_Id Collect

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `DELETE` | `/api/public-food-library/{item_id}/collect` | `api_public_food_library_uncollect` | `jwt_required` | `implicit` | `backend/main.py:10170` |
| `POST` | `/api/public-food-library/{item_id}/collect` | `api_public_food_library_collect` | `jwt_required` | `implicit` | `backend/main.py:10156` |

        ## Request Contract

        - `DELETE /api/public-food-library/{item_id}/collect`: None
- `POST /api/public-food-library/{item_id}/collect`: None

        ## Response Contract

        - `DELETE /api/public-food-library/{item_id}/collect`: Implicit JSON/dict response
- `POST /api/public-food-library/{item_id}/collect`: Implicit JSON/dict response

        ## Main Flow

        - `DELETE /api/public-food-library/{item_id}/collect`: reads/writes via `remove_public_food_library_collection`
- `POST /api/public-food-library/{item_id}/collect`: reads/writes via `add_public_food_library_collection`

        ## Dependencies & Side Effects

        - Database dependencies: add_public_food_library_collection, remove_public_food_library_collection
        - Worker dependencies: None
        - External dependencies: Supabase
        - Local helper chain: None

        ## Data Reads/Writes

        - This document touches database helpers: add_public_food_library_collection, remove_public_food_library_collection
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `DELETE /api/public-food-library/{item_id}/collect`: 500
- `POST /api/public-food-library/{item_id}/collect`: 500

        ## Frontend Usage

        - `DELETE /api/public-food-library/{item_id}/collect`: `miniapp-used`; callers: src/utils/api.ts:uncollectPublicFoodLibraryItem
- `POST /api/public-food-library/{item_id}/collect`: `miniapp-used`; callers: src/utils/api.ts:collectPublicFoodLibraryItem

        ## Migration Notes

        - `DELETE /api/public-food-library/{item_id}/collect`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `POST /api/public-food-library/{item_id}/collect`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
