---
route_path: "/api/upload-analyze-image-file"
methods: ["POST"]
auth_type: ["public"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:4248"]
request_models: []
response_models: []
db_dependencies: ["upload_food_analyze_image_bytes"]
worker_dependencies: []
external_dependencies: ["Supabase", "Supabase Storage"]
source_refs: ["backend/main.py:4248"]
---

# Index

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/upload-analyze-image-file` | `upload_analyze_image_file` | `public` | `implicit` | `backend/main.py:4248` |

## Request Contract

- `POST /api/upload-analyze-image-file`: None

## Response Contract

- `POST /api/upload-analyze-image-file`: Implicit JSON/dict response

## Main Flow

- `POST /api/upload-analyze-image-file`: reads/writes via `upload_food_analyze_image_bytes`; local helper chain includes `_guess_upload_image_suffix`

## Dependencies & Side Effects

- Database dependencies: upload_food_analyze_image_bytes
- Worker dependencies: None
- External dependencies: Supabase, Supabase Storage
- Local helper chain: _guess_upload_image_suffix

## Data Reads/Writes

- This document touches database helpers: upload_food_analyze_image_bytes
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/upload-analyze-image-file`: 400, 500

## Frontend Usage

- `POST /api/upload-analyze-image-file`: `miniapp-used`; callers: src/utils/api.ts:uploadAnalyzeImageFile

## Migration Notes

- `POST /api/upload-analyze-image-file`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
