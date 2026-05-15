---
route_path: "/api/user/health-profile/ocr"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:7197"]
request_models: ["HealthReportOcrRequest"]
response_models: []
db_dependencies: ["insert_health_document"]
worker_dependencies: []
external_dependencies: ["LLM Provider", "Supabase", "Supabase Storage"]
source_refs: ["backend/main.py:7197"]
---

# Ocr

## Purpose

Covers health profile read/write and OCR-related subflows that enrich analysis and onboarding.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/user/health-profile/ocr` | `health_report_ocr` | `jwt_required` | `implicit` | `backend/main.py:7197` |

## Request Contract

- `POST /api/user/health-profile/ocr`: `HealthReportOcrRequest` (imageUrl, base64Image)

## Response Contract

- `POST /api/user/health-profile/ocr`: Implicit JSON/dict response

## Main Flow

- `POST /api/user/health-profile/ocr`: reads/writes via `insert_health_document`; local helper chain includes `_ocr_extract_report_image`

## Dependencies & Side Effects

- Database dependencies: insert_health_document
- Worker dependencies: None
- External dependencies: LLM Provider, Supabase, Supabase Storage
- Local helper chain: _ocr_extract_report_image

## Data Reads/Writes

- This document touches database helpers: insert_health_document
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/user/health-profile/ocr`: 400, 500

## Frontend Usage

- `POST /api/user/health-profile/ocr`: `miniapp-used`; callers: src/utils/api.ts:uploadHealthReportOcr

## Migration Notes

- `POST /api/user/health-profile/ocr`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- Keep sync OCR-save behavior separate from async OCR task behavior; both update health documents, but they do not share the same runtime path.

## Open Questions / Drift

- Compare this sync save flow with the async worker flow summarized in `_shared/health-report-ocr.md` before locking the target architecture.
