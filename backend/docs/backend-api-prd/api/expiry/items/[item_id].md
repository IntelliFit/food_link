        ---
        route_path: "/api/expiry/items/{item_id}"
        methods: ["GET", "PUT"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:8025", "backend/main.py:8079"]
        request_models: ["FoodExpiryItemUpsertRequest"]
        response_models: []
        db_dependencies: ["get_food_expiry_item_v2", "update_food_expiry_item_v2"]
        worker_dependencies: []
        external_dependencies: ["Supabase", "Supabase Storage"]
        source_refs: ["backend/main.py:8025", "backend/main.py:8079"]
        ---

        # Item_Id

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `GET` | `/api/expiry/items/{item_id}` | `get_food_expiry_item_detail` | `jwt_required` | `implicit` | `backend/main.py:8025` |
| `PUT` | `/api/expiry/items/{item_id}` | `update_food_expiry_item_endpoint` | `jwt_required` | `implicit` | `backend/main.py:8079` |

        ## Request Contract

        - `GET /api/expiry/items/{item_id}`: None
- `PUT /api/expiry/items/{item_id}`: `FoodExpiryItemUpsertRequest` (food_name, category, storage_type, quantity_note, expire_date, opened_date, note, source_type, status)

        ## Response Contract

        - `GET /api/expiry/items/{item_id}`: Implicit JSON/dict response
- `PUT /api/expiry/items/{item_id}`: Implicit JSON/dict response

        ## Main Flow

        - `GET /api/expiry/items/{item_id}`: reads/writes via `get_food_expiry_item_v2`; local helper chain includes `_normalize_food_expiry_item`
- `PUT /api/expiry/items/{item_id}`: reads/writes via `update_food_expiry_item_v2`; local helper chain includes `_normalize_expiry_source_type, _normalize_expiry_status, _normalize_expiry_storage_type, _normalize_food_expiry_item, _parse_date_string, _reconcile_food_expiry_notification_job`

        ## Dependencies & Side Effects

        - Database dependencies: get_food_expiry_item_v2, update_food_expiry_item_v2
        - Worker dependencies: None
        - External dependencies: Supabase, Supabase Storage
        - Local helper chain: _normalize_expiry_source_type, _normalize_expiry_status, _normalize_expiry_storage_type, _normalize_food_expiry_item, _parse_date_string, _reconcile_food_expiry_notification_job

        ## Data Reads/Writes

        - This document touches database helpers: get_food_expiry_item_v2, update_food_expiry_item_v2
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `GET /api/expiry/items/{item_id}`: 404, 500
- `PUT /api/expiry/items/{item_id}`: 400, 404, 500

        ## Frontend Usage

        - `GET /api/expiry/items/{item_id}`: `miniapp-used`; callers: src/utils/api.ts:getManagedFoodExpiryItem
- `PUT /api/expiry/items/{item_id}`: `miniapp-used`; callers: src/utils/api.ts:updateManagedFoodExpiryItem

        ## Migration Notes

        - `GET /api/expiry/items/{item_id}`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `PUT /api/expiry/items/{item_id}`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
