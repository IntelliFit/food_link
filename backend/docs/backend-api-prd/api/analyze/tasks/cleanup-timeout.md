---
route_path: "/api/analyze/tasks/cleanup-timeout"
methods: ["POST"]
auth_type: ["public"]
frontend_usage: ["backend-only"]
handler_refs: ["backend/main.py:4764"]
request_models: []
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: []
source_refs: ["backend/main.py:4764"]
---

# Cleanup Timeout

## Purpose

Covers food analysis submission, task lookup, and result mutation behavior used by the mini program and worker pipeline.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/analyze/tasks/cleanup-timeout` | `cleanup_timed_out_tasks` | `public` | `implicit` | `backend/main.py:4764` |

## Request Contract

- `POST /api/analyze/tasks/cleanup-timeout`: None

## Response Contract

- `POST /api/analyze/tasks/cleanup-timeout`: Implicit JSON/dict response

## Main Flow

- `POST /api/analyze/tasks/cleanup-timeout`: mostly self-contained in the handler body

## Dependencies & Side Effects

- Database dependencies: None
- Worker dependencies: None
- External dependencies: None
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: None
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/analyze/tasks/cleanup-timeout`: 403, 500

## Frontend Usage

- `POST /api/analyze/tasks/cleanup-timeout`: `backend-only`; callers: No mini program caller found in current scan.

## Migration Notes

- `POST /api/analyze/tasks/cleanup-timeout`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- Current scan found no mini program caller for at least one route in this document; verify real operator/test caller before rewrite.
