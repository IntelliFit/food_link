---
route_path: "/api/manual-food/browse"
methods: ["GET"]
auth_type: ["jwt_optional"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:7323"]
request_models: []
response_models: []
db_dependencies: ["browse_manual_food_library"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:7323"]
---

# Browse

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/manual-food/browse` | `manual_food_browse` | `jwt_optional` | `implicit` | `backend/main.py:7323` |

## Request Contract

- `GET /api/manual-food/browse`: None

## Response Contract

- `GET /api/manual-food/browse`: Implicit JSON/dict response

## Main Flow

- `GET /api/manual-food/browse`: reads/writes via `browse_manual_food_library`

## Dependencies & Side Effects

- Database dependencies: browse_manual_food_library
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: browse_manual_food_library
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/manual-food/browse`: 500

## Frontend Usage

- `GET /api/manual-food/browse`: `miniapp-used`; callers: src/utils/api.ts:browseManualFood

## Migration Notes

- `GET /api/manual-food/browse`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
