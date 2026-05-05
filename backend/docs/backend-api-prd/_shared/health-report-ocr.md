# Health Report OCR

This document summarizes the health-profile report-recognition flow across synchronous extraction endpoints and the async report-extraction task pipeline.

## Scope

- `/api/user/health-profile/ocr-extract`
- `/api/user/health-profile/ocr`
- `/api/user/health-profile/submit-report-extraction-task`
- worker-side `run_health_report_ocr_sync(...)`

## Primary Code Anchors

- [backend/main.py:6985](/Users/kirigaya/project/food_link/backend/main.py:6985)
- [backend/main.py:7005](/Users/kirigaya/project/food_link/backend/main.py:7005)
- [backend/main.py:7043](/Users/kirigaya/project/food_link/backend/main.py:7043)
- [backend/main.py:7130](/Users/kirigaya/project/food_link/backend/main.py:7130)
- [backend/main.py:7163](/Users/kirigaya/project/food_link/backend/main.py:7163)
- [backend/main.py:7197](/Users/kirigaya/project/food_link/backend/main.py:7197)
- [backend/worker.py:4156](/Users/kirigaya/project/food_link/backend/worker.py:4156)
- [backend/worker.py:4230](/Users/kirigaya/project/food_link/backend/worker.py:4230)
- [backend/worker.py:4291](/Users/kirigaya/project/food_link/backend/worker.py:4291)

## Current Main Branch Behavior

### Synchronous OCR Extract

- `/api/user/health-profile/ocr-extract`
- Reads a provided image URL or base64 image
- Calls local OCR helpers directly
- Returns extracted structured content without persisting the full async task flow

### Synchronous OCR And Save

- `/api/user/health-profile/ocr`
- Performs OCR and writes a `report` document into health documents
- Updates `weapp_user.health_condition.report_extract`

### Async Report Extraction Task

- `/api/user/health-profile/submit-report-extraction-task`
- Creates an async task consumed by the health-report worker
- Worker-side flow currently supports comma-separated multi-image URLs
- Current `main` branch worker can switch provider path via `LLM_PROVIDER`
- Worker merges indicators/conclusions/suggestions across images and writes merged content back to:
  - `user_health_documents`
  - `weapp_user.health_condition.report_extract`

## Remote Branch Drift Noted During Sync

`origin/dev` currently shows a newer OCR implementation direction than local `main`:

- removes the multi-image merge flow
- removes provider switching in the async worker path
- hardens the async worker path toward a single-image DashScope execution flow
- keeps the same broad persistence targets: `user_health_documents` and `weapp_user.health_condition.report_extract`

This means the migration docs should treat health-report OCR as an active drift zone rather than a fully settled design.

## Migration Notes

- Decide explicitly whether the rewrite keeps:
  - multi-image merge support
  - provider switching
  - single-image-only worker execution
- Preserve the writeback contract into both stored health documents and profile summary extract unless product intentionally changes it.
- Keep synchronous OCR endpoints and async OCR task flow documented separately; they are related but not identical surfaces.

## Related Route Docs

- [api/user/health-profile/submit-report-extraction-task.md](/Users/kirigaya/project/food_link/docs/backend-api-prd/api/user/health-profile/submit-report-extraction-task.md)
- [api/user/health-profile/ocr.md](/Users/kirigaya/project/food_link/docs/backend-api-prd/api/user/health-profile/ocr.md)
- [api/user/health-profile/ocr-extract.md](/Users/kirigaya/project/food_link/docs/backend-api-prd/api/user/health-profile/ocr-extract.md)
