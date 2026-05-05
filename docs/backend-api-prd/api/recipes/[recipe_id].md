        ---
        route_path: "/api/recipes/{recipe_id}"
        methods: ["DELETE", "GET", "PUT"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:10786", "backend/main.py:10744", "backend/main.py:10763"]
        request_models: ["UpdateRecipeRequest"]
        response_models: []
        db_dependencies: ["delete_user_recipe", "get_user_recipe", "update_user_recipe"]
        worker_dependencies: []
        external_dependencies: ["Supabase"]
        source_refs: ["backend/main.py:10744", "backend/main.py:10763", "backend/main.py:10786"]
        ---

        # Recipe_Id

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `DELETE` | `/api/recipes/{recipe_id}` | `delete_recipe` | `jwt_required` | `implicit` | `backend/main.py:10786` |
| `GET` | `/api/recipes/{recipe_id}` | `get_recipe` | `jwt_required` | `implicit` | `backend/main.py:10744` |
| `PUT` | `/api/recipes/{recipe_id}` | `update_recipe` | `jwt_required` | `implicit` | `backend/main.py:10763` |

        ## Request Contract

        - `DELETE /api/recipes/{recipe_id}`: None
- `GET /api/recipes/{recipe_id}`: None
- `PUT /api/recipes/{recipe_id}`: `UpdateRecipeRequest` (recipe_name, description, image_path, items, total_calories, total_protein, total_carbs, total_fat, total_weight_grams, tags, meal_type, is_favorite)

        ## Response Contract

        - `DELETE /api/recipes/{recipe_id}`: Implicit JSON/dict response
- `GET /api/recipes/{recipe_id}`: Implicit JSON/dict response
- `PUT /api/recipes/{recipe_id}`: Implicit JSON/dict response

        ## Main Flow

        - `DELETE /api/recipes/{recipe_id}`: reads/writes via `delete_user_recipe`
- `GET /api/recipes/{recipe_id}`: reads/writes via `get_user_recipe`
- `PUT /api/recipes/{recipe_id}`: reads/writes via `update_user_recipe`

        ## Dependencies & Side Effects

        - Database dependencies: delete_user_recipe, get_user_recipe, update_user_recipe
        - Worker dependencies: None
        - External dependencies: Supabase
        - Local helper chain: None

        ## Data Reads/Writes

        - This document touches database helpers: delete_user_recipe, get_user_recipe, update_user_recipe
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `DELETE /api/recipes/{recipe_id}`: 500
- `GET /api/recipes/{recipe_id}`: 404, 500
- `PUT /api/recipes/{recipe_id}`: 400, 500

        ## Frontend Usage

        - `DELETE /api/recipes/{recipe_id}`: `miniapp-used`; callers: src/utils/api.ts:deleteUserRecipe
- `GET /api/recipes/{recipe_id}`: `miniapp-used`; callers: src/utils/api.ts:getUserRecipe
- `PUT /api/recipes/{recipe_id}`: `miniapp-used`; callers: src/utils/api.ts:updateUserRecipe

        ## Migration Notes

        - `DELETE /api/recipes/{recipe_id}`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `GET /api/recipes/{recipe_id}`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `PUT /api/recipes/{recipe_id}`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
