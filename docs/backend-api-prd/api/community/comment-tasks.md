---
route_path: "/api/community/comment-tasks"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:9796"]
request_models: []
response_models: []
db_dependencies: ["list_comment_tasks_by_user_sync"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:9796"]
---

# Comment Tasks

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/community/comment-tasks` | `api_community_comment_tasks` | `jwt_required` | `implicit` | `backend/main.py:9796` |

## Request Contract

- `GET /api/community/comment-tasks`: None

## Response Contract

- `GET /api/community/comment-tasks`: Implicit JSON/dict response

## Main Flow

- `GET /api/community/comment-tasks`: reads/writes via `list_comment_tasks_by_user_sync`

## Dependencies & Side Effects

- Database dependencies: list_comment_tasks_by_user_sync
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: list_comment_tasks_by_user_sync
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api/community/comment-tasks`: 500

## Frontend Usage

- `GET /api/community/comment-tasks`: `miniapp-used`; callers: src/utils/api.ts:communityGetCommentTasks

## Migration Notes

- `GET /api/community/comment-tasks`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
