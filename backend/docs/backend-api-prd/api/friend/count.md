---
route_path: "/api/friend/count"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9229"]
request_models: []
response_models: []
db_dependencies: ["count_friends_sync"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9229"]
---

# Count

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/friend/count` | `api_friend_count` | `jwt_required` | `implicit` | `backend/main.py:9229` |

## Request Contract

- `GET /api/friend/count`: None

## Response Contract

- `GET /api/friend/count`: Implicit JSON/dict response

## Main Flow

- `GET /api/friend/count`: reads/writes via `count_friends_sync`

## Dependencies & Side Effects

- Database dependencies: count_friends_sync
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: count_friends_sync
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/friend/count`: 500

## Frontend Usage

- `GET /api/friend/count`: `miniapp-used`; callers: src/utils/api.ts:getFriendCount

## Migration Notes

- `GET /api/friend/count`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
