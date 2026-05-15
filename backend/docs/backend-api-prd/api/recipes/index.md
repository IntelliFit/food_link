        ---
        route_path: "/api/recipes"
        methods: ["GET", "POST"]
        auth_type: ["jwt_required"]
        frontend_usage: ["miniapp-used"]
        handler_refs: ["backend/main.py:10713", "backend/main.py:10698"]
        request_models: ["CreateRecipeRequest"]
        response_models: []
        db_dependencies: ["create_user_recipe", "list_user_recipes"]
        worker_dependencies: []
        external_dependencies: ["Supabase"]
        source_refs: ["backend/main.py:10698", "backend/main.py:10713"]
        ---

        # Index

        ## Purpose

        Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

        ## Route Matrix

        | Method | Path | Handler | Auth | Response Model | Source |
        | --- | --- | --- | --- | --- | --- |
        | `GET` | `/api/recipes` | `list_recipes` | `jwt_required` | `implicit` | `backend/main.py:10713` |
| `POST` | `/api/recipes` | `create_recipe` | `jwt_required` | `implicit` | `backend/main.py:10698` |

        ## Request Contract

        - `GET /api/recipes`: None
- `POST /api/recipes`: `CreateRecipeRequest` (recipe_name, description, image_path, items, total_calories, total_protein, total_carbs, total_fat, total_weight_grams, tags, meal_type, is_favorite)

        ## Response Contract

        - `GET /api/recipes`: Implicit JSON/dict response
- `POST /api/recipes`: Implicit JSON/dict response

        ## Main Flow

        - `GET /api/recipes`: reads/writes via `list_user_recipes`
- `POST /api/recipes`: reads/writes via `create_user_recipe`

        ## Dependencies & Side Effects

        - Database dependencies: create_user_recipe, list_user_recipes
        - Worker dependencies: None
        - External dependencies: Supabase
        - Local helper chain: None

        ## Data Reads/Writes

        - This document touches database helpers: create_user_recipe, list_user_recipes
        - Async / worker-sensitive flow: No direct async task creation detected

        ## Error Cases

        - `GET /api/recipes`: 500
- `POST /api/recipes`: 500

        ## Frontend Usage

        - `GET /api/recipes`: `miniapp-used`; callers: src/utils/api.ts:getUserRecipes
- `POST /api/recipes`: `miniapp-used`; callers: src/utils/api.ts:createUserRecipe

        ## Migration Notes

        - `GET /api/recipes`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- `POST /api/recipes`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

        ## Open Questions / Drift

        - No additional drift was detected for this route document beyond normal implicit-response ambiguity.
