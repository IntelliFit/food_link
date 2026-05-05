---
route_path: "/api/community/public-feed"
methods: ["GET"]
auth_type: ["public"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9421"]
request_models: []
response_models: []
db_dependencies: ["list_public_feed_records"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9421"]
---

# Public Feed

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/community/public-feed` | `api_community_public_feed` | `public` | `implicit` | `backend/main.py:9421` |

## Request Contract

- `GET /api/community/public-feed`: None

## Response Contract

- `GET /api/community/public-feed`: Implicit JSON/dict response

## Main Flow

- `GET /api/community/public-feed`: reads/writes via `list_public_feed_records`

## Dependencies & Side Effects

- Database dependencies: list_public_feed_records
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: list_public_feed_records
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/community/public-feed`: 500

## Frontend Usage

- `GET /api/community/public-feed`: `miniapp-used`; callers: src/utils/api.ts:communityGetPublicFeed

## Migration Notes

- `GET /api/community/public-feed`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
