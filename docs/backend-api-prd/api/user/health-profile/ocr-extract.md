---
route_path: "/api/user/health-profile/ocr-extract"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:7163"]
request_models: ["HealthReportOcrRequest"]
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: ["LLM Provider"]
source_refs: ["backend/main.py:7163"]
---

# Ocr Extract

## Purpose

Covers health profile read/write and OCR-related subflows that enrich analysis and onboarding.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/user/health-profile/ocr-extract` | `health_report_ocr_extract` | `jwt_required` | `implicit` | `backend/main.py:7163` |

## Request Contract

- `POST /api/user/health-profile/ocr-extract`: `HealthReportOcrRequest` (imageUrl, base64Image)

## Response Contract

- `POST /api/user/health-profile/ocr-extract`: Implicit JSON/dict response

## Main Flow

- `POST /api/user/health-profile/ocr-extract`: local helper chain includes `_ocr_extract_report_by_url, _ocr_extract_report_image`

## Dependencies & Side Effects

- Database dependencies: None
- Worker dependencies: None
- External dependencies: LLM Provider
- Local helper chain: _ocr_extract_report_by_url, _ocr_extract_report_image

## Data Reads/Writes

- This document touches database helpers: None
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/user/health-profile/ocr-extract`: 400, 500

## Frontend Usage

- `POST /api/user/health-profile/ocr-extract`: `miniapp-used`; callers: src/utils/api.ts:extractHealthReportOcr

## Migration Notes

- `POST /api/user/health-profile/ocr-extract`: check implicit response shape before reimplementation because many handlers do not declare `response_model`
- Preserve the distinction between "extract only" and "extract plus persist" flows if client behavior still depends on it.

## Open Questions / Drift

- Compare this sync extract-only flow with the async worker flow summarized in `_shared/health-report-ocr.md` before locking the target architecture.
