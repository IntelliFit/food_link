---
route_path: "/api/public-food-library/{item_id}"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:10090"]
request_models: []
response_models: []
db_dependencies: ["get_public_food_library_collections_for_items", "get_public_food_library_item", "get_public_food_library_likes_for_items", "get_user_by_id"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:10090"]
---

# Item_Id

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/public-food-library/{item_id}` | `api_get_public_food_library_item` | `jwt_required` | `implicit` | `backend/main.py:10090` |

## Request Contract

- `GET /api/public-food-library/{item_id}`: None

## Response Contract

- `GET /api/public-food-library/{item_id}`: Implicit JSON/dict response

## Main Flow

- `GET /api/public-food-library/{item_id}`: reads/writes via `get_public_food_library_collections_for_items, get_public_food_library_item, get_public_food_library_likes_for_items, get_user_by_id`

## Dependencies & Side Effects

- Database dependencies: get_public_food_library_collections_for_items, get_public_food_library_item, get_public_food_library_likes_for_items, get_user_by_id
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: get_public_food_library_collections_for_items, get_public_food_library_item, get_public_food_library_likes_for_items, get_user_by_id
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/public-food-library/{item_id}`: 404, 500

## Frontend Usage

- `GET /api/public-food-library/{item_id}`: `miniapp-used`; callers: src/utils/api.ts:getPublicFoodLibraryItem

## Migration Notes

- `GET /api/public-food-library/{item_id}`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
