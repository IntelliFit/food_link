---
route_path: "/api/analyze/tasks"
methods: ["GET"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:4569"]
request_models: []
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: []
source_refs: ["backend/main.py:4569"]
---

# Index

## Purpose

Covers food analysis submission, task lookup, and result mutation behavior used by the mini program and worker pipeline.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api/analyze/tasks` | `list_analyze_tasks` | `jwt_required` | `implicit` | `backend/main.py:4569` |

## Request Contract

- `GET /api/analyze/tasks`: None

## Response Contract

- `GET /api/analyze/tasks`: Implicit JSON/dict response

## Main Flow

- `GET /api/analyze/tasks`: worker or async pipeline touchpoint: `analysis_tasks / worker queue`

## Dependencies & Side Effects

- Database dependencies: None
- Worker dependencies: None
- External dependencies: None
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: None
- Async / worker-sensitive flow: Yes

## Error Cases

- `GET /api/analyze/tasks`: 500

## Frontend Usage

- `GET /api/analyze/tasks`: `miniapp-used`; callers: src/utils/api.ts:listAnalyzeTasks

## Migration Notes

- `GET /api/analyze/tasks`: preserve async task semantics and queue contract

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
