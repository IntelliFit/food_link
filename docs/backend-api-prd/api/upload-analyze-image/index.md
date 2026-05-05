---
route_path: "/api/upload-analyze-image"
methods: ["POST"]
auth_type: ["public"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:4212"]
request_models: ["UploadAnalyzeImageRequest"]
response_models: []
db_dependencies: ["upload_food_analyze_image"]
worker_dependencies: []
external_dependencies: ["Supabase", "Supabase Storage"]
source_refs: ["backend/main.py:4212"]
---

# Index

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/upload-analyze-image` | `upload_analyze_image` | `public` | `implicit` | `backend/main.py:4212` |

## Request Contract

- `POST /api/upload-analyze-image`: `UploadAnalyzeImageRequest` (base64Image)

## Response Contract

- `POST /api/upload-analyze-image`: Implicit JSON/dict response

## Main Flow

- `POST /api/upload-analyze-image`: reads/writes via `upload_food_analyze_image`

## Dependencies & Side Effects

- Database dependencies: upload_food_analyze_image
- Worker dependencies: None
- External dependencies: Supabase, Supabase Storage
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: upload_food_analyze_image
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/upload-analyze-image`: 400, 500

## Frontend Usage

- `POST /api/upload-analyze-image`: `miniapp-used`; callers: src/utils/api.ts:uploadAnalyzeImage

## Migration Notes

- `POST /api/upload-analyze-image`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
