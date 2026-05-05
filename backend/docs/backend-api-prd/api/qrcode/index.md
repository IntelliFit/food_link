---
route_path: "/api/qrcode"
methods: ["POST"]
auth_type: ["public"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:10373"]
request_models: ["QRCodeRequest"]
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: ["WeChat"]
source_refs: ["backend/main.py:10373"]
---

# Index

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/qrcode` | `get_unlimited_qrcode` | `public` | `implicit` | `backend/main.py:10373` |

## Request Contract

- `POST /api/qrcode`: `QRCodeRequest` (scene, page, width, check_path, env_version)

## Response Contract

- `POST /api/qrcode`: Implicit JSON/dict response

## Main Flow

- `POST /api/qrcode`: local helper chain includes `get_access_token`

## Dependencies & Side Effects

- Database dependencies: None
- Worker dependencies: None
- External dependencies: WeChat
- Local helper chain: get_access_token

## Data Reads/Writes

- This document touches database helpers: None
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/qrcode`: 500

## Frontend Usage

- `POST /api/qrcode`: `miniapp-used`; callers: src/utils/api.ts:getUnlimitedQRCode

## Migration Notes

- `POST /api/qrcode`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
