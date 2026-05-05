---
route_path: "/api/public-food-library/collections"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:10052"]
request_models: []
response_models: []
db_dependencies: ["get_public_food_library_collections_for_items", "get_public_food_library_likes_for_items", "list_collected_public_food_library"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:10052"]
---

# Collections

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/public-food-library/collections` | `api_public_food_library_collections` | `jwt_required` | `implicit` | `backend/main.py:10052` |

## Request Contract

- `GET /api/public-food-library/collections`: None

## Response Contract

- `GET /api/public-food-library/collections`: Implicit JSON/dict response

## Main Flow

- `GET /api/public-food-library/collections`: reads/writes via `get_public_food_library_collections_for_items, get_public_food_library_likes_for_items, list_collected_public_food_library`

## Dependencies & Side Effects

- Database dependencies: get_public_food_library_collections_for_items, get_public_food_library_likes_for_items, list_collected_public_food_library
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: get_public_food_library_collections_for_items, get_public_food_library_likes_for_items, list_collected_public_food_library
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/public-food-library/collections`: 500

## Frontend Usage

- `GET /api/public-food-library/collections`: `miniapp-used`; callers: src/utils/api.ts:getPublicFoodLibraryCollections

## Migration Notes

- `GET /api/public-food-library/collections`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
