---
route_path: "/api/recipes/{recipe_id}/use"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:10805"]
request_models: ["UseRecipeRequest"]
response_models: []
db_dependencies: ["get_user_recipe", "insert_food_record", "use_recipe_record"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:10805"]
---

# Recipe_Id Use

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/recipes/{recipe_id}/use` | `use_recipe` | `jwt_required` | `implicit` | `backend/main.py:10805` |

## Request Contract

- `POST /api/recipes/{recipe_id}/use`: `UseRecipeRequest` (meal_type)

## Response Contract

- `POST /api/recipes/{recipe_id}/use`: Implicit JSON/dict response

## Main Flow

- `POST /api/recipes/{recipe_id}/use`: reads/writes via `get_user_recipe, insert_food_record, use_recipe_record`; local helper chain includes `_normalize_meal_type`

## Dependencies & Side Effects

- Database dependencies: get_user_recipe, insert_food_record, use_recipe_record
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _normalize_meal_type

## Data Reads/Writes

- This document touches database helpers: get_user_recipe, insert_food_record, use_recipe_record
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/recipes/{recipe_id}/use`: 404, 500

## Frontend Usage

- `POST /api/recipes/{recipe_id}/use`: `miniapp-used`; callers: src/utils/api.ts:applyUserRecipe

## Migration Notes

- `POST /api/recipes/{recipe_id}/use`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
