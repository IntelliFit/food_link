---
route_path: "/api/user/bind-phone"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:6749"]
request_models: ["BindPhoneRequest"]
response_models: []
db_dependencies: ["update_user"]
worker_dependencies: []
external_dependencies: ["Supabase", "WeChat"]
source_refs: ["backend/main.py:6749"]
---

# Bind Phone

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/user/bind-phone` | `bind_phone` | `jwt_required` | `implicit` | `backend/main.py:6749` |

## Request Contract

- `POST /api/user/bind-phone`: `BindPhoneRequest` (phoneCode)

## Response Contract

- `POST /api/user/bind-phone`: Implicit JSON/dict response

## Main Flow

- `POST /api/user/bind-phone`: reads/writes via `update_user`; local helper chain includes `get_phone_number`

## Dependencies & Side Effects

- Database dependencies: update_user
- Worker dependencies: None
- External dependencies: Supabase, WeChat
- Local helper chain: get_phone_number

## Data Reads/Writes

- This document touches database helpers: update_user
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/user/bind-phone`: 400, 500

## Frontend Usage

- `POST /api/user/bind-phone`: `miniapp-used`; callers: src/utils/api.ts:bindPhone

## Migration Notes

- `POST /api/user/bind-phone`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
