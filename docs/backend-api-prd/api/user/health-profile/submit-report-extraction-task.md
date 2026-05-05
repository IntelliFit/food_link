---
route_path: "/api/user/health-profile/submit-report-extraction-task"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:7130"]
request_models: ["SubmitReportExtractionTaskRequest"]
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: ["Supabase Storage"]
source_refs: ["backend/main.py:7130"]
---

# Submit Report Extraction Task

## Purpose

Covers health profile read/write and OCR-related subflows that enrich analysis and onboarding.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/user/health-profile/submit-report-extraction-task` | `submit_report_extraction_task` | `jwt_required` | `implicit` | `backend/main.py:7130` |

## Request Contract

- `POST /api/user/health-profile/submit-report-extraction-task`: `SubmitReportExtractionTaskRequest` (imageUrl)

## Response Contract

- `POST /api/user/health-profile/submit-report-extraction-task`: Implicit JSON/dict response

## Main Flow

- `POST /api/user/health-profile/submit-report-extraction-task`: worker or async pipeline touchpoint: `analysis_tasks / worker queue`

## Dependencies & Side Effects

- Database dependencies: None
- Worker dependencies: None
- External dependencies: Supabase Storage
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: None
- Async / worker-sensitive flow: Yes

## Error Cases

- `POST /api/user/health-profile/submit-report-extraction-task`: 400, 500

## Frontend Usage

- `POST /api/user/health-profile/submit-report-extraction-task`: `miniapp-used`; callers: src/utils/api.ts:submitReportExtractionTask

## Migration Notes

- `POST /api/user/health-profile/submit-report-extraction-task`: preserve async task semantics and queue contract
- Remote `origin/dev` currently shows a narrower OCR worker path than local `main` (single-image DashScope-oriented flow instead of broader multi-image/provider-switch behavior). Reconcile this branch drift before freezing the rewrite target.

## Open Questions / Drift

- Branch drift exists around health-report OCR worker behavior; see `_shared/health-report-ocr.md`.
