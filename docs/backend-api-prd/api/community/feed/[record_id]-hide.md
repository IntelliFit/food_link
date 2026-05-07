---
route_path: "/api/community/feed/{record_id}/hide"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9612"]
request_models: []
response_models: []
db_dependencies: ["hide_food_record_from_feed"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9612"]
---

# Record_Id Hide

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/community/feed/{record_id}/hide` | `api_community_hide_feed` | `jwt_required` | `implicit` | `backend/main.py:9612` |

## Request Contract

- `POST /api/community/feed/{record_id}/hide`: None

## Response Contract

- `POST /api/community/feed/{record_id}/hide`: Implicit JSON/dict response

## Main Flow

- `POST /api/community/feed/{record_id}/hide`: reads/writes via `hide_food_record_from_feed`

## Dependencies & Side Effects

- Database dependencies: hide_food_record_from_feed
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: hide_food_record_from_feed
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/community/feed/{record_id}/hide`: 404, 500

## Frontend Usage

- `POST /api/community/feed/{record_id}/hide`: `miniapp-used`; callers: src/utils/api.ts:communityHideFeed

## Migration Notes

- `POST /api/community/feed/{record_id}/hide`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
