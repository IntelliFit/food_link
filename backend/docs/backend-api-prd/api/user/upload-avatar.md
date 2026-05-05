---
route_path: "/api/user/upload-avatar"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:6783"]
request_models: ["UploadAvatarRequest"]
response_models: []
db_dependencies: ["upload_user_avatar"]
worker_dependencies: []
external_dependencies: ["Supabase", "Supabase Storage"]
source_refs: ["backend/main.py:6783"]
---

# Upload Avatar

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/user/upload-avatar` | `upload_avatar` | `jwt_required` | `implicit` | `backend/main.py:6783` |

## Request Contract

- `POST /api/user/upload-avatar`: `UploadAvatarRequest` (base64Image)

## Response Contract

- `POST /api/user/upload-avatar`: Implicit JSON/dict response

## Main Flow

- `POST /api/user/upload-avatar`: reads/writes via `upload_user_avatar`

## Dependencies & Side Effects

- Database dependencies: upload_user_avatar
- Worker dependencies: None
- External dependencies: Supabase, Supabase Storage
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: upload_user_avatar
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/user/upload-avatar`: 400, 500

## Frontend Usage

- `POST /api/user/upload-avatar`: `miniapp-used`; callers: src/utils/api.ts:uploadUserAvatar

## Migration Notes

- `POST /api/user/upload-avatar`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
