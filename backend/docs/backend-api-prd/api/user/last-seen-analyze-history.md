---
route_path: "/api/user/last-seen-analyze-history"
methods: ["POST"]
auth_type: ["jwt_required"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:4625"]
request_models: []
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: []
source_refs: ["backend/main.py:4625"]
---

# Last Seen Analyze History

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/user/last-seen-analyze-history` | `mark_analyze_history_seen` | `jwt_required` | `implicit` | `backend/main.py:4625` |

## Request Contract

- `POST /api/user/last-seen-analyze-history`: None

## Response Contract

- `POST /api/user/last-seen-analyze-history`: Implicit JSON/dict response

## Main Flow

- `POST /api/user/last-seen-analyze-history`: mostly self-contained in the handler body

## Dependencies & Side Effects

- Database dependencies: None
- Worker dependencies: None
- External dependencies: None
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: None
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/user/last-seen-analyze-history`: 500

## Frontend Usage

- `POST /api/user/last-seen-analyze-history`: `miniapp-used`; callers: src/utils/api.ts:markAnalyzeHistorySeen

## Migration Notes

- `POST /api/user/last-seen-analyze-history`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
