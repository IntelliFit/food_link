---
route_path: "/api/public-food-library/mine"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:10039"]
request_models: []
response_models: []
db_dependencies: ["list_my_public_food_library"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:10039"]
---

# Mine

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/public-food-library/mine` | `api_my_public_food_library` | `jwt_required` | `implicit` | `backend/main.py:10039` |

## Request Contract

- `GET /api/public-food-library/mine`: None

## Response Contract

- `GET /api/public-food-library/mine`: Implicit JSON/dict response

## Main Flow

- `GET /api/public-food-library/mine`: reads/writes via `list_my_public_food_library`

## Dependencies & Side Effects

- Database dependencies: list_my_public_food_library
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: list_my_public_food_library
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/public-food-library/mine`: 500

## Frontend Usage

- `GET /api/public-food-library/mine`: `miniapp-used`; callers: src/utils/api.ts:getMyPublicFoodLibrary

## Migration Notes

- `GET /api/public-food-library/mine`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
