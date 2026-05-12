---
route_path: "/api/friend/{friend_id}"
methods: ["DELETE"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9240"]
request_models: []
response_models: []
db_dependencies: ["delete_friend_pair"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9240"]
---

# Friend_Id

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `DELETE` | `/api/friend/{friend_id}` | `api_friend_delete` | `jwt_required` | `implicit` | `backend/main.py:9240` |

## Request Contract

- `DELETE /api/friend/{friend_id}`: None

## Response Contract

- `DELETE /api/friend/{friend_id}`: Implicit JSON/dict response

## Main Flow

- `DELETE /api/friend/{friend_id}`: reads/writes via `delete_friend_pair`

## Dependencies & Side Effects

- Database dependencies: delete_friend_pair
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: delete_friend_pair
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `DELETE /api/friend/{friend_id}`: 400, 404, 500

## Frontend Usage

- `DELETE /api/friend/{friend_id}`: `miniapp-used`; callers: src/utils/api.ts:friendDelete

## Migration Notes

- `DELETE /api/friend/{friend_id}`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
