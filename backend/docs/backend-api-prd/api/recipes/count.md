---
route_path: "/api/recipes/count"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:10729"]
request_models: []
response_models: []
db_dependencies: ["count_user_recipes_sync"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:10729"]
---

# Count

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/recipes/count` | `get_recipes_count` | `jwt_required` | `implicit` | `backend/main.py:10729` |

## Request Contract

- `GET /api/recipes/count`: None

## Response Contract

- `GET /api/recipes/count`: Implicit JSON/dict response

## Main Flow

- `GET /api/recipes/count`: reads/writes via `count_user_recipes_sync`

## Dependencies & Side Effects

- Database dependencies: count_user_recipes_sync
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: count_user_recipes_sync
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/recipes/count`: 500

## Frontend Usage

- `GET /api/recipes/count`: `miniapp-used`; callers: src/utils/api.ts:getFavoriteCount

## Migration Notes

- `GET /api/recipes/count`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
