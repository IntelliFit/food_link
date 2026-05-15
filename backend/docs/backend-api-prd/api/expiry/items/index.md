        ---
        route_path: "/api/expiry/items"
        methods: ["GET", "POST"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:7991", "backend/main.py:8043"]
        request_models: ["FoodExpiryItemUpsertRequest"]
        response_models: []
        db_dependencies: ["create_food_expiry_item_v2", "list_food_expiry_items_v2"]
        worker_dependencies: []
        external_dependencies: ["Supabase", "Supabase Storage"]
        source_refs: ["backend/main.py:7991", "backend/main.py:8043"]
        ---

        # Index

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `GET` | `/api/expiry/items` | `get_food_expiry_items` | `jwt_required` | `implicit` | `backend/main.py:7991` |
| `POST` | `/api/expiry/items` | `create_food_expiry_item_endpoint` | `jwt_required` | `implicit` | `backend/main.py:8043` |

        ## Request Contract

        - `GET /api/expiry/items`: None
- `POST /api/expiry/items`: `FoodExpiryItemUpsertRequest` (food_name, category, storage_type, quantity_note, expire_date, opened_date, note, source_type, status)

        ## Response Contract

        - `GET /api/expiry/items`: Implicit JSON/dict response
- `POST /api/expiry/items`: Implicit JSON/dict response

        ## Main Flow

        - `GET /api/expiry/items`: reads/writes via `list_food_expiry_items_v2`; local helper chain includes `_normalize_expiry_status, _normalize_food_expiry_item`
- `POST /api/expiry/items`: reads/writes via `create_food_expiry_item_v2`; local helper chain includes `_normalize_expiry_source_type, _normalize_expiry_status, _normalize_expiry_storage_type, _normalize_food_expiry_item, _parse_date_string`

        ## Dependencies & Side Effects

        - Database dependencies: create_food_expiry_item_v2, list_food_expiry_items_v2
        - Worker dependencies: None
        - External dependencies: Supabase, Supabase Storage
        - Local helper chain: _normalize_expiry_source_type, _normalize_expiry_status, _normalize_expiry_storage_type, _normalize_food_expiry_item, _parse_date_string

        ## Data Reads/Writes

        - This document touches database helpers: create_food_expiry_item_v2, list_food_expiry_items_v2
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `GET /api/expiry/items`: 500
- `POST /api/expiry/items`: 400, 500

        ## Frontend Usage

        - `GET /api/expiry/items`: `miniapp-used`; callers: src/utils/api.ts:listManagedFoodExpiryItems
- `POST /api/expiry/items`: `miniapp-used`; callers: src/utils/api.ts:createManagedFoodExpiryItem

        ## Migration Notes

        - `GET /api/expiry/items`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `POST /api/expiry/items`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
