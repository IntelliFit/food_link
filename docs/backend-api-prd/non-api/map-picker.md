---
route_path: "/map-picker"
methods: ["GET"]
auth_type: ["public"]
frontend_usage: ["backend-only"]
handler_refs: ["backend/main.py:5947"]
request_models: []
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: ["Tianditu"]
source_refs: ["backend/main.py:5947"]
---

# Map Picker

## Purpose

Documents non-API pages served directly by the backend process.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/map-picker` | `map_picker` | `public` | `implicit` | `backend/main.py:5947` |

## Request Contract

- `GET /map-picker`: None

## Response Contract

- `GET /map-picker`: Implicit JSON/dict response

## Main Flow

- `GET /map-picker`: mostly self-contained in the handler body

## Dependencies & Side Effects

- Database dependencies: None
- Worker dependencies: None
- External dependencies: Tianditu
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: None
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `GET /map-picker`: 503

## Frontend Usage

- `GET /map-picker`: `backend-only`; callers: No mini program caller found in current scan.

## Migration Notes

- `GET /map-picker`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- Current scan found no mini program caller for at least one route in this document; verify real operator/test caller before rewrite.
