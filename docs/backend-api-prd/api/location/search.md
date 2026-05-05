---
route_path: "/api/location/search"
methods: ["POST"]
auth_type: ["public"]
frontend_usage: ["miniapp-used"]
handler_refs: ["backend/main.py:5703"]
request_models: ["LocationSearchRequest"]
response_models: []
db_dependencies: []
worker_dependencies: []
external_dependencies: ["Tianditu"]
source_refs: ["backend/main.py:5703"]
---

# Search

## Purpose

Documents the current backend implementation for this route surface, including contracts, dependencies, and migration-sensitive behavior.

## Route Matrix

| Method | Path | Handler | Auth | Response Model | Source |
| --- | --- | --- | --- | --- | --- |
| `POST` | `/api/location/search` | `location_search` | `public` | `implicit` | `backend/main.py:5703` |

## Request Contract

- `POST /api/location/search`: `LocationSearchRequest` (keyWord, count, lon, lat, radius_km)

## Response Contract

- `POST /api/location/search`: Implicit JSON/dict response

## Main Flow

- `POST /api/location/search`: mostly self-contained in the handler body

## Dependencies & Side Effects

- Database dependencies: None
- Worker dependencies: None
- External dependencies: Tianditu
- Local helper chain: None

## Data Reads/Writes

- This document touches database helpers: None
- Async / worker-sensitive flow: No direct async task creation detected

## Error Cases

- `POST /api/location/search`: 500, 504

## Frontend Usage

- `POST /api/location/search`: `miniapp-used`; callers: src/packageExtra/pages/location-search/index.tsx:doSearch

## Migration Notes

- `POST /api/location/search`: check implicit response shape before reimplementation because many handlers do not declare `response_model`

## Open Questions / Drift

- No additional drift was detected for this route document beyond normal implicit-response ambiguity.
