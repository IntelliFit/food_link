---
route_path: "/api/community/feed/{record_id}/context"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9648"]
request_models: []
response_models: []
db_dependencies: ["get_feed_likes_for_records", "get_user_by_id", "list_feed_comments"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9648"]
---

# Record_Id Context

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/community/feed/{record_id}/context` | `api_community_feed_record_context` | `jwt_required` | `implicit` | `backend/main.py:9648` |

## Request Contract

- `GET /api/community/feed/{record_id}/context`: None

## Response Contract

- `GET /api/community/feed/{record_id}/context`: Implicit JSON/dict response

## Main Flow

- `GET /api/community/feed/{record_id}/context`: reads/writes via `get_feed_likes_for_records, get_user_by_id, list_feed_comments`; local helper chain includes `_ensure_feed_record_interactable`

## Dependencies & Side Effects

- Database dependencies: get_feed_likes_for_records, get_user_by_id, list_feed_comments
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: _ensure_feed_record_interactable

## Data Reads/Writes

- This document touches database helpers: get_feed_likes_for_records, get_user_by_id, list_feed_comments
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/community/feed/{record_id}/context`: 500

## Frontend Usage

- `GET /api/community/feed/{record_id}/context`: `miniapp-used`; callers: src/utils/api.ts:communityGetFeedContext

## Migration Notes

- `GET /api/community/feed/{record_id}/context`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
