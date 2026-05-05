---
route_path: "/api/friend/search"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9130"]
request_models: []
response_models: []
db_dependencies: ["search_users"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9130"]
---

# Search

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/friend/search` | `api_friend_search` | `jwt_required` | `implicit` | `backend/main.py:9130` |

## Request Contract

- `GET /api/friend/search`: None

## Response Contract

- `GET /api/friend/search`: Implicit JSON/dict response

## Main Flow

- `GET /api/friend/search`: reads/writes via `search_users`

## Dependencies & Side Effects

- Database dependencies: search_users
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: search_users
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/friend/search`: 500

## Frontend Usage

- `GET /api/friend/search`: `miniapp-used`; callers: src/utils/api.ts:friendSearch

## Migration Notes

- `GET /api/friend/search`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
