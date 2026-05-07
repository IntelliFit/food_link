        ---
        route_path: "/api/food-record/{record_id}"
        methods: ["DELETE", "GET", "PUT"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:7621", "backend/main.py:7524", "backend/main.py:7566"]
        request_models: ["UpdateFoodRecordRequest"]
        response_models: []
        db_dependencies: ["delete_food_record", "get_food_record_by_id", "update_food_record"]
        worker_dependencies: []
        external_dependencies: ["Supabase"]
        source_refs: ["backend/main.py:7524", "backend/main.py:7566", "backend/main.py:7621"]
        ---

        # Record_Id

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `DELETE` | `/api/food-record/{record_id}` | `delete_food_record_endpoint` | `jwt_required` | `implicit` | `backend/main.py:7621` |
| `GET` | `/api/food-record/{record_id}` | `get_food_record_detail` | `jwt_required` | `implicit` | `backend/main.py:7524` |
| `PUT` | `/api/food-record/{record_id}` | `update_food_record_endpoint` | `jwt_required` | `implicit` | `backend/main.py:7566` |

        ## Request Contract

        - `DELETE /api/food-record/{record_id}`: None
- `GET /api/food-record/{record_id}`: None
- `PUT /api/food-record/{record_id}`: `UpdateFoodRecordRequest` (meal_type, items, total_calories, total_protein, total_carbs, total_fat, total_weight_grams)

        ## Response Contract

        - `DELETE /api/food-record/{record_id}`: Implicit JSON/dict response
- `GET /api/food-record/{record_id}`: Implicit JSON/dict response
- `PUT /api/food-record/{record_id}`: Implicit JSON/dict response

        ## Main Flow

        - `DELETE /api/food-record/{record_id}`: reads/writes via `delete_food_record`
- `GET /api/food-record/{record_id}`: reads/writes via `get_food_record_by_id`; local helper chain includes `_hydrate_food_record_image_paths, _normalize_meal_type, _trace_add_event, _trace_record_error`
- `PUT /api/food-record/{record_id}`: reads/writes via `update_food_record`; local helper chain includes `_normalize_meal_type`

        ## Dependencies & Side Effects

        - Database dependencies: delete_food_record, get_food_record_by_id, update_food_record
        - Worker dependencies: None
        - External dependencies: Supabase
        - Local helper chain: _hydrate_food_record_image_paths, _normalize_meal_type, _trace_add_event, _trace_record_error

        ## Data Reads/Writes

        - This document touches database helpers: delete_food_record, get_food_record_by_id, update_food_record
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `DELETE /api/food-record/{record_id}`: 404, 500
- `GET /api/food-record/{record_id}`: 403, 404, 500
- `PUT /api/food-record/{record_id}`: 400, 404, 500

        ## Frontend Usage

        - `DELETE /api/food-record/{record_id}`: `miniapp-used`; callers: src/utils/api.ts:deleteFoodRecord
- `GET /api/food-record/{record_id}`: `miniapp-used`; callers: src/utils/api.ts:getFoodRecordById
- `PUT /api/food-record/{record_id}`: `miniapp-used`; callers: src/utils/api.ts:updateFoodRecord

        ## Migration Notes

        - `DELETE /api/food-record/{record_id}`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `GET /api/food-record/{record_id}`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `PUT /api/food-record/{record_id}`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
