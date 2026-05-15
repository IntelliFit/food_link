---
route_path: "/api/friend/invite/resolve"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9322"]
request_models: []
response_models: []
db_dependencies: ["is_friend", "resolve_user_by_friend_invite_code"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9322"]
---

# Resolve

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/friend/invite/resolve` | `api_friend_invite_resolve` | `jwt_required` | `implicit` | `backend/main.py:9322` |

## Request Contract

- `GET /api/friend/invite/resolve`: None

## Response Contract

- `GET /api/friend/invite/resolve`: Implicit JSON/dict response

## Main Flow

- `GET /api/friend/invite/resolve`: reads/writes via `is_friend, resolve_user_by_friend_invite_code`

## Dependencies & Side Effects

- Database dependencies: is_friend, resolve_user_by_friend_invite_code
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: is_friend, resolve_user_by_friend_invite_code
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/friend/invite/resolve`: 400, 404, 500

## Frontend Usage

- `GET /api/friend/invite/resolve`: `miniapp-used`; callers: src/utils/api.ts:resolveFriendInvite

## Migration Notes

- `GET /api/friend/invite/resolve`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
