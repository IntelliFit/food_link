        ---
        route_path: "/api/public-food-library"
        methods: ["GET", "POST"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:9976", "backend/main.py:9897"]
        request_models: ["PublicFoodLibraryCreateRequest"]
        response_models: []
        db_dependencies: ["create_public_food_library_item", "get_food_record_by_id", "get_public_food_library_collections_for_items", "get_public_food_library_likes_for_items", "list_public_food_library"]
        worker_dependencies: []
        external_dependencies: ["Supabase"]
        source_refs: ["backend/main.py:9897", "backend/main.py:9976"]
        ---

        # Index

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `GET` | `/api/public-food-library` | `api_list_public_food_library` | `jwt_required` | `implicit` | `backend/main.py:9976` |
| `POST` | `/api/public-food-library` | `api_create_public_food_library` | `jwt_required` | `implicit` | `backend/main.py:9897` |

        ## Request Contract

        - `GET /api/public-food-library`: None
- `POST /api/public-food-library`: `PublicFoodLibraryCreateRequest` (image_path, image_paths, source_record_id, total_calories, total_protein, total_carbs, total_fat, items, description, insight, food_name, merchant_name)

        ## Response Contract

        - `GET /api/public-food-library`: Implicit JSON/dict response
- `POST /api/public-food-library`: Implicit JSON/dict response

        ## Main Flow

        - `GET /api/public-food-library`: reads/writes via `get_public_food_library_collections_for_items, get_public_food_library_likes_for_items, list_public_food_library`
- `POST /api/public-food-library`: reads/writes via `create_public_food_library_item, get_food_record_by_id`; worker or async pipeline touchpoint: `analysis_tasks / worker queue`

        ## Dependencies & Side Effects

        - Database dependencies: create_public_food_library_item, get_food_record_by_id, get_public_food_library_collections_for_items, get_public_food_library_likes_for_items, list_public_food_library
        - Worker dependencies: None
        - External dependencies: Supabase
        - Local helper chain: None

        ## Data Reads/Writes

        - This document touches database helpers: create_public_food_library_item, get_food_record_by_id, get_public_food_library_collections_for_items, get_public_food_library_likes_for_items, list_public_food_library
        - Async / worker-sensitive flow: Yes

        ## Error Cases

        - `GET /api/public-food-library`: 500
- `POST /api/public-food-library`: 403, 404, 500

        ## Frontend Usage

        - `GET /api/public-food-library`: `miniapp-used`; callers: src/utils/api.ts:getPublicFoodLibraryList
- `POST /api/public-food-library`: `miniapp-used`; callers: src/utils/api.ts:createPublicFoodLibraryItem

        ## Migration Notes

        - `GET /api/public-food-library`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `POST /api/public-food-library`: preserve async task semantics and queue contract

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
