---
route_path: "/api/friend/invite/accept"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9363"]
request_models: ["FriendInviteAcceptRequest"]
response_models: []
db_dependencies: ["is_friend", "resolve_user_by_friend_invite_code", "send_friend_request"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9363"]
---

# Accept

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/friend/invite/accept` | `api_friend_invite_accept` | `jwt_required` | `implicit` | `backend/main.py:9363` |

## Request Contract

- `POST /api/friend/invite/accept`: `FriendInviteAcceptRequest` (code)

## Response Contract

- `POST /api/friend/invite/accept`: Implicit JSON/dict response

## Main Flow

- `POST /api/friend/invite/accept`: reads/writes via `is_friend, resolve_user_by_friend_invite_code, send_friend_request`

## Dependencies & Side Effects

- Database dependencies: is_friend, resolve_user_by_friend_invite_code, send_friend_request
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: is_friend, resolve_user_by_friend_invite_code, send_friend_request
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/friend/invite/accept`: 400, 404, 500

## Frontend Usage

- `POST /api/friend/invite/accept`: `miniapp-used`; callers: src/utils/api.ts:acceptFriendInvite

## Migration Notes

- `POST /api/friend/invite/accept`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
