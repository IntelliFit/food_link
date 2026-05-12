---
route_path: "/api/community/feed"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9474"]
request_models: []
response_models: []
db_dependencies: ["list_friends_feed_records"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9474"]
---

# Feed

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/community/feed` | `api_community_feed` | `jwt_required` | `implicit` | `backend/main.py:9474` |

## Request Contract

- `GET /api/community/feed`: None

## Response Contract

- `GET /api/community/feed`: Implicit JSON/dict response

## Main Flow

- `GET /api/community/feed`: reads/writes via `list_friends_feed_records`

## Dependencies & Side Effects

- Database dependencies: list_friends_feed_records
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: list_friends_feed_records
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/community/feed`: 500

## Frontend Usage

- `GET /api/community/feed`: `miniapp-used`; callers: src/utils/api.ts:communityGetFeed

## Migration Notes

- `GET /api/community/feed`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
