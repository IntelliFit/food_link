---
route_path: "/api/friend/requests"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9171"]
request_models: []
response_models: []
db_dependencies: ["get_friend_requests_received"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9171"]
---

# Requests

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/friend/requests` | `api_friend_requests` | `jwt_required` | `implicit` | `backend/main.py:9171` |

## Request Contract

- `GET /api/friend/requests`: None

## Response Contract

- `GET /api/friend/requests`: Implicit JSON/dict response

## Main Flow

- `GET /api/friend/requests`: reads/writes via `get_friend_requests_received`

## Dependencies & Side Effects

- Database dependencies: get_friend_requests_received
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: get_friend_requests_received
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/friend/requests`: 500

## Frontend Usage

- `GET /api/friend/requests`: `miniapp-used`; callers: src/utils/api.ts:friendGetRequests

## Migration Notes

- `GET /api/friend/requests`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
