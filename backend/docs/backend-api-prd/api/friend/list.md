---
route_path: "/api/friend/list"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9218"]
request_models: []
response_models: []
db_dependencies: ["get_friends_with_profile"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9218"]
---

# List

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/friend/list` | `api_friend_list` | `jwt_required` | `implicit` | `backend/main.py:9218` |

## Request Contract

- `GET /api/friend/list`: None

## Response Contract

- `GET /api/friend/list`: Implicit JSON/dict response

## Main Flow

- `GET /api/friend/list`: reads/writes via `get_friends_with_profile`

## Dependencies & Side Effects

- Database dependencies: get_friends_with_profile
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: get_friends_with_profile
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/friend/list`: 500

## Frontend Usage

- `GET /api/friend/list`: `miniapp-used`; callers: src/utils/api.ts:friendGetList

## Migration Notes

- `GET /api/friend/list`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
