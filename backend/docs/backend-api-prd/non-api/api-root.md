---
route_path: "/api"
methods: ["GET"]
auth_type: ["public"]
frontend_usage: ["backend-only"]
handler_refs: ["backend/main.py:5680"]
request_models: []
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: []
source_refs: ["backend/main.py:5680"]
---

# Api Root

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/api` | `root` | `public` | `implicit` | `backend/main.py:5680` |

## Request Contract

- `GET /api`: None

## Response Contract

- `GET /api`: Implicit JSON/dict response

## Main Flow

- `GET /api`: mostly self-contained in the handler body

## Dependencies & Side Effects

- Database dependencies: None
- Worker dependencies: None
- External dependencies: None
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: None
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /api`: No static `HTTPException(...)` status found; inspect handler branches manually.

## Frontend Usage

- `GET /api`: `backend-only`; callers: No mini program caller found in current scan.

## Migration Notes

- `GET /api`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- Current scan found no mini program caller for at least one route in this document; verify real operator/test caller before rewrite.
