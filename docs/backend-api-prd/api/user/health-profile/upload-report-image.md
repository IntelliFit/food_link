---
route_path: "/api/user/health-profile/upload-report-image"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:7103"]
request_models: ["UploadReportImageRequest"]
response_models: []
db_dependencies: ["upload_health_report_image"]
worker_dependencies: []
external_dependencies: ["Supabase", "Supabase Storage"]
source_refs: ["backend/main.py:7103"]
---

# Upload Report Image

## Purpose

Covers health profile read/write and OCR-related subflows that enrich analysis and onboarding.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/user/health-profile/upload-report-image` | `upload_report_image` | `jwt_required` | `implicit` | `backend/main.py:7103` |

## Request Contract

- `POST /api/user/health-profile/upload-report-image`: `UploadReportImageRequest` (base64Image)

## Response Contract

- `POST /api/user/health-profile/upload-report-image`: Implicit JSON/dict response

## Main Flow

- `POST /api/user/health-profile/upload-report-image`: reads/writes via `upload_health_report_image`

## Dependencies & Side Effects

- Database dependencies: upload_health_report_image
- Worker dependencies: None
- External dependencies: Supabase, Supabase Storage
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: upload_health_report_image
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/user/health-profile/upload-report-image`: 400, 500

## Frontend Usage

- `POST /api/user/health-profile/upload-report-image`: `miniapp-used`; callers: src/utils/api.ts:uploadReportImage

## Migration Notes

- `POST /api/user/health-profile/upload-report-image`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
