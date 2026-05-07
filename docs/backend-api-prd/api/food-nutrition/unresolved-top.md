---
route_path: "/api/food-nutrition/unresolved/top"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:4667"]
request_models: []
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: []
source_refs: ["backend/main.py:4667"]
---

# Unresolved Top

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/food-nutrition/unresolved/top` | `get_food_unresolved_top` | `jwt_required` | `implicit` | `backend/main.py:4667` |

## Request Contract

- `GET /api/food-nutrition/unresolved/top`: None

## Response Contract

- `GET /api/food-nutrition/unresolved/top`: Implicit JSON/dict response

## Main Flow

- `GET /api/food-nutrition/unresolved/top`: mostly self-contained in the handler body

## Dependencies & Side Effects

- Database dependencies: None
- Worker dependencies: None
- External dependencies: None
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: None
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/food-nutrition/unresolved/top`: 500

## Frontend Usage

- `GET /api/food-nutrition/unresolved/top`: `miniapp-used`; callers: src/utils/api.ts:fetchTopUnresolvedFoods

## Migration Notes

- `GET /api/food-nutrition/unresolved/top`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
