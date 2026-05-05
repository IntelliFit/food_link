---
route_path: "/api/friend/invite/profile-by-code"
methods: ["GET"]
auth_type: ["public"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9302"]
request_models: []
response_models: []
db_dependencies: ["build_friend_invite_code", "resolve_user_by_friend_invite_code"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9302"]
---

# Profile By Code

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/friend/invite/profile-by-code` | `api_friend_invite_profile_by_code` | `public` | `implicit` | `backend/main.py:9302` |

## Request Contract

- `GET /api/friend/invite/profile-by-code`: None

## Response Contract

- `GET /api/friend/invite/profile-by-code`: Implicit JSON/dict response

## Main Flow

- `GET /api/friend/invite/profile-by-code`: reads/writes via `build_friend_invite_code, resolve_user_by_friend_invite_code`

## Dependencies & Side Effects

- Database dependencies: build_friend_invite_code, resolve_user_by_friend_invite_code
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: build_friend_invite_code, resolve_user_by_friend_invite_code
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/friend/invite/profile-by-code`: 404, 500

## Frontend Usage

- `GET /api/friend/invite/profile-by-code`: `miniapp-used`; callers: src/utils/api.ts:getFriendInviteProfileByCode

## Migration Notes

- `GET /api/friend/invite/profile-by-code`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
