---
route_path: "/api/friend/cleanup-duplicates"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9271"]
request_models: []
response_models: []
db_dependencies: ["cleanup_duplicate_friends"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9271"]
---

# Cleanup Duplicates

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/friend/cleanup-duplicates` | `api_friend_cleanup_duplicates` | `jwt_required` | `implicit` | `backend/main.py:9271` |

## Request Contract

- `POST /api/friend/cleanup-duplicates`: None

## Response Contract

- `POST /api/friend/cleanup-duplicates`: Implicit JSON/dict response

## Main Flow

- `POST /api/friend/cleanup-duplicates`: reads/writes via `cleanup_duplicate_friends`

## Dependencies & Side Effects

- Database dependencies: cleanup_duplicate_friends
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: cleanup_duplicate_friends
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/friend/cleanup-duplicates`: 500

## Frontend Usage

- `POST /api/friend/cleanup-duplicates`: `miniapp-used`; callers: src/utils/api.ts:friendCleanupDuplicates

## Migration Notes

- `POST /api/friend/cleanup-duplicates`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
