---
route_path: "/api/login"
methods: ["POST"]
auth_type: ["public"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:10477"]
request_models: ["LoginRequest"]
response_models: ["LoginResponse"]
db_dependencies: ["get_user_by_openid", "update_user"]
worker_dependencies: []
external_dependencies: ["Supabase", "WeChat"]
source_refs: ["backend/main.py:10477"]
---

# Index

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/login` | `login` | `public` | `LoginResponse` | `backend/main.py:10477` |

## Request Contract

- `POST /api/login`: `LoginRequest` (code, phoneCode, inviteCode, testOpenid)

## Response Contract

- `POST /api/login`: LoginResponse

## Main Flow

- `POST /api/login`: reads/writes via `get_user_by_openid, update_user`; local helper chain includes `LoginResponse, get_phone_number`

## Dependencies & Side Effects

- Database dependencies: get_user_by_openid, update_user
- Worker dependencies: None
- External dependencies: Supabase, WeChat
- Local helper chain: LoginResponse, get_phone_number

## Data Reads/Writes

- This document touches database helpers: get_user_by_openid, update_user
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/login`: 400, 500

## Frontend Usage

- `POST /api/login`: `miniapp-used`; callers: src/utils/api.ts:login

## Migration Notes

- `POST /api/login`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
