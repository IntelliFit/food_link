---
route_path: "/api/friend/invite/profile/{user_id}"
methods: ["GET"]
auth_type: ["public"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9282"]
request_models: []
response_models: []
db_dependencies: ["build_friend_invite_code", "get_user_by_id"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9282"]
---

# Profile User_Id

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/friend/invite/profile/{user_id}` | `api_friend_invite_profile` | `public` | `implicit` | `backend/main.py:9282` |

## Request Contract

- `GET /api/friend/invite/profile/{user_id}`: None

## Response Contract

- `GET /api/friend/invite/profile/{user_id}`: Implicit JSON/dict response

## Main Flow

- `GET /api/friend/invite/profile/{user_id}`: reads/writes via `build_friend_invite_code, get_user_by_id`

## Dependencies & Side Effects

- Database dependencies: build_friend_invite_code, get_user_by_id
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: build_friend_invite_code, get_user_by_id
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/friend/invite/profile/{user_id}`: 404, 500

## Frontend Usage

- `GET /api/friend/invite/profile/{user_id}`: `miniapp-used`; callers: src/utils/api.ts:getFriendInviteProfile

## Migration Notes

- `GET /api/friend/invite/profile/{user_id}`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
