---
route_path: "/api/friend/request"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9152"]
request_models: []
response_models: []
db_dependencies: ["send_friend_request"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9152"]
---

# Request

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/friend/request` | `api_friend_request` | `jwt_required` | `implicit` | `backend/main.py:9152` |

## Request Contract

- `POST /api/friend/request`: None

## Response Contract

- `POST /api/friend/request`: Implicit JSON/dict response

## Main Flow

- `POST /api/friend/request`: reads/writes via `send_friend_request`

## Dependencies & Side Effects

- Database dependencies: send_friend_request
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: send_friend_request
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/friend/request`: 400, 500

## Frontend Usage

- `POST /api/friend/request`: `miniapp-used`; callers: src/utils/api.ts:friendSendRequest

## Migration Notes

- `POST /api/friend/request`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
