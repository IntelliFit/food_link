---
route_path: "/api/critical-samples"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:7266"]
request_models: ["SaveCriticalSamplesRequest"]
response_models: []
db_dependencies: ["insert_critical_samples"]
worker_dependencies: []
external_dependencies: ["Supabase"]
source_refs: ["backend/main.py:7266"]
---

# Critical Samples

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/critical-samples` | `save_critical_samples` | `jwt_required` | `implicit` | `backend/main.py:7266` |

## Request Contract

- `POST /api/critical-samples`: `SaveCriticalSamplesRequest` (items)

## Response Contract

- `POST /api/critical-samples`: Implicit JSON/dict response

## Main Flow

- `POST /api/critical-samples`: reads/writes via `insert_critical_samples`

## Dependencies & Side Effects

- Database dependencies: insert_critical_samples
- Worker dependencies: None
- External dependencies: Supabase
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: insert_critical_samples
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/critical-samples`: 400

## Frontend Usage

- `POST /api/critical-samples`: `miniapp-used`; callers: src/utils/api.ts:saveCriticalSamples

## Migration Notes

- `POST /api/critical-samples`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
