---
route_path: "/api/location/reverse"
methods: ["POST"]
auth_type: ["public"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:5763"]
request_models: ["LocationReverseRequest"]
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: ["Tianditu"]
source_refs: ["backend/main.py:5763"]
---

# Reverse

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/location/reverse` | `location_reverse` | `public` | `implicit` | `backend/main.py:5763` |

## Request Contract

- `POST /api/location/reverse`: `LocationReverseRequest` (lat, lon)

## Response Contract

- `POST /api/location/reverse`: Implicit JSON/dict response

## Main Flow

- `POST /api/location/reverse`: mostly self-contained in the handler body

## Dependencies & Side Effects

- Database dependencies: None
- Worker dependencies: None
- External dependencies: Tianditu
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: None
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/location/reverse`: 500, 504

## Frontend Usage

- `POST /api/location/reverse`: `miniapp-used`; callers: src/packageExtra/pages/location-search/index.tsx:handleMapTap, src/utils/api.ts:resolveAnalyzeGeoContext

## Migration Notes

- `POST /api/location/reverse`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
