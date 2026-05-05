---
route_path: "/api/friend/requests/all"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9261"]
request_models: []
response_models: []
db_dependencies: ["get_friend_requests_overview"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9261"]
---

# Requests All

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/friend/requests/all` | `api_friend_requests_overview` | `jwt_required` | `implicit` | `backend/main.py:9261` |

## Request Contract

- `GET /api/friend/requests/all`: None

## Response Contract

- `GET /api/friend/requests/all`: Implicit JSON/dict response

## Main Flow

- `GET /api/friend/requests/all`: reads/writes via `get_friend_requests_overview`

## Dependencies & Side Effects

- Database dependencies: get_friend_requests_overview
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: get_friend_requests_overview
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/friend/requests/all`: 500

## Frontend Usage

- `GET /api/friend/requests/all`: `miniapp-used`; callers: src/utils/api.ts:friendGetRequestsOverview

## Migration Notes

- `GET /api/friend/requests/all`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
