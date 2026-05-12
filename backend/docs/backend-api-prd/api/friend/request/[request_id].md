---
route_path: "/api/friend/request/{request_id}"
methods: ["DELETE"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9202"]
request_models: []
response_models: []
db_dependencies: ["cancel_sent_friend_request"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9202"]
---

# Request_Id

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `DELETE` | `/api/friend/request/{request_id}` | `api_friend_request_cancel` | `jwt_required` | `implicit` | `backend/main.py:9202` |

## Request Contract

- `DELETE /api/friend/request/{request_id}`: None

## Response Contract

- `DELETE /api/friend/request/{request_id}`: Implicit JSON/dict response

## Main Flow

- `DELETE /api/friend/request/{request_id}`: reads/writes via `cancel_sent_friend_request`

## Dependencies & Side Effects

- Database dependencies: cancel_sent_friend_request
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: cancel_sent_friend_request
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `DELETE /api/friend/request/{request_id}`: 400, 500

## Frontend Usage

- `DELETE /api/friend/request/{request_id}`: `miniapp-used`; callers: src/utils/api.ts:friendCancelSentRequest

## Migration Notes

- `DELETE /api/friend/request/{request_id}`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
